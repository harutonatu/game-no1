/*
 * あまいものあつめ — つなぎ込み・1 はこびの回し方・保存・画面遷移・テスト用 API
 * 契約：docs/ari-contract.md §3.5（カード）・§3.6（進行）・§4（保存・X-20）
 * 担当 D（画面と進行）だけが編集する。
 *
 * 読み込み順：../../common/notice.js → ../../common/sfx.js → pictures-a.js → pictures-b.js → logic.js → render.js → input.js → main.js
 * - ルールは logic.js（AmaiLogic）だけが知っている。ここは手を当てて、結果を render に渡すだけ
 * - 画面の数は hud() の値をそのまま出す（UI で ±1 しない）
 * - 1 はこびは rAF で回す。1 フレームに最大 1 回、あまりは捨てる（止まっていた間を早送りしない）
 * - タイマーは later() だけで作る。clearLater() で片付ける。runId が違う回の続きは動かない
 */
(() => {
  "use strict";

  const L = window.AmaiLogic;
  const R = window.AmaiRender;
  const I = window.AmaiInput;
  if (!L || typeof L.createLevel !== "function") throw new Error("あまいものあつめ: AmaiLogic が読み込まれていません（logic.js）");
  if (!R || typeof R.create !== "function") throw new Error("あまいものあつめ: AmaiRender が読み込まれていません（render.js）");

  const NAME = typeof L.NAME === "string" && L.NAME ? L.NAME : "あまいものあつめ";
  const KEY_SAVE = L.SAVE_KEY_SAVE || "amai.save";
  const KEY_BEST = L.SAVE_KEY_BEST || "amai.best";
  const KEY_BOOK = L.SAVE_KEY_BOOK || "amai.book";
  const KEY_HELP = L.SAVE_KEY_HELP || "amai.help";
  const KEY_FAST = L.SAVE_KEY_FAST || "amai.fast";
  const KEY_CLEAN = L.SAVE_KEY_CLEAN || "amai.clean";   // 1手もどし なしで クリアした絵（logic.js の validateClean・addClean・hasClean）
  const TICK_MS = Number(L.TICK_MS) > 0 ? Number(L.TICK_MS) : 500;
  const FAST_MS = Number(L.FAST_MS) > 0 ? Number(L.FAST_MS) : 250;
  const CARD_LOCK_MS = 400;     // クリア・うごかせないのカードを出してから押せない時間
  const BOARD_BLOCK_MS = 300;   // カードを閉じた直後、箱の押下を受けない時間
  const SAVE_EVERY = 10;        // 動いている間は 10 はこびごとに保存
  const SETTLE_MAX = 2000;      // settle() で進める上限
  const HINT_FADE_MS = 3500;    // 案内は少したったら薄くする（文字は残す）
  const POLL_MS = 100;          // ありんこが全部巣に入るのを待つ間の見回り

  // 案内は絵と わくの間に 1 行で出す（SE 縦の幅 288px に 12px で入る長さ。入らなければ 11px に縮める）
  const HINT_FIRST = "はこを おすと、ありんこが はこぶよ";
  const HINT_IDLE = "てまえの はこを おしてね";
  const HINT_STUCK = "うごかせないよ。「1手もどす」を おしてね";
  const HINT_CARRY = "ありんこが はこんでるよ";   // 待っているだけのとき（押せる箱が無い・わくが いっぱい）に うすく出す
  const HINT_OPEN = "ふたが あいたよ";
  const HINT_THAW = "こおりが とけたよ";
  const MARK_WORD = { circle: "まる", triangle: "さんかく", star: "ほし", diamond: "ひしがた", plus: "じゅうじ", cross: "ばつ", heart: "ハート", bars: "よこせん", ring: "わ", stripes: "たてせん" };
  const SEASON_WORD = { haru: "はる", natsu: "なつ", aki: "あき", fuyu: "ふゆ" };

  const now = () => performance.now();
  const $ = (id) => document.getElementById(id);
  const el = {
    head: document.querySelector(".head"), title: $("gameTitle"), level: $("level"), levelBox: $("levelBox"), left: $("left"),
    helpBtn: $("helpBtn"), soundBtn: $("soundBtn"), playView: $("playView"), picBox: $("picBox"), pic: $("pic"), nest: $("nest"),
    slots: $("slots"), grid: $("grid"), fx: $("fx"), hint: $("hint"),
    undoBtn: $("undoBtn"), restartBtn: $("restartBtn"), fastBtn: $("fastBtn"), bookBtn: $("bookBtn"),
    overlay: $("overlay"), card: $("card")
  };
  const missing = Object.keys(el).filter((k) => !el[k]);
  if (missing.length) throw new Error("あまいものあつめ: 画面の部品が見つかりません：" + missing.join(", "));

  function safeCall(fn, fallback) { try { return fn(); } catch (e) { console.error("あまいものあつめ:", e); return fallback; } }

  // 表示名は logic.js の定数 1 か所から
  document.title = NAME;
  el.title.textContent = NAME;
  // 名前は 16px。入らなければ 14・13・12px に縮める（2 行にしない。SE 縦では 12px まで下がる）
  function fitTitle() {
    el.title.style.fontSize = "";
    for (const px of [14, 13, 12]) {
      if (el.title.scrollWidth <= el.title.clientWidth + 1) break;
      el.title.style.fontSize = px + "px";
    }
  }

  // ===== 効果音（sfx.js が無くても音なしで遊べる） =====
  const sfx = window.YubiSfx && typeof window.YubiSfx.create === "function" ? window.YubiSfx.create("amai")
    : { on: false, unlock() {}, toggle() { return false; }, play() {}, buzz() {} };
  document.addEventListener("pointerdown", () => sfx.unlock(), { capture: true });
  document.addEventListener("touchend", () => sfx.unlock(), { capture: true });
  function renderSoundBtn() {
    el.soundBtn.setAttribute("aria-pressed", String(!!sfx.on));
    el.soundBtn.setAttribute("aria-label", "効果音");   // オン・オフは aria-pressed だけで伝える（X-25）
  }
  function toggleSound() { sfx.unlock(); sfx.toggle(); renderSoundBtn(); }
  el.soundBtn.addEventListener("click", toggleSound);
  renderSoundBtn();

  // ===== 保存（保存できなくても遊べる） =====
  function readKey(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeKey(key, val) {
    if (stale) return false;   // G3：古いページは書かない（amai.book・amai.best も）
    try { localStorage.setItem(key, val); noteSaved(key); return true; } catch (e) { return false; }
  }

  // ===== 古いページから書き戻さない（契約 §4.4・X-20。いろびん §18 と同じ形） =====
  // G1：見張るのは途中の保存（amai.save）だけ。このページが最後に読んだ・書いた生の文字と比べる
  const WATCH_KEYS = [KEY_SAVE];
  const seenRaw = new Map(WATCH_KEYS.map((k) => [k, readKey(k)]));
  let stale = false;                     // true：このページはもう保存しない（開き直す前）
  let reloading = false;                 // true：開き直しをもう頼んだ（1 回だけ）
  function noteSaved(key) { if (seenRaw.has(key)) seenRaw.set(key, readKey(key)); }
  // X-22：比べるのは保存の生の文字。どちらも保存なし（null）なら「変わっていない」と見なす。メモリの値から書く保存を足すときは、書くたびに増やす印（書き込みの回数）で比べる形に変える
  const changedElsewhere = () => WATCH_KEYS.some((k) => readKey(k) !== seenRaw.get(k));
  // G2：表に戻ったとき（visible・pageshow）：ほかで変わっていたら書かずに開き直す（true なら、ほかの処理はしない）
  function reloadIfStale() {
    if (!stale && !changedElsewhere()) return false;
    stale = true;
    if (reloading) return true;
    reloading = true;
    if (self.YubiNotice) self.YubiNotice.markReload();   // G6：開き直したあとに「ほかの タブの つづきから はじめました」を 1 回出す（X-24）
    try { location.reload(); } catch (e) { console.error("あまいものあつめ: 開き直せませんでした", e); }
    return true;
  }
  // 裏へ回る（hidden）・閉じる（pagehide）ときの保存の前に比べ直す
  function staleOnHide() {
    if (!stale && changedElsewhere()) stale = true;
    return stale;
  }
  // G4：裏にいる間にほかのタブが同じ保存を書いたら、このページの保存を止める（表に戻ったら開き直す）
  window.addEventListener("storage", (e) => { if (document.hidden && (e.key === null || seenRaw.has(e.key))) stale = true; });

  let best = safeCall(() => L.validateBest(readKey(KEY_BEST)), 0) || 0;
  const readBook = () => safeCall(() => L.validateBook(readKey(KEY_BOOK)), null) || { got: {} };
  const bookCountNow = () => safeCall(() => L.bookCount(readKey(KEY_BOOK)), 0) || 0;
  const ORDER = Array.isArray(L.PICTURE_ORDER) ? L.PICTURE_ORDER : [];
  const inOrder = (id) => ORDER.some((p) => p && p.id === id);

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
  let pick = { id: "", mirror: false, repeat: false };   // この面の絵（§2.7）
  let picture = null;           // L.pictureById(pick.id, pick.mirror)
  let info = null;              // createLevel の info（solution）
  let state = null;             // AmaiLogic の state（イミュータブル）
  let presses = [];             // 押した手 [[押したときの t, 列], …]
  let custom = null;            // setState で入れた最初の局面（テスト用。保存しない）
  let customHist = [];          // setState の局面での 1手もどす用（押す前の state の列）
  let phase = "play";           // play | stuck | clear
  let overlay = null;           // null | help | book | clear | stuck | confirm
  let hiddenNow = !!document.hidden;
  let stable = false;           // 落ち着いた（1 はこびを進めても何も運べない）
  let fast = false;
  let sinceSave = 0;
  let lastClear = null;
  let cardShownAt = -Infinity;
  let blockUntil = -Infinity;
  let bookFrom = "play";        // ずかんを開いた所（play | clear）
  let confirmFrom = "play";     // やりなおしの確認を開いた所（play | stuck）
  let hintFadeId = 0;
  let noUndo = null;            // この面で 1手もどすを使っていない：true／使った：false／分からない（途中から再開・テストの局面）：null。保存しない

  // 1 はこびを回すのは、表に出ていて・古いページでなく・カードが無く・落ち着いていないときだけ（変異 MA14 の置換元。1 行の式のまま）
  const running = () => !hiddenNow && !stale && overlay === null && !stable;

  const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  let calm = !!reduceMotion.matches;
  const render = R.create({ pic: el.pic, fx: el.fx, slots: el.slots, grid: el.grid, nest: el.nest }, { calm, sfx });
  const onMotion = () => { calm = !!reduceMotion.matches; safeCall(() => render.setCalm(calm)); };
  if (reduceMotion.addEventListener) reduceMotion.addEventListener("change", onMotion);
  else if (reduceMotion.addListener) reduceMotion.addListener(onMotion);

  const shownPhase = () => (hiddenNow ? "paused" : phase);
  function syncPhase() { el.playView.dataset.phase = shownPhase(); }
  function setPhase(p) { phase = p; syncPhase(); renderTools(); }
  // 案内は絵と わくの間に 1 行（高さ固定）。長い文言は字を 12・11px に縮めて収める。少したったら薄くする（文字は残す）
  function fitHint() {
    el.hint.style.fontSize = "";
    if (!el.hint.textContent) return;
    for (const px of [12, 11]) {
      if (el.hint.scrollWidth <= el.hint.clientWidth + 1) break;
      el.hint.style.fontSize = px + "px";
    }
  }
  function setHint(text, keep) {
    const t = text || "";
    if (hintFadeId) { clearTimeout(hintFadeId); timers.delete(hintFadeId); hintFadeId = 0; }
    el.hint.dataset.fade = "0";
    el.hint.dataset.soft = "0";
    if (el.hint.textContent !== t) { el.hint.textContent = t; fitHint(); }
    if (t && !keep) hintFadeId = later(() => { hintFadeId = 0; el.hint.dataset.fade = "1"; }, HINT_FADE_MS);
  }
  // 待っているだけのとき（運んでいる間で、押せる箱が無い・わくが いっぱい）は「ありんこが はこんでるよ」を うすく出す。
  // ほかの案内が出ている（薄くなる前）ときは上書きしない
  function waitingOnly() {
    if (!state || state.won || stable || phase !== "play") return false;
    const cols = Array.isArray(state.cols) ? state.cols : [];
    const slots = Array.isArray(state.slots) ? state.slots : [];
    const noBox = !cols.some((c) => Array.isArray(c) && c.length > 0);
    const full = slots.length > 0 && slots.every((b) => b);
    return noBox || full;
  }
  function softHint() {
    const soft = el.hint.dataset.soft === "1";
    if (waitingOnly()) {
      if (soft) return;
      if (el.hint.textContent && el.hint.dataset.fade !== "1") return;
      setHint(HINT_CARRY, true);
      el.hint.dataset.soft = "1";
    } else if (soft) setHint("", true);
  }
  const colorName = (c) => safeCall(() => L.colorName(c), "") || "";
  const colorMark = (c) => {
    const col = Array.isArray(L.COLORS) ? L.COLORS[c] : null;
    const w = col && MARK_WORD[col.mark];
    return w ? `${colorName(c)}（${w}）` : colorName(c);
  };
  const isStuckNow = () => !!(state && !state.won && safeCall(() => L.isStuck(state), false));

  // ===== 表示：ロジックの値をそのまま出す =====
  // 面の番号の字の大きさ：6 桁まで s、10 桁まで m、それより長いと l（16 桁でもはみ出さない。「…」で切らない）
  const sizeOf = (text) => (text.length <= 6 ? "s" : text.length <= 10 ? "m" : "l");
  function hud() {
    if (!state) return;
    const h = safeCall(() => L.hud(state), null);
    if (!h) return;
    const lv = String(h.level);
    if (el.level.textContent !== lv) el.level.textContent = lv;
    el.levelBox.dataset.size = sizeOf(lv);
    const left = String(h.left);
    if (el.left.textContent !== left) el.left.textContent = left;
    const nm = picture && picture.name ? picture.name : "";
    el.pic.setAttribute("aria-label", `${nm ? nm + " の え。" : ""}のこり ${h.left} こ`);
    renderTools();
  }
  function renderTools() {
    const n = presses.length;
    el.undoBtn.disabled = !(n > 0) || phase === "clear";
    el.restartBtn.disabled = !(n > 0) || phase === "clear";   // 押した数 0 なら押しても何も起きない（いろびん IB-13）
    // うごかせないとき：押して意味のある方を目立たせる
    const need = phase === "stuck";
    el.undoBtn.dataset.attention = need && !el.undoBtn.disabled ? "1" : "0";
    el.restartBtn.dataset.attention = need && !el.restartBtn.disabled ? "1" : "0";
    el.fastBtn.setAttribute("aria-pressed", String(!!fast));
  }
  function save() {
    if (custom || !state || state.won) return;   // クリアした面は、onWon が次の面を書く
    safeCall(() => writeKey(KEY_SAVE, L.makeSave(level, pick, presses, state.t)), false);
  }
  // 落ち着いたときの案内：わくの箱が待っていれば「○いろの おさとうが…」、わくが空なら「てまえの はこを おしてね」
  function stableHint() {
    if (!state || state.won) return "";
    const slots = Array.isArray(state.slots) ? state.slots : [];
    const boxes = slots.filter((b) => b);
    if (!boxes.length) return presses.length === 0 && level <= 2 && !custom ? HINT_FIRST : HINT_IDLE;
    const waiting = boxes.find((b) => !(safeCall(() => L.edgeCells(state, b.color), []) || []).length);
    return waiting ? `${colorMark(waiting.color)}が ふちに でるのを まってるよ` : "";
  }

  // ===== 演出の続き（ありんこを待つ・Promise から、または flush から同期で） =====
  let pending = null, pendSeq = 0;
  function setPending(fn) {
    const token = ++pendSeq;
    const myRun = runId;
    const p = { done: false, run() { if (p.done || myRun !== runId || token !== pendSeq) return; p.done = true; if (pending === p) pending = null; fn(); } };
    pending = p;
    return p;
  }
  function cancelPending() { pending = null; pendSeq += 1; }
  // ありんこが全部巣に入るのを待ってから fn（待つ間は POLL_MS ごとに見回る。flush なら今すぐ）。
  // 裏にいる間は見回らない（表に戻ったとき・pageshow で resumePending が始め直す）
  function waitAnts(fn) {
    const p = setPending(fn);
    p.poll = () => { if (p.done || pending !== p || hiddenNow) return; if (render.busy) { later(p.poll, POLL_MS); return; } p.run(); };
    p.poll();
  }
  // pagehide の clearLater・裏にいる間で止まった見回りを始め直す（クリア・うごかせないのカードが出ないままにしない）。
  // 絵の演出（celebrate の Promise）を待つ続きは、Promise が来なくても演出が終われば出す
  function resumePending() {
    const p = pending;
    if (!p || p.done || hiddenNow || stale || overlay !== null) return;
    if (typeof p.poll === "function") { p.poll(); return; }
    const chk = () => { if (p.done || pending !== p || hiddenNow) return; if (render.busy) { later(chk, POLL_MS); return; } p.run(); };
    later(chk, POLL_MS);
  }
  // 演出を終わらせ、続きの処理も今すぐ済ませる
  function flush() {
    let guard = 0;
    while (guard++ < 4) {
      safeCall(() => render.finishAll());
      if (!pending) break;
      pending.run();
    }
  }

  // ===== 1 はこびの回し方（rAF） =====
  let rafId = 0, lastTs = -1, acc = 0;
  function kick() {
    if (rafId || !running()) return;
    lastTs = -1;
    rafId = requestAnimationFrame(frame);
  }
  function frame(ts) {
    rafId = 0;
    if (!running()) return;   // 止まる：落ち着いた・カード・裏・古いページ（rAF も回さない）
    if (lastTs >= 0) acc += Math.max(0, ts - lastTs);
    lastTs = ts;
    if (acc >= (fast ? FAST_MS : TICK_MS)) { acc = 0; doStep(); }   // 1 フレームに最大 1 回。あまりは捨てる
    if (running()) rafId = requestAnimationFrame(frame);
  }
  // 1 はこび進める。動いたら true
  function doStep() {
    if (!state || state.won) return false;
    const r = safeCall(() => L.step(state), null);
    if (!r || !r.moved) { stable = true; afterStable(); return false; }
    state = r.state;
    safeCall(() => render.carry(r, state));
    hud();
    if (r.won || state.won) { onWon(false); return true; }
    if (++sinceSave >= SAVE_EVERY) { sinceSave = 0; save(); }
    // 次の 1 はこびで何も運べないなら、ここで落ち着いたとする（待つ案内・うごかせないを 1 はこび早く出す）
    if (safeCall(() => L.isStable(state), false)) { stable = true; afterStable(); }
    else softHint();
    return true;
  }
  function afterStable() {
    if (!state || state.won) return;
    save();
    renderTools();
    if (isStuckNow()) { if (el.hint.dataset.soft === "1") setHint("", true); waitAnts(enterStuck); return; }
    const h = stableHint();
    if (h) setHint(h);
    else if (el.hint.dataset.soft === "1") setHint("", true);
  }
  function enterStuck() {
    if (!state || state.won || !stable || !isStuckNow() || overlay !== null) return;
    setPhase("stuck");
    setHint(HINT_STUCK, true);
    sfx.play("stuck");
    showStuckCard();
  }

  // ===== 面を始める =====
  // pk：{ id, mirror, repeat }（無い・PICTURE_ORDER に無い絵なら pickPicture で選ぶ）。pr・t：保存の押した手と t（再開）
  function startLevel(lv, pk, pr, t) {
    clearLater();
    runId += 1;
    cancelPending();
    safeCall(() => render.finishAll());
    const n = Number.isSafeInteger(lv) && lv >= 1 ? lv : 1;
    let pk2 = pk && typeof pk.id === "string" && inOrder(pk.id) ? { id: pk.id, mirror: !!pk.mirror, repeat: !!pk.repeat } : null;
    let created, st, prs = [];
    try {
      if (!pk2) pk2 = L.pickPicture(n, readBook());
      created = L.createLevel(n, pk2);
      st = created && created.state;
      if (!st) throw new Error("面を作れませんでした");
      if (Array.isArray(pr) && pr.length) {
        const rp = safeCall(() => L.replay(n, pk2, pr, t), null);
        if (rp && rp.ok && rp.state) { st = rp.state; prs = pr.map((m) => [m[0], m[1]]); }
      }
    } catch (e) {
      console.error("あまいものあつめ: 面を始められませんでした", e);
      setHint("よみこみに しっぱいしました。ひらきなおしてね", true);
      return false;
    }
    level = n;
    pick = pk2;
    info = created.info || null;
    // 絵がまだ無い面（予備 2 のりんごで作った面）は、作った局面の絵の名前を出す
    picture = safeCall(() => L.pictureById(pick.id, pick.mirror), null) || safeCall(() => L.pictureById(st.picture, st.mirror), null);
    state = st;
    presses = prs;
    noUndo = prs.length === 0 ? true : null;   // 途中から再開した面は、もどしたか分からないので出さない
    custom = null;
    customHist = [];
    stable = false;
    sinceSave = 0;
    acc = 0;
    lastClear = null;
    safeCall(() => render.build(state, picture));
    hud();
    setPhase("play");
    if (state.won) { onWon(true); return true; }   // 最後まで運んだ所で閉じていた：クリアから続ける
    save();
    setHint(presses.length === 0 && level <= 2 ? HINT_FIRST : "");
    if (safeCall(() => L.isStable(state), false)) { stable = true; afterStable(); }
    else softHint();
    kick();
    return true;
  }

  // ===== 箱を押す =====
  function denyHint(o) {
    if (!o) return "";
    if (o.reason === "full") return "わくが いっぱいだよ";
    if (o.reason === "empty") return "その れつには もう はこが ないよ";
    if (o.reason === "frozen") {
      const b = state && state.cols && state.cols[o.col] ? state.cols[o.col][0] : null;
      const k = b ? Math.max(1, (Number(b.ice) || 0) - (Number(state.presses) || 0)) : 1;
      return `こおって いるよ。ほかを あと ${k} かい おしてね`;
    }
    return "";
  }
  function onPress(col, via) {
    if (!state || overlay !== null || hiddenNow || stale) return null;
    if (phase === "clear" || state.won) return "invalid";
    const res = safeCall(() => L.press(state, col), null);
    const o = res && res.outcome;
    if (!o) return null;
    if (o.kind !== "press") {
      safeCall(() => render.deny(col, o.reason));
      sfx.play("deny");
      const h = denyHint(o);
      if (h) setHint(h);
      return o.kind || "invalid";
    }
    cancelPending();   // うごかせないの待ちは取りやめ（局面が変わった）
    if (custom) customHist.push(state);
    presses.push([Number(state.t) || 0, col]);
    state = res.state;
    stable = false;
    if (phase === "stuck") setPhase("play");
    save();
    hud();
    sfx.play("place");
    safeCall(() => render.place(o, state));
    const opened = Array.isArray(o.opened) && o.opened.length > 0;
    const thawed = Array.isArray(o.thawed) && o.thawed.length > 0;
    if (opened) sfx.play("open");
    if (thawed) sfx.play("thaw");
    setHint(opened ? HINT_OPEN : thawed ? HINT_THAW : "");
    softHint();
    if (via === "key" && input) input.focusCol(col);
    kick();
    return "press";
  }

  // ===== 1手もどす・やりなおし =====
  function undo() {
    if (overlay !== null || !state || state.won || phase === "clear") return false;
    if (!presses.length) return false;
    cancelPending();   // 先に うごかせないの待ちを取りやめる（flush がその続きでカードを出さないように）
    flush();
    if (state.won || overlay !== null) return false;
    const last = presses[presses.length - 1];
    let st = null;
    if (custom) st = customHist[customHist.length - 1] || null;
    else {
      const rest = presses.slice(0, -1);
      const rp = safeCall(() => L.replay(level, pick, rest, last[0]), null);
      st = rp && rp.ok && rp.state ? rp.state : null;
    }
    if (!st) { console.error("あまいものあつめ: 1手もどせませんでした"); return false; }
    presses.pop();
    if (custom) customHist.pop();
    if (noUndo === true) noUndo = false;
    state = st;
    stable = false;
    safeCall(() => render.update(state));
    save();
    hud();
    sfx.play("undo");
    setPhase("play");
    setHint("");
    if (safeCall(() => L.isStable(state), false)) { stable = true; afterStable(); }
    else softHint();
    kick();
    return true;
  }
  function askRestart(from) {
    if (!state || phase === "clear") return;
    if (overlay !== null && overlay !== "stuck") return;
    if (!presses.length) return;
    const before = overlay;
    flush();
    if (overlay !== before) return;   // 待っていた続きがクリア・うごかせないのカードを出した：その上に重ねない
    confirmFrom = from === "stuck" ? "stuck" : "play";
    safeCall(() => render.pause());
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
    if (custom) {
      const base = custom;
      clearLater(); runId += 1; cancelPending(); safeCall(() => render.finishAll());
      state = base; presses = []; customHist = []; stable = false;
      safeCall(() => render.build(state, picture));
      hud(); setPhase("play"); setHint("");
      if (safeCall(() => L.isStable(state), false)) { stable = true; afterStable(); }
      kick();
      return;
    }
    startLevel(level, pick, [], 0);
    sfx.play("start");
  }

  // ===== はやく =====
  function toggleFast() {
    fast = !fast;
    acc = 0;
    writeKey(KEY_FAST, fast ? "1" : "0");
    safeCall(() => render.setFast(fast));
    renderTools();
  }

  // ===== クリア =====
  // 記録（best・book・次の面の save）はその場で先に書く（演出の途中で閉じても残す。いろびん IB-22）
  function onWon(restored) {
    stable = true;
    cancelPending();
    setPhase("clear");
    const id = state.picture || pick.id;
    let count = 1, got = 0, nextPick = null, improved = false;
    const next = level < Number.MAX_SAFE_INTEGER ? level + 1 : level;
    const clean = !custom && !restored && noUndo === true;
    if (!custom) {
      // テストの局面（setState）では amai.best・amai.book・amai.clean を書かない
      const r = safeCall(() => L.recordBest(best, level), null) || { best, improved: false };
      improved = !!r.improved;
      best = r.best;
      writeKey(KEY_BEST, String(best));
      if (clean && typeof L.addClean === "function") {
        const rc = safeCall(() => L.addClean(readKey(KEY_CLEAN), id), null);
        if (typeof rc === "string") writeKey(KEY_CLEAN, rc);
      }
      const raw = safeCall(() => L.addToBook(readKey(KEY_BOOK), id), null);
      if (typeof raw === "string") writeKey(KEY_BOOK, raw);
      const book = safeCall(() => L.validateBook(raw), null) || readBook();
      count = book && book.got && Number(book.got[id]) > 0 ? Number(book.got[id]) : 1;
      got = safeCall(() => L.bookCount(raw), 0) || 0;
      nextPick = safeCall(() => L.pickPicture(next, book), null);
      if (nextPick) safeCall(() => writeKey(KEY_SAVE, L.makeSave(next, nextPick, [], 0)), false);
    } else {
      got = bookCountNow();
    }
    lastClear = { level, id, name: picture && picture.name ? picture.name : "", mirror: !!pick.mirror, repeat: !!pick.repeat, count, got, improved, next, nextPick, restored: !!restored, clean };
    renderTools();
    setHint(`${level} めん クリア！`, true);
    sfx.play("clear");
    // ありんこが全部巣に入るのを待つ → 完成した絵 → カード
    waitAnts(() => {
      const p = setPending(() => showClearCard());
      Promise.resolve(safeCall(() => render.celebrate(picture), null)).then(() => p.run(), () => p.run());
    });
  }
  function showClearCard(o) {
    const again = !!(o && o.again);
    const c = lastClear || { level, name: "", count: 1, got: 0, repeat: false, improved: false };
    const total = ORDER.length;
    const countText = c.repeat ? `はんたいむき・${c.count} かいめ` : c.count > 1 ? `${c.count} かいめ` : "ずかんに はいったよ";
    showCard(`
      <h2 id="cardTitle" data-f="h"></h2>
      <div class="clearpic"></div>
      <p class="picname" data-f="n"></p>${c.clean ? '\n      <p class="clean" data-f="k"></p>' : ""}
      <p data-f="c"></p>
      <p class="count" data-f="g"></p>
      <div class="btns">
        <button class="cta primary" type="button" data-cmd="next">つぎの めんへ</button>
        <button class="cta half" type="button" data-cmd="book">ずかん</button>
        <button class="cta half" type="button" data-cmd="menu">メニューへ</button>
      </div>`, { h: `${c.level} めん クリア！`, n: c.name, k: "1手もどし なし！", c: countText, g: total ? `ずかん ${c.got} / ${total}` : "" }, "clear");
    const box = el.card.querySelector(".clearpic");
    if (box && picture) box.appendChild(pictureCanvas(picture, 120, { mono: false, marks: false }));
    if (again) {
      const bk = el.card.querySelector('button[data-cmd="book"]');
      if (bk) { try { bk.focus({ preventScroll: true }); } catch (e) { bk.focus(); } }
      return;
    }
    cardShownAt = now();
    el.card.querySelectorAll(".btns button").forEach((btn) => btn.setAttribute("aria-disabled", "true"));
    later(unlockCard, CARD_LOCK_MS);
    if (c.improved && !c.restored) later(() => sfx.play("best"), 450);
  }
  const unlockCard = () => el.card.querySelectorAll(".btns button[aria-disabled]").forEach((btn) => btn.removeAttribute("aria-disabled"));
  function goNext() {
    sfx.unlock();
    const c = lastClear;
    hideOverlay();
    const next = c ? c.next : level + 1;
    startLevel(next, c && c.nextPick ? c.nextPick : null, [], 0);
    sfx.play("start");
  }
  function goMenu() {
    clearLater();
    save();
    location.href = "../../";
  }

  // ===== うごかせない =====
  function showStuckCard() {
    safeCall(() => render.pause());
    // 手詰まりの理由：わくの箱が待っている色（ふちにまだ出ていない色）を名前で言う。盤面は隠さない（下に出す小さなカード）
    const names = [];
    const slots = state && Array.isArray(state.slots) ? state.slots : [];
    for (const b of slots) {
      if (!b || names.includes(colorName(b.color))) continue;
      if (!(safeCall(() => L.edgeCells(state, b.color), []) || []).length) names.push(colorName(b.color));
    }
    const why = names.length ? `${names.join("と ")}は まだ ふちに ないよ。そとの いろを さきに はこぶと みちが あくよ。` : "わくが いっぱいだよ。";
    showCard(`
      <h2 id="cardTitle">うごかせないよ</h2>
      <p>${why}1手もどして ためしてね。</p>
      <div class="btns">
        <button class="cta primary half" type="button" data-cmd="undo">1手もどす</button>
        <button class="cta half" type="button" data-cmd="restart">やりなおし</button>
      </div>`, {}, "stuck");
    cardShownAt = now();
    el.card.querySelectorAll(".btns button").forEach((btn) => btn.setAttribute("aria-disabled", "true"));
    later(unlockCard, CARD_LOCK_MS);
  }

  // ===== 絵を小さな canvas に（遊び方・クリア・ずかん） =====
  function pictureCanvas(p, size, opt) {
    const cv = document.createElement("canvas");
    cv.setAttribute("aria-hidden", "true");
    const W = Math.max(1, Number(p && p.W) || 1), H = Math.max(1, Number(p && p.H) || 1);
    const dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    const cell = Math.max(1, Math.floor((size * dpr) / Math.max(W, H)));
    cv.width = W * cell;
    cv.height = H * cell;
    cv.style.width = Math.round((W * cell) / dpr) + "px";
    cv.style.height = Math.round((H * cell) / dpr) + "px";
    try { const ctx = cv.getContext("2d"); if (ctx && typeof R.drawPicture === "function") R.drawPicture(ctx, p, Object.assign({ cell }, opt || {})); } catch (e) { /* 絵が描けなくても続ける */ }
    return cv;
  }

  // ===== 遊び方 =====
  function showHelp() {
    if (overlay !== null) return;   // ほかのカードの上には重ねない
    flush();
    if (overlay !== null) return;   // 待っていた続きがクリア・うごかせないのカードを出した：その上に重ねない
    safeCall(() => render.pause());
    showCard(`
      <h2 id="cardTitle">あそびかた</h2>
      <div class="sample"></div>
      <ol class="rules">
        <li>てまえの はこを おすと、<b>わく</b>（したの 3つの しかく）に はいって ありんこが でてくるよ。</li>
        <li>はこべるのは <b>おなじ いろ</b>で、<b>ふち</b>（えの そとがわ）に ある おさとうだけ。</li>
        <li><b>なかの いろ</b>は、そとの いろを さきに はこんで <b>みちを あけて</b> ね。</li>
        <li>うごけなくなったら<span style="white-space:nowrap">『1手もどす』</span>。なんども やりなおして いいよ。えを ぜんぶ はこぶと <b>ずかん</b>に はいるよ。</li>
      </ol>
      <div class="btns"><button class="cta primary" type="button" data-cmd="close">わかった</button></div>`, {}, "help");
    const box = el.card.querySelector(".sample");
    if (box && picture) {
      const cv = pictureCanvas(picture, 72, { mono: false, marks: true });
      cv.style.width = ""; cv.style.height = "";   // 大きさは CSS（SE は小さく）
      cv.style.objectFit = "contain";
      box.appendChild(cv);
    }
  }

  // ===== ずかん =====
  function showBook(from) {
    if (overlay !== null && overlay !== "clear") return;
    bookFrom = from === "clear" ? "clear" : "play";
    if (overlay === null) {
      flush();
      if (overlay !== null) return;   // 待っていた続きがクリア・うごかせないのカードを出した：その上に重ねない
      safeCall(() => render.pause());
    }
    const book = readBook();   // いつも保存から読む（メモリの値を出さない）
    const got = bookCountNow();
    const rawClean = readKey(KEY_CLEAN);
    const isClean = (id) => typeof L.hasClean === "function" && !!safeCall(() => L.hasClean(rawClean, id), false);
    showCard(`
      <div class="bookhead">
        <h2 id="cardTitle">ずかん</h2>
        <p class="got"><span data-f="g"></span><span class="rest" data-f="r"></span></p>
        <button class="primary" type="button" data-cmd="close">とじる</button>
      </div>
      <ul class="book"></ul>`, { g: `${got} / ${ORDER.length}`, r: got < ORDER.length ? `あと ${ORDER.length - got} まい` : "ぜんぶ そろったよ" }, "book");
    const ul = el.card.querySelector("ul.book");
    if (!ul) return;
    for (const item of ORDER) {
      const id = item && item.id;
      const p = safeCall(() => L.pictureById(id, false), null);
      const n = book.got && Number.isSafeInteger(book.got[id]) && book.got[id] > 0 ? book.got[id] : 0;
      const li = document.createElement("li");
      li.dataset.id = String(id);
      li.dataset.got = n > 0 ? "1" : "0";
      if (p) li.appendChild(pictureCanvas(p, 64, { mono: n === 0, marks: false }));
      const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = n > 0 && p ? p.name : "？？？";
      if (n > 0 && p && isClean(id)) {   // 1 回でも 1手もどし なしで クリアした絵
        const star = document.createElement("span"); star.className = "star"; star.textContent = "★"; star.setAttribute("aria-hidden", "true");
        const sr = document.createElement("span"); sr.className = "sr"; sr.textContent = "（1手もどし なし）";
        nm.appendChild(star); nm.appendChild(sr);
      }
      li.appendChild(nm);
      if (n > 0) { const cnt = document.createElement("span"); cnt.className = "cnt"; cnt.textContent = `${n} かい`; li.appendChild(cnt); }
      const season = p && SEASON_WORD[p.season];
      if (season) { const s = document.createElement("span"); s.className = "season"; s.dataset.season = p.season; s.textContent = season; li.appendChild(s); }
      ul.appendChild(li);
    }
  }

  // ===== カード =====
  let focusBack = null;
  function showCard(html, fields, kind) {
    const keepFocus = overlay !== null ? focusBack : null;   // カードからカードへ移るときは、最初の戻り先を残す
    focusBack = keepFocus || document.activeElement;
    // カードの間は、うしろのプレイ画面を Tab・読み上げ・押す対象から外す（a#back・？・♪ はカードからも使えるので外さない。はし HS-07 と同じ）
    el.playView.setAttribute("inert", "");
    el.card.innerHTML = html;
    el.card.dataset.kind = kind;
    el.overlay.dataset.kind = kind;
    el.card.scrollTop = 0;
    el.card.querySelectorAll("[data-f]").forEach((n) => { n.textContent = fields[n.dataset.f] ?? ""; });
    el.overlay.hidden = false;
    el.overlay.scrollTop = 0;
    overlay = kind;
    const primary = el.card.querySelector(".primary");
    if (primary) { try { primary.focus({ preventScroll: true }); } catch (e) { primary.focus(); } }
  }
  function hideOverlay() {
    if (overlay === null && el.overlay.hidden) return;
    el.overlay.hidden = true;
    el.card.innerHTML = "";
    el.card.dataset.kind = "";
    el.overlay.dataset.kind = "";
    overlay = null;
    el.playView.removeAttribute("inert");
    blockUntil = now() + BOARD_BLOCK_MS;
    const fb = focusBack; focusBack = null;
    if (fb && fb.isConnected && fb !== document.body) { try { fb.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
    if (!hiddenNow) safeCall(() => render.resume());
    kick();
  }
  // Esc・「とじる」「わかった」「やめる」。クリアとうごかせないのカードは閉じない（どちらかを選ぶ）
  function closeCard() {
    if (overlay === "help") { writeKey(KEY_HELP, "1"); hideOverlay(); return; }
    if (overlay === "book") {
      if (bookFrom === "clear") { overlay = "clear"; showClearCard({ again: true }); return; }
      hideOverlay();
      return;
    }
    if (overlay === "confirm") {
      if (confirmFrom === "stuck" && isStuckNow()) { overlay = null; showStuckCard(); return; }
      hideOverlay();
    }
  }
  el.overlay.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("[data-cmd]") : null;
    if (!btn) return;
    if ((overlay === "clear" || overlay === "stuck") && now() - cardShownAt < CARD_LOCK_MS) return;   // 出た直後の連打で押し間違えない
    const cmd = btn.dataset.cmd;
    if (cmd === "next") goNext();
    else if (cmd === "menu") goMenu();
    else if (cmd === "close") closeCard();
    else if (cmd === "restartYes") doRestart();
    else if (cmd === "book") showBook("clear");
    else if (cmd === "undo") { if (overlay === "stuck" && presses.length) { hideOverlay(); undo(); } }
    else if (cmd === "restart") { if (overlay === "stuck") askRestart("stuck"); }
  });
  el.helpBtn.addEventListener("click", () => { sfx.unlock(); showHelp(); });
  el.undoBtn.addEventListener("click", () => undo());
  el.restartBtn.addEventListener("click", () => askRestart("play"));
  el.fastBtn.addEventListener("click", () => toggleFast());
  el.bookBtn.addEventListener("click", () => showBook("play"));
  // 演出の途中で絵を押したら、演出を終わらせる（待たせない）
  el.picBox.addEventListener("pointerdown", () => { if (render.busy && overlay === null && !hiddenNow && phase === "clear") flush(); });

  // ===== 入力 =====
  function onCommand(cmd) {
    switch (cmd) {
      case "undo": undo(); break;
      case "restart": askRestart("play"); break;
      case "fast": if (overlay === null) toggleFast(); break;
      case "book": if (overlay === null) showBook("play"); break;
      case "sound": toggleSound(); break;
      case "help": showHelp(); break;
      case "close": closeCard(); break;
      default: break;
    }
  }
  const input = I && typeof I.attach === "function"
    ? I.attach({ grid: el.grid, root: document }, { onPress, onCommand }, { isBlocked: () => overlay !== null || hiddenNow || now() < blockUntil })
    : null;
  if (!input) console.error("あまいものあつめ: AmaiInput が読み込まれていません（input.js）。キーボードとタップの一部が使えません");

  // ===== 中断 =====
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenNow = true;
      safeCall(() => render.pause());
      syncPhase();
      staleOnHide();   // 裏へ回る前に、保存がほかで変わっていないか比べ直す（X-20）
      save();
    } else {
      if (reloadIfStale()) return;
      hiddenNow = false;
      if (overlay === null) safeCall(() => render.resume());
      syncPhase();
      resumePending();   // 裏にいる間に止まった見回り（ありんこを待ってカードを出す）を始め直す
      kick();
    }
  });
  window.addEventListener("pagehide", () => { staleOnHide(); save(); clearLater(); });
  // pagehide の clearLater で消えた続き（押せない時間を外す・ありんこを待ってカードを出す）を、戻ったときにやり直す
  window.addEventListener("pageshow", () => {
    if (reloadIfStale()) return;
    hiddenNow = !!document.hidden;
    syncPhase();
    if (overlay === "clear" || overlay === "stuck") {
      const left = CARD_LOCK_MS - (now() - cardShownAt);
      if (left > 0) later(unlockCard, left); else unlockCard();
    } else if (overlay === null && state) {
      if (pending) resumePending();   // pagehide の clearLater で消えた見回りを始め直す（演出中に離れて bfcache から戻った）
      else if (state.won && phase === "clear") waitAnts(() => { const p = setPending(() => showClearCard()); Promise.resolve(safeCall(() => render.celebrate(picture), null)).then(() => p.run(), () => p.run()); });
      else if (stable) afterStable();
      kick();
    }
  });

  // ===== 大きさが変わったら並べ直す =====
  let layoutQueued = false;
  function relayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => { layoutQueued = false; safeCall(() => render.layout()); fitTitle(); });
  }
  window.addEventListener("resize", relayout);
  window.addEventListener("orientationchange", relayout);
  if (window.ResizeObserver) {
    let lastW = 0, lastH = 0;
    new ResizeObserver(() => {
      const r = el.picBox.getBoundingClientRect();
      if (Math.abs(r.width - lastW) < 1 && Math.abs(r.height - lastH) < 1) return;
      lastW = r.width; lastH = r.height;
      relayout();
    }).observe(el.picBox, { box: "border-box" });
  }

  // ===== 拡大・長押しメニューを止める（格子・わく・ボタン・絵のダブルタップは input.js） =====
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("touchmove", (e) => { if (e.cancelable && !(e.target.closest && e.target.closest(".overlay"))) e.preventDefault(); }, { passive: false });

  // ===== テスト用（§3.6） =====
  const clone = (x) => (x === undefined || x === null ? null : JSON.parse(JSON.stringify(x)));
  function runSteps(max) {
    let moved = 0;
    for (let i = 0; i < max; i++) {
      if (overlay !== null || !state || state.won || stable) break;
      if (doStep()) moved += 1; else break;
    }
    flush();
    return moved;
  }
  window.AmaiGame = Object.freeze({
    getState() {
      const h = state ? safeCall(() => L.hud(state), null) : null;
      const st = safeCall(() => render.stats(), null);
      return {
        phase: shownPhase(), level, best,
        left: h ? h.left : 0, total: h ? h.total : 0, t: state ? state.t : 0, presses: presses.length,
        stable, stuck: isStuckNow(), won: !!(state && state.won),
        slots: state ? clone(state.slots) : [], cols: state ? clone(state.cols) : [],
        overlay, busy: !!render.busy, paused: hiddenNow, stale, fast, calm,
        timers: timers.size, runId, ants: st && Number.isFinite(st.ants) ? st.ants : 0,
        canUndo: presses.length > 0, book: bookCountNow(),
        picture: pick.id, mirror: !!pick.mirror, repeat: !!pick.repeat, custom: !!custom,
        pressList: clone(presses), hint: el.hint.textContent,
        stats: st ? clone(st) : null   // render.stats()（{ ants, frameMs, redraws }。テスト AW19 用）
      };
    },
    press(col) { const k = onPress(col, "tap"); return k; },
    tick(n) {
      const k = Math.max(0, Math.min(SETTLE_MAX, Math.floor(Number(n) || 0)));
      return runSteps(k);
    },
    settle() { return runSteps(SETTLE_MAX); },
    solution() {
      if (custom || !info || !Array.isArray(info.solution) || presses.length || !state || state.t !== 0) return null;
      return info.solution.slice();
    },
    skip() { flush(); },
    setLevel(n) {
      const v = Number(n);
      if (!Number.isSafeInteger(v) || v < 1) return false;
      if (overlay !== null) hideOverlay();
      const ok = startLevel(v, null, [], 0);
      if (ok && !hiddenNow) safeCall(() => render.resume());
      return ok;
    },
    setState(s) {
      const st = safeCall(() => L.validateState(s), null);
      if (!st) return false;
      if (overlay !== null) hideOverlay();
      clearLater();
      runId += 1;
      cancelPending();
      safeCall(() => render.finishAll());
      custom = st;
      customHist = [];
      presses = [];
      noUndo = null;
      info = null;
      level = Number.isSafeInteger(st.level) && st.level >= 1 ? st.level : level;
      pick = { id: typeof st.picture === "string" ? st.picture : "", mirror: !!st.mirror, repeat: !!st.repeat };
      picture = safeCall(() => L.pictureById(pick.id, pick.mirror), null) || { id: pick.id, name: "", season: "", W: st.W, H: st.H, cells: st.cells };
      state = st;
      stable = false;
      lastClear = null;
      safeCall(() => render.build(state, picture));
      if (!hiddenNow) safeCall(() => render.resume());
      hud();
      setPhase("play");
      setHint("");
      if (state.won) { onWon(false); return true; }
      if (safeCall(() => L.isStable(state), false)) { stable = true; afterStable(); }
      kick();
      return true;
    },
    logic() { return clone(state); }
  });

  // ===== 起動 =====
  (function boot() {
    fast = !!safeCall(() => L.validateFlag(readKey(KEY_FAST)), false);
    safeCall(() => render.setFast(fast));
    const sv = safeCall(() => L.validateSave(readKey(KEY_SAVE)), null);
    let ok = false;
    if (sv && Number.isSafeInteger(sv.level) && sv.level >= 1) {
      // 保存の絵が PICTURE_ORDER に無い：pickPicture で選び直してその面の最初から
      const known = sv.pick && inOrder(sv.pick.id);
      ok = startLevel(sv.level, known ? sv.pick : null, known ? sv.presses : [], known ? sv.t : 0);
    }
    if (!ok) ok = startLevel(Math.min(Number.MAX_SAFE_INTEGER, (Number(best) || 0) + 1), null, [], 0);
    if (!ok) startLevel(1, null, [], 0);
    requestAnimationFrame(() => { safeCall(() => render.layout()); fitTitle(); });
    fitTitle();
    syncPhase();
    if (!safeCall(() => L.validateFlag(readKey(KEY_HELP)), false)) showHelp();
  })();
})();

// オフラインでも遊べるようにする（https か localhost のときだけ有効）
if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("../../sw.js").catch(() => { /* 登録できなくてもゲームは遊べる */ });
  });
}
