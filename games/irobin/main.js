/*
 * いろびん — つなぎ込み・保存・画面遷移・テスト用 API
 * 契約：docs/irobin-contract.md §8（進行）・§8.6（テスト用 API）
 * 担当B（画面）だけが編集する。
 *
 * 読み込み順：../../common/sfx.js → logic.js → render.js → input.js → main.js
 * - ルールは logic.js（IrobinLogic）だけが知っている。ここは手を当てて、結果を render に渡すだけ
 * - 画面の数は hud() の値をそのまま出す（UI で ±1 しない）
 * - タイマーは later() だけで作る。clearLater() で片付ける。runId が違う回の続きは動かない
 * - 演出の順番は render の Promise で進める（タイマーで進めない）
 */
(() => {
  "use strict";

  const L = window.IrobinLogic;
  const R = window.IrobinRender;
  const I = window.IrobinInput;
  if (!L || typeof L.createLevel !== "function") throw new Error("いろびん: IrobinLogic が読み込まれていません（logic.js）");
  if (!R || typeof R.create !== "function") throw new Error("いろびん: IrobinRender が読み込まれていません（render.js）");

  const NAME = typeof L.NAME === "string" && L.NAME ? L.NAME : "いろびん";
  const KEY_BEST = L.SAVE_KEY_BEST || "irobin.best";
  const KEY_SAVE = L.SAVE_KEY_SAVE || "irobin.save";
  const KEY_HELP = L.SAVE_KEY_HELP || "irobin.help";
  const KEY_CLOTH = L.SAVE_KEY_CLOTH || "irobin.cloth";
  const CARD_LOCK_MS = 400;     // カードを出してから押せない時間
  const BOARD_BLOCK_MS = 300;   // カードを閉じた直後、瓶の押下を受けない時間

  const HINT_IDLE = "びんを えらんで、べつの びんに そそいでね";
  const HINT_FIRST = "うえの トレイと おなじ いろを、1ぽんに 4つ あつめよう。びんを おしてね";
  const HINT_SELECTED = "どの びんに そそぐ？（もう一度 おすと やめる）";
  const HINT_STUCK = "うごかせる びんが ないよ。「1手もどす」か「やりなおし」を おしてね";
  // 手は残っているが、もう全部は届けられない（ソルバーが上限内で「解けない」と言い切れたときだけ）
  const HINT_DOOMED = "この ままだと ぜんぶは とどけられないよ。「1手もどす」を おしてみてね";
  const DOOM_NODE_LIMIT = 3000;   // 詰み予備軍を調べる上限（局面の数。上限に届いたら何も言わない）
  // 布の瓶（§17.4）
  const HINT_CLOTH_FIRST = "ぬのの びんは、おきゃくさんに とどけると あくよ。どの いろから とどけるか かんがえよう";
  // 横向きで背が低い画面（SE 横）はヒントの欄が狭いので、短い文にする
  const shortHint = () => { try { return !!(window.matchMedia && window.matchMedia("(orientation: landscape) and (max-height: 500px)").matches); } catch (e) { return false; } };
  const clothHint = (m) => (shortHint() ? `ぬのの びんは あと ${m} にん とどけると あくよ` : `ぬのの びんは、おきゃくさんに あと ${m} にん とどけると あくよ`);
  const DENY_HINT = {
    covered: "ぬのの びんは、おきゃくさんに とどけると あくよ",
    mismatch: "いろが ちがうよ。うえの いろが おなじ びんか、からの びんに そそげるよ",
    full: "その びんは いっぱいだよ",
    sealed: "せんを した びんには いれられないよ",
    empty: "からの びんは えらべないよ",
    same: "",
    range: "",
    won: ""
  };

  const now = () => performance.now();
  const $ = (id) => document.getElementById(id);
  const el = {
    head: document.querySelector(".head"), title: $("gameTitle"), level: $("level"), levelBox: $("levelBox"),
    helpBtn: $("helpBtn"), soundBtn: $("soundBtn"), playView: $("playView"), shop: $("shop"), left: $("left"),
    board: $("board"), fx: $("fx"), hint: $("hint"), undoBtn: $("undoBtn"), restartBtn: $("restartBtn"),
    overlay: $("overlay"), card: $("card")
  };
  const missing = Object.keys(el).filter((k) => !el[k]);
  if (missing.length) throw new Error("いろびん: 画面の部品が見つかりません：" + missing.join(", "));

  // 表示名は logic.js の定数1か所から
  document.title = NAME;
  el.title.textContent = NAME;

  // ===== 効果音（sfx.js が無くても音なしで遊べる） =====
  const sfx = window.YubiSfx && typeof window.YubiSfx.create === "function" ? window.YubiSfx.create("irobin")
    : { on: false, unlock() {}, toggle() { return false; }, play() {}, buzz() {} };
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
  function readKey(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeKey(key, val) {
    if (stale) return false;
    try { localStorage.setItem(key, val); noteSaved(key); return true; } catch (e) { return false; }
  }

  // ===== 古いページから書き戻さない（契約 §18・X-20） =====
  // bfcache（戻る・進む）で戻ったページや、裏にいる間にほかのタブが同じゲームを遊んだページは、メモリの古い面・手を保存に書かず、
  // 開き直して今の保存から続ける。見張るのは途中の保存（irobin.save）だけ。このページが最後に読んだ・書いた生の文字と比べる
  const WATCH_KEYS = [KEY_SAVE];
  const seenRaw = new Map(WATCH_KEYS.map((k) => [k, readKey(k)]));
  let stale = false;                     // true：このページはもう保存しない（開き直す前）
  let reloading = false;                 // true：開き直しをもう頼んだ（pageshow と visibilitychange の両方から呼ばれても1回だけ）
  function noteSaved(key) { if (seenRaw.has(key)) seenRaw.set(key, readKey(key)); }
  // 保存がこのページの覚えた文字と違う（ほかのページ・タブが書いた）
  const changedElsewhere = () => WATCH_KEYS.some((k) => readKey(k) !== seenRaw.get(k));
  // 表に戻ったとき（visible・pageshow）：ほかで変わっていたら書かずに開き直す（true なら、ほかの処理はしない）
  function reloadIfStale() {
    if (!stale && WATCH_KEYS.every((k) => readKey(k) === seenRaw.get(k))) return false;
    stale = true;
    if (reloading) return true;
    reloading = true;
    try { location.reload(); } catch (e) { console.error("いろびん: 開き直せませんでした", e); }
    return true;
  }
  // 裏へ回る（hidden）・閉じる（pagehide）ときの保存の前に比べ直す：保存がほかで変わっていたら、storage イベントが届く前でも
  // stale にする（このあとの保存は stale を見て静かに抜ける。表に戻れば開き直す）。見えている間の保存は今までどおり後勝ち
  function staleOnHide() {
    if (!stale && changedElsewhere()) stale = true;
    return stale;
  }
  // 裏にいる間にほかのタブが同じ保存を書いたら、このページの保存を止める（表に戻ったら開き直す。見えている間は今までどおり）
  window.addEventListener("storage", (e) => { if (document.hidden && (e.key === null || seenRaw.has(e.key))) stale = true; });
  let best = safeCall(() => L.validateBest(readKey(KEY_BEST)), 0) || 0;
  function safeCall(fn, fallback) { try { return fn(); } catch (e) { console.error("いろびん:", e); return fallback; } }

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
  let level = 1;
  let state = null;             // IrobinLogic の state（イミュータブル）
  let history = [];             // 1手もどす用（前の state の列）
  let moves = [];               // 注いだ手 [[fromId,toId],...]（瓶の固定の番号 id。届けると位置がずれるので id で保存する）
  let selected = null;
  let phase = "idle";           // idle | selected | pouring | stuck | clear
  let paused = false;           // 裏に回っている
  let overlayKind = null;       // null | help | clear | confirm
  let custom = null;            // setState で入れた最初の局面（テスト用。保存しない）
  let cardShownAt = -Infinity;
  let blockUntil = -Infinity;
  let pending = null;           // 演出が終わったら続ける処理 { token, fn }
  let pourSeq = 0;
  let lastClear = null;         // { level, moves, improved, par }
  let par = 0;                  // この面の目安の手数（生成時にソルバーが見つけた解の長さ。最短とは限らない）
  let doomed = false;           // 手はあるが、もう解けない（ソルバーが言い切れたとき）
  let clothTipLevel = 0;        // 布の説明を出した面（やりなおしても同じ面なら出す）
  let clothTip = false;         // はじめて布が出た面（面の最初のヒントを布の説明にし、布の瓶を指さす）

  const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  const render = R.create({ board: el.board, shop: el.shop, fx: el.fx }, { calm: !!reduceMotion.matches, sfx });
  if (reduceMotion.addEventListener) reduceMotion.addEventListener("change", () => render.setCalm(!!reduceMotion.matches));
  else if (reduceMotion.addListener) reduceMotion.addListener(() => render.setCalm(!!reduceMotion.matches));

  const shownPhase = () => (paused ? "paused" : phase);
  function syncPhase() { el.playView.dataset.phase = shownPhase(); }
  function setPhase(p) { phase = p; syncPhase(); renderTools(); }
  // ヒントは2行分の高さに固定。長い文言は字を 15→12px まで小さくして収める（配置は動かさない）
  function setHint(text) {
    const t = text || "";
    if (el.hint.textContent === t) return;
    el.hint.textContent = t;
    el.hint.style.fontSize = "";
    if (!t) return;
    for (const px of [14, 13, 12]) {
      if (el.hint.scrollHeight <= el.hint.clientHeight + 1) break;
      el.hint.style.fontSize = px + "px";
    }
  }
  const coverOf = (b) => (b && Number.isSafeInteger(b.cover) ? b.cover : null);
  const hasCloth = (s) => !!(s && Array.isArray(s.bottles) && s.bottles.some((b) => coverOf(b) !== null));
  const idleHint = () => (doomed ? HINT_DOOMED : clothTip && moves.length === 0 ? (shortHint() ? "ぬのの びんは とどけると あくよ" : HINT_CLOTH_FIRST) : level <= 2 && moves.length === 0 ? HINT_FIRST : HINT_IDLE);
  const isStuckNow = () => !!(state && !state.won && safeCall(() => L.isStuck(state), false));
  const restPhase = () => (state && state.won ? "clear" : isStuckNow() ? "stuck" : selected !== null ? "selected" : "idle");

  // 表示：ロジックの値をそのまま出す
  const sizeOf = (text) => (text.length <= 4 ? "s" : text.length <= 8 ? "m" : "l");
  function hud() {
    if (!state) return;
    const h = safeCall(() => L.hud(state), null);
    if (!h) return;
    const lv = String(h.level);
    if (el.level.textContent !== lv) el.level.textContent = lv;
    const size = sizeOf(lv);
    el.levelBox.dataset.size = size;
    el.head.dataset.long = size === "l" ? "1" : "0";
    const left = String(h.left);
    if (el.left.textContent !== left) el.left.textContent = left;
    renderTools();
  }
  function renderTools() {
    el.undoBtn.disabled = !(history.length > 0) || phase === "clear";
    const need = phase === "stuck" || (doomed && phase !== "clear" && phase !== "pouring");
    // 押しても何も起きないボタンは目立たせない（戻す履歴が無い・手が0でやりなおす意味が無い）
    el.undoBtn.dataset.attention = need && !el.undoBtn.disabled ? "1" : "0";
    el.restartBtn.dataset.attention = need && moves.length > 0 ? "1" : "0";
    // 最初の2面は、注文（トレイ）を指さす
    el.shop.dataset.tip = level <= 2 && moves.length === 0 && phase !== "clear" ? "1" : "0";
    // はじめて布が出た面は、布の瓶の札を指さす
    el.board.dataset.clothTip = clothTip && moves.length === 0 && phase !== "clear" ? "1" : "0";
  }
  // 手は残っているのに、もう全部は届けられない局面かどうか（注ぎ終わって落ち着いたときに1回だけ調べる）。
  // 上限に届いた（exhausted）ときは言い切れないので何も言わない。setState の局面（テスト用・色が4段そろわないこともある）は調べない
  function checkDoomed() {
    doomed = false;
    if (custom || !state || state.won || phase === "stuck" || phase === "clear" || phase === "pouring") return false;
    if (!moves.length) return false;   // 面の最初は必ず解ける（生成で確かめ済み）
    const r = safeCall(() => L.solve(state, { nodeLimit: DOOM_NODE_LIMIT }), null);
    doomed = !!(r && r.solved === false && r.exhausted === false);
    return doomed;
  }
  function save() {
    if (custom || !state) return;
    safeCall(() => writeKey(KEY_SAVE, L.makeSave(level, moves)), false);
  }

  // ===== 面を始める =====
  function buildHistory(lv, mv) {
    const created = L.createLevel(lv);
    const base = created && created.state;
    if (!base) throw new Error("面を作れませんでした");
    let st = base;
    const hist = [];
    const ok = [];
    if (Array.isArray(mv) && mv.length) {
      const rp = safeCall(() => L.replay(lv, mv), null);
      if (rp && rp.ok) {
        for (const m of mv) {
          const r = L.moveById(st, m[0], m[1]);
          if (!r || !r.outcome || r.outcome.kind !== "pour") { return { base, st: base, hist: [], ok: [], created }; }
          hist.push(st); ok.push([m[0], m[1]]); st = r.state;
        }
      }
    }
    return { base, st, hist, ok, created };
  }
  // 置き場所の数（§17.7）：面の最初の瓶の本数（id は 0〜本数-1）
  const placesOf = (s) => (s && Array.isArray(s.bottles) ? s.bottles.reduce((m, b) => Math.max(m, Number.isSafeInteger(b.id) ? b.id + 1 : 0), s.bottles.length) : 0);
  const ordersOf = (s) => [].concat(s && s.slots || [], s && s.queue || []).filter((x) => x !== null && x !== undefined);
  function startLevel(lv, mv) {
    clearLater();
    runId += 1;
    pending = null;
    render.finishAll();
    const n = Number.isSafeInteger(lv) && lv >= 1 ? lv : 1;
    let b;
    try {
      b = buildHistory(n, mv);
    } catch (e) {
      console.error("いろびん: 面を始められませんでした", e);
      setHint("よみこみに しっぱいしました。ひらきなおしてね");
      return false;
    }
    level = n;
    state = b.st;
    history = b.hist;
    moves = b.ok;
    custom = null;
    selected = null;
    doomed = false;
    par = b.created && b.created.info && Array.isArray(b.created.info.solution) ? b.created.info.solution.length : 0;
    // はじめて布が出た面：布の説明を出し、見たことを保存する
    // （やりなおしで同じ面に戻ったときも出す。保存は見せた時点で "1"）
    const clothSeen = safeCall(() => L.validateFlag(readKey(KEY_CLOTH)), false);
    clothTip = hasCloth(b.base) && (clothTipLevel === n || (!clothSeen && moves.length === 0));
    if (clothTip) { clothTipLevel = n; if (!clothSeen) writeKey(KEY_CLOTH, "1"); }
    render.build(state, { orders: ordersOf(b.base), places: b.base.bottles.length });
    render.update(state, { selected: null });
    if (state.won) {   // 最後の手まで保存されていた（クリアの記録の前に閉じた）
      const r = L.recordBest(best, level);
      best = r.best; writeKey(KEY_BEST, String(best));
      return startLevel(level + 1, []);
    }
    save();
    hud();
    setPhase(restPhase());
    checkDoomed();
    renderTools();
    setHint(phase === "stuck" ? HINT_STUCK : idleHint());
    return true;
  }

  // ===== 演出の続き（Promise から、または skip から同期で） =====
  function setPending(fn) {
    const token = ++pourSeq;
    const myRun = runId;
    const p = { token, done: false, run() { if (p.done || myRun !== runId || token !== pourSeq) return; p.done = true; if (pending === p) pending = null; fn(); } };
    pending = p;
    return p;
  }
  // 演出を終わらせ、続きの処理も今すぐ済ませる
  function flush() {
    let guard = 0;
    while (guard++ < 4) {
      render.finishAll();
      if (!pending) break;
      pending.run();
    }
  }

  // ===== 瓶を押した =====
  // index：今の並びの位置。id（任意）：押したボタンの瓶の固定の番号。届けの演出中に押すと、ボタンの位置（data-index）は
  // 届ける前の並びのままなので、id があれば演出を終わらせた後の state で位置を引き直す（消えた瓶なら何もしない）
  function onPick(index, via, id) {
    if (!state || overlayKind || paused) return null;
    if (phase === "clear" || state.won) return null;
    // 演出中に押したら、演出を終わらせてから判定する（見た目と判定を食い違わせない。そろった光と音は finishAll が必ず出す）
    if (phase === "pouring" && render.busy) flush();
    if (phase === "clear" || state.won) return null;
    let i = Number(index);
    if (Number.isSafeInteger(id)) {
      i = safeCall(() => L.indexOfId(state, id), -1);
      if (i < 0) return null;
    }
    const b = state.bottles[i];
    if (!Number.isInteger(i) || !b) return null;
    // 布の瓶：選べない。揺らしてヒント。選んでいる瓶があっても、その選びは解除しない（§17.4）
    if (coverOf(b) !== null) {
      const m = Math.max(0, coverOf(b) - (Number(state.served) || 0));
      setHint(clothHint(m));
      render.deny(i, "covered");
      sfx.play("deny");
      return "covered";
    }
    if (selected === null) {
      if (!b.cells || b.cells.length === 0) { setHint(DENY_HINT.empty); render.deny(i, "empty"); return null; }
      if (b.sealed) { setHint("せんを した びんは うごかせないよ"); render.deny(i, "sealed"); return null; }
      selected = i;
      sfx.play("pick");
      render.update(state, { selected });
      if (phase !== "pouring") setPhase("selected");
      setHint(HINT_SELECTED);
      return "select";
    }
    if (selected === i) {
      selected = null;
      sfx.play("drop");
      render.update(state, { selected: null });
      if (phase !== "pouring") setPhase(restPhase());
      setHint(phase === "stuck" ? HINT_STUCK : idleHint());
      return "deselect";
    }
    const from = selected;
    selected = null;
    const res = safeCall(() => L.applyMove(state, from, i), null);
    const o = res && res.outcome;
    if (!o || o.kind !== "pour") {
      render.update(state, { selected: null });
      render.deny(i, o && o.reason);
      sfx.play("deny");
      setHint((o && DENY_HINT[o.reason]) || idleHint());
      if (phase !== "pouring") setPhase(restPhase());
      return "invalid";
    }
    // 前の演出が残っていれば終わらせてから（速く遊ぶ人を待たせない）
    flush();
    history.push(state);
    moves.push([o.fromId, o.toId]);
    state = res.state;
    const wasDoomed = doomed;
    doomed = false;
    save();
    hud();
    setPhase("pouring");
    // 注いでいる間は、前のヒント（「どの びんに そそぐ？」）を残さない。そろった・届いた などは演出のあとに出す
    setHint("");
    const p = setPending(() => afterPour(o, wasDoomed));
    render.pour(o, state).then(() => p.run());
    return "pour";
  }

  // 布が取れたときの一言（§17.8）：空き瓶なら「あきびんが でてきた！」、中身あり（色水）なら何も言わない（null。音と光だけ）
  function unveilHint(o) {
    const list = Array.isArray(o && o.unveiled) ? o.unveiled : [];
    return list.some((u) => !Array.isArray(u.cells) || u.cells.length === 0) ? "あきびんが でてきた！" : null;
  }
  function afterPour(o, wasDoomed) {
    if (state.won) { onClear(); return; }
    if (o.stuck || isStuckNow()) {
      selected = null;
      render.update(state, { selected: null });
      setPhase("stuck");
      setHint(HINT_STUCK);
      sfx.play("stuck");
      return;
    }
    setPhase(selected !== null ? "selected" : "idle");
    if (checkDoomed()) {
      renderTools();
      if (selected === null) setHint(HINT_DOOMED);
      if (!wasDoomed) sfx.play("stuck");   // 知らせる音は、解けなくなった最初の1回だけ
      return;
    }
    if (selected !== null) { setHint(HINT_SELECTED); return; }
    const uh = unveilHint(o);
    if (uh) { setHint(uh); return; }
    const del = Array.isArray(o.deliveries) ? o.deliveries : [];
    const auto = del.filter((d) => d.bottle !== o.sealed);   // まっていた びんが、来たお客さんに じどうで届いた
    if (auto.length) {
      setHint(`${auto.map((d) => colorName(d.color)).join("・")}の びんが じどうで とどいたよ！`);
    } else if (del.length) {
      setHint(`${del.map((d) => colorName(d.color)).join("・")}の びんを とどけたよ！`);
    } else if (o.sealed !== null && o.sealed !== undefined) {
      setHint(`${colorName(o.color)}が そろった！ ${colorName(o.color)}の おきゃくさんを まってるよ`);
    } else {
      setHint(idleHint());
    }
  }
  function colorName(id) { return safeCall(() => L.colorName(id), "？") || "？"; }

  // ===== 面クリア =====
  function onClear() {
    selected = null;
    setPhase("clear");
    const r = safeCall(() => L.recordBest(best, level), { best, improved: false });
    const improved = !!r.improved;
    best = r.best;
    writeKey(KEY_BEST, String(best));
    const h = L.hud(state);
    lastClear = { level, moves: h.moves, improved, par };
    writeKey(KEY_SAVE, L.makeSave(level + 1, []));
    setHint(`${level} めん クリア！`);
    sfx.play("clear");
    const p = setPending(() => showClearCard());
    render.celebrate().then(() => p.run());
  }
  function showClearCard() {
    const c = lastClear || { level, moves: moves.length, improved: false, par };
    // 上達が見えるように、目安の手数と比べて星1〜3（責めない言い方。目安は最短とは限らないので「めやす」と書く）
    const p = Number(c.par) || 0;
    const star = !p ? 0 : c.moves <= p ? 3 : c.moves <= Math.ceil(p * 1.5) ? 2 : 1;
    const starText = star === 3 ? "★★★ すごい！" : star === 2 ? "★★☆ いいね！" : star === 1 ? "★☆☆ つぎは めやすを めざそう" : "";
    showCard(`
      <h2 id="cardTitle" data-f="h"></h2>
      <p class="stars" data-f="s"></p>
      <p data-f="m"></p>
      <p class="best-new" data-f="b"></p>
      <div class="btns">
        <button class="cta primary" type="button" data-cmd="next">つぎの めんへ</button>
        <button class="cta" type="button" data-cmd="menu">メニューへ</button>
      </div>`, { h: `${c.level} めん クリア！`, s: starText, m: p ? `${c.moves}かい そそいで とどけたよ（めやす ${p}かい）` : `${c.moves}かい そそいで とどけたよ`, b: c.improved ? "あたらしい きろく！" : "" }, "clear");
    if (!c.improved) { const b = el.card.querySelector(".best-new"); if (b) b.hidden = true; }
    if (!starText) { const sEl = el.card.querySelector(".stars"); if (sEl) sEl.hidden = true; }
    else { const sEl = el.card.querySelector(".stars"); if (sEl) { sEl.dataset.stars = String(star); sEl.setAttribute("aria-label", `ほし ${star}つ`); } }
    cardShownAt = now();
    el.card.querySelectorAll(".btns button").forEach((btn) => btn.setAttribute("aria-disabled", "true"));
    later(() => el.card.querySelectorAll(".btns button[aria-disabled]").forEach((btn) => btn.removeAttribute("aria-disabled")), CARD_LOCK_MS);
    if (c.improved) later(() => sfx.play("best"), 450);
  }

  // ===== お助け =====
  function undo() {
    if (overlayKind || !state || state.won || phase === "clear") return;
    if (!history.length) return;
    flush();
    if (state.won || phase === "clear") return;
    state = history.pop();
    moves.pop();
    selected = null;
    doomed = false;
    render.update(state, { selected: null });
    save();
    hud();
    sfx.play("undo");
    setPhase(restPhase());
    checkDoomed();
    renderTools();
    setHint(phase === "stuck" ? HINT_STUCK : idleHint());
  }
  function askRestart() {
    if (overlayKind || !state || phase === "clear") return;
    if (!moves.length) return;
    flush();
    render.pause();
    showCard(`
      <h2 id="cardTitle">さいしょから やりなおす？</h2>
      <p>この めんの はじめに もどるよ</p>
      <div class="btns">
        <button class="cta primary" type="button" data-cmd="restartYes">やりなおす</button>
        <button class="cta" type="button" data-cmd="close">やめる</button>
      </div>`, {}, "confirm");
  }
  function doRestart() {
    hideOverlay();
    if (!document.hidden) render.resume();
    if (custom) {
      const base = custom;
      flush();
      state = base; history = []; moves = []; selected = null; doomed = false;
      render.build(state, { orders: ordersOf(base), places: placesOf(base) });
      hud();
      setPhase(restPhase());
      setHint(idleHint());
      return;
    }
    startLevel(level, []);
    sfx.play("start");
  }
  function deselect() {
    if (selected === null || overlayKind) return;
    selected = null;
    sfx.play("drop");
    render.update(state, { selected: null });
    if (phase !== "pouring") setPhase(restPhase());
    setHint(phase === "stuck" ? HINT_STUCK : idleHint());
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
    if (overlayKind === "help") return;
    if (overlayKind) return;   // クリア・確認のカードの上には重ねない
    render.pause();
    showCard(`
      <h2 id="cardTitle">あそびかた</h2>
      <ol class="rules">
        <li>びんを おして、べつの びんを おすと <b>そそげる</b>よ（<b>おなじ いろ</b>の うえ か、<b>からの びん</b>に）。</li>
        <li>4つ そろうと <b>せん</b>。うえの <b>トレイと おなじ いろ</b>なら おきゃくさんに とどくよ。まだ いない いろは、その ばしょで まつよ。</li>
        <li>「？」は うえを どかすと みえるよ。<b>ぬのの びん</b>は、とどけた にんずで あくよ。</li>
      </ol>
      <p class="note">こまったら「1手もどす」「やりなおし」。キー：やじるし・エンター・すうじ（10ぽんめまで）で えらぶ。U もどす、M おと。</p>
      <div class="btns"><button class="cta primary" type="button" data-cmd="close">わかった</button></div>`, {}, "help");
  }
  function closeCard() {
    if (overlayKind === "help") {
      writeKey(KEY_HELP, "1");
      hideOverlay();
      if (!document.hidden) render.resume();
      return;
    }
    if (overlayKind === "confirm") {
      hideOverlay();
      if (!document.hidden) render.resume();
    }
    // クリアのカードは閉じない（「つぎの めんへ」を選ぶ）
  }
  function goNext() {
    sfx.unlock();
    hideOverlay();
    startLevel(level < Number.MAX_SAFE_INTEGER ? level + 1 : level, []);
    sfx.play("start");
  }
  function goMenu() {
    clearLater();
    save();
    location.href = "../../";
  }
  el.overlay.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("[data-cmd]") : null;
    if (!btn) return;
    if (overlayKind === "clear" && now() - cardShownAt < CARD_LOCK_MS) return;   // 出た直後の連打で押し間違えない
    const cmd = btn.dataset.cmd;
    if (cmd === "next") goNext();
    else if (cmd === "menu") goMenu();
    else if (cmd === "close") closeCard();
    else if (cmd === "restartYes") doRestart();
  });
  el.helpBtn.addEventListener("click", () => { sfx.unlock(); showHelp(); });
  // 届ける演出の途中でお客さんを押したら、演出を飛ばす（連鎖が長いときに待たせない）
  el.shop.addEventListener("pointerdown", () => { if (phase === "pouring" && render.busy && !overlayKind && !paused) flush(); });
  el.undoBtn.addEventListener("click", () => undo());
  el.restartBtn.addEventListener("click", () => askRestart());

  // ===== 入力 =====
  function onCommand(cmd) {
    switch (cmd) {
      case "undo": undo(); break;
      case "restart": askRestart(); break;
      case "deselect": deselect(); break;
      case "sound": toggleSound(); break;
      case "help": showHelp(); break;
      case "close": closeCard(); break;
      default: break;
    }
  }
  const input = I && typeof I.attach === "function"
    ? I.attach({ board: el.board, root: document }, { onPick, onCommand }, { isBlocked: () => !!overlayKind || paused || now() < blockUntil })
    : null;
  if (!input) console.error("いろびん: IrobinInput が読み込まれていません（input.js）。キーボードとタップの一部が使えません");

  // ===== 中断 =====
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      paused = true;
      render.pause();
      syncPhase();
      staleOnHide();   // 裏へ回る前に、保存がほかで変わっていないか比べ直す（変わっていれば stale になり、save は書かない。X-20）
      save();
    } else {
      if (reloadIfStale()) return;
      paused = false;
      if (overlayKind !== "help" && overlayKind !== "confirm") render.resume();
      syncPhase();
    }
  });
  window.addEventListener("pagehide", () => { staleOnHide(); save(); clearLater(); });
  // pagehide の clearLater で「押せない」を外すタイマーが消えると、ボタンがうすいまま残る。戻ったときに外す
  //（ミチビキ空港 §19 A3 の横展開。カードを出す続きは演出の時計なので消えない）
  window.addEventListener("pageshow", () => {
    if (reloadIfStale()) return;
    if (overlayKind !== "clear") return;
    const unlock = () => el.card.querySelectorAll(".btns button[aria-disabled]").forEach((btn) => btn.removeAttribute("aria-disabled"));
    const left = CARD_LOCK_MS - (now() - cardShownAt);
    if (left > 0) later(unlock, left); else unlock();
  });

  // ===== 大きさが変わったら並べ直す =====
  let layoutQueued = false;
  function relayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => { layoutQueued = false; render.layout(); });
  }
  window.addEventListener("resize", relayout);
  window.addEventListener("orientationchange", relayout);
  if (window.ResizeObserver) {
    let lastW = 0, lastH = 0;
    new ResizeObserver(() => {
      const r = el.board.getBoundingClientRect();
      if (Math.abs(r.width - lastW) < 1 && Math.abs(r.height - lastH) < 1) return;
      lastW = r.width; lastH = r.height;
      relayout();
    }).observe(el.board, { box: "border-box" });
  }

  // ===== 拡大・長押しメニューを止める（瓶とお助けのダブルタップは input.js） =====
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("touchmove", (e) => { if (e.cancelable && !(e.target.closest && e.target.closest(".overlay"))) e.preventDefault(); }, { passive: false });

  // ===== テスト用（§8.6） =====
  function cloneState(s) { return s ? JSON.parse(JSON.stringify(s)) : null; }
  function validCustom(s) {
    if (!s || typeof s !== "object" || !Array.isArray(s.bottles) || !s.bottles.length || s.bottles.length > 11) return null;
    const capN = L.CAP || 4;
    const okColor = (c) => Number.isInteger(c) && c >= 0 && c < (L.COLORS ? L.COLORS.length : 9);
    const bottles = [];
    for (const b of s.bottles) {
      if (!b || !Array.isArray(b.cells) || b.cells.length > capN || !b.cells.every(okColor)) return null;
      const hidden = Array.isArray(b.hidden) ? b.hidden.map(Boolean) : b.cells.map(() => false);
      if (hidden.length !== b.cells.length) return null;
      bottles.push({ id: b.id, cells: b.cells.slice(), hidden, sealed: !!b.sealed, cover: Number.isSafeInteger(b.cover) && b.cover >= 0 ? b.cover : null });
    }
    // 瓶の id：無い・重なるときは並び順（0〜）にする（logic と同じ決まり）
    const ids = bottles.map((b) => b.id);
    if (!ids.every((x) => Number.isSafeInteger(x) && x >= 0) || new Set(ids).size !== ids.length) bottles.forEach((b, i) => { b.id = i; });
    const slotsIn = Array.isArray(s.slots) ? s.slots : [];
    const slots = [];
    for (let i = 0; i < (L.ORDER_SLOTS || 2); i++) {
      const v = slotsIn[i];
      if (v === null || v === undefined) slots.push(null);
      else if (okColor(v)) slots.push(v);
      else return null;
    }
    const queue = Array.isArray(s.queue) ? s.queue.slice() : [];
    if (!queue.every(okColor)) return null;
    const served = Number.isSafeInteger(s.served) && s.served >= 0 ? s.served : 0;
    const total = Number.isSafeInteger(s.total) && s.total >= 0 ? s.total : served + slots.filter((x) => x !== null).length + queue.length;
    const lv = Number.isSafeInteger(s.level) && s.level >= 1 ? s.level : level;
    const params = s.params && typeof s.params === "object" ? Object.assign({}, s.params) : (state ? state.params : safeCall(() => L.paramsFor(lv), {}));
    return { level: lv, params, bottles, slots, queue, served, total, moves: 0, won: false };
  }

  window.IrobinGame = Object.freeze({
    getState() {
      const h = state ? safeCall(() => L.hud(state), null) : null;
      return {
        phase: shownPhase(), level, best,
        served: h ? h.served : 0, total: h ? h.total : 0, left: h ? h.left : 0, moves: h ? h.moves : 0,
        bottles: state ? cloneState(state.bottles) : [], slots: state ? cloneState(state.slots) : [], queue: state ? cloneState(state.queue) : [],
        selected, stuck: isStuckNow(), doomed, par, won: !!(state && state.won),
        overlay: overlayKind, busy: !!render.busy, paused, timers: timers.size, runId,
        canUndo: history.length > 0, calm: !!render.calm
      };
    },
    pick(index) { onPick(index, "tap"); },
    pour(from, to) {
      if (selected !== null) { selected = null; render.update(state, { selected: null }); if (phase !== "pouring") setPhase(restPhase()); }
      const a = onPick(from, "tap");
      if (a !== "select") return "invalid";
      const kind = onPick(to, "tap");
      flush();
      return kind === "pour" ? "pour" : "invalid";
    },
    solution() {
      if (!state || state.won) return null;
      const r = safeCall(() => L.solve(state), null);
      return r && r.solved && Array.isArray(r.moves) ? r.moves.map((m) => [m[0], m[1]]) : null;
    },
    skip() { flush(); },
    setLevel(n) {
      const v = Number(n);
      if (!Number.isSafeInteger(v) || v < 1) return false;
      if (overlayKind) hideOverlay();
      render.resume();
      return startLevel(v, []);
    },
    setState(s) {
      const st = validCustom(s);
      if (!st) return false;
      if (overlayKind) hideOverlay();
      clearLater();
      runId += 1;
      pending = null;
      render.finishAll();
      custom = st;
      level = st.level;
      state = st; history = []; moves = []; selected = null; doomed = false; par = 0; clothTip = false;
      render.build(state, { orders: ordersOf(st), places: placesOf(st) });
      hud();
      setPhase(restPhase());
      setHint(phase === "stuck" ? HINT_STUCK : idleHint());
      return true;
    }
  });

  // ===== 起動 =====
  (function boot() {
    const sv = safeCall(() => L.validateSave(readKey(KEY_SAVE)), null);
    let ok = false;
    if (sv && Number.isSafeInteger(sv.level) && sv.level >= 1) ok = startLevel(sv.level, sv.moves);
    if (!ok) ok = startLevel(Math.min(Number.MAX_SAFE_INTEGER, (Number(best) || 0) + 1), []);
    if (!ok) startLevel(1, []);
    requestAnimationFrame(() => render.layout());
    if (!safeCall(() => L.validateFlag(readKey(KEY_HELP)), false)) showHelp();
  })();
})();

// オフラインでも遊べるようにする（https か localhost のときだけ有効）
if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("../../sw.js").catch(() => { /* 登録できなくてもゲームは遊べる */ });
  });
}
