/*
 * ハシわたり — ロジック（DOM・時計・localStorage に触れない純粋な計算だけ）
 *
 * 長押しの時間 → 茎の長さ。茎は今の葉の右端から伸び、倒れると右向きに水平になる。
 *   茎の先 tipX = 今の葉の右端 + len
 *   渡る先の葉 target について target.x <= tipX <= target.x + target.w なら渡れる（閉区間）。
 *   |tipX - 葉の中心| <= PERFECT_HALF なら「ぴったり」。連続回数 streak でボーナス min(2^(streak-1), 16)。
 *   落ちたら いのち -1・streak 0。葉の並びは変えない（同じ間にもう一度）。いのち 0 で回が終わる。
 *
 * state はイミュータブル（凍結した新しいオブジェクトと新しい配列を毎回返す）。
 * 乱数は createRun({ random }) で注入し、state に「列挙されない」プロパティとして持ち回る。
 * 葉の作り方は HashiCourse.makeNext（course.js）に任せる。
 *
 * UMD: ブラウザでは window.HashiLogic、Node では module.exports と globalThis.HashiLogic。
 */
(function (root) {
  "use strict";

  const VIEW_W = 1000;        // 見える横幅（論理単位）
  const GROW_PER_MS = 0.5;    // 1ms に伸びる長さ（一定）
  const SLOW_FACTOR = 0.5;    // ゆっくりモードで掛ける
  const MAX_LEN = 800;        // 茎の最大の長さ
  const MIN_HOLD_MS = 60;     // これ未満の押下は無視（うっかりタッチ）
  const PERFECT_HALF = 10;    // ぴったり印の半幅
  const NEAR = 20;            // 落ちたとき、ずれがこれ以下なら「おしい！」
  const CAMERA_LEFT = 200;    // 渡り終えたとき、今の葉の右端を画面左から何単位に置くか
  const LIVES = 3;            // いのちの数
  const BONUS_CAP = 16;       // ぴったりボーナスの上限
  const FIRST_W = 160;        // 最初の葉の幅（x=0 から）
  const SAVE_KEY_BEST = "hashi.best";

  // ---- 茎の長さ ----

  function growSpeed(opts) {
    return GROW_PER_MS * (opts && opts.slow === true ? SLOW_FACTOR : 1);
  }

  // 長さを 0..MAX_LEN に丸める。NaN・負は 0、Infinity は MAX_LEN
  function clampLen(len) {
    const n = Number(len);
    if (Number.isNaN(n) || n <= 0) return 0;
    return n >= MAX_LEN ? MAX_LEN : n;
  }

  function lengthFromHold(holdMs, opts) {
    const h = Number(holdMs);
    if (Number.isNaN(h) || h <= 0) return 0;
    if (h === Infinity) return MAX_LEN;
    return clampLen(h * growSpeed(opts));
  }

  function holdForLength(len, opts) {
    return clampLen(len) / growSpeed(opts);
  }

  // ---- 点数 ----

  function perfectBonus(streak) {
    const s = Number(streak);
    if (!(s > 0)) return 0;                       // 0 以下・NaN
    if (s === Infinity) return BONUS_CAP;
    return Math.min(Math.pow(2, Math.floor(s) - 1), BONUS_CAP);
  }

  function addScore(score, gain) {
    return Math.min(score + gain, Number.MAX_SAFE_INTEGER);
  }

  // ---- コース（course.js）との接続 ----

  function getCourse() {
    let course = root.HashiCourse;
    if (!course && typeof require === "function") {
      try { course = require("./course.js"); } catch (e) {
        throw new Error("HashiLogic: course.js を読み込めませんでした（" + e.message + "）");
      }
    }
    if (!course || typeof course.makeNext !== "function") {
      throw new Error("HashiLogic: HashiCourse.makeNext がありません。course.js を logic.js より先に読み込んでください");
    }
    return course;
  }

  function makeNext(prev, crossed, random) {
    const p = getCourse().makeNext(prev, crossed, random);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.w) || p.w <= 0) {
      throw new Error("HashiLogic: HashiCourse.makeNext が不正な葉を返しました（" + JSON.stringify(p) + "）");
    }
    return Object.freeze({ x: p.x, w: p.w });
  }

  // ---- state ----

  // 凍結した state を作る。random は列挙されないプロパティにして持ち回る
  // （deepStrictEqual や JSON に出ないように。スプレッドでコピーすると落ちるので、更新は必ずこの関数で）
  function makeState(fields, random) {
    const s = {
      platforms: Object.freeze(fields.platforms.slice()),
      score: fields.score,
      crossed: fields.crossed,
      perfects: fields.perfects,
      streak: fields.streak,
      bestStreak: fields.bestStreak,
      lives: fields.lives,
      over: fields.over,
      lastOutcome: fields.lastOutcome
    };
    Object.defineProperty(s, "random", { value: random, enumerable: false });
    return Object.freeze(s);
  }

  function pickRandom(random) {
    if (random === undefined || random === null) return Math.random;
    if (typeof random !== "function") throw new TypeError("HashiLogic: random は関数（0 以上 1 未満を返す）にしてください");
    return random;
  }

  function createRun(opts) {
    const random = pickRandom(opts ? opts.random : undefined);
    const p0 = Object.freeze({ x: 0, w: FIRST_W });
    // platforms[i] は「crossed + i - 1 回渡った時点で渡る先」になる葉。作るときの crossed もそれに合わせる
    const p1 = makeNext(p0, 0, random);
    const p2 = makeNext(p1, 1, random);
    return makeState({
      platforms: [p0, p1, p2],
      score: 0, crossed: 0, perfects: 0, streak: 0, bestStreak: 0,
      lives: LIVES, over: false, lastOutcome: null
    }, random);
  }

  function checkState(state) {
    if (!state || !Array.isArray(state.platforms) || state.platforms.length < 3) {
      throw new TypeError("HashiLogic.resolve: state が不正です（createRun で作った state を渡してください）");
    }
  }

  // opts.random（任意）：state が持つ乱数の代わりに使う（state をコピーして乱数が落ちたときの逃げ道）
  function resolve(state, len, opts) {
    checkState(state);
    if (state.over) return { state, outcome: Object.freeze({ kind: "ignore" }) };

    const random = pickRandom((opts && opts.random) || state.random);
    const L = clampLen(len);
    const [cur, target, after] = state.platforms;
    const tipX = cur.x + cur.w + L;
    const left = target.x, right = target.x + target.w;
    const goalX = target.x + target.w / 2;

    if (tipX >= left && tipX <= right) {
      const perfect = Math.abs(tipX - goalX) <= PERFECT_HALF;
      const streak = perfect ? state.streak + 1 : 0;
      const bonus = perfect ? perfectBonus(streak) : 0;
      const gain = 1 + bonus;
      const score = addScore(state.score, gain);
      const crossed = state.crossed + 1;
      const outcome = Object.freeze({ kind: "cross", tipX, perfect, gain, bonus, landX: right, score, streak });
      const next = makeState({
        platforms: [target, after, makeNext(after, crossed + 1, random)],
        score, crossed,
        perfects: state.perfects + (perfect ? 1 : 0),
        streak,
        bestStreak: Math.max(state.bestStreak, streak),
        lives: state.lives, over: false, lastOutcome: outcome
      }, random);
      return { state: next, outcome };
    }

    const reason = tipX < left ? "short" : "long";
    const missBy = reason === "short" ? left - tipX : tipX - right;
    const lives = Math.max(state.lives - 1, 0);
    const over = lives === 0;
    const outcome = Object.freeze({
      kind: "fall", reason, tipX, missBy, near: missBy <= NEAR,
      score: state.score, lives, over, goalX
    });
    const next = makeState({
      platforms: state.platforms,
      score: state.score, crossed: state.crossed, perfects: state.perfects,
      streak: 0, bestStreak: state.bestStreak,
      lives, over, lastOutcome: outcome
    }, random);
    return { state: next, outcome };
  }

  function hud(state) {
    return Object.freeze({ score: state.score, streak: state.streak, crossed: state.crossed, lives: state.lives });
  }

  // ---- 保存データ ----

  // メニューの readBest と同じ決まり：安全な非負の整数だけ。それ以外は 0
  function validateBest(raw) {
    if (typeof raw !== "string" && typeof raw !== "number") return 0;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
  }

  function recordBest(prevBest, score) {
    const prev = validateBest(prevBest);
    const s = validateBest(score);
    const improved = s > prev;
    return Object.freeze({ best: improved ? s : prev, improved });
  }

  function validateFlag(raw) {
    return raw === "1";
  }

  const api = Object.freeze({
    VIEW_W, GROW_PER_MS, SLOW_FACTOR, MAX_LEN, MIN_HOLD_MS, PERFECT_HALF, NEAR, CAMERA_LEFT, LIVES, BONUS_CAP,
    FIRST_W, SAVE_KEY_BEST,
    lengthFromHold, holdForLength, perfectBonus, createRun, resolve, hud,
    validateBest, recordBest, validateFlag
  });
  root.HashiLogic = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
