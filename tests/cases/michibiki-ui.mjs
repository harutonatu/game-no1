// FW: ミチビキ空港の画面（games/michibiki/）。契約は docs/michibiki-contract.md（§5 入力・§6 DOM・§7 描画・§8 進行・§8.6 テスト用 API・§13.3 FW）。
//   画面の DOM は契約だけに頼る：#app[data-phase]・a#back・#gameTitle・#helpBtn・#pauseBtn・#soundBtn・#score・#best・#lives[data-lives]・
//     canvas#field・#hint・#overlay[data-kind]・#overlayTitle・#helpOk・#resumeBtn・#restartBtn・#againBtn・#menuBtn
//   テスト用の公開 API（§8.6）：window.MichibikiGame = { getState, manual, tick, drawPath, guide, spawn, restart, pause, resume, toScreen, toField, planeRect, setSlowmo }
//   時間はページの時計ではなく manual(true) と tick(n) で進める（§14 の 11）。カードのロック・ヒントの 3 秒などのタイマーだけ page.clock（wait）で進める。
//   機体は spawn({ color, kind, x, y, dx, dy })（forceSpawn。x・y・dx・dy はロジック担当の拡張）で決まった所に出し、出るまで（WARN_S = 120 コマ）tick で待つ。
//   無いときに合格にしない（空振りの合格を作らない）：MichibikiGame が無ければ例外で不合格にする。
//   smoke：FW1〜FW5・FW20・FW21。full：FW6〜FW19・FW22〜FW24（FW15・FW18・FW23 は CDP なので Chromium だけ、FW10 は AudioContext が要る）。
//   FW20〜FW23 は契約 §19（レビュー後の直し）の確認。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BASE, view, custom, newPage, seed, wait, sleep, frozen, layoutProbe, swInfo, touch, SFX_SPY, plays, mbDrag } from '../lib.mjs';

const MB = BASE + 'games/michibiki/';
const SMOKE_V = () => view('SE', 'p', 'app');
const STD_V = () => view('i13', 'p', 'app');
const RED = { ex: 100, ey: 170, dx: 1, dy: 0 };        // tall のあかの滑走路（§3.3）
const HINT_WRONG = 'やじるしの むきから はいろう';
const SEED = 3;
const REV_SEEDS = [4, 6, 9, 14, 15, 16];   // 逆向きに回り込む間、ほかの機体がぶつかってこない種（FW1・FW19。ぶつかったら次へ）

// ---------- 開く ----------
async function openM(browser, label, { v = STD_V(), opts = {}, extra = {}, help = true, start = true } = {}) {
  const { ctx, page } = await newPage(browser, v, label, { clock: true, ...opts });
  await gotoM(page, extra, { help, start });
  return { ctx, page };
}
async function gotoM(page, extra = {}, { help = true, start = true } = {}) {
  await seed(page, { ...(help ? { 'michibiki.help': '1' } : {}), ...extra });
  await page.goto(MB); await wait(page, 300);
  const has = await page.evaluate(() => !!window.MichibikiGame && typeof window.MichibikiGame.getState === 'function' && typeof window.MichibikiGame.tick === 'function');
  if (!has) throw new Error('window.MichibikiGame が無い（games/michibiki/main.js が読まれていないか、テスト用 API が未実装）');
  if (help && start) await fresh(page);
}
// 種と layout を決めて始め直し、ロジックの時間を止める（tick でだけ進む）
async function fresh(page, sd = SEED, layout = 'tall') {
  const ok = await page.evaluate(([s, l]) => { const G = window.MichibikiGame; const r = G.restart(s, l); G.manual(true); return r !== false; }, [sd, layout]);
  if (!ok) throw new Error(`restart(${sd}, ${layout}) が始められない`);
}

// ---------- 読む・進める ----------
const gs = (p) => p.evaluate(() => window.MichibikiGame.getState());
const T = (p, n) => p.evaluate((n) => window.MichibikiGame.tick(n), n);
const stored = (p, k) => p.evaluate((k) => { try { return localStorage.getItem(k); } catch { return 'ERR'; } }, k);
const hintText = (p) => p.evaluate(() => (document.querySelector('#hint')?.textContent || '').trim());
const reachable = (p, sel) => p.evaluate((s) => {
  const e = document.querySelector(s); if (!e) return false;
  const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false;
  const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!t && (t === e || e.contains(t));
}, sel);
const dom = (p) => p.evaluate(() => {
  const ov = document.querySelector('#overlay');
  return {
    phase: document.querySelector('#app')?.dataset.phase, layout: document.querySelector('#app')?.dataset.layout,
    score: document.querySelector('#score')?.textContent.trim(), scoreV: document.querySelector('#score')?.dataset.value,
    best: document.querySelector('#best')?.textContent.trim(), lives: document.querySelector('#lives')?.dataset.lives,
    livesAria: document.querySelector('#lives')?.getAttribute('aria-label'),
    overlay: ov && !ov.hidden ? ov.dataset.kind : null, card: ov && !ov.hidden ? (document.querySelector('#card')?.textContent || '').replace(/\s+/g, ' ').trim() : '',
  };
});
// 条件 cond（s＝getState()、evs＝そのコマの出来事 を使う式の文字列）が真になるまで step コマずつ進める。出来事は tick を付けて全部返す
const until = (p, cond, max = 1800, step = 1) => p.evaluate(([cond, max, step]) => {
  const G = window.MichibikiGame, f = new Function('s', 'evs', 'return (' + cond + ');');
  const all = [];
  for (let i = 0; i < max; i += step) {
    const evs = G.tick(step) || [];
    const s = G.getState();
    for (const e of evs) all.push({ ...e, tick: s.tick });
    if (f(s, evs)) return { ok: true, s, evs: all };
    if (s.over || s.phase !== 'playing') return { ok: false, s, evs: all };
  }
  return { ok: false, s: G.getState(), evs: all };
}, [cond, max, step]);
// 決まった所に機体を出し、出るまで進める。出た機体の id を返す
async function spawnAt(p, o) {
  const r = await p.evaluate((o) => window.MichibikiGame.spawn(o), o);
  if (!r || typeof r.id !== 'number') throw new Error('spawn が予告を足さない: ' + JSON.stringify(o));
  const u = await until(p, `s.planes.some((q) => q.id === ${r.id})`, 400);
  if (!u.ok) throw new Error(`spawn した機体 ${r.id} が出ない`);
  return r.id;
}
// 回の1機目（あか・左の辺）が出るまで進める
async function firstPlane(p) {
  const u = await until(p, 's.planes.some((q) => q.phase === "fly")', 300);
  if (!u.ok) throw new Error('1機目が出ない');
  return u.s.planes.find((q) => q.phase === 'fly');
}
// 下の帯（y 470）で向かい合わせの2機を出してぶつける。ライフが減るまで進めて、その後の state を返す
async function crashOnce(p) {
  const s0 = await gs(p);
  await p.evaluate(() => { const G = window.MichibikiGame; G.spawn({ color: 1, kind: 'normal', x: 40, y: 470, dx: 1, dy: 0 }); G.spawn({ color: 1, kind: 'normal', x: 280, y: 470, dx: -1, dy: 0 }); });
  const u = await until(p, `s.lives < ${s0.lives}`, 900);
  return u.s;
}
// おまかせ（guide）で着陸を重ね、landed ≥ n にする。終わってしまったら次の種で（決まった種の並びなので結果は毎回同じ）
// 今の回のまま、おまかせで landed ≥ n まで進める
const guideUntil = (p, n, maxTicks = 30000) => p.evaluate(([n, maxTicks]) => {
  const G = window.MichibikiGame, evs = [];
  for (let t = 0; t < maxTicks; t += 6) {
    for (const q of G.getState().planes) if (q.phase === 'fly' && q.pathLeft === 0) G.guide(q.id);
    for (const e of G.tick(6) || []) evs.push({ ...e, tick: G.getState().tick });
    const s = G.getState();
    if (s.landed >= n || s.over) return { s, evs };
  }
  return { s: G.getState(), evs };
}, [n, maxTicks]);
async function landN(p, n, { seeds = [1, 2, 3, 4, 5, 6, 7, 8], layout = 'tall', maxTicks = 30000 } = {}) {
  for (const sd of seeds) {
    await fresh(p, sd, layout);
    const r = await p.evaluate(([n, maxTicks]) => {
      const G = window.MichibikiGame, evs = [];
      for (let t = 0; t < maxTicks; t += 6) {
        const st = G.getState();
        for (const q of st.planes) if (q.phase === 'fly' && q.pathLeft === 0) G.guide(q.id);
        for (const e of G.tick(6) || []) evs.push({ ...e, tick: G.getState().tick });
        const s = G.getState();
        if (s.landed >= n || s.over) return { s, evs: evs.filter((e) => ['open', 'land', 'crash', 'wrongway', 'warn', 'spawn'].includes(e.type)) };
      }
      return { s: G.getState(), evs: [] };
    }, [n, maxTicks]);
    if (r.s.landed >= n && !r.s.over) return { ...r, seed: sd };
  }
  throw new Error(`おまかせで ${n} 機 着陸できる種が見つからない`);
}
// 隠れる・戻る（visibilitychange を再現する）
const setHidden = (p, hidden) => p.evaluate((h) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);
const scr = (p, x, y) => p.evaluate(([x, y]) => { const r = window.MichibikiGame.toScreen(x, y); return Array.isArray(r) ? r : [r.x, r.y]; }, [x, y]);
async function tapField(p, x, y) { const [cx, cy] = await scr(p, x, y); await p.mouse.click(cx, cy); await wait(p, 30); }
// 1機目から、手前を通って矢印の向きから あかの入り口へ入る道（場の単位）
const goodPath = (q, start = [q.x, q.y]) => [start, [40, (q.y + RED.ey) / 2], [40, RED.ey], [RED.ex - 48, RED.ey], [RED.ex - 24, RED.ey], [RED.ex, RED.ey], [RED.ex + 12, RED.ey]];
// 奥の側から回り込んで、逆向き（左向き）に入り口を通る道
const badPath = (q) => [[q.x, q.y], [40, 100], [170, 100], [170, RED.ey], [130, RED.ey], [RED.ex, RED.ey], [70, RED.ey], [50, RED.ey]];

export const tests = [
  // ================= smoke =================
  {
    id: 'FW1', tier: 'smoke', title: 'ミチビキ空港 なぞって着陸：機体から案内の帯（手前の点）を通って矢印の向きから入り口までなぞると guided・着陸・#score 1（getState と一致）、機体の近く（PICK_R の内側）から描き始めてもつかめる。逆向き（奥の側から）の道は guided false で、着陸せず通り過ぎる（landed 0・♥ そのまま）',
    async run({ browser, check }) {
      const { ctx, page } = await openM(browser, 'FW1', { v: SMOKE_V() });
      const d0 = await dom(page);
      check(`遊んでいる（#app[data-phase=playing]・layout tall・#score 0・#lives 3）`, d0.phase === 'playing' && d0.layout === 'tall' && d0.score === '0' && d0.lives === '3', d0);
      check('document.title と #gameTitle が ミチビキ空港', await page.evaluate(() => document.title.includes('ミチビキ空港') && document.querySelector('#gameTitle')?.textContent.trim() === 'ミチビキ空港'), await page.title());
      const q = await firstPlane(page);
      // 機体の中心から 20（PICK_R 34 の内側）ずらした所から描き始める
      const start = [q.x + 6, q.y + (q.y < 260 ? 20 : -20)];
      await mbDrag(page, goodPath(q, start));
      const s1 = await gs(page), p1 = s1.planes.find((x) => x.id === q.id);
      check(`機体の近く（中心から ${Math.hypot(start[0] - q.x, start[1] - q.y).toFixed(0)}）からなぞると道が付き、矢印の向きから入るので guided: true（残り ${p1 && p1.pathLeft} 点）`, !!p1 && p1.pathLeft > 0 && p1.guided === true, p1);
      const u = await until(page, 's.landed >= 1', 1500);
      const d1 = await dom(page);
      check(`進めると着陸して landed 1・#score「1」（data-value ${d1.scoreV}）・land の出来事 guided: true`, u.ok && u.s.landed === 1 && d1.score === '1' && d1.scoreV === '1' && u.evs.some((e) => e.type === 'land' && e.guided === true), { s: u.s.landed, d1, evs: u.evs.filter((e) => e.type !== 'near') });
      check('道で導いた着陸は stats.guidedLandings 1', u.s.stats.guidedLandings === 1, u.s.stats);
      // 逆向き（ほかの機体がこの機体にぶつかったときだけ、次の種でやり直す。種の並びは決まっているので毎回同じ）
      let q2, p2, u2, d2, used = null;
      for (const sd of REV_SEEDS) {
        await fresh(page, sd);
        q2 = await firstPlane(page);
        await mbDrag(page, badPath(q2));
        p2 = (await gs(page)).planes.find((x) => x.id === q2.id);
        u2 = await until(page, `s.planes.some((x) => x.id === ${q2.id} && x.pathLeft === 0 && x.x < 70) || evs.some((e) => e.type === 'crash')`, 2400);
        d2 = await dom(page);
        if (!u2.evs.some((e) => e.type === 'crash')) { used = sd; break; }
      }
      check(`奥の側から逆向きに入り口を通る道は guided: false（道は付く。種 ${used}）`, used !== null && !!p2 && p2.pathLeft > 0 && p2.guided === false, p2);
      check(`進めても着陸せずに通り過ぎる（landed ${u2.s.landed}・♥ ${d2.lives}・wrongway ${u2.evs.filter((e) => e.type === 'wrongway').length} 回）`, u2.ok && u2.s.landed === 0 && d2.score === '0' && d2.lives === '3' && u2.evs.some((e) => e.type === 'wrongway' && e.id === q2.id), { s: u2.s.landed, d2, evs: u2.evs.filter((e) => e.type !== 'near') });
      await ctx.close();
    },
  },
  {
    id: 'FW2', tier: 'smoke', title: 'ミチビキ空港 ぶつかる・終わり：向かい合わせの2機を tick で進めると ♥ が1つ減り（#lives[data-lives]・aria-label）、3回で over、終わりのカード（0.6 秒後）が出て 0.6 秒は押せない、その後 #againBtn で新しい回（landed 0・lives 3）、michibiki.best が更新される',
    async run({ browser, check }) {
      const { ctx, page } = await openM(browser, 'FW2', { v: SMOKE_V() });
      const q = await firstPlane(page);
      await page.evaluate((id) => window.MichibikiGame.guide(id), q.id);
      const u = await until(page, 's.landed >= 1', 2400);
      check('おまかせ（guide）で1機目が着陸する（landed 1）', u.ok && u.s.landed === 1, u.s.landed);
      // ここから先は、ページの時計を止めて wait でだけ進める（遅い環境でも 0.6 秒の確認がずれない）
      await frozen(page, async () => {
      const seen = [];
      let s = await gs(page);
      for (let i = 0; i < 5 && !s.over; i++) {
        s = await crashOnce(page);
        const d = await dom(page);
        seen.push({ lives: s.lives, dom: d.lives, aria: d.livesAria });
      }
      check(`ぶつかるたびに ♥ が1つ減り、#lives[data-lives] と aria-label「のこり N」が getState と一致（${seen.map((x) => x.dom).join('→')}）`, seen.length === 3 && seen.every((x, i) => x.lives === 2 - i && x.dom === String(x.lives) && x.aria === `のこり ${x.lives}`), seen);
      check('3回で over（phase over）', s.over === true && s.phase === 'over' && (await dom(page)).phase === 'over', { over: s.over, phase: s.phase });
      check('ベストを保存（michibiki.best が "1"）', (await stored(page, 'michibiki.best')) === '1', await stored(page, 'michibiki.best'));
      check('終わってすぐはカードを出さない（0.6 秒後に出す）', (await dom(page)).overlay === null, await dom(page));
      await wait(page, 650);
      const d1 = await dom(page);
      check(`0.6 秒後に終わりのカード（data-kind over・「おしまい！」・「1 き ちゃくりく」・#againBtn にフォーカス）: ${d1.card}`, d1.overlay === 'over' && /おしまい/.test(d1.card) && /1\s*き ちゃくりく/.test(d1.card) && (await page.evaluate(() => document.activeElement?.id)) === 'againBtn', d1);
      check('カードに「みちびいた 1 き・ぶつかった 3かい」', /みちびいた 1 き/.test(d1.card) && /ぶつかった 3かい/.test(d1.card), d1.card);
      const tip = await page.evaluate(() => document.querySelector('#overTip')?.textContent.trim() || null);
      check(`2 機以下（1 機）で終わると #overTip「つぎは かっそうろの やじるしを よく みてね」（${tip}。§19 B9）`, tip === 'つぎは かっそうろの やじるしを よく みてね', tip);
      // page.click は待ちの間にページの時計が進むので、ページの中で押す（出てから 0.05 秒）
      await page.evaluate(() => document.querySelector('#againBtn').click()); await wait(page, 50);
      check('カードが出た直後（0.6 秒以内）に #againBtn を押しても何も起きない', (await dom(page)).overlay === 'over' && (await gs(page)).over === true, await dom(page));
      await wait(page, 650);
      await page.evaluate(() => document.querySelector('#againBtn').click()); await wait(page, 100);
      const s2 = await gs(page), d2 = await dom(page);
      check(`0.6 秒たてば #againBtn で新しい回（landed ${s2.landed}・lives ${s2.lives}・phase ${s2.phase}・ベスト ${d2.best}）`, s2.phase === 'playing' && s2.landed === 0 && s2.lives === 3 && !s2.over && d2.overlay === null && d2.lives === '3' && d2.best === '1', { s2: { ...s2, drawLog: undefined }, d2 });
      });
      await ctx.close();
    },
  },
  {
    id: 'FW3', tier: 'smoke', title: 'ミチビキ空港 保存：壊れた michibiki.best・michibiki.help でも落ちない（ページエラーなし・ベスト 0・遊び方が出る）、保存できない（localStorage が例外）でも遊べる、ほかのゲームの保存キーを変えない',
    async run({ browser, check, errors }) {
      const { ctx, page } = await newPage(browser, SMOKE_V(), 'FW3', { clock: true });
      const e0 = errors.length;
      const bad = [];
      for (const raw of ['abc', '-5', '1.5', '{}', 'NaN', '1e400', '', '9007199254740992', ' ']) {
        await seed(page, { 'michibiki.best': raw, 'michibiki.help': '1' });
        await page.goto(MB); await wait(page, 200);
        const s = await gs(page), d = await dom(page);
        if (s.best !== 0 || d.best !== '0') bad.push({ raw, best: s.best, dom: d.best });
      }
      check('壊れた michibiki.best 9 通り（abc・負・小数・{}・NaN・1e400・空・2^53・空白）はベスト 0', bad.length === 0, bad);
      await seed(page, { 'michibiki.best': '{"x":1}', 'michibiki.help': 'xyz' });
      await page.goto(MB); await wait(page, 200);
      const d = await dom(page);
      check(`壊れた michibiki.help（"xyz"）は「まだ見ていない」として遊び方を出す（data-kind ${d.overlay}・phase ${d.phase}）`, d.overlay === 'help' && d.phase === 'help', d);
      await page.click('#helpOk'); await wait(page, 100);
      check('「わかった」で回が始まり、michibiki.help が "1"', (await dom(page)).phase === 'playing' && (await stored(page, 'michibiki.help')) === '1', await dom(page));
      check('壊れた保存でもページエラー・コンソールエラーが無い', errors.length === e0, errors.slice(e0));
      await ctx.close();
      // 保存できない環境
      const NO_STORE = () => { for (const m of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) Storage.prototype[m] = function () { throw new DOMException('denied', 'SecurityError'); }; };
      const b = await newPage(browser, SMOKE_V(), 'FW3 保存不可', { clock: true, initScript: NO_STORE });
      const e1 = errors.length;
      await b.page.goto(MB); await wait(b.page, 300);
      const h = await dom(b.page);
      await b.page.click('#helpOk'); await wait(b.page, 100);
      await b.page.evaluate(() => window.MichibikiGame.manual(true));
      const q = await firstPlane(b.page);
      await b.page.evaluate((id) => window.MichibikiGame.guide(id), q.id);
      const u = await until(b.page, 's.landed >= 1', 2400);
      check(`localStorage が例外でも、遊び方が出て（${h.overlay}）「わかった」で始まり、着陸まで遊べる（landed ${u.s.landed}）、エラーなし`, h.overlay === 'help' && u.ok && errors.length === e1, { h, landed: u.s.landed, errs: errors.slice(e1) });
      await b.ctx.close();
      // ほかのゲームのキー
      const c = await newPage(browser, SMOKE_V(), 'FW3 ほかのキー', { clock: true });
      const others = { 'matomete.best': '123', 'irobin.save': '{"v":3,"level":4,"moves":[]}', 'blockpuzzle.sound': 'on', 'hashi.best': '7', 'tile2048.best': '2048' };
      await gotoM(c.page, others);
      const q2 = await firstPlane(c.page);
      await c.page.evaluate((id) => window.MichibikiGame.guide(id), q2.id);
      await until(c.page, 's.landed >= 1', 2400);
      for (let i = 0; i < 3; i++) await crashOnce(c.page);
      await wait(c.page, 700);
      await c.page.goto(BASE + 'manifest.webmanifest');
      const after = await c.page.evaluate((ks) => Object.fromEntries(ks.map((k) => [k, localStorage.getItem(k)])), Object.keys(others));
      const keys = await c.page.evaluate(() => Object.keys(localStorage).filter((k) => /^michibiki\./.test(k)).sort());
      check(`遊んで終わっても、ほかのゲームの保存キーが変わらない・ミチビキ空港が書くのは michibiki.* だけ（${keys.join(',')}）`, JSON.stringify(after) === JSON.stringify(others) && keys.every((k) => ['michibiki.best', 'michibiki.help'].includes(k)), { after, keys });
      await c.ctx.close();
    },
  },
  {
    id: 'FW4', tier: 'smoke', title: 'ミチビキ空港 どこからでも戻れる：遊んでいる途中・遊び方・一時停止・終わりのカードから a#back でメニューへ、終わりのカードの #menuBtn',
    async run({ browser, check }) {
      const { ctx, page } = await openM(browser, 'FW4', { v: SMOKE_V() });
      check('a#back の href は ../../ でメニュー（BASE）を指す', await page.evaluate(() => document.querySelector('a#back')?.href) === BASE, await page.evaluate(() => document.querySelector('a#back')?.getAttribute('href')));
      const r = {};
      const go = async () => { await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {}); return page.url() === BASE; };
      await T(page, 60);
      r.playing = await reachable(page, 'a#back') && await go();
      await gotoM(page);
      await page.click('#helpBtn'); await wait(page, 100);
      r.helpOpen = (await dom(page)).overlay === 'help';
      r.help = await reachable(page, 'a#back') && await go();
      await gotoM(page);
      await page.click('#pauseBtn'); await wait(page, 100);
      r.pausedOpen = (await dom(page)).overlay === 'paused';
      r.paused = await reachable(page, 'a#back') && await go();
      await gotoM(page);
      // ページの時計を止めて wait でだけ進める（止めないと WebKit ではページの時刻がずれ、0.7 秒進めても 0.6 秒のカードがまだ出ていないことがある。FW2 と同じ。T-16）
      await frozen(page, async () => {
        for (let i = 0; i < 3; i++) await crashOnce(page);
        await wait(page, 700);
        r.overOpen = (await dom(page)).overlay === 'over';
        r.overReach = await reachable(page, 'a#back');
      });
      r.over = r.overReach && await go();
      check('遊んでいる途中・遊び方・一時停止・終わりのカードのどれからも a#back が見えて押せ、メニューが開く', Object.values(r).every(Boolean), r);
      await gotoM(page);
      await frozen(page, async () => {   // 1.3 秒＝カード 0.6 秒＋押せない 0.6 秒のあと（T-16）
        for (let i = 0; i < 3; i++) await crashOnce(page);
        await wait(page, 1300);
      });
      await page.click('#menuBtn'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('終わりのカードの「メニューへ」（#menuBtn）でメニューが開く', page.url() === BASE && await page.locator('a.game').count() >= 2, page.url());
      await ctx.close();
    },
  },
  {
    id: 'FW5', tier: 'smoke', title: 'ミチビキ空港 中断：遊んでいる途中で hidden にすると paused（一時停止カード）、時間を進めても tick が増えない、visible でも止まったまま、#resumeBtn で再開して進む',
    async run({ browser, check }) {
      const { ctx, page } = await openM(browser, 'FW5', { v: SMOKE_V() });
      await page.evaluate(() => window.MichibikiGame.manual(false));
      await wait(page, 1000);
      const t0 = (await gs(page)).tick;
      check(`manual(false) ならページの時間で進む（1 秒で tick ${t0}）`, t0 >= 40, t0);
      await setHidden(page, true); await wait(page, 50);
      const s1 = await gs(page);
      check(`hidden で phase paused・一時停止カード（${(await dom(page)).overlay}）`, s1.phase === 'paused' && (await dom(page)).overlay === 'paused' && (await dom(page)).phase === 'paused', s1.phase);
      await wait(page, 2000);
      const s2 = await gs(page);
      check(`隠れている間に 2 秒たっても tick が増えない（${s1.tick} → ${s2.tick}）`, s2.tick === s1.tick, [s1.tick, s2.tick]);
      await setHidden(page, false); await wait(page, 1000);
      const s3 = await gs(page);
      check(`visible に戻っても止まったまま（phase ${s3.phase}・tick ${s3.tick}）、#resumeBtn にフォーカス`, s3.phase === 'paused' && s3.tick === s1.tick && (await page.evaluate(() => document.activeElement?.id)) === 'resumeBtn', s3.phase);
      await page.click('#resumeBtn'); await wait(page, 1000);
      const s4 = await gs(page);
      check(`#resumeBtn で再開し、同じ局面から進む（tick ${s1.tick} → ${s4.tick}）`, s4.phase === 'playing' && s4.tick > s1.tick && s4.tick <= s1.tick + 70 && (await dom(page)).overlay === null, s4.tick);
      // 遊び方を開いている間も止まる
      await page.click('#helpBtn'); await wait(page, 50);
      const h0 = (await gs(page)).tick;
      await wait(page, 1000);
      const h1 = (await gs(page)).tick;
      await page.click('#helpOk'); await wait(page, 50);
      check(`遊び方を開いている間も止まり（tick ${h0} → ${h1}）、閉じると一時停止カードに戻る（${(await dom(page)).overlay}）`, h1 === h0 && (await dom(page)).overlay === 'paused', [h0, h1]);
      await ctx.close();
    },
  },

  // ================= full =================
  {
    id: 'FW6', tier: 'full', title: 'ミチビキ空港 画面内：SE 縦・SE 横（568×270・568×320）・iPhone 13 縦横・iPad 縦横で、ボタン 44px 以上・safe-area 内・重ならない、#field が画面内、5 桁の着陸数・ベストでもはみ出さない、文字 12px 以上、横向きは wide で場の倍率 0.7 以上、iPad は 2.0 以下',
    async run({ browser, check }) {
      const views = [view('SE', 'p', 'app'), view('SE', 'p', 'safari'), view('SE', 'l', 'safari'), view('SE', 'l', 'app'), view('i13', 'p', 'app'), view('i13', 'l', 'app'), view('iPad', 'p', 'app'), view('iPad', 'l', 'app')];
      for (const v of views) {
        const { ctx, page } = await newPage(browser, v, `FW6 ${v.label}`, { clock: true });
        await gotoM(page, { 'michibiki.best': '99999' }, { start: false });
        await page.evaluate(() => { const G = window.MichibikiGame; G.restart(1); G.manual(true); });
        await T(page, 130);
        const wide = v.w > v.h;
        const sel = 'a#back, #helpBtn, #pauseBtn, #soundBtn, #score, #best, #lives, #field';
        const lp = await layoutProbe(page, sel, v.safe, { overlapSel: sel, minSel: 'a#back, #helpBtn, #pauseBtn, #soundBtn' });
        check(`${v.label}：ボタンと場が画面内・safe-area 内・重ならない・44px 以上・横スクロールなし`, lp.n >= 8 && !lp.outside.length && !lp.overlaps.length && !lp.small.length && !lp.hscroll, lp);
        const s = await gs(page);
        check(`${v.label}：layout ${s.layout}（${wide ? '横は wide' : '縦は tall'}）・倍率 ${s.scale.toFixed(2)}（横は 0.7 以上・2.0 以下）`, s.layout === (wide ? 'wide' : 'tall') && s.scale <= 2.0 + 1e-9 && (!wide || s.scale >= 0.7), { layout: s.layout, scale: s.scale });
        const fit = await page.evaluate(() => {
          const sc = document.querySelector('#score'), be = document.querySelector('#best');
          sc.textContent = '99999';
          const f = (e) => e.scrollWidth <= e.clientWidth + 0.5 && e.getBoundingClientRect().right <= innerWidth + 0.5;
          const small = [...document.querySelectorAll('#app *')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && e.getBoundingClientRect().width > 0 && !e.closest('[hidden]')).filter((e) => parseFloat(getComputedStyle(e).fontSize) < 12 - 0.01).map((e) => `${e.id || e.className}:${getComputedStyle(e).fontSize}`);
          return { score: f(sc), best: f(be), bestText: be.textContent.trim(), small };
        });
        check(`${v.label}：5 桁（99999）の着陸数・ベストがはみ出さない、文字 12px 以上`, fit.score && fit.best && fit.bestText === '99999' && fit.small.length === 0, fit);
        await ctx.close();
      }
    },
  },
  {
    id: 'FW7', tier: 'full', title: 'ミチビキ空港 向きの変化：遊んでいる途中で縦 → 横にすると一時停止、layout は tall のまま、つづけると同じ局面から、次の回（さいしょから）は wide',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, custom(390, 844, null, 'iPhone 13 縦'), 'FW7', { clock: true });
      await gotoM(page, {}, { start: false });
      await page.evaluate(() => { const G = window.MichibikiGame; G.restart(5); G.manual(true); });
      await T(page, 150);
      const s0 = await gs(page);
      check('縦向きで始めると tall', s0.layout === 'tall' && s0.phase === 'playing', s0.layout);
      await page.setViewportSize({ width: 844, height: 390 }); await wait(page, 200);
      const s1 = await gs(page);
      check(`横にすると一時停止（phase ${s1.phase}・カード ${(await dom(page)).overlay}）、layout は tall のまま、局面も同じ（tick ${s1.tick}）`, s1.phase === 'paused' && (await dom(page)).overlay === 'paused' && s1.layout === 'tall' && s1.tick === s0.tick && JSON.stringify(s1.planes) === JSON.stringify(s0.planes), { phase: s1.phase, layout: s1.layout });
      await page.click('#resumeBtn'); await wait(page, 50);
      const s2 = await gs(page);
      await T(page, 10);
      check('つづけると同じ局面から進む（layout tall・tick が続きから）', s2.phase === 'playing' && s2.layout === 'tall' && s2.tick === s0.tick && (await gs(page)).tick === s0.tick + 10, { s2: s2.tick });
      await page.click('#pauseBtn'); await wait(page, 50);
      await page.click('#restartBtn'); await wait(page, 50);
      await page.click('#restartOkBtn'); await wait(page, 100);
      const s3 = await gs(page);
      check(`次の回（さいしょから）は横向きの wide（${s3.layout}・${s3.w}×${s3.h}）、#app[data-layout] も wide`, s3.layout === 'wide' && s3.w === 520 && s3.h === 320 && (await dom(page)).layout === 'wide', { layout: s3.layout });
      await ctx.close();
    },
  },
  {
    id: 'FW8', tier: 'full', title: 'ミチビキ空港 キーボード：→ ← で機体を選ぶ（Tab は選ばずボタンへ）、1 で あかの滑走路へ道が付く（guided）、P で一時停止／つづける、M で音、? で遊び方、カードが開いているときは場が反応しない',
    async run({ browser, check }) {
      const { ctx, page } = await openM(browser, 'FW8');
      const q = await firstPlane(page);
      await page.keyboard.press('ArrowRight'); await wait(page, 30);
      check(`→ で飛んでいる機体（id ${q.id}）を選ぶ`, (await gs(page)).selected === q.id, (await gs(page)).selected);
      await page.keyboard.press('1'); await wait(page, 30);
      const p1 = (await gs(page)).planes.find((x) => x.id === q.id);
      check('1 で あかの滑走路へのおまかせの道（guided・残りの点あり）', p1.pathLeft > 0 && p1.guided === true, p1);
      const u = await until(page, 's.landed >= 1', 2400);
      check('その道で着陸する', u.ok, u.s.landed);
      const q3 = await firstPlane(page);
      await page.focus('#back');
      await page.keyboard.press('Tab'); await wait(page, 30);
      const tb = await page.evaluate(() => ({ active: document.activeElement?.id || document.activeElement?.tagName, sel: window.MichibikiGame.getState().selected }));
      check(`Tab は機体を選ばず、ふつうにボタンへ移る（${tb.active}・selected ${tb.sel}。§19 A8）`, tb.sel === null && tb.active !== 'back' && tb.active !== 'BODY', tb);
      await page.keyboard.press('ArrowLeft'); await wait(page, 30);
      check(`← でも機体を選べる（${q3.id}）`, (await gs(page)).selected === q3.id, (await gs(page)).selected);
      await page.keyboard.press('Escape'); await wait(page, 30);
      await page.keyboard.press('p'); await wait(page, 30);
      const a = (await gs(page)).phase;
      await page.keyboard.press('P'); await wait(page, 30);
      const b = (await gs(page)).phase;
      check(`P で一時停止（${a}）、もう一度 P でつづける（${b}）`, a === 'paused' && b === 'playing', [a, b]);
      const m0 = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      await page.keyboard.press('m'); await wait(page, 30);
      const m1 = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      await page.keyboard.press('m');
      check(`M で音のオン／オフ（aria-pressed ${m0} → ${m1}）`, m0 !== m1 && ['true', 'false'].includes(m1), [m0, m1]);
      const id2 = await spawnAt(page, { color: 0, kind: 'normal', x: 200, y: 470, dx: -1, dy: 0 });
      await page.keyboard.press('?'); await wait(page, 30);
      check('? で遊び方のカード', (await dom(page)).overlay === 'help', await dom(page));
      const before = await gs(page);
      // Enter は「わかった」（フォーカスがある）を押すので使わない
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('1'); await page.keyboard.press('2'); await wait(page, 30);
      const after = await gs(page);
      const pb = after.planes.find((x) => x.id === id2);
      check('カードが開いている間は → ・1・2 で選ばれず、道も付かない', after.selected === before.selected && pb && pb.pathLeft === 0 && after.overlay === 'help', { sel: after.selected, pb });
      await page.keyboard.press('Escape'); await wait(page, 30);
      check('Esc で遊び方を閉じると一時停止カード（遊んでいた途中なので）', (await dom(page)).overlay === 'paused', await dom(page));
      await ctx.close();
    },
  },
  {
    id: 'FW9', tier: 'full', title: 'ミチビキ空港 タップでおまかせ：機体をタップ → 滑走路（帯）をタップで道が付き、機体が滑走路の奥の側にいても回り込んで矢印の向きから入り、着陸する。はじめてのタップでヒント。空いた所のタップで選びをやめる',
    async run({ browser, check }) {
      const { ctx, page } = await openM(browser, 'FW9');
      const q = await firstPlane(page);
      // 奥の側（滑走路の奥の端の上）へ連れていく
      await page.evaluate((id) => window.MichibikiGame.drawPath(id, [[60, 100], [180, 100], [215, 135], [230, 150]]), q.id);
      const u0 = await until(page, `s.planes.some((x) => x.id === ${q.id} && x.pathLeft === 0)`, 1500);
      const p0 = u0.s.planes.find((x) => x.id === q.id);
      check(`機体を滑走路の奥の側（${p0 && p0.x.toFixed(0)}, ${p0 && p0.y.toFixed(0)}）へ連れていけた`, u0.ok && p0 && p0.x > RED.ex + 60, p0);
      await tapField(page, p0.x, p0.y);
      const s1 = await gs(page);
      check(`機体をタップすると選ぶ（selected ${s1.selected}）、はじめてのタップでヒント「かっそうろを タップしても いいよ」`, s1.selected === q.id && /かっそうろを タップしても いいよ/.test(await hintText(page)), { sel: s1.selected, hint: await hintText(page) });
      await tapField(page, RED.ex + 48, RED.ey);
      const p1 = (await gs(page)).planes.find((x) => x.id === q.id);
      check('滑走路の帯をタップすると、おまかせの道（guided）が付き、選びが終わる', p1 && p1.pathLeft > 0 && p1.guided === true && (await gs(page)).selected === null, p1);
      const u1 = await until(page, `s.landed >= 1 || evs.some((e) => e.type === 'wrongway')`, 2400);
      check(`回り込んで矢印の向きから入り、着陸する（wrongway なし）`, u1.ok && u1.s.landed === 1 && !u1.evs.some((e) => e.type === 'wrongway'), u1.evs.filter((e) => e.type !== 'near'));
      // 空いた所のタップで選びをやめる
      const id2 = await spawnAt(page, { color: 0, kind: 'normal', x: 160, y: 470, dx: 1, dy: 0 });
      const p2 = (await gs(page)).planes.find((x) => x.id === id2);
      await tapField(page, p2.x, p2.y);
      const sel = (await gs(page)).selected;
      await tapField(page, 260, 240);
      const sel2 = (await gs(page)).selected;
      await tapField(page, RED.ex + 48, RED.ey);
      const p3 = (await gs(page)).planes.find((x) => x.id === id2);
      check(`空いた所をタップすると選びをやめ（${sel} → ${sel2}）、そのあと滑走路をタップしても道は付かない`, sel === id2 && sel2 === null && p3 && p3.pathLeft === 0, { sel, sel2, p3 });
      // 案内の帯（手前）をタップしてもよい
      await tapField(page, p3.x, p3.y);
      await tapField(page, RED.ex - 30, RED.ey);
      const p4 = (await gs(page)).planes.find((x) => x.id === id2);
      check('案内の帯（入り口の手前）をタップしても、おまかせの道が付く', p4 && p4.pathLeft > 0 && p4.guided === true, p4);
      await ctx.close();
    },
  },
  {
    id: 'FW10', tier: 'full', audio: true, title: 'ミチビキ空港 効果音：warn・pick・lock・land・near・crash・open・over が起きた順に鳴り、音の部品が動く。♪でオフにすると鳴らない',
    async run({ browser, check }) {
      const { ctx, page } = await openM(browser, 'FW10', { opts: { initScript: SFX_SPY } });
      const q = await firstPlane(page);
      await tapField(page, q.x, q.y);               // pick
      await sleep(300);
      await mbDrag(page, goodPath(q));               // lock
      await sleep(300);
      const u = await until(page, 's.landed >= 1', 1500);   // land
      await sleep(300);
      await until(page, 'evs.some((e) => e.type === "warn")', 900);   // warn
      await sleep(300);
      await page.evaluate(() => { const G = window.MichibikiGame; G.spawn({ color: 1, x: 40, y: 440, dx: 1, dy: 0 }); G.spawn({ color: 1, x: 260, y: 480, dx: -1, dy: 0 }); });
      await until(page, 'evs.some((e) => e.type === "near")', 400);   // near
      await sleep(600);
      const ps1 = await plays(page);
      const idx = (n) => ps1.findIndex((p) => p.n === n);
      check(`pick → lock → land の順、warn・near も鳴る（${[...new Set(ps1.map((p) => p.n))].join(',')}）`, u.ok && idx('pick') >= 0 && idx('lock') > idx('pick') && idx('land') > idx('lock') && idx('warn') >= 0 && idx('near') >= 0, ps1.map((p) => p.n));
      const ld = ps1.find((p) => p.n === 'land');
      check(`land に着陸数（${ld && ld.a}）を渡す`, ld && ld.a === 1, ld);
      // open：着陸 4（§19 C2）。音の部品の上限を使い切らないよう、3 機のあと実時間で 1 秒待ってから 4 機目
      const r3 = await landN(page, 3, { seeds: [1, 2, 3, 4, 5, 6] });
      await sleep(1000);
      const r4 = await guideUntil(page, 4);
      if (r4.s.landed < 4) throw new Error(`種 ${r3.seed} で 4 機目が着陸しない`);
      await sleep(300);
      const op = (await plays(page)).find((p) => p.n === 'open');
      check(`着陸 4 で あおの滑走路が開くと open（引数 ${op && op.a}）`, !!op && op.a === 1, op);
      // crash・over
      let s = await gs(page);
      // ページの時計を止めて wait でだけ進める（FW4・FW2 と同じ。止めないと WebKit ではページの時刻がずれる。T-22）
      await frozen(page, async () => {
        for (let i = 0; i < 4 && !s.over; i++) { s = await crashOnce(page); await sleep(250); }
        await wait(page, 700);
      });
      const ps2 = await plays(page);
      const ic = ps2.findIndex((p) => p.n === 'crash'), io = ps2.findIndex((p) => p.n === 'over');
      check(`ぶつかると crash、終わると over（crash の後）`, s.over && ic >= 0 && io > ic, ps2.map((p) => p.n).slice(-12));
      const firsts = [...new Set(ps2.map((p) => p.n))].map((n) => ps2.find((p) => p.n === n));
      check('鳴らした音はすべて "michibiki" の音の表にあり、それぞれ最初の 1 回は音の部品が start した', ps2.every((p) => p.known) && firsts.every((p) => p.d > 0), firsts.filter((p) => !p.known || !p.d));
      // ♪でオフ
      await wait(page, 700);
      await page.click('#againBtn'); await wait(page, 100);
      await page.evaluate(() => window.MichibikiGame.manual(true));
      await page.click('#soundBtn'); await wait(page, 50);
      const n0 = (await plays(page)).length;
      const q2 = await firstPlane(page);
      await sleep(300);
      await tapField(page, q2.x, q2.y);
      await page.evaluate((id) => window.MichibikiGame.guide(id), q2.id);
      await until(page, 's.landed >= 1', 2400);
      const ps3 = (await plays(page)).slice(n0);
      check(`♪ でオフ（aria-pressed ${await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'))}）にすると、選ぶ・道・着陸で音の部品が動かない（${ps3.map((p) => `${p.n}:${p.d}`).join(',')}）`, ps3.length > 0 && ps3.every((p) => p.d === 0) && (await stored(page, 'blockpuzzle.sound')) === 'off', ps3);
      await page.click('#soundBtn');
      await ctx.close();
    },
  },
  {
    id: 'FW11', tier: 'full', title: 'ミチビキ空港 色覚：canvas の機体・滑走路・予告に印（○△□）が描かれている（drawLog.marks の位置と色が state と一致）、COLORS の印がすべて違う、開いた滑走路の色の名前と印がヒントに出る（あお・△／きいろ・□）',
    async run({ browser, check }) {
      const { ctx, page } = await openM(browser, 'FW11');
      const cs = await page.evaluate(() => window.MichibikiLogic.COLORS.map((c) => ({ id: c.id, hex: c.hex, mark: c.mark, name: c.name })));
      check(`COLORS 3 色：色・印・名前がすべて違う（${cs.map((c) => c.mark).join(',')}）`, cs.length === 3 && new Set(cs.map((c) => c.hex.toLowerCase())).size === 3 && new Set(cs.map((c) => c.mark)).size === 3 && new Set(cs.map((c) => c.name)).size === 3, cs);
      await firstPlane(page);
      await page.evaluate(() => window.MichibikiGame.spawn({ color: 0, edge: 'bottom', at: 0.5 }));
      await T(page, 1);
      const s = await gs(page), mk = s.drawLog.marks;
      const has = (kind, color, x, y) => mk.some((m) => m.kind === kind && m.color === color && (x === undefined || Math.hypot(m.x - x, m.y - y) <= 3));
      const lack = [
        ...s.planes.filter((p) => !has('plane', p.color, p.x, p.y)).map((p) => `機体 ${p.id}`),
        ...s.warns.filter((w) => !has('warn', w.color)).map((w) => `予告 ${w.id}`),
        ...s.runways.filter((r) => r.open && !has('runway', r.color)).map((r) => `滑走路 ${r.color}`),
      ];
      check(`機体 ${s.planes.length}・予告 ${s.warns.length}・開いた滑走路 ${s.runways.filter((r) => r.open).length} の印が描かれ、位置と色が state と一致（marks ${mk.length}）`, s.planes.length >= 1 && s.warns.length >= 1 && lack.length === 0, { lack, mk });
      const r6 = await landN(page, 4, { seeds: [1, 2, 3, 4, 5, 6] });
      const h6 = await hintText(page);
      check(`あおが開いたヒントに色の名前と印（「${h6}」）`, /あお/.test(h6) && /△/.test(h6), h6);
      const s6 = await gs(page);
      check('あおが開くと滑走路の印も あお で描く', s6.drawLog.marks.some((m) => m.kind === 'runway' && m.color === 1), s6.drawLog.marks.filter((m) => m.kind === 'runway'));
      const r18 = await landN(page, 12, { seeds: [r6.seed, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], maxTicks: 60000 });
      const h18 = await hintText(page);
      const s18 = await gs(page);
      check(`3色の滑走路が開いた状態（colors ${s18.colors}）で、きいろのヒントに色の名前と印（「${h18}」）、3本とも印あり`, s18.colors === 3 && /きいろ/.test(h18) && /□/.test(h18) && [0, 1, 2].every((c) => s18.drawLog.marks.some((m) => m.kind === 'runway' && m.color === c)), { h18, seed: r18.seed });
      await ctx.close();
    },
  },
  {
    id: 'FW12', tier: 'full', title: 'ミチビキ空港 動きを減らす：reducedMotion: reduce で calm が true、ぶつかったときにロジックを止める 0.4 秒はそのまま（通常の設定でも 0.4 秒）',
    async run({ browser, check }) {
      for (const calm of [true, false]) {
        const { ctx, page } = await openM(browser, `FW12 ${calm ? 'reduce' : '通常'}`, { opts: calm ? { reducedMotion: 'reduce' } : {} });
        check(`${calm ? '動きを減らす設定' : '通常の設定'}で getState().calm が ${calm}`, (await gs(page)).calm === calm, (await gs(page)).calm);
        await page.evaluate(() => { const G = window.MichibikiGame; G.spawn({ color: 1, kind: 'normal', x: 40, y: 470, dx: 1, dy: 0 }); G.spawn({ color: 1, kind: 'normal', x: 280, y: 470, dx: -1, dy: 0 }); });
        await T(page, 121 + 180);
        const lives0 = (await gs(page)).lives;
        await page.evaluate(() => window.MichibikiGame.manual(false));
        let s = await gs(page);
        for (let i = 0; i < 60 && s.lives === lives0; i++) { await wait(page, 30); s = await gs(page); }
        const tc = s.tick;
        await wait(page, 200);
        const t1 = (await gs(page)).tick;
        await wait(page, 500);
        const t2 = (await gs(page)).tick;
        check(`${calm ? '動きを減らす設定' : '通常の設定'}：ぶつかってから 0.2 秒は tick が止まり（${tc} → ${t1}）、0.4 秒を過ぎると進む（→ ${t2}）`, s.lives === lives0 - 1 && t1 === tc && t2 > tc, { lives: s.lives, tc, t1, t2 });
        await ctx.close();
      }
    },
  },
  {
    id: 'FW13', tier: 'full', title: 'ミチビキ空港 色が増える：着陸 4 で あおが開く（§19 C2）（open の出来事・ヒント・colors 2・滑走路が open）、次に出る機体が あお',
    async run({ browser, check }) {
      const { ctx, page } = await openM(browser, 'FW13');
      const r = await landN(page, 4, { seeds: [1, 2, 3, 4, 5, 6] });
      const op = r.evs.filter((e) => e.type === 'open');
      const l4 = r.evs.find((e) => e.type === 'land' && e.landed === 4);
      const s = await gs(page);
      check(`着陸 4 で open { color: 1 } が1回（4 機目の着陸と同じコマ ${l4 && l4.tick}・open ${op[0] && op[0].tick}）、colors 2、あおの滑走路が open（種 ${r.seed}）`, op.length === 1 && op[0].color === 1 && !!l4 && op[0].tick === l4.tick && s.colors === 2 && s.runways.find((x) => x.color === 1).open === true && s.runways.find((x) => x.color === 2).open === false, { op, colors: s.colors });
      check(`ヒント「あおい ひこうきが くるよ！ △の かっそうろへ」（${await hintText(page)}）`, /あおい ひこうきが くるよ/.test(await hintText(page)) && /△の かっそうろへ/.test(await hintText(page)), await hintText(page));
      const u = await until(page, 'evs.some((e) => e.type === "warn")', 900);
      const w = u.evs.find((e) => e.type === 'warn');
      check(`開いた直後に出る1機目の予告は あお（color ${w && w.color}）`, !!w && w.color === 1, u.evs.filter((e) => e.type === 'warn'));
      await ctx.close();
    },
  },
  {
    id: 'FW14', tier: 'full', title: 'ミチビキ空港 遊び方：初回だけ自動で出る（3 項目以内）、SE 縦横でスクロールなしで「わかった」が押せる、閉じると michibiki.help が "1"、次は出ない、はじめの「なぞってね」のヒント',
    async run({ browser, check }) {
      for (const v of [view('SE', 'p', 'app'), view('SE', 'l', 'safari')]) {
        const { ctx, page } = await newPage(browser, v, `FW14 ${v.label}`, { clock: true });
        await gotoM(page, {}, { help: false });
        const d = await dom(page);
        const info = await page.evaluate(() => {
          const ov = document.querySelector('#overlay'), b = document.querySelector('#helpOk');
          const r = b ? b.getBoundingClientRect() : null;
          return { role: ov.getAttribute('role'), lab: ov.getAttribute('aria-labelledby'), title: document.querySelector('#overlayTitle')?.textContent.trim(), items: [...document.querySelectorAll('#card li')].length, ok: !!r && r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.left >= 0 && r.right <= innerWidth + 0.5 && r.height >= 43.5 && r.width >= 43.5, scrollTop: ov.scrollTop, hit: !!r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b };
        });
        check(`${v.label}：初回は遊び方（data-kind help・role=dialog・aria-labelledby=overlayTitle・${info.items} 項目）、スクロールせずに「わかった」が画面内で押せる`, d.overlay === 'help' && info.role === 'dialog' && info.lab === 'overlayTitle' && info.items >= 1 && info.items <= 3 && info.ok && info.hit, { d, info });
        await page.click('#helpOk'); await wait(page, 100);
        check(`${v.label}：閉じると回が始まり、michibiki.help が "1"`, (await dom(page)).phase === 'playing' && (await stored(page, 'michibiki.help')) === '1', await dom(page));
        await page.reload(); await wait(page, 300);
        check(`${v.label}：2回目は遊び方を出さずにすぐ始める`, (await dom(page)).phase === 'playing' && (await dom(page)).overlay === null, await dom(page));
        await ctx.close();
      }
      const { ctx, page } = await openM(browser, 'FW14 なぞってね');
      await firstPlane(page);
      await T(page, 3 * 60 + 5);
      const h = await hintText(page);
      check(`はじめの1機が出て 3 秒たっても道が無ければ「ひこうきから なぞってね」（${h}）`, /ひこうきから なぞってね/.test(h), h);
      await ctx.close();
    },
  },
  {
    id: 'FW15', tier: 'full', cdp: 'CDP のタッチ操作（ダブルタップ・2本指・4本指）', title: 'ミチビキ空港 タッチ：#field をダブルタップしても拡大しない、2本の指で2機を同時に導ける（CDP の2点タッチ）、4本目の指は無視',
    async run({ browser, check }) {
      const TE_SPY = () => { window.__te = []; window.addEventListener('touchend', (e) => window.__te.push({ p: e.defaultPrevented })); };
      const { ctx, page } = await newPage(browser, custom(390, 664, null, 'iPhone 13 Safari'), 'FW15', { device: 'iPhone 13', initScript: TE_SPY, clock: true });
      await gotoM(page);
      const t = await touch(ctx, page);
      const [fx, fy] = await scr(page, 160, 470);
      await page.evaluate(() => window.__te.splice(0));
      await t.tap(fx, fy); await sleep(100); await t.tap(fx, fy); await sleep(100);
      const ev = await page.evaluate(() => window.__te.splice(0));
      const ta = await page.evaluate(() => getComputedStyle(document.querySelector('#field')).touchAction);
      check(`#field のダブルタップで touchend を止め（${ev.map((e) => e.p).join(',')}）・touch-action ${ta}・拡大しない`, ev.length === 2 && ev.every((e) => e.p) && ta === 'none' && (await page.evaluate(() => window.visualViewport.scale)) === 1, { ev, ta });
      // 4機を出す（2本指・4本指の両方に使う）
      const ids = await page.evaluate(() => [{ x: 60, y: 460, dx: 1, dy: 0 }, { x: 260, y: 400, dx: -1, dy: 0 }, { x: 160, y: 250, dx: 0, dy: 1 }, { x: 250, y: 500, dx: -1, dy: 0 }].map((o) => window.MichibikiGame.spawn({ color: 1, kind: 'normal', ...o }).id));
      const us = await until(page, `${JSON.stringify(ids)}.every((id) => s.planes.some((q) => q.id === id))`, 600);
      if (!us.ok) throw new Error('4 機が出ない: ' + JSON.stringify(us.s.warns));
      const pos = async () => { const s = await gs(page); return ids.map((id) => s.planes.find((p) => p.id === id)); };
      let ps = await pos();
      const multi = async (planes, targets) => {
        const from = await Promise.all(planes.map((p) => scr(page, p.x, p.y)));
        const to = await Promise.all(targets.map(([x, y]) => scr(page, x, y)));
        await t.send('touchStart', from.map(([x, y], i) => ({ x, y, id: i + 1 })));
        for (let k = 1; k <= 8; k++) { await t.send('touchMove', from.map(([x, y], i) => ({ x: x + (to[i][0] - x) * k / 8, y: y + (to[i][1] - y) * k / 8, id: i + 1 }))); await sleep(16); }
        await t.send('touchEnd', []);
        await sleep(50);
      };
      await multi(ps.slice(0, 2), [[150, 380], [180, 300]]);
      ps = await pos();
      check(`2本の指で2機に同時に道が付く（残り ${ps[0] && ps[0].pathLeft}・${ps[1] && ps[1].pathLeft} 点）`, ps[0] && ps[1] && ps[0].pathLeft > 0 && ps[1].pathLeft > 0, ps.slice(0, 2));
      // 道を短くしてから、4本の指で
      await page.evaluate((ids) => { const G = window.MichibikiGame; for (const id of ids) { const p = G.getState().planes.find((q) => q.id === id); if (p && p.pathLeft) G.drawPath(id, [[p.x + p.dx * 8, p.y + p.dy * 8]]); } }, ids);
      await T(page, 20);
      const before = (await pos()).map((p) => p ? p.pathLeft : -1);
      ps = await pos();
      await multi(ps, [[100, 380], [200, 330], [200, 200], [180, 420]]);
      const after = (await pos()).map((p) => p ? p.pathLeft : -1);
      const got = after.filter((n, i) => n > before[i] + 2).length;
      check(`4本の指で触れても、道が付くのは3機まで（${got} 機。4本目は無視。残り ${before.join(',')} → ${after.join(',')}）`, got === 3 && after[3] <= before[3] + 2, { before, after });
      await ctx.close();
    },
  },
  {
    id: 'FW16', tier: 'full', title: 'ミチビキ空港 オフライン：sw.js の APP_FILES に games/michibiki/* がすべて入り、接続を切っても開いて遊べ、部品は Service Worker から読まれ、メニューに戻れる',
    async run({ browser, check, srv, root }) {
      const info = swInfo(root);
      const dir = path.join(root, 'games/michibiki');
      const actual = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : [];
      const want = [...new Set(['./games/michibiki/', ...['index.html', 'logic.js', 'render.js', 'input.js', 'main.js', ...actual].map((f) => `./games/michibiki/${f}`)])];
      const missing = want.filter((f) => !info.files.includes(f));
      check(`sw.js の APP_FILES に games/michibiki/ の ${want.length} 件がすべてある（足りない：${missing.join(' / ') || 'なし'}）`, missing.length === 0 && actual.length >= 5, missing);
      if (missing.length) return;
      srv.reset();
      const { ctx, page } = await newPage(browser, custom(390, 844, null, 'iPhone 13'), 'FW16', { sw: true, allowNetErrors: true });
      await page.goto(BASE);
      const ok = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]));
      if (!ok) throw new Error('Service Worker が 8 秒以内に有効にならない（事前キャッシュの install 失敗の可能性）');
      if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }); }
      await page.evaluate(() => localStorage.setItem('michibiki.help', '1'));
      await sleep(200);
      await srv.ctl('offline=1');
      const resp = [];
      page.on('response', (r) => { if (/\/games\/michibiki\/|\/common\/sfx\.js/.test(r.url())) resp.push({ f: r.url().split('/').slice(-2).join('/'), status: r.status(), sw: r.fromServiceWorker() }); });
      await page.goto(MB, { timeout: 10000 }); await sleep(500);
      const libs = await page.evaluate(() => ({ L: typeof window.MichibikiLogic?.update, R: typeof window.MichibikiRender?.create, I: typeof window.MichibikiInput?.attach, Y: typeof window.YubiSfx?.create, G: typeof window.MichibikiGame?.getState }));
      check('オフラインで開き、MichibikiLogic・MichibikiRender・MichibikiInput・YubiSfx・MichibikiGame が使える', Object.values(libs).every((x) => x === 'function'), libs);
      const js = ['logic.js', 'render.js', 'input.js', 'main.js', 'common/sfx.js'].map((f) => ({ f, hit: resp.find((r) => r.f.endsWith(f)) }));
      check('logic.js・render.js・input.js・main.js・sfx.js を Service Worker から 200 で読んだ', js.every((x) => x.hit && x.hit.sw && x.hit.status === 200), { js, resp });
      if (libs.G === 'function') {
        await page.evaluate(() => window.MichibikiGame.manual(true));
        const q = await firstPlane(page);
        await page.evaluate((id) => window.MichibikiGame.guide(id), q.id);
        const u = await until(page, 's.landed >= 1', 2400);
        check(`オフラインで遊べる（着陸 ${u.s.landed}）`, u.ok, u.s.landed);
      }
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('オフラインのまま、メニューに戻れる', page.url() === BASE && await page.locator('a.game').count() >= 2, page.url());
      await srv.ctl('offline=0');
      await ctx.close();
    },
  },
  {
    id: 'FW17', tier: 'full', title: 'ミチビキ空港 メニュー：カードの名前が MichibikiLogic.NAME と一致・絵がある、michibiki.best が 12 なら「12 き」、壊れた値・0 なら「まだ記録なし」、5 桁でもはみ出さない、押すとゲームが開く',
    async run({ browser, check, root }) {
      const f = path.join(root, 'games/michibiki/logic.js');
      if (!fs.existsSync(f)) throw new Error('games/michibiki/logic.js が無い');
      const NAME = createRequire(f)(f).NAME;
      const { ctx, page } = await newPage(browser, STD_V(), 'FW17', { clock: true });
      const card = () => page.evaluate(() => {
        const a = document.querySelector('a.game[href="games/michibiki/"]');
        if (!a) return null;
        const b = a.querySelector('.best b');
        const q = a.getBoundingClientRect(), cv = a.querySelector('canvas.art');
        let painted = false;
        if (cv && cv.width > 0) { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { painted = true; break; } }
        return { name: a.querySelector('.name')?.textContent.trim(), desc: a.querySelector('.desc')?.textContent.trim(), best: b?.textContent.trim(), none: b?.classList.contains('none'), aria: a.getAttribute('aria-label'), right: q.right, h: q.height, painted, fit: b ? b.scrollWidth <= b.clientWidth + 0.5 : false };
      });
      await seed(page, {});
      await page.goto(BASE); await wait(page, 200);
      const c0 = await card();
      check(`メニューにミチビキ空港のカードがあり、名前（${c0 && c0.name}）が MichibikiLogic.NAME（${NAME}）と一致、説明「${c0 && c0.desc}」、絵が描かれている`, !!c0 && c0.name === NAME && /かっそうろ/.test(c0.desc || '') && c0.h >= 44 && c0.painted, c0);
      check(`記録が無いときは「まだ記録なし」（${c0 && c0.best}）`, c0 && c0.best === 'まだ記録なし' && c0.none === true, c0);
      await seed(page, { 'michibiki.best': '12' });
      await page.goto(BASE); await wait(page, 200);
      const c1 = await card();
      check(`michibiki.best が 12 なら「12 き」（${c1 && c1.best}）、aria-label にも出る`, c1 && c1.best === '12 き' && !c1.none && /12 き/.test(c1.aria || ''), c1);
      const bad = [];
      for (const raw of ['abc', '-1', '1.5', '', '0', 'NaN', 'Infinity', '1e400', '{}', '9007199254740992']) {
        await seed(page, { 'michibiki.best': raw });
        await page.goto(BASE); await wait(page, 150);
        const c = await card();
        if (!c || c.best !== 'まだ記録なし') bad.push(`${raw}: ${c && c.best}`);
      }
      check('壊れた値・0（abc・負・小数・空・NaN・Infinity・1e400・{}・2^53）はぜんぶ「まだ記録なし」でメニューが落ちない', bad.length === 0, bad);
      for (const v of [STD_V(), view('SE', 'p', 'app')]) {
        await page.setViewportSize({ width: v.w, height: v.h });
        await seed(page, { 'michibiki.best': '99999' });
        await page.goto(BASE); await wait(page, 150);
        const c = await card();
        check(`${v.w}×${v.h}：記録 ${c && c.best} でカードがはみ出さない・省略されない`, c && /^99,?999 き$/.test(c.best) && c.right <= v.w + 0.5 && c.fit, c);
      }
      await page.click('a.game[href="games/michibiki/"]'); await page.waitForURL('**/games/michibiki/', { timeout: 5000 }).catch(() => {});
      check('メニューのミチビキ空港のカードを押すとゲームが開く', page.url() === MB, page.url());
      await ctx.close();
    },
  },
  {
    id: 'FW18', tier: 'full', solo: true, cdp: 'CDP の CPU 低速化', title: 'ミチビキ空港 性能：機体 10・道 400 点 × 3 本で、CPU 4倍遅く（CDP）して lastDrawMs の 95% が 8ms 以内、一時停止中は frames が増えない',
    async run({ browser, check }) {
      const { ctx, page } = await openM(browser, 'FW18', { v: view('SE', 'p', 'app') });
      await firstPlane(page);
      await page.evaluate(() => { const G = window.MichibikiGame; for (const y of [300, 400, 500]) for (const x of [110, 200, 290]) G.spawn({ color: 1, kind: 'normal', x, y, dx: 0, dy: -1 }); G.spawn({ color: 1, x: 20, y: 500, dx: 1, dy: 0 }); G.spawn({ color: 1, x: 300, y: 40, dx: -1, dy: 0 }); });
      // 1機目の近くの出る位置は待たされるので、予備の位置を2つ足す
      await until(page, 's.planes.length >= 10', 400);
      const s = await gs(page);
      const zig = [];
      for (let row = 0; zig.length < 400; row++) for (let i = 0; i < 40 && zig.length < 400; i++) zig.push([row % 2 ? 300 - i * 7 : 20 + i * 7, 20 + row * 7]);
      const pr = await page.evaluate(([ids, zig]) => ids.map((id) => window.MichibikiGame.drawPath(id, zig).ok), [s.planes.slice(0, 3).map((p) => p.id), zig]);
      const s2 = await gs(page);
      check(`機体 ${s2.planes.length}・400 点の道 ${s2.planes.filter((p) => p.pathLeft >= 390).length} 本`, s2.planes.length >= 10 && pr.every(Boolean) && s2.planes.filter((p) => p.pathLeft >= 390).length >= 3, s2.planes.map((p) => p.pathLeft));
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const ms = await page.evaluate(() => { const G = window.MichibikiGame, a = []; for (let i = 0; i < 60; i++) { G.tick(0); a.push(G.getState().lastDrawMs); } return a; });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const sorted = [...ms].sort((a, b) => a - b), p95 = sorted[Math.floor(sorted.length * 0.95) - 1];
      check(`CPU 4倍遅くで 1 コマの描画の 95% が 8ms 以内（95% ${p95 && p95.toFixed(2)}ms・最大 ${sorted[sorted.length - 1].toFixed(2)}ms）`, ms.every((x) => typeof x === 'number') && p95 <= 8, sorted);
      await page.evaluate(() => { const G = window.MichibikiGame; G.manual(false); G.pause(); });
      await wait(page, 100);
      const f0 = (await gs(page)).frames;
      await wait(page, 1000);
      const f1 = (await gs(page)).frames;
      check(`一時停止中は描き直さない（frames ${f0} → ${f1}）`, (await gs(page)).phase === 'paused' && f1 === f0, [f0, f1]);
      await ctx.close();
    },
  },
  {
    id: 'FW19', tier: 'full', timeout: 120000, title: 'ミチビキ空港 向きの矢印と逆向き：drawLog.arrows に 3 本の滑走路すべての矢印（閉じた滑走路も open: false）があり、向きが runways と一致・位置が入り口の近く。逆向きで区域に入ると着陸せず通り過ぎ、その滑走路の矢印が lit（0.6 秒後に消える）、#hint「やじるしの むきから はいろう」、同じ回で4回目の逆向きではヒントが出ない（ほかの機体の逆向きも回の3回に数える）',
    async run({ browser, check }) {
      const { ctx, page } = await openM(browser, 'FW19');
      await T(page, 1);
      const s = await gs(page), ar = s.drawLog.arrows;
      const aBad = s.runways.filter((r) => { const a = ar.find((x) => x.color === r.color); return !a || a.dx !== r.dx || a.dy !== r.dy || a.open !== r.open || Math.hypot(a.x - r.ex, a.y - r.ey) > 22 || a.lit; });
      check(`矢印が 3 本（${ar.length}）、向き・open（${ar.map((a) => a.open).join(',')}）が runways と一致、入り口から ZONE_R 以内、はじめは光っていない`, ar.length === 3 && s.runways.length === 3 && aBad.length === 0 && ar.filter((a) => !a.open).length === 2, { ar, runways: s.runways });
      let hints = [], lits = [], landed = 0, lost = false, used = null, cum = 0, expects = [];
      // 回の間はページの時間を止め、wait の分だけ進める（重いと、長い until の間に実時間で進んだ時計が戻り、ヒントの 3 秒が過ぎないまま次を読んだ。T-24）
      await frozen(page, async () => {
      for (const sd of REV_SEEDS) {
      await fresh(page, sd);
      const q = await firstPlane(page);
      await page.evaluate(([id, pts]) => window.MichibikiGame.drawPath(id, pts), [q.id, badPath(q).slice(1)]);
      hints = []; lits = []; landed = 0; lost = false; let crashed = false;
      cum = 0; expects = [];   // ヒントは回の中の wrongway（ほかの機体の分も）3 回まで
      await page.evaluate(() => { window.__mbWrong = 0; });
      for (let k = 0; k < 4; k++) {
        const u = await until(page, `evs.some((e) => e.type === 'wrongway' && e.id === ${q.id}) || evs.some((e) => e.type === 'crash' && e.ids.includes(${q.id}))`, 2400);
        if (u.evs.some((e) => e.type === 'crash' && e.ids.includes(q.id))) { crashed = true; break; }
        for (const e of u.evs) if (e.type === 'wrongway') { cum++; if (e.id === q.id) expects.push(cum <= 3); }
        if (!u.ok) { lost = `${k + 1} 回目の wrongway が無い（${JSON.stringify(u.evs.filter((e) => e.type !== 'bounce').slice(-5))}・${JSON.stringify(u.s.planes.find((x) => x.id === q.id))}）`; break; }
        hints.push(u.s.hint.trim());
        const st = u.s;
        lits.push(st.drawLog.arrows.find((a) => a.color === 0).lit);
        landed = st.landed;
        if (k === 0) {   // 0.7 秒ちょうどで見る（T-22。時間は外側の frozen で止まっている）
          await wait(page, 700); await T(page, 0);
          lits.push((await gs(page)).drawLog.arrows.find((a) => a.color === 0).lit);
        }
        // 区域を出たら、また逆向きに入る道（ヒントが消える 3 秒を待つ）
        const out = await until(page, `s.planes.some((x) => x.id === ${q.id} && x.x < 72) || evs.some((e) => e.type === 'crash' && e.ids.includes(${q.id}))`, 600);
        cum += out.evs.filter((e) => e.type === 'wrongway').length;
        if (out.evs.some((e) => e.type === 'crash' && e.ids.includes(q.id))) { crashed = true; break; }
        if (!out.ok) { lost = `${k} 回目のあと区域を出ない（${JSON.stringify(out.s.planes.find((x) => x.id === q.id))}）`; break; }
        await wait(page, 3100);
        await page.evaluate((id) => window.MichibikiGame.drawPath(id, [[40, 120], [40, 100], [170, 100], [170, 170], [130, 170], [100, 170], [70, 170], [50, 170]]), q.id);
      }
      if (!crashed) { used = sd; break; }
      }
      });
      check(`逆向きで区域に4回入っても、その機体は着陸しない（落ちずに残る。種 ${used}）`, used !== null && !lost && landed === 0, { lost, landed, used });
      check(`1回目の逆向きで あかの矢印が lit: true、0.6 秒後に false（${lits.slice(0, 2).join('→')}）`, lits[0] === true && lits[1] === false, lits);
      check(`回の中の wrongway（ほかの機体の分も数える）3 回目までは #hint「${HINT_WRONG}」、それより後は出ない（${hints.map((h, i) => `${expects[i] ? '出る' : '出ない'}:${h || '（なし）'}`).join(' / ')}）`, hints.length === 4 && expects.length === 4 && expects[0] === true && expects[3] === false && hints.every((h, i) => h.includes(HINT_WRONG) === expects[i]), { hints, expects });
      await ctx.close();
    },
  },
  // ================= §19 レビュー後の直し =================
  {
    id: 'FW20', tier: 'smoke', title: 'ミチビキ空港 §19 A1・A4：機体のうしろ 30 をつかんで前へなぞっても Uターンしない（最初の setPath で機体から PICK_R 以内の先頭の点を捨てる）、少し（場の単位 8 未満）動かして 300ms より長く押して離してもタップとして選ぶ',
    async run({ browser, check }) {
      const { ctx, page } = await openM(browser, 'FW20', { v: SMOKE_V() });
      const id = await spawnAt(page, { color: 1, kind: 'normal', x: 120, y: 470, dx: 1, dy: 0 });
      const p = (await gs(page)).planes.find((q) => q.id === id);
      await mbDrag(page, [[p.x - 30, p.y], [p.x - 10, p.y], [p.x + 20, p.y], [p.x + 60, p.y], [p.x + 110, p.y]], { steps: 5 });
      await T(page, 3);
      const a = (await gs(page)).planes.find((q) => q.id === id);
      check(`うしろからつかんで前へなぞると、前へ進む（向き dx ${a && a.dx.toFixed(2)}・x ${p.x.toFixed(1)} → ${a && a.x.toFixed(1)}・道 ${a && a.pathLeft} 点）`, !!a && a.dx > 0.9 && a.x > p.x && a.pathLeft > 0, a);
      // A4：場の単位で 8 未満だけ動かし、400ms 押してから離す
      const id2 = await spawnAt(page, { color: 1, kind: 'normal', x: 160, y: 300, dx: 0, dy: 1 });
      const q = (await gs(page)).planes.find((x) => x.id === id2);
      const [cx, cy] = await scr(page, q.x, q.y);
      const k = await page.evaluate(() => window.MichibikiGame.getState().scale);
      await page.mouse.move(cx, cy); await page.mouse.down();
      await page.mouse.move(cx + Math.min(5 * k, 12), cy, { steps: 3 });
      await wait(page, 400);
      await page.mouse.up(); await wait(page, 30);
      const s2 = await gs(page);
      check(`少し動かして 400ms 押してから離しても、なぞりにならずタップとして機体を選ぶ（selected ${s2.selected}・道 ${s2.planes.find((x) => x.id === id2)?.pathLeft}）`, s2.selected === id2 && s2.planes.find((x) => x.id === id2).pathLeft === 0, s2.selected);
      await ctx.close();
    },
  },
  {
    id: 'FW21', tier: 'smoke', title: 'ミチビキ空港 §19 A2・B2・B9：着陸したらすぐ michibiki.best に保存・#best も更新、「さいしょから」は確認カード（さいしょから？・もどる が primary・Esc／Ⅱ で一時停止カードへ）を出してから やめる で新しい回、ベストは残る。次の回で超えると #score[data-over-best]、終わりのカードの「ベスト こうしん！」は回を始めたときのベストと比べる、2 機以下で終わると #overTip',
    async run({ browser, check }) {
      const { ctx, page } = await openM(browser, 'FW21', { v: SMOKE_V() });
      const q = await firstPlane(page);
      await page.evaluate((id) => window.MichibikiGame.guide(id), q.id);
      const u = await until(page, 's.landed >= 1', 2400);
      check(`着陸したその場で michibiki.best が "1"（${await stored(page, 'michibiki.best')}）・#best も 1`, u.ok && (await stored(page, 'michibiki.best')) === '1' && (await dom(page)).best === '1', await dom(page));
      await page.click('#pauseBtn'); await wait(page, 50);
      await page.click('#restartBtn'); await wait(page, 50);
      const cf = await page.evaluate(() => ({ title: document.querySelector('#overlayTitle')?.textContent.trim(), kind: document.querySelector('#overlay').dataset.kind, phase: window.MichibikiGame.getState().phase, focus: document.activeElement?.id, primary: document.querySelector('#card .primary')?.id, ok: !!document.querySelector('#restartOkBtn'), text: document.querySelector('#card').textContent.replace(/\s+/g, ' ') }));
      check(`「さいしょから」は確認カード（${cf.title}・data-kind ${cf.kind}・phase ${cf.phase}・primary ${cf.primary}・フォーカス ${cf.focus}）`, cf.title === 'さいしょから？' && cf.kind === 'paused' && cf.phase === 'paused' && cf.primary === 'restartBackBtn' && cf.focus === 'restartBackBtn' && cf.ok && /いまの ゲームを やめて さいしょから？/.test(cf.text), cf);
      await page.keyboard.press('Escape'); await wait(page, 30);
      const e1 = await page.evaluate(() => ({ title: document.querySelector('#overlayTitle')?.textContent.trim(), resume: !!document.querySelector('#resumeBtn'), phase: window.MichibikiGame.getState().phase }));
      await page.click('#restartBtn'); await wait(page, 30);
      // 確認のカードがヘッダーを覆うので、Ⅱ はページの中で押す（ハンドラの確認）
      await page.evaluate(() => document.querySelector('#pauseBtn').click()); await wait(page, 30);
      const e2 = await page.evaluate(() => ({ title: document.querySelector('#overlayTitle')?.textContent.trim(), resume: !!document.querySelector('#resumeBtn'), phase: window.MichibikiGame.getState().phase }));
      await page.click('#restartBtn'); await wait(page, 30);
      await page.click('#restartBackBtn'); await wait(page, 30);
      const e3 = await page.evaluate(() => ({ title: document.querySelector('#overlayTitle')?.textContent.trim(), resume: !!document.querySelector('#resumeBtn'), landed: window.MichibikiGame.getState().landed }));
      check(`確認中に Esc・Ⅱ・「もどる」で一時停止カード（ひとやすみ）へ戻り、回はそのまま（${e1.title}／${e2.title}／${e3.title}・landed ${e3.landed}）`, [e1, e2, e3].every((e) => e.title === 'ひとやすみ' && e.resume) && e1.phase === 'paused' && e2.phase === 'paused' && e3.landed === 1, { e1, e2, e3 });
      await page.click('#restartBtn'); await wait(page, 30);
      await page.click('#restartOkBtn'); await wait(page, 100);
      const s1 = await gs(page);
      check(`「やめる」で新しい回（landed ${s1.landed}・phase ${s1.phase}）、ベストは 1 のまま（保存 ${await stored(page, 'michibiki.best')}・#best ${(await dom(page)).best}）`, s1.phase === 'playing' && s1.landed === 0 && s1.best === 1 && (await stored(page, 'michibiki.best')) === '1' && (await dom(page)).best === '1', s1.landed);
      // 次の回で 2 機（回を始めたときのベスト 1 を超える）→ ぶつかって終わり
      const r = await landN(page, 2, { seeds: [1, 2, 3, 4, 5, 6] });
      const ob = await page.evaluate(() => document.querySelector('#score').dataset.overBest);
      check(`回を始めたときのベスト 1 を超えると #score[data-over-best="1"]（${ob}）、保存も 2（種 ${r.seed}）`, ob === '1' && (await stored(page, 'michibiki.best')) === '2', ob);
      let s = await gs(page), card = '', tip = null;
      await frozen(page, async () => {
        for (let i = 0; i < 5 && !s.over; i++) s = await crashOnce(page);
        await wait(page, 700);
        card = (await dom(page)).card;
        tip = await page.evaluate(() => document.querySelector('#overTip')?.textContent.trim() || null);
      });
      check(`終わりのカードは「ベスト こうしん！」（回を始めたときのベスト 1 と比べる）: ${card}`, s.over && /ベスト こうしん/.test(card), card);
      check(`#overTip は 2 機以下で終わったときだけ（この回 ${s.landed} 機・${tip}）`, s.landed <= 2 ? tip === 'つぎは かっそうろの やじるしを よく みてね' : tip === null, { landed: s.landed, tip });
      await ctx.close();
    },
  },
  {
    id: 'FW22', tier: 'full', title: 'ミチビキ空港 §19 A3：終わって 0.6 秒以内に pagehide → pageshow でも、終わりのカードが出て「もういちど」が押せる（押せない見た目も外れる）',
    async run({ browser, check }) {
      const { ctx, page } = await openM(browser, 'FW22');
      let s = await gs(page);
      await frozen(page, async () => {
        for (let i = 0; i < 5 && !s.over; i++) s = await crashOnce(page);
        await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
        await wait(page, 700);
      });
      const r = await page.evaluate(() => { const b = document.querySelector('#againBtn'); return { kind: document.querySelector('#overlay').hidden ? null : document.querySelector('#overlay').dataset.kind, again: !!b, locked: b ? b.getAttribute('aria-disabled') : 'なし' }; });
      check(`over（${s.over}）のすぐ後に pagehide → pageshow しても、カードが出て（${r.kind}）押せない見た目が外れる（aria-disabled ${r.locked}）`, s.over && r.kind === 'over' && r.again && r.locked === null, r);
      await page.evaluate(() => document.querySelector('#againBtn').click()); await wait(page, 100);
      const s2 = await gs(page);
      check(`「もういちど」で新しい回（phase ${s2.phase}・lives ${s2.lives}）`, s2.phase === 'playing' && s2.lives === 3 && !s2.over, s2.phase);
      await ctx.close();
    },
  },
  {
    id: 'FW23', tier: 'full', cdp: 'CDP の2点タッチ', title: 'ミチビキ空港 §19 A7：同じ機体を2本の指でなぞっても、2本目の指は無視（道は1本目の指のとおり）',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, custom(390, 664, null, 'iPhone 13 Safari'), 'FW23', { device: 'iPhone 13', clock: true });
      await gotoM(page);
      const id = await spawnAt(page, { color: 1, kind: 'normal', x: 160, y: 430, dx: 1, dy: 0 });
      const p = (await gs(page)).planes.find((q) => q.id === id);
      const t = await touch(ctx, page);
      const a0 = await scr(page, p.x, p.y), b0 = await scr(page, p.x + 4, p.y + 4);
      await t.send('touchStart', [{ x: a0[0], y: a0[1], id: 1 }]); await sleep(30);
      await t.send('touchStart', [{ x: a0[0], y: a0[1], id: 1 }, { x: b0[0], y: b0[1], id: 2 }]);
      for (let k = 1; k <= 10; k++) {
        const a = await scr(page, p.x + 10 * k, p.y - 6 * k), b = await scr(page, p.x - 6 * k, p.y + 6 * k);
        await t.send('touchMove', [{ x: a[0], y: a[1], id: 1 }, { x: b[0], y: b[1], id: 2 }]); await sleep(30);
      }
      await t.send('touchEnd', []); await sleep(50);
      await T(page, 20);
      const q = (await gs(page)).planes.find((x) => x.id === id);
      check(`2本目の指は無視され、機体は1本目の指の道（右上）へ進む（向き ${q && q.dx.toFixed(2)}, ${q && q.dy.toFixed(2)}）`, !!q && q.dx > 0 && q.dy < 0, q);
      await ctx.close();
    },
  },
  {
    id: 'FW24', tier: 'full', title: 'ミチビキ空港 滑走路の置き方（MC-15）：restart(seed, layout) は置き方 0、restart() を続けると前の回と違う置き方（2 種類以上）、getState().runways・#field[data-plan]・描いた矢印が置き方の表と同じ、置き方 1 でも おまかせで着陸できる、置き方が前の回と変わった回の はじめだけ「こんかいは かっそうろの ならびが ちがうよ」（最初の回・同じ置き方では出ない）',
    async run({ browser, check }) {
      const { ctx, page } = await openM(browser, 'FW24');
      const table = (layout, plan) => page.evaluate(([l, p]) => window.MichibikiLogic.RUNWAY_PLANS[l][p].map((r) => [r.ex, r.ey, r.dx, r.dy]), [layout, plan]);
      await fresh(page, 3, 'tall');
      await T(page, 1);
      const s0 = await gs(page), d0 = await page.evaluate(() => document.querySelector('#field').dataset.plan);
      check(`restart(3, 'tall') は置き方 0（今のテストのまま）：runways が あか (100,170)→・data-plan ${d0}`, s0.plan === 0 && d0 === '0' && s0.runways[0].ex === RED.ex && s0.runways[0].ey === RED.ey && s0.runways[0].dx === RED.dx, { plan: s0.plan, d0, runways: s0.runways });
      // restart()（種なし）を 7 回：続けて同じ置き方にならない・2 種類以上
      const plans = [], bad = [];
      for (let i = 0; i < 7; i++) {
        await page.evaluate(() => { const G = window.MichibikiGame; G.restart(); G.manual(true); });
        await T(page, 1);
        const s = await gs(page), d = await page.evaluate(() => document.querySelector('#field').dataset.plan);
        const want = await table(s.layout, s.plan);
        const rwOk = JSON.stringify(s.runways.map((r) => [r.ex, r.ey, r.dx, r.dy])) === JSON.stringify(want);
        const ar = s.drawLog.arrows;
        const arOk = ar.length === 3 && s.runways.every((r) => { const a = ar.find((x) => x.color === r.color); return a && a.dx === r.dx && a.dy === r.dy && Math.hypot(a.x - r.ex, a.y - r.ey) <= 22; });
        if (!(rwOk && arOk && d === String(s.plan))) bad.push({ i, plan: s.plan, d, rwOk, arOk });
        plans.push(s.plan);
      }
      check(`restart() を 7 回：getState().runways・#field[data-plan]・描いた矢印が置き方の表と同じ（${plans.join(',')}）`, bad.length === 0, bad);
      check(`続く 2 回で同じ置き方にならず、2 種類以上出る（${plans.join(',')}）`, plans.every((p, i) => i === 0 || p !== plans[i - 1]) && new Set(plans).size >= 2, plans);
      // 置き方 1 で、1 機目におまかせの道を付けると着陸
      await page.evaluate(() => { const G = window.MichibikiGame; G.restart(5, 'tall', 1); G.manual(true); });
      const s1 = await gs(page);
      const q = await firstPlane(page);
      await page.evaluate((id) => window.MichibikiGame.guide(id), q.id);
      const u = await until(page, 's.landed >= 1', 1500);
      check(`restart(5, 'tall', 1)：plan ${s1.plan}・あか (220,170)←、1 機目に おまかせの道を付けると着陸（landed ${u.s.landed}）`, s1.plan === 1 && s1.runways[0].ex === 220 && s1.runways[0].dx === -1 && u.ok && u.s.landed === 1, { s1: s1.runways, u: u.s });
      // 案内：置き方が前の回と違う回の はじめだけ出る（最初の回・同じ置き方では出ない）
      const MSG = 'こんかいは かっそうろの ならびが ちがうよ';
      let pg;
      const startP = (plan) => pg.evaluate((p) => { window.MichibikiGame.restart(7, 'tall', p); window.MichibikiGame.manual(true); }, plan);
      await ctx.close();
      const c2 = await openM(browser, 'FW24 plan-hint', { start: false });
      pg = c2.page;
      const h1 = await hintText(pg);   // 開いた直後の最初の回
      check(`最初の回では案内が出ない（「${h1}」）`, h1 !== MSG, h1);
      const p0 = (await gs(pg)).plan;
      await startP(p0);
      const h0 = await hintText(pg);
      check(`同じ置き方で始め直しても出ない（置き方 ${p0}・「${h0}」）`, h0 !== MSG, h0);
      await startP((p0 + 1) % 3);
      const h2 = await hintText(pg);
      check(`置き方が 違う置き方に変わった回の はじめに案内が出る（「${h2}」）`, h2 === MSG, h2);
      await startP((p0 + 1) % 3);
      const h3 = await hintText(pg);
      check(`同じ置き方（続けて）では出ない（「${h3}」）`, h3 !== MSG, h3);
      await startP(p0);
      const h4 = await hintText(pg);
      check(`元の置き方に変わるとまた出る（「${h4}」）`, h4 === MSG, h4);
      await pg.evaluate(() => window.MichibikiGame.tick(300));
      const h5 = await hintText(pg);
      check(`3 秒ほどで消える（「${h5}」）`, h5 !== MSG, h5);
      await c2.ctx.close();
    },
  },
];
