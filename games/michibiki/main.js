/*
 * ミチビキ空港 — 固定ステップの進行・一時停止・保存・画面遷移・テスト用 API・デバッグ命令
 * 契約：docs/michibiki-contract.md §5（入力）・§6（DOM）・§8（進行）・§8.6（テスト用 API）・§9（デバッグ命令）
 * 担当B（画面）だけが編集する。
 *
 * 読み込み順：../../common/sfx.js → logic.js → render.js → input.js → main.js
 * - ルールは logic.js（MichibikiLogic）だけが知っている。ここは指の点を setPath に渡し、出来事を render と効果音に渡すだけ
 * - rAF ごとに経過時間（上限 0.1 秒）を貯め、STEP ごとに update（1回の rAF で最大 6 コマ）
 * - 指の点は貯めて、1コマに1回だけ setPath。2回目からは「いまの道の残り（pathI から先）＋新しい点」を渡す
 *   （たどり終えた点を渡し直すと、機体が後ろへ戻ってしまうため）
 * - ぶつかったら 0.4 秒 update を止める（何が起きたか分かるように。§7.3）
 * - タイマーは later / clearLater / runId（回を始めるたびに runId +1、古い続きは動かない）
 */
(() => {
  "use strict";

  const L = window.MichibikiLogic;
  const R = window.MichibikiRender;
  const I = window.MichibikiInput;
  if (!L || typeof L.newGame !== "function") throw new Error("ミチビキ空港: MichibikiLogic が読み込まれていません（logic.js）");
  if (!R || typeof R.create !== "function") throw new Error("ミチビキ空港: MichibikiRender が読み込まれていません（render.js）");

  const NAME = typeof L.NAME === "string" && L.NAME ? L.NAME : "ミチビキ空港";
  const STEP = L.STEP || 1 / 60;
  const LIVES = L.LIVES || 3;
  const PLANE_R = L.PLANE_R || 12;
  const PICK_R = L.PICK_R || 34;
  const ZONE_R = L.ZONE_R || 22;
  const APPROACH_D = L.APPROACH_D || 48;
  const RUNWAY_LEN = L.RUNWAY_LEN || 96;
  const RUNWAY_W = L.RUNWAY_W || 22;
  const KEY_BEST = L.SAVE_KEY_BEST || "michibiki.best";
  const KEY_HELP = L.SAVE_KEY_HELP || "michibiki.help";
  const MAX_STEPS_PER_FRAME = 6;
  const CRASH_FREEZE_MS = 400;
  const OVER_CARD_DELAY_MS = 600;
  const CARD_LOCK_MS = 600;
  const HINT_MS = 3000;
  const TUTOR_AFTER_S = 3;
  const WRONG_HINT_MAX = 3;      // 1回の回で「やじるしの むきから はいろう」を出す回数の上限
  const WRONG_HINT_UNTIL = 5;    // その回の着陸がこの数になったら、もう出さない
  const SMALL_SCALE = 0.75;      // これより小さい倍率なら「たてむき」をすすめる
  const RAW_MIN = 2;             // 指の点を貯めるときの最小の間隔（場の単位）
  const RAW_MAX = 3000;
  const MOVE_MIN = 8;            // なぞり始めとみなす指の動き（場の単位）
  const SLOWMO_RATES = [0.25, 0.5, 1];

  const HINT_TUTOR = "ひこうきから なぞってね";
  const HINT_WRONG = "やじるしの むきから はいろう";
  const HINT_NEAR = "あかく ひかったら ぶつかりそう！";
  const HINT_TAP = "かっそうろを タップしても いいよ";
  const HINT_PORTRAIT = "たてむきの ほうが あそびやすいよ";
  const HINT_PLAN = "こんかいは かっそうろの ならびが ちがうよ";   // 置き方が前の回と違う回の はじめだけ（MC-15）
  const HINT_CLOSED = "その いろの かっそうろは まだ ひらいて いないよ";

  const now = () => performance.now();
  const $ = (id) => document.getElementById(id);
  const el = {
    app: $("app"), back: $("back"), title: $("gameTitle"), helpBtn: $("helpBtn"), pauseBtn: $("pauseBtn"), soundBtn: $("soundBtn"),
    score: $("score"), best: $("best"), lives: $("lives"), field: $("field"), hint: $("hint"), overlay: $("overlay"), card: $("card")
  };
  const missing = Object.keys(el).filter((k) => !el[k]);
  if (missing.length) throw new Error("ミチビキ空港: 画面の部品が見つかりません：" + missing.join(", "));

  document.title = NAME;
  if (el.title.textContent !== NAME) el.title.textContent = NAME;   // 同じなら書き換えない（index.html の <wbr> を残す）

  function safeCall(fn, fallback) { try { return fn(); } catch (e) { console.error("ミチビキ空港:", e); return fallback; } }

  // ===== 効果音（sfx.js が無くても・音の表に無い名前でも、音なしで遊べる） =====
  const rawSfx = window.YubiSfx && typeof window.YubiSfx.create === "function" ? safeCall(() => window.YubiSfx.create("michibiki"), null) : null;
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
    el.soundBtn.setAttribute("aria-label", "効果音");   // オン・オフは aria-pressed だけで伝える（名前に入れると読み上げが二重になる。X-25）
  }
  function toggleSound() { sfx.unlock(); sfx.toggle(); renderSoundBtn(); }
  renderSoundBtn();

  // ===== 保存（保存できなくても遊べる。§8.3） =====
  function readKey(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeKey(key, val) { try { localStorage.setItem(key, val); return true; } catch (e) { return false; } }
  const readBest = () => safeCall(() => L.validateBest(readKey(KEY_BEST)), 0) || 0;

  // ===== タイマー（later / clearLater / runId。§8.2） =====
  let runId = 0;
  const timers = new Set();
  function later(fn, ms) {
    const myRun = runId;
    const id = setTimeout(() => { timers.delete(id); if (myRun !== runId) return; fn(); }, ms);
    timers.add(id);
    return id;
  }
  function cancel(id) { if (id && timers.has(id)) { clearTimeout(id); timers.delete(id); } }
  function clearLater() { timers.forEach((id) => clearTimeout(id)); timers.clear(); hintTimer = 0; }

  // ===== 状態 =====
  let state = null;              // MichibikiLogic の state（イミュータブル）
  let prevState = null;          // 1コマ前（描画の補間用）
  let phase = "help";            // help | playing | paused | over
  let overlayKind = null;        // null | help | paused | over
  let helpReturn = "start";      // 遊び方を閉じたら：start（回を始める）| paused（一時停止カードへ）
  let best = readBest();
  let startBest = best;          // 回を始めたときのベスト（「ベスト こうしん！」はこれと比べる。§19 A2）
  let selected = null;           // 選んだ機体の id（タップ・キーボード）
  const drawings = new Map();    // pointerId → { id, pending: [[x,y]...], pathRef, guided }
  let manualMode = false;
  let slowmo = 1;
  let acc = 0, lastT = null, rafId = 0;
  let freezeUntil = -Infinity;
  let cardShownAt = -Infinity;
  let lastOver = null;           // { landed, improved, prevBest, guided, crashes }
  let hintTimer = 0;
  // 回ごとのヒントの数え
  let firstPlane = null;         // { id, tick }
  let tutorDone = false;
  let wrongHints = 0;
  // ページを開いている間に1回だけのヒント
  let nearHintShown = false;
  let tapHintShown = false;
  let portraitTipShown = false;
  let lastOrient = null, lastScale = 0;

  const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  const render = R.create(el.field, { calm: !!reduceMotion.matches });
  const onCalm = () => { render.setCalm(!!reduceMotion.matches); redraw(); };
  if (reduceMotion.addEventListener) reduceMotion.addEventListener("change", onCalm);
  else if (reduceMotion.addListener) reduceMotion.addListener(onCalm);

  const orientNow = () => (window.innerWidth > window.innerHeight ? "wide" : "tall");
  const planesOf = (s) => (s && Array.isArray(s.planes) ? s.planes : []);
  const planeById = (id) => planesOf(state).find((p) => p.id === id) || null;
  const flying = () => planesOf(state).filter((p) => p.phase === "fly").sort((a, b) => a.id - b.id);
  const colorName = (id) => safeCall(() => L.colorName(id), "") || "";
  const markChar = (id) => {
    const c = Array.isArray(L.COLORS) ? L.COLORS[id] : null;
    const m = c ? String(c.mark || "") : "";
    if (m === "○" || /circle/i.test(m)) return "○";
    if (m === "△" || /tri/i.test(m)) return "△";
    if (m === "□" || /square/i.test(m)) return "□";
    return ["○", "△", "□"][id] || "";
  };

  // ===== 表示 =====
  function setPhase(p) {
    phase = p;
    el.app.dataset.phase = p;
  }
  function setHint(text, ms) {
    const t = text || "";
    if (el.hint.textContent !== t) el.hint.textContent = t;
    cancel(hintTimer);
    hintTimer = 0;
    if (t) hintTimer = later(() => { hintTimer = 0; el.hint.textContent = ""; }, ms || HINT_MS);
  }
  function setNum(node, n) {
    const t = String(n);
    if (node.textContent !== t) node.textContent = t;
    node.dataset.value = t;
    node.dataset.size = t.length >= 6 ? "m" : "s";
  }
  function renderLives(lost) {
    const n = state ? Math.max(0, Math.min(LIVES, state.lives | 0)) : LIVES;
    if (el.lives.dataset.lives !== String(n) || el.lives.children.length !== LIVES) {
      el.lives.textContent = "";
      for (let i = 0; i < LIVES; i++) {
        const s = document.createElement("span");
        s.textContent = i < n ? "♥" : "♡";
        if (i >= n) s.className = "lost";
        if (lost && i === n && !render.calm) s.classList.add("break");
        el.lives.append(s);
      }
      el.lives.dataset.lives = String(n);
      el.lives.setAttribute("aria-label", `のこり ${n}`);
    }
  }
  function hud(lost) {
    if (!state) return;
    setNum(el.score, state.landed | 0);
    setNum(el.best, best);
    el.score.dataset.overBest = startBest > 0 && state.landed > startBest ? "1" : "0";
    renderLives(lost);
  }
  function bumpScore() {
    if (render.calm) return;
    el.score.classList.remove("bump");
    void el.score.offsetWidth;
    el.score.classList.add("bump");
  }
  function uiForDraw(alpha) {
    const list = [];
    drawings.forEach((d) => list.push({ id: d.id, points: d.pending }));
    return { drawing: list, selected, alpha: alpha === undefined ? 1 : alpha, prev: prevState };
  }
  function redraw(alpha) { if (state) render.draw(state, uiForDraw(alpha)); }

  // ===== ループ =====
  function wantLoop() {
    if (overlayKind && overlayKind !== null && phase !== "over") return false;  // カード（遊び方・一時停止）の間は止める
    if (phase === "playing") return true;
    if (phase === "over" && !overlayKind) return render.busy;                   // 終わった直後の演出だけ
    return false;
  }
  function ensureLoop() {
    if (rafId || !wantLoop()) return;
    rafId = requestAnimationFrame(frame);
  }
  function stopLoop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; lastT = null; }
  function frame(t) {
    rafId = 0;
    const dt = lastT === null ? 0 : Math.min(0.1, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    let alpha = 1;
    if (phase === "playing" && state && !state.over) {
      if (manualMode) {
        applyPaths();
        acc = 0;
      } else if (now() < freezeUntil) {
        acc = 0;
      } else {
        acc += dt * slowmo;
        let n = 0;
        while (acc >= STEP && n < MAX_STEPS_PER_FRAME && phase === "playing") {
          stepOnce();
          acc -= STEP;
          n += 1;
          if (now() < freezeUntil) { acc = 0; break; }
        }
        if (n === 0) applyPaths();
        if (acc > STEP) acc = STEP;       // 重いときは追いつこうとしない（貯めた時間を捨てる）
        alpha = phase === "playing" ? Math.max(0, Math.min(1, acc / STEP)) : 1;
      }
    }
    redraw(alpha);
    ensureLoop();
  }

  // 1コマ進める（指の点を先に渡す）
  function stepOnce() {
    applyPaths();
    const prev = state;
    const r = safeCall(() => L.update(state), null);
    if (!r || !r.state) return [];
    state = r.state;
    prevState = prev;
    const evs = Array.isArray(r.events) ? r.events : [];
    handleEvents(evs, prev);
    afterStep();
    return evs;
  }

  // ===== 出来事 =====
  function handleEvents(evs, prev) {
    if (!evs.length) return;
    let lost = false, scored = false;
    const forRender = [];
    for (const e of evs) {
      if (!e || typeof e.type !== "string") continue;
      switch (e.type) {
        case "warn": sfx.play("warn"); break;
        case "spawn":
          if (!firstPlane) firstPlane = { id: e.id, tick: state.tick };
          break;
        case "land":
          sfx.play("land", e.landed);
          scored = true;
          saveBestNow();
          if (selected === e.id) selected = null;
          dropDrawingsOf(e.id);
          break;
        case "wrongway":
          if (wrongHints < WRONG_HINT_MAX && (state.landed | 0) < WRONG_HINT_UNTIL) { wrongHints += 1; setHint(HINT_WRONG); }
          break;
        case "crash": {
          sfx.play("crash");
          sfx.buzz(40);
          lost = true;
          const ids = Array.isArray(e.ids) ? e.ids : [];
          ids.forEach((id) => { dropDrawingsOf(id); if (selected === id) selected = null; });
          const colors = ids.map((id) => { const p = planesOf(prev).find((q) => q.id === id); return p ? p.color : null; }).filter((c) => c !== null);
          forRender.push(Object.assign({}, e, { colors }));
          if (!manualMode) freezeUntil = now() + CRASH_FREEZE_MS;
          continue;
        }
        case "near":
          sfx.play("near");
          // 早すぎないよう、1機目が着陸してから（またはライフが減ってから）出す（§19 B6）
          if (!nearHintShown && ((state.landed | 0) >= 1 || (state.lives | 0) < LIVES)) { nearHintShown = true; setHint(HINT_NEAR); }
          break;
        case "bounce": sfx.play("bounce"); break;
        case "open": {
          sfx.play("open", e.color);
          const nm = colorName(e.color);
          setHint(`${nm ? kanaAdj(nm) : "あたらしい"} ひこうきが くるよ！ ${markChar(e.color)}の かっそうろへ`, 4000);
          break;
        }
        case "over": break;
        default: break;
      }
      forRender.push(e);
    }
    render.play(forRender, state);
    hud(lost);
    if (scored) bumpScore();
    if (state.over) onOver();
  }
  // 着陸のたびに、ベストを超えていたらすぐ保存する（回の途中でやめても消えない。§19 A2）
  function saveBestNow() {
    const n = state ? state.landed | 0 : 0;
    if (n <= best) return;
    best = n;
    const saved = readBest();
    if (n > saved) writeKey(KEY_BEST, String(n));
  }
  // 「あか」→「あかい」・「あお」→「あおい」・「きいろ」→「きいろい」
  function kanaAdj(name) { return /[かおろ]$/.test(name) ? name + "い" : name + "の"; }

  // 回ごとのヒント（はじめの「なぞってね」）
  function afterStep() {
    if (tutorDone || !firstPlane || !state) return;
    if ((state.tick - firstPlane.tick) * STEP < TUTOR_AFTER_S) return;
    tutorDone = true;
    const p = planeById(firstPlane.id);
    if (!p || p.phase !== "fly" || (Array.isArray(p.path) && p.pathI < p.path.length)) return;
    const pts = safeCall(() => L.suggestPath(state, p.id), null);
    if (Array.isArray(pts) && pts.length) render.tutor([[p.x, p.y]].concat(pts), p.id);
    setHint(HINT_TUTOR, 4000);
  }

  // ===== 道 =====
  function dropDrawingsOf(id) { drawings.forEach((d, k) => { if (d.id === id) drawings.delete(k); }); }
  // なぞり始めとみなす動き（指を置いた点から MOVE_MIN 以上）
  function movedEnough(d) {
    const s0 = d.start;
    return d.pending.some((q) => Math.hypot(q[0] - s0[0], q[1] - s0[1]) >= MOVE_MIN);
  }
  function applyPath(key, d, final) {
    if (!state || state.over || !d.dirty) return;
    const p = planeById(d.id);
    if (!p || p.phase !== "fly") { drawings.delete(key); return; }
    // 指がほとんど動いていない間は渡さない（setPath は機体のそばの点だけだと前の道を捨てるので、タップのぶれで道が消えないように）
    if (!d.pathRef && !d.started) {
      if (!movedEnough(d)) return;
      // 最初の setPath だけ：機体から PICK_R 以内にある先頭の点（指を置いた所など）を捨てる。
      // 機体のうしろをつかんで前へなぞったとき、うしろの点へ戻って Uターンしないように（§19 A1）
      const k = d.pending.findIndex((q) => Math.hypot(q[0] - p.x, q[1] - p.y) > PICK_R);
      if (k < 0) {
        if (!final) return;                         // まだ機体のそば：指が離れるまで待つ
        d.pending = d.pending.slice(-1);            // 離した：指を離した点へ向かう
      } else d.pending = d.pending.slice(k);
      d.started = true;
    }
    // 2回目からは、いまの道の残り（たどり終えた所は捨てる）＋新しい点
    const base = d.pathRef && p.path === d.pathRef ? p.path.slice(Math.max(0, p.pathI | 0)) : [];
    const pts = base.concat(d.pending);
    const r = safeCall(() => L.setPath(state, d.id, pts), null);
    if (!r) return;
    if (r.ok && r.state) {
      state = r.state;
      const np = planeById(d.id);
      d.pathRef = np ? np.path : null;
      d.pending = [];
      d.dirty = false;
      if (r.guided && !d.guided) { d.guided = true; sfx.play("lock"); }
      if (!r.guided) d.guided = false;
    } else if (r.reason === "noplane" || r.reason === "landing" || r.reason === "over") {
      drawings.delete(key);
    }
    // 'empty'（機体のすぐそばの点だけ）は、点を貯めたまま次を待つ
  }
  function applyPaths() { drawings.forEach((d, k) => applyPath(k, d)); }

  // 滑走路のどこか（帯・区域・案内の帯）をタップしたか（§5.3）
  function runwayAt(x, y) {
    const list = state ? safeCall(() => L.runwaysFor(state), []) || [] : [];
    let hit = null, bestD = Infinity;
    for (const r of list) {
      const rx = x - r.ex, ry = y - r.ey;
      const lx = rx * r.dx + ry * r.dy;          // 滑走路の向きにそった位置
      const ly = -rx * r.dy + ry * r.dx;         // 横のずれ
      const inStrip = lx >= -APPROACH_D - 8 && lx <= RUNWAY_LEN + 8 && Math.abs(ly) <= RUNWAY_W / 2 + 10;
      const dz = Math.hypot(rx, ry);
      if (!inStrip && dz > ZONE_R + 10) continue;
      const d = inStrip ? Math.abs(ly) : dz;
      if (d < bestD) { bestD = d; hit = r; }
    }
    return hit;
  }
  function guide(id, color) {
    if (!state || state.over) return { ok: false, guided: false, reason: "over" };
    const p = planeById(id);
    if (!p || p.phase !== "fly") return { ok: false, guided: false, reason: "noplane" };
    const c = Number.isInteger(color) ? color : p.color;
    const pts = safeCall(() => L.suggestPath(state, id, c), null);
    if (!Array.isArray(pts) || !pts.length) { setHint(HINT_CLOSED); return { ok: false, guided: false, reason: "closed" }; }
    const r = safeCall(() => L.setPath(state, id, pts), null);
    if (!r || !r.ok) return { ok: false, guided: false, reason: r ? r.reason : "error" };
    state = r.state;
    dropDrawingsOf(id);
    selected = null;
    sfx.play(r.guided ? "lock" : "pick");
    if (el.hint.textContent === HINT_TAP) setHint("");   // 滑走路をタップしたら「タップしても いいよ」は消す（§19 B5）
    redraw();
    return { ok: true, guided: !!r.guided };
  }
  function selectPlane(id) {
    selected = id;
    sfx.play("pick");
    if (!tapHintShown) { tapHintShown = true; setHint(HINT_TAP); }
    redraw();
  }

  // ===== 入力（§5） =====
  const canPlay = () => phase === "playing" && !overlayKind && state && !state.over;
  const inputHandlers = {
    toField: (cx, cy) => render.toField(cx, cy),
    isCardOpen: () => !!overlayKind,
    onStart(pid, pt) {
      if (!canPlay()) return false;
      const id = safeCall(() => L.pickPlane(state, pt[0], pt[1]), null);
      if (id === null || id === undefined) return false;
      // その機体をなぞっている指があれば、新しい指は無視（道が交互に入れ替わらないように。§19 A7）
      for (const d of drawings.values()) if (d.id === id) return false;
      drawings.set(pid, { id, pending: [[pt[0], pt[1]]], start: [pt[0], pt[1]], started: false, pathRef: null, guided: false, dirty: false });
      return true;
    },
    onMove(pid, pt) {
      const d = drawings.get(pid);
      if (!d) return;
      const last = d.pending[d.pending.length - 1];
      if (last && Math.hypot(pt[0] - last[0], pt[1] - last[1]) < RAW_MIN) return;
      if (d.pending.length >= RAW_MAX) return;
      d.pending.push([pt[0], pt[1]]);
      d.dirty = true;
      if (!rafId) ensureLoop();
    },
    onEnd(pid, pt, info) {
      let tap = !!(info && info.tap);
      const d = drawings.get(pid);
      if (d) {
        drawings.delete(pid);
        if (!canPlay()) return;
        // まだなぞり始めていない（道を渡していない・ほとんど動いていない）なら、タップとして扱う（§19 A4）
        if (!tap && !d.started && !d.pathRef && !movedEnough({ start: d.start, pending: d.pending.concat([[pt[0], pt[1]]]) })) tap = true;
        if (tap) {
          // 選んでいる機体があり、滑走路の上をタップした：おまかせを優先
          const rw = selected !== null && selected !== d.id ? runwayAt(pt[0], pt[1]) : null;
          if (rw) guide(selected, rw.color);
          else selectPlane(d.id);
          return;
        }
        d.pending.push([pt[0], pt[1]]);
        d.dirty = true;
        applyPath(pid, d, true);
        redraw();
        return;
      }
      if (!canPlay() || !tap) return;
      if (selected !== null) {
        const rw = runwayAt(pt[0], pt[1]);
        if (rw) { guide(selected, rw.color); return; }
        selected = null;    // 空いた所のタップで選びをやめる
        redraw();
      }
    },
    onCancel(pid) { drawings.delete(pid); },   // 道はそこまでで確定
    onCommand(cmd) {
      switch (cmd) {
        case "esc":
          if (overlayKind === "help") closeHelp();
          else if (phase === "paused" && confirming) showPausedCard();
          else if (phase === "paused") resume();
          else if (phase === "playing") { if (selected !== null) { selected = null; redraw(); } else pause(); }
          break;
        case "pause":
          if (phase === "playing") pause();
          else if (phase === "paused" && overlayKind === "paused" && !confirming) resume();
          break;
        case "sound": toggleSound(); break;
        case "help": if (overlayKind === "help") closeHelp(); else showHelp(); break;
        case "next": case "prev": cycle(cmd === "next" ? 1 : -1); break;
        case "guide0": case "guide1": case "guide2": keyGuide(Number(cmd.slice(5))); break;
        case "guideOwn": keyGuide(null); break;
        default: break;
      }
    }
  };
  function cycle(dir) {
    if (!canPlay()) return;
    const list = flying();
    if (!list.length) { selected = null; redraw(); return; }
    const i = list.findIndex((p) => p.id === selected);
    const j = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    selected = list[j].id;
    sfx.play("pick");
    redraw();
  }
  // 1 2 3：選んだ機体を、その色の滑走路へ（選んでいなければ、その色の機体で id の小さいもの）。Enter：自分の色へ
  function keyGuide(color) {
    if (!canPlay()) return;
    let id = selected !== null && planeById(selected) ? selected : null;
    if (id === null) {
      const list = flying();
      const p = color === null ? list[0] : list.find((q) => q.color === color);
      if (!p) return;
      id = p.id;
    }
    guide(id, color === null ? undefined : color);
  }
  const detachInput = I && typeof I.attach === "function" ? I.attach(el.field, inputHandlers) : null;
  if (!detachInput) console.error("ミチビキ空港: MichibikiInput が読み込まれていません（input.js）。なぞる操作が使えません");

  // ===== 回を始める・終わる =====
  function newSeed() { return Date.now() >>> 0; }
  // 滑走路の置き方（MC-15）：回ごとに、前の回と違う置き方を選ぶ（はじめは乱数）。テストの restart(seed, layout) は置き方 0（今までどおり）
  let lastPlan = -1;
  function pickPlan() {
    const n = Math.max(1, L.PLAN_COUNT | 0);
    if (n === 1) return 0;
    return lastPlan < 0 ? Math.floor(Math.random() * n) : (lastPlan + 1 + Math.floor(Math.random() * (n - 1))) % n;
  }
  function stopAll() {
    clearLater();
    runId += 1;
    drawings.clear();
    selected = null;
    render.finishAll();
    freezeUntil = -Infinity;
  }
  function makeGame(seed, layout, plan) {
    const lay = layout === "wide" || layout === "tall" ? layout : orientNow();
    const pl = Number.isSafeInteger(plan) && plan >= 0 ? plan : pickPlan();
    const s = safeCall(() => L.newGame(seed >>> 0, lay, pl), null);
    if (!s) return false;
    state = s;
    prevState = null;
    render.setField(s.w, s.h);
    el.app.dataset.layout = s.layout;
    el.field.dataset.layout = s.layout;
    el.field.dataset.plan = String(s.plan | 0);
    lastPlan = s.plan | 0;
    firstPlane = null; tutorDone = false; wrongHints = 0;
    lastOver = null;
    acc = 0; lastT = null;
    return true;
  }
  function startGame(seed, layout, plan) {
    stopAll();
    hideOverlay();
    const prevPlan = lastPlan;
    if (!makeGame(Number.isFinite(seed) ? seed : newSeed(), layout, plan)) return false;
    best = readBest();
    startBest = best;
    render.resume();
    setPhase("playing");
    hud();
    setHint(prevPlan >= 0 && (state.plan | 0) !== prevPlan ? HINT_PLAN : "", 3000);
    sfx.play("start");
    lastOrient = orientNow();
    lastScale = render.scale;
    portraitTip();
    redraw();
    ensureLoop();
    return true;
  }
  function onOver() {
    if (phase === "over") return;
    drawings.clear();
    selected = null;
    // 「ベスト こうしん！」は回を始めたときのベストと比べる（着陸のたびに保存しているため。§19 A2）
    const prevBest = startBest;
    const r = safeCall(() => L.recordBest(prevBest, state.landed | 0), { best: Math.max(prevBest, state.landed | 0), improved: (state.landed | 0) > prevBest });
    best = Math.max(r.best, readBest());
    writeKey(KEY_BEST, String(best));
    const st = state.stats || {};
    lastOver = { landed: state.landed | 0, improved: !!r.improved, prevBest, guided: st.guidedLandings | 0, crashes: st.crashes | 0 };
    setPhase("over");
    sfx.play("over");
    hud();
    later(() => showOverCard(), OVER_CARD_DELAY_MS);
  }

  // ===== 一時停止（§8.1・§8.2） =====
  function pause() {
    if (phase !== "playing" || !state || state.over) return false;
    applyPaths();
    drawings.clear();                     // 描いている途中の線は、そこまでで確定
    setPhase("paused");
    render.pause();
    stopLoop();
    acc = 0;
    showPausedCard();
    redraw();
    return true;
  }
  function resume() {
    if (phase !== "paused") return false;
    hideOverlay();
    setPhase("playing");
    render.resume();
    acc = 0; lastT = null;
    freezeUntil = -Infinity;
    redraw();
    ensureLoop();
    return true;
  }

  // ===== カード =====
  let focusBack = null;
  function showCard(kind, html, fields) {
    if (!overlayKind) focusBack = document.activeElement;
    el.card.innerHTML = html;
    el.card.querySelectorAll("[data-f]").forEach((n) => { n.textContent = fields && fields[n.dataset.f] != null ? fields[n.dataset.f] : ""; });
    el.overlay.dataset.kind = kind;
    el.overlay.hidden = false;
    overlayKind = kind;
    const primary = el.card.querySelector(".primary");
    if (primary) { try { primary.focus({ preventScroll: true }); } catch (e) { primary.focus(); } }
  }
  function hideOverlay() {
    if (!overlayKind && el.overlay.hidden) return;
    el.overlay.hidden = true;
    delete el.overlay.dataset.kind;
    el.card.innerHTML = "";
    overlayKind = null;
    confirming = false;
    const fb = focusBack; focusBack = null;
    if (fb && fb.isConnected && fb !== document.body && !el.overlay.contains(fb)) { try { fb.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
  }
  const PIC_GOOD = `<svg viewBox="0 0 92 46" aria-hidden="true"><rect x="46" y="16" width="40" height="14" rx="2" fill="#3b4652"/><rect x="46" y="16" width="40" height="3" fill="#D55E00"/><rect x="46" y="27" width="40" height="3" fill="#D55E00"/><path d="M8 40 C 14 22, 22 23, 30 23 L 52 23" fill="none" stroke="#D55E00" stroke-width="3"/><path d="M50 17 l7 6 -7 6 M44 17 l7 6 -7 6" fill="none" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/><circle cx="72" cy="8" r="7" fill="#2a9d55"/><path d="M68.5 8 l2.5 2.6 4.5-4.6" fill="none" stroke="#fff" stroke-width="2"/></svg>`;
  const PIC_BAD = `<svg viewBox="0 0 92 46" aria-hidden="true"><rect x="46" y="16" width="40" height="14" rx="2" fill="#3b4652"/><rect x="46" y="16" width="40" height="3" fill="#D55E00"/><rect x="46" y="27" width="40" height="3" fill="#D55E00"/><path d="M50 17 l7 6 -7 6 M44 17 l7 6 -7 6" fill="none" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/><path d="M90 40 C 86 30, 80 23, 70 23 L 30 23" fill="none" stroke="#D55E00" stroke-width="3" stroke-dasharray="4 3"/><circle cx="20" cy="9" r="7" fill="#c0392b"/><path d="M17 6 l6 6 M23 6 l-6 6" stroke="#fff" stroke-width="2"/></svg>`;
  function showHelp() {
    if (overlayKind === "help" || overlayKind === "over" || phase === "over") return false;
    if (phase === "playing" && state && !state.over) {
      // 遊んでいる途中：止めて、閉じたら一時停止カードへ（§8.2）
      applyPaths();
      drawings.clear();
      render.pause();
      stopLoop();
      helpReturn = "paused";
    } else if (phase === "paused") {
      helpReturn = "paused";
    } else {
      helpReturn = "start";
    }
    setPhase("help");
    showCard("help", `
      <h2 id="overlayTitle">あそびかた</h2>
      <ol class="rules">
        <li>ひこうきから ゆびで なぞると、その みちを とぶよ</li>
        <li class="with-pic">おなじ いろ・おなじ しるしの かっそうろ（ひこうきの みち）へ、やじるしの むきから はいると 1てん
          <div class="pics"><figure>${PIC_GOOD}<figcaption>やじるしの むきから</figcaption></figure><figure>${PIC_BAD}<figcaption>ぎゃくからは ✕</figcaption></figure></div></li>
        <li>ぶつかると ♥が へるよ。♥が なくなったら おしまい</li>
      </ol>
      <div class="btns"><button class="primary" id="helpOk" type="button" data-cmd="helpOk">わかった</button></div>`);
    return true;
  }
  function closeHelp() {
    if (overlayKind !== "help") return;
    writeKey(KEY_HELP, "1");
    hideOverlay();
    if (helpReturn === "paused" && state && !state.over) {
      setPhase("paused");
      showPausedCard();
      redraw();
    } else {
      startGame(newSeed());
    }
  }
  let confirming = false;       // 一時停止カードの中で「さいしょから？」を出している間
  function showPausedCard() {
    showCard("paused", `
      <h2 id="overlayTitle">ひとやすみ</h2>
      <p class="small">ばを みて つぎの てを かんがえて いいよ</p>
      <div class="btns">
        <button class="primary" id="resumeBtn" type="button" data-cmd="resume">つづける</button>
        <button id="restartBtn" type="button" data-cmd="restart">さいしょから</button>
      </div>`);
    confirming = false;
  }
  // 「さいしょから」は押し間違えやすいので、確認を出す（§19 B2）。もどるを先（primary）にする
  function showRestartConfirm() {
    showCard("paused", `
      <h2 id="overlayTitle">さいしょから？</h2>
      <p>いまの ゲームを やめて さいしょから？</p>
      <div class="btns">
        <button class="primary" id="restartBackBtn" type="button" data-cmd="restartBack">もどる</button>
        <button id="restartOkBtn" type="button" data-cmd="restartOk">やめる</button>
      </div>`);
    confirming = true;
  }
  function showOverCard() {
    const c = lastOver || { landed: state ? state.landed | 0 : 0, improved: false, prevBest: best, guided: 0, crashes: 0 };
    let note = "", noteClass = "small";
    if (c.improved) { note = "ベスト こうしん！"; noteClass = "best-new"; }
    else if (c.prevBest > 0 && c.prevBest - c.landed === 0) { note = "ベストと おなじ！"; noteClass = "close"; }
    else if (c.prevBest > 0 && c.prevBest - c.landed <= 3) { note = `あと ${c.prevBest - c.landed} きで ベスト！`; noteClass = "close"; }
    else note = `ベスト ${best} き`;
    showCard("over", `
      <h2 id="overlayTitle">おしまい！</h2>
      <p class="big"><span data-f="n"></span><small>き ちゃくりく</small></p>
      <p class="${noteClass}" data-f="b"></p>
      <p class="small" data-f="s"></p>
      ${c.landed <= 2 ? '<p class="small" id="overTip" data-f="t"></p>' : ""}
      <div class="btns">
        <button class="primary" id="againBtn" type="button" data-cmd="again">もういちど</button>
        <button id="menuBtn" type="button" data-cmd="menu">メニューへ</button>
      </div>`, {
      n: String(c.landed),
      b: note,
      s: `みちびいた ${c.guided} き・ぶつかった ${c.crashes}かい`,
      t: "つぎは かっそうろの やじるしを よく みてね"
    });
    el.card.setAttribute("aria-label", `おしまい。${c.landed} き ちゃくりく`);
    cardShownAt = now();
    el.card.querySelectorAll(".btns button").forEach((b) => b.setAttribute("aria-disabled", "true"));
    later(() => el.card.querySelectorAll(".btns button[aria-disabled]").forEach((b) => b.removeAttribute("aria-disabled")), CARD_LOCK_MS);
    if (c.improved) later(() => sfx.play("best"), 400);
    stopLoop();
  }
  function goMenu() {
    clearLater();
    location.href = "../../";
  }
  el.overlay.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("[data-cmd]") : null;
    if (!btn) return;
    if (overlayKind === "over" && now() - cardShownAt < CARD_LOCK_MS) return;   // 出た直後の連打で押し間違えない
    sfx.unlock();
    const cmd = btn.dataset.cmd;
    if (cmd === "helpOk") closeHelp();
    else if (cmd === "resume") resume();
    else if (cmd === "restart") showRestartConfirm();
    else if (cmd === "restartBack") showPausedCard();
    else if (cmd === "restartOk" || cmd === "again") startGame(newSeed());
    else if (cmd === "menu") goMenu();
  });
  el.helpBtn.addEventListener("click", () => { sfx.unlock(); if (overlayKind === "help") closeHelp(); else showHelp(); });
  el.pauseBtn.addEventListener("click", () => { sfx.unlock(); if (phase === "playing") pause(); else if (phase === "paused" && overlayKind === "paused") { if (confirming) showPausedCard(); else resume(); } });
  el.soundBtn.addEventListener("click", toggleSound);
  el.back.addEventListener("click", () => { clearLater(); });

  // ===== 中断（§8.2） =====
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (phase === "playing") pause(); acc = 0; lastT = null; }
  });
  window.addEventListener("pagehide", () => { clearLater(); stopLoop(); });
  // pagehide の clearLater で消えた続きを戻す（終わって 0.6 秒以内に閉じると、カードが出ないまま止まるため。§19 A3）
  window.addEventListener("pageshow", () => {
    if (hintTimer === 0 && el.hint.textContent) el.hint.textContent = "";       // 消すタイマーが消えたヒント
    if (phase === "over" && overlayKind !== "over") showOverCard();
    else if (overlayKind === "over") {
      // 「押せない」を外すタイマーも消えているので、外し直す
      const unlock = () => el.card.querySelectorAll(".btns button[aria-disabled]").forEach((b) => b.removeAttribute("aria-disabled"));
      const left = CARD_LOCK_MS - (now() - cardShownAt);
      if (left > 0) later(unlock, left); else unlock();
    }
  });

  // ===== 大きさ・向き（§6.2） =====
  let layoutQueued = false;
  function portraitTip() {
    if (portraitTipShown) return;
    if (render.scale < SMALL_SCALE && window.innerWidth > window.innerHeight) {
      portraitTipShown = true;
      setHint(HINT_PORTRAIT, 4000);
    }
  }
  function doLayout() {
    layoutQueued = false;
    const before = render.scale;
    render.resize();
    const o = orientNow();
    const changed = (lastOrient && o !== lastOrient) || (before > 0 && Math.abs(render.scale - before) / before > 0.03);
    lastOrient = o;
    lastScale = render.scale;
    // 回の途中で向き・大きさが変わったら、layout はそのまま（倍率だけ直す）で一時停止（§6.2）
    // ただし機体がまだ1機も出ていない間は止めない（起動直後の大きさの揺れで止まらないように。§19 A6）
    if (changed && phase === "playing" && firstPlane) pause();
    portraitTip();
    redraw();
  }
  function relayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(doLayout);
  }
  window.addEventListener("resize", relayout);
  window.addEventListener("orientationchange", relayout);
  if (window.ResizeObserver) {
    let lw = 0, lh = 0;
    new ResizeObserver(() => {
      const p = el.field.parentElement;
      const w = p.clientWidth, h = p.clientHeight;
      if (Math.abs(w - lw) < 1 && Math.abs(h - lh) < 1) return;
      lw = w; lh = h;
      relayout();
    }).observe(el.field.parentElement);
  }

  // ===== 拡大・長押しメニューを止める（場とボタンの所は input.js） =====
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("touchmove", (e) => { if (e.cancelable && !(e.target.closest && e.target.closest(".overlay"))) e.preventDefault(); }, { passive: false });

  // ===== テスト用の公開 API（§8.6） =====
  function snapshot() {
    const s = state || {};
    const planes = planesOf(state).map((p) => ({
      id: p.id, color: p.color, kind: p.kind, x: p.x, y: p.y, dx: p.dx, dy: p.dy, speed: p.speed, near: !!p.near, phase: p.phase, guided: !!p.guided,
      pathLeft: Array.isArray(p.path) ? Math.max(0, p.path.length - (p.pathI | 0)) : 0
    }));
    const warns = (Array.isArray(s.warns) ? s.warns : []).map((w) => ({ id: w.id, color: w.color, kind: w.kind, x: w.x, y: w.y, dx: w.dx, dy: w.dy, spawnTick: w.spawnTick }));
    const runways = state ? (safeCall(() => L.runwaysFor(state), []) || []).map((r) => ({ color: r.color, ex: r.ex, ey: r.ey, dx: r.dx, dy: r.dy, open: !!r.open })) : [];
    const log = render.drawLog || { marks: [], arrows: [] };
    return {
      phase, overlay: overlayKind, layout: s.layout || null, plan: Number.isSafeInteger(s.plan) ? s.plan : 0, w: s.w || 0, h: s.h || 0, tick: s.tick | 0,
      landed: s.landed | 0, lives: Number.isFinite(s.lives) ? s.lives : LIVES, over: !!s.over, colors: s.colors | 0, best,
      planes, warns, runways, stats: Object.assign({}, s.stats || {}), selected,
      scale: render.scale, paused: phase === "paused" || phase === "help", manual: manualMode, timers: timers.size, runId,
      calm: !!render.calm, frames: render.frames, lastDrawMs: render.lastDrawMs,
      drawLog: { marks: log.marks.map((m) => Object.assign({}, m)), arrows: log.arrows.map((a) => Object.assign({}, a)) },
      slowmo, hint: el.hint.textContent
    };
  }
  window.MichibikiGame = Object.freeze({
    getState: snapshot,
    manual(on) { manualMode = !!on; acc = 0; ensureLoop(); return manualMode; },
    tick(n) {
      const k = Number.isInteger(n) && n >= 0 && n <= 36000 ? n : (n === undefined ? 1 : 0);
      if (phase !== "playing" || !state || state.over) return [];
      let evs = [];
      for (let i = 0; i < k; i++) {
        evs = evs.concat(stepOnce());
        if (phase !== "playing" || state.over) break;
      }
      redraw();
      return evs;
    },
    drawPath(id, pts) {
      if (!state) return { ok: false, guided: false, reason: "over" };
      const r = safeCall(() => L.setPath(state, id, pts), null);
      if (!r) return { ok: false, guided: false, reason: "error" };
      if (r.ok && r.state) { state = r.state; dropDrawingsOf(id); if (r.guided) sfx.play("lock"); }
      redraw();
      return { ok: !!r.ok, guided: !!r.guided, wrongWay: !!r.wrongWay, reason: r.reason };
    },
    guide(id, color) { return guide(id, color); },
    spawn(opts) {
      if (!state || state.over) return null;
      const s = safeCall(() => L.forceSpawn(state, opts || {}), null);
      if (!s) return null;
      const before = new Set((state.warns || []).map((w) => w.id));
      state = s;
      redraw();
      const w = (s.warns || []).find((x) => !before.has(x.id));
      return w ? { id: w.id } : null;
    },
    restart(seed, layout, plan) { const sd = Number(seed), given = seed !== undefined && Number.isFinite(sd); return startGame(given ? sd : newSeed(), layout, Number.isSafeInteger(plan) ? plan : given ? 0 : undefined); },
    pause() { return pause(); },
    resume() { return resume(); },
    toScreen(x, y) { return render.toScreen(x, y); },
    toField(cx, cy) { return render.toField(cx, cy); },
    planeRect(id) {
      const p = planeById(id);
      if (!p) return null;
      const [l, t] = render.toScreen(p.x - PLANE_R, p.y - PLANE_R);
      const [r2, b] = render.toScreen(p.x + PLANE_R, p.y + PLANE_R);
      return { left: l, top: t, width: r2 - l, height: b - t };
    },
    setSlowmo(rate) { const r = Number(rate); if (SLOWMO_RATES.includes(r)) slowmo = r; return slowmo; }
  });

  // ===== デバッグ命令（?debug=1 のときだけ。§9） =====
  const D = window.YubiDebug;
  if (D && typeof D.command === "function") {
    safeCall(() => {
      D.command("planes", () => {
        const s = snapshot();
        return { tick: s.tick, planes: s.planes, warns: s.warns };
      }, { desc: "機体と予告の一覧（id・色・種類・位置・速さ・道の残り・near・phase）", args: "なし" });
      D.command("slowmo", (a) => ({ rate: window.MichibikiGame.setSlowmo(a && a.rate !== undefined ? a.rate : 1) }),
        { desc: "ゆっくり動かす（0.25・0.5・1）", args: "{ rate }" });
      D.command("spawn", (a) => {
        const o = a || {};
        const opts = {};
        if (o.color !== undefined) opts.color = Number(o.color);
        if (o.kind !== undefined) opts.kind = String(o.kind);
        if (o.edge !== undefined) opts.edge = o.edge;
        for (const k of ["x", "y", "dx", "dy", "at"]) if (o[k] !== undefined) opts[k] = Number(o[k]);
        const r = window.MichibikiGame.spawn(opts);
        if (!r) throw new Error("いまは出せない（終わっている・始まっていない）");
        return r;
      }, { desc: "すぐに予告を足す", args: "{ color?, kind?, edge?, at?, x?, y?, dx?, dy? }" });
    }, null);
  }

  // ===== 起動（§8.1） =====
  (function boot() {
    render.resize();
    if (!safeCall(() => L.validateFlag(readKey(KEY_HELP)), false)) {
      // 初回：遊び方を出し、閉じたら回を始める（後ろには始まりの場を見せておく）
      makeGame(newSeed(), orientNow());
      hud();
      redraw();
      helpReturn = "start";
      setPhase("help");
      showHelp();
      lastOrient = orientNow();
    } else {
      startGame(newSeed());
    }
  })();
})();

// オフラインでも遊べるようにする（https か localhost のときだけ有効）
if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("../../sw.js").catch(() => { /* 登録できなくてもゲームは遊べる */ });
  });
}
