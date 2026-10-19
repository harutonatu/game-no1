/*
 * いろびん — 描画と演出（状態は変えない。#board の中身・#shop の中・canvas#fx だけをさわる）
 * 契約：docs/irobin-contract.md §7（描画と演出）・§6（DOM）
 * 担当B（画面）だけが編集する。
 *
 * UMD: window.IrobinRender と module.exports。
 *
 * IrobinRender.create({ board, shop, fx }, { calm, sfx }) → { build, layout, update, pour, deny, celebrate,
 *   finishAll, pause, resume, setCalm, busy }
 *   - sfx（任意）：YubiSfx.create("irobin") の戻り値。演出の段ごとに音を鳴らす（無ければ鳴らさない）。
 *   - 演出は自前の時計（requestAnimationFrame で進める）で動かす。pause で時計ごと止まり、resume で続きから。
 *     動いていない間は rAF を回さない。setTimeout は使わない（main の timers に数えない）。
 *   - finishAll：動いている演出を一瞬で終わらせ、待っている Promise をすぐ resolve する。
 *     そろった瞬間の光と粒・音は、まだなら finishAll のときに出す（いちばん気持ちいい瞬間を飛ばさない）。
 *   - 瓶のボタンは、瓶の固定の番号 id（state.bottles[i].id）と結びつける（btn._id・data-id）。届けた瓶は消えるので、
 *     位置（data-index）は届けるたびに変わる。届けの演出は id で瓶を探し、消えたら残りを詰めて並べ直す（なめらかに寄る）。
 *     update で渡された state と、並んでいるボタンの id が食い違えば作り直す（1手もどす・飛ばしたとき）。
 */
(function (root) {
  "use strict";

  const ANIMALS = Object.freeze(["kuma", "usagi", "neko", "penguin", "risu", "hitsuji"]);
  const ANIMAL_NAMES = Object.freeze({ kuma: "くま", usagi: "うさぎ", neko: "ねこ", penguin: "ペンギン", risu: "りす", hitsuji: "ひつじ" });
  // 体の色（トレイを持つ手の色にも使う）
  const FUR = Object.freeze({ kuma: "#b9824f", usagi: "#f1ebe3", neko: "#e9a25c", penguin: "#34405a", risu: "#c97a3f", hitsuji: "#f4efe2" });
  const CAP_DEFAULT = 4;
  const SEG_BASIS = 23;          // 1段の高さ（ガラスの内側の高さに対する %）。4段で 92%、上に首の分が残る
  const RATIO = 2.4;             // 瓶のボタンの高さ ÷ 幅
  const LIFT = 12;               // 選んだ瓶を持ち上げる量（px。CSS と同じ）
  const MAX_PARTS = 48;          // 粒の上限

  // logic.js が無いときの予備（契約 §3.1 と同じ）
  const FALLBACK_COLORS = [
    { id: 0, key: "orange", name: "オレンジ", hex: "#E69F00", mark: "circle" },
    { id: 1, key: "sky", name: "みずいろ", hex: "#56B4E9", mark: "triangle" },
    { id: 2, key: "green", name: "みどり", hex: "#009E73", mark: "square" },
    { id: 3, key: "yellow", name: "きいろ", hex: "#F0E442", mark: "diamond" },
    { id: 4, key: "blue", name: "あお", hex: "#0072B2", mark: "star" },
    { id: 5, key: "red", name: "あか", hex: "#D55E00", mark: "cross" },
    { id: 6, key: "pink", name: "ピンク", hex: "#CC79A7", mark: "heart" },
    { id: 7, key: "white", name: "しろ", hex: "#EEEEEE", mark: "ring" },
    { id: 8, key: "brown", name: "ちゃいろ", hex: "#9A6A3A", mark: "wave" }
  ];
  function logic() { return root.IrobinLogic || null; }
  function colorList() {
    const L = logic();
    return L && Array.isArray(L.COLORS) && L.COLORS.length ? L.COLORS : FALLBACK_COLORS;
  }
  function colorInfo(id) {
    const c = colorList()[id];
    return c || { id, key: "unknown", name: "？", hex: "#888888", mark: "circle" };
  }
  function cap() { const L = logic(); return L && Number.isInteger(L.CAP) && L.CAP > 0 ? L.CAP : CAP_DEFAULT; }

  // 明るい色には濃い記号、暗い色には白い記号（ふち付き）
  function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return 0.5;
    const n = parseInt(m[1], 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function inkFor(hex) { return luminance(hex) > 0.3 ? "#141826" : "#ffffff"; }

  // ===== 記号（文字のフォントに頼らず、図形で描く。viewBox 0 0 24 24） =====
  const MARK_PATHS = {
    circle: '<circle cx="12" cy="12" r="7"/>',
    triangle: '<path d="M12 3.5 21 19.5H3z"/>',
    square: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
    diamond: '<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/>',
    star: '<path d="M12 2.6l2.8 5.8 6.3.8-4.6 4.4 1.2 6.3L12 16.9l-5.7 3 1.2-6.3-4.6-4.4 6.3-.8z"/>',
    cross: '<path d="M9.4 3.5h5.2v5.9h5.9v5.2h-5.9v5.9H9.4v-5.9H3.5V9.4h5.9z"/>',
    heart: '<path d="M12 21s-8.5-5.1-8.5-11.2C3.5 6.7 5.8 4.6 8.4 4.6c1.6 0 2.9.8 3.6 2.1.7-1.3 2-2.1 3.6-2.1 2.6 0 4.9 2.1 4.9 5.2C20.5 15.9 12 21 12 21z"/>',
    ring: '<circle cx="12" cy="12" r="6.4" fill="none" stroke-width="3.6"/>',
    wave: '<path d="M2.5 13.5c2.4-4.6 4.8-4.6 6.4 0s4.4 4.6 6.4 0 4.4-4.6 6.2 0" fill="none" stroke-width="3.4" stroke-linecap="round"/>'
  };
  const Q_PATH = '<path d="M8.6 9.2a3.5 3.5 0 1 1 5 3.1c-1.1.5-1.6 1.2-1.6 2.5" fill="none" stroke="#ffffff" stroke-width="2.7" stroke-linecap="round"/><circle cx="12" cy="18.7" r="1.7" fill="#ffffff"/>';
  function markSvg(colorId, cls) {
    const c = colorInfo(colorId);
    const ink = inkFor(c.hex);
    const edge = ink === "#ffffff" ? "rgba(0,0,0,.45)" : "none";
    const body = MARK_PATHS[c.mark] || MARK_PATHS.circle;
    const strokeOnly = c.mark === "ring" || c.mark === "wave";
    const attrs = strokeOnly ? `stroke="${ink}"` : `fill="${ink}" stroke="${edge}" stroke-width="1"`;
    return `<svg class="${cls || "mark"}" data-mark="${c.mark}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g ${attrs}>${body}</g></svg>`;
  }
  function hiddenSvg() {
    return `<svg class="mark" data-mark="hidden" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${Q_PATH}</svg>`;
  }

  // ===== 動物（オリジナル。丸い頭と耳の形・模様で見分ける） =====
  function disc(ctx, x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); }
  function oval(ctx, x, y, rx, ry, fill, rot) {
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rot || 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  }
  function poly(ctx, pts, fill) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }
  function drawEyes(ctx, cx, cy, r, mood, t, color) {
    const ex = r * 0.36, ey = cy - r * 0.04, er = r * 0.11;
    const blink = mood === "wait" && t > 0 && (t % 3.6) < 0.13;
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, r * 0.085); ctx.lineCap = "round";
    for (const s of [-1, 1]) {
      const x = cx + s * ex;
      if (mood === "happy") {
        ctx.beginPath(); ctx.arc(x, ey + r * 0.06, r * 0.13, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      } else if (blink) {
        ctx.beginPath(); ctx.moveTo(x - er, ey); ctx.lineTo(x + er, ey); ctx.stroke();
      } else {
        disc(ctx, x, ey, er, color);
        disc(ctx, x - er * 0.3, ey - er * 0.35, er * 0.38, "rgba(255,255,255,.9)");
      }
    }
  }
  function drawMouth(ctx, x, y, r, mood, color) {
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.3, r * 0.07); ctx.lineCap = "round";
    if (mood === "happy") {
      ctx.beginPath(); ctx.arc(x, y - r * 0.02, r * 0.16, 0, Math.PI); ctx.closePath();
      ctx.fillStyle = "#b8434f"; ctx.fill();
      disc(ctx, x, y + r * 0.08, r * 0.07, "#f08aa0");
    } else {
      ctx.beginPath();
      ctx.arc(x - r * 0.08, y, r * 0.08, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.moveTo(x + r * 0.16, y);
      ctx.arc(x + r * 0.08, y, r * 0.08, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
    }
  }
  function cheeks(ctx, cx, cy, r, mood) {
    const a = mood === "happy" ? 0.75 : 0.45;
    oval(ctx, cx - r * 0.6, cy + r * 0.26, r * 0.17, r * 0.11, `rgba(255,128,150,${a})`);
    oval(ctx, cx + r * 0.6, cy + r * 0.26, r * 0.17, r * 0.11, `rgba(255,128,150,${a})`);
  }

  /*
   * 動物を1匹描く（純粋な描画関数。メニューの絵でも使える）。
   * kind: ANIMALS のどれか（知らない値は kuma）。mood: enter|wait|happy|leave|empty。t: 秒（まばたき用。0 なら目を開けたまま）
   * 描く範囲は (0,0)-(w,h)。下の端に肩、上に頭と耳。
   */
  function drawAnimal(ctx, kind, opts) {
    if (!ctx) return;
    const o = opts || {};
    const w = Number(o.w) > 0 ? Number(o.w) : (ctx.canvas ? ctx.canvas.width : 100);
    const h = Number(o.h) > 0 ? Number(o.h) : (ctx.canvas ? ctx.canvas.height : 100);
    const mood = typeof o.mood === "string" ? o.mood : "wait";
    const t = Number.isFinite(Number(o.t)) ? Number(o.t) : 0;
    const k = ANIMALS.includes(kind) ? kind : "kuma";
    ctx.save();
    try {
      if (mood === "empty") {
        const r = Math.min(w * 0.3, h * 0.3);
        ctx.setLineDash([Math.max(3, r * 0.18), Math.max(3, r * 0.14)]);
        ctx.strokeStyle = "rgba(154,161,184,.55)"; ctx.lineWidth = Math.max(1.5, r * 0.06);
        ctx.beginPath(); ctx.arc(w / 2, h * 0.48, r, 0, Math.PI * 2); ctx.stroke();
        return;
      }
      const r = Math.min(w * 0.29, h / (k === "usagi" ? 3.9 : 3.35));
      const cx = w / 2;
      const cy = h - r * 1.42;
      const fur = FUR[k];
      const ink = "#2a2230";
      // しっぽ（りす）は体の後ろ
      if (k === "risu") {
        oval(ctx, cx + r * 1.15, cy + r * 0.45, r * 0.55, r * 1.05, "#a9622f", 0.35);
        oval(ctx, cx + r * 1.12, cy + r * 0.4, r * 0.28, r * 0.78, "#e3a56a", 0.35);
      }
      // 肩（体）
      const bodyCol = k === "hitsuji" ? "#f4efe2" : fur;
      oval(ctx, cx, h + r * 0.45, r * 1.3, r * 1.05, bodyCol);
      if (k === "penguin") { ctx.strokeStyle = "rgba(205,218,255,.45)"; ctx.lineWidth = Math.max(1.5, r * 0.06); ctx.stroke(); }
      if (k === "penguin") oval(ctx, cx, h + r * 0.5, r * 0.8, r * 0.85, "#f5f3ee");
      if (k === "hitsuji") {
        for (let i = 0; i < 5; i++) disc(ctx, cx - r * 1.0 + i * r * 0.5, h - r * 0.32, r * 0.32, "#f8f4ea");
      }
      // 耳
      if (k === "kuma") {
        for (const s of [-1, 1]) { disc(ctx, cx + s * r * 0.72, cy - r * 0.7, r * 0.33, fur); disc(ctx, cx + s * r * 0.72, cy - r * 0.7, r * 0.17, "#ecc49b"); }
      } else if (k === "usagi") {
        for (const s of [-1, 1]) {
          const tilt = s * (mood === "happy" ? 0.28 : 0.14);
          oval(ctx, cx + s * r * 0.4, cy - r * 1.25, r * 0.24, r * 0.68, fur, tilt);
          oval(ctx, cx + s * r * 0.4, cy - r * 1.2, r * 0.12, r * 0.5, "#f2b3c4", tilt);
        }
      } else if (k === "neko") {
        for (const s of [-1, 1]) {
          poly(ctx, [[cx + s * r * 0.92, cy - r * 0.3], [cx + s * r * 0.78, cy - r * 1.18], [cx + s * r * 0.22, cy - r * 0.86]], fur);
          poly(ctx, [[cx + s * r * 0.8, cy - r * 0.5], [cx + s * r * 0.72, cy - r * 0.98], [cx + s * r * 0.4, cy - r * 0.8]], "#f6c9a0");
        }
      } else if (k === "risu") {
        for (const s of [-1, 1]) {
          poly(ctx, [[cx + s * r * 0.82, cy - r * 0.45], [cx + s * r * 0.66, cy - r * 1.12], [cx + s * r * 0.3, cy - r * 0.8]], fur);
          poly(ctx, [[cx + s * r * 0.68, cy - r * 1.02], [cx + s * r * 0.6, cy - r * 1.3], [cx + s * r * 0.52, cy - r * 1.02]], "#7d4a25");
        }
      } else if (k === "hitsuji") {
        for (const s of [-1, 1]) oval(ctx, cx + s * r * 0.92, cy + r * 0.02, r * 0.32, r * 0.15, "#5a4a42", s * 0.35);
      }
      // 頭
      if (k === "hitsuji") {
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          disc(ctx, cx + Math.cos(a) * r * 0.78, cy - r * 0.05 + Math.sin(a) * r * 0.78, r * 0.36, "#f8f4ea");
        }
        disc(ctx, cx, cy - r * 0.05, r * 0.8, "#f8f4ea");
        oval(ctx, cx, cy + r * 0.14, r * 0.58, r * 0.7, "#5a4a42");
        for (let i = 0; i < 3; i++) disc(ctx, cx - r * 0.3 + i * r * 0.3, cy - r * 0.62, r * 0.24, "#fffaf0");
      } else {
        disc(ctx, cx, cy, r, fur);
        if (k === "penguin") {   // 暗い背景でも頭の形が分かるよう、明るいふち
          ctx.strokeStyle = "rgba(205,218,255,.55)"; ctx.lineWidth = Math.max(1.5, r * 0.07);
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        }
      }
      // 顔の模様
      let eyeCol = ink;
      if (k === "kuma") {
        oval(ctx, cx, cy + r * 0.32, r * 0.4, r * 0.29, "#f3d9bb");
        oval(ctx, cx, cy + r * 0.2, r * 0.13, r * 0.09, "#3a2418");
      } else if (k === "usagi") {
        poly(ctx, [[cx - r * 0.09, cy + r * 0.17], [cx + r * 0.09, cy + r * 0.17], [cx, cy + r * 0.27]], "#e88aa0");
      } else if (k === "neko") {
        ctx.strokeStyle = "#b8682c"; ctx.lineWidth = Math.max(1.5, r * 0.08); ctx.lineCap = "round";
        for (const dx of [-0.2, 0, 0.2]) { ctx.beginPath(); ctx.moveTo(cx + dx * r, cy - r * 0.92); ctx.lineTo(cx + dx * r * 1.1, cy - r * 0.62); ctx.stroke(); }
        poly(ctx, [[cx - r * 0.09, cy + r * 0.15], [cx + r * 0.09, cy + r * 0.15], [cx, cy + r * 0.25]], "#e07b8c");
        ctx.strokeStyle = "rgba(60,40,40,.55)"; ctx.lineWidth = Math.max(1, r * 0.035);
        for (const s of [-1, 1]) for (const dy of [-0.06, 0.08]) {
          ctx.beginPath(); ctx.moveTo(cx + s * r * 0.42, cy + r * 0.26 + dy * r); ctx.lineTo(cx + s * r * 0.95, cy + r * 0.2 + dy * r * 1.6); ctx.stroke();
        }
      } else if (k === "penguin") {
        disc(ctx, cx - r * 0.3, cy + r * 0.08, r * 0.52, "#f5f3ee");
        disc(ctx, cx + r * 0.3, cy + r * 0.08, r * 0.52, "#f5f3ee");
        oval(ctx, cx, cy + r * 0.3, r * 0.45, r * 0.38, "#f5f3ee");
        poly(ctx, [[cx - r * 0.16, cy + r * 0.2], [cx + r * 0.16, cy + r * 0.2], [cx, cy + r * 0.4]], "#f2a43a");
      } else if (k === "risu") {
        oval(ctx, cx - r * 0.38, cy + r * 0.32, r * 0.32, r * 0.26, "#f6e2c8");
        oval(ctx, cx + r * 0.38, cy + r * 0.32, r * 0.32, r * 0.26, "#f6e2c8");
        ctx.strokeStyle = "#8a4f26"; ctx.lineWidth = Math.max(1.5, r * 0.08); ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.95); ctx.lineTo(cx, cy - r * 0.55); ctx.stroke();
        oval(ctx, cx, cy + r * 0.2, r * 0.1, r * 0.07, "#4a2a18");
      } else if (k === "hitsuji") {
        eyeCol = "#fff7e8";
        oval(ctx, cx, cy + r * 0.42, r * 0.12, r * 0.08, "#2a1f1a");
      }
      if (k !== "hitsuji") cheeks(ctx, cx, cy, r, mood);
      drawEyes(ctx, cx, cy, r, mood, t, eyeCol);
      const mouthY = k === "kuma" ? cy + r * 0.38 : k === "penguin" ? cy + r * 0.5 : k === "hitsuji" ? cy + r * 0.55 : cy + r * 0.34;
      drawMouth(ctx, cx, mouthY, r, mood, k === "hitsuji" ? "#fff7e8" : "#3a2a2a");
    } finally {
      ctx.restore();
    }
  }

  // ===== 動きの形 =====
  const ease = {
    linear: (k) => k,
    inOut: (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
    out: (k) => 1 - Math.pow(1 - k, 3),
    in: (k) => k * k,
    back: (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
    bounce: (k) => {
      const n1 = 7.5625, d1 = 2.75;
      if (k < 1 / d1) return n1 * k * k;
      if (k < 2 / d1) { k -= 1.5 / d1; return n1 * k * k + 0.75; }
      if (k < 2.5 / d1) { k -= 2.25 / d1; return n1 * k * k + 0.9375; }
      k -= 2.625 / d1; return n1 * k * k + 0.984375;
    }
  };
  const lerp = (a, b, k) => a + (b - a) * k;
  function safe(fn) { try { return fn(); } catch (e) { if (typeof console !== "undefined") console.error("IrobinRender:", e); return undefined; } }

  // els = { board, shop, fx }
  function create(els, opts) {
    const o = opts || {};
    const board = els && els.board;
    const shop = els && els.shop;
    const fx = els && els.fx;
    if (!board || !shop) throw new Error("IrobinRender.create: board と shop が必要です");
    const doc = board.ownerDocument || root.document;
    const win = doc.defaultView || root;
    let calm = !!o.calm;
    const sfx = o.sfx || null;
    // 音（sfx が無ければ鳴らさない。音が出なくても演出は続ける）
    const snd = { play(name, arg) { if (!sfx) return; try { sfx.play(name, arg); } catch (e) { /* 無視 */ } } };
    const buzz = (p) => { if (!sfx || typeof sfx.buzz !== "function") return; try { sfx.buzz(p); } catch (e) { /* 無視 */ } };
    const D = (ms) => (calm ? Math.min(ms, 40) : ms);

    let shown = null;               // いま画面に出している state（update で入れたもの）
    let ui = { selected: null, selId: null };   // selId：選んでいる瓶の id（位置は届けるとずれるので、見た目は id で合わせる）
    let buttons = [];
    let level = 1;
    let orders = [];                // 面の最初の注文の順（色 id の列）。動物の種類を決めるのに使う
    const custs = [0, 1].map((i) => {
      const el = shop.querySelector("#cust" + i) || shop.querySelectorAll(".customer")[i] || null;
      return {
        el,
        canvas: el ? el.querySelector("canvas.animal") : null,
        tray: el ? el.querySelector(".tray") : null,
        sr: el ? el.querySelector(".sr") : null,
        color: null, kind: null, mood: "empty", t: 0, sig: ""
      };
    });
    const lastServed = [null, null];   // 枠ごとに最後に届けたお客さん（面クリアの演出で呼び戻す）

    // ---------- 時計と演出の進め方（rAF 1本。止めている間は進まない） ----------
    let clock = 0, lastT = 0, raf = 0, paused = false;
    const tweens = new Set();
    const ticks = new Set();        // 毎フレーム呼ぶ（お客さんの跳ねる絵など）
    const parts = [];
    const rings = [];
    let stream = null;
    let gen = 0;                    // finishAll のたびに +1。古い演出の続きは動かない
    let cur = null;                 // 進行中の pour / celebrate の記録
    let latestState = null;         // 演出中に main から来た最新の state

    const raf_ = (fn) => (typeof win.requestAnimationFrame === "function" ? win.requestAnimationFrame(fn) : 0);
    const caf_ = (id) => { if (typeof win.cancelAnimationFrame === "function") win.cancelAnimationFrame(id); };
    const nowMs = () => (win.performance && typeof win.performance.now === "function" ? win.performance.now() : Date.now());

    function kick() { if (!raf && !paused) raf = raf_(frame); }
    function frame() {
      raf = 0;
      if (paused) return;
      const t = nowMs();
      const dt = lastT ? Math.min(100, Math.max(0, t - lastT)) : 0;
      lastT = t;
      clock += dt;
      for (const tw of Array.from(tweens)) {
        if (!tweens.has(tw)) continue;
        const k = tw.dur <= 0 ? 1 : Math.min(1, Math.max(0, (clock - tw.t0) / tw.dur));
        if (k <= 0) continue;
        safe(() => tw.fn(tw.ease(k), k));
        if (k >= 1) { tweens.delete(tw); tw.res(); }
      }
      for (const f of Array.from(ticks)) safe(() => f(clock / 1000));
      drawFx(dt / 1000);
      if (tweens.size || ticks.size || parts.length || rings.length || stream) kick();
      else { lastT = 0; clearFx(); }
    }
    // ms 後に始まり ms の間動く。fn(e, k)：e は動きの形をかけた値、k は 0..1 の進み
    function tween(ms, fn, easing, delay) {
      return new Promise((res) => {
        const tw = { t0: clock + (delay || 0), dur: Math.max(0, ms), fn, ease: easing || ease.inOut, res };
        if (tw.dur <= 0 && !delay) { safe(() => fn(1, 1)); res(); return; }
        if (!delay) safe(() => fn(tw.ease(0), 0));
        tweens.add(tw);
        kick();
      });
    }
    const wait = (ms) => tween(ms, () => {}, ease.linear);

    // ---------- fx（光の輪・粒・液の筋） ----------
    const fctx = fx && fx.getContext ? fx.getContext("2d") : null;
    let fxW = 0, fxH = 0, fxDpr = 1, fxDirty = false;
    function sizeFx() {
      if (!fx) return;
      const w = win.innerWidth || 0, h = win.innerHeight || 0;
      const dpr = Math.min(2, win.devicePixelRatio || 1);
      if (w === fxW && h === fxH && dpr === fxDpr) return;
      fxW = w; fxH = h; fxDpr = dpr;
      fx.width = Math.max(1, Math.round(w * dpr));
      fx.height = Math.max(1, Math.round(h * dpr));
    }
    function clearFx() {
      if (!fctx || !fxDirty) return;
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.clearRect(0, 0, fx.width, fx.height);
      fxDirty = false;
    }
    function heartPath(c, x, y, s) {
      c.beginPath();
      c.moveTo(x, y + s * 0.35);
      c.bezierCurveTo(x - s * 1.1, y - s * 0.35, x - s * 0.45, y - s * 1.0, x, y - s * 0.45);
      c.bezierCurveTo(x + s * 0.45, y - s * 1.0, x + s * 1.1, y - s * 0.35, x, y + s * 0.35);
      c.closePath();
    }
    function drawFx(dt) {
      if (!fctx) { parts.length = 0; rings.length = 0; stream = null; return; }
      sizeFx();
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.clearRect(0, 0, fx.width, fx.height);
      fctx.setTransform(fxDpr, 0, 0, fxDpr, 0, 0);
      fxDirty = true;
      // 液の筋
      if (stream && stream.on) {
        const s = stream;
        const grd = fctx.createLinearGradient(s.x, s.y0, s.x, s.y1);
        grd.addColorStop(0, s.color); grd.addColorStop(1, s.color);
        fctx.strokeStyle = grd; fctx.lineCap = "round";
        fctx.lineWidth = s.w;
        const wob = Math.sin(clock / 40) * s.w * 0.12;
        fctx.beginPath(); fctx.moveTo(s.x, s.y0); fctx.quadraticCurveTo(s.x + wob, (s.y0 + s.y1) / 2, s.x, s.y1); fctx.stroke();
        fctx.strokeStyle = "rgba(255,255,255,.35)"; fctx.lineWidth = Math.max(1, s.w * 0.25);
        fctx.beginPath(); fctx.moveTo(s.x - s.w * 0.18, s.y0); fctx.lineTo(s.x - s.w * 0.18 + wob, s.y1); fctx.stroke();
      }
      // 光の輪
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        const k = (clock - r.t0) / r.dur;
        if (k >= 1) { rings.splice(i, 1); continue; }
        if (k < 0) continue;
        const e = ease.out(k);
        const rad = lerp(r.r0, r.r1, e);
        fctx.globalAlpha = (1 - k) * r.alpha;
        fctx.strokeStyle = r.color;
        fctx.lineWidth = Math.max(1, r.width * (1 - k * 0.6));
        fctx.shadowColor = r.color; fctx.shadowBlur = r.blur;
        fctx.beginPath(); fctx.ellipse(r.x, r.y, rad * r.sx, rad, 0, 0, Math.PI * 2); fctx.stroke();
        if (r.fill) {
          fctx.globalAlpha = (1 - k) * 0.22 * r.alpha;
          fctx.fillStyle = r.color; fctx.fill();
        }
        fctx.shadowBlur = 0;
      }
      fctx.globalAlpha = 1;
      // 粒
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.life) { parts.splice(i, 1); continue; }
        p.vy += p.g * dt;
        p.vx *= Math.pow(p.drag, dt * 60);
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.rot += p.vr * dt;
        const k = p.age / p.life;
        fctx.globalAlpha = k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3);
        fctx.fillStyle = p.color;
        if (p.shape === "heart") {
          heartPath(fctx, p.x, p.y, p.size * (0.8 + 0.3 * Math.sin(p.age * 10)));
          fctx.fill();
        } else if (p.shape === "confetti") {
          fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot);
          fctx.fillRect(-p.size, -p.size * 0.45, p.size * 2, p.size * 0.9 * Math.abs(Math.cos(p.rot * 1.7)) + 0.6);
          fctx.restore();
        } else if (p.shape === "star") {
          const s = p.size * (1 - k * 0.5);
          fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot);
          fctx.beginPath();
          for (let j = 0; j < 8; j++) { const a = (j / 8) * Math.PI * 2; const rr = j % 2 ? s * 0.38 : s; fctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
          fctx.closePath(); fctx.fill(); fctx.restore();
        } else {
          fctx.beginPath(); fctx.arc(p.x, p.y, p.size * (1 - k * 0.4), 0, Math.PI * 2); fctx.fill();
        }
      }
      fctx.globalAlpha = 1;
    }
    function addPart(p) {
      if (parts.length >= MAX_PARTS) parts.shift();
      parts.push(Object.assign({ age: 0, life: 0.8, g: 900, drag: 0.985, rot: 0, vr: 0, size: 3, shape: "dot" }, p));
      kick();
    }
    function addRing(r) {
      rings.push(Object.assign({ t0: clock, dur: 600, alpha: 1, width: 4, blur: 14, sx: 1, fill: false }, r));
      kick();
    }

    // ---------- 瓶の DOM ----------
    function rectOf(el) { return el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
    function centerOf(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    function segHtml(color, hidden) {
      if (hidden) return `<span class="seg" data-color="" data-hidden="1">${hiddenSvg()}</span>`;
      const c = colorInfo(color);
      return `<span class="seg" data-color="${color}" data-hidden="0" style="--c:${c.hex}">${markSvg(color)}</span>`;
    }
    function bottleLabel(i, b) {
      const n = `${i + 1}ばん：`;
      if (!b || !b.cells || !b.cells.length) return n + "から";
      const names = b.cells.map((c, j) => (b.hidden && b.hidden[j] ? "？" : colorInfo(c).name));
      let s = n + "した から " + names.join("、");
      if (b.sealed) s += "。せん を した。ちゅうもん まち";
      return s;
    }
    const idAt = (st, i) => {
      const b = st && Array.isArray(st.bottles) ? st.bottles[i] : null;
      return b && Number.isSafeInteger(b.id) ? b.id : i;
    };
    // 並んでいるボタンが state の瓶（本数と id の並び）と同じか
    function aligned(st) {
      if (!st || !Array.isArray(st.bottles) || buttons.length !== st.bottles.length) return false;
      for (let i = 0; i < buttons.length; i++) if (buttons[i]._id !== idAt(st, i)) return false;
      return true;
    }
    function byId(id) { for (const b of buttons) if (b._id === id) return b; return null; }
    function syncBottle(i, b, waiting) {
      const btn = buttons[i];
      if (!btn) return;
      btn._b = b;
      const cells = (b && Array.isArray(b.cells)) ? b.cells : [];
      const hid = (b && Array.isArray(b.hidden)) ? b.hidden : [];
      const sealed = !!(b && b.sealed);
      const sig = cells.map((c, j) => (hid[j] ? "h" : c)).join(",") + "|" + (sealed ? 1 : 0) + "|" + (waiting ? 1 : 0);
      if (btn._sig !== sig) {
        btn._sig = sig;
        const glass = btn.querySelector(".glass");
        glass.innerHTML = cells.map((c, j) => segHtml(c, !!hid[j])).join("") + '<span class="shine"></span>';
        btn.dataset.sealed = sealed ? "1" : "0";
        btn.dataset.waiting = sealed && waiting ? "1" : "0";
        btn.dataset.count = String(cells.length);
        const tag = btn.querySelector(".tag");
        if (tag) {
          if (sealed && cells.length) {
            const c = colorInfo(cells[0]);
            tag.style.setProperty("--c", c.hex);
            tag.innerHTML = markSvg(cells[0], "tagmark");
          } else tag.innerHTML = "";
        }
        if (sealed && cells.length) btn.style.setProperty("--seal", colorInfo(cells[0]).hex);
        else btn.style.removeProperty("--seal");
      }
      btn.setAttribute("aria-label", bottleLabel(i, b));
    }
    function applySelection() {
      buttons.forEach((btn) => {
        const on = ui.selId !== null && btn._id === ui.selId;
        btn.dataset.selected = on ? "1" : "0";
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    function isWaiting(b, slots) {
      if (!b || !b.sealed || !b.cells || !b.cells.length) return false;
      return !(Array.isArray(slots) && slots.includes(b.cells[0]));
    }
    function resetStyles() {
      // CSS の transition で「戻る途中」が残らないよう、transition を切って消し、配置を確定してから戻す
      for (const btn of buttons) {
        btn.style.transition = "none"; btn.style.transform = ""; btn.style.zIndex = ""; btn.style.opacity = "";
        btn.classList.remove("glow", "calm-glow");
        const cork = btn.querySelector(".cork"); if (cork) { cork.style.transform = ""; cork.style.opacity = ""; }
        const shine = btn.querySelector(".shine"); if (shine) { shine.style.transform = ""; shine.style.opacity = ""; }
      }
      for (const c of custs) if (c.el) { c.el.style.transform = ""; c.el.style.opacity = ""; }
      void board.offsetWidth;
      for (const btn of buttons) btn.style.transition = "";
      stream = null;
      ticks.clear();
    }

    // opts.orders：面の最初の注文の順（[...slots, ...queue]）。省くと、渡された state から作る
    function build(state, bopts) {
      shown = null;
      if (bopts && Array.isArray(bopts.orders)) orders = bopts.orders.filter((x) => x !== null && x !== undefined);
      else if (state) orders = [].concat(state.slots || [], state.queue || []).filter((x) => x !== null && x !== undefined);
      // 作り直しても、キーボードのフォーカスは同じ瓶（id）に残す
      const act = doc.activeElement;
      const focusId = act && act._id !== undefined && board.contains(act) ? act._id : null;
      board.innerHTML = "";
      buttons = [];
      const n = state && Array.isArray(state.bottles) ? state.bottles.length : 0;
      const frag = doc.createDocumentFragment();
      for (let i = 0; i < n; i++) {
        const btn = doc.createElement("button");
        btn.type = "button";
        btn.className = "bottle";
        btn.dataset.index = String(i);
        btn._id = idAt(state, i);
        btn.dataset.id = String(btn._id);
        btn.dataset.sealed = "0"; btn.dataset.selected = "0"; btn.dataset.waiting = "0";
        btn.innerHTML = '<span class="glass"></span><span class="cork" aria-hidden="true"></span><span class="tag" aria-hidden="true"></span>';
        frag.appendChild(btn);
        buttons.push(btn);
      }
      board.appendChild(frag);
      for (const c of custs) c.sig = "";
      layout();
      if (state) update(state);
      if (focusId !== null) { const f = byId(focusId); if (f) safe(() => f.focus({ preventScroll: true })); }
    }

    // ---------- 並べ方（列数と瓶の大きさ） ----------
    function layout() {
      const n = buttons.length || 1;
      const r = board.getBoundingClientRect();
      const padT = LIFT + 4, padB = 4;
      const W = Math.max(0, r.width - 4);
      const H = Math.max(0, r.height - padT - padB);
      let best = null;
      for (let rows = 1; rows <= Math.min(n, 4); rows++) {
        const cols = Math.ceil(n / rows);
        if (rows > 1 && Math.ceil(n / (rows - 1)) === cols) continue;
        const w0 = W / (cols + (cols - 1) * 0.24);
        let gap = Math.max(4, Math.min(18, w0 * 0.24));
        // 狭い画面では、すき間を詰めてでも瓶を 46px 以上にする（押せる大きさ 44px を守る）
        if (cols > 1 && (W - (cols - 1) * gap) / cols < 46) gap = Math.max(4, Math.min(gap, (W - cols * 46) / (cols - 1)));
        let w = (W - (cols - 1) * gap) / cols;
        const rgap = Math.max(6, Math.min(22, w * 0.28));
        const wH = ((H - (rows - 1) * rgap) / rows) / RATIO;
        w = Math.min(w, wH, 76);
        gap = Math.min(gap, Math.max(4, Math.min(18, w * 0.24)));
        if (!best || w > best.w + 0.5) best = { rows, cols, w, gap, rgap: Math.max(6, Math.min(22, w * 0.28, ((H - rows * w * RATIO) / Math.max(1, rows - 1)))) };
      }
      const bw = Math.max(20, Math.floor(best.w));
      const bh = Math.floor(bw * RATIO);
      board.style.setProperty("--bw", bw + "px");
      board.style.setProperty("--bh", bh + "px");
      board.style.setProperty("--gap", Math.round(best.gap) + "px");
      board.style.setProperty("--rgap", Math.round(best.rgap) + "px");
      const rowW = best.cols * bw + (best.cols - 1) * Math.round(best.gap);
      const side = Math.max(0, Math.floor((r.width - rowW) / 2) - 1);
      board.style.paddingLeft = side + "px";
      board.style.paddingRight = side + "px";
      board.dataset.cols = String(best.cols);
      sizeFx();
      for (let i = 0; i < custs.length; i++) { custs[i].sig = ""; drawCust(i); }
    }

    // ---------- お客さん ----------
    function animalKind(lv, color) {
      const L = logic();
      const oi = orders.indexOf(color);
      const idx = oi >= 0 ? oi : color;
      if (L && typeof L.animalFor === "function") {
        const k = safe(() => L.animalFor(lv, idx));
        if (ANIMALS.includes(k)) return k;
      }
      const n = (Math.abs(Math.floor(Number(lv) || 1)) * 7 + (Number(idx) || 0)) % ANIMALS.length;
      return ANIMALS[n];
    }
    function drawCust(i, t) {
      const c = custs[i];
      if (!c || !c.canvas) return;
      const cv = c.canvas;
      const w = cv.clientWidth || 0, h = cv.clientHeight || 0;
      if (!w || !h) return;
      const dpr = Math.min(2, win.devicePixelRatio || 1);
      const W = Math.round(w * dpr), H = Math.round(h * dpr);
      const sig = [c.kind, c.mood, W, H, t ? Math.floor(t * 30) : 0].join("|");
      if (sig === c.sig) return;
      c.sig = sig;
      if (cv.width !== W) cv.width = W;
      if (cv.height !== H) cv.height = H;
      const ctx = cv.getContext && cv.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawAnimal(ctx, c.kind || "kuma", { w, h, mood: c.color === null && c.mood !== "happy" ? "empty" : c.mood, t: t || 0 });
    }
    function setMood(i, mood) {
      const c = custs[i];
      if (!c || !c.el) return;
      c.mood = mood;
      c.el.dataset.mood = mood;
      drawCust(i);
    }
    function setCustomer(i, color, lv) {
      const c = custs[i];
      if (!c || !c.el) return;
      const has = color !== null && color !== undefined && color !== "";
      c.color = has ? Number(color) : null;
      c.kind = has ? animalKind(lv, c.color) : null;
      c.mood = has ? "wait" : "empty";
      c.el.dataset.color = has ? String(c.color) : "";
      c.el.dataset.mood = c.mood;
      if (c.kind) c.el.style.setProperty("--fur", FUR[c.kind]);
      if (c.tray) {
        if (has) {
          const info = colorInfo(c.color);
          c.tray.style.setProperty("--c", info.hex);
          c.tray.innerHTML = markSvg(c.color, "mark");
        } else {
          c.tray.style.removeProperty("--c");
          c.tray.innerHTML = "";
        }
      }
      if (c.sr) c.sr.textContent = has ? `${colorInfo(c.color).name}の びんが ほしい ${ANIMAL_NAMES[c.kind] || "おきゃくさん"}` : "おきゃくさんは いない";
      c.sig = "";
      drawCust(i);
    }

    // ---------- 演出なしで今の状態に合わせる ----------
    function update(state, u) {
      if (u && typeof u === "object") {
        const sel = Number.isInteger(u.selected) ? u.selected : null;
        const ref = state || latestState || shown;   // selected は渡された state の並びの位置
        ui = { selected: sel, selId: sel !== null && ref && Array.isArray(ref.bottles) && ref.bottles[sel] ? idAt(ref, sel) : null };
      }
      if (state && cur) { latestState = state; }
      if (!state || cur) { applySelection(); return; }
      if (!Array.isArray(state.bottles)) return;
      if (!aligned(state)) { build(state); return; }
      shown = state;
      level = Number(state.level) || 1;
      const slots = Array.isArray(state.slots) ? state.slots : [];
      state.bottles.forEach((b, i) => syncBottle(i, b, isWaiting(b, slots)));
      for (let i = 0; i < custs.length; i++) {
        const want = slots[i] === undefined ? null : slots[i];
        const c = custs[i];
        if (c.color !== (want === null ? null : Number(want)) || !c.kind && want !== null || c.mood !== (want === null ? "empty" : "wait")) setCustomer(i, want, level);
      }
      applySelection();
    }

    // ---------- そろった瞬間（光・栓・粒・音） ----------
    function sealFx(index, color, rec) {
      const btn = buttons[index];
      if (!btn) return;
      if (rec) { rec.played.add("seal"); }
      snd.play("seal", color);
      buzz(15);
      const hex = colorInfo(color).hex;
      const glass = btn.querySelector(".glass");
      const gr = rectOf(glass);
      const c = centerOf(gr);
      if (calm) {
        btn.classList.add("calm-glow");
        tween(300, () => {}, ease.linear).then(() => btn.classList.remove("calm-glow"));
        return;
      }
      // 光の輪（その色）と、少し遅れて白い輪
      addRing({ x: c.x, y: c.y, r0: gr.height * 0.35, r1: gr.height * 0.95, sx: 0.62, color: hex, width: 6, blur: 18, dur: 600, fill: true });
      addRing({ x: c.x, y: c.y, r0: gr.height * 0.3, r1: gr.height * 0.75, sx: 0.62, color: "#ffffff", width: 3, blur: 10, dur: 520, t0: clock + 90, alpha: 0.85 });
      // 粒：瓶の口から噴き出して落ちる
      const mx = c.x, my = gr.top + 2;
      const n = 20;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
        const sp = 160 + Math.random() * 260;
        addPart({
          x: mx + (Math.random() - 0.5) * gr.width * 0.4, y: my,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
          g: 700, life: 0.7 + Math.random() * 0.25,
          size: 2 + Math.random() * 3,
          color: i % 3 === 0 ? "#ffffff" : hex,
          shape: i % 4 === 0 ? "star" : "dot",
          vr: (Math.random() - 0.5) * 8
        });
      }
    }
    // 栓が上から落ちて「ぽん」と弾む
    function corkDrop(index, rec) {
      const btn = buttons[index];
      const cork = btn && btn.querySelector(".cork");
      if (!cork) return Promise.resolve();
      if (calm) { if (rec) rec.played.add("cork"); snd.play("cork"); return Promise.resolve(); }
      const h = btn.getBoundingClientRect().height;
      cork.style.opacity = "1";
      return tween(320, (e) => { cork.style.transform = `translateY(${(-h * 0.32 * (1 - e)).toFixed(1)}px)`; }, ease.bounce)
        .then(() => { cork.style.transform = ""; cork.style.opacity = ""; });
    }

    // ---------- 注ぐ演出（§7.3） ----------
    function interleave(d, a) {
      const out = [];
      const n = Math.max(d.length, a.length);
      for (let i = 0; i < n; i++) { if (d[i]) out.push({ d: d[i] }); if (a[i]) out.push({ a: a[i] }); }
      return out;
    }
    // 届ける途中の見た目（いま並んでいるボタンの順）：注いだ後の state の瓶を id で引き、
    // 届けて消える瓶は「栓をした満杯の瓶」のまま残す（トレイへ飛んでから消える）
    function midBottles(o, st) {
      const now = new Map();
      st.bottles.forEach((b, i) => now.set(idAt(st, i), b));
      const c4 = cap();
      const gone = new Map((o.deliveries || []).map((d) => [d.id, d.color]));
      return buttons.map((btn) => {
        if (now.has(btn._id)) return now.get(btn._id);
        if (gone.has(btn._id)) { const c = gone.get(btn._id); return { cells: Array(c4).fill(c), hidden: Array(c4).fill(false), sealed: true }; }
        return btn._b || { cells: [], hidden: [], sealed: false };
      });
    }

    function pour(outcome, state) {
      if (cur) finishAll();
      // 演出は「注ぐ前の並び」（＝いま並んでいるボタン）の上で行う。並びが注ぐ前の state（shown）と食い違うときは演出しない
      if (!outcome || outcome.kind !== "pour" || !state || !Array.isArray(state.bottles) || !shown || !aligned(shown)) {
        update(state);
        return Promise.resolve();
      }
      ui = { selected: null, selId: null };   // 注いだら選ぶのは終わり（演出中に選び直したら update で入る）
      const rec = { kind: "pour", gen: ++gen, outcome, state, played: new Set(), resolve: null, sealShown: false };
      const p = new Promise((res) => { rec.resolve = res; });
      cur = rec;
      latestState = null;
      runPour(rec).catch((e) => { if (typeof console !== "undefined") console.error("IrobinRender.pour:", e); })
        .then(() => { if (cur === rec) finalize(rec); });
      return p;
    }
    function finalize(rec) {
      cur = null;
      resetStyles();
      const st = latestState || rec.state;
      latestState = null;
      if (st) update(st);
      rec.resolve();
    }

    async function runPour(rec) {
      const o = rec.outcome, st = rec.state;
      const alive = () => rec.gen === gen;
      const src = buttons[o.from], dst = buttons[o.to];
      if (!src || !dst) return;
      const prev = shown || st;
      const count = Math.max(1, Math.min(cap(), Number(o.count) || 1));
      const hex = colorInfo(o.color).hex;
      const wasLift = src.dataset.selected === "1" ? LIFT : 0;
      src.dataset.selected = "0";
      src.style.transition = "none";
      src.style.transform = "none";
      dst.style.transition = "none";   // 前の演出の戻り（CSS の transition）が残っていても、終わりの位置で測る
      const s0 = rectOf(src);
      const d0 = rectOf(dst);
      dst.style.transition = "";
      src.style.transform = wasLift ? `translateY(${-wasLift}px)` : "";
      const dGlass = rectOf(dst.querySelector(".glass"));
      const sc = centerOf(s0);
      const dir = (d0.left + d0.width / 2) >= sc.x ? 1 : -1;
      const theta = 68 * Math.PI / 180;
      const rr = s0.height * 0.36;                     // 中心から口までの長さ
      const mouth = { x: d0.left + d0.width / 2 - dir * d0.width * 0.12, y: dGlass.top - d0.height * 0.06 };
      const cFinal = { x: mouth.x - dir * rr * Math.sin(theta), y: mouth.y + rr * Math.cos(theta) };
      const tx = cFinal.x - sc.x, ty = cFinal.y - sc.y;
      const pre = 18 * dir;                              // 移動しながら少し傾ける
      const setT = (x, y, deg, s) => { src.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${deg.toFixed(2)}deg)` + (s ? ` scale(${s})` : ""); };
      src.style.zIndex = "6";

      // 1. 持ち上げて移動
      if (!calm) {
        await tween(180, (e) => setT(lerp(0, tx, e), lerp(-wasLift, ty, e), lerp(0, pre, e)), ease.inOut);
        if (!alive()) return;
      }
      // 2. 傾けて注ぐ
      snd.play("pour", count);
      rec.played.add("pour");
      const srcSegs = Array.from(src.querySelectorAll(".glass .seg")).slice(-count);
      const dGl = dst.querySelector(".glass");
      const dShine = dGl.querySelector(".shine");
      const newSegs = [];
      for (let i = 0; i < count; i++) {
        const tmp = doc.createElement("span");
        tmp.innerHTML = segHtml(o.color, false);
        const seg = tmp.firstChild;
        seg.style.flexBasis = "0%";
        seg.classList.add("filling");
        dGl.insertBefore(seg, dShine || null);
        newSegs.push(seg);
      }
      const dCount = (prev.bottles[o.to] && prev.bottles[o.to].cells ? prev.bottles[o.to].cells.length : 0);
      const segH = dGlass.height * SEG_BASIS / 100;
      if (!calm) {
        stream = { on: false, x: mouth.x, y0: mouth.y, y1: mouth.y, w: Math.max(3, d0.width * 0.13), color: hex };
        await tween(300 + 60 * count, (e, k) => {
          setT(tx, ty, lerp(pre, dir * 68, ease.out(Math.min(1, k * 1.6))));
          const f = Math.max(0, Math.min(1, (k - 0.22) / 0.68));
          srcSegs.forEach((s) => { s.style.flexBasis = (SEG_BASIS * (1 - f)).toFixed(2) + "%"; });
          newSegs.forEach((s) => { s.style.flexBasis = (SEG_BASIS * f).toFixed(2) + "%"; });
          const surface = dGlass.bottom - 3 - (dCount + count * f) * segH;
          stream.on = k > 0.18 && k < 0.95;
          stream.y0 = mouth.y + 2;
          stream.y1 = Math.max(mouth.y + 4, surface);
          stream.w = Math.max(3, d0.width * 0.13 * (k > 0.8 ? (0.95 - k) / 0.15 : 1));
        }, ease.linear);
        stream = null;
        if (!alive()) return;
        // 3. 戻る
        await tween(180, (e) => setT(lerp(tx, 0, e), lerp(ty, 0, e), lerp(dir * 68, 0, e)), ease.inOut);
        if (!alive()) return;
      } else {
        await wait(D(40));
        if (!alive()) return;
      }
      src.style.transform = ""; src.style.zIndex = ""; src.style.transition = "";

      // 中間の見た目：瓶は最後の state（届けた瓶は満杯のまま）、お客さんは前のまま
      const mid = midBottles(o, st);
      const prevSlots = Array.isArray(prev.slots) ? prev.slots.slice() : [null, null];
      const deliveredSet = new Set((o.deliveries || []).map((d) => d.id));
      mid.forEach((b, i) => syncBottle(i, b, b && b.sealed && !deliveredSet.has(buttons[i]._id) && isWaiting(b, st.slots)));
      applySelection();
      // 見えるようになった段：「？」がふわっと消える
      const rev = Array.isArray(o.revealed) ? o.revealed : [];
      if (rev.length) {
        snd.play("reveal");
        rec.played.add("reveal");
        for (const r of rev) {
          const btn = buttons[r.bottle];
          const seg = btn && btn.querySelectorAll(".glass .seg")[r.index];
          if (!seg || calm) continue;
          const q = doc.createElement("span");
          q.className = "qfade";
          q.innerHTML = hiddenSvg().replace('class="mark"', 'class="qmark"');
          seg.appendChild(q);
          tween(250, (e) => { q.style.opacity = String(1 - e); }, ease.out).then(() => { if (q.parentNode) q.parentNode.removeChild(q); });
        }
      }

      // 4. そろった
      if (o.sealed !== null && o.sealed !== undefined && buttons[o.sealed]) {
        const sb = buttons[o.sealed];
        const shine = sb.querySelector(".shine");
        sealFx(o.sealed, o.color, rec);
        rec.sealShown = true;
        if (!calm) {
          sb.classList.add("glow");
          const pop = tween(320, (e, k) => { sb.style.transform = `scale(${(1 + 0.1 * Math.sin(Math.PI * k)).toFixed(3)})`; }, ease.linear)
            .then(() => { sb.style.transform = ""; });
          const sh = shine ? tween(260, (e) => { shine.style.opacity = String(Math.sin(Math.PI * e)); shine.style.transform = `translateY(${(100 - 200 * e).toFixed(1)}%)`; }, ease.inOut) : Promise.resolve();
          await wait(110);
          if (!alive()) return;
          await corkDrop(o.sealed, rec);
          if (!alive()) return;
          // 栓の着地：「ぽん」と同時に瓶を一瞬ふくらませ、白い小さな輪を出す（ためて、ぽん）
          if (!rec.played.has("cork")) { snd.play("cork"); rec.played.add("cork"); }
          await Promise.all([pop, sh]);
          if (!alive()) return;
          const sr = rectOf(sb.querySelector(".glass") || sb);
          addRing({ x: sr.left + sr.width / 2, y: sr.top, r0: sr.width * 0.2, r1: sr.width * 0.9, sx: 1, color: "#ffffff", width: 3, blur: 8, dur: 320, alpha: 0.9 });
          await tween(90, (e, k) => { sb.style.transform = `scale(${(1 + 0.07 * Math.sin(Math.PI * k)).toFixed(3)})`; }, ease.linear);
          sb.style.transform = "";
          if (!alive()) return;
          await wait(230);   // 余韻：栓をした瓶が光ったまま見える時間
          if (!alive()) return;
          sb.classList.remove("glow");
        } else {
          await corkDrop(o.sealed, rec);
          await wait(D(40));
          if (!alive()) return;
        }
      }

      // 5・6. 届ける・次のお客さん（起きた順）
      // 連鎖（2本目からの届け）は短くして、全体を CHAIN_BUDGET ほどに収める。1本目は見せ場なので元の速さ
      const slotsView = prevSlots;
      const steps = interleave(o.deliveries || [], o.arrivals || []);
      const full = steps[0] && steps[0].d ? 1 : 0;          // 1本目の届けだけ元の速さ
      const baseOf = (st) => (st.d ? DELIVER_MS + (st.wake ? WAKE_MS : 0) : ARRIVE_MS);
      let chainNo = 0;
      steps.forEach((st, i) => { if (st.d && i > 0 && steps[i - 1].a) st.wake = true; });
      const used = steps.slice(0, full).reduce((a, st) => a + baseOf(st), 0);
      const rest = steps.slice(full).reduce((a, st) => a + baseOf(st), 0);
      const fast = rest > 0 ? Math.max(0.12, Math.min(0.45, Math.max(CHAIN_MIN, CHAIN_BUDGET - used) / rest)) : 1;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const sp = i < full ? 1 : fast;
        if (step.d) {
          await deliver(step.d, rec, slotsView, sp, chainNo++, !!step.wake);
        } else {
          await arrive(step.a, rec, slotsView, sp);
        }
        if (!alive()) return;
      }
    }
    const DELIVER_MS = 460 + 480 + 260, ARRIVE_MS = 350, WAKE_MS = 220, CHAIN_BUDGET = 2400, CHAIN_MIN = 1000;   // 届け全体を約2.4秒に収める（1本目の後に最低1秒）

    // 届けて消えた瓶のボタンを取り除き、残りを詰めて並べ直す。残りの瓶は前の場所から新しい場所へ、なめらかに寄る
    // （FLIP：並べ直す前の位置を測り、並べ直した後に「前の位置に見える」ずらしを付けてから 0 へ戻す）。calm では一瞬で
    function removeButton(btn, k_) {
      const idx = buttons.indexOf(btn);
      if (idx < 0) return Promise.resolve();
      const hadFocus = doc.activeElement === btn;
      const rest = buttons.filter((b) => b !== btn);
      const before = new Map(rest.map((b) => [b, rectOf(b)]));
      buttons = rest;
      if (btn.parentNode) btn.parentNode.removeChild(btn);
      buttons.forEach((b, i) => {
        b.dataset.index = String(i);
        if (b._b) b.setAttribute("aria-label", bottleLabel(i, b._b));
      });
      layout();
      applySelection();
      if (hadFocus && buttons.length) { const f = buttons[Math.min(idx, buttons.length - 1)]; safe(() => f.focus({ preventScroll: true })); }
      if (calm) return Promise.resolve();
      const moving = [];
      for (const b of buttons) {
        const r0 = before.get(b), r1 = rectOf(b);
        if (!r0 || !r1.width) continue;
        const dx = (r0.left + r0.width / 2) - (r1.left + r1.width / 2);
        const dy = (r0.top + r0.height / 2) - (r1.top + r1.height / 2);
        const sc = r0.width / r1.width;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sc - 1) < 0.01) continue;
        moving.push({ b, dx, dy, sc });
      }
      if (!moving.length) return Promise.resolve();
      const put = (e) => {
        for (const m of moving) m.b.style.transform = `translate(${(m.dx * (1 - e)).toFixed(1)}px, ${(m.dy * (1 - e)).toFixed(1)}px) scale(${lerp(m.sc, 1, e).toFixed(3)})`;
      };
      for (const m of moving) m.b.style.transition = "none";
      return tween(Math.round(300 * k_), put, ease.inOut).then(() => {
        for (const m of moving) { m.b.style.transform = ""; m.b.style.transition = ""; }
      });
    }

    // sp：速さの倍率（連鎖の2本目からは小さい）。n：連鎖の何本目か（音が1段ずつ上がる）。wake：待っていた瓶（先に光らせる）
    async function deliver(d, rec, slotsView, sp, n, wake) {
      const alive = () => rec.gen === gen;
      const btn = Number.isSafeInteger(d.id) ? byId(d.id) : buttons[d.bottle];   // 位置は前の届けでずれるので id で探す
      const c = custs[d.slot];
      if (!btn || !c || !c.el) return;
      const k_ = sp > 0 ? sp : 1;
      const chainN = Number.isInteger(n) && n > 0 ? n : 0;
      // 待っていた瓶：お客さんが来たら、まず瓶が光って「来たよ」と知らせる（何が起きたか分かるように）
      if (wake) {
        btn.classList.add(calm ? "calm-glow" : "glow");
        if (!calm) {
          const gr0 = rectOf(btn.querySelector(".glass") || btn);
          addRing({ x: gr0.left + gr0.width / 2, y: gr0.top + gr0.height / 2, r0: gr0.height * 0.3, r1: gr0.height * 0.8, sx: 0.62, color: colorInfo(d.color).hex, width: 4, blur: 12, dur: 380 });
        }
        await wait(calm ? D(40) : Math.round(WAKE_MS * k_));
        btn.classList.remove("glow"); btn.classList.remove("calm-glow");
        if (!alive()) return;
      }
      lastServed[d.slot] = { kind: c.kind || animalKind(level, d.color), color: d.color };
      // 飛び立った瓶は、もう選べない・数字キーの番号にも数えない（input は [data-gone] を除いて数える）
      btn.dataset.gone = "1";
      btn.tabIndex = -1;
      btn.setAttribute("aria-hidden", "true");
      btn.style.pointerEvents = "none";
      const br = rectOf(btn), tr = rectOf(c.tray || c.el);
      const bc = centerOf(br), tc = centerOf(tr);
      const dx = tc.x - bc.x, dy = (tr.top - br.height * 0.18) - bc.y;
      btn.style.zIndex = "8";
      btn.style.transition = "none";
      if (!calm) {
        // 少し持ち上げてから、弧を描いてトレイへ。小さくなる
        await tween(Math.round(460 * k_), (e, k) => {
          const arc = -Math.sin(Math.PI * k) * Math.min(60, Math.abs(dy) * 0.35 + 20);
          const s = lerp(1, 0.42, e);
          btn.style.transform = `translate(${(dx * e).toFixed(1)}px, ${(dy * e + arc).toFixed(1)}px) scale(${s.toFixed(3)})`;
        }, ease.inOut);
        if (!alive()) return;
      }
      snd.play("deliver", chainN);
      rec.played.add("deliver");
      // お客さんが喜ぶ（跳ねる＋ハート）
      setMood(d.slot, "happy");
      const hex = colorInfo(d.color).hex;
      if (!calm) {
        for (let i = 0; i < 5; i++) {
          addPart({ x: tc.x + (Math.random() - 0.5) * tr.width * 0.8, y: tr.top - 4, vx: (Math.random() - 0.5) * 40, vy: -90 - Math.random() * 70, g: -30, drag: 0.99, life: 0.9, size: 5 + Math.random() * 3, color: i % 2 ? "#ff7a98" : "#ffb3c4", shape: "heart" });
        }
        const nStar = 8 + Math.min(4, chainN) * 4;   // 連鎖が続くほど、星が増える
        for (let i = 0; i < nStar; i++) {
          const a = (i / nStar) * Math.PI * 2;
          addPart({ x: tc.x, y: tr.top + tr.height / 2, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140 - 40, g: 300, life: 0.5, size: 2.5, color: i % 2 ? "#ffffff" : hex, shape: "star", vr: 6 });
        }
      }
      // 瓶はトレイの上で消える（空の瓶は出てこない）。消えたら、残りの瓶が詰めて寄る
      const fade = calm ? Promise.resolve() : tween(Math.round(140 * k_), (e) => { btn.style.opacity = String(1 - e); }, ease.in);
      const hop = calm ? Promise.resolve() : tween(Math.round(480 * k_), (e, k) => {
        c.el.style.transform = `translateY(${(-Math.abs(Math.sin(k * Math.PI * 2)) * 10 * (1 - k * 0.5)).toFixed(1)}px)`;
        drawCust(d.slot, clock / 1000);
      }, ease.linear);
      await fade;
      if (!alive()) return;
      const close = removeButton(btn, k_);
      await Promise.all([hop, close]);
      if (!alive()) return;
      // 手を振って帰る
      setMood(d.slot, "leave");
      if (!calm) {
        await tween(Math.round(260 * k_), (e) => { c.el.style.transform = `translateY(${(e * 110).toFixed(1)}%)`; c.el.style.opacity = String(1 - e * 0.9); }, ease.in);
        if (!alive()) return;
      } else {
        await wait(D(40));
        if (!alive()) return;
      }
      slotsView[d.slot] = null;
      setCustomer(d.slot, null, level);
      c.el.style.transform = ""; c.el.style.opacity = "";
    }

    async function arrive(a, rec, slotsView, sp) {
      const alive = () => rec.gen === gen;
      const k_ = sp > 0 ? sp : 1;
      const c = custs[a.slot];
      if (!c || !c.el) return;
      const color = a.color === undefined ? null : a.color;
      slotsView[a.slot] = color;
      setCustomer(a.slot, color, level);
      if (color === null) return;
      snd.play("arrive");
      rec.played.add("arrive");
      setMood(a.slot, "enter");
      if (!calm) {
        await tween(Math.round(350 * k_), (e) => { c.el.style.transform = `translateY(${((1 - e) * 110).toFixed(1)}%)`; c.el.style.opacity = String(Math.min(1, 0.2 + e)); }, ease.back);
        if (!alive()) return;
      } else {
        await wait(D(40));
        if (!alive()) return;
      }
      c.el.style.transform = ""; c.el.style.opacity = "";
      setMood(a.slot, "wait");
      // 待ち瓶が光って「来たよ」と知らせるのは、次の deliver（wake）で行う
    }

    // ---------- 注げない ----------
    function deny(index) {
      const btn = buttons[index];
      if (!btn) return;
      if (calm) {
        btn.classList.add("calm-glow");
        tween(250, () => {}, ease.linear).then(() => btn.classList.remove("calm-glow"));
        return;
      }
      const base = btn.dataset.selected === "1" ? `translateY(${-LIFT}px) ` : "";
      btn.style.transition = "none";
      tween(250, (e, k) => {
        btn.style.transform = base + `translateX(${(Math.sin(k * Math.PI * 5) * 6 * (1 - k)).toFixed(1)}px)`;
      }, ease.linear).then(() => { btn.style.transform = ""; btn.style.transition = ""; });
    }

    // ---------- 面クリア ----------
    function celebrate() {
      if (cur) finishAll();
      const rec = { kind: "celebrate", gen: ++gen, played: new Set(), resolve: null, state: shown };
      const p = new Promise((res) => { rec.resolve = res; });
      cur = rec;
      latestState = null;
      (async () => {
        const alive = () => rec.gen === gen;
        // 最後に届けたお客さんたちが戻ってきて、いっしょに喜ぶ
        for (let i = 0; i < custs.length; i++) {
          const ls = lastServed[i];
          const c = custs[i];
          if (!ls || !c.el) continue;
          c.kind = ls.kind; c.color = ls.color;
          c.el.dataset.color = ""; c.el.style.setProperty("--fur", FUR[ls.kind]);
          if (c.tray) { c.tray.innerHTML = ""; c.tray.style.removeProperty("--c"); }
          setMood(i, "happy");
        }
        if (calm) { await wait(D(40)); return; }
        const sr = rectOf(shop);
        const colors = colorList().map((c) => c.hex);
        for (let i = 0; i < 40; i++) {
          addPart({
            x: sr.left + Math.random() * sr.width, y: sr.top + sr.height * 0.3,
            vx: (Math.random() - 0.5) * 260, vy: -220 - Math.random() * 260, g: 520, drag: 0.97,
            life: 1.1 + Math.random() * 0.4, size: 3 + Math.random() * 3,
            color: colors[i % colors.length], shape: i % 5 === 0 ? "star" : "confetti", rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14
          });
        }
        await tween(900, (e, k) => {
          for (let i = 0; i < custs.length; i++) {
            const c = custs[i];
            if (!lastServed[i] || !c.el) continue;
            c.el.style.transform = `translateY(${(-Math.abs(Math.sin((k + i * 0.15) * Math.PI * 3)) * 12).toFixed(1)}px)`;
            drawCust(i, clock / 1000);
          }
        }, ease.linear);
        if (!alive()) return;
      })().catch((e) => { if (typeof console !== "undefined") console.error("IrobinRender.celebrate:", e); })
        .then(() => {
          if (cur !== rec) return;
          lastServed[0] = lastServed[1] = null;
          finalize(rec);
          for (let i = 0; i < custs.length; i++) { custs[i].sig = ""; if (shown) setCustomer(i, shown.slots ? shown.slots[i] : null, level); }
        });
      return p;
    }

    // ---------- 一瞬で終わらせる ----------
    function finishAll() {
      if (!cur) {
        // 揺れ・ふわっとなどの小さな演出だけ終わらせる（粒と光の輪は残す）
        for (const tw of Array.from(tweens)) { safe(() => tw.fn(1, 1)); tw.res(); }
        tweens.clear();
        resetStyles();
        if (shown) { for (const b of buttons) b._sig = ""; update(shown); }
        return;
      }
      const rec = cur;
      cur = null;
      gen += 1;
      for (const tw of Array.from(tweens)) { safe(() => tw.fn(1, 1)); tw.res(); }
      tweens.clear();
      resetStyles();
      // いちばん気持ちいい瞬間は飛ばさない：まだなら光・粒・音をここで出す
      if (rec.kind === "pour") {
        const o = rec.outcome;
        if (o.sealed !== null && o.sealed !== undefined && !rec.sealShown) { rec.sealShown = true; sealFx(o.sealed, o.color, rec); }
        if (o.sealed !== null && o.sealed !== undefined && !rec.played.has("cork")) { snd.play("cork"); rec.played.add("cork"); }
        if ((o.deliveries || []).length && !rec.played.has("deliver")) snd.play("deliver");
        if ((o.arrivals || []).some((a) => a && a.color !== null && a.color !== undefined) && !rec.played.has("arrive")) snd.play("arrive");
        for (const d of (o.deliveries || [])) {
          const c = custs[d.slot];
          if (c && c.kind) lastServed[d.slot] = { kind: c.kind, color: d.color };
        }
      } else if (rec.kind === "celebrate") {
        lastServed[0] = lastServed[1] = null;
      }
      const st = latestState || rec.state;
      latestState = null;
      for (const b of buttons) b._sig = "";
      for (const c of custs) { c.color = undefined; c.sig = ""; }
      if (st) update(st);
      rec.resolve();
    }

    function pause() {
      if (paused) return;
      paused = true;
      if (raf) { caf_(raf); raf = 0; }
      lastT = 0;
      shop.dataset.paused = "1";
    }
    function resume() {
      if (!paused) return;
      paused = false;
      lastT = 0;
      shop.dataset.paused = "0";
      kick();
    }
    function setCalm(v) {
      calm = !!v;
      shop.dataset.calm = calm ? "1" : "0";
      board.dataset.calm = calm ? "1" : "0";
    }
    setCalm(calm);

    return {
      build, layout, update, pour, deny, celebrate, finishAll, pause, resume, setCalm,
      get busy() { return !!cur; },
      get calm() { return calm; },
      get paused() { return paused; }
    };
  }

  const api = Object.freeze({ ANIMALS, ANIMAL_NAMES, FUR, drawAnimal, markSvg, create });
  root.IrobinRender = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
