// 変異テスト：アプリ（リポジトリのルート）を一時フォルダへコピーし、わざと不具合を1つずつ入れて、
// テストがそれを検出できるか（＝不合格になるか）を確かめる。アプリのファイル自体は変更しない。
//   node tests/mutants/mutate.mjs [smoke|full|both]     （既定 both）
//   M=M7,M10 で変異を絞る。結果は表と tests/mutants/result.json（.gitignore 対象外の一時結果。コミットしない）
// 置換前の文字列が見つからないときは「!! 置換対象なし」と表示する（アプリが変わったら、ここの文字列を直す）
// 置換前は文字列か正規表現（最初の1か所だけ）、置換後は文字列か関数（String.prototype.replace と同じ）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const RUN = path.resolve(HERE, '../run.mjs');
const which = process.argv[2] || 'both';
// [名前, リスク, ファイル, 置換前（文字列か正規表現）, 置換後（文字列か関数）]
const OVER_BTNS = `<div class="row"><button class="cta primary" type="button" data-cmd="restart">もう一度</button></div>
        <div class="row">
          <button class="cta" type="button" data-cmd="undo">1手戻す</button>
          <button class="cta" type="button" data-cmd="menu">メニューへ</button>
        </div>`;
// まとめてポン MQ2：「1個でも消せる」は canRemove と applyRemove の両方を変える（2つは logic.js の中で続いているので、間をまとめて置き換える）
const MQ2_FROM = `    return (x > 0 && g[x - 1][y] === v) || (x < COLS - 1 && g[x + 1][y] === v)
      || (y > 0 && g[x][y - 1] === v) || (y < ROWS - 1 && g[x][y + 1] === v);
  }

  function invalid(state, reason) {
    return { state, outcome: Object.freeze({ kind: "invalid", reason }) };
  }

  function applyRemove(state, x, y) {
    try {
      if (!okState(state)) return invalid(state, "range");
      if (state.over === true) return invalid(state, "over");
      if (!inRange(x, y)) return invalid(state, "range");
      const g0 = state.grid;
      const color = g0[x][y];
      if (color === null) return invalid(state, "empty");
      const cells = gridGroup(g0, x, y);
      if (cells.length < 2) return invalid(state, "single");`;
const MQ2_TO = MQ2_FROM.replace(/return \(x > 0[\s\S]*?=== v\);/, 'return true;').replace('      if (cells.length < 2) return invalid(state, "single");', '');
const M = [
  ['M1 2048 で1手に2回合体する', '計算', 'games/2048/index.html', 'canMerge = false;      // 1手で1タイルは1回だけ合体', '/* removed */'],
  ['M2 ブロックの pagehide でベストを保存しない', 'データ消失', 'games/blocks/index.html', 'window.addEventListener("pagehide", commitBest);', ''],
  ['M3 ブロックのベストを低い得点でも上書きする', 'データ消失', 'games/blocks/index.html', 'if (score > best) { best = score; saveBest(); }', 'if (true) { best = score; saveBest(); }'],
  ['M4 2048 の保存データで負のスコアを受け入れる', '保存データ互換', 'games/2048/index.html', 'if (!isCount(s.score)) return null;', ''],
  ['M5 2048 のゲームオーバー画面から「メニューへ」が消える', '閉じ込め', 'games/2048/index.html', OVER_BTNS, OVER_BTNS.replace('\n          <button class="cta" type="button" data-cmd="menu">メニューへ</button>', '')],
  ['M6 ブロックが safe-area 上端を空けない', 'ボタン画面外', 'games/blocks/index.html', 'padding-top: max(10px, env(safe-area-inset-top, 0px));', 'padding-top: 10px;'],
  ['M7 事前キャッシュに存在しないファイル（install 失敗）', 'オフライン', 'sw.js', '"./icons/icon-512.png"', '"./icons/icon-512.png",\n  "./icons/icon-1024.png"'],
  ['M8 更新時に古いアプリ用キャッシュを消さない', 'オフライン/容量', 'sw.js', '(k.startsWith(APP_PREFIX) && k !== APP_CACHE)', 'false'],
  ['M9 詰んでから結果カードまでの待ちが 0.3 秒', '見た目・操作感', 'games/2048/index.html', 'showOver(true); }, 800);', 'showOver(true); }, 300);'],
  ['M10 ブロックの盤面で touchend を止めない（ダブルタップ拡大）', 'タッチ操作', 'games/blocks/index.html', 'if (target.closest(".stage, .dpad, .actions")) { e.preventDefault(); return; }', ''],
  ['M11 効果音 common/sfx.js を事前キャッシュから外す', 'オフライン', 'sw.js', '"./common/sfx.js",\n', ''],
  ['M12 効果音オフの設定を読まない', '効果音', 'common/sfx.js', 'localStorage.getItem(KEY) !== "off"', 'true'],
  ['M13 ブロックのスコア欄の数字を縮めない（「…」で省略）', '表示の桁数', 'games/blocks/index.html', 'function fitStat(el) {', 'function fitStat(el) { return;'],
  ['M14 sfx.js などをネットワーク優先・打ち切りなしに戻す（K2）', 'オフライン/遅い回線', 'sw.js', 'e.respondWith(asset(e, req, key));', 'e.respondWith(fetch(req).then((res) => { e.waitUntil(store(key, res)); return res; }).catch(() => caches.match(key).then((hit) => hit || Response.error())));'],
  ['M15 新しい版が出ていても古い sfx.js をキャッシュから返す（版の食い違い）', '更新', 'sw.js', 'if (newerOnServer || !hit) {', 'if (!hit) {'],
  ['M16 中身の違う新しい版のファイルを旧キャッシュに混ぜる', '更新/オフライン', 'sw.js', 'if (same) return c.put(key, copy);', 'if (true) return c.put(key, copy);'],
  ['M17 キリトリの切る判定が線分の端点だけ（速いスワイプで的を飛び越えると切れない）', '操作', 'games/kiritori/index.html', 't = Math.max(0, Math.min(1, t));', 't = t < 0.5 ? 0 : 1;'],
  ['M18 キリトリで的を落としてもライフが減らない（終わらない）', '遊べること', 'games/kiritori/index.html', '        sfx.play("miss");\n        hurt();', '        sfx.play("miss");'],
  ['M19 キリトリで爆弾を切ってもライフが減らない', '遊べること', 'games/kiritori/index.html', '        flashT = calm() ? 0 : 0.18;\n        hurt();', '        flashT = calm() ? 0 : 0.18;'],
  ['M20 いろコード：同じ色が重なったとき blow を数え過ぎる（色ごとの最小値でなく有無で数える）', '計算', 'games/irocode/logic.js', 'blow += Math.min(cg[i], cs[i]);', 'blow += cg[i] > 0 && cs[i] > 0 ? Math.max(cg[i], cs[i]) : 0;'],
  ['M21 いろコード：logic.js を事前キャッシュから外す（オフラインで遊べない）', 'オフライン', 'sw.js', '  "./games/irocode/logic.js",\n', ''],
  ['M22 いろコード：成績を10億で止めない（次に開くと成績が初期化される）', 'データ消失', 'games/irocode/index.html', 'const room = stats.played < STATS_LIMIT;', 'const room = true;'],
  ['M23 いろコード：結果カードの「もう一度」の連続タップが下の色ボタンに届く', 'タッチ操作', 'games/irocode/index.html', 'if (prevCard) return;', ''],
  ['M24 ばいばいタイル：表に戻ったとき保存がほかで変わっていても開き直さない（X-20）', '保存', 'games/2048/index.html', '    if (!stale && rawState() === seenState) return false;', '    return false;'],
  ['M25 ばいばいタイル：裏で別のタブが書いても保存を止めない（storage を見ない。X-20）', '保存', 'games/2048/index.html', 'if (document.hidden && (e.key === null || e.key === KEY_STATE)) stale = true;', 'if (false) stale = true;'],
  ['M26 ばいばいタイル：裏へ回る・閉じるときの保存で比べ直さない（storage イベントが届く前に古い盤を書き戻す。X-20）', '保存', 'games/2048/index.html', '    if (!stale && changedElsewhere()) stale = true;\n    return stale;', '    return stale;'],
  ['M27 ブロック：低い横持ち（高さ 319 以下）でスコア欄を広げない（LEVEL・LINES 5 桁が「…」。X-18）', '表示の桁数', 'games/blocks/index.html', '.stats { padding-top: 48px; width: 162px; grid-template-columns: auto minmax(0, 1fr); gap: 0 4px; }', '.stats { padding-top: 48px; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); gap: 0 6px; }'],
  ['MZ1 ゼンマイの render.js を事前キャッシュから外す', 'オフライン', 'sw.js', '  "./games/zenmai/render.js",\n', ''],
  ['MZ2 ゼンマイの保存データで範囲外の★（9など）を受け入れる', '保存データ互換', 'games/zenmai/logic.js', 'if (!(Number.isInteger(s) && s >= 0 && s <= 3)) continue;', ''],
  ['MZ3 ゼンマイの結果カードから「メニューへ」が消える', '閉じ込め', 'games/zenmai/index.html', '<button class="cta" type="button" data-cmd="menu">メニューへ</button>', ''],
  ['MZ4 ゼンマイのネジで指を持ち替えても数え直さない（位置が飛んで余分に巻く）', 'タッチ操作', 'games/zenmai/input.js', 'core.reanchor();\n        feed(pos.x, pos.y);', 'feed(pos.x, pos.y);'],
  ['MZ5 ゼンマイ：表に戻ったとき保存がほかで変わっていても開き直さない（X-20）', '保存', 'games/zenmai/index.html', '    if (!stale && rawProgress() === seenProgress) return false;', '    return false;'],
  ['MZ6 ゼンマイ：開き直す前（stale）でも進み具合を書く（X-20）', '保存', 'games/zenmai/index.html', '  function saveProgress() {\n    if (stale) return;\n', '  function saveProgress() {\n'],
  ['MZ7 ゼンマイ：閉じるときの保存で比べ直さない（storage イベントが届く前に古い進み具合を書き戻す。X-20）', '保存', 'games/zenmai/index.html', '    if (!stale && changedElsewhere()) stale = true;\n    return stale;', '    return stale;'],
  // ---- ピカッと早押し（games/pikatto/）。ルール・保存の仕組みを変えたときだけ流す ----
  ['MP1 ピカッと：waiting 中の押下がフライングにならない（armed と同じ勝ち扱い）', 'ルール', 'games/pikatto/logic.js', 'if (state.phase === "armed") {', 'if (true) {'],
  ['MP2 ピカッと：2点先取で試合が終わる（3点先取の条件を下げる）', 'ルール', 'games/pikatto/logic.js', 'if (mode !== "solo" && max >= WIN_SCORE) {', 'if (mode !== "solo" && max >= 2) {'],
  ['MP3 ピカッと：validateBestSolo が範囲外（0 や 49 や 5001）の値を通してしまう（0 に戻さない）', '保存データ互換', 'games/pikatto/logic.js', 'if (raw < BEST_MIN || raw > BEST_MAX) return 0;', ''],
  ['MP4 ピカッと：redoRound（一時停止からのやり直し）で回数が 1 つ進む', 'ルール', 'games/pikatto/logic.js', 'phase: "waiting",\n      signalDelay: pickDelay(state._random),', 'phase: "waiting",\n      round: state.round + 1,\n      signalDelay: pickDelay(state._random),'],
  ['MP5 ピカッと：合図より前の時刻の押下（受付の窓で後から届いたもの）でも勝ちになる', 'ルール', 'games/pikatto/logic.js', 'const early = known && pressedAt < fired;', 'const early = false;'],
  ['MP6 ピカッと：5回で終わらない（round >= maxRounds → round > maxRounds）', 'ルール', 'games/pikatto/logic.js', 'if (round >= maxRounds) {', 'if (round > maxRounds) {'],
  ['MP7 ピカッと：ひとりで れんしゅうのベストを保存しない（saveBestSolo の呼び出しを消す）', 'データ消失', 'games/pikatto/index.html', 'saveBestSolo(bestSolo);', '/* removed */'],
  ['MP8 ピカッと：ひとりで れんしゅうも 3回せいこうで終わる（5回まで測れない）', 'ルール', 'games/pikatto/logic.js', 'if (mode !== "solo" && max >= WIN_SCORE) {', 'if (max >= WIN_SCORE) {'],
  ['MP9 ピカッと：よーいの終わり際の押下が受付の窓に残り、よーいの後に届いてフライングになる', 'ルール', 'games/pikatto/index.html', 'if (input) input.discard();', ''],
  ['MP10 ピカッとのとても低い横画面ですき間を詰めない（SE Safari 横で 4 人の隅が重なる、X-17）', 'ボタン重なり', 'games/pikatto/index.html', '@media (orientation: landscape) and (max-height: 300px) {', '@media (orientation: landscape) and (max-height: 260px) {'],
  ['MP11 ピカッと：対戦の途中で点があっても「メニューへ」を確かめない（PK-33）', 'データ消失', 'games/pikatto/index.html', '&& (gameState.scores || []).some((n) => n > 0);', '&& false;'],
  ['MP12 ピカッと：最終結果（試合が終わった後）でも「メニューへ」を確かめてしまう（PK-33）', 'ルール', 'games/pikatto/index.html', 'gameState.mode !== "solo" && gameState.phase !== "done"', 'gameState.mode !== "solo"'],
  ['MP13 ピカッと：メニューへの確認カードに鍵をかけない（「メニューへ」の2度押しで点が消える。R2）', 'データ消失', 'games/pikatto/index.html', '{ soft: true, kind: "confirm", guard: CONFIRM_LOCK_MS }', '{ soft: true, kind: "confirm" }'],
  ['MP14 ピカッと：Space の押しっぱなし（repeat）を止めない（隅で押したままの Space で「つぎへ」が押される。R3）', '操作', 'games/pikatto/index.html', 'e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar"', 'e.key !== "Enter" && e.key !== "Spacebar"'],
  // ---- ハシわたり（games/hashi/）。判定・点数・いのち・保存・中断・タイマーの仕組みを変えたときだけ流す ----
  ['MH1 ハシわたり：判定の端を開区間にする（茎の先が葉の端ちょうどで落ちる）', 'ルール', 'games/hashi/logic.js', 'const onTarget = tipT !== null && tipT >= left && tipT <= right;', 'const onTarget = tipT !== null && tipT > left && tipT < right;'],
  ['MH2 ハシわたり：recordBest で同点もベスト更新にする', '保存データ', 'games/hashi/logic.js', 'const improved = s > prev;', 'const improved = s >= prev;'],
  ['MH3 ハシわたり：ぴったりボーナスの上限 16 を外す', '計算', 'games/hashi/logic.js', 'return Math.min(Math.pow(2, Math.floor(s) - 1), BONUS_CAP);', 'return Math.pow(2, Math.floor(s) - 1);'],
  ['MH4 ハシわたり：落ちてもいのちを減らさない（終わらない）', '遊べること', 'games/hashi/logic.js', 'const lives = Math.max(state.lives - 1, 0);', 'const lives = state.lives;'],
  ['MH5 ハシわたり：隠れたとき（visibilitychange で hidden）押下を取り消さない', '中断', 'games/hashi/main.js', 'if (phase === "growing") abortHold();', ''],
  ['MH6 ハシわたり：「もう一度」で clearLater() を呼ばない（古い回のタイマーが残る）', 'タイマー', 'games/hashi/main.js', 'clearLater();   // 前の回のタイマーを片付ける（もう一度・起動）', ''],
  ['MH7 ハシわたり：ひとつ飛ばしの点を1つ分にする（2つ分＋おまけ → 1つ分＋おまけ）', '計算', 'games/hashi/logic.js', 'const gain = (onAfter ? 2 : 1) + skipBonus + bonus;', 'const gain = 1 + skipBonus + bonus;'],
  ['MH8 ハシわたり：2つ先の葉に届いても渡れない（今までどおり落ちる）', 'ルール', 'games/hashi/logic.js', 'const onAfter = !onTarget && !!after && tipA !== null && tipA >= after.x && tipA <= after.x + after.w;', 'const onAfter = false;'],
  ['MH9 ハシわたり：ひとつ飛ばしで渡った数を1つしか数えない', '計算', 'games/hashi/logic.js', 'const crossed = state.crossed + (onAfter ? 2 : 1);', 'const crossed = state.crossed + 1;'],
  ['MH10 ハシわたり：高さの差を無視する（茎の先＝根もと＋長さ。斜めの距離にしない）', 'ルール', 'games/hashi/logic.js', 'if (dy === 0) return bx + L;', 'return bx + L;'],
  ['MH11 ハシわたり：ステージで落ちても最初（旗）に戻らない（その場からやり直し）', 'ルール', 'games/hashi/logic.js', 'platforms: stageWindow(stageCourse(state.stage), from),\n        score: from ? state.score : 0, crossed: from,', 'platforms: state.platforms,\n        score: from ? state.score : 0, crossed: state.crossed,'],
  ['MH12 ハシわたり：ゴールの1枚手前でクリアにする', 'ルール', 'games/hashi/logic.js', 'const cleared = stageMode && crossed >= state.goal;', 'const cleared = stageMode && crossed >= state.goal - 1;'],
  ['MH13 ハシわたり：hashi.stage の 0 を通す（壊れた値を 1 に戻さない）', '保存データ', 'games/hashi/logic.js', 'return Number.isSafeInteger(n) && n >= 1 && n <= STAGE_MAX ? n : 1;', 'return Number.isSafeInteger(n) && n >= 0 && n <= STAGE_MAX ? n : 1;'],
  ['MH14 ハシわたり：ステージをクリアしても到達を保存しない', '保存データ', 'games/hashi/main.js', 'if (r.improved) { stageReach = r.stage; writeKey(KEY_STAGE, String(stageReach)); }', 'if (r.improved) { stageReach = r.stage; }'],
  ['MH15 ハシわたり：クリアの演出中に隠れても止めない', '中断', 'games/hashi/main.js', 'const ANIM_PHASES = ["falling", "walking", "scrolling", "dropping", "respawn", "clear"];', 'const ANIM_PHASES = ["falling", "walking", "scrolling", "dropping", "respawn"];'],
  ['MH16 ハシわたり：クリアの演出をタップで早送りできない', '操作', 'games/hashi/main.js', 'if (phase === "clear" && !paused && !overlayKind) { finishClear(); return false; }', ''],
  ['MH17 ハシわたり：旗を無視する（落ちたら いつも ステージの最初から）', 'ルール', 'games/hashi/logic.js', 'const from = state.checkpoint > 0 ? state.checkpoint : 0;', 'const from = 0;'],
  ['MH18 ハシわたり：ひとつ飛ばしで旗の葉を飛び越えたら旗を取らない', 'ルール', 'games/hashi/logic.js', 'const checkpoint = stageMode ? Math.max(state.checkpoint, lastFlag(crossed, state.goal)) : 0;', 'const checkpoint = stageMode ? Math.max(state.checkpoint, crossed % 5 === 0 ? lastFlag(crossed, state.goal) : 0) : 0;'],
  ['MH19 ハシわたり：「さいしょから」を押しても旗から再開する', '操作', 'games/hashi/main.js', 'else if (cmd === "restart") again();', 'else if (cmd === "restart") retryFromFlag();'],
  ['MH20 ハシわたり：落ちた所の言葉を分けない（次と2つ先の間でも ただの「ながすぎ」）', '表示', 'games/hashi/logic.js', 'if (reason === "long" && after && missBy > NEAR) {', 'if (false) {'],
  ['MH21 ハシわたり：表に戻ったとき保存がほかで変わっていても開き直さない（契約 §17・X-20）', '保存', 'games/hashi/main.js', '    if (!stale && WATCH_KEYS.every((k) => readKey(k) === seenRaw.get(k))) return false;', '    return false;'],
  ['MH22 ハシわたり：開き直す前（stale）でもベストを書く（pagehide で下げる。契約 §17・X-20）', '保存', 'games/hashi/main.js', '  function writeKey(key, val) {\n    if (stale) return false;\n', '  function writeKey(key, val) {\n'],
  ['MH23 ハシわたり：閉じるときのベストの保存で比べ直さない（storage イベントが届く前に古いベストへ下げる。契約 §17・X-20）', '保存', 'games/hashi/main.js', '    if (!stale && changedElsewhere()) stale = true;\n    return stale;', '    return stale;'],
  ['MH24 ハシわたり：タイマーを片付けたとき案内を戻さない（隠す・遊び方で「ぴったり！」が残る。HS-01）', 'タイマー', 'games/hashi/main.js', 'if (hintTimer) { hintTimer = 0; setHint(hintReady()); }', ''],
  ['MH25 ハシわたり：最後のいのちで落ちたら、ぽちゃんを待たずに結果カード（HS-03）', '進行', 'games/hashi/main.js', 'setPhase("sinking", D(SPLASH_SEC));', 'setPhase("over", 0); showResult(true);'],
  ['MH26 ハシわたり：茎が最大になっても知らせない（grow が鳴り続ける。HS-02）', '操作', 'games/hashi/main.js', 'if (bridgeLen >= L.MAX_LEN) {', 'if (false) {'],
  ['MH27 ハシわたり：カードの間、うしろのプレイ画面を inert にしない（HS-07）', '操作', 'games/hashi/main.js', 'el.playView.setAttribute("inert", "");', ''],
  ['MH28 ハシわたり：茎が最大のまま押下が取り消されても案内を戻さない（隠すと「いちばん ながい！ はなしてね」が残る。R1）', '表示', 'games/hashi/main.js', '    if (maxed) { maxed = false; setHint(hintReady()); }\n', ''],
  ['MH29 ハシわたり：ぴったりを続けても いのちが戻らない（HS-09）', '遊べること', 'games/hashi/logic.js', 'const heal = !stageMode && perfect && streak % HEAL_EVERY === 0 && state.lives < LIVES;', 'const heal = false;'],
  ['MH30 ハシわたり：いのちが上限を超えて戻る（HS-09）', 'ルール', 'games/hashi/logic.js', '&& state.lives < LIVES;', ';'],
  ['MH31 ハシわたり：ステージでも いのちが戻る（HS-09）', 'ルール', 'games/hashi/logic.js', 'const heal = !stageMode && perfect', 'const heal = perfect'],
  ['MH32 ハシわたり：案内に倍々・回復の言葉を出さない（HS-09）', '表示', 'games/hashi/main.js', '${gainWord}${perfectTail(o)}', '${gainWord}'],
  ['MH33 ハシわたり：画面の大きさが変わっても空と水のグラデーションを作り直さない（HS-10・T-25）', '表示', 'games/hashi/render.js', /if \(!skyG \|\| skyKey !== String\(deckY\)\) \{([\s\S]*?)if \(!waterG \|\| waterKey !== waterY \+ "," \+ H\) \{/, (_, mid) => `if (!skyG) {${mid}if (!waterG) {`],
  // ---- 版の表示（メニュー）。版を上げる手順が崩れたときの検出 ----
  // MV1・MV3 は正規表現で今の版・日付を読み、1つずらす（版を上げるたびに直さなくてよい）
  ['MV1 版の数字だけ上げ忘れる（version.js が1つ前の版のまま。sw.js は今の版）', '更新', 'common/version.js', /version: "v(\d+)"/, (_, n) => `version: "v${Number(n) - 1}"`],
  ['MV2 version.js を事前キャッシュから外す（オフラインで版が出ない）', 'オフライン', 'sw.js', '  "./common/version.js",\n', ''],
  ['MV3 更新日が YYYY-MM-DD でない（今の日付の - を / にする）', '表示', 'common/version.js', /date: "(\d{4})-(\d{2})-(\d{2})"/, (_, y, m, d) => `date: "${y}/${m}/${d}"`],
  // ---- メニューの並び（index.html、X-21・X-23）。流すときは ONLY=E1,E7,E8,X1 ----
  ['MR1 最近遊んだゲームを先頭でなく後ろに足す', '並び順', 'index.html', 'return cleanRecent([url, ...recent.filter((u) => u !== url)]);', 'return cleanRecent([...recent.filter((u) => u !== url), url]);'],
  ['MR2 メニューを並べ替えない', '並び順', 'index.html', 'if (want.every((li, i) => now[i] === li)) return;', 'if (true) return;'],
  ['MR3 壊れた yubi.recent でメニューが落ちる', '保存データ互換', 'index.html', 'try { return cleanRecent(JSON.parse(localStorage.getItem(RECENT_KEY))); } catch (e) { return []; }', 'return cleanRecent(JSON.parse(localStorage.getItem(RECENT_KEY)));'],
  ['MR4 押した瞬間に並べ替える（押し間違い）', '操作', 'index.html', '      saveRecent(game.url);\n    });', '      saveRecent(game.url); placeRows();\n    });'],
  ['MR5 修飾キーつき・左ボタン以外のクリックでも最近遊んだ順に入れる（別タブで開いただけで先頭。X-23）', '並び順', 'index.html', '      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;\n', ''],
  ['MR6 Cmd（Meta）+クリックだけ最近遊んだ順に入れてしまう（X-23）', '並び順', 'index.html', 'e.metaKey || e.ctrlKey', 'e.ctrlKey'],
  // ---- 日付・時刻（いろコード）。日付の処理を足したら、ここにも変異を足す（tests/README.md「日付・時計」）----
  ['MD1 いろコード：todayStr を UTC の日付にする（toISOString 由来。日本の0〜9時台に前日になる）', '日付', 'games/irocode/logic.js', 'return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());', 'return d.toISOString().slice(0, 10);'],
  ['MD2 いろコード：todayStr の月が 1 ずれる（getMonth() + 1 を外す）', '日付', 'games/irocode/logic.js', 'pad2(d.getMonth() + 1)', 'pad2(d.getMonth())'],
  ['MD3 いろコード：隠して戻ったとき日付が変わっていても今日の問題に差し替えない（自動差し替えを無効にする）', '日付', 'games/irocode/index.html', '    if (reloadIfStale()) return;\n    refreshDay();', '    if (reloadIfStale()) return;'],
  ['MD4 いろコード：確認・遊び方カードを閉じたときに日付を見直さない', '日付', 'games/irocode/index.html', 'else if (cmd === "close") { hideOverlay(); renderInput(); refreshDay(); }', 'else if (cmd === "close") { hideOverlay(); renderInput(); }'],
  ['MD5 いろコード：未来の日付の daily 記録を受け付ける', '日付/保存データ互換', 'games/irocode/logic.js', 'if (isDateStr(today) && x.date > today) return null;', ''],
  ['MD6 いろコード：0時をまたいで確定した結果を、始めた日でなく確定時の日付で記録する', '日付', 'games/irocode/index.html', 'daily = { date: state.date, done: true, win, tries };', 'daily = { date: today(), done: true, win, tries };'],
  ['MD7 いろコード：結果カードが0時をまたいでも「次は明日」のまま', '日付', 'games/irocode/index.html', 'const sameDay = state.date === today();', 'const sameDay = true;'],
  ['MD8 いろコード：起動時に日付が違う途中の問題を捨てるとき、負けとして記録しない（れんしゅう切り替えと食い違う）', '日付/成績', 'games/irocode/index.html', '{ abandonDaily(state); state = null; }', '{ state = null; }'],
  ['MD9 いろコード：表に戻ったとき保存がほかで変わっていても開き直さない（X-20）', '保存', 'games/irocode/index.html', '    if (!stale && WATCH_KEYS.every((k) => readRaw(k) === seenRaw.get(k))) return false;', '    return false;'],
  ['MD10 いろコード：開き直す前（stale）でも保存を書く（X-20）', '保存', 'games/irocode/index.html', '  function writeJSON(key, v) {\n    if (stale) return;\n', '  function writeJSON(key, v) {\n'],
  ['MD11 いろコード：裏へ回る・閉じるときの保存で比べ直さない（storage イベントが届く前に古い状態を書き戻す。X-20）', '保存', 'games/irocode/index.html', '    if (!stale && changedElsewhere()) stale = true;\n    return stale;', '    return stale;'],
  // ---- いろびん（games/irobin/）。注ぐ規則・そろい判定・届ける・隠れ・ソルバー・保存・中断の仕組みを変えたときだけ流す ----
  //      届けた瓶は消える（2026-10-19 のルール変更）。MB4＝消えない、MB13＝旧仕様（空き瓶に置き換わる）、MB14＝瓶の番号のずれ
  ['MB1 いろびん：色違いの瓶にも注げる（mismatch の判定を外す）', 'ルール', 'games/irobin/logic.js', 'if (dl > 0 && col(d, dl - 1) !== c) return R_MISMATCH;', ''],
  ['MB2 いろびん：注ぐ量が相手の空きを超える（空きで丸めない）', 'ルール', 'games/irobin/logic.js', 'return Math.min(run, cap - dl);', 'return run;'],
  ['MB3 いろびん：そろった瓶を、注文の色と違うお客さんにも届ける', 'ルール', 'games/irobin/logic.js', 'if (x !== GONE && isSealedP(x) && col(x, 0) === want) {', 'if (x !== GONE && isSealedP(x)) {'],
  ['MB4 いろびん：届けた瓶が消えない（栓をしたまま残る）', 'ルール', 'games/irobin/logic.js', 'bots[b] = GONE;                                      // 届けた瓶は消える（空の瓶は出てこない）', 'bots[b] = bots[b];                                   // (変異)'],
  ['MB5 いろびん：注いでも隠れた段が見えるようにならない', 'ルール', 'games/irobin/logic.js', 'ns &= ~(1 << (8 + 5 * (nsl - 1)));', ''],
  ['MB6 いろびん：ソルバーが待ち瓶をもう届けたものとして数える（いつも anyOrder。手の位置がずれる）', 'ルール/生成', 'games/irobin/logic.js', 'const any = !!(opts && opts.anyOrder);', 'const any = true;'],
  ['MB7 いろびん：validateSave が手の形を確かめない（3 要素の手も通る）', '保存データ互換', 'games/irobin/logic.js', 'for (const m of o.moves) if (!Array.isArray(m) || m.length !== 2 ||', 'for (const m of o.moves) if (false ||'],
  ['MB8 いろびん：hidden で演出を止めない（render.pause を呼ばない）', '中断', 'games/irobin/main.js', '      paused = true;\n      render.pause();\n      syncPhase();', '      paused = true;\n      syncPhase();'],
  ['MB9 いろびん：1手もどすで2手戻る', 'お助け', 'games/irobin/main.js', 'state = history.pop();\n    moves.pop();', 'state = history.pop(); if (history.length) state = history.pop();\n    moves.pop();'],
  ['MB10 いろびん：render.js を事前キャッシュから外す（オフラインで開かない）', 'オフライン', 'sw.js', '  "./games/irobin/render.js",\n', ''],
  ['MB11 いろびん：手はあるがもう解けない局面を知らせない（詰み予備軍の判定を外す）', 'ルール', 'games/irobin/main.js', 'doomed = !!(r && r.solved === false && r.exhausted === false);', 'doomed = false;'],
  ['MB12 いろびん：届けの連鎖を短くしない（6 本続くと約 10 秒待たされる）', '演出', 'games/irobin/render.js', 'const fast = rest > 0 ? Math.max(0.12, Math.min(0.45, Math.max(CHAIN_MIN, CHAIN_BUDGET - used) / rest)) : 1;', 'const fast = 1;'],
  ['MB13 いろびん：届けたあと空き瓶を足す（旧仕様に戻す：届けた瓶が同じ場所の空の瓶に置き換わる）', 'ルール', 'games/irobin/logic.js', 'bots[b] = GONE;                                      // 届けた瓶は消える（空の瓶は出てこない）', 'bots[b] = 0;                                         // (変異) 旧仕様'],
  ['MB14 いろびん：演出中に押した瓶を、押したボタンの位置で選ぶ（届けて詰めた後の並びとずれる）', '操作', 'games/irobin/main.js', 'if (Number.isSafeInteger(id)) {\n      i = safeCall', 'if (false) {\n      i = safeCall'],
  //      布の瓶（2026-10-20、契約 §17）。MB18（新しい色）はユーザー決定 §17.8 で作らない
  ['MB15 いろびん：布が1人早く取れる（served >= cover − 1 で取る）', 'ルール', 'games/irobin/logic.js', 'if (k === 0 || ctx.served < k ||', 'if (k === 0 || ctx.served < k - 1 ||'],
  ['MB16 いろびん：布の瓶に注げる（布を見るのは注ぐ元だけ）', 'ルール', 'games/irobin/logic.js', 'if ((s | d) & COVER_MASK) return isKeyP(s)', 'if (s & COVER_MASK) return isKeyP(s)'],
  ['MB17 いろびん：古い v:2 の手をそのまま再生する（布の前のルールの手を捨てない）', '保存データ互換', 'games/irobin/logic.js', '    if ((o.v === 1 || o.v === 2) && Number.isSafeInteger(o.level) && o.level >= 1) return { level: o.level, moves: [] };\n    if (o.v !== SAVE_V) return null;', '    if (o.v === 1 && Number.isSafeInteger(o.level) && o.level >= 1) return { level: o.level, moves: [] };\n    if (o.v !== SAVE_V && o.v !== 2) return null;'],
  ['MB19 いろびん：布の瓶を押すと選べる（布の判定を外す）', '操作', 'games/irobin/main.js', '    if (coverOf(b) !== null) {\n      const m = Math.max(0, coverOf(b)', '    if (false) {\n      const m = Math.max(0, coverOf(b)'],
  ['MB20 いろびん：届けた瓶の跡を残さず詰める（render の replaceChild(emptyPlace…) を removeChild にする）', '演出', 'games/irobin/render.js', 'btn.parentNode.replaceChild(emptyPlace(btn._id), btn);', 'btn.parentNode.removeChild(btn);'],
  ['MB21 いろびん：布の札の残りを 0 のまま表示する（「あいた！」にしない）', '演出', 'games/irobin/render.js', 'left === "0" ? \'<b class="open">あいた！</b>\' : ', 'false ? \'<b class="open">あいた！</b>\' : '],
  // ---- まとめてポン（games/matomete/）。かたまり・消す・落下・左詰め・点数・終わり・保存・2回タップ・ロックの仕組みを変えたときだけ流す ----
  ['MQ1 まとめてポン：斜めもつながったかたまりにする', 'ルール', 'games/matomete/logic.js', 'if (cy < ROWS - 1 && !seen[k + 1] && g[cx][cy + 1] === v) { seen[k + 1] = 1; stack.push(k + 1); }', 'if (cy < ROWS - 1 && !seen[k + 1] && g[cx][cy + 1] === v) { seen[k + 1] = 1; stack.push(k + 1); }\n      for (const d of [ROWS + 1, ROWS - 1, -ROWS + 1, -ROWS - 1]) { const n = k + d, nx = (n / ROWS) | 0, ny = n - nx * ROWS; if (n >= 0 && n < COLS * ROWS && Math.abs(nx - cx) === 1 && Math.abs(ny - cy) === 1 && !seen[n] && g[nx][ny] === v) { seen[n] = 1; stack.push(n); } }'],
  ['MQ2 まとめてポン：1個でも消せる（canRemove と applyRemove の両方）', 'ルール', 'games/matomete/logic.js', MQ2_FROM, MQ2_TO],
  ['MQ3 まとめてポン：点数を (n−1)² にする', '計算', 'games/matomete/logic.js', 'return (n - 2) * (n - 2);', 'return (n - 1) * (n - 1);'],
  ['MQ4 まとめてポン：全部消しの +1000 がない', '計算', 'games/matomete/logic.js', 'const bonus = allClear ? ALL_CLEAR_BONUS : 0;', 'const bonus = 0;'],
  ['MQ5 まとめてポン：空いた列を左へ詰めない', 'ルール', 'games/matomete/logic.js', 'if (g[cx][0] === null) continue;', ''],
  ['MQ6 まとめてポン：終わりの判定が逆（消せるのに終わる・消せないのに続く）', 'ルール', 'games/matomete/logic.js', 'const over = allClear || !gridHasMoves(g2);', 'const over = allClear || gridHasMoves(g2);'],
  ['MQ7 まとめてポン：validateSave が保存の v を見ない', '保存データ互換', 'games/matomete/logic.js', 'if (o.v !== SAVE_V && o.v !== 2 && o.v !== 1) return null;', ''],
  ['MQ8 まとめてポン：2回目を待たずに1回のタップで消す', '操作', 'games/matomete/main.js', 'if (selected && selected.cells.some((c) => c[0] === x && c[1] === y)) return doRemove(x, y);', 'return doRemove(x, y);'],
  ['MQ9 まとめてポン：消したあと上のマスが落ちない（すきまが残る）', 'ルール', 'games/matomete/logic.js', 'if (cy !== w) {', 'if (false) {'],
  ['MQ10 まとめてポン：終わりのカードが出た直後も押せる（0.6 秒のロックなし）', '操作', 'games/matomete/main.js', 'if (overlayKind === "over" && now() - cardShownAt < CARD_LOCK_MS) return;', ''],
  ['MQ11 まとめてポン：1手もどすで局面が戻らない（手の記録だけ減る）', 'お助け', 'games/matomete/main.js', 'state = history.pop();\n    moves.pop();', 'history.pop();\n    moves.pop();'],
  ['MQ12 まとめてポン：render.js を事前キャッシュから外す（オフラインで開かない）', 'オフライン', 'sw.js', '  "./games/matomete/render.js",\n', ''],
  ['MQ13 まとめてポン：recordBest が低い点でもベストを上書きする', 'データ消失', 'games/matomete/logic.js', 'const improved = s > p;', 'const improved = true;'],
  ['MQ14 まとめてポン：カードを閉じた直後の押下が盤に届く', 'タッチ操作', 'games/matomete/main.js', 'blockUntil = now() + BOARD_BLOCK_MS;', 'blockUntil = 0;'],
  ['MQ15 まとめてポン：開いたとき保存から再開しない', 'データ消失', 'games/matomete/main.js', 'if (sv) ok = startGame(sv.seed, sv.mode, sv.moves);', ''],
  ['MQ16 まとめてポン：むずかしいのベストも ふつうのキーに書く', 'データ', 'games/matomete/main.js', 'writeKey(KEY_BEST[mode], String(best));', 'writeKey(KEY_BEST.normal, String(best));'],
  ['MQ17 まとめてポン：メニューのベストが壊れた値（負・小数）も表示する', '保存データ互換', 'index.html', 'return Number.isSafeInteger(n) && n >= 1 ? n.toLocaleString() + " てん" : "";', 'return n !== 0 ? n.toLocaleString() + " てん" : "";'],
  ['MQ18 まとめてポン：消える音 pop に消した数を渡さない（いつも同じ高さ）', '効果音', 'games/matomete/render.js', 'snd("pop", a.removedCells.length);', 'snd("pop", 2);'],
  ['MQ19 まとめてポン：やさしいの色の数が 4（3色にならない）', 'ルール', 'games/matomete/logic.js', 'const MODES = Object.freeze({ easy: 3,', 'const MODES = Object.freeze({ easy: 4,'],
  ['MQ20 まとめてポン：最後のモードを覚えない（開き直すと ふつう）', '保存データ', 'games/matomete/main.js', 'if (!ok) ok = startGame(newSeed(), safeCall(() => L.validateMode(readKey(KEY_MODE)), "normal"), []);', 'if (!ok) ok = startGame(newSeed(), "normal", []);'],
  ['MQ21 まとめてポン：いちばん少ない のこりを書かない', '保存データ', 'games/matomete/main.js', 'if (lr.least !== null && lr.least !== undefined) writeKey(KEY_LEAST[mode], String(lr.least));', ''],
  ['MQ22 まとめてポン：2回目のずれの許容（半マス）がない', '操作', 'games/matomete/main.js', 'if (selected && phase === "selected") {', 'if (false) {'],
  ['MQ23 まとめてポン：validateLeast が壊れた値（負・小数・200 超）を通す', '保存データ互換', 'games/matomete/logic.js', 'return Number.isSafeInteger(n) && n >= 0 && n <= COLS * ROWS ? n : null;', 'return Number.isFinite(n) ? n : null;'],
  ['MQ24 まとめてポン：最後の手でベストの数字がポンの前に変わる', '表示', 'games/matomete/main.js', 'setNum(el.best, bestShown);', 'setNum(el.best, best);'],
  ['MQ25 まとめてポン：選んだふちの明滅が止まらない（rAF が回り続ける）', '性能', 'games/matomete/render.js', 'if (view.selected && !calm && t - selAt < PULSE_MS + 50) return true;', 'if (view.selected && !calm) return true;'],
  ['MQ26 まとめてポン：「おしい」の線がモード別でない（どれも 10）', 'ルール', 'games/matomete/logic.js', 'const NEAR_CLEAR = Object.freeze({ easy: 5, normal: 10, hard: 15 });', 'const NEAR_CLEAR = Object.freeze({ easy: 10, normal: 10, hard: 10 });'],
  ['MQ27 まとめてポン：のこり 5 こ以下でも小さなお祝いをしない', '演出', 'games/matomete/main.js', 'if (left <= CHEER_LINE) {', 'if (false) {'],
  ['MQ28 まとめてポン：fx が空でも毎コマ全画面を消し直す', '性能', 'games/matomete/render.js', 'if (!any && fxClean) return;', ''],
  ['MQ29 まとめてポン：まわりも消えるのが 6こ以上から（BIG が 6）', 'ルール', 'games/matomete/logic.js', 'const BIG = 5;', 'const BIG = 6;'],
  ['MQ30 まとめてポン：まわりに斜めも入れる（ひし形でなく四角）', 'ルール', 'games/matomete/logic.js', 'const rest = r - Math.abs(dx);', 'const rest = r;'],
  ['MQ31 まとめてポン：4こ以下を消しても れんぞくが 0 に戻らない', 'ルール', 'games/matomete/logic.js', 'const streak = big ? streak0 + 1 : 0;', 'const streak = big ? streak0 + 1 : streak0;'],
  ['MQ32 まとめてポン：3回目でも範囲が広がらない（いつも r=1）', 'ルール', 'games/matomete/logic.js', 'return st + 1 >= STREAK_WIDE ? RADIUS.wide : RADIUS.near;', 'return RADIUS.near;'],
  ['MQ33 まとめてポン：まわりで消えたマスの点を足さない', '計算', 'games/matomete/logic.js', 'const extraPoints = extra.length * EXTRA_POINT;\n      const points = scoreFor(count) + extraPoints;', 'const extraPoints = 0;\n      const points = scoreFor(count) + extraPoints;'],
  ['MQ34 まとめてポン：1手もどしても れんぞくが戻らない', 'お助け', 'games/matomete/main.js', 'state = history.pop();\n    moves.pop();', 'state = Object.assign({}, history.pop(), { streak: state.streak });\n    moves.pop();'],
  ['MQ35 まとめてポン：前の版（v:2）の途中保存の手を捨てない（v:1 だけ捨てる）', '保存データ互換', 'games/matomete/logic.js', 'if (o.v !== SAVE_V) return { seed: o.seed, mode: o.mode, moves: [] };', 'if (o.v === 1) return { seed: o.seed, mode: o.mode, moves: [] };'],
  ['MQ36 まとめてポン：選んだとき まわりの予告（光・札の合計）が出ない', '表示', 'games/matomete/main.js', 'const extra = pv && Array.isArray(pv.extra) ? pv.extra.map((c) => [c[0], c[1]]) : [];', 'const extra = [];'],
  ['MQ37 まとめてポン：「れんぞく 2」「ひろがる！」の大きな文字が出ない', '演出', 'games/matomete/render.js', 'if (a.streak >= 2) showBurst(a.streak);', ''],
  ['MQ38 まとめてポン：まわりも消える演出が 0.9 秒を超える', '性能', 'games/matomete/render.js', 'a.end = calm || !ok ? CALM_FADE_MS : fallAt + fallMs + shiftMs;', 'a.end = calm || !ok ? CALM_FADE_MS : fallAt + fallMs + shiftMs + 400;'],
  ['MQ39 まとめてポン：まわりも消えるときの音 blast が鳴らない', '効果音', 'games/matomete/render.js', 'snd("blast", a.radius);', ''],
  ['MQ40 まとめてポン：盤の上の れんぞくの表示が出ない', '表示', 'games/matomete/main.js', 'el.streak.hidden = false;', ''],
  // ミチビキ空港（契約 docs/michibiki-contract.md §13.4。流すときは ONLY に FL・FW の全項目、M=MF1,…,MF24）
  ['MF1 ミチビキ空港：色が違う滑走路にも着陸する', 'ルール', 'games/michibiki/logic.js', 'if (rw.color !== p.color || rw.color >= s.colors) continue;', 'if (rw.color >= s.colors) continue;'],
  ['MF2 ミチビキ空港：ぶつかってもライフが減らない', 'ルール', 'games/michibiki/logic.js', 's.lives = Math.max(0, s.lives - CRASH_LIFE);', 's.lives = Math.max(0, s.lives - 0);'],
  ['MF3 ミチビキ空港：ぶつかると片方だけ消える', 'ルール', 'games/michibiki/logic.js', 'gone.add(a.id); gone.add(b.id);', 'gone.add(b.id);'],
  ['MF4 ミチビキ空港：端で跳ね返らず外へ出る', 'ルール', 'games/michibiki/logic.js', 'if (bounce(p, s.w, s.h)) {', 'if (false && bounce(p, s.w, s.h)) {'],
  ['MF5 ミチビキ空港：道が終わると止まる（直進しない）', 'ルール', 'games/michibiki/logic.js', 'if (p.pathI >= p.path.length) { p.path = null; p.pathI = 0; }', 'if (p.pathI >= p.path.length) { p.path = null; p.pathI = 0; p.speed = 0; left = 0; }'],
  ['MF6 ミチビキ空港：最初から2色（COLOR_STEPS の 4 を 0 に。§19 C2 で [0, 4, 12]）', 'ルール', 'games/michibiki/logic.js', 'const COLOR_STEPS = Object.freeze([0, 4, 12]);', 'const COLOR_STEPS = Object.freeze([0, 0, 12]);'],
  ['MF7 ミチビキ空港：出る間隔が短くならない（§19 C1 の式ごと）', 'ルール', 'games/michibiki/logic.js', 'const v = INTERVAL_START - INTERVAL_DROP * Math.min(n, INTERVAL_KNEE) - INTERVAL_DROP2 * Math.max(0, n - INTERVAL_KNEE);', 'const v = INTERVAL_START;'],
  ['MF8 ミチビキ空港：ライフ 0 で終わらない', 'ルール', 'games/michibiki/logic.js', 'if (s.lives <= 0) {', 'if (s.lives < 0) {'],
  ['MF9 ミチビキ空港：着陸の動き中もぶつかる', 'ルール', 'games/michibiki/logic.js', 'const fly = s.planes.filter((p) => p.phase === "fly").sort(', 'const fly = s.planes.slice().sort('],
  ['MF10 ミチビキ空港：予告なしにすぐ出る', 'ルール', 'games/michibiki/logic.js', 'spawnTick: s.tick + (isInt(opt.delay) ? opt.delay : WARN_T)', 'spawnTick: s.tick + (isInt(opt.delay) ? opt.delay : 0)'],
  ['MF11 ミチビキ空港：乱数に Math.random を使う（種を見ない）', 'ルール', 'games/michibiki/logic.js', 'next() { const r = rngStep(box.a); box.a = r[0]; return r[1]; }', 'next() { const r = rngStep(box.a); box.a = r[0]; return Math.random(); }'],
  ['MF12 ミチビキ空港：NEAR_D を CRASH_D と同じに（知らせが出ない）', 'ルール', 'games/michibiki/logic.js', 'const NEAR_D = 56;', 'const NEAR_D = 20;'],
  ['MF13 ミチビキ空港：setPath が点を場の内側に収めない', 'ルール', 'games/michibiki/logic.js', 'const x = clamp(points[i][0], PLANE_R, w - PLANE_R);\n      const y = clamp(points[i][1], PLANE_R, h - PLANE_R);', 'const x = points[i][0];\n      const y = points[i][1];'],
  ['MF14 ミチビキ空港：pickPlane の半径を PLANE_R に（つかみにくい）', '操作', 'games/michibiki/logic.js', 'if (d > PICK_R) continue;', 'if (d > PLANE_R) continue;'],
  ['MF15 ミチビキ空港：hidden で止まらない', '中断', 'games/michibiki/main.js', 'if (document.hidden) { if (phase === "playing") pause(); acc = 0; lastT = null; }', 'if (document.hidden) { acc = 0; lastT = null; }'],
  ['MF16 ミチビキ空港：validateBest が負の値を通す', '保存', 'games/michibiki/logic.js', 'if (!/^\\d+$/.test(t)) return 0;\n      n = Number(t);\n    } else return 0;\n    return Number.isSafeInteger(n) && n >= 0 ? n : 0;', 'if (!/^-?\\d+$/.test(t)) return 0;\n      n = Number(t);\n    } else return 0;\n    return Number.isSafeInteger(n) ? n : 0;'],
  ['MF17 ミチビキ空港：終わりのカードのロックなし', '誤タップ', 'games/michibiki/main.js', 'if (overlayKind === "over" && now() - cardShownAt < CARD_LOCK_MS) return;', ''],
  ['MF18 ミチビキ空港：向きを見ない（区域に入れば着陸）', 'ルール', 'games/michibiki/logic.js', 'if (dot >= LAND_DOT) {', 'if (true) {'],
  ['MF19 ミチビキ空港：内積の符号が逆（逆向きのときだけ着陸）', 'ルール', 'games/michibiki/logic.js', 'const dot = p.dx * inZone.dx + p.dy * inZone.dy;', 'const dot = -(p.dx * inZone.dx + p.dy * inZone.dy);'],
  ['MF20 ミチビキ空港：LAND_DOT の比べ方を >= から > に（境界ちょうどで着陸しない）', 'ルール', 'games/michibiki/logic.js', 'if (dot >= LAND_DOT) {', 'if (dot > LAND_DOT) {'],
  ['MF21 ミチビキ空港：LAND_DOT を 0 に（真横まで着陸する）', 'ルール', 'games/michibiki/logic.js', 'const LAND_DOT = 0.7;', 'const LAND_DOT = 0;'],
  ['MF22 ミチビキ空港：wrongway を区域にいる間ずっと出す（wrongIn を見ない）', 'ルール', 'games/michibiki/logic.js', '} else if (p.wrongIn !== inZone.color) {', '} else {'],
  ['MF23 ミチビキ空港：suggestPath が手前の点を通らず、入り口へ一直線', 'ルール', 'games/michibiki/logic.js', /if \(pu > -APPROACH_D\) \{[\s\S]*?pts\.push\(A\);[^\n]*\n/, ''],
  ['MF24 ミチビキ空港：setPath の guided が向きを見ない（区域に入れば true）', 'ルール', 'games/michibiki/logic.js', 'if (u && u[0] * rw.dx + u[1] * rw.dy >= LAND_DOT) { guided = true; break; }', 'if (true) { guided = true; break; }'],
  // §19 レビュー後の直し（A1・A2・A3・A7・B2）と、いろびん・まとめてポンの pageshow（A3 の横展開）
  ['MF25 ミチビキ空港：着陸してもすぐベストを保存しない（§19 A2）', '保存', 'games/michibiki/main.js', 'saveBestNow();\n', ''],
  ['MF26 ミチビキ空港：最初の setPath で機体のそばの点を捨てない（うしろをつかむと Uターン。§19 A1）', '操作', 'games/michibiki/main.js', '} else d.pending = d.pending.slice(k);', '}'],
  ['MF27 ミチビキ空港：pageshow で終わりのカードを出し直さない（§19 A3）', '閉じ込め', 'games/michibiki/main.js', 'window.addEventListener("pageshow", () => {\n    if (hintTimer', 'window.addEventListener("pageshow-x", () => {\n    if (hintTimer'],
  ['MF28 ミチビキ空港：同じ機体を2本目の指でもなぞれる（§19 A7）', '操作', 'games/michibiki/main.js', 'for (const d of drawings.values()) if (d.id === id) return false;', ''],
  ['MF29 ミチビキ空港：「さいしょから」が確認なしで始め直す（§19 B2）', '誤タップ', 'games/michibiki/main.js', 'else if (cmd === "restart") showRestartConfirm();', 'else if (cmd === "restart") startGame(newSeed());'],
  ['MF30 ミチビキ空港：newGame が置き方を見ない（MC-15）', 'ルール', 'games/michibiki/logic.js', 'const pl = normPlan(plan);', 'const pl = 0;'],
  ['MF31 ミチビキ空港：着陸の判定だけ置き方 0 の滑走路で見る（MC-15）', 'ルール', 'games/michibiki/logic.js', 'const rws = runwayListOf(s.layout, s.plan);', 'const rws = runwayListOf(s.layout, 0);'],
  ['MF32 ミチビキ空港：毎回同じ置き方を選ぶ（MC-15）', '表示', 'games/michibiki/main.js', 'return lastPlan < 0 ? Math.floor(Math.random() * n) : (lastPlan + 1 + Math.floor(Math.random() * (n - 1))) % n;', 'return 0;'],
  ['MB22 いろびん：pageshow でクリアのカードの押せない見た目を外さない（ミチビキ空港 §19 A3 の横展開）', '誤タップ', 'games/irobin/main.js', '    if (overlayKind !== "clear") return;\n    const unlock', '    return;\n    const unlock'],
  // 古いページから書き戻さない（X-20。いろびん §18・まとめてポン §11）。流すときは ONLY=BW20,QW21,X1
  ['MB23 いろびん：表に戻ったとき保存がほかで変わっていても開き直さない（契約 §18・X-20）', '保存', 'games/irobin/main.js', '    if (!stale && WATCH_KEYS.every((k) => readKey(k) === seenRaw.get(k))) return false;', '    return false;'],
  ['MB24 いろびん：開き直す前（stale）でも保存を書く（契約 §18・X-20）', '保存', 'games/irobin/main.js', '  function writeKey(key, val) {\n    if (stale) return false;\n', '  function writeKey(key, val) {\n'],
  ['MB25 いろびん：裏へ回る・閉じるときの保存で比べ直さない（storage イベントが届く前に古い面・手を書き戻す。契約 §18・X-20）', '保存', 'games/irobin/main.js', '    if (!stale && changedElsewhere()) stale = true;\n    return stale;', '    return stale;'],
  // いろびん v36（IB-09・IB-11・IB-22）。流すときは ONLY に BL・BW の全項目と X1
  ['MB26 いろびん：makeSave が上限を超えた手も書く（読むときに捨てられ面の最初に戻る。IB-09）', '保存', 'games/irobin/logic.js', 'moves.slice(0, MAX_MOVES_SAVED).map(', 'moves.map('],
  ['MB27 いろびん：予備の固定面（fallback 2）を verify に通さない（IB-11）', '生成', 'games/irobin/logic.js', '      if (!verify(lv, params, got)) throw new Error("いろびん: 予備の面が解けません（" + lv + " 面）");\n', ''],
  ['MB28 いろびん：最後の手まで保存された面を、クリアのカードなしで次の面にする（IB-22）', '保存', 'games/irobin/main.js', '      hud();\n      onClear({ restored: true });\n      return true;', '      const r = L.recordBest(best, level);\n      best = r.best; writeKey(KEY_BEST, String(best));\n      return startLevel(level + 1, []);'],
  //      v37 の新しい仕掛け（IB-29・契約 §19）。局面のキーの 3 文字目（仕掛けの印）を落とす変異は作らない：瓶は印ごとに分かれて並ぶので、落としても局面が重ならず見つけられない（BL16 の作業で確かめた）
  ['MB29 いろびん：ちいさい びんにも 4 段入る（注ぐ量の上限を瓶ごとに見ない）', 'ルール', 'games/irobin/logic.js', 'const cap = td === SMALL_TAG ? SMALL_CAP : CAP;', 'const cap = CAP;'],
  ['MB30 いろびん：ちいさい びんを短く描かない（data-cap をいつも 4 にする）', '見た目', 'games/irobin/render.js', 'btn.dataset.cap = String(bcap);', 'btn.dataset.cap = "4";'],
  ['MB31 いろびん：いろ きまりの びんに ほかの色も入る', 'ルール', 'games/irobin/logic.js', 'if (td !== 0 && td !== SMALL_TAG && td !== c + 1) return R_ONLY;', 'if (false) return R_ONLY;'],
  ['MB32 いろびん：いろ きまりの びんの札（色と記号）を描かない', '見た目', 'games/irobin/render.js', 'only !== null && !sealed ? onlyHtml(only) : bcap === 3', 'bcap === 3'],
  ['MB33 いろびん：鍵の色をそろえても かぎの びんが開かない', 'ルール', 'games/irobin/logic.js', 'if (tagOf(x) === c + 1 && coverOf(x) === KEY_COVER) {', 'if (false) {'],
  ['MB34 いろびん：かぎの びんを押すと選べる（main の かぎの判定を外す）', '操作', 'games/irobin/main.js', '    if (Number.isSafeInteger(b.lock)) {\n      setHint(lockHint(b.lock));', '    if (false) {\n      setHint(lockHint(b.lock));'],
  ['MB35 いろびん：あとから来たお客さんが同じ動物でも ずらさない（IB-08）', '見た目', 'games/irobin/logic.js', 'if (o < i && posOf(o) === p) return perm[(p + 1) % k];', ''],
  ['MB36 いろびん：生成の上限を 200000 に戻す（IB-12）', '生成', 'games/irobin/logic.js', 'const GEN_NODE_BUDGET = 100000;', 'const GEN_NODE_BUDGET = 200000;'],
  ['MB37 いろびん：とける ところまで もどす が 1 手しか戻らない（探さない。IB-25）', 'ルール', 'games/irobin/main.js', '    let lo = 0, hi = history.length, spent = 0, lim = DOOM_NODE_LIMIT;', '    return moves.length - 1; let lo = 0, hi = history.length, spent = 0, lim = DOOM_NODE_LIMIT;'],
  ['MB38 いろびん：もう1つの枠に いま見えている動物を避けない（ずらされた人が待つ間に来た人が同じ動物になる。IB-08）', '見た目', 'games/irobin/render.js', ' && Number(other) === oc.color) c.kind = nextAnimal(lv, c.kind);', ' && Number(other) === oc.color) c.kind = c.kind;'],
  ['MB39 いろびん：はじめての布が 8 面のまま（布を 5 面から前倒ししない。IB-33）', '生成', 'games/irobin/logic.js', 'const CLOTH_INTRO_LEVEL = 5;', 'const CLOTH_INTRO_LEVEL = 8;'],
  ['MB40 いろびん：毎面が節目になる（IB-24）', '進行', 'games/irobin/logic.js', 'const milestone = n % MILESTONE_EVERY === 0;', 'const milestone = true;'],
  ['MB41 いろびん：「あたらしい きろく！」が毎面に出る（IB-24）', '表示', 'games/irobin/main.js', 'const showRecord = c.improved && c.milestone;', 'const showRecord = c.improved;'],
  ['MB42 いろびん：61 面から 10 色にしない（瓶が 11 本のまま。IB-43）', '生成', 'games/irobin/logic.js', '{ from: 61, colors: 10,', '{ from: 61, colors: 9,'],
  ['MB43 いろびん：1〜60 面も 10 色の中から色を選ぶ（前の面が変わる。IB-43）', '生成', 'games/irobin/logic.js', 'COLORS.slice(0, p.colors > BASE_COLORS ? MAX_COLORS : BASE_COLORS)', 'COLORS.slice(0, MAX_COLORS)'],
  ['MB44 いろびん：61〜69 面の軽い仕掛けの行が無い（50 面の行のまま。IB-43）', '生成', 'games/irobin/logic.js', '{ from: 61,  odd: [A1S, __, A1S, __],', '{ from: 70,  odd: [A1S, __, A1S, __],'],
  ['MB45 いろびん：背の低い画面で瓶の背を低くしない（SE の Safari で瓶が重なる・切れる。IB-44）', '表示', 'games/irobin/render.js', 'if (best.w < 44) {', 'if (false) {'],
  ['MB46 いろびん：むらさきの記号「つき」を描かない（予備の ● になる。IB-43）', '表示', 'games/irobin/render.js', "    moon: '<path", "    moonX: '<path"],
  ['MB47 いろびん：= キーで 12 本目を選べない（IB-43）', '入力', 'games/irobin/input.js', 'key === "=" || key === "^" ? 12 : ', ''],
  ['MB48 いろびん：とける ところまで もどす で、言い切れない局面の上限を広げない（3,000 のまま。面の最初まで落ちる。IB-46）', 'ルール', 'games/irobin/main.js', '      lim *= REWIND_GROW;', '      lim *= 1;'],
  ['MB49 いろびん：とける ところまで もどす の探す量の合計を 30,000 に戻す（何回か広げる場面で面の最初に落ちる。IB-46）', 'ルール', 'games/irobin/main.js', 'const REWIND_BUDGET = 100000;', 'const REWIND_BUDGET = 30000;'],
  ['MB50 いろびん：とける ところまで もどす で上限の広げ方を 2 倍にする（合計に届いて面の最初に落ちる。IB-46）', 'ルール', 'games/irobin/main.js', 'const REWIND_GROW = 4;', 'const REWIND_GROW = 2;'],
  ['MB51 いろびん：とける ところまで もどす を探している間・直後の押下を止めない（止まっている間の 2 回目のタップで 1 手もどる。IB-46）', '操作', 'games/irobin/main.js', 'function rewindBusy() { return rewindRun === runId || now() < rewindBlockUntil; }', 'function rewindBusy() { return false; }'],
  ['MB52 いろびん：開き直したクリアのカードで、なかよしちょうの数を二重に足す（IB-34）', '保存', 'games/irobin/main.js', 'count: !(o && o.restored && rb.book.last === level)', 'count: true'],
  ['MB53 いろびん：なかよしちょうの負の数・小数を捨てない（IB-34）', '保存', 'games/irobin/logic.js', 'if (Number.isSafeInteger(n) && n > 0 && n <= BOOK_MAX_COUNT) b.a[k] = n;', 'if (typeof n === "number") b.a[k] = n;'],
  ['MB54 いろびん：新しい版の なかよしちょうを書きかえる（IB-34）', '保存', 'games/irobin/logic.js', 'if (o.v > BOOK_V) return { book: emptyBook(), write: false };', 'if (o.v > BOOK_V) return { book: emptyBook(), write: true };'],
  ['MB55 いろびん：なかよしの段が 1 つ遅れる（10 にんで上がらない。IB-34）', '保存', 'games/irobin/logic.js', 'for (const t of BOOK_STEPS) if (Number(n) >= t) s += 1;', 'for (const t of BOOK_STEPS) if (Number(n) > t) s += 1;'],
  ['MB56 いろびん：面の星を良い方でなく今回の値で上書きする（IB-34）', '保存', 'games/irobin/logic.js', '[Math.max(prev[0], star), Math.min(prev[1], mv)]', '[star, mv]'],
  ['MB57 いろびん：クリアの帳面の書き込みが X-20 の見張り（stale）を通らない（裏で別のページが保存を書いたあとでも帳面を書く。IB-34）', '保存', 'games/irobin/main.js', 'if (rb.write) writeKey(KEY_BOOK, L.makeBook(r2.book));', 'if (rb.write) localStorage.setItem(KEY_BOOK, L.makeBook(r2.book));'],
  ['MB58 いろびん：帳面を次の面の保存（irobin.save）より後に書く（順番が逆。IB-34）', '保存', 'games/irobin/main.js', 'if (rb.write) writeKey(KEY_BOOK, L.makeBook(r2.book));', 'if (rb.write) later(() => writeKey(KEY_BOOK, L.makeBook(r2.book)), 0);'],
  ['MB59 いろびん：setState の局面のクリアでも帳面を書く（IB-34）', '保存', 'games/irobin/main.js', 'if (!custom) {\n      const rb = readBookNow();', 'if (true) {\n      const rb = readBookNow();'],
  ['MB60 いろびん：なかよしちょうを開く・閉じた直後の押せない時間を消す（2 回すばやく押すとメニューへ出る。IB-34）', '誤タップ', 'games/irobin/main.js', 'now() - bookLockAt < BOOK_LOCK_MS) return;', 'false) return;'],
  ['MQ41 まとめてポン：pageshow で終わりのカードの押せない見た目を外さない（ミチビキ空港 §19 A3 の横展開）', '誤タップ', 'games/matomete/main.js', '    if (overlayKind !== "over") return;\n    const unlock', '    return;\n    const unlock'],
  ['MQ42 まとめてポン：表に戻ったとき保存がほかで変わっていても開き直さない（契約 §11・X-20）', '保存', 'games/matomete/main.js', '    if (!stale && WATCH_KEYS.every((k) => readKey(k) === seenRaw.get(k))) return false;', '    return false;'],
  ['MQ43 まとめてポン：裏で別のタブが書いても保存を止めない（storage を見ない。契約 §11・X-20）', '保存', 'games/matomete/main.js', 'if (document.hidden && (e.key === null || seenRaw.has(e.key))) stale = true;', 'if (false) stale = true;'],
  ['MQ44 まとめてポン：裏へ回る・閉じるときの保存で比べ直さない（storage イベントが届く前に古い盤・手を書き戻す。契約 §11・X-20）', '保存', 'games/matomete/main.js', '    if (!stale && changedElsewhere()) stale = true;\n    return stale;', '    return stale;'],
  // もくもくこうば（契約 docs/seizai-contract.md §11.4。流すときは ONLY に WL・WW の全項目、M=MW1,…,MW50）
  ['MW1 もくもくこうば：閉じた間の上限を外す（awaySeconds も catchUp も 7200 を見ない）', '日付', 'games/seizai/logic.js', /return Math\.min\(Math\.floor\(d \/ 1000\), OFFLINE_CAP_SEC\);([\s\S]*?)clamp\(Math\.floor\(seconds\), 0, OFFLINE_CAP_SEC\)/, 'return Math.floor(d / 1000);$1Math.max(0, Math.floor(seconds))'],
  ['MW2 もくもくこうば：半分の係数を見ない（閉じた秒をそのまま進める）', '日付', 'games/seizai/logic.js', 'const effective = Math.floor(sec * AWAY_RATE);', 'const effective = Math.floor(sec);'],
  ['MW3 もくもくこうば：半分の係数を2回掛ける（main.js でも掛ける＝4分の1）', '日付', 'games/seizai/main.js', 'L.catchUp(state, seconds)', 'L.catchUp(state, seconds * L.AWAY_RATE)'],
  ['MW4 もくもくこうば：上限を半分にした後で掛ける（min(sec × 0.5, 7200)＝実質4時間）', '日付', 'games/seizai/logic.js', /const sec = isNum\(seconds\) \? clamp\(Math\.floor\(seconds\), 0, OFFLINE_CAP_SEC\) : 0;([\s\S]*?)const effective = Math\.floor\(sec \* AWAY_RATE\);/, 'const sec = isNum(seconds) ? Math.max(0, Math.floor(seconds)) : 0;$1const effective = Math.min(Math.floor(sec * AWAY_RATE), OFFLINE_CAP_SEC);'],
  ['MW5 もくもくこうば：時計が戻ったとき now − savedAt をそのまま使う（マイナス）', '日付', 'games/seizai/logic.js', '    if (!(d >= 0)) return 0;\n', ''],
  ['MW6 もくもくこうば：壊れた savedAt を 0 にしない（awaySeconds が数かを見ない）', '日付', 'games/seizai/logic.js', 'if (!isNum(savedAt) || !isNum(now)) return 0;', 'if (!isNum(now)) return 0;'],
  ['MW7 もくもくこうば：loadSave が壊れた savedAt を 0（1970年）にする（NaN にしない＝2時間ぶん足される）', '日付', 'games/seizai/logic.js', 'const savedAt = isNum(o.savedAt) ? o.savedAt : NaN;', 'const savedAt = Number(o.savedAt) || 0;'],
  ['MW8 もくもくこうば：ローカルの日付で経った時間を数える（日付の差×86400）', '日付', 'games/seizai/logic.js', 'const d = now - savedAt;', 'const d = (new Date(now).getDate() - new Date(savedAt).getDate()) * 86400000;'],
  ['MW9 もくもくこうば：visible で二重に足す（sleeping を見ずに毎回足す）', '日付', 'games/seizai/main.js', 'if (!sleeping || document.hidden) return;', 'if (document.hidden) return;'],
  ['MW10 もくもくこうば：人の費用の増え方 1.55 を 1.05 に', '計算', 'games/seizai/logic.js', 'const STAFF_GROWTH = 1.55;', 'const STAFF_GROWTH = 1.05;'],
  ['MW11 もくもくこうば：マネージャーの「はやい」が効かない', '計算', 'games/seizai/logic.js', '    if (d.mgr === "fast") r *= MGR_FAST;\n', ''],
  ['MW12 もくもくこうば：マネージャーの「もうかる」が効かない', '計算', 'games/seizai/logic.js', '(1 + MGR_GAIN * gainCount(s))', '(1 + 0 * gainCount(s))'],
  ['MW13 もくもくこうば：置き場の上限を見ない（つまらない）', 'ルール', 'games/seizai/logic.js', 'const cap = BUF_CAP[si], gcap = GOODS_CAP[si];', 'const cap = Infinity, gcap = GOODS_CAP[si];'],
  ['MW14 もくもくこうば：自然に生えない（木が尽きて止まる）', 'ルール', 'games/seizai/logic.js', 'const nat = Math.min(stumps, NATURAL_REGROW * dt);', 'const nat = 0;'],
  ['MW15 もくもくこうば：目標を前の段から数え続ける（広げても 0 に戻さない）', 'ルール', 'games/seizai/logic.js', '    s.goal.done = 0;\n', ''],
  ['MW16 もくもくこうば：応援の使えない間を見ない（連打できる）', 'ルール', 'games/seizai/logic.js', '    if (s.t < d.cooldownUntil) return "cooldown";\n', ''],
  ['MW17 もくもくこうば：注文のお礼を2回払う', '計算', 'games/seizai/logic.js', 's.money = addMoney(s.money, o.reward);', 's.money = addMoney(addMoney(s.money, o.reward), o.reward);'],
  ['MW18 もくもくこうば：loadSave が v を見ない（新しい版の保存も読む）', '保存', 'games/seizai/logic.js', '      if (o.v !== SAVE_VERSION) return null;\n', ''],
  ['MW19 もくもくこうば：loadSave がお金を丸めない（負・上限超え・小数のまま）', '保存', 'games/seizai/logic.js', 's.money = intIn(o.money, 0, MONEY_MAX, 0);', 's.money = isNum(o.money) ? o.money : 0;'],
  ['MW20 もくもくこうば：壊れた保存を bak に写さず上書き', '保存', 'games/seizai/main.js', 'if (!keepBroken(raw)) saveBlocked = true;', ''],
  ['MW21 もくもくこうば：bak が既にあっても上書き（最初の壊れた保存が消える）', '保存', 'games/seizai/main.js', '    if (readKey(KEY_BAK) !== null) return okNewer;\n', ''],
  ['MW22 もくもくこうば：MONEY_MAX で止めない', '桁', 'games/seizai/logic.js', 'const addMoney = (m, y) => Math.min(MONEY_MAX, Math.floor(m + y));', 'const addMoney = (m, y) => Math.floor(m + y);'],
  ['MW23 もくもくこうば：船の大きさが増えない（SHIP_GROWTH を見ない＝いつも 30,000）', 'ルール', 'games/seizai/logic.js', 'Math.pow(SHIP_GROWTH, k)', 'Math.pow(1, k)'],
  ['MW24 もくもくこうば：船の大きさの上限を見ない（n が大きいと Infinity・NaN）', '桁', 'games/seizai/logic.js', /if \(k > 60\) return SHIP_NEED_MAX;([\s\S]*?)return isNum\(v\) \? Math\.min\(SHIP_NEED_MAX, v\) : SHIP_NEED_MAX;/, '$1return v;'],
  ['MW25 もくもくこうば：船が届くと ships を 2 増やす', 'ルール', 'games/seizai/logic.js', 's.ships += 1;', 's.ships += 2;'],
  ['MW26 もくもくこうば：船のお礼を2回払う', '計算', 'games/seizai/logic.js', 's.money = addMoney(s.money, Math.floor(SHIP_REWARD_MUL * need * priceOfS(s)));', 's.money = addMoney(addMoney(s.money, Math.floor(SHIP_REWARD_MUL * need * priceOfS(s))), Math.floor(SHIP_REWARD_MUL * need * priceOfS(s)));'],
  ['MW27 もくもくこうば：船が届いたとき あまりを捨てる（got = 0）', 'ルール', 'games/seizai/logic.js', 's.ship.got -= need;', 's.ship.got = 0;'],
  ['MW28 もくもくこうば：2せき目からもエンディングのカードを出す', 'ルール', 'games/seizai/main.js', 'if (e.ending) {', 'if (true) {'],
  ['MW29 もくもくこうば：大口の注文へ入った板も船に数える', 'ルール', 'games/seizai/logic.js', 'if (k > 0) { b.goods -= k; o.got += k; }', 'if (k > 0) { b.goods -= k; o.got += k; if (s.stage === 4) s.ship.got += k; }'],
  ['MW30 もくもくこうば：logic.js を APP_FILES から外す', 'オフライン', 'sw.js', '  "./games/seizai/logic.js",\n', ''],
  ['MW31 もくもくこうば：actors.js を APP_FILES から外す', 'オフライン', 'sw.js', '  "./games/seizai/actors.js",\n', ''],
  // 契約 §11.4 の表の外（WW で見る画面・進行の仕組み）
  ['MW32 もくもくこうば：カードの 400ms のロックなし（出た直後に押せる）', '誤タップ', 'games/seizai/main.js', 'if (overlay !== cardCmd[cmd] || cardLocked()) return;', 'if (overlay !== cardCmd[cmd]) return;'],
  ['MW33 もくもくこうば：hidden で止まらない（visibilitychange の hidden で sleep を呼ばない）', '中断', 'games/seizai/main.js', 'document.addEventListener("visibilitychange", () => { if (document.hidden) sleep(); else if (!reloadIfStale()) wake(); });', 'document.addEventListener("visibilitychange", () => { if (!document.hidden && !reloadIfStale()) wake(); });'],
  ['MW34 もくもくこうば：pagehide でタイマーを片付けない', '中断', 'games/seizai/main.js', 'window.addEventListener("pagehide", () => { sleep(); clearLater(); });', 'window.addEventListener("pagehide", () => { sleep(); });'],
  ['MW35 もくもくこうば：10 秒ごとの自動保存をしない', '保存', 'games/seizai/main.js', '    if (saveSince >= SAVE_EVERY_SEC) saveNow();\n', ''],
  ['MW36 もくもくこうば：シートの値段が costOf と 1 割ずれる（表示の1ずれ）', '表示', 'games/seizai/main.js', 'else setBtn(b, labels[w], yen(t.cost), !t.ok, t.ok ? "" : HINT_MONEY);', 'else setBtn(b, labels[w], yen(Math.round(t.cost * 1.1)), !t.ok, t.ok ? "" : HINT_MONEY);'],
  ['MW37 もくもくこうば：#money が 1 えんずれる（表示の1ずれ）', '表示', 'games/seizai/main.js', 'const m = yen(state.money);', 'const m = yen(state.money - 1);'],
  ['MW38 もくもくこうば：広げても seizai.best を書かない', '保存', 'games/seizai/main.js', '    writeBest(state.stage);\n    saveNow();\n    closeSheet();', '    saveNow();\n    closeSheet();'],
  ['MW39 もくもくこうば：お金が足りないとき音 deny もヒントも出さない', '表示', 'games/seizai/main.js', '    sfx.play("deny");\n    setHint(reasonText(reason, what, d) || HINT_MONEY);\n', ''],
  // レビュー後の直し（契約 §17。2026-10-21）
  ['MW40 もくもくこうば：上限に着いても切る前の秒を渡さない（SZ-01 の戻り＝capped がいつも false）', '日付', 'games/seizai/main.js', '    if (sec >= OFFLINE_CAP_SEC) {', '    if (false) {'],
  ['MW41 もくもくこうば：遊び方の間も止めない', 'ルール', 'games/seizai/main.js', '    if (readingCard()) acc = 0;', '    if (overlay === "reset") acc = 0;'],
  ['MW42 もくもくこうば：rAF だけが止まった間を足さない（捨てる）', '日付', 'games/seizai/main.js', '    if (w - wallLast > STALL_SEC * 1000 && !readingCard()) {', '    if (false) {'],
  ['MW43 もくもくこうば：シートを開いても押した部署を見える所へスクロールしない', '表示', 'games/seizai/main.js', '    revealZone(dept);\n', ''],
  ['MW44 もくもくこうば：新しい版の保存を seizai.save.v<n> に残さない', '保存', 'games/seizai/main.js', 'if (Number.isInteger(v) && v > (L.SAVE_VERSION || 1) && v < 1e6)', 'if (false)'],
  ['MW45 もくもくこうば：大口の注文が こうじょう から（こうば で来ない）', 'ルール', 'games/seizai/logic.js', 'const ORDER_FROM_STAGE = 2;', 'const ORDER_FROM_STAGE = 3;'],
  ['MW46 もくもくこうば：とくべつな注文のお礼が ふつうと同じ', '計算', 'games/seizai/logic.js', 'const mul = ORDER_REWARD_MUL * (big ? ORDER_BIG_REWARD / ORDER_BIG_NEED : 1);', 'const mul = ORDER_REWARD_MUL;'],
  ['MW47 もくもくこうば：壊れた保存の注文のお礼を計算し直さない（0 のまま）', '保存', 'games/seizai/logic.js', 'isNum(r.reward) && r.reward > 0 ? intIn(r.reward, 1, MONEY_MAX, 1) : orderReward(need, priceOfS(s), big)', 'intIn(r.reward, 0, MONEY_MAX, 0)'],
  ['MW48 もくもくこうば：fastForward が 2 倍の速さで進む（advance が step と食い違う）', '計算', 'games/seizai/logic.js', '        stepMut(s, STEP, ev);\n        for (const e of ev) {\n          if (e.kind === "sold") sold += e.n;', '        stepMut(s, STEP * 2, ev);\n        for (const e of ev) {\n          if (e.kind === "sold") sold += e.n;'],
  ['MW49 もくもくこうば：とくべつな注文の旗が保存で消える', '保存', 'games/seizai/logic.js', 'need, got: intIn(r.got, 0, need - 1, 0), reward, accepted: r.accepted === true, big\n', 'need, got: intIn(r.got, 0, need - 1, 0), reward, accepted: r.accepted === true, big: false\n'],
  ['MW50 もくもくこうば：とくべつな注文が出ない', 'ルール', 'games/seizai/logic.js', 'const big = rand(s) < ORDER_BIG_RATE;', 'const big = rand(s) < 0;'],
  // もくもくこうば v26（契約 §19.1.6。工程と道具。WL12・WL13 が見つけるはず）
  ['MW51 もくもくこうば：かんそう を飛ばす（いた が角材を直接使う）', 'ルール', 'games/seizai/logic.js', /work\(s, "plank", dt, b\.dried, ([^\n]*)\n(\s*)b\.dried -= n;/, 'work(s, "plank", dt, b.beams, $1\n$2b.beams -= n;'],
  ['MW52 もくもくこうば：かんな を飛ばす（みなと でも いた が売り物の山へ出る）', 'ルール', 'games/seizai/logic.js', 'const out = st === 3 ? "goods" : "planks";', 'const out = "goods";'],
  ['MW53 もくもくこうば：古い保存（かんそう の欄が無い）で かんそう を 0台にする（こうじょう で止まり続ける）', '保存', 'games/seizai/logic.js', 'if (x.kind === "line") d.lines = open ? intIn(src.lines, 1, cap, 1) : 0;', 'if (x.kind === "line") d.lines = open && has ? intIn(src.lines, 1, cap, 1) : 0;'],
  ['MW54 もくもくこうば：もうかる の数に かんそう・かんな を数えない（最大 7 のまま）', '計算', 'games/seizai/logic.js', 'for (const id of IDS) if (unlocked(s.stage, id) && s.depts[id].mgr === "gain") n++;', 'for (const id of IDS) if (id !== "dry" && id !== "plane" && unlocked(s.stage, id) && s.depts[id].mgr === "gain") n++;'],
  ['MW55 もくもくこうば：toolTier の境目を >= から > に（Lv5 で道具が変わらない）', 'ルール', 'games/seizai/logic.js', 'if (level >= TOOL_LV[i]) t = i;', 'if (level > TOOL_LV[i]) t = i;'],
  ['MW56 もくもくこうば：toolUp を きかい の Lv が上がるたびに出す', 'ルール', 'games/seizai/logic.js', 'if (tier > before) toolUp', 'if (tier >= before) toolUp'],
  ['MW57 もくもくこうば：みなと の売り物が板のまま（つるつるいた にならない）', 'ルール', 'games/seizai/logic.js', 'product: "smooth", goal: SHIP_BASE,', 'product: "planks", goal: SHIP_BASE,'],
  ['MW58 もくもくこうば：こうじょう に広げても かんそう の台が来ない', 'ルール', 'games/seizai/logic.js', 'if (x.kind === "line" && x.stage === s.stage && s.depts[x.id].lines < 1)', 'if (x.kind === "line" && x.stage === s.stage && x.id !== "dry" && s.depts[x.id].lines < 1)'],
  ['MW59 もくもくこうば：つまりの判定で かんな を板の数のまま比べる（丸太に直さない）', '計算', 'games/seizai/logic.js', 'f.plane = rateOf(s, "plane") / PLANKS_PER_BEAM;', 'f.plane = rateOf(s, "plane");'],
  ['MW60 もくもくこうば：かんな ができても totals.smooth を数えない（保存・記録が増えない）', '保存', 'games/seizai/logic.js', 's.done.plane += n; s.totals.smooth += n;', 's.done.plane += n;'],
  ['MW61 もくもくこうば：さいしょから で seizai.save.bak を消さない', '保存', 'games/seizai/main.js', 'removeKey(KEY_BAK);', '/* bak は消さない */'],
  ['MW62 もくもくこうば：さいしょから で保存を止めずに消す（pagehide で古い状態を書き戻す）', '保存', 'games/seizai/main.js', 'resetting = true;', 'resetting = false;'],
  ['MW63 もくもくこうば：さいしょから で seizai.best も消す', '保存', 'games/seizai/main.js', 'removeKey(KEY_BAK);', 'removeKey(KEY_BAK); removeKey(KEY_BEST);'],
  ['MW64 もくもくこうば：さいしょからの「やめる」でも保存を消す', '保存', 'games/seizai/main.js', 'else if (cmd === "resetNo") swapCard("reset", "help");', 'else if (cmd === "resetNo") { removeKey(KEY_SAVE); swapCard("reset", "help"); }'],
  // 古いページから書き戻さない（契約 §22・X-20）。流すときは ONLY=WW26,X1
  ['MW65 もくもくこうば：表に戻ったとき保存がほかで変わっていても開き直さない（X-20）', '保存', 'games/seizai/main.js', '    if (!stale && !changedElsewhere()) return false;', '    return false;'],
  ['MW66 もくもくこうば：開き直す前（stale）でも保存を書く（X-20）', '保存', 'games/seizai/main.js', '  function writeKey(key, val) {\n    if (stale) return false;\n', '  function writeKey(key, val) {\n'],
  ['MW67 もくもくこうば：裏へ回る・閉じるときの保存で比べ直さない（storage イベントが届く前に古い状態を書き戻す。X-20）', '保存', 'games/seizai/main.js', '    if (!stale && changedElsewhere()) stale = true;\n    return stale;', '    return stale;'],
  // かんな の直し（契約 §23・SZ-08）。流すときは ONLY=WL14,WW27,X1
  ['MW68 もくもくこうば：かんな の baseTime を 5 に戻す（全部さいだい・はやい でも かんな が いちばん遅いまま。SZ-08）', '計算', 'games/seizai/logic.js', 'plank: 2.5, plane: 2.5, shop: 3 });', 'plank: 2.5, plane: 5, shop: 3 });'],
  ['MW69 もくもくこうば：もう強くできない部署にも「ここが おそい！」の札を出す（SZ-08）', '表示', 'games/seizai/render.js', 'if (bn === d && memo.maxed) {', 'if (false) {'],
  ['MW70 もくもくこうば：次の段で上限（CAPS）が増える部署でも「これいじょう はやく できないよ」と言う（moreNextStage が CAPS を見ない。S1）', '表示', 'games/seizai/logic.js', '    if ((kind === "staff" || kind === "line") && capOf(s.stage + 1, id) > capOf(s.stage, id)) return true;\n', ''],
  // ---- ちきゅうを守れ！ほしくだき（games/asteroid/）。中身の仕組みを変えたときだけ、このゲームの分だけ流す（契約 §11.4）。----
  //      数値（星の時間・値段・体力）の調整中なので、数値を変える変異は KL に任せ、ここは画面・保存・中断・オフライン・場を押す・ルールの流れを中心にする
  ['MK1 ほしくだき：2択の間も場が進む（choose でも step が進み、fly に戻る）', 'ルール', 'games/asteroid/logic.js', 'if (s.phase === "choose" || s.phase === "end") return;', 'if (s.phase === "end") return;'],
  ['MK2 ほしくだき：とどいたら かけら・武器を消す', 'データ消失', 'games/asteroid/logic.js', 's.tries = Math.min(TRIES_MAX, s.tries + 1);', 's.tries = Math.min(TRIES_MAX, s.tries + 1); s.kakera = 0; s.slots = s.slots.map((x) => ({ id: x.id, lv: 1 }));'],
  ['MK3 ほしくだき：とどいたとき星を最初からにしない（残りのまま続く）', 'ルール', 'games/asteroid/logic.js', 'function restartStar(s, evs) {\n    s.rock = genRock(s.seed, s.star, s.tries);', 'function restartStar(s, evs) {\n    s.rock = Object.assign({}, s.rock, { mats: s.rock.mats.slice(), hp: s.rock.hp.slice(), y: s.rock.y - 120, scan: null });'],
  ['MK4 ほしくだき：エンディングを2回出す（星 ENDING_STAR より先のクリアでも出す）', 'ルール', 'games/asteroid/logic.js', 'if (was === ENDING_STAR && !s.cleared) {', 'if (was >= ENDING_STAR) {'],
  ['MK5 ほしくだき：場を押すと進む（#field のクリックで step を進める。#fieldCanvas は pointer-events: none なので親の #field に付ける）', '操作', 'games/asteroid/main.js', '  if (el.helpOk) el.helpOk.addEventListener("click", closeHelp);', '  if (el.field) el.field.addEventListener("click", () => { if (state && state.phase !== "fly") state = Object.assign({}, state, { wait: 0 }); stepOnce(STEP, null); updateUi(); });\n  if (el.helpOk) el.helpOk.addEventListener("click", closeHelp);'],
  ['MK6 ほしくだき：壊れた保存を bak に写さず上書き', '保存', 'games/asteroid/main.js', '        if (!keepBroken(raw)) saveBlocked = true;\n        later(() => setHint(HINT_BROKEN', '        later(() => setHint(HINT_BROKEN'],
  ['MK7 ほしくだき：bak が既にあっても上書き（最初の壊れた保存が消える）', '保存', 'games/asteroid/main.js', '    if (readKey(KEY_BAK) !== null) return true;\n', ''],
  ['MK8 ほしくだき：hidden でも進む（visibilitychange の hidden で sleep を呼ばない）', '中断', 'games/asteroid/main.js', 'document.addEventListener("visibilitychange", () => { if (document.hidden) sleep(); else if (!reloadIfStale()) wake(); });', 'document.addEventListener("visibilitychange", () => { if (!document.hidden && !reloadIfStale()) wake(); });'],
  ['MK9 ほしくだき：logic.js を APP_FILES から外す', 'オフライン', 'sw.js', '  "./games/asteroid/logic.js",\n', ''],
  ['MK10 ほしくだき：render.js を APP_FILES から外す', 'オフライン', 'sw.js', '  "./games/asteroid/render.js",\n', ''],
  ['MK11 ほしくだき：2択のカードの 400ms のロックなし（出た直後に押せる）', '誤タップ', 'games/asteroid/main.js', 'const cardLocked = () => now() - cardShownAt < CARD_LOCK_MS;', 'const cardLocked = () => false;'],
  ['MK12 ほしくだき：#kakera が 1 ずれる（表示の1ずれ）', '表示', 'games/asteroid/main.js', 'setText(el.kakera, fmt(s.kakera));', 'setText(el.kakera, fmt(s.kakera + 1));'],
  ['MK13 ほしくだき：行の値段が upCostOf と 1 割ずれる（表示の1ずれ）', '表示', 'games/asteroid/main.js', 'setText(r.cost, fmt(cost));', 'setText(r.cost, fmt(Math.round(cost * 1.1)));'],
  ['MK14 ほしくだき：#starBar がこわした割合とずれる', '表示', 'games/asteroid/main.js', 'Math.floor(pr.broken * 100)', 'Math.floor(pr.broken * 90)'],
  ['MK15 ほしくだき：はね返しの「あと N%」をこわした割合で出す', '表示', 'games/asteroid/main.js', 'Math.max(1, Math.round((1 - broken) * 100))', 'Math.max(1, Math.round(broken * 100))'],
  ['MK16 ほしくだき：クリアしても asteroid.best を書かない', '保存', 'games/asteroid/main.js', '          writeBest(e.star);\n', ''],
  ['MK17 ほしくだき：かけらが足りないとき音 deny もヒントも出さない', '表示', 'games/asteroid/main.js', '    if (r.reason === "money") {\n      sfx.play("deny");\n      const cost', '    if (false) {\n      sfx.play("deny");\n      const cost'],
  ['MK18 ほしくだき：開き直すと かけらが 0 になる（保存を読んでも かけらを捨てる）', 'データ消失', 'games/asteroid/main.js', '      setClock(loaded, extra.t);\n      state = loaded;', '      setClock(loaded, extra.t);\n      state = Object.assign({}, loaded, { kakera: 0 });'],
  ['MK19 ほしくだき：pagehide でタイマーを片付けない', '中断', 'games/asteroid/main.js', 'window.addEventListener("pagehide", () => { sleep(); clearLater(); });', 'window.addEventListener("pagehide", () => { sleep(); });'],
  ['MK20 ほしくだき：カード（遊び方・2択・入れ替え・エンディング・さいしょから）が出ている間も止めない（running から overlay === null を外す。T-15・§21.4）', '中断', 'games/asteroid/main.js', 'const running = () => !sleeping && !restarting && !stale && overlay === null;', 'const running = () => !sleeping && !restarting && !stale;'],
  ['MK21 ほしくだき：動きを減らす設定を見ない', '動き', 'games/asteroid/main.js', 'let calm = !!reduceMotion.matches;', 'let calm = false;'],
  ['MK22 ほしくだき：2択が開き直しで変わる（保存の offer を入れ替えて読む）', '保存', 'games/asteroid/logic.js', 'base.offer = okOffer ? f.slice() : makeOffer(base);', 'base.offer = okOffer ? f.slice().reverse() : makeOffer(base);'],
  // §18（レビュー後の変更：区切り・クリアの時間とベスト・もろい底・相性・星の途中の保存・手ごたえの表示）。2026-10-21、feature/asteroid-test2
  ['MK23 ほしくだき：区切りをやり直し（はね返し）でもらい直せる', 'ルール', 'games/asteroid/logic.js', '    s.tryAt = s.t;\n  }\n  function nextStar(s, evs) {', '    s.ms = []; s.tryAt = s.t;\n  }\n  function nextStar(s, evs) {'],
  ['MK24 ほしくだき：星のベスト時間を遅いほうにする', '保存', 'games/asteroid/logic.js', 'if (prev === null || time < prev) s.bestT', 'if (prev === null || time > prev) s.bestT'],
  ['MK25 ほしくだき：もろい底なし（下の行も体力 1 倍）', '計算', 'games/asteroid/logic.js', 'const SOFT = deepFreeze({ q: 0.2, mul: 0.05, ramp: 0.15 });', 'const SOFT = deepFreeze({ q: 0.2, mul: 1, ramp: 0.15 });'],
  ['MK26 ほしくだき：相性の倍率 aff がいつも 1', '計算', 'games/asteroid/logic.js', 'return isNum(a) ? a : 1;', 'return 1;'],
  ['MK27 ほしくだき：星の途中の保存（mid）を捨てる', 'データ消失', 'games/asteroid/logic.js', 'if (withMid) { const m = midOf(state); if (m) o.mid = m; }', ''],
  ['MK28 ほしくだき：区切りの帯 #msBanner を出さない', '表示', 'games/asteroid/main.js', 'setHidden(el.msBanner, !(s.phase === "fly" && s.t < msUntil));', 'setHidden(el.msBanner, true);'],
  ['MK29 ほしくだき：開き直しで いまの挑戦の始め（tryAt）をずらさない（クリアの時間に遊んだ合計の秒が足される）', '計算', 'games/asteroid/main.js', '    s.tryAt = (Number.isFinite(s.tryAt) ? s.tryAt : 0) + d;\n', ''],
  ['MK30 ほしくだき：◎ を星の札に関係なく得意のある武器ぜんぶに付ける', '表示', 'games/asteroid/main.js', 'const fit = !!main && !!WEAPON[x.id] && WEAPON[x.id].good === main;', 'const fit = !!WEAPON[x.id] && !!WEAPON[x.id].good;'],
  ['MK31 ほしくだき：クリアの帯の「ちきゅうまで あと N%」を近さの逆で出す', '表示', 'games/asteroid/main.js', 'Math.round(Math.max(0, Math.min(1, dist)) * 100)', 'Math.round((1 - Math.max(0, Math.min(1, dist))) * 100)'],
  ['MK32 ほしくだき：買った行に「＋N%」を出さない', '表示', 'games/asteroid/main.js', '      showPlus(k, dpsBefore, safeCall(() => L.dpsOf(state, k), null));\n', ''],
  ['MK33 ほしくだき：買えない間の「あと N」を不足分でなく値段で出す', '表示', 'games/asteroid/main.js', '"あと " + fmt(lack)', '"あと " + fmt(cost)'],
  ['MK34 ほしくだき：はね返しのおすすめをいつも 1 行目にする（いちばん安い行を見ない）', '表示', 'games/asteroid/main.js', 'suggestSlot = cheapestSlot();', 'suggestSlot = 0;'],
  ['MK35 ほしくだき：2択の冒頭の案内 #choiceLead を出さない', '表示', 'games/asteroid/main.js', 'el.choiceLead.hidden = !lead;', 'el.choiceLead.hidden = true;'],
  ['MK36 ほしくだき：クリアの演出中の保存を同じ星にする（開き直すと同じ星をもう一度）', '保存', 'games/asteroid/logic.js', 'if (state.phase === "clear" && !(state.star === ENDING_STAR && !state.cleared)) {', 'if (false) {'],
  ['MK37 ほしくだき：壊れた bestT（キーが整数でない・0 以下・大きすぎ）を捨てない', '保存', 'games/asteroid/logic.js', 'if (!/^[1-9][0-9]{0,3}$/.test(k) || Number(k) > STAR_MAX || !isNum(v) || v <= 0 || v > 1e7) continue;', 'if (!isNum(v)) continue;'],
  ['MK38 ほしくだき：さいしょからで asteroid.save.bak を消さない', 'データ消失', 'games/asteroid/main.js', 'goneBak = removeKey(KEY_BAK);', 'goneBak = true;'],
  ['MK39 ほしくだき：さいしょからのあと保存を止めない（pagehide・hidden でメモリ上の古い状態を書き戻す）', 'データ消失', 'games/asteroid/main.js', '    if (!state || restarting || stale) return false;', '    if (!state || stale) return false;'],
  ['MK40 ほしくだき：さいしょからで asteroid.best も消す', 'データ消失', 'games/asteroid/main.js', 'goneBak = removeKey(KEY_BAK);', 'goneBak = removeKey(KEY_BAK) && removeKey(KEY_BEST);'],
  ['MK41 ほしくだき：さいしょからの確認で「やめる」を押しても消す', '誤タップ', 'games/asteroid/main.js', 'el.restartNo.addEventListener("click", cancelRestart);', 'el.restartNo.addEventListener("click", doRestart);'],
  ['MK42 ほしくだき：さいしょからで消せないとき #hint で知らせない（古い保存が残ったのに気づけない）', '保存', 'games/asteroid/main.js', '      setHint(HINT_RESET_FAIL, 5000);\n', ''],
  // 作り直し（2026-10-23。契約 §11.4・§21.4）：砲台・斜め撃ち・ビーム・いなずま・てつのかたまり・ひかえと入れ替え・v:1 の引き継ぎ・lose の hold・X-20
  ['MK43 ほしくだき：砲台の x がねらうマスへ動く（AS-01 の戻り）', 'ルール', 'games/asteroid/logic.js', '      T.ang = clamp(T.ang, -AIM_MAX, AIM_MAX);\n    }\n  }', '      T.ang = clamp(T.ang, -AIM_MAX, AIM_MAX);\n      if (T.tgt >= 0 && R.mats[T.tgt]) T.x += clamp(cellX(R, T.tgt) - T.x, -3, 3);\n    }\n  }'],
  ['MK44 ほしくだき：弾がいつも真上へ飛ぶ（たま・ほのお・どかん以外の砲身の向き ang を見ない）', 'ルール', 'games/asteroid/logic.js', '    const room = () => s.shots.length < SHOTS_MAX;\n    const sa = Math.sin(T.ang), ca = Math.cos(T.ang);', '    const room = () => s.shots.length < SHOTS_MAX;\n    const sa = 0, ca = 1;'],
  ['MK45 ほしくだき：ビームが最初のマスで止まる（奥へ掘らない）', 'ルール', 'games/asteroid/logic.js', 'if (dd > d0 + BEAM_DEPTH * CELL) return true;', 'if (dd > d0) return true;'],
  ['MK46 ほしくだき：いなずまが違う種類のマスへ伝わらない（v40 の前に戻る）', 'ルール', 'games/asteroid/logic.js', 'const np = p * (mats[q] === 2 ? BOLT_KEEP.iron : BOLT_KEEP.other);', 'const np = mats[q] === mats[start] ? p * (mats[q] === 2 ? BOLT_KEEP.iron : BOLT_KEEP.other) : 0;'],
  ['MK47 ほしくだき：いなずまが BOLT_CELLS（しんかの数）を見ない', 'ルール', 'games/asteroid/logic.js', '    while (cells.length < n && front.length) {', '    n = Infinity;\n    while (cells.length < n && front.length) {'],
  ['MK48 ほしくだき：てつ を すじ で入れる（かたまりにしない）', '計算', 'games/asteroid/logic.js', '      placeBlobs(mats, cols, rows, cells, ironWant, nb, 2, okRock, rnd);', '      let left = ironWant + 0 * nb; for (const j of cells) { if (left <= 0) break; if (okRock(j) && (j % cols) % 3 === 0) { mats[j] = 2; left--; } }'],
  ['MK49 ほしくだき：入れ替えが星の途中ですぐ当たる', 'ルール', 'games/asteroid/logic.js', '    s.swap.sort((a, b) => a.slot - b.slot);\n    return null;', '    s.swap.sort((a, b) => a.slot - b.slot);\n    applySwaps(s, []);\n    return null;'],
  ['MK50 ほしくだき：はね返しのやり直しで入れ替えが当たらない', 'ルール', 'games/asteroid/logic.js', '    s.phase = "fly";\n    applySwaps(s, evs || []);\n', '    s.phase = "fly";\n'],
  ['MK51 ほしくだき：入れ替えで外した武器の Lv を忘れる（ひかえで Lv 1 になる）', 'データ消失', 'games/asteroid/logic.js', '      s.bench[bi] = { id: out.id, lv: out.lv };', '      s.bench[bi] = { id: out.id, lv: 1 };'],
  ['MK52 ほしくだき：入れ替えで載せた武器が外した武器の Lv を引き継ぐ（Lv が武器ごとでない）', 'ルール', 'games/asteroid/logic.js', '      s.slots[k] = { id: inn.id, lv: inn.lv };', '      s.slots[k] = { id: inn.id, lv: out.lv };'],
  ['MK53 ほしくだき：持ったことが無い武器を入れ替えで選べる', 'ルール', 'games/asteroid/logic.js', 'if (!s.bench.some((x) => x.id === id) || s.swap.some((p) => p.id === id)) return "bench";', 'if (s.swap.some((p) => p.id === id)) return "bench";'],
  ['MK54 ほしくだき：4 台のあと「あたらしい ぶき」を出さない（ひかえへ入れられない）', 'ルール', 'games/asteroid/logic.js', 'return n >= 1 && n < W_IDS.length ? SLOT_COST[n] : null;', 'return n >= 1 && n < SLOTS_MAX ? SLOT_COST[n] : null;'],
  ['MK55 ほしくだき：6 種類そろっても #unlockBtn を出す', '表示', 'games/asteroid/main.js', 'setHidden(el.unlockBtn, sc === null);', 'setHidden(el.unlockBtn, false);'],
  ['MK56 ほしくだき：ひかえの武器も強くできる（upgrade の枠の番号が砲台の数をこえたら ひかえ の Lv を上げる）', 'ルール', 'games/asteroid/logic.js', '      if (!isState(state) || !Number.isInteger(slot) || !state.slots[slot] || !W[state.slots[slot].id]) return { state, ok: false, reason: "slot" };', '      if (isState(state) && Number.isInteger(slot) && !state.slots[slot] && Array.isArray(state.bench) && state.bench[slot - state.slots.length]) { const s = shallow(state); s.bench[slot - s.slots.length].lv++; return { state: s, ok: true, events: [] }; }\n      if (!isState(state) || !Number.isInteger(slot) || !state.slots[slot] || !W[state.slots[slot].id]) return { state, ok: false, reason: "slot" };'],
  ['MK57 ほしくだき：v:1 から星・武器も引き継ぐ（v:2 と同じに読む）', '保存', 'games/asteroid/logic.js', '      if (o.v === 1) {', '      if (o.v === 1) o.v = SAVE_VERSION;\n      if (false) {'],
  ['MK58 ほしくだき：v:1 で かけらを 0 にする', 'データ消失', 'games/asteroid/logic.js', '        s.kakera = intIn(o.kakera, 0, KAKERA_MAX, 0);', '        s.kakera = 0;'],
  ['MK59 ほしくだき：v:1 のとき元の保存を asteroid.save.bak に写さない', 'データ消失', 'games/asteroid/main.js', '        migrated = true;\n        if (!keepBroken(raw)) saveBlocked = true;\n', '        migrated = true;\n'],
  ['MK60 ほしくだき：v:1 のとき asteroid.best を消す', 'データ消失', 'games/asteroid/main.js', '        migrated = true;\n', '        migrated = true; removeKey(KEY_BEST); best = 0;\n'],
  ['MK61 ほしくだき：デバッグの lose で hold にしない（撃ちきって clear になりうる。T-19）', 'テスト', 'games/asteroid/main.js', '        }, { hold: true });', '        });'],
  ['MK62 ほしくだき：表に戻ったとき保存がほかで変わっていても開き直さない（X-20）', '保存', 'games/asteroid/main.js', '    if (!stale && !changedElsewhere()) return false;', '    return false;'],
  ['MK63 ほしくだき：saveNow が stale を見ない（writeKey で止まるが「ほぞんが できないよ」が出る。X-20）', '保存', 'games/asteroid/main.js', '    if (!state || restarting || stale) return false;', '    if (!state || restarting) return false;'],
  ['MK64 ほしくだき：裏へ回る・閉じるときの保存で比べ直さない（staleOnHide。storage イベントが届く前に古い状態を書き戻す。X-20）', '保存', 'games/asteroid/main.js', '    if (!stale && changedElsewhere()) stale = true;\n    return stale;', '    return stale;'],
  ['MK65 ほしくだき：裏で別のタブが書いても保存を止めない（storage を見ない。X-20）', '保存', 'games/asteroid/main.js', 'if (document.hidden && (e.key === null || seenRaw.has(e.key))) stale = true;', 'if (false) stale = true;'],
  ['MK66 ほしくだき：2択の候補に ひかえの武器が出る', 'ルール', 'games/asteroid/logic.js', 'const have = new Set(s.slots.map((x) => x.id).concat((s.bench || []).map((x) => x.id)));', 'const have = new Set(s.slots.map((x) => x.id));'],
  ['MK67 ほしくだき：4 台のあとの2択で「えらんだ ぶきは ひかえ（いま つかわない ぶき）に はいるよ」を出さない', '表示', 'games/asteroid/main.js', 'if (state.slots.length >= SLOTS_MAX) parts.push("えらんだ ぶきは ひかえ（いま つかわない ぶき）に はいるよ");', ''],
  ['MK68 ほしくだき：残りの武器が 1 つでも #choiceB を隠さない', '表示', 'games/asteroid/main.js', '        setHidden(btn, !knownId(id));', '        setHidden(btn, false);'],
  ['MK69 ほしくだき：ひかえが空でも #swapCard を開く', '操作', 'games/asteroid/main.js', '    if (!benchOf(state).length) { setHint(HINT_NO_BENCH);', '    if (false) { setHint(HINT_NO_BENCH);'],
  ['MK70 ほしくだき：予約の札「つぎから ○○」を出さない', '表示', 'games/asteroid/main.js', '      r.next.hidden = !nx;', '      r.next.hidden = true;'],
  ['MK71 ほしくだき：入れ替えの予約を保存しない（開き直すと予約が消える）', '保存', 'games/asteroid/logic.js', '      slots, bench, offer: state.offer ? state.offer.slice() : null, swap, cleared', '      slots, bench, offer: state.offer ? state.offer.slice() : null, swap: [], cleared'],
  ['MK72 ほしくだき：クリアの演出中の保存で予約を当てない（開き直すと予約が消える）', '保存', 'games/asteroid/logic.js', '      applySwaps(tmp, []);\n', ''],
  ['MK73 ほしくだき：はね返しの間の保存で予約を当てない（開き直すとやり直しに予約が当たらない。T1）', '保存', 'games/asteroid/logic.js', '    if (toNext || ph === "bounce") {', '    if (toNext) {'],
  ['MK74 ほしくだき：2択の間の保存で戻り先（bounce・clear）を見ない（T1）', '保存', 'games/asteroid/logic.js', '    const ph = state.phase === "choose" ? state.back : state.phase;', '    const ph = state.phase;'],
  // v40（docs/plans/v40-ast.md 4 章）：いなずま・たま・どかん
  ['MK75 ほしくだき：いなずまの威力が伝わっても減らない（v40）', 'ルール', 'games/asteroid/logic.js', 'const np = p * (mats[q] === 2 ? BOLT_KEEP.iron : BOLT_KEEP.other);', 'const np = p;'],
  ['MK76 ほしくだき：たまの撃つ間隔が Lv で短くならない（v40）', '計算', 'games/asteroid/logic.js', 'return w === "shot" ? W[w].rate / (1 + SHOT_UP.rate * shotUp(L)) : W[w].rate;', 'return W[w].rate;'],
  ['MK77 ほしくだき：たまが貫通しない（v40）', 'ルール', 'games/asteroid/logic.js', 'if (b.p > 0) { b.p--; b.dmg *= SHOT_UP.keep; return false; }', ''],
  ['MK78 ほしくだき：たまが通りぬけても威力が減らない（v40）', '計算', 'games/asteroid/logic.js', 'b.p--; b.dmg *= SHOT_UP.keep;', 'b.p--;'],
  ['MK79 ほしくだき：どかんの円の中心を内側へずらさない（v40）', 'ルール', 'games/asteroid/logic.js', 'if (gl > 1e-9) { tc += gx / gl * BOMB_SHIFT * r0; tr += gy / gl * BOMB_SHIFT * r0; }', ''],
  ['MK80 ほしくだき：たまの強さが Lv 11 から伸びない（v40）', '計算', 'games/asteroid/logic.js', 'const up = w === "shot" ? 1 + SHOT_UP.dmg * shotUp(L) : 1;', 'const up = 1;'],
  ['MK81 ほしくだき：たまが こわしたマスだけ通りぬける（硬いマスで止まる。ユーザーの答え「こわさなくても進む」の逆。v40）', 'ルール', 'games/asteroid/logic.js', '          if (b.p > 0) { b.p--; b.dmg *= SHOT_UP.keep; return false; }', '          if (b.p > 0 && !R.mats[i]) { b.p--; b.dmg *= SHOT_UP.keep; return false; }'],
  ['MK82 ほしくだき：通りぬけて星の上へ出た たまを消さない（v40 レビュー）', 'ルール', 'games/asteroid/logic.js', '        if (b.h !== undefined && b.y < R.y) continue;', ''],
  ['MK83 ほしくだき：たまの しんか で「つきぬける ように なった」を出さない（v40 レビュー）', '表示', 'games/asteroid/render.js', 'if (id === "shot" && Array.isArray(pierce) && pierce.includes(num(lv, 10)))', 'if (false)'],
];
const tiers = which === 'both' ? ['smoke', 'full'] : [which];
const PICK = process.env.M ? process.env.M.split(',') : null;
const pickName = PICK ? PICK.join('_') : '';
const OUTF = path.join(HERE, PICK ? `result-${pickName.length > 80 ? `${PICK[0]}-${PICK.at(-1)}-${PICK.length}` : pickName}.json` : 'result.json');   // 長い M でもファイル名が長すぎないように
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'yubi-mutants-'));
const copyApp = (dir) => fs.cpSync(ROOT, dir, { recursive: true, filter: (src) => { const r = path.relative(ROOT, src); return !(r === '.git' || r.startsWith('.git' + path.sep) || r === 'tests' || r.startsWith('tests' + path.sep)); } });
const rows = [];
try {
  for (const [name, risk, file, from, to] of M) {
    const id = name.split(' ')[0];
    if (PICK && !PICK.includes(id)) continue;
    const dir = path.join(TMP, id);
    copyApp(dir);
    const f = path.join(dir, file), src = fs.readFileSync(f, 'utf8');
    if (typeof from === 'string' ? !src.includes(from) : !from.test(src)) { console.log(`!! ${name}: 置換対象が見つからない（${file}）`); rows.push({ name, risk, error: '置換対象なし' }); continue; }
    fs.writeFileSync(f, src.replace(from, to));
    const row = { name, risk };
    for (const t of tiers) {
      const r = spawnSync(process.execPath, [RUN, t, dir], { encoding: 'utf8', timeout: 600000, env: process.env });
      const failed = ((r.stdout.match(/不合格: (.*)/) || [])[1] || '').trim();
      row[t] = r.status === 0 ? '見逃し' : `検出（${failed || '実行エラー'}）`;
      row[t + 'Sec'] = (r.stdout.match(/所要 ([\d.]+) 秒/) || [])[1];
    }
    rows.push(row);
    console.log(`${name.padEnd(40)} ${tiers.map((t) => `${t}: ${row[t]}`).join('  ')}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
fs.writeFileSync(OUTF, JSON.stringify(rows, null, 1));
const caught = (t) => rows.filter((r) => r[t] && r[t] !== '見逃し').length;
console.log(`\n検出：${tiers.map((t) => `${t} ${caught(t)}/${rows.length}`).join('、')}`);
