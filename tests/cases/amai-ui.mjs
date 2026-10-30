// AW: あまいものあつめの画面（games/amai/）。契約は docs/ari-contract.md（§3 画面・§3.4 DOM・§3.6 進行とテスト用 API・§4 保存・§5 効果音と色・§7.3 テスト・§9.2 教訓）。
//   画面の DOM は契約 §3.4 だけに頼る：a#back・#helpBtn・#soundBtn・#playView[data-phase]・#level・#left・#pic・#slots .slot[data-slot/color/count/wait]・
//     #grid .col[data-col/rest]・.box.front / .box.back [data-id/color/mark/count/lid/ice]・#hint・#undoBtn・#restartBtn・#fastBtn[aria-pressed]・#bookBtn・
//     #overlay・#card・.overlay [data-cmd=next/menu/book/close/restartYes/undo/restart]
//   テスト用の公開 API（契約 §3.6）：window.AmaiGame = { getState, press, tick, settle, solution, skip, setLevel, setState, logic }
//   計算ロジックは AL（amai-logic.mjs）で確かめる。ここでは Node で読んだ logic.js（同じ root）と、画面の中の AmaiLogic を「期待値の計算機」として使う。
//   無いときに合格にしない（空振りの合格を作らない。契約 §7.1・§9.2 の 8）：AmaiGame が無ければ例外で不合格にする。探す対象（ふた・こおり・詰み）が見つからないときも不合格にする。
//   smoke：AW1〜AW4。full：AW5〜AW20（AW15 は CDP のタッチ操作なので Chromium だけ）。
//   ゲーム本体ができる前は、ほとんどの項目が不合格になる（正しい）。本体ができたら流して、契約とずれた所を本体かここで直す。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BASE, view, custom, newPage, seed, wait, frozen, layoutProbe, swInfo, sleep, touch, SFX_SPY, plays, IS_CHROMIUM, x20Run, x20Text } from '../lib.mjs';

const AM = BASE + 'games/amai/';
const SMOKE_V = () => view('SE', 'p', 'app');
const STD_V = () => view('i13', 'p', 'app');
const CDP = 'CDP のタッチ操作（連続タップ）';
const MAX16 = '9007199254740991';
const J = (x) => JSON.stringify(x);

// Node で logic.js を読む（期待値の計算機・絵の一覧）。無ければ例外
function loadLogic(root) {
  const f = path.join(root, 'games/amai/logic.js');
  if (!fs.existsSync(f)) throw new Error('games/amai/logic.js が無い');
  return createRequire(f)(f);
}

// ---------- 開く ----------
async function openG(browser, label, { v = STD_V(), opts = {}, extra = {}, help = true } = {}) {
  const { ctx, page } = await newPage(browser, v, label, { clock: true, ...opts });
  await gotoG(page, extra, { help });
  return { ctx, page };
}
// 初回だけ出る遊び方は、見たことにして始める（help: false なら出る状態で始める）
async function gotoG(page, extra = {}, { help = true } = {}) {
  await seed(page, { ...(help ? { 'amai.help': '1' } : {}), ...extra });
  await page.goto(AM); await wait(page, 300);
  const has = await page.evaluate(() => !!window.AmaiGame && typeof window.AmaiGame.getState === 'function');
  if (!has) throw new Error('window.AmaiGame.getState が無い（games/amai/main.js が読まれていないか、テスト用 API が未実装）');
}

// ---------- 読む ----------
const gs = (p) => p.evaluate(() => window.AmaiGame.getState());
const lg = (p) => p.evaluate(() => window.AmaiGame.logic());
const stored = (p, k) => p.evaluate((k) => { try { return localStorage.getItem(k); } catch { return 'ERR'; } }, k);
const phaseAttr = (p) => p.evaluate(() => document.querySelector('#playView')?.dataset.phase);
const hintText = (p) => p.evaluate(() => document.querySelector('#hint')?.textContent.trim() ?? null);
const domNums = (p) => p.evaluate(() => {
  const n = (id) => { const e = document.querySelector('#' + id); if (!e) return null; const t = e.textContent.replace(/[^\d]/g, ''); return t === '' ? null : Number(t); };
  return { level: n('level'), left: n('left') };
});
// 画面のわく・箱
const domBoard = (p) => p.evaluate(() => {
  const box = (e) => ({ id: e.dataset.id, color: e.dataset.color, mark: e.dataset.mark, count: e.dataset.count, lid: e.dataset.lid, ice: e.dataset.ice, label: e.getAttribute('aria-label') || '', text: e.textContent.replace(/\s+/g, '') });
  return {
    slots: [...document.querySelectorAll('#slots .slot')].map((e) => ({ i: Number(e.dataset.slot), color: e.dataset.color, count: e.dataset.count, wait: e.dataset.wait, sr: e.querySelector('.sr')?.textContent.trim() ?? '' })),
    // 描画は箱の要素を使い回し、箱の無い所は hidden にする（§3.8 の性能）。見えている箱だけを数える
    cols: [...document.querySelectorAll('#grid .col')].map((c) => ({ col: Number(c.dataset.col), rest: c.dataset.rest, front: [...c.querySelectorAll('.box.front')].filter((e) => !e.closest('[hidden]')).map(box), back: [...c.querySelectorAll('.box.back')].filter((e) => !e.closest('[hidden]')).map(box) })),
  };
});
// わくの数（契約：3。段 0 で 5→3。logic.js の SLOTS と同じでなければ AW1 などが不合格にする）
const SLOTS_N = 3;
// getState()（slots・cols は logic の state の写し）と画面の食い違いを文にして返す（空なら一致）
function boardDiff(st, dom) {
  const bad = [];
  if (dom.slots.length !== SLOTS_N) bad.push(`.slot が ${dom.slots.length} 個（わくは ${SLOTS_N} 個）`);
  for (let i = 0; i < SLOTS_N; i++) {
    const a = st.slots[i], d = dom.slots[i];
    if (!d) continue;
    const wantC = a ? String(a.color) : '', wantN = a ? String(a.count) : '';
    if (d.color !== wantC || d.count !== wantN) bad.push(`わく ${i}: 画面 ${d.color}/${d.count}、state ${wantC}/${wantN}`);
  }
  if (dom.cols.length !== 4) bad.push(`.col が ${dom.cols.length} 個`);
  for (let c = 0; c < 4; c++) {
    const a = st.cols[c] || [], d = dom.cols[c];
    if (!d) continue;
    if (d.rest !== String(Math.max(0, a.length - 3))) bad.push(`列 ${c}: data-rest ${d.rest}（箱 ${a.length} 個なら ${Math.max(0, a.length - 3)}）`);
    if (d.front.length !== (a.length > 0 ? 1 : 0)) bad.push(`列 ${c}: 手前の箱 ${d.front.length} 個`);
    if (d.back.length !== Math.max(0, Math.min(2, a.length - 1))) bad.push(`列 ${c}: 奥の箱 ${d.back.length} 個`);
    [...d.front, ...d.back].forEach((x, k) => {
      const b = a[k];
      if (!b) return;
      const want = b.lid ? { id: String(b.id), color: '', mark: '', count: '', lid: '1', ice: '0' }
        : { id: String(b.id), color: String(b.color), mark: x.mark, count: String(b.count), lid: '0', ice: String(Math.max(0, (b.ice || 0) - st.presses)) };
      for (const key of Object.keys(want)) if (x[key] !== want[key]) bad.push(`列 ${c}-${k}: ${key} 画面 "${x[key]}"、期待 "${want[key]}"`);
      if (!b.lid && !x.mark) bad.push(`列 ${c}-${k}: data-mark が空`);
    });
  }
  return bad;
}
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
const isDisabled = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && (e.disabled === true || e.getAttribute('aria-disabled') === 'true'); }, sel);
// 隠れる・戻る（visibilitychange を再現する）
const setHidden = (p, hidden) => p.evaluate((h) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

// ---------- 遊ぶ ----------
const solutionOf = (p) => p.evaluate(() => window.AmaiGame.solution());
const pressCol = (p, c) => p.evaluate((c) => window.AmaiGame.press(c), c);
const settleG = (p) => p.evaluate(() => window.AmaiGame.settle());
const skipG = (p) => p.evaluate(() => window.AmaiGame.skip());
const setLevel = async (p, n) => { await p.evaluate((n) => window.AmaiGame.setLevel(n), n); await wait(p, 150); };
// 解の順に「落ち着くまで進める → 押す」。n 個目まで（既定は全部）。押せなければ例外
async function playSolution(p, n = Infinity) {
  const sol = await solutionOf(p);
  if (!Array.isArray(sol) || !sol.length) throw new Error('solution() が配列でない（今の面が解けない／API が未実装／途中の面）');
  for (const c of sol.slice(0, n)) {
    await settleG(p);
    const k = await pressCol(p, c);
    if (k !== 'press') throw new Error(`solution() の列 ${c} が押せない（${k}）`);
    await skipG(p);
  }
  return sol;
}
// クリアのカードが出るまで進める
async function toClear(p, maxSteps = 80) {
  for (let i = 0; i < maxSteps; i++) {
    const s = await gs(p);
    if (s.overlay === 'clear') return s;
    await settleG(p); await skipG(p); await wait(p, 100);
  }
  return gs(p);
}
// クリアの演出中（won で、カードはまだ）まで進める。つかまえられなければ null
async function toCelebrating(p) {
  await playSolution(p);
  for (let i = 0; i < 400; i++) {
    const s = await gs(p);
    if (s.won && s.overlay === null) return s;
    if (s.overlay === 'clear') return null;
    await wait(p, 50);
  }
  return null;
}
async function solveToClear(p) {
  const sol = await playSolution(p);
  return { sol, s: await toClear(p) };
}
// 落ち着くまで、実際の時間（またはページの時計）で待つ
async function playOut(p, maxMs = 60000) {
  for (let t = 0; t < maxMs; t += 250) { const s = await gs(p); if (s.stable && !s.busy) return s; await wait(p, 250); }
  return gs(p);
}
// 「うごかせない」の局面（絵はそのままで、内側のマスだけ色 1 にして、わく全部（SLOTS 個）を色 1 の箱で埋める。色 1 は内側にしか無く、ふちに出ない）
const makeStuckState = (p) => p.evaluate(() => {
  const G = window.AmaiGame, s = G.logic();
  const { W, H } = s, cells = s.cells.slice();
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -2 : s.cells[y * W + x]);
  const inner = [], all = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (s.cells[y * W + x] < 0) continue;
    all.push(y * W + x);
    if (at(x - 1, y) >= 0 && at(x + 1, y) >= 0 && at(x, y - 1) >= 0 && at(x, y + 1) >= 0) inner.push(y * W + x);
  }
  const N = s.slots.length;   // わくの数
  if (inner.length < N) return { ok: false, why: `内側のマスが ${inner.length} 個しかない` };
  // 手直し（2026-10-30）：絵を 2×2 に割ると内側のマスが 500 個を超え、箱の持ち玉の上限 99 を越える。
  // 色 1 にするのは内側のうち わく N 個 × 50 個まで（残りの内側は色 0 のまま。まわりが全部角砂糖なので ふちには出ない）
  const k1 = Math.min(inner.length, N * 50);
  for (const i of all) cells[i] = 0;
  for (const i of inner.slice(0, k1)) cells[i] = 1;
  const base = Math.floor(k1 / N), extra = k1 % N;
  const slots = Array.from({ length: N }, (_, i) => i).map((i) => ({ id: 1 + i, color: 1, count: base + (i < extra ? 1 : 0) }));
  const outer = all.length - k1;
  const cols = [[], [], [], []]; let left = outer, id = 100;
  while (left > 0) { const n = Math.min(left, 50); cols[id % 4].push({ id: id++, color: 0, count: n, lid: false, ice: 0 }); left -= n; }
  const ns = { ...s, cells, total: all.length, left: all.length, cols, slots, won: false };
  return { ok: G.setState(ns) === true, why: 'setState が false を返した', inner: inner.length };
});
// 自然に「うごかせない」になる押し方を、画面の中の AmaiLogic で探す（決まった乱数。見つからなければ null）
const findNaturalStuck = (p) => p.evaluate(() => {
  const L = window.AmaiLogic, book = L.validateBook(null);
  let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let lv = 37; lv >= 13; lv -= 3) {
    for (let tr = 0; tr < 12; tr++) {
      let st = L.createLevel(lv, L.pickPicture(lv, book)).state; const ops = [];
      for (let k = 0; k < 120 && !st.won; k++) {
        const cols = [0, 1, 2, 3].filter((c) => L.canPress(st, c) === null);
        if (!cols.length) { const r = L.step(st); if (!r.moved) break; st = r.state; ops.push({ c: -1, n: 1 }); }
        else {
          const c = cols[Math.floor(rnd() * cols.length)];
          st = L.press(st, c).state;
          const n = Math.floor(rnd() * 3); let used = 0;
          for (let i = 0; i < n; i++) { const r = L.step(st); if (!r.moved) break; st = r.state; used++; }
          ops.push({ c, n: used });
        }
        if (L.isStuck(st)) return { lv, ops };
      }
    }
  }
  return null;
});
async function replayOps(p, found) {
  await setLevel(p, found.lv);
  for (const op of found.ops) {
    if (op.c >= 0) await pressCol(p, op.c);
    if (op.n > 0) await p.evaluate((n) => window.AmaiGame.tick(n), op.n);
  }
  await skipG(p);
}
// ms の間、解の順に箱を出し続けて（わくが空いたら次を押す）1 はこびの数を数える。実時間（clock: false のページ用）
async function driveFor(p, ms, sol) {
  const t0 = (await gs(p)).t; let idx = 0, maxAnts = 0; const end = Date.now() + ms;
  while (Date.now() < end) {
    idx = await p.evaluate(([sol, i]) => {
      const G = window.AmaiGame, s = G.getState();
      if (i < sol.length && !s.overlay && s.slots.some((x) => x === null)) return G.press(sol[i]) === 'press' ? i + 1 : i;
      return i;
    }, [sol, idx]);
    const s = await gs(p); if (s.ants > maxAnts) maxAnts = s.ants;
    await sleep(100);
  }
  const s1 = await gs(p);
  return { dt: s1.t - t0, pressed: idx, maxAnts, s1 };
}

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

export const tests = [
  // ================= smoke =================
  {
    id: 'AW1', tier: 'smoke', title: 'あまいもの：手前の箱を押すと一番左の空きわくに入り列が詰まる、.slot・.box の data-* が getState() と一致、#level・#left が hud と一致し、tick(n) で #left が減る',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'AW1', { v: SMOKE_V() });
      const api = await page.evaluate(() => ({ keys: Object.keys(window.AmaiGame).sort(), frozen: Object.isFrozen(window.AmaiGame), L: typeof window.AmaiLogic?.step }));
      const need = ['getState', 'press', 'tick', 'settle', 'solution', 'skip', 'setLevel', 'setState', 'logic'];
      check(`window.AmaiGame に ${need.join('・')} があり凍結されている、AmaiLogic が読める`, need.every((k) => api.keys.includes(k)) && api.frozen && api.L === 'function', api);
      const s0 = await gs(page), d0 = await domNums(page);
      check(`はじめ：level ${s0.level}・presses 0・t 0・phase play、#level ${d0.level}・#left ${d0.left} が state（level ${s0.level}・left ${s0.left}）と同じ`,
        s0.level === 1 && s0.presses === 0 && s0.t === 0 && s0.phase === 'play' && d0.level === s0.level && d0.left === s0.left && s0.left === s0.total, { s0, d0 });
      check(`#playView[data-phase] が getState().phase と同じ（${await phaseAttr(page)}）`, (await phaseAttr(page)) === s0.phase);
      const title = await page.evaluate(() => ({ t: document.title, h: document.getElementById('gameTitle')?.textContent.trim(), n: window.AmaiLogic.NAME }));
      check(`タイトルと見出しが AmaiLogic.NAME（${title.n}）と同じ`, title.t.includes(title.n) && title.h === title.n, title);
      const slotsLogic = await page.evaluate(() => window.AmaiLogic.SLOTS);
      check(`わくの数：AmaiLogic.SLOTS（${slotsLogic}）・state のわく（${s0.slots.length}）・画面の .slot が すべて ${SLOTS_N}`, slotsLogic === SLOTS_N && s0.slots.length === SLOTS_N && (await domBoard(page)).slots.length === SLOTS_N, { slotsLogic, st: s0.slots.length });
      const dom0 = await domBoard(page);
      const diff0 = boardDiff(s0, dom0);
      check(`押す前：わく ${SLOTS_N} つ・列 4 つの data-* が getState() と一致（食い違い ${diff0.length} 件）`, diff0.length === 0 && s0.slots.every((x) => x === null), diff0.slice(0, 4));
      const sol = await solutionOf(page);
      check('solution() が列の番号の並びを返す（1 面は解ける）', Array.isArray(sol) && sol.length > 0 && sol.every((c) => Number.isInteger(c) && c >= 0 && c <= 3), sol);
      // 1 箱押す
      const c0 = sol[0], front = s0.cols[c0][0];
      const kind = await pressCol(page, c0);
      await skipG(page); await wait(page, 50);
      const s1 = await gs(page), dom1 = await domBoard(page);
      check(`列 ${c0} の手前を押す（${kind}）：一番左のわく 0 に入り（id ${front.id}・色 ${front.color}・数 ${front.count}）、列が 1 つ詰まり、presses 1`,
        kind === 'press' && s1.slots[0] && s1.slots[0].id === front.id && s1.slots[0].color === front.color && s1.cols[c0].length === s0.cols[c0].length - 1
        && (s1.cols[c0].length === 0 || s1.cols[c0][0].id === s0.cols[c0][1].id) && s1.presses === 1, { slots: s1.slots, col: s1.cols[c0].map((b) => b.id), was: s0.cols[c0].map((b) => b.id) });
      const diff1 = boardDiff(s1, dom1);
      check(`押した後：画面の data-*（わく・手前・奥・data-rest）が getState() と一致（食い違い ${diff1.length} 件）`, diff1.length === 0, diff1.slice(0, 4));
      // 2 つめは次の空きわく（左から）
      const c1 = sol.length > 1 ? sol[1] : null;
      if (c1 !== null) {
        await settleG(page);
        const k2 = await pressCol(page, c1); await skipG(page);
        const s2 = await gs(page);
        const empties = s2.slots.map((x, i) => (x === null ? i : -1)).filter((i) => i >= 0);
        check(`2 つめを押すと、いちばん左の空きわくに入る（${k2}。空き ${empties.join(',') || 'なし'}）`, k2 === 'press' && s2.slots.filter(Boolean).length >= 1 && s2.presses === 2, s2.slots);
      }
      // 運ぶと #left が減る（画面の数は hud の値そのまま）
      // はこびの間隔が 120ms になったので、読み取りの間に 1 はこび入らないよう時計を止めて測る（v53）
      let sA = null, n = 0, sB = null, dB = null;
      await frozen(page, async () => {
        sA = await gs(page);
        n = await page.evaluate(() => window.AmaiGame.tick(3));
        await skipG(page);
        sB = await gs(page); dB = await domNums(page);
      });
      check(`tick(3) で ${n} はこび進み、#left が減る（${sA.left} → ${sB.left}）。#left ${dB.left}・#level ${dB.level} は state と同じ（表示の 1 ずれなし）`,
        n >= 1 && sB.left < sA.left && dB.left === sB.left && dB.level === sB.level && sB.left === sB.total - (sB.total - sB.left), { n, sA: sA.left, sB: sB.left, dB });
      const diffB = await frozen(page, async () => boardDiff(sB, await domBoard(page)));
      check(`運んだ後も、わくの数が state と一致（食い違い ${diffB.length} 件）`, diffB.length === 0, diffB.slice(0, 4));
      await ctx.close();
    },
  },
  {
    id: 'AW2', tier: 'smoke', title: 'あまいもの：solution() の順に「settle() → press」で進めるとクリアのカード（next・book・menu）、amai.best・amai.book が増え、next で面 +1・押した数 0（カードの直後 400ms は押せない）',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'AW2', { v: SMOKE_V() });
      await frozen(page, async () => {
        const { sol, s } = await solveToClear(page);
        const ov = await overlayInfo(page);
        check(`解 ${sol.length} 手でクリア：overlay "clear"・won・left 0（${s.left}）・phase ${s.phase}`, s.overlay === 'clear' && s.won === true && s.left === 0 && s.phase === 'clear', s);
        check(`クリアのカードに「つぎの めんへ」(next)「ずかん」(book)「メニューへ」(menu)・「クリア」の文字（${ov.cmds.join(',')}）`, ov.shown && ['next', 'book', 'menu'].every((c) => ov.cmds.includes(c)) && /クリア/.test(ov.text), ov);
        const best = await stored(page, 'amai.best'), bk = await stored(page, 'amai.book'), sv = await stored(page, 'amai.save');
        let bkObj = null; try { bkObj = JSON.parse(bk); } catch { /* 下で不合格 */ }
        const got = bkObj && bkObj.got ? Object.values(bkObj.got) : [];
        check(`クリア後の保存：amai.best が "1"（${best}）、amai.book に絵が 1 枚（${bk}）、amai.save は次の面（${sv}）`,
          best === '1' && got.length === 1 && got[0] >= 1 && /"level":\s*2/.test(sv || ''), { best, bk, sv });
        await clickCmd(page, 'next'); await wait(page, 50);
        const early = await gs(page);
        check('カードを出した直後の next は効かない（誤タップ防止 400ms）', early.level === 1 && early.overlay === 'clear', early);
      });
      await wait(page, 600);
      const fo = await overlayInfo(page);
      check(`しばらくたつと next が押せる（フォーカスは ${fo.active}）`, fo.shown && fo.active === 'next', fo);
      await clickCmd(page, 'next'); await wait(page, 200);
      const s2 = await gs(page), d2 = await domNums(page);
      check(`next で面 2・押した数 0・カードが閉じる、#level ${d2.level} も 2`, s2.level === 2 && s2.presses === 0 && s2.t === 0 && s2.overlay === null && s2.phase === 'play' && d2.level === 2 && s2.left === s2.total, s2);
      const sol2 = await solutionOf(page);
      const k = await pressCol(page, sol2[0]);
      check('次の面でも遊べる（1 箱押せる）', k === 'press' && (await gs(page)).presses === 1, k);
      await ctx.close();
    },
  },
  {
    id: 'AW3', tier: 'smoke', title: 'あまいもの データ：2 回押して何はこびか進め再読み込みすると同じ局面（t・left・わく・列・絵）、49 面（くり返し）でも同じ、壊れた amai.save・amai.best・amai.book でも落ちない、ほかのゲームの保存キーを変えない',
    async run({ browser, check }) {
      const others = { 'blockpuzzle.best': '777', 'tile2048.best': '888', 'hashi.best': '55', 'zenmai.progress': '{"stars":{"z01":3}}', 'pikatto.bestSolo': '321', 'kiritori.best': '99', 'irobin.best': '4' };
      const { ctx, page } = await openG(browser, 'AW3', { v: SMOKE_V(), extra: others });
      const s0 = await gs(page);
      check(`保存が無ければ 1 面から（level ${s0.level}・best ${s0.best}）`, s0.level === 1 && s0.best === 0, s0);
      const same = async (label, a, aLogic, extraChk = null) => {
        await page.reload(); await wait(page, 300);
        const b = await gs(page), bLogic = await lg(page), dom = await domBoard(page);
        const pic = await page.evaluate(() => document.querySelector('#pic')?.getAttribute('aria-label') ?? '');
        const diff = boardDiff(b, dom);
        check(`${label}：再読み込みで同じ局面（level ${b.level}・t ${b.t}・left ${b.left}・presses ${b.presses}・わく・列・cells）、画面も一致、絵の説明に「のこり ${b.left} こ」`,
          b.level === a.level && b.t === a.t && b.left === a.left && b.presses === a.presses && J(b.slots) === J(a.slots) && J(b.cols) === J(a.cols) && J(bLogic.cells) === J(aLogic.cells)
          && diff.length === 0 && pic.includes(`のこり ${b.left}`) && (!extraChk || extraChk(bLogic)), { a: { t: a.t, left: a.left, presses: a.presses }, b: { t: b.t, left: b.left, presses: b.presses }, diff: diff.slice(0, 3), pic });
      };
      // 1 面：2 回押して進める
      const sol = await solutionOf(page);
      await settleG(page); await pressCol(page, sol[0]); await page.evaluate(() => window.AmaiGame.tick(2));
      await settleG(page); await pressCol(page, sol[1] ?? sol[0]); await page.evaluate(() => window.AmaiGame.tick(2)); await settleG(page); await skipG(page);
      const a1 = await gs(page), a1l = await lg(page);
      const save = await stored(page, 'amai.save');
      check(`2 回押すと presses 2・amai.save に v:1・面 1・押した手 2 つ（${save}）`, a1.presses === 2 && /"level":\s*1/.test(save || '') && (() => { try { const o = JSON.parse(save); return o.v === 1 && o.presses.length === 2; } catch { return false; } })(), { a1: a1.presses, save });
      await same('1 面', a1, a1l);
      const after = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
      const changed = Object.entries(others).filter(([k, v]) => after[k] !== v).map(([k]) => k);
      const extraKeys = Object.keys(after).filter((k) => !(k in others) && !k.startsWith('amai.') && k !== 'blockpuzzle.sound');
      check(`ほかのゲームの保存キーは変わらず、新しいキーは amai.* だけ（変化 ${changed.join(',') || 'なし'}・余分 ${extraKeys.join(',') || 'なし'}）`, changed.length === 0 && extraKeys.length === 0, { changed, extraKeys });
      // 49 面（くり返し）
      await setLevel(page, 49);
      const sol49 = await solutionOf(page);
      await settleG(page); await pressCol(page, sol49[0]); await page.evaluate(() => window.AmaiGame.tick(2)); await settleG(page); await skipG(page);
      const a49 = await gs(page), a49l = await lg(page);
      check(`49 面はくり返しの面（repeat ${a49l.repeat}・mirror ${a49l.mirror}・presses ${a49.presses}）`, a49.level === 49 && a49l.repeat === true && a49l.mirror === true && a49.presses === 1, { level: a49.level, repeat: a49l.repeat, mirror: a49l.mirror });
      await same('49 面（くり返し）', a49, a49l, (b) => b.repeat === true && b.mirror === true && b.picture === a49l.picture);
      // 壊れた amai.save（使えない形は 1 面から。形が正しく絵の id だけ知らない保存は、その面の最初か 1 面）
      const BAD_SAVE = ['{not json', '', 'null', '[]', '{"v":2,"level":3,"pic":"ringo","mirror":false,"rep":false,"presses":[],"t":0}',
        '{"v":1,"level":0,"pic":"ringo","mirror":false,"rep":false,"presses":[],"t":0}', '{"v":1,"level":-2,"pic":"ringo","mirror":false,"rep":false,"presses":[],"t":0}',
        '{"v":1,"level":"3","pic":"ringo","mirror":false,"rep":false,"presses":[],"t":0}', '{"v":1,"level":3,"pic":"RINGO","mirror":false,"rep":false,"presses":[],"t":0}',
        '{"v":1,"level":3,"pic":"ringo","mirror":"x","rep":false,"presses":[],"t":0}', '{"v":1,"level":3,"pic":"ringo","mirror":false,"rep":false,"presses":"x","t":0}',
        '{"v":1,"level":3,"pic":"ringo","mirror":false,"rep":false,"presses":[[0]],"t":0}', '{"v":1,"level":3,"pic":"ringo","mirror":false,"rep":false,"presses":[[0,4]],"t":0}',
        '{"v":1,"level":3,"pic":"ringo","mirror":false,"rep":false,"presses":[[0,1.5]],"t":0}', '{"v":1,"level":3,"pic":"ringo","mirror":false,"rep":false,"presses":[[5,0],[2,1]],"t":9}',
        '{"v":1,"level":3,"pic":"ringo","mirror":false,"rep":false,"presses":[[0,0]],"t":99999}', '{"v":1,"level":3,"pic":"zzzz","mirror":false,"rep":false,"presses":[],"t":0}'];
      const bad = [];
      for (const raw of BAD_SAVE) {
        await seed(page, { 'amai.help': '1', 'amai.save': raw });
        await page.goto(AM); await wait(page, 250);
        const ok = await page.evaluate(() => !!window.AmaiGame).catch(() => false);
        if (!ok) { bad.push(`${raw}: ゲームが起動しない`); continue; }
        const s = await gs(page);
        if (!((s.level === 1 || s.level === 3) && s.presses === 0 && s.t === 0 && s.phase === 'play')) bad.push(`${raw}: level ${s.level} presses ${s.presses} t ${s.t} phase ${s.phase}`);
      }
      check(`壊れた amai.save（${BAD_SAVE.length} 通り）でも落ちず、面の最初（または 1 面）から始まる`, bad.length === 0, bad);
      const BAD_BEST = ['abc', '-5', '1e400', '{}', '1.5', 'NaN', 'Infinity', '', '9007199254740992'];
      const bad2 = [];
      for (const raw of BAD_BEST) {
        await seed(page, { 'amai.help': '1', 'amai.best': raw });
        await page.goto(AM); await wait(page, 250);
        const ok = await page.evaluate(() => !!window.AmaiGame).catch(() => false);
        if (!ok) { bad2.push(`${raw}: 起動しない`); continue; }
        const s = await gs(page), d = await domNums(page);
        if (!(s.level === 1 && s.best === 0 && d.level === 1)) bad2.push(`${raw}: level ${s.level} best ${s.best}`);
      }
      check(`壊れた amai.best（${BAD_BEST.join(' ')}）でも落ちず、ベスト 0・面 1 から`, bad2.length === 0, bad2);
      const BAD_BOOK = ['{not json', '', 'null', '[]', '{"v":1,"got":5}', '{"v":1,"got":[]}', '{"v":2,"got":{"ringo":1}}', '{"v":1,"got":{"ringo":"x","sakura":-1,"ume":1.5}}'];
      const bad3 = [];
      for (const raw of BAD_BOOK) {
        await seed(page, { 'amai.help': '1', 'amai.book': raw });
        await page.goto(AM); await wait(page, 250);
        const ok = await page.evaluate(() => !!window.AmaiGame).catch(() => false);
        if (!ok) { bad3.push(`${raw}: 起動しない`); continue; }
        await page.click('#bookBtn'); await wait(page, 150);
        const o = await overlayInfo(page);
        if (!(o.shown && o.cmds.includes('close'))) bad3.push(`${raw}: ずかんが開かない`);
      }
      check(`壊れた amai.book（${BAD_BOOK.length} 通り）でも落ちず、ずかんが開く`, bad3.length === 0, bad3);
      // 保存できない環境
      const { ctx: c2, page: p2 } = await newPage(browser, SMOKE_V(), 'AW3 保存不可', { clock: true, initScript: () => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('denied'); } }); } });
      await p2.goto(AM); await wait(p2, 300);
      const noStore = await p2.evaluate(() => !!window.AmaiGame && window.AmaiGame.getState().level === 1).catch(() => false);
      check('localStorage にさわると例外になる環境でも起動して 1 面が遊べる', noStore, null);
      await c2.close();
      await ctx.close();
    },
  },
  {
    id: 'AW4', tier: 'smoke', title: 'あまいもの：遊び方・プレイ中・ずかん・うごかせない・やりなおしの確認・クリアのカードのどこからでも a#back でメニューへ戻れる',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'AW4', { v: SMOKE_V(), help: false });
      check('a#back の href は ../../ でメニュー（BASE）を指す', await page.evaluate(() => document.querySelector('a#back')?.href) === BASE, await page.evaluate(() => document.querySelector('a#back')?.getAttribute('href')));
      const r = {};
      const goBack = async (key) => { await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {}); r[key + 'Nav'] = page.url() === BASE; };
      const h = await overlayInfo(page);
      check(`初回は遊び方が自動で出る（close がある。${h.cmds.join(',')}）`, h.shown && h.cmds.includes('close'), h);
      r.help = await reachable(page, 'a#back'); await goBack('help');
      await gotoG(page);
      r.play = await reachable(page, 'a#back'); await goBack('play');
      await gotoG(page);
      await page.click('#bookBtn'); await wait(page, 150);
      r.book = (await overlayInfo(page)).shown && await reachable(page, 'a#back'); await goBack('book');
      await gotoG(page);
      await playSolution(page, 1);
      await page.click('#restartBtn'); await wait(page, 100);
      const cf = await overlayInfo(page);
      r.confirm = cf.shown && cf.cmds.includes('restartYes') && cf.cmds.includes('close') && await reachable(page, 'a#back'); await goBack('confirm');
      await gotoG(page);
      const st = await makeStuckState(page);
      for (let i = 0; i < 30 && (await gs(page)).overlay !== 'stuck'; i++) { await skipG(page); await wait(page, 100); }
      r.stuck = st.ok && (await gs(page)).overlay === 'stuck' && await reachable(page, 'a#back'); await goBack('stuck');
      await gotoG(page, { 'amai.save': null });
      await solveToClear(page);
      r.clear = (await overlayInfo(page)).cmds.includes('menu') && await reachable(page, 'a#back'); await goBack('clear');
      check('どの状態でも a#back が見えて押せる（遊び方・プレイ中・ずかん・やりなおしの確認・うごかせない・クリアのカード）', r.help && r.play && r.book && r.confirm && r.stuck && r.clear, r);
      check('どの状態からも a#back で実際にメニューが開く', r.helpNav && r.playNav && r.bookNav && r.confirmNav && r.stuckNav && r.clearNav, r);
      await gotoG(page, { 'amai.save': null });
      await solveToClear(page);
      await wait(page, 600);
      await page.click('#overlay [data-cmd="menu"]'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('クリアのカードの「メニューへ」（data-cmd=menu）でメニューが開く', page.url() === BASE && await page.locator('a.game').count() >= 2, page.url());
      await ctx.close();
    },
  },

  // ================= full =================
  {
    id: 'AW5', tier: 'full', title: 'あまいもの 画面内：SE 縦・SE 縦 Safari（320×454）・SE 横・568×270・667×375・13 横・iPad 縦横で、1 面と 48 面（32×24 の絵）でも手前の箱・わく・ボタンが 44×44 以上で safe-area の中、.head・#picBox・#slots・#grid・#tools が重ならずはみ出さない、16 桁の面番号、遊び方の「わかった」がスクロールなしで押せる',
    async run({ browser, check }) {
      const VS = [view('SE', 'p', 'app'), view('SE', 'p', 'safari'), view('SE', 'l', 'app'), custom(568, 270, null, 'SE Safari 横 568×270'), custom(667, 375, [0, 0, 0, 0], 'SE相当 横 667×375'), view('i13', 'l', 'app'), view('iPad', 'p', 'app'), view('iPad', 'l', 'app')];
      const SEL = 'a#back, #helpBtn, #soundBtn, .box.front, .slot, #undoBtn, #restartBtn, #fastBtn, #bookBtn, .head, #picBox, #hint, #slots, #grid, #tools';
      const MIN = 'a#back, #helpBtn, #soundBtn, .box.front, .slot, #undoBtn, #restartBtn, #fastBtn, #bookBtn';
      for (const v of VS) {
        for (const lv of [1, 48]) {
          const { ctx, page } = await openG(browser, `AW5 ${v.label} ${lv}`, { v });
          if (lv !== 1) await setLevel(page, lv);
          await wait(page, 150);
          const s = await gs(page);
          const r = await layoutProbe(page, SEL, v.safe, { overlapSel: '.head, #picBox, #hint, #slots, #grid, #tools', minSel: MIN });
          check(`${v.label} ${v.w}×${v.h}｜${lv} 面（箱 ${s.cols.reduce((a, c) => a + c.length, 0)} 個）：${r.n} 要素が画面内・重なりなし（案内 #hint は絵に重ねない）・ボタン／手前の箱／わくが 44px 以上・横スクロールなし`, s.level === lv && r.n > 0 && r.outside.length === 0 && r.overlaps.length === 0 && r.small.length === 0 && !r.hscroll, { level: s.level, ...r });
          await ctx.close();
        }
      }
      // 16 桁の面番号
      for (const v of [view('SE', 'p', 'app'), view('SE', 'l', 'app')]) {
        const { ctx, page } = await openG(browser, `AW5 16桁 ${v.label}`, { v });
        await page.evaluate((n) => window.AmaiGame.setLevel(n), Number(MAX16)); await wait(page, 200);
        const lvl = await page.evaluate(() => {
          const e = document.querySelector('#levelBox'), b = document.querySelector('#picBox').getBoundingClientRect(), q = e.getBoundingClientRect(), lf = document.querySelector('.leftbox').getBoundingClientRect();
          return { t: document.querySelector('#level').textContent, fit: e.scrollWidth <= e.clientWidth + 0.5, inBox: q.right <= b.right + 0.5 && q.left >= b.left - 0.5, apart: q.right <= lf.left + 0.5, hs: document.documentElement.scrollWidth > innerWidth };
        });
        check(`${v.label}：16 桁の面番号（${lvl.t}）が「のこり」と重ならず、はみ出さず、横スクロールなし`, lvl.t === MAX16 && lvl.fit && lvl.inBox && lvl.apart && !lvl.hs, lvl);
        await ctx.close();
      }
      // 遊び方・うごかせない・クリアのカード
      for (const v of [view('SE', 'p', 'app'), view('SE', 'p', 'safari'), view('SE', 'l', 'app'), custom(568, 270, null, 'SE Safari 横 568×270')]) {
        const { ctx, page } = await openG(browser, `AW5 カード ${v.label}`, { v, help: false });
        const o = await overlayInfo(page);
        const noScroll = await page.evaluate((safe) => {
          const [t, r, b, l] = safe || [0, 0, 0, 0];
          const ov = document.querySelector('#overlay'); ov.scrollTop = 0;
          const x = ov.querySelector('[data-cmd="close"]'); if (!x) return null;
          const q = x.getBoundingClientRect();
          return { w: Math.round(q.width), h: Math.round(q.height), inside: q.top >= t - 0.5 && q.bottom <= innerHeight - b + 0.5 && q.left >= l - 0.5 && q.right <= innerWidth - r + 0.5 };
        }, v.safe);
        check(`${v.label}：遊び方の「わかった」(close) がスクロールなしで画面内にあり 44px 以上（${J(noScroll)}）`, o.shown && noScroll && noScroll.inside && noScroll.h >= 43.5 && noScroll.w >= 43.5, { o, noScroll });
        const hp = await overlayProbe(page, v.safe);
        check(`${v.label}：遊び方のカード：見出しが切れず、全ボタンに届き 44px 以上`, overlayOk(hp), hp);
        // 遊び方の文（2026-10-30 UX レビューで差し替え）：「わく」「おなじ いろ」「ふち」と、いちばん大事な核
        // 「なかの いろは、そとの いろを さきに はこんで みちを あけて」が入っていること。古い文（ありの おうちへ など）は無い
        const ht = o.text.replace(/\s+/g, ' ');
        check(`${v.label}：遊び方の文に核「なかの いろは、そとの いろを さきに はこんで みちを あけて」と「わく」（したの ${SLOTS_N}つの しかく）「おなじ いろ」「ふち」（えの そとがわ）「ずかん」がある`,
          [`わく（したの ${SLOTS_N}つの しかく）`, 'おなじ いろ', 'ふち（えの そとがわ）', 'なかの いろは、そとの いろを さきに はこんで みちを あけて', 'ずかん'].every((w) => ht.includes(w)), ht);
        await clickCmd(page, 'close'); await wait(page, 100);
        const st = await makeStuckState(page);
        for (let i = 0; i < 30 && (await gs(page)).overlay !== 'stuck'; i++) { await skipG(page); await wait(page, 100); }
        const sp = await overlayProbe(page, v.safe);
        check(`${v.label}：うごかせないのカード：見出しが切れず、全ボタンに届き 44px 以上（setState ${st.ok}）`, st.ok && overlayOk(sp), { st, sp });
        // 手詰まりのカードが わくを隠さない（2026-10-30 UX レビュー。カードを低く小さくした）：わく（#slots の箱）がカードと重ならず見えている
        const cover = await page.evaluate(() => {
          const c = document.querySelector('.overlay .card'); if (!c) return null;
          const cr = c.getBoundingClientRect();
          const boxes = [...document.querySelectorAll('#slots > *')].map((e) => e.getBoundingClientRect()).filter((q) => q.width > 0);
          const hit = boxes.filter((q) => q.left < cr.right && q.right > cr.left && q.top < cr.bottom && q.bottom > cr.top).length;
          return { n: boxes.length, hit, cardTop: Math.round(cr.top), cardH: Math.round(cr.height), slotsBottom: Math.round(Math.max(...boxes.map((q) => q.bottom))) };
        });
        check(`${v.label}：うごかせないのカードが出ていても わくの箱が全部見える（重なり ${cover && cover.hit}／${cover && cover.n}）`, !!cover && cover.n >= SLOTS_N && cover.hit === 0, cover);
        const hf = await page.evaluate(() => { const h = document.querySelector('#hint'); const q = h.getBoundingClientRect(), b = document.querySelector('#picBox').getBoundingClientRect(); return { t: h.textContent, fit: h.scrollWidth <= h.clientWidth + 1, oneLine: q.height <= 30, onPic: q.left < b.right - 0.5 && b.left < q.right - 0.5 && q.top < b.bottom - 0.5 && b.top < q.bottom - 0.5 }; });
        check(`${v.label}：うごかせないときの案内（${hf.t}）が 1 行で はみ出さず、絵に重ならない`, hf.t.length > 0 && hf.fit && hf.oneLine && !hf.onPic, hf);
        await gotoG(page, { 'amai.save': null });
        await solveToClear(page);
        const cp = await overlayProbe(page, v.safe);
        check(`${v.label}：クリアのカード：見出しが切れず、全ボタンに届き 44px 以上`, overlayOk(cp), cp);
        await ctx.close();
      }
    },
  },
  {
    id: 'AW6', tier: 'full', title: 'あまいもの お助け：押して運ばせてから 1手もどすと押す前と同じ（cells・わく・列・t）を何回でも、最初は disabled。やりなおしは確認カード → restartYes で最初から（押した数 0 では disabled）',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'AW6');
      const initial = await lg(page);
      check('はじめは 1手もどす・やりなおしが disabled', (await isDisabled(page, '#undoBtn')) && (await isDisabled(page, '#restartBtn')), null);
      const sol = await solutionOf(page);
      const snaps = [];
      // 解の最後の箱まで押すとクリアして面が終わる（§3.6。クリアの後は 1手もどす を使わない）ので、最後の 1 手は残す
      const N = Math.min(sol.length - 1, 4);
      if (N < 1) throw new Error(`1 面の解が ${sol.length} 手しかない（1手もどす を試せない）`);
      for (let i = 0; i < N; i++) {
        await settleG(page); await skipG(page);
        snaps.push(await lg(page));
        const k = await pressCol(page, sol[i]); if (k !== 'press') throw new Error(`解の ${i} 手目が押せない（${k}）`);
        await skipG(page);
      }
      await settleG(page); await skipG(page); await wait(page, 100);
      const sN = await gs(page);
      check(`${N} 回押して運ばせた（presses ${sN.presses}・t ${sN.t}）。1手もどす・やりなおしが押せる`, sN.presses === N && sN.t > 0 && !(await isDisabled(page, '#undoBtn')) && !(await isDisabled(page, '#restartBtn')) && sN.canUndo === true, sN);
      for (let i = N - 1; i >= 0; i--) {
        await page.click('#undoBtn'); await skipG(page); await wait(page, 50);
        const now = await lg(page), s = await gs(page), diff = boardDiff(s, await domBoard(page));
        check(`1手もどす（残り ${i} 手）：押す直前と同じ（cells・わく・列・t・presses）、画面も一致`, J(now) === J(snaps[i]) && s.presses === i && diff.length === 0, { want: { t: snaps[i].t, presses: snaps[i].presses, left: snaps[i].left }, got: { t: now.t, presses: now.presses, left: now.left }, diff: diff.slice(0, 3) });
      }
      check('全部戻すと面の最初と同じ、1手もどす・やりなおしが disabled に戻る', J(await lg(page)) === J(initial) && (await isDisabled(page, '#undoBtn')) && (await isDisabled(page, '#restartBtn')), null);
      // やりなおし
      await playSolution(page, 2); await wait(page, 100);
      const mid = await lg(page);
      await page.click('#restartBtn'); await wait(page, 100);
      const cf = await overlayInfo(page);
      check(`やりなおしで確認カード（restartYes・close。${cf.cmds.join(',')}）、「さいしょから」の文字、遊びは進まない`, cf.shown && cf.cmds.includes('restartYes') && cf.cmds.includes('close') && /さいしょから/.test(cf.text), cf);
      await clickCmd(page, 'close'); await wait(page, 100);
      // 手直し（2026-10-30）：1 はこびが 120ms になり、カードを閉じて待つ間にも運びが進む（前は 500ms で進まなかった）。
      // 「そのまま」＝やりなおされていない（押した数が同じ・t は戻らない・left は増えない）に確かめ方を変えた
      const aft = await lg(page);
      check('「やめる」(close) で閉じると局面はそのまま（押した数が同じ・t が戻らない・left が増えない＝やりなおされていない）', aft.presses === mid.presses && aft.t >= mid.t && aft.left <= mid.left && (await gs(page)).overlay === null, { mid: { t: mid.t, presses: mid.presses, left: mid.left }, aft: { t: aft.t, presses: aft.presses, left: aft.left } });
      await page.click('#restartBtn'); await wait(page, 100);
      await clickCmd(page, 'restartYes'); await wait(page, 150);
      const re = await lg(page), rs = await gs(page);
      check(`「やりなおす」(restartYes) で最初から（t 0・presses 0・cells が面の最初と同じ）、カードが閉じ、やりなおしは disabled`, J(re) === J(initial) && rs.overlay === null && rs.phase === 'play' && (await isDisabled(page, '#restartBtn')), { rs });
      await ctx.close();
    },
  },
  {
    id: 'AW7', tier: 'full', title: 'あまいもの うごかせない：setState で「わく全部が埋まり・運べない」局面を作ると stuck・カード（undo・restart）・data-attention="1"、保存は消えない。自然に詰ませた局面では undo で戻れる',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'AW7');
      await playSolution(page, 1);
      const saveBefore = await stored(page, 'amai.save');
      const st = await makeStuckState(page);
      check(`詰みの局面を setState で入れられる（${st.ok ? `内側 ${st.inner} マス` : st.why}）`, st.ok, st);
      for (let i = 0; i < 30 && (await gs(page)).overlay !== 'stuck'; i++) { await skipG(page); await wait(page, 100); }
      const s = await gs(page), ov = await overlayInfo(page);
      check(`phase "stuck"（data-phase ${await phaseAttr(page)}）・stuck true・カード（undo・restart。${ov.cmds.join(',')}）、負けの言葉が無い`,
        s.phase === 'stuck' && s.stuck === true && (await phaseAttr(page)) === 'stuck' && s.overlay === 'stuck' && ov.cmds.includes('undo') && ov.cmds.includes('restart') && /うごかせないよ/.test(ov.text) && /1手もどして ためしてね/.test(ov.text) && /まだ ふちに ないよ|わくが いっぱいだよ/.test(ov.text) && !/しっぱい|まけ/.test(ov.text), { s: s.phase, ov });
      const saveAfter = await stored(page, 'amai.save');
      check('うごかせないでも保存は消えない（amai.save が残っている）', saveBefore !== null && saveAfter !== null, { saveBefore, saveAfter });
      // 自然に詰ませる
      const { ctx: c2, page: p2 } = await openG(browser, 'AW7 自然');
      const found = await findNaturalStuck(p2);
      check(`ふつうに押していって「うごかせない」になる押し方が見つかる（${found ? `${found.lv} 面・${found.ops.length} 操作` : 'なし'}）`, !!found, found);
      if (found) {
        await replayOps(p2, found);
        for (let i = 0; i < 40 && (await gs(p2)).overlay !== 'stuck'; i++) { await settleG(p2); await skipG(p2); await wait(p2, 100); }
        const s2 = await gs(p2);
        check(`その押し方で画面も stuck（phase ${s2.phase}・overlay ${s2.overlay}）`, s2.phase === 'stuck' && s2.overlay === 'stuck', s2);
        if (s2.phase === 'stuck') {
          // data-attention は押した数のある局面で確かめる（setState の局面は押した数 0 で、どちらも disabled。PM の決定）
          const att = await p2.evaluate(() => ['#undoBtn', '#restartBtn'].map((q) => document.querySelector(q)?.getAttribute('data-attention') ?? null));
          check(`押して意味のある方に data-attention="1"（undo ${att[0]}・restart ${att[1]}）`, att.includes('1'), att);
          const before = s2.presses;
          await wait(p2, 450);   // うごかせないのカードも出した直後 400ms は押せない（誤タップ防止）
          await clickCmd(p2, 'undo'); await skipG(p2); await wait(p2, 100);
          const s3 = await gs(p2);
          check(`1手もどす(undo) で戻れる（presses ${before} → ${s3.presses}）。カードが閉じて phase play・stuck false`, s3.presses === before - 1 && s3.overlay === null && s3.phase === 'play' && s3.stuck === false, s3);
          // もう一度詰ませて、やりなおし → 確認カード
          await replayOps(p2, found);
          for (let i = 0; i < 40 && (await gs(p2)).overlay !== 'stuck'; i++) { await settleG(p2); await skipG(p2); await wait(p2, 100); }
          await wait(p2, 450);
          await clickCmd(p2, 'restart'); await wait(p2, 100);
          const cf = await overlayInfo(p2);
          check(`うごかせないのカードの「やりなおし」(restart) は確認カードへ（${cf.cmds.join(',')}）`, cf.shown && cf.cmds.includes('restartYes') && cf.cmds.includes('close'), cf);
        }
      }
      await c2.close();
      await ctx.close();
    },
  },
  {
    id: 'AW8', tier: 'full', title: 'あまいもの はやく：#fastBtn を押すと aria-pressed="true"・amai.fast が "1"・1 はこびの間が半分（実時間 3 秒あたりの t の増え方が 1.5 倍以上）。もう一度で "0"。再読み込みしても続く',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'AW8', { opts: { clock: false } });
      const s0 = await gs(page);
      check(`はじめは fast false・aria-pressed false（${await page.evaluate(() => document.querySelector('#fastBtn').getAttribute('aria-pressed'))}）`, s0.fast === false && (await page.evaluate(() => document.querySelector('#fastBtn').getAttribute('aria-pressed'))) === 'false', s0.fast);
      await setLevel(page, 25);
      const sol = await solutionOf(page);
      const normal = await driveFor(page, 3000, sol);
      // 手直し（2026-10-30）：1 はこびの間隔 500 → 120ms。3 秒で約 25 はこび（実測 23）。0.5 秒に戻すと 6 で落ちる
      check(`ふつうの速さ：3 秒で ${normal.dt} はこび（15〜30 を期待。0.12 秒に 1 はこび）`, normal.dt >= 15 && normal.dt <= 30, normal);
      await page.click('#fastBtn'); await sleep(100);
      const pr = await page.evaluate(() => document.querySelector('#fastBtn').getAttribute('aria-pressed'));
      check(`はやくを押すと aria-pressed "true"・getState().fast true・amai.fast が "1"（${pr}・${await stored(page, 'amai.fast')}）`, pr === 'true' && (await gs(page)).fast === true && (await stored(page, 'amai.fast')) === '1', pr);
      await setLevel(page, 25);
      const fast = await driveFor(page, 3000, sol);
      check(`はやく：3 秒で ${fast.dt} はこび（ふつうの ${normal.dt} の 1.5 倍以上）`, normal.dt > 0 && fast.dt >= normal.dt * 1.5, { normal: normal.dt, fast: fast.dt });
      await page.reload(); await sleep(400);
      const rl = await gs(page), pr2 = await page.evaluate(() => document.querySelector('#fastBtn').getAttribute('aria-pressed'));
      check(`再読み込みしても はやく のまま（fast ${rl.fast}・aria-pressed ${pr2}）`, rl.fast === true && pr2 === 'true', { rl: rl.fast, pr2 });
      await page.click('#fastBtn'); await sleep(100);
      check(`もう一度押すと戻る（aria-pressed ${await page.evaluate(() => document.querySelector('#fastBtn').getAttribute('aria-pressed'))}・amai.fast ${await stored(page, 'amai.fast')}）`, (await stored(page, 'amai.fast')) === '0' && (await gs(page)).fast === false, null);
      await ctx.close();
    },
  },
  {
    id: 'AW9', tier: 'full', title: 'あまいもの 中断：hidden で t が進まない・timers が増えない・paused、visible で続き。遊び方・ずかん・確認のカードの間も t が進まない',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'AW9');
      await setLevel(page, 25);
      const sol = await solutionOf(page);
      await pressCol(page, sol[0]);
      await wait(page, 1600);
      const r0 = await gs(page);
      check(`動いている（押して 1.6 秒で t ${r0.t} ≥ 2）。これが動かないと中断の確認が意味を持たない`, r0.t >= 2 && r0.phase === 'play', r0);
      await setHidden(page, true); await wait(page, 100);
      const h1 = await gs(page);
      check(`hidden で paused true・phase paused（data-phase ${await phaseAttr(page)}）`, h1.paused === true && h1.phase === 'paused' && (await phaseAttr(page)) === 'paused', h1);
      await wait(page, 3000);
      const h2 = await gs(page);
      check(`隠れている間は進まない（3 秒後も t ${h1.t} → ${h2.t}・timers ${h1.timers} → ${h2.timers}）`, h2.t === h1.t && h2.timers <= h1.timers && h2.paused === true, { h1: h1.t, h2: h2.t, t1: h1.timers, t2: h2.timers });
      await setHidden(page, false); await wait(page, 1600);
      const h3 = await gs(page);
      check(`visible に戻ると続きから進む（t ${h2.t} → ${h3.t}）・paused false・phase play`, h3.t > h2.t && h3.paused === false && h3.phase === 'play', h3);
      // カードの間は進まない
      for (const [btn, ov, label] of [['#helpBtn', 'help', '遊び方'], ['#bookBtn', 'book', 'ずかん'], ['#restartBtn', 'confirm', 'やりなおしの確認']]) {
        await page.click(btn); await wait(page, 150);
        const a = await gs(page);
        await wait(page, 2000);
        const b = await gs(page);
        check(`${label}を開いている間は t が進まない（overlay ${a.overlay}・t ${a.t} → ${b.t}・timers ${a.timers} → ${b.timers}）`, a.overlay === ov && b.t === a.t && b.timers <= a.timers, { a: a.overlay, at: a.t, bt: b.t });
        await clickCmd(page, 'close'); await wait(page, 1600);
        const c = await gs(page);
        check(`${label}を閉じると続きから進む（t ${b.t} → ${c.t}）`, c.overlay === null && (c.t > b.t || c.stable), c);
      }
      await ctx.close();
    },
  },
  {
    id: 'AW10', tier: 'full', title: 'あまいもの キーボード：1〜4 で押せる・矢印でフォーカス・Enter で押す・U／Backspace で戻る・F で はやく・Z で ずかん・? で遊び方・M で音・R で確認・Esc で閉じる。カードが開いているとき数字キーで押せない',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'AW10', { opts: { touch: false } });
      await setLevel(page, 13);
      const key = async (k) => { await page.keyboard.press(k); await wait(page, 60); };
      const col = () => page.evaluate(() => { const a = document.activeElement; return a && a.classList.contains('box') ? Number(a.dataset.col) : null; });
      const s0 = await gs(page);
      check(`13 面：4 つの列すべてに箱がある（${s0.cols.map((c) => c.length).join(',')}）`, s0.cols.every((c) => c.length > 0), s0.cols.map((c) => c.length));
      await key('1');
      const k1 = await gs(page);
      check(`1 キーで 1 列目の手前の箱が一番左のわくへ（presses ${k1.presses}・わく 0 の id ${k1.slots[0] && k1.slots[0].id}／期待 ${s0.cols[0][0].id}）`, k1.presses === 1 && k1.slots[0] && k1.slots[0].id === s0.cols[0][0].id, k1.slots);
      await key('4');
      const k4 = await gs(page);
      check(`4 キーで 4 列目の手前の箱が次のわくへ（presses ${k4.presses}・わく 1 の id ${k4.slots[1] && k4.slots[1].id}／期待 ${s0.cols[3][0].id}）`, k4.presses === 2 && k4.slots[1] && k4.slots[1].id === s0.cols[3][0].id, k4.slots);
      // 矢印
      await page.evaluate(() => document.querySelector('.box.front[data-col="0"]').focus());
      check('0 列目の手前の箱にフォーカスできる', (await col()) === 0, await col());
      await key('ArrowRight'); const r1 = await col();
      await key('ArrowLeft'); const r0 = await col();
      await key('ArrowLeft'); const rEdge = await col();
      check(`→ で 1 列目、← で 0 列目、はし（0 列目）で ← は動かない（${r1}・${r0}・${rEdge}）`, r1 === 1 && r0 === 0 && rEdge === 0, { r1, r0, rEdge });
      // 1・4 キーで押した後なので、箱の残っている一番右の列で止まる（ふつうは 3 列目。箱の無い列にはフォーカスしない）
      const lastCol = (await gs(page)).cols.reduce((m, c, i) => (c.length > 0 ? i : m), -1);
      await key('ArrowRight'); await key('ArrowRight'); await key('ArrowRight'); const e3 = await col();
      await key('ArrowRight'); const e3b = await col();
      check(`→ を続けると箱のある一番右の列（${lastCol} 列目）で止まる（${e3}・${e3b}）`, lastCol >= 2 && e3 === lastCol && e3b === lastCol, { e3, e3b, lastCol });
      // Enter
      await page.evaluate(() => document.querySelector('.box.front[data-col="2"]').focus());
      const pB = (await gs(page)).presses;
      await key('Enter');
      const en = await gs(page);
      check(`Enter でフォーカスのある 2 列目の箱が押せる（presses ${pB} → ${en.presses}）`, en.presses === pB + 1, en);
      // U で戻る・Backspace
      await key('u'); const u1 = await gs(page);
      check(`U で 1手もどす（presses ${en.presses} → ${u1.presses}）`, u1.presses === en.presses - 1, u1);
      await key('Backspace'); const u2 = await gs(page);
      check(`Backspace でも 1手もどす（presses ${u1.presses} → ${u2.presses}）`, u2.presses === u1.presses - 1, u2);
      // F・M
      await key('f');
      check(`F で はやく（aria-pressed ${await page.evaluate(() => document.querySelector('#fastBtn').getAttribute('aria-pressed'))}・fast ${(await gs(page)).fast}）`, (await gs(page)).fast === true && (await page.evaluate(() => document.querySelector('#fastBtn').getAttribute('aria-pressed'))) === 'true', null);
      await key('f');
      const m0 = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      await key('m');
      const m1 = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      check(`M で音のオン/オフ（aria-pressed ${m0} → ${m1}）`, m0 !== m1, { m0, m1 });
      await key('m');
      // Z・?・R・Esc
      const opened = {};
      for (const [k, ov] of [['z', 'book'], ['?', 'help'], ['r', 'confirm']]) {
        await key(k); opened[k] = (await gs(page)).overlay;
        if (k === 'z' || k === '?') { const before = (await gs(page)).presses; await key('1'); opened[k + 'num'] = (await gs(page)).presses === before; }
        await key('Escape'); opened[k + 'esc'] = (await gs(page)).overlay;
        void ov;
      }
      check(`Z でずかん（${opened.z}）・? で遊び方（${opened['?']}）・R で確認（${opened.r}）が開き、Esc で閉じる（${opened.zesc}・${opened['?esc']}・${opened.resc}）`,
        opened.z === 'book' && opened['?'] === 'help' && opened.r === 'confirm' && opened.zesc === null && opened['?esc'] === null && opened.resc === null, opened);
      check('カード（ずかん・遊び方）が開いているとき、数字キーで箱は押せない', opened.znum === true && opened['?num'] === true, opened);
      await ctx.close();
    },
  },
  {
    id: 'AW11', tier: 'full', audio: true, title: 'あまいもの 効果音：place・nest・empty・clear が起きた順に鳴り、実際に音の部品が動く。使う音の名前がすべて sfx.js の amai の表にある。♪でオフにすると鳴らない',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'AW11', { opts: { initScript: SFX_SPY, touch: false, reducedMotion: 'reduce' } });
      const names = await page.evaluate(() => YubiSfx.create('amai').names);
      const want = ['place', 'nest', 'empty', 'clear', 'open', 'thaw', 'deny', 'undo', 'stuck', 'start', 'best', 'toggle'];
      check(`sfx.js の "amai" に契約の音名 ${want.length} 個がある`, want.every((n) => names.includes(n)), want.filter((n) => !names.includes(n)));
      const sol = await solutionOf(page);
      // 最初の 1 箱だけ本物のクリック（音の準備 unlock を通す）、あとは API で、落ち着くまで待ちながら
      await page.click(`.box.front[data-col="${sol[0]}"]`);
      await playOut(page); await sleep(600);
      for (const c of sol.slice(1)) {
        await pressCol(page, c);
        await playOut(page); await sleep(300);
      }
      for (let i = 0; i < 60 && (await gs(page)).overlay !== 'clear'; i++) { await sleep(40); await wait(page, 100); }
      await sleep(400);
      const s = await gs(page);
      const pl = await plays(page), seq = pl.map((p) => p.n);
      const first = (n) => seq.indexOf(n), last = (n) => seq.lastIndexOf(n);
      const cnt = (n) => seq.filter((x) => x === n).length;
      check(`クリアまで進んだ（overlay ${s.overlay}）`, s.overlay === 'clear', s);
      check(`鳴った順：place → nest → empty、最後に clear（${seq.filter((n, i) => n !== seq[i - 1]).slice(0, 12).join(',')}…）`,
        first('place') >= 0 && first('place') < first('nest') && first('nest') < first('empty') && last('empty') < last('clear') && first('clear') >= 0, seq.slice(0, 30));
      check(`place は箱の数（${cnt('place')}／${sol.length}）、empty は箱の数（${cnt('empty')}）、clear は 1 回（${cnt('clear')}）、nest は 1 回以上（${cnt('nest')}）`,
        cnt('place') === sol.length && cnt('empty') === sol.length && cnt('clear') === 1 && cnt('nest') >= sol.length, { place: cnt('place'), empty: cnt('empty'), clear: cnt('clear'), nest: cnt('nest') });
      const unknown = pl.filter((p) => !p.known);
      check('どの呼び出しも sfx.js の amai の表にある音の名前', pl.length > 0 && unknown.length === 0, unknown.slice(0, 5));
      const silent = ['place', 'empty', 'clear'].filter((n) => !pl.some((p) => p.n === n && p.d > 0));
      const nestOk = pl.some((p) => p.n === 'nest' && p.d > 0);
      check(`place・empty・clear・nest が実際に音の部品を start した（鳴らなかった：${silent.join(',') || 'なし'}・nest ${nestOk}）`, silent.length === 0 && nestOk, { silent, nestOk });
      // 音をオフ（クリアのカードが ♪ を覆っているので、先に 2 面へ進めてから押す）
      await setLevel(page, 2);
      await page.click('#soundBtn'); await wait(page, 100);
      const pressed = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      const st0 = await page.evaluate(() => window.__starts);
      const sol2 = await solutionOf(page);
      await pressCol(page, sol2[0]); await playOut(page); await sleep(300);
      const st1 = await page.evaluate(() => window.__starts);
      check(`♪でオフ（aria-pressed ${pressed}）にすると、運んでも音が鳴らない（start ${st1 - st0}）`, pressed === 'false' && st1 - st0 === 0, { st0, st1, pressed });
      await ctx.close();
    },
  },
  {
    id: 'AW12', tier: 'full', title: 'あまいもの 色覚：手前・奥・わくの箱に data-mark、色ごとに印がちがい AmaiLogic.COLORS と同じ、aria-label に色の名前と印。ふたの箱は DOM に色・印・数を出さない',
    async run({ browser, check, root }) {
      const LG = loadLogic(root);
      const { ctx, page } = await openG(browser, 'AW12');
      const colors = LG.COLORS;
      check(`COLORS が 10 色で、印がすべてちがう（${colors.map((c) => c.mark).join(',')}）`, colors.length === 10 && new Set(colors.map((c) => c.mark)).size === 10, colors.map((c) => c.mark));
      const seen = new Map(), bad = [];
      let boxes = 0;
      for (const lv of [1, 13, 25, 37, 48]) {
        await setLevel(page, lv);
        // 序盤の数手を進めて、わくにも箱を入れる
        const sol = await solutionOf(page);
        for (let i = 0; i < Math.min(3, sol.length); i++) { await settleG(page); await pressCol(page, sol[i]); await skipG(page); }
        const dom = await domBoard(page);
        for (const c of dom.cols) for (const x of [...c.front.map((b) => ({ ...b, isFront: true })), ...c.back]) {
          if (x.lid === '1') continue;
          boxes++;
          const k = Number(x.color), want = colors[k];
          if (!want) { bad.push(`${lv}: 色 ${x.color} が COLORS に無い`); continue; }
          if (x.mark !== want.mark) bad.push(`${lv}: 色 ${k} の印 ${x.mark}（期待 ${want.mark}）`);
          seen.set(k, x.mark);
          // 奥の箱は見るだけ（aria-hidden。契約 §3.4）なので、aria-label は手前の箱だけで見る
          if (x.isFront && (!x.label.includes(want.name) || !/[（(].+[）)]/.test(x.label))) bad.push(`${lv}: aria-label「${x.label}」に色の名前「${want.name}」と（印）が無い`);
        }
        for (const sl of dom.slots) if (sl.color !== '') { const k = Number(sl.color); if (!sl.sr.includes(colors[k].name)) bad.push(`${lv}: わく ${sl.i} の説明「${sl.sr}」に色の名前が無い`); }
      }
      check(`手前・奥・わくの箱（${boxes} 個）の印と aria-label が COLORS と一致（色 ${[...seen.keys()].sort().join(',')}）`, bad.length === 0 && boxes > 0 && seen.size >= 5, bad.slice(0, 5));
      check('見えた色ごとに印がちがう', new Set([...seen.values()]).size === seen.size, [...seen]);
      // ふたの箱（奥に見える）は色・印・数を DOM に出さない
      let lid = null;
      for (const lv of [9, 13, 19, 25, 31, 37, 43]) {
        await setLevel(page, lv);
        const sol = await solutionOf(page);
        for (let i = 0; i <= Math.min(12, sol.length) && !lid; i++) {
          const l = await page.evaluate(() => { const e = document.querySelector('.box[data-lid="1"]'); return e ? { html: e.outerHTML, id: e.dataset.id, color: e.dataset.color, mark: e.dataset.mark, count: e.dataset.count, label: e.getAttribute('aria-label') || '', text: e.textContent.replace(/\s+/g, ''), front: e.classList.contains('front') } : null; });
          if (l) { lid = { lv, ...l }; break; }
          if (i < sol.length) { await settleG(page); await pressCol(page, sol[i]); await skipG(page); }
        }
        if (lid) break;
      }
      check(`ふたの箱が見つかる（${lid ? `${lid.lv} 面` : 'なし'}）`, !!lid, lid);
      if (lid) {
        const L = await lg(page);
        const real = L.cols.flat().find((b) => String(b.id) === lid.id);
        const names = colors.map((c) => c.name), marks = colors.map((c) => c.mark);
        const leak = [...names, ...marks].filter((w) => lid.html.includes(w));
        check(`ふたの箱（id ${lid.id}）：data-color・data-mark・data-count が空、aria-label は手前なら「ふた」・奥（aria-hidden）なら無し、文字に数字が無い、HTML に色の名前・印の名前が無い（漏れ：${leak.join(',') || 'なし'}）`,
          lid.color === '' && lid.mark === '' && lid.count === '' && (lid.front ? /ふた/.test(lid.label) : lid.label === '') && !/\d/.test(lid.text) && leak.length === 0 && !!real && real.lid === true, lid);
      }
      await ctx.close();
    },
  },
  {
    id: 'AW13', tier: 'full', title: 'あまいもの 動きを減らす：reducedMotion: reduce で calm が true、押したあとの絵が 0.5 秒以内に終わる（busy が false）。通常は calm false',
    async run({ browser, check }) {
      const normal = await openG(browser, 'AW13 通常', { opts: { clock: false } });
      check('通常は calm false', (await gs(normal.page)).calm === false, await gs(normal.page));
      await normal.ctx.close();
      const { ctx, page } = await openG(browser, 'AW13 calm', { opts: { clock: false, reducedMotion: 'reduce' } });
      const s0 = await gs(page);
      check('reducedMotion: reduce で calm true', s0.calm === true, s0);
      const sol = await solutionOf(page);
      const ms = await page.evaluate((c) => new Promise((ok) => {
        const g = window.AmaiGame, a = performance.now();
        g.press(c);
        const tick = () => { const s = g.getState(); if (!s.busy) ok(performance.now() - a); else if (performance.now() - a > 4000) ok(9999); else requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }), sol[0]);
      const s1 = await gs(page);
      check(`押したあとの絵が 0.15 秒ほどで終わる（${Math.round(ms)}ms。計測の余裕を見て 500ms 未満）・箱が入った（presses ${s1.presses}）`, ms < 500 && s1.presses === 1, ms);
      await settleG(page); await skipG(page); await sleep(300);
      const anim = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
      const ants = (await gs(page)).ants;
      check(`落ち着いた後に動き続けるアニメーションがなく（${anim} 個）、ありんこが歩いていない（ants ${ants}）`, anim === 0 && ants === 0, { anim, ants });
      await ctx.close();
    },
  },
  {
    id: 'AW14', tier: 'full', title: 'あまいもの オフライン：sw.js の APP_FILES に games/amai/* がすべて入り（無ければ不合格）、接続を切っても開いて遊べ、部品は Service Worker から読まれ、メニューに戻れる',
    async run({ browser, check, srv, root }) {
      const info = swInfo(root);
      const dir = path.join(root, 'games/amai');
      const actual = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : [];
      const required = ['index.html', 'pictures-a.js', 'pictures-b.js', 'logic.js', 'render.js', 'input.js', 'main.js'];
      const want = ['./games/amai/', ...required.map((f) => `./games/amai/${f}`), ...actual.map((f) => `./games/amai/${f}`)];
      const uniq = [...new Set(want)];
      const missing = uniq.filter((f) => !info.files.includes(f));
      check(`sw.js の APP_FILES に games/amai/ の ${uniq.length} 件がすべてある（足りない：${missing.join(' / ') || 'なし'}）`, missing.length === 0 && required.every((f) => actual.includes(f)), { missing, actual });
      const exist = uniq.filter((f) => !f.endsWith('/')).filter((f) => !fs.existsSync(path.join(root, f)));
      check('APP_FILES に足すファイルが実際にある', exist.length === 0, exist);
      if (missing.length || exist.length) return;
      srv.reset();
      const { ctx, page } = await newPage(browser, custom(390, 844, null, 'iPhone 13'), 'AW14', { sw: true, allowNetErrors: true });
      await page.goto(BASE);
      const ok = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]));
      if (!ok) throw new Error('Service Worker が 8 秒以内に有効にならない（事前キャッシュの install 失敗の可能性）');
      if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }); }
      await page.evaluate(() => localStorage.setItem('amai.help', '1'));
      await sleep(200);
      await srv.ctl('offline=1');
      const resp = [];
      page.on('response', (r) => { if (/\/games\/amai\/|\/common\/sfx\.js/.test(r.url())) resp.push({ f: r.url().split('/').slice(-2).join('/'), status: r.status(), sw: r.fromServiceWorker() }); });
      await page.goto(AM, { timeout: 10000 }); await sleep(500);
      const libs = await page.evaluate(() => ({ L: typeof window.AmaiLogic?.step, R: typeof window.AmaiRender?.create, I: typeof window.AmaiInput?.attach, P: typeof window.AmaiPictures?.add, Y: typeof window.YubiSfx?.create, G: typeof window.AmaiGame?.getState }));
      check('オフラインで開き、AmaiLogic・AmaiRender・AmaiInput・AmaiPictures・YubiSfx・AmaiGame が使える', Object.values(libs).every((x) => x === 'function'), libs);
      const js = ['pictures-a.js', 'pictures-b.js', 'logic.js', 'render.js', 'input.js', 'main.js', 'common/sfx.js'].map((f) => ({ f, hit: resp.find((r) => r.f.endsWith(f)) }));
      check('pictures-a.js・pictures-b.js・logic.js・render.js・input.js・main.js・sfx.js を Service Worker から 200 で読んだ', js.every((x) => x.hit && x.hit.sw && x.hit.status === 200), { js, resp });
      if (libs.G === 'function') {
        const sol = await page.evaluate(() => window.AmaiGame.solution());
        await page.evaluate((m) => { for (const c of m.slice(0, 2)) { window.AmaiGame.settle(); window.AmaiGame.press(c); window.AmaiGame.skip(); } }, sol);
        const s = await gs(page);
        check(`オフラインで遊べる（2 箱出せた。presses ${s.presses}）`, s.presses === 2, s);
      }
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('オフラインのまま、メニューに戻れる', page.url() === BASE && await page.locator('a.game').count() >= 2, page.url());
      await srv.ctl('offline=0');
      await ctx.close();
    },
  },
  {
    id: 'AW15', tier: 'full', cdp: CDP, title: 'あまいもの タッチ：#grid・#slots・#tools・#picBox のダブルタップで拡大しない（dblclick・gesture・2 回目の touchend を止める）',
    async run({ browser, check }) {
      const TE_SPY = () => { window.__te = []; window.addEventListener('touchend', (e) => window.__te.push({ p: e.defaultPrevented })); };
      const { ctx, page } = await newPage(browser, custom(390, 664, null, 'iPhone 13 Safari'), 'AW15', { device: 'iPhone 13', initScript: TE_SPY, clock: true });
      await gotoG(page);
      const t = await touch(ctx, page);
      for (const sel of ['#grid', '#slots', '#tools', '#picBox']) {
        const g = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          const d = el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
          const gsv = ['gesturestart', 'gesturechange'].map((n) => el.dispatchEvent(new Event(n, { bubbles: true, cancelable: true })));
          return { dbl: !d, gesture: gsv.every((x) => !x), ta: getComputedStyle(document.body).touchAction };
        }, sel);
        check(`${sel}：dblclick・gesturestart/change を止め、touch-action ${g.ta}（manipulation か none）`, g.dbl && g.gesture && /manipulation|none/.test(g.ta), g);
        await page.evaluate(() => window.__te.splice(0));
        await t.doubleTap(sel); await wait(page, 300);
        const ev = await page.evaluate(() => window.__te.splice(0));
        const sc = await page.evaluate(() => window.visualViewport.scale);
        check(`${sel}：素早い 2 回タップで 2 回目の touchend が止められ（${ev.map((e) => e.p).join(',')}）、拡大しない（scale ${sc}）`, ev.length === 2 && ev[1].p === true && sc === 1, { ev, sc });
      }
      await ctx.close();
    },
  },
  {
    // v52（試作）：あまいものあつめはメニューに出していない（URL だけで開ける）。カードを戻すときは、
    // この項目を git の履歴（v49 の AW16：名前・記録・ずかん・壊れた値・16 桁・押すと開く）から戻すこと。
    id: 'AW16', tier: 'full', title: 'あまいもの メニュー：試作のあいだはメニューにカードを出さない（URL だけで開ける・メニューは 12 本のまま・記録があってもカードは出ない）',
    async run({ browser, check, root }) {
      const LG = loadLogic(root);
      const { ctx, page } = await newPage(browser, STD_V(), 'AW16', { clock: true });
      await page.goto(BASE + 'index.html', { waitUntil: 'load' });
      const m0 = await page.evaluate(() => ({
        amai: !!document.querySelector('a.game[href="games/amai/"]'),
        n: document.querySelectorAll('a.game').length,
        text: document.body.textContent,
      }));
      check(`メニューにあまいものあつめのカードが無い（${m0.amai}）・ゲームは 12 本（${m0.n}）`, m0.amai === false && m0.n === 12, m0);
      check(`メニューに「${LG.NAME}」の名前が出ていない`, !m0.text.includes(LG.NAME), null);
      // 記録とずかんがあってもカードは出ない（配信を止めている人の保存が残っていても出さない）
      await seed(page, BASE, { 'amai.best': '3', 'amai.book': JSON.stringify({ got: { ringo: 2 } }) });
      await page.goto(BASE + 'index.html', { waitUntil: 'load' });
      const m1 = await page.evaluate(() => ({
        amai: !!document.querySelector('a.game[href="games/amai/"]'),
        n: document.querySelectorAll('a.game').length,
        err: window.__yubiErr || 0,
      }));
      check(`記録（amai.best 3・ずかん 1 枚）があってもカードは出ず、メニューが落ちない（${m1.amai}・${m1.n}）`, m1.amai === false && m1.n === 12, m1);
      // URL では開ける（試作の遊び方）
      await page.goto(AM, { waitUntil: 'load' });
      const ok = await page.evaluate(() => !!(window.AmaiGame && window.AmaiGame.getState && window.AmaiGame.getState()));
      check('URL（games/amai/）を直に開くと遊べる', ok === true, null);
      await ctx.close();
    },
  },
  {
    id: 'AW17', tier: 'full', title: 'あまいもの ずかん：クリアした絵は色つきの小さな絵と名前と回数、まだの絵は「？？？」、上に「M / 48」・季節の札・48 枚がスクロールで全部見えて「とじる」がいつも押せる。開いている間 t は進まず、閉じると続き',
    async run({ browser, check, root }) {
      const LG = loadLogic(root);
      const order = LG.PICTURE_ORDER, total = order.length;
      const names = order.map((p) => LG.pictureById(p.id, false).name);
      const got = { [order[0].id]: 1, [order[2].id]: 3 };
      for (const v of [view('SE', 'p', 'app'), view('SE', 'l', 'app'), view('iPad', 'p', 'app')]) {
        const { ctx, page } = await openG(browser, `AW17 ${v.label}`, { v, extra: { 'amai.book': J({ v: 1, got }) } });
        await page.click('#bookBtn'); await wait(page, 200);
        const o = await overlayInfo(page);
        check(`${v.label}：ずかんのカードが開く（close がある。${o.cmds.join(',')}）`, o.shown && o.cmds.includes('close') && (await gs(page)).overlay === 'book', o);
        const text = o.text;
        const notYet = (text.match(/？？？/g) || []).length;
        check(`${v.label}：「2 / ${total}」、クリアした絵の名前（${names[0]}・${names[2]}）と「1 かい」「3 かい」、まだの絵は「？？？」が ${total - 2} 個（${notYet}）`,
          new RegExp(`2\\s*/\\s*${total}`).test(text) && text.includes(names[0]) && text.includes(names[2]) && /1\s*かい/.test(text) && /3\s*かい/.test(text) && notYet === total - 2, { text: text.slice(0, 200), notYet });
        check(`${v.label}：まだの絵の名前は出ない（例：${names[10]}）・季節の札（はる・なつ・あき・ふゆ）が出る`, !text.includes(names[10]) && ['はる', 'なつ', 'あき', 'ふゆ'].every((w) => text.includes(w)), text.slice(0, 160));
        const sc = await page.evaluate(() => {
          const card = document.querySelector('#card'), ov = document.querySelector('#overlay');
          const els = [ov, card, ...card.querySelectorAll('*')];
          const sc = els.find((e) => e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY));
          const imgs = card.querySelectorAll('canvas, img, svg').length;
          const reach = () => { const b = card.querySelector('[data-cmd="close"]'); if (!b) return false; const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width >= 43.5 && r.height >= 43.5 && r.top >= 0 && r.bottom <= innerHeight + 0.5 && !!t && (t === b || b.contains(t)); };
          const r0 = reach(); let r1 = r0;
          if (sc) { sc.scrollTop = sc.scrollHeight; r1 = reach(); sc.scrollTop = 0; }
          // 大きな画面（iPad 縦）で全部が収まるならスクロールは要らない：最後の小さな絵が画面内に見えていればよい
          const all = card.querySelectorAll('canvas, img, svg'), last = all[all.length - 1];
          const lr = last ? last.getBoundingClientRect() : null;
          const fits = !sc && !!lr && lr.top >= 0 && lr.bottom <= innerHeight + 0.5;
          return { scrolls: !!sc, fits, imgs, top: r0, bottom: r1 };
        });
        check(`${v.label}：${total} 枚はカードの中をスクロールできるか全部が画面に収まり（${sc.scrolls}・${sc.fits}）、「とじる」が上でも一番下までスクロールしても画面内で押せる（${sc.top}・${sc.bottom}）、小さな絵が ${sc.imgs} 個`, (sc.scrolls || sc.fits) && sc.top && sc.bottom && sc.imgs >= total, sc);
        await ctx.close();
      }
      // 開いている間は t が進まない
      const { ctx, page } = await openG(browser, 'AW17 進行');
      await setLevel(page, 25);
      const sol = await solutionOf(page);
      await pressCol(page, sol[0]); await wait(page, 1600);
      await page.click('#bookBtn'); await wait(page, 150);
      const a = await gs(page); await wait(page, 2000); const b = await gs(page);
      check(`ずかんを開いている間は t が進まない（${a.t} → ${b.t}）`, a.overlay === 'book' && a.t >= 1 && b.t === a.t, { a: a.t, b: b.t });
      await clickCmd(page, 'close'); await wait(page, 1600);
      const c = await gs(page);
      check(`閉じると続きから進む（t ${b.t} → ${c.t}）`, c.overlay === null && c.t > b.t, c);
      // クリアするとずかんに入って回数が増える
      await gotoG(page, { 'amai.save': null, 'amai.book': J({ v: 1, got: { [order[0].id]: 1 } }) });
      await solveToClear(page);
      const bk = JSON.parse((await stored(page, 'amai.book')) || '{}');
      check(`1 面をクリアすると、ほかの絵を消さずに ${order[0].id} の回数が 2 になる（${J(bk)}）`, bk.got && bk.got[order[0].id] === 2, bk);
      await ctx.close();
    },
  },
  {
    id: 'AW18', tier: 'full', title: 'あまいもの 古いページから書き戻さない（契約 §4.4・X-20）：bfcache から戻ったとき・裏にいる間に別のタブが amai.save を書いたとき、古い面・手を書き戻さず開き直して今の保存から続ける。変わっていなければ開き直さない。storage イベントが届かないまま閉じても書き戻さない',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'AW18');
      const mk = (lv) => page.evaluate((n) => { const L = window.AmaiLogic; return L.makeSave(n, L.pickPicture(n, L.validateBook(null)), [], 0); }, lv);
      const fp = (raw) => { try { const s = JSON.parse(raw); return `${s.level}:${(s.presses || []).length}`; } catch { return 'ERR'; } };
      const hiddenWrite = (p) => p.evaluate(() => { const G = window.AmaiGame, s = G.solution(); G.press(s ? s[0] : 0); });
      const r = await x20Run(page, ctx, { key: 'amai.save', newer: [await mk(7), await mk(12), await mk(15), await mk(18)], fp, hiddenWrite });
      check(`あまいものあつめ：${x20Text(r)}`, r.ok, r);
      await ctx.close();
    },
  },
  {
    id: 'AW19', tier: 'full', title: 'あまいもの 性能：48 面（一番大きい絵）を はやくで 10 秒動かし、ありんこの数が 48 以下、絵の描き直しが消えたマスの数と同じくらい（全体を毎回描き直していない）、落ち着いた後は rAF が止まる',
    async run({ browser, check }) {
      const RAF = () => { window.__raf = 0; const r = window.requestAnimationFrame; window.requestAnimationFrame = function (f) { window.__raf++; return r.call(this, f); }; };
      const { ctx, page } = await openG(browser, 'AW19', { opts: { clock: false, initScript: RAF }, extra: { 'amai.fast': '1' } });
      await setLevel(page, 48);
      const s0 = await gs(page);
      check(`48 面・はやく（level ${s0.level}・fast ${s0.fast}・絵の角砂糖 ${s0.total} 個）`, s0.level === 48 && s0.fast === true && s0.total >= 300, s0);
      const sol = await solutionOf(page);
      const st0 = await page.evaluate(() => window.AmaiGame.getState().left);
      const redraws0 = ((await gs(page)).stats || {}).redraws ?? 0;
      const run = await driveFor(page, 10000, sol);
      const s1 = await gs(page);
      const removed = st0 - s1.left;
      check(`10 秒で ${run.dt} はこび進み、角砂糖が ${removed} 個消えた（動いていないと測れない）`, run.dt > 20 && removed > 0, { dt: run.dt, removed });
      check(`ありんこの数は 48 以下（最大 ${run.maxAnts}・いま ${s1.ants}）`, run.maxAnts <= 48 && s1.ants <= 48, { max: run.maxAnts, now: s1.ants });
      // 描画の統計（契約 §3.8 の render.stats()）は getState().stats に入っている前提（契約 §3.6 には書かれていない。本体ができたら PM に確かめる）
      const stat = await page.evaluate(() => { const s = window.AmaiGame.getState(); return s.stats || s.render || null; });
      if (stat && typeof stat.redraws === 'number') {
        const dRedraw = stat.redraws - (redraws0 || 0);
        check(`絵の描き直し ${dRedraw} 回が、消えたマス ${removed} 個の 1.5 倍＋5 以下（全体を毎回描き直していない）`, dRedraw <= removed * 1.5 + 5, { dRedraw, removed, stat });
      } else {
        check('描画の統計（getState().stats.redraws。契約 §3.8 の stats()）が読める', false, { keys: Object.keys(await gs(page)), hint: 'getState() に stats: render.stats() を入れるか、契約に公開の窓口を足す（PM に報告）' });
      }
      // 落ち着いた後は rAF が止まる
      await settleG(page); await skipG(page); await sleep(800);
      const s2 = await gs(page);
      const rafA = await page.evaluate(() => window.__raf);
      await sleep(1000);
      const rafB = await page.evaluate(() => window.__raf);
      check(`落ち着いた後（stable ${s2.stable}・overlay ${s2.overlay}・ants ${s2.ants}）は rAF がほとんど回らない（1 秒で ${rafB - rafA} 回。5 回以下）`, (s2.stable || s2.overlay !== null) && s2.ants === 0 && rafB - rafA <= 5, { rafA, rafB, s2: { stable: s2.stable, overlay: s2.overlay, ants: s2.ants } });
      await ctx.close();
    },
  },
  {
    id: 'AW20', tier: 'full', title: 'あまいもの 仕掛け：ふたの箱は手前に来るまで DOM に色が無く、来たら開く（音 open）。こおりの手前の箱を押すと #hint に「こおって いるよ」・音 deny・わくに入らない。ほかを押すと残りが減り、0 でとける（音 thaw）',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'AW20', { opts: { initScript: SFX_SPY } });
      // ---- ふた ----
      let found = null;
      for (const lv of [12, 11, 10, 9, 13, 14, 25]) {
        await setLevel(page, lv);
        const s = await lg(page);
        const hit = s.cols.map((c, ci) => ({ col: ci, idx: c.findIndex((b, i) => i > 0 && b.lid) })).find((h) => h.idx > 0);
        if (hit) { found = { lv, col: hit.col, idx: hit.idx, box: s.cols[hit.col][hit.idx] }; break; }
      }
      check(`ふたの箱のある面が見つかる（${found ? `${found.lv} 面・列 ${found.col}・${found.idx} 番目` : 'なし'}）`, !!found, found);
      if (found) {
        const X = String(found.box.id);
        if (found.idx <= 2) {
          const back = await page.evaluate((id) => { const e = document.querySelector(`.box[data-id="${id}"]`); return e ? { lid: e.dataset.lid, color: e.dataset.color, count: e.dataset.count, mark: e.dataset.mark, cls: e.className } : null; }, X);
          check(`奥のふたの箱（id ${X}）は data-lid "1"・色・印・数が空（DOM から答えが見えない）`, back && back.lid === '1' && back.color === '' && back.count === '' && back.mark === '', back);
        }
        const sol = await solutionOf(page);
        await page.evaluate(() => window.__plays.splice(0));
        let front = null;
        for (let i = 0; i < sol.length; i++) {
          await settleG(page); await pressCol(page, sol[i]); await skipG(page);
          const s = await lg(page);
          if (s.cols[found.col][0] && String(s.cols[found.col][0].id) === X) { front = s; break; }
        }
        check('解の順に押していくと、ふたの箱が手前に来る', !!front, null);
        if (front) {
          await wait(page, 200);
          const d = await page.evaluate((id) => { const e = document.querySelector(`.box.front[data-id="${id}"]`); return e ? { lid: e.dataset.lid, color: e.dataset.color, count: e.dataset.count, mark: e.dataset.mark } : null; }, X);
          const pl = (await plays(page)).map((p) => p.n);
          check(`手前に来たら開く：data-lid "0"・色 ${found.box.color}・数 ${found.box.count} が見える（${J(d)}）、音 open が鳴る（${pl.filter((n) => n === 'open').length} 回）`,
            d && d.lid === '0' && d.color === String(found.box.color) && d.count === String(found.box.count) && d.mark !== '' && pl.includes('open'), { d, pl });
        }
      }
      // ---- こおり ----
      await setLevel(page, 19);
      const base = await lg(page);
      for (const c of base.cols) for (const b of c) { b.ice = 0; b.lid = false; }
      base.cols[0][0].ice = base.presses + 3;
      const okSet = await page.evaluate((s) => window.AmaiGame.setState(s), base);
      check('こおりの手前の箱（残り 3）の局面を setState で入れられる', okSet === true, okSet);
      await wait(page, 150);
      const iceOf = () => page.evaluate(() => document.querySelector('.box.front[data-col="0"]')?.dataset.ice ?? null);
      check(`こおりの手前の箱の data-ice が "3"（${await iceOf()}）、aria-label に「こおり」「あと 3」`, (await iceOf()) === '3' && await page.evaluate(() => /こおり/.test(document.querySelector('.box.front[data-col="0"]').getAttribute('aria-label')) && /3/.test(document.querySelector('.box.front[data-col="0"]').getAttribute('aria-label'))), null);
      await page.evaluate(() => window.__plays.splice(0));
      await page.click('.box.front[data-col="0"]'); await wait(page, 150);
      const dn = await gs(page), hint = await hintText(page), pl1 = (await plays(page)).map((p) => p.n);
      check(`こおりの箱を押すと、わくに入らず（わく ${dn.slots.filter(Boolean).length} 個）、#hint に「こおって いるよ」（${hint}）、音 deny（${pl1.join(',')}）`,
        dn.slots.every((x) => x === null) && dn.presses === base.presses && /こおって いるよ/.test(hint || '') && pl1.includes('deny') && (await iceOf()) === '3', { slots: dn.slots, hint, pl1 });
      const reasons = [];
      for (const [i, c] of [1, 2, 3].entries()) {
        const k = await pressCol(page, c); await skipG(page); await wait(page, 100);
        reasons.push(k);
        const left = 3 - (i + 1);
        const ice = await iceOf();
        const thawed = (await plays(page)).some((p) => p.n === 'thaw');
        check(`ほかの列 ${c} を押す（${k}）：こおりの残りが ${left}（data-ice ${ice}）${left === 0 ? '、音 thaw が鳴る（' + thawed + '）' : ''}`, k === 'press' && ice === String(left) && (left === 0 ? thawed : !thawed), { k, ice, thawed });
      }
      // わくは 3 つ：3 回押すと埋まるので、アリが運んでわくが空くまで待ってから押す
      for (let i = 0; i < 60 && (await gs(page)).slots.every((x) => x !== null); i++) { await skipG(page); await wait(page, 100); }
      const k0 = await pressCol(page, 0); await skipG(page);
      const fin = await gs(page);
      check(`とけたあとは押せて、わくに入る（${k0}・わくの箱 ${fin.slots.filter(Boolean).length} 個）`, k0 === 'press' && fin.slots.filter(Boolean).length >= 1, fin.slots);
      await ctx.close();
    },
  },
  {
    id: 'AW21', tier: 'full', title: 'あまいもの クリアの演出中：？・ずかん・やりなおし（R）を押しても、そのカードを重ねずクリアのカードが残り、つぎの めんへ が押せる',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'AW21', { opts: { touch: false } });
      for (const how of ['help', 'book', 'restart']) {
        await gotoG(page, { 'amai.save': null });
        const s0 = await toCelebrating(page);
        check(`${how}：クリアの演出中（won・カードまだ）を つかまえた`, !!s0, s0);
        if (!s0) continue;
        if (how === 'help') await page.click('#helpBtn');
        else if (how === 'book') await page.click('#bookBtn');
        else await page.keyboard.press('r');
        // 押したものは開かない。カードは演出が終わってから出る（3 秒まで待つ。その間に別のカードが出たら不合格）
        let other = null;
        for (let i = 0; i < 60; i++) { const ov = (await gs(page)).overlay; if (ov !== null) { if (ov !== 'clear') other = ov; break; } await wait(page, 50); }
        check(`${how}：押したもののカード（help・book・confirm）を出さない（${other}）`, other === null, other);
        const s1 = await gs(page), o1 = await overlayInfo(page);
        check(`${how}：押したあと overlay "clear"（${s1.overlay}）で、クリアのカード（${o1.cmds.join(',')}）が出ている`, s1.overlay === 'clear' && s1.phase === 'clear' && o1.shown && o1.cmds.includes('next'), { s1: s1.overlay, o1 });
        await wait(page, 600);
        await clickCmd(page, 'next'); await wait(page, 200);
        const s2 = await gs(page);
        check(`${how}：つぎの めんへ で 2 面が始まる（面 ${s2.level}・overlay ${s2.overlay}・phase ${s2.phase}）`, s2.level === 2 && s2.overlay === null && s2.phase === 'play', s2);
      }
      await ctx.close();
    },
  },
  {
    id: 'AW22', tier: 'full', title: 'あまいもの 演出中に離れて戻る：クリアの演出中に pagehide → pageshow（bfcache）でも、裏（hidden）→ 表でも、戻ったあとクリアのカードが出る',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'AW22');
      await gotoG(page, { 'amai.save': null });
      const s0 = await toCelebrating(page);
      check('クリアの演出中（won・カードまだ）を つかまえた', !!s0, s0);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      await wait(page, 2000);
      const mid = (await gs(page)).overlay;
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await wait(page, 3000);
      const s1 = await gs(page), o1 = await overlayInfo(page);
      check(`pagehide → pageshow（persisted）のあと、クリアのカードが出る（離れている間 ${mid}・戻ったあと ${s1.overlay}・${o1.cmds.join(',')}）`, s1.overlay === 'clear' && o1.cmds.includes('next') && !s1.stale, { mid, s1 });
      await gotoG(page, { 'amai.save': null });
      const s2 = await toCelebrating(page);
      check('（裏）クリアの演出中を つかまえた', !!s2, s2);
      await setHidden(page, true); await wait(page, 3000);
      const h = await gs(page);
      await setHidden(page, false); await wait(page, 3000);
      const s3 = await gs(page);
      check(`裏 → 表に戻ったあと、クリアのカードが出る（裏の間 ${h.overlay}・戻ったあと ${s3.overlay}）`, s3.overlay === 'clear' && !s3.paused, { h: h.overlay, s3 });
      await ctx.close();
    },
  },
  {
    id: 'AW23', tier: 'full', title: 'あまいもの 1手もどし なし：1手もどすを使わずにクリアするとカードに「1手もどし なし！」・amai.clean に入り・ずかんの名前の横に ★。もどした面・途中から再開した面では出さない。壊れた amai.clean でも落ちない',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'AW23');
      const WORD = '1手もどし なし！';
      const hasClean = (raw, id) => page.evaluate(([raw, id]) => { const L = window.AmaiLogic; return typeof L.hasClean === 'function' ? L.hasClean(raw, id) : 'no hasClean'; }, [raw, id]);
      const starOf = (id) => page.evaluate((id) => { const li = document.querySelector(`#card ul.book li[data-id="${id}"]`); return li ? { star: !!li.querySelector('.star'), text: li.textContent } : null; }, id);
      // (a) もどさずにクリア
      await gotoG(page, { 'amai.save': null });
      const { s } = await solveToClear(page);
      const o = await overlayInfo(page), raw = await stored(page, 'amai.clean');
      check(`もどさずにクリア：カードに「${WORD}」（${o.text.slice(0, 60)}）`, s.overlay === 'clear' && o.text.includes(WORD), o.text);
      check(`amai.clean に ${s.picture} が入る（${raw}・hasClean ${await hasClean(raw, s.picture)}）`, typeof raw === 'string' && (await hasClean(raw, s.picture)) === true, raw);
      await wait(page, 600);
      await clickCmd(page, 'book'); await wait(page, 150);
      const st = await starOf(s.picture);
      check(`ずかんで ${s.picture} の名前の横に ★（${J(st)}）`, !!st && st.star, st);
      // (b) 1手もどしてからクリア
      await gotoG(page, { 'amai.save': null });
      const sol = await solutionOf(page);
      await pressCol(page, sol[0]); await skipG(page);
      await page.click('#undoBtn'); await wait(page, 100);
      const sb = await gs(page);
      check(`1手もどして押した数 0・t 0（${sb.presses}・${sb.t}）`, sb.presses === 0 && sb.t === 0, sb);
      const { s: s4 } = await solveToClear(page);
      const o4 = await overlayInfo(page), raw4 = await stored(page, 'amai.clean');
      check(`もどしてからクリア：カードに「もどし」の文が出ない・責める言葉も無い（${o4.text.slice(0, 60)}）、amai.clean は書かない（${raw4}）`, s4.overlay === 'clear' && !o4.text.includes('もどし') && raw4 === null, { t: o4.text, raw4 });
      // (c) 途中から再開した面
      await gotoG(page, { 'amai.save': null });
      const sol5 = await solutionOf(page);
      await settleG(page); await pressCol(page, sol5[0]); await skipG(page); await wait(page, 200);
      await page.reload(); await wait(page, 300);
      for (const c of sol5.slice(1)) { await settleG(page); const k = await pressCol(page, c); if (k !== 'press') break; await skipG(page); }
      const s5 = await toClear(page), o5 = await overlayInfo(page);
      check(`途中から再開してクリア：「もどし」の文を出さない（${s5.overlay}・${o5.text.slice(0, 60)}）`, s5.overlay === 'clear' && !o5.text.includes('もどし'), o5.text);
      // (d) 壊れた amai.clean
      for (const bad of ['{bad', '{"ids":5}', '[1,2]', '{"ids":[null,{},"ringo","ringo"]}']) {
        await gotoG(page, { 'amai.save': null, 'amai.clean': bad });
        const { s: s6 } = await solveToClear(page);
        const o6 = await overlayInfo(page), raw6 = await stored(page, 'amai.clean');
        await wait(page, 600);
        await clickCmd(page, 'book'); await wait(page, 150);
        const st6 = await starOf(s6.picture);
        check(`壊れた amai.clean（${bad}）でも落ちず、カードに「${WORD}」・ずかんに ★（保存 ${raw6}）`, s6.overlay === 'clear' && o6.text.includes(WORD) && !!st6 && st6.star && (await hasClean(raw6, s6.picture)) === true, { raw6, st6 });
      }
      await ctx.close();
    },
  },
  {
    id: 'AW24', tier: 'full', title: 'あまいもの カードとフォーカス：カードを開いている間は #playView が inert で、Tab は a#back・？・♪・カードの中だけを回り、遊びの箱・わく・下のボタンに行かない。閉じたら inert が外れ、Tab で遊びの部品に戻る',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'AW24', { help: false, opts: { touch: false } });
      const where = () => page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return 'body'; if (a.closest('#playView')) return 'play:' + (a.id || a.className); if (a.closest('#card')) return 'card'; if (a.closest('.head')) return 'head:' + (a.id || a.textContent.trim()); return 'other:' + a.tagName; });
      const tabs = async (n) => { const r = []; for (let i = 0; i < n; i++) { await page.keyboard.press('Tab'); r.push(await where()); } return r; };
      for (const kind of ['help', 'book']) {
        if (kind === 'book') { await page.click('#bookBtn'); await wait(page, 150); }
        const inert = await page.evaluate(() => document.querySelector('#playView').hasAttribute('inert'));
        const r = await tabs(12);
        const bad = r.filter((x) => x.startsWith('play:') || x.startsWith('other:'));
        check(`${kind} のカード：#playView が inert（${inert}）、Tab 12 回で遊びの部品に行かず（${r.join(' ')}）、a#back とカードの中を通る`, inert && bad.length === 0 && r.includes('card') && r.includes('head:back'), r);
        await page.keyboard.press('Escape'); await wait(page, 150);
        const after = await page.evaluate(() => ({ inert: document.querySelector('#playView').hasAttribute('inert'), ov: window.AmaiGame.getState().overlay }));
        const r2 = await tabs(12);
        check(`${kind} を閉じると inert が外れ（${after.inert}）、Tab で遊びの部品に行ける（${r2.join(' ')}）`, after.ov === null && !after.inert && r2.some((x) => x.startsWith('play:')), { after, r2 });
      }
      await ctx.close();
    },
  },
];
