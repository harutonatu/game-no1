/*
 * ハシわたり — ロジック（DOM・時計・localStorage に触れない純粋な計算だけ）
 *
 * 長押しの時間 → 茎の長さ。茎は今の葉の右端から伸び、倒れると右向きに水平になる。
 *   茎の先 tipX = 今の葉の右端 + len
 *   渡る先の葉 target について target.x <= tipX <= target.x + target.w なら渡れる（閉区間）。
 *   |tipX - 葉の中心| <= PERFECT_HALF なら「ぴったり」。連続回数 streak でボーナス min(2^(streak-1), 16)。
 *   落ちたら いのち -1・streak 0。葉の並びは変えない（同じ間にもう一度）。いのち 0 で回が終わる。
 *   ひとつ飛ばし：渡る先の葉に乗らず、2つ先の葉 after に after.x <= tipX <= after.x + after.w なら、
 *   2つ先へ渡れる（crossed +2、点は 2 + SKIP_BONUS、ぴったりなら perfectBonus も足す）。
 *   ステージ：5 枚ごとの葉に旗（course.js の lastFlag）。旗を越えると checkpoint になり、落ちたらそこから（並びは同じ）。
 *   旗は保存しない（開き直すとステージの最初から）。「さいしょから」は createRun で作り直す。
 *   茎は最大 MAX_LEN（800）で、画面は今の葉の右端から右へ少なくとも VIEW_W - CAMERA_LEFT（800）見えるので、
 *   茎の先が届く所はいつも画面の中（見えない葉には乗れない）。
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
  const SKIP_BONUS = 1;       // ひとつ飛ばし（2つ先の葉へ渡る）のおまけ。2つ分の +2 に足す
  const FIRST_W = 160;        // 最初の葉の幅（x=0 から）
  const SAVE_KEY_BEST = "hashi.best";
  const SAVE_KEY_STAGE = "hashi.stage";
  const STAGE_MAX = 9999;     // ステージの到達の上限（表示が崩れない桁）

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
      lastOutcome: fields.lastOutcome,
      mode: fields.mode === "stage" ? "stage" : "endless",
      stage: fields.mode === "stage" ? fields.stage : 0,
      goal: fields.mode === "stage" ? fields.goal : 0,
      checkpoint: fields.mode === "stage" && fields.checkpoint > 0 ? fields.checkpoint : 0,
      cleared: fields.cleared === true
    };
    Object.defineProperty(s, "random", { value: random, enumerable: false });
    return Object.freeze(s);
  }

  function pickRandom(random) {
    if (random === undefined || random === null) return Math.random;
    if (typeof random !== "function") throw new TypeError("HashiLogic: random は関数（0 以上 1 未満を返す）にしてください");
    return random;
  }

  // ステージの葉の並び（course.js。ステージ番号だけで決まるので、state には持たず毎回作り直す）
  function stageCourse(stage) {
    const c = getCourse();
    if (typeof c.stageCourse !== "function") throw new Error("HashiLogic: HashiCourse.stageCourse がありません（course.js が古い）");
    return c.stageCourse(stage);
  }
  // ステージで crossed 枚渡った時点の葉の窓（今の葉・渡る先・2つ先。ゴールの先は無いので短くなる）
  const stageWindow = (course, crossed) => course.slice(crossed, crossed + 3);
  // 最後の旗（course.js。旗は FLAG_EVERY 枚ごと、ひとつ飛ばしで飛び越えても取ったことにする）
  function lastFlag(crossed, goal) {
    const c = getCourse();
    return typeof c.lastFlag === "function" ? c.lastFlag(crossed, goal) : 0;
  }

  // opts.mode: "endless"（既定、今までどおり平らで続く）| "stage"（opts.stage 番のステージ）
  function createRun(opts) {
    const random = pickRandom(opts ? opts.random : undefined);
    const base = { score: 0, crossed: 0, perfects: 0, streak: 0, bestStreak: 0, lives: LIVES, over: false, lastOutcome: null };
    if (opts && opts.mode === "stage") {
      const stage = validateStage(opts.stage);
      const course = stageCourse(stage);
      return makeState(Object.assign(base, {
        platforms: stageWindow(course, 0), mode: "stage", stage, goal: course.length - 1
      }), random);
    }
    const p0 = Object.freeze({ x: 0, w: FIRST_W });
    // platforms[i] は「crossed + i - 1 回渡った時点で渡る先」になる葉。作るときの crossed もそれに合わせる
    const p1 = makeNext(p0, 0, random);
    const p2 = makeNext(p1, 1, random);
    return makeState(Object.assign(base, { platforms: [p0, p1, p2] }), random);
  }

  function checkState(state) {
    if (!state || !Array.isArray(state.platforms) || state.platforms.length < 1) {
      throw new TypeError("HashiLogic.resolve: state が不正です（createRun で作った state を渡してください）");
    }
  }

  // 茎の根もと (bx, by) から長さ L の茎を、高さ y の面に向けて倒したときの先の x。届かない（L < |高さの差|）なら null。
  // 茎は斜めに倒れ、必要な長さ＝斜めの距離 √(dx² + dy²)。平ら（dy = 0）なら bx + L そのもの
  function reachX(bx, by, L, y) {
    const dy = y - by;
    if (dy === 0) return bx + L;
    if (L < Math.abs(dy)) return null;
    return bx + Math.sqrt(L * L - dy * dy);
  }
  const yOf = (p) => (p && Number.isFinite(p.y) ? p.y : 0);

  // opts.random（任意）：state が持つ乱数の代わりに使う（state をコピーして乱数が落ちたときの逃げ道）
  function resolve(state, len, opts) {
    checkState(state);
    if (state.over || state.cleared || state.platforms.length < 2) return { state, outcome: Object.freeze({ kind: "ignore" }) };

    const random = pickRandom((opts && opts.random) || state.random);
    const stageMode = state.mode === "stage";
    const L = clampLen(len);
    const [cur, target, after] = state.platforms;
    const bx = cur.x + cur.w, by = yOf(cur);
    const left = target.x, right = target.x + target.w;
    const goalX = target.x + target.w / 2;
    const tipT = reachX(bx, by, L, yOf(target));             // 渡る先の高さに倒したときの先
    const tipA = after ? reachX(bx, by, L, yOf(after)) : null; // 2つ先の高さに倒したときの先

    const onTarget = tipT !== null && tipT >= left && tipT <= right;
    const onAfter = !onTarget && !!after && tipA !== null && tipA >= after.x && tipA <= after.x + after.w;
    if (onTarget || onAfter) {
      const land = onTarget ? target : after;
      const tipX = onTarget ? tipT : tipA;
      const tipY = yOf(land);
      const angle = Math.atan2(tipX - bx, tipY - by);          // 0 = 上向き、PI/2 = 右へ水平
      const perfect = Math.abs(tipX - (land.x + land.w / 2)) <= PERFECT_HALF;
      const streak = perfect ? state.streak + 1 : 0;
      const bonus = perfect ? perfectBonus(streak) : 0;
      const skipBonus = onAfter ? SKIP_BONUS : 0;
      const gain = (onAfter ? 2 : 1) + skipBonus + bonus;
      const score = addScore(state.score, gain);
      const crossed = state.crossed + (onAfter ? 2 : 1);
      const cleared = stageMode && crossed >= state.goal;
      // 旗：新しい旗を越えたら、落ちたときの戻り先にする（ゴールに着いたときは旗にしない）
      const checkpoint = stageMode ? Math.max(state.checkpoint, lastFlag(crossed, state.goal)) : 0;
      const flag = stageMode && !cleared && checkpoint > state.checkpoint;
      const outcome = Object.freeze({
        kind: "cross", tipX, tipY, angle, perfect, gain, bonus, skip: onAfter, skipBonus, landX: land.x + land.w, score, streak,
        cleared, stage: state.stage, flag, checkpoint
      });
      let platforms;
      if (stageMode) {
        platforms = stageWindow(stageCourse(state.stage), crossed);
      } else if (onAfter) {
        // platforms[i] は crossed + i - 1 回渡った時点で渡る先（createRun と同じ決まり）
        const n1 = makeNext(after, crossed, random);
        platforms = [after, n1, makeNext(n1, crossed + 1, random)];
      } else {
        platforms = [target, after, makeNext(after, crossed + 1, random)];
      }
      const next = makeState({
        platforms,
        score, crossed,
        perfects: state.perfects + (perfect ? 1 : 0),
        streak,
        bestStreak: Math.max(state.bestStreak, streak),
        lives: state.lives, over: false, lastOutcome: outcome,
        mode: state.mode, stage: state.stage, goal: state.goal, cleared, checkpoint
      }, random);
      return { state: next, outcome };
    }

    // 落ちる：渡る先の高さに届くなら、その高さで倒れた所。届かない（高い葉に短すぎる）なら水平に倒れた所
    const tipX = tipT !== null ? tipT : bx + L;
    const tipY = tipT !== null ? yOf(target) : by;
    const angle = tipT !== null ? Math.atan2(tipX - bx, tipY - by) : Math.PI / 2;
    const reason = tipT === null || tipX < left ? "short" : "long";
    const missBy = reason === "short" ? Math.max(0, left - tipX) : tipX - right;
    // 落ちた所（案内の言葉を選ぶため）：short＝次の葉の手前、long＝次の葉の少し先（NEAR 以内）か2つ先が無い、between＝次と2つ先の間（2つ先から遠い）、
    // aim＝2つ先の少し手前（間の 1/3 か 2×NEAR 以内）、over＝2つ先も越えた
    let zone = reason;
    if (reason === "long" && after && missBy > NEAR) {   // 次の葉の少し先（おしい）は ただの「ながすぎ」
      const ax = tipA !== null ? tipA : tipX;
      const room = after.x - right;   // 次の葉と2つ先の間の距離
      if (ax > after.x + after.w) zone = "over";
      else zone = after.x - ax <= Math.max(2 * NEAR, room / 3) ? "aim" : "between";
    }
    if (stageMode) {
      // ステージ：いのちは減らさず、最後の旗の葉から（旗がまだ無ければ、そのステージの最初から。並びは同じ）
      const from = state.checkpoint > 0 ? state.checkpoint : 0;
      const outcome = Object.freeze({
        kind: "fall", reason, zone, tipX, tipY, angle, missBy, near: missBy <= NEAR,
        score: from ? state.score : 0, lives: state.lives, over: false, goalX, restart: true, from, stage: state.stage
      });
      const next = makeState({
        platforms: stageWindow(stageCourse(state.stage), from),
        score: from ? state.score : 0, crossed: from, perfects: from ? state.perfects : 0, streak: 0, bestStreak: state.bestStreak,
        lives: state.lives, over: false, lastOutcome: outcome,
        mode: "stage", stage: state.stage, goal: state.goal, cleared: false, checkpoint: from
      }, random);
      return { state: next, outcome };
    }
    const lives = Math.max(state.lives - 1, 0);
    const over = lives === 0;
    const outcome = Object.freeze({
      kind: "fall", reason, zone, tipX, tipY, angle, missBy, near: missBy <= NEAR,
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

  // ステージの到達（hashi.stage）：1 以上 STAGE_MAX 以下の安全な整数だけ。それ以外（壊れた値）は 1
  function validateStage(raw) {
    if (typeof raw !== "string" && typeof raw !== "number") return 1;
    if (typeof raw === "string" && !/^\d+$/.test(raw.trim())) return 1;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 1 && n <= STAGE_MAX ? n : 1;
  }
  // ステージ cleared をクリアしたときの新しい到達。前より先に進んだときだけ improved
  function recordStage(prevStage, cleared) {
    const prev = validateStage(prevStage);
    const reach = Math.min(validateStage(cleared) + 1, STAGE_MAX);
    const improved = reach > prev;
    return Object.freeze({ stage: improved ? reach : prev, improved });
  }

  function validateFlag(raw) {
    return raw === "1";
  }

  const api = Object.freeze({
    VIEW_W, GROW_PER_MS, SLOW_FACTOR, MAX_LEN, MIN_HOLD_MS, PERFECT_HALF, NEAR, CAMERA_LEFT, LIVES, BONUS_CAP,
    SKIP_BONUS, FIRST_W, SAVE_KEY_BEST, SAVE_KEY_STAGE, STAGE_MAX,
    lengthFromHold, holdForLength, perfectBonus, createRun, resolve, hud, reachX,
    validateBest, recordBest, validateStage, recordStage, validateFlag
  });
  root.HashiLogic = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
