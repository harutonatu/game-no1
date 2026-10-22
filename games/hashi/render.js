/* ハシわたり 描画（HashiRender）
 * create(canvas) -> { resize(), draw(view) }
 * view = {
 *   platforms: [{x,w}...], cameraX,
 *   hero: { x, y, pose },       // x は世界座標（ケロの足もとの右端。今の葉なら葉の右端）
 *                               // y は水面（葉の上面）からの高さ（論理単位、上が正。負なら水の中）
 *                               // pose: 'stand'|'walk'|'hop'|'fall'|'peek'
 *   bridge: { len, angle, x?, maxed? },  // angle: 0=縦、PI/2=右へ倒れ終わり、それ以上は水へ倒れる
 *                               // maxed: true なら いちばん長い（先が黄色に光る）
 *                               // x は茎の根もと（省略時は platforms[0] の右端）
 *   perfectFx, perfectX?,       // ぴったり演出の経過秒。perfectX は光る葉の中心（省略時はケロのいる葉）
 *   ghostTipX, guideTipX,
 *   splash, splashX?,           // ぽちゃんの経過秒。splashX は落ちた所（省略時は hero.x）
 *   skipFx, skipX?,             // ひとつ飛ばしの「とばし！」の経過秒。skipX は着いた葉の中心
 *   clearFx,                    // ステージクリアの演出 { sec, calm, x, n }（花火と蓮の花 n 輪。null なら描かない）
 *   liftMax,                    // ステージのいちばん高い葉の高さ（その上から真上に伸ばした茎も入る縮尺にする。省略は 0）
 *   flagGotX, flagFx, flagX,    // 取った旗の葉の x（その x 以下の旗は「取った」絵）、旗を取った演出の経過秒と旗の葉の中心
 *   lives, t                    // t は秒
 * 葉は { x, w, y?, goal?, flag? }。y は水面からの高さ（上が正、省略は 0）。goal の葉にはゴールの旗、flag の葉には黄色い旗。
 * y を持つ葉（ステージ）は、水の中まで続く茎（根）を描き、高さの差を見やすくする。
 * 茎（bridge）は { len, angle, x?, y? }。y は根もとの高さ（省略は 0）。
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
  var SKIP_FX_SEC = 1.0;      // 「とばし！」の字が浮かぶ長さ
  var FLAG_FX_SEC = 1.0;      // 旗を取ったときの「はた！」の長さ
  // 見えやすさ（HS-08。3:1 以上）：「ここまで要った」影の濃さ（水の上で約 4:1）と、その下に敷く暗いふちの濃さ（葉の上で見える）、
  // ぴったり印（黄）のまわりの暗いふちの太さ（黄と葉は 2.6:1 しかないので、暗いふち（葉と 3.7:1・黄と 9.6:1）で囲む）
  var GHOST_ALPHA = 0.5, GHOST_EDGE_ALPHA = 0.7, PERFECT_RING = 3;

  // 花火の表（main.js も音を鳴らすのに使う）：t＝開く時刻（秒）、x・y＝画面の中の位置（割合）、r＝大きさ、c・c2＝粒の2色
  var FIREWORKS = [
    { t: 0.30, x: 0.18, y: 0.30, r: 1.0, c: "perfect", c2: "accent" },
    { t: 0.40, x: 0.52, y: 0.18, r: 1.15, c: "blush", c2: "eye" },
    { t: 0.50, x: 0.84, y: 0.34, r: 0.95, c: "hero", c2: "perfect" },
    { t: 0.95, x: 0.34, y: 0.42, r: 0.9, c: "accent", c2: "blush" },
    { t: 1.05, x: 0.70, y: 0.20, r: 1.1, c: "perfect", c2: "hero" },
    { t: 1.15, x: 0.10, y: 0.16, r: 0.85, c: "blush", c2: "perfect" },
    { t: 1.55, x: 0.60, y: 0.40, r: 1.0, c: "hero", c2: "eye" },
    { t: 1.65, x: 0.88, y: 0.14, r: 0.9, c: "accent", c2: "perfect" },
    { t: 1.75, x: 0.28, y: 0.22, r: 1.1, c: "perfect", c2: "blush" }
  ];
  var FW_LIFE = 1.1;          // 1発が開いてから消えるまで（秒）
  var FW_RISE = 0.28;         // 打ち上がる時間（秒）
  var FW_N = 28;              // 1発の粒（2色で 14 本ずつ。iPhone SE でも軽い数）
  var LOTUS_AT = 1.1;         // 蓮の花が咲き始める時刻（秒）
  var LOTUS_MIN = 5, LOTUS_MAX = 10;
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
  var TIP_PAD = 8;            // 茎の先の小さな葉（最大 8px 上に出る）
  var TOP_GAP = 8;            // その上に、canvas の上端までの余白
  var TOP_MARGIN = TIP_PAD + TOP_GAP;

  // 縮尺と葉の高さ。横長の画面（W > H）は葉を下げて、縮みすぎないようにする。
  // lift（ステージのいちばん高い葉）があれば、その上から真上に伸ばした茎（MAX_LEN）も上端に触れない縮尺にする
  function layout(W, H, vw, ml, lift) {
    var w = num(W, 320), h = num(H, 240);
    var VW = num(vw, viewW()), M = num(ml, maxLen()), up = Math.max(0, num(lift, 0));
    // 縦長でステージ（高い葉がある）なら、葉を少し下げて上に茎の伸びる場所を取る（縮みすぎないように）
    var deckY = Math.round(h * (w > h ? 0.8 : up > 0 ? 0.76 : 0.66));
    var s = Math.min(w / VW, Math.max(0.01, deckY - TOP_MARGIN) / (M + up));
    return { s: s, deckY: deckY, top: TOP_MARGIN };
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

    function padY(p) { return typeof p.y === "number" && isFinite(p.y) && p.y > 0 ? p.y : 0; }
    function drawPad(p, X, deckY0, s, glow, waterY, flagGot) {
      var lift = padY(p) * s;
      var deckY = deckY0 - lift;
      if (typeof p.y === "number" && isFinite(p.y)) {
        // ステージの葉：水の中まで続く茎（根）で支える。水面に輪を描いて、葉の高さを水面から測れるようにする
        var sx = X(p.x + p.w / 2);
        var sw = clamp(8 * s, 3, 6);
        var wy = num(waterY, deckY0 + 3);
        var root = clamp(40 * s, 10, 22);
        ctx.fillStyle = C.leafDark;
        if (lift > 0.5) ctx.fillRect(sx - sw / 2, deckY, sw, wy - deckY);
        ctx.globalAlpha = 0.55;
        ctx.fillRect(sx - sw / 2, wy, sw, root * 0.6);
        ctx.globalAlpha = 0.28;
        ctx.fillRect(sx - sw / 2, wy + root * 0.6, sw, root * 0.4);
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = C.leafEdge;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(sx, wy + 1, sw * 1.8, sw * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
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
      // 先に太い暗いふち（線の半分＝外側に PERFECT_RING/2 px）を引いてから黄で塗り、細いふちで締める
      ctx.strokeStyle = C.perfectEdge;
      ctx.lineJoin = "round";
      ctx.lineWidth = PERFECT_RING * 2;
      ctx.stroke();
      ctx.fillStyle = C.perfect;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineJoin = "miter";

      if (p.goal) {
        // ゴールの旗（葉の右寄り。色だけでなく形でも分かる）
        var fx = g.cx + g.rx * 0.55, ph = clamp(70 * s, 22, 44);
        ctx.fillStyle = C.ink;
        ctx.fillRect(fx - 1, deckY - ph, 2, ph);
        ctx.fillStyle = C.blush;
        ctx.beginPath();
        ctx.moveTo(fx + 1, deckY - ph);
        ctx.lineTo(fx + 1 + ph * 0.6, deckY - ph * 0.78);
        ctx.lineTo(fx + 1, deckY - ph * 0.56);
        ctx.closePath();
        ctx.fill();
      } else if (p.flag) {
        // 5枚ごとの旗（黄色・暗いふち。取った旗ははためき、まだの旗は少し暗い）
        var gx = g.cx + g.rx * 0.5, gh = clamp(60 * s, 20, 38), wave = flagGot && !calm ? Math.sin(tNow * 6) * 0.08 : 0;
        ctx.globalAlpha = flagGot ? 1 : 0.75;
        ctx.fillStyle = C.ink;
        ctx.fillRect(gx - 1, deckY - gh, 2, gh);
        ctx.fillStyle = C.perfect;
        ctx.strokeStyle = C.perfectEdge;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(gx + 1, deckY - gh);
        ctx.lineTo(gx + 1 + gh * 0.62, deckY - gh * (0.8 + wave));
        ctx.lineTo(gx + 1, deckY - gh * 0.58);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    var tNow = 0;

    /* ---------- 茎 ---------- */
    function drawBridge(baseX, deckY, lenPx, angle, s, maxed) {
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
      // 先の小さな葉。いちばん長くなったら（maxed）黄色に光り、暗いふちの輪で囲む（これ以上のびないと分かる。HS-02）
      if (maxed) {
        ctx.fillStyle = C.perfect;
        ctx.beginPath(); ctx.arc(0, -lenPx, th * 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = C.perfectEdge;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fillStyle = maxed ? C.perfect : C.leaf;
      ctx.beginPath();
      ctx.ellipse(th * 0.9, -lenPx + th * 0.2, th * 1.1, th * 0.5, -0.6, 0, Math.PI * 2);
      ctx.fill();
      if (maxed) { ctx.strokeStyle = C.perfectEdge; ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.restore();
    }

    /* ---------- 影と点線 ---------- */
    function drawGhost(baseX, tipX, deckY, s, baseY) {
      var th = clamp(9 * s, 3, 7);
      var by = num(baseY, deckY);
      var r = Math.max(5, th * 1.2);
      function diamond() {
        ctx.beginPath();
        ctx.moveTo(tipX, deckY - r - 2); ctx.lineTo(tipX + r, deckY - 2);
        ctx.lineTo(tipX, deckY + r - 2); ctx.lineTo(tipX - r, deckY - 2);
        ctx.closePath();
      }
      ctx.save();
      ctx.lineCap = "round";
      // 下に暗いふち（葉の上でも影が見える）。その上に明るい影（水の上で 3:1 以上。HS-08）
      ctx.globalAlpha = GHOST_EDGE_ALPHA;
      ctx.strokeStyle = C.well;
      ctx.lineWidth = th + 4;
      ctx.beginPath(); ctx.moveTo(baseX, by); ctx.lineTo(tipX, deckY); ctx.stroke();
      ctx.lineWidth = 4.5;
      diamond(); ctx.stroke();
      ctx.globalAlpha = GHOST_ALPHA;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = th;
      ctx.beginPath(); ctx.moveTo(baseX, by); ctx.lineTo(tipX, deckY); ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.5;
      diamond(); ctx.stroke();
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

    /* ---------- ひとつ飛ばしの「とばし！」 ---------- */
    function drawSkipFx(cx, deckY, sec, s, heroR, text, color, dur) {
      var p = clamp(sec / (dur || SKIP_FX_SEC), 0, 1);
      var rise = calm ? 0 : p * 24;
      var size = Math.round(clamp(heroR * 0.9, 14, 26));
      var y = deckY - heroR * 3.2 - rise;
      ctx.save();
      ctx.globalAlpha = p < 0.7 ? 1 : Math.max(0, 1 - (p - 0.7) / 0.3);
      ctx.font = "700 " + size + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(3, size * 0.22);
      ctx.strokeStyle = C.well;
      ctx.strokeText(text || "とばし！", cx, y);
      ctx.fillStyle = color || C.accent;
      ctx.fillText(text || "とばし！", cx, y);
      ctx.restore();
    }

    /* ---------- ステージクリア：花火と蓮の花 ---------- */
    // 花火：中心に光る塊、太い粒が尾を引いて広がり、少し落ちる。3発ずつ3回（画面全体に）。動きを減らす設定では出さない
    function drawShell(f, i, sec, deckY) {
      var q = (sec - f.t) / FW_LIFE;
      var bx = W * f.x, byy = Math.max(18, deckY * f.y);
      var rise = sec - (f.t - FW_RISE);
      if (rise > 0 && sec < f.t) {
        // 上がっていく光（尾つき）
        var k = rise / FW_RISE, ry = deckY - (deckY - byy) * (1 - (1 - k) * (1 - k));
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = C.moon;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(bx, ry); ctx.lineTo(bx, Math.min(deckY, ry + 22)); ctx.stroke();
      }
      if (q < 0 || q >= 1) return;
      var Rmax = clamp(Math.min(W, deckY) * 0.3, 40, 150) * f.r;
      var ease = function (u) { return 1 - (1 - u) * (1 - u) * (1 - u); };
      var R = Rmax * ease(q), R0 = Rmax * ease(Math.max(0, q - 0.12));
      var fall = q * q * 26, fall0 = Math.max(0, q - 0.12) * Math.max(0, q - 0.12) * 26;
      var fade = q < 0.55 ? 1 : 1 - (q - 0.55) / 0.45;
      // 中心の光る塊（はじめの半分。加算で明るく、白い芯と粒の色のにじみ）
      if (q < 0.5) {
        var u = 1 - q / 0.5;
        var cr = Rmax * (0.2 + q * 0.4);
        var gr = ctx.createRadialGradient(bx, byy, 0, bx, byy, cr);
        gr.addColorStop(0, "rgba(255,255,255," + u.toFixed(3) + ")");
        gr.addColorStop(0.25, "rgba(255,244,190," + (0.9 * u).toFixed(3) + ")");
        gr.addColorStop(0.6, "rgba(255,190,90," + (0.35 * u).toFixed(3) + ")");
        gr.addColorStop(1, "rgba(255,160,60,0)");
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 1;
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(bx, byy, cr, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      // 粒（2色を交互に）：尾は太く、先は明るい
      ctx.lineCap = "round";
      for (var c = 0; c < 2; c++) {
        ctx.globalAlpha = fade;
        ctx.strokeStyle = C[c === 0 ? f.c : f.c2] || C.perfect;
        ctx.lineWidth = Math.max(2.5, 4.2 - q * 2);
        ctx.beginPath();
        for (var m = c; m < FW_N; m += 2) {
          var a = (m / FW_N) * Math.PI * 2 + i * 0.7;
          var ca = Math.cos(a), sa = Math.sin(a);
          ctx.moveTo(bx + ca * R0, byy + sa * R0 + fall0);
          ctx.lineTo(bx + ca * R, byy + sa * R + fall);
        }
        ctx.stroke();
      }
      // 粒の先のきらめき
      ctx.globalAlpha = fade;
      ctx.fillStyle = C.eye;
      var dot = Math.max(1.5, 3 - q * 1.5);
      for (var n = 0; n < FW_N; n += 2) {
        var a2 = (n / FW_N) * Math.PI * 2 + i * 0.7;
        ctx.fillRect(bx + Math.cos(a2) * R - dot / 2, byy + Math.sin(a2) * R + fall - dot / 2, dot, dot);
      }
      ctx.lineCap = "butt";
    }
    function drawClear(fx, deckY, waterY) {
      var sec = Math.max(0, num(fx.sec, 0));
      var still = !!fx.calm || calm;
      if (!still) {
        for (var i = 0; i < FIREWORKS.length; i++) drawShell(FIREWORKS[i], i, sec, deckY);
        ctx.globalAlpha = 1;
      }
      // 蓮の花：池いっぱいに、少しずつ咲く（ステージの枚数だけ。5〜10）
      var count = clamp(Math.round(num(fx.n, LOTUS_MIN)), LOTUS_MIN, LOTUS_MAX);
      var r0 = clamp(W * 0.035, 8, 20) * (count > 7 ? 0.85 : 1);
      for (var j = 0; j < count; j++) {
        var start = still ? 0.1 + j * 0.05 : LOTUS_AT + j * 0.09;
        var g = clamp((sec - start) / 0.5, 0, 1);
        if (g <= 0) continue;
        var e = still ? 1 : 1 - (1 - g) * (1 - g) * (1 - g);
        var lx = W * (j + 0.5) / count + (hash(j + 30) - 0.5) * W * 0.4 / count;
        var ly = waterY + (H - waterY) * (0.3 + 0.45 * hash(j + 60));
        var r = r0 * (0.8 + 0.4 * hash(j + 90)) * e;
        ctx.globalAlpha = still ? g : 1;
        // 浮き葉
        ctx.fillStyle = C.leafDark;
        ctx.beginPath(); ctx.ellipse(lx, ly + r * 0.35, r * 1.5, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
        // 花びら（6枚）
        ctx.fillStyle = C.blush;
        ctx.strokeStyle = C.eye;
        ctx.lineWidth = 1;
        for (var m = 0; m < 6; m++) {
          var pa = -Math.PI / 2 + (m - 2.5) * 0.42;
          ctx.beginPath();
          ctx.ellipse(lx + Math.cos(pa) * r * 0.5, ly + Math.sin(pa) * r * 0.55, r * 0.32, r * 0.62, pa + Math.PI / 2, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = C.perfect;
        ctx.beginPath(); ctx.arc(lx, ly - r * 0.15, r * 0.22, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    /* ---------- 全体 ---------- */
    function draw(view) {
      if (!view || typeof view !== "object") return;
      var t = num(view.t, 0);
      tNow = t;
      var lay = layout(W, H, undefined, undefined, num(view.liftMax, 0));
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
      var baseY = deckY - Math.max(0, br ? num(br.y, 0) : 0) * s;   // 茎の根もとの高さ（高い葉の上）

      var guideX = view.guideTipX === null || view.guideTipX === undefined ? NaN : num(view.guideTipX, NaN);
      if (isFinite(guideX)) drawGuide(baseX, X(guideX), baseY, waterY);

      var gotX = view.flagGotX === null || view.flagGotX === undefined ? NaN : num(view.flagGotX, NaN);
      for (var j = 0; j < pads.length; j++) {
        var p = pads[j];
        var x0 = X(p.x), x1 = X(p.x + p.w);
        if (x1 < -20 || x0 > W + 20) continue;
        var glow = 0;
        if (p === fxPad) glow = calm ? 0.5 * (1 - fxSec / PERFECT_FX_SEC) : Math.max(0, 1 - fxSec / (PERFECT_FX_SEC * 0.6));
        drawPad(p, X, deckY, s, glow, waterY, p.flag && isFinite(gotX) && p.x <= gotX);
      }

      if (fxPad) {
        var fxDeck = deckY - padY(fxPad) * s;
        var g = padGeom(fxPad, X, fxDeck, s);
        drawPerfectFx(g.cx, fxDeck, fxSec, g.rx);
      }

      var ghostX = view.ghostTipX === null || view.ghostTipX === undefined ? NaN : num(view.ghostTipX, NaN);
      if (isFinite(ghostX)) drawGhost(baseX, X(ghostX), deckY - Math.max(0, num(view.ghostTipY, 0)) * s, s, baseY);

      var heroR = clamp(30 * s, 11, 28);

      if (br) {
        var lenPx = clamp(num(br.len, 0), 0, 100000) * s;
        var ang = clamp(num(br.angle, 0), 0, Math.PI);
        drawBridge(baseX, baseY, lenPx, ang, s, !!br.maxed);
      }

      if (hero && isFinite(heroX)) {
        var pose = typeof hero.pose === "string" ? hero.pose : "stand";
        var hy = num(hero.y, 0);
        if (pose === "hop" && calm) hy = Math.min(hy, 0);   // 跳ねる動きは止める
        var footY = deckY - hy * s;
        if (pose === "peek") footY = Math.max(footY, waterY + heroR * 0.3);
        drawHero(X(heroX), footY, heroR, pose, t, waterY);
      }

      if (view.clearFx && typeof view.clearFx === "object") drawClear(view.clearFx, deckY, waterY);

      var skSec = view.skipFx === null || view.skipFx === undefined ? null : num(view.skipFx, null);
      var skX = num(view.skipX, NaN);
      if (skSec !== null && skSec >= 0 && skSec < SKIP_FX_SEC && isFinite(skX)) drawSkipFx(X(skX), deckY, skSec, s, heroR);
      var flSec = view.flagFx === null || view.flagFx === undefined ? null : num(view.flagFx, null);
      var flX = num(view.flagX, NaN);
      if (flSec !== null && flSec >= 0 && flSec < FLAG_FX_SEC && isFinite(flX)) {
        // 旗を取った：「はた！」の字（とばし！ より少し上）
        drawSkipFx(X(flX), deckY - heroR * (skSec !== null && skSec < SKIP_FX_SEC ? 1.4 : 0), flSec, s, heroR, "はた！", C.perfect, FLAG_FX_SEC);
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

  return {
    create: create, layout: layout, COLORS: C, PERFECT_FX_SEC: PERFECT_FX_SEC, SPLASH_SEC: SPLASH_SEC, SKIP_FX_SEC: SKIP_FX_SEC,
    FLAG_FX_SEC: FLAG_FX_SEC, FIREWORKS: FIREWORKS, LOTUS_AT: LOTUS_AT, TOP_GAP: TOP_GAP,
    GHOST_ALPHA: GHOST_ALPHA, GHOST_EDGE_ALPHA: GHOST_EDGE_ALPHA, PERFECT_RING: PERFECT_RING
  };
});
