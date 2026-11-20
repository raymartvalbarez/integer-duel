/* Integer Duel — shared leaderboard helpers (used by index.html and leaderboard.html). */
(function (root) {
  'use strict';
  var DEFAULT_NS = 'bnhs-integerduel-nov2026';
  function nsName() {
    var m = /[?&]ns=([\w-]+)/.exec(location.search || '');
    return m && m[1].indexOf('bnhs-integerduel-') === 0 ? m[1] : DEFAULT_NS;
  }
  var store = (function () {
    var mem = {}, ok = false;
    try { window.store.set('__t', '1'); window.localStorage.removeItem('__t'); ok = true; } catch (e) { ok = false; }
    return {
      get: function (k) { try { if (ok) { var v = window.store.get(k); return v === undefined ? null : v; } } catch (e) {} return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      set: function (k, v) { try { if (ok) { window.store.set(k, v); return; } } catch (e) {} mem[k] = String(v); },
      del: function (k) { try { if (ok) window.localStorage.removeItem(k); } catch (e) {} delete mem[k]; }
    };
  })();
  var NS = nsName();
  var API = 'https://mantledb.sh/v2/' + NS;
  var EXPORT = 'https://mantledb.sh/v2/export/' + NS;
  var ROOT = 'https://mantledb.sh/v2/';
  /* Live duel documents (m-/a-/b-) live in one tiny namespace PER DUEL so they can never fill up the
     free 100-entry limit. Results (r-) go into numbered namespaces res-1, res-2, ... (legacy NS is read-only history). */
  var BASE = NS === DEFAULT_NS ? 'bnhs-integerduel' : NS;
  function duelNs(code) { return BASE + '-d-' + String(code).toLowerCase(); }
  function duelApi(code) { return ROOT + duelNs(code); }
  function resNs(i) { return BASE + '-res-' + i; }
  function resApi(i) { return ROOT + resNs(i); }
  /* Presence: time-bucketed (5 min) lobby namespaces, sharded when one fills (100 entries). Invites: one namespace per invitee. */
  var BUCKET_MS = 300000;
  function lobBucket(t) { return Math.floor((t || Date.now()) / BUCKET_MS); }
  function lobApi(bucket, shard) { return ROOT + BASE + '-lob-' + bucket + '-' + shard; }
  function invApi(pid) { return ROOT + BASE + '-inv-' + String(pid).toLowerCase(); }
  function pid() {
    var p = store.get('idu-pid');
    if (!p || !/^[a-z0-9]{6,12}$/.test(p)) { p = ''; var cs = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (var i = 0; i < 8; i++) p += cs[Math.floor(Math.random() * cs.length)]; store.set('idu-pid', p); }
    return p;
  }
  var RES_KEY = 'idu-res-idx-' + BASE;
  function resIdx() { var n = parseInt(store.get(RES_KEY), 10); return n >= 1 && n < 500 ? n : 1; }
  function setResIdx(n) { try { store.set(RES_KEY, String(n)); } catch (e) {} }

  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function validSide(x) {
    return x && typeof x.n === 'string' && x.n && typeof x.g === 'string' &&
      Number.isFinite(Number(x.p)) && Number(x.p) >= 0 && Number(x.p) <= 400;
  }
  function validResult(r) {
    return r && validSide(r.a) && validSide(r.b) && (r.w === 'a' || r.w === 'b' || r.w === 'd') && typeof r.t === 'string';
  }
  function gradeNum(g) { return String(g || '').replace(/\D/g, ''); }

  function readBag(j, out, seen) {
    var bag = (j && j.entries) || {};
    Object.keys(bag).forEach(function (k) {
      if (k.indexOf('r-') !== 0) return;
      var v = bag[k];
      if (!validResult(v) || seen[k]) return;
      seen[k] = 1; v.c = k.slice(2); out.push(v);
    });
  }
  async function exportNs(ns) {   // -> {ok, empty, j}
    var r = await fetch(ROOT + 'export/' + ns + '?t=' + Date.now(), { cache: 'no-store' });
    if (r.status === 404) return { ok: true, empty: true };
    if (!r.ok) throw new Error('http ' + r.status);
    var j = await r.json();
    var n = Object.keys((j && j.entries) || {}).length;
    return { ok: true, empty: n === 0, j: j };
  }
  /* Legacy namespace + res-1, res-2, ... until one is empty/missing. */
  async function fetchResults() {
    var out = [], seen = {}, ck = 'idu-board-cache-' + BASE;
    try {
      var lg = await exportNs(NS);
      if (lg.j) readBag(lg.j, out, seen);
      for (var i = 1; i < 200; i++) {
        var x = await exportNs(resNs(i));
        if (x.empty) break;
        readBag(x.j, out, seen);
      }
      try { store.set(ck, JSON.stringify(out.slice(-600))); } catch (e) {}
      return { ok: true, results: out };
    } catch (e) {
      try { return { ok: false, results: JSON.parse(store.get(ck) || '[]') }; } catch (e2) { return { ok: false, results: [] }; }
    }
  }

  function manilaDay(iso) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); } catch (e) { return String(iso).slice(0, 10); }
  }
  function fmtTime(iso) {
    try {
      return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
    } catch (e) { return iso; }
  }
  /* filter: {grade:'all'|'11'|..., from:'YYYY-MM-DD'|'' , to:''} */
  function filterResults(results, f) {
    f = f || {};
    return results.filter(function (r) {
      var d = manilaDay(r.t);
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
      return true;
    });
  }
  function aggregate(results, grade) {
    var map = {};
    results.forEach(function (r) {
      ['a', 'b'].forEach(function (side) {
        var me = r[side], op = r[side === 'a' ? 'b' : 'a'];
        var g = gradeNum(me.g);
        if (grade && grade !== 'all' && g !== grade) return;
        var key = norm(me.n) + '|' + g;
        var p = map[key] || (map[key] = { name: me.n, grade: g, section: me.s || '', wins: 0, losses: 0, draws: 0, duels: 0, pull: 0, last: '' });
        p.duels++; p.pull += Number(me.p) || 0;
        if (r.w === 'd') p.draws++; else if (r.w === side) p.wins++; else p.losses++;
        if (!p.last || r.t > p.last) { p.last = r.t; p.section = me.s || p.section; p.name = me.n; }
      });
    });
    var arr = Object.keys(map).map(function (k) { var p = map[k]; p.rate = p.duels ? p.wins / p.duels : 0; return p; });
    arr.sort(function (x, y) { return y.wins - x.wins || y.rate - x.rate || y.pull - x.pull || x.name.localeCompare(y.name); });
    return arr;
  }
  root.IDBoard = { store: store, NS: NS, API: API, EXPORT: EXPORT, ROOT: ROOT, BUCKET_MS: BUCKET_MS, lobBucket: lobBucket, lobApi: lobApi, invApi: invApi, pid: pid, duelApi: duelApi, resApi: resApi, resIdx: resIdx, setResIdx: setResIdx, fetchResults: fetchResults, aggregate: aggregate, filterResults: filterResults, fmtTime: fmtTime, manilaDay: manilaDay, gradeNum: gradeNum, norm: norm };
})(window);
