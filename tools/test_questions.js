const IDQ = require('../questions.js');
const num = s => Number(s.replace(/\u2212/g, '-').replace(/[^0-9\-]/g, ''));
let bad = 0, total = 0; const prompts = new Set(); const types = {}; const levels = { 1: 0, 2: 0, 3: 0 };
function fail(m, q, seed) { bad++; if (bad < 20) console.log('FAIL', seed, m, q && JSON.stringify({ t: q.t, p: q.p, o: q.o, k: q.k, ev: q.ev, chk: q.chk, kind: q.kind })); }
const DUELS = 10000;
for (let seed = 1; seed <= DUELS; seed++) {
  const key = seed * 7919;
  const qs = IDQ.make(key, 10);
  const again = IDQ.make(key, 10);
  if (JSON.stringify(qs) !== JSON.stringify(again)) fail('nondeterministic', qs[0], seed);
  if (qs.length !== 10) fail('not 10 items', qs[0], seed);
  const seen = new Set();
  const split = { 1: 0, 2: 0, 3: 0 };
  qs.forEach((q, i) => {
    total++; prompts.add(q.p); types[q.t] = (types[q.t] || 0) + 1;
    const L = q.L || Number(String(q.t).replace(/\D/g, '').slice(-1));
    split[L] = (split[L] || 0) + 1; levels[L] = (levels[L] || 0) + 1;
    const expect = i < 5 ? 1 : i < 8 ? 2 : 3;
    if (L !== expect) fail('split slot ' + (i + 1) + ' want L' + expect + ' got L' + L, q, seed);
    if (seen.has(q.p)) fail('duplicate in duel', q, seed);
    seen.add(q.p);
    if (q.o.length !== 4 || new Set(q.o).size !== 4) return fail('options not 4 distinct', q, seed);
    if (!(q.k >= 0 && q.k < 4)) return fail('bad k', q, seed);
    if (q.o.some(s => /(^|[^0-9])-0\b|(^|[^\d])\u22120\b/.test(s))) return fail('minus zero', q, seed);
    if (q.ev) { const v = eval(q.ev); if (!Number.isInteger(v)) return fail('non-integer', q, seed); if (num(q.o[q.k]) !== v) return fail('ev mismatch ' + v, q, seed); q.o.forEach((o, i) => { if (i !== q.k && num(o) === v) fail('dup correct', q, seed); }); }
    else if (q.chk) { const t = q.o.map(o => eval(q.chk.replace(/X/g, '(' + num(o) + ')'))); if (t.filter(Boolean).length !== 1 || !t[q.k]) fail('chk mismatch', q, seed); }
    else if (q.kind === 'max' || q.kind === 'min') { const v = q.o.map(num); const e = q.kind === 'max' ? Math.max(...v) : Math.min(...v); if (v[q.k] !== e) fail('maxmin', q, seed); }
    else if (q.kind === 'ineq') { const t = q.o.map(s => { const m = s.match(/^(\S+) ([<>]) (\S+)$/); const a = num(m[1]), b = num(m[3]); return m[2] === '<' ? a < b : a > b; }); if (t.filter(Boolean).length !== 1 || !t[q.k]) fail('ineq', q, seed); }
    else if (q.kind === 'asc' || q.kind === 'desc') { const t = q.o.map(s => { const v = s.split(', ').map(num); return v.every((x, i) => i === 0 || (q.kind === 'asc' ? v[i - 1] < x : v[i - 1] > x)); }); if (t.filter(Boolean).length !== 1 || !t[q.k]) fail('order list', q, seed); }
    else fail('no check', q, seed);
  });
  if (split[1] !== 5 || split[2] !== 3 || split[3] !== 2) fail('split counts ' + JSON.stringify(split), qs[0], seed);
}
const bank = IDQ.bankSize();
console.log('duels checked:', DUELS, 'questions checked:', total, 'distinct prompts:', prompts.size, 'failures:', bad);
console.log('curated bank:', bank);
console.log('level totals:', levels, 'share:', {
  easy: +(levels[1] / total).toFixed(3),
  average: +(levels[2] / total).toFixed(3),
  difficult: +(levels[3] / total).toFixed(3)
});
console.log(types);
process.exit(bad ? 1 : 0);
