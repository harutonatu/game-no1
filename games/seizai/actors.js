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
 * - 人の数の上限 MAX_ACTORS = 60。超える分はお客さんから省く（§6.4）
 */
(function (root) {
  "use strict";

  const W = 360;
  const STAGE_H = { 1: 640, 2: 760, 3: 880, 4: 1000 };
  const ROWS = { 1: 2, 2: 3, 3: 4, 4: 4 };
  const ROW_H = { 1: 64, 2: 66, 3: 66, 4: 66 };
  const DEPT_IDS = ["cut", "plant", "carry", "peel", "beam", "plank", "shop"];
  const DEPT_FROM = { cut: 1, plant: 1, carry: 1, peel: 1, beam: 2, plank: 3, shop: 1 };
  const ROLE_OF = { cut: "cutter", plant: "planter", carry: "carrier", peel: "peeler", beam: "beamer", plank: "planker", shop: "seller" };
  const LINE_DEPTS = { peel: 1, beam: 1, plank: 1 };
  const MAX_ACTORS = 60;
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
    if (dept === "plank") return "goods";
    return null;
  }

  // ===== 配置（世界の座標。幅 360、高さは段ごと）=====
  function geometry(stageIn) {
    const stage = clampStage(stageIn);
    const H = STAGE_H[stage];
    const rows = ROWS[stage], rowH = ROW_H[stage];
    const fTop = 290, rowTop = 320;
    const fBot = rowTop + rows * rowH + 8;
    const sTop = fBot, sBot = stage === 4 ? 820 : H;
    const colDefs = stage === 1 ? [["peel", 4, 356]]
      : stage === 2 ? [["peel", 4, 178], ["beam", 182, 356]]
      : [["peel", 4, 118], ["beam", 122, 238], ["plank", 242, 356]];
    const zones = {
      cut: { x: 4, y: 38, w: 228, h: 166 },
      plant: { x: 236, y: 38, w: 120, h: 166 },
      carry: { x: 4, y: 210, w: 352, h: 76 }
    };
    const cols = colDefs.map(([d, x0, x1]) => {
      zones[d] = { x: x0, y: fTop + 4, w: x1 - x0, h: fBot - fTop - 8 };
      return { dept: d, x0, x1, cx: (x0 + x1) / 2, tableX: x0 + (x1 - x0) * 0.62 };
    });
    zones.goods = { x: 4, y: sTop + 6, w: 140, h: 116 };
    zones.shop = { x: 148, y: sTop + 6, w: 208, h: 116 };
    const order = ["cut", "plant", "carry", "peel", "beam", "plank", "goods", "shop"].filter((d) => zones[d]);
    return {
      stage, W, H,
      forest: { y0: 34, y1: 206, rows: [124, 198] },
      road: { y0: 206, y1: 290, walkY: 266, yardX: 44, gateX: 330 },
      factory: { y0: fTop, y1: fBot, rowTop, rowH, rows, cols },
      shop: { y0: sTop, y1: sBot, counterY: sTop + 70, sellerY: sTop + 68, queueY: sTop + 116, leaveY: sTop + 136, pileX: 74, pileY: sTop + 100 },
      harbor: stage === 4 ? { y0: 820, y1: 1000, pierY: 874, seaY: 880, shipX: 236 } : null,
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
    const fy = geo.factory.rowTop + r * geo.factory.rowH + geo.factory.rowH - 10;
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
    function pickSlot(kind, role) {
      const cands = [];
      for (let i = 0; i < slots.length; i++) if (slots[i].kind === kind) cands.push(i);
      if (!cands.length) return -1;
      for (const i of cands) if (claimedBy(i, role)) return i;
      return cands[Math.floor(rnd() * cands.length)];
    }
    function syncForest(state, stage, replace) {
      const caps = capsOf(stage);
      const cap = caps.forest;
      const f = state.forest || {};
      const T = clamp(Math.floor(num(f.trees, 0)), 0, cap);
      const S = clamp(Math.floor(num(f.saplings, 0)), 0, cap - T);
      if (replace || slots.length !== cap) {
        const pos = slotPositions(cap);
        const order = pos.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
        slots = pos.map((p) => ({ x: p.x, y: p.y, kind: "stump", fall: 0, grow: 1 }));
        order.forEach((idx, k) => { slots[idx].kind = k < T ? "tree" : k < T + S ? "sapling" : "stump"; });
        return;
      }
      let t = 0, s = 0;
      for (const sl of slots) { if (sl.kind === "tree") t++; else if (sl.kind === "sapling") s++; }
      let guard = 200;
      while (t > T && guard--) {
        const i = pickSlot("tree", "cutter"); if (i < 0) break;
        slots[i].kind = "stump"; t--;
        if (!calm) effects.push({ kind: "fall", x: slots[i].x, y: slots[i].y, dir: rnd() < 0.5 ? -1 : 1 });
      }
      while (s > S && t < T && guard--) {
        const i = pickSlot("sapling", "-"); if (i < 0) break;
        slots[i].kind = "tree"; slots[i].grow = 0; s--; t++;
      }
      while (t < T && guard--) {
        const i = pickSlot("stump", "-"); if (i < 0) break;
        slots[i].kind = "tree"; slots[i].grow = 0; t++;
      }
      while (s > S && guard--) {
        const i = pickSlot("sapling", "-"); if (i < 0) break;
        slots[i].kind = "stump"; s--;
      }
      while (s < S && guard--) {
        const i = pickSlot("stump", "planter"); if (i < 0) break;
        slots[i].kind = "sapling"; slots[i].grow = 0; s++;
      }
    }

    // ===== 流れの様子（つまり・応援）=====
    function flowInfo(state, stage) {
      const caps = capsOf(stage);
      const buf = state.buf || {}, f = state.forest || {}, depts = state.depts || {};
      const v = (k) => num(buf[k], 0);
      const full = (k) => (k === "goods" ? v(k) >= caps.goods - 1e-6 : v(k) >= caps.buf - 1e-6);
      const trees = num(f.trees, 0), saps = num(f.saplings, 0);
      const stumps = caps.forest - trees - saps;
      const qlen = Array.isArray(state.queue) ? state.queue.length : 0;
      const t = num(state.t, 0);
      const boosted = {};
      for (const d of DEPT_IDS) boosted[d] = !!(depts[d] && num(depts[d].boostUntil, -1) > t);
      let rates = null;
      try { rates = typeof Lg().rates === "function" ? Lg().rates(state) : null; } catch (e) { rates = null; }
      return {
        stuck: {
          cut: trees < 1 || full("yard"),
          plant: stumps < 1,
          carry: v("yard") < 1 || full("logs"),
          peel: v("logs") < 1 || full(outOf("peel", stage)),
          beam: v("peeled") < 1 || full(outOf("beam", stage)),
          plank: v("beams") < 1 || full("goods"),
          shop: qlen > 0 && v("goods") < 1
        },
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
    function madeTriggers(state, events, replace) {
      const done = state.done && typeof state.done === "object" ? state.done : null;
      const counts = {};
      if (done) {
        for (const d of DEPT_IDS) {
          const cur = Math.floor(num(done[d], 0));
          const prev = prevDone[d];
          prevDone[d] = cur;
          if (replace || prev === undefined || cur < prev) continue;
          counts[d] = Math.min(MAX_MADE, cur - prev);
        }
      } else if (Array.isArray(events)) {
        for (const e of events) if (e && e.kind === "made" && DEPT_IDS.indexOf(e.dept) >= 0) counts[e.dept] = Math.min(MAX_MADE, (counts[e.dept] || 0) + Math.max(1, Math.floor(num(e.n, 1))));
      }
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
      if (d === "cut") effects.push({ kind: "chop", x: a.x + 8 * a.dir, y: a.y - 12, dept: d });
      else if (d === "plant") effects.push({ kind: "leaf", x: a.x + 6 * a.dir, y: a.y - 4, dept: d });
      else if (d === "carry") effects.push({ kind: "drop", x: geo.road.gateX, y: geo.road.walkY - 4, dept: d });
      else if (d === "shop") effects.push({ kind: "coin", x: a.x, y: a.y - 26, dept: d });
      else { const st = station(geo, d, a.idx); if (st) effects.push({ kind: "chips", x: st.tx, y: st.ty - 14, dept: d }); }
    }

    // ===== 動き =====
    function speedOf(a) {
      if (calm) return WALK_CALM;
      let s = WALK;
      if (a.role === "carrier") {
        const staff = Math.max(1, countOf(lastState, "carry", geo.stage));
        const per = num(info.rates.carry, 0) / staff;
        const oneWay = per > 0 ? clamp(0.5 / per, 1.4, 9) : 6;
        s = (geo.road.gateX - geo.road.yardX) / oneWay;
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
      if (stuck) return "wait";
      return info.boosted[a.dept] ? "cheer" : "work";
    }
    function update(a, dt) {
      if (a.made > 0) a.made = Math.max(0, a.made - dt);
      if (a.bow > 0 && !a.walkIn) a.bow = Math.max(0, a.bow - dt);
      if (a.walkIn) {
        const h = homeOf(a);
        a.pose = a.role === "carrier" && a.carry ? "carry" : "walk";
        if (moveTo(a, h.x, h.y, dt, calm ? WALK_CALM : WALK * 1.2)) a.walkIn = false;
        return;
      }
      const sp = speedOf(a);
      switch (a.role) {
        case "cutter": case "planter": {
          const isCut = a.role === "cutter";
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
              if (info.logsFull) { a.pose = "wait"; a.active = false; }
              else { a.phase = "toYard"; a.carry = null; a.pose = "walk"; }
            } else { a.pose = info.boosted.carry ? "cheer" : "carry"; a.active = true; }
          } else {
            a.carry = null;
            if (moveTo(a, r.yardX + (a.idx % 4) * 6, y, dt, sp)) {
              if (info.yard < 1) { a.pose = "wait"; a.active = false; }
              else { a.phase = "toGate"; a.carry = "log"; a.pose = "carry"; }
            } else { a.pose = "walk"; a.active = true; }
          }
          break;
        }
        case "peeler": case "beamer": case "planker": case "seller": {
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

    let lastState = null;
    function sync(state, events, dt) {
      if (!state || typeof state !== "object") return;
      const d = clamp(num(dt, 0), 0, 0.25);
      clk += d;
      const stage = clampStage(state.stage);
      let replace = first;
      if (!geo || geo.stage !== stage) { geo = geometry(stage); replace = true; }
      lastState = state;
      info = flowInfo(state, stage);
      try {
        syncForest(state, stage, replace);
        syncRoster(state, stage, replace);
        if (replace) actors = actors.filter((a) => a.role !== "customer");
        syncCustomers(state, events, replace);
        madeTriggers(state, events, replace);
        for (const a of actors) update(a, d);
        if (actors.some((a) => a.gone)) actors = actors.filter((a) => !a.gone);
        for (const sl of slots) if (sl.grow < 1) sl.grow = Math.min(1, sl.grow + d * 1.5);
        if (effects.length > 60) effects = effects.slice(-60);
      } catch (e) { /* 見た目だけなので、止めない */ }
      first = false;
    }
    function list() {
      return actors.map((a) => ({ id: a.id, role: a.role, dept: a.dept, x: a.x, y: a.y, pose: a.pose, carry: a.carry, tool: a.tool, active: a.active, look: a.look, dir: a.dir }));
    }
    return {
      sync, list,
      all: () => actors,
      slots: () => slots,
      drain() { const e = effects; effects = []; return e; },
      setCalm(b) { calm = !!b; },
      geometry: () => geo,
      reset() { first = true; prevDone = {}; actors = []; slots = []; effects = []; },
      clock: () => clk
    };
  }

  const api = Object.freeze({ create, geometry, station, MAX_ACTORS, W, STAGE_H, DEPT_IDS, DEPT_FROM, ROLE_OF, byStage, capsOf, outOf });
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SeizaiActors = api;
})(typeof window !== "undefined" ? window : globalThis);
