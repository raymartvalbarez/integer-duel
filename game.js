/* Integer Duel — 1-vs-1 integer tug-of-war for Bago NHS ADM.
 * Two phones, no server of our own: every player writes ONLY their own small JSON document
 * in MantleDB (profile, heartbeat, answers) and polls the opponent's document about once a second.
 * Both phones build the same 10 questions from one shared seed and compute the rope position
 * from the same two sets of answers, so they always agree. */
(function () {
  'use strict';

  var NS = window.IDBoard.NS;
  var API = window.IDBoard.API;
  var ADM_API = 'https://script.google.com/macros/s/AKfycbwGMSP8NmPT4GYMJZTw4qruizfFd5wzORZHZRM-HOUJOSQyyg3Gx20L5MEWsqT5EFdl-w/exec';

  var ROUNDS = 10;
  var LIMIT = 10;            // seconds per question (maximum)
  var LINE = 50;             // net pull that knocks the opponent past the line
  var MAXSHIFT = 55;         // scene units the rope moves at the line
  var BASE_PULL = 10, BONUS_PULL = 5;
  var GONE_MS = 40000;       // opponent silent this long = left
  var MIN_FORFEIT_ROUNDS = 3;
  var DEMO = /(?:\?|&)demo=1(?:&|$)/.test(location.search || '') || location.hash === '#demo';
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function $(id) { return document.getElementById(id); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function gl(p) { return (p.g ? 'G' + p.g : '') + (p.s ? (p.g ? ' · ' : '') + p.s : ''); }

  /* ---------------- sound ---------------- */
  var Sound = (function () {
    var ctx = null, master = null, on = IDBoard.store.get('idu-sound') !== '0';
    function ensure() {
      if (ctx) return ctx;
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination); } catch (e) { ctx = null; }
      return ctx;
    }
    function unlock() { var c = ensure(); if (c && c.state === 'suspended') c.resume().catch(function () {}); }
    function paint() { $('btn-sound').textContent = on ? '🔊 On' : '🔇 Off'; }
    function tone(f, d, type, g, when) {
      var c = ensure(); if (!c || !on) return;
      var t = when || c.currentTime, o = c.createOscillator(), gn = c.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g || 0.2, t + 0.02); gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(gn); gn.connect(master); o.start(t); o.stop(t + d + 0.05);
    }
    function seq(arr, type, g) { var c = ensure(); if (!c || !on) return; var t = c.currentTime; arr.forEach(function (f, i) { tone(f, 0.16, type || 'triangle', g || 0.2, t + i * 0.1); }); }
    paint();
    return {
      toggle: function () { unlock(); on = !on; IDBoard.store.set('idu-sound', on ? '1' : '0'); paint(); },
      unlock: unlock,
      good: function () { seq([784, 1175], 'triangle', 0.25); },
      bad: function () { seq([160, 110], 'sawtooth', 0.12); },
      tick: function () { tone(880, 0.08, 'square', 0.08); },
      pull: function () { tone(120, 0.25, 'triangle', 0.3); },
      go: function () { seq([523, 659, 784, 1046], 'triangle', 0.22); },
      win: function () { seq([523, 659, 784, 1046, 1318], 'triangle', 0.25); },
      lose: function () { seq([392, 330, 262], 'sine', 0.2); },
      invite: function () { seq([659, 880, 659, 880], 'triangle', 0.3); }
    };
  })();
  $('btn-sound').onclick = Sound.toggle;
  document.addEventListener('pointerdown', Sound.unlock, { once: true });

  /* ---------------- network ---------------- */
  var lastOk = Date.now();
  var lastStatus = 0;   // last HTTP status from the server (0 = no response / network error)
  function baseFor(path) { return /^[mab]-/.test(path) ? IDBoard.duelApi(path.slice(2)) : API; }
  async function http(method, path, body, tries, base) {
    tries = tries || 3;
    base = base || baseFor(path);
    for (var i = 0; i < tries; i++) {
      var ctl = typeof AbortController === 'function' ? new AbortController() : null, to = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
      try {
        var opt = { method: method, cache: 'no-store' }; if (ctl) opt.signal = ctl.signal;
        if (body !== undefined && body !== null) { opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
        var r = await fetch(base + '/' + path + (method === 'GET' ? '?t=' + Date.now() : ''), opt);
        clearTimeout(to);
        var j = null; try { j = await r.json(); } catch (e) {}
        if (r.status === 404) { lastOk = Date.now(); lastStatus = 404; return { ok: true, missing: true }; }
        if (r.ok) {
          lastOk = Date.now(); lastStatus = r.status;
          if (j && j.error && /not found|non-existent/i.test(String(j.error))) return { ok: true, missing: true };
          return { ok: true, j: j };
        }
        lastStatus = r.status;
        if (r.status === 403 && j && /limit/i.test(String(j.error || ''))) return { ok: false, status: 403, full: true };
        if (r.status === 429) { lastStatus = 429; }
      } catch (e) { clearTimeout(to); lastStatus = 0; }
      await sleep(350 * (i + 1));
    }
    return { ok: false, status: lastStatus };
  }
  function failMsg(r, what) {
    if (r && r.full) return 'The game server is full right now. Please tell your teacher.';
    if (r && r.status >= 400) return 'The game server had a problem (error ' + r.status + '). Please try again in a moment.';
    return what + ' Check your connection and try again.';
  }
  var wq = Promise.resolve();
  function write(method, path, body) { wq = wq.then(function () { return http(method, path, body, 4); }); return wq; }


  /* ---------------- 50-game lifetime cap ----------------
   * Count official finished duels (leaderboard r- docs) plus practice and any
   * duel that actually started (countdown / first question). Lobby wait does
   * not count. Identity is name + grade + section. The play log lives in
   * …-plays-N so practice/abandons never show on the leaderboard. */
  var Plays = (function () {
    var CAP = IDBoard.PLAY_CAP;
    var st = { n: 0, ids: [], ready: false, key: '', me: null, idx: 1 };
    var lastResults = [];
    var inflight = null;

    function profileMe() {
      if (G && G.me && G.me.n) return { n: G.me.n, g: G.me.g, s: G.me.s };
      var n = $('inp-name').value.replace(/\s+/g, ' ').trim();
      var g = $('inp-grade').value, s = $('inp-section').value.replace(/\s+/g, ' ').trim();
      return (n.length >= 2 && g && s) ? { n: n, g: g, s: s } : null;
    }
    function cacheK(key) { return 'idu-plays-v1-' + IDBoard.NS + '-' + key; }
    function loadLocal(key) {
      try {
        var o = JSON.parse(IDBoard.store.get(cacheK(key)) || 'null');
        return o && Array.isArray(o.ids) ? o : null;
      } catch (e) { return null; }
    }
    function saveLocal(key, ids, idx) {
      try { IDBoard.store.set(cacheK(key), JSON.stringify({ ids: ids, idx: idx || st.idx, t: Date.now() })); } catch (e) {}
    }
    async function readRemote(me) {
      var id = IDBoard.playDocId(me.n, me.g, me.s), ids = [], found = 0, lastEmpty = 0;
      for (var i = 1; i < 80; i++) {
        var bag = null;
        try {
          var r = await fetch(IDBoard.ROOT + 'export/' + IDBoard.playsNs(i) + '?t=' + Date.now(), { cache: 'no-store' });
          if (r.status === 404) { lastEmpty = i; break; }
          if (!r.ok) break;
          bag = await r.json();
        } catch (e) { break; }
        var entries = (bag && bag.entries) || {};
        if (!Object.keys(entries).length) { lastEmpty = i; break; }
        var v = entries[id];
        if (v && Array.isArray(v.ids)) { ids = v.ids; found = i; }
      }
      return { ids: ids, idx: found || (lastEmpty || 1) };
    }
    function mergeAll(me, remoteIds, official) {
      var loc = loadLocal(IDBoard.playKey(me.n, me.g, me.s));
      var off = IDBoard.officialPlayIds(official || lastResults, me.n, me.g, me.s);
      return IDBoard.mergePlayIds(off, remoteIds, loc && loc.ids);
    }
    function apply() {
      var box = $('plays-box'), count = $('plays-count'), msg = $('plays-cap');
      if (!box) return;
      var me = profileMe();
      if (!me) { box.hidden = true; syncButtons(false); return; }
      box.hidden = false;
      count.textContent = 'Games played: ' + st.n + ' / ' + CAP;
      var capped = st.n >= CAP;
      box.classList.toggle('cap', capped);
      if (msg) { msg.hidden = !capped; }
      syncButtons(capped);
    }
    function syncButtons(capped) {
      if (capped === undefined) capped = atCap();
      ['btn-create', 'btn-join', 'btn-demo'].forEach(function (id) {
        var b = $(id); if (b && !b.dataset.busy) b.disabled = !!capped;
      });
      var code = $('inp-code'); if (code) code.disabled = !!capped;
    }
    function setState(me, ids, idx) {
      var key = IDBoard.playKey(me.n, me.g, me.s);
      st.me = me; st.key = key; st.ids = ids; st.n = ids.length; st.ready = true;
      if (idx) st.idx = idx;
      saveLocal(key, ids, st.idx);
      apply();
    }
    async function refresh(official) {
      if (official) lastResults = official;
      var me = profileMe();
      if (!me) { st.ready = false; st.n = 0; st.key = ''; apply(); return st; }
      var key = IDBoard.playKey(me.n, me.g, me.s);
      var loc = loadLocal(key);
      if (loc) setState(me, mergeAll(me, loc.ids, lastResults), loc.idx);
      else apply();
      try {
        var rem = await readRemote(me);
        if (!official && !lastResults.length) {
          var bag = await IDBoard.fetchResults();
          lastResults = (bag && bag.results) || [];
        }
        var ids = mergeAll(me, rem.ids, lastResults);
        setState(me, ids, rem.idx);
      } catch (e) {
        var ids2 = mergeAll(me, [], lastResults);
        setState(me, ids2, st.idx);
      }
      return st;
    }
    async function ensure() {
      if (inflight) return inflight;
      var me = profileMe();
      if (me && st.ready && st.key === IDBoard.playKey(me.n, me.g, me.s)) return st;
      inflight = refresh().then(function (x) { inflight = null; return x; }, function () { inflight = null; return st; });
      return inflight;
    }
    async function record(gid) {
      var me = profileMe();
      if (!me || !gid) return st;
      await ensure();
      if (st.ids.indexOf(gid) >= 0) return st;
      var ids = IDBoard.mergePlayIds(st.ids, [gid]);
      setState(me, ids, st.idx);
      var body = { n: me.n, g: String(me.g), s: me.s, ids: ids, t: new Date().toISOString() };
      var id = IDBoard.playDocId(me.n, me.g, me.s);
      var idx = st.idx || 1;
      var existing = await http('GET', id, null, 2, IDBoard.playsApi(idx));
      if (existing.ok && !existing.missing) {
        var w = await http('PATCH', id, body, 2, IDBoard.playsApi(idx));
        if (!w.ok) await http('POST', id, body, 2, IDBoard.playsApi(idx));
        return st;
      }
      // document not at this index: try nearby, then create (roll over if the namespace is full)
      for (var i = 1; i < 80; i++) {
        var g = await http('GET', id, null, 1, IDBoard.playsApi(i));
        if (g.ok && !g.missing) {
          st.idx = i; await http('PATCH', id, body, 2, IDBoard.playsApi(i)); return st;
        }
      }
      for (var n = 0; n < 40; n++, idx++) {
        var c = await http('POST', id, body, 2, IDBoard.playsApi(idx));
        if (c.ok) { st.idx = idx; saveLocal(st.key, ids, idx); return st; }
        if (!c.full) break;
      }
      return st;
    }
    function atCap() { return st.n >= CAP; }
    function capMsg() { return "You've finished your 50 Integer Duel games. Great job!"; }
    function snapshot() { return { n: st.n, cap: CAP, atCap: atCap(), ids: st.ids.slice(), ready: st.ready, key: st.key }; }
    return { refresh: refresh, ensure: ensure, record: record, atCap: atCap, capMsg: capMsg, apply: apply, syncButtons: syncButtons, snapshot: snapshot, CAP: CAP };
  })();

  /* ---------------- screens ---------------- */
  var screens = { home: $('screen-home'), lobby: $('screen-lobby'), game: $('screen-game'), result: $('screen-result') };
  var onHome = null;
  function show(name) { Object.keys(screens).forEach(function (k) { screens[k].classList.toggle('active', k === name); }); if (name === 'home' && onHome) setTimeout(onHome, 0); }
  function homeErr(msg) { var e = $('home-err'); e.hidden = !msg; e.textContent = msg || ''; }
  var nsQ = /[?&]ns=/.test(location.search) ? '?ns=' + NS : '';
  $('board-link').href = 'leaderboard.html' + nsQ;
  $('res-board').href = 'leaderboard.html' + nsQ;

  /* ---------------- tug-of-war scene ---------------- */
  function figure(shirt, dark) {
    return '<g class="fig"><g class="lean" style="transform-origin:0px 0px">' +
      '<line x1="0" y1="-28" x2="-11" y2="0" stroke="' + dark + '" stroke-width="5" stroke-linecap="round"/>' +
      '<line x1="0" y1="-28" x2="10" y2="0" stroke="' + dark + '" stroke-width="5" stroke-linecap="round"/>' +
      '<line x1="0" y1="-28" x2="-7" y2="-54" stroke="' + shirt + '" stroke-width="10" stroke-linecap="round"/>' +
      '<line x1="-5" y1="-50" x2="24" y2="-44" stroke="#f1c27d" stroke-width="4" stroke-linecap="round"/>' +
      '<circle cx="-9" cy="-65" r="8" fill="#f1c27d"/><path d="M-17 -66 a8 8 0 0 1 16 0 z" fill="#3b2a1a"/>' +
      '</g></g>';
  }
  function sceneSVG() {
    return '<svg id="scene" viewBox="0 0 360 150" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Tug of war scene">' +
      '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7ec8f0"/><stop offset="1" stop-color="#d6f0ff"/></linearGradient>' +
      '<linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4caf50"/><stop offset="1" stop-color="#2e7d32"/></linearGradient></defs>' +
      '<rect width="360" height="110" fill="url(#sky)"/><circle cx="318" cy="24" r="12" fill="#ffe08a"/>' +
      '<path d="M0 100 Q60 62 130 98 T260 96 T360 90 V112 H0Z" fill="#7bb27b"/>' +
      '<rect y="106" width="360" height="44" fill="url(#grass)"/>' +
      '<g stroke="#fff" stroke-opacity=".35" stroke-width="2"><line x1="0" y1="140" x2="360" y2="140"/></g>' +
      '<g id="lines">' +
      '<line x1="' + (180 - MAXSHIFT) + '" y1="62" x2="' + (180 - MAXSHIFT) + '" y2="134" stroke="#fff" stroke-width="2" stroke-dasharray="5 4"/>' +
      '<line x1="' + (180 + MAXSHIFT) + '" y1="62" x2="' + (180 + MAXSHIFT) + '" y2="134" stroke="#fff" stroke-width="2" stroke-dasharray="5 4"/>' +
      '<text x="' + (180 - MAXSHIFT) + '" y="58" text-anchor="middle" font-size="9" font-weight="900" fill="#0d47a1">YOU WIN</text>' +
      '<text x="' + (180 + MAXSHIFT) + '" y="58" text-anchor="middle" font-size="9" font-weight="900" fill="#bf360c">THEY WIN</text></g>' +
      '<g id="post"><rect x="178" y="76" width="4" height="58" fill="#fff"/><rect x="170" y="130" width="20" height="6" rx="2" fill="#795548"/>' +
      '<path d="M182 76 l16 5 -16 5z" fill="#f5c518"/></g>' +
      '<g id="pullg" class="pullg" style="transform:translate(0px,0px)">' +
      '<line x1="-120" y1="88" x2="480" y2="88" stroke="#8d5a2b" stroke-width="5"/>' +
      '<line x1="-120" y1="88" x2="480" y2="88" stroke="#c9996a" stroke-width="5" stroke-dasharray="3 6"/>' +
      '<g id="ribbon"><rect x="174" y="79" width="12" height="18" rx="2" fill="#e53935" stroke="#7f1d1d"/><circle cx="180" cy="88" r="3" fill="#fff"/></g>' +
      '<g id="fig-me" transform="translate(80,132)">' + figure('#2f80ed', '#173f7a') + '</g>' +
      '<g id="fig-opp" transform="translate(280,132) scale(-1,1)">' + figure('#f2994a', '#8a4710') + '</g>' +
      '</g></svg>';
  }
  $('scene-host').innerHTML = sceneSVG();
  function setRope(net, animate) {
    var dx = -Math.max(-LINE, Math.min(LINE, net)) / LINE * MAXSHIFT;
    $('pullg').style.transform = 'translate(' + dx.toFixed(1) + 'px,0px)';
    // leaning: the side that is winning leans back harder
    var meLean = net > 0 ? -9 : net < 0 ? -2 : -5, oppLean = net < 0 ? -9 : net > 0 ? -2 : -5;
    document.querySelector('#fig-me .lean').style.transform = 'rotate(' + meLean + 'deg)';
    document.querySelector('#fig-opp .lean').style.transform = 'rotate(' + oppLean + 'deg)';
  }
  function jerk(who) {
    var el = document.querySelector(who === 'me' ? '#fig-me .lean' : '#fig-opp .lean');
    var cur = el.style.transform;
    el.style.transform = 'rotate(-16deg)';
    setTimeout(function () { el.style.transform = cur; }, 380);
  }
  var bannerT = null;
  function banner(text, ms) {
    var b = $('banner-t'); b.textContent = text; b.classList.add('on');
    clearTimeout(bannerT); bannerT = setTimeout(function () { b.classList.remove('on'); }, ms || 1800);
  }

  /* ---------------- state ---------------- */
  var G = null;
  var timers = { poll: null, hb: null, tick: null };
  function stopTimers() { Object.keys(timers).forEach(function (k) { clearInterval(timers[k]); timers[k] = null; }); }

  function newGame(role, code, me, seed) {
    return {
      role: role, code: code, me: me, opp: null, seed: seed, qs: seed != null ? IDQ.make(seed, ROUNDS) : null,
      mine: {}, oppDoc: null, oppHb: null, oppSeen: Date.now(), lastPoll: Date.now(),
      phase: 'init', r: 0, done: 0, qStart: 0, over: false, polling: false, demo: false, hbN: 0, marks: {}
    };
  }
  function ownPath() { return (G.role === 'a' ? 'a-' : 'b-') + G.code; }
  function oppPath() { return (G.role === 'a' ? 'b-' : 'a-') + G.code; }
  function saveActive() {
    if (G.demo) return;
    try { IDBoard.store.set('idu-active', JSON.stringify({ code: G.code, role: G.role, me: G.me, ts: Date.now(), r: G.r, qs: G.qStart, ns: NS })); } catch (e) {}
  }
  function clearActive() { try { IDBoard.store.del('idu-active'); } catch (e) {} }

  function startLoops() {
    stopTimers();
    timers.poll = setInterval(pollOnce, 1000);
    if (!G.demo) timers.hb = setInterval(function () { write('PATCH', ownPath(), { hb: Date.now() }); }, 4000);
    timers.tick = setInterval(tick, 100);
  }

  /* Remember recent question prompts (not answers) so the HOST can re-roll the
     shared seed until the new duel overlaps little with the last ~200 items on
     this phone. The joiner still uses the published seed, so both get the same set. */
  var SEEN_Q = 'idu-qseen';
  function recentPrompts() {
    try { var a = JSON.parse(IDBoard.store.get(SEEN_Q) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function rememberQuestions(qs) {
    if (!qs || !qs.length) return;
    var a = recentPrompts();
    qs.forEach(function (q) { if (q && q.p) a.push(q.p); });
    if (a.length > 200) a = a.slice(-200);
    try { IDBoard.store.set(SEEN_Q, JSON.stringify(a)); } catch (e) {}
  }
  function pickQuestionSeed() {
    var avoid = {}, rec = recentPrompts();
    for (var i = 0; i < rec.length; i++) avoid[rec[i]] = 1;
    var best = null;
    for (var t = 0; t < 16; t++) {
      var s = Math.floor(Math.random() * 2147483000) + 1;
      var qs = IDQ.make(s, ROUNDS), hit = 0;
      for (var j = 0; j < qs.length; j++) if (avoid[qs[j].p]) hit++;
      if (!best || hit < best.hit) best = { s: s, hit: hit };
      if (hit === 0) break;
    }
    return best.s;
  }

  /* ---------------- create / join ---------------- */

  function readProfile() {
    var name = $('inp-name').value.replace(/\s+/g, ' ').trim();
    var grade = $('inp-grade').value, section = $('inp-section').value.replace(/\s+/g, ' ').trim();
    if (name.length < 2) return { err: 'Please type your name.' };
    if (!grade) return { err: 'Please choose your grade level.' };
    if (!section) return { err: 'Please type your section.' };
    try { IDBoard.store.set('idu-profile', JSON.stringify({ n: name, g: grade, s: section })); } catch (e) {}
    return { me: { n: name, g: grade, s: section } };
  }
  function genCode() { var s = ''; for (var i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }
  function shareUrl(code) {
    var base = location.origin + location.pathname.replace(/index\.html$/, '');
    return base + '?room=' + code + (nsQ ? '&ns=' + NS : '');
  }

  var infoT = null;
  function homeInfo(msg) { var e = $('home-info'); e.hidden = !msg; e.textContent = msg || ''; clearTimeout(infoT); if (msg) infoT = setTimeout(function () { e.hidden = true; }, 10000); }
  function showLobby(mode, who) {   // mode: 'code' | 'invite'
    var inv = mode === 'invite';
    $('lobby-invite').hidden = !inv; $('lobby-codebox').hidden = inv;
    $('lobby-badge').textContent = inv ? 'Invite sent' : 'Duel created';
    $('btn-cancel').textContent = inv ? 'Cancel invite' : 'Cancel duel';
    if (inv) $('lobby-invite-t').textContent = 'Waiting for ' + who + '…';
    show('lobby');
  }
  async function createDuel(target) {
    homeErr(''); homeInfo('');
    var p = readProfile(); if (p.err) return homeErr(p.err);
    await Plays.ensure();
    if (Plays.atCap()) { Plays.apply(); return homeInfo(Plays.capMsg()); }
    $('btn-create').disabled = true; $('btn-create').dataset.busy = '1';
    try {
      var code = null;
      for (var i = 0; i < 6 && !code; i++) {
        var c = genCode(), r = await http('GET', 'm-' + c, null, 2);
        if (!r.ok) { homeErr(r.status >= 400 ? failMsg(r, '') : 'No internet connection. Please try again.'); return; }
        if (r.missing) code = c;
      }
      if (!code) return homeErr('Could not make a room code. Try again.');
      var seed = pickQuestionSeed();
      var m = await http('POST', 'm-' + code, { v: 1, seed: seed, created: Date.now(), host: p.me.n }, 3);
      if (!m.ok) return homeErr(failMsg(m, 'Could not create the duel.'));
      var d = await http('POST', 'a-' + code, { n: p.me.n, g: p.me.g, s: p.me.s, hb: Date.now(), ans: {} }, 3);
      if (!d.ok) return homeErr(failMsg(d, 'Could not create the duel.'));
      G = newGame('a', code, p.me, seed);
      G.phase = 'lobby'; G.lobbyAt = Date.now();
      saveActive();
      $('lobby-code').textContent = code;
      $('lobby-link').textContent = shareUrl(code);
      showLobby('code');
      startLoops();
      if (target) {
        G.invite = { pid: target.pid, n: target.n, at: Date.now() };
        showLobby('invite', target.n);
        var iv = await http('POST', 'i-' + IDBoard.pid(), { pid: IDBoard.pid(), n: p.me.n, g: p.me.g, s: p.me.s, code: code, ts: Date.now() }, 2, IDBoard.invApi(target.pid));
        if (!iv.ok) {
          var gg = G; if (gg && gg.code === code) { gg.invite = null; write('PATCH', ownPath(), { left: 1 }); leaveToHome(iv.full ? target.n + ' cannot receive invites right now. Try the duel code instead.' : 'Could not send the invite. Check your connection and try again.'); }
        }
      }
    } finally { delete $('btn-create').dataset.busy; Plays.syncButtons(); }
  }

  async function joinDuel(codeIn) {
    homeErr(''); homeInfo('');
    var p = readProfile(); if (p.err) return homeErr(p.err);
    var code = String(codeIn || $('inp-code').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) return homeErr('Type the 5-letter duel code.');
    await Plays.ensure();
    if (Plays.atCap()) {
      Plays.apply();
      http('POST', 'd-' + code, { by: p.me.n, ts: Date.now(), why: 'capped' }, 2, IDBoard.duelApi(code));
      return homeInfo(Plays.capMsg());
    }
    $('btn-join').disabled = true; $('btn-join').dataset.busy = '1';
    try {
      var m = await http('GET', 'm-' + code, null, 3);
      if (!m.ok) return homeErr(m.status >= 400 ? failMsg(m, '') : 'No internet connection. Please try again.');
      if (m.missing || !m.j || !m.j.seed) return homeErr('Duel ' + code + ' was not found. Check the code with your friend.');
      if (Date.now() - Number(m.j.created || 0) > 45 * 60 * 1000) return homeErr('That duel is too old. Ask your friend to create a new one.');
      var h = await http('GET', 'a-' + code, null, 3);
      if (!h.ok || h.missing) return homeErr('The host has left this duel. Ask for a new code.');
      if (IDBoard.norm(h.j.n) === IDBoard.norm(p.me.n) && String(h.j.g) === String(p.me.g)) return homeErr('You cannot duel yourself. Use a different name on the second phone.');
      var b = await http('GET', 'b-' + code, null, 2);
      if (b.ok && !b.missing) return homeErr('That duel already has two players.');
      var tok = Math.random().toString(36).slice(2, 10);
      var w = await http('POST', 'b-' + code, { n: p.me.n, g: p.me.g, s: p.me.s, hb: Date.now(), ans: {}, tok: tok, joined: Date.now() }, 3);
      if (!w.ok) return homeErr(failMsg(w, 'Could not join.'));
      await sleep(1100);
      var chk = await http('GET', 'b-' + code, null, 2);
      if (chk.ok && chk.j && chk.j.tok !== tok) return homeErr('That duel already has two players.');
      G = newGame('b', code, p.me, m.j.seed);
      G.opp = { n: h.j.n, g: h.j.g, s: h.j.s };
      G.phase = 'joined'; G.joinedAt = Date.now();
      saveActive();
      $('lobby-code').textContent = code;
      $('lobby-link').textContent = 'Joined ' + h.j.n + '’s duel. Waiting for the host to start…';
      $('btn-share').style.display = 'none'; $('btn-copy').style.display = 'none';
      showLobby('code'); $('lobby-badge').textContent = 'Joined';
      startLoops();
    } finally { delete $('btn-join').dataset.busy; Plays.syncButtons(); }
  }

  /* ---------------- polling & state machine ---------------- */
  async function pollOnce() {
    if (!G || G.over || G.polling) return;
    G.polling = true;
    var g = G;
    try {
      if (g.demo) { step(); return; }
      var r = await http('GET', oppPath(), null, 1);
      if (G !== g) return;
      var now = Date.now();
      if (r.ok) {
        if (now - g.lastPoll > 12000) g.oppSeen = now;   // I was offline: don't blame the opponent
        g.lastPoll = now;
        if (!r.missing && r.j && typeof r.j === 'object') {
          if (r.j.hb !== g.oppHb) { g.oppHb = r.j.hb; g.oppSeen = now; }
          g.oppDoc = r.j;
        }
      }
      if (g.invite && g.phase === 'lobby' && !(g.oppDoc && g.oppDoc.n)) {
        var dd = await http('GET', 'd-' + g.code, null, 1, IDBoard.duelApi(g.code));
        if (G === g && dd.ok && !dd.missing && dd.j) { var nm2 = g.invite.n; write('PATCH', ownPath(), { left: 1 }); leaveToHome(dd.j.why === 'capped' ? (nm2 + ' has already finished their 50 Integer Duel games.') : (nm2 + ' declined your invite.'), true); return; }
      }
    } finally { g.polling = false; }
    if (G === g) step();
  }
  function oppAns() { return (G.oppDoc && G.oppDoc.ans) || {}; }
  function oppGone() {
    if (G.demo) return false;
    if (G.oppDoc && G.oppDoc.left) return true;
    return Date.now() - G.oppSeen > GONE_MS && Date.now() - lastOk < 10000;
  }

  function step() {
    if (!G || G.over) return;
    var d = G.oppDoc;
    if (G.phase === 'lobby') {
      if (G.invite && !(d && d.n) && Date.now() - G.invite.at > 30000) { var nm = G.invite.n; write('PATCH', ownPath(), { left: 1 }); return leaveToHome(nm + ' did not respond to your invite.', true); }
      if (Date.now() - G.lobbyAt > 15 * 60 * 1000) { return leaveToHome('The duel expired because no one joined. Create a new one.'); }
      if (d && d.n) {
        G.opp = { n: d.n, g: d.g, s: d.s };
        if (IDBoard.norm(d.n) === IDBoard.norm(G.me.n) && String(d.g) === String(G.me.g)) { return leaveToHome('Someone joined with your same name. Create a new duel.'); }
        write('PATCH', ownPath(), { go: Date.now() });
        startCountdown(4);
      }
    } else if (G.phase === 'joined') {
      if (d && d.go) { G.opp = { n: d.n, g: d.g, s: d.s }; startCountdown(3); }
      else if (Date.now() - G.joinedAt > 90000 || oppGone()) leaveToHome('The host did not start the duel. Ask for a new code.');
    } else if (G.phase === 'q' || G.phase === 'wait' || G.phase === 'countdown') {
      if (oppGone()) return opponentLeft();
      if (G.phase === 'q') $('hud-status').textContent = oppAns()[G.r] ? 'Opponent answered' : '';
      if (G.phase === 'wait') {
        if (oppAns()[G.r]) revealRound(G.r);
        else $('hud-status').textContent = 'Waiting for opponent…';
      }
    }
  }

  function recordGameStart() {
    if (!G || G.playLogged) return;
    G.playLogged = true;
    var id = G.demo ? ('p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)) : ('d-' + String(G.code || '').toUpperCase());
    Plays.record(id);
  }

  function startCountdown(sec) {
    if (G.phase === 'countdown') return;
    G.phase = 'countdown';
    recordGameStart();
    $('btn-share').style.display = ''; $('btn-copy').style.display = '';
    initGameUI();
    show('game');
    var n = sec, cd = function () {
      if (!G || G.over || G.phase !== 'countdown') return;
      if (n <= 0) { Sound.go(); return showRound(1); }
      banner(n === 1 ? 'Get ready… 1' : 'Starting in ' + n, 1000); Sound.tick(); n--;
      setTimeout(cd, 1000);
    };
    $('q-prompt').textContent = 'Duel vs ' + G.opp.n + ' (' + gl(G.opp) + ')';
    $('q-prompt').className = '';
    $('q-choices').innerHTML = ''; $('q-feedback').textContent = '';
    cd();
  }

  function initGameUI() {
    $('tag-me').textContent = G.me.n; $('tag-me-sub').textContent = gl(G.me) + ' · pull 0';
    $('tag-opp').textContent = G.opp ? G.opp.n : '…'; $('tag-opp-sub').textContent = (G.opp ? gl(G.opp) : '') + ' · pull 0';
    var dots = $('dots'); dots.innerHTML = '';
    for (var i = 1; i <= ROUNDS; i++) { var e = document.createElement('i'); e.id = 'dot-' + i; dots.appendChild(e); }
    setRope(0);
    $('hud-round').textContent = 'Round 1/' + ROUNDS;
    setTimerFace(LIMIT); $('timer-bar').style.transform = 'scaleX(1)';
  }

  function setTimerFace(secs) {
    var n = Math.max(0, Math.ceil(secs));
    var t = $('hud-time'), w = $('timer-wrap');
    t.textContent = n;
    t.classList.remove('warn', 'urgent');
    if (w) w.classList.remove('warn', 'urgent');
    if (n <= 2) { t.classList.add('urgent'); if (w) w.classList.add('urgent'); }
    else if (n <= 3) { t.classList.add('warn'); if (w) w.classList.add('warn'); }
  }

  function showRound(r) {
    G.r = r; G.phase = 'q'; G.qStart = Date.now(); G.answered = false;
    saveActive();
    setTimerFace(LIMIT);
    $('timer-bar').style.transform = 'scaleX(1)';
    var q = G.qs[r - 1];
    $('hud-round').textContent = 'Round ' + r + '/' + ROUNDS; $('hud-status').textContent = '';
    $('q-prompt').textContent = q.p; $('q-prompt').className = q.p.length > 60 ? 'long' : '';
    var box = $('q-choices'); box.innerHTML = '';
    var longOpt = q.o.some(function (s) { return s.length > 14; });
    q.o.forEach(function (txt, i) {
      var b = document.createElement('button'); b.className = 'chip' + (longOpt ? ' sm' : ''); b.type = 'button'; b.textContent = txt;
      b.onclick = function () { answer(i, b); };
      box.appendChild(b);
    });
    $('q-feedback').textContent = ''; $('q-feedback').className = 'fb';
    for (var i = 1; i <= ROUNDS; i++) { var dot = $('dot-' + i); if (dot) dot.classList.toggle('cur', i === r); }
    if (G.demo) botSchedule(r);
  }

  function tick() {
    if (!G || G.over || G.phase !== 'q') return;
    var el = Date.now() - G.qStart, left = Math.max(0, LIMIT - el / 1000);
    $('timer-bar').style.transform = 'scaleX(' + Math.max(0, 1 - el / (LIMIT * 1000)).toFixed(3) + ')';
    var secs = Math.ceil(left);
    if (String(secs) !== $('hud-time').textContent) {
      setTimerFace(secs);
      if (secs <= 3 && secs > 0) Sound.tick();
    }
    if (el >= LIMIT * 1000) timeUp();
  }

  function recordAnswer(c, ms) {
    var r = G.r; G.answered = true; G.phase = 'wait';
    G.mine[r] = { c: c, ms: ms };
    if (!G.demo) write('PATCH', ownPath(), { ans: (function () { var o = {}; o[r] = { c: c, ms: ms }; return o; })(), hb: Date.now() });
    saveActive();
    [].forEach.call($('q-choices').children, function (b) { b.disabled = true; });
    $('hud-status').textContent = 'Waiting for opponent…';
    setTimeout(pollOnce, 150);
  }
  function answer(i, btn) {
    if (!G || G.phase !== 'q') return;
    var ms = Date.now() - G.qStart;
    if (ms > LIMIT * 1000 + 300) return timeUp();
    var q = G.qs[G.r - 1], ok = i === q.k;
    // only the tapped chip is marked; the correct choice is NEVER highlighted
    btn.classList.add(ok ? 'ok' : 'bad');
    var fb = $('q-feedback');
    if (ok) { fb.textContent = '✔ Correct!'; fb.className = 'fb ok'; Sound.good(); } else { fb.textContent = '✘ Wrong — no pull'; fb.className = 'fb bad'; Sound.bad(); }
    recordAnswer(i, Math.min(ms, LIMIT * 1000));
  }
  function timeUp() {
    if (!G || G.phase !== 'q') return;
    var fb = $('q-feedback'); fb.textContent = '⏰ Time’s up — no pull'; fb.className = 'fb bad'; Sound.bad();
    recordAnswer(-1, LIMIT * 1000);
  }

  /* ---------------- scoring (same on both phones) ---------------- */
  function evalRec(rec, q) {
    if (!rec || !Number.isInteger(rec.c) || rec.c < 0 || rec.c > 3 || typeof rec.ms !== 'number' || rec.ms < 0 || rec.ms > LIMIT * 1000 + 800) return { ok: false, pull: 0 };
    if (rec.c !== q.k) return { ok: false, pull: 0 };
    var ms = Math.max(600, rec.ms);
    // Same 10 pull + up to 5 speed bonus as before; bonus is now relative to the 10 s cap.
    return { ok: true, pull: BASE_PULL + Math.round(BONUS_PULL * Math.max(0, 1 - ms / (LIMIT * 1000))) };
  }
  function totals(upTo) {
    var t = { pm: 0, po: 0, cm: 0, co: 0 }, oa = oppAns();
    for (var r = 1; r <= upTo; r++) {
      var q = G.qs[r - 1], a = evalRec(G.mine[r], q), b = evalRec(oa[r], q);
      t.pm += a.pull; t.po += b.pull; if (a.ok) t.cm++; if (b.ok) t.co++;
    }
    t.net = t.pm - t.po;
    return t;
  }

  function revealRound(r) {
    if (G.phase !== 'wait') return;
    G.phase = 'reveal';
    var q = G.qs[r - 1], a = evalRec(G.mine[r], q), b = evalRec(oppAns()[r], q);
    G.done = r;
    var t = totals(r);
    var dot = $('dot-' + r); if (dot) { dot.classList.remove('cur'); dot.classList.add(a.ok ? 'ok' : 'bad'); }
    $('hud-status').textContent = '';
    setRope(t.net, true);
    if (a.pull) jerk('me'); if (b.pull) jerk('opp');
    if (a.pull || b.pull) Sound.pull();
    banner('You +' + a.pull + '   ·   ' + (G.opp ? G.opp.n.split(' ')[0] : 'Opp') + ' +' + b.pull, 2100);
    $('tag-me-sub').textContent = gl(G.me) + ' · pull ' + t.pm;
    $('tag-opp-sub').textContent = gl(G.opp) + ' · pull ' + t.po;
    var knock = Math.abs(t.net) >= LINE;
    setTimeout(function () {
      if (!G || G.over) return;
      if (knock) return finish('pull', t.net > 0 ? G.role : (G.role === 'a' ? 'b' : 'a'));
      if (r >= ROUNDS) return finish('rounds', t.net === 0 ? 'd' : (t.net > 0 ? G.role : (G.role === 'a' ? 'b' : 'a')));
      showRound(r + 1);
    }, 2400);
  }

  /* ---------------- finish ---------------- */
  function opponentLeft() {
    if (G.done >= MIN_FORFEIT_ROUNDS) return finish('forfeit', G.role);
    voided('Your opponent left before the duel really started, so this duel does not count.');
  }
  function voided(msg) {
    G.over = true; stopTimers(); clearActive();
    $('res-title').textContent = 'Duel cancelled'; $('res-sub').textContent = msg;
    $('res-me-n').textContent = G.me.n; $('res-me-p').textContent = '–'; $('res-me-c').textContent = '';
    $('res-opp-n').textContent = G.opp ? G.opp.n : 'Opponent'; $('res-opp-p').textContent = '–'; $('res-opp-c').textContent = '';
    $('res-save').textContent = 'Not saved to the leaderboard.';
    show('result');
  }
  function finish(how, w) {
    if (G && G.qs) rememberQuestions(G.qs);
    if (G.over) return;
    G.over = true; stopTimers(); clearActive();
    var t = totals(G.done || 0);
    var meWon = w === G.role, draw = w === 'd';
    $('res-title').textContent = draw ? 'It’s a draw!' : meWon ? '🏆 You win!' : 'You lose';
    $('res-sub').textContent = how === 'forfeit' ? 'Your opponent left the duel, so you win.' :
      how === 'pull' ? (meWon ? 'You pulled the rope past your line!' : 'The rope was pulled past your line.') :
        draw ? 'Equal pull after ' + ROUNDS + ' rounds.' : 'Most pull after ' + ROUNDS + ' rounds.';
    $('res-me-n').textContent = G.me.n + ' (' + gl(G.me) + ')'; $('res-me-p').textContent = t.pm; $('res-me-c').textContent = t.cm + ' of ' + G.done + ' answered correctly';
    $('res-opp-n').textContent = G.opp.n + ' (' + gl(G.opp) + ')'; $('res-opp-p').textContent = t.po; $('res-opp-c').textContent = t.co + ' of ' + G.done + ' answered correctly';
    $('res-me').classList.toggle('winner', meWon); $('res-opp').classList.toggle('winner', !meWon && !draw);
    $('res-save').textContent = G.demo ? 'Practice mode — not saved to the leaderboard.' : 'Saving your result to the leaderboard…';
    $('btn-again').textContent = G.demo ? 'Practice again' : '⚔ Duel again';
    show('result');
    if (draw) Sound.good(); else if (meWon) Sound.win(); else Sound.lose();
    if (G.demo) return;
    var A = G.role === 'a' ? { p: t.pm, k: t.cm, who: G.me } : { p: t.po, k: t.co, who: G.opp };
    var B = G.role === 'a' ? { p: t.po, k: t.co, who: G.opp } : { p: t.pm, k: t.cm, who: G.me };
    var res = {
      t: new Date().toISOString(), w: w, h: how, r: G.done,
      a: { n: A.who.n, g: String(A.who.g), s: A.who.s, p: A.p, k: A.k },
      b: { n: B.who.n, g: String(B.who.g), s: B.who.s, p: B.p, k: B.k }
    };
    saveResult(res, how === 'forfeit' ? 0 : (G.role === 'a' ? 0 : 5000));
    var g = G, code = G.code;
    setTimeout(function () { // tidy the room documents after a while; leaderboard result stays
      if (how !== 'forfeit') { http('DELETE', (g.role === 'a' ? 'a-' : 'b-') + code, null, 1); if (g.role === 'a') http('DELETE', 'm-' + code, null, 1); }
    }, 150000);
  }
  /* Results go to the current numbered namespace res-N; if it is full (403 limit) move to N+1 and retry. */
  async function postResult(code, res) {
    var idx = IDBoard.resIdx(), last = { ok: false };
    for (var n = 0; n < 60; n++, idx++) {
      var w = await http('POST', 'r-' + code, res, 2, IDBoard.resApi(idx));
      if (w.ok) { IDBoard.setResIdx(idx); return w; }
      last = w;
      if (!w.full) return w;   // real network/server error: caller retries
    }
    return last;
  }
  async function saveResult(res, delay) {
    if (delay) {
      await sleep(delay);
      var ex = await http('GET', 'r-' + G.code, null, 2, IDBoard.resApi(IDBoard.resIdx()));
      if (ex.ok && !ex.missing) { $('res-save').textContent = '✔ Result saved to the leaderboard.'; return; }
    }
    var ok = false, w = null;
    for (var i = 0; i < 4 && !ok; i++) { w = await postResult(G.code, res); ok = w.ok; if (!ok) await sleep(1500); }
    $('res-save').textContent = ok ? '✔ Result saved to the leaderboard.' : (w && (w.full || w.status >= 400) ? '⚠ Could not save the result (server problem). Tell your teacher the code ' + G.code + '.' : '⚠ Could not save the result (no connection). Tell your teacher the code ' + G.code + '.');
  }

  function askConfirm(msg) {
    return new Promise(function (res) {
      $('confirm-msg').textContent = msg; $('confirm-box').hidden = false;
      var done = function (v) { $('confirm-box').hidden = true; res(v); };
      $('confirm-yes').onclick = function () { done(true); };
      $('confirm-no').onclick = function () { done(false); };
    });
  }
  async function leaveDuel() {
    if (!G) return;
    if (!G.demo && G.phase !== 'lobby' && G.phase !== 'joined') {
      var msg = G.done >= MIN_FORFEIT_ROUNDS ? 'Leave the duel? Your opponent will win.' : 'Leave the duel? It will not count on the leaderboard, but it still counts as one of your 50 games.';
      if (!(await askConfirm(msg))) return;
    }
    cleanupInvite(G);
    if (!G.demo) { try { await Promise.race([write('PATCH', ownPath(), { left: 1 }), sleep(2500)]); } catch (e) {} }
    G.over = true; stopTimers(); clearActive(); G = null;
    $('btn-share').style.display = ''; $('btn-copy').style.display = '';
    show('home'); refreshTop();
  }
  function cleanupInvite(g) {
    if (!g || !g.invite) return;
    var iv = g.invite; g.invite = null;
    http('DELETE', 'i-' + IDBoard.pid(), null, 1, IDBoard.invApi(iv.pid));
  }
  function leaveToHome(msg, info) {
    cleanupInvite(G);
    if (G) { G.over = true; stopTimers(); }
    clearActive(); G = null;
    $('btn-share').style.display = ''; $('btn-copy').style.display = '';
    show('home'); homeErr(info ? '' : msg); homeInfo(info ? msg : ''); refreshTop();
  }

  /* ---------------- practice vs computer ---------------- */
  async function startDemo() {
    homeErr(''); homeInfo('');
    await Plays.ensure();
    if (Plays.atCap()) { Plays.apply(); return homeInfo(Plays.capMsg()); }
    var p = readProfile();
    var me = p.me || { n: ($('inp-name').value.trim() || 'Player'), g: $('inp-grade').value || '11', s: $('inp-section').value.trim() || 'Practice' };
    if (!me.n || !me.g || !me.s) return homeErr('Type your name, grade and section first.');
    G = newGame('a', 'DEMO0', me, pickQuestionSeed());
    G.demo = true; G.opp = { n: 'Computer 🤖', g: '', s: 'Practice' }; G.oppDoc = { ans: {}, hb: 1 };
    startLoops();
    G.phase = 'idle';
    startCountdown(3);
  }
  function botSchedule(r) {
    var g = G, q = G.qs[r - 1];
    var acc = r <= 5 ? 0.85 : r <= 8 ? 0.65 : 0.5;
    var delay = Math.round((1 + Math.random() * 7) * 1000); // 1–8 s, always inside the 10 s limit
    setTimeout(function () {
      if (G !== g || g.over) return;
      var ok = Math.random() < acc, c = q.k;
      if (!ok) { do { c = Math.floor(Math.random() * 4); } while (c === q.k); }
      g.oppDoc.ans[r] = { c: c, ms: delay };
    }, delay);
  }

  /* ---------------- resume after refresh ---------------- */
  async function resumeDuel() {
    var st; try { st = JSON.parse(IDBoard.store.get('idu-active') || 'null'); } catch (e) { st = null; }
    if (!st || st.ns !== NS) return clearActive();
    var m = await http('GET', 'm-' + st.code, null, 3);
    if (!m.ok) return homeErr('No internet connection.');
    if (m.missing || !m.j || !m.j.seed) { clearActive(); $('rejoin').hidden = true; return homeErr('That duel is over.'); }
    G = newGame(st.role, st.code, st.me, m.j.seed);
    var own = await http('GET', ownPath(), null, 3), opp = await http('GET', oppPath(), null, 3);
    if (!own.ok || own.missing) { clearActive(); G = null; $('rejoin').hidden = true; return homeErr('That duel is over.'); }
    G.mine = (own.j && own.j.ans) || {};
    if (opp.ok && !opp.missing) { G.oppDoc = opp.j; G.oppHb = opp.j.hb; }
    G.oppSeen = Date.now(); G.lastPoll = Date.now();
    $('rejoin').hidden = true;
    if (G.role === 'a' && !(G.oppDoc && G.oppDoc.n)) {
      G.phase = 'lobby'; G.lobbyAt = Date.now();
      $('lobby-code').textContent = G.code; $('lobby-link').textContent = shareUrl(G.code); showLobby('code'); return startLoops();
    }
    if (!G.oppDoc) { clearActive(); G = null; return homeErr('Your opponent has left that duel.'); }
    G.opp = { n: G.oppDoc.n, g: G.oppDoc.g, s: G.oppDoc.s };
    if (G.role === 'b' && !G.oppDoc.go) {
      G.phase = 'joined'; G.joinedAt = Date.now();
      $('lobby-code').textContent = G.code; $('lobby-link').textContent = 'Waiting for the host to start…'; show('lobby'); return startLoops();
    }
    recordGameStart();
    initGameUI(); show('game'); startLoops();
    // replay finished rounds
    var oa = (G.oppDoc && G.oppDoc.ans) || {}, r = 1;
    while (G.mine[r] && oa[r]) {
      G.done = r; var t = totals(r); var a = evalRec(G.mine[r], G.qs[r - 1]);
      var dot = $('dot-' + r); if (dot) dot.classList.add(a.ok ? 'ok' : 'bad');
      setRope(t.net);
      $('tag-me-sub').textContent = gl(G.me) + ' · pull ' + t.pm; $('tag-opp-sub').textContent = gl(G.opp) + ' · pull ' + t.po;
      if (Math.abs(t.net) >= LINE) return finish('pull', t.net > 0 ? G.role : (G.role === 'a' ? 'b' : 'a'));
      if (r >= ROUNDS) return finish('rounds', t.net === 0 ? 'd' : (t.net > 0 ? G.role : (G.role === 'a' ? 'b' : 'a')));
      r++;
    }
    G.r = r;
    if (G.mine[r]) { showRoundKeep(r); G.phase = 'wait'; [].forEach.call($('q-choices').children, function (b) { b.disabled = true; }); }
    else { showRound(r); if (st.r === r && st.qs) G.qStart = st.qs; }
  }
  function showRoundKeep(r) { showRound(r); G.mine[r] = G.mine[r]; }

  /* ---------------- online presence + invites ----------------
   * Presence: each player overwrites ONE key (p-<id>) in a 5-minute lobby namespace (shard 1; if that is full
   * the writer moves to shard 2, 3, ...). Readers read the current bucket (plus the previous one just after a
   * rollover). Invites: written to the INVITEE's own namespace (i-<inviter id>); the reply (decline) goes to the
   * duel's own namespace (d-<code>). Nothing here can permanently fill a namespace. */
  var Online = (function () {
    var HB = 10000, LISTEVERY = 6000, INVEVERY = 4000, FRESH = 30000, INV_TTL = 30000;
    var PID = IDBoard.pid();
    var on = false, tm = {}, shard = 1, shardBucket = -1, info = {}, lastBusy = null, handled = {};
    var pop = null;   // currently shown invite {from, n, g, s, code, id, at}
    function profile() {
      var n = $('inp-name').value.replace(/\s+/g, ' ').trim(), g = $('inp-grade').value, s = $('inp-section').value.replace(/\s+/g, ' ').trim();
      return (n.length >= 2 && g && s) ? { n: n, g: g, s: s } : null;
    }
    function busy() { return !!G; }
    async function beat() {
      var p = profile(); if (!p || !on) return;
      var b = IDBoard.lobBucket();
      if (b !== shardBucket) { shardBucket = b; shard = 1; }
      var body = { n: p.n, g: p.g, s: p.s, st: busy() ? 'duel' : (Plays.atCap() ? 'capped' : 'idle'), hb: Date.now() };
      for (var i = 0; i < 30; i++) {
        var r = await http('POST', 'p-' + PID, body, 1, IDBoard.lobApi(b, shard));
        if (r.ok) { lastBusy = busy(); return; }
        if (r.full) { shard++; continue; }
        return;
      }
    }
    async function exportOf(base) {
      var ctl = typeof AbortController === 'function' ? new AbortController() : null, to = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
      try {
        var r = await fetch(base.replace('mantledb.sh/v2/', 'mantledb.sh/v2/export/') + '?t=' + Date.now(), { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
        clearTimeout(to);
        if (r.status === 404) return { entries: {} };
        if (!r.ok) return null;
        return await r.json();
      } catch (e) { clearTimeout(to); return null; }
    }
    async function readList() {
      var now = Date.now(), b = IDBoard.lobBucket(), buckets = [b];
      if (now % IDBoard.BUCKET_MS < 40000) buckets.push(b - 1);
      var found = {}, okAny = false;
      for (var bi = 0; bi < buckets.length; bi++) {
        for (var s = 1; s < 30; s++) {
          var j = await exportOf(IDBoard.lobApi(buckets[bi], s));
          if (!j) break;
          okAny = true;
          var bag = j.entries || {}, keys = Object.keys(bag);
          keys.forEach(function (k) {
            if (k.indexOf('p-') !== 0) return;
            var v = bag[k], id = k.slice(2);
            if (!v || typeof v.n !== 'string' || !v.hb) return;
            if (!found[id] || found[id].hb < v.hb) found[id] = v;
          });
          if (keys.length < 100) break;
        }
      }
      if (!okAny) return null;
      Object.keys(found).forEach(function (id) {
        var v = found[id], c = info[id];
        if (!c) { info[id] = { hb: v.hb, seenAt: Math.abs(now - v.hb) > 90000 ? 0 : now, v: v }; }
        else if (c.hb !== v.hb) { c.hb = v.hb; c.v = v; if (c.seenAt || Math.abs(now - v.hb) <= 90000) c.seenAt = now; }
        else c.v = v;
      });
      return true;
    }
    function render() {
      var box = $('online'), p = profile();
      if (!on || !p || !screens.home.classList.contains('active')) { box.hidden = true; return; }
      box.hidden = false;
      var now = Date.now(), me = p, list = [];
      Object.keys(info).forEach(function (id) {
        var c = info[id]; if (id === PID || !c.seenAt || now - c.seenAt > FRESH) return;
        var v = c.v; if (IDBoard.norm(v.n) === IDBoard.norm(me.n) && IDBoard.gradeNum(v.g) === IDBoard.gradeNum(me.g)) return;
        if (v.st === 'capped') return;
        list.push({ pid: id, n: v.n, g: v.g, s: v.s, st: v.st });
      });
      list.sort(function (a, b) { return (a.st === 'duel') - (b.st === 'duel') || a.n.localeCompare(b.n); });
      $('online-n').textContent = list.length ? '(' + list.length + ')' : '';
      var host = $('online-list'); host.innerHTML = '';
      if (!list.length) { var e = document.createElement('div'); e.className = 'oempty'; e.textContent = 'No one else is online yet. Share the link or use a duel code.'; host.appendChild(e); return; }
      list.forEach(function (x) {
        var row = document.createElement('div'); row.className = 'orow';
        var w = document.createElement('div'); w.className = 'who';
        var nb = document.createElement('b'); nb.textContent = x.n; var sm = document.createElement('small'); sm.textContent = 'Grade ' + x.g + ' · ' + x.s;
        w.appendChild(nb); w.appendChild(sm);
        var bt = document.createElement('button'); bt.type = 'button';
        if (x.st === 'duel') { bt.textContent = 'In a duel'; bt.disabled = true; }
        else if (Plays.atCap()) { bt.textContent = 'Invite'; bt.disabled = true; }
        else { bt.textContent = 'Invite'; bt.setAttribute('data-pid', x.pid); bt.onclick = function () { invite(x); }; }
        row.appendChild(w); row.appendChild(bt); host.appendChild(row);
      });
    }
    async function listTick() {
      if (!on || busy() || document.hidden || !screens.home.classList.contains('active')) return;
      if (await readList()) render();
    }
    function invite(x) {
      if (G || Plays.atCap()) return;
      var bts = document.querySelectorAll('#online-list button'); [].forEach.call(bts, function (b) { b.disabled = true; });
      createDuel({ pid: x.pid, n: x.n }).then(function () { render(); });
    }
    /* ---- invitee side ---- */
    function closePop(note) {
      if (!pop) return; pop = null; $('invite-pop').hidden = true;
      clearInterval(tm.popTimer); tm.popTimer = null;
      if (note) homeInfo(note);
    }
    function delInvite(fromPid) { return http('DELETE', 'i-' + fromPid, null, 1, IDBoard.invApi(PID)); }
    function showPop(v, from) {
      pop = { from: from, n: v.n, code: v.code, at: Date.now() };
      $('inv-who').textContent = v.n; $('inv-sub').textContent = 'Grade ' + v.g + ' · ' + v.s + ' invites you to a duel!';
      $('invite-pop').hidden = false;
      try { Sound.invite(); } catch (e) {}
      try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
      var upd = function () {
        if (!pop) return; var left = Math.max(0, Math.ceil((INV_TTL - (Date.now() - pop.at)) / 1000));
        $('inv-timer').textContent = 'Expires in ' + left + 's';
        if (left <= 0) decline(true);
      };
      upd(); clearInterval(tm.popTimer); tm.popTimer = setInterval(upd, 1000);
    }
    function decline(timeout, why) {
      if (!pop) return; var p = pop;
      closePop(why === 'capped' ? Plays.capMsg() : (timeout ? 'The invite from ' + p.n + ' expired.' : ''));
      var me = profile();
      http('POST', 'd-' + p.code, { by: me ? me.n : '', ts: Date.now(), why: why || (timeout ? 'timeout' : 'declined') }, 2, IDBoard.duelApi(p.code));
      delInvite(p.from);
    }
    function rejectCap(v, from) {
      var me = profile();
      http('POST', 'd-' + v.code, { by: me ? me.n : '', ts: Date.now(), why: 'capped' }, 2, IDBoard.duelApi(v.code));
      delInvite(from);
      homeInfo(Plays.capMsg());
    }
    function accept() {
      if (!pop) return;
      if (Plays.atCap()) { decline(false, 'capped'); return; }
      var p = pop; closePop('');
      delInvite(p.from);
      $('inp-code').value = p.code;
      joinDuel(p.code);
    }
    async function invTick() {
      if (!on || document.hidden) return;
      if (pop) {
        if (G) return decline(false);
        var r = await http('GET', 'i-' + pop.from, null, 1, IDBoard.invApi(PID));
        if (pop && r.ok && r.missing) closePop(pop.n + ' cancelled the invite.');
        return;
      }
      if (busy() || !screens.home.classList.contains('active')) return;
      var j = await exportOf(IDBoard.invApi(PID)); if (!j || pop || busy()) return;
      var bag = j.entries || {}, now = Date.now(), best = null;
      for (var k of Object.keys(bag)) {
        if (k.indexOf('i-') !== 0) continue;
        var v = bag[k], from = k.slice(2);
        if (!v || !v.code || !v.ts) { delInvite(from); continue; }
        var age = now - v.ts;
        if (age > 120000) { delInvite(from); continue; }
        var id = from + ':' + v.ts;
        if (handled[id] || age > 60000 || age < -60000) continue;
        if (!best || v.ts > best.v.ts) best = { v: v, from: from, id: id };
      }
      if (!best) return;
      handled[best.id] = 1;
      // make sure the host is still there before bothering the player
      var a = await http('GET', 'a-' + best.v.code, null, 1);
      if (!a.ok) { delete handled[best.id]; return; }
      if (a.missing || !a.j || a.j.left) { delInvite(best.from); return; }
      var b = await http('GET', 'b-' + best.v.code, null, 1);
      if (b.ok && !b.missing) { delInvite(best.from); return; }
      if (busy() || pop) return;
      if (Plays.atCap()) { rejectCap(best.v, best.from); return; }
      showPop(best.v, best.from);
    }
    function stop() {
      on = false; Object.keys(tm).forEach(function (k) { clearInterval(tm[k]); tm[k] = null; });
      closePop(''); $('online').hidden = true;
    }
    function start() {
      if (on) return; on = true; lastBusy = busy();
      beat(); listTick(); invTick();
      tm.hb = setInterval(beat, HB); tm.list = setInterval(listTick, LISTEVERY); tm.inv = setInterval(invTick, INVEVERY);
      tm.busy = setInterval(function () { if (busy() !== lastBusy) { lastBusy = busy(); beat(); } if (!busy()) render(); }, 1500);
    }
    var deb = null;
    function refresh() { clearTimeout(deb); deb = setTimeout(function () { if (profile() && !DEMO) { if (!on) start(); else beat(); } else stop(); }, 900); }
    function init() {
      onHome = function () { render(); listTick(); };
      ['inp-name', 'inp-grade', 'inp-section'].forEach(function (id) { $(id).addEventListener('input', refresh); $(id).addEventListener('change', refresh); });
      $('inv-accept').onclick = accept; $('inv-decline').onclick = function () { decline(false); };
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) { if (on) { Object.keys(tm).forEach(function (k) { clearInterval(tm[k]); tm[k] = null; }); on = false; } }
        else if (profile() && !DEMO) start();
      });
      if (profile() && !DEMO) start();
    }
    return { init: init, refresh: refresh, beat: beat, state: function () { return { on: on, pop: pop, info: info }; } };
  })();

  /* ---------------- home wiring ---------------- */
  var roster = [];
  async function loadRoster() {
    try {
      var r = await fetch(ADM_API + '?action=config&t=' + Date.now()); var j = await r.json();
      roster = (Array.isArray(j.learners) ? j.learners : []).filter(function (x) { return x && x.n && x.g && x.s; });
      var dl = $('name-list'); dl.innerHTML = '';
      roster.forEach(function (x) { var o = document.createElement('option'); o.value = x.n; dl.appendChild(o); });
    } catch (e) {}
  }
  function onIdentity() { Plays.refresh(); }
  $('inp-name').addEventListener('change', function () {
    var v = IDBoard.norm($('inp-name').value);
    var hit = roster.filter(function (x) { return IDBoard.norm(x.n) === v; })[0];
    if (hit) { $('inp-grade').value = IDBoard.gradeNum(hit.g); $('inp-section').value = hit.s; }
    onIdentity();
  });
  ['inp-name', 'inp-grade', 'inp-section'].forEach(function (id) {
    $(id).addEventListener('input', onIdentity); $(id).addEventListener('change', onIdentity);
  });
  async function refreshTop() {
    var tb = $('top-body');
    try {
      var r = await IDBoard.fetchResults();
      Plays.refresh(r.results);
      var top = IDBoard.aggregate(r.results, 'all').slice(0, 5);
      tb.innerHTML = '';
      if (!top.length) { tb.innerHTML = '<tr><td colspan="4" style="color:#777">No duels yet — be the first!</td></tr>'; return; }
      top.forEach(function (p, i) {
        var tr = document.createElement('tr');
        [['🥇', '🥈', '🥉', '4', '5'][i], p.name, 'G' + p.grade, String(p.wins)].forEach(function (v) { var td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
        tb.appendChild(tr);
      });
    } catch (e) {}
  }
  function init() {
    try {
      var pr = JSON.parse(IDBoard.store.get('idu-profile') || 'null');
      if (pr) { $('inp-name').value = pr.n || ''; $('inp-grade').value = pr.g || ''; $('inp-section').value = pr.s || ''; }
    } catch (e) {}
    var room = (/[?&]room=([A-Za-z0-9]{5})/.exec(location.search) || [])[1];
    if (room) $('inp-code').value = room.toUpperCase();
    // Bago SHS ADM app 1.7.0+: the learner tapped Accept on an invite pop-up somewhere else in the app.
    // The app already removed the invite; join as soon as the ADM account has filled in the name.
    var acc = (/[?&]accept=([A-Za-z0-9]{5})(?:&|$)/.exec(location.search) || [])[1];
    if (acc && !DEMO) {
      acc = acc.toUpperCase(); $('inp-code').value = acc;
      try { history.replaceState(null, '', location.pathname + (nsQ ? '?ns=' + NS : '')); } catch (e) {}
      homeInfo('Joining the duel you accepted…');
      var t0 = Date.now();
      (function waitJoin() {
        if (G) return;
        var ready = !readProfile().err, locked = !!$('adm-id-note');
        if (ready && (locked || Date.now() - t0 > 4000)) return joinDuel(acc);
        if (Date.now() - t0 > 10000) { homeInfo(''); return homeErr('Type your name, grade and section, then tap Join to accept the duel.'); }
        setTimeout(waitJoin, 300);
      })();
    }
    if (DEMO) { $('demo-banner').hidden = false; $('btn-create').style.display = 'none'; $('btn-join').style.display = 'none'; $('inp-code').style.display = 'none'; document.querySelector('label[for=inp-code]').style.display = 'none'; document.querySelector('.divider').style.display = 'none'; $('btn-demo').className = 'primary'; $('btn-demo').textContent = 'Start Practice Duel'; }
    try {
      var st = JSON.parse(IDBoard.store.get('idu-active') || 'null');
      if (st && st.ns === NS && Date.now() - st.ts < 40 * 60 * 1000 && !DEMO) { $('rejoin').hidden = false; $('rejoin-text').textContent = 'You have a duel in progress (code ' + st.code + ').'; }
      else if (st) clearActive();
    } catch (e) {}
    $('btn-create').onclick = function () { createDuel(); };
    $('btn-join').onclick = function () { joinDuel(); };
    $('btn-demo').onclick = startDemo;
    $('btn-rejoin').onclick = resumeDuel;
    $('btn-forget').onclick = function () { clearActive(); $('rejoin').hidden = true; };
    $('btn-leave').onclick = leaveDuel;
    $('btn-cancel').onclick = leaveDuel;
    $('btn-again').onclick = function () { G = null; show('home'); refreshTop(); Plays.apply(); };
    $('btn-copy').onclick = function () {
      var url = shareUrl(G.code), done = function () { $('btn-copy').textContent = 'Copied ✔'; setTimeout(function () { $('btn-copy').textContent = 'Copy link'; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, done); else done();
    };
    $('btn-share').onclick = function () {
      var url = shareUrl(G.code), text = 'Duel me in Integer Duel! Code: ' + G.code;
      if (navigator.share) navigator.share({ title: 'Integer Duel', text: text, url: url }).catch(function () {}); else $('btn-copy').click();
    };
    $('inp-code').addEventListener('input', function () { this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    loadRoster(); refreshTop();
    Online.init();
  }
  /* ---- in-app browser (Messenger / Facebook / Instagram) helper: non-blocking tip ---- */
  var UA = navigator.userAgent || '';
  var IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|FB4A|Messenger|Instagram|; wv\)/i.test(UA);
  var IS_ANDROID = /Android/i.test(UA), IS_IOS = /iPhone|iPad|iPod/i.test(UA);
  function chromeIntent() {
    return 'intent://' + location.host + location.pathname + location.search + '#Intent;scheme=https;package=com.android.chrome;end';
  }
  function initInApp() {
    if (!IN_APP) return;
    var bar = $('inapp'); if (!bar || IDBoard.store.get('idu-inapp-x') === '1') return;
    bar.hidden = false;
    if (IS_ANDROID) {
      $('inapp-text').textContent = 'For best results, open in Chrome. You can also keep playing here.';
      $('inapp-open').hidden = false; $('inapp-open').onclick = function () { location.href = chromeIntent(); };
    } else {
      $('inapp-text').textContent = 'For best results, tap ••• then “Open in browser”. You can also keep playing here.';
    }
    $('inapp-x').onclick = function () { bar.hidden = true; IDBoard.store.set('idu-inapp-x', '1'); };
  }
  window.addEventListener('error', function (e) {
    var bar = $('inapp'); if (!bar || !bar.hidden) return;
    bar.hidden = false; $('inapp-text').textContent = 'Something went wrong on this phone’s browser. Try reloading, or open this link in Chrome.';
    if (IS_ANDROID) { $('inapp-open').hidden = false; $('inapp-open').onclick = function () { location.href = chromeIntent(); }; }
  });
  window.__IDU = { state: function () { return G; }, online: function () { return Online.state(); }, plays: function () { return Plays.snapshot(); } };
  init();
  initInApp();
})();
