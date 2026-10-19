/*
 * いろびん — つなぎ込み・保存・画面遷移・テスト用 API
 * 契約：docs/irobin-contract.md §8（進行）・§8.6（テスト用 API）
 * 担当B（画面）だけが編集する。
 * 土台：関数の枠だけ。中身は担当B が書く。
 */
(function () {
  "use strict";
  const L = window.IrobinLogic;
  const R = window.IrobinRender;
  const I = window.IrobinInput;

  // ---- タイマー（setTimeout を直接呼ばない。契約 §8.4） ----
  const timers = new Set();
  function later(fn, ms) { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; }
  function clearLater() { for (const id of timers) clearTimeout(id); timers.clear(); }

  // ---- 保存（try/catch で囲む） ----
  function load() {}
  function save() {}

  // ---- 進行 ----
  function startLevel(level, moves) {}
  function onPick(index, via) {}
  function onCommand(cmd) {}
  function undo() {}
  function restart() {}
  function showCard(kind) {}

  // ---- テスト用の公開 API（契約 §8.6） ----
  window.IrobinGame = Object.freeze({
    getState() { return null; },
    pick(index) {},
    pour(from, to) { return null; },
    solution() { return null; },
    skip() {},
    setLevel(n) {},
    setState(s) { return false; }
  });
})();
