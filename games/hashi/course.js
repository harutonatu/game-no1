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

  // ===== ステージ（ステージ N の葉の並びは N だけで決まる。落ちても同じ並びでやり直せる） =====
  //
  // ステージ N（1 以上の整数）は、はじめの葉（x=0・幅 FIRST_W・高さ 0）の先に K 枚の葉が並び、K 枚目がゴール。
  //   K = min(5 + floor((N - 1) / 3), 10)   … 1〜3 は 5 枚、4〜6 は 6 枚、… 16 以降は 10 枚
  //   難しさ d = (min(N, STAGE_CAP) - 1) / (STAGE_CAP - 1)（0..1。STAGE_CAP=50 以降は同じ難しさ）
  //   間の距離 gap ∈ [80 + 140d, 200 + 300d]、葉の幅 w ∈ [110 - 65d, 160 - 70d]
  //   葉の高さ y ∈ [0, H]、H = round(STAGE_YMAX × √(max(0, N - 2) / 48))（1〜2 は平ら、50 で 160）
  // 公平さの約束（読み込み時に N=1〜STAGE_CAP で確かめる）：
  //   gap + w <= 760（画面を送ると次の葉が必ず見える）、√((gap + w)² + H²) <= MAX_LEN（どの葉にも届く）、
  //   H < gap の下限（高すぎて届かない茎は、次の葉の手前に倒れる＝「みじかすぎ」と分かる）、w >= 40
  const STAGE_CAP = 50;
  const STAGE_YMAX = 160;
  const FIRST_W = 160;
  function stageNo(n) {
    const v = Math.floor(Number(n));
    return Number.isFinite(v) && v >= 1 ? v : 1;
  }
  function stageGoal(n) { return Math.min(5 + Math.floor((stageNo(n) - 1) / 3), 10); }
  function stageParams(n) {
    const N = stageNo(n);
    const d = (Math.min(N, STAGE_CAP) - 1) / (STAGE_CAP - 1);
    const lift = Math.round(STAGE_YMAX * Math.sqrt(Math.max(0, Math.min(N, STAGE_CAP) - 2) / (STAGE_CAP - 2)));
    return Object.freeze({
      goal: stageGoal(N),
      gap: Object.freeze([Math.round(80 + 140 * d), Math.round(200 + 300 * d)]),
      w: Object.freeze([Math.round(110 - 65 * d), Math.round(160 - 70 * d)]),
      lift
    });
  }
  for (let n = 1; n <= STAGE_CAP; n++) {
    const t = stageParams(n);
    if (t.gap[1] + t.w[1] > MAX_SPAN || Math.hypot(t.gap[1] + t.w[1], t.lift) > MAX_LEN || t.lift >= t.gap[0] || t.w[0] < MIN_W || t.lift > STAGE_YMAX) {
      throw new Error("HashiCourse: ステージ " + n + " の段階が公平さの約束を守らない");
    }
  }
  // 再現できる乱数（mulberry32）。ステージ番号から種を作る
  function seeded(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // ステージ N の葉の並び（凍結した K+1 枚。[0] がはじめの葉、[K] がゴールで goal: true）
  function stageCourse(n) {
    const N = stageNo(n);
    const t = stageParams(N);
    const rand = seeded(Math.imul(N, 2654435761) ^ 0x5eed);
    const out = [Object.freeze({ x: 0, w: FIRST_W, y: 0 })];
    for (let i = 1; i <= t.goal; i++) {
      const prev = out[i - 1];
      const gap = pickInt(t.gap[0], t.gap[1], rand());
      const w = pickInt(t.w[0], t.w[1], rand());
      const y = pickInt(0, t.lift, rand());
      const leaf = { x: prev.x + prev.w + gap, w, y };
      if (i === t.goal) leaf.goal = true;
      out.push(Object.freeze(leaf));
    }
    return Object.freeze(out);
  }

  const api = Object.freeze({ TIERS, tierFor, makeNext, STAGE_CAP, STAGE_YMAX, stageGoal, stageParams, stageCourse });
  root.HashiCourse = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
