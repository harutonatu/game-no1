// KW: ちきゅうを守れ！ほしくだき の画面（games/asteroid/）。契約は docs/asteroid-contract.md（§5 画面・§7 進行・§7.3 テスト用 API・§7.4 デバッグ命令・§8 保存・§11.3 KW・§13 教訓）。
//   画面の DOM は契約 §5.4 だけに頼る：#hud・a#back・#gameTitle・#helpBtn・#soundBtn・#kakera・#starLabel・#starBar・#field・#fieldCanvas・#distance・
//     .wrow[data-slot]・[data-up]・#unlockBtn・#choiceCard・#choiceA・#choiceB・#bounceBanner・#clearBanner・#bossBanner・#endCard・#endOk・#help・#helpOk・#hint・body[data-phase]
//   テスト用の公開 API（§7.3）：window.AsteroidGame = { getState, logic, advance, upgrade, unlock, choose, setState, save }
//   デバッグ命令（§7.4。?debug=1 のときだけ）：YubiDebug.run('win'|'lose'|'gostar'|'addk'|'lv'|'ff'|'rates', …)
//   決まり（組み合わせ担当の注意）：
//     ・数値（星の時間・値段・体力・かけら）は書き込まない。ロジックの数値は調整中（契約 §17）なので、期待値は Node で読んだ logic.js（同じ root）の
//       関数（formatKakera・upCostOf・slotCostOf・progressOf・dpsOf・starInfo）と定数（NAME・ENDING_STAR・BOUNCE_SEC・CLEAR_SEC・KAKERA_MAX など）から作る
//     ・保存を直接書くときは、ゲームのページで書いて reload しない（pagehide で上書きされる）。seed() で中立のページへ移って書いてから開く
//     ・aria-disabled のボタン（足りないときの強くする・ロック中の2択）は locator.click が届かないので、座標で page.mouse.click（clickAt）
//     ・API の choose は 400ms のロックを通らないので、400ms の検査はクリック・キーで行う
//     ・はね返しの「あと N%」は max(1, round((1-broken)×100))
//   無いときに合格にしない（空振りの合格を作らない）：AsteroidGame・YubiDebug が無ければ例外で不合格にする。マスが 0 の状態で「欠けた」を検査しない（§13-8）。
//   smoke：KW1〜KW7。full：KW8〜KW17（KW10・KW17 は CDP なので Chromium だけ、KW14 は AudioContext が要る）。KW15 は NAME とメニューの名前の一致。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BASE, view, custom, newPage, seed, wait, sleep, frozen, layoutProbe, swInfo, touch, SFX_SPY, plays, known } from '../lib.mjs';

const AST = BASE + 'games/asteroid/';
const ASTD = AST + '?debug=1';
const SMOKE_V = () => view('SE', 'p', 'app');
const STD_V = () => view('i13', 'p', 'app');
const HINT_BROKEN = 'ほぞんが よめなかったので さいしょから はじめるよ';   // 契約 §8.3 の決まった言葉
const MY_KEYS = ['asteroid.save', 'asteroid.save.bak', 'asteroid.best', 'asteroid.help'];

// ---------- logic.js（Node）。期待値を作るのに使う ----------
function logicOf(root) {
  const f = path.join(root, 'games/asteroid/logic.js');
  if (!fs.existsSync(f)) throw new Error('games/asteroid/logic.js が無い');
  const L = createRequire(f)(f);
  if (!L || typeof L.loadSave !== 'function' || typeof L.formatKakera !== 'function' || typeof L.upCostOf !== 'function') throw new Error('logic.js が AsteroidLogic を module.exports していない');
  return L;
}

// ---------- 開く ----------
async function openK(browser, label, { v = STD_V(), opts = {}, items = {}, help = true, debug = false } = {}) {
  const { ctx, page } = await newPage(browser, v, label, { clock: true, ...opts });
  await gotoK(page, items, { help, debug });
  return { ctx, page };
}
async function gotoK(page, items = {}, { help = true, debug = false } = {}) {
  await seed(page, { ...(help ? { 'asteroid.help': '1' } : {}), ...items });
  await page.goto(debug ? ASTD : AST); await wait(page, 300);
  const has = await page.evaluate(() => !!window.AsteroidGame && typeof window.AsteroidGame.getState === 'function' && typeof window.AsteroidGame.advance === 'function' && typeof window.AsteroidGame.setState === 'function');
  if (!has) throw new Error('window.AsteroidGame が無い（games/asteroid/main.js が読まれていないか、テスト用 API が未実装）');
  if (debug && !(await page.evaluate(() => !!window.YubiDebug && typeof window.YubiDebug.run === 'function'))) throw new Error('?debug=1 なのに YubiDebug が無い');
}

// ---------- 読む・進める ----------
const gs = (p) => p.evaluate(() => window.AsteroidGame.getState());
const lg = (p) => p.evaluate(() => window.AsteroidGame.logic());
const adv = (p, sec) => p.evaluate((s) => window.AsteroidGame.advance(s), sec);
const txt = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const shown = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && e.getBoundingClientRect().width > 0; }, sel);
const stored = (p, k) => p.evaluate((k) => { try { return localStorage.getItem(k); } catch { return 'ERR'; } }, k);
const attr = (p, sel, a) => p.evaluate(([s, a]) => document.querySelector(s)?.getAttribute(a) ?? null, [sel, a]);
// logic の state を写して直し、setState で戻す（code は l を書きかえる文。L は AsteroidLogic）
async function setL(p, code) {
  const ok = await p.evaluate((code) => { const l = window.AsteroidGame.logic(); new Function('l', 'L', code)(l, window.AsteroidLogic); return window.AsteroidGame.setState(l); }, code);
  if (!ok) throw new Error('setState が受け付けない: ' + code);
}
async function dbg(p, name, args) {
  const r = await p.evaluate(([n, a]) => window.YubiDebug.run(n, a), [name, args]);
  if (!r || !r.ok) throw new Error(`デバッグ命令 ${name} が失敗: ${JSON.stringify(r && r.error)}`);
  return r.result;
}
// 要素の真ん中を座標で押す（aria-disabled のボタンにも届く。actionability の待ちをしない）
async function clickAt(p, sel) {
  const b = await p.locator(sel).first().boundingBox();
  if (!b) throw new Error(`${sel} が見えない（押せない）`);
  await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
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
// advance を少しずつ回して、ロジックの phase（または overlay）が want になるまで進める（最大 maxSec 秒）
async function advUntil(p, want, { step = 0.1, maxSec = 60, key = 'logicPhase' } = {}) {
  return p.evaluate(([want, step, maxSec, key]) => {
    const G = window.AsteroidGame;
    for (let t = 0; t <= maxSec; t += step) { const s = G.getState(); if (s[key] === want) return true; G.advance(step); }
    return G.getState()[key] === want;
  }, [want, step, maxSec, key]);
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
// 1つの要素の文字を、表示された行ごとに分ける（Range で1文字ずつの位置を見る）
const LINES_OF = (sel) => {
  const e = document.querySelector(sel);
  if (!e) return null;
  const lines = [];
  let lastTop = null;
  const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    for (let i = 0; i < n.data.length; i++) {
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
      const q = r.getClientRects()[0];
      if (!q || q.width === 0) continue;
      if (lastTop === null || q.top > lastTop + q.height * 0.5) { lines.push(''); lastTop = q.top; }
      lines[lines.length - 1] += n.data[i];
    }
  }
  return lines.map((s) => s.trim());
};
// 武器を n 枠・Lv lv にする文（setL 用）。武器の id は WEAPONS の順から読む（決め打ちしない）
const ARMS = (n, lv) => `l.slots = L.WEAPONS.slice(0, ${n}).map((w) => ({ id: w.id, lv: ${lv} })); l.offer = null;`;

export const tests = [
  // ================= smoke =================
  {
    id: 'KW1', tier: 'smoke', title: 'ほしくだき 遊べる・表示の一致：開くと撃ち始め（frames・phase fly）、advance でマスが欠けて #kakera が増える。#kakera が formatKakera、行の値段が upCostOf、つよさが dpsOf、#starBar が progressOf().broken、題名が NAME。[data-up] で Lv とつよさが上がり値段ぶん減る。足りないと aria-disabled・「かけらが たりないよ」・ヒント・音 deny で Lv は変わらない',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openK(browser, 'KW1', { v: SMOKE_V(), opts: { initScript: SFX_SPY } });
      await wait(page, 1000);
      const s0 = await gs(page), l0 = await lg(page);
      check(`開くと遊んでいる（phase ${s0.phase}・ほし ${s0.star}・overlay ${s0.overlay}・body[data-phase]=${await page.evaluate(() => document.body.dataset.phase)}）、描き続けている（frames ${s0.frames}）`, s0.phase === 'fly' && s0.star === 1 && s0.overlay === null && s0.frames > 10 && (await page.evaluate(() => document.body.dataset.phase)) === 'fly', s0);
      check(`document.title と #gameTitle の文字が NAME（${L.NAME}）`, (await page.title()) === L.NAME && (await page.evaluate(() => document.querySelector('#gameTitle').textContent)) === L.NAME, [await page.title(), await txt(page, '#gameTitle')]);
      const s1 = await adv(page, 30);
      const l1 = await lg(page);
      const p1 = L.progressOf(l1);
      check(`advance(30) でマスが欠け（残り ${L.progressOf(l0).left} → ${p1.left}・totals.cells ${l1.totals.cells}）、かけらが増える（${l0.kakera} → ${l1.kakera}）、t が 30 秒すすむ（${l0.t.toFixed(1)} → ${l1.t.toFixed(1)}）`,
        p1.left < L.progressOf(l0).left && l1.totals.cells > 0 && l1.kakera > l0.kakera && l1.t - l0.t >= 29.9 && s1.phase === 'fly', { l0: { k: l0.kakera, t: l0.t }, l1: { k: l1.kakera, t: l1.t, cells: l1.totals.cells }, p1 });
      const ui = await page.evaluate(() => ({
        kakera: document.querySelector('#kakera').textContent.trim(),
        cost: document.querySelector('.wrow[data-slot="0"] [data-part="cost"]').textContent.trim(),
        lv: document.querySelector('.wrow[data-slot="0"] [data-part="lv"]').textContent.trim(),
        dps: document.querySelector('.wrow[data-slot="0"] [data-part="dps"]').textContent.trim(),
        bar: document.querySelector('#starBar').getAttribute('aria-valuenow'),
        num: document.querySelector('#starLabel [data-part="num"]').textContent.trim(),
        unlock: document.querySelector('#unlockBtn [data-part="cost"]').textContent.trim(),
      }));
      const want = { kakera: L.formatKakera(l1.kakera), cost: L.formatKakera(L.upCostOf(l1, 0)), lv: 'Lv' + l1.slots[0].lv, dps: String(L.dpsOf(l1, 0)), bar: String(Math.floor(p1.broken * 100)), num: 'ほし ' + l1.star, unlock: L.formatKakera(L.slotCostOf(l1)) };
      check(`表示の一致：#kakera「${ui.kakera}」=formatKakera、値段「${ui.cost}」=upCostOf、「${ui.lv}」、つよさ「${ui.dps}」に dpsOf ${want.dps}、#starBar ${ui.bar}=floor(broken×100) ${want.bar}、「${ui.num}」、あたらしい ぶき「${ui.unlock}」=slotCostOf`,
        ui.kakera === want.kakera && ui.cost === want.cost && ui.lv === want.lv && ui.dps.includes(want.dps) && ui.bar === want.bar && ui.num === want.num && ui.unlock === want.unlock && Number(ui.bar) > 0, { ui, want });
      // 強くする（クリック）。時間を止めて、押す前と後を比べる
      const need = L.upCostOf(l1, 0);
      await setL(page, `l.kakera = ${need * 3};`);
      const up = await frozen(page, async () => {
        const a = await lg(page);
        await clickAt(page, '[data-up="0"]');
        const b = await lg(page);
        const shownCost = await txt(page, '.wrow[data-slot="0"] [data-part="cost"]');
        const shownDps = await txt(page, '.wrow[data-slot="0"] [data-part="dps"]');
        return { a, b, shownCost, shownDps };
      });
      check(`[data-up] を押すと Lv${up.a.slots[0].lv} → Lv${up.b.slots[0].lv}、つよさ ${L.dpsOf(up.a, 0)} → ${L.dpsOf(up.b, 0)}、かけらが値段 ${L.upCostOf(up.a, 0)} ぶん減る（${up.a.kakera} → ${up.b.kakera}）、新しい値段「${up.shownCost}」=upCostOf・つよさ「${up.shownDps}」=dpsOf`,
        up.b.slots[0].lv === up.a.slots[0].lv + 1 && L.dpsOf(up.b, 0) > L.dpsOf(up.a, 0) && up.a.kakera - up.b.kakera === L.upCostOf(up.a, 0) && up.shownCost === L.formatKakera(L.upCostOf(up.b, 0)) && up.shownDps.includes(String(L.dpsOf(up.b, 0))), up);
      // 足りない
      await setL(page, 'l.kakera = 0;');
      await wait(page, 100);
      const n0 = (await plays(page)).length;
      const lv0 = (await lg(page)).slots[0].lv;
      const dis = await attr(page, '[data-up="0"]', 'aria-disabled');
      const label = await txt(page, '[data-up="0"] [data-part="label"]');
      await clickAt(page, '[data-up="0"]'); await wait(page, 100);
      const ps = (await plays(page)).slice(n0).map((x) => x.n);
      const hint = await txt(page, '#hint');
      const lv1 = (await lg(page)).slots[0].lv;
      check(`かけら 0 では [data-up] に aria-disabled="${dis}"・「${label}」、押しても Lv が変わらず（${lv0} → ${lv1}）、ヒント「${hint}」と音 deny（${ps.join(',')}）`, dis === 'true' && label === 'かけらが たりないよ' && lv1 === lv0 && !!hint && ps.includes('deny'), { dis, label, hint, ps });
      await ctx.close();
    },
  },
  {
    id: 'KW2', tier: 'smoke', title: 'ほしくだき 2択：#unlockBtn で slotCostOf を払って #choiceCard（overlay choose・body[data-phase]=choose・持っていない違う2つ）、出た直後 400ms はクリックしても選ばれない、カードの間は場が止まる（advance・実時間で t が進まない）、再読み込みしても同じ候補、選ぶと行が増えて名前が出る',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openK(browser, 'KW2', { v: SMOKE_V() });
      const c = L.slotCostOf(await lg(page));
      await setL(page, `l.kakera = ${c};`);
      await wait(page, 100);
      const dis0 = await attr(page, '#unlockBtn', 'aria-disabled');
      const r = await frozen(page, async () => {
        const a = await lg(page);
        await clickAt(page, '#unlockBtn');
        const b = await lg(page), s = await gs(page);
        const card = await shown(page, '#choiceCard');
        const ph = await page.evaluate(() => document.body.dataset.phase);
        const lockA = await attr(page, '#choiceA', 'aria-disabled');
        await clickAt(page, '#choiceA');     // 出た直後（時間は止まっている＝400ms 以内）
        const c2 = await gs(page);
        return { a, b, s, card, ph, lockA, c2 };
      });
      const offer = r.s.offer;
      check(`かけらが足りると #unlockBtn が押せる（aria-disabled ${dis0}）、押すと slotCostOf ${c} を払って（${r.a.kakera} → ${r.b.kakera}）#choiceCard が出る（overlay ${r.s.overlay}・phase ${r.b.phase}・body ${r.ph}）`, dis0 === null && r.a.kakera - r.b.kakera === c && r.card && r.s.overlay === 'choose' && r.b.phase === 'choose' && r.ph === 'choose', r);
      check(`候補 ${JSON.stringify(offer)} は違う2つで、持っている武器（${r.b.slots.map((x) => x.id)}）ではない`, Array.isArray(offer) && offer.length === 2 && offer[0] !== offer[1] && offer.every((id) => !r.b.slots.some((x) => x.id === id) && L.WEAPONS.some((w) => w.id === id)), offer);
      const nameA = await txt(page, '#choiceA [data-part="name"]'), nameB = await txt(page, '#choiceB [data-part="name"]');
      const wName = (id) => L.WEAPONS.find((w) => w.id === id)?.name;
      check(`カードの名前「${nameA}」「${nameB}」が候補の武器の名前`, nameA === wName(offer[0]) && nameB === wName(offer[1]), { nameA, nameB, offer });
      check(`出た直後は aria-disabled="${r.lockA}" で、クリックしても選ばれない（overlay ${r.c2.overlay}・枠 ${r.c2.slots.length}）`, r.lockA === 'true' && r.c2.overlay === 'choose' && r.c2.slots.length === 1, r.c2);
      const t0 = (await lg(page)).t;
      await adv(page, 5);
      const t1 = (await lg(page)).t;
      await wait(page, 1500);
      const t2 = (await lg(page)).t;
      check(`2択の間は場が止まる（advance(5) で t ${t0.toFixed(2)} → ${t1.toFixed(2)}、実時間 1.5 秒で → ${t2.toFixed(2)}）`, t1 === t0 && t2 === t0, { t0, t1, t2 });
      await page.reload(); await wait(page, 300);
      const s3 = await gs(page);
      check(`再読み込みしても同じ候補（${JSON.stringify(s3.offer)}）でカードが出る（overlay ${s3.overlay}）`, JSON.stringify(s3.offer) === JSON.stringify(offer) && s3.overlay === 'choose' && (await shown(page, '#choiceCard')), s3);
      await pressCard(page, '#choiceB');
      const s4 = await gs(page);
      const row1 = await page.evaluate(() => { const r = document.querySelector('.wrow[data-slot="1"]'); return { hidden: r.hidden || !!r.closest('[hidden]'), name: r.querySelector('[data-part="name"]').textContent.trim(), w: r.dataset.w }; });
      check(`400ms 後に押すと選べる：枠 ${s4.slots.length}・2つ目は ${s4.slots[1] && s4.slots[1].id}（候補 B ${offer[1]}）、行 data-slot=1 が出て名前「${row1.name}」、カードが閉じる`, s4.slots.length === 2 && s4.slots[1].id === offer[1] && s4.slots[1].lv === 1 && !row1.hidden && row1.name === wName(offer[1]) && row1.w === offer[1] && s4.overlay === null && !(await shown(page, '#choiceCard')), { s4, row1 });
      let t5 = t2;
      for (let i = 0; i < 6 && t5 <= t2; i++) { await wait(page, 500); t5 = (await lg(page)).t; }   // 重いときは rAF が遅れるので 3 秒まで待つ
      check(`選んだあとは場が動き出す（t ${t2.toFixed(2)} → ${t5.toFixed(2)}）`, t5 > t2, { t2, t5 });
      await ctx.close();
    },
  },
  {
    id: 'KW3', tier: 'smoke', title: 'ほしくだき はね返し：6 割こわした星を lose でバリアまで下げると phase bounce・#bounceBanner「あと N%」（N = max(1, round((1-broken)×100))）・おすすめの行、かけらと Lv は残る、BOUNCE_SEC 後に実時間で自動で次の挑戦（同じ星・最初から・tries+1・帯が消える）',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openK(browser, 'KW3', { v: SMOKE_V(), debug: true });
      // 星を 6 割こわした状態にする（最初からに戻ったこと・「あと N%」がこわした割合でないことが分かるように）・かけらと Lv を持たせる
      await setL(page, 'const n = l.rock.mats.length; let k = 0; for (let i = 0; i < n && k < l.rock.left * 0.6; i++) if (l.rock.mats[i]) { l.rock.mats[i] = 0; l.rock.hp[i] = 0; k++; } l.kakera = 777; l.slots[0].lv = 3;');
      const r = await frozen(page, async () => {
        await dbg(page, 'lose');
        const a = await lg(page);
        const ok = await advUntil(page, 'bounce', { step: 1 / 30, maxSec: 20 });
        const b = await lg(page);
        return { a, ok, b };
      });
      const pa = L.progressOf(r.a);
      const banner = await txt(page, '#bounceBanner');
      const m = /あと\s*(\d+)\s*%/.exec(banner || '');
      const nWant = Math.max(1, Math.round((1 - pa.broken) * 100));
      check(`lose のあと phase bounce になる（${r.b.phase}）・#bounceBanner が出る「${banner}」`, r.ok && r.b.phase === 'bounce' && (await shown(page, '#bounceBanner')) && /はねかえした/.test(banner || ''), { banner, phase: r.b.phase });
      check(`「あと ${m && m[1]}%」が、とどく直前の broken ${pa.broken.toFixed(3)} から max(1, round((1-broken)×100)) = ${nWant}（届くまでに欠けた分 3 まで小さくてよい）`, !!m && Number(m[1]) <= nWant && Number(m[1]) >= nWant - 3 && pa.broken > 0.3, { banner, nWant, broken: pa.broken });
      check(`かけらと Lv が残る（かけら ${r.a.kakera} → ${r.b.kakera}・Lv${r.b.slots[0].lv}）、同じ星（${r.b.star}）`, r.b.kakera >= r.a.kakera && r.b.slots[0].lv === 3 && r.b.star === r.a.star, { a: r.a.kakera, b: r.b.kakera });
      const sug = await page.evaluate(() => document.querySelectorAll('.wrow[data-suggest="1"]').length);
      check(`はね返しのあと、強くする行を1つ光らせる（.wrow[data-suggest=1] ${sug} 個）`, sug === 1, sug);
      await wait(page, Math.round(L.BOUNCE_SEC * 1000) + 300);
      const c = await lg(page), s = await gs(page);
      const pc = L.progressOf(c);
      check(`BOUNCE_SEC（${L.BOUNCE_SEC} 秒）後、押さなくても次の挑戦（phase ${c.phase}・帯が消える・tries ${r.a.tries} → ${c.tries}）`, c.phase === 'fly' && !(await shown(page, '#bounceBanner')) && c.tries === r.a.tries + 1 && s.overlay === null, { phase: c.phase, tries: c.tries });
      check(`同じ星を最初から（ほし ${c.star}・こわした割合 ${pa.broken.toFixed(2)} → ${pc.broken.toFixed(2)}・地球までの近さ distance ${pc.distance.toFixed(2)}）、Lv${c.slots[0].lv} とかけら ${c.kakera} は残る`, c.star === r.a.star && pc.broken < 0.1 && pc.distance > 0.8 && c.slots[0].lv === 3 && c.kakera >= r.a.kakera, { pc, c: { star: c.star, k: c.kakera } });
      await ctx.close();
    },
  },
  {
    id: 'KW4', tier: 'smoke', title: 'ほしくだき 場を押しても何も起きない：fly・bounce・clear のそれぞれで、時間を止めて #fieldCanvas の真ん中と小惑星の上をクリック・タップ（連打）しても logic() が変わらず、その後の advance も押さない場合と同じ（t・kakera・マス・phase）、効果音も鳴らない、拡大されない',
    async run({ browser, check }) {
      const { ctx, page } = await openK(browser, 'KW4', { v: SMOKE_V(), debug: true, opts: { initScript: SFX_SPY } });
      await page.mouse.click(5, 5).catch(() => {});    // 音の準備（最初の操作）
      await wait(page, 500);
      const pointsOf = () => page.evaluate(() => {
        const L = window.AsteroidLogic, s = window.AsteroidGame.logic();
        const c = document.querySelector('#fieldCanvas').getBoundingClientRect();
        const k = c.width / L.FIELD_W;
        const rock = [c.left + (s.rock.x + s.rock.cols * L.CELL / 2) * k, c.top + (s.rock.y + s.rock.rows * L.CELL / 2) * k];
        const mid = [c.left + c.width / 2, c.top + c.height / 2];
        const inside = (p) => p[0] > c.left && p[0] < c.right && p[1] > c.top && p[1] < c.bottom;
        return { mid, rock: inside(rock) ? rock : [c.left + c.width / 2, c.top + c.height * 0.3] };
      });
      const tapAll = async () => {
        const pt = await pointsOf();
        for (const q of [pt.mid, pt.rock]) {
          for (let i = 0; i < 3; i++) await page.mouse.click(q[0], q[1]);
          for (let i = 0; i < 3; i++) await page.touchscreen.tap(q[0], q[1]);
          await page.mouse.dblclick(q[0], q[1]);
        }
      };
      const runCase = async (name, prepare, sec) => {
        await prepare();
        return frozen(page, async () => {
          const L0 = await lg(page);
          if (L0.phase !== name) return { name, skip: `phase が ${L0.phase}` };
          // 押さない場合（2回やって同じ＝決定的であることも確かめる）
          const ref = await page.evaluate(([l, sec]) => { const G = window.AsteroidGame; const out = []; for (let i = 0; i < 2; i++) { if (!G.setState(l)) return null; G.advance(sec); out.push(JSON.stringify(G.logic())); } return out; }, [L0, sec]);
          if (!ref) return { name, skip: 'setState が受け付けない' };
          // 押す場合
          await page.evaluate((l) => window.AsteroidGame.setState(l), L0);
          const before = JSON.stringify(await lg(page));
          const n0 = (await plays(page)).length;
          await tapAll();
          const after = JSON.stringify(await lg(page));
          const ps = (await plays(page)).slice(n0).map((x) => x.n);
          await adv(page, sec);
          const later = JSON.stringify(await lg(page));
          const scale = await page.evaluate(() => (window.visualViewport ? window.visualViewport.scale : 1));
          const pick = (j) => { const o = JSON.parse(j); return { phase: o.phase, t: o.t, kakera: o.kakera, left: o.rock.left, star: o.star, wait: o.wait }; };
          return { name, deterministic: ref[0] === ref[1], same: before === after, sameLater: later === ref[0], ps, scale, b: pick(before), a: pick(after), ref: pick(ref[0]), l: pick(later) };
        });
      };
      const rows = [];
      rows.push(await runCase('fly', async () => {}, 1));
      rows.push(await runCase('bounce', async () => { await frozen(page, async () => { await dbg(page, 'lose'); await advUntil(page, 'bounce', { step: 1 / 30, maxSec: 20 }); await adv(page, 0.2); }); }, 0.5));
      rows.push(await runCase('clear', async () => { await frozen(page, async () => { await advUntil(page, 'fly', { step: 0.1, maxSec: 10 }); await dbg(page, 'win'); await advUntil(page, 'clear', { step: 1 / 30, maxSec: 60 }); }); }, 0.3));
      for (const r of rows) {
        if (r.skip) { check(`${r.name}：場を押す検査の準備ができない（${r.skip}）`, false, r); continue; }
        check(`${r.name}：時間を止めて場（真ん中・小惑星）をクリック・タップ・ダブルクリックしても logic() が同じ（phase ${r.a.phase}・t ${r.a.t.toFixed(2)}・かけら ${r.a.kakera}・残り ${r.a.left}）、音が鳴らない（${r.ps.join(',') || 'なし'}）、拡大されない（scale ${r.scale}）`, r.same && r.ps.length === 0 && r.scale === 1, r);
        check(`${r.name}：押したあとの advance も押さない場合と同じ（押さない場合は2回とも同じ＝${r.deterministic}。押した場合 phase ${r.l.phase}・t ${r.l.t.toFixed(2)}・残り ${r.l.left} ／ 押さない場合 phase ${r.ref.phase}・t ${r.ref.t.toFixed(2)}・残り ${r.ref.left}）`, r.deterministic && r.sameLater, r);
      }
      await ctx.close();
    },
  },
  {
    id: 'KW5', tier: 'smoke', title: 'ほしくだき クリア：win で最後のマスを壊すと phase clear・#clearBanner「ほし N クリア！」・asteroid.best=N、CLEAR_SEC 後に実時間で次の星。ENDING_STAR をクリアすると #endCard（出た直後は押せない・場は止まる・asteroid.best=ENDING_STAR）→「このまま あそぶ」で次の星から続く（cleared）、その後のクリアではエンディングを出さない',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openK(browser, 'KW5', { v: SMOKE_V(), debug: true });
      const r = await frozen(page, async () => {
        await dbg(page, 'win');
        const a = await lg(page);
        const ok = await advUntil(page, 'clear', { step: 1 / 30, maxSec: 60 });
        return { a, ok, b: await lg(page), s: await gs(page) };
      });
      const banner = await txt(page, '#clearBanner [data-part="main"]');
      check(`win（残り ${L.progressOf(r.a).left} マス）のあと phase clear・#clearBanner「${banner}」`, L.progressOf(r.a).left === 1 && r.ok && (await shown(page, '#clearBanner')) && banner === `ほし ${r.a.star} クリア！`, { banner, phase: r.b.phase });
      check(`クリアで asteroid.best が ${r.a.star}（${await stored(page, 'asteroid.best')}）・getState().best ${r.s.best}`, (await stored(page, 'asteroid.best')) === String(r.a.star) && r.s.best === r.a.star, null);
      await wait(page, Math.round(L.CLEAR_SEC * 1000) + 300);
      const c = await lg(page);
      check(`CLEAR_SEC（${L.CLEAR_SEC} 秒）後、押さなくても次の星（ほし ${c.star}・phase ${c.phase}・帯が消える・「${await txt(page, '#starLabel [data-part="num"]')}」）`, c.star === r.a.star + 1 && c.phase === 'fly' && !(await shown(page, '#clearBanner')) && (await txt(page, '#starLabel [data-part="num"]')) === `ほし ${c.star}`, { star: c.star, phase: c.phase });
      // エンディング
      const E = L.ENDING_STAR;
      await setL(page, `l.star = ${E}; ${ARMS(4, 60)}`);   // 星 ENDING_STAR に見合う強さ（Lv1 では最後の1マスが壊れない）
      const e = await frozen(page, async () => {
        await dbg(page, 'win');
        const ok = await advUntil(page, 'end', { step: 1 / 30, maxSec: 60, key: 'overlay' });
        const s = await gs(page);
        const lock = await attr(page, '#endOk', 'aria-disabled');
        await clickAt(page, '#endOk');           // 出た直後（400ms 以内）は押せない
        return { ok, s, lock, s2: await gs(page) };
      });
      check(`ほし ${E}（ENDING_STAR）をクリアすると #endCard（overlay ${e.s.overlay}）、asteroid.best=${await stored(page, 'asteroid.best')}、出た直後の「このまま あそぶ」は押せない（aria-disabled ${e.lock}・押しても overlay ${e.s2.overlay}）`, e.ok && (await shown(page, '#endCard')) && (await stored(page, 'asteroid.best')) === String(E) && e.lock === 'true' && e.s2.overlay === 'end', e);
      const t0 = (await lg(page)).t;
      await wait(page, 600);
      check(`エンディングの間は場が止まる（t ${t0.toFixed(2)} → ${(await lg(page)).t.toFixed(2)}）`, (await lg(page)).t === t0, null);
      await pressCard(page, '#endOk');
      await wait(page, 200);
      const f = await lg(page), fs2 = await gs(page);
      check(`「このまま あそぶ」で ほし ${f.star}（${E + 1}）から続く（phase ${f.phase}・cleared ${f.cleared}・カードが閉じる）`, f.star === E + 1 && f.phase === 'fly' && f.cleared === true && fs2.overlay === null && !(await shown(page, '#endCard')), { star: f.star, phase: f.phase, cleared: f.cleared });
      const g = await frozen(page, async () => {
        await dbg(page, 'win');
        const ok = await advUntil(page, 'clear', { step: 1 / 30, maxSec: 60 });
        await adv(page, L.CLEAR_SEC + 0.5);
        return { ok, s: await gs(page), l: await lg(page) };
      });
      check(`その後の星（ほし ${E + 1}）をクリアしてもエンディングは出ない（overlay ${g.s.overlay}・ほし ${g.l.star}）`, g.ok && g.s.overlay === null && g.l.star === E + 2 && !(await shown(page, '#endCard')), g.s);
      await ctx.close();
    },
  },
  {
    id: 'KW6', tier: 'smoke', title: 'ほしくだき 保存：強くするとすぐ asteroid.save を書く（saveCount）、再読み込みで同じ星（最初から）・かけら・武器、壊れた保存（JSON でない・v:2・配列・数・bak が既にある）は落ちずに ほし 1 から・元の文字を asteroid.save.bak に写す（あれば上書きしない）・ヒント、欄だけ壊れた保存は欄ごとに直す、保存できなくても遊べる、ほかのゲームのキーを変えない',
    async run({ browser, check, root, errors }) {
      const L = logicOf(root);
      const others = { 'matomete.best': '123', 'seizai.best': '3', 'blockpuzzle.sound': 'on', 'tile2048.best': '2048' };
      const { ctx, page } = await openK(browser, 'KW6', { v: SMOKE_V(), items: others });
      await setL(page, `l.star = 4; l.kakera = 1e6; ${ARMS(2, 5)}`);
      const c0 = (await gs(page)).saveCount;
      const u = await page.evaluate(() => window.AsteroidGame.upgrade(1));
      const c1 = (await gs(page)).saveCount;
      const saved = JSON.parse(await stored(page, 'asteroid.save'));
      check(`強くするとすぐ保存（saveCount ${c0} → ${c1}、保存の v ${saved.v}・ほし ${saved.star}・2つ目の Lv ${saved.slots && saved.slots[1] && saved.slots[1].lv}）`, u.ok && c1 === c0 + 1 && saved.v === 1 && saved.star === 4 && saved.slots[1].lv === 6, { c0, c1, saved });
      // 星を半分こわしてから再読み込み → 星の最初から（星の途中は保存しない。§8.2）
      await setL(page, 'const n = l.rock.mats.length; let k = 0; for (let i = 0; i < n && k < l.rock.left / 2; i++) if (l.rock.mats[i]) { l.rock.mats[i] = 0; l.rock.hp[i] = 0; k++; }');
      const before = await lg(page);
      const pb = L.progressOf(before);
      await page.reload(); await wait(page, 200);
      const after = await lg(page);
      const pa = L.progressOf(after);
      check(`再読み込みで同じ ほし ${after.star}・武器 ${JSON.stringify(after.slots)}・かけら ${before.kakera} → ${after.kakera}（以上）、星は最初から（こわした割合 ${pb.broken.toFixed(2)} → ${pa.broken.toFixed(2)}）`, after.star === before.star && JSON.stringify(after.slots) === JSON.stringify(before.slots) && after.kakera >= before.kakera && pb.broken > 0.3 && pa.broken < 0.1 && (await gs(page)).overlay === null, { before: { star: before.star, slots: before.slots, k: before.kakera }, after: { star: after.star, slots: after.slots, k: after.kakera } });
      await page.goto(BASE + 'manifest.webmanifest');
      const keys = await page.evaluate((ks) => ({ others: Object.fromEntries(ks.map((k) => [k, localStorage.getItem(k)])), mine: Object.keys(localStorage).filter((k) => /^asteroid\./.test(k)).sort() }), Object.keys(others));
      check(`ほかのゲームの保存キーが変わらない・書くのは asteroid.* の決まったキーだけ（${keys.mine.join(',')}）`, JSON.stringify(keys.others) === JSON.stringify(others) && keys.mine.every((k) => MY_KEYS.includes(k)), keys);
      // 壊れた保存
      const e0 = errors.length;
      const good = await stored(page, 'asteroid.save');
      const v2 = JSON.stringify({ ...JSON.parse(good), v: 2 });
      const rows = [];
      for (const [name, rawSave, bak, wantBak] of [['JSON でない', '{bad', null, '{bad'], ['v:2（新しい版）', v2, null, v2], ['配列', '[1,2]', null, '[1,2]'], ['数', '42', null, '42'], ['bak が既にある', '{bad2', 'first', 'first']]) {
        await gotoK(page, { 'asteroid.save': rawSave, ...(bak ? { 'asteroid.save.bak': bak } : {}) });
        await wait(page, 100);
        const s = await gs(page), l = await lg(page);
        const hint = await txt(page, '#hint');
        const b = await stored(page, 'asteroid.save.bak');
        rows.push({ name, ok: b === wantBak && l.star === 1 && l.slots.length === 1 && s.overlay === null && s.phase === 'fly' && hint === HINT_BROKEN, bak: b, star: l.star, hint });
      }
      check(`壊れた保存（JSON でない・v:2・配列・数）は ほし 1 から始まり、元の文字を asteroid.save.bak に写す、bak が既にあれば上書きしない、ヒント「${HINT_BROKEN}」`, rows.every((r) => r.ok), rows);
      check('壊れた保存でもページエラーが無い', errors.length === e0, errors.slice(e0));
      // 欄だけ壊れた保存（v:1 のまま）：進み（星）を捨てずに欄ごとに直す
      const part = JSON.stringify({ ...JSON.parse(good), kakera: -5, slots: [{ id: 'shot', lv: 500 }, { id: 'nazo', lv: 3 }, { id: 'shot', lv: 2 }] });
      await gotoK(page, { 'asteroid.save': part });
      const lp = await lg(page);
      check(`v:1 で欄だけ壊れた保存は、星（${lp.star}）を残して欄ごとに直す（かけら ${lp.kakera}・武器 ${JSON.stringify(lp.slots)}）、bak は作らない`, lp.star === JSON.parse(good).star && lp.kakera === 0 && lp.slots.length === 1 && lp.slots[0].id === 'shot' && lp.slots[0].lv === L.LEVEL_MAX && (await stored(page, 'asteroid.save.bak')) === null, lp.slots);
      await ctx.close();
      // 保存できない環境
      const NO_STORE = () => { for (const m of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) Storage.prototype[m] = function () { throw new DOMException('denied', 'SecurityError'); }; };
      const b = await newPage(browser, SMOKE_V(), 'KW6 保存不可', { clock: true, initScript: NO_STORE });
      const e1 = errors.length;
      await b.page.goto(AST); await wait(b.page, 300);
      if ((await gs(b.page)).overlay === 'help') await pressCard(b.page, '#helpOk');
      const k0 = (await lg(b.page)).kakera;
      const s1 = await adv(b.page, 30);
      check(`localStorage が例外でも開いて遊べる（遊び方を閉じられ、かけら ${k0} → ${s1.kakera}）、エラーなし`, s1.kakera > k0 && s1.overlay === null && errors.length === e1, { k0, s1: s1.kakera, errs: errors.slice(e1) });
      await b.ctx.close();
    },
  },
  {
    id: 'KW7', tier: 'smoke', title: 'ほしくだき 戻る：遊んでいる途中・遊び方・2択・はね返しの帯・クリアの帯・エンディングのどこからでも a#back が見えて押せ、メニューへ戻る',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openK(browser, 'KW7', { v: SMOKE_V(), debug: true });
      check('a#back の href がメニュー（BASE）', (await page.evaluate(() => document.querySelector('a#back')?.href)) === BASE, null);
      const r = {};
      const go = async (name) => {
        const reach = await reachable(page, 'a#back');
        await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
        r[name] = reach && page.url() === BASE;
        await gotoK(page, {}, { debug: true });
      };
      await go('fly');
      await page.click('#helpBtn'); await wait(page, 100);
      r.helpOpen = (await gs(page)).overlay === 'help';
      await go('help');
      await setL(page, `l.kakera = ${L.slotCostOf(await lg(page))};`);
      await page.evaluate(() => window.AsteroidGame.unlock()); await wait(page, 50);
      r.chooseOpen = (await gs(page)).overlay === 'choose';
      await go('choose');
      r.bounceOpen = await frozen(page, async () => { await dbg(page, 'lose'); return advUntil(page, 'bounce', { step: 1 / 30, maxSec: 20 }); });
      await go('bounce');
      r.clearOpen = await frozen(page, async () => { await dbg(page, 'win'); return advUntil(page, 'clear', { step: 1 / 30, maxSec: 60 }); });
      await go('clear');
      await setL(page, `l.star = ${L.ENDING_STAR}; ${ARMS(4, 60)}`);
      r.endOpen = await frozen(page, async () => { await dbg(page, 'win'); return advUntil(page, 'end', { step: 1 / 30, maxSec: 60, key: 'overlay' }); });
      await go('end');
      check('遊んでいる途中・遊び方・2択・はね返し・クリア・エンディングのどれからも a#back が見えて押せ、メニューが開く', Object.values(r).length === 11 && Object.values(r).every(Boolean), r);
      await ctx.close();
    },
  },

  // ================= full =================
  {
    id: 'KW8', tier: 'full', title: 'ほしくだき 画面内：SE 縦（ホーム画面・Safari）・SE 横（568×320・568×270）・iPhone 13 縦横・iPad 縦横で、最大の桁（KAKERA_MAX・Lv99・ほし STAR_MAX）の 3 枠（あたらしい ぶき あり）と 4 枠で、#hud・行・ボタンが画面内・44px 以上・重ならない、行は 52px 以上、数の文字が欠けない（はみ出し・省略なし）、文字 12px 以上、場が 360:560 で見える',
    async run({ browser, check }) {
      const views = [view('SE', 'p', 'app'), view('SE', 'p', 'safari'), view('SE', 'l', 'app'), view('SE', 'l', 'safari'), view('i13', 'p', 'app'), view('i13', 'l', 'app'), view('iPad', 'p', 'app'), view('iPad', 'l', 'app')];
      for (const v of views) {
        const { ctx, page } = await openK(browser, `KW8 ${v.label}`, { v });
        for (const n of [3, 4]) {
          await setL(page, `l.star = L.STAR_MAX; l.cleared = true; l.kakera = L.KAKERA_MAX; ${ARMS(n, 99)} ${n === 3 ? 'l.slots[2].lv = 98;' : ''}`);
          await wait(page, 300);
          const lp = await layoutProbe(page, '#hud, #back, #helpBtn, #soundBtn, .wrow, [data-up], #unlockBtn, #fieldCanvas', v.safe, { overlapSel: '#back, #gameTitle, #helpBtn, #soundBtn, #kakera, #starLabel, #starBar, .wrow, #unlockBtn, #fieldCanvas', minSel: '#back, #helpBtn, #soundBtn, [data-up], #unlockBtn' });
          const m = await page.evaluate(() => {
            const vis = (e) => !e.closest('[hidden]') && e.getBoundingClientRect().width > 0;
            const rows = [...document.querySelectorAll('.wrow')].filter(vis).map((e) => Math.round(e.getBoundingClientRect().height));
            const cut = [];
            for (const sel of ['#kakera', '#starLabel', '#starLabel [data-part="num"]', '.wrow [data-part="name"]', '.wrow [data-part="lv"]', '.wrow [data-part="dps"]', '.wrow [data-part="cost"]', '.wrow [data-part="label"]', '#unlockBtn [data-part="cost"]', '#unlockBtn [data-part="label"]', '.barrow [data-part="pct"]']) {
              for (const e of document.querySelectorAll(sel)) {
                if (!vis(e)) continue;
                const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
                if (e.scrollWidth > e.clientWidth + 1 && cs.overflow !== 'visible') cut.push(`${sel}「${e.textContent.trim()}」はみ出し ${e.scrollWidth}>${e.clientWidth}`);
                if (cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) cut.push(`${sel} 省略`);
                if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5) cut.push(`${sel}「${e.textContent.trim()}」画面外`);
                // 親（行・ボタン・#hud）の外へはみ出していない
                const box = e.closest('.wrow, #unlockBtn, #hud');
                if (box) { const q = box.getBoundingClientRect(); if (r.left < q.left - 0.5 || r.right > q.right + 0.5) cut.push(`${sel}「${e.textContent.trim()}」が枠の外`); }
              }
            }
            const small = [];
            for (const e of document.querySelectorAll('#hud *, #weapons *')) {
              if (!vis(e) || ![...e.childNodes].some((x) => x.nodeType === 3 && x.data.trim())) continue;
              const fs = parseFloat(getComputedStyle(e).fontSize);
              if (fs < 12 - 0.01) small.push(`${e.textContent.trim().slice(0, 12)}:${fs}px`);
            }
            const c = document.querySelector('#fieldCanvas').getBoundingClientRect();
            return { rows, cut, small, field: [Math.round(c.width), Math.round(c.height)], ratio: c.height / Math.max(1, c.width), unlock: vis(document.querySelector('#unlockBtn')) };
          });
          // 場の大きさは「見える」こと（64px 以上）だけを見る。契約 §5.1 は高さが足りないときに場を小さくする決まり（SE 縦・Safari で 84px ほど。docs/issues.md AS-T2）
          const ok = lp.n > 0 && lp.outside.length === 0 && lp.overlaps.length === 0 && lp.small.length === 0 && !lp.hscroll && m.rows.length === n && m.rows.every((h) => h >= 52 - 0.5) && m.cut.length === 0 && m.small.length === 0 && m.field[0] >= 64 && Math.abs(m.ratio - 560 / 360) < 0.05 && m.unlock === (n === 3);
          check(`${v.label}・${n} 枠：画面外 ${lp.outside.length}・重なり ${lp.overlaps.length}・44px 未満 ${lp.small.length}・横スクロール ${lp.hscroll}、行の高さ ${m.rows.join('/')}、欠ける文字 ${m.cut.length}・12px 未満 ${m.small.length}、場 ${m.field.join('×')}、あたらしい ぶき ${m.unlock ? 'あり' : 'なし'}`, ok, { lp, m }, v.w === 568 && v.h === 270 ? known('K-AST1') : undefined);
        }
        await ctx.close();
      }
    },
  },
  {
    id: 'KW9', tier: 'full', title: 'ほしくだき 長い名前：SE 縦・横（ホーム画面・Safari）・iPhone 13 で #gameTitle の文字が NAME の全部で、欠けない（scrollWidth ≦ clientWidth・「…」なし）・画面からはみ出さない・a#back・？・♪ と重ならない・12px 以上、2行のときは「ちきゅうを守れ！」と「ほしくだき」の間でだけ折れる。メニュー（320px）のカードの名前も同じ。初回の #help がスクロールなしで「わかった」まで見える',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const [A, B] = ['ちきゅうを守れ！', 'ほしくだき'];
      const linesOk = (ls) => Array.isArray(ls) && ((ls.length === 1 && ls[0] === L.NAME) || (ls.length === 2 && ls[0] === A && ls[1] === B));
      check(`NAME「${L.NAME}」が「${A}」＋「${B}」`, L.NAME === A + B, L.NAME);
      for (const v of [view('SE', 'p', 'app'), view('SE', 'p', 'safari'), view('SE', 'l', 'app'), view('SE', 'l', 'safari'), view('i13', 'p', 'app')]) {
        const { ctx, page } = await openK(browser, `KW9 ${v.label}`, { v, help: false });
        const t = await page.evaluate(() => {
          const e = document.querySelector('#gameTitle');
          const cs = getComputedStyle(e);
          const box = (s) => { const q = document.querySelector(s).getBoundingClientRect(); return [q.left, q.top, q.right, q.bottom]; };
          const hit = (a, b) => a[0] < b[2] - 0.5 && b[0] < a[2] - 0.5 && a[1] < b[3] - 0.5 && b[1] < a[3] - 0.5;
          // 見出しの文字そのものの範囲（行の箱ではなく）
          const rg = document.createRange(); rg.selectNodeContents(e);
          const q = rg.getBoundingClientRect(), tb = [q.left, q.top, q.right, q.bottom];
          const others = ['#back', '#helpBtn', '#soundBtn'].filter((s) => hit(tb, box(s)));
          const ell = [e, ...e.querySelectorAll('*')].some((x) => getComputedStyle(x).textOverflow === 'ellipsis' && x.scrollWidth > x.clientWidth + 1);
          return { text: e.textContent, sw: e.scrollWidth, cw: e.clientWidth, tb: tb.map(Math.round), others, ell, fs: parseFloat(cs.fontSize), w: innerWidth, h: innerHeight };
        });
        const lines = await page.evaluate(LINES_OF, '#gameTitle');
        check(`${v.label}：#gameTitle が NAME の全部（${t.text}）、欠けない（${t.sw}≦${t.cw}・省略 ${t.ell}）、画面内、？・♪・メニューへ と重ならない（${t.others.join(',') || 'なし'}）、${t.fs}px、行 ${JSON.stringify(lines)}`,
          t.text === L.NAME && t.sw <= t.cw + 1 && !t.ell && t.tb[0] >= -0.5 && t.tb[2] <= t.w + 0.5 && t.tb[1] >= -0.5 && t.others.length === 0 && t.fs >= 12 && linesOk(lines), { t, lines });
        // 遊び方（初回）：スクロールなしで「わかった」まで見える
        const h = await page.evaluate(() => {
          const b = document.querySelector('#helpOk'), r = b.getBoundingClientRect();
          const box = document.querySelector('#help');
          const sc = [box, ...box.querySelectorAll('*')].map((x) => x.scrollTop).reduce((a, c) => a + c, 0);
          const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { shown: !box.hidden, top: r.top, bottom: r.bottom, h: r.height, inView: r.top >= -0.5 && r.bottom <= innerHeight + 0.5, sc, hit: !!t && (t === b || b.contains(t)), items: box.querySelectorAll('li').length };
        });
        check(`${v.label}：初回の #help（${h.items} 項目）がスクロールなしで「わかった」まで見えて押せる（下端 ${Math.round(h.bottom)}/${t.h}・高さ ${Math.round(h.h)}）`, h.shown && h.items === 3 && h.inView && h.sc === 0 && h.hit && h.h >= 44 - 0.5, h);
        await ctx.close();
      }
      // メニュー（320px）のカード
      const { ctx, page } = await newPage(browser, custom(320, 568, null, 'SE 幅'), 'KW9 メニュー', { clock: true });
      await seed(page, { 'asteroid.best': String(L.STAR_MAX) });
      await page.goto(BASE); await wait(page, 200);
      const c = await page.evaluate(() => {
        const a = document.querySelector('a.game[href="games/asteroid/"]');
        if (!a) return null;
        const n = a.querySelector('.name'), r = a.getBoundingClientRect(), nr = n.getBoundingClientRect();
        const hit = (p, q) => p.left < q.right - 0.5 && q.left < p.right - 0.5 && p.top < q.bottom - 0.5 && q.top < p.bottom - 0.5;
        const over = [...document.querySelectorAll('a.game')].filter((x) => x !== a && hit(r, x.getBoundingClientRect())).length;
        const ell = [n, ...n.querySelectorAll('*')].some((x) => getComputedStyle(x).textOverflow === 'ellipsis' && x.scrollWidth > x.clientWidth + 1);
        const b = a.querySelector('.best b');
        return { text: n.textContent.trim(), sw: n.scrollWidth, cw: n.clientWidth, right: r.right, nRight: nr.right, over, ell, fs: parseFloat(getComputedStyle(n).fontSize), best: b && b.textContent.trim(), bestFit: b ? b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().right <= r.right + 0.5 : false };
      });
      if (!c) check('メニューにこのゲームのカードがある', false, null);
      else {
        const lines = await page.evaluate(LINES_OF, 'a.game[href="games/asteroid/"] .name');
        check(`メニュー 320px：カードの名前（${c.text}）が欠けない（${c.sw}≦${c.cw}・省略 ${c.ell}）・はみ出さない（右端 ${Math.round(c.right)}）・ほかのカードと重ならない（${c.over}）・${c.fs}px、行 ${JSON.stringify(lines)}、記録「${c.best}」も欠けない`,
          c.text === L.NAME && c.sw <= c.cw + 1 && !c.ell && c.right <= 320.5 && c.nRight <= 320.5 && c.over === 0 && c.fs >= 12 && linesOk(lines) && c.bestFit, { c, lines });
      }
      await ctx.close();
    },
  },
  {
    id: 'KW10', tier: 'full', cdp: 'CDP の CPU 低速化', title: 'ほしくだき 性能：大きな星（starInfo の boss）・4 枠 Lv30 にして、CPU 4 倍遅く（CDP）で 10 秒、34ms を超えるコマが 5% 以下、粒 ≦ 240・弾 ≦ SHOTS_MAX',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await newPage(browser, view('SE', 'p', 'app'), 'KW10');
      await seed(page, { 'asteroid.help': '1' });
      await page.goto(AST); await sleep(500);
      if (!(await page.evaluate(() => !!window.AsteroidGame))) throw new Error('AsteroidGame が無い');
      // 大きな星（boss）を starInfo で探す（番号は決め打ちしない）
      let big = 0;
      for (let n = 25; n >= 2 && !big; n--) if (L.starInfo(n).boss) big = n;
      if (!big) throw new Error('starInfo で boss の星が見つからない');
      await setL(page, `l.star = ${big}; ${ARMS(4, 30)} l.kakera = 0;`);
      const cells = L.progressOf(await lg(page)).total;
      await sleep(2500);
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const a = await gs(page);
      let maxP = 0, maxS = 0;
      for (let i = 0; i < 10; i++) { await sleep(1000); const s = await gs(page); maxP = Math.max(maxP, s.particles); maxS = Math.max(maxS, s.shots); }
      const b = await gs(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const frames = b.frames - a.frames, slow = b.slowFrames - a.slowFrames;
      check(`ほし ${big}（大きな星・${cells} マス）・4 枠 Lv30 で遊んでいる（phase ${b.phase}・ほし ${b.star}）`, L.starInfo(big).boss && ['fly', 'clear', 'bounce'].includes(b.phase) && b.slots.length === 4, b);
      check(`CPU 4 倍遅くで 10 秒：${frames} コマのうち 34ms を超えたのは ${slow}（${(slow / Math.max(1, frames) * 100).toFixed(1)}%、5% 以下）`, frames >= 150 && slow / frames <= 0.05, { frames, slow });
      check(`粒の最大 ${maxP}（≦ 240）・弾の最大 ${maxS}（≦ ${L.SHOTS_MAX}）`, maxP <= 240 && maxS <= L.SHOTS_MAX && maxS > 0, { maxP, maxS });
      await ctx.close();
    },
  },
  {
    id: 'KW11', tier: 'full', title: 'ほしくだき 中断：hidden で rAF が止まり（frames が増えない）t も進まない・body[data-phase]=paused・保存する、pagehide でタイマー（later）を全部片付ける（timers 0）、visible・pageshow で戻ると続きから動き出す。遊び方を開いている間も t が進まない',
    async run({ browser, check }) {
      const { ctx, page } = await openK(browser, 'KW11');
      await setL(page, 'l.kakera = 0;');
      await clickAt(page, '[data-up="0"]'); await wait(page, 50);     // 足りない → ヒント（タイマー）
      const t0 = (await gs(page)).timers;
      const c0 = (await gs(page)).saveCount;
      await setHidden(page, true); await wait(page, 50);
      const a = await gs(page), la = await lg(page);
      await wait(page, 2000);
      const b = await gs(page), lb = await lg(page);
      const ph = await page.evaluate(() => document.body.dataset.phase);
      check(`hidden の 2 秒で描かず（frames ${a.frames} → ${b.frames}）、ロジックも進まない（t ${la.t.toFixed(2)} → ${lb.t.toFixed(2)}）、phase ${b.phase}・body ${ph}、隠れるときに保存（saveCount ${c0} → ${a.saveCount}）`, b.phase === 'paused' && ph === 'paused' && b.frames === a.frames && lb.t === la.t && a.saveCount > c0, { a: a.frames, b: b.frames });
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      const c = await gs(page);
      check(`pagehide でタイマーを片付ける（timers ${t0} → ${c.timers}）`, t0 > 0 && c.timers === 0, { t0, c: c.timers });
      await setHidden(page, false);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await wait(page, 1000);
      const d = await gs(page), ld = await lg(page);
      check(`戻ると続きから動き出す（phase ${d.phase}・frames ${b.frames} → ${d.frames}・t ${lb.t.toFixed(2)} → ${ld.t.toFixed(2)}、ほし ${ld.star} のまま）`, d.phase === 'fly' && d.frames > b.frames && ld.t > lb.t && ld.t - lb.t < 2 && ld.star === lb.star, d);
      await page.click('#helpBtn'); await wait(page, 100);
      const h0 = await lg(page);
      await wait(page, 1500);
      const h1 = await lg(page);
      check(`遊び方を開いている間は t が進まない（${h0.t.toFixed(2)} → ${h1.t.toFixed(2)}、body ${await page.evaluate(() => document.body.dataset.phase)}）`, (await gs(page)).overlay === 'help' && h1.t === h0.t, null);
      await ctx.close();
    },
  },
  {
    id: 'KW12', tier: 'full', title: 'ほしくだき キーボード：1〜4 でその行を強くする、U であたらしい ぶき、2択は出た直後の矢印を受け付けず 400ms 後に → で B・A で A・Enter でフォーカスのある #choiceA、4 枠で #unlockBtn が隠れる、Tab で [data-up] へ移り Enter で強くする、? で遊び方・Esc で閉じる、M で音のオン・オフ',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openK(browser, 'KW12', { opts: { touch: false } });
      await setL(page, 'l.kakera = L.KAKERA_MAX;');
      await page.locator('#kakera').click().catch(() => {});
      const lv0 = (await lg(page)).slots[0].lv;
      await page.keyboard.press('1'); await wait(page, 50);
      check(`1 で たま を強くする（Lv${lv0} → Lv${(await lg(page)).slots[0].lv}）`, (await lg(page)).slots[0].lv === lv0 + 1, null);
      const picks = [];
      for (const [how, k] of [['ArrowRight', 1], ['a', 0], ['Enter', 0]]) {
        const u = await frozen(page, async () => {
          await page.keyboard.press('u');
          const s = await gs(page);
          await page.keyboard.press(k === 1 ? 'ArrowRight' : 'ArrowLeft');   // 出た直後（400ms 以内）は受け付けない
          return { s, s2: await gs(page) };
        });
        await wait(page, 450);
        await page.keyboard.press(how);
        await wait(page, 50);
        const s3 = await gs(page);
        picks.push({ how, open: u.s.overlay === 'choose', locked: u.s2.overlay === 'choose' && u.s2.slots.length === u.s.slots.length, chosen: s3.overlay === null && s3.slots.length === u.s.slots.length + 1 && s3.slots[s3.slots.length - 1].id === (u.s.offer && u.s.offer[k]), offer: u.s.offer, last: s3.slots[s3.slots.length - 1] });
      }
      check(`U で2択が開き、出た直後の矢印は受け付けず、400ms 後に → は B・A は A・Enter はフォーカスのある A を選ぶ（${picks.map((p) => `${p.how}:${p.last && p.last.id}`).join(' ')}）`, picks.every((p) => p.open && p.locked && p.chosen), picks);
      check('4 枠になると #unlockBtn が隠れる', (await lg(page)).slots.length === L.SLOTS_MAX && !(await shown(page, '#unlockBtn')), null);
      const lv3 = (await lg(page)).slots[3].lv;
      await page.keyboard.press('4'); await wait(page, 50);
      check(`4 で 4 行目を強くする（Lv${lv3} → Lv${(await lg(page)).slots[3].lv}）`, (await lg(page)).slots[3].lv === lv3 + 1, null);
      const focusTo = async (sel, max = 40) => { for (let i = 0; i < max; i++) { if (await page.evaluate((s) => !!document.activeElement && document.activeElement.matches(s), sel)) return true; await page.keyboard.press('Tab'); } return false; };
      const lv2 = (await lg(page)).slots[2].lv;
      const f = await focusTo('[data-up="2"]');
      await page.keyboard.press('Enter'); await wait(page, 50);
      check(`Tab で 3 行目の [data-up] へ移り、Enter で強くする（Lv${lv2} → Lv${(await lg(page)).slots[2].lv}）`, f && (await lg(page)).slots[2].lv === lv2 + 1, f);
      await page.keyboard.press('?'); await wait(page, 100);
      const h = (await gs(page)).overlay;
      await wait(page, 450);
      await page.keyboard.press('Escape'); await wait(page, 100);
      check(`? で遊び方（${h}）、Esc で閉じる（${(await gs(page)).overlay}）`, h === 'help' && (await gs(page)).overlay === null, h);
      const p0 = await attr(page, '#soundBtn', 'aria-pressed');
      await page.keyboard.press('m'); await wait(page, 50);
      const p1 = await attr(page, '#soundBtn', 'aria-pressed');
      await page.keyboard.press('m'); await wait(page, 50);
      const p2 = await attr(page, '#soundBtn', 'aria-pressed');
      check(`M で音のオン・オフ（aria-pressed ${p0} → ${p1} → ${p2}）`, p0 !== p1 && p2 === p0, [p0, p1, p2]);
      await ctx.close();
    },
  },
  {
    id: 'KW13', tier: 'full', title: 'ほしくだき 動きを減らす：reducedMotion reduce で calm・body[data-calm]=1、強くしても行の光（.flash）を付けない。ふつうの設定では calm false で .flash が付く',
    async run({ browser, check }) {
      for (const reduce of [true, false]) {
        const { ctx, page } = await openK(browser, `KW13 ${reduce ? 'reduce' : 'ふつう'}`, { opts: { reducedMotion: reduce ? 'reduce' : 'no-preference' } });
        await setL(page, 'l.kakera = 1e9;');
        const s = await gs(page);
        const dc = await page.evaluate(() => document.body.dataset.calm || null);
        const fl = await frozen(page, async () => { await clickAt(page, '[data-up="0"]'); return page.evaluate(() => document.querySelector('.wrow[data-slot="0"]').classList.contains('flash')); });
        check(`${reduce ? 'reduce' : 'ふつう'}：calm ${s.calm}・body[data-calm] ${dc}・強くした直後の .flash ${fl}`, reduce ? (s.calm === true && dc === '1' && fl === false) : (s.calm === false && dc === null && fl === true), { s: s.calm, dc, fl });
        await ctx.close();
      }
    },
  },
  {
    id: 'KW14', tier: 'full', audio: true, title: 'ほしくだき 効果音：始め start・撃つ shot・欠ける break・強くする up・足りない deny・あたらしい ぶき unlock・クリア clear・はね返し bounce が鳴り、すべて "asteroid" の音の表にあり、音の部品が start する。♪でオフにすると鳴らない',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openK(browser, 'KW14', { debug: true, opts: { initScript: SFX_SPY } });
      await page.mouse.click(5, 300).catch(() => {});
      await wait(page, 3000);                                                     // shot・break
      await setL(page, 'l.kakera = 1e9;');
      await page.click('[data-up="0"]'); await wait(page, 100);                   // up
      await page.click('#unlockBtn'); await wait(page, 100);                      // unlock
      await pressCard(page, '#choiceA');                                          // unlock
      await setL(page, 'l.kakera = 0;');
      await clickAt(page, '[data-up="0"]'); await wait(page, 100);                // deny
      await dbg(page, 'win');
      for (let i = 0; i < 60 && (await gs(page)).logicPhase !== 'clear'; i++) await wait(page, 200);   // clear（実時間で）
      await wait(page, Math.round(L.CLEAR_SEC * 1000) + 300);
      await dbg(page, 'lose');
      for (let i = 0; i < 60 && (await gs(page)).logicPhase !== 'bounce'; i++) await wait(page, 200); // bounce
      const ps = await plays(page);
      const names = [...new Set(ps.map((p) => p.n))];
      const need = ['start', 'shot', 'break', 'up', 'unlock', 'deny', 'clear', 'bounce'];
      check(`鳴った音（${names.join(',')}）に ${need.join('・')} がある`, need.every((n) => names.includes(n)), names);
      const silentNames = need.filter((n) => !ps.some((p) => p.n === n && p.d > 0));
      check(`鳴らした音はすべて "asteroid" の音の表にあり、どの名前も 1 回以上は音の部品が start した（動かなかった名前：${silentNames.join(',') || 'なし'}）`, ps.every((p) => p.known) && silentNames.length === 0, { silentNames, unknown: ps.filter((p) => !p.known) });
      await wait(page, Math.round(L.BOUNCE_SEC * 1000) + 300);
      await page.click('#soundBtn'); await wait(page, 50);
      const n0 = (await plays(page)).length;
      await setL(page, 'l.kakera = 1e9;');
      await page.click('[data-up="0"]'); await wait(page, 1500);
      const ps2 = (await plays(page)).slice(n0);
      check(`♪ でオフにすると、強くする・撃つで音の部品が動かない（${ps2.map((p) => `${p.n}:${p.d}`).slice(0, 12).join(',')}）`, ps2.length > 0 && ps2.every((p) => p.d === 0), ps2.slice(0, 20));
      await page.click('#soundBtn');
      await ctx.close();
    },
  },
  {
    id: 'KW15', tier: 'full', title: 'ほしくだき メニュー・静的：カードの名前が AsteroidLogic.NAME と一致（KW15）・説明・絵がある、asteroid.best が 1 以上なら「ほし N まで クリア」・壊れた値と 0 は「まだ記録なし」、押すとゲームが開く。<head> の <title> の直後で debug.js（DG1）、<title> が NAME、ダブルタップ拡大の抑止（user-scalable=no・ボタンと場の touch-action）、場に押す処理の属性が無い',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const html = fs.readFileSync(path.join(root, 'games/asteroid/index.html'), 'utf8');
      check('<head> の <title> の直後（間は説明のコメントだけ）で ../../common/debug.js を読む（DG1）', /<title>[^<]*<\/title>\s*(?:<!--[\s\S]*?-->\s*)*<script src="\.\.\/\.\.\/common\/debug\.js"><\/script>/.test(html), html.slice(html.indexOf('<title>'), html.indexOf('<title>') + 160));
      check('viewport に user-scalable=no', /name="viewport"[^>]*user-scalable=no/.test(html), null);
      check(`<title> が NAME（${L.NAME}）`, (html.match(/<title>([^<]*)<\/title>/) || [])[1] === L.NAME, null);
      const { ctx, page } = await newPage(browser, STD_V(), 'KW15', { clock: true });
      const card = () => page.evaluate(() => {
        const a = document.querySelector('a.game[href="games/asteroid/"]');
        if (!a) return null;
        const b = a.querySelector('.best b');
        const q = a.getBoundingClientRect(), cv = a.querySelector('canvas.art');
        let painted = false;
        if (cv && cv.width > 0) { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { painted = true; break; } }
        return { name: a.querySelector('.name')?.textContent.trim(), desc: a.querySelector('.desc')?.textContent.trim(), best: b?.textContent.trim(), none: b?.classList.contains('none'), h: q.height, painted };
      });
      await seed(page, {});
      await page.goto(BASE); await wait(page, 200);
      const c0 = await card();
      check(`KW15 メニューにカードがあり、名前（${c0 && c0.name}）が AsteroidLogic.NAME（${L.NAME}）と一致、説明あり、絵が描かれている`, !!c0 && c0.name === L.NAME && !!c0.desc && c0.h >= 44 && c0.painted, c0);
      check(`記録が無いときは「まだ記録なし」（${c0 && c0.best}）`, c0 && c0.best === 'まだ記録なし' && c0.none === true, c0);
      const rows = [];
      for (const n of [1, L.ENDING_STAR, L.STAR_MAX]) {
        await seed(page, { 'asteroid.best': String(n) });
        await page.goto(BASE); await wait(page, 150);
        const c = await card();
        rows.push({ n, best: c && c.best, ok: !!c && !c.none && c.best === `ほし ${n} まで クリア` });
      }
      check(`asteroid.best 1・${L.ENDING_STAR}・${L.STAR_MAX} は「ほし N まで クリア」（${rows.map((r) => r.best).join('・')}）`, rows.every((r) => r.ok), rows);
      const bad = [];
      for (const raw of ['0', 'abc', '', '-1', 'NaN', '{}', '1e400', 'Infinity']) {
        await seed(page, { 'asteroid.best': raw });
        await page.goto(BASE); await wait(page, 150);
        const c = await card();
        if (!c || c.best !== 'まだ記録なし') bad.push(`${raw}: ${c && c.best}`);
      }
      check('壊れた値・0・範囲外（0・abc・空・-1・NaN・{}・1e400・Infinity）はぜんぶ「まだ記録なし」でメニューが落ちない', bad.length === 0, bad);
      await seed(page, { 'asteroid.help': '1' });
      await page.goto(BASE); await wait(page, 150);
      await page.click('a.game[href="games/asteroid/"]'); await page.waitForURL('**/games/asteroid/', { timeout: 5000 }).catch(() => {});
      check('メニューのカードを押すとゲームが開く', page.url() === AST, page.url());
      await wait(page, 300);
      const ta = await page.evaluate(() => [...document.querySelectorAll('button, a#back, #field, #fieldCanvas')].filter((e) => !e.closest('[hidden]')).map((e) => ({ n: e.id || e.dataset.up || e.tagName, ta: getComputedStyle(e).touchAction })).filter((x) => !['manipulation', 'pan-y', 'none', 'pan-x pan-y'].includes(x.ta)));
      check('ボタン・a#back・場はダブルタップ拡大しない touch-action（manipulation・pan-y・none）', ta.length === 0, ta);
      const onAttr = await page.evaluate(() => ['#field', '#fieldCanvas', '#stage'].map((s) => document.querySelector(s)).filter(Boolean).flatMap((e) => [...e.attributes].filter((a) => /^on/i.test(a.name)).map((a) => a.name)));
      check(`場（#field・#fieldCanvas）に onclick などの押す処理の属性が無い（${onAttr.join(',') || 'なし'}）`, onAttr.length === 0, onAttr);
      await ctx.close();
    },
  },
  {
    id: 'KW16', tier: 'full', title: 'ほしくだき オフライン：sw.js の APP_FILES に games/asteroid/ の全ファイルがあり、接続を切っても開いて遊べ（advance でかけらが増える）、部品は Service Worker から読まれ、メニューに戻れる',
    async run({ browser, check, srv, root }) {
      const info = swInfo(root);
      const dir = path.join(root, 'games/asteroid');
      const actual = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : [];
      const want = [...new Set(['./games/asteroid/', ...['index.html', 'logic.js', 'render.js', 'main.js', ...actual].map((f) => `./games/asteroid/${f}`)])];
      const missing = want.filter((f) => !info.files.includes(f));
      check(`sw.js の APP_FILES に games/asteroid/ の ${want.length} 件がすべてある（足りない：${missing.join(' / ') || 'なし'}）`, missing.length === 0 && actual.length >= 4, missing);
      if (missing.length) return;
      srv.reset();
      const { ctx, page } = await newPage(browser, custom(390, 844, null, 'iPhone 13'), 'KW16', { sw: true, allowNetErrors: true });
      await page.goto(BASE);
      const ok = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]));
      if (!ok) throw new Error('Service Worker が 8 秒以内に有効にならない（事前キャッシュの install 失敗の可能性）');
      if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }); }
      await page.evaluate(() => localStorage.setItem('asteroid.help', '1'));
      await sleep(200);
      await srv.ctl('offline=1');
      const resp = [];
      page.on('response', (r) => { if (/\/games\/asteroid\/|\/common\/sfx\.js/.test(r.url())) resp.push({ f: r.url().split('/').slice(-2).join('/'), status: r.status(), sw: r.fromServiceWorker() }); });
      await page.goto(AST, { timeout: 10000 }); await sleep(500);
      const libs = await page.evaluate(() => ({ L: typeof window.AsteroidLogic?.step, R: typeof window.AsteroidRender?.create, Y: typeof window.YubiSfx?.create, G: typeof window.AsteroidGame?.getState }));
      check('オフラインで開き、AsteroidLogic・AsteroidRender・YubiSfx・AsteroidGame が使える', Object.values(libs).every((x) => x === 'function'), libs);
      const js = ['logic.js', 'render.js', 'main.js', 'common/sfx.js'].map((f) => ({ f, hit: resp.find((r) => r.f.endsWith(f)) }));
      check('logic.js・render.js・main.js・sfx.js を Service Worker から 200 で読んだ', js.every((x) => x.hit && x.hit.sw && x.hit.status === 200), { js, resp });
      if (libs.G === 'function') {
        const k0 = (await page.evaluate(() => window.AsteroidGame.getState())).kakera;
        const s1 = await page.evaluate(() => window.AsteroidGame.advance(30));
        check(`オフラインで遊べる（かけら ${k0} → ${s1.kakera}）、描いている（frames ${s1.frames}）`, s1.kakera > k0 && s1.frames > 0, { k0, s1 });
      }
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('オフラインのまま、メニューに戻れる', page.url() === BASE && await page.locator('a.game').count() >= 2, page.url());
      await srv.ctl('offline=0');
      await ctx.close();
    },
  },
  {
    id: 'KW17', tier: 'full', cdp: 'CDP のタッチ操作（ダブルタップ）', title: 'ほしくだき タッチ：強くするボタン・#soundBtn・場（#fieldCanvas）を素早く2回タップしても拡大しない、場の2回タップで logic が変わらない',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, custom(390, 664, null, 'iPhone 13 Safari'), 'KW17', { device: 'iPhone 13', clock: true });
      await gotoK(page);
      await setL(page, 'l.kakera = 1e9;');
      const t = await touch(ctx, page);
      const res = {};
      for (const sel of ['[data-up="0"]', '#soundBtn', '#fieldCanvas']) {
        await sleep(400); await wait(page, 400);
        let same = null;
        if (sel === '#fieldCanvas') {
          same = await frozen(page, async () => { const a = JSON.stringify(await lg(page)); const [x, y] = await t.center(sel); await t.tap(x, y); await sleep(100); await t.tap(x, y); await sleep(60); return a === JSON.stringify(await lg(page)); });
        } else await t.doubleTap(sel);
        await wait(page, 100);
        res[sel] = { scale: await page.evaluate(() => window.visualViewport.scale), same };
      }
      check(`素早い2回タップで拡大しない（${Object.entries(res).map(([k, v]) => `${k}:${v.scale}`).join(' / ')}）`, Object.values(res).every((v) => v.scale === 1), res);
      check('場の2回タップで logic が変わらない', res['#fieldCanvas'].same === true, res);
      await ctx.close();
    },
  },
];
