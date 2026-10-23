// WW: もくもくこうば の画面（games/seizai/）。契約は docs/seizai-contract.md（§5 画面・§7 進行・§7.3 テスト用 API・§7.4 デバッグ命令・§8 保存・§11.3 WW）。
//   画面の DOM は契約 §5.4 だけに頼る：#hud・a#back・#gameTitle・#helpBtn・#soundBtn・#money・#goalText・#goalBar・#expandBtn・#orderTag（button）・#shipCount・
//     #scene・.zone[data-dept]・#sheet[data-dept]・#sheetTitle・[data-buy]・#mgrFast・#mgrGain・#sheetClose・#awayCard・#awayText・#awayOk・#stageCard・#stageOk・
//     #orderCard・#orderAccept・#orderLater・#endCard・#endOk・#help・#helpOk・#hint・body[data-stage]・body[data-phase]
//   テスト用の公開 API（§7.3）：window.SeizaiGame = { getState, logic, advance, away, tapZone, buy, setMgr, acceptOrder, expand, setState, save }
//   デバッグ命令（§7.4。?debug=1 のときだけ）：YubiDebug.run('gostage'|'neworder'|'ships'|'addmoney', …)
//   決まり（組み合わせ担当の注意）：
//     ・保存を直接書くときは、ゲームのページで書いて reload しない（pagehide で上書きされる）。seed() で中立のページへ移って書いてから開く
//     ・カードは出た直後 400ms 押せないので、aria-disabled が外れるのを待ってから押す（pressCard）
//     ・注文の数は速さで決まる（決め打ちしない。getState().order.need を読む）
//     ・文言は契約 §5.3 の決まった言葉（「はんぶん」「2じかんぶん」）と logic の関数の値（formatYen・goalOf・costOf）だけを見る
//   るすの あいだ（§4.3・§7.1）は、ページの時計を clockTime で決まった瞬間に固定して確かめる（日本・ロサンゼルスの2つのタイムゾーン）。
//   期待値は Node で読んだ logic.js（同じ root）から作る。半分の速さの 45 秒・上限の 7200 秒は決め打ちの値で比べる（logic が変わっても見逃さない）。
//   無いときに合格にしない（空振りの合格を作らない）：SeizaiGame・YubiDebug が無ければ例外で不合格にする。
//   smoke：WW1〜WW6。full：WW7〜WW27（WW18 はレビュー後の直し §17.1、WW19 は §17.3 の B、WW20 は §18 待つ理由（SZ-03）、WW21〜23 は §19（新しい工程・道具・画面を広く）、WW24 は §20 はこぶ人の往復と「まち」（SZ-04・SZ-05）、WW25 は §21 さいしょから（SZ-07）、WW26 は §22 古いページから書き戻さない（X-20）、WW27 は §23 もう強くできない つまり（SZ-08）。WW10・WW17 は CDP なので Chromium だけ、WW14 は AudioContext が要る）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BASE, view, custom, newPage, seed, wait, sleep, layoutProbe, swInfo, touch, SFX_SPY, plays, TIMEZONES, zonedTime } from '../lib.mjs';

const SZ = BASE + 'games/seizai/';
const SZD = SZ + '?debug=1';
const SMOKE_V = () => view('SE', 'p', 'app');
const STD_V = () => view('i13', 'p', 'app');
const IDS = ['cut', 'plant', 'carry', 'peel', 'beam', 'plank', 'shop'];
const LINE = { peel: 1, beam: 1, plank: 1 };
const T0 = Date.UTC(2026, 9, 20, 3, 0, 0);          // るすの あいだの基準の瞬間（日本 12:00・ロサンゼルス 前日 20:00）
// 既知の不具合 W-K1（3 時間閉じても capped が false。SZ-01）は 2026-10-21 に直した（契約 §17.1 A1）。WW3 の合否に含める
const CARD_OK = { help: '#helpOk', away: '#awayOk', stage: '#stageOk', order: '#orderLater', end: '#endOk' };

// ---------- logic.js（Node）。期待値を作るのに使う ----------
function logicOf(root) {
  const f = path.join(root, 'games/seizai/logic.js');
  if (!fs.existsSync(f)) throw new Error('games/seizai/logic.js が無い');
  const L = createRequire(f)(f);
  if (!L || typeof L.loadSave !== 'function' || typeof L.makeSave !== 'function' || typeof L.catchUp !== 'function') throw new Error('logic.js が SeizaiLogic を module.exports していない');
  return L;
}
// 段の上限まで人・台をそろえ、置き場に品がある局面（loadSave を通す＝保存の形のまま）。すぐに売れて、閉じた間の稼ぎが 0 にならない
function mkState(L, stage, o = {}) {
  const depts = {};
  for (const id of IDS) {
    const cap = L.CAPS[stage - 1][id];
    const d = { level: 10, mgr: null };
    if (LINE[id]) d.lines = Math.max(1, cap); else d.staff = cap;
    depts[id] = { ...d, ...(o.depts && o.depts[id]) };
  }
  const raw = { v: 1, savedAt: 0, stage, cleared: false, money: 1234, t: 100, forest: { trees: 10, saplings: 0 }, buf: { yard: 10, logs: 10, peeled: 10, beams: 10, planks: 10, goods: 30 }, goal: { done: 0 }, order: null, orderSeq: 0, soldSinceOrder: 0, ships: 0, ship: { got: 0 }, totals: {}, seed: 7, rng: 12345, ...o, depts };
  const r = L.loadSave(JSON.stringify(raw));
  if (!r || !r.state) throw new Error('mkState: loadSave が null');
  return r.state;
}
const saveOf = (L, s, savedAt) => { const t = L.makeSave(s, savedAt); if (typeof t !== 'string') throw new Error('makeSave が文字を返さない'); return t; };
const withSavedAt = (raw, v) => { const o = JSON.parse(raw); o.savedAt = v; return JSON.stringify(o); };

// ---------- 開く ----------
async function openW(browser, label, { v = STD_V(), opts = {}, items = {}, help = true, debug = false } = {}) {
  const { ctx, page } = await newPage(browser, v, label, { clock: true, ...opts });
  await gotoW(page, items, { help, debug });
  return { ctx, page };
}
async function gotoW(page, items = {}, { help = true, debug = false } = {}) {
  await seed(page, { ...(help ? { 'seizai.help': '1' } : {}), ...items });
  await page.goto(debug ? SZD : SZ); await wait(page, 300);
  const has = await page.evaluate(() => !!window.SeizaiGame && typeof window.SeizaiGame.getState === 'function' && typeof window.SeizaiGame.advance === 'function' && typeof window.SeizaiGame.setState === 'function');
  if (!has) throw new Error('window.SeizaiGame が無い（games/seizai/main.js が読まれていないか、テスト用 API が未実装）');
  if (debug && !(await page.evaluate(() => !!window.YubiDebug && typeof window.YubiDebug.run === 'function'))) throw new Error('?debug=1 なのに YubiDebug が無い');
}

// ---------- 読む・進める ----------
const gs = (p) => p.evaluate(() => window.SeizaiGame.getState());
const lg = (p) => p.evaluate(() => window.SeizaiGame.logic());
const adv = (p, sec) => p.evaluate((s) => window.SeizaiGame.advance(s), sec);
const txt = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const shown = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && e.getBoundingClientRect().width > 0; }, sel);
const stored = (p, k) => p.evaluate((k) => { try { return localStorage.getItem(k); } catch { return 'ERR'; } }, k);
const yenIn = (p, n) => p.evaluate((n) => window.SeizaiLogic.formatYen(n), n);
// logic の state を写して直し、setState で戻す（code は l を書きかえる文）
async function setL(p, code) {
  const ok = await p.evaluate((code) => { const l = window.SeizaiGame.logic(); new Function('l', 'SeizaiLogic', code)(l, window.SeizaiLogic); return window.SeizaiGame.setState(l); }, code);
  if (!ok) throw new Error('setState が受け付けない: ' + code);
}
async function dbg(p, name, args) {
  const r = await p.evaluate(([n, a]) => window.YubiDebug.run(n, a), [name, args]);
  if (!r || !r.ok) throw new Error(`デバッグ命令 ${name} が失敗: ${JSON.stringify(r && r.error)}`);
  return r.result;
}
// カードの出た直後の 400ms が過ぎて、ボタンの aria-disabled が外れるのを待つ
async function unlocked(p, sel) {
  for (let i = 0; i < 20; i++) {
    if (await p.evaluate((s) => { const b = document.querySelector(s); return !!b && !b.hasAttribute('aria-disabled'); }, sel)) return true;
    await wait(p, 100);
  }
  return false;
}
async function pressCard(p, sel) {
  if (!(await unlocked(p, sel))) throw new Error(`${sel} の aria-disabled が外れない`);
  await p.click(sel); await wait(p, 60);
}
async function waitOverlay(p, kind, maxMs = 3000) {
  for (let t = 0; t <= maxMs; t += 100) { const o = (await gs(p)).overlay; if (o === kind) return true; await wait(p, 100); }
  return false;
}
// 開いているカードを全部閉じる（注文は「あとで」）
async function closeCards(p) {
  for (let i = 0; i < 8; i++) {
    const o = (await gs(p)).overlay;
    if (!o) return;
    await pressCard(p, CARD_OK[o]);
  }
  throw new Error('カードが閉じない');
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
// 要素の文字がはみ出さず（省略されず）、画面内にある
const fits = (p, sel) => p.evaluate((s) => {
  const e = document.querySelector(s); if (!e) return { ok: false, why: 'なし' };
  const r = e.getBoundingClientRect();
  const ok = e.scrollWidth <= e.clientWidth + 1 && r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.width > 0;
  return { ok, text: e.textContent.trim(), sw: e.scrollWidth, cw: e.clientWidth, r: [r.left, r.top, r.right, r.bottom].map(Math.round) };
}, sel);
// みなと（段 4）へ飛び、カードを閉じる
async function goStage(p, n) { await dbg(p, 'gostage', { stage: n }); await wait(p, 100); await closeCards(p); }

export const tests = [
  // ================= smoke =================
  {
    id: 'WW1', tier: 'smoke', title: 'もくもくこうば 遊べる・表示の一致：開くと人が描かれて動き（actors・frames）、advance でお金が増え、#money が formatYen・#goalText が goalOf・#goalBar の aria-valuenow が goal.done。.zone を押すとシート（data-dept）と応援、シートの値段が costOf、買うと人・台が増えて rates が上がりお金が値段ぶん減る。お金が足りないと買えず、aria-disabled・ヒント・音 deny',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openW(browser, 'WW1', { v: SMOKE_V(), opts: { initScript: SFX_SPY } });
      await wait(page, 1000);
      const s0 = await gs(page);
      check(`開くと遊んでいる（phase play・段 1・body[data-stage]=1）、人が描かれ（actors ${s0.actors}）、描き続けている（frames ${s0.frames}）`, s0.phase === 'play' && s0.stage === 1 && s0.actors > 0 && s0.frames > 10 && (await page.evaluate(() => document.body.dataset.stage)) === '1' && s0.overlay === null, s0);
      check(`document.title と #gameTitle が NAME（${L.NAME}）`, (await page.title()) === L.NAME && (await txt(page, '#gameTitle')) === L.NAME, await page.title());
      const s1 = await adv(page, 120);
      const l1 = await lg(page);
      check(`advance(120) でお金が増える（${s0.money} → ${s1.money}）、logic の t が 120 秒すすむ`, s1.money > s0.money && l1.t >= 119.9, { m0: s0.money, m1: s1.money, t: l1.t });
      const shownMoney = await txt(page, '#money');
      check(`#money「${shownMoney}」が formatYen(state.money)`, shownMoney === L.formatYen(l1.money), [shownMoney, L.formatYen(l1.money)]);
      const g = L.goalOf(l1), gt = await txt(page, '#goalText'), gv = await page.evaluate(() => document.querySelector('#goalBar')?.getAttribute('aria-valuenow'));
      check(`#goalText「${gt}」が goalOf の文、#goalBar の aria-valuenow ${gv} が done ${g.done}`, gt === g.text && gv === String(g.done) && g.done > 0, { gt, g, gv });
      // 場所を押す → シートと応援
      await page.click('.zone[data-dept="cut"]'); await wait(page, 100);
      const s2 = await gs(page), l2 = await lg(page);
      const sheet = await page.evaluate(() => ({ dept: document.querySelector('#sheet')?.dataset.dept, hidden: document.querySelector('#sheet')?.hidden, title: document.querySelector('#sheetTitle')?.textContent.trim() }));
      check(`きこりの場所を押すとシートが開く（#sheet[data-dept=${sheet.dept}]・見出し「${sheet.title}」）`, s2.sheet === 'cut' && sheet.dept === 'cut' && !sheet.hidden && !!sheet.title, { sheet, s: s2.sheet });
      check(`押すと応援（きこりの boostUntil ${l2.depts.cut.boostUntil} > t ${l2.t.toFixed(1)}）`, l2.depts.cut.boostUntil > l2.t, l2.depts.cut);
      // お金が足りない
      await setL(page, 'l.money = 0;');
      await page.click('.zone[data-dept="cut"]'); await wait(page, 100);
      const n0 = (await plays(page)).length;
      const st0 = (await lg(page)).depts.cut.staff;
      const dis = await page.evaluate(() => document.querySelector('#sheet [data-buy="staff"]')?.getAttribute('aria-disabled'));
      await page.click('#sheet [data-buy="staff"]', { force: true }); await wait(page, 100);
      const ps = (await plays(page)).slice(n0).map((x) => x.n);
      const hint = await txt(page, '#hint');
      check(`お金 0 では ＋1にん に aria-disabled="${dis}"、押しても人が増えず（${st0} → ${(await lg(page)).depts.cut.staff}）、ヒント「${hint}」と音 deny（${ps.join(',')}）`, dis === 'true' && (await lg(page)).depts.cut.staff === st0 && !!hint && ps.includes('deny'), { dis, hint, ps });
      // 買う：シートの値段が costOf、買うと増える
      await setL(page, 'l.money = 100000;');
      await page.click('.zone[data-dept="cut"]'); await wait(page, 100);
      for (const [dept, what] of [['cut', 'staff'], ['cut', 'level'], ['peel', 'line']]) {
        if ((await gs(page)).sheet !== dept) { await page.click(`.zone[data-dept="${dept}"]`); await wait(page, 100); }
        const la = await lg(page), ra = (await gs(page)).rates[dept];
        const cost = L.costOf(la, dept, what);
        const price = await txt(page, `#sheet [data-buy="${what}"] [data-part="price"]`) ?? await txt(page, `#sheet [data-buy="${what}"]`);
        const vis = await shown(page, `#sheet [data-buy="${what}"]`);
        await page.click(`#sheet [data-buy="${what}"]`); await wait(page, 100);
        const lb = await lg(page), rb = (await gs(page)).rates[dept];
        const key = what === 'line' ? 'lines' : what;
        check(`${dept} の ${what}：値段「${price}」が formatYen(costOf ${cost})、買うと ${key} ${la.depts[dept][key]} → ${lb.depts[dept][key]}・rates ${ra.toFixed(3)} → ${rb.toFixed(3)}・お金が値段ぶん減る`,
          vis && Number.isFinite(cost) && price.includes(L.formatYen(cost)) && lb.depts[dept][key] === la.depts[dept][key] + 1 && rb > ra && la.money - lb.money === cost, { price, cost, a: la.depts[dept], b: lb.depts[dept], ra, rb, m: [la.money, lb.money] });
      }
      const vis = await page.evaluate(() => [...document.querySelectorAll('#sheet [data-buy]')].filter((b) => !b.closest('[hidden]')).map((b) => b.dataset.buy).sort().join(','));
      check(`台の部署（かわむき）のシートは line・level・mgr（staff は出さない）：${vis}`, vis === 'level,line,mgr', vis);
      await ctx.close();
    },
  },
  {
    id: 'WW2', tier: 'smoke', title: 'もくもくこうば 節目：目標の前は #expandBtn が隠れ、達成すると出て（値段は STAGES の費用）、押すと段 2・body[data-stage]=2・seizai.best=2・背景の描き直し（bgRedraws）、演出のあとに #stageCard（出た直後は押せない）、#goalText が次の目標、人・きかいは引き継ぐ',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const st = mkState(L, 1, { goal: { done: 60 }, money: 5000 });
      const { ctx, page } = await openW(browser, 'WW2', { v: SMOKE_V(), items: { 'seizai.save': saveOf(L, st, T0) }, opts: { clockTime: new Date(T0 + 1000) } });
      check('目標の前（60/100）は #expandBtn が隠れている', !(await shown(page, '#expandBtn')) && (await gs(page)).stage === 1, await gs(page));
      await setL(page, 'l.goal.done = 100; l.money = 5000;'); await wait(page, 100);
      const cost = L.STAGES[0].cost;
      const et = await txt(page, '#expandBtn');
      const dis = await page.evaluate(() => document.querySelector('#expandBtn').getAttribute('aria-disabled'));
      check(`目標を達成すると #expandBtn「${et}」が出て、値段 formatYen(${cost}) を出し、押せる`, (await shown(page, '#expandBtn')) && et.includes(L.formatYen(cost)) && dis !== 'true', { et, dis });
      const before = await lg(page), bg0 = (await gs(page)).bgRedraws;
      await page.click('#expandBtn'); await wait(page, 100);
      const s1 = await gs(page), l1 = await lg(page);
      const spent = before.money + (l1.totals.earned - before.totals.earned) - l1.money;   // 押すまでの間に売れた分を足し戻す
      check(`押すと段 2（body[data-stage]=${await page.evaluate(() => document.body.dataset.stage)}）、seizai.best=${await stored(page, 'seizai.best')}、使ったお金が ${spent}（費用 ${cost}）`, s1.stage === 2 && (await page.evaluate(() => document.body.dataset.stage)) === '2' && (await stored(page, 'seizai.best')) === '2' && spent === cost, { s: s1.stage, m: [before.money, l1.money], spent });
      check('人・台・きかいは引き継ぐ（きこり・はこぶ・かわむき）', l1.depts.cut.staff === before.depts.cut.staff && l1.depts.carry.staff === before.depts.carry.staff && l1.depts.peel.lines === before.depts.peel.lines && l1.depts.cut.level === before.depts.cut.level, { a: before.depts, b: l1.depts });
      await wait(page, 300);
      check(`景色が変わる（背景の描き直し bgRedraws ${bg0} → ${(await gs(page)).bgRedraws}）`, (await gs(page)).bgRedraws > bg0, bg0);
      check('演出のあと #stageCard が出る（overlay stage・phase card）', await waitOverlay(page, 'stage', 2500) && (await shown(page, '#stageCard')) && (await page.evaluate(() => document.body.dataset.phase)) === 'card', await gs(page));
      await page.evaluate(() => document.querySelector('#stageOk').click()); await wait(page, 50);
      check('カードが出た直後（400ms 以内）に #stageOk を押しても閉じない', (await gs(page)).overlay === 'stage', (await gs(page)).overlay);
      await pressCard(page, '#stageOk');
      const g = L.goalOf(await lg(page));
      check(`400ms たてば #stageOk で閉じ（phase play）、#goalText が次の目標「${g.text}」`, (await gs(page)).overlay === null && (await txt(page, '#goalText')) === g.text && g.need === L.STAGES[1].goal && (await page.evaluate(() => document.body.dataset.phase)) === 'play', { o: (await gs(page)).overlay, t: await txt(page, '#goalText') });
      check('こうばでは かくざい の場所が出る', await page.evaluate(() => { const z = document.querySelector('.zone[data-dept="beam"]'); return !!z && !z.hidden; }), null);
      await ctx.close();
    },
  },
  {
    id: 'WW3', tier: 'smoke', title: 'もくもくこうば るすの あいだ（起動・時計を固定）：90 秒 → おかえりカード（seconds 90・effective 45・稼ぎは catchUp と同じ・#awayText に formatYen・「はんぶん」の文）、30 秒 → カードなしで 15 秒ぶん足す、3 時間 → 2 時間ぶん（7200・effective 3600・「2じかんぶん」）、時計が戻った（保存が未来）→ カードなし・お金が減らない、壊れた savedAt（文字・null・オブジェクト・とても大きい）→ 落ちない・カードなし・進みを残す',
    async run({ browser, check, root, errors }) {
      const L = logicOf(root);
      const st = mkState(L, 2);
      const raw = saveOf(L, st, T0);
      const e0 = errors.length;
      const openAt = async (label, nowMs, saveRaw = raw) => openW(browser, label, { v: SMOKE_V(), items: { 'seizai.save': saveRaw }, opts: { clockTime: new Date(nowMs) } });
      // 90 秒
      {
        const { ctx, page } = await openAt('WW3 90秒', T0 + 90 * 1000);
        const s = await gs(page), l = await lg(page);
        const want = L.catchUp(st, 90).report;
        const at = await txt(page, '#awayText'), card = await txt(page, '#awayCard');
        check(`90 秒閉じて開くと おかえりカード（overlay ${s.overlay}）、lastAway.seconds ${s.lastAway && s.lastAway.seconds}・effective ${s.lastAway && s.lastAway.effective}（半分の速さで 45）`, s.overlay === 'away' && s.lastAway && s.lastAway.seconds === 90 && s.lastAway.effective === 45 && (await shown(page, '#awayCard')), s.lastAway);
        check(`稼ぎ ${s.lastAway && s.lastAway.earned} えんが、同じ保存から catchUp(90) した稼ぎ ${want.earned} と同じ（0 でない）、logic の t が 45 秒すすむ（${st.t} → ${l.t.toFixed(1)}）`, s.lastAway && s.lastAway.earned === want.earned && want.earned > 0 && l.t - st.t >= 45 && l.t - st.t < 45 + 3, { got: s.lastAway, want });
        check(`#awayText「${at}」に formatYen(earned)、カードに「はんぶん」の文（2じかんぶん ではない）`, s.lastAway && at.includes(L.formatYen(s.lastAway.earned)) && /はんぶん/.test(card) && !/2じかんぶん/.test(card), card);
        await pressCard(page, '#awayOk');
        check('#awayOk で閉じて遊べる（overlay null・phase play）', (await gs(page)).overlay === null && (await gs(page)).phase === 'play', await gs(page));
        await ctx.close();
      }
      // 30 秒
      {
        const { ctx, page } = await openAt('WW3 30秒', T0 + 30 * 1000);
        const s = await gs(page), l = await lg(page);
        check(`30 秒（60 秒未満）はカードなしで足す（overlay ${s.overlay}・effective ${s.lastAway && s.lastAway.effective}・t ${st.t} → ${l.t.toFixed(1)}）`, s.overlay === null && s.lastAway && s.lastAway.seconds === 30 && s.lastAway.effective === 15 && l.t - st.t >= 15 && l.t - st.t < 15 + 3 && !(await shown(page, '#awayCard')), s.lastAway);
        await ctx.close();
      }
      // 3 時間
      {
        const { ctx, page } = await openAt('WW3 3時間', T0 + 3 * 3600 * 1000);
        const s = await gs(page), l = await lg(page);
        const card = await txt(page, '#awayCard');
        check(`3 時間 → 上限の 2 時間ぶん（seconds ${s.lastAway && s.lastAway.seconds}・effective ${s.lastAway && s.lastAway.effective}・t +${(l.t - st.t).toFixed(0)}・稼ぎは catchUp(7200) と同じ）`, s.overlay === 'away' && s.lastAway && s.lastAway.seconds === 7200 && s.lastAway.effective === 3600 && l.t - st.t >= 3600 && l.t - st.t < 3600 + 3 && s.lastAway.earned === L.catchUp(st, 7200).report.earned, s.lastAway);
        check(`上限で切られたので lastAway.capped が true、カードに「2じかんぶん」の文: ${card}`, s.lastAway && s.lastAway.capped === true && /2じかんぶん/.test(card), { card, capped: s.lastAway && s.lastAway.capped });
        await ctx.close();
      }
      // 時計が戻った（保存の時刻が 1 時間 未来）
      {
        const { ctx, page } = await openAt('WW3 時計が戻る', T0 - 3600 * 1000);
        const s = await gs(page), l = await lg(page);
        check(`端末の時計が保存より 1 時間 前 → カードなし（overlay ${s.overlay}）・effective ${s.lastAway && s.lastAway.effective}・お金が減らない（${st.money} → ${l.money}）・t が跳ねない（+${(l.t - st.t).toFixed(1)}）`, s.overlay === null && s.lastAway && s.lastAway.effective === 0 && s.lastAway.seconds === 0 && l.money >= st.money && Number.isFinite(l.money) && l.t - st.t < 3 && l.stage === 2, { a: s.lastAway, m: l.money, t: l.t });
        await ctx.close();
      }
      // 壊れた savedAt
      const bad = [];
      for (const v of ['abc', null, { x: 1 }, 1e300, '1792000000000']) {
        const { ctx, page } = await openAt('WW3 壊れた日付', T0 + 600 * 1000, withSavedAt(raw, v));
        const s = await gs(page), l = await lg(page);
        if (!(s.overlay === null && s.lastAway && s.lastAway.effective === 0 && l.stage === 2 && l.depts.cut.staff === st.depts.cut.staff && l.money >= st.money && Number.isFinite(l.money) && l.t - st.t < 3)) bad.push({ v, overlay: s.overlay, a: s.lastAway, stage: l.stage, m: l.money, t: l.t });
        await ctx.close();
      }
      check('壊れた savedAt 5 通り（"abc"・null・オブジェクト・1e300（とても未来）・数の文字）はカードなし・進み（段・人・お金）を残す', bad.length === 0, bad);
      check('ページエラー・コンソールエラーが無い', errors.length === e0, errors.slice(e0));
    },
  },
  {
    id: 'WW4', tier: 'smoke', title: 'もくもくこうば るすの あいだ（時計・タイムゾーン 2 通り）：23:59:30 に閉じて 翌 0:01:00 に開くと 90 秒（日本・ロサンゼルス）。開いたまま hidden → 90 秒 → visible でカード（effective 45）、もう一度 visibilitychange・pageshow を送っても二重に足さない、hidden の間は描かない、時計を 1 時間 戻して開くとカードなし・お金が減らない',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const st = mkState(L, 2);
      for (const tz of TIMEZONES) {
        const close = zonedTime(tz, 2026, 10, 20, 23, 59, 30), open = zonedTime(tz, 2026, 10, 21, 0, 1, 0);
        const { ctx, page } = await openW(browser, `WW4 ${tz}`, { v: SMOKE_V(), items: { 'seizai.save': saveOf(L, st, close.getTime()) }, opts: { clockTime: open, timezoneId: tz } });
        const s = await gs(page);
        const day = await page.evaluate(() => [new Date().getDate(), new Date().getHours(), new Date().getMinutes()]);
        check(`${tz}：23:59:30 に閉じて 翌 0:01:00（ページの時計 ${day[0]}日 ${day[1]}:${String(day[2]).padStart(2, '0')}）に開くと 90 秒（effective 45）・おかえりカード`, day[0] === 21 && day[1] === 0 && s.overlay === 'away' && s.lastAway && s.lastAway.seconds === 90 && s.lastAway.effective === 45, { day, a: s.lastAway, o: s.overlay });
        if (tz !== TIMEZONES[0]) { await ctx.close(); continue; }
        // 開いたまま裏に回す
        await pressCard(page, '#awayOk');
        await setHidden(page, true); await wait(page, 50);
        const h0 = await gs(page);
        await wait(page, 1000);
        const h1 = await gs(page);
        check(`hidden で phase paused・body[data-phase]=paused、隠れている 1 秒の間に描かない（frames ${h0.frames} → ${h1.frames}）`, h0.phase === 'paused' && (await page.evaluate(() => document.body.dataset.phase)) === 'paused' && h1.frames === h0.frames, { h0: h0.frames, h1: h1.frames, p: h0.phase });
        const w = (await gs(page)).wallLast;
        await page.clock.setSystemTime(new Date(w + 90 * 1000 + 300));
        await setHidden(page, false); await wait(page, 50);
        const v1 = await gs(page), l1 = await lg(page);
        check(`90 秒後に visible でおかえりカード（seconds ${v1.lastAway && v1.lastAway.seconds}・effective ${v1.lastAway && v1.lastAway.effective}）`, v1.overlay === 'away' && v1.lastAway && v1.lastAway.seconds === 90 && v1.lastAway.effective === 45, v1.lastAway);
        await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); document.dispatchEvent(new Event('visibilitychange')); });
        await wait(page, 50);
        const v2 = await gs(page), l2 = await lg(page);
        check(`もう一度 visibilitychange・pageshow を送っても二重に足さない（lastAway が同じ・t ${l1.t.toFixed(1)} → ${l2.t.toFixed(1)}）`, JSON.stringify(v2.lastAway) === JSON.stringify(v1.lastAway) && l2.t - l1.t < 1, { v1: v1.lastAway, v2: v2.lastAway });
        await pressCard(page, '#awayOk');
        // 時計を戻す
        await setHidden(page, true); await wait(page, 50);
        const m0 = (await lg(page)).money, w2 = (await gs(page)).wallLast;
        await page.clock.setSystemTime(new Date(w2 - 3600 * 1000));
        await setHidden(page, false); await wait(page, 50);
        const b = await gs(page), lb = await lg(page);
        check(`時計を 1 時間 戻して開く → カードなし（overlay ${b.overlay}）・seconds ${b.lastAway && b.lastAway.seconds}・お金が減らない（${m0} → ${lb.money}）`, b.overlay === null && b.lastAway && b.lastAway.seconds === 0 && b.lastAway.effective === 0 && lb.money >= m0 && b.phase === 'play', { a: b.lastAway, m0, m: lb.money });
        await ctx.close();
      }
    },
  },
  {
    id: 'WW5', tier: 'smoke', title: 'もくもくこうば 保存：買うとすぐ・遊んで 10 秒ごとに seizai.save を書く（saveCount）、再読み込みで同じ段・人数・お金（以上）、壊れた保存（JSON でない・v:2）は落ちずに 1 から・元の文字を seizai.save.bak に写す（bak が既にあれば上書きしない）・ヒント、保存できなくても遊べる、ほかのゲームの保存キーを変えない',
    async run({ browser, check, root, errors }) {
      const L = logicOf(root);
      const st = mkState(L, 2, { money: 50000 });
      const others = { 'matomete.best': '123', 'michibiki.best': '7', 'blockpuzzle.sound': 'on', 'tile2048.best': '2048' };
      const { ctx, page } = await openW(browser, 'WW5', { v: SMOKE_V(), items: { 'seizai.save': saveOf(L, st, T0), ...others }, opts: { clockTime: new Date(T0 + 1000) } });
      const c0 = (await gs(page)).saveCount;
      await page.evaluate(() => window.SeizaiGame.buy('cut', 'level'));
      const c1 = (await gs(page)).saveCount;
      const saved = JSON.parse(await stored(page, 'seizai.save'));
      check(`買うとすぐ保存（saveCount ${c0} → ${c1}、保存のきこりの Lv ${saved.depts && saved.depts.cut.level}）`, c1 === c0 + 1 && saved.v === 1 && saved.depts.cut.level === st.depts.cut.level + 1, { c0, c1 });
      await wait(page, 5000);
      const c2 = (await gs(page)).saveCount;
      await wait(page, 6000);
      const c3 = (await gs(page)).saveCount;
      check(`遊んでいる間は 10 秒ごと（5 秒では書かず ${c1} → ${c2}、11 秒で書く → ${c3}）`, c2 === c1 && c3 >= c1 + 1 && c3 <= c1 + 2, { c1, c2, c3 });
      const before = await lg(page);
      await page.reload(); await wait(page, 300);
      const after = await lg(page);
      check(`再読み込みで同じ段 ${after.stage}・きこり ${after.depts.cut.staff} 人 Lv${after.depts.cut.level}・お金 ${before.money} → ${after.money}（以上）`, after.stage === before.stage && after.depts.cut.staff === before.depts.cut.staff && after.depts.cut.level === before.depts.cut.level && after.money >= before.money && (await gs(page)).overlay === null, { before: before.depts.cut, after: after.depts.cut });
      await page.goto(BASE + 'manifest.webmanifest');
      const keys = await page.evaluate((ks) => ({ others: Object.fromEntries(ks.map((k) => [k, localStorage.getItem(k)])), mine: Object.keys(localStorage).filter((k) => /^seizai\./.test(k)).sort() }), Object.keys(others));
      check(`ほかのゲームの保存キーが変わらない・書くのは seizai.* だけ（${keys.mine.join(',')}）`, JSON.stringify(keys.others) === JSON.stringify(others) && keys.mine.every((k) => ['seizai.save', 'seizai.best', 'seizai.help', 'seizai.save.bak'].includes(k)), keys);
      // 壊れた保存
      const e0 = errors.length;
      const v2 = JSON.stringify({ ...JSON.parse(saveOf(L, st, T0)), v: 2 });
      const rows = [];
      const v3 = JSON.stringify({ ...JSON.parse(saveOf(L, st, T0)), v: 3 });
      for (const [name, rawSave, bak, wantBak, newerKey] of [['JSON でない', '{bad', null, '{bad'], ['v:2（新しい版）', v2, null, v2, 'seizai.save.v2'], ['配列', '[1,2]', null, '[1,2]'], ['bak が既にある', '{bad2', 'first', 'first'], ['bak が既にあって v:3（新しい版）', v3, 'first', 'first', 'seizai.save.v3']]) {
        await gotoW(page, { 'seizai.save': rawSave, ...(bak ? { 'seizai.save.bak': bak } : {}) });
        await wait(page, 100);
        const s = await gs(page), l = await lg(page);
        const nk = newerKey ? await stored(page, newerKey) : null;
        rows.push({ name, ok: (await stored(page, 'seizai.save.bak')) === wantBak && (!newerKey || nk === rawSave) && l.stage === 1 && s.overlay === null && !!(await txt(page, '#hint')), bak: await stored(page, 'seizai.save.bak'), newer: newerKey && (nk === rawSave), stage: l.stage, hint: await txt(page, '#hint') });
      }
      check('壊れた保存（JSON でない・v:2・配列）は 1 から始まり、元の文字を seizai.save.bak に写す、bak が既にあれば上書きしない、新しい版（v:2・v:3）は seizai.save.v<n> にも残す（bak があっても消えない。§17.1 A7）、ヒントを出す', rows.every((r) => r.ok), rows);
      check('壊れた保存でもページエラーが無い', errors.length === e0, errors.slice(e0));
      await ctx.close();
      // 保存できない環境
      const NO_STORE = () => { for (const m of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) Storage.prototype[m] = function () { throw new DOMException('denied', 'SecurityError'); }; };
      const b = await newPage(browser, SMOKE_V(), 'WW5 保存不可', { clock: true, initScript: NO_STORE });
      const e1 = errors.length;
      await b.page.goto(SZ); await wait(b.page, 300);
      await closeCards(b.page);
      const m0 = (await gs(b.page)).money;
      const m1 = (await adv(b.page, 120)).money;
      await b.page.click('.zone[data-dept="cut"]'); await wait(b.page, 100);
      check(`localStorage が例外でも開いて遊べる（お金 ${m0} → ${m1}・シートが開く）、エラーなし`, m1 > m0 && (await gs(b.page)).sheet === 'cut' && errors.length === e1, { m0, m1, errs: errors.slice(e1) });
      await b.ctx.close();
    },
  },
  {
    id: 'WW6', tier: 'smoke', title: 'もくもくこうば 戻る：遊んでいる途中・シート・遊び方・おかえり・節目・注文・エンディングのカードのどこからでも a#back が見えて押せ、メニューへ戻る',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openW(browser, 'WW6', { v: SMOKE_V(), debug: true });
      check('a#back の href がメニュー（BASE）', (await page.evaluate(() => document.querySelector('a#back')?.href)) === BASE, null);
      const r = {};
      const go = async (name) => {
        const reach = await reachable(page, 'a#back');
        await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
        r[name] = reach && page.url() === BASE;
        await gotoW(page, {}, { debug: true });
      };
      await page.click('.zone[data-dept="peel"]'); await wait(page, 100);
      r.sheetOpen = (await gs(page)).sheet === 'peel';
      await go('sheet');
      await page.click('#helpBtn'); await wait(page, 100);
      r.helpOpen = (await gs(page)).overlay === 'help';
      await go('help');
      await page.evaluate(() => window.SeizaiGame.away(600)); await wait(page, 50);
      r.awayOpen = (await gs(page)).overlay === 'away';
      await go('away');
      await setL(page, 'l.goal.done = 100; l.money = 5000;'); await wait(page, 100);
      await page.click('#expandBtn');
      r.stageOpen = await waitOverlay(page, 'stage', 2500);
      await go('stage');
      await goStage(page, 3);
      await dbg(page, 'neworder');
      r.orderOpen = (await gs(page)).overlay === 'order';
      await go('order');
      await goStage(page, 4);
      const need = L.shipNeed(0);
      await dbg(page, 'ships', { n: 0, got: need - 5 });
      await adv(page, 60);
      r.endOpen = (await gs(page)).overlay === 'end';
      await go('end');
      check('シート・遊び方・おかえり・節目・注文・エンディングのどれからも a#back が見えて押せ、メニューが開く', Object.values(r).length === 12 && Object.values(r).every(Boolean), r);
      await ctx.close();
    },
  },

  // ================= full =================
  {
    id: 'WW7', tier: 'full', title: 'もくもくこうば 大口の注文（こうば から・とくべつな注文の見出しと data-big）：こうじょうで注文が来ると #orderCard（出た直後は押せない・お礼は formatYen）、「あとで」で閉じても #orderTag（button）が残り、押すと開き直す、「うける」で #orderTag に「積んだ数/注文の数」、届くとお礼が入りヒントに出る、注文は1つずつ',
    async run({ browser, check }) {
      const { ctx, page } = await openW(browser, 'WW7', { debug: true });
      await goStage(page, 3);
      await setL(page, 'l.money = 1000000;');
      const o = await dbg(page, 'neworder');
      const s = await gs(page);
      const ot = await txt(page, '#orderText') ?? await txt(page, '#orderCard');
      check(`注文が来ると #orderCard（overlay ${s.overlay}）、注文の数 ${o && o.need} は 10 以上の 10 の倍数・お礼 ${o && o.reward} を formatYen で出す（${ot}）`, s.overlay === 'order' && (await shown(page, '#orderCard')) && o && o.need >= 10 && o.need % 10 === 0 && o.reward > 0 && ot.includes(await yenIn(page, o.reward)), { o, ot });
      await page.evaluate(() => document.querySelector('#orderAccept').click()); await wait(page, 50);
      check('出た直後（400ms 以内）に「うける」を押しても受けない', (await gs(page)).overlay === 'order' && (await gs(page)).order.accepted === false, (await gs(page)).order);
      await pressCard(page, '#orderLater');
      const tag = await page.evaluate(() => { const t = document.querySelector('#orderTag'); return t && { tag: t.tagName, hidden: t.hidden, text: t.textContent.trim() }; });
      check(`「あとで」で閉じても札が残る（#orderTag ${tag && tag.tag}・「${tag && tag.text}」）、注文は受けていない`, (await gs(page)).overlay === null && tag && tag.tag === 'BUTTON' && !tag.hidden && (await gs(page)).order && (await gs(page)).order.accepted === false, tag);
      await page.click('#orderTag'); await wait(page, 60);
      check('#orderTag を押すと注文のカードが開き直す', (await gs(page)).overlay === 'order', (await gs(page)).overlay);
      await pressCard(page, '#orderAccept');
      const s2 = await gs(page);
      await adv(page, 1);
      const o2 = (await gs(page)).order;
      const tt = await txt(page, '#orderTag');
      check(`「うける」で受けて（accepted）、#orderTag「${tt}」に 積んだ数/注文の数`, s2.overlay === null && o2 && o2.accepted === true && tt.includes(`${o2.got.toLocaleString('ja-JP')}/${o2.need.toLocaleString('ja-JP')}`), { o2, tt });
      // 届くまで進める
      let m0 = (await lg(page)).money, done = null, hint = '';
      for (let i = 0; i < 120 && !done; i++) {
        const before = await lg(page);
        await adv(page, 10);
        const now = await gs(page);
        if (!now.order || now.order.id !== o.id) { done = { gain: (await lg(page)).money - before.money, order: now.order }; hint = await txt(page, '#hint'); }
      }
      check(`届くとお礼（${o.reward} えん）が入り（10 秒で ${done && done.gain} えん増えた）、ヒント「${hint}」に formatYen(お礼)`, !!done && done.gain >= o.reward && hint.includes(await yenIn(page, o.reward)), { done, hint, m0 });
      const after = await gs(page);
      check('届いたあと、受けていた注文は消え、出ていても新しい注文は1つだけ（受けていない）', !after.order || (after.order.id !== o.id && after.order.accepted === false), after.order);
      await closeCards(page);
      // とくべつな ちゅうもん（§17.2 C3）：見出し「とくべつな ちゅうもん」・#orderTag と #orderCard に data-big="1"
      await setL(page, 'l.order = { id: 99, who: "まちの やくば", need: 30, got: 0, reward: 12345, accepted: false, big: true };');
      await wait(page, 50);
      await page.click('#orderTag'); await wait(page, 60);
      const bigView = await page.evaluate(() => ({ title: document.querySelector('#orderTitle') && document.querySelector('#orderTitle').textContent.trim(), card: document.querySelector('#orderCard').dataset.big, tag: document.querySelector('#orderTag').dataset.big }));
      check(`とくべつな注文：カードの見出し「${bigView.title}」、#orderCard・#orderTag に data-big="1"`, (await gs(page)).overlay === 'order' && bigView.title === 'とくべつな ちゅうもん' && bigView.card === '1' && bigView.tag === '1', bigView);
      await pressCard(page, '#orderLater');
      await setL(page, 'l.order = { id: 100, who: "まちの やくば", need: 30, got: 0, reward: 12345, accepted: false, big: false };');
      await wait(page, 50);
      await page.click('#orderTag'); await wait(page, 60);
      const norView = await page.evaluate(() => ({ title: document.querySelector('#orderTitle').textContent.trim(), card: document.querySelector('#orderCard').dataset.big, tag: document.querySelector('#orderTag').dataset.big }));
      check(`ふつうの注文：見出し「${norView.title}」（とくべつ ではない）、data-big="0"`, norView.title !== 'とくべつな ちゅうもん' && norView.card === '0' && norView.tag === '0', norView);
      await pressCard(page, '#orderLater');
      // 大口の注文は こうば から（§17.2 C2。ユーザー決定「2段目から」）
      await goStage(page, 2);
      const o3 = await dbg(page, 'neworder');
      const ot3 = await txt(page, '#orderText');
      check(`こうば でも neworder で注文が出て、品は かくざい（${ot3}）`, (await gs(page)).overlay === 'order' && o3 && o3.need >= 10 && /かくざい/.test(ot3 || ''), { o3, ot3 });
      await ctx.close();
    },
  },
  {
    id: 'WW8', tier: 'full', title: 'もくもくこうば 大きな船の注文：みなとで #goalText が goalOf（30,000）、1せき目で #endCard（Esc で閉じない・seizai.best=5）→「このまま あそぶ」で #goalText が次の船（36,000）・#shipCount が 1、2せき目はカードなし・ヒントにお礼・#shipCount 2・お金が増える、最大の桁（ships 9999・SHIP_NEED_MAX）で #goalText・#shipCount が SE 幅で崩れない',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openW(browser, 'WW8', { debug: true });
      await goStage(page, 4);
      const g0 = L.goalOf(await lg(page));
      check(`みなとの #goalText「${await txt(page, '#goalText')}」が goalOf（船・${L.shipNeed(0)}）、#shipCount は隠れている`, (await txt(page, '#goalText')) === g0.text && g0.kind === 'ship' && g0.need === 30000 && !(await shown(page, '#shipCount')), g0);
      await dbg(page, 'ships', { n: 0, got: 30000 - 5 });
      await adv(page, 60);
      const s1 = await gs(page);
      check(`1せき目が届くとエンディング（overlay ${s1.overlay}・ships ${s1.ships}・cleared）、seizai.best=${await stored(page, 'seizai.best')}`, s1.overlay === 'end' && s1.ships === 1 && s1.cleared && (await shown(page, '#endCard')) && (await stored(page, 'seizai.best')) === '5', s1);
      await wait(page, 450);
      await page.keyboard.press('Escape'); await wait(page, 50);
      check('エンディングのカードは Esc で閉じない', (await gs(page)).overlay === 'end', (await gs(page)).overlay);
      await pressCard(page, '#endOk');
      const g1 = L.goalOf(await lg(page));
      check(`「このまま あそぶ」で #goalText が次の船「${await txt(page, '#goalText')}」（${g1.need}）、#shipCount「${await txt(page, '#shipCount')}」`, (await gs(page)).overlay === null && (await txt(page, '#goalText')) === g1.text && g1.need === 36000 && (await shown(page, '#shipCount')) && /(^|\D)1(\D|$)/.test(await txt(page, '#shipCount')), g1);
      // 2せき目
      await dbg(page, 'ships', { n: 1, got: 36000 - 5 });
      const la = await lg(page), price = L.priceOf(la), reward = Math.floor(0.5 * 36000 * price);
      await adv(page, 60);
      const s2 = await gs(page), lb = await lg(page);
      const hint = await txt(page, '#hint');
      check(`2せき目はカードなし（overlay ${s2.overlay}・待ちの列 ${s2.queue}）、ships 2、#shipCount「${await txt(page, '#shipCount')}」`, s2.ships === 2 && s2.overlay === null && !s2.queue.includes('end') && /(^|\D)2(\D|$)/.test(await txt(page, '#shipCount')), s2);
      check(`2せき目のお礼 floor(0.5 × 36000 × ${price}) = ${reward} えんが入り（${la.money} → ${lb.money}）、ヒント「${hint}」に formatYen(お礼)`, lb.money - la.money >= reward && hint.includes(L.formatYen(reward)), { hint, reward, m: [la.money, lb.money] });
      // 最大の桁
      await dbg(page, 'ships', { n: 9999, got: 0 });
      await setL(page, 'l.money = SeizaiLogic.MONEY_MAX;');
      await page.setViewportSize({ width: 320, height: 568 }); await wait(page, 300);
      const g9 = L.goalOf(await lg(page));
      const fg = await fits(page, '#goalText'), fs9 = await fits(page, '#shipCount'), fm = await fits(page, '#money');
      check(`ships 9999・SHIP_NEED_MAX：#goalText「${fg.text}」が goalOf（${L.SHIP_NEED_MAX}）、SE 幅で #goalText・#shipCount「${fs9.text}」・#money「${fm.text}」がはみ出さない`, fg.text === g9.text && g9.need === L.SHIP_NEED_MAX && fg.ok && fs9.ok && fm.ok && /9,?999/.test(fs9.text) && fm.text === L.formatYen(L.MONEY_MAX), { fg, fs9, fm });
      await ctx.close();
    },
  },
  {
    id: 'WW9', tier: 'full', title: 'もくもくこうば 画面内：SE 縦（ホーム画面・Safari）・SE 横（568×320・568×270）・iPhone 13・iPad で、こうじょう・お金 MONEY_MAX・Lv50・注文の札・広げるボタン・シートを開いた状態で、ボタンが画面内・44px 以上・重ならない、.zone が 44px 以上で #scene の幅の中、#money・#goalText がはみ出さない、横スクロールなし。遊び方は SE 縦横でスクロールなしで「わかった」が押せる',
    async run({ browser, check }) {
      const views = [view('SE', 'p', 'app'), view('SE', 'p', 'safari'), view('SE', 'l', 'app'), view('SE', 'l', 'safari'), view('i13', 'p', 'app'), view('iPad', 'p', 'app'), view('iPad', 'l', 'app')];
      for (const v of views) {
        const { ctx, page } = await openW(browser, `WW9 ${v.label}`, { v, debug: true });
        await goStage(page, 3);
        await setL(page, 'l.money = SeizaiLogic.MONEY_MAX; for (const d of Object.values(l.depts)) d.level = 50; l.goal.done = SeizaiLogic.STAGES[2].goal;');
        await dbg(page, 'neworder');
        await pressCard(page, '#orderLater');
        await page.click('.zone[data-dept="peel"]'); await wait(page, 200);
        // 横向き（高さ 500 以下）はシートを #goal の上に重ねて出す設計（§5.1・index.html）なので、#goal の中身とシートの重なりは縦向きだけ見る。
        // 閉じたときの #goal の中身は、シートを閉じてからもう一度見る
        const land = v.w > v.h && v.h <= 500;
        const head = '#back, #helpBtn, #soundBtn', goalBtns = '#expandBtn, #orderTag', sheetBtns = '#sheetClose, #sheet [data-buy], #mgrFast, #mgrGain';
        const btns = land ? `${head}, ${sheetBtns}` : `${head}, ${goalBtns}, ${sheetBtns}`;
        const lp = await layoutProbe(page, btns, v.safe, { overlapSel: land ? btns : btns + ', #money, #goalText, #goalBar', minSel: btns });
        await page.click('#sheetClose'); await wait(page, 100);
        const lc = await layoutProbe(page, `${head}, ${goalBtns}`, v.safe, { overlapSel: `${head}, ${goalBtns}, #money, #goalText, #goalBar`, minSel: `${head}, ${goalBtns}` });
        check(`${v.label}：シートを閉じた形で、上の帯と #goal のボタン ${lc.n} 個（広げる・注文の札を含む）が画面内・44px 以上・重ならない（${[...lc.outside, ...lc.small, ...lc.overlaps].join(' ') || 'なし'}）`, lc.n >= 5 && lc.outside.length === 0 && lc.small.length === 0 && lc.overlaps.length === 0, lc);
        await page.click('.zone[data-dept="peel"]'); await wait(page, 200);
        const zones = await page.evaluate(() => {
          const sc = document.querySelector('#scene').getBoundingClientRect();
          return [...document.querySelectorAll('.zone[data-dept]')].filter((z) => !z.hidden).map((z) => { const r = z.getBoundingClientRect(); return { d: z.dataset.dept, w: Math.round(r.width), h: Math.round(r.height), inX: r.left >= sc.left - 0.5 && r.right <= sc.right + 0.5 }; });
        });
        const fm = await fits(page, '#money'), fg = await fits(page, '#goalText');
        const st = await gs(page);
        check(`${v.label}：シートを開いた形で、ボタン ${lp.n} 個が画面内・44px 以上・重ならない、横スクロールなし（はみ出し ${lp.outside.join(' ') || 'なし'}・小さい ${lp.small.join(' ') || 'なし'}・重なり ${lp.overlaps.join(' ') || 'なし'}）`, lp.n >= 7 && lp.outside.length === 0 && lp.small.length === 0 && lp.overlaps.length === 0 && !lp.hscroll && st.sheet === 'peel', lp);
        check(`${v.label}：.zone ${zones.length} 個が 44px 以上で #scene の幅の中`, zones.length >= 7 && zones.every((z) => z.w >= 44 && z.h >= 44 && z.inX), zones);
        check(`${v.label}：#money「${fm.text}」（MONEY_MAX）・#goalText「${fg.text}」がはみ出さない`, fm.ok && fg.ok, { fm, fg });
        if (v.label.startsWith('SE')) {
          await page.click('#helpBtn'); await wait(page, 100);
          const h = await page.evaluate(() => {
            const b = document.querySelector('#helpOk'), r = b.getBoundingClientRect();
            const box = document.querySelector('#help');
            return { ok: r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.left >= 0 && r.right <= innerWidth + 0.5 && r.height >= 43.5, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b, scroll: box.scrollHeight <= box.clientHeight + 1, items: document.querySelectorAll('#help li').length, role: box.getAttribute('role') };
          });
          check(`${v.label}：遊び方（role=dialog・${h.items} 項目）はスクロールなしで「わかった」が画面内で押せる`, h.ok && h.hit && h.scroll && h.items >= 1 && h.items <= 3 && h.role === 'dialog', h);
        }
        await ctx.close();
      }
    },
  },
  {
    id: 'WW10', tier: 'full', cdp: 'CDP の CPU 低速化', title: 'もくもくこうば 性能：みなとで全部最大（人 60 前後）にして、CPU 4 倍遅く（CDP）で 6 秒、人の数 66 以下、34ms を超えるコマが 5% 以下',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, view('SE', 'p', 'app'), 'WW10');
      await seed(page, { 'seizai.help': '1' });
      await page.goto(SZD); await sleep(500);
      if (!(await page.evaluate(() => !!window.SeizaiGame && !!window.YubiDebug))) throw new Error('SeizaiGame・YubiDebug が無い');
      await dbg(page, 'gostage', { stage: 4 });
      await setL(page, 'const C = SeizaiLogic.CAPS[3]; for (const d of Object.keys(l.depts)) { const x = l.depts[d]; if ("lines" in x) x.lines = C[d]; else x.staff = C[d]; x.level = 50; x.mgr = "fast"; } l.money = 1e9;');
      await sleep(400);
      await closeCards(page);
      await sleep(2500);
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const a = await gs(page);
      await sleep(6000);
      const b = await gs(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const frames = b.frames - a.frames, slow = b.slowFrames - a.slowFrames;
      check(`人の数 ${b.actors}（40〜66。§19.3.1）`, b.actors >= 40 && b.actors <= 66, b.actors);
      check(`CPU 4 倍遅くで 6 秒：${frames} コマのうち 34ms を超えたのは ${slow}（${(slow / Math.max(1, frames) * 100).toFixed(1)}%、5% 以下）`, frames >= 100 && slow / frames <= 0.05, { frames, slow });
      await ctx.close();
    },
  },
  {
    id: 'WW11', tier: 'full', title: 'もくもくこうば 中断：hidden で rAF が止まり（frames が増えない・お金も t も進まない）、pagehide でタイマー（later）を全部片付ける（timers 0）、pageshow で戻ると動き出す',
    async run({ browser, check }) {
      const { ctx, page } = await openW(browser, 'WW11');
      await setL(page, 'l.money = 0;');
      await page.click('.zone[data-dept="cut"]'); await wait(page, 100);
      await page.click('#sheet [data-buy="staff"]', { force: true }); await wait(page, 50);   // ヒント（3 秒のタイマー）が出る
      const t0 = (await gs(page)).timers;
      await setHidden(page, true); await wait(page, 50);
      const a = await gs(page), la = await lg(page);
      await wait(page, 2000);
      const b = await gs(page), lb = await lg(page);
      check(`hidden の 2 秒で描かず（frames ${a.frames} → ${b.frames}）、ロジックも進まない（t ${la.t.toFixed(1)} → ${lb.t.toFixed(1)}）`, a.phase === 'paused' && b.frames === a.frames && lb.t === la.t, { a: a.frames, b: b.frames });
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      const c = await gs(page);
      check(`pagehide でタイマーを片付ける（timers ${t0} → ${c.timers}）`, t0 > 0 && c.timers === 0, { t0, c: c.timers });
      await setHidden(page, false);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await wait(page, 1000);
      const d = await gs(page), ld = await lg(page);
      check(`戻ると動き出す（phase ${d.phase}・frames ${b.frames} → ${d.frames}・t ${lb.t.toFixed(1)} → ${ld.t.toFixed(1)}）`, d.phase === 'play' && d.frames > b.frames && ld.t > lb.t, d);
      await ctx.close();
    },
  },
  {
    id: 'WW12', tier: 'full', title: 'もくもくこうば キーボード：Tab で .zone に移り Enter でシート、Tab でシートの買うボタンへ移り Enter で買える、Esc でシートを閉じる、E で広げる、? で遊び方・Esc で閉じる、M で音のオン・オフ、押しっぱなしの Enter で続けて買わない',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const st = mkState(L, 1, { money: 100000 });
      const { ctx, page } = await openW(browser, 'WW12', { items: { 'seizai.save': saveOf(L, st, T0) }, opts: { clockTime: new Date(T0 + 1000), touch: false } });
      const focusTo = async (sel, max = 40) => { for (let i = 0; i < max; i++) { if (await page.evaluate((s) => !!document.activeElement && document.activeElement.matches(s), sel)) return true; await page.keyboard.press('Tab'); } return false; };
      const z = await focusTo('.zone[data-dept="cut"]');
      await page.keyboard.press('Enter'); await wait(page, 100);
      check('Tab で きこりの場所へ移り、Enter でシートが開く', z && (await gs(page)).sheet === 'cut', await gs(page));
      const n0 = (await lg(page)).depts.cut.level;
      const f = await focusTo('#sheet [data-buy="level"]');
      await page.keyboard.press('Enter'); await wait(page, 100);
      const n1 = (await lg(page)).depts.cut.level;
      check(`Tab でシートの「きかいを よくする」へ移り、Enter で買える（Lv${n0} → Lv${n1}）`, f && n1 === n0 + 1, { f, n0, n1 });
      await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter'); await wait(page, 100);
      const n2 = (await lg(page)).depts.cut.level;
      check(`押しっぱなしの Enter（repeat）で続けて買わない（${n1} → ${n2}、1 回まで）`, n2 <= n1 + 1, { n1, n2 });
      await page.keyboard.press('Escape'); await wait(page, 100);
      check('Esc でシートを閉じる', (await gs(page)).sheet === null && !(await shown(page, '#sheet')), (await gs(page)).sheet);
      await setL(page, 'l.goal.done = 100; l.money = 100000;'); await wait(page, 100);
      await page.locator('#money').click().catch(() => {});
      await page.keyboard.press('e'); await wait(page, 100);
      check('E で広げる（段 2）', (await gs(page)).stage === 2, (await gs(page)).stage);
      await waitOverlay(page, 'stage', 2500);
      await pressCard(page, '#stageOk');
      await page.keyboard.press('?'); await wait(page, 100);
      const h = (await gs(page)).overlay;
      await wait(page, 450);
      await page.keyboard.press('Escape'); await wait(page, 100);
      check(`? で遊び方（${h}）、Esc で閉じる（${(await gs(page)).overlay}）`, h === 'help' && (await gs(page)).overlay === null, h);
      const p0 = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      await page.keyboard.press('m'); await wait(page, 50);
      const p1 = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      await page.keyboard.press('m'); await wait(page, 50);
      const p2 = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      check(`M で音のオン・オフ（aria-pressed ${p0} → ${p1} → ${p2}）`, p0 !== p1 && p2 === p0, [p0, p1, p2]);
      await ctx.close();
    },
  },
  {
    id: 'WW13', tier: 'full', title: 'もくもくこうば 動きを減らす：reducedMotion reduce で calm、広げるとすぐ #stageCard（演出の待ちなし）。ふつうの設定では calm false で、広げた直後はまだカードを出さない',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const st = mkState(L, 1, { money: 100000, goal: { done: 100 } });
      for (const reduce of [true, false]) {
        const { ctx, page } = await openW(browser, `WW13 ${reduce ? 'reduce' : 'ふつう'}`, { items: { 'seizai.save': saveOf(L, st, T0) }, opts: { clockTime: new Date(T0 + 1000), reducedMotion: reduce ? 'reduce' : 'no-preference' } });
        const c = (await gs(page)).calm;
        await page.click('#expandBtn'); await wait(page, 100);
        const o = (await gs(page)).overlay;
        check(`${reduce ? 'reduce' : 'ふつう'}：calm ${c}、広げて 0.1 秒後のカード ${o}`, reduce ? (c === true && o === 'stage') : (c === false && o === null && (await gs(page)).stage === 2), { c, o });
        await ctx.close();
      }
    },
  },
  {
    id: 'WW14', tier: 'full', audio: true, title: 'もくもくこうば 効果音：応援 cheer・買う buy・足りない deny・マネージャー hire・節目 stage・注文 order・おかえり away・遊んでいる間の作業音（chop・saw・sell のどれか）が鳴り、すべて "seizai" の音の表にあり、最初の 1 回は音の部品が start する。♪でオフにすると鳴らない',
    async run({ browser, check }) {
      const { ctx, page } = await openW(browser, 'WW14', { debug: true, opts: { initScript: SFX_SPY } });
      await page.mouse.click(5, 300).catch(() => {});
      await setL(page, 'l.money = 100000; l.goal.done = 100;');
      await page.click('.zone[data-dept="cut"]'); await wait(page, 100);        // cheer
      await page.click('#sheet [data-buy="staff"]'); await wait(page, 100);     // buy
      await page.click('#expandBtn'); await waitOverlay(page, 'stage', 2500);    // stage
      await pressCard(page, '#stageOk');
      await setL(page, 'l.money = 100000;');
      await page.click('.zone[data-dept="carry"]'); await wait(page, 100);
      await page.click('#sheet [data-buy="mgr"]'); await wait(page, 100);       // hire
      await setL(page, 'l.money = 0;');
      await page.click('#sheet [data-buy="level"]', { force: true }); await wait(page, 100);     // deny
      await page.click('#sheetClose');
      await goStage(page, 3);
      await dbg(page, 'neworder'); await wait(page, 100);                       // order
      await pressCard(page, '#orderLater');
      await page.evaluate(() => window.SeizaiGame.away(600)); await wait(page, 100);   // away
      await pressCard(page, '#awayOk');
      await wait(page, 3000);                                                   // 作業音
      const ps = await plays(page);
      const names = [...new Set(ps.map((p) => p.n))];
      const need = ['cheer', 'buy', 'stage', 'hire', 'deny', 'order', 'away'];
      check(`鳴った音（${names.join(',')}）に ${need.join('・')} と作業音（chop・saw・sell のどれか）がある`, need.every((n) => names.includes(n)) && names.some((n) => ['chop', 'saw', 'sell'].includes(n)), names);
      // 作業音（chop・saw）は合わせて 0.4 秒に 1 回まで（§9。間引かれた回は音の部品が動かない）ので、作業音はどちらか一方が鳴っていればよい
      const silentNames = names.filter((n) => !ps.some((p) => p.n === n && p.d > 0));
      const work = ['chop', 'saw'].filter((n) => names.includes(n));
      check(`鳴らした音はすべて "seizai" の音の表にあり、どの名前も 1 回以上は音の部品が start した（作業音 chop・saw は どちらかで可。動かなかった名前：${silentNames.join(',') || 'なし'}）`, ps.every((p) => p.known) && silentNames.every((n) => work.includes(n)) && (work.length === 0 || work.some((n) => !silentNames.includes(n))), { silentNames, unknown: ps.filter((p) => !p.known) });
      await page.click('#soundBtn'); await wait(page, 50);
      const n0 = (await plays(page)).length;
      await setL(page, 'l.money = 100000;');
      await page.click('.zone[data-dept="cut"]'); await wait(page, 100);
      await page.click('#sheet [data-buy="level"]'); await wait(page, 1000);
      const ps2 = (await plays(page)).slice(n0);
      check(`♪ でオフ（seizai が blockpuzzle.sound=${await stored(page, 'blockpuzzle.sound')} を共通の設定に書く）にすると、買う・作業で音の部品が動かない（${ps2.map((p) => `${p.n}:${p.d}`).join(',')}）`, ps2.length > 0 && ps2.every((p) => p.d === 0), ps2);
      await page.click('#soundBtn');
      await ctx.close();
    },
  },
  {
    id: 'WW15', tier: 'full', title: 'もくもくこうば メニュー・静的：カードの名前が SeizaiLogic.NAME と一致（WW15）・説明・絵がある、seizai.best 1〜4 なら段の名前・5 なら「クリア！」・壊れた値と 0 は「まだ記録なし」、SE 幅でもはみ出さない、押すとゲームが開く。<head> の <title> の直後で debug.js（DG1）、ダブルタップ拡大の抑止（user-scalable=no・ボタンと .zone の touch-action）',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const html = fs.readFileSync(path.join(root, 'games/seizai/index.html'), 'utf8');
      check('<head> の <title> の直後（間は説明のコメントだけ）で ../../common/debug.js を読む（DG1）', /<title>[^<]*<\/title>\s*(?:<!--[\s\S]*?-->\s*)*<script src="\.\.\/\.\.\/common\/debug\.js"><\/script>/.test(html), html.slice(html.indexOf('<title>'), html.indexOf('<title>') + 160));
      check('viewport に user-scalable=no', /name="viewport"[^>]*user-scalable=no/.test(html), null);
      const { ctx, page } = await newPage(browser, STD_V(), 'WW15', { clock: true });
      const card = () => page.evaluate(() => {
        const a = document.querySelector('a.game[href="games/seizai/"]');
        if (!a) return null;
        const b = a.querySelector('.best b');
        const q = a.getBoundingClientRect(), cv = a.querySelector('canvas.art');
        let painted = false;
        if (cv && cv.width > 0) { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { painted = true; break; } }
        return { name: a.querySelector('.name')?.textContent.trim(), desc: a.querySelector('.desc')?.textContent.trim(), best: b?.textContent.trim(), none: b?.classList.contains('none'), right: q.right, h: q.height, painted, fit: b ? b.scrollWidth <= b.clientWidth + 0.5 : false };
      });
      await seed(page, {});
      await page.goto(BASE); await wait(page, 200);
      const c0 = await card();
      check(`メニューにカードがあり、名前（${c0 && c0.name}）が SeizaiLogic.NAME（${L.NAME}）と一致、説明あり、絵が描かれている`, !!c0 && c0.name === L.NAME && !!c0.desc && c0.h >= 44 && c0.painted, c0);
      check(`記録が無いときは「まだ記録なし」（${c0 && c0.best}）`, c0 && c0.best === 'まだ記録なし' && c0.none === true, c0);
      const rows = [];
      for (const n of [1, 2, 3, 4, 5]) {
        await seed(page, { 'seizai.best': String(n) });
        await page.goto(BASE); await wait(page, 150);
        const c = await card();
        const want = n <= 4 ? L.STAGES[n - 1].name : null;
        rows.push({ n, best: c && c.best, ok: !!c && !c.none && (n <= 4 ? c.best === want : /クリア/.test(c.best)) });
      }
      check(`seizai.best 1〜4 は段の名前、5 は「クリア！」（${rows.map((r) => r.best).join('・')}）`, rows.every((r) => r.ok), rows);
      const bad = [];
      for (const raw of ['0', '6', 'abc', '2.5', '', '-1', 'NaN', '{}', '1e400']) {
        await seed(page, { 'seizai.best': raw });
        await page.goto(BASE); await wait(page, 150);
        const c = await card();
        if (!c || c.best !== 'まだ記録なし') bad.push(`${raw}: ${c && c.best}`);
      }
      check('壊れた値・0・範囲外（0・6・abc・2.5・空・-1・NaN・{}・1e400）はぜんぶ「まだ記録なし」でメニューが落ちない', bad.length === 0, bad);
      await page.setViewportSize({ width: 320, height: 568 });
      for (const raw of ['3', '5']) {
        await seed(page, { 'seizai.best': raw });
        await page.goto(BASE); await wait(page, 150);
        const c = await card();
        check(`SE 幅：記録「${c && c.best}」でカードがはみ出さない・省略されない`, c && c.right <= 320.5 && c.fit, c);
      }
      await page.click('a.game[href="games/seizai/"]'); await page.waitForURL('**/games/seizai/', { timeout: 5000 }).catch(() => {});
      check('メニューのカードを押すとゲームが開く', page.url() === SZ, page.url());
      await wait(page, 300);
      const ta = await page.evaluate(() => [...document.querySelectorAll('button, .zone, a#back')].filter((e) => !e.closest('[hidden]')).map((e) => ({ n: e.id || e.dataset.dept || e.dataset.buy || e.tagName, ta: getComputedStyle(e).touchAction })).filter((x) => !['manipulation', 'pan-y', 'none', 'pan-x pan-y'].includes(x.ta)));
      check('ボタン・.zone・a#back はダブルタップ拡大しない touch-action（manipulation・pan-y）', ta.length === 0, ta);
      await ctx.close();
    },
  },
  {
    id: 'WW16', tier: 'full', title: 'もくもくこうば オフライン：sw.js の APP_FILES に games/seizai/ の全ファイルがあり、接続を切っても開いて遊べ（advance でお金が増える）、部品は Service Worker から読まれ、メニューに戻れる',
    async run({ browser, check, srv, root }) {
      const info = swInfo(root);
      const dir = path.join(root, 'games/seizai');
      const actual = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : [];
      const want = [...new Set(['./games/seizai/', ...['index.html', 'logic.js', 'actors.js', 'render.js', 'input.js', 'main.js', ...actual].map((f) => `./games/seizai/${f}`)])];
      const missing = want.filter((f) => !info.files.includes(f));
      check(`sw.js の APP_FILES に games/seizai/ の ${want.length} 件がすべてある（足りない：${missing.join(' / ') || 'なし'}）`, missing.length === 0 && actual.length >= 6, missing);
      if (missing.length) return;
      srv.reset();
      const { ctx, page } = await newPage(browser, custom(390, 844, null, 'iPhone 13'), 'WW16', { sw: true, allowNetErrors: true });
      await page.goto(BASE);
      const ok = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]));
      if (!ok) throw new Error('Service Worker が 8 秒以内に有効にならない（事前キャッシュの install 失敗の可能性）');
      if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }); }
      await page.evaluate(() => localStorage.setItem('seizai.help', '1'));
      await sleep(200);
      await srv.ctl('offline=1');
      const resp = [];
      page.on('response', (r) => { if (/\/games\/seizai\/|\/common\/sfx\.js/.test(r.url())) resp.push({ f: r.url().split('/').slice(-2).join('/'), status: r.status(), sw: r.fromServiceWorker() }); });
      await page.goto(SZ, { timeout: 10000 }); await sleep(500);
      const libs = await page.evaluate(() => ({ L: typeof window.SeizaiLogic?.step, A: typeof window.SeizaiActors?.create, R: typeof window.SeizaiRender?.create, I: typeof window.SeizaiInput?.attach, Y: typeof window.YubiSfx?.create, G: typeof window.SeizaiGame?.getState }));
      check('オフラインで開き、SeizaiLogic・SeizaiActors・SeizaiRender・SeizaiInput・YubiSfx・SeizaiGame が使える', Object.values(libs).every((x) => x === 'function'), libs);
      const js = ['logic.js', 'actors.js', 'render.js', 'input.js', 'main.js', 'common/sfx.js'].map((f) => ({ f, hit: resp.find((r) => r.f.endsWith(f)) }));
      check('logic.js・actors.js・render.js・input.js・main.js・sfx.js を Service Worker から 200 で読んだ', js.every((x) => x.hit && x.hit.sw && x.hit.status === 200), { js, resp });
      if (libs.G === 'function') {
        const m0 = (await page.evaluate(() => window.SeizaiGame.getState())).money;
        const m1 = (await page.evaluate(() => window.SeizaiGame.advance(120))).money;
        check(`オフラインで遊べる（お金 ${m0} → ${m1}）、人が描かれる`, m1 > m0 && (await page.evaluate(() => window.SeizaiGame.getState())).actors > 0, { m0, m1 });
      }
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('オフラインのまま、メニューに戻れる', page.url() === BASE && await page.locator('a.game').count() >= 2, page.url());
      await srv.ctl('offline=0');
      await ctx.close();
    },
  },
  {
    id: 'WW17', tier: 'full', cdp: 'CDP のタッチ操作（ダブルタップ）', title: 'もくもくこうば タッチ：場所（.zone）・シートの買うボタン・#soundBtn を素早く2回タップしても拡大しない（2回目の touchend を止める）、場所の2回タップでシートは開いたまま',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const TE_SPY = () => { window.__te = []; window.addEventListener('touchend', (e) => window.__te.push({ p: e.defaultPrevented })); };
      const st = mkState(L, 1, { money: 100 });
      const { ctx, page } = await newPage(browser, custom(390, 664, null, 'iPhone 13 Safari'), 'WW17', { device: 'iPhone 13', initScript: TE_SPY, clock: true });
      await gotoW(page, { 'seizai.save': saveOf(L, st, Date.now()) });
      await closeCards(page);
      const t = await touch(ctx, page);
      const res = {};
      for (const sel of ['.zone[data-dept="cut"]', '#sheet [data-buy="level"]', '#soundBtn']) {
        await sleep(400); await wait(page, 400);            // 前のタップから 350ms 以上あける
        await page.evaluate(() => window.__te.splice(0));
        await t.doubleTap(sel); await wait(page, 100);
        const ev = await page.evaluate(() => window.__te.splice(0));
        res[sel] = { ev: ev.map((e) => e.p), scale: await page.evaluate(() => window.visualViewport.scale), sheet: (await gs(page)).sheet };
      }
      check(`素早い2回タップで 2回目の touchend を止め、拡大しない（${Object.entries(res).map(([k, v]) => `${k}:${v.ev.join(',')}`).join(' / ')}）`, Object.values(res).every((v) => v.ev.length === 2 && v.ev[1] === true && v.scale === 1), res);
      check('場所の2回タップでシートは開いたまま（きこり）', res['.zone[data-dept="cut"]'].sheet === 'cut', res);
      await ctx.close();
    },
  },
  {
    id: 'WW18', tier: 'full', title: 'もくもくこうば レビュー後の直し（§17.1）：遊び方の間だけ止まる（ほかのカードの間は動く）、rAF だけが 90 秒止まると閉じた間として足す（effective 45・二重に足さない）、押した部署がシートに隠れずに見え aria-expanded、#sheetInfo の data-jam、advance（fastForward）が logic の step と同じ',
    async run({ browser, check, root, errors }) {
      const L = logicOf(root);
      const st = mkState(L, 2);
      const e0 = errors.length;
      const { ctx, page } = await openW(browser, 'WW18', { v: SMOKE_V(), items: { 'seizai.save': saveOf(L, st, T0) }, opts: { clockTime: new Date(T0 + 1000) } });
      await closeCards(page);
      // 遊び方の間は止まる
      await page.click('#helpBtn'); await wait(page, 100);
      const h0 = await lg(page), f0 = (await gs(page)).frames;
      await wait(page, 3000);
      const h1 = await lg(page), g1 = await gs(page);
      check(`遊び方（overlay ${g1.overlay}）の 3 秒の間は進まない（t ${h0.t.toFixed(1)} → ${h1.t.toFixed(1)}・お金 ${h0.money} → ${h1.money}）が、描画は続く（frames ${f0} → ${g1.frames}）`, g1.overlay === 'help' && h1.t === h0.t && h1.money === h0.money && g1.frames > f0, { t: [h0.t, h1.t], f: [f0, g1.frames] });
      await pressCard(page, '#helpOk');
      const a0 = await lg(page);
      await wait(page, 2000);
      const a1 = await lg(page);
      check(`遊び方を閉じると また進む（t ${a0.t.toFixed(1)} → ${a1.t.toFixed(1)}）`, a1.t - a0.t >= 1.5 && ((await gs(page)).overlay === null), { t: [a0.t, a1.t], away: (await gs(page)).lastAway });
      // ほかのカード（おかえり）の間は動き続ける
      await page.evaluate(() => window.SeizaiGame.away(120)); await wait(page, 50);
      const c0 = await lg(page);
      await wait(page, 2000);
      const c1 = await lg(page), cg = await gs(page);
      check(`おかえりカード（overlay ${cg.overlay}）の間は動き続ける（t ${c0.t.toFixed(1)} → ${c1.t.toFixed(1)}）`, cg.overlay === 'away' && c1.t - c0.t >= 1.5, { t: [c0.t, c1.t] });
      await closeCards(page);
      // rAF だけが止まる（visibilitychange なし）：時計を止めて 90 秒先へ動かし、動かし直す
      const p0 = (await page.evaluate(() => Date.now())) + 300;
      await page.clock.pauseAt(new Date(p0));
      const r0 = await lg(page);
      await page.clock.setSystemTime(new Date(p0 + 90 * 1000));
      await page.clock.resume();
      await wait(page, 200);
      const r1 = await lg(page), rs = await gs(page);
      check(`rAF が 90 秒止まって動き出すと、閉じた間と同じ道で足す（overlay ${rs.overlay}・seconds ${rs.lastAway && rs.lastAway.seconds}・effective ${rs.lastAway && rs.lastAway.effective}・t +${(r1.t - r0.t).toFixed(1)}）`, rs.overlay === 'away' && rs.lastAway && rs.lastAway.seconds >= 90 && rs.lastAway.seconds <= 91 && rs.lastAway.effective === 45 && r1.t - r0.t >= 45 && r1.t - r0.t < 45 + 3, { a: rs.lastAway, t: [r0.t, r1.t] });
      await wait(page, 1000);
      const r2 = await lg(page);
      check(`そのあと二重に足さない（1 秒で t +${(r2.t - r1.t).toFixed(1)}）`, r2.t - r1.t < 1.5 && JSON.stringify((await gs(page)).lastAway) === JSON.stringify(rs.lastAway), { t: [r1.t, r2.t] });
      await closeCards(page);
      // 押した部署がシートに隠れない（おみせ＝いちばん下。#scene を上までスクロールしてから押す）
      const vis = [];
      for (const d of ['shop', 'cut']) {
        await page.evaluate(() => { const sc = document.querySelector('#scene'); sc.scrollTop = 0; document.querySelector('#sheetClose') && window.SeizaiGame.getState().sheet && document.querySelector('#sheetClose').click(); });
        await wait(page, 50);
        await page.evaluate((d) => { const sc = document.querySelector('#scene'); const z = document.querySelector(`.zone[data-dept="${d}"]`); if (d === 'cut') sc.scrollTop = sc.scrollHeight; z.click(); }, d);
        await wait(page, 100);
        vis.push(await page.evaluate((d) => {
          const sc = document.querySelector('#scene').getBoundingClientRect(), z = document.querySelector(`.zone[data-dept="${d}"]`), zr = z.getBoundingClientRect(), sh = document.querySelector('#sheet').getBoundingClientRect();
          const h = Math.min(zr.bottom, sc.bottom) - Math.max(zr.top, sc.top);
          return { d, sheet: window.SeizaiGame.getState().sheet, expanded: z.getAttribute('aria-expanded'), seen: h >= Math.min(44, zr.height) - 1, underSheet: zr.top >= sh.top - 1 && sh.height > 0, others: [...document.querySelectorAll('.zone[aria-expanded="true"]')].length };
        }, d));
      }
      check(`シートを開くと押した部署が #scene の見える所にあり（シートの下に隠れない）、aria-expanded="true" はその1つだけ`, vis.every((v) => v.sheet === v.d && v.expanded === 'true' && v.seen && !v.underSheet && v.others === 1), vis);
      await page.click('#sheetClose'); await wait(page, 50);
      check('シートを閉じると aria-expanded が外れる', (await page.evaluate(() => document.querySelectorAll('.zone[aria-expanded]').length)) === 0, null);
      // #sheetInfo の data-jam
      // 押すと応援でつまりが動くので、一度押して応援が切れ、使えない間（15 秒）にもう一度押す
      let ji = null, jam = null;
      for (let i = 0; i < 4 && !(ji && ji.jam === '1'); i++) {
        jam = (await gs(page)).bottleneck;
        await page.evaluate((d) => document.querySelector(`.zone[data-dept="${d}"]`).click(), jam); await wait(page, 100);
        ji = await page.evaluate(() => { const i = document.querySelector('#sheetInfo'), g = window.SeizaiGame.getState(); return i && { jam: i.dataset.jam, color: getComputedStyle(i).color, sheet: g.sheet, bottleneck: g.bottleneck }; });
        if (ji.jam !== (ji.sheet === ji.bottleneck ? '1' : '0')) break;
        if (ji.jam !== '1') { await page.click('#sheetClose'); await wait(page, 6000); }
      }
      check(`つまっている部署（${jam}）のシートで #sheetInfo[data-jam="1"] になり、CSS の色が効く（${ji && ji.color}）`, ji && ji.jam === '1' && ji.sheet === ji.bottleneck && ji.color === 'rgb(255, 216, 77)', ji);
      await page.click('#sheetClose'); await wait(page, 50);
      // advance（logic の fastForward）は step を繰り返したのと同じ
      const [b0, b1] = await page.evaluate(() => { const a = window.SeizaiGame.logic(); window.SeizaiGame.advance(120); return [a, window.SeizaiGame.logic()]; });
      let m = b0; for (let i = 0; i < 1200; i++) m = L.step(m, 0.1).state;
      check(`advance(120) は logic の step(0.1) を 1200 回まわしたのと同じ（お金 ${b1.money}・t ${b1.t.toFixed(1)}）`, b1.money === m.money && Math.abs(b1.t - m.t) < 1e-6 && JSON.stringify(b1.buf) === JSON.stringify(m.buf), { got: [b1.money, b1.t], want: [m.money, m.t] });
      check('ページエラー・コンソールエラーが無い', errors.length === e0, errors.slice(e0));
      await ctx.close();
    },
  },
  {
    id: 'WW19', tier: 'full', title: 'もくもくこうば レビュー後の直し B（§17.3）：注文カードは最初の1回だけ自動で開く（2回目からは札と #hint・シートを開いている間は閉じてから）、注文のカードが開いているときの おかえり が先（待ちに注文が戻る・遊び方は今のまま）、おかえり／エンディングの文が見出しと重ならない、注文カード・札の文、森が止まったときの案内、買える印、節目カードの絵、広げるボタンの2段組み、みなとで景色へスクロール',
    async run({ browser, check, root, errors }) {
      const L = logicOf(root);
      const e0 = errors.length;
      const OPEN = (st, o = {}) => openW(browser, 'WW19', { v: SMOKE_V(), debug: true, items: { 'seizai.save': saveOf(L, st, T0) }, opts: { clockTime: new Date(T0 + 1000), ...o } });
      // --- 注文：最初の 1 回だけ自動で開く ---
      {
        const { ctx, page } = await OPEN(mkState(L, 2));
        await dbg(page, 'neworder'); await wait(page, 100);
        const g1 = await gs(page);
        const ot = await txt(page, '#orderText'), on = await txt(page, '#orderNote'), ow = await txt(page, '#orderWho');
        check(`最初の注文はカードが自動で開く（overlay ${g1.overlay}・orderSeq 1）`, g1.overlay === 'order' && (await lg(page)).orderSeq === 1, g1.overlay);
        check(`注文の文「${ot}」は「かくざい ○ぽん とどけると、おれい ○」の形で、おれい は formatYen、注記「${on}」に品の名前・「きげんは ないよ」、相手「${ow}」`, g1.order && ot === `かくざい ${g1.order.need.toLocaleString('ja-JP')}ぽん とどけると、おれい ${await yenIn(page, g1.order.reward)}` && /かくざいは/.test(on) && /きげんは ないよ/.test(on) && /から$/.test(ow) && L.ORDER_BOSSES[1].some((w) => ow.includes(w)), { ot, on, ow });
        await pressCard(page, '#orderLater');
        await setL(page, 'l.order = null;');
        await dbg(page, 'neworder'); await wait(page, 100);
        const g2 = await gs(page), tag = await txt(page, '#orderTag');
        check(`2回目の注文はカードを開かず（overlay ${g2.overlay}）、#orderTag「${tag}」と #hint「${g2.hint}」で知らせる`, g2.overlay === null && g2.order && !g2.order.accepted && (await shown(page, '#orderTag')) && /ちゅうもんが きたよ/.test(tag) && /ちゅうもんが きたよ/.test(g2.hint), { g2: g2.overlay, tag, hint: g2.hint });
        await page.click('#orderTag'); await wait(page, 60);
        check('#orderTag を押せば開く', (await gs(page)).overlay === 'order', (await gs(page)).overlay);
        await ctx.close();
      }
      // --- 注文：シートを開いている間は開かない（閉じたら開く） ---
      {
        const { ctx, page } = await OPEN(mkState(L, 2));
        await page.evaluate(() => document.querySelector('.zone[data-dept="cut"]').click()); await wait(page, 100);
        await dbg(page, 'neworder'); await wait(page, 100);
        const a = await gs(page);
        check(`シートを開いている間は最初の注文でもカードを開かない（overlay ${a.overlay}・sheet ${a.sheet}）、札は出る`, a.overlay === null && a.sheet === 'cut' && (await shown(page, '#orderTag')), a);
        await page.click('#sheetClose'); await wait(page, 100);
        check('シートを閉じるとカードが開く', (await gs(page)).overlay === 'order', (await gs(page)).overlay);
        await ctx.close();
      }
      // --- おかえり が先 ---
      {
        const { ctx, page } = await OPEN(mkState(L, 2));
        await dbg(page, 'neworder'); await wait(page, 100);
        await page.evaluate(() => window.SeizaiGame.away(120)); await wait(page, 100);
        const a = await gs(page);
        check(`注文のカードが開いているときに おかえり が足されたら、おかえり が先（overlay ${a.overlay}・待ち ${a.queue}）`, a.overlay === 'away' && a.queue.includes('order') && !(await shown(page, '#orderCard')) && (await shown(page, '#awayCard')), a);
        await pressCard(page, '#awayOk');
        const b = await gs(page);
        check(`おかえり を閉じると注文が出る（overlay ${b.overlay}・注文は受けていない）`, b.overlay === 'order' && b.order && !b.order.accepted, b);
        await pressCard(page, '#orderLater');
        // 遊び方の間は今のまま待たせる
        await page.click('#helpBtn');await wait(page, 100);
        await page.evaluate(() => window.SeizaiGame.away(120)); await wait(page, 100);
        const c = await gs(page);
        check(`遊び方を開いている間は おかえり を割り込ませず待たせる（overlay ${c.overlay}・待ち ${c.queue}）`, c.overlay === 'help' && c.queue.includes('away'), c);
        await closeCards(page);
        // 文の重なり（SZ-02）
        await page.evaluate(() => window.SeizaiGame.away(300)); await wait(page, 100);
        const at = await txt(page, '#awayText'), card = await txt(page, '#awayCard'), earned = (await gs(page)).lastAway.earned;
        check(`おかえり の本文「${at}」は「るすの あいだに ${await yenIn(page, earned)} かせいだよ」だけ（「おかえり」はカード全体で 1 回）`, at === `るすの あいだに ${await yenIn(page, earned)} かせいだよ` && (card.match(/おかえり/g) || []).length === 1, { at, card });
        await closeCards(page);
        await ctx.close();
      }
      // --- エンディングの文 ---
      {
        const { ctx, page } = await OPEN(mkState(L, 4));
        await dbg(page, 'ships', { n: 0, got: 29999 });
        await adv(page, 60); await waitOverlay(page, 'end', 1000);
        const card = await txt(page, '#endCard'), et = await txt(page, '#endText'), es = await txt(page, '#endStats');
        check(`エンディングの本文「${et}」と数「${es}」が見出し「おおきな ふねが でたよ！」と重ならない（「でたよ」は 1 回）`, (await gs(page)).overlay === 'end' && !/ふねが でたよ/.test(et + es) && /ありがとう/.test(et) && /あそんだ じかん \d+じかん\d+ふん/.test(es) && /いた [\d,]+まい/.test(es) && (card.match(/でたよ/g) || []).length === 1, { et, es, card });
        await closeCards(page);
        await ctx.close();
      }
      // --- 札：とくべつ・受けている間のお金の札 ---
      {
        const { ctx, page } = await OPEN(mkState(L, 2));
        await setL(page, 'l.order = { id: 1, who: "だいくの おじさん", need: 50, got: 10, reward: 99999, accepted: true, big: true }; l.orderSeq = 3;');
        const tagBig = await txt(page, '#orderTag');
        await setL(page, 'l.order = { id: 2, who: "だいくの おじさん", need: 50, got: 10, reward: 99999, accepted: true, big: false }; l.orderSeq = 4;');
        const tagNor = await txt(page, '#orderTag');
        check(`受けた札：とくべつは「${tagBig}」（文字で分かる）、ふつうは「${tagNor}」、どちらも「おかねは おれいで まとめて」の札つき`, /とくべつな ちゅうもん：かくざい 10\/50/.test(tagBig) && /ちゅうもん：かくざい 10\/50/.test(tagNor) && !/とくべつ/.test(tagNor) && /おかねは おれいで まとめて/.test(tagBig) && /おかねは おれいで まとめて/.test(tagNor), { tagBig, tagNor });
        await setL(page, 'l.order = { id: 3, who: "だいくの おじさん", need: 50, got: 0, reward: 99999, accepted: false, big: true }; l.orderSeq = 5;');
        const tagNew = await txt(page, '#orderTag');
        check(`まだ受けていない札も とくべつは文字で分かる（「${tagNew}」）`, /とくべつな ちゅうもんが きたよ/.test(tagNew), tagNew);
        await ctx.close();
      }
      // --- 最初の一手：最初の買い物まで なえぎに「おして！」の札（canvas の白い札の画素で確かめる）。買うと消える ---
      for (const calm of [false, true]) {
        const { ctx, page } = await openW(browser, 'WW19', { v: SMOKE_V(), debug: true, opts: { reducedMotion: calm ? 'reduce' : 'no-preference' } });
        const whites = () => page.evaluate(() => {
          const c = document.querySelector('#sceneCanvas'), z = document.querySelector('.zone[data-dept="plant"]');
          const cr = c.getBoundingClientRect(), zr = z.getBoundingClientRect(), k = c.width / cr.width;
          const x0 = Math.max(0, Math.floor((zr.left - cr.left) * k)), y0 = Math.max(0, Math.floor((zr.top - cr.top) * k)), w = Math.floor(zr.width * k), h = Math.floor(zr.height * k);
          const d = c.getContext('2d').getImageData(x0, y0, Math.min(w, c.width - x0), Math.min(h, c.height - y0)).data;
          let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] >= 254 && d[i + 1] >= 254 && d[i + 2] >= 254) n++;
          return n;
        });
        await wait(page, 300);
        const w0 = await whites();
        await dbg(page, 'addmoney', { yen: 50 });
        await page.evaluate(() => window.SeizaiGame.buy('plant', 'staff')); await wait(page, 300);
        const w1 = await whites();
        check(`${calm ? '動きを減らす設定' : '通常'}：最初の買い物まで なえぎの場所に白い「おして！」の札（白い画素 ${w0}）、なえぎを買うと消える（${w1}）`, w0 > w1 + 150, { w0, w1 });
        await ctx.close();
      }
      // --- 森が止まったときの案内・買える印 ---
      {
        const st = mkState(L, 1, { forest: { trees: 0, saplings: 0 }, money: 50, depts: { plant: { staff: 0, level: 1 } } });
        const { ctx, page } = await OPEN(st);
        await wait(page, 300);
        const hint = (await gs(page)).hint;
        check(`なえぎが 0 人で森の木が尽きたら #hint「${hint}」`, /きこりが きを まっているよ。なえぎを おして ふやそう/.test(hint), hint);
        await page.evaluate(() => document.querySelector('.zone[data-dept="cut"]').click()); await wait(page, 100);
        const info = await txt(page, '#sheetInfo');
        check(`シート #sheetInfo「${info}」`, /もりの きが たりないよ。なえぎを ふやすと きが そだつよ/.test(info), info);
        await page.click('#sheetClose'); await wait(page, 50);
        const lab = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.zone[data-dept]')].map((z) => [z.dataset.dept, z.getAttribute('aria-label')])));
        await setL(page, 'l.money = 0;'); await wait(page, 100);
        const lab0 = await page.evaluate(() => document.querySelector('.zone[data-dept="cut"]').getAttribute('aria-label'));
        check(`お金 50 で買えるもののある部署は読み上げに「かえるものが あるよ」（きこり：${lab.cut}）、お金 0 ではつかない（${lab0}）`, /かえるものが あるよ/.test(lab.cut) && /かえるものが あるよ/.test(lab.plant) && !/かえるものが あるよ/.test(lab0), { lab, lab0 });
        await ctx.close();
      }
      // --- 広げるボタンの2段組み（SE 縦） ---
      {
        const st = mkState(L, 1, { goal: { done: 100 }, money: 250000 });
        const { ctx, page } = await OPEN(st);
        const eb = await page.evaluate(() => {
          const b = document.querySelector('#expandBtn'), r = b.getBoundingClientRect(), l = b.querySelector('[data-part=label]'), c = b.querySelector('[data-part=cost]');
          return { hidden: b.hidden, h: r.height, in: r.left >= 0 && r.right <= innerWidth, label: l && l.textContent, cost: c && c.textContent, ly: l && l.getBoundingClientRect().bottom <= c.getBoundingClientRect().top + 1 };
        });
        check(`「ひろげる」ボタンはラベル「${eb.label}」と値段「${eb.cost}」の2段（高さ ${Math.round(eb.h)}・画面内）`, !eb.hidden && eb.h >= 43.5 && eb.in && eb.ly && eb.cost === L.formatYen(L.STAGES[0].cost) && eb.label === 'こうばに ひろげる', eb);
        // 節目カードの絵
        await page.click('#expandBtn'); await waitOverlay(page, 'stage', 2500);
        const sc = await page.evaluate(() => [...document.querySelectorAll('#stageList li')].map((li) => ({ svg: !!li.querySelector('svg.gic'), text: li.textContent.trim() })));
        check(`節目カードの3つに小さな絵（svg）が付く（${sc.map((x) => x.text).join(' / ')}）`, sc.length === 3 && sc.every((x) => x.svg) && sc.some((x) => /マネージャー（はやく する・ねだんを あげる）/.test(x.text)), sc);
        await ctx.close();
      }
      // --- マネージャーのシート ---
      {
        const { ctx, page } = await OPEN(mkState(L, 2, { depts: { cut: { staff: 2, level: 10, mgr: 'fast' } } }));
        await page.evaluate(() => document.querySelector('.zone[data-dept="cut"]').click()); await wait(page, 100);
        const mh = await page.evaluate(() => { const e = document.querySelector('#mgrHelp'); return e && { hidden: e.hidden, text: e.textContent }; });
        check(`マネージャーを雇った部署のシートに 1 行「${mh && mh.text}」`, mh && !mh.hidden && /おそい ばしょは『はやい』、ほかは『もうかる』が おとく（いつでも むりょうで きりかえ）/.test(mh.text), mh);
        await ctx.close();
      }
      // --- みなとで景色へスクロール（動きを減らす設定で一瞬。通常はゆっくり） ---
      for (const calm of [true, false]) {
        const { ctx, page } = await OPEN(mkState(L, 3, { goal: { done: L.STAGES[2].goal }, money: 9e12 }), { reducedMotion: calm ? 'reduce' : 'no-preference' });
        await page.evaluate(() => { document.querySelector('#scene').scrollTop = 0; });
        await page.click('#expandBtn'); await waitOverlay(page, 'stage', 2500);
        const t0 = await page.evaluate(() => document.querySelector('#scene').scrollTop);
        await pressCard(page, '#stageOk');
        if (calm) await wait(page, 100); else { await sleep(1800); await wait(page, 100); }
        const t1 = await page.evaluate(() => { const s = document.querySelector('#scene'); return { top: s.scrollTop, max: s.scrollHeight - s.clientHeight }; });
        check(`${calm ? '動きを減らす設定' : '通常'}：みなとの節目カードを閉じると #scene が船のほうへスクロール（${Math.round(t0)} → ${Math.round(t1.top)}／最大 ${Math.round(t1.max)}）`, (await gs(page)).stage === 4 && t1.top > t0 + 100, { t0, t1 });
        await ctx.close();
      }
      check('ページエラー・コンソールエラーが無い', errors.length === e0, errors.slice(e0));
    },
  },
  {
    id: 'WW20', tier: 'full', title: 'もくもくこうば 待つ理由（§18・SZ-03）：きこりが遅くて切り株が無い間、なえぎのシート #sheetInfo（data-wait=1）と場所の読み上げに「きりかぶが まだ ないよ。きこりを ふやすと うえられるよ」、はこぶ・かわむき にも待つ理由と「きこりを ふやそう」、きこり は「ここが おそいよ」で待つ文なし。切り株があれば待つ文は出ない。なえぎの人は切られた切り株まで歩いて行ってから植える（着くまで切り株のまま）',
    async run({ browser, check, root, errors }) {
      const L = logicOf(root);
      const e0 = errors.length;
      const OPEN = (st) => openW(browser, 'WW20', { v: SMOKE_V(), items: { 'seizai.save': saveOf(L, st, T0) }, opts: { clockTime: new Date(T0 + 1000) } });
      // 録画と同じ局面：段1、きこり 1にん Lv2、なえぎ 1にん Lv2、はこぶ 2にん、森は木と若木でいっぱい
      const base = { money: 120, forest: { trees: 8, saplings: 4 }, buf: { yard: 0, logs: 0, goods: 0 }, depts: { cut: { staff: 1, level: 2 }, plant: { staff: 1, level: 2 }, carry: { staff: 2, level: 1 }, peel: { lines: 1, level: 1 }, shop: { staff: 1, level: 1 } } };
      {
        // §20 E2（2026-10-22）から「まち」は 最近 何も作っていない部署だけ。録画の局面（森に木がある）で 20 秒進めると、なえぎ・はこぶ・かわむき は
        // 来た分を すぐ片づけて働いている（まち は出ない。WW24 が確かめる）。ここは森の木が まだ育っていない（若木だけ）開いた直後＝本当に前の品が来ないときで確かめる
        const { ctx, page } = await OPEN(mkState(L, 1, { ...base, forest: { trees: 0, saplings: 12 } }));
        await adv(page, 1); await wait(page, 100);
        const g = await gs(page);
        const open = async (d) => { await page.evaluate((x) => document.querySelector(`.zone[data-dept="${x}"]`).click(), d); await wait(page, 120); return page.evaluate(() => { const e = document.querySelector('#sheetInfo'); return { t: e.textContent.trim(), wait: e.dataset.wait, jam: e.dataset.jam }; }); };
        const pl = await open('plant');
        const za = await page.evaluate(() => document.querySelector('.zone[data-dept="plant"]').getAttribute('aria-label'));
        check(`つまりは きこり（${g.bottleneck}）。なえぎのシート「${pl.t}」（data-wait ${pl.wait}）と読み上げ「${za}」に、待つ理由と「きこりを ふやすと うえられるよ」`, g.bottleneck === 'cut' && pl.wait === '1' && /きりかぶが まだ ないよ。きこりを ふやすと うえられるよ/.test(pl.t) && /きりかぶが まだ ないよ。きこりを ふやすと うえられるよ/.test(za), { g: g.bottleneck, pl, za });
        const ca = await open('carry'), pe = await open('peel');
        check(`横展開：はこぶ「${ca.t}」・かわむき「${pe.t}」にも待つ理由と「きこりを ふやそう」`, ca.wait === '1' && /まるたが まだ/.test(ca.t) && /きこりを ふやそう/.test(ca.t) && pe.wait === '1' && /まるたが まだ こないよ/.test(pe.t) && /きこりを ふやそう/.test(pe.t), { ca, pe });
        await open('cut');   // 押すと応援で速くなるので、応援が切れるまで進めてから見る
        await adv(page, 8); await wait(page, 150);
        const cu = await page.evaluate(() => { const e = document.querySelector('#sheetInfo'); return { t: e.textContent.trim(), wait: e.dataset.wait, jam: e.dataset.jam }; });
        check(`きこり「${cu.t}」は「ここが おそいよ」で、待つ文は出ない（食い違わない）`, cu.jam === '1' && cu.wait === '0' && /ここが おそいよ/.test(cu.t) && !/まだ/.test(cu.t), cu);
        await ctx.close();
      }
      {
        // 切り株がたくさんある（なえぎが遅い側）：待つ文は出ない
        const { ctx, page } = await OPEN(mkState(L, 1, { ...base, forest: { trees: 2, saplings: 0 } }));
        await adv(page, 2); await wait(page, 100);
        await page.evaluate(() => document.querySelector('.zone[data-dept="plant"]').click()); await wait(page, 120);
        const pl = await page.evaluate(() => { const e = document.querySelector('#sheetInfo'); return { t: e.textContent.trim(), wait: e.dataset.wait }; });
        check(`切り株があれば なえぎのシート「${pl.t}」に待つ文は出ない`, pl.wait === '0' && !/きりかぶが まだ/.test(pl.t), pl);
        // 人の動き（actors.js を直接）：切られた切り株へ なえぎの人が歩いて行き、着いてから植わる
        const r = await page.evaluate(() => {
          const A = window.SeizaiActors, Lg = window.SeizaiLogic;
          const s = Lg.newGame(1);
          s.depts.plant.staff = 1; s.forest.trees = 12; s.forest.saplings = 0;
          const act = A.create(3);
          for (let i = 0; i < 30; i++) act.sync(s, [], 0.1);
          s.forest.trees = 11; s.forest.saplings = 1;   // 1 本切られて、logic では すぐ苗木に
          act.sync(s, [], 0.1);
          const sl = act.slots();
          const idx = sl.findIndex((x) => x.pend);
          const stumpAtCut = idx >= 0 && sl[idx].kind === 'stump';
          const p = act.all().find((a) => a.role === 'planter');
          const d0 = Math.abs(p.x - sl[idx].x);
          let planted = -1;
          for (let i = 0; i < 200 && planted < 0; i++) { act.sync(s, [], 0.1); if (sl[idx].kind === 'sapling') planted = i; }
          const p1 = act.all().find((a) => a.role === 'planter');
          return { stumpAtCut, d0, planted, d1: Math.abs(p1.x - sl[idx].x), why: A.waitOf(s).plant };
        });
        check(`切られた所は切り株のまま（${r.stumpAtCut}・なえぎの人まで ${Math.round(r.d0)}）、なえぎの人が歩いて着いてから植わる（${r.planted} コマ目・そのときの距離 ${Math.round(r.d1)}）`, r.stumpAtCut && r.planted > 0 && r.d1 <= 14 && (r.d0 < 14 || r.planted >= 3), r);
        await ctx.close();
      }
      check('ページエラー・コンソールエラーが無い', errors.length === e0, errors.slice(e0));
    },
  },
  {
    id: 'WW21', tier: 'full', title: 'もくもくこうば 新しい工程（§19.1・§19.4）：こうじょう で かんそう、みなと で かんな の場所が見えて押せ（44px 以上・シートの値段が costOf）、使えない段では隠れる。つまりの札（data-jam）、節目カードの「ふえたもの」、みなと の #goalText が goalOf（つるつるいた・SE 縦で崩れない）、v25 の形の保存（dry・plane・dried が無い）を入れても落ちず、かんそう が 1 台で動き、売れる',
    async run({ browser, check, root, errors }) {
      const L = logicOf(root);
      const e0 = errors.length;
      const { ctx, page } = await openW(browser, 'WW21', { v: SMOKE_V(), debug: true });
      for (const [st, want, hide] of [[3, ['dry'], ['plane']], [4, ['dry', 'plane'], []]]) {
        await goStage(page, st);
        await setL(page, 'l.money = 1e9;');
        const z = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.zone[data-dept]')].map((b) => { const r = b.getBoundingClientRect(); return [b.dataset.dept, { hidden: b.hidden, w: Math.round(r.width), h: Math.round(r.height) }]; })));
        check(`段 ${st}：${want.join('・')} の場所が見えて 44px 以上、${hide.join('・') || 'なし'} は隠れる`, want.every((d) => z[d] && !z[d].hidden && z[d].w >= 44 && z[d].h >= 44) && hide.every((d) => z[d] && z[d].hidden), z);
        for (const d of want) {
          await page.evaluate((d) => document.querySelector(`.zone[data-dept="${d}"]`).click(), d); await wait(page, 150);
          const l = await lg(page);
          const pr = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#sheet [data-buy]')].filter((b) => !b.hidden).map((b) => [b.dataset.buy, b.querySelector('[data-part=price]').textContent.trim()])));
          const okP = ['line', 'level'].every((w) => pr[w] === L.formatYen(L.costOf(l, d, w)));
          const title = await txt(page, '#sheetTitle');
          check(`段 ${st}：${d} を押すとシート（${title}）、値段 ${JSON.stringify(pr)} が formatYen(costOf)`, (await gs(page)).sheet === d && okP && !pr.staff, { pr, title });
          await page.click('#sheetClose'); await wait(page, 60);
        }
      }
      // みなと の #goalText（SE 縦で崩れない）
      const g4 = L.goalOf(await lg(page)), gt = await txt(page, '#goalText'), fg = await fits(page, '#goalText');
      check(`みなと の #goalText「${gt}」が goalOf の文（つるつるいた）で、はみ出さない`, gt === g4.text && /つるつるいた/.test(gt) && fg.ok, { gt, g4, fg });
      // つまりの札：かんそう だけを遅くする
      await setL(page, 'for (const [k, d] of Object.entries(l.depts)) { d.level = 50; if ("lines" in d && d.lines > 0) d.lines = SeizaiLogic.CAPS[3][k]; else if ("staff" in d) d.staff = SeizaiLogic.CAPS[3][k]; } l.depts.dry.lines = 1; l.depts.dry.level = 1;');
      await wait(page, 400);
      const bn = (await gs(page)).bottleneck, jam = await page.evaluate(() => document.querySelector('.zone[data-dept="dry"]').dataset.jam);
      check(`かんそう だけ遅いと つまり は ${bn}、場所に data-jam="${jam}"`, bn === 'dry' && jam === '1', { bn, jam });
      await ctx.close();
      // 節目カードの「ふえたもの」
      for (const [from, re] of [[2, /かんそう[\s\S]*きを かわかすよ/], [3, /かんな[\s\S]*つるつるに するよ/]]) {
        const st = mkState(L, from, { goal: { done: L.STAGES[from - 1].goal }, money: L.STAGES[from - 1].cost + 10 });
        const o = await openW(browser, 'WW21', { v: SMOKE_V(), items: { 'seizai.save': saveOf(L, st, T0) }, opts: { clockTime: new Date(T0 + 1000), reducedMotion: 'reduce' } });
        await o.page.click('#expandBtn'); await waitOverlay(o.page, 'stage', 2500);
        const list = await txt(o.page, '#stageList');
        check(`段 ${from + 1} の節目カードの「ふえたもの」：${list}`, re.test(list) && (await o.page.evaluate(() => document.querySelectorAll('#stageList li').length)) === 3, list);
        await o.ctx.close();
      }
      // v25 の形の保存（dry・plane・dried が無い）：段 3 と 段 4
      for (const stage of [3, 4]) {
        const st = mkState(L, stage, { goal: { done: 0 } });
        const raw = JSON.parse(saveOf(L, st, T0));
        delete raw.depts.dry; delete raw.depts.plane; delete raw.buf.dried; if (raw.totals) { delete raw.totals.dried; delete raw.totals.smooth; }
        const o = await openW(browser, 'WW21', { v: SMOKE_V(), items: { 'seizai.save': JSON.stringify(raw) }, opts: { clockTime: new Date(T0 + 1000) } });
        await closeCards(o.page);
        const a = await lg(o.page);
        await adv(o.page, 60);
        const b = await lg(o.page);
        const shown = await o.page.evaluate(() => !document.querySelector('.zone[data-dept="dry"]').hidden);
        check(`v25 の形の保存（段 ${stage}）：落ちずに開き、かんそう ${a.depts.dry && a.depts.dry.lines} 台・場所が見え、60 秒で かんそう が動き（done ${a.done.dry || 0} → ${b.done.dry}）、売れる（お金 ${a.money} → ${b.money}）`, a.stage === stage && a.depts.dry && a.depts.dry.lines >= 1 && shown && b.done.dry > (a.done.dry || 0) && b.money > a.money, { a: a.depts.dry, done: [a.done, b.done] });
        await o.ctx.close();
      }
      check('ページエラー・コンソールエラーが無い', errors.length === e0, errors.slice(e0));
    },
  },
  {
    id: 'WW22', tier: 'full', title: 'もくもくこうば 道具（§19.2）：Lv4→5 で #hint「のこぎりに なった！」・音 tool・getState().lastTool、シートの「どうぐを よくする」に「つぎで のこぎりに なる！」→「つぎ：チェーンソー（Lv15）」、Lv5→6 は tool を鳴らさない、Lv30 で次の道具は空（隠れる）、全部署の道具の名前（場所の読み上げ）が logic の TOOLS と同じ、Lv 1・5・15・30 で台の上の絵が変わる',
    async run({ browser, check, root, errors }) {
      const L = logicOf(root);
      const e0 = errors.length;
      const st = mkState(L, 1, { money: 1e7, depts: { cut: { staff: 2, level: 4 } } });
      const { ctx, page } = await openW(browser, 'WW22', { v: SMOKE_V(), items: { 'seizai.save': saveOf(L, st, T0) }, opts: { clockTime: new Date(T0 + 1000), initScript: SFX_SPY } });
      const nx = () => page.evaluate(() => { const e = document.querySelector('#sheet [data-buy="level"] [data-part="next"]'); return e ? { t: e.textContent.trim(), w: e.getBoundingClientRect().height } : null; });
      await page.click('.zone[data-dept="cut"]'); await wait(page, 120);
      const lab0 = await txt(page, '#sheet [data-buy="level"] [data-part="label"]'), n0 = await nx();
      check(`シートのボタン「${lab0}」（どうぐを よくする）に「${n0 && n0.t}」`, /^どうぐを よくする Lv4→5$/.test(lab0) && n0 && n0.t === 'つぎで のこぎりに なる！', { lab0, n0 });
      const p0 = (await plays(page)).length;
      await page.click('#sheet [data-buy="level"]'); await wait(page, 150);
      const s1 = await gs(page), ps1 = (await plays(page)).slice(p0).map((x) => x.n), n1 = await nx();
      const za = await page.evaluate(() => document.querySelector('.zone[data-dept="cut"]').getAttribute('aria-label'));
      check(`Lv4→5 で #hint「${s1.hint}」・音 ${ps1.join(',')}・lastTool ${JSON.stringify(s1.lastTool)}`, s1.hint === 'のこぎりに なった！' && ps1.includes('tool') && s1.lastTool && s1.lastTool.dept === 'cut' && s1.lastTool.tier === 1 && s1.lastTool.name === 'のこぎり', { s1: s1.lastTool, ps1 });
      check(`次の道具は「${n1 && n1.t}」、場所の読み上げ「${za}」に のこぎり`, n1 && n1.t === 'つぎ：チェーンソー（Lv15）' && /きこり：2にん・のこぎり。/.test(za), { n1, za });
      const p1 = (await plays(page)).length;
      await page.click('#sheet [data-buy="level"]'); await wait(page, 150);
      const ps2 = (await plays(page)).slice(p1).map((x) => x.n);
      check(`Lv5→6 は tool を鳴らさず buy（${ps2.join(',')}）`, ps2.includes('buy') && !ps2.includes('tool'), ps2);
      await setL(page, 'l.depts.cut.level = 30;'); await wait(page, 100);
      const n3 = await nx();
      check(`Lv30（いちばん上の段）で次の道具は空で隠れる（「${n3 && n3.t}」・高さ ${n3 && n3.w}）`, n3 && n3.t === '' && n3.w === 0, n3);
      const has = await page.evaluate(() => window.YubiSfx.create('seizai', { ignoreSetting: true }).names.includes('tool'));
      check('効果音 tool が "seizai" の音の表にある', has, has);
      await ctx.close();
      // 全部署の道具の名前（場所の読み上げ）が logic の TOOLS と同じ
      const o = await openW(browser, 'WW22', { v: SMOKE_V(), debug: true });
      await goStage(o.page, 4);
      const bad = [];
      for (let i = 0; i < L.TOOL_LV.length; i++) {
        const lv = L.TOOL_LV[i];
        await setL(o.page, `for (const d of Object.values(l.depts)) d.level = ${lv};`); await wait(o.page, 50);
        const labs = await o.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.zone[data-dept]')].filter((b) => !b.hidden && b.dataset.dept !== 'goods').map((b) => [b.dataset.dept, b.getAttribute('aria-label')])));
        for (const [d, lab] of Object.entries(labs)) if (!lab.includes('・' + L.TOOLS[d][i] + '。')) bad.push(`${d} Lv${lv}: ${lab}`);
        if (Object.keys(labs).length !== 9) bad.push('場所の数 ' + Object.keys(labs).length);
      }
      check(`みなと の 9 部署 × Lv 1・5・15・30 の読み上げの道具の名前が TOOLS と同じ（違う所 ${bad.length}）`, bad.length === 0, bad.slice(0, 6));
      await o.ctx.close();
      // 台の上の絵が段ごとに変わる（動きを減らす設定で、かわむき・いた・かんな の 1 台目の機械の画素）
      const c = await openW(browser, 'WW22', { v: SMOKE_V(), debug: true, opts: { reducedMotion: 'reduce' } });
      await goStage(c.page, 4);
      const hashes = {};
      for (const lv of [1, 5, 15, 30, 30]) {
        await setL(c.page, `for (const d of Object.values(l.depts)) d.level = ${lv};`);
        await wait(c.page, 900);
        // スクロールしてから 1 コマ待って読む
        const res = {};
        for (const d of ['peel', 'plank', 'plane']) {
          await c.page.evaluate((d) => { const A = window.SeizaiActors, g = A.geometry(4), st = A.station(g, d, 0), sc = document.querySelector('#scene'); const s = sc.clientWidth / 360; sc.scrollTop = Math.max(0, st.ty * s - 150); }, d);
          await wait(c.page, 120);
          res[d] = await c.page.evaluate((d) => {
            const A = window.SeizaiActors, g = A.geometry(4), st = A.station(g, d, 0), cv = document.querySelector('#sceneCanvas'), sc = document.querySelector('#scene');
            const cr = cv.getBoundingClientRect(), k = cv.width / cr.width, s = sc.clientWidth / 360;
            const x0 = Math.floor((st.tx + 1) * s * k), y0 = Math.floor((st.ty * s - sc.scrollTop - 42 * s) * k), w = Math.floor(24 * s * k), hh = Math.floor(28 * s * k);
            const px = cv.getContext('2d').getImageData(x0, y0, w, hh).data;
            let a = 0; for (let i = 0; i < px.length; i += 4) a = (a * 31 + (px[i] >> 3) * 7 + (px[i + 1] >> 3) * 3 + (px[i + 2] >> 3)) >>> 0;
            return a;
          }, d);
        }
        (hashes[lv] = hashes[lv] || []).push(res);
      }
      const same = JSON.stringify(hashes[30][0]) === JSON.stringify(hashes[30][1]);
      const diff = ['peel', 'plank', 'plane'].every((d) => new Set([1, 5, 15, 30].map((lv) => hashes[lv][0][d])).size === 4);
      check(`台の上の絵が Lv 1・5・15・30 で 4 通りに変わる（同じ Lv では同じ ${same}）`, same && diff, hashes);
      await c.ctx.close();
      check('ページエラー・コンソールエラーが無い', errors.length === e0, errors.slice(e0));
    },
  },
  {
    id: 'WW23', tier: 'full', title: 'もくもくこうば 画面を広く（§19.3）：SE 縦で #hud＋#goal 104px 以下・#scene が画面の高さの 6 割以上、シートを開くと開いた場所の上 44px が #sheet の上に見える（みなとの全部署、SE 縦横・iPad）、シートのボタンが画面内・44px 以上、#scrollCue の文・押すとスクロール・シートの間は出ない・全部入るときは出ない・節目のあとの「あたらしい」、横向きはシートを右の列に',
    async run({ browser, check, root, errors }) {
      const L = logicOf(root);
      const e0 = errors.length;
      // --- SE 縦：上の帯の高さ ---
      {
        const { ctx, page } = await openW(browser, 'WW23', { v: SMOKE_V(), debug: true });
        const rows = [];
        for (const st of [1, 3, 4]) {
          if (st > 1) await goStage(page, st);
          if (st === 4) await dbg(page, 'ships', { n: 9999, got: 0 });
          await wait(page, 100);
          rows.push(await page.evaluate(() => { const h = document.querySelector('#hud').getBoundingClientRect(), g = document.querySelector('#goal').getBoundingClientRect(), s = document.querySelector('#scene').getBoundingClientRect(); return { goal: document.querySelector('#goalText').textContent, top: Math.round(g.bottom - h.top), scene: +(s.height / innerHeight).toFixed(3), money: document.querySelector('#money').getBoundingClientRect().height > 0 }; }));
        }
        check(`SE 縦：#hud＋#goal の高さ ${rows.map((r) => r.top).join('・')}px（104 以下）、#scene は画面の ${rows.map((r) => Math.round(r.scene * 100)).join('・')}%（6 割以上）。いちばん長い めあて「${rows[2].goal}」でも`, rows.every((r) => r.top <= 104 && r.scene >= 0.6 && r.money), rows);
        await ctx.close();
      }
      // --- シートを開くと、開いた場所の上 44px が見える（SE 縦横・iPad、みなと の全部署） ---
      for (const v of [view('SE', 'p', 'app'), view('SE', 'l', 'app'), view('iPad', 'p', 'app')]) {
        const { ctx, page } = await openW(browser, `WW23 ${v.label}`, { v, debug: true });
        await goStage(page, 4);
        await setL(page, 'l.money = 1e9;');
        // うりもの（goods）は押すと お客さんを呼ぶだけでシートは開かないので、シートを開く 9 部署
        const depts = await page.evaluate(() => [...document.querySelectorAll('.zone[data-dept]')].filter((b) => !b.hidden && b.dataset.dept !== 'goods').map((b) => b.dataset.dept));
        const bad = [];
        for (const d of depts) {
          for (const end of ['top', 'bottom']) {
            await page.evaluate(([d, end]) => { const sc = document.querySelector('#scene'); if (window.SeizaiGame.getState().sheet) document.querySelector('#sheetClose').click(); sc.scrollTop = end === 'top' ? 0 : sc.scrollHeight; document.querySelector(`.zone[data-dept="${d}"]`).click(); }, [d, end]);
            await wait(page, 120);
            const r = await page.evaluate((d) => {
              const sr = document.querySelector('#scene').getBoundingClientRect(), zr = document.querySelector(`.zone[data-dept="${d}"]`).getBoundingClientRect(), hr = document.querySelector('#sheet').getBoundingClientRect();
              const over = hr.left < sr.right - 1 && hr.right > sr.left + 1 && hr.top < sr.bottom - 1;
              const lim = over ? hr.top : sr.bottom;
              const btns = [...document.querySelectorAll('#sheet [data-buy], #sheetClose')].filter((b) => !b.hidden && b.getBoundingClientRect().width > 0).map((b) => b.getBoundingClientRect());
              return { top: Math.round(zr.top - sr.top), seen: Math.round(lim - Math.max(zr.top, sr.top)), topIn: zr.top >= sr.top - 1, over, btn: btns.every((q) => q.top >= -0.5 && q.bottom <= innerHeight + 0.5 && q.left >= -0.5 && q.right <= innerWidth + 0.5 && q.height >= 43.5 && q.width >= 43.5), sheet: window.SeizaiGame.getState().sheet };
            }, d);
            if (!(r.sheet === d && r.topIn && r.seen >= 44 && r.btn)) bad.push({ d, end, ...r });
          }
        }
        check(`${v.label}：みなと の ${depts.length} か所を上・下からスクロールして押しても、開いた場所の上 44px が見え（シートは${v.w > v.h && v.h <= 500 ? '右の列' : '絵に重ねる'}）、シートのボタンが画面内・44px 以上（だめ ${bad.length}）`, depts.length === 9 && bad.length === 0, bad.slice(0, 8));
        if (v.w > v.h && v.h <= 500) {
          const lay = await page.evaluate(() => { const s = document.querySelector('#scene').getBoundingClientRect(), h = document.querySelector('#sheet').getBoundingClientRect(); return { sheetLeft: h.left, sceneRight: s.right, sh: getComputedStyle(document.querySelector('#scene')).getPropertyValue('--sheet-h').trim() }; });
          check(`${v.label}：横向きはシートを右の列に（絵に重ねない・--sheet-h ${lay.sh}）`, lay.sheetLeft >= lay.sceneRight - 0.5 && (lay.sh === '' || lay.sh === '0px'), lay);
        }
        await ctx.close();
      }
      // --- スクロールの案内 #scrollCue ---
      {
        const { ctx, page } = await openW(browser, 'WW23', { v: SMOKE_V(), debug: true, opts: { reducedMotion: 'reduce' } });
        await goStage(page, 3);
        await page.evaluate(() => { document.querySelector('#scene').scrollTop = 0; }); await wait(page, 150);
        const c0 = (await gs(page)).scrollCue;
        const cr = await page.evaluate(() => { const b = document.querySelector('#scrollCue'), r = b.getBoundingClientRect(), g = document.querySelector('#goal').getBoundingClientRect(), h = document.querySelector('#hud').getBoundingClientRect(); return { hidden: b.hidden, text: b.textContent, label: b.getAttribute('aria-label'), dir: b.dataset.dir, w: r.width, h: r.height, in: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, apart: r.top >= g.bottom && r.top >= h.bottom }; });
        check(`こうじょう の上の端で #scrollCue「${cr.text}」（getState ${c0 && c0.text}・data-dir ${cr.dir}）が見えて 44px 以上・画面内・上の帯と重ならない`, c0 && !cr.hidden && cr.text === c0.text && cr.label === c0.text && /^↓ したに /.test(cr.text) && cr.dir === 'down' && cr.w >= 44 && cr.h >= 44 && cr.in && cr.apart, { c0, cr });
        const t0 = await page.evaluate(() => document.querySelector('#scene').scrollTop);
        await page.click('#scrollCue'); await wait(page, 200);
        const after = await page.evaluate((d) => { const sc = document.querySelector('#scene'), s = sc.getBoundingClientRect(), z = document.querySelector(`.zone[data-dept="${d}"]`).getBoundingClientRect(); return { top: sc.scrollTop, vis: Math.min(z.bottom, s.bottom) - Math.max(z.top, s.top), h: z.height }; }, c0.dept);
        const c1 = (await gs(page)).scrollCue;
        check(`押すと（動きを減らす設定で一瞬）スクロールして（${t0} → ${Math.round(after.top)}）${c0.dept} が見え、案内は次へ（${c1 ? c1.text : 'なし'}）`, after.top > t0 && after.vis >= Math.min(after.h, 100) / 2 && (!c1 || c1.text !== c0.text), { after, c1 });
        await page.click('.zone[data-dept="cut"]').catch(() => {});
        await page.evaluate(() => { if (!window.SeizaiGame.getState().sheet) window.SeizaiGame.tapZone('carry'); }); await wait(page, 150);
        const cs = await page.evaluate(() => ({ sheet: window.SeizaiGame.getState().sheet, cue: window.SeizaiGame.getState().scrollCue, hidden: document.querySelector('#scrollCue').hidden }));
        check(`シートが開いている間は出ない（${JSON.stringify(cs)}）`, !!cs.sheet && cs.cue === null && cs.hidden, cs);
        await page.click('#sheetClose'); await wait(page, 100);
        await page.evaluate(() => { const sc = document.querySelector('#scene'); sc.scrollTop = sc.scrollHeight; }); await wait(page, 150);
        const cu = (await gs(page)).scrollCue;
        check(`いちばん下までスクロールすると「${cu && cu.text}」`, cu && cu.text === '↑ うえに もり' && cu.dir === 'up', cu);
        await page.click('#scrollCue'); await wait(page, 150);
        check('押すと上の端へ', (await page.evaluate(() => document.querySelector('#scene').scrollTop)) === 0, null);
        await ctx.close();
      }
      // --- 節目のあとの「あたらしい」---
      {
        const st = mkState(L, 2, { goal: { done: L.STAGES[1].goal }, money: L.STAGES[1].cost + 10 });
        const { ctx, page } = await openW(browser, 'WW23', { v: SMOKE_V(), items: { 'seizai.save': saveOf(L, st, T0) }, opts: { clockTime: new Date(T0 + 1000), reducedMotion: 'reduce' } });
        await page.click('#expandBtn'); await waitOverlay(page, 'stage', 2500);
        check('節目カードの間は案内を出さない', (await gs(page)).scrollCue === null && (await page.evaluate(() => document.querySelector('#scrollCue').hidden)), null);
        await pressCard(page, '#stageOk');
        await page.evaluate(() => { document.querySelector('#scene').scrollTop = 0; }); await wait(page, 150);
        const cn = (await gs(page)).scrollCue, isNew = await page.evaluate(() => document.querySelector('#scrollCue').dataset.new);
        check(`こうじょう に広げたあと「${cn && cn.text}」（data-new ${isNew}）`, cn && cn.text === '↓ あたらしい かんそう' && isNew === '1', { cn, isNew });
        await page.click('#scrollCue'); await wait(page, 200);
        const cm = (await gs(page)).scrollCue;
        check(`押して かんそう が見えたら「あたらしい かんそう」は消える（いまは ${cm ? cm.text : 'なし'}）`, !cm || cm.text !== '↓ あたらしい かんそう', cm);
        await ctx.close();
      }
      // --- 全部入るときは出ない（背の高い画面・こや） ---
      {
        const { ctx, page } = await openW(browser, 'WW23', { v: custom(400, 1400, null, '400×1400') });
        await wait(page, 200);
        const r = await page.evaluate(() => ({ cue: window.SeizaiGame.getState().scrollCue, hidden: document.querySelector('#scrollCue').hidden, fit: document.querySelector('#scene').scrollHeight <= document.querySelector('#scene').clientHeight + 1 }));
        check(`絵が全部入る画面（400×1400・こや）では案内を出さない（${JSON.stringify(r)}）`, r.fit && r.cue === null && r.hidden, r);
        await ctx.close();
      }
      check('ページエラー・コンソールエラーが無い', errors.length === e0, errors.slice(e0));
    },
  },
  {
    id: 'WW24', tier: 'full', title: 'もくもくこうば はこぶ人の往復と「まち」（§20・SZ-04・SZ-05）：録画と同じ局面（こうば・きこり 2にん Lv2・なえぎ 2にん Lv3・はこぶ 3にん Lv2・かわむき 2台 Lv2・かくざい 2台 Lv2）で、ゲームの時間 30 秒の間に はこぶの人が丸太を持って門まで 3 回以上行き（carryTrips）、はこぶ・かわむき・かくざい の「まち」（getState().waits の "in"）が出続けず、はこぶ のシートに待つ文が出ない。動きを減らす設定でも往復する（ゆっくり歩くので 2 回以上）。本当に前の品が来ないとき（なえぎ 0 人で森が空）は今までどおり「まち」。きこりが つまって切り株が数秒おきにしか できない局面（こや・きこり 1にん Lv2・なえぎ 1にん Lv2）では、なえぎ（猶予 3 秒）に「まち」が出る',
    async run({ browser, check, root, errors }) {
      const L = logicOf(root);
      const e0 = errors.length;
      const rec = { money: 50, forest: { trees: 16, saplings: 0 }, buf: { yard: 0, logs: 0, peeled: 0, goods: 0 }, depts: { cut: { staff: 2, level: 2 }, plant: { staff: 2, level: 3 }, carry: { staff: 3, level: 2 }, peel: { lines: 2, level: 2 }, beam: { lines: 2, level: 2 }, shop: { staff: 1, level: 1 } } };
      for (const calm of [false, true]) {
        const tag = calm ? '動きを減らす設定' : '通常';
        const { ctx, page } = await openW(browser, 'WW24', { v: SMOKE_V(), items: { 'seizai.save': saveOf(L, mkState(L, 2, rec), T0) }, opts: { clockTime: new Date(T0 + 1000), ...(calm ? { reducedMotion: 'reduce' } : {}) } });
        await closeCards(page);
        await wait(page, 3000);   // 開いた直後（まだ何も作っていない間）は数えない
        const g0 = await gs(page), l0 = await lg(page);
        if (typeof g0.carryTrips !== 'number' || !g0.waits || typeof g0.waits !== 'object') throw new Error('getState() に carryTrips・waits が無い（§20 E4）');
        const n = { carry: 0, peel: 0, beam: 0 };
        const S = 30;
        for (let i = 0; i < S; i++) {
          await wait(page, 1000);
          const w = (await gs(page)).waits;
          for (const d in n) if (w[d] === 'in') n[d]++;
        }
        const g1 = await gs(page), l1 = await lg(page);
        const trips = g1.carryTrips - g0.carryTrips;
        const made = { carry: l1.done.carry - l0.done.carry, peel: l1.done.peel - l0.done.peel, beam: l1.done.beam - l0.done.beam };
        check(`${tag}：つまりは ${g1.bottleneck}。30 秒で logic は ${made.carry} 本運び、はこぶの人は門まで ${trips} 回（${calm ? 'ゆっくり歩くので 2 回以上' : '3 回以上・運んだ数の半分以上'}）`, made.carry >= 5 && (calm ? trips >= 2 : trips >= 3 && trips >= made.carry / 2), { trips, made, bn: g1.bottleneck });
        check(`${tag}：はこぶ の「まち」は ${n.carry}/${S} 回（2 割以下）`, n.carry <= S * 0.2, n);
        check(`${tag}：作っている間（かわむき ${made.peel}・かくざい ${made.beam}）は「まち」にならない（${n.peel}/${S}・${n.beam}/${S}。2 割以下）`, made.peel >= 5 && made.beam >= 5 && n.peel <= S * 0.2 && n.beam <= S * 0.2, { n, made });
        if (!calm) {
          await page.evaluate(() => document.querySelector('.zone[data-dept="carry"]').click()); await wait(page, 150);
          const ca = await page.evaluate(() => { const e = document.querySelector('#sheetInfo'); return { t: e.textContent.trim(), wait: e.dataset.wait }; });
          check(`はこぶ のシート「${ca.t}」に「まるたが まだ ないよ」は出ない（data-wait ${ca.wait}）`, ca.wait === '0' && !/まるたが まだ/.test(ca.t), ca);
          await page.click('#sheetClose'); await wait(page, 100);
          // 本当に前の品が来ない：なえぎ 0 人・森も置き場も空 → 少し待つと はこぶ・かわむき・かくざい が「まち」
          await setL(page, 'l.depts.plant.staff = 0; l.forest.trees = 0; l.forest.saplings = 0; for (const k of ["yard", "logs", "peeled"]) l.buf[k] = 0;');
          await wait(page, 16000);
          const w2 = (await gs(page)).waits;
          check(`本当に前の品が来ないとき（なえぎ 0 人・森が空）は「まち」：はこぶ ${w2.carry}・かわむき ${w2.peel}・かくざい ${w2.beam}`, w2.carry === 'in' && w2.peel === 'in' && w2.beam === 'in', w2);
        }
        await ctx.close();
      }
      // なえぎの猶予は 3 秒（§20 E2）：きこりが つまって切り株が数秒おきにしか できないとき、植え終わって次を待つ間は「きりかぶ まち」
      {
        const slow = { money: 50, forest: { trees: 10, saplings: 0 }, buf: { yard: 0, logs: 0, peeled: 0, goods: 0 }, depts: { cut: { staff: 1, level: 2 }, plant: { staff: 1, level: 2 }, carry: { staff: 2, level: 2 } } };
        const { ctx, page } = await openW(browser, 'WW24', { v: SMOKE_V(), items: { 'seizai.save': saveOf(L, mkState(L, 1, slow), T0) }, opts: { clockTime: new Date(T0 + 1000) } });
        await closeCards(page);
        await wait(page, 10000);   // 最初の切り株を植え終わるまで
        const l0 = await lg(page);
        let np = 0;
        const S = 30;
        for (let i = 0; i < S; i++) {
          await wait(page, 1000);
          if ((await gs(page)).waits.plant === 'in') np++;
        }
        const g1 = await gs(page), l1 = await lg(page);
        const planted = l1.done.plant - l0.done.plant;
        check(`きこりが つまり（${g1.bottleneck}）・30 秒で なえぎは ${planted} 本植えた間に、なえぎの「まち」が ${np}/${S} 回（1 割以上・8 割以下）`, g1.bottleneck === 'cut' && planted >= 2 && np >= S * 0.1 && np <= S * 0.8, { np, planted, bn: g1.bottleneck });
        await ctx.close();
      }
      check('ページエラー・コンソールエラーが無い', errors.length === e0, errors.slice(e0));
    },
  },
  {
    id: 'WW25', tier: 'full', title: 'もくもくこうば さいしょから（§21・SZ-07）：遊び方の「わかった」の下に #helpReset（44px 以上・SE 縦横で画面内・primary でない）、押すと確認カード #resetCard（文言・「やめる」が先で primary・遊び方と同じく止まる）、やめる・Esc で遊び方に戻り保存が変わらない、「さいしょから はじめる」で開き直して段 1・初めのお金から、seizai.best・seizai.help・seizai.save.v<n>・ほかのキーは残り、seizai.save は新しい状態・seizai.save.bak は無い。消している最中の pagehide・visibilitychange で古い保存を書き戻さず、開き直しても古い進み具合が戻らない。消せないときは開き直さずヒント',
    async run({ browser, check, root, errors }) {
      const L = logicOf(root);
      const e0 = errors.length;
      // (a) SE 縦・横で、遊び方の2つのボタンと確認カードの2つのボタンが画面内・44px 以上・スクロールなし
      const fit = [];
      for (const v of [SMOKE_V(), view('SE', 'l', 'app'), custom(568, 270, null, 'SE横 568×270')]) {
        const { ctx, page } = await openW(browser, 'WW25 ' + v.label, { v });
        const q = (sels) => page.evaluate((sels) => sels.map((s) => {
          const b = document.querySelector(s); if (!b) return { s, ok: false, why: 'なし' };
          const r = b.getBoundingClientRect(), box = b.closest('.overlay');
          const ok = r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.height >= 43.5 && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b && box.scrollHeight <= box.clientHeight + 1 && b.scrollWidth <= b.clientWidth + 1;
          return { s, ok, r: [r.left, r.top, r.right, r.bottom].map(Math.round) };
        }), sels);
        await page.click('#helpBtn'); await wait(page, 100);
        const h = await q(['#helpOk', '#helpReset']);
        await pressCard(page, '#helpReset');
        const r = await q(['#resetNo', '#resetYes']);
        fit.push({ label: v.label, ok: [...h, ...r].every((x) => x.ok), rows: [...h, ...r] });
        await ctx.close();
      }
      check('遊び方の #helpOk・#helpReset と確認の #resetNo・#resetYes が SE 縦・横（568×320・568×270）で画面内・44px 以上・押せる・スクロールなし', fit.every((f) => f.ok), fit);

      const st = mkState(L, 2, { money: 50000 });
      const items = { 'seizai.save': saveOf(L, st, T0), 'seizai.save.bak': 'old-bak', 'seizai.save.v2': 'newer', 'seizai.best': '3', 'blockpuzzle.sound': 'off', 'matomete.best': '123' };
      const { ctx, page } = await openW(browser, 'WW25', { v: SMOKE_V(), items, opts: { clockTime: new Date(T0 + 1000) } });
      await closeCards(page);
      await page.click('#helpBtn'); await wait(page, 100);
      const look = await page.evaluate(() => {
        const ok = document.querySelector('#helpOk'), rs = document.querySelector('#helpReset');
        return { after: !!ok && !!rs && ok.compareDocumentPosition(rs) === Node.DOCUMENT_POSITION_FOLLOWING && ok.parentElement === rs.parentElement, okPrimary: ok.classList.contains('primary'), rsPrimary: rs.classList.contains('primary'), text: rs.textContent.trim(), tag: rs.tagName };
      });
      check(`遊び方の「わかった」（primary）の下に「${look.text}」（button・primary でない）`, look.after && look.okPrimary && !look.rsPrimary && look.text === 'さいしょから あそぶ' && look.tag === 'BUTTON', look);
      const save0 = await stored(page, 'seizai.save');
      const t0 = (await lg(page)).t;
      await pressCard(page, '#helpReset');
      const card = await page.evaluate(() => {
        const box = document.querySelector('#resetCard'), bs = [...box.querySelectorAll('.btns button')];
        return { shown: !box.hidden, role: box.getAttribute('role'), title: document.querySelector('#resetTitle')?.textContent.trim(), text: document.querySelector('#resetText')?.textContent.trim(), ids: bs.map((b) => b.id), primary: bs.map((b) => b.classList.contains('primary')), texts: bs.map((b) => b.textContent.trim()), helpHidden: document.querySelector('#help').hidden };
      });
      const g1 = await gs(page);
      check(`確認カード：「${card.title}」「${card.text}」・ボタン ${card.texts.join('／')}（やめる が先で primary）・overlay ${g1.overlay}`,
        card.shown && card.helpHidden && card.role === 'dialog' && g1.overlay === 'reset' && card.title === 'さいしょから はじめる？' && card.text === 'いまの こうばは ぜんぶ きえるよ。ベストの きろくは のこるよ。' &&
        JSON.stringify(card.ids) === '["resetNo","resetYes"]' && JSON.stringify(card.primary) === '[true,false]' && JSON.stringify(card.texts) === '["やめる","さいしょから はじめる"]', { card, overlay: g1.overlay });
      await wait(page, 1500);
      const t1 = (await lg(page)).t;
      check(`確認カードの間はゲームが止まる（t ${t0} → ${t1}）`, t1 === t0, { t0, t1 });
      // (b) やめる・Esc
      await pressCard(page, '#resetNo');
      const gNo = await gs(page);
      const keepNo = { save: (await stored(page, 'seizai.save')) === save0, bak: await stored(page, 'seizai.save.bak') };
      await pressCard(page, '#helpReset');
      await unlocked(page, '#resetNo');
      await page.keyboard.press('Escape'); await wait(page, 100);
      const gEsc = await gs(page);
      const keepEsc = { save: (await stored(page, 'seizai.save')) === save0, bak: await stored(page, 'seizai.save.bak') };
      check(`やめる → ${gNo.overlay}・Esc → ${gEsc.overlay}（遊び方に戻る）、seizai.save と seizai.save.bak は変わらない`, gNo.overlay === 'help' && gEsc.overlay === 'help' && keepNo.save && keepEsc.save && keepNo.bak === 'old-bak' && keepEsc.bak === 'old-bak' && (await lg(page)).stage === 2, { gNo: gNo.overlay, gEsc: gEsc.overlay, keepNo, keepEsc });
      // (c)(d) 実行：消している最中（開き直す前）の pagehide・visibilitychange のあとの保存を記録する（main.js より後に足すので、main.js の保存のあとに読む）
      await pressCard(page, '#helpReset');
      await page.evaluate(() => {
        sessionStorage.removeItem('ww25');
        const rec = (ev) => { const a = JSON.parse(sessionStorage.getItem('ww25') || '[]'); a.push({ ev, save: localStorage.getItem('seizai.save'), bak: localStorage.getItem('seizai.save.bak') }); sessionStorage.setItem('ww25', JSON.stringify(a)); };
        window.addEventListener('pagehide', () => rec('pagehide'));
        document.addEventListener('visibilitychange', () => rec('visibilitychange'));
      });
      if (!(await unlocked(page, '#resetYes'))) throw new Error('#resetYes の aria-disabled が外れない');
      await Promise.all([page.waitForEvent('load', { timeout: 10000 }), page.click('#resetYes')]);
      await wait(page, 300);
      if (!(await page.evaluate(() => !!window.SeizaiGame))) throw new Error('開き直したあと SeizaiGame が無い');
      const hide = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ww25') || '[]'));
      check(`開き直す前の pagehide（${hide.map((h) => h.ev).join(',')}）で古い保存を書き戻さない（save・bak ともに無い）`, hide.some((h) => h.ev === 'pagehide') && hide.every((h) => h.save === null && h.bak === null), hide);
      const fresh = L.newGame(1);
      const l2 = await lg(page), g2 = await gs(page);
      const sv = JSON.parse((await stored(page, 'seizai.save')) || 'null');
      const keys = await page.evaluate(() => Object.fromEntries(['seizai.save.bak', 'seizai.save.v2', 'seizai.best', 'seizai.help', 'blockpuzzle.sound', 'matomete.best'].map((k) => [k, localStorage.getItem(k)])));
      check(`新しい状態で始まる（段 ${l2.stage}・お金 ${l2.money}（初め ${fresh.money}）・きこり ${l2.depts.cut.staff} 人 Lv${l2.depts.cut.level}）・カードなし・ヒントなし`, l2.stage === 1 && l2.money <= fresh.money + 50 && l2.depts.cut.staff === fresh.depts.cut.staff && l2.depts.cut.level === fresh.depts.cut.level && g2.overlay === null && !(await txt(page, '#hint')), { l2: { stage: l2.stage, money: l2.money, cut: l2.depts.cut }, overlay: g2.overlay });
      check(`seizai.save は新しい状態（段 ${sv && sv.stage}・お金 ${sv && sv.money}）、seizai.save.bak は無い、seizai.best・seizai.help・seizai.save.v2・音の設定・ほかのゲームは残る`, !!sv && sv.stage === 1 && sv.money < 50000 && keys['seizai.save.bak'] === null && keys['seizai.save.v2'] === 'newer' && keys['seizai.best'] === '3' && keys['seizai.help'] === '1' && keys['blockpuzzle.sound'] === 'off' && keys['matomete.best'] === '123', { sv: sv && { stage: sv.stage, money: sv.money }, keys });
      await setHidden(page, true); await wait(page, 100);
      await page.reload(); await wait(page, 300);
      const l3 = await lg(page);
      check(`隠して開き直しても古い進み具合が戻らない（段 ${l3.stage}・お金 ${l3.money}）・bak も無い`, l3.stage === 1 && l3.money < 50000 && (await stored(page, 'seizai.save.bak')) === null, { stage: l3.stage, money: l3.money });
      check('ページエラー・コンソールエラーが無い', errors.length === e0, errors.slice(e0));
      // R6：消せないとき（removeItem が何もしない）は開き直さず、保存も止めたままにしない
      await gotoW(page, { 'seizai.save': saveOf(L, st, T0), 'seizai.save.bak': 'old-bak' });
      await closeCards(page);
      const e1 = errors.length;
      await page.evaluate(() => { window.__ww25 = 1; Storage.prototype.removeItem = function () {}; });
      await page.click('#helpBtn'); await wait(page, 100);
      await pressCard(page, '#helpReset');
      await pressCard(page, '#resetYes');
      await wait(page, 500);
      const same = await page.evaluate(() => window.__ww25 === 1);
      const g4 = await gs(page), l4 = await lg(page);
      const c4 = g4.saveCount;
      await page.evaluate(() => window.SeizaiGame.buy('cut', 'level'));
      const c5 = (await gs(page)).saveCount;
      const hint = await txt(page, '#hint');
      const errs = errors.slice(e1);
      check(`消せないとき：開き直さない（${same}）・段 ${l4.stage} のまま・カードを閉じる（${g4.overlay}）・#hint「${hint}」・保存は止めたままにしない（saveCount ${c4} → ${c5}）・bak も残る`, same && l4.stage === 2 && g4.overlay === null && /けせなかった/.test(hint || '') && c5 === c4 + 1 && (await stored(page, 'seizai.save.bak')) === 'old-bak' && errs.length >= 1 && errs.every((e) => /さいしょから/.test(e)), { same, stage: l4.stage, overlay: g4.overlay, hint, c4, c5, errs });
      errors.splice(e1);
      await ctx.close();
    },
  },
  {
    id: 'WW26', tier: 'full', title: 'もくもくこうば 古いページから書き戻さない（§22・X-20）：bfcache から戻ったとき（pageshow persisted が先・visibilitychange が先の2通り）に保存がほかで変わっていたら、古い状態を書き戻さず開き直して今の保存から続ける（カードが出ない）。裏にいる間に別のタブが保存を書いたら、閉じても書き戻さず、表に戻ると開き直す。storage イベントが届かないまま閉じても（裏にしたあとに書かれて pagehide・見えている間に書かれてそのまま hidden の保存）書き戻さない。保存が変わっていなければ開き直さない',
    async run({ browser, check, root, errors }) {
      const L = logicOf(root);
      const e0 = errors.length;
      const stA = mkState(L, 2, { money: 50000 });
      const { ctx, page } = await openW(browser, 'WW26', { items: { 'seizai.save': saveOf(L, stA, T0) }, opts: { clockTime: new Date(T0 + 1000) } });
      await closeCards(page);
      // 新しい保存（別のページ・さいしょからが書いたもの）。savedAt はページの今（閉じた間 0 秒）
      const newer = async (stage, money) => saveOf(L, mkState(L, stage, { money }), await page.evaluate(() => Date.now()));
      const loaded = () => page.waitForEvent('load', { timeout: 5000 }).then(() => true, () => false);
      const after = async () => { await wait(page, 300); const l = await lg(page), g = await gs(page); return { stage: l.stage, money: l.money, overlay: g.overlay }; };
      // (a) 保存が変わっていなければ、pageshow persisted で開き直さない（今までどおり）
      const nav0 = loaded();
      await page.evaluate(() => { window.__ww26 = 1; window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
      check('保存が変わっていなければ、pageshow persisted でも開き直さない', !(await nav0) && (await page.evaluate(() => window.__ww26 === 1)) && (await lg(page)).stage === 2);
      // (b) bfcache：入る（pagehide persisted で保存）→ ほかで保存が変わる → pageshow persisted が先 → すぐ pagehide（書き戻すならここ）
      const bRaw = await newer(3, 77777);
      const nav1 = loaded();
      const hideB = await page.evaluate((raw) => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        localStorage.setItem('seizai.save', raw);
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
        return localStorage.getItem('seizai.save') === raw;
      }, bRaw);
      const rB = await nav1;
      const sB = await after();
      check(`bfcache（pageshow が先）：古い状態（段 2）を書き戻さず（${hideB}）、開き直して（${rB}）今の保存から続ける（段 ${sB.stage}・お金 ${sB.money}・カード ${sB.overlay}）`, hideB && rB && sB.stage === 3 && sB.money >= 77777 && sB.money < 77777 + 2000 && sB.overlay === null, { hideB, rB, sB });
      // (c) bfcache：visibilitychange（表）が pageshow より先に来ても、wake で保存を書かず開き直す
      await closeCards(page);
      const cRaw = await newer(4, 12345);
      await setHidden(page, true); await wait(page, 50);
      const nav2 = loaded();
      const hideC = await page.evaluate((raw) => {
        localStorage.setItem('seizai.save', raw);
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
        return localStorage.getItem('seizai.save') === raw;
      }, cRaw);
      const rC = await nav2;
      const sC = await after();
      check(`bfcache（visibilitychange が先）：書き戻さず（${hideC}）、開き直して（${rC}）今の保存から（段 ${sC.stage}・お金 ${sC.money}・カード ${sC.overlay}）`, hideC && rC && sC.stage === 4 && sC.money >= 12345 && sC.money < 12345 + 2000 && sC.overlay === null, { hideC, rC, sC });
      // (d) 別のタブ：このページが裏にいる間に、同じ context の2つ目のページが保存を書く（本物の storage イベント）
      await closeCards(page);
      await setHidden(page, true); await wait(page, 50);
      const p2 = await ctx.newPage();
      await p2.goto(SZ); await p2.waitForTimeout(300);
      const dRaw = saveOf(L, mkState(L, 1, { money: 4321 }), await p2.evaluate(() => Date.now()));
      await p2.evaluate((raw) => { window.SeizaiGame.setState(window.SeizaiLogic.loadSave(raw).state); window.SeizaiGame.save(); }, dRaw);
      const p2raw = await p2.evaluate(() => localStorage.getItem('seizai.save'));
      await page.waitForTimeout(200);
      const hideD = await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); return localStorage.getItem('seizai.save'); });
      const nav3 = loaded();
      await setHidden(page, false);
      const rD = await nav3;
      const sD = await after();
      check(`別のタブ：裏にいる間に別のタブが書いた保存（段 1）を、閉じる（pagehide）ときに書き戻さず（${hideD === p2raw}）、表に戻ると開き直して（${rD}）続ける（段 ${sD.stage}・お金 ${sD.money}）`, hideD === p2raw && rD && sD.stage === 1 && sD.money >= 4321 && sD.money < 4321 + 2000, { hideD: hideD === p2raw, rD, sD });
      await p2.close();
      // (e) storage イベントが届かないまま（iOS は裏のタブを止めるので遅れる）：別のページが書いたのと同じことを、このページの中から
      // 直接書いて再現する（同じページの書き換えは storage イベントが出ない）。e1：裏にしたあとに書かれて pagehide。
      // e2：見えている間に書かれ、イベントが届く前にそのまま裏へ回る（sleep の保存）→ pagehide。どちらも書き戻さず、表に戻ると開き直す
      await closeCards(page);
      await setHidden(page, true); await wait(page, 50);
      const e1Raw = await newer(2, 24680);
      const hideE1 = await page.evaluate((raw) => {
        localStorage.setItem('seizai.save', raw);
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        return localStorage.getItem('seizai.save') === raw;
      }, e1Raw);
      const nav4 = loaded();
      await setHidden(page, false);
      const rE1 = await nav4;
      const sE1 = await after();
      check(`storage イベントが届かないまま（裏にしたあと書かれて pagehide）：書き戻さず（${hideE1}）、表に戻ると開き直して（${rE1}）続ける（段 ${sE1.stage}・お金 ${sE1.money}）`, hideE1 && rE1 && sE1.stage === 2 && sE1.money >= 24680 && sE1.money < 24680 + 2000, { hideE1, rE1, sE1 });
      await closeCards(page);
      const e2Raw = await newer(3, 13579);
      const hideE2 = await page.evaluate((raw) => {
        localStorage.setItem('seizai.save', raw);
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        const hid = localStorage.getItem('seizai.save') === raw;
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        return hid && localStorage.getItem('seizai.save') === raw;
      }, e2Raw);
      const nav5 = loaded();
      await setHidden(page, false);
      const rE2 = await nav5;
      const sE2 = await after();
      check(`storage イベントが届かないまま（見えている間に書かれて hidden の保存）：書き戻さず（${hideE2}）、表に戻ると開き直して（${rE2}）続ける（段 ${sE2.stage}・お金 ${sE2.money}）`, hideE2 && rE2 && sE2.stage === 3 && sE2.money >= 13579 && sE2.money < 13579 + 2000, { hideE2, rE2, sE2 });
      check('ページエラー・コンソールエラーが無い', errors.length === e0, errors.slice(e0));
      await ctx.close();
    },
  },
  {
    id: 'WW27', tier: 'full', title: 'もくもくこうば もう強くできない つまり（§23・SZ-08）：ユーザーの録画と同じ みなと・全部の部署を上限・Lv50・はやい で、つまりは かんな でなく、かんな のシートは「1ぷんに 849まい」。つまりの部署が もう強くできないときは「ここが おそい！」の札（jamTag）・シートと読み上げの「ここが おそいよ」を出さず、「ぜんぶ さいだい！」（シート「これいじょう はやく できないよ」・data-maxed=1・data-jam=0）、ほかの場所に「〇〇を ふやそう」を出さない。マネージャーを「もうかる」にすると（まだ速くできる）「ここが おそい」に戻る。こうじょう（段 3）で全部さいだい・はやい のときは、つまり（みせ）は みなと で上限が増えるので シートは「つぎの だんで もっと ふやせるよ」（「これいじょう はやく できないよ」と言わない。S1）',
    async run({ browser, check, root, errors }) {
      const L = logicOf(root);
      const e0 = errors.length;
      const st = mkState(L, 4, { goal: { done: 0 } });
      for (const [k, d] of Object.entries(st.depts)) { const cap = L.CAPS[3][k]; d.level = 50; d.mgr = 'fast'; if ('lines' in d) d.lines = cap; else d.staff = cap; }
      const { ctx, page } = await openW(browser, 'WW27', { v: SMOKE_V(), items: { 'seizai.save': saveOf(L, st, T0) }, opts: { clockTime: new Date(T0 + 1000) } });
      await closeCards(page);
      // 場所を押してシートを開くと応援（2 倍）になり つまりが動くので、先に全部を応援して 5 秒の効き目が切れるのを待つ
      // （そのあと 10 秒は応援を使えない間で、押してもシートが開くだけ。下の確かめは その間に終える）
      await page.evaluate(() => { for (const d of window.SeizaiLogic.DEPTS) window.SeizaiGame.tapZone(d.id); });
      await wait(page, 5600);
      const zoneInfo = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.zone[data-dept]')].filter((b) => !b.hidden).map((b) => [b.dataset.dept, { jam: b.dataset.jam, maxed: b.dataset.maxed, label: b.getAttribute('aria-label') || '' }])));
      const sheetOf = async (d) => { await page.evaluate((x) => document.querySelector(`.zone[data-dept="${x}"]`).click(), d); await wait(page, 150); const r = await page.evaluate(() => { const e = document.querySelector('#sheetInfo'); return { t: e.textContent.replace(/\s+/g, ' ').trim(), jam: e.dataset.jam, maxed: e.dataset.maxed }; }); await page.click('#sheetClose'); await wait(page, 60); return r; };
      const g = await gs(page);
      const bn = g.bottleneck;
      check(`全部さいだい・はやい：つまりは かんな でない（${bn}）・もう強くできない（bottleneckMaxed ${g.bottleneckMaxed}）`, bn && bn !== 'plane' && g.bottleneckMaxed === true, { bn, maxed: g.bottleneckMaxed });
      const pl = await sheetOf('plane');
      const want = Math.floor(L.rates(await lg(page)).plane * 60);
      check(`かんな のシート「${pl.t}」が 1ぷんに ${want}まい（849。録画の 424 ではない）で、「おそい」が無い`, want === 849 && pl.t.includes('1ぷんに 849まい') && !/おそい/.test(pl.t), pl);
      const tag = g.jamTag;
      check(`つまりの札（${tag && tag.dept}：「${tag && tag.text}」）は「ぜんぶ さいだい！」で「おそい」ではない`, tag && tag.dept === bn && /さいだい！/.test(tag.text) && !/おそい/.test(tag.text), tag);
      const z = await zoneInfo();
      check(`${bn} の場所：data-jam 0・data-maxed 1、読み上げ「${z[bn] && z[bn].label}」に「ぜんぶ さいだい」があり「おそい」が無い`, z[bn] && z[bn].jam !== '1' && z[bn].maxed === '1' && /ぜんぶ さいだい/.test(z[bn].label) && !/おそい/.test(z[bn].label), z[bn]);
      const bad = Object.entries(z).filter(([, v]) => /おそい|を ふやそう/.test(v.label));
      check('ほかの場所の読み上げにも「おそい」「〇〇を ふやそう」（強くできない部署を すすめる）が無い', bad.length === 0, bad);
      const sb = await sheetOf(bn);
      check(`${bn} のシート「${sb.t}」：「ぜんぶ さいだい！」「これいじょう はやく できないよ」、「ここが おそいよ」は無い（data-jam 0・data-maxed 1）`, /ぜんぶ さいだい！/.test(sb.t) && /これいじょう はやく できないよ/.test(sb.t) && !/おそい/.test(sb.t) && sb.jam === '0' && sb.maxed === '1', sb);
      // マネージャーを「もうかる」にすると、まだ「はやい」で速くできる → 「ここが おそい」に戻る
      const sm = await page.evaluate((d) => window.SeizaiGame.setMgr(d, 'gain'), bn);
      await wait(page, 400);
      const g2 = await gs(page), z2 = await zoneInfo(), s2 = await sheetOf(g2.bottleneck);
      check(`${bn} を「もうかる」に（${JSON.stringify(sm && sm.ok !== undefined ? sm.ok : sm)}）：つまり ${g2.bottleneck}・bottleneckMaxed false、札「${g2.jamTag && g2.jamTag.text}」、場所 data-jam 1、シート「${s2.t}」に「ここが おそいよ」`, g2.bottleneck === bn && g2.bottleneckMaxed === false && g2.jamTag && /おそい！/.test(g2.jamTag.text) && z2[bn].jam === '1' && z2[bn].maxed === '0' && /ここが おそいよ/.test(z2[bn].label) && /ここが おそいよ/.test(s2.t) && s2.jam === '1', { g2: { bn: g2.bottleneck, m: g2.bottleneckMaxed, tag: g2.jamTag }, z: z2[bn], s2 });
      // 段 3（こうじょう）で全部さいだい・はやい：つまり（みせ）は今は もう強くできないが、みなと で上限が増える → 「これいじょう はやく できないよ」とは言わない（S1）
      const st3 = mkState(L, 3, { goal: { done: 0 } });
      for (const [k, d] of Object.entries(st3.depts)) { const cap = L.CAPS[2][k]; if (!cap) continue; d.level = 50; d.mgr = 'fast'; if ('lines' in d) d.lines = cap; else d.staff = cap; }
      await gotoW(page, { 'seizai.save': saveOf(L, st3, T0) });
      await closeCards(page);
      await page.evaluate(() => { for (const d of window.SeizaiLogic.DEPTS) window.SeizaiGame.tapZone(d.id); });
      await wait(page, 5600);
      const g3 = await gs(page), s3 = await sheetOf(g3.bottleneck);
      check(`こうじょう で全部さいだい・はやい：つまり ${g3.bottleneck}（bottleneckMaxed ${g3.bottleneckMaxed}・bottleneckMoreNext ${g3.bottleneckMoreNext}）のシート「${s3.t}」は「つぎの だんで もっと ふやせるよ」で、「これいじょう はやく できないよ」「ここが おそいよ」は無い（data-maxed 1）`,
        g3.stage === 3 && g3.bottleneck === 'shop' && g3.bottleneckMaxed === true && g3.bottleneckMoreNext === true && /つぎの だんで もっと ふやせるよ/.test(s3.t) && !/これいじょう/.test(s3.t) && !/おそい/.test(s3.t) && s3.maxed === '1' && s3.jam === '0', { g3: { st: g3.stage, bn: g3.bottleneck, m: g3.bottleneckMaxed, more: g3.bottleneckMoreNext }, s3 });
      check('ページエラー・コンソールエラーが無い', errors.length === e0, errors.slice(e0));
      await ctx.close();
    },
  },
  {
    id: 'WW28', tier: 'full', title: 'もくもくこうば マネージャーの切り替え（X-25）：「はやい／もうかる」の ✓ は見た目だけで、読み上げの名前（ariaSnapshot）に ✓ が入らない、状態は aria-pressed（押すと入れ替わる）',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openW(browser, 'WW28', { v: SMOKE_V(), items: { 'seizai.save': saveOf(L, mkState(L, 2, { depts: { cut: { staff: 2, level: 10, mgr: 'fast' } } }), T0) }, opts: { clockTime: new Date(T0 + 1000) } });
      await page.evaluate(() => document.querySelector('.zone[data-dept="cut"]').click()); await wait(page, 100);
      const ax = async () => ({ fast: (await page.locator('#mgrFast').ariaSnapshot()).replace(/\s+/g, ' '), gain: (await page.locator('#mgrGain').ariaSnapshot()).replace(/\s+/g, ' '),
        vis: await page.evaluate(() => getComputedStyle(document.querySelector('#mgrFast > span'), '::before').content) });
      const a0 = await ax();
      await page.click('#mgrGain'); await wait(page, 100);
      const a1 = await ax();
      const okOne = (a, on) => /^- button "/.test(a.fast) && /^- button "/.test(a.gain) && !/✓/.test(a.fast + a.gain)
        && /\[pressed\]/.test(on === 'fast' ? a.fast : a.gain) && !/\[pressed\]/.test(on === 'fast' ? a.gain : a.fast);
      check(`はやい・もうかる の読み上げの名前に ✓ なし、状態は aria-pressed（${a0.fast} / ${a0.gain} → もうかるを押すと ${a1.fast} / ${a1.gain}）。見た目の ✓ は残る（${a0.vis}）`,
        okOne(a0, 'fast') && okOne(a1, 'gain') && /✓/.test(a0.vis), { a0, a1 });
      await ctx.close();
    },
  },
];
