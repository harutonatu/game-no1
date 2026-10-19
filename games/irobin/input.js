/*
 * いろびん — 入力（タップ・キーボード。ルールは知らない）
 * 契約：docs/irobin-contract.md §5
 * 担当B（画面）だけが編集する。
 *
 * UMD: window.IrobinInput と module.exports。
 * 土台：関数の枠だけ。中身は担当B が書く。
 */
(function (root) {
  "use strict";

  // els = { board, root = document }
  // cbs = { onPick(index, via: 'tap'|'key'), onCommand(cmd: 'undo'|'restart'|'deselect'|'sound'|'help'|'close') }
  // opts = { isBlocked: () => boolean }
  function attach(els, cbs, { isBlocked = () => false } = {}) {
    return {
      detach() {},
      focusBottle(index) {}
    };
  }

  const api = Object.freeze({ attach });
  root.IrobinInput = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
