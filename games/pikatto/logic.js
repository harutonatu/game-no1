/*
 * ピカッと早押し — ロジック（DOM に触れない純粋な計算だけ）
 *
 * 遊び方：2〜4人（または1人お試し）。startRound で待機 → applySignal で合図（armed） →
 *   applyPress で勝ち / フライング / 無視を判定。'armed' 中の押下は勝ち、'waiting' 中はフライング。
 * フライング：押した本人以外の全員に +1 点。'armed' 中でも pressedAt < signalFiredAt
 *   （合図より前の時刻の押下。受付の窓で後から届いたもの）はフライング。同時刻は 0ms の勝ち（PK-10）。
 * やり直し：redoRound は 'waiting' / 'armed' のとき、点数・回数を変えずに待ちからやり直す（PK-04）。
 * 勝利：3点先取、または maxRounds（5）に到達。最高点が同点なら 'draw'（サドンデスはしない）。
 * 乱数（signalDelay は 1000..4000 ms の整数）と現在時刻は注入可能（テスト用。seed は持たない）。
 *
 * UMD: ブラウザでは window.PikattoLogic、Node では module.exports と globalThis.PikattoLogic。
 */
(function (root) {
  "use strict";

  const DELAY_MIN = 1000;             // 合図までの最短（ms）
  const DELAY_MAX = 4000;             // 合図までの最長（ms）
  const MAX_ROUNDS = 5;               // 1試合の最大ラウンド数
  const WIN_SCORE = 3;                // この点に先に到達した人の勝ち
  const BEST_MIN = 50;                // 保存できる反応時間の最小（ms）
  const BEST_MAX = 5000;              // 保存できる反応時間の最大（ms）
  const SAVE_KEY_BEST_SOLO = "pikatto.bestSolo";

  function isFn(f) { return typeof f === "function"; }

  // 1000..4000 の整数（閉区間）に丸めた乱数
  function pickDelay(random) {
    const r = isFn(random) ? random() : Math.random();
    const n = (typeof r === "number" && isFinite(r)) ? r : 0;
    const clamped = Math.max(0, Math.min(1, n));
    // 境界を含む整数化：floor((MAX - MIN + 1) * r) + MIN、r===1 は MAX にする
    const span = DELAY_MAX - DELAY_MIN + 1;
    const d = Math.floor(span * clamped) + DELAY_MIN;
    return d > DELAY_MAX ? DELAY_MAX : d;
  }

  // 人数（vs は 2..4、solo は 1）
  function resolvePlayers(mode, players) {
    if (mode === "solo") return 1;
    const n = Number(players);
    if (n === 2 || n === 3 || n === 4) return n;
    return 2;
  }

  function zeros(n) {
    const a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = 0;
    return a;
  }

  function createGame(opts) {
    opts = opts || {};
    const mode = opts.mode === "solo" ? "solo" : "vs";
    const players = resolvePlayers(mode, opts.players);
    const random = isFn(opts.random) ? opts.random : Math.random;
    const now = isFn(opts.now) ? opts.now : Date.now;
    return {
      phase: "setup",
      players: players,
      mode: mode,
      round: 0,
      maxRounds: MAX_ROUNDS,
      scores: zeros(players),
      reactions: [],
      signalDelay: 0,
      signalFiredAt: null,
      lastOutcome: null,
      winner: null,
      _random: random,
      _now: now
    };
  }

  // 新しい state を作る（内部ユーティリティ、_random と _now は引き継ぐ）
  function clone(state, patch) {
    const next = {
      phase: state.phase,
      players: state.players,
      mode: state.mode,
      round: state.round,
      maxRounds: state.maxRounds,
      scores: state.scores.slice(),
      reactions: state.reactions.slice(),
      signalDelay: state.signalDelay,
      signalFiredAt: state.signalFiredAt,
      lastOutcome: state.lastOutcome,
      winner: state.winner,
      _random: state._random,
      _now: state._now
    };
    if (patch) for (const k of Object.keys(patch)) next[k] = patch[k];
    return next;
  }

  function startRound(state) {
    if (!state || state.phase === "done") return state;
    const delay = pickDelay(state._random);
    return clone(state, {
      phase: "waiting",
      round: state.round + 1,
      signalDelay: delay,
      signalFiredAt: null,
      lastOutcome: null
    });
  }

  // 一時停止から戻るときのやり直し：round・scores・reactions はそのまま、待ち時間を引き直す（PK-04）
  function redoRound(state) {
    if (!state || (state.phase !== "waiting" && state.phase !== "armed")) return state;
    return clone(state, {
      phase: "waiting",
      signalDelay: pickDelay(state._random),
      signalFiredAt: null,
      lastOutcome: null
    });
  }

  function applySignal(state) {
    if (!state || state.phase !== "waiting") return state;
    const t = isFn(state._now) ? state._now() : Date.now();
    return clone(state, { phase: "armed", signalFiredAt: t });
  }

  // 勝利判定：3点先取、またはラウンド上限。同点は 'draw'。
  // solo（ひとりで れんしゅう）は点を競わないので、3点では終わらず maxRounds 回で終わる
  function evaluateEnd(scores, round, maxRounds, mode) {
    const max = Math.max.apply(null, scores);
    const leaders = [];
    for (let i = 0; i < scores.length; i++) if (scores[i] === max) leaders.push(i);
    if (mode !== "solo" && max >= WIN_SCORE) {
      if (leaders.length === 1) return { done: true, winner: leaders[0] };
      return { done: true, winner: "draw" };
    }
    if (round >= maxRounds) {
      if (leaders.length === 1) return { done: true, winner: leaders[0] };
      return { done: true, winner: "draw" };
    }
    return { done: false, winner: null };
  }

  function applyPress(state, input) {
    if (!state) return { state: state, outcome: { kind: "ignore" } };
    const idx = input && Number(input.playerIdx);
    const pressedAt = input && Number(input.pressedAt);
    // 無視条件：'armed' / 'waiting' 以外
    if (state.phase !== "armed" && state.phase !== "waiting") {
      return { state: state, outcome: { kind: "ignore" } };
    }
    // インデックスが範囲外なら無視
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.players) {
      return { state: state, outcome: { kind: "ignore" } };
    }

    if (state.phase === "armed") {
      const fired = Number(state.signalFiredAt);
      const known = isFinite(fired) && isFinite(pressedAt);
      // 合図より前の時刻の押下はフライング（PK-10）。同時刻は 0ms の勝ち
      const early = known && pressedAt < fired;
      if (early) return foul(state, idx);
      const reactionMs = known ? (pressedAt - fired) : 0;
      const scores = state.scores.slice();
      scores[idx] = scores[idx] + 1;
      const reactions = state.reactions.slice();
      if (state.mode === "solo") reactions.push(reactionMs);
      const outcome = { kind: "win", player: idx, reactionMs: reactionMs, scores: scores.slice() };
      return finish(state, scores, reactions, outcome);
    }

    // 'waiting' 中はフライング
    return foul(state, idx);
  }

  // フライング：押した本人以外の全員に +1。solo は reactions に null
  function foul(state, idx) {
    const scores = state.scores.slice();
    const award = [];
    for (let i = 0; i < state.players; i++) {
      if (i !== idx) { scores[i] = scores[i] + 1; award.push(i); }
    }
    const reactions = state.reactions.slice();
    if (state.mode === "solo") reactions.push(null);
    const outcome = { kind: "foul", foulBy: idx, award: award, scores: scores.slice() };
    return finish(state, scores, reactions, outcome);
  }

  // ラウンドの確定：終わりなら 'done' と winner、まだなら 'resolved'
  function finish(state, scores, reactions, outcome) {
    const end = evaluateEnd(scores, state.round, state.maxRounds, state.mode);
    const next = clone(state, {
      phase: end.done ? "done" : "resolved",
      scores: scores,
      reactions: reactions,
      lastOutcome: outcome,
      winner: end.done ? end.winner : state.winner
    });
    return { state: next, outcome: outcome };
  }

  function decideWinner(state) {
    if (!state || state.phase !== "done") return null;
    return state.winner;
  }

  function averageMs(reactions) {
    if (!Array.isArray(reactions)) return null;
    let sum = 0, n = 0;
    for (const v of reactions) {
      if (typeof v === "number" && isFinite(v)) { sum += v; n++; }
    }
    if (n === 0) return null;
    return sum / n;
  }

  // 保存データの検証（整数で BEST_MIN..BEST_MAX のみ有効、ほかは 0）
  function validateBestSolo(raw) {
    if (typeof raw === "string") {
      if (raw === "") return 0;
      const parsed = Number(raw);
      return validateBestSolo(parsed);
    }
    if (typeof raw !== "number") return 0;
    if (!isFinite(raw)) return 0;
    if (!Number.isInteger(raw)) return 0;
    if (raw < BEST_MIN || raw > BEST_MAX) return 0;
    return raw;
  }

  const api = {
    DELAY_MIN, DELAY_MAX, MAX_ROUNDS, WIN_SCORE,
    SAVE_KEY_BEST_SOLO,
    createGame, startRound, redoRound, applySignal, applyPress,
    decideWinner, averageMs, validateBestSolo
  };
  root.PikattoLogic = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
