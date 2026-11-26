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
  const KEY_SAVE = "machi.save", KEY_BAK = "machi.bak", KEY_BEST = "machi.best", KEY_SEEN = "machi.seen";
  const SAVE_EVERY_SEC = 15, SAVE_SOON_SEC = 2, UI_EVERY_SEC = 0.2;
  const NEWS_SEC = 10, VOICE_SEC = 8, HINT_SEC = 3, ZOOM_HINT_SEC = 10;
  const DEFAULT_HINT = "おくものを えらんで、マスを タップ";

  function safeCall(fn, fallback) { try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { console.error(NAME + ":", e); return fallback; } }
  if (!L || !R || !I) { console.error(NAME + ": 部品（logic.js・render.js・input.js）が読み込まれていません"); return; }

  const el = {
    app: $("app"), back: $("backBtn"), nameBtn: $("nameBtn"), soundBtn: $("soundBtn"),
    moneyText: $("moneyText"), popText: $("popText"), starText: $("starText"), newsText: $("newsText"), dateText: $("dateText"),
    wrap: $("mapWrap"), canvas: $("mapCanvas"), viewBtn: $("viewBtn"), speedBtns: $("speedBtns"), zoomHint: $("zoomHint"),
    voiceBar: $("voiceBar"), voiceFace: $("voiceFace"), voiceText: $("voiceText"),
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
  const stepTimes = [];
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
      b.setAttribute("aria-label", locked ? `${T.name}（${L.RANKS[T.rank].name} に なると つかえる）` : T ? T.name : "");
    });
    if (!newsLeft) showGoal(s);
  }
  function toolDef(id) { for (const t of L.TOOLS) if (t.id === id) return t; return null; }
  function setNews(text, sec) {
    if (!text) return;
    newsLeft = sec || NEWS_SEC;
    if (el.newsText.textContent !== text) el.newsText.textContent = text;
    ui.news = text;
  }
  function showGoal(s) {
    let t;
    if (s.next) {
      if (s.pop === 0 && state.month < 2) t = "みちを ひいて、そばに すむ を おこう";
      else t = `${s.next}まで あと ${L.formatPop(Math.max(0, s.nextPop - s.pop))} にん`;
    } else t = "だいとしに なったよ！ すきに そだてよう";
    if (el.newsText.textContent !== t) el.newsText.textContent = t;
    ui.news = t;
  }
  function setHint(text, warn, sec) {
    el.toolHint.textContent = text;
    el.toolHint.dataset.warn = warn ? "1" : "0";
    hintLeft = text === DEFAULT_HINT || !sec ? (warn ? HINT_SEC : 0) : sec;
  }
  function toolHintText(t) {
    const T = toolDef(t);
    if (!T) return DEFAULT_HINT;
    if (t === "erase") return "こわす 1 マス 5 から（おいて すぐなら ぜんぶ もどる）";
    if (t === "road") return `みち 1 マス ${T.cost}（はし ${T.bridgeCost}）`;
    if (t === "rail") return `せんろ 1 マス ${T.cost}（はし ${T.bridgeCost}）`;
    if (t === "nature") return `めぐみ 1 マス ${T.cost}（おく ばしょで はたけ・りんぎょう・ぎょこう）`;
    return `${T.name} 1 マス ${T.cost}`;
  }
  function resetHint() { setHint(toolHintText(tool), false, 0); }

  // ===== 道具 =====
  function selectTool(id) {
    if (!state) return;
    const T = toolDef(id);
    if (!T) return;
    if (T.rank > state.rank) {
      setHint(`${L.RANKS[T.rank].name} に なると つかえるよ`, true, HINT_SEC);
      sfx.play("deny");
      return;
    }
    tool = tool === id ? null : id;
    el.tools.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === tool)));
    cancelPaint();
    resetHint();
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
  const dprNow = () => Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const render = safeCall(() => R.create(el.canvas, { cssW: el.wrap.clientWidth || 300, cssH: el.wrap.clientHeight || 300, dpr: dprNow() }), null);
  if (!render) { console.error(NAME + ": 描画を始められません"); return; }
  function resizeMap() {
    const w = el.wrap.clientWidth, h = el.wrap.clientHeight;
    if (w > 0 && h > 0) render.resize(w, h, dprNow());
  }
  if (window.ResizeObserver) new ResizeObserver(resizeMap).observe(el.wrap);
  window.addEventListener("resize", resizeMap);
  window.addEventListener("orientationchange", () => setTimeout(resizeMap, 200));

  // ===== カード =====
  const CARDS = {
    terrain: { box: () => el.terrainCard, primary: () => el.terrainCard.querySelector('[data-terrain="0"]') },
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
  }
  function closeCard() {
    if (!overlay) return;
    const C = CARDS[overlay];
    if (C) C.box().hidden = true;
    overlay = null;
    delete document.body.dataset.card;
    lastTs = 0;                                  // カードが開いていた間の時間を足さない
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
    newsLeft = 0; hideVoice();
    el.terrainCard.hidden = true; overlay = null; delete document.body.dataset.card;
    saveNow();
    updateUi(true);
    sfx.play("start");
    const seen = safeCall(() => readKey(KEY_SEEN) === "1", false);
    if (!seen) { firstTime = true; openCard("help"); }
    else openQueued();
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
    entry: "いりぐちは こわせないよ", empty: "なにも ないよ"
  };
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
          setHint(DENY[e.reason] || "ここには おけないよ", true, HINT_SEC);
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
    const list = (e.unlocks || []).map((u) => UNLOCK_TEXT[u] || u);
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
    el.voiceBar.dataset.good = e.good ? "1" : "0";
    el.voiceBar.dataset.why = e.why || "";
    el.voiceBar.setAttribute("aria-label", voiceI >= 0 ? `${e.text}。おすと その ばしょへ いくよ` : e.text);
    el.voiceBar.hidden = false;
    sfx.play("voice", !!e.good);
  }
  function hideVoice() { voiceLeft = 0; voiceI = -1; el.voiceBar.hidden = true; }
  el.voiceBar.addEventListener("click", () => {
    if (voiceI >= 0) { render.focus(voiceI); voiceLeft = VOICE_SEC; }
    else hideVoice();
  });

  // ===== めがね =====
  const VIEWS = [["normal", "ふつう"], ["poll", "よごれ"], ["jam", "こんざつ"], ["live", "すみやすさ"], ["land", "とちの ねだん"]];
  let viewIdx = 0;
  function renderViewBtn() {
    const [, nm] = VIEWS[viewIdx];
    el.viewBtn.textContent = `みかた：${nm}`;
    el.viewBtn.dataset.on = viewIdx ? "1" : "0";
  }
  el.viewBtn.addEventListener("click", () => {
    viewIdx = (viewIdx + 1) % VIEWS.length;
    render.setView(VIEWS[viewIdx][0]);
    renderViewBtn();
    sfx.play("select");
  });

  // ===== 指（MachiInput） =====
  let paint = null;           // { a, cells, ok } なぞっている間
  function cancelPaint() { if (paint) { paint = null; render.setPreview(null); } }
  const NATURE = ["", "はたけ", "りんぎょう", "ぎょこう"];
  function paintCells(a, b) {
    return tool === "road" || tool === "rail" ? L.lineCells(a.x, a.y, b.x, b.y) : L.rectCells(a.x, a.y, b.x, b.y);
  }
  function makePreview(cells) {
    const T = toolDef(tool);
    let n = 0, cost = 0, nature = 0, why = null;
    for (const i of cells) {
      const r = L.canPlace(state, tool, i % L.W, (i / L.W) | 0);
      if (r.ok) { n++; cost += r.cost; if (!nature && r.natureKind) nature = r.natureKind; }
      else if (!why) why = r.reason;
    }
    const short = state.money >= 0 && cost > state.money;
    const ok = n > 0 && !short;
    // 値段は render が札の終わりに足すので、label には入れない（文だけの札のときは cost を渡さない）
    let label, shown;
    if (!n) label = DENY[why] || "ここには おけないよ";
    else if (short) label = "おかねが たりないよ";
    else { label = cost < 0 ? `もどす ${n}マス` : `${tool === "nature" && nature ? NATURE[nature] : T.name} ${n}マス`; shown = Math.abs(cost); }
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
    const res = safeCall(() => L.place(state, t, cells), null);
    if (!res) return;
    handleEvents(res.events);
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
          render.zoomTo(px, py, 22);
          setHint("ちかくで おいてね", false, HINT_SEC);
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
      addRow(el.infoList, "すみやすさ", `${info.live} / 100`);
      addRow(el.infoList, "とちの ねだん", `${info.land}`);
      addRow(el.infoList, "ひとの おおさ", `${info.dens}`);
      addRow(el.infoList, "よごれ", `${info.poll}`);
    } else if (u === L.USE.WORK || u === L.USE.SHOP || u === L.USE.NATURE) {
      addRow(el.infoList, "おおきさ", info.lvl ? `${info.lvl} / 3` : "あきち");
      addRow(el.infoList, "しごと", `${L.formatPop(info.jobs)} にん`);
      addRow(el.infoList, "よごれ", `${info.poll}`);
    } else if (u === L.USE.ROAD || u === L.USE.CROSS || u === L.USE.ENTRY || u === L.USE.RAIL) {
      if (u !== L.USE.RAIL) addRow(el.infoList, "こみぐあい", trafficText(info.traffic));
      addRow(el.infoList, "いりぐち", info.connected ? "つながっている" : "つながって いない");
      if (info.blocked) addRow(el.infoList, "おおあめ", "とおれないよ");
    } else {
      addRow(el.infoList, "とちの ねだん", `${info.land}`);
      addRow(el.infoList, "よごれ", `${info.poll}`);
    }
    el.infoWhy.textContent = "";
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
    addRow(el.statusList, "まちの ランク", `${s.rankName}${s.next ? `（${s.next}まで あと ${L.formatPop(Math.max(0, s.nextPop - s.pop))} にん）` : ""}`);
    addRow(el.statusList, "まいつき はいる", L.formatMoney(s.income));
    addRow(el.statusList, "まいつき でる", L.formatMoney(s.cost));
    addRow(el.statusList, "さいだいの ひと", `${L.formatPop(Math.max(s.bestPop, s.pop))} にん`);
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
    el.taxNote.textContent = locked ? "まちに なると えらべるよ" : "ひくいと すみやすく、たかいと おかねが ふえるよ";
  }

  // ===== ボタン =====
  function onCommand(cmd, btn) {
    sfx.unlock();
    switch (cmd) {
      case "help": if (!overlay) openCard("help"); break;
      case "help-close":
        closeCard();
        if (firstTime || readKey(KEY_SEEN) !== "1") {
          writeKey(KEY_SEEN, "1");
          if (firstTime) { zoomHintLeft = ZOOM_HINT_SEC; el.zoomHint.hidden = false; zoomHintShown = true; firstTime = false; }
        }
        break;
      case "restart-ask": closeCard(); openCard("restart"); break;
      case "restart-no": closeCard(); break;
      case "restart": closeCard(); seed = (seed + 7919) | 0; showTerrain(); break;
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
      if (!L.setTax(state, Number(tx.dataset.tax))) { sfx.play("deny"); setHint("まちに なると えらべるよ", true, HINT_SEC); }
      else { sfx.play("select"); scheduleSave(); }
      renderTax();
      return;
    }
    if (t.closest("#nameBtn") && state && !overlay) { el.nameInput.value = state.name; openCard("name"); return; }
    if (t.closest("#soundBtn")) { sfx.unlock(); sfx.toggle(); renderSoundBtn(); return; }
  });
  el.nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onCommand("name-ok"); } });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay && overlay !== "terrain") { e.preventDefault(); closeCard(); }
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
        const t0 = performance.now();
        const res = L.step(state, wall);
        const ms = performance.now() - t0;
        stepTimes.push(ms); if (stepTimes.length > 240) stepTimes.shift();
        evs = res.events;
        if (state.speed > 0) saveSince += wall;
        if (evs && evs.length) handleEvents(evs);
      }
      // 見せる物の時間（カードが開いていても進める）
      if (newsLeft > 0) { newsLeft -= wall; if (newsLeft <= 0) { newsLeft = 0; showGoal(sumNow() || { next: null, pop: 0 }); } }
      if (hintLeft > 0) { hintLeft -= wall; if (hintLeft <= 0) { hintLeft = 0; resetHint(); } }
      if (voiceLeft > 0) { voiceLeft -= wall; if (voiceLeft <= 0) hideVoice(); }
      if (zoomHintLeft > 0) { zoomHintLeft -= wall; if (zoomHintLeft <= 0) closeZoomHint(); }
      uiSince += wall;
      if (uiSince >= UI_EVERY_SEC) { uiSince = 0; updateUi(false); }
      if (saveSoon > 0) { saveSoon -= wall; if (saveSoon <= 0) saveNow(); }
      if (saveSince >= SAVE_EVERY_SEC) saveNow();
      const toRender = pending; pending = [];
      render.frame(state, toRender, wall || 1 / 60);
    }
  }
  function startLoop() { if (!rafId) { lastTs = 0; rafId = requestAnimationFrame(loop); } }
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
  function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return Math.round(s[s.length >> 1] * 1000) / 1000; }
  const D = window.YubiDebug;
  if (D && typeof D.command === "function") {
    safeCall(() => {
      D.command("stats", () => ({ summary: sumNow(), render: render.stats(), camera: render.camera(), stepMsMed: median(stepTimes), stepMsMax: Math.round(Math.max(0, ...stepTimes) * 1000) / 1000, saved: savedCount, overlay, tool }),
        { desc: "いまの町・描画・step の ms", args: "なし" });
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
      if (!seen) { firstTime = true; openCard("help"); }
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
  window.__machi = { get state() { return state; }, get overlay() { return overlay; }, get tool() { return tool; }, render, saveNow };
})();

// オフラインでも遊べるようにする（https か localhost のときだけ有効）
if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("../../sw.js").catch(() => { /* 登録できなくてもゲームは遊べる */ });
  });
}
