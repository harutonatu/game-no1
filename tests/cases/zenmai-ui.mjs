// Z: ゼンマイさんぽの画面（games/zenmai/）。契約の DOM（#stageList・#dial・#turns・#windPlus/#windMinus/#go・#overlay）と
// window.ZenmaiGame = { getState(), setTurns(n), go() } を使う。ロジックの計算は ZL（zenmai-logic.mjs）で確かめ済みなので、
// ここでは画面の中の ZenmaiLogic / ZenmaiStages を「期待値の計算機」として使う（simulate・bestTurns）。
// 円ドラッグ・素早い連続タップは CDP（Chromium 専用）。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { BASE, ZEN, DEVICES, view, custom, newPage, seed, layoutProbe, sleep, wait, frozen, touch, swInfo, SFX_SPY, plays, starts } from '../lib.mjs';

const CDP = 'CDP のタッチ操作（円ドラッグ・連続タップ）';
const PK = 'zenmai.progress';
const prog = (stars, unlocked) => ({ stars, unlocked });
const TE_SPY = () => {
  window.__te = [];
  window.addEventListener('touchend', (e) => window.__te.push({ p: e.defaultPrevented, t: e.target.id || e.target.className || e.target.tagName }));
};

// 舞台（canvas）に渡した view を記録する（ZenmaiRender.create の draw を包む）
const RENDER_SPY = () => {
  let v;
  Object.defineProperty(window, 'ZenmaiRender', { configurable: true, get: () => v, set(x) {
    const oc = x.create;
    x.create = function (...a) { const r = oc.apply(this, a); const od = r.draw; r.draw = function (st, view) { window.__zrView = view; return od.apply(this, arguments); }; return r; };
    v = x;
  } });
};

// ---------- 共通の操作 ----------
const HK = 'zenmai.help';                 // 遊び方を一度見たか（初回だけ自動で出る）。ほかの確認では見たことにして始める
async function openZ(page, items = {}) {
  await seed(page, { [HK]: '1', ...items });
  await page.goto(ZEN); await wait(page, 200);
}
const enabledStages = (p) => p.evaluate(() => [...document.querySelectorAll('#stageList button.stage')].filter((b) => !b.disabled).map((b) => b.dataset.id));
const starsOf = (p) => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#stageList button.stage')].map((b) => [b.dataset.id, Number(b.querySelector('.stars')?.dataset.stars ?? -1)])));
const stored = (p) => p.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return 'ERR'; } }, PK);
const startStage = async (p, id) => { await p.click(`#stageList button.stage[data-id=${id}]`); await wait(p, 250); };
const visible = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e || e.closest('[hidden]')) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; }, sel);
const turnsNow = (p) => p.evaluate(() => { const s = window.ZenmaiGame.getState() || {}; return typeof s.turns === 'number' ? s.turns : parseFloat(document.querySelector('#turns').textContent); });
const overlayInfo = (p) => p.evaluate(() => {
  const ov = document.querySelector('#overlay');
  const shown = !ov.hidden;
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none' && !e.hidden; };
  const cmds = shown ? [...ov.querySelectorAll('.card [data-cmd]')].filter(vis).map((b) => b.dataset.cmd) : [];
  return { shown, cmds, text: shown ? ov.querySelector('.card')?.textContent.replace(/\s+/g, ' ').trim() : '' };
});
// ゲームの時間を進めながら、結果の画面（#overlay）が出るまで待つ（最大 maxMs）
const isResult = (p) => p.evaluate(() => window.ZenmaiGame.getState().overlay === 'result');
async function waitOverlay(p, maxMs = 40000) {
  for (let t = 0; t < maxMs; t += 250) { await wait(p, 250); if (await isResult(p)) return true; }
  return false;
}
const phaseOf = (p) => p.evaluate(() => window.ZenmaiGame.getState().phase);
// 画面の中の ZenmaiLogic で、ステージごとの期待値を計算する
const calc = (p, id) => p.evaluate((id) => {
  const s = ZenmaiStages.find((x) => x.id === id), L = ZenmaiLogic, b = L.bestTurns(s);
  const scan = (res) => { for (let t = 0; t <= s.maxTurns + 1e-9; t += 0.05) if (L.simulate(s, t).result === res) return +t.toFixed(2); return null; };
  const q = Math.ceil(b.min * 4) / 4;                         // ★3 の範囲に入る 1/4 回転の倍数
  return { max: s.maxTurns, best: b, mid: (b.min + b.max) / 2, quarter: q <= b.max ? q : null, fall: scan('fall'), breakTurns: s.maxTurns + 0.25 };
}, id);
const sim = (p, id, t) => p.evaluate(([id, t]) => { const r = ZenmaiLogic.simulate(ZenmaiStages.find((x) => x.id === id), t); return { result: r.result, stars: r.stars, x: r.x }; }, [id, t]);
async function play(p, turns) {
  await p.evaluate((t) => { window.ZenmaiGame.setTurns(t); }, turns); await wait(p, 100);
  await p.evaluate(() => window.ZenmaiGame.go());
}
const nStages = (p) => p.evaluate(() => ZenmaiStages.length);

// ---------- 端末（smoke は一番狭い SE のホーム画面、full は全端末・縦横・Safari/ホーム画面） ----------
const SMOKE_V = () => view('SE', 'p', 'app');
// 全端末×縦横×2形態は多すぎる（同値分割）。一番狭い・標準・最大・iPad を、縦横とホーム画面/Safari の両方が一度は出るように選ぶ
const FULL_VIEWS = () => [
  view('SE', 'p', 'safari'), view('SE', 'l', 'safari'), view('SE', 'l', 'app'),
  view('i13', 'p', 'safari'), view('i13', 'l', 'safari'), view('i13', 'l', 'app'),
  view('PM', 'p', 'app'), view('PM', 'l', 'safari'),
  view('iPad', 'p', 'app'), view('iPad', 'l', 'safari'),
];

// ---------- 画面ごとの確認 ----------
async function listProbe(page, safe) {
  return page.evaluate((safe) => {
    const [t, r, b, l] = safe || [0, 0, 0, 0];
    const bt = [...document.querySelectorAll('#stageList button.stage')];
    const small = bt.filter((x) => { const q = x.getBoundingClientRect(); return q.width < 43.5 || q.height < 43.5; }).map((x) => x.dataset.id);
    const side = bt.filter((x) => { const q = x.getBoundingClientRect(); return q.left < l - 0.5 || q.right > innerWidth - r + 0.5; }).map((x) => x.dataset.id);
    const last = bt[bt.length - 1]; last?.scrollIntoView({ block: 'nearest' });
    const lq = last?.getBoundingClientRect();
    const reach = !!lq && lq.top >= -0.5 && lq.bottom <= innerHeight - b + 0.5;
    const cut = bt.filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.dataset.id);   // 文字・★が省略されていないか
    window.scrollTo(0, 0);
    return { n: bt.length, small, side, reach, cut, hscroll: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth };
  }, safe);
}
const TOP = '#back, #soundBtn, #helpBtn';
const PLAY_SEL = `${TOP}, #pauseBtn, #windPlus, #windMinus, #go, #dial, canvas#stage, #turns`;
const PLAY_BTNS = '#back, #soundBtn, #helpBtn, #pauseBtn, #windPlus, #windMinus, #go, #dial';
async function overlayProbe(page, safe) {
  return page.evaluate((safe) => {
    const [t, r, b, l] = safe || [0, 0, 0, 0];
    const ov = document.querySelector('#overlay'), card = ov.querySelector('.card');
    const head = card.querySelector('h1, h2, h3, .title') || card;
    const res = { btns: [], oy: getComputedStyle(ov).overflowY };
    ov.scrollTop = 0;
    const hq = head.getBoundingClientRect(); res.headTop = Math.round(hq.top);
    for (const x of card.querySelectorAll('button')) {
      if (x.hidden || !x.getBoundingClientRect().width) continue;
      x.scrollIntoView({ block: 'nearest' });
      const q = x.getBoundingClientRect(), c = card.getBoundingClientRect();
      res.btns.push({ cmd: x.dataset.cmd, w: Math.round(q.width), h: Math.round(q.height), inside: q.top >= t - 0.5 && q.bottom <= innerHeight - b + 0.5 && q.left >= l - 0.5 && q.right <= innerWidth - r + 0.5, wide: q.width / c.width });
    }
    ov.scrollTop = 0;
    res.hscroll = document.documentElement.scrollWidth > innerWidth;
    return res;
  }, safe);
}
const overlayOk = (o) => o.btns.length > 0 && o.headTop >= 0 && !o.hscroll && o.btns.every((b) => b.inside && b.h >= 43.5 && b.w >= 43.5)
  && (!o.btns.some((b) => b.cmd === 'retry') || o.btns.find((b) => b.cmd === 'retry').wide >= 0.7);

async function screensAt(browser, check, v, tag) {
  const { ctx, page } = await newPage(browser, v, `${tag} ${v.label}`, { clock: true });
  const head = `${v.label} ${v.w}×${v.h}${v.safe ? ' safe=' + v.safe.join('/') : ''}`;
  // ステージ選択（全部解放・★3 も表示される状態：最大の見た目）
  const all = {}; for (let i = 1; i <= 15; i++) all['z' + String(i).padStart(2, '0')] = 3;
  await openZ(page, { [PK]: prog(all, 15) });
  const top = await layoutProbe(page, TOP, v.safe, { overlapSel: TOP, minSel: TOP });
  const lp = await listProbe(page, v.safe);
  check(`${head}｜ステージ選択：上部3つが画面内・44px以上、15個のボタンが横にはみ出さず44px以上・★が省略されず最後まで届く・横スクロールなし`,
    top.n === 3 && !top.outside.length && !top.overlaps.length && !top.small.length && !top.hscroll && lp.n === 15 && !lp.small.length && !lp.side.length && lp.reach && !lp.cut.length && !lp.hscroll, { top, lp });
  // プレイ中
  await startStage(page, 'z01');
  const pr = await layoutProbe(page, PLAY_SEL, v.safe, { overlapSel: PLAY_BTNS + ', canvas#stage', minSel: PLAY_BTNS });
  check(`${head}｜プレイ中：戻る・♪・遊び方・一時停止・＋/－・歩かせる・ネジ・舞台が画面内で重ならず、ボタンは44px以上・横スクロールなし`, pr.n >= 9 && !pr.outside.length && !pr.overlaps.length && !pr.small.length && !pr.hscroll, pr);
  // 結果カード（★3 クリア：次へ・もう一度・ステージ選択・メニュー）と巻きすぎ
  const c = await calc(page, 'z01');
  await play(page, c.mid);
  const shown = await waitOverlay(page);
  const o1 = shown ? await overlayProbe(page, v.safe) : null;
  check(`${head}｜クリアのカード：ボタンに届き44px以上、もう一度は横幅いっぱい、見出しが切れない`, shown && overlayOk(o1), o1);
  await ctx.close();
}

export const tests = [
  {
    id: 'ZU0', tier: 'smoke', node: true, title: 'ゼンマイ 静的：index.html が契約の DOM と4つの部品・sfx.js を読み、sw.js が事前キャッシュし、sfx.play の音名が "zenmai" にある',
    run({ check, root }) {
      const html = fs.readFileSync(path.join(root, 'games/zenmai/index.html'), 'utf8');
      const need = ['back', 'soundBtn', 'helpBtn', 'stageList', 'stage', 'dial', 'turns', 'windPlus', 'windMinus', 'go', 'pauseBtn', 'overlay'];
      const miss = need.filter((id) => !new RegExp(`id=["']${id}["']`).test(html));
      check('契約の id がすべてある（back・soundBtn・helpBtn・stageList・stage・dial・turns・windPlus・windMinus・go・pauseBtn・overlay）', !miss.length, miss);
      check('a#back は href="../../"', /<a[^>]*id=["']back["'][^>]*href=["']\.\.\/\.\.\/["']|<a[^>]*href=["']\.\.\/\.\.\/["'][^>]*id=["']back["']/.test(html));
      const cmds = ['next', 'retry', 'stages', 'menu'].filter((c) => !html.includes(`data-cmd="${c}"`) && !html.includes(`data-cmd='${c}'`) && !html.includes(`data-cmd=${c}`));
      check('結果カードのボタン（next・retry・stages・menu）が data-cmd で書かれている', !cmds.length, cmds);
      const order = ['../../common/sfx.js', 'stages.js', 'logic.js', 'render.js', 'input.js'].map((f) => html.indexOf(f));
      check('sfx.js・stages.js・logic.js・render.js・input.js をすべて読み込む', order.every((i) => i >= 0), order);
      check('sfx.js を本体のスクリプトより前に読み込む', order[0] >= 0 && order[0] < html.search(/<script(?![^>]*src)/), order);
      check('外部ライブラリ・外部 URL の読み込みがない（Google Fonts 以外）', ![...html.matchAll(/(?:src|href)=["'](https?:)?\/\/(?!fonts\.(googleapis|gstatic)\.com)[^"']+/g)].length);
      check('viewport に user-scalable=no / viewport-fit=cover（既存ゲームと同じ）', /viewport-fit=cover/.test(html) && /(user-scalable=no|maximum-scale=1)/.test(html));
      const sw = swInfo(root);
      const files = ['./games/zenmai/', './games/zenmai/index.html', './games/zenmai/logic.js', './games/zenmai/stages.js', './games/zenmai/render.js', './games/zenmai/input.js'];
      check('sw.js の APP_FILES にゼンマイの6件', files.every((f) => sw.files.includes(f)), files.filter((f) => !sw.files.includes(f)));
      check('sw.js の CACHE_VERSION が更新されている（v11 のままでない）', sw.ver && sw.ver !== 'v11', sw.ver);
      const sandbox = { localStorage: { getItem: () => null, setItem() {} }, navigator: {} }; sandbox.globalThis = sandbox; vm.createContext(sandbox);
      vm.runInContext(fs.readFileSync(path.join(root, 'common/sfx.js'), 'utf8'), sandbox);
      const names = sandbox.YubiSfx.create('zenmai').names || [];
      const calls = [...html.matchAll(/sfx\.play\(\s*(["'`])([^"'`]+)\1/g)].map((m) => m[2]);
      // 変数や三項演算子での呼び出し（例 sfx.play(a ? "tick" : "unwind")）は、行の中の文字列をすべて音名として検査する
      const dynLines = [...html.matchAll(/sfx\.play\(\s*(?!["'`])[^\n]*/g)].map((m) => m[0]);
      calls.push(...dynLines.flatMap((l) => [...l.matchAll(/["']([a-z]+)["']/g)].map((m) => m[1])));
      const dynamic = dynLines.filter((l) => !/["'][a-z]+["']/.test(l)).length;
      check(`sfx.play ${calls.length} か所 [${[...new Set(calls)].join(', ')}] がすべて "zenmai" の音名にある`, calls.length > 0 && calls.every((n) => names.includes(n)) && !dynamic, { names, dynamic, bad: calls.filter((n) => !names.includes(n)) });
      const want = ['start', 'tick', 'unwind', 'limit', 'release', 'step', 'stop', 'fall', 'break', 'star', 'clear', 'best', 'toggle'];
      check('"zenmai" に契約の音名13個がすべてある', want.every((n) => names.includes(n)), want.filter((n) => !names.includes(n)));
      const own = /new (window\.)?(webkit)?AudioContext|createOscillator/.test(html);
      check('ゲーム側で AudioContext を直接作らない（common/sfx.js だけが作る）', !own);
    },
  },
  {
    id: 'ZU1', tier: 'smoke', title: 'データが消えない：★と解放がステージ選択に出る・失敗しても・再読み込みしても残る、壊れた保存データは安全に直る、ほかのゲームの保存は触らない',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, SMOKE_V(), 'ZU1', { clock: true });
      const saved = prog({ z01: 3, z02: 2 }, 3);
      await openZ(page, { [PK]: saved, 'blockpuzzle.best': '777', 'tile2048.best': '888' });
      const en = await enabledStages(page), st = await starsOf(page);
      check(`解放3つ（${en.join(',')}）で ★ は z01=3・z02=2（data-stars）`, en.length === 3 && st.z01 === 3 && st.z02 === 2, { en, st });
      // 失敗（巻きすぎ）しても ★ も解放も減らない
      await startStage(page, 'z01');
      const c = await calc(page, 'z01');
      await play(page, c.breakTurns);
      const shown = await waitOverlay(page);
      const o = await overlayInfo(page);
      check(`巻きすぎで失敗の画面が出る（もう一度・ステージ選択へ・メニューへ がある）：${o.cmds.join(',')}`, shown && ['retry', 'stages', 'menu'].every((x) => o.cmds.includes(x)), o);
      const s1 = await stored(page);
      check('失敗しても保存した ★3・★2・解放3 はそのまま', s1 && s1.stars?.z01 === 3 && s1.stars?.z02 === 2 && s1.unlocked === 3, s1);
      await page.reload(); await wait(page, 200);
      const en2 = await enabledStages(page), st2 = await starsOf(page);
      check('再読み込みしても ★・解放が残る', en2.length === 3 && st2.z01 === 3 && st2.z02 === 2, { en2, st2 });
      const other = await page.evaluate(() => [localStorage.getItem('blockpuzzle.best'), localStorage.getItem('tile2048.best')]);
      check('ほかのゲームの保存（ブロックのベスト・2048 のベスト）を消さない', other[0] === '777' && other[1] === '888', other);
      // 壊れた保存データ：読めない文字列・範囲外の★・範囲外の解放数。例外なく開き、画面の表示は validateProgress と一致、★は 0〜3
      for (const [label, raw] of [['JSON でない文字列', '{bad json'], ['★9・未知の id・解放-5', JSON.stringify({ stars: { z01: 9, zz: 2, z02: -1 }, unlocked: -5 })], ['解放99', JSON.stringify({ stars: { z01: 1 }, unlocked: 99 })], ['null', 'null'], ['配列', '[1,2]']]) {
        await seed(page, { [PK]: raw }); await page.goto(ZEN); await wait(page, 200);
        const r = await page.evaluate((raw) => ({ v: ZenmaiLogic.validateProgress(raw), n: ZenmaiStages.length }), raw);
        const en3 = await enabledStages(page), st3 = await starsOf(page);
        const okStars = Object.values(st3).every((x) => x >= 0 && x <= 3) && Object.entries(r.v.stars).every(([id, s]) => st3[id] === s);
        check(`壊れた保存（${label}）：開ける・解放 ${en3.length} 個＝validateProgress（${r.v.unlocked}）・★は0〜3`, en3.length === r.v.unlocked && en3.length >= 1 && en3.length <= r.n && okStars, { en3: en3.length, v: r.v, st3 });
      }
      await ctx.close();
    },
  },
  {
    id: 'ZU2', tier: 'smoke', title: 'メニューへ戻れる：ステージ選択・プレイ中・歩行中・一時停止・結果カードのどこからでも、画面からメニュー（またはステージ選択）へ出られる',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, SMOKE_V(), 'ZU2', { clock: true });
      // 初めて開くと遊び方のカードが出る。「わかった」で閉じ、♪の横の「遊び方」でまた開ける。カードの外のボタンに頼らず閉じられる
      await seed(page, {}); await page.goto(ZEN); await wait(page, 250);
      const h1 = await overlayInfo(page);
      check(`初めて開くと遊び方が出て、「わかった」で閉じられる（${h1.cmds.join(',')}）`, h1.shown && h1.cmds.includes('closeHelp'), h1);
      await page.click('#overlay [data-cmd=closeHelp]'); await wait(page, 150);
      const helpKept = await page.evaluate(() => localStorage.getItem('zenmai.help'));
      await page.reload(); await wait(page, 200);
      await page.click('#helpBtn'); await wait(page, 150);
      const h2 = await overlayInfo(page);
      await page.keyboard.press('Escape'); await wait(page, 150);
      check(`遊び方は2回目以降は自動で出ず（保存 ${helpKept}）、「遊び方」ボタンで開き Esc でも閉じる`, helpKept === '1' && h2.shown && !(await overlayInfo(page)).shown, { helpKept, h2 });
      const reachable = (sel) => page.evaluate((s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === e || e.contains(t)); }, sel);
      await openZ(page, { [PK]: prog({ z01: 1 }, 2) });
      check('a#back の href は ../../ で、メニュー（BASE）を指す', await page.evaluate(() => document.querySelector('#back').href) === BASE, await page.evaluate(() => document.querySelector('#back').getAttribute('href')));
      const r = {};
      r.list = await reachable('#back');
      await startStage(page, 'z01');
      r.play = await reachable('#back');
      const c = await calc(page, 'z01');
      await page.evaluate((t) => window.ZenmaiGame.setTurns(t), c.mid); await wait(page, 100);
      await page.evaluate(() => window.ZenmaiGame.go()); await wait(page, 300);
      r.walk = await reachable('#back');
      await waitOverlay(page);
      const ov = await overlayInfo(page);
      check(`結果カードに メニューへ・ステージ選択へ・もう一度 がある（${ov.cmds.join(',')}）`, ['menu', 'stages', 'retry'].every((x) => ov.cmds.includes(x)), ov);
      await page.click('#overlay [data-cmd=retry]'); await wait(page, 200);
      r.retry = await reachable('#back') && !(await overlayInfo(page)).shown;
      await page.click('#pauseBtn'); await wait(page, 200);
      const pv = await overlayInfo(page);
      r.pause = pv.shown && (pv.cmds.includes('menu') || await reachable('#back')) && (pv.cmds.includes('stages') || await reachable('#back'));
      check('どの状態でも #back を押せる（ステージ選択・プレイ・歩行・もう一度の後）、一時停止中はカード（メニューへ）かヘッダの戻るで出られる', r.list && r.play && r.walk && r.retry && r.pause, { r, pv });
      // 実際にステージ選択へ戻る → メニューへ
      if (pv.cmds.includes('stages')) { await page.click('#overlay [data-cmd=stages]'); await wait(page, 200); } else { await page.reload(); await wait(page, 200); }
      check('ステージ選択に戻れ、★が表示されている', (await enabledStages(page)).length === 2 && await visible(page, '#stageList'), await enabledStages(page));
      await startStage(page, 'z01');
      await page.click('#pauseBtn'); await wait(page, 200);
      const pv2 = await overlayInfo(page);
      if (pv2.cmds.includes('menu')) await page.click('#overlay [data-cmd=menu]'); else await page.click('#back');
      await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('一時停止中からメニューへ行ける（メニューが開く）', page.url() === BASE && await page.locator('a.game').count() >= 2, page.url());
      // 結果カードの「メニューへ」
      await page.goto(ZEN); await wait(page, 200);
      await startStage(page, 'z01'); await play(page, c.mid); await waitOverlay(page);
      await page.click('#overlay [data-cmd=menu]');
      await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('クリア後のカードの「メニューへ」でメニューが開く', page.url() === BASE, page.url());
      await ctx.close();
    },
  },
  {
    id: 'ZU3', tier: 'smoke', title: 'ボタンが画面内：一番狭い iPhone SE（ホーム画面・縦）で、ステージ選択・プレイ中・結果カードの全ボタンが safe-area 内・44px 以上・横スクロールなし',
    async run({ browser, check }) { await screensAt(browser, check, SMOKE_V(), 'ZU3'); },
  },
  {
    id: 'ZU4', tier: 'smoke', title: 'オフラインで開く：インストール後に接続を切っても、ゼンマイが開いて15ステージが出て、プレイでき、部品はキャッシュから読まれる',
    async run({ browser, check, srv }) {
      srv.reset();
      const { ctx, page } = await newPage(browser, custom(390, 844, null, 'iPhone 13'), 'ZU4', { sw: true, allowNetErrors: true });
      await page.goto(BASE);
      const ok = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]));
      if (!ok) throw new Error('Service Worker が 8 秒以内に有効にならない（事前キャッシュの install 失敗の可能性）');
      if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }); }
      await page.evaluate(() => localStorage.setItem('zenmai.help', '1'));      // 遊び方のカードは見たことにする
      await sleep(200);
      await srv.ctl('offline=1');
      const resp = [];
      page.on('response', (r) => { if (/\/games\/zenmai\/|\/common\/sfx\.js/.test(r.url())) resp.push({ f: r.url().split('/').slice(-2).join('/'), status: r.status(), sw: r.fromServiceWorker() }); });
      await page.goto(ZEN, { timeout: 10000 }); await sleep(300);
      const n = await page.locator('#stageList button.stage').count();
      check(`オフラインでゼンマイが開き、ステージが ${n} 個（15）出る`, n === 15 && (await page.title()).length > 0, n);
      const js = ['stages.js', 'logic.js', 'render.js', 'input.js', 'common/sfx.js'].map((f) => ({ f, hit: resp.find((r) => r.f.endsWith(f)) }));
      check('stages.js・logic.js・render.js・input.js・sfx.js をキャッシュ（Service Worker）から読んだ（200）', js.every((x) => x.hit && x.hit.sw && x.hit.status === 200), { js, resp });
      const libs = await page.evaluate(() => ({ L: typeof window.ZenmaiLogic?.simulate, S: Array.isArray(window.ZenmaiStages), R: typeof window.ZenmaiRender?.create, I: typeof window.ZenmaiInput?.attach, Y: typeof window.YubiSfx?.create, G: typeof window.ZenmaiGame?.getState }));
      check('オフラインでも ZenmaiLogic・ZenmaiStages・ZenmaiRender・ZenmaiInput・YubiSfx・ZenmaiGame が使える', Object.values(libs).every((v) => v === 'function' || v === true), libs);
      await page.click('#stageList button.stage[data-id=z01]'); await sleep(300);
      const t0 = await turnsNow(page);
      await page.click('#windPlus'); await sleep(100);
      const t1 = await turnsNow(page);
      check(`オフラインでステージを始められ、＋で巻ける（${t0} → ${t1}）`, await visible(page, 'canvas#stage') && await visible(page, '#dial') && Math.abs(t1 - t0 - 0.25) < 1e-6, { t0, t1 });
      await page.click('#back'); await page.waitForURL(BASE, { timeout: 5000 });
      check('オフラインのまま、メニューに戻れる', await page.locator('a.game').count() >= 2);
      await srv.ctl('offline=0');
      await ctx.close();
    },
  },
  {
    id: 'ZU5', tier: 'smoke', title: 'ステージを1つクリア：巻いて歩かせる → 止まる → ★が出る → 保存され次が開く → 「次へ」で次のステージ',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, view('i13', 'p', 'app'), 'ZU5', { clock: true });
      await openZ(page);
      check('最初は解放1つだけ（z01）で、z02 は押せない', JSON.stringify(await enabledStages(page)) === '["z01"]', await enabledStages(page));
      await startStage(page, 'z01');
      const c = await calc(page, 'z01');
      check(`プレイ画面：巻き数 0 から始まり、ステージ選択は隠れてオーバーレイはない`, await turnsNow(page) === 0 && !(await visible(page, '#stageList')) && !(await overlayInfo(page)).shown && await visible(page, 'canvas#stage'));
      await play(page, c.mid);
      const exp = await sim(page, 'z01', c.mid);
      await wait(page, 300);
      const ph = await phaseOf(page);
      check(`「歩かせる」で人形が歩き出す（phase ${ph}）、ボタンは押せなくなる`, ph === 'walking' && await page.evaluate(() => ['#windPlus', '#windMinus', '#go'].every((q) => document.querySelector(q).disabled)), ph);
      const shown = await waitOverlay(page);
      const o = await overlayInfo(page);
      check(`止まって結果が出る（期待：${exp.result}・★${exp.stars}）。次へ・もう一度 がある`, shown && exp.result === 'stop' && exp.stars === 3 && o.cmds.includes('next') && o.cmds.includes('retry'), { exp, o });
      check('結果カードに ★3 が出る（★の文字か data-stars）', await page.evaluate(() => { const c = document.querySelector('#overlay .card'); const d = c.querySelector('[data-stars]'); return (d && d.dataset.stars === '3') || (c.textContent.match(/★/g) || []).length >= 3; }), o.text);
      const s = await stored(page);
      check('保存：z01=★3、解放2', s && s.stars?.z01 === 3 && s.unlocked === 2, s);
      await page.click('#overlay [data-cmd=stages]'); await wait(page, 200);
      const en = await enabledStages(page), st = await starsOf(page);
      check('ステージ選択に戻ると z01 に ★3、z02 が開く', en.includes('z02') && st.z01 === 3, { en, st });
      await startStage(page, 'z01'); await play(page, c.mid); await waitOverlay(page);
      await page.click('#overlay [data-cmd=next]'); await wait(page, 300);
      const ov2 = await overlayInfo(page);
      check('「次へ」で次のステージ（z02）が始まる：カードが閉じ、巻き数 0、舞台が出る', !ov2.shown && await turnsNow(page) === 0 && await visible(page, 'canvas#stage'), ov2);
      const c2 = await calc(page, 'z02');
      await play(page, c2.mid); const shown2 = await waitOverlay(page);
      const s2 = await stored(page);
      check('z02 もクリアでき、保存に z02 の★と解放3', shown2 && s2.stars?.z02 >= 1 && s2.unlocked >= 3, s2);
      await ctx.close();
    },
  },
  // ---------------- full ----------------
  {
    id: 'ZU6', tier: 'full', title: '境界値：巻き数 0・★3範囲の両端の直前直後・最大・最大＋1/4・崖、結果が simulate と一致し、失敗しても詰まず、保存を下げない',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, view('i13', 'p', 'app'), 'ZU6', { clock: true });
      const c = await (async () => { await openZ(page); await startStage(page, 'z01'); return calc(page, 'z01'); })();
      // 初めての挑戦で巻きすぎ：次のステージはまだ開いていないので「次へ」は出ない。解放は1のまま
      await play(page, c.breakTurns); await waitOverlay(page);
      const f = await overlayInfo(page), sf = await stored(page);
      check(`初挑戦で巻きすぎ：次へは出ず、もう一度・ステージ選択へ・メニューへ がある（${f.cmds.join(',')}）。解放は1のまま`, !f.cmds.includes('next') && ['retry', 'stages', 'menu'].every((x) => f.cmds.includes(x)) && (!sf || sf.unlocked === 1), { f, sf });
      const cases = [['最大', c.max], ['最大＋1/4（巻きすぎ）', c.breakTurns], ['★3の下端−0.3', Math.max(0.25, c.best.min - 0.3)], ['★3の下端', c.best.min + 0.02], ['★3の上端', c.best.max - 0.02], ['★3の上端＋0.3', c.best.max + 0.3]];
      if (c.fall !== null) cases.push(['崖に届く（落下）', c.fall]);
      for (const [label, turns] of cases) {
        await openZ(page, { [PK]: prog({ z01: 2 }, 15) });
        await startStage(page, 'z01');
        const e = await sim(page, 'z01', turns);
        await play(page, turns);
        const shown = await waitOverlay(page);
        const o = await overlayInfo(page);
        const gs = await page.evaluate(() => window.ZenmaiGame.getState().result);
        check(`${label}（${turns} 回転 → ${e.result}・★${e.stars}）：結果が出て、画面の結果も同じ（${gs && gs.result}・★${gs && gs.stars}）。もう一度・ステージ選択へ・メニューへ で続けられる`,
          shown && gs && gs.result === e.result && (e.result !== 'stop' || gs.stars === e.stars) && ['retry', 'stages', 'menu'].every((x) => o.cmds.includes(x)), { e, gs, o });
        const s = await stored(page);
        check(`${label}：保存済みの z01 ★2 と解放15 を下げない（★は最高を残す）`, s && s.stars?.z01 >= 2 && s.unlocked === 15 && (e.result !== 'stop' || e.stars <= 2 || s.stars.z01 === e.stars), s);
      }
      // 巻き数 0：「歩かせる」と「－」は押せない。ZenmaiGame.go() も何もしない。そのあとも＋が効く
      await openZ(page); await startStage(page, 'z01');
      const dis = await page.evaluate(() => ({ go: document.querySelector('#go').disabled, minus: document.querySelector('#windMinus').disabled, plus: document.querySelector('#windPlus').disabled, ret: window.ZenmaiGame.go() }));
      check('巻き数 0：「歩かせる」と「－」は無効、「＋」は有効、go() は何も起こさない', dis.go && dis.minus && !dis.plus && dis.ret === false && await phaseOf(page) === 'ready', dis);
      await page.click('#windPlus'); await wait(page, 100);
      check(`そのあと＋が効く（${await turnsNow(page)}）`, Math.abs((await turnsNow(page)) - 0.25) < 1e-6);
      await page.click('#windMinus'); await wait(page, 100);
      check('－で 0 に戻り、0 未満にならない（－は無効に戻る）', (await turnsNow(page)) === 0 && await page.evaluate(() => document.querySelector('#windMinus').disabled));
      // ＋を押し続ける：最大を超えても表示は数値のまま。ネジの色（warn / over）と文字で知らせる
      const ws = [];
      for (let i = 0; i < Math.ceil(c.max * 4) + 4; i++) {
        await page.click('#windPlus'); const t = await turnsNow(page);
        if (Math.abs(t - (c.max - 0.25)) < 1e-6 || Math.abs(t - c.max) < 1e-6 || Math.abs(t - (c.max + 0.25)) < 1e-6) ws.push(await page.evaluate(() => ({ cls: document.querySelector('#dial').className, msg: document.querySelector('#warnMsg, .warnmsg')?.textContent || ''})));
      }
      await wait(page, 100);
      check(`限界の手前〜超過で、ネジの色（warn/over）と文字で知らせる：${ws.map((x) => x.cls.replace('dial', '').trim() || '-').join(' / ')}`, ws.length === 3 && /warn/.test(ws[0].cls) && /warn/.test(ws[1].cls) && /over/.test(ws[2].cls) && ws[0].msg.length > 0 && ws[2].msg.length > 0, ws);
      const txt = await page.evaluate(() => document.querySelector('#turns').textContent);
      check(`＋を押し続けた表示（${txt}）が数値`, Number.isFinite(parseFloat(txt)) && Math.abs(parseFloat(txt) - await turnsNow(page)) < 0.06, txt);
      await ctx.close();
    },
  },
  {
    id: 'ZU7', tier: 'full', title: '代わりの操作：＋/－ボタンと「歩かせる」だけで ★3 クリア、－で戻る、無効のとき・歩行中の操作で壊れない、キーボード不要',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, view('i13', 'p', 'app'), 'ZU7', { clock: true });
      await openZ(page);
      await startStage(page, 'z01');
      const c = await calc(page, 'z01');
      check(`★3 の範囲 ${c.best.min.toFixed(2)}〜${c.best.max.toFixed(2)} に 1/4 回転の倍数（${c.quarter}）が入る`, c.quarter !== null, c);
      const n = Math.round(c.quarter * 4);
      for (let i = 0; i < n + 2; i++) await page.click('#windPlus');
      await page.click('#windMinus'); await page.click('#windMinus');
      await wait(page, 100);
      check(`＋${n + 2} 回・－2 回で ${c.quarter} 回転（#turns「${await page.evaluate(() => document.querySelector('#turns').textContent)}」）`, Math.abs((await turnsNow(page)) - c.quarter) < 1e-6, await turnsNow(page));
      const txt = await page.evaluate(() => document.querySelector('#turns').textContent);
      check('#turns の表示に巻き数の数値が含まれる', new RegExp(String(c.quarter).replace('.', '\\.')).test(txt) || /\d/.test(txt), txt);
      await page.click('#go'); await wait(page, 150);
      // 歩行中に＋・－・歩かせる・ネジを押しても落ちない（押せないか、無視される）
      const dis = await page.evaluate(() => ({ plus: document.querySelector('#windPlus').disabled, minus: document.querySelector('#windMinus').disabled, go: document.querySelector('#go').disabled, ret: [window.ZenmaiGame.go(), window.ZenmaiGame.setTurns(7)] }));
      check('歩行中は ＋/－/歩かせる が無効で、go()・setTurns() も無視される', dis.plus && dis.minus && dis.go && dis.ret[0] === false && dis.ret[1] === false, dis);
      const shown = await waitOverlay(page);
      const o = await overlayInfo(page);
      check('ボタン操作だけでクリア（次へが出る）。歩行中の操作で壊れない', shown && o.cmds.includes('next'), o);
      const s = await stored(page);
      check('保存：z01 ★3', s?.stars?.z01 === 3, s);
      // もう一度 → 巻き数が 0 に戻り、同じ操作でまた遊べる（回数制限なし：3回続ける）
      let again = 0;
      for (let k = 0; k < 3; k++) {
        await page.click('#overlay [data-cmd=retry]'); await wait(page, 200);
        const zero = (await turnsNow(page)) === 0;
        for (let i = 0; i < n; i++) await page.click('#windPlus');
        await page.click('#go'); const sh = await waitOverlay(page);
        if (zero && sh) again++;
      }
      check(`何度でも挑戦できる（もう一度→巻く→歩かせるを3回：${again}/3）`, again === 3, again);
      await ctx.close();
    },
  },
  {
    id: 'ZU8', tier: 'full', cdp: CDP, title: '円ドラッグ（CDP タッチ）：時計回り1周≒1回転、反時計回りで戻る、速く回しても数えられる、中心付近は無視、離すと歩く、0未満にならない',
    async run({ browser, ctx: _c, check }) {
      const { ctx, page } = await newPage(browser, view('i13', 'p', 'app'), 'ZU8');
      await openZ(page);
      await startStage(page, 'z01');
      const t = await touch(ctx, page);
      const geo = await page.evaluate(() => { const b = document.querySelector('#dial').getBoundingClientRect(); return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: Math.min(b.width, b.height) / 2 }; });
      check(`ダイヤルの touch-action が none（${await page.evaluate(() => getComputedStyle(document.querySelector('#dial')).touchAction)}）で、直径 ${Math.round(geo.r * 2)}px ≧ 44`, geo.r * 2 >= 44 && await page.evaluate(() => getComputedStyle(document.querySelector('#dial')).touchAction) === 'none', geo);
      const R = geo.r * 0.75;
      const pt = (deg) => ({ x: geo.cx + R * Math.cos(deg * Math.PI / 180), y: geo.cy + R * Math.sin(deg * Math.PI / 180) });
      // 円を描く。revs>0 は時計回り（画面上で右→下→左→上）。stepDeg 刻み、stepMs 間隔。離さずに返す
      const down = async (deg = -90) => { const p = pt(deg); await t.send('touchStart', [{ x: p.x, y: p.y }]); };
      const arc = async (from, revs, stepDeg = 10, stepMs = 12) => {
        const n = Math.round(Math.abs(revs) * 360 / stepDeg), sgn = Math.sign(revs);
        for (let i = 1; i <= n; i++) { if (stepMs) await sleep(stepMs); const p = pt(from + sgn * stepDeg * i); await t.send('touchMove', [{ x: p.x, y: p.y }]); }
        return from + revs * 360;
      };
      const up = () => t.send('touchEnd', []);
      const near = (v, e, tol = 0.2) => Math.abs(v - e) <= tol;
      let a = -90;
      await down(a); a = await arc(a, 1);
      const t1 = await turnsNow(page);
      check(`時計回り1周 → 巻き数 ${t1.toFixed(2)}（1±0.2）`, near(t1, 1), t1);
      a = await arc(a, -0.5);
      const t2 = await turnsNow(page);
      check(`そのまま反時計回りに半周 → ${t2.toFixed(2)}（0.5±0.2）`, near(t2, 0.5), t2);
      a = await arc(a, 2, 30, 6);
      const t3 = await turnsNow(page);
      check(`速く（30度刻み）2周 → ${t3.toFixed(2)}（2.5±0.3）`, near(t3, 2.5, 0.3), t3);
      await up(); await sleep(250);
      const afterUp = await phaseOf(page);
      check(`指を離すと歩き出す（phase ${afterUp}）`, ['walking', 'stopped', 'falling', 'broken', 'done'].includes(afterUp), afterUp);
      // 反時計回りだけ：0 未満にならない（歩いている途中なので、ページを開き直して最初から）
      await page.reload(); await sleep(250); await startStage(page, 'z01');
      await down(-90); await arc(-90, -1);
      const t4 = await turnsNow(page);
      check(`巻き数 0 から反時計回りに1周しても 0 未満にならない（${t4}）`, t4 >= 0 && t4 < 0.2, t4);
      await up(); await sleep(200);
      // 中心付近のぶれは無視
      await t.send('touchStart', [{ x: geo.cx + 2, y: geo.cy }]);
      for (let i = 0; i < 36; i++) { await sleep(8); await t.send('touchMove', [{ x: geo.cx + 3 * Math.cos(i), y: geo.cy + 3 * Math.sin(i) }]); }
      const t5 = await turnsNow(page);
      await up();
      check(`中心付近（半径3px）で円を描いても巻き数が増えない（${t5}）`, t5 < 0.2, t5);
      await ctx.close();
    },
  },
  {
    id: 'ZU9', tier: 'full', title: '効果音：限界で limit、＋で tick・－で unwind、離すと release、歩く step、止まる stop／star／clear、落ちる fall、切れる break。どれも実際に鳴る。オフなら鳴らない',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, view('i13', 'p', 'app'), 'ZU9', { initScript: SFX_SPY, clock: true });
      await openZ(page);
      await startStage(page, 'z01');
      const c = await calc(page, 'z01');
      const names = async () => (await plays(page)).map((p) => p.n);
      const clear = () => page.evaluate(() => { window.__plays.length = 0; });
      await clear();
      // 限界の手前まで巻く → limit。戻す → unwind
      for (let i = 0; i < Math.ceil(c.max * 4) - 1; i++) await page.click('#windPlus');
      await wait(page, 150);
      const pl = await names();
      await clear();
      await page.click('#windMinus'); await wait(page, 150);
      const pm = await names();
      check(`＋で tick（${pl.filter((n) => n === 'tick').length} 回）、限界の手前で limit が1回（${pl.filter((n) => n === 'limit').length} 回）`, pl.filter((n) => n === 'tick').length > 0 && pl.filter((n) => n === 'limit').length === 1, pl);
      check(`－で unwind（${pm.join(',')}）`, pm.includes('unwind'), pm);
      // クリア：release → step → stop → star → clear
      await page.reload(); await wait(page, 300);
      await startStage(page, 'z01'); await clear();
      await play(page, c.mid); await waitOverlay(page); await wait(page, 900);
      const pc = await plays(page);
      const seen = [...new Set(pc.map((p) => p.n))];
      check(`クリアで ${seen.join(', ')} が鳴り、release・step・stop・star・clear を含む`, ['release', 'step', 'stop', 'star', 'clear'].every((n) => seen.includes(n)), seen);
      // step は sfx.js の間引き（GAP 0.08 秒・音の時計で測る）がある。早送り中はゲームの時間だけ進み音の時計は進まないので、
      // 2歩目以降が間引かれることがある。step は「1回以上実際に鳴った」ことを見て、ほかの音はすべて start したことを見る
      const notStarted = pc.filter((p) => !p.known || (p.n !== 'step' && !(p.d > 0)));
      check('どの呼び出しも既知の音名で、音の部品が実際に start した（step は1回以上）', pc.length > 0 && !notStarted.length && pc.some((p) => p.n === 'step' && p.d > 0), notStarted);
      check(`star は ★の数（3）だけ、1・2・3 の順に鳴る（${pc.filter((p) => p.n === 'star').map((p) => p.a).join(',')}）`, JSON.stringify(pc.filter((p) => p.n === 'star').map((p) => p.a)) === '[1,2,3]', pc.filter((p) => p.n === 'star'));
      // 巻きすぎ → break、崖 → fall
      await page.click('#overlay [data-cmd=retry]'); await wait(page, 300); await clear();
      await play(page, c.breakTurns); await waitOverlay(page); await wait(page, 300);
      const pb = await names();
      check(`巻きすぎで break が鳴り、stop・clear は鳴らない（${[...new Set(pb)].join(',')}）`, pb.includes('break') && !pb.includes('clear') && !pb.includes('stop') && !pb.includes('star'), pb);
      if (c.fall !== null) {
        await page.click('#overlay [data-cmd=retry]'); await wait(page, 300); await clear();
        await play(page, c.fall); await waitOverlay(page); await wait(page, 300);
        const pf = await names();
        check(`崖から落ちると fall が鳴り、clear は鳴らない（${[...new Set(pf)].join(',')}）`, pf.includes('fall') && !pf.includes('clear'), pf);
      }
      // 効果音オフ：♪の aria-pressed が false になり、操作しても鳴らない（再読み込み後も）
      await page.click('#overlay [data-cmd=stages]'); await wait(page, 200);
      await page.click('#soundBtn'); await wait(page, 100);
      const pr = await page.evaluate(() => ({ ap: document.querySelector('#soundBtn').getAttribute('aria-pressed'), ls: localStorage.getItem('blockpuzzle.sound') }));
      await page.reload(); await wait(page, 300);
      const prAfter = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      await startStage(page, 'z01');
      const s0 = await starts(page);
      for (let i = 0; i < 4; i++) await page.click('#windPlus');
      await page.click('#windMinus'); await page.click('#go'); await waitOverlay(page); await wait(page, 900);
      const s1 = await starts(page);
      check(`♪でオフ（aria-pressed ${pr.ap}・保存 ${pr.ls}、再読み込み後 ${prAfter}）にすると、巻く・歩く・結果の間 音が鳴らない（start ${s1 - s0}）`, pr.ap === 'false' && pr.ls === 'off' && prAfter === 'false' && s1 - s0 === 0, { pr, prAfter, s0, s1 });
      await ctx.close();
    },
  },
  {
    id: 'ZU13', tier: 'full', cdp: CDP, title: '効果音（円ドラッグ）：ネジを1周回すと tick が1/8回転ごとに約8回、指を離すと release が鳴る',
    async run({ browser, ctx: _c, check }) {
      const { ctx, page } = await newPage(browser, view('i13', 'p', 'app'), 'ZU13', { initScript: SFX_SPY });
      await openZ(page);
      await startStage(page, 'z01');
      const t = await touch(ctx, page);
      const geo = await page.evaluate(() => { const b = document.querySelector('#dial').getBoundingClientRect(); return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: Math.min(b.width, b.height) / 2 }; });
      const R = geo.r * 0.75, at = (deg) => ({ x: geo.cx + R * Math.cos(deg * Math.PI / 180), y: geo.cy + R * Math.sin(deg * Math.PI / 180) });
      const p0 = at(-90); await t.send('touchStart', [{ x: p0.x, y: p0.y }]);
      for (let i = 1; i <= 24; i++) { await sleep(22); const p = at(-90 + 15 * i); await t.send('touchMove', [{ x: p.x, y: p.y }]); }
      const before = (await plays(page)).map((p) => p.n);
      await t.send('touchEnd', []); await sleep(150);
      const all = await plays(page);
      const ticks = before.filter((n) => n === 'tick').length;
      check(`円ドラッグ1周で tick が鳴る（${ticks} 回、1/8 回転ごと＝約8）、指を離す前は release が鳴らない`, ticks >= 6 && ticks <= 9 && !before.includes('release'), before);
      check('指を離すと release が鳴り、どの呼び出しも既知の音名で部品が start した', all.some((p) => p.n === 'release') && all.every((p) => p.known && p.d > 0), all.filter((p) => !(p.known && p.d > 0)));
      await ctx.close();
    },
  },
  {
    id: 'ZU14', tier: 'full', title: '警告の基準がネジと舞台でそろう：★3の中央ではどちらも警告なし、限界の1.5回転手前から両方が警告。止まった後のゲージは0、「つぎ」の目印は1つ、初回の遊び方は短い',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, view('i13', 'p', 'app'), 'ZU14', { clock: true, initScript: RENDER_SPY });
      const both = () => page.evaluate(() => {
        const d = document.querySelector('#dial'), v = window.__zrView || {};
        const st = typeof v.warn === 'number' ? v.warn : window.ZenmaiRender.warnLevel(v.turns, v.maxTurns, v.warnMargin);
        return { dial: d.classList.contains('over') ? 2 : d.classList.contains('warn') ? 1 : 0, stage: st, turns: v.turns, frac: d.style.getPropertyValue('--frac').trim() };
      });
      const bad = [];
      await openZ(page, { [PK]: prog({}, 15) });
      const ids = await page.evaluate(() => ZenmaiStages.map((s) => s.id));
      for (const id of ids) {
        await openZ(page, { [PK]: prog({}, 15) }); await startStage(page, id);
        const c = await calc(page, id);
        await page.evaluate((t) => window.ZenmaiGame.setTurns(t), c.mid); await wait(page, 100);
        const w = await both();
        if (w.dial !== 0 || w.stage !== 0) bad.push({ id, mid: c.mid, w });
      }
      check('全15ステージで ★3 の中央の巻き数では、ネジにも舞台にも警告が出ない', bad.length === 0, bad);
      await openZ(page, { [PK]: prog({}, 15) }); await startStage(page, 'z05');
      const lv = [];
      for (const t of [8.25, 8.5, 8.75, 10, 10.25]) { await page.evaluate((t) => window.ZenmaiGame.setTurns(t), t); await wait(page, 100); lv.push({ t, ...(await both()) }); }
      const exp = [0, 0, 1, 1, 2];
      check(`z05（限界10）：8.25・8.5回転は警告なし、8.75・10回転で「そろそろ限界」、10.25回転で超過。ネジと舞台が同じ段階（${lv.map((x) => x.dial + '/' + x.stage).join(' ')}）`, lv.every((x, i) => x.dial === exp[i] && x.stage === exp[i]), lv);
      // 止まった後：ネジのゲージは 0 に戻ったまま（満タンに戻らない）
      await openZ(page, { [PK]: prog({}, 15) }); await startStage(page, 'z01');
      const c1 = await calc(page, 'z01');
      await play(page, c1.mid);
      let sawStopped = false;
      for (let i = 0; i < 160; i++) { await wait(page, 50); const ph = await phaseOf(page); if (ph === 'stopped' || ph === 'done') { sawStopped = true; break; } }
      const f1 = await both(); await waitOverlay(page); const f2 = await both();
      check(`止まった直後と結果の表示中、ネジのゲージ（--frac）は 0（${f1.frac} → ${f2.frac}）`, sawStopped && Number(f1.frac) === 0 && Number(f2.frac) === 0 && f1.dial === 0, { f1, f2 });
      // ステージ選択の「つぎ」は1つだけで、最初の未クリアの解放済みステージ
      await openZ(page, { [PK]: prog({ z01: 3, z02: 1 }, 3) });
      const nx = await page.evaluate(() => [...document.querySelectorAll('#stageList .stage.next')].map((b) => b.dataset.id));
      check(`ステージ選択の .stage.next は1つだけ（${nx.join(',')}）で z03`, nx.length === 1 && nx[0] === 'z03', nx);
      // 初回の遊び方は3項目、？ボタンからは全項目
      await seed(page, {}); await page.goto(ZEN); await wait(page, 300);
      const first = await page.evaluate(() => ({ kind: window.ZenmaiGame.getState().overlay, n: document.querySelectorAll('#overlay .howto dt').length }));
      await openZ(page); await page.click('#helpBtn'); await wait(page, 200);
      const full = await page.evaluate(() => document.querySelectorAll('#overlay .howto dt').length);
      check(`初回の自動表示の遊び方は短い（${first.n} 項目）、？ボタンからは全項目（${full} 項目）`, first.kind === 'help' && first.n === 3 && full === 7, { first, full });
      await ctx.close();
    },
  },
  {
    id: 'ZU15', tier: 'smoke', title: '最終確認の5件（画面）：★3のラベルが全画面で出る・帯の輪郭、iPad 横で舞台が上に詰まる、ステージ選択の「つぎ」の枠が欠けない、警告から崖まで余裕',
    async run({ browser, check }) {
      const SPY = () => {
        window.__lab = [];
        const ft = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (t, x, y) {
          const px = parseFloat((/(\d+(?:\.\d+)?)px/.exec(this.font) || [])[1]);
          if (String(t) === '★3') window.__lab.push({ x, y, px, cw: this.canvas.clientWidth, ch: this.canvas.clientHeight });
          return ft.apply(this, arguments);
        };
      };
      for (const [dev, o] of [['SE', 'p'], ['i13', 'p'], ['iPad', 'l']]) {
        const v = view(dev, o, 'app');
        const { ctx, page } = await newPage(browser, v, 'ZU15', { clock: true, initScript: SPY });
        const miss = [];
        for (const id of ['z01', 'z05', 'z07', 'z15']) {
          await openZ(page, { [PK]: prog({}, 15) }); await startStage(page, id);
          await wait(page, 150);
          const l = await page.evaluate(() => window.__lab.slice(-1)[0]);
          if (!l || l.px < 12 || l.x < 0 || l.x > l.cw || l.y < 0 || l.y > l.ch) miss.push({ id, l });
        }
        check(`${v.label}：z01・z05・z07・z15 のどれでも「★3」ラベルが12px以上で舞台の中に出る`, miss.length === 0, miss);
        if (dev === 'iPad') {
          await openZ(page, { [PK]: prog({}, 15) }); await startStage(page, 'z05');
          const g = await page.evaluate(() => {
            const h = document.querySelector('h1.title').getBoundingClientRect(), i = document.querySelector('.info').getBoundingClientRect(), c = document.querySelector('#canvasWrap').getBoundingClientRect();
            return { gap: i.top - h.bottom, canvasW: c.width, canvasH: c.height, vw: innerWidth, vh: innerHeight, bottom: c.bottom };
          });
          check(`iPad 横：ヘッダーと舞台の間の空白が60px以下（${Math.round(g.gap)}px）で、舞台の高さが画面の40%以上（${Math.round(g.canvasH)}/${g.vh}）`, g.gap <= 60 && g.canvasH >= g.vh * 0.4, g);
        }
        // ステージ選択：「つぎ」の枠（2px）がリスト・画面の端で欠けない
        await openZ(page, { [PK]: prog({ z01: 3, z02: 3, z03: 3, z04: 3, z05: 3 }, 6) });
        const clip = await page.evaluate(() => {
          const b = document.querySelector('#stageList .stage.next'); const r = b.getBoundingClientRect();
          const box = { l: r.left - 2, r: r.right + 2, t: r.top - 2, b: r.bottom + 2 };
          let el = b.parentElement, cl = 0, cr = innerWidth, ct = 0, cb = innerHeight;
          for (; el && el !== document.documentElement; el = el.parentElement) {
            const cs = getComputedStyle(el);
            if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
              const q = el.getBoundingClientRect(); cl = Math.max(cl, q.left + el.clientLeft); cr = Math.min(cr, q.left + el.clientLeft + el.clientWidth);
            }
          }
          return { id: b.dataset.id, box, cl, cr };
        });
        check(`${v.label}：ステージ選択で「つぎ」（${clip.id}）の枠が左右とも欠けない（クリップ内 ${Math.round(clip.cl)}〜${Math.round(clip.cr)}、枠 ${Math.round(clip.box.l)}〜${Math.round(clip.box.r)}）`, clip.id === 'z06' && clip.box.l >= clip.cl - 0.01 && clip.box.r <= clip.cr + 0.01, clip);
        await ctx.close();
      }
    },
  },
  {
    id: 'ZU10', tier: 'full', cdp: CDP, title: 'ダブルタップ拡大の抑止：ネジ・舞台・＋ボタンの連続タップで2回目の touchend を止め、拡大せず、＋は2回とも効く。dblclick・gesture・長押しメニュー・文字選択を止める',
    async run({ browser, ctx: _c, check }) {
      const { ctx, page } = await newPage(browser, custom(390, 664, null, 'iPhone 13 Safari'), 'ZU10', { device: 'iPhone 13', initScript: SFX_SPY, clock: true });
      await ctx.addInitScript(TE_SPY);
      await openZ(page);
      await startStage(page, 'z01');
      const t = await touch(ctx, page);
      const te = () => page.evaluate(() => window.__te.splice(0));
      const g = await page.evaluate(() => {
        const out = {};
        for (const sel of ['#dial', 'canvas#stage', '#windPlus']) {
          const el = document.querySelector(sel);
          const d = el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
          const gs = ['gesturestart', 'gesturechange'].map((n) => el.dispatchEvent(new Event(n, { bubbles: true, cancelable: true })));
          const cm = el.dispatchEvent(new Event('contextmenu', { bubbles: true, cancelable: true }));
          const ss = el.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true }));
          const cs = getComputedStyle(el);
          out[sel] = { dbl: !d, gesture: gs.every((x) => !x), ctx: !cm, sel: !ss || cs.userSelect === 'none' || cs.webkitUserSelect === 'none', ta: cs.touchAction };
        }
        return out;
      });
      check('dblclick と gesturestart/gesturechange を止める（ネジ・舞台・＋）', Object.values(g).every((x) => x.dbl && x.gesture), g);
      check('長押しメニュー（contextmenu）と文字選択を止める（ネジ）', g['#dial'].ctx && g['#dial'].sel && g['#dial'].ta === 'none', g['#dial']);
      for (const sel of ['#dial', 'canvas#stage', '#windPlus']) {
        await te();
        const t0 = await turnsNow(page);
        await t.doubleTap(sel); await wait(page, 100);
        const ev = await te();
        const sc = await page.evaluate(() => window.visualViewport.scale);
        const dt = (await turnsNow(page)) - t0;
        const extra = sel === '#windPlus' ? dt === 0.5 : true;
        check(`${sel}：連続タップ（100ms）→ 2回目の touchend を止める、拡大しない（scale ${sc}）${sel === '#windPlus' ? `、＋は2回とも効く（+${dt}）` : ''}`, ev.length === 2 && ev[1].p === true && sc === 1 && extra, { ev, sc, dt });
      }
      await ctx.close();
    },
  },
  {
    id: 'ZU11', tier: 'full', title: '画面の確認（全端末）：iPhone SE/13/15 Pro Max・iPad の代表10画面（縦横・Safari/ホーム画面）で、全画面のボタンが画面内・44px以上・横スクロールなし',
    async run({ browser, check }) { for (const v of FULL_VIEWS()) await screensAt(browser, check, v, 'ZU11'); },
  },
  {
    id: 'ZU12', tier: 'full', title: '最後のステージと全クリア：z15 のクリアで「次へ」が出ない（行き止まりにならない）、全ステージ★3の表示、動きを減らす設定でも遊べる',
    async run({ browser, check }) {
      const all = {}; for (let i = 1; i <= 15; i++) all['z' + String(i).padStart(2, '0')] = 3;
      const { ctx, page } = await newPage(browser, view('i13', 'p', 'app'), 'ZU12', { clock: true, reducedMotion: 'reduce' });
      await openZ(page, { [PK]: prog(all, 15) });
      const st = await starsOf(page), en = await enabledStages(page);
      check('全解放・全★3：15個が押せて、すべて ★3', en.length === 15 && Object.values(st).filter((x) => x === 3).length === 15, { en: en.length, st });
      await startStage(page, 'z15');
      const c = await calc(page, 'z15');
      await play(page, c.mid);
      const shown = await waitOverlay(page);
      const o = await overlayInfo(page);
      const e = await sim(page, 'z15', c.mid);
      check(`z15 を★3でクリア（${e.result}・★${e.stars}）：カードが出て、次へは出ず、もう一度・ステージ選択へ・メニューへ がある（reduced-motion でも進む）`, shown && e.stars === 3 && !o.cmds.includes('next') && ['retry', 'stages', 'menu'].every((x) => o.cmds.includes(x)), { e, o });
      const s = await stored(page);
      check('保存は全★3・解放15のまま', s?.unlocked === 15 && Object.values(s.stars).every((x) => x === 3) && Object.keys(s.stars).length === 15, s);
      // 各ステージ：開始でき、期待どおりの結果が出る（15個すべてを★3の巻き数で）
      const bad = [];
      for (let i = 1; i <= 15; i++) {
        const id = 'z' + String(i).padStart(2, '0');
        if (i > 1) { await page.click('#overlay [data-cmd=stages]'); await wait(page, 150); } else await openZ(page, { [PK]: prog({}, 15) });
        await startStage(page, id);
        const cc = await calc(page, id), ee = await sim(page, id, cc.mid);
        await play(page, cc.mid);
        const sh = await waitOverlay(page);
        const oo = await overlayInfo(page);
        const ss = await stored(page);
        if (!(sh && ee.stars === 3 && ss?.stars?.[id] === 3)) bad.push({ id, ee, stored: ss?.stars?.[id], cmds: oo.cmds });
      }
      check('15ステージすべて、★3の巻き数（範囲の中央）で歩かせると★3で保存される', !bad.length, bad);
      await ctx.close();
    },
  },
];

// 実時間で結果の画面を待つ（早送りしないページ用）
async function waitRealOverlay(p, maxMs = 40000) {
  for (let t = 0; t < maxMs; t += 200) { if (await isResult(p)) return true; await sleep(200); }
  return false;
}
