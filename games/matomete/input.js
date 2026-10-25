/*
 * まとめてポン — 入力（タップ・キーボード。ルールは知らない）
 * 契約：docs/matomete-contract.md §4.2
 * 担当B（画面）だけが編集する。
 *
 * UMD: window.MatometeInput と module.exports。
 *
 * MatometeInput.attach({ board, area, root = document }, { onTap(x, y, via), onKey(cmd, arg) }, { isBlocked, cellAt(clientX, clientY) })
 *   → { detach() }
 *   - タップ：area（main.js は document.body を渡す＝画面のどこでも。MT-01）の pointerdown。押した座標からマスを決める（cellAt）。
 *     盤の外を押したら onTap(null, null, 'tap')。ボタン・リンクの上は数えない。主ボタン（左クリック・指1本目）だけ。
 *     2回タップは素早く押すことが多いので、指を離した瞬間（touchend）を止めてダブルタップ拡大・後追いの click を出さない。
 *   - ダブルタップ拡大の抑止（ボタンの所）：.tools・.head-tools で、350ms 以内の2回目のタップの touchend を止め、click は自分で送る。
 *     dblclick・gesturestart/change/end も止める。
 *   - キーボード：矢印 onKey('move', {dx, dy})（↑ が上＝y が増える）、Enter・Space onKey('activate')（ボタンにいるときはボタンに任せる）、
 *     Esc onKey(カードが開いていれば 'close'、でなければ 'deselect')、U・Backspace 'undo'、R 'restart'、M 'sound'、? / 'help'。
 *     #overlay が見えている間は Esc 以外を無視する。修飾キー（Ctrl・Cmd・Alt）つきは無視する。
 *   - isBlocked() が true の間は onTap と盤のキー（move・activate）を呼ばない。
 *   - 例外は外へ出さない。detach で付けたリスナーをすべて外す。
 */
(function (root) {
  "use strict";

  function safe(fn) {
    try { return fn(); } catch (e) { if (typeof console !== "undefined") console.error("MatometeInput:", e); return undefined; }
  }

  function attach(els, cbs, opts) {
    const board = els && els.board;
    const area = (els && els.area) || board;
    const doc = (els && els.root) || (board && board.ownerDocument) || root.document;
    const callbacks = cbs || {};
    const isBlocked = opts && typeof opts.isBlocked === "function" ? opts.isBlocked : () => false;
    const cellAt = opts && typeof opts.cellAt === "function" ? opts.cellAt : () => null;
    const offs = [];
    function on(target, type, fn, o) {
      if (!target || !target.addEventListener) return;
      target.addEventListener(type, fn, o);
      offs.push(() => target.removeEventListener(type, fn, o));
    }
    const blocked = () => safe(() => isBlocked()) === true;
    const tap = (x, y, via) => { if (blocked()) return; safe(() => callbacks.onTap && callbacks.onTap(x, y, via)); };
    const key = (cmd, arg) => safe(() => callbacks.onKey && callbacks.onKey(cmd, arg));
    const overlayOpen = () => {
      const ov = doc && doc.getElementById ? doc.getElementById("overlay") : null;
      return !!(ov && !ov.hidden);
    };
    const isControl = (t) => !!(t && t.closest && t.closest("button, a, input, select, textarea"));

    // ---- タップ（盤とそのまわり） ----
    on(area, "pointerdown", (e) => {
      if (e.isPrimary === false) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (isControl(e.target)) return;
      const c = safe(() => cellAt(e.clientX, e.clientY));
      if (c && Number.isInteger(c.x) && Number.isInteger(c.y)) tap(c.x, c.y, "tap");
      else tap(null, null, "tap");
    });
    // 盤の上の指を離したとき：拡大・後追いの click・長押しの選択を出さない（判定は pointerdown で済んでいる）
    on(area, "touchend", (e) => { if (e.cancelable && !isControl(e.target)) e.preventDefault(); }, { passive: false });
    on(area, "dblclick", (e) => e.preventDefault(), { passive: false });

    // ---- ダブルタップ拡大の抑止（ボタンの所） ----
    let lastTapEnd = 0, tapStart = null, synth = false;
    const nowMs = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());
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
    const zones = doc && doc.querySelectorAll ? Array.from(doc.querySelectorAll(".tools, .head-tools")) : [];
    for (const z of zones) {
      on(z, "touchstart", onTouchStart, { passive: true });
      on(z, "touchend", onTouchEnd, { passive: false });
      on(z, "dblclick", (e) => e.preventDefault(), { passive: false });
    }
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) on(doc, type, (e) => e.preventDefault(), { passive: false });

    // ---- キーボード ----
    on(doc, "keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      const tag = e.target && e.target.tagName ? String(e.target.tagName).toUpperCase() : "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) return;
      if (k === "Escape" || k === "Esc") {
        e.preventDefault();
        key(overlayOpen() ? "close" : "deselect");
        return;
      }
      if (overlayOpen()) return;
      if (e.repeat && !(k && k.startsWith("Arrow"))) return;
      const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[k];
      if (move) {
        e.preventDefault();
        if (!blocked()) key("move", { dx: move[0], dy: move[1] });
        return;
      }
      switch (k) {
        case "Enter": case " ": case "Spacebar":
          if (isControl(e.target)) return;   // ボタンの上ではボタンを押す（標準の動き）
          e.preventDefault();
          if (!blocked()) key("activate");
          return;
        case "u": case "U": case "Backspace": e.preventDefault(); key("undo"); return;
        case "r": case "R": e.preventDefault(); key("restart"); return;
        case "m": case "M": e.preventDefault(); key("sound"); return;
        case "?": case "/": e.preventDefault(); key("help"); return;
        default: break;
      }
    });

    return { detach() { while (offs.length) safe(offs.pop()); } };
  }

  const api = Object.freeze({ attach });
  root.MatometeInput = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
