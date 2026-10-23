/*
 * もくもくこうば — 進行（固定ステップ）・シートとカード・保存・るすの あいだ・テスト用 API・デバッグ命令
 * 契約：docs/seizai-contract.md §5.2〜5.4（シート・カード・DOM）・§7（進行・入力・テスト用 API・デバッグ命令）・§8（保存）・§13
 * 担当C（入力・進行・保存）だけが編集する。
 *
 * 読み込み順：../../common/sfx.js → logic.js → actors.js → render.js → input.js → main.js
 * - ルール・お金・時間の計算は logic.js（SeizaiLogic）だけが知っている。ここは呼ぶだけ。画面の数は logic の関数の値をそのまま出す（§13-1）
 * - rAF ごとに performance.now() の差（0.25 秒で頭打ち）を貯め、STEP（0.1 秒）ずつ step（1 フレームに最大 3 回。足りない分は捨てる）
 * - 実際の時計 Date.now() は「閉じた間」を測るときだけ使う（wallLast）。閉じた間を足すのは addAway() の1か所だけで、
 *   半分の速さ（AWAY_RATE）は logic の catchUp の中だけで掛かる（ここでは掛けない。§7.1・§13-3）
 * - タイマーは later / clearLater だけ（setTimeout を直接呼ばない。§7.1）
 */
(() => {
  "use strict";

  const L = window.SeizaiLogic;
  if (!L || typeof L.newGame !== "function" || typeof L.step !== "function") throw new Error("もくもくこうば: SeizaiLogic が読み込まれていません（logic.js）");

  const NAME = typeof L.NAME === "string" && L.NAME ? L.NAME : "もくもくこうば";
  const STEP = Number.isFinite(L.STEP) && L.STEP > 0 ? L.STEP : 0.1;
  const MAX_FRAME_SEC = 0.25;         // 1 フレームの差の頭打ち（§7.1）
  const MAX_STEPS_PER_FRAME = 3;      // 1 フレームに回す step の上限（重い端末で早送りしない）
  const AWAY_CARD_MIN_SEC = Number.isFinite(L.AWAY_CARD_MIN_SEC) ? L.AWAY_CARD_MIN_SEC : 60;
  const MONEY_MAX = Number.isFinite(L.MONEY_MAX) ? L.MONEY_MAX : 9e15;
  const SHIPS_MAX = Number.isFinite(L.SHIPS_MAX) ? L.SHIPS_MAX : 9999;
  const KEY_SAVE = L.SAVE_KEY || "seizai.save";
  const KEY_BAK = L.SAVE_KEY_BAK || "seizai.save.bak";
  const KEY_BEST = L.SAVE_KEY_BEST || "seizai.best";
  const KEY_HELP = L.SAVE_KEY_HELP || "seizai.help";
  const SAVE_EVERY_SEC = 10;          // 自動保存の間隔（遊んだ秒。§8.1）
  const WALL_EVERY_MS = 1000;         // wallLast を覚え直す間隔（§7.1）
  const CARD_LOCK_MS = 400;           // カードは出た直後 400ms 押せない（§5.3・§13-7）
  const STAGE_CARD_DELAY_MS = 1200;   // 節目の演出のあとにカード（§6.3 の 1.5 秒以内）
  const HINT_MS = 3000;
  const SHAKE_MS = 400;
  const FF_MAX_SEC = 36000;           // ff・advance の上限（§7.4）
  const STALL_SEC = 5;                // rAF がこれより長く止まっていたら（iOS で visibilitychange が来ない）閉じた間として足す（§17.1 A5）
  const OFFLINE_CAP_SEC = Number.isFinite(L.OFFLINE_CAP_SEC) ? L.OFFLINE_CAP_SEC : 7200;
  const CARD_PRIORITY = ["help", "reset", "away", "end", "stage", "order"];

  // 流れの順（§19.1.1）。かんそう は こうじょう から、かんな は みなと から
  const DEPT_IDS = ["cut", "plant", "carry", "peel", "beam", "dry", "plank", "plane", "shop"];
  const DEPT_NAME_FALLBACK = { cut: "きこり", plant: "なえぎ", carry: "はこぶ", peel: "かわむき", beam: "かくざい", dry: "かんそう", plank: "いた", plane: "かんな", shop: "おみせ" };
  const STAGE_NAME_FALLBACK = ["こや", "こうば", "こうじょう", "みなと"];
  // 節目のカードに出す「増えたもの」（3 つまで。§3.6）
  // icon は ICONS の名前（小さな絵。文字だけにしない。§17.3 B9）、sub は一言の説明
  const STAGE_NEWS = {
    2: [
      { icon: "beam", text: "かくざいの だい", sub: "まるたから かくざいを つくるよ" },
      { icon: "flag", text: "マネージャー", sub: "（はやく する・ねだんを あげる）" },
      { icon: "order", text: "おおぐちの ちゅうもん", sub: "こうばから ちゅうもんが くるよ" }   // 大口の注文は こうば から（§17.2 C2）
    ],
    3: [
      { icon: "plank", text: "いたの だい", sub: "かくざいから いたを つくるよ" },
      { icon: "dry", text: "かんそうの だい", sub: "きを かわかすよ" },   // §19.4
      { icon: "tree", text: "ひのき", sub: "たかく うれるよ" }
    ],
    4: [
      { icon: "ship", text: "おおきな ふねの ちゅうもん", sub: "とどけると ゴール！" },
      { icon: "plane", text: "かんなの だい", sub: "つるつるに するよ" },   // §19.4
      { icon: "person", text: "ふねの しょうにん", sub: "いっぱい かってくれるよ" }
    ]
  };
  // 節目のカードに添える小さな絵（24x24。静的な文字列だけ）
  const SVG_HEAD = '<svg class="gic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">';
  const ICONS = {
    beam: SVG_HEAD + '<rect x="3" y="8" width="18" height="8" rx="1" fill="#d9a95f"/><rect x="3" y="8" width="18" height="2.4" fill="#f0d39a"/><circle cx="19" cy="12" r="2" fill="#a97b3c"/></svg>',
    dry: SVG_HEAD + '<rect x="3" y="4" width="2.2" height="17" fill="#8a5a2b"/><rect x="18" y="4" width="2.2" height="17" fill="#8a5a2b"/><rect x="3" y="4" width="17" height="2" fill="#8a5a2b"/><rect x="7" y="8" width="3" height="13" fill="#e8bf72" transform="rotate(-12 8.5 14)"/><rect x="12" y="8" width="3" height="13" fill="#e8bf72" transform="rotate(-12 13.5 14)"/><circle cx="20" cy="4" r="3" fill="#ffcf33"/></svg>',
    plane: SVG_HEAD + '<rect x="2" y="15" width="20" height="4" fill="#fbe9c4"/><rect x="3" y="16" width="18" height="1" fill="#ffffff"/><rect x="7" y="9" width="10" height="6" rx="1" fill="#b07a3a"/><path d="M18 12 q4 -1 3 3 q-1 2 -3 0" fill="none" stroke="#f0d296" stroke-width="1.4"/></svg>',
    plank: SVG_HEAD + '<rect x="3" y="5" width="18" height="3.6" fill="#f0d39a"/><rect x="3" y="10.2" width="18" height="3.6" fill="#e7c48c"/><rect x="3" y="15.4" width="18" height="3.6" fill="#f0d39a"/></svg>',
    flag: SVG_HEAD + '<rect x="5" y="3" width="2.4" height="19" fill="#f2f5ef"/><path d="M7.4 4 L20 8.5 L7.4 13 Z" fill="#f0a43a"/></svg>',
    order: SVG_HEAD + '<rect x="3" y="6" width="18" height="13" rx="2" fill="#f2f5ef"/><path d="M3.5 7 L12 14 L20.5 7" fill="none" stroke="#34483b" stroke-width="2"/><circle cx="19" cy="6" r="3.4" fill="#ffd84d"/></svg>',
    tree: SVG_HEAD + '<rect x="10.6" y="15" width="2.8" height="6" fill="#8a5a2b"/><path d="M12 2 L19 12 H15 L20 17 H4 L9 12 H5 Z" fill="#5fb54f"/></svg>',
    person: SVG_HEAD + '<circle cx="12" cy="7.5" r="4" fill="#f1c27d"/><path d="M4.5 21 Q4.5 12.5 12 12.5 Q19.5 12.5 19.5 21 Z" fill="#3d6fb6"/></svg>',
    ship: SVG_HEAD + '<path d="M2 15 H22 L19 20 H5 Z" fill="#7a2e2e"/><rect x="11.4" y="3" width="1.6" height="12" fill="#f2f5ef"/><path d="M13.6 4 L19.5 13 H13.6 Z" fill="#f8f4ea"/><path d="M1 21.5 Q4 20 7 21.5 T13 21.5 T19 21.5 T25 21.5" fill="none" stroke="#3d8fc4" stroke-width="1.6"/></svg>'
  };
  // 部署の「1ぷんに ○」の単位（plank は 角材1本 → 板 PLANKS_PER_BEAM 枚 なので、その倍にして「まい」。数は logic の値）
  const PLANKS_PER_BEAM = Number.isFinite(L.PLANKS_PER_BEAM) ? L.PLANKS_PER_BEAM : 1;
  const RATE_UNIT = { cut: ["ぽん", 1], plant: ["ほん", 1], carry: ["ぽん", 1], peel: ["ぽん", 1], beam: ["ぽん", 1], dry: ["ぽん", 1], plank: ["まい", PLANKS_PER_BEAM], plane: ["まい", 1], shop: ["にん", 1] };
  // 品の名前と単位（logic の PRODUCT_NAME・PRODUCT_UNIT を先に使う。無いときの控え）
  const PRODUCT_FALLBACK = { peeled: ["むきまるた", "こ"], beams: ["かくざい", "ぽん"], dried: ["かわいた かくざい", "ぽん"], planks: ["いた", "まい"], smooth: ["つるつるいた", "まい"] };
  const PRODUCT = {};
  for (const k of Object.keys(PRODUCT_FALLBACK)) {
    const n = L.PRODUCT_NAME && typeof L.PRODUCT_NAME[k] === "string" && L.PRODUCT_NAME[k] ? L.PRODUCT_NAME[k] : PRODUCT_FALLBACK[k][0];
    const u = L.PRODUCT_UNIT && typeof L.PRODUCT_UNIT[k] === "string" && L.PRODUCT_UNIT[k] ? L.PRODUCT_UNIT[k] : PRODUCT_FALLBACK[k][1];
    PRODUCT[k] = [n, u];
  }

  const HINT_MONEY = "おかねが たりないよ";
  const HINT_MAX = "これいじょう ふやせないよ";
  const HINT_MGR_LOCKED = "こうばに なると やとえるよ";
  const ORDER_MONEY_NOTE = "ちゅうもん ちゅう：おかねは おれいで まとめて";
  const HINT_STUCK_FOREST = "きこりが きを まっているよ。なえぎを おして ふやそう";
  const HINT_BROKEN = "ほぞんが よめなかったので さいしょから はじめるよ";
  const HINT_RESET_FAIL = "けせなかったよ。もう いちど ためしてね";   // さいしょから で保存が消えなかった（§21 R6）

  const now = () => performance.now();
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  function safeCall(fn, fallback) { try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { console.error("もくもくこうば:", e); return fallback; } }

  const el = {
    hud: $("hud"), back: $("back"), title: $("gameTitle"), helpBtn: $("helpBtn"), soundBtn: $("soundBtn"), money: $("money"),
    goal: $("goal"), goalText: $("goalText"), goalBar: $("goalBar"), expandBtn: $("expandBtn"), orderTag: $("orderTag"), shipCount: $("shipCount"),
    scene: $("scene"), canvas: $("sceneCanvas"), sheet: $("sheet"), sheetTitle: $("sheetTitle"), sheetClose: $("sheetClose"),
    awayCard: $("awayCard"), awayText: $("awayText"), awayOk: $("awayOk"),
    stageCard: $("stageCard"), stageOk: $("stageOk"),
    orderCard: $("orderCard"), orderAccept: $("orderAccept"), orderLater: $("orderLater"),
    endCard: $("endCard"), endOk: $("endOk"), help: $("help"), helpOk: $("helpOk"), hint: $("hint"),
    helpReset: $("helpReset"), resetCard: $("resetCard"), resetNo: $("resetNo"), resetYes: $("resetYes")
  };
  const missing = ["money", "goalText", "scene", "sheet"].filter((k) => !el[k]);
  if (missing.length) console.error("もくもくこうば: 画面の部品が見つかりません：" + missing.join(", "));

  document.title = NAME;
  if (el.title && el.title.textContent !== NAME) el.title.textContent = NAME;

  // ===== 効果音（sfx.js が無くても・表に無い名前でも、音なしで遊べる） =====
  const rawSfx = window.YubiSfx && typeof window.YubiSfx.create === "function" ? safeCall(() => window.YubiSfx.create("seizai"), null) : null;
  let silent = 0;                       // advance・catchUp の間は鳴らさない
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
    el.soundBtn.setAttribute("aria-label", sfx.on ? "効果音：オン" : "効果音：オフ");
  }
  function toggleSound() { sfx.unlock(); sfx.toggle(); renderSoundBtn(); }
  renderSoundBtn();

  // ===== 保存の読み書き（できなくても遊べる。§8.1） =====
  function readKey(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeKey(key, val) {
    if (stale) return false;
    try { localStorage.setItem(key, val); noteSaved(key); return true; } catch (e) { return false; }
  }
  function removeKey(key) {
    if (stale) return false;
    try { localStorage.removeItem(key); noteSaved(key); return true; } catch (e) { return false; }
  }

  // ===== 古いページから書き戻さない（§22・X-20） =====
  // bfcache（戻る・進む）で戻ったページや、裏にいる間にほかのタブが同じ保存を書いたページは、メモリの古い状態を保存に書かず、
  // 開き直して今の保存から続ける（閉じた間の稼ぎは、開き直したページが保存の savedAt から1回だけ足す）。
  // 見張るのは途中の保存（seizai.save）だけ。このページが最後に読んだ・書いた生の文字と比べる
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
    try { location.reload(); } catch (e) { console.error("もくもくこうば: 開き直せませんでした", e); }
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

  // ===== タイマー（later / clearLater。§7.1） =====
  const timers = new Set();
  function later(fn, ms) {
    const id = setTimeout(() => { timers.delete(id); try { fn(); } catch (e) { console.error("もくもくこうば:", e); } }, ms);
    timers.add(id);
    return id;
  }
  function cancel(id) { if (id && timers.has(id)) { clearTimeout(id); timers.delete(id); } }
  function clearLater() { timers.forEach((id) => clearTimeout(id)); timers.clear(); hintTimer = 0; cardUnlockTimer = 0; stageCardTimer = 0; }

  // ===== 状態 =====
  let state = null;            // SeizaiLogic の state（イミュータブル）
  let phase = "play";          // play | paused | card（body[data-phase]）
  let sleeping = false;        // 裏に回っている（rAF を止めている）
  let overlay = null;          // null | help | away | stage | order | end
  let cardQueue = [];          // 開くのを待っているカード
  let cardShownAt = -Infinity;
  let cardUnlockTimer = 0;
  let stageCardPending = false; // 節目の演出のあとに出すカード（pagehide でタイマーが消えても出し直す）
  let stageCardTimer = 0;
  let focusBack = null;
  let sheetDept = null;        // 開いているシートの部署
  let orderIntroPending = false; // 最初の注文が シートを開いている間に来た（シートを閉じたらカードを開く）
  let forestHinted = false;    // 森が止まっているヒントを出した（止まりが直るまで 1 回だけ）
  let wallLast = Date.now();   // 最後に動いていた実際の時刻（閉じた間を測るだけに使う）
  let lastAway = null;         // 最後の catchUp の report
  let saveCount = 0;
  let saveSince = 0;           // 前の保存から遊んだ秒
  let resetting = false;       // さいしょから：保存を消して開き直すまで、何も書かない（§21 R4・R7）
  let saveBlocked = false;     // 壊れた保存を bak に写せなかった（元を消さないため上書きしない）
  let rafId = 0, lastT = null, acc = 0;
  let hintTimer = 0;
  let lastLayoutKey = "";
  let zonesCache = [];
  let layoutInfo = null;       // render.layout の返り値（scale など。みなとへのスクロールに使う）
  let shownStage = 0;
  let lastTool = null;
  let zonesAt = -Infinity;         // 最後に変わった道具 { dept, tier, name }（§19.3.3）
  let lastUi = {};             // DOM に書いた値（同じなら書かない）
  let best = 0;

  const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  // ===== 描画（render.js が無くても遊べる・テストできる） =====
  const R = window.SeizaiRender;
  const render = (R && typeof R.create === "function" && el.canvas ? safeCall(() => R.create(el.canvas, { calm: !!reduceMotion.matches }), null) : null) || stubRender();
  if (render.isStub) console.error("もくもくこうば: SeizaiRender が読み込まれていません（render.js）。絵なしで動きます");
  function stubRender() {
    let frames = 0, calm = !!reduceMotion.matches;
    return {
      isStub: true,
      layout() { return { worldH: 640, zones: [] }; },
      frame() { frames += 1; }, burst() {}, setCalm(b) { calm = !!b; }, pause() {}, resume() {},
      stats() { return { actors: 0, frames, slowFrames: 0, bgRedraws: 0, calm }; }
    };
  }
  const R_call = (name, ...a) => { const f = render[name]; if (typeof f !== "function") return undefined; return safeCall(() => f.apply(render, a), undefined); };
  let calm = !!reduceMotion.matches;
  function onCalmChange() { calm = !!reduceMotion.matches; R_call("setCalm", calm); }
  if (reduceMotion.addEventListener) reduceMotion.addEventListener("change", onCalmChange);
  else if (reduceMotion.addListener) reduceMotion.addListener(onCalmChange);

  // ===== logic の表を読む（DEPTS：{ id, name, kind:'staff'|'line', stage }、STAGES[段−1]：{ id, name, cost }） =====
  function deptInfo(id) {
    const d = Array.isArray(L.DEPTS) ? L.DEPTS.find((x) => x && x.id === id) : null;
    return d && typeof d === "object" ? d : {};
  }
  const deptName = (id) => { const n = deptInfo(id).name; return typeof n === "string" && n ? n : DEPT_NAME_FALLBACK[id] || id; };
  const isLineDept = (id) => deptInfo(id).kind === "line";
  const countOf = (id) => { const s = state && state.depts && state.depts[id]; return s ? (isLineDept(id) ? s.lines : s.staff) | 0 : 0; };
  function stageInfo(n) {
    const s = Array.isArray(L.STAGES) ? L.STAGES[n - 1] : null;
    return s && typeof s === "object" ? s : {};
  }
  const stageName = (n) => { const v = stageInfo(n).name; return typeof v === "string" && v ? v : STAGE_NAME_FALLBACK[n - 1] || ""; };
  // 広げる費用は logic の STAGES[段−1].cost をそのまま出す（予備の値は持たない。§13-1）
  const expandCost = (n) => { const c = stageInfo(n).cost; return Number.isFinite(c) ? c : null; };
  const deptUnlock = (id) => { const v = deptInfo(id).stage; return Number.isFinite(v) ? v : 1; };
  const yen = (n) => safeCall(() => L.formatYen(n), null) || (Math.floor(Number(n) || 0).toLocaleString("ja-JP") + " えん");
  const goalOf = () => (state ? safeCall(() => L.goalOf(state), null) : null);
  const ratesOf = () => (state ? safeCall(() => L.rates(state), {}) || {} : {});
  const bottleneck = () => (state ? safeCall(() => L.bottleneck(state), null) : null);
  // つまりの部署が もう強くできない（logic の maxedOut。SZ-08・契約 §23）：「ここが おそい」を出さず「ぜんぶ さいだい！」にし、
  // 「〇〇を ふやそう」とも言わない。state は毎回新しいオブジェクトなので、同じ state と部署の間は 1 回だけ聞く（maxedOut は state を写す）
  let maxedMemo = { s: null, d: null, v: false };
  function bnMaxed(bn) {
    if (!state || !bn || typeof L.maxedOut !== "function") return false;
    if (maxedMemo.s !== state || maxedMemo.d !== bn) maxedMemo = { s: state, d: bn, v: safeCall(() => L.maxedOut(state, bn), false) === true };
    return maxedMemo.v;
  }
  const productOf = (stage) => safeCall(() => L.productOf(stage), null) || (stage >= 4 ? "smooth" : stage === 3 ? "planks" : stage === 2 ? "beams" : "peeled");
  // 道具（logic の toolOf。名前の表は logic だけが持つ §19.2.1）：{ tier, name, next: null | { name, lv } } | null
  // toolOf は state を写すので、部署の Lv と段が変わったときだけ聞き直す（毎コマ呼ばない。性能 §6.4）
  const toolMemo = {};
  function toolOf(d) {
    if (!state || typeof L.toolOf !== "function") return null;
    const ds = state.depts && state.depts[d];
    const key = state.stage + "|" + (ds ? ds.level : "-");
    const m = toolMemo[d];
    if (m && m.key === key) return m.v;
    const v = safeCall(() => L.toolOf(state, d), null);
    toolMemo[d] = { key, v };
    return v;
  }
  // 閉じていた秒（awaySeconds）。上限に着いたときは切る前の秒を返し、catchUp が 7200 に丸めて capped を立てる（§17.1 A1・SZ-01）
  function awayFor(from, to) {
    const sec = safeCall(() => L.awaySeconds(from, to), 0) || 0;
    if (sec >= OFFLINE_CAP_SEC) { const raw = (to - from) / 1000; if (Number.isFinite(raw) && raw > sec) return raw; }
    return sec;
  }
  // なえぎが 0 人で、切れる木が尽きて森が止まっている
  function forestStuck() {
    if (!state || !state.depts || !state.depts.plant || !state.forest) return false;
    return (state.depts.plant.staff | 0) === 0 && Math.floor(Number(state.forest.trees) || 0) < 1;
  }
  // 前の工程が遅くて待っている部署の、待つ理由と次にすること（なえぎ「きりかぶ まち」など。§18・SZ-03）
  // actors.js の waitOf（人の「待つ」姿と同じ見方）。ちらつかないよう、待たなくなってから 1.5 秒（ゲームの時間）は出したまま
  // 吹き出しと同じ結果を使う：render の waits()（「最近 作っていない」も見た E2 の結果。§20 E3）。render が無いときだけ その瞬間の置き場で決める
  const WAIT_WHY = { cut: "きる きが まだ ないよ", plant: "きりかぶが まだ ないよ", carry: "まるたが まだ ないよ", peel: "まるたが まだ こないよ", beam: "むきまるたが まだ こないよ", dry: "かくざいが まだ こないよ", plank: "かくざいが まだ こないよ", plane: "いたが まだ こないよ", shop: "うりものが まだ ないよ" };
  // いた は こうじょう から かんそう の後（かわいた かくざい を待つ）
  const waitWhy = (d) => (d === "plank" && state && state.stage >= 3 ? "かわいた かくざいが まだ こないよ" : WAIT_WHY[d]);
  const WAIT_HOLD = 1.5;
  let waitSeen = {};
  function trackWait() {
    const A = window.SeizaiActors;
    if (!state || !A || typeof A.waitOf !== "function") return;
    const w = currentWaits();
    const t = Number(state.t) || 0;
    for (const d of DEPT_IDS) {
      if (w[d]) waitSeen[d] = { t, kind: w[d] };
      else if (waitSeen[d] && (t - waitSeen[d].t > WAIT_HOLD || t < waitSeen[d].t)) delete waitSeen[d];
    }
  }
  function currentWaits() {
    const A = window.SeizaiActors;
    if (typeof render.waits === "function") { const w = safeCall(() => render.waits(), null); if (w) return w; }
    return (A && typeof A.waitOf === "function" ? safeCall(() => A.waitOf(state), null) : null) || {};
  }
  // [待つ理由, 次にすること]（どちらも無ければ null）
  // bn：つまりの部署（呼ぶ側が 1 回だけ求めて渡す。bottleneck は state を写すので毎回呼ばない）
  function waitParts(d, bn) {
    if (!state || deptUnlock(d) > state.stage || countOf(d) < 1 || !waitSeen[d]) return null;
    if (bn === d) return null;
    const why = waitSeen[d].kind === "out" ? "おきばが いっぱいだよ" : waitWhy(d) || "まっているよ";
    const fix = !bn || bnMaxed(bn) ? "" : d === "plant" && bn === "cut" ? "きこりを ふやすと うえられるよ" : `${deptName(bn)}を ふやそう`;
    return [why, fix];
  }
  function waitAdvice(d, bn) {
    const w = waitParts(d, bn);
    return !w ? "" : w[1] ? `${w[0]}。${w[1]}` : w[0];
  }
  // 今のお金で買えるものがある部署（名札の「＋」と読み上げ。render.js の印と同じ見方。§17.3 B8）
  function canBuyAny(d) {
    if (!state || d === "goods" || deptUnlock(d) > state.stage) return false;
    for (const what of ["staff", "line", "level", "mgr"]) {
      const c = safeCall(() => L.costOf(state, d, what), null);
      if (Number.isFinite(c) && state.money >= c) return true;
    }
    return false;
  }
  const goalReached = (g) => !!(g && Number.isFinite(g.done) && Number.isFinite(g.need) && g.need > 0 && g.done >= g.need && g.kind !== "ship");

  // ===== 保存（§8） =====
  function saveNow() {
    if (!state || resetting) return false;
    const at = Date.now();
    wallLast = at;
    saveSince = 0;
    if (saveBlocked) return false;
    const raw = safeCall(() => L.makeSave(state, at), null);
    if (typeof raw !== "string") return false;
    const ok = writeKey(KEY_SAVE, raw);
    if (ok) saveCount += 1;
    return ok;
  }
  function writeBest(n) {
    const cur = safeCall(() => L.validateBest(readKey(KEY_BEST)), 0) || 0;
    best = Math.max(cur, n | 0);
    if (best > cur) writeKey(KEY_BEST, String(best));
  }
  // 読めない保存の元を bak へ写す（bak が既にあれば上書きしない＝最初の壊れた保存を残す。§8.3）
  function keepBroken(raw) {
    if (raw === null || raw === undefined) return true;
    // 新しい版（v が今より大きい）の保存は seizai.save.v<n> にも残す（bak が既にあっても消えない。§17.1 A7）
    let okNewer = true;
    let v = null;
    try { const o = JSON.parse(String(raw)); v = o && typeof o === "object" && !Array.isArray(o) ? o.v : null; } catch (e) { v = null; }   // 読めない文字は bak だけ
    if (Number.isInteger(v) && v > (L.SAVE_VERSION || 1) && v < 1e6) okNewer = writeKey(`${KEY_SAVE}.v${v}`, String(raw));
    if (readKey(KEY_BAK) !== null) return okNewer;
    return writeKey(KEY_BAK, String(raw)) && okNewer;
  }
  // logic の state の形を、保存と同じ検証に通す（gostage・ships・setState・addmoney）
  function normalize(obj, keepV) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    let raw;
    try { raw = JSON.stringify(Object.assign({}, obj, { v: keepV && obj.v !== undefined ? obj.v : L.SAVE_VERSION || 1, savedAt: Date.now() })); } catch (e) { return null; }
    const r = safeCall(() => L.loadSave(raw), null);
    return r && r.state ? r.state : null;
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

  // ===== 進め方（§7.1） =====
  function setPhase(p) {
    phase = p;
    body.dataset.phase = p;
  }
  function phaseNow() { return sleeping ? "paused" : overlay ? "card" : "play"; }

  // 1 回 step する。events を返す
  function stepOnce(dt, collect) {
    const r = safeCall(() => L.step(state, dt), null);
    if (!r || !r.state) return [];
    state = r.state;
    const evs = Array.isArray(r.events) ? r.events : [];
    if (evs.length) handleEvents(evs);
    if (collect) for (const e of evs) collect.push(e);
    saveSince += dt;
    return evs;
  }
  const readingCard = () => overlay === "help" || overlay === "reset";
  function ensureLoop() {
    if (rafId || sleeping || !state) return;
    rafId = requestAnimationFrame(frame);
  }
  function stopLoop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; lastT = null; acc = 0; }
  function frame(t) {
    rafId = 0;
    if (sleeping || !state) return;
    const dt = lastT === null ? 0 : Math.min(MAX_FRAME_SEC, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    const w = Date.now();
    // rAF だけが止まっていた（iOS で visibilitychange が来ない）：その間を閉じた間と同じ道で足す（足したあと wallLast は今。二重に足さない。§17.1 A5）
    if (w - wallLast > STALL_SEC * 1000 && !readingCard()) {
      acc = 0;
      addAway(awayFor(wallLast, w));
      wallLast = Date.now();
      ensureLoop();
      return;
    }
    const evs = [];
    if (readingCard()) acc = 0;           // 遊び方を読んでいる間は止める（描画だけ。ユーザー決定「遊び方の間だけ止める」§17.1 A10。さいしょからの確認も §21 R1）
    else {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < MAX_STEPS_PER_FRAME) {
        stepOnce(STEP, evs);
        acc -= STEP;
        n += 1;
      }
      if (acc > STEP) acc = 0;              // 足りない分は捨てる（重い端末で早送りしない）
    }
    if (w - wallLast >= WALL_EVERY_MS || w < wallLast || readingCard()) wallLast = w;   // 毎秒覚える（時計が戻っても今の時刻にそろえる。遊び方の間は閉じた間にしない）
    if (saveSince >= SAVE_EVERY_SEC) saveNow();
    R_call("frame", state, evs, dt);
    updateUi();
    ensureLoop();
  }

  // ===== 出来事（step の events） =====
  function handleEvents(evs) {
    for (const e of evs) {
      if (!e || typeof e.kind !== "string") continue;
      switch (e.kind) {
        case "made":
          if (e.dept === "cut") sfx.play("chop");
          else if (e.dept === "peel" || e.dept === "beam" || e.dept === "dry" || e.dept === "plank" || e.dept === "plane") sfx.play("saw");
          break;
        case "sold":
          sfx.play("sell");   // 間引きは sfx.js の側（担当D）。お金の数字の跳ねは render が付ける（付いていれば何もしない。§17.1 A3）
          break;
        case "order":
          sfx.play("order");
          saveNow();
          announceOrder();
          break;
        case "delivered":
          sfx.play("deliver", state && state.stage === 4 ? "ship" : undefined);   // みなとでは船で届ける（トラック・船の演出は render.frame が events から出す）
          setHint(`ちゅうもんを とどけたよ！ おれい ${yen(e.yen)}`, 4000);
          saveNow();
          break;
        case "goal":
          sfx.play("best");
          if (state && state.stage < 4) setHint("めあてを たっせい！ ひろげられるよ", 4000);
          break;
        case "ship":
          if (e.ending) {
            sfx.play("deliver", "ship");
            writeBest(5);
            saveNow();
            openCard("end");
          } else {
            sfx.play("deliver", "ship");
            setHint(`ふねが でたよ！ おれい ${yen(e.yen)}`, 4000);
            bump(el.shipCount);
            saveNow();
          }
          break;
        default: break;
      }
    }
  }
  // 注文が来た：最初の 1 回だけカードを自動で開く。2 回目からは札と #hint だけ。シートを開いている間は開かない（閉じたら開く。§17.3 B5）
  function announceOrder() {
    const first = state && (state.orderSeq | 0) <= 1;
    if (first) {
      if (sheetDept) orderIntroPending = true; else openCard("order");
    } else setHint(state && state.order && state.order.big ? "とくべつな ちゅうもんが きたよ" : "ちゅうもんが きたよ", 4000);
  }
  function bump(node) {
    if (!node || calm) return;
    node.classList.remove("bump");
    void node.offsetWidth;
    node.classList.add("bump");
  }

  // ===== 閉じた間（ここ1か所だけで足す。半分の速さは catchUp の中。§7.1・§4.3） =====
  function addAway(seconds) {
    if (!state) return null;
    const before = state;
    silent += 1;
    let r;
    try { r = safeCall(() => L.catchUp(state, seconds), null); } finally { silent -= 1; }
    if (!r || !r.state) return null;
    state = r.state;
    const rep = r.report && typeof r.report === "object" ? r.report : { seconds: 0, effective: 0, capped: false, earned: 0 };
    lastAway = rep;
    // 閉じている間に起きたこと（注文が来た・エンディング・船が出た）
    if (!before.cleared && state.cleared) { writeBest(5); cardQueueAdd("end"); }
    else if ((state.ships | 0) > (before.ships | 0)) bump(el.shipCount);
    if (state.order && !state.order.accepted && (!before.order || before.order.id !== state.order.id)) {
      if ((state.orderSeq | 0) <= 1) { if (sheetDept) orderIntroPending = true; else cardQueueAdd("order"); }
      else setHint("ちゅうもんが きたよ", 4000);
    }
    if ((Number(rep.seconds) || 0) >= AWAY_CARD_MIN_SEC) {
      // 注文のカードが開いているときは、おかえり を先に出して、注文は後ろに戻す（遊び方・節目・エンディングの間は今のまま待たせる。§17.3 B6）
      if (overlay === "order") {
        const box = CARDS.order.box(), fb = focusBack;
        if (box) box.hidden = true;
        overlay = null;
        cancel(cardUnlockTimer);
        unlockCardButtons();
        openCard("away");
        focusBack = fb;
        cardQueueAdd("order");
      } else openCard("away");
    } else flushCards();
    saveNow();
    R_call("frame", state, [], 0);
    updateUi();
    return rep;
  }

  // 裏に回す（hidden・pagehide）
  function sleep() {
    if (sleeping) return;
    staleOnHide();                         // 保存がほかで変わっていたら stale にして、下の saveNow は書かない（X-20）
    if (state) saveNow();                  // wallLast もここで覚える
    sleeping = true;
    stopLoop();
    R_call("pause");
    setPhase("paused");
  }
  // 表に戻る（visible・pageshow）。閉じていた秒を足すのは sleeping のときの1回だけ（二重に足さない）
  function wake() {
    if (!sleeping || document.hidden) return;
    sleeping = false;
    const sec = awayFor(wallLast, Date.now());
    wallLast = Date.now();
    restoreTimers();
    addAway(sec);
    wallLast = Date.now();
    R_call("resume");
    setPhase(phaseNow());
    ensureLoop();
  }
  // pagehide の clearLater で消えた続きを戻す
  function restoreTimers() {
    if (hintTimer === 0 && el.hint && el.hint.textContent) el.hint.textContent = "";
    if (overlay && !cardUnlockTimer) {
      const left = CARD_LOCK_MS - (now() - cardShownAt);
      if (left > 0) cardUnlockTimer = later(unlockCardButtons, left); else unlockCardButtons();
    }
    if (stageCardPending && !stageCardTimer) { stageCardPending = false; openCard("stage"); }
    document.querySelectorAll(".shake").forEach((b) => b.classList.remove("shake"));
  }

  // ===== カード（§5.3） =====
  const CARDS = {
    help: { box: () => el.help, primary: () => el.helpOk },
    reset: { box: () => el.resetCard, primary: () => el.resetNo },
    away: { box: () => el.awayCard, primary: () => el.awayOk },
    stage: { box: () => el.stageCard, primary: () => el.stageOk },
    order: { box: () => el.orderCard, primary: () => el.orderAccept },
    end: { box: () => el.endCard, primary: () => el.endOk }
  };
  function cardQueueAdd(kind) {
    if (overlay === kind || cardQueue.includes(kind)) return;
    cardQueue.push(kind);
    cardQueue.sort((a, b) => CARD_PRIORITY.indexOf(a) - CARD_PRIORITY.indexOf(b));
  }
  function openCard(kind) {
    if (!CARDS[kind]) return;
    if (overlay) { if (overlay !== kind) cardQueueAdd(kind); return; }
    cardQueue = cardQueue.filter((k) => k !== kind);
    const box = CARDS[kind].box();
    if (!box) return;
    if (kind === "order" && !(state && state.order && !state.order.accepted)) return;   // 受けた・届いた後の古い札は出さない
    fillCard(kind);
    focusBack = document.activeElement;
    box.hidden = false;
    box.setAttribute("aria-modal", "true");
    overlay = kind;
    if (!sleeping) setPhase("card");
    cardShownAt = now();
    lockCardButtons(box);
    queueCue();
    if (kind === "away") sfx.play("away");
    const p = CARDS[kind].primary();
    if (p) { try { p.focus({ preventScroll: true }); } catch (e) { try { p.focus(); } catch (e2) { /* 無視 */ } } }
  }
  function lockCardButtons(box) {
    box.querySelectorAll("button").forEach((b) => { if (b.id !== "back") b.setAttribute("aria-disabled", "true"); b.dataset.cardLock = "1"; });
    cancel(cardUnlockTimer);
    cardUnlockTimer = later(unlockCardButtons, CARD_LOCK_MS);
  }
  function unlockCardButtons() {
    cardUnlockTimer = 0;
    document.querySelectorAll("[data-card-lock]").forEach((b) => { b.removeAttribute("aria-disabled"); delete b.dataset.cardLock; });
  }
  const cardLocked = () => now() - cardShownAt < CARD_LOCK_MS;
  function closeCard(kind) {
    if (overlay !== kind) return false;
    const box = CARDS[kind].box();
    if (box) box.hidden = true;
    overlay = null;
    cancel(cardUnlockTimer);      // 先に止める（unlockCardButtons が id を 0 にするので、後だと古いタイマーが次のカードを早く解いてしまう）
    unlockCardButtons();
    if (!sleeping) setPhase("play");
    const fb = focusBack; focusBack = null;
    if (fb && fb.isConnected && fb !== document.body && !(box && box.contains(fb))) { try { fb.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
    if (kind === "stage" && state && state.stage === 4) showHarbor();
    flushCards();
    queueCue();
    updateUi();
    return true;
  }
  // みなと（4 段目）に着いたら、節目のカードを閉じたあと #scene を船の位置までゆっくりスクロールして海を見せる（動きを減らす設定では一瞬で。§17.3 B9）
  function harborY() {
    const A = window.SeizaiActors;
    const g = A && typeof A.geometry === "function" ? safeCall(() => A.geometry(4), null) : null;
    return g && g.harbor && Number.isFinite(g.harbor.seaY) ? g.harbor.seaY : 1180;   // 世界の座標（actors.js geometry の harbor.seaY）
  }
  function showHarbor() {
    if (!el.scene) return;
    const HARBOR_SHIP_Y = harborY();
    const scale = layoutInfo && Number.isFinite(layoutInfo.scale) ? layoutInfo.scale : (el.scene.clientWidth || 360) / 360;
    const maxTop = Math.max(0, el.scene.scrollHeight - el.scene.clientHeight);
    const top = Math.max(0, Math.min(maxTop, Math.round(HARBOR_SHIP_Y * scale - el.scene.clientHeight * 0.65)));
    try { el.scene.scrollTo({ top, behavior: calm ? "auto" : "smooth" }); } catch (e) { el.scene.scrollTop = top; }
  }
  function flushCards() {
    if (overlay || !cardQueue.length) return;
    const next = cardQueue.shift();
    openCard(next);
  }
  function setText(node, text) { if (node && node.textContent !== text) node.textContent = text; }
  function fillCard(kind) {
    if (kind === "away") {
      const r = lastAway || { earned: 0, sold: 0, capped: false };
      const p = PRODUCT[productOf(state ? state.stage : 1)] || PRODUCT.peeled;
      setText(el.awayText, `るすの あいだに ${yen(r.earned)} かせいだよ`);   // 「おかえり！」は見出し #awayTitle だけ（SZ-02。読み上げで二重にしない）
      setText($("awayNote"), r.capped ? "2じかん いじょう たったので 2じかんぶん だよ" : "とじている あいだは はんぶんの はやさで、2じかん まで はたらくよ");
      setText($("awaySold"), `うった ${p[0]}：${Math.max(0, Math.floor(Number(r.sold) || 0)).toLocaleString("ja-JP")}${p[1]}`);
      if (!$("awayNote") && el.awayText) {
        // 担当B の HTML に注記の場所が無いときは、本文に続けて書く
        el.awayText.textContent += "。" + (r.capped ? "2じかん いじょう たったので 2じかんぶん だよ" : "とじている あいだは はんぶんの はやさで、2じかん まで はたらくよ");
      }
    } else if (kind === "stage") {
      const n = state ? state.stage : 1;
      setText($("stageTitle"), `${stageName(n)}に なった！`);
      const news = (STAGE_NEWS[n] || []).slice(0, 3);
      const list = $("stageList");
      if (list) {
        list.textContent = "";
        for (const it of news) {
          const li = document.createElement("li");
          if (ICONS[it.icon]) li.insertAdjacentHTML("afterbegin", ICONS[it.icon]);
          const tx = document.createElement("span");
          tx.className = "gtx";
          tx.append(it.text);
          if (it.sub) { const sm = document.createElement("small"); sm.textContent = it.sub; tx.append(sm); }
          li.append(tx);
          list.append(li);
        }
      }
      const txt = $("stageText");
      if (txt) txt.textContent = news.length ? "ふえたもの：" + news.map((it) => it.text).join("・") : "";
    } else if (kind === "order") {
      const o = state && state.order;
      if (!o) return;
      const p = PRODUCT[productOf(state.stage)] || PRODUCT.planks;
      setText($("orderTitle"), o.big ? "とくべつな ちゅうもん" : "おおぐちの ちゅうもん");
      if (el.orderCard) el.orderCard.dataset.big = o.big ? "1" : "0";
      setText($("orderWho"), `${o.who || "おきゃくさん"}から`);
      setText($("orderText"), `${p[0]} ${num(o.need)}${p[1]} とどけると、おれい ${yen(o.reward)}`);
      setText($("orderNote"), `うけると、できた ${p[0]}は ちゅうもんに さきに はいるよ。きげんは ないよ`);
    } else if (kind === "end") {
      const s = state || {};
      const t = Math.max(0, Math.floor(Number(s.t) || 0));
      const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
      const planks = s.totals ? Math.floor(Number(s.totals.planks) || 0) : 0;
      // 見出し #endTitle「おおきな ふねが でたよ！」と重ならない本文（SZ-02 と同じ直し）。数えているのは つくった いた（totals.planks）
      setText($("endText"), "ありがとう！ みなとまで そだったね");
      setText($("endStats"), `あそんだ じかん ${h}じかん${m}ふん・つくった いた ${num(planks)}まい`);
    }
  }
  const num = (n) => Math.max(0, Math.floor(Number(n) || 0)).toLocaleString("ja-JP");

  // 遊び方（§5.3）
  function showHelp() {
    if (overlay && overlay !== "help") return false;
    if (overlay === "help") return closeHelp();
    openCard("help");
    return true;
  }
  function closeHelp() {
    if (overlay !== "help") return false;
    writeKey(KEY_HELP, "1");
    return closeCard("help");
  }
  // 遊び方 ⇄ さいしょからの確認を入れ替える（待っているカードは出さない。戻る先のフォーカスは最初のまま）
  function swapCard(from, to) {
    if (overlay !== from) return false;
    const box = CARDS[from].box();
    if (box) box.hidden = true;
    overlay = null;
    cancel(cardUnlockTimer);
    unlockCardButtons();
    const fb = focusBack;
    openCard(to);
    focusBack = fb;
    return overlay === to;
  }
  // さいしょから（§21）：保存を止める → save と bak を消す → 消えたか確かめる → 開き直す
  function doReset() {
    if (overlay !== "reset") return false;
    resetting = true;
    removeKey(KEY_SAVE);
    removeKey(KEY_BAK);
    if (readKey(KEY_SAVE) !== null || readKey(KEY_BAK) !== null) {
      console.error("もくもくこうば: さいしょから で保存を消せませんでした");
      resetting = false;
      closeCard("reset");
      setHint(HINT_RESET_FAIL, 5000);
      return false;
    }
    stopLoop();
    clearLater();
    try { location.reload(); } catch (e) { console.error("もくもくこうば: 開き直せませんでした", e); }
    return true;
  }

  // ===== シート（§5.2） =====
  function ensureSheetParts() {
    if (!el.sheet) return;
    const make = (tag, attrs, parent) => {
      const n = document.createElement(tag);
      for (const k in attrs) { if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); }
      (parent || el.sheet).append(n);
      return n;
    };
    if (!el.sheetTitle) el.sheetTitle = make("h2", { id: "sheetTitle" });
    if (!$("sheetInfo")) make("p", { id: "sheetInfo" });
    let box = $("sheetBuys") || el.sheet;
    for (const what of ["staff", "line", "level", "mgr"]) {
      if (!el.sheet.querySelector(`[data-buy="${what}"]`)) make("button", { type: "button", "data-buy": what }, box);
    }
    if (!$("mgrFast")) make("button", { type: "button", id: "mgrFast", "aria-pressed": "false", text: "はやい" }, box);
    if (!$("mgrGain")) make("button", { type: "button", id: "mgrGain", "aria-pressed": "false", text: "もうかる" }, box);
    if (!el.sheetClose) el.sheetClose = make("button", { type: "button", id: "sheetClose", text: "とじる", "aria-label": "とじる" });
  }
  function openSheet(dept) {
    if (!el.sheet || !DEPT_IDS.includes(dept)) return false;
    ensureSheetParts();
    if (sheetDept && sheetDept !== dept) markZone(sheetDept, false);
    sheetDept = dept;
    el.sheet.dataset.dept = dept;
    el.sheet.hidden = false;
    el.sheet.classList.add("open");
    lastUi.sheetKey = "";
    renderSheet();
    markZone(dept, true);
    syncSheetH();
    revealZone(dept);
    queueCue();
    return true;
  }
  const zoneOf = (dept) => (el.scene ? el.scene.querySelector(`.zone[data-dept="${dept}"]`) : null);
  function markZone(dept, open) {
    const z = zoneOf(dept);
    if (!z) return;
    if (open) z.setAttribute("aria-expanded", "true"); else z.removeAttribute("aria-expanded");
  }
  // シートが #scene に重なっている高さ（縦向き。横向きは右の列なので 0）を --sheet-h に入れる。
  // #sceneSpacer がその高さになり、いちばん下の場所もシートの上までスクロールできる（§19.3.1）
  let sheetH = 0;
  function sheetOverlap() {
    if (!el.sheet || el.sheet.hidden || !el.scene) return 0;
    const sr = el.scene.getBoundingClientRect(), hr = el.sheet.getBoundingClientRect();
    if (!(hr.height > 0) || hr.left >= sr.right || hr.right <= sr.left) return 0;
    return Math.max(0, Math.round(sr.bottom - hr.top));
  }
  function syncSheetH() {
    const h = sheetOverlap();
    if (h === sheetH) return h;
    sheetH = h;
    if (el.scene) el.scene.style.setProperty("--sheet-h", h + "px");
    return h;
  }
  if (window.ResizeObserver && el.sheet) {
    new ResizeObserver(() => {
      const before = sheetH;
      syncSheetH();
      if (sheetDept && sheetH > before + 2) revealZone(sheetDept);   // シートが高くなったときだけ、開いた場所が隠れないように
    }).observe(el.sheet);
  }
  // 押した部署がシートに隠れないよう #scene をスクロールする（§17.1 A6・§19.3.1）
  // 見える範囲は #scene の上端〜（シートが重なっていれば）シートの上端 − 8px。場所が見える範囲より高いときは、場所の上端をそろえる
  function revealZone(dept) {
    const z = zoneOf(dept);
    if (!z || !el.scene) return;
    const sr = el.scene.getBoundingClientRect(), zr = z.getBoundingClientRect();
    if (!(sr.height > 0 && zr.height > 0)) return;
    const ov = sheetOverlap();
    const top = sr.top, bottom = ov > 0 ? sr.bottom - ov - 8 : sr.bottom;
    const room = bottom - top;
    let dy = 0;
    if (zr.height > room || zr.top < top) dy = zr.top - top;
    else if (zr.bottom > bottom) dy = zr.bottom - bottom;
    if (Math.abs(dy) >= 1) {
      const maxTop = Math.max(0, el.scene.scrollHeight - el.scene.clientHeight);
      el.scene.scrollTop = Math.max(0, Math.min(maxTop, el.scene.scrollTop + Math.round(dy)));
    }
  }
  function closeSheet() {
    if (!el.sheet || !sheetDept) return false;
    markZone(sheetDept, false);
    sheetDept = null;
    delete el.sheet.dataset.dept;
    el.sheet.classList.remove("open");
    el.sheet.hidden = true;
    syncSheetH();
    queueCue();
    if (orderIntroPending) {
      orderIntroPending = false;
      if (state && state.order && !state.order.accepted && !overlay) openCard("order");
    }
    return true;
  }
  function setBtn(btn, label, price, disabled, reason) {
    if (!btn) return;
    const lab = btn.querySelector("[data-part=label]"), pr = btn.querySelector("[data-part=price]");
    const text = price ? `${label} ${price}` : label;
    if (lab || pr) { setText(lab, label); setText(pr, price || ""); }
    else setText(btn, reason ? `${text}（${reason}）` : text);
    if (disabled) btn.setAttribute("aria-disabled", "true"); else btn.removeAttribute("aria-disabled");
    const why = btn.querySelector("[data-part=reason]");
    if (why) setText(why, reason || "");
    btn.dataset.reason = reason || "";
  }
  function reasonText(reason, what, dept) {
    if (reason === "money") return HINT_MONEY;
    if (reason === "max") return HINT_MAX;
    if (reason === "locked") {
      if (what === "mgr" && deptUnlock(dept) <= (state ? state.stage : 1)) return HINT_MGR_LOCKED;
      return `${stageName(deptUnlock(dept))}に なると つかえるよ`;
    }
    return "";
  }
  // 買えるか（state はイミュータブルなので、試しに buy を呼んで理由だけ見る）
  function tryBuy(dept, what) {
    const c = safeCall(() => L.costOf(state, dept, what), null);
    if (Number.isFinite(c)) return { cost: c, ok: state.money >= c, reason: state.money >= c ? null : "money" };
    const r = safeCall(() => L.buy(state, dept, what), null);
    return { cost: null, ok: false, reason: r && r.reason ? r.reason : "max" };
  }
  function renderSheet() {
    if (!sheetDept || !state || !el.sheet) return;
    const d = sheetDept;
    const ds = (state.depts && state.depts[d]) || {};
    const line = isLineDept(d);
    const cnt = countOf(d);
    const lv = ds.level | 0 || 1;
    const unlocked = deptUnlock(d) <= state.stage;
    setText(el.sheetTitle, unlocked ? `${deptName(d)}（${cnt}${line ? "だい" : "にん"}・Lv${lv}）` : deptName(d));
    const rate = Number(ratesOf()[d]) || 0;
    const [unit, mul] = RATE_UNIT[d] || ["こ", 1];
    const perMin = rate * 60 * mul;
    const perMinText = perMin < 10 ? (Math.floor(perMin * 10) / 10).toString() : Math.floor(perMin).toLocaleString("ja-JP");
    const bnS = bottleneck();
    const full = bnS === d && bnMaxed(bnS);   // つまりだが もう強くできない（SZ-08）
    const jam = bnS === d && !full;
    const stuck = forestStuck() && (d === "cut" || d === "plant");   // なえぎが 0 人で森の木が尽きている
    const wp = unlocked && !stuck && bnS !== d ? waitParts(d, bnS) : null;
    const waitTxt = wp ? (wp[1] ? `${wp[0]}。${wp[1]}` : wp[0]) : "";
    const infoEl = $("sheetInfo");
    if (wp && infoEl) {
      // 待つ理由は span.why（横向きで背が低い画面では隠し、次にすることだけ出す。吹き出しが理由を見せている）
      infoEl.textContent = `1ぷんに ${perMinText}${unit}。`;
      const sw = document.createElement("span"); sw.className = "why"; sw.textContent = wp[0] + (wp[1] ? "。" : "");
      infoEl.append(sw, wp[1]);
    } else setText(infoEl, !unlocked ? `${stageName(deptUnlock(d))}に なると つかえるよ`
      : stuck ? "もりの きが たりないよ。なえぎを ふやすと きが そだつよ"
      : `1ぷんに ${perMinText}${unit}${jam ? "。ここが おそいよ" : full ? "。ぜんぶ さいだい！ これいじょう はやく できないよ" : ""}`);
    const sheetRate = $("sheetRate"); if (sheetRate) setText(sheetRate, unlocked ? `1ぷんに ${perMinText}${unit}` : "");
    const sheetJam = $("sheetJam"); if (sheetJam) { setText(sheetJam, jam ? "ここが おそいよ" : ""); sheetJam.hidden = !jam; }
    el.sheet.dataset.jam = jam ? "1" : "0";
    const info = $("sheetInfo"); if (info) { info.dataset.jam = jam ? "1" : "0"; info.dataset.maxed = full ? "1" : "0"; info.dataset.wait = waitTxt ? "1" : "0"; }   // CSS は #sheetInfo[data-jam="1"]（§17.1 A9）
    const q = (w) => el.sheet.querySelector(`[data-buy="${w}"]`);
    const labels = {
      staff: "＋1にん",
      line: "＋1だい",
      level: lv >= (L.LEVEL_MAX || 50) ? "どうぐ" : `どうぐを よくする Lv${lv}→${lv + 1}`,
      mgr: "マネージャーを やとう"
    };
    for (const w of ["staff", "line", "level", "mgr"]) {
      const b = q(w);
      if (!b) continue;
      const fits = w === "staff" ? !line : w === "line" ? line : true;
      const hired = w === "mgr" && !!ds.mgr;
      b.hidden = !unlocked || !fits || hired;
      if (b.hidden) continue;
      const t = tryBuy(d, w);
      if (t.cost === null && t.reason === "max") setBtn(b, labels[w], "", true, "さいだい");
      else if (t.cost === null) setBtn(b, labels[w], "", true, reasonText(t.reason, w, d));
      else setBtn(b, labels[w], yen(t.cost), !t.ok, t.ok ? "" : HINT_MONEY);
    }
    // 次の道具（§19.2.4）：「つぎ：のこぎり（Lv5）」、次の Lv で変わるときは「つぎで のこぎりに なる！」、いちばん上の段では空
    const lvBtn = q("level"), nx = lvBtn && lvBtn.querySelector("[data-part=next]");
    if (nx) {
      const tl = unlocked ? toolOf(d) : null;
      const n = tl && tl.next && typeof tl.next.name === "string" ? tl.next : null;
      setText(nx, !n ? "" : (n.lv | 0) === lv + 1 ? `つぎで ${n.name}に なる！` : `つぎ：${n.name}（Lv${n.lv | 0}）`);
      nx.dataset.soon = n && (n.lv | 0) === lv + 1 ? "1" : "0";
    }
    const f = $("mgrFast"), g = $("mgrGain");
    const showMgr = unlocked && !!ds.mgr;
    for (const [b, k] of [[f, "fast"], [g, "gain"]]) {
      if (!b) continue;
      b.hidden = !showMgr;
      b.setAttribute("aria-pressed", String(ds.mgr === k));
    }
    const mh = $("mgrHelp"); if (mh) mh.hidden = !showMgr;   // 雇ったあとだけ、使い分けの考えどころを 1 行
  }
  function doBuy(dept, what, btn) {
    if (!state) return { ok: false, reason: "locked" };
    const d = dept || sheetDept;
    if (!DEPT_IDS.includes(d)) return { ok: false, reason: "locked" };
    const r = safeCall(() => L.buy(state, d, what), null);
    if (r && r.ok && r.state) {
      state = r.state;
      const tu = r.toolUp && typeof r.toolUp === "object" && typeof r.toolUp.name === "string" ? r.toolUp : null;
      if (tu) {
        // 道具が次の段に変わった（§19.2.3）：#hint「のこぎりに なった！」・音 tool・光の粒と人の cheer
        lastTool = { dept: tu.dept || d, tier: tu.tier | 0, name: tu.name };
        sfx.play("tool");
        R_call("burst", "tool", lastTool.dept);
        setHint(`${tu.name}に なった！`, HINT_MS);
      } else {
        sfx.play(what === "mgr" ? "hire" : "buy");
        R_call("burst", "buy", d);
      }
      saveNow();
      updateUi(true);
      return { ok: true, toolUp: tu ? Object.assign({}, lastTool) : null };
    }
    const reason = r && r.reason ? r.reason : "money";
    sfx.play("deny");
    setHint(reasonText(reason, what, d) || HINT_MONEY);
    if (btn && !calm) {
      btn.classList.remove("shake");
      void btn.offsetWidth;
      btn.classList.add("shake");
      later(() => btn.classList.remove("shake"), SHAKE_MS);
    }
    return { ok: false, reason };
  }
  function doSetMgr(dept, kind) {
    if (!state) return { ok: false };
    const d = dept || sheetDept;
    const r = safeCall(() => L.setMgr(state, d, kind), null);
    if (r && r.ok && r.state) {
      state = r.state;
      sfx.play("toggle");
      saveNow();
      updateUi(true);
      return { ok: true };
    }
    return { ok: false };
  }

  // ===== 場所を押す（§7.2） =====
  function tapZone(dept) {
    if (!state) return { ok: false };
    if (dept === "goods") {
      const r = safeCall(() => L.callCustomer(state), null);
      if (r && r.ok && r.state) {
        state = r.state;
        sfx.play("cheer");
        setHint("おきゃくさんを よんだよ", 2000);
        updateUi();
        return { ok: true, kind: "call" };
      }
      const reason = r && r.reason ? r.reason : "cooldown";
      setHint(reason === "full" ? "おきゃくさんが いっぱいだよ" : "すこし まってね", 2000);
      return { ok: false, kind: "call", reason };
    }
    if (!DEPT_IDS.includes(dept)) return { ok: false };
    openSheet(dept);
    const r = safeCall(() => L.boost(state, dept), null);
    if (r && r.ok && r.state) {
      state = r.state;
      sfx.play("cheer");
      R_call("burst", "boost", dept);
      updateUi(true);
      return { ok: true, kind: "boost", sheet: dept };
    }
    updateUi(true);
    return { ok: false, kind: "boost", reason: r && r.reason ? r.reason : "cooldown", sheet: dept };
  }

  // ===== 広げる・注文 =====
  function doExpand() {
    if (!state) return { ok: false, reason: "none" };
    const r = safeCall(() => L.expand(state), null);
    if (!r || !r.ok || !r.state) {
      const g = goalOf();
      if (goalReached(g) && el.expandBtn && !el.expandBtn.hidden) { sfx.play("deny"); setHint(HINT_MONEY); }
      return { ok: false, reason: r && r.reason ? r.reason : "goal" };
    }
    state = r.state;
    writeBest(state.stage);
    saveNow();
    closeSheet();
    cueNew = (CUE_NEW[state.stage] || []).slice();   // 新しい部署が見えるまで「あたらしい …」の案内
    relayout(true);
    R_call("burst", "stage", null);
    sfx.play("stage", state.stage);
    updateUi(true);
    stageCardPending = true;
    cancel(stageCardTimer);
    stageCardTimer = later(() => { stageCardTimer = 0; stageCardPending = false; openCard("stage"); }, calm ? 0 : STAGE_CARD_DELAY_MS);
    return { ok: true, stage: state.stage };
  }
  function doAcceptOrder() {
    if (!state) return { ok: false };
    const r = safeCall(() => L.acceptOrder(state), null);
    if (!r || !r.ok || !r.state) return { ok: false };
    state = r.state;
    sfx.play("buy");
    saveNow();
    if (overlay === "order") closeCard("order");
    updateUi(true);
    return { ok: true };
  }

  // ===== お金の文字を 1 行の枠に入れる（上の帯が 1 行なので、桁が多いときだけ小さく。測らずに文字の数から見積もる） =====
  let purseW = 0, moneyBase = 0, moneyFit = "";
  const purseEl = el.money ? el.money.parentElement : null;
  function readPurse() {
    if (!purseEl || !el.money) return;
    purseW = purseEl.clientWidth;
    const prev = el.money.style.fontSize;
    el.money.style.fontSize = "";
    moneyBase = parseFloat(getComputedStyle(el.money).fontSize) || 22;
    el.money.style.fontSize = prev;
    moneyFit = "";
    if (lastUi.money) fitMoney(lastUi.money);
  }
  function fitMoney(text) {
    if (!el.money || !purseW || !moneyBase) return;
    let em = 0;
    for (const ch of text) em += /[0-9.,]/.test(ch) ? 0.62 : ch === " " ? 0.3 : 1;
    const room = purseW - 2;
    let size = Math.min(moneyBase, Math.floor(room / Math.max(1, em)));
    size = Math.max(12, size);
    const long = size < moneyBase || em * moneyBase * 1.12 > room;   // 跳ねると となりに重なるときは跳ねない
    const key = size + "|" + long;
    if (key === moneyFit) return;
    moneyFit = key;
    el.money.style.fontSize = size < moneyBase ? size + "px" : "";
    el.money.dataset.long = long ? "1" : "0";
  }
  if (window.ResizeObserver && purseEl) new ResizeObserver(readPurse).observe(purseEl);

  // ===== 画面の表示（logic の関数の値をそのまま。同じなら書かない） =====
  function updateUi(force) {
    if (!state) return;
    if (force) lastUi = {};
    const st = state.stage | 0;
    if (shownStage !== st) { shownStage = st; body.dataset.stage = String(st); relayout(true); }
    const m = yen(state.money);
    if (lastUi.money !== m) {
      lastUi.money = m; setText(el.money, m);
      if (el.money) { el.money.dataset.value = String(state.money); fitMoney(m); }
    }
    const g = goalOf();
    if (g) {
      const gt = String(g.text || "");
      if (lastUi.goal !== gt) { lastUi.goal = gt; setText(el.goalText, gt); }
      if (el.goalBar) {
        const need = Math.max(1, Number(g.need) || 1), done = Math.max(0, Math.min(need, Number(g.done) || 0));
        const key = done + "/" + need;
        if (lastUi.bar !== key) {
          lastUi.bar = key;
          el.goalBar.setAttribute("aria-valuemin", "0");
          el.goalBar.setAttribute("aria-valuemax", String(need));
          el.goalBar.setAttribute("aria-valuenow", String(Math.floor(done)));   // 棒の幅（#goalFill）は render が書く
        }
      }
    }
    if (el.expandBtn) {
      const reached = goalReached(g) && st < 4;
      const can = reached && !!safeCall(() => L.canExpand(state), false);
      const key = reached ? (can ? "c" : "n") + st : "h";
      if (lastUi.expand !== key) {
        lastUi.expand = key;
        el.expandBtn.hidden = !reached;
        if (reached) {
          const c = expandCost(st);
          // ラベルと値段は別の行（SE 縦でボタンが 2 行に割れても崩れない。§17.3 B11）
          const lab = el.expandBtn.querySelector("[data-part=label]"), cst = el.expandBtn.querySelector("[data-part=cost]");
          if (lab && cst) { setText(lab, `${stageName(st + 1)}に ひろげる`); setText(cst, c === null ? "" : yen(c)); }
          else setText(el.expandBtn, c === null ? `${stageName(st + 1)}に ひろげる` : `${stageName(st + 1)}に ひろげる（${yen(c)}）`);
          if (can) el.expandBtn.removeAttribute("aria-disabled"); else el.expandBtn.setAttribute("aria-disabled", "true");
        }
      }
    }
    if (el.orderTag) {
      const o = state.order;
      let t = "", note = "";
      if (o) {
        const p = PRODUCT[productOf(st)] || PRODUCT.planks;
        const name = o.big ? "とくべつな ちゅうもん" : "ちゅうもん";   // 色だけに頼らず、文字でも分かる（§17.3 B4）
        t = o.accepted ? `${name}：${p[0]} ${num(o.got)}/${num(o.need)}` : `${name}が きたよ（おしてね）`;
        if (o.accepted) note = ORDER_MONEY_NOTE;   // 受けている間は お金が止まる（できた しなは ちゅうもんへ）
      }
      const okey = t + "|" + note + (o && o.big ? "|big" : "");
      if (lastUi.order !== okey) {
        lastUi.order = okey;
        el.orderTag.hidden = !t;
        const mainPart = el.orderTag.querySelector("[data-part=main]"), notePart = el.orderTag.querySelector("[data-part=note]");
        if (mainPart) { setText(mainPart, t); setText(notePart, note); } else setText(el.orderTag, t);
        el.orderTag.dataset.accepted = o && o.accepted ? "1" : "0";
        el.orderTag.dataset.big = o && o.big ? "1" : "0";
        if (o && o.accepted) { el.orderTag.setAttribute("tabindex", "-1"); el.orderTag.setAttribute("aria-disabled", "true"); }   // 受けた後は数を見せるだけ
        else { el.orderTag.removeAttribute("tabindex"); el.orderTag.removeAttribute("aria-disabled"); }
      }
    }
    if (el.shipCount) {
      const n = state.ships | 0;
      const t = n >= 1 ? `とどけた ふね ${num(n)} せき` : "";
      if (lastUi.ships !== t) { lastUi.ships = t; el.shipCount.hidden = n < 1; setText(el.shipCount, t); el.shipCount.dataset.value = String(n); }
    }
    const stuck = forestStuck();
    if (stuck && !forestHinted && !sleeping) { forestHinted = true; setHint(HINT_STUCK_FOREST, 5000); }
    else if (!stuck) forestHinted = false;
    trackWait();
    const bnNow = bottleneck();
    // 場所の読み上げ（aria-label）は 0.25 秒ごとで足りる（costOf などが state を写すので毎コマは重い。性能 §6.4）
    const tz = now();
    if (force || tz - zonesAt >= 250) { zonesAt = tz; updateZones(bnNow); }
    if (sheetDept) {
      const key = [sheetDept, stuck, waitAdvice(sheetDept, bnNow), state.money, st, JSON.stringify(state.depts && state.depts[sheetDept]), bnNow, Math.floor((Number(ratesOf()[sheetDept]) || 0) * 600)].join("|");
      if (lastUi.sheetKey !== key) { lastUi.sheetKey = key; renderSheet(); }
    }
  }

  // ===== スクロールの案内 #scrollCue（§19.3.1） =====
  // 流れの順で「半分以上が見える範囲より下に隠れている最初の部署」を「↓ したに おみせ」と出す。部署が全部見えていて
  // みなとの船が隠れていれば「↓ したに ふね」、下に何もなく森が上に隠れていれば「↑ うえに もり」。
  // 節目のあとは、新しい部署が見えるまで「↓ あたらしい かんそう」（data-new="1"）。シート・カードの間と、全部入るときは出さない。
  // 数え直すのはスクロール・配置・シート・カードが変わったときだけ（rAF で 1 コマ 1 回まで）
  const CUE_FLOW = ["cut", "plant", "carry", "peel", "beam", "dry", "plank", "plane", "goods", "shop"];
  const CUE_NEW = { 2: ["beam"], 3: ["dry", "plank"], 4: ["plane"] };
  const cueName = (d) => (d === "goods" || d === "shop" ? deptName("shop") : d === "ship" ? "ふね" : d === "forest" ? "もり" : deptName(d));
  el.cue = $("scrollCue");
  let cueNew = [];             // 節目のあと、まだ見えていない新しい部署
  let cue = null;              // { dir, dept, text, isNew }
  let cueQueued = false, cueShows = 0;
  function queueCue() {
    if (cueQueued || !el.cue) return;
    cueQueued = true;
    requestAnimationFrame(() => { cueQueued = false; safeCall(updateCue, null); });
  }
  function cueTarget() {
    if (!state || !el.scene || sheetDept || overlay) return null;
    const top = el.scene.scrollTop, vh = el.scene.clientHeight, total = el.scene.scrollHeight;
    if (!(vh > 0) || total <= vh + 1) return null;           // 全部入る（iPad など）
    const bot = top + vh;
    const zs = {};
    for (const z of zonesCache) if (z && typeof z.dept === "string") zs[z.dept] = z;
    const below = (y, h) => Math.max(0, y + h - bot) >= h / 2;
    const above = (y, h) => Math.max(0, top - y) >= h / 2;
    const seen = (y, h) => Math.min(y + h, bot) - Math.max(y, top) >= Math.min(h, vh) / 2;
    cueNew = cueNew.filter((d) => !(zs[d] && seen(zs[d].y, zs[d].h)) && !!zs[d]);
    if (cueNew.length) {
      const d = CUE_FLOW.find((x) => cueNew.includes(x));
      const z = zs[d];
      const dir = z.y >= top ? "down" : "up";
      return { dir, dept: d, text: `${dir === "down" ? "↓" : "↑"} あたらしい ${cueName(d)}`, isNew: true };
    }
    for (const d of CUE_FLOW) {
      const z = zs[d];
      if (z && below(z.y, z.h)) return { dir: "down", dept: d, text: `↓ したに ${cueName(d)}`, isNew: false };
    }
    if (state.stage === 4 && layoutInfo && Number.isFinite(layoutInfo.scale)) {
      const sy = harborY() * layoutInfo.scale, sh = 60 * layoutInfo.scale;
      if (below(sy - sh * 0.7, sh)) return { dir: "down", dept: "ship", text: "↓ したに ふね", isNew: false };
    }
    for (const d of ["cut", "plant"]) {
      const z = zs[d];
      if (z && above(z.y, z.h)) return { dir: "up", dept: "forest", text: "↑ うえに もり", isNew: false };
    }
    return null;
  }
  function updateCue() {
    if (!el.cue) return;
    const c = cueTarget();
    const key = c ? c.text + "|" + c.isNew : "";
    const was = cue ? cue.text + "|" + cue.isNew : "";
    cue = c;
    if (key === was && el.cue.hidden === !c) return;
    if (!c) { el.cue.hidden = true; el.cue.classList.remove("bounce"); return; }
    const showing = el.cue.hidden;
    setText(el.cue, c.text);
    el.cue.setAttribute("aria-label", c.text);
    el.cue.dataset.dir = c.dir;
    if (c.isNew) el.cue.dataset.new = "1"; else delete el.cue.dataset.new;
    el.cue.hidden = false;
    // はじめの 3 回は小さく弾む（動きを減らす設定では弾まない）
    if (showing && cueShows < 3 && !calm) { cueShows += 1; el.cue.classList.remove("bounce"); void el.cue.offsetWidth; el.cue.classList.add("bounce"); }
  }
  if (el.cue) el.cue.addEventListener("animationend", () => el.cue.classList.remove("bounce"));
  if (el.scene) el.scene.addEventListener("scroll", queueCue, { passive: true });
  // 押すと：その部署（ふね・もり）が見える所までゆっくりスクロール（動きを減らす設定では一瞬）
  function goCue() {
    const c = cue || cueTarget();
    if (!c || !el.scene) return false;
    if (c.dept === "ship") { showHarbor(); return true; }
    let topTo = 0;
    if (c.dept !== "forest") {
      const z = zonesCache.find((q) => q && q.dept === c.dept);
      if (!z) return false;
      const vh = el.scene.clientHeight;
      topTo = c.dir === "down" ? Math.max(z.y - 8, z.y + z.h + 8 - vh) : z.y - 8;
      if (z.h + 16 > vh) topTo = z.y - 8;
    }
    const maxTop = Math.max(0, el.scene.scrollHeight - el.scene.clientHeight);
    topTo = Math.max(0, Math.min(maxTop, Math.round(topTo)));
    try { el.scene.scrollTo({ top: topTo, behavior: calm ? "auto" : "smooth" }); } catch (e) { el.scene.scrollTop = topTo; }
    queueCue();
    return true;
  }

  // ===== 場所のボタン（.zone）の配置と、読み上げの文 =====
  function relayout(force) {
    if (!el.scene || !state) return;
    const w = el.scene.clientWidth | 0, h = el.scene.clientHeight | 0;
    const key = state.stage + ":" + w + "x" + h;
    if (!force && key === lastLayoutKey) return;
    lastLayoutKey = key;
    const res = R_call("layout", state.stage, w, h);
    zonesCache = res && Array.isArray(res.zones) ? res.zones : [];
    layoutInfo = res && typeof res === "object" ? res : null;
    placeZones();
    syncSheetH();
    queueCue();
  }
  function placeZones() {
    if (!el.scene || !zonesCache.length) return;   // 配置が無いときは担当B の HTML のまま
    const host = (el.canvas && el.canvas.parentElement) || el.scene;
    // zones は #sceneInner（canvas の親）の座標（render が並べるのと同じ）。canvas は sticky なので canvas の offsetTop は足さない（スクロールでずれる）
    const seen = new Set();
    for (const z of zonesCache) {
      if (!z || typeof z.dept !== "string") continue;
      let b = el.scene.querySelector(`.zone[data-dept="${z.dept}"]`);
      if (!b) {
        b = document.createElement("button");
        b.type = "button";
        b.className = "zone";
        b.dataset.dept = z.dept;
        host.append(b);
      }
      seen.add(b);
      b.hidden = false;
      b.style.left = Math.round(Number(z.x) || 0) + "px";
      b.style.top = Math.round(Number(z.y) || 0) + "px";
      b.style.width = Math.max(44, Math.round(Number(z.w) || 0)) + "px";
      b.style.height = Math.max(44, Math.round(Number(z.h) || 0)) + "px";
    }
    el.scene.querySelectorAll(".zone[data-dept]").forEach((b) => { if (!seen.has(b)) b.hidden = true; });
    lastUi.zones = "";
  }
  function updateZones(bnIn) {
    if (!el.scene || !state) return;
    const t = Number(state.t) || 0;
    const jam = bnIn !== undefined ? bnIn : bottleneck();
    const full = bnMaxed(jam);   // つまりの部署が もう強くできない（SZ-08）
    el.scene.querySelectorAll(".zone[data-dept]").forEach((b) => {
      const d = b.dataset.dept;
      let label, cool = 0, boost = 0;
      if (d === "goods") {
        const goods = state.buf ? Math.floor(Number(state.buf.goods) || 0) : 0;
        const p = PRODUCT[productOf(state.stage)] || PRODUCT.peeled;
        label = `うりもの ${num(goods)}${p[1]}。おすと おきゃくさんを よぶよ`;
        const left = (Number(state.callUntil) || 0) - t;
        cool = left > 0 ? Math.min(1, left / (L.CALL_COOLDOWN || 10)) : 0;
      } else {
        const ds = state.depts && state.depts[d];
        if (!ds || deptUnlock(d) > state.stage) label = `${deptName(d)}：${stageName(deptUnlock(d))}に なると つかえるよ`;
        else {
          const wt = jam === d ? "" : waitAdvice(d, jam);
          const tl = toolOf(d);
          label = `${deptName(d)}：${countOf(d)}${isLineDept(d) ? "だい" : "にん"}${tl && tl.name ? "・" + tl.name : ""}。${jam === d ? (full ? "ぜんぶ さいだい。" : "ここが おそいよ。") : ""}${wt ? wt + "。" : ""}${canBuyAny(d) ? "かえるものが あるよ。" : ""}おすと がんばるよ`;
          const left = (Number(ds.cooldownUntil) || 0) - t;
          cool = left > 0 ? Math.min(1, left / (L.BOOST_COOLDOWN || 15)) : 0;
          boost = (Number(ds.boostUntil) || 0) > t ? 1 : 0;
        }
      }
      const c = Math.ceil(cool * 20) / 20;
      if (b.getAttribute("aria-label") !== label) b.setAttribute("aria-label", label);
      if (b.dataset.cool !== String(c)) { b.dataset.cool = String(c); b.style.setProperty("--cool", String(c)); }
      if (b.dataset.boost !== String(boost)) b.dataset.boost = String(boost);
      const jd = jam === d && !full, md = jam === d && full;
      if ((b.dataset.jam === "1") !== jd) b.dataset.jam = jd ? "1" : "0";
      if ((b.dataset.maxed === "1") !== md) b.dataset.maxed = md ? "1" : "0";
    });
  }
  if (window.ResizeObserver && el.scene) new ResizeObserver(() => relayout(false)).observe(el.scene);
  window.addEventListener("resize", () => relayout(false));
  window.addEventListener("orientationchange", () => relayout(false));

  // ===== 入力（input.js） =====
  function onCommand(cmd) {
    const cardCmd = { awayOk: "away", stageOk: "stage", orderAccept: "order", orderLater: "order", endOk: "end", helpOk: "help", helpReset: "help", resetNo: "reset", resetYes: "reset" };
    if (cardCmd[cmd]) {
      if (overlay !== cardCmd[cmd] || cardLocked()) return;    // 出た直後の連打で押し間違えない（§13-7）
      sfx.unlock();
      if (cmd === "helpOk") closeHelp();
      else if (cmd === "helpReset") swapCard("help", "reset");
      else if (cmd === "resetNo") swapCard("reset", "help");
      else if (cmd === "resetYes") doReset();
      else if (cmd === "orderAccept") doAcceptOrder();
      else closeCard(cardCmd[cmd]);
      return;
    }
    switch (cmd) {
      case "esc":
        if (overlay) {
          if (cardLocked() || overlay === "end") return;        // エンディングのカードは Esc で閉じない
          if (overlay === "help") closeHelp();
          else if (overlay === "reset") swapCard("reset", "help");   // Esc は「やめる」と同じ（§21 R3）
          else closeCard(overlay);                              // 注文は「あとで」と同じ（札は残る）
        } else closeSheet();
        break;
      case "help": sfx.unlock(); showHelp(); break;
      case "sound": toggleSound(); break;
      case "expand": if (!overlay && el.expandBtn && !el.expandBtn.hidden) doExpand(); break;
      case "orderTag": if (!overlay && state && state.order && !state.order.accepted) openCard("order"); break;
      case "sheetClose": closeSheet(); break;
      case "mgrFast": doSetMgr(sheetDept, "fast"); break;
      case "mgrGain": doSetMgr(sheetDept, "gain"); break;
      case "outside": if (!overlay) closeSheet(); break;
      case "scrollCue": if (!overlay) goCue(); break;
      case "back": saveNow(); clearLater(); break;              // a のまま移動する
      default: break;
    }
  }
  const I = window.SeizaiInput;
  const detachInput = I && typeof I.attach === "function" ? I.attach(document, {
    onZone: (dept) => { if (!overlay) { sfx.unlock(); tapZone(dept); } },
    onBuy: (what, btn) => { if (!overlay) { sfx.unlock(); doBuy(sheetDept, what, btn); } },
    onCommand,
    isCardOpen: () => !!overlay,
    cardEl: () => (overlay && CARDS[overlay] ? CARDS[overlay].box() : null)
  }) : null;
  if (!detachInput) console.error("もくもくこうば: SeizaiInput が読み込まれていません（input.js）");

  // ===== 中断と再開（§7.1） =====
  document.addEventListener("visibilitychange", () => { if (document.hidden) sleep(); else if (!reloadIfStale()) wake(); });
  window.addEventListener("pagehide", () => { sleep(); clearLater(); });
  window.addEventListener("pageshow", (e) => { if (reloadIfStale()) return; if (e.persisted || sleeping) wake(); });

  // ===== テスト用の公開 API（§7.3） =====
  function snapshot() {
    const s = state || {};
    const st = render.stats ? safeCall(() => render.stats(), {}) || {} : {};
    return {
      phase, stage: s.stage | 0, money: Number(s.money) || 0, rates: ratesOf(), bottleneck: bottleneck(), bottleneckMaxed: bnMaxed(bottleneck()), goal: goalOf(),
      order: s.order ? Object.assign({}, s.order) : null, ships: s.ships | 0, cleared: !!s.cleared,
      sheet: sheetDept, overlay, queue: cardQueue.slice(),
      actors: st.actors | 0, frames: st.frames | 0, slowFrames: st.slowFrames | 0, bgRedraws: st.bgRedraws | 0,
      jamTag: st.jamTag ? Object.assign({}, st.jamTag) : null,
      wallLast, lastAway: lastAway ? JSON.parse(JSON.stringify(lastAway)) : null, saveCount, calm, timers: timers.size,
      sleeping, hint: el.hint ? el.hint.textContent : "", best,
      scrollCue: cue ? { dir: cue.dir, dept: cue.dept, text: cue.text } : null,
      lastTool: lastTool ? Object.assign({}, lastTool) : null,
      carryTrips: typeof render.carryTrips === "function" ? safeCall(() => render.carryTrips(), 0) | 0 : 0,
      waits: state ? Object.assign({}, currentWaits()) : {}
    };
  }
  function advance(sec) {
    const s = Math.max(0, Math.min(FF_MAX_SEC, Number(sec) || 0));
    if (!state || !s) return snapshot();
    // logic の fastForward（写した state を中で書き換えながら STEP ずつ。step を繰り返したのと同じ結果で軽い。§17.1 A8）
    silent += 1;
    try {
      const r = typeof L.fastForward === "function" ? safeCall(() => L.fastForward(state, s), null) : null;
      if (r && r.state) {
        state = r.state;
        const evs = Array.isArray(r.events) ? r.events : [];
        if (evs.length) handleEvents(evs);
      } else {
        const n = Math.round(s / STEP);
        for (let i = 0; i < n; i++) stepOnce(STEP, null);
      }
    } finally { silent -= 1; }
    saveNow();
    R_call("frame", state, [], 0);
    updateUi(true);
    return snapshot();
  }
  function setStateApi(obj) {
    const s = normalize(obj, true);
    if (!s) return false;
    state = s;
    wallLast = Date.now();
    saveNow();
    relayout(true);
    R_call("frame", state, [], 0);
    updateUi(true);
    return true;
  }
  window.SeizaiGame = Object.freeze({
    getState: snapshot,
    logic() { return state ? JSON.parse(JSON.stringify(state)) : null; },
    advance,
    away(sec) { return addAway(Number(sec)); },
    tapZone(dept) { return tapZone(String(dept)); },
    buy(dept, what) { return doBuy(String(dept), String(what), null); },
    setMgr(dept, kind) { return doSetMgr(String(dept), String(kind)); },
    acceptOrder() { return doAcceptOrder(); },
    expand() { return doExpand(); },
    setState: setStateApi,
    save() { return saveNow(); }
  });

  // ===== デバッグ命令（?debug=1 のときだけ。§7.4） =====
  function gostage(n) {
    const stage = Math.round(Number(n));
    if (!(stage >= 1 && stage <= 4)) throw new Error("stage は 1〜4");
    const base = safeCall(() => L.newGame(state ? state.seed : Date.now() >>> 0), null);
    if (!base) throw new Error("newGame が動かない");
    // その段の上限を、logic に聞いて決める（お金を最大にして買えるだけ買い、買えた数＝上限）
    let s = normalize(Object.assign({}, base, { stage, money: MONEY_MAX }));
    if (!s) throw new Error("段を変えられない");
    const target = {};
    for (const d of DEPT_IDS) {
      if (deptUnlock(d) > stage) continue;
      const what = isLineDept(d) ? "line" : "staff";
      let t = s, k = 0;
      while (k < 50) { const r = safeCall(() => L.buy(t, d, what), null); if (!r || !r.ok) break; t = r.state; k += 1; }
      const ds = t.depts[d] || {};
      const cap = (what === "line" ? ds.lines : ds.staff) | 0;
      target[d] = { what, n: d === "plant" ? Math.floor(cap / 2) : Math.max(1, Math.floor(cap / 2)) };
    }
    const depts = {};
    for (const d of Object.keys(s.depts || {})) {
      const ds = Object.assign({}, s.depts[d]);
      if (target[d]) {
        if (target[d].what === "line") ds.lines = target[d].n; else ds.staff = target[d].n;
        ds.level = 10;
      }
      depts[d] = ds;
    }
    const keepMoney = state ? state.money : 0;
    const ns = normalize(Object.assign({}, s, { depts, money: keepMoney, goal: { done: 0 }, order: null, ships: 0, cleared: false, ship: { got: 0 } }));
    if (!ns) throw new Error("段を変えられない");
    setStateApi(ns);
    writeBest(stage);
    return { stage: state.stage, depts: target };
  }
  function rateTable() {
    const r = ratesOf(), out = [];
    const jam = bottleneck();
    for (const d of DEPT_IDS) {
      const ds = (state && state.depts && state.depts[d]) || {};
      out.push({ dept: d, name: deptName(d), perMin: Math.round((Number(r[d]) || 0) * 600) / 10, count: countOf(d), level: ds.level | 0, mgr: ds.mgr || null, jam: jam === d });
    }
    const st = render.stats ? safeCall(() => render.stats(), {}) || {} : {};
    return { stage: state ? state.stage : 0, price: safeCall(() => L.priceOf(state), 0), product: productOf(state ? state.stage : 1), bottleneck: jam, actors: st.actors | 0, depts: out };
  }
  const D = window.YubiDebug;
  if (D && typeof D.command === "function") {
    safeCall(() => {
      D.command("ff", (a) => { const sec = Math.max(0, Math.min(FF_MAX_SEC, a && a.sec !== undefined ? Number(a.sec) || 0 : 60)); return { sec, state: advance(sec) }; },
        { desc: "時間を早送り（開いたまま）", args: "{ sec }（既定 60、最大 36000）" });
      D.command("away", (a) => { const r = addAway(Number(a && a.sec)); if (!r) throw new Error("足せなかった"); return r; },
        { desc: "閉じていたことにする（上限 2 時間・半分の速さ）", args: "{ sec }" });
      D.command("addmoney", (a) => {
        const y = Math.floor(Number(a && a.yen) || 0);
        if (!state) throw new Error("まだ はじまっていない");
        state = Object.freeze(Object.assign({}, state, { money: Math.max(0, Math.min(MONEY_MAX, Math.floor((Number(state.money) || 0) + y))) }));
        saveNow();
        updateUi(true);
        return { money: state.money, text: yen(state.money) };
      }, { desc: "お金を足す（MONEY_MAX まで）", args: "{ yen }" });
      D.command("gostage", (a) => gostage(a && a.stage), { desc: "その段の始めへ飛ぶ（人・台は上限の半分、どうぐ Lv10）", args: "{ stage }（1〜4）" });
      D.command("neworder", () => {
        if (!state || state.stage < (L.ORDER_FROM_STAGE || 2)) throw new Error("こうば から");
        if (state.order) throw new Error("もう ちゅうもんが でている");
        const r = safeCall(() => L.forceOrder(state), null);   // logic が注文を作る（数・お礼・お客さんは logic の式）
        if (!r || !r.ok || !r.state) throw new Error("出せなかった");
        state = r.state;
        handleEvents(Array.isArray(r.events) ? r.events : []);   // 'order' → 音・保存・カード
        updateUi(true);
        return state.order;
      }, { desc: "大口の注文をすぐ出す（こうば から）", args: "なし" });
      D.command("ships", (a) => {
        if (!state || state.stage !== 4) throw new Error("みなと だけ");
        const n = Math.max(0, Math.min(SHIPS_MAX, Math.floor(Number(a && a.n) || 0)));
        const got = Math.max(0, Math.floor(Number(a && a.got) || 0));
        const s = normalize(Object.assign({}, state, { ships: n, cleared: n >= 1, ship: { got } }));
        if (!s || !setStateApi(s)) throw new Error("変えられなかった");
        return { ships: state.ships, got: state.ship ? state.ship.got : 0, need: safeCall(() => L.shipNeed(state.ships), null) };
      }, { desc: "届けた船の数といまの積んだ数を変える（みなと だけ）", args: "{ n, got }" });
      D.command("rates", () => rateTable(), { desc: "部署ごとの速さ・つまり・売値・人の数", args: "なし" });
    }, null);
  }

  // ===== 起動（§7.1・§8.3） =====
  (function boot() {
    setPhase("play");
    if (el.sheet) el.sheet.hidden = true;
    best = safeCall(() => L.validateBest(readKey(KEY_BEST)), 0) || 0;
    const raw = readKey(KEY_SAVE);
    let loaded = raw === null ? null : safeCall(() => L.loadSave(raw), null);
    let awaySec = 0;
    if (loaded && loaded.state) {
      state = loaded.state;
      awaySec = awayFor(loaded.savedAt, Date.now());
    } else {
      if (raw !== null) {
        // 読めない・新しい版の保存：元を bak へ写してから新しく始める（写せなければ上書きしない＝元を消さない）
        if (!keepBroken(raw)) saveBlocked = true;
        later(() => setHint(HINT_BROKEN, 5000), 0);
      }
      state = safeCall(() => L.newGame(Date.now() >>> 0), null);
      if (!state) throw new Error("もくもくこうば: newGame が動きません");
    }
    if ((state.stage | 0) > best) writeBest(state.stage | 0);
    if (state.cleared) writeBest(5);
    body.dataset.stage = String(state.stage | 0);
    shownStage = state.stage | 0;
    relayout(true);
    const firstTime = !safeCall(() => L.validateFlag(readKey(KEY_HELP)), false);
    if (firstTime) openCard("help");
    wallLast = Date.now();
    if (loaded && loaded.state) addAway(awaySec);   // 60 秒以上ならおかえりカード（遊び方が先）
    else saveNow();
    wallLast = Date.now();
    R_call("frame", state, [], 0);
    updateUi(true);
    sfx.play("start");
    if (document.hidden) { sleeping = true; R_call("pause"); setPhase("paused"); }
    else { setPhase(phaseNow()); ensureLoop(); }
  })();
})();

// オフラインでも遊べるようにする（https か localhost のときだけ有効）
if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("../../sw.js").catch(() => { /* 登録できなくてもゲームは遊べる */ });
  });
}
