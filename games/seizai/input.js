/*
 * もくもくこうば — タップ・キーボード（入力）
 * 契約：docs/seizai-contract.md §5.2〜5.4（DOM）・§7.2（入力）
 * 担当C（入力・進行・保存）だけが編集する。
 *
 * SeizaiInput.attach(doc, handlers) → detach()
 *   handlers = {
 *     onZone(dept, btn)       … .zone[data-dept] を押した（dept は 'cut' など。売り物の山は 'goods'）
 *     onBuy(what, btn)        … シートの [data-buy] を押した（'staff'|'line'|'level'|'mgr'）
 *     onCommand(cmd, btn)     … ボタン・キーの命令（下の BUTTON_CMDS と KEY の命令）
 *     isCardOpen() → boolean  … カード（role="dialog"）が開いているか
 *     cardEl() → Element|null … いま開いているカード（Tab をカードの中に閉じこめる）
 *   }
 * - 押す：click を document でまとめて受ける（本物の <button> なので、Enter・Space もここに来る）。
 * - 長押しで連続購入はしない：click だけを見る。キーの押しっぱなし（repeat）の Enter・Space は止める。
 * - ダブルタップ拡大の抑止：ボタンの上で 350ms 以内の2回目のタップは touchend を止めて、click を自分で送る。
 *   ほかは CSS（touch-action: manipulation / pan-y、担当B）と viewport の user-scalable=no。
 * - キーボード（§7.2）：Esc（シート・カードを閉じる）、?（遊び方）、M（音）、E（広げる）。Tab は止めない。
 */
(function (root) {
  "use strict";

  const DOUBLE_TAP_MS = 350;
  const TAP_MOVE_PX = 14;

  // id → 命令
  const BUTTON_CMDS = Object.freeze({
    helpBtn: "help", soundBtn: "sound", expandBtn: "expand", orderTag: "orderTag",
    sheetClose: "sheetClose", mgrFast: "mgrFast", mgrGain: "mgrGain",
    awayOk: "awayOk", stageOk: "stageOk", orderAccept: "orderAccept", orderLater: "orderLater",
    endOk: "endOk", helpOk: "helpOk", back: "back", scrollCue: "scrollCue",
    helpReset: "helpReset", resetNo: "resetNo", resetYes: "resetYes"
  });

  function attach(doc, h) {
    doc = doc || root.document;
    h = h || {};
    const offs = [];
    const on = (t, type, fn, opt) => { if (!t) return; t.addEventListener(type, fn, opt); offs.push(() => t.removeEventListener(type, fn, opt)); };
    const call = (fn, ...a) => { if (typeof fn !== "function") return undefined; try { return fn(...a); } catch (e) { console.error("もくもくこうば(input):", e); return undefined; } };
    const nowMs = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());
    const closest = (t, sel) => (t && t.closest ? t.closest(sel) : null);

    // ---- 押す（click をまとめて受ける） ----
    on(doc, "click", (e) => {
      const t = e.target;
      const zone = closest(t, ".zone[data-dept]");
      if (zone) { call(h.onZone, String(zone.dataset.dept), zone); return; }
      const buy = closest(t, "[data-buy]");
      if (buy) { call(h.onBuy, String(buy.dataset.buy), buy); return; }
      const btn = closest(t, "button, a, [role=button]");
      if (btn && btn.id && Object.prototype.hasOwnProperty.call(BUTTON_CMDS, btn.id)) {
        call(h.onCommand, BUTTON_CMDS[btn.id], btn);   // #back は a のまま移動させる（preventDefault しない）
        return;
      }
      if (!btn && closest(t, "#scene")) call(h.onCommand, "outside", null);   // 場所の外（場面の空いた所）を押した
    });

    // ---- ダブルタップ拡大の抑止（ボタンの上） ----
    let lastTapEnd = 0, tapStart = null, synth = false;
    on(doc, "touchstart", (e) => {
      const t = e.touches && e.touches[0];
      tapStart = e.touches && e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
    }, { passive: true });
    on(doc, "touchend", (e) => {
      const t = e.changedTouches && e.changedTouches[0];
      const isTap = !!(tapStart && t && e.touches.length === 0 && Math.hypot(t.clientX - tapStart.x, t.clientY - tapStart.y) < TAP_MOVE_PX);
      const tNow = nowMs();
      const quick = isTap && tNow - lastTapEnd < DOUBLE_TAP_MS;
      if (isTap) lastTapEnd = tNow;
      if (!e.cancelable || !quick) return;
      const btn = closest(e.target, "button, .zone, a, [role=button]");
      if (!btn) return;            // 場面の canvas は touch-action（CSS）に任せる（縦スクロールを止めない）
      e.preventDefault();          // 2回目の click は送られないので、自分で押す
      if (!btn.disabled && !synth) {
        synth = true;
        try { btn.click(); } finally { synth = false; }
      }
    }, { passive: false });
    const stop = (e) => { if (e.cancelable) e.preventDefault(); };
    on(doc, "dblclick", stop, { passive: false });
    on(doc, "contextmenu", stop);
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) on(doc, type, stop, { passive: false });
    // 2本指の動き（つまんで拡大）は止める。1本指の縦スクロール（#scene）は止めない
    on(doc, "touchmove", (e) => { if (e.touches && e.touches.length > 1 && e.cancelable) e.preventDefault(); }, { passive: false });

    // ---- キーボード ----
    on(doc, "keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tgt = e.target;
      const tag = tgt && tgt.tagName ? String(tgt.tagName).toUpperCase() : "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (tgt && tgt.isContentEditable)) return;
      const k = e.key;
      const onControl = tag === "BUTTON" || tag === "A" || !!closest(tgt, "[role=button]");
      // 押しっぱなしの Enter・Space で続けて買わない（長押しで連続購入しない）
      if (e.repeat && onControl && (k === "Enter" || k === " " || k === "Spacebar")) { e.preventDefault(); return; }
      const card = !!call(h.isCardOpen);
      // カードが開いている間は、Tab をカードの中に閉じこめる
      if (k === "Tab" && card) {
        const box = call(h.cardEl);
        if (box && box.querySelectorAll) {
          const list = Array.from(box.querySelectorAll("button, a[href], [tabindex]:not([tabindex='-1'])")).filter((b) => !b.hidden && !b.disabled && b.offsetParent !== null);
          const back = doc.getElementById("back");
          if (back && !list.includes(back)) list.push(back);     // #back はどのカードからも押せる
          if (list.length) {
            const i = list.indexOf(doc.activeElement);
            const j = i < 0 ? 0 : (i + (e.shiftKey ? -1 : 1) + list.length) % list.length;
            e.preventDefault();
            try { list[j].focus(); } catch (err) { /* 無視 */ }
          }
        }
        return;
      }
      let cmd = null;
      if (k === "Escape" || k === "Esc") cmd = "esc";
      else if (k === "?" || (k === "/" && e.shiftKey)) cmd = "help";
      else if (k === "m" || k === "M") cmd = "sound";
      else if ((k === "e" || k === "E") && !card) cmd = "expand";
      if (!cmd) return;
      e.preventDefault();
      call(h.onCommand, cmd, null);
    });

    return function detach() {
      offs.splice(0).forEach((f) => { try { f(); } catch (e) { /* 無視 */ } });
    };
  }

  root.SeizaiInput = Object.freeze({ attach, BUTTON_CMDS, DOUBLE_TAP_MS });
})(typeof window !== "undefined" ? window : globalThis);
