// 変異テスト：アプリ（リポジトリのルート）を一時フォルダへコピーし、わざと不具合を1つずつ入れて、
// テストがそれを検出できるか（＝不合格になるか）を確かめる。アプリのファイル自体は変更しない。
//   node tests/mutants/mutate.mjs [smoke|full|both]     （既定 both）
//   M=M7,M10 で変異を絞る。結果は表と tests/mutants/result.json（.gitignore 対象外の一時結果。コミットしない）
// 置換前の文字列が見つからないときは「!! 置換対象なし」と表示する（アプリが変わったら、ここの文字列を直す）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const RUN = path.resolve(HERE, '../run.mjs');
const which = process.argv[2] || 'both';
// [名前, リスク, ファイル, 置換前, 置換後]
const OVER_BTNS = `<div class="row"><button class="cta primary" type="button" data-cmd="restart">もう一度</button></div>
        <div class="row">
          <button class="cta" type="button" data-cmd="undo">1手戻す</button>
          <button class="cta" type="button" data-cmd="menu">メニューへ</button>
        </div>`;
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
  // ---- 版の表示（メニュー）。版を上げる手順が崩れたときの検出 ----
  ['MV1 版の数字だけ上げ忘れる（version.js が古いまま。sw.js は v16）', '更新', 'common/version.js', 'version: "v16"', 'version: "v15"'],
  ['MV2 version.js を事前キャッシュから外す（オフラインで版が出ない）', 'オフライン', 'sw.js', '  "./common/version.js",\n', ''],
  ['MV3 更新日が YYYY-MM-DD でない', '表示', 'common/version.js', 'date: "2026-10-18"', 'date: "2026/10/18"'],
  // ---- 日付・時刻（いろコード）。日付の処理を足したら、ここにも変異を足す（tests/README.md「日付・時計」）----
  ['MD1 いろコード：todayStr を UTC の日付にする（toISOString 由来。日本の0〜9時台に前日になる）', '日付', 'games/irocode/logic.js', 'return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());', 'return d.toISOString().slice(0, 10);'],
  ['MD2 いろコード：todayStr の月が 1 ずれる（getMonth() + 1 を外す）', '日付', 'games/irocode/logic.js', 'pad2(d.getMonth() + 1)', 'pad2(d.getMonth())'],
  ['MD3 いろコード：隠して戻ったとき日付が変わっていても今日の問題に差し替えない（自動差し替えを無効にする）', '日付', 'games/irocode/index.html', 'if (document.hidden) { saveState(); return; }\n    refreshDay();', 'if (document.hidden) { saveState(); return; }'],
  ['MD4 いろコード：確認・遊び方カードを閉じたときに日付を見直さない', '日付', 'games/irocode/index.html', 'else if (cmd === "close") { hideOverlay(); renderInput(); refreshDay(); }', 'else if (cmd === "close") { hideOverlay(); renderInput(); }'],
  ['MD5 いろコード：未来の日付の daily 記録を受け付ける', '日付/保存データ互換', 'games/irocode/logic.js', 'if (isDateStr(today) && x.date > today) return null;', ''],
  ['MD6 いろコード：0時をまたいで確定した結果を、始めた日でなく確定時の日付で記録する', '日付', 'games/irocode/index.html', 'daily = { date: state.date, done: true, win, tries };', 'daily = { date: today(), done: true, win, tries };'],
  ['MD7 いろコード：結果カードが0時をまたいでも「次は明日」のまま', '日付', 'games/irocode/index.html', 'const sameDay = state.date === today();', 'const sameDay = true;'],
  ['MD8 いろコード：起動時に日付が違う途中の問題を捨てるとき、負けとして記録しない（れんしゅう切り替えと食い違う）', '日付/成績', 'games/irocode/index.html', '{ abandonDaily(state); state = null; }', '{ state = null; }'],
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
    if (!src.includes(from)) { console.log(`!! ${name}: 置換対象が見つからない（${file}）`); rows.push({ name, risk, error: '置換対象なし' }); continue; }
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
