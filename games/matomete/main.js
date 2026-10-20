/*
 * まとめてポン — つなぎ込み・保存・画面遷移・テスト用 API
 * 契約：docs/matomete-contract.md §4（画面）・§4.5（テスト用 API）・§4.6（保存）
 * 担当B（画面）だけが編集する。
 *
 * 読み込み順：../../common/sfx.js → logic.js → render.js → input.js → main.js
 * - ルールは logic.js（MatometeLogic）だけが知っている。ここは押された所を渡し、結果を render に渡すだけ
 * - 2回タップ：1回目でかたまりを選ぶ（札「n こ ＋p てん」）、選んだかたまりの中をもう一度押すと消える。
 *   2回目は指がずれやすいので、選んだかたまりのマスから半マス以内なら（ほかのかたまりの上でも）選んだ方を押したことにする
 * - モードは やさしい（3色）・ふつう（4色）・むずかしい（5色）。最後に遊んだモードを matomete.mode に覚える
 * - 演出の順番は render の Promise で進める（タイマーで進めない）。演出中に押したら、演出を終わらせてから判定する
 */
(() => {
  "use strict";

  const L = window.MatometeLogic;
  const R = window.MatometeRender;
  const I = window.MatometeInput;
  if (!L || typeof L.newGame !== "function") throw new Error("まとめてポン: MatometeLogic が読み込まれていません（logic.js）");
  if (!R || typeof R.create !== "function") throw new Error("まとめてポン: MatometeRender が読み込まれていません（render.js）");

  const NAME = typeof L.NAME === "string" && L.NAME ? L.NAME : "まとめてポン";
  const COLS = L.COLS || 10, ROWS = L.ROWS || 20;
  const KEY_SAVE = L.SAVE_KEY_SAVE || "matomete.save";
  const KEY_BEST = { easy: L.SAVE_KEY_BEST_EASY || "matomete.bestEasy", normal: L.SAVE_KEY_BEST || "matomete.best", hard: L.SAVE_KEY_BEST_HARD || "matomete.bestHard" };
  const KEY_LEAST = L.SAVE_KEY_LEAST || { easy: "matomete.leastEasy", normal: "matomete.least", hard: "matomete.leastHard" };
  const KEY_HELP = L.SAVE_KEY_HELP || "matomete.help";
  const KEY_MODE = L.SAVE_KEY_MODE || "matomete.mode";
  const MODE_NAME = { easy: "やさしい", normal: "ふつう", hard: "むずかしい" };
  const MODE_LIST = ["easy", "normal", "hard"];
  const validMode = (m) => (MODE_LIST.includes(m) ? m : "normal");
  // 終わりのカード・さいしょからの確認で出す「ほかのモード」（1つめが #modeBtn）
  const OTHER_MODES = { easy: ["normal", "hard"], normal: ["hard", "easy"], hard: ["normal", "easy"] };
  const CHEER_LINE = L.CHEER_LINE || 5;   // のこりがこれ以下で終わったら、小さなお祝い
  const CARD_LOCK_MS = 600;     // 終わりのカードを出してから押せない時間（連打の誤タップ防止）
  const BOARD_BLOCK_MS = 300;   // カードを閉じた直後、盤の押下を受けない時間
  const OVER_PAUSE_MS = 450;    // 終わった盤を少し見せてからカードを出す
  const SMALL_CELL = 22;        // これより小さいマスの横画面では「たてむき」をすすめる

  const HINT_IDLE = "おなじ いろが つながった ところを おしてね";
  const HINT_FIRST = "おなじ いろを 2かい おすと ポン！";
  const HINT_SELECTED = "もういちど おすと ポン！";
  const HINT_SINGLE = "2こ いじょう つながると けせるよ";
  const HINT_PORTRAIT = "たてむきの ほうが あそびやすいよ";

  const now = () => performance.now();
  const $ = (id) => document.getElementById(id);
  const el = {
    title: $("gameTitle"), modeChip: $("modeChip"), helpBtn: $("helpBtn"), soundBtn: $("soundBtn"),
    score: $("score"), best: $("best"), left: $("left"), playView: $("playView"), board: $("board"), canvas: $("boardCanvas"),
    tag: $("tag"), cellInfo: $("cellInfo"), fx: $("fx"), banner: $("banner"), hint: $("hint"),
    undoBtn: $("undoBtn"), restartBtn: $("restartBtn"), overlay: $("overlay"), card: $("card")
  };
  const missing = Object.keys(el).filter((k) => !el[k]);
  if (missing.length) throw new Error("まとめてポン: 画面の部品が見つかりません：" + missing.join(", "));

  document.title = NAME;
  el.title.textContent = NAME;

  // ===== 効果音（sfx.js が無くても・音の表に無い名前でも、音なしで遊べる） =====
  const rawSfx = window.YubiSfx && typeof window.YubiSfx.create === "function" ? safeCall(() => window.YubiSfx.create("matomete"), null) : null;
  const sfx = {
    get on() { return rawSfx ? !!rawSfx.on : false; },
    unlock() { if (rawSfx) try { rawSfx.unlock(); } catch (e) { /* 無視 */ } },
    toggle() { if (rawSfx) try { return rawSfx.toggle(); } catch (e) { /* 無視 */ } return false; },
    play(name, arg) { if (rawSfx) try { rawSfx.play(name, arg); } catch (e) { /* 無視 */ } },
    buzz(p) { if (rawSfx && rawSfx.buzz) try { rawSfx.buzz(p); } catch (e) { /* 無視 */ } }
  };
  document.addEventListener("pointerdown", () => sfx.unlock(), { capture: true });
  document.addEventListener("touchend", () => sfx.unlock(), { capture: true });
  function renderSoundBtn() {
    el.soundBtn.setAttribute("aria-pressed", String(!!sfx.on));
    el.soundBtn.setAttribute("aria-label", sfx.on ? "効果音：オン" : "効果音：オフ");
  }
  function toggleSound() { sfx.unlock(); sfx.toggle(); renderSoundBtn(); }
  el.soundBtn.addEventListener("click", toggleSound);
  renderSoundBtn();

  // ===== 保存（保存できなくても遊べる） =====
  function safeCall(fn, fallback) { try { return fn(); } catch (e) { console.error("まとめてポン:", e); return fallback; } }
  function readKey(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeKey(key, val) { try { localStorage.setItem(key, val); return true; } catch (e) { return false; } }
  function removeKey(key) { try { localStorage.removeItem(key); } catch (e) { /* 無視 */ } }
  const bestOf = (mode) => safeCall(() => L.validateBest(readKey(KEY_BEST[mode] || KEY_BEST.normal)), 0) || 0;
  const leastOf = (mode) => safeCall(() => L.validateLeast(readKey(KEY_LEAST[mode] || KEY_LEAST.normal)), null);

  // ===== タイマー（later / clearLater / runId） =====
  let runId = 0;
  const timers = new Set();
  function later(fn, ms) {
    const myRun = runId;
    const id = setTimeout(() => { timers.delete(id); if (myRun !== runId) return; fn(); }, ms);
    timers.add(id);
    return id;
  }
  function clearLater() { timers.forEach((id) => clearTimeout(id)); timers.clear(); }

  // ===== 状態 =====
  let state = null;             // MatometeLogic の state（イミュータブル）
  let mode = "normal";
  let history = [];             // 1手もどす用（前の state の列）
  let moves = [];               // 押したマス [[x,y],...]（保存する）
  let selected = null;          // { cells, n, points, x, y } か null
  let cursor = null;            // キーボードのカーソル { x, y } か null（指で押したら消える）
  let phase = "idle";           // idle | selected | anim | over
  let overlayKind = null;       // null | help | over | confirm
  let best = 0;                 // 記録したベスト
  let bestShown = 0;            // 画面のベスト（最後の手では、ポンの演出が終わってから記録に合わせる）
  let lastOver = null;          // { score, improved, remaining, allClear, mode }
  let cardShownAt = -Infinity;
  let blockUntil = -Infinity;
  let pending = null;           // 演出が終わったら続ける処理
  let seq = 0;
  let portraitTipShown = false;
  let portraitTipAgain = 0;     // 1個のマスを押したときに「たてむき」を出し直した回数
  let portraitTipAt = -Infinity;

  const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  const render = R.create({ board: el.board, canvas: el.canvas, tag: el.tag, fx: el.fx, banner: el.banner }, { calm: !!reduceMotion.matches, sfx });
  if (reduceMotion.addEventListener) reduceMotion.addEventListener("change", () => render.setCalm(!!reduceMotion.matches));
  else if (reduceMotion.addListener) reduceMotion.addListener(() => render.setCalm(!!reduceMotion.matches));

  function setPhase(p) { phase = p; el.playView.dataset.phase = p; renderTools(); }
  function setHint(text) { const t = text || ""; if (el.hint.textContent !== t) el.hint.textContent = t; }
  const idleHint = () => (moves.length === 0 ? HINT_FIRST : HINT_IDLE);

  // ===== 表示 =====
  const sizeOf = (text) => (text.length <= 5 ? "s" : text.length <= 6 ? "m" : "l");
  function setNum(node, n) {
    const t = String(n);
    if (node.textContent !== t) node.textContent = t;
    node.dataset.size = sizeOf(t);
  }
  function hud() {
    if (!state) return;
    setNum(el.score, state.score);
    setNum(el.best, bestShown);
    setNum(el.left, safeCall(() => L.remaining(state), 0));
    el.score.dataset.overBest = bestShown > 0 && state.score > bestShown ? "1" : "0";
    el.modeChip.textContent = `ベスト（${MODE_NAME[mode] || MODE_NAME.normal}）`;
    el.modeChip.dataset.mode = mode;
    renderTools();
  }
  function bumpScore() {
    if (render.calm) return;
    el.score.classList.remove("bump");
    void el.score.offsetWidth;
    el.score.classList.add("bump");
  }
  function renderTools() {
    el.undoBtn.disabled = !(history.length > 0) || phase === "over";
  }
  function tagText(n, p) { return `${n} こ ＋${p} てん`; }
  function draw() {
    const sel = selected ? selected.cells : null;
    if (selected) {
      el.tag.innerHTML = "";
      const a = document.createElement("span"); a.textContent = `${selected.n} こ `;
      const b = document.createElement("span"); b.className = "pts"; b.textContent = `＋${selected.points} てん`;
      el.tag.append(a, b);
      el.tag.dataset.zero = selected.points > 0 ? "0" : "1";
      el.tag.setAttribute("aria-label", tagText(selected.n, selected.points));
    }
    render.show(state, { selected: sel, cursor });
  }
  function describeCursor() {
    if (!cursor || !state) { el.cellInfo.textContent = ""; return; }
    const v = state.grid[cursor.x] && state.grid[cursor.x][cursor.y];
    const pos = `${cursor.x + 1}れつめ、したから ${cursor.y + 1}だんめ`;
    if (v === null || v === undefined) { el.cellInfo.textContent = `${pos}：から`; return; }
    const n = safeCall(() => L.groupAt(state, cursor.x, cursor.y).length, 0);
    el.cellInfo.textContent = `${pos}：${colorName(v)}、${n}こ つながり`;
  }
  function colorName(id) { return safeCall(() => L.colorName(id), "？") || "？"; }

  function save() {
    if (!state || state.over) return;
    safeCall(() => writeKey(KEY_SAVE, L.makeSave(state, moves)), false);
  }

  // ===== 回を始める =====
  function newSeed() { return (Date.now() + Math.floor(Math.random() * 1000003)) % 2147483647; }
  function stopAll() {
    clearLater();
    runId += 1;
    pending = null;
    render.finishAll();
    render.hideBanner();
  }
  function startGame(seed, md, mv) {
    stopAll();
    const m = validMode(md);
    const base = safeCall(() => L.newGame(seed, m), null);
    if (!base) return false;
    let st = base;
    const hist = [];
    const ok = [];
    if (Array.isArray(mv) && mv.length) {
      const rp = safeCall(() => L.replay(seed, m, mv), null);
      if (rp && rp.ok) {
        for (const p of mv) {
          const r = safeCall(() => L.applyRemove(st, p[0], p[1]), null);
          if (!r || !r.outcome || r.outcome.kind !== "remove") { st = base; hist.length = 0; ok.length = 0; break; }
          hist.push(st); ok.push([p[0], p[1]]); st = r.state;
        }
      }
    }
    mode = m;
    writeKey(KEY_MODE, mode);
    best = bestOf(mode);
    bestShown = best;
    state = st; history = hist; moves = ok;
    selected = null;
    lastOver = null;
    if (state.over) {
      // 最後の手まで保存されていた（終わりの記録の前に閉じた）：ベストだけ記録して新しい回へ
      recordOver();
      return startGame(newSeed(), mode, []);
    }
    save();
    hud();
    draw();
    setPhase("idle");
    setHint(idleHint());
    describeCursor();
    return true;
  }

  // ===== 演出の続き（Promise から、または flush から同期で） =====
  function setPending(fn) {
    const token = ++seq;
    const myRun = runId;
    const p = { done: false, run() { if (p.done || myRun !== runId || token !== seq) return; p.done = true; if (pending === p) pending = null; fn(); } };
    pending = p;
    return p;
  }
  // 演出を終わらせ、続きの処理も今すぐ済ませる（全部消し→お祝い→カード のように続くので数回まわす）
  function flush() {
    let guard = 0;
    while (guard++ < 6) {
      render.finishAll();
      if (!pending) break;
      pending.run();
    }
  }

  // ===== マスを押した =====
  function deselect(silent) {
    if (!selected) return false;
    selected = null;
    draw();
    if (phase === "selected") setPhase("idle");
    if (!silent) setHint(idleHint());
    return true;
  }
  // via: 'tap'（指・マウス）か 'key'
  function onTap(x, y, via) {
    if (!state || overlayKind) return null;
    if (via !== "key" && now() < blockUntil) return null;
    if (phase === "anim" || render.busy) flush();
    if (phase === "over" || state.over || overlayKind) return null;
    if (via !== "key" && cursor) { cursor = null; describeCursor(); }
    if (x === null || y === null || x === undefined || !Number.isInteger(x) || !Number.isInteger(y)) {
      return deselect() ? "deselect" : null;
    }
    const v = state.grid[x] && state.grid[x][y];
    if (v === null || v === undefined) return deselect() ? "deselect" : null;
    if (selected && selected.cells.some((c) => c[0] === x && c[1] === y)) return doRemove(x, y);
    const cells = safeCall(() => L.groupAt(state, x, y), []);
    if (cells.length < 2) {
      selected = null;
      draw();
      render.deny(x, y);
      sfx.play("deny");
      setPhase("idle");
      setHint(portraitTipDue() ? `${HINT_SINGLE}。${HINT_PORTRAIT}` : HINT_SINGLE);
      return "invalid";
    }
    const n = cells.length;
    const points = safeCall(() => L.scoreFor(n), 0);
    selected = { cells: cells.map((c) => [c[0], c[1]]), n, points, x, y };
    sfx.play("select", n);
    setPhase("selected");
    draw();
    setHint(HINT_SELECTED);
    return "select";
  }

  function doRemove(x, y) {
    const res = safeCall(() => L.applyRemove(state, x, y), null);
    const o = res && res.outcome;
    if (!o || o.kind !== "remove") { deselect(); return "invalid"; }
    const prev = state;
    history.push(prev);
    moves.push([x, y]);
    state = res.state;
    selected = null;
    if (state.over) recordOver(o);   // 終わりは、演出の前に記録する（演出中に閉じてもベストが消えない）
    else save();
    hud();
    bumpScore();
    setPhase("anim");
    const n = o.count;
    setHint(n >= 20 ? `すごい！ ${n}こ まとめて ＋${o.points}てん！` : n >= 10 ? `やった！ ${n}こで ＋${o.points}てん` : "");
    const p = setPending(() => afterRemove(o));
    render.remove(o, prev, state).then(() => p.run());
    return "remove";
  }

  function afterRemove(o) {
    if (o.over || o.allClear || state.over) { bestShown = best; hud(); }   // ベストの数字は、ポンの演出が終わってから
    if (o.allClear) {
      setHint(`ぜんぶ けし！ ＋${o.bonus || L.ALL_CLEAR_BONUS || 1000}てん`);
      setPhase("over");
      const p = setPending(() => showOverCard());
      render.celebrate().then(() => p.run());
      return;
    }
    if (o.over || state.over) {
      setPhase("over");
      const left = safeCall(() => L.remaining(state), 99);
      if (left <= CHEER_LINE) {
        // のこりが少ない：小さなお祝い（全部消しより控えめ。点数は足さない）
        setHint(`あと すこし！ のこり ${left} こで おしまい`);
        const p = setPending(() => showOverCard());
        render.cheer().then(() => p.run());
        return;
      }
      setHint("もう けせる ところが ないよ。おしまい！");
      sfx.play("over");
      const p = setPending(() => showOverCard());
      render.delay(OVER_PAUSE_MS).then(() => p.run());
      return;
    }
    setPhase("idle");
    if (!o || o.count < 10) setHint(idleHint());
    describeCursor();
  }

  // 回の終わり：保存を消してベストを記録
  function recordOver(o) {
    const r = safeCall(() => L.recordBest(bestOf(mode), state.score), { best, improved: false });
    best = r.best;
    writeKey(KEY_BEST[mode], String(best));
    removeKey(KEY_SAVE);
    const left = safeCall(() => L.remaining(state), 0);
    // いちばん少ない のこり（壊れた値は記録なしとして扱い、今回の値で書き直す）
    const lr = safeCall(() => L.recordLeast(leastOf(mode), left), { least: left, improved: false, prev: null });
    if (lr.least !== null && lr.least !== undefined) writeKey(KEY_LEAST[mode], String(lr.least));
    lastOver = {
      score: state.score, improved: !!r.improved, mode, allClear: !!state.allClear,
      remaining: left, bonus: o && o.bonus ? o.bonus : 0,
      leastPrev: lr.prev, leastImproved: !!lr.improved
    };
  }

  function showOverCard() {
    const c = lastOver || { score: state ? state.score : 0, improved: false, mode, allClear: false, remaining: 0, leastPrev: null, leastImproved: false };
    render.hideBanner();
    const [other, other2] = OTHER_MODES[c.mode] || OTHER_MODES.normal;
    const near = !c.allClear && safeCall(() => L.isNear(c.mode, c.remaining), false);
    const leftText = c.allClear ? "ぜんぶ けせたよ！（＋1000）"
      : near ? `のこり ${c.remaining} こ。おしい！ あと すこしで ぜんぶ けしだったね！`
      : `のこり ${c.remaining} こ`;
    const leastText = c.leastPrev === null || c.leastPrev === undefined ? ""
      : `まえの いちばん すくない のこり ${c.leastPrev} こ → こんかい ${c.remaining} こ`;
    showCard(`
      <h2 id="cardTitle" data-f="h"></h2>
      ${c.allClear ? "" : '<p class="sub" data-f="r"></p>'}
      <p class="big"><span data-f="s"></span><small>てん</small></p>
      <p class="best-new" data-f="b"></p>
      <p class="left" data-f="l"></p>
      ${leastText ? '<p class="least" data-f="q"></p>' : ""}
      ${c.leastImproved ? '<p class="best-new least-new" data-f="k"></p>' : ""}
      <div class="btns row4">
        <button class="cta primary" id="againBtn" type="button" data-cmd="again">もういちど</button>
        <button class="cta" id="modeBtn" type="button" data-cmd="mode" data-mode="${other}"></button>
        <button class="cta" id="modeBtn2" type="button" data-cmd="mode" data-mode="${other2}"></button>
        <button class="cta" id="menuBtn" type="button" data-cmd="menu">メニューへ</button>
      </div>`, {
      h: c.allClear ? "ぜんぶ けし！" : "おしまい！",
      r: "もう けせる ところが ないよ",
      s: String(c.score),
      b: c.improved ? "あたらしい きろく！" : `ベスト ${best} てん（${MODE_NAME[c.mode]}）`,
      l: leftText,
      q: leastText,
      k: "さいこう きろく！"
    }, "over");
    const mb = $("modeBtn"), mb2 = $("modeBtn2");
    if (mb) mb.textContent = `${MODE_NAME[other]}で あそぶ`;
    if (mb2) mb2.textContent = `${MODE_NAME[other2]}で あそぶ`;
    if (!c.improved) { const b = el.card.querySelector(".best-new:not(.least-new)"); if (b) b.className = "note-best"; }
    cardShownAt = now();
    el.card.querySelectorAll(".btns button").forEach((btn) => btn.setAttribute("aria-disabled", "true"));
    later(() => el.card.querySelectorAll(".btns button[aria-disabled]").forEach((btn) => btn.removeAttribute("aria-disabled")), CARD_LOCK_MS);
    if (c.improved) later(() => sfx.play("best"), 500);
  }

  // ===== 1手もどす・さいしょから =====
  function undo() {
    if (overlayKind || !state) return false;
    if (phase === "anim" || render.busy) flush();
    if (overlayKind || phase === "over" || state.over) return false;
    if (!history.length) return false;
    state = history.pop();
    moves.pop();
    selected = null;
    save();
    hud();
    draw();
    sfx.play("undo");
    setPhase("idle");
    setHint(idleHint());
    describeCursor();
    return true;
  }
  function askRestart() {
    if (overlayKind || !state) return;
    if (phase === "anim" || render.busy) flush();
    if (overlayKind) return;
    const [other, other2] = OTHER_MODES[mode] || OTHER_MODES.normal;
    showCard(`
      <h2 id="cardTitle">さいしょから はじめる？</h2>
      <p data-f="m"></p>
      <div class="btns">
        <button class="cta primary" type="button" data-cmd="newBoard">あたらしい ばん</button>
        ${moves.length ? '<button class="cta" type="button" data-cmd="sameBoard">おなじ ばんを はじめから</button>' : ""}
        <button class="cta" type="button" data-cmd="switchMode" data-mode="${other}" data-f="o"></button>
        <button class="cta" type="button" data-cmd="switchMode" data-mode="${other2}" data-f="o2"></button>
        <button class="cta" type="button" data-cmd="close">やめる</button>
      </div>`, {
      m: moves.length ? "いまの ばんは おわりに なるよ（ベストには はいらない）" : "ばんを かえられるよ",
      o: `${MODE_NAME[other]}に する`,
      o2: `${MODE_NAME[other2]}に する`
    }, "confirm");
  }
  function restart(md, sameBoard) {
    hideOverlay();
    const m = MODE_LIST.includes(md) ? md : mode;
    if (sameBoard && state) startGame(state.seed, m, []);
    else startGame(newSeed(), m, []);
    sfx.play("start");
  }

  // ===== カード =====
  let focusBack = null;
  function showCard(html, fields, kind) {
    focusBack = document.activeElement;
    el.card.innerHTML = html;
    el.card.querySelectorAll("[data-f]").forEach((n) => { n.textContent = fields[n.dataset.f] ?? ""; });
    el.overlay.hidden = false;
    overlayKind = kind;
    const primary = el.card.querySelector(".primary");
    if (primary) { try { primary.focus({ preventScroll: true }); } catch (e) { primary.focus(); } }
  }
  function hideOverlay() {
    if (!overlayKind && el.overlay.hidden) return;
    el.overlay.hidden = true;
    el.card.innerHTML = "";
    overlayKind = null;
    blockUntil = now() + BOARD_BLOCK_MS;
    const fb = focusBack; focusBack = null;
    if (fb && fb.isConnected && fb !== document.body) { try { fb.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
  }
  function showHelp() {
    if (overlayKind) return;   // 終わり・確認のカードの上には重ねない
    if (phase === "anim" || render.busy) flush();
    if (overlayKind) return;
    showCard(`
      <h2 id="cardTitle">あそびかた</h2>
      <ol class="rules">
        <li><b>おなじ いろ</b>が 2こ いじょう つながった ところを おす。<b>1かいめは えらぶ（ひかる）、2かいめで ポン！</b></li>
        <li><b>たくさん まとめて</b> けすほど てんが ふえる。ぜんぶ けすと <b>＋1000</b>。</li>
        <li>けせる ところが なくなったら おしまい。<b>とちゅうで やめても つづきから あそべるよ。</b></li>
      </ol>
      <p class="note">「1手もどす」は なんかいでも。キー：やじるしで うごかす、エンターで えらぶ・けす、U もどす、M おと</p>
      <div class="btns"><button class="cta primary" type="button" data-cmd="close">わかった</button></div>`, {}, "help");
  }
  function closeCard() {
    if (overlayKind === "help") { writeKey(KEY_HELP, "1"); hideOverlay(); return; }
    if (overlayKind === "confirm") hideOverlay();
    // 終わりのカードは閉じない（「もういちど」などを選ぶ）
  }
  function goMenu() {
    clearLater();
    save();
    location.href = "../../";
  }
  el.overlay.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("[data-cmd]") : null;
    if (!btn) return;
    if (overlayKind === "over" && now() - cardShownAt < CARD_LOCK_MS) return;   // 出た直後の連打で押し間違えない
    sfx.unlock();
    const cmd = btn.dataset.cmd;
    if (cmd === "again") restart(mode);
    else if (cmd === "mode") restart(btn.dataset.mode);
    else if (cmd === "menu") goMenu();
    else if (cmd === "close") closeCard();
    else if (cmd === "newBoard") restart(mode);
    else if (cmd === "sameBoard") restart(mode, true);
    else if (cmd === "switchMode") restart(btn.dataset.mode);
  });
  el.helpBtn.addEventListener("click", () => { sfx.unlock(); showHelp(); });
  el.undoBtn.addEventListener("click", () => undo());
  el.restartBtn.addEventListener("click", () => askRestart());

  // ===== 入力 =====
  // 押した座標 → マス。選んでいる間は、選んだかたまりのマスから半マス以内なら（ほかのかたまりの真上でも）そのマスにする
  // （2回目のタップは1回目より少しずれやすい。iPhone SE で 12〜18px ほど）
  function pickCell(cx, cy) {
    if (selected && phase === "selected") {
      const near = nearSelected(cx, cy);
      if (near) return near;
    }
    return render.cellAt(cx, cy);
  }
  function nearSelected(cx, cy) {
    const c = render.cell, tol = c / 2;
    let hit = null, bestD = Infinity;
    for (const [x, y] of selected.cells) {
      const r = render.cellRect(x, y);
      const dx = Math.max(r.left - cx, 0, cx - (r.left + r.width));
      const dy = Math.max(r.top - cy, 0, cy - (r.top + r.height));
      if (dx < tol && dy < tol) {   // 半マスちょうど（となりのマスの真ん中）は含めない
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; hit = { x, y }; }
      }
    }
    return hit;
  }
  function moveCursor(d) {
    if (!state || phase === "over") return;
    if (!cursor) cursor = selected ? { x: selected.x, y: selected.y } : { x: 0, y: 0 };
    else cursor = { x: Math.max(0, Math.min(COLS - 1, cursor.x + d.dx)), y: Math.max(0, Math.min(ROWS - 1, cursor.y + d.dy)) };
    draw();
    describeCursor();
  }
  function onKey(cmd, arg) {
    switch (cmd) {
      case "move": moveCursor(arg || { dx: 0, dy: 0 }); break;
      case "activate":
        if (!cursor) { moveCursor({ dx: 0, dy: 0 }); break; }
        onTap(cursor.x, cursor.y, "key");
        describeCursor();
        break;
      case "undo": undo(); break;
      case "restart": askRestart(); break;
      case "deselect": if (deselect()) setHint(idleHint()); break;
      case "sound": toggleSound(); break;
      case "help": showHelp(); break;
      case "close": closeCard(); break;
      default: break;
    }
  }
  const input = I && typeof I.attach === "function"
    ? I.attach({ board: el.board, area: el.playView, root: document }, { onTap, onKey },
      { isBlocked: () => !!overlayKind, cellAt: (cx, cy) => pickCell(cx, cy) })
    : null;
  if (!input) console.error("まとめてポン: MatometeInput が読み込まれていません（input.js）。タップとキーボードが使えません");

  // ===== 中断 =====
  document.addEventListener("visibilitychange", () => { if (document.hidden) { flush(); save(); } });
  window.addEventListener("pagehide", () => { save(); clearLater(); });

  // ===== 大きさ =====
  let layoutQueued = false;
  const landMQ = window.matchMedia ? window.matchMedia("(orientation: landscape) and (max-height: 500px)") : { matches: false };
  const smallLandscape = () => render.cell < SMALL_CELL && window.innerWidth > window.innerHeight;
  // 1個のマスを押したとき、横向きでマスが小さければ「たてむき」をもう一度すすめる（20 秒に1回・3回まで）
  function portraitTipDue() {
    if (!smallLandscape() || portraitTipAgain >= 3 || now() - portraitTipAt < 20000) return false;
    portraitTipAgain += 1;
    portraitTipAt = now();
    return true;
  }
  function availSize() {
    // 横向きで背が低いとき：盤の列は盤の幅だけ（中央寄せ）。使える幅は「全体 − 左の列 − すき間」で決める（盤の幅に引っぱられない）
    if (landMQ.matches) {
      const app = el.playView.parentElement, cs = getComputedStyle(app);
      const inner = app.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const left = el.hint.getBoundingClientRect().width;
      const gap = parseFloat(cs.columnGap) || 0;
      return { availW: Math.max(0, inner - left - gap), availH: el.playView.clientHeight };
    }
    return { availW: el.playView.clientWidth, availH: el.playView.clientHeight };
  }
  function doLayout() {
    layoutQueued = false;
    const cell = render.layout(availSize());
    // 横向きでマスが小さいときは、1回だけ たてむきを すすめる
    if (!portraitTipShown && cell < SMALL_CELL && window.innerWidth > window.innerHeight) {
      portraitTipShown = true;
      portraitTipAt = now();
      if (phase === "idle" && !selected) setHint(HINT_PORTRAIT);
    }
    draw();
  }
  function relayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(doLayout);
  }
  window.addEventListener("resize", relayout);
  window.addEventListener("orientationchange", relayout);
  if (window.ResizeObserver) {
    let lastW = 0, lastH = 0;
    new ResizeObserver(() => {
      const w = el.playView.clientWidth, h = el.playView.clientHeight;
      if (Math.abs(w - lastW) < 1 && Math.abs(h - lastH) < 1) return;
      lastW = w; lastH = h;
      relayout();
    }).observe(el.playView);
  }

  // ===== 拡大・長押しメニューを止める（盤とボタンのダブルタップは input.js） =====
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("touchmove", (e) => { if (e.cancelable && !(e.target.closest && e.target.closest(".overlay"))) e.preventDefault(); }, { passive: false });

  // ===== テスト用（§4.5） =====
  const cloneGrid = (g) => (Array.isArray(g) ? g.map((c) => c.slice()) : []);
  window.MatometeGame = Object.freeze({
    state() {
      return {
        seed: state ? state.seed : null, mode, colors: state ? state.colors : 0, grid: state ? cloneGrid(state.grid) : [],
        score: state ? state.score : 0, moves: state ? state.moves : 0, cleared: state ? state.cleared : 0,
        over: !!(state && state.over), allClear: !!(state && state.allClear),
        remaining: state ? safeCall(() => L.remaining(state), 0) : 0, best,
        selected: selected ? selected.n : null, selectedCells: selected ? selected.cells.map((c) => c.slice()) : [],
        history: moves.map((m) => m.slice()), cursor: cursor ? { x: cursor.x, y: cursor.y } : null,
        phase, overlay: overlayKind, busy: !!render.busy, cell: render.cell, calm: !!render.calm,
        timers: timers.size, runId, frames: render.frames, fxDraws: render.fxDraws, bestShown
      };
    },
    tapCell(x, y) { return onTap(x, y, "key"); },
    select(x, y) {
      if (selected && selected.cells.some((c) => c[0] === x && c[1] === y)) return "select";
      return onTap(x, y, "key");
    },
    remove(x, y) {
      if (!(selected && selected.cells.some((c) => c[0] === x && c[1] === y))) {
        if (onTap(x, y, "key") !== "select") return "invalid";
      }
      const k = onTap(x, y, "key");
      flush();
      return k === "remove" ? "remove" : "invalid";
    },
    undo() { return undo(); },
    restart(md) { hideOverlay(); return startGame(newSeed(), MODE_LIST.includes(md) ? md : mode, []); },
    newSeed(seed, md) {
      const s = Number(seed);
      if (!Number.isFinite(s)) return false;
      hideOverlay();
      return startGame(s, MODE_LIST.includes(md) ? md : mode, []);
    },
    cellRect(x, y) { const r = render.cellRect(x, y); return { left: r.left, top: r.top, width: r.width, height: r.height }; },
    isAnimating() { return !!render.busy; },
    skip() { flush(); }
  });

  // ===== 起動 =====
  (function boot() {
    const sv = safeCall(() => L.validateSave(readKey(KEY_SAVE)), null);
    let ok = false;
    if (sv) ok = startGame(sv.seed, sv.mode, sv.moves);
    // 保存が無い（回が終わってから開き直した）ときは、最後に遊んだモードで始める（壊れた値は ふつう）
    if (!ok) ok = startGame(newSeed(), safeCall(() => L.validateMode(readKey(KEY_MODE)), "normal"), []);
    doLayout();
    if (!safeCall(() => L.validateFlag(readKey(KEY_HELP)), false)) showHelp();
  })();
})();

// オフラインでも遊べるようにする（https か localhost のときだけ有効）
if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("../../sw.js").catch(() => { /* 登録できなくてもゲームは遊べる */ });
  });
}
