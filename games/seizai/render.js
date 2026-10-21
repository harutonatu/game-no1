/*
 * もくもくこうば — canvas の描画と演出
 * 契約：docs/seizai-contract.md §6（描画と人の動き）・§5.1（配置）。担当B だけが編集する。
 *
 * SeizaiRender.create(canvas, { calm }) → {
 *   layout(stage, cssWidth, cssHeight) → { worldH, cssH, scale, offsetX, zones: [{ dept, x, y, w, h }] },
 *   frame(state, events, dtSec), burst(kind, dept), setCalm(bool), pause(), resume(),
 *   stats() → { actors, frames, slowFrames, bgRedraws, drawMs, calm }
 * }
 * - 世界は幅 360 の単位。#scene の幅に合わせて拡大縮小（上限 1.8 倍。広い画面では真ん中に寄せる）
 * - canvas は「見えている所」だけの大きさで、#sceneInner の中で position: sticky。スクロールの量だけずらして描く
 *   （世界の高さぶんの canvas を作らない＝iPad でも重くない）。.zone のボタンは #sceneInner に世界の座標で並べる
 * - 背景（空・地面・建物）は段と大きさが変わったときだけ、オフスクリーン canvas に描き直す（bgRedraws）
 * - 影・ぼかしは使わない。1人の描画は図形 10 回以内。見えない所の人は描かない（§6.4）
 * - 道具の絵は logic の toolTier（Lv 1・5・15・30 の 4 段）で形が変わる。名前の表は logic の TOOLS だけ（§19.2）。
 *   「きんの」は前の段と同じ形で金色＋小さな光。手の動きの速さは SeizaiActors.ANIM_MUL（見た目だけ）
 * - #sheet が #scene に重なっている間は #scene の下に余白（#sceneSpacer）があるので、canvas は世界の下端で止まる。
 *   描く位置はスクロールの量を「世界の高さ − 見える高さ」で頭打ちにして合わせる
 */
(function (root) {
  "use strict";

  const A = root.SeizaiActors;
  const Lg = () => root.SeizaiLogic || {};
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const W = 360;
  const MAX_DPR = 2;
  const MAX_SCALE = 1.8;
  const BG_MAX_PIX = 4.2e6;
  const SLOW_MS = 34;
  const NAMES_FALLBACK = { cut: "きこり", plant: "なえぎ", carry: "はこぶ", peel: "かわむき", beam: "かくざい", dry: "かんそう", plank: "いた", plane: "かんな", shop: "おみせ", goods: "うりもの" };
  // 名前は logic の DEPTS を先に使う
  function nameOf(d) {
    const D = Lg().DEPTS;
    if (d !== "goods" && Array.isArray(D)) { const x = D.find((q) => q && q.id === d); if (x && typeof x.name === "string" && x.name) return x.name; }
    return NAMES_FALLBACK[d] || d;
  }
  const LINE_DEPTS = A.LINE_DEPTS || { peel: 1, beam: 1, dry: 1, plank: 1, plane: 1 };
  const ANIM_MUL = A.ANIM_MUL || [1, 1.3, 1.6, 2];
  const GOLD = "#e3b52a", GOLD_HI = "#fff2a8";
  // 部署の色（Okabe-Ito を元に。色だけに頼らず帽子の形と文字でも分ける §6.2）
  const ROLE_COL = {
    cutter: "#d55e00", planter: "#009e73", carrier: "#0072b2", peeler: "#e69f00", beamer: "#cc79a7",
    dryer: "#a0522d", planker: "#56b4e9", planer: "#7a9a2a", seller: "#f0e442", manager: "#2b2b2b", sailor: "#f4f4f4", customer: "#8a8f98"
  };
  const DEPT_ROLE = A.ROLE_OF || { cut: "cutter", plant: "planter", carry: "carrier", peel: "peeler", beam: "beamer", dry: "dryer", plank: "planker", plane: "planer", shop: "seller" };
  const SKIN = ["#f1c27d", "#e0ac69", "#c68642", "#ffdbac"];
  const CUST_BODY = ["#9aa3ad", "#3d6fb6", "#5b8c3a", "#24395e"];
  const ITEM_COL = { log: "#8a5a2b", peeled: "#e7c48c", beam: "#d9a95f", dried: "#e8bf72", plank: "#f0d39a", smooth: "#fbe9c4" };
  const STAGE_SKY = { 1: ["#a9dcf5", "#e6f6ff"], 2: ["#9fd3f0", "#e2f3ff"], 3: ["#b8cfe0", "#eef2f4"], 4: ["#8fd0f0", "#e8f8ff"] };

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
  function productKey(stage) {
    try { const p = Lg().productOf && Lg().productOf(stage); if (p) return p; } catch (e) { /* 下の既定 */ }
    return stage === 1 ? "peeled" : stage === 2 ? "beams" : stage === 3 ? "planks" : "smooth";
  }
  const ITEM_OF = { peeled: "peeled", beams: "beam", dried: "dried", planks: "plank", smooth: "smooth", logs: "log", yard: "log" };

  function create(canvas, opts) {
    const o = opts || {};
    const ctx = canvas.getContext("2d", { alpha: false }) || canvas.getContext("2d");
    const inner = canvas.parentElement || null;
    const scroller = (canvas.closest && canvas.closest("#scene")) || (inner && inner.parentElement) || null;
    const mq = root.matchMedia ? root.matchMedia("(prefers-reduced-motion: reduce)") : null;
    let calmWanted = !!o.calm;
    let calm = calmWanted || !!(mq && mq.matches);
    const actors = A.create(mulberry(9241));
    actors.setCalm(calm);
    const rnd = mulberry(4021);

    let geo = A.geometry(1);
    let stage = 1;
    let cssW = 320, viewH = 400, scale = 320 / W, offX = 0, dpr = 1, worldCssH = 640 * scale;
    let scrollY = 0;
    const scrollTopRaw = () => scrollY;
    let bg = null, bgKey = "", bgRedraws = 0, bgRatio = 1;
    let frames = 0, slowFrames = 0, lastFrameAt = null;
    const drawTimes = [];
    let paused = false;
    let lastState = null;
    let clk = 0;
    let particles = [], floaters = [], flashes = {}, tableAnim = {};
    let floatTimes = [];
    let stageAnim = null;
    let shipAnim = null, truckAnim = null;
    let prevLv = null, prevLines = null, prevStage = null;
    let goalAt = -1, moneyEl = null, fillEl = null;
    let scrollDrawQueued = false;
    let lastZonesKey = "";
    let lastToolBurst = null;

    const doc = root.document;
    function el(id) { try { return doc ? doc.getElementById(id) : null; } catch (e) { return null; } }

    ["money", "shipCount"].forEach((id) => {
      const e = el(id);
      if (e && e.addEventListener) e.addEventListener("animationend", () => e.classList.remove("bump"));
    });
    if (mq) {
      const onMq = () => { calm = calmWanted || mq.matches; actors.setCalm(calm); };
      if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq);
    }
    if (scroller && scroller.addEventListener) {
      scroller.addEventListener("scroll", () => {
        scrollY = scroller.scrollTop;
        if ((paused || !lastFrameAt) && lastState && !scrollDrawQueued && root.requestAnimationFrame) {
          scrollDrawQueued = true;
          root.requestAnimationFrame(() => { scrollDrawQueued = false; draw(lastState); });
        }
      }, { passive: true });
    }
    if (root.ResizeObserver && scroller) {
      let lastW = -1, lastH = -1;
      new root.ResizeObserver(() => {
        const w = scroller.clientWidth, h = scroller.clientHeight;
        if (w === lastW && h === lastH) return;
        lastW = w; lastH = h;
        layout(stage, w, h);
        if (lastState) draw(lastState);
      }).observe(scroller);
    }

    // ===== 大きさ =====
    function layout(stageIn, cssWidth, cssHeight) {
      stage = clamp(Math.floor(num(stageIn, stage)), 1, 4);
      geo = A.geometry(stage);
      const sw = scroller ? scroller.clientWidth : 0, sh = scroller ? scroller.clientHeight : 0;
      cssW = Math.max(100, Math.floor(num(cssWidth, 0) > 0 ? cssWidth : sw || 320));
      const vh = Math.max(80, Math.floor(num(cssHeight, 0) > 0 ? cssHeight : sh || 480));
      scale = Math.min(cssW / W, MAX_SCALE);
      offX = Math.floor((cssW - W * scale) / 2);
      worldCssH = Math.ceil(geo.H * scale);
      viewH = Math.min(vh, worldCssH);
      dpr = Math.min(MAX_DPR, Math.max(1, num(root.devicePixelRatio, 1)));
      if (inner) inner.style.height = worldCssH + "px";
      const wpx = Math.round(cssW * dpr), hpx = Math.round(viewH * dpr);
      canvas.style.width = cssW + "px";
      canvas.style.height = viewH + "px";
      if (canvas.width !== wpx) canvas.width = wpx;
      if (canvas.height !== hpx) canvas.height = hpx;
      if (scroller) {
        // 下の余白（#sceneSpacer。シートを重ねている間）もスクロールできるので、scrollHeight で頭打ち
        const maxS = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        if (scroller.scrollTop > maxS) scroller.scrollTop = maxS;
        scrollY = scroller.scrollTop;
      }
      const key = stage + "|" + cssW + "|" + dpr;
      if (key !== bgKey) { bgKey = key; drawBg(); }
      const zones = [];
      for (const d of geo.order) {
        const z = geo.zones[d];
        zones.push({ dept: d, x: Math.round(offX + z.x * scale), y: Math.round(z.y * scale), w: Math.round(z.w * scale), h: Math.round(z.h * scale) });
      }
      placeZones(zones);
      return { worldH: geo.H, cssH: worldCssH, scale, offsetX: offX, zones };
    }
    function placeZones(zones) {
      if (!inner || !inner.querySelectorAll) return;
      const key = JSON.stringify(zones);
      if (key === lastZonesKey) return;
      lastZonesKey = key;
      const byDept = {};
      for (const z of zones) byDept[z.dept] = z;
      inner.querySelectorAll(".zone[data-dept]").forEach((b) => {
        const z = byDept[b.getAttribute("data-dept")];
        if (!z) { b.hidden = true; return; }
        b.hidden = false;
        b.style.left = z.x + "px"; b.style.top = z.y + "px"; b.style.width = z.w + "px"; b.style.height = z.h + "px";
      });
    }

    // ===== 背景（段・大きさが変わったときだけ）=====
    function drawBg() {
      bgRedraws++;
      if (!doc) return;
      const H = geo.H;
      let r = scale * dpr;
      const pix = (W * r) * (H * r);
      if (pix > BG_MAX_PIX) r = Math.sqrt(BG_MAX_PIX / (W * H));
      bgRatio = r;
      if (!bg) bg = doc.createElement("canvas");
      bg.width = Math.ceil(W * r);
      bg.height = Math.ceil(H * r);
      const c = bg.getContext("2d");
      c.setTransform(r, 0, 0, r, 0, 0);
      paintBg(c, geo);
    }
    function rect(c, x, y, w, h, col) { c.fillStyle = col; c.fillRect(x, y, w, h); }
    function paintBg(c, g) {
      const st = g.stage;
      const sky = STAGE_SKY[st];
      const grad = c.createLinearGradient(0, 0, 0, 120);
      grad.addColorStop(0, sky[0]); grad.addColorStop(1, sky[1]);
      c.fillStyle = grad; c.fillRect(0, 0, W, 130);
      // 遠くの山
      c.fillStyle = st === 4 ? "#9bc4a8" : st === 3 ? "#a8bba6" : "#9cc79a";
      c.beginPath(); c.moveTo(0, 96);
      for (let x = 0; x <= W; x += 30) c.lineTo(x, 70 + Math.sin(x * 0.03 + st) * 14);
      c.lineTo(W, 130); c.lineTo(0, 130); c.closePath(); c.fill();
      // 森の地面（2段の段々）
      rect(c, 0, 124, W, 82, st >= 3 ? "#5d8f4e" : "#4f8a45");
      rect(c, 0, 124, W, 4, "#6fa65c");
      rect(c, 0, 198, W, 8, "#6fa65c");
      // 道
      rect(c, 0, 206, W, 84, "#c9a877");
      rect(c, 0, 248, W, 32, st >= 3 ? "#9a9a96" : "#b8925e");
      if (st >= 3) { c.fillStyle = "#e9e3c9"; for (let x = 10; x < W; x += 34) c.fillRect(x, 263, 16, 2); }
      // 森の置き場（看板）
      rect(c, 8, 236, 70, 6, "#7a5530");
      // 工場の入口（矢印）
      c.fillStyle = "#7a5530"; c.beginPath(); c.moveTo(322, 280); c.lineTo(338, 280); c.lineTo(330, 290); c.closePath(); c.fill();
      // 段ごとの止まっている車（手押し車・荷車）は描かない（はこぶ の道具と食い違うため。§19.2.1）
      // 工場（こうじょう からは 2 つの帯。上「さぎょうば」・下「しあげ」§19.3.1）
      const f = g.factory;
      for (const b of f.bands) {
        const h = b.y1 - b.y0;
        if (st === 1) {
          rect(c, 0, b.y0, W, h, "#a8774a");
          c.fillStyle = "#946640"; for (let x = 0; x < W; x += 18) c.fillRect(x, b.y0, 2, h);
          rect(c, 0, b.y0, W, 26, "#7b5232");
        } else if (st === 2) {
          rect(c, 0, b.y0, W, h, "#b78a5c");
          c.fillStyle = "#a57b50"; for (let x = 0; x < W; x += 18) c.fillRect(x, b.y0, 2, h);
          rect(c, 0, b.y0, W, 26, "#6d7680");
          c.fillStyle = "#58616b"; for (let x = 0; x < W; x += 12) c.fillRect(x, b.y0 + 20, 8, 6);
        } else {
          rect(c, 0, b.y0, W, h, b === f.bands[0] ? "#a65a43" : "#9a5e48");
          c.fillStyle = "#8f4a36";
          for (let y = b.y0 + 26; y < b.y1; y += 10) {
            c.fillRect(0, y, W, 1.5);
            for (let x = ((y / 10) % 2) * 12; x < W; x += 24) c.fillRect(x, y, 1.5, 10);
          }
          rect(c, 0, b.y0, W, 26, "#5b6168");
        }
        // 帯の名前は描かない（右上は置き場の山、左上は場所の名札で埋まるため。帯の区切りは見出しの帯と色の違いで見せる）
        // 列の床（台が増えると行が増える）
        for (let r = 0; r < f.rows; r++) rect(c, 0, b.rowTop + r * f.rowH + f.rowH - 10, W, 3, "rgba(0,0,0,0.18)");
        for (let i = 1; i < b.cols.length; i++) rect(c, b.cols[i].x0 - 3, b.y0 + 26, 2, h - 26, "rgba(0,0,0,0.22)");
        rect(c, 0, b.y1 - 4, W, 4, "rgba(0,0,0,0.25)");
      }
      if (st >= 3) {
        // 煙突
        rect(c, 300, 214, 22, 76, "#8f4a36");
        rect(c, 296, 210, 30, 8, "#5b6168");
      }
      // お店
      const s = g.shop;
      rect(c, 0, s.y0, W, s.y1 - s.y0, st >= 3 ? "#e4dccb" : "#e8dcc0");
      rect(c, 0, s.y0 + 124, W, 30, "#a9a196");
      c.fillStyle = "#c9c2b6"; for (let x = 6; x < W; x += 30) c.fillRect(x, s.y0 + 137, 14, 3);
      // ひさし（しま模様。段ごとに形を変える）
      const awn = st === 1 ? ["#d55e00", "#f6e7d0"] : st === 2 ? ["#0072b2", "#eef4f8"] : st === 3 ? ["#009e73", "#eef8f2"] : ["#cc79a7", "#fbeef5"];
      for (let x = 148, i = 0; x < 356; x += 16, i++) { c.fillStyle = awn[i % 2]; c.fillRect(x, s.y0 + 8, 16, 14); }
      c.fillStyle = awn[0];
      for (let x = 148; x < 356; x += 16) { c.beginPath(); c.arc(x + 8, s.y0 + 22, 8, 0, Math.PI); c.fill(); }
      // 下の町（あまった高さ）
      if (s.y1 - s.y0 > 170) {
        for (let x = 10, i = 0; x < W - 40; x += 78, i++) {
          const hy = s.y0 + 168;
          const hh = Math.min(70, s.y1 - hy - 10);
          if (hh < 24) break;
          rect(c, x, hy + 14, 56, hh - 14, ["#e8c79a", "#cfd8c4", "#e3c0c0", "#c9d3e3"][i % 4]);
          c.fillStyle = ["#a0522d", "#5f7d55", "#a05a5a", "#5a6f96"][i % 4];
          c.beginPath(); c.moveTo(x - 4, hy + 16); c.lineTo(x + 28, hy); c.lineTo(x + 60, hy + 16); c.closePath(); c.fill();
          rect(c, x + 22, hy + hh - 20, 12, 20, "#6b4a2b");
        }
      }
      // みなと
      if (g.harbor) {
        const h = g.harbor;
        rect(c, 0, h.y0, W, h.seaY - h.y0, "#e3d6b4");
        const sg = c.createLinearGradient(0, h.seaY, 0, h.y1);
        sg.addColorStop(0, "#3d8fc4"); sg.addColorStop(1, "#1d5a8a");
        c.fillStyle = sg; c.fillRect(0, h.seaY, W, h.y1 - h.seaY);
        c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 1.5;
        c.beginPath();
        for (let y = h.seaY + 20; y < h.y1; y += 22) for (let x = (y % 44) ? 0 : 18; x < W; x += 36) { c.moveTo(x, y); c.quadraticCurveTo(x + 6, y - 4, x + 12, y); }
        c.stroke();
        rect(c, 0, h.pierY, 214, 8, "#8a5a2b");
        c.fillStyle = "#6b4321"; for (let x = 8; x < 214; x += 30) c.fillRect(x, h.pierY + 8, 5, 40);
      }
    }
    // ===== 1フレーム =====
    function frame(state, events, dtSec) {
      if (!state || typeof state !== "object") return;
      const now = (root.performance && performance.now) ? performance.now() : Date.now();
      // rAF の外から（advance・setState・away などが dt = 0 で）呼ばれたコマは数えず、次のコマの基準にもしない（§17.1 A4）
      if (!(num(dtSec, 0) > 0)) lastFrameAt = null;
      else {
        if (lastFrameAt !== null && now - lastFrameAt > SLOW_MS) slowFrames++;
        lastFrameAt = now;
      }
      frames++;
      const dt = clamp(num(dtSec, 1 / 60), 0, 0.1);
      clk += dt;
      const st = clamp(Math.floor(num(state.stage, 1)), 1, 4);
      if (st !== stage) {
        const from = prevStage;
        layout(st, cssW, scroller ? scroller.clientHeight : viewH);
        if (from !== null && from !== st) startStageAnim();
      }
      prevStage = st;
      // C が canvas の大きさを書きかえても、見えている所の大きさに戻す
      if (canvas.style.height !== viewH + "px") { canvas.style.height = viewH + "px"; canvas.style.width = cssW + "px"; }
      const evs = Array.isArray(events) ? events : [];
      actors.sync(state, evs, dt);
      takeEvents(state, evs);
      diffState(state);
      for (const e of actors.drain()) addEffect(e);
      updateFx(dt);
      lastState = state;
      const t0 = now;
      draw(state);
      const t1 = (root.performance && performance.now) ? performance.now() : Date.now();
      drawTimes.push(t1 - t0);
      if (drawTimes.length > 120) drawTimes.shift();
      if (clk - goalAt > 0.2) { goalAt = clk; updateGoalBar(state); }
    }

    function takeEvents(state, evs) {
      let soldYen = 0;
      for (const e of evs) {
        if (!e || typeof e !== "object") continue;
        if (e.kind === "sold") soldYen += Math.max(0, num(e.yen, 0));
        else if (e.kind === "delivered") burst("deliver");
        else if (e.kind === "ship") { if (!e.ending) burst("ship"); else startShip(); }
        else if (e.kind === "order") addSparkles(geo.zones.shop, 6, "#ffd84d");
      }
      if (soldYen > 0) moneyFloat(soldYen);
    }
    function moneyFloat(yen) {
      const z = geo.zones.shop;
      floatTimes = floatTimes.filter((t) => clk - t < 1);
      const last = floaters[floaters.length - 1];
      if (floatTimes.length >= 3 && last) {
        last.yen += yen; last.text = yenText(last.yen);
      } else {
        floatTimes.push(clk);
        floaters.push({ x: z.x + z.w * (0.45 + rnd() * 0.3), y: z.y + 58, yen, text: yenText(yen), t: 0 });
        if (floaters.length > 6) floaters.shift();
      }
      bumpMoney();
    }
    function yenText(yen) {
      let s = null;
      try { s = typeof Lg().formatYen === "function" ? Lg().formatYen(yen) : null; } catch (e) { s = null; }
      return "+" + (typeof s === "string" ? s : Math.floor(yen).toLocaleString("ja-JP") + " えん");
    }
    function bumpMoney() {
      if (calm) return;
      if (!moneyEl) moneyEl = el("money");
      if (!moneyEl || !moneyEl.classList) return;
      if (moneyEl.classList.contains("bump")) return;
      moneyEl.classList.add("bump");   // 外すのは animationend（create で登録）
    }
    function updateGoalBar(state) {
      if (!fillEl) fillEl = el("goalFill");
      if (!fillEl) return;
      let p = 0;
      try {
        const g = typeof Lg().goalOf === "function" ? Lg().goalOf(state) : null;
        if (g && num(g.need, 0) > 0) p = clamp(num(g.done, 0) / g.need, 0, 1);
      } catch (e) { p = 0; }
      const w = (Math.floor(p * 1000) / 10) + "%";
      if (fillEl.style.width !== w) fillEl.style.width = w;
    }
    function diffState(state) {
      const depts = state.depts || {};
      const lv = {}, ln = {};
      for (const d of A.DEPT_IDS) {
        const x = depts[d] || {};
        lv[d] = Math.floor(num(x.level, 1));
        ln[d] = Math.floor(num(x.lines, 0));
      }
      if (prevLv) {
        for (const d of A.DEPT_IDS) {
          if (lv[d] > prevLv[d] && geo.zones[d]) {
            flashes[d] = 0.6;
            if (!calm) addSparkles(geo.zones[d], 5, "#fff6b0");
          }
          if (LINE_DEPTS[d] && ln[d] > prevLines[d]) for (let i = prevLines[d]; i < ln[d]; i++) tableAnim[d + i] = 0;
        }
      }
      prevLv = lv; prevLines = ln;
    }

    // ===== 演出 =====
    function addEffect(e) {
      if (calm) return;
      if (e.kind === "chips") for (let i = 0; i < 4; i++) particles.push({ x: e.x, y: e.y, vx: (rnd() - 0.5) * 50, vy: -20 - rnd() * 30, life: 0.6, col: "#e8c27a", r: 1.6 });
      else if (e.kind === "chop") for (let i = 0; i < 3; i++) particles.push({ x: e.x, y: e.y, vx: (rnd() - 0.5) * 40, vy: -25 - rnd() * 20, life: 0.5, col: "#f2d6a2", r: 1.5 });
      else if (e.kind === "leaf") for (let i = 0; i < 3; i++) particles.push({ x: e.x, y: e.y, vx: (rnd() - 0.5) * 30, vy: -18 - rnd() * 14, life: 0.7, col: "#6cc35a", r: 1.8 });
      else if (e.kind === "drop") particles.push({ x: e.x, y: e.y, vx: 0, vy: -10, life: 0.4, col: "#c9a877", r: 3 });
      else if (e.kind === "coin") particles.push({ x: e.x, y: e.y, vx: 0, vy: -24, life: 0.6, col: "#ffd84d", r: 2.4 });
      else if (e.kind === "fall") { if (particles.filter((p) => p.fall).length < 3) particles.push({ fall: true, x: e.x, y: e.y, dir: e.dir, life: 0.7, t: 0 }); }
      else if (e.kind === "fall-old") particles.push({ fall: true, x: e.x, y: e.y, dir: e.dir, life: 0.7, t: 0 });
      else if (e.kind === "log") { if (particles.filter((p) => p.log).length < 4) particles.push({ log: true, x: e.x, y: e.y, x0: e.x, y0: e.y, tx: e.tx, ty: e.ty, life: 0.9, t: 0 }); }
      else if (e.kind === "curl") particles.push({ curl: true, x: e.x, y: e.y, vx: -8 - rnd() * 8, vy: -6, life: 0.8, t: 0 });
      else if (e.kind === "steam") { if (particles.filter((p) => p.steam).length < 6) particles.push({ steam: true, x: e.x + (rnd() - 0.5) * 10, y: e.y, vx: 0, vy: -16, life: 0.9, t: 0 }); }
      else if (e.kind === "hello") particles.push({ ring: true, x: e.x, y: e.y - 12, life: 0.5, t: 0, col: "#ffffff" });
      if (particles.length > 90) particles.splice(0, particles.length - 90);
    }
    function addSparkles(z, n, col) {
      if (calm || !z) return;
      for (let i = 0; i < n; i++) particles.push({ star: true, x: z.x + rnd() * z.w, y: z.y + 10 + rnd() * Math.max(10, z.h - 20), vx: 0, vy: -14, life: 0.7, col, r: 3 });
    }
    function updateFx(dt) {
      for (const p of particles) {
        p.life -= dt;
        if (p.fall || p.ring) { p.t += dt; continue; }
        if (p.curl || p.steam) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.curl) p.vy += 40 * dt; continue; }
        if (p.log) {
          p.t += dt;
          const q = clamp(p.t / 0.85, 0, 1);
          p.x = p.x0 + (p.tx - p.x0) * q;
          p.y = p.y0 + (p.ty - p.y0) * q - Math.sin(q * Math.PI) * 26;
          continue;
        }
        p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; p.vy = (p.vy || 0) + (p.star ? 0 : 90) * dt;
      }
      if (particles.length) particles = particles.filter((p) => p.life > 0);
      for (const f of floaters) { f.t += dt; f.y -= (calm ? 0 : 18) * dt; }
      if (floaters.length) floaters = floaters.filter((f) => f.t < 1.1);
      for (const k in flashes) { flashes[k] -= dt; if (flashes[k] <= 0) delete flashes[k]; }
      for (const k in tableAnim) { tableAnim[k] += dt; if (tableAnim[k] > 0.6) delete tableAnim[k]; }
      if (stageAnim) { stageAnim.t += dt; if (stageAnim.t > stageAnim.dur) stageAnim = null; }
      if (shipAnim) { shipAnim.t += dt; if (shipAnim.t > shipAnim.dur) shipAnim = null; }
      if (truckAnim) { truckAnim.t += dt; if (truckAnim.t > truckAnim.dur) truckAnim = null; }
    }
    function startStageAnim() {
      if (calm) { stageAnim = null; return; }
      if (stageAnim) return;
      stageAnim = { t: 0, dur: 1.2 };
      for (let i = 0; i < 24; i++) {
        particles.push({ star: true, x: rnd() * W, y: (scrollY / scale) + rnd() * (viewH / scale), vx: (rnd() - 0.5) * 30, vy: -30 - rnd() * 30, life: 1.1, col: ["#ffd84d", "#ff8a65", "#7fd1ff", "#9be38a"][i % 4], r: 3 });
      }
    }
    function startShip() { if (!shipAnim) shipAnim = { t: 0, dur: calm ? 1.5 : 3.2 }; }
    function burst(kind, dept) {
      const z = geo.zones[dept] || null;
      switch (kind) {
        case "buy":
          if (z) { flashes[dept] = Math.max(flashes[dept] || 0, 0.35); addSparkles(z, 6, "#fff6b0"); }
          break;
        case "boost":
          if (z) addSparkles(z, 4, "#ffb347");
          break;
        case "deliver":
          if (stage === 4) startShip();
          else if (!truckAnim) truckAnim = { t: 0, dur: calm ? 1.5 : 3.0 };
          addSparkles(geo.zones.shop, 8, "#ffd84d");
          break;
        case "ship":
          startShip();
          addSparkles(geo.zones.shop, 8, "#ffd84d");
          break;
        case "stage":
          startStageAnim();
          break;
        case "tool":
          // 道具が次の段に変わった：光の粒＋その部署の人が 1 秒 cheer（動きを減らす設定では粒と跳ねなし。絵はすぐ変わる §19.2.3）
          if (z) { flashes[dept] = Math.max(flashes[dept] || 0, 0.6); addSparkles(z, 14, "#ffe066"); }
          actors.cheer(dept, 1);
          lastToolBurst = { dept, at: clk };
          break;
        default: break;
      }
    }

    // ===== 描く =====
    function draw(state) {
      if (!ctx) return;
      // canvas（sticky）は #sceneInner（世界の高さ）の下端で止まるので、描く位置も同じ所で止める
      const scrollY = clamp(scrollTopRaw(), 0, Math.max(0, worldCssH - viewH));
      const vTop = scrollY / scale, vBot = (scrollY + viewH) / scale;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#e4dccb";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (bg) {
        const sy = scrollY / scale * bgRatio;
        const sh = viewH / scale * bgRatio;
        ctx.drawImage(bg, 0, sy, bg.width, Math.min(sh, bg.height - sy), offX * dpr, 0, W * scale * dpr, Math.min(sh, bg.height - sy) / bgRatio * scale * dpr);
      }
      let k = scale * dpr;
      let ox = offX * dpr, oy = -scrollY * dpr;
      if (stageAnim) {
        const p = stageAnim.t / stageAnim.dur;
        const z = 1 - 0.14 * Math.sin(Math.PI * p);
        const cx = canvas.width / 2, cy = canvas.height / 2;
        ox = cx + (ox - cx) * z; oy = cy + (oy - cy) * z; k *= z;
      }
      ctx.setTransform(k, 0, 0, k, ox, oy);
      if (stageAnim && bg) ctx.drawImage(bg, 0, 0, bg.width, bg.height, 0, 0, W, geo.H);   // 画面を引いた形（背景を縮めて描き直す）
      const s = state;
      drawDynamicScenery(s, vTop, vBot);
      drawForest(vTop, vBot);
      drawPiles(s);
      drawStations(s);
      drawActors(vTop, vBot);
      drawShipTruck(s, vTop, vBot);
      drawZonesOverlay(s);
      drawFx();
      if (stageAnim) {
        const p = stageAnim.t / stageAnim.dur;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "rgba(255,255,255," + (0.45 * Math.sin(Math.PI * p)).toFixed(3) + ")";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }

    function drawDynamicScenery(s, vTop, vBot) {
      // 煙突の煙（こうじょう から）・かもめ（みなと）
      if (stage >= 3 && vTop < 230) {
        ctx.fillStyle = "rgba(240,240,240,0.8)";
        for (let i = 0; i < 3; i++) {
          const p = calm ? i / 3 : ((clk * 0.25 + i / 3) % 1);
          ctx.beginPath(); ctx.arc(311 + p * 18, 206 - p * 60, 5 + p * 7, 0, 6.29); ctx.fill();
        }
      }
      if (stage === 4 && vTop < 80) {
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i < 2; i++) {
          const x = calm ? 80 + i * 150 : ((clk * (14 + i * 5) + i * 170) % 420) - 30;
          const y = 26 + i * 14 + (calm ? 0 : Math.sin(clk * 2 + i) * 3);
          ctx.moveTo(x - 7, y - 3); ctx.quadraticCurveTo(x - 3, y - 6, x, y); ctx.quadraticCurveTo(x + 3, y - 6, x + 7, y - 3);
        }
        ctx.stroke();
      }
    }

    function drawForest(vTop, vBot) {
      if (vTop > 210) return;
      const sl = actors.slots();
      for (const t of sl) {
        if (t.kind === "tree") drawTree(t.x, t.y, calm ? 1 : 0.6 + 0.4 * t.grow);
        else if (t.kind === "sapling") drawSapling(t.x, t.y);
        else drawStump(t.x, t.y);
      }
    }
    function drawTree(x, y, k) {
      const st = stage;
      ctx.fillStyle = "#7a4e2a";
      ctx.fillRect(x - 2.5, y - 12 * k, 5, 12 * k);
      if (st === 4) {
        ctx.fillStyle = "#7c9a3a";
        ctx.beginPath(); ctx.arc(x, y - 26 * k, 13 * k, 0, 6.29); ctx.fill();
        ctx.fillStyle = "#c98f3c";
        ctx.beginPath(); ctx.arc(x + 4 * k, y - 30 * k, 7 * k, 0, 6.29); ctx.fill();
      } else {
        const col = st === 3 ? ["#3f9a5a", "#5cb874"] : ["#2f6b3a", "#3f8547"];
        ctx.fillStyle = col[0];
        ctx.beginPath(); ctx.moveTo(x - 12 * k, y - 10 * k); ctx.lineTo(x, y - 46 * k); ctx.lineTo(x + 12 * k, y - 10 * k); ctx.closePath(); ctx.fill();
        ctx.fillStyle = col[1];
        ctx.beginPath(); ctx.moveTo(x - 8 * k, y - 26 * k); ctx.lineTo(x, y - 46 * k); ctx.lineTo(x + 8 * k, y - 26 * k); ctx.closePath(); ctx.fill();
      }
    }
    function drawSapling(x, y) {
      ctx.strokeStyle = "#4b7a2e"; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 10); ctx.stroke();
      ctx.fillStyle = "#79c25a";
      ctx.beginPath(); ctx.ellipse(x - 3.5, y - 10, 4, 2.2, -0.5, 0, 6.29); ctx.ellipse(x + 3.5, y - 11, 4, 2.2, 0.5, 0, 6.29); ctx.fill();
    }
    // 切り株：年輪のある低い株（なえぎが植える場所。§18）
    function drawStump(x, y) {
      ctx.fillStyle = "#6b4321";
      ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x - 6, y - 7); ctx.lineTo(x + 6, y - 7); ctx.lineTo(x + 9, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#e6c48f"; ctx.beginPath(); ctx.ellipse(x, y - 7, 6.2, 2.4, 0, 0, 6.29); ctx.fill();
      ctx.strokeStyle = "#a8743f"; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.ellipse(x, y - 7, 3.8, 1.45, 0, 0, 6.29); ctx.moveTo(x + 1.4, y - 7); ctx.ellipse(x, y - 7, 1.4, 0.55, 0, 0, 6.29); ctx.stroke();
    }

    function drawPile(x, y, n, item, maxIcons) {
      const shown = Math.min(Math.floor(n), maxIcons || 10);
      const col = ITEM_COL[item] || "#d9a95f";
      let i = 0;
      for (let row = 0; i < shown; row++) {
        const per = 4 - (row % 4);
        for (let j = 0; j < per && i < shown; j++, i++) {
          const px = x + j * 9 + row * 4.5, py = y - row * 6;
          if (item === "log" || item === "peeled") {
            ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px + 4, py - 3, 3.6, 0, 6.29); ctx.fill();
          } else if (item === "plank") { ctx.fillStyle = col; ctx.fillRect(px - 1, py - 3, 10, 3); }
          else if (item === "smooth") { ctx.fillStyle = col; ctx.fillRect(px - 1, py - 3, 10, 3); ctx.fillStyle = "#ffffff"; ctx.fillRect(px, py - 2.6, 8, 0.8); }
          else { ctx.fillStyle = col; ctx.fillRect(px, py - 6, 7.5, 6); }
        }
      }
    }
    // 名札・吹き出しの札は、文字と丸い地を小さな canvas に一度だけ描いて使い回す（毎コマ fillText しない。性能 §6.4・§19.3.1）
    let labelCache = new Map(), labelKey = "";
    function labelSprite(text, op) {
      const fz = Math.max(12.5, 9 * scale) / scale;
      const r = scale * dpr;
      const ck = r.toFixed(3);
      if (ck !== labelKey) { labelKey = ck; labelCache = new Map(); }
      const key = text + "|" + (op.bold ? 1 : 0) + "|" + (op.bg || "") + "|" + (op.ink || "");
      let e = labelCache.get(key);
      if (e) return e;
      const font = (op.bold ? "700 " : "600 ") + fz.toFixed(1) + "px " + "\"Hiragino Sans\", system-ui, sans-serif";
      ctx.font = font;
      const w = ctx.measureText(text).width + fz * 0.7, h = fz * 1.35;
      let c = null;
      if (doc && doc.createElement) {
        c = doc.createElement("canvas");
        c.width = Math.max(1, Math.ceil(w * r)); c.height = Math.max(1, Math.ceil(h * r));
        const x = c.getContext("2d");
        if (x) {
          x.setTransform(c.width / w, 0, 0, c.height / h, 0, 0);
          x.fillStyle = op.bg || "rgba(20,24,30,0.72)";
          x.beginPath();
          if (x.roundRect) x.roundRect(0, 0, w, h, h / 2); else x.rect(0, 0, w, h);
          x.fill();
          x.font = font;
          x.fillStyle = op.ink || "#ffffff";
          x.textBaseline = "middle";
          x.fillText(text, fz * 0.35, h / 2 + 0.5);
        } else c = null;
      }
      e = { c, w, h, fz, font };
      if (labelCache.size > 400) labelCache.clear();
      labelCache.set(key, e);
      return e;
    }
    function label(text, x, y, opts) {
      const op = opts || {};
      const e = labelSprite(String(text), op);
      const w = e.w, h = e.h;
      const lx = op.right ? x - w : op.center ? x - w / 2 : x;
      if (e.c) ctx.drawImage(e.c, lx, y, w, h);
      else {
        ctx.font = e.font;
        ctx.fillStyle = op.bg || "rgba(20,24,30,0.72)";
        ctx.fillRect(lx, y, w, h);
        ctx.fillStyle = op.ink || "#ffffff";
        ctx.textBaseline = "middle";
        ctx.fillText(text, lx + e.fz * 0.35, y + h / 2 + 0.5);
      }
      lastLabelW = w;
      return h;
    }
    let lastLabelW = 0;
    const widthCache = new Map();
    function labelWidth(text, bold) {
      const fz = Math.max(12.5, 9 * scale) / scale;
      const key = text + "|" + (bold ? 1 : 0) + "|" + fz.toFixed(2);
      let w = widthCache.get(key);
      if (w === undefined) {
        ctx.font = (bold ? "700 " : "600 ") + fz.toFixed(1) + "px " + "\"Hiragino Sans\", system-ui, sans-serif";
        w = ctx.measureText(text).width + fz * 0.7;
        if (widthCache.size > 300) widthCache.clear();
        widthCache.set(key, w);
      }
      return w;
    }
    // 最初の買い物まで なえぎを光らせる（買ったものが 1 つも無い間。§17.3 B1）
    let initDepts = null;
    function noPurchaseYet(s) {
      if (!initDepts) { try { initDepts = Lg().newGame(1).depts; } catch (e) { initDepts = {}; } }
      const ds = s.depts || {};
      for (const d in initDepts) {
        const a = ds[d], b = initDepts[d];
        if (!a || !b) continue;
        if (num(a.level, 1) > num(b.level, 1) || a.mgr || num(a.staff, 0) > num(b.staff, 0) || num(a.lines, 0) > num(b.lines, 0)) return false;
      }
      return true;
    }
    // 今のお金で買えるものがある部署か（名札の「＋」。main.js の canBuyAny と同じ見方）
    let memoState = null, memo = { buy: {} };
    function canBuyAny(s, d) {
      if (memoState === s && d in memo.buy) return memo.buy[d];
      const v = canBuyAnyRaw(s, d);
      if (memoState === s) memo.buy[d] = v;
      return v;
    }
    function canBuyAnyRaw(s, d) {
      const L = Lg();
      if (d === "goods" || typeof L.costOf !== "function") return false;
      for (const what of ["staff", "line", "level", "mgr"]) {
        let c = null;
        try { c = L.costOf(s, d, what); } catch (e) { c = null; }
        if (typeof c === "number" && Number.isFinite(c) && num(s.money, 0) >= c) return true;
      }
      return false;
    }
    function drawPiles(s) {
      const b = s.buf || {};
      const v = (k) => Math.max(0, Math.floor(num(b[k], 0)));
      // 森の置き場（丸太）
      drawPile(12, 244, v("yard"), "log", 8);
      label(String(v("yard")), 50, 230, {});
      // 工場の入口と、台と台の間の置き場（その台に入る品。名前の札は左上なので、山は見出しの帯の右に）
      const f = geo.factory;
      for (const c of f.cols) {
        const k = A.inOf ? A.inOf(c.dept, stage) : null;
        if (!k) continue;
        drawPile(c.x1 - 44, c.y0 + 24, v(k), ITEM_OF[k] || "beam", 7);
      }
      // 売り物の山
      const gk = productKey(stage);
      const g = v("goods");
      const sx = geo.zones.goods.x + 14, sy = geo.shop.pileY;
      rect(ctx, sx - 6, sy, 112, 6, "#8a5a2b");
      drawPile(sx, sy, g, ITEM_OF[gk] || "plank", 16);
      label(String(g), geo.zones.goods.x + geo.zones.goods.w - 8, sy - 34, { right: true });
    }
    const tierOf = (s, d) => (A.tierOf ? A.tierOf(s, d) : 0);
    // 「きんの」：前の段と同じ形で金色＋小さな光（色だけに頼らない。§19.2.1）
    function glint(x, y, r) {
      const q = calm ? 0.6 : 0.5 + 0.5 * Math.sin(clk * 5 + x);
      ctx.fillStyle = "rgba(255,250,210," + (0.55 + 0.45 * q).toFixed(2) + ")";
      ctx.fillRect(x - r, y - 0.7, r * 2, 1.4); ctx.fillRect(x - 0.7, y - r, 1.4, r * 2);
    }
    function drawStations(s) {
      const f = geo.factory;
      const depts = s.depts || {};
      for (const c of f.cols) {
        const d = c.dept;
        const x = depts[d] || {};
        const lines = clamp(Math.floor(num(x.lines, 0)), 0, f.rows);
        const tier = tierOf(s, d);
        const boosted = num(x.boostUntil, -1) > num(s.t, 0);
        const mul = calm ? 1 : ANIM_MUL[tier] || 1;
        for (let r = 0; r < f.rows; r++) {
          const st = A.station(geo, d, r);
          if (r >= lines) {
            // まだ無い台：点線の枠（買える場所の目印）
            ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1.2;
            if (ctx.setLineDash) ctx.setLineDash([3, 3]);
            ctx.strokeRect(st.tx - 22, st.ty - 16, 44, 16);
            if (ctx.setLineDash) ctx.setLineDash([]);
            continue;
          }
          const ta = tableAnim[d + r];
          const k = ta !== undefined && !calm ? clamp(ta / 0.5, 0.1, 1) : 1;
          const active = actorsActive(d, r);
          ctx.save();
          ctx.translate(st.tx, st.ty);
          if (k !== 1) ctx.scale(k, k);
          if (d !== "dry") {
            rect(ctx, -22, -14, 44, 5, "#c79a64");
            rect(ctx, -20, -9, 4, 9, "#6b4321");
            rect(ctx, 16, -9, 4, 9, "#6b4321");
          }
          const spin = calm || !active ? 0 : clk * (boosted ? 14 : 7) * mul;
          const mv = calm || !active ? 0 : Math.sin(clk * (boosted ? 12 : 6) * mul);
          drawTool(d, tier, spin, mv, active);
          if (flashes[d]) { ctx.fillStyle = "rgba(255,255,220," + (Math.min(1, flashes[d] / 0.6) * 0.7).toFixed(2) + ")"; ctx.fillRect(-24, -40, 48, 40); }
          ctx.restore();
        }
      }
      // お店の看板（おみせ の道具。屋根の右。§19.2.1）
      drawShopSign(tierOf(s, "shop"));
      const sh = geo.shop;
      if (flashes.shop) { ctx.fillStyle = "rgba(255,255,220,0.5)"; ctx.fillRect(152, sh.counterY - 30, 200, 44); }
    }
    // 台の上の道具（原点は台の上の真ん中。台の上面は y = -14）
    function drawTool(d, tier, spin, mv, active) {
      const gold = tier === 3;
      const metal = gold ? GOLD : "#8b97a3";
      if (d === "peel") {
        ctx.fillStyle = ITEM_COL.log; ctx.fillRect(-16, -21, 20, 7);
        if (tier === 0) {
          // へら：手で丸太の皮をこそぐ
          ctx.save(); ctx.translate(-4 + mv * 5, -22); ctx.rotate(-0.7);
          rect(ctx, -1, -12, 2.4, 10, "#8a5a2b"); rect(ctx, -3, -2, 6.4, 3, "#c9ced4");
          ctx.restore();
        } else if (tier === 1) {
          // ローラー：2 本の筒が回る
          for (const cx of [-10, 0]) {
            ctx.fillStyle = "#6d7680"; ctx.beginPath(); ctx.arc(cx, -26, 4.2, 0, 6.29); ctx.fill();
            ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx, -26); ctx.lineTo(cx + Math.cos(spin) * 3.6, -26 + Math.sin(spin) * 3.6); ctx.stroke();
          }
        } else {
          // かわむきマシン：箱と回る輪
          rect(ctx, 6, -36, 14, 22, metal);
          ctx.fillStyle = gold ? "#a87f10" : "#5b6168"; ctx.beginPath(); ctx.arc(13, -28, 6, 0, 6.29); ctx.fill();
          ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(13, -28); ctx.lineTo(13 + Math.cos(spin) * 5.5, -28 + Math.sin(spin) * 5.5); ctx.stroke();
          if (gold) glint(18, -36, 3);
        }
      } else if (d === "beam") {
        ctx.fillStyle = ITEM_COL.beam; ctx.fillRect(-16, -21, 14, 7);
        if (tier === 0) {
          // おおのこ：大きな手のこを上下に引く
          const y = -30 + mv * 4;
          ctx.fillStyle = "#c9ced4"; ctx.beginPath(); ctx.moveTo(2, y); ctx.lineTo(22, y - 4); ctx.lineTo(22, y + 4); ctx.lineTo(2, y + 7); ctx.closePath(); ctx.fill();
          rect(ctx, -4, y - 1, 7, 5, "#8a5a2b");
        } else {
          // まるのこ（半円）／おおきな まるのこ（丸と覆い）
          const R = tier === 1 ? 10 : 13;
          ctx.fillStyle = metal; ctx.beginPath();
          if (tier === 1) ctx.arc(12, -20, R, Math.PI, 0); else ctx.arc(10, -24, R, 0, 6.29);
          ctx.fill();
          ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.beginPath();
          const cy = tier === 1 ? -20 : -24, cx = tier === 1 ? 12 : 10;
          ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(spin) * (R - 1), cy - Math.abs(Math.sin(spin)) * (R - 1)); ctx.stroke();
          if (tier >= 2) rect(ctx, -2, -40, 24, 4, gold ? "#a87f10" : "#5b6168");
          if (gold) glint(20, -38, 3);
        }
      } else if (d === "dry") {
        // ほしだな：角材を立てかけた棚
        rect(ctx, -22, -40, 3, 40, "#6b4321"); rect(ctx, 10, -40, 3, 40, "#6b4321"); rect(ctx, -22, -40, 35, 3, "#6b4321");
        ctx.fillStyle = ITEM_COL.dried;
        for (let i = 0; i < 3; i++) { ctx.save(); ctx.translate(-16 + i * 9, -2); ctx.rotate(-0.25); ctx.fillRect(-2, -34, 5, 34); ctx.restore(); }
        if (tier === 0) {
          // おひさま
          const q = calm ? 0 : Math.sin(clk * 1.5) * 0.15;
          ctx.fillStyle = "#ffcf33"; ctx.beginPath(); ctx.arc(20, -40, 6 + q * 4, 0, 6.29); ctx.fill();
          ctx.strokeStyle = "#ffcf33"; ctx.lineWidth = 1.4; ctx.beginPath();
          for (let i = 0; i < 6; i++) { const a = i * 1.047 + q; ctx.moveTo(20 + Math.cos(a) * 8, -40 + Math.sin(a) * 8); ctx.lineTo(20 + Math.cos(a) * 11, -40 + Math.sin(a) * 11); }
          ctx.stroke();
        } else if (tier === 1) {
          // せんぷうき：回る羽根
          rect(ctx, 20, -16, 2, 16, "#5b6168");
          ctx.fillStyle = "#cfe6ff";
          for (let i = 0; i < 3; i++) { const a = spin * 1.6 + i * 2.094; ctx.beginPath(); ctx.ellipse(21 + Math.cos(a) * 4, -22 + Math.sin(a) * 4, 4.5, 2, a, 0, 6.29); ctx.fill(); }
        } else if (tier === 2) {
          // ストーブ：ゆらゆら の熱
          rect(ctx, 15, -14, 11, 14, "#5b6168"); rect(ctx, 17, -10, 7, 5, active && !calm ? "#ff8a3c" : "#c0602a");
          ctx.strokeStyle = "rgba(255,170,90,0.85)"; ctx.lineWidth = 1.3; ctx.beginPath();
          for (let i = 0; i < 2; i++) { const x0 = 17 + i * 5, w = calm ? 0 : Math.sin(clk * 4 + i) * 2; ctx.moveTo(x0, -16); ctx.quadraticCurveTo(x0 + 3 + w, -21, x0, -26); ctx.quadraticCurveTo(x0 - 3 - w, -31, x0, -36); }
          ctx.stroke();
        } else {
          // かんそうマシン：箱と湯気
          rect(ctx, -24, -44, 50, 44, "rgba(120,130,140,0.55)"); rect(ctx, -24, -44, 50, 4, "#6d7680");
          rect(ctx, 16, -40, 8, 6, "#7fd1ff");
          if (!calm) { const q = (clk * 0.8) % 1; ctx.fillStyle = "rgba(255,255,255," + (0.8 - q * 0.7).toFixed(2) + ")"; ctx.beginPath(); ctx.arc(4 + q * 6, -48 - q * 10, 3 + q * 3, 0, 6.29); ctx.fill(); }
        }
      } else if (d === "plank") {
        ctx.fillStyle = ITEM_COL.plank; ctx.fillRect(-16, -18, 22, 3); ctx.fillRect(-16, -22, 22, 3);
        if (tier === 0) {
          // てのこ：小さな のこぎりを前後に
          const x = 2 + mv * 4;
          ctx.fillStyle = "#c9ced4"; ctx.beginPath(); ctx.moveTo(x, -24); ctx.lineTo(x + 14, -26); ctx.lineTo(x + 14, -22); ctx.closePath(); ctx.fill();
          rect(ctx, x + 13, -28, 5, 7, "#8a5a2b");
        } else {
          // でんきのこ（刃 1 枚）／ならびのこ（刃 3 枚）
          const n = tier === 1 ? 1 : 3;
          for (let i = 0; i < n; i++) {
            const bx = 8 + i * 6 - (n - 1) * 3;
            rect(ctx, bx, -36, 5, 22, metal);
            ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.beginPath();
            const yy = -36 + (((spin * 3) + i * 7) % 22 + 22) % 22;
            ctx.moveTo(bx + 0.5, yy); ctx.lineTo(bx + 4.5, yy); ctx.stroke();
          }
          if (tier >= 2) rect(ctx, 0, -40, 26, 4, gold ? "#a87f10" : "#5b6168");
          if (gold) glint(22, -40, 3);
        }
      } else if (d === "plane") {
        // かんな：板の上を前後に。けずりくずは できたとき（curl）
        ctx.fillStyle = ITEM_COL.smooth; ctx.fillRect(-18, -18, 30, 4);
        ctx.fillStyle = "#ffffff"; ctx.fillRect(-16, -17, 26, 1);
        if (tier <= 1) {
          const w = tier === 0 ? 9 : 14, x = -6 + mv * 7;
          rect(ctx, x - w / 2, -24, w, 6, "#b07a3a"); rect(ctx, x - 1, -27, 3, 3, "#6b4321");
        } else {
          // でんきかんな（きんの かんな も同じ形で金色）
          rect(ctx, -2, -32, 22, 14, metal);
          ctx.fillStyle = gold ? "#a87f10" : "#5b6168"; ctx.beginPath(); ctx.arc(9, -22, 4, 0, 6.29); ctx.fill();
          ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(9, -22); ctx.lineTo(9 + Math.cos(spin * 1.5) * 3.6, -22 + Math.sin(spin * 1.5) * 3.6); ctx.stroke();
          if (gold) glint(18, -32, 3);
        }
      }
    }
    // おみせ の看板：はりがみ → かんばん → ひかる かんばん → きんの かんばん（屋根の右、売り子より上）
    function drawShopSign(tier) {
      const sh = geo.shop;
      const x = 274, y = sh.y0 + 32;
      if (tier === 0) {
        ctx.save(); ctx.translate(x + 30, y + 9); ctx.rotate(-0.06);
        rect(ctx, -16, -9, 32, 18, "#fbf7ec");
        rect(ctx, -12, -5, 24, 2, "#a0522d"); rect(ctx, -12, 0, 18, 2, "#a0522d");
        ctx.restore();
        return;
      }
      const gold = tier === 3;
      rect(ctx, x + 6, y + 18, 3, 6, "#6b4321"); rect(ctx, x + 63, y + 18, 3, 6, "#6b4321");
      rect(ctx, x, y, 72, 19, gold ? GOLD : "#7a4e2a");
      rect(ctx, x + 3, y + 3, 66, 13, gold ? "#f5d76e" : "#a8774a");
      ctx.font = "800 10px \"Hiragino Sans\", system-ui, sans-serif"; ctx.textBaseline = "middle"; ctx.textAlign = "center";
      ctx.fillStyle = gold ? "#5a3f00" : "#fff6dc"; ctx.fillText("もくもく", x + 36, y + 10);
      ctx.textAlign = "left";
      if (tier >= 2) {
        // ひかる：ふちの電球がじゅんばんに光る
        for (let i = 0; i < 6; i++) {
          const on = calm ? true : Math.floor(clk * 4 + i) % 2 === 0;
          ctx.fillStyle = on ? "#fff36b" : "#9a8a40";
          ctx.beginPath(); ctx.arc(x + 6 + i * 12, y - 2, 2, 0, 6.29); ctx.fill();
        }
      }
      if (gold) glint(x + 66, y + 2, 4);
    }
    function actorsActive(d, r) {
      for (const a of actors.all()) if (a.dept === d && a.idx === r && a.role === DEPT_ROLE[d]) return a.active;
      return false;
    }

    // 待つ人の吹き出しの言葉（何を待っているか。§18）。部署ごとに 1 人だけ（ほかの人は「…」）
    const WAIT_IN = { cut: "きが ないよ", plant: "きりかぶ まち", carry: "まるた まち", peel: "まるた まち", beam: "むきまるた まち", dry: "かくざい まち", plank: "かくざい まち", plane: "いた まち" };
    const waitInText = (d) => (d === "plank" && stage >= 3 ? "かんそう まち" : WAIT_IN[d]);
    let speakers = {};
    function pickSpeakers() {
      const why = typeof actors.why === "function" ? actors.why() || {} : {};
      const out = {};
      for (const a of actors.all()) {
        // 売り子は名札の すぐ下に立つので吹き出しを出さない（「…」のまま。待つ理由はシートと読み上げで出す）
        if (a.pose !== "wait" || a.role !== DEPT_ROLE[a.dept] || a.role === "seller" || !why[a.dept]) continue;
        const cur = out[a.dept];
        if (!cur || a.idx > cur.idx) out[a.dept] = a;   // 下の段の人（上の名札から遠い）
      }
      speakers = {};
      for (const d in out) speakers[out[d].id] = why[d] === "out" ? "おきば いっぱい" : waitInText(d) || "まち";
    }
    function drawBubble(a, text) {
      const w = labelWidth(text, true);
      const h = Math.max(12.5, 9 * scale) / scale * 1.35;
      ctx.fillStyle = "rgba(255,255,255,0.94)";
      // 頭の上に出すと場所の名札（左上の 2 行）に重なるときは、横に出す。はこぶ は上に森の「ここが おそい！」があるので いつも横
      const z = geo.zones[a.dept];
      const y = a.y - 34 - h;
      const tagBot = z ? z.y + 3 + h * 2 + 6 : -1;
      const nearTag = z && a.role !== "planter" && a.role !== "cutter" && y < tagBot && a.x - w / 2 < z.x + 120;
      if (a.role === "carrier" || nearTag) {
        const right = a.x + 22 + w <= W - 2;
        const lx = right ? a.x + 22 : a.x - 22 - w, sy = a.y - 22 - h / 2;
        const ex = right ? lx + 1 : lx + w - 1;
        ctx.beginPath(); ctx.moveTo(ex, sy + h / 2 - 3); ctx.lineTo(ex, sy + h / 2 + 3); ctx.lineTo(a.x + (right ? 7 : -7), a.y - 20); ctx.closePath(); ctx.fill();
        label(text, lx, sy, { bg: "rgba(255,255,255,0.94)", ink: "#2b2200", bold: true });
        return;
      }
      const cx = clamp(a.x, 4 + w / 2, W - 4 - w / 2);
      ctx.beginPath(); ctx.moveTo(a.x - 3, a.y - 34.5); ctx.lineTo(a.x + 3, a.y - 34.5); ctx.lineTo(a.x, a.y - 30); ctx.closePath(); ctx.fill();
      label(text, cx, y, { center: true, bg: "rgba(255,255,255,0.94)", ink: "#2b2200", bold: true });
    }
    function drawActors(vTop, vBot) {
      pickSpeakers();
      const list = actors.all().slice().sort((p, q) => p.y - q.y);
      let counterDone = false;
      for (const a of list) {
        if (a.y < vTop - 10 || a.y - 40 > vBot) continue;
        if (!counterDone && a.y > geo.shop.counterY + 1) {
          counterDone = true;
          drawCounter();   // カウンターを売り子の前に（売り子は後ろに隠れる）
        }
        drawPerson(a);
      }
      if (!counterDone) drawCounter();
      // 吹き出しは人より前に（ほかの人に隠れない）
      for (const a of list) {
        const t = speakers[a.id];
        if (t && a.y >= vTop - 10 && a.y - 60 <= vBot) drawBubble(a, t);
      }
    }
    function drawCounter() {
      const sh = geo.shop;
      rect(ctx, 152, sh.counterY, 200, 14, stage >= 3 ? "#8a5a2b" : "#a8774a");
      rect(ctx, 152, sh.counterY, 200, 3, "#c79a64");
    }
    function drawPerson(a) {
      const isMgr = a.role === "manager";
      const k = isMgr ? 1.2 : 1;
      const col = a.role === "customer" ? CUST_BODY[a.look % 4] : ROLE_COL[a.role] || "#888";
      const walking = a.pose === "walk" || a.pose === "carry";
      const sp = calm ? 4 : 9;
      const ph = clk * sp + a.ph;
      let hop = 0;
      if (!calm && a.pose === "cheer") hop = Math.abs(Math.sin(clk * 12 + a.ph)) * 3;
      if (!calm && a.made > 0) hop = Math.max(hop, Math.sin((a.made / 0.35) * Math.PI) * 2.5);
      const x = a.x, y = a.y - hop;
      const bow = a.bow > 0 ? Math.sin(Math.min(1, a.bow / 1.2) * Math.PI) : 0;
      if (a.role === "carrier" && (a.tier | 0) === 3) { drawTruck(a); return; }
      ctx.save();
      ctx.translate(x, y);
      if (k !== 1) ctx.scale(k, k);
      // 1. 足
      ctx.strokeStyle = "#3a3a3a"; ctx.lineWidth = 2;
      const sw = walking ? Math.sin(ph) * 3 : 0;
      ctx.beginPath(); ctx.moveTo(-2, -7); ctx.lineTo(-2 + sw, 0); ctx.moveTo(2, -7); ctx.lineTo(2 - sw, 0); ctx.stroke();
      if (bow) ctx.rotate(bow * 0.45 * a.dir);
      // 2. 胴
      ctx.fillStyle = col;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-4.5, -16, 9, 10, 3); else ctx.rect(-4.5, -16, 9, 10);
      ctx.fill();
      // 3. 頭
      const hx = 0, hy = -20;
      ctx.fillStyle = SKIN[a.id % 4];
      ctx.beginPath(); ctx.arc(hx, hy, 4.2, 0, 6.29); ctx.fill();
      // 4. 帽子（形で部署が分かる）
      drawHat(a, hx, hy);
      // 5. 手と持ち物
      drawHands(a, ph);
      ctx.restore();
      // 6. 頭の上の印（…＝まち、！＝おうえん）
      if ((a.pose === "wait" && !speakers[a.id]) || a.pose === "cheer") {
        const my = a.y - 30 * k - hop;
        ctx.font = "800 11px system-ui, sans-serif";
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "center";
        ctx.fillStyle = a.pose === "wait" ? "#ffffff" : "#ffb000";
        ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 2.5;
        const t = a.pose === "wait" ? "…" : "!";
        ctx.strokeText(t, a.x, my); ctx.fillText(t, a.x, my);
        ctx.textAlign = "left";
      }
    }
    // はこぶ の トラック：人が乗った小さな車（6 本つむ）。§19.2.1
    function drawTruck(a) {
      const d = a.dir;
      ctx.save();
      ctx.translate(a.x, a.y);
      if (d < 0) ctx.scale(-1, 1);
      rect(ctx, -16, -13, 21, 9, "#4e7fbf");
      rect(ctx, 5, -17, 10, 13, "#2f5c96");
      rect(ctx, 8, -15, 6, 5, "#cfe6ff");
      ctx.fillStyle = SKIN[a.id % 4]; ctx.beginPath(); ctx.arc(10, -12.5, 2.4, 0, 6.29); ctx.fill();
      ctx.fillStyle = "#2b2b2b"; ctx.beginPath(); ctx.arc(-10, -3, 3.2, 0, 6.29); ctx.moveTo(13, -3); ctx.arc(10, -3, 3.2, 0, 6.29); ctx.fill();
      if (a.carry) {
        ctx.fillStyle = ITEM_COL.log; ctx.beginPath();
        for (let i = 0; i < 6; i++) { const lx = -13 + (i % 3) * 6.5, ly = -15.5 - Math.floor(i / 3) * 4.5; ctx.moveTo(lx + 3, ly); ctx.arc(lx, ly, 3, 0, 6.29); }
        ctx.fill();
      }
      ctx.restore();
    }
    function drawHat(a, hx, hy) {
      const col = a.role === "customer" ? null : ROLE_COL[a.role];
      ctx.fillStyle = col || "#333";
      ctx.beginPath();
      switch (a.role) {
        case "cutter": ctx.moveTo(hx - 5, hy - 2); ctx.lineTo(hx, hy - 11); ctx.lineTo(hx + 5, hy - 2); ctx.closePath(); break;  // 三角
        case "planter": ctx.ellipse(hx, hy - 3, 8, 2.2, 0, 0, 6.29); ctx.fill(); ctx.beginPath(); ctx.arc(hx, hy - 3, 3.4, Math.PI, 0); break;  // つば広
        case "carrier": ctx.rect(hx - 4.6, hy - 3.6, 9.2, 2.6); ctx.rect(hx - 7.5 * a.dir - 1.5, hy - 3.4, 3, 4); break;  // 鉢巻
        case "peeler": ctx.arc(hx, hy - 2, 4.6, Math.PI, 0); break;  // 丸い帽子
        case "beamer": ctx.rect(hx - 4.5, hy - 9, 9, 6.5); break;  // 四角
        case "dryer": ctx.rect(hx - 4.8, hy - 4.2, 9.6, 3); ctx.rect(hx - 1.5, hy - 9, 3, 5); break;  // タオルの鉢巻と結び目（上に立つ）
        case "planer": ctx.ellipse(hx + a.dir * 1.2, hy - 4, 5.6, 2.6, 0, 0, 6.29); break;  // ひらたい帽子
        case "planker": ctx.rect(hx - 4.5, hy - 6, 9, 3.4); ctx.rect(hx + (a.dir > 0 ? 3 : -8), hy - 3.6, 5, 1.6); break;  // つばの帽子
        case "seller": ctx.moveTo(hx - 5, hy - 5); ctx.lineTo(hx, hy - 2); ctx.lineTo(hx + 5, hy - 5); ctx.lineTo(hx + 5, hy - 1); ctx.lineTo(hx - 5, hy - 1); ctx.closePath(); break;  // リボン
        case "manager": ctx.rect(hx - 3.6, hy - 11, 7.2, 8); ctx.rect(hx - 6, hy - 3.5, 12, 1.6); break;  // シルクハット
        case "sailor": ctx.fillStyle = "#ffffff"; ctx.rect(hx - 4.5, hy - 6, 9, 3); ctx.fill(); ctx.beginPath(); ctx.fillStyle = "#0072b2"; ctx.rect(hx - 4.5, hy - 3.5, 9, 1.2); break;
        case "customer": {
          const lk = a.look % 4;
          if (lk === 0) { ctx.fillStyle = "#3b2a20"; ctx.arc(hx, hy - 1.5, 4.4, Math.PI, 0); }
          else if (lk === 1) { ctx.fillStyle = "#ffffff"; ctx.rect(hx - 4.6, hy - 3.8, 9.2, 2.4); }
          else if (lk === 2) { ctx.fillStyle = "#7a2e4a"; ctx.ellipse(hx + 1, hy - 4, 5.2, 2.2, -0.2, 0, 6.29); }
          else { ctx.fillStyle = "#1d2b4a"; ctx.rect(hx - 4.5, hy - 7, 9, 4); ctx.rect(hx - 2, hy - 3.4, 8 * a.dir, 1.4); }
          break;
        }
        default: break;
      }
      ctx.fill();
    }
    function drawHands(a, ph) {
      ctx.strokeStyle = "#3a3a3a"; ctx.lineWidth = 1.8;
      const d = a.dir;
      const working = a.pose === "work" || a.pose === "cheer";
      const fast = a.pose === "cheer" ? 2 : 1;
      const tier = a.tier | 0;
      const mul = calm ? 1 : ANIM_MUL[tier] || 1;   // 道具が よくなると手が速く動く（見た目だけ §19.2.2）
      const on = working && a.active && !calm;
      switch (a.role) {
        case "cutter": {
          if (tier === 0) {
            // おの：振り下ろす
            const sw = on ? Math.sin(ph * 0.8 * fast * mul) * 0.9 : (working && a.active ? 0.4 : -0.6);
            const ex = d * (Math.cos(sw) * 9), ey = -13 - Math.sin(sw) * 9;
            ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(ex, ey); ctx.stroke();
            ctx.fillStyle = "#9aa3ad"; ctx.fillRect(ex - 2, ey - 2.5, 4, 5);
          } else if (tier === 1) {
            // のこぎり：前後に引く
            const hx = d * (6 + (on ? Math.sin(ph * 0.9 * fast * mul) * 3 : 0));
            ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(hx, -11); ctx.stroke();
            ctx.fillStyle = "#c9ced4"; ctx.beginPath(); ctx.moveTo(hx, -12.5); ctx.lineTo(hx + d * 13, -11.5); ctx.lineTo(hx + d * 13, -9); ctx.lineTo(hx, -9); ctx.closePath(); ctx.fill();
            rect(ctx, hx - (d > 0 ? 3 : 0), -13, 3, 4, "#8a5a2b");
          } else {
            // チェーンソー（きんの は同じ形で金色＋光）：刃が光って小さな木くず
            const gold = tier === 3;
            const jit = on ? Math.sin(clk * 40) * 0.6 : 0;
            ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(d * 5, -11); ctx.stroke();
            rect(ctx, d > 0 ? 4 : -11, -14 + jit, 7, 6, gold ? GOLD : "#e8752a");
            rect(ctx, d > 0 ? 11 : -22, -12.5 + jit, 11, 3, on ? "#e9eef2" : "#aab2ba");
            if (on && Math.floor(clk * 12 + a.ph) % 2 === 0) { ctx.fillStyle = "#f2d6a2"; ctx.fillRect(d * 20, -8, 1.8, 1.8); ctx.fillRect(d * 17, -6, 1.5, 1.5); }
            if (gold) glint(d * 8, -15, 2.4);
          }
          break;
        }
        case "planter": {
          if (a.tool === "can") {
            // じょうろで若木に水をやる（切り株を待っている間）
            ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(d * 6, -10); ctx.stroke();
            ctx.fillStyle = "#7fa7c9"; ctx.fillRect(d * 6 - 3, -13, 6, 5);
            ctx.beginPath(); ctx.moveTo(d * 9, -12); ctx.lineTo(d * 13, -15); ctx.stroke();
            if (!calm) {
              const q = (clk * 1.6 + a.ph) % 1;
              ctx.fillStyle = "#7fd1ff"; ctx.fillRect(d * (13 + q * 2) - 0.8, -14 + q * 12, 1.6, 2.2);
            }
            break;
          }
          const dy = on ? Math.abs(Math.sin(ph * 0.6 * mul)) * 4 : 0;
          if (tier === 2) {
            // なえぎぐるま：苗木を 3 本のせた手押し車を押す
            ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(d * 7, -9); ctx.stroke();
            rect(ctx, d > 0 ? 7 : -21, -9, 14, 5, "#8a5a2b");
            ctx.fillStyle = "#3b3b3b"; ctx.beginPath(); ctx.arc(d * 18, -2.5, 2.6, 0, 6.29); ctx.fill();
            ctx.fillStyle = "#79c25a"; ctx.beginPath();
            for (let i = 0; i < 3; i++) { ctx.moveTo(d * (10 + i * 4) + 2, -11); ctx.arc(d * (10 + i * 4), -11, 2, 0, 6.29); }
            ctx.fill();
          } else if (tier === 1) {
            // くわ：長い柄を振る
            const ex = d * 12, ey = -3 - dy;
            ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(d * 4, -11); ctx.moveTo(d * 2, -17); ctx.lineTo(ex, ey); ctx.stroke();
            rect(ctx, d > 0 ? ex - 1 : ex - 3, ey, 4, 3, "#9aa3ad");
          } else {
            // スコップ（きんの スコップ は金色＋光）
            const gold = tier === 3;
            ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(d * 6, -9 + dy); ctx.moveTo(d * 6, -12 + dy); ctx.lineTo(d * 8, -3 + dy); ctx.stroke();
            ctx.fillStyle = gold ? GOLD : "#9aa3ad"; ctx.fillRect(d * 8 - 2.2, -4 + dy, 4.4, 4.4);
            if (gold) glint(d * 8, -4 + dy, 2.4);
          }
          break;
        }
        case "carrier": {
          // てで（1 本）→ ておしぐるま（2 本）→ にぐるま（4 本）。トラックは drawTruck
          if (tier === 0) {
            if (a.carry) {
              ctx.fillStyle = ITEM_COL.log;
              ctx.beginPath();
              if (ctx.roundRect) ctx.roundRect(-9, -21, 18, 5, 2); else ctx.rect(-9, -21, 18, 5);
              ctx.fill();
              ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(d * 4, -19); ctx.stroke();
            } else {
              const sw = Math.sin(ph) * 3;
              ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(sw, -7); ctx.stroke();
            }
          } else {
            const big = tier === 2;
            const len = big ? 22 : 15, x0 = d > 0 ? 7 : -7 - len;
            ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(d * 7, -9); ctx.stroke();
            rect(ctx, x0, -9, len, 5, "#8a5a2b");
            ctx.fillStyle = "#3b3b3b"; ctx.beginPath();
            if (big) { ctx.arc(x0 + 5, -2.5, 2.8, 0, 6.29); ctx.moveTo(x0 + len - 2, -2.5); ctx.arc(x0 + len - 5, -2.5, 2.8, 0, 6.29); }
            else ctx.arc(x0 + len / 2, -2.5, 2.8, 0, 6.29);
            ctx.fill();
            if (a.carry) {
              ctx.fillStyle = ITEM_COL.log; ctx.beginPath();
              const n = big ? 4 : 2;
              for (let i = 0; i < n; i++) { const lx = x0 + 4 + (i % 2) * 7 + (big ? Math.floor(i / 2) * 2 : 0), ly = -11.5 - Math.floor(i / 2) * 4; ctx.moveTo(lx + 3, ly); ctx.arc(lx, ly, 3, 0, 6.29); }
              ctx.fill();
            }
          }
          break;
        }
        case "sailor": {
          if (a.carry) {
            ctx.fillStyle = stage >= 4 ? ITEM_COL.smooth : ITEM_COL.plank;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(-9, -21, 18, 3, 2); else ctx.rect(-9, -21, 18, 3);
            ctx.fill();
            ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(d * 4, -19); ctx.stroke();
          } else {
            const sw = Math.sin(ph) * 3;
            ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(sw, -7); ctx.stroke();
          }
          break;
        }
        case "peeler": case "beamer": case "dryer": case "planker": case "planer": case "seller": {
          const mv = on ? Math.sin(ph * fast * mul) * 2.5 : 0;
          ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(d * 8, -11 + mv); ctx.stroke();
          break;
        }
        case "manager": {
          if (a.tool === "gain") {
            ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(d * 6, -11); ctx.stroke();
            ctx.fillStyle = "#6b4321"; ctx.fillRect(d * 6 - 4, -14, 8, 6);
            ctx.fillStyle = "#ffd84d"; ctx.fillRect(d * 6 - 3, -12, 6, 1.4);
          } else {
            const wv = calm ? 0 : Math.sin(clk * 6 + a.ph) * 0.3;
            const tx = d * 4, ty = -30;
            ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(tx, ty); ctx.stroke();
            ctx.fillStyle = "#ff5a3c";
            ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + d * (10 + wv * 4), ty + 3 + wv * 3); ctx.lineTo(tx, ty + 7); ctx.closePath(); ctx.fill();
          }
          break;
        }
        case "customer": {
          if (a.carry) {
            const it = ITEM_OF[productKey(stage)] || "plank";
            ctx.fillStyle = ITEM_COL[it];
            const big = Math.min(3, Math.ceil(num(a.want, 1) / 4));
            ctx.fillRect(-6, -16 - big * 2, 12, 4 + big * 2);
          } else {
            ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(d * 3, -7); ctx.stroke();
          }
          break;
        }
        default: break;
      }
    }

    function drawShipTruck(s, vTop, vBot) {
      // トラック（こうじょう：大口の注文を運ぶ）
      if (stage === 3) {
        const y = geo.shop.y0 + 150;
        if (y > vTop - 20 && y - 40 < vBot) {
          let x = 22;
          if (truckAnim) {
            const p = truckAnim.t / truckAnim.dur;
            x = p < 0.5 ? 22 - p * 2 * 170 : 22 - (1 - p) * 2 * 170;
          }
          const o = s.order && s.order.accepted ? s.order : null;
          const load = o && num(o.need, 0) > 0 ? clamp(num(o.got, 0) / o.need, 0, 1) : 0;
          rect(ctx, x, y - 24, 54, 20, "#4e7fbf");
          rect(ctx, x + 54, y - 18, 20, 14, "#2f5c96");
          rect(ctx, x + 60, y - 15, 10, 6, "#cfe6ff");
          if (load > 0 || truckAnim) rect(ctx, x + 3, y - 24 - 8 * (truckAnim ? 1 : load), 48, 8 * (truckAnim ? 1 : load), ITEM_COL.plank);
          ctx.fillStyle = "#2b2b2b"; ctx.beginPath(); ctx.arc(x + 14, y - 3, 5, 0, 6.29); ctx.arc(x + 60, y - 3, 5, 0, 6.29); ctx.fill();
        }
      }
      // 船（みなと）
      if (geo.harbor) {
        const h = geo.harbor;
        if (h.y1 < vTop || h.y0 > vBot + 40) return;
        let x = h.shipX, cargo = 0;
        const ships = Math.floor(num(s.ships, 0));
        let need = 30000;
        try { if (typeof Lg().shipNeed === "function") need = num(Lg().shipNeed(ships), need); } catch (e) { /* 既定 */ }
        cargo = need > 0 ? clamp(num(s.ship && s.ship.got, 0) / need, 0, 1) : 0;
        if (shipAnim) {
          const p = shipAnim.t / shipAnim.dur;
          if (p < 0.55) { x += (p / 0.55) * 180; cargo = 1; } else { x += (1 - (p - 0.55) / 0.45) * 180; cargo = 0; }
        }
        const bob = calm ? 0 : Math.sin(clk * 1.6) * 1.5;
        const y = h.seaY + 8 + bob;
        ctx.fillStyle = "#7a2e2e";
        ctx.beginPath(); ctx.moveTo(x - 10, y - 18); ctx.lineTo(x + 116, y - 18); ctx.lineTo(x + 100, y + 6); ctx.lineTo(x + 4, y + 6); ctx.closePath(); ctx.fill();
        rect(ctx, x - 10, y - 18, 126, 3, "#f4f4f4");
        rect(ctx, x + 50, y - 70, 3, 52, "#5d3c1d");
        ctx.fillStyle = "#f8f4ea";
        ctx.beginPath(); ctx.moveTo(x + 54, y - 68); ctx.lineTo(x + 88, y - 26); ctx.lineTo(x + 54, y - 26); ctx.closePath(); ctx.fill();
        if (cargo > 0) rect(ctx, x + 4, y - 18 - 16 * cargo, 42, 16 * cargo, ITEM_COL.plank);
      }
    }

    function drawZonesOverlay(s) {
      const depts = s.depts || {};
      const t = num(s.t, 0);
      // logic の関数は state を写すので、同じ state（step は 0.1 秒ごと）の間は 1 回だけ求める（性能 §6.4）
      if (memoState !== s) { memoState = s; memo = { buy: {} }; try { memo.bn = typeof Lg().bottleneck === "function" ? Lg().bottleneck(s) : null; } catch (e) { memo.bn = null; } }
      const bn = memo.bn;
      const L = Lg();
      const cd = num(L.BOOST_COOLDOWN, 15), bs = num(L.BOOST_SEC, 5), cc = num(L.CALL_COOLDOWN, 10);
      for (const d of geo.order) {
        const z = geo.zones[d];
        const x = depts[d] || {};
        // 名前の札（文字でも部署が分かる）
        const right = d === "carry";
        const lx = right ? z.x + z.w - 3 : z.x + 3;
        const hh = label(nameOf(d), lx, z.y + 3, { bg: "rgba(20,24,30,0.7)", bold: true, right });
        // 今のお金で買えるものがあれば、名札の横に小さな黄色の「＋」（色だけに頼らず形でも。§17.3 B8）
        if (d !== "goods" && canBuyAny(s, d)) {
          const nw = lastLabelW;
          label("＋", right ? lx - nw - 3 : lx + nw + 3, z.y + 3, { bg: "#ffd84d", ink: "#2b2200", bold: true, right });
        }
        if (d !== "goods") {
          const n = Math.floor(num(LINE_DEPTS[d] ? x.lines : x.staff, 0));
          let sub = n + (LINE_DEPTS[d] ? "だい" : "にん") + " Lv" + Math.floor(num(x.level, 1));
          if (x.mgr === "fast" || x.mgr === "gain") sub += x.mgr === "fast" ? " ⚑" : " ¥";
          label(sub, lx, z.y + 4 + hh, { bg: "rgba(20,24,30,0.55)", right });
        }
        // つまり（黄色の点線と札）
        if (bn === d) {
          ctx.strokeStyle = "#ffd84d"; ctx.lineWidth = 2.6;
          if (ctx.setLineDash) ctx.setLineDash([6, 4]);
          ctx.strokeRect(z.x + 1.5, z.y + 1.5, z.w - 3, z.h - 3);
          if (ctx.setLineDash) ctx.setLineDash([]);
          // 子どもに伝わる言葉（入りきらない幅では短い言葉）
          const jamText = labelWidth("ここが おそい！", true) <= z.w - 6 ? "ここが おそい！" : "おそい！";
          // きこり は下に森の手前の列（人が歩く所）があるので、奥と手前の列の間の草地に出す（人を隠さない。§18）
          const jy = d === "cut" ? geo.forest.rows[0] + 4 : z.y + z.h - 22;
          label(jamText, z.x + 3, jy, { bg: "#ffd84d", ink: "#2b2200", bold: true });
        }
        // 最初の一手：なえぎを「おして！」の札つきでゆっくり光らせる（動きを減らす設定では光らせず札だけ）
        if (d === "plant" && stage === 1 && noPurchaseYet(s)) {
          if (!calm) {
            const pulse = 0.5 + 0.5 * Math.sin(clk * 2.6);
            ctx.strokeStyle = "rgba(255,255,255," + (0.35 + 0.65 * pulse).toFixed(2) + ")"; ctx.lineWidth = 3.4;
            ctx.strokeRect(z.x + 2, z.y + 2, z.w - 4, z.h - 4);
            ctx.fillStyle = "rgba(255,216,77," + (0.05 + 0.2 * pulse).toFixed(2) + ")";
            ctx.fillRect(z.x + 2, z.y + 2, z.w - 4, z.h - 4);
          }
          label("おして！", z.x + z.w / 2, z.y + z.h / 2 - 8, { center: true, bg: "#ffffff", ink: "#2b2200", bold: true });
        }
        // 応援・よびこみの残り時間（丸）
        let until = 0, total = 1, boosting = false;
        if (d === "goods") { until = num(s.callUntil, 0); total = cc; }
        else if (num(x.boostUntil, -1) > t) { until = x.boostUntil; total = bs; boosting = true; }
        else { until = num(x.cooldownUntil, 0); total = cd; }
        const rem = until - t;
        if (rem > 0 && total > 0) {
          const cx = z.x + z.w - 13, cy = z.y + 13;
          ctx.fillStyle = "rgba(20,24,30,0.6)";
          ctx.beginPath(); ctx.arc(cx, cy, 9, 0, 6.29); ctx.fill();
          ctx.fillStyle = boosting ? "#ffb000" : "#bfe3ff";
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 7, -Math.PI / 2, -Math.PI / 2 + 6.283 * clamp(rem / total, 0, 1)); ctx.closePath(); ctx.fill();
        }
      }
    }
    function drawFx() {
      for (const p of particles) {
        if (p.fall) {
          const q = clamp(p.t / 0.6, 0, 1);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.dir * q * 1.45);
          ctx.globalAlpha = 1 - q * 0.6;
          ctx.fillStyle = stage === 4 ? "#7c9a3a" : stage === 3 ? "#3f9a5a" : "#2f6b3a";
          ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(0, -44); ctx.lineTo(10, -10); ctx.closePath(); ctx.fill();
          ctx.restore(); ctx.globalAlpha = 1;
          continue;
        }
        if (p.log) {
          ctx.fillStyle = ITEM_COL.log;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(p.x - 7, p.y - 3, 14, 6, 3); else ctx.rect(p.x - 7, p.y - 3, 14, 6);
          ctx.fill();
          ctx.fillStyle = "#e6c48f"; ctx.beginPath(); ctx.arc(p.x + 6, p.y, 2.4, 0, 6.29); ctx.fill();
          continue;
        }
        if (p.curl) {
          // かんなの けずりくず：くるっと丸まって落ちる
          ctx.strokeStyle = "rgba(240,210,150," + clamp(p.life / 0.4, 0, 1).toFixed(2) + ")"; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, p.t * 9, p.t * 9 + 4.2); ctx.stroke();
          continue;
        }
        if (p.steam) {
          ctx.fillStyle = "rgba(255,255,255," + (clamp(p.life / 0.9, 0, 1) * 0.7).toFixed(2) + ")";
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.5 + p.t * 4, 0, 6.29); ctx.fill();
          continue;
        }
        if (p.ring) {
          ctx.strokeStyle = "rgba(255,255,255," + clamp(p.life / 0.5, 0, 1).toFixed(2) + ")"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, 6 + p.t * 30, 0, 6.29); ctx.stroke();
          continue;
        }
        ctx.globalAlpha = clamp(p.life / 0.4, 0, 1);
        ctx.fillStyle = p.col;
        if (p.star) { ctx.fillRect(p.x - p.r, p.y - 0.8, p.r * 2, 1.6); ctx.fillRect(p.x - 0.8, p.y - p.r, 1.6, p.r * 2); }
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.29); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      for (const f of floaters) {
        ctx.globalAlpha = clamp(1.1 - f.t, 0, 1);
        label(f.text, f.x, f.y, { center: true, bg: "rgba(255,216,77,0.92)", ink: "#2b2200", bold: true });
      }
      ctx.globalAlpha = 1;
    }

    return {
      layout, frame, burst,
      setCalm(b) { calmWanted = !!b; calm = calmWanted || !!(mq && mq.matches); actors.setCalm(calm); if (calm) { stageAnim = null; particles = []; } },
      pause() { paused = true; lastFrameAt = null; },
      resume() { paused = false; lastFrameAt = null; },
      stats() {
        const sorted = drawTimes.slice().sort((p, q) => p - q);
        return { actors: actors.all().length, frames, slowFrames, bgRedraws, drawMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0, calm, toolBurst: lastToolBurst ? lastToolBurst.dept : null };
      },
      actors: () => actors.list(),
      get calm() { return calm; }
    };
  }

  const api = Object.freeze({ create });
  root.SeizaiRender = api;
})(typeof window !== "undefined" ? window : globalThis);
