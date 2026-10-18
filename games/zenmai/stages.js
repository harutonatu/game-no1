/* ゼンマイさんぽ ステージ定義（ZenmaiStages）
 * 契約: { id, name, length, startX, cliffX, target:{x,w}, maxTurns, segments:[{x0,x1,type,k}], hint }
 * - segments は 0〜length を隙間なく覆う。k は「エネルギー1あたりに進む距離」の倍率。
 *   flat は 1、up/down は k が倍率（up<1, down>1）。wind はロジックに合わせ倍率 = 1 + k（k>0 追い風→、k<0 向かい風←）。
 * - 検証の前提: STEP=60、エネルギー = turns×STEP を区間ごとに (距離 / 倍率) ずつ消費して startX から進む。
 *   ★3 = 帯の中心から 半幅×25%（±w/8）以内（logic.js の STAR3 と同じ）。
 * - どのステージも ★3 の巻き数の範囲が 0.15回転以上、範囲内に 1/4回転の倍数を含む（＋/－ボタンでも★3可）、
 *   範囲の上端 < maxTurns。maxTurns − 1.0 ≤ 崖に届く巻き数 ≤ maxTurns − 0.75（崖が限界より先に効き、落下が起きる。警告は maxTurns−1.5 から出るので、警告から崖まで0.5回転以上）。下のコメントは各ステージの ★3 範囲／帯全体の範囲／崖に届く巻き数。
 */
(function (root, factory) {
  var v = factory();
  if (typeof module === "object" && module.exports) module.exports = v;
  root.ZenmaiStages = v;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  return [
    // z01: ★3 2.79〜3.41回転（幅0.63） 帯 1.85〜4.35 崖 7.25 maxTurns 8
    {
      id: "z01", name: "はじめのいっぽ", length: 1000, startX: 60, cliffX: 495,
      target: { x: 171, w: 150 }, maxTurns: 8,
      segments: [
        { x0: 0, x1: 1000, type: "flat", k: 1 }
      ],
      hint: "ネジを時計回りにくるくる。指を離すと歩きます。"
    },
    // z02: ★3 4.90〜5.44回転（幅0.54） 帯 4.08〜6.25 崖 7.15 maxTurns 8
    {
      id: "z02", name: "もうすこし先へ", length: 1000, startX: 60, cliffX: 489,
      target: { x: 305, w: 130 }, maxTurns: 8,
      segments: [
        { x0: 0, x1: 1000, type: "flat", k: 1 }
      ],
      hint: "1回転でだいたい人形ひとつぶん先まで歩きます。"
    },
    // z03: ★3 7.84〜8.30回転（幅0.46） 帯 7.15〜8.98 崖 9.90 maxTurns 10.75
    {
      id: "z03", name: "がけのてまえ", length: 1000, startX: 60, cliffX: 654,
      target: { x: 489, w: 110 }, maxTurns: 10.75,
      segments: [
        { x0: 0, x1: 1000, type: "flat", k: 1 }
      ],
      hint: "巻きすぎると落ちちゃう。帯のまん中をねらって。"
    },
    // z04: ★3 7.53〜8.18回転（幅0.65） 帯 6.55〜9.17 崖 10.24 maxTurns 11
    {
      id: "z04", name: "のぼりざか", length: 1000, startX: 60, cliffX: 562,
      target: { x: 407, w: 110 }, maxTurns: 11,
      segments: [
        { x0: 0, x1: 300, type: "flat", k: 1 },
        { x0: 300, x1: 600, type: "up", k: 0.7 },
        { x0: 600, x1: 1000, type: "flat", k: 1 }
      ],
      hint: "上り坂は進みにくい。いつもより多めに巻こう。"
    },
    // z05: ★3 6.88〜7.30回転（幅0.42） 帯 6.39〜7.92 崖 9.24 maxTurns 10
    {
      id: "z05", name: "くだりざか", length: 1000, startX: 60, cliffX: 700,
      target: { x: 521, w: 100 }, maxTurns: 10,
      segments: [
        { x0: 0, x1: 250, type: "flat", k: 1 },
        { x0: 250, x1: 550, type: "down", k: 1.4 },
        { x0: 550, x1: 1000, type: "flat", k: 1 }
      ],
      hint: "下り坂はすいすい進む。巻きすぎに注意。"
    },
    // z06: ★3 6.79〜7.11回転（幅0.32） 帯 6.31〜7.59 崖 8.74 maxTurns 9.5
    {
      id: "z06", name: "おいかぜ", length: 1000, startX: 60, cliffX: 688,
      target: { x: 510, w: 100 }, maxTurns: 9.5,
      segments: [
        { x0: 0, x1: 200, type: "flat", k: 1 },
        { x0: 200, x1: 650, type: "wind", k: 0.3 },
        { x0: 650, x1: 1000, type: "flat", k: 1 }
      ],
      hint: "追い風（→）の中ではよく進みます。"
    },
    // z07: ★3 10.63〜11.20回転（幅0.57） 帯 9.79〜12.05 崖 12.90 maxTurns 13.75
    {
      id: "z07", name: "むかいかぜ", length: 1000, startX: 60, cliffX: 644,
      target: { x: 513, w: 95 }, maxTurns: 13.75,
      segments: [
        { x0: 0, x1: 200, type: "flat", k: 1 },
        { x0: 200, x1: 700, type: "wind", k: -0.3 },
        { x0: 700, x1: 1000, type: "flat", k: 1 }
      ],
      hint: "向かい風（←）の中は進みにくい。"
    },
    // z08: ★3 10.14〜10.64回転（幅0.50） 帯 9.39〜11.39 崖 12.14 maxTurns 13
    {
      id: "z08", name: "さかのうえで", length: 1000, startX: 60, cliffX: 679,
      target: { x: 555, w: 90 }, maxTurns: 13,
      segments: [
        { x0: 0, x1: 350, type: "flat", k: 1 },
        { x0: 350, x1: 1000, type: "up", k: 0.75 }
      ],
      hint: "坂の途中で止めよう。坂の上では1回転の進みが短くなります。"
    },
    // z09: ★3 9.67〜9.93回転（幅0.26） 帯 9.28〜10.34 崖 11.15 maxTurns 12
    {
      id: "z09", name: "やまこえ", length: 1000, startX: 60, cliffX: 692,
      target: { x: 558, w: 85 }, maxTurns: 12,
      segments: [
        { x0: 0, x1: 200, type: "flat", k: 1 },
        { x0: 200, x1: 420, type: "up", k: 0.7 },
        { x0: 420, x1: 640, type: "down", k: 1.35 },
        { x0: 640, x1: 1000, type: "flat", k: 1 }
      ],
      hint: "のぼって、くだって。合わせて考えよう。"
    },
    // z10: ★3 7.30〜7.55回転（幅0.25） 帯 6.92〜7.93 崖 8.65 maxTurns 9.5
    {
      id: "z10", name: "すべりだい", length: 1000, startX: 60, cliffX: 691,
      target: { x: 545, w: 85 }, maxTurns: 9.5,
      segments: [
        { x0: 0, x1: 300, type: "flat", k: 1 },
        { x0: 300, x1: 1000, type: "down", k: 1.4 }
      ],
      hint: "下り坂の途中で止める。少しの巻きで大きく進みます。"
    },
    // z11: ★3 9.44〜9.69回転（幅0.26） 帯 8.81〜10.08 崖 10.90 maxTurns 11.75
    {
      id: "z11", name: "かぜのさか", length: 1000, startX: 60, cliffX: 622,
      target: { x: 478, w: 80 }, maxTurns: 11.75,
      segments: [
        { x0: 0, x1: 220, type: "flat", k: 1 },
        { x0: 220, x1: 500, type: "up", k: 0.7 },
        { x0: 500, x1: 1000, type: "wind", k: 0.3 }
      ],
      hint: "上り坂のあとに追い風。"
    },
    // z12: ★3 10.73〜11.03回転（幅0.30） 帯 10.29〜11.48 崖 12.40 maxTurns 13.25
    {
      id: "z12", name: "くだりとむかいかぜ", length: 1000, startX: 60, cliffX: 752,
      target: { x: 663, w: 50 }, maxTurns: 13.25,
      segments: [
        { x0: 0, x1: 180, type: "flat", k: 1 },
        { x0: 180, x1: 450, type: "down", k: 1.4 },
        { x0: 450, x1: 1000, type: "wind", k: -0.3 }
      ],
      hint: "下りで勢いよく進んでも、向かい風でゆっくりに。"
    },
    // z13: ★3 9.23〜9.45回転（幅0.22） 帯 8.90〜9.77 崖 10.65 maxTurns 11.5
    {
      id: "z13", name: "みっつのみち", length: 1000, startX: 60, cliffX: 691,
      target: { x: 560, w: 65 }, maxTurns: 11.5,
      segments: [
        { x0: 0, x1: 180, type: "flat", k: 1 },
        { x0: 180, x1: 380, type: "up", k: 0.7 },
        { x0: 380, x1: 560, type: "down", k: 1.4 },
        { x0: 560, x1: 1000, type: "wind", k: 0.25 }
      ],
      hint: "坂と風がつづきます。"
    },
    // z14: ★3 11.02〜11.27回転（幅0.25） 帯 10.65〜11.65 崖 12.40 maxTurns 13.25
    {
      id: "z14", name: "でこぼこさんぽ", length: 1000, startX: 60, cliffX: 695,
      target: { x: 616, w: 45 }, maxTurns: 13.25,
      segments: [
        { x0: 0, x1: 150, type: "flat", k: 1 },
        { x0: 150, x1: 300, type: "up", k: 0.7 },
        { x0: 300, x1: 420, type: "wind", k: -0.25 },
        { x0: 420, x1: 560, type: "down", k: 1.4 },
        { x0: 560, x1: 700, type: "up", k: 0.75 },
        { x0: 700, x1: 1000, type: "wind", k: 0.3 }
      ],
      hint: "いろいろな道。どこで多く巻くか考えよう。"
    },
    // z15: ★3 11.47〜11.67回転（幅0.20） 帯 11.17〜11.97 崖 12.90 maxTurns 13.75
    {
      id: "z15", name: "さいごのがけ", length: 1000, startX: 60, cliffX: 704,
      target: { x: 582, w: 48 }, maxTurns: 13.75,
      segments: [
        { x0: 0, x1: 160, type: "flat", k: 1 },
        { x0: 160, x1: 330, type: "up", k: 0.65 },
        { x0: 330, x1: 500, type: "wind", k: -0.25 },
        { x0: 500, x1: 650, type: "flat", k: 1 },
        { x0: 650, x1: 1000, type: "down", k: 1.5 }
      ],
      hint: "のぼり坂と向かい風をこえた平らな道に目標。その先は下り坂とがけ。そっと止めよう。"
    }
  ];
});
