/*
 * まとめてポン — 描画と演出（状態は変えない。#board の canvas・#tag・canvas#fx・#banner だけをさわる）
 * 契約：docs/matomete-contract.md §4（画面）
 * 担当B（画面）だけが編集する。
 *
 * UMD: window.MatometeRender と module.exports。
 *
 * MatometeRender.create({ board, canvas, tag, fx, banner }, { calm, sfx }) → {
 *   layout({ availW, availH }) → cell   盤の大きさを決めて描き直す（マス = min(幅/10, 高さ/20)、整数 px）
 *   show(state, { selected, cursor })     いまの局面を描く（selected：選んでいるかたまり [[x,y]...] か null。cursor：{x,y} か null）
 *   remove(outcome, prevState, nextState) → Promise   ふくらむ→ポン（粒・輪・点数）→ストンと落ちる→すっと左へ寄る
 *   deny(x, y)                            1個だけのマス：軽く揺らす（動きを減らす設定では、ふちを一瞬出すだけ）
 *   celebrate() → Promise                 全部消しのお祝い（大きな文字と紙ふぶき）
 *   cheer() → Promise                     のこりが少なく終わったときの小さなお祝い（少しの紙ふぶき。文字・光なし）
 *   delay(ms) → Promise                   演出の時計で待つ（finishAll ですぐ終わる）
 *   finishAll()                           動いている演出を一瞬で終わらせる。ポンの粒と音がまだなら、ここで出す
 *   hideBanner(), setCalm(b), cellAt(clientX, clientY) → {x,y}|null, cellRect(x, y) → {left,top,width,height}
 *   busy（演出中）, calm, cell（マスの大きさ px）, frames（描いたコマの数）, fxDraws（fx を描き直した回数。テスト用）
 * - 演出は requestAnimationFrame の自前の時計で進める（setTimeout は使わない）。何も動いていない間は rAF を回さない。
 * - 選んだふちの明滅は PULSE_MS だけ（そのあとは明るいまま止める）。fx に何も無いときは fx を描かない（消すのも1回だけ）。
 * - 盤の座標は grid[x][y]（x=0 が左、y=0 が下）。画面の上から数える行は ROWS-1-y。
 */
(function (root) {
  "use strict";

  const COLS_D = 10, ROWS_D = 20;
  const MAX_PARTS = 280;          // 粒の上限（iPhone SE でも重くならない数）
  const SWELL_MS = 110;           // ふくらむ時間
  const SHIFT_MS = 170;           // 左へ寄る時間
  const CALM_FADE_MS = 120;       // 動きを減らす設定：消えるまでの時間
  const COL_GLOW_MS = 260;        // 寄った列が光り終わるまで
  const PULSE_MS = 2400;          // 選んだふちが明滅する時間（そのあとは止めて、rAF も止める）

  // logic.js が無いときの予備（契約 §3 と同じ）
  const FALLBACK_COLORS = [
    { id: 0, key: "orange", name: "オレンジ", hex: "#E69F00", mark: "circle" },
    { id: 1, key: "sky", name: "みずいろ", hex: "#56B4E9", mark: "triangle" },
    { id: 2, key: "green", name: "みどり", hex: "#009E73", mark: "square" },
    { id: 3, key: "yellow", name: "きいろ", hex: "#F0E442", mark: "diamond" },
    { id: 4, key: "pink", name: "ピンク", hex: "#CC79A7", mark: "heart" }
  ];
  const MARK_ALIAS = { "●": "circle", "▲": "triangle", "■": "square", "◆": "diamond", "♥": "heart" };
  function logic() { return root.MatometeLogic || null; }
  function dims() {
    const L = logic();
    return { cols: L && L.COLS > 0 ? L.COLS : COLS_D, rows: L && L.ROWS > 0 ? L.ROWS : ROWS_D };
  }
  function colorInfo(id) {
    const L = logic();
    const list = L && Array.isArray(L.COLORS) && L.COLORS.length ? L.COLORS : FALLBACK_COLORS;
    return list[id] || { id, key: "unknown", name: "？", hex: "#888888", mark: "circle" };
  }

  function rgbOf(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    const n = m ? parseInt(m[1], 16) : 0x888888;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function luminance(hex) {
    const ch = rgbOf(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function inkFor(hex) { return luminance(hex) > 0.2 ? "rgba(20, 24, 38, 0.72)" : "rgba(255, 255, 255, 0.92)"; }
  function mix(hex, to, k) {
    const a = rgbOf(hex), b = rgbOf(to);
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(",")})`;
  }

  // 記号（viewBox 0 0 24 24）。文字のフォントに頼らず図形で描く
  const MARK_PATHS = {
    triangle: "M12 3.5 21 19.5H3z",
    square: "M5 6.5Q5 5 6.5 5h11Q19 5 19 6.5v11q0 1.5-1.5 1.5h-11Q5 19 5 17.5z",
    diamond: "M12 2.5 21.5 12 12 21.5 2.5 12z",
    heart: "M12 21s-8.5-5.1-8.5-11.2C3.5 6.7 5.8 4.6 8.4 4.6c1.6 0 2.9.8 3.6 2.1.7-1.3 2-2.1 3.6-2.1 2.6 0 4.9 2.1 4.9 5.2C20.5 15.9 12 21 12 21z"
  };
  function markPath(ctx, mark, size, ox, oy) {
    const k = size / 24;
    const m = MARK_ALIAS[mark] || mark;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(k, k);
    if (m === "circle" || !MARK_PATHS[m] || typeof Path2D === "undefined") {
      ctx.beginPath(); ctx.arc(12, 12, 7.2, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fill(new Path2D(MARK_PATHS[m]));
    }
    ctx.restore();
  }
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr); ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr); ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  const easeIn = (p) => p * p;
  const easeOut = (p) => 1 - (1 - p) * (1 - p) * (1 - p);
  const clamp01 = (p) => (p < 0 ? 0 : p > 1 ? 1 : p);

  // els = { board, canvas, tag, fx, banner }
  function create(els, opts) {
    const o = opts || {};
    const board = els.board, canvas = els.canvas, tagEl = els.tag, fx = els.fx, banner = els.banner;
    const ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
    const fctx = fx && fx.getContext ? fx.getContext("2d") : null;
    const sfx = o.sfx || null;
    const snd = (name, arg) => { if (!sfx) return; try { sfx.play(name, arg); } catch (e) { /* 音が出なくても続ける */ } };
    const buzz = (p) => { if (!sfx || typeof sfx.buzz !== "function") return; try { sfx.buzz(p); } catch (e) { /* 無視 */ } };
    const nowMs = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());

    let calm = !!o.calm;
    let cell = 20;
    let dpr = 1;
    let view = { state: null, selected: null, selKeys: null, cursor: null, selSig: "" };
    let anim = null;              // 消す演出（1つだけ）
    let waits = [];               // delay / celebrate の待ち { until, resolve }
    let parts = [], rings = [], popups = [], flash = null, shake = null, denyFx = null;
    let celebrateT = null;
    let colGlow = null;           // 左へ寄った列の光 { cols:Set, t0 }（演出が終わったあと、少しだけ残る）
    let selAt = 0;                // 選んだ時刻（明滅を PULSE_MS で止める）
    let fxClean = true;           // fx がもう空に消してあるか（空のときは何度も消さない）
    let frames = 0, fxDraws = 0;
    let raf = 0, lastTs = 0;
    let sprites = {};             // 色ごとのマスの絵（マスの大きさが変わったら作り直す）

    const key = (x, y) => x * 100 + y;

    // ---------- 大きさ ----------
    function layout(av) {
      const { cols, rows } = dims();
      const w = Math.max(0, Number(av && av.availW) || 0);
      const h = Math.max(0, Number(av && av.availH) || 0);
      const c = Math.max(6, Math.floor(Math.min(w / cols, h / rows)));
      dpr = Math.min(3, Math.max(1, root.devicePixelRatio || 1));
      if (c !== cell || !canvas.width) sprites = {};
      cell = c;
      board.style.width = cell * cols + "px";
      board.style.height = cell * rows + "px";
      board.style.setProperty("--cell", cell + "px");
      canvas.width = Math.round(cell * cols * dpr);
      canvas.height = Math.round(cell * rows * dpr);
      sprites = {};
      sizeFx();
      placeTag();
      kick();
      return cell;
    }
    function sizeFx() {
      if (!fx) return;
      const w = root.innerWidth || 0, h = root.innerHeight || 0;
      const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
      if (fx.width !== W) { fx.width = W; fxClean = true; }
      if (fx.height !== H) { fx.height = H; fxClean = true; }
    }

    // マス1つの絵（色・明るい上ふち・記号）を前もって作る
    function sprite(color) {
      if (sprites[color]) return sprites[color];
      const info = colorInfo(color);
      const s = Math.max(1, Math.round(cell * dpr));
      const c = root.document.createElement("canvas");
      c.width = s; c.height = s;
      const g = c.getContext("2d");
      const gap = Math.max(1, s * 0.06);
      const r = s * 0.24;
      roundRect(g, gap, gap, s - gap * 2, s - gap * 2, r);
      const grad = g.createLinearGradient(0, gap, 0, s - gap);
      grad.addColorStop(0, mix(info.hex, "#ffffff", 0.22));
      grad.addColorStop(0.55, info.hex);
      grad.addColorStop(1, mix(info.hex, "#000000", 0.18));
      g.fillStyle = grad;
      g.fill();
      // 上の光
      g.save();
      g.clip();
      g.fillStyle = "rgba(255,255,255,0.22)";
      g.beginPath(); g.ellipse(s * 0.38, s * 0.2, s * 0.32, s * 0.12, -0.2, 0, Math.PI * 2); g.fill();
      g.restore();
      // 記号
      g.fillStyle = inkFor(info.hex);
      const ms = s * 0.5;
      markPath(g, info.mark, ms, (s - ms) / 2, (s - ms) / 2);
      sprites[color] = c;
      return c;
    }

    // ---------- 座標 ----------
    function rect() { return board.getBoundingClientRect(); }
    function cellAt(cx, cy) {
      const { cols, rows } = dims();
      const r = rect();
      const px = cx - r.left, py = cy - r.top;
      if (!(px >= 0 && py >= 0 && px < cell * cols && py < cell * rows)) return null;
      const x = Math.floor(px / cell), row = Math.floor(py / cell);
      return { x: Math.min(cols - 1, x), y: rows - 1 - Math.min(rows - 1, row) };
    }
    function cellRect(x, y) {
      const { rows } = dims();
      const r = rect();
      return { left: r.left + x * cell, top: r.top + (rows - 1 - y) * cell, width: cell, height: cell };
    }

    // ---------- 札「n こ ＋p てん」 ----------
    function placeTag() {
      if (!tagEl) return;
      const sel = view.selected;
      if (!sel || !sel.length || anim) { tagEl.hidden = true; return; }
      const { cols, rows } = dims();
      let minX = cols, maxX = -1, maxY = -1, minY = rows;
      for (const [x, y] of sel) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (y < minY) minY = y; }
      tagEl.hidden = false;
      const tw = tagEl.offsetWidth || 80, th = tagEl.offsetHeight || 26;
      const bw = cell * cols, bh = cell * rows;
      const cxp = ((minX + maxX + 1) / 2) * cell;
      let left = cxp - tw / 2;
      if (tw >= bw) left = (bw - tw) / 2;
      else left = Math.max(0, Math.min(bw - tw, left));
      const topEdge = (rows - 1 - maxY) * cell;
      const bottomEdge = (rows - minY) * cell;
      let top = topEdge - th - 6;
      let below = false;
      if (top < 0) {
        if (bottomEdge + th + 6 <= bh) { top = bottomEdge + 6; below = true; }
        else top = Math.max(0, topEdge + 4);
      }
      tagEl.style.left = Math.round(left) + "px";
      tagEl.style.top = Math.round(top) + "px";
      tagEl.dataset.below = below ? "1" : "0";
      // 矢印は、かたまりの真ん中を指す
      tagEl.style.setProperty("--arrow", Math.round(Math.max(10, Math.min(tw - 10, cxp - left))) + "px");
    }

    // ---------- いまの局面 ----------
    function show(state, opt) {
      const op = opt || {};
      view.state = state || null;
      view.selected = Array.isArray(op.selected) && op.selected.length ? op.selected.map((c) => [c[0], c[1]]) : null;
      view.selKeys = view.selected ? new Set(view.selected.map((c) => key(c[0], c[1]))) : null;
      const sig = view.selected ? view.selected.map((c) => key(c[0], c[1])).join(",") : "";
      if (sig !== view.selSig) { view.selSig = sig; selAt = nowMs(); }
      view.cursor = op.cursor && Number.isInteger(op.cursor.x) ? { x: op.cursor.x, y: op.cursor.y } : null;
      if (view.selected) {
        board.dataset.selected = String(view.selected.length);
        if (op.tagText !== undefined && tagEl) tagEl.textContent = op.tagText;
      } else {
        delete board.dataset.selected;
      }
      placeTag();
      kick();
    }

    // ---------- 描く ----------
    function drawCell(color, gx, gy, scale, alpha, white) {
      const { rows } = dims();
      const s = cell * dpr;
      const img = sprite(color);
      const cx = (gx + 0.5) * s, cy = (rows - 1 - gy + 0.5) * s;
      const w = s * scale;
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, cx - w / 2, cy - w / 2, w, w);
      if (white > 0) {
        ctx.globalAlpha = alpha * white;
        ctx.fillStyle = "#ffffff";
        const gap = Math.max(1, s * 0.06) * scale;
        roundRect(ctx, cx - w / 2 + gap, cy - w / 2 + gap, w - gap * 2, w - gap * 2, w * 0.24);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    function drawBack() {
      const { cols, rows } = dims();
      const s = cell * dpr;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // 列の薄いしま（どこが空いたか分かるように）
      ctx.fillStyle = "rgba(255,255,255,0.025)";
      for (let x = 1; x < cols; x += 2) ctx.fillRect(x * s, 0, s, rows * s);
    }
    function outline(cells, alpha, color) {
      const { rows } = dims();
      const s = cell * dpr;
      const set = new Set(cells.map((c) => key(c[0], c[1])));
      ctx.save();
      ctx.lineCap = "round";
      ctx.beginPath();
      for (const [x, y] of cells) {
        const l = x * s, t = (rows - 1 - y) * s, r = l + s, b = t + s;
        if (!set.has(key(x - 1, y))) { ctx.moveTo(l, t); ctx.lineTo(l, b); }
        if (!set.has(key(x + 1, y))) { ctx.moveTo(r, t); ctx.lineTo(r, b); }
        if (!set.has(key(x, y + 1))) { ctx.moveTo(l, t); ctx.lineTo(r, t); }
        if (!set.has(key(x, y - 1))) { ctx.moveTo(l, b); ctx.lineTo(r, b); }
      }
      // 下に濃い影の線、上に白い線（どの色の上でも、ふちがはっきり見える）
      const w = Math.max(2 * dpr, s * 0.12);
      ctx.globalAlpha = Math.min(1, alpha + 0.2) * 0.7;
      ctx.strokeStyle = "#0d111d";
      ctx.lineWidth = w + 2.5 * dpr;
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color || "#ffffff";
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.restore();
    }
    function drawStatic(t) {
      const st = view.state;
      if (!st || !st.grid) return;
      const { cols, rows } = dims();
      const sel = view.selKeys;
      let shakeX = 0;
      for (let x = 0; x < cols; x++) {
        const col = st.grid[x];
        if (!col) continue;
        for (let y = 0; y < rows; y++) {
          const v = col[y];
          if (v === null || v === undefined) continue;
          let gx = x;
          if (denyFx && !calm && denyFx.x === x && denyFx.y === y) {
            const k = clamp01((t - denyFx.t0) / 280);
            shakeX = Math.sin(k * Math.PI * 6) * 0.14 * (1 - k);
            gx = x + shakeX;
          }
          if (sel) {
            const on = sel.has(key(x, y));
            drawCell(v, gx, y, 1, on ? 1 : 0.42, on ? 0.18 : 0);
          } else {
            drawCell(v, gx, y, 1, 1, colGlow && colGlow.cols.has(x) ? 0.35 * (1 - clamp01((t - colGlow.t0) / COL_GLOW_MS)) : 0);
          }
        }
      }
      if (view.selected) {
        // ふち：動きを減らす設定では明るさを変えない（太い白いふちだけで分かる）
        const pulse = calm || t - selAt >= PULSE_MS ? 1 : 0.82 + 0.18 * Math.sin(t / 150);
        outline(view.selected, pulse, "#ffffff");
      }
      if (denyFx) {
        const k = clamp01((t - denyFx.t0) / 280);
        if (calm) outline([[denyFx.x, denyFx.y]], 1 - k, "#ff9a7a");
      }
      if (view.cursor) {
        const s = cell * dpr;
        const c = view.cursor;
        ctx.save();
        ctx.strokeStyle = "#f0a43a";
        ctx.lineWidth = Math.max(2 * dpr, s * 0.1);
        roundRect(ctx, c.x * s + ctx.lineWidth / 2, (rows - 1 - c.y) * s + ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth, s * 0.2);
        ctx.stroke();
        ctx.restore();
      }
    }
    function drawAnim(t) {
      const a = anim;
      const el = t - a.t0;
      if (a.calm) {
        // 動きを減らす設定：消えるマスは薄くなるだけ。ほかは動かない（すぐ新しい局面になる）
        const k = clamp01(el / CALM_FADE_MS);
        const g = a.prev.grid;
        const { cols, rows } = dims();
        for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
          const v = g[x] && g[x][y];
          if (v === null || v === undefined) continue;
          if (a.removed.has(key(x, y))) drawCell(v, x, y, 1, 1 - k, 0.4 * (1 - k));
          else drawCell(v, x, y, 1, 1, 0);
        }
        return;
      }
      if (el < a.popAt) {
        // ふくらむ（ほかのマスはそのまま）
        const p = easeOut(clamp01(el / a.popAt));
        for (const m of a.movers) drawCell(m.c, m.fx, m.fy, 1, 1, 0);
        for (const [x, y, c] of a.removedCells) drawCell(c, x, y, 1 + 0.2 * p, 1, 0.55 * p);
        return;
      }
      const fe = a.popAt + a.fallMs;
      for (const m of a.movers) {
        let gx = m.fx, gy = m.fy;
        if (el < fe) {
          const p = easeIn(clamp01((el - a.popAt) / Math.max(1, a.fallMs)));
          gy = m.fy + (m.my - m.fy) * p;
        } else {
          gy = m.my;
          const p = easeOut(clamp01((el - fe) / Math.max(1, a.shiftMs)));
          gx = m.fx + (m.tx - m.fx) * p;
        }
        // 着地のつぶれ（落ちたマスだけ、少しだけ）
        let sc = 1;
        if (m.fy !== m.my && el >= fe && el < fe + 90) sc = 1 - 0.06 * Math.sin(((el - fe) / 90) * Math.PI);
        // 左へ寄る列は、寄っている間ほんのり光る（どの列が動いたか分かるように）
        const glow = m.tx !== m.fx && el >= fe ? 0.35 * clamp01((el - fe) / Math.max(1, a.shiftMs)) : 0;
        drawCell(m.c, gx, gy, sc, 1, glow);
      }
    }
    function drawBoard(t) {
      if (!ctx) return;
      drawBack();
      ctx.save();
      if (shake && !calm) {
        const k = clamp01((t - shake.t0) / shake.ms);
        if (k < 1) {
          const amp = shake.amp * (1 - k) * dpr;
          ctx.translate(Math.sin(t / 17) * amp, Math.cos(t / 23) * amp * 0.6);
        }
      }
      if (anim) drawAnim(t); else drawStatic(t);
      ctx.restore();
    }

    // ---------- fx（粒・輪・点数・光） ----------
    function spawnPop(a) {
      const r = rect();
      const n = a.removedCells.length;
      const per = n >= 20 ? 6 : n >= 10 ? 7 : n >= 5 ? 8 : 9;
      const budget = Math.max(0, MAX_PARTS - parts.length);
      const total = Math.min(budget, per * n);
      const speed = cell * (n >= 10 ? 9 : 7);
      let sx = 0, sy = 0;
      a.removedCells.forEach(([x, y, c], i) => {
        const cr = cellRect(x, y);
        const cx = cr.left + cell / 2, cy = cr.top + cell / 2;
        sx += cx; sy += cy;
        const hex = colorInfo(c).hex;
        const k = Math.floor(total / n) + (i < total % n ? 1 : 0);
        for (let j = 0; j < k; j++) {
          const ang = Math.random() * Math.PI * 2;
          const sp = speed * (0.35 + Math.random() * 0.75);
          parts.push({
            x: cx + (Math.random() - 0.5) * cell * 0.4, y: cy + (Math.random() - 0.5) * cell * 0.4,
            vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - cell * 3,
            g: cell * 26, size: cell * (0.12 + Math.random() * 0.14), rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
            color: j % 5 === 4 ? "#ffffff" : hex, life: 0.45 + Math.random() * 0.4, age: 0, sq: j % 2 === 0
          });
        }
        // マスごとの小さな輪
        if (rings.length < 60) rings.push({ x: cx, y: cy, r0: cell * 0.3, r1: cell * 0.85, age: 0, life: 0.28, color: hex, w: Math.max(1.5, cell * 0.08) });
      });
      const mx = sx / n, my = sy / n;
      if (n >= 10) rings.push({ x: mx, y: my, r0: cell, r1: cell * (4 + Math.min(6, n / 8)), age: 0, life: 0.5, color: "#ffffff", w: Math.max(2, cell * 0.16) });
      if (n >= 10) flash = { age: 0, life: n >= 20 ? 0.34 : 0.26, alpha: n >= 20 ? 0.26 : 0.16 };
      if (n >= 15) shake = { t0: nowMs(), ms: 220, amp: Math.min(5, 2 + n / 15) };
      if (a.points > 0) {
        const size = Math.round(Math.max(16, Math.min(46, 15 + Math.sqrt(a.points) * 2.2)));
        popups.push({ x: mx, y: my, text: "+" + a.points, size, age: 0, life: 0.9, rise: cell * 2.2 });
      }
    }
    function spawnCalmPopup(a) {
      if (a.points <= 0) return;
      let sx = 0, sy = 0;
      for (const [x, y] of a.removedCells) { const cr = cellRect(x, y); sx += cr.left + cell / 2; sy += cr.top + cell / 2; }
      const n = a.removedCells.length;
      popups.push({ x: sx / n, y: sy / n, text: "+" + a.points, size: Math.round(Math.max(16, Math.min(40, 15 + Math.sqrt(a.points) * 2))), age: 0, life: 0.8, rise: 0 });
    }
    function spawnConfetti(count, fromBoard) {
      const r = rect();
      const W = root.innerWidth || r.width;
      const cols = ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#CC79A7", "#ffffff"];
      const budget = Math.max(0, MAX_PARTS - parts.length);
      const total = Math.min(budget, count || 160);
      // fromBoard：盤の左右の下から（小さなお祝い）。ふだんは画面の左右から
      const lx = fromBoard ? r.left : W * 0.08, rx = fromBoard ? r.right : W * 0.92;
      for (let i = 0; i < total; i++) {
        const fromLeft = i % 2 === 0;
        const ang = fromLeft ? -Math.PI / 3 - Math.random() * 0.5 : -Math.PI * 2 / 3 + Math.random() * 0.5;
        const sp = (fromBoard ? 0.6 : 1) * (380 + Math.random() * 420);
        parts.push({
          x: fromLeft ? lx : rx, y: r.top + r.height * 0.75,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 520, size: 4 + Math.random() * 5,
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 16, color: cols[i % cols.length], life: 1.4 + Math.random() * 0.8, age: 0, sq: true
        });
      }
    }
    function stepFx(dt) {
      for (const p of parts) {
        p.age += dt;
        p.vx *= Math.pow(0.35, dt);
        p.vy += p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      }
      parts = parts.filter((p) => p.age < p.life);
      for (const g of rings) g.age += dt;
      rings = rings.filter((g) => g.age < g.life);
      for (const u of popups) u.age += dt;
      popups = popups.filter((u) => u.age < u.life);
      if (flash) { flash.age += dt; if (flash.age >= flash.life) flash = null; }
    }
    function drawFx() {
      if (!fctx) return;
      const any = parts.length || rings.length || popups.length || flash;
      if (!any && fxClean) return;   // 何も無く、もう消してある：全画面の canvas にさわらない
      fxDraws++;
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.clearRect(0, 0, fx.width, fx.height);
      fxClean = !any;
      if (!any) return;
      fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (flash) {
        fctx.globalAlpha = flash.alpha * (1 - flash.age / flash.life);
        fctx.fillStyle = "#fff6dc";
        fctx.fillRect(0, 0, fx.width / dpr, fx.height / dpr);
      }
      for (const g of rings) {
        const k = g.age / g.life;
        fctx.globalAlpha = (1 - k) * 0.9;
        fctx.strokeStyle = g.color;
        fctx.lineWidth = g.w * (1 - k * 0.6);
        fctx.beginPath(); fctx.arc(g.x, g.y, g.r0 + (g.r1 - g.r0) * easeOut(k), 0, Math.PI * 2); fctx.stroke();
      }
      for (const p of parts) {
        const k = p.age / p.life;
        fctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
        fctx.fillStyle = p.color;
        const s = p.size * (1 - k * 0.3);
        if (p.sq) {
          fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot); fctx.fillRect(-s / 2, -s / 2, s, s); fctx.restore();
        } else {
          fctx.beginPath(); fctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2); fctx.fill();
        }
      }
      for (const u of popups) {
        const k = u.age / u.life;
        const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : k < 0.25 ? 1.1 - ((k - 0.15) / 0.1) * 0.1 : 1;
        fctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        fctx.font = `800 ${Math.round(u.size * (calm ? 1 : pop))}px "Hiragino Maru Gothic ProN", "Hiragino Sans", system-ui, sans-serif`;
        fctx.textAlign = "center";
        fctx.textBaseline = "middle";
        const y = u.y - u.rise * easeOut(k);
        fctx.lineWidth = Math.max(3, u.size * 0.16);
        fctx.strokeStyle = "rgba(13, 17, 29, 0.9)";
        fctx.lineJoin = "round";
        fctx.strokeText(u.text, u.x, y);
        fctx.fillStyle = "#ffe08a";
        fctx.fillText(u.text, u.x, y);
      }
      fctx.globalAlpha = 1;
    }

    // ---------- 時計 ----------
    function needFrames(t) {
      if (anim || waits.length || parts.length || rings.length || popups.length || flash) return true;
      if (view.selected && !calm && t - selAt < PULSE_MS + 50) return true;   // 選んだふちの明滅（少しのあいだだけ）
      if (denyFx && t - denyFx.t0 < 300) return true;
      if (shake && t - shake.t0 < shake.ms) return true;
      if (colGlow && t - colGlow.t0 < COL_GLOW_MS) return true;
      return false;
    }
    function kick() {
      if (raf || !root.requestAnimationFrame) { if (!root.requestAnimationFrame) frame(nowMs()); return; }
      raf = root.requestAnimationFrame(frame);
    }
    function frame() {
      raf = 0;
      frames++;
      const t = nowMs();
      const dt = Math.min(0.05, Math.max(0, (t - (lastTs || t)) / 1000));
      lastTs = t;
      if (anim) stepAnim(t);
      if (waits.length) {
        const done = waits.filter((w) => t >= w.until);
        waits = waits.filter((w) => t < w.until);
        done.forEach((w) => w.resolve());
      }
      stepFx(dt);
      if (denyFx && t - denyFx.t0 >= 300) denyFx = null;
      if (shake && t - shake.t0 >= shake.ms) shake = null;
      if (colGlow && t - colGlow.t0 >= COL_GLOW_MS) colGlow = null;
      drawBoard(t);
      drawFx();
      if (needFrames(t)) raf = root.requestAnimationFrame ? root.requestAnimationFrame(frame) : 0;
      else lastTs = 0;
    }
    function stepAnim(t) {
      const a = anim;
      const el = t - a.t0;
      if (!a.popped && el >= (a.calm ? 0 : a.popAt)) doPop(a);
      if (!a.landed && !a.calm && a.hasFalls && el >= a.popAt + a.fallMs) { a.landed = true; snd("fall"); }
      if (el >= a.end) endAnim();
    }
    function doPop(a) {
      a.popped = true;
      snd("pop", a.removedCells.length);
      buzz(a.removedCells.length >= 10 ? [18, 40, 24] : 10);
      if (a.calm) spawnCalmPopup(a); else spawnPop(a);
    }
    function endAnim() {
      const a = anim;
      if (!a) return;
      if (!a.popped) doPop(a);
      if (!a.landed && a.hasFalls && !a.calm) { a.landed = true; snd("fall"); }
      anim = null;
      const moved = new Set(a.movers.filter((m) => m.tx !== m.fx).map((m) => m.tx));
      colGlow = moved.size && !a.calm ? { cols: moved, t0: nowMs() } : null;
      view.state = a.next;
      view.selected = null; view.selKeys = null;
      delete board.dataset.selected;
      placeTag();
      a.resolve();
    }

    // ---------- 消す ----------
    function remove(outcome, prev, next) {
      return new Promise((resolve) => {
        if (anim) endAnim();
        const { cols, rows } = dims();
        const cells = outcome && Array.isArray(outcome.cells) ? outcome.cells : [];
        const removed = new Set(cells.map((c) => key(c[0], c[1])));
        const removedCells = cells.map((c) => [c[0], c[1], prev.grid[c[0]][c[1]]]);
        // 残ったマスの行き先：列の中で下へ詰める → 空の列を左へ詰める（logic の falls / shifts と同じ規則）
        const movers = [];
        let maxFall = 0;
        let nx = 0;
        const shiftMap = {};
        for (let x = 0; x < cols; x++) {
          const col = prev.grid[x] || [];
          let w = 0;
          const list = [];
          for (let y = 0; y < rows; y++) {
            const v = col[y];
            if (v === null || v === undefined || removed.has(key(x, y))) continue;
            list.push({ c: v, fx: x, fy: y, my: w });
            if (y - w > maxFall) maxFall = y - w;
            w++;
          }
          if (list.length) { shiftMap[x] = nx; list.forEach((m) => { m.tx = nx; movers.push(m); }); nx++; }
        }
        // logic の結果と食い違うときは、動かさずに新しい局面へ（見た目と判定を食い違わせない）
        let ok = true;
        for (const m of movers) { const v = next.grid[m.tx] && next.grid[m.tx][m.my]; if (v !== m.c) { ok = false; break; } }
        const hasShift = movers.some((m) => m.tx !== m.fx);
        const fallMs = maxFall > 0 ? Math.round(Math.min(260, 120 + 26 * Math.sqrt(maxFall))) : 0;
        const shiftMs = hasShift ? SHIFT_MS : 0;
        const a = {
          t0: nowMs(), calm, prev, next, removed, removedCells, movers, points: outcome.points || 0,
          popAt: calm ? 0 : SWELL_MS, fallMs, shiftMs, hasFalls: maxFall > 0,
          popped: false, landed: false, resolve
        };
        a.end = calm || !ok ? CALM_FADE_MS : SWELL_MS + fallMs + shiftMs;
        if (!ok) a.calm = true;
        anim = a;
        view.selected = null; view.selKeys = null;
        placeTag();
        kick();
      });
    }

    function deny(x, y) {
      denyFx = { x, y, t0: nowMs() };
      kick();
    }

    function delay(ms) {
      return new Promise((resolve) => { waits.push({ until: nowMs() + Math.max(0, ms), resolve }); kick(); });
    }

    function celebrate() {
      snd("allclear");
      buzz([30, 60, 30, 60, 60]);
      if (banner) {
        banner.hidden = false;
        banner.dataset.calm = calm ? "1" : "0";
        banner.classList.remove("go");
        void banner.offsetWidth;   // 出し直すたびにアニメーションを最初から
        banner.classList.add("go");
      }
      if (!calm) { spawnConfetti(); flash = { age: 0, life: 0.5, alpha: 0.3 }; }
      celebrateT = nowMs();
      return delay(calm ? 1100 : 1500);
    }
    // のこりが少なく終わった：小さなお祝い（盤の左右から少しの紙ふぶき。大きな文字・画面の光はなし）
    function cheer() {
      snd("best");
      buzz([20, 40, 20]);
      if (!calm) spawnConfetti(48, true);
      return delay(calm ? 600 : 900);
    }
    function hideBanner() {
      if (banner) { banner.hidden = true; banner.classList.remove("go"); }
    }

    function finishAll() {
      if (anim) endAnim();
      if (waits.length) { const w = waits; waits = []; w.forEach((x) => x.resolve()); }
      denyFx = null; shake = null; colGlow = null;
      kick();
    }

    function setCalm(b) {
      calm = !!b;
      kick();
    }

    return {
      layout, show, remove, deny, celebrate, cheer, delay, finishAll, hideBanner, setCalm, cellAt, cellRect, placeTag,
      get busy() { return !!anim || waits.length > 0; },
      get calm() { return calm; },
      get cell() { return cell; },
      get fxCount() { return parts.length + rings.length + popups.length; },
      get frames() { return frames; },
      get fxDraws() { return fxDraws; },
      get celebratedAt() { return celebrateT; }
    };
  }

  const api = Object.freeze({ create });
  root.MatometeRender = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
