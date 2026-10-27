// BW: いろびんの画面（games/irobin/）。契約は docs/irobin-contract.md（§6 DOM・§8 進行・§12.3 テスト）。
//   画面の DOM は契約だけに頼る：a#back・#helpBtn・#soundBtn・#playView[data-phase]・#level・#left・#board .bottle .seg .mark・#cust0/#cust1・
//     #hint・#undoBtn・#restartBtn・#overlay・#card・.overlay [data-cmd=next/menu/close/restartYes]
//   テスト用の公開 API（契約 §8.6）：window.IrobinGame = { getState, pick, pour, solution, skip, setLevel, setState }
//   計算ロジックは BL（irobin-logic.mjs）で確かめ済み。ここでは画面の中の IrobinLogic を「期待値の計算機」として使う。
//   無いときに合格にしない（空振りの合格を作らない）：IrobinGame が無ければ例外で不合格にする。
//   smoke：BW1〜BW4・BW17・BW18（布の瓶）。full：BW5〜BW16・BW19〜BW23（BW14 は CDP のタッチ操作なので Chromium だけ、BW10 は AudioContext が要る）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BASE, view, custom, newPage, seed, wait, frozen, layoutProbe, swInfo, sleep, touch, SFX_SPY, plays, IS_CHROMIUM, x20Run, x20Text, x20Hidden } from '../lib.mjs';

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
      // クリアのカードが出てから「直後の next」を押すまでを frozen に入れる（ページの時間は wait の分だけ進む）。
      // 時計を止めないと、その間の evaluate（読む・保存を見る 6 回）の実時間の分だけページの時計も進み、重い WebKit で 400ms を越えて next が効いてしまった（v40 の関門。T-26 と同じ形）
      await frozen(page, async () => {
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
      });
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
      const w = await openG(browser, 'BW5 hint', { v, extra: { 'irobin.save': J({ v: 3, level: 4, moves: [] }) } });
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
      const rDis = await page.evaluate(() => document.querySelector('#restartBtn').disabled);
      await page.click('#restartBtn', { force: true }).catch(() => {}); await wait(page, 80);
      const noOv = await overlayInfo(page);
      check(`手が 0 のときの「やりなおし」は押せない見た目（disabled ${rDis}）で、押しても確認カードを出さない（IB-13）`, rDis === true && !noOv.shown, { rDis, noOv });
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
      // 詰むと「とける ところまで もどす」のカードが出る（IB-25）。「このまま つづける」で閉じてから、今までの確かめを続ける
      const r1 = await gs(page);
      check(`詰むと「とける ところまで もどす」のカードが出る（overlay ${r1.overlay}）`, r1.overlay === 'rescue', r1.overlay);
      await wait(page, 450); await clickCmd(page, 'close'); await wait(page, 100);
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
      // 1. 詰み予備軍：4 面を決まった乱数で進め、ソルバーが「解けない」と言い切れる局面を探す
      const { ctx, page } = await openG(browser, 'BW16', { extra: { 'irobin.best': '3' } });
      await page.evaluate(() => window.IrobinGame.setLevel(4)); await wait(page, 100);
      const path4 = await page.evaluate(() => {
        const L = window.IrobinLogic;
        for (let sd = 1; sd <= 50; sd++) {
          let st = L.createLevel(4).state; const mv = []; let seed = sd;
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
      check(`4 面で「手はあるが解けない」局面までの手が見つかる（${path4 ? path4.length : 'なし'} 手）`, Array.isArray(path4) && path4.length > 0, path4);
      if (path4) {
        await playMoves(page, path4); await wait(page, 100);
        // 予備軍になると「とける ところまで もどす」のカードが出る（IB-25）。「このまま つづける」で閉じてから確かめる
        const r1 = await gs(page);
        check(`予備軍になると「とける ところまで もどす」のカードが出る（overlay ${r1.overlay}）`, r1.overlay === 'rescue', r1.overlay);
        await wait(page, 450); await clickCmd(page, 'close'); await wait(page, 60);
        const s1 = await gs(page), h1 = await hintText(page);
        const a1 = await page.evaluate(() => [document.querySelector('#undoBtn').dataset.attention, document.querySelector('#restartBtn').dataset.attention]);
        check(`doomed true・stuck false・phase idle（${s1.doomed}・${s1.stuck}・${s1.phase}）、ヒントが「1手もどす」を案内（${h1}）、お助けに data-attention="1"（${a1}）`, s1.doomed === true && s1.stuck === false && s1.phase === 'idle' && /1手もどす/.test(h1 || '') && a1[0] === '1' && a1[1] === '1', { s1, h1, a1 });
        let s2 = s1;
        for (let i = 0; i < path4.length && s2.doomed; i++) { await page.click('#undoBtn', { force: true }); await wait(page, 60); s2 = await gs(page); }
        const a2 = await page.evaluate(() => [document.querySelector('#undoBtn').dataset.attention, document.querySelector('#restartBtn').dataset.attention]);
        const solvable = await page.evaluate(() => !!window.IrobinGame.solution());
        check(`戻して解ける局面になると doomed false・目印が消える（moves ${s2.moves}・${a2}）`, s2.doomed === false && solvable && !a2.includes('1'), { s2: s2.moves, a2 });
        // 選んでやめても、ヒントは「解けない」案内のまま戻る（ふつうのヒントで上書きしない）
        await playMoves(page, path4.slice(s2.moves)); await wait(page, 60);
        await wait(page, 450); await clickCmd(page, 'close'); await wait(page, 60);   // もう一度 予備軍になったときのカードを閉じる（IB-25）
        const sol0 = (await gs(page)).bottles.findIndex((b) => b.cells.length && !b.sealed);
        await page.evaluate((i) => { window.IrobinGame.pick(i); window.IrobinGame.pick(i); }, sol0); await wait(page, 60);
        check(`選んでやめた後もヒントは「1手もどす」（${await hintText(page)}）`, /1手もどす/.test((await hintText(page)) || '') && (await gs(page)).doomed === true, await gs(page));
      }
      await ctx.close();
      // 2. 届けの連鎖：待っていた瓶が 6 本以上続けて届く手を、20 面から順に探す（布の追加で 20 面の連鎖は 3 本になったため。
      //    いまは 45 面の 38 手目で 6 本）。注ぐ〜届け終わりまで実時間で 4.5 秒以内。
      //    布が同じ手で取れる手（布の演出が足される）は除く（§17.9 で 36 面の 6 本の連鎖に布の演出が付いたため）
      const c2 = await openG(browser, 'BW16 連鎖', { opts: { clock: false }, extra: { 'irobin.best': '19' } });
      const info = await c2.page.evaluate(() => {
        const L = window.IrobinLogic;
        for (let lv = 20; lv <= 120; lv++) {
          const c = L.createLevel(lv); let st = c.state; let at = -1, n = 0;
          c.info.solution.forEach((m, i) => { const r = L.applyMove(st, m[0], m[1]); if (r.outcome.deliveries.length > n && !r.outcome.unveiled.length) { n = r.outcome.deliveries.length; at = i; } st = r.state; });
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
        s0.level === cs.lv && /ぬのが とれる/.test(h0 || '') && (s0.level === 5) === /ぬのの びんは なかが みえない/.test(h0 || '') && tip === '1' && flag === '1', { h0, tip, flag });
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
      check(`irobin.cloth が "1" なら、次の布の面ではふつうのヒント（${h6}・tip ${tip6}）`, !/ぬのが とれる/.test(h6 || '') && tip6 !== '1', { h6, tip6 });
      await ctx.close();
      // 届けの連鎖の途中：札の数が 1 ずつ減り、残り 0 の「あと 0」は出ない（「あいた！」か、布が取れて札が無い）
      const findChain = (p) => p.evaluate(() => {
        const L = window.IrobinLogic;
        for (let lv = 8; lv <= 80; lv++) {
          const c = L.createLevel(lv); let st = c.state;
          for (let i = 0; i < c.info.solution.length; i++) {
            const r = L.applyMove(st, c.info.solution[i][0], c.info.solution[i][1]);
            const n = r.outcome.deliveries.length;
            const cl = st.bottles.find((b) => b.cover !== null && b.cover - st.served >= 2 && b.cover - st.served <= n);
            if (n >= 2 && cl) return { lv, at: i, sol: c.info.solution, cid: cl.id, left0: cl.cover - st.served };
            st = r.state;
          }
        }
        return null;
      });
      const c3 = await openG(browser, 'BW18 連鎖', { v: SMOKE_V(), opts: { clock: false }, extra: { 'irobin.best': '1', 'irobin.cloth': '1' } });
      const ch = await findChain(c3.page);
      check(`届けが 2 人以上続く手で布が 0 まで進む面がある（${ch ? `${ch.lv} 面・${ch.at + 1} 手目・布 id ${ch.cid}・残り ${ch.left0}` : 'なし'}）`, !!ch, ch);
      if (ch) {
        await gotoG(c3.page, { 'irobin.best': String(ch.lv - 1), 'irobin.cloth': '1' });
        await playMoves(c3.page, ch.sol.slice(0, ch.at));
        const seq = await c3.page.evaluate(([f, t, id]) => new Promise((ok) => {
          const g = window.IrobinGame, a = performance.now(), out = [];
          let last = null;
          const tick = () => {
            const b = document.querySelector(`#board .bottle[data-id="${id}"]`);
            const tg = b && b.querySelector('.clothtag');
            const cur = b ? `${b.dataset.covered || ''}|${b.dataset.coverLeft ?? ''}|${tg ? tg.textContent.replace(/\s+/g, '') : ''}` : 'none';
            if (cur !== last) { out.push(cur); last = cur; }
            if (!g.getState().busy && performance.now() - a > 300 && g.getState().phase !== 'pouring') ok(out); else if (performance.now() - a > 9000) ok(out); else requestAnimationFrame(tick);
          };
          g.pick(f); g.pick(t); requestAnimationFrame(tick);
        }), [...ch.sol[ch.at], ch.cid]);
        const lefts = seq.filter((x) => x.startsWith('1|')).map((x) => Number(x.split('|')[1]));
        const steps1 = lefts.every((v, i) => i === 0 || lefts[i - 1] - v === 1);
        const no0 = seq.every((x) => !/あと0/.test(x)) && seq.filter((x) => x.startsWith('1|0|')).every((x) => /あいた！/.test(x));
        check(`連鎖の途中で札が 1 ずつ減る（${lefts.join('→')}）、「あと 0」は出ず 0 のときは「あいた！」（${seq.join(' / ')}）、最後は札が無い`,
          lefts.length >= 2 && lefts[0] === ch.left0 && lefts[lefts.length - 1] === 0 && steps1 && no0 && !seq[seq.length - 1].startsWith('1|'), seq);
      }
      await c3.ctx.close();
      // 布の札を押すと札が一瞬ふくらむ（pop クラス）。動きを減らす設定でも pop は付き、動かさず色だけ変わる
      for (const calmOn of [false, true]) {
        const cp = await openG(browser, `BW18 pop ${calmOn}`, { v: SMOKE_V(), opts: calmOn ? { clock: false, reducedMotion: 'reduce' } : { clock: false }, extra: { 'irobin.best': String(cs.lv - 1), 'irobin.cloth': '1' } });
        await cp.page.click(`#board .bottle[data-id="${cs.cid}"]`); await wait(cp.page, 120);
        const pp = await cp.page.evaluate((id) => {
          const tg = document.querySelector(`#board .bottle[data-id="${id}"] .clothtag`); const cs2 = getComputedStyle(tg);
          return { pop: tg.classList.contains('pop'), anim: cs2.animationName, bg: cs2.backgroundColor };
        }, cs.cid);
        check(`布を押すと札が一瞬ふくらむ${calmOn ? '（動きを減らす設定：動かさず色だけ変える）' : ''}（pop ${pp.pop}・animation ${pp.anim}・背景 ${pp.bg}）`,
          pp.pop && (calmOn ? pp.anim === 'none' && pp.bg !== 'rgb(255, 250, 240)' : pp.anim === 'clothPop'), pp);
        await cp.ctx.close();
      }
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
  {
    id: 'BW19', tier: 'full', title: 'いろびん（ミチビキ空港 §19 A3 の横展開）：クリアのカードが出た直後に pagehide → pageshow しても、押せない見た目（aria-disabled）が外れて「つぎの めんへ」が押せる',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'BW19');
      const sol = await solutionOf(page);
      if (!sol) throw new Error('solution() が null');
      await playMoves(page, sol);
      let s = await gs(page);
      for (let i = 0; i < 80 && s.overlay !== 'clear'; i++) { await page.evaluate(() => window.IrobinGame.skip()); await wait(page, 20); s = await gs(page); }
      const r = await page.evaluate(() => {
        const locked = !!document.querySelector('#card .btns button[aria-disabled]');
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        return { locked };
      });
      await wait(page, 600);
      const after = await page.evaluate(() => [...document.querySelectorAll('#card .btns button')].map((b) => b.getAttribute('aria-disabled')));
      check(`クリアのカード（${s.overlay}）が出た直後（押せない見た目 ${r.locked}）に pagehide → pageshow しても、0.4 秒後にボタンの aria-disabled が外れる（${after.join(',')}）`, s.overlay === 'clear' && r.locked && after.length > 0 && after.every((x) => x === null), { r, after });
      await clickCmd(page, 'next'); await wait(page, 200);
      check('「つぎの めんへ」が押せる（面 2）', (await gs(page)).level === 2, (await gs(page)).level);
      await ctx.close();
    },
  },
  {
    id: 'BW20', tier: 'full', title: 'いろびん 古いページから書き戻さない（契約 §18・X-20）：bfcache から戻ったとき・裏にいる間に別のタブが irobin.save を書いたとき、古い面・手を書き戻さず開き直して今の保存から続ける。変わっていなければ開き直さない。storage イベントが届かないまま閉じても（裏にしたあとに書かれて pagehide・見えている間に書かれてそのまま hidden の保存）書き戻さず、表に戻ると開き直す',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'BW20');
      const mk = (lv) => page.evaluate((n) => window.IrobinLogic.makeSave(n, []), lv);
      const fp = (raw) => { try { const s = JSON.parse(raw); return `${s.level}:${(s.moves || []).length}`; } catch { return 'ERR'; } };
      const r = await x20Run(page, ctx, { key: 'irobin.save', newer: [await mk(7), await mk(12), await mk(15), await mk(18)], fp });
      check(`いろびん：${x20Text(r)}`, r.ok, r);
      await ctx.close();
    },
  },
  {
    id: 'BW21', tier: 'full', title: 'いろびん v35 の小さな直し（IB-30）：上の帯の面の番号が 4〜8 桁（9999・99999・999999・12345678）でも 1 段のまま（6〜8 桁は字を 12px に詰める）省略されず上の帯に収まり、ほかのボタンと重ならない（SE 縦横・13 縦・iPad 縦）',
    async run({ browser, check }) {
      const rows = [];
      for (const v of [view('SE', 'p', 'app'), view('SE', 'p', 'safari'), view('SE', 'l', 'app'), view('i13', 'p', 'app'), view('iPad', 'p', 'app')]) {
        let h4 = 0;
        for (const lv of ['9999', '99999', '999999', '12345678']) {
          const { ctx, page } = await openG(browser, `BW21 ${v.label} ${lv}`, { v, extra: { 'irobin.best': String(Number(lv) - 1) } });
          const r = await page.evaluate(() => {
            const e = document.querySelector('#level'), box = document.querySelector('#levelBox'), u = box.querySelector('.unit').getBoundingClientRect(), hd = document.querySelector('.head').getBoundingClientRect();
            const others = ['a#back', '#helpBtn', '#soundBtn', 'h1.title'].map((s) => document.querySelector(s)?.getBoundingClientRect()).filter(Boolean);
            const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
            const q = e.getBoundingClientRect();
            return { t: e.textContent, size: box.dataset.size, fit: e.scrollWidth <= e.clientWidth + 0.5, unitIn: u.right <= box.getBoundingClientRect().right + 0.5, inHead: q.left >= hd.left - 0.5 && u.right <= hd.right + 0.5,
              overlap: others.some((o) => hit(o, q) || hit(o, u)), px: parseFloat(getComputedStyle(e).fontSize), unitPx: parseFloat(getComputedStyle(box.querySelector('.unit')).fontSize),
              long: document.querySelector('.head').dataset.long, headH: Math.round(hd.height), hs: document.documentElement.scrollWidth > innerWidth };
          });
          if (lv === '9999') h4 = r.headH;
          rows.push({ v: v.label, lv, h4, ...r });
          await ctx.close();
        }
      }
      const bad = rows.filter((r) => r.t !== r.lv || !r.fit || !r.unitIn || !r.inHead || r.overlap || r.px < 12 || r.unitPx < 12 || r.hs || r.long !== '0' || r.headH !== r.h4);
      check(`面の番号 4〜8 桁が ${rows.length / 4} 画面で、1 段のまま（上の帯の高さが 4 桁と同じ）省略されず上の帯に収まり重ならない、字 12px 以上（SE 縦：${rows.filter((r) => r.v.startsWith('SE縦・ホーム')).map((r) => `${r.lv}→${r.size} ${r.px}px`).join('、')}）`, rows.length === 20 && bad.length === 0, bad);
    },
  },
  {
    id: 'BW22', tier: 'full', title: 'いろびん v36（IB-22）：最後の手まで保存されて閉じた面（クリアの記録の前）を開くと、その面のクリアのカードが出て、ベストと保存（次の面・手 0）が書かれ、「つぎの めんへ」で次の面',
    async run({ browser, check, root }) {
      const f = path.join(root, 'games/irobin/logic.js');
      const L = createRequire(f)(f);
      const raw = L.makeSave(3, L.createLevel(3).info.solutionIds.map((m) => [m[0], m[1]]));
      const { ctx, page } = await openG(browser, 'BW22', { extra: { 'irobin.best': '2', 'irobin.save': raw } });
      const s = await toClear(page);
      const ov = await overlayInfo(page);
      const best = await stored(page, 'irobin.best'), sv = JSON.parse((await stored(page, 'irobin.save')) || 'null');
      check(`開くと 3 面のクリアのカード（overlay ${s.overlay}・level ${s.level}・「${ov.text.slice(0, 16)}」）`, s.overlay === 'clear' && s.level === 3 && /3 めん クリア/.test(ov.text) && ov.cmds.includes('next'), { overlay: s.overlay, level: s.level, ov });
      check(`ベスト 3・保存は 4 面の手 0（best ${best}・save ${J(sv)}）`, best === '3' && !!sv && sv.level === 4 && Array.isArray(sv.moves) && sv.moves.length === 0, { best, sv });
      await wait(page, 500);
      await clickCmd(page, 'next'); await wait(page, 200);
      const s2 = await gs(page);
      check(`「つぎの めんへ」で 4 面（level ${s2.level}・moves ${s2.moves}・overlay ${s2.overlay}）`, s2.level === 4 && s2.moves === 0 && s2.overlay === null, s2);
      await ctx.close();
    },
  },
  {
    id: 'BW23', tier: 'full', title: 'いろびん v36 の小さな直し（IB-10・IB-17・IB-19・IB-21）：- キーで 11 本目を選べる、選んだときのヒントが「もういちど」、SE 横ホーム画面の遊び方カードがスクロールなしで全部見えクリアのカードも収まる、11 本の面（40 面）で記号が 12px 以上',
    async run({ browser, check }) {
      // ---- IB-10：11 本の局面。置き場所 11（- キー）に色、10（0 キー）は から ----
      const ELEVEN = { level: 40, bottles: [[0], [1], [2], [3], [4], [5], [6], [7], [8], [], [0]].map((c) => ({ cells: c, hidden: c.map(() => false), sealed: false })), slots: [null, null], queue: [1], served: 0, total: 1 };   // 届けるお客さんが 1 人いる（0 人だと最初から「クリア」の局面になる）
      const k = await openG(browser, 'BW23 キー', { opts: { touch: false } });
      const okSet = await k.page.evaluate((s) => window.IrobinGame.setState(s), ELEVEN);
      await k.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
      await k.page.keyboard.press('-'); await wait(k.page, 80);
      const k1 = await gs(k.page);
      await k.page.keyboard.press('0'); await wait(k.page, 80);
      await k.page.evaluate(() => window.IrobinGame.skip()); await wait(k.page, 80);
      const k2 = await gs(k.page);
      check(`11 本の局面で - キーは 11 本目を選び（selected ${k1.selected}）、0 キーの 10 本目（から）へ注げる（moves ${k2.moves}）`, okSet === true && k1.selected === 10 && k2.moves === 1 && k2.bottles[9].cells.length === 1 && k2.bottles[10].cells.length === 0, { okSet, sel: k1.selected, moves: k2.moves });
      // ---- IB-17：選んだときのヒント ----
      await k.page.evaluate(() => window.IrobinGame.pick(0)); await wait(k.page, 80);
      const h17 = await hintText(k.page);
      check(`瓶を選んだときのヒントがひらがな（${h17}）`, h17 === 'どの びんに そそぐ？（もういちど おすと やめる）', h17);
      await k.page.keyboard.press('Escape'); await wait(k.page, 80);
      await k.page.keyboard.press('Shift+/'); await wait(k.page, 100);
      const help = await overlayInfo(k.page);
      check('遊び方に「- は 11、= は 12ぽんめ」がある', help.shown && /- は 11、= は 12ぽんめ/.test(help.text), help.text);
      await k.ctx.close();
      // ---- IB-19：SE 横ホーム画面の遊び方とクリアのカード ----
      const v = view('SE', 'l', 'app');
      const h = await openG(browser, 'BW23 カード SE横', { v, help: false });
      const fitOf = (p) => p.evaluate(() => { const ov = document.querySelector('#overlay'), c = document.querySelector('#card'); return { sh: ov.scrollHeight, ch: ov.clientHeight, small: [...c.querySelectorAll('li, p, h2, button')].filter((e) => !e.closest('[hidden]') && parseFloat(getComputedStyle(e).fontSize) < 12).length }; });
      const f1 = await fitOf(h.page), o1 = await overlayProbe(h.page, v.safe);
      check(`${v.label}：遊び方カードがスクロールなしで全部見える（scrollHeight ${f1.sh}・高さ ${f1.ch}）、字 12px 以上、ボタン 44px 以上`, f1.sh <= f1.ch + 1 && f1.small === 0 && overlayOk(o1), { f1, o1 });
      await clickCmd(h.page, 'close'); await wait(h.page, 400);
      await solveToClear(h.page); await wait(h.page, 500);
      const f2 = await fitOf(h.page), o2 = await overlayProbe(h.page, v.safe);
      check(`${v.label}：クリアのカードもスクロールなしで収まる（${f2.sh}/${f2.ch}）`, f2.sh <= f2.ch + 1 && f2.small === 0 && overlayOk(o2), { f2, o2 });
      await h.ctx.close();
      // ---- IB-21：40 面（11 本）の記号の大きさ ----
      for (const vv of [view('SE', 'p', 'app'), view('SE', 'p', 'safari')]) {
        const g = await openG(browser, `BW23 記号 ${vv.label}`, { v: vv, extra: { 'irobin.best': '39' } });
        const m = await g.page.evaluate(() => {
          const segs = [...document.querySelectorAll('#board .seg')].filter((s) => s.querySelector('.mark'));
          const hs = segs.map((s) => s.querySelector('.mark').getBoundingClientRect().height);
          const out = segs.filter((s) => { const a = s.getBoundingClientRect(), b = s.querySelector('.mark').getBoundingClientRect(); return b.left < a.left - 0.5 || b.right > a.right + 0.5 || b.top < a.top - 0.5 || b.bottom > a.bottom + 0.5; }).length;
          return { n: document.querySelectorAll('#board .bottle').length, min: hs.length ? Math.min(...hs) : 0, out };
        });
        check(`${vv.label}・40 面（${m.n} 本）：記号がいちばん小さくても ${m.min.toFixed(1)}px（12px 以上）で、段からはみ出さない`, m.n === 11 && m.min >= 12 && m.out === 0, m);
        await g.ctx.close();
      }
    },
  },
  {
    id: 'BW24', tier: 'full', title: 'いろびん v36（IB-16）：待っているお客さんが数秒に 1 回まばたきする。止まっている間に描くのはまばたきの間だけ（10 秒でお客さんの描き直し 12 回以下・描くコマ 40 以下）。裏に回っている間と、動きを減らす設定ではまばたきしない',
    async run({ browser, check }) {
      const SPY = () => { window.__cr = { animal: 0, fx: 0 }; const o = CanvasRenderingContext2D.prototype.clearRect; CanvasRenderingContext2D.prototype.clearRect = function (...a) { const cl = this.canvas && this.canvas.classList; if (cl && cl.contains('animal')) window.__cr.animal++; else if (cl && cl.contains('fx')) window.__cr.fx++; return o.apply(this, a); }; };
      // ページの時計を止めて ms だけ進め、その間の描き直しとコマを数える
      const count = (page, ms) => frozen(page, async () => {
        await page.evaluate(() => { window.__cr.animal = 0; window.__cr.fx = 0; });
        await wait(page, ms);
        return page.evaluate(() => ({ ...window.__cr, waiting: document.querySelectorAll('.customer[data-mood="wait"]').length }));
      });
      const a = await openG(browser, 'BW24', { opts: { initScript: SPY } });
      await wait(a.page, 1000);
      const r1 = await count(a.page, 10000);
      check(`待っているお客さん ${r1.waiting} 人が 10 秒の間にまばたきする（お客さんの描き直し ${r1.animal} 回：2 回以上 12 回以下）`, r1.waiting >= 1 && r1.animal >= 2 && r1.animal <= 12, r1);
      check(`止まっている間に描くのはまばたきの間だけ（10 秒で描いたコマ ${r1.fx}：40 以下。描き続けると約 600）`, r1.fx <= 40, r1);
      await setHidden(a.page, true);
      const r2 = await count(a.page, 10000);
      check(`裏に回っている 10 秒はまばたきせず、描かない（描き直し ${r2.animal}・コマ ${r2.fx}）`, r2.animal === 0 && r2.fx === 0, r2);
      await setHidden(a.page, false);
      const r3 = await count(a.page, 6000);
      check(`表に戻ると、またまばたきする（6 秒で描き直し ${r3.animal} 回）`, r3.animal >= 2, r3);
      await a.ctx.close();
      const b = await openG(browser, 'BW24 動きを減らす', { opts: { initScript: SPY, reducedMotion: 'reduce' } });
      await wait(b.page, 1000);
      const r4 = await count(b.page, 10000);
      check(`動きを減らす設定ではまばたきしない（10 秒で描き直し ${r4.animal}・コマ ${r4.fx}）`, r4.animal === 0 && r4.fx <= 2, r4);
      await b.ctx.close();
    },
  },
  // ======================================================================
  // v37 の新しい仕掛け（IB-29・契約 §19.4）。ユーザーの答え：「全て採用です。徐々に難易度が上がるよう調整した上で採用します」
  {
    id: 'BW25', tier: 'full', title: 'いろびん v37 ちいさい びん（41 面）：短く描く（data-cap="3"・ガラスの高さはふつうの 0.70〜0.80 倍・段の高さは同じ）・aria-label「ちいさい びん（3つ まで）」・はじめての説明と irobin.small・3 段で満杯のときのヒントと deny・SE 縦で画面内 44px 以上・再読み込みで同じ局面',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'BW25', { v: SMOKE_V(), opts: { initScript: SFX_SPY }, extra: { 'irobin.best': '40', 'irobin.cloth': '1' } });
      const s0 = await gs(page), h0 = await hintText(page);
      const dom = () => page.evaluate(() => [...document.querySelectorAll('#board .bottle')].map((b) => {
        const r = b.getBoundingClientRect(), g = b.querySelector('.glass').getBoundingClientRect();
        return { id: b.dataset.id, cap: b.dataset.cap || '', label: b.getAttribute('aria-label') || '', w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right, gh: g.height, segs: [...b.querySelectorAll('.seg')].map((s) => s.getBoundingClientRect().height) };
      }));
      const d0 = await dom();
      const sm = s0.bottles.filter((b) => b.cap === 3), ds = d0.filter((x) => x.cap === '3'), dn = d0.filter((x) => x.cap === '4');
      check(`41 面：ちいさい びんが 1 本（state ${sm.length}・#board .bottle[data-cap="3"] ${ds.length}）、ほかは data-cap="4"`, s0.level === 41 && sm.length === 1 && ds.length === 1 && dn.length === d0.length - 1 && ds[0].id === String(sm[0].id), { level: s0.level, ds: ds.map((x) => x.id) });
      const ratio = ds.length && dn.length ? ds[0].gh / dn[0].gh : 0;
      check(`ちいさい びんは短く描く：ガラスの高さがふつうの瓶の ${ratio.toFixed(2)} 倍（0.70〜0.80）、aria-label「${ds[0] && ds[0].label}」`, ratio >= 0.7 && ratio <= 0.8 && !!ds[0] && ds[0].label.startsWith(`${sm[0].id + 1}ばん：ちいさい びん（3つ まで）。`), { ratio });
      const vw = await page.evaluate(() => [innerWidth, innerHeight]);
      check(`SE 縦：ちいさい びんが画面の中・押せる大きさ（${ds[0] && Math.round(ds[0].w)}×${ds[0] && Math.round(ds[0].h)}px）`, !!ds[0] && ds[0].w >= 44 && ds[0].h >= 44 && ds[0].left >= 0 && ds[0].right <= vw[0] && ds[0].top >= 0 && ds[0].bottom <= vw[1], { b: ds[0], vw });
      const flag = await stored(page, 'irobin.small'), tip = await page.evaluate(() => document.querySelector('#board').dataset.gimTip);
      check(`はじめての ちいさい びん：ヒント「${h0}」、#board[data-gim-tip="small"]（${tip}）、まだ 1 手も指していないので irobin.small は既読にしない（${flag}）`, /ちいさい びんには 3つ までしか/.test(h0 || '') && tip === 'small' && flag === null, { h0, tip, flag });
      // 常設の「3」の札：ちいさい びんだけにあり、12px 以上で瓶の中に収まる（形だけに頼らない）
      const capInfo = await page.evaluate(() => [...document.querySelectorAll('#board .bottle')].map((b) => { const t = b.querySelector('.capbox'), r = b.getBoundingClientRect(), tr = t ? t.getBoundingClientRect() : null;
        return { cap: b.dataset.cap, text: t ? t.textContent.trim() : null, fs: t ? parseFloat(getComputedStyle(t.querySelector('b') || t).fontSize) : 0, w: tr ? tr.width : 0, h: tr ? tr.height : 0, inside: !!tr && tr.left >= r.left - 0.5 && tr.right <= r.right + 0.5 && tr.top >= r.top - 0.5 }; }));
      const capTag = capInfo.filter((c) => c.text !== null);
      check(`ちいさい びんにだけ常設の「3」の札（${capTag.length} 個・「${capTag[0] && capTag[0].text}」・字 ${capTag[0] && capTag[0].fs}px・${capTag[0] && Math.round(capTag[0].w)}×${capTag[0] && Math.round(capTag[0].h)}px）、瓶の中に収まる`,
        capTag.length === 1 && capTag[0].cap === '3' && capTag[0].text === '3' && capTag[0].fs >= 12 && capTag[0].w >= 20 && capTag[0].h >= 16 && capTag[0].inside, capInfo);
      // 開き直しても、まだ 1 手も指していなければ同じ説明が出る
      await page.reload(); await wait(page, 300);
      const h1 = await hintText(page), tip1 = await page.evaluate(() => document.querySelector('#board').dataset.gimTip), s1 = await gs(page);
      check(`1 手も指さず開き直すと同じ説明がまた出る（${h1}・tip "${tip1}"）・同じ局面`, /ちいさい びんには 3つ までしか/.test(h1 || '') && tip1 === 'small' && J(s1.bottles) === J(s0.bottles), { h1, tip1 });
      // 最初の 1 手を指したら既読（irobin.small が "1"）
      await playMoves(page, (await solutionOf(page)).slice(0, 1)); await wait(page, 200);
      const flag2 = await stored(page, 'irobin.small');
      check(`最初の 1 手を指したら irobin.small が "1"（${flag2}）`, flag2 === '1', flag2);
      // 手で組んだ盤：ちいさい びん（2 段）へ 2 段注ぐと 1 段だけ。満杯へは注げずヒントと deny
      await page.evaluate(() => window.IrobinGame.setState({ level: 41, params: { colors: 3, empties: 1, hidden: false, order: 'random' }, bottles: [{ cells: [1, 0, 0] }, { cells: [0, 0], cap: 3 }, { cells: [2, 2, 1, 2] }, { cells: [1, 1, 2] }, { cells: [] }], slots: [0, 1], queue: [2] }));
      await wait(page, 100);
      const pr = await page.evaluate(() => window.IrobinGame.pour(0, 1)); await wait(page, 100);
      const s2 = await gs(page), d2 = await dom();
      const sd = d2.find((x) => x.cap === '3'), nd = d2.find((x) => x.id === '2');
      check(`2 段のちいさい びんへ同じ色 2 段を注ぐと 1 段だけ入って 3 段（${pr}・${J(s2.bottles[1].cells)}）、栓はしない`, pr === 'pour' && J(s2.bottles[1].cells) === '[0,0,0]' && s2.bottles[1].sealed === false && s2.bottles[0].cells.length === 2, s2.bottles.slice(0, 2));
      const segOk = !!sd && !!nd && sd.segs.length === 3 && nd.segs.length === 4 && Math.abs(sd.segs[0] - nd.segs[0]) <= 1;
      check(`ちいさい びんの段の高さはふつうの瓶と同じ（${sd && sd.segs[0] && sd.segs[0].toFixed(1)}px・${nd && nd.segs[0] && nd.segs[0].toFixed(1)}px、±1px）`, segOk, { sd: sd && sd.segs, nd: nd && nd.segs });
      const before = (await plays(page)).length;
      await page.evaluate(() => { window.IrobinGame.pick(0); window.IrobinGame.pick(1); }); await wait(page, 80);
      const h3 = await hintText(page), s3 = await gs(page), pl3 = (await plays(page)).slice(before).map((x) => x.n);
      check(`満杯のちいさい びんへは注げない：ヒント「${h3}」、deny の音、手は増えない`, /ちいさい びんには 3つ までしか/.test(h3 || '') && pl3.includes('deny') && s3.moves === s2.moves, { h3, pl3 });
      await ctx.close();
    },
  },
  {
    id: 'BW26', tier: 'full', title: 'いろびん v37 いろ きまりの びん（71 面）：ふちの色と首の札（その色の記号）・data-only・aria-label「いろ きまりの びん（○○だけ）」・はじめての説明と irobin.only・ちがう色はヒントと deny、同じ色は注げる・SE 縦で札が見分けられる・再読み込みで同じ局面',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'BW26', { v: SMOKE_V(), opts: { initScript: SFX_SPY }, extra: { 'irobin.best': '70', 'irobin.cloth': '1', 'irobin.small': '1' } });
      await page.waitForTimeout(400);   // ガラスのふちの色の transition（0.2 秒）が終わってから測る
      const s0 = await gs(page), h0 = await hintText(page);
      const ob = s0.bottles.filter((b) => b.only !== null);
      const info = await page.evaluate(() => [...document.querySelectorAll('#board .bottle[data-only]')].map((b) => {
        const r = b.getBoundingClientRect(), t = b.querySelector('.onlybox'), tr = t ? t.getBoundingClientRect() : null, m = t && t.querySelector('svg');
        return { id: b.dataset.id, only: b.dataset.only, label: b.getAttribute('aria-label') || '', mark: m ? m.dataset.mark : null, bg: t ? getComputedStyle(t).backgroundColor : '', border: getComputedStyle(b.querySelector('.glass')).borderLeftColor,
          box: tr && { w: tr.width, h: tr.height, l: tr.left, r: tr.right, t: tr.top }, b: { l: r.left, r: r.right, t: r.top } };
      }));
      const C = await page.evaluate(() => window.IrobinLogic.COLORS);
      const hex2rgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
      const x = info[0], col = ob[0] && C[ob[0].only];
      check(`71 面：いろ きまりの びんが 1 本（state ${ob.length}・DOM ${info.length}）、data-only＝色 ${x && x.only}`, s0.level === 71 && ob.length === 1 && info.length === 1 && x.only === String(ob[0].only) && x.id === String(ob[0].id), info);
      check(`首の札はその色で記号つき（${x && x.mark}＝${col && col.mark}・背景 ${x && x.bg}）、ガラスのふちもその色、aria-label「${x && x.label}」`,
        !!x && !!col && x.mark === col.mark && x.bg === hex2rgb(col.hex) && x.border === hex2rgb(col.hex) && x.label.startsWith(`${ob[0].id + 1}ばん：いろ きまりの びん（${col.name}だけ）。`), x);
      check(`SE 縦：札が瓶の幅の中で 16px 以上（${x && x.box && Math.round(x.box.w)}px）`, !!x && !!x.box && x.box.w >= 16 && x.box.h >= 16 && x.box.l >= x.b.l - 0.5 && x.box.r <= x.b.r + 0.5, x && x.box);
      const flag = await stored(page, 'irobin.only'), tip = await page.evaluate(() => document.querySelector('#board').dataset.gimTip);
      check(`はじめての いろ きまりの びん：ヒント「${h0}」（くちの しるしと おなじ いろ だけ はいるよ）、data-gim-tip="only"（${tip}）、まだ 1 手も指していないので irobin.only は既読にしない（${flag}）`, /^くちの しるしと おなじ いろ だけ はいるよ/.test(h0 || '') && tip === 'only' && flag === null, { h0, tip, flag });
      await playMoves(page, (await solutionOf(page)).slice(0, 1)); await wait(page, 200);
      const flag2 = await stored(page, 'irobin.only');
      check(`最初の 1 手を指したら irobin.only が "1"（${flag2}）`, flag2 === '1', flag2);
      // 1 手指した後で開き直すと、同じ局面・説明は出ない
      const s1m = await gs(page);
      await page.reload(); await wait(page, 300);
      const s3 = await gs(page), h3 = await hintText(page);
      check(`1 手指した後で開き直すと同じ局面・説明は出ない（${h3}）`, J(s3.bottles) === J(s1m.bottles) && s3.moves === 1 && !/くちの しるし/.test(h3 || ''), h3);
      // ちがう色を注ぐと注げない／同じ色は注げる（手で組んだ盤）
      await page.evaluate(() => window.IrobinGame.setState({ level: 71, params: { colors: 3, empties: 1, hidden: false, order: 'random' }, bottles: [{ cells: [1, 0, 0] }, { cells: [], only: 1 }, { cells: [2, 2, 0, 1] }, { cells: [2, 1, 2] }, { cells: [0, 1] }], slots: [0, 1], queue: [2] }));
      await wait(page, 100);
      const before = (await plays(page)).length;
      await page.evaluate(() => { window.IrobinGame.pick(0); window.IrobinGame.pick(1); }); await wait(page, 80);
      const h1 = await hintText(page), s1 = await gs(page), pl1 = (await plays(page)).slice(before).map((y) => y.n);
      check(`ちがう色（オレンジ）を いろ きまり（みずいろ）へ：注げずヒント「${h1}」、deny の音`, /みずいろ しか いれられない/.test(h1 || '') && s1.moves === 0 && pl1.includes('deny'), { h1, pl1 });
      const pr = await page.evaluate(() => window.IrobinGame.pour(4, 1)); await wait(page, 80);
      const s2 = await gs(page);
      check(`同じ色（みずいろ）は注げる（${pr}・${J(s2.bottles[1].cells)}・only ${s2.bottles[1].only}）`, pr === 'pour' && J(s2.bottles[1].cells) === '[1]' && s2.bottles[1].only === 1, s2.bottles[1]);
      await ctx.close();
    },
  },
  {
    id: 'BW27', tier: 'full', title: 'いろびん v37 かぎの びん（101 面）：錠の絵（鍵の色と記号）・data-lock・aria-label「かぎの びん（○○を 1ぽん そろえると あく）」・中身は見える・はじめての説明と irobin.lock・押すと選べずヒントと deny（選んでいた瓶はそのまま）・鍵の色をそろえると開く（錠が消える・音 unveil・「かぎが あいた！」）・動きを減らす設定でも開く・SE 縦で見分けられる・再読み込みで同じ局面',
    async run({ browser, check }) {
      const v = SMOKE_V();
      const { ctx, page } = await openG(browser, 'BW27', { v, opts: { initScript: SFX_SPY, clock: false }, extra: { 'irobin.best': '100', 'irobin.cloth': '1', 'irobin.small': '1', 'irobin.only': '1' } });
      const s0 = await gs(page), h0 = await hintText(page);
      const lb = s0.bottles.filter((b) => b.lock !== null);
      const lockDom = () => page.evaluate(() => [...document.querySelectorAll('#board .bottle')].map((b) => {
        const r = b.getBoundingClientRect(), t = b.querySelector('.lockbox'), tr = t ? t.getBoundingClientRect() : null, m = t && t.querySelector('.lockbody svg');
        return { id: b.dataset.id, lock: b.dataset.lock ?? null, label: b.getAttribute('aria-label') || '', mark: m ? m.dataset.mark : null, segs: b.querySelectorAll('.seg').length, segTop: Math.min(...[...b.querySelectorAll('.seg')].map((q) => q.getBoundingClientRect().top)),
          box: tr && { w: tr.width, h: tr.height, l: tr.left, r: tr.right, t: tr.top, b: tr.bottom }, bt: { l: r.left, r: r.right, t: r.top, b: r.bottom } };
      }));
      const C = await page.evaluate(() => window.IrobinLogic.COLORS);
      const d0 = await lockDom(), x = d0.find((y) => y.lock !== null), col = lb[0] && C[lb[0].lock];
      check(`101 面：かぎの びんが 1 本（state ${lb.length}・DOM ${d0.filter((y) => y.lock !== null).length}）`, s0.level === 101 && lb.length === 1 && d0.filter((y) => y.lock !== null).length === 1 && x.id === String(lb[0].id) && x.lock === String(lb[0].lock), d0.filter((y) => y.lock !== null));
      check(`錠の絵は鍵の色の記号（${x && x.mark}＝${col && col.mark}）、中身の段は見える（${x && x.segs} 段）、aria-label「${x && x.label}」`,
        !!x && !!col && x.mark === col.mark && x.segs === lb[0].cells.length && x.label.startsWith(`${lb[0].id + 1}ばん：かぎの びん（${col.name}を 1ぽん そろえると あく）。`), x);
      check(`SE 縦：錠が 16px 以上（${x && x.box && Math.round(x.box.w)}×${x && x.box && Math.round(x.box.h)}px）で瓶の幅の中、口の上にあって中身のマスと重ならない（錠の下 ${x && x.box && Math.round(x.box.b)} ≦ 一番上の段の上 ${x && Math.round(x.segTop)}）`,
        !!x && !!x.box && x.box.w >= 16 && x.box.h >= 16 && x.box.l >= x.bt.l - 0.5 && x.box.r <= x.bt.r + 0.5 && x.box.b <= x.segTop + 0.5, x && { box: x.box, segTop: x.segTop });
      const flag = await stored(page, 'irobin.lock'), tip = await page.evaluate(() => document.querySelector('#board').dataset.gimTip);
      check(`はじめての かぎの びん：ヒント「${h0}」、data-gim-tip="lock"（${tip}）、まだ 1 手も指していないので irobin.lock は既読にしない（${flag}）`, /かぎの びんは/.test(h0 || '') && tip === 'lock' && flag === null, { h0, tip, flag });
      // 押すと選べない。選んでいた瓶はそのまま
      const li = s0.bottles.findIndex((b) => b.lock !== null);
      const before = (await plays(page)).length;
      await page.click(`#board .bottle[data-id="${lb[0].id}"]`); await wait(page, 80);
      const s1 = await gs(page), h1 = await hintText(page), pl1 = (await plays(page)).slice(before).map((y) => y.n);
      check(`かぎの びんを押すと選べない（selected ${s1.selected}）、ヒント「${h1}」、deny の音`, s1.selected === null && new RegExp(`${col.name}を 1ぽん そろえると あく`).test(h1 || '') && pl1.includes('deny'), { h1, pl1 });
      const other = s0.bottles.findIndex((b, i) => i !== li && b.cells.length > 0 && b.lock === null);
      await page.evaluate(([o, l]) => { window.IrobinGame.pick(o); window.IrobinGame.pick(l); }, [other, li]); await wait(page, 80);
      const s2 = await gs(page);
      check(`瓶を選んでから かぎの びんを押しても、選びは解除されず注げない（selected ${s2.selected}・手 ${s2.moves}）`, s2.selected === other && s2.moves === 0, s2.selected);
      await page.keyboard.press('Escape'); await wait(page, 40);
      // 鍵が開く手の前まで進めて、開く手を演出つきで
      const plan = await page.evaluate(() => { const L = window.IrobinLogic, c = L.createLevel(101); let st = c.state; for (let i = 0; i < c.info.solution.length; i++) { const r = L.applyMove(st, ...c.info.solution[i]); if (r.outcome.unlocked.length) return { at: i, sol: c.info.solution }; st = r.state; } return null; });
      check(`101 面の解の途中で鍵が開く（${plan && plan.at + 1} 手目）`, !!plan, plan && plan.at);
      if (plan) {
        await playMoves(page, plan.sol.slice(0, plan.at));
        const flagL = await stored(page, 'irobin.lock');
        check(`最初の 1 手を指したら irobin.lock が "1"（${flagL}）`, plan.at === 0 || flagL === '1', flagL);
        const b3 = (await plays(page)).length;
        await page.evaluate(([f, t]) => { window.IrobinGame.pick(f); window.IrobinGame.pick(t); }, plan.sol[plan.at]);
        // 開く演出の途中で、持ち上がる錠（.lockfly）が見えている（大きさが 0 でなく、display:none の中でもない）
        let fly = null;
        for (let i = 0; i < 160; i++) {
          const f = await page.evaluate(() => { const e = document.querySelector('#board .lockfly'); if (!e) return null; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { w: r.width, h: r.height, vis: cs.visibility, op: parseFloat(cs.opacity), disp: cs.display }; });
          if (f && f.w > 0 && f.h > 0 && f.op > 0.05 && f.vis === 'visible' && f.disp !== 'none') { fly = f; break; }
          await wait(page, 30);
          if (!(await gs(page)).busy) break;
        }
        check(`開く演出の途中で錠（.lockfly）が見えている（${fly && Math.round(fly.w)}×${fly && Math.round(fly.h)}px・不透明度 ${fly && fly.op.toFixed(2)}）`, !!fly, fly);
        for (let i = 0; i < 160; i++) { await wait(page, 50); if (!(await gs(page)).busy) break; }
        await wait(page, 100);
        const s4 = await gs(page), d4 = await lockDom(), h4 = await hintText(page), pl4 = (await plays(page)).slice(b3);
        const y = d4.find((z) => z.id === String(lb[0].id)), b4 = s4.bottles.find((b) => b.id === lb[0].id);
        check(`鍵の色をそろえると開く：state の lock null、data-lock が消え錠の絵も無い、aria-label に「かぎ」が無い（${y && y.label}）`, !!b4 && b4.lock === null && !!y && y.lock === null && !y.box && !/かぎ/.test(y.label), { b4, y });
        check(`開くと音 unveil（表にある音）、ヒント「${h4}」`, pl4.some((z) => z.n === 'unveil' && z.known) && /かぎが あいた/.test(h4 || ''), { h4, tail: pl4.map((z) => z.n) });
        const save = JSON.parse((await stored(page, 'irobin.save')) || '{}');
        await page.reload(); await wait(page, 300);
        const s5 = await gs(page);
        check(`再読み込みで同じ局面（v:${save.v}・鍵が開いたまま）`, save.v === 3 && J(s5.bottles) === J(s4.bottles), null);
      }
      await ctx.close();
      // 動きを減らす設定：開く手が 1 秒以内に終わり、錠が消える
      if (plan) {
        const c2 = await openG(browser, 'BW27 calm', { v, opts: { clock: false, reducedMotion: 'reduce' }, extra: { 'irobin.best': '100', 'irobin.cloth': '1', 'irobin.small': '1', 'irobin.only': '1', 'irobin.lock': '1' } });
        await playMoves(c2.page, plan.sol.slice(0, plan.at));
        const r = await c2.page.evaluate(([f, t, id]) => new Promise((ok) => {
          const g = window.IrobinGame, a = performance.now();
          g.pick(f); g.pick(t);
          const tick = () => { const s = g.getState(), b = document.querySelector(`#board .bottle[data-id="${id}"]`); if (!s.busy && s.phase !== 'pouring') ok({ ms: performance.now() - a, lock: b ? b.dataset.lock ?? null : 'none' }); else if (performance.now() - a > 5000) ok({ ms: 9999 }); else requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
        }), [...plan.sol[plan.at], lb[0].id]);
        check(`動きを減らす設定：鍵が開く手が ${Math.round(r.ms)}ms（1000ms 未満）で終わり、錠が消える`, r.ms < 1000 && r.lock === null, r);
        await c2.ctx.close();
      }
    },
  },
  {
    id: 'BW28', tier: 'full', title: 'いろびん v37 遊び方：もう出てきた仕掛けだけ 1 行（40 面までは今のまま 3 項目、101 面まで来たら ちいさい・いろ きまり・かぎ の 3 つ）、SE 縦・横のホーム画面で「わかった」がスクロールなしで押せる',
    async run({ browser, check }) {
      const rowsOf = (p) => p.evaluate(() => ({ items: document.querySelectorAll('#overlay ol.rules li').length, gim: (document.querySelector('#overlay li.gimhelp') || {}).textContent || '' }));
      const a = await openG(browser, 'BW28 39', { v: view('SE', 'p', 'app'), help: false, extra: { 'irobin.best': '39' } });
      const r0 = await rowsOf(a.page);
      check(`40 面までは遊び方が 3 項目のまま（${r0.items}・仕掛けの行「${r0.gim}」）`, r0.items === 3 && !r0.gim, r0);
      await a.ctx.close();
      const b = await openG(browser, 'BW28 75', { v: view('SE', 'p', 'app'), help: false, extra: { 'irobin.best': '75' } });
      const r1 = await rowsOf(b.page);
      check(`76 面まで来たら ちいさい・いろ きまり の行（「${r1.gim}」）、かぎ はまだ書かない`, r1.items === 4 && /ちいさい びん/.test(r1.gim) && /いろ きまりの びん/.test(r1.gim) && !/かぎ/.test(r1.gim), r1);
      await b.ctx.close();
      for (const o of ['p', 'l']) {
        const v = view('SE', o, 'app');
        const c = await openG(browser, `BW28 SE ${o}`, { v, help: false, extra: { 'irobin.best': '120' } });
        const r = await rowsOf(c.page);
        const vis = await c.page.evaluate(() => {
          const ov = document.querySelector('#overlay'); ov.scrollTop = 0;
          const bt = ov.querySelector('[data-cmd="close"]'); const rr = bt.getBoundingClientRect();
          const t = document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2);
          const small = [...ov.querySelectorAll('li, p, h2, button')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 12).length;
          return { li: Math.min(...[...ov.querySelectorAll('ol.rules li')].map((e) => parseFloat(getComputedStyle(e).fontSize))), bottom: Math.round(rr.bottom), ih: innerHeight, hit: !!t && (t === bt || bt.contains(t)), sh: ov.scrollHeight, ch: ov.clientHeight, small };
        });
        // 縦は BW16 と同じ（閉じるボタンは下に貼りついて見えたまま）、横は BW23 と同じ（カードが全部収まる）
        check(`${v.label}・121 面：仕掛けの行に 3 つ（「${r.gim}」）、「わかった」がスクロールなしで押せる（${vis.bottom}/${vis.ih}）${o === 'l' ? `・カードが全部収まる（scrollHeight ${vis.sh}/${vis.ch}）` : ''}、字 12px 以上、項目の字 ${vis.li}px（縦は 14px 以上・横は 13px 以上）`,
          r.items === 4 && /ちいさい びん/.test(r.gim) && /いろ きまりの びん/.test(r.gim) && /かぎの びん/.test(r.gim) && vis.hit && vis.bottom <= vis.ih && (o === 'p' || vis.sh <= vis.ch + 1) && vis.small === 0 && vis.li >= (o === 'p' ? 14 : 13), { r, vis });
        await c.ctx.close();
      }
    },
  },
  {
    id: 'BW29', tier: 'full', title: 'いろびん IB-25：詰んだ・予備軍になった最初の 1 回だけ「とける ところまで もどす」のカード（44px 以上・出てすぐは押せない）、押すと解ける最後の局面へ戻る（保存も同じ・開き直しても同じ。3,000 では言い切れない局面でも面の最初まで落ちない＝IB-46）、「このまま つづける」は閉じるだけ、setState の詰みでも出る、SE 縦・横で収まる',
    async run({ browser, check }) {
      // 解ける最後の局面の確かめ：面の最初から手（位置）を当てた局面の列で、k が solved、k+1〜n がどれも solved でない
      const lastSolvable = (page, lv, path, k) => page.evaluate(([lv, path, k]) => {
        const L = window.IrobinLogic; const st = [L.createLevel(lv).state];
        for (const [f, t] of path) st.push(L.applyMove(st[st.length - 1], f, t).state);
        const sv = (x) => L.solve(x, { nodeLimit: 3000000 }).solved === true;   // 本当に解けるか（IB-46：3,000 では言い切れない局面がある）
        const after = st.slice(k + 1).map(sv);
        return { atK: sv(st[k]), after, ok: sv(st[k]) && after.every((x) => !x) };
      }, [lv, path, k]);
      const attn = (p) => p.evaluate(() => [document.querySelector('#undoBtn').dataset.attention, document.querySelector('#restartBtn').dataset.attention]);
      // (a)〜(c) 4 面：BW16 と同じ探し方で予備軍に入る
      const { ctx, page } = await openG(browser, 'BW29', { opts: { initScript: SFX_SPY }, extra: { 'irobin.best': '3' } });
      await page.evaluate(() => window.IrobinGame.setLevel(4)); await wait(page, 100);
      const path4 = await page.evaluate(() => {
        const L = window.IrobinLogic;
        for (let sd = 1; sd <= 50; sd++) {
          let st = L.createLevel(4).state; const mv = []; let seed = sd;
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
      check(`4 面で予備軍に入る手が見つかる（${path4 ? path4.length : 'なし'} 手）`, Array.isArray(path4) && path4.length > 0, path4);
      if (path4) {
        const n = path4.length;
        const p0 = (await plays(page)).length;
        await playMoves(page, path4);
        const s1 = await gs(page), o1 = await overlayInfo(page), pr = await overlayProbe(page, null);
        const st1 = (await plays(page)).slice(p0).filter((x) => x.n === 'stuck').length;
        check(`(a) 予備軍になると rescue のカード（overlay ${s1.overlay}）：見出し「もう ぜんぶは とどけられないよ」・「とける ところまで もどす」（主・先）と「このまま つづける」・ボタン 44px 以上・音 stuck が 1 回（${st1}）`,
          s1.overlay === 'rescue' && /もう ぜんぶは とどけられないよ/.test(o1.text) && /とける ところまで もどす？/.test(o1.text) && J(o1.cmds) === J(['rewindYes', 'close']) && o1.active === 'rewindYes'
          && /このまま つづける/.test(o1.text) && overlayOk(pr) && st1 === 1, { s1: s1.overlay, o1, pr, st1 });
        await clickCmd(page, 'rewindYes'); await wait(page, 60);
        const s2 = await gs(page);
        check(`(b) 出てすぐ（400ms 以内）押しても戻らない（moves ${s2.moves}・overlay ${s2.overlay}）`, s2.moves === n && s2.overlay === 'rescue', s2);
        await wait(page, 450); await clickCmd(page, 'rewindYes'); await wait(page, 150);
        const s3 = await gs(page), h3 = await hintText(page), a3 = await attn(page);
        const ls = await lastSolvable(page, 4, path4, s3.moves);
        const sv = await stored(page, 'irobin.save');
        let svMoves = -1; try { svMoves = JSON.parse(sv).moves.length; } catch { /* 下で不合格 */ }
        check(`(c) 押すと解ける最後の局面へ（moves ${n}→${s3.moves}・k が解ける ${ls.atK}・k+1〜n は解けない ${J(ls.after)}）、カードが閉じ、doomed false・目印なし・ヒント「ここからなら」（${h3}）・保存の手も ${svMoves} 手`,
          s3.moves < n && ls.ok && s3.overlay === null && s3.doomed === false && !a3.includes('1') && /ここからなら/.test(h3 || '') && svMoves === s3.moves && s3.canUndo === (s3.moves > 0), { s3: { moves: s3.moves, overlay: s3.overlay, doomed: s3.doomed }, ls, a3, h3, svMoves });
        const b3 = J(s3.bottles);
        await page.reload(); await wait(page, 300);
        const s4 = await gs(page);
        check(`(c) 開き直しても同じ局面（moves ${s4.moves}）`, s4.moves === s3.moves && J(s4.bottles) === b3, { m: s4.moves });
      }
      await ctx.close();
      // (d) 「このまま つづける」→ そのまま遊んで詰む → もう一度カード → 押すと何手も戻る（1 手もどすと同じではない）
      const c2 = await openG(browser, 'BW29 つづける', { extra: { 'irobin.best': '7' } });
      const plan = await c2.page.evaluate(() => {
        const L = window.IrobinLogic;
        for (const lv of [8, 12]) for (let sd = 1; sd <= 50; sd++) {
          let st = L.createLevel(lv).state; const mv = []; const hist = [st]; let seed = sd, dAt = -1;
          const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
          for (let k = 0; k < 200; k++) {
            const ms = L.legalMoves(st); if (!ms.length || st.won) break;
            const m = ms[Math.floor(rnd() * ms.length)]; st = L.applyMove(st, m[0], m[1]).state; mv.push([m[0], m[1]]); hist.push(st);
            if (st.won) break;
            if (dAt < 0) { const r = L.solve(st, { nodeLimit: 3000 }); if (!L.isStuck(st) && !r.solved && !r.exhausted) dAt = mv.length; }
          }
          if (dAt < 0 || st.won || !L.isStuck(st) || mv.length < dAt + 2) continue;
          let K = 0;
          for (let j = mv.length - 1; j >= 1; j--) if (L.solve(hist[j], { nodeLimit: 3000 }).solved) { K = j; break; }
          if (K < mv.length - 1) return { lv, sd, dAt, mv, K };
        }
        return null;
      });
      check(`予備軍に入ってから続けて詰み、戻し先が 2 手以上前になる手が見つかる（${plan ? `${plan.lv} 面・${plan.dAt} 手目で予備軍・${plan.mv.length} 手で詰み・戻し先 ${plan.K}` : 'なし'}）`, !!plan, plan);
      if (plan) {
        const g = c2.page;
        await g.evaluate((lv) => window.IrobinGame.setLevel(lv), plan.lv); await wait(g, 100);
        await playMoves(g, plan.mv.slice(0, plan.dAt)); await wait(g, 100);
        const d1 = await gs(g);
        await wait(g, 450); await clickCmd(g, 'close'); await wait(g, 100);
        const d2 = await gs(g), hd = await hintText(g);
        check(`(d) 「このまま つづける」：カードが閉じ（${d1.overlay}→${d2.overlay}）、doomed のまま・ヒントは「1手もどす」の案内（${hd}）・手は ${d2.moves}`, d1.overlay === 'rescue' && d2.overlay === null && d2.doomed === true && /1手もどす/.test(hd || '') && d2.moves === plan.dAt, { d1: d1.overlay, d2 });
        await playMoves(g, plan.mv.slice(plan.dAt, plan.dAt + 1)); await wait(g, 100);
        const d3 = await gs(g);
        check(`(d) 次の手（まだ詰みでない）ではカードは出ない（overlay ${d3.overlay}・stuck ${d3.stuck}）`, d3.overlay === null && d3.stuck === false, d3.overlay);
        await playMoves(g, plan.mv.slice(plan.dAt + 1)); await wait(g, 100);
        const d4 = await gs(g), o4 = await overlayInfo(g);
        check(`(d) そのまま詰むと、もう一度カード（見出し「うごかせる びんが ないよ」。overlay ${d4.overlay}・stuck ${d4.stuck}）`, d4.overlay === 'rescue' && d4.stuck === true && /うごかせる びんが ないよ/.test(o4.text), { d4: d4.overlay, o4 });
        await wait(g, 450); await clickCmd(g, 'rewindYes'); await wait(g, 150);
        const d5 = await gs(g);
        const ls = await lastSolvable(g, plan.lv, plan.mv, d5.moves);
        check(`(d) 押すと解ける最後の局面（${plan.mv.length} 手→${d5.moves} 手。1 手もどすより前・k が解ける ${ls.atK}・k+1〜n は解けない ${J(ls.after)}）`, d5.moves === plan.K && d5.moves < plan.mv.length - 1 && ls.ok && d5.stuck === false && d5.overlay === null, { d5: d5.moves, ls });
      }
      await c2.ctx.close();
      // (g) カードを出す時に遊び方が開いていた（取りやめ）：予備軍のまま次の手を指すと、そのときにカードが出る
      if (path4) {
        const cg = await openG(browser, 'BW29 とりやめ', { extra: { 'irobin.best': '3' } });
        const gp = cg.page;
        await gp.evaluate(() => window.IrobinGame.setLevel(4)); await wait(gp, 100);
        // path4 のあと、まだ詰まずに予備軍のままの手
        const nx = await gp.evaluate((path) => {
          const L = window.IrobinLogic; let st = L.createLevel(4).state;
          for (const [f, t] of path) st = L.applyMove(st, f, t).state;
          for (const [f, t] of L.legalMoves(st)) { const s2 = L.applyMove(st, f, t).state; const r = L.solve(s2, { nodeLimit: 3000 }); if (!s2.won && !L.isStuck(s2) && !r.solved && !r.exhausted) return [f, t]; }
          return null;
        }, path4);
        check(`4 面：予備軍のまま次に指せる手がある（${J(nx)}）`, !!nx, nx);
        if (nx) {
          await playMoves(gp, path4.slice(0, -1));
          const [f, t] = path4[path4.length - 1];
          // 注いで演出の途中に遊び方を開き、そのあと演出を終わらせる（カードは遊び方が開いているので取りやめ）
          await gp.evaluate(([f, t]) => { window.IrobinGame.pick(f); window.IrobinGame.pick(t); document.getElementById('helpBtn').click(); window.IrobinGame.skip(); }, [f, t]);
          await wait(gp, 100);
          const g1 = await gs(gp);
          await clickCmd(gp, 'close'); await wait(gp, 400);
          const g2 = await gs(gp);
          await playMoves(gp, [nx]); await wait(gp, 100);
          const g3 = await gs(gp);
          check(`(g) 遊び方が開いていてカードが取りやめ（overlay ${g1.overlay}・doomed ${g1.doomed}）→ 閉じても出ない（${g2.overlay}）→ 予備軍のまま次の手を指すとカード（${g3.overlay}・doomed ${g3.doomed}）`, g1.overlay === 'help' && g1.doomed === true && g2.overlay === null && g3.overlay === 'rescue' && g3.doomed === true, { g1: g1.overlay, g2: g2.overlay, g3: g3.overlay });
        }
        await cg.ctx.close();
      }
      // (h) IB-46：解ける最後の局面が 1 局面 3,000 では言い切れない（直す前は面の最初まで戻っていた）。v42 の 80 面、5 手目で予備軍、解ける最後は 2 手
      {
        const ch = await openG(browser, 'BW29 IB-46', { extra: { 'irobin.best': '127' } });
        const hp = ch.page;
        await hp.evaluate(() => window.IrobinGame.setLevel(80)); await wait(hp, 100);
        const path80 = [[10, 8], [6, 10], [2, 6], [11, 4], [5, 11]];
        const pre = await hp.evaluate((path) => {
          const L = window.IrobinLogic; const st = [L.createLevel(80).state];
          for (const [f, t] of path) st.push(L.applyMove(st[st.length - 1], f, t).state);
          const r = (x, n) => { const o = L.solve(x, { nodeLimit: n }); return o.solved ? 's' : o.exhausted ? 'e' : 'x'; };
          return { small: st.map((x) => r(x, 3000)).join(''), big: st.map((x) => r(x, 3000000)).join('') };
        }, path80);
        check(`(h) 80 面の場面：3,000 では 1〜4 手が言い切れず（${pre.small}）、本当は 2 手まで解ける（${pre.big}）`, /^.eeeex$/.test(pre.small) && pre.big === 'sssxxx', pre);
        await playMoves(hp, path80); await wait(hp, 100);
        const h1 = await gs(hp);
        const t0 = Date.now();
        await wait(hp, 450);
        // 押した直後（探している間・探し終えた直後）の「1手もどす」と瓶の押下は受けない（止まっている間の 2 回目のタップ）
        await hp.evaluate(() => new Promise((res) => { document.querySelector('#overlay [data-cmd="rewindYes"]').click(); document.getElementById('undoBtn').click(); setTimeout(() => { document.getElementById('undoBtn').click(); const b = document.querySelector('#board button, #board [data-index]'); if (b) b.click(); res(); }, 5); }));
        await wait(hp, 150);
        const h2 = await gs(hp), hh = await hintText(hp);
        const ls = await lastSolvable(hp, 80, path80, h2.moves);
        check(`(h) 押すと面の最初でなく解ける最後の 2 手へ（5 手→${h2.moves} 手。すぐあとの「1手もどす」と瓶の押下は受けない・選択 ${h2.selected}。k が解ける ${ls.atK}・k+1〜5 は解けない ${J(ls.after)}）・ヒント「ここからなら」（${hh}）`, h1.overlay === 'rescue' && h1.moves === 5 && h2.moves === 2 && h2.selected === null && ls.ok && h2.overlay === null && /ここからなら/.test(hh || ''), { h1: h1.overlay, h2: h2.moves, ls, ms: Date.now() - t0 });
        // (h2) 何回か上限を広げ、合計 30,000 を超えて見つかる場面：v42 の 128 面、8 手で詰み（stuck）、解ける最後は 1 手（約 75,000 局面。上限 30,000・広げ方 2 倍では 0 手に落ちる）
        await hp.evaluate(() => window.IrobinGame.setLevel(128)); await wait(hp, 100);
        const path128 = [[7, 11], [2, 6], [11, 2], [4, 11], [9, 11], [1, 7], [6, 1], [2, 6]];
        await playMoves(hp, path128); await wait(hp, 100);
        const i1 = await gs(hp);
        await wait(hp, 450); await clickCmd(hp, 'rewindYes'); await wait(hp, 400);
        const i2 = await gs(hp);
        const ls2 = await lastSolvable(hp, 128, path128, i2.moves);
        check(`(h2) 128 面：8 手で詰みのカード（${i1.overlay}・stuck ${i1.stuck}）→ 押すと 1 手へ（${i2.moves} 手。k が解ける ${ls2.atK}・k+1〜8 は解けない ${J(ls2.after)}）`, i1.overlay === 'rescue' && i1.stuck === true && i1.moves === 8 && i2.moves === 1 && ls2.ok && i2.overlay === null, { i1: i1.overlay, i2: i2.moves, ls2 });
        await ch.ctx.close();
      }
      // (e) setState の詰み（BW7 の局面）でもカード、押すと詰みでなくなる
      const c3 = await openG(browser, 'BW29 setState');
      await c3.page.evaluate((s) => window.IrobinGame.setState(s), STUCK_STATE()); await wait(c3.page, 100);
      await c3.page.evaluate(() => { window.IrobinGame.pick(0); window.IrobinGame.pick(1); window.IrobinGame.skip(); }); await wait(c3.page, 100);
      const e1 = await gs(c3.page);
      await wait(c3.page, 450); await clickCmd(c3.page, 'rewindYes'); await wait(c3.page, 150);
      const e2 = await gs(c3.page);
      const he = await hintText(c3.page);
      check(`(e) setState の詰みでもカード（${e1.overlay}・stuck ${e1.stuck}）、押すと詰みでなくなる（stuck ${e2.stuck}・moves ${e2.moves}・overlay ${e2.overlay}）、setState の最初へ戻ったときのヒントは ふつうの文（${he}）`, e1.overlay === 'rescue' && e1.stuck === true && e2.stuck === false && e2.moves === 0 && e2.overlay === null && e2.phase === 'idle' && !/ここからなら/.test(he || '') && !!he, { e1, e2, he });
      await c3.ctx.close();
      // (f) SE 縦・横（ホーム画面）でカードがスクロールなしで収まり、ボタンが画面内
      for (const o of ['p', 'l']) {
        const v = view('SE', o, 'app');
        const c = await openG(browser, `BW29 SE ${o}`, { v });
        await c.page.evaluate((s) => window.IrobinGame.setState(s), STUCK_STATE()); await wait(c.page, 100);
        await c.page.evaluate(() => { window.IrobinGame.pick(0); window.IrobinGame.pick(1); window.IrobinGame.skip(); }); await wait(c.page, 100);
        const pr = await overlayProbe(c.page, v.safe);
        const sc = await c.page.evaluate(() => { const ov = document.querySelector('#overlay'); return { sh: ov.scrollHeight, ch: ov.clientHeight }; });
        check(`(f) ${v.label}：カードがスクロールなしで収まり（${sc.sh}/${sc.ch}）、ボタンが画面内・44px 以上`, (await gs(c.page)).overlay === 'rescue' && sc.sh <= sc.ch + 1 && overlayOk(pr), { pr, sc });
        await c.ctx.close();
      }
    },
  },
  {
    id: 'BW30', tier: 'full', title: 'いろびん IB-08 の画面：115 面と 110 面（ずらされた動物が見えている間に新しい人が来る）を solution で遊び、2 人いる各局面で #cust0Text・#cust1Text の動物の名前が違う',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'BW30', { extra: { 'irobin.best': '114' } });
      await page.evaluate(() => window.IrobinGame.setLevel(115)); await wait(page, 100);
      const sol = await solutionOf(page);
      check(`115 面の solution がある（${sol ? sol.length : 'なし'} 手）`, Array.isArray(sol) && sol.length > 0, null);
      const names = () => page.evaluate(() => ['cust0', 'cust1'].map((id) => {
        const e = document.getElementById(id), t = document.getElementById(id + 'Text');
        if (!e || !e.dataset.color) return null;
        const m = /ほしい\s*(\S+)\s*$/.exec(t ? t.textContent.trim() : '');
        return m ? m[1] : '?';
      }));
      let both = 0; const dup = [];
      const look = async (k) => { const [a, b] = await names(); if (a && b) { both++; if (a === b || a === '?') dup.push(`${k} 手：${a}・${b}`); } };
      await look(0);
      for (let k = 0; sol && k < sol.length - 1; k++) { await playMoves(page, [sol[k]]); await look(k + 1); }
      check(`2 人いる ${both} 局面のどれも、2 つの枠の動物の名前が違う（同じ ${dup.length}）`, both > 5 && dup.length === 0, dup.slice(0, 8));
      // ずらされた動物が見えている間に新しい人が来る場面（110 面の解の道。先の人が帰っても、ずらされた人はそのまま待つ）：
      // 新しい人は、いま見えている動物と違う動物で来る
      await page.evaluate(() => window.IrobinGame.setLevel(110)); await wait(page, 100);
      const sol110 = await page.evaluate(() => window.IrobinLogic.createLevel(110).info.solution.map((m) => [m[0], m[1]]));   // 生成の解の道（この道で起きることを stateful の台本で確かめた）
      const ord110 = await page.evaluate(() => { const s = window.IrobinLogic.createLevel(110).state; return [].concat(s.slots, s.queue).filter(Number.isInteger); });
      const base = await page.evaluate((ord) => { const N = window.IrobinRender.ANIMAL_NAMES; return ord.map((_, i) => N[window.IrobinLogic.animalFor(110, i)]); }, ord110);
      const cols = () => page.evaluate(() => ['cust0', 'cust1'].map((id) => { const e = document.getElementById(id); return e && e.dataset.color ? Number(e.dataset.color) : null; }));
      let prev = await cols(), scene = 0, both110 = 0; const dup110 = [];
      const slow = [await names()];   // 演出つきで遊んだときの、各手のあとの 2 つの枠の動物（下で、飛ばしたとき・もどしたときと比べる）
      // 演出を飛ばさずに進める
      const playSlow = async ([f, t]) => {
        await page.evaluate(([f, t]) => { window.IrobinGame.pick(f); window.IrobinGame.pick(t); }, [f, t]);
        for (let j = 0; j < 100; j++) { await wait(page, 100); const g = await gs(page); if (!g.busy && g.phase !== 'pouring') break; }
      };
      for (let k = 0; sol110 && k < sol110.length - 1; k++) {
        await playSlow(sol110[k]);
        const c = await cols(), nm = await names();
        slow.push(nm);
        if (nm[0] && nm[1]) { both110++; if (nm[0] === nm[1]) dup110.push(`${k + 1} 手：${nm[0]}`); }
        for (let y = 0; y < 2; y++) {
          const x = 1 - y;
          // y に新しい人が来た・x は前から待っている人で、x の動物が ずらされている（2 引数の animalFor と違う）
          if (c[y] !== null && c[y] !== prev[y] && c[x] !== null && c[x] === prev[x] && nm[x] !== base[ord110.indexOf(c[x])]) scene++;
        }
        prev = c;
      }
      check(`110 面：ずらされた動物が見えている間に新しい人が来る場面が ${scene} 回あり、2 人いる ${both110} 局面のどれも動物が違う（同じ ${dup110.length}）`, scene > 0 && both110 > 5 && dup110.length === 0, dup110.slice(0, 8));
      // 演出を飛ばしても、各局面の動物は演出つきのときと同じ（並べ直しで注文の順を作り直さない・待っている人の動物を決め直さない。IB-08）
      await page.evaluate(() => window.IrobinGame.setLevel(110)); await wait(page, 100);
      const fast = [await names()];
      for (let k = 0; sol110 && k < sol110.length - 1; k++) { await playMoves(page, [sol110[k]]); fast.push(await names()); }
      const diffF = fast.map((x, k) => (J(x) === J(slow[k]) ? null : `${k} 手：${x}／${slow[k]}`)).filter(Boolean);
      check(`110 面：演出を飛ばしても、各局面の動物は演出つきのときと同じ（ちがう ${diffF.length}）`, slow.length > 5 && fast.length === slow.length && diffF.length === 0, diffF.slice(0, 5));
      // 1手もどすで面の最初まで戻っても、各局面の動物は演出つきのときと同じ（面の中で一度見せた動物を覚えている）・同じ動物は並ばない
      const dupU = [], diffU = [];
      for (let k = fast.length - 2; k >= 0; k--) {
        await page.click('#undoBtn', { force: true }); await wait(page, 60);
        const x = await names();
        if (x[0] && x[1] && x[0] === x[1]) dupU.push(`${k} 手：${x[0]}`);
        if (J(x) !== J(slow[k])) diffU.push(`${k} 手：${x}／${slow[k]}`);
      }
      check(`110 面：1手もどすで面の最初まで戻っても、各局面の動物は演出つきのときと同じ（ちがう ${diffU.length}）・同じ動物が並ばない（同じ ${dupU.length}）`, diffU.length === 0 && dupU.length === 0 && (await gs(page)).moves === 0, { diffU: diffU.slice(0, 5), dupU: dupU.slice(0, 5) });
      await ctx.close();
    },
  },
  // ================= v40 =================
  {
    id: 'BW31', tier: 'smoke', title: 'いろびん v40（IB-33・IB-31）：1 面（「1ぽんに 4つ」が折れない）と 5 面（はじめての布）・6 面（短い布の文）の最初のヒント、クリアのカードの動物の列（.served）・ボタンの順と間隔（12px 以上）・共有ボタンは ★3 と節目だけ（枠だけ・押せるまで 400ms）、share は click の中で呼ばれ AbortError・InvalidStateError は黙り他の失敗は URL を見せる、share が無ければコピー（「コピーしました」→ 3 秒で戻る）、コピーもだめなら URL を選べる、知らせ（吹き出し）が出ても「つぎの めんへ」が動かず・ボタンに重ならず・押すと閉じ（成功は 3 秒で消える）、返事のない share のあとも次のカードで共有が効く、SE 縦の節目＋★3 が収まり SE 横は 2 行（上：つぎの めんへ・メニューへ、下：共有）で予告が隠れない',
    async run({ browser, check }) {
      const URL_ = 'https://harutonatu.github.io/game-no1/games/irobin/';
      const HINT1 = 'うえの どうぶつさんが ほしい いろを、1ぽんに 4つ あつめよう';
      const HINTC = 'ぬのの びんは なかが みえないよ。おきゃくさんに とどけると ぬのが とれるよ';
      const HINTCS = 'とどけると ぬのが とれるよ';
      const SHARE_SPY = () => {
        window.__shares = []; window.__clips = [];
        Object.defineProperty(Navigator.prototype, 'share', { configurable: true, writable: true, value: function (d) {
          window.__shares.push({ d, active: !!(navigator.userActivation && navigator.userActivation.isActive) });
          const m = window.__shareMode || 'ok';
          if (m === 'ok') return Promise.resolve();
          if (m === 'hang') return new Promise(() => {});
          const e = new Error('x'); e.name = m === 'abort' ? 'AbortError' : m === 'invalid' ? 'InvalidStateError' : 'NotAllowedError';
          return Promise.reject(e);
        } });
        Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => ({ writeText: (t) => { window.__clips.push(t); return Promise.resolve(); } }) });
      };
      const NOSHARE_CLIP = () => {
        window.__clips = [];
        delete Navigator.prototype.share;
        Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => ({ writeText: (t) => { window.__clips.push(t); return Promise.resolve(); } }) });
      };
      const NOSHARE_NOCLIP = () => {
        delete Navigator.prototype.share;
        Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => undefined });
      };
      const card = (p) => p.evaluate(() => {
        const c = document.querySelector('#card'), r = (e) => { const q = e.getBoundingClientRect(); return { top: q.top, bottom: q.bottom, left: q.left, right: q.right, h: q.height, w: q.width }; };
        const vis = (e) => !!e && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
        const q = (s) => c.querySelector(s);
        const btns = [...c.querySelectorAll('.btns button')].map((b) => ({ cmd: b.dataset.cmd, text: b.textContent.trim(), dis: b.getAttribute('aria-disabled') === 'true', bg: getComputedStyle(b).backgroundColor, ...r(b) }));
        const sv = q('.served'), note = q('.share-note'), nn = q('.next-note'), bn = q('.best-new');
        return {
          btns, text: c.textContent.replace(/\s+/g, ' ').trim(),
          served: sv ? { n: sv.querySelectorAll('canvas').length, label: sv.getAttribute('aria-label'), vis: vis(sv) } : null,
          note: note ? { ...r(note), text: note.textContent.trim(), fs: parseFloat(getComputedStyle(note).fontSize), vis: vis(note), h: note.getBoundingClientRect().height, url: note.querySelector('.url') ? (() => { const cs = getComputedStyle(note.querySelector('.url')); return cs.userSelect || cs.webkitUserSelect; })() : null } : null,
          next: nn && vis(nn) ? { text: nn.textContent.trim(), ...r(nn) } : null,
          best: bn && vis(bn) ? { text: bn.textContent.trim(), quiet: bn.classList.contains('quiet') } : null,
          h2: r(q('h2')), stars: vis(q('.stars')) ? r(q('.stars')) : null,
          moves: [...c.querySelectorAll('p.moves span')].filter(vis).map((s) => s.getBoundingClientRect().height),
          ov: (() => { const o = document.querySelector('#overlay'); return { sh: o.scrollHeight, ch: o.clientHeight, ih: innerHeight }; })(),
        };
      });
      const names = (p, lv, total) => p.evaluate(([lv, total]) => { const N = window.IrobinRender.ANIMAL_NAMES; return Array.from({ length: total }, (_, i) => N[window.IrobinLogic.animalFor(lv, i)]).join('、'); }, [lv, total]);
      const open1 = async (label, o = {}) => { const g = await openG(browser, label, o); const s = await gs(g.page); const { s: s1 } = await solveToClear(g.page); return { ...g, total: s.total, s1 }; };

      // (a) 1 面の最初のヒント
      const a = await openG(browser, 'BW31 a');
      const ha = await hintText(a.page);
      check(`(a) 1 面の最初のヒントが「${HINT1}」（${ha}）・「1ぽんに 4つ」は途中で折れないよう結合の印（U+2060）が入っている`, ha.replace(/\u2060/g, '') === HINT1 && ha.includes('\u2060'), ha);
      await a.ctx.close();
      // (b) 5 面（はじめての布）のヒント：ふつうの画面と SE 横（短い文）
      for (const [v, want] of [[STD_V(), HINTC], [view('SE', 'l', 'app'), HINTCS]]) {
        const b = await openG(browser, `BW31 b ${v.label}`, { v, extra: { 'irobin.best': '4' } });
        const hb = await hintText(b.page);
        const tip = await b.page.evaluate(() => document.querySelector('#board')?.dataset.clothTip);
        const sb = await gs(b.page);
        check(`(b) ${v.label}：best 4・cloth 無しで ${sb.level} 面を開くと布のヒント（${hb}）、#board[data-cloth-tip="1"]（${tip}）`, sb.level === 5 && hb === want && tip === '1', { hb, tip, level: sb.level });
        await b.ctx.close();
      }
      // (b2) 5 面より先で説明を出す面（保存が 5 面より先・cloth 無し＝6 面）は短い文だけ
      { const b2 = await openG(browser, 'BW31 b2', { extra: { 'irobin.best': '5' } });
        const hb2 = await hintText(b2.page), s2 = await gs(b2.page);
        check(`(b2) best 5・cloth 無しの ${s2.level} 面：布のヒントは「おきゃくさんに とどけると ぬのが とれるよ」だけ（${hb2}）`, s2.level === 6 && hb2 === 'おきゃくさんに とどけると ぬのが とれるよ', { hb2, level: s2.level });
        await b2.ctx.close(); }
      // (c)(d)(e)(f) 1 面を ★3 でクリア → 動物の列・ボタン・share
      const c = await open1('BW31 c', { opts: { initScript: SHARE_SPY } });
      await wait(c.page, 100);
      const k0 = await card(c.page);
      check(`(c) 出た直後：ボタンは押せない（aria-disabled）（${k0.btns.map((b) => b.dis)}）`, k0.btns.length === 4 && k0.btns.every((b) => b.dis), k0.btns);
      await wait(c.page, 500);
      const k = await card(c.page);
      const order = k.btns.map((b) => b.cmd).join();
      const gaps = k.btns.slice(1).map((b, i) => Math.round(b.top - k.btns[i].bottom)); // menu と book は同じ行（間は負）。行どうしの間だけ見る
      const want = await names(c.page, 1, c.total);
      check(`(c) .served の canvas が注文の数（${k.served && k.served.n}/${c.total}）、aria-label が「とどけた おきゃくさん：${want}」（${k.served && k.served.label}）、見えている`, !!k.served && k.served.n === c.total && k.served.label === `とどけた おきゃくさん：${want}` && k.served.vis, k.served);
      check(`(c) ボタンの順が next,menu,book,share（${order}）・文字（${k.btns.map((b) => b.text)}）、間 ${gaps}px が 12 以上、共有ボタンの背景が透明（${k.btns[3] && k.btns[3].bg}）、どれも 44px 以上、出て 500ms 後は押せる`,
        order === 'next,menu,book,share' && k.btns[0].text === 'つぎの めんへ' && k.btns[2].text === 'なかよしちょう' && k.btns[3].text === 'ともだちに おしえる' && gaps.filter((g) => g > 0).every((g) => g >= 12) && /rgba\(0, 0, 0, 0\)|transparent/.test(k.btns[3].bg) && k.btns.every((b) => b.h >= 43.5 && b.w >= 43.5 && !b.dis), k.btns);
      check('(c) ★3 の 1 面は節目でないので、予告の行も「あたらしい きろく！」も出ない（記録は「ここまで 1めん」）', !k.next && k.best && k.best.quiet && k.best.text === 'ここまで 1めん', { next: k.next, best: k.best });
      // (e) share を押す
      const topBefore = k.btns[0].top;
      await c.page.click('button.share'); await wait(c.page, 100);
      const sh = await c.page.evaluate(() => window.__shares);
      const sd = sh[0] && sh[0].d;
      const emoji = { kuma: '🐻', usagi: '🐰', neko: '🐱', penguin: '🐧', risu: '🐿️', hitsuji: '🐑' };
      const faces = await c.page.evaluate(([lv, total]) => Array.from({ length: total }, (_, i) => window.IrobinLogic.animalFor(lv, i)), [1, c.total]);
      const wantFaces = faces.map((f) => emoji[f]).join('');
      check(`(e) share が 1 回呼ばれ title「いろびん」・url が ${URL_}（? なし）（${sd && sd.url}）`, sh.length === 1 && sd.title === 'いろびん' && sd.url === URL_ && !sd.url.includes('?'), sh);
      check(`(e) text に「1めん クリア！ ★★★」・絵文字 ${wantFaces}・「（${c.s1.moves}かい）」（${sd && JSON.stringify(sd.text)}）`, !!sd && sd.text.includes('1めん クリア！ ★★★') && sd.text.includes(wantFaces) && sd.text.includes(`（${c.s1.moves}かい）`), sd);
      if (browser.browserType().name() === 'chromium') check('(e) share は click の中で呼ばれる（navigator.userActivation.isActive が true）', sh[0] && sh[0].active === true, sh);
      const s_e = await gs(c.page);
      check(`(e) share のあとも overlay は clear のまま（${s_e.overlay}）`, s_e.overlay === 'clear');
      // (f) 失敗の種類
      for (const [mode, hasUrl] of [['abort', false], ['invalid', false], ['fail', true]]) {
        await c.page.evaluate((m) => { window.__shareMode = m; }, mode);
        await c.page.click('button.share'); await wait(c.page, 100);
        const kf = await card(c.page);
        check(`(f) share が ${mode}：知らせ ${hasUrl ? 'に URL が出る' : 'は何も出ない'}（${kf.note && kf.note.text}）`, hasUrl ? !!kf.note && kf.note.text.includes(URL_) : !!kf.note && kf.note.text === '', kf.note);
      }
      // (i) 知らせが出ても「つぎの めんへ」は動かない
      const kAfter = await card(c.page);
      check(`(i) 共有の知らせが出る前（${Math.round(topBefore)}）と後（${Math.round(kAfter.btns[0].top)}）で「つぎの めんへ」の top が同じ`, Math.abs(kAfter.btns[0].top - topBefore) < 0.6, { topBefore, after: kAfter.btns[0].top });
      // (f2) 失敗の知らせは押すと閉じる
      await c.page.click('.share-note'); await wait(c.page, 50);
      const kf2 = await card(c.page);
      check(`(f2) 失敗の知らせ（URL）は押すと閉じる（${kf2.note && JSON.stringify(kf2.note.text)}）`, !!kf2.note && kf2.note.text === '', kf2.note);
      // (l) share の返事が来ないまま次の面へ進んでも、次のカードで共有が効く（sharing を戻す）
      await c.page.evaluate(() => { window.__shareMode = 'hang'; });
      await c.page.click('button.share'); await wait(c.page, 50);
      await clickCmd(c.page, 'next'); await wait(c.page, 200);
      await solveToClear(c.page); await wait(c.page, 600);
      const n0 = (await c.page.evaluate(() => window.__shares)).length;
      const hasShare = await c.page.evaluate(() => !!document.querySelector('button.share'));
      if (hasShare) { await c.page.click('button.share'); await wait(c.page, 50); }
      const n1 = (await c.page.evaluate(() => window.__shares)).length;
      check(`(l) 返事が来ない share のあと次の面のカードでも share が呼ばれる（共有ボタン ${hasShare}・${n0}→${n1}）`, hasShare && n1 === n0 + 1, { n0, n1 });
      await c.ctx.close();
      // (d) ★ なし・節目でない面（setState は目安 0 ＝ ★なし）：共有ボタンも知らせも無い
      const d = await openG(browser, 'BW31 d');
      await d.page.evaluate(() => window.IrobinGame.setState({ level: 4, params: { colors: 2, empties: 1, hidden: false, order: 'random' }, bottles: [[0, 0, 0], [0], []].map((cs) => ({ cells: cs, hidden: cs.map(() => false), sealed: false })), slots: [0], queue: [], served: 0, total: 1, moves: 0, won: false }));
      await wait(d.page, 100);
      const sol = await solutionOf(d.page);
      check('(d) 小さな面（4 面・★なし）に解がある', Array.isArray(sol) && sol.length > 0, sol);
      if (sol) {
        await playMoves(d.page, sol); await toClear(d.page); await wait(d.page, 600);
        const kd = await card(d.page);
        check(`(d) 節目でなく ★3 でもない面：共有ボタンも .share-note も無い（${kd.btns.map((b) => b.cmd)}・${kd.note}）`, kd.btns.map((b) => b.cmd).join() === 'next,menu,book' && kd.note === null, { btns: kd.btns, note: kd.note });
      }
      await d.ctx.close();
      // (g) share が無く clipboard がある
      const g = await open1('BW31 g', { opts: { initScript: NOSHARE_CLIP } });
      await wait(g.page, 600);
      await g.page.click('button.share'); await wait(g.page, 100);
      const kg = await card(g.page);
      const clip = await g.page.evaluate(() => window.__clips);
      check(`(g) コピーした文の最後の行が URL（${clip[0] && JSON.stringify(clip[0].split('\n').pop())}）・1 行目に「1めん クリア！」`, clip.length === 1 && clip[0].split('\n').pop() === URL_ && clip[0].startsWith('いろびん 1めん クリア！'), clip);
      check(`(g) ボタンの文字が「コピーしました」（${kg.btns[3].text}）、知らせが「LINE などの」で始まり 16px 以上（${kg.note && kg.note.text}・${kg.note && kg.note.fs}）`, kg.btns[3].text === 'コピーしました' && !!kg.note && kg.note.text.startsWith('LINE などの') && kg.note.fs >= 16, { btn: kg.btns[3].text, note: kg.note });
      await wait(g.page, 3100);
      const kg2 = await card(g.page);
      check(`(g) 3 秒後にボタンの文字が戻り、成功の吹き出しも同時に消える（${kg2.btns[3].text}・${JSON.stringify(kg2.note && kg2.note.text)}）`, kg2.btns[3].text === 'ともだちに おしえる' && !!kg2.note && kg2.note.text === '', { btn: kg2.btns[3].text, note: kg2.note });
      await g.ctx.close();
      // (h) clipboard も無い
      const h = await open1('BW31 h', { opts: { initScript: NOSHARE_NOCLIP } });
      await wait(h.page, 600);
      const kh0 = await card(h.page);
      await h.page.click('button.share'); await wait(h.page, 100);
      const kh = await card(h.page);
      check(`(h) 「コピーできなかったよ」と URL が出る（${kh.note && kh.note.text}）、URL の user-select が text（${kh.note && kh.note.url}）`, !!kh.note && kh.note.text.includes('コピーできなかったよ') && kh.note.text.includes(URL_) && kh.note.url === 'text', kh.note);
      check(`(i) clipboard も無い知らせでも「つぎの めんへ」の top が同じ（${Math.round(kh0.btns[0].top)}→${Math.round(kh.btns[0].top)}）`, Math.abs(kh.btns[0].top - kh0.btns[0].top) < 0.6, { a: kh0.btns[0].top, b: kh.btns[0].top });
      await h.ctx.close();
      // (j) SE 縦：5 面（節目）を ★3 でクリア。best 4 で 5 面
      const vs = view('SE', 'p', 'app');
      const jp = await openG(browser, 'BW31 j 縦', { v: vs, extra: { 'irobin.best': '4' } });
      await solveToClear(jp.page); await wait(jp.page, 600);
      const kj = await card(jp.page);
      const inside = (r) => r && r.top >= 0 && r.bottom <= vs.h + 0.5;
      check(`(j) SE 縦 5 面：h2・★・予告・4 つのボタンがスクロールなしで画面の中（予告「${kj.next && kj.next.text}」・ボタン ${kj.btns.map((b) => Math.round(b.bottom))}・scroll ${kj.ov.sh}/${kj.ov.ch}）`,
        inside(kj.h2) && inside(kj.stars) && !!kj.next && inside(kj.next) && kj.btns.length === 4 && kj.btns.every(inside) && kj.ov.sh <= kj.ov.ch + 1, kj);
      check(`(j) SE 縦：.served は見えない（${kj.served && kj.served.vis}）、p.moves の span が 1 行ずつ（高さ ${kj.moves}）`, !!kj.served && !kj.served.vis && kj.moves.length >= 1 && kj.moves.every((x) => x < 36), { served: kj.served, moves: kj.moves });
      await jp.ctx.close();
      const vl = view('SE', 'l', 'app');
      const jl = await openG(browser, 'BW31 j 横', { v: vl, extra: { 'irobin.best': '4' } });
      await solveToClear(jl.page); await wait(jl.page, 600);
      const pr = await overlayProbe(jl.page, vl.safe);
      const kl = await jl.page.evaluate(() => {
        const ov = document.querySelector('#overlay'); ov.scrollTop = ov.scrollHeight;
        const nn = document.querySelector('.next-note').getBoundingClientRect(), bt = document.querySelector('.btns').getBoundingClientRect();
        const bs = [...document.querySelectorAll('.btns button')].map((b) => { const q = b.getBoundingClientRect(); return { top: q.top, left: q.left, w: q.width, h: q.height, lines: Math.round(q.height) <= 52 && b.scrollWidth <= b.clientWidth + 1 ? 1 : 2 }; });
        return { nnBottom: nn.bottom, btnsTop: bt.top, bs, n: bs.length, min: Math.min(...bs.map((b) => b.h)) };
      });
      check(`(j) SE 横：ボタンが 2 行（1 行目 つぎの めんへ・メニューへ・なかよしちょう が横並びで、つぎの めんへ が左、2 行目 ともだちに おしえる が幅いっぱい・文字が 1 行）、行の間 12px 以上、一番下までスクロールすると予告の下端 ${Math.round(kl.nnBottom)} が .btns の上端 ${Math.round(kl.btnsTop)} より上、どのボタンも 44px 以上（${Math.round(kl.min)}）で押せる（overlayProbe ${overlayOk(pr)}）`,
        kl.n === 4 && kl.bs[0].left < kl.bs[1].left && kl.bs[1].left < kl.bs[2].left && Math.abs(kl.bs[0].top - kl.bs[1].top) < 1 && Math.abs(kl.bs[0].top - kl.bs[2].top) < 1 && kl.bs[3].top - (kl.bs[0].top + kl.bs[0].h) >= 11.5 && kl.bs[3].w > kl.bs[0].w * 1.8 && kl.bs[3].lines === 1 && kl.nnBottom <= kl.btnsTop + 0.5 && kl.min >= 43.5 && overlayOk(pr), { kl, pr });
      await jl.ctx.close();
      // (k) 共有の知らせ（吹き出し）：文＋URL（clipboard なし）でも、3 つのボタンに重ならず、画面の中に収まり、カードの左右の内側。SE 縦・SE 横・iPad 縦
      for (const vk of [view('SE', 'p', 'app'), view('SE', 'l', 'app'), view('iPad', 'p', 'app')]) {
        const kk = await openG(browser, `BW31 k ${vk.label}`, { v: vk, opts: { initScript: NOSHARE_NOCLIP }, extra: { 'irobin.best': '4' } });
        await solveToClear(kk.page); await wait(kk.page, 600);
        const k0 = await card(kk.page);
        await kk.page.click('button.share'); await wait(kk.page, 100);
        const k1 = await card(kk.page);
        const nb = k1.note, bs = k1.btns;
        const overlap = nb ? bs.filter((b) => !(nb.bottom <= b.top + 0.5 || nb.top >= b.bottom - 0.5 || nb.right <= b.left + 0.5 || nb.left >= b.right - 0.5)).map((b) => b.cmd) : ['no-note'];
        const inView = !!nb && nb.top >= 0 && nb.bottom <= vk.h + 0.5 && nb.left >= 0 && nb.right <= vk.w + 0.5;
        const cardBox = await kk.page.evaluate(() => { const q = document.querySelector('#card').getBoundingClientRect(); return { l: q.left, r: q.right }; });
        const inCard = !!nb && nb.left >= cardBox.l - 0.5 && nb.right <= cardBox.r + 0.5;
        check(`(k) ${vk.label}：知らせの吹き出し（${nb && Math.round(nb.top)}〜${nb && Math.round(nb.bottom)}）がボタンに重ならない（${overlap}）・画面の中・カードの左右の内側・16px 以上（${nb && nb.fs}）、primary の top が変わらない（${Math.round(k0.btns[0].top)}→${Math.round(k1.btns[0].top)}）、カードは 1 つのまま`,
          overlap.length === 0 && inView && inCard && nb.fs >= 16 && Math.abs(k1.btns[0].top - k0.btns[0].top) < 0.6, { nb, bs, overlap, inView, inCard, cardBox });
        await kk.ctx.close();
      }
    },
  },
  {
    id: 'BW32', tier: 'smoke', title: 'いろびん v40（IB-24）：節目（5 面ごと）だけ「あたらしい きろく！」と音 best と次の予告。節目でない面で記録が伸びたら音なしの「ここまで ○めん」。予告は 5 面「いろが ふえるよ」・10 面「12めんで かくれた いろが でるよ」・15 面は動物の名前・105 面は「つぎは 106めん」だけ。クリアのテンポ（850ms ではカードなし、出た直後は押せない）は変えない',
    async run({ browser, check }) {
      const run = async (lv, best, label, bookRaw) => {
        const g = await openG(browser, `BW32 ${label}`, { opts: { initScript: SFX_SPY }, extra: { 'irobin.best': String(best), 'irobin.save': J({ v: 3, level: lv, moves: [] }), ...(bookRaw ? { 'irobin.book': bookRaw } : {}) } });
        const s0 = await gs(g.page);
        await solveToClear(g.page); await wait(g.page, 1500);
        const info = await g.page.evaluate(() => {
          const c = document.querySelector('#card'), vis = (e) => !!e && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
          const b = c.querySelector('.best-new'), n = c.querySelector('.next-note');
          return { best: vis(b) ? b.textContent.trim() : null, quiet: !!b && b.classList.contains('quiet'), next: vis(n) ? n.textContent.trim() : null };
        });
        const pl = (await plays(g.page)).filter((x) => x.n === 'best').length;
        await g.ctx.close();
        return { lv: s0.level, ...info, best: info.best, bestSnd: pl };
      };
      let r = await run(4, 3, 'a');
      check(`(a) best 3 で 4 面：「ここまで 4めん」（.quiet）・予告なし・音 best なし（${J(r)}）`, r.lv === 4 && r.best === 'ここまで 4めん' && r.quiet && r.next === null && r.bestSnd === 0, r);
      r = await run(4, 9, 'b');
      check(`(b) best 9 で 4 面：記録の行も予告も無い（${J(r)}）`, r.best === null && r.next === null && r.bestSnd === 0, r);
      r = await run(5, 4, 'c');
      check(`(c) best 4 で 5 面：「あたらしい きろく！」・予告「つぎは 6めん。いろが ふえるよ」・音 best が 1 回（${J(r)}）`, r.lv === 5 && r.best === 'あたらしい きろく！' && !r.quiet && r.next === 'つぎは 6めん。いろが ふえるよ' && r.bestSnd === 1, r);
      r = await run(5, 9, 'd');
      check(`(d) best 9 で 5 面：予告は出る・記録の行は無い・best は鳴らない（${J(r)}）`, r.next === 'つぎは 6めん。いろが ふえるよ' && r.best === null && r.bestSnd === 0, r);
      r = await run(10, 9, 'e');
      check(`(e) best 9 で 10 面：「つぎは 11めん。12めんで かくれた いろが でるよ」（${J(r)}）`, r.lv === 10 && r.next === 'つぎは 11めん。12めんで かくれた いろが でるよ', r);
      const nm = await (async () => { const g = await openG(browser, 'BW32 nm'); const v = await g.page.evaluate(() => window.IrobinRender.ANIMAL_NAMES[window.IrobinLogic.animalFor(16, 0)]); await g.ctx.close(); return v; })();
      r = await run(15, 14, 'f');
      check(`(f) best 14 で 15 面：「つぎは 16めん。${nm}さんが まってるよ」（${J(r)}）`, r.lv === 15 && r.next === `つぎは 16めん。${nm}さんが まってるよ`, r);
      r = await run(105, 104, 'g', J({ v: 1, a: { kuma: 200, usagi: 200, neko: 200, penguin: 200, risu: 200, hitsuji: 200 }, s: {}, last: 104 }));
      check(`(g) best 104 で 105 面・帳面が 6 匹とも 200：「つぎは 106めん」だけ（${J(r)}）`, r.lv === 105 && r.next === 'つぎは 106めん', r);
      // (h) テンポ：最後の手のあと 850ms ではまだカードが無く、出た直後のボタンは aria-disabled
      const t = await openG(browser, 'BW32 h', { extra: { 'irobin.best': '3', 'irobin.save': J({ v: 3, level: 4, moves: [] }) } });
      const sol = await solutionOf(t.page);
      await playMoves(t.page, sol.slice(0, -1));
      const [f, to] = sol[sol.length - 1];
      await t.page.evaluate(([f, to]) => { window.IrobinGame.pick(f); window.IrobinGame.pick(to); }, [f, to]);
      await wait(t.page, 850);
      const o850 = await overlayInfo(t.page);
      await toClear(t.page, 40);
      const dis = await t.page.evaluate(() => [...document.querySelectorAll('#card .btns button')].map((b) => b.getAttribute('aria-disabled')));
      await wait(t.page, 450);
      const dis2 = await t.page.evaluate(() => [...document.querySelectorAll('#card .btns button')].map((b) => b.getAttribute('aria-disabled')));
      check(`(h) 最後の手の 850ms 後はまだカードが無い（${o850.shown}）、出た直後は aria-disabled（${dis}）、400ms 後に外れる（${dis2}）`, !o850.shown && dis.length >= 2 && dis.every((x) => x === 'true') && dis2.every((x) => x === null), { o850, dis, dis2 });
      await t.ctx.close();
    },
  },
  {
    id: 'BW33', tier: 'full', title: 'いろびん v42（IB-43・IB-44）：61 面（瓶 12 本）と 40 面（11 本）が、SE 縦横のホーム画面と Safari・13 横・iPad 縦横で、瓶が 44×44 以上・#board の中・#shop／#hint／#tools／.head と重ならない・記号 12px 以上。むらさきは「つき」の記号。= と ^ キーで 12 本目。60 面のクリアで「つぎは 61めん。いろが ふえるよ」',
    async run({ browser, check }) {
      // ---- (a) 画面 ----
      const VS = [view('SE', 'p', 'app'), view('SE', 'p', 'safari'), view('SE', 'l', 'app'), view('SE', 'l', 'safari'), view('i13', 'l', 'safari'), view('iPad', 'p', 'app'), view('iPad', 'l', 'app')];
      const SEL = 'a#back, #helpBtn, #soundBtn, #board .bottle, #undoBtn, #restartBtn, .head, #shop, #board, #hint, #tools';
      for (const v of VS) {
        for (const [lv, want] of [[61, 12], [40, 11]]) {
          const { ctx, page } = await openG(browser, `BW33 ${v.label} ${lv}`, { v, extra: { 'irobin.save': J({ v: 3, level: lv, moves: [] }) } });
          const s = await gs(page);
          const r = await layoutProbe(page, SEL, v.safe, { overlapSel: '.head, #shop, #board, #hint, #tools', minSel: 'a#back, #helpBtn, #soundBtn, #board .bottle, #undoBtn, #restartBtn' });
          const m = await page.evaluate(() => {
            const bd = document.querySelector('#board').getBoundingClientRect();
            const bs = [...document.querySelectorAll('#board .bottle')].map((b) => b.getBoundingClientRect());
            const outB = bs.filter((b) => b.left < bd.left - 0.5 || b.right > bd.right + 0.5 || b.top < bd.top - 0.5 || b.bottom > bd.bottom + 0.5).length;
            const segs = [...document.querySelectorAll('#board .seg')].filter((x) => x.querySelector('.mark'));
            const hs = segs.map((x) => x.querySelector('.mark').getBoundingClientRect().height);
            const outM = segs.filter((x) => { const a = x.getBoundingClientRect(), b = x.querySelector('.mark').getBoundingClientRect(); return b.left < a.left - 0.5 || b.right > a.right + 0.5 || b.top < a.top - 0.5 || b.bottom > a.bottom + 0.5; }).length;
            return { n: bs.length, outB, minMark: hs.length ? Math.min(...hs) : 0, outM };
          });
          check(`${v.label} ${v.w}×${v.h}｜${lv} 面（瓶 ${m.n} 本）：瓶が #board の中・44×44 以上・重なりなし・記号 ${m.minMark.toFixed(1)}px（12px 以上）で段からはみ出さない・横スクロールなし`,
            s.level === lv && m.n === want && s.bottles.length === want && r.n > 0 && r.outside.length === 0 && r.overlaps.length === 0 && r.small.length === 0 && !r.hscroll && m.outB === 0 && m.minMark >= 12 && m.outM === 0, { level: s.level, ...r, ...m });
          await ctx.close();
        }
      }
      // ---- (b) むらさき・つき ----
      {
        const g = await openG(browser, 'BW33 むらさき', { extra: { 'irobin.save': J({ v: 3, level: 61, moves: [] }) } });
        const seg = await g.page.evaluate(() => { const m = [...document.querySelectorAll('#board .seg[data-color="9"] .mark')]; return { n: m.length, marks: m.map((e) => e.getAttribute('data-mark')), circles: m.filter((e) => e.querySelector('circle')).length }; });
        check(`61 面：むらさきの段 ${seg.n} 個の記号が data-mark="moon" で、予備の ● ではない`, seg.n > 0 && seg.marks.every((x) => x === 'moon') && seg.circles === 0, seg);
        // むらさきの注文が来る局面を setState で作る（61 面の最初の局面の slots を差し替える）
        const okSet = await g.page.evaluate(() => { const s = JSON.parse(JSON.stringify(window.IrobinLogic.createLevel(61).state)); s.slots = [9, 0]; return window.IrobinGame.setState(s); });
        await wait(g.page, 200);
        const cust = await g.page.evaluate(() => { for (const id of ['cust0', 'cust1']) { const e = document.getElementById(id); if (e && e.dataset.color === '9') { const m = e.querySelector('.tray .mark'); return { mark: m ? m.getAttribute('data-mark') : null, circle: !!(m && m.querySelector('circle')) }; } } return null; });
        check(`61 面：むらさきの注文のお客さんの記号が moon（setState ${okSet}・${J(cust)}）`, okSet === true && !!cust && cust.mark === 'moon' && !cust.circle, cust);
        await g.ctx.close();
      }
      // ---- (c) キー ----
      {
        const k = await openG(browser, 'BW33 キー', { extra: { 'irobin.save': J({ v: 3, level: 61, moves: [] }) }, opts: { touch: false } });
        const sel = async () => { const s = await gs(k.page); return { sel: s.selected, id: await k.page.evaluate(() => { const b = document.querySelector('#board .bottle[data-selected="1"]'); return b ? b.dataset.id : null; }) }; };
        await k.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
        await k.page.keyboard.press('='); await wait(k.page, 80);
        const a = await sel();
        await k.page.keyboard.press('Escape'); await wait(k.page, 80);
        const mid = await sel();
        await k.page.keyboard.press('^'); await wait(k.page, 80);
        const b = await sel();
        check(`61 面：= で 12 本目（置き場所 11）が選ばれ（${J(a)}）、Escape で外れ（${J(mid)}）、^ でも同じ（${J(b)}）`, a.sel === 11 && a.id === '11' && mid.sel === null && b.sel === 11 && b.id === '11', { a, mid, b });
        await k.ctx.close();
        const k2 = await openG(browser, 'BW33 キー40', { extra: { 'irobin.save': J({ v: 3, level: 40, moves: [] }) }, opts: { touch: false } });
        await k2.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
        await k2.page.keyboard.press('='); await wait(k2.page, 80);
        const c = await gs(k2.page);
        check(`40 面（11 本）で = は何もしない（selected ${c.selected}）`, c.selected === null, c.selected);
        // ---- (d) 遊び方カード ----
        await k2.page.keyboard.press('Shift+/'); await wait(k2.page, 100);
        const help = await overlayInfo(k2.page);
        check('遊び方に「= は 12ぽんめ」がある', help.shown && /= は 12ぽんめ/.test(help.text), help.text);
        await k2.ctx.close();
      }
      // ---- (e) 60 面のクリアの予告 ----
      {
        const g = await openG(browser, 'BW33 予告', { extra: { 'irobin.best': '59', 'irobin.save': J({ v: 3, level: 60, moves: [] }) } });
        const s0 = await gs(g.page);
        await solveToClear(g.page); await wait(g.page, 1500);
        const nx = await g.page.evaluate(() => { const n = document.querySelector('#card .next-note'); return n && !n.closest('[hidden]') && n.getBoundingClientRect().height > 0 ? n.textContent.trim() : null; });
        check(`best 59 で 60 面をクリア：予告「つぎは 61めん。いろが ふえるよ」（${nx}）`, s0.level === 60 && nx === 'つぎは 61めん。いろが ふえるよ', nx);
        await g.ctx.close();
      }
    },
  },
  {
    id: 'BW34', tier: 'full', title: 'いろびん v44（IB-36）：はじめての遊び方カードは短い（「？」と布は その面まで来たら・キーの説明はキーボードのときだけ）。SE の Safari 縦でも「わかった」までスクロールせずに読める',
    async run({ browser, check }) {
      const info = (p) => p.evaluate(() => {
        const ov = document.querySelector('#overlay');
        const bt = ov.querySelector('[data-cmd="close"]'); const rr = bt.getBoundingClientRect();
        const t = document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2);
        const lis = [...ov.querySelectorAll('ol.rules li')].map((e) => e.textContent);
        return { items: lis.length, text: lis.join(''), chars: (document.querySelector('#card').textContent || '').replace(/\s+/g, '').length, note: (ov.querySelector('.note') || {}).textContent || '', sh: ov.scrollHeight, ch: ov.clientHeight, btnBottom: rr.bottom, cardBottom: document.querySelector('#card').getBoundingClientRect().bottom, ih: innerHeight, hit: !!t && (t === bt || bt.contains(t)) };
      });
      // (a) はじめて：SE 縦 Safari
      const a = await openG(browser, 'BW34 はじめて', { v: view('SE', 'p', 'safari'), help: false });
      const ra = await info(a.page);
      check(`はじめて（SE 縦 Safari）：項目が 2 つ（${ra.items}）、「うえを どかすと」「ぬのの びん」が無い、カードの字が 130 字以下（${ra.chars}）、「わかった」・カードの下端が画面内（${Math.round(ra.btnBottom)}・${Math.round(ra.cardBottom)}/${ra.ih}）、「わかった」を押せる`,
        // scrollHeight が 7px 超えるのはカードの外側の下の余白で、文もボタンも全部見えている（BW16 と同じ形で見る）
        ra.items === 2 && !/うえを どかすと/.test(ra.text) && !/ぬのの びん/.test(ra.text) && ra.chars <= 130 && ra.btnBottom <= ra.ih && ra.cardBottom <= ra.ih && ra.hit, ra);
      await a.ctx.close();
      // (b) その面まで来たら増える
      const rows = async (best) => {
        const g = await openG(browser, `BW34 best ${best}`, { v: view('SE', 'p', 'app'), help: false, extra: { 'irobin.best': best } });
        const r = await info(g.page); await g.ctx.close(); return r;
      };
      const b4 = await rows('4'), b11 = await rows('11'), b39 = await rows('39');
      check(`best 4（5 面まで来た）：3 つ目に「ぬのの びん」があり「うえを どかすと」は無い（${b4.items} 項目）`, b4.items === 3 && /ぬのの びん/.test(b4.text) && !/うえを どかすと/.test(b4.text), b4);
      check(`best 11（12 面まで来た）：両方ある（${b11.items} 項目）`, b11.items === 3 && /ぬのの びん/.test(b11.text) && /うえを どかすと/.test(b11.text), b11);
      check(`best 39：3 項目（BW28 と同じ）`, b39.items === 3, b39);
      // (c) キーの説明（Chromium だけ）
      if (IS_CHROMIUM) {
        const t = await openG(browser, 'BW34 さわる', { help: false });
        const rt = await info(t.page); await t.ctx.close();
        check(`さわる画面：.note に「キー：」が無い（「${rt.note}」）`, !/キー：/.test(rt.note) && /こまったら/.test(rt.note), rt);
        const k = await openG(browser, 'BW34 キーボード', { help: false, opts: { touch: false } });
        const rk = await info(k.page); await k.ctx.close();
        check(`キーボード（touch: false）：「= は 12ぽんめ」がある`, /= は 12ぽんめ/.test(rk.note), rk);
      }
    },
  },
  {
    id: 'BW35', tier: 'full', title: 'いろびん v44（IB-45）：かぎの錠が上の段の瓶にかからない（109 面・SE 縦横の Safari・SE 縦ホーム画面・iPhone 13 縦・iPad 縦）。錠の記号は 12px 以上、iPhone 13 縦と iPad では錠の幅 26px のまま',
    async run({ browser, check }) {
      const VS = [view('SE', 'p', 'safari'), view('SE', 'l', 'safari'), view('SE', 'p', 'app'), view('i13', 'p', 'safari'), view('iPad', 'p', 'app')];
      for (const v of VS) {
        const { ctx, page } = await openG(browser, `BW35 ${v.label}`, { v, extra: { 'irobin.cloth': '1', 'irobin.small': '1', 'irobin.only': '1', 'irobin.lock': '1', 'irobin.save': J({ v: 3, level: 109, moves: [] }) } });
        const m = await page.evaluate(() => {
          const boxes = [...document.querySelectorAll('#board .lockbox')];
          const bottles = [...document.querySelectorAll('#board .bottle')];
          let worst = 0;
          for (const lb of boxes) {
            const a = lb.getBoundingClientRect(), own = lb.closest('.bottle');
            for (const b of bottles) {
              if (b === own) continue;
              const r = b.getBoundingClientRect();
              const ox = Math.min(a.right, r.right) - Math.max(a.left, r.left), oy = Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top);
              if (ox > 0.5 && oy > 0.5) worst = Math.max(worst, Math.min(ox, oy));
            }
          }
          const marks = [...document.querySelectorAll('#board .lockmark')].map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); });
          return { n: boxes.length, worst, minMark: marks.length ? Math.min(...marks) : 0, w: boxes.length ? boxes[0].getBoundingClientRect().width : 0 };
        });
        const big = v.label.startsWith('i13') || v.label.startsWith('iPad');
        check(`${v.label} ${v.w}×${v.h}｜109 面：錠 ${m.n} 個が他の瓶と重ならない（重なり ${m.worst.toFixed(1)}px）、記号 ${m.minMark.toFixed(1)}px（12px 以上）${big ? `、幅 ${m.w.toFixed(1)}px（26px のまま）` : ''}`,
          m.n >= 1 && m.worst === 0 && m.minMark >= 12 && (!big || Math.abs(m.w - 26) <= 0.5), m);
        await ctx.close();
      }
      // 101 面（かぎの最初の面。錠が上の段）：錠がお客さんの棚（#shop）にかからない
      for (const v of VS) {
        const { ctx, page } = await openG(browser, `BW35 101 ${v.label}`, { v, extra: { 'irobin.cloth': '1', 'irobin.small': '1', 'irobin.only': '1', 'irobin.lock': '1', 'irobin.save': J({ v: 3, level: 101, moves: [] }) } });
        const g = await page.evaluate(() => {
          const shop = document.querySelector('#shop').getBoundingClientRect();
          // 横向きは #shop が盤の左にある。縦横どちらでも、錠の箱と #shop の箱が重ならない（重なり幅・高さの小さい方が 0.5px 以下）
          const ls = [...document.querySelectorAll('#board .lockbox')].map((l) => l.getBoundingClientRect());
          const ov = ls.map((r) => Math.min(Math.min(r.right, shop.right) - Math.max(r.left, shop.left), Math.min(r.bottom, shop.bottom) - Math.max(r.top, shop.top)));
          return { n: ls.length, ov: ov.length ? Math.max(...ov) : null };
        });
        check(`${v.label} ${v.w}×${v.h}｜101 面：錠 ${g.n} 個が #shop（お客さんの棚）にかからない（重なり ${g.ov === null ? '-' : Math.max(0, g.ov).toFixed(1)}px）`, g.n >= 1 && g.ov <= 0.5, g);
        await ctx.close();
      }
    },
  },
  {
    id: 'BW36', tier: 'full', title: 'いろびん v45（IB-34）なかよしちょうの保存：クリアで動物の数・星・手数が残る、前から遊んでいる人も 0 から数える、開き直したクリアのカードで二重に数えない、壊れた帳面でも落ちない・新しい版の帳面を書きかえない、古いページから書き戻さない',
    async run({ browser, check, root }) {
      const f = path.join(root, 'games/irobin/logic.js');
      const L = createRequire(f)(f);
      const book = async (p) => { const raw = await stored(p, 'irobin.book'); try { return JSON.parse(raw); } catch { return raw; } };
      const sum = (a) => Object.values(a || {}).reduce((x, y) => x + y, 0);
      // クリアのカードの .served の aria-label（とどけた おきゃくさん：くま、うさぎ…）を動物の key の数にする
      const servedCounts = (p) => p.evaluate(() => {
        const lab = document.querySelector('.served')?.getAttribute('aria-label') || '';
        const names = window.IrobinRender.ANIMAL_NAMES, inv = {};
        for (const k of Object.keys(names)) inv[names[k]] = k;
        const out = {};
        for (const n of lab.replace(/^[^：]*：/, '').split('、')) { const k = inv[n]; if (k) out[k] = (out[k] || 0) + 1; }
        return out;
      });
      const cnt = (o) => J(Object.keys(o).sort().map((k) => [k, o[k]]));

      // (a) 帳面なし・best なし
      {
        const { ctx, page } = await openG(browser, 'BW36 a');
        const b0 = await stored(page, 'irobin.book');
        const total = (await gs(page)).total;
        await solveToClear(page);
        const st = await gs(page);
        const per = await servedCounts(page);
        const stars = await page.evaluate(() => { const e = document.querySelector('.stars'); return e && !e.hidden ? Number(e.dataset.stars) : 0; });
        const bk = await book(page);
        const rec = bk && bk.s && bk.s['1'];
        check(`(a) 開いただけでは irobin.book は null（${b0}）、1 面を解くと a の合計 ${sum(bk && bk.a)} = 注文の数 ${total}・動物ごとにクリアのカードの並びと同じ（${bk && cnt(bk.a || {})}／${cnt(per)}）・s["1"] = [★${stars}, ${st.moves}手]（${J(rec)}）・last 1（${bk && bk.last}）`,
          b0 === null && !!bk && bk.v === 1 && sum(bk.a) === total && total > 0 && cnt(bk.a) === cnt(per) && stars >= 1 && J(rec) === J([stars, st.moves]) && bk.last === 1, { b0, total, per, stars, moves: st.moves, bk });
        await ctx.close();
      }

      // (b) 0 から：best 60・save 61 面・帳面なし
      {
        const raw = L.makeSave(61, []);
        const { ctx, page } = await openG(browser, 'BW36 b', { extra: { 'irobin.best': '60', 'irobin.save': raw } });
        const b0 = await stored(page, 'irobin.book');
        const dress = await page.evaluate(() => [...document.querySelectorAll('#shop .customer')].map((e) => e.dataset.dress));
        const total = (await gs(page)).total;
        await solveToClear(page);
        const bk = await book(page);
        check(`(b) 前から遊んでいる人（best 60・61 面）も帳面は null のまま（${b0}）・お客さんの data-dress がみな 0（${J(dress)}）・61 面を解くと a の合計 ${sum(bk && bk.a)} = 61 面の注文の数 ${total}（1〜60 面の分は入らない）・last 61`,
          b0 === null && dress.length >= 1 && dress.every((d) => d === '0') && !!bk && sum(bk.a) === total && total > 0 && bk.last === 61, { b0, dress, total, bk });
        await ctx.close();
      }

      // (c) 開き直し：3 面の最後の手まで保存。last が 3 なら数えない・2 なら 1 回だけ数える
      {
        const raw = L.makeSave(3, L.createLevel(3).info.solutionIds.map((m) => [m[0], m[1]]));
        const total3 = L.createLevel(3).state.total;
        const b3 = J({ v: 1, a: { kuma: 5 }, s: {}, last: 3 });
        const x = await openG(browser, 'BW36 c last 3', { extra: { 'irobin.best': '2', 'irobin.save': raw, 'irobin.book': b3 } });
        const s1 = await toClear(x.page);
        const k1 = await book(x.page);
        check(`(c) 帳面の last が 3 で開く → 3 面のクリアのカード（${s1.overlay}）・a は変わらない（${k1 && J(k1.a)}）・last 3`, s1.overlay === 'clear' && s1.level === 3 && !!k1 && J(k1.a) === J({ kuma: 5 }) && k1.last === 3, { s1, k1 });
        await x.ctx.close();
        const b2 = J({ v: 1, a: { kuma: 5 }, s: {}, last: 2 });
        const y = await openG(browser, 'BW36 c last 2', { extra: { 'irobin.best': '2', 'irobin.save': raw, 'irobin.book': b2 } });
        const s2 = await toClear(y.page);
        const k2 = await book(y.page);
        const added = sum(k2 && k2.a) - 5;
        const ok1 = s2.overlay === 'clear' && !!k2 && added > 0 && k2.last === 3 && total3 > 0 && added === total3;
        await y.page.reload(); await wait(y.page, 300);
        const k3 = await book(y.page);
        const s3 = await gs(y.page);
        check(`(c) last が 2 で開く → a の合計が 3 面の注文の数だけ増える（+${added}）・last 3 → もう一度開き直しても増えない（${sum(k3 && k3.a) - 5}）`,
          ok1 && !!k3 && sum(k3.a) === sum(k2.a), { s2, k2, k3, s3, total3 });
        await y.ctx.close();
      }

      // (d) 壊れた帳面・混ざった帳面（BL26 (d) と同じ文字）
      {
        const mixed = '{"v":1,"a":{"kuma":-5,"neko":1.5,"dog":3,"usagi":12,"risu":2e9},"s":{"0":[3,5],"x":[1,1],"7":[4,9],"8":[2,10],"9":[1,0],"010":[1,3]},"last":-1}';
        const rows = [];
        for (const [name, raw] of [['{', '{'], ['[]', '[]'], ['混ざった', mixed]]) {
          const { ctx, page } = await openG(browser, `BW36 d ${name}`, { extra: { 'irobin.book': raw } });
          const total = (await gs(page)).total;
          const s = (await solveToClear(page)).s;
          const bk = await book(page);
          const ov = await overlayInfo(page);
          rows.push({ name, ov: s.overlay, shown: ov.shown, bk, total });
          await ctx.close();
        }
        const bad = rows.filter((r) => !(r.ov === 'clear' && r.shown && r.bk && typeof r.bk === 'object' && r.bk.v === 1 && r.bk.last === 1 && sum(r.bk.a) >= r.total && J(r.bk.s['1'] || null) !== 'null'));
        const m = rows[2].bk;
        const okMixed = !!m && m.a.usagi >= 12 && sum(m.a) === 12 + rows[2].total && !('dog' in m.a) && Object.values(m.a).every((n) => n <= 12 + rows[2].total) && J(m.s['8']) === J([2, 10]) && !('7' in m.s) && !('9' in m.s);
        const okBroken = [0, 1].every((i) => sum(rows[i].bk && rows[i].bk.a) === rows[i].total);
        check(`(d) 壊れた帳面 '{'・'[]' と混ざった帳面で、クリアのカードが出る（コンソールエラー 0 は流れの確認）・壊れた帳面は 1 面の分の正しい帳面に書きかわる（${okBroken}）・混ざった帳面は usagi 12 が残り（＋届けた分）、使えない値は捨てて 8 面の [2,10] は残る（${okMixed}）`,
          bad.length === 0 && okBroken && okMixed, rows);
      }

      // (e) 新しい版の帳面は書きかえない
      {
        const raw = '{"v":2,"a":{"kuma":50}}';
        const { ctx, page } = await openG(browser, 'BW36 e', { extra: { 'irobin.book': raw } });
        const s = (await solveToClear(page)).s;
        const after = await stored(page, 'irobin.book');
        check(`(e) v:2 の帳面で 1 面を解いても irobin.book の文字が同じ（${after}）・クリアのカードは出る（${s.overlay}）`, after === raw && s.overlay === 'clear', { after, overlay: s.overlay });
        await ctx.close();
      }

      // (f) X-20：古いページから書き戻さない
      {
        const raw = J({ v: 1, a: { kuma: 5 }, s: { 1: [2, 9] }, last: 1 });
        const { ctx, page } = await openG(browser, 'BW36 f', { extra: { 'irobin.book': raw } });
        await x20Hidden(page, true); await wait(page, 50);
        const p2 = await ctx.newPage();
        await p2.goto(BASE + 'manifest.webmanifest');
        await p2.evaluate((r) => localStorage.setItem('irobin.save', r), J({ v: 3, level: 7, moves: [] }));
        await p2.close();
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
        const kept = await stored(page, 'irobin.book');
        const nav = page.waitForEvent('load', { timeout: 5000 }).then(() => true, () => false);
        await x20Hidden(page, false);
        const reloaded = await nav; await wait(page, 300);
        const s = await gs(page);
        const after = await stored(page, 'irobin.book');
        check(`(f) 裏にいる間に別のページが irobin.save を 7 面にして、pagehide でも irobin.book の文字が変わらない（${kept === raw}）・表に戻ると開き直して 7 面（${reloaded}・level ${s.level}）・帳面の文字は前と同じ（${after === raw}）`,
          kept === raw && reloaded && s.level === 7 && after === raw, { kept, reloaded, level: s.level, after });
        await ctx.close();
      }

      // (f2) X-20：裏にいる間に別のページが irobin.save を書きかえたあと、裏のまま最後の手を指してクリアさせても、irobin.book の文字が変わらない
      {
        const raw = J({ v: 1, a: { kuma: 5 }, s: { 1: [2, 9] }, last: 1 });
        const { ctx, page } = await openG(browser, 'BW36 f2', { extra: { 'irobin.book': raw } });
        const sol = await solutionOf(page);
        await playMoves(page, sol.slice(0, -1));
        // 最後の手を指す（演出が終わる前＝クリアの処理はまだ）→ 裏へ回り、別のページが保存を書きかえ、裏のまま演出を終わらせる
        const last = sol[sol.length - 1];
        await page.evaluate(([f, t]) => { window.IrobinGame.pick(f); window.IrobinGame.pick(t); }, last);
        await x20Hidden(page, true); await wait(page, 50);
        const p2 = await ctx.newPage();
        await p2.goto(BASE + 'manifest.webmanifest');
        await p2.evaluate((r) => localStorage.setItem('irobin.save', r), J({ v: 3, level: 7, moves: [] }));
        await p2.close();
        await page.waitForTimeout(200);
        await page.evaluate(() => window.IrobinGame.skip());
        await wait(page, 300);
        const st = await gs(page);   // 裏にいる間はカードを出さない。クリアの局面（won・phase clear）まで進んだことを見る
        const after = await stored(page, 'irobin.book');
        check(`(f2) 裏にいる間に別のページが irobin.save を書きかえたあと、裏のまま最後の手でクリア（won ${st.won}）しても irobin.book の文字が変わらない（${after === raw}）`,
          st.won === true && after === raw, { won: st.won, phase: st.phase, after });
        await ctx.close();
      }

      // (g) 書く順：クリアでは irobin.book を irobin.save（次の面へ）より先に書く。setState の局面のクリアでは irobin.book を書かない
      {
        const SET_SPY = () => {
          window.__setKeys = [];
          const o = Storage.prototype.setItem;
          Storage.prototype.setItem = function (k, v) { try { window.__setKeys.push(String(k)); } catch (e) { /* 無視 */ } return o.call(this, k, v); };
        };
        const keys = (p) => p.evaluate(() => window.__setKeys.slice());
        const a = await openG(browser, 'BW36 g1', { opts: { initScript: SET_SPY } });
        const sol = await solutionOf(a.page);
        await playMoves(a.page, sol.slice(0, -1));
        await a.page.evaluate(() => { window.__setKeys.length = 0; });
        await a.page.evaluate(([f, t]) => { window.IrobinGame.pour(f, t); window.IrobinGame.skip(); }, sol[sol.length - 1]);
        const s1 = await toClear(a.page); await wait(a.page, 200);
        const k1 = await keys(a.page);
        const ib = k1.indexOf('irobin.book'), is = k1.lastIndexOf('irobin.save');
        check(`(g) クリアの書き込みの順：irobin.book（${ib}）が最後の irobin.save（${is}）より先・book は 1 回（${k1.filter((k) => k === 'irobin.book').length}）（${J(k1)}）`,
          s1.overlay === 'clear' && ib >= 0 && is > ib && k1.filter((k) => k === 'irobin.book').length === 1, { k1, overlay: s1.overlay });
        await a.ctx.close();
        const b = await openG(browser, 'BW36 g2', { opts: { initScript: SET_SPY } });
        const okSet = await b.page.evaluate(() => window.IrobinGame.setState({ level: 4, params: { colors: 2, empties: 1, hidden: false, order: 'random' }, bottles: [[0, 0, 0], [0], []].map((cs) => ({ cells: cs, hidden: cs.map(() => false), sealed: false })), slots: [0], queue: [], served: 0, total: 1, moves: 0, won: false }));
        const sol2 = await solutionOf(b.page);
        await playMoves(b.page, sol2);
        const s2 = await toClear(b.page); await wait(b.page, 200);
        const k2 = await keys(b.page);
        const bk = await stored(b.page, 'irobin.book');
        check(`(g) setState の局面（${okSet}）でクリア（${s2.overlay}）しても irobin.book を書かない（書いた鍵 ${J(k2)}・保存 ${bk}）`,
          okSet === true && s2.overlay === 'clear' && !k2.includes('irobin.book') && bk === null, { k2, bk });
        await b.ctx.close();
      }
    },
  },
  {
    id: 'BW37', tier: 'full', title: 'いろびん v45（IB-34・IB-41・IB-42）：段が上がった面のクリアのカードに一言と音 best 1 回、お店の動物が 動物ごとの おしゃれを付けて来る（data-dress・絵が段ごとに変わる）、なかよしちょうのカード（6 匹・数・あと ○にん・★の合計）が SE 縦横のホーム画面と Safari で押せてはみ出さない、もどるでクリアのカードへ戻る、ホーム画面に追加していないときだけ一言、105 面の予告に「あと ○にんで」',
    async run({ browser, check }) {
      const KINDS = ['kuma', 'usagi', 'neko', 'penguin', 'risu', 'hitsuji'];
      const bookOf = (n, extra = {}) => J({ v: 1, a: Object.fromEntries(KINDS.map((k) => [k, n])), s: {}, last: 0, ...extra });
      const SAVE = (lv) => J({ v: 3, level: lv, moves: [] });
      const friendOf = (p) => p.evaluate(() => {
        const f = document.querySelector('#card .friend');
        const vis = !!f && !f.closest('[hidden]') && getComputedStyle(f).display !== 'none' && f.getBoundingClientRect().height > 0;
        const nw = f ? [...f.querySelectorAll('span.nw')].map((e) => ({ t: e.textContent, ws: getComputedStyle(e).whiteSpace })) : [];
        return { vis, text: f ? f.textContent.trim() : null, nw };
      });
      const bestPlays = async (p) => (await plays(p)).filter((x) => x.n === 'best').length;
      // 1〜20 面で、注文に kuma がいて節目（5 の倍数）でない面
      const probe = await openG(browser, 'BW37 探す');
      const kumaLv = await probe.page.evaluate(() => {
        const L = window.IrobinLogic;
        for (let n = 1; n <= 20; n++) {
          if (n % 5 === 0) continue;
          const total = L.createLevel(n).state.total;
          for (let i = 0; i < total; i++) if (L.animalFor(n, i) === 'kuma') return n;
        }
        return 0;
      });
      await probe.ctx.close();

      // (a) 段が上がった面の一言と音
      {
        const up = async (label, kuma, extraWant) => {
          const g = await openG(browser, `BW37 a ${label}`, { opts: { initScript: SFX_SPY }, extra: { 'irobin.best': '30', 'irobin.save': SAVE(kumaLv), 'irobin.book': J({ v: 1, a: { kuma }, s: {}, last: 0 }) } });
          await solveToClear(g.page); await wait(g.page, 1500);
          const fr = await friendOf(g.page), n = await bestPlays(g.page);
          await g.ctx.close();
          return { fr, n };
        };
        const r1 = await up('9', 9);
        check(`(a) 帳面の kuma 9 で ${kumaLv} 面を解く：.friend が「くまさんが ちょうネクタイを つけたよ！」（${J(r1.fr)}）・音 best が 1 回（${r1.n}）`,
          kumaLv > 0 && r1.fr.vis && r1.fr.text === 'くまさんが ちょうネクタイを つけたよ！' && r1.n === 1, r1);
        const r2 = await up('49', 49);
        check(`(a) kuma 49：「くまさんが むぎわらぼうしを つけたよ！」（${J(r2.fr)}）・音 best が 1 回（${r2.n}）`,
          r2.fr.vis && r2.fr.text === 'くまさんが むぎわらぼうしを つけたよ！' && r2.n === 1, r2);
        check(`(a) おしゃれの名前は white-space: nowrap の span に入っている（${J(r1.fr.nw)}・${J(r2.fr.nw)}）`,
          r1.fr.nw.length === 1 && r1.fr.nw[0].t === 'ちょうネクタイ' && r1.fr.nw[0].ws === 'nowrap' && r2.fr.nw.length === 1 && r2.fr.nw[0].t === 'むぎわらぼうし' && r2.fr.nw[0].ws === 'nowrap', { a: r1.fr.nw, b: r2.fr.nw });
        {
          const g2 = await openG(browser, 'BW37 a 2 匹', { opts: { initScript: SFX_SPY }, extra: { 'irobin.best': '30', 'irobin.save': SAVE(kumaLv), 'irobin.book': J({ v: 1, a: Object.fromEntries(KINDS.map((k) => [k, 9])), s: {}, last: 0 }) } });
          await solveToClear(g2.page); await wait(g2.page, 1500);
          const fr = await friendOf(g2.page);
          const names = await g2.page.evaluate(() => { const lab = document.querySelector('.served')?.getAttribute('aria-label') || ''; return [...new Set(lab.replace(/^[^：]*：/, '').split('、'))]; });
          const want = `${names.map((n) => n + 'さん').join('・')}が おしゃれを したよ！`;
          check(`(a) 2 匹以上が段を上げたら「○さん・△さんが おしゃれを したよ！」（${J(fr.text)}／期待 ${want}）・「なかよしに」「くるよ」は使わない`,
            names.length >= 2 && fr.vis && fr.text === want && !/なかよしに|くるよ/.test(fr.text), { fr, names });
          await g2.ctx.close();
        }
        const g = await openG(browser, 'BW37 a 上がらない', { opts: { initScript: SFX_SPY }, extra: { 'irobin.best': '30' } });
        await solveToClear(g.page); await wait(g.page, 1500);
        const fr = await friendOf(g.page), n = await bestPlays(g.page);
        check(`(a) 帳面なしの 1 面（段が上がらない）：.friend は隠れている（${J(fr)}）・音 best なし（${n}）`, !fr.vis && n === 0, { fr, n });
        await g.ctx.close();
      }

      // (b) お店の動物の data-dress
      for (const [n, want] of [[50, '2'], [200, '3'], [1000, '3']]) {
        const { ctx, page } = await openG(browser, `BW37 b ${n}`, { extra: { 'irobin.book': bookOf(n) } });
        const dress = await page.evaluate(() => [...document.querySelectorAll('#shop .customer')].map((e) => e.dataset.dress));
        check(`(b) 帳面の 6 匹が ${n}：#shop .customer の data-dress がみな ${want}（${J(dress)}）`, dress.length >= 1 && dress.every((d) => d === want), dress);
        await ctx.close();
      }

      // (c) なかよしちょうのカード（クリアのカードを出してから帳面を差し替え、保存から読み直させる）
      const bookCard = async (page) => page.evaluate(() => {
        const c = document.querySelector('#card'), r = c.getBoundingClientRect();
        const vis = (e) => !!e && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
        const back = c.querySelector('[data-cmd="bookClose"]'), bq = back ? back.getBoundingClientRect() : null;
        const rows = [...c.querySelectorAll('ul.book li')].map((li) => ({ kind: li.dataset.kind, cnt: li.querySelector('.cnt')?.textContent.trim(), left: li.querySelector('.left')?.textContent.trim() }));
        const st = c.querySelector('.book-stars');
        return {
          rows, stars: st && vis(st) ? st.textContent.trim() : null, card: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
          back: bq ? { top: bq.top, bottom: bq.bottom, w: bq.width, h: bq.height } : null, ih: innerHeight, iw: innerWidth,
        };
      });
      const toBook = async (v, raw, label, opts = {}) => {
        const g = await openG(browser, `BW37 ${label}`, { v, ...opts });
        await solveToClear(g.page); await wait(g.page, 700);
        await g.page.evaluate((r) => localStorage.setItem('irobin.book', r), raw);
        await clickCmd(g.page, 'book'); await wait(g.page, 600);   // カードが出る動き（拡大）が終わるのを待つ
        return g;
      };
      const stars3 = { 1: [3, 20] };
      for (const v of [view('SE', 'p', 'app'), view('SE', 'p', 'safari'), view('SE', 'l', 'app'), view('SE', 'l', 'safari')]) {
        const g = await toBook(v, J({ v: 1, a: { kuma: 50 }, s: stars3, last: 1 }), `c ${v.label}`);
        const st = await gs(g.page);
        const bc = await bookCard(g.page);
        const kuma = bc.rows.find((r) => r.kind === 'kuma') || {}, usagi = bc.rows.find((r) => r.kind === 'usagi') || {};
        const [, , sb, ] = v.safe || [0, 0, 0, 0];
        // 低い画面ではカードがはみ出して重なるのを、ボタンを上端に貼り付けて（sticky）押せるようにしている。一番下までスクロールすれば最後の行がボタンの上に出る
        const end = await g.page.evaluate(() => { const ov = document.querySelector('#overlay'); ov.scrollTop = ov.scrollHeight; const li = [...document.querySelectorAll('#card ul.book li')].pop().getBoundingClientRect(), b = document.querySelector('#card [data-cmd="bookClose"]').getBoundingClientRect(); ov.scrollTop = 0; return { liBottom: li.bottom, btnTop: b.top }; });
        const pr = await overlayProbe(g.page, v.safe);
        check(`(c) ${v.label}：overlay は book（${st.overlay}）・行が 6 つ（${bc.rows.length}）・くま「${kuma.cnt}」「${kuma.left}」・うさぎ「${usagi.cnt}」「${usagi.left}」・★の合計の行（${bc.stars}）`,
          st.overlay === 'book' && bc.rows.length === 6 && kuma.cnt === '50にん' && kuma.left === 'あと 150にんで きんの メダル' && usagi.cnt === '0にん' && usagi.left === 'あと 10にんで にんじんの バッジ' && /^あつめた ★ \d+こ$/.test(bc.stars || ''), { st: st.overlay, bc });
        check(`(c) ${v.label}：「もどる」がスクロールなしで押せる（${bc.back && Math.round(bc.back.bottom)}/${bc.ih}）・44px 以上（${bc.back && Math.round(bc.back.h)}）・カードは左右が画面の中で上が画面の中、はみ出す分は一番下までスクロールすれば最後の行がボタンの上に出る（${Math.round(end.liBottom)}≦${Math.round(end.btnTop)}）・横スクロールなし（overlayProbe ${overlayOk(pr)}）`,
          !!bc.back && bc.back.top >= 0 && bc.back.bottom <= bc.ih - sb + 0.5 && bc.back.h >= 43.5 && bc.back.w >= 43.5 && bc.card.top >= -0.5 && bc.card.left >= -0.5 && bc.card.right <= bc.iw + 0.5 && end.liBottom <= end.btnTop + 0.5 && overlayOk(pr), { bc, pr, end });
        await g.ctx.close();
      }
      { const g = await toBook(STD_V(), bookOf(200, { s: stars3, last: 1 }), 'c 200');
        const bc = await bookCard(g.page);
        check(`(c) 6 匹とも 200：6 行とも「ぜんぶ そろったよ」（${J(bc.rows.map((r) => r.left))}）`, bc.rows.length === 6 && bc.rows.every((r) => r.left === 'ぜんぶ そろったよ'), bc.rows);
        await g.ctx.close(); }

      // (d) もどる・Escape でクリアのカードへ。開く・閉じるの直後 300ms は押せない（すぐは押せない）
      {
        const g = await openG(browser, 'BW37 d', { opts: { initScript: SFX_SPY } });
        await solveToClear(g.page); await wait(g.page, 1500);
        const n0 = await bestPlays(g.page);
        const dis = () => g.page.evaluate(() => [...document.querySelectorAll('#card .btns button')].map((b) => b.getAttribute('aria-disabled')));
        await clickCmd(g.page, 'book'); await wait(g.page, 100);
        const s1 = await gs(g.page);
        await clickCmd(g.page, 'bookClose'); await wait(g.page, 50);   // 開いた直後（150ms 後）は押せない
        const s1b = await gs(g.page);
        await wait(g.page, 300);
        await clickCmd(g.page, 'bookClose'); await wait(g.page, 50);   // 300ms 後は押せる
        const s2 = await gs(g.page), d2 = await dis();
        await clickCmd(g.page, 'book'); await wait(g.page, 100);       // 閉じた直後は、高さの変わったカードのボタン（なかよしちょう）も押せない
        const s2b = await gs(g.page);
        await wait(g.page, 300);
        await clickCmd(g.page, 'book'); await wait(g.page, 150);
        const s2c = await gs(g.page);
        await wait(g.page, 300);
        await g.page.keyboard.press('Escape'); await wait(g.page, 100);
        const s3 = await gs(g.page), d3 = await dis();
        const n1 = await bestPlays(g.page);
        check(`(d) book（${s1.overlay}）→ すぐ もどる は効かない（${s1b.overlay}）→ 300ms 後に もどる → clear（${s2.overlay}）・押せる（aria-disabled ${J(d2)}）→ 閉じた直後の なかよしちょう は効かない（${s2b.overlay}）→ 300ms 後は開く（${s2c.overlay}）→ Escape → clear（${s3.overlay}・${J(d3)}）、音 best が増えない（${n0}→${n1}）`,
          s1.overlay === 'book' && s1b.overlay === 'book' && s2.overlay === 'clear' && s2b.overlay === 'clear' && s2c.overlay === 'book' && s3.overlay === 'clear' && d2.length >= 3 && d2.every((x) => x === null) && d3.every((x) => x === null) && n1 === n0, { s1, s1b, s2, s2b, s2c, s3, d2, d3, n0, n1 });
        await g.ctx.close();
      }

      // (e) IB-41：ホーム画面に追加していないときだけ一言
      {
        const homeOf = (p) => p.evaluate(() => { const e = document.querySelector('#card .book-home'); return { has: !!e, vis: !!e && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0, text: e ? e.textContent.trim() : null }; });
        const a = await toBook(view('i13', 'p', 'safari'), bookOf(0), 'e 通常');
        const ha = await homeOf(a.page); await a.ctx.close();
        const STANDALONE = () => { Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true }); };
        const b = await toBook(view('i13', 'p', 'safari'), bookOf(0), 'e standalone', { opts: { initScript: STANDALONE } });
        const hb = await homeOf(b.page); await b.ctx.close();
        check(`(e) ふつうの開き方では「ホーム画面に ついかすると」が見える（${J(ha)}）、navigator.standalone = true では見えない（${J(hb)}）`,
          ha.vis && ha.text.includes('ホーム画面に ついかすると') && !hb.vis, { ha, hb });
      }

      // (f) 帳面が v:2 でも なかよしちょうは落ちずに開く・クリアのカードに一言も「あと ○にん」も出ない
      {
        const g = await openG(browser, 'BW37 f', { extra: { 'irobin.book': '{"v":2,"a":{"kuma":50}}' } });
        await solveToClear(g.page); await wait(g.page, 700);
        const fr = await friendOf(g.page);
        await clickCmd(g.page, 'book'); await wait(g.page, 150);
        const st = await gs(g.page), bc = await bookCard(g.page);
        check(`(f) 帳面が v:2：なかよしちょうが開く（${st.overlay}）・6 行ともの数が 0（${J(bc.rows.map((r) => r.cnt))}）・クリアのカードに一言は出ない（${J(fr)}）`, st.overlay === 'book' && bc.rows.length === 6 && bc.rows.every((r) => r.cnt === '0にん') && !fr.vis, { st: st.overlay, rows: bc.rows, fr });
        await g.ctx.close();
        const h = await openG(browser, 'BW37 f 105', { extra: { 'irobin.best': '104', 'irobin.save': SAVE(105), 'irobin.book': '{"v":2,"a":{"kuma":195}}' } });
        await solveToClear(h.page); await wait(h.page, 1500);
        const next = await h.page.evaluate(() => { const n = document.querySelector('#card .next-note'); return n && !n.closest('[hidden]') && n.getBoundingClientRect().height > 0 ? n.textContent.trim() : null; });
        check(`(f) 帳面が v:2 で 105 面：予告は「つぎは 106めん」だけで「あと ○にん」は出ない（${next}）`, next === 'つぎは 106めん', next);
        await h.ctx.close();
      }

      // (g) 105 面の予告
      {
        const g = await openG(browser, 'BW37 g', { extra: { 'irobin.best': '104', 'irobin.save': SAVE(105), 'irobin.book': J({ v: 1, a: { kuma: 195, usagi: 200, neko: 200, penguin: 200, risu: 200, hitsuji: 200 }, s: {}, last: 104 }) } });
        await solveToClear(g.page); await wait(g.page, 1500);
        const next = await g.page.evaluate(() => { const n = document.querySelector('#card .next-note'); return n && !n.closest('[hidden]') && n.getBoundingClientRect().height > 0 ? n.textContent.trim() : null; });
        check(`(g) best 104・kuma 195・ほか 200 で 105 面：予告が「つぎは 106めん。くまさん あと 4にんで きんの メダル」（${next}）`, next === 'つぎは 106めん。くまさん あと 4にんで きんの メダル', next);
        await g.ctx.close();
      }

      // (h) 絵：6 匹 × 段 0〜3 が毎回変わる・範囲外の段・おしゃれの名前
      {
        const g = await openG(browser, 'BW37 h');
        const r = await g.page.evaluate(() => {
          const R = window.IrobinRender;
          const draw = (k, d) => { const cv = document.createElement('canvas'); cv.width = 112; cv.height = 120; R.drawAnimal(cv.getContext('2d'), k, { w: 112, h: 120, mood: 'happy', dress: d }); return cv.toDataURL(); };
          const out = {};
          for (const k of R.ANIMALS) {
            const u = [0, 1, 2, 3].map((d) => draw(k, d));
            out[k] = { chg: [1, 2, 3].map((i) => u[i] !== u[i - 1]), over: draw(k, 4) === u[3], str: draw(k, 'x') === u[0], neg: draw(k, -1) === u[0] };
          }
          const items = R.DRESS_ITEMS, names = R.ANIMALS.flatMap((k) => (items[k] || []).map((x) => x[0]));
          return { out, kinds: R.ANIMALS.length, shape: R.ANIMALS.map((k) => (items[k] || []).length), names: names.length, uniq: new Set(names).size };
        });
        const bad = Object.entries(r.out).filter(([, o]) => !o.chg.every(Boolean) || !o.over || !o.str || !o.neg).map(([k, o]) => `${k}:${J(o)}`);
        check(`(h) 6 匹 × 段 0→1→2→3 で絵が毎回変わり、段 4・'x'・-1 は 3・0・0 と同じ絵（おかしい ${bad.length}：${bad.join(' ')}）`, r.kinds === 6 && bad.length === 0, r.out);
        check(`(h) DRESS_ITEMS が 6 匹 × 3 つ（${J(r.shape)}）で、名前 ${r.names} 個がみな違う（${r.uniq}）`, r.shape.length === 6 && r.shape.every((n) => n === 3) && r.names === 18 && r.uniq === 18, r);
        await g.ctx.close();
      }
    },
  },
];
