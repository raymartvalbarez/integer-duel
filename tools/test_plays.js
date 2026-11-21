/* Unit tests for the 50-game play-count helpers in board.js (no network). */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'board.js'), 'utf8');
const store = {};
const window = {
  localStorage: {
    setItem(k, v) { store[k] = String(v); },
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    removeItem(k) { delete store[k]; }
  }
};
const location = { search: '' };
eval(src);
const B = window.IDBoard;
let bad = 0;
function fail(m) { bad++; console.log('FAIL', m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) fail(m + ' got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

if (B.PLAY_CAP !== 50) fail('PLAY_CAP');
eq(B.playKey('Mr X', 'Grade 7', ' Mabini '), 'mr x|7|mabini', 'playKey norm');
eq(B.playKey('Ana Test', '11', 'HUMSS-T'), B.playKey('  ana   test ', 'Grade 11', 'humss-t'), 'playKey stable');
const id = B.playDocId('Ana Test', '11', 'HUMSS-T');
if (!/^c-[0-9a-z]{7,}$/.test(id)) fail('playDocId shape ' + id);
eq(B.playDocId('Ana Test', '11', 'HUMSS-T'), B.playDocId('ana test', 'Grade 11', 'humss-t'), 'playDocId stable');

const results = [
  { c: 'ABCDE', a: { n: 'Ana Test', g: '11', s: 'HUMSS-T' }, b: { n: 'Ben Test', g: '9', s: 'Newton' } },
  { c: 'FGHIJ', a: { n: 'Ana Test', g: '11', s: 'HUMSS-T' }, b: { n: 'Cara', g: '11', s: 'ACADS' } },
  { c: 'KLMNO', a: { n: 'Other', g: '12', s: 'HUMSS' }, b: { n: 'Ana Test', g: '12', s: 'HUMSS' } }, // different grade/section
  { c: 'ABCDE', a: { n: 'Ana Test', g: '11', s: 'HUMSS-T' }, b: { n: 'Dup', g: '9', s: 'X' } } // same code, no double
];
eq(B.officialPlayIds(results, 'Ana Test', '11', 'HUMSS-T'), ['d-ABCDE', 'd-FGHIJ'], 'official ids for Ana 11');
eq(B.officialPlayIds(results, 'Ana Test', '12', 'HUMSS'), ['d-KLMNO'], 'official ids stay per section/grade');
eq(B.officialPlayIds(results, 'Nobody', '11', 'ACADS'), [], 'unknown learner');

const merged = B.mergePlayIds(
  B.officialPlayIds(results, 'Ana Test', '11', 'HUMSS-T'),
  ['p-abc', 'd-ABCDE', 'p-def'],
  ['p-abc']
);
eq(merged, ['d-ABCDE', 'd-FGHIJ', 'p-abc', 'p-def'], 'merge unique preserves first-seen order');
if (merged.length >= 50) fail('this fixture should be under the cap');

// A learner with 50 official duels is at the cap; history ids are kept.
const fifty = [];
for (let i = 0; i < 50; i++) {
  fifty.push({ c: ('00000' + i).slice(-5), a: { n: 'Max', g: '12', s: 'HUMSS' }, b: { n: 'Opp', g: '11', s: 'ACADS' } });
}
const ids50 = B.officialPlayIds(fifty, 'Max', '12', 'HUMSS');
eq(ids50.length, 50, '50 official games');
if (ids50.length < B.PLAY_CAP) fail('should be at cap');
const plus = B.mergePlayIds(ids50, ['p-extra']);
if (plus.length !== 51) fail('merge still records extras so we can show X / 50 honestly');

console.log('play-count tests: failures', bad);
process.exit(bad ? 1 : 0);
