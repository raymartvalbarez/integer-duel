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

  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function validSide(x) {
    return x && typeof x.n === 'string' && x.n && typeof x.g === 'string' &&
      Number.isFinite(Number(x.p)) && Number(x.p) >= 0 && Number(x.p) <= 400;
  }
  function validResult(r) {
    return r && validSide(r.a) && validSide(r.b) && (r.w === 'a' || r.w === 'b' || r.w === 'd') && typeof r.t === 'string';
  }
  function gradeNum(g) { return String(g || '').replace(/\D/g, ''); }

  async function fetchResults() {
    var out = [];
    try {
      var r = await fetch(EXPORT + '?t=' + Date.now(), { cache: 'no-store' });
      if (r.status === 404) return { ok: true, results: [] };
      var j = await r.json();
      var bag = (j && j.entries) || {};
      var seen = {};
      Object.keys(bag).forEach(function (k) {
        if (k.indexOf('r-') !== 0) return;
        var v = bag[k];
        if (!validResult(v) || seen[k]) return;
        seen[k] = 1; v.c = k.slice(2); out.push(v);
      });
      try { store.set('idu-board-cache-' + NS, JSON.stringify(out.slice(-300))); } catch (e) {}
      return { ok: true, results: out };
    } catch (e) {
      try { return { ok: false, results: JSON.parse(store.get('idu-board-cache-' + NS) || '[]') }; } catch (e2) { return { ok: false, results: [] }; }
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
  root.IDBoard = { store: store, NS: NS, API: API, EXPORT: EXPORT, fetchResults: fetchResults, aggregate: aggregate, filterResults: filterResults, fmtTime: fmtTime, manilaDay: manilaDay, gradeNum: gradeNum, norm: norm };
})(window);
