/*
 * ハシわたり — 進行（状態の進め方・アニメーション・タイマー・保存・設定・テスト用 API）
 *
 * 契約書 docs/hashi-contract.md の §9 と §12 に従う。
 * 読み込み順：../../common/sfx.js → course.js → logic.js → render.js → input.js → main.js
 *
 * - 時刻は now()（performance.now）だけから取る。event.timeStamp・Date.now と混ぜない（§13-6）
 * - アニメーションは requestAnimationFrame の1本だけ。1フレームの経過は最大 50ms
 * - タイマーは later() だけで作る。clearLater() で片付ける。runId が違う回のコールバックは動かない（§13-7）
 */
(() => {
  "use strict";

  const L = window.HashiLogic;
  if (!L || typeof L.createRun !== "function") {
    throw new Error("ハシわたり: HashiLogic が読み込まれていません（logic.js を main.js より前に読み込んでください）");
  }

  const KEY_BEST = L.SAVE_KEY_BEST || "hashi.best";
  const KEY_HELP = "hashi.help";
  const KEY_SLOW = "hashi.slow";
  const KEY_GUIDE = "hashi.guide";
  const KEY_TAP = "hashi.tap";
  const KEY_STAGE = L.SAVE_KEY_STAGE || "hashi.stage";   // ステージの到達（つづきから）
  const KEY_MODE = "hashi.mode";                         // さいごに選んだ遊び方（"stage" | "endless"）
  const C = window.HashiCourse;

  const HINT_HOLD = "ながく おして、はなしてね";
  const HINT_TAP = "タップで のばして、もう一度 タップ";
  const STAGE_LABEL_HOLD = "ながく おすと くきが のびる。はなすと たおれる";
  const STAGE_LABEL_TAP = "タップすると くきが のびる。もう一度 タップすると たおれる";
  const WALK_SPEED = 600;       // 歩く速さ（論理単位/秒、一定）
  const STEP_EVERY = 0.14;      // 足音の間隔（秒）
  const DROP_DEPTH = 140;       // 落ちる深さ（hero.y は上が正。水の中は負）
  const PEEK_Y = 30;            // 水から顔を出す深さ
  const HOP_H = 18;             // 着地の小さな跳ね（案8）
  const HOP_DUR = 0.22;
  // 演出の長さは render.js と同じ値を使う（食い違うと、描き終わった後も rAF が回る）
  const PERFECT_FX_SEC = (window.HashiRender && Number(window.HashiRender.PERFECT_FX_SEC)) || 1.0;
  const SPLASH_SEC = (window.HashiRender && Number(window.HashiRender.SPLASH_SEC)) || 0.9;
  const SKIP_FX_SEC = (window.HashiRender && Number(window.HashiRender.SKIP_FX_SEC)) || 1.0;
  const FLAG_FX_SEC = (window.HashiRender && Number(window.HashiRender.FLAG_FX_SEC)) || 1.0;
  // 花火の打ち上げ（render.js と同じ表。1発ごとに音を鳴らす）
  const FIREWORKS = (window.HashiRender && Array.isArray(window.HashiRender.FIREWORKS)) ? window.HashiRender.FIREWORKS : [];
  const LOTUS_AT = (window.HashiRender && Number(window.HashiRender.LOTUS_AT)) || 1.1;
  const CARD_LOCK_MS = 400;     // 結果カードを出してから押せない時間
  const STAGE_BLOCK_MS = 300;   // カードを閉じた後、#stageWrap の押下を受けない時間
  const CLEAR_SEC = 2.9;         // ステージクリアの演出（跳ねる→花火→蓮の花）。タップで早送り
  const CLEAR_SEC_CALM = 1.2;    // 動きを減らす設定のとき（花が静かに咲くだけ）
    const ANIM_PHASES = ["falling", "walking", "scrolling", "dropping", "respawn", "clear"];

  const now = () => performance.now();
  const $ = (id) => document.getElementById(id);
  const el = {
    playView: $("playView"), stageWrap: $("stageWrap"), canvas: $("stage"), hint: $("hint"), sr: $("sr"),
    score: $("score"), best: $("best"), lives: $("lives"), scoreLabel: $("scoreLabel"), bestLabel: $("bestLabel"), livesBox: $("livesBox"), hearts: $("hearts"), streak: $("streak"), streakBox: $("streakBox"),
    helpBtn: $("helpBtn"), soundBtn: $("soundBtn"), overlay: $("overlay"), card: $("card")
  };
  const missing = Object.keys(el).filter((k) => !el[k]);
  if (missing.length) throw new Error("ハシわたり: 画面の部品が見つかりません：" + missing.join(", "));

  const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  const D = (sec) => (reduceMotion.matches ? Math.min(sec, 0.05) : sec);

  // ===== 効果音（common/sfx.js が無くても音なしで遊べる） =====
  const sfx = window.YubiSfx && typeof window.YubiSfx.create === "function" ? window.YubiSfx.create("hashi")
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

  // ===== 保存と設定（保存できなくても遊べる） =====
  function readKey(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeKey(key, val) {
    try { localStorage.setItem(key, val); return true; } catch (e) { return false; /* 保存できなくても遊べる */ }
  }
  let best = L.validateBest(readKey(KEY_BEST));
  let slow = L.validateFlag(readKey(KEY_SLOW));
  let guide = L.validateFlag(readKey(KEY_GUIDE));
  let tap = L.validateFlag(readKey(KEY_TAP));   // タップ式（押し続けなくてよい）
  // ステージの到達は壊れていても 1 として遊べる。読めた値は書き換えない（先へ進んだときだけ書く）
  let stageReach = L.validateStage(readKey(KEY_STAGE));
  let mode = readKey(KEY_MODE) === "stage" ? "stage" : "endless";
  let curStage = stageReach;     // 遊んでいるステージ
  const hintReady = () => (tap ? HINT_TAP : HINT_HOLD);
  function renderStageLabel() { el.stageWrap.setAttribute("aria-label", tap ? STAGE_LABEL_TAP : STAGE_LABEL_HOLD); }
  // 読み上げ（#sr、aria-live=polite）：結果ごとに1文だけ入れる。#hint の「元に戻す」は読ませない
  function announce(text) { el.sr.textContent = text; }
  const saveBest = () => writeKey(KEY_BEST, String(best));
  const helpSeen = () => readKey(KEY_HELP) === "1";

  // ===== タイマー（later / clearLater / runId） =====
  let runId = 0;
  const timers = new Set();
  function later(fn, ms) {
    const myRun = runId;
    const id = setTimeout(() => {
      timers.delete(id);
      if (myRun !== runId) return;
      fn();
    }, ms);
    timers.add(id);
    return id;
  }
  function cancelLater(id) {
    if (!timers.has(id)) return;
    clearTimeout(id);
    timers.delete(id);
  }
  function clearLater() {
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
  }

  // ===== 状態 =====
  let run = null;               // HashiLogic の state（イミュータブル）
  let pending = null;           // 離した瞬間の resolve 結果（演出が終わるまで run に入れない）
  let phase = "ready";          // ready | growing | falling | walking | scrolling | dropping | respawn | over
  let paused = false;
  let overlayKind = null;       // null | help | pause | result
  let helpReturn = null;        // 遊び方を閉じた後に戻す先：resume | pause | result | none
  let lastOutcome = null;
  let improvedThisRun = false;
  let randomSeq = null;         // setRandom で入れた乱数の列
  let cardShownAt = -Infinity;
  let blockUntil = -Infinity;

  // 演出の値
  let clock = 0;                // ゲーム内の時計（秒）。止めている間は進まない
  let phaseStart = 0, phaseDur = 0;
  let holdStartAt = 0;
  let bridgeLen = 0, bridgeAngle = 0;
  let heroX = 0, heroY = 0, heroPose = "stand";
  let cameraX = 0, camFrom = 0, camTo = 0;
  let walkFrom = 0, walkTo = 0, nextStep = 0;
  let prevLeaves = [];          // 渡った直後、画面を送る間だけ描く「元の葉」（ひとつ飛ばしなら、飛び越えた葉も）
  let ghostTipY = 0, clearAt = 0, bridgeBase = { x: 0, y: 0 }, heroBaseY = 0, dropFromY = 0;
  let ghostTipX = null, perfectAt = null, splashAt = null, skipAt = null, skipX = null, flagAt = null, flagX = null;
  let perfectX = null, splashX = null;
  let peeked = false;

  const curRight = () => run.platforms[0].x + run.platforms[0].w;
  const shownPhase = () => (paused ? "paused" : phase);
  function setPhase(p, dur) {
    phase = p;
    phaseStart = clock;
    phaseDur = dur || 0;
    el.playView.dataset.phase = shownPhase();
    dirty = true;
    startLoop();
  }
  function syncPhaseAttr() { el.playView.dataset.phase = shownPhase(); }
  function setHolding(on) { el.stageWrap.dataset.holding = on ? "1" : "0"; }
  let hintTimer = 0;
  // 案内を変える。新しい案内を出したら、前の「元に戻す」予約は取り消す
  function setHint(text) {
    if (hintTimer) { cancelLater(hintTimer); hintTimer = 0; }
    if (el.hint.textContent !== text) el.hint.textContent = text;
  }

  // 表示：ロジックの値をそのまま出す（UI で +1・-1 をしない。§13-1）
  // 桁数で字の大きさの段階を決める（CSS が data-size を見る。ふだんの桁は 20px 以上、16 桁は縮めて収める）
  const sizeOf = (text) => (text.length <= 6 ? "s" : text.length <= 10 ? "m" : "l");
  function setNum(node, value) {
    const text = String(value);
    if (node.textContent !== text) node.textContent = text;
    const size = sizeOf(text);
    if (node.dataset.size !== size) node.dataset.size = size;
  }
  // いのちは ♥（のこり）と ♡（へった分）で見せる。数字だけに頼らない
  const hearts = (n) => "♥".repeat(Math.max(0, n)) + "♡".repeat(Math.max(0, L.LIVES - Math.max(0, n)));
  function hud() {
    const h = L.hud(run);
    const st = run.mode === "stage";
    // ステージ：「わたった 3/5」「ステージ 4」。いのちは使わない（落ちたらそのステージの最初から）
    const sl = st ? "わたった" : "いま", bl = st ? "ステージ" : "ベスト";
    if (el.scoreLabel.textContent !== sl) el.scoreLabel.textContent = sl;
    if (el.bestLabel.textContent !== bl) el.bestLabel.textContent = bl;
    el.livesBox.hidden = st;
    el.playView.dataset.mode = run.mode;
    setNum(el.score, st ? `${h.crossed}/${run.goal}` : h.score);
    setNum(el.best, st ? run.stage : best);
    el.lives.textContent = String(h.lives);
    if (el.hearts) el.hearts.textContent = hearts(h.lives);
    el.streak.textContent = String(h.streak);
    el.streakBox.hidden = !(h.streak >= 1);
  }

  // ===== 描画 =====
  const renderer = window.HashiRender && typeof window.HashiRender.create === "function"
    ? window.HashiRender.create(el.canvas) : { resize() {}, draw() {} };
  if (!window.HashiRender) console.error("ハシわたり: HashiRender が読み込まれていません（render.js）。絵は出ません");
  function viewPlatforms() {
    // ステージは全部の葉（ゴールまで）を描く。画面の外の葉は描画が省く
    if (run.mode === "stage" && C && typeof C.stageCourse === "function") return C.stageCourse(run.stage);
    return prevLeaves.concat(run.platforms);
  }
  const yOf = (p) => (p && Number.isFinite(p.y) ? p.y : 0);
  const curY = () => yOf(run.platforms[0]);
  // ステージのいちばん高い葉（描画は、その上から真上に伸ばした茎も画面に入る縮尺にする）
  function liftMax() {
    if (run.mode !== "stage" || !C || typeof C.stageCourse !== "function") return 0;
    return C.stageCourse(run.stage).reduce((m, p) => Math.max(m, yOf(p)), 0);
  }
  // 取った旗の葉の x（まだなら null）
  function flagGotX() {
    if (run.mode !== "stage" || !(run.checkpoint > 0) || !C) return null;
    const p = C.stageCourse(run.stage)[run.checkpoint];
    return p ? p.x : null;
  }
  // ガイドの点線：渡る先の高さに倒したときの先（届かなければ水平）
  function guideTip() {
    const bx = curRight(), target = run.platforms[1];
    const x = target ? L.reachX(bx, curY(), bridgeLen, yOf(target)) : null;
    return x === null ? bx + bridgeLen : x;
  }
  function draw() {
    const fxAge = (at, sec) => (at === null ? null : (clock - at <= sec ? clock - at : null));
    try {
      renderer.draw({
        platforms: viewPlatforms(),
        cameraX,
        hero: { x: heroX, y: heroY, pose: heroPose },
        bridge: { len: bridgeLen, angle: bridgeAngle, x: bridgeBase.x, y: bridgeBase.y },
        clearFx: phase === "clear" || phase === "cleared" ? { sec: clock - clearAt, calm: reduceMotion.matches, x: heroX, n: run.goal } : null,
        liftMax: liftMax(),
        flagGotX: flagGotX(),
        flagFx: fxAge(flagAt, FLAG_FX_SEC),
        flagX,
        perfectFx: fxAge(perfectAt, PERFECT_FX_SEC),
        perfectX,
        skipFx: fxAge(skipAt, SKIP_FX_SEC),
        skipX,
        ghostTipX, ghostTipY,
        guideTipX: guide && phase === "growing" ? guideTip() : null,
        splash: fxAge(splashAt, SPLASH_SEC),
        splashX,
        lives: run.lives,
        t: clock
      });
    } catch (e) {
      console.error("ハシわたり: 描画で失敗しました", e);
    }
  }
  function resize() {
    try { renderer.resize(); } catch (e) { console.error("ハシわたり: 描画の大きさ合わせで失敗しました", e); }
    dirty = true;
    startLoop();
  }

  // ===== ゲームループ（rAF 1本） =====
  let raf = 0, lastFrame = 0, dirty = true;
  const fxActive = () => (perfectAt !== null && clock - perfectAt <= PERFECT_FX_SEC)
    || (skipAt !== null && clock - skipAt <= SKIP_FX_SEC)
    || (flagAt !== null && clock - flagAt <= FLAG_FX_SEC)
    || (splashAt !== null && clock - splashAt <= SPLASH_SEC);
  const isAnimating = () => !paused && !overlayKind
    && (phase === "growing" || ANIM_PHASES.includes(phase) || (fxActive() && !reduceMotion.matches));
  function startLoop() {
    if (raf) return;
    const myRun = runId;
    raf = requestAnimationFrame(() => loop(myRun));
  }
  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastFrame = 0;
  }
  function loop(myRun) {
    raf = 0;
    if (myRun !== runId) return;
    const t = now();
    const dt = lastFrame ? Math.min(0.05, Math.max(0, (t - lastFrame) / 1000)) : 0;
    lastFrame = t;
    const live = !paused && !overlayKind;
    if (live) { clock += dt; tick(); }
    const animating = isAnimating();
    if (dirty || animating || live) { dirty = false; draw(); }
    if (animating) startLoop();
    else lastFrame = 0;
  }

  let restartPending = false, clearPending = false, clearStep = 0, bloomed = false;
  let skipping = false;   // HashiGame.skip の間だけ true（浮動小数の誤差で終わり損ねないよう k を 1 にする）
  function tick() {
    const e = skipping ? Math.max(clock - phaseStart, phaseDur) : clock - phaseStart;
    const k = skipping || phaseDur <= 0 ? 1 : Math.min(1, e / phaseDur);
    switch (phase) {
      case "growing": {
        bridgeLen = L.lengthFromHold(now() - holdStartAt, { slow });
        sfx.play("grow", bridgeLen / L.MAX_LEN);
        break;
      }
      case "falling": {
        const a1 = pending && Number.isFinite(pending.outcome.angle) ? pending.outcome.angle : Math.PI / 2;
        bridgeAngle = k * a1;   // 斜めに倒れる（先の葉の高さに向けて）
        if (k >= 1) { sfx.play("tip"); startWalk(); }
        break;
      }
      case "walking": {
        heroX = walkFrom + (walkTo - walkFrom) * k;
        heroPose = "walk";
        {
          // 斜めの茎の上は高さも変わる。茎の先から先は着いた葉の高さ
          const o = pending.outcome, tx = o.tipX, ty = Number.isFinite(o.tipY) ? o.tipY : 0;
          heroY = heroX < tx && tx > walkFrom ? heroBaseY + (ty - heroBaseY) * ((heroX - walkFrom) / (tx - walkFrom)) : ty;
        }
        if (e >= nextStep && k < 1) { sfx.play("walk"); nextStep += STEP_EVERY; }
        if (k >= 1) arrive();
        break;
      }
      case "scrolling": {
        const s = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        cameraX = camFrom + (camTo - camFrom) * s;
        const hop = reduceMotion.matches ? 1 : Math.min(1, e / HOP_DUR);
        heroY = heroBaseY + (hop < 1 ? HOP_H * Math.sin(Math.PI * hop) : 0);
        heroPose = hop < 1 ? "hop" : "stand";
        if (k >= 1) finishCross();
        break;
      }
      case "dropping": {
        const a0 = pending && Number.isFinite(pending.outcome.angle) ? pending.outcome.angle : Math.PI / 2;
        bridgeAngle = a0 + k * (Math.PI - a0);
        heroY = dropFromY - k * (dropFromY + DROP_DEPTH);
        heroPose = "fall";
        if (k >= 1) splashDown();
        break;
      }
      case "respawn": {
        heroPose = "peek";
        heroY = -PEEK_Y;
        if (!peeked && e >= Math.min(0.3, phaseDur / 2)) { peeked = true; sfx.play("peek"); }
        if (k >= 1) {
          if (!peeked) { peeked = true; sfx.play("peek"); }
          if (restartPending && run.crossed > 0) {
            // ステージで旗を取った後に落ちた：「さいごの はたから」「さいしょから」を選ぶ
            setPhase("retry", 0);
            showRetryCard();
          } else if (restartPending) {
            backToStart();
          } else {
            toReady();
          }
        }
        break;
      }
      case "clear": {
        // ケロが跳ねて喜ぶ → 花火（1発ごとに音）→ 蓮の花が咲く（描くのは render.js の clearFx）。動きを減らす設定では跳ねない・花火なし
        const calm = reduceMotion.matches;
        heroPose = calm || e > 1.4 ? "stand" : "hop";
        heroY = heroBaseY + (calm || e > 1.4 ? 0 : HOP_H * 1.6 * Math.abs(Math.sin(e * Math.PI * 3)));
        if (!calm) {
          while (clearStep < FIREWORKS.length && e >= FIREWORKS[clearStep].t) {
            sfx.play("firework", (clearStep % 3) + 1);
            clearStep += 1;
          }
        }
        if (!bloomed && (calm || e >= LOTUS_AT)) { bloomed = true; sfx.play("bloom"); }
        if (k >= 1) finishClear();
        break;
      }
      default: break;
    }
  }

  // ===== 状態の流れ =====
  // ステージで落ちた後：戻り先の葉（旗の葉か、はじめの葉）へ戻って、画面もそこへ送る
  function backToStart() {
    restartPending = false;
    ghostTipX = null;
    heroX = curRight(); heroBaseY = curY(); heroY = heroBaseY; heroPose = "hop";
    bridgeLen = 0; bridgeAngle = 0;
    bridgeBase = { x: curRight(), y: heroBaseY };
    camFrom = cameraX; camTo = curRight() - L.CAMERA_LEFT;
    setPhase("scrolling", D(0.5));
  }
  function toReady() {
    bridgeLen = 0; bridgeAngle = 0;
    heroBaseY = curY();
    bridgeBase = { x: curRight(), y: heroBaseY };
    heroX = curRight(); heroY = heroBaseY; heroPose = "stand";
    prevLeaves = [];
    pending = null;
    setHolding(false);
    setPhase("ready", 0);
  }
  function startWalk() {
    const o = pending.outcome;
    walkFrom = curRight();
    walkTo = o.kind === "cross" ? o.landX : o.tipX;
    nextStep = 0;
    setPhase("walking", D(Math.abs(walkTo - walkFrom) / WALK_SPEED));
  }
  function arrive() {
    const o = pending.outcome;
    if (o.kind === "cross") {
      prevLeaves = o.skip ? run.platforms.slice(0, 2) : [run.platforms[0]];
      run = pending.state;
      lastOutcome = o;
      heroX = o.landX;
      heroBaseY = curY(); heroY = heroBaseY;
      sfx.play("land");
      if (o.skip) {
        sfx.play("skip");
        skipAt = clock;
        skipX = run.platforms[0].x + run.platforms[0].w / 2;
      }
      const st = run.mode === "stage";
      const skipWord = o.skip ? "とばし！ " : "";
      // ステージは点ではなく「わたった本数」を見せるので、案内に点は出さず、飛ばしたら「2まい すすんだ」
      const gainWord = st ? (o.skip ? " 2まい すすんだ" : "") : ` +${o.gain}`;
      if (o.perfect) {
        sfx.play("perfect", Math.min(Math.max(o.streak, 1), 5));
        perfectAt = clock;
        perfectX = run.platforms[0].x + run.platforms[0].w / 2;
        setHint(`${skipWord}ぴったり！${gainWord}`);
      } else if (o.skip) {
        setHint(`とばし！${gainWord}`);
      } else {
        setHint("わたれた！");
      }
      if (st) announce(`${o.skip ? "とばし。2まい すすんだ。" : ""}${o.perfect ? "ぴったり。" : ""}わたった ${run.crossed}まい。のこり ${run.goal - run.crossed}まい`);
      else announce(`${o.skip ? "とばし。" : ""}${o.perfect ? "ぴったり。" : o.skip ? "" : "わたれた。"}${o.gain}てん。ごうけい ${run.score}てん。のこり ${run.lives}`);
      if (st && o.skip) bump();
      if (o.flag) {
        // 旗：落ちても ここから（ひとつ飛ばしで旗の葉を飛び越えたときも）
        flagAt = clock;
        const fp = C && C.stageCourse ? C.stageCourse(run.stage)[o.checkpoint] : null;
        flagX = fp ? fp.x + fp.w / 2 : heroX;
        sfx.play("bloom");
        setHint(`${skipWord}はた！ おちても ここから`);
        announce(`はたを とった。おちても ここから。わたった ${run.crossed}まい`);
        bump();
      }
      if (o.cleared) {
        // ステージクリア：到達をすぐ保存（演出の途中で閉じても消えない）
        clearPending = true;
        const r = L.recordStage(stageReach, run.stage);
        if (r.improved) { stageReach = r.stage; writeKey(KEY_STAGE, String(stageReach)); }
        setHint(`ステージ ${run.stage} クリア！`);
        announce(`ステージ ${run.stage} クリア。`);
      } else {
        hintTimer = later(() => { hintTimer = 0; setHint(hintReady()); }, 1500);
      }
      if (run.mode !== "stage") updateBest();
      hud();
      camFrom = cameraX;
      camTo = o.landX - L.CAMERA_LEFT;
      setPhase("scrolling", D(0.3));
    } else {
      dropFromY = Number.isFinite(o.tipY) ? o.tipY : 0;
      setPhase("dropping", D(0.5));
    }
  }
  function finishCross() {
    cameraX = camTo;
    if (clearPending) { clearPending = false; startClear(); return; }
    toReady();
  }
  function startClear() {
    clearAt = clock;
    clearStep = 0; bloomed = false;
    heroBaseY = curY();
    sfx.play("clear");
    setPhase("clear", D(reduceMotion.matches ? CLEAR_SEC_CALM : CLEAR_SEC));
  }
  // 演出の終わり（またはタップで早送り）：「ステージ N クリア！」のカード
  function finishClear() {
    if (phase !== "clear") return;
    clock = Math.max(clock, phaseStart + phaseDur);   // 花はすべて咲いた姿で残す
    heroY = heroBaseY; heroPose = "stand";
    setPhase("cleared", 0);
    showResult(true);
  }
  function splashDown() {
    const o = pending.outcome;
    const target = run.platforms[1];
    run = pending.state;
    lastOutcome = o;
    splashAt = clock;
    splashX = o.tipX;
    ghostTipX = target.x + target.w / 2;   // 「ここまで要った」の影（案10）
    ghostTipY = yOf(target);
    sfx.play("splash");
    sfx.buzz([40]);
    const why = whyWord(o);
    hud();
    if (o.over) {
      setHint(`${o.near && o.zone !== "aim" ? "おしい！ " : ""}${why}`);
      announce(`${o.near ? "おしい。" : ""}${why}。おしまい。とくてん ${o.score}`);
      heroPose = "fall";
      setPhase("over", 0);
      showResult(true);
    } else if (o.restart) {
      const near = o.near && o.zone !== "aim" ? "おしい！ " : "";
      if (o.from > 0) {
        setHint(`${near}${why}`);
        announce(`${near ? "おしい。" : ""}${why}。さいごの はたから？ さいしょから？`);
      } else {
        setHint(`${near}${why}。さいしょから`);
        announce(`${near ? "おしい。" : ""}${why}。ステージ ${o.stage} の さいしょから`);
      }
      restartPending = true;
      heroX = o.tipX;
      peeked = false;
      setPhase("respawn", D(0.8));
    } else {
      const near = o.near && o.zone !== "aim" ? "おしい！ " : "";
      setHint(`${near}${why}。あと ${o.lives}かい`);
      announce(`${near ? "おしい。" : ""}${why}。のこり ${o.lives}`);
      heroX = o.tipX;
      peeked = false;
      setPhase("respawn", D(0.8));
    }
  }
  // 落ちた所に合わせた短い言葉（2つ先を ねらったか、2つ先にも届かなかったか）
  function whyWord(o) {
    if (o.reason === "short") return "みじかすぎ";
    if (o.zone === "aim") return "2つ さきを ねらったけど ちょっと みじかかった";
    if (o.zone === "between") return "ながすぎ。2つ さきの はっぱにも とどかなかった";
    if (o.zone === "over") return "ながすぎ。2つ さきも こえちゃった";
    return "ながすぎ";
  }
  // 「わたった」の数字を跳ねさせる（動きを減らす設定では CSS が止める）
  function bump() {
    el.score.classList.remove("bump");
    void el.score.offsetWidth;   // アニメーションを最初から
    el.score.classList.add("bump");
  }
  function updateBest() {
    const r = L.recordBest(best, run.score);
    if (r.improved) {
      best = r.best;
      improvedThisRun = true;
      saveBest();   // 超えた時点ですぐ書く
    }
  }

  function makeRandom() {
    if (!randomSeq) return Math.random;
    const seq = randomSeq;
    let i = 0;
    return () => { const v = seq[i % seq.length]; i += 1; return v; };
  }
  function startRun() {
    clearLater();   // 前の回のタイマーを片付ける（もう一度・起動）
    stopLoop();
    runId += 1;
    if (input) input.reset();
    run = L.createRun({ random: makeRandom(), mode, stage: curStage });
    pending = null;
    restartPending = false; clearPending = false;
    lastOutcome = null;
    improvedThisRun = false;
    paused = false;
    ghostTipX = null; perfectAt = null; splashAt = null; skipAt = null; flagAt = null;
    el.score.classList.remove("bump");
    cameraX = curRight() - L.CAMERA_LEFT;
    setHint(hintReady());
    announce("");
    hud();
    toReady();
  }

  // ===== 入力 =====
  let viaTest = false;   // HashiGame.holdFor の間だけ true（カードを閉じた直後の 300ms は画面の押下だけを止める）
  function canStartHold() {
    return phase === "ready" && !paused && !overlayKind && (viaTest || now() >= blockUntil);
  }
  function onHoldStart(info) {
    if (phase === "clear" && !paused && !overlayKind) { finishClear(); return false; }   // タップで早送り
    if (!canStartHold()) return false;
    holdStartAt = info && Number.isFinite(info.at) ? info.at : now();
    bridgeLen = 0; bridgeAngle = 0;
    ghostTipX = null;
    setHint(hintReady());
    setHolding(true);
    setPhase("growing", 0);
    return true;
  }
  function cancelHold() {
    if (phase !== "growing") return;
    toReady();
  }
  function onHoldEnd(info) {
    if (phase !== "growing") return;
    const holdMs = info && Number.isFinite(info.holdMs) ? info.holdMs : now() - holdStartAt;
    setHolding(false);
    if (holdMs < L.MIN_HOLD_MS) { toReady(); return; }   // うっかりタッチは無視（落ちない）
    bridgeLen = L.lengthFromHold(holdMs, { slow });     // 見えていた長さと同じ関数で確定
    const res = L.resolve(run, bridgeLen);
    if (res.outcome.kind === "ignore") { toReady(); return; }
    pending = res;
    setPhase("falling", D(0.25));
  }
  const holdCbs = {
    onHoldStart, onHoldEnd,
    onHoldCancel() { cancelHold(); }
  };
  let input = null;
  if (window.HashiInput && typeof window.HashiInput.attach === "function") {
    input = window.HashiInput.attach(el.stageWrap, holdCbs, { now, tapMode: () => tap });
  } else {
    console.error("ハシわたり: HashiInput が読み込まれていません（input.js）。押して遊べません");
  }
  let testCore = null;   // HashiGame.holdFor 用（DOM に依存しない核）

  // ===== 中断（§13-3） =====
  // hidden・遊び方を開いたとき：growing なら取り消し、演出中なら paused
  function abortHold() {
    if (input) input.reset();   // 押しっぱなしの指・キーは、押し直すまで数えない
    cancelHold();
  }
  function suspend() {
    clearLater();
    if (phase === "growing") abortHold();   // 押下を取り消す（落ちない・いのちも減らない）
    if (ANIM_PHASES.includes(phase) && !paused) {
      paused = true;
      syncPhaseAttr();
    }
    stopLoop();
  }
  function resume() {
    if (!paused) return;
    paused = false;
    hideOverlay();
    syncPhaseAttr();
    lastFrame = 0;
    dirty = true;
    startLoop();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { suspend(); return; }
    if (paused && !overlayKind) showPauseCard();
    else { unlockCard(); dirty = true; startLoop(); }
  });
  window.addEventListener("pagehide", () => { suspend(); saveBest(); });

  // ===== カード =====
  // 骨組みだけ HTML で書き、文言は data-f の要素に textContent で入れる
  function showCard(html, fields, kind) {
    el.card.innerHTML = html;
    delete el.card.dataset.help;
    el.card.querySelectorAll("[data-f]").forEach((n) => { n.textContent = fields[n.dataset.f] ?? ""; });
    el.overlay.hidden = false;
    overlayKind = kind;
    stopLoop();
    const primary = el.card.querySelector(".primary");
    if (primary) { try { primary.focus({ preventScroll: true }); } catch (e) { primary.focus(); } }
  }
  function hideOverlay() {
    if (!overlayKind && el.overlay.hidden) return;
    el.overlay.hidden = true;
    el.card.innerHTML = "";
    overlayKind = null;
    blockUntil = now() + STAGE_BLOCK_MS;   // 閉じた直後の連打を下に通さない
    dirty = true;
    startLoop();
  }
  // 最後に落ちた理由を1行で（水しぶきの影やヒントはカードの下に隠れるため、カードの中にも書く）
  function whyText() {
    const o = lastOutcome;
    if (!o || o.kind === "cross" || o.kind === "ignore") return "";
    if (o.reason === "short") return "くきが みじかかった。あと すこし ながく！";
    if (o.zone === "aim") return "2つ さきを ねらったけど ちょっと みじかかった。";
    if (o.zone === "between") return "ながすぎ。2つ さきの はっぱにも とどかなかった。";
    return "くきが ながすぎた。あと すこし みじかく！";
  }
  function showResult(withSound) {
    if (run.cleared) { showClearCard(withSound); return; }
    const h = L.hud(run);
    showCard(`
      <h2 id="cardTitle" data-f="h"></h2>
      <p class="res" data-f="score"></p>
      <p data-f="perf"></p>
      <p data-f="why"></p>
      <p class="best-new" data-f="best"></p>
      <div class="btns">
        <button class="cta primary" type="button" data-cmd="again">もう一度</button>
        <button class="cta" type="button" data-cmd="modes">あそびかたを えらぶ</button>
        <button class="cta" type="button" data-cmd="menu">メニューへ</button>
      </div>`, {
      h: `${h.crossed} わたった！`,
      score: `とくてん ${h.score}`,
      perf: `ぴったり ${run.perfects}かい・れんぞく さいこう ${run.bestStreak}`,
      why: whyText(),
      best: improvedThisRun ? `ベスト こうしん！ ${best}`
        : best - h.score > 0 ? `ベスト ${best}（あと ${best - h.score} てん）` : `ベスト ${best}`
    }, "result");
    cardShownAt = now();
    lockCard();
    if (withSound) {
      later(() => sfx.play("over"), 600);
      if (improvedThisRun) later(() => sfx.play("best"), 1100);
    }
  }
  // ステージクリアのカード（演出の後）。出した直後 400ms は押せない（結果カードと同じ）
  function showClearCard(withSound) {
    const n = run.stage;
    showCard(`
      <h2 id="cardTitle"><span class="line" data-f="h1"></span> <span class="line" data-f="h2"></span></h2>
      <p class="res" data-f="sub"></p>
      <p data-f="perf"></p>
      <div class="btns">
        <button class="cta primary" type="button" data-cmd="next" data-f="next"></button>
        <button class="cta" type="button" data-cmd="modes">あそびかたを えらぶ</button>
        <button class="cta" type="button" data-cmd="menu">メニューへ</button>
      </div>`, {
      h1: `ステージ ${n}`,
      h2: "クリア！",
      sub: `はっぱ ${run.goal}まい わたりきった！`,
      perf: `ぴったり ${run.perfects}かい`,
      next: `つぎへ（ステージ ${Math.min(n + 1, L.STAGE_MAX)}）`
    }, "result");
    cardShownAt = now();
    lockCard();
    if (withSound) later(() => sfx.play("best"), 300);
  }
  // さいしょの「どっちで あそぶ？」。さいごに選んだほうにフォーカスを置く（Enter・Space でそのまま始められる）
  function showModeCard() {
    if (overlayKind === "mode") return;
    suspend();
    showCard(`
      <h2 id="cardTitle">どっちで あそぶ？</h2>
      <div class="btns modes">
        <button class="cta" type="button" data-cmd="stage"><span data-f="st"></span><small data-f="stSub"></small></button>
        <button class="cta" type="button" data-cmd="endless"><span data-f="en"></span><small data-f="enSub"></small></button>
        <button class="cta" type="button" data-cmd="menu">メニューへ</button>
      </div>`, {
      st: `ステージ ${stageReach} を あそぶ（つづき）`,
      stSub: `はっぱ ${C && C.stageGoal ? C.stageGoal(stageReach) : 5}まい わたれば クリア`,
      en: `どこまでも あそぶ（ベスト ${best}）`,
      enSub: `いのち ♥ 3つ`
    }, "mode");
    const focus = el.card.querySelector(`[data-cmd="${mode}"]`);
    if (focus) { try { focus.focus({ preventScroll: true }); } catch (e) { focus.focus(); } }
  }
  function chooseMode(m, stageNo) {
    sfx.unlock();
    mode = m === "stage" ? "stage" : "endless";
    writeKey(KEY_MODE, mode);
    curStage = mode === "stage" ? L.validateStage(stageNo === undefined ? stageReach : stageNo) : curStage;
    hideOverlay();
    startRun();
    sfx.play("start");
    if (!helpSeen()) showHelp(true);
  }
  const LOCKED_KINDS = ["result", "retry"];
  // 結果カードを出してから 400ms は押せない。見た目は aria-disabled（disabled にするとフォーカスを置けないため）
  function lockCard() {
    el.card.querySelectorAll(".btns button").forEach((btn) => btn.setAttribute("aria-disabled", "true"));
    later(unlockCard, CARD_LOCK_MS);
  }
  function unlockCard() {
    if (!LOCKED_KINDS.includes(overlayKind) || now() - cardShownAt < CARD_LOCK_MS) return;
    el.card.querySelectorAll(".btns button[aria-disabled]").forEach((btn) => btn.removeAttribute("aria-disabled"));
  }
  // ステージで旗を取った後に落ちた：どこから やり直すか（旗にフォーカス。出した直後 400ms は押せない）
  function showRetryCard() {
    const o = lastOutcome;
    showCard(`
      <h2 id="cardTitle">どこから やりなおす？</h2>
      <p data-f="why"></p>
      <div class="btns">
        <button class="cta primary" type="button" data-cmd="flag">さいごの はたから</button>
        <button class="cta" type="button" data-cmd="restart">さいしょから</button>
      </div>`, {
      why: o && o.kind === "fall" ? `${whyWord(o)}。` : ""
    }, "retry");
    cardShownAt = now();
    lockCard();
  }
  function retryFromFlag() {
    hideOverlay();
    if (phase !== "retry") return;
    setHint(hintReady());
    backToStart();
  }
  function showPauseCard() {
    showCard(`
      <h2 id="cardTitle">ひとやすみ</h2>
      <div class="btns">
        <button class="cta primary" type="button" data-cmd="resume">つづける</button>
        <button class="cta" type="button" data-cmd="again">もう一度</button>
        <button class="cta" type="button" data-cmd="modes">あそびかたを えらぶ</button>
        <button class="cta" type="button" data-cmd="menu">メニューへ</button>
      </div>`, {}, "pause");
  }
  const SET_LABELS = { slow: "ゆっくりモード", guide: "ガイドの てんせん", tap: "タップしき（おしつづけなくて いい）" };
  const setValue = (name) => (name === "slow" ? slow : name === "guide" ? guide : name === "tap" ? tap : false);
  const setLabel = (name) => `${SET_LABELS[name] || name}：${setValue(name) ? "オン" : "オフ"}`;
  function renderSetButtons() {
    el.card.querySelectorAll("[data-set]").forEach((b) => {
      const name = b.dataset.set;
      b.setAttribute("aria-pressed", String(setValue(name)));
      b.textContent = setLabel(name);
    });
  }
  // short：はじめての1回だけ自動で出す3行（SE 縦横でスクロールせずに「わかった」まで見える）。詳しい説明と設定は「？」から
  function showHelp(short) {
    if (overlayKind === "help") return;
    const prev = overlayKind;
    const wasPaused = paused;
    suspend();
    helpReturn = prev === "mode" ? "mode" : prev === "result" ? "result" : prev === "pause" ? "pause" : prev === "retry" ? "retry"
      : (paused && !wasPaused) ? "resume" : "none";
    if (short) {
      const st = run && run.mode === "stage";
      showCard(`
      <h2 id="cardTitle">あそびかた</h2>
      <p data-f="l1"></p>
      <p>2つ さきまで のばせたら「とばし」！ おまけの てん。</p>
      <p data-f="l3"></p>
      <div class="btns"><button class="cta primary" type="button" data-cmd="close">わかった</button></div>`, {
        l1: tap ? "タップで のびて、もう一度 タップで たおれる。つぎの はっぱに のせよう。" : "ながく おして、はなすと くきが たおれる。つぎの はっぱに のせよう。",
        l3: st ? "おちたら さいごの はたから。" : "おちると ♥ が へる。0で おしまい。"
      }, "help");
      el.card.dataset.help = "short";
      return;
    }
    showCard(`
      <h2 id="cardTitle">あそびかた</h2>
      <p>がめんを ながく おすと、くきが のびるよ。はなすと たおれる。</p>
      <p>くきの さきが つぎの はっぱに のれば わたれる。まんなかの ◆ に のると「ぴったり」で ボーナス！</p>
      <p>うんと のばして 2つ さきの はっぱに とどいたら「とばし」。2つぶん＋おまけの てん！（むりに ねらわなくて だいじょうぶ）</p>
      <p>「どこまでも」：みずに おちると いのち ♥ が 1つ へるよ。0に なったら おしまい。おちても、おなじ ところから もう一度。</p>
      <p>「ステージ」：ゴールの はたの はっぱまで わたれば クリア。5まい わたるごとに きいろい はたが あるよ。おちたら さいごの はたから（「さいしょから」も えらべる）。はたは とじると きえて、つぎは ステージの さいしょから。たかい はっぱには ながい くきが いるよ。</p>
      <p>キーボードの スペース・エンターでも あそべます。M で おと。</p>
      <p>おしつづけるのが むずかしいときは「タップしき」：1かい タップで のびはじめ、もう1かいで たおれる。</p>
      <div class="sets">
        <button class="cta set" type="button" data-set="slow" aria-pressed="false"></button>
        <button class="cta set" type="button" data-set="guide" aria-pressed="false"></button>
        <button class="cta set" type="button" data-set="tap" aria-pressed="false"></button>
      </div>
      <div class="btns"><button class="cta primary" type="button" data-cmd="close">わかった</button></div>`, {}, "help");
    el.card.dataset.help = "full";
    renderSetButtons();
  }
  function closeHelp() {
    if (overlayKind !== "help") return;
    writeKey(KEY_HELP, "1");
    const back = helpReturn; helpReturn = null;
    if (back === "pause") { showPauseCard(); return; }
    if (back === "mode") { showModeCard(); return; }
    if (back === "retry") { showRetryCard(); return; }
    if (back === "result" || phase === "over") { showResult(false); return; }
    hideOverlay();
    if (back === "resume") resume();
  }
  function toggleSetting(name) {
    if (name === "slow") { slow = !slow; writeKey(KEY_SLOW, slow ? "1" : "0"); }
    else if (name === "guide") { guide = !guide; writeKey(KEY_GUIDE, guide ? "1" : "0"); }
    else if (name === "tap") {
      tap = !tap; writeKey(KEY_TAP, tap ? "1" : "0");
      if (input) input.reset();   // 切り替えの前の押下は数えない
      renderStageLabel();
      if (el.hint.textContent === HINT_HOLD || el.hint.textContent === HINT_TAP) setHint(hintReady());
    }
    else return;
    sfx.play("toggle");
    renderSetButtons();
  }
  function again() {
    sfx.unlock();
    hideOverlay();
    startRun();   // clearLater・runId+1 を含む
    sfx.play("start");
  }
  function goMenu() {
    clearLater();
    saveBest();
    location.href = "../../";
  }
  el.overlay.addEventListener("click", (e) => {
    const t = e.target;
    const setBtn = t.closest && t.closest("[data-set]");
    if (setBtn) { toggleSetting(setBtn.dataset.set); return; }
    const cmdBtn = t.closest && t.closest("[data-cmd]");
    if (!cmdBtn) return;
    if (LOCKED_KINDS.includes(overlayKind) && now() - cardShownAt < CARD_LOCK_MS) return;   // 落ちた直後の連打で押し間違えない
    unlockCard();
    const cmd = cmdBtn.dataset.cmd;
    if (cmd === "again") again();
    else if (cmd === "next") chooseMode("stage", Math.min(run.stage + 1, L.STAGE_MAX));
    else if (cmd === "stage") chooseMode("stage");
    else if (cmd === "endless") chooseMode("endless");
    else if (cmd === "modes") showModeCard();
    else if (cmd === "flag") retryFromFlag();
    else if (cmd === "restart") again();
    else if (cmd === "menu") goMenu();
    else if (cmd === "resume") resume();
    else if (cmd === "close") closeHelp();
  });
  el.helpBtn.addEventListener("click", () => { sfx.unlock(); showHelp(false); });

  // ===== キーボード（Space・Enter は input.js） =====
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "m" || e.key === "M") { if (!e.repeat) toggleSound(); return; }
    if (e.key === "Escape") {
      if (overlayKind === "help") { e.preventDefault(); closeHelp(); }
      else if (overlayKind === "pause") { e.preventDefault(); resume(); }
    }
  });

  // ===== 拡大・長押しメニュー・文字選択を止める（ゼンマイさんぽと同じ方式） =====
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  ["gesturestart", "gesturechange", "gestureend"].forEach((type) => document.addEventListener(type, (e) => e.preventDefault(), { passive: false }));
  // カード（.overlay）は縦スクロールできるようにする
  document.addEventListener("touchmove", (e) => { if (e.cancelable && !(e.target.closest && e.target.closest(".overlay"))) e.preventDefault(); }, { passive: false });
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
  // ・#stageWrap は input.js が止める
  // ・それ以外（click で動くボタン・リンク）は、350ms 以内の2回目のタップだけ止め、click は自分で送る
  // ・カード（.overlay）は止めない
  let lastTapEnd = 0, tapStart = null;
  document.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    tapStart = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true, capture: true });
  document.addEventListener("touchend", (e) => {
    const target = e.target;
    if (!target.closest || target.closest(".overlay") || target.closest("#stageWrap")) return;
    const t = e.changedTouches[0];
    const isTap = tapStart && t && e.touches.length === 0 && Math.hypot(t.clientX - tapStart.x, t.clientY - tapStart.y) < 12;
    const tNow = now();
    const quick = isTap && tNow - lastTapEnd < 350;
    if (isTap) lastTapEnd = tNow;
    if (!e.cancelable || !quick) return;
    e.preventDefault();   // 2回目の click は送られなくなるので、ボタンなら自分で押す
    const btn = target.closest("button, a");
    if (btn && !btn.disabled) btn.click();
  }, { passive: false });

  // ===== テスト用（§12） =====
  window.HashiGame = Object.freeze({
    getState() {
      const h = L.hud(run);
      const len = phase === "growing" ? L.lengthFromHold(now() - holdStartAt, { slow }) : bridgeLen;
      return {
        phase: shownPhase(), score: h.score, best, lives: h.lives, streak: h.streak, crossed: h.crossed,
        bridgeLen: len,
        platforms: run.platforms.map((p) => ({ x: p.x, w: p.w })),
        overlay: overlayKind, paused, runId,
        lastOutcome: lastOutcome ? Object.assign({}, lastOutcome) : null,
        timers: timers.size, slow, guide, tap, cameraX,
        mode: run.mode, stage: run.stage, goal: run.goal, cleared: run.cleared, stageReach, checkpoint: run.checkpoint
      };
    },
    holdFor(ms) {
      if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return false;
      viaTest = true;
      try {
        if (!canStartHold()) return false;
        const t0 = now();
        // 指・キーボードと同じ核（input.core）で down → up する（「押している」状態を共有する）
        const core = input && input.core ? input.core
          : (window.HashiInput && typeof window.HashiInput.createCore === "function"
            ? (testCore || (testCore = window.HashiInput.createCore(holdCbs, { now }))) : null);
        if (core) {
          if (core.holding) return false;   // 指・キーで押している途中
          core.down(t0);
          if (phase !== "growing") { core.reset(); return false; }
          core.up(t0 + ms);
        } else {
          if (!onHoldStart({ at: t0 })) return false;
          onHoldEnd({ at: t0 + ms, holdMs: ms });
        }
        return true;
      } finally {
        viaTest = false;
      }
    },
    // 渡る先の中心までの長さ（高さの差があれば斜めの距離）
    lenToCross() {
      const target = run.platforms[1];
      if (!target) return null;
      return Math.hypot(target.x + target.w / 2 - curRight(), yOf(target) - curY());
    },
    // ひとつ飛ばし：2つ先の葉の中心までの長さ（2つ先が無いときは null）
    lenToSkip() {
      const after = run.platforms[2];
      return after ? Math.hypot(after.x + after.w / 2 - curRight(), yOf(after) - curY()) : null;
    },
    setRandom(seq) {
      if (seq === null) { randomSeq = null; return true; }
      if (!Array.isArray(seq) || seq.length === 0 || !seq.every((v) => typeof v === "number" && v >= 0 && v < 1)) {
        throw new TypeError("HashiGame.setRandom: 0 以上 1 未満の数の配列を渡してください（null で元に戻す）");
      }
      randomSeq = seq.slice();
      return true;
    },
    // 今の演出を、止まる所（ready・over）まで一気に進める
    skip() {
      if (paused || (overlayKind && overlayKind !== "result")) return false;
      let guard = 0;
      skipping = true;
      try {
        while (ANIM_PHASES.includes(phase) && guard < 20) {
          clock = Math.max(clock, phaseStart + phaseDur);
          tick();
          guard += 1;
        }
      } finally {
        skipping = false;
      }
      dirty = true;
      startLoop();
      return phase === "ready" || phase === "over";
    }
  });

  // ===== 起動 =====
  renderStageLabel();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(el.stageWrap);
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  try {
    startRun();
  } catch (e) {
    setHint("よみこみに しっぱいしました。ひらきなおしてね");
    throw new Error("ハシわたり: 回を始められませんでした（" + (e && e.message) + "）");
  }
  resize();
  showModeCard();   // さいしょに「ステージ」「どこまでも」を選ぶ（遊び方は選んだ後、初回だけ）
})();

// オフラインでも遊べるようにする（https か localhost のときだけ有効）
if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("../../sw.js").catch(() => { /* 登録できなくてもゲームは遊べる */ });
  });
}
