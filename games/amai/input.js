/*
 * あまいものあつめ — 入力（タップ・キーボード。ルールは知らない）
 * 契約：docs/ari-contract.md §3.7
 * 担当 D（画面と進行）だけが編集する。
 *
 * UMD: window.AmaiInput と module.exports。
 *
 * AmaiInput.attach({ grid, root = document }, { onPress(col, via), onCommand(cmd) }, { isBlocked }) → { detach(), focusCol(col) }
 *   - タップ：#grid の .box.front（手前の箱）の click で onPress(Number(data-col), 'tap'|'key')。
 *     （Enter・Space はボタンの標準の click に任せる。キーで押した click は via 'key'）
 *   - ダブルタップ拡大の抑止：#grid・#slots・#tools・#picBox で、350ms 以内の 2 回目のタップの touchend を止め、
 *     ボタンの上なら click は自分で送る。dblclick・gesturestart/change/end も止める。
 *   - キーボード：1〜4 でその列の手前の箱、← → で手前の箱のフォーカスを左右へ（はしで止まる）、
 *     U・Backspace で undo、R で restart、F で fast、Z で book、? / で help、M で sound、Esc で close（カードが開いているとき）。
 *     #overlay が見えている間は Esc 以外を無視する（カードのボタンはフォーカスと Enter で押せる）。修飾キー（Ctrl・Cmd・Alt）つきは無視する。
 *   - isBlocked() が true の間は onPress を呼ばない。
 *   - 例外は外へ出さない。detach で付けたリスナーをすべて外す。
 */
(function (root) {
  "use strict";

  function safe(fn) {
    try { return fn(); } catch (e) { if (typeof console !== "undefined") console.error("AmaiInput:", e); return undefined; }
  }

  function attach(els, cbs, opts) {
    const grid = els && els.grid;
    const doc = (els && els.root) || (grid && grid.ownerDocument) || root.document;
    const callbacks = cbs || {};
    const isBlocked = opts && typeof opts.isBlocked === "function" ? opts.isBlocked : () => false;
    const offs = [];
    function on(target, type, fn, o) {
      if (!target || !target.addEventListener) return;
      target.addEventListener(type, fn, o);
      offs.push(() => target.removeEventListener(type, fn, o));
    }
    const blocked = () => safe(() => isBlocked()) === true;
    const press = (col, via) => { if (blocked()) return; safe(() => callbacks.onPress && callbacks.onPress(col, via)); };
    const command = (cmd) => safe(() => callbacks.onCommand && callbacks.onCommand(cmd));
    // 箱の無い列の手前の要素は hidden（描画が使い回す）。見えている箱だけを選ぶ
    const fronts = () => (grid ? Array.from(grid.querySelectorAll(".box.front")).filter((b) => !b.hidden) : []);
    const colOf = (btn) => { const n = btn && btn.dataset ? Number(btn.dataset.col) : NaN; return Number.isInteger(n) && n >= 0 && n <= 3 ? n : null; };
    const overlayOpen = () => {
      const ov = doc && doc.getElementById ? doc.getElementById("overlay") : null;
      return !!(ov && !ov.hidden);
    };

    // ---- タップ（click） ----
    let synthTap = false;   // 自分で送った click（2 回目の素早いタップ）は 'tap'
    on(grid, "click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest(".box.front") : null;
      if (!btn || !grid.contains(btn)) return;
      const col = colOf(btn);
      if (col === null) return;
      const via = !synthTap && e.detail === 0 ? "key" : "tap";
      press(col, via);
    });

    // ---- ダブルタップ拡大の抑止 ----
    const q = (sel) => (doc && doc.querySelector ? doc.querySelector(sel) : null);
    const areas = [grid, q("#slots"), q("#tools"), q("#picBox")];
    let lastTapEnd = 0, tapStart = null;
    const nowMs = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());
    function onTouchStart(e) {
      const t = e.touches && e.touches[0];
      tapStart = e.touches && e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
    }
    function onTouchEnd(e) {
      const t = e.changedTouches && e.changedTouches[0];
      const isTap = !!(tapStart && t && e.touches && e.touches.length === 0 && Math.hypot(t.clientX - tapStart.x, t.clientY - tapStart.y) < 14);
      const tNow = nowMs();
      const quick = isTap && tNow - lastTapEnd < 350;
      if (isTap) lastTapEnd = tNow;
      if (!e.cancelable || !quick) return;
      e.preventDefault();   // 2 回目の click は送られないので、ボタンなら自分で押す
      const btn = e.target && e.target.closest ? e.target.closest("button") : null;
      if (btn && !btn.disabled) {
        synthTap = true;
        try { btn.click(); } finally { synthTap = false; }
      }
    }
    for (const area of areas) {
      if (!area) continue;
      on(area, "touchstart", onTouchStart, { passive: true });
      on(area, "touchend", onTouchEnd, { passive: false });
      on(area, "dblclick", (e) => e.preventDefault(), { passive: false });
    }
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) on(doc, type, (e) => e.preventDefault(), { passive: false });

    // ---- キーボード ----
    function focusEl(b) { if (!b) return; safe(() => { try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } }); }
    // その列の手前の箱にフォーカス（列が空なら何もしない）
    function focusCol(col) {
      const b = fronts().find((x) => colOf(x) === Number(col));
      focusEl(b);
    }
    function moveFocus(dx) {
      const list = fronts().filter((b) => colOf(b) !== null).sort((a, b) => colOf(a) - colOf(b));
      if (!list.length) return;
      const a = doc.activeElement;
      const cur = list.indexOf(a);
      if (cur < 0) { focusEl(dx > 0 ? list[0] : list[list.length - 1]); return; }
      const next = cur + dx;
      if (next < 0 || next >= list.length) return;   // はしで止まる
      focusEl(list[next]);
    }
    on(doc, "keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key;
      const tag = e.target && e.target.tagName ? String(e.target.tagName).toUpperCase() : "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) return;
      if (key === "Escape" || key === "Esc") {
        if (overlayOpen()) { e.preventDefault(); command("close"); }
        return;
      }
      if (overlayOpen()) return;
      if (e.repeat && !(key && key.startsWith("Arrow"))) return;
      switch (key) {
        case "ArrowLeft": e.preventDefault(); moveFocus(-1); return;
        case "ArrowRight": e.preventDefault(); moveFocus(1); return;
        case "u": case "U": case "Backspace": e.preventDefault(); command("undo"); return;
        case "r": case "R": e.preventDefault(); command("restart"); return;
        case "f": case "F": e.preventDefault(); command("fast"); return;
        case "z": case "Z": e.preventDefault(); command("book"); return;
        case "m": case "M": e.preventDefault(); command("sound"); return;
        case "?": case "/": e.preventDefault(); command("help"); return;
        default: break;
      }
      if (/^[1-4]$/.test(key)) {
        e.preventDefault();
        const col = Number(key) - 1;
        focusCol(col);
        press(col, "key");
      }
    });

    return {
      detach() { while (offs.length) safe(offs.pop()); },
      focusCol
    };
  }

  const api = Object.freeze({ attach });
  root.AmaiInput = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
