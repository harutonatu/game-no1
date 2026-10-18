/*
 * ピカッと早押し — 入力（四隅のボタンの pointerdown でタップを検知）
 *
 * PikattoInput.attach(root, { onPress, onCornerDown, onCornerUp }) → { detach() }
 *   - root 直下の .corner[data-player] 要素への pointerdown で onPress({ playerIdx, pressedAt }) を呼ぶ。
 *   - playerIdx は data-player（1..4）を 0-based に変換したもの。
 *   - pressedAt は event.timeStamp を優先し、無ければ performance.now()。
 *   - 同じボタンへの連打は、そのボタンの pointerup（または pointercancel/leave）が来るまで無視。
 *   - 複数の指が同時に別のボタンへ触れたら、それぞれ独立に onPress を呼ぶ（押下順はタイムスタンプで分かる）。
 *   - pointercancel で、そのボタンの押しっぱなしフラグをリセット（指を離さず OS に奪われた場合でも次回押せる）。
 *   - iPadOS の4本指ジェスチャー対策として root 全面に touch-action: none を敷き、
 *     touchstart/touchmove/touchend/dblclick/contextmenu/selectstart/gesturestart/dragstart を preventDefault。
 *
 * PikattoInput.createCore({ onPress, onCornerDown, onCornerUp }) → { down(playerIdx, ts), up(playerIdx) }
 *   - DOM に依存しない核。テストで直接使う。
 *   - down(idx, ts)：そのボタンが押下中でなければ onPress を呼び、押下フラグを立てる。
 *   - up(idx)：押下フラグを下ろす。
 *
 * UMD: ブラウザでは window.PikattoInput、Node では module.exports と globalThis.PikattoInput。
 */
(function (root) {
  "use strict";

  function safe(fn, arg) {
    if (typeof fn !== "function") return;
    try { fn(arg); } catch (e) { if (typeof console !== "undefined") console.error(e); }
  }

  /*
   * DOM に依存しない核。playerIdx ごとに「押しっぱなしフラグ」を持ち、
   * フラグが立っている間は再度の down を無視する。up/cancel で下ろす。
   */
  function createCore(cbs) {
    cbs = cbs || {};
    const held = new Set();  // 現在押下中の playerIdx

    function down(playerIdx, ts) {
      const idx = playerIdx | 0;
      if (held.has(idx)) return;             // 連打は、上がる前の2回目を無視
      held.add(idx);
      const pressedAt = (typeof ts === "number" && isFinite(ts)) ? ts
        : (root.performance && typeof root.performance.now === "function") ? root.performance.now()
        : Date.now();
      safe(cbs.onCornerDown, { playerIdx: idx, pressedAt });
      safe(cbs.onPress, { playerIdx: idx, pressedAt });
    }

    function up(playerIdx) {
      const idx = playerIdx | 0;
      if (!held.has(idx)) return;
      held.delete(idx);
      safe(cbs.onCornerUp, { playerIdx: idx });
    }

    function reset() { held.clear(); }

    return { down, up, reset, get held() { return new Set(held); } };
  }

  function attach(rootEl, cbs) {
    if (!rootEl || typeof rootEl.addEventListener !== "function") {
      throw new Error("PikattoInput.attach: root 要素が必要です");
    }
    const core = createCore(cbs);
    // pointerId → playerIdx （どの指がどのボタンを押しているか）
    const pointerToPlayer = new Map();

    const prevTouchAction = rootEl.style.touchAction;
    const prevUserSelect = rootEl.style.webkitUserSelect;
    rootEl.style.touchAction = "none";
    rootEl.style.webkitUserSelect = "none";
    rootEl.style.userSelect = "none";
    rootEl.style.webkitTouchCallout = "none";

    function cornerFromEvent(e) {
      const t = e.target;
      if (!t || typeof t.closest !== "function") return null;
      const el = t.closest(".corner[data-player]");
      if (!el || !rootEl.contains(el)) return null;
      const n = parseInt(el.dataset ? el.dataset.player : el.getAttribute("data-player"), 10);
      if (!Number.isFinite(n) || n < 1) return null;
      return { el, playerIdx: n - 1 };
    }

    function tsOf(e) {
      if (e && typeof e.timeStamp === "number" && isFinite(e.timeStamp)) return e.timeStamp;
      if (root.performance && typeof root.performance.now === "function") return root.performance.now();
      return Date.now();
    }

    function capture(el, id) { try { el.setPointerCapture(id); } catch (e) { /* 無視 */ } }
    function release(el, id) { try { el.releasePointerCapture(id); } catch (e) { /* 無視 */ } }

    function onDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const hit = cornerFromEvent(e);
      if (!hit) return;
      if (e.cancelable) e.preventDefault();
      capture(hit.el, e.pointerId);
      pointerToPlayer.set(e.pointerId, hit.playerIdx);
      core.down(hit.playerIdx, tsOf(e));
    }

    function onUp(e) {
      const idx = pointerToPlayer.get(e.pointerId);
      if (idx === undefined) return;
      pointerToPlayer.delete(e.pointerId);
      const hit = cornerFromEvent(e);
      if (hit && hit.el) release(hit.el, e.pointerId);
      core.up(idx);
    }

    function onCancel(e) {
      const idx = pointerToPlayer.get(e.pointerId);
      if (idx === undefined) return;
      pointerToPlayer.delete(e.pointerId);
      core.up(idx);
    }

    function stopTouch(e) { if (e.cancelable) e.preventDefault(); }

    const handlers = [
      ["pointerdown", onDown],
      ["pointerup", onUp],
      ["pointercancel", onCancel],
      ["lostpointercapture", onCancel],
      ["touchstart", stopTouch],
      ["touchmove", stopTouch],
      ["touchend", stopTouch],
      ["dblclick", stopTouch],
      ["contextmenu", stopTouch],
      ["selectstart", stopTouch],
      ["gesturestart", stopTouch],
      ["dragstart", stopTouch]
    ];
    for (const [t, h] of handlers) rootEl.addEventListener(t, h, { passive: false });

    return {
      detach() {
        for (const [t, h] of handlers) rootEl.removeEventListener(t, h);
        pointerToPlayer.clear();
        core.reset();
        rootEl.style.touchAction = prevTouchAction;
        rootEl.style.webkitUserSelect = prevUserSelect;
      }
    };
  }

  const api = { attach, createCore };
  root.PikattoInput = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
