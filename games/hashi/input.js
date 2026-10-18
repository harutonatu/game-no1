/*
 * ハシわたり — 入力（長押しの検知：指・マウス・キーボード）
 *
 * HashiInput.attach(surfaceEl, { onHoldStart, onHoldEnd, onHoldCancel }, { now }) → { detach(), reset(), core, get holding() }
 *   - now: () => number。既定は performance.now。event.timeStamp・Date.now は使わない（時刻の基準を1つにする）。
 *   - pointerdown（マウスは左ボタンのみ）で onHoldStart({ at })。setPointerCapture する。
 *   - pointerup で onHoldEnd({ at, holdMs })。holdMs は同じ now() で測った2つの時刻の差。
 *   - pointercancel・lostpointercapture で onHoldCancel({ reason: 'cancel' })。
 *   - マルチタッチ：最初の1本だけを数える。2本目以降は無視。最初の指が離れたら終わり。
 *   - 押しっぱなしのまま reset() されたら、その指（キー）は以後数えない（押し直すまで反応しない）。
 *   - touch-action: none。touchstart/touchmove/touchend・dblclick・contextmenu・selectstart・dragstart を止める。
 *   - キーボード：document の Space / Enter の keydown（repeat は無視）で開始、keyup で終わり。
 *     ボタン・リンク・入力欄にフォーカスがあるとき、#overlay が開いているときは何もしない。
 *     指とキーボードは、先に始めた方だけを数える。
 *   - window の blur で、押している途中なら onHoldCancel({ reason: 'blur' })。
 *   - 押している間は surfaceEl の data-holding を "1"、それ以外は "0" にする。
 *   - detach で、付けたリスナーと変えたスタイル・属性をすべて元に戻す。
 *   - タップ式（opts.tapMode が true を返すとき）：押し続けられない人向け。1回目のタップ（pointerdown・click・
 *     Space/Enter の keydown）で onHoldStart、2回目で onHoldEnd。離す（pointerup・keyup）は数えない。
 *     VoiceOver・スイッチコントロールの「有効化」は click だけが届くので、click も受ける
 *     （直前 700ms 以内に pointerdown があった click は、同じタップの重複なので数えない）。
 *   - 返り値の core は、HashiGame.holdFor が同じ「押している」状態を共有して down/up するためのもの。
 *
 * HashiInput.createCore(cbs, { now }) → { down(at), up(at), cancel(reason), reset(), get holding() }
 *   DOM に依存しない核。at を省くと now() を使う。down/up/cancel は受け付けたら true、無視したら false を返す。
 *   onHoldStart がちょうど false を返したら（演出中など、始められないとき）、押していないことにして down も false を返す
 *   （タップ式で、受け付けなかった1回目のタップが「押している」扱いで残り、次のタップを食べないようにする）。
 *
 * コールバックの例外は外へ出さない（console.error に出す）。
 * UMD: ブラウザでは window.HashiInput、Node では module.exports と globalThis.HashiInput。
 */
(function (root) {
  "use strict";

  function safe(fn, arg) {
    if (typeof fn !== "function") return undefined;
    try { return fn(arg); } catch (e) { if (typeof console !== "undefined") console.error("HashiInput: コールバックで例外が出ました", e); return undefined; }
  }

  function defaultNow() {
    if (typeof performance !== "undefined" && performance && typeof performance.now === "function") return performance.now();
    return Date.now(); // performance が無い古い環境だけの予備
  }

  function makeClock(opts) {
    const fn = opts && typeof opts.now === "function" ? opts.now : defaultNow;
    return function now() {
      let t;
      try { t = Number(fn()); } catch (e) {
        if (typeof console !== "undefined") console.error("HashiInput: now() で例外が出ました", e);
        t = NaN;
      }
      return Number.isFinite(t) ? t : 0;
    };
  }

  /*
   * DOM に依存しない核。
   *   down(at)      … 押し始め（押している途中なら無視）→ onHoldStart({ at })
   *   up(at)        … 離した（押していなければ無視）→ onHoldEnd({ at, holdMs })
   *   cancel(reason)… 取り消し（押していなければ無視）→ onHoldCancel({ reason })
   *   reset()       … 状態を初期化する。コールバックは呼ばない
   */
  function createCore(cbs, opts) {
    cbs = cbs || {};
    const now = makeClock(opts);
    let holding = false;
    let startAt = 0;

    function timeOf(at) {
      const t = Number(at);
      return at === undefined || at === null || !Number.isFinite(t) ? now() : t;
    }

    return {
      down(at) {
        if (holding) return false;
        holding = true;
        startAt = timeOf(at);
        if (safe(cbs.onHoldStart, { at: startAt }) === false) { holding = false; startAt = 0; return false; }
        return true;
      },
      up(at) {
        if (!holding) return false;
        holding = false;
        const t = timeOf(at);
        const d = t - startAt;
        const holdMs = Number.isFinite(d) && d > 0 ? d : 0; // 時計が戻っても負にしない
        safe(cbs.onHoldEnd, { at: t, holdMs });
        return true;
      },
      cancel(reason) {
        if (!holding) return false;
        holding = false;
        safe(cbs.onHoldCancel, { reason: typeof reason === "string" && reason ? reason : "cancel" });
        return true;
      },
      reset() { holding = false; startAt = 0; },
      get holding() { return holding; }
    };
  }

  const KEY_SPACE = "space";
  const KEY_ENTER = "enter";

  function keyKind(e) {
    if (e.code === "Space" || e.key === " " || e.key === "Spacebar") return KEY_SPACE;
    if (e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter") return KEY_ENTER;
    return null;
  }

  // ボタン・リンク・入力欄など、Space / Enter を自分で使う要素にフォーカスがあるか
  function focusUsesKeys(doc) {
    const el = doc && doc.activeElement;
    if (!el || el === doc.body || el === doc.documentElement) return false;
    if (el.isContentEditable) return true;
    const tag = String(el.tagName || "").toUpperCase();
    if (tag === "BUTTON" || tag === "A" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "SUMMARY") return true;
    return false;
  }

  function overlayOpen(doc) {
    const ov = doc && typeof doc.getElementById === "function" ? doc.getElementById("overlay") : null;
    return !!(ov && !ov.hidden);
  }

  function attach(surfaceEl, cbs, opts) {
    if (!surfaceEl || typeof surfaceEl.addEventListener !== "function") throw new Error("HashiInput.attach: 長押しを受ける要素（#stageWrap）が必要です");
    const doc = surfaceEl.ownerDocument || (typeof document !== "undefined" ? document : null);
    const win = (doc && doc.defaultView) || (typeof window !== "undefined" ? window : null);
    const now = makeClock(opts);
    const core = createCore(cbs, { now });
    const tapFn = opts && typeof opts.tapMode === "function" ? opts.tapMode : null;
    function tapMode() {
      if (!tapFn) return false;
      try { return !!tapFn(); } catch (e) {
        if (typeof console !== "undefined") console.error("HashiInput: tapMode() で例外が出ました", e);
        return false;
      }
    }
    const CLICK_DEDUPE_MS = 700;
    let lastPointerDownAt = -Infinity;

    // 今数えている入力：{ type: 'pointer', id } または { type: 'key', key }。null なら何も数えていない
    let source = null;

    const prevStyle = {
      touchAction: surfaceEl.style.touchAction,
      userSelect: surfaceEl.style.userSelect,
      webkitUserSelect: surfaceEl.style.webkitUserSelect,
      webkitTouchCallout: surfaceEl.style.webkitTouchCallout
    };
    const prevHolding = surfaceEl.getAttribute("data-holding");
    surfaceEl.style.touchAction = "none";
    surfaceEl.style.userSelect = "none";
    surfaceEl.style.webkitUserSelect = "none";
    surfaceEl.style.webkitTouchCallout = "none";

    function mark() { surfaceEl.setAttribute("data-holding", core.holding ? "1" : "0"); }
    mark();

    function release() {
      if (source && source.type === "pointer") {
        try { surfaceEl.releasePointerCapture(source.id); } catch (e) { /* もう捕まえていない */ }
      }
    }

    function start(src) {
      source = src;
      if (!core.down(now())) source = null;
      mark();
    }
    function finish() {
      source = null;
      core.up(now());
      mark();
    }
    function cancel(reason) {
      const s = source;
      source = null;
      if (s && s.type === "pointer") { try { surfaceEl.releasePointerCapture(s.id); } catch (e) { /* 無視 */ } }
      core.cancel(reason);
      mark();
    }

    // タップ式：押していなければ始め、押している（のびている）なら終える
    function tapToggle() {
      if (source !== null && source.type === "tap") { finish(); return; }
      if (source !== null || core.holding) return;
      start({ type: "tap" });
    }

    function onDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.cancelable) e.preventDefault();
      if (tapMode()) {
        if (e.isPrimary === false) return;   // 2本目以降の指は数えない
        lastPointerDownAt = now();
        tapToggle();
        return;
      }
      if (source !== null || core.holding) return; // 2本目以降の指・キーボードで押し中は数えない
      try { surfaceEl.setPointerCapture(e.pointerId); } catch (err) { /* 捕まえられなくても続ける */ }
      start({ type: "pointer", id: e.pointerId });
    }

    function onUp(e) {
      if (!source || source.type !== "pointer" || e.pointerId !== source.id) return;
      if (e.cancelable) e.preventDefault();
      release();
      finish();
    }

    // 支援技術（VoiceOver など）の「有効化」は click だけが届く。タップ式のときだけ受ける
    function onClick(e) {
      if (!tapMode()) return;
      if (e.cancelable) e.preventDefault();
      if (now() - lastPointerDownAt < CLICK_DEDUPE_MS) return;   // 指のタップに続く click（重複）
      tapToggle();
    }

    function onPointerCancel(e) {
      if (!source || source.type !== "pointer" || e.pointerId !== source.id) return;
      cancel("cancel");
    }

    function onKeyDown(e) {
      const k = keyKind(e);
      if (!k) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      if (focusUsesKeys(doc) || overlayOpen(doc)) return;
      if (e.cancelable) e.preventDefault(); // Space でページが動かないように
      if (e.repeat) return;                 // 押しっぱなしの繰り返しでは伸び直さない
      if (tapMode()) { tapToggle(); return; }
      if (source !== null || core.holding) return;
      start({ type: "key", key: k });
    }

    function onKeyUp(e) {
      const k = keyKind(e);
      if (!k || !source || source.type !== "key" || source.key !== k) return;
      if (e.cancelable) e.preventDefault();
      finish();
    }

    function onBlur() {
      if (source !== null || core.holding) cancel("blur");
    }

    function stop(e) { if (e.cancelable) e.preventDefault(); }

    const surfaceHandlers = [
      ["pointerdown", onDown],
      ["pointerup", onUp],
      ["click", onClick],
      ["pointercancel", onPointerCancel],
      ["lostpointercapture", onPointerCancel],
      ["touchstart", stop],
      ["touchmove", stop],
      ["touchend", stop],
      ["dblclick", stop],
      ["contextmenu", stop],
      ["selectstart", stop],
      ["dragstart", stop]
    ];
    const docHandlers = [["keydown", onKeyDown], ["keyup", onKeyUp]];
    const winHandlers = [["blur", onBlur]];
    const LO = { passive: false };

    for (const [t, h] of surfaceHandlers) surfaceEl.addEventListener(t, h, LO);
    if (doc) for (const [t, h] of docHandlers) doc.addEventListener(t, h, LO);
    if (win) for (const [t, h] of winHandlers) win.addEventListener(t, h, LO);

    let attached = true;

    return {
      detach() {
        if (!attached) return;
        attached = false;
        for (const [t, h] of surfaceHandlers) surfaceEl.removeEventListener(t, h, LO);
        if (doc) for (const [t, h] of docHandlers) doc.removeEventListener(t, h, LO);
        if (win) for (const [t, h] of winHandlers) win.removeEventListener(t, h, LO);
        release();
        source = null;
        core.reset();
        surfaceEl.style.touchAction = prevStyle.touchAction;
        surfaceEl.style.userSelect = prevStyle.userSelect;
        surfaceEl.style.webkitUserSelect = prevStyle.webkitUserSelect;
        surfaceEl.style.webkitTouchCallout = prevStyle.webkitTouchCallout;
        if (prevHolding === null) surfaceEl.removeAttribute("data-holding");
        else surfaceEl.setAttribute("data-holding", prevHolding);
      },
      // 押下を取り消す（中断・遊び方を開いたときなど）。コールバックは呼ばない。
      // 押しっぱなしの指・キーは以後数えない（その指の pointerup・そのキーの keyup は無視される）
      reset() {
        release();
        source = null;
        core.reset();
        if (attached) mark();
      },
      core,
      get holding() { return core.holding; }
    };
  }

  const api = { attach, createCore };
  root.HashiInput = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
