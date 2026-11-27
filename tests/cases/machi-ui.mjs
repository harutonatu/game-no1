// CW: ぼくのまち の画面（games/machi/）。約束は docs/machi-contract.md（§7 画面・§8 保存・§9 効果音・§10 メニュー）、項目は計画書 docs/plans/machi.md §7。
//   画面の DOM は約束 §7 の id：#topBar・#backBtn・#nameBtn・[data-cmd="help"]・#soundBtn・#stats・#moneyText・#popText・#starText・#newsBar・#newsText・#dateText・#mapWrap・#mapCanvas・
//     #viewBtn・[data-cmd="zoom-in"|"zoom-out"]・#speedBtns [data-speed]・#zoomHint・#voiceBar・#toolHint・#tools [data-tool]・#terrainCard [data-terrain]・[data-cmd="reroll"]・
//     #nameCard・#nameInput・[data-cmd="name-ok"|"name-cancel"]・#infoCard・#statusCard・#rankCard・#helpCard・#restartCard（約束 §7.5 に足した id も使う）
//   テスト用の窓口：window.__machi（state・overlay・tool・render・saveNow）と ?debug=1 の命令（stats・addmoney・skip・setspeed・event・voice・demo・setstate）
//   決まり：
//     ・地形は種で決まるので、ほとんどの項目は Node の logic.js（同じ root）で作った保存（newGame(5, 0)＋手で置いた物）を seed() で入れてから開く（毎回同じ町）
//     ・保存を直接書くときは、ゲームのページで書いて reload しない（pagehide で上書きされる）。seed() で中立のページへ移って書いてから開く
//     ・無いときに合格にしない：window.__machi・MachiLogic が無ければ例外で不合格にする
//   smoke：CW1〜CW4。full：CW5〜CW17（CW12 は CDP の CPU 低速化なので Chromium だけ・solo、CW11 は AudioContext が要る）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BASE, view, custom, newPage, seed, wait, sleep, layoutProbe, swInfo, SFX_SPY, plays, x20Run, x20Text } from '../lib.mjs';

const M = BASE + 'games/machi/';
const MD = M + '?debug=1';
const SMOKE_V = () => view('SE', 'p', 'app');
const STD_V = () => custom(375, 812, [47, 0, 34, 0], 'iPhone XS 375×812');
const SE_P = () => custom(320, 568, [20, 0, 0, 0], 'SE 縦 320×568');
const SE_L = () => custom(568, 320, [0, 0, 0, 0], 'SE 横 568×320');
const T0 = 1790000000000;

// ---------- logic.js（Node）。期待値と保存を作るのに使う ----------
function logicOf(root) {
  const f = path.join(root, 'games/machi/logic.js');
  if (!fs.existsSync(f)) throw new Error('games/machi/logic.js が無い');
  const L = createRequire(f)(f);
  if (!L || typeof L.newGame !== 'function' || typeof L.makeSave !== 'function' || typeof L.loadSave !== 'function') throw new Error('logic.js が MachiLogic を module.exports していない');
  return L;
}
const freeCell = (L, s, i) => (s.terrain[i] === L.TER.FLAT || s.terrain[i] === L.TER.BEACH) && s.use[i] === 0;
// 地図の真ん中に近い所で、たてに n マス続く 空いた へいち（上のマス x・y を返す）
function findVRun(L, s, n, near = [32, 39]) {
  let best = null, bd = 1e9;
  for (let y = 3; y + n < L.H - 3; y++) for (let x = 3; x < L.W - 3; x++) {
    let ok = true;
    for (let k = 0; k < n && ok; k++) ok = freeCell(L, s, (y + k) * L.W + x);
    if (!ok) continue;
    const d = Math.abs(x - near[0]) + Math.abs(y + n / 2 - near[1]);
    if (d < bd) { bd = d; best = { x, y }; }
  }
  if (!best) throw new Error('たてに空いた へいち が見つからない');
  return best;
}
// 地図の真ん中に近い所で、よこに n マス続く 空いた へいち（左のマス x・y を返す）。いりぐちから 4 マス以上はなす
function findRun(L, s, n, near = [32, 39]) {
  let best = null, bd = 1e9;
  for (let y = 3; y < L.H - 3; y++) for (let x = 3; x + n < L.W - 3; x++) {
    let ok = true;
    for (let k = 0; k < n && ok; k++) ok = freeCell(L, s, y * L.W + x + k);
    if (!ok) continue;
    const d = Math.abs(x + n / 2 - near[0]) + Math.abs(y - near[1]);
    if (d < bd) { bd = d; best = { x, y }; }
  }
  if (!best) throw new Error('空いた へいち が見つからない');
  return best;
}
const mkRaw = (L, s, at = T0) => { const t = L.makeSave(s, at); if (typeof t !== 'string') throw new Error('makeSave が文字を返さない'); return t; };
const baseRaw = (L, seedN = 5, choice = 0) => mkRaw(L, L.newGame(seedN, choice));
// 自動プレイ（greedy）の町。months か月まで
const simState = (L, months, seedN = 1, choice = 0, policy = 'greedy') => { const r = L.simulate(seedN, policy, months, { choice }); if (!r || !r.state) throw new Error('simulate が state を返さない'); return r.state; };

// ---------- 開く・読む ----------
async function openM(browser, label, { v = STD_V(), opts = {}, items = {}, seen = true, debug = false, raw = undefined, pick = 0 } = {}) {
  const { ctx, page } = await newPage(browser, v, label, { clock: true, ...opts });
  await gotoM(page, { items, seen, debug, raw, pick });
  return { ctx, page };
}
async function gotoM(page, { items = {}, seen = true, debug = false, raw = undefined, pick = 0 } = {}) {
  await seed(page, { ...(seen ? { 'machi.seen': '1' } : {}), ...(raw ? { 'machi.save': raw } : {}), ...items });
  await page.goto(debug ? MD : M); await wait(page, 300);
  const has = await page.evaluate(() => !!window.__machi && !!window.MachiLogic && !!window.MachiRender);
  if (!has) throw new Error('window.__machi が無い（games/machi/main.js が読まれていない）');
  if (debug && !(await page.evaluate(() => !!window.YubiDebug && typeof window.YubiDebug.run === 'function'))) throw new Error('?debug=1 なのに YubiDebug が無い');
  if (pick !== null && (await vis(page, '#terrainCard'))) { await page.click(`[data-terrain="${pick}"]`); await wait(page, 200); }
}
const vis = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && e.getBoundingClientRect().width > 0; }, sel);
const txt = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const stored = (p, k) => p.evaluate((k) => { try { return localStorage.getItem(k); } catch { return 'ERR'; } }, k);
const st = (p) => p.evaluate(() => { const s = window.__machi.state; return s ? { money: s.money, pop: s.pop, month: s.month, speed: s.speed, name: s.name, rank: s.rank, star: s.star, tax: s.tax, seed: s.seed, choice: s.choice } : null; });
const cellUse = (p, x, y) => p.evaluate(([x, y]) => { const s = window.__machi.state; const i = y * s.W + x; return { use: s.use[i], lvl: s.lvl[i], kind: s.kind[i] }; }, [x, y]);
const useCount = (p, u) => p.evaluate((u) => { const s = window.__machi.state; let n = 0; for (let i = 0; i < s.use.length; i++) if (s.use[i] === u) n++; return n; }, u);
const camera = (p) => p.evaluate(() => window.__machi.render.camera());
const dbg = async (p, name, args) => {
  const r = await p.evaluate(([n, a]) => window.YubiDebug.run(n, a), [name, args || {}]);
  if (!r || !r.ok) throw new Error(`デバッグ命令 ${name} が失敗: ${JSON.stringify(r && r.error)}`);
  return r.result;
};
const overlayNow = (p) => p.evaluate(() => window.__machi.overlay);
const reachable = (p, sel) => p.evaluate((s) => {
  const e = document.querySelector(s); if (!e) return false;
  const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false;
  const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!t && (t === e || e.contains(t));
}, sel);
// 1 マスが cell px になるよう寄せ、(x, y) を地図の真ん中に置く（端ではカメラが切られるので、あとで camera() を読み直す）
async function centerOn(page, x, y, cell = 22) {
  await page.evaluate(([x, y, c]) => window.__machi.render.setCamera({ cx: x + 0.5, cy: y + 0.5, cell: c }), [x, y, cell]);
  await wait(page, 100);
}
// マス (x, y) の真ん中のページ上の座標
async function pxOf(page, x, y) {
  return page.evaluate(([x, y]) => {
    const c = window.__machi.render.camera(), b = document.querySelector('#mapCanvas').getBoundingClientRect();
    return [b.left + b.width / 2 + (x + 0.5 - c.cx) * c.cell, b.top + b.height / 2 + (y + 0.5 - c.cy) * c.cell];
  }, [x, y]);
}
async function tapCell(page, x, y) { const [px, py] = await pxOf(page, x, y); await page.mouse.click(px, py); await wait(page, 60); }
async function dragCells(page, x0, y0, x1, y1, steps = 6) {
  const [ax, ay] = await pxOf(page, x0, y0), [bx, by] = await pxOf(page, x1, y1);
  await page.mouse.move(ax, ay); await page.mouse.down();
  await page.mouse.move((ax + bx) / 2, (ay + by) / 2, { steps }); await page.mouse.move(bx, by, { steps });
  return { up: async () => { await page.mouse.up(); await wait(page, 80); } };
}
// いりぐちのマスが地図の中に見えているか（css px で中に入る）と、真ん中からの近さ
const entryView = (p) => p.evaluate(() => {
  const s = window.__machi.state, c = window.__machi.render.camera(), b = document.querySelector('#mapCanvas').getBoundingClientRect();
  return s.entry.map((e) => { const x = b.width / 2 + (e.x + 0.5 - c.cx) * c.cell, y = b.height / 2 + (e.y + 0.5 - c.cy) * c.cell; return { x: Math.round(x), y: Math.round(y), in: x >= 0 && y >= 0 && x <= b.width && y <= b.height }; });
});
const ENTRY_GOAL = 'いりぐち（ひかって いる ところ）から みちを ひこう';
const pick = async (page, tool) => { await page.click(`[data-tool="${tool}"]`); await wait(page, 50); };
const pressed = (p, tool) => p.evaluate((t) => document.querySelector(`[data-tool="${t}"]`).getAttribute('aria-pressed'), tool);

export const tests = [
  // ================= smoke =================
  {
    id: 'CW1', tier: 'smoke', title: 'ぼくのまち 開く・地形えらび・始まる：はじめは #terrainCard に 3 つの地形（[data-terrain]・絵が描かれる）、「ほかの ちけい」で別の 3 つ、選ぶと始まって（はじめのお金・ぼくのまち・1 ねんめ 4 がつ・ひと 0・machi.save が書かれる）あそびかたが出て（止まる）、閉じると machi.seen=1 とヒント、開き直すと続きから（地形えらびは出ない・あそびかたも出ない）',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openM(browser, 'CW1', { v: STD_V(), seen: false, pick: null });
      check('はじめは #terrainCard が出ていて、まだ町は無い（state なし）', (await vis(page, '#terrainCard')) && (await page.evaluate(() => window.__machi.state === null)), null);
      const painted = await page.evaluate(() => [...document.querySelectorAll('#terrainCard [data-terrain]')].map((b) => { const cv = b.querySelector('canvas'); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return { t: b.dataset.terrain, n, name: b.textContent.trim(), w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height }; }));
      check(`3 つの地形（${painted.map((p) => p.name).join('・')}）の絵が描かれ、押せる大きさ（44px 以上）`, painted.length === 3 && painted.every((p) => p.n > 1000 && p.w >= 44 && p.h >= 44) && ['うみべ', 'かわの まち', 'やまあい'].every((n, i) => painted[i].name === n), painted);
      const sig = () => page.evaluate(() => document.querySelector('#terrainCard [data-terrain="0"] canvas').toDataURL().length + ':' + document.querySelector('#terrainCard [data-terrain="1"] canvas').toDataURL().slice(-60));
      const s0 = await sig();
      await page.click('[data-cmd="reroll"]'); await wait(page, 100);
      const s1 = await sig();
      check('「ほかの ちけい」で別の 3 つに変わる（絵が変わる）', s0 !== s1 && (await vis(page, '#terrainCard')), { s0, s1 });
      await page.click('[data-terrain="1"]'); await wait(page, 300);
      const a = await st(page);
      check(`選ぶと始まる：お金 ${a && a.money}（START_MONEY ${L.START_MONEY}）・名前 ${a && a.name}・ひと 0・1 か月目（month 0）`, !!a && a.money === L.START_MONEY && a.name === 'ぼくのまち' && a.pop === 0 && a.month === 0 && a.choice === 1, a);
      const ui = { money: await txt(page, '#moneyText'), pop: await txt(page, '#popText'), date: await txt(page, '#dateText'), name: await txt(page, '#nameBtn'), star: await page.getAttribute('#starText', 'aria-label') };
      check(`画面：おかね「${ui.money}」・ひと「${ui.pop}」・「${ui.date}」・名前「${ui.name}」・星 ${ui.star}`, ui.money === L.formatMoney(L.START_MONEY) && ui.pop === '0' && ui.date === '1 ねんめ 4 がつ' && ui.name === 'ぼくのまち' && /^すみやすさ ほし [1-5] \/ 5$/.test(ui.star), ui);
      check('地形えらびは閉じ、あそびかた（#helpCard）が出ている', !(await vis(page, '#terrainCard')) && (await vis(page, '#helpCard')) && (await overlayNow(page)) === 'help', await overlayNow(page));
      const helpTxt = await txt(page, '#helpCard');
      check(`はじめての あそびかた：道具を 1 行ずつ（すむ・しごと（こうば）・おみせ・みち・せんろ・みどり・こわす・めぐみ）説明し、「さいしょから」は出さない`, ['すむ', 'しごと：こうば', 'おみせ', 'みち', 'せんろ', 'みどり', 'こわす', 'めぐみ：おく ばしょで はたけ・りんぎょう・りょうし'].every((w) => helpTxt.includes(w)) && !(await vis(page, '#helpCard [data-cmd="restart-ask"]')), helpTxt);
      check('machi.save が書かれ（JSON・v:1・choice:1）、machi.seen はまだ無い', await page.evaluate(() => { try { const o = JSON.parse(localStorage.getItem('machi.save')); return o.v === 1 && o.choice === 1 && localStorage.getItem('machi.seen') === null; } catch { return false; } }), await stored(page, 'machi.save'));
      const m0 = (await st(page)).month;
      await wait(page, 9000);
      check('あそびかたを開いている間は時間が進まない（9 秒たっても同じ月）', (await st(page)).month === m0, await st(page));
      await page.click('[data-cmd="help-close"]'); await wait(page, 100);
      check('「はじめる」で閉じ、machi.seen=1・はじめの 1 回のヒント #zoomHint が出る', !(await vis(page, '#helpCard')) && (await stored(page, 'machi.seen')) === '1' && (await vis(page, '#zoomHint')), null);
      await wait(page, 700);
      const ce = await camera(page), ev = await entryView(page);
      const zh = await page.evaluate(() => { const z = document.querySelector('#zoomHint').getBoundingClientRect(), m = document.querySelector('#mapWrap').getBoundingClientRect(); return { top: z.top - m.top, left: z.left - m.left, cy: (z.top + z.bottom) / 2 - m.top, mh: m.height }; });
      check(`閉じると いりぐちへ寄る（1 マス ${ce.cell.toFixed(1)}px・22px 以上、いりぐち ${ev.map((e) => `${e.x},${e.y}`).join(' ')} が地図の中）・印が付く・帯は「${await txt(page, '#newsText')}」・拡大の案内は地図の下の端（真ん中でない・いりぐちを隠さない）`, ce.cell >= 21.9 && ev.every((e) => e.in) && JSON.stringify(await page.evaluate(() => window.__machi.render.entryCells())) === JSON.stringify(await page.evaluate(() => window.__machi.state.entry.map((e) => e.y * window.__machi.state.W + e.x))) && (await txt(page, '#newsText')) === ENTRY_GOAL && zh.cy > zh.mh * 0.75, { ce, ev, zh });
      await wait(page, 5000);
      check('時間が進む（5 秒で月が進む）', (await st(page)).month > m0, await st(page));
      const aSeed = (await st(page)).seed;
      await page.goto(BASE + 'manifest.webmanifest'); await page.goto(M); await wait(page, 300);
      const b = await st(page);
      check(`開き直すと続きから：地形えらび・あそびかたは出ず、同じ町（種 ${b && b.seed}）・お金が引き継がれる`, !!b && b.seed === aSeed && !(await vis(page, '#terrainCard')) && !(await vis(page, '#helpCard')) && b.money <= L.START_MONEY + 200, { b, aSeed });
      await ctx.close();
    },
  },
  {
    id: 'CW2', tier: 'smoke', title: 'ぼくのまち 置く：道具を選ぶと aria-pressed・はじめての道具は説明（1 回だけ）→値段のヒント、まだ いりぐちに みちが無いとき引いた絵でタップすると いりぐちへ寄る（印つき）、みちが つながったあとは押した所へ寄る（「ちかくで おいてね」）、寄ってタップで 1 マス（お金が値段ぶん減る）、つながらない みちは置く前の札と置いたあとのヒントで「つながって いないよ」、なぞると まっすぐの みち、こわすで置いてすぐなら全部返る、置けない理由の出し分け（うみ・やま・かわ・もう ある・お金）、まち になる前の せんろ は選べない（「まち」（1,000 にん））',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const s0 = L.newGame(5, 0);
      const run = findRun(L, s0, 8);
      const ent = s0.entry[s0.entry.length - 1];
      const findT = (t) => { for (let y = 2; y < L.H - 2; y++) for (let x = 2; x < L.W - 2; x++) if (s0.terrain[y * L.W + x] === t) return { x, y }; throw new Error('地形 ' + t + ' が無い'); };
      const sea = findT(L.TER.SEA), mtn = findT(L.TER.MOUNT), riv = findT(L.TER.RIVER);
      const { ctx, page } = await openM(browser, 'CW2', { v: STD_V(), raw: mkRaw(L, s0), debug: true });
      // 時間を止めてから確かめる（2026-11-26：WebKit では遅く、途中で月が変わって維持費が引かれ、お金の数がずれた）
      await page.click('#speedBtns [data-speed="0"]'); await wait(page, 100);
      await pick(page, 'road');
      const tip = await txt(page, '#toolHint');
      check(`みち を選ぶと aria-pressed=true・はじめては道具の説明（「${tip}」）`, (await pressed(page, 'road')) === 'true' && /みち＝いりぐちから/.test(tip), tip);
      await wait(page, 6500);
      check(`説明は 6 秒で値段のヒント「${await txt(page, '#toolHint')}」に戻る`, /みち 1 マス 10/.test(await txt(page, '#toolHint')), await txt(page, '#toolHint'));
      await pick(page, 'road'); await pick(page, 'road');
      check('同じ道具を 2 回目に選んだときは説明を出さない（machi.tips に road）', /みち 1 マス 10/.test(await txt(page, '#toolHint')) && /road/.test(await stored(page, 'machi.tips') || ''), await txt(page, '#toolHint'));
      const c0 = await camera(page);
      const m0 = (await st(page)).money;
      const [px, py] = await pxOf(page, 32, 39);
      await page.mouse.click(px, py); await wait(page, 700);
      const c1 = await camera(page), ev = await entryView(page);
      check(`まだ いりぐちに みちが無いとき、引いた絵（1 マス ${c0.cell.toFixed(1)}px）でタップすると、置かずに いりぐちへ寄る（1 マス ${c1.cell.toFixed(1)}px・いりぐちが地図の中・ヒント「${await txt(page, '#toolHint')}」・お金 ${m0} のまま）`, c0.cell < 14 && (await st(page)).money === m0 && c1.cell >= 21 && ev.every((e) => e.in) && /いりぐちから みちを ひこう/.test(await txt(page, '#toolHint')), { c0, c1, ev });
      // つながらない みち（地図の真ん中）
      await centerOn(page, run.x + 4, run.y);
      await tapCell(page, run.x, run.y);
      const u1 = await cellUse(page, run.x, run.y);
      check(`寄ってタップで 1 マス（みち use=${L.USE.ROAD}）・お金が 10 減る・つながって いないので「${await txt(page, '#toolHint')}」`, u1.use === L.USE.ROAD && (await st(page)).money === m0 - 10 && /いりぐちと つながって いないよ/.test(await txt(page, '#toolHint')), { u1, money: (await st(page)).money });
      await wait(page, 700);
      const cf = await camera(page);
      check(`つながっていないとき、いりぐちと つながった みち（ここでは いりぐち）へ寄る（真ん中 ${cf.cx.toFixed(1)},${cf.cy.toFixed(1)}）`, (await entryView(page)).every((e) => e.in), cf);
      await centerOn(page, run.x + 4, run.y);
      const d = await dragCells(page, run.x + 1, run.y, run.x + 6, run.y);
      const pv = await page.evaluate(() => window.__machi.render.stats());
      await wait(page, 50);
      check(`なぞっている間は、まだ置かれない（お金が変わらない）・札「${pv.preview}」に「つながって いないよ」`, (await st(page)).money === m0 - 10 && (await cellUse(page, run.x + 3, run.y)).use === 0 && /みち 6マス（つながって いないよ）/.test(pv.preview || ''), pv);
      await d.up();
      const placed = await Promise.all([1, 2, 3, 4, 5, 6].map((k) => cellUse(page, run.x + k, run.y)));
      check(`指を離すと まっすぐ 6 マス置かれる（use=${placed.map((p) => p.use).join(',')}）・お金が 60 減る（${(await st(page)).money}）`, placed.every((p) => p.use === L.USE.ROAD) && (await st(page)).money === m0 - 70, { placed, money: (await st(page)).money, pv });
      await pick(page, 'erase');
      await centerOn(page, run.x + 4, run.y);
      await tapCell(page, run.x + 6, run.y);
      check(`こわす：置いて 5 秒以内なら全部返る（お金 ${(await st(page)).money}）`, (await cellUse(page, run.x + 6, run.y)).use === 0 && (await st(page)).money === m0 - 60, await st(page));
      await pick(page, 'home');
      await centerOn(page, run.x + 4, run.y);
      await tapCell(page, run.x + 7, run.y);
      check(`すむ を置ける（use=すむ・お金 20 減る）・つながっていない みちの そばなので「${await txt(page, '#toolHint')}」`, (await cellUse(page, run.x + 7, run.y)).use === L.USE.HOME && (await st(page)).money === m0 - 80 && /いりぐちと つながって いないよ/.test(await txt(page, '#toolHint')), await cellUse(page, run.x + 7, run.y));
      // 置けない理由の出し分け
      const why = [];
      for (const [nm, c, re] of [['うみ', sea, /うみには おけないよ/], ['やま', mtn, /やまには おけないよ/], ['かわ', riv, /かわには みち・せんろ だけ/], ['もう ある', { x: run.x + 7, y: run.y }, /もう おいてあるよ/]]) {
        await centerOn(page, c.x, c.y);
        const pv2 = await (async () => { const dd = await dragCells(page, c.x, c.y, c.x, c.y, 1); const r = await page.evaluate(() => window.__machi.render.stats().preview); await dd.up(); return r; })();
        await tapCell(page, c.x, c.y);
        const h = await txt(page, '#toolHint');
        why.push({ nm, h, pv: pv2, ok: re.test(h) });
      }
      check(`置けない理由をヒントで出し分ける（${why.map((w) => `${w.nm}「${w.h}」`).join('・')}）`, why.every((w) => w.ok), why);
      // いりぐちから みち を引くと つながる → 印が消え、帯が変わる、引いた絵のタップは押した所へ寄る
      await pick(page, 'road');
      await centerOn(page, ent.x, ent.y + 4);
      const de = await dragCells(page, ent.x, ent.y + 1, ent.x, ent.y + 6); const pve = await page.evaluate(() => window.__machi.render.stats().preview); await de.up();
      await wait(page, 400);
      check(`いりぐちから引いた みちは つながる（札「${pve}」・ヒントは警告なし・いりぐちの印が消える・帯「${await txt(page, '#newsText')}」）`, !/つながって いない/.test(pve || '') && !/つながって いない/.test(await txt(page, '#toolHint')) && (await page.evaluate(() => window.__machi.render.entryCells())) === null && (await txt(page, '#newsText')) !== ENTRY_GOAL, { pve, hint: await txt(page, '#toolHint') });
      await centerOn(page, 32, 39, 8);
      const [qx, qy] = await pxOf(page, 40, 50);
      await page.mouse.click(qx, qy); await wait(page, 700);
      const c2 = await camera(page);
      check(`みちが つながったあとは、引いた絵のタップで押した所へ寄る（「ちかくで おいてね」・真ん中 ${c2.cx.toFixed(1)},${c2.cy.toFixed(1)}）`, c2.cell >= 21 && /ちかくで おいてね/.test(await txt(page, '#toolHint')) && Math.abs(c2.cx - 40.5) < 3 && Math.abs(c2.cy - 50.5) < 3, c2);
      await dbg(page, 'addmoney', { n: -((await st(page)).money - 5) });
      await pick(page, 'work');
      const mm = (await st(page)).money;
      await centerOn(page, run.x + 4, run.y);
      await tapCell(page, run.x + 6, run.y);
      check(`お金が足りない（${mm}）と置けず、ヒント「おかねが たりないよ」・お金も変わらない`, (await cellUse(page, run.x + 6, run.y)).use === 0 && (await st(page)).money === mm && /おかねが たりないよ/.test(await txt(page, '#toolHint')), await txt(page, '#toolHint'));
      await pick(page, 'rail');
      check('まち になる前の せんろ は選べない（aria-pressed=false・ヒント「「まち」（1,000 にん）に なると つかえるよ」・data-locked=1）', (await pressed(page, 'rail')) === 'false' && /「まち」（1,000 にん）に なると つかえるよ/.test(await txt(page, '#toolHint')) && (await page.getAttribute('[data-tool="rail"]', 'data-locked')) === '1', await txt(page, '#toolHint'));
      await ctx.close();
    },
  },
  {
    id: 'CW3', tier: 'smoke', title: 'ぼくのまち 保存：置くと 2 秒以内に machi.save を書き、閉じて開き直すと同じ町（置いた みち・お金）、壊れた保存（JSON でない・v:2・長さちがい・範囲外）は落ちずに地形えらびから・元の文字を machi.bak に写す（最初の 1 つだけ残す）・machi.best が最大人口、保存できなくても遊べる',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const s0 = L.newGame(5, 0);
      const run = findRun(L, s0, 5);
      const { ctx, page } = await openM(browser, 'CW3', { v: STD_V(), raw: mkRaw(L, s0), debug: true });
      await pick(page, 'road');
      await centerOn(page, run.x + 2, run.y);
      const d = await dragCells(page, run.x, run.y, run.x + 4, run.y); await d.up();
      const before = await stored(page, 'machi.save');
      await wait(page, 2300);
      const after = await stored(page, 'machi.save');
      const money = (await st(page)).money;
      check('置いたあと 2 秒以内に machi.save が書き換わる', after !== before && JSON.parse(after).v === 1, { len: [before.length, after.length] });
      await page.goto(BASE + 'manifest.webmanifest'); await page.goto(M); await wait(page, 300);
      const roads = await useCount(page, L.USE.ROAD);
      check(`開き直すと同じ町：みち ${roads} マス（いりぐち 3 マスはべつ・置いた 5 マス）・お金 ${(await st(page)).money}（${money}）`, roads === 5 && (await st(page)).money === money, { roads, money });
      // 壊れた保存
      const good = JSON.parse(baseRaw(L));
      const bad = {
        'JSON でない': 'これは壊れた保存{',
        'v:2': JSON.stringify({ ...good, v: 2 }),
        '地形の長さちがい': JSON.stringify({ ...good, terrain: good.terrain.slice(0, 40) }),
        'seed が小数': JSON.stringify({ ...good, seed: 1.5 }),
        'いりぐちなし': JSON.stringify({ ...good, entry: [] }),
      };
      const res = [];
      for (const [name, raw] of Object.entries(bad)) {
        await gotoM(page, { raw, pick: null, items: { 'machi.bak': null } });
        const o = { name, terrain: await vis(page, '#terrainCard'), bak: (await stored(page, 'machi.bak')) === raw, noState: await page.evaluate(() => window.__machi.state === null) };
        res.push(o);
      }
      check(`壊れた保存 ${res.length} 種で落ちず、地形えらびが出て、元の文字を machi.bak に写す`, res.every((r) => r.terrain && r.bak && r.noState), res);
      await gotoM(page, { raw: 'ひとつめ{', pick: null });
      await page.goto(BASE + 'manifest.webmanifest');
      await page.evaluate(() => localStorage.setItem('machi.save', 'ふたつめ{'));
      await page.goto(M); await wait(page, 300);
      check('machi.bak は最初の 1 つだけ残す（2 つ目の壊れた保存で上書きしない）', (await stored(page, 'machi.bak')) === 'ひとつめ{', await stored(page, 'machi.bak'));
      // best
      await gotoM(page, { raw: mkRaw(L, simState(L, 60)), debug: true });
      const stt = await st(page);
      check(`machi.best が最大人口（人口 ${stt.pop}・best ${await stored(page, 'machi.best')}）`, stt.pop > 0 && Number(await stored(page, 'machi.best')) >= stt.pop, { stt, best: await stored(page, 'machi.best') });
      // 保存できなくても遊べる
      await page.evaluate(() => { Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); }; });
      await pick(page, 'green');
      await dbg(page, 'addmoney', { n: 1000 });
      const c = await page.evaluate(() => { const s = window.__machi.state; for (let i = 0; i < s.use.length; i++) if (s.terrain[i] === 0 && s.use[i] === 0) return [i % s.W, (i / s.W) | 0]; return null; });
      await centerOn(page, c[0], c[1]);
      await tapCell(page, c[0], c[1]);
      await wait(page, 3000);
      check('保存が書けなくても（setItem が例外）置けて遊びが続く・画面が壊れない', (await cellUse(page, c[0], c[1])).use === L.USE.GREEN && (await vis(page, '#tools')), await cellUse(page, c[0], c[1]));
      await ctx.close();
    },
  },
  {
    id: 'CW4', tier: 'smoke', title: 'ぼくのまち 画面内（見本 A の並び）：iPhone XS 375×812 で上から 名前の帯・数字・知らせ・地図（高さ 420px 以上）・道具 8 つ（4×2）の順、ボタンは全部画面内・44px 以上・重ならない、横スクロールなし。SE 縦（320×568）でも知らせは地図の外・押せない所・はみ出しが無く、地図は 200px 以上、文字は 12px 以上',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const ctrls = '#backBtn, #nameBtn, [data-cmd="help"], #soundBtn, #moneyBox, #starBox, #viewBtn, [data-cmd="zoom-in"], [data-cmd="zoom-out"], #speedBtns .btn, #tools .tool';
      for (const v of [STD_V(), SE_P()]) {
        const { ctx, page } = await openM(browser, `CW4 ${v.label}`, { v, raw: baseRaw(L) });
        const lp = await layoutProbe(page, ctrls, v.safe, { overlapSel: ctrls, minSel: ctrls });
        check(`${v.label}：操作 ${lp.n} 個が画面内・44px 以上・重ならない・横スクロールなし（はみ出し ${lp.outside.join(' ') || 'なし'}・小さい ${lp.small.join(' ') || 'なし'}・重なり ${lp.overlaps.join(' ') || 'なし'}）`, lp.n >= 20 && lp.outside.length === 0 && lp.small.length === 0 && lp.overlaps.length === 0 && !lp.hscroll, lp);
        const g = await page.evaluate(() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          const tools = [...document.querySelectorAll('#tools .tool')].map((e) => e.getBoundingClientRect());
          const fonts = [...document.querySelectorAll('#stats .lab, #newsText, #dateText, #toolHint, #tools .nm, #speedBtns .btn, #viewBtn, #nameBtn, #backBtn')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => ({ id: e.id || e.className, fs: parseFloat(getComputedStyle(e).fontSize) }));
          const news = r('#newsBar'), map = r('#mapWrap');
          return { top: r('#topBar').bottom, stats: r('#stats').top, statsB: r('#stats').bottom, news: news.top, newsB: news.bottom, mapT: map.top, mapH: map.height, toolsT: r('#tools').top, rows: new Set(tools.map((t) => Math.round(t.top))).size, cols: new Set(tools.map((t) => Math.round(t.left))).size, n: tools.length, small: fonts.filter((f) => f.fs < 12), mapR: map.right, vw: innerWidth, overlayNews: news.top >= map.top - 0.5 && news.bottom > map.top };
        });
        const std = v.w >= 375 && v.h >= 800;
        check(`${v.label}：道具は 8 つ・4 列×2 段、上から 名前の帯 → 数字 → 知らせ（地図の外。UX M7）→ 地図 → 道具の順`, g.n === 8 && g.cols === 4 && g.rows === 2 && g.top <= g.stats + 1 && g.statsB <= g.news + 1 && g.newsB <= g.mapT + 1 && g.mapT < g.toolsT && !g.overlayNews, g);
        check(`${v.label}：地図の高さ ${Math.round(g.mapH)}px（${std ? '420px 以上' : '200px 以上'}）・地図が画面の幅の中`, g.mapH >= (std ? 420 : 200) && g.mapR <= g.vw + 0.5, g);
        check(`${v.label}：文字は 12px 以上（小さい物：${g.small.map((f) => f.id + f.fs).join(' ') || 'なし'}）`, g.small.length === 0, g.small);
        await ctx.close();
      }
    },
  },

  // ================= full =================
  {
    id: 'CW5', tier: 'full', title: 'ぼくのまち 時間・速さ・あそびかた：ふつうで 4 秒に 1 か月、とめる で止まる（置く・しらべるはできる）、はやく で 4 倍、?で あそびかた・開いている間は止まる、日付は「N ねんめ M がつ」、さいしょから（確かめ→地形えらび。「やめる」で続き）',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openM(browser, 'CW5', { raw: baseRaw(L), debug: true });
      const pr = (sp) => page.evaluate((s) => document.querySelector(`#speedBtns [data-speed="${s}"]`).getAttribute('aria-pressed'), sp);
      check('はじめは ふつう が押されている（aria-pressed）', (await pr(1)) === 'true' && (await pr(0)) === 'false' && (await pr(4)) === 'false', null);
      const m0 = (await st(page)).month;
      await wait(page, 4400);
      const m1 = (await st(page)).month;
      check(`ふつう：4.4 秒で 1 か月（${m0} → ${m1}）・日付「${await txt(page, '#dateText')}」`, m1 === m0 + 1 && (await txt(page, '#dateText')) === L.dateText(m1), { m0, m1 });
      await page.click('#speedBtns [data-speed="4"]'); await wait(page, 100);
      const a = (await st(page)).month;
      await wait(page, 4400);
      const b = (await st(page)).month;
      check(`はやく：4.4 秒で 4 か月ぶん（${a} → ${b}）・aria-pressed が はやく`, b - a >= 3 && b - a <= 5 && (await pr(4)) === 'true' && (await pr(1)) === 'false', { a, b });
      await page.click('#speedBtns [data-speed="0"]'); await wait(page, 100);
      const c = (await st(page)).month;
      await wait(page, 6000);
      check(`とめる：6 秒たっても月が進まない（${c}）`, (await st(page)).month === c && (await pr(0)) === 'true', await st(page));
      const run = findRun(L, L.newGame(5, 0), 3);
      await centerOn(page, run.x + 1, run.y);
      await pick(page, 'green');
      const mn = (await st(page)).money;
      await tapCell(page, run.x, run.y);
      check('とめている間も置ける（お金が減り みどり が出る）', (await st(page)).money < mn && (await cellUse(page, run.x, run.y)).use === L.USE.GREEN, await st(page));
      await pick(page, 'green');
      await tapCell(page, run.x + 1, run.y);
      check('道具を選んでいないとき、マスを押すと #infoCard（しらべる）が開いて時間は止まる', (await overlayNow(page)) === 'info' && (await vis(page, '#infoCard')), await overlayNow(page));
      await page.click('#infoCard [data-cmd="close"]'); await wait(page, 100);
      await page.click('#speedBtns [data-speed="1"]'); await wait(page, 100);
      await page.click('[data-cmd="help"]'); await wait(page, 100);
      const m2 = (await st(page)).month;
      await wait(page, 9000);
      check('あそびかたを開いている間は時間が進まない', (await vis(page, '#helpCard')) && (await st(page)).month === m2, await st(page));
      await page.click('[data-cmd="restart-ask"]'); await wait(page, 100);
      check('「さいしょから」で確かめ（#restartCard）が出る', (await vis(page, '#restartCard')) && !(await vis(page, '#helpCard')), await overlayNow(page));
      await page.click('[data-cmd="restart-no"]'); await wait(page, 100);
      check('「やめる」で閉じて続き（町はそのまま）', !(await vis(page, '#restartCard')) && (await st(page)).seed === 5 && (await overlayNow(page)) === null, await st(page));
      await page.click('[data-cmd="help"]'); await page.click('[data-cmd="restart-ask"]'); await page.click('#restartCard [data-cmd="restart"]'); await wait(page, 200);
      check('確かめで「はじめる」→ 地形えらびが出る（保存はまだ変えない）', (await vis(page, '#terrainCard')) && (await stored(page, 'machi.save')) !== null, null);
      await page.click('[data-terrain="2"]'); await wait(page, 200);
      const n = await st(page);
      check(`選びなおすと新しい町（お金 ${n.money}・1 ねんめ 4 がつ・名前は ぼくのまち のまま）`, n.money === L.START_MONEY && n.month === 0 && n.choice === 2 && n.name === 'ぼくのまち', n);
      await ctx.close();
    },
  },
  {
    id: 'CW6', tier: 'full', title: 'ぼくのまち 名前：名前を押すと #nameCard（時間は止まる）、10 文字を超えると切る・空は「ぼくのまち」・前後の空白と改行を取る、「やめる」で変えない、保存されて開き直しても残る、長い名前でも #nameBtn がはみ出さない（SE 縦も）',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openM(browser, 'CW6', { raw: baseRaw(L), debug: true });
      const setName = async (v, ok = true) => {
        await page.click('#nameBtn'); await wait(page, 100);
        await page.fill('#nameInput', v);
        await page.click(ok ? '[data-cmd="name-ok"]' : '[data-cmd="name-cancel"]'); await wait(page, 100);
        return (await st(page)).name;
      };
      await page.click('#nameBtn'); await wait(page, 100);
      const m0 = (await st(page)).month;
      check(`名前を押すと #nameCard が開き、入れ物は maxlength 10・今の名前「${await page.inputValue('#nameInput')}」が入っている`, (await vis(page, '#nameCard')) && (await page.getAttribute('#nameInput', 'maxlength')) === '10' && (await page.inputValue('#nameInput')) === 'ぼくのまち', null);
      await wait(page, 6000);
      check('名前を変えている間は時間が進まない', (await st(page)).month === m0, await st(page));
      await page.click('[data-cmd="name-cancel"]'); await wait(page, 100);
      const rows = [];
      for (const [input, want] of [['ひろしの まち', 'ひろしの まち'], ['あいうえおかきくけこさしす', 'あいうえおかきくけこ'], ['   ', 'ぼくのまち'], ['', 'ぼくのまち'], ['  なみ  ', 'なみ'], ['ABC123', 'ABC123']]) {
        const got = await setName(input);
        rows.push({ input, want, got, ok: got === want, shown: await txt(page, '#nameBtn') });
      }
      check('名前の決まり：10 文字まで・空や空白だけは「ぼくのまち」・前後の空白を取る', rows.every((r) => r.ok && r.shown === r.want), rows);
      await setName('たろうの まち');
      await setName('じゃまな なまえ', false);
      check('「やめる」では変わらない', (await st(page)).name === 'たろうの まち', await st(page));
      await page.click('#nameBtn'); await wait(page, 100);
      await page.fill('#nameInput', 'えんたー'); await page.press('#nameInput', 'Enter'); await wait(page, 100);
      check('Enter でも決まる', (await st(page)).name === 'えんたー' && !(await vis(page, '#nameCard')), await st(page));
      await setName('ほぞんの まち');
      check('名前が machi.save に書かれる', JSON.parse(await stored(page, 'machi.save')).name === 'ほぞんの まち', null);
      await page.goto(BASE + 'manifest.webmanifest'); await page.goto(M); await wait(page, 300);
      check(`開き直しても名前が残る（${await txt(page, '#nameBtn')}）`, (await st(page)).name === 'ほぞんの まち' && (await txt(page, '#nameBtn')) === 'ほぞんの まち', await txt(page, '#nameBtn'));
      await setName('あいうえおかきくけこ');
      for (const v of [STD_V(), SE_P()]) {
        await page.setViewportSize({ width: v.w, height: v.h }); await wait(page, 200);
        const lp = await layoutProbe(page, '#backBtn, #nameBtn, [data-cmd="help"], #soundBtn', v.safe, { overlapSel: '#backBtn, #nameBtn, [data-cmd="help"], #soundBtn', minSel: '#backBtn, [data-cmd="help"], #soundBtn' });
        const nb = await page.evaluate(() => { const b = document.querySelector('#nameBtn'); return { sw: b.scrollWidth, cw: b.clientWidth, h: b.getBoundingClientRect().height }; });
        check(`${v.label}：10 文字の名前でも上の帯が画面内で重ならない（名前の高さ ${Math.round(nb.h)}px・はみ出し ${lp.outside.join(' ') || 'なし'}）`, lp.outside.length === 0 && lp.overlaps.length === 0 && lp.small.length === 0 && nb.h >= 44 - 0.5 && !lp.hscroll, { lp, nb });
      }
      await ctx.close();
    },
  },
  {
    id: 'CW7', tier: 'full', title: 'ぼくのまち 育つ・数字・節目：自動プレイ（greedy）の町を読み込むと ひと・おかね・星が formatPop・formatMoney と一致、まち になっていれば せんろ が選べて ぜいの たかさ（#statusCard）を変えられる、まち になる前は ぜい が選べない、ひと が 1,000 をこえると #rankCard（ごほうび・お祝いのお金）が出て時間が止まる・machi.best が増える',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const s60 = simState(L, 60);
      const { ctx, page } = await openM(browser, 'CW7 a', { raw: mkRaw(L, s60), debug: true });
      await page.click('#speedBtns [data-speed="0"]'); await wait(page, 100);
      const a = await st(page);
      check(`町を読み込むと ひと（${await txt(page, '#popText')}）・おかね（${await txt(page, '#moneyText')}）・日付が logic の表示と一致`, a.pop === s60.pop && a.pop > 0 && (await txt(page, '#popText')) === L.formatPop(s60.pop) && (await txt(page, '#moneyText')) === L.formatMoney(s60.money) && (await txt(page, '#dateText')) === L.dateText(s60.month), { a, pop: s60.pop });
      await page.click('#starBox'); await wait(page, 100);
      check('すみやすさ の欄を押すと #statusCard（わけ・ぜいの たかさ）が開く', (await vis(page, '#statusCard')) && (await txt(page, '#starWhy')).length > 5, await txt(page, '#starWhy'));
      const lock = await page.evaluate(() => [...document.querySelectorAll('#statusCard [data-tax]')].map((b) => ({ t: b.dataset.tax, locked: b.dataset.locked, pressed: b.getAttribute('aria-pressed') })));
      await page.click('#statusCard [data-tax="2"]'); await wait(page, 100);
      check('まち になる前は ぜい（ひくい・たかい）が選べない（data-locked=1・税は ふつう のまま）', lock.filter((x) => x.t !== '1').every((x) => x.locked === '1') && (await st(page)).tax === 1, lock);
      await page.click('#statusCard [data-cmd="close"]');
      await ctx.close();
      // まち になった町
      const sBig = simState(L, 130);
      if (sBig.rank >= 1) {
        const { ctx: c2, page: p2 } = await openM(browser, 'CW7 b', { raw: mkRaw(L, sBig), debug: true });
        await p2.click('#speedBtns [data-speed="0"]'); await wait(p2, 100);
        await pick(p2, 'rail');
        check('まち になっていれば せんろ が選べる（aria-pressed=true・data-locked=0）', (await pressed(p2, 'rail')) === 'true' && (await p2.getAttribute('[data-tool="rail"]', 'data-locked')) === '0', null);
        await p2.click('#starBox'); await wait(p2, 100);
        await p2.click('#statusCard [data-tax="0"]'); await wait(p2, 100);
        check('ぜいの たかさ を ひくい にできる（税 0・aria-pressed）', (await st(p2)).tax === 0 && (await p2.getAttribute('#statusCard [data-tax="0"]', 'aria-pressed')) === 'true', await st(p2));
        await c2.close();
      } else check('（自動プレイ 130 か月で まち になっていない町。ぜいの確かめは省く）', true);
      // 節目：まち（1,000）の直前の町から、はやく で進める
      // 節目：まち（1,000）をこえた町の rank を 0 に戻して読み込む（最初の月の終わりで rank が上がる）
      const full = L.simulate(1, 'greedy', 200, { choice: 0 });
      const mt = full && full.monthsTo && full.monthsTo[1000];
      let near = null;
      if (mt) { near = simState(L, mt + 3); near.rank = 0; near.tax = 1; if (!(near.pop >= 1000)) near = null; }
      if (!near) { check('（1,000 の直前の町を作れなかった。節目の確かめは省く）', true); return; }
      const { ctx: c3, page: p3 } = await openM(browser, 'CW7 c', { raw: mkRaw(L, near), debug: true });
      const b0 = Number(await stored(p3, 'machi.best')) || 0;
      await p3.click('#speedBtns [data-speed="4"]');
      let got = false;
      for (let i = 0; i < 20 && !got; i++) { await wait(p3, 1000); got = (await overlayNow(p3)) === 'rank'; }
      const money0 = (await st(p3)).money;
      check(`ひと が 1,000 をこえると #rankCard（「${await txt(p3, '#rankTitle')}」・${await txt(p3, '#rankBonus')}）が出る`, got && /まち/.test(await txt(p3, '#rankTitle')) && /おいわい/.test(await txt(p3, '#rankBonus')), await txt(p3, '#rankTitle'));
      const mo = (await st(p3)).month;
      await wait(p3, 6000);
      check('節目のカードを開いている間は時間が止まる', (await st(p3)).month === mo, await st(p3));
      await p3.click('#rankCard [data-cmd="close"]'); await wait(p3, 100);
      check(`閉じると続く・machi.best が人口の最大（${b0} → ${await stored(p3, 'machi.best')}）・せんろ が選べる`, !(await vis(p3, '#rankCard')) && Number(await stored(p3, 'machi.best')) >= 1000 && (await st(p3)).rank >= 1 && money0 >= 0, await st(p3));
      await c3.close();
    },
  },
  {
    id: 'CW8', tier: 'full', title: 'ぼくのまち 地図の動かし方：道具なしで 1 本指で なぞると地図が動く、＋−ボタンは 1 段 ×1.6（5〜28px に切る）、2 本指でつまむと広がる（ホイール・CDP タッチ）、道具ありでも 14px 未満では動かす、みち は縦にもなぞれる（まっすぐの長い方）、四角の道具は 8×8 まで、めがね（#viewBtn）で見かたが回る',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const s0 = L.newGame(5, 0);
      const run = findRun(L, s0, 8);
      const vrun = findVRun(L, s0, 6);
      const { ctx, page } = await openM(browser, 'CW8', { raw: mkRaw(L, s0), debug: true });
      await page.click('#speedBtns [data-speed="0"]');
      const c0 = await camera(page);
      await page.click('[data-cmd="zoom-in"]'); await wait(page, 100);
      const c1 = await camera(page);
      await page.click('[data-cmd="zoom-out"]'); await wait(page, 100);
      const c2 = await camera(page);
      check(`＋で ×1.6（${c0.cell.toFixed(2)} → ${c1.cell.toFixed(2)}）、−で戻る（${c2.cell.toFixed(2)}）`, Math.abs(c1.cell / c0.cell - 1.6) < 0.02 && Math.abs(c2.cell - c0.cell) < 0.05, { c0, c1, c2 });
      for (let i = 0; i < 12; i++) await page.click('[data-cmd="zoom-in"]');
      const cm = await camera(page);
      for (let i = 0; i < 12; i++) await page.click('[data-cmd="zoom-out"]');
      const cn = await camera(page);
      check(`拡大は 28px まで（${cm.cell.toFixed(1)}）、縮小は地図が全体に入る所まで（${cn.cell.toFixed(1)}）`, cm.cell <= 28.01 && cm.cell >= 27 && cn.cell <= 5.6 && cn.cell >= 5, { cm, cn });
      await centerOn(page, 32, 39, 22);
      const p0 = await camera(page);
      const b = await page.locator('#mapCanvas').boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 - 66, b.y + b.height / 2 - 44, { steps: 6 }); await page.mouse.up(); await wait(page, 50);
      const p1 = await camera(page);
      check(`道具なしで 1 本指でなぞると地図が動く（中心 ${p0.cx.toFixed(1)},${p0.cy.toFixed(1)} → ${p1.cx.toFixed(1)},${p1.cy.toFixed(1)}。指と同じ向き＝中心が反対へ 3,2 マス）`, Math.abs(p1.cx - p0.cx - 3) < 0.3 && Math.abs(p1.cy - p0.cy - 2) < 0.3, { p0, p1 });
      await page.evaluate(() => { const c = document.querySelector('#mapCanvas'), r = c.getBoundingClientRect(); const o = { deltaY: -200, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }; c.dispatchEvent(new WheelEvent('wheel', o)); });
      await wait(page, 50);
      const p2 = await camera(page);
      check(`ホイール（つまみ）で広がる（${p1.cell.toFixed(1)} → ${p2.cell.toFixed(1)}）`, p2.cell > p1.cell * 1.2, { p1, p2 });
      await centerOn(page, 32, 39, 8);
      await pick(page, 'road');
      const q0 = await camera(page);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2, { steps: 5 }); await page.mouse.up(); await wait(page, 50);
      const q1 = await camera(page);
      check('道具を選んでいても 1 マスが 14px 未満のときは、なぞると地図が動く（置かない）', Math.abs(q1.cx - q0.cx) > 3 && (await st(page)).money === L.START_MONEY, { q0, q1 });
      await centerOn(page, vrun.x, vrun.y + 2, 22);
      const d = await dragCells(page, vrun.x, vrun.y, vrun.x + 1, vrun.y + 5);
      const cells = await useCount(page, L.USE.ROAD);
      await d.up();
      const col = await Promise.all([0, 1, 2, 3, 4, 5].map((k) => cellUse(page, vrun.x, vrun.y + k)));
      check(`みち を斜めになぞると、長い方の向き（縦）にまっすぐ 6 マス（use=${col.map((c) => c.use).join(',')}）。なぞっている間は置かれない（${cells} マス）`, col.every((c) => c.use === L.USE.ROAD) && cells === 0 && (await useCount(page, L.USE.ROAD)) === 6, { col, cells });
      await pick(page, 'road'); await pick(page, 'green');
      await centerOn(page, run.x + 3, run.y - 2, 14.5);
      const m = (await st(page)).money;
      const d2 = await dragCells(page, run.x, run.y - 9, run.x + 8, run.y - 1);
      await d2.up();
      const greens = await useCount(page, L.USE.GREEN);
      check(`みどり を四角になぞると、8×8（64 マス）までで止まる（置けた ${greens} マス・お金 ${m} → ${(await st(page)).money}）。置ける所だけ`, greens > 0 && greens <= 64, { greens });
      const views = [];
      const tips = [];
      for (let i = 0; i < 5; i++) { views.push(await page.getAttribute('#viewBtn', 'aria-label')); await page.click('#viewBtn'); await wait(page, 60); tips.push((await vis(page, '#viewTip')) ? await txt(page, '#viewTip') : null); }
      const names = ['ふつう', 'よごれ', 'こんざつ', 'すみやすさ', 'とちの ねだん'];
      check(`めがね：${views.join(' → ')} →（ふつう に戻る）。押すと札（${tips.join('・')}）`, views.every((v, i) => v === `ちずの みかた：${names[i]}。おすと ${names[(i + 1) % 5]}`) && tips.every((v, i) => v === `みかた：${names[(i + 1) % 5]}`) && /^ちずの みかた：ふつう。/.test(await page.getAttribute('#viewBtn', 'aria-label')), { views, tips });
      await ctx.close();
    },
  },
  {
    id: 'CW9', tier: 'full', title: 'ぼくのまち 市民の声・知らせ・できごと：voice 命令で #voiceBar（顔・ひとこと）が出て 12 秒で消え、場所のある声を押すと地図がそこへ寄る（1 マス 22px 以上・場所が真ん中）、場所の無い声は押すと消える、知らせの帯 #newsText は めあて（「「まち」（1,000 にん）まで あと N にん」）から 事件の文へ変わる、できごと event(festival) で知らせが出る',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const s60 = simState(L, 50);
      const { ctx, page } = await openM(browser, 'CW9', { raw: mkRaw(L, s60), debug: true });
      await page.click('#speedBtns [data-speed="0"]'); await wait(page, 100);
      const goal = await txt(page, '#newsText');
      check(`知らせの帯は めあて（「${goal}」。ランクの名前は「」で囲み人数を添える）`, /^「まち」（1,000 にん）まで あと [\d,]+ にん$/.test(goal), goal);
      const cell = [20, 30];
      const i = cell[1] * L.W + cell[0];
      await dbg(page, 'voice', { why: 'jam', text: 'みちが こんで かよえないなあ', i, good: false });
      await wait(page, 100);
      check(`#voiceBar に声（「${await txt(page, '#voiceText')}」）・顔の絵・44px 以上の高さ・場所のある声は下に「おすと その ばしょへ いくよ」`, (await vis(page, '#voiceBar')) && (await txt(page, '#voiceText')) === 'みちが こんで かよえないなあ' && (await page.evaluate(() => document.querySelector('#voiceBar').getBoundingClientRect().height)) >= 44 - 0.5 && (await vis(page, '#voiceSub')) && (await txt(page, '#voiceSub')) === 'おすと その ばしょへ いくよ', null);
      await page.click('#voiceBar'); await wait(page, 900);
      const c = await camera(page);
      check(`声を押すと、その場所（${cell}）へ地図が寄る（真ん中 ${c.cx.toFixed(1)},${c.cy.toFixed(1)}・1 マス ${c.cell.toFixed(1)}px）`, c.cell >= 21.5 && Math.abs(c.cx - (cell[0] + 0.5)) < 1.5 && Math.abs(c.cy - (cell[1] + 0.5)) < 1.5, c);
      await page.click('#speedBtns [data-speed="0"]');
      await wait(page, 9000);
      check('声は 8 秒では まだ出ている（12 秒。UX L3）', await vis(page, '#voiceBar'), null);
      await wait(page, 4000);
      check('声は 12 秒ほどで消える', !(await vis(page, '#voiceBar')), null);
      await dbg(page, 'voice', { why: 'money', text: 'まちの おさいふが からっぽ みたい', i: -1, good: false });
      check('場所の無い声には「おすと その ばしょへ いくよ」を出さない', !(await vis(page, '#voiceSub')), null);
      await page.click('#voiceBar'); await wait(page, 100);
      check('場所の無い声は、押すと消える（地図は動かない）', !(await vis(page, '#voiceBar')), null);
      const ev = await dbg(page, 'event', { kind: 'festival' });
      await wait(page, 100);
      const news = await txt(page, '#newsText');
      check(`event(festival) で知らせに「${news}」が出る`, !!ev && /おまつり/.test(news), { ev, news });
      await ctx.close();
    },
  },
  {
    id: 'CW10', tier: 'full', title: 'ぼくのまち 戻る・メニュー：地形えらび・あそびかた・遊んでいる途中・名前・おかねのカードのどこからでも a#backBtn が見えて押せてメニューへ戻る。メニューにカード「ぼくのまち」と「しさくちゅう」の札、machi.best の表示（「N にん」・最大の桁・壊れた値は「まだ記録なし」）、SE 幅ではみ出さない、押すとゲームが開く。head の title の直後で debug.js（DG1）・viewport の user-scalable=no・ダブルタップ拡大の抑止',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const html = fs.readFileSync(path.join(root, 'games/machi/index.html'), 'utf8');
      check('<head> の <title> の直後（間は説明のコメントだけ）で ../../common/debug.js を読む（DG1）', /<title>[^<]*<\/title>\s*(?:<!--[\s\S]*?-->\s*)*<script src="\.\.\/\.\.\/common\/debug\.js"><\/script>/.test(html), html.slice(html.indexOf('<title>'), html.indexOf('<title>') + 160));
      check('viewport に user-scalable=no・html と body に touch-action（ダブルタップ拡大の抑止）', /name="viewport"[^>]*user-scalable=no/.test(html) && /html \{[^}]*touch-action: manipulation/.test(html) && /touchAction\s*=\s*"none"/.test(fs.readFileSync(path.join(root, 'games/machi/input.js'), 'utf8')), null);
      const { ctx, page } = await openM(browser, 'CW10', { v: SMOKE_V(), raw: null, seen: false, pick: null });
      const r = {};
      const go = async (name, opts = {}) => {
        const reach = await reachable(page, 'a#backBtn');
        await page.click('a#backBtn'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
        r[name] = reach && page.url() === BASE;
        await gotoM(page, { seen: false, pick: null, ...opts });
      };
      r.terrainOpen = await vis(page, '#terrainCard');
      await go('terrain');
      await gotoM(page, { seen: false, pick: 0 });
      r.helpOpen = (await overlayNow(page)) === 'help';
      await go('help', { seen: true, raw: baseRaw(L), pick: null });
      await page.click('[data-cmd="help"]'); await wait(page, 100);
      await go('help2', { seen: true, raw: baseRaw(L), pick: null });
      await go('play', { seen: true, raw: baseRaw(L), pick: null });
      await page.click('#nameBtn'); await wait(page, 100);
      r.nameOpen = (await overlayNow(page)) === 'name';
      await go('name', { seen: true, raw: baseRaw(L), pick: null });
      await page.click('#moneyBox'); await wait(page, 100);
      r.statusOpen = (await overlayNow(page)) === 'status';
      await go('status', { seen: true, raw: baseRaw(L), pick: null });
      check('どのカード（地形えらび・あそびかた・名前・おかね）を開いていても、a#backBtn が見えて押せ、メニューが開く', Object.values(r).length === 10 && Object.values(r).every(Boolean), r);
      // メニューのカード
      const card = () => page.evaluate(() => {
        const a = document.querySelector('a.game[href="games/machi/"]');
        if (!a) return null;
        const b = a.querySelector('.best b'), q = a.getBoundingClientRect(), cv = a.querySelector('canvas.art');
        let painted = 0;
        if (cv && cv.width > 0) { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) painted++; }
        const tag = a.querySelector('.tag');
        return { name: a.querySelector('.name')?.textContent.trim(), desc: a.querySelector('.desc')?.textContent.trim(), tag: tag ? tag.textContent.trim() : null, tagFs: tag ? parseFloat(getComputedStyle(tag).fontSize) : 0, best: b?.textContent.trim(), none: b?.classList.contains('none'), right: q.right, h: q.height, painted, fit: b ? b.scrollWidth <= b.clientWidth + 0.5 : false, aria: a.getAttribute('aria-label') };
      });
      await seed(page, {});
      await page.goto(BASE); await wait(page, 200);
      const c0 = await card();
      check(`メニューにカード「${c0 && c0.name}」・説明・絵・「しさくちゅう」の札（${c0 && c0.tag}・12px 以上）`, !!c0 && c0.name === L.NAME && !!c0.desc && c0.tag === 'しさくちゅう' && c0.tagFs >= 12 && c0.painted > 500 && c0.h >= 44 && /しさくちゅう/.test(c0.aria), c0);
      check(`記録が無いとき「まだ記録なし」（${c0 && c0.best}）`, c0 && c0.best === 'まだ記録なし' && c0.none === true, c0);
      const rows = [];
      for (const [raw, want] of [['1234', '1,234 にん'], ['9999999', '9,999,999 にん'], ['0', 'まだ記録なし'], ['abc', 'まだ記録なし'], ['-5', 'まだ記録なし'], ['1.5', 'まだ記録なし'], ['', 'まだ記録なし'], ['1e400', 'まだ記録なし']]) {
        await seed(page, { 'machi.best': raw });
        await page.goto(BASE); await wait(page, 150);
        const c = await card();
        rows.push({ raw, want, got: c && c.best, ok: !!c && c.best === want });
      }
      check('machi.best の表示（「1,234 にん」・最大の桁 9,999,999・壊れた値・0 は「まだ記録なし」）でメニューが落ちない', rows.every((x) => x.ok), rows);
      await page.setViewportSize({ width: 320, height: 568 });
      await seed(page, { 'machi.best': '9999999' });
      await page.goto(BASE); await wait(page, 150);
      const cs = await card();
      check('SE 幅：最大の桁でもカード（「しさくちゅう」の札つき）がはみ出さない・省略されない', cs && cs.right <= 320.5 && cs.fit, cs);
      await page.click('a.game[href="games/machi/"]'); await page.waitForURL('**/games/machi/', { timeout: 5000 }).catch(() => {});
      check('メニューのカードを押すとゲームが開く', page.url() === M, page.url());
      await ctx.close();
    },
  },
  {
    id: 'CW11', tier: 'full', audio: true, title: 'ぼくのまち 効果音：道具を選ぶ select・置く place／road／green／erase・足りない deny・遊びの途中の voice・節目 rank が鳴り、すべて "machi" の音の表にあり、最初の 1 回は音の部品が start する。♪でオフにすると鳴らない。音の表に約束 §9 の名前が全部ある',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const s0 = L.newGame(5, 0);
      const run = findRun(L, s0, 6);
      const { ctx, page } = await openM(browser, 'CW11', { raw: mkRaw(L, s0), debug: true, opts: { initScript: SFX_SPY } });
      await page.mouse.click(5, 300).catch(() => {});
      const names = await page.evaluate(() => window.YubiSfx.create('machi').names);
      const want = ['start', 'best', 'toggle', 'select', 'place', 'road', 'rail', 'green', 'erase', 'deny', 'grow', 'rank', 'voice', 'good', 'oops'];
      check(`音の表（machi）に約束 §9 の名前（${want.join('・')}）が全部ある`, want.every((n) => names.includes(n)), names);
      await page.click('#speedBtns [data-speed="0"]');
      await centerOn(page, run.x + 2, run.y);
      // つながらない所に置くと いりぐちへ寄るので、置くたびに寄せ直す
      const at = async (x) => { await centerOn(page, run.x + 2, run.y); await tapCell(page, x, run.y); };
      await pick(page, 'road');
      await at(run.x);
      await pick(page, 'green'); await at(run.x + 2);
      await pick(page, 'home'); await at(run.x + 3);
      await pick(page, 'erase'); await at(run.x + 3);
      await dbg(page, 'addmoney', { n: -((await st(page)).money - 1) });
      await pick(page, 'work'); await at(run.x + 4);
      await dbg(page, 'voice', { why: 'happy', text: 'この まち すきだな', i: -1, good: true });
      await dbg(page, 'event', { kind: 'festival' });
      const ps = await plays(page);
      const got = [...new Set(ps.map((p) => p.n))];
      const need = ['select', 'road', 'green', 'place', 'erase', 'deny', 'voice'];
      check(`鳴った音（${got.join(',')}）に ${need.join('・')} がある`, need.every((n) => got.includes(n)), got);
      const silentNames = got.filter((n) => !ps.some((p) => p.n === n && p.d > 0));
      check(`鳴らした音はすべて "machi" の音の表にあり、どの名前も 1 回以上は音の部品が start した（動かなかった名前：${silentNames.join(',') || 'なし'}）`, ps.every((p) => p.known) && silentNames.length === 0, { silentNames, unknown: ps.filter((p) => !p.known) });
      await page.click('#soundBtn'); await wait(page, 50);
      const n0 = (await plays(page)).length;
      await dbg(page, 'addmoney', { n: 500 });
      await pick(page, 'green'); await at(run.x + 5);
      const ps2 = (await plays(page)).slice(n0);
      check(`♪ でオフにすると、置いても音の部品が動かない（${ps2.map((p) => `${p.n}:${p.d}`).join(',')}）`, ps2.every((p) => p.d === 0), ps2);
      await page.click('#soundBtn');
      await ctx.close();
    },
  },
  {
    id: 'CW12', tier: 'full', flaky: { why: 'CPU 4 倍遅くで重いコマの割合・時間を測る（クラウドの CPU で揺れる。T-34 の形）', checks: /^CPU 4 倍遅く/ }, solo: true, cdp: 'CDP の CPU 低速化', title: 'ぼくのまち 性能（約束 §6.3・tech M3）：自動プレイの大きな町（greedy 20 年）を、CPU 4 倍遅く（CDP）・はやく で、寄って（1 マス 22px）動かし続ける 8 秒の間、コマの間隔（ほしくだき KW10 の数え方）で 34ms を超えるコマ 5% 以下、step 1 回の p95 3ms 以内・最大 50ms 以内、月の終わりの step の中央 16ms 以内、描画 1 コマの中央 8ms 以内。地図の canvas は DPR 2 まで',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const big = simState(L, 240);
      big.speed = 4;
      const { ctx, page } = await openM(browser, 'CW12', { v: STD_V(), raw: mkRaw(L, big), debug: true, opts: { clock: false } });
      // DPR 3 の端末（XS）でも地図の canvas は DPR 2 まで（newPage は DPR 2 なので、ここだけ DPR 3 の窓を別に開く）
      const c3 = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      const p3 = await c3.newPage();
      await p3.goto(BASE + 'manifest.webmanifest');
      await p3.evaluate((raw) => { localStorage.setItem('machi.seen', '1'); localStorage.setItem('machi.save', raw); }, mkRaw(L, big));
      await p3.goto(M); await sleep(500);
      const dprInfo = await p3.evaluate(() => { const c = document.querySelector('#mapCanvas'); return { w: c.width, cssW: c.getBoundingClientRect().width, dpr: devicePixelRatio }; });
      await c3.close();
      check(`DPR 3 の端末でも地図の canvas は DPR 2 まで（canvas ${dprInfo.w}px ÷ css ${Math.round(dprInfo.cssW)}px・端末 ${dprInfo.dpr}）`, dprInfo.dpr === 3 && Math.abs(dprInfo.w / dprInfo.cssW - 2) < 0.02, dprInfo);
      await page.evaluate(() => window.__machi.render.setCamera({ cx: 32, cy: 39, cell: 22 }));
      await sleep(1500);
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await sleep(300);
      const a = await page.evaluate(() => window.__machi.render.stats());
      await page.evaluate(() => {
        window.__panStop = false; let t = 0;
        const R = window.__machi.render;
        (function tick() { if (window.__panStop) return; t += 1; R.panBy(Math.sin(t / 40) * 6, Math.cos(t / 55) * 6); requestAnimationFrame(tick); })();
      });
      await sleep(8000);
      const b = await page.evaluate(() => { window.__panStop = true; return window.__machi.render.stats(); });
      const sm = await dbg(page, 'stats');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const frames = b.ticks - a.ticks, slow = (b.slowFrames || 0) - (a.slowFrames || 0);
      check(`CPU 4 倍遅く 8 秒：コマの間隔で ${frames} コマのうち 34ms を超えたのは ${slow}（${(slow / Math.max(1, frames) * 100).toFixed(1)}%、5% 以下。間隔の中央 ${b.gapMed}ms・p95 ${b.gapP95}ms・最大 ${b.gapMax}ms）`, frames >= 200 && slow / frames <= 0.05, { frames, slow, b });
      check(`CPU 4 倍遅く：step 1 回の p95 ${sm.stepMsP95}ms（3ms 以内）・最大 ${sm.stepMsMax}ms（50ms 以内）・中央 ${sm.stepMsMed}ms`, sm.stepMsP95 <= 3 && sm.stepMsMax <= 50, sm);
      check(`CPU 4 倍遅く：月の終わりの step ${sm.monthN} 回の中央 ${sm.monthMsMed}ms（16ms 以内）・最大 ${sm.monthMsMax}ms`, sm.monthN >= 3 && sm.monthMsMed <= 16, sm);
      check(`CPU 4 倍遅く：描画 1 コマの中央 ${b.drawMsMed}ms（8ms 以内）`, b.drawMsMed <= 8, b);
      await ctx.close();
    },
  },
  {
    id: 'CW13', tier: 'full', title: 'ぼくのまち 中断：hidden で止まり（月が進まない）、pagehide で保存し、pageshow で戻ると動き出す。閉じていた間の時間は進めない（時計が大きく進んでも戻っても月が飛ばない）',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openM(browser, 'CW13', { raw: baseRaw(L), debug: true });
      await wait(page, 1000);
      const m0 = (await st(page)).month;
      const f0 = (await dbg(page, 'stats')).render.frames;
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const s1 = await stored(page, 'machi.save');
      await wait(page, 10000);
      const f1 = (await page.evaluate(() => window.__machi.render.stats().frames));
      check(`hidden の間は止まる（描画が進まない ${f0} → ${f1}・月も同じ）`, (await st(page)).month === m0 && f1 === f0, { f0, f1 });
      check('hidden にしたとき machi.save を書く', !!s1 && JSON.parse(s1).v === 1, null);
      await page.clock.setSystemTime(Date.now() + 3 * 3600 * 1000).catch(() => {});
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await wait(page, 300);
      const m2 = (await st(page)).month;
      check(`3 時間たったことにして戻っても、月は飛ばない（${m0} → ${m2}）`, m2 - m0 <= 1, { m0, m2 });
      await wait(page, 4500);
      check('戻ると動き出す（月が進む）', (await st(page)).month > m2, await st(page));
      await ctx.close();
    },
  },
  {
    id: 'CW14', tier: 'full', title: 'ぼくのまち オフライン：sw.js の APP_FILES に games/machi/ の全ファイルがあり、接続を切っても開いて遊べ（置ける）、部品は Service Worker から読まれ、メニューに戻れる',
    async run({ browser, check, srv, root }) {
      const L = logicOf(root);
      const info = swInfo(root);
      const dir = path.join(root, 'games/machi');
      const actual = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : [];
      const want = [...new Set(['./games/machi/', ...['index.html', 'logic.js', 'sprites.js', 'render.js', 'input.js', 'main.js', ...actual].map((f) => `./games/machi/${f}`)])];
      const missing = want.filter((f) => !info.files.includes(f));
      check(`sw.js の APP_FILES に games/machi/ の ${want.length} 件がすべてある（足りない：${missing.join(' / ') || 'なし'}）`, missing.length === 0 && actual.length >= 6, missing);
      if (missing.length) return;
      srv.reset();
      const s0 = L.newGame(5, 0);
      const run = findRun(L, s0, 3);
      const { ctx, page } = await newPage(browser, custom(390, 844, null, 'iPhone 13'), 'CW14', { sw: true, allowNetErrors: true });
      await page.goto(BASE);
      const ok = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]));
      if (!ok) throw new Error('Service Worker が 8 秒以内に有効にならない（事前キャッシュの install 失敗の可能性）');
      if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }); }
      await page.evaluate(([raw]) => { localStorage.setItem('machi.seen', '1'); localStorage.setItem('machi.save', raw); }, [mkRaw(L, s0)]);
      await sleep(200);
      await srv.ctl('offline=1');
      const resp = [];
      page.on('response', (r) => { if (/\/games\/machi\/|\/common\/sfx\.js/.test(r.url())) resp.push({ f: r.url().split('/').slice(-2).join('/'), status: r.status(), sw: r.fromServiceWorker() }); });
      await page.goto(M, { timeout: 10000 }); await sleep(600);
      const libs = await page.evaluate(() => ({ L: typeof window.MachiLogic?.step, S: typeof window.MachiSprites?.paint, R: typeof window.MachiRender?.create, I: typeof window.MachiInput?.attach, Y: typeof window.YubiSfx?.create, G: typeof window.__machi?.saveNow }));
      check('オフラインで開き、MachiLogic・MachiSprites・MachiRender・MachiInput・YubiSfx・main.js が使える', Object.values(libs).every((x) => x === 'function'), libs);
      const js = ['logic.js', 'sprites.js', 'render.js', 'input.js', 'main.js', 'common/sfx.js'].map((f) => ({ f, hit: resp.find((r) => r.f.endsWith(f)) }));
      check('logic.js・sprites.js・render.js・input.js・main.js・sfx.js を Service Worker から 200 で読んだ', js.every((x) => x.hit && x.hit.sw && x.hit.status === 200), { js, resp });
      if (libs.G === 'function') {
        await page.evaluate(([x, y]) => window.__machi.render.setCamera({ cx: x + 0.5, cy: y + 0.5, cell: 22 }), [run.x, run.y]);
        await sleep(100);
        await page.click('[data-tool="green"]');
        const [px, py] = await pxOf(page, run.x, run.y);
        await page.mouse.click(px, py); await sleep(200);
        check('オフラインで遊べる（みどり を置ける）', (await cellUse(page, run.x, run.y)).use === L.USE.GREEN, await cellUse(page, run.x, run.y));
      }
      await page.click('a#backBtn'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('オフラインのまま、メニューに戻れる', page.url() === BASE && (await page.locator('a.game').count()) >= 2, page.url());
      await srv.ctl('offline=0');
      await ctx.close();
    },
  },
  {
    id: 'CW15', tier: 'full', title: 'ぼくのまち 古いページから書き戻さない（X-20。ほかの ゲームと同じ tests/lib.mjs の x20Run）：bfcache から戻ったとき保存がほかで変わっていたら書かずに 1 回だけ開き直して今の保存から続ける（知らせ X-24）、変わっていなければ開き直さない。裏にいる間に別のタブが machi.save を書いたら hidden・pagehide・保存で書き戻さず、表に戻ると開き直す。storage イベントが届かないまま閉じても書き戻さない',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const mk = (money) => { const s = L.newGame(5, 0); s.money = money; return mkRaw(L, s); };
      const fp = (raw) => { try { return JSON.parse(raw).money; } catch { return null; } };
      const { ctx, page } = await openM(browser, 'CW15', { raw: mk(1111), opts: { clock: true } });
      const r = await x20Run(page, ctx, { key: 'machi.save', newer: [mk(2222), mk(3333), mk(4444), mk(5555)], fp, hiddenWrite: (p) => p.evaluate(() => window.__machi.saveNow()) });
      check(x20Text(r), r.ok, r);
      await ctx.close();
    },
  },
  {
    id: 'CW16', tier: 'full', title: 'ぼくのまち 手がかり（UX M5〜M7・L1・tech A6・A12）：知らせの帯は文の長さ（1 行・2 行・とても長い）で高さが変わらず地図がずれない（375×812・SE 縦。SE 縦でも地図の外）、道具のヒントの長さでも地図がずれない、めがねの凡例（色と模様の 3 段・次の種類）、しらべるカードの数字に ひくい・ふつう・たかい と ○▲✕・よごれが高いと「みどりを ちかくに おくと へるよ」、まちの ようす の「」つきの大きさと × で閉じる、さいしょからの地形えらびに「やめる（いまの まちに もどる）」と Escape、とめていて変わる物が無いと rAF を休み、触ると起きる',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const big = simState(L, 240);
      for (const v of [STD_V(), SE_P()]) {
        const { ctx, page } = await openM(browser, `CW16 ${v.label}`, { v, raw: mkRaw(L, big), debug: true });
        await page.click('#speedBtns [data-speed="0"]'); await wait(page, 100);
        const geo = () => page.evaluate(() => { const m = document.querySelector('#mapWrap').getBoundingClientRect(), n = document.querySelector('#newsBar').getBoundingClientRect(), t = document.querySelector('#newsText').getBoundingClientRect(); return { mapT: m.top, mapH: m.height, newsH: n.height, newsB: n.bottom, textB: t.bottom, text: document.querySelector('#newsText').textContent }; });
        const g0 = await geo();
        await dbg(page, 'event', { kind: 'festival' }); await wait(page, 100);
        const g1 = await geo();
        await page.evaluate(() => { document.querySelector('#newsText').textContent = 'かじが あったけど みんな ぶじだよ。また たてられるよ。とても ながい おしらせが きても ちずは うごかないよ。さらに ながく ながく つづく ぶん'; });
        await wait(page, 100);
        const g2 = await geo();
        const same = [g1, g2].every((g) => Math.abs(g.mapT - g0.mapT) < 0.5 && Math.abs(g.mapH - g0.mapH) < 0.5 && Math.abs(g.newsH - g0.newsH) < 0.5 && g.textB <= g.newsB + 0.5);
        check(`${v.label}：知らせの帯の文が 1 行（${g0.text}）・できごと（${g1.text}）・とても長い文でも、帯の高さ ${Math.round(g0.newsH)}px と地図の位置（上 ${Math.round(g0.mapT)}px・高さ ${Math.round(g0.mapH)}px）が変わらない・文は帯の中・帯は地図の外`, same && g0.newsB <= g0.mapT + 0.5, { g0, g1, g2 });
        const h0 = await geo();
        await pick(page, 'shop'); await wait(page, 50);
        const h1 = await geo();
        await pick(page, 'rail'); await wait(page, 50);
        const h2 = await geo();
        check(`${v.label}：道具のヒントの文（「${await txt(page, '#toolHint')}」など）の長さでも地図がずれない・ヒントは 1 行`, [h1, h2].every((g) => Math.abs(g.mapT - h0.mapT) < 0.5 && Math.abs(g.mapH - h0.mapH) < 0.5) && (await page.evaluate(() => document.querySelector('#toolHint').getBoundingClientRect().height)) < 24, { h0, h1, h2 });
        await ctx.close();
      }
      const { ctx, page } = await openM(browser, 'CW16', { v: STD_V(), raw: mkRaw(L, big), debug: true });
      await page.click('#speedBtns [data-speed="0"]'); await wait(page, 100);
      // めがねの凡例
      check('ふつうの見かたでは凡例を出さない', !(await vis(page, '#viewLegend')), null);
      await page.click('#viewBtn'); await wait(page, 60);
      const lg = await page.evaluate(() => { const e = document.querySelector('#viewLegend'), r = e.getBoundingClientRect(), b = document.querySelector('#viewBtn').getBoundingClientRect(), m = document.querySelector('#mapWrap').getBoundingClientRect(); return { text: e.textContent, sw: [...e.querySelectorAll('.sw')].map((s) => ({ lv: s.dataset.lv, mark: s.textContent, bg: getComputedStyle(s).backgroundColor })), inMap: r.left >= m.left && r.right <= m.right && r.top >= m.top, overBtn: !(r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom), fs: parseFloat(getComputedStyle(e).fontSize) }; });
      check(`めがね よごれ：凡例「${lg.text}」（色 3 つ・模様 なし／点／✕ の 3 段・12px 以上・ボタンに重ならない）・ボタンの名前「${await page.getAttribute('#viewBtn', 'aria-label')}」`, /よごれ：/.test(lg.text) && /すくない/.test(lg.text) && /すこし（てん）/.test(lg.text) && /おおい（✕）/.test(lg.text) && lg.sw.length === 3 && new Set(lg.sw.map((s) => s.bg)).size === 3 && lg.sw.map((s) => s.mark).join('|') === '|・|✕' && lg.inMap && !lg.overBtn && lg.fs >= 12 && /おすと こんざつ$/.test(await page.getAttribute('#viewBtn', 'aria-label')), lg);
      const legs = [];
      for (let k = 0; k < 3; k++) { await page.click('#viewBtn'); await wait(page, 60); legs.push(await txt(page, '#viewLegend')); }
      check(`こんざつ・すみやすさ・とちの ねだん にも凡例（${legs.join(' / ')}）`, /みち：.*すいている.*こみぎみ.*こんざつ/.test(legs[0]) && /すみやすさ：.*たかい.*ふつう.*ひくい/.test(legs[1]) && /とちの ねだん：.*たかい.*ふつう.*ひくい/.test(legs[2]), legs);
      await page.click('#viewBtn'); await wait(page, 60);
      check('ふつうに戻ると凡例が消える', !(await vis(page, '#viewLegend')) && /^ちずの みかた：ふつう。/.test(await page.getAttribute('#viewBtn', 'aria-label')), null);
      // しらべるカード
      const home = await page.evaluate(() => { const s = window.__machi.state; for (let i = 0; i < s.use.length; i++) if (s.use[i] === 5 && s.lvl[i] > 0) { const x = i % s.W, y = (i / s.W) | 0; s.poll[(y >> 2) * (s.W >> 2) + (x >> 2)] = 90; return [x, y]; } return null; });
      if (!home) throw new Error('すむ の建物が無い');
      await centerOn(page, home[0], home[1]);
      await tapCell(page, home[0], home[1]);
      const info = { list: await txt(page, '#infoList'), why: await txt(page, '#infoWhy') };
      check(`しらべる（すむ）：数字に ひくい・ふつう・たかい と ○▲✕（「${info.list}」）・よごれが高いと「${info.why}」`, (info.list.match(/（(ひくい|ふつう|たかい) [○▲✕]）/g) || []).length >= 3 && /よごれ ?90（たかい ✕）/.test(info.list) && /みどりを ちかくに おくと へるよ/.test(info.why), info);
      await page.click('#infoCard [data-cmd="close"]'); await wait(page, 100);
      // まちの ようす
      await page.click('#moneyBox'); await wait(page, 100);
      const stt = await txt(page, '#statusList');
      check(`まちの ようす：「まちの おおきさ」は「」つき・つぎの大きさに人数（「${stt}」）・「いちばん おおかった ひと」`, /まちの おおきさ ?「(むら|まち|し)」/.test(stt) && /「(まち|し|おおきな し)」（[\d,]+ にん）まで あと [\d,]+ にん/.test(stt) && /いちばん おおかった ひと/.test(stt), stt);
      check('まちの ようす の右上の × が押せて閉じる（SE 横で下の「とじる」が隠れても閉じられる）', await reachable(page, '#statusCard .xbtn'), null);
      await page.click('#statusCard .xbtn'); await wait(page, 100);
      check('× で閉じる', (await overlayNow(page)) === null, await overlayNow(page));
      // さいしょから → 地形えらびから もどる
      const seed0 = (await st(page)).seed;
      await page.click('[data-cmd="help"]'); await page.click('[data-cmd="restart-ask"]'); await page.click('#restartCard [data-cmd="restart"]'); await wait(page, 200);
      check('さいしょからの地形えらびに「やめる（いまの まちに もどる）」が出る', (await vis(page, '#terrainCard')) && (await vis(page, '[data-cmd="terrain-cancel"]')), null);
      await page.click('[data-cmd="terrain-cancel"]'); await wait(page, 100);
      check('「やめる」で いまの町に戻る（同じ種・カードなし）', (await overlayNow(page)) === null && (await st(page)).seed === seed0, await st(page));
      await page.click('[data-cmd="help"]'); await page.click('[data-cmd="restart-ask"]'); await page.click('#restartCard [data-cmd="restart"]'); await wait(page, 200);
      await page.keyboard.press('Escape'); await wait(page, 100);
      check('Escape でも いまの町に戻る', (await overlayNow(page)) === null && (await st(page)).seed === seed0, await st(page));
      // rAF を休む
      await page.click('#speedBtns [data-speed="0"]');
      await wait(page, 5000);
      const f0 = await page.evaluate(() => window.__machi.render.stats().ticks);
      await wait(page, 2000);
      const f1 = await page.evaluate(() => window.__machi.render.stats().ticks);
      check(`とめていて変わる物が無いと rAF を休む（resting・2 秒で コマ ${f0} → ${f1}）`, (await page.evaluate(() => window.__machi.resting)) === true && f1 - f0 <= 2, { f0, f1 });
      const cz0 = await camera(page);
      await page.click('[data-cmd="zoom-in"]'); await wait(page, 300);
      const f2 = await page.evaluate(() => window.__machi.render.stats().ticks);
      check('触ると起きて動く（＋で広がる・コマが進む）', (await page.evaluate(() => window.__machi.resting)) === false && f2 > f1 && (await camera(page)).cell > cz0.cell, { f1, f2 });
      await ctx.close();
    },
  },
  {
    id: 'CW17', tier: 'full', title: 'ぼくのまち せんろ の知らせ と めがね（ユーザー「入り口とつながっていないと出ます」「上の汚れとか出てくるやつこれが1部と被ってちょっと見づらい」。計画書 docs/plans/machi-rail-view.md）：375×812 と SE 縦（動きを減らす設定）で、せんろ をはじめて選ぶと説明 2 つを 6 秒ずつ・1 行に収まる、せんろ のそばに すむ を置くと「せんろ だけでは そだたないよ。みちも ひいてね」（1 行）・しらべる の わけ も同じ、めがねは 44×44 の絵だけ・押すと「みかた：○○」を 3 秒・凡例と ほかの重ね物（ズーム・速さ・声・拡大のヒント）に重ならず地図の中',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const RT = 'せんろ だけでは そだたないよ。みちも ひいてね';
      const TIP1 = 'せんろ＝はなれた みちどうしを つなぐよ', TIP2 = 'そばに みちも いるよ。みちの うえにも ひけるよ';
      const s0 = L.newGame(5, 0);
      s0.rank = 1; s0.money = 50000;
      const run = findRun(L, s0, 12);
      for (let k = 0; k < 12; k++) s0.use[run.y * L.W + run.x + k] = L.USE.RAIL;   // いりぐちと つながらない せんろ（みち は無い）
      let hc = null;
      for (const dy of [1, -1, 2, -2]) { const x = run.x + 6, y = run.y + dy; if (freeCell(L, s0, y * L.W + x)) { hc = { x, y }; break; } }
      if (!hc) throw new Error('せんろ のそばに空いた へいち が無い');
      const fits = (p) => p.evaluate(() => { const e = document.querySelector('#toolHint'); return { sw: e.scrollWidth, cw: e.clientWidth, h: e.getBoundingClientRect().height, t: e.textContent }; });
      const over = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
      for (const [v, rm] of [[STD_V(), 'no-preference'], [SE_P(), 'reduce']]) {
        const { ctx, page } = await openM(browser, `CW17 ${v.label}`, { v, raw: mkRaw(L, s0), debug: true, opts: { reducedMotion: rm } });
        await page.click('#speedBtns [data-speed="0"]'); await wait(page, 100);
        // せんろ の説明（2 つを 6 秒ずつ）
        await pick(page, 'rail');
        const t1 = await fits(page);
        await wait(page, 6300);
        const t2 = await fits(page);
        await wait(page, 6300);
        const t3 = await fits(page);
        check(`${v.label}：せんろ をはじめて選ぶと「${t1.t}」→ 6 秒 →「${t2.t}」→ 6 秒 →「${t3.t}」。どれも 1 行に収まる（はば ${t1.sw}/${t1.cw}・${t2.sw}/${t2.cw}）`, t1.t === TIP1 && t2.t === TIP2 && /せんろ 1 マス 40/.test(t3.t) && [t1, t2].every((f) => f.sw <= f.cw + 1 && f.h < 24), { t1, t2, t3 });
        await pick(page, 'rail'); await pick(page, 'rail');
        check(`${v.label}：2 回目は説明を出さない（「${(await fits(page)).t}」）`, /せんろ 1 マス 40/.test((await fits(page)).t), null);
        // せんろ のそばに すむ
        await pick(page, 'home'); await wait(page, 6300);
        await centerOn(page, hc.x, hc.y);
        await tapCell(page, hc.x, hc.y);
        const h = await fits(page);
        check(`${v.label}：せんろ のそば（みち なし）に すむ を置くと札「${h.t}」・赤・1 行に収まる（はば ${h.sw}/${h.cw}）`, (await cellUse(page, hc.x, hc.y)).use === L.USE.HOME && h.t === RT && (await page.getAttribute('#toolHint', 'data-warn')) === '1' && h.sw <= h.cw + 1 && h.h < 24, h);
        await pick(page, 'home');   // 選ばない（しらべる）
        await centerOn(page, hc.x, hc.y);
        await tapCell(page, hc.x, hc.y); await wait(page, 100);
        const why = await txt(page, '#infoWhy');
        check(`${v.label}：しらべる の わけ「${why}」に せんろ の言葉・「いりぐちと つながって いない」は出さない`, why.includes(RT) && !/いりぐちと つながって いない/.test(why), why);
        await page.click('#infoCard [data-cmd="close"]'); await wait(page, 100);
        // めがね
        const b0 = await page.evaluate(() => { const b = document.querySelector('#viewBtn'), r = b.getBoundingClientRect(); return { w: r.width, h: r.height, text: b.textContent.trim(), svg: !!b.querySelector('svg'), label: b.getAttribute('aria-label') }; });
        check(`${v.label}：めがねは ${Math.round(b0.w)}×${Math.round(b0.h)}（44 以上・60 以下）・文字なしの絵（svg）・名前「${b0.label}」・はじめは札を出さない`, b0.w >= 44 && b0.h >= 44 && b0.w <= 60 && b0.h <= 60 && b0.text === '' && b0.svg && b0.label === 'ちずの みかた：ふつう。おすと よごれ' && !(await vis(page, '#viewTip')) && (await reachable(page, '#viewBtn')), b0);
        await dbg(page, 'voice', { why: 'jam', text: 'みちが こんで いるよ' });
        await page.evaluate(() => { document.querySelector('#zoomHint').hidden = false; });
        const names = ['よごれ', 'こんざつ', 'すみやすさ', 'とちの ねだん', 'ふつう'];
        const geo = [];
        for (const nm of names) {
          await page.click('#viewBtn'); await wait(page, 60);
          geo.push(await page.evaluate((nm) => {
            const R = (s) => { const e = document.querySelector(s); return e && !e.closest('[hidden]') && e.getBoundingClientRect().width > 0 ? e.getBoundingClientRect().toJSON() : null; };
            return { nm, tip: R('#viewTip'), text: document.querySelector('#viewTip').textContent, leg: R('#viewLegend'), btn: R('#viewBtn'), map: R('#mapWrap'), zoom: R('.zoomBtns'), speed: R('#speedBtns'), voice: R('#voiceBar'), zh: R('#zoomHint') };
          }, nm));
        }
        const bad = [];
        for (const g of geo) {
          if (!g.tip || g.text !== `みかた：${g.nm}`) bad.push(`${g.nm}：札「${g.text}」が出ない`);
          if ((g.nm === 'ふつう') !== !g.leg) bad.push(`${g.nm}：凡例 ${g.leg ? 'あり' : 'なし'}`);
          const inMap = (r) => r.left >= g.map.left - 0.5 && r.right <= g.map.right + 0.5 && r.top >= g.map.top - 0.5 && r.bottom <= g.map.bottom + 0.5;
          const tops = [['札', g.tip], ['凡例', g.leg], ['めがね', g.btn]].filter((x) => x[1]);
          for (const [n, r] of tops) if (!inMap(r)) bad.push(`${g.nm}：${n}が地図の外`);
          const all = [...tops, ['ズーム', g.zoom], ['速さ', g.speed], ['声', g.voice], ['拡大のヒント', g.zh]].filter((x) => x[1]);
          for (let a = 0; a < tops.length; a++) for (let c = a + 1; c < all.length; c++) if (over(tops[a][1], all[c][1])) bad.push(`${g.nm}：${tops[a][0]}と${all[c][0]}が重なる`);
        }
        check(`${v.label}：めがねを押すたびに「みかた：○○」の札（${geo.map((g) => g.text).join('・')}）・ふつう以外は凡例。札・凡例・めがね は地図の中で、たがいにも ズーム・速さ・声・拡大のヒント にも重ならない（${bad.join(' ') || 'なし'}）`, bad.length === 0 && geo.every((g) => g.zoom && g.speed), geo);
        const lab = await page.getAttribute('#viewBtn', 'aria-label');
        await wait(page, 2500);
        const still = await vis(page, '#viewTip');
        await wait(page, 700);
        const gone = !(await vis(page, '#viewTip'));
        check(`${v.label}：札は 3 秒出て消える（2.5 秒 ${still ? 'あり' : 'なし'}・3.2 秒 ${gone ? 'なし' : 'あり'}${rm === 'reduce' ? '・動きを減らす設定' : ''}）・名前「${lab}」`, still && gone && lab === 'ちずの みかた：ふつう。おすと よごれ', { still, gone, lab });
        await ctx.close();
      }
    },
  },
];
