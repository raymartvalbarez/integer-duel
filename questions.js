/* Integer Duel — seeded integer question generator (Bago NHS · ADM).
 * make(seed, n) returns the SAME n questions, in the SAME order, for the same seed,
 * so both phones in a duel see identical items without sending them over the network.
 * Every item carries an independent check ("ev" expression, "chk" test, or "kind")
 * that tools/test_questions.js re-verifies with eval on thousands of seeds.
 * Topics: add/subtract/multiply/divide signed integers, order of operations,
 * absolute value, comparing/ordering, missing numbers, and word problems
 * (temperature, elevation, money, floors, game points). */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.IDQ = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var MINUS = '\u2212';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function RNG(seed) {
    var r = mulberry32(seed >>> 0);
    var o = {
      f: r,
      int: function (a, b) { return a + Math.floor(r() * (b - a + 1)); },
      nz: function (a, b) { var x = 0, g = 0; while (x === 0 && g++ < 50) x = a + Math.floor(r() * (b - a + 1)); return x || 1; },
      pick: function (arr) { return arr[Math.floor(r() * arr.length)]; },
      shuffle: function (arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
        return a;
      }
    };
    return o;
  }

  function z(n) { return n === 0 ? 0 : n; }              // never -0
  function fmt(n) { n = z(n); return n < 0 ? MINUS + Math.abs(n) : String(n); }
  function par(n) { return n < 0 ? '(' + fmt(n) + ')' : String(n); }
  var OPS = { '+': '+', '-': MINUS, '*': '\u00d7', '/': '\u00f7' };

  /* tokens: numbers, '+','-','*','/','(',')' */
  function rend(t) {
    var s = '';
    for (var i = 0; i < t.length; i++) {
      var x = t[i];
      if (typeof x === 'number') {
        var first = i === 0 || t[i - 1] === '(';
        s += (x < 0 && !first) ? '(' + fmt(x) + ')' : fmt(x);
      } else if (x === '(' || x === ')') s += x;
      else s += ' ' + OPS[x] + ' ';
    }
    return s;
  }
  function evs(t) { return t.map(function (x) { return typeof x === 'number' ? '(' + x + ')' : x; }).join(''); }
  /* wrong-method helpers used only for distractors */
  function lr(t) { // left to right, ignoring precedence (no parens)
    var v = t[0];
    for (var i = 1; i < t.length; i += 2) {
      var o = t[i], n = t[i + 1];
      v = o === '+' ? v + n : o === '-' ? v - n : o === '*' ? v * n : v / n;
    }
    return v;
  }
  function noParens(t) { return t.filter(function (x) { return x !== '(' && x !== ')'; }); }
  function prec(t) { // usual precedence on a flat token list
    var a = [t[0]], ops = [];
    for (var i = 1; i < t.length; i += 2) {
      var o = t[i], n = t[i + 1];
      if (o === '*') a[a.length - 1] *= n;
      else if (o === '/') a[a.length - 1] /= n;
      else { ops.push(o); a.push(n); }
    }
    var v = a[0];
    for (var k = 0; k < ops.length; k++) v = ops[k] === '+' ? v + a[k + 1] : v - a[k + 1];
    return v;
  }

  /* Build 4 distinct numeric options. */
  function numOpts(R, ans, mistakes, f) {
    f = f || fmt;
    var chosen = [ans], seen = {}; seen[z(ans)] = 1;
    function add(m) {
      if (chosen.length >= 4) return;
      if (typeof m !== 'number' || !isFinite(m) || Math.floor(m) !== m) return;
      m = z(m); if (seen[m]) return; seen[m] = 1; chosen.push(m);
    }
    R.shuffle(mistakes).forEach(add);
    R.shuffle([1, -1, 2, -2, 10, -10, 3, -3, 5, -5, 4, -4]).forEach(function (d) { add(ans + d); });
    var opts = R.shuffle(chosen);
    return { o: opts.map(f), k: opts.indexOf(ans) };
  }

  /* ---------- generators ---------- */
  var RANGE = { 1: 9, 2: 30, 3: 99 };
  function genAdd(R, L) {
    var m = RANGE[L], a = R.nz(-m, m), b = R.nz(-m, m);
    if (a > 0 && b > 0) { if (R.f() < 0.5) a = -a; else b = -b; }
    var ans = a + b;
    return {
      p: rend([a, '+', b]) + ' = ?', ev: evs([a, '+', b]), a: ans,
      q: numOpts(R, ans, [a - b, -(a + b), Math.abs(a) + Math.abs(b), b - a])
    };
  }
  function genSub(R, L) {
    var m = RANGE[L], a = R.nz(-m, m), b = R.nz(-m, m);
    if (b > 0 && (L === 1 || a > 0)) b = -b;
    var ans = a - b;
    return {
      p: rend([a, '-', b]) + ' = ?', ev: evs([a, '-', b]), a: ans,
      q: numOpts(R, ans, [a + b, b - a, -(a + b), Math.abs(a) - Math.abs(b)])
    };
  }
  function genMul(R, L) {
    var m = L === 1 ? 9 : L === 2 ? 12 : 15, a = R.nz(-m, m), b = R.nz(-m, m), t, ans;
    if (L === 3 && R.f() < 0.5) {
      var c = R.nz(-5, 5); a = R.nz(-6, 6); b = R.nz(-6, 6);
      t = [a, '*', b, '*', c]; ans = a * b * c;
      return { p: rend(t) + ' = ?', ev: evs(t), a: ans,
        q: numOpts(R, ans, [-ans, a * b + c, a + b + c, Math.abs(ans)]) };
    }
    t = [a, '*', b]; ans = a * b;
    return { p: rend(t) + ' = ?', ev: evs(t), a: ans,
      q: numOpts(R, ans, [-ans, a + b, Math.abs(ans), a - b]) };
  }
  function genDiv(R, L) {
    var m = L === 1 ? 9 : L === 2 ? 12 : 15, b = R.nz(-m, m), q = R.nz(-m, m), a = q * b;
    var t = [a, '/', b];
    return { p: rend(t) + ' = ?', ev: evs(t), a: q,
      q: numOpts(R, q, [-q, Math.abs(q), b, a - b, q + 1, q - 1]) };
  }
  function genOrder(R, L) {
    var a, b, c, d, q, t, ans, wrongs;
    var n = function () { return R.nz(-9, 9); };
    var kinds = L === 2 ? ['a+b*c', 'a-b*c', '(a+b)*c', 'a*b-c', 'a/b+c', '(a-b)/c']
                        : ['(a-b)*(c+d)', 'a-b*c+d', 'a+(b-c)*d', 'a*(b+c)-d', 'a/b-c*d', 'a-(b+c)*d'];
    var k = R.pick(kinds);
    a = n(); b = n(); c = n(); d = n();
    switch (k) {
      case 'a+b*c': t = [a, '+', b, '*', c]; ans = a + b * c; break;
      case 'a-b*c': t = [a, '-', b, '*', c]; ans = a - b * c; break;
      case '(a+b)*c': t = ['(', a, '+', b, ')', '*', c]; ans = (a + b) * c; break;
      case 'a*b-c': t = [a, '*', b, '-', c]; ans = a * b - c; break;
      case 'a/b+c': q = n(); a = q * b; t = [a, '/', b, '+', c]; ans = q + c; break;
      case '(a-b)/c': q = n(); a = b + q * c; t = ['(', a, '-', b, ')', '/', c]; ans = q; break;
      case '(a-b)*(c+d)': t = ['(', a, '-', b, ')', '*', '(', c, '+', d, ')']; ans = (a - b) * (c + d); break;
      case 'a-b*c+d': t = [a, '-', b, '*', c, '+', d]; ans = a - b * c + d; break;
      case 'a+(b-c)*d': t = [a, '+', '(', b, '-', c, ')', '*', d]; ans = a + (b - c) * d; break;
      case 'a*(b+c)-d': t = [a, '*', '(', b, '+', c, ')', '-', d]; ans = a * (b + c) - d; break;
      case 'a/b-c*d': q = n(); a = q * b; t = [a, '/', b, '-', c, '*', d]; ans = q - c * d; break;
      default: t = [a, '-', '(', b, '+', c, ')', '*', d]; ans = a - (b + c) * d;
    }
    var flat = noParens(t);
    wrongs = [lr(flat), prec(flat), -ans, ans + 2, ans - 2];
    return { p: rend(t) + ' = ?', ev: evs(t), a: ans, q: numOpts(R, ans, wrongs) };
  }
  function genAbs(R, L) {
    var a, b, c, t, ans, ev, wrongs;
    if (L === 1) {
      a = R.nz(-20, 20);
      if (R.f() < 0.5) {
        return { p: '|' + fmt(a) + '| = ?', ev: 'Math.abs(' + a + ')', a: Math.abs(a),
          q: numOpts(R, Math.abs(a), [-Math.abs(a), a, -a, 0]) };
      }
      b = R.nz(-20, 20);
      ans = Math.abs(a) + Math.abs(b);
      return { p: '|' + fmt(a) + '| + |' + fmt(b) + '| = ?', ev: 'Math.abs(' + a + ')+Math.abs(' + b + ')', a: ans,
        q: numOpts(R, ans, [a + b, Math.abs(a + b), -ans, Math.abs(a) - Math.abs(b)]) };
    }
    var kind = R.pick(L === 2 ? ['sub', 'neg', 'diff', 'mul'] : ['diff3', 'mix', 'nest']);
    a = R.nz(-30, 30); b = R.nz(-30, 30); c = R.nz(-9, 9);
    if (kind === 'sub') { ans = Math.abs(a) - Math.abs(b); return { p: '|' + fmt(a) + '| ' + MINUS + ' |' + fmt(b) + '| = ?', ev: 'Math.abs(' + a + ')-Math.abs(' + b + ')', a: ans, q: numOpts(R, ans, [Math.abs(a) + Math.abs(b), a - b, Math.abs(a - b), -ans]) }; }
    if (kind === 'neg') { ans = -Math.abs(a); return { p: MINUS + '|' + fmt(a) + '| = ?', ev: '-Math.abs(' + a + ')', a: ans, q: numOpts(R, ans, [Math.abs(a), a, -a, 0]) }; }
    if (kind === 'diff') { ans = Math.abs(a - b); return { p: '|' + rend([a, '-', b]) + '| = ?', ev: 'Math.abs(' + evs([a, '-', b]) + ')', a: ans, q: numOpts(R, ans, [a - b, Math.abs(a) + Math.abs(b), Math.abs(a + b), -(a - b)]) }; }
    if (kind === 'mul') { ans = Math.abs(a) * c; return { p: '|' + fmt(a) + '| \u00d7 ' + par(c) + ' = ?', ev: 'Math.abs(' + a + ')*(' + c + ')', a: ans, q: numOpts(R, ans, [a * c, -ans, Math.abs(a * c), Math.abs(a) + c]) }; }
    if (kind === 'diff3') { ans = Math.abs(a - b) + Math.abs(c); return { p: '|' + rend([a, '-', b]) + '| + |' + fmt(c) + '| = ?', ev: 'Math.abs(' + evs([a, '-', b]) + ')+Math.abs(' + c + ')', a: ans, q: numOpts(R, ans, [a - b + c, Math.abs(a - b + c), Math.abs(a) + Math.abs(b) + Math.abs(c), Math.abs(a - b) - Math.abs(c)]) }; }
    if (kind === 'mix') { ans = Math.abs(a) - Math.abs(b - c); return { p: '|' + fmt(a) + '| ' + MINUS + ' |' + rend([b, '-', c]) + '| = ?', ev: 'Math.abs(' + a + ')-Math.abs(' + evs([b, '-', c]) + ')', a: ans, q: numOpts(R, ans, [Math.abs(a) + Math.abs(b - c), Math.abs(a) - (b - c), a - (b - c), -ans]) }; }
    ans = -Math.abs(a + b) + Math.abs(c); // nest
    return { p: MINUS + '|' + rend([a, '+', b]) + '| + |' + fmt(c) + '| = ?', ev: '-Math.abs(' + evs([a, '+', b]) + ')+Math.abs(' + c + ')', a: ans, q: numOpts(R, ans, [Math.abs(a + b) + Math.abs(c), Math.abs(a + b) - Math.abs(c), -(a + b) + c, Math.abs(c) - (a + b)]) };
  }
  function distinctNums(R, n, lo, hi) {
    var s = {}, out = [], g = 0;
    while (out.length < n && g++ < 500) { var x = R.int(lo, hi); if (!s[x]) { s[x] = 1; out.push(x); } }
    return out;
  }
  function genCmp(R, L) {
    var m = L === 1 ? 10 : L === 2 ? 30 : 50, kind;
    kind = L === 1 ? R.pick(['max', 'min', 'ineq']) : L === 2 ? R.pick(['max', 'min', 'ineq', 'asc']) : R.pick(['asc', 'desc', 'ineq']);
    var nums = distinctNums(R, 4, -m, m), i, srt;
    if (kind === 'max' || kind === 'min') {
      var ans = kind === 'max' ? Math.max.apply(null, nums) : Math.min.apply(null, nums);
      var opts = R.shuffle(nums);
      return { kind: kind, p: 'Which is the ' + (kind === 'max' ? 'greatest' : 'least') + ' integer?', a: ans,
        q: { o: opts.map(fmt), k: opts.indexOf(ans) } };
    }
    if (kind === 'ineq') {
      var stm = [], truthIdx = R.int(0, 3);
      var used = {};
      for (i = 0; i < 4; i++) {
        var x, y, g = 0;
        do { x = R.int(-m, m); y = R.int(-m, m); g++; } while ((x === y || used[x + ',' + y] || used[y + ',' + x]) && g < 100);
        used[x + ',' + y] = 1;
        var truth = i === truthIdx;
        var less = x < y;
        var sym = truth ? (less ? '<' : '>') : (less ? '>' : '<');
        stm.push(fmt(x) + ' ' + sym + ' ' + fmt(y));
      }
      return { kind: 'ineq', p: 'Which statement is TRUE?', a: stm[truthIdx], q: { o: stm, k: truthIdx } };
    }
    // asc / desc lists
    var cnt = L === 3 ? 5 : 4;
    nums = distinctNums(R, cnt, -m, m);
    srt = nums.slice().sort(function (p, q) { return p - q; });
    if (kind === 'desc') srt.reverse();
    var lists = [srt.join('|')], seen = {}; seen[srt.join('|')] = 1;
    function addList(arr) { var key = arr.join('|'); if (!seen[key] && lists.length < 4) { seen[key] = 1; lists.push(key); } }
    var rev = srt.slice().reverse(); addList(rev);
    var byAbs = nums.slice().sort(function (p, q) { return Math.abs(p) - Math.abs(q) || p - q; }); if (kind === 'desc') byAbs.reverse(); addList(byAbs);
    for (var tries = 0; tries < 40 && lists.length < 4; tries++) {
      var sw = srt.slice(), a1 = R.int(0, cnt - 2); var tmp = sw[a1]; sw[a1] = sw[a1 + 1]; sw[a1 + 1] = tmp; addList(sw);
      if (tries > 3) addList(R.shuffle(srt));
    }
    var order = R.shuffle(lists), ansKey = srt.join('|');
    function show(key) { return key.split('|').map(function (s) { return fmt(Number(s)); }).join(', '); }
    return { kind: kind, p: 'Which list is arranged from ' + (kind === 'asc' ? 'least to greatest' : 'greatest to least') + '?', a: ansKey,
      q: { o: order.map(show), k: order.indexOf(ansKey) } };
  }
  function genMissing(R, L) {
    var m = L === 2 ? 15 : 12, a = R.nz(-m, m), x = R.nz(-m, m), kind = R.pick(L === 2 ? ['add', 'sub', 'subr'] : ['mul', 'div', 'add', 'subr']);
    var p, chk, ans = x, wr;
    if (kind === 'add') { var b = x + a; p = '\u25a1 + ' + par(a) + ' = ' + fmt(b); chk = '(X)+(' + a + ')==(' + b + ')'; wr = [b + a, b - a === x ? 0 : -x, a - b, -b]; }
    else if (kind === 'sub') { var b2 = x - a; p = '\u25a1 ' + MINUS + ' ' + par(a) + ' = ' + fmt(b2); chk = '(X)-(' + a + ')==(' + b2 + ')'; wr = [b2 - a, a - b2, -x, b2 + 0 + (-a)]; }
    else if (kind === 'subr') { var b3 = a - x; p = fmt(a) + ' ' + MINUS + ' \u25a1 = ' + fmt(b3); chk = '(' + a + ')-(X)==(' + b3 + ')'; wr = [b3 - a, a + b3, -x, b3 + a]; }
    else if (kind === 'mul') { var b4 = a * x; p = '\u25a1 \u00d7 ' + par(a) + ' = ' + fmt(b4); chk = '(X)*(' + a + ')==(' + b4 + ')'; wr = [-x, b4 - a, b4 + a, a]; }
    else { var b5 = x * a; p = '\u25a1 \u00f7 ' + par(a) + ' = ' + fmt(x); chk = '(X)/(' + a + ')==(' + x + ')'; ans = b5; wr = [x, -b5, x * -a === b5 ? 0 : x + a, a + x]; }
    return { p: 'Find the missing number:  ' + p, chk: chk, a: ans, q: numOpts(R, ans, wr) };
  }

  /* ---- word problems ---- */
  function degC(n) { return fmt(n) + '\u00b0C'; }
  function meters(n) { return fmt(n) + ' m'; }
  function peso(n) { n = z(n); return (n < 0 ? MINUS : '') + '\u20b1' + Math.abs(n); }
  function wordRes(R, p, evx, ans, f, wr) { return { p: p, ev: evx, a: ans, q: numOpts(R, ans, wr, f) }; }
  var PLACES = ['Baguio', 'Tagaytay', 'Sagada', 'Roxas City', 'Mt. Pulag'];
  var NAMES = ['Ana', 'Ben', 'Carla', 'Dino', 'Mica', 'Rey', 'Liza', 'Jun'];
  function genWord(R, L) {
    var kinds = L === 1 ? ['temp1', 'elevdiff', 'floor1', 'buy'] : L === 2 ? ['temp2', 'sub', 'earn', 'points'] : ['temp3', 'sub3', 'share', 'bank', 'points3'];
    var k = R.pick(kinds), nm = R.pick(NAMES), pl = R.pick(PLACES), a, b, c, n, t;
    switch (k) {
      case 'temp1': a = R.int(-8, 10); b = R.int(3, 15); var up = R.f() < 0.5;
        return wordRes(R, 'At dawn in ' + pl + ' the temperature was ' + degC(a) + '. It ' + (up ? 'rose' : 'dropped') + ' by ' + b + '\u00b0C by noon. What is the temperature at noon?',
          evs([a, up ? '+' : '-', b]), up ? a + b : a - b, degC, [up ? a - b : a + b, -(a + b), b - a]);
      case 'elevdiff': a = R.int(20, 90); b = R.int(30, 150);
        return wordRes(R, 'A fish swims at ' + meters(-a) + ' (below sea level) and a bird flies at ' + meters(b) + '. How many meters apart are they?',
          b + '-(' + -a + ')', a + b, function (v) { return v + ' m'; }, [b - a, Math.abs(b - a), -(a + b), a + b + 10]);
      case 'floor1': a = R.int(-4, 3); b = R.int(3, 9); var upf = R.f() < 0.5;
        return wordRes(R, 'An elevator is on floor ' + fmt(a) + ' (negative floors are basements). It goes ' + (upf ? 'up' : 'down') + ' ' + b + ' floors. Which floor is it on now?',
          evs([a, upf ? '+' : '-', b]), upf ? a + b : a - b, fmt, [upf ? a - b : a + b, -(a + b), b - a]);
      case 'buy': a = R.int(100, 300); n = R.int(3, 6); b = R.int(40, 90);
        t = [a, '-', n, '*', b];
        return wordRes(R, nm + ' has ' + peso(a) + ' and buys ' + n + ' items at ' + peso(b) + ' each. What is the balance? (A negative balance means money owed.)',
          evs(t), a - n * b, peso, [a - b, a + n * b, n * b - a, -(a - n * b) === a - n * b ? 0 : a - n * b + b]);
      case 'temp2': a = R.int(-10, 8); b = R.int(4, 14); c = R.int(5, 16);
        return wordRes(R, 'In ' + pl + ' the morning temperature was ' + degC(a) + '. It rose by ' + b + '\u00b0C at noon, then dropped by ' + c + '\u00b0C at night. What is the night temperature?',
          evs([a, '+', b, '-', c]), a + b - c, degC, [a - b - c, a + b + c, a - b + c, -(a + b - c)]);
      case 'sub': a = R.int(40, 150); b = R.int(20, 90); c = R.int(30, 120);
        return wordRes(R, 'A submarine is at ' + meters(-a) + '. It rises ' + b + ' m, then dives ' + c + ' m. What is its new elevation?',
          evs([-a, '+', b, '-', c]), -a + b - c, meters, [-a - b - c, -a + b + c, a + b - c, -a - b + c]);
      case 'earn': a = R.int(100, 400); n = R.int(3, 6); b = R.int(40, 120);
        return wordRes(R, nm + ' owes ' + peso(a) + '. ' + (nm) + ' earns ' + peso(b) + ' each day for ' + n + ' days and puts all of it toward the debt. What is the balance now?',
          evs([-a, '+', n, '*', b]), -a + n * b, peso, [-a - n * b, a + n * b, a - n * b, -a + b]);
      case 'points': a = R.int(2, 5); b = R.int(2, 6); c = R.int(3, 9); n = R.int(2, 9);
        return wordRes(R, 'In a quiz game each correct answer gives +' + c + ' points and each wrong answer gives ' + MINUS + a + ' points. ' + nm + ' got ' + n + ' correct and ' + b + ' wrong. What is the score?',
          evs([n, '*', c, '+', b, '*', -a]), n * c - b * a, fmt, [n * c + b * a, -(n * c - b * a), n * c - a, n + c - b * a]);
      case 'temp3': a = R.int(-12, 6); b = R.int(5, 15); c = R.int(8, 20); var d = R.int(3, 12);
        return wordRes(R, 'At 6 AM in ' + pl + ' it was ' + degC(a) + '. By 10 AM it rose ' + b + '\u00b0C, by 2 PM it dropped ' + c + '\u00b0C, and by 8 PM it dropped another ' + d + '\u00b0C. What was the temperature at 8 PM?',
          evs([a, '+', b, '-', c, '-', d]), a + b - c - d, degC, [a + b - c + d, a - b - c - d, a + b + c - d, -(a + b - c - d)]);
      case 'sub3': a = R.int(60, 200); b = R.int(30, 100); c = R.int(20, 120); var e = R.int(10, 60);
        return wordRes(R, 'A diver starts at ' + meters(-a) + ', swims up ' + b + ' m, dives down ' + c + ' m, then rises ' + e + ' m. What is the diver\u2019s final elevation?',
          evs([-a, '+', b, '-', c, '+', e]), -a + b - c + e, meters, [-a - b - c - e, -a + b + c + e, -a + b - c - e, a - b + c - e]);
      case 'share': n = R.int(3, 8); b = R.int(20, 90);
        return wordRes(R, 'A group debt of ' + peso(n * b) + ' is shared equally among ' + n + ' friends. What is each friend\u2019s balance?',
          '-(' + n * b + ')/(' + n + ')', -b, peso, [b, -n * b, -(b + n), b - n]);
      case 'bank': a = R.int(80, 300); b = R.int(100, 500); c = R.int(30, 200);
        return wordRes(R, nm + '\u2019s account balance is ' + peso(-a) + '. ' + nm + ' deposits ' + peso(b) + ' and then withdraws ' + peso(c) + '. What is the new balance?',
          evs([-a, '+', b, '-', c]), -a + b - c, peso, [-a - b - c, a + b - c, -a + b + c, a - b + c]);
      default: a = R.int(10, 40); b = R.int(3, 7); c = R.int(2, 6); n = R.int(3, 9);
        return wordRes(R, nm + ' starts a game with ' + fmt(-a) + ' points. Each round ' + nm + ' loses ' + c + ' points. After ' + n + ' rounds, what is the score?',
          evs([-a, '-', n, '*', c]), -a - n * c, fmt, [-a + n * c, a - n * c, a + n * c, -a - c]);
    }
  }

  var TIERS = [
    { from: 1, to: 3, pool: [['add', 1], ['sub', 1], ['mul', 1], ['div', 1], ['cmp', 1], ['abs', 1], ['word', 1]] },
    { from: 4, to: 7, pool: [['add', 2], ['sub', 2], ['mul', 2], ['div', 2], ['order', 2], ['abs', 2], ['missing', 2], ['cmp', 2], ['word', 2]] },
    { from: 8, to: 99, pool: [['order', 3], ['word', 3], ['missing', 3], ['abs', 3], ['mul', 3], ['cmp', 3], ['add', 3], ['sub', 3]] }
  ];
  var GEN = { add: genAdd, sub: genSub, mul: genMul, div: genDiv, order: genOrder, abs: genAbs, cmp: genCmp, missing: genMissing, word: genWord };

  function make(seed, n) {
    n = n || 10;
    var R = RNG(seed), out = [], seenP = {};
    for (var r = 1; r <= n; r++) {
      var tier = TIERS[0];
      for (var ti = 0; ti < TIERS.length; ti++) if (r >= TIERS[ti].from && r <= TIERS[ti].to) tier = TIERS[ti];
      var used = out.map(function (q) { return q.t; });
      var avail = tier.pool.filter(function (e) { return used.indexOf(e[0] + e[1]) < 0; });
      if (!avail.length) avail = tier.pool;
      var q = null, g = 0;
      while (g++ < 30) {
        var e = R.pick(avail);
        var cand = GEN[e[0]](R, e[1]);
        if (!cand.q || cand.q.k < 0 || seenP[cand.p]) continue;
        cand.t = e[0] + e[1]; q = cand; break;
      }
      if (!q) { q = genAdd(R, 1); q.t = 'add1'; }
      seenP[q.p] = 1;
      out.push(q);
    }
    return out.map(function (q, i) {
      var o = { i: i + 1, t: q.t, p: q.p, o: q.q.o, k: q.q.k };
      if (q.ev) o.ev = q.ev; if (q.chk) o.chk = q.chk; if (q.kind) o.kind = q.kind; o.a = q.a;
      return o;
    });
  }
  return { make: make, mulberry32: mulberry32 };
});
