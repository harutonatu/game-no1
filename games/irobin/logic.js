/*
 * いろびん — ロジック（DOM・時計・Math.random・localStorage に触れない純粋な計算だけ）
 * 契約：docs/irobin-contract.md §1.1（ルール）・§3（定数・色・面の表）・§4（API）
 * 担当A（ロジック）だけが編集する。
 *
 * UMD: ブラウザでは window.IrobinLogic、Node では module.exports と globalThis.IrobinLogic。
 *
 * 中の作り：
 *   - 公開する state はイミュータブル（凍結した新しいオブジェクトと配列）。
 *   - 計算の中では、瓶1本を1つの整数に詰めた「詰めた形」を使う（ソルバーを速くするため）。
 *       ビット 0〜2：段の数（0〜4）、ビット 3：栓、
 *       段 i（下から 0〜3）：ビット 4+5i から 4 ビットが色、その上の 1 ビットが隠れ。
 *     applyMove もソルバーも、同じ関数 pourCount（注げるか・注ぐ量）と step（注ぐ・栓・届け）を通る。
 *     → 画面の決まりとソルバーの決まりが食い違わない。
 *   - 生成の上限は時間ではなく「調べた局面の数」（どの端末でも同じ面ができる）。
 */
(function (root) {
  "use strict";

  const NAME = "いろびん";          // 表示名（仮名。ここだけ変えれば画面の名前が変わる）
  const CAP = 4;
  const ORDER_SLOTS = 2;
  const MAX_COLORS = 9;
  const MAX_MOVES_SAVED = 2000;
  const SOLVE_NODE_LIMIT = 40000;
  const GEN_NODE_BUDGET = 200000;
  const GEN_TRIES = 40;
  const SAVE_KEY_BEST = "irobin.best";
  const SAVE_KEY_SAVE = "irobin.save";
  const SAVE_KEY_HELP = "irobin.help";
  const MAX_BOTTLES = MAX_COLORS + 2;  // 画面が並べる瓶の最大（11 本）。生成はこれを超えない

  // 色（契約 §3.1）。Okabe-Ito を土台に、記号つき
  const COLORS = Object.freeze([
    { id: 0, key: "orange", name: "オレンジ", hex: "#E69F00", mark: "circle" },
    { id: 1, key: "sky",    name: "みずいろ", hex: "#56B4E9", mark: "triangle" },
    { id: 2, key: "green",  name: "みどり",   hex: "#009E73", mark: "square" },
    { id: 3, key: "yellow", name: "きいろ",   hex: "#F0E442", mark: "diamond" },
    { id: 4, key: "blue",   name: "あお",     hex: "#0072B2", mark: "star" },
    { id: 5, key: "red",    name: "あか",     hex: "#D55E00", mark: "cross" },
    { id: 6, key: "pink",   name: "ピンク",   hex: "#CC79A7", mark: "heart" },
    { id: 7, key: "white",  name: "しろ",     hex: "#EEEEEE", mark: "ring" },
    { id: 8, key: "brown",  name: "ちゃいろ", hex: "#9A6A3A", mark: "wave" }
  ].map((c) => Object.freeze(c)));

  // お客さんの動物（render の ANIMALS と同じ並び。logic は render に頼らないので写しを持つ）
  const ANIMAL_KEYS = Object.freeze(["kuma", "usagi", "neko", "penguin", "risu", "hitsuji"]);

  // 面の難しさの表（契約 §3.2）。from 面から次の行の from-1 面まで
  const LEVELS = Object.freeze([
    { from: 1,  colors: 2, empties: 1, hidden: "none", order: "easy" },
    { from: 2,  colors: 3, empties: 2, hidden: "none", order: "easy" },
    { from: 3,  colors: 4, empties: 2, hidden: "none", order: "easy" },
    { from: 4,  colors: 5, empties: 2, hidden: "none", order: "easy" },
    { from: 6,  colors: 6, empties: 2, hidden: "none", order: "random" },
    { from: 10, colors: 7, empties: 2, hidden: Object.freeze([12, 14]), order: "random" },
    { from: 15, colors: 8, empties: 2, hidden: "odd", order: "random" },
    { from: 25, colors: 9, empties: 2, hidden: "odd", order: "random" },
    { from: 40, colors: 9, empties: 2, hidden: "all", order: "random" }
  ].map((r) => Object.freeze(r)));

  // 生成の予算の分け方：表どおり → 易しい側（fallback 1）→ 固定の面（fallback 2）
  const RESERVE_FALLBACK1 = 50000;
  const RESERVE_FALLBACK2 = 5000;
  const MIN_SOLVE_NODES = 500;   // 残りがこれ未満なら、その段階はあきらめる

  // 理由のコード（pourCount の負の戻り値）
  const R_EMPTY = -1, R_SEALED = -2, R_FULL = -3, R_MISMATCH = -4;
  const REASON = { "-1": "empty", "-2": "sealed", "-3": "full", "-4": "mismatch" };

  // ---------------------------------------------------------------- 小さな道具

  function isInt(n) { return Number.isSafeInteger(n); }

  // 面番号を 1 以上の安全な整数に丸める（壊れた値は 1）
  function normLevel(level) {
    let n;
    try { n = Number(level); } catch (e) { return 1; }
    if (!Number.isFinite(n)) return 1;
    n = Math.floor(n);
    if (n < 1) return 1;
    if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
    return n;
  }

  function fmix(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  // 再現できる乱数（mulberry32）。0 以上 1 未満
  function makeRng(seed) {
    let a;
    try { a = Number(seed) >>> 0; } catch (e) { a = 0; }
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 面番号 → 32bit の種
  function seedFor(level) {
    const n = normLevel(level);
    const lo = (n % 4294967296) >>> 0;
    const hi = Math.floor(n / 4294967296) >>> 0;
    return fmix((fmix(lo ^ 0x1b873593) + Math.imul(hi ^ 0x27d4eb2f, 0x165667b1) + 0x9e3779b9) | 0);
  }

  function randInt(rng, n) { return Math.floor(rng() * n); }
  function shuffle(rng, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(rng, i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function rowFor(level) {
    let row = LEVELS[0];
    for (const r of LEVELS) if (level >= r.from) row = r;
    return row;
  }

  // 面の難しさ（契約 §3.2）
  function paramsFor(level) {
    const n = normLevel(level);
    const r = rowFor(n);
    let hidden;
    if (r.hidden === "all") hidden = true;
    else if (r.hidden === "odd") hidden = n % 2 === 1;
    else if (Array.isArray(r.hidden)) hidden = r.hidden.indexOf(n) >= 0;
    else hidden = false;
    return Object.freeze({ colors: r.colors, empties: r.empties, hidden, order: r.order });
  }

  // ---------------------------------------------------------------- 詰めた形の瓶

  function col(b, i) { return (b >>> (4 + 5 * i)) & 15; }
  function hid(b, i) { return (b >>> (8 + 5 * i)) & 1; }
  function len(b) { return b & 7; }
  function isSealedP(b) { return (b & 8) !== 0; }

  function packBottle(cells, hidden, sealed) {
    let b = cells.length;
    for (let i = 0; i < cells.length; i++) {
      b |= (cells[i] & 15) << (4 + 5 * i);
      if (hidden && hidden[i]) b |= 1 << (8 + 5 * i);
    }
    if (sealed) b |= 8;
    return b;
  }

  // 注げるか・注ぐ量。正の数＝注ぐ量、負の数＝理由のコード。番号の範囲と同じ瓶は呼ぶ側が確かめる
  function pourCount(bots, from, to) {
    const s = bots[from], d = bots[to];
    const sl = len(s), dl = len(d);
    if (sl === 0) return R_EMPTY;
    if (isSealedP(s) || isSealedP(d)) return R_SEALED;
    if (dl >= CAP) return R_FULL;
    const c = col(s, sl - 1);
    if (dl > 0 && col(d, dl - 1) !== c) return R_MISMATCH;
    let run = 1;   // 一番上は必ず見えている。その下は「見えている同じ色」だけ数える
    while (run < sl && col(s, sl - 1 - run) === c && !hid(s, sl - 1 - run)) run++;
    return Math.min(run, CAP - dl);
  }

  // 注ぐ → そろえば栓 → 届けられるものを届ける（連鎖）。ctx を書き換える。ev があれば出来事を記録
  // ctx = { bots:number[], slots:number[]（-1＝いない）, queue:number[], qi, served, total, any }
  function step(ctx, from, to, count, ev) {
    const bots = ctx.bots;
    const s = bots[from], d = bots[to];
    const sl = len(s), dl = len(d);
    const c = col(s, sl - 1);

    // 元の瓶から count 段を取る
    let ns = s & ~7;
    for (let i = sl - count; i < sl; i++) ns &= ~(31 << (4 + 5 * i));
    const nsl = sl - count;
    ns |= nsl;
    if (nsl > 0 && hid(ns, nsl - 1)) {                          // 新しく一番上になった1段だけ見えるようにする
      ns &= ~(1 << (8 + 5 * (nsl - 1)));
      if (ev) ev.revealed.push({ bottle: from, index: nsl - 1, color: col(ns, nsl - 1) });
    }

    // 相手の瓶に count 段を足す（足した段は見えている）
    let nd = d & ~7;
    for (let i = dl; i < dl + count; i++) nd |= c << (4 + 5 * i);
    const ndl = dl + count;
    nd |= ndl;

    let sealed = -1;
    if (ndl === CAP) {
      let same = true;
      for (let i = 0; i < CAP; i++) if (col(nd, i) !== c) { same = false; break; }
      if (same) {
        for (let i = 0; i < CAP; i++) {
          if (hid(nd, i)) {
            nd &= ~(1 << (8 + 5 * i));                           // そろったら隠れも全部見える
            if (ev) ev.revealed.push({ bottle: to, index: i, color: c });
          }
        }
        nd |= 8;
        sealed = to;
      }
    }
    bots[from] = ns;
    bots[to] = nd;
    if (ev) { ev.color = c; ev.count = count; ev.sealed = sealed >= 0 ? sealed : null; }

    if (sealed < 0) return;
    if (ctx.any) {                                               // 注文を気にしない（generate の 'easy' 用）
      bots[sealed] = 0;
      ctx.served++;
      return;
    }
    deliverAll(ctx, ev);
  }

  // 見えているお客さんに合う、栓をした瓶を届ける。枠は左から、瓶は番号の小さい方から。来た客にも続けて届ける
  function deliverAll(ctx, ev) {
    const bots = ctx.bots;
    let progress = true;
    while (progress) {
      progress = false;
      for (let si = 0; si < ctx.slots.length && !progress; si++) {
        const want = ctx.slots[si];
        if (want < 0) continue;
        for (let b = 0; b < bots.length; b++) {
          const x = bots[b];
          if (isSealedP(x) && col(x, 0) === want) {
            bots[b] = 0;                                         // 届けた瓶は空の瓶に置き換わる
            ctx.served++;
            const next = ctx.qi < ctx.queue.length ? ctx.queue[ctx.qi++] : -1;
            ctx.slots[si] = next;
            if (ev) {
              ev.deliveries.push({ bottle: b, slot: si, color: want });
              ev.arrivals.push({ slot: si, color: next >= 0 ? next : null });
            }
            progress = true;
            break;
          }
        }
      }
    }
  }

  function cloneCtx(c) {
    return { bots: c.bots.slice(), slots: c.slots.slice(), queue: c.queue, qi: c.qi, served: c.served, total: c.total, any: c.any };
  }

  function ctxWon(c) { return c.served >= c.total; }

  function hasMove(bots) {
    for (let f = 0; f < bots.length; f++) {
      for (let t = 0; t < bots.length; t++) {
        if (f !== t && pourCount(bots, f, t) > 0) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- 公開の state ⇔ 詰めた形

  function okColor(n) { return isInt(n) && n >= 0 && n < MAX_COLORS; }
  function okCount(n) { return isInt(n) && n >= 0; }

  // おかしな形なら null。例外は出さない
  function toCtx(state) {
    try {
      if (!state || typeof state !== "object") return null;
      const B = state.bottles;
      if (!Array.isArray(B) || B.length < 1 || B.length > 16) return null;
      const bots = [];
      for (const b of B) {
        if (!b || typeof b !== "object" || !Array.isArray(b.cells)) return null;
        const cells = b.cells;
        if (cells.length > CAP) return null;
        for (const x of cells) if (!okColor(x)) return null;
        const h = Array.isArray(b.hidden) && b.hidden.length === cells.length ? b.hidden.map((v) => v === true) : cells.map(() => false);
        if (h.length) h[h.length - 1] = false;                    // 一番上は必ず見えている
        const sealed = b.sealed === true;
        if (sealed) {
          if (cells.length !== CAP || cells.some((x) => x !== cells[0])) return null;
          for (let i = 0; i < h.length; i++) h[i] = false;
        }
        bots.push(packBottle(cells, h, sealed));
      }
      if (!Array.isArray(state.slots) || state.slots.length !== ORDER_SLOTS) return null;
      const slots = [];
      for (const x of state.slots) {
        if (x === null) slots.push(-1);
        else if (okColor(x)) slots.push(x);
        else return null;
      }
      if (!Array.isArray(state.queue)) return null;
      for (const x of state.queue) if (!okColor(x)) return null;
      const served = state.served, total = state.total, moves = state.moves;
      if (!okCount(served) || !okCount(total) || !okCount(moves) || served > total) return null;
      const p = state.params && typeof state.params === "object" ? state.params : null;
      return {
        bots, slots, queue: state.queue.slice(), qi: 0, served, total, any: false,
        level: normLevel(state.level),
        params: p ? Object.freeze({ colors: p.colors, empties: p.empties, hidden: p.hidden === true, order: p.order }) : paramsFor(state.level),
        moves
      };
    } catch (e) {
      return null;
    }
  }

  function fromCtx(c, level, params, moves) {
    const bottles = c.bots.map((b) => {
      const n = len(b);
      const cells = [], hidden = [];
      for (let i = 0; i < n; i++) { cells.push(col(b, i)); hidden.push(hid(b, i) === 1); }
      return Object.freeze({ cells: Object.freeze(cells), hidden: Object.freeze(hidden), sealed: isSealedP(b) });
    });
    return Object.freeze({
      level,
      params,
      bottles: Object.freeze(bottles),
      slots: Object.freeze(c.slots.map((x) => (x >= 0 ? x : null))),
      queue: Object.freeze(c.queue.slice(c.qi)),
      served: c.served,
      total: c.total,
      moves,
      won: ctxWon(c)
    });
  }

  // 画面担当の setState 用：おかしな形なら null、正しければ凍結した state（契約外の補助）
  function normalizeState(raw) {
    const c = toCtx(raw);
    if (!c) return null;
    return fromCtx(c, c.level, c.params, c.moves);
  }

  // ---------------------------------------------------------------- 手

  function pourCheck(state, from, to) {
    const c = toCtx(state);
    if (!c) return { ok: false, reason: "range" };
    if (ctxWon(c)) return { ok: false, reason: "won" };
    const n = c.bots.length;
    if (!isInt(from) || !isInt(to) || from < 0 || to < 0 || from >= n || to >= n) return { ok: false, reason: "range" };
    if (from === to) return { ok: false, reason: "same" };
    const k = pourCount(c.bots, from, to);
    if (k > 0) return { ok: true, count: k };
    return { ok: false, reason: REASON[k] };
  }

  function applyMove(state, from, to) {
    const chk = pourCheck(state, from, to);
    if (!chk.ok) return { state, outcome: { kind: "invalid", reason: chk.reason, from, to } };
    const c = toCtx(state);
    const ev = { revealed: [], deliveries: [], arrivals: [], color: -1, count: 0, sealed: null };
    step(c, from, to, chk.count, ev);
    const ns = fromCtx(c, c.level, c.params, c.moves + 1);
    const won = ns.won;
    const stuck = !won && !hasMove(c.bots);
    return {
      state: ns,
      outcome: {
        kind: "pour", from, to, color: ev.color, count: ev.count,
        revealed: ev.revealed, sealed: ev.sealed, deliveries: ev.deliveries, arrivals: ev.arrivals,
        won, stuck
      }
    };
  }

  function legalMoves(state) {
    const c = toCtx(state);
    if (!c || ctxWon(c)) return [];
    const out = [];
    for (let f = 0; f < c.bots.length; f++) {
      for (let t = 0; t < c.bots.length; t++) {
        if (f !== t && pourCount(c.bots, f, t) > 0) out.push([f, t]);
      }
    }
    return out;
  }

  function isStuck(state) {
    const c = toCtx(state);
    if (!c || ctxWon(c)) return false;
    return !hasMove(c.bots);
  }

  // ---------------------------------------------------------------- ソルバー

  // 局面のキー。瓶の並びは順不同として正規化する（小さい順に並べる）。瓶1本＝24bit を 12bit ずつ2文字に
  const keyBuf = [], keyCodes = [];
  function keyOf(c) {
    const b = c.bots, n = b.length;
    const a = keyBuf;
    a.length = n;
    for (let i = 0; i < n; i++) {                                // 本数が少ないので挿入ソート
      const x = b[i];
      let j = i - 1;
      while (j >= 0 && a[j] > x) { a[j + 1] = a[j]; j--; }
      a[j + 1] = x;
    }
    const codes = keyCodes;
    codes.length = 0;
    for (let i = 0; i < n; i++) codes.push(a[i] & 4095, a[i] >>> 12);
    if (!c.any) codes.push(c.slots[0] + 1, c.slots[1] + 1, c.qi);
    return String.fromCharCode.apply(null, codes);
  }

  // 試す手を、良さそうな順に並べる。[from, to, count] の配列
  function genMoves(c) {
    const bots = c.bots;
    const n = bots.length;
    let firstEmpty = -1;
    for (let i = 0; i < n; i++) if (bots[i] === 0) { firstEmpty = i; break; }
    const list = [];
    for (let f = 0; f < n; f++) {
      const s = bots[f];
      const sl = len(s);
      if (sl === 0 || isSealedP(s)) continue;
      const top = col(s, sl - 1);
      let run = 1;
      while (run < sl && col(s, sl - 1 - run) === top && !hid(s, sl - 1 - run)) run++;
      const wholeOneColor = run === sl;                         // 中身が全部見えていて1色だけ
      const wanted = !c.any && (c.slots[0] === top || c.slots[1] === top);
      for (let t = 0; t < n; t++) {
        if (t === f) continue;
        const d = bots[t];
        if (d === 0 && t !== firstEmpty) continue;              // 空の瓶はどれも同じ：最初の1本だけ試す
        const k = pourCount(bots, f, t);
        if (k <= 0) continue;
        const dl = len(d);
        if (dl === 0 && wholeOneColor) continue;                // まるごと空の瓶へ移すだけの、むだな手
        let score = 0;
        if (dl > 0) {
          score += 20;
          if (dl + k === CAP) {
            let same = true;
            for (let i = 0; i < dl; i++) if (col(d, i) !== top) { same = false; break; }
            if (same) score += c.any || wanted ? 100 : -30;     // そろう。注文に無い色は場所をふさぐ
          }
        } else {
          score -= 10;
        }
        if (k < run) score -= 15;                                // 同じ色を分けてしまう
        if (sl - k === 0) score += 6;
        else if (hid(s, sl - k - 1)) score += 12;               // 隠れが見える
        if (wanted) score += 5;
        list.push([f, t, k, score]);
      }
    }
    list.sort((a, b) => b[3] - a[3]);
    return list;
  }

  // 深さ優先＋同じ局面を二度調べない。nodes＝調べた局面の数（手を当てて作った局面ごとに 1。既に見た局面も数える）
  // → 1局面あたりの仕事がほぼ一定になり、上限の局面数から最悪の時間を見積もれる
  function solveCtx(c0, limit) {
    if (ctxWon(c0)) return { solved: true, moves: [], nodes: 1, exhausted: false };
    const visited = new Set();
    visited.add(keyOf(c0));
    let nodes = 1;
    const stack = [{ c: c0, list: genMoves(c0), i: 0 }];
    while (stack.length) {
      const fr = stack[stack.length - 1];
      if (fr.i >= fr.list.length) { stack.pop(); continue; }
      if (nodes >= limit) return { solved: false, moves: null, nodes, exhausted: true };
      const m = fr.list[fr.i++];
      const nc = cloneCtx(fr.c);
      step(nc, m[0], m[1], m[2], null);
      nodes++;
      if (ctxWon(nc)) {
        const moves = stack.map((f) => { const x = f.list[f.i - 1]; return [x[0], x[1]]; });
        return { solved: true, moves, nodes, exhausted: false };
      }
      const k = keyOf(nc);
      if (visited.has(k)) continue;
      visited.add(k);
      stack.push({ c: nc, list: genMoves(nc), i: 0 });
    }
    return { solved: false, moves: null, nodes, exhausted: false };
  }

  function solve(state, opts) {
    const any = !!(opts && opts.anyOrder);
    let limit = SOLVE_NODE_LIMIT;
    if (opts && isInt(opts.nodeLimit) && opts.nodeLimit > 0) limit = opts.nodeLimit;
    const c = toCtx(state);
    if (!c) return { solved: false, moves: null, nodes: 0, exhausted: false };
    if (any) {
      c.any = true;
      for (let i = 0; i < c.bots.length; i++) {                  // 待っている瓶は、もう届けたものとして扱う
        if (isSealedP(c.bots[i])) { c.bots[i] = 0; c.served++; }
      }
    }
    return solveCtx(c, limit);
  }

  // ---------------------------------------------------------------- 生成

  // 選んだ色を各4段ずつ混ぜて配る。最初からそろった瓶は作らない
  function deal(rng, p, shuffleOrder) {
    const ids = shuffle(rng, COLORS.map((x) => x.id)).slice(0, p.colors);
    let chunks = null;
    for (let t = 0; t < 200 && !chunks; t++) {
      const pool = [];
      for (const id of ids) for (let k = 0; k < CAP; k++) pool.push(id);
      shuffle(rng, pool);
      const cs = [];
      for (let i = 0; i < p.colors; i++) cs.push(pool.slice(i * CAP, i * CAP + CAP));
      if (!cs.some((a) => a.every((x) => x === a[0]))) chunks = cs;
    }
    if (!chunks) return null;
    const bots = chunks.map((cells) => packBottle(cells, cells.map((_, i) => p.hidden && i < CAP - 1), false));
    for (let i = 0; i < p.empties; i++) bots.push(0);
    if (shuffleOrder) shuffle(rng, bots);
    return { ids, bots };
  }

  function sealOrderOf(c0, moves) {
    const c = cloneCtx(c0);
    c.any = true;
    const order = [];
    for (const m of moves) {
      const k = pourCount(c.bots, m[0], m[1]);
      const ev = { revealed: [], deliveries: [], arrivals: [], color: -1, count: 0, sealed: null };
      step(c, m[0], m[1], k, ev);
      if (ev.sealed !== null) order.push(ev.color);
    }
    return order;
  }

  function startCtx(bots, queue, total) {
    const q = queue.slice();
    const slots = [];
    let qi = 0;
    for (let i = 0; i < ORDER_SLOTS; i++) slots.push(qi < q.length ? q[qi++] : -1);
    return { bots: bots.slice(), slots, queue: q, qi, served: 0, total, any: false };
  }

  // params で1回分の生成を試す。成功したら { bots, queue, solution }
  function tryParams(rng, p, level, maxNodes, acc) {
    for (let t = 0; t < GEN_TRIES; t++) {
      const left = maxNodes - acc.nodes;
      if (left < MIN_SOLVE_NODES) return null;
      const dl = deal(rng, p, p.order === "random" || level >= 6);
      if (!dl) continue;
      acc.tries++;
      const limit = Math.min(SOLVE_NODE_LIMIT, left);
      if (p.order === "easy") {
        const c = { bots: dl.bots.slice(), slots: [-1, -1], queue: [], qi: 0, served: 0, total: p.colors, any: true };
        const r = solveCtx(c, limit);
        acc.nodes += r.nodes;
        if (!r.solved) continue;
        const queue = sealOrderOf(c, r.moves);
        if (queue.length !== p.colors) continue;
        return { bots: dl.bots, queue, solution: r.moves };
      } else {
        const queue = shuffle(rng, dl.ids.slice());
        const c = startCtx(dl.bots, queue, p.colors);
        const r = solveCtx(c, limit);
        acc.nodes += r.nodes;
        if (!r.solved) continue;
        return { bots: dl.bots, queue, solution: r.moves };
      }
    }
    return null;
  }

  // 必ず解ける固定の予備の面（fallback 2）
  const SPARE = Object.freeze({
    cells: [[0, 1, 2, 0], [1, 2, 0, 1], [2, 0, 1, 2], [], []],
    params: Object.freeze({ colors: 3, empties: 2, hidden: false, order: "easy" })
  });

  function buildState(level, params, bots, queue) {
    const c = startCtx(bots, queue, queue.length);
    return fromCtx(c, level, params, 0);
  }

  function runMoves(state, moves) {
    let s = state;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (!Array.isArray(m)) return { state: s, ok: false, applied: i };
      const r = applyMove(s, m[0], m[1]);
      if (r.outcome.kind !== "pour") return { state: s, ok: false, applied: i };
      s = r.state;
    }
    return { state: s, ok: true, applied: moves.length };
  }

  const cache = new Map();
  const CACHE_MAX = 6;

  function createLevel(level, opts) {
    const lv = normLevel(level);
    const override = opts && opts.params && typeof opts.params === "object" ? opts.params : null;
    if (!override && cache.has(lv)) return cache.get(lv);

    const seed = seedFor(lv);
    const rng = makeRng(seed);
    const base = override ? sanitizeParams(override) : paramsFor(lv);
    const acc = { nodes: 0, tries: 0 };
    let fallback = 0, params = base;

    let got = tryParams(rng, base, lv, GEN_NODE_BUDGET - RESERVE_FALLBACK1 - RESERVE_FALLBACK2, acc);
    if (got && !verify(lv, base, got)) got = null;
    if (!got) {
      fallback = 1;
      params = easierParams(base);
      got = tryParams(rng, params, lv, GEN_NODE_BUDGET - RESERVE_FALLBACK2, acc);
      if (got && !verify(lv, params, got)) got = null;
    }
    if (!got) {
      fallback = 2;
      params = SPARE.params;
      const bots = SPARE.cells.map((cells) => packBottle(cells, null, false));
      const c = { bots: bots.slice(), slots: [-1, -1], queue: [], qi: 0, served: 0, total: 3, any: true };
      const r = solveCtx(c, Math.max(1, Math.min(RESERVE_FALLBACK2, GEN_NODE_BUDGET - acc.nodes)));
      acc.nodes += r.nodes;
      const queue = r.solved ? sealOrderOf(c, r.moves) : [0, 1, 2];
      got = { bots, queue, solution: r.solved ? r.moves : [] };
    }

    const state = buildState(lv, params, got.bots, got.queue);
    const solution = Object.freeze(got.solution.map((m) => Object.freeze([m[0], m[1]])));
    const info = Object.freeze({ level: lv, seed, params, tries: acc.tries, nodes: acc.nodes, fallback, solution });
    const out = Object.freeze({ state, info });
    if (!override) {
      cache.set(lv, out);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    return out;
  }

  // 解いた手順を、画面と同じ applyMove で再生して won になるか
  function verify(lv, params, got) {
    const st = buildState(lv, params, got.bots, got.queue);
    const r = runMoves(st, got.solution);
    return r.ok && r.state.won === true;
  }

  // 易しい側：空き瓶 +1・注文の順 'easy'。瓶が MAX_BOTTLES を超えるときは、代わりに色を1つ減らす
  function easierParams(p) {
    let colors = p.colors, empties = p.empties + 1;
    if (colors + empties > MAX_BOTTLES) { empties = p.empties; colors = Math.max(2, colors - 1); }
    return Object.freeze({ colors, empties, hidden: p.hidden, order: "easy" });
  }

  function sanitizeParams(o) {
    const colors = isInt(o.colors) ? Math.min(MAX_COLORS, Math.max(2, o.colors)) : 2;
    const empties = isInt(o.empties) ? Math.min(MAX_BOTTLES - colors, Math.max(1, o.empties)) : 2;
    return Object.freeze({ colors, empties, hidden: o.hidden === true, order: o.order === "random" ? "random" : "easy" });
  }

  // ---------------------------------------------------------------- 再生と保存

  function replay(level, moves) {
    const st = createLevel(level).state;
    if (!Array.isArray(moves)) return { state: st, ok: false, applied: 0 };
    return runMoves(st, moves);
  }

  function hud(state) {
    const s = state && typeof state === "object" ? state : {};
    const n = (v, d) => (isInt(v) && v >= 0 ? v : d);
    const total = n(s.total, 0);
    const served = Math.min(n(s.served, 0), total);
    return { level: normLevel(s.level), served, total, left: total - served, moves: n(s.moves, 0) };
  }

  function validateBest(raw) {
    if (typeof raw !== "string" && typeof raw !== "number") return 0;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
  }

  function validateSave(raw) {
    if (typeof raw !== "string") return null;
    let o;
    try { o = JSON.parse(raw); } catch (e) { return null; }
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    if (o.v !== 1) return null;
    if (!Number.isSafeInteger(o.level) || o.level < 1) return null;
    if (!Array.isArray(o.moves) || o.moves.length > MAX_MOVES_SAVED) return null;
    for (const m of o.moves) if (!Array.isArray(m) || m.length !== 2 || !Number.isSafeInteger(m[0]) || !Number.isSafeInteger(m[1]) || m[0] < 0 || m[1] < 0) return null;
    return { level: o.level, moves: o.moves.map((m) => [m[0], m[1]]) };
  }

  function makeSave(level, moves) {
    const mv = Array.isArray(moves) ? moves.map((m) => (Array.isArray(m) ? [m[0], m[1]] : m)) : [];
    return JSON.stringify({ v: 1, level, moves: mv });
  }

  function recordBest(prevBest, clearedLevel) {
    const prev = validateBest(prevBest);
    const cl = validateBest(clearedLevel);
    const improved = cl > prev;
    return { best: improved ? cl : prev, improved };
  }

  function validateFlag(raw) {
    return raw === "1";
  }

  // ---------------------------------------------------------------- 見た目に使う純粋な値

  // お客さんの動物。orderIndex＝その面の注文の何番目か（0 から）。続く2人は必ず違う動物
  function animalFor(level, orderIndex) {
    const rng = makeRng(seedFor(level) ^ 0xA5A5A5A5);
    const perm = shuffle(rng, ANIMAL_KEYS.slice());
    let i;
    try { i = Number(orderIndex); } catch (e) { i = 0; }
    i = Number.isFinite(i) && i >= 0 ? Math.floor(i) : 0;
    if (i > 1e9) i = i % 6000000;
    const k = ANIMAL_KEYS.length;
    return perm[(i + Math.floor(i / k)) % k];
  }

  function colorName(id) {
    return okColor(id) ? COLORS[id].name : "？";
  }

  const api = Object.freeze({
    NAME, CAP, ORDER_SLOTS, MAX_COLORS, MAX_MOVES_SAVED, SOLVE_NODE_LIMIT, GEN_NODE_BUDGET, GEN_TRIES,
    SAVE_KEY_BEST, SAVE_KEY_SAVE, SAVE_KEY_HELP, COLORS, LEVELS,
    MAX_BOTTLES, ANIMAL_KEYS,
    makeRng, seedFor, paramsFor, createLevel,
    pourCheck, applyMove, legalMoves, isStuck,
    solve,
    replay, hud, validateBest, validateSave, makeSave, recordBest, validateFlag,
    animalFor, colorName,
    normalizeState
  });
  root.IrobinLogic = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
