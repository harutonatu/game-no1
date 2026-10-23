/*
 * もくもくこうば — ロジック（DOM・Date・performance・Math.random・localStorage に触れない純粋な計算だけ）
 * 契約：docs/seizai-contract.md §3（経済と節目）・§4（API）・§8（保存の形と検証）・§19（かんそう・かんな の工程と道具の段階。§19 が §3 より優先）
 * 担当A（ロジック）だけが編集する。
 *
 * UMD: ブラウザでは window.SeizaiLogic、Node では module.exports。
 *
 * 中の作り：
 *   - 公開する関数は、受け取った state を書き換えない（毎回新しいオブジェクトを返す）。
 *     中では「写した state を書き換える」関数（stepMut など）を使い、自動プレイと catchUp はそれを直接まわす（速さのため）。
 *   - 手で組んだ state（テスト用）も受け付ける。足りない欄は既定の値で補う。
 *   - 契約 §4.1 の state の形に、次の欄を足している（保存しない。画面は使わなくてよい）：
 *       arrive … 次のお客さんが来るまでの進み 0〜1
 *   - 乱数は mulberry32。state.rng に 32bit の状態を持つ。
 *   - 例外は外へ出さない（おかしな引数は null か { ok:false, reason }）。
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SeizaiLogic = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : null, function () {
  "use strict";

  // ---------------------------------------------------------------- 定数（契約 §3）
  const NAME = "もくもくこうば";
  const STEP = 0.1;
  const LEVEL_MAX = 50;
  const MONEY_MAX = 9e15;
  const GROW_TIME = 30;
  const NATURAL_REGROW = 1 / 60;
  const BOOST_SEC = 5;
  const BOOST_COOLDOWN = 15;
  const CALL_COOLDOWN = 10;
  const ORDER_EVERY = 150;
  const ORDER_GAP_SEC = 240;            // 注文と注文の間は、少なくとも「いまの売り物の速さで 4 分ぶん」売る
  const ORDER_MIN_SEC = 60;             // 注文の数は いまの速さで 1〜2 分ぶん
  const ORDER_MAX_SEC = 120;
  const ORDER_REWARD_MUL = 3;
  const ORDER_FROM_STAGE = 2;           // 大口の注文は こうば から（ユーザー決定「2段目から」。§3.7・§17.2）
  const ORDER_BIG_RATE = 0.2;           // とくべつな注文になる割合（5 回に 1 回くらい。種つきの乱数）
  const ORDER_BIG_NEED = 1.5;           // とくべつな注文の数（ふつうの 1.5 倍）
  const ORDER_BIG_REWARD = 4;           // とくべつな注文のお礼（ふつうの注文の 4 倍）
  const QUEUE_MAX = 6;
  const SHIP_BASE = 30000;
  const SHIP_GROWTH = 1.2;
  const SHIP_NEED_MAX = 9999900;
  const SHIPS_MAX = 9999;
  const SHIP_REWARD_MUL = 0.5;
  const OFFLINE_CAP_SEC = 7200;
  const OFFLINE_STEP = 1;
  const AWAY_RATE = 0.5;
  const AWAY_CARD_MIN_SEC = 60;
  const SAVE_VERSION = 1;

  const DEPTS = Object.freeze([
    Object.freeze({ id: "cut", name: "きこり", kind: "staff", stage: 1, from: 1, baseTime: 6 }),
    Object.freeze({ id: "plant", name: "なえぎ", kind: "staff", stage: 1, from: 1, baseTime: 5 }),
    Object.freeze({ id: "carry", name: "はこぶ", kind: "staff", stage: 1, from: 1, baseTime: 8 }),
    Object.freeze({ id: "peel", name: "かわむき", kind: "line", stage: 1, from: 1, baseTime: 5 }),
    Object.freeze({ id: "beam", name: "かくざい", kind: "line", stage: 2, from: 2, baseTime: 8 }),
    Object.freeze({ id: "dry", name: "かんそう", kind: "line", stage: 3, from: 3, baseTime: 2 }),     // §19.1：角材 → かわいた かくざい
    Object.freeze({ id: "plank", name: "いた", kind: "line", stage: 3, from: 3, baseTime: 2.5 }),
    Object.freeze({ id: "plane", name: "かんな", kind: "line", stage: 4, from: 4, baseTime: 5 }),     // §19.1：板 → つるつるいた
    Object.freeze({ id: "shop", name: "おみせ", kind: "staff", stage: 1, from: 1, baseTime: 3 })
  ]);
  const IDS = DEPTS.map((d) => d.id);
  const DEPT = {};
  for (const d of DEPTS) DEPT[d.id] = d;
  // 2026-10-21（§19.1.4）：dry 10→2・plank 10→2.5。こうじょう に広げた直後に 1台・Lv1 でも稼ぎが落ちないように（測った値は契約 §19.7）
  // 2026-10-23（SZ-08・契約 §23）：plane 5→2.5。全部さいだい・はやい でも かんな が いちばん遅いまま（直せないつまり）だったため
  const BASE_TIME = Object.freeze({ cut: 6, plant: 5, carry: 8, peel: 5, beam: 8, dry: 2, plank: 2.5, plane: 2.5, shop: 3 });
  // 段に広げて新しい台が来たときの きかい の Lv（§19.1.2。古い保存の補いにも使う）
  const START_LEVEL = Object.freeze({ dry: 1, plane: 1 });
  const PLANKS_PER_BEAM = 2;

  // 段ごとの値は [こや, こうば, こうじょう, みなと] の順（index = stage − 1）
  const BUF_CAP = Object.freeze([20, 30, 40, 60]);
  const GOODS_CAP = Object.freeze([50, 100, 200, 400]);
  const FOREST_CAP = Object.freeze([12, 16, 20, 24]);
  const CUST_EVERY = Object.freeze([4, 3, 2.5, 2]);
  const STAGE_MUL = Object.freeze([1, 1.5, 3, 6]);
  const WOOD = Object.freeze(["すぎ", "すぎ", "ひのき", "けやき"]);
  const PRICE = Object.freeze({ peeled: 5, beams: 30, planks: 20, smooth: 70 });   // smooth 30→60（§19.1.4）→70（SZ-08。かんな を速くしたあと、みなと に広げた直後の稼ぎを落とさない）
  const PRODUCT_NAME = Object.freeze({ peeled: "むきまるた", beams: "かくざい", dried: "かわいた かくざい", planks: "いた", smooth: "つるつるいた" });
  const PRODUCT_UNIT = Object.freeze({ peeled: "こ", beams: "ぽん", dried: "ぽん", planks: "まい", smooth: "まい" });

  const STAFF_COST = Object.freeze({ cut: 15, plant: 10, carry: 25, shop: 40 });
  const STAFF_START = Object.freeze({ cut: 1, plant: 0, carry: 1, shop: 1 });
  const STAFF_GROWTH = 1.55;
  const LEVEL_COST = Object.freeze({ cut: 10, plant: 10, carry: 12, peel: 15, beam: 700, dry: 1500, plank: 3000, plane: 1000, shop: 20 });   // plane 20000→1000（§19.1.4）
  const LEVEL_GROWTH = 1.18;
  const LINE_COST = Object.freeze({ peel: 100, beam: 3000, dry: 10000, plank: 20000, plane: 2000000 });   // plane 150000→10000（§19.1.4）→2000000（SZ-08。かんな の BASE_TIME を 2.5 にしたぶん、台を増やす値段で みなと の長さを保つ）
  const LINE_GROWTH = 5;
  const MGR_COST = Object.freeze({ cut: 300, plant: 300, carry: 400, peel: 500, beam: 8000, dry: 30000, plank: 50000, plane: 300000, shop: 1000 });
  const MGR_FAST = 1.5;
  const MGR_GAIN = 0.25;
  const BOOST_MUL = 2;

  // 人数・台数の上限（§3.2 の表）。CAPS[stage − 1][dept]。0 はまだ使えない
  const CAPS = Object.freeze([
    Object.freeze({ cut: 3, plant: 1, carry: 3, peel: 2, beam: 0, dry: 0, plank: 0, plane: 0, shop: 1 }),
    Object.freeze({ cut: 5, plant: 2, carry: 5, peel: 3, beam: 3, dry: 0, plank: 0, plane: 0, shop: 2 }),
    Object.freeze({ cut: 6, plant: 3, carry: 6, peel: 4, beam: 4, dry: 4, plank: 4, plane: 0, shop: 3 }),
    Object.freeze({ cut: 8, plant: 4, carry: 8, peel: 4, beam: 4, dry: 4, plank: 4, plane: 4, shop: 4 })
  ]);

  const STAGES = Object.freeze([
    Object.freeze({ id: 1, key: "koya", name: "こや", product: "peeled", goal: 100, cost: 250, expandCost: 250 }),
    Object.freeze({ id: 2, key: "kouba", name: "こうば", product: "beams", goal: 1000, cost: 20000, expandCost: 20000 }),
    Object.freeze({ id: 3, key: "koujou", name: "こうじょう", product: "planks", goal: 48000, cost: 960000, expandCost: 960000 }),
    Object.freeze({ id: 4, key: "minato", name: "みなと", product: "smooth", goal: SHIP_BASE, cost: null, expandCost: null })
  ]);

  const CUSTOMERS = Object.freeze([
    Object.freeze({ kind: "neighbor", name: "きんじょの ひと", stage: 1, min: 1, max: 1, boss: "まちの やくば" }),
    Object.freeze({ kind: "carpenter", name: "だいくさん", stage: 2, min: 2, max: 3, boss: "だいくの とうりょう" }),
    Object.freeze({ kind: "furniture", name: "かぐやさん", stage: 3, min: 4, max: 6, boss: "かぐやの おやかた" }),
    Object.freeze({ kind: "merchant", name: "ふねの しょうにん", stage: 4, min: 10, max: 20, boss: "ふねの せんちょう" })
  ]);
  const CUST = {};
  for (const c of CUSTOMERS) CUST[c.kind] = c;
  // 大口の注文の相手（段ごとに 3 種類以上。こや では注文は来ない。§3.7）
  const ORDER_BOSSES = Object.freeze([
    Object.freeze([]),
    Object.freeze(["だいくの おじさん", "まちの やくしょ", "おてらの おしょうさん"]),
    Object.freeze(["かぐやの おじさん", "がっこうの せんせい", "えきの えきいんさん", "だいくの おじさん"]),
    Object.freeze(["ふねの せんちょうさん", "しまの むらの ひと", "みなとの おじさん", "かぐやの おじさん"])
  ]);

  const SAVE_KEY = "seizai.save";
  const SAVE_KEY_BAK = "seizai.save.bak";
  const SAVE_KEY_BEST = "seizai.best";
  const SAVE_KEY_HELP = "seizai.help";

  // 道具の段階（§19.2。全部署で同じ Lv で変わる。画面は表を持たず toolOf を使う）
  const TOOL_LV = Object.freeze([1, 5, 15, 30]);
  const TOOLS = Object.freeze({
    cut: Object.freeze(["おの", "のこぎり", "チェーンソー", "きんの チェーンソー"]),
    plant: Object.freeze(["スコップ", "くわ", "なえぎぐるま", "きんの スコップ"]),
    carry: Object.freeze(["てで", "ておしぐるま", "にぐるま", "トラック"]),
    peel: Object.freeze(["へら", "ローラー", "かわむきマシン", "きんの マシン"]),
    beam: Object.freeze(["おおのこ", "まるのこ", "おおきな まるのこ", "きんの まるのこ"]),
    dry: Object.freeze(["おひさま", "せんぷうき", "ストーブ", "かんそうマシン"]),
    plank: Object.freeze(["てのこ", "でんきのこ", "ならびのこ", "きんの ならびのこ"]),
    plane: Object.freeze(["かんな", "おおかんな", "でんきかんな", "きんの かんな"]),
    shop: Object.freeze(["はりがみ", "かんばん", "ひかる かんばん", "きんの かんばん"])
  });

  // ---------------------------------------------------------------- 小さな道具
  const isNum = (x) => typeof x === "number" && Number.isFinite(x);
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const stIdx = (stage) => clamp((stage | 0) - 1, 0, 3);
  const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  const addMoney = (m, y) => Math.min(MONEY_MAX, Math.floor(m + y));

  function speedMul(L) { return 1 + 0.1 * (L - 1); }

  // mulberry32（state.rng を進める）。r は 0〜4294967295。返り値 [新しい r, 0〜1 の数]
  function rngNext(r) {
    let a = (r + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return [a, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
  }
  function rand(s) { const [r, x] = rngNext(s.rng); s.rng = r; return x; }
  const toU32 = (x) => (isNum(x) && x >= 0 && x <= 4294967295 && Math.floor(x) === x ? x : null);

  function unlocked(stage, id) { return !!DEPT[id] && DEPT[id].stage <= stage; }
  function countOf(dd, id) { return DEPT[id].kind === "line" ? dd.lines : dd.staff; }
  function capOf(stage, id) { return CAPS[stIdx(stage)][id]; }

  function fmtInt(n) {
    n = Math.floor(Math.max(0, n));
    const s = String(n);
    let out = "";
    for (let i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 === 0) out += ","; out += s[i]; }
    return out;
  }

  // ---------------------------------------------------------------- 状態をつくる・写す
  function newDepts() {
    const d = {};
    for (const x of DEPTS) {
      const o = { level: 1, mgr: null, boostUntil: 0, cooldownUntil: 0 };
      if (x.kind === "line") o.lines = x.stage === 1 ? 1 : 0; else o.staff = STAFF_START[x.id];
      d[x.id] = o;
    }
    return d;
  }
  const zeroBy = (keys) => { const o = {}; for (const k of keys) o[k] = 0; return o; };
  const BUF_KEYS = ["yard", "logs", "peeled", "beams", "dried", "planks", "goods"];
  const TOTAL_KEYS = ["logs", "peeled", "beams", "dried", "planks", "smooth", "sold", "earned"];

  function normSeed(seed) {
    if (!isNum(seed)) return 1;
    const s = Math.floor(Math.abs(seed)) % 4294967296;
    return s === 0 ? 1 : s;
  }
  function seedToRng(seed) { let r = (seed ^ 0x9e3779b9) >>> 0; r = rngNext(r)[0]; return r; }

  function newGame(seed) {
    try {
      const sd = normSeed(seed);
      return {
        stage: 1, cleared: false, money: 0, t: 0,
        forest: { trees: 10, saplings: 0 },
        buf: zeroBy(BUF_KEYS),
        prog: zeroBy(IDS),
        depts: newDepts(),
        queue: [], callUntil: 0, arrive: 0,
        goal: { done: 0 },
        order: null, orderSeq: 0, soldSinceOrder: 0,
        ships: 0, ship: { got: 0 },
        totals: zeroBy(TOTAL_KEYS),
        done: zeroBy(IDS),
        seed: sd, rng: seedToRng(sd)
      };
    } catch (e) { return null; }
  }

  // 写す（足りない欄は既定で補う）。中身の値の検証は loadSave が受け持つ。ここは形をそろえるだけ
  function clone(s) {
    const b = newGame(isNum(s.seed) ? s.seed : 1);
    const num = (x, d) => (isNum(x) ? x : d);
    const o = {
      stage: clamp(Math.floor(num(s.stage, 1)), 1, 4), cleared: !!s.cleared, money: num(s.money, 0), t: num(s.t, 0),
      forest: { trees: num(s.forest && s.forest.trees, b.forest.trees), saplings: num(s.forest && s.forest.saplings, 0) },
      buf: {}, prog: {}, depts: {}, queue: [], callUntil: num(s.callUntil, 0), arrive: num(s.arrive, 0),
      goal: { done: num(s.goal && s.goal.done, 0) },
      order: isObj(s.order) ? { id: num(s.order.id, 0), who: String(s.order.who || ""), need: num(s.order.need, 10), got: num(s.order.got, 0), reward: num(s.order.reward, 0), accepted: !!s.order.accepted, big: s.order.big === true } : null,
      orderSeq: num(s.orderSeq, 0), soldSinceOrder: num(s.soldSinceOrder, 0),
      ships: num(s.ships, 0), ship: { got: num(s.ship && s.ship.got, 0) },
      totals: {}, done: {},
      seed: num(s.seed, b.seed), rng: toU32(s.rng) !== null ? s.rng : b.rng
    };
    for (const k of BUF_KEYS) o.buf[k] = num(s.buf && s.buf[k], 0);
    for (const k of IDS) o.prog[k] = num(s.prog && s.prog[k], 0);
    for (const k of TOTAL_KEYS) o.totals[k] = num(s.totals && s.totals[k], 0);
    for (const k of IDS) o.done[k] = num(s.done && s.done[k], 0);
    for (const k of IDS) {
      const src = isObj(s.depts) && isObj(s.depts[k]) ? s.depts[k] : {};
      const def = b.depts[k];
      const d = { level: num(src.level, 1), mgr: src.mgr === "fast" || src.mgr === "gain" ? src.mgr : null, boostUntil: num(src.boostUntil, 0), cooldownUntil: num(src.cooldownUntil, 0) };
      if (DEPT[k].kind === "line") d.lines = num(src.lines, def.lines); else d.staff = num(src.staff, def.staff);
      o.depts[k] = d;
    }
    if (Array.isArray(s.queue)) for (const q of s.queue.slice(0, QUEUE_MAX)) if (isObj(q) && CUST[q.kind]) o.queue.push({ kind: q.kind, want: Math.max(1, Math.floor(num(q.want, 1))) });
    return o;
  }
  function okState(s) { return isObj(s) && isNum(s.stage); }

  // ---------------------------------------------------------------- 速さ・値段
  function rateOf(s, id) {
    const d = s.depts[id];
    if (!unlocked(s.stage, id)) return 0;
    const n = countOf(d, id);
    let r = n * (1 / BASE_TIME[id]) * speedMul(d.level);
    if (d.mgr === "fast") r *= MGR_FAST;
    if (s.t < d.boostUntil) r *= BOOST_MUL;
    return r;
  }
  // 苗木が木になるまでの秒。なえぎの きかい（と はやい マネージャー）で短くなる（Lv1 で GROW_TIME）
  function growTime(s) {
    const d = s.depts.plant;
    return GROW_TIME / (speedMul(d.level) * (d.mgr === "fast" ? MGR_FAST : 1));
  }
  function gainCount(s) { let n = 0; for (const id of IDS) if (unlocked(s.stage, id) && s.depts[id].mgr === "gain") n++; return n; }
  function productOfStage(stage) { return STAGES[stIdx(stage)].product; }
  function priceOfS(s) {
    const p = PRICE[productOfStage(s.stage)] * STAGE_MUL[stIdx(s.stage)] * (1 + MGR_GAIN * gainCount(s));
    return Math.max(1, Math.floor(p + 1e-9));
  }
  function custInterval(s) { return CUST_EVERY[stIdx(s.stage)] / speedMul(s.depts.shop.level); }
  function avgWant(stage) {
    let a = 0, n = 0;
    for (const c of CUSTOMERS) if (c.stage <= stage) { a += (c.min + c.max) / 2; n++; }
    return a / n;
  }
  // 部署ごとの「丸太に直した」流れの速さ（1秒あたり）。つまり（bottleneck）と注文の数に使う
  function flowRates(s) {
    const f = {};
    const perLog = s.stage >= 3 ? PLANKS_PER_BEAM : 1;
    f.plant = Math.min(rateOf(s, "plant") + NATURAL_REGROW, FOREST_CAP[stIdx(s.stage)] / growTime(s));
    f.cut = rateOf(s, "cut");
    f.carry = rateOf(s, "carry");
    f.peel = rateOf(s, "peel");
    if (s.stage >= 2) f.beam = rateOf(s, "beam");
    if (s.stage >= 3) f.dry = rateOf(s, "dry");
    if (s.stage >= 3) f.plank = rateOf(s, "plank");
    if (s.stage >= 4) f.plane = rateOf(s, "plane") / PLANKS_PER_BEAM;   // 板 2まい ＝ 丸太 1本
    f.shop = Math.min(rateOf(s, "shop"), 1 / custInterval(s)) * avgWant(s.stage) / perLog;
    return f;
  }
  function bottleneckS(s) {
    const f = flowRates(s);
    let best = null, v = Infinity;
    for (const id of IDS) if (id in f && f[id] < v - 1e-12) { v = f[id]; best = id; }
    return best;
  }
  // 売り物の速さ（1秒あたりの売り物の数）
  function productRate(s) {
    const f = flowRates(s);
    let v = Infinity;
    for (const k in f) v = Math.min(v, f[k]);
    return v * (s.stage >= 3 ? PLANKS_PER_BEAM : 1);
  }

  // ---------------------------------------------------------------- 費用
  function costOfS(s, id, what) {
    if (!DEPT[id] || !unlocked(s.stage, id)) return null;
    const d = s.depts[id], dep = DEPT[id];
    if (what === "staff") {
      if (dep.kind !== "staff" || d.staff >= capOf(s.stage, id)) return null;
      return Math.round(STAFF_COST[id] * Math.pow(STAFF_GROWTH, Math.max(0, d.staff - STAFF_START[id])));
    }
    if (what === "line") {
      if (dep.kind !== "line" || d.lines >= capOf(s.stage, id)) return null;
      return Math.round(LINE_COST[id] * Math.pow(LINE_GROWTH, Math.max(0, d.lines - 1)));
    }
    if (what === "level") {
      if (d.level >= LEVEL_MAX) return null;
      return Math.round(LEVEL_COST[id] * Math.pow(LEVEL_GROWTH, d.level - 1));
    }
    if (what === "mgr") {
      if (s.stage < 2 || d.mgr !== null) return null;
      return MGR_COST[id];
    }
    return null;
  }

  // ---------------------------------------------------------------- 1歩（写した state を書き換える）
  function made(ev, id, n) { if (n > 0) ev.push({ kind: "made", dept: id, n }); }
  // 部署を進める。avail＝入る物の数、space＝出る物を置ける数（出る単位）、per＝1つで出る数
  function work(s, id, dt, avail, space, per) {
    const r = rateOf(s, id);
    let p = s.prog[id] + r * dt;
    const can = Math.min(Math.floor(p + 1e-9), Math.floor(avail + 1e-9), Math.floor(space / per + 1e-9));
    const n = Math.max(0, can);
    p -= n;
    if (p > 1) p = 1;
    if (p < 0) p = 0;
    s.prog[id] = r > 0 || p > 0 ? p : s.prog[id];
    return n;
  }

  // 次の注文までに売る数：ORDER_EVERY か「いまの売り物の速さ × ORDER_GAP_SEC」の大きいほう（10 の倍数）
  function orderEvery(s) { return Math.max(ORDER_EVERY, Math.ceil((productRate(s) * ORDER_GAP_SEC) / 10) * 10); }
  // 注文のお礼（とくべつな注文は 1 つあたり ORDER_BIG_REWARD ÷ ORDER_BIG_NEED 倍＝ふつうの注文の 4 倍のお礼）
  function orderReward(need, price, big) {
    const mul = ORDER_REWARD_MUL * (big ? ORDER_BIG_REWARD / ORDER_BIG_NEED : 1);
    return Math.min(MONEY_MAX, Math.floor(need * price * mul + 1e-6));
  }
  function bossesOf(stage) { return ORDER_BOSSES[stIdx(stage)].length ? ORDER_BOSSES[stIdx(stage)] : ORDER_BOSSES[1]; }
  function newOrder(s, ev) {
    const pool = bossesOf(s.stage);
    const who = pool[Math.floor(rand(s) * pool.length)];
    const sec = ORDER_MIN_SEC + Math.floor(rand(s) * (ORDER_MAX_SEC - ORDER_MIN_SEC + 1));
    const big = rand(s) < ORDER_BIG_RATE;
    let need = Math.max(10, Math.ceil(Math.ceil(productRate(s) * sec) / 10) * 10);
    if (big) need = Math.ceil((need * ORDER_BIG_NEED) / 10) * 10;
    const reward = orderReward(need, priceOfS(s), big);
    s.orderSeq += 1;
    s.order = { id: s.orderSeq, who, need, got: 0, reward, accepted: false, big };
    s.soldSinceOrder = 0;
    ev.push({ kind: "order", order: Object.assign({}, s.order) });
  }

  function sell(s, n, who, ev) {
    const price = priceOfS(s);
    const yen = Math.floor(n * price);
    const before = s.money;
    s.money = addMoney(s.money, yen);
    s.buf.goods -= n;
    s.totals.sold += n;
    s.totals.earned = Math.min(MONEY_MAX, s.totals.earned + (s.money - before));
    ev.push({ kind: "sold", n, yen, who });
    if (s.stage < 4) {
      const need = STAGES[s.stage - 1].goal;
      const was = s.goal.done;
      s.goal.done += n;
      if (was < need && s.goal.done >= need) ev.push({ kind: "goal" });
    } else {
      s.goal.done += n;
      s.ship.got += n;   // SHIPS_MAX のときは shipCheck が need − 1 で止める
    }
    if (s.stage >= ORDER_FROM_STAGE && s.order === null) {
      s.soldSinceOrder += n;
      if (s.soldSinceOrder >= orderEvery(s)) newOrder(s, ev);
    }
  }

  function shipCheck(s, ev) {
    if (s.stage !== 4) { s.ship.got = 0; return; }
    if (s.ships >= SHIPS_MAX) { s.ships = SHIPS_MAX; s.ship.got = Math.min(s.ship.got, shipNeed(s.ships) - 1); return; }
    const need = shipNeed(s.ships);
    if (s.ship.got < need) return;
    s.ship.got -= need;
    s.ships += 1;
    let yen = 0;
    const ending = s.ships === 1;
    if (ending) s.cleared = true;
    else {
      const before = s.money;
      s.money = addMoney(s.money, Math.floor(SHIP_REWARD_MUL * need * priceOfS(s)));
      yen = s.money - before;
      s.totals.earned = Math.min(MONEY_MAX, s.totals.earned + yen);
    }
    if (s.ships >= SHIPS_MAX) s.ship.got = Math.min(s.ship.got, shipNeed(s.ships) - 1);
    ev.push({ kind: "ship", n: s.ships, yen, ending });
  }

  function stepMut(s, dt, ev) {
    const st = s.stage, si = stIdx(st);
    s.t += dt;
    // 森
    const fcap = FOREST_CAP[si];
    const grown = s.forest.saplings * Math.min(1, dt / growTime(s));
    s.forest.saplings -= grown;
    s.forest.trees += grown;
    let stumps = Math.max(0, fcap - s.forest.trees - s.forest.saplings);
    const nat = Math.min(stumps, NATURAL_REGROW * dt);
    s.forest.saplings += nat;
    stumps -= nat;
    const np = work(s, "plant", dt, stumps, Infinity, 1);
    s.forest.saplings += np; s.done.plant += np; made(ev, "plant", np);
    // 小数のずれで上限を超えないように
    if (s.forest.trees > fcap) s.forest.trees = fcap;
    if (s.forest.trees + s.forest.saplings > fcap) s.forest.saplings = Math.max(0, fcap - s.forest.trees);
    const cap = BUF_CAP[si], gcap = GOODS_CAP[si];
    const b = s.buf;
    // きこり
    const nc = work(s, "cut", dt, s.forest.trees, cap - b.yard, 1);
    s.forest.trees -= nc; b.yard += nc; s.done.cut += nc; s.totals.logs += nc; made(ev, "cut", nc);
    // はこぶ
    const nk = work(s, "carry", dt, b.yard, cap - b.logs, 1);
    b.yard -= nk; b.logs += nk; s.done.carry += nk; made(ev, "carry", nk);
    // かわむき
    const peelOut = st === 1 ? "goods" : "peeled";
    const nr = work(s, "peel", dt, b.logs, (peelOut === "goods" ? gcap : cap) - b[peelOut], 1);
    b.logs -= nr; b[peelOut] += nr; s.done.peel += nr; s.totals.peeled += nr; made(ev, "peel", nr);
    // かくざい
    if (st >= 2) {
      const out = st === 2 ? "goods" : "beams";
      const n = work(s, "beam", dt, b.peeled, (out === "goods" ? gcap : cap) - b[out], 1);
      b.peeled -= n; b[out] += n; s.done.beam += n; s.totals.beams += n; made(ev, "beam", n);
    }
    // かんそう（こうじょう から。角材 → かわいた かくざい。§19.1）
    if (st >= 3) {
      const n = work(s, "dry", dt, b.beams, cap - b.dried, 1);
      b.beams -= n; b.dried += n; s.done.dry += n; s.totals.dried += n; made(ev, "dry", n);
    }
    // いた（かわいた かくざい 1本 → 板 2まい。みなと では かんな へ回す）
    if (st >= 3) {
      const out = st === 3 ? "goods" : "planks";
      const n = work(s, "plank", dt, b.dried, (out === "goods" ? gcap : cap) - b[out], PLANKS_PER_BEAM);
      b.dried -= n; b[out] += n * PLANKS_PER_BEAM; s.done.plank += n; s.totals.planks += n * PLANKS_PER_BEAM; made(ev, "plank", n);
    }
    // かんな（みなと から。板 1まい → つるつるいた 1まい）
    if (st >= 4) {
      const n = work(s, "plane", dt, b.planks, gcap - b.goods, 1);
      b.planks -= n; b.goods += n; s.done.plane += n; s.totals.smooth += n; made(ev, "plane", n);
    }
    // 注文へ入れる
    if (s.order && s.order.accepted) {
      const o = s.order;
      const k = Math.min(Math.floor(b.goods + 1e-9), o.need - o.got);
      if (k > 0) { b.goods -= k; o.got += k; }
      if (o.got >= o.need) {
        const before = s.money;
        s.money = addMoney(s.money, o.reward);
        const yen = s.money - before;
        s.totals.earned = Math.min(MONEY_MAX, s.totals.earned + yen);
        ev.push({ kind: "delivered", order: Object.assign({}, o), yen });
        s.order = null;
        s.soldSinceOrder = 0;
      }
    }
    // お客さんが来る
    s.arrive += dt / custInterval(s);
    while (s.arrive >= 1 && s.queue.length < QUEUE_MAX) {
      s.arrive -= 1;
      addCustomer(s, ev);
    }
    if (s.arrive > 1) s.arrive = 1;
    // 会計
    const rs = rateOf(s, "shop");
    let p = s.prog.shop + rs * dt;
    let served = 0;
    while (p >= 1 - 1e-9 && s.queue.length && b.goods >= 1 - 1e-9) {
      const c = s.queue[0];
      const k = Math.min(c.want, Math.floor(b.goods + 1e-9));
      sell(s, k, c.kind, ev);
      c.want -= k;
      if (c.want <= 0) { s.queue.shift(); p -= 1; served++; }
    }
    if (p > 1) p = 1;
    s.prog.shop = p;
    s.done.shop += served; made(ev, "shop", served);
    if (b.goods < 0) b.goods = 0;
    shipCheck(s, ev);
  }

  function addCustomer(s, ev) {
    const pool = CUSTOMERS.filter((c) => c.stage <= s.stage);
    const c = pool[Math.floor(rand(s) * pool.length)];
    const want = c.min + Math.floor(rand(s) * (c.max - c.min + 1));
    s.queue.push({ kind: c.kind, want });
    ev.push({ kind: "arrive", who: c.kind });
  }

  // ---------------------------------------------------------------- 公開する関数
  function step(state, dt) {
    try {
      if (!okState(state)) return { state, events: [] };
      const s = clone(state);
      const ev = [];
      const d = isNum(dt) ? clamp(dt, 0, 1) : 0;
      if (d > 0) stepMut(s, d, ev);
      return { state: s, events: ev };
    } catch (e) { return { state, events: [] }; }
  }

  function rates(state) {
    try {
      if (!okState(state)) return null;
      const s = clone(state);
      const o = {};
      for (const id of IDS) o[id] = rateOf(s, id);
      return o;
    } catch (e) { return null; }
  }
  function bottleneck(state) {
    try { return okState(state) ? bottleneckS(clone(state)) : null; } catch (e) { return null; }
  }
  // もう強くできない部署（SZ-08・契約 §23）：人・台・きかい・マネージャーの どれも もう買えず、マネージャーは「はやい」（無料で切り替えられるので、
  // 「もうかる」なら まだ速くできる）。こや ではマネージャーを雇えないので、買える物が無ければ さいだい。使えない部署は false
  function maxedOutS(s, id) {
    if (!DEPT[id] || !unlocked(s.stage, id)) return false;
    for (const w of ["staff", "line", "level", "mgr"]) if (costOfS(s, id, w) !== null) return false;
    return s.stage < 2 || s.depts[id].mgr === "fast";
  }
  function maxedOut(state, dept) {
    try { return okState(state) ? maxedOutS(clone(state), dept) : false; } catch (e) { return false; }
  }
  function priceOf(state) {
    try { return okState(state) ? priceOfS(clone(state)) : null; } catch (e) { return null; }
  }
  function productOf(stage) { return isNum(stage) ? productOfStage(clamp(Math.floor(stage), 1, 4)) : null; }
  function costOf(state, dept, what) {
    try { return okState(state) ? costOfS(clone(state), dept, what) : null; } catch (e) { return null; }
  }

  function buyMut(s, dept, what) {
    if (!DEPT[dept] || !["staff", "line", "level", "mgr"].includes(what)) return "locked";
    if (!unlocked(s.stage, dept)) return "locked";
    const dep = DEPT[dept];
    if (what === "mgr" && s.stage < 2) return "locked";
    if (what === "staff" && dep.kind !== "staff") return "locked";
    if (what === "line" && dep.kind !== "line") return "locked";
    const c = costOfS(s, dept, what);
    if (c === null) return "max";
    if (s.money < c) return "money";
    s.money -= c;
    const d = s.depts[dept];
    if (what === "staff") d.staff += 1;
    else if (what === "line") d.lines += 1;
    else if (what === "level") d.level += 1;
    else d.mgr = "fast";
    return null;
  }
  function buy(state, dept, what) {
    try {
      if (!okState(state)) return { state, ok: false, reason: "locked", toolUp: null };
      const s = clone(state);
      const before = what === "level" && DEPT[dept] ? toolTier(s.depts[dept].level) : 0;
      const r = buyMut(s, dept, what);
      if (r) return { state, ok: false, reason: r, toolUp: null };
      let toolUp = null;
      if (what === "level") {
        const tier = toolTier(s.depts[dept].level);
        if (tier > before) toolUp = { dept, tier, name: TOOLS[dept][tier] };
      }
      return { state: s, ok: true, toolUp };
    } catch (e) { return { state, ok: false, reason: "locked", toolUp: null }; }
  }

  // ---------------------------------------------------------------- 道具の段階（§19.2）
  function toolTier(level) {
    if (!isNum(level)) return 0;
    let t = 0;
    for (let i = 1; i < TOOL_LV.length; i++) if (level >= TOOL_LV[i]) t = i;
    return t;
  }
  function toolOf(state, dept) {
    try {
      if (!okState(state) || typeof dept !== "string" || !DEPT[dept]) return null;
      const s = clone(state);
      if (!unlocked(s.stage, dept)) return null;
      const tier = toolTier(s.depts[dept].level);
      const next = tier + 1 < TOOL_LV.length ? { name: TOOLS[dept][tier + 1], lv: TOOL_LV[tier + 1] } : null;
      return { tier, name: TOOLS[dept][tier], next };
    } catch (e) { return null; }
  }
  function setMgr(state, dept, kind) {
    try {
      if (!okState(state) || !DEPT[dept] || (kind !== "fast" && kind !== "gain")) return { state, ok: false };
      const s = clone(state);
      if (!unlocked(s.stage, dept) || s.depts[dept].mgr === null) return { state, ok: false };
      s.depts[dept].mgr = kind;
      return { state: s, ok: true };
    } catch (e) { return { state, ok: false }; }
  }
  function boostMut(s, dept) {
    if (!DEPT[dept] || !unlocked(s.stage, dept)) return "locked";
    const d = s.depts[dept];
    if (s.t < d.cooldownUntil) return "cooldown";
    d.boostUntil = s.t + BOOST_SEC;
    d.cooldownUntil = s.t + BOOST_COOLDOWN;
    return null;
  }
  function boost(state, dept) {
    try {
      if (!okState(state)) return { state, ok: false, reason: "locked" };
      const s = clone(state);
      const r = boostMut(s, dept);
      return r ? { state, ok: false, reason: r } : { state: s, ok: true };
    } catch (e) { return { state, ok: false, reason: "locked" }; }
  }
  function callMut(s) {
    if (s.t < s.callUntil) return "cooldown";
    if (s.queue.length >= QUEUE_MAX) return "full";
    addCustomer(s, []);
    s.callUntil = s.t + CALL_COOLDOWN;
    return null;
  }
  function callCustomer(state) {
    try {
      if (!okState(state)) return { state, ok: false, reason: "full" };
      const s = clone(state);
      const r = callMut(s);
      return r ? { state, ok: false, reason: r } : { state: s, ok: true };
    } catch (e) { return { state, ok: false, reason: "full" }; }
  }
  function acceptOrder(state) {
    try {
      if (!okState(state) || !isObj(state.order) || state.order.accepted) return { state, ok: false };
      const s = clone(state);
      s.order.accepted = true;
      return { state: s, ok: true };
    } catch (e) { return { state, ok: false }; }
  }

  // 大口の注文をすぐ出す（デバッグ命令 neworder 用。こうば から・注文が無いときだけ）
  function forceOrder(state) {
    try {
      if (!okState(state)) return { state, ok: false };
      const s = clone(state);
      if (s.stage < ORDER_FROM_STAGE || s.order !== null) return { state, ok: false };
      const ev = [];
      newOrder(s, ev);
      return { state: s, ok: true, events: ev };
    } catch (e) { return { state, ok: false }; }
  }
  function canExpandS(s) {
    if (s.stage >= 4) return false;
    const g = STAGES[s.stage - 1];
    return s.goal.done >= g.goal && s.money >= g.cost;
  }
  function canExpand(state) { try { return okState(state) ? canExpandS(clone(state)) : false; } catch (e) { return false; } }
  function expandMut(s) {
    if (s.stage >= 4) return "max";
    const g = STAGES[s.stage - 1];
    if (s.goal.done < g.goal) return "goal";
    if (s.money < g.cost) return "money";
    s.money -= g.cost;
    const oldProduct = productOfStage(s.stage);
    // 古い売り物の山は今の値段で売れる（品が変わるときだけ）
    if (oldProduct !== productOfStage(s.stage + 1) && s.buf.goods >= 1) {
      const n = Math.floor(s.buf.goods);
      const before = s.money;
      s.money = addMoney(s.money, n * priceOfS(s));
      s.totals.sold += n;
      s.totals.earned = Math.min(MONEY_MAX, s.totals.earned + (s.money - before));
      s.buf.goods -= n;
      s.buf.goods = 0;
    }
    s.stage += 1;
    s.goal.done = 0;
    for (const x of DEPTS) if (x.kind === "line" && x.stage === s.stage && s.depts[x.id].lines < 1) { s.depts[x.id].lines = 1; s.depts[x.id].level = Math.max(s.depts[x.id].level, START_LEVEL[x.id] || 1); }
    if (s.stage === 4) s.ship.got = 0;
    return null;
  }
  function expand(state) {
    try {
      if (!okState(state)) return { state, ok: false, reason: "max" };
      const s = clone(state);
      const r = expandMut(s);
      return r ? { state, ok: false, reason: r } : { state: s, ok: true };
    } catch (e) { return { state, ok: false, reason: "max" }; }
  }

  function goalOf(state) {
    try {
      if (!okState(state)) return null;
      const s = clone(state);
      if (s.stage >= 4) {
        const need = shipNeed(s.ships);
        const done = Math.min(Math.floor(s.ship.got), need);
        const pn = PRODUCT_NAME[productOfStage(4)];
        const head = s.ships >= 1 ? `つぎの ふね：${pn}を つもう` : `おおきな ふねに ${pn}を つもう`;
        return { text: `${head}（${fmtInt(done)}/${fmtInt(need)}）`, done, need, kind: "ship" };
      }
      const g = STAGES[s.stage - 1];
      const done = Math.min(Math.floor(s.goal.done), g.goal);
      return { text: `${PRODUCT_NAME[g.product]}を ${fmtInt(g.goal)}${PRODUCT_UNIT[g.product]} うろう（${fmtInt(done)}/${fmtInt(g.goal)}）`, done, need: g.goal, kind: "sell" };
    } catch (e) { return null; }
  }

  function shipNeed(n) {
    let k = isNum(n) && n >= 0 ? Math.floor(n) : 0;
    if (k > 60) return SHIP_NEED_MAX;
    const v = Math.round((SHIP_BASE * Math.pow(SHIP_GROWTH, k)) / 100) * 100;
    return isNum(v) ? Math.min(SHIP_NEED_MAX, v) : SHIP_NEED_MAX;
  }

  // ---------------------------------------------------------------- 閉じた間（§4.3）
  function awaySeconds(savedAt, now) {
    if (!isNum(savedAt) || !isNum(now)) return 0;
    const d = now - savedAt;
    if (!(d >= 0)) return 0;
    return Math.min(Math.floor(d / 1000), OFFLINE_CAP_SEC);
  }
  function catchUpMut(s, seconds) {
    const sec = isNum(seconds) ? clamp(Math.floor(seconds), 0, OFFLINE_CAP_SEC) : 0;
    const capped = isNum(seconds) && seconds > OFFLINE_CAP_SEC;
    const effective = Math.floor(sec * AWAY_RATE);
    const startMoney = s.money;
    for (const id of IDS) { const d = s.depts[id]; if (d.boostUntil > s.t) d.boostUntil = s.t; }
    const madeN = zeroBy(IDS);
    const delivered = [];
    let sold = 0;
    const ev = [];
    for (let i = 0; i < effective; i++) {
      ev.length = 0;
      stepMut(s, OFFLINE_STEP, ev);
      for (const e of ev) {
        if (e.kind === "made") madeN[e.dept] += e.n;
        else if (e.kind === "sold") sold += e.n;
        else if (e.kind === "delivered") delivered.push(e.order);
        else if (e.kind === "ship") delivered.push({ ship: e.n, yen: e.yen, ending: e.ending });
      }
    }
    return { seconds: sec, effective, capped, earned: Math.max(0, s.money - startMoney), sold, made: madeN, delivered };
  }
  function catchUp(state, seconds) {
    try {
      if (!okState(state)) return { state, report: { seconds: 0, effective: 0, capped: false, earned: 0, sold: 0, made: zeroBy(IDS), delivered: [] } };
      const s = clone(state);
      const report = catchUpMut(s, seconds);
      return { state: s, report };
    } catch (e) { return { state, report: { seconds: 0, effective: 0, capped: false, earned: 0, sold: 0, made: zeroBy(IDS), delivered: [] } }; }
  }

  // ---------------------------------------------------------------- 開いたまま早送り（テスト用 advance・デバッグ ff。§17.1 A8）
  // catchUp と同じく写した state を中で書き換えながら STEP ずつ進める（step を繰り返したのと同じ結果。毎回写さないので軽い）。
  // events は画面が知りたいものだけ（order・delivered・goal・ship）。made・sold・arrive は数だけ report に入れる
  const FF_MAX_SEC = 86400;
  function fastForward(state, seconds) {
    const empty = { state, events: [], report: { seconds: 0, steps: 0, sold: 0, earned: 0 } };
    try {
      if (!okState(state)) return empty;
      const sec = isNum(seconds) ? clamp(seconds, 0, FF_MAX_SEC) : 0;
      const n = Math.round(sec / STEP);
      const s = clone(state);
      const startMoney = s.money;
      const out = [];
      const ev = [];
      let sold = 0;
      for (let i = 0; i < n; i++) {
        ev.length = 0;
        stepMut(s, STEP, ev);
        for (const e of ev) {
          if (e.kind === "sold") sold += e.n;
          else if (e.kind === "order" || e.kind === "delivered" || e.kind === "goal" || e.kind === "ship") out.push(e);
        }
      }
      return { state: s, events: out, report: { seconds: n * STEP, steps: n, sold, earned: Math.max(0, s.money - startMoney) } };
    } catch (e) { return empty; }
  }

  // ---------------------------------------------------------------- 表示
  function formatYen(n) {
    if (!isNum(n) || n <= 0) return "0 えん";
    n = Math.min(Math.floor(n), MONEY_MAX);
    if (n < 10000) return fmtInt(n) + " えん";
    const units = [[1e12, "ちょう"], [1e8, "おく"], [1e4, "まん"]];
    for (const [u, w] of units) {
      if (n >= u) {
        const v = n / u;
        if (v < 100) {
          const d = Math.floor(v * 10 + 1e-9) / 10;
          return (d % 1 === 0 ? String(d) : d.toFixed(1)) + w + " えん";
        }
        return String(Math.floor(v)) + w + " えん";
      }
    }
    return fmtInt(n) + " えん";
  }

  // ---------------------------------------------------------------- 保存（§8）
  function makeSave(state, savedAt) {
    try {
      if (!okState(state)) return null;
      const s = clone(state);
      const depts = {};
      for (const x of DEPTS) {
        const d = s.depts[x.id];
        depts[x.id] = x.kind === "line" ? { lines: d.lines, level: d.level, mgr: d.mgr } : { staff: d.staff, level: d.level, mgr: d.mgr };
      }
      return JSON.stringify({
        v: SAVE_VERSION, savedAt: isNum(savedAt) ? savedAt : null,
        stage: s.stage, cleared: s.cleared, money: s.money, t: s.t,
        forest: s.forest, buf: s.buf, depts,
        goal: s.goal, order: s.order, orderSeq: s.orderSeq, soldSinceOrder: s.soldSinceOrder,
        ships: s.ships, ship: s.ship, totals: s.totals,
        seed: s.seed, rng: s.rng
      });
    } catch (e) { return null; }
  }

  function loadSave(raw) {
    try {
      let o = raw;
      if (typeof raw === "string") { try { o = JSON.parse(raw); } catch (e) { return null; } }
      if (!isObj(o) || !isNum(o.v)) return null;
      if (o.v !== SAVE_VERSION) return null;
      const intIn = (x, lo, hi, d) => (isNum(x) ? clamp(Math.floor(x), lo, hi) : d);
      const numIn = (x, lo, hi, d) => (isNum(x) ? clamp(x, lo, hi) : d);
      const seed = isNum(o.seed) ? normSeed(o.seed) : 1;
      const s = newGame(seed);
      if (toU32(o.rng) !== null) s.rng = o.rng;
      s.stage = isNum(o.stage) && Math.floor(o.stage) === o.stage && o.stage >= 1 && o.stage <= 4 ? o.stage : 1;
      const si = s.stage - 1;
      s.money = intIn(o.money, 0, MONEY_MAX, 0);
      s.t = numIn(o.t, 0, 1e12, 0);
      const fcap = FOREST_CAP[si];
      const f = isObj(o.forest) ? o.forest : {};
      s.forest.trees = numIn(f.trees, 0, fcap, Math.min(10, fcap));
      s.forest.saplings = numIn(f.saplings, 0, fcap - s.forest.trees, 0);
      const b = isObj(o.buf) ? o.buf : {};
      for (const k of BUF_KEYS) s.buf[k] = intIn(b[k], 0, k === "goods" ? GOODS_CAP[si] : BUF_CAP[si], 0);
      const D = isObj(o.depts) ? o.depts : {};
      for (const x of DEPTS) {
        const has = isObj(D[x.id]);
        const src = has ? D[x.id] : {};
        const d = s.depts[x.id];
        const cap = CAPS[si][x.id];
        const open = x.stage <= s.stage;
        if (x.kind === "line") d.lines = open ? intIn(src.lines, 1, cap, 1) : 0;
        else { const lo = STAFF_START[x.id]; d.staff = intIn(src.staff, lo, cap, lo); }
        // 欄が無い（v25 までの保存の かんそう・かんな）：使える段なら 1台・START_LEVEL（§19.1.5）
        d.level = has ? intIn(src.level, 1, LEVEL_MAX, 1) : open ? (START_LEVEL[x.id] || 1) : 1;
        d.mgr = open && s.stage >= 2 && (src.mgr === "fast" || src.mgr === "gain") ? src.mgr : null;
      }
      const g = isObj(o.goal) ? o.goal : {};
      s.goal.done = intIn(g.done, 0, 1e15, 0);
      s.orderSeq = intIn(o.orderSeq, 0, 1e9, 0);
      s.soldSinceOrder = intIn(o.soldSinceOrder, 0, 1e12, 0);
      s.order = null;
      if (s.stage >= ORDER_FROM_STAGE && isObj(o.order)) {
        const r = o.order;
        const need = intIn(r.need, 1, 1e12, null);
        if (need !== null) {
          const big = r.big === true;
          // お礼が数でない・0 以下なら式で計算し直す（売値は読み込んだ段・マネージャーで決まるので、depts を読んだ後）
          const reward = isNum(r.reward) && r.reward > 0 ? intIn(r.reward, 1, MONEY_MAX, 1) : orderReward(need, priceOfS(s), big);
          s.order = {
            id: intIn(r.id, 0, 1e9, s.orderSeq), who: typeof r.who === "string" && r.who.length <= 40 ? r.who : bossesOf(s.stage)[0],
            need, got: intIn(r.got, 0, need - 1, 0), reward, accepted: r.accepted === true, big
          };
        }
      }
      if (s.stage === 4) {
        s.ships = intIn(o.ships, 0, SHIPS_MAX, 0);
        if (o.cleared === true && s.ships === 0) s.ships = 1;
        s.cleared = s.ships >= 1;
        const sh = isObj(o.ship) ? o.ship : {};
        s.ship.got = intIn(sh.got, 0, shipNeed(s.ships) - 1, 0);
      } else { s.ships = 0; s.cleared = false; s.ship.got = 0; }
      const T = isObj(o.totals) ? o.totals : {};
      for (const k of TOTAL_KEYS) s.totals[k] = intIn(T[k], 0, MONEY_MAX, 0);
      const savedAt = isNum(o.savedAt) ? o.savedAt : NaN;
      return { state: s, savedAt };
    } catch (e) { return null; }
  }

  function validateBest(raw) {
    const n = typeof raw === "number" ? raw : typeof raw === "string" && /^[0-5]$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
    return isNum(n) && Math.floor(n) === n && n >= 0 && n <= 5 ? n : 0;
  }
  function validateFlag(raw) { return raw === "1"; }

  // ---------------------------------------------------------------- 自動プレイ（§3.8）
  // いま買えるものの一覧（費用の安い順）
  function options(s, only) {
    const list = [];
    for (const id of IDS) {
      if (only && id !== only) continue;
      for (const w of ["staff", "line", "level", "mgr"]) {
        if (w !== "staff" && w !== "line" && countOf(s.depts[id], id) === 0) continue;   // 人のいない部署の きかい・マネージャーは買わない
        const c = costOfS(s, id, w);
        if (c !== null) list.push({ dept: id, what: w, cost: c });
      }
    }
    list.sort((a, b) => a.cost - b.cost);
    return list;
  }
  function setMgrModes(s) {
    const b = bottleneckS(s);
    for (const id of IDS) { const d = s.depts[id]; if (d.mgr !== null) d.mgr = id === b ? "fast" : "gain"; }
  }
  // greedy の1回の買い物。買えたら true
  function greedyBuy(s) {
    const b = bottleneckS(s);
    let cand = options(s, b);
    for (const id of IDS) if (id !== b) { const c = costOfS(s, id, "mgr"); if (c !== null) cand.push({ dept: id, what: "mgr", cost: c }); }
    if (!options(s, b).length) cand = options(s);
    cand.sort((x, y) => x.cost - y.cost);
    const c = cand[0];
    if (!c || s.money < c.cost) return false;
    buyMut(s, c.dept, c.what);
    setMgrModes(s);
    return true;
  }
  function countBuyable(s0) {
    const s = clone(s0);
    let n = 0;
    for (let i = 0; i < 1000; i++) {
      const o = options(s)[0];
      if (!o || s.money < o.cost) break;
      buyMut(s, o.dept, o.what);
      n++;
    }
    return n;
  }

  function simulate(policy, opts) {
    try {
      opts = isObj(opts) ? opts : {};
      const pol = ["greedy", "tapper", "idle"].includes(policy) ? policy : "greedy";
      const away = opts.away === "daily3" ? "daily3" : "none";
      const maxSec = isNum(opts.maxSec) ? opts.maxSec : 12 * 3600;          // 遊んだ（開いていた）秒の上限
      const extraShips = isNum(opts.ships) ? opts.ships : 0;                  // エンディングのあとに回す船の数
      const s = newGame(isNum(opts.seed) ? opts.seed : 1);
      const rep = {
        policy: pol, away, seed: s.seed, reached: { 2: null, 3: null, 4: null, end: null }, days: { 2: null, 3: null, 4: null, end: null },
        buys: 0, buysByStage: { 1: 0, 2: 0, 3: 0, 4: 0 }, timeByStage: { 1: 0, 2: 0, 3: 0, 4: 0 }, maxGapByStage: { 1: 0, 2: 0, 3: 0, 4: 0 }, maxGapAtByStage: { 1: null, 2: null, 3: null, 4: null },
        firstBuy: null, moneyMax: 0, expandEarn: {}, awayCheck: {}, ships: [], orders: 0, delivered: 0, t: 0, wall: 0, stuck: false, error: null, minTrees: Infinity
      };
      const ev = [];
      let lastBuy = 0;
      let wall = 0;                       // 実際の時計（秒、daily3 のとき）
      const SESSION = 300;
      const GAPS = [5 * 3600, 7 * 3600, 12 * 3600];   // 1日に3回（8時・13時・20時に開く）。開いてから次に開くまでの秒
      let sessionLeft = away === "daily3" ? SESSION : Infinity;
      let gapI = 0;
      let checkedHalf = { 1: false, 2: false, 3: false, 4: false };
      let i = 0;
      const stepsPerSec = Math.round(1 / STEP);
      // 節目の直後の稼ぎ（§19.1.4）：1 秒ごとの totals.earned を残し、広げる直前・直後の 10 分（えん/分）を比べる
      const earnAt = [];
      const expMark = {};
      while (s.t < maxSec) {
        ev.length = 0;
        stepMut(s, STEP, ev);
        i++;
        wall += STEP;
        for (const e of ev) {
          if (e.kind === "order") rep.orders++;
          else if (e.kind === "delivered") rep.delivered++;
          else if (e.kind === "ship") rep.ships.push({ n: e.n, t: s.t, yen: e.yen, ending: e.ending });
        }
        if (s.money > rep.moneyMax) rep.moneyMax = s.money;
        if (s.forest.trees < rep.minTrees) rep.minTrees = s.forest.trees;
        if (!s.cleared) rep.timeByStage[s.stage] += STEP;   // 買い物の間隔はエンディングまでで測る
        if (typeof opts.trace === "function" && i % (stepsPerSec * 300) === 0) opts.trace(clone(s), bottleneckS(s));
        if (i % stepsPerSec === 0) earnAt.push(s.totals.earned);
        if (i % stepsPerSec === 0 && pol !== "idle") {
          // 1秒ごとの判断
          if (s.order && !s.order.accepted) s.order.accepted = true;
          if (canExpandS(s)) {
            const eb = s.totals.earned, sec0 = earnAt.length - 1;
            expandMut(s);
            expMark[s.stage] = { sec: sec0, before: eb, after: s.totals.earned };
            setMgrModes(s);
            rep.reached[s.stage] = s.t;
            rep.days[s.stage] = wall / 86400;
          } else {
            const g = s.stage < 4 ? STAGES[s.stage - 1] : null;
            const saving = g && s.goal.done >= g.goal;
            const stBefore = s.stage, clearedBefore = s.cleared;
            if (!saving && greedyBuy(s) && !clearedBefore) {
              rep.buys++; rep.buysByStage[stBefore]++;
              if (rep.firstBuy === null) rep.firstBuy = s.t;
              const gap = s.t - lastBuy;
              if (gap > rep.maxGapByStage[stBefore]) { rep.maxGapByStage[stBefore] = gap; rep.maxGapAtByStage[stBefore] = s.t; }
              lastBuy = s.t;
            }
            setMgrModes(s);
          }
          if (pol === "tapper") {
            for (const id of IDS) if (unlocked(s.stage, id)) boostMut(s, id);
            callMut(s);
          }
          // 段の半ばで「2時間の るす」の稼ぎを測る
          if (s.stage < 4 && !checkedHalf[s.stage] && s.goal.done >= STAGES[s.stage - 1].goal / 2) {
            checkedHalf[s.stage] = true;
            rep.awayCheck[s.stage] = awayProbe(s);
          } else if (s.stage === 4 && !checkedHalf[4] && s.ship.got >= shipNeed(0) / 2) {
            checkedHalf[4] = true;
            rep.awayCheck[4] = awayProbe(s);
          }
        }
        if (s.ships >= 1 && rep.reached.end === null) { rep.reached.end = s.t; rep.days.end = wall / 86400; }
        if (s.ships >= 1 + extraShips) break;
        // daily3：開いている時間を使い切ったら、閉じて catchUp
        if (away === "daily3") {
          sessionLeft -= STEP;
          if (sessionLeft <= 1e-9) {
            const gap = GAPS[gapI % 3] - SESSION;
            gapI++;
            const r = catchUpMut(s, gap);
            for (const d of r.delivered) if (d.ship) rep.ships.push({ n: d.ship, t: s.t, yen: d.yen, ending: d.ending, away: true });
            if (s.ships >= 1 && rep.reached.end === null) { rep.reached.end = s.t; rep.days.end = (wall + gap) / 86400; }
            wall += gap;
            sessionLeft = SESSION;
            if (s.ships >= 1 + extraShips) break;
          }
        }
      }
      for (const k in expMark) {
        const m = expMark[k];
        if (m.sec >= 600 && m.sec + 600 < earnAt.length) rep.expandEarn[k] = { before: (m.before - earnAt[m.sec - 600]) / 10, after: (earnAt[m.sec + 600] - m.after) / 10 };
      }
      rep.t = s.t;
      rep.wall = wall;
      rep.final = { stage: s.stage, money: s.money, ships: s.ships, totals: Object.assign({}, s.totals), depts: JSON.parse(JSON.stringify(s.depts)), trees: s.forest.trees };
      rep.avgGapByStage = {};
      for (const k of [1, 2, 3, 4]) rep.avgGapByStage[k] = rep.buysByStage[k] ? rep.timeByStage[k] / rep.buysByStage[k] : null;
      if (pol === "idle") rep.stuck = s.totals.sold === 0;
      return rep;
    } catch (e) { return { error: String(e && e.message || e) }; }
  }
  // 2時間の るす（半分の速さ）で、お金 0 から稼いだ額と、それで買える数・起動後5分と合わせて買える数
  function awayProbe(s0) {
    const s = clone(s0);
    s.money = 0;
    const r = catchUpMut(s, OFFLINE_CAP_SEC);
    const n1 = countBuyable(s);
    const ev = [];
    for (let i = 0; i < 3000; i++) { ev.length = 0; stepMut(s, STEP, ev); }
    const n2 = countBuyable(s);
    return { earned: r.earned, buyable: n1, buyable5: n2 };
  }

  const api = {
    NAME, DEPTS, STAGES, CUSTOMERS, PRICE, STAGE_MUL, STAFF_COST, LEVEL_COST, LINE_COST, MGR_COST, CAPS,
    BASE_TIME, CUST_EVERY, WOOD, PRODUCT_NAME, PRODUCT_UNIT, STAFF_START, QUEUE_MAX, PLANKS_PER_BEAM,
    STAFF_GROWTH, LEVEL_GROWTH, LINE_GROWTH, MGR_FAST, MGR_GAIN, BOOST_MUL,
    LEVEL_MAX, MONEY_MAX, BUF_CAP, GOODS_CAP, FOREST_CAP, GROW_TIME, NATURAL_REGROW,
    BOOST_SEC, BOOST_COOLDOWN, CALL_COOLDOWN, ORDER_EVERY, ORDER_GAP_SEC, ORDER_MIN_SEC, ORDER_MAX_SEC, ORDER_REWARD_MUL,
    ORDER_FROM_STAGE, ORDER_BIG_RATE, ORDER_BIG_NEED, ORDER_BIG_REWARD, ORDER_BOSSES, FF_MAX_SEC,
    SHIP_BASE, SHIP_GROWTH, SHIP_NEED_MAX, SHIPS_MAX, SHIP_REWARD_MUL,
    STEP, OFFLINE_CAP_SEC, OFFLINE_STEP, AWAY_RATE, AWAY_CARD_MIN_SEC,
    SAVE_VERSION, SAVE_KEY, SAVE_KEY_BAK, SAVE_KEY_BEST, SAVE_KEY_HELP,
    START_LEVEL, TOOL_LV, TOOLS,
    speedMul, toolTier, toolOf,
    newGame, step, rates, bottleneck, maxedOut, priceOf, productOf, costOf, buy, setMgr, boost, callCustomer, acceptOrder, forceOrder,
    canExpand, expand, goalOf, shipNeed, awaySeconds, catchUp, fastForward, formatYen, makeSave, loadSave, validateBest, validateFlag, simulate
  };
  return Object.freeze(api);
});
