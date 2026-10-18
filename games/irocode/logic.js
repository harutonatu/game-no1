/* いろコード ロジック（画面に依存しない純粋な関数だけ）
 * ブラウザ: window.IroCodeLogic ／ Node: require() と globalThis.IroCodeLogic の両方で使える。 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (root) root.IroCodeLogic = api;
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function () {
  "use strict";

  // 6色。色だけに頼らないよう、すべてに形の違う記号を付ける。
  var COLORS = Object.freeze([
    Object.freeze({ name: "あか",   hex: "#e5484d", symbol: "●" }),
    Object.freeze({ name: "あお",   hex: "#3e7bfa", symbol: "▲" }),
    Object.freeze({ name: "きいろ", hex: "#f5c400", symbol: "■" }),
    Object.freeze({ name: "みどり", hex: "#2fa35a", symbol: "◆" }),
    Object.freeze({ name: "むらさき", hex: "#8e5cd9", symbol: "★" }),
    Object.freeze({ name: "ピンク", hex: "#f27bb5", symbol: "♥" })
  ]);
  var NCOLORS = 6;
  var LEN = 4;
  var MAX_TRIES = Object.freeze({ normal: 10, hard: 8 });

  function isColor(n) { return Number.isInteger(n) && n >= 0 && n < NCOLORS; }
  function isCode(a) {
    if (!Array.isArray(a) || a.length !== LEN) return false;
    for (var i = 0; i < LEN; i++) if (!isColor(a[i])) return false;
    return true;
  }
  function hasDup(a) {
    for (var i = 0; i < a.length; i++) for (var j = i + 1; j < a.length; j++) if (a[i] === a[j]) return true;
    return false;
  }
  function maxTries(hard) { return hard ? MAX_TRIES.hard : MAX_TRIES.normal; }

  // hit = 位置も色も正しい数、blow = 色は合っているが位置が違う数（重複は色ごとの最小数で数える）
  function score(guess, secret) {
    var hit = 0, cg = [0, 0, 0, 0, 0, 0], cs = [0, 0, 0, 0, 0, 0], i;
    for (i = 0; i < LEN; i++) {
      if (guess[i] === secret[i]) hit++;
      else { cg[guess[i]]++; cs[secret[i]]++; }
    }
    var blow = 0;
    for (i = 0; i < NCOLORS; i++) blow += Math.min(cg[i], cs[i]);
    return { hit: hit, blow: blow };
  }

  // mulberry32
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeSecret(rand, hard) {
    var out = [], i;
    if (hard) {
      for (i = 0; i < LEN; i++) out.push(Math.min(NCOLORS - 1, Math.floor(rand() * NCOLORS)));
      return out;
    }
    var pool = [0, 1, 2, 3, 4, 5];
    for (i = 0; i < LEN; i++) {
      var j = i + Math.min(NCOLORS - 1 - i, Math.floor(rand() * (NCOLORS - i)));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      out.push(pool[i]);
    }
    return out;
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function todayStr(date) {
    var d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  // 実在する 'YYYY-MM-DD' か
  function isDateStr(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    if (m < 1 || m > 12 || d < 1) return false;
    var dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d <= dim;
  }

  // FNV-1a ＋ 仕上げの攪拌。同じ日付文字列は常に同じ 32bit 符号なし整数。
  function dailySeed(dateStr) {
    var s = "irocode:" + String(dateStr), h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  function randomSeed() {
    try {
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        var a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] >>> 0;
      }
    } catch (e) { /* 使えない環境 */ }
    return Math.floor(Math.random() * 4294967296) >>> 0;
  }

  // 今日の1問は常に「ふつう」（同じ色なし・10回）。むずかしいは れんしゅう だけ。
  function newGame(opts) {
    opts = opts || {};
    var mode = opts.mode === "daily" ? "daily" : "practice";
    var hard = mode === "practice" && opts.hard === true;
    var date = null, seed;
    if (mode === "daily") {
      date = isDateStr(opts.date) ? opts.date : todayStr();
      seed = dailySeed(date);
    } else {
      seed = Number.isInteger(opts.seed) ? (opts.seed >>> 0) : randomSeed();
    }
    return { v: 1, mode: mode, hard: hard, date: date, seed: seed,
      secret: makeSecret(rng(seed), hard), rows: [], cur: [], done: null };
  }

  // 追加の補助（契約外・任意）: 4つそろった cur を確定した新しい state を返す。できなければ null。
  function submitGuess(state, guess) {
    var g = guess || state.cur;
    if (state.done || !isCode(g)) return null;
    var r = score(g, state.secret);
    var rows = state.rows.concat([{ g: g.slice(), hit: r.hit, blow: r.blow }]);
    var done = r.hit === LEN ? "win" : (rows.length >= maxTries(state.hard) ? "lose" : null);
    return { v: 1, mode: state.mode, hard: state.hard, date: state.date, seed: state.seed,
      secret: state.secret.slice(), rows: rows, cur: [], done: done };
  }

  function validateState(x) {
    try {
      if (!x || typeof x !== "object" || x.v !== 1) return null;
      if (x.mode !== "daily" && x.mode !== "practice") return null;
      if (typeof x.hard !== "boolean") return null;
      if (x.mode === "daily" && x.hard) return null;
      if (!Number.isInteger(x.seed) || x.seed < 0 || x.seed > 4294967295) return null;
      if (x.mode === "daily") {
        if (!isDateStr(x.date) || x.seed !== dailySeed(x.date)) return null;
      } else if (x.date !== null) return null;
      if (!isCode(x.secret) || (!x.hard && hasDup(x.secret))) return null;
      var expect = makeSecret(rng(x.seed), x.hard);
      for (var k = 0; k < LEN; k++) if (expect[k] !== x.secret[k]) return null;
      var max = maxTries(x.hard);
      if (!Array.isArray(x.rows) || x.rows.length > max) return null;
      var rows = [], won = false;
      for (var i = 0; i < x.rows.length; i++) {
        var r = x.rows[i];
        if (won || !r || typeof r !== "object" || !isCode(r.g)) return null;
        var s = score(r.g, x.secret);
        if (r.hit !== s.hit || r.blow !== s.blow) return null;
        if (s.hit === LEN) won = true;
        rows.push({ g: r.g.slice(), hit: s.hit, blow: s.blow });
      }
      var done = won ? "win" : (rows.length >= max ? "lose" : null);
      if ((x.done === undefined ? null : x.done) !== done) return null;
      if (!Array.isArray(x.cur) || x.cur.length > LEN) return null;
      for (var c = 0; c < x.cur.length; c++) if (!isColor(x.cur[c])) return null;
      if (done && x.cur.length) return null;
      return { v: 1, mode: x.mode, hard: x.hard, date: x.mode === "daily" ? x.date : null,
        seed: x.seed, secret: x.secret.slice(), rows: rows, cur: x.cur.slice(), done: done };
    } catch (e) { return null; }
  }

  function initialStats() {
    var dist = {};
    for (var i = 1; i <= MAX_TRIES.normal; i++) dist[String(i)] = 0;
    return { played: 0, wins: 0, best: null, dist: dist };
  }
  function isCount(n) { return Number.isInteger(n) && n >= 0 && n <= 1e9; }

  function validateStats(x) {
    try {
      if (!x || typeof x !== "object") return initialStats();
      if (!isCount(x.played) || !isCount(x.wins) || x.wins > x.played) return initialStats();
      var best = x.best === undefined ? null : x.best;
      if (best !== null && !(Number.isInteger(best) && best >= 1 && best <= MAX_TRIES.normal)) return initialStats();
      if (x.wins === 0 && best !== null) return initialStats();
      var out = initialStats(), sum = 0;
      if (x.dist !== undefined) {
        if (!x.dist || typeof x.dist !== "object" || Array.isArray(x.dist)) return initialStats();
        for (var key in x.dist) {
          if (!Object.prototype.hasOwnProperty.call(x.dist, key)) continue;
          if (!Object.prototype.hasOwnProperty.call(out.dist, key) || !isCount(x.dist[key])) return initialStats();
          out.dist[key] = x.dist[key]; sum += x.dist[key];
        }
      }
      if (sum > x.wins) return initialStats();
      out.played = x.played; out.wins = x.wins; out.best = best;
      return out;
    } catch (e) { return initialStats(); }
  }

  // 追加の補助（契約外・任意）: 1ゲームの結果を足した新しい stats を返す。
  function recordStats(stats, win, tries) {
    var s = validateStats(stats);
    s.played++;
    if (win && Number.isInteger(tries) && tries >= 1 && tries <= MAX_TRIES.normal) {
      s.wins++;
      s.dist[String(tries)]++;
      if (s.best === null || tries < s.best) s.best = tries;
    }
    return s;
  }

  // today（'YYYY-MM-DD'）を渡すと、それより未来の日付は受け付けない（端末の時計を進めて遊んだあと戻した場合など）。
  // 日付の文字列は桁がそろっているので、文字列のまま大小を比べられる。家族向けのゲームなので、不正対策はここまで。
  function validateDaily(x, today) {
    try {
      if (!x || typeof x !== "object" || !isDateStr(x.date)) return null;
      if (isDateStr(today) && x.date > today) return null;
      if (typeof x.done !== "boolean" || typeof x.win !== "boolean") return null;
      if (!Number.isInteger(x.tries) || x.tries < 0 || x.tries > MAX_TRIES.normal) return null;
      if (x.win && (!x.done || x.tries < 1)) return null;
      if (x.done && !x.win && x.tries !== MAX_TRIES.normal) return null;
      return { date: x.date, done: x.done, win: x.win, tries: x.tries };
    } catch (e) { return null; }
  }

  return Object.freeze({
    COLORS: COLORS, MAX_TRIES: MAX_TRIES, LEN: LEN,
    score: score, rng: rng, makeSecret: makeSecret, todayStr: todayStr, dailySeed: dailySeed,
    newGame: newGame, validateState: validateState, validateStats: validateStats, validateDaily: validateDaily,
    // 契約外の補助（使わなくてよい）
    isDateStr: isDateStr, maxTries: maxTries, submitGuess: submitGuess, initialStats: initialStats, recordStats: recordStats
  });
});
