/*
 * ちきゅうを守れ！ほしくだき — ロジック（DOM・Date・performance・Math.random・localStorage に触れない純粋な計算だけ）
 * 契約：docs/asteroid-contract.md（正とする順は §20 → §21 → §1〜§19）。§3（数値）・§4（API）・§8（保存の形と検証）・§21.2（部品の約束）
 * 担当A（ロジック）だけが編集する。作り直し（2026-10-23）：細かいマス・砲台・斜めの弾・ビームの穴・いなずまの枝分かれ・ひかえと入れ替え・保存 v:2。
 *
 * UMD: ブラウザでは window.AsteroidLogic、Node では module.exports。
 *
 * 中の作り：
 *   - 公開する関数は、受け取った state を書き換えない（毎回新しいオブジェクトを返す）。
 *     マスの配列は、その step で変わったときだけ写す（コピーオンライト。rock.hp は当たった step、rock.mats は欠けた step）。
 *     中では「state を書き換える」関数（stepMut など）を使い、自動プレイはそれを直接まわす（速さのため）。
 *   - 例外は外へ出さない（おかしな引数は null か { ok:false, reason }）。
 *   - 乱数は mulberry32。state.rng に 32bit の状態を持つ（2択の候補だけに使う）。
 *     星の形は (seed, 星の番号) から決まる別の乱数で作る（やり直しで同じ形）。いなずまの枝の順は (seed, 時刻, マス) のハッシュ。
 *   - 契約 §4.1・§21.2 の state の形に、次の欄を足している（logic の中のもの。保存しない。画面は使わなくてよい）：
 *       wait  … 'bounce'・'clear' の残りの秒
 *       back  … 'choose' を閉じたあとに戻る phase
 *       tryAt … いまの挑戦が始まった t（clear の time の元。保存は mid.tt）
 *       rock.bottom0 … 星の始めの「一番下のマス」の y（地球までの近さの分母）
 *       rock.rowHp … 行ごとの体力の倍率（もろい底 SOFT。満タンの体力は cellHpAt）
 *       rock.scan … 縁のマス・てつのマス・マスの込み具合の表（ねらいの計算用。マスが欠けた step だけ作り直す）
 *       turrets[k] の tgt・tv・tt … ねらっているマスと、それを決めた時（ねらいの計算を軽くする）
 *       shots[] の弾には、どかん用の着地点（tc・tr：格子の座標）・ほのおのねらい（aim）などを足している
 *       burns[] には at・spread（となりの こおり へ広げたか）を足している
 *   - offer は 2択なら [idA, idB]、残りの武器が 1 つだけのときは [id]（長さ 1。§21.7 の PM の案 4「候補 1 つのカード」）。
 *   - ほのお：燃えていたマスが時間の前に欠けたら、残りの時間で となりのマス（こおり を先に）へ燃えうつる（マスが細かくなり、
 *     1 マスが すぐ欠けて火が むだになるため。作り直しで足した決まり。報告済み）。
 *   - てつ・こおり・きん は、星の一番下の 2 行（もろい底）には入れない（§3.2 は てつ だけを書いているが、前半の欠け方をそろえるため）。
 *   - 保存 v:2 の slots が 5 つ以上なら、5 つ目からは ひかえ へ回す（捨てない）。
 *   - choose の返り値に events（砲台が増えたら [{ kind:'turrets', n }]）、upgrade の返り値に events（しんか）を足している。
 *   - simulate の opts に start（星と武器を決めて始める。測る用）・reopenEvery・reopenMid・pickOrder・buyEvery・swap を足している。
 *   - エンディング（phase 'end'）では星はもう 31 に進み、cleared は true。step は進まない。
 *     「このまま あそぶ」は loadSave(makeSave(state)) で星 31 の最初から fly になる（契約に専用の関数が無いため）。
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AsteroidLogic = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : null, function () {
  "use strict";

  // ---------------------------------------------------------------- 定数（契約 §3・§4.2）
  const NAME = "ちきゅうを守れ！ほしくだき";
  const FIELD_W = 360, FIELD_H = 560, BARRIER_Y = 470, TURRET_Y = 500, ARC_SAG = 12, CELL = 7, GRID_MAX = 48;
  const DEG = Math.PI / 180;
  // 砲台（§3.8・§21.2）：向けられる角度・回る速さ・撃てる角度のずれ（ラジアン）、砲身の長さ（単位）
  const AIM_MAX = 60 * DEG, TURN_SPEED = 360 * DEG, AIM_TOL = 4 * DEG, BARREL = 14;
  // いなずまの枝分かれのマスの数・ビームの幅（マス）は Lv1 の値（しんかは EVOLVE）。ビームの深さ（マス）
  const BOLT_CELLS = 16, BEAM_W = 2, BEAM_DEPTH = 20;
  const HP_BASE = 180, HP_GROWTH = 1.252, VALUE_GROWTH = 2.35, UP_GROWTH = 1.35, LEVEL_MAX = 99, SLOTS_MAX = 4;
  // 1 マスのかけらは MAT_VALUE × valMul ÷ VALUE_DIV（マスが約 4 倍になったので。端数は kfrac にためる）
  const VALUE_DIV = 4;
  // エンディング（星 ENDING_STAR）より先の増え方（§17.1「星 100 まで詰まらない」）
  const HP_GROWTH2 = 1.0, VALUE_GROWTH2 = 1.03;
  // 最初の星だけ、マスの体力をこの倍にする（星 1〜9。§17.1「最初の 3 星は 1.5〜3 分」）
  const EARLY_HP = deepFreeze([0.015, 0.056, 0.08, 0.27, 0.35, 0.39, 0.58, 0.82, 0.9]);
  // マスの混ざり方（§3.2）：てつ（星 3〜9・10〜）、こおり（星 6〜）、星ごとの傾き（てつ多め／こおり多め）
  const MIX = deepFreeze({ iron: [0.25, 0.35], ice: 0.15, tilt: 0.08 });
  const SIZE_BASE = 20, SIZE_STEP = 0.96;   // 星 1 の直径（マス）と、星ごとに増えるマスの数（星 30 ごろに 48 マス）
  const BOSS_GROW = 4, BOSS_HARD = 1.3;     // 大きな星：格子を 4 マス大きく、重さ（マスの数×体力）はふつうの星の 1.3 倍くらい
  const MILESTONE_BONUS = 0.03, MILESTONES = deepFreeze([25, 50, 75]);   // 壊した割合 25・50・75% のおまけ（§18.1 B）
  const BEST_MAX = 200;
  const CLEAR_BONUS = 0.2, ENDING_STAR = 30, STAR_MAX = 9999, STAR_CALC_MAX = 400, KAKERA_MAX = 9e15;
  const SHOTS_MAX = 120, STEP = 1 / 30;
  const SAVE_VERSION = 2, SAVE_KEY = "asteroid.save", SAVE_KEY_BAK = "asteroid.save.bak", SAVE_KEY_BEST = "asteroid.best", SAVE_KEY_HELP = "asteroid.help";

  const START_BOTTOM = 120;      // 星の始めの「一番下のマス」の y
  const BULLET_SPEED = 600;      // たま・ちらし・ほのお の弾
  const BOMB_FLIGHT = 0.6;       // どかん の山なりの秒
  const BEAM_SEC = 0.4;          // ビームの見た目の秒（当たりは撃った瞬間）
  const BOUNCE_SEC = 2, CLEAR_SEC = 1.5;
  const SLOW_FROM = 2, SLOW_STEP = 0.1, SLOW_MAX = 0.25;
  const BURN_SPREAD_SEC = 0.5;
  const EVOLVE_EVERY = 10, EVOLVE_TIERS = 3;
  const APPROACH = deepFreeze({ first: 135, normal: 240, boss: 300, keep: 0.33, firstStars: 3, bossEvery: 5 });
  const TRIES_MAX = 9999;
  const SOFT = deepFreeze({ q: 0.2, mul: 0.05, ramp: 0.15 });
  // ねらいの計算（§3.8・§21.5）：ビームは 4° ごと、どかんは縁のマスを 4 マスおき。ねらいを決め直す間隔（秒）
  const BEAM_SCAN_DEG = 4, BOMB_EVERY = 4, RETARGET_SEC = 0.5, RETARGET_HEAVY_SEC = 1.0, HEAVY_LEAD = 0.4;
  // てつ・こおり・きん のかたまり（§3.2）
  const IRON_BLOB_MIN = 40;

  // ---------------------------------------------------------------- 表（§3.2・§3.3・§3.4・§3.6）
  const MAT_IDS = ["rock", "iron", "ice", "gold"];        // コード 1〜4（0 は空）
  const MATS = deepFreeze([
    { id: "rock", code: 1, name: "いわ", from: 1 },
    { id: "iron", code: 2, name: "てつ", from: 3 },
    { id: "ice", code: 3, name: "こおり", from: 6 },
    { id: "gold", code: 4, name: "きん", from: 8 }
  ]);
  const MAT_HP = deepFreeze({ rock: 1, iron: 4, ice: 2, gold: 2 });
  const MAT_VALUE = deepFreeze({ rock: 1, iron: 4, ice: 2, gold: 10 });

  const WEAPONS = deepFreeze([
    { id: "shot", name: "たま", dmg: 1, rate: 0.20, good: null, aff: {}, desc: "いちばん ちかい マスへ まっすぐ うつ" },
    { id: "spread", name: "ちらし", dmg: 1.25, rate: 0.6, good: "rock", aff: { rock: 2, iron: 0.9 }, desc: "おうぎの かたちに 5はつ ちらす" },
    { id: "bomb", name: "どかん", dmg: 0.75, rate: 1.6, good: "ice", aff: { ice: 2 }, desc: "おちた ところの まわりを まとめて こわす" },
    { id: "bolt", name: "いなずま", dmg: 0.65, rate: 1.2, good: "iron", aff: { iron: 2.2, ice: 0.5 }, desc: "つながった おなじ マスへ えだわかれ する" },
    { id: "beam", name: "ビーム", dmg: 0.375, rate: 2.0, good: "iron", aff: { iron: 1.8 }, desc: "まっすぐ おくまで あなを あける" },
    { id: "fire", name: "ほのお", dmg: 3, rate: 1.0, good: "ice", aff: { ice: 3, iron: 0.75 }, desc: "もやして となりの こおりへ ひろがる" }
  ]);
  const W = {};
  for (const w of WEAPONS) W[w.id] = w;
  const W_IDS = WEAPONS.map((w) => w.id);

  // しんか（Lv 10・20・30）で変わる形。value(tier) = base + add × tier
  const EVOLVE = deepFreeze({
    shot: { key: "count", base: 1, add: 1, unit: "れん" },          // 1→2連→3連→4連
    spread: { key: "count", base: 5, add: 2, unit: "はつ" },        // 5→7→9→11 発
    bomb: { key: "radius", base: 3, add: 1, unit: "マス" },         // 半径 3→4→5→6 マス
    bolt: { key: "cells", base: BOLT_CELLS, add: 8, unit: "マス" }, // 枝分かれ 16→24→32→40 マス
    beam: { key: "width", base: BEAM_W, add: 2, unit: "マス" },     // 幅 2→4→6→8 マス
    fire: { key: "sec", base: 3, add: 1, unit: "びょう" }           // 燃える秒
  });

  const UP_COST = deepFreeze({ shot: 5, spread: 5, bomb: 34, bolt: 5, beam: 8, fire: 4 });
  // n 個目の武器の値段（[1] が 2 つ目。4 つ目までは砲台、5・6 つ目は ひかえ。§3.6）
  const SLOT_COST = deepFreeze([null, 40, 300, 2000, 800000, 2e9]);

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

  // 1 step に調べたマスの数（§21.5 の stepCells。simulate が最大を記録する）
  let CELLS = 0;

  // ---------------------------------------------------------------- 式（§3.2・§3.3・§3.4）
  function calcN(n) { return clamp(Math.floor(isNum(n) ? n : 1), 1, STAR_CALC_MAX); }
  function growMul(n, g1, g2) {
    const k = calcN(n);
    return k <= ENDING_STAR ? Math.pow(g1, k - 1) : Math.pow(g1, ENDING_STAR - 1) * Math.pow(g2, k - ENDING_STAR);
  }
  function starNum(n) { return isNum(n) && n >= 1 ? Math.min(Math.floor(n), STAR_MAX) : 1; }
  function hpMul(n) {
    const k = calcN(n);
    return growMul(n, HP_GROWTH, HP_GROWTH2) * (k <= EARLY_HP.length ? EARLY_HP[k - 1] : 1) * dimsOf(starNum(n)).adj;
  }
  function valMul(n) { return growMul(n, VALUE_GROWTH, VALUE_GROWTH2) * dimsOf(starNum(n)).adj; }
  function matOf(code) { return MAT_IDS[code - 1] || null; }
  function cellHp(n, mat) { return MAT_HP[mat] ? HP_BASE * hpMul(n) * MAT_HP[mat] : null; }
  // 1 マスのかけら（端数こみ。整数にしない。kakera へは addK で端数をためて足す）
  function cellValue(n, mat) { return MAT_VALUE[mat] ? MAT_VALUE[mat] * valMul(n) / VALUE_DIV : null; }
  function lvOk(L) { return isNum(L) ? clamp(Math.floor(L), 1, LEVEL_MAX) : 1; }
  function dmg(w, L) {
    if (!W[w]) return null;
    L = lvOk(L);
    return W[w].dmg * (1 + 0.25 * (L - 1)) * Math.pow(2, Math.floor(L / EVOLVE_EVERY));
  }
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
  // かけらを足す（端数は kfrac にためる。totals.kakera にも整数ぶん）
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

  // ---------------------------------------------------------------- 星（§3.2・§3.7）
  function normStar(n) {
    if (!isNum(n)) return null;
    const k = Math.floor(n);
    if (k < 1) return null;
    return Math.min(k, STAR_MAX);
  }
  const dimsMemo = new Map();
  function dimsOf(n) {
    let d0 = dimsMemo.get(n);
    if (d0) return d0;
    const boss = n % APPROACH.bossEvery === 0;
    const k = Math.min(n, 40);
    const smooth = Math.min(GRID_MAX, SIZE_BASE + (k - 1) * SIZE_STEP);
    const base = Math.min(GRID_MAX, Math.round(smooth));
    const d = Math.min(GRID_MAX, base + (boss ? BOSS_GROW : 0));
    const rows = Math.max(12, Math.round(d * 0.86));
    // 格子の大きさの段・大きな星の重さ・傾きを「なめらかな重さ」にならす（§3.10 の「星の重さのならし」。式はマスが細かくなっても同じ）
    const mx = mixRaw(n);
    const adj = (smooth * smooth * 0.86) / (d * rows) * (boss ? BOSS_HARD : 1) * (weightOf(mx.iron0, mx.ice0) / weightOf(mx.iron, mx.ice));
    d0 = { boss, cols: d, rows, adj, mix: mx };
    if (dimsMemo.size < 2000) dimsMemo.set(n, d0);
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
  const approachMemo = new Map();
  function approachSecOf(n) {
    let a = approachMemo.get(n);
    if (a !== undefined) return a;
    const dm = dimsOf(n);
    const want = dm.boss ? APPROACH.boss : n <= APPROACH.firstStars ? APPROACH.first : APPROACH.normal;
    a = Math.max(30, Math.round(want / (APPROACH.keep + dm.rows * CELL / (BARRIER_Y - START_BOTTOM)) / 10) * 10);
    if (approachMemo.size < 1000) approachMemo.set(n, a);
    return a;
  }
  function goldBlobs(n) { return n >= 8 ? 1 + (hash2(n, 0x901d) % 3) : 0; }
  function starInfo(n) {
    try {
      n = normStar(n);
      if (n === null) return null;
      const dm = dimsOf(n);
      const iron = dm.mix.iron, ice = dm.mix.ice;
      const gold = goldBlobs(n) * 4;   // きん のマスの数（2×2 のかたまりが 1〜3 個）
      const main = iron === 0 && ice === 0 ? null : iron >= ice ? "iron" : "ice";
      const tag = main === null ? "" : main === "iron" ? "てつが おおい" : "こおりが おおい";
      return { cols: dm.cols, rows: dm.rows, approachSec: approachSecOf(n), boss: dm.boss, mix: { iron, ice, gold }, tag, main };
    } catch (e) { return null; }
  }

  // かたまりを育てる（§3.2「てつは大きなかたまり」）：種のマスから、まわりのマスのうち「種からの距離 × ゆらぎ」が一番小さいものを足していく（丸みのある形）。
  // ok(j) が true のマス（いわ で、底の 2 行でない）だけに広げる。足したマスの数を返す
  function growBlob(mats, cols, rows, seedI, size, code, ok, rnd) {
    const sc = seedI % cols, sr = (seedI - sc) / cols;
    const front = [seedI], inFront = new Set([seedI]);
    const jit = new Map();
    let got = 0;
    while (front.length && got < size) {
      let bi = -1, bv = Infinity;
      for (let q = 0; q < front.length; q++) {
        const j = front[q];
        const c = j % cols, r = (j - c) / cols;
        let h = jit.get(j);
        if (h === undefined) { h = 0.75 + 0.5 * rnd(); jit.set(j, h); }
        const v = ((c - sc) * (c - sc) + (r - sr) * (r - sr)) * h;
        if (v < bv) { bv = v; bi = q; }
      }
      const j = front[bi];
      front[bi] = front[front.length - 1]; front.pop();
      if (!ok(j)) continue;
      mats[j] = code; got++;
      const c = j % cols, r = (j - c) / cols;
      const nb = [];
      if (c > 0) nb.push(j - 1);
      if (c < cols - 1) nb.push(j + 1);
      if (r > 0) nb.push(j - cols);
      if (r < rows - 1) nb.push(j + cols);
      for (const q of nb) if (!inFront.has(q) && ok(q)) { inFront.add(q); front.push(q); }
    }
    return got;
  }
  // 中心から遠すぎない、ほかのかたまりから離れた種を選ぶ（候補 8 つのうち、置いたかたまりの中心から一番遠いもの）
  function pickSeed(cells, cols, ok, centers, rnd) {
    let best = -1, bd = -1;
    for (let t = 0; t < 8; t++) {
      const j = cells[Math.floor(rnd() * cells.length)];
      if (!ok(j)) continue;
      const c = j % cols, r = (j - c) / cols;
      let d = Infinity;
      for (const [cc, rr] of centers) d = Math.min(d, (c - cc) * (c - cc) + (r - rr) * (r - rr));
      if (!centers.length) d = 0;
      if (d > bd) { bd = d; best = j; }
    }
    if (best < 0) for (const j of cells) if (ok(j)) return j;
    return best;
  }
  function placeBlobs(mats, cols, rows, cells, want, nBlobs, code, ok, rnd) {
    let placed = 0;
    const centers = [];
    for (let b = 0; b < nBlobs && placed < want; b++) {
      const size = b === nBlobs - 1 ? want - placed : Math.round(want / nBlobs);
      let got = 0, guard = 0;
      while (got < size && guard++ < 6) {
        const sd = pickSeed(cells, cols, ok, centers, rnd);
        if (sd < 0) break;
        const c = sd % cols;
        centers.push([c, (sd - c) / cols]);
        got += growBlob(mats, cols, rows, sd, size - got, code, ok, rnd);
      }
      placed += got;
    }
    return placed;
  }

  // 星の形とマスを作る（seed と星の番号だけで決まる）
  function genRock(seed, n, tries) {
    const info = starInfo(n);
    const cols = info.cols, rows = info.rows, N = cols * rows;
    const rnd = makeRng(hash2(seed, n));
    const G = 5, noise = [];
    for (let i = 0; i < G * G; i++) noise.push(rnd() * 2 - 1);
    const nz = (u, v) => {
      const x = u * (G - 1), y = v * (G - 1);
      const x0 = Math.min(G - 2, Math.floor(x)), y0 = Math.min(G - 2, Math.floor(y));
      const fx = x - x0, fy = y - y0;
      const a = noise[y0 * G + x0], b = noise[y0 * G + x0 + 1], c = noise[(y0 + 1) * G + x0], d = noise[(y0 + 1) * G + x0 + 1];
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    };
    const cx = (cols - 1) / 2, cy = (rows - 1) / 2, rx = cols / 2, ry = rows / 2;
    let mats = new Array(N).fill(0);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const dx = (c - cx) / rx, dy = (r - cy) / ry;
      const lim = 0.97 + 0.22 * nz(c / (cols - 1), r / (rows - 1));
      if (dx * dx + dy * dy <= lim * lim) mats[r * cols + c] = 1;
    }
    keepMain(mats, cols, rows);
    let cells = [];
    for (let i = 0; i < N; i++) if (mats[i]) cells.push(i);
    if (cells.length < 4) {
      mats = new Array(N).fill(0);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const dx = (c - cx) / rx, dy = (r - cy) / ry;
        if (dx * dx + dy * dy <= 1) mats[r * cols + c] = 1;
      }
      cells = [];
      for (let i = 0; i < N; i++) if (mats[i]) cells.push(i);
    }
    const cnt = cells.length;
    let maxRow = 0;
    for (const i of cells) { const r = Math.floor(i / cols); if (r > maxRow) maxRow = r; }
    // 一番下の 2 行（もろい底）には てつ・こおり・きん を入れない（§3.2。前半の欠け方 §18.1 B を変えない）
    const okRock = (j) => mats[j] === 1 && Math.floor(j / cols) < maxRow - 1;
    // てつ：1〜3 個の大きなかたまり（それぞれ IRON_BLOB_MIN マス以上）
    const ironWant = Math.round(cnt * info.mix.iron);
    if (ironWant > 0) {
      const nb = Math.max(1, Math.min(1 + Math.floor(rnd() * 3), Math.floor(ironWant / IRON_BLOB_MIN)));
      placeBlobs(mats, cols, rows, cells, ironWant, nb, 2, okRock, rnd);
    }
    // こおり：1〜2 個のかたまり
    const iceWant = Math.round(cnt * info.mix.ice);
    if (iceWant > 0) placeBlobs(mats, cols, rows, cells, iceWant, 1 + Math.floor(rnd() * 2), 3, okRock, rnd);
    // きん：2×2 の小さなかたまりを 1〜3 個（星 8〜）
    const gb = goldBlobs(n);
    for (let b = 0, guard = 0; b < gb && guard < 400; guard++) {
      const j = cells[Math.floor(rnd() * cnt)];
      const c = j % cols;
      if (c >= cols - 1) continue;
      const q = [j, j + 1, j + cols, j + cols + 1];
      if (q.every((x) => x < N && okRock(x))) { for (const x of q) mats[x] = 4; b++; }
    }
    const rowHp = softRows(mats, cols, rows, cnt);
    const hp = new Array(N).fill(0);
    let value = 0;
    for (const i of cells) {
      const m = matOf(mats[i]);
      hp[i] = cellHp(n, m) * rowHp[Math.floor(i / cols)];
      value += cellValue(n, m);
    }
    const x = (FIELD_W - cols * CELL) / 2;
    const y = START_BOTTOM - (maxRow + 1) * CELL;
    const rock = { cols, rows, x, y, vy: 0, mats, hp, total: cnt, left: cnt, value, bottom0: START_BOTTOM, rowHp, scan: null };
    rock.vy = vyOf(n, tries);
    return rock;
  }
  function softRows(mats, cols, rows, cnt) {
    const per = new Array(rows).fill(0), hard = new Array(rows).fill(0);
    for (let i = 0; i < mats.length; i++) if (mats[i]) { const r = Math.floor(i / cols); per[r]++; hard[r] += MAT_HP[matOf(mats[i])]; }
    const mul = new Array(rows).fill(1);
    let below = 0, w0 = 0, w1 = 0;
    for (let r = rows - 1; r >= 0; r--) {
      const q = cnt > 0 ? (below + per[r] / 2) / cnt : 1;
      below += per[r];
      mul[r] = q <= SOFT.q ? SOFT.mul : q >= SOFT.q + SOFT.ramp ? 1 : SOFT.mul + (1 - SOFT.mul) * (q - SOFT.q) / SOFT.ramp;
      w0 += hard[r]; w1 += hard[r] * mul[r];
    }
    const k = w1 > 0 ? w0 / w1 : 1;
    return mul.map((m) => m * k);
  }
  function slowOf(tries) { return Math.min(SLOW_MAX, SLOW_STEP * Math.max(0, (tries | 0) - (SLOW_FROM - 1))); }
  function vyOf(n, tries) { return (BARRIER_Y - START_BOTTOM) / approachSecOf(n) * (1 - slowOf(tries)); }

  // つながり（上下左右）を調べる。かたまりごとのマスの一覧と、ねらい用の表（縁・てつ・込み具合）を 1 回でつくる
  function scanRock(mats, cols, rows) {
    const N = cols * rows;
    const comp = new Int32Array(N).fill(-1);
    const list = [], stack = [], edges = [], irons = [];
    const bw = (cols + 1) >> 1, bh = (rows + 1) >> 1;
    const blk = new Array(bw * bh).fill(0);
    for (let i = 0; i < N; i++) {
      if (!mats[i] || comp[i] >= 0) continue;
      const id = list.length, cells = [];
      comp[i] = id; stack.push(i);
      while (stack.length) {
        const j = stack.pop();
        cells.push(j);
        const c = j % cols, r = (j - c) / cols;
        let edge = false;
        if (c > 0) { if (!mats[j - 1]) edge = true; else if (comp[j - 1] < 0) { comp[j - 1] = id; stack.push(j - 1); } } else edge = true;
        if (c < cols - 1) { if (!mats[j + 1]) edge = true; else if (comp[j + 1] < 0) { comp[j + 1] = id; stack.push(j + 1); } } else edge = true;
        if (r > 0) { if (!mats[j - cols]) edge = true; else if (comp[j - cols] < 0) { comp[j - cols] = id; stack.push(j - cols); } } else edge = true;
        if (r < rows - 1) { if (!mats[j + cols]) edge = true; else if (comp[j + cols] < 0) { comp[j + cols] = id; stack.push(j + cols); } } else edge = true;
        if (edge) edges.push(j);
        if (mats[j] === 2) irons.push(j);
        blk[(r >> 1) * bw + (c >> 1)]++;
      }
      list.push(cells);
    }
    CELLS += N >> 3;   // 空のマスを飛ばす走査（8 マスで 1 と数える）
    // 込み具合の累積和（どかんのねらい用）
    const sat = new Array((bw + 1) * (bh + 1)).fill(0);
    for (let r = 0; r < bh; r++) {
      let row = 0;
      for (let c = 0; c < bw; c++) { row += blk[r * bw + c]; sat[(r + 1) * (bw + 1) + c + 1] = sat[r * (bw + 1) + c + 1] + row; }
    }
    let visited = 0;
    for (const a of list) visited += a.length;
    CELLS += visited;
    return { list, scan: { of: mats, ver: 0, edges, irons, sat, bw, bh } };
  }
  function components(mats, cols, rows) {
    const out = [];
    const N = cols * rows;
    const seen = new Uint8Array(N);
    const st = [];
    for (let i = 0; i < N; i++) {
      if (!mats[i] || seen[i]) continue;
      const cells = [];
      seen[i] = 1; st.push(i);
      while (st.length) {
        const j = st.pop(); cells.push(j);
        const c = j % cols;
        if (c > 0 && mats[j - 1] && !seen[j - 1]) { seen[j - 1] = 1; st.push(j - 1); }
        if (c < cols - 1 && mats[j + 1] && !seen[j + 1]) { seen[j + 1] = 1; st.push(j + 1); }
        if (j >= cols && mats[j - cols] && !seen[j - cols]) { seen[j - cols] = 1; st.push(j - cols); }
        if (j + cols < N && mats[j + cols] && !seen[j + cols]) { seen[j + cols] = 1; st.push(j + cols); }
      }
      out.push(cells);
    }
    return out;
  }
  function mainIndex(list, cols, rows) {
    const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
    let best = -1, bestSize = -1, bestD = Infinity;
    for (let k = 0; k < list.length; k++) {
      const cells = list[k];
      if (cells.length < bestSize) continue;
      let d = Infinity;
      for (const j of cells) {
        const c = j % cols, r = (j - c) / cols;
        const e = (c - cx) * (c - cx) + (r - cy) * (r - cy);
        if (e < d) d = e;
      }
      if (cells.length > bestSize || (cells.length === bestSize && d < bestD)) { best = k; bestSize = cells.length; bestD = d; }
    }
    return best;
  }
  function keepMain(mats, cols, rows) {
    const list = components(mats, cols, rows);
    const m = mainIndex(list, cols, rows);
    for (let k = 0; k < list.length; k++) if (k !== m) for (const j of list[k]) mats[j] = 0;
  }

  // ---------------------------------------------------------------- 砲台（§3.8・§21.2）
  function turretPos(n) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const x = FIELD_W * (k + 1) / (n + 1);
      const u = (x - FIELD_W / 2) / (FIELD_W / 2);
      out.push({ x, y: TURRET_Y + ARC_SAG * u * u });
    }
    return out;
  }
  function turretsOf(n) {
    try {
      if (!Number.isInteger(n) || n < 1 || n > SLOTS_MAX) return null;
      return turretPos(n);
    } catch (e) { return null; }
  }
  // 砲台の並びを slots の数に合わせる（向きは番号ごとに引き継ぐ）
  function layTurrets(old, n) {
    const pos = turretPos(n);
    return pos.map((p, k) => {
      const o = Array.isArray(old) && isObj(old[k]) ? old[k] : null;
      const ang = o && isNum(o.ang) ? clamp(o.ang, -AIM_MAX, AIM_MAX) : 0;
      const aim = o && isNum(o.aim) ? clamp(o.aim, -AIM_MAX, AIM_MAX) : ang;
      return { x: p.x, y: p.y, ang, aim, tgt: -1, tv: null, tt: -Infinity };
    });
  }
  function muzzle(T) { return { x: T.x + Math.sin(T.ang) * BARREL, y: T.y - Math.cos(T.ang) * BARREL }; }
  function angTo(T, x, y) { return Math.atan2(x - T.x, T.y - y); }

  // ---------------------------------------------------------------- 状態
  function newSlot(id) { return { id, lv: 1 }; }
  function newGame(seed) {
    try {
      if (seed === undefined) seed = 1;
      if (!isNum(seed)) return null;
      seed = Math.floor(Math.abs(seed)) >>> 0;
      return makeState({ star: 1, kakera: 0, kfrac: 0, slots: [newSlot("shot")], bench: [], swap: [], offer: null, cleared: false, tries: 1, totals: { cells: 0, stars: 0, kakera: 0, chunks: 0 }, seed, rng: hash2(seed, 0x2b) });
    } catch (e) { return null; }
  }
  // 保存の中身（検証済み）から、星の最初の状態を作る
  function makeState(o) {
    const s = {
      star: o.star, phase: o.offer ? "choose" : "fly", t: isNum(o.t) ? o.t : 0, kakera: o.kakera, kfrac: isNum(o.kfrac) ? o.kfrac : 0,
      slots: o.slots.map((x) => ({ id: x.id, lv: x.lv })), bench: (o.bench || []).map((x) => ({ id: x.id, lv: x.lv })),
      offer: o.offer ? o.offer.slice() : null, swap: (o.swap || []).map((x) => ({ slot: x.slot, id: x.id })),
      rock: null, turrets: layTurrets(null, o.slots.length), shots: [], burns: [], cd: o.slots.map(() => 0),
      tries: o.tries, cleared: o.cleared, totals: { cells: o.totals.cells, stars: o.totals.stars, kakera: o.totals.kakera, chunks: o.totals.chunks },
      seed: o.seed, rng: o.rng, wait: 0, back: "fly",
      ms: Array.isArray(o.ms) ? o.ms.slice() : [], bestT: isObj(o.bestT) ? Object.assign({}, o.bestT) : {}, tryAt: 0, hold: false
    };
    s.rock = genRock(s.seed, s.star, s.tries);
    if (o.mid !== undefined && o.mid !== null && applyMid(s, o.mid)) {
      const tt = isObj(o.mid) && isNum(o.mid.tt) ? clamp(o.mid.tt, 0, 1e7) : 0;
      s.tryAt = s.t - tt;
    }
    s.ms = passedMs(s.rock, s.ms);
    return s;
  }
  function applyMid(s, mid) {
    if (!isObj(mid) || typeof mid.mats !== "string" || !isNum(mid.y)) return false;
    const R = s.rock, N = R.cols * R.rows;
    if (mid.mats.length !== N) return false;
    const mats = new Array(N);
    let left = 0;
    for (let i = 0; i < N; i++) {
      const c = mid.mats.charCodeAt(i) - 48;
      if (!(c >= 0 && c <= 4)) return false;
      if (c !== 0 && c !== R.mats[i]) return false;
      mats[i] = c;
    }
    keepMain(mats, R.cols, R.rows);
    for (let i = 0; i < N; i++) if (mats[i]) left++;
    if (left < 1) return false;
    let hpOk = typeof mid.hp === "string" && mid.hp.length === N;
    if (hpOk) for (let i = 0; i < N; i++) { const c = mid.hp.charCodeAt(i) - 48; if (mats[i] && !(c >= 1 && c <= 9)) { hpOk = false; break; } }
    const hp = R.hp.map((h, i) => (mats[i] ? (hpOk ? h * (mid.hp.charCodeAt(i) - 48) / 9 : h) : 0));
    let maxRow = 0;
    for (let i = 0; i < N; i++) if (mats[i]) { const r = Math.floor(i / R.cols); if (r > maxRow) maxRow = r; }
    const yMax = BARRIER_Y - CELL - (maxRow + 1) * CELL;
    const y = clamp(mid.y, R.y, Math.max(R.y, yMax));
    s.rock = Object.assign({}, R, { mats, hp, left, y, scan: null });
    return true;
  }
  function passedMs(rock, ms) {
    const b = rock && rock.total > 0 ? 1 - rock.left / rock.total : 0;
    const out = MILESTONES.filter((p) => ms.includes(p) || b >= p / 100 - 1e-12);
    return out.length === ms.length ? ms : out;
  }
  function fullHp(s, i) {
    const R = s.rock, code = R.mats[i];
    if (!code) return null;
    const base = cellHp(s.star, matOf(code));
    const rh = R.rowHp;
    const r = Math.floor(i / R.cols);
    return Array.isArray(rh) && rh.length === R.rows && isNum(rh[r]) ? base * rh[r] : base;
  }
  function isState(s) {
    return isObj(s) && isNum(s.star) && isNum(s.kakera) && isNum(s.t) && Array.isArray(s.slots) && s.slots.length >= 1 && s.slots.length <= SLOTS_MAX &&
      s.slots.every((x) => isObj(x) && W[x.id]) &&
      isObj(s.rock) && Array.isArray(s.rock.mats) && Array.isArray(s.rock.hp) && s.rock.mats.length === s.rock.cols * s.rock.rows &&
      Array.isArray(s.shots) && Array.isArray(s.burns) && isObj(s.totals) && typeof s.phase === "string";
  }
  // 足りない欄（テストや setState が渡す形）を直す。step・買い物の写しで使う
  function fixParts(c) {
    if (!Array.isArray(c.bench)) c.bench = [];
    if (!Array.isArray(c.swap)) c.swap = [];
    if (!Array.isArray(c.cd)) c.cd = [];
    while (c.cd.length < c.slots.length) c.cd.push(0);
    if (c.cd.length > c.slots.length) c.cd.length = c.slots.length;
    if (!Array.isArray(c.turrets) || c.turrets.length !== c.slots.length || !c.turrets.every(isObj)) c.turrets = layTurrets(c.turrets, c.slots.length);
    if (!isNum(c.kfrac) || c.kfrac < 0 || c.kfrac >= 1) c.kfrac = 0;
    if (!isNum(c.wait)) c.wait = 0;
    if (typeof c.back !== "string") c.back = "fly";
    c.hold = c.hold === true;
  }
  function cloneForStep(s) {
    const c = Object.assign({}, s);
    c.rock = Object.assign({}, s.rock);
    c.shots = s.shots.map((x) => Object.assign({}, x));
    c.burns = s.burns.map((x) => Object.assign({}, x));
    c.cd = Array.isArray(s.cd) ? s.cd.slice() : [];
    c.turrets = Array.isArray(s.turrets) ? s.turrets.map((x) => Object.assign({}, x)) : null;
    c.totals = Object.assign({}, s.totals);
    c.slots = s.slots.map((x) => ({ id: x.id, lv: x.lv }));
    c.bench = Array.isArray(s.bench) ? s.bench.map((x) => ({ id: x.id, lv: x.lv })) : [];
    c.swap = Array.isArray(s.swap) ? s.swap.map((x) => ({ slot: x.slot, id: x.id })) : [];
    c.offer = s.offer ? s.offer.slice() : null;
    fixParts(c);
    return c;
  }
  // コピーオンライト：公開の step の間だけ、最初の書き込みで配列を写す（hp は当たったとき、mats は欠けたとき）
  let SIM = false, OWN_HP = null, OWN_MATS = null;
  function ownHp(s) {
    if (SIM || OWN_HP === s.rock.hp) return;
    s.rock.hp = s.rock.hp.slice();
    OWN_HP = s.rock.hp;
  }
  function ownMats(s) {
    if (SIM || OWN_MATS === s.rock.mats) return;
    s.rock.mats = s.rock.mats.slice();
    OWN_MATS = s.rock.mats;
  }
  // ねらいの表をつける。ver は その小惑星で表を作り直した回数（砲台がいつの表でねらいを決めたかを tv に覚える。決定的）
  function setScan(R, sc) {
    sc.ver = ((R.scan && isNum(R.scan.ver) ? R.scan.ver : 0) + 1) % 1e9;
    R.scan = sc;
  }
  function ensureScan(s) {
    const R = s.rock;
    if (!R.scan || R.scan.of !== R.mats) setScan(R, scanRock(R.mats, R.cols, R.rows).scan);
    return R.scan;
  }

  // ---------------------------------------------------------------- 当たり（§3.5）
  function cellX(rock, i) { return rock.x + ((i % rock.cols) + 0.5) * CELL; }
  function cellY(rock, i) { return rock.y + (Math.floor(i / rock.cols) + 0.5) * CELL; }
  function bottomRow(rock) {
    const { cols, rows, mats } = rock;
    for (let r = rows - 1; r >= 0; r--) for (let c = 0; c < cols; c++) if (mats[r * cols + c]) return r;
    return -1;
  }
  function bottomY(rock) { const r = bottomRow(rock); return r < 0 ? -Infinity : rock.y + (r + 1) * CELL; }

  // 線分（世界の座標）が通る格子のマスを順にたどる（DDA）。fn(i, t) が true を返したら止める（t は線分の 0〜1）
  function dda(R, x0, y0, x1, y1, fn) {
    const cols = R.cols, rows = R.rows;
    const gx0 = (x0 - R.x) / CELL, gy0 = (y0 - R.y) / CELL;
    const dx = (x1 - R.x) / CELL - gx0, dy = (y1 - R.y) / CELL - gy0;
    let t0 = 0, t1 = 1;
    const clip = (p, q) => {   // p·t ≦ q
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

  // マスに強さを与える。欠けたら break と かけら
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
      ownMats(s);
      const v = cellValue(s.star, mat);
      R.hp[i] = 0; R.mats[i] = 0; R.left--;
      addK(s, v);
      s.totals.cells++;
      ctx.broke = true;
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
  function ignite(s, i, ctx, fromSpread) {
    const lv = slotLv(s, "fire");
    const until = s.t + shapeOf("fire", lv);
    for (const b of s.burns) if (b.i === i) { if (b.until < until) b.until = until; return; }
    s.burns.push({ i, until, at: s.t, spread: !!fromSpread });
    ctx.evs.push({ kind: "burn", i });
  }
  function slotLv(s, id) { for (const x of s.slots) if (x.id === id) return x.lv; return 1; }

  // ---------------------------------------------------------------- ねらい（§3.3・§3.8。距離は その砲台から。同じ距離なら左）
  function nearestOf(R, list, T, code, skip) {
    let best = -1, bd = Infinity, bx = Infinity;
    const mats = R.mats, cols = R.cols;
    for (let q = 0; q < list.length; q++) {
      const i = list[q];
      const m = mats[i];
      if (!m || (code && m !== code) || (skip && skip.has(i))) continue;
      const x = R.x + ((i % cols) + 0.5) * CELL, y = R.y + (Math.floor(i / cols) + 0.5) * CELL;
      const d = (x - T.x) * (x - T.x) + (y - T.y) * (y - T.y);
      if (d < bd || (d === bd && x < bx)) { bd = d; best = i; bx = x; }
    }
    CELLS += list.length;
    return best;
  }
  function hotSet(s) {
    const hot = new Set();
    for (const b of s.burns) hot.add(b.i);
    for (const b of s.shots) if (b.w === "fire" && b.aim >= 0) hot.add(b.aim);
    return hot;
  }
  // どかん：縁のマス（4 マスおき）のうち、半径 r の中の込み具合が一番大きい所（同じなら近いほう）
  function bombTarget(R, sc, T, r) {
    let best = -1, bn = -1, bd = Infinity;
    const cols = R.cols, bw = sc.bw, bh = sc.bh, sat = sc.sat, W1 = bw + 1;
    const E = sc.edges;
    for (let q = 0; q < E.length; q += BOMB_EVERY) {
      const i = E[q];
      if (!R.mats[i]) continue;
      CELLS++;
      const c = i % cols, rr = (i - c) / cols;
      const c0 = Math.max(0, (c - r) >> 1), c1 = Math.min(bw - 1, (c + r) >> 1), r0 = Math.max(0, (rr - r) >> 1), r1 = Math.min(bh - 1, (rr + r) >> 1);
      const n = sat[(r1 + 1) * W1 + c1 + 1] - sat[r0 * W1 + c1 + 1] - sat[(r1 + 1) * W1 + c0] + sat[r0 * W1 + c0];
      const x = R.x + (c + 0.5) * CELL, y = R.y + (rr + 0.5) * CELL;
      const d = (x - T.x) * (x - T.x) + (y - T.y) * (y - T.y);
      if (n > bn || (n === bn && d < bd)) { bn = n; bd = d; best = i; }
    }
    if (best < 0) best = nearestOf(R, sc.edges, T, 0);
    return best;
  }
  // ビーム：向きを 4° ごとに調べ、光の通り道（最初に当たったマスから奥へ BEAM_DEPTH マス）のマスが一番多い向き（てつ は 2 つに数える）
  function beamTarget(R, T, cur) {
    let best = null, bn = 0, bdA = Infinity, bi = -1;
    const n = Math.round(2 * AIM_MAX / (BEAM_SCAN_DEG * DEG));
    for (let k = 0; k <= n; k++) {
      const a = -AIM_MAX + k * (2 * AIM_MAX / n);
      const mx = T.x + Math.sin(a) * BARREL, my = T.y - Math.cos(a) * BARREL;
      const ex = mx + Math.sin(a) * 900, ey = my - Math.cos(a) * 900;
      let first = -1, d0 = 0, cnt = 0;
      const len = 900;
      dda(R, mx, my, ex, ey, (i, t) => {
        const d = t * len;
        if (first < 0) { if (R.mats[i]) { first = i; d0 = d; } else return false; }
        if (d >= d0 + BEAM_DEPTH * CELL - 1e-6) return true;
        const m = R.mats[i];
        if (m) cnt += m === 2 ? 2 : 1;
        return false;
      });
      if (first < 0) continue;
      const da = Math.abs(a - cur);
      if (cnt > bn || (cnt === bn && da < bdA)) { bn = cnt; best = a; bdA = da; bi = first; }
    }
    return best === null ? null : { ang: best, i: bi };
  }

  // 砲台が向きを変える（§3.8）。ねらうマスは、マスが欠けた・時間がたった・ねらったマスが無くなったときだけ決め直す
  function aimTurrets(s, dt) {
    const R = s.rock;
    const sc = ensureScan(s);
    let heavyDone = false;
    let hot = null;
    for (let k = 0; k < s.slots.length; k++) {
      const T = s.turrets[k], w = s.slots[k].id;
      const heavy = w === "bomb" || w === "beam" || w === "bolt";
      const alive = T.tgt >= 0 && T.tgt < R.mats.length && R.mats[T.tgt] !== 0;
      const stale = T.tv !== sc.ver || s.t - T.tt >= (heavy ? RETARGET_HEAVY_SEC : RETARGET_SEC);
      let need;
      if (heavy) need = !alive || (stale && s.t + 1e-9 >= s.cd[k] - HEAVY_LEAD);
      else {
        need = !alive || stale;
        if (!need && w === "fire") { if (!hot) hot = hotSet(s); if (hot.has(T.tgt)) need = true; }
      }
      if (need && !(heavy && heavyDone && alive)) {
        if (heavy) heavyDone = true;
        T.tv = sc.ver; T.tt = s.t;
        if (w === "shot" || w === "spread") T.tgt = nearestOf(R, sc.edges, T, 0);
        else if (w === "fire") {
          if (!hot) hot = hotSet(s);
          T.tgt = nearestOf(R, sc.edges, T, 0, hot);
          if (T.tgt < 0) T.tgt = nearestOf(R, sc.edges, T, 0);
        } else if (w === "bolt") {
          T.tgt = nearestOf(R, sc.irons, T, 2);
          if (T.tgt < 0) T.tgt = nearestOf(R, sc.edges, T, 0);
        } else if (w === "bomb") T.tgt = bombTarget(R, sc, T, shapeOf("bomb", s.slots[k].lv));
        else if (w === "beam") {
          const b = beamTarget(R, T, T.ang);
          T.tgt = b ? b.i : -1;
          if (b) T.aim = b.ang;
        }
      }
      if (T.tgt >= 0 && R.mats[T.tgt] && w !== "beam") T.aim = clamp(angTo(T, cellX(R, T.tgt), cellY(R, T.tgt)), -AIM_MAX, AIM_MAX);
      T.aim = clamp(isNum(T.aim) ? T.aim : 0, -AIM_MAX, AIM_MAX);
      const mv = TURN_SPEED * dt, da = T.aim - T.ang;
      T.ang = Math.abs(da) <= mv ? T.aim : T.ang + Math.sign(da) * mv;
      T.ang = clamp(T.ang, -AIM_MAX, AIM_MAX);
    }
  }

  // ---------------------------------------------------------------- 撃つ（§3.3・§3.5）
  function fireWeapon(s, k, ctx) {
    const slot = s.slots[k], T = s.turrets[k];
    const w = slot.id, L = slot.lv, R = s.rock;
    const tgt = T.tgt;
    const mz = muzzle(T);
    const d = dmg(w, L);
    const room = () => s.shots.length < SHOTS_MAX;
    const sa = Math.sin(T.ang), ca = Math.cos(T.ang);
    if (w === "shot" || w === "spread" || w === "fire") {
      ctx.evs.push({ kind: "fire", k, w, x: mz.x, y: mz.y, ang: T.ang, tx: cellX(R, tgt), ty: cellY(R, tgt) });
      if (w === "spread") {
        const n = shapeOf(w, L);
        // 扇：となりの弾との角度は fan ÷ (1 + (n−5)/4)（5発 3°・7発 2.5°・9発 2.25°・11発 2.1°）。扇の全体は 12°・15°・18°・21°。
        // ユーザー決定（2026-10-22）「半分くらいにして」で 0.5 倍、（2026-10-23）「今の25%減」で 0.375 倍（§20.3）
        const fan = 0.375 * (8 + 2 * (n - 5) / 2) * DEG;
        for (let j = 0; j < n && room(); j++) {
          const a = T.ang + (j - (n - 1) / 2) * fan / (1 + (n - 5) / 4);
          s.shots.push({ k, w, x: mz.x, y: mz.y, vx: Math.sin(a) * BULLET_SPEED, vy: -Math.cos(a) * BULLET_SPEED, t: 0, dmg: d });
        }
      } else if (w === "shot") {
        const n = shapeOf(w, L);
        for (let j = 0; j < n && room(); j++) {
          const off = (j - (n - 1) / 2) * 4;   // 連は砲身に直角にならべる
          s.shots.push({ k, w, x: mz.x + ca * off, y: mz.y + sa * off, vx: sa * BULLET_SPEED, vy: -ca * BULLET_SPEED, t: 0, dmg: d });
        }
      } else if (room()) {
        s.shots.push({ k, w, x: mz.x, y: mz.y, vx: sa * BULLET_SPEED, vy: -ca * BULLET_SPEED, t: 0, dmg: d, aim: tgt });
      }
    } else if (w === "bomb") {
      if (!room()) return;
      const tc = (tgt % R.cols) + 0.5, tr = Math.floor(tgt / R.cols) + 0.5;
      const tx = R.x + tc * CELL, ty = R.y + tr * CELL;
      ctx.evs.push({ kind: "fire", k, w, x: mz.x, y: mz.y, ang: T.ang, tx, ty });
      s.shots.push({ k, w, x: mz.x, y: mz.y, vx: (tx - mz.x) / BOMB_FLIGHT, vy: (ty - mz.y) / BOMB_FLIGHT, t: 0, dmg: d, sx: mz.x, sy: mz.y, tc, tr, r: shapeOf(w, L) });
    } else if (w === "bolt") {
      ctx.evs.push({ kind: "fire", k, w, x: mz.x, y: mz.y, ang: T.ang, tx: cellX(R, tgt), ty: cellY(R, tgt) });
      const tree = boltTree(s, tgt, shapeOf(w, L));
      ctx.evs.push({ kind: "bolt", from: tgt, edges: tree.edges });
      for (const i of tree.cells) hurt(s, i, d, w, ctx);
    } else if (w === "beam") {
      fireBeam(s, k, T, mz, shapeOf(w, L), d, ctx);
    }
  }
  // いなずま：ねらったマスから、上下左右でつながった同じ種類のマスを幅優先でたどる（同じ距離の中では種つきのハッシュの順）。最大 n マス
  function boltTree(s, start, n) {
    const R = s.rock, cols = R.cols, mats = R.mats, N = mats.length;
    const m = mats[start];
    const cells = [start], edges = [], seen = new Set([start]);
    const salt = hash2(s.seed >>> 0, Math.floor(s.t * 30) >>> 0);
    let head = 0;
    while (head < cells.length && cells.length < n) {
      const j = cells[head++];
      const c = j % cols;
      const nb = [];
      if (j >= cols) nb.push(j - cols);
      if (c > 0) nb.push(j - 1);
      if (c < cols - 1) nb.push(j + 1);
      if (j + cols < N) nb.push(j + cols);
      nb.sort((a, b) => hash2(salt, a) - hash2(salt, b));
      for (const q of nb) {
        CELLS++;
        if (cells.length >= n) break;
        if (!seen.has(q) && mats[q] === m) { seen.add(q); cells.push(q); edges.push([j, q]); }
      }
    }
    return { cells, edges };
  }
  // ビーム：光の通り道（幅 W マス）を、最初に当たったマスから奥へ BEAM_DEPTH マスまで全部（§3.5「ビームの穴」）
  function fireBeam(s, k, T, mz, Wc, d, ctx) {
    const R = s.rock;
    const sa = Math.sin(T.ang), ca = Math.cos(T.ang);
    const LEN = 900;
    const m = 2 * Wc - 1;
    const lines = [];
    let d0 = Infinity;
    for (let j = 0; j < m; j++) {
      const off = (j - (m - 1) / 2) * CELL / 2;
      const x0 = mz.x + ca * off, y0 = mz.y + sa * off;
      const got = [];
      dda(R, x0, y0, x0 + sa * LEN, y0 - ca * LEN, (i, t) => {
        const dd = t * LEN;
        if (dd > d0 + BEAM_DEPTH * CELL) return true;
        if (R.mats[i]) { got.push(i, dd); if (dd < d0) d0 = dd; }
        return false;
      });
      lines.push(got);
    }
    const len = d0 === Infinity ? 600 : d0 + BEAM_DEPTH * CELL;
    const cells = [];
    if (d0 !== Infinity) {
      const seen = new Set();
      for (const got of lines) for (let q = 0; q < got.length; q += 2) {
        const i = got[q];
        if (got[q + 1] < d0 + BEAM_DEPTH * CELL - 1e-6 && !seen.has(i)) { seen.add(i); cells.push(i); }
      }
    }
    ctx.evs.push({ kind: "fire", k, w: "beam", x: mz.x, y: mz.y, ang: T.ang, tx: mz.x + sa * len, ty: mz.y - ca * len });
    ctx.evs.push({ kind: "beam", k, x: mz.x, y: mz.y, ang: T.ang, len, w: Wc * CELL, cells: cells.slice() });
    for (const i of cells) hurt(s, i, d, "beam", ctx);
  }

  // ---------------------------------------------------------------- 1 step（§4.2 の順）
  function stepMut(s, dt, evs) {
    const ctx = { evs, broke: false };
    if (s.phase === "choose" || s.phase === "end") return;
    s.t += dt;
    if (s.phase === "bounce" || s.phase === "clear") {
      s.wait -= dt;
      if (s.wait <= 1e-9) {
        s.wait = 0;
        if (s.phase === "bounce") restartStar(s, evs);
        else nextStar(s, evs);
      }
      return;
    }
    if (s.phase !== "fly") s.phase = "fly";
    const rock = s.rock;
    // 1. 小惑星が降りる
    rock.y += rock.vy * dt;
    // 2. 砲台が向きを変える
    aimTurrets(s, dt);
    const dist0 = progressS(s).distance;
    // 3. 砲台が撃つ（hold なら撃たない。§21.2）
    if (!s.hold) {
      for (let k = 0; k < s.slots.length; k++) {
        if (!(s.t + 1e-9 >= s.cd[k])) continue;
        if (s.rock.left <= 0) break;
        const T = s.turrets[k];
        if (!(T.tgt >= 0 && s.rock.mats[T.tgt]) || Math.abs(T.ang - T.aim) > AIM_TOL + 1e-9) continue;
        fireWeapon(s, k, ctx);
        const rate = W[s.slots[k].id].rate;
        s.cd[k] = s.cd[k] + rate > s.t ? s.cd[k] + rate : s.t + rate;
      }
    }
    // 4. 弾が飛んで当たる（斜めの線を DDA でたどる）
    if (s.shots.length) {
      const keep = [];
      for (const b of s.shots) {
        b.t += dt;
        if (b.w === "bomb") {
          const R = s.rock;
          const tx = R.x + b.tc * CELL, ty = R.y + b.tr * CELL;
          const f = Math.min(1, b.t / BOMB_FLIGHT);
          const nx = b.sx + (tx - b.sx) * f, ny = b.sy + (ty - b.sy) * f - Math.sin(Math.PI * f) * 60;
          if (dt > 0) { b.vx = (nx - b.x) / dt; b.vy = (ny - b.y) / dt; }
          b.x = nx; b.y = ny;
          if (b.t + 1e-9 >= BOMB_FLIGHT) {
            ctx.evs.push({ kind: "boom", x: tx, y: ty, r: b.r * CELL });
            const rr = b.r * b.r;
            const c0 = Math.floor(b.tc - b.r - 1), c1 = Math.ceil(b.tc + b.r + 1), r0 = Math.floor(b.tr - b.r - 1), r1 = Math.ceil(b.tr + b.r + 1);
            for (let r = Math.max(0, r0); r <= Math.min(R.rows - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(R.cols - 1, c1); c++) {
              const dc = c + 0.5 - b.tc, dr = r + 0.5 - b.tr;
              const i = r * R.cols + c;
              if (dc * dc + dr * dr <= rr + 1e-9 && s.rock.mats[i]) hurt(s, i, b.dmg, "bomb", ctx);
            }
            continue;
          }
          keep.push(b);
          continue;
        }
        const x0 = b.x, y0 = b.y;
        b.x += b.vx * dt; b.y += b.vy * dt;
        let hit = -1;
        const R = s.rock;
        dda(R, x0, y0, b.x, b.y, (i) => { if (R.mats[i]) { hit = i; return true; } return false; });
        if (hit >= 0) {
          if (b.w === "fire") ignite(s, hit, ctx);
          else hurt(s, hit, b.dmg, b.w, ctx);
          continue;
        }
        if (b.x < -40 || b.x > FIELD_W + 40 || b.y < -600 || b.y > FIELD_H + 40 || b.t > 3) continue;
        keep.push(b);
      }
      s.shots = keep;
    }
    // 5. 燃える
    if (s.burns.length) {
      const per = dmg("fire", slotLv(s, "fire"));
      const keep = [];
      const add = [];
      const moved = [];
      for (const b of s.burns) {
        if (!s.rock.mats[b.i]) continue;
        if (!b.spread && s.t + 1e-9 >= b.at + BURN_SPREAD_SEC) {
          b.spread = true;
          const R = s.rock, c = b.i % R.cols;
          const nb = [];
          if (c > 0) nb.push(b.i - 1);
          if (c < R.cols - 1) nb.push(b.i + 1);
          if (b.i >= R.cols) nb.push(b.i - R.cols);
          if (b.i + R.cols < R.mats.length) nb.push(b.i + R.cols);
          for (const q of nb) if (R.mats[q] === 3) add.push(q);
        }
        const broke = hurt(s, b.i, per * dt, "fire", ctx, true);
        if (!broke) { if (s.t < b.until) keep.push(b); continue; }
        // 燃えていたマスが欠けたら、残りの時間で となりのマス（こおり を先に）へ燃えうつる（マスが細かいので、火を むだにしない）
        if (s.t < b.until) moved.push(b);
      }
      s.burns = keep;
      for (const b of moved) {
        const R = s.rock, c = b.i % R.cols;
        const nb = [];
        if (b.i >= R.cols) nb.push(b.i - R.cols);
        if (c > 0) nb.push(b.i - 1);
        if (c < R.cols - 1) nb.push(b.i + 1);
        if (b.i + R.cols < R.mats.length) nb.push(b.i + R.cols);
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
    // 6. かけらは hurt の中で足し済み。7. はなれたかたまり（ねらいの表もここで作り直す）
    if (ctx.broke && s.rock.left > 0) breakLoose(s, ctx);
    // 7.5 区切り
    if (ctx.broke) milestones(s, evs);
    // 8. クリア／とどいた
    if (s.rock.left <= 0) {
      const bonus = Math.floor(s.rock.value * CLEAR_BONUS);
      addK(s, bonus);
      s.totals.stars++;
      s.phase = "clear"; s.wait = CLEAR_SEC; s.shots = []; s.burns = []; s.hold = false;
      const time = Math.max(0.1, Math.round((s.t - (isNum(s.tryAt) ? s.tryAt : 0)) * 10) / 10);
      const bt = isObj(s.bestT) ? s.bestT : {};
      const prev = isNum(bt[s.star]) ? bt[s.star] : null;
      if (prev === null || time < prev) s.bestT = trimBest(Object.assign({}, bt, { [s.star]: time }));
      evs.push({ kind: "clear", star: s.star, bonus, time, best: prev, distance: dist0 });
    } else if (bottomY(s.rock) >= BARRIER_Y - 1e-9) {
      const broken = progressS(s).broken;
      s.phase = "bounce"; s.wait = BOUNCE_SEC; s.shots = []; s.burns = []; s.hold = false;
      s.tries = Math.min(TRIES_MAX, s.tries + 1);
      evs.push({ kind: "bounce", broken });
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
  function breakLoose(s, ctx) {
    const R = s.rock;
    const sc = scanRock(R.mats, R.cols, R.rows);
    setScan(R, sc.scan);
    const list = sc.list;
    if (list.length <= 1) return;
    const m = mainIndex(list, R.cols, R.rows);
    ownMats(s); ownHp(s);
    const R2 = s.rock;
    sc.scan.of = R2.mats;   // はなれたマスは表に残るが、使うときに mats で除く（本体の縁は変わらない）
    for (let k = 0; k < list.length; k++) {
      if (k === m) continue;
      let v = 0;
      for (const j of list[k]) { v += cellValue(s.star, matOf(R2.mats[j])); R2.mats[j] = 0; R2.hp[j] = 0; }
      R2.left -= list[k].length;
      addK(s, v);
      s.totals.cells += list[k].length; s.totals.chunks++;
      ctx.evs.push({ kind: "chunk", cells: list[k].slice(), value: v });
    }
  }
  // 入れ替えの予約を当てる（§3.6。次の星の始め・はね返しのやり直しの始め）。Lv は武器ごと：外した武器はその Lv で ひかえ へ
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
      if (s.turrets[k]) { s.turrets[k].tgt = -1; s.turrets[k].tv = null; }
      evs.push({ kind: "swap", slot: k, from: out.id, to: inn.id, lv: inn.lv });
    }
    s.swap = [];
  }
  function restartStar(s, evs) {
    s.rock = genRock(s.seed, s.star, s.tries);
    s.shots = []; s.burns = []; s.hold = false;
    s.phase = "fly";
    applySwaps(s, evs || []);
    s.cd = s.slots.map(() => s.t);
    for (const T of s.turrets) { T.tgt = -1; T.tv = null; }
    s.tryAt = s.t;
  }
  function nextStar(s, evs) {
    const was = s.star;
    s.star = Math.min(STAR_MAX, s.star + 1);
    s.tries = 1;
    s.rock = genRock(s.seed, s.star, 1);
    s.shots = []; s.burns = []; s.hold = false;
    applySwaps(s, evs);
    s.cd = s.slots.map(() => s.t);
    for (const T of s.turrets) { T.tgt = -1; T.tv = null; }
    s.ms = []; s.tryAt = s.t;
    if (was === ENDING_STAR && !s.cleared) {
      s.cleared = true;
      s.phase = "end";
      evs.push({ kind: "ending" });
      return;
    }
    s.phase = "fly";
    if (s.star % APPROACH.bossEvery === 0) evs.push({ kind: "boss", star: s.star });
  }

  function step(state, dt) {
    try {
      if (!isState(state)) return null;
      dt = isNum(dt) ? clamp(dt, 0, 0.1) : 0;
      const s = cloneForStep(state);
      const events = [];
      OWN_HP = null; OWN_MATS = null;
      stepMut(s, dt, events);
      OWN_HP = null; OWN_MATS = null;
      return { state: s, events };
    } catch (e) { OWN_HP = null; OWN_MATS = null; return null; }
  }

  // ---------------------------------------------------------------- 画面用の値
  function nominalHits(w, L) {
    const v = shapeOf(w, L);
    if (w === "shot") return v;
    if (w === "spread") return v * 1.0;
    if (w === "bomb") { let n = 0; const r = Math.ceil(v); for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (a * a + b * b <= v * v + 1e-9) n++; return n * 0.9; }
    if (w === "bolt") return v * 0.8;
    if (w === "beam") return v * BEAM_DEPTH * 0.9;
    if (w === "fire") return v;
    return 1;
  }
  function dpsRaw(w, L) { return dmg(w, L) * nominalHits(w, L) / W[w].rate; }
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
    const by = bottomY(R);
    const b0 = isNum(R.bottom0) ? R.bottom0 : START_BOTTOM;
    const distance = by === -Infinity ? 1 : by >= BARRIER_Y - 1e-6 ? 0 : clamp((BARRIER_Y - by) / (BARRIER_Y - b0), 0, 1);
    return { broken, left, total, distance };
  }
  function progressOf(state) {
    try { return isState(state) ? progressS(state) : null; } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- 買う・開ける・選ぶ・入れ替え（§3.4・§3.6）
  function shallow(s) {
    const c = Object.assign({}, s);
    c.slots = s.slots.map((x) => ({ id: x.id, lv: x.lv }));
    c.bench = Array.isArray(s.bench) ? s.bench.map((x) => ({ id: x.id, lv: x.lv })) : [];
    c.swap = Array.isArray(s.swap) ? s.swap.map((x) => ({ slot: x.slot, id: x.id })) : [];
    c.cd = Array.isArray(s.cd) ? s.cd.slice() : [];
    c.turrets = Array.isArray(s.turrets) ? s.turrets.map((x) => Object.assign({}, x)) : null;
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
      const events = lv % EVOLVE_EVERY === 0 ? [{ kind: "evolve", slot, lv }] : [];
      return { state: s, ok: true, events };
    } catch (e) { return { state, ok: false, reason: "error" }; }
  }
  // 2択の候補：砲台・ひかえ のどれにも無い武器から（予約の武器は ひかえ にある）。得意なマスが違う 2 つ。残りが 1 つなら [id]
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
  // 選んだ武器は Lv1 で、砲台が 4 台未満なら新しい砲台に、4 台なら ひかえ に入る。返り値は 'slot'|'bench'（失敗は null）
  function chooseMut(s, k, evs) {
    if (s.phase !== "choose" || !Array.isArray(s.offer) || !Number.isInteger(k) || k < 0 || k >= s.offer.length) return null;
    const id = s.offer[k];
    if (!W[id] || s.slots.some((x) => x.id === id) || s.bench.some((x) => x.id === id)) return null;
    let to;
    if (s.slots.length < SLOTS_MAX) {
      s.slots.push(newSlot(id));
      s.cd.push(s.t);
      s.turrets = layTurrets(s.turrets, s.slots.length);
      if (evs) evs.push({ kind: "turrets", n: s.slots.length });
      to = "slot";
    } else {
      s.bench.push(newSlot(id));
      to = "bench";
    }
    s.offer = null;
    s.phase = ["fly", "bounce", "clear", "end"].includes(s.back) ? s.back : "fly";
    s.back = "fly";
    return to;
  }
  function choose(state, k) {
    try {
      if (!isState(state)) return { state, ok: false, to: null };
      const s = shallow(state);
      const events = [];
      const to = chooseMut(s, k, events);
      if (!to) return { state, ok: false, to: null };
      return { state: s, ok: true, to, events };
    } catch (e) { return { state, ok: false, to: null }; }
  }
  // その枠に予約できる武器：今の武器（取り消し。先頭）と、ひかえの武器のうちほかの枠の予約に使われていないもの
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
    if (id === s.slots[slot].id) return null;   // 今の武器＝予約の取り消し
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

  // ---------------------------------------------------------------- かけらの書き方（§1.3）
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

  // ---------------------------------------------------------------- 保存（§8）
  function saveObj(state, withMid) {
    let star = state.star, tries = state.tries, ms = Array.isArray(state.ms) ? state.ms.slice() : [];
    let slots = state.slots.map((x) => ({ id: x.id, lv: x.lv }));
    let bench = (Array.isArray(state.bench) ? state.bench : []).map((x) => ({ id: x.id, lv: x.lv }));
    let swap = (Array.isArray(state.swap) ? state.swap : []).map((x) => ({ slot: x.slot, id: x.id }));
    // クリアの演出中（phase 'clear'、または 2択の間で戻り先が 'clear'）は次の星を保存する（はじめての星 ENDING_STAR だけはエンディングを見せるため、その星のまま）。
    // はね返しの間（phase 'bounce'、または 2択の間で戻り先が 'bounce'）は、やり直しの始めに当たる予約を先に当てて書く（tries はそのまま）。
    // どちらも、入れ替えの予約を当てた slots・bench と swap: [] で書く（§8.2）
    const ph = state.phase === "choose" ? state.back : state.phase;
    const toNext = ph === "clear" && !(state.star === ENDING_STAR && !state.cleared);
    if (toNext) { star = Math.min(STAR_MAX, state.star + 1); tries = 1; ms = []; }
    if (toNext || ph === "bounce") {
      const tmp = { slots, bench, swap, turrets: layTurrets(null, slots.length) };
      applySwaps(tmp, []);
      slots = tmp.slots; bench = tmp.bench; swap = [];
    }
    const o = {
      v: SAVE_VERSION, star, kakera: state.kakera, kfrac: isNum(state.kfrac) && state.kfrac >= 0 && state.kfrac < 1 ? state.kfrac : 0,
      slots, bench, offer: state.offer ? state.offer.slice() : null, swap, cleared: !!state.cleared, tries,
      totals: { cells: state.totals.cells, stars: state.totals.stars, kakera: state.totals.kakera, chunks: state.totals.chunks },
      seed: state.seed, rng: state.rng, ms, bestT: isObj(state.bestT) ? Object.assign({}, state.bestT) : {}
    };
    if (withMid) { const m = midOf(state); if (m) o.mid = m; }
    return o;
  }
  function midOf(state) {
    if (state.phase !== "fly" && !(state.phase === "choose" && (state.back === "fly" || state.back === undefined))) return null;
    const R = state.rock;
    if (!R || !(R.left > 0)) return null;
    let mats = "", hp = "";
    for (let i = 0; i < R.mats.length; i++) {
      const m = R.mats[i] | 0;
      mats += String(m);
      if (!m) { hp += "0"; continue; }
      const full = fullHp(state, i);
      const f = full > 0 && isNum(R.hp[i]) ? R.hp[i] / full : 1;
      hp += String(clamp(Math.ceil(f * 9 - 1e-9), 1, 9));
    }
    const tt = Math.max(0, Math.round((state.t - (isNum(state.tryAt) ? state.tryAt : 0)) * 10) / 10);
    return { y: Math.round(R.y * 100) / 100, mats, hp, tt };
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
  function saveVersionOf(raw) {
    try {
      const o = parseRaw(raw);
      if (!isObj(o)) return null;
      return o.v === 1 ? 1 : o.v === 2 ? 2 : null;
    } catch (e) { return null; }
  }
  const intIn = (x, lo, hi, def) => (isNum(x) ? clamp(Math.floor(x), lo, hi) : def);
  function loadSave(raw) {
    try {
      const o = parseRaw(raw);
      if (!isObj(o) || typeof o.v !== "number") return null;
      const seed = isNum(o.seed) ? Math.floor(Math.abs(o.seed)) >>> 0 : 1;
      // v:1（作り直しの前）：かけらだけ引き継ぐ（§8.4）。星は 1・たま Lv1・ひかえなし・挑戦 1 回目・累計とベスト時間は 0 から
      if (o.v === 1) {
        const s = newGame(seed);
        s.kakera = intIn(o.kakera, 0, KAKERA_MAX, 0);
        return s;
      }
      if (o.v !== SAVE_VERSION) return null;
      const star = intIn(o.star, 1, STAR_MAX, 1);
      const kakera = intIn(o.kakera, 0, KAKERA_MAX, 0);
      const kfrac = isNum(o.kfrac) && o.kfrac >= 0 && o.kfrac < 1 ? o.kfrac : 0;
      // 武器（砲台）：重複は後ろを捨てる・知らない id は捨てる・lv は 1〜99。空なら たま Lv1。5 つ目からは ひかえ へ回す（捨てない）
      const seen = new Set();
      const slots = [], over = [];
      for (const x of Array.isArray(o.slots) ? o.slots : []) {
        if (!isObj(x) || typeof x.id !== "string" || !W[x.id] || seen.has(x.id)) continue;
        seen.add(x.id);
        const it = { id: x.id, lv: intIn(x.lv, 1, LEVEL_MAX, 1) };
        if (slots.length < SLOTS_MAX) slots.push(it); else over.push(it);
      }
      if (!slots.length) { slots.push({ id: "shot", lv: 1 }); seen.add("shot"); }
      // ひかえ：知っている id で、砲台にも前のほうにも無いものだけ
      const bench = over.slice();
      for (const x of Array.isArray(o.bench) ? o.bench : []) {
        if (!isObj(x) || typeof x.id !== "string" || !W[x.id] || seen.has(x.id)) continue;
        seen.add(x.id);
        bench.push({ id: x.id, lv: intIn(x.lv, 1, LEVEL_MAX, 1) });
      }
      // 入れ替えの予約：枠が今の数の中・id が ひかえ にある・ほかの予約と重ならない（同じ枠・同じ id は後ろを捨てる）
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
      const totals = { cells: intIn(tt.cells, 0, KAKERA_MAX, 0), stars: intIn(tt.stars, 0, KAKERA_MAX, 0), kakera: intIn(tt.kakera, 0, KAKERA_MAX, 0), chunks: intIn(tt.chunks, 0, KAKERA_MAX, 0) };
      let cleared = o.cleared === true;
      if (star > ENDING_STAR) cleared = true;
      const ms = Array.isArray(o.ms) ? MILESTONES.filter((p) => o.ms.includes(p)) : [];
      const bestT = {};
      if (isObj(o.bestT)) for (const k of Object.keys(o.bestT)) {
        const v = o.bestT[k];
        if (!/^[1-9][0-9]{0,3}$/.test(k) || Number(k) > STAR_MAX || !isNum(v) || v <= 0 || v > 1e7) continue;
        bestT[Number(k)] = Math.max(0.1, Math.round(v * 10) / 10);
      }
      const base = { star, kakera, kfrac, slots, bench, swap, offer: null, cleared, tries, totals, seed, rng, mid: o.mid, ms, bestT: trimBest(bestT) };
      // 2択：持っていない（砲台・ひかえ のどちらにも無い）知っている武器なら残す。壊れていれば（払い済みなので）作り直す
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

  // ---------------------------------------------------------------- 自動プレイ（§3.9）
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
  function greedyBuy(s) {
    const mix = mixOf(s.star);
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
  // いまの かけら を全部その武器に使ったら届く Lv
  function lvReach(w, L, budget, buys) {
    let lv = L, b = budget;
    for (let g = 0; g < Math.min(LEVEL_MAX, buys); g++) { const c = upCost(w, lv); if (c === null || c > b) break; b -= c; lv++; }
    return lv;
  }
  // 入れ替えの判断（greedy）：次の挑戦の星の混ざり方で、ひかえの武器（覚えている Lv から、いまの かけら で届く Lv）に替えると
  // その枠が 1 割以上強くなる組のうち、一番得な 1 つを予約する。買える回数は 90 秒ぶん（buyEvery 秒に 1 回）までと見る
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
      const m = aheadMix(s.star);
      return fitOf(a, m) <= fitOf(b, m) ? 0 : 1;
    }
    const m = starInfo(s.star).tag ? mixOf(s.star) : aheadMix(s.star);
    const fa = fitOf(a, m), fb = fitOf(b, m);
    if (fa !== fb) return fa > fb ? 0 : 1;
    const am = aheadMix(s.star);
    return fitOf(a, am) >= fitOf(b, am) ? 0 : 1;
  }
  function median(a) { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; }
  function simulate(policy, opts) {
    const pol = ["greedy", "random", "worst", "idle"].includes(policy) ? policy : "greedy";
    opts = isObj(opts) ? opts : {};
    const maxStar = isNum(opts.maxStar) ? Math.floor(opts.maxStar) : ENDING_STAR;
    const maxSec = isNum(opts.maxSec) ? opts.maxSec : 6 * 3600;
    const seed = isNum(opts.seed) ? opts.seed : 1;
    const buyEvery = isNum(opts.buyEvery) && opts.buyEvery >= 1 ? Math.floor(opts.buyEvery) : 1;
    const reopenEvery = isNum(opts.reopenEvery) && opts.reopenEvery >= 10 ? opts.reopenEvery : 0;
    const reopenMid = opts.reopenMid !== false;
    const pickOrder = Array.isArray(opts.pickOrder) ? opts.pickOrder.filter((id) => typeof id === "string") : null;
    const doSwap = opts.swap !== false && pol !== "worst" && pol !== "idle";
    const rep = {
      policy: pol, seed, buyEvery, stars: [], firstBuySec: null, buys: 0, buyGaps: { avg: null, max: 0 }, endSec: null,
      kakeraMax: 0, shotsMax: 0, particlesMax: 0, bounces: [], picks: [], kakeraAtBounce: [], reopens: 0, swaps: 0, swapLog: [],
      stepCells: 0, gotAt: [], boltCells: [], sideHits: { all: 0, side: 0 }, t: 0, error: null, final: null
    };
    const wasSim = SIM;
    SIM = true;
    try {
      let s = newGame(seed);
      // 測る用：星と武器を決めて始める（opts.start = { star, slots, bench, kakera }）
      if (isObj(opts.start)) {
        const st = opts.start;
        const o = loadSave(JSON.stringify({ v: SAVE_VERSION, star: st.star || 1, kakera: st.kakera || 0, slots: st.slots || [{ id: "shot", lv: 1 }], bench: st.bench || [], seed, rng: hash2(seed >>> 0, 0x2b), cleared: (st.star || 1) > ENDING_STAR }));
        if (o) s = o;
      }
      fixParts(s);
      let nextReopen = reopenEvery || Infinity;
      const simRnd = makeRng(hash2(seed >>> 0, 0x51a1));
      const evs = [];
      let starStart = 0, tryStart = 0, starBuys = 0, lastBuy = 0, nextBuy = 1, starChunks = 0;
      let leftRatio = 1, lastPhase = s.phase, swapAsked = false;
      let b30 = null;
      const win = [];
      let partNow = 0;
      let owned = ownedCount(s);
      while (s.t < maxSec) {
        if (s.phase === "choose") {
          const k = pickChoice(s, pol, simRnd, pickOrder);
          rep.picks.push({ star: s.star, offer: s.offer.slice(), pick: s.offer[k] });
          chooseMut(s, k, null);
          const n = ownedCount(s);
          if (n > owned) { owned = n; rep.gotAt.push({ n, star: s.star, t: Math.round(s.t) }); }
        }
        if (s.phase === "end") s.phase = "fly";
        // 入れ替え：クリアの演出の間（次の星）と はね返しの間（同じ星）に 1 回だけ考える
        if ((s.phase === "clear" || s.phase === "bounce") && !swapAsked) {
          swapAsked = true;
          const nextN = s.phase === "clear" ? Math.min(STAR_MAX, s.star + 1) : s.star;
          if (doSwap && pol === "greedy") greedySwap(s, nextN, buyEvery);
          else if (doSwap && pol === "random" && s.bench.length && simRnd() < 0.3) {
            const k = Math.floor(simRnd() * s.slots.length), b = s.bench[Math.floor(simRnd() * s.bench.length)];
            reserveSwapMut(s, k, b.id);
          }
        }
        if (s.phase === "fly") swapAsked = false;
        if (s.t >= nextReopen && s.phase === "fly") {
          nextReopen = s.t + reopenEvery;
          const t = s.t, o = loadSave(saveObj(s, reopenMid));
          if (o) { o.t = t; o.tryAt += t; o.cd = o.slots.map(() => t); s = o; rep.reopens++; if (!reopenMid) tryStart = t; }
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
        evs.length = 0;
        CELLS = 0;
        const sideW = s.slots.length >= 2 ? new Set([s.slots[0].id, s.slots[s.slots.length - 1].id]) : null;
        const br = sideW ? bottomRow(s.rock) : -1;
        stepMut(s, STEP, evs);
        if (CELLS > rep.stepCells) rep.stepCells = CELLS;
        let born = 0;
        for (const e of evs) {
          if (e.kind === "break") born += 2;
          else if (e.kind === "chunk") { born += e.cells.length * 2; starChunks++; }
          else if (e.kind === "hit") {
            if (sideW && sideW.has(e.w) && e.w !== "bolt" && e.w !== "bomb" && e.w !== "fire") {
              rep.sideHits.all++;
              if (Math.floor(e.i / s.rock.cols) < br - 2) rep.sideHits.side++;
            }
          } else if (e.kind === "bolt") {
            if (s.star >= 3 && starInfo(s.star).main === "iron") { const x = s.slots.find((y) => y.id === "bolt"); rep.boltCells.push((e.edges.length + 1) / shapeOf("bolt", x ? x.lv : 1)); }
          } else if (e.kind === "swap") { rep.swaps++; rep.swapLog.push({ star: s.star, slot: e.slot, from: e.from, to: e.to, lv: e.lv }); }
          else if (e.kind === "clear") {
            rep.stars.push({ star: e.star, boss: e.star % APPROACH.bossEvery === 0, sec: +(s.t - starStart).toFixed(2), clearSec: +(s.t - tryStart).toFixed(2),
              tries: s.tries, leftRatio: +leftRatio.toFixed(3), buys: starBuys, kakera: s.kakera, b30: b30 === null ? 1 : +b30.toFixed(3), chunks: starChunks });
            b30 = null; starChunks = 0;
            if (e.star === maxStar) rep.endSec = s.t;
          } else if (e.kind === "bounce") {
            rep.bounces.push({ star: s.star, broken: +e.broken.toFixed(3), t: +s.t.toFixed(1) });
            rep.kakeraAtBounce.push(s.kakera);
          }
        }
        win.push(born); partNow += born;
        if (win.length > Math.round(0.9 / STEP)) partNow -= win.shift();
        if (partNow > rep.particlesMax) rep.particlesMax = partNow;
        if (s.shots.length > rep.shotsMax) rep.shotsMax = s.shots.length;
        if (s.kakera > rep.kakeraMax) rep.kakeraMax = s.kakera;
        if (s.phase === "fly") {
          leftRatio = clamp((BARRIER_Y - bottomY(s.rock)) / (BARRIER_Y - START_BOTTOM), 0, 1);
          if (lastPhase === "clear" || lastPhase === "end") { starStart = s.t; tryStart = s.t; starBuys = 0; b30 = null; starChunks = 0; }
          else if (lastPhase === "bounce") tryStart = s.t;
          if (b30 === null && s.t - starStart >= 30 - 1e-9) b30 = progressS(s).broken;
        }
        lastPhase = s.phase;
        if (rep.endSec !== null && rep.stars.length && rep.stars[rep.stars.length - 1].star >= maxStar) break;
      }
      rep.t = s.t;
      rep.buyGaps.avg = rep.buys ? +(s.t / rep.buys).toFixed(2) : null;
      rep.boltMedian = median(rep.boltCells);
      rep.boltCells = rep.boltCells.length;   // 数だけ残す（報告を軽く）
      rep.final = { star: s.star, kakera: s.kakera, slots: s.slots.map((x) => ({ id: x.id, lv: x.lv })), bench: s.bench.map((x) => ({ id: x.id, lv: x.lv })), tries: s.tries, totals: Object.assign({}, s.totals), cleared: s.cleared, phase: s.phase };
    } catch (e) {
      rep.error = String(e && e.stack || e);
    } finally {
      SIM = wasSim;
    }
    return rep;
  }

  const api = {
    NAME, MATS, WEAPONS, EVOLVE, MAT_HP, MAT_VALUE, UP_COST, SLOT_COST,
    FIELD_W, FIELD_H, BARRIER_Y, TURRET_Y, ARC_SAG, CELL, GRID_MAX,
    AIM_MAX, TURN_SPEED, AIM_TOL, BARREL, BOLT_CELLS, BEAM_W, BEAM_DEPTH,
    HP_BASE, HP_GROWTH, VALUE_GROWTH, HP_GROWTH2, VALUE_GROWTH2, VALUE_DIV, EARLY_HP, UP_GROWTH, LEVEL_MAX, SLOTS_MAX,
    CLEAR_BONUS, MILESTONE_BONUS, MILESTONES, BEST_MAX, SOFT, ENDING_STAR, STAR_MAX, STAR_CALC_MAX, KAKERA_MAX, SHOTS_MAX, STEP,
    SAVE_VERSION, SAVE_KEY, SAVE_KEY_BAK, SAVE_KEY_BEST, SAVE_KEY_HELP,
    START_BOTTOM, BOUNCE_SEC, CLEAR_SEC, BEAM_SEC, BOMB_FLIGHT, BULLET_SPEED, SLOW_MAX, SLOW_FROM, SLOW_STEP,
    APPROACH, MIX, SIZE_BASE, SIZE_STEP, BOSS_GROW, BOSS_HARD, IRON_BLOB_MIN,
    newGame, starInfo, step, turretsOf, dpsOf, upCostOf, upgrade, slotCostOf, unlock, choose, swapChoicesOf, reserveSwap, progressOf, formatKakera,
    makeSave, loadSave, saveVersionOf, validateBest, simulate,
    hpMul, valMul, dmg, upCost, affOf, shapeOf, cellHp, cellHpAt, cellValue, matOf
  };
  return Object.freeze(api);
});
