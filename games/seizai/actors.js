/*
 * もくもくこうば — 小さな人の動き（見た目だけ）
 * 契約：docs/seizai-contract.md §6（描画と人の動き）。担当B だけが編集する。
 *
 * SeizaiActors.create(rng) → {
 *   sync(state, events, dt),   // logic の state（人数・台数・done の増え方・rates）に合わせて人を増減し、動かす
 *   list() → [{ id, role, dept, x, y, pose, carry, tool, active, look, dir }],   // 世界の座標（幅 360 の単位、足もと）
 *   all()  → 中の配列（描画用。書きかえない）, slots() → 森の木の場所, drain() → 演出のきっかけ, setCalm(bool)
 * }
 * SeizaiActors.geometry(stage) → 段ごとの配置（世界の座標）。render.js と共有する
 * - 人の数・速さは state から決める。位置は保存しない（開き直したら持ち場に並べ直す）
 * - done[dept] が増えたら、その部署の誰かが「できた」動き。1 フレームに部署ごと 3 回まで（早送り・るすの あいだは省く）
 * - 人の数の上限 MAX_ACTORS = 66（§19.3.1）。超える分はお客さんから省く（§6.4）
 * - こうじょう から工場は 2 つの帯（上「さぎょうば」＝ かわむき・かくざい、下「しあげ」＝ かんそう・いた（・かんな））。§19.3.1
 * - 道具の段（logic の toolTier。Lv 1・5・15・30）ごとに、作業の手の動きを ANIM_MUL 倍に（見た目だけ。§19.2.2）
 * - はこぶ の人は logic が実際に運んだ数（done.carry の増え）で往復する。待つ理由は「最近 作っていない」ときだけ（§20 E1・E2）
 *   why() → その E2 の結果（render の吹き出しと main.js の文が同じものを使う）、carryTrips() → 丸太を持って門に着いた回数
 */
(function (root) {
  "use strict";

  const W = 360;
  const STAGE_H = { 1: 640, 2: 760, 3: 1180, 4: 1300 };
  const HARBOR_H = 180;
  const ROWS = { 1: 2, 2: 3, 3: 4, 4: 4 };
  const ROW_H = { 1: 64, 2: 66, 3: 66, 4: 66 };
  const BAND_HEAD = 30;
  // 流れの順（step の中の順。§19.1.1）
  const DEPT_IDS = ["cut", "plant", "carry", "peel", "beam", "dry", "plank", "plane", "shop"];
  const DEPT_FROM = { cut: 1, plant: 1, carry: 1, peel: 1, beam: 2, dry: 3, plank: 3, plane: 4, shop: 1 };
  const ROLE_OF = { cut: "cutter", plant: "planter", carry: "carrier", peel: "peeler", beam: "beamer", dry: "dryer", plank: "planker", plane: "planer", shop: "seller" };
  const LINE_DEPTS = { peel: 1, beam: 1, dry: 1, plank: 1, plane: 1 };
  // 道具の段ごとの手の動きの速さ（見た目だけ。logic には置かない §19.2.2）
  const ANIM_MUL = [1, 1.3, 1.6, 2];
  // はこぶ の 1 回に運ぶ数の見た目（てで・ておしぐるま・にぐるま・トラック）
  const CARRY_LOAD = [1, 2, 4, 6];
  const MAX_ACTORS = 66;
  const MAX_LEAVING = 4;
  const MAX_MADE = 3;
  const WALK = 46, WALK_CALM = 26;
  const DEF = { FOREST_CAP: [12, 16, 20, 24], BUF_CAP: [20, 30, 40, 60], GOODS_CAP: [50, 100, 200, 400] };

  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clampStage = (s) => { const n = Math.floor(num(s, 1)); return n >= 1 && n <= 4 ? n : 1; };
  const Lg = () => root.SeizaiLogic || {};

  // 段ごとの表（配列 [こや, こうば, …]・[_, こや, …]・{1:…} のどれでも読む）
  function byStage(tbl, stage, dflt) {
    if (Array.isArray(tbl)) return num(tbl.length >= 5 ? tbl[stage] : tbl[stage - 1], dflt);
    if (tbl && typeof tbl === "object") return num(tbl[stage], dflt);
    return dflt;
  }
  function capsOf(stage) {
    const L = Lg();
    return {
      forest: Math.max(1, Math.round(byStage(L.FOREST_CAP, stage, DEF.FOREST_CAP[stage - 1]))),
      buf: byStage(L.BUF_CAP, stage, DEF.BUF_CAP[stage - 1]),
      goods: byStage(L.GOODS_CAP, stage, DEF.GOODS_CAP[stage - 1])
    };
  }
  function outOf(dept, stage) {
    if (dept === "cut") return "yard";
    if (dept === "carry") return "logs";
    if (dept === "peel") return stage === 1 ? "goods" : "peeled";
    if (dept === "beam") return stage === 2 ? "goods" : "beams";
    if (dept === "dry") return "dried";
    if (dept === "plank") return stage >= 4 ? "planks" : "goods";
    if (dept === "plane") return "goods";
    return null;
  }
  // 前の工程から来る品（置き場の山・待つ理由）
  function inOf(dept, stage) {
    if (dept === "carry") return "yard";
    if (dept === "peel") return "logs";
    if (dept === "beam") return "peeled";
    if (dept === "dry") return "beams";
    if (dept === "plank") return stage >= 3 ? "dried" : "beams";
    if (dept === "plane") return "planks";
    return null;
  }
  // 道具の段（0〜3）。logic の toolTier を使う（表は logic だけが持つ §19.2.1）
  function tierOf(state, dept) {
    const L = Lg();
    const d = state && state.depts && state.depts[dept];
    if (!d || typeof L.toolTier !== "function") return 0;
    let t = 0;
    try { t = L.toolTier(d.level); } catch (e) { t = 0; }
    t = Math.floor(num(t, 0));
    return t >= 0 && t <= 3 ? t : 0;
  }

  // ===== 待っている理由（見た目と main.js の文で共有。§6.1・§18・§20 E2）=====
  // 部署ごとに "in"（前の工程の品が来ない）・"out"（置き場が いっぱい）・""（待っていない）
  // plant の "in" は「切り株が無い」＝ きこりを待っている。cut の "in" は「切れる木が無い」＝ なえぎ（森）を待っている
  // lastMade（{ 部署: その部署が最後に作った state.t }）を渡すと、"in" は「前の品が 1 未満 かつ 最近 何も作っていない」ときだけ（§20 E2）。
  //   最近＝ clamp(2 ÷ rates[部署], 3, 15) 秒以内（速さ 0 なら すぐ待ち。作った時刻を知らない・時計が戻ったときも待ち）。
  //   rates を渡さなければ logic の rates(state) を使う。lastMade を渡さなければ その瞬間の置き場だけで決める（§18 のまま）
  function graceOf(rate) { return rate > 0 ? clamp(2 / rate, 3, 15) : 0; }
  function waitOf(state, lastMade, ratesIn) {
    const o = { cut: "", plant: "", carry: "", peel: "", beam: "", dry: "", plank: "", plane: "", shop: "" };
    if (!state || typeof state !== "object") return o;
    let idle = () => true;
    if (lastMade && typeof lastMade === "object") {
      let rates = ratesIn;
      if (!rates || typeof rates !== "object") { try { rates = typeof Lg().rates === "function" ? Lg().rates(state) : null; } catch (e) { rates = null; } }
      rates = rates || {};
      const now = num(state.t, 0);
      idle = (d) => {
        const r = num(rates[d], 0), last = lastMade[d];
        if (!(r > 0) || typeof last !== "number" || !Number.isFinite(last) || now < last) return true;
        return now - last > graceOf(r);
      };
    }
    const stage = clampStage(state.stage);
    const caps = capsOf(stage);
    const buf = state.buf || {}, f = state.forest || {};
    const v = (k) => num(buf[k], 0);
    const full = (k) => (k === "goods" ? v(k) >= caps.goods - 1e-6 : v(k) >= caps.buf - 1e-6);
    const trees = num(f.trees, 0), saps = num(f.saplings, 0);
    const stumps = caps.forest - trees - saps;
    const qlen = Array.isArray(state.queue) ? state.queue.length : 0;
    o.cut = trees < 1 && idle("cut") ? "in" : full("yard") ? "out" : "";
    o.plant = stumps < 1 && idle("plant") ? "in" : "";
    o.carry = v("yard") < 1 && idle("carry") ? "in" : full("logs") ? "out" : "";
    for (const d of ["peel", "beam", "dry", "plank", "plane"]) {
      if (stage < DEPT_FROM[d]) continue;
      o[d] = v(inOf(d, stage)) < 1 && idle(d) ? "in" : full(outOf(d, stage)) ? "out" : "";
    }
    o.shop = qlen > 0 && v("goods") < 1 && idle("shop") ? "in" : "";
    return o;
  }

  // ===== 配置（世界の座標。幅 360、高さは段ごと）=====
  // こや・こうば は工場が 1 つの帯。こうじょう から 2 つの帯（上「さぎょうば」・下「しあげ」。§19.3.1）
  function geometry(stageIn) {
    const stage = clampStage(stageIn);
    const H = STAGE_H[stage];
    const rows = ROWS[stage], rowH = ROW_H[stage];
    const fTop = 290;
    const COLS2 = [[4, 178], [182, 356]], COLS3 = [[4, 118], [122, 238], [242, 356]];
    const bandDefs = stage === 1 ? [{ name: "", depts: ["peel"], xs: [[4, 356]] }]
      : stage === 2 ? [{ name: "", depts: ["peel", "beam"], xs: COLS2 }]
      : stage === 3 ? [{ name: "さぎょうば", depts: ["peel", "beam"], xs: COLS2 }, { name: "しあげ", depts: ["dry", "plank"], xs: COLS2 }]
      : [{ name: "さぎょうば", depts: ["peel", "beam"], xs: COLS2 }, { name: "しあげ", depts: ["dry", "plank", "plane"], xs: COLS3 }];
    const zones = {
      cut: { x: 4, y: 38, w: 228, h: 166 },
      plant: { x: 236, y: 38, w: 120, h: 166 },
      carry: { x: 4, y: 210, w: 352, h: 76 }
    };
    const cols = [], bands = [];
    let y = fTop;
    bandDefs.forEach((bd, bi) => {
      const y0 = y, rt = y0 + BAND_HEAD, y1 = rt + rows * rowH + 8;
      const bcols = bd.depts.map((d, i) => {
        const [x0, x1] = bd.xs[i];
        zones[d] = { x: x0, y: y0 + 4, w: x1 - x0, h: y1 - y0 - 8 };
        const c = { dept: d, x0, x1, cx: (x0 + x1) / 2, tableX: x0 + (x1 - x0) * 0.62, y0, y1, rowTop: rt, band: bi };
        cols.push(c);
        return c;
      });
      bands.push({ name: bd.name, y0, y1, rowTop: rt, cols: bcols });
      y = y1;
    });
    const fBot = y;
    const sTop = fBot, sBot = stage === 4 ? H - HARBOR_H : H;
    zones.goods = { x: 4, y: sTop + 6, w: 140, h: 116 };
    zones.shop = { x: 148, y: sTop + 6, w: 208, h: 116 };
    const order = ["cut", "plant", "carry", "peel", "beam", "dry", "plank", "plane", "goods", "shop"].filter((d) => zones[d]);
    const hy = H - HARBOR_H;
    return {
      stage, W, H,
      forest: { y0: 34, y1: 206, rows: [124, 198] },
      road: { y0: 206, y1: 290, walkY: 266, yardX: 44, gateX: 330 },
      factory: { y0: fTop, y1: fBot, rowTop: bands[0].rowTop, rowH, rows, cols, bands },
      shop: { y0: sTop, y1: sBot, counterY: sTop + 70, sellerY: sTop + 68, queueY: sTop + 116, leaveY: sTop + 136, pileX: 74, pileY: sTop + 100 },
      harbor: stage === 4 ? { y0: hy, y1: H, pierY: hy + 54, seaY: hy + 60, shipX: 236 } : null,
      zones, order
    };
  }
  function colOf(geo, dept) {
    for (const c of geo.factory.cols) if (c.dept === dept) return c;
    return null;
  }
  function station(geo, dept, i) {
    const c = colOf(geo, dept);
    if (!c) return null;
    const r = clamp(i, 0, geo.factory.rows - 1);
    const fy = num(c.rowTop, geo.factory.rowTop) + r * geo.factory.rowH + geo.factory.rowH - 10;
    return { wx: c.tableX - 40, wy: fy, tx: c.tableX, ty: fy };
  }

  function mulberry(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function create(rngIn) {
    const rand = typeof rngIn === "function" ? rngIn : mulberry(num(rngIn, 20261020));
    const rnd = () => { const v = Number(rand()); return Number.isFinite(v) ? v - Math.floor(v) : 0.5; };
    let actors = [];
    let slots = [];
    let effects = [];
    let geo = null;
    let first = true;
    let calm = false;
    let nextId = 1;
    let prevDone = {};
    let clk = 0;
    let info = null;
    let ratesFor = null, ratesMemo = null;
    // §20：部署ごとに最後に作った時刻（state.t）、はこぶ の「運べる券」（logic が実際に運んだ数 ÷ 1 回に運ぶ数）、門に着いた回数
    let lastMade = {};
    let tickets = 0;
    let carryTrips = 0;

    // ===== 森の木の場所 =====
    function slotPositions(cap) {
      const cols = Math.ceil(cap / 2);
      const out = [];
      for (let i = 0; i < cap; i++) {
        const col = Math.floor(i / 2), row = i % 2;
        out.push({ x: 14 + (col + 0.5) * (332 / cols) + (row ? 5 : -5), y: geo.forest.rows[row] });
      }
      return out;
    }
    function claimedBy(i, role) {
      for (const a of actors) if (a.role === role && a.slot === i && a.pose !== "walk") return true;
      return false;
    }
    // pend：0 ＝ 植える前（ただの切り株）だけ、1 ＝ なえぎの人が向かう切り株（logic では もう苗木）だけ、-1 ＝ どちらでも
    function pickSlot(kind, role, pend) {
      const cands = [];
      for (let i = 0; i < slots.length; i++) {
        const sl = slots[i];
        if (sl.kind !== kind) continue;
        if (pend === 0 && sl.pend) continue;
        if (pend === 1 && !sl.pend) continue;
        cands.push(i);
      }
      if (!cands.length) return -1;
      for (const i of cands) if (claimedBy(i, role)) return i;
      return cands[Math.floor(rnd() * cands.length)];
    }
    // いちばん新しく切られた切り株（きこりが切った所へ なえぎが歩いて行く）
    function newestStump() {
      let best = -1, at = -Infinity;
      for (let i = 0; i < slots.length; i++) {
        const sl = slots[i];
        if (sl.kind !== "stump" || sl.pend) continue;
        if (sl.cutAt > at || best < 0) { best = i; at = sl.cutAt; }
      }
      return best;
    }
    function crewOf(role) { let n = 0; for (const a of actors) if (a.role === role && !a.leaving) n++; return n; }
    function pendCount() { let n = 0; for (const sl of slots) if (sl.pend) n++; return n; }
    function plantNow(i) {
      const sl = slots[i];
      sl.kind = "sapling"; sl.pend = false; sl.pendT = 0; sl.grow = 0;
    }
    function syncForest(state, stage, replace) {
      const caps = capsOf(stage);
      const cap = caps.forest;
      const f = state.forest || {};
      const T = clamp(Math.floor(num(f.trees, 0)), 0, cap);
      // 見える切り株の数は floor（logic の切り株）にそろえる（切り株が 1 つ未満で なえぎが待つ間に、切り株が見えない。§18）
      const stumpsL = cap - num(f.trees, 0) - num(f.saplings, 0);
      const S = clamp(cap - T - Math.max(0, Math.floor(stumpsL + 1e-9)), 0, cap - T);
      if (replace || slots.length !== cap) {
        const pos = slotPositions(cap);
        const order = pos.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
        slots = pos.map((p) => ({ x: p.x, y: p.y, kind: "stump", fall: 0, grow: 1, pend: false, pendT: 0, cutAt: -1 }));
        order.forEach((idx, k) => { slots[idx].kind = k < T ? "tree" : k < T + S ? "sapling" : "stump"; });
        return;
      }
      // 「なえぎの人が向かっている切り株」（pend）は logic では もう苗木。植え終わるまで切り株のまま見せる（§18）
      let t = 0, s = 0;
      for (const sl of slots) { if (sl.kind === "tree") t++; else if (sl.kind === "sapling" || sl.pend) s++; }
      let guard = 200;
      while (t > T && guard--) {
        const i = pickSlot("tree", "cutter", -1); if (i < 0) break;
        const sl = slots[i];
        sl.kind = "stump"; sl.pend = false; sl.cutAt = clk; t--;
        if (!calm) effects.push({ kind: "fall", x: sl.x, y: sl.y, dir: rnd() < 0.5 ? -1 : 1 });
      }
      while (s > S && t < T && guard--) {
        let i = pickSlot("sapling", "-", -1);
        if (i < 0) i = pickSlot("stump", "-", 1);
        if (i < 0) break;
        slots[i].kind = "tree"; slots[i].pend = false; slots[i].grow = 0; s--; t++;
      }
      while (t < T && guard--) {
        let i = pickSlot("stump", "-", 0);
        if (i < 0) { i = pickSlot("stump", "-", 1); if (i >= 0) s--; }
        if (i < 0) break;
        slots[i].kind = "tree"; slots[i].pend = false; slots[i].grow = 0; t++;
      }
      while (s > S && guard--) {
        let i = pickSlot("stump", "-", 1);
        if (i >= 0) { slots[i].pend = false; s--; continue; }
        i = pickSlot("sapling", "-", -1); if (i < 0) break;
        slots[i].kind = "stump"; s--;
      }
      const crew = crewOf("planter");
      while (s < S && guard--) {
        // その切り株の横に なえぎの人が立っていれば、すぐ植わる
        let i = -1;
        for (let k = 0; k < slots.length; k++) if (slots[k].kind === "stump" && !slots[k].pend && claimedBy(k, "planter")) { i = k; break; }
        if (i >= 0) { plantNow(i); s++; continue; }
        // なえぎの人がいれば、いちばん新しい切り株へ歩いて行って植える（向かう先が多すぎるときは すぐ植わる）
        if (crew > 0 && pendCount() < crew * 2 + 1) {
          i = newestStump(); if (i < 0) break;
          slots[i].pend = true; slots[i].pendT = 0; s++;
          continue;
        }
        i = pickSlot("stump", "-", 0); if (i < 0) break;
        plantNow(i); s++;
      }
    }

    // ===== 流れの様子（つまり・応援）=====
    function flowInfo(state, stage) {
      const caps = capsOf(stage);
      const buf = state.buf || {}, depts = state.depts || {};
      const v = (k) => num(buf[k], 0);
      const full = (k) => (k === "goods" ? v(k) >= caps.goods - 1e-6 : v(k) >= caps.buf - 1e-6);
      const qlen = Array.isArray(state.queue) ? state.queue.length : 0;
      const t = num(state.t, 0);
      const boosted = {};
      for (const d of DEPT_IDS) boosted[d] = !!(depts[d] && num(depts[d].boostUntil, -1) > t);
      // rates は state を写すので、同じ state の間は前の値を使う（step は 0.1 秒ごと。性能 §6.4）
      let rates = null;
      if (state === ratesFor) rates = ratesMemo;
      else {
        try { rates = typeof Lg().rates === "function" ? Lg().rates(state) : null; } catch (e) { rates = null; }
        ratesFor = state; ratesMemo = rates;
      }
      const why = waitOf(state, lastMade, rates || {});
      const stuck = {}, tier = {};
      for (const d of DEPT_IDS) { stuck[d] = !!why[d]; tier[d] = tierOf(state, d); }
      return {
        stuck, why, tier,
        goodsEmpty: v("goods") < 1,
        qlen, boosted, rates: rates || {}, yard: v("yard"), logsFull: full("logs")
      };
    }
    function countOf(state, dept, stage) {
      if (stage < DEPT_FROM[dept]) return 0;
      const d = (state.depts || {})[dept];
      if (!d) return 0;
      const n = LINE_DEPTS[dept] ? num(d.lines, 0) : num(d.staff, 0);
      return clamp(Math.floor(n), 0, 12);
    }

    // ===== 人の出入り =====
    function homeOf(a) {
      const z = geo.zones;
      switch (a.role) {
        case "cutter": return { x: 20 + (a.idx % 8) * 26, y: geo.forest.rows[1] };
        case "planter": return { x: 252 + (a.idx % 4) * 26, y: geo.forest.rows[1] };
        case "carrier": return { x: geo.road.yardX + (a.idx % 4) * 8, y: laneY(a) };
        case "seller": return { x: 172 + a.idx * 28, y: geo.shop.sellerY };
        case "customer": return { x: 190 + a.qi * 27, y: geo.shop.queueY };
        case "sailor": return { x: 40 + a.idx * 70, y: geo.harbor ? geo.harbor.pierY : geo.H - 20 };
        case "manager": {
          const zz = z[a.dept] || z.carry;
          return { x: zz.x + zz.w - 16, y: zz.y + zz.h - 8 };
        }
        default: {
          const st = station(geo, a.dept, a.idx);
          return st ? { x: st.wx, y: st.wy } : { x: W / 2, y: geo.H / 2 };
        }
      }
    }
    function laneY(a) { return geo.road.walkY - 9 + (a.idx % 4) * 6; }
    function makeActor(role, dept, idx, spawn) {
      const a = {
        id: nextId++, role, dept, idx, qi: 0, x: 0, y: 0, tx: 0, ty: 0, pose: "work", carry: null, tool: null,
        active: false, look: 0, dir: 1, slot: -1, phase: "", wait: 0, bow: 0, ph: rnd() * 6.28, leaving: false, walkIn: false
      };
      const h = homeOf(a);
      if (spawn) {
        const fromLeft = h.x > W / 2 ? false : true;
        a.x = fromLeft ? -14 : W + 14;
        a.y = h.y;
        a.walkIn = true;
      } else { a.x = h.x; a.y = h.y; }
      a.tx = h.x; a.ty = h.y;
      if (role === "carrier") { a.phase = rnd() < 0.5 ? "toGate" : "toYard"; if (!spawn) a.x = geo.road.yardX + rnd() * (geo.road.gateX - geo.road.yardX); a.carry = a.phase === "toGate" ? "log" : null; }
      if (role === "sailor") { a.phase = "toShip"; a.carry = "plank"; }
      return a;
    }
    function syncGroup(role, dept, n, replace) {
      const mine = [];
      for (const a of actors) if (a.role === role && a.dept === dept && !a.leaving) mine.push(a);
      mine.sort((p, q) => p.idx - q.idx);
      if (mine.length > n) {
        const drop = new Set(mine.slice(n).map((a) => a.id));
        actors = actors.filter((a) => !drop.has(a.id));
      } else {
        for (let i = mine.length; i < n; i++) {
          const a = makeActor(role, dept, i, !replace);
          if (role === "manager" && !replace) a.bow = 1.2;
          actors.push(a);
          if (!replace && !calm && role !== "manager") effects.push({ kind: "hello", x: homeOf(a).x, y: homeOf(a).y, dept });
        }
      }
    }
    function syncRoster(state, stage, replace) {
      const depts = state.depts || {};
      for (const d of DEPT_IDS) syncGroup(ROLE_OF[d], d, countOf(state, d, stage), replace);
      for (const d of DEPT_IDS) {
        const m = depts[d] && (depts[d].mgr === "fast" || depts[d].mgr === "gain") && stage >= DEPT_FROM[d] ? depts[d].mgr : null;
        syncGroup("manager", d, m ? 1 : 0, replace);
        if (m) for (const a of actors) if (a.role === "manager" && a.dept === d) a.tool = m;
      }
      syncGroup("sailor", "ship", stage === 4 ? 2 : 0, replace);
    }
    function lookOf(kind) {
      const C = Lg().CUSTOMERS;
      if (Array.isArray(C)) {
        for (let i = 0; i < C.length; i++) { const c = C[i]; if (c === kind || (c && (c.id === kind || c.kind === kind || c.name === kind))) return i % 4; }
      } else if (C && typeof C === "object" && kind in C) {
        return Object.keys(C).indexOf(kind) % 4;
      }
      if (typeof kind === "number") return Math.abs(Math.floor(kind)) % 4;
      const s = String(kind || "");
      let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return h % 4;
    }
    function syncCustomers(state, events, replace) {
      const q = Array.isArray(state.queue) ? state.queue.slice(0, 6) : [];
      let waiting = actors.filter((a) => a.role === "customer" && !a.leaving).sort((p, r) => p.qi - r.qi);
      if (replace) {
        actors = actors.filter((a) => a.role !== "customer");
        waiting = [];
      }
      let arrivals = 0;
      if (Array.isArray(events)) for (const e of events) if (e && e.kind === "arrive") arrivals++;
      let leave = clamp(waiting.length + arrivals - q.length, 0, waiting.length);
      if (leave === 0 && waiting.length > q.length) leave = waiting.length - q.length;
      for (let i = 0; i < leave; i++) {
        const a = waiting[i];
        a.leaving = true; a.carry = "goods"; a.pose = "carry"; a.tx = W + 18; a.ty = geo.shop.leaveY;
      }
      waiting = waiting.slice(leave);
      for (let i = waiting.length; i < q.length; i++) {
        const a = makeActor("customer", "shop", 0, false);
        a.qi = i;
        const h = homeOf(a);
        if (replace) { a.x = h.x; a.y = h.y; } else { a.x = W + 16; a.y = h.y; a.walkIn = true; }
        waiting.push(a);
        actors.push(a);
      }
      waiting.forEach((a, i) => {
        a.qi = i;
        const item = q[i];
        a.look = lookOf(item && typeof item === "object" ? item.kind : item);
        a.want = item && typeof item === "object" ? num(item.want, 1) : 1;
      });
      // 帰る人が多すぎるときは古い順に消す
      const leaving = actors.filter((a) => a.role === "customer" && a.leaving);
      if (leaving.length > MAX_LEAVING) {
        const drop = new Set(leaving.slice(0, leaving.length - MAX_LEAVING).map((a) => a.id));
        actors = actors.filter((a) => !drop.has(a.id));
      }
      // 人の数の上限（お客さんから省く。帰る人 → 列の後ろ）
      let over = actors.length - MAX_ACTORS;
      if (over > 0) {
        const cust = actors.filter((a) => a.role === "customer").sort((p, r) => (r.leaving - p.leaving) || (r.qi - p.qi));
        const drop = new Set(cust.slice(0, over).map((a) => a.id));
        actors = actors.filter((a) => !drop.has(a.id));
      }
    }

    // ===== できた（done の増え方）=====
    // done の増え方を読む：最後に作った時刻（§20 E2）と はこぶ の券（§20 E1）を更新し、部署ごとの「できた」動きの回数を返す
    function noteDone(state, events, replace, stage) {
      const done = state.done && typeof state.done === "object" ? state.done : null;
      const counts = {}, inc = {};
      if (done) {
        for (const d of DEPT_IDS) {
          const cur = num(done[d], 0);
          const prev = prevDone[d];
          prevDone[d] = cur;
          if (replace || prev === undefined || cur < prev) continue;
          if (cur > prev) inc[d] = cur - prev;
          const k = Math.floor(cur + 1e-9) - Math.floor(prev + 1e-9);
          if (k > 0) counts[d] = Math.min(MAX_MADE, k);
        }
      } else if (Array.isArray(events)) {
        for (const e of events) {
          if (!e || e.kind !== "made" || DEPT_IDS.indexOf(e.dept) < 0) continue;
          const n = Math.max(1, Math.floor(num(e.n, 1)));
          inc[e.dept] = (inc[e.dept] || 0) + n;
          counts[e.dept] = Math.min(MAX_MADE, (counts[e.dept] || 0) + n);
        }
      }
      const t = num(state.t, 0);
      for (const d in inc) lastMade[d] = t;
      // 運べる券：1 枚＝ 1 往復（1 回に運ぶ数 CARRY_LOAD ぶん。歩く速さもこの数で決めている）。上限は はこぶの人数×2
      const cap = countOf(state, "carry", stage) * 2;
      if (inc.carry) tickets += inc.carry / CARRY_LOAD[tierOf(state, "carry")];
      tickets = clamp(tickets, 0, cap);
      return counts;
    }
    function madeTriggers(counts) {
      for (const d of DEPT_IDS) {
        const k = counts[d] || 0;
        for (let i = 0; i < k; i++) madeOnce(d);
      }
    }
    function madeOnce(d) {
      const crew = actors.filter((a) => a.dept === d && a.role === ROLE_OF[d] && !a.walkIn);
      if (!crew.length) return;
      const a = crew[Math.floor(rnd() * crew.length)];
      a.made = 0.35;
      if (calm) return;
      if (d === "cut") {
        effects.push({ kind: "chop", x: a.x + 8 * a.dir, y: a.y - 12, dept: d });
        // 切った木が丸太になって、森の置き場（はこぶ の出発点）へ転がる
        effects.push({ kind: "log", x: a.x, y: a.y - 2, tx: geo.road.yardX - 18, ty: 240, dept: d });
      }
      else if (d === "plant") { /* 葉っぱは 実際に植えた所で出す（update の planter） */ }
      else if (d === "carry") effects.push({ kind: "drop", x: geo.road.gateX, y: geo.road.walkY - 4, dept: d });
      else if (d === "shop") effects.push({ kind: "coin", x: a.x, y: a.y - 26, dept: d });
      else if (d === "plane") { const st = station(geo, d, a.idx); if (st) effects.push({ kind: "curl", x: st.tx - 4, y: st.ty - 16, dept: d }); }
      else if (d === "dry") { const st = station(geo, d, a.idx); if (st) effects.push({ kind: "steam", x: st.tx, y: st.ty - 30, dept: d }); }
      else { const st = station(geo, d, a.idx); if (st) effects.push({ kind: "chips", x: st.tx, y: st.ty - 14, dept: d }); }
    }

    // ===== 動き =====
    function speedOf(a) {
      if (calm) return WALK_CALM;
      let s = WALK;
      if (a.role === "carrier") {
        // 往復の速さは rates から（1 回に運ぶ数 1・2・4・6 を掛けて往復の回数を減らす）。トラックは歩く人の 2 倍以上に見える速さ（§19.2.2）
        const staff = Math.max(1, countOf(lastState, "carry", geo.stage));
        const tier = info.tier.carry | 0;
        const per = num(info.rates.carry, 0) / staff;
        const oneWay = per > 0 ? clamp(0.5 * CARRY_LOAD[tier] / per, 1.4, 9) : 6;
        s = (geo.road.gateX - geo.road.yardX) / oneWay;
        if (tier === 3) s = Math.max(s, WALK * 2);
      } else if (info.boosted[a.dept]) s *= 1.6;
      return s;
    }
    function moveTo(a, tx, ty, dt, speed) {
      const dx = tx - a.x, dy = ty - a.y;
      const d = Math.hypot(dx, dy);
      const stepLen = speed * dt;
      if (d <= stepLen || d < 0.5) { a.x = tx; a.y = ty; return true; }
      a.x += (dx / d) * stepLen; a.y += (dy / d) * stepLen;
      if (Math.abs(dx) > 0.3) a.dir = dx > 0 ? 1 : -1;
      return false;
    }
    function workPose(a, stuck) {
      if (a.cheerT > 0) return "cheer";   // 道具が変わった直後の 1 秒（§19.2.3）
      if (stuck) return "wait";
      return info.boosted[a.dept] ? "cheer" : "work";
    }
    function update(a, dt) {
      if (a.made > 0) a.made = Math.max(0, a.made - dt);
      if (a.cheerT > 0) a.cheerT = Math.max(0, a.cheerT - dt);
      a.tier = info.tier[a.dept] | 0;
      if (a.bow > 0 && !a.walkIn) a.bow = Math.max(0, a.bow - dt);
      if (a.walkIn) {
        const h = homeOf(a);
        a.pose = a.role === "carrier" && a.carry ? "carry" : "walk";
        if (moveTo(a, h.x, h.y, dt, calm ? WALK_CALM : WALK * 1.2)) a.walkIn = false;
        return;
      }
      const sp = speedOf(a);
      switch (a.role) {
        case "planter": updatePlanter(a, dt, sp); break;
        case "cutter": {
          const isCut = true;
          const stuck = info.stuck[a.dept];
          const want = isCut ? "tree" : "stump";
          if (stuck) {
            a.slot = -1; a.active = false;
            const h = homeOf(a);
            a.pose = moveTo(a, h.x, h.y, dt, sp) ? "wait" : "walk";
            break;
          }
          if (a.slot < 0 || !slots[a.slot] || slots[a.slot].kind !== want) {
            a.slot = -1;
            const cands = [];
            for (let i = 0; i < slots.length; i++) {
              if (slots[i].kind !== want) continue;
              let taken = false;
              for (const b of actors) if (b !== a && b.role === a.role && b.slot === i) { taken = true; break; }
              cands.push({ i, taken, d: Math.abs(slots[i].x - a.x) + Math.abs(slots[i].y - a.y) * 0.5 });
            }
            cands.sort((p, q) => (p.taken - q.taken) || (p.d - q.d));
            if (cands.length) a.slot = cands[0].i;
          }
          if (a.slot < 0) { a.active = false; a.pose = "wait"; break; }
          const sl = slots[a.slot];
          const side = (a.idx % 2) ? 1 : -1;
          const tx = sl.x + side * 11;
          if (moveTo(a, tx, sl.y, dt, sp)) { a.dir = -side; a.active = true; a.pose = workPose(a, false); }
          else { a.active = false; a.pose = "walk"; }
          break;
        }
        case "carrier": {
          const r = geo.road;
          const y = laneY(a);
          if (a.phase === "toGate") {
            a.carry = "log";
            if (moveTo(a, r.gateX - (a.idx % 4) * 6, y, dt, sp)) {
              if (!a.atGate) { a.atGate = true; carryTrips++; }
              if (info.logsFull) { a.pose = "wait"; a.active = false; }
              else { a.phase = "toYard"; a.carry = null; a.pose = "walk"; a.atGate = false; }
            } else { a.pose = info.boosted.carry ? "cheer" : "carry"; a.active = true; }
          } else {
            a.carry = null;
            if (moveTo(a, r.yardX + (a.idx % 4) * 6, y, dt, sp)) {
              // 出発は「運べる券」（logic が実際に運んだ数）で決める。置き場が 0 でも運んでいれば行く（§20 E1）。置き場に 1 本以上あれば券なしでも行く
              if (tickets >= 1 || info.yard >= 1) {
                if (tickets >= 1) tickets -= 1;
                a.phase = "toGate"; a.carry = "log"; a.pose = "carry";
              } else { a.pose = "wait"; a.active = false; }
            } else { a.pose = "walk"; a.active = true; }
          }
          break;
        }
        case "peeler": case "beamer": case "dryer": case "planker": case "planer": case "seller": {
          const h = homeOf(a);
          if (!moveTo(a, h.x, h.y, dt, sp)) { a.pose = "walk"; a.active = false; break; }
          a.dir = 1;
          if (a.role === "seller") {
            a.dir = 1;
            a.active = info.qlen > 0 && !info.goodsEmpty;
            a.pose = info.qlen > 0 ? workPose(a, info.stuck.shop) : "work";
          } else {
            a.active = !info.stuck[a.dept];
            a.pose = workPose(a, info.stuck[a.dept]);
          }
          break;
        }
        case "manager": {
          const z = geo.zones[a.dept];
          if (!z) break;
          if (a.bow > 0) { a.pose = "work"; a.active = false; break; }
          if (a.tool === "fast" && !calm) {
            if (a.wait > 0) { a.wait -= dt; a.pose = "cheer"; break; }
            if (moveTo(a, a.tx, a.ty, dt, WALK * 0.8)) {
              a.wait = 0.5 + rnd() * 0.8;
              a.tx = z.x + 14 + rnd() * Math.max(1, z.w - 28);
              a.ty = Math.min(z.y + z.h - 6, z.y + 30 + rnd() * Math.max(1, z.h - 36));
            }
            a.pose = "walk"; a.active = true;
          } else {
            const h = homeOf(a);
            a.pose = moveTo(a, h.x, h.y, dt, sp) ? "work" : "walk";
            a.dir = -1; a.active = false;
          }
          break;
        }
        case "customer": {
          if (a.leaving) {
            a.pose = "carry";
            if (moveTo(a, a.tx, a.ty, dt, (calm ? WALK_CALM : WALK) * 1.1)) a.gone = true;
            break;
          }
          const h = homeOf(a);
          if (moveTo(a, h.x, h.y, dt, calm ? WALK_CALM : WALK)) { a.dir = -1; a.pose = info.goodsEmpty ? "wait" : "work"; a.active = false; }
          else a.pose = "walk";
          break;
        }
        case "sailor": {
          if (!geo.harbor) break;
          const y = geo.harbor.pierY;
          if (a.phase === "toShip") {
            a.carry = "plank";
            if (moveTo(a, 200 - a.idx * 10, y, dt, sp * 0.8)) a.phase = "back";
            a.pose = "carry";
          } else {
            a.carry = null;
            if (moveTo(a, 30 + a.idx * 14, y, dt, sp * 0.8)) a.phase = "toShip";
            a.pose = "walk";
          }
          break;
        }
      }
    }

    // なえぎ：切り株（きこりが切った所）へ歩いて行って植える。切り株が無い間は若木に水をやって待つ（§18）
    function updatePlanter(a, dt, sp) {
      const stuck = info.stuck.plant;
      let sl = a.slot >= 0 ? slots[a.slot] : null;
      if (!sl || sl.kind !== "stump" || (!sl.pend && stuck)) {
        a.slot = -1; a.plantT = 0; sl = null;
        const cands = [];
        for (let i = 0; i < slots.length; i++) {
          const c = slots[i];
          if (c.kind !== "stump" || (!c.pend && stuck)) continue;
          let taken = false;
          for (const b of actors) if (b !== a && b.role === "planter" && b.slot === i) { taken = true; break; }
          cands.push({ i, taken, pend: c.pend ? 0 : 1, d: Math.abs(c.x - a.x) + Math.abs(c.y - a.y) * 0.5 });
        }
        cands.sort((p, q) => (p.taken - q.taken) || (p.pend - q.pend) || (p.d - q.d));
        if (cands.length && !cands[0].taken) { a.slot = cands[0].i; sl = slots[a.slot]; }
      }
      if (sl) {
        a.tool = null; a.water = -1;
        const side = (a.idx % 2) ? 1 : -1;
        if (!moveTo(a, sl.x + side * 10, sl.y, dt, sp)) { a.active = false; a.pose = "walk"; return; }
        a.dir = -side; a.active = true; a.pose = workPose(a, false);
        if (sl.pend) {
          a.plantT = num(a.plantT, 0) + dt;
          if (a.plantT >= (calm ? 0.3 : 0.6)) {
            plantNow(a.slot);
            a.made = 0.35; a.plantT = 0; a.slot = -1;
            if (!calm) effects.push({ kind: "leaf", x: sl.x, y: sl.y - 6, dept: "plant" });
          }
        }
        return;
      }
      // 待つ：近くの若木に水をやる（数秒ごとに別の若木へ）。若木が無ければ持ち場で見回す
      a.active = false;
      a.waterT = num(a.waterT, 0) + dt;
      let w = num(a.water, -1);
      if (w < 0 || !slots[w] || slots[w].kind !== "sapling" || slots[w].y !== geo.forest.rows[1] || a.waterT > 3.2) {
        const opts = [];
        for (let i = 0; i < slots.length; i++) {
          // 水をやるのは手前の列だけ（奥の列だと吹き出しが場所の名札に重なる）
          // 左下は「ここが おそい！」の札に隠れるので避ける
          if (slots[i].kind !== "sapling" || i === w || slots[i].y !== geo.forest.rows[1] || slots[i].x < 120) continue;
          let taken = false;
          for (const b of actors) if (b !== a && b.role === "planter" && b.water === i) { taken = true; break; }
          if (!taken) opts.push(i);
        }
        // 持ち場に近い若木から（遠くまで行かない）
        const hx = homeOf(a).x;
        opts.sort((p, q) => Math.abs(slots[p].x - hx) - Math.abs(slots[q].x - hx));
        opts.length = Math.min(opts.length, 2);
        w = opts.length ? opts[Math.floor(rnd() * opts.length)] : (w >= 0 && slots[w] && slots[w].kind === "sapling" && slots[w].y === geo.forest.rows[1] ? w : -1);
        a.water = w; a.waterT = 0;
      }
      if (w >= 0) {
        const t = slots[w];
        const side = (a.idx % 2) ? 1 : -1;
        if (moveTo(a, t.x + side * 9, t.y, dt, sp * 0.7)) { a.dir = -side; a.pose = "wait"; a.tool = "can"; }
        else { a.pose = "walk"; a.tool = null; }
      } else {
        const h = homeOf(a);
        a.tool = null;
        a.pose = moveTo(a, h.x, h.y, dt, sp) ? "wait" : "walk";
      }
    }

    let lastState = null;
    function sync(state, events, dt) {
      if (!state || typeof state !== "object") return;
      const d = clamp(num(dt, 0), 0, 0.25);
      clk += d;
      const stage = clampStage(state.stage);
      let replace = first;
      if (!geo || geo.stage !== stage) { geo = geometry(stage); replace = true; }
      lastState = state;
      let counts = {};
      try { counts = noteDone(state, events, replace, stage); } catch (e) { counts = {}; }
      info = flowInfo(state, stage);
      try {
        syncForest(state, stage, replace);
        syncRoster(state, stage, replace);
        if (replace) actors = actors.filter((a) => a.role !== "customer");
        syncCustomers(state, events, replace);
        madeTriggers(counts);
        for (const a of actors) {
          update(a, d);
          // 待つ人は ときどき左右を見回す（「手が空いている」が分かる軽い動き。動きを減らす設定では しない）
          if (a.pose === "wait" && !calm && a.role !== "planter" && a.role !== "customer") a.dir = Math.sin(clk * 0.9 + a.ph) >= 0 ? 1 : -1;
        }
        if (actors.some((a) => a.gone)) actors = actors.filter((a) => !a.gone);
        for (const sl of slots) {
          if (sl.grow < 1) sl.grow = Math.min(1, sl.grow + d * 1.5);
          // 向かう人がいないまま長く残った切り株は、そのまま植わったことにする（見た目が logic から離れすぎない）
          if (sl.pend) { sl.pendT += d; if (sl.pendT > 9) plantNow(slots.indexOf(sl)); }
        }
        if (effects.length > 60) effects = effects.slice(-60);
      } catch (e) { /* 見た目だけなので、止めない */ }
      first = false;
    }
    function list() {
      return actors.map((a) => ({ id: a.id, role: a.role, dept: a.dept, x: a.x, y: a.y, pose: a.pose, carry: a.carry, tool: a.tool, active: a.active, look: a.look, dir: a.dir, tier: a.tier | 0 }));
    }
    // 道具が次の段に変わった：その部署の人が 1 秒 cheer（動きを減らす設定では跳ねない＝何もしない。§19.2.3）
    function cheer(dept, sec) {
      if (calm) return 0;
      let n = 0;
      for (const a of actors) if (a.dept === dept && a.role === ROLE_OF[dept] && !a.leaving) { a.cheerT = num(sec, 1); n++; }
      return n;
    }
    return {
      sync, list, cheer,
      all: () => actors,
      slots: () => slots,
      why: () => (info ? info.why : {}),
      carryTrips: () => carryTrips,
      drain() { const e = effects; effects = []; return e; },
      setCalm(b) { calm = !!b; },
      geometry: () => geo,
      reset() { first = true; prevDone = {}; actors = []; slots = []; effects = []; lastMade = {}; tickets = 0; },
      clock: () => clk
    };
  }

  const api = Object.freeze({ create, geometry, station, waitOf, graceOf, tierOf, inOf, MAX_ACTORS, ANIM_MUL, CARRY_LOAD, LINE_DEPTS, W, STAGE_H, DEPT_IDS, DEPT_FROM, ROLE_OF, byStage, capsOf, outOf });
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SeizaiActors = api;
})(typeof window !== "undefined" ? window : globalThis);
