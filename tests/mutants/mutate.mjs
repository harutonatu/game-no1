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
  ['MZ1 ゼンマイの render.js を事前キャッシュから外す', 'オフライン', 'sw.js', '  "./games/zenmai/render.js",\n', ''],
  ['MZ2 ゼンマイの保存データで範囲外の★（9など）を受け入れる', '保存データ互換', 'games/zenmai/logic.js', 'if (!(Number.isInteger(s) && s >= 0 && s <= 3)) continue;', ''],
  ['MZ3 ゼンマイの結果カードから「メニューへ」が消える', '閉じ込め', 'games/zenmai/index.html', '<button class="cta" type="button" data-cmd="menu">メニューへ</button>', ''],
  ['MZ4 ゼンマイのネジで指を持ち替えても数え直さない（位置が飛んで余分に巻く）', 'タッチ操作', 'games/zenmai/input.js', 'core.reanchor();\n        feed(pos.x, pos.y);', 'feed(pos.x, pos.y);'],
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
  // ---- ハシわたり（games/hashi/）。判定・点数・いのち・保存・中断・タイマーの仕組みを変えたときだけ流す ----
  ['MH1 ハシわたり：判定の端を開区間にする（茎の先が葉の端ちょうどで落ちる）', 'ルール', 'games/hashi/logic.js', 'if (tipX >= left && tipX <= right) {', 'if (tipX > left && tipX < right) {'],
  ['MH2 ハシわたり：recordBest で同点もベスト更新にする', '保存データ', 'games/hashi/logic.js', 'const improved = s > prev;', 'const improved = s >= prev;'],
  ['MH3 ハシわたり：ぴったりボーナスの上限 16 を外す', '計算', 'games/hashi/logic.js', 'return Math.min(Math.pow(2, Math.floor(s) - 1), BONUS_CAP);', 'return Math.pow(2, Math.floor(s) - 1);'],
  ['MH4 ハシわたり：落ちてもいのちを減らさない（終わらない）', '遊べること', 'games/hashi/logic.js', 'const lives = Math.max(state.lives - 1, 0);', 'const lives = state.lives;'],
  ['MH5 ハシわたり：隠れたとき（visibilitychange で hidden）押下を取り消さない', '中断', 'games/hashi/main.js', 'if (phase === "growing") abortHold();', ''],
  ['MH6 ハシわたり：「もう一度」で clearLater() を呼ばない（古い回のタイマーが残る）', 'タイマー', 'games/hashi/main.js', 'clearLater();   // 前の回のタイマーを片付ける（もう一度・起動）', ''],
  // ---- 版の表示（メニュー）。版を上げる手順が崩れたときの検出 ----
  // MV1・MV3 は正規表現で今の版・日付を読み、1つずらす（版を上げるたびに直さなくてよい）
  ['MV1 版の数字だけ上げ忘れる（version.js が1つ前の版のまま。sw.js は今の版）', '更新', 'common/version.js', /version: "v(\d+)"/, (_, n) => `version: "v${Number(n) - 1}"`],
  ['MV2 version.js を事前キャッシュから外す（オフラインで版が出ない）', 'オフライン', 'sw.js', '  "./common/version.js",\n', ''],
  ['MV3 更新日が YYYY-MM-DD でない（今の日付の - を / にする）', '表示', 'common/version.js', /date: "(\d{4})-(\d{2})-(\d{2})"/, (_, y, m, d) => `date: "${y}/${m}/${d}"`],
  // ---- 日付・時刻（いろコード）。日付の処理を足したら、ここにも変異を足す（tests/README.md「日付・時計」）----
  ['MD1 いろコード：todayStr を UTC の日付にする（toISOString 由来。日本の0〜9時台に前日になる）', '日付', 'games/irocode/logic.js', 'return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());', 'return d.toISOString().slice(0, 10);'],
  ['MD2 いろコード：todayStr の月が 1 ずれる（getMonth() + 1 を外す）', '日付', 'games/irocode/logic.js', 'pad2(d.getMonth() + 1)', 'pad2(d.getMonth())'],
  ['MD3 いろコード：隠して戻ったとき日付が変わっていても今日の問題に差し替えない（自動差し替えを無効にする）', '日付', 'games/irocode/index.html', 'if (document.hidden) { saveState(); return; }\n    refreshDay();', 'if (document.hidden) { saveState(); return; }'],
  ['MD4 いろコード：確認・遊び方カードを閉じたときに日付を見直さない', '日付', 'games/irocode/index.html', 'else if (cmd === "close") { hideOverlay(); renderInput(); refreshDay(); }', 'else if (cmd === "close") { hideOverlay(); renderInput(); }'],
  ['MD5 いろコード：未来の日付の daily 記録を受け付ける', '日付/保存データ互換', 'games/irocode/logic.js', 'if (isDateStr(today) && x.date > today) return null;', ''],
  ['MD6 いろコード：0時をまたいで確定した結果を、始めた日でなく確定時の日付で記録する', '日付', 'games/irocode/index.html', 'daily = { date: state.date, done: true, win, tries };', 'daily = { date: today(), done: true, win, tries };'],
  ['MD7 いろコード：結果カードが0時をまたいでも「次は明日」のまま', '日付', 'games/irocode/index.html', 'const sameDay = state.date === today();', 'const sameDay = true;'],
  ['MD8 いろコード：起動時に日付が違う途中の問題を捨てるとき、負けとして記録しない（れんしゅう切り替えと食い違う）', '日付/成績', 'games/irocode/index.html', '{ abandonDaily(state); state = null; }', '{ state = null; }'],
  // ---- いろびん（games/irobin/）。注ぐ規則・そろい判定・届ける・隠れ・ソルバー・保存・中断の仕組みを変えたときだけ流す ----
  //      届けた瓶は消える（2026-10-19 のルール変更）。MB4＝消えない、MB13＝旧仕様（空き瓶に置き換わる）、MB14＝瓶の番号のずれ
  ['MB1 いろびん：色違いの瓶にも注げる（mismatch の判定を外す）', 'ルール', 'games/irobin/logic.js', 'if (dl > 0 && col(d, dl - 1) !== c) return R_MISMATCH;', ''],
  ['MB2 いろびん：注ぐ量が相手の空きを超える（空きで丸めない）', 'ルール', 'games/irobin/logic.js', 'return Math.min(run, CAP - dl);', 'return run;'],
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
  ['MB15 いろびん：布が1人早く取れる（served >= cover − 1 で取る）', 'ルール', 'games/irobin/logic.js', 'if (k === 0 || ctx.served < k) continue;', 'if (k === 0 || ctx.served < k - 1) continue;'],
  ['MB16 いろびん：布の瓶に注げる（布を見るのは注ぐ元だけ）', 'ルール', 'games/irobin/logic.js', 'if ((s | d) & COVER_MASK) return R_COVERED;', 'if (s & COVER_MASK) return R_COVERED;'],
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
  ['MB22 いろびん：pageshow でクリアのカードの押せない見た目を外さない（ミチビキ空港 §19 A3 の横展開）', '誤タップ', 'games/irobin/main.js', 'window.addEventListener("pageshow", () => {\n    if (overlayKind !== "clear") return;', 'window.addEventListener("pageshow-x", () => {\n    if (overlayKind !== "clear") return;'],
  ['MQ41 まとめてポン：pageshow で終わりのカードの押せない見た目を外さない（ミチビキ空港 §19 A3 の横展開）', '誤タップ', 'games/matomete/main.js', 'window.addEventListener("pageshow", () => {\n    if (overlayKind !== "over") return;', 'window.addEventListener("pageshow-x", () => {\n    if (overlayKind !== "over") return;'],
  // もくもくこうば（契約 docs/seizai-contract.md §11.4。流すときは ONLY に WL・WW の全項目、M=MW1,…,MW39）
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
  ['MW21 もくもくこうば：bak が既にあっても上書き（最初の壊れた保存が消える）', '保存', 'games/seizai/main.js', '    if (readKey(KEY_BAK) !== null) return true;\n', ''],
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
  ['MW33 もくもくこうば：hidden で止まらない（visibilitychange の hidden で sleep を呼ばない）', '中断', 'games/seizai/main.js', 'document.addEventListener("visibilitychange", () => { if (document.hidden) sleep(); else wake(); });', 'document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); });'],
  ['MW34 もくもくこうば：pagehide でタイマーを片付けない', '中断', 'games/seizai/main.js', 'window.addEventListener("pagehide", () => { sleep(); clearLater(); });', 'window.addEventListener("pagehide", () => { sleep(); });'],
  ['MW35 もくもくこうば：10 秒ごとの自動保存をしない', '保存', 'games/seizai/main.js', '    if (saveSince >= SAVE_EVERY_SEC) saveNow();\n', ''],
  ['MW36 もくもくこうば：シートの値段が costOf と 1 割ずれる（表示の1ずれ）', '表示', 'games/seizai/main.js', 'else setBtn(b, labels[w], yen(t.cost), !t.ok, t.ok ? "" : HINT_MONEY);', 'else setBtn(b, labels[w], yen(Math.round(t.cost * 1.1)), !t.ok, t.ok ? "" : HINT_MONEY);'],
  ['MW37 もくもくこうば：#money が 1 えんずれる（表示の1ずれ）', '表示', 'games/seizai/main.js', 'const m = yen(state.money);', 'const m = yen(state.money - 1);'],
  ['MW38 もくもくこうば：広げても seizai.best を書かない', '保存', 'games/seizai/main.js', '    writeBest(state.stage);\n    saveNow();\n    closeSheet();', '    saveNow();\n    closeSheet();'],
  ['MW39 もくもくこうば：お金が足りないとき音 deny もヒントも出さない', '表示', 'games/seizai/main.js', '    sfx.play("deny");\n    setHint(reasonText(reason, what, d) || HINT_MONEY);\n', ''],
];
const tiers = which === 'both' ? ['smoke', 'full'] : [which];
const PICK = process.env.M ? process.env.M.split(',') : null;
const OUTF = path.join(HERE, PICK ? `result-${PICK.join('_')}.json` : 'result.json');
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
