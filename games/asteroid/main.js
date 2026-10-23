/*
 * ちきゅうを守れ！ほしくだき — 画面と進行・入力・保存（部品C。作り直し 2026-10-23）
 * 契約：docs/asteroid-contract.md（正とする順は §20 → §21 → §1〜§19）。§5（画面・DOM）・§7（進行・入力・テスト用 API・デバッグ命令）・
 *       §8（保存 v:2 と §8.4 の v:1 の読み方）・§21.3（部品B との約束）・§21.4（X-20・MK20）・§21.5（stepMs）
 * 読み込み順：../../common/sfx.js → logic.js → render.js → main.js
 *
 * - 時間：rAF ごとに差を取り 0.1 秒で頭打ち、STEP（1/30 秒）ずつ step（1 フレームに最大 3 回。足りない分は捨てる）。
 * - 閉じている間は止まる（ユーザー決定「止まる」）：hidden → 保存して rAF を止める。visible → そのまま続き（実際の時計は使わない）。
 * - カード（遊び方・2択・入れ替え・エンディング・さいしょから）が出ている間は進まない（running の 1 行の式。MK20 の置換元）。
 * - 砲台：武器ごとに 1 台（state.turrets[k] は slots[k] の台）。行の並び（上から）＝砲台の並び（左から）。
 * - ひかえと入れ替え：#swapBtn → #swapCard で予約（reserveSwap）。替わるのは次の星の始めと、はね返しのやり直しの始め（logic が swap の出来事を出す）。
 * - X-20（古いページから書き戻さない）：ほかの 7 本と同じ形（WATCH_KEYS・seenRaw・noteSaved・changedElsewhere・reloadIfStale・staleOnHide・storage）。
 * - さいしょから（§19）：asteroid.save と asteroid.save.bak を消し、保存を止めてから読み直す（best・help は残す）。
 * - 場（#field・#fieldCanvas）には押す処理を付けない（ユーザー決定「なにもしない」）。
 * - 画面の数はロジックの関数（formatKakera・upCostOf・slotCostOf・progressOf・dpsOf）の値そのまま（§13-1）。
 * - タイマーは later / clearLater だけ（setTimeout を直接呼ばない）。
 * - 保存は logic の makeSave の形に、main だけが読む欄を 2 つ足して書く（loadSave は知らない欄を読まない）：
 *     t      … 遊んだ秒（エンディングの「あそんだ じかん」用。星の途中の位置と いまの挑戦の秒は logic の mid が持つ）
 *     ending … エンディングのカードを出している途中で閉じたら true（開き直したらカードをもう一度出す）
 */
(function () {
  "use strict";

  const L = window.AsteroidLogic;
  if (!L) { console.error("ほしくだき: AsteroidLogic が読み込まれていません（logic.js）"); return; }
  const NAME = typeof L.NAME === "string" && L.NAME ? L.NAME : "ちきゅうを守れ！ほしくだき";
  const STEP = L.STEP || 1 / 30;
  const MAX_FRAME_SEC = 0.1;
  const MAX_STEPS_PER_FRAME = 3;
  const FF_MAX_SEC = 3600;
  const CARD_LOCK_MS = 400;
  const HINT_MS = 2600;
  const SAVE_EVERY_SEC = 15;          // 遊んでいる間も、この秒ごとに保存（かけらを失いにくく）
  const BOSS_BANNER_SEC = 2.5;        // おおきな ほしが きた！ の帯（ロジックの時計で数える＝止まっている間は消えない）
  const EVOLVE_EVERY = 10, EVOLVE_LAST = 30, EVOLVE_NOTE = 5;
  const SLOTS_MAX = L.SLOTS_MAX || 4;
  const STEP_MS_N = 60;               // stepMs：最近 60 step の中央（§21.5）
  const KEY_SAVE = L.SAVE_KEY || "asteroid.save";
  const KEY_BAK = L.SAVE_KEY_BAK || "asteroid.save.bak";
  const KEY_BEST = L.SAVE_KEY_BEST || "asteroid.best";
  const KEY_HELP = L.SAVE_KEY_HELP || "asteroid.help";
  const W_IDS = Array.isArray(L.WEAPONS) ? L.WEAPONS.map((w) => w.id) : ["shot", "spread", "bomb", "bolt", "beam", "fire"];
  const WEAPON = {};
  if (Array.isArray(L.WEAPONS)) for (const w of L.WEAPONS) WEAPON[w.id] = w;
  const MAT_NAME = {};
  if (Array.isArray(L.MATS)) for (const m of L.MATS) MAT_NAME[m.id] = m.name;

  const HINT_BROKEN = "ほぞんが よめなかったので さいしょから はじめるよ";
  const HINT_MIGRATED = "あたらしい ほしくだきに なったよ。かけらは そのまま つかえるよ";   // v:1 から来たとき（§8.4 ④・§21.7 の案 5）
  const HINT_RETRY_END = "を つよくして もういちど！";   // 先頭に武器の名前（U4）
  const HINT_RETRY = "ひかっている ぶきを つよくして もういちど！";
  const HINT_NEAR = "バリアが ひかってる！";
  const HINT_NO_BENCH = "ひかえの ぶきが まだ ないよ";
  const NEXT_LONG = "つぎの ほしから", NEXT_SHORT = "つぎから";   // 予約の札の頭（UX 1。幅が足りない行だけ短いほう）
  const NEAR_AT = 0.28;                // 地球までの残りがこの割合以下で赤く（U7・Q7）
  const MS_BANNER_SEC = 1.0;           // 25・50・75% の帯（ロジックの時計で数える）
  const MS_TEXT = { 25: "4ぶんの1 こわした！", 50: "はんぶん こわした！", 75: "あと 4ぶんの1！" };
  const PLUS_MS = 800;                 // 「＋12%」を出しておく時間
  const READY_MS = 800;
  const HINT_BLOCKED = "ほぞんが できないよ（このまま あそべるよ）";
  const HINT_RESET_FAIL = "けせなかったよ。もう いちど ためしてね";   // さいしょから で消せない（§19.2 R6。もくもくこうばと同じ言葉）

  const $ = (id) => document.getElementById(id);
  const body = document.body;
  function safeCall(fn, fallback) { try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { console.error("ほしくだき:", e); return fallback; } }
  const now = () => (window.performance && performance.now ? performance.now() : Date.now());

  const el = {
    back: $("back"), title: $("gameTitle"), helpBtn: $("helpBtn"), soundBtn: $("soundBtn"),
    kakera: $("kakera"), starLabel: $("starLabel"), starTag: $("starTag"), starBar: $("starBar"), starFill: $("starFill"),
    field: $("field"), canvas: $("fieldCanvas"), distance: $("distance"), distanceFill: $("distanceFill"),
    weapons: $("weapons"), unlockBtn: $("unlockBtn"), swapBtn: $("swapBtn"), benchCount: $("benchCount"),
    choiceCard: $("choiceCard"), choiceA: $("choiceA"), choiceB: $("choiceB"), choiceNote: $("choiceNote"),
    swapCard: $("swapCard"), swapTitle: $("swapTitle"), swapText: $("swapText"), swapSlots: $("swapSlots"), benchList: $("benchList"), swapDone: $("swapDone"),
    bounceBanner: $("bounceBanner"), clearBanner: $("clearBanner"), bossBanner: $("bossBanner"), msBanner: $("msBanner"), choiceLead: $("choiceLead"),
    endCard: $("endCard"), endText: $("endText"), endStats: $("endStats"), endOk: $("endOk"),
    help: $("help"), helpOk: $("helpOk"), helpMig: $("helpMig"), hint: $("hint"),
    helpRestart: $("helpRestart"), restartCard: $("restartCard"), restartNo: $("restartNo"), restartYes: $("restartYes")
  };
  const part = (node, name) => (node ? node.querySelector('[data-part="' + name + '"]') : null);
  const rows = [0, 1, 2, 3].map((k) => {
    const row = document.querySelector('.wrow[data-slot="' + k + '"]');
    const btn = row ? row.querySelector("[data-up]") : null;
    return {
      row, btn,
      name: part(row, "name"), lv: part(row, "lv"), good: part(row, "good"), dps: part(row, "dps"), note: part(row, "note"),
      next: row ? row.querySelector("[data-next]") : null,
      label: part(btn, "label"), cost: part(btn, "cost"), plus: part(row, "plus"), plusTimer: 0,
      prevCan: undefined, fillShown: "", nextShown: null
    };
  });
  // 画面の大きさ・向きが変わったら、予約の札の長さ（つぎの ほしから／つぎから）を測り直す（次の updateUi で）
  window.addEventListener("resize", () => { for (const r of rows) r.nextShown = null; });
  const slotBtns = [0, 1, 2, 3].map((k) => document.querySelector('[data-swap-slot="' + k + '"]'));
  const barPct = document.querySelector(".barrow [data-part=pct]");
  const missing = ["kakera", "starLabel", "starBar", "canvas", "unlockBtn", "swapBtn", "choiceCard", "swapCard", "benchList"].filter((k) => !el[k]);
  if (missing.length) console.error("ほしくだき: 画面の部品が見つかりません：" + missing.join(", "));

  // 題名（同じなら書き換えない＝ <span> と <wbr> を残す）
  document.title = NAME;
  if (el.title && el.title.textContent !== NAME) el.title.textContent = NAME;

  // ===== 効果音（sfx.js が無くても音なしで遊べる） =====
  const rawSfx = window.YubiSfx && typeof window.YubiSfx.create === "function" ? safeCall(() => window.YubiSfx.create("asteroid"), null) : null;
  let silent = 0;   // advance の間は鳴らさない
  const sfx = {
    get on() { return rawSfx ? !!rawSfx.on : false; },
    unlock() { if (rawSfx) try { rawSfx.unlock(); } catch (e) { /* 無視 */ } },
    toggle() { if (rawSfx) try { return rawSfx.toggle(); } catch (e) { /* 無視 */ } return false; },
    play(name, arg) { if (rawSfx && !silent) try { rawSfx.play(name, arg); } catch (e) { /* 無視 */ } }
  };
  document.addEventListener("pointerdown", () => sfx.unlock(), { capture: true });
  document.addEventListener("touchend", () => sfx.unlock(), { capture: true });
  function renderSoundBtn() {
    if (!el.soundBtn) return;
    el.soundBtn.setAttribute("aria-pressed", String(!!sfx.on));
    el.soundBtn.setAttribute("aria-label", "こうかおん");   // オン・オフは aria-pressed だけで伝える（名前に入れると読み上げが二重になる。X-25）
  }
  function toggleSound() { sfx.unlock(); sfx.toggle(); renderSoundBtn(); }
  renderSoundBtn();

  // ===== 保存の読み書き（できなくても遊べる） =====
  function readKey(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeKey(key, val) {
    if (stale) return false;
    try { localStorage.setItem(key, val); noteSaved(key); return true; } catch (e) { return false; }
  }
  function removeKey(key) {
    if (stale) return false;
    try { localStorage.removeItem(key); noteSaved(key); return localStorage.getItem(key) === null; } catch (e) { return false; }
  }

  // ===== 古いページから書き戻さない（§21.4・X-20。ほかの 7 本と同じ形） =====
  // bfcache（戻る・進む）で戻ったページや、裏にいる間にほかのタブが同じ保存を書いたページは、メモリの古い状態を保存に書かず、
  // 開き直して今の保存から続ける。見張るのは asteroid.save だけ（asteroid.best は大きいときだけ書くので下がらない）。
  // このページが最後に読んだ・書いた生の文字と比べる
  const WATCH_KEYS = [KEY_SAVE];
  const seenRaw = new Map(WATCH_KEYS.map((k) => [k, readKey(k)]));
  let stale = false;                     // true：このページはもう保存しない（開き直す前）
  let reloading = false;                 // true：開き直しをもう頼んだ（pageshow と visibilitychange の両方から呼ばれても1回だけ）
  function noteSaved(key) { if (seenRaw.has(key)) seenRaw.set(key, readKey(key)); }
  const changedElsewhere = () => WATCH_KEYS.some((k) => readKey(k) !== seenRaw.get(k));
  // 表に戻ったとき（visible・pageshow）：ほかで変わっていたら書かずに開き直す（true なら、ほかの処理はしない）
  function reloadIfStale() {
    if (!stale && !changedElsewhere()) return false;
    stale = true;
    if (reloading) return true;
    reloading = true;
    stopLoop();
    clearLater();
    try { location.reload(); } catch (e) { console.error("ほしくだき: 開き直せませんでした", e); }
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

  // ===== タイマー（later / clearLater） =====
  const timers = new Set();
  function later(fn, ms) {
    const id = setTimeout(() => { timers.delete(id); try { fn(); } catch (e) { console.error("ほしくだき:", e); } }, ms);
    timers.add(id);
    return id;
  }
  function cancel(id) { if (id && timers.has(id)) { clearTimeout(id); timers.delete(id); } }
  function clearLater() { timers.forEach((id) => clearTimeout(id)); timers.clear(); hintTimer = 0; cardUnlockTimer = 0; }

  // ===== 状態 =====
  let state = null;            // AsteroidLogic の state（イミュータブル）
  let overlay = null;          // null | 'help' | 'choose' | 'swap' | 'end' | 'restart'
  let restarting = false;      // さいしょから（§19）：保存を消したあとは、古い状態を二度と書かない
  let sleeping = false;
  let rafId = 0, lastT = null, acc = 0;
  let pendingEvents = [];      // ボタンで起きた出来事（upgrade の evolve・choose の turrets）。次のフレームで render に渡す
  let saveCount = 0, saveBlocked = false, saveSince = 0, saveFailTold = false;
  let best = 0;
  let hintTimer = 0, cardUnlockTimer = 0, cardShownAt = -Infinity, focusBack = null;
  let bossUntil = -1;          // ロジックの時計（state.t）でこの秒まで #bossBanner
  let suggestSlot = -1;        // はね返しのあとに光らせる行
  let phaseShown = "";
  let msUntil = -1, msStepT = -1, msBonus = 0;   // 区切りの帯（ロジックの時計）
  let nearTold = false, nearNow = false;         // 「バリアが ひかってる！」は 1 回の挑戦で 1 回だけ
  let swapSel = 0;             // 入れ替えのカードで選んでいる枠
  const stepTimes = [];        // 最近の step の ms（§21.5）

  const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  let calm = !!reduceMotion.matches;
  function applyCalm() {
    if (calm) body.dataset.calm = "1"; else delete body.dataset.calm;
    R_call("setCalm", calm);
  }

  // ===== 描画（render.js が無くても遊べる・テストできる） =====
  const R = window.AsteroidRender;
  const render = (R && typeof R.create === "function" && el.canvas
    ? safeCall(() => R.create(el.canvas, { calm, onAbsorb: () => sfx.play("absorb") }), null) : null) || stubRender();
  if (render.isStub) console.error("ほしくだき: AsteroidRender が読み込まれていません（render.js）。絵なしで動きます");
  function stubRender() {
    let frames = 0, c = calm;
    return {
      isStub: true, layout() {}, frame() { frames += 1; }, burst() {}, setCalm(b) { c = !!b; }, setNear() {}, pause() {}, resume() {},
      stats() { return { particles: 0, shots: 0, frames, slowFrames: 0, rockRedraws: 0, calm: c, cellPx: 0, view: null, turrets: [] }; }
    };
  }
  function R_call(name, ...a) { const f = render && render[name]; if (typeof f !== "function") return undefined; return safeCall(() => f.apply(render, a), undefined); }
  function onCalmChange() { calm = !!reduceMotion.matches; applyCalm(); }
  if (reduceMotion.addEventListener) reduceMotion.addEventListener("change", onCalmChange);
  else if (reduceMotion.addListener) reduceMotion.addListener(onCalmChange);
  applyCalm();

  // ===== 保存（§8） =====
  function saveNow() {
    if (!state || restarting || stale) return false;   // X-20：古いページは静かに抜ける（「ほぞんが できないよ」を出さない）
    saveSince = 0;
    if (saveBlocked) return false;
    const raw = safeCall(() => L.makeSave(state), null);
    if (typeof raw !== "string") return false;
    let text = raw;
    try {
      const o = JSON.parse(raw);
      o.t = Math.max(0, Math.floor(Number(state.t) || 0));
      if (state.phase === "end") o.ending = true;
      text = JSON.stringify(o);
    } catch (e) { text = raw; }
    const ok = writeKey(KEY_SAVE, text);
    if (ok) saveCount += 1;
    else tellSaveFail();
    return ok;
  }
  // 保存できないことを 1 回だけ知らせる（遊ぶのは止めない。T5）
  function tellSaveFail(delay) {
    if (saveFailTold) return;
    saveFailTold = true;
    later(() => setHint(HINT_BLOCKED, 5000), delay || 0);
  }
  function writeBest(n) {
    const cur = safeCall(() => L.validateBest(readKey(KEY_BEST)), 0) || 0;
    best = Math.max(cur, Math.floor(Number(n) || 0));
    if (best > cur) writeKey(KEY_BEST, String(best));
  }
  // 読めない・古い保存の元を bak へ写す（bak が既にあれば上書きしない＝最初の元を残す。§8.3・§8.4 ①）
  function keepBroken(raw) {
    if (raw === null || raw === undefined) return true;
    if (readKey(KEY_BAK) !== null) return true;
    return writeKey(KEY_BAK, String(raw));
  }
  // 保存の文字から main だけが読む欄（t・ending）
  function extraOf(raw) {
    try {
      const o = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!o || typeof o !== "object") return { t: 0, ending: false };
      const t = Number(o.t);
      return { t: Number.isFinite(t) && t >= 0 ? Math.min(t, 1e10) : 0, ending: o.ending === true };
    } catch (e) { return { t: 0, ending: false }; }
  }
  // state の時計を t に合わせる。いまの挑戦の始め（tryAt）も同じだけずらす
  function setClock(s, t) {
    const d = t - (Number(s.t) || 0);
    s.t = t;
    s.tryAt = (Number.isFinite(s.tryAt) ? s.tryAt : 0) + d;
    return s;
  }
  // logic の state を、保存と同じ検証に通して「その星の最初」にする（bench・swap も loadSave が直す）
  function normalize(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    let raw;
    try { raw = JSON.stringify(Object.assign({}, obj, { v: L.SAVE_VERSION || 2, rock: undefined, shots: undefined, burns: undefined, turrets: undefined })); } catch (e) { return null; }
    const s = safeCall(() => L.loadSave(raw), null);
    if (!s) return null;
    const t = Number(obj.t);
    if (Number.isFinite(t) && t >= 0) setClock(s, Math.min(t, 1e10));
    return s;
  }

  // ===== ヒント =====
  function setHint(text, ms) {
    if (!el.hint) return;
    const t = text || "";
    if (el.hint.textContent !== t) el.hint.textContent = t;
    cancel(hintTimer);
    hintTimer = 0;
    if (t) hintTimer = later(() => { hintTimer = 0; if (el.hint) el.hint.textContent = ""; }, ms || HINT_MS);
  }

  // ===== 小さな道具 =====
  function setText(node, text) { if (node && node.textContent !== text) node.textContent = text; }
  // 値が違うときだけ hidden を書く（毎フレーム書き直さない。T4）
  function setHidden(node, v) { if (node && node.hidden !== !!v) node.hidden = !!v; }
  function setAttr(node, name, val) {
    if (!node) return;
    if (val === null) { if (node.hasAttribute(name)) node.removeAttribute(name); }
    else if (node.getAttribute(name) !== val) node.setAttribute(name, val);
  }
  // animationend で外す（動きを減らす設定では animation が無いので、時間でも外す）
  function pulseClass(node, cls, ms) {
    if (!node) return;
    node.classList.remove(cls);
    if (calm) return;
    void node.offsetWidth;
    node.classList.add(cls);
    const off = () => { node.classList.remove(cls); node.removeEventListener("animationend", onEnd); };
    const onEnd = (e) => { if (e.target === node) off(); };
    node.addEventListener("animationend", onEnd);
    later(off, ms || 1200);
  }
  const fmt = (n) => safeCall(() => L.formatKakera(n), String(n));
  // 秒 → 「3ぷん12びょう」「45びょう」「1じかん5ふん」
  function fmtTime(sec) {
    const t = Math.max(1, Math.round(Number(sec) || 0));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), r = t % 60;
    if (h > 0) return h + "じかん" + m + "ふん";
    if (m > 0) return m + "ぷん" + r + "びょう";
    return r + "びょう";
  }
  const wName = (id) => (WEAPON[id] && WEAPON[id].name) || id;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const knownId = (id) => typeof id === "string" && !!WEAPON[id];
  function goodHtml(id) {
    const g = WEAPON[id] && WEAPON[id].good;
    if (!g) return "";
    const n = MAT_NAME[g] || g;
    return '<i class="mat" data-mat="' + esc(g) + '"></i><span class="gt">' + esc(n) + "に つよい</span>";
  }
  const benchOf = (s) => (s && Array.isArray(s.bench) ? s.bench : []);
  const swapOf = (s) => (s && Array.isArray(s.swap) ? s.swap : []);
  // 枠 k の入れ替えの予約（無ければ null）。lv は ひかえ で覚えている Lv
  function reservedFor(k) {
    const p = swapOf(state).find((x) => x && x.slot === k);
    if (!p || !knownId(p.id)) return null;
    const b = benchOf(state).find((x) => x && x.id === p.id);
    return { id: p.id, lv: b ? b.lv : 1 };
  }

  // ===== 進め方（§7.1） =====
  function phaseNow() {
    if (sleeping) return "paused";
    if (overlay === "help" || overlay === "restart" || overlay === "swap") return "paused";
    return state ? state.phase : "fly";
  }
  function syncPhase() {
    const p = phaseNow();
    if (p !== phaseShown) { phaseShown = p; body.dataset.phase = p; }
  }
  const running = () => !sleeping && !restarting && !stale && overlay === null;

  function stepOnce(dt, collect) {
    const a = now();
    const r = safeCall(() => L.step(state, dt), null);
    stepTimes.push(now() - a);
    if (stepTimes.length > STEP_MS_N) stepTimes.shift();
    if (!r || !r.state) return;
    state = r.state;
    const evs = Array.isArray(r.events) ? r.events : [];
    if (evs.length) {
      handleEvents(evs);
      if (collect) for (const e of evs) collect.push(e);
    }
    if (state.phase === "fly") saveSince += dt;
  }
  function stepMsNow() {
    if (!stepTimes.length) return 0;
    const s = stepTimes.slice().sort((x, y) => x - y);
    return Math.round(s[Math.floor(s.length / 2)] * 1000) / 1000;
  }
  function ensureLoop() {
    if (rafId || sleeping || restarting || stale || !state) return;
    rafId = requestAnimationFrame(frame);
  }
  function stopLoop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; lastT = null; acc = 0; }
  function frame(t) {
    rafId = 0;
    if (sleeping || !state) return;
    const dt = lastT === null ? 0 : Math.min(MAX_FRAME_SEC, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    const events = pendingEvents;
    pendingEvents = [];
    if (running()) {
      acc += dt;
      let n = 0;
      while (acc >= STEP - 1e-9 && n < MAX_STEPS_PER_FRAME) { stepOnce(STEP, events); acc -= STEP; n += 1; if (!running()) break; }
      if (n >= MAX_STEPS_PER_FRAME && acc >= STEP) acc = 0;   // 重い端末で早送りしない（足りない分は捨てる）
      if (!running()) acc = 0;
      if (saveSince >= SAVE_EVERY_SEC) saveNow();
    } else acc = 0;
    R_call("frame", state, events, dt);
    updateUi();
    // 地球が近い（残り 3 割以下）とき、1 回の挑戦で 1 回だけ、控えめに知らせる（Q7）。ほかのヒントが出ているときは出さない
    if (nearNow && !nearTold && running()) {
      nearTold = true;
      if (el.hint && !el.hint.textContent) setHint(HINT_NEAR, 2200);
    }
    ensureLoop();
  }

  // ===== 出来事（音・帯・保存） =====
  function handleEvents(evs) {
    let saveAfter = false, swapped = false;
    for (const e of evs) {
      if (!e) continue;
      switch (e.kind) {
        case "fire": sfx.play("shot", Math.max(0, W_IDS.indexOf(e.w))); break;
        case "hit": if ((e.crack | 0) >= 1) sfx.play("crack", e.crack | 0); break;
        case "break": sfx.play("break", e.mat); break;
        case "chunk": sfx.play("chunk", Array.isArray(e.cells) ? e.cells.length : 1); break;
        case "evolve": sfx.play("evolve"); break;
        case "clear": {
          sfx.play("clear");
          writeBest(e.star);
          const banner = el.clearBanner;
          setText(part(banner, "main"), "ほし " + (e.star | 0) + " クリア！");
          // 時間とベスト（初回「はじめて」・更新「ベスト！」・ふつうは前のベスト）、ちきゅうまでの残り（Q4）
          const hasTime = Number.isFinite(Number(e.time)) && Number(e.time) > 0;
          let tline = "";
          if (hasTime) {
            const prev = Number.isFinite(Number(e.best)) && e.best !== null ? Number(e.best) : null;
            tline = fmtTime(e.time) + "・" + (prev === null ? "はじめて" : Number(e.time) < prev ? "ベスト！" : "ベスト " + fmtTime(prev));
          }
          setText(part(banner, "time"), tline);
          const dist = Number(e.distance);
          let dline = "";
          if (Number.isFinite(dist)) { const n = Math.round(Math.max(0, Math.min(1, dist)) * 100); dline = n >= 1 ? "ちきゅうまで あと " + n + "%" : "ちきゅうの すぐ そばだった！"; }
          setText(part(banner, "dist"), dline);
          setText(part(banner, "sub"), (e.bonus | 0) > 0 ? "＋" + fmt(e.bonus) + "かけら" : "");
          const tb = part(banner, "time");
          if (tb) tb.classList.toggle("best", hasTime && tline.indexOf("ベスト！") >= 0 || tline.indexOf("はじめて") >= 0);
          msUntil = -1;
          suggestSlot = -1;
          saveAfter = true;
          break;
        }
        case "bounce": {
          sfx.play("bounce");
          const broken = Number(e.broken) || 0;
          const leftPct = Math.max(1, Math.round((1 - broken) * 100));
          setText(part(el.bounceBanner, "main"), "バリアで はねかえした！");
          // 50% を超えて残っていたら、数字より先にすることを言う（U4）
          setText(part(el.bounceBanner, "sub"), leftPct > 50 ? "もう すこし つよく しよう" : "あと " + leftPct + "% だった");
          suggestSlot = cheapestSlot();
          const sg = suggestSlot >= 0 && state && state.slots[suggestSlot] ? wName(state.slots[suggestSlot].id) : "";
          if (!silent) setHint(sg ? sg + HINT_RETRY_END : HINT_RETRY, 4000);
          nearTold = false;
          saveAfter = true;
          break;
        }
        case "swap": {
          // 予約が当たって武器が替わった（次の星の始め・はね返しのやり直しの始め）。絵は render が events から出す
          if (!swapped) sfx.play("swap");
          swapped = true;
          const k = e.slot | 0;
          if (rows[k]) pulseClass(rows[k].row, "flash", 900);
          if (!silent) setHint(wName(e.to) + "に いれかえたよ", 2200);
          if (suggestSlot === k) suggestSlot = -1;
          saveAfter = true;
          break;
        }
        case "milestone": {
          // 25・50・75% の区切り：短い帯と小さな音（既存の up を流用）。1 step に複数なら、おまけは足して最後の帯を出す
          const t = Number(state && state.t) || 0;
          msBonus = (msStepT === t ? msBonus : 0) + (e.bonus | 0);
          msStepT = t;
          setText(part(el.msBanner, "main"), MS_TEXT[e.pct] || "こわした！");
          setText(part(el.msBanner, "sub"), msBonus > 0 ? "＋" + fmt(msBonus) + " かけら" : "");
          msUntil = t + MS_BANNER_SEC;
          bossUntil = -1;
          sfx.play("up");
          break;
        }
        case "boss": sfx.play("boss"); bossUntil = (Number(state && state.t) || 0) + BOSS_BANNER_SEC; break;
        case "ending": sfx.play("best"); saveAfter = true; openCard("end"); break;
        default: break;
      }
    }
    if (saveAfter) saveNow();
  }
  // いま一番安く強くできる武器の行（はね返しのあとに光らせる）
  function cheapestSlot() {
    if (!state) return -1;
    let bestK = -1, bc = Infinity;
    for (let k = 0; k < state.slots.length; k++) {
      const c = safeCall(() => L.upCostOf(state, k), null);
      if (typeof c === "number" && c < bc) { bc = c; bestK = k; }
    }
    return bestK;
  }

  // ===== 画面（数はロジックの関数の値そのまま。§13-1） =====
  const lastUi = {};
  function updateUi() {
    if (!state) return;
    syncPhase();
    const s = state;
    setText(el.kakera, fmt(s.kakera));
    // 星
    const info = safeCall(() => L.starInfo(s.star), null) || { tag: "", boss: false };
    setText(part(el.starLabel, "num"), "ほし " + s.star);
    setText(el.starTag, info.tag || "");
    setAttr(el.starLabel, "data-boss", info.boss ? "1" : null);
    const pr = safeCall(() => L.progressOf(s), null) || { broken: 0, distance: 1 };
    const pct = Math.max(0, Math.min(100, Math.floor(pr.broken * 100)));
    if (lastUi.pct !== pct) {
      lastUi.pct = pct;
      setAttr(el.starBar, "aria-valuenow", String(pct));
      if (el.starFill) el.starFill.style.width = pct + "%";
      setText(barPct, pct + "%");
    }
    const near = Math.max(0, Math.min(100, Math.round((1 - pr.distance) * 100)));
    nearNow = s.phase === "fly" && pr.distance <= NEAR_AT;
    if (lastUi.near !== near || lastUi.nearFlag !== nearNow) {
      lastUi.near = near;
      lastUi.nearFlag = nearNow;
      setAttr(el.distance, "aria-valuenow", String(near));
      if (el.distanceFill) el.distanceFill.style.height = near + "%";
      setAttr(el.distance, "data-near", nearNow ? "1" : null);
      R_call("setNear", nearNow);
    }
    if (!nearNow && (s.phase !== "fly" || pr.distance > NEAR_AT + 0.12)) nearTold = false;
    // 帯（ロジックの phase と時計で出す＝advance でも止まっていても正しい）
    setHidden(el.bounceBanner, s.phase !== "bounce");
    setHidden(el.clearBanner, s.phase !== "clear");
    setHidden(el.bossBanner, !(s.phase === "fly" && s.t < bossUntil));
    setHidden(el.msBanner, !(s.phase === "fly" && s.t < msUntil));
    // 武器の行（上から＝砲台の左から）
    for (let k = 0; k < rows.length; k++) updateRow(k);
    // あたらしい ぶき（4 台のあとは ひかえへ。6 種類そろったら消える）
    const sc = safeCall(() => L.slotCostOf(s), null);
    if (el.unlockBtn) {
      setHidden(el.unlockBtn, sc === null);
      if (sc !== null) {
        const toBench = s.slots.length >= SLOTS_MAX;
        setHidden(part(el.unlockBtn, "to"), !toBench);
        setAttr(el.unlockBtn, "data-bench", toBench ? "1" : null);
        setText(part(el.unlockBtn, "cost"), fmt(sc));
        const can = s.kakera >= sc && s.phase !== "choose";
        setAttr(el.unlockBtn, "aria-disabled", can ? null : "true");
        setAttr(el.unlockBtn, "aria-label", (toBench ? "あたらしい ぶき（ひかえへ） " : "あたらしい ぶき ") + fmt(sc) + "かけら" + (s.kakera >= sc ? "" : "（かけらが たりないよ）"));
      }
    }
    // いれかえ（ひかえの数）
    if (el.swapBtn) {
      const nb = benchOf(s).length;
      setText(el.benchCount, nb > 0 ? "ひかえ " + nb : "ひかえ なし");
      setAttr(el.swapBtn, "aria-disabled", nb > 0 ? null : "true");
      setAttr(el.swapBtn, "aria-label", "いれかえ（" + (nb > 0 ? "ひかえ " + nb : "ひかえ なし") + "）");
      setAttr(el.swapBtn, "data-wide", sc === null ? "1" : null);
    }
  }
  // 予約の札が行（.wl2）の幅からはみ出すか（はみ出すなら短い「つぎから」にする）
  function nextOverflows(e) {
    try {
      const box = e.parentElement || e;
      return e.scrollWidth > e.clientWidth + 0.5 || box.scrollWidth > box.clientWidth + 0.5;
    } catch (err) { return false; }
  }
  function updateRow(k) {
    const r = rows[k];
    if (!r.row) return;
    const x = state.slots[k];
    setHidden(r.row, !x);
    if (!x) { setAttr(r.row, "data-suggest", null); setAttr(r.row, "data-fit", null); setAttr(r.row, "data-has-next", null); r.prevCan = undefined; return; }
    setAttr(r.row, "data-w", x.id);
    // いまの星の札（一番多い いわ 以外のマス）が得意な武器に ◎（U6）
    const main = starMain();
    const fit = !!main && !!WEAPON[x.id] && WEAPON[x.id].good === main;
    setAttr(r.row, "data-fit", fit ? "1" : null);
    setText(r.name, wName(x.id));
    setText(r.lv, "Lv" + x.lv);
    const dps = safeCall(() => L.dpsOf(state, k), null);
    setText(r.dps, "1びょうに " + (dps === null ? "-" : dps));
    const gh = goodHtml(x.id);
    if (r.good && r.good.innerHTML !== gh) r.good.innerHTML = gh;
    // 入れ替えの予約「つぎの ほしから いなずま Lv12」（§5.2）。行の幅に入らないときだけ「つぎから」（UX 1。画面の大きさが変わったら測り直す）
    const nx = reservedFor(k);
    const nkey = nx ? nx.id + ":" + nx.lv : "";
    setAttr(r.row, "data-has-next", nx ? "1" : null);
    if (r.next && r.nextShown !== nkey) {
      r.nextShown = nkey;
      const head = nx ? '<i class="wicon mini" data-w="' + esc(nx.id) + '" aria-hidden="true"></i>' : "";
      const tail = nx ? esc(wName(nx.id)) + " Lv" + nx.lv : "";
      r.next.innerHTML = nx ? head + NEXT_LONG + " " + tail : "";
      r.next.hidden = !nx;
      if (nx && nextOverflows(r.next)) r.next.innerHTML = head + NEXT_SHORT + " " + tail;
    }
    let note = "";
    if (x.lv < EVOLVE_LAST) {
      const next = (Math.floor(x.lv / EVOLVE_EVERY) + 1) * EVOLVE_EVERY;
      if (next - x.lv <= EVOLVE_NOTE) note = "しんか まで あと " + (next - x.lv);
    }
    setText(r.note, note);
    setHidden(r.note, !note);
    const cost = safeCall(() => L.upCostOf(state, k), null);
    const nxLabel = nx ? "（" + NEXT_LONG + " " + wName(nx.id) + " Lv" + nx.lv + "）" : "";
    if (cost === null) {
      setAttr(r.btn, "data-max", "1");
      setAttr(r.btn, "aria-disabled", "true");
      setText(r.label, "さいだい");
      setText(r.cost, "");
      setAttr(r.btn, "aria-label", wName(x.id) + "は さいだい" + (fit ? "（いまの ほしに とくい）" : "") + nxLabel);
      r.prevCan = undefined;
    } else {
      setAttr(r.btn, "data-max", null);
      const can = state.kakera >= cost;
      setAttr(r.btn, "aria-disabled", can ? null : "true");
      // 買えない間は「あと 3,234」と、所持／値段の割合の塗り（U5）。値段は下の段に小さな「かけら」つきで（U8）
      const lack = Math.max(0, cost - state.kakera);
      setText(r.label, can ? "つよくする" : "あと " + fmt(lack));
      setText(r.cost, fmt(cost));
      const fill = can ? "1" : String(Math.round(Math.max(0, Math.min(1, state.kakera / cost)) * 50) / 50);
      if (r.fillShown !== fill) { r.fillShown = fill; if (r.btn) r.btn.style.setProperty("--fill", fill); }
      // 買えないところから買えるようになった瞬間に、短い光（音は無し。動きを減らす設定では出さない）
      if (r.prevCan === false && can) pulseClass(r.btn, "ready", READY_MS);
      r.prevCan = can;
      setAttr(r.btn, "aria-label", wName(x.id) + "を つよくする " + fmt(cost) + "かけら" + (can ? "" : "（あと " + fmt(lack) + " かけら）") + (fit ? "（いまの ほしに とくい）" : "") + nxLabel);
    }
    setAttr(r.row, "data-suggest", k === suggestSlot ? "1" : null);
  }

  // いまの星の札のマス（'iron'・'ice'・いわ だけなら null）
  function starMain() {
    if (!state) return null;
    const info = safeCall(() => L.starInfo(state.star), null);
    return info && typeof info.main === "string" ? info.main : null;
  }
  // 買った行の「＋12%」（その行の dpsOf の前後差の割合。0.8 秒）
  function showPlus(k, before, after) {
    const r = rows[k];
    if (!r || !r.plus || !(typeof before === "number" && typeof after === "number" && before > 0 && after > before)) return;
    const pct = Math.max(1, Math.min(999, Math.round(((after - before) / before) * 100)));
    r.plus.textContent = "＋" + pct + "%";
    r.plus.classList.remove("show");
    void r.plus.offsetWidth;
    r.plus.classList.add("show");
    cancel(r.plusTimer);
    r.plusTimer = later(() => { r.plusTimer = 0; r.plus.classList.remove("show"); r.plus.textContent = ""; }, PLUS_MS);
  }
  // 買った行の絵から、その武器の砲台へ飛ぶ小さな光（動きを減らす設定では出さない。押せない）。
  // 砲台の位置は見た目の位置（stats().turrets[k]。並び直しで滑っている間も絵に合う）、無ければ state.turrets[k]
  function zapToTurret(k) {
    if (calm || !state || !window.Element || !Element.prototype.animate) return;
    const r = rows[k], icon = r && r.row && r.row.querySelector(".wicon");
    const st = safeCall(() => render.stats(), null);
    const v = st && st.view;
    const tvis = st && Array.isArray(st.turrets) ? st.turrets[k] : null;
    const tlog = Array.isArray(state.turrets) ? state.turrets[k] : null;
    const T = tvis && Number.isFinite(tvis.x) ? tvis : tlog;
    if (!icon || !v || !T || !el.field || !(v.zoom > 0)) return;
    const a = icon.getBoundingClientRect(), f = el.field.getBoundingClientRect();
    const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2;
    const x1 = f.left + (Number(T.x) - v.left) * v.zoom, y1 = f.top + (Number(T.y) - v.top) * v.zoom;
    if (![x0, y0, x1, y1].every(Number.isFinite)) return;
    const z = document.createElement("div");
    z.className = "zap";
    z.setAttribute("aria-hidden", "true");
    document.body.appendChild(z);
    const done = () => { if (z.parentNode) z.parentNode.removeChild(z); };
    try {
      const an = z.animate([
        { transform: "translate(" + x0 + "px," + y0 + "px) scale(1)", opacity: 1 },
        { transform: "translate(" + x1 + "px," + y1 + "px) scale(0.5)", opacity: 0.35 }
      ], { duration: 320, easing: "ease-in" });
      an.onfinish = done;
      later(done, 700);
    } catch (e) { done(); }
  }

  // ===== 操作（§7.2） =====
  function doUpgrade(slot, btn) {
    if (!state || overlay) return { ok: false, reason: "card" };
    const k = Math.floor(Number(slot));
    if (!(k >= 0 && k < state.slots.length)) return { ok: false, reason: "slot" };
    const dpsBefore = safeCall(() => L.dpsOf(state, k), null);
    const r = safeCall(() => L.upgrade(state, k), null);
    if (!r) return { ok: false, reason: "error" };
    if (r.ok) {
      state = r.state;
      showPlus(k, dpsBefore, safeCall(() => L.dpsOf(state, k), null));
      zapToTurret(k);
      const evs = Array.isArray(r.events) ? r.events : [];
      const evolved = evs.some((e) => e && e.kind === "evolve");
      for (const e of evs) pendingEvents.push(e);   // しんかの文字は render が events から出す
      if (evolved) { R_call("burst", "evolve", k); sfx.play("evolve"); pulseClass(rows[k].row, "evolve", 1400); }
      else { R_call("burst", "up", k); sfx.play("up"); pulseClass(rows[k].row, "flash", 900); }
      suggestSlot = -1;
      saveNow();
      updateUi();
      return { ok: true, lv: state.slots[k].lv, evolve: evolved };
    }
    if (r.reason === "money") {
      sfx.play("deny");
      const cost = safeCall(() => L.upCostOf(state, k), 0) || 0;
      setHint("かけらが たりないよ（あと " + fmt(Math.max(0, cost - state.kakera)) + "）");
      pulseClass(btn || rows[k].btn, "shake", 600);
    } else if (r.reason === "max") setHint(wName(state.slots[k].id) + "は もう さいだいだよ");
    return { ok: false, reason: r.reason };
  }
  function doUnlock() {
    if (!state || overlay) return { ok: false, reason: "card" };
    const r = safeCall(() => L.unlock(state), null);
    if (!r) return { ok: false, reason: "error" };
    if (r.ok) {
      state = r.state;
      sfx.play("unlock");
      R_call("burst", "unlock");
      saveNow();
      openCard("choose");
      updateUi();
      return { ok: true, offer: state.offer ? state.offer.slice() : null };
    }
    if (r.reason === "money") {
      sfx.play("deny");
      const c = safeCall(() => L.slotCostOf(state), 0) || 0;
      setHint("あたらしい ぶきには あと " + fmt(Math.max(0, c - state.kakera)) + " かけら");
      pulseClass(el.unlockBtn, "shake", 600);
    } else if (r.reason === "choose" && state.phase === "choose") openCard("choose");
    return { ok: false, reason: r.reason };
  }
  function doChoose(k, viaUi) {
    if (!state || state.phase !== "choose") return { ok: false, reason: "phase" };
    if (viaUi && (overlay !== "choose" || cardLocked())) return { ok: false, reason: "lock" };
    const offer = Array.isArray(state.offer) ? state.offer : [];
    if (!(k >= 0 && k < offer.length)) return { ok: false, reason: "choose" };
    const id = offer[k];
    const r = safeCall(() => L.choose(state, k), null);
    if (!r || !r.ok) return { ok: false, reason: "choose" };
    state = r.state;
    for (const e of Array.isArray(r.events) ? r.events : []) pendingEvents.push(e);   // 砲台が増えた（turrets）→ render が滑らせる
    closeCard("choose");
    sfx.play("unlock");
    const toBench = r.to === "bench";
    const slot = toBench ? -1 : state.slots.length - 1;
    R_call("burst", "unlock", slot >= 0 ? slot : undefined);
    if (slot >= 0) pulseClass(rows[slot] && rows[slot].row, "flash", 900);
    else pulseClass(el.swapBtn, "flash", 900);
    setHint(toBench ? wName(id) + "が ひかえ（おやすみ中の ぶき）に はいったよ。「いれかえ」で つかえるよ" : wName(id) + "が なかまに なった！", toBench ? 4000 : HINT_MS);
    saveNow();
    updateUi();
    return { ok: true, id, slot, to: r.to };
  }

  // ===== 入れ替え（§3.6・§5.3） =====
  function openSwap() {
    if (!state || overlay) return { ok: false, reason: "card" };
    if (!benchOf(state).length) { setHint(HINT_NO_BENCH); pulseClass(el.swapBtn, "shake", 600); return { ok: false, reason: "bench" }; }
    swapSel = 0;
    openCard("swap");
    return { ok: true };
  }
  function closeSwap() {
    if (overlay !== "swap" || cardLocked()) return;
    closeCard("swap");
  }
  function selectSwapSlot(k) {
    if (overlay !== "swap" || cardLocked() || !state) return;
    if (!(k >= 0 && k < state.slots.length) || k === swapSel) return;
    swapSel = k;
    fillSwap();
    const b = slotBtns[k];
    if (b && document.activeElement !== b) { try { b.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
  }
  // 予約（今の武器を選ぶと取り消し）。カード・テスト用 API の両方がこの道を通る（行の札と保存も同じ）
  function doReserve(slot, id) {
    if (!state) return { ok: false, reason: "state" };
    const k = Math.floor(Number(slot));
    const had = reservedFor(k);
    const r = safeCall(() => L.reserveSwap(state, k, id), null);
    if (!r) return { ok: false, reason: "error" };
    if (!r.ok) return { ok: false, reason: r.reason };
    state = r.state;
    const now2 = reservedFor(k);
    const cancelled = !now2;
    if (cancelled) { if (had) sfx.play("toggle"); }
    else { sfx.play("swap"); R_call("burst", "swap", k); }
    if (rows[k] && (had || now2)) pulseClass(rows[k].row, "flash", 900);
    saveNow();
    updateUi();
    if (overlay === "swap") fillSwap();
    return { ok: true, slot: k, id: now2 ? now2.id : null };
  }
  function iconHtml(id, cls) { return '<i class="wicon' + (cls ? " " + cls : "") + '" data-w="' + esc(id) + '" aria-hidden="true"></i>'; }
  function fillSwap() {
    if (!state) return;
    const n = state.slots.length;
    if (!(swapSel >= 0 && swapSel < n)) swapSel = 0;
    slotBtns.forEach((b, k) => {
      if (!b) return;
      const x = state.slots[k];
      setHidden(b, !x);
      if (!x) return;
      const nx = reservedFor(k);
      const key = x.id + ":" + x.lv + ":" + (nx ? nx.id : "");
      if (b.dataset.key !== key) {
        b.dataset.key = key;
        b.innerHTML = iconHtml(x.id) + '<span class="sname">' + esc(wName(x.id)) + "</span>" + (nx ? iconHtml(nx.id, "nx") : "");
      }
      setAttr(b, "aria-pressed", k === swapSel ? "true" : "false");
      setAttr(b, "aria-label", (k + 1) + "ばんめの ほうだい " + wName(x.id) + " Lv" + x.lv + (nx ? "（" + NEXT_LONG + " " + wName(nx.id) + "）" : ""));
    });
    const list = safeCall(() => L.swapChoicesOf(state, swapSel), null) || [];
    const cur = state.slots[swapSel];
    const nx = reservedFor(swapSel);
    const pick = nx ? nx.id : cur ? cur.id : null;
    let html = "";
    for (const id of list) {
      if (!knownId(id)) continue;
      const isCur = cur && id === cur.id;
      const b = benchOf(state).find((x) => x && x.id === id);
      const lv = isCur ? cur.lv : b ? b.lv : 1;
      const w = WEAPON[id] || {};
      const fit = !!w.good && w.good === starMain();
      const tag = isCur ? "このまま" : id === pick ? NEXT_LONG : "";
      const label = wName(id) + " Lv" + lv + (w.good ? "。" + (MAT_NAME[w.good] || w.good) + "に つよい" : "") + (isCur ? "。このまま" : "") + (id === pick && !isCur ? "。よやく ずみ" : "");
      html += '<button type="button" class="bench" data-swap-to="' + esc(id) + '" aria-pressed="' + (id === pick ? "true" : "false") + '" aria-label="' + esc(label) + '">' +
        iconHtml(id) + '<span class="bname">' + esc(wName(id)) + ' <span class="lv">Lv' + lv + "</span>" + (fit ? '<span class="fit" aria-hidden="true">◎</span>' : "") + "</span>" +
        '<span class="good">' + goodHtml(id) + "</span>" + (tag ? '<span class="btag">' + tag + "</span>" : "") + "</button>";
    }
    if (list.length <= 1) html += '<p class="bench-empty">ひかえの ぶきは ほかの ほうだいで よやく ずみだよ</p>';
    if (el.benchList && el.benchList.dataset.html !== html) {
      const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.swapTo : null;
      el.benchList.innerHTML = html;
      el.benchList.dataset.html = html;
      if (cardLocked()) el.benchList.querySelectorAll("button").forEach((b) => { b.setAttribute("aria-disabled", "true"); b.dataset.cardLock = "1"; });
      if (focusedId) { const f = el.benchList.querySelector('[data-swap-to="' + focusedId + '"]'); if (f) try { f.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
    }
  }
  function moveBenchFocus(d) {
    if (!el.benchList) return;
    const bs = Array.from(el.benchList.querySelectorAll("[data-swap-to]"));
    if (!bs.length) return;
    const i = bs.indexOf(document.activeElement);
    const j = i < 0 ? (d > 0 ? 0 : bs.length - 1) : (i + d + bs.length) % bs.length;
    try { bs[j].focus({ preventScroll: true }); } catch (e) { /* 無視 */ }
  }

  // ===== カード（§5.3。出た直後 400ms は押せない） =====
  const CARDS = {
    help: { box: () => el.help, primary: () => el.helpOk },
    restart: { box: () => el.restartCard, primary: () => el.restartNo },
    // 2択は見出しにフォーカス（選ぶ前の枠が金の輪で「選び済み」に見えないように U14。Tab で A・B へ進める）
    choose: { box: () => el.choiceCard, primary: () => $("choiceTitle") },
    swap: { box: () => el.swapCard, primary: () => el.swapTitle },
    end: { box: () => el.endCard, primary: () => el.endOk }
  };
  function fillCard(kind) {
    if (kind === "choose" && state && state.offer) {
      const offer = state.offer;
      const one = offer.length === 1;
      [el.choiceA, el.choiceB].forEach((btn, k) => {
        if (!btn) return;
        const id = offer[k];
        setHidden(btn, !knownId(id));
        if (!knownId(id)) return;
        const w = WEAPON[id] || {};
        btn.dataset.w = id;
        setText(part(btn, "name"), wName(id));
        setText(part(btn, "desc"), w.desc || "");
        const g = part(btn, "good");
        const fit = !!w.good && w.good === starMain();
        const gh = (fit ? '<span class="fit" aria-hidden="true">◎</span>' : "") + goodHtml(id);
        if (g) { if (g.innerHTML !== gh) g.innerHTML = gh; g.hidden = !goodHtml(id); }
        btn.setAttribute("data-fit", fit ? "1" : "0");
        btn.setAttribute("aria-label", wName(id) + "。" + (w.desc || "") + (w.good ? "。" + (MAT_NAME[w.good] || w.good) + "に つよい" : "") + (fit ? "。いまの ほしに ぴったり" : ""));
      });
      setText($("choiceTitle"), one ? "さいごの 1つ！" : "どっちに する？");
      // 冒頭の案内：4 台のあとは ひかえへ・この星に多いマス／まだ出ないなら、いつから出るか（U6）
      if (el.choiceLead) {
        const parts = [];
        if (state.slots.length >= SLOTS_MAX) parts.push("えらんだ ぶきは ひかえ（いま つかわない ぶき）に はいるよ");
        const main = starMain();
        if (main) parts.push("この ほしは " + (MAT_NAME[main] || main) + "が おおいよ");
        else if (Array.isArray(L.MATS)) {
          const nx = L.MATS.filter((m) => (m.id === "iron" || m.id === "ice") && m.from > state.star).sort((a, b) => a.from - b.from)[0];
          if (nx) parts.push((nx.from === state.star + 1 ? "つぎの ほしから " : "ほし " + nx.from + " から ") + nx.name + "が でてくるよ");
        }
        const lead = parts.join("。");
        setText(el.choiceLead, lead);
        el.choiceLead.hidden = !lead;
      }
      setText(el.choiceNote, one ? "これで 6しゅるい ぜんぶ そろうよ" : "てにいれた ぶきは「いれかえ」で つかいわけ できるよ");
    } else if (kind === "swap") {
      fillSwap();
    } else if (kind === "end" && state) {
      const sec = Math.max(0, Math.floor(Number(state.t) || 0));
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
      const time = h > 0 ? h + "じかん " + m + "ふん" : Math.max(1, m) + "ふん";
      const total = state.totals || {};
      setText(el.endText, (L.ENDING_STAR || 30) + "この ほしを くだいて、ちきゅうを まもったよ！");
      setText(el.endStats, "あそんだ じかん " + time + "・こわした マス " + fmt(total.cells || 0) + "こ");
    }
  }
  function openCard(kind) {
    const c = CARDS[kind];
    if (!c) return;
    if (overlay === kind) { fillCard(kind); return; }
    if (overlay) {
      // 遊び方の上には重ねない（閉じたら出す）。それ以外は後から来たほうを優先しない
      if (overlay === "help") queued = kind;
      return;
    }
    const box = c.box();
    if (!box) return;
    fillCard(kind);
    focusBack = document.activeElement;
    box.hidden = false;
    overlay = kind;
    setBackInert(true);
    cardShownAt = now();
    lockCardButtons(box);
    const p = c.primary();
    if (p) { try { p.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
    syncPhase();
  }
  let queued = null;
  function closeCard(kind) {
    if (overlay !== kind) return;
    const box = CARDS[kind].box();
    if (box) box.hidden = true;
    overlay = null;
    setBackInert(false);
    unlockCardButtons();
    lastT = null; acc = 0;
    if (focusBack && document.contains(focusBack) && focusBack !== document.body) { try { focusBack.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
    focusBack = null;
    const q = queued;
    queued = null;
    if (q) openCard(q);
    else if (state && state.phase === "choose") openCard("choose");
    else if (state && state.phase === "end") openCard("end");
    syncPhase();
  }
  // カードの間は裏（？・♪・場・武器の行・下のボタン）に Tab で移れないようにする。a#back だけは例外でいつでも押せる（T7）
  const BACK_PARTS = [el.helpBtn, el.soundBtn, el.field, el.weapons, $("btnrow"), document.querySelector(".info"), document.querySelector(".barrow")];
  function setBackInert(on) {
    for (const n of BACK_PARTS) {
      if (!n) continue;
      if (on) { if (!n.hasAttribute("inert")) n.setAttribute("inert", ""); }
      else if (n.hasAttribute("inert")) n.removeAttribute("inert");
    }
  }
  function lockCardButtons(box) {
    box.querySelectorAll("button").forEach((b) => { b.setAttribute("aria-disabled", "true"); b.dataset.cardLock = "1"; });
    cancel(cardUnlockTimer);
    cardUnlockTimer = later(unlockCardButtons, CARD_LOCK_MS);
  }
  function unlockCardButtons() {
    cancel(cardUnlockTimer);
    cardUnlockTimer = 0;
    document.querySelectorAll("[data-card-lock]").forEach((b) => { b.removeAttribute("aria-disabled"); delete b.dataset.cardLock; });
  }
  const cardLocked = () => now() - cardShownAt < CARD_LOCK_MS;

  function showHelp() {
    if (overlay === "help") return;
    if (overlay) { queued = null; return; }   // 2択・入れ替え・エンディングの上には出さない（? は隠れている）
    openCard("help");
  }
  function closeHelp() {
    if (overlay !== "help" || cardLocked()) return;
    writeKey(KEY_HELP, "1");
    if (el.helpMig) el.helpMig.hidden = true;
    closeCard("help");
  }
  // ===== さいしょから（§19） =====
  // カードを入れ替える（閉じたあとの 2択・エンディングの出し直しをしない。もどり先のフォーカスは最初のカードのまま）
  function replaceCard(from, to) {
    if (overlay !== from) return;
    const box = CARDS[from].box();
    if (box) box.hidden = true;
    const fb = focusBack;
    overlay = null;
    unlockCardButtons();
    openCard(to);
    focusBack = fb;
  }
  function askRestart() {
    if (overlay !== "help" || cardLocked() || !el.restartCard) return;
    replaceCard("help", "restart");
  }
  function cancelRestart() {
    if (overlay !== "restart" || cardLocked()) return;
    replaceCard("restart", "help");
  }
  function doRestart() {
    if (overlay !== "restart" || cardLocked() || restarting) return;
    // 止める → 消す → 消えたか確かめる → 読み直す。止めるのが先（消したあとの pagehide・visibilitychange・自動保存で古い状態を書き戻さない）
    restarting = true;
    const goneSave = removeKey(KEY_SAVE), goneBak = removeKey(KEY_BAK);   // 片方が消せなくても、もう片方は消してみる
    if (!goneSave || !goneBak) {
      // 消せない（§19.2 R6。もくもくこうばと同じ）：止めたのを戻し、古い状態のまま続ける。カードを閉じて必ず知らせる
      console.error("ほしくだき: さいしょから で保存を消せませんでした");
      restarting = false;
      closeCard("restart");
      setHint(HINT_RESET_FAIL, 5000);
      ensureLoop();
      return;
    }
    stopLoop();
    clearLater();
    try { location.reload(); return; } catch (e) { console.error("ほしくだき: 読み直せない", e); }
    // 消せたが読み直せない：この場で新しく始める（保存は消えているので新しい状態を書いてよい）
    const s = safeCall(() => L.newGame((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0), null) || safeCall(() => L.newGame(1), null);
    restarting = false;
    if (!s) { console.error("ほしくだき: newGame が動きません"); return; }
    closeCardForce();
    bossUntil = -1; pendingEvents = [];
    applyState(s);
    sfx.play("start");
    syncPhase();
    ensureLoop();
  }
  function endOk() {
    if (overlay !== "end" || cardLocked()) return;
    // 「このまま あそぶ」：星 31 の最初から（logic の説明どおり loadSave(makeSave(state))）
    const t = state.t;
    const s = safeCall(() => L.loadSave(L.makeSave(state)), null);
    if (s) state = setClock(s, t);
    closeCard("end");
    sfx.play("start");
    setHint("ほし " + state.star + " から つづけるよ");
    saveNow();
    updateUi();
  }

  // ===== 入力の登録（場には付けない） =====
  rows.forEach((r, k) => { if (r.btn) r.btn.addEventListener("click", () => { sfx.unlock(); doUpgrade(k, r.btn); }); });
  if (el.unlockBtn) el.unlockBtn.addEventListener("click", () => { sfx.unlock(); doUnlock(); });
  if (el.swapBtn) el.swapBtn.addEventListener("click", () => { sfx.unlock(); openSwap(); });
  if (el.choiceA) el.choiceA.addEventListener("click", () => doChoose(0, true));
  if (el.choiceB) el.choiceB.addEventListener("click", () => doChoose(1, true));
  slotBtns.forEach((b, k) => { if (b) b.addEventListener("click", () => selectSwapSlot(k)); });
  if (el.benchList) el.benchList.addEventListener("click", (e) => {
    const b = e.target && e.target.closest ? e.target.closest("[data-swap-to]") : null;
    if (!b || overlay !== "swap" || cardLocked()) return;
    doReserve(swapSel, b.dataset.swapTo);
  });
  if (el.swapDone) el.swapDone.addEventListener("click", closeSwap);
  if (el.helpBtn) el.helpBtn.addEventListener("click", () => { sfx.unlock(); showHelp(); });
  if (el.helpOk) el.helpOk.addEventListener("click", closeHelp);
  if (el.helpRestart) el.helpRestart.addEventListener("click", askRestart);
  if (el.restartNo) el.restartNo.addEventListener("click", cancelRestart);
  if (el.restartYes) el.restartYes.addEventListener("click", doRestart);
  if (el.endOk) el.endOk.addEventListener("click", endOk);
  if (el.soundBtn) el.soundBtn.addEventListener("click", toggleSound);
  if (el.back) el.back.addEventListener("click", () => { saveNow(); clearLater(); });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const key = e.key;
    if (overlay === "choose") {
      const n = state && Array.isArray(state.offer) ? state.offer.length : 0;
      if (key === "ArrowLeft" || key === "a" || key === "A") { e.preventDefault(); doChoose(0, true); }
      else if ((key === "ArrowRight" || key === "b" || key === "B") && n >= 2) { e.preventDefault(); doChoose(1, true); }
      return;
    }
    if (overlay === "swap") {
      if (key === "Escape" || key === "s" || key === "S") { e.preventDefault(); closeSwap(); }
      else if (key >= "1" && key <= "4") { e.preventDefault(); selectSwapSlot(Number(key) - 1); }
      else if (key === "ArrowLeft" || key === "ArrowUp") { e.preventDefault(); moveBenchFocus(-1); }
      else if (key === "ArrowRight" || key === "ArrowDown") { e.preventDefault(); moveBenchFocus(1); }
      return;
    }
    if (overlay === "help") { if (key === "Escape" || key === "?") { e.preventDefault(); closeHelp(); } return; }
    if (overlay === "restart") { if (key === "Escape") { e.preventDefault(); cancelRestart(); } return; }
    if (overlay) return;
    if (key >= "1" && key <= "4") { e.preventDefault(); const k = Number(key) - 1; doUpgrade(k, rows[k] && rows[k].btn); }
    else if (key === "u" || key === "U") { e.preventDefault(); doUnlock(); }
    else if (key === "s" || key === "S") { e.preventDefault(); openSwap(); }
    else if (key === "?") { e.preventDefault(); showHelp(); }
    else if (key === "m" || key === "M") { e.preventDefault(); toggleSound(); }
  });

  // ===== 中断と再開（ユーザー決定「止まる」） =====
  function sleep() {
    if (sleeping) return;
    staleOnHide();                         // 保存がほかで変わっていたら stale にして、下の saveNow は書かない（X-20）
    if (state) saveNow();
    sleeping = true;
    stopLoop();
    R_call("pause");
    syncPhase();
  }
  function wake() {
    if (!sleeping || document.hidden) return;
    sleeping = false;
    restoreTimers();
    R_call("resume");
    lastT = null; acc = 0;
    syncPhase();
    ensureLoop();
  }
  // pagehide の clearLater で消えた続きを戻す
  function restoreTimers() {
    if (hintTimer === 0 && el.hint && el.hint.textContent) el.hint.textContent = "";
    if (overlay && !cardUnlockTimer) {
      const left = CARD_LOCK_MS - (now() - cardShownAt);
      if (left > 0) cardUnlockTimer = later(unlockCardButtons, left); else unlockCardButtons();
    }
    document.querySelectorAll(".shake, .wrow.flash, .wrow.evolve, .up.ready, #swapBtn.flash").forEach((b) => b.classList.remove("shake", "flash", "evolve", "ready"));
    document.querySelectorAll(".wrow .plus.show").forEach((b) => { b.classList.remove("show"); b.textContent = ""; });
    document.querySelectorAll(".zap").forEach((b) => b.remove());
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) sleep(); else if (!reloadIfStale()) wake(); });
  window.addEventListener("pagehide", () => { sleep(); clearLater(); });
  window.addEventListener("pageshow", (e) => { if (reloadIfStale()) return; if (e.persisted || sleeping) wake(); });

  // ===== テスト用の公開 API（§7.3） =====
  function snapshot() {
    const s = state || {};
    const st = safeCall(() => render.stats(), {}) || {};
    return {
      phase: phaseNow(), star: s.star | 0, kakera: Number(s.kakera) || 0,
      slots: Array.isArray(s.slots) ? s.slots.map((x) => ({ id: x.id, lv: x.lv })) : [],
      bench: benchOf(s).map((x) => ({ id: x.id, lv: x.lv })),
      offer: s.offer ? s.offer.slice() : null,
      swap: swapOf(s).map((p) => ({ slot: p.slot, id: p.id })),
      turrets: Array.isArray(s.turrets) ? s.turrets.map((T) => ({ x: T.x, y: T.y, ang: T.ang })) : [],
      progress: state ? safeCall(() => L.progressOf(state), null) : null,
      overlay, particles: st.particles | 0, shots: Array.isArray(s.shots) ? s.shots.length : 0,
      frames: st.frames | 0, slowFrames: st.slowFrames | 0, rockRedraws: st.rockRedraws | 0,
      saveCount, calm, timers: timers.size, stale, stepMs: stepMsNow(),
      // ここから下は契約に足したもの（テスト・デバッグ用）
      logicPhase: s.phase || null, t: Number(s.t) || 0, tries: s.tries | 0, cleared: !!s.cleared, hold: s.hold === true, best, sleeping,
      hint: el.hint ? el.hint.textContent : "", suggest: suggestSlot, swapSel: overlay === "swap" ? swapSel : null,
      totals: s.totals ? Object.assign({}, s.totals) : null,
      drawMs: Number(st.drawMs) || 0, cellPx: Number(st.cellPx) || 0,
      view: st.view || null   // render の見せている範囲（zoom・rockPx など。§18.1 A の確かめ用）
    };
  }
  function advance(sec) {
    const s = Math.max(0, Math.min(FF_MAX_SEC, Number(sec) || 0));
    if (!state || !s || !running()) return snapshot();
    silent += 1;
    try {
      const n = Math.round(s / STEP);
      for (let i = 0; i < n; i++) {
        stepOnce(STEP, null);
        if (!running()) break;   // エンディングのカードが出たら止まる
      }
    } finally { silent -= 1; }
    saveNow();
    R_call("frame", state, [], 0);
    updateUi();
    return snapshot();
  }
  // テスト用：logic の state の形をそのまま入れる。星・かけら・武器・ひかえ・予約は loadSave と同じ検証に通す。
  // 小惑星（rock）が同じ星の形で正しければ、マスの残り・位置・phase・hold もそのまま使う（星の途中から試せる）
  function setStateApi(obj) {
    const base = normalize(obj);
    if (!base) return false;
    let s = base;
    try {
      const r = obj.rock;
      const okRock = r && typeof r === "object" && r.cols === base.rock.cols && r.rows === base.rock.rows &&
        Array.isArray(r.mats) && Array.isArray(r.hp) && r.mats.length === r.cols * r.rows && r.hp.length === r.mats.length &&
        r.mats.every((m) => Number.isInteger(m) && m >= 0 && m <= 4) && r.hp.every((h) => typeof h === "number" && Number.isFinite(h)) &&
        Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.vy);
      if (okRock) {
        const left = r.mats.filter((m) => m > 0).length;
        const rock = Object.assign({}, base.rock, { mats: r.mats.slice(), hp: r.hp.slice(), x: r.x, y: r.y, vy: r.vy, left, scan: null });
        s = Object.assign({}, base, { rock });
        const ph = ["fly", "bounce", "clear"].includes(obj.phase) ? obj.phase : base.phase;
        if (base.phase !== "choose") s.phase = ph;
        if (Number.isFinite(obj.wait)) s.wait = Math.max(0, obj.wait);
        if (Number.isFinite(obj.tryAt) && obj.tryAt <= s.t) s.tryAt = obj.tryAt;
        if (Array.isArray(obj.cd) && obj.cd.every(Number.isFinite)) s.cd = base.slots.map((_, k) => (Number.isFinite(obj.cd[k]) ? obj.cd[k] : s.t));
        if (!safeCall(() => L.step(s, 0), null)) s = base;
      }
    } catch (e) { s = base; }
    if (obj.hold === true) s = Object.assign({}, s, { hold: true });
    applyState(s);
    return true;
  }
  function applyState(s) {
    state = s;
    suggestSlot = -1;
    msUntil = -1; nearTold = false;
    if (overlay === "choose" && state.phase !== "choose") closeCard("choose");
    if (overlay === "swap" && !benchOf(state).length) closeCard("swap");
    if (state.phase === "choose") openCard("choose");
    else if (overlay === "swap") fillSwap();
    saveNow();
    R_call("frame", state, [], 0);
    updateUi();
  }
  window.AsteroidGame = Object.freeze({
    getState: snapshot,
    logic() { return state ? JSON.parse(JSON.stringify(state)) : null; },
    advance,
    upgrade(slot) { return doUpgrade(slot, null); },
    unlock() { return doUnlock(); },
    choose(k) { return doChoose(Number(k), false); },
    reserveSwap(slot, id) { return doReserve(slot, id); },
    setState: setStateApi,
    save() { return saveNow(); }
  });

  // ===== デバッグ命令（?debug=1 のときだけ。§7.4） =====
  // gostar の表 ARMS：その星の始めに見合う武器（砲台の武器と Lv ／ ひかえ）。作り直しの logic.js（2026-10-23）で測り直した：
  // simulate('greedy', { seed: 1, maxStar: n, start: { star: n, slots, bench, kakera } }) を星 1 から 1 つずつつないで回し、
  // 星 n をクリアしたときの武器を星 n+1 の行にした（毎回 greedy を回すと重いので、表を引くだけ）。表より先の星は最後の行の武器で Lv99。
  const ARMS = [
    "shot:1",
    "shot:6",
    "shot:8 beam:7",
    "shot:8 beam:11 spread:11",
    "shot:13 beam:14 spread:16",
    "shot:16 beam:17 spread:19 bolt:3",
    "shot:17 beam:18 spread:23 bolt:21",
    "shot:23 beam:23 spread:24 bolt:24",
    "shot:27 beam:27 spread:28 bolt:27",
    "shot:27 beam:28 spread:32 bolt:32",
    "shot:33 beam:34 spread:35 bolt:34",
    "shot:36 beam:37 spread:38 bolt:37",
    "shot:38 beam:38 spread:41 bolt:41 | fire:1",
    "shot:42 beam:43 spread:43 bolt:43 | fire:1",
    "shot:45 beam:46 spread:47 bolt:46 | fire:1",
    "shot:48 beam:50 spread:48 bolt:51 | fire:1",
    "shot:52 beam:52 spread:52 bolt:53 | fire:1",
    "shot:55 beam:55 spread:55 bolt:56 | fire:1",
    "shot:57 beam:58 spread:58 bolt:59 | fire:1",
    "shot:60 beam:61 spread:62 bolt:62 | fire:1",
    "shot:64 beam:64 spread:65 bolt:65 | fire:1",
    "shot:67 beam:67 spread:67 bolt:68 | fire:1 bomb:1",
    "shot:68 beam:70 spread:71 bolt:71 | fire:1 bomb:1",
    "shot:73 beam:73 spread:73 bolt:74 | fire:1 bomb:1",
    "shot:76 beam:76 spread:76 bolt:77 | fire:1 bomb:1",
    "shot:78 beam:80 spread:78 bolt:81 | fire:1 bomb:1",
    "shot:82 beam:82 spread:83 bolt:83 | fire:1 bomb:1",
    "shot:85 beam:85 spread:85 bolt:86 | fire:1 bomb:1",
    "bomb:84 beam:88 spread:88 bolt:88 | fire:1 shot:87",
    "bomb:85 beam:91 spread:91 bolt:92 | fire:1 shot:87",
    "bomb:89 beam:94 spread:95 bolt:95 | fire:1 shot:87",
    "bomb:91 beam:95 spread:96 bolt:96 | fire:1 shot:87",
    "bomb:92 beam:96 spread:97 bolt:97 | fire:1 shot:87",
    "bomb:94 beam:97 spread:97 bolt:97 | fire:1 shot:87",
    "bomb:94 beam:98 spread:98 bolt:99 | fire:1 shot:87",
    "bomb:95 beam:98 spread:99 bolt:99 | fire:1 shot:87",
    "bomb:96 beam:99 spread:99 bolt:99 | fire:1 shot:87",
    "bomb:97 beam:99 spread:99 bolt:99 | fire:1 shot:87",
    "bomb:97 beam:99 spread:99 bolt:99 | fire:1 shot:87",
    "bomb:98 beam:99 spread:99 bolt:99 | fire:1 shot:87"
  ];
  function armsFor(n) {
    const lvMax = L.LEVEL_MAX || 99;
    const over = n > ARMS.length;
    const row = ARMS[Math.max(0, Math.min(ARMS.length, n) - 1)];
    const parse = (txt, lvTo) => (txt || "").trim().split(/\s+/).filter(Boolean).map((p) => {
      const [id, lv] = p.split(":");
      return { id, lv: Math.min(lvMax, lvTo === undefined ? Number(lv) || 1 : lvTo) };
    }).filter((x) => knownId(x.id));
    const [a, b] = row.split("|");
    return { slots: parse(a, over ? lvMax : undefined), bench: parse(b) };
  }
  function gostar(a) {
    const n = Math.floor(Number(a && a.star));
    if (!(n >= 1 && n <= (L.STAR_MAX || 9999))) throw new Error("star は 1〜" + (L.STAR_MAX || 9999));
    if (overlay && overlay !== "help") closeCardForce();
    const arms = armsFor(n);
    const s = normalize(Object.assign({}, state, { star: n, slots: arms.slots, bench: arms.bench, swap: [], offer: null, tries: 1, ms: [], cleared: n > (L.ENDING_STAR || 30), mid: undefined }));
    if (!s) throw new Error("星を変えられない");
    applyState(s);
    bossUntil = -1;
    const info = safeCall(() => L.starInfo(n), null);
    if (info && info.boss) bossUntil = state.t + BOSS_BANNER_SEC;
    writeBest(n - 1);
    return { star: state.star, slots: state.slots, bench: state.bench, info };
  }
  function closeCardForce() {
    const k = overlay;
    if (!k) return;
    const box = CARDS[k].box();
    if (box) box.hidden = true;
    overlay = null;
    queued = null;
    setBackInert(false);
    unlockCardButtons();
  }
  // マスを書き換えた写し（logic の state はイミュータブルなので新しいオブジェクトを作る）
  function withRock(fn, extra) {
    if (!state || state.phase === "end") throw new Error("いまは つかえない");
    if (state.phase !== "fly") throw new Error("fly のときだけ（いまは " + state.phase + "）");
    const rock = Object.assign({}, state.rock, { mats: state.rock.mats.slice(), hp: state.rock.hp.slice(), scan: null });
    fn(rock);
    const s = Object.assign({}, state, { rock, shots: [], burns: [] }, extra || {});
    if (!safeCall(() => L.step(s, 0), null)) throw new Error("変えられなかった");
    state = s;
    R_call("frame", state, [], 0);
    updateUi();
  }
  function bottomRowOf(rock) {
    for (let r = rock.rows - 1; r >= 0; r--) for (let c = 0; c < rock.cols; c++) if (rock.mats[r * rock.cols + c]) return r;
    return -1;
  }
  function rateTable() {
    const s = state;
    const info = safeCall(() => L.starInfo(s.star), null);
    const weapons = W_IDS.map((id) => {
      const k = s.slots.findIndex((x) => x.id === id);
      const b = benchOf(s).find((x) => x.id === id);
      const w = WEAPON[id] || {};
      return {
        id, name: wName(id), have: k >= 0 ? "slot" : b ? "bench" : null, slot: k >= 0 ? k : null, lv: k >= 0 ? s.slots[k].lv : b ? b.lv : null,
        dps: k >= 0 ? safeCall(() => L.dpsOf(s, k), null) : null,
        upCost: k >= 0 ? safeCall(() => L.upCostOf(s, k), null) : null, good: w.good || null, aff: w.aff || {}, rate: w.rate, dmg: w.dmg
      };
    });
    return { star: s.star, info, kakera: s.kakera, slotCost: safeCall(() => L.slotCostOf(s), null), progress: safeCall(() => L.progressOf(s), null), swap: swapOf(s), weapons };
  }
  const D = window.YubiDebug;
  if (D && typeof D.command === "function") {
    safeCall(() => {
      D.command("ff", (a) => {
        const sec = Math.max(0, Math.min(FF_MAX_SEC, a && a.sec !== undefined ? Number(a.sec) || 0 : 30));
        return { sec, state: advance(sec) };
      }, { desc: "早送り（advance と同じ。カードが出ている間は進まない）", args: "{ sec }（既定 30、最大 3600）" });
      D.command("addk", (a) => {
        if (!state) throw new Error("まだ はじまっていない");
        const n = Math.floor(Number(a && a.n) || 0);
        const k = Math.max(0, Math.min(L.KAKERA_MAX || 9e15, (Number(state.kakera) || 0) + n));
        state = Object.assign({}, state, { kakera: Math.floor(k) });
        saveNow();
        updateUi();
        return { kakera: state.kakera, text: fmt(state.kakera) };
      }, { desc: "かけらを足す（KAKERA_MAX まで）", args: "{ n }" });
      D.command("gostar", (a) => gostar(a), { desc: "その星の始めへ（砲台の武器・Lv・ひかえは自動プレイでその星まで来たときの値。表 ARMS）", args: "{ star }" });
      D.command("win", () => {
        // 真ん中の砲台（x が場の真ん中に一番近い台）から一番近いマスを 1 つだけ残す（砲台は撃ってよい）
        const ts = Array.isArray(state && state.turrets) ? state.turrets : [];
        const mid = (L.FIELD_W || 360) / 2;
        let T = null;
        for (const t of ts) if (t && Number.isFinite(t.x) && (!T || Math.abs(t.x - mid) < Math.abs(T.x - mid))) T = t;
        if (!T) T = { x: mid, y: L.TURRET_Y || 500 };
        withRock((rock) => {
          const C = L.CELL || 7;
          let keep = -1, kd = Infinity;
          for (let i = 0; i < rock.mats.length; i++) {
            if (!rock.mats[i]) continue;
            const x = rock.x + ((i % rock.cols) + 0.5) * C, y = rock.y + (Math.floor(i / rock.cols) + 0.5) * C;
            const d = (x - T.x) * (x - T.x) + (y - T.y) * (y - T.y);
            if (d < kd) { kd = d; keep = i; }
          }
          for (let i = 0; i < rock.mats.length; i++) if (i !== keep) { rock.mats[i] = 0; rock.hp[i] = 0; }
          rock.left = keep >= 0 ? 1 : 0;
        });
        return { left: state.rock.left };
      }, { desc: "いまの星のマスを 1 つだけ残す（真ん中の砲台から一番近いマス。クリアの確認）", args: "なし" });
      D.command("lose", () => {
        // 一番下を BARRIER_Y ちょうどに置き、砲台は撃たない（hold）。次の step で必ずはね返る（T-19。§7.4）
        withRock((rock) => {
          const br = bottomRowOf(rock);
          const C = L.CELL || 7;
          rock.y = (L.BARRIER_Y || 470) - (br + 1) * C;
        }, { hold: true });
        return { progress: L.progressOf(state), hold: state.hold === true };
      }, { desc: "小惑星の一番下をバリアの線ちょうどに置き、砲台を止める（hold。次の step ではね返る）", args: "なし" });
      D.command("lv", (a) => {
        if (!state) throw new Error("まだ はじまっていない");
        const k = Math.floor(Number(a && a.slot));
        if (!(k >= 0 && k < state.slots.length)) throw new Error("slot は 0〜" + (state.slots.length - 1));
        const lv = Math.floor(Number(a && a.lv));
        const slots = state.slots.map((x, j) => (j === k ? { id: x.id, lv } : { id: x.id, lv: x.lv }));
        const chk = normalize(Object.assign({}, state, { slots }));
        if (!chk) throw new Error("変えられなかった");
        state = Object.assign({}, state, { slots: chk.slots });
        saveNow();
        updateUi();
        return { slot: k, id: state.slots[k].id, lv: state.slots[k].lv, dps: L.dpsOf(state, k), upCost: L.upCostOf(state, k) };
      }, { desc: "Lv を変える（1〜99。しんか・最大の桁の確認）", args: "{ slot, lv }" });
      D.command("swap", (a) => {
        // 予約して、その場で予約だけ当てる（入れ替えの絵と音の確認。ふだんの遊びでは起きない）
        if (!state) throw new Error("まだ はじまっていない");
        const k = Math.floor(Number(a && a.slot));
        const id = a && a.id;
        const r = safeCall(() => L.reserveSwap(state, k, id), null);
        if (!r || !r.ok) throw new Error("よやく できない（" + (r ? r.reason : "error") + "）");
        const p = swapOf(r.state).find((x) => x.slot === k);
        if (!p) { state = r.state; saveNow(); updateUi(); return { slot: k, id: state.slots[k].id, swapped: false }; }
        const s = r.state;
        const slots = s.slots.map((x) => ({ id: x.id, lv: x.lv }));
        const bench = benchOf(s).map((x) => ({ id: x.id, lv: x.lv }));
        const bi = bench.findIndex((x) => x.id === p.id);
        const out = slots[k], inn = bench[bi];
        slots[k] = { id: inn.id, lv: inn.lv };
        bench[bi] = { id: out.id, lv: out.lv };
        state = Object.assign({}, s, { slots, bench, swap: swapOf(s).filter((x) => x.slot !== k) });
        const ev = { kind: "swap", slot: k, from: out.id, to: inn.id, lv: inn.lv };
        pendingEvents.push(ev);
        handleEvents([ev]);
        updateUi();
        return { slot: k, from: out.id, to: inn.id, lv: inn.lv, swapped: true };
      }, { desc: "予約して、その場で入れ替える（絵と音の確認）", args: "{ slot, id }" });
      D.command("bench", (a) => {
        // その武器を ひかえ に Lv 1 で入れる（持っている武器・知らない武器は飛ばす。砲台と合わせて 6 つまで）
        if (!state) throw new Error("まだ はじまっていない");
        const ids = Array.isArray(a && a.ids) ? a.ids : typeof (a && a.ids) === "string" ? [a.ids] : [];
        const have = new Set(state.slots.map((x) => x.id).concat(benchOf(state).map((x) => x.id)));
        const bench = benchOf(state).map((x) => ({ id: x.id, lv: x.lv }));
        for (const id of ids) if (knownId(id) && !have.has(id) && state.slots.length + bench.length < W_IDS.length) { bench.push({ id, lv: 1 }); have.add(id); }
        state = Object.assign({}, state, { bench });
        saveNow();
        updateUi();
        if (overlay === "swap") fillSwap();
        return { bench: state.bench };
      }, { desc: "その武器を ひかえ に Lv 1 で入れる", args: "{ ids }" });
      D.command("hold", (a) => {
        if (!state) throw new Error("まだ はじまっていない");
        const on = !(a && (a.on === false || a.on === 0 || a.on === "0"));
        state = Object.assign({}, state, { hold: on });
        return { hold: state.hold };
      }, { desc: "砲台が撃つのを止める・戻す（性能・はね返しの確認）", args: "{ on }" });
      D.command("rates", () => rateTable(), { desc: "武器ごとのつよさ・相性・星の混ざり方", args: "なし" });
    }, null);
  }

  // ===== 起動（§7.1・§8.3・§8.4） =====
  (function boot() {
    best = safeCall(() => L.validateBest(readKey(KEY_BEST)), 0) || 0;
    const raw = readKey(KEY_SAVE);
    const ver = raw === null ? null : safeCall(() => L.saveVersionOf(raw), null);
    let migrated = false;
    let loaded = null;
    let extra = { t: 0, ending: false };
    if (ver === 1) {
      // 古い保存（v:1）：① 元の文字を bak へ（あれば上書きしない。写せなければ保存を止める＝元を消さない）② かけらだけ引き継いだ星 1
      // ③ すぐ v:2 で保存 ④ ヒントと遊び方をもう一度。asteroid.best・asteroid.help は書きかえない
      loaded = safeCall(() => L.loadSave(raw), null);
      if (loaded) {
        migrated = true;
        if (!keepBroken(raw)) saveBlocked = true;
      }
    } else if (raw !== null) {
      loaded = safeCall(() => L.loadSave(raw), null);
      if (loaded) extra = extraOf(raw);
    }
    if (loaded) {
      setClock(loaded, extra.t);
      state = loaded;
    } else {
      if (raw !== null) {
        // 読めない・新しい版の保存：元を bak へ写してから新しく始める（写せなければ上書きしない＝元を消さない）
        if (!keepBroken(raw)) saveBlocked = true;
        later(() => setHint(HINT_BROKEN, 5000), 0);
        if (saveBlocked) tellSaveFail(5000);   // 元を bak へ写せないので上書きしない＝このあと保存しない（T5）
      }
      state = safeCall(() => L.newGame((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0), null) || safeCall(() => L.newGame(1), null);
      if (!state) { console.error("ほしくだき: newGame が動きません"); return; }
    }
    if (migrated) {
      // 知らせは遊び方カードの先頭に 1 行（カードの外の #hint は幕の下に隠れるので出さない。UX 4）。カードを閉じたら消す（この回だけ）
      if (el.helpMig) { el.helpMig.textContent = HINT_MIGRATED + "。"; el.helpMig.hidden = false; }
      if (saveBlocked) tellSaveFail(5000);
    }
    if (state.cleared && best < (L.ENDING_STAR || 30)) writeBest(L.ENDING_STAR || 30);
    const info = safeCall(() => L.starInfo(state.star), null);
    if (info && info.boss) bossUntil = state.t + BOSS_BANNER_SEC;
    const firstTime = readKey(KEY_HELP) !== "1";
    if (firstTime || migrated) openCard("help");
    if (extra.ending && state.cleared) {
      // エンディングのカードの途中で閉じた：もう一度出す（星はもう 31。「このまま あそぶ」はここから）
      const t = state.t;
      state = Object.assign({}, state, { phase: "end" });
      state.t = t;
      openCard("end");
    } else if (state.phase === "choose") openCard("choose");
    saveNow();
    R_call("frame", state, [], 0);
    updateUi();
    sfx.play("start");
    if (document.hidden) { sleeping = true; R_call("pause"); }
    syncPhase();
    ensureLoop();
  })();
})();

// オフラインでも遊べるようにする（https か localhost のときだけ有効）
if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("../../sw.js").catch(() => { /* 登録できなくてもゲームは遊べる */ });
  });
}
