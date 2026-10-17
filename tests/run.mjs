// 「ゆびあそび」統合テスト
//   node tests/run.mjs smoke [配信ディレクトリ]   … 毎回の小さな修正で（目標 15 秒以内）
//   node tests/run.mjs full  [配信ディレクトリ]   … 公開前に（目標 60 秒以内）
// 配信ディレクトリ：引数 > 環境変数 GAME_ROOT > 既定（tests/ の1つ上＝リポジトリのルート）
// 環境変数：
//   BROWSER=chromium|webkit（既定 chromium）  WORKERS=4（グループ単位の並列数）  PORT=8800（並列 i 番目は PORT+i を使う）
//   ONLY=D2,S1（項目を絞る）  JSON=path（結果を JSON で書き出す）  VERBOSE=1（合格した確認も表示）
//   CLOCK=0（待ち時間の早送りを止める）  TEST_TIMEOUT=60000（1項目の上限 ms）
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);

// グループ（表示順＝実行の優先順：ブラウザ不要の L → リスクの高い順 → 遊び方・音・タッチ）
// weight は並列実行の割り振り用の目安（秒）。長いものから先に始める
export const GROUPS = [
  { key: 'L', title: 'L 計算ロジック・静的検査(Node)', file: 'logic.mjs', weight: { smoke: 0, full: 0 } },
  { key: 'ZL', title: 'ZL ゼンマイさんぽ 計算ロジック(Node)', file: 'zenmai-logic.mjs', weight: { smoke: 0, full: 0 } },
  { key: 'D', title: 'D データ保護・互換', file: 'data.mjs', weight: { smoke: 8, full: 24 } },
  { key: 'E', title: 'E 閉じ込めなし', file: 'escape.mjs', weight: { smoke: 5, full: 17 } },
  { key: 'S', title: 'S オフライン・更新', file: 'sw.mjs', weight: { smoke: 5, full: 29 } },
  { key: 'V', title: 'V 画面外・押せる・桁数', file: 'layout.mjs', weight: { smoke: 4, full: 27 } },
  { key: 'P', title: 'P 遊べること', file: 'play.mjs', weight: { smoke: 4, full: 21 } },
  { key: 'A', title: 'A 効果音', file: 'sound.mjs', weight: { smoke: 4, full: 16 } },
  { key: 'T', title: 'T タッチ操作（ダブルタップ拡大の抑止・音の準備）', file: 'touch.mjs', weight: { smoke: 5, full: 28 } },
  { key: 'Z', title: 'Z ゼンマイさんぽ 画面（データ・戻る・ボタン・オフライン・クリア・円ドラッグ・音）', file: 'zenmai-ui.mjs', weight: { smoke: 10, full: 45 } },
];

const args = process.argv.slice(2);
const isWorker = args[0] === '--worker';
if (isWorker) args.shift();
const tier = args[0] || 'smoke';
if (!['smoke', 'full'].includes(tier)) { console.error('使い方: node tests/run.mjs smoke|full [配信ディレクトリ]'); process.exit(2); }
const root = path.resolve(args[1] || process.env.GAME_ROOT || path.join(HERE, '..'));
if (!fs.existsSync(path.join(root, 'index.html'))) { console.error('配信ディレクトリに index.html がない: ' + root); process.exit(2); }
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const BROWSER = process.env.BROWSER || 'chromium';
const pick = (t) => (tier === 'full' || t.tier === 'smoke') && (!ONLY || ONLY.includes(t.id));

if (isWorker) await worker(args[2]); else await main();

// ---------------- 1グループを実行する子プロセス ----------------
async function worker(key) {
  const g = GROUPS.find((x) => x.key === key);
  const lib = await import('./lib.mjs');
  const { tests } = await import('./cases/' + g.file);
  const plan = tests.filter(pick);
  const TEST_TIMEOUT = Number(process.env.TEST_TIMEOUT || 60000);
  const rec = new lib.Recorder();
  let srv = null, browser = null;
  const out = { key, items: [], errors: lib.pageErrors, skipped: [], fatal: null };
  try {
    const needBrowser = plan.some((t) => !t.node);
    if (needBrowser) { srv = await lib.startServer(root); browser = await lib.launchBrowser(); }
    for (const t of plan) {
      // CDP（Chromium 専用の機能）を使う確認は、ほかのブラウザでは対象外にする
      if (t.cdp && !lib.IS_CHROMIUM) { out.skipped.push({ id: t.id, title: t.title, why: t.cdp }); continue; }
      rec.start(t.id, t.title);
      const ctx = { browser, srv, root, tier, errors: lib.pageErrors, check: (n, ok, d, known) => rec.check(n, ok, d, known) };
      let timer;
      try { await Promise.race([t.run(ctx), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${TEST_TIMEOUT / 1000} 秒以内に終わらない`)), TEST_TIMEOUT); })]); } catch (e) { rec.fail(e); } finally { clearTimeout(timer); }
      srv?.reset();
      rec.end();
    }
  } catch (e) {
    out.fatal = String(e && e.stack || e);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (srv) await srv.close();
  }
  out.items = rec.items;
  fs.writeFileSync(process.env.RESULT_FILE, JSON.stringify(out));
  process.exit(0);
}

// ---------------- 親：グループを並列に割り振り、結果をまとめて表示 ----------------
async function main() {
  const T0 = Date.now();
  const PORT = Number(process.env.PORT || 8800);
  const WORKERS = Math.max(1, Number(process.env.WORKERS || 4));
  const mods = {};
  for (const g of GROUPS) mods[g.key] = (await import('./cases/' + g.file)).tests;
  const plan = GROUPS.filter((g) => mods[g.key].some(pick));
  const target = tier === 'smoke' ? 15 : 60;
  console.log(`ゆびあそび 統合テスト [${tier}]  ブラウザ: ${BROWSER}  並列: ${WORKERS}  早送り: ${process.env.CLOCK === '0' ? 'なし' : 'あり'}`);
  console.log(`配信: ${root}  → http://127.0.0.1:${PORT}〜${PORT + WORKERS - 1}/game-no1/\n`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yubi-tests-'));
  const results = {};
  const queue = [...plan].sort((a, b) => b.weight[tier] - a.weight[tier]);
  const runOne = (g, slot) => new Promise((resolve) => {
    const file = path.join(tmp, g.key + '.json');
    const t0 = Date.now();
    const child = spawn(process.execPath, [SELF, '--worker', tier, root, g.key], { env: { ...process.env, PORT: String(PORT + slot), RESULT_FILE: file }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    child.on('close', (code) => {
      let r;
      try { r = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { r = { key: g.key, items: [], errors: [], skipped: [], fatal: `子プロセスが結果を書かずに終了（code ${code}）\n${log.slice(-2000)}` }; }
      r.sec = (Date.now() - t0) / 1000; r.log = log;
      results[g.key] = r;
      const ng = r.items.filter((i) => !i.ok).length + (r.fatal ? 1 : 0);
      console.log(`  … ${g.title.split(' ')[0]} 完了 ${r.sec.toFixed(1)}s（${r.items.length} 項目${ng ? `、不合格 ${ng}` : ''}）`);
      resolve();
    });
  });
  await Promise.all(Array.from({ length: Math.min(WORKERS, queue.length) }, async (_, slot) => {
    while (queue.length) await runOne(queue.shift(), slot);
  }));
  fs.rmSync(tmp, { recursive: true, force: true });

  // ---- 表示（グループの順に） ----
  const items = [], errors = [], skipped = [];
  console.log('');
  for (const g of plan) {
    const r = results[g.key];
    console.log(`■ ${g.title}  (${r.sec.toFixed(1)}s)`);
    if (r.fatal) { console.log('  実行エラー: ' + r.fatal); items.push({ id: g.key + '!', title: '実行エラー', ok: false, ms: 0, checks: [{ name: r.fatal.slice(0, 300), ok: false }] }); }
    if (r.log.trim() && (process.env.VERBOSE || r.fatal)) console.log(r.log.trim().split('\n').map((l) => '    | ' + l).join('\n'));
    for (const it of r.items) {
      items.push(it);
      console.log(`  ${it.ok ? 'PASS' : 'FAIL'}  ${it.id.padEnd(3)} ${(it.ms / 1000).toFixed(1).padStart(5)}s  ${it.title}  (${it.checks.filter((c) => c.ok).length}/${it.checks.length})`);
      for (const c of it.checks) {
        if (c.known && !c.ok) console.log(`        △ 既知の不具合（修正待ち・合否に含めない）: ${c.name}\n          ${c.known}`);
        else if (c.known && c.ok) console.log(`        ★ 既知の不具合が解消した: ${c.name} → tests/lib.mjs の KNOWN_ISSUES から外す`);
        else if (!c.ok || process.env.VERBOSE) console.log(`        ${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : '\n          ' + String(JSON.stringify(c.detail)).slice(0, 1500)}`);
      }
    }
    for (const s of r.skipped) { skipped.push(s); console.log(`  対象外 ${s.id.padEnd(3)}        ${s.title}（${BROWSER} では不可：${s.why}）`); }
    errors.push(...r.errors);
  }
  // 全ページ共通の確認は最後に1回だけ（各グループで集めたコンソールエラーをまとめる）
  if (plan.some((g) => !['L', 'ZL'].includes(g.key))) {
    const ok = errors.length === 0;
    items.push({ id: 'X1', title: '全ページでコンソールエラー・ページエラー 0', ok, ms: 0, checks: [{ name: `コンソールエラー・ページエラー ${errors.length} 件`, ok, detail: ok ? undefined : errors.slice(0, 20) }] });
    console.log(`■ 共通\n  ${ok ? 'PASS' : 'FAIL'}  X1  全ページでコンソールエラー・ページエラー 0${ok ? '' : '\n        ' + JSON.stringify(errors.slice(0, 10))}`);
  }
  const checks = items.flatMap((i) => i.checks);
  const failed = items.filter((i) => !i.ok);
  const knownFail = checks.filter((c) => c.known && !c.ok);
  const total = (Date.now() - T0) / 1000;
  console.log(`\n結果 [${tier} / ${BROWSER}]：テスト ${items.length - failed.length}/${items.length} 合格、確認項目 ${checks.filter((c) => c.ok).length}/${checks.length - knownFail.length} 合格${knownFail.length ? `（ほかに既知の不具合 ${knownFail.length} 件）` : ''}${skipped.length ? `、対象外 ${skipped.length} 項目` : ''}、所要 ${total.toFixed(1)} 秒（目標 ${target} 秒以内${total <= target ? '：達成' : '：超過'}）`);
  if (knownFail.length) console.log('既知の不具合: ' + [...new Set(knownFail.map((c) => c.known.split(' ')[0]))].join(', ') + '（tests/lib.mjs の KNOWN_ISSUES）');
  if (failed.length) console.log('不合格: ' + failed.map((i) => i.id).join(', '));
  if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify({ tier, browser: BROWSER, root, totalSec: total, items, skipped }, null, 1));
  process.exit(failed.length ? 1 : 0);
}
