/*
 * ぼくのまち — 指のさわり方（1 本指・2 本指の見分け、タップ・なぞる・つまむ）
 * 約束：docs/machi-contract.md §7.2、計画書 docs/plans/machi.md §4.3。担当B だけが編集する。
 *
 * const detach = MachiInput.attach(canvas, {
 *   hasTool: () => bool,              // 道具を選んでいるか（指を置いた時に聞く）
 *   canPaint: () => bool,             // 追加（無くてよい）：なぞって置けるか。false なら道具を選んでいても 1 本指で地図を動かし、
 *                                     //   タップは onTap（main が「1 マスが 14px より小さい → 置かずに寄る」を決める。MachiRender.MIN_PAINT_CELL）
 *   onTap(px, py), onPaintStart(px, py), onPaintMove(px, py), onPaintEnd(px, py), onPaintCancel(),
 *   onPan(dx, dy), onPinch(f, cx, cy)
 * });
 * - 座標は canvas の左上からの css px
 * - 1 本指：hasTool() が真（かつ canPaint() が偽でない）ならなぞる＝paint、偽なら pan。動きが 8px 未満で離したらタップ
 * - 2 本指：pan と pinch（paint 中に 2 本目が来たら onPaintCancel）。2 本目を離したあと残った指は pan だけ（置かない）
 * - マウスのホイール・トラックパッドのつまみは onPinch。iOS の gesturestart は止める（ページが拡大しない）
 */
(function (root) {
  "use strict";

  const TAP_PX = 8;

  function attach(el, h) {
    h = h || {};
    const call = (name, ...a) => { const f = h[name]; if (typeof f === "function") { try { f(...a); } catch (e) { if (root.console) console.error(e); } } };
    const pts = new Map(); // pointerId -> { x, y, sx, sy }
    let mode = "none";     // none | pending | paint | pan | multi | dead
    let paintable = false;
    let last2 = null;

    const pos = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    function two() {
      const it = pts.values(); const a = it.next().value, b = it.next().value;
      return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
    }

    function down(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.cancelable) e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* 古い端末 */ }
      const p = pos(e);
      pts.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y });
      if (pts.size === 1) {
        mode = "pending";
        let ht = false, cp = true;
        try { ht = !!(h.hasTool && h.hasTool()); } catch (_) { ht = false; }
        try { if (typeof h.canPaint === "function") cp = !!h.canPaint(); } catch (_) { cp = true; }
        paintable = ht && cp;
      } else if (pts.size === 2) {
        if (mode === "paint") call("onPaintCancel");
        mode = "multi";
        last2 = two();
      }
      // 3 本目からは数に入れるが動きには使わない
    }
    function move(e) {
      const q = pts.get(e.pointerId);
      if (!q) return;
      if (e.cancelable) e.preventDefault();
      const p = pos(e);
      const dx = p.x - q.x, dy = p.y - q.y;
      q.x = p.x; q.y = p.y;
      if (mode === "pending") {
        if (Math.hypot(q.x - q.sx, q.y - q.sy) >= TAP_PX) {
          if (paintable) { mode = "paint"; call("onPaintStart", q.sx, q.sy); call("onPaintMove", q.x, q.y); }
          else { mode = "pan"; call("onPan", q.x - q.sx, q.y - q.sy); }
        }
      } else if (mode === "paint") call("onPaintMove", q.x, q.y);
      else if (mode === "pan") call("onPan", dx, dy);
      else if (mode === "multi" && pts.size >= 2) {
        const t = two();
        if (last2) {
          call("onPan", t.cx - last2.cx, t.cy - last2.cy);
          if (last2.d > 4 && t.d > 4) { const f = t.d / last2.d; if (f !== 1) call("onPinch", f, t.cx, t.cy); }
        }
        last2 = t;
      }
    }
    function up(e, cancel) {
      const q = pts.get(e.pointerId);
      if (!q) return;
      pts.delete(e.pointerId);
      try { el.releasePointerCapture(e.pointerId); } catch (_) { /* なし */ }
      if (mode === "pending") {
        mode = "none";
        if (!cancel) call("onTap", q.x, q.y);
      } else if (mode === "paint") {
        mode = "none";
        if (cancel) call("onPaintCancel"); else call("onPaintEnd", q.x, q.y);
      } else if (mode === "pan") {
        mode = pts.size ? "pan" : "none";
      } else if (mode === "multi") {
        if (pts.size >= 2) last2 = two();
        else if (pts.size === 1) { mode = "pan"; last2 = null; }
        else mode = "none";
      }
      if (!pts.size) { mode = "none"; last2 = null; }
    }
    const onDown = (e) => down(e);
    const onMove = (e) => move(e);
    const onUp = (e) => up(e, false);
    const onCancel = (e) => up(e, true);
    const onWheel = (e) => {
      if (e.cancelable) e.preventDefault();
      const p = pos(e);
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 300;
      const f = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0025));
      if (f !== 1) call("onPinch", Math.max(0.5, Math.min(2, f)), p.x, p.y);
    };
    const stop = (e) => { if (e.cancelable) e.preventDefault(); };

    el.style.touchAction = "none";
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    el.addEventListener("lostpointercapture", onCancel);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", stop);
    el.addEventListener("gesturechange", stop);
    el.addEventListener("contextmenu", stop);

    return function detach() {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("lostpointercapture", onCancel);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", stop);
      el.removeEventListener("gesturechange", stop);
      el.removeEventListener("contextmenu", stop);
      if (mode === "paint") call("onPaintCancel");
      pts.clear(); mode = "none";
    };
  }

  root.MachiInput = { attach, TAP_PX };
})(typeof window !== "undefined" ? window : globalThis);
