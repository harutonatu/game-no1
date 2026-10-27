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
  // v37 の新しい仕掛け（契約 §19）：はじめて出た面で説明を見たら "1"
  const GIM_KEYS = { small: L.SAVE_KEY_SMALL || "irobin.small", only: L.SAVE_KEY_ONLY || "irobin.only", lock: L.SAVE_KEY_LOCK || "irobin.lock" };
  const KEY_BOOK = L.SAVE_KEY_BOOK || "irobin.book";   // なかよしちょう（v45・IB-34。契約 §24）
  // 星（めやすの手数と比べて 1〜3。めやすが無い面は 0）。クリアのカード・共有・帳面で同じ式を使う
  const starOf = (mv, p) => (!p ? 0 : mv <= p ? 3 : mv <= Math.ceil(p * 1.5) ? 2 : 1);
  const CARD_LOCK_MS = 400;     // カードを出してから押せない時間
  const BOOK_LOCK_MS = 300;      // なかよしちょうを開く・閉じるとき、カードの別のボタンを押し間違えない時間（見た目は変えない）
  const BOARD_BLOCK_MS = 300;   // カードを閉じた直後、瓶の押下を受けない時間

  const HINT_IDLE = "びんを えらんで、べつの びんに そそいでね";
  const HINT_FIRST = "うえの どうぶつさんが ほしい いろを、1⁠ぽ⁠ん⁠に 4⁠つ あつめよう";   // 「1ぽんに 4つ」は途中で折れないよう、字の間に U+2060（幅 0 の結合）を入れてある
  const HINT_SELECTED = "どの びんに そそぐ？（もういちど おすと やめる）";
  const HINT_STUCK = "うごかせる びんが ないよ。「1手もどす」か「やりなおし」を おしてね";
  // 手は残っているが、もう全部は届けられない（ソルバーが上限内で「解けない」と言い切れたときだけ）
  const HINT_DOOMED = "この ままだと ぜんぶは とどけられないよ。「1手もどす」を おしてみてね";
  const DOOM_NODE_LIMIT = 3000;   // 詰み予備軍を調べる上限（局面の数。上限に届いたら何も言わない）
  // 詰んだときの「とける ところまで もどす」（IB-25。契約 §20）
  const HINT_REWOUND = "ここからなら ぜんぶ とどけられるよ";
  const REWIND_BUDGET = 100000;   // 戻し先を探すときに調べる局面の合計の上限（超えたら、それまでに解けると確かめた一番新しい局面。IB-46）
  const REWIND_GROW = 4;          // 言い切れなかった局面は、1 局面ずつの上限を DOOM_NODE_LIMIT から 4 倍ずつ広げて調べ直す
  const REWIND_ROUND = 8;         // 1 回の調べで使う量は 1 局面の上限の 8 倍まで（届いたら打ち切って上限を広げる。言い切れない局面が長く続く面で 1 回目に使い切らない）
  // 布の瓶（§17.4）
  const HINT_CLOTH_FIRST = "ぬのの びんは なかが みえないよ。おきゃくさんに とどけると ぬのが とれるよ";
  const HINT_CLOTH_AGAIN = "おきゃくさんに とどけると ぬのが とれるよ";   // はじめての布の面（CLOTH_INTRO_LEVEL）以外で説明を出すとき
  // 横向きで背が低い画面（SE 横）はヒントの欄が狭いので、短い文にする
  const shortHint = () => { try { return !!(window.matchMedia && window.matchMedia("(orientation: landscape) and (max-height: 500px)").matches); } catch (e) { return false; } };
  const clothHint = (m) => (shortHint() ? `ぬのの びんは あと ${m} にん とどけると あくよ` : `ぬのの びんは、おきゃくさんに あと ${m} にん とどけると あくよ`);
  // v37 の仕掛け（§19.4）。はじめて出た面の最初のヒント（横向きで背が低い画面は短い文）と、注げないときの一言
  const GIM_TIP = {
    small: ["ちいさい びんには 3つ までしか はいらないよ。そろえる ばしょには ならないよ", "ちいさい びんは 3つ まで"],
    only: ["くちの しるしと おなじ いろ だけ はいるよ", "しるしと おなじ いろ だけ"],
    lock: ["かぎの びんは、かぎと おなじ いろを 1ぽん そろえると あくよ", "かぎの いろを そろえると あくよ"]
  };
  const HINT_SMALL_FULL = "ちいさい びんには 3つ までしか はいらないよ";
  const onlyHint = (c) => `この びんには ${colorName(c)} しか いれられないよ`;
  const lockHint = (c) => (shortHint() ? `${colorName(c)}を そろえると あくよ` : `かぎの びんは、${colorName(c)}を 1ぽん そろえると あくよ`);
  const DENY_HINT = {
    covered: "ぬのの びんは、おきゃくさんに とどけると あくよ",
    locked: "かぎの びんは、かぎの いろを そろえると あくよ",
    only: "その びんには しるしの いろ しか いれられないよ",
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
    el.soundBtn.setAttribute("aria-label", "効果音");   // オン・オフは aria-pressed だけで伝える（名前に入れると読み上げが二重になる。X-25）
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
  // X-22：比べるのは保存の生の文字。どちらも保存なし（null）なら「変わっていない」と見なす（今は毎回保存から読むので困らない）。メモリの値から書く保存を足すときは、書くたびに増やす印（書き込みの回数）で比べる形に変える
  const changedElsewhere = () => WATCH_KEYS.some((k) => readKey(k) !== seenRaw.get(k));
  // 表に戻ったとき（visible・pageshow）：ほかで変わっていたら書かずに開き直す（true なら、ほかの処理はしない）
  function reloadIfStale() {
    if (!stale && WATCH_KEYS.every((k) => readKey(k) === seenRaw.get(k))) return false;
    stale = true;
    if (reloading) return true;
    reloading = true;
    if (self.YubiNotice) self.YubiNotice.markReload();   // 開き直したあとに「ほかの タブの つづきから はじめました」を 1 回出す（X-24）
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
  // なかよしちょう：いつも保存から読み直す（メモリの値から書かない。X-20 の G7 の場面にしない）。無い人は 0 から（古い保存から数を作らない）
  function readBookNow() { return typeof L.readBook === "function" ? safeCall(() => L.readBook(readKey(KEY_BOOK)), null) : null; }
  function dressMap(book) { const m = {}; for (const k of R.ANIMALS || []) m[k] = safeCall(() => L.bookStep(book && book.a ? book.a[k] || 0 : 0), 0) || 0; return m; }

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
  let overlayKind = null;       // null | help | clear | confirm | rescue | book（なかよしちょう。クリアのカードから開く）
  let custom = null;            // setState で入れた最初の局面（テスト用。保存しない）
  let cardShownAt = -Infinity;
  let blockUntil = -Infinity;
  let bookLockAt = -Infinity;   // なかよしちょうを開いた・閉じた時刻（BOOK_LOCK_MS の間は、クリアのカードとなかよしちょうのボタンを受けない）
  let rewindRun = -1;           // 「とける ところまで もどす」の探しを待っている回（runId）。その間と、探し終えた直後 BOARD_BLOCK_MS は押下を受けない（IB-46）
  let rewindBlockUntil = -Infinity;
  let pending = null;           // 演出が終わったら続ける処理 { token, fn }
  let pourSeq = 0;
  let lastClear = null;         // { level, moves, improved, par }
  let par = 0;                  // この面の目安の手数（生成時にソルバーが見つけた解の長さ。最短とは限らない）
  let doomed = false;           // 手はあるが、もう解けない（ソルバーが言い切れたとき）
  let rescueOwed = false;       // 予備軍のカードを出すはずが取りやめになった（遊び方を開いていた・裏に回っていた・すぐ次の手を指した）。次に予備軍のまま注いだら出す（IB-25）
  let clothTipLevel = 0;        // 布の説明を出した面（やりなおしても同じ面なら出す）
  let clothTip = false;         // はじめて布が出た面（面の最初のヒントを布の説明にし、布の瓶を指さす）
  let gimTipLevel = 0;          // v37 の仕掛けの説明を出した面（やりなおしても同じ面なら出す）
  let gimTipKind = null;
  let gimTip = null;            // はじめて出た仕掛け（"small" | "only" | "lock" | null）。面の最初のヒントにし、その瓶を光らせる

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
  // 面の瓶にある v37 の仕掛け（§19）
  const gimsOf = (s) => {
    const bs = s && Array.isArray(s.bottles) ? s.bottles : [];
    return { small: bs.some((b) => b && b.cap === 3), only: bs.some((b) => b && Number.isSafeInteger(b.only)), lock: bs.some((b) => b && Number.isSafeInteger(b.lock)) };
  };
  const idleHint = () => (doomed ? HINT_DOOMED : clothTip && moves.length === 0 ? (shortHint() ? "とどけると ぬのが とれるよ" : level === (L.CLOTH_INTRO_LEVEL || 5) ? HINT_CLOTH_FIRST : HINT_CLOTH_AGAIN)
    : gimTip && moves.length === 0 ? GIM_TIP[gimTip][shortHint() ? 1 : 0] : level <= 2 && moves.length === 0 ? HINT_FIRST : HINT_IDLE);
  const isStuckNow = () => !!(state && !state.won && safeCall(() => L.isStuck(state), false));
  const restPhase = () => (state && state.won ? "clear" : isStuckNow() ? "stuck" : selected !== null ? "selected" : "idle");

  // 表示：ロジックの値をそのまま出す
  // 面の番号の字の大きさ：4 桁まで s、5 桁は m、6〜8 桁は t（1 段のまま字を 12px に詰める）、9 桁からは l（番号を下の段にまわす）。6〜8 桁を m のまま並べると SE 縦で数 px 足りない（IB-30）
  const sizeOf = (text) => (text.length <= 4 ? "s" : text.length <= 5 ? "m" : text.length <= 8 ? "t" : "l");
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
    el.restartBtn.disabled = !(moves.length > 0) || phase === "clear";   // 手が 0 なら押しても何も起きないので、押せない見た目に（IB-13）
    const need = phase === "stuck" || (doomed && phase !== "clear" && phase !== "pouring");
    // 押しても何も起きないボタンは目立たせない（戻す履歴が無い・手が0でやりなおす意味が無い）
    el.undoBtn.dataset.attention = need && !el.undoBtn.disabled ? "1" : "0";
    el.restartBtn.dataset.attention = need && moves.length > 0 ? "1" : "0";
    // 最初の2面は、注文（トレイ）を指さす
    el.shop.dataset.tip = level <= 2 && moves.length === 0 && phase !== "clear" ? "1" : "0";
    // はじめて布が出た面は、布の瓶の札を指さす
    el.board.dataset.clothTip = clothTip && moves.length === 0 && phase !== "clear" ? "1" : "0";
    // はじめて出た v37 の仕掛けの瓶を光らせて指さす（§19.4）
    el.board.dataset.gimTip = gimTip && moves.length === 0 && phase !== "clear" ? gimTip : "";
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
    rescueOwed = false;
    par = b.created && b.created.info && Array.isArray(b.created.info.solution) ? b.created.info.solution.length : 0;
    // はじめて布が出た面：布の説明を出し、見たことを保存する
    // （やりなおしで同じ面に戻ったときも出す。保存は見せた時点で "1"）
    const clothSeen = safeCall(() => L.validateFlag(readKey(KEY_CLOTH)), false);
    clothTip = hasCloth(b.base) && (clothTipLevel === n || (!clothSeen && moves.length === 0));
    if (clothTip) { clothTipLevel = n; if (!clothSeen) writeKey(KEY_CLOTH, "1"); }
    // はじめて v37 の仕掛けが出た面（布の説明の面でなければ）：ちいさい → いろ きまり → かぎ の順に、まだ見ていない 1 つを説明する
    gimTip = null;
    if (!clothTip) {
      const has = gimsOf(b.base);
      for (const k of ["small", "only", "lock"]) {
        if (!has[k]) continue;
        const seen = safeCall(() => L.validateFlag(readKey(GIM_KEYS[k])), false);
        if ((gimTipLevel === n && gimTipKind === k) || (!seen && moves.length === 0)) { gimTip = k; break; }
      }
      if (gimTip) { gimTipLevel = n; gimTipKind = gimTip; }   // 既読にするのは最初の 1 手を指した時（doMove）
    }
    render.build(state, { orders: ordersOf(b.base), places: b.base.bottles.length });
    render.update(state, { selected: null });
    if (state.won) {   // 最後の手まで保存されていた（クリアの記録の前に閉じた）：その面のクリアのカードから続ける（IB-22）
      hud();
      onClear({ restored: true });
      return true;
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
    // かぎの びん：選べない。揺らして鍵の色を言う。選んでいる瓶があっても、その選びは解除しない（§19.4）
    if (Number.isSafeInteger(b.lock)) {
      setHint(lockHint(b.lock));
      render.deny(i, "locked");
      sfx.play("deny");
      return "locked";
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
      const tb = state.bottles[i];
      setHint(o && o.reason === "full" && tb && tb.cap === 3 ? HINT_SMALL_FULL : o && o.reason === "only" && tb && Number.isSafeInteger(tb.only) ? onlyHint(tb.only) : (o && DENY_HINT[o.reason]) || idleHint());
      if (phase !== "pouring") setPhase(restPhase());
      return "invalid";
    }
    // 前の演出が残っていれば終わらせてから（速く遊ぶ人を待たせない）
    flush();
    history.push(state);
    moves.push([o.fromId, o.toId]);
    if (gimTip && moves.length === 1) writeKey(GIM_KEYS[gimTip], "1");   // 説明を見て最初の 1 手を指した：既読にする（出した瞬間でなく）
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
      showRescue("stuck");
      return;
    }
    setPhase(selected !== null ? "selected" : "idle");
    if (checkDoomed()) {
      renderTools();
      if (selected === null) setHint(HINT_DOOMED);
      // 知らせる音は、解けなくなった最初の1回だけ。カードも最初の1回だけ（取りやめになっていたら、予備軍のまま進んだ次の手で出す）
      if (!wasDoomed || rescueOwed) { if (!wasDoomed) sfx.play("stuck"); showRescue("doomed"); }
      return;
    }
    if (selected !== null) { setHint(HINT_SELECTED); return; }
    const uh = unveilHint(o);
    if (uh) { setHint(uh); return; }
    const ul = Array.isArray(o.unlocked) ? o.unlocked : [];
    if (ul.length) { setHint(`${colorName(ul[0].color)}が そろって、かぎが あいた！`); return; }
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
  function onClear(o) {
    selected = null;
    setPhase("clear");
    const r = safeCall(() => L.recordBest(best, level), { best, improved: false });
    const improved = !!r.improved;
    best = r.best;
    writeKey(KEY_BEST, String(best));
    const h = L.hud(state);
    const ms = safeCall(() => L.milestoneFor(level), null) || { milestone: false, news: null, next: level + 1, more: true };
    const animals = (safeCall(() => render.animalsSeen(), []) || []).map((k, i) => k || safeCall(() => L.animalFor(level, i), "kuma"));
    // なかよしちょう（IB-34）：次の面への保存（irobin.save）より先に書く。開き直してクリアのカードから続けた面で、
    // もう数えてある（last が この面）なら数は足さない（契約 §24.3）。setState の局面（custom）は書かない
    let ups = [], dress = null;
    if (!custom) {
      const rb = readBookNow();
      const r2 = rb ? safeCall(() => L.addClear(rb.book, { level, animals, star: starOf(h.moves, par), moves: h.moves, count: !(o && o.restored && rb.book.last === level) }), null) : null;
      if (r2) {
        if (rb.write) writeKey(KEY_BOOK, L.makeBook(r2.book));
        ups = rb.write ? r2.ups : [];   // 新しい版の帳面は読めない（写さない）ので、段が上がった一言は出さない
        dress = dressMap(r2.book);
        if (typeof render.setDress === "function") render.setDress(dress);
      }
    }
    lastClear = { level, moves: h.moves, improved, par, milestone: !!ms.milestone, news: ms.news, next: ms.next, more: ms.more !== false, animals, ups, dress };
    writeKey(KEY_SAVE, L.makeSave(level + 1, []));
    setHint(`${level} めん クリア！`);
    sfx.play("clear");
    const p = setPending(() => showClearCard());
    render.celebrate().then(() => p.run());
  }
  // 予告の文（節目のカード。IB-24）
  const NEWS_TEXT = { cloth: "ぬのの びんが でるよ", colors: "いろが ふえるよ", hidden: "かくれた いろが でるよ", hiddenAll: "かくれた いろが ふえるよ", small: "ちいさい びんが でるよ", only: "いろ きまりの びんが でるよ", key: "かぎの びんが でるよ" };
  function nextNoteText(c) {
    const next = Number(c.next) || c.level + 1;
    const news = c.news;
    if (news && NEWS_TEXT[news.kind]) {
      return news.at === next ? `つぎは ${next}めん。${NEWS_TEXT[news.kind]}` : `つぎは ${next}めん。${news.at}めんで ${NEWS_TEXT[news.kind]}`;
    }
    if (c.more) {
      const nm = safeCall(() => R.ANIMAL_NAMES[L.animalFor(next, 0)], "") || "おきゃくさん";
      return `つぎは ${next}めん。${nm}さんが まってるよ`;
    }
    // 105 面から先（more でない）：なかよしの段が一番近い動物を出す（IB-42）。全部そろっていれば今までどおり
    const near = safeCall(() => {
      const rb = readBookNow();
      if (!rb || !rb.write) return null;   // 新しい版の帳面は「あと ○にん」を出さない
      let pick = null;
      for (const k of R.ANIMALS || []) {
        const n = rb.book.a[k] || 0, at = L.nextStepAt(n);
        if (at && (!pick || at - n < pick.left)) pick = { k, left: at - n, step: L.bookStep(n) + 1 };
      }
      return pick;
    }, null);
    const item = near && R.DRESS_ITEMS && R.DRESS_ITEMS[near.k] ? R.DRESS_ITEMS[near.k][near.step - 1] : null;
    if (near && item) return `つぎは ${next}めん。${R.ANIMAL_NAMES[near.k] || "おきゃくさん"}さん あと ${near.left}にんで ${item[0]}`;
    return `つぎは ${next}めん`;
  }
  // なかよしの段が上がったときのクリアのカードの一言（IB-34）。ups＝[{ kind, step }]。無ければ []
  // 返す形は [{ t: 文字, nb: true なら途中で折り返さない }]（おしゃれの名前が「まるい / めがね」と割れないように）
  function friendParts(ups) {
    const list = [];
    for (const u of Array.isArray(ups) ? ups : []) if (u && R.ANIMAL_NAMES[u.kind] && !list.some((x) => x.kind === u.kind)) list.push(u);
    if (!list.length) return [];
    if (list.length > 1) return [{ t: `${list.map((u) => R.ANIMAL_NAMES[u.kind] + "さん").join("・")}が おしゃれを したよ！` }];
    const u = list[0], nm = R.ANIMAL_NAMES[u.kind];
    const item = R.DRESS_ITEMS && R.DRESS_ITEMS[u.kind] ? R.DRESS_ITEMS[u.kind][u.step - 1] : null;
    if (!item) return [{ t: `${nm}さんが おしゃれを したよ！` }];
    return [{ t: `${nm}さんが ` }, { t: item[0], nb: true }, { t: "を つけたよ！" }];
  }
  function friendText(ups) { return friendParts(ups).map((x) => x.t).join(""); }
  // 文字を textContent で入れる。nb の所は white-space: nowrap の span に入れる
  function fillParts(node, parts) {
    node.textContent = "";
    for (const x of parts) {
      if (x.nb) { const sp = document.createElement("span"); sp.className = "nw"; sp.textContent = x.t; node.appendChild(sp); }
      else node.appendChild(document.createTextNode(x.t));
    }
  }
  // 共有（IB-31）。★3 と節目のカードだけ。回数は測らない・印は付けない（ユーザー決定）
  const SHARE_URL = "https://harutonatu.github.io/game-no1/games/irobin/";
  const ANIMAL_EMOJI = { kuma: "🐻", usagi: "🐰", neko: "🐱", penguin: "🐧", risu: "🐿️", hitsuji: "🐑" };
  let sharing = false;
  function shareText(c, star) {
    const stars = star === 3 ? " ★★★" : star === 2 ? " ★★☆" : star === 1 ? " ★☆☆" : "";
    const faces = (c.animals || []).map((k) => ANIMAL_EMOJI[k] || "").join("");
    return `いろびん ${c.level}めん クリア！${stars}\n${faces} に とどけたよ（${c.moves}かい）`;
  }
  function setShareNote(text, url) {
    const n = el.card.querySelector(".share-note");
    if (!n) return;
    n.textContent = text;
    if (url) { const u = document.createElement("span"); u.className = "url"; u.textContent = SHARE_URL; n.appendChild(u); }
  }
  function doShare() {
    if (sharing) return;
    const c = lastClear;
    if (!c) return;
    const p = Number(c.par) || 0;
    const star = starOf(c.moves, p);
    const text = shareText(c, star);
    try {
      if (typeof navigator.share === "function") {
        sharing = true;
        let pr;
        try { pr = navigator.share({ title: "いろびん", text, url: SHARE_URL }); } catch (e) { pr = Promise.reject(e); }
        Promise.resolve(pr).then(() => {}, (e) => {
          const name = e && e.name;
          if (name === "AbortError" || name === "InvalidStateError") return;
          setShareNote("この あどれすを コピーしてね", true);
        }).then(() => { sharing = false; });
      } else if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        const myRun = runId;
        navigator.clipboard.writeText(`${text}\n${SHARE_URL}`).then(() => {
          if (overlayKind !== "clear" || myRun !== runId) return;
          const btn = el.card.querySelector("button.share");
          if (btn) {
            btn.textContent = "コピーしました";
            later(() => { const b = el.card.querySelector("button.share"); if (b) b.textContent = "ともだちに おしえる"; setShareNote("", false); }, 3000);   // 成功の吹き出しは、ボタンの文字が戻るのと同時に消す
          }
          setShareNote("LINE などの にゅうりょくらんを ながおしして はりつけてね", false);
        }, () => { if (overlayKind === "clear") setShareNote("コピーできなかったよ。ながおしで コピーしてね", true); });
      } else {
        setShareNote("コピーできなかったよ。ながおしで コピーしてね", true);
      }
    } catch (e) {
      sharing = false;
      setShareNote("コピーできなかったよ。ながおしで コピーしてね", true);
    }
  }
  // o.again：なかよしちょうから戻ったとき（音と 400ms の押せない時間はくり返さない。フォーカスは「なかよしちょう」へ）
  function showClearCard(o) {
    const again = !!(o && o.again);
    const fb = focusBack;
    sharing = false;   // 共有の返事が来ない端末でも、次のカードでは押せるように戻す
    const c = lastClear || { level, moves: moves.length, improved: false, par, milestone: false, news: null, next: level + 1, more: true, animals: [], ups: [], dress: null };
    // 上達が見えるように、目安の手数と比べて星1〜3（責めない言い方。目安は最短とは限らないので「めやす」と書く）
    const p = Number(c.par) || 0;
    const star = starOf(c.moves, p);
    const starText = star === 3 ? "★★★ すごい！" : star === 2 ? "★★☆ いいね！" : star === 1 ? "★☆☆ つぎは めやすを めざそう" : "";
    const showRecord = c.improved && c.milestone;
    const showQuiet = c.improved && !c.milestone;
    const canShare = star === 3 || !!c.milestone;
    const animals = Array.isArray(c.animals) ? c.animals : [];
    const friend = friendText(c.ups);
    showCard(`
      <h2 id="cardTitle" data-f="h"></h2>
      <p class="stars" data-f="s"></p>
      <div class="served" role="img"></div>
      <p class="moves"><span data-f="m1"></span><span data-f="m2"></span></p>
      <p class="best-new" data-f="b"></p>
      <p class="next-note" data-f="n"></p>
      <p class="friend" data-f="f"></p>
      <div class="btns">
        ${canShare ? '<p class="share-note" aria-live="polite"></p>' : ""}
        <button class="cta primary" type="button" data-cmd="next">つぎの めんへ</button>
        <button class="cta half" type="button" data-cmd="menu">メニューへ</button>
        <button class="cta half book" type="button" data-cmd="book">なかよしちょう</button>
        ${canShare ? '<button class="cta share" type="button" data-cmd="share">ともだちに おしえる</button>' : ""}
      </div>`, { h: `${c.level} めん クリア！`, s: starText, m1: `${c.moves}かい そそいで とどけたよ`, m2: p ? `（めやす ${p}かい）` : "", b: showRecord ? "あたらしい きろく！" : showQuiet ? `ここまで ${c.level}めん` : "", n: c.milestone ? nextNoteText(c) : "", f: friend }, "clear");
    if (again) focusBack = fb;   // なかよしちょうへ行く前の戻り先（瓶など）を残す
    if (!friend) { const fr = el.card.querySelector(".friend"); if (fr) fr.hidden = true; }
    else { const fr = el.card.querySelector(".friend"); if (fr) fillParts(fr, friendParts(c.ups)); }
    // 動物の顔の列（狭い画面では CSS で隠す）。aria-label は showCard のあとに直接入れる
    const served = el.card.querySelector(".served");
    if (served) {
      const dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
      animals.forEach((kind) => {
        const cv = document.createElement("canvas");
        cv.width = Math.round(28 * dpr); cv.height = Math.round(28 * dpr);
        try { const ctx = cv.getContext("2d"); if (ctx) R.drawAnimal(ctx, kind, { w: cv.width, h: cv.height, mood: "happy", dress: c.dress ? c.dress[kind] || 0 : 0 }); } catch (e) { /* 絵が描けなくても続ける */ }
        served.appendChild(cv);
      });
      if (animals.length) served.setAttribute("aria-label", `とどけた おきゃくさん：${animals.map((k) => R.ANIMAL_NAMES[k] || "おきゃくさん").join("、")}`);
      else served.hidden = true;
    }
    if (!p) { const m2 = el.card.querySelector('.moves span:last-child'); if (m2) m2.hidden = true; }
    if (!showRecord && !showQuiet) { const b = el.card.querySelector(".best-new"); if (b) b.hidden = true; }
    else if (showQuiet) { const b = el.card.querySelector(".best-new"); if (b) b.classList.add("quiet"); }
    if (!c.milestone) { const nn = el.card.querySelector(".next-note"); if (nn) nn.hidden = true; }
    if (!starText) { const sEl = el.card.querySelector(".stars"); if (sEl) sEl.hidden = true; }
    else { const sEl = el.card.querySelector(".stars"); if (sEl) { sEl.dataset.stars = String(star); sEl.setAttribute("aria-label", `ほし ${star}つ`); } }
    if (again) {
      bookLockAt = now();   // 閉じた直後に、高さの変わったカードの別のボタンを押してメニューへ出ないように
      const bk = el.card.querySelector('button[data-cmd="book"]');
      if (bk) { try { bk.focus({ preventScroll: true }); } catch (e) { bk.focus(); } }
      return;
    }
    cardShownAt = now();
    el.card.querySelectorAll(".btns button").forEach((btn) => btn.setAttribute("aria-disabled", "true"));
    later(() => el.card.querySelectorAll(".btns button[aria-disabled]").forEach((btn) => btn.removeAttribute("aria-disabled")), CARD_LOCK_MS);
    if (showRecord || friend) later(() => sfx.play("best"), 450);   // 記録となかよしが重なっても 1 回だけ
  }
  // ===== なかよしちょう（IB-34・IB-41。クリアのカードから開く） =====
  const isStandalone = () => { try { return navigator.standalone === true || !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches); } catch (e) { return false; } };
  function showBook() {
    if (overlayKind !== "clear") return;
    const fb = focusBack;
    const rb = readBookNow();   // いつも保存から読む（メモリの値を出さない）
    const book = rb && rb.book && rb.book.a ? rb.book : { a: {}, s: {} };
    const stars = safeCall(() => L.bookStars(book), 0) || 0;
    showCard(`
      <div class="book-head">
        <h2 id="cardTitle">なかよしちょう</h2>
        <p class="book-stars" data-f="s"></p>
      </div>
      <ul class="book"></ul>
      <p class="note book-home">ホーム画面に ついかすると、きろくが きえにくいよ</p>
      <div class="btns"><button class="cta primary" type="button" data-cmd="bookClose">もどる</button></div>`, { s: stars > 0 ? `あつめた ★ ${stars}こ` : "" }, "book");
    focusBack = fb;   // もどる → クリアのカード → その先の戻り先は、クリアのカードを出す前のまま
    if (!(stars > 0)) { const sEl = el.card.querySelector(".book-stars"); if (sEl) sEl.hidden = true; }
    bookLockAt = now();   // 開いた直後に「もどる」を 2 回押して、戻ったカードの別のボタンに当たらないように
    if (isStandalone()) { const hm = el.card.querySelector(".book-home"); if (hm) hm.hidden = true; }
    const ul = el.card.querySelector("ul.book");
    if (!ul) return;
    const dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    for (const k of R.ANIMALS || []) {
      const n = Number.isSafeInteger(book.a[k]) && book.a[k] > 0 ? book.a[k] : 0;
      const step = safeCall(() => L.bookStep(n), 0) || 0;
      const at = safeCall(() => L.nextStepAt(n), 0) || 0;
      const items = R.DRESS_ITEMS && R.DRESS_ITEMS[k] ? R.DRESS_ITEMS[k] : [];
      const li = document.createElement("li");
      li.dataset.kind = k;
      li.dataset.step = String(step);
      const cv = document.createElement("canvas");
      cv.width = Math.round(56 * dpr); cv.height = Math.round(60 * dpr);
      cv.setAttribute("aria-hidden", "true");
      try { const ctx = cv.getContext("2d"); if (ctx) R.drawAnimal(ctx, k, { w: cv.width, h: cv.height, mood: "happy", dress: step }); } catch (e) { /* 絵が描けなくても続ける */ }
      const who = document.createElement("div");
      who.className = "who";
      const nm = document.createElement("b"); nm.className = "name"; nm.textContent = R.ANIMAL_NAMES[k] || "おきゃくさん";
      const cnt = document.createElement("span"); cnt.className = "cnt"; cnt.textContent = `${n}にん`;
      const left = document.createElement("span"); left.className = "left";
      if (at && items[step]) fillParts(left, [{ t: `あと ${at - n}にんで ` }, { t: items[step][0], nb: true }]);
      else { left.textContent = "ぜんぶ そろったよ"; left.classList.add("done"); }
      who.append(nm, cnt, left);
      li.append(cv, who);
      ul.appendChild(li);
    }
  }
  function closeBook() {
    if (overlayKind !== "book") return;
    showClearCard({ again: true });
  }

  // ===== お助け =====
  function undo() {
    if (overlayKind || !state || state.won || phase === "clear" || rewindBusy()) return;
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
  // 詰んだ・詰み予備軍になった（注いだあと）：「とける ところまで もどす」のカードを出す（IB-25。契約 §20 R1・R2）。
  // 出すのは次のひと区切り（later 0）。演出の途中に「1手もどす」などで flush されてから局面が変わったときは出さない
  function showRescue(kind) {
    const mark = moves.length, myState = state;
    rescueOwed = true;   // 出したら消す。取りやめなら残す
    later(() => {
      if (overlayKind || paused || !state || state.won || state !== myState || moves.length !== mark) return;
      if (kind === "stuck" ? phase !== "stuck" : !doomed) return;
      rescueOwed = false;
      render.pause();
      showCard(`
      <h2 id="cardTitle" data-f="h"></h2>
      <p>とける ところまで もどす？</p>
      <div class="btns">
        <button class="cta primary" type="button" data-cmd="rewindYes">とける ところまで もどす</button>
        <button class="cta" type="button" data-cmd="close">このまま つづける</button>
      </div>`, { h: kind === "stuck" ? "うごかせる びんが ないよ" : "もう ぜんぶは とどけられないよ" }, "rescue");
      cardShownAt = now();
    }, 0);
  }
  // 戻し先：解ける最後の局面（R4。IB-46 で探し方を変えた）。history[k]＝k 手 注いだあとの局面。
  // 解ける局面から注いだ手を戻した局面も解けるので、解ける局面は 0〜K 手の続き。lo＝解けると確かめた一番新しい k（0 は生成で確かめ済み）、
  // hi＝解けないと言い切れた一番古い k（今の局面）。lo と hi の間を新しい方から上限 lim で調べ、言い切れない局面は lim を広げて調べ直す。
  // 合計が REWIND_BUDGET を超えたら lo（直す前は 1 局面 3,000 までで言い切れないと面の最初まで落ちていた）
  function rewindTarget() {
    let lo = 0, hi = history.length, spent = 0, lim = DOOM_NODE_LIMIT;
    while (hi - lo > 1 && spent < REWIND_BUDGET) {
      let round = 0;
      for (let k = hi - 1; k > lo; k--) {
        const r = safeCall(() => L.solve(history[k], { nodeLimit: Math.max(1, Math.min(lim, REWIND_BUDGET - spent)) }), null);
        const used = r && Number.isFinite(r.nodes) && r.nodes > 0 ? r.nodes : DOOM_NODE_LIMIT;   // 壊れた結果でも必ず進む（止まらない）
        spent += used; round += used;
        if (r && r.solved === true) { lo = k; break; }
        if (r && r.solved === false && r.exhausted === false) hi = k;
        if (spent >= REWIND_BUDGET || round >= lim * REWIND_ROUND) break;
      }
      lim *= REWIND_GROW;
    }
    return lo;   // 見つからない・探しきれない：確かめた一番新しい局面（無ければ面の最初。setState の局面ならその局面）
  }
  // カードを先に消してから、次のひと区切りで探す（探す間に止まっても、カードが残って見えない）。
  // 探す前に局面が変わっていたら何もしない（showRescue と同じ守り方）。探す間と探し終えた直後は押下を受けない（止まっている間のタップで瓶が選ばれない）
  function rewindBusy() { return rewindRun === runId || now() < rewindBlockUntil; }
  function doRewind() {
    hideOverlay();
    if (!document.hidden) render.resume();
    if (!state || state.won || phase === "clear") return;
    flush();
    if (state.won || phase === "clear") return;
    const mark = moves.length, myState = state;
    rewindRun = runId;
    later(() => {
      rewindRun = -1;
      if (overlayKind || !state || state !== myState || moves.length !== mark || state.won || phase === "clear") return;
      const k = rewindTarget();
      rewindBlockUntil = now() + BOARD_BLOCK_MS;
      if (k >= history.length) return;
      state = history[k];
      history.length = k;
      moves.length = k;
      selected = null;
      doomed = false;
      render.update(state, { selected: null });
      save();
      hud();
      sfx.play("undo");
      setPhase(restPhase());
      checkDoomed();
      renderTools();
      setHint(custom && k === 0 ? idleHint() : HINT_REWOUND);   // setState の局面の最初へ戻ったとき（解けるとは限らない）は、ふつうのヒント
    }, 0);
  }
  function askRestart() {
    if (overlayKind || !state || phase === "clear" || rewindBusy()) return;
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
    el.card.dataset.kind = kind;   // CSS がカードの種類で並べ方を変える（なかよしちょう）
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
  // 遊び方カードの v37 の仕掛けの行（§19.4）：もう出てきた（その面まで来た）仕掛けだけ 1 行ずつ。まだの仕掛けは書かない（カードを短く）
  function gimHelp() {
    const reach = Math.max(level, (Number(best) || 0) + 1);
    const parts = [];
    if (reach >= (L.SMALL_FROM || 41)) parts.push('<b>ちいさい びん</b>は 3つ まで。');
    if (reach >= (L.ONLY_FROM || 71)) parts.push('<b>いろ きまりの びん</b>は しるしの いろ だけ。');
    if (reach >= (L.KEY_FROM || 101)) parts.push('<b>かぎの びん</b>は かぎの いろを そろえると あく。');
    return parts.length ? `<li class="gimhelp">${parts.join("")}</li>` : "";
  }
  // 遊び方の 3 つ目の行（IB-36）：「？」（12 面から）と 布（5 面から）は、その面まで来た人にだけ書く（はじめての人のカードを短く）
  function laterHelp() {
    const reach = Math.max(level, (Number(best) || 0) + 1);
    const parts = [];
    if (reach >= 12) parts.push("「？」は うえを どかすと みえるよ。");   // 12 面＝はじめての隠れ（logic.js NEWS の [12, "hidden"]）
    if (reach >= (L.CLOTH_INTRO_LEVEL || 5)) parts.push("<b>ぬのの びん</b>は、とどけた にんずで あくよ。");
    return parts.length ? `<li>${parts.join("")}</li>` : "";
  }
  // マウス・トラックパッドがあるときだけ キーの説明を出す（ハシわたりの hasFinePointer と同じ。iPhone では出さない。IB-36）
  const hasFinePointer = () => { try { return !!(window.matchMedia && window.matchMedia("(any-pointer: fine)").matches); } catch (e) { return false; } };
  function showHelp() {
    if (overlayKind === "help") return;
    if (overlayKind) return;   // クリア・確認のカードの上には重ねない
    render.pause();
    showCard(`
      <h2 id="cardTitle">あそびかた</h2>
      <ol class="rules">
        <li>びんを おして、べつの びんを おすと <b>そそげる</b>よ（<b>おなじ いろ</b>の うえ か、<b>からの びん</b>に）。</li>
        <li>4つ そろうと <b>せん</b>。うえの <b>トレイと おなじ いろ</b>なら おきゃくさんに とどくよ。まだ いない いろは、そのまま まつよ。</li>
        ${laterHelp()}${gimHelp()}
      </ol>
      <p class="note">こまったら<span style="white-space:nowrap">「1手もどす」</span><span style="white-space:nowrap">「やりなおし」</span>。${hasFinePointer() ? "キー：やじるし・エンター・すうじ（0 は 10、- は 11、= は 12ぽんめ）で えらぶ。U もどす、M おと。" : ""}</p>
      <div class="btns"><button class="cta primary" type="button" data-cmd="close">わかった</button></div>`, {}, "help");
  }
  function closeCard() {
    if (overlayKind === "help") {
      writeKey(KEY_HELP, "1");
      hideOverlay();
      if (!document.hidden) render.resume();
      return;
    }
    if (overlayKind === "confirm" || overlayKind === "rescue") {
      hideOverlay();
      if (!document.hidden) render.resume();
    }
    if (overlayKind === "book") { closeBook(); return; }   // なかよしちょう（Esc も）→ クリアのカードへ戻る
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
    const note = e.target && e.target.closest ? e.target.closest(".share-note") : null;
    if (note) { note.textContent = ""; return; }   // 吹き出しは押すと閉じる
    const btn = e.target && e.target.closest ? e.target.closest("[data-cmd]") : null;
    if (!btn) return;
    if ((overlayKind === "clear" || overlayKind === "rescue") && now() - cardShownAt < CARD_LOCK_MS) return;   // 出た直後の連打で押し間違えない
    if ((overlayKind === "clear" || overlayKind === "book") && now() - bookLockAt < BOOK_LOCK_MS) return;   // なかよしちょうを開いた・閉じた直後も同じ
    const cmd = btn.dataset.cmd;
    if (cmd === "next") goNext();
    else if (cmd === "menu") goMenu();
    else if (cmd === "close") closeCard();
    else if (cmd === "restartYes") doRestart();
    else if (cmd === "rewindYes") doRewind();
    else if (cmd === "share") doShare();
    else if (cmd === "book") showBook();
    else if (cmd === "bookClose") closeBook();
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
    ? I.attach({ board: el.board, root: document }, { onPick, onCommand }, { isBlocked: () => !!overlayKind || paused || now() < blockUntil || rewindBusy() })
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
      if (overlayKind !== "help" && overlayKind !== "confirm" && overlayKind !== "rescue") render.resume();
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
    if (!s || typeof s !== "object" || !Array.isArray(s.bottles) || !s.bottles.length || s.bottles.length > (L.MAX_BOTTLES || 11)) return null;
    const capN = L.CAP || 4;
    const okColor = (c) => Number.isInteger(c) && c >= 0 && c < (L.COLORS ? L.COLORS.length : 9);
    const bottles = [];
    for (const b of s.bottles) {
      if (!b || !Array.isArray(b.cells) || b.cells.length > capN || !b.cells.every(okColor)) return null;
      const hidden = Array.isArray(b.hidden) ? b.hidden.map(Boolean) : b.cells.map(() => false);
      if (hidden.length !== b.cells.length) return null;
      // v37 の仕掛け（§19）：cap・only・lock はそのまま渡す（形の検査は logic の normalizeState）
      bottles.push({ id: b.id, cells: b.cells.slice(), hidden, sealed: !!b.sealed, cover: Number.isSafeInteger(b.cover) && b.cover >= 0 ? b.cover : null,
        cap: b.cap === 3 ? 3 : 4, only: okColor(b.only) ? b.only : null, lock: okColor(b.lock) ? b.lock : null });
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
      state = st; history = []; moves = []; selected = null; doomed = false; rescueOwed = false; par = 0; clothTip = false; gimTip = null;
      render.build(state, { orders: ordersOf(st), places: placesOf(st) });
      hud();
      setPhase(restPhase());
      setHint(phase === "stuck" ? HINT_STUCK : idleHint());
      return true;
    }
  });

  // ===== 起動 =====
  (function boot() {
    // なかよしちょう：お客さんの おしゃれを渡す（IB-34）。起動では書かない（無い人は 0 から。最初のクリアで書く）
    const rb = readBookNow();
    if (rb && typeof render.setDress === "function") render.setDress(dressMap(rb.book));
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
