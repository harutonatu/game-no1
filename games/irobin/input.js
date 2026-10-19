/*
 * いろびん — 入力（タップ・キーボード。ルールは知らない）
 * 契約：docs/irobin-contract.md §5
 * 担当B（画面）だけが編集する。
 *
 * UMD: window.IrobinInput と module.exports。
 *
 * IrobinInput.attach({ board, root = document }, { onPick(index, via, id), onCommand(cmd) }, { isBlocked }) → { detach(), focusBottle(index) }
 *   - タップ：#board の .bottle の click で onPick(Number(data-index), 'tap'|'key', Number(data-id))。
 *     届けた瓶は消えて位置（data-index）がずれるので、瓶の固定の番号 data-id も渡す（main は id を優先して今の位置を引く）。
 *     届けの演出で飛んでいる瓶（data-gone="1"）は数えない・選ばない。
 *     （Enter・Space はボタンの標準の click に任せる。キーで押した click は via 'key'）
 *   - ダブルタップ拡大の抑止：#board と .tools で、350ms 以内の2回目のタップの touchend を止め、click は自分で送る。
 *     dblclick・gesturestart/change/end も止める。
 *   - キーボード：←→ で左右、↑↓ で上下の段（board.dataset.cols）、1〜9・0 で番号の瓶、U・Backspace で undo、R で restart、
 *     Esc で deselect（カードが開いていれば close）、M で sound、? / で help。
 *     #overlay が見えている間は Esc 以外を無視する。修飾キー（Ctrl・Cmd・Alt）つきは無視する。
 *   - isBlocked() が true の間は onPick を呼ばない。
 *   - 例外は外へ出さない。detach で付けたリスナーをすべて外す。
 */
(function (root) {
  "use strict";

  function safe(fn) {
    try { return fn(); } catch (e) { if (typeof console !== "undefined") console.error("IrobinInput:", e); return undefined; }
  }

  function attach(els, cbs, opts) {
    const board = els && els.board;
    const doc = (els && els.root) || (board && board.ownerDocument) || root.document;
    const callbacks = cbs || {};
    const isBlocked = opts && typeof opts.isBlocked === "function" ? opts.isBlocked : () => false;
    const offs = [];
    function on(target, type, fn, o) {
      if (!target || !target.addEventListener) return;
      target.addEventListener(type, fn, o);
      offs.push(() => target.removeEventListener(type, fn, o));
    }
    const blocked = () => { const b = safe(() => isBlocked()); return b === true; };
    const pick = (i, via, id) => { if (blocked()) return; safe(() => callbacks.onPick && callbacks.onPick(i, via, id)); };
    const command = (cmd) => safe(() => callbacks.onCommand && callbacks.onCommand(cmd));
    const bottles = () => (board ? Array.from(board.querySelectorAll('.bottle:not([data-gone="1"])')) : []);
    const idOf = (btn) => { const n = btn && btn.dataset ? Number(btn.dataset.id) : NaN; return Number.isSafeInteger(n) && n >= 0 ? n : undefined; };
    const overlayOpen = () => {
      const ov = doc && doc.getElementById ? doc.getElementById("overlay") : null;
      return !!(ov && !ov.hidden);
    };

    // ---- タップ（click） ----
    let synthTap = false;   // 自分で送った click（2回目の素早いタップ）は 'tap'
    on(board, "click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest(".bottle") : null;
      if (!btn || !board.contains(btn) || btn.dataset.gone === "1") return;
      const i = Number(btn.dataset.index);
      if (!Number.isInteger(i)) return;
      const via = !synthTap && e.detail === 0 ? "key" : "tap";
      pick(i, via, idOf(btn));
    });

    // ---- ダブルタップ拡大の抑止 ----
    const tools = doc && doc.querySelector ? doc.querySelector(".tools") : null;
    let lastTapEnd = 0, tapStart = null;
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
      if (btn && !btn.disabled) {
        synthTap = true;
        try { btn.click(); } finally { synthTap = false; }
      }
    }
    for (const area of [board, tools]) {
      if (!area) continue;
      on(area, "touchstart", onTouchStart, { passive: true });
      on(area, "touchend", onTouchEnd, { passive: false });
      on(area, "dblclick", (e) => e.preventDefault(), { passive: false });
    }
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) on(doc, type, (e) => e.preventDefault(), { passive: false });

    // ---- キーボード ----
    // 並んでいる瓶（飛んでいる瓶を除く）の中で何番目か。data-index は届けの演出中に古いことがあるので使わない
    function focusedIndex() {
      const a = doc.activeElement;
      if (!a || !a.classList || !a.classList.contains("bottle") || !board.contains(a)) return null;
      const i = bottles().indexOf(a);
      return i >= 0 ? i : null;
    }
    function focusBottle(index) {
      const list = bottles();
      if (!list.length) return;
      const i = Math.max(0, Math.min(list.length - 1, Number(index) || 0));
      safe(() => { try { list[i].focus({ preventScroll: true }); } catch (e) { list[i].focus(); } });
    }
    function moveFocus(dx, dy) {
      const list = bottles();
      if (!list.length) return;
      const cur = focusedIndex();
      if (cur === null) {
        const sel = list.findIndex((b) => b.dataset.selected === "1");
        focusBottle(sel >= 0 ? sel : 0);
        return;
      }
      const cols = Math.max(1, parseInt(board.dataset.cols, 10) || list.length);
      let next = cur;
      if (dx) {
        next = cur + dx;
        if (next < 0 || next >= list.length) return;   // 端で止まる
      } else if (dy) {
        next = cur + dy * cols;
        if (next < 0) return;
        if (next >= list.length) {
          // 下の段が短いときは、その段の最後へ
          const row = Math.floor(cur / cols);
          const lastRow = Math.floor((list.length - 1) / cols);
          if (row >= lastRow) return;
          next = list.length - 1;
        }
      }
      focusBottle(next);
    }
    on(doc, "keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key;
      const tag = e.target && e.target.tagName ? String(e.target.tagName).toUpperCase() : "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) return;
      if (key === "Escape" || key === "Esc") {
        e.preventDefault();
        command(overlayOpen() ? "close" : "deselect");
        return;
      }
      if (overlayOpen()) return;
      if (e.repeat && !(key && key.startsWith("Arrow"))) return;
      switch (key) {
        case "ArrowLeft": e.preventDefault(); moveFocus(-1, 0); return;
        case "ArrowRight": e.preventDefault(); moveFocus(1, 0); return;
        case "ArrowUp": e.preventDefault(); moveFocus(0, -1); return;
        case "ArrowDown": e.preventDefault(); moveFocus(0, 1); return;
        case "u": case "U": case "Backspace": e.preventDefault(); command("undo"); return;
        case "r": case "R": e.preventDefault(); command("restart"); return;
        case "m": case "M": e.preventDefault(); command("sound"); return;
        case "?": case "/": e.preventDefault(); command("help"); return;
        default: break;
      }
      if (/^[0-9]$/.test(key)) {
        const n = key === "0" ? 10 : Number(key);
        const list = bottles();
        if (n > list.length) return;
        e.preventDefault();
        focusBottle(n - 1);
        pick(n - 1, "key", idOf(list[n - 1]));
      }
    });

    return {
      detach() { while (offs.length) safe(offs.pop()); },
      focusBottle
    };
  }

  const api = Object.freeze({ attach });
  root.IrobinInput = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
