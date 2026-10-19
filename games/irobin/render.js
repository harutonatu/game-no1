/*
 * いろびん — 描画と演出（状態は変えない。#board の中身・#shop の中・canvas#fx だけをさわる）
 * 契約：docs/irobin-contract.md §7（描画と演出）・§6（DOM）
 * 担当B（画面）だけが編集する。
 *
 * UMD: window.IrobinRender と module.exports。
 * 土台：関数の枠だけ。中身は担当B が書く。
 */
(function (root) {
  "use strict";

  // 描ける動物（契約 §7.2）。プログラムで描くオリジナル
  const ANIMALS = Object.freeze(["kuma", "usagi", "neko", "penguin", "risu", "hitsuji"]);

  // 動物を1匹描く（メニューの絵でも使える純粋な描画関数）。mood: enter|wait|happy|leave|empty
  function drawAnimal(ctx, kind, { w, h, mood, t } = {}) {
    // 土台：未実装
  }

  // els = { board, shop, fx }
  function create(els, { calm = false } = {}) {
    let isCalm = !!calm;
    return {
      build(state) {},                       // 面の始めに瓶のボタンを作り直す（layout も行う）
      layout() {},                           // 列数と瓶の大きさ。board.dataset.cols を書く
      update(state, ui) {},                  // 演出なしで今の状態に合わせる。ui = { selected }
      pour(outcome, state) { return Promise.resolve(); },   // §7.3 の順で演出
      deny(index, reason) {},                // 注げない：相手の瓶を小さく揺らす
      celebrate() { return Promise.resolve(); },            // 面クリアの演出
      finishAll() {},                        // 動いている演出を一瞬で終わらせる
      pause() {},
      resume() {},
      setCalm(v) { isCalm = !!v; },
      get busy() { return false; }
    };
  }

  const api = Object.freeze({ ANIMALS, drawAnimal, create });
  root.IrobinRender = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
