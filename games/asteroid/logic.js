/*
 * ちきゅうを守れ！ほしくだき — ロジック（DOM・Date・performance・Math.random・localStorage に触れない純粋な計算だけ）
 * 契約：docs/asteroid-contract.md §3（数値）・§4（API）・§8（保存の形と検証）
 * 担当A（ロジック）だけが編集する。
 *
 * UMD: ブラウザでは window.AsteroidLogic、Node では module.exports。
 *
 * 中の作り：
 *   - 公開する関数は、受け取った state を書き換えない（毎回新しいオブジェクトを返す）。
 *     マスの配列（rock.mats・rock.hp）は、その step で変わったときだけ写す（コピーオンライト）。
 *     中では「state を書き換える」関数（stepMut など）を使い、自動プレイはそれを直接まわす（速さのため）。
 *   - 例外は外へ出さない（おかしな引数は null か { ok:false, reason }）。
 *   - 乱数は mulberry32。state.rng に 32bit の状態を持つ（2択の候補だけに使う）。
 *     星の形は (seed, 星の番号) から決まる別の乱数で作る（やり直しで同じ形）。
 *   - 契約 §4.1 の state の形に、次の欄を足している（保存しない。画面は使わなくてよい）：
 *       wait  … 'bounce'・'clear' の残りの秒
 *       back  … 'choose' を閉じたあとに戻る phase
 *       rock.bottom0 … 星の始めの「一番下のマス」の y（地球までの近さの分母）
 *       shots[] の弾には、どかん用の着地点（tc・tr：格子の座標）・強さ（dmg）などを足している
 *       burns[] には spread（となりの こおり へ広げたか）を足している
 *   - 契約に無い便利な関数（足しただけ。契約の関数は変えていない）：
 *       hpMul・valMul・dmg・upCost・affOf・shapeOf・cellHp・cellValue・matOf（テストと画面の説明用）
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
  const FIELD_W = 360, FIELD_H = 560, BARRIER_Y = 470, FIGHTER_Y = 500, CELL = 14, GRID_MAX = 24;
  const HP_BASE = 8, HP_GROWTH = 1.15, VALUE_GROWTH = 1.30, UP_GROWTH = 1.35, LEVEL_MAX = 99, SLOTS_MAX = 4;
  const CLEAR_BONUS = 0.2, ENDING_STAR = 30, STAR_MAX = 9999, STAR_CALC_MAX = 400, KAKERA_MAX = 9e15;
  const SHOTS_MAX = 120, STEP = 1 / 30;
  const SAVE_VERSION = 1, SAVE_KEY = "asteroid.save", SAVE_KEY_BAK = "asteroid.save.bak", SAVE_KEY_BEST = "asteroid.best", SAVE_KEY_HELP = "asteroid.help";

  // 契約の文に出てくる数（§3.5・§3.7・§3.8）
  const START_BOTTOM = 120;      // 星の始めの「一番下のマス」の y（上は画面の外。下の 120 単位ぶんが見えている）
  const FIGHTER_SPEED = 160;     // 単位/秒
  const BULLET_SPEED = 600;      // たま・ちらし・ほのお の弾
  const BOMB_FLIGHT = 0.6;       // どかん の山なりの秒
  const BEAM_SEC = 0.4;          // ビームの見た目の秒（当たりは撃った瞬間）
  const BOUNCE_SEC = 2, CLEAR_SEC = 1.5;
  const SLOW_FROM = 3, SLOW_STEP = 0.05, SLOW_MAX = 0.25;   // やさしくなる仕掛け
  const BURN_SPREAD_SEC = 0.5;   // 燃えはじめて 0.5 秒で となりの こおり へ広がる
  const EVOLVE_EVERY = 10, EVOLVE_TIERS = 3;               // Lv10・20・30 で形が変わる（30 で打ち止め）
  const APPROACH = { first: 120, normal: 90, boss: 140, firstStars: 3, bossEvery: 5 };
  const TRIES_MAX = 9999;

  // ---------------------------------------------------------------- 表（§3.2・§3.3・§3.4・§3.6）
  const MAT_IDS = ["rock", "iron", "ice", "gold"];        // コード 1〜4（0 は空）
  const MATS = deepFreeze([
    { id: "rock", code: 1, name: "いわ", from: 1 },
    { id: "iron", code: 2, name: "てつ", from: 3 },
    { id: "ice", code: 3, name: "こおり", from: 6 },
    { id: "gold", code: 4, name: "きん", from: 8 }
  ]);
  const MAT_HP = deepFreeze({ rock: 1, iron: 4, ice: 2, gold: 2 });
  const MAT_VALUE = deepFreeze({ rock: 1, iron: 3, ice: 2, gold: 10 });

  const WEAPONS = deepFreeze([
    { id: "shot", name: "たま", dmg: 1, rate: 0.20, good: null, aff: {}, desc: "いちばん ちかい マスへ まっすぐ うつ" },
    { id: "spread", name: "ちらし", dmg: 0.6, rate: 0.6, good: "rock", aff: { rock: 1.5, iron: 0.5 }, desc: "おうぎの かたちに 5はつ ちらす" },
    { id: "bomb", name: "どかん", dmg: 3, rate: 1.6, good: "ice", aff: { ice: 1.5 }, desc: "おちた ところの まわりを まとめて こわす" },
    { id: "bolt", name: "いなずま", dmg: 2, rate: 1.2, good: "iron", aff: { iron: 2, ice: 0.5 }, desc: "つながった おなじ マスへ つたわる" },
    { id: "beam", name: "ビーム", dmg: 1.5, rate: 2.0, good: "iron", aff: { iron: 1.5 }, desc: "たての 1れつを まとめて つらぬく" },
    { id: "fire", name: "ほのお", dmg: 1, rate: 1.0, good: "ice", aff: { ice: 3, iron: 0.5 }, desc: "もやして となりの こおりへ ひろがる" }
  ]);
  const W = {};
  for (const w of WEAPONS) W[w.id] = w;
  const W_IDS = WEAPONS.map((w) => w.id);

  // しんか（Lv 10・20・30）で変わる形。value(tier) = base + add × tier
  const EVOLVE = deepFreeze({
    shot: { key: "count", base: 1, add: 1, unit: "れん" },     // 1→2連→3連→4連
    spread: { key: "count", base: 5, add: 2, unit: "はつ" },   // 5→7→9→11 発
    bomb: { key: "radius", base: 1.5, add: 0.5, unit: "マス" }, // 半径（マス）
    bolt: { key: "chain", base: 4, add: 2, unit: "かい" },      // 連鎖の回数
    beam: { key: "width", base: 1, add: 1, unit: "マス" },      // 幅（マス）
    fire: { key: "sec", base: 3, add: 1, unit: "びょう" }       // 燃える秒
  });

  const UP_COST = deepFreeze({ shot: 8, spread: 60, bomb: 120, bolt: 120, beam: 160, fire: 100 });
  const SLOT_COST = deepFreeze([null, 300, 3000, 30000]);

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
  // mulberry32（状態を返り値で持ち回る）
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

  // ---------------------------------------------------------------- 式（§3.2・§3.3・§3.4）
  function calcN(n) { return clamp(Math.floor(isNum(n) ? n : 1), 1, STAR_CALC_MAX); }
  function hpMul(n) { return Math.pow(HP_GROWTH, calcN(n) - 1); }
  function valMul(n) { return Math.pow(VALUE_GROWTH, calcN(n) - 1); }
  function matOf(code) { return MAT_IDS[code - 1] || null; }
  function cellHp(n, mat) { return MAT_HP[mat] ? HP_BASE * hpMul(n) * MAT_HP[mat] : null; }
  function cellValue(n, mat) { return MAT_VALUE[mat] ? Math.max(1, Math.floor(MAT_VALUE[mat] * valMul(n))) : null; }
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

  // ---------------------------------------------------------------- 星（§3.2・§3.7）
  function normStar(n) {
    if (!isNum(n)) return null;
    const k = Math.floor(n);
    if (k < 1) return null;
    return Math.min(k, STAR_MAX);
  }
  function approachSecOf(n) {
    if (n % APPROACH.bossEvery === 0) return APPROACH.boss;
    if (n <= APPROACH.firstStars) return APPROACH.first;
    return APPROACH.normal;
  }
  function starInfo(n) {
    try {
      n = normStar(n);
      if (n === null) return null;
      const boss = n % APPROACH.bossEvery === 0;
      const k = Math.min(n, 40);
      const d = Math.min(GRID_MAX, Math.round(9 + (k - 1) * 0.6 + (boss ? 2 : 0)));
      const cols = d, rows = Math.max(6, Math.round(d * 0.86));
      let iron = n < 3 ? 0 : n < 10 ? 0.15 : 0.25;
      let ice = n < 6 ? 0 : 0.20;
      if (n >= 6) {
        // 星ごとに少し傾ける（平均は契約の値のまま）。0=そのまま・1=てつ多め・2=こおり多め
        const tilt = hash2(n, 0x5eed) % 3;
        if (tilt === 1) { iron += 0.08; ice -= 0.08; } else if (tilt === 2) { iron -= 0.08; ice += 0.08; }
        iron = Math.round(iron * 100) / 100; ice = Math.round(ice * 100) / 100;
      }
      const gold = n >= 8 ? 2 + (hash2(n, 0x901d) % 5) : 0;   // きん の数（2〜6 マス）
      const tag = iron === 0 && ice === 0 ? "" : iron >= ice ? "てつが おおい" : "こおりが おおい";
      return { cols, rows, approachSec: approachSecOf(n), boss, mix: { iron, ice, gold }, tag };
    } catch (e) { return null; }
  }

  // 星の形とマスを作る（seed と星の番号だけで決まる）
  function genRock(seed, n, tries) {
    const info = starInfo(n);
    const cols = info.cols, rows = info.rows, N = cols * rows;
    const rnd = makeRng(hash2(seed, n));
    // 形：楕円を、粗いマス目の値のゆらぎ（双線形補間）でごつごつさせる。三角関数を使わない（どの環境でも同じ形）
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
    if (cells.length < 4) { // 念のため（起きない）：楕円そのもの
      mats = new Array(N).fill(0);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const dx = (c - cx) / rx, dy = (r - cy) / ry;
        if (dx * dx + dy * dy <= 1) mats[r * cols + c] = 1;
      }
      cells = [];
      for (let i = 0; i < N; i++) if (mats[i]) cells.push(i);
    }
    const cnt = cells.length;
    const pick = () => cells[Math.floor(rnd() * cnt)];
    // てつ：すじ状（横向きの短い線。ときどき斜め）
    const ironWant = Math.round(cnt * info.mix.iron);
    let placed = 0, guard = 0;
    while (placed < ironWant && guard++ < 2000) {
      let i = pick();
      let c = i % cols, r = (i - c) / cols;
      const dc = rnd() < 0.5 ? -1 : 1;
      const len = 3 + Math.floor(rnd() * 5);
      for (let k = 0; k < len && placed < ironWant; k++) {
        if (c < 0 || c >= cols || r < 0 || r >= rows) break;
        const j = r * cols + c;
        if (mats[j] === 1) { mats[j] = 2; placed++; }
        c += dc;
        if (rnd() < 0.25) r += rnd() < 0.5 ? -1 : 1;
      }
    }
    // こおり：かたまり（いわ のマスから広げる）
    const iceWant = Math.round(cnt * info.mix.ice);
    placed = 0; guard = 0;
    while (placed < iceWant && guard++ < 500) {
      const start = pick();
      if (mats[start] !== 1) continue;
      const size = 4 + Math.floor(rnd() * 7);
      const q = [start];
      let got = 0;
      while (q.length && got < size && placed < iceWant) {
        const j = q.splice(Math.floor(rnd() * q.length), 1)[0];
        if (mats[j] !== 1) continue;
        mats[j] = 3; got++; placed++;
        const c = j % cols, r = (j - c) / cols;
        if (c > 0) q.push(j - 1);
        if (c < cols - 1) q.push(j + 1);
        if (r > 0) q.push(j - cols);
        if (r < rows - 1) q.push(j + cols);
      }
    }
    // きん：ごく少し
    placed = 0; guard = 0;
    while (placed < info.mix.gold && guard++ < 500) {
      const j = pick();
      if (mats[j] === 1) { mats[j] = 4; placed++; }
    }
    const hp = new Array(N).fill(0);
    let value = 0;
    for (const i of cells) {
      const m = matOf(mats[i]);
      hp[i] = cellHp(n, m);
      value += cellValue(n, m);
    }
    let maxRow = 0;
    for (const i of cells) { const r = Math.floor(i / cols); if (r > maxRow) maxRow = r; }
    const x = (FIELD_W - cols * CELL) / 2;
    const y = START_BOTTOM - (maxRow + 1) * CELL;
    const rock = { cols, rows, x, y, vy: 0, mats, hp, total: cnt, left: cnt, value, bottom0: START_BOTTOM };
    rock.vy = vyOf(n, tries);
    return rock;
  }
  function slowOf(tries) {
    return Math.min(SLOW_MAX, SLOW_STEP * Math.max(0, (tries | 0) - (SLOW_FROM - 1)));
  }
  function vyOf(n, tries) {
    return (BARRIER_Y - START_BOTTOM) / approachSecOf(n) * (1 - slowOf(tries));
  }

  // 一番大きなかたまりだけ残す（同じ大きさなら真ん中に近いマスを含むほう）。くだいたマスの番号の配列（かたまりごと）を返す
  function components(mats, cols, rows) {
    const N = cols * rows;
    const comp = new Int32Array(N).fill(-1);
    const list = [];
    const stack = [];
    for (let i = 0; i < N; i++) {
      if (!mats[i] || comp[i] >= 0) continue;
      const id = list.length, cells = [];
      comp[i] = id; stack.push(i);
      while (stack.length) {
        const j = stack.pop();
        cells.push(j);
        const c = j % cols;
        if (c > 0 && mats[j - 1] && comp[j - 1] < 0) { comp[j - 1] = id; stack.push(j - 1); }
        if (c < cols - 1 && mats[j + 1] && comp[j + 1] < 0) { comp[j + 1] = id; stack.push(j + 1); }
        if (j >= cols && mats[j - cols] && comp[j - cols] < 0) { comp[j - cols] = id; stack.push(j - cols); }
        if (j + cols < N && mats[j + cols] && comp[j + cols] < 0) { comp[j + cols] = id; stack.push(j + cols); }
      }
      list.push(cells);
    }
    return list;
  }
  function mainIndex(list, cols, rows) {
    const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
    let best = -1, bestSize = -1, bestD = Infinity;
    for (let k = 0; k < list.length; k++) {
      const cells = list[k];
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

  // ---------------------------------------------------------------- 状態
  function newSlot(id) { return { id, lv: 1 }; }
  function newGame(seed) {
    try {
      if (seed === undefined) seed = 1;
      if (!isNum(seed)) return null;
      seed = Math.floor(Math.abs(seed)) >>> 0;
      return makeState({ star: 1, kakera: 0, slots: [newSlot("shot")], offer: null, cleared: false, tries: 1, totals: { cells: 0, stars: 0, kakera: 0, chunks: 0 }, seed, rng: hash2(seed, 0x2b) });
    } catch (e) { return null; }
  }
  // 保存の中身（検証済み）から、星の最初の状態を作る
  function makeState(o) {
    const s = {
      star: o.star, phase: o.offer ? "choose" : "fly", t: isNum(o.t) ? o.t : 0, kakera: o.kakera,
      slots: o.slots.map((x) => ({ id: x.id, lv: x.lv })), offer: o.offer ? o.offer.slice() : null,
      rock: null, fighter: { x: FIELD_W / 2, y: FIGHTER_Y }, shots: [], burns: [], cd: o.slots.map(() => 0),
      tries: o.tries, cleared: o.cleared, totals: { cells: o.totals.cells, stars: o.totals.stars, kakera: o.totals.kakera, chunks: o.totals.chunks },
      seed: o.seed, rng: o.rng, wait: 0, back: "fly"
    };
    s.rock = genRock(s.seed, s.star, s.tries);
    return s;
  }
  function isState(s) {
    return isObj(s) && isNum(s.star) && isNum(s.kakera) && isNum(s.t) && Array.isArray(s.slots) && s.slots.length >= 1 &&
      isObj(s.rock) && Array.isArray(s.rock.mats) && Array.isArray(s.rock.hp) && s.rock.mats.length === s.rock.cols * s.rock.rows &&
      isObj(s.fighter) && Array.isArray(s.shots) && Array.isArray(s.burns) && Array.isArray(s.cd) && isObj(s.totals) && typeof s.phase === "string";
  }
  // step 用の写し（マスの配列は共有。書くときに own で写す）
  function cloneForStep(s) {
    const c = Object.assign({}, s);
    c.rock = Object.assign({}, s.rock);
    c.fighter = Object.assign({}, s.fighter);
    c.shots = s.shots.map((x) => Object.assign({}, x));
    c.burns = s.burns.map((x) => Object.assign({}, x));
    c.cd = s.cd.slice();
    while (c.cd.length < c.slots.length) c.cd.push(0);
    c.totals = Object.assign({}, s.totals);
    c.slots = s.slots.map((x) => ({ id: x.id, lv: x.lv }));
    c.offer = s.offer ? s.offer.slice() : null;
    if (!isNum(c.wait)) c.wait = 0;
    if (typeof c.back !== "string") c.back = "fly";
    return c;
  }
  // コピーオンライト：公開の step の間だけ、最初の書き込みで配列を写す
  let SIM = false, OWNED = null;
  function own(s) {
    if (SIM || OWNED === s.rock.mats) return;
    s.rock.mats = s.rock.mats.slice();
    s.rock.hp = s.rock.hp.slice();
    OWNED = s.rock.mats;
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

  // 戦闘機に一番近いマス（同じ距離なら左）。matCode を指定するとその種類だけ
  function nearest(rock, fx, fy, matCode) {
    const { cols, mats } = rock;
    let best = -1, bd = Infinity, bx = Infinity;
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (!m || (matCode && m !== matCode)) continue;
      const x = rock.x + ((i % cols) + 0.5) * CELL, y = rock.y + (Math.floor(i / cols) + 0.5) * CELL;
      const d = (x - fx) * (x - fx) + (y - fy) * (y - fy);
      if (d < bd || (d === bd && x < bx)) { bd = d; best = i; bx = x; }
    }
    return best;
  }
  // マスが一番多い 3×3 の真ん中（同じなら戦闘機に近いほう）
  function densest(rock, fx, fy) {
    const { cols, rows, mats } = rock;
    let best = -1, bn = -1, bd = Infinity;
    for (let i = 0; i < mats.length; i++) {
      if (!mats[i]) continue;
      const c = i % cols, r = (i - c) / cols;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc, rr = r + dr;
        if (cc >= 0 && cc < cols && rr >= 0 && rr < rows && mats[rr * cols + cc]) n++;
      }
      const x = rock.x + (c + 0.5) * CELL, y = rock.y + (r + 0.5) * CELL;
      const d = (x - fx) * (x - fx) + (y - fy) * (y - fy);
      if (n > bn || (n === bn && d < bd)) { bn = n; bd = d; best = i; }
    }
    return best;
  }
  // マスが一番多い列（幅 w 列のまとまり）の左端の列。同じなら戦闘機に近いほう
  function bestColumns(rock, w, fx) {
    const { cols, rows, mats } = rock;
    w = Math.min(w, cols);
    const per = new Array(cols).fill(0);
    for (let i = 0; i < mats.length; i++) if (mats[i]) per[i % cols]++;
    let best = -1, bn = 0, bd = Infinity;
    for (let c0 = 0; c0 + w <= cols; c0++) {
      let n = 0;
      for (let k = 0; k < w; k++) n += per[c0 + k];
      const x = rock.x + (c0 + w / 2) * CELL;
      const d = Math.abs(x - fx);
      if (n > bn || (n === bn && n > 0 && d < bd)) { bn = n; bd = d; best = c0; }
    }
    return best;
  }

  // マスに強さを与える。欠けたら break と かけら
  function hurt(s, i, amount, w, ctx, quiet) {
    const rock = s.rock;
    const code = rock.mats[i];
    if (!code) return false;
    const mat = matOf(code);
    own(s);
    const R = s.rock;
    R.hp[i] -= amount * affOf(w, mat);
    if (R.hp[i] <= 1e-9) {
      const v = cellValue(s.star, mat);
      R.hp[i] = 0; R.mats[i] = 0; R.left--;
      s.kakera = capK(s.kakera + v);
      s.totals.cells++; s.totals.kakera = capK(s.totals.kakera + v);
      ctx.broke = true;
      ctx.evs.push({ kind: "break", i, mat, value: v });
      return true;
    }
    if (!quiet) {
      let crack = 0;
      if (MAT_HP[mat] > 1) crack = clamp(Math.floor(4 * (1 - R.hp[i] / cellHp(s.star, mat))), 0, 3);
      ctx.evs.push({ kind: "hit", i, w, mat, crack });
    }
    return false;
  }
  function ignite(s, i, ctx) {
    const lv = slotLv(s, "fire");
    const until = s.t + shapeOf("fire", lv);
    for (const b of s.burns) if (b.i === i) { if (b.until < until) b.until = until; return; }
    s.burns.push({ i, until, at: s.t, spread: false });
    ctx.evs.push({ kind: "burn", i });
  }
  function slotLv(s, id) { for (const x of s.slots) if (x.id === id) return x.lv; return 1; }

  function cellAt(rock, x, y) {
    const c = Math.floor((x - rock.x) / CELL), r = Math.floor((y - rock.y) / CELL);
    if (c < 0 || c >= rock.cols || r < 0 || r >= rock.rows) return -1;
    const i = r * rock.cols + c;
    return rock.mats[i] ? i : -1;
  }

  // ---------------------------------------------------------------- 撃つ（§3.3・§3.8）
  function fireWeapon(s, k, ctx) {
    const slot = s.slots[k];
    const w = slot.id, L = slot.lv, rock = s.rock;
    const fx = s.fighter.x, fy = s.fighter.y - 10;
    const d = dmg(w, L);
    const room = () => s.shots.length < SHOTS_MAX;
    if (w === "shot" || w === "spread" || w === "fire") {
      const tgt = nearest(rock, fx, fy, 0);
      if (tgt < 0) return;
      const tx = cellX(rock, tgt), ty = cellY(rock, tgt);
      const ang = Math.atan2(ty - fy, tx - fx);
      ctx.evs.push({ kind: "fire", w, x: fx, y: fy, tx, ty });
      if (w === "spread") {
        const n = shapeOf(w, L);
        const fan = (8 + 2 * (n - 5) / 2) * Math.PI / 180;   // となりの弾との角度（5発で 8°、7発で 10°…）
        const per = d;
        for (let j = 0; j < n && room(); j++) {
          const a = ang + (j - (n - 1) / 2) * fan / (1 + (n - 5) / 4);
          s.shots.push({ w, x: fx, y: fy, vx: Math.cos(a) * BULLET_SPEED, vy: Math.sin(a) * BULLET_SPEED, t: 0, dmg: per });
        }
      } else if (w === "shot") {
        const n = shapeOf(w, L);
        for (let j = 0; j < n && room(); j++) {
          const off = (j - (n - 1) / 2) * 6;
          s.shots.push({ w, x: fx + off, y: fy, vx: Math.cos(ang) * BULLET_SPEED, vy: Math.sin(ang) * BULLET_SPEED, t: 0, dmg: d });
        }
      } else if (room()) {
        s.shots.push({ w, x: fx, y: fy, vx: Math.cos(ang) * BULLET_SPEED, vy: Math.sin(ang) * BULLET_SPEED, t: 0, dmg: d });
      }
    } else if (w === "bomb") {
      const tgt = densest(rock, fx, fy);
      if (tgt < 0 || !room()) return;
      const tc = (tgt % rock.cols) + 0.5, tr = Math.floor(tgt / rock.cols) + 0.5;
      const tx = rock.x + tc * CELL, ty = rock.y + tr * CELL;
      ctx.evs.push({ kind: "fire", w, x: fx, y: fy, tx, ty });
      s.shots.push({ w, x: fx, y: fy, vx: (tx - fx) / BOMB_FLIGHT, vy: (ty - fy) / BOMB_FLIGHT, t: 0, dmg: d, sx: fx, sy: fy, tc, tr, r: shapeOf(w, L) });
    } else if (w === "bolt") {
      let tgt = nearest(rock, fx, fy, 2);
      if (tgt < 0) tgt = nearest(rock, fx, fy, 0);
      if (tgt < 0) return;
      const tx = cellX(rock, tgt), ty = cellY(rock, tgt);
      ctx.evs.push({ kind: "fire", w, x: fx, y: fy, tx, ty });
      const path = chainPath(rock, tgt, shapeOf(w, L));
      ctx.evs.push({ kind: "bolt", path });
      for (const i of path) hurt(s, i, d, w, ctx);
    } else if (w === "beam") {
      const width = shapeOf(w, L);
      const c0 = bestColumns(rock, width, fx);
      if (c0 < 0) return;
      const wcols = Math.min(width, rock.cols);
      const x = rock.x + (c0 + wcols / 2) * CELL;
      ctx.evs.push({ kind: "fire", w, x: fx, y: fy, tx: x, ty: rock.y });
      ctx.evs.push({ kind: "beam", x, w: wcols * CELL });
      for (let r = rock.rows - 1; r >= 0; r--) for (let c = c0; c < c0 + wcols; c++) {
        const i = r * rock.cols + c;
        if (s.rock.mats[i]) hurt(s, i, d, w, ctx);
      }
    }
  }
  // いなずま：当たったマスから、つながっている同じ種類のマスへ（近い順＝幅優先）。最初のマス＋chain 個まで
  function chainPath(rock, start, chain) {
    const { cols, mats } = rock;
    const m = mats[start];
    const path = [start], seen = new Set([start]);
    let head = 0;
    while (head < path.length && path.length < 1 + chain) {
      const j = path[head++];
      const c = j % cols;
      const nb = [];
      if (j + cols < mats.length) nb.push(j + cols);
      if (c > 0) nb.push(j - 1);
      if (c < cols - 1) nb.push(j + 1);
      if (j >= cols) nb.push(j - cols);
      for (const q of nb) {
        if (path.length >= 1 + chain) break;
        if (!seen.has(q) && mats[q] === m) { seen.add(q); path.push(q); }
      }
    }
    return path;
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
        if (s.phase === "bounce") restartStar(s);
        else nextStar(s, evs);
      }
      return;
    }
    if (s.phase !== "fly") { s.phase = "fly"; }
    const rock = s.rock;
    // 1. 小惑星が降りる
    rock.y += rock.vy * dt;
    // 2. 戦闘機が動く（ねらうマスの真下へ）
    const aim = nearest(rock, s.fighter.x, s.fighter.y, 0);
    if (aim >= 0) {
      const tx = clamp(cellX(rock, aim), 16, FIELD_W - 16);
      const dx = tx - s.fighter.x, mv = FIGHTER_SPEED * dt;
      s.fighter.x = Math.abs(dx) <= mv ? tx : s.fighter.x + Math.sign(dx) * mv;
    }
    // 3. 武器が撃つ
    for (let k = 0; k < s.slots.length; k++) {
      if (!(s.t + 1e-9 >= s.cd[k])) continue;
      if (s.rock.left <= 0) break;
      fireWeapon(s, k, ctx);
      const rate = W[s.slots[k].id].rate;
      s.cd[k] = s.cd[k] + rate > s.t ? s.cd[k] + rate : s.t + rate;
    }
    // 4. 弾が飛んで当たる
    if (s.shots.length) {
      const keep = [];
      for (const b of s.shots) {
        b.t += dt;
        if (b.w === "bomb") {
          const R = s.rock;
          const tx = R.x + b.tc * CELL, ty = R.y + b.tr * CELL;
          const f = Math.min(1, b.t / BOMB_FLIGHT);
          b.x = b.sx + (tx - b.sx) * f;
          b.y = b.sy + (ty - b.sy) * f - Math.sin(Math.PI * f) * 60;
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
        const dist = Math.hypot(b.vx, b.vy) * dt;
        const n = Math.max(1, Math.ceil(dist / 5));
        let hit = -1;
        for (let k = 0; k < n; k++) {
          b.x += b.vx * dt / n; b.y += b.vy * dt / n;
          hit = cellAt(s.rock, b.x, b.y);
          if (hit >= 0) break;
        }
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
        if (!broke && s.t < b.until) keep.push(b);
      }
      s.burns = keep;
      for (const q of add) if (s.rock.mats[q]) ignite(s, q, ctx);
    }
    // 6. かけらは hurt の中で足し済み。7. はなれたかたまり
    if (ctx.broke && s.rock.left > 0) breakLoose(s, ctx);
    // 8. クリア／とどいた
    if (s.rock.left <= 0) {
      const bonus = Math.floor(s.rock.value * CLEAR_BONUS);
      s.kakera = capK(s.kakera + bonus);
      s.totals.kakera = capK(s.totals.kakera + bonus);
      s.totals.stars++;
      s.phase = "clear"; s.wait = CLEAR_SEC; s.shots = []; s.burns = [];
      evs.push({ kind: "clear", star: s.star, bonus });
    } else if (bottomY(s.rock) >= BARRIER_Y - 1e-9) {
      const broken = progressS(s).broken;
      s.phase = "bounce"; s.wait = BOUNCE_SEC; s.shots = []; s.burns = [];
      s.tries = Math.min(TRIES_MAX, s.tries + 1);
      evs.push({ kind: "bounce", broken });
    }
  }
  function breakLoose(s, ctx) {
    const R = s.rock;
    const list = components(R.mats, R.cols, R.rows);
    if (list.length <= 1) return;
    const m = mainIndex(list, R.cols, R.rows);
    own(s);
    const R2 = s.rock;
    for (let k = 0; k < list.length; k++) {
      if (k === m) continue;
      let v = 0;
      for (const j of list[k]) { v += cellValue(s.star, matOf(R2.mats[j])); R2.mats[j] = 0; R2.hp[j] = 0; }
      R2.left -= list[k].length;
      s.kakera = capK(s.kakera + v);
      s.totals.cells += list[k].length; s.totals.kakera = capK(s.totals.kakera + v); s.totals.chunks++;
      ctx.evs.push({ kind: "chunk", cells: list[k].slice(), value: v });
    }
  }
  function restartStar(s) {
    s.rock = genRock(s.seed, s.star, s.tries);
    s.shots = []; s.burns = [];
    s.phase = "fly";
    s.cd = s.slots.map(() => s.t);
  }
  function nextStar(s, evs) {
    const was = s.star;
    s.star = Math.min(STAR_MAX, s.star + 1);
    s.tries = 1;
    s.rock = genRock(s.seed, s.star, 1);
    s.shots = []; s.burns = [];
    s.cd = s.slots.map(() => s.t);
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
      OWNED = null;
      stepMut(s, dt, events);
      OWNED = null;
      return { state: s, events };
    } catch (e) { OWNED = null; return null; }
  }

  // ---------------------------------------------------------------- 画面用の値
  function nominalHits(w, L) {
    const v = shapeOf(w, L);
    if (w === "shot") return v;
    if (w === "spread") return v * 0.7;
    if (w === "bomb") { let n = 0; const r = Math.ceil(v); for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (a * a + b * b <= v * v + 1e-9) n++; return n * 0.7; }
    if (w === "bolt") return 1 + v;
    if (w === "beam") return v * 8;
    if (w === "fire") return v;   // 1 回つけると v 秒燃える
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
  function upCostOf(state, slot) {
    try {
      if (!isObj(state) || !Array.isArray(state.slots)) return null;
      const x = state.slots[slot];
      if (!x || !W[x.id]) return null;
      return upCost(x.id, x.lv);
    } catch (e) { return null; }
  }
  function slotCostOf(state) {
    try {
      if (!isObj(state) || !Array.isArray(state.slots)) return null;
      const n = state.slots.length;
      return n >= 1 && n < SLOTS_MAX ? SLOT_COST[n] : null;
    } catch (e) { return null; }
  }
  function progressS(s) {
    const R = s.rock;
    const total = R.total, left = R.left;
    const broken = total > 0 ? clamp(1 - left / total, 0, 1) : 0;
    const by = bottomY(R);
    const b0 = isNum(R.bottom0) ? R.bottom0 : START_BOTTOM;
    const distance = by === -Infinity ? 1 : clamp((BARRIER_Y - by) / (BARRIER_Y - b0), 0, 1);
    return { broken, left, total, distance };
  }
  function progressOf(state) {
    try { return isState(state) ? progressS(state) : null; } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- 買う・開ける・選ぶ（§3.4・§3.6）
  function shallow(s) {
    const c = Object.assign({}, s);
    c.slots = s.slots.map((x) => ({ id: x.id, lv: x.lv }));
    c.cd = s.cd.slice();
    c.totals = Object.assign({}, s.totals);
    c.offer = s.offer ? s.offer.slice() : null;
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
  function makeOffer(s) {
    const have = new Set(s.slots.map((x) => x.id));
    const pool = W_IDS.filter((id) => !have.has(id));
    if (pool.length < 2) return null;
    const a = pool[Math.floor(rngOf(s) * pool.length)];
    let rest = pool.filter((id) => id !== a && W[id].good !== W[a].good);
    if (!rest.length) rest = pool.filter((id) => id !== a);
    const b = rest[Math.floor(rngOf(s) * rest.length)];
    return [a, b];
  }
  function unlockMut(s) {
    if (s.phase === "choose" || s.offer) return "choose";
    const cost = slotCostOf(s);
    if (cost === null) return "max";
    if (s.kakera < cost) return "money";
    const offer = makeOffer(s);
    if (!offer) return "max";
    s.kakera = capK(s.kakera - cost);
    s.offer = offer;
    s.back = s.phase;
    s.phase = "choose";
    return null;
  }
  function unlock(state) {
    try {
      if (!isState(state)) return { state, ok: false, reason: "state" };
      const s = shallow(state);
      const why = unlockMut(s);
      if (why) return { state, ok: false, reason: why };
      return { state: s, ok: true };
    } catch (e) { return { state, ok: false, reason: "error" }; }
  }
  function chooseMut(s, k) {
    if (s.phase !== "choose" || !s.offer || (k !== 0 && k !== 1)) return false;
    const id = s.offer[k];
    if (!W[id] || s.slots.some((x) => x.id === id) || s.slots.length >= SLOTS_MAX) return false;
    s.slots.push(newSlot(id));
    s.cd.push(s.t);
    s.offer = null;
    s.phase = ["fly", "bounce", "clear", "end"].includes(s.back) ? s.back : "fly";
    s.back = "fly";
    return true;
  }
  function choose(state, k) {
    try {
      if (!isState(state)) return { state, ok: false };
      const s = shallow(state);
      if (!chooseMut(s, k)) return { state, ok: false };
      return { state: s, ok: true };
    } catch (e) { return { state, ok: false }; }
  }

  // ---------------------------------------------------------------- かけらの書き方（§1.3）
  function formatKakera(n) {
    try {
      if (!isNum(n) || n < 0) n = 0;
      n = Math.floor(Math.min(n, KAKERA_MAX));
      if (n < 10000) return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      const units = [[1e12, "ちょう"], [1e8, "おく"], [1e4, "まん"]];
      for (const [u, name] of units) {
        if (n >= u) {
          const tenths = Math.floor(n / (u / 10));          // 0.1 単位で切り捨て
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
  function makeSave(state) {
    try {
      if (!isState(state)) return null;
      return JSON.stringify({
        v: SAVE_VERSION, star: state.star, kakera: state.kakera, slots: state.slots.map((x) => ({ id: x.id, lv: x.lv })),
        offer: state.offer ? state.offer.slice() : null, cleared: !!state.cleared, tries: state.tries,
        totals: { cells: state.totals.cells, stars: state.totals.stars, kakera: state.totals.kakera, chunks: state.totals.chunks },
        seed: state.seed, rng: state.rng
      });
    } catch (e) { return null; }
  }
  const intIn = (x, lo, hi, def) => (isNum(x) ? clamp(Math.floor(x), lo, hi) : def);
  function loadSave(raw) {
    try {
      let o = raw;
      if (typeof raw === "string") o = JSON.parse(raw);
      if (!isObj(o) || typeof o.v !== "number") return null;
      if (o.v !== SAVE_VERSION) return null;
      const star = intIn(o.star, 1, STAR_MAX, 1);
      const kakera = intIn(o.kakera, 0, KAKERA_MAX, 0);
      // 武器：[0] は shot。重複は後ろを捨てる・知らない id は捨てる・lv は 1〜99
      const slots = [];
      const seen = new Set();
      let shotLv = 1;
      const arr = Array.isArray(o.slots) ? o.slots : [];
      for (const x of arr) {
        if (!isObj(x) || typeof x.id !== "string" || !W[x.id] || seen.has(x.id)) continue;
        seen.add(x.id);
        const lv = intIn(x.lv, 1, LEVEL_MAX, 1);
        if (x.id === "shot") shotLv = lv; else slots.push({ id: x.id, lv });
      }
      slots.unshift({ id: "shot", lv: shotLv });
      slots.length = Math.min(slots.length, SLOTS_MAX);
      const seed = isNum(o.seed) ? Math.floor(Math.abs(o.seed)) >>> 0 : 1;
      const rng = isNum(o.rng) ? Math.floor(Math.abs(o.rng)) >>> 0 : hash2(seed, 0x2b);
      const tries = intIn(o.tries, 1, TRIES_MAX, 1);
      const tt = isObj(o.totals) ? o.totals : {};
      const totals = { cells: intIn(tt.cells, 0, KAKERA_MAX, 0), stars: intIn(tt.stars, 0, KAKERA_MAX, 0), kakera: intIn(tt.kakera, 0, KAKERA_MAX, 0), chunks: intIn(tt.chunks, 0, KAKERA_MAX, 0) };
      let cleared = o.cleared === true;
      if (star > ENDING_STAR) cleared = true;
      const base = { star, kakera, slots, offer: null, cleared, tries, totals, seed, rng };
      // 2択：持っていない知っている武器 2 つ（違うもの）なら残す。壊れていれば（払い済みなので）同じ値段のまま作り直す
      if (o.offer !== null && o.offer !== undefined && slots.length < SLOTS_MAX) {
        const f = o.offer;
        const okOffer = Array.isArray(f) && f.length === 2 && f.every((id) => typeof id === "string" && W[id] && !seen.has(id)) && f[0] !== f[1];
        if (okOffer) base.offer = [f[0], f[1]];
        else base.offer = makeOffer(base);
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
  // ある武器・Lv の、その星での「効く強さ」（相性を星の混ざり方で平均）
  function mixOf(n) {
    const m = starInfo(n).mix;
    return { rock: Math.max(0, 1 - m.iron - m.ice), iron: m.iron, ice: m.ice };
  }
  function fitOf(w, mix) { let a = 0; for (const k in mix) a += mix[k] * affOf(w, k); return a; }
  function effDps(w, L, mix) { return dpsRaw(w, L) * fitOf(w, mix); }
  function aheadMix(n) {   // これから先の 10 星の平均の混ざり方
    const m = { rock: 0, iron: 0, ice: 0 };
    for (let k = 1; k <= 10; k++) { const x = mixOf(Math.min(STAR_MAX, n + k)); m.rock += x.rock / 10; m.iron += x.iron / 10; m.ice += x.ice / 10; }
    return m;
  }
  function greedyBuy(s) {
    const mix = mixOf(s.star);
    const sc = slotCostOf(s);
    if (sc !== null && s.phase !== "choose") {
      if (s.kakera >= sc) { unlockMut(s); return "unlock"; }
      if (s.kakera >= sc * 0.5) return null;   // 半分たまったら、枠のためにためる
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
  function pickChoice(s, policy, simRnd) {
    const [a, b] = s.offer;
    if (policy === "random") return simRnd() < 0.5 ? 0 : 1;
    if (policy === "worst") {
      const m = aheadMix(s.star);
      return fitOf(a, m) <= fitOf(b, m) ? 0 : 1;
    }
    const m = mixOf(s.star);
    const fa = fitOf(a, m), fb = fitOf(b, m);
    if (fa !== fb) return fa > fb ? 0 : 1;
    const am = aheadMix(s.star);
    return fitOf(a, am) >= fitOf(b, am) ? 0 : 1;
  }
  function simulate(policy, opts) {
    const pol = ["greedy", "random", "worst", "idle"].includes(policy) ? policy : "greedy";
    opts = isObj(opts) ? opts : {};
    const maxStar = isNum(opts.maxStar) ? Math.floor(opts.maxStar) : ENDING_STAR;
    const maxSec = isNum(opts.maxSec) ? opts.maxSec : 6 * 3600;
    const seed = isNum(opts.seed) ? opts.seed : 1;
    const buyEvery = isNum(opts.buyEvery) && opts.buyEvery >= 1 ? Math.floor(opts.buyEvery) : 1;   // 何秒ごとに買い物を考えるか（人らしさ）
    const rep = {
      policy: pol, seed, buyEvery: 1, stars: [], firstBuySec: null, buys: 0, buyGaps: { avg: null, max: 0 }, endSec: null,
      kakeraMax: 0, shotsMax: 0, particlesMax: 0, bounces: [], picks: [], kakeraAtBounce: [], t: 0, error: null, final: null
    };
    rep.buyEvery = buyEvery;
    const wasSim = SIM;
    SIM = true;
    try {
      const s = newGame(seed);
      const simRnd = makeRng(hash2(seed >>> 0, 0x51a1));
      const evs = [];
      let starStart = 0, tryStart = 0, starBuys = 0, lastBuy = 0, nextBuy = 1;
      let leftRatio = 1, lastPhase = s.phase;
      const win = [];   // 粒の目安：欠けたマス 1 つで 3 粒、0.9 秒（飛び散り 0.3＋吸い込まれ 0.6）残る
      let partNow = 0;
      while (s.t < maxSec) {
        if (s.phase === "choose") {
          const k = pickChoice(s, pol, simRnd);
          rep.picks.push({ star: s.star, offer: s.offer.slice(), pick: s.offer[k] });
          chooseMut(s, k);
        }
        if (s.phase === "end") s.phase = "fly";   // 「このまま あそぶ」
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
        stepMut(s, STEP, evs);
        let born = 0;
        for (const e of evs) {
          if (e.kind === "break") born += 3;
          else if (e.kind === "chunk") born += e.cells.length * 3;
          else if (e.kind === "clear") {
            rep.stars.push({ star: e.star, boss: e.star % APPROACH.bossEvery === 0, sec: +(s.t - starStart).toFixed(2), clearSec: +(s.t - tryStart).toFixed(2),
              tries: s.tries, leftRatio: +leftRatio.toFixed(3), buys: starBuys, kakera: s.kakera });
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
          // クリア時の残り時間の割合＝残りの道のり／星の始めの道のり（clear の step では直前の値が残る）
          leftRatio = clamp((BARRIER_Y - bottomY(s.rock)) / (BARRIER_Y - START_BOTTOM), 0, 1);
          if (lastPhase === "clear" || lastPhase === "end") { starStart = s.t; tryStart = s.t; starBuys = 0; }
          else if (lastPhase === "bounce") tryStart = s.t;
        }
        lastPhase = s.phase;
        if (rep.endSec !== null && s.totals.stars >= maxStar) break;
      }
      rep.t = s.t;
      rep.buyGaps.avg = rep.buys ? +(s.t / rep.buys).toFixed(2) : null;
      rep.final = { star: s.star, kakera: s.kakera, slots: s.slots.map((x) => ({ id: x.id, lv: x.lv })), tries: s.tries, totals: Object.assign({}, s.totals), cleared: s.cleared, phase: s.phase };
    } catch (e) {
      rep.error = String(e && e.stack || e);
    } finally {
      SIM = wasSim;
    }
    return rep;
  }

  const api = {
    NAME, MATS, WEAPONS, EVOLVE, MAT_HP, MAT_VALUE, UP_COST, SLOT_COST,
    FIELD_W, FIELD_H, BARRIER_Y, FIGHTER_Y, CELL, GRID_MAX,
    HP_BASE, HP_GROWTH, VALUE_GROWTH, UP_GROWTH, LEVEL_MAX, SLOTS_MAX,
    CLEAR_BONUS, ENDING_STAR, STAR_MAX, STAR_CALC_MAX, KAKERA_MAX, SHOTS_MAX, STEP,
    SAVE_VERSION, SAVE_KEY, SAVE_KEY_BAK, SAVE_KEY_BEST, SAVE_KEY_HELP,
    START_BOTTOM, BOUNCE_SEC, CLEAR_SEC, BEAM_SEC, BOMB_FLIGHT, BULLET_SPEED, FIGHTER_SPEED, SLOW_MAX,
    newGame, starInfo, step, dpsOf, upCostOf, upgrade, slotCostOf, unlock, choose, progressOf, formatKakera,
    makeSave, loadSave, validateBest, simulate,
    hpMul, valMul, dmg, upCost, affOf, shapeOf, cellHp, cellValue, matOf
  };
  return Object.freeze(api);
});
