/* ハシわたり 描画（HashiRender）
 * create(canvas) -> { resize(), draw(view) }
 * view = {
 *   platforms: [{x,w}...], cameraX,
 *   hero: { x, y, pose },       // x は世界座標（ケロの足もとの右端。今の葉なら葉の右端）
 *                               // y は水面（葉の上面）からの高さ（論理単位、上が正。負なら水の中）
 *                               // pose: 'stand'|'walk'|'hop'|'fall'|'peek'
 *   bridge: { len, angle, x? },  // angle: 0=縦、PI/2=右へ倒れ終わり、それ以上は水へ倒れる
 *                               // x は茎の根もと（省略時は platforms[0] の右端）
 *   perfectFx, perfectX?,       // ぴったり演出の経過秒。perfectX は光る葉の中心（省略時はケロのいる葉）
 *   ghostTipX, guideTipX,
 *   splash, splashX?,           // ぽちゃんの経過秒。splashX は落ちた所（省略時は hero.x）
 *   lives, t                    // t は秒
 * }
 * 縮尺は縦横同じ（角度が正しく見える）。ふだんは論理単位 VIEW_W(1000) を canvas の横幅いっぱいに描くが、
 * 背の低い画面では、上向きの茎（最大 MAX_LEN）が canvas の上にはみ出さないよう縮める（横に見える幅が広がるだけ）。
 * layout(W, H) → { s, deckY } はその計算だけを返す純粋な関数（テストからも使う）。
 * DOM には触れず canvas だけを使う。devicePixelRatio は最大 2。
 */
(function (root, factory) {
  var v = factory();
  if (typeof module === "object" && module.exports) module.exports = v;
  root.HashiRender = v;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var C = {
    bg: "#1b1f2e", panel: "#252c41", well: "#0d111d", line: "#2f3750",
    ink: "#ece6d6", muted: "#9aa1b8", accent: "#f0a43a", accentInk: "#231705",
    water: "#0f2a3d", waterDeep: "#0a1d2b",
    leaf: "#009e73", leafDark: "#00704f", leafEdge: "#cfe9df",
    bridge: "#e69f00", bridgeDark: "#9a6a00",
    perfect: "#f0e442", perfectEdge: "#3a3300",
    hero: "#56b4e9", heroDark: "#2a7fb0", heroBelly: "#cdeaf8",
    eye: "#ffffff", pupil: "#10141f", blush: "#f2a6b4", moon: "#f3ecd2"
  };

  var DEFAULT_VIEW_W = 1000;
  var DEFAULT_MAX_LEN = 800;
  var PERFECT_FX_SEC = 1.0;   // ぴったり演出の長さ
  var SPLASH_SEC = 0.9;       // ぽちゃんの長さ

  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function viewW() {
    var L = (typeof HashiLogic !== "undefined" && HashiLogic) || (typeof globalThis !== "undefined" && globalThis.HashiLogic) || {};
    var w = num(L.VIEW_W, DEFAULT_VIEW_W);
    return w > 0 ? w : DEFAULT_VIEW_W;
  }
  function maxLen() {
    var L = (typeof HashiLogic !== "undefined" && HashiLogic) || (typeof globalThis !== "undefined" && globalThis.HashiLogic) || {};
    var m = num(L.MAX_LEN, DEFAULT_MAX_LEN);
    return m > 0 ? m : DEFAULT_MAX_LEN;
  }
  var TOP_MARGIN = 12;        // 茎の先（小さな葉）の分だけ上を空ける（CSS px）

  // 縮尺と葉の高さ。横長の画面（W > H）は葉を下げて、縮みすぎないようにする
  function layout(W, H, vw, ml) {
    var w = num(W, 320), h = num(H, 240);
    var VW = num(vw, viewW()), M = num(ml, maxLen());
    var deckY = Math.round(h * (w > h ? 0.8 : 0.66));
    var s = Math.min(w / VW, Math.max(0.01, deckY - TOP_MARGIN) / M);
    return { s: s, deckY: deckY };
  }
  function perfectHalf() {
    var L = (typeof HashiLogic !== "undefined" && HashiLogic) || (typeof globalThis !== "undefined" && globalThis.HashiLogic) || {};
    return Math.max(1, num(L.PERFECT_HALF, 10));
  }

  function reduced() {
    try { return !!(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) { return false; }
  }

  // 0..1 の決まった疑似乱数（星や波の位置。毎フレーム同じ場所に出す）
  function hash(i) {
    var x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function validPlatforms(list) {
    var out = [];
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p && typeof p.x === "number" && isFinite(p.x) && typeof p.w === "number" && isFinite(p.w) && p.w > 0) out.push(p);
    }
    return out;
  }

  function create(canvas) {
    if (!canvas || typeof canvas.getContext !== "function") {
      throw new Error("HashiRender.create: canvas 要素を渡してください（getContext がありません）");
    }
    var ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("HashiRender.create: 2D の描画面を取得できませんでした");

    var W = 320, H = 240, dpr = 1;
    var calm = reduced();
    try {
      var mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
      if (mq) {
        var onMq = function (e) { calm = !!e.matches; };
        if (mq.addEventListener) mq.addEventListener("change", onMq);
        else if (mq.addListener) mq.addListener(onMq);
      }
    } catch (e) { /* 追従できなくても描画は動く */ }

    function resize() {
      var r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      dpr = Math.min(2, Math.max(1, (typeof devicePixelRatio === "number" && devicePixelRatio) || 1));
      W = Math.max(120, Math.round((r && r.width) || canvas.clientWidth || 320));
      H = Math.max(80, Math.round((r && r.height) || canvas.clientHeight || 240));
      var cw = Math.round(W * dpr), ch = Math.round(H * dpr);
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
    }

    /* ---------- 背景（夜空と池） ---------- */
    function drawSky(deckY, camPx, t) {
      var g = ctx.createLinearGradient(0, 0, 0, deckY);
      g.addColorStop(0, C.well);
      g.addColorStop(1, C.bg);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, deckY + 1);

      // 月（動かない）
      var mr = clamp(Math.min(W, H) * 0.06, 10, 34);
      var mx = W * 0.84, my = Math.max(mr + 6, deckY * 0.22);
      ctx.fillStyle = C.moon;
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.well;
      ctx.beginPath(); ctx.arc(mx + mr * 0.45, my - mr * 0.25, mr * 0.9, 0, Math.PI * 2); ctx.fill();

      // 星（ゆっくり流れる。calm ではまたたかない）
      var n = 26, span = W + 40;
      for (var i = 0; i < n; i++) {
        var sx = ((hash(i) * span - camPx * 0.08) % span + span) % span - 20;
        var sy = hash(i + 50) * deckY * 0.8;
        var tw = calm ? 0.55 : 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(t * (0.8 + hash(i + 9)) + i));
        ctx.globalAlpha = tw;
        ctx.fillStyle = C.ink;
        var sz = hash(i + 99) < 0.2 ? 2 : 1.2;
        ctx.fillRect(sx, sy, sz, sz);
      }
      ctx.globalAlpha = 1;
    }

    function drawWater(waterY, camPx, t, s) {
      var g = ctx.createLinearGradient(0, waterY, 0, H);
      g.addColorStop(0, C.water);
      g.addColorStop(1, C.waterDeep);
      ctx.fillStyle = g;
      ctx.fillRect(0, waterY, W, H - waterY);

      // 月の映り込み
      ctx.fillStyle = C.moon;
      var rh = Math.max(2, (H - waterY) * 0.5);
      for (var m = 0; m < 4; m++) {
        ctx.globalAlpha = 0.12 - m * 0.025;
        var mw = W * (0.035 - m * 0.006);
        ctx.fillRect(W * 0.84 - mw + (calm ? 0 : Math.sin(t * 1.5 + m) * 2), waterY + 3 + m * rh / 4, mw * 2, Math.max(1.5, rh / 8));
      }
      ctx.globalAlpha = 1;

      // 波のすじ（calm では止める）
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      var rows = 4, step = (H - waterY) / (rows + 1);
      for (var r = 1; r <= rows; r++) {
        var y = waterY + step * r;
        var len = 26 + 18 * hash(r);
        var gapPx = 70 + 40 * hash(r + 3);
        var drift = calm ? 0 : t * (8 + r * 3);
        var off = ((-(camPx * (0.3 + r * 0.1)) + drift + hash(r + 7) * gapPx) % gapPx + gapPx) % gapPx - gapPx;
        ctx.globalAlpha = 0.5 - r * 0.07;
        ctx.beginPath();
        for (var x = off; x < W; x += gapPx) {
          ctx.moveTo(x, y);
          ctx.lineTo(x + len, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    /* ---------- はすの葉 ---------- */
    function padGeom(p, X, deckY, s) {
      var rx = Math.max(4, p.w * s / 2);
      var ry = clamp(rx * 0.24, 3, 12);
      return { cx: X(p.x + p.w / 2), cy: deckY + ry * 0.45, rx: rx, ry: ry };
    }

    function drawPad(p, X, deckY, s, glow) {
      var g = padGeom(p, X, deckY, s);
      // 水に落ちる影
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath(); ctx.ellipse(g.cx, g.cy + g.ry * 0.7, g.rx * 1.02, g.ry * 0.9, 0, 0, Math.PI * 2); ctx.fill();
      // 葉の厚み
      ctx.fillStyle = C.leafDark;
      ctx.beginPath(); ctx.ellipse(g.cx, g.cy + Math.max(1.5, g.ry * 0.3), g.rx, g.ry, 0, 0, Math.PI * 2); ctx.fill();
      // 葉（手前に切れ込み）
      var notch = 0.32;
      ctx.fillStyle = C.leaf;
      ctx.beginPath();
      ctx.moveTo(g.cx, g.cy);
      ctx.ellipse(g.cx, g.cy, g.rx, g.ry, 0, Math.PI / 2 + notch / 2, Math.PI / 2 + Math.PI * 2 - notch / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = C.leafEdge;
      ctx.lineWidth = Math.max(1, Math.min(2, s * 3));
      ctx.stroke();
      // 葉すじ
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = C.leafEdge;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var k = 0; k < 5; k++) {
        var a = Math.PI + (k + 0.5) * (Math.PI / 5);
        ctx.moveTo(g.cx, g.cy);
        ctx.lineTo(g.cx + Math.cos(a) * g.rx * 0.8, g.cy + Math.sin(a) * g.ry * 0.8);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (glow > 0) {
        ctx.globalAlpha = 0.5 * glow;
        ctx.fillStyle = C.perfect;
        ctx.beginPath(); ctx.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }

      // ぴったり印（◆、暗いふち）
      var hw = Math.max(4, perfectHalf() * s);
      var dh = Math.max(4, Math.min(g.ry * 0.8, hw * 0.7));
      var my = deckY - dh * 0.15;
      ctx.beginPath();
      ctx.moveTo(g.cx, my - dh);
      ctx.lineTo(g.cx + hw, my);
      ctx.lineTo(g.cx, my + dh);
      ctx.lineTo(g.cx - hw, my);
      ctx.closePath();
      ctx.fillStyle = C.perfect;
      ctx.fill();
      ctx.strokeStyle = C.perfectEdge;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    /* ---------- 茎 ---------- */
    function drawBridge(baseX, deckY, lenPx, angle, s) {
      if (lenPx <= 0.5) return;
      var th = clamp(9 * s, 3, 7);
      ctx.save();
      ctx.translate(baseX, deckY);
      ctx.rotate(angle);       // 0 で上向き、PI/2 で右向き
      ctx.fillStyle = C.bridge;
      ctx.fillRect(-th / 2, -lenPx, th, lenPx);
      ctx.fillStyle = C.bridgeDark;
      ctx.fillRect(th / 2 - Math.max(1, th * 0.3), -lenPx, Math.max(1, th * 0.3), lenPx);
      // 節
      ctx.fillStyle = C.bridgeDark;
      var nodeGap = Math.max(18, 60 * s);
      for (var y = nodeGap; y < lenPx - 4; y += nodeGap) ctx.fillRect(-th / 2, -y, th, 1.5);
      // 先の小さな葉
      ctx.fillStyle = C.leaf;
      ctx.beginPath();
      ctx.ellipse(th * 0.9, -lenPx + th * 0.2, th * 1.1, th * 0.5, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* ---------- 影と点線 ---------- */
    function drawGhost(baseX, tipX, deckY, s) {
      var th = clamp(9 * s, 3, 7);
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = C.ink;
      var x0 = Math.min(baseX, tipX), x1 = Math.max(baseX, tipX);
      ctx.fillRect(x0, deckY - th / 2, x1 - x0, th);
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.5;
      var r = Math.max(5, th * 1.2);
      ctx.beginPath();
      ctx.moveTo(tipX, deckY - r - 2); ctx.lineTo(tipX + r, deckY - 2);
      ctx.lineTo(tipX, deckY + r - 2); ctx.lineTo(tipX - r, deckY - 2);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    function drawGuide(baseX, tipX, deckY, waterY) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 2;
      if (ctx.setLineDash) ctx.setLineDash([4, 6]);
      var y = Math.max(deckY + 2, waterY + 2);
      ctx.beginPath();
      ctx.moveTo(baseX, y); ctx.lineTo(tipX, y);
      ctx.moveTo(tipX, deckY - 14); ctx.lineTo(tipX, y + 8);
      ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
      ctx.restore();
    }

    /* ---------- 波紋・しぶき ---------- */
    function drawPerfectFx(cx, deckY, sec, padRx) {
      var p = clamp(sec / PERFECT_FX_SEC, 0, 1);
      if (p >= 1) return;
      ctx.save();
      ctx.strokeStyle = C.perfect;
      ctx.lineWidth = 2;
      if (calm) {
        ctx.globalAlpha = 0.6 * (1 - p);
        ctx.beginPath(); ctx.ellipse(cx, deckY + 2, padRx * 1.15, padRx * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
      } else {
        for (var k = 0; k < 3; k++) {
          var q = p - k * 0.18;
          if (q <= 0) continue;
          var rr = padRx * (0.9 + q * 1.6);
          ctx.globalAlpha = 0.7 * (1 - q);
          ctx.beginPath(); ctx.ellipse(cx, deckY + 2, rr, rr * 0.26, 0, 0, Math.PI * 2); ctx.stroke();
        }
        // きらり
        ctx.globalAlpha = 1 - p;
        ctx.fillStyle = C.perfect;
        for (var i = 0; i < 6; i++) {
          var a = -Math.PI * (i + 0.5) / 6;
          var d = padRx * (0.3 + p * 0.9);
          var x = cx + Math.cos(a) * d, y = deckY - 6 + Math.sin(a) * d * 0.6;
          ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
        }
      }
      ctx.restore();
    }

    function drawSplash(cx, waterY, sec, u) {
      var p = clamp(sec / SPLASH_SEC, 0, 1);
      if (p >= 1) return;
      ctx.save();
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.5;
      if (calm) {
        ctx.globalAlpha = 0.5 * (1 - p);
        ctx.beginPath(); ctx.ellipse(cx, waterY + 3, u * 1.4, u * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
      } else {
        for (var k = 0; k < 2; k++) {
          var q = p - k * 0.25;
          if (q <= 0) continue;
          var rr = u * (0.6 + q * 2.4);
          ctx.globalAlpha = 0.6 * (1 - q);
          ctx.beginPath(); ctx.ellipse(cx, waterY + 3, rr, rr * 0.25, 0, 0, Math.PI * 2); ctx.stroke();
        }
        // しずく
        ctx.globalAlpha = 1 - p;
        ctx.fillStyle = C.heroBelly;
        for (var i = 0; i < 7; i++) {
          var vx = (i - 3) * u * 0.55;
          var vy = u * (2.4 + hash(i + 3) * 1.2);
          var x = cx + vx * p * 1.4;
          var y = waterY - (vy * p - u * 4.2 * p * p);
          if (y > waterY + 2) continue;
          ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, u * 0.12), 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    }

    /* ---------- ケロ ---------- */
    function drawHero(hx, footY, r, pose, t, waterY) {
      var walk = pose === "walk", hop = pose === "hop", fall = pose === "fall", peek = pose === "peek";
      var bob = 0, sqX = 1, sqY = 1, tilt = 0;
      if (!calm) {
        if (walk) bob = Math.abs(Math.sin(t * 12)) * r * 0.18;
        else if (pose === "stand") sqY = 1 + Math.sin(t * 2.2) * 0.025;
        else if (peek) bob = Math.sin(t * 5) * r * 0.06;
      }
      if (hop) { sqX = 0.9; sqY = 1.12; }
      if (fall) tilt = calm ? 0.25 : 0.25 + Math.sin(t * 9) * 0.12;

      var cx = hx - r * 1.05;          // 足もとの右端が hx になるように
      var cy = footY - r * 0.72 - bob;

      ctx.save();
      if (fall || peek) {
        // 水の中の部分は描かない（沈んで見える）
        ctx.beginPath(); ctx.rect(0, 0, W, waterY + (peek ? 0 : 1)); ctx.clip();
      }
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      ctx.scale(sqX, sqY);

      // 後ろ足
      ctx.fillStyle = C.heroDark;
      if (hop || fall) {
        ctx.beginPath(); ctx.ellipse(-r * 0.75, r * 0.75, r * 0.45, r * 0.16, 0.6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(r * 0.55, r * 0.8, r * 0.4, r * 0.15, -0.6, 0, Math.PI * 2); ctx.fill();
      } else {
        var step = walk && !calm ? Math.sin(t * 12) * r * 0.15 : 0;
        ctx.beginPath(); ctx.ellipse(-r * 0.5 + step, r * 0.62, r * 0.42, r * 0.17, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(r * 0.45 - step, r * 0.64, r * 0.36, r * 0.15, 0, 0, Math.PI * 2); ctx.fill();
      }

      // からだ
      ctx.fillStyle = C.hero;
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.72, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.heroDark;
      ctx.lineWidth = Math.max(1, r * 0.07);
      ctx.stroke();
      // おなか
      ctx.fillStyle = C.heroBelly;
      ctx.beginPath(); ctx.ellipse(r * 0.18, r * 0.25, r * 0.55, r * 0.36, 0, 0, Math.PI * 2); ctx.fill();

      // 目のふくらみ
      var ex1 = -r * 0.22, ex2 = r * 0.42, ey = -r * 0.62, er = r * 0.32;
      ctx.fillStyle = C.hero;
      ctx.beginPath(); ctx.arc(ex1, ey, er, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(ex2, ey, er, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      if (peek) {
        // 照れ笑い：にっこり目（^ ^）とほっぺ
        ctx.strokeStyle = C.pupil;
        ctx.lineWidth = Math.max(1.2, r * 0.09);
        ctx.beginPath(); ctx.arc(ex1, ey + er * 0.2, er * 0.5, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
        ctx.beginPath(); ctx.arc(ex2, ey + er * 0.2, er * 0.5, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
        ctx.fillStyle = C.blush;
        ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.ellipse(-r * 0.5, -r * 0.08, r * 0.17, r * 0.1, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(r * 0.72, -r * 0.08, r * 0.17, r * 0.1, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        // ひや汗
        ctx.fillStyle = C.heroBelly;
        ctx.beginPath();
        ctx.moveTo(r * 0.95, -r * 0.95);
        ctx.quadraticCurveTo(r * 1.12, -r * 0.6, r * 0.95, -r * 0.52);
        ctx.quadraticCurveTo(r * 0.8, -r * 0.6, r * 0.95, -r * 0.95);
        ctx.fill();
      } else if (fall) {
        // びっくり目
        ctx.fillStyle = C.eye;
        ctx.beginPath(); ctx.arc(ex1, ey, er * 0.72, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ex2, ey, er * 0.72, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.pupil;
        ctx.beginPath(); ctx.arc(ex1, ey, er * 0.22, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ex2, ey, er * 0.22, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = C.eye;
        ctx.beginPath(); ctx.arc(ex1 + er * 0.1, ey, er * 0.66, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ex2 + er * 0.1, ey, er * 0.66, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.pupil;
        ctx.beginPath(); ctx.arc(ex1 + er * 0.28, ey + er * 0.05, er * 0.32, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ex2 + er * 0.28, ey + er * 0.05, er * 0.32, 0, Math.PI * 2); ctx.fill();
      }

      // くち
      ctx.strokeStyle = C.pupil;
      ctx.lineWidth = Math.max(1, r * 0.07);
      ctx.beginPath();
      if (fall) ctx.arc(r * 0.35, -r * 0.05, r * 0.12, 0, Math.PI * 2);
      else ctx.arc(r * 0.2, -r * 0.2, r * 0.45, Math.PI * 0.2, Math.PI * 0.75);
      ctx.stroke();

      ctx.restore();
    }

    /* ---------- 全体 ---------- */
    function draw(view) {
      if (!view || typeof view !== "object") return;
      var t = num(view.t, 0);
      var lay = layout(W, H);
      var s = lay.s;                           // 論理単位 → CSS px
      var cam = num(view.cameraX, 0);
      function X(x) { return (x - cam) * s; }

      var deckY = lay.deckY;                   // 葉の上面（茎が倒れる高さ）
      var waterY = deckY + clamp(4 * s, 2, 4);  // 水面

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      drawSky(deckY, cam * s, t);
      drawWater(waterY, cam * s, t, s);

      var pads = validPlatforms(view.platforms);
      var hero = view.hero && typeof view.hero === "object" ? view.hero : null;
      var heroX = hero ? num(hero.x, NaN) : NaN;

      // ぴったり演出の葉（perfectX があればその中心、なければケロのいる葉）
      var fxSec = view.perfectFx === null || view.perfectFx === undefined ? null : num(view.perfectFx, null);
      var fxPad = null;
      if (fxSec !== null && fxSec >= 0 && fxSec < PERFECT_FX_SEC) {
        var fxX = num(view.perfectX, NaN);
        for (var i = 0; i < pads.length && !fxPad; i++) {
          var pp = pads[i];
          if (isFinite(fxX) ? Math.abs(pp.x + pp.w / 2 - fxX) <= pp.w / 2 : (isFinite(heroX) && heroX >= pp.x - 1 && heroX <= pp.x + pp.w + 1)) fxPad = pp;
        }
        if (!fxPad && pads.length) fxPad = pads[0];
      }

      // 茎の根もと
      var br = view.bridge && typeof view.bridge === "object" ? view.bridge : null;
      var baseWX = br && isFinite(num(br.x, NaN)) ? br.x : (pads.length ? pads[0].x + pads[0].w : 0);
      var baseX = X(baseWX);

      var guideX = view.guideTipX === null || view.guideTipX === undefined ? NaN : num(view.guideTipX, NaN);
      if (isFinite(guideX)) drawGuide(baseX, X(guideX), deckY, waterY);

      for (var j = 0; j < pads.length; j++) {
        var p = pads[j];
        var x0 = X(p.x), x1 = X(p.x + p.w);
        if (x1 < -20 || x0 > W + 20) continue;
        var glow = 0;
        if (p === fxPad) glow = calm ? 0.5 * (1 - fxSec / PERFECT_FX_SEC) : Math.max(0, 1 - fxSec / (PERFECT_FX_SEC * 0.6));
        drawPad(p, X, deckY, s, glow);
      }

      if (fxPad) {
        var g = padGeom(fxPad, X, deckY, s);
        drawPerfectFx(g.cx, deckY, fxSec, g.rx);
      }

      var ghostX = view.ghostTipX === null || view.ghostTipX === undefined ? NaN : num(view.ghostTipX, NaN);
      if (isFinite(ghostX)) drawGhost(baseX, X(ghostX), deckY, s);

      var heroR = clamp(30 * s, 11, 28);

      if (br) {
        var lenPx = clamp(num(br.len, 0), 0, 100000) * s;
        var ang = clamp(num(br.angle, 0), 0, Math.PI);
        drawBridge(baseX, deckY, lenPx, ang, s);
      }

      if (hero && isFinite(heroX)) {
        var pose = typeof hero.pose === "string" ? hero.pose : "stand";
        var hy = num(hero.y, 0);
        if (pose === "hop" && calm) hy = Math.min(hy, 0);   // 跳ねる動きは止める
        var footY = deckY - hy * s;
        if (pose === "peek") footY = Math.max(footY, waterY + heroR * 0.3);
        drawHero(X(heroX), footY, heroR, pose, t, waterY);
      }

      var spSec = view.splash === null || view.splash === undefined ? null : num(view.splash, null);
      if (spSec !== null && spSec >= 0) {
        var spX = num(view.splashX, isFinite(heroX) ? heroX : NaN);
        if (isFinite(spX)) drawSplash(X(spX) - heroR * 1.05, waterY, spSec, heroR);
      }
    }

    resize();
    return { resize: resize, draw: draw };
  }

  return { create: create, layout: layout, COLORS: C, PERFECT_FX_SEC: PERFECT_FX_SEC, SPLASH_SEC: SPLASH_SEC };
});
