/*
 * ちきゅうを守れ！ほしくだき — ロジック（DOM・Date・performance・Math.random・localStorage に触れない純粋な計算だけ）
 * リニューアル（2 回目の作り直し、2026-11-09）：画面より大きな線画の小惑星のまわりを、自機が自動で飛びながら削る。時間切れで負け。
 * 約束：docs/plans/asteroid-renew.md（§1・§5.1・§6・§8）と docs/asteroid-contract.md §23（ユーザー決定）。§1〜§22 の古い決めとぶつかる所は計画書が正。
 * 担当A（ロジック）だけが編集する。
 *
 * UMD: ブラウザでは window.AsteroidLogic、Node では module.exports。
 *
 * 中の作り：
 *   - 公開する関数は、受け取った state を書き換えない（毎回新しいオブジェクトを返す）。凍らせた state でも動く。
 *     マスの配列は、その step で変わったときだけ写す（コピーオンライト。rock.hp は当たった step、rock.mats・rock.dirty は欠けた step）。
 *     中では「state を書き換える」関数（stepMut など）を使い、自動プレイはそれを直接まわす（速さのため）。
 *   - 例外は外へ出さない（おかしな引数は null か { ok:false, reason }）。
 *   - 乱数は mulberry32。state.rng に 32bit の状態を持つ（2択の候補だけに使う）。
 *     星の形は (seed, 星の番号) から決まる別の乱数で作る（やり直しで同じ形）。自機の向きを変える時・いなずまの枝の順は (seed, 時刻) のハッシュ。
 *   - 世界の座標：格子の原点は (0,0)。マス i（c = i % w, r = floor(i / w)）の中心は ((c+0.5)·CELL, (r+0.5)·CELL)。y は下向き。
 *   - ship.ang は進む向き（ラジアン。atan2(vy, vx) の向き：0 が右、π/2 が下）。fire の ang も同じ向き（自機から的へ）。
 *   - ふちのマスの一覧・てつのマスの一覧などは state に入れず、mats の配列をキーにした WeakMap（GEO）に持つ（変わったマスだけ直す）。
 *   - 計画書 §5.1 の state の形に、次の欄を足している（logic の中のもの。保存しない。画面は使わなくてよい）：
 *       wait  … 'clear' の残りの秒
 *       back  … 'choose' を閉じたあとに戻る phase（'fly'・'lost'・'clear'・'end'）
 *       ship.orb  … 今の向きで小惑星の重心（rock.cx・cy）のまわりを回った角度（ラジアン。進む向きが +。引き返すと減る）
 *       ship.laps … 何周したら回る向きを変えるか（ORBIT_LAPS の 2〜3。種と時刻から決まる）
 *       rock.key  … 星の番号 × 10000 ＋ 挑戦の回数（新しい星・やり直しで変わる。描画が作り直しに気づく目印）
 *       rock.cx・rock.cy … 残っているマスの重心（世界の座標。カメラの向きの目安）
 *       shots[] の弾には、どかん用の着地点（tc・tr：格子の座標）・ほのおのねらい（aim）・たまの通りぬけ（p・h）などを足している
 *       burns[] には at・spread（となりの こおり へ広げたか）を足している
 *   - rock.dirty は「前に [] にしてから変わったマスの添字」をためていく（描画が読んだら [] にしてよい）。マスの数をこえたら
 *     全部の添字（0〜w·h−1）の一覧にする（描画は全部を塗り直せばよい）。rock.gen はマスが欠けた step ごとに 1 増える。
 *   - offer は 2択なら [idA, idB]、残りの武器が 1 つだけのときは [id]（長さ 1）。
 *   - エンディング（phase 'end'）では星はもう 31 に進み、cleared は true。step は進まない。
 *     「このまま あそぶ」は loadSave(makeSave(state)) で星 31 の最初から fly になる。
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AsteroidLogic = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : null, function () {
  "use strict";

  // ---------------------------------------------------------------- 定数（計画書 §1・§5.1）
  const NAME = "ちきゅうを守れ！ほしくだき";
  const CELL = 8;                       // 1 マスの大きさ（世界の単位）
  const STANDOFF = 5;                   // 自機がふちから離れるマスの数
  const SHIP_SPEED = 70;                // 自機の速さ（単位/秒）
  const RANGE = 18;                     // 弾が届く距離（マス）。それより遠いマスはねらわない
  const DEG = Math.PI / 180;
  const SHIP_TURN = 240 * DEG;          // 自機が向きを変える速さの上限（ラジアン/秒）
  // まわる向き：小惑星の重心のまわりを ORBIT_LAPS[0]〜[1] 周（種で決める）回ったら向きを変える（ユーザー「何周かごとに向きを変える」2026-11-10）。
  // 周は角度の積み上げで数える（引き返すと減る。重心から ORBIT_NEAR マスより近い所では数えない）
  const ORBIT_LAPS = deepFreeze([2, 3]), ORBIT_NEAR = 2, TAU = 2 * Math.PI;
  // 星の大きさ（半径のマス）：星 1 で R_BASE、星ごとに R_STEP ずつ、上限 R_MAX。ボス（BOSS_EVERY の倍数）は BOSS_SIZE 倍・BOSS_HARD 倍の重さ
  const R_BASE = 36, R_STEP = 28 / 49, R_MAX = 64, BOSS_EVERY = 10, BOSS_SIZE = 1.25, BOSS_HARD = 1.3;
  const GRID_MAX = 2 * R_MAX + 4;       // 格子の一辺の最大（132）
  // でこぼこの丸：半径 × (SHAPE.base + SHAPE.amp × ゆらぎ)、くぼみ（クレーター）を SHAPE.craters 個
  const SHAPE = deepFreeze({ base: 0.9, amp: 0.08, craters: [2, 4], crater: [0.1, 0.2] });
  // 星の体力の合計・かけらの合計の目安は、星の大きさによらない（マス 1 つの体力・かけらは 面積の目安 で割る）。
  // 面積の目安 = AREA_FILL × π × 半径²（AREA_FILL は形を作ったときのマスの割合の平均）
  const AREA_FILL = 0.79;
  // ひかり（マス 5）：ふちから GLOW.near マス以内に、GLOW.min〜GLOW.max マスのかたまりで GLOW.fewest〜GLOW.most か所。奥（GLOW.deepFrom〜deepTo マス）にも GLOW.deep か所。
  // どれか 1 マスが壊れると、つながった ひかり が全部まとめて砕け、かけら × GLOW.mul
  const GLOW = deepFreeze({ near: 4, min: 4, max: 12, fewest: 6, most: 20, per: 600, deep: 2, deepFrom: 6, deepTo: 16, mul: 3 });
  const BOLT_CELLS = 16, BEAM_W = 2, BEAM_DEPTH = 20;
  // たまの伸び（Lv 11 から）：x = (Lv − 10) ÷ 89（0〜1）。撃つ間隔 = RATE ÷ (1 + rate × x)、強さ × (1 + dmg × x)。pierce の Lv ごとに 貫通 +1（威力 × keep）
  const SHOT_UP = deepFreeze({ from: 10, rate: 0.8, dmg: 0.2, keep: 0.3, pierce: [20, 40, 60, 80, 99] });
  // いなずまは どの種類のマスへも伝わる。1 マス伝わるごとに威力 ×（てつ へ 0.95、ほかへ 0.8）。BOLT_MIN 未満になる先へは伝わらない
  const BOLT_KEEP = deepFreeze({ iron: 0.95, other: 0.8 }), BOLT_MIN = 0.3;
  // どかん の円の中心を、ねらった縁のマスから星の内側（円の中の残っているマスの重心の向き）へ 半径 × BOMB_SHIFT ずらす
  const BOMB_SHIFT = 0.5;
  // 星 1 の体力の合計（ぜんぶ いわ のとき）・かけらの合計の目安
  const STAR_HP = 200000, STAR_VALUE = 70;
  const VALUE_GROWTH = 1.77, UP_GROWTH = 1.35, LEVEL_MAX = 99, SLOTS_MAX = 4;
  // ハード（段 tier 1 以上。計画書 §1.7）のかけらの増え方（通しの番号 30·tier + 星 ごとに × VALUE_GROWTH2）
  const VALUE_GROWTH2 = 1.03;
  // ハードの体力：段 t の星 n は HP_TABLE[29] × hp × tierUp^(min(t, tierMax) − 1) × grow^(n − 1)（ボスと傾きの adj は別）。
  // 武器の Lv は 99 で止まり、ふつうの星 30 のころに強さがほぼ上まで来ているので、段ごとに少しだけ重くして tierMax で止める（どこかで詰まらない）。
  // ひかり の かたまりの数は段 1 で 1/2・段 2 で 1/4・段 3 から 1/8（最低 1 か所）
  const HARD = deepFreeze({ hp: 1.22, tierUp: 1.1, tierMax: 3, grow: 1.0, glow: [1, 0.5, 0.25, 0.125] });
  const TIER_MAX = 300;
  // 最初の星だけ、かけらを多めにする（星 1・2。はじめの買い物を早くして、強くした分の速さが見えるように＝何もしないと間に合わない）
  const EARLY_VALUE = deepFreeze([3, 1.5]);
  // 星 1〜30 の体力の倍率（STAR_HP に掛ける。ボスの重さ・傾きのならし adj は別に掛ける）。greedy の自動プレイ（種 1〜4 の中央）で、
  // 星 1〜3 が 3.5 分・ふつうの星 4 分・ボス 5 分になるように測って決めた（計画書 §6）。ハード（段 1 から）は HARD
  const HP_TABLE = deepFreeze([0.0176,0.0508,0.0788,0.2,0.31,0.29,0.332,0.58,0.952,1.19,1.33,1.5,2.19,3.6,4.48,4.85,4.87,7.31,8.42,13.1,14.8,15.5,19.3,26,35.5,34.7,39.8,43.8,60.2,75.4,86.2,90.4,104,127,155,203,212,234,327,362,454,472,533,760,816,1040,1070,1130,1290,1310]);
  // マスの混ざり方：てつ（星 3〜9・10〜）、こおり（星 6〜）、星ごとの傾き（てつ多め／こおり多め）
  const MIX = deepFreeze({ iron: [0.25, 0.35], ice: 0.15, tilt: 0.08 });
  const MILESTONE_BONUS = 0.03, MILESTONES = deepFreeze([25, 50, 75]);
  const BEST_MAX = 200;
  const CLEAR_BONUS = 0.2, ENDING_STAR = 50, HARD_STARS = 30, STAR_MAX = 9999, STAR_CALC_MAX = 400, KAKERA_MAX = 9e15;
  const SHOTS_MAX = 120, STEP = 1 / 30;
  const SAVE_VERSION = 3, SAVE_KEY = "asteroid.save", SAVE_KEY_BAK = "asteroid.save.bak", SAVE_KEY_BEST = "asteroid.best", SAVE_KEY_HELP = "asteroid.help", SAVE_KEY_V3 = "asteroid.v3";

  const BULLET_SPEED = 600;      // たま・ちらし・ほのお の弾
  const BULLET_LIFE = 0.5;       // 弾が消えるまでの秒（届く距離の 2 倍くらい）
  const CARRY_MIN = 0.02;        // 余った力がはじめの強さのこの割合より小さくなったら弾は消える
  const BOMB_FLIGHT = 0.6;       // どかん の山なりの秒
  const BEAM_SEC = 0.4;          // ビームの見た目の秒（当たりは撃った瞬間）
  const CLEAR_SEC = 1.5;
  const BURN_SPREAD_SEC = 0.5;
  const EVOLVE_EVERY = 10, EVOLVE_TIERS = 3;
  const TRIES_MAX = 9999;
  // ねらい：ビームは 4° ごと（±60°）、どかんは届くふちのマスを 3 マスおき
  const BEAM_SCAN_DEG = 4, BEAM_SCAN_MAX = 60 * DEG, BOMB_EVERY = 3;
  const IRON_BLOB_MIN = 40;
  // 時間切れ（計画書 §1.3）：limit(n) = LIMIT_BASE（greedy でかかる秒の目安）× 倍率。倍率は星 1〜3 で first、星 lateFrom から late、その間はまっすぐ下げる
  const LIMIT_MUL = deepFreeze({ first: 1.8, firstStars: 3, late: 1.25, lateFrom: 10 });
  // やり直すたびに残り時間を少し足す（2 回目の挑戦から +step ずつ、最大 +max）。Lv99 で止まったあとも、どの武器の組み合わせでもいつかは間に合う
  const RETRY_EASE = deepFreeze({ step: 0.1, max: 1.0 });
  const LIMIT_BASE = deepFreeze({ first: 210, normal: 240, boss: 300, hard: 300, hardBoss: 400 });

  // ---------------------------------------------------------------- 表
  const MAT_IDS = ["rock", "iron", "ice", "gold", "glow"];        // コード 1〜5（0 は空）
  const MATS = deepFreeze([
    { id: "rock", code: 1, name: "いわ", from: 1 },
    { id: "iron", code: 2, name: "てつ", from: 3 },
    { id: "ice", code: 3, name: "こおり", from: 6 },
    { id: "gold", code: 4, name: "きん", from: 8 },
    { id: "glow", code: 5, name: "ひかり", from: 1 }
  ]);
  const MAT_HP = deepFreeze({ rock: 1, iron: 4, ice: 2, gold: 2, glow: 1 });
  const MAT_VALUE = deepFreeze({ rock: 1, iron: 4, ice: 2, gold: 10, glow: 2 });

  const WEAPONS = deepFreeze([
    { id: "shot", name: "たま", dmg: 1, rate: 0.20, good: null, aff: {}, desc: "いちばん ちかい マスへ まっすぐ うつ" },
    { id: "spread", name: "ちらし", dmg: 1.25, rate: 0.6, good: "rock", aff: { rock: 2, iron: 0.9 }, desc: "おうぎの かたちに 5はつ ちらす" },
    { id: "bomb", name: "どかん", dmg: 0.75, rate: 1.6, good: "ice", aff: { ice: 2 }, desc: "おちた ところの まわりを まとめて こわす" },
    { id: "bolt", name: "いなずま", dmg: 0.8, rate: 1.2, good: "iron", aff: { iron: 2.2, ice: 0.5 }, desc: "つながった マスへ えだわかれ。てつは とおくまで とどく" },
    { id: "beam", name: "ビーム", dmg: 0.375, rate: 2.0, good: "iron", aff: { iron: 1.8 }, desc: "まっすぐ おくまで あなを あける" },
    { id: "fire", name: "ほのお", dmg: 3, rate: 1.0, good: "ice", aff: { ice: 3, iron: 0.75 }, desc: "もやして となりの こおりへ ひろがる" }
  ]);
  const W = {};
  for (const w of WEAPONS) W[w.id] = w;
  const W_IDS = WEAPONS.map((w) => w.id);

  // しんか（Lv 10・20・30）で変わる形。value(tier) = base + add × tier
  const EVOLVE = deepFreeze({
    shot: { key: "count", base: 1, add: 1, unit: "れん" },
    spread: { key: "count", base: 5, add: 2, unit: "はつ" },
    bomb: { key: "radius", base: 3, add: 1, unit: "マス" },
    bolt: { key: "cells", base: BOLT_CELLS, add: 8, unit: "マス" },
    beam: { key: "width", base: BEAM_W, add: 2, unit: "マス" },
    fire: { key: "sec", base: 3, add: 1, unit: "びょう" }
  });

  const UP_COST = deepFreeze({ shot: 5, spread: 5, bomb: 34, bolt: 5, beam: 8, fire: 4 });
  // n 個目の武器の値段（[1] が 2 つ目。4 つ目までは枠、5・6 つ目は ひかえ）
  const SLOT_COST = deepFreeze([null, 40, 300, 2000, 500000, 1.5e9]);

  // ---------------------------------------------------------------- 小さな道具
  function deepFreeze(o) {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) deepFreeze(o[k]);
    }
    return o;
  }
  const isNum = (x) => typeof x === "number" && Number.isFinite(x);
  const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const capK = (x) => (x > KAKERA_MAX ? KAKERA_MAX : x < 0 ? 0 : Math.floor(x));

  function hash2(a, b) {
    let h = (Math.imul(a >>> 0, 0x9e3779b1) ^ Math.imul((b >>> 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x21f0aaad) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x735a2d97) >>> 0;
    h ^= h >>> 15;
    return h >>> 0;
  }
  function mbNext(st) {
    let t = (st + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return { st: t, v: ((r ^ (r >>> 14)) >>> 0) / 4294967296 };
  }
  function makeRng(seed) {
    let st = seed >>> 0;
    return function () { const o = mbNext(st); st = o.st; return o.v; };
  }
  function rngOf(s) { const o = mbNext(s.rng >>> 0); s.rng = o.st; return o.v; }

  // 1 step に調べたマスの数の目安（simulate が最大を記録する）
  let CELLS = 0;

  // ---------------------------------------------------------------- 式
  function calcN(n) { return clamp(Math.floor(isNum(n) ? n : 1), 1, STAR_CALC_MAX); }
  function growMul(n, g1, g2) {
    const k = calcN(n);
    return k <= ENDING_STAR ? Math.pow(g1, k - 1) : Math.pow(g1, ENDING_STAR - 1) * Math.pow(g2, k - ENDING_STAR);
  }
  function starNum(n) { return isNum(n) && n >= 1 ? Math.min(Math.floor(n), STAR_MAX) : 1; }
  // 体力の倍率（星の体力の合計 ÷ STAR_HP の目安）：増え方 × 最初の星のやさしさ × ボスの重さ × 傾きのならし
  // 段と星から通しの番号へ：N = 30·tier + n（n が 30 より大きいときは、n を通しの番号として読む）。t は段、k は段の中の星（1〜30）
  // 段 t の星の数（段 0 は ENDING_STAR、段 1 から HARD_STARS）と、通しの番号
  function starsOf(t) { return tierOk(t) === 0 ? ENDING_STAR : HARD_STARS; }
  function numMax() { return ENDING_STAR + HARD_STARS * TIER_MAX; }
  function numIn(star, tier) { const t = tierOk(tier); return t === 0 ? star : ENDING_STAR + HARD_STARS * (t - 1) + star; }
  function tierOk(t) { return isNum(t) && t >= 0 ? Math.min(Math.floor(t), TIER_MAX) : 0; }
  function split(n, tier) {
    const n1 = isNum(n) && n >= 1 ? Math.min(Math.floor(n), STAR_MAX) : 1, t0 = tierOk(tier);
    const N = Math.min(t0 === 0 ? n1 : ENDING_STAR + HARD_STARS * (t0 - 1) + n1, numMax());
    if (N <= ENDING_STAR) return { t: 0, k: N, N };
    const t = 1 + Math.floor((N - ENDING_STAR - 1) / HARD_STARS);
    return { t, k: N - ENDING_STAR - HARD_STARS * (t - 1), N };
  }
  function hpBase(t, k) {
    if (t === 0) return HP_TABLE[k - 1];
    return HP_TABLE[ENDING_STAR - 1] * HARD.hp * Math.pow(HARD.tierUp, Math.min(t, HARD.tierMax) - 1) * Math.pow(HARD.grow, k - 1);
  }
  function hpMul(n, tier) { const q = split(n, tier); return hpBase(q.t, q.k) * dimsOf(q.k, q.t).adj; }
  function valMul(n, tier) { const q = split(n, tier); return growMul(q.N, VALUE_GROWTH, VALUE_GROWTH2) * (q.N <= EARLY_VALUE.length ? EARLY_VALUE[q.N - 1] : 1) * dimsOf(q.k, q.t).adj; }
  function matOf(code) { return MAT_IDS[code - 1] || null; }
  // マス 1 つの満タンの体力・かけら（端数こみ。かけらは addK で端数をためて足す）
  function cellHp(n, mat, tier) { if (!MAT_HP[mat]) return null; const q = split(n, tier); return STAR_HP * hpMul(q.k, q.t) * MAT_HP[mat] / dimsOf(q.k, q.t).area; }
  function cellValue(n, mat, tier) { if (!MAT_VALUE[mat]) return null; const q = split(n, tier); return STAR_VALUE * valMul(q.k, q.t) * MAT_VALUE[mat] / dimsOf(q.k, q.t).area; }
  function lvOk(L) { return isNum(L) ? clamp(Math.floor(L), 1, LEVEL_MAX) : 1; }
  function shotUp(L) { return L <= SHOT_UP.from ? 0 : (L - SHOT_UP.from) / (LEVEL_MAX - SHOT_UP.from); }
  function dmg(w, L) {
    if (!W[w]) return null;
    L = lvOk(L);
    const up = w === "shot" ? 1 + SHOT_UP.dmg * shotUp(L) : 1;
    return W[w].dmg * (1 + 0.25 * (L - 1)) * Math.pow(2, Math.floor(L / EVOLVE_EVERY)) * up;
  }
  function rateOf(w, L) { L = lvOk(L); return w === "shot" ? W[w].rate / (1 + SHOT_UP.rate * shotUp(L)) : W[w].rate; }
  function pierceOf(L) { L = lvOk(L); let n = 0; for (const x of SHOT_UP.pierce) if (L >= x) n++; return n; }
  function upCost(w, L) {
    if (!W[w]) return null;
    L = lvOk(L);
    if (L >= LEVEL_MAX) return null;
    return Math.round(UP_COST[w] * Math.pow(UP_GROWTH, L - 1));
  }
  function affOf(w, mat) {
    if (!W[w] || !MAT_HP[mat]) return null;
    const a = W[w].aff[mat];
    return isNum(a) ? a : 1;
  }
  function tierOf(L) { return Math.min(EVOLVE_TIERS, Math.floor(lvOk(L) / EVOLVE_EVERY)); }
  function shapeOf(w, L) {
    const e = EVOLVE[w];
    if (!e) return null;
    return e.base + e.add * tierOf(L);
  }
  function addK(s, v) {
    if (!(v > 0)) return;
    let f = (isNum(s.kfrac) ? s.kfrac : 0) + v;
    const whole = Math.floor(f);
    f -= whole;
    s.kfrac = f >= 0 && f < 1 ? f : 0;
    if (whole > 0) {
      s.kakera = capK(s.kakera + whole);
      s.totals.kakera = capK(s.totals.kakera + whole);
    }
  }

  // ---------------------------------------------------------------- 星の大きさ・混ざり方・残り時間
  function normStar(n) {
    if (!isNum(n)) return null;
    const k = Math.floor(n);
    if (k < 1) return null;
    return Math.min(k, STAR_MAX);
  }
  const dimsMemo = new Map();
  // 大きさ・ボスは段の中の星 n（1〜30）で、混ざり方・重さのならしは通しの番号で決める
  function dimsOf(n, tier) {
    const t = tierOk(tier), N = numIn(n, t);
    let d0 = dimsMemo.get(N);
    if (d0) return d0;
    const boss = n % BOSS_EVERY === 0;
    // 大きさの番号：ふつうは星の番号、ハードは 1〜30 を 1〜50 に引きのばす（星 1 が小さく 30 が大きい）
    const k = t === 0 ? Math.min(n, STAR_CALC_MAX) : 1 + (Math.min(n, HARD_STARS) - 1) * (ENDING_STAR - 1) / (HARD_STARS - 1);
    let rad = Math.min(R_MAX, R_BASE + R_STEP * (k - 1));
    if (boss) rad = Math.min(R_MAX, rad * BOSS_SIZE);
    rad = Math.round(rad * 10) / 10;
    const w = 2 * Math.ceil(rad) + 4;
    const mx = mixRaw(Math.min(N, STAR_CALC_MAX));
    const adj = (boss ? BOSS_HARD : 1) * (weightOf(mx.iron0, mx.ice0) / weightOf(mx.iron, mx.ice));
    d0 = { boss, rad, w, h: w, adj, mix: mx, area: AREA_FILL * Math.PI * rad * rad, tier: t };
    if (dimsMemo.size < 2000) dimsMemo.set(N, d0);
    return d0;
  }
  function mixRaw(n) {
    const iron0 = n < 3 ? 0 : n < 10 ? MIX.iron[0] : MIX.iron[1];
    const ice0 = n < 6 ? 0 : MIX.ice;
    let iron = iron0, ice = ice0;
    if (n >= 6) {
      const tilt = hash2(n, 0x5eed) % 3;
      if (tilt === 1) { iron += MIX.tilt; ice -= MIX.tilt; } else if (tilt === 2) { iron -= MIX.tilt; ice += MIX.tilt; }
      iron = Math.round(iron * 100) / 100; ice = Math.round(ice * 100) / 100;
    }
    return { iron0, ice0, iron, ice };
  }
  function weightOf(iron, ice) { return (1 - iron - ice) * MAT_HP.rock + iron * MAT_HP.iron + ice * MAT_HP.ice; }
  function goldBlobs(n) { return n >= 8 ? 2 + (hash2(n, 0x901d) % 3) : 0; }
  // 倍率：星 1〜firstStars は first、lateFrom から late、その間はまっすぐ
  function limitMulOf(n) {
    const M = LIMIT_MUL;
    if (n <= M.firstStars) return M.first;
    if (n >= M.lateFrom) return M.late;
    return M.first + (M.late - M.first) * (n - M.firstStars) / (M.lateFrom - M.firstStars);
  }
  function limitBaseOf(n) { return n % BOSS_EVERY === 0 ? LIMIT_BASE.boss : n <= LIMIT_MUL.firstStars ? LIMIT_BASE.first : LIMIT_BASE.normal; }
  // その星の残り時間（秒。10 秒単位）。ハードは LIMIT_BASE.hard・hardBoss × 倍率 late（ふつうの星 10 以降と同じ倍率）
  function limitOf(n, tier) {
    const q = split(n, tier);
    if (q.t === 0) return Math.max(60, Math.round(limitBaseOf(q.k) * limitMulOf(q.k) / 10) * 10);
    return Math.round((q.k % BOSS_EVERY === 0 ? LIMIT_BASE.hardBoss : LIMIT_BASE.hard) * LIMIT_MUL.late / 10) * 10;
  }
  // starInfo(n, tier)：段 tier（省くと 0）の星 n。n が 30 より大きいときは通しの番号として読む。tier・star（段の中の星）・num（通しの番号）・hard も返す
  // 挑戦 tries 回目の残り時間（limitOf × やさしくなる分。10 秒単位）
  function limitTry(n, tier, tries) {
    const e = 1 + Math.min(RETRY_EASE.max, RETRY_EASE.step * Math.max(0, (isNum(tries) ? Math.floor(tries) : 1) - 1));
    return Math.round(limitOf(n, tier) * e / 10) * 10;
  }
  function starInfo(n, tier) {
    try {
      n = normStar(n);
      if (n === null) return null;
      const q = split(n, tier);
      const dm = dimsOf(q.k, q.t);
      const iron = dm.mix.iron, ice = dm.mix.ice;
      const gold = goldBlobs(q.N) * 4;
      const main = iron === 0 && ice === 0 ? null : iron >= ice ? "iron" : "ice";
      const tag = main === null ? "" : main === "iron" ? "てつが おおい" : "こおりが おおい";
      return { w: dm.w, h: dm.h, radius: dm.rad, boss: dm.boss, mix: { iron, ice, gold }, limit: limitOf(q.k, q.t), tag, main, tier: q.t, star: q.k, num: q.N, hard: q.t > 0 };
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- 星の形（seed と星の番号だけで決まる）
  // かたまりを育てる：種のマスから、まわりのマスのうち「種からの距離 × ゆらぎ」が一番小さいものを足していく（丸みのある形）
  function growBlob(mats, w, h, seedI, size, code, ok, rnd) {
    const sc = seedI % w, sr = (seedI - sc) / w;
    const front = [seedI], inFront = new Set([seedI]);
    const jit = new Map();
    let got = 0;
    while (front.length && got < size) {
      let bi = -1, bv = Infinity;
      for (let q = 0; q < front.length; q++) {
        const j = front[q];
        const c = j % w, r = (j - c) / w;
        let hh = jit.get(j);
        if (hh === undefined) { hh = 0.75 + 0.5 * rnd(); jit.set(j, hh); }
        const v = ((c - sc) * (c - sc) + (r - sr) * (r - sr)) * hh;
        if (v < bv) { bv = v; bi = q; }
      }
      const j = front[bi];
      front[bi] = front[front.length - 1]; front.pop();
      if (!ok(j)) continue;
      mats[j] = code; got++;
      const c = j % w, r = (j - c) / w;
      if (c > 0 && !inFront.has(j - 1) && ok(j - 1)) { inFront.add(j - 1); front.push(j - 1); }
      if (c < w - 1 && !inFront.has(j + 1) && ok(j + 1)) { inFront.add(j + 1); front.push(j + 1); }
      if (r > 0 && !inFront.has(j - w) && ok(j - w)) { inFront.add(j - w); front.push(j - w); }
      if (r < h - 1 && !inFront.has(j + w) && ok(j + w)) { inFront.add(j + w); front.push(j + w); }
    }
    return got;
  }
  function pickSeed(cells, w, ok, centers, rnd) {
    let best = -1, bd = -1;
    for (let t = 0; t < 8; t++) {
      const j = cells[Math.floor(rnd() * cells.length)];
      if (!ok(j)) continue;
      const c = j % w, r = (j - c) / w;
      let d = Infinity;
      for (const [cc, rr] of centers) d = Math.min(d, (c - cc) * (c - cc) + (r - rr) * (r - rr));
      if (!centers.length) d = 0;
      if (d > bd) { bd = d; best = j; }
    }
    if (best < 0) for (const j of cells) if (ok(j)) return j;
    return best;
  }
  function placeBlobs(mats, w, h, cells, want, nBlobs, code, ok, rnd) {
    let placed = 0;
    const centers = [];
    for (let b = 0; b < nBlobs && placed < want; b++) {
      const size = b === nBlobs - 1 ? want - placed : Math.round(want / nBlobs);
      let got = 0, guard = 0;
      while (got < size && guard++ < 6) {
        const sd = pickSeed(cells, w, ok, centers, rnd);
        if (sd < 0) break;
        const c = sd % w;
        centers.push([c, (sd - c) / w]);
        got += growBlob(mats, w, h, sd, size - got, code, ok, rnd);
      }
      placed += got;
    }
    return placed;
  }
  // つながり（上下左右）のかたまりの一覧
  function components(mats, w, h) {
    const out = [];
    const N = w * h;
    const seen = new Uint8Array(N);
    const st = [];
    for (let i = 0; i < N; i++) {
      if (!mats[i] || seen[i]) continue;
      const cells = [];
      seen[i] = 1; st.push(i);
      while (st.length) {
        const j = st.pop(); cells.push(j);
        const c = j % w;
        if (c > 0 && mats[j - 1] && !seen[j - 1]) { seen[j - 1] = 1; st.push(j - 1); }
        if (c < w - 1 && mats[j + 1] && !seen[j + 1]) { seen[j + 1] = 1; st.push(j + 1); }
        if (j >= w && mats[j - w] && !seen[j - w]) { seen[j - w] = 1; st.push(j - w); }
        if (j + w < N && mats[j + w] && !seen[j + w]) { seen[j + w] = 1; st.push(j + w); }
      }
      out.push(cells);
    }
    return out;
  }
  // 一番大きなかたまり（同じ大きさなら格子の真ん中に近いマスを含むほう）
  function centerDist(cells, w, h) {
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    let d = Infinity;
    for (const j of cells) { const c = j % w, r = (j - c) / w; const e = (c - cx) * (c - cx) + (r - cy) * (r - cy); if (e < d) d = e; }
    return d;
  }
  function mainIndex(list, w, h) {
    let best = -1, bestSize = -1, bestD = Infinity;
    for (let k = 0; k < list.length; k++) {
      const cells = list[k];
      if (cells.length < bestSize) continue;
      const d = centerDist(cells, w, h);
      if (cells.length > bestSize || (cells.length === bestSize && d < bestD)) { best = k; bestSize = cells.length; bestD = d; }
    }
    return best;
  }
  function keepMain(mats, w, h) {
    const list = components(mats, w, h);
    const m = mainIndex(list, w, h);
    for (let k = 0; k < list.length; k++) if (k !== m) for (const j of list[k]) mats[j] = 0;
  }
  // ふちからの深さ（空のマス・格子の外から上下左右に何マスか。ふちのマスが 1）
  function depthMap(mats, w, h) {
    const N = w * h, dep = new Int16Array(N), q = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) {
      if (!mats[i]) continue;
      const c = i % w, r = (i - c) / w;
      if (c === 0 || c === w - 1 || r === 0 || r === h - 1 || !mats[i - 1] || !mats[i + 1] || !mats[i - w] || !mats[i + w]) { dep[i] = 1; q[qt++] = i; }
    }
    while (qh < qt) {
      const j = q[qh++], c = j % w, d = dep[j] + 1;
      if (c > 0 && mats[j - 1] && !dep[j - 1]) { dep[j - 1] = d; q[qt++] = j - 1; }
      if (c < w - 1 && mats[j + 1] && !dep[j + 1]) { dep[j + 1] = d; q[qt++] = j + 1; }
      if (j >= w && mats[j - w] && !dep[j - w]) { dep[j - w] = d; q[qt++] = j - w; }
      if (j + w < N && mats[j + w] && !dep[j + w]) { dep[j + w] = d; q[qt++] = j + w; }
    }
    return dep;
  }
  // ひかりのかたまりを置く（ほかのひかりのかたまりと くっつかない。いわ のマスだけ）
  function placeGlow(mats, w, h, cand, size, gid, id, rnd) {
    const N = w * h;
    const okCell = (j) => {
      if (j < 0 || j >= N || mats[j] !== 1) return false;
      const c = j % w;
      if (c > 0 && gid[j - 1] && gid[j - 1] !== id) return false;
      if (c < w - 1 && gid[j + 1] && gid[j + 1] !== id) return false;
      if (j >= w && gid[j - w] && gid[j - w] !== id) return false;
      if (j + w < N && gid[j + w] && gid[j + w] !== id) return false;
      return true;
    };
    for (let tries = 0; tries < 20; tries++) {
      const sd = cand[Math.floor(rnd() * cand.length)];
      if (!okCell(sd)) continue;
      const got = growBlob(mats, w, h, sd, size, 5, (j) => okCell(j) && cand.has(j), rnd);
      if (got > 0) {
        for (let j = 0; j < N; j++) if (mats[j] === 5 && !gid[j]) gid[j] = id;
        if (got >= GLOW.min) return got;
        // 小さすぎたら元に戻す
        for (let j = 0; j < N; j++) if (gid[j] === id) { gid[j] = 0; mats[j] = 1; }
      }
    }
    return 0;
  }
  const rockMemo = new Map();
  function genRock(seed, n, tier) {
    const t = tierOk(tier);
    const mk = (seed >>> 0) + ":" + n + ":" + t;
    let base = rockMemo.get(mk);
    if (!base) {
      base = genRockRaw(seed, n, t);
      if (rockMemo.size >= 8) rockMemo.delete(rockMemo.keys().next().value);
      rockMemo.set(mk, base);
    }
    return { w: base.w, h: base.h, mats: base.mats.slice(), hp: base.hp.slice(), total: base.total, left: base.total, value: base.value, gen: 0, dirty: [], key: n * 10000 + 1, cx: base.cx, cy: base.cy };
  }
  function genRockRaw(seed, n, t) {
    const dm = dimsOf(n, t);
    const w = dm.w, h = dm.h, N = w * h, rad = dm.rad;
    const rnd = makeRng(t === 0 ? hash2(seed, n) : hash2((seed ^ Math.imul(t, 0x632be5ab)) >>> 0, n));
    // でこぼこの丸：半径のゆらぎ（2〜7 番目の波）を 1024 の向きの表にする
    const TB = 1024, tab = new Float64Array(TB);
    const waves = [];
    for (let k = 2; k <= 7; k++) waves.push([k, (rnd() * 2 - 1) / Math.sqrt(k), rnd() * 2 * Math.PI]);
    let mx = 1e-9;
    for (let q = 0; q < TB; q++) { const a = q / TB * 2 * Math.PI; let f = 0; for (const [k, amp, ph] of waves) f += amp * Math.cos(k * a + ph); tab[q] = f; if (Math.abs(f) > mx) mx = Math.abs(f); }
    for (let q = 0; q < TB; q++) tab[q] = rad * (SHAPE.base + SHAPE.amp * tab[q] / mx);
    const limAt = (a) => tab[((Math.round(a / (2 * Math.PI) * TB) % TB) + TB) % TB];
    const c0 = w / 2, r0 = h / 2;
    let mats = new Uint8Array(N);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const dx = c + 0.5 - c0, dy = r + 0.5 - r0;
      const d2 = dx * dx + dy * dy;
      const lim = limAt(Math.atan2(dy, dx));
      if (d2 <= lim * lim) mats[r * w + c] = 1;
    }
    // くぼみ（ふちにかかる丸い穴）
    const nCr = SHAPE.craters[0] + Math.floor(rnd() * (SHAPE.craters[1] - SHAPE.craters[0] + 1));
    for (let k = 0; k < nCr; k++) {
      const a = rnd() * 2 * Math.PI, cr = rad * (SHAPE.crater[0] + (SHAPE.crater[1] - SHAPE.crater[0]) * rnd());
      const ld = limAt(a) * (0.97 + 0.08 * rnd());
      const ccx = c0 + Math.cos(a) * ld, ccy = r0 + Math.sin(a) * ld;
      for (let r = Math.max(0, Math.floor(ccy - cr - 1)); r <= Math.min(h - 1, Math.ceil(ccy + cr + 1)); r++)
        for (let c = Math.max(0, Math.floor(ccx - cr - 1)); c <= Math.min(w - 1, Math.ceil(ccx + cr + 1)); c++) {
          const dx = c + 0.5 - ccx, dy = r + 0.5 - ccy;
          if (dx * dx + dy * dy <= cr * cr) mats[r * w + c] = 0;
        }
    }
    keepMain(mats, w, h);
    let cells = [];
    for (let i = 0; i < N; i++) if (mats[i]) cells.push(i);
    if (cells.length < 16) {
      mats = new Uint8Array(N);
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { const dx = c + 0.5 - c0, dy = r + 0.5 - r0; if (dx * dx + dy * dy <= rad * rad * 0.8) mats[r * w + c] = 1; }
      cells = [];
      for (let i = 0; i < N; i++) if (mats[i]) cells.push(i);
    }
    const cnt = cells.length;
    const okRock = (j) => mats[j] === 1;
    // てつ：大きなかたまり（それぞれ IRON_BLOB_MIN マス以上）。星が大きいほど かたまりの数が少し多い
    const ironWant = Math.round(cnt * dm.mix.iron);
    if (ironWant > 0) {
      const nb = Math.max(1, Math.min(2 + Math.floor(rnd() * 3) + Math.floor(cnt / 6000), Math.floor(ironWant / IRON_BLOB_MIN)));
      placeBlobs(mats, w, h, cells, ironWant, nb, 2, okRock, rnd);
    }
    // こおり：2〜3 個のかたまり
    const iceWant = Math.round(cnt * dm.mix.ice);
    if (iceWant > 0) placeBlobs(mats, w, h, cells, iceWant, 2 + Math.floor(rnd() * 2), 3, okRock, rnd);
    // きん：2×2 の小さなかたまり（星 8〜）
    const gb = goldBlobs(numIn(n, t));
    for (let b = 0, guard = 0; b < gb && guard < 400; guard++) {
      const j = cells[Math.floor(rnd() * cnt)];
      const c = j % w;
      if (c >= w - 1) continue;
      const q = [j, j + 1, j + w, j + w + 1];
      if (q.every((x) => x < N && okRock(x))) { for (const x of q) mats[x] = 4; b++; }
    }
    // ひかり：ふちの近く（と少し奥）に小さなかたまり
    const dep = depthMap(mats, w, h);
    const nearC = new Set(), deepC = new Set();
    for (const i of cells) { if (mats[i] !== 1) continue; if (dep[i] <= GLOW.near) nearC.add(i); else if (dep[i] >= GLOW.deepFrom && dep[i] <= GLOW.deepTo) deepC.add(i); }
    const gid = new Int16Array(N);
    const nGlow = clamp(Math.round(GLOW.fewest + Math.max(0, cnt - 3000) / GLOW.per), GLOW.fewest, GLOW.most);
    const nearArr = Array.from(nearC), deepArr = Array.from(deepC);
    let id = 0;
    const put = (arr, set) => {
      if (!arr.length) return;
      id++;
      const size = GLOW.min + Math.floor(rnd() * (GLOW.max - GLOW.min + 1));
      const pick = { length: arr.length, has: (j) => set.has(j) };
      const cand = new Proxy(pick, { get: (o, k) => (k === "length" ? arr.length : k === "has" ? o.has : arr[k]) });
      if (!placeGlow(mats, w, h, cand, size, gid, id, rnd)) id--;
    };
    const gf = HARD.glow[Math.min(t, HARD.glow.length - 1)];
    const nNear = Math.max(1, Math.round(nGlow * gf)), nDeep = Math.round(GLOW.deep * gf);
    for (let k = 0; k < nNear; k++) put(nearArr, nearC);
    for (let k = 0; k < nDeep; k++) put(deepArr, deepC);
    const hp = new Array(N).fill(0);
    let value = 0, sc = 0, sr = 0;
    const mm = new Array(N).fill(0);
    for (const i of cells) {
      const code = mats[i];
      if (!code) continue;
      const m = matOf(code);
      mm[i] = code;
      hp[i] = cellHp(n, m, t);
      value += cellValue(n, m, t) * (code === 5 ? GLOW.mul : 1);
      const c = i % w;
      sc += c; sr += (i - c) / w;
    }
    return { w, h, mats: mm, hp, total: cnt, value, cx: (sc / cnt + 0.5) * CELL, cy: (sr / cnt + 0.5) * CELL };
  }

  // ---------------------------------------------------------------- ふちのマスの一覧など（GEO。mats の配列ごと）
  // eflag[i] = 1：ふちのマス（残っていて、上下左右のどれかが空か格子の外）。elist はふちのマスの添字（欠けたマスは eflag 0 で飛ばす。たまったら詰める）
  // irons はてつのマスの添字（欠けたら飛ばす）。sc・sr・n は残っているマスの列・行の合計と数（重心）
  const GEO = new WeakMap();
  function buildGeo(R) {
    const w = R.w, h = R.h, mats = R.mats, N = w * h;
    const eflag = new Uint8Array(N), elist = [], irons = [];
    let sc = 0, sr = 0, n = 0;
    for (let i = 0; i < N; i++) {
      const m = mats[i];
      if (!m) continue;
      const c = i % w, r = (i - c) / w;
      n++; sc += c; sr += r;
      if (m === 2) irons.push(i);
      if (c === 0 || c === w - 1 || r === 0 || r === h - 1 || !mats[i - 1] || !mats[i + 1] || !mats[i - w] || !mats[i + w]) { eflag[i] = 1; elist.push(i); }
    }
    CELLS += N >> 2;
    return { eflag, elist, eLive: elist.length, irons, ironLive: irons.length, sc, sr, n };
  }
  function geoOf(R) {
    let g = GEO.get(R.mats);
    if (!g) { g = buildGeo(R); GEO.set(R.mats, g); }
    return g;
  }
  function copyGeo(g) { return { eflag: g.eflag.slice(), elist: g.elist.slice(), eLive: g.eLive, irons: g.irons, ironLive: g.ironLive, sc: g.sc, sr: g.sr, n: g.n }; }

  // ---------------------------------------------------------------- 状態
  function newSlot(id) { return { id, lv: 1 }; }
  function newGame(seed) {
    try {
      if (seed === undefined) seed = 1;
      if (!isNum(seed)) return null;
      seed = Math.floor(Math.abs(seed)) >>> 0;
      return makeState({ star: 1, kakera: 0, kfrac: 0, slots: [newSlot("shot")], bench: [], swap: [], offer: null, cleared: false, tries: 1, totals: { cells: 0, stars: 0, kakera: 0, chunks: 0, glows: 0 }, seed, rng: hash2(seed, 0x2b) });
    } catch (e) { return null; }
  }
  // 保存の中身（検証済み）から、星の最初の状態を作る
  function makeState(o) {
    const tier = tierOk(o.tier);
    const limit = limitTry(o.star, tier, o.tries);
    const s = {
      tier, star: o.star, phase: o.offer ? "choose" : "fly", t: isNum(o.t) ? o.t : 0, left: limit, limit,
      kakera: o.kakera, kfrac: isNum(o.kfrac) ? o.kfrac : 0,
      slots: o.slots.map((x) => ({ id: x.id, lv: x.lv })), bench: (o.bench || []).map((x) => ({ id: x.id, lv: x.lv })),
      offer: o.offer ? o.offer.slice() : null, swap: (o.swap || []).map((x) => ({ slot: x.slot, id: x.id })),
      rock: null, ship: null, shots: [], burns: [], cd: o.slots.map(() => 0),
      tries: o.tries, cleared: o.cleared, totals: { cells: o.totals.cells, stars: o.totals.stars, kakera: o.totals.kakera, chunks: o.totals.chunks, glows: o.totals.glows | 0 },
      seed: o.seed, rng: o.rng, wait: 0, back: "fly",
      ms: Array.isArray(o.ms) ? o.ms.slice() : [], bestT: isObj(o.bestT) ? Object.assign({}, o.bestT) : {}, hold: false
    };
    s.rock = genRock(s.seed, s.star, s.tier);
    s.rock.key = rockKey(s);
    if (o.mid !== undefined && o.mid !== null) applyMid(s, o.mid);
    s.ship = startShip(s);
    s.ms = passedMs(s.rock, s.ms);
    return s;
  }
  // 連長圧縮：1 マス 1 文字（a=0, b=1, …）＋続く数（2 以上のとき）
  const RLE_A = 97;
  function rleEncode(arr) {
    let out = "";
    for (let i = 0; i < arr.length;) {
      const v = arr[i];
      let j = i + 1;
      while (j < arr.length && arr[j] === v) j++;
      out += String.fromCharCode(RLE_A + v) + (j - i > 1 ? String(j - i) : "");
      i = j;
    }
    return out;
  }
  // 戻す。maxV をこえる文字・長さの食い違い・おかしな形なら null
  function rleDecode(str, N, maxV) {
    if (typeof str !== "string" || str.length > 4 * N + 16) return null;
    const out = new Array(N);
    let k = 0, i = 0;
    while (i < str.length) {
      const v = str.charCodeAt(i) - RLE_A;
      if (!(v >= 0 && v <= maxV)) return null;
      i++;
      let n = 0, nd = 0;
      while (i < str.length) { const d = str.charCodeAt(i) - 48; if (d < 0 || d > 9) break; n = n * 10 + d; nd++; i++; if (nd > 6) return null; }
      if (nd === 0) n = 1; else if (n < 2) return null;
      if (k + n > N) return null;
      for (let q = 0; q < n; q++) out[k++] = v;
    }
    return k === N ? out : null;
  }
  function applyMid(s, mid) {
    if (!isObj(mid)) return false;
    const R = s.rock, N = R.w * R.h;
    const mats = rleDecode(mid.mats, N, 5);
    if (!mats) return false;
    for (let i = 0; i < N; i++) if (mats[i] !== 0 && mats[i] !== R.mats[i]) return false;
    keepMain(mats, R.w, R.h);
    let left = 0;
    for (let i = 0; i < N; i++) if (mats[i]) left++;
    if (left < 1) return false;
    const lv = rleDecode(mid.hp, N, 9);
    let hpOk = !!lv;
    if (hpOk) for (let i = 0; i < N; i++) if (mats[i] && !(lv[i] >= 1)) { hpOk = false; break; }
    const hp = R.hp.map((h, i) => (mats[i] ? (hpOk ? h * lv[i] / 9 : h) : 0));
    const rock = Object.assign({}, R, { mats, hp, left });
    const g = geoOf(rock);
    rock.cx = (g.sc / g.n + 0.5) * CELL; rock.cy = (g.sr / g.n + 0.5) * CELL;
    s.rock = rock;
    if (isNum(mid.left)) s.left = clamp(Math.round(mid.left * 10) / 10, 1, s.limit);
    return true;
  }
  function passedMs(rock, ms) {
    const b = rock && rock.total > 0 ? 1 - rock.left / rock.total : 0;
    const out = MILESTONES.filter((p) => ms.includes(p) || b >= p / 100 - 1e-12);
    return out.length === ms.length ? ms : out;
  }
  // 自機の始めの位置：格子の上の外の点から一番近いふちのマスの外へ STANDOFF マス。まわる向きは +1
  function startShip(s) {
    const R = s.rock, g = geoOf(R), w = R.w;
    const px = R.w * CELL / 2, py = -STANDOFF * CELL;
    let bi = -1, bd = Infinity;
    for (const i of g.elist) {
      if (!g.eflag[i]) continue;
      const c = i % w, x = (c + 0.5) * CELL, y = ((i - c) / w + 0.5) * CELL;
      const d = (x - px) * (x - px) + (y - py) * (y - py);
      if (d < bd) { bd = d; bi = i; }
    }
    const laps = lapsOf(s);
    if (bi < 0) return { x: px, y: py, ang: 0, dir: 1, orb: 0, laps };
    const c = bi % w, ex = (c + 0.5) * CELL, ey = ((bi - c) / w + 0.5) * CELL;
    const L = Math.hypot(px - ex, py - ey) || 1, nx = (px - ex) / L, ny = (py - ey) / L;
    return { x: ex + nx * STANDOFF * CELL, y: ey + ny * STANDOFF * CELL, ang: Math.atan2(nx, -ny), dir: 1, orb: 0, laps };
  }
  function rockKey(s) { return numIn(s.star, s.tier) * 10000 + Math.min(9999, s.tries | 0); }
  function lapsOf(s) {
    const h = hash2((s.seed >>> 0) ^ Math.imul(s.star | 0, 0x9e37), Math.floor((isNum(s.t) ? s.t : 0) * 30) >>> 0);
    return ORBIT_LAPS[0] + (h % (ORBIT_LAPS[1] - ORBIT_LAPS[0] + 1));
  }
  function fullHp(s, i) {
    const code = s.rock.mats[i];
    if (!code) return null;
    return cellHp(s.star, matOf(code), s.tier);
  }
  function isState(s) {
    return isObj(s) && isNum(s.star) && isNum(s.kakera) && isNum(s.t) && Array.isArray(s.slots) && s.slots.length >= 1 && s.slots.length <= SLOTS_MAX &&
      s.slots.every((x) => isObj(x) && W[x.id]) &&
      isObj(s.rock) && Number.isInteger(s.rock.w) && Number.isInteger(s.rock.h) && s.rock.w > 0 && s.rock.h > 0 &&
      Array.isArray(s.rock.mats) && Array.isArray(s.rock.hp) && s.rock.mats.length === s.rock.w * s.rock.h && s.rock.hp.length === s.rock.mats.length &&
      Array.isArray(s.shots) && Array.isArray(s.burns) && isObj(s.totals) && typeof s.phase === "string";
  }
  // 足りない欄（テストや setState が渡す形）を直す。step・買い物の写しで使う
  function fixParts(c) {
    if (!Array.isArray(c.bench)) c.bench = [];
    if (!Array.isArray(c.swap)) c.swap = [];
    if (!Array.isArray(c.cd)) c.cd = [];
    while (c.cd.length < c.slots.length) c.cd.push(0);
    if (c.cd.length > c.slots.length) c.cd.length = c.slots.length;
    if (!isNum(c.kfrac) || c.kfrac < 0 || c.kfrac >= 1) c.kfrac = 0;
    if (!isNum(c.wait)) c.wait = 0;
    if (typeof c.back !== "string") c.back = "fly";
    c.tier = tierOk(c.tier);
    if (!isNum(c.limit) || c.limit <= 0) c.limit = limitTry(c.star, c.tier, c.tries);
    if (!isNum(c.left)) c.left = c.limit;
    if (!Array.isArray(c.rock.dirty)) c.rock.dirty = [];
    if (!isNum(c.rock.gen)) c.rock.gen = 0;
    if (!isNum(c.rock.left)) { let n = 0; for (const m of c.rock.mats) if (m) n++; c.rock.left = n; }
    if (!isNum(c.rock.total)) c.rock.total = c.rock.left;
    const sh = c.ship;
    if (!isObj(sh) || !isNum(sh.x) || !isNum(sh.y)) c.ship = startShip(c);
    else if (!isNum(sh.ang) || (sh.dir !== 1 && sh.dir !== -1) || !isNum(sh.orb) || !isNum(sh.laps) || sh.laps <= 0) c.ship = { x: sh.x, y: sh.y, ang: isNum(sh.ang) ? sh.ang : 0, dir: sh.dir === -1 ? -1 : 1, orb: isNum(sh.orb) ? sh.orb : 0, laps: isNum(sh.laps) && sh.laps > 0 ? sh.laps : lapsOf(c) };
    c.hold = c.hold === true;
  }
  function cloneForStep(s) {
    const c = Object.assign({}, s);
    c.rock = Object.assign({}, s.rock);
    c.ship = isObj(s.ship) ? Object.assign({}, s.ship) : null;
    c.shots = s.shots.map((x) => Object.assign({}, x));
    c.burns = s.burns.map((x) => Object.assign({}, x));
    c.cd = Array.isArray(s.cd) ? s.cd.slice() : [];
    c.totals = Object.assign({}, s.totals);
    c.slots = s.slots.map((x) => ({ id: x.id, lv: x.lv }));
    c.bench = Array.isArray(s.bench) ? s.bench.map((x) => ({ id: x.id, lv: x.lv })) : [];
    c.swap = Array.isArray(s.swap) ? s.swap.map((x) => ({ slot: x.slot, id: x.id })) : [];
    c.offer = s.offer ? s.offer.slice() : null;
    fixParts(c);
    return c;
  }
  // コピーオンライト：公開の step の間だけ、最初の書き込みで配列を写す（hp は当たったとき、mats・dirty は欠けたとき）
  let SIM = false, OWN_HP = null, OWN_MATS = null, OWN_DIRTY = null;
  function ownHp(s) {
    if (SIM || OWN_HP === s.rock.hp) return;
    s.rock.hp = s.rock.hp.slice();
    OWN_HP = s.rock.hp;
  }
  function ownMats(s) {
    if (SIM || OWN_MATS === s.rock.mats) return;
    const g = geoOf(s.rock);
    s.rock.mats = s.rock.mats.slice();
    GEO.set(s.rock.mats, copyGeo(g));
    OWN_MATS = s.rock.mats;
  }
  function markDirty(s, i) {
    if (SIM) return;
    const R = s.rock, N = R.mats.length;
    if (OWN_DIRTY !== R.dirty) { R.dirty = Array.isArray(R.dirty) ? R.dirty.slice() : []; OWN_DIRTY = R.dirty; }
    if (R.dirty.length >= N) return;
    if (R.dirty.length + 1 >= N) { R.dirty = Array.from({ length: N }, (_, k) => k); OWN_DIRTY = R.dirty; return; }
    R.dirty.push(i);
  }

  // ---------------------------------------------------------------- マスが欠ける
  // 1 マスを空にする（ふちの一覧・てつ・重心・dirty を直す）。かけら・出来事は呼ぶ側
  function clearCell(s, i, ctx) {
    ownMats(s); ownHp(s);
    const R = s.rock, g = geoOf(R), w = R.w, mats = R.mats, N = mats.length;
    const m = mats[i];
    if (!m) return;
    mats[i] = 0; R.hp[i] = 0; R.left--;
    if (g.eflag[i]) { g.eflag[i] = 0; g.eLive--; }
    if (m === 2) g.ironLive--;
    const c = i % w;
    g.sc -= c; g.sr -= (i - c) / w; g.n--;
    if (c > 0 && mats[i - 1] && !g.eflag[i - 1]) { g.eflag[i - 1] = 1; g.elist.push(i - 1); g.eLive++; }
    if (c < w - 1 && mats[i + 1] && !g.eflag[i + 1]) { g.eflag[i + 1] = 1; g.elist.push(i + 1); g.eLive++; }
    if (i >= w && mats[i - w] && !g.eflag[i - w]) { g.eflag[i - w] = 1; g.elist.push(i - w); g.eLive++; }
    if (i + w < N && mats[i + w] && !g.eflag[i + w]) { g.eflag[i + w] = 1; g.elist.push(i + w); g.eLive++; }
    markDirty(s, i);
    if (ctx) { ctx.broke = true; ctx.removed.push(i); }
  }
  // マスに強さを与える。欠けたら break（ひかり なら つながった ひかり を全部 glow）と かけら
  function hurt(s, i, amount, w, ctx, quiet) {
    const code = s.rock.mats[i];
    if (!code) return false;
    CELLS++;
    const mat = matOf(code);
    ownHp(s);
    const R = s.rock;
    const aff = affOf(w, mat);
    R.hp[i] -= amount * aff;
    if (R.hp[i] <= 1e-9) {
      if (code === 5) { glowBurst(s, i, ctx); return true; }
      const v = cellValue(s.star, mat, s.tier);
      clearCell(s, i, ctx);
      addK(s, v);
      s.totals.cells++;
      ctx.evs.push({ kind: "break", i, mat, value: v });
      return true;
    }
    if (!quiet) {
      let crack = 0;
      const full = fullHp(s, i);
      if (MAT_HP[mat] > 1 && full > 0) crack = clamp(Math.floor(4 * (1 - R.hp[i] / full)), 0, 3);
      ctx.evs.push({ kind: "hit", i, w, mat, crack, aff });
    }
    return false;
  }
  // ひかり：つながった（上下左右）ひかり のマスを全部まとめて砕く。かけら × GLOW.mul
  function glowBurst(s, start, ctx) {
    const R = s.rock, w = R.w, N = R.mats.length;
    const cells = [start], seen = new Set([start]);
    for (let q = 0; q < cells.length; q++) {
      const j = cells[q], c = j % w;
      const nb = [c > 0 ? j - 1 : -1, c < w - 1 ? j + 1 : -1, j - w, j + w];
      for (const k of nb) if (k >= 0 && k < N && !seen.has(k) && R.mats[k] === 5) { seen.add(k); cells.push(k); }
    }
    const v = cellValue(s.star, "glow", s.tier) * GLOW.mul * cells.length;
    for (const j of cells) clearCell(s, j, ctx);
    addK(s, v);
    s.totals.cells += cells.length;
    s.totals.glows = (s.totals.glows | 0) + 1;
    CELLS += cells.length * 4;
    ctx.evs.push({ kind: "glow", cells, mats: cells.map(() => 5), value: v });
  }
  function ignite(s, i, ctx, fromSpread) {
    const lv = slotLv(s, "fire");
    const until = s.t + shapeOf("fire", lv);
    for (const b of s.burns) if (b.i === i) { if (b.until < until) b.until = until; return; }
    s.burns.push({ i, until, at: s.t, spread: !!fromSpread });
    ctx.evs.push({ kind: "burn", i });
  }
  function slotLv(s, id) { for (const x of s.slots) if (x.id === id) return x.lv; return 1; }

  // ---------------------------------------------------------------- はなれたかたまり（欠けたマスのまわりだけ調べる）
  // 1. その step で欠けたマスを、となり（8 方向）どうしでまとめる。
  // 2. まとまりごとに、まわり（上下左右）に残っているマスが、まとまりの四角（＋3 マス）の中でつながっているかを調べる。
  //    全部つながっていれば、そのまとまりで星が分かれることは無い。
  // 3. つながっていない組があれば、その組から星全体を数える（半分をこえたら本体と決まるので止める）。本体でないかたまりは全部くだく。
  let STAMP = null, STAMP_N = 0, QBUF = null;
  function stampArr(N) {
    if (!STAMP || STAMP.length < N) { STAMP = new Int32Array(Math.max(N, GRID_MAX * GRID_MAX)); STAMP_N = 0; QBUF = new Int32Array(STAMP.length); }
    if (STAMP_N > 2e9) { STAMP.fill(0); STAMP_N = 0; }
    return STAMP;
  }
  function breakLoose(s, ctx) {
    const R = s.rock, w = R.w, h = R.h, mats = R.mats, N = mats.length;
    const removed = ctx.removed;
    if (!removed.length || R.left <= 0) return;
    const st = stampArr(N), Q = QBUF;
    const rmS = ++STAMP_N;            // 欠けたマスの印
    for (const i of removed) st[i] = rmS;
    const doneS = ++STAMP_N;          // まとめ済みの印
    const seeds = [];
    for (const i0 of removed) {
      if (st[i0] !== rmS) continue;
      // 1. まとまり（8 方向）と四角
      let qh = 0, qt = 0;
      Q[qt++] = i0; st[i0] = doneS;
      let c0 = w, c1 = -1, r0 = h, r1 = -1;
      const clus = [];
      while (qh < qt) {
        const j = Q[qh++]; clus.push(j);
        const c = j % w, r = (j - c) / w;
        if (c < c0) c0 = c; if (c > c1) c1 = c; if (r < r0) r0 = r; if (r > r1) r1 = r;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc, rr = r + dr;
          if (cc < 0 || cc >= w || rr < 0 || rr >= h) continue;
          const k = rr * w + cc;
          if (st[k] === rmS) { st[k] = doneS; Q[qt++] = k; }
        }
      }
      CELLS += clus.length * 4;
      // 2. まわりに残っているマス
      const bnd = [];
      const bS = ++STAMP_N;
      for (const j of clus) {
        const c = j % w;
        const nb = [c > 0 ? j - 1 : -1, c < w - 1 ? j + 1 : -1, j - w, j + w];
        for (const k of nb) if (k >= 0 && k < N && mats[k] && st[k] !== bS) { st[k] = bS; bnd.push(k); }
      }
      if (bnd.length <= 1) continue;
      const M = 3;
      const bc0 = Math.max(0, c0 - M), bc1 = Math.min(w - 1, c1 + M), br0 = Math.max(0, r0 - M), br1 = Math.min(h - 1, r1 + M);
      const lS = ++STAMP_N;
      let groups = 0;
      for (const b of bnd) {
        if (st[b] === lS) continue;
        groups++;
        if (groups > 1) seeds.push(b);
        else seeds.push(b);
        let qh2 = 0, qt2 = 0;
        Q[qt2++] = b; st[b] = lS;
        while (qh2 < qt2) {
          const j = Q[qh2++];
          const c = j % w, r = (j - c) / w;
          CELLS++;
          if (c > bc0 && mats[j - 1] && st[j - 1] !== lS) { st[j - 1] = lS; Q[qt2++] = j - 1; }
          if (c < bc1 && mats[j + 1] && st[j + 1] !== lS) { st[j + 1] = lS; Q[qt2++] = j + 1; }
          if (r > br0 && mats[j - w] && st[j - w] !== lS) { st[j - w] = lS; Q[qt2++] = j - w; }
          if (r < br1 && mats[j + w] && st[j + w] !== lS) { st[j + w] = lS; Q[qt2++] = j + w; }
        }
      }
      if (groups === 1) seeds.pop();   // 1 つにつながっていれば、このまとまりでは分かれない
    }
    if (!seeds.length) return;
    // 3. 星全体を数える（半分をこえたら止める）
    const cap = Math.floor(R.left / 2);
    const comps = [];
    let bigS = 0;
    for (const sd of seeds) {
      if (!mats[sd]) continue;
      const v = st[sd];
      if (v === bigS || comps.some((x) => x.stamp === v)) continue;
      const gS = ++STAMP_N;
      let qh = 0, qt = 0, big = false;
      Q[qt++] = sd; st[sd] = gS;
      while (qh < qt) {
        const j = Q[qh++];
        const c = j % w;
        const nb0 = c > 0 ? j - 1 : -1, nb1 = c < w - 1 ? j + 1 : -1, nb2 = j - w, nb3 = j + w;
        for (const k of [nb0, nb1, nb2, nb3]) {
          if (k < 0 || k >= N || !mats[k] || st[k] === gS) continue;
          if (bigS && st[k] === bigS) { big = true; break; }
          st[k] = gS; Q[qt++] = k;
        }
        if (big || qt > cap) { big = true; break; }
      }
      CELLS += qt;
      if (big) {
        // 本体：印を本体の印にそろえる（ほかの組がここへ来たら本体とわかる）
        if (!bigS) bigS = gS;
        else for (let q = 0; q < qt; q++) st[Q[q]] = bigS;
        continue;
      }
      comps.push({ stamp: gS, cells: Array.prototype.slice.call(Q, 0, qt) });
    }
    if (!comps.length) return;
    let mainK = -1;
    if (!bigS) {
      // どれも半分以下：全部が見つかっている（本体も comps の中）。一番大きいものを本体にする
      const list = comps.map((x) => x.cells);
      const sum = list.reduce((a, x) => a + x.length, 0);
      if (sum === R.left) mainK = mainIndex(list, w, h);
      else {
        // 見つかっていない残りがある：残り（sum の外）が本体。ただし同じ大きさなら真ん中に近いほう
        const rest = R.left - sum;
        let bi = 0;
        for (let k = 1; k < list.length; k++) if (list[k].length > list[bi].length) bi = k;
        if (list[bi].length > rest) mainK = bi;
        else if (list[bi].length === rest) {
          const inC = new Set();
          for (const x of list) for (const j of x) inC.add(j);
          const others = [];
          for (let i = 0; i < N; i++) if (mats[i] && !inC.has(i)) others.push(i);
          if (centerDist(list[bi], w, h) < centerDist(others, w, h)) mainK = bi;
        }
      }
    }
    for (let k = 0; k < comps.length; k++) {
      if (k === mainK) continue;
      const cells = comps[k].cells;
      let v = 0;
      const cm = new Array(cells.length);
      for (let q = 0; q < cells.length; q++) { const j = cells[q], code = s.rock.mats[j]; cm[q] = code; v += cellValue(s.star, matOf(code), s.tier); clearCell(s, j, null); }
      addK(s, v);
      s.totals.cells += cells.length; s.totals.chunks++;
      ctx.evs.push({ kind: "chunk", cells, mats: cm, value: v });
      ctx.broke = true;
    }
  }

  // ---------------------------------------------------------------- 格子をたどる（DDA）
  // 線分（世界の座標）が通る格子のマスを順にたどる。fn(i, t) が true を返したら止める（t は線分の 0〜1）
  function dda(R, x0, y0, x1, y1, fn) {
    const cols = R.w, rows = R.h;
    const gx0 = x0 / CELL, gy0 = y0 / CELL;
    const dx = x1 / CELL - gx0, dy = y1 / CELL - gy0;
    let t0 = 0, t1 = 1;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    if (!clip(-dx, gx0) || !clip(dx, cols - gx0) || !clip(-dy, gy0) || !clip(dy, rows - gy0) || t0 > t1) return;
    const px = gx0 + dx * t0, py = gy0 + dy * t0;
    let cx = clamp(Math.floor(px), 0, cols - 1), cy = clamp(Math.floor(py), 0, rows - 1);
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const tdx = sx ? Math.abs(1 / dx) : Infinity, tdy = sy ? Math.abs(1 / dy) : Infinity;
    let tmx = sx > 0 ? t0 + (cx + 1 - px) / dx : sx < 0 ? t0 + (cx - px) / dx : Infinity;
    let tmy = sy > 0 ? t0 + (cy + 1 - py) / dy : sy < 0 ? t0 + (cy - py) / dy : Infinity;
    let t = t0;
    for (let guard = 0; guard < 4 * (cols + rows); guard++) {
      CELLS++;
      if (fn(cy * cols + cx, t)) return;
      if (tmx < tmy) { t = tmx; if (t > t1) return; cx += sx; tmx += tdx; } else { t = tmy; if (t > t1) return; cy += sy; tmy += tdy; }
      if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) return;
    }
  }
  const cellX = (R, i) => ((i % R.w) + 0.5) * CELL;
  const cellY = (R, i) => (Math.floor(i / R.w) + 0.5) * CELL;

  // ---------------------------------------------------------------- 自機の動き（計画書 §1.2）
  // 一番近いふちのマスと、近くのふちのマスから向きをならした「外向き」を求め、ふちに沿って（dir の向きに）進む。
  // 離れすぎ・寄りすぎは外向きの成分で直す。とても遠いときは、まっすぐ寄る（残りが少ないとき）。
  let DBUF = null;
  function moveShip(s, dt, ctx) {
    const R = s.rock, g = geoOf(R), sh = s.ship, w = R.w;
    const el = g.elist, ef = g.eflag;
    if (el.length > 2 * g.eLive + 64) {   // 欠けたマスがたまったら詰める
      const nl = [];
      for (const i of el) if (ef[i]) nl.push(i);
      g.elist = nl;
    }
    const E = g.elist, n = E.length;
    if (!DBUF || DBUF.length < n) DBUF = new Float64Array(Math.max(1024, n * 2));
    let bi = -1, bd = Infinity;
    const x = sh.x, y = sh.y;
    for (let q = 0; q < n; q++) {
      const i = E[q];
      if (!ef[i]) { DBUF[q] = Infinity; continue; }
      const c = i % w;
      const dx = x - (c + 0.5) * CELL, dy = y - ((i - c) / w + 0.5) * CELL;
      const d2 = dx * dx + dy * dy;
      DBUF[q] = d2;
      if (d2 < bd) { bd = d2; bi = i; }
    }
    CELLS += n >> 2;
    ctx.near = bi;
    ctx.nearD = Math.sqrt(bd);
    if (bi < 0) return;
    const d = ctx.nearD, lim = (d + 2.5 * CELL) * (d + 2.5 * CELL);
    let nx = 0, ny = 0;
    for (let q = 0; q < n; q++) {
      const d2 = DBUF[q];
      if (d2 > lim) continue;
      const i = E[q], c = i % w;
      const dx = x - (c + 0.5) * CELL, dy = y - ((i - c) / w + 0.5) * CELL;
      const L = Math.sqrt(d2) || 1, wt = 1 / (d2 + CELL * CELL);
      nx += dx / L * wt; ny += dy / L * wt;
    }
    let nl = Math.hypot(nx, ny);
    if (nl < 1e-12) { const c = bi % w; nx = x - (c + 0.5) * CELL; ny = y - ((bi - c) / w + 0.5) * CELL; nl = Math.hypot(nx, ny) || 1; }
    nx /= nl; ny /= nl;
    // まわる向きを変える：今の向きで laps 周まわったら
    if (sh.orb >= sh.laps * TAU - 1e-9) { sh.dir = -sh.dir; sh.orb = 0; sh.laps = lapsOf(s); }
    const D0 = STANDOFF * CELL, err = d - D0;
    const a = clamp(1 - Math.max(0, err - 4 * CELL) / (10 * CELL), 0, 1);
    const b = clamp(err / (3 * CELL), -1, 1);
    const tx = -ny * sh.dir, ty = nx * sh.dir;
    const wx = tx * a - nx * b, wy = ty * a - ny * b;
    if (Math.abs(wx) + Math.abs(wy) > 1e-9) {
      const want = Math.atan2(wy, wx);
      let da = want - sh.ang;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      const mv = SHIP_TURN * dt;
      sh.ang = Math.abs(da) <= mv ? want : sh.ang + Math.sign(da) * mv;
      sh.ang = Math.atan2(Math.sin(sh.ang), Math.cos(sh.ang));
    }
    const ox = sh.x - R.cx, oy = sh.y - R.cy;
    sh.x += Math.cos(sh.ang) * SHIP_SPEED * dt;
    sh.y += Math.sin(sh.ang) * SHIP_SPEED * dt;
    orbitAdd(sh, ox, oy, sh.x - R.cx, sh.y - R.cy);
  }
  // 重心から見た角度の動き（y は下向きなので atan2 が増える向き＝dir +1 の進む向き）を、今の向きの進みとして積む。
  // 引き返すと減る（行き来で数えない）。逆へ進んだ分は 1 周までしかためない（どこかで必ず向きを変えられる）
  function orbitAdd(sh, x0, y0, x1, y1) {
    const nr = ORBIT_NEAR * CELL;
    if (!isNum(x0 + y0 + x1 + y1) || x0 * x0 + y0 * y0 < nr * nr || x1 * x1 + y1 * y1 < nr * nr) return;
    let da = Math.atan2(y1, x1) - Math.atan2(y0, x0);
    if (da > Math.PI) da -= TAU; else if (da < -Math.PI) da += TAU;
    sh.orb = Math.max(-TAU, sh.orb + da * sh.dir);
  }

  // ---------------------------------------------------------------- ねらい（自機から。RANGE より遠いマスはねらわない）
  function nearestIn(R, list, x, y, code, skip, maxD2) {
    let best = -1, bd = maxD2;
    const mats = R.mats, w = R.w;
    for (let q = 0; q < list.length; q++) {
      const i = list[q];
      const m = mats[i];
      if (!m || (code && m !== code) || (skip && skip.has(i))) continue;
      const c = i % w;
      const dx = (c + 0.5) * CELL - x, dy = ((i - c) / w + 0.5) * CELL - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    CELLS += list.length >> 2;
    return best;
  }
  function hotSet(s) {
    const hot = new Set();
    for (const b of s.burns) hot.add(b.i);
    for (const b of s.shots) if (b.w === "fire" && b.aim >= 0) hot.add(b.aim);
    return hot;
  }
  function liveEdges(R) { const g = geoOf(R); return { list: g.elist, flag: g.eflag }; }
  // どかん：届くふちのマス（3 マスおき）のうち、半径 r の円の中の残っているマスが一番多い所（同じなら近いほう）
  function bombTarget(s, r) {
    const R = s.rock, sh = s.ship, w = R.w, h = R.h, mats = R.mats;
    const { list, flag } = liveEdges(R);
    const max2 = (RANGE * CELL) * (RANGE * CELL);
    let best = -1, bn = -1, bd = Infinity, k = 0;
    const ri = Math.ceil(r), rr = r * r;
    for (let q = 0; q < list.length; q++) {
      const i = list[q];
      if (!flag[i]) continue;
      const c = i % w, row = (i - c) / w;
      const dx = (c + 0.5) * CELL - sh.x, dy = (row + 0.5) * CELL - sh.y;
      const d = dx * dx + dy * dy;
      if (d > max2) continue;
      if ((k++ % BOMB_EVERY) !== 0) continue;
      let cnt = 0;
      for (let a = -ri; a <= ri; a++) {
        const r2 = row + a;
        if (r2 < 0 || r2 >= h) continue;
        for (let b = -ri; b <= ri; b++) {
          const c2 = c + b;
          if (c2 < 0 || c2 >= w || a * a + b * b > rr) continue;
          if (mats[r2 * w + c2]) cnt++;
        }
      }
      CELLS += (2 * ri + 1) * (2 * ri + 1);
      if (cnt > bn || (cnt === bn && d < bd)) { bn = cnt; bd = d; best = i; }
    }
    CELLS += list.length >> 2;
    return best;
  }
  // ビーム：自機から一番近いふちのマスの向きを真ん中に、±60° を 4° ごとに調べ、光の通り道（最初に当たったマスから奥へ BEAM_DEPTH マス）の
  // マスが一番多い向き（てつ は 2 つに数える）。最初に当たるマスが届く距離の中の向きだけ
  function beamTarget(s, near) {
    const R = s.rock, sh = s.ship;
    const a0 = Math.atan2(cellY(R, near) - sh.y, cellX(R, near) - sh.x);
    const nStep = Math.round(BEAM_SCAN_MAX / (BEAM_SCAN_DEG * DEG));
    const LEN = (RANGE + BEAM_DEPTH + 2) * CELL, maxD = RANGE * CELL;
    let best = null, bn = 0, bdA = Infinity, bi = -1;
    for (let k = -nStep; k <= nStep; k++) {
      const a = a0 + k * BEAM_SCAN_DEG * DEG;
      const ca = Math.cos(a), sa = Math.sin(a);
      let first = -1, d0 = 0, cnt = 0;
      dda(R, sh.x, sh.y, sh.x + ca * LEN, sh.y + sa * LEN, (i, t) => {
        const d = t * LEN;
        if (first < 0) { if (R.mats[i]) { if (d > maxD) return true; first = i; d0 = d; } else return false; }
        if (d >= d0 + BEAM_DEPTH * CELL - 1e-6) return true;
        const m = R.mats[i];
        if (m) cnt += m === 2 ? 2 : 1;
        return false;
      });
      if (first < 0) continue;
      const da = Math.abs(k);
      if (cnt > bn || (cnt === bn && da < bdA)) { bn = cnt; best = a; bdA = da; bi = first; }
    }
    return best === null ? null : { ang: best, i: bi };
  }

  // ---------------------------------------------------------------- 撃つ（自機から）
  function fireWeapon(s, k, ctx) {
    const slot = s.slots[k];
    const w = slot.id, L = slot.lv, R = s.rock, sh = s.ship;
    const max2 = (RANGE * CELL) * (RANGE * CELL);
    const near = ctx.near;
    if (!(near >= 0) || ctx.nearD > RANGE * CELL) return false;
    const x = sh.x, y = sh.y;
    const d = dmg(w, L);
    const room = () => s.shots.length < SHOTS_MAX;
    if (w === "shot" || w === "spread" || w === "fire") {
      let tgt = near;
      if (w === "fire") {
        const hot = hotSet(s);
        if (hot.has(near)) {
          const { list } = liveEdges(R);
          const t2 = nearestIn(R, list, x, y, 0, hot, max2);
          if (t2 >= 0) tgt = t2;
        }
      }
      const tx = cellX(R, tgt), ty = cellY(R, tgt);
      const ang = Math.atan2(ty - y, tx - x);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      ctx.evs.push({ kind: "fire", k, w, x, y, ang, tx, ty });
      if (w === "spread") {
        const n = shapeOf(w, L);
        const fan = 0.375 * (8 + 2 * (n - 5) / 2) * DEG;
        for (let j = 0; j < n && room(); j++) {
          const a = ang + (j - (n - 1) / 2) * fan / (1 + (n - 5) / 4);
          s.shots.push({ k, w, x, y, vx: Math.cos(a) * BULLET_SPEED, vy: Math.sin(a) * BULLET_SPEED, t: 0, dmg: d, dmg0: d });
        }
      } else if (w === "shot") {
        const n = shapeOf(w, L);
        for (let j = 0; j < n && room(); j++) {
          const off = (j - (n - 1) / 2) * 4;   // 連は進む向きに直角にならべる
          s.shots.push({ k, w, x: x - sa * off, y: y + ca * off, vx: ca * BULLET_SPEED, vy: sa * BULLET_SPEED, t: 0, dmg: d, dmg0: d, p: pierceOf(L) });
        }
      } else if (room()) {
        s.shots.push({ k, w, x, y, vx: ca * BULLET_SPEED, vy: sa * BULLET_SPEED, t: 0, dmg: d, aim: tgt });
      }
      return true;
    }
    if (w === "bomb") {
      if (!room()) return false;
      const r0 = shapeOf(w, L);
      const tgt = bombTarget(s, r0);
      if (tgt < 0) return false;
      let tc = (tgt % R.w) + 0.5, tr = Math.floor(tgt / R.w) + 0.5;
      const c0 = tgt % R.w, w0 = Math.floor(tgt / R.w);
      let gx = 0, gy = 0;
      for (let dr = -r0; dr <= r0; dr++) for (let dc = -r0; dc <= r0; dc++) {
        const c = c0 + dc, rr = w0 + dr;
        if (dc * dc + dr * dr > r0 * r0 || c < 0 || c >= R.w || rr < 0 || rr >= R.h || !R.mats[rr * R.w + c]) continue;
        gx += dc; gy += dr;
      }
      CELLS += (2 * r0 + 1) * (2 * r0 + 1);
      const gl = Math.hypot(gx, gy);
      if (gl > 1e-9) { tc += gx / gl * BOMB_SHIFT * r0; tr += gy / gl * BOMB_SHIFT * r0; }
      const tx = tc * CELL, ty = tr * CELL;
      ctx.evs.push({ kind: "fire", k, w, x, y, ang: Math.atan2(ty - y, tx - x), tx, ty });
      s.shots.push({ k, w, x, y, vx: (tx - x) / BOMB_FLIGHT, vy: (ty - y) / BOMB_FLIGHT, t: 0, dmg: d, sx: x, sy: y, tc, tr, r: r0 });
      return true;
    }
    if (w === "bolt") {
      const g = geoOf(R);
      if (g.irons.length > 2 * g.ironLive + 64) { const nl = []; for (const i of g.irons) if (R.mats[i] === 2) nl.push(i); g.irons = nl; }
      let tgt = g.ironLive > 0 ? nearestIn(R, g.irons, x, y, 2, null, max2) : -1;
      if (tgt < 0) tgt = near;
      const tx = cellX(R, tgt), ty = cellY(R, tgt);
      ctx.evs.push({ kind: "fire", k, w, x, y, ang: Math.atan2(ty - y, tx - x), tx, ty });
      const tree = boltTree(s, tgt, shapeOf(w, L));
      ctx.evs.push({ kind: "bolt", from: tgt, path: tree.cells.slice(), edges: tree.edges, x, y });
      for (let q = 0; q < tree.cells.length; q++) hurt(s, tree.cells[q], d * tree.pw[q], w, ctx);
      return true;
    }
    if (w === "beam") {
      const b = beamTarget(s, near);
      if (!b) return false;
      fireBeam(s, k, b.ang, shapeOf(w, L), d, ctx);
      return true;
    }
    return false;
  }
  // いなずま：ねらったマスから上下左右へ、どの種類のマスへも伝わる。威力は 1 から始まり、1 マス伝わるごとに
  // てつ へは × BOLT_KEEP.iron、ほかへは × BOLT_KEEP.other。BOLT_MIN 未満になる先へは伝わらない。
  // 威力の大きい先から順に（同じなら種つきのハッシュの順）、最大 n マス。pw[q] は cells[q] の威力
  function boltTree(s, start, n) {
    const R = s.rock, cols = R.w, mats = R.mats, N = mats.length;
    const cells = [start], pw = [1], edges = [], seen = new Set([start]);
    const salt = hash2(s.seed >>> 0, Math.floor(s.t * 30) >>> 0);
    const front = [];
    const grow = (j, p) => {
      const c = j % cols;
      const nb = [];
      if (j >= cols) nb.push(j - cols);
      if (c > 0) nb.push(j - 1);
      if (c < cols - 1) nb.push(j + 1);
      if (j + cols < N) nb.push(j + cols);
      for (const q of nb) {
        CELLS++;
        if (seen.has(q) || !mats[q]) continue;
        const np = p * (mats[q] === 2 ? BOLT_KEEP.iron : BOLT_KEEP.other);
        if (np < BOLT_MIN - 1e-9) continue;
        front.push([np, q, j, hash2(salt, q)]);
      }
    };
    grow(start, 1);
    while (cells.length < n && front.length) {
      let bi = 0;
      for (let k = 1; k < front.length; k++) { const x = front[k], y = front[bi]; if (x[0] > y[0] + 1e-12 || (Math.abs(x[0] - y[0]) <= 1e-12 && x[3] < y[3])) bi = k; }
      const f = front[bi]; front[bi] = front[front.length - 1]; front.pop();
      if (seen.has(f[1])) continue;
      seen.add(f[1]); cells.push(f[1]); pw.push(f[0]); edges.push([f[2], f[1]]);
      grow(f[1], f[0]);
    }
    return { cells, edges, pw };
  }
  // ビーム：光の通り道（幅 Wc マス）を、最初に当たったマスから奥へ BEAM_DEPTH マスまで全部
  function fireBeam(s, k, ang, Wc, d, ctx) {
    const R = s.rock, sh = s.ship;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const LEN = (RANGE + BEAM_DEPTH + 4) * CELL;
    const m = 2 * Wc - 1;
    const lines = [];
    let d0 = Infinity;
    for (let j = 0; j < m; j++) {
      const off = (j - (m - 1) / 2) * CELL / 2;
      const x0 = sh.x - sa * off, y0 = sh.y + ca * off;
      const got = [];
      dda(R, x0, y0, x0 + ca * LEN, y0 + sa * LEN, (i, t) => {
        const dd = t * LEN;
        if (dd > d0 + BEAM_DEPTH * CELL) return true;
        if (R.mats[i]) { got.push(i, dd); if (dd < d0) d0 = dd; }
        return false;
      });
      lines.push(got);
    }
    const len = d0 === Infinity ? RANGE * CELL : d0 + BEAM_DEPTH * CELL;
    const cells = [];
    if (d0 !== Infinity) {
      const seen = new Set();
      for (const got of lines) for (let q = 0; q < got.length; q += 2) {
        const i = got[q];
        if (got[q + 1] < d0 + BEAM_DEPTH * CELL - 1e-6 && !seen.has(i)) { seen.add(i); cells.push(i); }
      }
    }
    ctx.evs.push({ kind: "fire", k, w: "beam", x: sh.x, y: sh.y, ang, tx: sh.x + ca * len, ty: sh.y + sa * len });
    ctx.evs.push({ kind: "beam", k, x: sh.x, y: sh.y, ang, len, w: Wc * CELL, cells: cells.slice() });
    for (const i of cells) hurt(s, i, d, "beam", ctx);
  }

  // ---------------------------------------------------------------- 1 step
  function stepMut(s, dt, evs) {
    const ctx = { evs, broke: false, removed: [], near: -1, nearD: Infinity };
    if (s.phase === "choose" || s.phase === "end" || s.phase === "lost") return;
    if (s.phase === "clear") {
      s.t += dt;
      s.wait -= dt;
      if (s.wait <= 1e-9) { s.wait = 0; nextStar(s, evs); }
      return;
    }
    if (s.phase !== "fly") s.phase = "fly";
    s.t += dt;
    s.left = Math.max(0, s.left - dt);
    // 1. 自機が動く
    moveShip(s, dt, ctx);
    // 2. 撃つ（hold なら撃たない。届く所にマスが無ければ待つ）
    if (!s.hold && ctx.near >= 0 && ctx.nearD <= RANGE * CELL) {
      for (let k = 0; k < s.slots.length; k++) {
        if (!(s.t + 1e-9 >= s.cd[k])) continue;
        if (s.rock.left <= 0) break;
        if (!fireWeapon(s, k, ctx)) continue;
        const rate = rateOf(s.slots[k].id, s.slots[k].lv);
        s.cd[k] = s.cd[k] + rate > s.t ? s.cd[k] + rate : s.t + rate;
      }
    }
    // 3. 弾が飛んで当たる
    if (s.shots.length) {
      const keep = [];
      const R0 = s.rock, gw = R0.w * CELL, gh = R0.h * CELL;
      for (const b of s.shots) {
        b.t += dt;
        if (b.w === "bomb") {
          const tx = b.tc * CELL, ty = b.tr * CELL;
          const f = Math.min(1, b.t / BOMB_FLIGHT);
          const nx = b.sx + (tx - b.sx) * f, ny = b.sy + (ty - b.sy) * f - Math.sin(Math.PI * f) * 60;
          if (dt > 0) { b.vx = (nx - b.x) / dt; b.vy = (ny - b.y) / dt; }
          b.x = nx; b.y = ny;
          if (b.t + 1e-9 >= BOMB_FLIGHT) {
            const R = s.rock;
            ctx.evs.push({ kind: "boom", x: tx, y: ty, r: b.r * CELL });
            const rr = b.r * b.r;
            const c0 = Math.floor(b.tc - b.r - 1), c1 = Math.ceil(b.tc + b.r + 1), r0 = Math.floor(b.tr - b.r - 1), r1 = Math.ceil(b.tr + b.r + 1);
            for (let r = Math.max(0, r0); r <= Math.min(R.h - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(R.w - 1, c1); c++) {
              const dc = c + 0.5 - b.tc, dr = r + 0.5 - b.tr;
              const i = r * R.w + c;
              if (dc * dc + dr * dr <= rr + 1e-9 && s.rock.mats[i]) hurt(s, i, b.dmg, "bomb", ctx);
            }
            continue;
          }
          keep.push(b);
          continue;
        }
        const x0 = b.x, y0 = b.y;
        b.x += b.vx * dt; b.y += b.vy * dt;
        let gone = false;
        const R = s.rock;
        dda(R, x0, y0, b.x, b.y, (i) => {
          if (!R.mats[i] || i === b.h) return false;
          if (b.w === "fire") { ignite(s, i, ctx); gone = true; return true; }
          const thru = b.h !== undefined;
          const hp0 = R.hp[i], aff = affOf(b.w, matOf(R.mats[i]));
          const broke = hurt(s, i, b.dmg, b.w, ctx);
          if (thru) { const e = ctx.evs[ctx.evs.length - 1]; if (e && e.i === i) e.thru = true; }
          b.h = i;
          // 余った力で奥へ進む（マスが細かいので、こわしたマスの体力より強い分は うしろのマスへ。CARRY_MIN より小さければ消える）
          if (broke) { const rest = b.dmg - hp0 / aff; if (rest > b.dmg0 * CARRY_MIN) { b.dmg = rest; return false; } }
          if (b.p > 0) { b.p--; b.dmg *= SHOT_UP.keep; return false; }
          gone = true; return true;
        });
        if (gone) continue;
        if (b.t > BULLET_LIFE) continue;
        if (b.h !== undefined && (b.x < 0 || b.y < 0 || b.x > gw || b.y > gh)) continue;   // 通りぬけて格子の外へ出た たまは消す
        keep.push(b);
      }
      s.shots = keep;
    }
    // 4. 燃える
    if (s.burns.length) {
      const per = dmg("fire", slotLv(s, "fire"));
      const keep = [], add = [], moved = [];
      for (const b of s.burns) {
        if (!s.rock.mats[b.i]) continue;
        if (!b.spread && s.t + 1e-9 >= b.at + BURN_SPREAD_SEC) {
          b.spread = true;
          const R = s.rock, c = b.i % R.w;
          const nb = [];
          if (c > 0) nb.push(b.i - 1);
          if (c < R.w - 1) nb.push(b.i + 1);
          if (b.i >= R.w) nb.push(b.i - R.w);
          if (b.i + R.w < R.mats.length) nb.push(b.i + R.w);
          for (const q of nb) if (R.mats[q] === 3) add.push(q);
        }
        const broke = hurt(s, b.i, per * dt, "fire", ctx, true);
        if (!broke) { if (s.t < b.until) keep.push(b); continue; }
        if (s.t < b.until) moved.push(b);
      }
      s.burns = keep;
      for (const b of moved) {
        const R = s.rock, c = b.i % R.w;
        const nb = [];
        if (b.i >= R.w) nb.push(b.i - R.w);
        if (c > 0) nb.push(b.i - 1);
        if (c < R.w - 1) nb.push(b.i + 1);
        if (b.i + R.w < R.mats.length) nb.push(b.i + R.w);
        let to = -1;
        for (const q of nb) {
          CELLS++;
          if (!R.mats[q] || s.burns.some((x) => x.i === q)) continue;
          if (to < 0 || (R.mats[q] === 3 && R.mats[to] !== 3)) to = q;
        }
        if (to >= 0) { s.burns.push({ i: to, until: b.until, at: b.at, spread: true }); ctx.evs.push({ kind: "burn", i: to }); }
      }
      for (const q of add) if (s.rock.mats[q]) ignite(s, q, ctx, true);
    }
    // 5. はなれたかたまり
    if (ctx.removed.length && s.rock.left > 0) breakLoose(s, ctx);
    if (ctx.broke) {
      const R = s.rock, g = geoOf(R);
      R.gen = (isNum(R.gen) ? R.gen : 0) + 1;
      if (g.n > 0) { R.cx = (g.sc / g.n + 0.5) * CELL; R.cy = (g.sr / g.n + 0.5) * CELL; }
      milestones(s, evs);
    }
    // 6. クリア／時間切れ
    if (s.rock.left <= 0) {
      const bonus = Math.floor(s.rock.value * CLEAR_BONUS);
      addK(s, bonus);
      s.totals.stars++;
      s.phase = "clear"; s.wait = CLEAR_SEC; s.shots = []; s.burns = []; s.hold = false;
      const time = Math.max(0.1, Math.round((s.limit - s.left) * 10) / 10);
      const bt = isObj(s.bestT) ? s.bestT : {};
      const btKey = numIn(s.star, s.tier);   // 通しの番号（ふつうの星 5 とハードの星 5 は別の記録）
      const prev = isNum(bt[btKey]) ? bt[btKey] : null;
      if (prev === null || time < prev) s.bestT = trimBest(Object.assign({}, bt, { [btKey]: time }));
      evs.push({ kind: "clear", star: s.star, tier: tierOk(s.tier), num: numIn(s.star, s.tier), bonus, time, best: prev, left: Math.round(s.left * 10) / 10 });
    } else if (s.left <= 1e-9) {
      const broken = progressS(s).broken;
      s.left = 0;
      s.phase = "lost"; s.shots = []; s.burns = []; s.hold = false;
      s.tries = Math.min(TRIES_MAX, s.tries + 1);
      evs.push({ kind: "lost", star: s.star, broken });
    }
  }
  function milestones(s, evs) {
    const R = s.rock;
    if (!(R.total > 0)) return;
    const broken = 1 - R.left / R.total;
    const got = Array.isArray(s.ms) ? s.ms : [];
    for (const pct of MILESTONES) {
      if (broken < pct / 100 - 1e-12 || got.includes(pct)) continue;
      const bonus = Math.floor(R.value * MILESTONE_BONUS);
      addK(s, bonus);
      s.ms = (Array.isArray(s.ms) ? s.ms : []).concat(pct);
      evs.push({ kind: "milestone", pct, bonus });
    }
  }
  function trimBest(bt) {
    const keys = Object.keys(bt);
    if (keys.length <= BEST_MAX) return bt;
    const keep = keys.map(Number).sort((a, b) => b - a).slice(0, BEST_MAX);
    const o = {};
    for (const k of keep) o[k] = bt[k];
    return o;
  }
  // 入れ替えの予約を当てる（次の星の始め・やり直しの始め）。Lv は武器ごと：外した武器はその Lv で ひかえ へ
  function applySwaps(s, evs) {
    if (!Array.isArray(s.swap) || !s.swap.length) { s.swap = []; return; }
    for (const p of s.swap) {
      const k = p.slot;
      if (!Number.isInteger(k) || k < 0 || k >= s.slots.length) continue;
      const bi = s.bench.findIndex((x) => x.id === p.id);
      if (bi < 0 || s.slots[k].id === p.id) continue;
      const out = s.slots[k], inn = s.bench[bi];
      s.slots[k] = { id: inn.id, lv: inn.lv };
      s.bench[bi] = { id: out.id, lv: out.lv };
      evs.push({ kind: "swap", slot: k, from: out.id, to: inn.id, lv: inn.lv });
    }
    s.swap = [];
  }
  function resetTry(s) {
    s.rock = genRock(s.seed, s.star, s.tier);
    s.rock.key = rockKey(s);
    s.limit = limitTry(s.star, s.tier, s.tries);
    s.left = s.limit;
    s.shots = []; s.burns = []; s.hold = false;
    s.cd = s.slots.map(() => s.t);
    s.ship = startShip(s);
  }
  function retryMut(s, evs) {
    s.phase = "fly";
    applySwaps(s, evs);
    resetTry(s);   // 区切り（ms）はそのまま：やり直しでもらい直せない
  }
  // 時間切れのカードの「もういちど」：その星を最初の形から（かけら・Lv・武器はそのまま。残り時間も戻る。入れ替えの予約はここで当たる）
  function retry(state) {
    try {
      if (!isState(state)) return { state, ok: false, reason: "state", events: [] };
      if (state.phase !== "lost") return { state, ok: false, reason: "phase", events: [] };
      const s = cloneForStep(state);
      const events = [];
      retryMut(s, events);
      return { state: s, ok: true, events };
    } catch (e) { return { state, ok: false, reason: "error", events: [] }; }
  }
  // 次の星。星 30（どの段でも）のあとは、その段のエンディング（ending { tier: クリアした段 }・phase end）で、次の段の星 1 に進んでおく
  function nextStar(s, evs) {
    const was = s.star, wasTier = tierOk(s.tier);
    const end = was >= starsOf(wasTier);
    if (end) { s.tier = Math.min(TIER_MAX, wasTier + 1); s.star = 1; } else s.star = was + 1;
    s.tries = 1;
    applySwaps(s, evs);
    resetTry(s);
    s.ms = [];
    if (end) {
      s.cleared = true;
      s.phase = "end";
      evs.push({ kind: "ending", tier: wasTier, next: s.tier });
      return;
    }
    s.phase = "fly";
    if (s.star % BOSS_EVERY === 0) evs.push({ kind: "boss", star: s.star });
  }

  // エンディングのカードを閉じたとき（「ハードを はじめる」「つぎの だんへ」）：phase end から、次の段の星 1 を fly で始める
  function afterEnding(state) {
    try {
      if (!isState(state)) return { state, ok: false, reason: "state" };
      if (state.phase !== "end") return { state, ok: false, reason: "phase" };
      const s = cloneForStep(state);
      s.phase = "fly";
      s.cd = s.slots.map(() => s.t);
      return { state: s, ok: true };
    } catch (e) { return { state, ok: false, reason: "error" }; }
  }
  function step(state, dt) {
    try {
      if (!isState(state)) return null;
      dt = isNum(dt) ? clamp(dt, 0, 0.1) : 0;
      const s = cloneForStep(state);
      const events = [];
      OWN_HP = null; OWN_MATS = null; OWN_DIRTY = null;
      stepMut(s, dt, events);
      OWN_HP = null; OWN_MATS = null; OWN_DIRTY = null;
      return { state: s, events };
    } catch (e) { OWN_HP = null; OWN_MATS = null; OWN_DIRTY = null; return null; }
  }

  // ---------------------------------------------------------------- 画面用の値
  function nominalHits(w, L) {
    const v = shapeOf(w, L);
    if (w === "shot") return v;
    if (w === "spread") return v * 1.0;
    if (w === "bomb") { let n = 0; const r = Math.ceil(v); for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (a * a + b * b <= v * v + 1e-9) n++; return n * 0.9; }
    if (w === "bolt") return v * 0.65;
    if (w === "beam") return v * BEAM_DEPTH * 0.9;
    if (w === "fire") return v;
    return 1;
  }
  function dpsRaw(w, L) { return dmg(w, L) * nominalHits(w, L) / rateOf(w, L); }
  function dpsOf(state, slot) {
    try {
      if (!isObj(state) || !Array.isArray(state.slots)) return null;
      const x = state.slots[slot];
      if (!x || !W[x.id]) return null;
      return Math.max(1, Math.round(dpsRaw(x.id, x.lv)));
    } catch (e) { return null; }
  }
  function cellHpAt(state, i) {
    try { return isState(state) && Number.isInteger(i) && i >= 0 && i < state.rock.mats.length ? fullHp(state, i) : null; } catch (e) { return null; }
  }
  function upCostOf(state, slot) {
    try {
      if (!isObj(state) || !Array.isArray(state.slots)) return null;
      const x = state.slots[slot];
      if (!x || !W[x.id]) return null;
      return upCost(x.id, x.lv);
    } catch (e) { return null; }
  }
  function ownedCount(s) { return s.slots.length + (Array.isArray(s.bench) ? s.bench.length : 0); }
  function slotCostOf(state) {
    try {
      if (!isObj(state) || !Array.isArray(state.slots)) return null;
      const n = ownedCount(state);
      return n >= 1 && n < W_IDS.length ? SLOT_COST[n] : null;
    } catch (e) { return null; }
  }
  function progressS(s) {
    const R = s.rock;
    const total = R.total, left = R.left;
    const broken = total > 0 ? clamp(1 - left / total, 0, 1) : 0;
    const tier = tierOk(s.tier);
    const lim = isNum(s.limit) && s.limit > 0 ? s.limit : limitOf(s.star, tier);
    const timeLeft = isNum(s.left) ? clamp(s.left, 0, lim) : lim;
    return { broken, left, total, timeLeft, timeFrac: clamp(timeLeft / lim, 0, 1), tier, star: s.star, num: numIn(s.star, tier), hard: tier > 0 };
  }
  function progressOf(state) {
    try { return isState(state) ? progressS(state) : null; } catch (e) { return null; }
  }
  // 残り時間の書き方（"m:ss"。秒は切り上げ。おかしな値は "0:00"）
  function formatTime(sec) {
    try {
      if (!isNum(sec) || sec <= 0) return "0:00";
      const t = Math.min(Math.ceil(sec - 1e-9), 99 * 60 + 59);
      const m = Math.floor(t / 60), ss = t % 60;
      return m + ":" + (ss < 10 ? "0" : "") + ss;
    } catch (e) { return "0:00"; }
  }

  // ---------------------------------------------------------------- 買う・開ける・選ぶ・入れ替え
  function shallow(s) {
    const c = Object.assign({}, s);
    c.rock = Object.assign({}, s.rock);
    c.slots = s.slots.map((x) => ({ id: x.id, lv: x.lv }));
    c.bench = Array.isArray(s.bench) ? s.bench.map((x) => ({ id: x.id, lv: x.lv })) : [];
    c.swap = Array.isArray(s.swap) ? s.swap.map((x) => ({ slot: x.slot, id: x.id })) : [];
    c.cd = Array.isArray(s.cd) ? s.cd.slice() : [];
    c.ship = isObj(s.ship) ? Object.assign({}, s.ship) : null;
    c.totals = Object.assign({}, s.totals);
    c.offer = s.offer ? s.offer.slice() : null;
    fixParts(c);
    return c;
  }
  function upgradeMut(s, slot) {
    const x = s.slots[slot];
    const cost = upCost(x.id, x.lv);
    if (cost === null) return "max";
    if (s.kakera < cost) return "money";
    s.kakera = capK(s.kakera - cost);
    x.lv++;
    return null;
  }
  function upgrade(state, slot) {
    try {
      if (!isState(state) || !Number.isInteger(slot) || !state.slots[slot] || !W[state.slots[slot].id]) return { state, ok: false, reason: "slot" };
      const s = shallow(state);
      const why = upgradeMut(s, slot);
      if (why) return { state, ok: false, reason: why };
      const lv = s.slots[slot].lv;
      const events = lv % EVOLVE_EVERY === 0 || (s.slots[slot].id === "shot" && SHOT_UP.pierce.includes(lv)) ? [{ kind: "evolve", slot, lv }] : [];
      return { state: s, ok: true, events };
    } catch (e) { return { state, ok: false, reason: "error" }; }
  }
  function makeOffer(s) {
    const have = new Set(s.slots.map((x) => x.id).concat((s.bench || []).map((x) => x.id)));
    const pool = W_IDS.filter((id) => !have.has(id));
    if (pool.length < 1) return null;
    if (pool.length === 1) return [pool[0]];
    const a = pool[Math.floor(rngOf(s) * pool.length)];
    let rest = pool.filter((id) => id !== a && W[id].good !== W[a].good);
    if (!rest.length) rest = pool.filter((id) => id !== a);
    const b = rest[Math.floor(rngOf(s) * rest.length)];
    return [a, b];
  }
  function unlockMut(s) {
    if (s.phase === "choose" || s.offer) return "choose";
    const cost = slotCostOf(s);
    if (cost === null) return "all";
    if (s.kakera < cost) return "money";
    const offer = makeOffer(s);
    if (!offer) return "all";
    s.kakera = capK(s.kakera - cost);
    s.offer = offer;
    s.back = s.phase;
    s.phase = "choose";
    return null;
  }
  function unlock(state) {
    try {
      if (!isState(state)) return { state, ok: false, reason: "state" };
      if (state.phase === "end") return { state, ok: false, reason: "phase" };
      const s = shallow(state);
      const why = unlockMut(s);
      if (why) return { state, ok: false, reason: why };
      return { state: s, ok: true };
    } catch (e) { return { state, ok: false, reason: "error" }; }
  }
  // 選んだ武器は Lv1 で、枠が 4 つ未満なら新しい枠に、4 つなら ひかえ に入る。返り値は 'slot'|'bench'（失敗は null）
  function chooseMut(s, k) {
    if (s.phase !== "choose" || !Array.isArray(s.offer) || !Number.isInteger(k) || k < 0 || k >= s.offer.length) return null;
    const id = s.offer[k];
    if (!W[id] || s.slots.some((x) => x.id === id) || s.bench.some((x) => x.id === id)) return null;
    let to;
    if (s.slots.length < SLOTS_MAX) {
      s.slots.push(newSlot(id));
      s.cd.push(s.t);
      to = "slot";
    } else {
      s.bench.push(newSlot(id));
      to = "bench";
    }
    s.offer = null;
    s.phase = ["fly", "lost", "clear", "end"].includes(s.back) ? s.back : "fly";
    s.back = "fly";
    return to;
  }
  function choose(state, k) {
    try {
      if (!isState(state)) return { state, ok: false, to: null };
      const s = shallow(state);
      const to = chooseMut(s, k);
      if (!to) return { state, ok: false, to: null };
      return { state: s, ok: true, to, events: [] };
    } catch (e) { return { state, ok: false, to: null }; }
  }
  function swapChoicesOf(state, slot) {
    try {
      if (!isState(state) || !Number.isInteger(slot) || slot < 0 || slot >= state.slots.length) return null;
      const bench = Array.isArray(state.bench) ? state.bench : [];
      const sw = Array.isArray(state.swap) ? state.swap : [];
      const used = new Set(sw.filter((p) => p && p.slot !== slot).map((p) => p.id));
      return [state.slots[slot].id].concat(bench.filter((x) => x && W[x.id] && !used.has(x.id)).map((x) => x.id));
    } catch (e) { return null; }
  }
  function reserveSwapMut(s, slot, id) {
    if (s.phase === "end") return "phase";
    if (!Number.isInteger(slot) || slot < 0 || slot >= s.slots.length) return "slot";
    if (typeof id !== "string" || !W[id]) return "id";
    s.swap = s.swap.filter((p) => p.slot !== slot);
    if (id === s.slots[slot].id) return null;
    if (!s.bench.some((x) => x.id === id) || s.swap.some((p) => p.id === id)) return "bench";
    s.swap.push({ slot, id });
    s.swap.sort((a, b) => a.slot - b.slot);
    return null;
  }
  function reserveSwap(state, slot, id) {
    try {
      if (!isState(state)) return { state, ok: false, reason: "state" };
      const s = shallow(state);
      const why = reserveSwapMut(s, slot, id);
      if (why) return { state, ok: false, reason: why };
      return { state: s, ok: true };
    } catch (e) { return { state, ok: false, reason: "error" }; }
  }

  // ---------------------------------------------------------------- かけらの書き方
  function formatKakera(n) {
    try {
      if (n === Infinity) n = KAKERA_MAX;
      if (!isNum(n) || n < 0) n = 0;
      n = Math.floor(Math.min(n, KAKERA_MAX));
      if (n < 10000) return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      const units = [[1e12, "ちょう"], [1e8, "おく"], [1e4, "まん"]];
      for (const [u, name] of units) {
        if (n >= u) {
          const tenths = Math.floor(n / (u / 10));
          const whole = Math.floor(tenths / 10);
          if (whole >= 100) return whole + name;
          const f = tenths % 10;
          return f ? whole + "." + f + name : whole + name;
        }
      }
      return String(n);
    } catch (e) { return "0"; }
  }

  // ---------------------------------------------------------------- 保存（v:3）
  function saveObj(state, withMid) {
    let star = state.star, tier = tierOk(state.tier), cleared = !!state.cleared, tries = state.tries, ms = Array.isArray(state.ms) ? state.ms.slice() : [];
    let slots = state.slots.map((x) => ({ id: x.id, lv: x.lv }));
    let bench = (Array.isArray(state.bench) ? state.bench : []).map((x) => ({ id: x.id, lv: x.lv }));
    let swap = (Array.isArray(state.swap) ? state.swap : []).map((x) => ({ slot: x.slot, id: x.id }));
    // クリアの演出中（phase 'clear'、または 2択の間で戻り先が 'clear'）は次の星を保存する（星 30 なら次の段の星 1。エンディングのカードは開き直すと出ない）。
    // 時間切れの間（phase 'lost'、または 2択の間で戻り先が 'lost'）は、やり直しの始めに当たる予約を先に当てて書く（tries は増えたまま）。
    // どちらも、入れ替えの予約を当てた slots・bench と swap: [] で書く
    const ph = state.phase === "choose" ? state.back : state.phase;
    const toNext = ph === "clear";
    if (toNext) {
      if (state.star >= starsOf(tier)) { star = 1; tier = Math.min(TIER_MAX, tier + 1); cleared = true; } else star = state.star + 1;
      tries = 1; ms = [];
    }
    if (toNext || ph === "lost") {
      const tmp = { slots, bench, swap };
      applySwaps(tmp, []);
      slots = tmp.slots; bench = tmp.bench; swap = [];
    }
    const t = state.totals || {};
    const o = {
      v: SAVE_VERSION, tier, star, kakera: state.kakera, kfrac: isNum(state.kfrac) && state.kfrac >= 0 && state.kfrac < 1 ? state.kfrac : 0,
      slots, bench, offer: state.offer ? state.offer.slice() : null, swap, cleared, tries,
      totals: { cells: t.cells | 0, stars: t.stars | 0, kakera: isNum(t.kakera) ? t.kakera : 0, chunks: t.chunks | 0, glows: t.glows | 0 },
      seed: state.seed, rng: state.rng, ms, bestT: isObj(state.bestT) ? Object.assign({}, state.bestT) : {}
    };
    if (withMid) { const m = midOf(state); if (m) o.mid = m; }
    return o;
  }
  function midOf(state) {
    if (state.phase !== "fly" && !(state.phase === "choose" && (state.back === "fly" || state.back === undefined))) return null;
    const R = state.rock;
    if (!R || !(R.left > 0)) return null;
    const N = R.mats.length;
    const mats = new Array(N), hp = new Array(N);
    for (let i = 0; i < N; i++) {
      const m = R.mats[i] | 0;
      mats[i] = m;
      if (!m) { hp[i] = 0; continue; }
      const full = fullHp(state, i);
      const f = full > 0 && isNum(R.hp[i]) ? R.hp[i] / full : 1;
      hp[i] = clamp(Math.ceil(f * 9 - 1e-9), 1, 9);
    }
    const left = isNum(state.left) ? Math.max(0, Math.round(state.left * 10) / 10) : null;
    const o = { mats: rleEncode(mats), hp: rleEncode(hp) };
    if (left !== null) o.left = left;
    return o;
  }
  function makeSave(state) {
    try {
      if (!isState(state)) return null;
      return JSON.stringify(saveObj(state, true));
    } catch (e) { return null; }
  }
  function parseRaw(raw) {
    let o = raw;
    if (typeof raw === "string") o = JSON.parse(raw);
    return o;
  }
  // 保存の版（1 以上の整数）。読めない・版が無いときは null
  function saveVersionOf(raw) {
    try {
      const o = parseRaw(raw);
      if (!isObj(o)) return null;
      return Number.isInteger(o.v) && o.v >= 1 && o.v <= 999 ? o.v : null;
    } catch (e) { return null; }
  }
  const intIn = (x, lo, hi, def) => (isNum(x) ? clamp(Math.floor(x), lo, hi) : def);
  // v:3 だけを読む（v:1・v:2・ほかの版・読めない値は null。ユーザー決定「最初から」）
  function loadSave(raw) {
    try {
      const o = parseRaw(raw);
      if (!isObj(o) || o.v !== SAVE_VERSION) return null;
      const seed = isNum(o.seed) ? Math.floor(Math.abs(o.seed)) >>> 0 : 1;
      // 段：0 以上の整数（無い・壊れた値は 0）。星は段の中の 1〜30（30 より大きい値は通しの番号として段に直す）
      const q = split(intIn(o.star, 1, STAR_MAX, 1), intIn(o.tier, 0, TIER_MAX, 0));
      const star = q.k, tier = q.t;
      const kakera = intIn(o.kakera, 0, KAKERA_MAX, 0);
      const kfrac = isNum(o.kfrac) && o.kfrac >= 0 && o.kfrac < 1 ? o.kfrac : 0;
      // 武器：重複は後ろを捨てる・知らない id は捨てる・lv は 1〜99。空なら たま Lv1。5 つ目からは ひかえ へ回す（捨てない）
      const seen = new Set();
      const slots = [], over = [];
      for (const x of Array.isArray(o.slots) ? o.slots : []) {
        if (!isObj(x) || typeof x.id !== "string" || !W[x.id] || seen.has(x.id)) continue;
        seen.add(x.id);
        const it = { id: x.id, lv: intIn(x.lv, 1, LEVEL_MAX, 1) };
        if (slots.length < SLOTS_MAX) slots.push(it); else over.push(it);
      }
      if (!slots.length) { slots.push({ id: "shot", lv: 1 }); seen.add("shot"); }
      const bench = over.slice();
      for (const x of Array.isArray(o.bench) ? o.bench : []) {
        if (!isObj(x) || typeof x.id !== "string" || !W[x.id] || seen.has(x.id)) continue;
        seen.add(x.id);
        bench.push({ id: x.id, lv: intIn(x.lv, 1, LEVEL_MAX, 1) });
      }
      const swap = [];
      for (const p of Array.isArray(o.swap) ? o.swap : []) {
        if (!isObj(p) || !Number.isInteger(p.slot) || p.slot < 0 || p.slot >= slots.length || typeof p.id !== "string") continue;
        if (!bench.some((x) => x.id === p.id) || swap.some((q) => q.slot === p.slot || q.id === p.id)) continue;
        swap.push({ slot: p.slot, id: p.id });
      }
      swap.sort((a, b) => a.slot - b.slot);
      const rng = isNum(o.rng) ? Math.floor(Math.abs(o.rng)) >>> 0 : hash2(seed, 0x2b);
      const tries = intIn(o.tries, 1, TRIES_MAX, 1);
      const tt = isObj(o.totals) ? o.totals : {};
      const totals = { cells: intIn(tt.cells, 0, KAKERA_MAX, 0), stars: intIn(tt.stars, 0, KAKERA_MAX, 0), kakera: intIn(tt.kakera, 0, KAKERA_MAX, 0), chunks: intIn(tt.chunks, 0, KAKERA_MAX, 0), glows: intIn(tt.glows, 0, KAKERA_MAX, 0) };
      let cleared = o.cleared === true;
      if (tier > 0) cleared = true;
      const ms = Array.isArray(o.ms) ? MILESTONES.filter((p) => o.ms.includes(p)) : [];
      const bestT = {};
      if (isObj(o.bestT)) for (const k of Object.keys(o.bestT)) {
        const v = o.bestT[k];
        if (!/^[1-9][0-9]{0,3}$/.test(k) || Number(k) > STAR_MAX || !isNum(v) || v <= 0 || v > 1e7) continue;
        bestT[Number(k)] = Math.max(0.1, Math.round(v * 10) / 10);
      }
      const base = { tier, star, kakera, kfrac, slots, bench, swap, offer: null, cleared, tries, totals, seed, rng, mid: o.mid, ms, bestT: trimBest(bestT) };
      if (o.offer !== null && o.offer !== undefined && seen.size < W_IDS.length) {
        const f = o.offer;
        const pool = W_IDS.filter((id) => !seen.has(id));
        const want = pool.length === 1 ? 1 : 2;
        const okOffer = Array.isArray(f) && f.length === want && f.every((id) => typeof id === "string" && W[id] && !seen.has(id)) && (want === 1 || f[0] !== f[1]);
        base.offer = okOffer ? f.slice() : makeOffer(base);
      }
      return makeState(base);
    } catch (e) { return null; }
  }
  function validateBest(raw) {
    try {
      const n = typeof raw === "string" ? Number(raw.trim() === "" ? NaN : raw) : raw;
      if (!isNum(n) || n < 0) return 0;
      return clamp(Math.floor(n), 0, STAR_MAX);
    } catch (e) { return 0; }
  }

  // ---------------------------------------------------------------- 自動プレイ（測る）
  function mixOf(n) {
    const m = starInfo(n).mix;
    const w = { rock: Math.max(0, 1 - m.iron - m.ice) * MAT_HP.rock, iron: m.iron * MAT_HP.iron, ice: m.ice * MAT_HP.ice };
    const sum = w.rock + w.iron + w.ice;
    return { rock: w.rock / sum, iron: w.iron / sum, ice: w.ice / sum };
  }
  function fitOf(w, mix) { let a = 0; for (const k in mix) a += mix[k] * affOf(w, k); return a; }
  function effDps(w, L, mix) { return dpsRaw(w, L) * fitOf(w, mix); }
  function aheadMix(n) {
    const m = { rock: 0, iron: 0, ice: 0 };
    for (let k = 1; k <= 10; k++) { const x = mixOf(Math.min(STAR_MAX, n + k)); m.rock += x.rock / 10; m.iron += x.iron / 10; m.ice += x.ice / 10; }
    return m;
  }
  function numOf(s) { return numIn(s.star, s.tier); }
  function greedyBuy(s) {
    const mix = mixOf(numOf(s));
    const sc = slotCostOf(s);
    if (sc !== null && s.phase !== "choose") {
      if (s.kakera >= sc) { unlockMut(s); return "unlock"; }
      if (s.kakera >= sc * 0.5) return null;
    }
    let best = -1, br = -Infinity;
    for (let k = 0; k < s.slots.length; k++) {
      const x = s.slots[k];
      const c = upCost(x.id, x.lv);
      if (c === null) continue;
      const gain = effDps(x.id, x.lv + 1, mix) - effDps(x.id, x.lv, mix);
      const r = gain / c;
      if (r > br) { br = r; best = k; }
    }
    if (best < 0) return null;
    if (upgradeMut(s, best) === null) return "up";
    return null;
  }
  function lvReach(w, L, budget, buys) {
    let lv = L, b = budget;
    for (let g = 0; g < Math.min(LEVEL_MAX, buys); g++) { const c = upCost(w, lv); if (c === null || c > b) break; b -= c; lv++; }
    return lv;
  }
  function greedySwap(s, star, buyEvery) {
    const buys = Math.max(1, Math.ceil(90 / buyEvery));
    if (!s.bench.length) return false;
    const mix = mixOf(star);
    let best = null, bg = 1.1;
    const used = new Set(s.swap.map((p) => p.id));
    for (let k = 0; k < s.slots.length; k++) {
      if (s.swap.some((p) => p.slot === k)) continue;
      const x = s.slots[k];
      const cur = effDps(x.id, lvReach(x.id, x.lv, s.kakera, buys), mix);
      for (const b of s.bench) {
        if (used.has(b.id)) continue;
        const g = effDps(b.id, lvReach(b.id, b.lv, s.kakera, buys), mix) / Math.max(1e-9, cur);
        if (g > bg) { bg = g; best = { k, id: b.id }; }
      }
    }
    if (!best) return false;
    return reserveSwapMut(s, best.k, best.id) === null;
  }
  function pickChoice(s, policy, simRnd, order) {
    if (s.offer.length === 1) return 0;
    const [a, b] = s.offer;
    if (order) { const ia = order.indexOf(a), ib = order.indexOf(b); if (ia !== ib) return (ia < 0 ? 99 : ia) <= (ib < 0 ? 99 : ib) ? 0 : 1; }
    if (policy === "random") return simRnd() < 0.5 ? 0 : 1;
    if (policy === "worst") {
      const m = aheadMix(numOf(s));
      return fitOf(a, m) <= fitOf(b, m) ? 0 : 1;
    }
    const m = starInfo(numOf(s)).tag ? mixOf(numOf(s)) : aheadMix(numOf(s));
    const fa = fitOf(a, m), fb = fitOf(b, m);
    if (fa !== fb) return fa > fb ? 0 : 1;
    const am = aheadMix(numOf(s));
    return fitOf(a, am) >= fitOf(b, am) ? 0 : 1;
  }
  function median(a) { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; }
  // simulate(policy, opts)：policy は 'greedy'（毎秒、一番得な買い物）・'random'・'worst'・'idle'（何も買わない）。
  // opts：maxStar（ここまでクリアしたら止める。既定 ENDING_STAR）・maxSec（遊んだ時間の上限）・seed・buyEvery（何秒に 1 回買うか）・
  //   noLimit（true で時間切れにしない。limit の目安を測る用）・maxTries（同じ星の挑戦がこれをこえたら止める）・
  //   reopenEvery・reopenMid（何秒ごとに保存して開き直すか・星の途中を保存するか）・pickOrder・swap（false で入れ替えない）・start（星と武器を決めて始める）
  function simulate(policy, opts) {
    const pol = ["greedy", "random", "worst", "idle"].includes(policy) ? policy : "greedy";
    opts = isObj(opts) ? opts : {};
    const maxStar = isNum(opts.maxStar) ? Math.floor(opts.maxStar) : ENDING_STAR;
    const maxTier = isNum(opts.maxTier) ? tierOk(opts.maxTier) : 0;
    const maxSec = isNum(opts.maxSec) ? opts.maxSec : 16 * 3600;
    const seed = isNum(opts.seed) ? opts.seed : 1;
    const buyEvery = isNum(opts.buyEvery) && opts.buyEvery >= 1 ? Math.floor(opts.buyEvery) : 1;
    const reopenEvery = isNum(opts.reopenEvery) && opts.reopenEvery >= 10 ? opts.reopenEvery : 0;
    const reopenMid = opts.reopenMid !== false;
    const noLimit = opts.noLimit === true;
    const maxTries = isNum(opts.maxTries) ? opts.maxTries : 50;
    const pickOrder = Array.isArray(opts.pickOrder) ? opts.pickOrder.filter((id) => typeof id === "string") : null;
    const doSwap = opts.swap !== false && pol !== "worst" && pol !== "idle";
    const rep = {
      policy: pol, seed, buyEvery, stars: [], losts: [], firstBuySec: null, buys: 0, buyGaps: { avg: null, max: 0 }, endSec: null,
      kakeraMax: 0, shotsMax: 0, particlesMax: 0, picks: [], reopens: 0, swaps: 0, swapLog: [],
      stepCells: 0, gotAt: [], boltCells: [], glows: 0, standoff: { n: 0, sum: 0, far: 0, near: 0, max: 0 }, t: 0, error: null, final: null
    };
    const wasSim = SIM;
    SIM = true;
    try {
      let s = newGame(seed);
      if (isObj(opts.start)) {
        const st = opts.start;
        const o = loadSave(JSON.stringify({ v: SAVE_VERSION, tier: st.tier || 0, star: st.star || 1, kakera: st.kakera || 0, slots: st.slots || [{ id: "shot", lv: 1 }], bench: st.bench || [], seed, rng: hash2(seed >>> 0, 0x2b), cleared: (st.tier || 0) > 0 }));
        if (o) s = o;
      }
      fixParts(s);
      let nextReopen = reopenEvery || Infinity;
      const simRnd = makeRng(hash2(seed >>> 0, 0x51a1));
      const evs = [];
      let starStart = 0, starBuys = 0, lastBuy = 0, nextBuy = 1, starChunks = 0, starGlows = 0, flyT = 0, tryFly = 0;
      let lastPhase = s.phase, swapAsked = false;
      let b30 = null;
      const win = [];
      let partNow = 0;
      let owned = ownedCount(s);
      while (s.t < maxSec) {
        if (s.phase === "choose") {
          const k = pickChoice(s, pol, simRnd, pickOrder);
          rep.picks.push({ star: s.star, offer: s.offer.slice(), pick: s.offer[k] });
          chooseMut(s, k);
          const n = ownedCount(s);
          if (n > owned) { owned = n; rep.gotAt.push({ n, star: s.star, t: Math.round(s.t) }); }
        }
        if (s.phase === "end") s.phase = "fly";
        if ((s.phase === "clear" || s.phase === "lost") && !swapAsked) {
          swapAsked = true;
          if (doSwap && pol === "greedy") greedySwap(s, s.phase === "clear" ? numOf(s) + 1 : numOf(s), buyEvery);
          else if (doSwap && pol === "random" && s.bench.length && simRnd() < 0.3) {
            const k = Math.floor(simRnd() * s.slots.length), b = s.bench[Math.floor(simRnd() * s.bench.length)];
            reserveSwapMut(s, k, b.id);
          }
        }
        if (s.phase === "lost") {
          if (s.tries > maxTries) break;
          retryMut(s, evs);
          for (const e of evs) if (e.kind === "swap") { rep.swaps++; rep.swapLog.push({ star: s.star, slot: e.slot, from: e.from, to: e.to, lv: e.lv }); }
          evs.length = 0;
          tryFly = 0;
        }
        if (s.phase === "fly") swapAsked = false;
        if (s.t >= nextReopen && s.phase === "fly") {
          nextReopen = s.t + reopenEvery;
          const t = s.t, o = loadSave(saveObj(s, reopenMid));
          if (o) { o.t = t; o.cd = o.slots.map(() => t); s = o; rep.reopens++; }
        }
        if (pol !== "idle" && s.t + 1e-9 >= nextBuy) {
          nextBuy = Math.floor(s.t + 1e-9) + buyEvery;
          const r = greedyBuy(s);
          if (r) {
            rep.buys++; starBuys++;
            if (rep.firstBuySec === null) rep.firstBuySec = s.t;
            const gap = s.t - lastBuy;
            if (gap > rep.buyGaps.max) rep.buyGaps.max = gap;
            lastBuy = s.t;
            if (s.phase === "choose") continue;
          }
        }
        if (noLimit && s.phase === "fly") s.left = s.limit;
        evs.length = 0;
        CELLS = 0;
        const bk = s.slots.findIndex((y) => y.id === "bolt");
        const preMats = bk >= 0 && s.phase === "fly" && s.t + STEP + 1e-9 >= s.cd[bk] ? s.rock.mats.slice() : null;
        const wasFly = s.phase === "fly";
        const ctxNear = { v: null };
        stepMut(s, STEP, evs);
        if (wasFly) { flyT += STEP; tryFly += STEP; }
        if (CELLS > rep.stepCells) rep.stepCells = CELLS;
        // 自機とふちの距離（10 step に 1 回、星の始めの 20 秒をのぞく）
        if (wasFly && s.phase === "fly" && tryFly > 20 && (Math.round(s.t / STEP) % 10) === 0) {
          const g = geoOf(s.rock); let bd = Infinity;
          for (const i of g.elist) { if (!g.eflag[i]) continue; const c = i % s.rock.w; const dx = s.ship.x - (c + 0.5) * CELL, dy = s.ship.y - ((i - c) / s.rock.w + 0.5) * CELL; const d = dx * dx + dy * dy; if (d < bd) bd = d; }
          const dd = Math.sqrt(bd) / CELL;
          if (s.rock.left > 0.1 * s.rock.total) {
            rep.standoff.n++; rep.standoff.sum += dd; if (dd > rep.standoff.max) rep.standoff.max = dd;
            if (dd > STANDOFF + 4) rep.standoff.far++;
            if (dd < STANDOFF - 2) rep.standoff.near++;
          }
        }
        void ctxNear;
        let born = 0;
        for (const e of evs) {
          if (e.kind === "break") born += 2;
          else if (e.kind === "chunk") { born += e.cells.length * 2; starChunks++; }
          else if (e.kind === "glow") { born += e.cells.length * 3; starGlows++; rep.glows++; }
          else if (e.kind === "bolt") {
            if (numOf(s) >= 3 && starInfo(numOf(s)).main === "iron") { const x = s.slots.find((y) => y.id === "bolt"); const pm = preMats || s.rock.mats; let n = pm[e.from] === 2 ? 1 : 0; for (const ed of e.edges) if (pm[ed[1]] === 2) n++; rep.boltCells.push(n / shapeOf("bolt", x ? x.lv : 1)); }
          } else if (e.kind === "swap") { rep.swaps++; rep.swapLog.push({ star: s.star, slot: e.slot, from: e.from, to: e.to, lv: e.lv }); }
          else if (e.kind === "clear") {
            rep.stars.push({ tier: e.tier, num: e.num, star: e.star, boss: e.star % BOSS_EVERY === 0, sec: +(flyT - starStart).toFixed(1), clearSec: +tryFly.toFixed(1), limit: s.limit, timeLeft: e.left,
              tries: s.tries, buys: starBuys, kakera: s.kakera, b30: b30 === null ? 1 : +b30.toFixed(3), chunks: starChunks, glows: starGlows,
              slots: s.slots.map((x) => x.id + x.lv).join(" ") });
            b30 = null; starChunks = 0; starGlows = 0;
            if (e.star === maxStar && e.tier === maxTier) rep.endSec = flyT;
          } else if (e.kind === "lost") {
            rep.losts.push({ star: s.star, broken: +e.broken.toFixed(3), t: +s.t.toFixed(1) });
          }
        }
        win.push(born); partNow += born;
        if (win.length > Math.round(0.9 / STEP)) partNow -= win.shift();
        if (partNow > rep.particlesMax) rep.particlesMax = partNow;
        if (s.shots.length > rep.shotsMax) rep.shotsMax = s.shots.length;
        if (s.kakera > rep.kakeraMax) rep.kakeraMax = s.kakera;
        if (s.phase === "fly") {
          if (lastPhase === "clear" || lastPhase === "end") { starStart = flyT; starBuys = 0; b30 = null; starChunks = 0; starGlows = 0; tryFly = 0; }
          if (b30 === null && flyT - starStart >= 30 - 1e-9) b30 = progressS(s).broken;
        }
        lastPhase = s.phase;
        if (rep.endSec !== null) break;
      }
      rep.t = s.t;
      rep.flySec = flyT;
      rep.buyGaps.avg = rep.buys ? +(s.t / rep.buys).toFixed(2) : null;
      rep.boltMedian = median(rep.boltCells);
      rep.boltCells = rep.boltCells.length;
      rep.standoff.avg = rep.standoff.n ? +(rep.standoff.sum / rep.standoff.n).toFixed(2) : null;
      rep.final = { tier: s.tier, star: s.star, kakera: s.kakera, slots: s.slots.map((x) => ({ id: x.id, lv: x.lv })), bench: s.bench.map((x) => ({ id: x.id, lv: x.lv })), tries: s.tries, totals: Object.assign({}, s.totals), cleared: s.cleared, phase: s.phase, broken: progressS(s).broken };
    } catch (e) {
      rep.error = String(e && e.stack || e);
    } finally {
      SIM = wasSim;
    }
    return rep;
  }

  const api = {
    NAME, MATS, WEAPONS, EVOLVE, MAT_HP, MAT_VALUE, UP_COST, SLOT_COST,
    CELL, STANDOFF, SHIP_SPEED, RANGE, SHIP_TURN, ORBIT_LAPS, GRID_MAX,
    R_BASE, R_STEP, R_MAX, BOSS_EVERY, BOSS_SIZE, BOSS_HARD, SHAPE, AREA_FILL, GLOW,
    BOLT_CELLS, BEAM_W, BEAM_DEPTH, SHOT_UP, BOLT_KEEP, BOLT_MIN, BOMB_SHIFT,
    STAR_HP, STAR_VALUE, HP_TABLE, VALUE_GROWTH, VALUE_GROWTH2, EARLY_VALUE, HARD, TIER_MAX, UP_GROWTH, LEVEL_MAX, SLOTS_MAX, MIX,
    CLEAR_BONUS, MILESTONE_BONUS, MILESTONES, BEST_MAX, ENDING_STAR, HARD_STARS, STAR_MAX, STAR_CALC_MAX, KAKERA_MAX, SHOTS_MAX, STEP,
    SAVE_VERSION, SAVE_KEY, SAVE_KEY_BAK, SAVE_KEY_BEST, SAVE_KEY_HELP, SAVE_KEY_V3,
    RETRY_EASE, CLEAR_SEC, BEAM_SEC, BOMB_FLIGHT, BULLET_SPEED, BULLET_LIFE, CARRY_MIN, LIMIT_MUL, LIMIT_BASE, IRON_BLOB_MIN,
    newGame, starInfo, step, dpsOf, upCostOf, upgrade, slotCostOf, unlock, choose, swapChoicesOf, reserveSwap, retry, afterEnding, progressOf, formatKakera, formatTime,
    makeSave, loadSave, saveVersionOf, validateBest, simulate,
    hpMul, valMul, dmg, upCost, affOf, shapeOf, cellHp, cellHpAt, cellValue, matOf, limitOf, limitTry, rateOf, pierceOf, numIn, starsOf
  };
  return Object.freeze(api);
});
