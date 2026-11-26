/*
 * ぼくのまち — ロジック（DOM・Date・performance・Math.random・localStorage に触れない純粋な計算だけ）
 * 約束：docs/machi-contract.md（§5 遊びの決まり・§6 中身の形・§8 保存）。数値合わせの表は docs/plans/machi.md §6。
 * 担当A（ロジック）だけが編集する。初代シムシティ／Micropolis のコード・資料は見ていない（このゲームのために一から考えた決まり）。
 *
 * UMD: ブラウザでは window.MachiLogic、Node では module.exports。
 *
 * 中の作り：
 *   - 地図は 64×78 マスと大きいので、ほかのゲームとちがい **state はその場で書き換える**（step・place・setTax などは
 *     受け取った state を直して、同じ state を返す）。型付きの配列を写さない（約束 §6.3「step の中で配列を新しく作らない」）。
 *   - 例外は外へ出さない（おかしな引数は null か { ok:false, reason }）。
 *   - 乱数は mulberry32。state.rng に 32bit の状態を持つ（保存する）。地形は (seed, 選んだ番号) から決まる別の乱数で作る。
 *   - 計算のための入れ物（区画ごとの合計の表・待ち行列など）は state に入れず、state をキーにした WeakMap（K）に持つ。
 *     手で組んだ state でも recalc(state) を呼べば作り直す。
 *   - 「半径 r」「r マス以内」は、たて・よこ・ななめの四角（|dx| ≦ r かつ |dy| ≦ r）で数える（合計の表で 1 回で引ける）。
 *   - 約束 §6.1 の state の形に、次の欄を足している（保存しない。画面は使わなくてよい）：
 *       clock    … 遊んでいる秒（速さ 0 のときは進まない）。5 秒の取り消しに使う
 *       inflow   … いま町に来たい人の数（すむ が育つときに使う。§5.3 の「来る人の上限」。数値合わせで足した）
 *       voiceAt  … 市民の声の why ごとの、最後に出した月（同じ声は 3 か月出さない）
 *       newsAt   … 知らせの why ごとの、最後に出した月
 *       taxHigh  … 税 たかい が続いた月の数
 *       prevPop  … 先月の人口（3% 減ったかを見る）
 *       fest     … おまつりの残り月（すみやすさ +10）・harvest … ほうさくの月か
 *       income, cost … 先月のお金の動き（summary・しらべる用）
 *       net.zone … 区画のマスごとの、2 マス以内のみちのつながりの番号（いりぐちとつながったものを先に選ぶ。無ければ -1）
 *   - events は { kind: '<名前>', ... }。grow の建物の種類は bk、できごとの種類は ev（外側の kind とぶつけない。約束 §6.2）。
 *   - 仕事の釣り合い r は、小さな町で振れすぎないように (仕事 + R_SOFT) ÷ (はたらく人 + R_SOFT) で出す（数値合わせ。計画書 §6）。
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MachiLogic = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : null, function () {
  "use strict";

  // ---------------------------------------------------------------- 定数（約束 §5・§6.2）
  const NAME = "ぼくのまち";
  const W = 64, H = 78, N = W * H;
  const CHUNK = 8, CW = 8, CH = 10, NCHUNK = CW * CH;          // 8×10＝80 チャンク（下の段は 6 行）
  const POLL_BLOCK = 4, PW = 16, PH = 20, NPOLL = PW * PH;      // よごれは 4×4 マスの区画（16×20）
  const TICK_SEC = 0.25, TICKS_PER_MONTH = 16, CHUNKS_PER_TICK = NCHUNK / TICKS_PER_MONTH;
  const START_MONEY = 2000;                          // 約束の仮 20,000 → 数値合わせで 2,000（計画書 §6）
  const MONEY_MAX = 99999999, MONEY_MIN = -99999999;
  const MONTH_MAX = 99999;
  const BEST_MAX = 9999999;
  const SPEEDS = Object.freeze([0, 1, 4]);
  const NAME_MAX = 10;
  const DEFAULT_NAME = "ぼくのまち";
  const SAVE_VERSION = 1;
  const SAVE_KEY = "machi.save", SAVE_KEY_BAK = "machi.bak", SAVE_KEY_BEST = "machi.best", SAVE_KEY_SEEN = "machi.seen";
  const UNDO_SEC = 5;
  const CHEAPEST = 20, SUBSIDY = 20;                 // いちばん安い道具（すむ・めぐみ）・人口 0 で動けないときの ほじょきん（1 か月）
  const TIP_SUBSIDY = "まちの ほじょきんが はいったよ。みちの そばに すむ を おいて ひとを よぼう";
  const TIP_BUILD = "おかねが たりなくて たてものが おおきく なれないよ。ぜいを あげると おかねが ふえるよ";
  const RICH_MONEY = 20000;
  const TIP_RICH = "おかねが たくさん あるね。ぜいを ひくく すると ひとが はやく ふえるよ";
  const TIP_BROKE = "おかねが ふえないよ。こわすのは ただ。つかわない みちを こわすと いじひが へるよ";
  const DT_MAX = 0.25;

  // 地形・置いた物
  const TER = Object.freeze({ FLAT: 0, SEA: 1, RIVER: 2, MOUNT: 3, FOREST: 4, BEACH: 5 });
  const TER_NAMES = Object.freeze(["へいち", "うみ", "かわ", "やま", "もり", "すなはま"]);
  const USE = Object.freeze({ NONE: 0, ROAD: 1, RAIL: 2, CROSS: 3, GREEN: 4, HOME: 5, WORK: 6, SHOP: 7, NATURE: 8, ENTRY: 9 });
  const USE_NAMES = Object.freeze(["なし", "みち", "せんろ", "ふみきり", "みどり", "すむ", "しごと", "おみせ", "めぐみ", "いりぐち"]);
  const TERRAIN_TYPES = Object.freeze(["うみべ", "かわの まち", "やまあい"]);

  // 道具（§5.2）
  const TOOLS = Object.freeze([
    Object.freeze({ id: "home", name: "すむ", use: 5, cost: 20, bridgeCost: null, upkeep: 0, rank: 0 }),
    Object.freeze({ id: "work", name: "しごと", use: 6, cost: 30, bridgeCost: null, upkeep: 0, rank: 0 }),
    Object.freeze({ id: "shop", name: "おみせ", use: 7, cost: 30, bridgeCost: null, upkeep: 0, rank: 0 }),
    Object.freeze({ id: "nature", name: "めぐみ", use: 8, cost: 20, bridgeCost: null, upkeep: 0, rank: 0 }),
    Object.freeze({ id: "road", name: "みち", use: 1, cost: 10, bridgeCost: 50, upkeep: 1, rank: 0 }),
    Object.freeze({ id: "rail", name: "せんろ", use: 2, cost: 40, bridgeCost: 200, upkeep: 3, rank: 1 }),
    Object.freeze({ id: "green", name: "みどり", use: 4, cost: 15, bridgeCost: null, upkeep: 1, rank: 0 }),
    Object.freeze({ id: "erase", name: "こわす", use: 0, cost: 5, bridgeCost: null, upkeep: 0, rank: 0 })
  ]);
  const TOOL = {};
  for (const t of TOOLS) TOOL[t.id] = t;
  const ERASE_LVL = 10;                              // こわす：5 + 10×lvl
  const UPKEEP = new Uint8Array([0, 1, 3, 4, 1, 0, 0, 0, 0, 0]);   // use ごとの毎月の維持費（ふみきり＝みち＋せんろ）

  // 住む場所（§5.4）。index＝kind
  const HOME = Object.freeze([
    null,
    Object.freeze({ kind: 1, id: "apart", name: "アパート", people: [0, 15, 30, 45], tax: 0.15, rank: 1 }),
    Object.freeze({ kind: 2, id: "mansion", name: "マンション", people: [0, 25, 50, 80], tax: 0.35, rank: 2 }),
    Object.freeze({ kind: 3, id: "house", name: "じゅうたくち", people: [0, 4, 8, 12], tax: 0.25, rank: 0 }),
    Object.freeze({ kind: 4, id: "luxury", name: "こうきゅう じゅうたくち", people: [0, 2, 4, 6], tax: 0.75, rank: 1 })
  ]);
  // 仕事場（§5.8）。WORK[use][kind]
  const WORK = Object.freeze({
    6: Object.freeze([null,
      Object.freeze({ kind: 1, id: "factory", name: "こうば", jobs: [0, 10, 20, 35], poll: 3 }),
      Object.freeze({ kind: 2, id: "clean", name: "きれいな こうば", jobs: [0, 10, 20, 35], poll: 1 })]),
    7: Object.freeze([null,
      Object.freeze({ kind: 1, id: "shop", name: "おみせ", jobs: [0, 6, 12, 20], poll: 0 }),
      Object.freeze({ kind: 2, id: "office", name: "ビル", jobs: [0, 20, 40, 70], poll: 0 })]),
    8: Object.freeze([null,
      Object.freeze({ kind: 1, id: "farm", name: "はたけ", jobs: [0, 3, 5, 8], poll: 0 }),
      Object.freeze({ kind: 2, id: "wood", name: "りんぎょう", jobs: [0, 3, 5, 8], poll: 0 }),
      Object.freeze({ kind: 3, id: "fish", name: "ぎょこう", jobs: [0, 5, 10, 15], poll: 0 })])
  });
  // 節目（§5.16）
  const RANKS = Object.freeze([
    Object.freeze({ rank: 0, name: "むら", pop: 0, bonus: 0, unlocks: [] }),
    Object.freeze({ rank: 1, name: "まち", pop: 1000, bonus: 3000, unlocks: ["rail", "tax", "apart", "luxury"] }),
    Object.freeze({ rank: 2, name: "し", pop: 10000, bonus: 10000, unlocks: ["mansion", "office", "clean"] }),
    // おおきな し・だいとし の ごほうび（おおきな こうえん・まちの タワー）は今は作らない（PM 決定 2026-11-26）。お祝いのお金だけ
    Object.freeze({ rank: 3, name: "おおきな し", pop: 30000, bonus: 40000, unlocks: [] }),
    Object.freeze({ rank: 4, name: "だいとし", pop: 60000, bonus: 80000, unlocks: [] })
  ]);
  // ときどき起こること（§5.12）
  const EVENTS = Object.freeze([
    Object.freeze({ kind: "festival", weight: 30, bad: false, months: 2, text: "おまつり！ ひとが ふえるよ" }),
    Object.freeze({ kind: "harvest", weight: 20, bad: false, months: 1, text: "ほうさく！ はたけの みのりが いっぱい", textFish: "たいりょう！ さかなが いっぱい とれたよ" }),
    Object.freeze({ kind: "tourist", weight: 15, bad: false, months: 1, text: "かんこうきゃくが きたよ" }),
    Object.freeze({ kind: "rain", weight: 20, bad: true, months: 1, text: "おおあめで かわの そばの みちが とおれないよ。すこし まってね" }),
    Object.freeze({ kind: "fire", weight: 15, bad: true, months: 1, text: "かじが あったけど みんな ぶじだよ。また たてられるよ" })
  ]);
  const EVENT_RATE = 0.10, EVENT_COOL = 3, EVENT_MIN_POP = 300, EVENT_BAD_FROM = 24;
  const RAIN_CELLS = 6, FIRE_MAX = 3, TOURIST_RATE = 0.2;

  // 育ち方（§5.3。数値合わせで決めた値は計画書 §6）
  const GROW_P = 0.25, SHRINK_P = 0.20;
  const R_SOFT = 10;                                 // 釣り合い r のやわらげ
  const GROW_BASE = 10, GROW_RATE = 0.0006;          // 1 か月に来る人の数＝(GROW_BASE ＋ 人口 × GROW_RATE) × ほしの倍率
  const STAR_MUL = Object.freeze([0, 0.35, 0.7, 1, 1.2, 1.4]);
  const INFLOW_KEEP = 3;                             // 来たい人はたまっても 3 か月ぶんまで
  const TAX_MUL = Object.freeze([0.7, 1, 1.3]);
  const TAX_LIVE = Object.freeze([4, 0, -8]);
  const JOB_TAX = 0.12, NATURE_TAX = 0.2;            // 約束の仮（税 0.6〜3.0・仕事 0.5／0.8）を 1/4 にした（数値合わせ）
  const WORKER_RATE = 0.5;
  const RAIL_MIN = 8, RAIL_REACH = 3;
  const CAP_ROAD = 20, CAP_X = 10, CAP_CROSS = 8;
  const TRIP_RATE = 0.3;              // 約束の仮 0.1 → 0.3（交差点で渋滞が起きるように。数値合わせ）
  // 密度 d（§5.5）＝ DENS_BASE ＋ せんろ 35 ＋ 交差点 DENS_X ＋ 半径 6 の仕事 DENS_JOB_STEP 人ごと +5（最大 DENS_JOB_MAX）＋ 町の大きさ
  const DENS_BASE = 15, DENS_X = 10, DENS_JOB_STEP = 50, DENS_JOB_MAX = 20;   // 約束の仮 20・20 人・25 → 15・50 人・20（住宅地を出す。数値合わせ）
  const LIVE_BASE = 55;                              // 約束の仮 50 → 55（みち と 仕事 があれば育つ。数値合わせ）
  // お金の使い道（中毒性レビュー 4。数値合わせ・計画書 §6）：
  //   まち（rank 1）からは、建物が 1 段から上へ育つときに、ふえる 人・仕事 1 つごとに
  //   (BUILD_PAY + 人口 × BUILD_PAY_RATE) を払う（町が大きいほど建てるのが高い。0 → 1 段は ただ・むら の間は ただ。
  //   足りなければ育つのを待つ。むら で お金が 0 になっても育てて抜け出せる）
  //   町の せわ（そうじ・がっこう など）：毎月 人口 × SERVICE[rank] を維持費に足す（節目ごとに増える）
  //   税は 来る人 にも効く：ひくい ×TAX_INFLOW[0]（すみやすさ +4 と合わせて 育つのが速い）・たかい ×TAX_INFLOW[2]
  const BUILD_PAY = 4, BUILD_PAY_RATE = 0.004;
  const SERVICE = Object.freeze([0, 0.04, 0.07, 0.08, 0.09]);
  const TAX_INFLOW = Object.freeze([1.3, 1, 0.85]);

  // ---------------------------------------------------------------- 小さな道具
  const isNum = (x) => typeof x === "number" && Number.isFinite(x);
  const isInt = (x) => isNum(x) && Math.floor(x) === x;
  const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const inMap = (x, y) => isInt(x) && isInt(y) && x >= 0 && y >= 0 && x < W && y < H;
  const isRoadUse = (u) => u === 1 || u === 3 || u === 9;
  const isRailUse = (u) => u === 2 || u === 3;
  const isZoneUse = (u) => u >= 5 && u <= 8;
  function hash2(a, b) {
    let h = (Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35)) | 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
    return h | 0;
  }
  function rngFrom(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // state.rng を進める乱数（0〜1）
  function rnd(s) {
    const a = (s.rng + 0x6D2B79F5) | 0;
    s.rng = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ---------------------------------------------------------------- 地形（§5.14。値のノイズ・自分で書いた）
  function makeField(R, scale) {
    const gw = Math.ceil((W + 80) / scale) + 2, gh = Math.ceil((H + 80) / scale) + 2;
    const v = new Float32Array(gw * gh);
    for (let k = 0; k < v.length; k++) v[k] = R();
    return function (x, y) {
      const fx = x / scale, fy = y / scale;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy;
      tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const cx = ((ix % gw) + gw) % gw, cy = ((iy % gh) + gh) % gh, cx1 = (cx + 1) % gw, cy1 = (cy + 1) % gh;
      const a = v[cy * gw + cx], b = v[cy * gw + cx1], c = v[cy1 * gw + cx], d = v[cy1 * gw + cx1];
      return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };
  }
  function genTerrain(seed, type) {
    const R = rngFrom(hash2(seed, 1013 + type * 7919));
    const ter = new Uint8Array(N);
    const f1 = makeField(R, 12), f2 = makeField(R, 5);
    const fbm = (x, y) => 0.65 * f1(x, y) + 0.35 * f2(x, y);
    const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < W && y < H) ter[y * W + x] = t; };
    const get = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? ter[y * W + x] : -1);
    const ex = 22 + Math.floor(R() * 21);              // いりぐちの x（上のふち）
    const mounts = [];
    function mountain(cx, cy, r) {
      mounts.push([cx, cy, r]);
      for (let y = Math.max(0, cy - r - 4); y < Math.min(H, cy + r + 5); y++) {
        for (let x = Math.max(0, cx - r - 4); x < Math.min(W, cx + r + 5); x++) {
          const d = Math.hypot(x - cx, y - cy);
          const rr = r * (0.7 + 0.6 * f2(x + 31, y + 17));
          if (d < rr) set(x, y, TER.MOUNT);
        }
      }
    }
    function seaCorner(right, r) {
      const cx = right ? W - 1 : 0, cy = H - 1;
      for (let y = H - r - 4; y < H; y++) for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < r * (0.8 + 0.4 * f1(x + 5, y + 9))) set(x, y, TER.SEA);
      }
    }
    function river(sx, sy, tx, ty) {
      let x = sx, y = sy;
      for (let k = 0; k < 600; k++) {
        const t = get(x, y);
        if (t === TER.SEA || t < 0) break;
        set(x, y, TER.RIVER);
        // はば 2〜3 マス（流れと直角の向きに足す）
        const wide = f2(x + 70, y + 70) > 0.62 ? 2 : 1;
        for (let w = 1; w <= wide; w++) {
          const ax = Math.abs(tx - x) >= Math.abs(ty - y) ? 0 : w, ay = ax ? 0 : w;
          if (get(x + ax, y + ay) !== TER.SEA && get(x + ax, y + ay) >= 0) set(x + ax, y + ay, TER.RIVER);
        }
        if (x === tx && y === ty) break;
        const dx = tx - x, dy = ty - y;
        if (R() < 0.22) { if (Math.abs(dx) >= Math.abs(dy)) y += R() < 0.5 ? -1 : 1; else x += R() < 0.5 ? -1 : 1; }
        else if (R() < Math.abs(dx) / (Math.abs(dx) + Math.abs(dy) + 1e-9)) x += Math.sign(dx);
        else y += Math.sign(dy);
        x = clamp(x, 0, W - 1); y = clamp(y, 12, H - 1);
      }
    }
    if (type === 0) {
      // うみべ：片側（左・右・下のどれか）が海
      const side = Math.floor(R() * 3);   // 0 左・1 右・2 下
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const d = side === 0 ? x : side === 1 ? W - 1 - x : H - 1 - y;
        const along = side === 2 ? x : y;
        const c = 8 + 8 * f1(along * 1.3, 3) + (side === 2 ? 2 : 0);
        if (d < c && !(side !== 2 && y < 12)) ter[y * W + x] = TER.SEA;
      }
      const mx = side === 0 ? W - 12 : side === 1 ? 11 : (R() < 0.5 ? 12 : W - 13);
      const my = side === 2 ? 30 + Math.floor(R() * 12) : 40 + Math.floor(R() * 20);
      mountain(mx, my, 7 + Math.floor(R() * 2));
      const tx = side === 0 ? 2 : side === 1 ? W - 3 : clamp(mx + (R() < 0.5 ? -14 : 14), 4, W - 5);
      const ty = side === 2 ? H - 2 : clamp(my + 8 + Math.floor(R() * 10), 20, H - 3);
      river(mx, my + 2, tx, ty);
    } else if (type === 1) {
      // かわの まち：大きな川が地図を横切る・小さな湖
      const base = 36 + Math.floor(R() * 14);
      for (let x = 0; x < W; x++) {
        const yc = base + 14 * (f1(x * 0.8, 40) - 0.5) * 2;
        for (let y = 0; y < H; y++) if (Math.abs(y - yc) < 1.6) ter[y * W + x] = TER.RIVER;
      }
      const lx = R() < 0.5 ? 12 + Math.floor(R() * 10) : W - 22 + Math.floor(R() * 10);
      const ly = 18 + Math.floor(R() * 10);
      for (let y = ly - 5; y <= ly + 5; y++) for (let x = lx - 5; x <= lx + 5; x++) {
        if (Math.hypot(x - lx, y - ly) < 3 + 1.5 * f2(x, y)) set(x, y, TER.RIVER);
      }
      const right = R() < 0.5;
      seaCorner(right, 9);
      mountain(right ? 9 : W - 10, H - 12, 6);
    } else {
      // やまあい：山が 2 つ・もりが多い・海は角だけ
      const y1 = 28 + Math.floor(R() * 12), y2 = 44 + Math.floor(R() * 14);
      const leftFirst = R() < 0.5;
      mountain(leftFirst ? 11 : W - 12, y1, 8);
      mountain(leftFirst ? W - 12 : 11, y2, 8 + Math.floor(R() * 2));
      const right = R() < 0.5;
      seaCorner(right, 8);
      const m = mounts[R() < 0.5 ? 0 : 1];
      river(m[0], m[1] + 3, right ? W - 4 : 3, H - 4);
    }
    // もり：ノイズ＋山のまわり
    const thr = type === 2 ? 0.55 : 0.64;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (ter[i] !== TER.FLAT) continue;
      const v = fbm(x + 50, y + 50);
      let near = false;
      for (const [cx, cy, r] of mounts) if (Math.hypot(x - cx, y - cy) < r + 3) near = true;
      if (v > thr || (near && v > 0.4)) ter[i] = TER.FOREST;
    }
    // すなはま：海のとなり
    const tmp = ter.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (tmp[i] !== TER.FLAT && tmp[i] !== TER.FOREST) continue;
      let d1 = false, d2 = false;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const t = x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H ? tmp[(y + dy) * W + x + dx] : -1;
        if (t === TER.SEA) { if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) d1 = true; else d2 = true; }
      }
      if (d1 || (d2 && f2(x + 9, y + 3) > 0.5)) ter[i] = TER.BEACH;
    }
    // いりぐちの近く 10×10 は へいち
    for (let y = 0; y < 10; y++) for (let x = ex - 5; x < ex + 5; x++) set(x, y, TER.FLAT);
    // 置ける土地が 55% より少ないとき（ほぼ無い）：山を もり にして足す
    let landN = 0;
    for (let i = 0; i < N; i++) if (ter[i] === TER.FLAT || ter[i] === TER.FOREST || ter[i] === TER.BEACH) landN++;
    for (let i = 0; i < N && landN < N * 0.56; i++) if (ter[i] === TER.MOUNT) { ter[i] = TER.FOREST; landN++; }
    const entry = [{ x: ex, y: 0 }, { x: ex, y: 1 }, { x: ex, y: 2 }];
    return { terrain: ter, entry, type };
  }
  function terrainChoices(seed) {
    const sd = isNum(seed) ? Math.floor(seed) | 0 : 1;
    const out = [];
    for (let k = 0; k < 3; k++) {
      const g = genTerrain(sd, k);
      out.push({ terrain: g.terrain, entry: g.entry.map((e) => ({ x: e.x, y: e.y })), type: k, name: TERRAIN_TYPES[k] });
    }
    return out;
  }

  // ---------------------------------------------------------------- 計算の入れ物（state ごと）
  const K = new WeakMap();
  const SW = W + 1, SN = (W + 1) * (H + 1);
  function scratch(s) {
    let k = K.get(s);
    if (!k) {
      k = {
        src: new Float32Array(N), q: new Int32Array(N), rl: new Int32Array(N), uf: new Int32Array(N),
        sGreen: new Float64Array(SN), sShop: new Float64Array(SN), sFac: new Float64Array(SN), sJobs: new Float64Array(SN),
        sPeople: new Float64Array(SN), sShopJobs: new Float64Array(SN), sForest: new Float64Array(SN), sWater: new Float64Array(SN),
        sMount: new Float64Array(SN), sX: new Float64Array(SN),
        railNear: new Uint8Array(N), railAdj: new Uint8Array(N), isX: new Uint8Array(N), jamNear: new Uint8Array(N), tmp8: new Uint8Array(N),
        load: new Float32Array(N), rekind: new Uint8Array(N),
        pollNew: new Float32Array(NPOLL), emit: new Float32Array(NPOLL), red: new Float32Array(NPOLL),
        leaveWhy: { smoke: 0, jam: 0, nojob: 0, noroad: 0, factory: 0, tax: 0 },
        jamI: -1, jamLv: 0, zonesFree: 0, ready: false, build: 0, waitMoney: 0
      };
      K.set(s, k);
    }
    return k;
  }
  // 合計の表（summed-area table）を作る
  function buildSat(S, src) {
    for (let x = 0; x < SW; x++) S[x] = 0;
    for (let y = 0; y < H; y++) {
      let row = 0;
      const o = (y + 1) * SW, p = y * SW, b = y * W;
      S[o] = 0;
      for (let x = 0; x < W; x++) { row += src[b + x]; S[o + x + 1] = S[p + x + 1] + row; }
    }
  }
  function box(S, x, y, r) {
    const x0 = x - r < 0 ? 0 : x - r, y0 = y - r < 0 ? 0 : y - r;
    const x1 = x + r >= W ? W - 1 : x + r, y1 = y + r >= H ? H - 1 : y + r;
    return S[(y1 + 1) * SW + x1 + 1] - S[y0 * SW + x1 + 1] - S[(y1 + 1) * SW + x0] + S[y0 * SW + x0];
  }

  // ---------------------------------------------------------------- 人と仕事
  function peopleOf(s, i) {
    if (s.use[i] !== USE.HOME) return 0;
    const h = HOME[s.kind[i]];
    return h ? h.people[s.lvl[i]] : 0;
  }
  function jobsOf(s, i) {
    const u = s.use[i];
    if (u < 6 || u > 8) return 0;
    const t = WORK[u][s.kind[i]];
    return t ? t.jobs[s.lvl[i]] : 0;
  }
  const rOf = (jobs, workers) => (jobs + R_SOFT) / (workers + R_SOFT);
  function homeKindOf(d, v, rank) {
    const rk = isInt(rank) ? rank : 0;
    let k = d >= 50 ? (v >= 55 ? 2 : 1) : (v >= 65 ? 4 : 3);
    if (k === 2 && rk < 2) k = 1;           // マンションは し から → アパート
    if (k === 1 && rk < 1) k = 3;           // アパートは まち から → 住宅地
    if (k === 4 && rk < 1) k = 3;           // 高級住宅地は まち から → 住宅地
    return k;
  }
  function natureKindAt(s, x, y) {
    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const t = s.terrain[ny * W + nx];
      if (t === TER.SEA || t === TER.BEACH) return 3;
    }
    if (s.terrain[y * W + x] === TER.BEACH) return 3;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || (dx === 0 && dy === 0)) continue;
      const t = s.terrain[ny * W + nx];
      if (t === TER.FOREST || t === TER.MOUNT) return 2;
    }
    if (s.terrain[y * W + x] === TER.FOREST) return 2;
    return 1;
  }

  // ---------------------------------------------------------------- つながり（§5.9）
  function find(uf, a) { while (uf[a] !== a) { uf[a] = uf[uf[a]]; a = uf[a]; } return a; }
  function buildNet(s) {
    const k = scratch(s);
    if (!s.net || !(s.net.label instanceof Int32Array) || s.net.label.length !== N) s.net = { gen: 0, label: new Int32Array(N), comps: [], zone: new Int32Array(N) };
    if (!(s.net.zone instanceof Int32Array)) s.net.zone = new Int32Array(N);
    const label = s.net.label, q = k.q, uf = k.uf, rl = k.rl;
    const use = s.use, blocked = s.blocked;
    label.fill(-1);
    let nc = 0;
    // みちの塊
    for (let i = 0; i < N; i++) {
      if (label[i] >= 0 || !isRoadUse(use[i]) || blocked[i]) continue;
      let h = 0, t = 0;
      q[t++] = i; label[i] = nc;
      while (h < t) {
        const c = q[h++], x = c % W;
        const nb0 = x > 0 ? c - 1 : -1, nb1 = x < W - 1 ? c + 1 : -1, nb2 = c - W, nb3 = c + W;
        for (let d = 0; d < 4; d++) {
          const n = d === 0 ? nb0 : d === 1 ? nb1 : d === 2 ? nb2 : nb3;
          if (n < 0 || n >= N || label[n] >= 0 || !isRoadUse(use[n]) || blocked[n]) continue;
          label[n] = nc; q[t++] = n;
        }
      }
      nc++;
    }
    for (let c = 0; c < nc; c++) uf[c] = c;
    // 交差点（となりのみちが 3 つ以上）
    const isX = k.isX, src = k.src;
    for (let i = 0; i < N; i++) {
      isX[i] = 0;
      if (label[i] < 0) continue;
      const x = i % W;
      let n = 0;
      if (x > 0 && label[i - 1] >= 0) n++;
      if (x < W - 1 && label[i + 1] >= 0) n++;
      if (i >= W && label[i - W] >= 0) n++;
      if (i + W < N && label[i + W] >= 0) n++;
      if (n >= 3) isX[i] = 1;
    }
    for (let i = 0; i < N; i++) src[i] = isX[i];
    buildSat(k.sX, src);
    // せんろの線（8 マス以上）→ 3 マス以内のみちの塊を 1 つに
    rl.fill(-1);
    k.railNear.fill(0); k.railAdj.fill(0);
    let nl = 0;
    for (let i = 0; i < N; i++) {
      if (!isRailUse(use[i])) continue;
      const x = i % W;
      if (x > 0) k.railAdj[i - 1] = 1;
      if (x < W - 1) k.railAdj[i + 1] = 1;
      if (i >= W) k.railAdj[i - W] = 1;
      if (i + W < N) k.railAdj[i + W] = 1;
    }
    for (let i = 0; i < N; i++) {
      if (rl[i] >= 0 || !isRailUse(use[i])) continue;
      let h = 0, t = 0;
      q[t++] = i; rl[i] = nl;
      while (h < t) {
        const c = q[h++], x = c % W;
        for (let d = 0; d < 4; d++) {
          const n = d === 0 ? (x > 0 ? c - 1 : -1) : d === 1 ? (x < W - 1 ? c + 1 : -1) : d === 2 ? c - W : c + W;
          if (n < 0 || n >= N || rl[n] >= 0 || !isRailUse(use[n])) continue;
          rl[n] = nl; q[t++] = n;
        }
      }
      if (t >= RAIL_MIN) {
        let first = -1;
        for (let a = 0; a < t; a++) {
          const c = q[a], cx = c % W, cy = (c / W) | 0;
          for (let dy = -RAIL_REACH; dy <= RAIL_REACH; dy++) {
            const ny = cy + dy;
            if (ny < 0 || ny >= H) continue;
            for (let dx = -RAIL_REACH; dx <= RAIL_REACH; dx++) {
              const nx = cx + dx;
              if (nx < 0 || nx >= W) continue;
              const n = ny * W + nx;
              k.railNear[n] = 1;
              const lb = label[n];
              if (lb < 0) continue;
              if (first < 0) first = lb;
              else { const ra = find(uf, first), rb = find(uf, lb); if (ra !== rb) uf[rb] = ra; }
            }
          }
        }
      }
      nl++;
    }
    // 番号をつけ直す
    const remap = k.q;   // 使い回し（ここから先は q を使わない）
    for (let c = 0; c < nc; c++) remap[c] = -1;
    const comps = [];
    for (let c = 0; c < nc; c++) {
      const r = find(uf, c);
      if (remap[r] < 0) { remap[r] = comps.length; comps.push({ id: comps.length, entry: false, pop: 0, workers: 0, jobs: 0, r: 1, size: 0 }); }
    }
    for (let i = 0; i < N; i++) {
      if (label[i] < 0) continue;
      const id = remap[find(uf, label[i])];
      label[i] = id;
      comps[id].size++;
      if (use[i] === USE.ENTRY) comps[id].entry = true;
    }
    // 区画のマス → 2 マス以内のみちの塊（いりぐちとつながったものを先に）
    const zone = s.net.zone;
    for (let i = 0; i < N; i++) {
      zone[i] = -1;
      if (!isZoneUse(use[i])) continue;
      const x = i % W, y = (i / W) | 0;
      let best = -1;
      for (let dy = -2; dy <= 2 && !(best >= 0 && comps[best].entry); dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= W) continue;
          const lb = label[ny * W + nx];
          if (lb < 0) continue;
          if (best < 0 || (!comps[best].entry && comps[lb].entry)) best = lb;
          if (comps[best].entry) break;
        }
      }
      zone[i] = best;
    }
    s.net.comps = comps;
    s.net.gen = (s.net.gen | 0) + 1;
    k.netDirty = false;
  }
  const connected = (s, i) => { const z = s.net.zone[i]; return z >= 0 && s.net.comps[z] && s.net.comps[z].entry; };

  // ---------------------------------------------------------------- 毎月のまとめ（合計・合計の表）
  function tally(s) {
    const k = scratch(s);
    const comps = s.net.comps;
    for (const c of comps) { c.pop = 0; c.jobs = 0; }
    let pop = 0, jobs = 0, natureJobs = 0, taxSum = 0, upkeep = 0, built = 0, nature = 0, fish = 0;
    const src = k.src, use = s.use, zone = s.net.zone;
    for (let i = 0; i < N; i++) {
      const u = use[i];
      upkeep += UPKEEP[u];
      if (u === USE.HOME) {
        const p = peopleOf(s, i);
        if (p) { pop += p; taxSum += p * HOME[s.kind[i]].tax; built++; if (zone[i] >= 0) comps[zone[i]].pop += p; }
      } else if (u >= 6 && u <= 8) {
        const j = jobsOf(s, i);
        if (u === 8) { nature++; if (s.kind[i] === 3) fish++; }
        if (j) { jobs += j; built++; if (u === 8) natureJobs += j; if (zone[i] >= 0) comps[zone[i]].jobs += j; }
      }
    }
    for (const c of comps) { c.workers = c.pop * WORKER_RATE; c.r = rOf(c.jobs, c.workers); }
    s.pop = pop; s.jobs = jobs; s.workers = pop * WORKER_RATE; s.r = rOf(jobs, s.workers);
    k.natureJobs = natureJobs; k.taxSum = taxSum; k.upkeep = upkeep; k.built = built; k.nature = nature; k.fish = fish;
    if (s.pop > s.bestPop) s.bestPop = Math.min(BEST_MAX, s.pop);
  }
  // part：0 は前半（みどり・おみせ・こうば・仕事）、1 は後半（人・もり・水・やま）、無ければ全部（月の中で 2 つの tick に分ける。A4）
  function buildSats(s, part) {
    const k = scratch(s), src = k.src, use = s.use, ter = s.terrain, lvl = s.lvl;
    if (part === 1) { buildSats2(s, k); return; }
    for (let i = 0; i < N; i++) src[i] = use[i] === USE.GREEN ? 1 : 0;
    buildSat(k.sGreen, src);
    for (let i = 0; i < N; i++) src[i] = use[i] === USE.SHOP && lvl[i] > 0 ? 1 : 0;
    buildSat(k.sShop, src);
    for (let i = 0; i < N; i++) src[i] = use[i] === USE.WORK && lvl[i] > 0 ? 1 : 0;
    buildSat(k.sFac, src);
    for (let i = 0; i < N; i++) src[i] = use[i] === USE.WORK || use[i] === USE.SHOP ? jobsOf(s, i) : 0;
    buildSat(k.sJobs, src);
    for (let i = 0; i < N; i++) src[i] = use[i] === USE.SHOP ? jobsOf(s, i) : 0;
    buildSat(k.sShopJobs, src);
    if (part !== 0) buildSats2(s, k);
  }
  function buildSats2(s, k) {
    const src = k.src, ter = s.terrain, use = s.use;
    for (let i = 0; i < N; i++) src[i] = peopleOf(s, i);
    buildSat(k.sPeople, src);
    for (let i = 0; i < N; i++) src[i] = ter[i] === TER.FOREST && use[i] !== USE.NATURE ? 1 : ter[i] === TER.FOREST ? 1 : 0;
    buildSat(k.sForest, src);
    for (let i = 0; i < N; i++) src[i] = ter[i] === TER.SEA || ter[i] === TER.RIVER ? 1 : 0;
    buildSat(k.sWater, src);
    for (let i = 0; i < N; i++) src[i] = ter[i] === TER.MOUNT ? 1 : 0;
    buildSat(k.sMount, src);
  }
  // 渋滞（§5.10）
  // part：0 は出かける量を足すだけ・1 は段を決めるだけ・無ければ両方（月の中で 2 つの tick に分ける。A4）
  function traffic(s, part) {
    const k = scratch(s), load = k.load, use = s.use, label = s.net.label, tr = s.traffic;
    if (part !== 1) trafficLoad(s, k);
    if (part !== 0) trafficLevels(s, k);
  }
  function trafficLoad(s, k) {
    const load = k.load, use = s.use, label = s.net.label;
    load.fill(0);
    for (let i = 0; i < N; i++) {
      const u = use[i];
      if (u < 5 || u > 8 || s.lvl[i] === 0) continue;
      let out = (peopleOf(s, i) + jobsOf(s, i)) * TRIP_RATE;
      if (out <= 0) continue;
      if (k.railNear[i]) out *= 0.5;
      const x = i % W, y = (i / W) | 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const ny = y + dy; if (ny < 0 || ny >= H) continue;
        for (let dx = -2; dx <= 2; dx++) { const nx = x + dx; if (nx >= 0 && nx < W && label[ny * W + nx] >= 0) n++; }
      }
      if (!n) continue;
      const a = out / n;
      for (let dy = -2; dy <= 2; dy++) {
        const ny = y + dy; if (ny < 0 || ny >= H) continue;
        for (let dx = -2; dx <= 2; dx++) { const nx = x + dx; if (nx >= 0 && nx < W && label[ny * W + nx] >= 0) load[ny * W + nx] += a; }
      }
    }
  }
  function trafficLevels(s, k) {
    const load = k.load, use = s.use, label = s.net.label, tr = s.traffic;
    let jamI = -1, jamV = 0, jamLv = 0;
    for (let i = 0; i < N; i++) {
      if (label[i] < 0) { if (tr[i]) { tr[i] = 0; touch(s, i); } continue; }
      const cap = use[i] === USE.CROSS ? CAP_CROSS : k.isX[i] ? CAP_X : CAP_ROAD;
      const v = load[i] / cap;
      const lv = v < 0.7 ? 0 : v < 1.0 ? 1 : v < 1.5 ? 2 : 3;
      if (tr[i] !== lv) { tr[i] = lv; touch(s, i); }
      if (v > jamV) { jamV = v; jamI = i; jamLv = lv; }
    }
    k.jamI = jamI; k.jamLv = jamLv; k.jamV = jamV;
    // 2 マス以内のいちばん悪い段（たて・よこに分けて最大をとる）
    const t8 = k.tmp8, jn = k.jamNear;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let m = 0;
      for (let dx = -2; dx <= 2; dx++) { const nx = x + dx; if (nx >= 0 && nx < W) { const v = tr[y * W + nx]; if (v > m) m = v; } }
      t8[y * W + x] = m;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let m = 0;
      for (let dy = -2; dy <= 2; dy++) { const ny = y + dy; if (ny >= 0 && ny < H) { const v = t8[ny * W + x]; if (v > m) m = v; } }
      jn[y * W + x] = m;
    }
  }
  // よごれ（§5.11）
  function pollution(s) {
    const k = scratch(s), emit = k.emit, red = k.red, nw = k.pollNew, p = s.poll;
    emit.fill(0); red.fill(0);
    for (let i = 0; i < N; i++) {
      const x = i % W, y = (i / W) | 0, b = (y >> 2) * PW + (x >> 2);
      const u = s.use[i], t = s.terrain[i];
      if (u === USE.WORK && s.lvl[i] > 0) emit[b] += s.lvl[i] * (s.kind[i] === 2 ? 1 : 3);
      if (isRoadUse(u)) { const tv = s.traffic[i]; if (tv === 2) emit[b] += 1; else if (tv === 3) emit[b] += 2; }
      if (u === USE.GREEN) red[b] += 1.5;
      else if (t === TER.FOREST) red[b] += 0.5;
      else if (t === TER.SEA || t === TER.RIVER) red[b] += 0.3;
    }
    for (let by = 0; by < PH; by++) for (let bx = 0; bx < PW; bx++) {
      const b = by * PW + bx;
      let nb = 0;
      if (bx > 0) nb += p[b - 1];
      if (bx < PW - 1) nb += p[b + 1];
      if (by > 0) nb += p[b - PW];
      if (by < PH - 1) nb += p[b + PW];
      nw[b] = clamp(0.7 * p[b] + 0.06 * nb + emit[b] - red[b], 0, 100);
    }
    for (let b = 0; b < NPOLL; b++) p[b] = Math.round(nw[b]);
  }
  const pollAt = (s, i) => s.poll[(((i / W) | 0) >> 2) * PW + ((i % W) >> 2)];
  function pollAvg(s) {
    // 町（建物のある区画）の平均。建物が無ければ地図全体
    let sum = 0, n = 0;
    for (let i = 0; i < N; i++) if (isZoneUse(s.use[i]) && s.lvl[i] > 0) { sum += pollAt(s, i); n++; }
    if (!n) { for (let b = 0; b < NPOLL; b++) sum += s.poll[b]; return sum / NPOLL; }
    return sum / n;
  }
  function sizeLand(pop) { return pop >= 30000 ? 15 : pop >= 10000 ? 10 : pop >= 1000 ? 5 : 0; }
  function sizeDens(pop) { return pop >= 10000 ? 10 : pop >= 1000 ? 5 : 0; }   // 約束の仮 し +15 → +10

  // マス 1 つの 地価・密度・すみやすさ（§5.5・§5.7）
  function evalFields(s, k, i) {
    const t = s.terrain[i];
    if (t === TER.SEA || t === TER.MOUNT) { s.land[i] = 0; s.dens[i] = 0; s.live[i] = 0; return; }
    const x = i % W, y = (i / W) | 0;
    const green3 = box(k.sGreen, x, y, 3), water2 = box(k.sWater, x, y, 2), mount4 = box(k.sMount, x, y, 4);
    const shop6 = box(k.sShop, x, y, 6), fac3 = box(k.sFac, x, y, 3), jam = k.jamNear[i], pl = pollAt(s, i);
    let v = 30 + Math.min(24, 6 * green3) + (water2 > 0 ? 15 : 0) + (mount4 > 0 ? 5 : 0) + (shop6 > 0 ? 10 : 0) + sizeLand(s.pop)
      - 0.6 * pl - Math.min(30, 10 * fac3) - 8 * jam;
    s.land[i] = clamp(Math.round(v), 0, 100);
    let d = DENS_BASE + (k.railNear[i] ? 35 : 0) + (box(k.sX, x, y, 2) > 0 ? DENS_X : 0) + Math.min(DENS_JOB_MAX, 5 * Math.floor(box(k.sJobs, x, y, 6) / DENS_JOB_STEP)) + sizeDens(s.pop);
    s.dens[i] = clamp(Math.round(d), 0, 100);
    if (s.use[i] !== USE.HOME) { s.live[i] = 0; return; }
    const z = s.net.zone[i], rc = z >= 0 ? s.net.comps[z].r : s.r;
    const fac2 = box(k.sFac, x, y, 2);
    let L = LIVE_BASE + Math.min(18, 3 * green3) + (water2 > 0 ? 8 : 0) + (shop6 > 0 ? 8 : 0) + (rc >= 0.8 ? 8 : -10) + TAX_LIVE[s.tax]
      - 0.5 * pl - 6 * jam - (fac2 > 0 ? 10 : 0) + (s.fest > 0 ? 10 : 0) - (k.railAdj[i] ? 3 : 0);
    s.live[i] = clamp(Math.round(L), 0, 100);
  }
  // すむ が小さくなった理由（いちばん大きいもの）
  function shrinkWhy(s, k, i) {
    if (!connected(s, i)) return "noroad";
    const z = s.net.zone[i], rc = z >= 0 ? s.net.comps[z].r : s.r;
    if (rc < 0.6) return "nojob";
    const x = i % W, y = (i / W) | 0;
    const f = [["smoke", 0.5 * pollAt(s, i)], ["jam", 6 * k.jamNear[i]], ["factory", box(k.sFac, x, y, 2) > 0 ? 10 : 0], ["tax", s.tax === 2 ? 8 : 0], ["nojob", rc < 0.8 ? 10 : 0]];
    let best = f[0];
    for (const e of f) if (e[1] > best[1]) best = e;
    return best[0];
  }
  // 区画のマス 1 つの 育つ・小さくなる（§5.3）
  function growCell(s, k, i, ev) {
    const u = s.use[i];
    if (u < 5 || u > 8) return;
    const lv = s.lvl[i];
    const x = i % W, y = (i / W) | 0;
    const conn = connected(s, i);
    const z = s.net.zone[i], rc = z >= 0 && s.net.comps[z] ? s.net.comps[z].r : s.r;
    let good = false, bad = !conn, inc = 0;
    if (conn) {
      if (u === USE.HOME) {
        good = s.live[i] >= 55 && rc >= 0.8;
        bad = s.live[i] < 35 || rc < 0.6;
      } else if (u === USE.WORK) {
        good = rc <= 1.25; bad = rc > 1.6;
      } else if (u === USE.SHOP) {
        const kd = s.kind[i] || 1;
        const tb = WORK[7][kd];
        inc = lv < 3 ? tb.jobs[lv + 1] - tb.jobs[lv] : 0;
        const pop8 = box(k.sPeople, x, y, 8), sj8 = box(k.sShopJobs, x, y, 8);
        good = rc <= 1.25 && pop8 >= 4 * (sj8 + inc);
        bad = lv > 0 && pop8 < 2 * sj8;
      } else {
        const nk = s.kind[i] || 1, pl = pollAt(s, i);
        let ok;
        if (nk === 1) ok = s.land[i] < 50 && pl < 50;
        else if (nk === 2) ok = box(k.sForest, x, y, 2) >= 4;
        else ok = seaPoll(s, x, y) < 40;
        good = ok && rc <= 1.25 && !(nk === 2 && lv >= 2 && box(k.sForest, x, y, 2) < 8);
        bad = !ok;
      }
    }
    // 建て替え（すむ：1 年続けて別の種類を指したとき）・ビル（おみせ lvl 3・地価 60 以上・し から）
    if (u === USE.HOME && lv > 0 && conn && !bad) {
      const want = homeKindOf(s.dens[i], s.land[i], s.rank);
      if (want !== s.kind[i]) {
        k.rekind[i]++;
        if (k.rekind[i] >= 12) {
          k.rekind[i] = 0;
          // 建て替え：lvl は 1 下がる。人が増えるときは 来る人 の分だけ（上限の抜け道にしない）
          const before = peopleOf(s, i);
          let nl = Math.max(1, lv - 1);
          while (nl > 1 && HOME[want].people[nl] - before > s.inflow) nl--;
          const gain = HOME[want].people[nl] - before;
          if (gain > s.inflow) return;
          if (gain > 0) s.inflow -= gain;
          s.kind[i] = want; s.lvl[i] = nl;
          touch(s, i);
          ev.push({ kind: "grow", i, use: u, bk: want, lvl: s.lvl[i] });
          return;
        }
      } else k.rekind[i] = 0;
    }
    if (good && lv < 3 && s.money >= 0) {
      if (rnd(s) < GROW_P) {
        let nk = s.kind[i];
        if (u === USE.HOME) {
          if (lv === 0) nk = homeKindOf(s.dens[i], s.land[i], s.rank);
          const need = HOME[nk].people[lv + 1] - (lv ? HOME[nk].people[lv] : 0);
          if (s.inflow < need) return;
          const pay = buildPayOf(s, u, nk, lv);
          if (pay > s.money) { k.waitMoney++; return; }
          s.inflow -= need;
          if (pay) { s.money -= pay; k.build += pay; }
        } else {
          if (u === USE.WORK && lv === 0) nk = s.rank >= 2 ? 2 : 1;
          else if (u === USE.SHOP && lv === 0) nk = 1;
          const pay = buildPayOf(s, u, nk || 1, lv);
          if (pay > s.money) { k.waitMoney++; return; }
          if (pay) { s.money -= pay; k.build += pay; }
        }
        s.kind[i] = nk; s.lvl[i] = lv + 1;
        touch(s, i);
        ev.push({ kind: "grow", i, use: u, bk: nk, lvl: lv + 1 });
      }
      return;
    }
    if (bad && lv > 0) {
      if (rnd(s) < SHRINK_P) {
        if (u === USE.HOME) { const w = shrinkWhy(s, k, i); k.leaveWhy[w] = (k.leaveWhy[w] || 0) + peopleOf(s, i); }
        s.lvl[i] = lv - 1;
        if (lv - 1 === 0 && u !== USE.NATURE) s.kind[i] = 0;
        touch(s, i);
        ev.push({ kind: "shrink", i, use: u, lvl: lv - 1 });
      }
      return;
    }
    // ビル（おみせ lvl 3・地価 60 以上・し から）
    if (u === USE.SHOP && lv === 3 && s.kind[i] === 1 && s.rank >= 2 && s.land[i] >= 60 && good) {
      s.kind[i] = 2; s.lvl[i] = 1;
      touch(s, i);
      ev.push({ kind: "grow", i, use: u, bk: 2, lvl: 1 });
    }
  }
  // 1 段から上へ育つときに払うお金（すむ は人、しごと・おみせ・めぐみ は仕事のふえる数 × BUILD_PAY。0 → 1 段は ただ）
  const payUnit = (s) => (s.rank >= 1 ? BUILD_PAY + (s.pop | 0) * BUILD_PAY_RATE : 0);
  function buildPayOf(s, u, kd, lv) {
    if (lv < 1 || lv >= 3 || !(s.rank >= 1)) return 0;
    let n = 0;
    if (u === USE.HOME) { const h = HOME[kd]; n = h ? h.people[lv + 1] - h.people[lv] : 0; }
    else { const t = WORK[u] && WORK[u][kd]; n = t ? t.jobs[lv + 1] - t.jobs[lv] : 0; }
    return Math.round(n * payUnit(s));
  }
  function seaPoll(s, x, y) {
    let m = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const t = s.terrain[ny * W + nx];
      if (t === TER.SEA || t === TER.BEACH) { const v = s.poll[(ny >> 2) * PW + (nx >> 2)]; if (v > m) m = v; }
    }
    return Math.max(m, s.poll[(y >> 2) * PW + (x >> 2)]);
  }
  function touch(s, i) {
    if (!Array.isArray(s.dirty)) s.dirty = [];
    if (s.dirty.length <= N) s.dirty.push(i);
    s.gen = (s.gen | 0) + 1;
  }

  // チャンクの順番（決まった並べかえ。月ごとに始めをずらす）
  const ORDER = (function () {
    const o = []; for (let c = 0; c < NCHUNK; c++) o.push(c);
    const R = rngFrom(12345);
    for (let a = NCHUNK - 1; a > 0; a--) { const b = Math.floor(R() * (a + 1)); const t = o[a]; o[a] = o[b]; o[b] = t; }
    return Object.freeze(o);
  })();
  function evalChunk(s, k, c, ev) {
    const cx = c % CW, cy = (c / CW) | 0;
    const y0 = cy * CHUNK, y1 = Math.min(H, y0 + CHUNK), x0 = cx * CHUNK, x1 = x0 + CHUNK;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) evalFields(s, k, y * W + x);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) growCell(s, k, y * W + x, ev);
  }

  // ---------------------------------------------------------------- 町の ほし（§5.7）
  function starOf(s) {
    let sum = 0, w = 0;
    for (let i = 0; i < N; i++) {
      if (s.use[i] !== USE.HOME || !s.lvl[i]) continue;
      const p = peopleOf(s, i);
      sum += s.live[i] * p; w += p;
    }
    if (!w) return 3;
    const a = sum / w;
    return a < 30 ? 1 : a < 45 ? 2 : a < 60 ? 3 : a < 75 ? 4 : 5;
  }
  function liveAvg(s) {
    let sum = 0, w = 0;
    for (let i = 0; i < N; i++) { if (s.use[i] !== USE.HOME || !s.lvl[i]) continue; const p = peopleOf(s, i); sum += s.live[i] * p; w += p; }
    return w ? sum / w : null;
  }

  // ---------------------------------------------------------------- 市民の声（§5.18）
  const VOICES = Object.freeze({
    jam: "みちが こんで かよえないなあ",
    nojob: "しごとが ないんだ",
    noworker: "はたらく ひとが たりないよ",
    smoke: "こうばの けむりが くさいなあ",
    noshop: "ちかくに おみせが あると うれしいな",
    nogreen: "こうえんで あそびたいな",
    money: "まちの おさいふが からっぽ みたい",
    tax: "ぜいきんが ちょっと たかいなあ",
    noroad: "いりぐちまで みちが つながって いないよ",
    happy: "この まち すきだな",
    happyGreen: "こうえんが できて うれしい"
  });
  const VOICE_COOL = 3;
  function findCell(s, from, test) {
    for (let a = 0; a < N; a++) { const i = (from + a) % N; if (test(i)) return i; }
    return -1;
  }
  function voiceOf(s) {
    try {
      if (!okState(s)) return null;
      const k = scratch(s);
      if (!k.ready) recalc(s);
      const at = s.voiceAt || {};
      const free = (why) => !(isNum(at[why]) && s.month - at[why] < VOICE_COOL);
      const from = Math.abs((s.month | 0) * 977) % N;
      const mk = (why, i, good, text) => ({ why, i, good: !!good, text: text || VOICES[why] });
      if (s.money < 0 && free("money")) return mk("money", -1, false);
      if (k.jamLv >= 2 && k.jamI >= 0 && free("jam")) return mk("jam", k.jamI, false);
      if (free("noroad")) {
        const i = findCell(s, from, (j) => isZoneUse(s.use[j]) && !connected(s, j));
        if (i >= 0) return mk("noroad", i, false);
      }
      if (free("smoke")) {
        let bi = -1, bv = 39;
        for (let i = 0; i < N; i++) if (s.use[i] === USE.HOME && s.lvl[i] > 0) { const v = pollAt(s, i); if (v > bv) { bv = v; bi = i; } }
        if (bi >= 0) return mk("smoke", bi, false);
      }
      if (s.pop >= 20 && s.r < 0.8 && free("nojob")) {
        const i = findCell(s, from, (j) => s.use[j] === USE.HOME && s.lvl[j] > 0);
        return mk("nojob", i, false);
      }
      if (s.jobs >= 20 && s.r > 1.25 && free("noworker")) {
        const i = findCell(s, from, (j) => (s.use[j] === USE.WORK || s.use[j] === USE.SHOP) && s.lvl[j] < 3 && connected(s, j));
        return mk("noworker", i, false);
      }
      if (s.pop >= 50 && free("noshop")) {
        let homes = 0, far = 0, fi = -1;
        for (let a = 0; a < N; a++) {
          const i = (from + a) % N;
          if (s.use[i] !== USE.HOME || !s.lvl[i]) continue;
          homes++;
          if (box(k.sShop, i % W, (i / W) | 0, 6) === 0) { far++; if (fi < 0) fi = i; }
        }
        if (homes && far * 2 > homes) return mk("noshop", fi, false);
      }
      if (free("nogreen")) {
        const i = findCell(s, from, (j) => s.use[j] === USE.HOME && s.lvl[j] > 0 && s.live[j] < 45 && box(k.sGreen, j % W, (j / W) | 0, 3) === 0);
        if (i >= 0) return mk("nogreen", i, false);
      }
      if ((s.taxHigh | 0) >= 6 && free("tax")) return mk("tax", -1, false);
      if (free("happy") && s.pop > 0) {
        const i = findCell(s, from, (j) => s.use[j] === USE.HOME && s.lvl[j] > 0 && s.live[j] >= 75);
        if (i >= 0) {
          const g = box(k.sGreen, i % W, (i / W) | 0, 3) > 0;
          return mk("happy", i, true, g ? VOICES.happyGreen : VOICES.happy);
        }
        if (s.fest > 0) { const j = findCell(s, from, (q) => s.use[q] === USE.HOME && s.lvl[q] > 0); return mk("happy", j, true, "おまつり たのしいな"); }
      }
      return null;
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- 理由の言葉（§5.7 の星を押したとき・しらべる）
  const REASON_TEXT = Object.freeze({
    smoke: "こうばの よごれ", jam: "こんざつ", factory: "こうばが ちかい", nojob: "しごとが たりない", tax: "ぜいが たかい",
    noshop: "おみせが とおい", nogreen: "みどりが すくない", noroad: "いりぐちと つながって いない", money: "おかねが たりない"
  });
  function starReasons(s) {
    try {
      if (!okState(s)) return [];
      const k = scratch(s);
      if (!k.ready) recalc(s);
      const sum = { smoke: 0, jam: 0, factory: 0, nojob: 0, tax: 0, noshop: 0, nogreen: 0 };
      let any = false;
      for (let i = 0; i < N; i++) {
        if (s.use[i] !== USE.HOME || !s.lvl[i]) continue;
        const p = peopleOf(s, i); any = true;
        const x = i % W, y = (i / W) | 0;
        const z = s.net.zone[i], rc = z >= 0 ? s.net.comps[z].r : s.r;
        sum.smoke += p * 0.5 * pollAt(s, i);
        sum.jam += p * 6 * k.jamNear[i];
        sum.factory += p * (box(k.sFac, x, y, 2) > 0 ? 10 : 0);
        sum.nojob += p * (rc < 0.8 ? 18 : 0);
        sum.tax += p * (s.tax === 2 ? 8 : 0);
        sum.noshop += p * (box(k.sShop, x, y, 6) > 0 ? 0 : 8);
        sum.nogreen += p * Math.max(0, 9 - 3 * box(k.sGreen, x, y, 3));
      }
      if (!any) return [];
      return Object.entries(sum).filter((e) => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map((e) => REASON_TEXT[e[0]]);
    } catch (e) { return []; }
  }

  // ---------------------------------------------------------------- できごと（§5.12）
  function eventsTick(s, k, ev) {
    const E = s.ev;
    // 続いているできごとを 1 か月進める
    for (let a = E.active.length - 1; a >= 0; a--) {
      const e = E.active[a];
      e.left--;
      if (e.left <= 0) {
        E.active.splice(a, 1);
        if (e.kind === "rain") { for (const i of e.cells) if (i >= 0 && i < N && s.blocked[i]) { s.blocked[i] = 0; touch(s, i); } k.netDirty = true; }
        ev.push({ kind: "eventEnd", ev: e.kind });
      }
    }
    s.harvest = false;
    s.fest = Math.max(0, (s.fest | 0) - 1);
    if (!E.active.some((e) => e.kind === "rain")) for (let i = 0; i < N; i++) if (s.blocked[i]) { s.blocked[i] = 0; touch(s, i); k.netDirty = true; }
    if (E.cool > 0) { E.cool--; return; }
    if (s.pop < EVENT_MIN_POP) return;
    if (rnd(s) >= EVENT_RATE) return;
    // 起きられる種類
    const can = [];
    let roadRiver = false, buildings = k.built | 0;
    for (let i = 0; i < N && !roadRiver; i++) if ((s.use[i] === USE.ROAD) && nearRiver(s, i)) roadRiver = true;
    const hasSeaMount = (() => { for (let i = 0; i < N; i++) if (s.terrain[i] === TER.SEA || s.terrain[i] === TER.MOUNT) return true; return false; })();
    for (const e of EVENTS) {
      if (e.bad && s.month < EVENT_BAD_FROM) continue;
      if (e.kind === "harvest" && (k.nature | 0) < 5) continue;
      if (e.kind === "tourist" && !(s.star >= 3 && hasSeaMount)) continue;
      if (e.kind === "rain" && !roadRiver) continue;
      if (e.kind === "fire" && buildings < 20) continue;
      can.push(e);
    }
    if (!can.length) return;
    let tw = 0; for (const e of can) tw += e.weight;
    let r = rnd(s) * tw, pick = can[0];
    for (const e of can) { r -= e.weight; if (r < 0) { pick = e; break; } }
    startEvent(s, k, pick.kind, ev);
  }
  function nearRiver(s, i) {
    if (s.terrain[i] === TER.RIVER) return true;
    const x = i % W;
    return (x > 0 && s.terrain[i - 1] === TER.RIVER) || (x < W - 1 && s.terrain[i + 1] === TER.RIVER)
      || (i >= W && s.terrain[i - W] === TER.RIVER) || (i + W < N && s.terrain[i + W] === TER.RIVER);
  }
  function startEvent(s, k, kind, ev) {
    const def = EVENTS.find((e) => e.kind === kind);
    if (!def) return false;
    const E = s.ev;
    const cells = [];
    let text = def.text;
    if (kind === "festival") { s.fest = 2; }
    else if (kind === "harvest") { s.harvest = true; if ((k.fish | 0) * 2 >= (k.nature | 0)) text = def.textFish; }
    else if (kind === "tourist") { s.money = clamp(Math.round(s.money + s.pop * TOURIST_RATE), MONEY_MIN, MONEY_MAX); }
    else if (kind === "rain") {
      const from = Math.floor(rnd(s) * N);
      for (let a = 0; a < N && cells.length < RAIN_CELLS; a++) {
        const i = (from + a) % N;
        if (s.use[i] === USE.ROAD && nearRiver(s, i)) { cells.push(i); s.blocked[i] = 1; touch(s, i); }
      }
      if (!cells.length) return false;
      k.netDirty = true;
    } else if (kind === "fire") {
      const cand = [];
      for (let i = 0; i < N; i++) if ((s.use[i] >= 5 && s.use[i] <= 7) && s.lvl[i] > 0) cand.push(i);
      if (!cand.length) return false;
      const nearF = cand.filter((i) => box(k.sFac, i % W, (i / W) | 0, 2) > 0 && s.use[i] !== USE.WORK);
      const pool = nearF.length ? nearF : cand;
      let i = pool[Math.floor(rnd(s) * pool.length)];
      cells.push(i);
      while (cells.length < FIRE_MAX) {
        const x = i % W, y = (i / W) | 0;
        if (box(k.sGreen, x, y, 2) > 0 || box(k.sWater, x, y, 2) > 0) break;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W].filter((n) => n >= 0 && n < N && s.use[n] >= 5 && s.use[n] <= 7 && s.lvl[n] > 0 && !cells.includes(n));
        if (!nb.length) break;
        i = nb[Math.floor(rnd(s) * nb.length)];
        cells.push(i);
      }
      for (const c of cells) { s.lvl[c] = 0; s.kind[c] = 0; touch(s, c); ev.push({ kind: "shrink", i: c, use: s.use[c], lvl: 0 }); }
      k.needTally = true;
    }
    if (def.bad) E.lastBad = s.month;
    E.cool = EVENT_COOL;
    if (def.months > 0 && kind !== "tourist") E.active.push({ kind, left: def.months, cells: cells.slice() });
    ev.push({ kind: "event", ev: kind, cells, text, good: !def.bad });
    return true;
  }

  // ---------------------------------------------------------------- 1 か月の終わり
  function newsOk(s, why, gap) { const a = s.newsAt || (s.newsAt = {}); if (isNum(a[why]) && s.month - a[why] < gap) return false; a[why] = s.month; return true; }
  // 月の終わりの重い計算は、月の中の別々の tick に分けて回す（1 回の重さを下げる。技術レビュー A4）：
  //   tick 10 渋滞の出かける量・11 合計の表の後半・12 渋滞の段・13 よごれ・14 合計の表の前半・15 の終わり monthEnd（お金・できごと・節目・知らせ）・
  //   次の月の tick 0 市民の声（voiceOf）
  const PHASE_LOAD = 10, PHASE_SATS2 = 11, PHASE_TRAFFIC = 12, PHASE_POLL = 13, PHASE_SATS = 14;
  function monthEnd(s, k, ev) {
    if (k.netDirty) buildNet(s);
    tally(s);
    // お金（§5.6）
    const jobsTax = (s.jobs - k.natureJobs) * JOB_TAX + k.natureJobs * NATURE_TAX * (s.harvest ? 2 : 1);
    const income = Math.round((k.taxSum + jobsTax) * TAX_MUL[s.tax]);
    // 維持費：払えない分は待ってもらう（お金は月の計算でマイナスにならない。0 から動けなくなる行き止まりを作らない。数値合わせで足した）
    const service = Math.round(s.pop * SERVICE[s.rank] || 0);
    const want = k.upkeep + service;
    const cost = s.money >= 0 ? Math.max(0, Math.min(want, income + s.money)) : 0;
    const build = k.build | 0, waitMoney = k.waitMoney | 0;
    k.build = 0; k.waitMoney = 0;
    s.money = clamp(s.money + income - cost, MONEY_MIN, MONEY_MAX);
    // おかねが ふえない・いちばん安い物も置けない：人口 0 のときだけ「まちの ほじょきん」（技術レビュー M1。行き止まりを作らない）
    let subsidy = 0, broke = false;
    if (s.money < CHEAPEST && income - want <= 0) {
      broke = true;
      if (s.pop === 0) { subsidy = SUBSIDY; s.money = clamp(s.money + subsidy, MONEY_MIN, MONEY_MAX); }
    }
    s.income = income; s.cost = cost; s.build = build; s.service = service;
    s.month = Math.min(MONTH_MAX, s.month + 1);
    s.taxHigh = s.tax === 2 ? (s.taxHigh | 0) + 1 : 0;
    ev.push({ kind: "month", year: Math.floor(s.month / 12) + 1, month: ((s.month + 3) % 12) + 1 });
    ev.push({ kind: "money", income, cost, delta: income - cost + subsidy - build, subsidy, build, service });
    // できごと
    eventsTick(s, k, ev);
    // かじ で建物が消えたら人口を数え直す（数え直さないと s.pop が読み込み直したときの数とずれる）
    if (k.netDirty || k.needTally) { if (k.netDirty) buildNet(s); tally(s); k.needTally = false; }
    // 節目・ベスト
    let newsDone = false;
    if (broke) {
      const text = subsidy ? TIP_SUBSIDY : TIP_BROKE;
      ev.push({ kind: "tip", key: "broke", amount: subsidy, text });
      if (newsOk(s, "broke", 6)) { ev.push({ kind: "news", text, why: "broke" }); newsDone = true; }
    }
    while (s.rank < RANKS.length - 1 && s.pop >= RANKS[s.rank + 1].pop) {
      s.rank++;
      const R = RANKS[s.rank];
      s.money = clamp(s.money + R.bonus, MONEY_MIN, MONEY_MAX);
      ev.push({ kind: "rank", rank: s.rank, name: R.name, bonus: R.bonus, unlocks: R.unlocks.slice() });
      newsDone = true;
    }
    if (s.pop > (s.bestSeen | 0)) { s.bestSeen = s.pop; ev.push({ kind: "best", pop: s.bestPop }); }
    // 人が減った
    const prev = s.prevPop | 0;
    if (prev >= 30 && s.pop < prev * 0.97) {
      let why = "smoke", wv = -1;
      for (const w in k.leaveWhy) if (k.leaveWhy[w] > wv) { wv = k.leaveWhy[w]; why = w; }
      const LEAVE = { smoke: "よごれで ひとが ひっこしたよ", jam: "こんざつで ひとが ひっこしたよ", nojob: "しごとが なくて ひとが ひっこしたよ",
        noroad: "みちが とぎれて ひとが ひっこしたよ", factory: "こうばが ちかくて ひとが ひっこしたよ", tax: "ぜいが たかくて ひとが ひっこしたよ" };
      ev.push({ kind: "leave", why });
      if (!newsDone) { ev.push({ kind: "news", text: LEAVE[why], why: "leave" }); newsDone = true; }
    }
    for (const w in k.leaveWhy) k.leaveWhy[w] = 0;
    s.prevPop = s.pop;
    s.star = starOf(s);
    // 知らせ（1 か月に 1 つまで）
    if (!newsDone) {
      const pa = pollAvg(s);
      if (s.money < 0 && newsOk(s, "money", 3)) ev.push({ kind: "news", text: "おかねが たりないよ。みちを へらすか、ぜいを あげてみよう", why: "money" });
      else if (pa > 30 && newsOk(s, "smoke", 6)) ev.push({ kind: "news", text: "くうきが よごれて きたよ。みどりを ふやそう", why: "smoke" });
      else if (k.jamLv >= 2 && newsOk(s, "jam", 6)) ev.push({ kind: "news", text: "みちが こんで きたよ。こうさてんを へらすか、みちを ふやそう", why: "jam" });
      else if (hasUnconnected(s) && newsOk(s, "noroad", 6)) ev.push({ kind: "news", text: "いりぐちと つながって いないよ", why: "noroad" });
      else if (waitMoney >= 3 && newsOk(s, "build", 6)) ev.push({ kind: "news", text: TIP_BUILD, why: "build" });
      else if (s.rank >= 1 && s.tax > 0 && s.money >= RICH_MONEY && newsOk(s, "rich", 12)) ev.push({ kind: "news", text: TIP_RICH, why: "rich" });
      else if (s.pop >= 20 && s.r < 0.8 && newsOk(s, "nojob", 6)) ev.push({ kind: "news", text: "しごとが たりないよ", why: "nojob" });
      else if (s.jobs >= 20 && s.r > 1.25 && newsOk(s, "noworker", 6)) ev.push({ kind: "news", text: "はたらく ひとが たりないよ", why: "noworker" });
      else if (s.rank < RANKS.length - 1 && s.pop > 0 && newsOk(s, "goal", 6)) {
        const R = RANKS[s.rank + 1];
        ev.push({ kind: "news", text: R.name + "まで あと " + formatPop(R.pop - s.pop) + " にん", why: "goal" });
      }
    }
    if (k.jamLv >= 2 && k.jamI >= 0) ev.push({ kind: "jam", i: k.jamI, level: k.jamLv });
    // 市民の声は次の tick（次の月の tick 0）で出す（A4）
    k.voicePending = true;
    // 来たい人（§5.3 の上限）
    const cap = (GROW_BASE + GROW_RATE * s.pop) * STAR_MUL[s.star] * (s.fest > 0 ? 1.5 : 1) * TAX_INFLOW[s.tax];
    s.inflow = Math.min((s.inflow || 0) + cap, cap * INFLOW_KEEP);
  }
  function hasUnconnected(s) { for (let i = 0; i < N; i++) if (isZoneUse(s.use[i]) && !connected(s, i)) return true; return false; }

  // 1 tick（0.25 秒ぶん）
  function tickOnce(s, k, ev) {
    if (k.netDirty) buildNet(s);
    const t = s.tick % TICKS_PER_MONTH;
    const off = (s.month * 13) % NCHUNK;
    for (let a = 0; a < CHUNKS_PER_TICK; a++) evalChunk(s, k, ORDER[(off + t * CHUNKS_PER_TICK + a) % NCHUNK], ev);
    if (t === 0 && k.voicePending) {
      k.voicePending = false;
      const v = voiceOf(s);
      if (v) { (s.voiceAt || (s.voiceAt = {}))[v.why] = s.month; ev.push({ kind: "voice", why: v.why, i: v.i, good: v.good, text: v.text }); }
    } else if (t === PHASE_LOAD) traffic(s, 0);
    else if (t === PHASE_TRAFFIC) traffic(s, 1);
    else if (t === PHASE_POLL) pollution(s);
    else if (t === PHASE_SATS) buildSats(s, 0);
    else if (t === PHASE_SATS2) buildSats(s, 1);
    s.tick++;
    if (s.tick % TICKS_PER_MONTH === 0) monthEnd(s, k, ev);
  }

  // ---------------------------------------------------------------- 公開する関数
  function okState(s) {
    return isObj(s) && s.terrain instanceof Uint8Array && s.terrain.length === N && s.use instanceof Uint8Array && s.use.length === N
      && s.kind instanceof Uint8Array && s.lvl instanceof Uint8Array && s.poll instanceof Uint8Array && s.poll.length === NPOLL;
  }
  function blank(seed, choice, name) {
    return {
      v: SAVE_VERSION, seed, choice, name: normalizeName(name), W, H,
      terrain: new Uint8Array(N), use: new Uint8Array(N), kind: new Uint8Array(N), lvl: new Uint8Array(N),
      land: new Uint8Array(N), dens: new Uint8Array(N), live: new Uint8Array(N), traffic: new Uint8Array(N),
      poll: new Uint8Array(NPOLL), blocked: new Uint8Array(N), placedAt: {}, entry: [],
      money: START_MONEY, month: 0, acc: 0, tick: 0, speed: 1, tax: 1,
      pop: 0, workers: 0, jobs: 0, r: 1, star: 3, rank: 0, bestPop: 0,
      net: { gen: 0, label: new Int32Array(N), comps: [], zone: new Int32Array(N) },
      ev: { cool: 0, active: [], lastBad: -1 },
      rng: hash2(seed, choice + 77) | 0, dirty: [], gen: 0,
      clock: 0, build: 0, service: 0, inflow: GROW_BASE, voiceAt: {}, newsAt: {}, taxHigh: 0, prevPop: 0, bestSeen: 0, fest: 0, harvest: false, income: 0, cost: 0
    };
  }
  // 計算し直し（新しく始めた・読み込んだ・テストで手で組んだあと）
  function recalc(s) {
    if (!okState(s)) return null;
    for (const f of ["land", "dens", "live", "traffic", "blocked"]) if (!(s[f] instanceof Uint8Array) || s[f].length !== N) s[f] = new Uint8Array(N);
    if (!isObj(s.placedAt)) s.placedAt = {};
    if (!isObj(s.ev) || !Array.isArray(s.ev.active)) s.ev = { cool: 0, active: [], lastBad: -1 };
    if (!Array.isArray(s.dirty)) s.dirty = [];
    const k = scratch(s);
    buildNet(s);
    tally(s);
    buildSats(s);
    traffic(s);
    for (let i = 0; i < N; i++) evalFields(s, k, i);
    s.star = starOf(s);
    if (!isNum(s.inflow)) s.inflow = GROW_BASE;
    if (!isNum(s.prevPop)) s.prevPop = s.pop;
    if (!isNum(s.bestSeen)) s.bestSeen = s.pop;
    k.ready = true;
    return s;
  }
  function newGame(seed, choice, name) {
    try {
      const sd = isNum(seed) ? Math.floor(seed) | 0 : 1;
      const ch = isInt(choice) && choice >= 0 && choice <= 2 ? choice : 0;
      const s = blank(sd, ch, name);
      const g = genTerrain(sd, ch);
      s.terrain = g.terrain;
      s.entry = g.entry;
      for (const e of g.entry) s.use[e.y * W + e.x] = USE.ENTRY;
      recalc(s);
      s.prevPop = 0; s.bestSeen = 0;
      for (let i = 0; i < N; i++) s.dirty.push(i);
      return s;
    } catch (e) { return null; }
  }
  function step(s, dt) {
    const events = [];
    try {
      if (!okState(s)) return { state: s, events };
      if (!SPEEDS.includes(s.speed) || s.speed === 0) return { state: s, events };
      const d = isNum(dt) ? clamp(dt, 0, DT_MAX) : 0;
      if (d <= 0) return { state: s, events };
      const k = scratch(s);
      if (!k.ready) recalc(s);
      s.clock = (s.clock || 0) + d;
      s.acc = (isNum(s.acc) ? s.acc : 0) + d * s.speed;
      let n = 0;
      while (s.acc >= TICK_SEC - 1e-9 && n < 8) { s.acc -= TICK_SEC; tickOnce(s, k, events); n++; }
      if (s.acc < 0) s.acc = 0;
      if (s.acc > TICK_SEC) s.acc = TICK_SEC;
    } catch (e) { /* 落ちない */ }
    return { state: s, events };
  }
  function canPlace(s, tool, x, y) {
    try {
      const T = TOOL[tool];
      if (!okState(s) || !T || !inMap(x, y)) return { ok: false, cost: 0, reason: "terrain" };
      const i = y * W + x, t = s.terrain[i], u = s.use[i];
      if (tool === "erase") {
        if (u === USE.ENTRY) return { ok: false, cost: 0, reason: "entry" };
        if (u === USE.NONE) return { ok: false, cost: 0, reason: "empty" };
        const pa = s.placedAt && s.placedAt[i];
        if (pa && isNum(pa.t) && (s.clock || 0) - pa.t <= UNDO_SEC) return { ok: true, cost: -pa.cost, reason: null, undo: true };
        const ec = T.cost + (isZoneUse(u) ? ERASE_LVL * s.lvl[i] : 0);
        // お金が足りない（マイナスも）ときは ただで こわせる（借金を深くしない・行き止まりを作らない。技術レビュー M1）
        if (s.money < ec) return { ok: true, cost: 0, reason: null, free: true };
        return { ok: true, cost: ec, reason: null };
      }
      if (T.rank > s.rank) return { ok: false, cost: 0, reason: "rank" };
      if (u === USE.ENTRY) return { ok: false, cost: 0, reason: "entry" };
      let cost = T.cost;
      const line = tool === "road" || tool === "rail";
      if (t === TER.SEA || t === TER.MOUNT) return { ok: false, cost: 0, reason: "terrain" };
      if (t === TER.RIVER) { if (!line) return { ok: false, cost: 0, reason: "terrain" }; cost = T.bridgeCost; }
      if (u !== USE.NONE && !((tool === "road" && u === USE.RAIL) || (tool === "rail" && u === USE.ROAD))) return { ok: false, cost: 0, reason: "occupied" };
      if (s.money < 0 || s.money < cost) return { ok: false, cost, reason: "money" };
      const r = { ok: true, cost, reason: null };
      if (tool === "nature") r.natureKind = natureKindAt(s, x, y);
      return r;
    } catch (e) { return { ok: false, cost: 0, reason: "terrain" }; }
  }
  function place(s, tool, cells) {
    const events = [];
    const res = { placed: 0, cost: 0, events };
    try {
      if (!okState(s) || !TOOL[tool] || !Array.isArray(cells)) return res;
      const k = scratch(s);
      if (!k.ready) recalc(s);
      const line = tool === "road" || tool === "rail";
      const seen = new Set();
      const done = [];
      let denyMoney = 0, denyOther = 0, firstReason = null, net = false;
      for (const c of cells) {
        if (!isInt(c) || c < 0 || c >= N || seen.has(c)) continue;
        seen.add(c);
        const x = c % W, y = (c / W) | 0;
        const r = canPlace(s, tool, x, y);
        if (!r.ok) {
          if (r.reason === "money") denyMoney++;
          else { denyOther++; if (!firstReason) firstReason = r.reason; }
          continue;
        }
        const u = s.use[c];
        if (tool === "erase") {
          if (isRoadUse(u) || isRailUse(u) || isZoneUse(u)) net = true;
          const pa = r.undo ? s.placedAt[c] : null;
          if (pa) {
            // 5 秒の取り消し：置いたものだけを、置く前の形に戻す（ふみきり → せんろ／みち、もり → もり。技術レビュー A9）
            const pu = isInt(pa.u) && pa.u >= 0 && pa.u <= 8 ? pa.u : 0;
            s.use[c] = pu;
            s.kind[c] = isZoneUse(pu) && isInt(pa.kd) ? pa.kd : 0;
            s.lvl[c] = isZoneUse(pu) && isInt(pa.lv) ? pa.lv : 0;
            if (isInt(pa.ter) && pa.ter >= 0 && pa.ter <= 5) s.terrain[c] = pa.ter;
            s.blocked[c] = 0;
            if (pa.prev && isObj(pa.prev)) s.placedAt[c] = pa.prev; else delete s.placedAt[c];
            if (isRoadUse(pu) || isRailUse(pu)) net = true;
          } else {
            s.use[c] = 0; s.kind[c] = 0; s.lvl[c] = 0; s.blocked[c] = 0;
            delete s.placedAt[c];
          }
          k.rekind[c] = 0;
        } else {
          const T = TOOL[tool];
          const terBefore = s.terrain[c], kdBefore = s.kind[c], lvBefore = s.lvl[c];
          if (tool === "road") s.use[c] = u === USE.RAIL ? USE.CROSS : USE.ROAD;
          else if (tool === "rail") s.use[c] = u === USE.ROAD ? USE.CROSS : USE.RAIL;
          else { s.use[c] = T.use; s.kind[c] = tool === "nature" ? r.natureKind : 0; s.lvl[c] = 0; }
          if (s.terrain[c] === TER.FOREST && tool !== "nature") s.terrain[c] = TER.FLAT;
          if (line || isZoneUse(s.use[c])) net = true;
          // 取り消し用に、置く前の形を持つ（5 秒以内に置いた物の上に重ねたときは、その前の記録も prev に残す）
          const old = s.placedAt[c];
          const rec = { t: s.clock || 0, cost: r.cost, u, ter: terBefore, kd: kdBefore, lv: lvBefore };
          if (old && isNum(old.t) && (s.clock || 0) - old.t <= UNDO_SEC) rec.prev = old;
          s.placedAt[c] = rec;
          k.rekind[c] = 0;
        }
        s.money = clamp(s.money - r.cost, MONEY_MIN, MONEY_MAX);
        res.cost += r.cost;
        done.push(c);
        touch(s, c);
      }
      res.placed = done.length;
      if (done.length) {
        if (net) buildNet(s);
        for (const c of done) evalFields(s, k, c);
        events.push(tool === "erase" ? { kind: "erase", cells: done } : { kind: "place", tool, cells: done });
      }
      if (denyMoney) events.push({ kind: "deny", reason: "money", count: denyMoney });
      else if (!done.length && denyOther) events.push({ kind: "deny", reason: firstReason, count: denyOther });
    } catch (e) { /* 落ちない */ }
    return res;
  }
  function lineCells(x0, y0, x1, y1) {
    if (![x0, y0, x1, y1].every(isNum)) return [];
    x0 = clamp(Math.round(x0), 0, W - 1); y0 = clamp(Math.round(y0), 0, H - 1);
    x1 = clamp(Math.round(x1), 0, W - 1); y1 = clamp(Math.round(y1), 0, H - 1);
    const out = [];
    if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) { const d = Math.sign(x1 - x0) || 1; for (let x = x0; ; x += d) { out.push(y0 * W + x); if (x === x1) break; } }
    else { const d = Math.sign(y1 - y0); for (let y = y0; ; y += d) { out.push(y * W + x0); if (y === y1) break; } }
    return out;
  }
  function rectCells(x0, y0, x1, y1) {
    if (![x0, y0, x1, y1].every(isNum)) return [];
    x0 = clamp(Math.round(x0), 0, W - 1); y0 = clamp(Math.round(y0), 0, H - 1);
    x1 = clamp(Math.round(x1), 0, W - 1); y1 = clamp(Math.round(y1), 0, H - 1);
    const dx = Math.sign(x1 - x0) || 1, dy = Math.sign(y1 - y0) || 1;
    const nx = Math.min(8, Math.abs(x1 - x0) + 1), ny = Math.min(8, Math.abs(y1 - y0) + 1);
    const out = [];
    for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) out.push((y0 + b * dy) * W + x0 + a * dx);
    return out;
  }
  function inspect(s, x, y) {
    try {
      if (!okState(s) || !inMap(x, y)) return null;
      const k = scratch(s);
      if (!k.ready) recalc(s);
      const i = y * W + x, u = s.use[i];
      const reasons = [];
      const lv = s.lvl[i];
      if (isZoneUse(u)) {
        const z = s.net.zone[i], rc = z >= 0 ? s.net.comps[z].r : s.r;
        if (z < 0) reasons.push("みちが とおい（2 マス いないに みちが いるよ）");
        else if (!connected(s, i)) reasons.push("いりぐちと つながって いないよ");
        if (s.money < 0) reasons.push("おかねが たりないよ");
        else if (lv >= 1 && lv < 3 && s.money < buildPayOf(s, u, s.kind[i] || 1, lv)) reasons.push("おおきく なるのに おかねが たりないよ（" + buildPayOf(s, u, s.kind[i] || 1, lv) + "）");
        if (u === USE.HOME) {
          if (s.live[i] < 55) reasons.push("すみやすさが ひくいよ");
          if (rc < 0.8) reasons.push("しごとが たりないよ");
          if (pollAt(s, i) >= 40) reasons.push("くうきが よごれて いるよ");
          if (k.jamNear[i] >= 2) reasons.push("みちが こんで いるよ");
        } else if (u === USE.WORK || u === USE.SHOP) {
          if (rc > 1.25) reasons.push("はたらく ひとが たりないよ");
          if (u === USE.SHOP) {
            const kd = s.kind[i] || 1, tb = WORK[7][kd], inc = lv < 3 ? tb.jobs[lv + 1] - tb.jobs[lv] : 0;
            if (box(k.sPeople, x, y, 8) < 4 * (box(k.sShopJobs, x, y, 8) + inc)) reasons.push("ちかくに すむ ひとが すくないよ");
          }
        } else if (u === USE.NATURE) {
          const nk = s.kind[i] || 1;
          if (nk === 1 && s.land[i] >= 50) reasons.push("まちが ちかくて はたけに むかないよ");
          if (nk === 1 && pollAt(s, i) >= 50) reasons.push("くうきが よごれて いるよ");
          if (nk === 2 && box(k.sForest, x, y, 2) < (lv >= 2 ? 8 : 4)) reasons.push("ちかくの もりが すくないよ");
          if (nk === 3 && seaPoll(s, x, y) >= 40) reasons.push("うみが よごれて いるよ");
        }
      }
      let bname = "";
      if (u === USE.HOME && s.kind[i]) bname = HOME[s.kind[i]].name;
      else if (u >= 6 && u <= 8 && s.kind[i]) bname = WORK[u][s.kind[i]].name;
      return {
        terrain: s.terrain[i], use: u, kind: s.kind[i], lvl: lv, name: bname || USE_NAMES[u], terrainName: TER_NAMES[s.terrain[i]],
        people: peopleOf(s, i), jobs: jobsOf(s, i), live: s.live[i], land: s.land[i], dens: s.dens[i], poll: pollAt(s, i),
        traffic: s.traffic[i], jamNear: k.jamNear[i], connected: isZoneUse(u) ? connected(s, i) : isRoadUse(u) ? (s.net.label[i] >= 0 && !!s.net.comps[s.net.label[i]] && s.net.comps[s.net.label[i]].entry) : false,
        blocked: s.blocked[i], reasons
      };
    } catch (e) { return null; }
  }
  function summary(s) {
    try {
      if (!okState(s)) return null;
      const k = scratch(s);
      if (!k.ready) recalc(s);
      const nr = s.rank < RANKS.length - 1 ? RANKS[s.rank + 1] : null;
      return {
        money: s.money, pop: s.pop, star: s.star, jobs: s.jobs, workers: s.workers, r: s.r,
        year: Math.floor(s.month / 12) + 1, month: ((s.month + 3) % 12) + 1, rank: s.rank, rankName: RANKS[s.rank].name,
        next: nr ? nr.name : null, nextPop: nr ? nr.pop : null, poll: Math.round(pollAvg(s)),
        income: s.income | 0, cost: s.cost | 0, build: s.build | 0, service: s.service | 0, tax: s.tax, speed: s.speed, name: s.name, bestPop: s.bestPop,
        jam: k.jamLv | 0, liveAvg: liveAvg(s)
      };
    } catch (e) { return null; }
  }
  function setTax(s, t) {
    if (!okState(s) || !isInt(t) || t < 0 || t > 2) return false;
    if (s.rank < 1 && t !== 1) return false;   // 税のたかさは まち から
    s.tax = t;
    const k = scratch(s);
    if (k.ready) for (let i = 0; i < N; i++) if (s.use[i] === USE.HOME) evalFields(s, k, i);
    return true;
  }
  function setSpeed(s, sp) { if (!okState(s) || !SPEEDS.includes(sp)) return false; s.speed = sp; return true; }
  function rename(s, name) { if (!isObj(s)) return false; s.name = normalizeName(name); return true; }
  function graphemes(str) {
    try {
      if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
        const seg = new Intl.Segmenter("ja", { granularity: "grapheme" });
        return Array.from(seg.segment(str), (x) => x.segment);
      }
    } catch (e) { /* なければ下へ */ }
    return Array.from(str);
  }
  function normalizeName(raw) {
    if (typeof raw !== "string") return DEFAULT_NAME;
    // 改行・制御文字（C0・DEL・C1）・はばの無い文字の一部・向きを変える文字を消す
    let t = raw.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").trim();
    if (!t) return DEFAULT_NAME;
    const g = graphemes(t);
    if (g.length > NAME_MAX) t = g.slice(0, NAME_MAX).join("").trim();
    return t || DEFAULT_NAME;
  }
  function formatNum(n) {
    if (!isNum(n)) return "0";
    const v = Math.round(n), neg = v < 0;
    const str = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + str;
  }
  const formatMoney = (n) => formatNum(n);
  const formatPop = (n) => formatNum(n);
  function dateText(month) {
    const m = isInt(month) && month >= 0 ? month : 0;
    return (Math.floor(m / 12) + 1) + " ねんめ " + (((m + 3) % 12) + 1) + " がつ";
  }

  // ---------------------------------------------------------------- 保存（§8）
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const B64I = (function () { const m = new Int16Array(128).fill(-1); for (let a = 0; a < 64; a++) m[B64.charCodeAt(a)] = a; return m; })();
  function b64enc(u8) {
    let out = "";
    let a = 0;
    for (; a + 2 < u8.length; a += 3) {
      const n = (u8[a] << 16) | (u8[a + 1] << 8) | u8[a + 2];
      out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    if (a < u8.length) {
      const n = (u8[a] << 16) | ((a + 1 < u8.length ? u8[a + 1] : 0) << 8);
      out += B64[n >> 18] + B64[(n >> 12) & 63] + (a + 1 < u8.length ? B64[(n >> 6) & 63] : "=") + "=";
    }
    return out;
  }
  function b64dec(str, len) {
    if (typeof str !== "string" || str.length !== Math.ceil(len / 3) * 4) return null;
    const out = new Uint8Array(len);
    let o = 0;
    for (let a = 0; a < str.length; a += 4) {
      const c = [0, 1, 2, 3].map((d) => { const ch = str.charCodeAt(a + d); return ch === 61 ? 0 : ch < 128 ? B64I[ch] : -1; });
      if (c.some((v) => v < 0)) return null;
      const n = (c[0] << 18) | (c[1] << 12) | (c[2] << 6) | c[3];
      if (o < len) out[o++] = n >> 16;
      if (o < len) out[o++] = (n >> 8) & 255;
      if (o < len) out[o++] = n & 255;
    }
    if (b64enc(out) !== str) return null;   // 余りの文字・= の位置がおかしい
    return out;
  }
  function makeSave(s, at) {
    try {
      if (!okState(s)) return null;
      return JSON.stringify({
        v: SAVE_VERSION, at: isNum(at) ? at : null, seed: s.seed | 0, choice: s.choice, name: normalizeName(s.name),
        money: Math.round(s.money), month: s.month, acc: s.acc, speed: s.speed, tax: s.tax, rank: s.rank, bestPop: s.bestPop, rng: s.rng | 0, star: s.star,
        entry: s.entry.map((e) => [e.x, e.y]),
        terrain: b64enc(s.terrain), use: b64enc(s.use), kind: b64enc(s.kind), lvl: b64enc(s.lvl), poll: b64enc(s.poll), blocked: b64enc(s.blocked),
        ev: { cool: s.ev.cool, active: s.ev.active.map((e) => ({ kind: e.kind, left: e.left, cells: e.cells.slice() })), lastBad: s.ev.lastBad }
      });
    } catch (e) { return null; }
  }
  function saveVersionOf(raw) {
    try { const o = typeof raw === "string" ? JSON.parse(raw) : raw; return isObj(o) && isInt(o.v) ? o.v : null; } catch (e) { return null; }
  }
  const KIND_MAX = [0, 0, 0, 0, 0, 4, 2, 2, 3, 0];
  function loadSave(raw) {
    try {
      if (typeof raw !== "string" || raw.length > 400000) return null;
      let o;
      try { o = JSON.parse(raw); } catch (e) { return null; }
      if (!isObj(o) || o.v !== SAVE_VERSION) return null;
      if (!isInt(o.seed) || !isInt(o.choice) || o.choice < 0 || o.choice > 2) return null;
      const arr = {};
      for (const f of ["terrain", "use", "kind", "lvl", "blocked"]) { arr[f] = b64dec(o[f], N); if (!arr[f]) return null; }
      arr.poll = b64dec(o.poll, NPOLL);
      if (!arr.poll) return null;
      for (let i = 0; i < N; i++) {
        const t = arr.terrain[i], u = arr.use[i];
        if (t > 5 || u > 9 || arr.lvl[i] > 3 || arr.kind[i] > 4 || arr.blocked[i] > 3) return null;
        if (arr.kind[i] > KIND_MAX[u]) return null;
        if (u !== 0 && (t === TER.SEA || t === TER.MOUNT)) return null;
        if (t === TER.RIVER && !(isRoadUse(u) || isRailUse(u) || u === 0)) return null;
      }
      for (let b = 0; b < NPOLL; b++) if (arr.poll[b] > 100) return null;
      if (!Array.isArray(o.entry) || o.entry.length < 1 || o.entry.length > 12) return null;
      const entry = [];
      for (const e of o.entry) {
        if (!Array.isArray(e) || e.length !== 2 || !inMap(e[0], e[1])) return null;
        if (arr.use[e[1] * W + e[0]] !== USE.ENTRY) return null;
        entry.push({ x: e[0], y: e[1] });
      }
      let nEntry = 0;
      for (let i = 0; i < N; i++) if (arr.use[i] === USE.ENTRY) nEntry++;
      if (nEntry !== entry.length) return null;
      const s = blank(o.seed | 0, o.choice, o.name);
      s.terrain = arr.terrain; s.use = arr.use; s.kind = arr.kind; s.lvl = arr.lvl; s.poll = arr.poll; s.blocked = arr.blocked;
      // 形をそろえる（建物の無い所の kind・lvl は 0、空き地の すむ／しごと／おみせ は kind 0、めぐみの kind は場所から）
      for (let i = 0; i < N; i++) {
        const u = s.use[i];
        if (!isZoneUse(u)) { s.kind[i] = 0; s.lvl[i] = 0; }
        else if (u === USE.NATURE) { if (!s.kind[i]) s.kind[i] = natureKindAt(s, i % W, (i / W) | 0); }
        else if (s.lvl[i] === 0) s.kind[i] = 0;
        else if (!s.kind[i]) s.kind[i] = u === USE.HOME ? 3 : 1;
        if (!isRoadUse(u)) s.blocked[i] = 0;
      }
      s.entry = entry;
      const num = (x, lo, hi, d) => (isNum(x) ? clamp(x, lo, hi) : d);
      s.money = Math.round(num(o.money, MONEY_MIN, MONEY_MAX, 0));
      s.month = Math.floor(num(o.month, 0, MONTH_MAX, 0));
      s.tick = s.month * TICKS_PER_MONTH;
      s.acc = num(o.acc, 0, TICK_SEC, 0);
      s.speed = SPEEDS.includes(o.speed) ? o.speed : 1;
      s.rank = Math.floor(num(o.rank, 0, RANKS.length - 1, 0));
      s.tax = isInt(o.tax) && o.tax >= 0 && o.tax <= 2 ? o.tax : 1;
      if (s.rank < 1) s.tax = 1;
      s.bestPop = Math.floor(num(o.bestPop, 0, BEST_MAX, 0));
      s.rng = isNum(o.rng) ? o.rng | 0 : s.rng;
      const ev = isObj(o.ev) ? o.ev : {};
      s.ev = { cool: Math.floor(num(ev.cool, 0, EVENT_COOL, 0)), active: [], lastBad: isInt(ev.lastBad) ? ev.lastBad : -1 };
      if (Array.isArray(ev.active)) {
        for (const e of ev.active.slice(0, 5)) {
          if (!isObj(e) || !EVENTS.some((d) => d.kind === e.kind) || !isInt(e.left) || e.left < 1 || e.left > 3) continue;
          const cells = Array.isArray(e.cells) ? e.cells.filter((c) => isInt(c) && c >= 0 && c < N).slice(0, 10) : [];
          s.ev.active.push({ kind: e.kind, left: e.left, cells });
          if (e.kind === "festival") s.fest = Math.max(s.fest, e.left);
          if (e.kind === "harvest") s.harvest = true;
        }
      }
      // 雨で通れないマスは、続いている おおあめ のものだけ
      const rainCells = new Set();
      for (const e of s.ev.active) if (e.kind === "rain") for (const c of e.cells) rainCells.add(c);
      for (let i = 0; i < N; i++) if (s.blocked[i] && !rainCells.has(i)) s.blocked[i] = 0;
      for (const c of rainCells) if (isRoadUse(s.use[c]) && s.use[c] !== USE.ENTRY) s.blocked[c] = 1;
      recalc(s);
      // ほし は保存した値に戻す（すみやすさ は月の中で少しずつ計算し直すので、読んだ時に全部計算し直すと ほし が 1 つずれる時がある。
      // 開き直しで ほし が変わって見えないように。次の月の終わりに計算し直す。無い・おかしい時は計算した値）
      if (isInt(o.star) && o.star >= 1 && o.star <= 5) s.star = o.star;
      s.prevPop = s.pop;
      s.bestSeen = s.pop;
      if (s.pop > s.bestPop) s.bestPop = s.pop;
      for (let i = 0; i < N; i++) s.dirty.push(i);
      return s;
    } catch (e) { return null; }
  }
  function validateBest(raw) {
    const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,7}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
    return isInt(n) && n >= 0 && n <= BEST_MAX ? n : 0;
  }

  // ---------------------------------------------------------------- 自動プレイ（計画書 §6）
  // 置き方：
  //   none    … 何も置かない
  //   greedy  … いりぐちから 5 マスおきの格子に みち を伸ばし、釣り合い r を見て すむ・しごと・おみせ を置ける限り置く（みどり・せんろ なし）
  //   factory … 同じ格子で、すむ の列のとなりの列を全部 しごと（こうば）にする（こうばを すむ のそばに固める）
  //   grid    … greedy に加えて、区画ごとに みどり を 1 マス・しごと はいりぐちから遠い側にまとめる・まち になったら せんろ を通す・めぐみ も使う
  //   cross   … 交差点だらけ（2 マスおきの格子）、straight … まっすぐの みち 1 本に同じ数の すむ（渋滞の比べ）
  const P = 5;
  const POLICY = Object.freeze({
    greedy: { work: "far", green: false, rail: false, nature: false, shop: true, jobR: 1.0 },
    factory: { work: "near", green: false, rail: false, nature: false, shop: false, jobR: 1.5 },
    grid: { work: "far", green: true, rail: true, nature: true, shop: true, jobR: 1.0 }
  });
  function policyAct(s, pol, mem) {
    const cfg = POLICY[pol];
    if (!cfg) return;
    const e = s.entry[s.entry.length - 1], ex = e.x, ey = e.y;
    const md = (a) => ((a % P) + P) % P;
    const label = s.net.label;
    if (!mem.cand) {
      const roads = [], zones = [];
      for (let y = ey; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, t = s.terrain[i];
        if (t === TER.SEA || t === TER.MOUNT || s.use[i] === USE.ENTRY) continue;
        const d = Math.abs(x - ex) + Math.abs(y - ey);
        if (md(x - ex) === 0 || md(y - ey) === 0) roads.push([d, i]);
        else if (t !== TER.RIVER) zones.push([d, i]);
      }
      roads.sort((a, b) => a[0] - b[0]); zones.sort((a, b) => a[0] - b[0]);
      mem.roads = roads.map((r) => r[1]); mem.zones = zones.map((z) => z[1]);
      mem.cand = true; mem.at = {}; mem.railRow = cfg.rail ? ey + 2 + P * 2 : -1; mem.railDone = false;
    }
    const near = (i) => { const x = i % W, y = (i / W) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && label[ny * W + nx] >= 0 && s.net.comps[label[ny * W + nx]].entry) return true; } return false; };
    let eHome = 0, eJob = 0, shopJobs = 0;
    for (let i = 0; i < N; i++) {
      const u = s.use[i];
      const fresh = !(mem.at && s.month - (mem.at[i] || 0) > 12);   // 1 年たっても育たない空き地は数えない（遊ぶ人もほかへ置く）
      if (u === USE.HOME && s.lvl[i] === 0 && fresh) eHome++;
      else if ((u === USE.WORK || u === USE.SHOP || u === USE.NATURE) && s.lvl[i] === 0 && fresh) eJob++;
      if (u === USE.SHOP) shopJobs += s.lvl[i] ? jobsOf(s, i) : 6;
    }
    // 置ける区画（いりぐちとつながったみちの 2 マス以内・空き）
    const free = [];
    for (const i of mem.zones) {
      if (s.use[i] !== 0 || !near(i)) continue;
      if (((i / W) | 0) === mem.railRow) continue;
      free.push(i);
    }
    let fi = 0, fj = free.length - 1, used = new Set();
    const takeNear = () => { while (fi < free.length && used.has(free[fi])) fi++; if (fi >= free.length) return -1; used.add(free[fi]); return free[fi]; };
    const takeFar = () => { while (fj >= 0 && used.has(free[fj])) fj--; if (fj < 0) return -1; used.add(free[fj]); return free[fj]; };
    let short = false;
    // みどり（grid：区画のまんなかに 1 マス）
    if (cfg.green) for (const i of free) {
      const x = i % W, y = (i / W) | 0;
      if (md(x - ex) === 2 && md(y - ey) === 2 && s.money >= 100) { if (place(s, "green", [i]).placed) used.add(i); }
    }
    // しごと（r が低い・空きが少ない）
    const wantShop = cfg.shop && s.pop / 4 > shopJobs + 6;
    const wantJob = s.r < cfg.jobR || s.pop === 0 || wantShop;
    for (let n = 0; wantJob && eJob < 6 && n < 6; n++) {
      if (s.money < 60) break;
      let tool = "work";
      if (cfg.shop && s.pop / 4 > shopJobs + 6) tool = "shop";
      else if (s.r >= cfg.jobR && s.pop > 0) break;
      let i = tool === "shop" ? takeNear() : cfg.work === "far" ? takeFar() : takeNear();
      if (i < 0) { short = true; break; }
      if (cfg.nature && tool === "work" && natureKindAt(s, i % W, (i / W) | 0) !== 1) tool = "nature";
      if (cfg.work === "near" && tool === "work") {
        // こうばを固める：すむ のとなりの列に置く
      }
      if (place(s, tool, [i]).placed) { eJob++; mem.at[i] = s.month; if (tool === "shop") shopJobs += 6; }
    }
    // すむ
    const wantHome = s.r >= 0.9 || s.pop < 20 || cfg.work === "near";
    for (let n = 0; wantHome && eHome < 12 && n < 12; n++) {
      if (s.money < 40) break;
      const i = takeNear();
      if (i < 0) { short = true; break; }
      if (place(s, "home", [i]).placed) { eHome++; mem.at[i] = s.month; }
    }
    if (free.length - used.size < 30) short = true;
    // みち を伸ばす
    if (short) {
      let added = 0;
      for (const i of mem.roads) {
        if (added >= (pol === "greedy" ? 20 : 10) || s.money < 80) break;
        if (s.use[i] !== 0) continue;
        const x = i % W;
        const adj = (x > 0 && label[i - 1] >= 0) || (x < W - 1 && label[i + 1] >= 0) || (i >= W && label[i - W] >= 0) || (i + W < N && label[i + W] >= 0);
        if (!adj) continue;
        if (place(s, "road", [i]).placed) added++;
      }
    }
    // せんろ（grid：まち になったら 1 本。町の幅いっぱい）
    if (cfg.rail && s.rank >= 1 && !mem.railDone && s.money > 2500) {
      const row = mem.railRow;
      if (row > 0 && row < H) {
        let x0 = W, x1 = -1;
        for (let x = 0; x < W; x++) if (label[row * W + x] >= 0 || isZoneUse(s.use[row * W + x])) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
        const cells = [];
        for (let x = Math.max(0, x0 - 2); x <= Math.min(W - 1, x1 + 2); x++) cells.push(row * W + x);
        place(s, "rail", cells);
        mem.railDone = true;
      }
    }
    if (pol === "grid" && s.rank >= 1) setTax(s, s.money > 8000 ? 0 : 1);
  }
  function simulate(seed, policy, months, opts) {
    try {
      const o = isObj(opts) ? opts : {};
      const s = newGame(isNum(seed) ? seed : 1, isInt(o.choice) ? o.choice : 0);
      if (!s) return null;
      const k = scratch(s);
      const pol = typeof policy === "string" ? policy : "none";
      const m = isInt(months) && months > 0 ? Math.min(months, 3000) : 120;
      const mem = {};
      const rep = { pop: 0, money: 0, star: 3, rank: 0, monthsTo: { 1000: null, 10000: null, 30000: null, 60000: null }, jamMax: 0, pollMax: 0,
        log: [], minMoney: s.money, minMoney24: s.money, negRun: 0, negRunMax: 0, dropMax: 0, peak: 0, starMin: 5, starSum: 0, starN: 0, events: {}, stepMs: null };
      const ev = [];
      for (let mo = 0; mo < m; mo++) {
        policyAct(s, pol, mem);
        if (isInt(o.tax) && s.rank >= 1) setTax(s, o.tax);   // 税を決めて比べる（数値合わせ）
        for (let t = 0; t < TICKS_PER_MONTH; t++) { ev.length = 0; tickOnce(s, k, ev); for (const e of ev) if (e.kind === "event") rep.events[e.ev] = (rep.events[e.ev] || 0) + 1; }
        for (const th of [1000, 10000, 30000, 60000]) if (rep.monthsTo[th] === null && s.pop >= th) rep.monthsTo[th] = s.month;
        rep.jamMax = Math.max(rep.jamMax, k.jamLv | 0);
        let pm = 0; for (let b = 0; b < NPOLL; b++) if (s.poll[b] > pm) pm = s.poll[b];
        rep.pollMax = Math.max(rep.pollMax, pm);
        rep.minMoney = Math.min(rep.minMoney, s.money);
        if (s.month <= 24) rep.minMoney24 = Math.min(rep.minMoney24, s.money);
        rep.negRun = s.money < 0 ? rep.negRun + 1 : 0;
        rep.negRunMax = Math.max(rep.negRunMax, rep.negRun);
        rep.peak = Math.max(rep.peak, s.pop);
        if (s.month > 24 && s.pop > 0) { rep.starMin = Math.min(rep.starMin, s.star); rep.starSum += s.star; rep.starN++; }
        if (rep.peak >= 100) rep.dropMax = Math.max(rep.dropMax, (rep.peak - s.pop) / rep.peak);
        rep.log.push({ m: s.month, pop: s.pop, money: s.money, star: s.star, jam: k.jamLv | 0, poll: Math.round(pollAvg(s)) });
      }
      rep.starAvg = rep.starN ? rep.starSum / rep.starN : null;
      rep.pop = s.pop; rep.money = s.money; rep.star = s.star; rep.rank = s.rank;
      rep.state = s;
      return rep;
    } catch (e) { return null; }
  }

  const api = {
    NAME, W, H, N, CHUNK, POLL_BLOCK, TICK_SEC, TICKS_PER_MONTH, START_MONEY, MONEY_MAX, MONEY_MIN, BEST_MAX, SPEEDS, NAME_MAX, DEFAULT_NAME,
    SAVE_VERSION, SAVE_KEY, SAVE_KEY_BAK, SAVE_KEY_BEST, SAVE_KEY_SEEN, UNDO_SEC,
    TER, TER_NAMES, USE, USE_NAMES, TERRAIN_TYPES, TOOLS, HOME, WORK, RANKS, EVENTS, VOICES,
    BUILD_PAY, BUILD_PAY_RATE, SERVICE, TAX_INFLOW, TAX_MUL, SUBSIDY, DENS_BASE, DENS_JOB_STEP, DENS_JOB_MAX,
    EVENT_RATE, EVENT_COOL, EVENT_MIN_POP, EVENT_BAD_FROM, GROW_BASE, GROW_RATE, STAR_MUL, R_SOFT, RAIL_MIN, CAP_ROAD, CAP_X, CAP_CROSS,
    terrainChoices, newGame, step, canPlace, place, lineCells, rectCells, inspect, summary, setTax, setSpeed, rename, normalizeName,
    starReasons, voiceOf, makeSave, loadSave, saveVersionOf, validateBest, simulate, formatMoney, formatPop, dateText,
    recalc, homeKindOf, natureKindAt, startEvent: (s, kind) => { try { const ev = []; if (!okState(s)) return null; const k = scratch(s); if (!k.ready) recalc(s); startEvent(s, k, kind, ev); if (k.netDirty) buildNet(s); if (k.netDirty || k.needTally) { tally(s); k.needTally = false; } return ev; } catch (e) { return null; } }
  };
  return Object.freeze(api);
});
