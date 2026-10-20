// BW: いろびんの画面（games/irobin/）。契約は docs/irobin-contract.md（§6 DOM・§8 進行・§12.3 テスト）。
//   画面の DOM は契約だけに頼る：a#back・#helpBtn・#soundBtn・#playView[data-phase]・#level・#left・#board .bottle .seg .mark・#cust0/#cust1・
//     #hint・#undoBtn・#restartBtn・#overlay・#card・.overlay [data-cmd=next/menu/close/restartYes]
//   テスト用の公開 API（契約 §8.6）：window.IrobinGame = { getState, pick, pour, solution, skip, setLevel, setState }
//   計算ロジックは BL（irobin-logic.mjs）で確かめ済み。ここでは画面の中の IrobinLogic を「期待値の計算機」として使う。
//   無いときに合格にしない（空振りの合格を作らない）：IrobinGame が無ければ例外で不合格にする。
//   smoke：BW1〜BW4・BW17・BW18（布の瓶）。full：BW5〜BW16（BW14 は CDP のタッチ操作なので Chromium だけ、BW10 は AudioContext が要る）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BASE, view, custom, newPage, seed, wait, frozen, layoutProbe, swInfo, sleep, touch, SFX_SPY, plays } from '../lib.mjs';

const IR = BASE + 'games/irobin/';
const SMOKE_V = () => view('SE', 'p', 'app');
const STD_V = () => view('i13', 'p', 'app');
const CDP = 'CDP のタッチ操作（連続タップ）';
const MAX16 = '9007199254740991';

// ---------- 開く ----------
async function openG(browser, label, { v = STD_V(), opts = {}, extra = {}, help = true } = {}) {
  const { ctx, page } = await newPage(browser, v, label, { clock: true, ...opts });
  await gotoG(page, extra, { help });
  return { ctx, page };
}
// 初回だけ出る遊び方は、見たことにして始める（help: false なら出る状態で始める）
async function gotoG(page, extra = {}, { help = true } = {}) {
  await seed(page, { ...(help ? { 'irobin.help': '1' } : {}), ...extra });
  await page.goto(IR); await wait(page, 300);
  const has = await page.evaluate(() => !!window.IrobinGame && typeof window.IrobinGame.getState === 'function');
  if (!has) throw new Error('window.IrobinGame.getState が無い（games/irobin/main.js が読まれていないか、テスト用 API が未実装）');
}

// ---------- 読む ----------
const gs = (p) => p.evaluate(() => window.IrobinGame.getState());
const stored = (p, k) => p.evaluate((k) => { try { return localStorage.getItem(k); } catch { return 'ERR'; } }, k);
const J = (x) => JSON.stringify(x);
// 画面の瓶：段の色（隠れは null）・隠れ・記号の有無
const domBottles = (p) => p.evaluate(() => [...document.querySelectorAll('#board .bottle')].map((b) => ({
  i: Number(b.dataset.index), id: b.dataset.id, covered: b.dataset.covered === '1', coverLeft: b.dataset.coverLeft ?? null, sealed: b.dataset.sealed, selected: b.dataset.selected, waiting: b.dataset.waiting, label: b.getAttribute('aria-label') || '',
  segs: [...b.querySelectorAll('.seg')].map((s) => ({ c: s.dataset.color, h: s.dataset.hidden, mark: s.querySelector('.mark') ? s.querySelector('.mark').innerHTML.replace(/\s+/g, ' ').trim() : null })),
})));
const domNums = (p) => p.evaluate(() => {
  const n = (id) => { const e = document.querySelector('#' + id); if (!e) return null; const t = e.textContent.replace(/[^\d]/g, ''); return t === '' ? null : Number(t); };
  return { level: n('level'), left: n('left') };
});
const domCust = (p) => p.evaluate(() => ['cust0', 'cust1'].map((id) => { const e = document.getElementById(id); return e ? { color: e.dataset.color, mood: e.dataset.mood, sr: e.querySelector('.sr')?.textContent.trim() ?? null, tray: !!e.querySelector('.tray svg, .tray canvas, .tray .mark, .tray [data-color]') } : null; }));
const phaseAttr = (p) => p.evaluate(() => document.querySelector('#playView')?.dataset.phase);
const hintText = (p) => p.evaluate(() => document.querySelector('#hint')?.textContent.trim() ?? null);
const overlayInfo = (p) => p.evaluate(() => {
  const ov = document.querySelector('#overlay');
  const shown = !!ov && !ov.hidden && getComputedStyle(ov).display !== 'none';
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none'; };
  const cmds = shown ? [...ov.querySelectorAll('[data-cmd]')].filter(vis).map((b) => b.dataset.cmd) : [];
  return { shown, cmds, text: shown ? (ov.querySelector('#card')?.textContent || '').replace(/\s+/g, ' ').trim() : '', active: document.activeElement?.dataset?.cmd ?? null };
});
const reachable = (p, sel) => p.evaluate((s) => {
  const e = document.querySelector(s); if (!e) return false;
  const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false;
  const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!t && (t === e || e.contains(t));
}, sel);
const clickCmd = (p, cmd) => p.evaluate((c) => { const b = document.querySelector(`#overlay:not([hidden]) [data-cmd="${c}"]`); if (!b) return false; b.click(); return true; }, cmd);
// 隠れる・戻る（visibilitychange を再現する）
const setHidden = (p, hidden) => p.evaluate((h) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

// ---------- 遊ぶ ----------
// 手を pick で当て、そのつど演出を終わりまで進める
async function playMoves(p, moves) {
  for (const [f, t] of moves) {
    await p.evaluate(([f, t]) => { window.IrobinGame.pick(f); window.IrobinGame.pick(t); window.IrobinGame.skip(); }, [f, t]);
    await wait(p, 30);
  }
}
const solutionOf = (p) => p.evaluate(() => window.IrobinGame.solution());
// クリアのカードが出るまで進める
async function toClear(p, maxSteps = 80) {
  for (let i = 0; i < maxSteps; i++) {
    const s = await gs(p);
    if (s.overlay === 'clear') return s;
    await p.evaluate(() => window.IrobinGame.skip()); await wait(p, 100);
  }
  return gs(p);
}
// 今の面を解いてクリアのカードまで
async function solveToClear(p) {
  const sol = await solutionOf(p);
  if (!sol) throw new Error('solution() が null（今の面が解けない／API が未実装）');
  await playMoves(p, sol);
  return { sol, s: await toClear(p) };
}
// 手を指で押す代わりに、本物のクリックで瓶を選ぶ（音の準備 unlock も通る）
const clickBottle = (p, i) => p.click(`#board .bottle[data-index="${i}"]`);

// 舞台のカード：見出しが切れず、全ボタンに届き 44px 以上
async function overlayProbe(page, safe) {
  return page.evaluate((safe) => {
    const [t, r, b, l] = safe || [0, 0, 0, 0];
    const ov = document.querySelector('#overlay'), card = document.querySelector('#card');
    const head = card.querySelector('#cardTitle') || card.querySelector('h1, h2, h3');
    const res = { btns: [], oy: getComputedStyle(ov).overflowY, head: !!head };
    ov.scrollTop = 0;
    if (head) res.headTop = Math.round(head.getBoundingClientRect().top);
    for (const x of card.querySelectorAll('button')) {
      if (x.closest('[hidden]') || !x.getBoundingClientRect().width) continue;
      x.scrollIntoView({ block: 'center' });
      const q = x.getBoundingClientRect();
      res.btns.push({ cmd: x.dataset.cmd || x.textContent.trim(), w: Math.round(q.width), h: Math.round(q.height), inside: q.top >= t - 0.5 && q.bottom <= innerHeight - b + 0.5 && q.left >= l - 0.5 && q.right <= innerWidth - r + 0.5 });
    }
    ov.scrollTop = 0;
    res.hscroll = document.documentElement.scrollWidth > innerWidth;
    return res;
  }, safe);
}
const overlayOk = (o) => o.head && o.btns.length > 0 && o.headTop >= 0 && !o.hscroll && o.btns.every((b) => b.inside && b.h >= 43.5 && b.w >= 43.5);

// 詰みの局面（1手注ぐと動かせる手が無くなる）：瓶 [0,1] [0,1] [2]、お客さん [0,1] 列 [2]
const STUCK_STATE = () => ({
  level: 1, params: { colors: 3, empties: 0, hidden: false, order: 'random' },
  bottles: [[0, 1], [0, 1], [2]].map((c) => ({ cells: c, hidden: c.map(() => false), sealed: false })),
  slots: [0, 1], queue: [2], served: 0, total: 3, moves: 0, won: false,
});

export const tests = [
  // ================= smoke =================
  {
    id: 'BW1', tier: 'smoke', title: 'いろびん：瓶を2本押して注ぐと、.seg の色の並びが getState().bottles と一致し、#level・#left の文字が hud と一致する（隠れの段は data-color が空）',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'BW1', { v: SMOKE_V() });
      const api = await page.evaluate(() => ({ keys: Object.keys(window.IrobinGame).sort(), frozen: Object.isFrozen(window.IrobinGame), L: typeof window.IrobinLogic?.applyMove }));
      const need = ['getState', 'pick', 'pour', 'solution', 'skip', 'setLevel', 'setState'];
      check(`window.IrobinGame に ${need.join('・')} があり凍結されている、IrobinLogic が読める`, need.every((k) => api.keys.includes(k)) && api.frozen && api.L === 'function', api);
      const s0 = await gs(page), d0 = await domNums(page);
      check(`はじめ：level ${s0.level}・moves 0・phase idle、#level ${d0.level}・#left ${d0.left} が state（level ${s0.level}・left ${s0.left}）と同じ`,
        s0.level === 1 && s0.moves === 0 && s0.phase === 'idle' && d0.level === s0.level && d0.left === s0.left && s0.left === s0.total - s0.served, { s0, d0 });
      check(`#playView[data-phase] が getState().phase と同じ（${await phaseAttr(page)}）`, (await phaseAttr(page)) === s0.phase);
      const title = await page.evaluate(() => ({ t: document.title, h: document.getElementById('gameTitle')?.textContent.trim(), n: window.IrobinLogic.NAME }));
      check(`タイトルと見出しが IrobinLogic.NAME（${title.n}）と同じ`, title.t.includes(title.n) && title.h === title.n, title);
      // 注ぐ前の画面＝state
      const sameAs = (st, dom) => st.bottles.length === dom.length && st.bottles.every((b, i) => b.cells.length === dom[i].segs.length && b.cells.every((c, k) => {
        const g = dom[i].segs[k];
        return b.hidden[k] ? (g.h === '1' && !g.c) : (g.h !== '1' && g.c === String(c));
      }));
      const dom0 = await domBottles(page);
      check(`注ぐ前：${dom0.length} 本の瓶の .seg の色・隠れが state と一致`, sameAs(s0, dom0), { dom0: dom0.map((b) => b.segs.map((x) => x.c)), st: s0.bottles.map((b) => b.cells) });
      // 1手注ぐ
      const sol = await solutionOf(page);
      check('solution() が手の列を返す（面 1 は解ける）', Array.isArray(sol) && sol.length > 0 && sol.every((m) => Array.isArray(m) && m.length === 2), sol);
      const [f, t] = sol[0];
      await page.evaluate((f) => window.IrobinGame.pick(f), f);
      await wait(page, 50);
      const sel = await gs(page);
      const domSel = await domBottles(page);
      check(`1本目を押すと selected（selected=${sel.selected}）、その瓶だけ data-selected="1"`, sel.phase === 'selected' && sel.selected === f && domSel.filter((b) => b.selected === '1').map((b) => b.i).join() === String(f) && (await phaseAttr(page)) === 'selected', { sel: sel.selected, dom: domSel.map((b) => b.selected) });
      await page.evaluate((t) => window.IrobinGame.pick(t), t);
      await page.evaluate(() => window.IrobinGame.skip()); await wait(page, 80);
      const s1 = await gs(page), d1 = await domNums(page), dom1 = await domBottles(page);
      check(`2本目を押して注ぐ：moves 1・phase ${s1.phase}・選択が外れる、画面の瓶が state と一致`, s1.moves === 1 && s1.selected === null && sameAs(s1, dom1) && J(s1.bottles) !== J(s0.bottles), { s1: s1.bottles, dom: dom1.map((b) => b.segs.map((x) => x.c)) });
      check(`#level ${d1.level}・#left ${d1.left} が state（${s1.level}・${s1.left}）と同じ（表示の1ずれなし）`, d1.level === s1.level && d1.left === s1.left && s1.left === s1.total - s1.served, { d1, s1 });
      // お客さん
      const cu = await domCust(page);
      check(`お客さん #cust0・#cust1 の data-color が state.slots（${J(s1.slots)}）と同じ`, cu.every((c, i) => c && c.color === (s1.slots[i] === null ? '' : String(s1.slots[i]))), { cu, slots: s1.slots });
      // 隠れの面
      await page.evaluate(() => window.IrobinGame.setLevel(12));
      await wait(page, 100);
      const sh = await gs(page), dh = await domBottles(page);
      const fb = await page.evaluate(() => window.IrobinLogic.createLevel(12).info.fallback);
      const anyHidden = sh.bottles.some((b) => b.hidden.some(Boolean));
      check(`隠れの面（12 面、fallback ${fb}）：state に隠れの段がある=${anyHidden}（表のとおり ${fb === 0}）`, anyHidden === (fb === 0), sh.bottles.slice(0, 2));
      const hiddenSegs = dh.flatMap((b) => b.segs.filter((x) => x.h === '1'));
      check(`隠れの段（${hiddenSegs.length} 個）は data-color が空で、色が DOM から分からない（答えが見えない）`, sameAs(sh, dh) && hiddenSegs.every((x) => !x.c) && hiddenSegs.every((x) => !x.mark || true), hiddenSegs.slice(0, 3));
      check('隠れの段を含む瓶の aria-label に「？」がある', dh.filter((b) => b.segs.some((x) => x.h === '1')).every((b) => b.label.includes('？')) && (!anyHidden || hiddenSegs.length > 0), dh.map((b) => b.label).slice(0, 2));
      await ctx.close();
    },
  },
  {
    id: 'BW2', tier: 'smoke', title: 'いろびん：solution() の手順を pick で進めるとクリアのカード（next・menu）、irobin.best が更新され、next で面 +1・手 0（カードの直後 400ms は押せない）',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'BW2', { v: SMOKE_V() });
      const { sol, s } = await solveToClear(page);
      const ov = await overlayInfo(page);
      check(`手順 ${sol.length} 手でクリア：overlay "clear"・won・served = total（${s.served}/${s.total}）・phase ${s.phase}`, s.overlay === 'clear' && s.won === true && s.served === s.total && s.phase === 'clear', s);
      check(`クリアのカードに「つぎの めんへ」(next)「メニューへ」(menu)・「クリア」の文字（${ov.cmds.join(',')}）`, ov.shown && ov.cmds.includes('next') && ov.cmds.includes('menu') && /クリア/.test(ov.text), ov);
      check(`クリア後の保存：irobin.best が "1"（${await stored(page, 'irobin.best')}）、irobin.save は次の面（${await stored(page, 'irobin.save')}）`,
        (await stored(page, 'irobin.best')) === '1' && /"level":\s*2/.test((await stored(page, 'irobin.save')) || '') , { best: await stored(page, 'irobin.best'), save: await stored(page, 'irobin.save') });
      // カードの直後は押せない（400ms）
      await clickCmd(page, 'next'); await wait(page, 50);
      const early = await gs(page);
      check('カードを出した直後の next は効かない（誤タップ防止 400ms）', early.level === 1 && early.overlay === 'clear', early);
      await wait(page, 600);
      const fo = await overlayInfo(page);
      check(`しばらくたつと next が押せる（フォーカスは ${fo.active}）`, fo.shown && fo.active === 'next', fo);
      await clickCmd(page, 'next'); await wait(page, 200);
      const s2 = await gs(page), d2 = await domNums(page);
      check(`next で面 2・手 0・カードが閉じる、#level ${d2.level} も 2`, s2.level === 2 && s2.moves === 0 && s2.overlay === null && s2.phase === 'idle' && d2.level === 2 && s2.served === 0, s2);
      const sol2 = await solutionOf(page);
      await page.evaluate((f) => window.IrobinGame.pick(f), sol2[0][0]); await wait(page, 50);
      check('次の面でも遊べる（1本目を押すと selected）', (await gs(page)).phase === 'selected', await gs(page));
      await ctx.close();
    },
  },
  {
    id: 'BW3', tier: 'smoke', title: 'いろびん データ：途中で再読み込みすると同じ局面、壊れた irobin.save・irobin.best でも落ちず面 1 から、ほかのゲームの保存キーを変えない',
    async run({ browser, check }) {
      const others = { 'blockpuzzle.best': '777', 'tile2048.best': '888', 'hashi.best': '55', 'zenmai.progress': '{"stars":{"z01":3}}', 'pikatto.bestSolo': '321', 'kiritori.best': '99' };
      const { ctx, page } = await openG(browser, 'BW3', { v: SMOKE_V(), extra: { 'irobin.best': '3', ...others } });
      const s0 = await gs(page);
      check(`irobin.best が 3 なら 4 面から始まる（level ${s0.level}）`, s0.level === 4, s0);
      const sol = await solutionOf(page);
      await playMoves(page, sol.slice(0, 2));
      const s1 = await gs(page);
      const save = await stored(page, 'irobin.save');
      check(`2手注ぐと moves 2、irobin.save に v:3・面 4 と手 2 つ（瓶の id）が書かれる（${save}）`, s1.moves === 2 && /"level":\s*4/.test(save || '') && JSON.parse(save).v === 3 && JSON.parse(save).moves.length === 2, { s1: s1.moves, save });
      await page.reload(); await wait(page, 300);
      const s2 = await gs(page);
      check('再読み込みで同じ局面（面・手の数・瓶の中身が同じ）', s2.level === 4 && s2.moves === 2 && J(s2.bottles) === J(s1.bottles) && J(s2.slots) === J(s1.slots) && J(s2.queue) === J(s1.queue), { a: s1.bottles, b: s2.bottles });
      // ほかのゲームのキー
      const after = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
      const changed = Object.entries(others).filter(([k, v]) => after[k] !== v).map(([k]) => k);
      const extra = Object.keys(after).filter((k) => !(k in others) && !k.startsWith('irobin.') && k !== 'blockpuzzle.sound');
      check(`ほかのゲームの保存キーは変わらず、新しいキーは irobin.* だけ（変化 ${changed.join(',') || 'なし'}・余分 ${extra.join(',') || 'なし'}）`, changed.length === 0 && extra.length === 0, { changed, extra });
      // 壊れた保存
      const BAD_SAVE = ['{not json', '', 'null', '[]', '{"v":4,"level":3,"moves":[]}', '{"v":3,"level":0,"moves":[]}', '{"v":3,"level":-2,"moves":[]}', '{"v":3,"level":"3","moves":[]}', '{"v":3,"level":3,"moves":"x"}', '{"v":3,"level":3,"moves":[[0]]}', '{"v":3,"level":3,"moves":[[0,1.5]]}', '{"v":3,"level":3,"moves":[[0,99],[1,2]]}', '{"v":3,"level":3,"moves":[[0,0]]}', '{"v":1,"level":3,"moves":[[0,1],[2,3]]}', '{"v":2,"level":3,"moves":[[0,1],[2,3]]}'];
      const bad = [];
      for (const raw of BAD_SAVE) {
        await seed(page, { 'irobin.help': '1', 'irobin.save': raw });
        await page.goto(IR); await wait(page, 250);
        const ok = await page.evaluate(() => !!window.IrobinGame).catch(() => false);
        if (!ok) { bad.push(`${raw}: ゲームが起動しない`); continue; }
        const s = await gs(page);
        const isLevel3Start = s.level === 3 && s.moves === 0;     // 形は正しいが注げない手 → 同じ面の最初から
        const isLevel1 = s.level === 1 && s.moves === 0;           // 保存が使えない → 初期値（best 0 → 1 面）
        if (!(isLevel3Start || isLevel1) || s.phase !== 'idle') bad.push(`${raw}: level ${s.level} moves ${s.moves} phase ${s.phase}`);
        if (/"level":3/.test(raw) && /"v":3/.test(raw) && /"moves":\[\[/.test(raw) && !/\[0,1\.5\]|\[0\]\]/.test(raw) && !isLevel3Start && !isLevel1) bad.push(`${raw}: 面の最初に戻っていない`);
        if (/"v":[12]/.test(raw) && !isLevel3Start) bad.push(`${raw}: 古い保存 v:1・v:2 は手を捨てて、その面（3 面）の最初から始まるはず（level ${s.level} moves ${s.moves}）`);
      }
      check(`壊れた irobin.save（${BAD_SAVE.length} 通り）でも落ちず、面の最初（または 1 面）から始まる`, bad.length === 0, bad);
      const BAD_BEST = ['abc', '-5', '1e400', '{}', '1.5', 'NaN', 'Infinity', '', '9007199254740992'];
      const bad2 = [];
      for (const raw of BAD_BEST) {
        await seed(page, { 'irobin.help': '1', 'irobin.best': raw });
        await page.goto(IR); await wait(page, 250);
        const ok = await page.evaluate(() => !!window.IrobinGame).catch(() => false);
        if (!ok) { bad2.push(`${raw}: 起動しない`); continue; }
        const s = await gs(page), d = await domNums(page);
        if (!(s.level === 1 && s.best === 0 && d.level === 1)) bad2.push(`${raw}: level ${s.level} best ${s.best}`);
      }
      check(`壊れた irobin.best（${BAD_BEST.join(' ')}）でも落ちず、ベスト 0・面 1 から`, bad2.length === 0, bad2);
      // 保存できない環境（localStorage が投げる）でも遊べる
      const { ctx: c2, page: p2 } = await newPage(browser, SMOKE_V(), 'BW3 保存不可', { clock: true, initScript: () => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('denied'); } }); } });
      await p2.goto(IR); await wait(p2, 300);
      const noStore = await p2.evaluate(() => !!window.IrobinGame && window.IrobinGame.getState().level === 1).catch(() => false);
      check('localStorage にさわると例外になる環境でも起動して 1 面が遊べる', noStore, null);
      await c2.close();
      await ctx.close();
    },
  },
  {
    id: 'BW4', tier: 'smoke', title: 'いろびん：遊び方・プレイ中・選んでいる間・やりなおしの確認・クリアのカードのどこからでも a#back でメニューへ戻れる',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'BW4', { v: SMOKE_V(), help: false });
      check('a#back の href は ../../ でメニュー（BASE）を指す', await page.evaluate(() => document.querySelector('a#back')?.href) === BASE, await page.evaluate(() => document.querySelector('a#back')?.getAttribute('href')));
      const r = {};
      const h = await overlayInfo(page);
      check(`初回は遊び方が自動で出る（close がある。${h.cmds.join(',')}）`, h.shown && h.cmds.includes('close'), h);
      r.help = await reachable(page, 'a#back');
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      r.helpNav = page.url() === BASE;
      // プレイ中・選んでいる間
      await gotoG(page);
      r.idle = await reachable(page, 'a#back');
      const sol = await solutionOf(page);
      await page.evaluate((f) => window.IrobinGame.pick(f), sol[0][0]); await wait(page, 50);
      r.selected = (await phaseAttr(page)) === 'selected' && await reachable(page, 'a#back');
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      r.selectedNav = page.url() === BASE;
      // やりなおしの確認カード
      await gotoG(page);
      const sol2 = await solutionOf(page);
      await playMoves(page, sol2.slice(0, 1));
      await page.click('#restartBtn'); await wait(page, 100);
      const cf = await overlayInfo(page);
      r.confirm = cf.shown && cf.cmds.includes('restartYes') && cf.cmds.includes('close') && await reachable(page, 'a#back');
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      r.confirmNav = page.url() === BASE;
      // クリアのカード
      await gotoG(page, { 'irobin.save': null });
      await solveToClear(page);
      r.clear = (await overlayInfo(page)).cmds.includes('menu') && await reachable(page, 'a#back');
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      r.clearNav = page.url() === BASE;
      check('どの状態でも a#back が見えて押せる（遊び方・プレイ中・選んでいる間・やりなおしの確認・クリアのカード）', r.help && r.idle && r.selected && r.confirm && r.clear, r);
      check('遊び方・選んでいる間・確認カード・クリアのカードから a#back で実際にメニューが開く', r.helpNav && r.selectedNav && r.confirmNav && r.clearNav, r);
      // カードの「メニューへ」
      await gotoG(page, { 'irobin.save': null });
      await solveToClear(page);
      await wait(page, 600);
      await page.click('#overlay [data-cmd="menu"]'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('クリアのカードの「メニューへ」（data-cmd=menu）でメニューが開く', page.url() === BASE && await page.locator('a.game').count() >= 2, page.url());
      await ctx.close();
    },
  },

  // ================= full =================
  {
    id: 'BW5', tier: 'full', title: 'いろびん 画面内：SE 縦・SE 横（568×320・667×375）・13 横・iPad 縦横、11 本の面（40 面）でも、ボタンと瓶が 44×44 以上・safe-area 内、.head・#shop・#board・#hint・#tools が重ならない、16 桁の面番号・#hint の文言でも動かない',
    async run({ browser, check }) {
      const VS = [view('SE', 'p', 'app'), view('SE', 'p', 'safari'), view('SE', 'l', 'app'), custom(667, 375, [0, 0, 0, 0], 'SE相当 横 667×375'), view('i13', 'l', 'app'), view('iPad', 'p', 'app'), view('iPad', 'l', 'app')];
      const SEL = 'a#back, #helpBtn, #soundBtn, #board .bottle, #undoBtn, #restartBtn, .head, #shop, #board, #hint, #tools';
      for (const v of VS) {
        for (const lv of [1, 40]) {
          const { ctx, page } = await openG(browser, `BW5 ${v.label} ${lv}`, { v, extra: { 'irobin.save': J({ v: 3, level: lv, moves: [] }) } });
          const s = await gs(page);
          const r = await layoutProbe(page, SEL, v.safe, { overlapSel: '.head, #shop, #board, #hint, #tools', minSel: 'a#back, #helpBtn, #soundBtn, #board .bottle, #undoBtn, #restartBtn' });
          check(`${v.label} ${v.w}×${v.h}｜${lv} 面（瓶 ${s.bottles.length} 本）：${r.n} 要素が画面内・重なりなし・ボタンと瓶が 44px 以上・横スクロールなし`, s.level === lv && r.n > 0 && r.outside.length === 0 && r.overlaps.length === 0 && r.small.length === 0 && !r.hscroll, { level: s.level, ...r });
          if (lv === 40) check(`${v.label}：40 面は 11 本`, s.bottles.length === 11, s.bottles.length);
          await ctx.close();
        }
      }
      // 16 桁の面番号・#hint の高さ・カード
      const v = view('SE', 'p', 'app');
      const { ctx, page } = await openG(browser, 'BW5 16桁', { v, extra: { 'irobin.best': '9007199254740990' } });
      const lvl = await page.evaluate(() => { const e = document.querySelector('#level'), b = document.querySelector('.head').getBoundingClientRect(), q = e.getBoundingClientRect(); return { t: e.textContent, fit: e.scrollWidth <= e.clientWidth + 0.5, inHead: q.right <= b.right + 0.5 && q.left >= b.left - 0.5, hs: document.documentElement.scrollWidth > innerWidth }; });
      const r16 = await layoutProbe(page, SEL, v.safe, { overlapSel: '.head, #shop, #board, #hint, #tools', minSel: 'a#back, #helpBtn, #soundBtn, #board .bottle' });
      check(`16 桁の面番号（${lvl.t}）が「…」で省略されず、ヘッダーからはみ出さず、横スクロールなし`, lvl.t === MAX16 && lvl.fit && lvl.inHead && !lvl.hs && r16.outside.length === 0 && r16.overlaps.length === 0, { lvl, r16 });
      await ctx.close();
      const w = await openG(browser, 'BW5 hint', { v, extra: { 'irobin.save': J({ v: 3, level: 5, moves: [] }) } });
      const hh = async () => w.page.evaluate(() => { const h = document.querySelector('#hint').getBoundingClientRect(), b = document.querySelector('#board').getBoundingClientRect(); return `${Math.round(h.height)}/${Math.round(h.top)}/${Math.round(b.top)}/${Math.round(b.height)}`; });
      const hs = [await hh()];
      const sol = await solutionOf(w.page);
      await w.page.evaluate((f) => window.IrobinGame.pick(f), sol[0][0]); await wait(w.page, 80); hs.push(await hh());
      // 色違いへ注ぐ（deny のヒントが長い）と、詰み（ヒントが長い）
      await w.page.evaluate((s) => window.IrobinGame.setState(s), STUCK_STATE()); await wait(w.page, 80);
      await w.page.evaluate(() => { window.IrobinGame.pick(0); window.IrobinGame.pick(2); }); await wait(w.page, 80);
      const dHint = await hintText(w.page);
      hs.push(await hh());
      await w.page.evaluate(() => { window.IrobinGame.pick(0); window.IrobinGame.pick(1); window.IrobinGame.skip(); }); await wait(w.page, 100);
      const sGs = await gs(w.page);
      hs.push(await hh());
      check(`#hint の文言が変わっても高さと盤の位置が動かない（idle・selected・deny「${dHint}」・stuck：${hs.join(' | ')}。stuck=${sGs.phase}）`, new Set(hs).size === 1 && hs.length >= 4 && sGs.phase === 'stuck' && !!dHint, hs);
      await w.ctx.close();
      // カード（遊び方・クリア・確認）が SE 縦・SE 横で切れない
      for (const vv of [view('SE', 'p', 'app'), view('SE', 'l', 'app')]) {
        const h = await openG(browser, `BW5 カード ${vv.label}`, { v: vv, help: false });
        const o1 = await overlayProbe(h.page, vv.safe);
        check(`${vv.label}：遊び方カードの見出しが切れず、全ボタンに届き 44px 以上`, overlayOk(o1), o1);
        await clickCmd(h.page, 'close'); await wait(h.page, 400);
        const sol3 = await solutionOf(h.page);
        await playMoves(h.page, sol3.slice(0, 1));
        await h.page.click('#restartBtn'); await wait(h.page, 100);
        const o2 = await overlayProbe(h.page, vv.safe);
        check(`${vv.label}：やりなおしの確認カードも同じ`, overlayOk(o2), o2);
        await clickCmd(h.page, 'close'); await wait(h.page, 400);
        await solveToClear(h.page); await wait(h.page, 100);
        const o3 = await overlayProbe(h.page, vv.safe);
        check(`${vv.label}：クリアのカードも同じ`, overlayOk(o3), o3);
        await h.ctx.close();
      }
    },
  },
  {
    id: 'BW6', tier: 'full', title: 'いろびん お助け：1手もどすを手の数だけ押すと最初の局面（最初は disabled）、やりなおしは確認カード → restartYes で最初から・手 0',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'BW6', { extra: { 'irobin.best': '2' } });
      const s0 = await gs(page);
      const dis0 = await page.evaluate(() => ({ u: document.querySelector('#undoBtn').disabled, r: document.querySelector('#restartBtn').disabled }));
      check('最初の状態では「1手もどす」が disabled、canUndo は false', dis0.u === true && s0.canUndo === false, { dis0, canUndo: s0.canUndo });
      const sol = await solutionOf(page);
      const N = Math.min(4, sol.length - 1);
      await playMoves(page, sol.slice(0, N));
      const s1 = await gs(page);
      const dis1 = await page.evaluate(() => document.querySelector('#undoBtn').disabled);
      check(`${N} 手注ぐと moves ${s1.moves}・「1手もどす」が押せる（canUndo ${s1.canUndo}）`, s1.moves === N && s1.canUndo === true && dis1 === false, s1);
      // 1手ずつ戻す（途中の局面も確認：N-1 手目の局面は、同じ手を最初から当て直したものと同じ）
      const exp = await page.evaluate(([sol, n]) => { const L = window.IrobinLogic; const lv = window.IrobinGame.getState().level; return JSON.parse(JSON.stringify(L.replay(lv, L.toIdMoves(L.createLevel(lv).state, sol.slice(0, n))).state.bottles)); }, [sol, N - 1]);
      await page.click('#undoBtn'); await wait(page, 100);
      const s2 = await gs(page);
      check(`1回押すと moves ${N - 1}・瓶の中身が ${N - 1} 手目の局面と同じ`, s2.moves === N - 1 && J(s2.bottles) === J(exp), { moves: s2.moves });
      for (let i = 0; i < N - 1; i++) { await page.click('#undoBtn'); await wait(page, 100); }
      const s3 = await gs(page);
      check('手の数だけ押すと最初の局面（瓶・お客さん・列が最初と同じ）・moves 0・もう戻せない（disabled）', s3.moves === 0 && J(s3.bottles) === J(s0.bottles) && J(s3.slots) === J(s0.slots) && J(s3.queue) === J(s0.queue) && s3.canUndo === false && (await page.evaluate(() => document.querySelector('#undoBtn').disabled)), { moves: s3.moves });
      check(`戻した後の保存も 0 手（irobin.save ${await stored(page, 'irobin.save')}）`, JSON.parse((await stored(page, 'irobin.save')) || '{"moves":[1]}').moves.length === 0, await stored(page, 'irobin.save'));
      // やりなおし
      const noOv = await (async () => { await page.click('#restartBtn').catch(() => {}); await wait(page, 80); return overlayInfo(page); })();
      check('手が 0 のときの「やりなおし」は何も起こさない（確認カードを出さない）', !noOv.shown, noOv);
      await playMoves(page, sol.slice(0, 2));
      await page.click('#restartBtn'); await wait(page, 100);
      const cf = await overlayInfo(page), sc = await gs(page);
      check(`手があると確認カード（${cf.cmds.join(',')}）が出て、まだ手は消えない（moves ${sc.moves}）`, cf.shown && cf.cmds.includes('restartYes') && cf.cmds.includes('close') && sc.moves === 2 && sc.overlay === 'confirm', { cf, sc });
      await clickCmd(page, 'close'); await wait(page, 400);
      const sk = await gs(page);
      check('「やめる」(close) で閉じ、手はそのまま', sk.moves === 2 && sk.overlay === null, sk);
      await page.click('#restartBtn'); await wait(page, 100);
      await wait(page, 500);
      await clickCmd(page, 'restartYes'); await wait(page, 150);
      const s4 = await gs(page);
      check('「やりなおす」(restartYes) で最初の局面に戻り、手 0・カードが閉じる', s4.moves === 0 && J(s4.bottles) === J(s0.bottles) && s4.overlay === null && s4.phase === 'idle' && s4.canUndo === false, s4);
      await ctx.close();
    },
  },
  {
    id: 'BW7', tier: 'full', title: 'いろびん 詰み：setState で詰みの局面を作り、1手注ぐと stuck。ヒントに「1手もどす」、お助け2つに data-attention="1"、1手もどすで解ける',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'BW7');
      const okSet = await page.evaluate((s) => window.IrobinGame.setState(s), STUCK_STATE());
      check('setState が詰みの局面を受け付ける（true）', okSet === true, okSet);
      await wait(page, 100);
      const s0 = await gs(page);
      const a0 = await page.evaluate(() => [document.querySelector('#undoBtn').dataset.attention ?? null, document.querySelector('#restartBtn').dataset.attention ?? null]);
      check('注ぐ前は詰みでない（phase idle・お助けは目立たせない）', s0.phase === 'idle' && s0.stuck === false && !a0.includes('1'), { s0: s0.phase, a0 });
      await page.evaluate(() => { window.IrobinGame.pick(0); window.IrobinGame.pick(1); window.IrobinGame.skip(); });
      await wait(page, 150);
      const s1 = await gs(page), hint = await hintText(page);
      const a1 = await page.evaluate(() => [document.querySelector('#undoBtn').dataset.attention ?? null, document.querySelector('#restartBtn').dataset.attention ?? null]);
      check(`1手注ぐと phase stuck（data-phase ${await phaseAttr(page)}）・stuck true・ゲームオーバーのカードは出ない（overlay ${s1.overlay}）`, s1.phase === 'stuck' && s1.stuck === true && (await phaseAttr(page)) === 'stuck' && s1.overlay === null && s1.moves === 1, s1);
      check(`ヒントが詰みを伝え「1手もどす」を案内する（${hint}）`, /1手もどす/.test(hint || '') && /やりなおし/.test(hint || ''), hint);
      check('「1手もどす」「やりなおし」に data-attention="1"（目立たせる）', a1[0] === '1' && a1[1] === '1', a1);
      await page.click('#undoBtn', { force: true }); await wait(page, 150);
      const s2 = await gs(page);
      const a2 = await page.evaluate(() => [document.querySelector('#undoBtn').dataset.attention ?? null, document.querySelector('#restartBtn').dataset.attention ?? null]);
      check('1手もどすで詰みが解け（phase idle・moves 0）、お助けの目印も消える', s2.phase === 'idle' && s2.stuck === false && s2.moves === 0 && !a2.includes('1'), { s2: s2.phase, a2 });
      // 形のおかしい state は受け付けない
      const bad = await page.evaluate(() => [window.IrobinGame.setState(null), window.IrobinGame.setState({}), window.IrobinGame.setState({ bottles: 'x' }), window.IrobinGame.setState({ bottles: [{ cells: [99], hidden: [false], sealed: false }], slots: [null, null], queue: [] })]);
      check('形がおかしい setState は false（落ちない）', bad.every((x) => x === false), bad);
      await ctx.close();
    },
  },
  {
    id: 'BW8', tier: 'full', title: 'いろびん キーボード：矢印でフォーカスが動き、Enter・数字キーで注げる。U で戻る、Esc で選ぶのをやめる、M で音のオン/オフ、R で確認、カードが開いているときは瓶が反応しない',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'BW8', { opts: { touch: false }, extra: { 'irobin.best': '2' } });
      const idx = () => page.evaluate(() => { const a = document.activeElement; return a && a.classList.contains('bottle') ? Number(a.dataset.index) : null; });
      const key = async (k) => { await page.keyboard.press(k); await wait(page, 60); };
      const settleK = async () => { await page.evaluate(() => window.IrobinGame.skip()); await wait(page, 60); };
      const s0 = await gs(page);
      const n = s0.bottles.length;
      await page.evaluate(() => document.querySelector('#board .bottle').focus());
      check('先頭の瓶にフォーカスできる', (await idx()) === 0);
      await key('ArrowRight');
      const r1 = await idx();
      await key('ArrowLeft'); const r0 = await idx();
      await key('ArrowLeft'); const rEdge = await idx();
      check(`→ で 1 番へ、← で 0 番へ、端（0 番）で ← は動かない（${r1}・${r0}・${rEdge}）`, r1 === 1 && r0 === 0 && rEdge === 0, { r1, r0, rEdge });
      const cols = await page.evaluate(() => Number(document.querySelector('#board').dataset.cols));
      await key('ArrowDown'); const dn = await idx();
      await key('ArrowUp'); const up = await idx();
      const expDn = cols < n ? cols : 0;
      check(`#board[data-cols]=${cols} のとき ↓ は ${expDn} 番、↑ で 0 番に戻る（${dn}・${up}）`, Number.isInteger(cols) && cols >= 1 && dn === expDn && up === 0, { cols, dn, up });
      // Enter で選んで注ぐ
      const sol = await solutionOf(page);
      const [f1, t1] = sol[0];
      await page.evaluate((i) => document.querySelectorAll('#board .bottle')[i].focus(), f1);
      await key('Enter');
      const sel = await gs(page);
      check(`Enter で ${f1} 番を選ぶ（selected ${sel.selected}・phase ${sel.phase}）`, sel.selected === f1 && sel.phase === 'selected', sel);
      await key('Escape');
      const esc = await gs(page);
      check('Esc で選ぶのをやめる（selected null・phase idle・カードは出ない）', esc.selected === null && esc.phase === 'idle' && esc.overlay === null, esc);
      await page.evaluate((i) => document.querySelectorAll('#board .bottle')[i].focus(), f1);
      await key('Enter');
      await page.evaluate((i) => document.querySelectorAll('#board .bottle')[i].focus(), t1);
      await key('Enter'); await settleK();
      const m1 = await gs(page);
      check(`Enter で ${f1} → ${t1} に注げる（moves ${m1.moves}）`, m1.moves === 1 && J(m1.bottles) !== J(s0.bottles), m1);
      // 数字キー
      const [f2, t2] = sol[1];
      if (f2 < 9 && t2 < 9) {
        await key(String(f2 + 1)); const sd = await gs(page);
        await key(String(t2 + 1)); await settleK();
        const m2 = await gs(page);
        check(`数字キー ${f2 + 1} → ${t2 + 1} で ${f2} → ${t2} に注げる（moves ${m2.moves}）`, sd.selected === f2 && m2.moves === 2, { sel: sd.selected, m2: m2.moves });
      } else check('数字キーで注げる（10 本目以降は対象外の手）', false, { f2, t2 });
      // U で戻る
      await key('u'); await settleK();
      const u1 = await gs(page);
      check(`U で 1 手もどる（moves ${u1.moves}）`, u1.moves === 1, u1);
      await key('Backspace'); await settleK();
      const u2 = await gs(page);
      check(`Backspace でももどる（moves ${u2.moves}）`, u2.moves === 0 && J(u2.bottles) === J(s0.bottles), u2);
      // M で音
      const sp0 = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      await key('m');
      const sp1 = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      await key('m');
      const sp2 = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      check(`M で ♪ の aria-pressed が切り替わり、もう一度で戻る（${sp0}→${sp1}→${sp2}）`, sp0 !== sp1 && sp0 === sp2, [sp0, sp1, sp2]);
      // R で確認、カードの間は瓶が反応しない
      await playMoves(page, sol.slice(0, 1));
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await key('r');
      const ov = await overlayInfo(page);
      check(`R でやりなおしの確認カード（${ov.cmds.join(',')}）`, ov.shown && ov.cmds.includes('restartYes'), ov);
      const before = await gs(page);
      await key('1'); await key('2'); await key('3');
      const after = await gs(page);
      check('カードが開いている間は数字キーで瓶を選べない（selected null・moves 変わらず）', after.selected === null && after.moves === before.moves, after);
      await key('Escape');
      const closed = await overlayInfo(page), s5 = await gs(page);
      check('Esc で確認カードが閉じる（手はそのまま）', !closed.shown && s5.moves === 1, { closed, moves: s5.moves });
      await key('Shift+/');
      const help = await overlayInfo(page);
      check(`? で遊び方カードが開く（${help.cmds.join(',')}）`, help.shown && help.cmds.includes('close'), help);
      await key('Escape');
      check('Esc で遊び方カードが閉じる', !(await overlayInfo(page)).shown, null);
      await ctx.close();
    },
  },
  {
    id: 'BW9', tier: 'full', title: 'いろびん 中断：注ぐ演出の途中で hidden にすると paused、演出が止まり timers は増えない、visible で演出が終わって idle。遊び方を開いたときも止まる',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'BW9', { extra: { 'irobin.best': '2' } });
      const sol = await solutionOf(page);
      const [f, t] = sol[0];
      const t0 = (await gs(page)).timers;
      await page.evaluate(([f, t]) => { window.IrobinGame.pick(f); window.IrobinGame.pick(t); }, [f, t]);
      await sleep(60);
      const p0 = await gs(page);
      check(`注ぐ演出の途中：phase pouring・busy true（${p0.phase}・${p0.busy}）`, p0.phase === 'pouring' && p0.busy === true && (await phaseAttr(page)) === 'pouring', p0);
      await setHidden(page, true); await sleep(80);
      const h1 = await gs(page);
      const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
      check(`hidden で phase paused（data-phase ${await phaseAttr(page)}）・paused true、動いているアニメーション ${running} 個（0）、timers ${h1.timers}（増えない：前 ${t0}）`,
        h1.phase === 'paused' && h1.paused === true && (await phaseAttr(page)) === 'paused' && running === 0 && h1.timers <= t0 + 1, { h1, running });
      await sleep(2800);
      const h2 = await gs(page);
      check(`隠れている間は進まない（2.8 秒後も paused・busy ${h2.busy}・moves ${h2.moves}・timers ${h2.timers}）`, h2.phase === 'paused' && h2.busy === true && h2.moves === 1 && h2.timers <= t0 + 1, h2);
      await setHidden(page, false);
      let h3 = null;
      for (let i = 0; i < 60; i++) { await sleep(100); await wait(page, 100); h3 = await gs(page); if (h3.phase === 'idle' && !h3.busy) break; }
      check(`visible に戻ると続きから演出が終わって idle（${h3.phase}・busy ${h3.busy}）・一時停止カードは出ない（${h3.overlay}）`, h3.phase === 'idle' && h3.busy === false && h3.overlay === null && h3.moves === 1, h3);
      await ctx.close();
      // 遊び方を開く
      const w = await openG(browser, 'BW9 help', { extra: { 'irobin.best': '2' } });
      const sol2 = await solutionOf(w.page);
      await w.page.evaluate(([f, t]) => { window.IrobinGame.pick(f); window.IrobinGame.pick(t); }, sol2[0]);
      await sleep(60);
      await w.page.click('#helpBtn'); await wait(w.page, 100);
      const r1 = await w.page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
      const g1 = await gs(w.page);
      check(`注ぐ途中で「？」を開くと演出が止まる（動いている ${r1} 個・overlay ${g1.overlay}・moves ${g1.moves}）`, g1.overlay === 'help' && r1 === 0 && g1.moves === 1, { r1, g1 });
      await sleep(1500);
      check('遊び方を開いている間は進まない（busy のまま）', (await gs(w.page)).busy === true, await gs(w.page));
      await wait(w.page, 400);
      await clickCmd(w.page, 'close');
      let g2 = null;
      for (let i = 0; i < 60; i++) { await sleep(100); await wait(w.page, 100); g2 = await gs(w.page); if (g2.phase === 'idle' && !g2.busy) break; }
      check(`閉じると演出が続いて終わる（${g2.phase}・busy ${g2.busy}）`, g2.phase === 'idle' && g2.busy === false && g2.overlay === null, g2);
      await w.ctx.close();
    },
  },
  {
    id: 'BW10', tier: 'full', audio: true, title: 'いろびん 効果音：pick・pour・seal・cork・deliver・arrive・clear（・reveal）が起きた順に鳴り、実際に音の部品が動く。♪でオフにすると鳴らない',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'BW10', { opts: { initScript: SFX_SPY, touch: false, reducedMotion: 'reduce' }, extra: { 'irobin.save': J({ v: 3, level: 3, moves: [] }) } });
      const names = await page.evaluate(() => YubiSfx.create('irobin').names);
      const want = ['pick', 'drop', 'pour', 'reveal', 'seal', 'cork', 'deliver', 'arrive', 'clear', 'deny', 'undo', 'stuck', 'start', 'best', 'toggle'];
      check(`sfx.js の "irobin" に契約の音名 ${want.length} 個がある`, want.every((n) => names.includes(n)), want.filter((n) => !names.includes(n)));
      const sol = await solutionOf(page);
      // 最初の1本だけ本物のクリック（音の準備 unlock を通す）、あとは API で、1手ずつ演出が終わるのを待つ
      // 1手ごとに演出が終わるのを待ち、さらに音の部品が鳴り終わる（同時発音の枠が空く）のを実時間で待つ（動きを減らす設定は演出が極端に短いので、そろった後は長めに）
      const stepWait = async () => { for (let i = 0; i < 60; i++) { const s = await gs(page); if (!s.busy && s.phase !== 'pouring') break; await sleep(40); await wait(page, 40); } const tail = (await plays(page)).slice(-6).map((p) => p.n); await sleep(tail.includes('seal') || tail.includes('clear') ? 900 : 150); };
      await clickBottle(page, sol[0][0]);
      await page.evaluate((t) => window.IrobinGame.pick(t), sol[0][1]);
      await stepWait();
      for (const [f, t] of sol.slice(1)) {
        await page.evaluate(([f, t]) => { window.IrobinGame.pick(f); window.IrobinGame.pick(t); }, [f, t]);
        await stepWait();
      }
      for (let i = 0; i < 60 && (await gs(page)).overlay !== 'clear'; i++) { await sleep(40); await wait(page, 40); }
      await sleep(300);
      const pl = await plays(page);
      const seq = pl.map((p) => p.n);
      const first = (n) => seq.indexOf(n), last = (n) => seq.lastIndexOf(n);
      check(`鳴った順：pick → pour → seal・cork → deliver → arrive、最後に clear（${seq.filter((n, i) => n !== seq[i - 1]).join(',')}）`,
        first('pick') >= 0 && first('pick') < first('pour') && first('pour') < first('seal') && first('pour') < first('cork') && Math.max(first('seal'), first('cork')) < first('deliver') && first('deliver') < first('arrive') && last('deliver') < last('clear') && first('clear') >= 0, seq);
      const cnt = (n) => seq.filter((x) => x === n).length;
      const s = await gs(page);
      check(`seal・deliver は色の数だけ（${cnt('seal')}・${cnt('deliver')}／${s.total}）、clear は 1 回（${cnt('clear')}）`, cnt('seal') === s.total && cnt('deliver') === s.total && cnt('clear') === 1, { seal: cnt('seal'), deliver: cnt('deliver'), total: s.total });
      const pour = pl.filter((p) => p.n === 'pour');
      check(`pour には注いだ段数 1〜4 を渡す（${pour.length} 回）`, pour.length > 0 && pour.every((p) => Number.isInteger(p.a) && p.a >= 1 && p.a <= 4), pour.slice(0, 5));
      const seal = pl.filter((p) => p.n === 'seal');
      check('seal には色 id（0〜8）を渡す', seal.length > 0 && seal.every((p) => Number.isInteger(p.a) && p.a >= 0 && p.a <= 8), seal.slice(0, 5));
      const notStarted = pl.filter((p) => !p.known || (['seal', 'cork', 'deliver', 'clear'].includes(p.n) && !(p.d > 0)));
      const firstOk = ['pick', 'pour'].filter((n) => !pl.some((p) => p.n === n && p.d > 0));
      check('どの呼び出しも既知の音名で、seal・cork・deliver・clear はすべて音の部品が start した（同時発音の上限で落ちない）、pick・pour も鳴った', !notStarted.length && firstOk.length === 0 && pl.length > 0, { notStarted, firstOk });
      // 隠れの面では reveal が鳴る
      await page.evaluate(() => window.IrobinGame.setLevel(12));
      await wait(page, 100);
      await page.evaluate(() => window.__plays.splice(0));
      const sol12 = await solutionOf(page);
      for (const [f, t] of sol12.slice(0, 6)) {
        await page.evaluate(([f, t]) => { window.IrobinGame.pick(f); window.IrobinGame.pick(t); }, [f, t]);
        await stepWait();
      }
      const seq12 = (await plays(page)).map((p) => p.n);
      const fb = await page.evaluate(() => window.IrobinLogic.createLevel(12).info.fallback);
      check(`隠れの面（12 面）で注ぐと reveal が鳴る（fallback ${fb}。${seq12.join(',')}）`, fb !== 0 || seq12.includes('reveal'), seq12);
      // 音をオフ
      await page.click('#soundBtn'); await wait(page, 100);
      const pressed = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      await page.evaluate(() => window.IrobinGame.setLevel(2)); await wait(page, 100);
      const st0 = await page.evaluate(() => window.__starts);
      const sol2 = await solutionOf(page);
      await page.evaluate(([f, t]) => { window.IrobinGame.pick(f); window.IrobinGame.pick(t); }, sol2[0]);
      await stepWait();
      const st1 = await page.evaluate(() => window.__starts);
      check(`♪でオフ（aria-pressed ${pressed}）にすると、注いでも音が鳴らない（start ${st1 - st0}）`, pressed === 'false' && st1 - st0 === 0, { st0, st1, pressed });
      await ctx.close();
    },
  },
  {
    id: 'BW11', tier: 'full', title: 'いろびん 色覚：各 .seg に記号（.mark）があり色ごとに記号が違う、瓶の aria-label に色の名前、お客さんのトレイにも記号と色の名前',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'BW11', { extra: { 'irobin.save': J({ v: 3, level: 9, moves: [] }) } });
      const dom = await domBottles(page), s = await gs(page);
      const segs = dom.flatMap((b) => b.segs).filter((x) => x.h !== '1');
      check(`見えている段 ${segs.length} 個のすべてに記号（.mark）がある`, segs.length > 0 && segs.every((x) => x.mark && x.mark.length > 0), segs.filter((x) => !x.mark).slice(0, 3));
      const byColor = {};
      for (const g of segs) (byColor[g.c] = byColor[g.c] || new Set()).add(g.mark);
      const colors = Object.keys(byColor);
      const oneEach = colors.every((c) => byColor[c].size === 1);
      const sigs = colors.map((c) => [...byColor[c]][0]);
      check(`色（${colors.length} 色）ごとに記号が 1 種類で、色が違えば記号も違う`, colors.length >= 6 && oneEach && new Set(sigs).size === colors.length, { colors, sizes: colors.map((c) => byColor[c].size) });
      const names = await page.evaluate(() => window.IrobinLogic.COLORS.map((c) => c.name));
      // 布の瓶（data-covered="1"）は中身を見せない（色の名前を言わない）ので除いて調べ、布の瓶は色の名前を言わないことを別に確かめる
      const sb = (b) => s.bottles[b.i];
      const open9 = dom.filter((b) => !b.covered);
      const badLabel = open9.filter((b) => sb(b).cells.some((c, k) => !sb(b).hidden[k]) && !sb(b).cells.every((c, k) => sb(b).hidden[k] || b.label.includes(names[c]))).map((b) => b.label);
      check(`布でない瓶 ${open9.length} 本の aria-label に、中の見えている色の名前がある`, open9.length > 0 && badLabel.length === 0 && dom.every((b) => b.label.length > 0), badLabel.slice(0, 3));
      const cov9 = dom.filter((b) => b.covered);
      const covLeak = cov9.filter((b) => b.segs.length > 0 || names.some((n) => b.label.includes(n)) || !(sb(b) && sb(b).cover !== null));
      check(`布の瓶（${cov9.length} 本）は中身の段を描かず、aria-label にも色の名前を出さない（中身が分からない）`, covLeak.length === 0, covLeak.map((b) => b.label));
      const cu = await domCust(page);
      const shown = cu.filter((c) => c && c.color !== '');
      check(`お客さんのトレイに記号（または色の表示）があり、読み上げ用の文に色の名前がある（${shown.map((c) => c.sr).join(' / ')}）`,
        shown.length === 2 && shown.every((c) => c.tray && names.some((n) => (c.sr || '').includes(n)) && (c.sr || '').includes(names[Number(c.color)])), cu);
      // 隠れの面でも記号は見えている段だけ。隠れた段に色の名前を出さない
      await page.evaluate(() => window.IrobinGame.setLevel(14)); await wait(page, 100);
      const d14 = await domBottles(page), s14 = await gs(page);
      const colorSigs = new Set(d14.flatMap((b) => b.segs.filter((x) => x.h !== '1' && x.mark).map((x) => x.mark)));
      const hiddenSegs = d14.flatMap((b) => b.segs.filter((x) => x.h === '1'));
      const hiddenSigs = new Set(hiddenSegs.map((x) => x.mark));
      const leak = [...hiddenSegs.filter((x) => x.c), ...[...hiddenSigs].filter((m) => m && colorSigs.has(m))];
      if (hiddenSigs.size > 1) leak.push('隠れの記号が段ごとに違う');
      const labelLeak = d14.filter((b) => { const x = s14.bottles[b.i]; return x.hidden.some(Boolean) && x.cells.some((c, k) => x.hidden[k] && b.label.includes(names[c]) && !x.cells.some((c2, k2) => !x.hidden[k2] && c2 === c)); }).length;
      check(`隠れの段（${hiddenSegs.length} 個）には色を出さず、「？」の同じ記号だけ（色の記号と重ならない）、aria-label にも隠れた色の名前を出さない（答えが分からない）`, hiddenSegs.length > 0 && leak.length === 0 && labelLeak === 0, { leak, labelLeak });
      await ctx.close();
    },
  },
  {
    id: 'BW12', tier: 'full', title: 'いろびん 動きを減らす：reducedMotion: reduce で calm が true、注ぐ演出が 0.3 秒以内に終わる（通常は calm false）',
    async run({ browser, check }) {
      const normal = await openG(browser, 'BW12 通常', { opts: { clock: false }, extra: { 'irobin.best': '2' } });
      check('通常は calm false', (await gs(normal.page)).calm === false, await gs(normal.page));
      await normal.ctx.close();
      const { ctx, page } = await openG(browser, 'BW12 calm', { opts: { clock: false, reducedMotion: 'reduce' }, extra: { 'irobin.best': '2' } });
      const s0 = await gs(page);
      check('reducedMotion: reduce で calm true', s0.calm === true, s0);
      const sol = await solutionOf(page);
      const ms = await page.evaluate(([f, t]) => new Promise((ok) => {
        const g = window.IrobinGame, a = performance.now();
        g.pick(f); g.pick(t);
        const tick = () => { const s = g.getState(); if (!s.busy && s.phase !== 'pouring') ok(performance.now() - a); else if (performance.now() - a > 4000) ok(9999); else requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }), sol[0]);
      const s1 = await gs(page);
      check(`注ぐ演出が 0.3 秒以内に終わる（${Math.round(ms)}ms。計測の余裕を見て 500ms 未満）・注ぎ終えている（moves ${s1.moves}）`, ms < 500 && s1.moves === 1, ms);
      const anim = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
      check(`終わった後に動き続けるアニメーションがない（${anim} 個）`, anim === 0, anim);
      await ctx.close();
    },
  },
  {
    id: 'BW13', tier: 'full', title: 'いろびん オフライン：sw.js の APP_FILES に games/irobin/* がすべて入り（無ければ不合格）、接続を切っても開いて遊べ、部品は Service Worker から読まれ、メニューに戻れる',
    async run({ browser, check, srv, root }) {
      const info = swInfo(root);
      const dir = path.join(root, 'games/irobin');
      const actual = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : [];
      const want = ['./games/irobin/', ...['index.html', 'logic.js', 'render.js', 'input.js', 'main.js'].map((f) => `./games/irobin/${f}`), ...actual.map((f) => `./games/irobin/${f}`)];
      const uniq = [...new Set(want)];
      const missing = uniq.filter((f) => !info.files.includes(f));
      check(`sw.js の APP_FILES に games/irobin/ の ${uniq.length} 件がすべてある（足りない：${missing.join(' / ') || 'なし'}）`, missing.length === 0 && actual.length >= 5, missing);
      const exist = uniq.filter((f) => !f.endsWith('/')).filter((f) => !fs.existsSync(path.join(root, f)));
      check('APP_FILES に足すファイルが実際にある', exist.length === 0, exist);
      if (missing.length) return;
      srv.reset();
      const { ctx, page } = await newPage(browser, custom(390, 844, null, 'iPhone 13'), 'BW13', { sw: true, allowNetErrors: true });
      await page.goto(BASE);
      const ok = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]));
      if (!ok) throw new Error('Service Worker が 8 秒以内に有効にならない（事前キャッシュの install 失敗の可能性）');
      if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }); }
      await page.evaluate(() => localStorage.setItem('irobin.help', '1'));
      await sleep(200);
      await srv.ctl('offline=1');
      const resp = [];
      page.on('response', (r) => { if (/\/games\/irobin\/|\/common\/sfx\.js/.test(r.url())) resp.push({ f: r.url().split('/').slice(-2).join('/'), status: r.status(), sw: r.fromServiceWorker() }); });
      await page.goto(IR, { timeout: 10000 }); await sleep(500);
      const libs = await page.evaluate(() => ({ L: typeof window.IrobinLogic?.applyMove, R: typeof window.IrobinRender?.create, I: typeof window.IrobinInput?.attach, Y: typeof window.YubiSfx?.create, G: typeof window.IrobinGame?.getState }));
      check('オフラインで開き、IrobinLogic・IrobinRender・IrobinInput・YubiSfx・IrobinGame が使える', Object.values(libs).every((x) => x === 'function'), libs);
      const js = ['logic.js', 'render.js', 'input.js', 'main.js', 'common/sfx.js'].map((f) => ({ f, hit: resp.find((r) => r.f.endsWith(f)) }));
      check('logic.js・render.js・input.js・main.js・sfx.js を Service Worker から 200 で読んだ', js.every((x) => x.hit && x.hit.sw && x.hit.status === 200), { js, resp });
      if (libs.G === 'function') {
        const sol = await page.evaluate(() => window.IrobinGame.solution());
        await page.evaluate((m) => { for (const [f, t] of m.slice(0, 2)) { window.IrobinGame.pick(f); window.IrobinGame.pick(t); window.IrobinGame.skip(); } }, sol);
        const s = await gs(page);
        check(`オフラインで遊べる（2 手注げた。moves ${s.moves}）`, s.moves === 2, s);
      }
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('オフラインのまま、メニューに戻れる', page.url() === BASE && await page.locator('a.game').count() >= 2, page.url());
      await srv.ctl('offline=0');
      await ctx.close();
    },
  },
  {
    id: 'BW14', tier: 'full', cdp: CDP, title: 'いろびん タッチ：#board のダブルタップで拡大しない（dblclick・gesture・2回目の touchend を止める）、カードを閉じた直後の押下が瓶に届かない',
    async run({ browser, check }) {
      const TE_SPY = () => { window.__te = []; window.addEventListener('touchend', (e) => window.__te.push({ p: e.defaultPrevented })); };
      const { ctx, page } = await newPage(browser, custom(390, 664, null, 'iPhone 13 Safari'), 'BW14', { device: 'iPhone 13', initScript: TE_SPY, clock: true });
      await gotoG(page);
      const g = await page.evaluate(() => {
        const el = document.querySelector('#board');
        const d = el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        const gsv = ['gesturestart', 'gesturechange'].map((n) => el.dispatchEvent(new Event(n, { bubbles: true, cancelable: true })));
        return { dbl: !d, gesture: gsv.every((x) => !x), ta: getComputedStyle(document.body).touchAction };
      });
      check(`#board：dblclick・gesturestart/change を止め、touch-action ${g.ta}（manipulation か none）`, g.dbl && g.gesture && /manipulation|none/.test(g.ta), g);
      const t = await touch(ctx, page);
      await page.evaluate(() => window.__te.splice(0));
      await t.doubleTap('#board'); await wait(page, 300);
      const ev = await page.evaluate(() => window.__te.splice(0));
      const sc = await page.evaluate(() => window.visualViewport.scale);
      check(`素早い2回タップ：2回目の touchend が止められ（${ev.map((e) => e.p).join(',')}）、拡大しない（scale ${sc}）`, ev.length === 2 && ev[1].p === true && sc === 1, { ev, sc });
      const u = await touch(ctx, page);
      const toolsEv = await (async () => { await page.evaluate(() => window.__te.splice(0)); await u.doubleTap('#tools'); await wait(page, 300); return page.evaluate(() => window.__te.splice(0)); })();
      check(`.tools でも2回目の touchend が止められる（${toolsEv.map((e) => e.p).join(',')}）・拡大しない`, toolsEv.length === 2 && toolsEv[1].p === true && (await page.evaluate(() => window.visualViewport.scale)) === 1, toolsEv);
      // 遊び方を閉じた直後の押下は瓶に届かない
      await page.click('#helpBtn'); await wait(page, 200);
      const sol = await solutionOf(page);
      const b0 = await page.locator(`#board .bottle[data-index="${sol[0][0]}"]`).boundingBox();
      const cx = b0.x + b0.width / 2, cy = b0.y + b0.height / 2;
      await frozen(page, async () => {
        await clickCmd(page, 'close');
        await t.send('touchStart', [{ x: cx, y: cy }]); await sleep(40); await t.send('touchEnd', []);
        await sleep(40);
      });
      await wait(page, 100);
      const near = await gs(page);
      check(`遊び方を閉じた直後（300ms 以内）の押下は瓶を選ばない（selected ${near.selected}）`, near.selected === null && near.phase === 'idle', near);
      await wait(page, 600);
      await t.tapEl(`#board .bottle[data-index="${sol[0][0]}"]`); await wait(page, 200);
      const later = await gs(page);
      check(`しばらくたてば押せる（selected ${later.selected}）`, later.selected === sol[0][0], later);
      await ctx.close();
    },
  },
  {
    id: 'BW15', tier: 'full', title: 'いろびん メニュー：カードの名前が IrobinLogic.NAME と一致し、irobin.best が 3 なら「3 めん クリア」、壊れた値・0 なら「まだ記録なし」',
    async run({ browser, check, root }) {
      const f = path.join(root, 'games/irobin/logic.js');
      if (!fs.existsSync(f)) throw new Error('games/irobin/logic.js が無い');
      const NAME = createRequire(f)(f).NAME;
      const { ctx, page } = await newPage(browser, STD_V(), 'BW15', { clock: true });
      const card = () => page.evaluate(() => {
        const a = document.querySelector('a.game[href="games/irobin/"]');
        if (!a) return null;
        const b = a.querySelector('.best b');
        const q = a.getBoundingClientRect(), cv = a.querySelector('canvas.art');
        return { name: a.querySelector('.name')?.textContent.trim(), best: b?.textContent.trim(), none: b?.classList.contains('none'), aria: a.getAttribute('aria-label'), w: q.width, h: q.height, art: !!cv && cv.width > 0 };
      });
      await seed(page, {});
      await page.goto(BASE); await wait(page, 200);
      const c0 = await card();
      check(`メニューにいろびんのカードがあり、名前（${c0 && c0.name}）が IrobinLogic.NAME（${NAME}）と一致`, !!c0 && c0.name === NAME && c0.h >= 44, c0);
      check(`記録が無いときは「まだ記録なし」（${c0 && c0.best}）`, c0 && c0.best === 'まだ記録なし' && c0.none === true, c0);
      await seed(page, { 'irobin.best': '3' });
      await page.goto(BASE); await wait(page, 200);
      const c3 = await card();
      check(`irobin.best が 3 なら「3 めん クリア」（${c3 && c3.best}）、aria-label にも出る`, c3 && c3.best === '3 めん クリア' && !c3.none && /3 めん クリア/.test(c3.aria), c3);
      const bad = [];
      for (const raw of ['abc', '-1', '1.5', '', '0', 'NaN', 'Infinity', '1e400', '{}', '9007199254740992']) {
        await seed(page, { 'irobin.best': raw });
        await page.goto(BASE); await wait(page, 150);
        const c = await card();
        if (!c || c.best !== 'まだ記録なし') bad.push(`${raw}: ${c && c.best}`);
      }
      check('壊れた値・0（abc・負・小数・空・NaN・Infinity・1e400・{}・2^53）はぜんぶ「まだ記録なし」でメニューが落ちない', bad.length === 0, bad);
      await seed(page, { 'irobin.best': MAX16 });
      await page.goto(BASE); await wait(page, 150);
      const cm = await page.evaluate(() => { const a = document.querySelector('a.game[href="games/irobin/"]'); const r = a.getBoundingClientRect(); return { right: r.right, iw: innerWidth, hs: document.documentElement.scrollWidth > innerWidth, best: a.querySelector('.best b').textContent }; });
      check(`16 桁の記録（${cm.best}）でもカードが画面からはみ出さない`, cm.right <= cm.iw + 0.5 && !cm.hs, cm);
      check('メニューのいろびんのカードを押すとゲームが開く', await (async () => { await page.click('a.game[href="games/irobin/"]'); await page.waitForURL('**/games/irobin/', { timeout: 5000 }).catch(() => {}); return page.url() === IR; })(), page.url());
      await ctx.close();
    },
  },
  {
    id: 'BW16', tier: 'full', title: 'いろびん 伝わる：手はあるがもう解けない局面で doomed・ヒントに「1手もどす」・目印、戻すと消える／届けの連鎖（6 本以上。20 面から探す）が 4.5 秒以内に終わる・途中でお客さんを押すと飛ばせる／クリアのカードに めやす と ★／SE 縦で遊び方の閉じるボタンがスクロールなしで見える',
    async run({ browser, check }) {
      // 1. 詰み予備軍：6 面を決まった乱数で進め、ソルバーが「解けない」と言い切れる局面を探す
      const { ctx, page } = await openG(browser, 'BW16', { extra: { 'irobin.best': '5' } });
      await page.evaluate(() => window.IrobinGame.setLevel(6)); await wait(page, 100);
      const path6 = await page.evaluate(() => {
        const L = window.IrobinLogic;
        for (let sd = 1; sd <= 50; sd++) {
          let st = L.createLevel(6).state; const mv = []; let seed = sd;
          const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
          for (let k = 0; k < 40; k++) {
            const ms = L.legalMoves(st); if (!ms.length || st.won) break;
            const m = ms[Math.floor(rnd() * ms.length)]; st = L.applyMove(st, m[0], m[1]).state; mv.push([m[0], m[1]]);
            if (st.won) break;
            const r = L.solve(st, { nodeLimit: 3000 });
            if (!L.isStuck(st) && !r.solved && !r.exhausted) return mv;
          }
        }
        return null;
      });
      check(`6 面で「手はあるが解けない」局面までの手が見つかる（${path6 ? path6.length : 'なし'} 手）`, Array.isArray(path6) && path6.length > 0, path6);
      if (path6) {
        await playMoves(page, path6); await wait(page, 100);
        const s1 = await gs(page), h1 = await hintText(page);
        const a1 = await page.evaluate(() => [document.querySelector('#undoBtn').dataset.attention, document.querySelector('#restartBtn').dataset.attention]);
        check(`doomed true・stuck false・phase idle（${s1.doomed}・${s1.stuck}・${s1.phase}）、ヒントが「1手もどす」を案内（${h1}）、お助けに data-attention="1"（${a1}）`, s1.doomed === true && s1.stuck === false && s1.phase === 'idle' && /1手もどす/.test(h1 || '') && a1[0] === '1' && a1[1] === '1', { s1, h1, a1 });
        let s2 = s1;
        for (let i = 0; i < path6.length && s2.doomed; i++) { await page.click('#undoBtn', { force: true }); await wait(page, 60); s2 = await gs(page); }
        const a2 = await page.evaluate(() => [document.querySelector('#undoBtn').dataset.attention, document.querySelector('#restartBtn').dataset.attention]);
        const solvable = await page.evaluate(() => !!window.IrobinGame.solution());
        check(`戻して解ける局面になると doomed false・目印が消える（moves ${s2.moves}・${a2}）`, s2.doomed === false && solvable && !a2.includes('1'), { s2: s2.moves, a2 });
        // 選んでやめても、ヒントは「解けない」案内のまま戻る（ふつうのヒントで上書きしない）
        await playMoves(page, path6.slice(s2.moves)); await wait(page, 60);
        const sol0 = (await gs(page)).bottles.findIndex((b) => b.cells.length && !b.sealed);
        await page.evaluate((i) => { window.IrobinGame.pick(i); window.IrobinGame.pick(i); }, sol0); await wait(page, 60);
        check(`選んでやめた後もヒントは「1手もどす」（${await hintText(page)}）`, /1手もどす/.test((await hintText(page)) || '') && (await gs(page)).doomed === true, await gs(page));
      }
      await ctx.close();
      // 2. 届けの連鎖：待っていた瓶が 6 本以上続けて届く手を、20 面から順に探す（布の追加で 20 面の連鎖は 3 本になったため。
      //    いまは 45 面の 38 手目で 6 本）。注ぐ〜届け終わりまで実時間で 4.5 秒以内
      const c2 = await openG(browser, 'BW16 連鎖', { opts: { clock: false }, extra: { 'irobin.best': '19' } });
      const info = await c2.page.evaluate(() => {
        const L = window.IrobinLogic;
        for (let lv = 20; lv <= 120; lv++) {
          const c = L.createLevel(lv); let st = c.state; let at = -1, n = 0;
          c.info.solution.forEach((m, i) => { const r = L.applyMove(st, m[0], m[1]); if (r.outcome.deliveries.length > n) { n = r.outcome.deliveries.length; at = i; } st = r.state; });
          if (n >= 6) return { lv, sol: c.info.solution, at, n };
        }
        return { lv: 0, sol: [], at: -1, n: 0 };
      });
      check(`待っていた瓶が 6 本以上続けて届く手がある（${info.lv} 面 ${info.at + 1} 手目・${info.n} 本）`, info.n >= 6, { lv: info.lv, n: info.n });
      await c2.page.evaluate((lv) => window.IrobinGame.setLevel(lv), info.lv || 20); await sleep(100);
      await playMoves(c2.page, info.sol.slice(0, info.at));
      const ms = await c2.page.evaluate(([f, t]) => new Promise((ok) => {
        const g = window.IrobinGame, a = performance.now();
        g.pick(f); g.pick(t);
        const tick = () => { const s = g.getState(); if (!s.busy && s.phase !== 'pouring') ok(performance.now() - a); else if (performance.now() - a > 12000) ok(99999); else requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }), info.sol[info.at]);
      check(`連鎖 ${info.n} 本：注ぐ（約 0.9 秒）・そろう（約 0.8 秒）・届け全体（約 2.4 秒）が 4.5 秒以内に終わる（${Math.round(ms)}ms。直す前は約 10.7 秒）`, info.n >= 6 && ms < 4500, { ms, n: info.n });
      // 演出の途中でお客さんを押すと飛ばせる
      await c2.ctx.close();
      const c3 = await openG(browser, 'BW16 飛ばす', { extra: { 'irobin.best': '19' } });
      await c3.page.evaluate((lv) => window.IrobinGame.setLevel(lv), info.lv || 20); await wait(c3.page, 100);
      await playMoves(c3.page, info.sol.slice(0, info.at));
      await c3.page.evaluate(([f, t]) => { window.IrobinGame.pick(f); window.IrobinGame.pick(t); }, info.sol[info.at]);
      await wait(c3.page, 1500);
      const b0 = (await gs(c3.page)).busy;
      await c3.page.dispatchEvent('#shop', 'pointerdown');
      const b1 = await gs(c3.page);
      check(`連鎖の途中（busy ${b0}）でお客さんを押すと演出が飛んで idle（busy ${b1.busy}・${b1.phase}）`, b0 === true && b1.busy === false && b1.phase !== 'pouring', b1);
      // 3. クリアのカード：めやす と ★
      await c3.page.evaluate(() => window.IrobinGame.setLevel(1)); await wait(c3.page, 100);
      const par = (await gs(c3.page)).par;
      const { s } = await solveToClear(c3.page);
      const ov = await overlayInfo(c3.page);
      check(`クリアのカードに「めやす ${par}かい」と ★（${ov.text}）`, s.overlay === 'clear' && par > 0 && ov.text.includes(`めやす ${par}かい`) && /★/.test(ov.text), ov.text);
      await c3.ctx.close();
      // 4. SE 縦：初回の遊び方カードの「わかった」が、スクロールしなくても画面の中に見えて押せる
      for (const o of ['p', 'l']) {
        const c4 = await openG(browser, `BW16 SE ${o}`, { v: view('SE', o, 'app'), help: false });
        const vis = await c4.page.evaluate(() => {
          const ov = document.querySelector('#overlay'); ov.scrollTop = 0;
          const b = ov.querySelector('[data-cmd="close"]'); const r = b.getBoundingClientRect();
          const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), ih: innerHeight, hit: !!t && (t === b || b.contains(t)), items: ov.querySelectorAll('ol.rules li').length };
        });
        check(`SE ${o === 'p' ? '縦' : '横'}：遊び方は ${vis.items} 項目（3 以下）、「わかった」がスクロールなしで見えて押せる（${vis.top}〜${vis.bottom} / ${vis.ih}）`, vis.items <= 3 && vis.hit && vis.bottom <= vis.ih, vis);
        await c4.ctx.close();
      }
    },
  },
  {
    id: 'BW17', tier: 'smoke', title: 'いろびん 届けた瓶の跡は空いたまま（§17.7）：届けると瓶が1本減り空き瓶は増えない・残りの瓶は動かない（寄せる動きなし、位置が同じ）・跡は空いた置き場所で押しても何もしない・data-index は state の位置／data-id は id／aria-label と数字キーは置き場所の番号（id+1）で固定・空いた場所の数字キーは何もしない・矢印は跡を飛ばす・演出中に押した瓶が正しい瓶を選ぶ・再読み込みで同じ局面（v:3）',
    async run({ browser, check }) {
      // 届けが起き、その後ろ（置き場所の番号が大きい側）に「選べる瓶」が残る手を探す。前の作りなら、その瓶は1つ前へ寄っていた
      const findCase = (p) => p.evaluate(() => {
        const L = window.IrobinLogic;
        let first = null;   // 跡の左にも瓶がある手（矢印キーで跡を飛ばすのを見られる）を優先する
        for (let lv = 2; lv <= 12; lv++) {
          const c = L.createLevel(lv); let st = c.state;
          for (let i = 0; i < c.info.solution.length; i++) {
            const [f, t] = c.info.solution[i];
            const r = L.applyMove(st, f, t);
            const d = r.outcome.deliveries;
            if (d.length === 1 && !r.state.won && d[0].id <= 9) {
              const after = r.state.bottles;
              const k = after.findIndex((b) => b.id > d[0].id && b.id <= 9 && b.cells.length > 0 && !b.sealed && b.cover === null);
              const prev = after.filter((b) => b.id < d[0].id).map((b) => b.id).pop();
              const cand = k >= 0 ? { lv, at: i, sol: c.info.solution, move: [f, t], gone: d[0], pickId: after[k].id, pickNew: k, pickOld: st.bottles.findIndex((b) => b.id === after[k].id), prevId: prev === undefined ? null : prev, nextId: after.filter((b) => b.id > d[0].id).map((b) => b.id)[0], nBefore: st.bottles.length, emptyBefore: st.bottles.filter((b) => !b.cells.length).length, emptyAfter: after.filter((b) => !b.cells.length).length } : null;
              if (cand && cand.prevId !== null) return cand;
              if (cand && !first) first = cand;
            }
            st = r.state;
          }
        }
        return first;
      });
      // #board の子を置き場所の順に：瓶（.bottle）か、空いた置き場所（.place-empty）か、と位置
      const domInfo = (p) => p.evaluate(() => [...document.querySelectorAll('#board > .bottle, #board > .place-empty')].map((b) => {
        const r = b.getBoundingClientRect();
        return { kind: b.classList.contains('bottle') ? 'bottle' : 'empty', index: b.dataset.index, id: b.dataset.id ?? b.dataset.place, gone: b.dataset.gone || '', n: b.querySelectorAll('.seg').length, label: b.getAttribute('aria-label') || '', tf: b.style.transform || '', x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), pe: getComputedStyle(b).pointerEvents, btn: !!b.querySelector('button') };
      }));
      const bottlesOf = (d) => d.filter((x) => x.kind === 'bottle' && !x.gone);
      const posById = (d) => Object.fromEntries(d.map((x) => [x.id, [x.x, x.y, x.w, x.h]]));
      const same = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) <= 1);
      const { ctx, page } = await openG(browser, 'BW17', { v: SMOKE_V(), extra: { 'irobin.best': '1' } });
      const cs = await findCase(page);
      check(`届けが起きて、その後ろに選べる瓶が残る手が見つかる（${cs ? `${cs.lv} 面 ${cs.at + 1} 手目・届ける瓶 id ${cs.gone.id}` : 'なし'}）`, !!cs, cs);
      if (!cs) { await ctx.close(); return; }
      await page.evaluate((lv) => window.IrobinGame.setLevel(lv), cs.lv); await wait(page, 100);
      await playMoves(page, cs.sol.slice(0, cs.at));
      const s0 = await gs(page), d0 = await domInfo(page);
      const pos0 = posById(d0);
      check(`届ける前：画面の瓶 ${bottlesOf(d0).length} 本＝state ${s0.bottles.length} 本`, bottlesOf(d0).length === s0.bottles.length && s0.bottles.length === cs.nBefore, { d0: bottlesOf(d0).length, s0: s0.bottles.length });
      // 届ける手を演出つきで（skip しない）。瓶が飛んでいる間・消えた直後を少しずつ見る
      await page.evaluate(([f, t]) => { window.IrobinGame.pick(f); window.IrobinGame.pick(t); }, cs.move);
      const samples = [];
      for (let i = 0; i < 90; i++) {
        await wait(page, 40);
        const st = await gs(page), d = await domInfo(page);
        const live = bottlesOf(d);
        samples.push({ busy: st.busy, n: live.length, all: d.length, emptyAt: d.findIndex((x) => x.kind === 'empty'), moving: live.some((x) => /translate\(/.test(x.tf) && x.id !== String(cs.move.map((m) => s0.bottles[m].id)[0])), off: live.filter((x) => x.id !== String(s0.bottles[cs.move[0]].id) && !same(pos0[x.id], [x.x, x.y, x.w, x.h])).map((x) => x.id) });
        if (!st.busy) break;
      }
      const s1 = await gs(page), d1 = await domInfo(page);
      const shrinkAt = samples.findIndex((x) => x.n === cs.nBefore - 1 && x.emptyAt >= 0);
      const after = shrinkAt >= 0 ? samples.slice(shrinkAt) : [];
      check(`届けると画面の瓶が 1 本減る（${cs.nBefore} → ${bottlesOf(d1).length}）・state も同じ・空き瓶は増えない（${cs.emptyBefore} → ${s1.bottles.filter((b) => !b.cells.length).length}。注いだ分だけ）`,
        bottlesOf(d1).length === cs.nBefore - 1 && s1.bottles.length === cs.nBefore - 1 && s1.bottles.filter((b) => !b.cells.length).length === cs.emptyAfter && !d1.some((x) => x.gone), { d1: bottlesOf(d1).length, s1: s1.bottles.length });
      check(`瓶が消えたあと、残りの瓶は寄らない（${shrinkAt >= 0 ? `${shrinkAt * 40}ms で消えた` : '消えていない'}。演出中も translate のずらしが付かず、どの瓶も届ける前と同じ位置）`,
        shrinkAt >= 0 && after.every((x) => !x.moving && x.off.length === 0) && bottlesOf(d1).every((x) => !x.tf && same(pos0[x.id], [x.x, x.y, x.w, x.h])), { shrinkAt, samples: samples.slice(Math.max(0, shrinkAt - 1), shrinkAt + 4), d1: d1.map((x) => [x.id, x.x, x.y]) });
      const holes0 = d0.filter((x) => x.kind === 'empty').length;   // それより前に届けた瓶の跡
      const hole = d1.find((x) => x.kind === 'empty' && x.id === String(cs.gone.id));
      check(`届けた瓶（id ${cs.gone.id}）の跡は空いた置き場所のまま（同じ位置・同じ大きさ、押せない・中にボタンなし）、置き場所の数は ${d0.length} のまま、跡は ${holes0} → ${holes0 + 1} か所`,
        d1.length === d0.length && !!hole && same(pos0[String(cs.gone.id)], [hole.x, hole.y, hole.w, hole.h]) && hole.pe === 'none' && !hole.btn && d1.filter((x) => x.kind === 'empty').length === holes0 + 1, { hole, was: pos0[String(cs.gone.id)], holes0 });
      const live1 = bottlesOf(d1);
      check('data-index は今の state の位置（0〜）、data-id は state の id、aria-label の番号は置き場所の番号（id+1）で届けても変わらない',
        live1.every((x, i) => x.index === String(i) && x.id === String(s1.bottles[i].id) && x.label.startsWith(`${s1.bottles[i].id + 1}ばん`) && x.n === (s1.bottles[i].cover === null ? s1.bottles[i].cells.length : 0)), live1.map((x) => [x.index, x.id, x.label.slice(0, 4)]));
      check(`届けた瓶（id ${cs.gone.id}）は瓶としては画面にも state にも無い`, !live1.some((x) => x.id === String(cs.gone.id)) && !s1.bottles.some((b) => b.id === cs.gone.id), null);
      // 空いた場所を押しても何も起きない
      const holeHit = await page.evaluate((id) => { const e = document.querySelector(`#board .place-empty[data-place="${id}"]`); if (!e) return null; const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { x: r.left + r.width / 2, y: r.top + r.height / 2, onBottle: !!(t && t.closest && t.closest('.bottle')) }; }, cs.gone.id);
      if (holeHit) { await page.mouse.click(holeHit.x, holeHit.y); await wait(page, 60); }
      const h1 = await gs(page);
      check(`空いた置き場所を押しても何も選ばれない（selected ${h1.selected}・phase ${h1.phase}・手 ${h1.moves}）`, !!holeHit && !holeHit.onBottle && h1.selected === null && h1.phase === 'idle' && h1.moves === s1.moves, { holeHit, sel: h1.selected });
      // 数字キー：置き場所の番号（id+1）で数える。空いた場所の番号は何もしない
      const keyOf = (id) => (id + 1 === 10 ? '0' : String(id + 1));
      await page.keyboard.press(keyOf(cs.gone.id)); await wait(page, 60);
      const k0 = await gs(page);
      check(`空いた場所の数字キー ${keyOf(cs.gone.id)} は何もしない（selected ${k0.selected}）`, k0.selected === null && k0.phase === 'idle', k0.selected);
      await page.keyboard.press(keyOf(cs.pickId)); await wait(page, 60);
      const k1 = await gs(page);
      check(`数字キー ${keyOf(cs.pickId)} で、置き場所 ${cs.pickId + 1} の瓶（id ${cs.pickId}・今の位置 ${cs.pickNew}）を選ぶ（selected ${k1.selected}）`, k1.selected === cs.pickNew && k1.bottles[k1.selected] && k1.bottles[k1.selected].id === cs.pickId, k1.selected);
      await page.keyboard.press('Escape'); await wait(page, 60);
      // 矢印キー：空いた場所を飛ばして次の瓶へ
      if (cs.prevId !== null && cs.nextId !== undefined) {
        await page.focus(`#board .bottle[data-id="${cs.prevId}"]`);
        await page.keyboard.press('ArrowRight'); await wait(page, 30);
        const fid = await page.evaluate(() => document.activeElement?.dataset?.id ?? null);
        check(`矢印 → で、空いた場所（${cs.gone.id + 1}）を飛ばして id ${cs.prevId} から id ${cs.nextId} の瓶へ（${fid}）`, fid === String(cs.nextId), fid);
      }
      // 再読み込みで同じ局面（保存は v:3・瓶の id の手）。空いた場所も同じ
      const save = JSON.parse((await stored(page, 'irobin.save')) || '{}');
      await page.reload(); await wait(page, 300);
      const s2 = await gs(page), d2 = await domInfo(page);
      check(`再読み込みで同じ局面（保存 v:${save.v}・手 ${save.moves && save.moves.length}。瓶 ${s2.bottles.length} 本・id も同じ、跡の場所も同じ）`,
        save.v === 3 && J(s2.bottles) === J(s1.bottles) && s2.moves === s1.moves && J(s2.slots) === J(s1.slots) && J(d2.map((x) => [x.kind, x.id])) === J(d1.map((x) => [x.kind, x.id])), { a: d1.map((x) => [x.kind, x.id]), b: d2.map((x) => [x.kind, x.id]) });
      // 届けの演出中に、後ろの瓶を押す（ボタンの data-index は届ける前の並びのまま）→ 演出を終わらせた後の並びで同じ瓶（id）を選ぶ
      await page.evaluate((lv) => window.IrobinGame.setLevel(lv), cs.lv); await wait(page, 100);
      await playMoves(page, cs.sol.slice(0, cs.at));
      await page.evaluate(([f, t]) => { window.IrobinGame.pick(f); window.IrobinGame.pick(t); }, cs.move);
      await wait(page, 300);
      const mid = await page.evaluate((id) => { const b = document.querySelector(`#board .bottle[data-id="${id}"]`); const r = { busy: window.IrobinGame.getState().busy, index: b && b.dataset.index }; if (b) b.click(); return r; }, cs.pickId);
      await wait(page, 60);
      const p1 = await gs(page);
      check(`演出中（busy ${mid.busy}）に id ${cs.pickId} の瓶（押したときの data-index ${mid.index}）を押すと、届けた後の位置 ${cs.pickNew} の同じ瓶が選ばれる（selected ${p1.selected}）`,
        mid.busy === true && mid.index === String(cs.pickOld) && p1.selected === cs.pickNew && p1.bottles[cs.pickNew].id === cs.pickId && p1.phase === 'selected', { mid, sel: p1.selected });
      await ctx.close();
      // 動きを減らす設定：寄る動きは無く、注ぐ〜届けるまで 0.5 秒以内
      const c2 = await openG(browser, 'BW17 calm', { v: SMOKE_V(), opts: { clock: false, reducedMotion: 'reduce' }, extra: { 'irobin.best': '1' } });
      await c2.page.evaluate((lv) => window.IrobinGame.setLevel(lv), cs.lv); await sleep(100);
      await playMoves(c2.page, cs.sol.slice(0, cs.at));
      const r = await c2.page.evaluate(([f, t]) => new Promise((ok) => {
        const g = window.IrobinGame, a = performance.now(); let moved = false;
        g.pick(f); g.pick(t);
        const tick = () => {
          const bs = [...document.querySelectorAll('#board .bottle')];
          if (bs.some((b) => /translate\(/.test(b.style.transform))) moved = true;
          const s = g.getState();
          const holes = document.querySelectorAll('#board .place-empty').length;
          if (!s.busy && s.phase !== 'pouring') ok({ ms: performance.now() - a, n: bs.length, holes, moved }); else if (performance.now() - a > 4000) ok({ ms: 9999, n: bs.length, holes, moved }); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }), cs.move);
      check(`動きを減らす設定：届けて瓶が ${cs.nBefore} → ${r.n} 本・跡 ${holes0} → ${r.holes} か所、寄る動きなし（${r.moved}）、${Math.round(r.ms)}ms で終わる（500ms 未満）`, r.n === cs.nBefore - 1 && r.holes === holes0 + 1 && !r.moved && r.ms < 500, r);
      await c2.ctx.close();
    },
  },
  {
    id: 'BW18', tier: 'smoke', title: 'いろびん 布の瓶（§17.4）：布の瓶の見た目と札（data-covered・data-cover-left・aria-label）、押すと選べず（選んでいた瓶はそのまま）ヒントと deny、はじめての布のヒントと irobin.cloth、届けて布が取れる（札が消え中身が描かれる・音 unveil・空き瓶なら「あきびんが でてきた！」）、動きを減らす設定で 0.5 秒以内、再読み込みで同じ局面',
    async run({ browser, check }) {
      // 空き瓶の布が、届け 1 本の手で取れる面を 8 面から探す（取れる手の番号も）
      const findCloth = (p) => p.evaluate(() => {
        const L = window.IrobinLogic;
        for (let lv = 8; lv <= 40; lv++) {
          const c = L.createLevel(lv); let st = c.state;
          const cl = st.bottles.find((b) => b.cover !== null);
          if (!cl || cl.cells.length !== 0 || cl.id > 8) continue;
          for (let i = 0; i < c.info.solution.length; i++) {
            const r = L.applyMove(st, c.info.solution[i][0], c.info.solution[i][1]);
            if (r.outcome.unveiled.length && r.outcome.deliveries.length > 1) break;   // 連鎖の演出の時間が混ざらない面（届け 1 本で取れる）を選ぶ
            if (r.outcome.unveiled.length) return { lv, at: i, sol: c.info.solution, cid: cl.id, cover: cl.cover, servedBefore: st.served };
            st = r.state;
          }
        }
        return null;
      });
      const clothDom = (p) => p.evaluate(() => [...document.querySelectorAll('#board .bottle')].map((b) => {
        const tag = b.querySelector('.clothtag');
        const cs = tag ? getComputedStyle(tag) : null;
        const small = tag ? [...tag.querySelectorAll('*')].map((e) => parseFloat(getComputedStyle(e).fontSize)) : [];
        return { id: b.dataset.id, covered: b.dataset.covered || '', left: b.dataset.coverLeft ?? null, label: b.getAttribute('aria-label') || '', segs: b.querySelectorAll('.seg').length, tag: tag ? tag.textContent.replace(/\s+/g, '') : '', tagShown: !!cs && cs.display !== 'none' && cs.visibility !== 'hidden' && tag.getBoundingClientRect().height > 0, minFont: small.length ? Math.min(...small) : 0 };
      }));
      const { ctx, page } = await openG(browser, 'BW18', { v: SMOKE_V(), opts: { initScript: SFX_SPY }, extra: { 'irobin.best': '1' } });
      const cs = await findCloth(page);
      check(`空き瓶の布が途中で取れる面がある（${cs ? `${cs.lv} 面・布の瓶 id ${cs.cid}・cover ${cs.cover}・${cs.at + 1} 手目で取れる` : 'なし'}）`, !!cs, cs);
      if (!cs) { await ctx.close(); return; }
      // はじめて布が出た面：irobin.cloth が無い状態で、その面から始める（best＝面−1）
      await gotoG(page, { 'irobin.best': String(cs.lv - 1) });
      const s0 = await gs(page), h0 = await hintText(page);
      const flag = await stored(page, 'irobin.cloth');
      const tip = await page.evaluate(() => document.querySelector('#board')?.dataset.clothTip);
      check(`はじめての布の面（${s0.level} 面）：ヒントが布の説明（${h0}）、#board[data-cloth-tip="1"]（${tip}）、irobin.cloth が "1"（${flag}）`,
        s0.level === cs.lv && /ぬのの びん/.test(h0 || '') && /どの いろから/.test(h0 || '') && tip === '1' && flag === '1', { h0, tip, flag });
      // 見た目と札
      const d0 = await clothDom(page);
      const cov = s0.bottles.filter((b) => b.cover !== null);
      const dc = d0.filter((x) => x.covered === '1');
      const want = (b) => String(b.cover - s0.served);
      const tagBad = cov.filter((b) => { const x = d0.find((y) => y.id === String(b.id)); return !x || x.covered !== '1' || x.left !== want(b) || x.segs !== 0 || !x.tagShown || !x.tag.includes(want(b)) || x.minFont < 12 || !x.label.startsWith(`${b.id + 1}ばん`) || !/ぬのを かぶった/.test(x.label) || !x.label.includes(`あと ${want(b)} にん`); });
      check(`布の瓶 ${cov.length} 本：data-covered="1"・data-cover-left＝cover−届けた数・札「あと N」（12px 以上）・中身の段は描かない・aria-label「Nばん。ぬのを かぶった びん。あと M にん…」`, cov.length > 0 && dc.length === cov.length && tagBad.length === 0, { dc, cov: cov.map((b) => [b.id, b.cover]) });
      check('布の無い瓶には data-covered="1" が無い', d0.filter((x) => !cov.some((b) => String(b.id) === x.id)).every((x) => x.covered !== '1' && x.left === null), null);
      // 押しても選べない。選んでいた瓶はそのまま
      const ci = s0.bottles.findIndex((b) => b.id === cs.cid);
      await page.click(`#board .bottle[data-id="${cs.cid}"]`); await wait(page, 60);
      const s1 = await gs(page), h1 = await hintText(page), pl1 = (await plays(page)).map((x) => x.n);
      check(`布の瓶を押すと選べない（selected ${s1.selected}・phase ${s1.phase}）、ヒント「あと ${want(cov.find((b) => b.id === cs.cid))} にん とどけると あく」（${h1}）、deny の音`,
        s1.selected === null && s1.phase === 'idle' && new RegExp(`あと ${want(cov.find((b) => b.id === cs.cid))} にん`).test(h1 || '') && pl1.includes('deny'), { s1: s1.selected, h1, pl1: pl1.slice(-3) });
      const other = s0.bottles.findIndex((b) => b.cover === null && b.cells.length > 0 && !b.sealed);
      await page.evaluate((i) => window.IrobinGame.pick(i), other); await wait(page, 30);
      await page.evaluate((i) => window.IrobinGame.pick(i), ci); await wait(page, 60);
      const s2 = await gs(page);
      check(`瓶を選んでから布の瓶を押しても、選びは解除されず注げない（selected ${s2.selected}・手 ${s2.moves}）`, s2.selected === other && s2.moves === 0 && s2.phase === 'selected', s2);
      await page.keyboard.press('Escape'); await wait(page, 30);
      if (cs.cid <= 8) {
        await page.keyboard.press(String(cs.cid + 1)); await wait(page, 60);
        const k = await gs(page);
        check(`数字キー ${cs.cid + 1}（布の瓶の置き場所）でも選べない（selected ${k.selected}）`, k.selected === null, k.selected);
      }
      // 布が取れる手の直前まで進める（札の数は届けるたびに減る）
      await playMoves(page, cs.sol.slice(0, cs.at));
      const s3 = await gs(page), d3 = await clothDom(page);
      const x3 = d3.find((x) => x.id === String(cs.cid));
      check(`届けるたびに札が減る：届けた ${s3.served} 人で「あと ${cs.cover - s3.served}」（${x3 && x3.left}）`, !!x3 && x3.covered === '1' && x3.left === String(cs.cover - s3.served) && cs.cover - s3.served >= 1, x3);
      // 布が取れる手（演出つき）
      await page.evaluate(([f, t]) => { window.IrobinGame.pick(f); window.IrobinGame.pick(t); }, cs.sol[cs.at]);
      for (let i = 0; i < 120; i++) { await wait(page, 50); if (!(await gs(page)).busy) break; }
      const s4 = await gs(page), d4 = await clothDom(page), h4 = await hintText(page), pl4 = await plays(page);
      const b4 = s4.bottles.find((b) => b.id === cs.cid), x4 = d4.find((x) => x.id === String(cs.cid));
      check(`届けて布が取れる：state の cover null、画面の札が消え（data-covered ${x4 && x4.covered}・data-cover-left ${x4 && x4.left}）、中身（空き瓶）が描かれ、aria-label に「ぬの」が無い`,
        !!b4 && b4.cover === null && !!x4 && x4.covered !== '1' && x4.left === null && x4.segs === b4.cells.length && !x4.tagShown && !/ぬの/.test(x4.label) && x4.label.startsWith(`${cs.cid + 1}ばん`), { b4, x4 });
      check(`布が取れると音 unveil（表にある音）、空き瓶なら「あきびんが でてきた！」（${h4}）`, pl4.some((x) => x.n === 'unveil' && x.known) && /あきびんが でてきた/.test(h4 || ''), { h4, tail: pl4.slice(-6).map((x) => x.n) });
      // 布が取れた空き瓶へ注げる
      const s4i = s4.bottles.findIndex((b) => b.id === cs.cid);
      const canPour = await page.evaluate((to) => { const L = window.IrobinLogic, g = window.IrobinGame.getState(); return g.bottles.some((b, i) => i !== to && L.pourCheck({ ...g, won: false }, i, to).ok); }, s4i);
      check('布が取れた空き瓶は注ぐ相手になる', canPour, null);
      // 再読み込みで同じ局面（布の状態も）
      const save = JSON.parse((await stored(page, 'irobin.save')) || '{}');
      await page.reload(); await wait(page, 300);
      const s5 = await gs(page), d5 = await clothDom(page);
      check(`再読み込みで同じ局面（v:${save.v}・手 ${s5.moves}・布の状態も同じ）`, save.v === 3 && J(s5.bottles) === J(s4.bottles) && s5.served === s4.served && J(d5.map((x) => [x.id, x.covered === '1', x.left])) === J(d4.map((x) => [x.id, x.covered === '1', x.left])), { a: s4.bottles.map((b) => b.cover), b: s5.bottles.map((b) => b.cover) });
      // 2 回目からは布の説明を出さない（irobin.cloth が "1"）
      await page.evaluate(() => window.IrobinGame.setLevel(window.IrobinGame.getState().level + 1)); await wait(page, 100);
      const h6 = await hintText(page), tip6 = await page.evaluate(() => document.querySelector('#board')?.dataset.clothTip);
      check(`irobin.cloth が "1" なら、次の布の面ではふつうのヒント（${h6}・tip ${tip6}）`, !/どの いろから/.test(h6 || '') && tip6 !== '1', { h6, tip6 });
      await ctx.close();
      // 動きを減らす設定：布が取れる手（届け→布）が 0.5 秒以内に終わる
      const c2 = await openG(browser, 'BW18 calm', { v: SMOKE_V(), opts: { clock: false, reducedMotion: 'reduce' }, extra: { 'irobin.best': String(cs.lv - 1), 'irobin.cloth': '1' } });
      await playMoves(c2.page, cs.sol.slice(0, cs.at));
      const r = await c2.page.evaluate(([f, t, id]) => new Promise((ok) => {
        const g = window.IrobinGame, a = performance.now();
        g.pick(f); g.pick(t);
        const tick = () => {
          const b = document.querySelector(`#board .bottle[data-id="${id}"]`);
          const s = g.getState();
          if (!s.busy && s.phase !== 'pouring') ok({ ms: performance.now() - a, covered: b ? b.dataset.covered || '' : 'none', cover: (s.bottles.find((x) => x.id === id) || {}).cover }); else if (performance.now() - a > 4000) ok({ ms: 9999 }); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }), [...cs.sol[cs.at], cs.cid]);
      check(`動きを減らす設定：届けて布が取れるまで ${Math.round(r.ms)}ms（500ms 未満）、札が消える`, r.ms < 500 && r.covered !== '1' && r.cover === null, r);
      await c2.ctx.close();
    },
  },
];
