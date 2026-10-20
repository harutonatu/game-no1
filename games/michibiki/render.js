/*
 * ミチビキ空港 — canvas の描画と演出
 * 契約：docs/michibiki-contract.md §7（描画と演出の API）
 * 担当B（画面）だけが編集する。
 *
 * MichibikiRender.create(canvas, { calm }) → {
 *   resize(), setField(w, h), toField(cx, cy), toScreen(x, y), draw(state, ui), play(events),
 *   setCalm(bool), pause(), resume(), finishAll(), tutor(points),
 *   scale, frames, lastDrawMs, drawLog, busy, calm
 * }
 * - 場の座標（場の単位）を、倍率 scale で canvas に描く。canvas は場と同じ縦横比で、.play の中に収まる最大の大きさ（上限 2.0）
 * - 演出（着陸の光・+1・はじける・波紋・開く・矢印が光る）は実時間（performance.now）で進む。ロジックは待たない
 * - 角度（Math.atan2）を使うのは描画だけ（ロジックでは使わない。§1.2）
 */
(function (root) {
  "use strict";

  const L = root.MichibikiLogic || {};
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const K = {
    STEP: num(L.STEP, 1 / 60), PLANE_R: num(L.PLANE_R, 12), ZONE_R: num(L.ZONE_R, 22), APPROACH_D: num(L.APPROACH_D, 48),
    RUNWAY_LEN: num(L.RUNWAY_LEN, 96), RUNWAY_W: num(L.RUNWAY_W, 22), WARN_S: num(L.WARN_S, 2), LAND_S: num(L.LAND_S, 1.2)
  };
  const MAX_SCALE = 2.0;
  const FIELD_BG = "#223a37";
  const FIELD_EDGE = "#2f504b";
  const GRAY = "#7d8a94";
  const MARKS = ["circle", "triangle", "square"];
  const FALLBACK_HEX = ["#D55E00", "#0072B2", "#F0E442"];

  function colorHex(id) {
    const c = Array.isArray(L.COLORS) ? L.COLORS[id] : null;
    return c && typeof c.hex === "string" ? c.hex : FALLBACK_HEX[id] || GRAY;
  }
  function markOf(id) {
    const c = Array.isArray(L.COLORS) ? L.COLORS[id] : null;
    const m = c ? String(c.mark || "") : "";
    if (m === "○" || /circle/i.test(m)) return "circle";
    if (m === "△" || /tri/i.test(m)) return "triangle";
    if (m === "□" || /square/i.test(m)) return "square";
    return MARKS[id] || "circle";
  }
  const isLight = (id) => id === 2;   // きいろは白い印が見えにくいので、濃い印にする

  function create(canvas, opts) {
    const o = opts || {};
    const ctx = canvas.getContext("2d");
    let calm = !!o.calm;
    let fw = 320, fh = 520;
    let scale = 1, dpr = 1, cssW = 320, cssH = 520;
    let frames = 0, lastDrawMs = 0;
    let drawLog = { marks: [], arrows: [] };
    let effects = [];
    let pausedAt = null, pausedTotal = 0;
    let bgCache = null, bgKey = "";
    const clock = () => (pausedAt !== null ? pausedAt : performance.now()) - pausedTotal;

    // ===== 大きさ =====
    function resize() {
      dpr = Math.min(2, Math.max(1, root.devicePixelRatio || 1));
      const parent = canvas.parentElement;
      const aw = parent ? parent.clientWidth : fw;
      const ah = parent ? parent.clientHeight : fh;
      let s = Math.min(aw / fw, ah / fh, MAX_SCALE);
      if (!Number.isFinite(s) || s <= 0) s = 0.1;
      cssW = Math.max(1, Math.floor(fw * s));
      cssH = Math.max(1, Math.floor(fh * s));
      scale = Math.min(cssW / fw, cssH / fh);
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      const bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      bgCache = null;
      return scale;
    }
    function setField(w, h) {
      if (!(w > 0 && h > 0)) return;
      if (w === fw && h === fh) return;
      fw = w; fh = h;
      resize();
    }
    function toField(cx, cy) {
      const r = canvas.getBoundingClientRect();
      const s = r.width > 0 ? r.width / fw : scale;
      return [(cx - r.left) / s, (cy - r.top) / s];
    }
    function toScreen(x, y) {
      const r = canvas.getBoundingClientRect();
      const s = r.width > 0 ? r.width / fw : scale;
      return [r.left + x * s, r.top + y * s];
    }

    // ===== 形 =====
    function markPath(kind, x, y, r) {
      ctx.beginPath();
      if (kind === "triangle") {
        ctx.moveTo(x, y - r * 1.05);
        ctx.lineTo(x + r * 0.95, y + r * 0.7);
        ctx.lineTo(x - r * 0.95, y + r * 0.7);
        ctx.closePath();
      } else if (kind === "square") {
        ctx.rect(x - r * 0.78, y - r * 0.78, r * 1.56, r * 1.56);
      } else {
        ctx.arc(x, y, r * 0.82, 0, Math.PI * 2);
      }
    }
    // 印（○△□）を白抜き（線）で描く
    function drawMark(kind, x, y, r, color, lw) {
      markPath(kind, x, y, r);
      ctx.lineWidth = lw;
      ctx.strokeStyle = color;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    // 色の丸の中に印（滑走路の横・予告）
    function badge(colorId, x, y, r, open, logKind) {
      const hex = open ? colorHex(colorId) : GRAY;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = hex;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(10,16,22,0.85)";
      ctx.stroke();
      drawMark(markOf(colorId), x, y, r * 0.55, open && isLight(colorId) ? "#3a3200" : "#ffffff", Math.max(1.6, r * 0.2));
      if (logKind) drawLog.marks.push({ kind: logKind, color: colorId, x, y });
    }

    // ===== 背景（変わらないので、倍率ごとに1回だけ作る） =====
    function background() {
      const key = fw + "x" + fh + "@" + canvas.width;
      if (bgCache && bgKey === key) return bgCache;
      const c = document.createElement("canvas");
      c.width = canvas.width; c.height = canvas.height;
      const g = c.getContext("2d");
      g.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      g.fillStyle = FIELD_BG;
      g.fillRect(0, 0, fw, fh);
      g.fillStyle = "rgba(255,255,255,0.05)";
      for (let x = 20; x < fw; x += 40) for (let y = 20; y < fh; y += 40) g.fillRect(x - 1, y - 1, 2, 2);
      g.strokeStyle = FIELD_EDGE;
      g.lineWidth = 3;
      g.strokeRect(1.5, 1.5, fw - 3, fh - 3);
      bgCache = c; bgKey = key;
      return c;
    }

    // ===== 滑走路 =====
    function runwayList(state) {
      if (typeof L.runwaysFor === "function") {
        try { const r = L.runwaysFor(state); if (Array.isArray(r)) return r; } catch (e) { /* 下へ */ }
      }
      return [];
    }
    function fxOf(type, pred) {
      const t = clock();
      let best = null;
      for (const f of effects) if (f.type === type && (!pred || pred(f))) { const p = (t - f.t0) / f.dur; if (p >= 0 && p < 1 && (!best || p < best.p)) best = { f, p }; }
      return best;
    }
    function drawRunway(r) {
      const { ex, ey, dx, dy, color } = r;
      const open = !!r.open;
      const ang = Math.atan2(dy, dx);
      const W = K.RUNWAY_W, LEN = K.RUNWAY_LEN, A = K.APPROACH_D, Z = K.ZONE_R;
      const opening = open ? fxOf("open", (f) => f.color === color) : null;
      const landing = fxOf("land", (f) => f.color === color);
      const wrong = open ? fxOf("wrongway", (f) => f.color === color) : null;
      const hex = open ? colorHex(color) : GRAY;

      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(ang);
      // 案内の帯（入り口から遠いほど薄い）
      if (open) {
        const gr = ctx.createLinearGradient(0, 0, -A, 0);
        gr.addColorStop(0, hexA(hex, 0.38));
        gr.addColorStop(1, hexA(hex, 0));
        ctx.fillStyle = gr;
        ctx.fillRect(-A, -W / 2, A, W);
      }
      // 入り口の区域
      ctx.beginPath();
      ctx.arc(0, 0, Z, 0, Math.PI * 2);
      ctx.fillStyle = hexA(hex, open ? 0.2 : 0.12);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = hexA(hex, open ? 0.75 : 0.45);
      ctx.stroke();
      ctx.setLineDash([]);
      // 帯
      ctx.fillStyle = open ? "#3b4652" : "#3a4048";
      ctx.fillRect(0, -W / 2, LEN, W);
      ctx.fillStyle = hex;
      ctx.globalAlpha = open ? 1 : 0.7;
      ctx.fillRect(0, -W / 2, LEN, 4);
      ctx.fillRect(0, W / 2 - 4, LEN, 4);
      ctx.globalAlpha = 1;
      // 開く演出：灰色から色が広がる
      if (opening) {
        const p = easeOut(opening.p);
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, (LEN + Z) * p, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = hexA(hex, 0.55 * (1 - opening.p));
        ctx.fillRect(-Z, -W / 2 - 6, LEN + Z, W + 12);
        ctx.restore();
      }
      // 白い中心線
      ctx.strokeStyle = open ? "rgba(255,255,255,0.85)" : "rgba(220,220,220,0.45)";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(LEN - 4, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      // 着陸した瞬間に滑走路が光る（5 の倍数は大きく）
      if (landing) {
        const big = !!landing.f.big;
        ctx.fillStyle = `rgba(255,255,240,${(big ? 0.75 : 0.55) * (1 - landing.p)})`;
        const pad = big && !calm ? 6 * (1 - landing.p) + 2 : 0;
        ctx.fillRect(-pad, -W / 2 - pad, LEN + pad * 2, W + pad * 2);
      }
      // 閉じた滑走路：×
      if (!open) {
        ctx.strokeStyle = "rgba(230,230,230,0.8)";
        ctx.lineWidth = 3;
        const cx = LEN * 0.55;
        ctx.beginPath();
        ctx.moveTo(cx - 7, -7); ctx.lineTo(cx + 7, 7);
        ctx.moveTo(cx + 7, -7); ctx.lineTo(cx - 7, 7);
        ctx.stroke();
      }
      // 向きの矢印（»。白抜き＋濃いふち。形だけで向きが分かる）
      const lit = !!wrong;
      let sz = 1;
      if (lit && !calm) sz = 1 + 0.3 * Math.sin(Math.PI * Math.min(1, wrong.p * 1.4));
      if (lit) {
        ctx.beginPath();
        ctx.arc(0, 0, Z * 1.05 * sz, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,240,150,${0.55 * (1 - wrong.p * 0.6)})`;
        ctx.fill();
      }
      chevrons(sz, open ? (lit ? "#fff7c2" : "#ffffff") : "#b9c2ca", lit ? "#7a4b00" : "rgba(10,16,22,0.9)");
      ctx.restore();

      // 印（帯の横。場の内側の方へ）
      const px = -dy, py = dx;
      const mx = ex + dx * LEN * 0.6, my = ey + dy * LEN * 0.6;
      const off = W / 2 + 14;
      let sx = mx + px * off, sy = my + py * off;
      const tx = mx - px * off, ty = my - py * off;
      const inside = (x, y) => Math.min(x, fw - x, y, fh - y);
      if (inside(tx, ty) > inside(sx, sy)) { sx = tx; sy = ty; }
      let br = 11;
      if (opening && !calm) br = 11 * (1 + 0.35 * Math.sin(Math.PI * Math.min(1, opening.p * 2)) * (1 - opening.p));
      badge(color, sx, sy, br, open, "runway");
      drawLog.arrows.push({ color, x: ex, y: ey, dx, dy, open, lit });
    }
    // 入り口の所に » を描く（ローカル座標：+x が滑走路の向き）
    function chevrons(sz, fill, edge) {
      const Z = K.ZONE_R;
      const h = Z * 0.62 * sz, w = Z * 0.5 * sz, t = Z * 0.28 * sz;
      ctx.lineJoin = "round";
      for (const ox of [-Z * 0.42 * sz, Z * 0.12 * sz]) {
        ctx.beginPath();
        ctx.moveTo(ox - w / 2, -h);
        ctx.lineTo(ox - w / 2 + t, -h);
        ctx.lineTo(ox + w / 2 + t, 0);
        ctx.lineTo(ox - w / 2 + t, h);
        ctx.lineTo(ox - w / 2, h);
        ctx.lineTo(ox + w / 2, 0);
        ctx.closePath();
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = edge;
        ctx.stroke();
        ctx.fillStyle = fill;
        ctx.fill();
      }
    }

    // ===== 予告 =====
    function drawWarn(wv, state) {
      const total = K.WARN_S / K.STEP;
      const left = Math.max(0, num(wv.spawnTick, 0) - num(state.tick, 0));
      const p = Math.max(0, Math.min(1, 1 - left / total));
      // いちばん近い端に寄せる（半円になる）
      let x = wv.x, y = wv.y;
      const dl = x, dr = fw - x, dt = y, db = fh - y;
      const m = Math.min(dl, dr, dt, db);
      let nx = 0, ny = 0;
      if (m === dl) { x = 0; nx = 1; } else if (m === dr) { x = fw; nx = -1; } else if (m === dt) { y = 0; ny = 1; } else { y = fh; ny = -1; }
      const hex = colorHex(wv.color);
      let r = 20;
      if (!calm) r += 2 * Math.sin(clock() / 120);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = hexA(hex, 0.25 + 0.55 * p);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(255,255,255,${0.4 + 0.5 * p})`;
      ctx.stroke();
      const cx = x + nx * 10, cy = y + ny * 10;
      ctx.globalAlpha = 0.5 + 0.5 * p;
      drawMark(markOf(wv.color), cx - ny * 4 + 0, cy - nx * 4 + 0, 5, isLight(wv.color) ? "#3a3200" : "#ffffff", 2);
      drawLog.marks.push({ kind: "warn", color: wv.color, x: wv.x, y: wv.y });
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", cx + ny * 8, cy + nx * 8);
      ctx.globalAlpha = 1;
    }

    // ===== 道 =====
    function drawPath(pl, x, y) {
      const path = pl.path;
      if (!Array.isArray(path)) return;
      const i0 = Math.max(0, num(pl.pathI, 0));
      if (i0 >= path.length) return;
      const hex = colorHex(pl.color);
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let i = i0; i < path.length; i++) ctx.lineTo(path[i][0], path[i][1]);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = 5.5;
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      if (!pl.guided) ctx.setLineDash([7, 7]);
      ctx.stroke();
      ctx.lineWidth = pl.guided ? 3.6 : 3;
      ctx.strokeStyle = hex;
      ctx.stroke();
      ctx.setLineDash([]);
      if (pl.guided) {
        const e = path[path.length - 1];
        ctx.beginPath();
        ctx.arc(e[0], e[1], 7.5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = hex === colorHex(2) ? "#5a5000" : hex;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(e[0] - 3.6, e[1] + 0.2);
        ctx.lineTo(e[0] - 0.8, e[1] + 3);
        ctx.lineTo(e[0] + 3.8, e[1] - 2.8);
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }
    }

    // ===== 飛行機 =====
    function drawPlane(pl, x, y, state, sel, holding) {
      const hex = colorHex(pl.color);
      let s = 1, a = 1;
      if (pl.phase === "land") {
        const p = Math.max(0, Math.min(1, (num(state.tick, 0) - num(pl.landTick, 0)) / (K.LAND_S / K.STEP)));
        s = 1 - 0.5 * p;
        a = 1 - 0.65 * p;
      }
      // 近すぎる：赤い輪（点滅。動きを減らす設定では太い輪）
      if (pl.near && pl.phase === "fly") {
        const blink = calm ? 1 : 0.45 + 0.55 * Math.abs(Math.sin(clock() / 140));
        ctx.beginPath();
        ctx.arc(x, y, 19, 0, Math.PI * 2);
        ctx.lineWidth = calm ? 4 : 3;
        ctx.strokeStyle = `rgba(255,70,70,${blink})`;
        ctx.stroke();
      }
      if (sel || holding) {
        ctx.beginPath();
        ctx.arc(x, y, 22, 0, Math.PI * 2);
        ctx.lineWidth = sel ? 3 : 2;
        ctx.strokeStyle = sel ? "#ffffff" : "rgba(255,255,255,0.55)";
        if (sel && !calm) ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = a;
      ctx.rotate(Math.atan2(num(pl.dy, 0), num(pl.dx, 1)));
      ctx.scale(s, s);
      ctx.beginPath();
      const kind = pl.kind;
      if (kind === "fast") {
        // ジェット：細い胴、後ろへ引いた翼
        ctx.moveTo(14, 0); ctx.lineTo(8, -2.6); ctx.lineTo(1, -2.8); ctx.lineTo(-6, -12); ctx.lineTo(-9, -12);
        ctx.lineTo(-5, -2.8); ctx.lineTo(-10, -2.6); ctx.lineTo(-13, -7); ctx.lineTo(-15, -7); ctx.lineTo(-13, 0);
        ctx.lineTo(-15, 7); ctx.lineTo(-13, 7); ctx.lineTo(-10, 2.6); ctx.lineTo(-5, 2.8); ctx.lineTo(-9, 12); ctx.lineTo(-6, 12);
        ctx.lineTo(1, 2.8); ctx.lineTo(8, 2.6); ctx.closePath();
      } else if (kind === "slow") {
        // プロペラ機：丸い胴、まっすぐな翼
        ctx.moveTo(12, 0); ctx.quadraticCurveTo(11, -4.8, 6, -4.6); ctx.lineTo(4, -4.6); ctx.lineTo(4, -13); ctx.lineTo(-1, -13);
        ctx.lineTo(-1, -4.4); ctx.lineTo(-8, -3.4); ctx.lineTo(-10, -7); ctx.lineTo(-13, -7); ctx.lineTo(-12, 0);
        ctx.lineTo(-13, 7); ctx.lineTo(-10, 7); ctx.lineTo(-8, 3.4); ctx.lineTo(-1, 4.4); ctx.lineTo(-1, 13); ctx.lineTo(4, 13);
        ctx.lineTo(4, 4.6); ctx.lineTo(6, 4.6); ctx.quadraticCurveTo(11, 4.8, 12, 0); ctx.closePath();
      } else {
        ctx.moveTo(13, 0); ctx.quadraticCurveTo(12, -3.6, 7, -3.6); ctx.lineTo(3, -3.6); ctx.lineTo(-3, -12.5); ctx.lineTo(-7, -12.5);
        ctx.lineTo(-4, -3.4); ctx.lineTo(-9, -3); ctx.lineTo(-12, -7); ctx.lineTo(-14, -7); ctx.lineTo(-12.5, 0);
        ctx.lineTo(-14, 7); ctx.lineTo(-12, 7); ctx.lineTo(-9, 3); ctx.lineTo(-4, 3.4); ctx.lineTo(-7, 12.5); ctx.lineTo(-3, 12.5);
        ctx.lineTo(3, 3.6); ctx.lineTo(7, 3.6); ctx.quadraticCurveTo(12, 3.6, 13, 0); ctx.closePath();
      }
      ctx.fillStyle = hex;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = "rgba(8,12,18,0.85)";
      ctx.stroke();
      if (kind === "slow") {
        ctx.beginPath();
        ctx.moveTo(13.2, -5); ctx.lineTo(13.2, 5);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = "rgba(240,240,240,0.9)";
        ctx.stroke();
      }
      ctx.restore();
      // 胴の印（向きに関係なく、いつも同じ向き）
      ctx.save();
      ctx.globalAlpha = a;
      drawMark(markOf(pl.color), x, y, 4.2 * s, isLight(pl.color) ? "#3a3200" : "#ffffff", 1.8);
      ctx.restore();
      drawLog.marks.push({ kind: "plane", color: pl.color, x, y });
    }

    // ===== 演出 =====
    function drawEffects() {
      const t = clock();
      const keep = [];
      for (const f of effects) {
        const p = (t - f.t0) / f.dur;
        if (p >= 1) continue;
        keep.push(f);
        if (p < 0) continue;
        if (f.type === "plus") {
          const yy = f.y - 26 * easeOut(p) - 10;
          ctx.globalAlpha = 1 - p * p;
          ctx.font = `900 ${f.big ? 22 : 17}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.lineWidth = 4;
          ctx.strokeStyle = "rgba(10,16,22,0.8)";
          ctx.strokeText("+1", f.x, yy);
          ctx.fillStyle = f.big ? "#ffe08a" : "#ffffff";
          ctx.fillText("+1", f.x, yy);
          ctx.globalAlpha = 1;
        } else if (f.type === "crash") {
          const r = 8 + 26 * easeOut(p);
          ctx.beginPath();
          ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,200,120,${0.6 * (1 - p)})`;
          ctx.fill();
          if (!calm) {
            ctx.fillStyle = `rgba(255,240,200,${1 - p})`;
            for (const s of f.sparks) {
              const d = s.v * easeOut(p);
              ctx.fillRect(f.x + s.dx * d - 1.5, f.y + s.dy * d - 1.5, 3, 3);
            }
          }
          // 消えた2機の色の輪
          for (const c of f.colors) {
            ctx.beginPath();
            ctx.arc(f.x, f.y, 6 + 16 * p, 0, Math.PI * 2);
            ctx.lineWidth = 3 * (1 - p);
            ctx.strokeStyle = hexA(colorHex(c), 1 - p);
            ctx.stroke();
          }
        } else if (f.type === "bounce") {
          ctx.beginPath();
          ctx.arc(f.x, f.y, 6 + 16 * p, 0, Math.PI * 2);
          ctx.lineWidth = 2;
          ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - p)})`;
          ctx.stroke();
        } else if (f.type === "tutor") {
          drawTutor(f, p);
        }
      }
      effects = keep;
    }
    // はじめの「なぞってね」：指が機体から案内の帯を通って入り口へ動く絵
    function drawTutor(f, p) {
      const pts = f.pts;
      if (!pts || pts.length < 2) return;
      const loop = (p * 2) % 1;           // 2回くり返す
      const k = Math.min(1, loop / 0.8);
      const idx = k * (pts.length - 1);
      const i = Math.floor(idx), fr = idx - i;
      const a = pts[i], b = pts[Math.min(pts.length - 1, i + 1)];
      const x = a[0] + (b[0] - a[0]) * fr, y = a[1] + (b[1] - a[1]) * fr;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let j = 1; j <= i; j++) ctx.lineTo(pts[j][0], pts[j][1]);
      ctx.lineTo(x, y);
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.stroke();
      ctx.setLineDash([]);
      const fade = loop > 0.85 ? 1 - (loop - 0.85) / 0.15 : 1;
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(10,16,22,0.7)";
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    function shakeOffset() {
      if (calm) return [0, 0];
      const t = clock();
      let amp = 0;
      for (const f of effects) if (f.type === "crash") { const p = (t - f.t0) / 380; if (p >= 0 && p < 1) amp = Math.max(amp, 4 * (1 - p)); }
      if (!amp) return [0, 0];
      return [Math.sin(t / 22) * amp, Math.cos(t / 31) * amp];
    }

    // ===== 1コマ描く =====
    function draw(state, ui) {
      const t0 = performance.now();
      const u = ui || {};
      drawLog = { marks: [], arrows: [] };
      if (state && state.w > 0 && state.h > 0) setField(state.w, state.h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(background(), 0, 0);
      const [sx, sy] = shakeOffset();
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, sx * dpr * scale, sy * dpr * scale);
      if (state) {
        for (const r of runwayList(state)) drawRunway(r);
        const planes = Array.isArray(state.planes) ? state.planes : [];
        const prev = u.prev && Array.isArray(u.prev.planes) ? u.prev.planes : null;
        const alpha = Math.max(0, Math.min(1, num(u.alpha, 1)));
        const pos = planes.map((pl) => {
          let x = pl.x, y = pl.y;
          if (prev && alpha < 1) {
            const q = prev.find((z) => z.id === pl.id);
            if (q && q.phase === pl.phase && Math.abs(q.x - pl.x) + Math.abs(q.y - pl.y) < 6) {
              x = q.x + (pl.x - q.x) * alpha; y = q.y + (pl.y - q.y) * alpha;
            }
          }
          return [x, y];
        });
        planes.forEach((pl, i) => { if (pl.phase === "fly") drawPath(pl, pos[i][0], pos[i][1]); });
        const holding = new Set(Array.isArray(u.drawing) ? u.drawing.map((d) => d.id) : []);
        // 着陸中の機体を先に（下に）描く
        planes.forEach((pl, i) => { if (pl.phase !== "fly") drawPlane(pl, pos[i][0], pos[i][1], state, false, false); });
        planes.forEach((pl, i) => { if (pl.phase === "fly") drawPlane(pl, pos[i][0], pos[i][1], state, u.selected === pl.id, holding.has(pl.id)); });
        if (Array.isArray(state.warns)) state.warns.forEach((wv) => drawWarn(wv, state));
      }
      drawEffects();
      frames += 1;
      lastDrawMs = performance.now() - t0;
    }

    // ===== 出来事 → 演出 =====
    function add(f) { f.t0 = clock(); effects.push(f); if (effects.length > 80) effects.splice(0, effects.length - 80); }
    function play(events, state) {
      if (!Array.isArray(events)) return;
      for (const e of events) {
        if (!e || typeof e.type !== "string") continue;
        if (e.type === "land") {
          let x = e.x, y = e.y;
          if (state && Array.isArray(state.planes)) { const p = state.planes.find((q) => q.id === e.id); if (p) { x = p.x; y = p.y; } }
          const big = num(e.landed, 0) > 0 && e.landed % 5 === 0;
          add({ type: "land", color: e.color, dur: big ? 700 : 500, big });
          if (Number.isFinite(x) && Number.isFinite(y)) add({ type: "plus", x, y, dur: 900, big });
        } else if (e.type === "crash") {
          const sparks = [];
          for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4; sparks.push({ dx: Math.cos(a), dy: Math.sin(a), v: 18 + Math.random() * 22 }); }
          const colors = Array.isArray(e.colors) ? e.colors.slice(0, 2) : [];   // main が前の state から足す
          add({ type: "crash", x: num(e.x, fw / 2), y: num(e.y, fh / 2), dur: 700, sparks, colors });
        } else if (e.type === "bounce") {
          if (!calm) add({ type: "bounce", x: num(e.x, 0), y: num(e.y, 0), dur: 400 });
        } else if (e.type === "open") {
          add({ type: "open", color: e.color, dur: 900 });
        } else if (e.type === "wrongway") {
          effects = effects.filter((f) => !(f.type === "wrongway" && f.color === e.color));
          add({ type: "wrongway", color: e.color, dur: 600 });
        }
      }
    }
    function tutor(points) {
      if (!Array.isArray(points) || points.length < 2) return;
      effects = effects.filter((f) => f.type !== "tutor");
      add({ type: "tutor", pts: points, dur: 3200 });
    }

    function hexA(hex, a) {
      const h = String(hex).replace("#", "");
      const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }
    function easeOut(p) { return 1 - (1 - p) * (1 - p); }

    resize();
    return {
      resize, setField, toField, toScreen, draw, play, tutor,
      setCalm(v) { calm = !!v; },
      pause() { if (pausedAt === null) pausedAt = performance.now(); },
      resume() { if (pausedAt !== null) { pausedTotal += performance.now() - pausedAt; pausedAt = null; } },
      finishAll() { effects = []; },
      // 光っている矢印（テスト用・main のヒント用）
      litColors() { return effects.filter((f) => f.type === "wrongway" && (clock() - f.t0) < f.dur).map((f) => f.color); },
      get scale() { return scale; },
      get frames() { return frames; },
      get lastDrawMs() { return lastDrawMs; },
      get drawLog() { return drawLog; },
      get busy() { const t = clock(); return effects.some((f) => t - f.t0 < f.dur); },
      get calm() { return calm; },
      get field() { return { w: fw, h: fh }; }
    };
  }

  root.MichibikiRender = Object.freeze({ create });
})(typeof window !== "undefined" ? window : globalThis);
