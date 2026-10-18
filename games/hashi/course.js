/*
 * ハシわたり — コース（葉の作り方と難しさの段階表。DOM・時計・保存にさわらない純粋な計算だけ）
 *
 * 葉は { x, w }（左端の x と幅、論理単位）。makeNext は前の葉の右端から gap だけ空けて次の葉を作る。
 * gap と w は、渡った回数 crossed で選んだ段階（TIERS）の閉区間から一様に選んだ整数。
 *
 * 公平さの約束（契約書 §5）。どの段階・どの乱数でも：
 *   gap + w <= VIEW_W - CAMERA_LEFT - 40 (= 760)  … 画面を送ると次の葉の右端が必ず見える
 *   gap + w <= MAX_LEN (= 800)                    … どの葉にも必ず届く
 *   w >= 2 * PERFECT_HALF + 20 (= 40)             … ぴったり印が葉からはみ出さない
 * 読み込み時に TIERS がこれを守るか確かめ、守らなければ例外を投げる。
 *
 * UMD: ブラウザでは window.HashiCourse、Node では module.exports と globalThis.HashiCourse。
 */
(function (root) {
  "use strict";

  // logic.js と同じ値（course.js は logic.js より先に読み込まれるため、ここで持つ）
  const VIEW_W = 1000;
  const CAMERA_LEFT = 200;
  const MAX_LEN = 800;
  const PERFECT_HALF = 10;
  const MAX_SPAN = Math.min(VIEW_W - CAMERA_LEFT - 40, MAX_LEN); // gap + w の上限
  const MIN_W = 2 * PERFECT_HALF + 20;                           // w の下限

  const tier = (from, gap, w) => Object.freeze({ from, gap: Object.freeze(gap), w: Object.freeze(w) });
  const TIERS = Object.freeze([
    tier(0, [80, 220], [110, 160]),
    tier(5, [120, 320], [80, 130]),
    tier(15, [160, 420], [60, 110]),
    tier(30, [200, 520], [45, 90])
  ]);

  // 段階表そのものが公平さの約束を守るか（最悪の組み合わせ＝上限どうし・下限で確かめる）
  TIERS.forEach((t, i) => {
    if (t.gap[0] > t.gap[1] || t.w[0] > t.w[1]) {
      throw new Error("HashiCourse: TIERS[" + i + "] の区間の下限が上限より大きい");
    }
    if (t.gap[1] + t.w[1] > MAX_SPAN) {
      throw new Error("HashiCourse: TIERS[" + i + "] は gap + w が " + MAX_SPAN + " を超えうる（公平さの約束違反）");
    }
    if (t.w[0] < MIN_W) {
      throw new Error("HashiCourse: TIERS[" + i + "] は w が " + MIN_W + " 未満になりうる（ぴったり印がはみ出す）");
    }
    if (i > 0 && t.from <= TIERS[i - 1].from) {
      throw new Error("HashiCourse: TIERS の from は昇順でなければならない");
    }
  });

  // crossed（渡った回数）→ 段階。NaN・負・数でない値は最初の段階。上限の段階で頭打ち
  function tierFor(crossed) {
    const c = typeof crossed === "number" && crossed >= 0 ? crossed : 0; // NaN は比較が false なので 0
    let found = TIERS[0];
    for (const t of TIERS) if (c >= t.from) found = t;
    return found;
  }

  // 閉区間 [lo, hi] の整数を一様に選ぶ。r は 0 以上 1 未満（範囲外は丸めて、hi を超えないようにする）
  function pickInt(lo, hi, r) {
    const rr = Math.min(Math.max(r, 0), 1);
    return Math.min(hi, lo + Math.floor(rr * (hi - lo + 1)));
  }

  function draw(random) {
    const r = random();
    if (typeof r !== "number" || !Number.isFinite(r)) {
      throw new TypeError("HashiCourse.makeNext: random() が有限の数を返さなかった（" + String(r) + "）");
    }
    return r;
  }

  // 前の葉の次の葉を作る。random: () => number（0 以上 1 未満）。gap → w の順に1回ずつ引く
  function makeNext(prev, crossed, random) {
    if (!prev || !Number.isFinite(prev.x) || !Number.isFinite(prev.w)) {
      throw new TypeError("HashiCourse.makeNext: prev は { x, w }（有限の数）でなければならない");
    }
    const rand = random === undefined ? Math.random : random;
    if (typeof rand !== "function") {
      throw new TypeError("HashiCourse.makeNext: random は関数でなければならない");
    }
    const t = tierFor(crossed);
    const gap = pickInt(t.gap[0], t.gap[1], draw(rand));
    const w = pickInt(t.w[0], t.w[1], draw(rand));
    return { x: prev.x + prev.w + gap, w };
  }

  const api = Object.freeze({ TIERS, tierFor, makeNext });
  root.HashiCourse = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
