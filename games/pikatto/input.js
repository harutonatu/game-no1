/*
 * ピカッと早押し — 入力（四隅のボタンへの pointerdown / キー操作でタップを検知）
 *
 * PikattoInput.attach(root, { onPress, onCornerDown, onCornerUp }, opts?) → { detach(), reset() }
 *   - root の中の .corner[data-player]（hidden でないもの）への pointerdown で押下を受け付ける。
 *   - playerIdx は data-player（1..4）を 0-based に変換したもの。
 *   - pressedAt は normalizeTs(event.timeStamp)（使えなければ performance.now()）。
 *   - 受付の窓（PK-09）：最初の押下から windowMs（既定 30ms）の間に届いた押下をまとめ、
 *     pressedAt の早い順（同じ時刻は届いた順）に onPress を呼ぶ。
 *   - 押しっぱなし（PK-23）：ボタンごと × pointerId ごとに数える。ボタンに押したままの指が
 *     1本でもあれば、そのボタンへの新しい押下は無視する。
 *   - キー操作（PK-06）：.corner で Enter / Space の keydown → 押下（repeat は無視）、keyup → 離す。
 *   - 支援技術の click（detail === 0、VoiceOver・スイッチコントロール）→ 押してすぐ離す。
 *   - pointercancel：その pointerId の押しっぱなしだけ消す。すでに届いた押下は有効のまま。
 *   - detach()：リスナーを外し、窓を捨て、root の style を attach 前の値に戻す。
 *   - reset()：押しっぱなしと窓に溜まった押下を捨てる（onPress は呼ばない）。
 *   - discard()：窓に溜まった押下だけを捨てる（押しっぱなしは残す。よーいの終わりに使う）。
 *
 * PikattoInput.createCore(cbs, opts?) → { down, up, cancel, flush, reset, discard, held }
 *   - DOM に依存しない核。テスト（Node）で直接使う。
 *   - opts: { windowMs = 30, setTimer = setTimeout, clearTimer = clearTimeout }
 *
 * PikattoInput.normalizeTs(ts, timeOrigin?) → number（PK-22）
 * PikattoInput.keyAction(e) → 'down' | 'up' | null（PK-06）
 *
 * UMD: ブラウザでは window.PikattoInput、Node では module.exports と globalThis.PikattoInput。
 */
(function (root) {
  "use strict";

  const DEFAULT_WINDOW_MS = 30;
  const EPOCH_THRESHOLD = 1e11;           // これより大きい timeStamp は 1970年起点の ms とみなす
  const KEY_POINTER_ID = "key";
  const CLICK_POINTER_ID = "click";
  const ACTION_KEYS = ["Enter", " ", "Spacebar"];

  function safe(fn, arg) {
    if (typeof fn !== "function") return;
    try { fn(arg); } catch (e) {
      if (typeof console !== "undefined") console.error("PikattoInput: コールバックでエラー", e);
    }
  }

  function perfNow() {
    if (root.performance && typeof root.performance.now === "function") return root.performance.now();
    return Date.now();
  }

  /* 純粋関数：古い Safari の 1970年起点の timeStamp を、performance.now() と同じ基準に直す（PK-22） */
  function normalizeTs(ts, timeOrigin) {
    if (typeof ts !== "number" || !isFinite(ts)) return perfNow();
    if (ts <= EPOCH_THRESHOLD) return ts;
    const origin = (typeof timeOrigin === "number" && isFinite(timeOrigin)) ? timeOrigin
      : (root.performance && typeof root.performance.timeOrigin === "number" && isFinite(root.performance.timeOrigin))
        ? root.performance.timeOrigin
        : null;
    return origin === null ? perfNow() : ts - origin;
  }

  /* 純粋関数：キーイベントを 'down' / 'up' / null に（PK-06） */
  function keyAction(e) {
    if (!e || ACTION_KEYS.indexOf(e.key) < 0) return null;
    if (e.type === "keydown") return e.repeat ? null : "down";
    if (e.type === "keyup") return "up";
    return null;
  }

  /*
   * DOM に依存しない核。
   *   heldBy: playerIdx → Set(pointerId)（そのボタンを押したままの指）
   *   pending: 窓に溜まった押下 [{ playerIdx, pressedAt, seq }]
   */
  function createCore(cbs, opts) {
    cbs = cbs || {};
    opts = opts || {};
    const windowMs = opts.windowMs === undefined ? DEFAULT_WINDOW_MS : opts.windowMs;
    if (typeof windowMs !== "number" || !isFinite(windowMs) || windowMs < 0) {
      throw new Error("PikattoInput.createCore: windowMs は 0 以上の数で指定してください（" + windowMs + "）");
    }
    const setTimer = opts.setTimer || root.setTimeout.bind(root);
    const clearTimer = opts.clearTimer || root.clearTimeout.bind(root);

    const heldBy = new Map();
    let pending = [];
    let timer = null;
    let seq = 0;

    function idOf(playerIdx, pointerId) {
      return pointerId === undefined || pointerId === null ? "p" + playerIdx : pointerId;
    }

    function stopTimer() {
      if (timer !== null) { clearTimer(timer); timer = null; }
    }

    function flush() {
      stopTimer();
      if (pending.length === 0) return;
      const batch = pending.slice().sort((a, b) => (a.pressedAt - b.pressedAt) || (a.seq - b.seq));
      pending = [];                       // コールバックの中で down / reset されても壊れないよう先に空にする
      for (const p of batch) safe(cbs.onPress, { playerIdx: p.playerIdx, pressedAt: p.pressedAt });
    }

    function down(playerIdx, ts, pointerId) {
      const idx = playerIdx | 0;
      const set = heldBy.get(idx);
      if (set && set.size > 0) return;    // 押したままの指があるボタンには入れない（連打・2本指）
      heldBy.set(idx, new Set([idOf(idx, pointerId)]));
      const pressedAt = (typeof ts === "number" && isFinite(ts)) ? ts : perfNow();
      safe(cbs.onCornerDown, { playerIdx: idx, pressedAt });
      pending.push({ playerIdx: idx, pressedAt, seq: seq++ });
      if (windowMs === 0) { flush(); return; }
      if (timer === null) timer = setTimer(flush, windowMs);
    }

    function release(idx) {
      heldBy.delete(idx);
      safe(cbs.onCornerUp, { playerIdx: idx });
    }

    // pointerId を省略したときは、そのボタンの押しっぱなしをすべて下ろす
    function up(playerIdx, pointerId) {
      const idx = playerIdx | 0;
      const set = heldBy.get(idx);
      if (!set) return;
      if (pointerId === undefined || pointerId === null) { release(idx); return; }
      if (!set.delete(pointerId)) return;
      if (set.size === 0) release(idx);
    }

    // その pointerId の押しっぱなしだけ消す。窓の中の押下は残す。省略時はすべての押しっぱなしを消す
    function cancel(pointerId) {
      for (const [idx, set] of Array.from(heldBy.entries())) {
        if (pointerId === undefined || pointerId === null) { release(idx); continue; }
        if (set.delete(pointerId) && set.size === 0) release(idx);
      }
    }

    function reset() {
      stopTimer();
      pending = [];
      heldBy.clear();
    }

    // 窓に溜まった押下だけを捨てる（押しっぱなしは残すので、離したときの onCornerUp は届く）
    function discard() {
      stopTimer();
      pending = [];
    }

    return {
      down, up, cancel, flush, reset, discard,
      get held() { return new Set(Array.from(heldBy.keys())); }
    };
  }

  function attach(rootEl, cbs, opts) {
    if (!rootEl || typeof rootEl.addEventListener !== "function") {
      throw new Error("PikattoInput.attach: root 要素が必要です");
    }
    const core = createCore(cbs, opts);
    const pointerToCorner = new Map();    // pointerId → 要素（capture を外すため）

    const STYLE_KEYS = ["touchAction", "userSelect", "webkitUserSelect", "webkitTouchCallout"];
    const prevStyle = {};
    // 先に全部を保存してから設定する（Chromium では userSelect と webkitUserSelect が別名で、
    // 交互にすると片方の元の値として "none" が保存されてしまうため）
    for (const k of STYLE_KEYS) prevStyle[k] = rootEl.style[k];
    for (const k of STYLE_KEYS) rootEl.style[k] = "none";

    function cornerFromEvent(e) {
      const t = e.target;
      if (!t || typeof t.closest !== "function") return null;
      const el = t.closest(".corner[data-player]");
      if (!el || !rootEl.contains(el)) return null;
      if (el.hidden || (typeof el.closest === "function" && el.closest("[hidden]"))) return null;
      const n = parseInt(el.dataset ? el.dataset.player : el.getAttribute("data-player"), 10);
      if (!Number.isFinite(n) || n < 1) return null;
      return { el, playerIdx: n - 1 };
    }

    function capture(el, id) { try { el.setPointerCapture(id); } catch (e) { /* capture できない環境では何もしない */ } }
    function releaseCapture(el, id) { try { el.releasePointerCapture(id); } catch (e) { /* すでに外れている */ } }

    function onDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const hit = cornerFromEvent(e);
      if (!hit) return;
      if (e.cancelable) e.preventDefault();
      capture(hit.el, e.pointerId);
      pointerToCorner.set(e.pointerId, hit);
      core.down(hit.playerIdx, normalizeTs(e.timeStamp), e.pointerId);
    }

    function onUp(e) {
      const hit = pointerToCorner.get(e.pointerId);
      if (!hit) return;
      pointerToCorner.delete(e.pointerId);
      releaseCapture(hit.el, e.pointerId);
      core.up(hit.playerIdx, e.pointerId);
    }

    // pointercancel / lostpointercapture：押しっぱなしだけ消す（届いた押下は有効のまま）
    function onCancel(e) {
      if (!pointerToCorner.has(e.pointerId)) return;
      pointerToCorner.delete(e.pointerId);
      core.cancel(e.pointerId);
    }

    function onKey(e) {
      const act = keyAction(e);
      if (ACTION_KEYS.indexOf(e.key) < 0) return;
      const hit = cornerFromEvent(e);
      if (!hit) return;
      if (e.cancelable) e.preventDefault();  // Space のスクロール・click の二重発火を止める（repeat も含む）
      if (act === "down") core.down(hit.playerIdx, normalizeTs(e.timeStamp), KEY_POINTER_ID);
      else if (act === "up") core.up(hit.playerIdx, KEY_POINTER_ID);
    }

    // 支援技術（VoiceOver の二重タップ・スイッチコントロールなど）は pointerdown を出さず、
    // 合成の click（detail === 0）だけを送ることがある。そのときは押して すぐ離したことにする。
    // 本物のタップの click は detail >= 1、キーボードは keydown/keyup の preventDefault で click が出ないので二重にならない
    function onClick(e) {
      if (e.detail !== 0) return;
      const hit = cornerFromEvent(e);
      if (!hit) return;
      if (e.cancelable) e.preventDefault();
      core.down(hit.playerIdx, normalizeTs(e.timeStamp), CLICK_POINTER_ID);
      core.up(hit.playerIdx, CLICK_POINTER_ID);
    }

    // キーを押したままフォーカスが外れたら、押しっぱなしを消す
    function onFocusOut() { core.cancel(KEY_POINTER_ID); }

    function stopTouch(e) { if (e.cancelable) e.preventDefault(); }

    const handlers = [
      ["pointerdown", onDown],
      ["pointerup", onUp],
      ["pointercancel", onCancel],
      ["lostpointercapture", onCancel],
      ["keydown", onKey],
      ["keyup", onKey],
      ["click", onClick],
      ["focusout", onFocusOut],
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
      reset() { core.reset(); },
      discard() { core.discard(); },
      detach() {
        for (const [t, h] of handlers) rootEl.removeEventListener(t, h, { passive: false });
        for (const [id, hit] of pointerToCorner) releaseCapture(hit.el, id);
        pointerToCorner.clear();
        core.reset();
        for (const k of STYLE_KEYS) rootEl.style[k] = prevStyle[k];
      }
    };
  }

  const api = { attach, createCore, normalizeTs, keyAction };
  root.PikattoInput = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
