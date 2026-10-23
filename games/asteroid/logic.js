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
 *       ms    … その星でもらった区切り（25・50・75。§18.1 B。保存する）
 *       bestT … 星ごとのベスト時間 { 星: 秒 }（§18.1 C。保存する）
 *       tryAt … いまの挑戦が始まった t（clear の time の元。保存は mid.tt）
 *       rock.rowHp … 行ごとの体力の倍率（もろい底 SOFT。満タンの体力は cellHpAt）
 *   - 契約に無い便利な関数（足しただけ。契約の関数は変えていない）：
 *       hpMul・valMul・dmg・upCost・affOf・shapeOf・cellHp・cellValue・matOf（テストと画面の説明用）
 *   - upgrade の返り値に events（Lv10・20… に届いたら [{ kind:'evolve', slot, lv }]）を足している。
 *   - 保存（§8.2）に「星の途中」mid { y, mats, hp } を足している（§17.1 で測って決めた。1 つの星が 3〜5 分あるため）。
 *     makeSave が自動で入れ、loadSave が検証して戻す（main は欄を足す必要なし）。クリアの演出中（phase 'clear'）の保存は次の星。
 *   - 数値の定数（APPROACH・MIX・EARLY_HP・HP_GROWTH2 など）も公開している（テストが式を確かめる用。画面は使わなくてよい）。
 *   - simulate の opts に reopenEvery・reopenMid（閉じて開き直す人）と pickOrder（2択の選び方を決める）を足している（測る用）。
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
  const FIELD_W = 360, FIELD_H = 560, BARRIER_Y = 470, FIGHTER_Y = 500, CELL = 14, GRID_MAX = 24;
  const HP_BASE = 600, HP_GROWTH = 1.252, VALUE_GROWTH = 2.35, UP_GROWTH = 1.35, LEVEL_MAX = 99, SLOTS_MAX = 4;
  // エンディング（星 ENDING_STAR）より先の増え方（§17.1「星 100 まで詰まらない」。Lv の上限 99 に早く届かないよう、ゆるめる）
  const HP_GROWTH2 = 1.0, VALUE_GROWTH2 = 1.03;
  // 最初の星だけ、マスの体力をこの倍にする（星 1〜6。はじめての人がすぐ1つクリアできる。§17.1「最初の 3 星は 1.5〜3 分」。
  // 星 4 から少しずつ 1 倍へ。武器が 1〜2 つの間は強くなる速さが遅いので、ゆるやかにつなぐ）
  const EARLY_HP = deepFreeze([0.022, 0.056, 0.08, 0.27, 0.35, 0.39, 0.58, 0.82, 0.9]);
  // マスの混ざり方（§3.2）：てつ（星 3〜9・10〜）、こおり（星 6〜）、星ごとの傾き（てつ多め／こおり多め）
  const MIX = deepFreeze({ iron: [0.25, 0.35], ice: 0.15, tilt: 0.08 });
  const SIZE_STEP = 0.48;   // 星ごとに直径が増えるマスの数（星 30 ごろに 24 マス）
  const BOSS_GROW = 2, BOSS_HARD = 1.3;   // 大きな星：格子を 2 マス大きく、重さ（マスの数×体力）はふつうの星の 1.3 倍くらい
  const MILESTONE_BONUS = 0.03, MILESTONES = deepFreeze([25, 50, 75]);   // 壊した割合 25・50・75% のおまけ（§18.1 B。星ごとに各 1 回）
  const BEST_MAX = 200;   // 星ごとのベスト時間 bestT を残す数（§18.1 C。新しい星を残す）
  const CLEAR_BONUS = 0.2, ENDING_STAR = 30, STAR_MAX = 9999, STAR_CALC_MAX = 400, KAKERA_MAX = 9e15;
  const SHOTS_MAX = 120, STEP = 1 / 30;
  const SAVE_VERSION = 1, SAVE_KEY = "asteroid.save", SAVE_KEY_BAK = "asteroid.save.bak", SAVE_KEY_BEST = "asteroid.best", SAVE_KEY_HELP = "asteroid.help";

  // 契約の文に出てくる数（§3.5・§3.7・§3.8）
  const START_BOTTOM = 120;      // 星の始めの「一番下のマス」の y（上は画面の外。下の 120 単位ぶんが見えている）
  const FIGHTER_SPEED = 160;     // 単位/秒
  const BULLET_SPEED = 600;      // たま・ちらし・ほのお の弾
  const BOMB_FLIGHT = 0.6;       // どかん の山なりの秒
  const BEAM_SEC = 0.4;          // ビームの見た目の秒（当たりは撃った瞬間）
  const BEAM_DEPTH = 10;         // ビームが 1 列で貫くマスの数（下から。大きな星で強くなりすぎないよう）
  const BOUNCE_SEC = 2, CLEAR_SEC = 1.5;
  const SLOW_FROM = 2, SLOW_STEP = 0.1, SLOW_MAX = 0.25;    // やさしくなる仕掛け（2 回目から 10% ずつ、最大 25%。1 つの星が長いので早めにやさしく）
  const BURN_SPREAD_SEC = 0.5;   // 燃えはじめて 0.5 秒で となりの こおり へ広がる
  const EVOLVE_EVERY = 10, EVOLVE_TIERS = 3;               // Lv10・20・30 で形が変わる（30 で打ち止め）
  // 近づく速さ（§3.7・§17.1）：その星を「ふつうに買う人」がクリアする目安の秒（first・normal・boss）から、
  // クリアのときに道のりが keep だけ残るように決める。小惑星は下から削れて押し返されるので、背の高い星ほど速く降りる：
  //   approachSec(n) = 目安の秒 ÷ (keep + 星の高さ ÷ 道のり)   （10 秒単位に丸める）
  const APPROACH = deepFreeze({ first: 135, normal: 240, boss: 300, keep: 0.33, firstStars: 3, bossEvery: 5 });
  const TRIES_MAX = 9999;
  // もろい底（§18.1 B「どの星も最初の 30 秒で 15% 以上欠ける」）：星の下の方のマス（下から数えたマスの割合 q まで）は体力を mul 倍、
  // そこから ramp の間で 1 倍へ。星の重さ（体力 × 硬さの合計）は変えない（残りを少しかたくする）＝1 つの星の時間はほぼそのまま
  const SOFT = deepFreeze({ q: 0.2, mul: 0.05, ramp: 0.15 });

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
    { id: "spread", name: "ちらし", dmg: 1, rate: 0.6, good: "rock", aff: { rock: 2, iron: 0.9 }, desc: "おうぎの かたちに 5はつ ちらす" },
    { id: "bomb", name: "どかん", dmg: 3, rate: 1.6, good: "ice", aff: { ice: 2 }, desc: "おちた ところの まわりを まとめて こわす" },
    { id: "bolt", name: "いなずま", dmg: 3, rate: 1.2, good: "iron", aff: { iron: 2.2, ice: 0.5 }, desc: "つながった おなじ マスへ つたわる" },
    { id: "beam", name: "ビーム", dmg: 1.5, rate: 2.0, good: "iron", aff: { iron: 1.8 }, desc: "たての 1れつを まとめて つらぬく" },
    { id: "fire", name: "ほのお", dmg: 3, rate: 1.0, good: "ice", aff: { ice: 3, iron: 0.75 }, desc: "もやして となりの こおりへ ひろがる" }
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

  const UP_COST = deepFreeze({ shot: 5, spread: 5, bomb: 34, bolt: 5, beam: 8, fire: 4 });
  const SLOT_COST = deepFreeze([null, 40, 300, 2000]);

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
  // 星 ENDING_STAR までは HP_GROWTH・VALUE_GROWTH、そこから先は HP_GROWTH2・VALUE_GROWTH2 で増える
  function growMul(n, g1, g2) {
    const k = calcN(n);
    return k <= ENDING_STAR ? Math.pow(g1, k - 1) : Math.pow(g1, ENDING_STAR - 1) * Math.pow(g2, k - ENDING_STAR);
  }
  // 体力の倍率：増え方 × 最初の星のやさしさ × 大きさのならし・大きな星の重さ（dimsOf の adj）
  function hpMul(n) {
    const k = calcN(n);
    const star = isNum(n) && n >= 1 ? Math.min(Math.floor(n), STAR_MAX) : 1;
    return growMul(n, HP_GROWTH, HP_GROWTH2) * (k <= EARLY_HP.length ? EARLY_HP[k - 1] : 1) * dimsOf(star).adj;
  }
  function valMul(n) {
    const star = isNum(n) && n >= 1 ? Math.min(Math.floor(n), STAR_MAX) : 1;
    return growMul(n, VALUE_GROWTH, VALUE_GROWTH2) * dimsOf(star).adj;
  }
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
  function dimsOf(n) {
    const boss = n % APPROACH.bossEvery === 0;
    const k = Math.min(n, 40);
    const smooth = Math.min(GRID_MAX, 10 + (k - 1) * SIZE_STEP);   // 丸める前の直径（星ごとになめらか）
    const base = Math.min(GRID_MAX, Math.round(smooth));
    const d = Math.min(GRID_MAX, base + (boss ? BOSS_GROW : 0));
    const rows = Math.max(6, Math.round(d * 0.86));
    // 格子の大きさは整数で段になるので、マス1つの体力とかけらを「なめらかな大きさ ÷ 実際の大きさ」倍して、星ごとの重さ・かけらの合計をなめらかにする。
    // 大きな星は、ふつうの星（同じ番号）の BOSS_HARD 倍の重さ（とかけら）にする
    // 星ごとの傾き（てつ多め・こおり多め）でも、星の重さ（体力の合計）とかけらの合計は変えない（得意な武器で速くなるだけ）
    const mx = mixRaw(n);
    const adj = (smooth * smooth * 0.86) / (d * rows) * (boss ? BOSS_HARD : 1) * (weightOf(mx.iron0, mx.ice0) / weightOf(mx.iron, mx.ice));
    return { boss, cols: d, rows, adj, mix: mx };
  }
  // マスの混ざり方（傾きの前 iron0・ice0 と、傾けたあと iron・ice）
  function mixRaw(n) {
    const iron0 = n < 3 ? 0 : n < 10 ? MIX.iron[0] : MIX.iron[1];
    const ice0 = n < 6 ? 0 : MIX.ice;
    let iron = iron0, ice = ice0;
    if (n >= 6) {
      // 星ごとに少し傾ける（平均は MIX のまま）。0=そのまま・1=てつ多め・2=こおり多め
      const tilt = hash2(n, 0x5eed) % 3;
      if (tilt === 1) { iron += MIX.tilt; ice -= MIX.tilt; } else if (tilt === 2) { iron -= MIX.tilt; ice += MIX.tilt; }
      iron = Math.round(iron * 100) / 100; ice = Math.round(ice * 100) / 100;
    }
    return { iron0, ice0, iron, ice };
  }
  // 1 マスあたりの体力の重み（いわ 1・てつ 4・こおり 2。かけらも同じ重み）
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
  function starInfo(n) {
    try {
      n = normStar(n);
      if (n === null) return null;
      const dm = dimsOf(n);
      const boss = dm.boss, cols = dm.cols, rows = dm.rows;
      const iron = dm.mix.iron, ice = dm.mix.ice;
      const gold = n >= 8 ? 2 + (hash2(n, 0x901d) % 5) : 0;   // きん の数（2〜6 マス）
      const main = iron === 0 && ice === 0 ? null : iron >= ice ? "iron" : "ice";   // 札のマス（§18.1 C の ◎ 用）
      const tag = main === null ? "" : main === "iron" ? "てつが おおい" : "こおりが おおい";
      return { cols, rows, approachSec: approachSecOf(n), boss, mix: { iron, ice, gold }, tag, main };
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
      const len = 4 + Math.floor(rnd() * 7);   // すじの長さ 4〜10（いなずま の連鎖が とどく長さ）
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
    const rowHp = softRows(mats, cols, rows, cnt);
    const hp = new Array(N).fill(0);
    let value = 0;
    for (const i of cells) {
      const m = matOf(mats[i]);
      hp[i] = cellHp(n, m) * rowHp[Math.floor(i / cols)];
      value += cellValue(n, m);
    }
    let maxRow = 0;
    for (const i of cells) { const r = Math.floor(i / cols); if (r > maxRow) maxRow = r; }
    const x = (FIELD_W - cols * CELL) / 2;
    const y = START_BOTTOM - (maxRow + 1) * CELL;
    const rock = { cols, rows, x, y, vy: 0, mats, hp, total: cnt, left: cnt, value, bottom0: START_BOTTOM, rowHp };
    rock.vy = vyOf(n, tries);
    return rock;
  }
  // 行ごとの体力の倍率（もろい底 SOFT）。下から数えたマスの割合 q（その行の半分までを数える）で決め、
  // 星の重さ（Σ 硬さ × 倍率）が倍率 1 のときと同じになるよう全体を掛け直す
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
      seed: o.seed, rng: o.rng, wait: 0, back: "fly",
      ms: Array.isArray(o.ms) ? o.ms.slice() : [], bestT: isObj(o.bestT) ? Object.assign({}, o.bestT) : {}, tryAt: 0
    };
    s.rock = genRock(s.seed, s.star, s.tries);
    if (o.mid !== undefined && o.mid !== null && applyMid(s, o.mid)) {
      const tt = isObj(o.mid) && isNum(o.mid.tt) ? clamp(o.mid.tt, 0, 1e7) : 0;
      s.tryAt = s.t - tt;
    }
    // 星の途中から始めたとき、もう超えている区切りは「もらった」ことにする（もらい直せない）
    s.ms = passedMs(s.rock, s.ms);
    return s;
  }
  // 星の途中（mid）を、その星の最初の形にあてはめる。おかしければ何もしない（星の最初から）。
  // 決まり：長さが格子と同じ・各文字が '0'〜'4'・残っているマスは最初の形と同じ種類（足す・変えるは不可、欠けるだけ）・1 マス以上。
  //         はなれたかたまりがあれば、本体だけ残す（かけらは足さない）。y は最初の y から「一番下がバリアの 1 マス手前」までに丸める。
  //         体力（hp）は、長さが同じで残っているマスが '1'〜'9' のときだけ使う（おかしければ満タン）。
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
    s.rock = Object.assign({}, R, { mats, hp, left, y });
    return true;
  }
  // 区切り（25・50・75%）：その星でもらった区切りの配列に、いまの壊した割合で超えている区切りを足す（小さい順）
  function passedMs(rock, ms) {
    const b = rock && rock.total > 0 ? 1 - rock.left / rock.total : 0;
    const out = MILESTONES.filter((p) => ms.includes(p) || b >= p / 100 - 1e-12);
    return out.length === ms.length ? ms : out;
  }
  // マス i の満タンの体力（もろい底の行の倍率こみ）。空・おかしければ null
  function fullHp(s, i) {
    const R = s.rock, code = R.mats[i];
    if (!code) return null;
    const base = cellHp(s.star, matOf(code));
    const rh = R.rowHp;
    const r = Math.floor(i / R.cols);
    return Array.isArray(rh) && rh.length === R.rows && isNum(rh[r]) ? base * rh[r] : base;
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
  function nearestCold(s, fx, fy) {
    const rock = s.rock;
    if (!s.burns.length && !s.shots.some((b) => b.w === "fire")) return nearest(rock, fx, fy, 0);
    const hot = new Set();
    for (const b of s.burns) hot.add(b.i);
    // 飛んでいる ほのお の弾がねらっているマスも、燃えるものとして数える
    for (const b of s.shots) if (b.w === "fire" && b.aim >= 0) hot.add(b.aim);
    const { cols, mats } = rock;
    let best = -1, bd = Infinity, bx = Infinity;
    for (let i = 0; i < mats.length; i++) {
      if (!mats[i] || hot.has(i)) continue;
      const x = rock.x + ((i % cols) + 0.5) * CELL, y = rock.y + (Math.floor(i / cols) + 0.5) * CELL;
      const d = (x - fx) * (x - fx) + (y - fy) * (y - fy);
      if (d < bd || (d === bd && x < bx)) { bd = d; best = i; bx = x; }
    }
    return best >= 0 ? best : nearest(rock, fx, fy, 0);
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
    const aff = affOf(w, mat);
    R.hp[i] -= amount * aff;
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
      const full = fullHp(s, i);
      if (MAT_HP[mat] > 1 && full > 0) crack = clamp(Math.floor(4 * (1 - R.hp[i] / full)), 0, 3);
      ctx.evs.push({ kind: "hit", i, w, mat, crack, aff });
    }
    return false;
  }
  // fromSpread：となりから燃えうつったマスは、そこからさらに広げない（こおりのかたまり全部が一度に燃えて強くなりすぎないよう。1 だんだけ広がる）
  function ignite(s, i, ctx, fromSpread) {
    const lv = slotLv(s, "fire");
    const until = s.t + shapeOf("fire", lv);
    for (const b of s.burns) if (b.i === i) { if (b.until < until) b.until = until; return; }
    s.burns.push({ i, until, at: s.t, spread: !!fromSpread });
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
      // ほのお は、まだ燃えていないマスをねらう（同じマスに重ねても強くならないので）。全部燃えていれば一番近いマス
      const tgt = w === "fire" ? nearestCold(s, fx, fy) : nearest(rock, fx, fy, 0);
      if (tgt < 0) return;
      const tx = cellX(rock, tgt), ty = cellY(rock, tgt);
      const ang = Math.atan2(ty - fy, tx - fx);
      ctx.evs.push({ kind: "fire", w, x: fx, y: fy, tx, ty });
      if (w === "spread") {
        const n = shapeOf(w, L);
        // 扇：となりの弾との角度は fan ÷ (1 + (n−5)/4)（5発 3°・7発 2.5°・9発 2.25°・11発 2.1°）。
        // 扇の全体の幅はその (n−1) 倍（5発 12°・7発 15°・9発 18°・11発 21°。しんかで少しずつ広がる）。
        // ユーザー決定（2026-10-22）「散らす角度が広いね。半分くらいにして」で 0.5 倍、
        // さらに（2026-10-23）「今の25%減、狭めてください」で 0.5 × 0.75 = 0.375 倍にした
        const fan = 0.375 * (8 + 2 * (n - 5) / 2) * Math.PI / 180;
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
        s.shots.push({ w, x: fx, y: fy, vx: Math.cos(ang) * BULLET_SPEED, vy: Math.sin(ang) * BULLET_SPEED, t: 0, dmg: d, aim: tgt });
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
      for (let c = c0; c < c0 + wcols; c++) {
        let n = 0;
        for (let r = rock.rows - 1; r >= 0 && n < BEAM_DEPTH; r--) {
          const i = r * rock.cols + c;
          if (s.rock.mats[i]) { hurt(s, i, d, w, ctx); n++; }
        }
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
    const dist0 = progressS(s).distance;   // クリアの出来事に載せる「ちきゅうまで あと」（最後のマスが欠ける前の値）
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
      for (const q of add) if (s.rock.mats[q]) ignite(s, q, ctx, true);
    }
    // 6. かけらは hurt の中で足し済み。7. はなれたかたまり
    if (ctx.broke && s.rock.left > 0) breakLoose(s, ctx);
    // 7.5 区切り（壊した割合 25・50・75%。§18.1 B）
    if (ctx.broke) milestones(s, evs);
    // 8. クリア／とどいた
    if (s.rock.left <= 0) {
      const bonus = Math.floor(s.rock.value * CLEAR_BONUS);
      s.kakera = capK(s.kakera + bonus);
      s.totals.kakera = capK(s.totals.kakera + bonus);
      s.totals.stars++;
      s.phase = "clear"; s.wait = CLEAR_SEC; s.shots = []; s.burns = [];
      // クリアの時間（最後の挑戦の始めから）と、前のベスト（無ければ null）。ベストは星ごとに保存（§18.1 C）
      const time = Math.max(0.1, Math.round((s.t - (isNum(s.tryAt) ? s.tryAt : 0)) * 10) / 10);
      const bt = isObj(s.bestT) ? s.bestT : {};
      const prev = isNum(bt[s.star]) ? bt[s.star] : null;
      if (prev === null || time < prev) s.bestT = trimBest(Object.assign({}, bt, { [s.star]: time }));
      evs.push({ kind: "clear", star: s.star, bonus, time, best: prev, distance: dist0 });
    } else if (bottomY(s.rock) >= BARRIER_Y - 1e-9) {
      const broken = progressS(s).broken;
      s.phase = "bounce"; s.wait = BOUNCE_SEC; s.shots = []; s.burns = [];
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
      s.kakera = capK(s.kakera + bonus);
      s.totals.kakera = capK(s.totals.kakera + bonus);
      s.ms = (Array.isArray(s.ms) ? s.ms : []).concat(pct);
      evs.push({ kind: "milestone", pct, bonus });
    }
  }
  // bestT を BEST_MAX 件まで（星の番号が大きい＝新しい星を残す）
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
    s.tryAt = s.t;   // 区切り（ms）は星ごとなので、やり直しでは消さない（もらい直せない）
  }
  function nextStar(s, evs) {
    const was = s.star;
    s.star = Math.min(STAR_MAX, s.star + 1);
    s.tries = 1;
    s.rock = genRock(s.seed, s.star, 1);
    s.shots = []; s.burns = [];
    s.cd = s.slots.map(() => s.t);
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
    if (w === "spread") return v * 1.0;
    if (w === "bomb") { let n = 0; const r = Math.ceil(v); for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (a * a + b * b <= v * v + 1e-9) n++; return n * 0.9; }
    if (w === "bolt") return 1 + v;
    if (w === "beam") return v * BEAM_DEPTH * 0.9;
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
  // マス i の満タンの体力（もろい底の倍率こみ。画面のひびの段の目安）。空のマス・おかしな引数は null
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
    const distance = by === -Infinity ? 1 : by >= BARRIER_Y - 1e-6 ? 0 : clamp((BARRIER_Y - by) / (BARRIER_Y - b0), 0, 1);
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
      if (n === Infinity) n = KAKERA_MAX;
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
  // 保存の中身（オブジェクト）。withMid が true なら、星の途中（mid）も入れる
  function saveObj(state, withMid) {
    let star = state.star, tries = state.tries, ms = Array.isArray(state.ms) ? state.ms.slice() : [];
    // クリアの演出中（phase 'clear'）は、星はまだ進んでいない。開き直しで同じ星をもう一度にしないよう、次の星を保存する。
    // ただし はじめての星 ENDING_STAR のクリアは、エンディングを見せるため、その星のまま（1.5 秒の間だけ）
    if (state.phase === "clear" && !(state.star === ENDING_STAR && !state.cleared)) { star = Math.min(STAR_MAX, state.star + 1); tries = 1; ms = []; }
    const o = {
      v: SAVE_VERSION, star, kakera: state.kakera, slots: state.slots.map((x) => ({ id: x.id, lv: x.lv })),
      offer: state.offer ? state.offer.slice() : null, cleared: !!state.cleared, tries,
      totals: { cells: state.totals.cells, stars: state.totals.stars, kakera: state.totals.kakera, chunks: state.totals.chunks },
      seed: state.seed, rng: state.rng, ms, bestT: isObj(state.bestT) ? Object.assign({}, state.bestT) : {}
    };
    if (withMid) { const m = midOf(state); if (m) o.mid = m; }
    return o;
  }
  // 星の途中（§8.2 mid）：小惑星の y・残っているマス（1 マス 1 文字 '0'〜'4'）・マスの体力（1 マス 1 文字 '1'〜'9'。9 が満タン、
  // 残りの割合を 9 段に切り上げ＝開き直しで弱くはならない。空のマスは '0'）。飛んでいるとき（2択で止まっているときも）だけ。
  // 弾・燃えているマス・戦闘機の位置・撃つ間隔は入れない
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
      // 区切り：25・50・75 だけ（重複なし・小さい順）。星のベスト時間：キーは 1〜STAR_MAX の整数、値は正の有限の数（0.1 秒に丸める）、最大 BEST_MAX 件
      const ms = Array.isArray(o.ms) ? MILESTONES.filter((p) => o.ms.includes(p)) : [];
      const bestT = {};
      if (isObj(o.bestT)) for (const k of Object.keys(o.bestT)) {
        const v = o.bestT[k];
        if (!/^[1-9][0-9]{0,3}$/.test(k) || Number(k) > STAR_MAX || !isNum(v) || v <= 0 || v > 1e7) continue;
        bestT[Number(k)] = Math.max(0.1, Math.round(v * 10) / 10);
      }
      const base = { star, kakera, slots, offer: null, cleared, tries, totals, seed, rng, mid: o.mid, ms, bestT: trimBest(bestT) };
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
  // マスの数ではなく「体力の割合」で混ざり方を見る（てつ は 4 倍かたいので、てつ に効く武器の得が大きい）
  function mixOf(n) {
    const m = starInfo(n).mix;
    const w = { rock: Math.max(0, 1 - m.iron - m.ice) * MAT_HP.rock, iron: m.iron * MAT_HP.iron, ice: m.ice * MAT_HP.ice };
    const sum = w.rock + w.iron + w.ice;
    return { rock: w.rock / sum, iron: w.iron / sum, ice: w.ice / sum };
  }
  function fitOf(w, mix) { let a = 0; for (const k in mix) a += mix[k] * affOf(w, k); return a; }
  function effDps(w, L, mix) { return dpsRaw(w, L) * fitOf(w, mix); }
  function aheadMix(n) {   // これから先の 10 星の平均の混ざり方（体力の割合）
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
  function pickChoice(s, policy, simRnd, order) {
    const [a, b] = s.offer;
    if (order) { const ia = order.indexOf(a), ib = order.indexOf(b); if (ia !== ib) return (ia < 0 ? 99 : ia) <= (ib < 0 ? 99 : ib) ? 0 : 1; }
    if (policy === "random") return simRnd() < 0.5 ? 0 : 1;
    if (policy === "worst") {
      const m = aheadMix(s.star);
      return fitOf(a, m) <= fitOf(b, m) ? 0 : 1;
    }
    // 札（てつ／こおりが おおい）があれば、その星に合うほう。札が無い星（いわ だけ）では、これから先に合うほう
    const m = starInfo(s.star).tag ? mixOf(s.star) : aheadMix(s.star);
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
    // 何秒ごとにアプリを閉じて開き直すか（保存→読み込み。reopenMid が false なら星の途中を保存しない＝星の最初から）
    const reopenEvery = isNum(opts.reopenEvery) && opts.reopenEvery >= 10 ? opts.reopenEvery : 0;
    const reopenMid = opts.reopenMid !== false;
    // 測る用：2択で先に選ぶ武器の順（この順に無い武器はあと）。無ければ policy のとおり
    const pickOrder = Array.isArray(opts.pickOrder) ? opts.pickOrder.filter((id) => typeof id === "string") : null;
    const rep = {
      policy: pol, seed, buyEvery: 1, stars: [], firstBuySec: null, buys: 0, buyGaps: { avg: null, max: 0 }, endSec: null,
      kakeraMax: 0, shotsMax: 0, particlesMax: 0, bounces: [], picks: [], kakeraAtBounce: [], reopens: 0, t: 0, error: null, final: null
    };
    rep.buyEvery = buyEvery;
    const wasSim = SIM;
    SIM = true;
    try {
      let s = newGame(seed);
      let nextReopen = reopenEvery || Infinity;
      const simRnd = makeRng(hash2(seed >>> 0, 0x51a1));
      const evs = [];
      let starStart = 0, tryStart = 0, starBuys = 0, lastBuy = 0, nextBuy = 1;
      let leftRatio = 1, lastPhase = s.phase;
      let b30 = null;   // 星の最初の 30 秒で欠けた割合（§18.1 B。30 秒より前にクリアしたら 1）
      const win = [];   // 粒の目安：欠けたマス 1 つで 3 粒、0.9 秒（飛び散り 0.3＋吸い込まれ 0.6）残る
      let partNow = 0;
      while (s.t < maxSec) {
        if (s.phase === "choose") {
          const k = pickChoice(s, pol, simRnd, pickOrder);
          rep.picks.push({ star: s.star, offer: s.offer.slice(), pick: s.offer[k] });
          chooseMut(s, k);
        }
        if (s.phase === "end") s.phase = "fly";   // 「このまま あそぶ」
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
        stepMut(s, STEP, evs);
        let born = 0;
        for (const e of evs) {
          if (e.kind === "break") born += 3;
          else if (e.kind === "chunk") born += e.cells.length * 3;
          else if (e.kind === "clear") {
            rep.stars.push({ star: e.star, boss: e.star % APPROACH.bossEvery === 0, sec: +(s.t - starStart).toFixed(2), clearSec: +(s.t - tryStart).toFixed(2),
              tries: s.tries, leftRatio: +leftRatio.toFixed(3), buys: starBuys, kakera: s.kakera, b30: b30 === null ? 1 : +b30.toFixed(3) });
            b30 = null;
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
          if (lastPhase === "clear" || lastPhase === "end") { starStart = s.t; tryStart = s.t; starBuys = 0; b30 = null; }
          else if (lastPhase === "bounce") tryStart = s.t;
          if (b30 === null && s.t - starStart >= 30 - 1e-9) b30 = progressS(s).broken;
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
    HP_BASE, HP_GROWTH, VALUE_GROWTH, HP_GROWTH2, VALUE_GROWTH2, EARLY_HP, UP_GROWTH, LEVEL_MAX, SLOTS_MAX,
    CLEAR_BONUS, MILESTONE_BONUS, MILESTONES, BEST_MAX, SOFT, ENDING_STAR, STAR_MAX, STAR_CALC_MAX, KAKERA_MAX, SHOTS_MAX, STEP,
    SAVE_VERSION, SAVE_KEY, SAVE_KEY_BAK, SAVE_KEY_BEST, SAVE_KEY_HELP,
    START_BOTTOM, BOUNCE_SEC, CLEAR_SEC, BEAM_SEC, BOMB_FLIGHT, BULLET_SPEED, FIGHTER_SPEED, SLOW_MAX, SLOW_FROM, SLOW_STEP,
    APPROACH, MIX, SIZE_STEP, BOSS_GROW, BOSS_HARD, BEAM_DEPTH,
    newGame, starInfo, step, dpsOf, upCostOf, upgrade, slotCostOf, unlock, choose, progressOf, formatKakera,
    makeSave, loadSave, validateBest, simulate,
    hpMul, valMul, dmg, upCost, affOf, shapeOf, cellHp, cellHpAt, cellValue, matOf
  };
  return Object.freeze(api);
});
