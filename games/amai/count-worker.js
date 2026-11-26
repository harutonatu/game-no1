/*
 * あまいものあつめ — とける みち を数える Web Worker（2026-11-26。計画書 docs/plans/amai-worker.md・約束 §1.14 N11）
 * 数える計算（logic の makeCount）と覚え（makeCountMemo）、戻し先の調べ（makeRewind）を画面のスレッドの外で回す。
 * 数え方の中身は logic.js のまま（同じ関数を importScripts で読む）。ここでは細かく区切らず続けて回し、
 * 新しい頼み（局面が変わった）が来たら前の調べを取りやめるため、約 30ms ごとに 1 回だけ休む（届いた頼みを受け取る）。
 *
 * 頼み（画面 → ここ）：
 *   { t: "count", seq, mk, state, path }          … state から数える。mk＝覚えの印（面・絵・ちょうせん・テストの局面。変わったら覚えを作り直す）
 *   { t: "rewind", seq, mk, states, base0Sure }   … 戻し先を探す（覚えを使う）
 *   { t: "stop" }                                 … 今の調べをやめる
 *   （state・states の cells は Int8Array で来る。写さずに渡すため。ここで普通の配列に戻してから validateState に通す）
 * 答え（ここ → 画面）：
 *   { t: "ready" }                                … 読み込めた
 *   { t: "beat", seq }                            … 調べている（約 0.25 秒ごと。答えが来ないときの見張り用）
 *   { t: "count", seq, result, n, size }          … 数え終えた（size＝覚えの件数。テスト用）
 *   { t: "rewind", seq, k, sure } / { t: "rewind", seq, bad: true }   … 戻し先（bad＝局面が壊れていた：画面のスレッドで探し直す）
 *   { t: "fail", why }                            … logic.js が読めない・落ちた（画面は今までの区切って回す作りに戻る）
 */
"use strict";
(function () {
  let L = null;
  try {
    importScripts("logic.js");
    L = self.AmaiLogic;
  } catch (e) { L = null; }
  if (!L || typeof L.makeCount !== "function" || typeof L.makeRewind !== "function") {
    try { self.postMessage({ t: "fail", why: "logic" }); } catch (e) { /* 何もしない */ }
    return;
  }
  const SLICE_MS = 30;     // 続けて回す時間（新しい頼みを受け取るため、これごとに 1 回休む）
  const SLICE_STEPS = 64;  // run(n) 1 回の歩数（時計を見る回数を減らす）
  const BEAT_MS = 250;
  const now = () => (self.performance && typeof self.performance.now === "function" ? self.performance.now() : Date.now());
  let memo = null, memoKey = null;
  let job = null;          // { t, seq, r, states }
  let looping = false, lastBeat = 0;
  function memoFor(mk) {
    const k = typeof mk === "string" ? mk : "";
    if (!memo || memoKey !== k) { memo = L.makeCountMemo(); memoKey = k; }
    return memo;
  }
  // 画面は cells を Int8Array で送る（写さずに渡すため）。普通の配列に戻してから validateState に通す（中身・確かめ方は今までと同じ）
  function unpack(st) {
    if (st && typeof st === "object" && ArrayBuffer.isView(st.cells)) return Object.assign({}, st, { cells: Array.from(st.cells) });
    return st;
  }
  function post(m) { try { self.postMessage(m); } catch (e) { /* 何もしない */ } }
  function start(m) {
    const seq = m.seq;
    if (m.t === "count") {
      const st = L.validateState(unpack(m.state));
      if (!st) { job = null; post({ t: "count", seq, result: "unknown", n: 0 }); return; }
      const path = Array.isArray(m.path) ? m.path : null;
      job = { t: "count", seq, r: L.makeCount(st, { memo: memoFor(m.mk), path }) };
    } else if (m.t === "rewind") {
      const raw = Array.isArray(m.states) ? m.states : [];
      const list = raw.map((s) => L.validateState(unpack(s)));
      if (!list.length || list.some((s) => !s)) { job = null; post({ t: "rewind", seq, bad: true }); return; }
      job = { t: "rewind", seq, r: L.makeRewind(list, { base0Sure: m.base0Sure === true, memo: memoFor(m.mk) }) };
    }
    lastBeat = now();
    if (!looping) { looping = true; setTimeout(loop, 0); }
  }
  function loop() {
    const j = job;
    if (!j) { looping = false; return; }
    const t0 = now();
    let r = null;
    try {
      do { r = j.r.run(SLICE_STEPS); } while (!r.done && now() - t0 < SLICE_MS);
    } catch (e) { job = null; looping = false; post({ t: "fail", why: "run" }); return; }
    if (job !== j) { setTimeout(loop, 0); return; }
    if (r.done) {
      job = null; looping = false;
      if (j.t === "count") post({ t: "count", seq: j.seq, result: r.result, n: Number.isSafeInteger(r.n) ? r.n : 0, size: memo ? memo.size : 0 });   // size：覚えの件数（テスト用）
      else post({ t: "rewind", seq: j.seq, k: r.k, sure: r.sure === true });
      return;
    }
    if (now() - lastBeat >= BEAT_MS) { lastBeat = now(); post({ t: "beat", seq: j.seq }); }
    setTimeout(loop, 0);   // 休む：この間に届いた頼み（新しい局面・やめる）を受け取る
  }
  self.onmessage = (ev) => {
    const m = ev && ev.data;
    if (!m || typeof m !== "object") return;
    try {
      if (m.t === "stop") { job = null; return; }
      if (m.t === "count" || m.t === "rewind") start(m);
    } catch (e) { job = null; post({ t: "fail", why: "start" }); }
  };
  post({ t: "ready" });
})();
