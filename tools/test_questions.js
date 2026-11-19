const IDQ = require('../questions.js');
const num = s => Number(s.replace(/\u2212/g, '-').replace(/[^0-9\-]/g, ''));
let bad = 0, total = 0; const prompts = new Set(); const types = {};
function fail(m, q, seed) { bad++; if (bad < 15) console.log('FAIL', seed, m, JSON.stringify(q)); }
for (let seed = 1; seed <= 4000; seed++) {
  const qs = IDQ.make(seed * 7919, 10);
  const again = IDQ.make(seed * 7919, 10);
  if (JSON.stringify(qs) !== JSON.stringify(again)) fail('nondeterministic', qs[0], seed);
  qs.forEach(q => {
    total++; prompts.add(q.p); types[q.t] = (types[q.t] || 0) + 1;
    if (q.o.length !== 4 || new Set(q.o).size !== 4) return fail('options not 4 distinct', q, seed);
    if (!(q.k >= 0 && q.k < 4)) return fail('bad k', q, seed);
    if (q.o.some(s => /-0\b|\u22120\b/.test(s) && !/\d\d/.test(s))) return fail('minus zero', q, seed);
    if (q.ev) { const v = eval(q.ev); if (!Number.isInteger(v)) return fail('non-integer', q, seed); if (num(q.o[q.k]) !== v) return fail('ev mismatch ' + v, q, seed); q.o.forEach((o, i) => { if (i !== q.k && num(o) === v) fail('dup correct', q, seed); }); }
    else if (q.chk) { const t = q.o.map(o => eval(q.chk.replace(/X/g, '(' + num(o) + ')'))); if (t.filter(Boolean).length !== 1 || !t[q.k]) fail('chk mismatch', q, seed); }
    else if (q.kind === 'max' || q.kind === 'min') { const v = q.o.map(num); const e = q.kind === 'max' ? Math.max(...v) : Math.min(...v); if (v[q.k] !== e) fail('maxmin', q, seed); }
    else if (q.kind === 'ineq') { const t = q.o.map(s => { const m = s.match(/^(\S+) ([<>]) (\S+)$/); const a = num(m[1]), b = num(m[3]); return m[2] === '<' ? a < b : a > b; }); if (t.filter(Boolean).length !== 1 || !t[q.k]) fail('ineq', q, seed); }
    else if (q.kind === 'asc' || q.kind === 'desc') { const t = q.o.map(s => { const v = s.split(', ').map(num); return v.every((x, i) => i === 0 || (q.kind === 'asc' ? v[i - 1] < x : v[i - 1] > x)); }); if (t.filter(Boolean).length !== 1 || !t[q.k]) fail('order list', q, seed); }
    else fail('no check', q, seed);
  });
}
console.log('questions checked:', total, 'distinct prompts:', prompts.size, 'failures:', bad);
console.log(types);
process.exit(bad ? 1 : 0);
