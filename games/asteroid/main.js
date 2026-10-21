/*
 * ちきゅうを守れ！ほしくだき — 進行・入力・保存（担当C）
 * 契約：docs/asteroid-contract.md §7（進行・入力・テスト用 API・デバッグ命令）・§8（保存）・§5（DOM）・§13（教訓）
 * 読み込み順：../../common/sfx.js → logic.js → render.js → main.js
 *
 * - 時間：rAF ごとに差を取り 0.1 秒で頭打ち、STEP（1/30 秒）ずつ step（1 フレームに最大 3 回。足りない分は捨てる）。
 * - 閉じている間は止まる（ユーザー決定「止まる」）：hidden → 保存して rAF を止める。visible → そのまま続き（実際の時計は使わない）。
 * - 遊び方・2択・エンディングのカードが出ている間も進まない。
 * - 場（#field・#fieldCanvas）には押す処理を付けない（ユーザー決定「なにもしない」）。
 * - 画面の数はロジックの関数（formatKakera・upCostOf・slotCostOf・progressOf・dpsOf）の値そのまま（§13-1）。
 * - タイマーは later / clearLater だけ（setTimeout を直接呼ばない）。
 * - 保存は logic の makeSave の形に、main だけが読む欄を 2 つ足して書く（loadSave は知らない欄を読まない）：
 *     t      … 遊んだ秒（エンディングの「あそんだ じかん」用。星の途中の位置は保存しない）
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
  const HINT_RETRY = "ひかっている ぶきを つよくして もういちど！";
  const HINT_BLOCKED = "ほぞんが できないよ（このまま あそべるよ）";

  const $ = (id) => document.getElementById(id);
  const body = document.body;
  function safeCall(fn, fallback) { try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { console.error("ほしくだき:", e); return fallback; } }
  const now = () => (window.performance && performance.now ? performance.now() : Date.now());

  const el = {
    back: $("back"), title: $("gameTitle"), helpBtn: $("helpBtn"), soundBtn: $("soundBtn"),
    kakera: $("kakera"), starLabel: $("starLabel"), starTag: $("starTag"), starBar: $("starBar"), starFill: $("starFill"),
    field: $("field"), canvas: $("fieldCanvas"), distance: $("distance"), distanceFill: $("distanceFill"),
    weapons: $("weapons"), unlockBtn: $("unlockBtn"),
    choiceCard: $("choiceCard"), choiceA: $("choiceA"), choiceB: $("choiceB"),
    bounceBanner: $("bounceBanner"), clearBanner: $("clearBanner"), bossBanner: $("bossBanner"),
    endCard: $("endCard"), endText: $("endText"), endStats: $("endStats"), endOk: $("endOk"),
    help: $("help"), helpOk: $("helpOk"), hint: $("hint")
  };
  const part = (node, name) => (node ? node.querySelector('[data-part="' + name + '"]') : null);
  const rows = [0, 1, 2, 3].map((k) => {
    const row = document.querySelector('.wrow[data-slot="' + k + '"]');
    const btn = row ? row.querySelector("[data-up]") : null;
    return {
      row, btn,
      name: part(row, "name"), lv: part(row, "lv"), good: part(row, "good"), dps: part(row, "dps"), note: part(row, "note"),
      label: part(btn, "label"), cost: part(btn, "cost")
    };
  });
  const barPct = document.querySelector(".barrow [data-part=pct]");
  const missing = ["kakera", "starLabel", "starBar", "canvas", "unlockBtn", "choiceCard"].filter((k) => !el[k]);
  if (missing.length) console.error("ほしくだき: 画面の部品が見つかりません：" + missing.join(", "));

  // 題名（申し送り1：同じなら書き換えない＝ <span> と <wbr> を残す）
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
    el.soundBtn.setAttribute("aria-label", sfx.on ? "こうかおん：オン" : "こうかおん：オフ");
  }
  function toggleSound() { sfx.unlock(); sfx.toggle(); renderSoundBtn(); }
  renderSoundBtn();

  // ===== 保存の読み書き（できなくても遊べる） =====
  function readKey(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeKey(key, val) { try { localStorage.setItem(key, val); return true; } catch (e) { return false; } }

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
  let overlay = null;          // null | 'help' | 'choose' | 'end'
  let sleeping = false;
  let rafId = 0, lastT = null, acc = 0;
  let pendingEvents = [];      // ボタンで起きた出来事（upgrade の evolve）。次のフレームで render に渡す
  let saveCount = 0, saveBlocked = false, saveSince = 0, saveFailTold = false;
  let best = 0;
  let hintTimer = 0, cardUnlockTimer = 0, cardShownAt = -Infinity, focusBack = null;
  let bossUntil = -1;          // ロジックの時計（state.t）でこの秒まで #bossBanner
  let suggestSlot = -1;        // はね返しのあとに光らせる行
  let phaseShown = "";

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
      isStub: true, layout() {}, frame() { frames += 1; }, burst() {}, setCalm(b) { c = !!b; }, pause() {}, resume() {},
      stats() { return { particles: 0, shots: 0, frames, slowFrames: 0, rockRedraws: 0, calm: c }; }
    };
  }
  function R_call(name, ...a) { const f = render && render[name]; if (typeof f !== "function") return undefined; return safeCall(() => f.apply(render, a), undefined); }
  function onCalmChange() { calm = !!reduceMotion.matches; applyCalm(); }
  if (reduceMotion.addEventListener) reduceMotion.addEventListener("change", onCalmChange);
  else if (reduceMotion.addListener) reduceMotion.addListener(onCalmChange);
  applyCalm();

  // ===== 保存（§8） =====
  function saveNow() {
    if (!state) return false;
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
  // 読めない保存の元を bak へ写す（bak が既にあれば上書きしない＝最初の壊れた保存を残す。§8.3）
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
  // logic の state を、保存と同じ検証に通して「その星の最初」にする
  function normalize(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    let raw;
    try { raw = JSON.stringify(Object.assign({}, obj, { v: L.SAVE_VERSION || 1, rock: undefined, shots: undefined, burns: undefined })); } catch (e) { return null; }
    const s = safeCall(() => L.loadSave(raw), null);
    if (!s) return null;
    const t = Number(obj.t);
    if (Number.isFinite(t) && t >= 0) s.t = Math.min(t, 1e10);
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
  const wName = (id) => (WEAPON[id] && WEAPON[id].name) || id;
  function goodHtml(id, withText) {
    const g = WEAPON[id] && WEAPON[id].good;
    if (!g) return "";
    const n = MAT_NAME[g] || g;
    return '<i class="mat" data-mat="' + g + '"></i>' + n + (withText ? "に つよい" : "");
  }

  // ===== 進め方（§7.1） =====
  function phaseNow() {
    if (sleeping) return "paused";
    if (overlay === "help") return "paused";
    return state ? state.phase : "fly";
  }
  function syncPhase() {
    const p = phaseNow();
    if (p !== phaseShown) { phaseShown = p; body.dataset.phase = p; }
  }
  const running = () => !sleeping && overlay !== "help" && overlay !== "end";

  function stepOnce(dt, collect) {
    const r = safeCall(() => L.step(state, dt), null);
    if (!r || !r.state) return;
    state = r.state;
    const evs = Array.isArray(r.events) ? r.events : [];
    if (evs.length) {
      handleEvents(evs);
      if (collect) for (const e of evs) collect.push(e);
    }
    if (state.phase === "fly") saveSince += dt;
  }
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
    const events = pendingEvents;
    pendingEvents = [];
    if (running()) {
      acc += dt;
      let n = 0;
      while (acc >= STEP - 1e-9 && n < MAX_STEPS_PER_FRAME) { stepOnce(STEP, events); acc -= STEP; n += 1; }
      if (n >= MAX_STEPS_PER_FRAME && acc >= STEP) acc = 0;   // 重い端末で早送りしない（足りない分は捨てる）
      if (saveSince >= SAVE_EVERY_SEC) saveNow();
    } else acc = 0;
    R_call("frame", state, events, dt);
    updateUi();
    ensureLoop();
  }

  // ===== 出来事（音・帯・保存） =====
  function handleEvents(evs) {
    let saveAfter = false;
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
          setText(part(banner, "sub"), (e.bonus | 0) > 0 ? "＋" + fmt(e.bonus) + "かけら" : "");
          suggestSlot = -1;
          saveAfter = true;
          break;
        }
        case "bounce": {
          sfx.play("bounce");
          const broken = Number(e.broken) || 0;
          const leftPct = Math.max(1, Math.round((1 - broken) * 100));
          setText(part(el.bounceBanner, "main"), "バリアで はねかえした！");
          setText(part(el.bounceBanner, "sub"), "あと " + leftPct + "% だった");
          suggestSlot = cheapestSlot();
          if (!silent) setHint(HINT_RETRY, 4000);
          saveAfter = true;
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
    let best = -1, bc = Infinity;
    for (let k = 0; k < state.slots.length; k++) {
      const c = safeCall(() => L.upCostOf(state, k), null);
      if (typeof c === "number" && c < bc) { bc = c; best = k; }
    }
    return best;
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
    if (lastUi.near !== near) {
      lastUi.near = near;
      setAttr(el.distance, "aria-valuenow", String(near));
      if (el.distanceFill) el.distanceFill.style.height = near + "%";
      setAttr(el.distance, "data-near", near >= 80 && s.phase === "fly" ? "1" : null);
    }
    // 帯（ロジックの phase と時計で出す＝advance でも止まっていても正しい）
    setHidden(el.bounceBanner, s.phase !== "bounce");
    setHidden(el.clearBanner, s.phase !== "clear");
    setHidden(el.bossBanner, !(s.phase === "fly" && s.t < bossUntil));
    // 武器の行
    for (let k = 0; k < rows.length; k++) updateRow(k);
    // あたらしい ぶき
    const sc = safeCall(() => L.slotCostOf(s), null);
    if (el.unlockBtn) {
      setHidden(el.unlockBtn, sc === null);
      if (sc !== null) {
        setText(part(el.unlockBtn, "cost"), fmt(sc));
        const can = s.kakera >= sc && s.phase !== "choose";
        setAttr(el.unlockBtn, "aria-disabled", can ? null : "true");
        setAttr(el.unlockBtn, "aria-label", "あたらしい ぶき " + fmt(sc) + "かけら" + (s.kakera >= sc ? "" : "（かけらが たりないよ）"));
      }
    }
  }
  function updateRow(k) {
    const r = rows[k];
    if (!r.row) return;
    const x = state.slots[k];
    setHidden(r.row, !x);
    if (!x) { setAttr(r.row, "data-suggest", null); return; }
    setAttr(r.row, "data-w", x.id);
    setText(r.name, wName(x.id));
    setText(r.lv, "Lv" + x.lv);
    const dps = safeCall(() => L.dpsOf(state, k), null);
    setText(r.dps, "1びょうに " + (dps === null ? "-" : dps));
    const gh = goodHtml(x.id, false);
    if (r.good && r.good.innerHTML !== gh) r.good.innerHTML = gh;
    let note = "";
    if (x.lv < EVOLVE_LAST) {
      const next = (Math.floor(x.lv / EVOLVE_EVERY) + 1) * EVOLVE_EVERY;
      if (next - x.lv <= EVOLVE_NOTE) note = "しんか まで あと " + (next - x.lv);
    }
    setText(r.note, note);
    setHidden(r.note, !note);
    const cost = safeCall(() => L.upCostOf(state, k), null);
    if (cost === null) {
      setAttr(r.btn, "data-max", "1");
      setAttr(r.btn, "aria-disabled", "true");
      setText(r.label, "さいだい");
      setText(r.cost, "");
      setAttr(r.btn, "aria-label", wName(x.id) + "は さいだい");
    } else {
      setAttr(r.btn, "data-max", null);
      const can = state.kakera >= cost;
      setAttr(r.btn, "aria-disabled", can ? null : "true");
      setText(r.label, can ? "つよくする" : "かけらが たりないよ");
      setText(r.cost, fmt(cost));
      setAttr(r.btn, "aria-label", wName(x.id) + "を つよくする " + fmt(cost) + "かけら" + (can ? "" : "（かけらが たりないよ）"));
    }
    setAttr(r.row, "data-suggest", k === suggestSlot ? "1" : null);
  }

  // ===== 操作（§7.2） =====
  function doUpgrade(slot, btn) {
    if (!state || overlay) return { ok: false, reason: "card" };
    const k = Math.floor(Number(slot));
    if (!(k >= 0 && k < state.slots.length)) return { ok: false, reason: "slot" };
    const r = safeCall(() => L.upgrade(state, k), null);
    if (!r) return { ok: false, reason: "error" };
    if (r.ok) {
      state = r.state;
      const evs = Array.isArray(r.events) ? r.events : [];
      const evolved = evs.some((e) => e && e.kind === "evolve");
      for (const e of evs) pendingEvents.push(e);   // しんかの大きな演出は render が events から出す（二重にしない）
      R_call("burst", "up");
      if (evolved) { sfx.play("evolve"); pulseClass(rows[k].row, "evolve", 1400); }
      else { sfx.play("up"); pulseClass(rows[k].row, "flash", 900); }
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
    const id = state.offer ? state.offer[k] : null;
    const r = safeCall(() => L.choose(state, k), null);
    if (!r || !r.ok) return { ok: false, reason: "choose" };
    state = r.state;
    closeCard("choose");
    sfx.play("unlock");
    R_call("burst", "unlock");
    const slot = state.slots.length - 1;
    pulseClass(rows[slot] && rows[slot].row, "flash", 900);
    setHint(wName(id) + "が なかまに なった！");
    saveNow();
    updateUi();
    return { ok: true, id, slot };
  }

  // ===== カード（§5.3。出た直後 400ms は押せない） =====
  const CARDS = {
    help: { box: () => el.help, primary: () => el.helpOk },
    choose: { box: () => el.choiceCard, primary: () => el.choiceA },
    end: { box: () => el.endCard, primary: () => el.endOk }
  };
  function fillCard(kind) {
    if (kind === "choose" && state && state.offer) {
      [el.choiceA, el.choiceB].forEach((btn, k) => {
        if (!btn) return;
        const id = state.offer[k];
        const w = WEAPON[id] || {};
        btn.dataset.w = id;
        setText(part(btn, "name"), wName(id));
        setText(part(btn, "desc"), w.desc || "");
        const g = part(btn, "good");
        const gh = goodHtml(id, true);
        if (g) { if (g.innerHTML !== gh) g.innerHTML = gh; g.hidden = !gh; }
        btn.setAttribute("aria-label", wName(id) + "。" + (w.desc || "") + (w.good ? "。" + (MAT_NAME[w.good] || w.good) + "に つよい" : ""));
      });
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
  // カードの間は裏（？・♪・場・武器の行）に Tab で移れないようにする。a#back だけは例外でいつでも押せる（T7）
  const BACK_PARTS = [el.helpBtn, el.soundBtn, el.field, el.weapons, document.querySelector(".info"), document.querySelector(".barrow")];
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
    if (overlay) { queued = null; return; }   // 2択・エンディングの上には出さない（? は隠れている）
    openCard("help");
  }
  function closeHelp() {
    if (overlay !== "help" || cardLocked()) return;
    writeKey(KEY_HELP, "1");
    closeCard("help");
  }
  function endOk() {
    if (overlay !== "end" || cardLocked()) return;
    // 「このまま あそぶ」：星 31 の最初から（logic の説明どおり loadSave(makeSave(state))）
    const t = state.t;
    const s = safeCall(() => L.loadSave(L.makeSave(state)), null);
    if (s) { s.t = t; state = s; }
    closeCard("end");
    sfx.play("start");
    setHint("ほし " + state.star + " から つづけるよ");
    saveNow();
    updateUi();
  }

  // ===== 入力の登録（場には付けない） =====
  rows.forEach((r, k) => { if (r.btn) r.btn.addEventListener("click", () => { sfx.unlock(); doUpgrade(k, r.btn); }); });
  if (el.unlockBtn) el.unlockBtn.addEventListener("click", () => { sfx.unlock(); doUnlock(); });
  if (el.choiceA) el.choiceA.addEventListener("click", () => doChoose(0, true));
  if (el.choiceB) el.choiceB.addEventListener("click", () => doChoose(1, true));
  if (el.helpBtn) el.helpBtn.addEventListener("click", () => { sfx.unlock(); showHelp(); });
  if (el.helpOk) el.helpOk.addEventListener("click", closeHelp);
  if (el.endOk) el.endOk.addEventListener("click", endOk);
  if (el.soundBtn) el.soundBtn.addEventListener("click", toggleSound);
  if (el.back) el.back.addEventListener("click", () => { saveNow(); clearLater(); });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const key = e.key;
    if (overlay === "choose") {
      if (key === "ArrowLeft" || key === "a" || key === "A") { e.preventDefault(); doChoose(0, true); }
      else if (key === "ArrowRight" || key === "b" || key === "B") { e.preventDefault(); doChoose(1, true); }
      return;
    }
    if (overlay === "help") { if (key === "Escape" || key === "?") { e.preventDefault(); closeHelp(); } return; }
    if (overlay) return;
    if (key >= "1" && key <= "4") { e.preventDefault(); const k = Number(key) - 1; doUpgrade(k, rows[k] && rows[k].btn); }
    else if (key === "u" || key === "U") { e.preventDefault(); doUnlock(); }
    else if (key === "?") { e.preventDefault(); showHelp(); }
    else if (key === "m" || key === "M") { e.preventDefault(); toggleSound(); }
  });

  // ===== 中断と再開（ユーザー決定「止まる」） =====
  function sleep() {
    if (sleeping) return;
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
    document.querySelectorAll(".shake, .wrow.flash, .wrow.evolve").forEach((b) => b.classList.remove("shake", "flash", "evolve"));
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) sleep(); else wake(); });
  window.addEventListener("pagehide", () => { sleep(); clearLater(); });
  window.addEventListener("pageshow", (e) => { if (e.persisted || sleeping) wake(); });

  // ===== テスト用の公開 API（§7.3） =====
  function snapshot() {
    const s = state || {};
    const st = safeCall(() => render.stats(), {}) || {};
    return {
      phase: phaseNow(), star: s.star | 0, kakera: Number(s.kakera) || 0,
      slots: Array.isArray(s.slots) ? s.slots.map((x) => ({ id: x.id, lv: x.lv })) : [],
      offer: s.offer ? s.offer.slice() : null,
      progress: state ? safeCall(() => L.progressOf(state), null) : null,
      overlay, particles: st.particles | 0, shots: Array.isArray(s.shots) ? s.shots.length : 0,
      frames: st.frames | 0, slowFrames: st.slowFrames | 0, rockRedraws: st.rockRedraws | 0,
      saveCount, calm, timers: timers.size,
      // ここから下は契約に足したもの（テスト・デバッグ用）
      logicPhase: s.phase || null, t: Number(s.t) || 0, tries: s.tries | 0, cleared: !!s.cleared, best, sleeping,
      hint: el.hint ? el.hint.textContent : "", suggest: suggestSlot, totals: s.totals ? Object.assign({}, s.totals) : null,
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
  // テスト用：logic の state の形をそのまま入れる。星・かけら・武器などは loadSave と同じ検証に通す。
  // 小惑星（rock）が同じ星の形で正しければ、マスの残り・位置・弾・phase もそのまま使う（星の途中から試せる）
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
        const rock = Object.assign({}, base.rock, { mats: r.mats.slice(), hp: r.hp.slice(), x: r.x, y: r.y, vy: r.vy, left });
        s = Object.assign({}, base, { rock });
        const ph = ["fly", "bounce", "clear"].includes(obj.phase) ? obj.phase : base.phase;
        if (base.phase !== "choose") s.phase = ph;
        if (Number.isFinite(obj.wait)) s.wait = Math.max(0, obj.wait);
        if (obj.fighter && Number.isFinite(obj.fighter.x)) s.fighter = { x: obj.fighter.x, y: base.fighter.y };
        if (Array.isArray(obj.cd) && obj.cd.every(Number.isFinite)) s.cd = base.slots.map((_, k) => (Number.isFinite(obj.cd[k]) ? obj.cd[k] : s.t));
        if (!safeCall(() => L.step(s, 0), null)) s = base;
      }
    } catch (e) { s = base; }
    applyState(s);
    return true;
  }
  function applyState(s) {
    state = s;
    suggestSlot = -1;
    if (overlay === "choose" && state.phase !== "choose") closeCard("choose");
    if (state.phase === "choose") openCard("choose");
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
    setState: setStateApi,
    save() { return saveNow(); }
  });

  // ===== デバッグ命令（?debug=1 のときだけ。§7.4） =====
  // その星の始めに見合う武器（枠の数と Lv）。自動プレイ（greedy・seed 1）で星 N−1 をクリアしたときの値を表にしたもの（R2：
  // 毎回 greedy を回すと重いので、表を引くだけにする）。武器の種類は、いま持っている武器を残し、足りない枠は ARMS_ORDER の順で足す。
  // 表より先の星は Lv99。表の値は目安（ロジックの数値が変わっても「星に見合う」程度でよい）
  const ARMS_LV = [
    [1], [6], [7, 6], [8, 11, 9], [8, 14, 16], [15, 16, 19, 2], [17, 17, 23, 20], [22, 23, 24, 23], [26, 27, 28, 27], [28, 28, 33, 28],
    [33, 34, 35, 33], [36, 37, 38, 36], [38, 38, 43, 38], [42, 42, 45, 42], [45, 46, 47, 45], [47, 48, 52, 47], [50, 52, 54, 51], [54, 55, 57, 54],
    [56, 57, 61, 56], [58, 61, 63, 61], [64, 64, 66, 64], [66, 66, 70, 66], [68, 69, 73, 68], [72, 72, 75, 72], [75, 75, 78, 75], [77, 78, 82, 77],
    [81, 82, 84, 81], [84, 84, 87, 84], [86, 87, 90, 86], [88, 91, 93, 88], [93, 94, 96, 94], [95, 95, 98, 95], [96, 96, 99, 96], [97, 98, 99, 97],
    [98, 99, 99, 98]
  ];
  const ARMS_ORDER = ["shot", "beam", "bolt", "spread", "bomb", "fire"];
  function armsFor(n) {
    const lvMax = L.LEVEL_MAX || 99;
    const lvs = n - 1 < ARMS_LV.length ? ARMS_LV[Math.max(0, n - 1)] : [lvMax, lvMax, lvMax, lvMax];
    const ids = state && Array.isArray(state.slots) ? state.slots.map((x) => x.id) : ["shot"];
    for (const id of ARMS_ORDER) { if (ids.length >= lvs.length) break; if (ids.indexOf(id) < 0 && W_IDS.indexOf(id) >= 0) ids.push(id); }
    return lvs.map((lv, k) => ({ id: ids[k] || "shot", lv: Math.min(lvMax, lv) }));
  }
  function gostar(a) {
    const n = Math.floor(Number(a && a.star));
    if (!(n >= 1 && n <= (L.STAR_MAX || 9999))) throw new Error("star は 1〜" + (L.STAR_MAX || 9999));
    if (overlay && overlay !== "help") closeCardForce();
    const slots = armsFor(n);
    const s = normalize(Object.assign({}, state, { star: n, slots, offer: null, tries: 1, cleared: n > (L.ENDING_STAR || 30) }));
    if (!s) throw new Error("星を変えられない");
    applyState(s);
    bossUntil = -1;
    const info = safeCall(() => L.starInfo(n), null);
    if (info && info.boss) bossUntil = state.t + BOSS_BANNER_SEC;
    writeBest(n - 1);
    return { star: state.star, slots: state.slots, info };
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
  function withRock(fn) {
    if (!state || state.phase === "end") throw new Error("いまは つかえない");
    if (state.phase !== "fly") throw new Error("fly のときだけ（いまは " + state.phase + "）");
    const rock = Object.assign({}, state.rock, { mats: state.rock.mats.slice(), hp: state.rock.hp.slice() });
    fn(rock);
    const s = Object.assign({}, state, { rock, shots: [], burns: [] });
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
      const w = WEAPON[id] || {};
      return {
        id, name: wName(id), have: k >= 0, lv: k >= 0 ? s.slots[k].lv : null, dps: k >= 0 ? safeCall(() => L.dpsOf(s, k), null) : null,
        upCost: k >= 0 ? safeCall(() => L.upCostOf(s, k), null) : null, good: w.good || null, aff: w.aff || {}, rate: w.rate, dmg: w.dmg
      };
    });
    return { star: s.star, info, kakera: s.kakera, slotCost: safeCall(() => L.slotCostOf(s), null), progress: safeCall(() => L.progressOf(s), null), weapons };
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
      D.command("gostar", (a) => gostar(a), { desc: "その星の始めへ（枠と Lv は自動プレイでその星まで来たときの値）", args: "{ star }" });
      D.command("win", () => {
        withRock((rock) => {
          const br = bottomRowOf(rock);
          let keep = -1;
          for (let c = 0; c < rock.cols && keep < 0; c++) if (rock.mats[br * rock.cols + c]) keep = br * rock.cols + c;
          for (let i = 0; i < rock.mats.length; i++) if (i !== keep) { rock.mats[i] = 0; rock.hp[i] = 0; }
          rock.left = keep >= 0 ? 1 : 0;
        });
        return { left: state.rock.left };
      }, { desc: "いまの星のマスを 1 つだけ残す（クリアの確認）", args: "なし" });
      D.command("lose", () => {
        withRock((rock) => {
          const br = bottomRowOf(rock);
          const C = L.CELL || 14;
          rock.y = (L.BARRIER_Y || 470) - (br + 1) * C - 1;
        });
        return { progress: L.progressOf(state) };
      }, { desc: "小惑星をバリアの直前まで下げる（はね返しの確認）", args: "なし" });
      D.command("lv", (a) => {
        if (!state) throw new Error("まだ はじまっていない");
        const k = Math.floor(Number(a && a.slot));
        if (!(k >= 0 && k < state.slots.length)) throw new Error("slot は 0〜" + (state.slots.length - 1));
        const lv = Math.floor(Number(a && a.lv));
        const slots = state.slots.map((x, j) => (j === k ? { id: x.id, lv } : { id: x.id, lv: x.lv }));
        const s = Object.assign({}, state, { slots });
        const chk = normalize(Object.assign({}, s));
        if (!chk) throw new Error("変えられなかった");
        state = Object.assign({}, state, { slots: chk.slots });
        saveNow();
        updateUi();
        return { slot: k, id: state.slots[k].id, lv: state.slots[k].lv, dps: L.dpsOf(state, k), upCost: L.upCostOf(state, k) };
      }, { desc: "Lv を変える（1〜99。しんか・最大の桁の確認）", args: "{ slot, lv }" });
      D.command("rates", () => rateTable(), { desc: "武器ごとのつよさ・相性・星の混ざり方", args: "なし" });
    }, null);
  }

  // ===== 起動（§7.1・§8.3） =====
  (function boot() {
    best = safeCall(() => L.validateBest(readKey(KEY_BEST)), 0) || 0;
    const raw = readKey(KEY_SAVE);
    let loaded = raw === null ? null : safeCall(() => L.loadSave(raw), null);
    let extra = { t: 0, ending: false };
    if (loaded) {
      extra = extraOf(raw);
      loaded.t = extra.t;
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
    if (state.cleared && best < (L.ENDING_STAR || 30)) writeBest(L.ENDING_STAR || 30);
    const info = safeCall(() => L.starInfo(state.star), null);
    if (info && info.boss) bossUntil = state.t + BOSS_BANNER_SEC;
    const firstTime = readKey(KEY_HELP) !== "1";
    if (firstTime) openCard("help");
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
