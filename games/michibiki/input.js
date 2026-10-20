/*
 * ミチビキ空港 — なぞる操作とキーボード
 * 契約：docs/michibiki-contract.md §5（入力の API）
 * 担当B（画面）だけが編集する。
 *
 * MichibikiInput.attach(canvas, handlers) → detach()
 *   handlers = { toField, onStart, onMove, onEnd, onCancel, onCommand, isCardOpen? }
 * - pointerdown：onStart(pointerId, [x, y]) が true なら、その指は「なぞり」。false でも指は追いかけ、
 *   離したときに onEnd(..., { tap, drawing: false }) を送る（滑走路・空いた所のタップのため。§5.3）
 * - 同時に3本の指まで（4本目以降は無視。iPad の多本指ジェスチャーと干渉しない）
 * - tap：動いた距離が 10px 未満で 300ms 以内
 * - ダブルタップ拡大の抑止：canvas は touch-action:none と touchstart/touchend の preventDefault。
 *   ボタンの所（.head-tools・.card）は、350ms 以内の2回目のタップの touchend を止めて click を自分で送る
 * - キーボード（§5.4）：← →（選ぶ。Tab は止めず、ふつうにボタンへ移る。§19 A8）、1 2 3（その色へおまかせ）、Enter（自分の色へ）、P・Esc（一時停止）、M（音）、?（遊び方）
 */
(function (root) {
  "use strict";

  const MAX_POINTERS = 3;
  const TAP_PX = 10;
  const TAP_MS = 300;

  function attach(canvas, h) {
    if (!canvas || !h || typeof h.toField !== "function") return () => {};
    const doc = canvas.ownerDocument || root.document;
    const offs = [];
    const on = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); offs.push(() => t.removeEventListener(type, fn, opt)); };
    const call = (fn, ...a) => { if (typeof fn !== "function") return undefined; try { return fn(...a); } catch (e) { console.error("ミチビキ空港(input):", e); return undefined; } };
    const nowMs = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());
    const cardOpen = () => !!call(h.isCardOpen);

    // pointerId → { sx, sy, t, moved, drawing }
    const ptrs = new Map();
    const field = (e) => call(h.toField, e.clientX, e.clientY) || [0, 0];

    function onDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (ptrs.has(e.pointerId)) return;
      if (ptrs.size >= MAX_POINTERS) return;          // 4本目以降は無視
      if (cardOpen()) return;
      if (e.cancelable) e.preventDefault();
      const p = { sx: e.clientX, sy: e.clientY, t: nowMs(), moved: 0, drawing: false };
      ptrs.set(e.pointerId, p);
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
      p.drawing = !!call(h.onStart, e.pointerId, field(e));
    }
    function onMoveEv(e) {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      if (e.cancelable) e.preventDefault();
      const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : null;
      const evs = list && list.length ? list : [e];
      for (const ev of evs) {
        p.moved = Math.max(p.moved, Math.hypot(ev.clientX - p.sx, ev.clientY - p.sy));
        if (p.drawing) call(h.onMove, e.pointerId, field(ev));
      }
    }
    function onUp(e) {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      ptrs.delete(e.pointerId);
      if (e.cancelable) e.preventDefault();
      p.moved = Math.max(p.moved, Math.hypot(e.clientX - p.sx, e.clientY - p.sy));
      const tap = p.moved < TAP_PX && nowMs() - p.t <= TAP_MS;
      call(h.onEnd, e.pointerId, field(e), { tap, drawing: p.drawing });
    }
    function onCancelEv(e) {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      ptrs.delete(e.pointerId);
      if (p.drawing) call(h.onCancel, e.pointerId);
    }
    on(canvas, "pointerdown", onDown, { passive: false });
    on(canvas, "pointermove", onMoveEv, { passive: false });
    on(canvas, "pointerup", onUp, { passive: false });
    on(canvas, "pointercancel", onCancelEv);
    on(canvas, "lostpointercapture", (e) => { if (ptrs.has(e.pointerId)) onCancelEv(e); });

    // ---- 拡大・スクロール・長押しメニューを止める（場） ----
    const stop = (e) => { if (e.cancelable) e.preventDefault(); };
    on(canvas, "touchstart", stop, { passive: false });
    on(canvas, "touchmove", stop, { passive: false });
    on(canvas, "touchend", stop, { passive: false });
    on(canvas, "dblclick", stop, { passive: false });
    on(canvas, "contextmenu", stop);
    const area = canvas.parentElement;
    if (area) {
      on(area, "touchmove", stop, { passive: false });
      on(area, "touchend", (e) => { if (e.target === area) stop(e); }, { passive: false });
    }

    // ---- ダブルタップ拡大の抑止（ボタンの所） ----
    let lastTapEnd = 0, tapStart = null, synth = false;
    function onTouchStart(e) {
      const t = e.touches && e.touches[0];
      tapStart = e.touches && e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
    }
    function onTouchEnd(e) {
      const t = e.changedTouches && e.changedTouches[0];
      const isTap = !!(tapStart && t && e.touches.length === 0 && Math.hypot(t.clientX - tapStart.x, t.clientY - tapStart.y) < 14);
      const tNow = nowMs();
      const quick = isTap && tNow - lastTapEnd < 350;
      if (isTap) lastTapEnd = tNow;
      if (!e.cancelable || !quick) return;
      e.preventDefault();   // 2回目の click は送られないので、ボタンなら自分で押す
      const btn = e.target && e.target.closest ? e.target.closest("button") : null;
      if (btn && !btn.disabled && !synth) {
        synth = true;
        try { btn.click(); } finally { synth = false; }
      }
    }
    const zones = doc && doc.querySelectorAll ? Array.from(doc.querySelectorAll(".head-tools, .stats, .card, .hint")) : [];
    for (const z of zones) {
      on(z, "touchstart", onTouchStart, { passive: true });
      on(z, "touchend", onTouchEnd, { passive: false });
      on(z, "dblclick", stop, { passive: false });
    }
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) on(doc, type, stop, { passive: false });

    // ---- キーボード ----
    on(doc, "keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target && e.target.tagName ? String(e.target.tagName).toUpperCase() : "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) return;
      const k = e.key;
      const onControl = tag === "BUTTON" || tag === "A";
      const card = cardOpen();
      let cmd = null;
      if (k === "Escape" || k === "Esc") cmd = "esc";
      else if (k === "p" || k === "P") cmd = "pause";
      else if (k === "m" || k === "M") cmd = "sound";
      else if (k === "?" || (k === "/" && e.shiftKey)) cmd = "help";
      else if (!card) {
        // 場の操作（カードが開いているときはしない。Tab は横取りしない・Enter はボタンの上ではボタンに任せる）
        if (k === "ArrowRight") cmd = "next";
        else if (k === "ArrowLeft") cmd = "prev";
        else if (k === "1" || k === "2" || k === "3") cmd = "guide" + (Number(k) - 1);
        else if (k === "Enter" && !onControl) cmd = "guideOwn";
      }
      if (!cmd) return;
      e.preventDefault();
      call(h.onCommand, cmd);
    });

    return function detach() {
      offs.splice(0).forEach((f) => { try { f(); } catch (e) { /* 無視 */ } });
      ptrs.clear();
    };
  }

  root.MichibikiInput = Object.freeze({ attach, MAX_POINTERS, TAP_PX, TAP_MS });
})(typeof window !== "undefined" ? window : globalThis);
