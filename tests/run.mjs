// 「ゆびあそび」統合テスト
//   node tests/run.mjs smoke [配信ディレクトリ]   … 毎回の小さな修正で（目標 15 秒以内）
//   node tests/run.mjs full  [配信ディレクトリ]   … 公開前に（目標 60 秒以内）
// 配信ディレクトリ：引数 > 環境変数 GAME_ROOT > 既定（tests/ の1つ上＝リポジトリのルート）
// 環境変数：
//   BROWSER=chromium|webkit（既定 chromium）  WORKERS=3（グループ単位の並列数。クラウドの 4 コアで公開の条件を確かめる数。v38）  PORT=8800（並列 i 番目は PORT+i を使う）
//   ONLY=D2,S1（項目を絞る）  JSON=path（結果を JSON で書き出す）  VERBOSE=1（合格した確認も表示）
//   CLOCK=0（待ち時間の早送りを止める）  TEST_TIMEOUT=60000（1項目の上限 ms）
//   HEADED=1（画面を出してブラウザを起動。Linux で画面が無いときは xvfb-run -a を前につける）
//   FLAKY_RETRY=2（揺れやすい項目の流し直しの回数。0 で流し直さない。mutate.mjs は 0 を渡す）
//   FORCE_FAIL=AL11:1:time,L1:1（仕組みの確かめ用：その項目を最初の N 回だけわざと不合格にする。1 回目＝ふつうの段、2・3 回目＝揺れやすい項目の流し直し。
//     :time を付けると、その項目の時間の確かめ（flaky.checks に当てはまる確かめ。checks が無ければ時間切れ）を落とす。付けないと、別の確かめ（機能の確かめの代わり）を落とす）
// 揺れやすい項目（項目の定義に flaky: { why: '理由', checks: /時間の確かめの名前/ }）：ふつうの不合格になり、落ちた確かめが全部 checks に当てはまるとき、
//   または時間切れのときだけ、全部終わったあとにその項目だけを 1 つずつ（並列なし）最大 FLAKY_RETRY 回流し直し、
//   1 回でも合格なら「揺れ（流し直しで合格）」として合格に数え、結果の最後に一覧で出す。印の無い項目・機能の確かめが落ちた項目は流し直さない（本当の不具合を隠さない）
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
  { key: 'D', title: 'D データ保護・互換', file: 'data.mjs', weight: { smoke: 9, full: 37 } },
  { key: 'E', title: 'E 閉じ込めなし', file: 'escape.mjs', weight: { smoke: 7, full: 30 } },
  { key: 'S', title: 'S オフライン・更新', file: 'sw.mjs', weight: { smoke: 6, full: 56 } },
  { key: 'V', title: 'V 画面外・押せる・桁数', file: 'layout.mjs', weight: { smoke: 6, full: 43 } },
  { key: 'P', title: 'P 遊べること', file: 'play.mjs', weight: { smoke: 6, full: 34 } },
  { key: 'A', title: 'A 効果音', file: 'sound.mjs', weight: { smoke: 5, full: 23 } },
  { key: 'T', title: 'T タッチ操作（ダブルタップ拡大の抑止・音の準備）', file: 'touch.mjs', weight: { smoke: 6, full: 28 } },
  { key: 'I', title: 'I いろコード（ロジック・保存・戻れる・画面内・オフライン・色覚・効果音・日付）', file: 'irocode.mjs', weight: { smoke: 7, full: 30 } },
  { key: 'Z', title: 'Z ゼンマイさんぽ 画面（データ・戻る・ボタン・オフライン・クリア・円ドラッグ・音）', file: 'zenmai-ui.mjs', weight: { smoke: 10, full: 45 } },
  { key: 'PK', title: 'PK ピカッと早押し（ロジック・画面・保存・オフライン・音・タッチ）', file: 'pikatto.mjs', weight: { smoke: 8, full: 35 } },
  { key: 'HL', title: 'HL ハシわたり 計算ロジック(Node)', file: 'hashi-logic.mjs', weight: { smoke: 0, full: 0 } },
  { key: 'HW', title: 'HW ハシわたり 画面（データ・戻る・画面内・横向き・中断・キーボード・音・オフライン）', file: 'hashi-ui.mjs', weight: { smoke: 8, full: 40 } },
  { key: 'BL', title: 'BL いろびん 計算ロジック(Node)', file: 'irobin-logic.mjs', weight: { smoke: 0, full: 0 } },
  { key: 'DG', title: 'DG デバッグ表示（?debug=1：無効なら何もしない・エラーの件数・命令・ボタンをふさがない・オフライン）', file: 'debug.mjs', weight: { smoke: 5, full: 25 } },
  { key: 'RL', title: 'RL iPhone の遠隔テスト（中継：relay.mjs・ask.mjs・debug-relay.js。合言葉・つなぎ直し・open・読み込まない・配信の安全・1 台だけ）', file: 'relay.mjs', weight: { smoke: 4, full: 40 } },
  { key: 'BW', title: 'BW いろびん 画面（遊べる・保存・戻る・画面内・横向き・中断・キーボード・音・色覚・オフライン）', file: 'irobin-ui.mjs', weight: { smoke: 8, full: 40 } },
  { key: 'QL', title: 'QL まとめてポン 計算ロジック(Node)', file: 'matomete-logic.mjs', weight: { smoke: 0, full: 0 } },
  { key: 'QW', title: 'QW まとめてポン 画面（2回タップ・保存・戻る・全部消し・終わり・お助け・見た目・画面内・キーボード・音・オフライン・タッチ・メニュー）', file: 'matomete-ui.mjs', weight: { smoke: 8, full: 45 } },
  { key: 'FL', title: 'FL ミチビキ空港 計算ロジック(Node)', file: 'michibiki-logic.mjs', weight: { smoke: 0, full: 0 } },
  { key: 'FW', title: 'FW ミチビキ空港 画面（なぞる・着陸・ぶつかる・保存・戻る・中断・画面内・横向き・キーボード・音・色覚・オフライン）', file: 'michibiki-ui.mjs', weight: { smoke: 8, full: 45 } },
  { key: 'WL', title: 'WL もくもくこうば 計算ロジック(Node)', file: 'seizai-logic.mjs', weight: { smoke: 0, full: 0 } },
  { key: 'WW', title: 'WW もくもくこうば 画面（育てる・買う・節目・注文・るすの あいだ・時計・保存・戻る・画面内・横向き・性能・キーボード・音・オフライン・メニュー）', file: 'seizai-ui.mjs', weight: { smoke: 8, full: 45 } },
  { key: 'KL', title: 'KL ほしくだき 計算ロジック(Node)', file: 'asteroid-logic.mjs', weight: { smoke: 0, full: 0 } },
  { key: 'KW', title: 'KW ほしくだき 画面（壊れる・強くする・2択・はね返し・クリア・保存・戻る・中断・画面内・横向き・性能・キーボード・音・オフライン・メニュー）', file: 'asteroid-ui.mjs', weight: { smoke: 8, full: 84 } },
  { key: 'AL', title: 'AL あまいものあつめ 計算ロジック(Node)', file: 'amai-logic.mjs', weight: { smoke: 0, full: 0 } },
  { key: 'AW', title: 'AW あまいものあつめ 画面（押す・運ぶ・もどす・うごかせない・保存・戻る・画面内・横向き・中断・はやく・ずかん・キーボード・音・色覚・オフライン・メニュー）', file: 'amai-ui.mjs', weight: { smoke: 8, full: 45 } },
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
// HEADED=1 なのに画面が無い（Linux で DISPLAY が無い）ときは、ここで分かりやすく止める（tests/lib.mjs でも同じ確認をする）
if (process.env.HEADED === '1' && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.error('HEADED=1 ですが画面（DISPLAY）がありません。コマンドの前に xvfb-run -a をつけてください。\n  例：HEADED=1 BROWSER=webkit WORKERS=1 xvfb-run -a node tests/run.mjs smoke');
  process.exit(2);
}
const pick = (t) => (tier === 'full' || t.tier === 'smoke') && (!ONLY || ONLY.includes(t.id));
// 速さを測る項目（solo: true）は、並列のときはほかの項目が終わってから 1 つずつ流す（ほかの子プロセスが CPU を使っている間に測らない。T-02・T-09）。
// PHASE：all＝全部（WORKERS=1）／par＝solo 以外（並列の段）／solo＝solo だけ（あとの段）。基準の ms は変えない
const PHASE = process.env.PHASE || 'all';
const inPhase = (t) => PHASE === 'all' || (PHASE === 'solo') === !!t.solo;
// ページ・ブラウザが落ちたときの Playwright の例外の文（これだけを流し直す。MT-14・T-09）
const CRASHED = /Target crashed|Page crashed|Browser has been closed|browser has disconnected/i;
// ページが止まった（応答しない）ときの例外：1 項目の時間切れ・Playwright の操作の時間切れで呼び出しの記録が「要素を見つけた」で終わっているもの
// （押せるかの確かめに入る前に止まった＝ページが応答しない。押せない・隠れている不具合なら attempting / retrying の行が続く）・CDP のタッチが返らない。
// これも 1 回だけ流し直す（T-27・WW12・WW25・QW3。v39 1 章）
const STALLED = (m) => /秒以内に終わらない$/.test(m.trim()) || /CDP のタッチが \d+ 秒返らない/.test(m)
  || (/Timeout \d+ms exceeded/.test(m) && /locator resolved to [^\n]*$/.test(m.trim()) && !/attempting|retrying/.test(m)
    && !/resolved to (hidden|visible)\s*$/.test(m.trim()) && !/\d+ ×[^\n]*$/.test(m.trim()))   // 「hidden / visible」「N ×（くり返し）」で終わるのは、ふつうの不合格（流し直さない）
  // 押せた（click action done）のに、そのあとのページの移動が終わらない（呼び出しの記録が waiting for scheduled navigations to finish で終わる）＝ブラウザが止まった。
  // v40 の関門の I8（a#back。オフラインでメニューへ戻る）がこれで 30 秒の時間切れになり、上の形に当たらず流し直されなかった
  || (/Timeout \d+ms exceeded/.test(m) && /action done[^\n]*\n[^\n]*waiting for scheduled navigations to finish[^\n]*$/.test(m.trim()));
// 流し直しの回数の上限：落ちた（CRASHED）・止まった（STALLED）どちらも 1 回だけ（v39 と同じ。ユーザー決定 2026-10-25「1回のまま」）。
// WebKit（Linux・画面なし）の落ちる原因は MT-14（canvas から canvas への drawImage）。公開の条件の WebKit は画面あり（HEADED=1）で流す
const MAX_RETRY = 1;
// 揺れやすい項目（flaky: '理由'）の流し直しの回数の上限（ユーザー「テストの揺れを片付ける (Recommended)」。計画書 docs/plans/test-flaky.md §1.1）
// 環境変数 FLAKY_RETRY で変えられる（0 で流し直さない。変異テスト mutate.mjs は 0 を渡す：変異を流し直しで見のがさない。技術レビュー H-3）
const FLAKY_RETRY = /^\d+$/.test(process.env.FLAKY_RETRY || '') ? Number(process.env.FLAKY_RETRY) : 2;
// 仕組みの確かめ用：FORCE_FAIL=ID:N（:time）で、その項目を最初の N 回だけわざと不合格にする（FLAKY_TRY は親が渡す何回目か。0＝ふつうの段）
const FORCE_FAIL = Object.fromEntries((process.env.FORCE_FAIL || '').split(',').filter(Boolean).map((x) => { const [id, n, kind] = x.split(':'); return [id, { n: Number(n || 1), time: kind === 'time' }]; }));
const FLAKY_TRY = Number(process.env.FLAKY_TRY || 0);
// 揺れやすい印の形：flaky: { why: '理由', checks: /時間の確かめの名前/ }（checks が無ければ、時間切れのときだけ流し直す。技術レビュー H-2）
const flakyOf = (t) => (t && t.flaky ? (typeof t.flaky === 'string' ? { why: t.flaky, checks: null } : t.flaky) : null);
// 時間切れ（1 項目の上限・Playwright の操作の時間切れ・CDP のタッチが返らない）で落ちた確かめ
const TIMED_OUT = /秒以内に終わらない|Timeout \d+ms exceeded|CDP のタッチが \d+ 秒返らない/;
const isTimeout = (c) => c.name === '例外' && TIMED_OUT.test(String(c.detail));
// 1 回目に落ちた確かめが、全部 時間の確かめ（checks に当てはまる）か時間切れなら流し直す。ほかの確かめ（機能）が 1 つでも落ちていたら流し直さない
function flakyRetryable(def, it) {
  const bad = it.checks.filter((c) => !c.ok && !c.known);
  if (!bad.length) return false;
  return bad.every((c) => isTimeout(c) || (def.checks instanceof RegExp && c.name !== '例外' && def.checks.test(c.name)));
}

if (isWorker) await worker(args[2]); else await main();

// ---------------- 1グループを実行する子プロセス ----------------
async function worker(key) {
  const g = GROUPS.find((x) => x.key === key);
  const lib = await import('./lib.mjs');
  const { tests } = await import('./cases/' + g.file);
  const plan = tests.filter(pick).filter(inPhase);
  const TEST_TIMEOUT = Number(process.env.TEST_TIMEOUT || 60000);
  const rec = new lib.Recorder();
  let srv = null, browser = null;
  const out = { key, items: [], errors: lib.pageErrors, skipped: [], fatal: null };
  try {
    const needBrowser = plan.some((t) => !t.node);
    if (needBrowser) { srv = await lib.startServer(root); browser = await lib.launchBrowser(); }
    let audioOk = null;
    const hasAudio = async () => {
      if (audioOk === null) {
        const c = await browser.newContext(); const p = await c.newPage();
        audioOk = await p.evaluate(() => typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined').catch(() => false);
        await c.close();
      }
      return audioOk;
    };
    for (const t of plan) {
      // CDP（Chromium 専用の機能）を使う確認は、ほかのブラウザでは対象外にする
      if (t.cdp && !lib.IS_CHROMIUM) { out.skipped.push({ id: t.id, title: t.title, why: t.cdp }); continue; }
      // 効果音の確認（audio: true）は、ブラウザに AudioContext が無い環境（Windows 版 Playwright の WebKit など）では対象外にする。
      // OS 名では決めず、実際に typeof AudioContext / webkitAudioContext を調べる
      if (t.audio && !(await hasAudio())) { out.skipped.push({ id: t.id, title: t.title, why: '環境に AudioContext が無い', env: true }); continue; }
      // ページ・ブラウザが落ちた例外（WebKit の Target crashed など。MT-14）・ページが止まった例外（STALLED。v39）は、どちらも 1 回だけその項目を流し直す。
      // ふつうの不合格（check の失敗・ほかの例外）は流し直さない。流し直した項目は結果に「流し直し N 回」と出す
      const whys = []; let crashes = 0, stalls = 0;
      for (let attempt = 0; ; attempt++) {
        rec.start(t.id, t.title);
        // live：この回の確かめだけを記録する（時間切れのあとも裏で動き続けた run の check が、次の項目の結果に混ざらないように。v39 1 章）
        let live = true, stalled = null;
        // FORCE_FAIL の :time：時間の確かめ（flaky.checks に当てはまる名前）をわざと落とす
        const ff = FORCE_FAIL[t.id] && FORCE_FAIL[t.id].n > FLAKY_TRY ? FORCE_FAIL[t.id] : null;
        const ffRe = ff && ff.time && flakyOf(t) && flakyOf(t).checks instanceof RegExp ? flakyOf(t).checks : null;
        const ctx = { browser, srv, root, tier, errors: lib.pageErrors, check: (n, ok, d, known) => (live ? rec.check(n, ffRe && ffRe.test(n) ? false : ok, ffRe && ffRe.test(n) ? 'わざと不合格（FORCE_FAIL・時間の確かめ）' : d, known) : !!ok) };
        const limit = Math.max(TEST_TIMEOUT, t.timeout || 0);   // 項目ごとの上限（t.timeout）は、既定より長いときだけ使う
        let timer;
        try { await Promise.race([t.run(ctx), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${limit / 1000} 秒以内に終わらない`)), limit); })]); }
        catch (e) { rec.fail(e); const m = String(e && e.message || e); if (STALLED(m)) stalled = m.split('\n')[0].slice(0, 120); }
        finally { clearTimeout(timer); live = false; }
        if (ff && !ff.time) rec.check(`わざと不合格（FORCE_FAIL・${FLAKY_TRY + 1} 回目）`, false, '仕組みの確かめ用（機能の確かめの代わり）');
        else if (ff && ff.time && !ffRe) rec.fail(new Error(`わざと時間切れ（FORCE_FAIL・${FLAKY_TRY + 1} 回目）：60 秒以内に終わらない`));
        // 止まった（時間切れなど）ときは、その項目のページを閉じる（裏で動き続けて重くする・次の項目に混ざるのを止める）
        if (stalled) for (const c of browser ? browser.contexts() : []) await c.close().catch(() => {});
        srv?.reset();
        const it = rec.end();
        const crash = it.checks.find((c) => c.name === '例外' && CRASHED.test(String(c.detail)));
        if ((crash && crashes < MAX_RETRY) || (!crash && stalled && stalls < MAX_RETRY)) {
          if (crash) crashes++; else stalls++;
          rec.items.pop();   // その回の結果は捨てて、落ちた・止まった理由だけ残す
          whys.push(crash ? String(crash.detail).split(' | ')[0].slice(0, 120) : stalled);
          for (const c of browser ? browser.contexts() : []) await c.close().catch(() => {});
          // ページが落ちたときは、ブラウザごと起動し直してから流し直す（WebKit で 2 回目も続けて落ちる回があった。MT-14。v39 1 章）
          if (crash && browser) { await browser.close().catch(() => {}); browser = await lib.launchBrowser(); }
          else if (browser && !browser.isConnected()) browser = await lib.launchBrowser();
          continue;
        }
        if (whys.length) { it.retry = whys.length; it.retryWhy = whys.map((w, i) => `${i + 1} 回目：${w}`).join(' / '); }
        break;
      }
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
  const WORKERS = Math.max(1, Number(process.env.WORKERS || 3));
  const mods = {};
  for (const g of GROUPS) mods[g.key] = (await import('./cases/' + g.file)).tests;
  const plan = GROUPS.filter((g) => mods[g.key].some(pick));
  const target = tier === 'smoke' ? 15 : 60;
  console.log(`ゆびあそび 統合テスト [${tier}]  ブラウザ: ${BROWSER}  並列: ${WORKERS}  早送り: ${process.env.CLOCK === '0' ? 'なし' : 'あり'}  画面: ${process.env.HEADED === '1' ? 'あり' : 'なし'}`);
  console.log(`配信: ${root}  → http://127.0.0.1:${PORT}〜${PORT + WORKERS - 1}/game-no1/\n`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yubi-tests-'));
  const results = {};
  // 並列（WORKERS が 2 以上）なら、solo の項目は並列の段から外し、あとの段で 1 グループずつ流す（T-02）
  const split = WORKERS > 1;
  const hasSolo = (g) => mods[g.key].some((t) => pick(t) && t.solo);
  const hasPar = (g) => mods[g.key].some((t) => pick(t) && !t.solo);
  const queue = [...plan].filter((g) => !split || hasPar(g)).sort((a, b) => b.weight[tier] - a.weight[tier]);
  // 1 グループを子プロセスで流して結果を返す（extra：子に渡す環境変数。揺れやすい項目の流し直しでは ONLY と FLAKY_TRY）
  const spawnWorker = (g, slot, phase, extra = {}, tag = '') => new Promise((resolve) => {
    const file = path.join(tmp, g.key + '.' + phase + tag + '.json');
    const t0 = Date.now();
    const child = spawn(process.execPath, [SELF, '--worker', tier, root, g.key], { env: { ...process.env, PORT: String(PORT + slot), RESULT_FILE: file, PHASE: phase, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    child.on('close', (code) => {
      let r;
      try { r = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { r = { key: g.key, items: [], errors: [], skipped: [], fatal: `子プロセスが結果を書かずに終了（code ${code}）\n${log.slice(-2000)}` }; }
      r.sec = (Date.now() - t0) / 1000; r.log = log;
      resolve(r);
    });
  });
  const runOne = (g, slot, phase) => spawnWorker(g, slot, phase).then((r) => {
      const prev = results[g.key];   // 並列の段の結果があれば、solo の段の結果をうしろに足す
      results[g.key] = !prev ? r : { ...prev, items: [...prev.items, ...r.items], errors: [...prev.errors, ...r.errors], skipped: [...prev.skipped, ...r.skipped],
        fatal: [prev.fatal, r.fatal].filter(Boolean).join('\n') || null, sec: prev.sec + r.sec, log: prev.log + r.log };
      const ng = r.items.filter((i) => !i.ok).length + (r.fatal ? 1 : 0);
      console.log(`  … ${g.title.split(' ')[0]}${phase === 'solo' ? '（速さ・1 つずつ）' : ''} 完了 ${r.sec.toFixed(1)}s（${r.items.length} 項目${ng ? `、不合格 ${ng}` : ''}）`);
  });
  await Promise.all(Array.from({ length: Math.min(WORKERS, queue.length) }, async (_, slot) => {
    while (queue.length) await runOne(queue.shift(), slot, split ? 'par' : 'all');
  }));
  if (split) for (const g of plan.filter(hasSolo)) await runOne(g, 0, 'solo');
  // ---- 揺れやすい項目（flaky）の流し直し：全部終わったあと、ふつうの不合格になった項目だけを 1 つずつ順に（WORKERS が何でも並列なし）最大 FLAKY_RETRY 回 ----
  // 落ちた確かめが全部 時間の確かめ（flaky.checks）か時間切れのときだけ流し直す（技術レビュー H-2）。
  // 1 回でも合格したら、その回の結果に置き換えて「揺れ（流し直しで合格）」の印を付ける。FLAKY_RETRY 回とも不合格なら、最初の結果のまま不合格
  const flakyDef = (g, id) => flakyOf(mods[g.key].find((t) => t.id === id && t.flaky));
  const flakyFailed = plan.flatMap((g) => (results[g.key]?.items || []).filter((it) => !it.ok && flakyDef(g, it.id)).map((it) => ({ g, it })));
  const flakyTodo = FLAKY_RETRY > 0 ? flakyFailed.filter(({ g, it }) => flakyRetryable(flakyDef(g, it.id), it)) : [];
  const flakySkip = flakyFailed.filter((x) => !flakyTodo.includes(x));
  if (flakySkip.length) console.log(`\n  揺れやすい項目だが流し直さない（${FLAKY_RETRY > 0 ? '時間の確かめ・時間切れのほかの確かめが落ちた' : 'FLAKY_RETRY=0'}）: ${flakySkip.map((x) => x.it.id).join(', ')}`);
  if (flakyTodo.length) console.log(`\n  揺れやすい項目の流し直し（1 つずつ・最大 ${FLAKY_RETRY} 回）: ${flakyTodo.map((x) => x.it.id).join(', ')}`);
  for (const { g, it } of flakyTodo) {
    const firstWhy = it.checks.filter((c) => !c.ok && !c.known).map((c) => c.name).join('・').slice(0, 160);
    const tries = [];
    let passed = null;
    for (let n = 1; n <= FLAKY_RETRY && !passed; n++) {
      const r = await spawnWorker(g, 0, 'all', { ONLY: it.id, FLAKY_TRY: String(n) }, '.flaky' + n);
      const got = r.items.find((x) => x.id === it.id);
      results[g.key].errors.push(...r.errors);
      results[g.key].log += r.log;
      const ok = !!(got && got.ok && !r.fatal);
      tries.push(ok ? '合格' : (got ? got.checks.filter((c) => !c.ok && !c.known).map((c) => c.name).join('・').slice(0, 120) : (r.fatal || '結果なし').split('\n')[0].slice(0, 120)));
      console.log(`  … ${it.id} 流し直し ${n} 回目 ${ok ? '合格' : '不合格'} ${r.sec.toFixed(1)}s`);
      if (ok) passed = got;
    }
    const list = results[g.key].items;
    const idx = list.indexOf(it);
    const info = { reason: flakyDef(g, it.id).why, first: firstWhy, tries };
    if (passed) list[idx] = { ...passed, flaky: info, retry: it.retry, retryWhy: it.retryWhy };
    else it.flaky = info;
  }
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
      console.log(`  ${it.ok ? 'PASS' : 'FAIL'}  ${it.id.padEnd(3)} ${(it.ms / 1000).toFixed(1).padStart(5)}s  ${it.title}  (${it.checks.filter((c) => c.ok).length}/${it.checks.length})${it.retry ? `\n        ↻ 流し直し ${it.retry} 回（${it.retryWhy}）` : ''}${it.flaky ? `\n        〜 揺れやすい項目（${it.flaky.reason}）：1 回目は不合格（${it.flaky.first}）、流し直し ${it.flaky.tries.map((w, i) => `${i + 1} 回目 ${w}`).join(' / ')}` : ''}`);
      for (const c of it.checks) {
        if (c.known && !c.ok) console.log(`        △ 既知の不具合（修正待ち・合否に含めない）: ${c.name}\n          ${c.known}`);
        else if (c.known && c.ok) console.log(`        ★ 既知の不具合が解消した: ${c.name} → tests/lib.mjs の KNOWN_ISSUES から外す`);
        else if (!c.ok || process.env.VERBOSE) console.log(`        ${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : '\n          ' + String(JSON.stringify(c.detail)).slice(0, 1500)}`);
      }
    }
    for (const s of r.skipped) { skipped.push(s); console.log(`  対象外 ${s.id.padEnd(3)}        ${s.title}（${s.env ? `${BROWSER} の実行環境：${s.why}` : `${BROWSER} では不可：${s.why}`}）`); }
    errors.push(...r.errors);
  }
  // 全ページ共通の確認は最後に1回だけ（各グループで集めたコンソールエラーをまとめる）
  if (plan.some((g) => !['L', 'ZL', 'HL', 'BL', 'QL', 'FL', 'WL', 'KL'].includes(g.key))) {
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
  const retried = items.filter((i) => i.retry);
  if (retried.length) console.log('流し直し（ページ・ブラウザが落ちた・止まった）: ' + retried.map((i) => `${i.id}（${i.retry} 回。${i.retry + 1} 回目${i.ok ? 'は合格' : 'も不合格'}）`).join(', '));
  // 揺れ（流し直しで合格）は合格に数えるが、隠さずに最後に一覧で出す
  const flakyOk = items.filter((i) => i.flaky && i.ok), flakyNg = items.filter((i) => i.flaky && !i.ok);
  if (flakyOk.length) console.log(`揺れ（流し直しで合格・合格に数えた） ${flakyOk.length} 件:\n` + flakyOk.map((i) => `  ${i.id}（1 回目：${i.flaky.first}／流し直し ${i.flaky.tries.length} 回目で合格。理由：${i.flaky.reason}）`).join('\n'));
  if (flakyNg.length) console.log(`揺れやすい項目の流し直しも ${FLAKY_RETRY} 回とも不合格 ${flakyNg.length} 件: ` + flakyNg.map((i) => i.id).join(', '));
  if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify({ tier, browser: BROWSER, root, totalSec: total, items, skipped }, null, 1));
  process.exit(failed.length ? 1 : 0);
}
