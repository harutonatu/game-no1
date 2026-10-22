// I: いろコード（games/irocode/）。
//   Node で logic.js を直接読む部分（I1〜I3, I9）と、契約の DOM を使う画面の部分（I4〜I8, I10〜I18）。
//   画面の DOM は担当間の契約（a#back, #soundBtn, #helpBtn, #modeDaily, #modePractice, #hardToggle, #slots .slot[data-i],
//   #palette button[data-color], #submit, #rows .row[data-hit][data-blow], #triesLeft, #overlay .card, button[data-cmd=…],
//   .answer .slot[data-color], window.IroCodeGame.getState()）だけに頼る。
//   決め打ちしない：問題の答えは getState().secret から読む／状態を注入するときは logic.js の newGame・score で作る。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { BASE, IRO, view, custom, newPage, seed, wait, frozen, layoutProbe, swInfo, sleep, SFX_SPY, TIMEZONES, zonedTime } from '../lib.mjs';

const V = () => view('i13', 'p', 'app');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- Node：logic.js を読む ----------
function loadLogic(root) {
  const req = createRequire(import.meta.url);
  const p = path.join(root, 'games/irocode/logic.js');
  delete req.cache[req.resolve(p)];
  return req(p);
}
// 別実装の score（検算用）：色ごとの数を数える方式
function refScore(g, s) {
  let hit = 0; for (let i = 0; i < 4; i++) if (g[i] === s[i]) hit++;
  let common = 0; for (let c = 0; c < 6; c++) common += Math.min(g.filter((x) => x === c).length, s.filter((x) => x === c).length);
  return { hit, blow: common - hit };
}

// 状態の作成：logic.js の newGame で作り、手を足す（rows は score で計算）
function makeState(L, opts, guesses = [], cur = []) {
  const s = L.newGame(opts);
  s.rows = guesses.map((g) => ({ g: g.slice(), ...L.score(g, s.secret) }));
  const max = s.hard ? L.MAX_TRIES.hard : L.MAX_TRIES.normal;
  s.done = s.rows.some((r) => r.hit === 4) ? 'win' : (s.rows.length >= max ? 'lose' : null);
  s.cur = s.done ? [] : cur.slice();
  return s;
}
// secret と一致しない推測（i 番目）
function wrong(secret, i = 0) {
  // ふつうの画面は入力中の同じ色を押せないので、4色ともちがう推測を返す
  for (let k = 0; k < 6; k++) { const j = i + k; const g = [j % 6, (j + 1) % 6, (j + 2) % 6, (j + 3) % 6]; if (!eq(g, secret)) return g; }
}

// 別プロセスで TZ を指定して todayStr を呼ぶ（このプロセスの TZ に左右されない）。戻り値：{ offset, out }（offset は getTimezoneOffset）
function todayStrInTZ(root, tz, cases) {
  const code = 'const L=require(process.argv[1]);const c=JSON.parse(process.argv[2]);'
    + 'const d=c.map(([y,m,d,h,mi,s])=>new Date(y,m-1,d,h,mi,s));'
    + 'console.log(JSON.stringify({offset:d[0].getTimezoneOffset(),out:d.map((x)=>L.todayStr(x))}));';
  const r = spawnSync(process.execPath, ['-e', code, path.join(root, 'games/irocode/logic.js'), JSON.stringify(cases)], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  try { return JSON.parse(r.stdout); } catch { return { offset: null, out: [], err: r.stderr }; }
}

// ---------- ブラウザ：共通の操作 ----------
const getState = (p) => p.evaluate(() => window.IroCodeGame.getState());
const lsGet = (p, k) => p.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return 'ERR'; } }, k);
const overlayShown = (p) => p.evaluate(() => { const o = document.querySelector('#overlay'); return !!o && !o.hidden; });
const rowsOf = (p) => p.evaluate(() => [...document.querySelectorAll('#rows .row')].map((r) => ({ hit: Number(r.dataset.hit), blow: Number(r.dataset.blow) })));
async function open(browser, label, { v = V(), state, stats, daily, extra = {}, opts = {}, keepHelp = false } = {}) {
  const { ctx, page } = await newPage(browser, v, label, { clock: true, ...opts });
  const items = { ...extra };
  if (state !== undefined) items['irocode.state'] = state;
  if (stats !== undefined) items['irocode.stats'] = stats;
  if (daily !== undefined) items['irocode.daily'] = daily;
  await seed(page, items);
  await page.goto(IRO); await wait(page, 300);
  if (!keepHelp) await closeHelp(page);
  return { ctx, page };
}
// 初めて開いたときに出る「遊び方」カード（data-cmd="close"）を閉じる
async function closeHelp(page) {
  await page.waitForFunction(() => !!window.IroCodeGame, null, { timeout: 5000 }).catch(() => {});
  if (await page.locator('#overlay:not([hidden]) [data-cmd="close"]').count()) { await page.locator('#overlay [data-cmd="close"]').click(); await wait(page, 200); }
}
async function goPractice(page, hard = false) {
  await page.locator('#modePractice').tap(); await wait(page, 400);
  if (hard) { await page.locator('#hardToggle').tap(); await wait(page, 400); }
}
async function fill(page, g) {
  for (const c of g) { await page.locator(`#palette button[data-color="${c}"]`).tap(); await wait(page, 40); }
  await wait(page, 400);      // 連続タップ抑止（350ms 以内の2回目は止める）に、次の別の操作が巻き込まれないよう間をあける
}
async function guess(page, g) {
  await fill(page, g);
  await page.locator('#submit').tap(); await wait(page, 1100);
}
const cardInfo = (p) => p.evaluate(() => {
  const c = document.querySelector('#overlay .card');
  return { text: c ? c.textContent.replace(/\s+/g, ' ') : '', cmds: c ? [...c.querySelectorAll('[data-cmd]')].map((b) => b.dataset.cmd) : [], answer: c ? [...c.querySelectorAll('.answer .slot')].map((s) => Number(s.dataset.color)) : [] };
});
// カード内のボタンが画面内に収まるか（必要ならカードをスクロールして）と大きさ
const cardReach = (p) => p.evaluate(() => {
  const ov = document.querySelector('#overlay');
  return [...ov.querySelectorAll('.card button')].filter((b) => b.offsetParent !== null).map((b) => {
    b.scrollIntoView({ block: 'nearest' });
    const r = b.getBoundingClientRect();
    return { t: b.textContent.trim(), cmd: b.dataset.cmd, inside: r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5, w: Math.round(r.width), h: Math.round(r.height) };
  });
});
const BTNS = 'a#back, #soundBtn, #helpBtn, #modeDaily, #modePractice, #hardToggle, #palette button, #submit';

// ---------- X-20：古いページから書き戻さない（bfcache から戻ったとき・裏にいる間に別のタブが書いたとき） ----------
// key：見張る保存のキー。newer：ほかのページが書いた新しい保存（生の文字）を2つ。fp(raw)：中身の印（同じ中身なら同じ文字）。
// (a) 変わっていなければ pageshow persisted でも開き直さない。(b) bfcache（入る → ほかで書く → pageshow persisted → pagehide）で
// 書き戻さず開き直し、開き直したページが新しい保存から続ける（もう一度 pagehide で書かせて印を比べる）。
// (c) 裏にいる間に同じ context の別のページが書く（本物の storage イベント）→ pagehide で書き戻さず、表に戻ると開き直す。
const x20Hidden = (p, h) => p.evaluate((h) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  document.dispatchEvent(new Event('visibilitychange'));
}, h);
async function x20Run(page, ctx, { key, newer, fp }) {
  const loaded = () => page.waitForEvent('load', { timeout: 5000 }).then(() => true, () => false);
  const hideNow = () => page.evaluate((k) => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); return localStorage.getItem(k); }, key);
  let nav = loaded();
  await page.evaluate(() => { window.__x20 = 1; window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  const a = { reload: await nav, same: await page.evaluate(() => window.__x20 === 1) };
  nav = loaded();
  const b = { kept: await page.evaluate(([k, raw]) => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    localStorage.setItem(k, raw);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    return localStorage.getItem(k) === raw;
  }, [key, newer[0]]) };
  b.reload = await nav; await wait(page, 300);
  b.fp = fp(await hideNow()); b.want = fp(newer[0]);
  await x20Hidden(page, true); await wait(page, 50);
  const p2 = await ctx.newPage();
  await p2.goto(BASE + 'manifest.webmanifest');
  await p2.evaluate(([k, raw]) => localStorage.setItem(k, raw), [key, newer[1]]);
  await p2.close();
  await page.waitForTimeout(200);
  const c = { kept: (await hideNow()) === newer[1] };
  nav = loaded();
  await x20Hidden(page, false);
  c.reload = await nav; await wait(page, 300);
  c.fp = fp(await hideNow()); c.want = fp(newer[1]);
  const ok = !a.reload && a.same && b.kept && b.reload && b.fp === b.want && c.kept && c.reload && c.fp === c.want;
  return { ok, a, b, c };
}
const x20Text = (r) => `変わっていなければ開き直さない（${!r.a.reload && r.a.same}）・bfcache で書き戻さない（${r.b.kept}）・開き直す（${r.b.reload}）・新しい保存から続ける（${r.b.fp === r.b.want}）・裏で別のタブが書いたら閉じても書き戻さない（${r.c.kept}）・表に戻ると開き直して（${r.c.reload}）続ける（${r.c.fp === r.c.want}）`;

export const tests = [
  // ================= Node（logic.js） =================
  {
    id: 'I1', tier: 'smoke', node: true, title: 'いろコード：score（hit・blow）。重複の数え方・全パターンの検算',
    run({ check, root }) {
      const L = loadLogic(root);
      const T = [
        [[0, 1, 2, 3], [0, 1, 2, 3], 4, 0], [[0, 1, 2, 3], [3, 2, 1, 0], 0, 4], [[0, 1, 2, 3], [0, 1, 4, 5], 2, 0],
        [[0, 1, 2, 3], [1, 0, 4, 5], 0, 2], [[0, 0, 0, 0], [0, 1, 2, 3], 1, 0], [[0, 0, 1, 1], [1, 1, 0, 0], 0, 4],
        [[0, 0, 1, 1], [0, 2, 3, 4], 1, 0], [[0, 0, 0, 1], [1, 0, 0, 0], 2, 2], [[5, 5, 5, 5], [5, 5, 5, 5], 4, 0],
        [[2, 2, 3, 3], [3, 3, 2, 2], 0, 4], [[0, 1, 0, 1], [1, 0, 1, 0], 0, 4], [[4, 4, 4, 0], [0, 4, 5, 5], 1, 1],
        [[0, 1, 2, 3], [4, 4, 5, 5], 0, 0], [[1, 1, 2, 2], [1, 2, 3, 4], 1, 1],
      ];
      const bad = T.map(([g, s, h, b]) => ({ g, s, h, b, got: L.score(g, s) })).filter((x) => x.got.hit !== x.h || x.got.blow !== x.b);
      check(`手で確かめた ${T.length} 例（重複・全部ちがう位置・何も合わない・全部合う）が期待どおり`, bad.length === 0, bad);
      // 1296 × 1296 通りを別実装と照合する（約 1 秒）
      const all = []; for (let n = 0; n < 1296; n++) all.push([Math.floor(n / 216) % 6, Math.floor(n / 36) % 6, Math.floor(n / 6) % 6, n % 6]);
      let mismatch = null, over = null;
      outer: for (const g of all) for (const s of all) {
        const a = L.score(g, s), b = refScore(g, s);
        if (a.hit !== b.hit || a.blow !== b.blow) { mismatch = { g, s, a, b }; break outer; }
        if (a.hit + a.blow > 4) { over = { g, s, a }; break outer; }
        const r = L.score(s, g); if (r.hit !== a.hit || r.blow !== a.blow) { mismatch = { g, s, a, r }; break outer; }
      }
      check('全 1296×1296 通りが別実装の検算と一致（hit+blow ≤ 4、score(a,b) と score(b,a) が同じ）', !mismatch && !over, { mismatch, over });
      const g = [0, 1, 2, 3], s = [0, 1, 2, 3]; L.score(g, s);
      check('score は引数の配列を書き換えない', eq(g, [0, 1, 2, 3]) && eq(s, [0, 1, 2, 3]));
    },
  },
  {
    id: 'I2', tier: 'smoke', node: true, title: 'いろコード：色・乱数・秘密・今日の日付と種・newGame（決定性と境界）',
    run({ check, root }) {
      const L = loadLogic(root);
      check('COLORS は6色。名前・色・記号がすべて異なる（色覚配慮の土台）',
        L.COLORS.length === 6 && new Set(L.COLORS.map((c) => c.symbol)).size === 6 && new Set(L.COLORS.map((c) => c.hex.toLowerCase())).size === 6 && new Set(L.COLORS.map((c) => c.name)).size === 6
        && L.COLORS.every((c) => c.symbol && /^#[0-9a-f]{6}$/i.test(c.hex) && c.name), L.COLORS);
      check('MAX_TRIES は ふつう10・むずかしい8', L.MAX_TRIES.normal === 10 && L.MAX_TRIES.hard === 8);
      const seq = (s, n = 8) => { const r = L.rng(s); return Array.from({ length: n }, () => r()); };
      check('rng：同じ種なら同じ列、[0,1) に入る（種の境界 0・1・2^32-1）', eq(seq(12345), seq(12345)) && [0, 1, 0xFFFFFFFF, 777].every((s) => seq(s, 500).every((x) => x >= 0 && x < 1)));
      check('rng：種が違えば列が変わる（6つの種で6通り）', new Set([1, 2, 3, 4, 5, 6].map((s) => seq(s, 1)[0].toFixed(8))).size === 6);
      let dupNormal = 0, rangeBad = 0, hardDup = 0;
      for (let i = 0; i < 3000; i++) {
        const sn = L.makeSecret(L.rng(i * 7919 + 1), false), sh = L.makeSecret(L.rng(i * 104729 + 3), true);
        if (sn.length !== 4 || !sn.every((c) => Number.isInteger(c) && c >= 0 && c < 6) || sh.length !== 4 || !sh.every((c) => Number.isInteger(c) && c >= 0 && c < 6)) rangeBad++;
        if (new Set(sn).size !== 4) dupNormal++;
        if (new Set(sh).size !== 4) hardDup++;
      }
      check('makeSecret（ふつう）：3000通りすべて 0〜5 の4つ、同じ色なし', rangeBad === 0 && dupNormal === 0, { rangeBad, dupNormal });
      check('makeSecret（むずかしい）：同じ色ありの問題も出る（3000通りのうち 1000〜2900 通りが重複あり。理論値は約 72%）', hardDup > 1000 && hardDup < 2900, { hardDup });
      const cnt = [0, 0, 0, 0, 0, 0]; for (let i = 0; i < 6000; i++) L.makeSecret(L.rng(i + 99), false).forEach((c) => cnt[c]++);
      check('makeSecret：6色が偏りなく出る（各色が全体の 12%〜21%。理論値は 16.7%）', cnt.every((n) => n > 6000 * 4 * 0.12 && n < 6000 * 4 * 0.21), cnt);
      check('makeSecret は同じ rng なら同じ答え', eq(L.makeSecret(L.rng(42), false), L.makeSecret(L.rng(42), false)) && eq(L.makeSecret(L.rng(42), true), L.makeSecret(L.rng(42), true)));
      // 日付：ローカル日付。月・年の境目と、0 時の前後
      const D = (y, m, d, h = 12, mi = 0, s = 0) => new Date(y, m - 1, d, h, mi, s);
      const days = [[D(2026, 1, 5), '2026-01-05'], [D(2026, 12, 31, 23, 59, 59), '2026-12-31'], [D(2027, 1, 1, 0, 0, 0), '2027-01-01'], [D(2028, 2, 29), '2028-02-29'], [D(2026, 10, 17, 23, 59, 59), '2026-10-17'], [D(2026, 10, 18, 0, 0, 0), '2026-10-18']];
      const badDay = days.filter(([d, s]) => L.todayStr(d) !== s).map(([d, s]) => [s, L.todayStr(d)]);
      check('todayStr：ローカル日付 YYYY-MM-DD（0 埋め・年末・うるう日・23:59:59 と 0:00:00 で日が変わる）、引数なしは今日', badDay.length === 0 && /^\d{4}-\d{2}-\d{2}$/.test(L.todayStr()), badDay);
      // 同じ確認を、タイムゾーンを変えた別プロセスでも行う（UTC のままだと、UTC 由来の日付への取り違えに気づけない）
      const tzCases = [[2026, 1, 5, 12, 0, 0], [2026, 12, 31, 23, 59, 59], [2027, 1, 1, 0, 0, 0], [2028, 2, 29, 12, 0, 0], [2026, 10, 17, 23, 59, 59], [2026, 10, 18, 0, 0, 0], [2026, 3, 9, 8, 30, 0], [2026, 9, 30, 0, 0, 1]];
      const tzWant = ['2026-01-05', '2026-12-31', '2027-01-01', '2028-02-29', '2026-10-17', '2026-10-18', '2026-03-09', '2026-09-30'];
      const tzRes = Object.fromEntries(TIMEZONES.map((tz) => [tz, todayStrInTZ(root, tz, tzCases)]));
      const tzBad = Object.entries(tzRes).filter(([, r]) => !eq(r.out, tzWant)).map(([tz, r]) => [tz, r.out]);
      check(`todayStr：タイムゾーン ${TIMEZONES.join(' と ')} の別プロセスでも、ローカル日付になる（UTC 由来・月のずれがない。日本は 0〜9 時台、LA は夕方以降に UTC の日付とずれる）`,
        tzBad.length === 0 && TIMEZONES.every((tz) => typeof tzRes[tz].offset === 'number') && new Set(TIMEZONES.map((tz) => tzRes[tz].offset)).size === TIMEZONES.length, { tzBad, offsets: TIMEZONES.map((tz) => tzRes[tz].offset) });
      const s1 = L.dailySeed('2026-10-17'), s2 = L.dailySeed('2026-10-18');
      check('dailySeed：同じ日付は同じ値、32bit の非負整数、別の日は別の値', s1 === L.dailySeed('2026-10-17') && Number.isInteger(s1) && s1 >= 0 && s1 <= 0xFFFFFFFF && s1 !== s2);
      const seeds = new Set(); for (let i = 0; i < 365; i++) seeds.add(L.dailySeed(L.todayStr(new Date(2026, 0, 1 + i))));
      check('dailySeed：1年分 365 日で重複なし', seeds.size === 365, seeds.size);
      const a = L.newGame({ mode: 'daily', date: '2026-10-17' }), b = L.newGame({ mode: 'daily', date: '2026-10-17', hard: true }), c = L.newGame({ mode: 'daily', date: '2026-10-18' });
      check('newGame(daily)：同じ日は同じ問題、今日の1問は常に「ふつう」（hard を渡しても同じ色なし）', eq(a.secret, b.secret) && b.hard === false && new Set(b.secret).size === 4 && a.mode === 'daily' && a.date === '2026-10-17' && a.seed === s1);
      check('newGame(daily)：別の日は別の種、date が入る', a.seed !== c.seed && c.date === '2026-10-18');
      const days60 = new Set(); for (let i = 0; i < 60; i++) days60.add(L.newGame({ mode: 'daily', date: L.todayStr(new Date(2026, 5, 1 + i)) }).secret.join());
      check('newGame(daily)：60日で答えが十分ばらける（40通り以上）', days60.size >= 40, days60.size);
      const p1 = L.newGame({ mode: 'practice', seed: 5 }), p2 = L.newGame({ mode: 'practice', seed: 5 }), ph = L.newGame({ mode: 'practice', hard: true, seed: 5 });
      check('newGame(practice)：種を渡せば同じ問題、date は null、hard を指定できる', eq(p1, p2) && p1.date === null && p1.mode === 'practice' && p1.hard === false && ph.hard === true && eq(ph.secret, L.makeSecret(L.rng(5), true)));
      check('newGame：初期状態 v:1・rows 空・cur 空・done null、種なしでも作れる', p1.v === 1 && eq(p1.rows, []) && eq(p1.cur, []) && p1.done === null && Number.isInteger(L.newGame({ mode: 'practice' }).seed));
      const rs = new Set(); for (let i = 0; i < 20; i++) rs.add(L.newGame({ mode: 'practice' }).seed);
      check('newGame(practice)：種なしなら毎回ちがう種（20回で 19 通り以上）', rs.size >= 19, rs.size);
    },
  },
  {
    id: 'I3', tier: 'smoke', node: true, title: 'いろコード：保存データの検証（state・stats・daily）の同値分割と境界値',
    run({ check, root }) {
      const L = loadLogic(root);
      const base = () => makeState(L, { mode: 'practice', seed: 4242 }, [[0, 1, 2, 3], [1, 2, 3, 4]], [2, 3]);
      const j = (x) => JSON.parse(JSON.stringify(x));
      check('正しい state（途中経過）は受け入れ、同じ内容で返る', eq(L.validateState(j(base())), j(base())));
      const sec = base().secret;
      const won = makeState(L, { mode: 'practice', seed: 4242 }, [wrong(sec), sec]);
      const lost = makeState(L, { mode: 'practice', seed: 4242 }, Array.from({ length: 10 }, (_, i) => wrong(sec, i)));
      const hsec = L.newGame({ mode: 'practice', hard: true, seed: 99 }).secret;
      const hardLost = makeState(L, { mode: 'practice', hard: true, seed: 99 }, Array.from({ length: 8 }, (_, i) => wrong(hsec, i)));
      const daily = makeState(L, { mode: 'daily', date: '2026-10-17' }, [[0, 1, 2, 3]]);
      check('正しい state：勝ち／負け（10回）／むずかしいの負け（8回）／今日の1問', [won, lost, hardLost, daily].every((s) => eq(L.validateState(j(s)), j(s))) && won.done === 'win' && lost.done === 'lose' && hardLost.done === 'lose', { w: won.done, l: lost.done, h: hardLost.done });
      const mut = (f) => { const s = j(base()); f(s); return s; };
      const NG = {
        'null': null, '文字列': 'x', '配列': [], '数値': 5, 'v が違う': mut((s) => { s.v = 2; }), 'mode が違う': mut((s) => { s.mode = 'free'; }),
        'hard が真偽値でない': mut((s) => { s.hard = 1; }), '今日の1問が hard': Object.assign(j(daily), { hard: true }),
        'seed が負': mut((s) => { s.seed = -1; }), 'seed が 2^32': mut((s) => { s.seed = 4294967296; }), 'seed が小数': mut((s) => { s.seed = 1.5; }),
        'secret が種と食い違う': mut((s) => { s.secret = s.secret.slice().reverse(); }), 'secret が3つ': mut((s) => { s.secret = s.secret.slice(0, 3); }),
        'secret に色6': mut((s) => { s.secret[0] = 6; }), 'secret に重複（ふつう）': mut((s) => { s.secret = [0, 0, 1, 2]; }),
        'rows が11行': mut((s) => { s.rows = Array.from({ length: 11 }, () => ({ g: [0, 1, 2, 3], ...L.score([0, 1, 2, 3], s.secret) })); }),
        'row の hit が合わない': mut((s) => { s.rows[0].hit = 4; }), 'row の blow が合わない': mut((s) => { s.rows[0].blow = (s.rows[0].blow + 1) % 5; }),
        'row の色が -1': mut((s) => { s.rows[0].g[0] = -1; }), 'row の色が小数': mut((s) => { s.rows[0].g[0] = 1.5; }), 'row の色が文字': mut((s) => { s.rows[0].g[0] = '1'; }),
        'row が3つ': mut((s) => { s.rows[0].g = [0, 1, 2]; }), 'cur が5つ': mut((s) => { s.cur = [0, 1, 2, 3, 4]; }), 'cur に色6': mut((s) => { s.cur = [6]; }), 'cur が配列でない': mut((s) => { s.cur = 'ab'; }),
        '勝った後にも行がある': mut((s) => { s.rows = [{ g: s.secret.slice(), hit: 4, blow: 0 }, s.rows[0]]; }),
        'done が食い違う': mut((s) => { s.done = 'win'; }), '終わっているのに cur がある': Object.assign(j(won), { cur: [1] }),
        'daily の date が別の日の種': Object.assign(j(daily), { date: '2026-10-18' }), 'daily の date が実在しない': Object.assign(j(daily), { date: '2026-02-30' }),
        'practice の date が null でない': mut((s) => { s.date = '2026-10-17'; }),
      };
      const accepted = Object.entries(NG).filter(([, v]) => L.validateState(v) !== null).map(([k]) => k);
      check(`壊れた state ${Object.keys(NG).length} 種をすべて拒否（null を返す）`, accepted.length === 0, accepted);
      const edge = {
        '10行ちょうどで負け': eq(L.validateState(j(lost)), j(lost)), 'むずかしい 8 行で負け': eq(L.validateState(j(hardLost)), j(hardLost)),
        'むずかしいで 9 行は拒否': L.validateState(Object.assign(j(hardLost), { rows: [...j(hardLost).rows, { g: [0, 1, 2, 3], ...L.score([0, 1, 2, 3], hsec) }] })) === null,
        'cur が4つ': L.validateState(Object.assign(j(base()), { cur: [0, 0, 0, 0] })) !== null, 'cur が0個': L.validateState(Object.assign(j(base()), { cur: [] })) !== null,
        'done が無い途中経過': (() => { const s = j(base()); delete s.done; return L.validateState(s) !== null; })(),
        'むずかしいの重複あり secret': (() => { for (let i = 0; i < 200; i++) { const g = L.newGame({ mode: 'practice', hard: true, seed: i }); if (new Set(g.secret).size < 4) return L.validateState(j(g)) !== null; } return false; })(),
      };
      check('境界：10行・8行（むずかしい）で負け、9行は拒否、cur 0〜4個、むずかしいの重複あり secret を受け入れる', Object.values(edge).every(Boolean), edge);
      const init = L.validateStats(null);
      check('validateStats：不正なら初期値（played 0・wins 0・best null・dist の 1〜10 が 0）', init.played === 0 && init.wins === 0 && init.best === null && eq(Object.keys(init.dist), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']) && Object.values(init.dist).every((n) => n === 0));
      const v = L.validateStats(j({ played: 5, wins: 3, best: 4, dist: { 4: 1, 6: 2 } }));
      check('validateStats：正しい値はそのまま（dist は欠けた段を 0 で補う）', v.played === 5 && v.wins === 3 && v.best === 4 && v.dist['4'] === 1 && v.dist['6'] === 2 && v.dist['1'] === 0);
      const sNG = {
        'played が負': { played: -1, wins: 0, best: null }, 'wins が played より多い': { played: 1, wins: 2, best: null }, 'played が小数': { played: 1.5, wins: 0, best: null },
        'played が文字': { played: '3', wins: 0, best: null }, 'best が 0': { played: 3, wins: 2, best: 0 }, 'best が 11': { played: 3, wins: 2, best: 11 }, '勝ち0回なのに best がある': { played: 3, wins: 0, best: 3 },
        'dist の段が 11': { played: 3, wins: 2, best: 3, dist: { 11: 1 } }, 'dist の合計が wins より多い': { played: 3, wins: 1, best: 3, dist: { 3: 2 } }, 'dist が配列': { played: 3, wins: 1, best: 3, dist: [1] },
        'dist の値が負': { played: 3, wins: 1, best: 3, dist: { 3: -1 } }, '配列': [], '文字列': 'x', '10億超え': { played: 1e9 + 1, wins: 0, best: null },
      };
      const sBad = Object.entries(sNG).filter(([, x]) => !eq(L.validateStats(x), init)).map(([k]) => k);
      check(`validateStats：壊れた ${Object.keys(sNG).length} 種はすべて初期値に戻る`, sBad.length === 0, sBad);
      const f = L.validateStats({ played: 1e9, wins: 1e9, best: 1, dist: { 1: 1e9 } });
      check('validateStats：境界 played=wins=10億・best=1 は受け入れ、best=10 も受け入れ', f.played === 1e9 && f.wins === 1e9 && f.best === 1 && L.validateStats({ played: 1, wins: 1, best: 10, dist: { 10: 1 } }).best === 10);
      const dOK = { date: '2026-10-17', done: true, win: true, tries: 3 };
      const dNG = { 'null': null, '日付が実在しない': { ...dOK, date: '2026-13-01' }, '日付の形': { ...dOK, date: '2026/10/17' }, 'tries が 11': { ...dOK, tries: 11 }, 'tries が負': { ...dOK, tries: -1 }, 'tries が小数': { ...dOK, tries: 2.5 }, 'win なのに done でない': { ...dOK, done: false }, 'win なのに tries 0': { ...dOK, tries: 0 }, 'done の型': { ...dOK, done: 'yes' }, '負けで tries が10でない': { date: '2026-10-17', done: true, win: false, tries: 5 } };
      const dBad = Object.entries(dNG).filter(([, x]) => L.validateDaily(x) !== null).map(([k]) => k);
      check(`validateDaily：正しい記録（勝ち・10回目の勝ち・負け・途中）は受け入れ、壊れた ${Object.keys(dNG).length} 種は null`,
        dBad.length === 0 && eq(L.validateDaily(dOK), dOK) && L.validateDaily({ ...dOK, tries: 10 }) !== null && L.validateDaily({ date: '2026-10-17', done: true, win: false, tries: 10 }) !== null && L.validateDaily({ date: '2026-10-17', done: false, win: false, tries: 2 }) !== null, dBad);
      // 端末の時計を進めて遊んだあと戻した場合：today より未来の日付は受け付けない（today を渡したときだけ。同じ日と過去は受け入れる）
      const fut = (date) => L.validateDaily({ ...dOK, date }, '2026-10-18');
      check('validateDaily(x, today)：today より未来の日付は null、today と過去は受け入れる（today を渡さなければ従来どおり）、today が不正なら比べない', fut('2026-10-19') === null && fut('2027-01-01') === null && fut('2026-10-18') !== null && fut('2026-10-17') !== null && fut('2025-12-31') !== null && L.validateDaily({ ...dOK, date: '2026-10-19' }) !== null && L.validateDaily({ ...dOK, date: '2026-10-19' }, 'x') !== null, { f19: fut('2026-10-19'), f18: fut('2026-10-18') });
    },
  },
  {
    id: 'I9', tier: 'smoke', node: true, title: 'いろコード：静的検査（読み込み順・オフライン一覧・メニューのリンク・効果音の名前・ダークパターンなし）',
    run({ check, root }) {
      const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
      const html = read('games/irocode/index.html'), menu = read('index.html'), logic = read('games/irocode/logic.js');
      check('メニューに「いろコード」のカード（games/irocode/）', /games\/irocode\//.test(menu) && /いろコード/.test(menu));
      const files = swInfo(root).files;
      check('sw.js の事前キャッシュに ./games/irocode/・index.html・logic.js（なければオフラインで開かない）', ['./games/irocode/', './games/irocode/index.html', './games/irocode/logic.js'].every((f) => files.includes(f)), files);
      const iLogic = html.indexOf('<script src="logic.js"></script>'), iSfx = html.indexOf('<script src="../../common/sfx.js"></script>'), iMain = html.indexOf('<script>');
      check('logic.js と ../../common/sfx.js を本体のスクリプトより前に読み込む', iLogic > 0 && iSfx > 0 && iMain > Math.max(iLogic, iSfx), { iLogic, iSfx, iMain });
      check('viewport-fit=cover・manifest・apple-touch-icon・ホーム画面名「ゆびあそび」を相対パスで参照', /viewport-fit=cover/.test(html) && html.includes('rel="manifest" href="../../manifest.webmanifest"') && html.includes('rel="apple-touch-icon" href="../../icons/apple-touch-icon.png"') && /apple-mobile-web-app-title" content="ゆびあそび"/.test(html) && !/(href|src)="\//.test(html));
      check('<title> に「いろコード」', /<title>[^<]*いろコード[^<]*<\/title>/.test(html));
      const sandbox = { localStorage: { getItem: () => null, setItem() {} }, navigator: {} };
      sandbox.globalThis = sandbox; vm.createContext(sandbox); vm.runInContext(read('common/sfx.js'), sandbox);
      const names = sandbox.YubiSfx.create('irocode').names || [];
      check('効果音 "irocode" に start, place, remove, submit, hint, win, lose, best, toggle がある', ['start', 'place', 'remove', 'submit', 'hint', 'win', 'lose', 'best', 'toggle'].every((n) => names.includes(n)), names);
      const dark = /Notification|requestPermission|pushManager|ログインボーナス|連続\s*\d*\s*日|れんぞく\s*\d*\s*日|streak/i;
      check('ダークパターンなし：通知・連続日数・ログインボーナス・streak の記述がない（画面・ロジック）', !dark.test(html) && !dark.test(logic), [html, logic].map((s) => (s.match(dark) || [])[0]));
      check('外部ライブラリ・外部画像の読み込みなし（Google Fonts 以外の https の src/href がない）', !/(?:src|href)="https?:\/\/(?!fonts\.(?:googleapis|gstatic)\.com)/.test(html));
    },
  },

  // ================= 画面（smoke） =================
  {
    id: 'I4', tier: 'smoke', title: 'いろコード：基本操作（色を置く→決める→●○が出る→勝ち・負けの結果カード、答えの表示、もう一度）',
    async run({ browser, check, root }) {
      const L = loadLogic(root);
      const { ctx, page } = await open(browser, 'I4');
      const info = await page.evaluate(() => ({
        slots: document.querySelectorAll('#slots .slot').length, pal: [...document.querySelectorAll('#palette button')].map((b) => b.dataset.color), submitOff: document.querySelector('#submit').disabled,
        back: document.querySelector('a#back')?.getAttribute('href'),
      }));
      check('最初の画面：枠4つ・色ボタン0〜5の6つ・「決める」は押せない・← メニューは ../../ へ', info.slots === 4 && eq(info.pal, ['0', '1', '2', '3', '4', '5']) && info.submitOff && info.back === '../../', info);
      await goPractice(page);
      const s0 = await getState(page);
      check('れんしゅう：新しい問題（mode practice・hard false・rows 0・done null・答えは0〜5の4つで重複なし）', s0.mode === 'practice' && !s0.hard && s0.rows.length === 0 && s0.done === null && s0.secret.length === 4 && new Set(s0.secret).size === 4, s0);
      const tl0 = await page.evaluate(() => document.querySelector('#triesLeft').textContent);
      check('残り回数の表示に 10 が含まれる', /10/.test(tl0), tl0);
      await fill(page, [0, 1]);
      const mid = await page.evaluate(() => ({ off: document.querySelector('#submit').disabled, cols: [...document.querySelectorAll('#slots .slot')].map((s) => s.dataset.color ?? null) }));
      check('2つ置いた：枠0・1に色（data-color）、「決める」はまだ押せない', mid.off && eq(mid.cols, ['0', '1', null, null]), mid);
      await fill(page, [2, 3]);
      check('4つそろうと「決める」が押せる、状態の cur も同じ', await page.evaluate(() => !document.querySelector('#submit').disabled) && eq((await getState(page)).cur, [0, 1, 2, 3]));
      await page.locator('#submit').tap(); await wait(page, 700);
      const s1 = await getState(page), rows1 = await rowsOf(page);
      const want = L.score([0, 1, 2, 3], s1.secret);
      check('決めた：履歴が1行、data-hit・data-blow が logic の score と同じ、枠は空に戻る、状態の rows と一致', rows1.length === 1 && rows1[0].hit === want.hit && rows1[0].blow === want.blow && s1.rows.length === 1 && s1.rows[0].hit === want.hit && s1.rows[0].blow === want.blow && s1.cur.length === 0 && eq(s1.rows[0].g, [0, 1, 2, 3]), { rows1, want, s1 });
      check('残り回数が 9 回に減る', /9/.test(await page.evaluate(() => document.querySelector('#triesLeft').textContent)));
      // 勝つ（2回目）
      await guess(page, s1.secret);
      const w = await cardInfo(page), sw = await getState(page);
      check('正解：結果カードが出る（done win）、答えが .answer の色に出る、「もう一度」「メニューへ」がある', await overlayShown(page) && sw.done === 'win' && eq(w.answer, s1.secret) && w.cmds.includes('again') && w.cmds.includes('menu'), { w, done: sw.done });
      const rows2 = await rowsOf(page);
      check('履歴が2行、最後の行は hit=4・blow=0', rows2.length === 2 && eq(rows2.at(-1), { hit: 4, blow: 0 }), rows2);
      const stats1 = await lsGet(page, 'irocode.stats');
      check('結果が保存される：irocode.stats は played 1・wins 1・best 2・dist[2]=1（検証を通る）', stats1 && stats1.played === 1 && stats1.wins === 1 && stats1.best === 2 && stats1.dist['2'] === 1 && eq(L.validateStats(stats1), stats1), stats1);
      const primary = await page.evaluate(() => { const b = document.querySelector('#overlay [data-cmd=again]'); const c = document.querySelector('#overlay .card'); const rb = b.getBoundingClientRect(), rc = c.getBoundingClientRect(); return { primary: /primary/.test(b.className), wide: rb.width / rc.width }; });
      check('「もう一度」は主ボタンで横幅いっぱい（カード幅の 80% 以上）', primary.primary && primary.wide >= 0.8, primary);
      await page.locator('#overlay [data-cmd=again]').tap(); await wait(page, 400);
      const sn = await getState(page);
      check('もう一度：結果カードが閉じ、新しい問題（rows 0・done null・れんしゅうのまま）で、枠が空', !(await overlayShown(page)) && sn.rows.length === 0 && sn.done === null && sn.mode === 'practice' && (await page.evaluate(() => [...document.querySelectorAll('#slots .slot')].every((s) => s.dataset.color === undefined))), sn);
      // 負ける：10回
      for (let i = 0; i < 10; i++) await guess(page, wrong(sn.secret, i));
      const lo = await cardInfo(page), sl = await getState(page);
      check('10回はずれ：負けの結果カード（done lose、rows 10）で、答えが表示される', await overlayShown(page) && sl.done === 'lose' && sl.rows.length === 10 && eq(lo.answer, sn.secret), { lo, rows: sl.rows.length });
      const stats2 = await lsGet(page, 'irocode.stats');
      check('負けも記録される：played 2・wins 1・best 2 のまま', stats2 && stats2.played === 2 && stats2.wins === 1 && stats2.best === 2, stats2);
      await ctx.close();
    },
  },
  {
    id: 'I5', tier: 'smoke', title: 'いろコード：データが消えない（途中経過・結果・ベストの保存、再読み込み、壊れた保存データ）',
    async run({ browser, check, root }) {
      const L = loadLogic(root);
      const st = makeState(L, { mode: 'practice', seed: 31337 }, [[0, 1, 2, 3], [1, 2, 3, 4], [2, 3, 4, 5]], [4, 5]);
      const { ctx, page } = await open(browser, 'I5', { state: st, stats: { played: 4, wins: 3, best: 5, dist: { 5: 2, 7: 1 } } });
      const g = await getState(page), rows = await rowsOf(page);
      check('途中経過の復元：3行・置きかけの2色・同じ答え・同じモード', g.rows.length === 3 && eq(g.cur, [4, 5]) && eq(g.secret, st.secret) && g.mode === 'practice' && rows.length === 3 && eq(rows.map((r) => [r.hit, r.blow]), st.rows.map((r) => [r.hit, r.blow])), { g, rows });
      await fill(page, [0, 1]);
      await page.reload(); await wait(page, 300);
      const g2 = await getState(page);
      check('操作のたびに保存される：置いた色が再読み込みで残る（cur 4つ）、行数も同じ', eq(g2.cur, [4, 5, 0, 1]) && g2.rows.length === 3, g2);
      const saved = await lsGet(page, 'irocode.state');
      check('保存された irocode.state は logic の検証を通る', saved && eq(L.validateState(saved), saved), saved);
      await ctx.close();
      // 勝って保存 → 再読み込みでも記録は消えない／二重に数えない
      const w = await open(browser, 'I5b', { state: makeState(L, { mode: 'practice', seed: 555 }), stats: { played: 4, wins: 3, best: 5, dist: { 5: 2, 7: 1 } } });
      await guess(w.page, (await getState(w.page)).secret);
      const afterWin = await lsGet(w.page, 'irocode.stats');
      check('1回で勝つ：played 5・wins 4・best 1（これまでの 5 より良いので更新）・dist[1]=1、既存の dist[5]=2・dist[7]=1 は残る', afterWin && afterWin.played === 5 && afterWin.wins === 4 && afterWin.best === 1 && afterWin.dist['1'] === 1 && afterWin.dist['5'] === 2 && afterWin.dist['7'] === 1, afterWin);
      await w.page.reload(); await wait(w.page, 300);
      const again = await lsGet(w.page, 'irocode.stats'), gs = await getState(w.page);
      check('再読み込みしても記録は変わらない（二重に数えない）、終わった問題は終わったまま（done win）', eq(again, afterWin) && gs.done === 'win', { again, done: gs.done });
      // 悪い成績ではベストを下げない
      const b556 = L.newGame({ mode: 'practice', seed: 556 });
      const st3 = makeState(L, { mode: 'practice', seed: 556 }, Array.from({ length: 5 }, (_, i) => wrong(b556.secret, i)));
      await seed(w.page, { 'irocode.state': st3, 'irocode.stats': { played: 4, wins: 3, best: 2, dist: { 2: 1, 5: 2 } } });
      await w.page.goto(IRO); await wait(w.page, 300); await closeHelp(w.page);
      await guess(w.page, st3.secret);
      const noWorse = await lsGet(w.page, 'irocode.stats');
      check('6回目で勝ってもベスト（2回）は下がらない、dist[6] が増える', noWorse && noWorse.best === 2 && noWorse.dist['6'] === 1 && noWorse.wins === 4, noWorse);
      await w.ctx.close();
      // 壊れた保存データ（読めない・検証に通らない）でも開けて遊べる
      const BAD = [['JSON でない', 'こわれた{'], ['null', 'null'], ['配列', '[1,2]'], ['rows が多すぎる', JSON.stringify({ ...st, rows: [...st.rows, ...st.rows, ...st.rows, ...st.rows] })], ['答えが色6', JSON.stringify({ ...st, secret: [6, 1, 2, 3] })], ['v が違う', JSON.stringify({ ...st, v: 9 })]];
      const { ctx: c2, page: p2 } = await open(browser, 'I5c');
      const res = [];
      for (const [name, raw] of BAD) {
        await seed(p2, { 'irocode.state': raw, 'irocode.stats': raw, 'irocode.daily': raw });
        await p2.goto(IRO); await wait(p2, 300); await closeHelp(p2);
        const gg = await getState(p2).catch(() => null);
        const ok = !!gg && L.validateState(JSON.parse(JSON.stringify(gg))) !== null;
        if (gg) await fill(p2, [0]);
        res.push({ name, ok, placed: !!gg && (await getState(p2)).cur.length >= 1 });
      }
      check('壊れた保存データ6種（state・stats・daily に同じものを入れる）でも開けて、有効な問題から始まり、色を置ける', res.every((r) => r.ok && r.placed), res);
      await c2.close();
    },
  },
  {
    id: 'I6', tier: 'smoke', title: 'いろコード：メニューへ戻れる（← メニュー・結果カード・遊び方）、戻っても途中経過は残る',
    async run({ browser, check, root }) {
      const L = loadLogic(root);
      const { ctx, page } = await open(browser, 'I6');
      await goPractice(page);
      await fill(page, [0, 1, 2]);
      const before = await getState(page);
      await page.locator('a#back').tap(); await page.waitForURL(BASE);
      check('途中でも「← メニュー」でメニューに戻れる', page.url() === BASE && await page.locator('a.game').count() >= 3);
      const savedMid = await lsGet(page, 'irocode.state');
      check('メニューに戻っても途中経過は残る（置いた3色）', savedMid && eq(savedMid.cur, [0, 1, 2]) && eq(savedMid.secret, before.secret), savedMid);
      await page.locator('a.game[href*="irocode"]').tap(); await page.waitForURL(IRO); await wait(page, 300);
      check('メニューのカードからもう一度入ると続きから（置いた3色が残る）', eq((await getState(page)).cur, [0, 1, 2]));
      // 遊び方
      await page.locator('#helpBtn').tap(); await wait(page, 400);
      const help = await cardInfo(page), hb = await cardReach(page);
      check('「遊び方」でカードが出て、ボタンがあり画面内に収まる', await overlayShown(page) && help.text.length > 10 && hb.length >= 1 && hb.every((b) => b.inside), { help, hb });
      const closer = hb.find((b) => b.cmd && b.cmd !== 'menu') || hb[0];
      if (closer.cmd) await page.locator(`#overlay [data-cmd="${closer.cmd}"]`).tap(); else await page.locator('#overlay .card button').first().tap();
      await wait(page, 200);
      check('遊び方カードは閉じられて遊びに戻る', !(await overlayShown(page)), closer);
      // 結果カード（勝ち）からメニューへ
      await seed(page, { 'irocode.state': makeState(L, { mode: 'practice', seed: 77 }), 'irocode.stats': null }, { clear: false });
      await page.goto(IRO); await wait(page, 300); await closeHelp(page);
      await guess(page, (await getState(page)).secret);
      await page.locator('#overlay [data-cmd=menu]').tap(); await page.waitForURL(BASE);
      check('勝ったあとの結果カードの「メニューへ」でメニューに戻る', page.url() === BASE);
      // 負けカード
      const base = L.newGame({ mode: 'practice', seed: 88 });
      await seed(page, { 'irocode.state': makeState(L, { mode: 'practice', seed: 88 }, Array.from({ length: 9 }, (_, i) => wrong(base.secret, i))) }, { clear: false });
      await page.goto(IRO); await wait(page, 300); await closeHelp(page);
      await guess(page, wrong(base.secret, 9));
      const lose = await cardInfo(page);
      check('負けたあとの結果カードに「もう一度」「メニューへ」', lose.cmds.includes('again') && lose.cmds.includes('menu'), lose);
      await page.locator('#overlay [data-cmd=menu]').tap(); await page.waitForURL(BASE);
      check('負けカードの「メニューへ」でメニューに戻る', page.url() === BASE);
      // 結果カードが出たままの再読み込み：カードの有無に関わらず、← メニューが押せる
      await page.goto(IRO); await wait(page, 300); await closeHelp(page);
      await page.evaluate(() => document.querySelector('a#back').click()).catch(() => {});
      await page.waitForURL(BASE, { timeout: 3000 }).catch(() => {});
      check('終わった問題を開き直しても、メニューへ戻れる状態（カードの「メニューへ」か ← メニュー）', page.url() === BASE || (await cardInfo(page)).cmds.includes('menu'), page.url());
      await ctx.close();
    },
  },
  {
    id: 'I7', tier: 'smoke', title: 'いろコード：ボタンが画面内・44px 以上・横スクロールなし（最も狭い縦／最も低い横、結果カードのボタンにも届く）',
    async run({ browser, check, root }) {
      const L = loadLogic(root);
      const base = L.newGame({ mode: 'practice', seed: 9001 });
      const nine = makeState(L, { mode: 'practice', seed: 9001 }, Array.from({ length: 9 }, (_, i) => wrong(base.secret, i)));
      for (const v of [view('SE', 'p', 'app'), view('SE', 'l', 'safari')]) {
        const { ctx, page } = await open(browser, 'I7 ' + v.label, { v, state: nine });
        const pr = await layoutProbe(page, BTNS + ', #slots .slot', v.safe, { minSel: BTNS });
        check(`${v.label}：主要ボタン・枠が画面内（safe-area 内）、ボタンは 44px 以上、横スクロールなし（${pr.n} 個）`, pr.n >= 14 && !pr.outside.length && !pr.small.length && !pr.hscroll, pr);
        const rowsFit = await page.evaluate(() => [...document.querySelectorAll('#rows .row')].every((r) => r.getBoundingClientRect().right <= innerWidth + 0.5 && r.getBoundingClientRect().left >= -0.5));
        check(`${v.label}：9行の履歴が横にはみ出さない`, rowsFit);
        // 9行そろった状態から最後の1手で負け → 結果カード。10行ぶんの履歴と答えがあってもボタンに届く
        await guess(page, wrong(base.secret, 9));
        const reach = await cardReach(page), ci = await cardInfo(page);
        check(`${v.label}：負けの結果カード（10行・答え表示）の全ボタンに届き、44px 以上、横スクロールなし`,
          reach.length >= 2 && reach.every((b) => b.inside && b.h >= 44 && b.w >= 44) && ci.answer.length === 4 && !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), reach);
        await ctx.close();
      }
    },
  },
  {
    id: 'I8', tier: 'smoke', title: 'いろコード：オフラインで開いて遊べる（Service Worker）。メニューから入れる',
    async run({ browser, check, srv, root }) {
      const info = swInfo(root);
      srv.reset();
      const { ctx, page } = await newPage(browser, custom(390, 664, null, 'iPhone 13 Safari'), 'I8', { sw: true });
      await page.goto(BASE);
      const ready = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]));
      if (!ready) throw new Error('Service Worker が 8 秒以内に有効にならない');
      if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }); }
      await sleep(200);
      const cached = await page.evaluate(async (app) => { const c = await caches.open(app); return (await c.keys()).map((r) => new URL(r.url).pathname); }, info.app);
      check('キャッシュに games/irocode/ と index.html と logic.js が入っている', ['/game-no1/games/irocode/', '/game-no1/games/irocode/index.html', '/game-no1/games/irocode/logic.js'].every((p) => cached.includes(p)), cached.filter((p) => /irocode/.test(p)));
      await srv.ctl('offline=1');
      const resp = [];
      page.on('response', (r) => { if (/\/(sfx|logic)\.js$/.test(r.url())) resp.push({ u: r.url().split('/').slice(-2).join('/'), sw: r.fromServiceWorker(), status: r.status() }); });
      await page.goto(BASE);
      await page.locator('a.game[href*="irocode"]').click(); await page.waitForURL(IRO); await sleep(200); await closeHelp(page);
      const o = await page.evaluate(() => ({ t: document.title, pal: document.querySelectorAll('#palette button').length, logic: typeof window.IroCodeLogic?.score, sfx: typeof window.YubiSfx?.create, game: typeof window.IroCodeGame?.getState }));
      check('オフライン：メニューのカードから入れる。タイトル・色ボタン6つ・logic.js・sfx.js・IroCodeGame が使える', /いろコード/.test(o.t) && o.pal === 6 && o.logic === 'function' && o.sfx === 'function' && o.game === 'function', o);
      check('オフライン：logic.js・sfx.js は Service Worker のキャッシュから読まれた', resp.length >= 2 && resp.every((r) => r.sw && r.status === 200), resp);
      await page.locator('#modePractice').click(); await sleep(150);
      for (const c of [0, 1, 2, 3]) await page.locator(`#palette button[data-color="${c}"]`).click();
      await page.locator('#submit').click(); await sleep(900);
      check('オフラインのまま 4色を置いて決められ、履歴に1行出る', (await page.evaluate(() => document.querySelectorAll('#rows .row').length)) === 1);
      await page.locator('a#back').click(); await page.waitForURL(BASE);
      check('オフラインのまま「← メニュー」で戻れる', page.url() === BASE);
      await page.goto(IRO + 'index.html?from=home'); await sleep(200);
      check('オフライン：index.html・クエリ付きでも開く', await page.locator('#palette button').count() === 6);
      await srv.ctl('offline=0');
      await ctx.close();
    },
  },

  // ================= 画面（full） =================
  {
    id: 'I10', tier: 'full', title: 'いろコード：境界値（10回目で勝ち／負け、むずかしい8回、重複のある答え、ベスト更新の境目）',
    async run({ browser, check, root }) {
      const L = loadLogic(root);
      const norm = (seedN, n) => { const b = L.newGame({ mode: 'practice', seed: seedN }); return { b, rows: Array.from({ length: n }, (_, i) => wrong(b.secret, i)) }; };
      // 10回目ちょうどで勝つ → 勝ち（負けではない）
      let { b, rows } = norm(1001, 9);
      let o = await open(browser, 'I10a', { state: makeState(L, { mode: 'practice', seed: 1001 }, rows), stats: { played: 0, wins: 0, best: null, dist: {} } });
      check('9回はずれ → 残り回数に 1 が出る', /1/.test(await o.page.evaluate(() => document.querySelector('#triesLeft').textContent)));
      await guess(o.page, b.secret);
      let s = await getState(o.page), st = await lsGet(o.page, 'irocode.stats');
      check('10回目で正解 → 勝ち（done win）。stats は best 10・dist[10]=1・wins 1', s.done === 'win' && s.rows.length === 10 && st.best === 10 && st.dist['10'] === 1 && st.wins === 1, { done: s.done, st });
      await o.ctx.close();
      ({ b, rows } = norm(1002, 9));
      o = await open(browser, 'I10b', { state: makeState(L, { mode: 'practice', seed: 1002 }, rows) });
      await guess(o.page, wrong(b.secret, 9));
      s = await getState(o.page);
      check('10回目もはずれ → 負け（done lose）。履歴は10行を超えない', s.done === 'lose' && s.rows.length === 10, s);
      await o.page.evaluate(() => { for (const c of [0, 1, 2, 3]) document.querySelector(`#palette button[data-color="${c}"]`).click(); document.querySelector('#submit').click(); });
      await wait(o.page, 500);
      const after = await getState(o.page);
      check('終わった後に（プログラムから）色を押しても決めても、行は増えない・cur に溜まらない', after.rows.length === 10 && after.cur.length === 0, after);
      await o.ctx.close();
      // むずかしい：8回
      const hd = L.newGame({ mode: 'practice', hard: true, seed: 2002 });
      o = await open(browser, 'I10c', { state: makeState(L, { mode: 'practice', hard: true, seed: 2002 }, Array.from({ length: 7 }, (_, i) => wrong(hd.secret, i))) });
      check('むずかしい：aria-pressed が true、残り回数に 1 が出る', (await o.page.locator('#hardToggle').getAttribute('aria-pressed')) === 'true' && /1/.test(await o.page.evaluate(() => document.querySelector('#triesLeft').textContent)));
      await guess(o.page, wrong(hd.secret, 7));
      s = await getState(o.page);
      check('むずかしい：8回目ではずれると負け（10回ではない）', s.done === 'lose' && s.rows.length === 8 && s.hard === true, s);
      await o.ctx.close();
      // むずかしい：同じ色が重なった答えの hit/blow を画面で確認
      let dupSeed = null; for (let i = 1; i < 5000 && dupSeed === null; i++) if (new Set(L.newGame({ mode: 'practice', hard: true, seed: i }).secret).size === 2) dupSeed = i;
      const dg = L.newGame({ mode: 'practice', hard: true, seed: dupSeed });
      o = await open(browser, 'I10d', { state: makeState(L, { mode: 'practice', hard: true, seed: dupSeed }) });
      const probe = [dg.secret[0], dg.secret[0], dg.secret[0], dg.secret[0]];
      await guess(o.page, probe);
      const want = L.score(probe, dg.secret), got = (await rowsOf(o.page))[0];
      check('むずかしい：同じ色4つの推測でも hit/blow が score と同じ（重複を数え過ぎない）', got.hit === want.hit && got.blow === want.blow && want.hit + want.blow <= 4, { got, want, secret: dg.secret });
      await guess(o.page, dg.secret);
      check('むずかしい：同じ色ありの答えを当てると勝ち', (await getState(o.page)).done === 'win');
      await o.ctx.close();
      // むずかしいの切り替え
      o = await open(browser, 'I10e');
      await goPractice(o.page);
      const t0 = await o.page.locator('#hardToggle').getAttribute('aria-pressed');
      await o.page.locator('#hardToggle').tap(); await wait(o.page, 400);
      const t1 = await o.page.locator('#hardToggle').getAttribute('aria-pressed'), g1 = await getState(o.page);
      await o.page.locator('#hardToggle').tap(); await wait(o.page, 400);
      const t2 = await o.page.locator('#hardToggle').getAttribute('aria-pressed'), g2 = await getState(o.page);
      check('むずかしいの切り替え：false→true→false。切り替えるたびに hard が追従し、ふつうは重複なし', t0 === 'false' && t1 === 'true' && g1.hard === true && t2 === 'false' && g2.hard === false && new Set(g2.secret).size === 4, { t0, t1, t2, h1: g1.hard, h2: g2.hard });
      await o.ctx.close();
      // ベストの境目：同じ回数なら変わらず、1少なければ更新
      for (const [tries, name] of [[4, '同じ 4 回'], [3, '1回少ない 3 回']]) {
        const bb = L.newGame({ mode: 'practice', seed: 3000 + tries });
        o = await open(browser, 'I10f', { state: makeState(L, { mode: 'practice', seed: 3000 + tries }, Array.from({ length: tries - 1 }, (_, i) => wrong(bb.secret, i))), stats: { played: 2, wins: 2, best: 4, dist: { 4: 2 } } });
        await guess(o.page, bb.secret);
        const sx = await lsGet(o.page, 'irocode.stats');
        check(`ベスト 4 回のとき ${name} で勝つと best は ${tries}`, sx.best === tries && sx.dist[String(tries)] === (tries === 4 ? 3 : 1), sx);
        await o.ctx.close();
      }
      // 「やり直す」（#restartBtn・data-cmd=restart）
      const rs = (page) => page.locator('#restartBtn');
      // (3) cur だけ：確認なしで消える
      o = await open(browser, 'I10r1', { state: makeState(L, { mode: 'practice', seed: 6001 }, [], [0, 1]) });
      const rsOn = await rs(o.page).isDisabled();
      const before = await getState(o.page);
      await rs(o.page).tap(); await wait(o.page, 500);
      let g = await getState(o.page);
      check('やり直す(3)：置きかけ(cur)だけのときは押せて、確認カードなしで枠が空になる', !rsOn && !(await overlayShown(o.page)) && g.cur.length === 0 && g.rows.length === 0, { rsOn, shown: await overlayShown(o.page), cur: g.cur });
      check('やり直す(3)：新しい問題になるわけではない（rows 0・done null・れんしゅうのまま）', g.mode === 'practice' && g.done === null && before.mode === 'practice', g);
      // 何もない状態では押せない
      check('やり直す：rows も cur も空のときは押せない（disabled）', await rs(o.page).isDisabled());
      await o.ctx.close();
      // (1) れんしゅう：rows があると確認カード→やり直すで新しい問題
      const rsSt = makeState(L, { mode: 'practice', seed: 6002 }, [[0, 1, 2, 3], [1, 2, 3, 4]]);
      o = await open(browser, 'I10r2', { state: rsSt });
      await rs(o.page).tap(); await wait(o.page, 400);
      let card = await cardInfo(o.page);
      check('やり直す(1)：れんしゅうで rows があると確認カード（confirm・cancel）が出て、まだ問題は変わらない', await overlayShown(o.page) && card.cmds.includes('confirm') && card.cmds.includes('cancel') && (await getState(o.page)).rows.length === 2 && eq((await getState(o.page)).secret, rsSt.secret), card);
      await o.page.locator('#overlay [data-cmd=cancel]').tap(); await wait(o.page, 400);
      check('やり直す：やめる(cancel)で閉じ、履歴2行のまま', !(await overlayShown(o.page)) && (await getState(o.page)).rows.length === 2);
      await rs(o.page).tap(); await wait(o.page, 400);
      await o.page.locator('#overlay [data-cmd=confirm]').tap(); await wait(o.page, 500);
      g = await getState(o.page);
      check('やり直す(1)：確定するとれんしゅうは新しい問題（rows 0・cur 空・done null・seed がちがう）', !(await overlayShown(o.page)) && g.mode === 'practice' && g.rows.length === 0 && g.cur.length === 0 && g.done === null && g.seed !== rsSt.seed, { seed: g.seed, old: rsSt.seed, rows: g.rows.length });
      check('やり直す(1)：保存も新しい問題になっている（irocode.state の seed が一致・検証を通る）', await (async () => { const sv = await lsGet(o.page, 'irocode.state'); return sv && sv.seed === g.seed && sv.rows.length === 0 && eq(L.validateState(sv), sv); })());
      await o.ctx.close();
      // (2) 今日の1問：rows が1つ以上あるとやり直せない（記録の改ざん防止）。cur だけなら消せる
      const NOW = zonedTime('Asia/Tokyo', 2026, 10, 18, 12, 0, 0);      // ページの時計をこの時刻に固定する（実際の「いま」と比べない）
      const todayS = '2026-10-18';      // 固定した時刻の、東京での日付
      const dsd = L.newGame({ mode: 'daily', date: todayS });
      const dst = makeState(L, { mode: 'daily', date: todayS }, [wrong(dsd.secret, 0), wrong(dsd.secret, 1)]);
      o = await open(browser, 'I10r3', { state: dst, opts: { clockTime: NOW, timezoneId: 'Asia/Tokyo' } });
      const gd0 = await getState(o.page);
      if (gd0.mode === 'daily' && gd0.date === dst.date) {
        check('やり直す(2)：今日の1問で rows が1つ以上あるとき「やり直す」は押せない（disabled）', await rs(o.page).isDisabled(), gd0.rows.length);
        await rs(o.page).dispatchEvent('click').catch(() => {}); await wait(o.page, 400);
        const gd = await getState(o.page), dl = await lsGet(o.page, 'irocode.daily');
        check('やり直す(2)：無理に click しても履歴は消えず（rows 2・同じ答え）、確認カードも出ず、daily の記録も書かれない', gd.rows.length === 2 && eq(gd.secret, dst.secret) && !(await overlayShown(o.page)) && (dl === null || dl.done !== true), { rows: gd.rows.length, dl });
      } else {
        check('やり直す(2)：今日の1問の状態を注入できる（ページの今日の日付でないと前日扱いで捨てられる）', false, gd0);
      }
      await o.ctx.close();
      // 終わったあとはやり直せない（結果カードを閉じても disabled）
      const wst = makeState(L, { mode: 'practice', seed: 6003 }, [], []);
      o = await open(browser, 'I10r4', { state: wst });
      await guess(o.page, wst.secret);
      check('やり直す：勝って終わった問題では押せない（disabled）、記録が増えない', await rs(o.page).isDisabled() && (await lsGet(o.page, 'irocode.stats')).played === 1);
      await o.ctx.close();
    },
  },
  {
    id: 'I11', tier: 'full', title: 'いろコード：色覚配慮（6色すべてに記号、枠・履歴・答えにも、●と○を形でも区別、記号のコントラスト）',
    async run({ browser, check, root }) {
      const L = loadLogic(root);
      const { ctx, page } = await open(browser, 'I11', { state: makeState(L, { mode: 'practice', seed: 4040 }, [[0, 1, 2, 3], [4, 5, 0, 1]], [5, 4]) });
      const pal = await page.evaluate(() => [...document.querySelectorAll('#palette button')].map((b) => ({ c: Number(b.dataset.color), text: b.textContent.trim(), label: b.getAttribute('aria-label') || '', bg: getComputedStyle(b).backgroundColor, fg: getComputedStyle(b).color })));
      const sym = L.COLORS.map((c) => c.symbol);
      check('色ボタン6つそれぞれが、logic の記号を文字として持つ（色だけに頼らない）', pal.length === 6 && pal.every((p) => p.text.includes(sym[p.c])) && new Set(pal.map((p) => p.text)).size === 6, pal);
      check('色ボタンにスクリーンリーダー用の名前（aria-label か文字）がある', pal.every((p) => (p.label || p.text).length >= 1), pal.map((p) => p.label));
      const slotsTxt = await page.evaluate(() => [...document.querySelectorAll('#slots .slot')].map((s) => ({ c: s.dataset.color ?? null, t: s.textContent.trim() })));
      check('置いた色の枠にも記号が出る（枠 0・1 が色5・色4）', slotsTxt[0].c === '5' && slotsTxt[0].t.includes(sym[5]) && slotsTxt[1].c === '4' && slotsTxt[1].t.includes(sym[4]) && slotsTxt[2].c === null, slotsTxt);
      const hist = await page.evaluate(() => [...document.querySelectorAll('#rows .row')].map((r) => [...r.querySelectorAll('.slot, .pegs > *')].map((s) => ({ c: s.dataset.color, t: s.textContent.trim() }))));
      check('履歴の各色にも記号が出る（行ごとに4つ）', hist.length === 2 && hist.every((r) => r.length === 4 && r.every((s) => s.t.includes(sym[Number(s.c)]))), hist);
      // 背景色と記号の色のコントラスト（WCAG 3:1 以上）。背景が透明なら飛ばす
      const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return p.length === 4 && p[3] === 0 ? null : p.slice(0, 3); };
      const low = pal.map((p) => { const bg = parse(p.bg), fg = parse(p.fg); if (!bg || !fg) return null; const a = lum(bg), b = lum(fg); return { c: p.c, ratio: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2) }; }).filter((x) => x && x.ratio < 3);
      check('色ボタンの記号と背景色のコントラストが 3:1 以上', low.length === 0, low);
      // ● と ○ の区別：ヒント部分（枠 .slot を除く）に、hit 個の ● と blow 個の ○（または形の違う2種類の印）
      const hint = await page.evaluate(() => [...document.querySelectorAll('#rows .row')].map((r) => {
        const cl = r.cloneNode(true); cl.querySelectorAll('.slot').forEach((s) => s.remove());
        const txt = cl.textContent + ' ' + [...cl.querySelectorAll('[aria-label],[title]')].map((e) => (e.getAttribute('aria-label') || '') + (e.getAttribute('title') || '')).join(' ');
        const hits = r.querySelectorAll('.hit, .peg.hit, [data-kind=hit]'), blows = r.querySelectorAll('.blow, .peg.blow, [data-kind=blow]');
        const shape = (e) => { const s = getComputedStyle(e); return `${s.backgroundColor}|${s.borderTopWidth}|${s.borderTopStyle}|${s.borderRadius}|${e.textContent.trim()}`; };
        return { h: Number(r.dataset.hit), b: Number(r.dataset.blow), dots: (txt.match(/●/g) || []).length, rings: (txt.match(/○/g) || []).length, hitEls: hits.length, blowEls: blows.length, hitShape: hits[0] ? shape(hits[0]) : null, blowShape: blows[0] ? shape(blows[0]) : null };
      }));
      const byText = hint.every((x) => x.dots === x.h && x.rings === x.b);
      const byShape = hint.every((x) => x.hitEls === x.h && x.blowEls === x.b) && hint.filter((x) => x.hitShape && x.blowShape).every((x) => x.hitShape !== x.blowShape);
      check('各行のヒントが「●が hit 個・○が blow 個」の文字、または形の違う2種類の印で出ている（色だけで区別しない）', byText || byShape, hint);
      // 答えの表示：負けカードの答えにも記号
      const bb = L.newGame({ mode: 'practice', seed: 4041 });
      await seed(page, { 'irocode.state': makeState(L, { mode: 'practice', seed: 4041 }, Array.from({ length: 9 }, (_, i) => wrong(bb.secret, i))) }, { clear: false });
      await page.goto(IRO); await wait(page, 300); await closeHelp(page);
      await guess(page, wrong(bb.secret, 9));
      const ans = await page.evaluate(() => [...document.querySelectorAll('#overlay .answer .slot')].map((s) => ({ c: Number(s.dataset.color), t: s.textContent.trim() })));
      check('結果カードの答えにも記号が出る', ans.length === 4 && ans.every((a) => a.t.includes(sym[a.c])) && eq(ans.map((a) => a.c), bb.secret), ans);
      await ctx.close();
    },
  },
  {
    id: 'I12', tier: 'full', title: 'いろコード：効果音（置く・外す・決める・ヒント・勝ち・負け・ベスト・始める。オフなら鳴らない）',
    async run({ browser, check, root }) {
      const L = loadLogic(root);
      const bb = L.newGame({ mode: 'practice', seed: 5050 });
      const mk = (n, stats) => open(browser, 'I12', { state: makeState(L, { mode: 'practice', seed: 5050 }, Array.from({ length: n }, (_, i) => wrong(bb.secret, i))), stats, opts: { initScript: SFX_SPY } });
      const take = (p) => p.evaluate(() => window.__plays.splice(0));
      let o = await mk(0, { played: 3, wins: 3, best: 3, dist: { 3: 3 } });
      await take(o.page);
      await fill(o.page, [0]);
      let pl = await take(o.page);
      check('色を置くと place が鳴る（登録済みの音名、音の部品が動く）', pl.some((p) => p.n === 'place' && p.known && p.d > 0), pl);
      await o.page.locator('#slots .slot[data-i="0"]').tap(); await wait(o.page, 400);
      pl = await take(o.page);
      const cur = (await getState(o.page)).cur;
      check('置いた枠を押すと外れて remove が鳴る', cur.length === 0 && pl.some((p) => p.n === 'remove' && p.known), { cur, pl });
      await fill(o.page, wrong(bb.secret, 0));
      await take(o.page);
      await o.page.locator('#submit').tap(); await wait(o.page, 900);
      pl = await take(o.page);
      const want = L.score(wrong(bb.secret, 0), bb.secret);
      check('決めると submit が鳴り、続いて hint が hit の数（引数）つきで鳴る。すべて登録済みの音名', pl.some((p) => p.n === 'submit') && pl.some((p) => p.n === 'hint' && p.a === want.hit) && pl.every((p) => p.known), { pl, want });
      await o.ctx.close();
      // 勝ち（ベスト更新あり）：win と best
      o = await mk(2, { played: 3, wins: 3, best: 5, dist: { 5: 3 } });
      await take(o.page);
      await guess(o.page, bb.secret); await wait(o.page, 800);   // best は結果カードの win のあとに鳴る
      pl = await take(o.page);
      check('3回目で勝つ（ベスト5回 → 3回）：win が1回、best が1回鳴る', pl.filter((p) => p.n === 'win').length === 1 && pl.filter((p) => p.n === 'best').length === 1 && pl.every((p) => p.known), pl);
      await o.ctx.close();
      o = await mk(5, { played: 3, wins: 3, best: 3, dist: { 3: 3 } });
      await take(o.page);
      await guess(o.page, bb.secret);
      pl = await take(o.page);
      check('6回目で勝つ（ベスト3回のまま）：win は鳴り、best は鳴らない', pl.some((p) => p.n === 'win') && !pl.some((p) => p.n === 'best'), pl);
      await o.ctx.close();
      o = await mk(9, { played: 0, wins: 0, best: null, dist: {} });
      await take(o.page);
      await guess(o.page, wrong(bb.secret, 9));
      pl = await take(o.page);
      check('10回目もはずれ：lose が1回鳴る（win・best は鳴らない）', pl.filter((p) => p.n === 'lose').length === 1 && !pl.some((p) => p.n === 'win' || p.n === 'best'), pl);
      await o.page.locator('#overlay [data-cmd=again]').tap(); await wait(o.page, 400);
      pl = await take(o.page);
      check('もう一度で start が鳴る', pl.some((p) => p.n === 'start'), pl);
      // ♪ オフ
      const before = await o.page.evaluate(() => window.__starts);
      await o.page.locator('#soundBtn').tap(); await wait(o.page, 400);
      const pressed = await o.page.locator('#soundBtn').getAttribute('aria-pressed'), store = await o.page.evaluate(() => localStorage.getItem('blockpuzzle.sound'));
      await take(o.page);
      await fill(o.page, [0, 1]);
      await o.page.locator('#slots .slot[data-i="1"]').tap(); await wait(o.page, 400);
      const afterN = await o.page.evaluate(() => window.__starts);
      pl = await take(o.page);
      check('♪ をオフ：aria-pressed が切り替わり、blockpuzzle.sound=off が保存され、操作しても音の部品が動かない', pressed !== null && store === 'off' && afterN === before && pl.every((p) => p.d === 0), { pressed, store, before, afterN, pl });
      await o.page.reload(); await wait(o.page, 300);
      check('再読み込みしてもオフのまま（aria-pressed は同じ）', (await o.page.locator('#soundBtn').getAttribute('aria-pressed')) === pressed);
      await o.page.locator('#soundBtn').tap(); await wait(o.page, 400);
      await take(o.page);
      await fill(o.page, [2]);
      pl = await take(o.page);
      check('♪ をオンに戻すと place が鳴る', pl.some((p) => p.n === 'place' && p.d > 0), pl);
      await o.ctx.close();
    },
  },
  {
    id: 'I13', tier: 'full', title: 'いろコード：ダブルタップ拡大・ピンチ・長押しメニュー・文字選択の抑止（既存ゲームの方式）',
    async run({ browser, check, root }) {
      const L = loadLogic(root);
      const TE = () => { window.__te = []; window.addEventListener('touchend', (e) => window.__te.push({ p: e.defaultPrevented, t: e.target.id || e.target.className || e.target.tagName })); };
      const { ctx, page } = await open(browser, 'I13', { v: custom(390, 664, null, 'iPhone 13 Safari'), opts: { initScript: TE } });
      await goPractice(page);
      const g = await page.evaluate(() => {
        const el = document.querySelector('#palette button');
        const d = el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        const gs = ['gesturestart', 'gesturechange'].map((n) => el.dispatchEvent(new Event(n, { bubbles: true, cancelable: true })));
        const cm = document.querySelector('#slots').dispatchEvent(new Event('contextmenu', { bubbles: true, cancelable: true }));
        return { dblclickPrevented: !d, gesturePrevented: gs.every((x) => !x), contextPrevented: !cm };
      });
      check('dblclick・gesturestart/gesturechange を止める（ピンチ・ダブルタップ拡大）、長押しメニュー（contextmenu）も止める', g.dblclickPrevented && g.gesturePrevented && g.contextPrevented, g);
      const css = await page.evaluate(() => {
        const cs = (e) => getComputedStyle(e);
        const p = document.querySelector('#palette button'), body = document.body, slot = document.querySelector('#slots .slot');
        return { tbody: cs(body).touchAction, tpal: cs(p).touchAction, selPal: cs(p).userSelect || cs(p).webkitUserSelect, selSlot: cs(slot).userSelect || cs(slot).webkitUserSelect, callout: cs(p).webkitTouchCallout || cs(body).webkitTouchCallout };
      });
      const manip = (t) => /manipulation|none|pan/.test(t);
      check('touch-action がダブルタップズームを許さない値（manipulation / none / pan-*）、ボタンと枠の文字選択は none', manip(css.tbody) && manip(css.tpal) && css.selPal === 'none' && css.selSlot === 'none', css);
      check('長押しの呼び出しメニュー（-webkit-touch-callout）を抑止（none。取得できない環境では飛ばす）', css.callout === undefined || css.callout === '' || css.callout === 'none', css);
      // 色ボタンを短い間隔で2回タップ：2回とも色として数えられ（拡大でなくタップ）、2回目の touchend は止められる
      await page.evaluate(() => window.__te.splice(0));
      // ふつうは入力中の同じ色を押せないので、隣り合う2色（1→2）をすばやく続けて押す
      const b = await page.locator('#palette button[data-color="1"]').boundingBox(), b2 = await page.locator('#palette button[data-color="2"]').boundingBox();
      await frozen(page, async () => {
        await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await wait(page, 80);
        await page.touchscreen.tap(b2.x + b2.width / 2, b2.y + b2.height / 2);
      });
      await page.waitForTimeout(80);
      const ev = await page.evaluate(() => window.__te.splice(0)), cur = (await getState(page)).cur;
      check('色ボタンの連続タップ（1→2）：2回目の touchend が止められ、2回とも色として数えられる（cur 2つ）', ev.length === 2 && ev[1].p === true && eq(cur, [1, 2]), { ev, cur });
      // 「決める」の連続タップで二重に決めない
      await fill(page, [3, 4]);
      const sb = await page.locator('#submit').boundingBox();
      await frozen(page, async () => {
        await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2); await wait(page, 60);
        await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2);
      });
      await wait(page, 900);
      const s = await getState(page);
      check('「決める」をすばやく2回タップしても、1手しか進まない（rows 1）', s.rows.length === 1, { rows: s.rows.length, cur: s.cur });
      await ctx.close();
      // 結果カードの「もう一度」を連続タップしても、新しい問題の枠に誤って色が入らない
      const bb = L.newGame({ mode: 'practice', seed: 6060 });
      const o = await open(browser, 'I13b', { v: custom(390, 664, null, 'iPhone 13 Safari'), state: makeState(L, { mode: 'practice', seed: 6060 }, Array.from({ length: 9 }, (_, i) => wrong(bb.secret, i))), opts: { initScript: TE } });
      await guess(o.page, bb.secret);
      const ab = await o.page.locator('#overlay [data-cmd=again]').boundingBox();
      await frozen(o.page, async () => {
        await o.page.touchscreen.tap(ab.x + ab.width / 2, ab.y + ab.height / 2); await wait(o.page, 70);
        await o.page.touchscreen.tap(ab.x + ab.width / 2, ab.y + ab.height / 2);
      });
      await wait(o.page, 500);
      const sn = await getState(o.page);
      check('「もう一度」を連続タップしても、新しい問題に色が入らない（rows 0・cur 0・結果カードは閉じたまま）', sn.rows.length === 0 && sn.cur.length === 0 && sn.done === null && !(await overlayShown(o.page)), sn);
      await o.ctx.close();
    },
  },
  {
    id: 'I14', tier: 'full', title: 'いろコード：日付の変わり目（0時またぎで今日の1問が変わる、前日の記録は今日を邪魔しない、1日1回）',
    async run({ browser, check: check0, root }) {
      const L = loadLogic(root);
      for (const tz of TIMEZONES) {
        const check = (n, ok, d) => check0(`[${tz}] ${n}`, ok, d);
        const T = (y, m, d, h, mi, s) => zonedTime(tz, y, m, d, h, mi, s);      // タイムゾーン tz の壁時計の時刻（ページの時計に渡す）
        const mkPage = async (time, items) => {
          const { ctx, page } = await newPage(browser, V(), 'I14 ' + tz, { timezoneId: tz });
          await page.clock.install({ time });
          await seed(page, items || {});
          await page.goto(IRO); await page.clock.runFor(400);
          if (await page.locator('#overlay:not([hidden]) [data-cmd="close"]').count()) { await page.locator('#overlay [data-cmd="close"]').click(); await page.clock.runFor(200); }
          return { ctx, page };
        };
        const tick = (p, ms) => p.clock.runFor(ms);
        // 23:59:50 に開く → 今日は 10/17
        let { ctx, page } = await mkPage(T(2026, 10, 17, 23, 59, 50));
        await page.locator('#modeDaily').tap(); await tick(page, 450);
        let s = await getState(page);
        check('23:59:50：今日の1問は 2026-10-17（種は dailySeed、答えは logic の newGame と同じ）', s.mode === 'daily' && s.date === '2026-10-17' && s.seed === L.dailySeed('2026-10-17') && eq(s.secret, L.newGame({ mode: 'daily', date: '2026-10-17' }).secret) && !s.hard, s);
        // 一晩アプリを開いたまま、0時をまたいで戻ってくる
        await page.clock.setSystemTime(T(2026, 10, 18, 0, 0, 10));
        await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow')); window.dispatchEvent(new Event('focus')); });
        await tick(page, 300);
        // 戻った直後（モードを切り替える前）に、自動で今日の問題に差し替わっている。手動の切り替えは start('daily') を通るので、ここで確かめないと自動差し替えを消しても気づけない
        s = await getState(page);
        check('0時をまたいで戻った直後（モード切替の前）に、自動で今日（2026-10-18）の問題に差し替わる（date・seed・rows 0・結果カードなし）', s.mode === 'daily' && s.date === '2026-10-18' && s.seed === L.dailySeed('2026-10-18') && s.rows.length === 0 && !(await overlayShown(page)), { date: s.date, mode: s.mode, rows: s.rows.length });
        await page.locator('#modePractice').tap(); await tick(page, 450);
        await page.locator('#modeDaily').tap(); await tick(page, 450);
        s = await getState(page);
        check('0時をまたいで戻り、今日の1問を選び直すと 2026-10-18 の問題になる（昨日の問題のまま遊べてしまわない）', s.mode === 'daily' && s.date === '2026-10-18' && s.seed === L.dailySeed('2026-10-18'), { date: s.date, mode: s.mode });
        await ctx.close();
        // 昨日(10-17)の今日の1問が途中のまま保存 → 翌日(10-18)の0:00:10に開く → 昨日の分は捨てられ、今日の新しい問題になる
        const yd = L.newGame({ mode: 'daily', date: '2026-10-17' });
        const ySt = makeState(L, { mode: 'daily', date: '2026-10-17' }, [wrong(yd.secret, 0), wrong(yd.secret, 1)]);
        ({ ctx, page } = await mkPage(T(2026, 10, 17, 23, 59, 50), { 'irocode.state': ySt }));
        s = await getState(page);
        check('前提：23:59:50 に開くと昨日分でなく当日(10-17)の途中の問題が復元される（rows 2）', s.mode === 'daily' && s.date === '2026-10-17' && s.rows.length === 2, { date: s.date, rows: s.rows.length });
        await page.clock.setSystemTime(T(2026, 10, 18, 0, 0, 10));
        await page.reload(); await tick(page, 400);
        if (await page.locator('#overlay:not([hidden]) [data-cmd="close"]').count()) { await page.locator('#overlay [data-cmd="close"]').click(); await tick(page, 200); }
        s = await getState(page);
        check('0時をまたいだあとに再読み込み：保存された昨日の途中の問題は捨てられ、今日の問題（mode daily・date 2026-10-18・rows 0・seed は今日のもの）', s.mode === 'daily' && s.date === '2026-10-18' && s.rows.length === 0 && s.seed === L.dailySeed('2026-10-18') && !eq(s.secret, ySt.secret), { date: s.date, mode: s.mode, rows: s.rows.length });
        await ctx.close();
        // 昨日クリア済みの記録 → 今日は遊べる
        ({ ctx, page } = await mkPage(T(2026, 10, 18, 0, 0, 5), { 'irocode.daily': { date: '2026-10-17', done: true, win: true, tries: 3 } }));
        await page.locator('#modeDaily').tap(); await tick(page, 450);
        await fill(page, [0, 1, 2, 3]).catch(() => {});
        await page.locator('#submit').tap({ timeout: 2000 }).catch(() => {}); await tick(page, 1100);
        s = await getState(page);
        check('昨日クリア済みでも、0:00:05 の今日の1問は未クリアで、1手決められる（date 2026-10-18・rows 1）', s.date === '2026-10-18' && s.rows.length === 1, { date: s.date, rows: s.rows.length, done: s.done });
        await ctx.close();
        // 今日クリア済み → 今日の1問は終わっている（1日1回）
        ({ ctx, page } = await mkPage(T(2026, 10, 18, 23, 59, 59), { 'irocode.daily': { date: '2026-10-18', done: true, win: true, tries: 4 } }));
        await page.locator('#modeDaily').tap({ timeout: 2000 }).catch(() => {}); await tick(page, 450);
        s = await getState(page);
        const shown = await overlayShown(page), submitOff = await page.evaluate(() => document.querySelector('#submit').disabled);
        check('今日クリア済み（23:59:59）：今日の1問は終了扱い（done か結果カードか決められない状態）で、記録を増やせない', s.mode === 'daily' && s.date === '2026-10-18' && (s.done !== null || shown || submitOff), { done: s.done, rows: s.rows.length, shown, submitOff });
        await page.clock.setSystemTime(T(2026, 10, 19, 0, 0, 1));
        await page.reload(); await tick(page, 400);
        await page.locator('#modeDaily').tap({ timeout: 2000 }).catch(() => {}); await tick(page, 450);
        s = await getState(page);
        check('0時をまたぐと翌日（10-19）はまた遊べる（done null・rows 0）', s.date === '2026-10-19' && s.done === null && s.rows.length === 0, { date: s.date, done: s.done, rows: s.rows.length });
        await ctx.close();
        // 今日の1問を解くと daily の記録が書かれる
        ({ ctx, page } = await mkPage(T(2026, 10, 20, 12, 0, 0), {}));
        await page.locator('#modeDaily').tap(); await tick(page, 450);
        const secret = (await getState(page)).secret;
        await fill(page, secret); await page.locator('#submit').tap(); await tick(page, 900);
        const d = await lsGet(page, 'irocode.daily');
        check('今日の1問を1回で解くと irocode.daily に {date, done:true, win:true, tries:1} が保存される（検証を通る）', d && d.date === '2026-10-20' && d.done === true && d.win === true && d.tries === 1 && eq(L.validateDaily(d), d), d);
        await ctx.close();
      }
    },
  },
  {
    id: 'I15', tier: 'full', title: 'いろコード：表示しうる最大値で省略されない（10億回の成績・10行の履歴を最も狭い画面で）、上限での保存',
    async run({ browser, check, root }) {
      const L = loadLogic(root);
      const bb = L.newGame({ mode: 'practice', seed: 7070 });
      const big = { played: 999999998, wins: 999999998, best: 10, dist: { 10: 999999998 } };
      for (const v of [view('SE', 'p', 'app'), view('SE', 'l', 'safari')]) {
        const { ctx, page } = await open(browser, 'I15', { v, state: makeState(L, { mode: 'practice', seed: 7070 }, Array.from({ length: 9 }, (_, i) => wrong(bb.secret, i))), stats: big });
        await guess(page, bb.secret);
        const cut = await page.evaluate(() => {
          const out = [];
          for (const e of document.querySelectorAll('#overlay .card, #overlay .card *')) {
            const s = getComputedStyle(e);
            if (!e.textContent.trim() || e.offsetParent === null) continue;
            if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && s.display !== 'inline') out.push({ n: String(e.className || e.tagName), sw: e.scrollWidth, cw: e.clientWidth });
            if (s.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth) out.push({ ellipsis: String(e.className || e.tagName) });
          }
          return out;
        });
        const stats = await lsGet(page, 'irocode.stats');
        check(`${v.label}：成績が約10億でも結果カードの文字が省略（…）されず、はみ出さない`, cut.length === 0, cut);
        check(`${v.label}：成績は上限（10億）以下で保存される`, stats && stats.played <= 1e9 && stats.wins <= 1e9 && eq(L.validateStats(stats), stats), stats);
        await ctx.close();
      }
      // 上限ちょうどのとき、次の勝ちで成績が壊れて初期化されない
      const { ctx, page } = await open(browser, 'I15b', { state: makeState(L, { mode: 'practice', seed: 7071 }), stats: { played: 1e9, wins: 1e9, best: 1, dist: { 1: 1e9 } } });
      await guess(page, (await getState(page)).secret);
      const after = await lsGet(page, 'irocode.stats');
      check('成績が上限ちょうど（10億）のとき遊んでも、保存された成績が検証を通り、played は 10億のまま', after && eq(L.validateStats(after), after) && after.played === 1e9, after);
      await page.reload(); await wait(page, 300);
      const re = await lsGet(page, 'irocode.stats');
      check('そのまま再読み込みしても成績が初期化されない', re && re.played === 1e9 && re.best === 1, re);
      await ctx.close();
    },
  },
  {
    id: 'I16', tier: 'full', title: 'いろコード：モード（今日の1問は何度開いても同じ問題、れんしゅうは毎回ちがう）',
    async run({ browser, check, root }) {
      const L = loadLogic(root);
      // ページの時計を固定する：東京の 2026-10-18 12:00 とロサンゼルスの 2026-10-18 12:00（UTC では 03:00 と 19:00）
      let page, ctx, d1;
      for (const tz of [...TIMEZONES].reverse()) {       // 最後（= 先頭のタイムゾーン）のページを以降の確認に使う
        ({ ctx, page } = await open(browser, 'I16 ' + tz, { opts: { clockTime: zonedTime(tz, 2026, 10, 18, 12, 0, 0), timezoneId: tz } }));
        await page.locator('#modeDaily').tap(); await wait(page, 400);
        d1 = await getState(page);
        await page.reload(); await wait(page, 300);
        await page.locator('#modeDaily').tap(); await wait(page, 400);
        const d2 = await getState(page);
        check(`[${tz}] 今日の1問：date は固定した時刻のローカル日付（2026-10-18）、2回開いても同じ問題、logic の newGame と同じ答え`, d1.mode === 'daily' && d1.date === '2026-10-18' && d1.seed === d2.seed && eq(d1.secret, d2.secret) && eq(d1.secret, L.newGame({ mode: 'daily', date: '2026-10-18' }).secret), { d1, d2 });
        if (tz !== TIMEZONES[0]) await ctx.close();   // 先頭のタイムゾーン以外は閉じる
      }
      check('今日の1問のあいだは「むずかしい」にならない（hard false・同じ色なしの答え）', d1.hard === false && new Set(d1.secret).size === 4);
      const seen = new Set();
      for (let i = 0; i < 4; i++) {
        await page.locator('#modeDaily').tap(); await wait(page, 400);
        await page.locator('#modePractice').tap(); await wait(page, 400);
        const s = await getState(page);
        seen.add(s.seed + ':' + s.secret.join(''));
      }
      check('れんしゅう：切り替えのたびに新しい問題になる（4回で 3 通り以上）', seen.size >= 3, [...seen]);
      const p = await getState(page);
      check('れんしゅうの状態：mode practice・date null・seed は 0〜2^32-1 の整数', p.mode === 'practice' && p.date === null && Number.isInteger(p.seed) && p.seed >= 0 && p.seed <= 0xFFFFFFFF, p);
      // れんしゅうから戻っても、今日の1問は同じ問題
      await page.locator('#modePractice').tap(); await wait(page, 400);
      await page.locator('#modeDaily').tap(); await wait(page, 400);
      const back = await getState(page);
      check('れんしゅうから今日の1問に戻っても、同じ日・同じ問題（答えが変わらない）', back.mode === 'daily' && back.date === d1.date && eq(back.secret, d1.secret), { date: back.date });
      await ctx.close();
    },
  },
  {
    id: 'I17', tier: 'full', title: 'いろコード：保存が使えない・壊れた stats/daily でも遊べる（localStorage の例外、値の検証）',
    async run({ browser, check, root }) {
      const L = loadLogic(root);
      // localStorage が使えない（プライベートブラウズ・データ遮断）
      const denied = () => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } }); };
      const { ctx, page } = await newPage(browser, V(), 'I17a', { clock: true, initScript: denied });
      await page.goto(IRO); await wait(page, 300); await closeHelp(page);
      await page.locator('#modePractice').tap(); await wait(page, 400);
      const sec = (await getState(page)).secret;
      await guess(page, wrong(sec, 0));
      await guess(page, sec);
      const s = await getState(page);
      check('localStorage が例外を投げても開けて、決められ、勝てる（保存されないだけ）', s.rows.length === 2 && s.done === 'win' && await overlayShown(page), s);
      await ctx.close();
      const BAD = [{ played: -5, wins: 'x' }, 'こわれ', { played: 1, wins: 5, best: 3 }, { date: '2026-02-30', done: true, win: true, tries: 3 }, { date: '2026-10-17', done: true, win: true, tries: 99 }];
      const o = await open(browser, 'I17b');
      const res = [];
      for (const bad of BAD) {
        await seed(o.page, { 'irocode.stats': bad, 'irocode.daily': bad });
        await o.page.goto(IRO); await wait(o.page, 300); await closeHelp(o.page);
        await o.page.locator('#modePractice').tap(); await wait(o.page, 400);
        await guess(o.page, (await getState(o.page)).secret);
        const st = await lsGet(o.page, 'irocode.stats');
        res.push({ bad: JSON.stringify(bad).slice(0, 30), ok: !!st && eq(L.validateStats(st), st) && st.played === 1 && st.wins === 1 && st.best === 1 });
      }
      check('壊れた stats/daily 5種：初期値から数え直し（played 1・wins 1・best 1）、保存値は検証を通る', res.every((r) => r.ok), res);
      await o.ctx.close();
    },
  },
  {
    id: 'I18', tier: 'full', title: 'いろコード：画面サイズ（端末×向き×起動方法の代表と CSS の境界）でボタンが画面内・44px・重ならない、10行の履歴',
    async run({ browser, check, root }) {
      const L = loadLogic(root);
      const bb = L.newGame({ mode: 'practice', seed: 8080 });
      const st = makeState(L, { mode: 'practice', seed: 8080 }, Array.from({ length: 9 }, (_, i) => wrong(bb.secret, i)), [1, 2, 3]);
      const views = [view('SE', 'p', 'safari'), view('SE', 'l', 'app'), view('i13', 'p', 'app'), view('i13', 'l', 'app'), view('i13', 'l', 'safari'), view('PM', 'p', 'safari'), view('iPad', 'p', 'app'), view('iPad', 'l', 'safari'), custom(360, 640, null, '360×640'), custom(361, 640, null, '361×640'), custom(320, 568, null, '320×568'), custom(568, 320, null, '568×320'), custom(430, 932, null, '430×932')];
      for (const v of views) {
        const { ctx, page } = await open(browser, 'I18 ' + v.label, { v, state: st });
        const pr = await layoutProbe(page, BTNS + ', #slots .slot', v.safe, { overlapSel: BTNS, minSel: BTNS });
        const rowsFit = await page.evaluate(() => [...document.querySelectorAll('#rows .row')].every((r) => r.getBoundingClientRect().right <= innerWidth + 0.5));
        check(`${v.label}：ボタン・枠が画面内で重ならず 44px 以上、横スクロールなし、履歴が横にはみ出さない`, pr.n >= 14 && !pr.outside.length && !pr.overlaps.length && !pr.small.length && !pr.hscroll && rowsFit, pr);
        const reach = await page.evaluate(() => ['#submit', '#palette button[data-color="5"]'].map((s) => { const e = document.querySelector(s); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return r.top >= -0.5 && r.bottom <= innerHeight + 0.5; }));
        check(`${v.label}：「決める」と色ボタンに、画面のスクロールで届く`, reach.every(Boolean), reach);
        const segFit = () => page.evaluate(() => ['#modeDaily', '#modePractice', '#hardToggle'].map((s) => { const e = document.querySelector(s); return { s, t: e.textContent, sw: e.scrollWidth, cw: e.clientWidth, h: Math.round(e.getBoundingClientRect().height) }; }).filter((b) => b.sw > b.cw || b.h < 44));
        const fitOff = await segFit();
        await page.locator('#hardToggle').tap(); await wait(page, 400);
        if (await overlayShown(page)) { await page.locator('#overlay [data-cmd=confirm]').tap(); await wait(page, 500); }   // 履歴があると確認カードが出る
        const fitOn = await segFit();
        check(`${v.label}：モードのボタン3つの文字がはみ出さない（scrollWidth <= clientWidth）・高さ44px以上（むずかしい：オフ／オン）`, fitOff.length === 0 && fitOn.length === 0 && (await page.locator('#hardToggle').getAttribute('aria-pressed')) === 'true', { fitOff, fitOn });
        await ctx.close();
      }
    },
  },
  {
    id: 'I19', tier: 'full', title: 'いろコード：日付の仕様（0時をまたいで遊び続ける／確認・遊び方カード中にまたぐ／端末の時計が戻る／途中で捨てたときの成績）',
    async run({ browser, check: check0, root }) {
      const L = loadLogic(root);
      // 仕様：結果は「始めた日」(state.date) で記録する。カードの文言は表示時点の日付と比べる。ヒントを見た問題を完走せず手放したら、理由によらず負け1回（played のみ。勝ち・best は動かさない）。
      for (const tz of TIMEZONES) {
        const check = (n, ok, d) => check0(`[${tz}] ${n}`, ok, d);
        const T = (y, m, d, h, mi, s) => zonedTime(tz, y, m, d, h, mi, s);
        const openAt = (time, items) => open(browser, 'I19 ' + tz, { extra: { 'irocode.stats': L.initialStats(), ...items }, opts: { clockTime: time, timezoneId: tz } });     // stats ありで始める＝初回の遊び方カードが出ない
        const cross = async (page, time) => {      // 0時をまたぐ。隠さずに時計だけ進める
          await page.clock.setSystemTime(time); await wait(page, 100);
        };
        const back = async (page) => {             // アプリに戻ってくる（visibilitychange）
          await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await wait(page, 300);
        };
        const dayState = (date, n) => { const g = L.newGame({ mode: 'daily', date }); return makeState(L, { mode: 'daily', date }, Array.from({ length: n }, (_, i) => wrong(g.secret, i))); };
        const ySt = dayState('2026-10-17', 2);
        // (a) 23:59:50 に始めて、0時をまたいだまま最後まで遊び、確定する
        let o = await openAt(T(2026, 10, 17, 23, 59, 50), { 'irocode.state': ySt });
        let g = await getState(o.page);
        check('前提：23:59:50 に開くと 10-17 の途中の問題（rows 2）', g.date === '2026-10-17' && g.rows.length === 2, { date: g.date, rows: g.rows.length });
        await cross(o.page, T(2026, 10, 18, 0, 0, 10));
        await guess(o.page, ySt.secret);
        g = await getState(o.page);
        let dl = await lsGet(o.page, 'irocode.daily'), st = await lsGet(o.page, 'irocode.stats'), card = await cardInfo(o.page);
        check('0時をまたいで確定(決定ボタン)：始めた日（2026-10-17）の問題として勝ちが記録される（daily の date は 10-17・tries 3、played 1・wins 1）', g.date === '2026-10-17' && g.done === 'win' && dl && dl.date === '2026-10-17' && dl.done === true && dl.win === true && dl.tries === 3 && st.played === 1 && st.wins === 1, { g: g.date, dl, st });
        check('結果カードは表示時点の日付と比べる：「次は明日」でなく「今日の1問が遊べます」', await overlayShown(o.page) && /今日の1問が遊べます/.test(card.text) && !/次は明日/.test(card.text), card.text);
        await back(o.page);
        g = await getState(o.page); card = await cardInfo(o.page);
        check('戻ると今日（2026-10-18）の新しい問題になる（rows 0・結果カードなし）。昨日の記録は増えない（played 1 のまま）', g.date === '2026-10-18' && g.rows.length === 0 && g.done === null && !(await overlayShown(o.page)) && (await lsGet(o.page, 'irocode.stats')).played === 1, { date: g.date, rows: g.rows.length });
        await o.ctx.close();
        // 同じ日の通常の結果カードは、これまでどおり「次は明日」
        const tSt = dayState('2026-10-18', 2);
        o = await openAt(T(2026, 10, 18, 12, 0, 0), { 'irocode.state': tSt });
        await guess(o.page, tSt.secret); card = await cardInfo(o.page);
        check('同じ日に終えた結果カードは「次は明日」（0時をまたいでいなければ変わらない）', /次は明日/.test(card.text) && !/今日の1問が遊べます/.test(card.text), card.text);
        await o.ctx.close();
        // (b) 確認カード（今日の1問を途中でやめてれんしゅうに）の表示中に0時をまたぐ → 戻っても差し替えない → 閉じると今日の問題（途中の問題は負け1回）
        o = await openAt(T(2026, 10, 17, 23, 59, 50), { 'irocode.state': ySt });
        await o.page.locator('#modePractice').tap(); await wait(o.page, 400);
        card = await cardInfo(o.page);
        await cross(o.page, T(2026, 10, 18, 0, 0, 10)); await back(o.page);
        g = await getState(o.page); const still = await cardInfo(o.page);
        check('確認カードの表示中に0時をまたいで戻っても、カードはそのまま（差し替えない）・問題は 10-17 の途中のまま（rows 2）', card.cmds.includes('confirm') && still.cmds.includes('confirm') && g.date === '2026-10-17' && g.rows.length === 2, { cmds: still.cmds, date: g.date, rows: g.rows.length });
        await o.page.locator('#overlay [data-cmd=cancel]').tap(); await wait(o.page, 400);
        g = await getState(o.page); st = await lsGet(o.page, 'irocode.stats'); dl = await lsGet(o.page, 'irocode.daily');
        check('確認カードを閉じると、今日（2026-10-18）の新しい問題に差し替わる。途中だった昨日の問題は負け1回（played 1・wins 0）で、昨日の日付の記録は残さない', g.mode === 'daily' && g.date === '2026-10-18' && g.rows.length === 0 && !(await overlayShown(o.page)) && st.played === 1 && st.wins === 0 && dl === null, { date: g.date, st, dl });
        await o.ctx.close();
        // 遊び方カード
        o = await openAt(T(2026, 10, 17, 23, 59, 50), {});
        await o.page.locator('#helpBtn').tap(); await wait(o.page, 400);
        await cross(o.page, T(2026, 10, 18, 0, 0, 10)); await back(o.page);
        g = await getState(o.page);
        check('遊び方カードの表示中に0時をまたいで戻っても、カードはそのまま・問題は 10-17 のまま', (await cardInfo(o.page)).cmds.includes('close') && g.date === '2026-10-17', { date: g.date });
        await o.page.locator('#overlay [data-cmd=close]').tap(); await wait(o.page, 400);
        g = await getState(o.page);
        check('遊び方カードを閉じると、今日（2026-10-18）の問題になる（rows 0 だったので成績は動かない：played 0）', g.date === '2026-10-18' && !(await overlayShown(o.page)) && (await lsGet(o.page, 'irocode.stats')).played === 0, { date: g.date });
        await o.ctx.close();
        // (c) 端末の時計が戻った：未来の日付の記録・状態は受け付けない
        const NOW = T(2026, 10, 18, 12, 0, 0);
        o = await openAt(NOW, { 'irocode.daily': { date: '2026-10-19', done: true, win: true, tries: 2 } });
        g = await getState(o.page); dl = await lsGet(o.page, 'irocode.daily');
        check('未来の日付（10-19）の daily 記録は捨てる：今日（10-18）の1問は遊べる状態（結果カードなし・done null）で、保存からも消える', g.date === '2026-10-18' && g.done === null && !(await overlayShown(o.page)) && dl === null, { date: g.date, dl });
        await o.ctx.close();
        o = await openAt(NOW, { 'irocode.state': dayState('2026-10-19', 2), 'irocode.daily': { date: '2026-10-19', done: true, win: true, tries: 2 } });
        g = await getState(o.page); st = await lsGet(o.page, 'irocode.stats'); dl = await lsGet(o.page, 'irocode.daily');
        check('未来の日付（10-19）の途中の状態も捨てて今日（10-18）の問題にする。扱いは日付が過去のときと同じ：負け1回（played 1・wins 0）、昨日以外の日付の記録は残さない', g.date === '2026-10-18' && g.rows.length === 0 && st.played === 1 && st.wins === 0 && dl === null && !(await overlayShown(o.page)), { date: g.date, st, dl });
        await o.ctx.close();
        // 過去の日付の記録は、これまでどおり（今日を邪魔しない）
        o = await openAt(NOW, { 'irocode.daily': { date: '2026-10-17', done: true, win: true, tries: 3 }, 'irocode.state': dayState('2026-10-17', 3) });
        g = await getState(o.page); st = await lsGet(o.page, 'irocode.stats');
        check('昨日（10-17）の途中の状態を起動時に捨てるときも、負け1回（played 1）。ただし昨日の記録がすでにあれば二重に数えない（played 0）', g.date === '2026-10-18' && st.played === 0, { date: g.date, st });
        await o.ctx.close();
        // れんしゅうへの切り替え：同じ「負け1回」
        o = await openAt(NOW, { 'irocode.state': dayState('2026-10-18', 2) });
        await o.page.locator('#modePractice').tap(); await wait(o.page, 400);
        await o.page.locator('#overlay [data-cmd=confirm]').tap(); await wait(o.page, 500);
        st = await lsGet(o.page, 'irocode.stats'); dl = await lsGet(o.page, 'irocode.daily');
        check('今日の1問を途中でれんしゅうに切り替えると負け1回（played 1・wins 0）で、daily に今日の負けが記録される（捨てる経路の扱いと同じ）', st.played === 1 && st.wins === 0 && dl && dl.date === '2026-10-18' && dl.done === true && dl.win === false, { st, dl });
        await o.ctx.close();
      }
    },
  },
  {
    id: 'I20', tier: 'full', title: 'いろコード 古いページから書き戻さない（X-20）：bfcache から戻ったとき・裏にいる間に別のタブが irocode.state を書いたとき、古い途中の状態を書き戻さず開き直して今の保存から続ける。変わっていなければ開き直さない',
    async run({ browser, check }) {
      const { ctx, page } = await open(browser, 'I20');
      const mk = (seed) => page.evaluate((s) => JSON.stringify(window.IroCodeLogic.newGame({ mode: 'practice', seed: s })), seed);
      const fp = (raw) => { try { const s = JSON.parse(raw); return `${s.mode}:${s.seed}:${s.rows.length}`; } catch { return 'ERR'; } };
      const r = await x20Run(page, ctx, { key: 'irocode.state', newer: [await mk(101), await mk(202)], fp });
      check(`いろコード：${x20Text(r)}`, r.ok, r);
      await ctx.close();
    },
  },
];
