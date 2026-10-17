/* ゼンマイさんぽ 描画（ZenmaiRender）
 * create(canvas) -> { resize(), draw(stage, view) }
 * view = { dollX, walking, falling, broken, turns, maxTurns, t }
 * 舞台は論理座標 0〜stage.length を横いっぱいに描く。DOM には触れず canvas だけを使う。
 */
(function (root, factory) {
  var v = factory();
  if (typeof module === "object" && module.exports) module.exports = v;
  root.ZenmaiRender = v;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var C = {
    bg: "#1b1f2e", panel: "#252c41", well: "#0d111d", line: "#2f3750",
    ink: "#ece6d6", muted: "#8a91a8", accent: "#f0a43a", accentInk: "#231705",
    ground: "#3a4466", groundTop: "#56638f", void: "#080b14",
    s3: "#f0a43a", s2: "#c98f3f", s1: "#8a6a3a", warn: "#e8604c",
    doll: "#e9d9b0", dollDark: "#b79f6a"
  };

  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }

  function reduced() {
    try { return !!(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) { return false; }
  }

  function create(canvas) {
    var ctx = canvas.getContext("2d");
    var W = 300, H = 180, dpr = 1;
    var calm = reduced();
    var fallT0 = null, breakT0 = null, lastT = 0;
    var geoKey = null, geo = null;

    function resize() {
      var r = canvas.getBoundingClientRect();
      dpr = Math.min(3, Math.max(1, (typeof devicePixelRatio === "number" && devicePixelRatio) || 1));
      W = Math.max(120, Math.round(r.width || canvas.clientWidth || 300));
      H = Math.max(80, Math.round(r.height || canvas.clientHeight || 180));
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      geoKey = null;
    }

    /* 地形の高さ（見た目だけ）。区間の境界ごとに up で上がり down で下がる。 */
    function buildGeo(stage) {
      var len = num(stage.length, 1000);
      var segs = stage.segments || [];
      var pts = [{ x: 0, h: 0 }], h = 0, i;
      for (i = 0; i < segs.length; i++) {
        var s = segs[i];
        var d = (num(s.x1, 0) - num(s.x0, 0));
        if (s.type === "up") h += d * 0.16;
        else if (s.type === "down") h -= d * 0.16;
        pts.push({ x: num(s.x1, 0), h: h });
      }
      if (pts[pts.length - 1].x < len) pts.push({ x: len, h: h });
      var lo = 0, hi = 0;
      for (i = 0; i < pts.length; i++) { lo = Math.min(lo, pts[i].h); hi = Math.max(hi, pts[i].h); }
      var range = hi - lo;
      var maxPx = H * 0.22;
      var scale = range > 0 ? Math.min(1, maxPx / (range * (W / len))) : 1;
      return { pts: pts, lo: lo, scale: scale, len: len };
    }

    function getGeo(stage) {
      var key = stage.id + ":" + W + "x" + H;
      if (key !== geoKey) { geo = buildGeo(stage); geoKey = key; }
      return geo;
    }

    function draw(stage, view) {
      if (!stage || !view) return;
      var g = getGeo(stage);
      var len = g.len;
      var t = num(view.t, 0);
      if (t < lastT - 0.5) { fallT0 = null; breakT0 = null; }
      lastT = t;
      if (view.falling) { if (fallT0 === null) fallT0 = t; } else fallT0 = null;
      if (view.broken) { if (breakT0 === null) breakT0 = t; } else breakT0 = null;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      var padX = Math.max(14, W * 0.04);
      var sx = (W - padX * 2) / len;
      function X(x) { return padX + x * sx; }
      var baseY = H * 0.74;
      var hpx = sx; // 高さ変換は水平と同じ尺度 * scale
      function Y(x) {
        var pts = g.pts, i;
        x = Math.max(0, Math.min(len, x));
        for (i = 1; i < pts.length; i++) {
          if (x <= pts[i].x || i === pts.length - 1) {
            var a = pts[i - 1], b = pts[i];
            var f = b.x > a.x ? (x - a.x) / (b.x - a.x) : 0;
            var hh = a.h + (b.h - a.h) * f;
            return baseY - (hh - g.lo) * hpx * g.scale;
          }
        }
        return baseY;
      }

      var cliffX = num(stage.cliffX, len);

      // 背景
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = C.well; ctx.fillRect(0, 0, W, H * 0.5);
      // 風の筋
      var segs = stage.segments || [], i, s;
      ctx.lineCap = "round";
      for (i = 0; i < segs.length; i++) {
        s = segs[i];
        if (s.type !== "wind" || !s.k) continue;
        var dir = s.k > 0 ? 1 : -1;
        ctx.strokeStyle = "rgba(236,230,214,0.35)"; ctx.fillStyle = "rgba(236,230,214,0.55)";
        ctx.lineWidth = 2;
        var n = Math.max(2, Math.round((s.x1 - s.x0) * sx / 46));
        for (var k = 0; k < n; k++) {
          var fx = s.x0 + (s.x1 - s.x0) * ((k + 0.5) / n);
          var drift = calm ? 0 : ((t * 24 * dir) % 18);
          var px = X(fx) + drift, py = H * (0.22 + 0.09 * (k % 3));
          ctx.beginPath(); ctx.moveTo(px - 11 * dir, py); ctx.lineTo(px + 11 * dir, py); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(px + 11 * dir, py);
          ctx.lineTo(px + 5 * dir, py - 4); ctx.lineTo(px + 5 * dir, py + 4); ctx.closePath(); ctx.fill();
        }
      }

      // 地面（崖まで）
      var step = 4, x;
      ctx.beginPath();
      ctx.moveTo(X(0), H);
      for (x = 0; x <= cliffX; x += step) ctx.lineTo(X(x), Y(x));
      ctx.lineTo(X(cliffX), Y(cliffX));
      ctx.lineTo(X(cliffX), H);
      ctx.closePath();
      ctx.fillStyle = C.ground; ctx.fill();
      ctx.beginPath();
      for (x = 0; x <= cliffX; x += step) { if (x === 0) ctx.moveTo(X(x), Y(x)); else ctx.lineTo(X(x), Y(x)); }
      ctx.lineTo(X(cliffX), Y(cliffX));
      ctx.strokeStyle = C.groundTop; ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.stroke();

      // 地形の目印（形でも区別）：上り＝▲、下り＝▼ を地面の中に
      ctx.font = "700 11px ui-monospace, Menlo, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(236,230,214,0.45)";
      for (i = 0; i < segs.length; i++) {
        s = segs[i];
        if (s.type === "up" || s.type === "down") {
          var mx = (s.x0 + s.x1) / 2;
          if (mx > cliffX) continue;
          ctx.fillText(s.type === "up" ? "▲" : "▼", X(mx), Y(mx) + 18);
        } else if (s.type === "wind" && s.k) {
          var wx = (s.x0 + s.x1) / 2;
          if (wx > cliffX) continue;
          ctx.fillText(s.k > 0 ? "→" : "←", X(wx), Y(wx) + 18);
        }
      }

      // 崖の向こう（奈落）
      var cx = X(cliffX);
      ctx.fillStyle = C.void; ctx.fillRect(cx, Y(cliffX) - 2, W - cx, H);
      ctx.strokeStyle = C.warn; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(cx, Y(cliffX) - 22); ctx.lineTo(cx, Y(cliffX)); ctx.stroke(); ctx.setLineDash([]);
      // 崖の注意：ギザギザ
      ctx.fillStyle = C.warn;
      for (i = 0; i < 3; i++) {
        var zx = cx + 6 + i * 11, zy = H - 4;
        ctx.beginPath(); ctx.moveTo(zx, zy); ctx.lineTo(zx + 5, zy - 9); ctx.lineTo(zx + 10, zy); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = C.warn; ctx.font = "700 11px ui-monospace, Menlo, monospace";
      ctx.textAlign = "left"; ctx.fillText("がけ", Math.min(cx + 4, W - 30), Y(cliffX) - 30);

      // 目標の帯（★の範囲）
      var tg = stage.target || { x: 0, w: 0 };
      var half = tg.w / 2, c = tg.x + half;
      function band(frac, color) {
        var x0 = c - half * frac, x1 = c + half * frac;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(X(x0), Y(x0) + 2);
        for (var xx = x0; xx <= x1; xx += 4) ctx.lineTo(X(xx), Y(xx) + 2);
        ctx.lineTo(X(x1), Y(x1) + 2);
        for (xx = x1; xx >= x0; xx -= 4) ctx.lineTo(X(xx), Y(xx) + 12);
        ctx.lineTo(X(x0), Y(x0) + 12); ctx.closePath(); ctx.fill();
      }
      band(1, "rgba(138,106,58,0.9)");
      band(0.6, "rgba(201,143,63,0.95)");
      band(0.25, C.s3);
      // 旗と中心線
      var fy = Y(c);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(c), fy); ctx.lineTo(X(c), fy - 34); ctx.stroke();
      ctx.fillStyle = C.accent;
      ctx.beginPath(); ctx.moveTo(X(c), fy - 34); ctx.lineTo(X(c) + 14, fy - 28); ctx.lineTo(X(c), fy - 22); ctx.closePath(); ctx.fill();
      // ★の範囲ラベル
      ctx.font = "700 10px ui-monospace, Menlo, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = C.accentInk;
      ctx.fillText("★", X(c), fy + 11);
      ctx.fillStyle = C.ink;
      var yb = fy + 25;
      if (yb < H - 4) {
        ctx.fillText("★★", X(c - half * 0.8), yb - 0);
        ctx.fillText("★★", X(c + half * 0.8), yb - 0);
      }

      // 人形
      var dx = num(view.dollX, 0);
      var dyG = Y(dx);
      var ang = 0, yoff = 0, xoff = 0, alpha = 1;
      if (view.falling && fallT0 !== null) {
        var ft = Math.max(0, t - fallT0);
        if (calm) { yoff = Math.min(H, ft * 160); alpha = Math.max(0.2, 1 - ft); }
        else { yoff = 220 * ft * ft + 20 * ft; ang = ft * 4.2; xoff = ft * 14; }
        dyG = Y(Math.min(dx, cliffX));
        if (dx > cliffX) dyG = Y(cliffX);
      }
      var u = Math.max(0.7, Math.min(1.3, W / 360)) * 1.0;
      var walk = view.walking && !view.falling && !view.broken;
      var ph = calm ? 0 : t * 9;
      var bob = walk && !calm ? Math.abs(Math.sin(ph)) * 2 * u : 0;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(X(dx) + xoff, dyG + yoff);
      ctx.rotate(ang);
      ctx.translate(0, -bob);
      // 足
      var sw = walk ? Math.sin(ph) * 5 * u : 0;
      ctx.strokeStyle = C.dollDark; ctx.lineWidth = 4 * u; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-4 * u, -9 * u); ctx.lineTo(-4 * u + sw, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(4 * u, -9 * u); ctx.lineTo(4 * u - sw, 0); ctx.stroke();
      // 胴
      ctx.fillStyle = C.doll; ctx.strokeStyle = C.dollDark; ctx.lineWidth = 2;
      ctx.beginPath(); roundRect(-11 * u, -30 * u, 22 * u, 22 * u, 5 * u); ctx.fill(); ctx.stroke();
      // 頭
      ctx.beginPath(); ctx.arc(0, -37 * u, 8 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // 目（向きは右）
      ctx.fillStyle = C.accentInk; ctx.strokeStyle = C.accentInk; ctx.lineWidth = 1.6;
      if (view.broken) {
        ctx.beginPath(); ctx.moveTo(1 * u, -40 * u); ctx.lineTo(5 * u, -36 * u);
        ctx.moveTo(5 * u, -40 * u); ctx.lineTo(1 * u, -36 * u); ctx.stroke();
      } else if (view.falling) {
        ctx.beginPath(); ctx.arc(3 * u, -38 * u, 2.4 * u, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(3 * u, -38 * u, 1.8 * u, 0, Math.PI * 2); ctx.fill();
      }
      // 背中のゼンマイ（巻き量で回る）
      var turns = num(view.turns, 0), mt = Math.max(1, num(view.maxTurns, 8));
      var keyA = turns * Math.PI * 2 * (walk ? 1 - Math.min(1, 0) : 1);
      if (walk && !calm) keyA = -t * 3;
      ctx.save();
      ctx.translate(-13 * u, -20 * u); ctx.rotate(keyA);
      ctx.strokeStyle = C.accent; ctx.lineWidth = 3 * u;
      ctx.beginPath(); ctx.moveTo(-7 * u, 0); ctx.lineTo(7 * u, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(-7 * u, 0, 3 * u, 0, Math.PI * 2); ctx.arc(7 * u, 0, 3 * u, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      ctx.restore();

      // 切れたバネ
      if (view.broken && breakT0 !== null) {
        var bt = Math.max(0, t - breakT0);
        var by = dyG - 22 * u, bx = X(dx) - 13 * u;
        var rise = calm ? 0 : Math.min(1, bt * 2);
        ctx.strokeStyle = C.warn; ctx.lineWidth = 2.5; ctx.lineJoin = "round";
        ctx.beginPath();
        var py0 = by - rise * 26 * u + (calm ? -12 * u : 0);
        ctx.moveTo(bx - 8 * u, py0);
        for (var q = 0; q < 6; q++) ctx.lineTo(bx + (q % 2 ? 8 : -8) * u, py0 - q * 3.5 * u);
        ctx.stroke();
        ctx.fillStyle = C.warn; ctx.font = "700 12px ui-monospace, Menlo, monospace";
        ctx.textAlign = "center"; ctx.fillText("ぷつん!", bx + 6 * u, py0 - 26 * u);
      }

      // 巻き量の細いゲージ（上部）。限界が近いと色と形（!）で知らせる
      var ratio = Math.max(0, Math.min(1.2, Math.abs(turns) / mt));
      var gx = padX, gy = 8, gw = W - padX * 2, gh = 6;
      ctx.fillStyle = C.panel; ctx.fillRect(gx, gy, gw, gh);
      var near = ratio > 0.8;
      ctx.fillStyle = near ? C.warn : C.accent;
      ctx.fillRect(gx, gy, gw * Math.min(1, ratio), gh);
      if (near) {
        ctx.fillStyle = C.warn; ctx.font = "700 11px ui-monospace, Menlo, monospace";
        ctx.textAlign = "right"; ctx.textBaseline = "top";
        ctx.fillText("! そろそろ限界", W - padX, gy + gh + 3);
        ctx.textBaseline = "alphabetic";
      }
    }

    function roundRect(x, y, w, h, r) {
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    resize();
    return { resize: resize, draw: draw };
  }

  return { create: create };
});
