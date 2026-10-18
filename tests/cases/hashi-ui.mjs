// HW: ハシわたりの画面（games/hashi/）。契約は docs/hashi-contract.md（§8 DOM・§9 進行・§12 テスト）。
//   画面の DOM は契約だけに頼る：a#back・#helpBtn・#soundBtn・#playView[data-phase]・#hud・#score・#best・#lives・#streak・#streakBox・
//     #stageWrap[data-holding]・canvas#stage・#hint・#overlay・#card・.overlay [data-cmd=again/menu/close/resume]・.overlay [data-set=slow/guide]
//   テスト用の公開 API（契約 §12）：window.HashiGame = { getState, holdFor(ms), lenToCross, setRandom(seq), skip }
//   計算ロジックは HL（hashi-logic.mjs）で確かめ済み。ここでは画面の中の HashiLogic を「期待値の計算機」として使う。
//   無いときに合格にしない（空振りの合格を作らない。契約 §12・§13-9）：HashiGame が無ければ例外で不合格にする。
//   smoke：HW1〜HW4。full：HW5〜HW13（HW11 は CDP のタッチ操作なので Chromium だけ）。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, view, custom, newPage, seed, wait, frozen, layoutProbe, swInfo, sleep, touch, SFX_SPY, plays } from '../lib.mjs';

const HU = BASE + 'games/hashi/';
const SMOKE_V = () => view('SE', 'p', 'app');
const STD_V = () => view('i13', 'p', 'app');
const CDP = 'CDP のタッチ操作（連続タップ・押しっぱなし）';
const MAX16 = '9007199254740991';

// ---------- 開く ----------
async function openH(browser, label, { v = STD_V(), opts = {}, extra = {}, help = true } = {}) {
  const { ctx, page } = await newPage(browser, v, label, { clock: true, ...opts });
  await gotoH(page, extra, { help });
  return { ctx, page };
}
// 初回だけ出る遊び方は、見たことにして始める（help: false なら出る状態で始める）
async function gotoH(page, extra = {}, { help = true } = {}) {
  await seed(page, { ...(help ? { 'hashi.help': '1' } : {}), ...extra });
  await page.goto(HU); await wait(page, 300);
  const has = await page.evaluate(() => !!window.HashiGame && typeof window.HashiGame.getState === 'function');
  if (!has) throw new Error('window.HashiGame.getState が無い（games/hashi/main.js が読まれていないか、テスト用 API が未実装）');
}

// ---------- 読む ----------
const gs = (p) => p.evaluate(() => window.HashiGame.getState());
const phaseOf = async (p) => (await gs(p)).phase;
const domNums = (p) => p.evaluate(() => {
  const n = (id) => { const e = document.querySelector('#' + id); if (!e) return null; const t = e.textContent.replace(/[^\d]/g, ''); return t === '' ? null : Number(t); };
  const sb = document.querySelector('#streakBox');
  return { score: n('score'), best: n('best'), lives: n('lives'), streak: n('streak'), streakShown: !!sb && !sb.hidden && !sb.closest('[hidden]') };
});
const overlayInfo = (p) => p.evaluate(() => {
  const ov = document.querySelector('#overlay');
  const shown = !!ov && !ov.hidden && getComputedStyle(ov).display !== 'none';
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none'; };
  const cmds = shown ? [...ov.querySelectorAll('[data-cmd]')].filter(vis).map((b) => b.dataset.cmd) : [];
  const sets = shown ? [...ov.querySelectorAll('[data-set]')].filter(vis).map((b) => ({ set: b.dataset.set, pressed: b.getAttribute('aria-pressed') })) : [];
  return { shown, cmds, sets, text: shown ? (ov.querySelector('#card')?.textContent || '').replace(/\s+/g, ' ').trim() : '' };
});
const hintText = (p) => p.evaluate(() => document.querySelector('#hint')?.textContent.trim() ?? null);
const holdingAttr = (p) => p.evaluate(() => document.querySelector('#stageWrap')?.dataset.holding ?? null);
const stored = (p, k) => p.evaluate((k) => { try { return localStorage.getItem(k); } catch { return 'ERR'; } }, k);
// 今の葉と渡る先から、いろいろな長さを計算する（ロジックは画面の中の HashiLogic を使う）
const lens = (p) => p.evaluate(() => {
  const s = window.HashiGame.getState();
  const [a, b] = s.platforms;
  const right = a.x + a.w;
  return { right, perfect: window.HashiGame.lenToCross(), edgeL: b.x - right, edgeR: b.x + b.w - right, short: Math.max(0, b.x - right - 30), long: b.x + b.w - right + 30, center: b.x + b.w / 2 };
});
// 長さ len になるだけ押す（holdFor：注入した時刻で down→up）。成否を返す
const holdLen = (p, len) => p.evaluate((len) => {
  const s = window.HashiGame.getState();
  const ms = window.HashiLogic.holdForLength(len, { slow: !!s.slow });
  return window.HashiGame.holdFor(ms);
}, len);
// アニメーションを終わりまで進める（ready・over（カード表示）・paused のどれかで止まる）。途中の #hint の文言を集める
async function settle(p, maxSteps = 120) {
  const hints = new Set();
  for (let i = 0; i < maxSteps; i++) {
    const s = await gs(p), ov = await overlayInfo(p);
    const h = await hintText(p); if (h) hints.add(h);
    if (s.phase === 'ready' && !ov.shown) return { s, hints: [...hints] };
    if (s.phase === 'over' && ov.shown) return { s, hints: [...hints] };
    if (s.phase === 'paused') return { s, hints: [...hints] };
    await p.evaluate(() => window.HashiGame.skip()); await wait(p, 60);
  }
  return { s: await gs(p), hints: [...hints], timeout: true };
}
// skip を使わず、時間を進めながら phase を待つ
async function waitPhase(p, phases, maxMs = 4000, step = 16) {
  for (let t = 0; t <= maxMs; t += step) { if (phases.includes(await phaseOf(p))) return true; await wait(p, step); }
  return false;
}
async function waitOverlay(p, maxMs = 6000, step = 30) {
  for (let t = 0; t <= maxMs; t += step) { if ((await overlayInfo(p)).shown) return true; await wait(p, step); }
  return false;
}
// 3回落ちて結果カードまで（短すぎる長さで）
async function loseRun(p) {
  let r;
  for (let i = 0; i < 3; i++) {
    const L = await lens(p);
    if (!(await holdLen(p, L.short))) throw new Error(`holdFor が受け付けない（${i + 1} 回目の落下、phase=${await phaseOf(p)}）`);
    r = await settle(p);
  }
  return r;
}
// 隠れる・戻る（visibilitychange を再現する）
const setHidden = (p, hidden) => p.evaluate((h) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);
const reachable = (p, sel) => p.evaluate((s) => {
  const e = document.querySelector(s); if (!e) return false;
  const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false;
  const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!t && (t === e || e.contains(t));
}, sel);
const stageCenter = (p) => p.evaluate(() => { const r = document.querySelector('#stageWrap').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
const clickCmd = (p, cmd) => p.evaluate((c) => { const b = document.querySelector(`#overlay:not([hidden]) [data-cmd="${c}"]`); if (!b) return false; b.click(); return true; }, cmd);
const blurAll = (p) => p.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
const sameNums = (s, d) => d.score === s.score && d.lives === s.lives && d.best === s.best;

// 結果・遊び方・一時停止のカード：見出しが切れず、全ボタンに届き 44px 以上
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
      x.scrollIntoView({ block: 'center' });   // 利用者がカードを縦にスクロールして届かせる位置（nearest だと下の safe-area の端に付く）
      const q = x.getBoundingClientRect();
      res.btns.push({ cmd: x.dataset.cmd || x.dataset.set || x.textContent.trim(), w: Math.round(q.width), h: Math.round(q.height), rect: [q.left, q.top, q.right, q.bottom].map(Math.round), inside: q.top >= t - 0.5 && q.bottom <= innerHeight - b + 0.5 && q.left >= l - 0.5 && q.right <= innerWidth - r + 0.5 });
    }
    ov.scrollTop = 0;
    res.hscroll = document.documentElement.scrollWidth > innerWidth;
    return res;
  }, safe);
}
const overlayOk = (o) => o.head && o.btns.length > 0 && o.headTop >= 0 && !o.hscroll && o.btns.every((b) => b.inside && b.h >= 43.5 && b.w >= 43.5);

// 舞台（canvas）に渡した view を記録する（HashiRender.create の draw を包む）
const RENDER_SPY = () => {
  let v;
  Object.defineProperty(window, 'HashiRender', { configurable: true, get: () => v, set(x) {
    const oc = x.create;
    x.create = function (...a) { const r = oc.apply(this, a); const od = r.draw; r.draw = function (view) { window.__hrView = view; return od.apply(this, arguments); }; return r; };
    v = x;
  } });
};

export const tests = [
  // ================= smoke =================
  {
    id: 'HW1', tier: 'smoke', title: 'ハシわたり：ぴったりの長さで渡ると点が入り（1＋ボーナス）、#score・#lives・#best・#streak の文字が getState() と一致する（表示の1ずれなし）',
    async run({ browser, check }) {
      const { ctx, page } = await openH(browser, 'HW1', { v: SMOKE_V() });
      const api = await page.evaluate(() => ({ keys: Object.keys(window.HashiGame).sort(), frozen: Object.isFrozen(window.HashiGame), L: typeof window.HashiLogic?.resolve }));
      const need = ['getState', 'holdFor', 'lenToCross', 'setRandom', 'skip'];
      check(`window.HashiGame に ${need.join('・')} があり凍結されている、HashiLogic が読める`, need.every((k) => api.keys.includes(k)) && api.frozen && api.L === 'function', api);
      const s0 = await gs(page), d0 = await domNums(page);
      const LIVES = await page.evaluate(() => window.HashiLogic.LIVES);
      check(`はじめ：phase=ready・score 0・lives ${LIVES}・bridgeLen 0、表示も同じ（いま ${d0.score}・のこり ${d0.lives}・ベスト ${d0.best}）`,
        s0.phase === 'ready' && s0.score === 0 && s0.lives === LIVES && s0.bridgeLen === 0 && sameNums(s0, d0) && !d0.streakShown, { s0, d0 });
      const ph = await page.evaluate(() => document.querySelector('#playView')?.dataset.phase);
      check(`#playView[data-phase] が getState().phase と同じ（${ph}）`, ph === s0.phase, ph);
      // ぴったり
      const L1 = await lens(page);
      const ok1 = await holdLen(page, L1.perfect);
      const { s: s1 } = await settle(page);
      const d1 = await domNums(page);
      const bonus1 = await page.evaluate(() => window.HashiLogic.perfectBonus(1));
      check(`ぴったりで渡る：holdFor 成功、score ${s1.score}（=1+${bonus1}）・crossed 1・streak 1・lastOutcome は cross/perfect`,
        ok1 === true && s1.phase === 'ready' && s1.score === 1 + bonus1 && s1.crossed === 1 && s1.streak === 1 && s1.lastOutcome?.kind === 'cross' && s1.lastOutcome?.perfect === true, { ok1, s1 });
      check(`表示が state と一致：いま ${d1.score}/${s1.score}・のこり ${d1.lives}/${s1.lives}・ベスト ${d1.best}/${s1.best}・ぴったり ${d1.streak}/${s1.streak}（#streakBox が見える）`,
        sameNums(s1, d1) && d1.streakShown && d1.streak === s1.streak, { s1, d1 });
      // ぴったりでない（左端の少し先）
      const L2 = await lens(page);
      await holdLen(page, L2.edgeL + 2);
      const { s: s2 } = await settle(page);
      const d2 = await domNums(page);
      check(`端に乗る（ぴったりでない）：score +1（${s1.score}→${s2.score}）・streak 0・crossed 2`, s2.score === s1.score + 1 && s2.streak === 0 && s2.crossed === 2 && s2.lastOutcome?.kind === 'cross' && s2.lastOutcome?.perfect === false, s2);
      check(`表示が state と一致（いま ${d2.score}・のこり ${d2.lives}・ベスト ${d2.best}）、streak 0 で #streakBox は隠れる`, sameNums(s2, d2) && !d2.streakShown, { s2, d2 });
      await ctx.close();
    },
  },
  {
    id: 'HW2', tier: 'smoke', title: 'ハシわたり：落ちると lives が1減り同じ葉からやり直し（葉の並びは同じ）、「みじかすぎ／ながすぎ」、3回で結果カード（again・menu）、again で score 0・lives 3・ready',
    async run({ browser, check }) {
      const { ctx, page } = await openH(browser, 'HW2', { v: SMOKE_V() });
      const s0 = await gs(page);
      const plat0 = JSON.stringify(s0.platforms);
      // 1回目：みじかすぎ
      const L1 = await lens(page);
      check('holdFor が ready で受け付ける', await holdLen(page, L1.short) === true);
      const r1 = await settle(page);
      const d1 = await domNums(page);
      check(`みじかすぎで落ちる：lives ${s0.lives}→${r1.s.lives}、lastOutcome fall/short、score そのまま、ready に戻り bridgeLen 0`,
        r1.s.lives === s0.lives - 1 && r1.s.lastOutcome?.kind === 'fall' && r1.s.lastOutcome?.reason === 'short' && r1.s.score === s0.score && r1.s.phase === 'ready' && r1.s.bridgeLen === 0, r1.s);
      check('同じ葉からやり直す（platforms が落ちる前と同じ）', JSON.stringify(r1.s.platforms) === plat0, { before: s0.platforms, after: r1.s.platforms });
      check(`#lives の表示（${d1.lives}）が state（${r1.s.lives}）と一致`, d1.lives === r1.s.lives && d1.score === r1.s.score, d1);
      check(`#hint に「みじかすぎ」が出る（${r1.hints.join(' / ')}）`, r1.hints.some((h) => h.includes('みじかすぎ')), r1.hints);
      // 2回目：ながすぎ
      const L2 = await lens(page);
      await holdLen(page, L2.long);
      const r2 = await settle(page);
      check(`ながすぎで落ちる：lives ${r2.s.lives}、lastOutcome fall/long、platforms は同じ`, r2.s.lives === s0.lives - 2 && r2.s.lastOutcome?.reason === 'long' && JSON.stringify(r2.s.platforms) === plat0, r2.s);
      check(`#hint に「ながすぎ」が出る（${r2.hints.join(' / ')}）`, r2.hints.some((h) => h.includes('ながすぎ')), r2.hints);
      // 3回目：おわり
      const L3 = await lens(page);
      await holdLen(page, L3.short);
      const r3 = await settle(page);
      const ov = await overlayInfo(page);
      const card = await page.evaluate(() => ({ title: !!document.querySelector('#card #cardTitle'), focus: document.activeElement?.dataset?.cmd || null, order: [...document.querySelectorAll('#card [data-cmd]')].map((b) => b.dataset.cmd) }));
      check(`3回落ちると over・lives 0、結果カードに again と menu（${ov.cmds.join(',')}）、見出し #cardTitle`, r3.s.phase === 'over' && r3.s.lives === 0 && ov.shown && ov.cmds.includes('again') && ov.cmds.includes('menu') && card.title, { s: r3.s, ov, card });
      check(`結果カード：1つ目のボタンが again でフォーカスもそこ（${card.order.join(',')}・focus=${card.focus}）`, card.order[0] === 'again' && card.focus === 'again', card);
      check(`over の後は holdFor を受け付けない`, await page.evaluate(() => window.HashiGame.holdFor(500)) === false && (await gs(page)).lives === 0);
      // もう一度（カードを出して 400ms は押せないので待つ）
      await wait(page, 500);
      await page.click('#overlay [data-cmd="again"]'); await wait(page, 400);
      const s4 = await gs(page), d4 = await domNums(page), ov4 = await overlayInfo(page);
      check(`「もう一度」で score 0・lives ${s0.lives}・crossed 0・ready、カードが閉じ、表示も同じ（いま ${d4.score}・のこり ${d4.lives}）`,
        s4.score === 0 && s4.lives === s0.lives && s4.crossed === 0 && s4.phase === 'ready' && !ov4.shown && sameNums(s4, d4), { s4, d4, ov4 });
      await ctx.close();
    },
  },
  {
    id: 'HW3', tier: 'smoke', title: 'ハシわたり データ：hashi.best が回の途中で更新され、壊れた保存値でも落ちず 0 と表示、低い点では下げない、ほかのゲームの保存を触らない、メニューにもベスト',
    async run({ browser, check }) {
      const { ctx, page } = await openH(browser, 'HW3', { v: SMOKE_V(), extra: { 'blockpuzzle.best': '777' } });
      const s0 = await gs(page);
      check(`保存なし：best 0、#best「0」、hashi.best は未保存（${await stored(page, 'hashi.best')}）`, s0.best === 0 && (await domNums(page)).best === 0, s0);
      const L = await lens(page);
      await holdLen(page, L.perfect);
      const { s: s1 } = await settle(page);
      const v1 = await stored(page, 'hashi.best');
      check(`回の途中（phase ${s1.phase}・lives ${s1.lives}）で hashi.best が「${v1}」＝score ${s1.score}、#best も同じ`, s1.phase === 'ready' && s1.score > 0 && v1 === String(s1.score) && s1.best === s1.score && (await domNums(page)).best === s1.score, { s1, v1 });
      check('ほかのゲームの保存（blockpuzzle.best）を触らない', await stored(page, 'blockpuzzle.best') === '777');
      // 高いベストは下げない
      await gotoH(page, { 'hashi.best': '50' });
      const L2 = await lens(page);
      await holdLen(page, L2.perfect); await settle(page);
      await loseRun(page);
      check(`ベスト 50 より低い点で終わっても hashi.best は「50」のまま、#best 50`, await stored(page, 'hashi.best') === '50' && (await domNums(page)).best === 50, await stored(page, 'hashi.best'));
      // 壊れた保存値
      const bads = ['abc', '-1', '1.5', 'NaN', 'Infinity', '{}', '1e400', '9007199254740992', ''];
      const bad = [];
      for (const raw of bads) {
        await gotoH(page, { 'hashi.best': raw });
        const s = await gs(page), d = await domNums(page);
        if (!(s.best === 0 && d.best === 0 && s.phase === 'ready')) bad.push({ raw, best: s.best, shown: d.best, phase: s.phase });
      }
      check(`壊れた保存値 ${bads.length} 種（${bads.map((b) => JSON.stringify(b)).join(' ')}）で開け、best 0・#best「0」`, bad.length === 0, bad);
      // 壊れた値のあと、渡ると正しい値で書き直す
      await gotoH(page, { 'hashi.best': '-1' });
      const L3 = await lens(page);
      await holdLen(page, L3.edgeL + 2); const { s: s3 } = await settle(page);
      check(`壊れた値（-1）のあと渡ると hashi.best が「${await stored(page, 'hashi.best')}」＝score ${s3.score} に直る`, s3.score === 1 && await stored(page, 'hashi.best') === '1', s3);
      // メニューのカード
      const menuText = async (raw) => {
        await seed(page, { 'hashi.best': raw }); await page.goto(BASE); await wait(page, 300);
        return page.evaluate(() => { const a = [...document.querySelectorAll('a')].find((x) => /games\/hashi\/?$/.test(x.getAttribute('href') || '')); return a ? a.textContent.replace(/\s+/g, ' ').trim() : null; });
      };
      const m1 = await menuText('12'), m2 = await menuText('-1');
      check(`メニューのハシわたりのカードにベスト 12 が出る（${m1}）、壊れた値（-1）では数字が出ない（${m2}）`, m1 !== null && /12/.test(m1) && m2 !== null && !/\d/.test(m2), { m1, m2 });
      await ctx.close();
    },
  },
  {
    id: 'HW4', tier: 'smoke', title: 'ハシわたり：遊び方・プレイ中（ready・押している間・歩く間）・一時停止・結果カードのどこからでも a#back でメニューへ戻れる',
    async run({ browser, check }) {
      const { ctx, page } = await openH(browser, 'HW4', { v: SMOKE_V(), help: false });
      check('a#back の href は ../../ でメニュー（BASE）を指す', await page.evaluate(() => document.querySelector('a#back')?.href) === BASE, await page.evaluate(() => document.querySelector('a#back')?.getAttribute('href')));
      const r = {};
      // 初回は遊び方が自動で出る
      const h = await overlayInfo(page);
      check(`初回は遊び方が自動で出る（close があり、設定 slow・guide の切り替え：${h.sets.map((x) => x.set).join(',')}）`, h.shown && h.cmds.includes('close') && ['slow', 'guide'].every((k) => h.sets.some((x) => x.set === k)), h);
      r.help = await reachable(page, 'a#back');
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      r.helpNav = page.url() === BASE;
      // プレイ中
      await gotoH(page);
      r.ready = await reachable(page, 'a#back');
      const [cx, cy] = await stageCenter(page);
      await page.mouse.move(cx, cy); await page.mouse.down(); await wait(page, 200);
      r.growingPhase = await phaseOf(page);
      r.growing = await reachable(page, 'a#back');
      await page.mouse.up();
      await settle(page);
      const L = await lens(page);
      await holdLen(page, L.perfect);
      r.walkSeen = await waitPhase(page, ['walking']);
      r.walking = await reachable(page, 'a#back');
      // 一時停止（歩く間に隠れる → 戻るとカード）
      await setHidden(page, true); await wait(page, 50);
      await setHidden(page, false); await wait(page, 100);
      const pv = await overlayInfo(page);
      r.paused = (await phaseOf(page)) === 'paused' && pv.shown && await reachable(page, 'a#back');
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      r.pausedNav = page.url() === BASE;
      // 結果カード
      await gotoH(page);
      await loseRun(page);
      const ov = await overlayInfo(page);
      r.over = ov.shown && ov.cmds.includes('menu') && await reachable(page, 'a#back');
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      r.overNav = page.url() === BASE;
      check(`どの状態でも a#back が見えて押せる（遊び方・ready・押している間[${r.growingPhase}]・歩く間・一時停止カード[${pv.cmds.join(',')}]・結果カード）`,
        r.help && r.ready && r.growingPhase === 'growing' && r.growing && r.walkSeen && r.walking && r.paused && r.over, { r, pv, ov });
      check('遊び方・一時停止・結果カードから a#back で実際にメニューが開く', r.helpNav && r.pausedNav && r.overNav, r);
      // 結果カードの「メニューへ」
      await gotoH(page);
      await loseRun(page);
      await wait(page, 500);
      await page.click('#overlay [data-cmd="menu"]'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('結果カードの「メニューへ」（data-cmd=menu）でメニューが開く', page.url() === BASE && await page.locator('a.game').count() >= 2, page.url());
      await ctx.close();
    },
  },

  // ================= full =================
  {
    id: 'HW5', tier: 'full', title: 'ハシわたり 画面内：SE 縦・SE 横（568×320・667×375）・13 横・iPad 縦横で、ボタン 44×44 以上・safe-area 内、.head・#hud・#stageWrap・#hint が重ならない、16 桁のベストではみ出さない、#hint の高さが変わらない',
    async run({ browser, check }) {
      const views = [view('SE', 'p', 'app'), view('SE', 'l', 'app'), custom(667, 375, [0, 0, 0, 0], 'SE2横 667×375'), view('i13', 'l', 'app'), view('iPad', 'p', 'app'), view('iPad', 'l', 'app')];
      for (const v of views) {
        const { ctx, page } = await openH(browser, 'HW5 ' + v.label, { v, extra: { 'hashi.best': MAX16 } });
        const head = `${v.label} ${v.w}×${v.h}`;
        const lp = await layoutProbe(page, '#back, #helpBtn, #soundBtn, #hud, #stageWrap, #hint, #score, #best, #lives', v.safe,
          { overlapSel: '.head, #hud, #stageWrap, #hint', minSel: '#back, #helpBtn, #soundBtn' });
        check(`${head}｜プレイ画面：9 要素が safe-area 内、.head・#hud・#stageWrap・#hint が重ならず、戻る・？・♪ は 44px 以上、横スクロールなし`,
          lp.n >= 9 && !lp.outside.length && !lp.overlaps.length && !lp.small.length && !lp.hscroll, lp);
        const fit = await page.evaluate(() => {
          const b = document.querySelector('#best'), hud = document.querySelector('#hud').getBoundingClientRect(), q = b.getBoundingClientRect();
          const stats = [...document.querySelectorAll('#hud .stat')].filter((e) => !e.closest('[hidden]')).map((e) => { const r = e.getBoundingClientRect(); return { cut: e.scrollWidth > e.clientWidth + 1, inHud: r.left >= hud.left - 0.5 && r.right <= hud.right + 0.5 && r.top >= hud.top - 0.5 && r.bottom <= hud.bottom + 0.5 }; });
          const fs = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize);
          const sw = document.querySelector('#stageWrap').getBoundingClientRect();
          return { text: b.textContent, digits: b.textContent.replace(/[^\d]/g, ''), ellipsis: /…|\.\.\./.test(b.textContent), cut: b.scrollWidth > b.clientWidth + 1, inHud: q.left >= hud.left - 0.5 && q.right <= hud.right + 0.5, stats, fsScore: fs('#score'), fsHint: fs('#hint'), stage: { w: Math.round(sw.width), h: Math.round(sw.height) } };
        });
        // 16 桁のときは字を縮めてよい（契約 §8）。ふだんの桁（下の short）では HUD の数字 20px 以上
        check(`${head}｜16 桁のベスト「${fit.text}」が省略されず #hud からはみ出さない（字は ${fit.fsScore}px まで縮めてよい）、案内 ${fit.fsHint}px≧16`,
          fit.digits === MAX16 && !fit.ellipsis && !fit.cut && fit.inHud && fit.stats.every((s) => !s.cut && s.inHud) && fit.fsHint >= 16, fit);
        check(`${head}｜長押しの面 #stageWrap が使える大きさ（${fit.stage.w}×${fit.stage.h}、幅 120・高さ 100 以上）`, fit.stage.w >= 120 && fit.stage.h >= 100, fit.stage);
        // 上向きの茎（最大 MAX_LEN）の先が canvas の中にある（背の低い横画面で上にはみ出さない）。横に見える幅は VIEW_W 以上
        const lay = await page.evaluate(() => {
          const r = document.querySelector('#stage').getBoundingClientRect();
          if (!window.HashiRender || typeof window.HashiRender.layout !== 'function') return { none: true };
          const o = window.HashiRender.layout(Math.round(r.width), Math.round(r.height));
          return { w: Math.round(r.width), h: Math.round(r.height), s: o.s, deckY: o.deckY, tipTop: o.deckY - window.HashiLogic.MAX_LEN * o.s, viewW: Math.round(r.width) / o.s, VW: window.HashiLogic.VIEW_W };
        });
        check(`${head}｜茎の長さ MAX_LEN の先が canvas（${lay.w}×${lay.h}）の中（先の y ${lay.tipTop?.toFixed?.(1)} ≧ 0、葉の高さ ${lay.deckY} < ${lay.h}）、横に見える幅 ${lay.viewW?.toFixed?.(0)} ≧ ${lay.VW}`,
          !lay.none && lay.tipTop >= 0 && lay.deckY < lay.h && lay.viewW >= lay.VW - 0.5, lay);
        // ふだんの桁（ベスト 2 桁・いま 0）では HUD の数字が 20px 以上
        await gotoH(page, { 'hashi.best': '42' });
        const fsN = await page.evaluate(() => Object.fromEntries(['score', 'best', 'lives'].map((id) => [id, parseFloat(getComputedStyle(document.querySelector('#' + id)).fontSize)])));
        check(`${head}｜ふだんの桁（ベスト 42）で HUD の数字が 20px 以上（いま ${fsN.score}・ベスト ${fsN.best}・のこり ${fsN.lives}px）`, Object.values(fsN).every((x) => x >= 20), fsN);
        await gotoH(page, { 'hashi.best': MAX16 });
        // #hint の高さ：落ちたときの文言でも変わらない
        const hb = await page.evaluate(() => { const r = document.querySelector('#hint').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height)]; });
        const L = await lens(page);
        await holdLen(page, L.short);
        await waitPhase(page, ['dropping', 'respawn']);
        const ha = await page.evaluate(() => { const r = document.querySelector('#hint').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), document.querySelector('#hint').textContent.trim()]; });
        check(`${head}｜#hint の位置と高さが文言が変わっても同じ（${hb.join(',')} → ${ha.slice(0, 2).join(',')}「${ha[2]}」）`, hb[0] === ha[0] && hb[1] === ha[1], { hb, ha });
        await settle(page);
        // 遊び方カード
        await page.click('#helpBtn'); await wait(page, 200);
        const hp = await overlayProbe(page, v.safe);
        check(`${head}｜遊び方カード：見出しが切れず、全ボタン（設定の切り替えも）に届き 44px 以上`, overlayOk(hp) && hp.btns.some((b) => b.cmd === 'slow') && hp.btns.some((b) => b.cmd === 'guide'), hp);
        await clickCmd(page, 'close'); await wait(page, 400);
        // 結果カード
        await gotoH(page, { 'hashi.best': MAX16 });
        await loseRun(page);
        const op = await overlayProbe(page, v.safe);
        check(`${head}｜結果カード：見出しが切れず、全ボタンに届き 44px 以上、a#back も押せる`, overlayOk(op) && op.btns.some((b) => b.cmd === 'again') && await reachable(page, 'a#back'), op);
        await ctx.close();
      }
    },
  },
  {
    id: 'HW6', tier: 'full', title: 'ハシわたり 中断：押している間に隠れると落ちずに ready（bridgeLen 0・lives そのまま）、歩く間に隠れると paused・timers 0、戻るとカード、resume で続く。遊び方を開いたときも同じ',
    async run({ browser, check }) {
      const { ctx, page } = await openH(browser, 'HW6');
      const [cx, cy] = await stageCenter(page);
      // a) 押している間に hidden
      await page.mouse.move(cx, cy); await page.mouse.down(); await wait(page, 250);
      const g = await gs(page), gh = await holdingAttr(page);
      check(`押している間：phase growing・bridgeLen ${g.bridgeLen?.toFixed?.(1)} > 0・#stageWrap[data-holding="${gh}"]`, g.phase === 'growing' && g.bridgeLen > 0 && gh === '1', { g, gh });
      await setHidden(page, true); await wait(page, 50);
      const a1 = await gs(page);
      check(`押している間に隠れる：落ちずに ready、bridgeLen 0、lives ${a1.lives}（そのまま）、data-holding="${await holdingAttr(page)}"`, a1.phase === 'ready' && a1.bridgeLen === 0 && a1.lives === g.lives && a1.lastOutcome === null && await holdingAttr(page) === '0', a1);
      await setHidden(page, false); await wait(page, 100);
      const ovA = await overlayInfo(page);
      await page.mouse.up(); await wait(page, 400);
      const a2 = await gs(page);
      check(`戻っても一時停止のカードは出ず（押していただけなので）、そのまま指を離しても落ちない（phase ${a2.phase}・lives ${a2.lives}）`, !ovA.shown && a2.phase === 'ready' && a2.lives === g.lives && a2.lastOutcome === null, { ovA, a2 });
      // b) 歩く間に hidden
      const L = await lens(page);
      check('取り消しの後も、新しい押下は受け付ける', await holdLen(page, L.perfect) === true);
      const exp = await page.evaluate(() => 1 + window.HashiLogic.perfectBonus(1));
      check('歩く（walking）まで進む', await waitPhase(page, ['walking']));
      await setHidden(page, true); await wait(page, 50);
      const b1 = await gs(page);
      check(`歩く間に隠れる：phase paused、timers ${b1.timers}（0）`, b1.phase === 'paused' && b1.timers === 0, b1);
      await wait(page, 1500);
      const b2 = await gs(page);
      check(`隠れている間は進まない（1.5 秒後も paused・crossed ${b2.crossed}）`, b2.phase === 'paused' && b2.crossed === b1.crossed && b2.timers === 0, b2);
      await setHidden(page, false); await wait(page, 100);
      const ovB = await overlayInfo(page);
      check(`戻ると一時停止のカード（${ovB.cmds.join(',')}）：resume・again・menu`, ovB.shown && ['resume', 'again', 'menu'].every((c) => ovB.cmds.includes(c)), ovB);
      await page.click('#overlay [data-cmd="resume"]'); await wait(page, 100);
      const b3 = await gs(page), ovB2 = await overlayInfo(page);
      check(`「つづける」でカードが閉じ、止めた所から続く（phase ${b3.phase}）`, !ovB2.shown && b3.phase !== 'paused', { b3, ovB2 });
      const { s: b4 } = await settle(page);
      check(`続けた結果、渡り終えて ready・score ${b4.score}（=${exp}）・crossed 1`, b4.phase === 'ready' && b4.score === exp && b4.crossed === 1, b4);
      // c) 歩く間に遊び方を開く
      const L2 = await lens(page);
      await holdLen(page, L2.edgeL + 2);
      await waitPhase(page, ['walking']);
      await page.click('#helpBtn'); await wait(page, 100);
      const c1 = await gs(page), ovC = await overlayInfo(page);
      check(`歩く間に「？」：phase paused・timers ${c1.timers}（0）・遊び方カード（close）`, c1.phase === 'paused' && c1.timers === 0 && ovC.shown && ovC.cmds.includes('close'), { c1, ovC });
      await clickCmd(page, 'close'); await wait(page, 100);
      const c2 = await gs(page);
      const { s: c3 } = await settle(page);
      check(`遊び方を閉じると続き（phase ${c2.phase}）、渡り終えて crossed 2・score ${c3.score}`, c2.phase !== 'paused' && c3.phase === 'ready' && c3.crossed === 2 && c3.score === exp + 1, { c2, c3 });
      // d) 押している間に遊び方を開く
      await wait(page, 400);
      await page.mouse.move(cx, cy); await page.mouse.down(); await wait(page, 250);
      const d0 = await gs(page);
      await page.evaluate(() => document.querySelector('#helpBtn').click()); await wait(page, 100);
      const d1 = await gs(page);
      await clickCmd(page, 'close'); await wait(page, 100);
      await page.mouse.up(); await wait(page, 400);
      const d2 = await gs(page);
      check(`押している間に「？」：取り消して ready・bridgeLen 0、閉じて指を離しても落ちない（lives ${d0.lives}→${d2.lives}）`,
        d0.phase === 'growing' && d1.phase === 'ready' && d1.bridgeLen === 0 && d2.phase === 'ready' && d2.lives === d0.lives && d2.crossed === d0.crossed, { d0, d1, d2 });
      await ctx.close();
    },
  },
  {
    id: 'HW7', tier: 'full', title: 'ハシわたり キーボード：Space・Enter の押下／離しで伸びて倒れる、repeat で伸び直さない、ボタンにフォーカス・カードが開いているときは反応しない、Esc で遊び方を閉じる、M で音',
    async run({ browser, check }) {
      const { ctx, page } = await openH(browser, 'HW7', { opts: { touch: false } });
      await blurAll(page);
      await page.keyboard.down('Space'); await wait(page, 200);
      const k1 = await gs(page), kh = await holdingAttr(page);
      await page.keyboard.down('Space'); await wait(page, 100);      // 押しっぱなしの repeat
      const k2 = await gs(page);
      check(`Space の keydown で伸びる（phase ${k1.phase}・bridgeLen ${k1.bridgeLen?.toFixed?.(1)}・data-holding ${kh}）`, k1.phase === 'growing' && k1.bridgeLen > 0 && kh === '1', { k1, kh });
      check(`repeat の keydown で伸び直さない（${k1.bridgeLen?.toFixed?.(1)} → ${k2.bridgeLen?.toFixed?.(1)}、増え続ける）`, k2.phase === 'growing' && k2.bridgeLen > k1.bridgeLen, { k1, k2 });
      await page.keyboard.up('Space'); await wait(page, 50);
      const k3 = await gs(page);
      const { s: k4 } = await settle(page);
      check(`Space の keyup で倒れる（phase ${k3.phase}）→ 判定される（${k4.lastOutcome?.kind}）`, k3.phase !== 'growing' && k3.phase !== 'ready' && !!k4.lastOutcome && ['cross', 'fall'].includes(k4.lastOutcome.kind), { k3, k4 });
      await wait(page, 400);
      await blurAll(page);
      await page.keyboard.down('Enter'); await wait(page, 200);
      const e1 = await gs(page);
      await page.keyboard.up('Enter'); await wait(page, 50);
      const { s: e2 } = await settle(page);
      check(`Enter でも同じ（phase ${e1.phase}、判定 ${e2.lastOutcome?.kind}、crossed+lives の変化あり）`, e1.phase === 'growing' && (e2.crossed !== k4.crossed || e2.lives !== k4.lives), { e1, e2 });
      // ボタンにフォーカスがあるとき
      await wait(page, 400);
      const before = await gs(page);
      const ap0 = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      await page.evaluate(() => { const b = document.querySelector('#soundBtn'); b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })); });
      await wait(page, 200);
      const f1 = await gs(page);
      await page.evaluate(() => document.querySelector('#soundBtn').dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, cancelable: true })));
      await wait(page, 300);
      const f2 = await gs(page);
      check(`ボタン（♪）にフォーカスがあるときの Space は長押しにならない（phase ${f1.phase}→${f2.phase}、lives・crossed そのまま）`,
        f1.phase === 'ready' && f2.phase === 'ready' && f2.lives === before.lives && f2.crossed === before.crossed && await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed')) === ap0, { f1, f2 });
      // カードが開いているとき
      await blurAll(page);
      await page.click('#helpBtn'); await wait(page, 200);
      const ov1 = await overlayInfo(page);
      await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })));
      await wait(page, 200);
      const o1 = await gs(page), oh = await holdingAttr(page);
      await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, cancelable: true })));
      await wait(page, 200);
      const o2 = await gs(page);
      check(`遊び方カードが開いているときの Space は長押しにならない（phase ${o1.phase}・data-holding ${oh}、lives そのまま）`, ov1.shown && o1.phase !== 'growing' && oh === '0' && o2.lives === before.lives && o2.crossed === before.crossed, { ov1, o1, o2 });
      await page.keyboard.press('Escape'); await wait(page, 200);
      check('Esc で遊び方カードが閉じる', !(await overlayInfo(page)).shown);
      // M で音のオン／オフ
      await blurAll(page);
      const m0 = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      await page.keyboard.press('m'); await wait(page, 100);
      const m1 = await page.evaluate(() => ({ ap: document.querySelector('#soundBtn').getAttribute('aria-pressed'), ls: localStorage.getItem('blockpuzzle.sound') }));
      await page.keyboard.press('m'); await wait(page, 100);
      const m2 = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      check(`M で音が切り替わる（aria-pressed ${m0}→${m1.ap}→${m2}、保存 ${m1.ls}）`, m0 === 'true' && m1.ap === 'false' && m1.ls === 'off' && m2 === 'true', { m0, m1, m2 });
      await ctx.close();
    },
  },
  {
    id: 'HW8', tier: 'full', title: 'ハシわたり タイマー：結果カードを出して 400ms 以内の again は効かない、そのあと again を連打しても runId が進んで新しい回になり、古い回の音（splash・over・peek）が鳴らず timers 0',
    async run({ browser, check }) {
      const { ctx, page } = await openH(browser, 'HW8', { opts: { initScript: SFX_SPY } });
      for (let i = 0; i < 2; i++) { const L = await lens(page); await holdLen(page, L.short); await settle(page); }
      const L = await lens(page);
      await holdLen(page, L.short);
      const shown = await waitOverlay(page);
      const r0 = (await gs(page)).runId;
      // 出た直後（400ms 以内）の again
      const early = await clickCmd(page, 'again'); await wait(page, 30);
      const e1 = await gs(page), ov1 = await overlayInfo(page);
      check(`結果カードを出して 400ms 以内の again は効かない（押せた=${early}、runId ${r0}→${e1.runId}、カードは出たまま）`, shown && typeof r0 === 'number' && e1.runId === r0 && ov1.shown && e1.phase === 'over', { r0, e1, ov1 });
      await wait(page, 450);
      // 400ms 後の again：押した直後（同じ処理の中）で、古い回のタイマー（over の音など）が片付いていること（MH6）
      const t0 = await page.evaluate(() => { const b = document.querySelector('#overlay:not([hidden]) [data-cmd="again"]'); if (!b) return null; b.click(); return window.HashiGame.getState().timers; });
      check(`again を押した直後に古い回のタイマーが残らない（timers ${t0}＝0）`, t0 === 0, t0);
      // 連打
      for (let i = 0; i < 4; i++) { await clickCmd(page, 'again'); await wait(page, 30); }
      const n1 = await gs(page);
      check(`400ms 後の again で新しい回：runId ${r0}→${n1.runId}、score 0・lives 3・ready、カードが閉じる`, n1.runId > r0 && n1.score === 0 && n1.lives === 3 && n1.phase === 'ready' && !(await overlayInfo(page)).shown, n1);
      await page.evaluate(() => { window.__plays.length = 0; });
      await wait(page, 3000);
      const after = (await plays(page)).map((p) => p.n);
      const n2 = await gs(page);
      check(`新しい回で 3 秒待っても古い回の音が鳴らない（鳴った音：${after.join(',') || 'なし'}）、timers ${n2.timers}（0）・ready のまま`,
        !after.some((n) => ['splash', 'over', 'peek', 'tip', 'land', 'walk', 'best'].includes(n)) && n2.timers === 0 && n2.phase === 'ready' && n2.lives === 3 && n2.runId === n1.runId, { after, n2 });
      // 新しい回は普通に遊べる
      const L2 = await lens(page);
      await holdLen(page, L2.perfect);
      const { s: n3 } = await settle(page);
      check(`新しい回でふつうに渡れる（score ${n3.score}）`, n3.crossed === 1 && n3.score > 0 && n3.runId === n1.runId, n3);
      await ctx.close();
    },
  },
  {
    id: 'HW9', tier: 'full', title: 'ハシわたり 時計：page.clock で 1000ms 押すと bridgeLen が lengthFromHold(1000)（±1 フレーム）、判定に使う長さも同じ、ゆっくりモードでは半分、MIN_HOLD_MS 未満は無視',
    async run({ browser, check }) {
      const { ctx, page } = await openH(browser, 'HW9', { opts: { touch: false } });
      const K = await page.evaluate(() => ({ g: window.HashiLogic.GROW_PER_MS, min: window.HashiLogic.MIN_HOLD_MS, n: window.HashiLogic.lengthFromHold(1000), s: window.HashiLogic.lengthFromHold(1000, { slow: true }) }));
      const tol = K.g * 17 + 0.5;
      // 押して ms だけ時計を進め、伸びている長さを読み、離す（ページの時間は止めたまま）
      const press = async (ms) => {
        const [cx, cy] = await stageCenter(page);
        const right = (await lens(page)).right;
        return frozen(page, async () => {
          await page.mouse.move(cx, cy); await page.mouse.down();
          await page.clock.runFor(ms); await sleep(30);
          const mid = await gs(page);
          await page.mouse.up(); await sleep(30);
          return { mid, right };
        });
      };
      const r1 = await press(1000);
      const { s: a1 } = await settle(page);
      const used1 = a1.lastOutcome ? a1.lastOutcome.tipX - r1.right : null;
      check(`1000ms 押すと bridgeLen ${r1.mid.bridgeLen?.toFixed?.(1)}（期待 ${K.n}±${tol.toFixed(1)}、phase ${r1.mid.phase}）`, r1.mid.phase === 'growing' && Math.abs(r1.mid.bridgeLen - K.n) <= tol, { mid: r1.mid, K });
      check(`離して判定に使った長さ（tipX−右端＝${used1}）も lengthFromHold(1000)=${K.n}`, used1 !== null && Math.abs(used1 - K.n) <= 0.5, { lastOutcome: a1.lastOutcome, right: r1.right });
      // MIN_HOLD_MS 未満は無視、ちょうどは数える
      await wait(page, 400);
      const b0 = await gs(page);
      await press(K.min - 1);
      await wait(page, 300);
      const b1 = await gs(page);
      check(`${K.min - 1}ms（MIN_HOLD_MS 未満）の押下は無視：ready・lives ${b0.lives}→${b1.lives}・bridgeLen 0`, b1.phase === 'ready' && b1.lives === b0.lives && b1.crossed === b0.crossed && b1.bridgeLen === 0, { b0, b1 });
      await wait(page, 100);
      await press(K.min);
      const b2 = await gs(page);
      await settle(page);
      check(`${K.min}ms ちょうどの押下は数える（phase ${b2.phase}、ready 以外へ進む）`, b2.phase !== 'ready' && b2.phase !== 'growing', b2);
      // ゆっくりモード
      await gotoH(page, { 'hashi.slow': '1' });
      const sl = await gs(page);
      const r2 = await press(1000);
      const { s: a2 } = await settle(page);
      const used2 = a2.lastOutcome ? a2.lastOutcome.tipX - r2.right : null;
      check(`ゆっくりモード（slow ${sl.slow}）：1000ms で bridgeLen ${r2.mid.bridgeLen?.toFixed?.(1)}（期待 ${K.s}＝半分）、判定も ${used2}`, sl.slow === true && Math.abs(r2.mid.bridgeLen - K.s) <= tol / 2 + 0.5 && used2 !== null && Math.abs(used2 - K.s) <= 0.5 && Math.abs(K.s * 2 - K.n) < 1e-9, { mid: r2.mid, used2, K });
      await ctx.close();
    },
  },
  {
    id: 'HW10', tier: 'full', title: 'ハシわたり 効果音：grow・tip・land・perfect・splash・peek・over・best が順に鳴り、実際に音の部品が動く。main.js の音名がすべて sfx.js の "hashi" にある',
    async run({ browser, check, root }) {
      // 静的：main.js の sfx.play の音名
      const src = fs.readFileSync(path.join(root, 'games/hashi/main.js'), 'utf8');
      const calls = [...src.matchAll(/\.play\(\s*(["'`])([a-zA-Z]+)\1/g)].map((m) => m[2]);
      const { ctx, page } = await openH(browser, 'HW10', { opts: { initScript: SFX_SPY, touch: false } });
      const names = await page.evaluate(() => YubiSfx.create('hashi').names);
      const want = ['grow', 'tip', 'land', 'perfect', 'walk', 'splash', 'peek', 'start', 'best', 'toggle', 'over', 'tap'];
      check(`sfx.js の "hashi" に契約の音名 ${want.length} 個がある`, want.every((n) => names.includes(n)), want.filter((n) => !names.includes(n)));
      check(`main.js の .play( ${calls.length} か所 [${[...new Set(calls)].join(', ')}] の音名がすべて "hashi" にある`, calls.length > 0 && calls.every((n) => names.includes(n)), { bad: calls.filter((n) => !names.includes(n)) });
      // ぴったり：本物のマウスで押す（音の準備 unlock も通る）
      const L = await lens(page);
      const ms = await page.evaluate((len) => Math.round(window.HashiLogic.holdForLength(len)), L.perfect);
      const [cx, cy] = await stageCenter(page);
      await frozen(page, async () => { await page.mouse.move(cx, cy); await page.mouse.down(); await page.clock.runFor(ms); await sleep(30); await page.mouse.up(); await sleep(30); });
      const { s: s1 } = await settle(page);
      await wait(page, 200);
      check(`ぴったりで渡れた（${s1.lastOutcome?.kind}・perfect ${s1.lastOutcome?.perfect}）`, s1.lastOutcome?.kind === 'cross' && s1.lastOutcome?.perfect === true, s1.lastOutcome);
      await loseRun(page);
      // over は結果カードの 600ms 後、best は 1100ms 後（main.js）。ページの時計は早送りでも AudioContext の時刻は実時間なので、
      // over の音が鳴り終わる（同時発音の枠が空く）まで実時間で待ってから best の時刻へ進める
      await wait(page, 700); await sleep(1500); await wait(page, 900);
      const pl = await plays(page);
      const seq = pl.map((p) => p.n);
      const first = (n) => seq.indexOf(n), last = (n) => seq.lastIndexOf(n);
      check(`鳴った順：grow → tip → land → perfect、落ちて splash → peek、最後に over（${seq.filter((n, i) => n !== seq[i - 1]).join(',')}）`,
        first('grow') >= 0 && first('grow') < first('tip') && first('tip') < first('land') && first('tip') < first('perfect') && first('perfect') < first('splash') && first('splash') < first('peek') && last('splash') < first('over') && first('over') >= 0, seq);
      check(`ぴったりの音は連続回数を渡す（perfect(${pl.find((p) => p.n === 'perfect')?.a})＝1）、ベスト更新で best が鳴る`, pl.find((p) => p.n === 'perfect')?.a === 1 && first('best') > first('land'), seq);
      const grow = pl.filter((p) => p.n === 'grow');
      check(`grow には 0..1 の割合を渡す（${grow.length} 回）`, grow.length > 0 && grow.every((p) => typeof p.a === 'number' && p.a >= 0 && p.a <= 1), grow.slice(0, 5));
      const notStarted = pl.filter((p) => !p.known || (['tip', 'land', 'perfect', 'splash', 'peek', 'over', 'best'].includes(p.n) && !(p.d > 0)));
      check('どの呼び出しも既知の音名で、tip・land・perfect・splash・peek・over・best は音の部品が実際に start した', !notStarted.length, notStarted);
      // 音をオフにすると鳴らない
      await wait(page, 500);
      await clickCmd(page, 'again'); await wait(page, 300);
      await page.click('#soundBtn'); await wait(page, 100);
      const st0 = await page.evaluate(() => window.__starts);
      const L2 = await lens(page); await holdLen(page, L2.perfect); await settle(page);
      const st1 = await page.evaluate(() => window.__starts);
      check(`♪でオフ（aria-pressed ${await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'))}）にすると、渡っても音が鳴らない（start ${st1 - st0}）`, st1 - st0 === 0, { st0, st1 });
      await ctx.close();
    },
  },
  {
    id: 'HW11', tier: 'full', cdp: CDP, title: 'ハシわたり タッチ：#stageWrap のダブルタップで拡大しない（dblclick・gesture・touchend を止める、短いタップは落ちない）、カードを閉じた直後の押下が下に届かない',
    async run({ browser, check }) {
      const TE_SPY = () => { window.__te = []; window.addEventListener('touchend', (e) => window.__te.push({ p: e.defaultPrevented, t: e.target.id || e.target.className || e.target.tagName })); };   // bubble で記録（capture だと #stageWrap が止める前に読んでしまう）
      const { ctx, page } = await newPage(browser, custom(390, 664, null, 'iPhone 13 Safari'), 'HW11', { device: 'iPhone 13', initScript: TE_SPY, clock: true });
      await gotoH(page);
      const g = await page.evaluate(() => {
        const el = document.querySelector('#stageWrap');
        const d = el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        const gsv = ['gesturestart', 'gesturechange'].map((n) => el.dispatchEvent(new Event(n, { bubbles: true, cancelable: true })));
        const cm = el.dispatchEvent(new Event('contextmenu', { bubbles: true, cancelable: true }));
        return { dbl: !d, gesture: gsv.every((x) => !x), ctx: !cm, ta: getComputedStyle(el).touchAction };
      });
      check(`#stageWrap：dblclick・gesturestart/change・contextmenu を止め、touch-action ${g.ta}`, g.dbl && g.gesture && g.ctx && g.ta === 'none', g);
      const t = await touch(ctx, page);
      const s0 = await gs(page);
      await page.evaluate(() => window.__te.splice(0));
      await t.doubleTap('#stageWrap'); await wait(page, 300);
      const ev = await page.evaluate(() => window.__te.splice(0));
      const sc = await page.evaluate(() => window.visualViewport.scale);
      const s1 = await gs(page);
      check(`素早い2回タップ：touchend が2回とも止められ（${ev.map((e) => e.p).join(',')}）、拡大しない（scale ${sc}）`, ev.length === 2 && ev.every((e) => e.p === true) && sc === 1, { ev, sc });
      check(`短いタップ（MIN_HOLD_MS 未満）では落ちない（lives ${s0.lives}→${s1.lives}・phase ${s1.phase}）`, s1.phase === 'ready' && s1.lives === s0.lives && s1.lastOutcome === null, s1);
      // 遊び方を閉じた直後の押下
      const [cx, cy] = await t.center('#stageWrap');
      const pressAfter = async (closeFn) => frozen(page, async () => {
        await closeFn();
        await t.send('touchStart', [{ x: cx, y: cy }]);
        await page.clock.runFor(200); await sleep(30);
        const mid = await gs(page);
        await t.send('touchEnd', []); await sleep(30);
        return mid;
      });
      await page.click('#helpBtn'); await wait(page, 200);
      const h0 = await gs(page);
      const hm = await pressAfter(() => clickCmd(page, 'close'));
      await wait(page, 400);
      const h1 = await gs(page);
      check(`遊び方を閉じた直後（300ms 以内）の押下は受けない（押している間 phase ${hm.phase}、離した後 lives ${h0.lives}→${h1.lives}）`, hm.phase === 'ready' && h1.phase === 'ready' && h1.lives === h0.lives && h1.lastOutcome === h0.lastOutcome, { hm, h1 });
      // 時間がたてば押せる（空振りでないこと）
      await t.send('touchStart', [{ x: cx, y: cy }]); await wait(page, 200);
      const ok = await gs(page);
      await t.send('touchEnd', []);
      await settle(page);
      check(`しばらくたてば押せる（phase ${ok.phase}）`, ok.phase === 'growing', ok);
      // 結果カードの「もう一度」の直後
      await gotoH(page);
      await loseRun(page);
      await wait(page, 500);
      const am = await pressAfter(() => clickCmd(page, 'again'));
      await wait(page, 400);
      const a1 = await gs(page);
      check(`「もう一度」の直後の押下は下に届かない（押している間 phase ${am.phase}、新しい回の lives ${a1.lives}・lastOutcome ${a1.lastOutcome}）`, am.phase === 'ready' && a1.phase === 'ready' && a1.lives === 3 && a1.lastOutcome === null, { am, a1 });
      await ctx.close();
    },
  },
  {
    id: 'HW12', tier: 'full', title: 'ハシわたり 設定：ゆっくり・ガイドの切り替え（aria-pressed）が hashi.slow・hashi.guide に保存され開き直しても残る、ガイド点線が描かれる、壊れた値で落ちない',
    async run({ browser, check }) {
      const { ctx, page } = await openH(browser, 'HW12', { opts: { initScript: RENDER_SPY, touch: false } });
      const s0 = await gs(page);
      await page.click('#helpBtn'); await wait(page, 200);
      const o0 = await overlayInfo(page);
      const p0 = Object.fromEntries(o0.sets.map((x) => [x.set, x.pressed]));
      check(`既定はどちらもオフ（slow ${s0.slow}・guide ${s0.guide}、aria-pressed ${p0.slow}/${p0.guide}）`, s0.slow === false && s0.guide === false && p0.slow === 'false' && p0.guide === 'false', { s0, o0 });
      await page.click('#overlay [data-set="slow"]'); await page.click('#overlay [data-set="guide"]'); await wait(page, 100);
      const o1 = await overlayInfo(page);
      const p1 = Object.fromEntries(o1.sets.map((x) => [x.set, x.pressed]));
      const ls1 = [await stored(page, 'hashi.slow'), await stored(page, 'hashi.guide')];
      const s1 = await gs(page);
      check(`切り替えると aria-pressed true、保存 "${ls1.join('","')}"、getState slow ${s1.slow}・guide ${s1.guide}`, p1.slow === 'true' && p1.guide === 'true' && ls1[0] === '1' && ls1[1] === '1' && s1.slow === true && s1.guide === true, { p1, ls1, s1 });
      await page.reload(); await wait(page, 300);
      const s2 = await gs(page);
      await page.click('#helpBtn'); await wait(page, 200);
      const p2 = Object.fromEntries((await overlayInfo(page)).sets.map((x) => [x.set, x.pressed]));
      check(`開き直しても残る（slow ${s2.slow}・guide ${s2.guide}、aria-pressed ${p2.slow}/${p2.guide}）`, s2.slow === true && s2.guide === true && p2.slow === 'true' && p2.guide === 'true', { s2, p2 });
      await clickCmd(page, 'close'); await wait(page, 400);
      // ガイド点線：押している間、guideTipX = 今の葉の右端 + 今の長さ
      const [cx, cy] = await stageCenter(page);
      const right = (await lens(page)).right;
      await page.mouse.move(cx, cy); await page.mouse.down(); await wait(page, 300);
      const gv = await page.evaluate(() => ({ g: window.__hrView?.guideTipX ?? null, len: window.HashiGame.getState().bridgeLen }));
      await page.mouse.up(); await settle(page);
      check(`ガイドがオンなら、押している間 guideTipX（${gv.g}）＝右端 ${right}＋長さ ${gv.len?.toFixed?.(1)}`, typeof gv.g === 'number' && Math.abs(gv.g - (right + gv.len)) <= 10, { gv, right });
      // オフに戻す
      await wait(page, 400);
      await page.click('#helpBtn'); await wait(page, 200);
      await page.click('#overlay [data-set="slow"]'); await page.click('#overlay [data-set="guide"]'); await wait(page, 100);
      const ls3 = [await stored(page, 'hashi.slow'), await stored(page, 'hashi.guide')];
      await clickCmd(page, 'close'); await wait(page, 400);
      await page.mouse.move(cx, cy); await page.mouse.down(); await wait(page, 300);
      const gv2 = await page.evaluate(() => ({ g: window.__hrView ? window.__hrView.guideTipX : 'no-view', phase: window.HashiGame.getState().phase }));
      await page.mouse.up(); await settle(page);
      check(`オフに戻すと保存 "${ls3.join('","')}"、押している間もガイドを描かない（guideTipX ${gv2.g}）`, ls3[0] === '0' && ls3[1] === '0' && gv2.phase === 'growing' && gv2.g === null, { ls3, gv2 });
      // 壊れた値
      const bad = [];
      for (const [sv, gvv] of [['yes', '{}'], ['true', '2'], ['', 'null'], ['01', ' 1']]) {
        await gotoH(page, { 'hashi.slow': sv, 'hashi.guide': gvv });
        const s = await gs(page);
        if (!(s.slow === false && s.guide === false && s.phase === 'ready')) bad.push({ sv, gvv, slow: s.slow, guide: s.guide, phase: s.phase });
      }
      check('壊れた設定値（"yes"・"{}"・"true"・"2"・""・"null"・"01"・" 1"）で開け、どちらもオフ扱い', bad.length === 0, bad);
      await ctx.close();
    },
  },
  {
    id: 'HW14', tier: 'full', title: 'ハシわたり 押し続けられない人向け：タップ式（hashi.tap）で 1回目のタップで伸び 2回目で倒れる（指・click だけ（VoiceOver）・キーボード）、演出中のタップが次を食べない、結果を #sr（aria-live）に1文で読む、#hint は読ませない',
    async run({ browser, check }) {
      const { ctx, page } = await openH(browser, 'HW14', { opts: { touch: false } });
      // 既定はタップ式オフ。切り替えると保存され、面の説明と案内が変わる
      const s0 = await gs(page);
      await page.click('#helpBtn'); await wait(page, 200);
      const o0 = await overlayInfo(page);
      const t0 = o0.sets.find((x) => x.set === 'tap');
      check(`既定はタップ式オフ（getState tap ${s0.tap}、設定 aria-pressed ${t0?.pressed}）`, s0.tap === false && !!t0 && t0.pressed === 'false', { s0, o0 });
      await page.click('#overlay [data-set="tap"]'); await wait(page, 100);
      const t1 = (await overlayInfo(page)).sets.find((x) => x.set === 'tap');
      const ls1 = await stored(page, 'hashi.tap');
      await clickCmd(page, 'close'); await wait(page, 400);
      const a1 = await page.evaluate(() => ({ label: document.querySelector('#stageWrap').getAttribute('aria-label'), hint: document.querySelector('#hint').textContent.trim(), tap: window.HashiGame.getState().tap }));
      check(`切り替えるとオン（aria-pressed ${t1?.pressed}・保存 "${ls1}"・tap ${a1.tap}）、面の説明「${a1.label}」と案内「${a1.hint}」がタップの言い方`,
        !!t1 && t1.pressed === 'true' && ls1 === '1' && a1.tap === true && /タップ/.test(a1.label) && /タップ/.test(a1.hint), { t1, ls1, a1 });

      // 指（マウス）：1回目のタップで伸びはじめ、離しても伸び続け、2回目で倒れて渡る
      const [cx, cy] = await stageCenter(page);
      const msFor = () => page.evaluate(() => window.HashiLogic.holdForLength(window.HashiGame.lenToCross(), { slow: !!window.HashiGame.getState().slow }));
      let ms = await msFor();
      const before = await gs(page);
      await page.mouse.click(cx, cy);
      await wait(page, Math.round(ms / 2));
      const mid = await gs(page);
      const holdMid = await holdingAttr(page);
      await wait(page, ms - Math.round(ms / 2));
      await page.mouse.click(cx, cy);
      const after2 = await phaseOf(page);
      const r1 = await settle(page);
      check(`指：1回目のタップの後、離しても伸び続ける（${mid.phase}・data-holding ${holdMid}・長さ ${mid.bridgeLen?.toFixed?.(1)}）、2回目で倒れ（${after2}）、渡る（${r1.s.lastOutcome?.kind}・score ${before.score}→${r1.s.score}）`,
        mid.phase === 'growing' && holdMid === '1' && mid.bridgeLen > 0 && after2 === 'falling' && r1.s.lastOutcome?.kind === 'cross' && r1.s.score > before.score, { mid, holdMid, after2, r1: r1.s });

      // 読み上げ：#sr（aria-live=polite）に結果の1文。#hint は role=status・aria-live を持たない
      const sr1 = await page.evaluate(() => { const e = document.querySelector('#sr'), h = document.querySelector('#hint'); return { live: e ? e.getAttribute('aria-live') : null, text: e ? e.textContent.trim() : null, hintRole: h.getAttribute('role'), hintLive: h.getAttribute('aria-live') }; });
      await wait(page, 1700);
      const sr2 = await page.evaluate(() => ({ text: document.querySelector('#sr')?.textContent.trim() ?? null, hint: document.querySelector('#hint').textContent.trim() }));
      check(`#sr（aria-live ${sr1.live}）が「${sr1.text}」（わたれた／ぴったり・点・のこり）、#hint は role ${sr1.hintRole}・aria-live ${sr1.hintLive}（読ませない）、案内が戻っても #sr はそのまま（「${sr2.text}」）`,
        sr1.live === 'polite' && /わたれた|ぴったり/.test(sr1.text || '') && (sr1.text || '').includes(`${r1.s.score}`) && (sr1.text || '').includes(`のこり ${r1.s.lives}`) && !sr1.hintRole && !sr1.hintLive && sr2.text === sr1.text && /タップ/.test(sr2.hint), { sr1, sr2 });

      // VoiceOver・スイッチコントロール：click だけが届く（pointerdown なし）。2回の click で渡る
      await wait(page, 800);
      ms = await msFor();
      const b2 = await gs(page);
      await page.evaluate(() => document.querySelector('#stageWrap').click());
      await wait(page, ms);
      const mid2 = await phaseOf(page);
      await page.evaluate(() => document.querySelector('#stageWrap').click());
      const r2 = await settle(page);
      check(`click だけ（VoiceOver の有効化）：1回目で ${mid2}、2回目で倒れて ${r2.s.lastOutcome?.kind}（crossed ${b2.crossed}→${r2.s.crossed}）`, mid2 === 'growing' && r2.s.lastOutcome?.kind === 'cross' && r2.s.crossed === b2.crossed + 1, { mid2, r2: r2.s });

      // 演出中のタップ（受け付けない）が、次のタップを食べない
      await wait(page, 800);
      const L3 = await lens(page);
      await page.mouse.click(cx, cy);
      await wait(page, Math.round(await page.evaluate((l) => window.HashiLogic.holdForLength(l), L3.short)));
      await page.mouse.click(cx, cy);
      await wait(page, 30);
      const animPh = await phaseOf(page);
      await page.mouse.click(cx, cy);      // 演出中のタップ
      await settle(page);
      await wait(page, 400);
      await page.mouse.click(cx, cy);
      const next = await phaseOf(page);
      const hold3 = await holdingAttr(page);
      check(`演出中（${animPh}）のタップの後、次のタップで伸びはじめる（${next}・data-holding ${hold3}）`, animPh !== 'ready' && animPh !== 'growing' && next === 'growing' && hold3 === '1', { animPh, next, hold3 });
      await wait(page, 200);
      await page.mouse.click(cx, cy);
      await settle(page);

      // キーボード：Space の keydown で始め、keyup では倒れず、次の keydown で倒れる
      await wait(page, 800);
      await blurAll(page);
      await page.keyboard.down('Space'); await wait(page, 150);
      await page.keyboard.up('Space'); await wait(page, 150);
      const kMid = await phaseOf(page);
      await page.keyboard.down('Space');
      const kEnd = await phaseOf(page);
      await page.keyboard.up('Space');
      await settle(page);
      check(`キーボード：Space の押す・離すの後も ${kMid}、もう一度押すと ${kEnd}`, kMid === 'growing' && kEnd === 'falling', { kMid, kEnd });

      // オフに戻すと長押しに戻る（短いタップでは伸びない）
      await wait(page, 800);
      const ovNow = await overlayInfo(page);
      if (ovNow.shown) await gotoH(page, { 'hashi.tap': '1' });   // 落ちて結果カードが出ていたら開き直す
      await page.click('#helpBtn'); await wait(page, 200);
      await page.click('#overlay [data-set="tap"]'); await wait(page, 100);
      const ls2 = await stored(page, 'hashi.tap');
      await clickCmd(page, 'close'); await wait(page, 400);
      await page.mouse.click(cx, cy); await wait(page, 200);
      const off = await gs(page);
      const lab2 = await page.evaluate(() => document.querySelector('#stageWrap').getAttribute('aria-label'));
      check(`オフに戻すと保存 "${ls2}"、短いタップの後は ready のまま（${off.phase}・tap ${off.tap}）、面の説明「${lab2}」`, ls2 === '0' && off.phase === 'ready' && off.tap === false && /ながく/.test(lab2 || ''), { ls2, off, lab2 });

      // 壊れた値はオフ扱い
      const bad = [];
      for (const v of ['yes', '{}', '2', ' 1']) {
        await gotoH(page, { 'hashi.tap': v });
        const s = await gs(page);
        if (!(s.tap === false && s.phase === 'ready')) bad.push({ v, tap: s.tap, phase: s.phase });
      }
      check('壊れた hashi.tap（"yes"・"{}"・"2"・" 1"）で開け、オフ扱い', bad.length === 0, bad);
      await ctx.close();
    },
  },
  {
    id: 'HW13', tier: 'full', title: 'ハシわたり オフライン：sw.js の APP_FILES に games/hashi/* がすべて入り（無ければ不合格）、接続を切っても開いて遊べ、部品は Service Worker から読まれ、メニューに戻れる',
    async run({ browser, check, srv, root }) {
      const info = swInfo(root);
      const want = ['./games/hashi/', './games/hashi/index.html', './games/hashi/course.js', './games/hashi/logic.js', './games/hashi/render.js', './games/hashi/input.js', './games/hashi/main.js'];
      const missing = want.filter((f) => !info.files.includes(f));
      check(`sw.js の APP_FILES にハシわたりの ${want.length} 件がすべてある（足りない：${missing.join(' / ') || 'なし'}）`, missing.length === 0, missing);
      const exist = want.filter((f) => !f.endsWith('/')).filter((f) => !fs.existsSync(path.join(root, f)));
      check('APP_FILES に足すファイルが実際にある', exist.length === 0, exist);
      if (missing.length) return;                         // 事前キャッシュに無ければ、オフラインの確かめはできない（上で不合格にしてある）
      srv.reset();
      const { ctx, page } = await newPage(browser, custom(390, 844, null, 'iPhone 13'), 'HW13', { sw: true, allowNetErrors: true });
      await page.goto(BASE);
      const ok = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]));
      if (!ok) throw new Error('Service Worker が 8 秒以内に有効にならない（事前キャッシュの install 失敗の可能性）');
      if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }); }
      await page.evaluate(() => localStorage.setItem('hashi.help', '1'));
      await sleep(200);
      await srv.ctl('offline=1');
      const resp = [];
      page.on('response', (r) => { if (/\/games\/hashi\/|\/common\/sfx\.js/.test(r.url())) resp.push({ f: r.url().split('/').slice(-2).join('/'), status: r.status(), sw: r.fromServiceWorker() }); });
      await page.goto(HU, { timeout: 10000 }); await sleep(400);
      const libs = await page.evaluate(() => ({ L: typeof window.HashiLogic?.resolve, C: typeof window.HashiCourse?.makeNext, R: typeof window.HashiRender?.create, I: typeof window.HashiInput?.attach, Y: typeof window.YubiSfx?.create, G: typeof window.HashiGame?.getState }));
      check('オフラインで開き、HashiLogic・HashiCourse・HashiRender・HashiInput・YubiSfx・HashiGame が使える', Object.values(libs).every((x) => x === 'function'), libs);
      const js = ['course.js', 'logic.js', 'render.js', 'input.js', 'main.js', 'common/sfx.js'].map((f) => ({ f, hit: resp.find((r) => r.f.endsWith(f)) }));
      check('course.js・logic.js・render.js・input.js・main.js・sfx.js を Service Worker から 200 で読んだ', js.every((x) => x.hit && x.hit.sw && x.hit.status === 200), { js, resp });
      if (libs.G === 'function') {
        const L = await page.evaluate(() => { const s = window.HashiGame.getState(); const len = window.HashiGame.lenToCross(); return window.HashiGame.holdFor(window.HashiLogic.holdForLength(len, { slow: !!s.slow })); });
        let s = null;
        for (let i = 0; i < 60; i++) { s = await gs(page); if (s.phase === 'ready' && s.crossed > 0) break; await page.evaluate(() => window.HashiGame.skip()); await sleep(80); }
        check(`オフラインで渡れる（holdFor ${L}・crossed ${s?.crossed}）`, L === true && s?.crossed === 1, s);
      }
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('オフラインのまま、メニューに戻れる', page.url() === BASE && await page.locator('a.game').count() >= 2, page.url());
      await srv.ctl('offline=0');
      await ctx.close();
    },
  },
];
