/*
 * ぼくのまち — 画面と進行（担当C）
 * 約束：docs/machi-contract.md §7（画面・さわり方）・§8（保存）・§9（効果音）、計画書 docs/plans/machi.md §4。
 * 使う部品：MachiLogic（中身）・MachiRender（地図の絵とカメラ）・MachiInput（指）・YubiSfx（音）・YubiDebug（?debug=1）・YubiNotice（X-20 の知らせ）。
 *
 * - 時間は「遊んでいる間だけ」進む：画面が見えていて、カードが開いていないときだけ MachiLogic.step を呼ぶ。閉じていた間は進めない（日付も保存に使わない）
 * - 保存（machi.*）：15 秒ごと・置いた/こわしたあと 2 秒以内・節目・名前を変えたとき・裏へ回る・pagehide。書けなくても遊びは続ける。壊れた保存は machi.bak へ写して地形えらびから
 * - X-20：表に戻ったとき、machi.save が自分の覚えた文字と違えば書かずに 1 回だけ開き直す（もくもくこうば games/seizai/main.js の形）
 */
(function () {
  "use strict";

  const L = window.MachiLogic, R = window.MachiRender, I = window.MachiInput;
  const $ = (id) => document.getElementById(id);
  const NAME = "ぼくのまち";
  const KEY_SAVE = "machi.save", KEY_BAK = "machi.bak", KEY_BEST = "machi.best", KEY_SEEN = "machi.seen", KEY_TIPS = "machi.tips";
  const SAVE_EVERY_SEC = 15, SAVE_SOON_SEC = 2, UI_EVERY_SEC = 0.2;
  const NEWS_SEC = 10, VOICE_SEC = 12, HINT_SEC = 3, TIP_SEC = 6, LINK_SEC = 5, ZOOM_HINT_SEC = 10, VIEW_TIP_MS = 3000;
  const ENTRY_GOAL = "いりぐち（ひかって いる ところ）から みちを ひこう";
  const DEFAULT_HINT = "おくものを えらんで、マスを タップ";

  function safeCall(fn, fallback) { try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { console.error(NAME + ":", e); return fallback; } }
  if (!L || !R || !I) { console.error(NAME + ": 部品（logic.js・render.js・input.js）が読み込まれていません"); return; }

  const el = {
    app: $("app"), back: $("backBtn"), nameBtn: $("nameBtn"), soundBtn: $("soundBtn"),
    moneyText: $("moneyText"), popText: $("popText"), starText: $("starText"), newsText: $("newsText"), dateText: $("dateText"),
    wrap: $("mapWrap"), canvas: $("mapCanvas"), viewBtn: $("viewBtn"), speedBtns: $("speedBtns"), zoomHint: $("zoomHint"),
    voiceBar: $("voiceBar"), voiceFace: $("voiceFace"), voiceText: $("voiceText"), voiceSub: $("voiceSub"), viewLegend: $("viewLegend"), viewTip: $("viewTip"),
    toolHint: $("toolHint"), tools: $("tools"),
    terrainCard: $("terrainCard"), helpCard: $("helpCard"), restartCard: $("restartCard"), nameCard: $("nameCard"), nameInput: $("nameInput"),
    infoCard: $("infoCard"), infoTitle: $("infoTitle"), infoList: $("infoList"), infoWhy: $("infoWhy"),
    statusCard: $("statusCard"), statusList: $("statusList"), starWhy: $("starWhy"), taxNote: $("taxNote"),
    rankCard: $("rankCard"), rankTitle: $("rankTitle"), rankText: $("rankText"), rankBonus: $("rankBonus")
  };
  document.title = NAME;

  // ===== 効果音（sfx.js が無くても・表に無い名前でも、音なしで遊べる） =====
  const rawSfx = window.YubiSfx && typeof window.YubiSfx.create === "function" ? safeCall(() => window.YubiSfx.create("machi"), null) : null;
  let silent = 0;
  const sfx = {
    get on() { return rawSfx ? !!rawSfx.on : false; },
    unlock() { if (rawSfx) try { rawSfx.unlock(); } catch (e) { /* 無視 */ } },
    toggle() { if (rawSfx) try { return rawSfx.toggle(); } catch (e) { /* 無視 */ } return false; },
    play(name, arg) { if (rawSfx && !silent) try { rawSfx.play(name, arg); } catch (e) { /* 無視 */ } }
  };
  document.addEventListener("pointerdown", () => sfx.unlock(), { capture: true });
  document.addEventListener("touchend", () => sfx.unlock(), { capture: true });
  function renderSoundBtn() {
    el.soundBtn.setAttribute("aria-pressed", String(!!sfx.on));
    el.soundBtn.setAttribute("aria-label", "こうかおん");   // オン・オフは aria-pressed だけで伝える（X-25）
  }
  renderSoundBtn();

  // ===== 保存の読み書き（できなくても遊べる） =====
  function readKey(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeKey(key, val) {
    if (stale) return false;
    try { localStorage.setItem(key, val); noteSaved(key); return true; } catch (e) { return false; }
  }
  // 古いページから書き戻さない（X-20）。見張るのは machi.save だけ。このページが最後に読んだ・書いた生の文字と比べる
  const WATCH_KEYS = [KEY_SAVE];
  const seenRaw = new Map(WATCH_KEYS.map((k) => [k, readKey(k)]));
  let stale = false;                    // true：このページはもう保存しない（開き直す前）
  let reloading = false;                // true：開き直しをもう頼んだ（pageshow と visibilitychange の両方から呼ばれても 1 回だけ）
  function noteSaved(key) { if (seenRaw.has(key)) seenRaw.set(key, readKey(key)); }
  const changedElsewhere = () => WATCH_KEYS.some((k) => readKey(k) !== seenRaw.get(k));
  function reloadIfStale() {
    if (!stale && !changedElsewhere()) return false;
    stale = true;
    if (reloading) return true;
    reloading = true;
    if (window.YubiNotice) window.YubiNotice.markReload();   // 開き直したあとに「ほかの タブの つづきから はじめました」を 1 回出す（X-24）
    try { location.reload(); } catch (e) { console.error(NAME + ": 開き直せませんでした", e); }
    return true;
  }
  function staleOnHide() {
    if (!stale && changedElsewhere()) stale = true;
    return stale;
  }
  window.addEventListener("storage", (e) => { if (document.hidden && (e.key === null || seenRaw.has(e.key))) stale = true; });

  // ===== 状態 =====
  let state = null;           // MachiLogic の state（その場で書き換わる）
  let seed = (Date.now() % 2147483647) | 0;
  let tool = null;            // 選んでいる道具（null＝しらべる）
  let overlay = null;         // 開いているカード（"terrain" など）
  let overlayBack = null;     // 開く前にフォーカスしていた物
  let sleeping = false;
  let pending = [];           // 次のコマで render に渡す events
  let lastTs = 0, saveSince = 0, saveSoon = 0, uiSince = 99, saveBlocked = false, saveWarned = false, savedCount = 0;
  let newsLeft = 0, newsLast = "";
  let hintLeft = 0, zoomHintLeft = 0, zoomHintShown = false;
  let voiceLeft = 0, voiceI = -1;
  let firstTime = false;      // machi.seen が無かった（あそびかたを自動で出した）
  let rafId = 0;
  const stepTimes = [], monthTimes = [];
  let resting = false, restFrames = 0;   // 止まっていて変わる物が無いとき rAF を休む（約束 §11。A12）
  const camStart = { cell: 0 };

  const sumNow = () => (state ? safeCall(() => L.summary(state), null) : null);

  // ===== 画面の文字 =====
  const ui = { money: "", pop: "", star: -1, date: "", name: "", speed: -1, tool: "", news: "" };
  function fitText(node) {
    // 桁が多くて箱に入らないときは文字を小さくする（最小 12px）
    node.style.fontSize = "";
    const box = node.parentElement;
    if (!box) return;
    let fs = parseFloat(getComputedStyle(node).fontSize) || 24;
    const max = box.clientWidth - 12;
    let n = 0;
    while (node.scrollWidth > max && fs > 12 && n++ < 20) { fs -= 1; node.style.fontSize = fs + "px"; }
  }
  function setStar(n) {
    n = Math.max(1, Math.min(5, n | 0));
    el.starText.innerHTML = `<span class="on">${"★".repeat(n)}</span><span class="off">${"☆".repeat(5 - n)}</span>`;
    el.starText.setAttribute("aria-label", `すみやすさ ほし ${n} / 5`);
    fitText(el.starText);
  }
  function updateUi(force) {
    if (!state) return;
    if (force) wakeLoop();
    const s = sumNow();
    if (!s) return;
    const money = L.formatMoney(s.money), pop = L.formatPop(s.pop);
    if (force || money !== ui.money) { ui.money = money; el.moneyText.textContent = money; el.moneyText.classList.toggle("neg", s.money < 0); fitText(el.moneyText); }
    if (force || pop !== ui.pop) { ui.pop = pop; el.popText.textContent = pop; fitText(el.popText); }
    if (force || s.star !== ui.star) { ui.star = s.star; setStar(s.star); }
    const date = L.dateText(state.month);
    if (force || date !== ui.date) { ui.date = date; el.dateText.textContent = date; }
    if (force || state.name !== ui.name) {
      ui.name = state.name; el.nameBtn.textContent = state.name;
      el.nameBtn.dataset.long = [...state.name].length > 6 ? "1" : "0";
      el.nameBtn.setAttribute("aria-label", `まちの なまえ ${state.name}。おして かえる`);
    }
    if (force || state.speed !== ui.speed) {
      ui.speed = state.speed;
      el.speedBtns.querySelectorAll("[data-speed]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === state.speed)));
    }
    // 道具の鍵（まち から）
    el.tools.querySelectorAll("[data-tool]").forEach((b) => {
      const T = toolDef(b.dataset.tool);
      const locked = !!(T && T.rank > state.rank);
      b.dataset.locked = locked ? "1" : "0";
      b.setAttribute("aria-label", locked ? `${T.name}（${rankLabel(T.rank)}に なると つかえる）` : T ? T.name : "");
    });
    // いりぐちの印：まだ いりぐちに みちが つながっていない間だけ（UX M2）
    render.setEntry(entryLinked() ? null : entryCells());
    if (!newsLeft) showGoal(s);
  }
  function toolDef(id) { for (const t of L.TOOLS) if (t.id === id) return t; return null; }
  function setNews(text, sec) {
    if (!text) return;
    newsLeft = sec || NEWS_SEC;
    if (el.newsText.textContent !== text) el.newsText.textContent = text;
    ui.news = text;
  }
  // ランクの呼び方は「」で囲み、人数を添える（「しまで」が「島で」に読めないように。UX M1）
  function rankLabel(r) { const R = L.RANKS[r]; return R ? `「${R.name}」（${L.formatPop(R.pop)} にん）` : ""; }
  function nextText(s) { return `「${s.next}」（${L.formatPop(s.nextPop)} にん）まで あと ${L.formatPop(Math.max(0, s.nextPop - s.pop))} にん`; }
  function showGoal(s) {
    let t;
    if (state && s.pop === 0 && !entryLinked()) t = ENTRY_GOAL;
    else if (s.next) {
      if (s.pop === 0 && state.month < 2) t = "みちの そばに すむ・しごと・おみせ を おこう";
      else t = nextText(s);
    } else t = "「だいとし」に なったよ！ すきに そだてよう";
    if (el.newsText.textContent !== t) el.newsText.textContent = t;
    ui.news = t;
  }
  let hintNext = [];   // 道具の説明の続き（せんろ）。ほかの知らせが出たら捨てる
  function setHint(text, warn, sec) {
    hintNext = [];
    el.toolHint.textContent = text;
    el.toolHint.dataset.warn = warn ? "1" : "0";
    hintLeft = text === DEFAULT_HINT || !sec ? (warn ? HINT_SEC : 0) : sec;
  }
  function toolHintText(t) {
    const T = toolDef(t);
    if (!T) return DEFAULT_HINT;
    if (t === "erase") return "こわす 1 マス 5〜（おいて すぐなら もどる）";
    if (t === "road") return `みち 1 マス ${T.cost}（はし ${T.bridgeCost}）`;
    if (t === "rail") return `せんろ 1 マス ${T.cost}（はし ${T.bridgeCost}）`;
    if (t === "nature") return `めぐみ 1 マス ${T.cost}（ばしょで しゅるいが きまる）`;
    return `${T.name} 1 マス ${T.cost}`;
  }
  function resetHint() { setHint(toolHintText(tool), false, 0); }
  // 道具の説明（はじめて選んだときに 1 回だけ。machi.tips に選んだ道具を覚える。UX M3）
  const TIPS = {
    home: "すむ＝いえ。みちの そばに おこう",
    work: "しごと＝こうば。けむりが でるよ",
    shop: "おみせ＝はたらく ばしょ。いえの ちかくに",
    road: "みち＝いりぐちから つなげよう",
    // せんろ は 2 つに分けて 6 秒ずつ続けて出す（1 行に収めるため。計画書 machi-rail-view §1）
    rail: ["せんろ＝はなれた みちどうしを つなぐよ", "そばに みちも いるよ。みちの うえにも ひけるよ"],
    green: "みどり＝こうえん。よごれが へるよ",
    erase: "こわす＝おいた ものを けすよ",
    nature: "めぐみ＝はたけ・りんぎょう・りょうし"
  };
  function tipSeen(id) { const r = readKey(KEY_TIPS) || ""; return r.split(",").includes(id); }
  function showTip(id) {
    if (!TIPS[id] || tipSeen(id)) return false;
    const r = readKey(KEY_TIPS);
    writeKey(KEY_TIPS, r ? `${r},${id}` : id);
    const t = TIPS[id];
    setHint(Array.isArray(t) ? t[0] : t, false, TIP_SEC);   // 6 秒たつと値段のヒントに戻る
    if (Array.isArray(t)) hintNext = t.slice(1);            // 続きは 6 秒ずつ（ほかの知らせが出たら捨てる）
    return true;
  }

  // ===== いりぐち（はじめの一手。UX M2・fun 1） =====
  function entryCells() { return state && Array.isArray(state.entry) ? state.entry.map((e) => e.y * L.W + e.x) : []; }
  function linkedRoad(i) {
    const net = state && state.net;
    if (!net || !net.label || !net.comps) return false;
    const lb = net.label[i];
    return lb >= 0 && !!net.comps[lb] && !!net.comps[lb].entry;
  }
  function linkedZone(i) {
    const net = state && state.net;
    if (!net || !net.zone || !net.comps) return false;
    const z = net.zone[i];
    return z >= 0 && !!net.comps[z] && !!net.comps[z].entry;
  }
  // いりぐちに みち が 1 マスでも つながったか（いりぐちの塊が いりぐちのマスより大きい）
  function entryLinked() {
    return !!safeCall(() => {
      const ec = entryCells(), net = state.net;
      if (!ec.length || !net || !net.label || !net.comps) return true;
      for (const i of ec) { const lb = net.label[i]; const c = lb >= 0 ? net.comps[lb] : null; if (c && c.size > ec.length) return true; }
      return false;
    }, true);
  }
  function goToEntry() {
    const ec = entryCells();
    if (ec.length) render.lookAt(ec[ec.length >> 1], 22);
  }
  // 置く前に、つながるかを見積もる（みち：線か となりに いりぐちと つながった みち。区画：2 マス以内に つながった みち）
  function predictLinked(t, cells) {
    if (!state || !state.net || !state.net.label) return true;
    const W = L.W, H = L.H;
    const near = (i, r) => {
      const x = i % W, y = (i / W) | 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (r === 1 && dx && dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && linkedRoad(ny * W + nx)) return true;
      }
      return false;
    };
    if (t === "road") return cells.some((i) => near(i, 1));
    if (t === "home" || t === "work" || t === "shop" || t === "nature") return cells.some((i) => near(i, 2));
    return true;
  }
  // いりぐちと つながった みち のうち、cells にいちばん近いマス
  function nearestLinked(cells) {
    if (!cells.length) return -1;
    let sx = 0, sy = 0;
    for (const i of cells) { sx += i % L.W; sy += (i / L.W) | 0; }
    sx /= cells.length; sy /= cells.length;
    let best = -1, bd = 1e9;
    const n = L.W * L.H;
    for (let i = 0; i < n; i++) {
      if (!linkedRoad(i)) continue;
      const d = Math.abs((i % L.W) - sx) + Math.abs(((i / L.W) | 0) - sy);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  // 置いたあと：つながっていなければ、先に言って、つながった みち の近い所へ寄せて光らせる（UX M4・fun 2）
  function checkLinked(t, cells) {
    if (!cells || !cells.length) return;
    const zone = t === "home" || t === "work" || t === "shop" || t === "nature";
    if (t !== "road" && !zone) return;
    if (cells.some((i) => (zone ? linkedZone(i) : linkedRoad(i)))) return;
    const far = zone && cells.every((i) => !(state.net.zone && state.net.zone[i] >= 0));
    // せんろ のそばの区画は「せんろ だけでは そだたないよ」（ユーザー「入り口とつながっていないと出ます」。計画書 machi-rail-view §1）
    const railOnly = zone && cells.some((i) => L.unlinkedWhy(state, i) === "rail");
    setHint(railOnly ? L.RAIL_ONLY_TEXT : far ? "みちから はなれて いるよ（2 マスまで）" : "いりぐちと つながって いないよ", true, LINK_SEC);
    const j = nearestLinked(cells);
    if (j >= 0) {
      // 見えていれば光らせるだけ。見えていなければ そこへ寄せて光らせる
      const c = render.camera(), x = (j % L.W) + 0.5, y = ((j / L.W) | 0) + 0.5;
      const seen = Math.abs(x - c.cx) * c.cell < el.wrap.clientWidth / 2 - 8 && Math.abs(y - c.cy) * c.cell < el.wrap.clientHeight / 2 - 8;
      if (seen) render.flash(j); else render.focus(j);
    }
  }

  // ===== 道具 =====
  function selectTool(id) {
    if (!state) return;
    const T = toolDef(id);
    if (!T) return;
    if (T.rank > state.rank) {
      setHint(`${rankLabel(T.rank)}に なると つかえるよ`, true, HINT_SEC);
      sfx.play("deny");
      return;
    }
    tool = tool === id ? null : id;
    el.tools.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === tool)));
    cancelPaint();
    resetHint();
    if (tool) showTip(tool);
    sfx.play("select");
  }
  function drawToolIcons() {
    el.tools.querySelectorAll("[data-tool]").forEach((b) => {
      const cv = b.querySelector("canvas");
      if (cv) safeCall(() => R.drawIcon(cv, b.dataset.tool), null);
    });
  }
  drawToolIcons();

  // ===== 描画（MachiRender） =====
  // 地図の canvas は DPR 2 まで（DPR 3 では 1 コマに塗る画素が 2.25 倍になり、寄って動かすと重い。ドット絵なので見た目はほぼ同じ。tech M3）
  const dprNow = () => Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const render = safeCall(() => R.create(el.canvas, { cssW: el.wrap.clientWidth || 300, cssH: el.wrap.clientHeight || 300, dpr: dprNow() }), null);
  if (!render) { console.error(NAME + ": 描画を始められません"); return; }
  // 外から（テスト・デバッグ）カメラや見かたを変えても、休んでいる rAF を起こす
  for (const k of ["setCamera", "panBy", "zoomBy", "zoomTo", "fit", "focus", "lookAt", "flash", "setView", "setPreview", "redraw", "setState"]) {
    const f = render[k];
    if (typeof f === "function") render[k] = function () { const r = f.apply(render, arguments); wakeLoop(); return r; };
  }
  function resizeMap() {
    const w = el.wrap.clientWidth, h = el.wrap.clientHeight;
    if (w > 0 && h > 0) render.resize(w, h, dprNow());
  }
  if (window.ResizeObserver) new ResizeObserver(resizeMap).observe(el.wrap);
  window.addEventListener("resize", resizeMap);
  window.addEventListener("orientationchange", () => setTimeout(resizeMap, 200));

  // ===== カード =====
  const CARDS = {
    terrain: { box: () => el.terrainCard, primary: () => el.terrainCard.querySelector("h2") },   // 1 枚目に赤い枠が付いて「おすすめ」に見えないよう、見出しにフォーカス（UX L5）
    help: { box: () => el.helpCard, primary: () => el.helpCard.querySelector('[data-cmd="help-close"]') },
    restart: { box: () => el.restartCard, primary: () => el.restartCard.querySelector('[data-cmd="restart-no"]') },
    name: { box: () => el.nameCard, primary: () => el.nameInput },
    info: { box: () => el.infoCard, primary: () => el.infoCard.querySelector('[data-cmd="close"]') },
    status: { box: () => el.statusCard, primary: () => el.statusCard.querySelector('[data-cmd="close"]') },
    rank: { box: () => el.rankCard, primary: () => el.rankCard.querySelector('[data-cmd="close"]') }
  };
  let queue = [];             // 開くのを待っているカード（節目は ほかのカードが閉じてから）
  function openCard(kind, noFocus) {
    const C = CARDS[kind];
    if (!C) return;
    if (overlay && overlay !== kind) {
      // 開いているカードがあれば、節目は待たせる。ほかは今のを閉じずに待たせる
      if (!queue.includes(kind)) queue.push(kind);
      return;
    }
    if (!overlay) overlayBack = document.activeElement;
    overlay = kind;
    cancelPaint();
    C.box().hidden = false;
    document.body.dataset.card = kind;
    if (!noFocus) { const p = C.primary(); if (p) safeCall(() => p.focus({ preventScroll: true }), null); }
    wakeLoop();
  }
  function closeCard() {
    if (!overlay) return;
    const C = CARDS[overlay];
    if (C) C.box().hidden = true;
    overlay = null;
    delete document.body.dataset.card;
    lastTs = 0;                                  // カードが開いていた間の時間を足さない
    wakeLoop();
    if (queue.length) { openCard(queue.shift()); return; }
    if (overlayBack && document.contains(overlayBack) && typeof overlayBack.focus === "function") safeCall(() => overlayBack.focus({ preventScroll: true }), null);
    overlayBack = null;
  }

  // ===== 地形えらび =====
  let choices = null;
  function showTerrain() {
    choices = safeCall(() => L.terrainChoices(seed), null);
    if (!choices) return;
    el.terrainCard.querySelectorAll("[data-terrain]").forEach((b) => {
      const c = choices[Number(b.dataset.terrain)];
      const cv = b.querySelector("canvas");
      if (c && cv) safeCall(() => render.thumb(c.terrain, cv), null);
    });
    // いまの町があるときだけ「やめる（いまの まちに もどる）」（tech A6）
    const cancel = el.terrainCard.querySelector('[data-cmd="terrain-cancel"]');
    if (cancel) cancel.hidden = !state;
    openCard("terrain");
  }
  function startGame(choice) {
    const keepName = state ? state.name : undefined;
    const s = safeCall(() => L.newGame(seed, choice, keepName), null);
    if (!s) return;
    state = s;
    tool = null;
    el.tools.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", "false"));
    resetHint();
    render.setState(state);
    resizeMap();
    render.setView("normal"); viewIdx = 0; renderViewBtn();
    pending = [];
    queue = [];                                  // 前の町の節目のカードを新しい町で出さない（tech A7）
    newsLeft = 0; hideVoice();
    el.terrainCard.hidden = true; overlay = null; delete document.body.dataset.card;
    saveNow();
    updateUi(true);
    sfx.play("start");
    const seen = safeCall(() => readKey(KEY_SEEN) === "1", false);
    if (!seen) { firstTime = true; openHelp(true); }
    else { goToEntry(); openQueued(); }
  }
  // あそびかた。はじめて（auto）のときは「さいしょから」を出さない（fun 8）
  function openHelp(auto) {
    const b = el.helpCard.querySelector('[data-cmd="restart-ask"]');
    if (b) b.hidden = !!auto;
    openCard("help");
  }
  function openQueued() { lastTs = 0; if (queue.length) openCard(queue.shift()); }

  // ===== 保存 =====
  function saveNow() {
    if (!state) return false;
    saveSince = 0; saveSoon = 0;
    if (saveBlocked || stale) return false;
    const raw = safeCall(() => L.makeSave(state, Date.now()), null);
    if (typeof raw !== "string") return false;
    const ok = writeKey(KEY_SAVE, raw);
    if (ok) savedCount += 1;
    else if (!saveWarned && !stale) { saveWarned = true; setNews("ほぞんが できないよ", 6); }
    writeBest(state.bestPop | 0);
    return ok;
  }
  function writeBest(n) {
    const cur = safeCall(() => L.validateBest(readKey(KEY_BEST)), 0) || 0;
    if ((n | 0) > cur) writeKey(KEY_BEST, String(n | 0));
  }
  function scheduleSave() { if (!saveSoon) saveSoon = SAVE_SOON_SEC; }
  // 読めない保存の元を bak へ写す（bak が既にあれば上書きしない）。新しい版（v が今より大きい）は machi.save.v<n> にも残す
  function keepBroken(raw) {
    if (raw === null || raw === undefined) return true;
    let okNewer = true;
    const v = safeCall(() => L.saveVersionOf(String(raw)), null);
    if (Number.isInteger(v) && v > (L.SAVE_VERSION || 1) && v < 1e6) okNewer = writeKey(`${KEY_SAVE}.v${v}`, String(raw));
    if (readKey(KEY_BAK) !== null) return okNewer;
    return writeKey(KEY_BAK, String(raw)) && okNewer;
  }

  // ===== events =====
  const DENY = {
    money: "おかねが たりないよ", terrain: "ここには おけないよ", rank: "まだ つかえないよ", occupied: "もう おいてあるよ",
    entry: "いりぐちは こわせないよ", empty: "こわす ものが ないよ"
  };
  // 置けない理由の文（canPlace の reason と、そのマスの地形で出し分ける。fun 2・UX M4）
  function denyText(reason, i) {
    if (reason === "terrain" && state && i >= 0) {
      const t = state.terrain[i];
      if (t === L.TER.SEA) return "うみには おけないよ";
      if (t === L.TER.MOUNT) return "やまには おけないよ";
      if (t === L.TER.RIVER) return "かわには みち・せんろ だけ おけるよ";
    }
    if (reason === "rank" && tool) { const T = toolDef(tool); if (T) return `${rankLabel(T.rank)}に なると つかえるよ`; }
    return DENY[reason] || "ここには おけないよ";
  }
  let denyAt = {};             // doPlace の前に見た、理由ごとの はじめのマス
  const LEAVE_PLACE = { road: "road", rail: "rail", green: "green", erase: "erase" };
  function visibleCell(i) {
    const c = render.camera();
    if (c.cell < 12) return false;
    const x = (i % L.W) + 0.5, y = ((i / L.W) | 0) + 0.5;
    return Math.abs(x - c.cx) * c.cell < el.wrap.clientWidth / 2 && Math.abs(y - c.cy) * c.cell < el.wrap.clientHeight / 2;
  }
  function handleEvents(evs, quiet) {
    if (!evs || !evs.length) return;
    for (const e of evs) {
      if (!e || typeof e !== "object") continue;
      switch (e.kind) {
        case "place": sfx.play(LEAVE_PLACE[e.tool] || "place"); scheduleSave(); break;
        case "erase": sfx.play("erase"); scheduleSave(); break;
        case "deny": {
          sfx.play("deny");
          setHint(denyText(e.reason, denyAt[e.reason] !== undefined ? denyAt[e.reason] : -1), true, HINT_SEC);
          break;
        }
        case "grow": if (e.i >= 0 && visibleCell(e.i)) sfx.play("grow"); break;
        case "rank": onRank(e, quiet); break;
        case "best": writeBest(e.pop | 0); break;
        case "news": setNews(e.text); break;
        case "event":
          setNews(e.text, 12); sfx.play(e.good ? "good" : "oops");
          if (Array.isArray(e.cells) && e.cells.length && e.cells[0] >= 0) render.flash(e.cells[0]);
          break;
        case "voice": showVoice(e); break;
        default: break;
      }
    }
    pending.push(...evs.filter((e) => e && (e.kind === "jam" || e.kind === "grow")));
  }
  const UNLOCK_TEXT = { rail: "せんろ", tax: "ぜいの たかさ えらび", apart: "アパート", luxury: "こうきゅうじゅうたくち", mansion: "マンション", office: "ビル（かいしゃ）", clean: "きれいな こうば", park: "おおきな こうえん", tower: "まちの タワー" };
  function onRank(e, quiet) {
    el.rankTitle.textContent = `${e.name} に なったよ！`;
    // まだ道具の無い物（おおきな こうえん・まちの タワー）は「つかえる ものが ふえたよ」に出さない（tech M2）
    const list = (e.unlocks || []).filter((u) => u !== "park" && u !== "tower").map((u) => UNLOCK_TEXT[u] || u);
    el.rankText.textContent = list.length ? `つかえる ものが ふえたよ：${list.join("・")}` : "まちが おおきく なったね";
    el.rankBonus.textContent = e.bonus ? `おいわいの おかね ${L.formatMoney(e.bonus)}` : "";
    setNews(`${e.name} に なったよ！`, 12);
    if (!quiet) { sfx.play("rank"); openCard("rank"); }
    saveNow();
  }

  // ===== 市民の声 =====
  function drawFace(good) {
    const cv = el.voiceFace, g = cv.getContext("2d");
    g.clearRect(0, 0, 8, 8);
    const skin = good ? "#ffd86b" : "#ffe0b0", ink = "#4a2c10";
    g.fillStyle = skin; g.fillRect(1, 1, 6, 6); g.fillRect(2, 0, 4, 8); g.fillRect(0, 2, 8, 4);
    g.fillStyle = ink;
    g.fillRect(2, 3, 1, 1); g.fillRect(5, 3, 1, 1);
    if (good) { g.fillRect(2, 5, 1, 1); g.fillRect(3, 6, 2, 1); g.fillRect(5, 5, 1, 1); }
    else { g.fillRect(3, 5, 2, 1); g.fillRect(2, 6, 1, 1); g.fillRect(5, 6, 1, 1); g.fillStyle = "#6aa8e8"; g.fillRect(6, 4, 1, 2); }
  }
  function showVoice(e) {
    if (!e || !e.text) return;
    voiceI = Number.isInteger(e.i) ? e.i : -1;
    voiceLeft = VOICE_SEC;
    drawFace(!!e.good);
    el.voiceText.textContent = e.text;
    if (el.voiceSub) el.voiceSub.hidden = !(voiceI >= 0);
    el.voiceBar.dataset.good = e.good ? "1" : "0";
    el.voiceBar.dataset.why = e.why || "";
    el.voiceBar.setAttribute("aria-label", voiceI >= 0 ? `${e.text}。おすと その ばしょへ いくよ` : e.text);
    el.voiceBar.hidden = false;
    closeZoomHint();                             // 同じ所（地図の下の端）に出るので、拡大の案内は閉じる
    sfx.play("voice", !!e.good);
  }
  function hideVoice() { voiceLeft = 0; voiceI = -1; el.voiceBar.hidden = true; }
  el.voiceBar.addEventListener("click", () => {
    if (voiceI >= 0) { render.focus(voiceI); voiceLeft = VOICE_SEC; }
    else hideVoice();
  });

  // ===== めがね =====
  const VIEWS = [["normal", "ふつう"], ["poll", "よごれ"], ["jam", "こんざつ"], ["live", "すみやすさ"], ["land", "とちの ねだん"]];
  // 凡例（色と模様の意味。よい → わるい の順。模様は render の buildOverlay と同じ：なし・点・✕。UX M5）
  const LEGEND = {
    poll: ["よごれ", ["すくない", "すこし", "おおい"]],
    jam: ["みち", ["すいている", "こみぎみ", "こんざつ"]],
    live: ["すみやすさ", ["たかい", "ふつう", "ひくい"]],
    land: ["とちの ねだん", ["たかい", "ふつう", "ひくい"]]
  };
  const LEG_MARK = ["", "・", "✕"];
  let viewIdx = 0;
  function renderViewBtn() {
    const [id, nm] = VIEWS[viewIdx];
    const nx = VIEWS[(viewIdx + 1) % VIEWS.length][1];
    el.viewTip.textContent = `みかた：${nm}`;
    el.viewBtn.setAttribute("aria-label", `ちずの みかた：${nm}。おすと ${nx}`);
    el.viewBtn.dataset.on = viewIdx ? "1" : "0";
    const lg = LEGEND[id];
    el.viewLegend.hidden = !lg;
    el.viewLegend.textContent = "";
    if (lg) {
      const t = document.createElement("span"); t.className = "lt"; t.textContent = lg[0] + "："; el.viewLegend.appendChild(t);
      lg[1].forEach((w, k) => {
        const it = document.createElement("span"); it.className = "li";
        const sw = document.createElement("span"); sw.className = "sw"; sw.dataset.lv = String(k); sw.textContent = LEG_MARK[k]; sw.setAttribute("aria-hidden", "true");
        const tx = document.createElement("span"); tx.textContent = w + (LEG_MARK[k] ? `（${k === 1 ? "てん" : "✕"}）` : "");
        it.append(sw, tx); el.viewLegend.appendChild(it);
      });
    }
  }
  // 見かたの名前は押した直後に 3 秒だけ出す（動きなし。動きを減らす設定でも同じ。凡例と重なるときは凡例の下へ）
  let viewTipTimer = 0;
  function showViewTip() {
    clearTimeout(viewTipTimer);
    const t = el.viewTip;
    t.style.top = "";
    t.hidden = false;
    if (!el.viewLegend.hidden) {
      const w = el.wrap.getBoundingClientRect(), g = el.viewLegend.getBoundingClientRect(), r = t.getBoundingClientRect();
      if (!(r.right <= g.left || r.left >= g.right || r.bottom <= g.top || r.top >= g.bottom)) t.style.top = `${Math.ceil(g.bottom - w.top - el.wrap.clientTop) + 4}px`;
    }
    viewTipTimer = setTimeout(() => { t.hidden = true; }, VIEW_TIP_MS);
  }
  el.viewBtn.addEventListener("click", () => {
    closeZoomHint();
    viewIdx = (viewIdx + 1) % VIEWS.length;
    render.setView(VIEWS[viewIdx][0]);
    renderViewBtn();
    showViewTip();
    sfx.play("select");
  });

  // ===== 指（MachiInput） =====
  let paint = null;           // { a, cells, ok } なぞっている間
  function cancelPaint() { if (paint) { paint = null; render.setPreview(null); } }
  const NATURE = ["", "はたけ", "りんぎょう", "りょうし"];
  function paintCells(a, b) {
    return tool === "road" || tool === "rail" ? L.lineCells(a.x, a.y, b.x, b.y) : L.rectCells(a.x, a.y, b.x, b.y);
  }
  function makePreview(cells) {
    const T = toolDef(tool);
    let n = 0, cost = 0, nature = 0, why = null, whyAt = -1;
    const okCells = [];
    for (const i of cells) {
      const r = L.canPlace(state, tool, i % L.W, (i / L.W) | 0);
      if (r.ok) { n++; cost += r.cost; okCells.push(i); if (!nature && r.natureKind) nature = r.natureKind; }
      else if (!why) { why = r.reason; whyAt = i; }
    }
    const short = state.money >= 0 && cost > state.money;
    const ok = n > 0 && !short;
    // 値段は render が札の終わりに足すので、label には入れない（文だけの札のときは cost を渡さない）
    let label, shown;
    if (!n) label = denyText(why, whyAt);
    else if (short) label = "おかねが たりないよ";
    else {
      label = cost < 0 ? `もどす ${n}マス` : `${tool === "nature" && nature ? NATURE[nature] : T.name} ${n}マス`; shown = Math.abs(cost);
      // つながらない所は、置く前に言う（UX M4 の付記・fun 2）
      if (cost >= 0 && !predictLinked(tool, okCells)) label += "（つながって いないよ）";
    }
    return { tool, cells, ok, cost: shown, label };
  }
  function updatePreview(b) {
    if (!paint || !b) return;
    paint.cells = paintCells(paint.a, b);
    const pv = makePreview(paint.cells);
    paint.ok = pv.ok;
    render.setPreview(pv);
  }
  function doPlace(t, cells) {
    if (!state || !cells || !cells.length) return;
    denyAt = {};
    for (const i of cells) {
      const r = safeCall(() => L.canPlace(state, t, i % L.W, (i / L.W) | 0), null);
      if (r && !r.ok && r.reason && denyAt[r.reason] === undefined) denyAt[r.reason] = i;
    }
    const res = safeCall(() => L.place(state, t, cells), null);
    if (!res) return;
    handleEvents(res.events);
    const placed = (res.events || []).find((e) => e && e.kind === "place");
    if (placed && Array.isArray(placed.cells)) safeCall(() => checkLinked(t, placed.cells), null);
    updateUi(true);
  }
  function closeZoomHint() { if (zoomHintLeft > 0 || !el.zoomHint.hidden) { zoomHintLeft = 0; el.zoomHint.hidden = true; } }
  const detachInput = I.attach(el.canvas, {
    hasTool: () => !!tool && !overlay,
    canPaint: () => render.camera().cell >= R.MIN_PAINT_CELL,
    onTap(px, py) {
      if (overlay || !state) return;
      if (tool) {
        if (render.camera().cell < R.MIN_PAINT_CELL) {
          // まだ いりぐちに みちが無ければ、押した所ではなく いりぐちへ寄る（fun 1）
          if (!entryLinked()) { goToEntry(); setHint("いりぐちから みちを ひこう", false, HINT_SEC + 2); }
          else { render.zoomTo(px, py, 22); setHint("ちかくで おいてね", false, HINT_SEC); }
          closeZoomHint();
          return;
        }
        const c = render.cellAt(px, py);
        if (c) doPlace(tool, [c.i]);
      } else {
        const c = render.cellAt(px, py);
        if (c) openInfo(c);
      }
    },
    onPaintStart(px, py) {
      if (overlay || !state || !tool) return;
      const a = render.cellAt(px, py);
      if (!a) return;
      paint = { a, cells: [a.i], ok: false };
      updatePreview(a);
    },
    onPaintMove(px, py) {
      if (!paint) return;
      const b = render.cellAt(px, py);
      if (b) updatePreview(b);
    },
    onPaintEnd(px, py) {
      if (!paint) return;
      const b = render.cellAt(px, py);
      if (b) updatePreview(b);
      const cells = paint.cells, t = tool;
      paint = null;
      render.setPreview(null);
      if (t && cells && cells.length) doPlace(t, cells);
    },
    onPaintCancel() { cancelPaint(); },
    onPan(dx, dy) { if (!overlay) render.panBy(dx, dy); },
    onPinch(f, cx, cy) { if (!overlay) { render.zoomBy(f, cx, cy); closeZoomHint(); } }
  });

  // ===== しらべる・すみやすさ =====
  function trafficText(t) { return ["すいている", "こみぎみ", "こんざつ", "おおこんざつ"][t | 0] || "すいている"; }
  function addRow(ul, k, v) {
    const li = document.createElement("li");
    const a = document.createElement("span"), b = document.createElement("b");
    a.textContent = k; b.textContent = v;
    li.append(a, b); ul.appendChild(li);
  }
  // 数字に「ひくい・ふつう・たかい」と ○▲✕（色だけにしない）。goodHigh：高いほど よい true・わるい false（UX M6）
  const GRADE = ["ひくい", "ふつう", "たかい"];
  function gradeRow(ul, k, v, goodHigh, lo, hi) {
    const g = v < lo ? 0 : v < hi ? 1 : 2;
    const mark = (goodHigh ? ["✕", "▲", "○"] : ["○", "▲", "✕"])[g];
    addRow(ul, k, `${v}（${GRADE[g]} ${mark}）`);
    return g;
  }
  function addTip(text) { const p = document.createElement("p"); p.className = "tip"; p.textContent = text; el.infoWhy.appendChild(p); }
  function openInfo(c) {
    const info = safeCall(() => L.inspect(state, c.x, c.y), null);
    if (!info) return;
    render.flash(c.i);
    el.infoTitle.textContent = info.lvl > 0 || info.name !== L.USE_NAMES[info.use] ? info.name : info.use === 0 ? info.terrainName : info.name;
    el.infoList.textContent = "";
    addRow(el.infoList, "とち", info.terrainName);
    const u = info.use;
    if (u === L.USE.HOME) {
      addRow(el.infoList, "ひと", `${L.formatPop(info.people)} にん`);
      gradeRow(el.infoList, "すみやすさ", info.live, true, 45, 70);
      gradeRow(el.infoList, "とちの ねだん", info.land, true, 35, 65);
      addRow(el.infoList, "ひとの おおさ", `${info.dens}（${GRADE[info.dens < 35 ? 0 : info.dens < 65 ? 1 : 2]}）`);
      gradeRow(el.infoList, "よごれ", info.poll, false, 20, 40);
    } else if (u === L.USE.WORK || u === L.USE.SHOP || u === L.USE.NATURE) {
      addRow(el.infoList, "おおきさ", info.lvl ? `${info.lvl} / 3` : "あきち");
      addRow(el.infoList, "しごと", `${L.formatPop(info.jobs)} にん`);
      gradeRow(el.infoList, "よごれ", info.poll, false, 20, 40);
    } else if (u === L.USE.ROAD || u === L.USE.CROSS || u === L.USE.ENTRY || u === L.USE.RAIL) {
      if (u !== L.USE.RAIL) addRow(el.infoList, "こみぐあい", trafficText(info.traffic));
      addRow(el.infoList, "いりぐち", info.connected ? "つながっている" : "つながって いない");
      if (info.blocked) addRow(el.infoList, "おおあめ", "とおれないよ");
    } else {
      gradeRow(el.infoList, "とちの ねだん", info.land, true, 35, 65);
      gradeRow(el.infoList, "よごれ", info.poll, false, 20, 40);
    }
    el.infoWhy.textContent = "";
    if (info.poll >= 40) addTip("よごれが おおいよ。みどりを ちかくに おくと へるよ");
    if (u === L.USE.HOME && info.live < 45) addTip("すみやすさが ひくいよ。みどり・おみせを ちかくに おくと あがるよ");
    if (info.reasons && info.reasons.length) {
      const p = document.createElement("p");
      p.className = "why";
      p.textContent = "そだたない わけ：" + info.reasons.join("／");
      el.infoWhy.appendChild(p);
    }
    openCard("info");
  }
  function openStatus() {
    const s = sumNow();
    if (!s) return;
    el.statusList.textContent = "";
    addRow(el.statusList, "まちの おおきさ", `「${s.rankName}」`);
    if (s.next) addRow(el.statusList, "つぎ", nextText(s));
    addRow(el.statusList, "まいつき はいる", L.formatMoney(s.income));
    addRow(el.statusList, "まいつき でる", L.formatMoney(s.cost));
    addRow(el.statusList, "いちばん おおかった ひと", `${L.formatPop(Math.max(s.bestPop, s.pop))} にん`);
    const rs = safeCall(() => L.starReasons(state), []) || [];
    el.starWhy.textContent = rs.length ? `すみやすさを さげている わけ：${rs.join("・")}` : "すみやすさを さげる ものは いまは ないよ";
    renderTax();
    openCard("status");
  }
  function renderTax() {
    const locked = state.rank < 1;
    el.statusCard.querySelectorAll("[data-tax]").forEach((b) => {
      b.setAttribute("aria-pressed", String(Number(b.dataset.tax) === state.tax));
      b.dataset.locked = locked && b.dataset.tax !== "1" ? "1" : "0";
    });
    el.taxNote.textContent = locked ? `${rankLabel(1)}に なると えらべるよ` : "ひくいと すみやすく、たかいと おかねが ふえるよ";
  }

  // ===== ボタン =====
  function onCommand(cmd, btn) {
    sfx.unlock();
    switch (cmd) {
      case "help": if (!overlay) openHelp(false); break;
      case "help-close": {
        const first = firstTime;
        closeCard();
        if (firstTime || readKey(KEY_SEEN) !== "1") {
          writeKey(KEY_SEEN, "1");
          if (firstTime) { zoomHintLeft = ZOOM_HINT_SEC; el.zoomHint.hidden = false; zoomHintShown = true; firstTime = false; }
        }
        // はじめての町：あそびかたを閉じたら いりぐちへ寄せる（1 マス 22px。UX M2・fun 1）
        if (first && !entryLinked()) goToEntry();
        break;
      }
      case "terrain-cancel": if (state && overlay === "terrain") closeCard(); break;
      case "restart-ask": closeCard(); openCard("restart"); break;
      case "restart-no": closeCard(); break;
      case "restart": closeCard(); queue = []; seed = (seed + 7919) | 0; showTerrain(); break;
      case "reroll": seed = (seed + 3) | 0; showTerrain(); sfx.play("select"); break;
      case "name-ok": {
        const nm = L.normalizeName(el.nameInput.value);
        if (state) { L.rename(state, nm); saveNow(); updateUi(true); }
        closeCard();
        break;
      }
      case "name-cancel": case "close": closeCard(); break;
      case "status": if (!overlay) openStatus(); break;
      case "zoom-in": if (!overlay) { render.zoomBy(1.6); closeZoomHint(); } break;
      case "zoom-out": if (!overlay) { render.zoomBy(1 / 1.6); closeZoomHint(); } break;
      default: break;
    }
  }
  document.addEventListener("click", (ev) => {
    const t = ev.target instanceof Element ? ev.target : null;
    if (!t) return;
    const cmdBtn = t.closest("[data-cmd]");
    if (cmdBtn) { onCommand(cmdBtn.dataset.cmd, cmdBtn); return; }
    const terr = t.closest("[data-terrain]");
    if (terr) { sfx.unlock(); startGame(Number(terr.dataset.terrain)); return; }
    const sp = t.closest("[data-speed]");
    if (sp && state && !overlay) { L.setSpeed(state, Number(sp.dataset.speed)); updateUi(true); scheduleSave(); sfx.play("select"); return; }
    const tl = t.closest("[data-tool]");
    if (tl && !overlay) { selectTool(tl.dataset.tool); return; }
    const tx = t.closest("[data-tax]");
    if (tx && state) {
      if (!L.setTax(state, Number(tx.dataset.tax))) { sfx.play("deny"); setHint(`${rankLabel(1)}に なると えらべるよ`, true, HINT_SEC); }
      else { sfx.play("select"); scheduleSave(); }
      renderTax();
      return;
    }
    if (t.closest("#nameBtn") && state && !overlay) { el.nameInput.value = state.name; openCard("name"); return; }
    if (t.closest("#soundBtn")) { sfx.unlock(); sfx.toggle(); renderSoundBtn(); return; }
  });
  el.nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onCommand("name-ok"); } });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay && (overlay !== "terrain" || state)) { e.preventDefault(); closeCard(); }
  });
  // カードの外（暗い所）を押しても、確かめの要らないカードは閉じる
  for (const id of ["infoCard", "statusCard", "rankCard"]) $(id).addEventListener("click", (e) => { if (e.target === $(id)) closeCard(); });

  // ===== 1 コマ =====
  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (sleeping) return;
    const wall = lastTs ? Math.min(0.25, Math.max(0, (ts - lastTs) / 1000)) : 0;
    lastTs = ts;
    if (state) {
      const running = !overlay && !document.hidden;
      let evs = null;
      if (running) {
        const mo = state.month;
        const t0 = performance.now();
        const res = L.step(state, wall);
        const ms = performance.now() - t0;
        stepTimes.push(ms); if (stepTimes.length > 600) stepTimes.shift();
        if (state.month !== mo) { monthTimes.push(ms); if (monthTimes.length > 60) monthTimes.shift(); }   // 月の終わりの重いコマ
        evs = res.events;
        if (state.speed > 0) saveSince += wall;
        if (evs && evs.length) handleEvents(evs);
      }
      // 見せる物の時間（カードが開いていても進める）
      if (newsLeft > 0) { newsLeft -= wall; if (newsLeft <= 0) { newsLeft = 0; showGoal(sumNow() || { next: null, pop: 0 }); } }
      if (hintLeft > 0) { hintLeft -= wall; if (hintLeft <= 0) { hintLeft = 0; if (hintNext.length) { const rest = hintNext.slice(1); setHint(hintNext[0], false, TIP_SEC); hintNext = rest; } else resetHint(); } }
      if (voiceLeft > 0) { voiceLeft -= wall; if (voiceLeft <= 0) hideVoice(); }
      if (zoomHintLeft > 0) { zoomHintLeft -= wall; if (zoomHintLeft <= 0) closeZoomHint(); }
      uiSince += wall;
      if (uiSince >= UI_EVERY_SEC) { uiSince = 0; updateUi(false); }
      if (saveSoon > 0) { saveSoon -= wall; if (saveSoon <= 0) saveNow(); }
      if (saveSince >= SAVE_EVERY_SEC) saveNow();
      const toRender = pending; pending = [];
      render.frame(state, toRender, wall || 1 / 60);
      // 止まっていて（とめる・カード）変わる物が無いときは rAF を休む。触る・カメラが動く・カードを開け閉めすると起きる（約束 §11。tech A12）
      if (canRest()) { if (++restFrames > 30) { resting = true; stopLoop(); } }
      else restFrames = 0;
    }
  }
  function canRest() {
    if (!state || paint) return false;
    if (!(state.speed === 0 || overlay)) return false;
    if (newsLeft > 0 || hintLeft > 0 || voiceLeft > 0 || zoomHintLeft > 0 || saveSoon > 0 || pending.length) return false;
    return !safeCall(() => render.busy(), true);
  }
  function wakeLoop() {
    restFrames = 0;
    if (!resting) return;
    resting = false;
    if (!sleeping && !document.hidden) startLoop();
  }
  for (const t of ["pointerdown", "pointermove", "wheel", "keydown", "touchstart"]) document.addEventListener(t, wakeLoop, { capture: true, passive: true });
  window.addEventListener("resize", wakeLoop);
  function startLoop() { if (!rafId) { lastTs = 0; render.resetClock(); rafId = requestAnimationFrame(loop); } }
  function stopLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }

  // ===== 中断と再開 =====
  function sleep() {
    if (sleeping) return;
    staleOnHide();
    if (state) saveNow();
    sleeping = true;
    stopLoop();
  }
  function wake() {
    if (!sleeping || document.hidden) return;
    sleeping = false;
    resting = false; restFrames = 0;
    startLoop();
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) sleep(); else if (!reloadIfStale()) wake(); });
  window.addEventListener("pagehide", () => { sleep(); });
  window.addEventListener("pageshow", (e) => { if (reloadIfStale()) return; if (e.persisted || sleeping) wake(); });

  // ===== デバッグの命令（?debug=1。テストも使う） =====
  function install(s) {
    state = s;
    tool = null;
    el.tools.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", "false"));
    render.setState(state);
    resizeMap();
    pending = [];
    resetHint();
    updateUi(true);
  }
  function pct(a, q) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * q))] * 1000) / 1000; }
  function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return Math.round(s[s.length >> 1] * 1000) / 1000; }
  const D = window.YubiDebug;
  if (D && typeof D.command === "function") {
    safeCall(() => {
      D.command("stats", () => ({
        summary: sumNow(), render: render.stats(), camera: render.camera(),
        stepMsMed: median(stepTimes), stepMsP95: pct(stepTimes, 0.95), stepMsMax: Math.round(Math.max(0, ...stepTimes) * 1000) / 1000,
        monthMsMed: median(monthTimes), monthMsMax: Math.round(Math.max(0, ...monthTimes) * 1000) / 1000, monthN: monthTimes.length, steps: stepTimes.length,
        saved: savedCount, overlay, tool, resting
      }), { desc: "いまの町・描画（コマの間隔）・step の ms（中央・p95・最大・月の終わり）", args: "なし" });
      D.command("addmoney", (a) => { if (!state) throw new Error("まだ はじまっていない"); state.money = Math.max(L.MONEY_MIN, Math.min(L.MONEY_MAX, state.money + Math.floor(Number(a && a.n) || 0))); updateUi(true); return { money: state.money }; },
        { desc: "お金を足す", args: "{ n }" });
      D.command("skip", (a) => {
        if (!state) throw new Error("まだ はじまっていない");
        const months = Math.max(0, Math.min(1200, Math.floor(Number(a && a.months) || 0)));
        const sp = state.speed;
        if (!sp) state.speed = 1;
        silent++;
        try {
          for (let m = 0; m < months; m++) for (let t = 0; t < L.TICKS_PER_MONTH; t++) { const r = L.step(state, L.TICK_SEC); handleEvents(r.events, true); }
        } finally { silent--; state.speed = sp; }
        updateUi(true); scheduleSave();
        return { month: state.month, pop: state.pop };
      }, { desc: "月を進める", args: "{ months }" });
      D.command("setspeed", (a) => { if (!state || !L.setSpeed(state, Number(a && a.s))) throw new Error("速さは 0・1・4"); updateUi(true); return { speed: state.speed }; }, { desc: "速さ", args: "{ s }" });
      D.command("event", (a) => { if (!state) throw new Error("まだ はじまっていない"); const ev = L.startEvent(state, String(a && a.kind)); if (!ev) throw new Error("起こせなかった"); handleEvents(ev); return ev.map((e) => e.kind); }, { desc: "できごとを起こす", args: "{ kind }" });
      D.command("voice", (a) => {
        if (!state) throw new Error("まだ はじまっていない");
        const v = (a && a.text) ? null : L.voiceOf(state);
        const why = (a && a.why) || (v && v.why) || "happy";
        const text = (a && a.text) || (v && v.text) || (L.VOICES && L.VOICES[why]) || "この まち すきだな";
        const i = a && Number.isInteger(a.i) ? a.i : v && v.why === why ? v.i : -1;
        showVoice({ why, text, i, good: a && a.good !== undefined ? !!a.good : why === "happy" || why === "happyGreen" });
        return { why, i, text };
      }, { desc: "市民の声を出す", args: "{ why, text?, i?, good? }" });
      D.command("demo", (a) => {
        const months = Math.max(1, Math.min(1200, Math.floor(Number(a && a.months) || 240)));
        const rep = L.simulate(Number(a && a.seed) || 1, (a && a.policy) || "greedy", months, { choice: Number(a && a.choice) || 0 });
        if (!rep || !rep.state) throw new Error("作れなかった");
        install(rep.state); saveNow();
        return { pop: rep.pop, month: rep.state.month };
      }, { desc: "自動で町を作って読み込む（性能のテスト用）", args: "{ months, seed, policy, choice }" });
      D.command("setstate", (a) => {
        const raw = a && (typeof a.save === "string" ? a.save : JSON.stringify(a.save));
        const s = raw ? L.loadSave(raw) : null;
        if (!s) throw new Error("読めない保存");
        install(s); saveNow();
        return { pop: s.pop };
      }, { desc: "保存の文字（または object）を読み込む", args: "{ save }" });
    }, null);
  }

  // ===== 起動 =====
  (function boot() {
    const raw = readKey(KEY_SAVE);
    const loaded = raw === null ? null : safeCall(() => L.loadSave(raw), null);
    if (loaded) {
      seed = loaded.seed | 0;
      state = loaded;
      writeBest(state.bestPop | 0);
      render.setState(state);
      resizeMap();
      updateUi(true);
      const seen = readKey(KEY_SEEN) === "1";
      if (!seen) { firstTime = true; openHelp(true); }
    } else {
      if (raw !== null) {
        // 読めない・新しい版の保存：元を bak へ写してから新しく始める（写せなければ上書きしない＝元を消さない）
        if (!keepBroken(raw)) saveBlocked = true;
        setNews("ほぞんが よめなかったので、はじめから つくるよ", 8);
      }
      resetHint();
      showTerrain();
    }
    if (!state) { el.dateText.textContent = L.dateText(0); }
    startLoop();
    if (document.hidden) sleep();
  })();

  // テスト・デバッグ用（読むだけ）
  window.__machi = { get state() { return state; }, get overlay() { return overlay; }, get tool() { return tool; }, get resting() { return resting; }, render, saveNow };
})();

// オフラインでも遊べるようにする（https か localhost のときだけ有効）
if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("../../sw.js").catch(() => { /* 登録できなくてもゲームは遊べる */ });
  });
}
