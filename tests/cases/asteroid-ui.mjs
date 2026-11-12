// KW: ちきゅうを守れ！ほしくだき の画面（games/asteroid/）。契約は docs/asteroid-contract.md（§23）と計画書 docs/plans/asteroid-renew.md（§1.3 時間切れ・§1.6 保存・§2 見た目・§5.3 DOM・§8 テスト）。
//   リニューアル（2回目の作り直し、2026-11-09）：画面いっぱいの canvas を回しながら自機が大きな星の縁を飛んで削る（全部自動）。負けは時間切れ（ちきゅうまで あと m:ss）で、
//   #lostCard「まにあわなかった！」の「もういちど」でその星を最初の形から。保存は v:3。古い保存（v:1・v:2）は初回に消す（asteroid.v3 の印）。
//   画面の DOM は #hud[data-urgent]・a#back・#gameTitle・#helpBtn・#soundBtn・#kakera・#starLabel（.num・#starTag）・#timeBar（role=progressbar・aria-valuenow・aria-valuetext）・#timeFill・#timeText・#starPct・
//     #field・#fieldCanvas・#fieldzone・#lostCard（#lostTitle・[data-cmd="retry"]）・#clearBanner・#msBanner・#bossBanner・#hint・.wrow[data-slot]・[data-up]・#unlockBtn・#swapBtn・#benchCount・
//     #choiceCard・#choiceA・#choiceB・#choiceLead・#swapCard・#swapTitle・[data-swap-slot]・#benchList・[data-swap-to]・#swapDone・#help・#helpOk・#helpRestart・#restartCard・#endCard・#endOk・body[data-phase]
//   テスト用の公開 API（main.js）：window.AsteroidGame = { getState, logic, advance, upgrade, unlock, choose, swapWeapon, retry, setState, save }
//     getState()：phase・star・kakera・slots・bench・offer・swap・progress・left・limit・ship・overlay・lost・view・logicPhase・tries・t…（turrets は無い）。advance(sec) は lost と choose で止まる。
//     setState(obj)：obj.left（残り秒）・obj.phase（'fly'・'lost'・'clear'）・obj.rock（同じ格子なら）を受け付ける
//   デバッグ命令（?debug=1 のときだけ）：YubiDebug.run('win'|'lose'|'timeleft'|'retry'|'gostar'|'addk'|'lv'|'ff'|'swap'|'bench'|'hold'|'rates', …)。lose は 残り 0.1 秒＋hold（次の step で時間切れ）
//   決まり（組み合わせ担当の注意）：
//     ・数値（星の時間・値段・体力・かけら）は書き込まない。期待値は Node で読んだ logic.js（同じ root）の関数（formatKakera・formatTime・upCostOf・slotCostOf・progressOf・dpsOf・starInfo・swapChoicesOf）と
//       定数（NAME・ENDING_STAR・CLEAR_SEC・KAKERA_MAX・MILESTONES など）から作る
//     ・保存を直接書くときは、ゲームのページで書いて reload しない（pagehide で上書きされる）。seed() で中立のページへ移って書いてから開く。
//       古い保存を消す仕組み（asteroid.v3 の印）があるので、gotoK は既定で asteroid.v3='1' も入れる（印の検査だけ v3: null で入れない）
//     ・aria-disabled のボタン（足りないときの強くする・ロック中の2択・ひかえが空の いれかえ）は locator.click が届かないので、座標で page.mouse.click（clickAt）
//     ・API の choose・swapWeapon・retry は 400ms のロックを通らないので、400ms の検査はクリック・キーで行う
//     ・時間切れは lose（残り 0.1 秒＋hold）で起こす。hold は撃たないので、時間切れの前に clear になることが無い（T-19 を起こさない）
//   無いときに合格にしない（空振りの合格を作らない）：AsteroidGame・YubiDebug が無ければ例外で不合格にする。マスが 0 の状態で「欠けた」を検査しない（§13-8）。
//   smoke：KW1〜KW7・KW18・KW19・KW22・KW24。full：KW8〜KW17・KW20・KW21・KW23・KW25・KW26（KW10・KW17 は CDP なので Chromium だけ、KW14 は AudioContext が要る）。KW15 は NAME とメニューの名前の一致。
//   ハードモード（段 tier・「ハード ほし N」・つぎの だんへ）の画面の項目は、main.js の作りが決まってから足す。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BASE, view, custom, newPage, seed, wait, sleep, frozen, layoutProbe, swInfo, touch, SFX_SPY, plays, x20Run, x20Text, known } from '../lib.mjs';

const AST = BASE + 'games/asteroid/';
const ASTD = AST + '?debug=1';
const SMOKE_V = () => view('SE', 'p', 'app');
const STD_V = () => view('i13', 'p', 'app');
const HINT_BROKEN = 'ほぞんが よめなかったので さいしょから はじめるよ';   // 契約 §8.3 の決まった言葉
const MY_KEYS = ['asteroid.save', 'asteroid.save.bak', 'asteroid.best', 'asteroid.help', 'asteroid.v3'];

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
  const stamp = items['asteroid.v3'] === null ? {} : { 'asteroid.v3': '1' };   // 古い保存を消す仕組み（初回に 1 回だけ）を通ったあとの状態にする
  await seed(page, { ...stamp, ...(help ? { 'asteroid.help': '1' } : {}), ...items });
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
// 時間切れにする（時間を止めた中で使う）：デバッグの lose（残り 0.1 秒＋hold）で、次の 1 step（STEP）で lost になる（§7.4）
async function loseNow(p) {
  await dbg(p, 'lose');
  return advUntil(p, 'lost', { step: 1 / 30, maxSec: 1 });
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
// logic の state から、ゲームと同じ STEP で step を回して先を読む（決定的なので、そのあと advance で同じ所へ行ける）。
// until(s, p, evs) が true になった step までの数 n と、途中の出来事（milestone・clear・lost）を返す。見つからなければ null
const predict = (p, until, maxSec = 120) => p.evaluate(([until, maxSec]) => {
  const L = window.AsteroidLogic, f = new Function('s', 'p', 'evs', 'return (' + until + ');');
  let s = window.AsteroidGame.logic();
  const evs = [];
  for (let n = 1; n <= Math.round(maxSec / L.STEP); n++) {
    const r = L.step(s, L.STEP);
    if (!r) return null;
    s = r.state;
    for (const e of r.events) if (['milestone', 'clear', 'lost', 'ending'].includes(e.kind)) evs.push(e);
    if (f(s, L.progressOf(s), evs)) return { n, evs, s };
  }
  return null;
}, [until, maxSec]);
// 星の上から、こわした割合が frac をこえない一番近い所までマスを消す文（setL 用。区切りの直前にする）
const BREAK_BELOW = (frac) => `const T = l.rock.total; let k = l.rock.total - l.rock.left; for (let i = 0; i < l.rock.mats.length && (k + 1) / T < ${frac}; i++) if (l.rock.mats[i]) { l.rock.mats[i] = 0; l.rock.hp[i] = 0; k++; }`;
// 秒 →「3ぷん20びょう」「45びょう」「1じかん5ふん」（クリアの帯の書き方。契約 §18.1 C の例「3ぷん12びょう」）
const fmtT = (sec) => { const t = Math.max(1, Math.round(sec)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), r = t % 60; return h > 0 ? `${h}じかん${m}ふん` : m > 0 ? `${m}ぷん${r}びょう` : `${r}びょう`; };

export const tests = [
  {
    id: 'KW1', tier: 'smoke', title: 'ほしくだき 遊べる・表示の一致：開くと自機が飛んで撃ち始め（frames・phase fly・ship が動く）、advance でマスが欠けて #kakera が増え、残り時間が減る。#kakera が formatKakera、行の値段が upCostOf、つよさが dpsOf、#starPct が progressOf().broken、#timeText「ちきゅうまで あと m:ss」・#timeBar（role=progressbar・aria-valuenow・aria-valuetext）が formatTime(left)・timeFrac、30 秒を切ると #hud[data-urgent]、題名が NAME。[data-up] で Lv とつよさが上がり値段ぶん減り、その行に「＋N%」（dpsOf の前後差の割合）。足りないと aria-disabled・「あと N」（不足分）・所持／値段の塗り（--fill）・ヒント「かけらが たりないよ（あと N）」・音 deny で Lv は変わらない、買えるようになった瞬間に .up.ready',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openK(browser, 'KW1', { v: SMOKE_V(), debug: true, opts: { initScript: SFX_SPY } });
      await wait(page, 1000);
      const s0 = await gs(page), l0 = await lg(page);
      check(`開くと遊んでいる（phase ${s0.phase}・ほし ${s0.star}・overlay ${s0.overlay}・body[data-phase]=${await page.evaluate(() => document.body.dataset.phase)}）、描き続けている（frames ${s0.frames}）、自機（ship）が飛ぶ・残り時間 left ${s0.left}／limit ${s0.limit}（starInfo の limit ${L.starInfo(1).limit}）`, s0.phase === 'fly' && s0.star === 1 && s0.overlay === null && s0.frames > 10 && (await page.evaluate(() => document.body.dataset.phase)) === 'fly' && !!s0.ship && s0.limit === L.starInfo(1).limit && s0.left > 0 && s0.left <= s0.limit, s0);
      check(`document.title と #gameTitle の文字が NAME（${L.NAME}）`, (await page.title()) === L.NAME && (await page.evaluate(() => document.querySelector('#gameTitle').textContent)) === L.NAME, [await page.title(), await txt(page, '#gameTitle')]);
      const { s1, l1, p1, ui } = await frozen(page, async () => {
        const s1 = await adv(page, 30);
        const l1 = await lg(page);
        const p1 = L.progressOf(l1);
        check(`advance(30) でマスが欠け（残り ${L.progressOf(l0).left} → ${p1.left}・totals.cells ${l1.totals.cells}）、かけらが増える（${l0.kakera} → ${l1.kakera}）、t が 30 秒すすみ（${l0.t.toFixed(1)} → ${l1.t.toFixed(1)}）残り時間も同じだけ減り（${l0.left.toFixed(1)} → ${l1.left.toFixed(1)}）、自機が動く`,
          p1.left < L.progressOf(l0).left && l1.totals.cells > 0 && l1.kakera > l0.kakera && l1.t - l0.t >= 29.9 && s1.phase === 'fly' && Math.abs((l0.left - l1.left) - (l1.t - l0.t)) < 0.05 && s1.ship && l1.ship && (l1.ship.x !== l0.ship.x || l1.ship.y !== l0.ship.y), { l0: { k: l0.kakera, t: l0.t }, l1: { k: l1.kakera, t: l1.t, cells: l1.totals.cells }, p1 });
        const ui = await page.evaluate(() => ({
          kakera: document.querySelector('#kakera').textContent.trim(),
          cost: document.querySelector('.wrow[data-slot="0"] [data-part="cost"]').textContent.trim(),
          lv: document.querySelector('.wrow[data-slot="0"] [data-part="lv"]').textContent.trim(),
          dps: document.querySelector('.wrow[data-slot="0"] [data-part="dps"]').textContent.trim(),
          pct: document.querySelector('#starPct').textContent.trim(),
          timeText: document.querySelector('#timeText').textContent.trim(),
          tbRole: document.querySelector('#timeBar').getAttribute('role'), tbNow: document.querySelector('#timeBar').getAttribute('aria-valuenow'), tbText: document.querySelector('#timeBar').getAttribute('aria-valuetext'), tbFill: document.querySelector('#timeFill').style.width,
          num: document.querySelector('#starLabel [data-part="num"]').textContent.trim(),
          unlock: document.querySelector('#unlockBtn [data-part="cost"]').textContent.trim(),
        }));
        return { s1, l1, p1, ui };
      });
      const want = { kakera: L.formatKakera(l1.kakera), cost: L.formatKakera(L.upCostOf(l1, 0)), lv: 'Lv' + l1.slots[0].lv, dps: String(L.dpsOf(l1, 0)), pct: Math.floor(p1.broken * 100) + '%', timeText: 'ちきゅうまで あと ' + L.formatTime(l1.left), tbText: 'ちきゅうまで あと ' + L.formatTime(l1.left), tbFill: (Math.round(Math.max(0, Math.min(1, p1.timeFrac)) * 1000) / 10) + '%', num: 'ほし ' + l1.star, unlock: L.formatKakera(L.slotCostOf(l1)) };
      check(`表示の一致：#kakera「${ui.kakera}」=formatKakera、値段「${ui.cost}」=upCostOf、「${ui.lv}」、つよさ「${ui.dps}」に dpsOf ${want.dps}、#starPct「${ui.pct}」=floor(broken×100)%、「${ui.num}」、あたらしい ぶき「${ui.unlock}」=slotCostOf`,
        ui.kakera === want.kakera && ui.cost === want.cost && ui.lv === want.lv && ui.dps.includes(want.dps) && ui.pct === want.pct && ui.num === want.num && ui.unlock === want.unlock && parseInt(ui.pct) > 0, { ui, want });
      check(`残り時間の表示：#timeText「${ui.timeText}」=「ちきゅうまで あと m:ss」(formatTime(left ${l1.left.toFixed(1)}))、#timeBar role=${ui.tbRole}・aria-valuenow ${ui.tbNow}・aria-valuetext「${ui.tbText}」、#timeFill の幅 ${ui.tbFill}（timeFrac ${p1.timeFrac.toFixed(3)}）`,
        ui.timeText === want.timeText && ui.tbRole === 'progressbar' && ui.tbText === want.tbText && ui.tbFill === want.tbFill && Number(ui.tbNow) === Math.round(Math.round(Math.max(0, Math.min(1, p1.timeFrac)) * 1000) / 10) && p1.timeFrac > 0 && p1.timeFrac < 1, { ui, want });
      // 30 秒を切ると棒と字をオレンジに（#hud[data-urgent]）。急かす音は鳴らさない（中毒性 A の方針）
      const urg = await frozen(page, async () => {
        const n0 = (await plays(page)).length;
        await dbg(page, 'timeleft', { sec: 31 }); await adv(page, 0.05);
        const a = { urgent: (await gs(page)).urgent, attr: await attr(page, '#hud', 'data-urgent') };
        await dbg(page, 'timeleft', { sec: 29 }); await adv(page, 0.05);
        const b = { urgent: (await gs(page)).urgent, attr: await attr(page, '#hud', 'data-urgent'), text: await txt(page, '#timeText'), left: (await lg(page)).left };
        const ps = (await plays(page)).slice(n0).map((x) => x.n).filter((n) => !['shot', 'break', 'crack', 'chunk', 'glow'].includes(n));
        return { a, b, ps };
      });
      check(`残り 31 秒では #hud[data-urgent] なし（${urg.a.attr}）、29 秒では "1"（${urg.b.attr}・「${urg.b.text}」）、急かす音は鳴らさない（撃つ・欠ける以外の音 ${urg.ps.join(',') || 'なし'}）`, urg.a.urgent === false && urg.a.attr === null && urg.b.urgent === true && urg.b.attr === '1' && urg.ps.length === 0, urg);
      await dbg(page, 'timeleft', { sec: (await lg(page)).limit });
      // 強くする（クリック）。時間を止めて、押す前と後を比べる
      const need = L.upCostOf(l1, 0);
      await setL(page, `l.kakera = ${need * 3};`);
      const up = await frozen(page, async () => {
        const a = await lg(page);
        await clickAt(page, '[data-up="0"]');
        const b = await lg(page);
        const shownCost = await txt(page, '.wrow[data-slot="0"] [data-part="cost"]');
        const shownDps = await txt(page, '.wrow[data-slot="0"] [data-part="dps"]');
        const plus = await page.evaluate(() => { const e = document.querySelector('.wrow[data-slot="0"] [data-part="plus"]'); return { text: e ? e.textContent.trim() : null, show: !!e && e.classList.contains('show') }; });
        return { a, b, shownCost, shownDps, plus };
      });
      check(`[data-up] を押すと Lv${up.a.slots[0].lv} → Lv${up.b.slots[0].lv}、つよさ ${L.dpsOf(up.a, 0)} → ${L.dpsOf(up.b, 0)}、かけらが値段 ${L.upCostOf(up.a, 0)} ぶん減る（${up.a.kakera} → ${up.b.kakera}）、新しい値段「${up.shownCost}」=upCostOf・つよさ「${up.shownDps}」=dpsOf`,
        up.b.slots[0].lv === up.a.slots[0].lv + 1 && L.dpsOf(up.b, 0) > L.dpsOf(up.a, 0) && up.a.kakera - up.b.kakera === L.upCostOf(up.a, 0) && up.shownCost === L.formatKakera(L.upCostOf(up.b, 0)) && up.shownDps.includes(String(L.dpsOf(up.b, 0))), up);
      const d0 = L.dpsOf(up.a, 0), d1 = L.dpsOf(up.b, 0);
      const plusWant = `＋${Math.max(1, Math.round((d1 - d0) / d0 * 100))}%`;
      check(`買った行に「${up.plus.text}」（dpsOf ${d0} → ${d1} の前後差の割合 ${plusWant}）が出る（.show ${up.plus.show}）`, up.plus.show && up.plus.text === plusWant, { plus: up.plus, plusWant });
      await wait(page, 1000);
      check(`「＋N%」は 0.8 秒で消える（「${await txt(page, '.wrow[data-slot="0"] [data-part="plus"]')}」）`, (await txt(page, '.wrow[data-slot="0"] [data-part="plus"]')) === '' && !(await page.evaluate(() => document.querySelector('.wrow[data-slot="0"] [data-part="plus"]').classList.contains('show'))), null);
      // 足りない
      await setL(page, 'l.kakera = 0;');
      const lk = await frozen(page, async () => {
        const n0 = (await plays(page)).length;
        const a = await lg(page);
        const dis = await attr(page, '[data-up="0"]', 'aria-disabled');
        const label = await txt(page, '[data-up="0"] [data-part="label"]');
        await clickAt(page, '[data-up="0"]');
        const ps = (await plays(page)).slice(n0).map((x) => x.n);
        return { a, dis, label, ps, hint: await txt(page, '#hint'), lv1: (await lg(page)).slots[0].lv };
      });
      const { dis, label, ps, hint, lv1 } = lk;
      const lv0 = lk.a.slots[0].lv;
      const c0 = L.upCostOf(lk.a, 0);
      const lackWant = `あと ${L.formatKakera(c0 - lk.a.kakera)}`;
      check(`かけら ${lk.a.kakera} では [data-up] に aria-disabled="${dis}"・「${label}」（不足分 ${lackWant}）、押しても Lv が変わらず（${lv0} → ${lv1}）、ヒント「${hint}」と音 deny（${ps.join(',')}）`, dis === 'true' && label === lackWant && lv1 === lv0 && hint === `かけらが たりないよ（${lackWant}）` && ps.includes('deny'), { dis, label, hint, ps, lackWant });
      // 半分たまったとき：「あと N」は不足分、ボタンは所持／値段の割合で塗る（--fill。1/50 刻み）
      const half = Math.floor(c0 / 2);
      const fl = await frozen(page, async () => {
        await setL(page, `l.kakera = ${half};`);
        const a = await page.evaluate(() => { const b = document.querySelector('[data-up="0"]'); return { label: b.querySelector('[data-part="label"]').textContent.trim(), fill: parseFloat(b.style.getPropertyValue('--fill')), dis: b.getAttribute('aria-disabled') }; });
        await setL(page, `l.kakera = ${c0};`);
        const b = await page.evaluate(() => { const b = document.querySelector('[data-up="0"]'); return { label: b.querySelector('[data-part="label"]').textContent.trim(), ready: b.classList.contains('ready'), dis: b.getAttribute('aria-disabled') }; });
        return { a, b };
      });
      check(`かけら ${half}／値段 ${c0}：「${fl.a.label}」（あと ${L.formatKakera(c0 - half)}）・塗り --fill ${fl.a.fill}（${(half / c0).toFixed(3)}）。ちょうど買えるようになると「${fl.b.label}」・押せる・.up.ready ${fl.b.ready}`,
        fl.a.dis === 'true' && fl.a.label === `あと ${L.formatKakera(c0 - half)}` && Math.abs(fl.a.fill - half / c0) <= 0.021 && fl.a.fill > 0 && fl.b.dis === null && fl.b.label === 'つよくする' && fl.b.ready === true, { fl, half, c0 });
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
    id: 'KW3', tier: 'smoke', title: 'ほしくだき 時間切れ（T-19 を起こさない）と もういちど：6 割こわした星で lose（残り 0.1 秒＋hold で撃たない）にすると、advance(0.2) の中（残り 0.1 秒は 3 step）で必ず phase lost・hold は false に戻る・残り 0:00・tries+1。#lostCard「まにあわなかった！」と [data-cmd="retry"]「もういちど」（44px 以上・出た直後 400ms は押せない・body[data-phase]=lost）、場は止まる（advance・実時間で t が進まず自動ではやり直さない）、かけらと Lv は残り、いちばん安く強くできる行が光る（data-suggest）、lost の間も強くできる。「もういちど」でその星が最初の形（こわした割合 0・残り時間 limitTry＝やさしくなった分・tries のまま）・カードが消える・かけらと Lv と区切り（ms）は残る、音 lost／start',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openK(browser, 'KW3', { v: SMOKE_V(), debug: true, opts: { initScript: SFX_SPY } });
      const wName = (id) => L.WEAPONS.find((w) => w.id === id)?.name;
      // いちばん安く強くできる行（upCostOf が最小。同じなら前の行）
      const cheapest = (l) => { let k = -1, c = Infinity; l.slots.forEach((_, j) => { const x = L.upCostOf(l, j); if (typeof x === 'number' && x < c) { c = x; k = j; } }); return k; };
      await page.mouse.click(5, 300).catch(() => {});
      await wait(page, 300);
      // 星を 6 割こわした状態にする（最初からに戻ったことが分かるように）・かけらと Lv を持たせる。2 つ目の武器は Lv1（値段が たまの Lv3 と違う）＝おすすめの行が決まる。
      // lose は 1 回だけ、時間を止めて 1 step だけ進める
      const r = await frozen(page, async () => {
        await setL(page, `const n = l.rock.mats.length; let k = 0; for (let i = 0; i < n && k < l.rock.left * 0.6; i++) if (l.rock.mats[i]) { l.rock.mats[i] = 0; l.rock.hp[i] = 0; k++; } l.kakera = 777; l.slots = [{ id: L.WEAPONS[0].id, lv: 3 }, { id: L.WEAPONS[1].id, lv: 1 }]; l.ms = [25];`);
        const gapBefore = await shown(page, '#lostGap');
        const lr = await dbg(page, 'lose');
        const a = await lg(page);
        await adv(page, 0.2);   // 残り 0.1 秒は 3 step（STEP は 1/30 秒）。lost で advance は止まる
        const b = await lg(page);
        const s = await gs(page);
        const gap = { shown: await shown(page, '#lostGap'), text: await txt(page, '#lostGap'), before: gapBefore };
        const card = await page.evaluate(() => {
          const c = document.querySelector('#lostCard'), btn = c.querySelector('[data-cmd="retry"]');
          const q = btn.getBoundingClientRect();
          return { shown: !c.hidden && c.getBoundingClientRect().width > 0, role: c.getAttribute('role'), label: c.getAttribute('aria-labelledby'), title: document.querySelector('#lostTitle').textContent.trim(), btn: btn.textContent.trim(), h: q.height, w: q.width, lock: btn.getAttribute('aria-disabled'),
            phase: document.body.dataset.phase, time: document.querySelector('#timeText').textContent.trim() };
        });
        // 出た直後（400ms 以内）は押しても効かない
        let clickErr = null;
        try { await clickAt(page, '#lostCard [data-cmd="retry"]'); } catch (e) { clickErr = String(e.message).slice(0, 80); }
        const c2 = await lg(page);
        const t0 = b.t;
        await adv(page, 5);
        const t1 = (await lg(page)).t;
        return { lr, a, b, s, card, c2, t0, t1, clickErr, gap };
      });
      const pa = L.progressOf(r.a), pb = L.progressOf(r.b);
      check(`lose で 残り 0.1 秒・hold（返り値 ${JSON.stringify(r.lr)}・logic hold ${r.a.hold}・left ${r.a.left}）・まだ fly（${r.a.phase}）、6 割こわした（${pa.broken.toFixed(2)}）`, !!r.lr && r.lr.hold === true && r.a.hold === true && r.a.phase === 'fly' && Math.abs(r.a.left - 0.1) < 1e-6 && pa.broken > 0.55, { lr: r.lr, left: r.a.left, broken: pa.broken });
      check(`lose のあと advance(0.2) の中（残り 0.1 秒は 3 step）で必ず phase lost（${r.b.phase}）・hold が false に戻る（${r.b.hold}）・残り ${r.b.left}・tries ${r.a.tries} → ${r.b.tries}・こわしたマスは減らない（残り ${pa.left} → ${pb.left}）・body[data-phase]=${r.card.phase}・getState().lost ${r.s.lost}・#timeText「${r.card.time}」`,
        r.b.phase === 'lost' && r.b.hold === false && r.b.left === 0 && r.b.tries === r.a.tries + 1 && pb.left === pa.left && r.card.phase === 'lost' && r.s.lost === true && r.s.phase === 'lost' && r.card.time === 'ちきゅうまで あと 0:00', { b: r.b.phase, hold: r.b.hold, left: r.b.left, tries: r.b.tries, card: r.card });
      check(`#lostCard が出る（role=${r.card.role}・見出し「${r.card.title}」・「${r.card.btn}」${Math.round(r.card.w)}×${Math.round(r.card.h)}px）、出た直後は aria-disabled="${r.card.lock}" で押しても やり直さない（phase ${r.c2.phase}・${r.clickErr || '押せた'}）`,
        r.card.shown && r.card.role === 'group' && r.card.label === 'lostTitle' && r.card.title === 'まにあわなかった！' && r.card.btn === 'もういちど' && r.card.h >= 44 - 0.5 && r.card.w >= 44 - 0.5 && r.card.lock === 'true' && r.c2.phase === 'lost', r.card);
      check(`時間切れの札に「あと N% だった！」（#lostGap「${r.gap.text}」・ふだんは隠れている ${!r.gap.before}）`, r.gap.shown && /あと\s*\d+%/.test(r.gap.text || '') && r.gap.before === false, r.gap);
      check(`時間切れの間は場が止まる（advance(5) で t ${r.t0.toFixed(2)} → ${r.t1.toFixed(2)}）`, r.t1 === r.t0, { t0: r.t0, t1: r.t1 });
      check(`かけらと Lv が残る（かけら ${r.a.kakera} → ${r.b.kakera}・Lv${r.b.slots[0].lv}）、同じ星（${r.b.star}）（音 lost は advance の間は鳴らさないので KW14 で実時間で確かめる）`, r.b.kakera >= r.a.kakera && r.b.slots[0].lv === 3 && r.b.star === r.a.star, { a: r.a.kakera, b: r.b.kakera });
      const sug = await page.evaluate(() => [...document.querySelectorAll('.wrow[data-suggest="1"]')].map((e) => Number(e.dataset.slot)));
      const kWant = cheapest(r.b);
      check(`時間切れのあと、いちばん安く強くできる行（data-slot ${kWant}・${wName(r.b.slots[kWant].id)}・${L.upCostOf(r.b, kWant)}）を1つ光らせる（.wrow[data-suggest=1] ${JSON.stringify(sug)}）`, sug.length === 1 && sug[0] === kWant, { sug, kWant, costs: r.b.slots.map((_, j) => L.upCostOf(r.b, j)) });
      // 実時間で待っても自動ではやり直さない・lost の間も強くできる
      await wait(page, 3000);
      const w1 = await lg(page);
      const lvA = w1.slots[0].lv;
      await setL(page, 'l.kakera = 1e9; l.phase = "lost"; l.left = 0;');
      const up = await page.evaluate(() => window.AsteroidGame.upgrade(0));
      const w2 = await lg(page);
      check(`実時間で 3 秒待ってもやり直さない（phase ${w1.phase}・カード ${await shown(page, '#lostCard')}）、lost の間も強くできる（upgrade ${JSON.stringify(up)}・Lv${lvA} → Lv${w2.slots[0].lv}・phase ${w2.phase}）`, w1.phase === 'lost' && up.ok === true && w2.slots[0].lv === lvA + 1 && w2.phase === 'lost' && (await shown(page, '#lostCard')), { w1: w1.phase, up });
      // もういちど（400ms 後にクリック）
      const bf = await lg(page);
      const n1 = (await plays(page)).length;
      await pressCard(page, '#lostCard [data-cmd="retry"]');
      await wait(page, 100);
      const c = await lg(page), cs = await gs(page), pc = L.progressOf(c);
      const wantLeft = L.limitTry(c.star, c.tier, c.tries);
      check(`「もういちど」で次の挑戦（phase ${c.phase}・カードが消える ${!(await shown(page, '#lostCard'))}・body ${await page.evaluate(() => document.body.dataset.phase)}・tries ${bf.tries} → ${c.tries}・hold ${c.hold}）`, c.phase === 'fly' && !(await shown(page, '#lostCard')) && c.tries === bf.tries && c.hold === false && cs.overlay === null && cs.lost === false && (await page.evaluate(() => document.body.dataset.phase)) === 'fly', { phase: c.phase, tries: c.tries });
      check(`同じ星を最初の形から（ほし ${c.star}・こわした割合 ${pb.broken.toFixed(2)} → ${pc.broken.toFixed(2)}）、残り時間が戻る（limit ${c.limit}＝limitTry(${c.star}, ${c.tier}, ${c.tries}) ${wantLeft}・左 ${c.left.toFixed(1)}）、Lv${c.slots[0].lv} とかけら ${c.kakera} と区切り ms ${JSON.stringify(c.ms)} は残る、#timeText「${await txt(page, '#timeText')}」`,
        c.star === r.a.star && pc.broken < 0.05 && c.limit === wantLeft && c.limit >= L.starInfo(c.star, c.tier).limit && c.left > c.limit - 1 && c.slots[0].lv === lvA + 1 && c.kakera >= bf.kakera && JSON.stringify(c.ms) === JSON.stringify([25]), { pc, limit: c.limit, wantLeft, left: c.left, ms: c.ms });
      check(`もういちど の音 start が鳴り、ヒント「${await txt(page, '#hint')}」`, (await plays(page)).slice(n1).some((x) => x.n === 'start') && (await txt(page, '#hint')) === 'もういちど！', null);
      await ctx.close();
    },
  },
  {
    id: 'KW4', tier: 'smoke', title: 'ほしくだき 場を押しても何も起きない：fly・lost・clear のそれぞれで、時間を止めて #fieldCanvas の真ん中と小惑星の上をクリック・タップ（連打）しても logic() が変わらず、その後の advance も押さない場合と同じ（t・kakera・マス・phase）、効果音も鳴らない、拡大されない',
    async run({ browser, check }) {
      const { ctx, page } = await openK(browser, 'KW4', { v: SMOKE_V(), debug: true, opts: { initScript: SFX_SPY } });
      await page.mouse.click(5, 5).catch(() => {});    // 音の準備（最初の操作）
      await wait(page, 500);
      const pointsOf = () => page.evaluate(() => {
        const c = document.querySelector('#fieldCanvas').getBoundingClientRect();
        return { mid: [c.left + c.width / 2, c.top + c.height / 2], rock: [c.left + c.width * 0.3, c.top + c.height * 0.4] };
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
          const pick = (j) => { const o = JSON.parse(j); return { phase: o.phase, t: o.t, kakera: o.kakera, left: o.rock.left, star: o.star, wait: o.wait, tl: o.left }; };
          return { name, deterministic: ref[0] === ref[1], same: before === after, sameLater: later === ref[0], ps, scale, b: pick(before), a: pick(after), ref: pick(ref[0]), l: pick(later) };
        });
      };
      const rows = [];
      rows.push(await runCase('fly', async () => {}, 1));
      rows.push(await runCase('lost', async () => { await frozen(page, async () => { await loseNow(page); await adv(page, 0.2); }); }, 0.5));
      rows.push(await runCase('clear', async () => { await frozen(page, async () => { await page.evaluate(() => window.AsteroidGame.retry()); await advUntil(page, 'fly', { step: 0.1, maxSec: 10 }); await dbg(page, 'win'); await advUntil(page, 'clear', { step: 1 / 30, maxSec: 60 }); }); }, 0.3));
      for (const r of rows) {
        if (r.skip) { check(`${r.name}：場を押す検査の準備ができない（${r.skip}）`, false, r); continue; }
        check(`${r.name}：時間を止めて場（真ん中・小惑星）をクリック・タップ・ダブルクリックしても logic() が同じ（phase ${r.a.phase}・t ${r.a.t.toFixed(2)}・かけら ${r.a.kakera}・残り ${r.a.left}・時間 ${r.a.tl.toFixed(2)}）、音が鳴らない（${r.ps.join(',') || 'なし'}）、拡大されない（scale ${r.scale}）`, r.same && r.ps.length === 0 && r.scale === 1, r);
        check(`${r.name}：押したあとの advance も押さない場合と同じ（押さない場合は2回とも同じ＝${r.deterministic}。押した場合 phase ${r.l.phase}・t ${r.l.t.toFixed(2)}・残り ${r.l.left} ／ 押さない場合 phase ${r.ref.phase}・t ${r.ref.t.toFixed(2)}・残り ${r.ref.left}）`, r.deterministic && r.sameLater, r);
      }
      await ctx.close();
    },
  },
  {
    id: 'KW5', tier: 'smoke', flaky: { why: 'CLEAR_SEC 後の次の星を実時間で待つ（T-33 の形）', checks: /^CLEAR_SEC（/ }, title: 'ほしくだき クリア：win で最後のマスを壊すと phase clear・#clearBanner「ほし N クリア！」・asteroid.best=N、CLEAR_SEC 後に実時間で次の星。ENDING_STAR（ふつうの最後の星）をクリアすると #endCard（出た直後は押せない・場は止まる・asteroid.best=ENDING_STAR）→ボタンで閉じて続く（ハードの中身は KW27）。クリアの帯の中身は KW19',
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
      await setL(page, 'l.t = 5000;');          // 遊んだ合計の秒を大きく（クリアの時間がこれを含まないことを見る）
      await dbg(page, 'gostar', { star: E });   // 星 ENDING_STAR に見合う強さ（自動プレイの表。Lv1 では最後の1マスが壊れない）
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
      check(`エンディングのボタンで閉じて続く（phase ${f.phase}・cleared ${f.cleared}・カードが閉じる ${!(await shown(page, '#endCard'))}・overlay ${fs2.overlay}）`, f.phase === 'fly' && f.cleared === true && fs2.overlay === null && !(await shown(page, '#endCard')), { phase: f.phase, cleared: f.cleared });
      await ctx.close();
    },
  },
  {
    id: 'KW6', tier: 'smoke', title: 'ほしくだき 保存（v:3）：強くするとすぐ asteroid.save を書く（saveCount・v は SAVE_VERSION＝3・tier）、再読み込みで同じ星の途中から（mid：マスの残り・残り時間 left・超えた区切りはもらった扱い）・かけら・武器、クリアの演出中の保存は次の星の最初から、壊れた保存（JSON でない・v:4・配列・数・bak が既にある）は落ちずに ほし 1 から・元の文字を asteroid.save.bak に写す（あれば上書きしない）・ヒント、欄だけ壊れた v:3 の保存（かけら・武器・ひかえ・予約・kfrac）は欄ごとに直す、保存できなくても遊べる、ほかのゲームのキーを変えない',
    async run({ browser, check, root, errors }) {
      const L = logicOf(root);
      const others = { 'matomete.best': '123', 'seizai.best': '3', 'blockpuzzle.sound': 'on', 'tile2048.best': '2048' };
      const { ctx, page } = await openK(browser, 'KW6', { v: SMOKE_V(), items: others, debug: true });
      await setL(page, `l.star = 4; l.kakera = 1e6; ${ARMS(2, 5)}`);
      const c0 = (await gs(page)).saveCount;
      const u = await page.evaluate(() => window.AsteroidGame.upgrade(1));
      const c1 = (await gs(page)).saveCount;
      const saved = JSON.parse(await stored(page, 'asteroid.save'));
      check(`強くするとすぐ保存（saveCount ${c0} → ${c1}、保存の v ${saved.v}・tier ${saved.tier}・ほし ${saved.star}・2つ目の Lv ${saved.slots && saved.slots[1] && saved.slots[1].lv}）`, u.ok && c1 === c0 + 1 && saved.v === L.SAVE_VERSION && saved.v === 3 && saved.tier === 0 && saved.star === 4 && Array.isArray(saved.bench) && Array.isArray(saved.swap) && saved.slots[1].lv === 6, { c0, c1, saved });
      // 星を半分こわし、残り時間を決めてから再読み込み → 星の途中から続く（logic の mid）。残り時間 left も続きから、
      // もう超えている区切り（25・50%）は「もらった」ことになる（開き直しで 2 回もらえない）
      await setL(page, 'const n = l.rock.mats.length; let k = 0; for (let i = 0; i < n && k < l.rock.left / 2; i++) if (l.rock.mats[i]) { l.rock.mats[i] = 0; l.rock.hp[i] = 0; k++; } l.left = 123.4; l.ms = [];');
      const before = await lg(page);
      const pb = L.progressOf(before);
      await page.reload(); await wait(page, 200);
      const after = await lg(page);
      const pa = L.progressOf(after);
      check(`再読み込みで同じ ほし ${after.star}・武器 ${JSON.stringify(after.slots)}・かけら ${before.kakera} → ${after.kakera}（以上）`, after.star === before.star && JSON.stringify(after.slots) === JSON.stringify(before.slots) && after.kakera >= before.kakera && (await gs(page)).overlay === null, { before: { star: before.star, slots: before.slots, k: before.kakera }, after: { star: after.star, slots: after.slots, k: after.kakera } });
      check(`星の途中から続く（こわした割合 ${pb.broken.toFixed(3)} → ${pa.broken.toFixed(3)}・残り ${pb.left} → ${pa.left}）、残り時間も続き（${before.left.toFixed(1)} → ${after.left.toFixed(1)} 秒）、超えている区切りはもらった扱い（ms ${JSON.stringify(after.ms)}）`,
        pb.broken > 0.45 && pa.broken >= pb.broken - 1e-9 && pa.broken - pb.broken < 0.1 && JSON.stringify(after.ms) === JSON.stringify(L.MILESTONES.filter((p) => p / 100 <= pa.broken + 1e-12)) && after.ms.length >= 2 && Math.abs(after.left - before.left) < 1.5 && after.left < after.limit, { pb, pa, ms: after.ms, bl: before.left, al: after.left });
      // クリアの演出中（phase clear）に閉じたら、開き直しは次の星の最初から（同じ星をもう一度にしない）
      const cl = await frozen(page, async () => { await dbg(page, 'win'); const ok = await advUntil(page, 'clear', { step: 1 / 30, maxSec: 60 }); return { ok, l: await lg(page), raw: await stored(page, 'asteroid.save') }; });
      await page.reload(); await wait(page, 200);
      const nx = await lg(page);
      const sv = JSON.parse(cl.raw || '{}');
      check(`クリアの演出中の保存は次の星（保存の ほし ${sv.star}・mid ${sv.mid ? 'あり' : 'なし'}）、開き直すと ほし ${cl.l.star} → ${nx.star} の最初から（こわした割合 ${L.progressOf(nx).broken.toFixed(2)}・残り時間 ${nx.left.toFixed(0)}／${nx.limit}・ms ${JSON.stringify(nx.ms)}）`,
        cl.ok && cl.l.phase === 'clear' && sv.star === cl.l.star + 1 && !sv.mid && nx.star === cl.l.star + 1 && L.progressOf(nx).broken < 0.1 && Math.abs(nx.left - nx.limit) < 3 && Array.isArray(nx.ms) && nx.ms.length === 0, { sv: { star: sv.star, mid: !!sv.mid, ms: sv.ms }, nx: { star: nx.star, ms: nx.ms } });
      await page.goto(BASE + 'manifest.webmanifest');
      const keys = await page.evaluate((ks) => ({ others: Object.fromEntries(ks.map((k) => [k, localStorage.getItem(k)])), mine: Object.keys(localStorage).filter((k) => /^asteroid\./.test(k)).sort() }), Object.keys(others));
      check(`ほかのゲームの保存キーが変わらない・書くのは asteroid.* の決まったキーだけ（${keys.mine.join(',')}）`, JSON.stringify(keys.others) === JSON.stringify(others) && keys.mine.every((k) => MY_KEYS.includes(k)), keys);
      // 壊れた保存
      const e0 = errors.length;
      const good = await stored(page, 'asteroid.save');
      const v4 = JSON.stringify({ ...JSON.parse(good), v: 4 });
      const rows = [];
      for (const [name, rawSave, bak, wantBak] of [['JSON でない', '{bad', null, '{bad'], ['v:4（新しい版）', v4, null, v4], ['配列', '[1,2]', null, '[1,2]'], ['数', '42', null, '42'], ['bak が既にある', '{bad2', 'first', 'first']]) {
        await gotoK(page, { 'asteroid.save': rawSave, ...(bak ? { 'asteroid.save.bak': bak } : {}) });
        await wait(page, 100);
        const s = await gs(page), l = await lg(page);
        const hint = await txt(page, '#hint');
        const b = await stored(page, 'asteroid.save.bak');
        rows.push({ name, ok: b === wantBak && l.star === 1 && l.slots.length === 1 && s.overlay === null && s.phase === 'fly' && hint === HINT_BROKEN, bak: b, star: l.star, hint });
      }
      check(`壊れた保存（JSON でない・v:4・配列・数）は ほし 1 から始まり、元の文字を asteroid.save.bak に写す、bak が既にあれば上書きしない、ヒント「${HINT_BROKEN}」`, rows.every((r) => r.ok), rows);
      check('壊れた保存でもページエラーが無い', errors.length === e0, errors.slice(e0));
      // 欄だけ壊れた保存（v:3 のまま）：進み（星）を捨てずに欄ごとに直す。ひかえ は重複・砲台と重なる・知らない id を捨て、予約は ひかえ に無い id・枠の外を捨てる。
      // 残った古い予約（枠 0 → ビーム）は、読み込むときに すぐ当てる（2026-11-12 から入れ替えは すぐ替わる）
      const part = JSON.stringify({ ...JSON.parse(good), kakera: -5, kfrac: 7, slots: [{ id: 'shot', lv: 500 }, { id: 'nazo', lv: 3 }, { id: 'shot', lv: 2 }],
        bench: [{ id: 'shot', lv: 4 }, { id: 'beam', lv: 3 }, { id: 'beam', lv: 9 }, { id: 'zzz', lv: 1 }], swap: [{ slot: 0, id: 'bolt' }, { slot: 9, id: 'beam' }, { slot: 0, id: 'beam' }] });
      await gotoK(page, { 'asteroid.save': part });
      const lp = await lg(page);
      check(`v:3 で欄だけ壊れた保存は、星（${lp.star}）を残して欄ごとに直す（かけら ${lp.kakera}（-5 は 0 から数え直し）・kfrac ${lp.kfrac}（7 は捨てる）・武器 ${JSON.stringify(lp.slots)}・ひかえ ${JSON.stringify(lp.bench)}・予約 ${JSON.stringify(lp.swap)}（古い予約 枠 0 → ビーム は読み込むときに当てる））、bak は作らない`,
        lp.star === JSON.parse(good).star && lp.kakera >= 0 && lp.kakera < 5000 && lp.kfrac >= 0 && lp.kfrac < 1 && lp.slots.length === 1 && lp.slots[0].id === 'beam' && lp.slots[0].lv === 3 &&
        JSON.stringify(lp.bench) === JSON.stringify([{ id: 'shot', lv: L.LEVEL_MAX }]) && JSON.stringify(lp.swap) === '[]' && (await stored(page, 'asteroid.save.bak')) === null, { slots: lp.slots, bench: lp.bench, swap: lp.swap });
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
    id: 'KW7', tier: 'smoke', title: 'ほしくだき 戻る：遊んでいる途中・遊び方・2択・入れ替えのカード・時間切れのカード・クリアの帯・エンディングのどこからでも a#back が見えて押せ、メニューへ戻る',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openK(browser, 'KW7', { v: SMOKE_V(), debug: true });
      check('a#back の href がメニュー（BASE）', (await page.evaluate(() => document.querySelector('a#back')?.href)) === BASE, null);
      const r = {};
      const go = async (name) => {
        const reach = await reachable(page, 'a#back');
        if (reach) { await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {}); }
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
      await dbg(page, 'bench', { ids: [L.WEAPONS[4].id] });
      await clickAt(page, '#swapBtn'); await wait(page, 50);
      r.swapOpen = (await gs(page)).overlay === 'swap';
      await go('swap');
      r.lostOpen = await frozen(page, () => loseNow(page));
      await go('lost');
      r.clearOpen = await frozen(page, async () => { await dbg(page, 'win'); return advUntil(page, 'clear', { step: 1 / 30, maxSec: 60 }); });
      await go('clear');
      await dbg(page, 'gostar', { star: L.ENDING_STAR });
      r.endOpen = await frozen(page, async () => { await dbg(page, 'win'); return advUntil(page, 'end', { step: 1 / 30, maxSec: 60, key: 'overlay' }); });
      await go('end');
      // 遊んでいる途中・時間切れ・クリアの帯は必ず戻れる。カード（遊び方・2択・入れ替え・エンディング）の上でも戻れる（CLAUDE.md「どの画面からもメニューへ戻れる」・T7）。
      // 既知の不具合 AST-BACK：.app が z-index:1 の重なりの層を作るので、a#back（z-index 30）が .overlay（z-index 20）の下になり、カードの上では押せない（games/asteroid/index.html）
      const plain = ['fly', 'lost', 'clear'].map((k) => [k, r[k]]);
      const cards = ['help', 'choose', 'swap', 'end'].map((k) => [k, r[k]]);
      const opened = [r.helpOpen, r.chooseOpen, r.swapOpen, r.lostOpen, r.clearOpen, r.endOpen];
      check(`遊んでいる途中・時間切れ・クリアの帯で a#back が見えて押せ、メニューが開く（${plain.map(([k, v]) => k + ':' + v).join(' ')}）。カードや帯が実際に開いていた（${opened.join('/')}）`, plain.every(([, v]) => v) && opened.every(Boolean), r);
      check(`遊び方・2択・入れ替え・エンディングのカードの上でも a#back が押せ、メニューが開く（${cards.map(([k, v]) => k + ':' + v).join(' ')}）`, cards.every(([, v]) => v), r, known('AST-BACK'));
      await ctx.close();
    },
  },
  {
    id: 'KW18', tier: 'smoke', title: 'ほしくだき 区切り（§18.1 B）：こわした割合が 25% をこえた step で #msBanner（「…こわした！」・「＋N かけら」、N は milestone の bonus＝floor(星の value×MILESTONE_BONUS)）・かけらに足す・ms に 25、1 秒で消える。時間切れの「もういちど」のあとの挑戦では同じ区切りをもらい直せない（帯なし・ms のまま）、まだの区切り（50%）はもらえる。ms は保存され、壊れた ms（重複・知らない値・文字）は直して読む',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openK(browser, 'KW18', { v: SMOKE_V(), debug: true });
      const p25 = L.MILESTONES[0], p50 = L.MILESTONES[1];
      const banner = () => page.evaluate(() => { const b = document.querySelector('#msBanner'); return { shown: !!b && !b.hidden && b.getBoundingClientRect().width > 0, main: b && b.querySelector('[data-part="main"]').textContent.trim(), sub: b && b.querySelector('[data-part="sub"]').textContent.trim() }; });
      // 25% の直前まで こわし、区切りをこえる step まで先を読んで advance で同じ所へ
      // 実時間で進まないよう（並列で重いと、こわす間に 50% までこえてしまう）、25%・はね返し・50% までを まとめて時間を止めた中で行う
      const F = (_p, fn) => fn();
      const { r, h, bo, r2, r3 } = await frozen(page, async () => {
        const r = await F(page, async () => {
          await setL(page, `${BREAK_BELOW(p25 / 100)} l.ms = [];`);
          const a = await lg(page);
          const pr = await predict(page, `p.broken >= ${p25 / 100}`, 60);
          if (!pr) return { a, pr };
          await adv(page, pr.n * L.STEP);
          return { a, pr, b: await lg(page), bn: await banner() };
        });
        if (!r.pr) throw new Error('60 秒で 25% をこえない');
        const ms1 = r.pr.evs.filter((e) => e.kind === 'milestone');
        const bonus = Math.floor(r.a.rock.value * L.MILESTONE_BONUS);
        check(`25% をこえた step の出来事 milestone ${JSON.stringify(ms1)}：pct ${p25}・bonus = floor(星の value ${r.a.rock.value} × ${L.MILESTONE_BONUS}) = ${bonus}`, ms1.length === 1 && ms1[0].pct === p25 && ms1[0].bonus === bonus && bonus > 0, ms1);
        check(`#msBanner が出る（「${r.bn && r.bn.main}」「${r.bn && r.bn.sub}」＝「＋${L.formatKakera(bonus)} かけら」）、ms ${JSON.stringify(r.b && r.b.ms)}、かけら ${r.a.kakera} → ${r.b && r.b.kakera}（おまけ ${bonus} 以上ふえる）`,
          !!r.b && r.bn.shown && /こわした！$/.test(r.bn.main) && r.bn.sub === `＋${L.formatKakera(bonus)} かけら` && JSON.stringify(r.b.ms) === JSON.stringify([p25]) && r.b.kakera - r.a.kakera >= bonus, { bn: r.bn, ms: r.b && r.b.ms });
        // 1 秒（ロジックの時計）で消える
        const h = await F(page, async () => { await adv(page, 1.1); return { bn: await banner(), l: await lg(page) }; });
        check(`区切りの帯は 1 秒で消える（ロジックの時計で 1.1 秒後 ${h.bn.shown ? '出ている' : '消えた'}・ms ${JSON.stringify(h.l.ms)}）`, h.l.ms.length > 1 || !h.bn.shown, h);
        // 時間切れ → もういちど（同じ星の次の挑戦）：25% はもらい直せない、50% はもらえる
        const bo = await F(page, async () => {
          const t0 = (await lg(page)).tries;
          await dbg(page, 'lose');
          const ok = await advUntil(page, 'lost', { step: 1 / 30, maxSec: 1 });
          await page.evaluate(() => window.AsteroidGame.retry());
          return { ok, t0, l: await lg(page) };
        });
        const r2 = await F(page, async () => {
          await setL(page, BREAK_BELOW(p25 / 100));
          const a = await lg(page);
          const pr = await predict(page, `p.broken >= ${p25 / 100}`, 60);
          if (!pr) return { a, pr };
          await adv(page, pr.n * L.STEP);
          return { a, pr, b: await lg(page), bn: await banner() };
        });
        if (!r2.pr) throw new Error('やり直しのあと 60 秒で 25% をこえない');
        check(`時間切れ→もういちど（tries ${bo.l.tries}・ms ${JSON.stringify(bo.l.ms)}）のあと、もう一度 25% をこえても区切りは出ない（出来事 ${JSON.stringify(r2.pr.evs)}・帯 ${r2.bn.shown}・ms ${JSON.stringify(r2.b.ms)}）`,
          bo.ok && bo.l.phase === 'fly' && bo.l.tries === bo.t0 + 1 && JSON.stringify(bo.l.ms) === JSON.stringify([p25]) && r2.pr.evs.every((e) => e.kind !== 'milestone') && !r2.bn.shown && JSON.stringify(r2.b.ms) === JSON.stringify([p25]), { bo: { ok: bo.ok, tries: bo.l.tries, ms: bo.l.ms }, evs: r2.pr.evs, bn: r2.bn });
        const r3 = await F(page, async () => {
          await setL(page, BREAK_BELOW(p50 / 100));
          const a = await lg(page);
          const pr = await predict(page, `p.broken >= ${p50 / 100}`, 60);
          if (!pr) return { a, pr };
          await adv(page, pr.n * L.STEP);
          return { a, pr, b: await lg(page), bn: await banner(), raw: await stored(page, 'asteroid.save') };
        });
        if (!r3.pr) throw new Error('60 秒で 50% をこえない');
        const ms3 = r3.pr.evs.filter((e) => e.kind === 'milestone');
        check(`まだもらっていない ${p50}% はもらえる（出来事 ${JSON.stringify(ms3)}・帯「${r3.bn.main}」「${r3.bn.sub}」・ms ${JSON.stringify(r3.b.ms)}）`, ms3.length === 1 && ms3[0].pct === p50 && r3.bn.shown && r3.bn.sub === `＋${L.formatKakera(ms3[0].bonus)} かけら` && JSON.stringify(r3.b.ms) === JSON.stringify([p25, p50]), { ms3, bn: r3.bn, ms: r3.b.ms });
        return { r, h, bo, r2, r3 };
      });
      const sv = JSON.parse(r3.raw);
      check(`ms は保存に入る（asteroid.save の ms ${JSON.stringify(sv.ms)}）`, JSON.stringify(sv.ms) === JSON.stringify([p25, p50]), sv.ms);
      // 壊れた ms：重複・知らない値・文字・配列でない → 捨てて直す（mid は消して星の最初から）
      const rows = [];
      for (const [bad, want] of [[[p50, p25, p25, 99, String(p25)], [p25, p50]], ['25', []], [{ 0: 25 }, []], [[-25, 0, 100, 25.5], []]]) {
        await gotoK(page, { 'asteroid.save': JSON.stringify({ ...sv, mid: undefined, ms: bad }) });
        const l = await lg(page);
        rows.push({ bad, ms: l.ms, ok: JSON.stringify(l.ms) === JSON.stringify(want) && l.star === sv.star && (await gs(page)).phase === 'fly' });
      }
      check(`壊れた ms は直して読む（${rows.map((x) => `${JSON.stringify(x.bad)}→${JSON.stringify(x.ms)}`).join(' ／ ')}）、星はそのまま`, rows.every((x) => x.ok), rows);
      await ctx.close();
    },
  },
  {
    id: 'KW19', tier: 'smoke', title: 'ほしくだき クリアの帯（§18.1 C）：clear の出来事の time（いまの挑戦で使った秒＝limit−left）・best・left（残り時間）・bonus から、#clearBanner に「3ぷん20びょう・はじめて」／「…・ベスト！」／「…・ベスト N」、「ちきゅうまで あと m:ss のこして！」（残りが 0 なら「ぎりぎり まにあった！」）、「＋N かけら」。ベスト時間は速いときだけ bestT に入り asteroid.save に保存、壊れた bestT（キーが整数でない・0・負・文字・大きすぎ）は捨てて 0.1 秒に丸めて読む',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openK(browser, 'KW19', { v: SMOKE_V(), debug: true });
      const parts = () => page.evaluate(() => { const b = document.querySelector('#clearBanner'); const q = (n) => b.querySelector(`[data-part="${n}"]`).textContent.trim(); return { shown: !b.hidden && b.getBoundingClientRect().width > 0, main: q('main'), time: q('time'), dist: q('dist'), sub: q('sub') }; });
      // win で 1 マスにして、clear の出来事まで先を読み、advance で同じ所へ
      const clearOnce = (prep) => frozen(page, async () => {
        if (prep) await setL(page, prep);
        await dbg(page, 'win');
        const a = await lg(page);
        const pr = await predict(page, `evs.some((e) => e.kind === 'clear')`, 60);
        if (!pr) return { a, pr };
        await adv(page, pr.n * L.STEP);
        return { a, pr, ev: pr.evs.find((e) => e.kind === 'clear'), b: await lg(page), ui: await parts(), raw: await stored(page, 'asteroid.save') };
      });
      const want = (ev) => ({
        main: `ほし ${ev.star} クリア！`,
        time: `${fmtT(ev.time)}・${ev.best === null ? 'はじめて' : ev.time < ev.best ? 'ベスト！' : `ベスト ${fmtT(ev.best)}`}`,
        dist: ev.left > 0 ? `ちきゅうまで あと ${L.formatTime(ev.left)} のこして！` : 'ぎりぎり まにあった！',
        sub: ev.bonus > 0 ? `＋${L.formatKakera(ev.bonus)}かけら` : '',
      });
      check(`帯に role="status"（#clearBanner ${await attr(page, '#clearBanner', 'role')}・#msBanner ${await attr(page, '#msBanner', 'role')}・#bossBanner ${await attr(page, '#bossBanner', 'role')}）`, ['#clearBanner', '#msBanner', '#bossBanner'].length === 3 && (await Promise.all(['#clearBanner', '#msBanner', '#bossBanner'].map((q) => attr(page, q, 'role')))).every((x) => x === 'status'), null);
      // 1 回目：いまの挑戦は 200 秒使った（left = limit − 200）、ベストなし → 「3ぷん20びょう・はじめて」
      const r1 = await clearOnce('l.bestT = {}; l.left = l.limit - 200;');
      if (!r1.pr) throw new Error('win のあと 60 秒でクリアにならない');
      const w1 = want(r1.ev), star = r1.ev.star;
      check(`clear の出来事 ${JSON.stringify(r1.ev)}：time は使った秒（limit − left）の 200 秒あまり・best は null・left（残り）は limit 以下`, r1.ev.time >= 200 && r1.ev.time < 260 && r1.ev.best === null && r1.ev.left > 0 && r1.ev.left <= r1.a.limit - 200 + 0.1, r1.ev);
      check(`#clearBanner「${r1.ui.main}」「${r1.ui.time}」「${r1.ui.dist}」「${r1.ui.sub}」が出来事どおり（${w1.time}・${w1.dist}・${w1.sub}）`, r1.ui.shown && r1.ui.main === w1.main && r1.ui.time.startsWith(w1.time) && r1.ui.dist === w1.dist && r1.ui.sub === w1.sub, { ui: r1.ui, w1 });
      const sv1 = JSON.parse(r1.raw);
      check(`ベスト時間を保存（bestT ${JSON.stringify(r1.b.bestT)}・asteroid.save の bestT ${JSON.stringify(sv1.bestT)}）`, r1.b.bestT[star] === r1.ev.time && sv1.bestT && sv1.bestT[star] === r1.ev.time, { b: r1.b.bestT, sv: sv1.bestT });
      // 2 回目：前のベストより速い → 「ベスト！」・bestT が速いほうへ
      await adv(page, L.CLEAR_SEC + 0.2);
      const r2 = await clearOnce(`l.star = ${star}; delete l.rock; l.bestT = { ${star}: 99999 };`);
      const w2 = r2.ev && want(r2.ev);
      check(`前のベスト 99999 秒より速い（${r2.ev && r2.ev.time} 秒）と「${r2.ui && r2.ui.time}」（${w2 && w2.time}）・bestT が ${r2.b && r2.b.bestT[star]} に`, !!r2.ev && r2.ev.star === star && r2.ev.best === 99999 && r2.ui.time.startsWith(w2.time) && /ベスト！$/.test(r2.ui.time) && r2.b.bestT[star] === r2.ev.time, { ev: r2.ev, ui: r2.ui });
      // 3 回目：前のベスト（0.1 秒）より遅い → 「ベスト 1びょう」・bestT は変えない
      await adv(page, L.CLEAR_SEC + 0.2);
      const r3 = await clearOnce(`l.star = ${star}; delete l.rock; l.bestT = { ${star}: 0.1 };`);
      const w3 = r3.ev && want(r3.ev);
      check(`前のベスト 0.1 秒より遅い（${r3.ev && r3.ev.time} 秒）と「${r3.ui && r3.ui.time}」（${w3 && w3.time}）・bestT は 0.1 のまま（${r3.b && r3.b.bestT[star]}）`, !!r3.ev && r3.ev.best === 0.1 && r3.ui.time.startsWith(w3.time) && r3.b.bestT[star] === 0.1, { ev: r3.ev, ui: r3.ui });
      // 壊れた bestT
      const base = JSON.parse(r3.raw);
      const bad = { 1: 12.34, '07': 5, 0: 3, 2: -1, 3: 'x', 4: 1e8, 5: 0.04, 6: null, 10000: 5, 7: 0, '8.5': 3, 9: 1e7 };
      await gotoK(page, { 'asteroid.save': JSON.stringify({ ...base, mid: undefined, bestT: bad }) });
      const lb = await lg(page);
      const wantB = { 1: 12.3, 5: 0.1, 9: 1e7 };
      check(`壊れた bestT（${JSON.stringify(bad)}）は捨てて丸める → ${JSON.stringify(lb.bestT)}、星（${lb.star}）はそのまま、落ちない`, JSON.stringify(lb.bestT) === JSON.stringify(wantB) && lb.star === base.star && (await gs(page)).phase === 'fly', { got: lb.bestT, wantB });
      for (const raw of ['"abc"', '[1,2]', '42', 'null']) {
        await gotoK(page, { 'asteroid.save': JSON.stringify({ ...base, mid: undefined }).replace(/"bestT":\{[^}]*\}/, `"bestT":${raw}`) });
        const l = await lg(page);
        if (JSON.stringify(l.bestT) !== '{}' || l.star !== base.star) { check(`bestT が ${raw} の保存は {} で読む`, false, l.bestT); break; }
      }
      await ctx.close();
    },
  },
  {
    id: 'KW22', tier: 'smoke', title: 'ほしくだき 自機（計画書 §1.2・全部自動）：砲台（turrets）は無く、自機 ship が星の縁を回る。advance で位置が動いて 1 秒の移動が SHIP_SPEED 以下・星の残りのマスから遠ざかりすぎない、撃った弾は自機の近くから出る（ひかえの武器は撃たない）、hold（デバッグ）の間は撃たないが飛ぶ・時間は減る。場を押しても自機の向きは変わらない（KW4）',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openK(browser, 'KW22', { v: SMOKE_V(), debug: true });
      const l0 = await lg(page), s0 = await gs(page);
      check(`砲台は無い（logic に turrets ${'turrets' in l0 ? 'あり' : 'なし'}・getState に turrets ${'turrets' in s0 ? 'あり' : 'なし'}）、自機 ship ${JSON.stringify(s0.ship)}`, !('turrets' in l0) && !('turrets' in s0) && !!s0.ship && Number.isFinite(s0.ship.x) && Number.isFinite(s0.ship.y), s0.ship);
      // 1 秒ずつ 20 回：位置を集める
      const pts = [];
      let shotsSeen = 0, near = null;
      for (let i = 0; i < 20; i++) {
        const st = await adv(page, 1);
        const l = await lg(page);
        pts.push({ x: st.ship.x, y: st.ship.y });
        shotsSeen = Math.max(shotsSeen, l.shots.length);
        // 最も近い残りのマスの中心までの距離
        const R = l.rock; let best = Infinity;
        for (let j = 0; j < R.mats.length; j++) if (R.mats[j]) { const cx = ((j % R.w) + 0.5) * L.CELL, cy = (Math.floor(j / R.w) + 0.5) * L.CELL; best = Math.min(best, Math.hypot(cx - st.ship.x, cy - st.ship.y)); }
        near = Math.max(near === null ? 0 : near, best);
      }
      const steps = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
      const total = steps.reduce((a, c) => a + c, 0);
      check(`自機が動く（20 秒で ${total.toFixed(0)} 単位）、1 秒の移動は最大 ${Math.max(...steps).toFixed(1)}（SHIP_SPEED ${L.SHIP_SPEED} の 2 倍以下。縁に寄るときは速くなる）、残りのマスから離れすぎない（最も遠いとき ${near.toFixed(0)} 単位 ≦ ${(L.RANGE + L.STANDOFF) * L.CELL}）`, total > L.SHIP_SPEED * 5 && Math.max(...steps) <= L.SHIP_SPEED * 2 && near <= (L.RANGE + L.STANDOFF) * L.CELL, { total, steps: steps.map((x) => +x.toFixed(1)), near });
      // 撃った弾は自機の近くから出る：1 step ずつ進めて、最初に弾が見えたときの自機との距離
      // （2026-11-12：自機がふちから 10 マスになり、弾が 4 step ほど飛ぶので、弾が 0 になったあとの新しい弾だけを見る）
      let origin = null, empty = false;
      for (let i = 0; i < 150 && !origin; i++) {
        await adv(page, L.STEP);
        const l = await lg(page);
        if (!l.shots.length) { empty = true; continue; }
        if (empty) origin = Math.min(...l.shots.map((b) => Math.hypot(b.x - l.ship.x, b.y - l.ship.y)));
      }
      check(`弾が出る（見えた最大数 ${shotsSeen}）、出た弾は自機から ${origin && origin.toFixed(1)} 単位以内（2 step で飛ぶ分 ${(L.BULLET_SPEED * L.STEP * 2).toFixed(1)} と 3 マス以内）`, shotsSeen > 0 && origin !== null && origin <= L.BULLET_SPEED * L.STEP * 2 + 3 * L.CELL, { shotsSeen, origin });
      // 持っている武器だけが弾を出す（ひかえの武器は撃たない）
      await setL(page, "l.slots = [{ id: 'shot', lv: 5 }]; l.bench = [{ id: 'beam', lv: 9 }]; l.swap = [];");
      const ids = new Set();
      for (let i = 0; i < 150; i++) { await adv(page, L.STEP); for (const b of (await lg(page)).shots) ids.add(b.w); }
      check(`弾の武器は たま だけ（ひかえの ビーム は撃たない。見えた弾 ${[...ids].join(',') || 'なし'}）`, ids.size > 0 && [...ids].every((w) => w === 'shot'), [...ids]);
      // hold：撃たないが、飛ぶし、時間は減る
      await dbg(page, 'hold', { on: true });
      await adv(page, 1);   // hold の前に撃った弾（飛んでいる途中）が当たり終わるのを待ってから数える（v75：RANGE 20 で弾の飛ぶ時間が延び、hold の直後に 1 マス欠けることがあった）
      const hh =await frozen(page, async () => { const h0 = await lg(page), hs0 = await gs(page); const hs1 = await adv(page, 5); return { h0, hs0, hs1, h1: await lg(page) }; });
      const { h0, hs0, hs1, h1 } = hh;
      check(`hold の間は撃たない（弾 ${h1.shots.length}・残りのマス ${L.progressOf(h0).left} → ${L.progressOf(h1).left}）、自機は飛ぶ（${Math.hypot(hs1.ship.x - hs0.ship.x, hs1.ship.y - hs0.ship.y).toFixed(1)} 単位）、残り時間は減る（${h0.left.toFixed(1)} → ${h1.left.toFixed(1)}）`,
        h1.shots.length === 0 && L.progressOf(h1).left === L.progressOf(h0).left && Math.hypot(hs1.ship.x - hs0.ship.x, hs1.ship.y - hs0.ship.y) > 20 && Math.abs((h0.left - h1.left) - 5) < 0.1, { h0: h0.left, h1: h1.left });
      await ctx.close();
    },
  },
  {
    id: 'KW24', tier: 'smoke', title: 'ほしくだき 古い保存を消す（計画書 §1.6・ユーザー決定「最初から」）：印 asteroid.v3 が無いとき、v:2 の保存（ほし 12・かけら 5 万・武器 4 つ）・bak・asteroid.best 11・asteroid.help が初回に全部消え、ほし 1・たま Lv1・かけら 5 万より少ない・遊び方がもう一度出る、asteroid.v3="1"、保存は v:3 の新しい形。メニューのベスト「ほし 11 まで クリア」が「まだ記録なし」になる。開き直しても（印があるので）新しく書いた best・help は消えない。印があって v:2 の保存が残っていても読まず（bak にも写さず）ほし 1 から。v:1 も同じ',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const old2 = JSON.stringify({ v: 2, star: 12, kakera: 50000, kfrac: 0, slots: [{ id: 'shot', lv: 20 }, { id: 'spread', lv: 15 }, { id: 'bomb', lv: 10 }, { id: 'bolt', lv: 8 }], bench: [], offer: null, swap: [], cleared: false, tries: 1, totals: { cells: 100, stars: 11, kakera: 99999, chunks: 0 }, seed: 7, rng: 9, ms: [], bestT: {} });
      const old1 = JSON.stringify({ v: 1, star: 12, kakera: 50000, slots: [{ id: 'shot', lv: 5 }] });
      const { ctx, page } = await newPage(browser, SMOKE_V(), 'KW24', { clock: true });
      const menuBest = async () => { await page.goto(BASE); await wait(page, 150); return page.evaluate(() => { const b = document.querySelector('a.game[href="games/asteroid/"] .best b'); return b ? b.textContent.trim() : null; }); };
      for (const [name, oldRaw] of [['v:2', old2], ['v:1', old1]]) {
        await seed(page, { 'asteroid.save': oldRaw, 'asteroid.save.bak': '{old-bak', 'asteroid.best': '11', 'asteroid.help': '1', 'matomete.best': '123' });
        const m0 = await menuBest();
        await page.goto(AST); await wait(page, 300);
        const l = await lg(page), s = await gs(page);
        const st = { save: await stored(page, 'asteroid.save'), bak: await stored(page, 'asteroid.save.bak'), best: await stored(page, 'asteroid.best'), help: await stored(page, 'asteroid.help'), v3: await stored(page, 'asteroid.v3'), other: await stored(page, 'matomete.best') };
        const ns = st.save ? JSON.parse(st.save) : null;
        check(`${name} の古い保存で開く：ほし ${l.star}・武器 ${JSON.stringify(l.slots)}・かけら ${l.kakera}、遊び方がもう一度出る（overlay ${s.overlay}）、bak ${st.bak}・best ${st.best}・help は消えた（${st.help}）、印 v3 ${st.v3}、保存は v:${ns && ns.v}・ほし ${ns && ns.star}、ほかのゲームのキーは残る（${st.other}）`,
          l.star === 1 && l.slots.length === 1 && l.slots[0].id === 'shot' && l.slots[0].lv === 1 && l.kakera < 50000 && s.overlay === 'help' && st.bak === null && st.best === null && st.help === null && st.v3 === '1' && !!ns && ns.v === L.SAVE_VERSION && ns.star === 1 && st.other === '123', { l: { star: l.star, slots: l.slots, k: l.kakera }, s: s.overlay, st });
        const m1 = await menuBest();
        check(`${name}：メニューのベスト：開く前の古いベストは出さず（印 asteroid.v3 が無いので「${m0}」）、開いたあとも「${m1}」`, m0 === 'まだ記録なし' && m1 === 'まだ記録なし', { m0, m1 });
      }
      // 開き直しても、新しく書いた best・help は消えない（印があるので 1 回きり）
      await seed(page, { 'asteroid.v3': '1', 'asteroid.help': '1', 'asteroid.best': '3' });
      await page.goto(AST); await wait(page, 300);
      await page.reload(); await wait(page, 300);
      const keep = { best: await stored(page, 'asteroid.best'), help: await stored(page, 'asteroid.help'), s: (await gs(page)).overlay };
      check(`印があれば開き直しても best・help は消えない（best ${keep.best}・help ${keep.help}・遊び方 ${keep.s}）`, keep.best === '3' && keep.help === '1' && keep.s === null, keep);
      // 印があって v:2 / v:1 の保存が残っているとき：読まず（bak にも写さず）新しく始める
      const rows = [];
      for (const [name, oldRaw] of [['v:2', old2], ['v:1', old1]]) {
        await gotoK(page, { 'asteroid.save': oldRaw });
        await wait(page, 100);
        const l = await lg(page), s = await gs(page);
        const ns = JSON.parse(await stored(page, 'asteroid.save'));
        rows.push({ name, ok: l.star === 1 && l.slots.length === 1 && l.kakera < 50000 && s.overlay === null && (await stored(page, 'asteroid.save.bak')) === null && ns.v === L.SAVE_VERSION && (await txt(page, '#hint')) !== HINT_BROKEN, star: l.star, bak: await stored(page, 'asteroid.save.bak') });
      }
      check('印があって古い保存（v:2・v:1）が残っているときは、読まず・bak にも写さず・「ほぞんが よめなかった」も出さず、ほし 1 から新しい v:3 を書く', rows.every((r) => r.ok), rows);
      await ctx.close();
    },
  },
  {
    id: 'KW8', tier: 'full', title: 'ほしくだき 画面内（計画書 §2・§5.3）：SE 縦（ホーム画面・Safari。320×568・320×454）・SE 横（568×320・568×270）・375×667・iPhone 13 縦横・iPad 縦横で、最大の桁（KAKERA_MAX・Lv255（LEVEL_MAX）と Lv254 の値段・いちばん大きい星の番号 STAR_MAX＝長い「ハード333 ほし N」）の 3 台（あたらしい ぶき あり・ひかえ なし）、4 台＋ひかえ 1（あたらしい ぶき（ひかえへ）あり。予約の札「つぎの ほしから …」は 2026-11-12 から無い＝どこにも出ない）、4 台＋ひかえ 2（6 種類。あたらしい ぶき なし）で、#hud・行・#unlockBtn・#swapBtn が画面内・44px 以上（#swapBtn は幅 88px 以上）・重ならない、行は 52px 以上（低い画面＝縦で高さ 620 以下・横で 360 以下は 44px 以上）、文字が欠けない（はみ出し・省略なし）、12px 以上。残り時間の棒 #timeBar と #timeText が画面内。時間切れの #lostCard の「もういちど」は画面内・押せる・44px 以上で、上の #hud と下の武器の行に重ならない。場の canvas は画面いっぱい',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const views = [view('SE', 'p', 'app'), view('SE', 'p', 'safari'), view('SE', 'l', 'app'), view('SE', 'l', 'safari'), custom(375, 667, null, '375×667'), view('i13', 'p', 'app'), view('i13', 'l', 'app'), view('iPad', 'p', 'app'), view('iPad', 'l', 'app')];
      const CASES = [
        // 最大の桁：Lv255（LEVEL_MAX。v74）・Lv254 の値段 8099ちょう・1びょうに 8 けた
        { name: '3 台', n: 3, unlock: true, set: `${ARMS(3, 255)} l.slots[2].lv = 254; l.bench = []; l.swap = [];` },
        // 武器の行の札「てつに つよい」（◎ つき）がボタンにかぶらない（v74 UX 1）：いなずま Lv255 でてつの多い星
        { name: '4 台（いなずま Lv255・てつの星）', n: 4, unlock: true, set: "l.star = 8; l.slots = ['shot', 'spread', 'bolt', 'beam'].map((id) => ({ id, lv: 255 })); l.offer = null; l.bench = []; l.swap = [];" },
        { name: '4 台＋ひかえ 1', n: 4, unlock: true, set: "l.slots = ['shot', 'spread', 'bomb', 'beam'].map((id) => ({ id, lv: 255 })); l.slots[3].lv = 254; l.offer = null; l.bench = [{ id: 'bolt', lv: 255 }]; l.swap = [];" },
        { name: '4 台＋ひかえ 2（6 種類）', n: 4, unlock: false, set: "l.slots = ['shot', 'spread', 'bomb', 'beam'].map((id) => ({ id, lv: 255 })); l.slots[3].lv = 254; l.offer = null; l.bench = [{ id: 'bolt', lv: 255 }, { id: 'fire', lv: 255 }]; l.swap = [];" },
      ];
      for (const v of views) {
        const { ctx, page } = await openK(browser, `KW8 ${v.label}`, { v });
        for (const cs of CASES) {
          const n = cs.n;
          await setL(page, `l.star = L.STAR_MAX; l.cleared = true; l.kakera = L.KAKERA_MAX; ${cs.set}`);
          await wait(page, 300);
          const lp = await layoutProbe(page, '#hud, #back, #helpBtn, #soundBtn, #timeBar, #timeText, .wrow, [data-up], #unlockBtn, #swapBtn', v.safe, { overlapSel: '#back, #gameTitle, #helpBtn, #soundBtn, #kakera, #starLabel, #timeBar, #timeText, #starPct, .wrow, #unlockBtn, #swapBtn', minSel: '#back, #helpBtn, #soundBtn, [data-up], #unlockBtn, #swapBtn' });
          const m = await page.evaluate(() => {
            const vis = (e) => !e.closest('[hidden]') && e.getBoundingClientRect().width > 0;
            const rows = [...document.querySelectorAll('.wrow')].filter(vis).map((e) => Math.round(e.getBoundingClientRect().height));
            const cut = [];
            for (const sel of ['#kakera', '#starLabel', '#starLabel [data-part="num"]', '#timeText', '#starPct', '.wrow [data-part="name"]', '.wrow [data-part="lv"]', '.wrow [data-part="dps"]', '.wrow [data-part="cost"]', '.wrow [data-part="label"]', '#unlockBtn [data-part="cost"]', '#unlockBtn [data-part="label"]', '#unlockBtn [data-part="to"]', '#swapBtn', '#benchCount']) {
              for (const e of document.querySelectorAll(sel)) {
                if (!vis(e)) continue;
                const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
                if (e.scrollWidth > e.clientWidth + 1 && cs.overflow !== 'visible') cut.push(`${sel}「${e.textContent.trim()}」はみ出し ${e.scrollWidth}>${e.clientWidth}`);
                if (cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) cut.push(`${sel} 省略`);
                if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5) cut.push(`${sel}「${e.textContent.trim()}」画面外`);
                // 親（行・ボタン・#hud）の外へはみ出していない
                const box = e.closest('.wrow, #unlockBtn, #swapBtn, #hud');
                if (box && box !== e) { const q = box.getBoundingClientRect(); if (r.left < q.left - 0.5 || r.right > q.right + 0.5) cut.push(`${sel}「${e.textContent.trim()}」が枠の外`); }
              }
            }
            const small = [];
            for (const e of document.querySelectorAll('#hud *, #weapons *, #btnrow *')) {
              if (!vis(e) || ![...e.childNodes].some((x) => x.nodeType === 3 && x.data.trim())) continue;
              const fs = parseFloat(getComputedStyle(e).fontSize);
              if (fs < 12 - 0.01) small.push(`${e.textContent.trim().slice(0, 12)}:${fs}px`);
            }
            const c = document.querySelector('#fieldCanvas').getBoundingClientRect();
            const sw = document.querySelector('#swapBtn');
            const nexts = [...document.querySelectorAll('.wrow [data-next]')].filter(vis).map((e) => e.textContent.trim());   // 予約の札はもう無い（出たら不合格）
            // 札（.good）の右の端が、同じ行の「つよくする」ボタンの左の端より左にある（かぶらない）
            const goodOver = [...document.querySelectorAll('.wrow')].filter(vis).flatMap((row) => {
              const g = row.querySelector('.good'), u = row.querySelector('[data-up]');
              if (!g || !u || g.getBoundingClientRect().width === 0) return [];
              return g.getBoundingClientRect().right > u.getBoundingClientRect().left + 0.5 ? [row.dataset.w + ' 札 ' + Math.round(g.getBoundingClientRect().right) + ' > ボタン ' + Math.round(u.getBoundingClientRect().left)] : [];
            });
            const tb = document.querySelector('#timeBar').getBoundingClientRect();
            return { goodOver, canvas: [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)], rows, cut, small, unlock: vis(document.querySelector('#unlockBtn')), swapW: vis(sw) ? Math.round(sw.getBoundingClientRect().width) : 0, bench: document.querySelector('#benchCount').textContent.trim(), nexts, num: document.querySelector('#starLabel [data-part="num"]').textContent.trim(), bar: [Math.round(tb.width), Math.round(tb.height)], w: innerWidth, h: innerHeight };
          });
          const lv = await lg(page);
          // 低い画面（index.html の @media と同じ境目）は行 44px 以上、ほかは 52px 以上
          const low = (m.h > m.w && m.h <= 620) || (m.w > m.h && m.h <= 360);
          const rowMin = low ? 44 : 52;
          const nextWant = [];   // 予約の札は 2026-11-12 から無い（入れ替えは すぐ）
          // 縦は画面いっぱい。横で背が低い画面（max-height 500px）は左の列だけ（右の 312px は UI。index.html の @media）
          const landscape = m.w > m.h && m.h <= 500;
          const fullCanvas = landscape ? m.canvas[3] >= m.h - 1 && m.canvas[2] >= m.w - 312 - 90 : m.canvas[2] >= m.w - 1 && m.canvas[3] >= m.h - 1;
          const ok = lp.n > 0 && lp.outside.length === 0 && lp.overlaps.length === 0 && lp.small.length === 0 && !lp.hscroll && m.rows.length === n && m.rows.every((h) => h >= rowMin - 0.5) &&
            m.cut.length === 0 && m.goodOver.length === 0 && m.small.length === 0 && m.unlock === cs.unlock && m.swapW >= 88 - 0.5 && fullCanvas && m.bar[0] >= 60 &&
            JSON.stringify(m.nexts) === JSON.stringify(nextWant) && m.bench === (lv.bench.length ? `ひかえ ${lv.bench.length}` : 'ひかえ なし');
          check(`${v.label}・${cs.name}：画面外 ${lp.outside.length}・重なり ${lp.overlaps.length}・44px 未満 ${lp.small.length}・横スクロール ${lp.hscroll}、行の高さ ${m.rows.join('/')}（${rowMin}px 以上${low ? '・低い画面' : ''}）、欠ける文字 ${m.cut.length}・12px 未満 ${m.small.length}、「${m.num}」、残り時間の棒 ${m.bar.join('×')}、canvas ${m.canvas.join(',')}（${landscape ? '横は左の列' : '画面いっぱい'} ${fullCanvas}）、あたらしい ぶき ${m.unlock ? 'あり' : 'なし'}・いれかえ 幅 ${m.swapW}「${m.bench}」・札 ${JSON.stringify(m.nexts)}`, ok, { lp, m, nextWant }, (landscape && n >= 4) ? known('AST-LAND4') : undefined);
        }
        // 時間切れのカード：最大の桁のままでも、画面内・押せる・44px 以上・上の #hud と下の行に重ならない
        await setL(page, 'l.phase = "lost"; l.left = 0;');
        await wait(page, 450);
        const lc = await page.evaluate(() => {
          const card = document.querySelector('#lostCard'), btn = card.querySelector('[data-cmd="retry"]');
          const rc = card.getBoundingClientRect(), rb = btn.getBoundingClientRect();
          const t = document.elementFromPoint(rb.left + rb.width / 2, rb.top + rb.height / 2);
          const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
          const others = ['#hud', '.wrow:not([hidden])', '#unlockBtn', '#swapBtn'].flatMap((s) => [...document.querySelectorAll(s)]).filter((e) => e.getBoundingClientRect().width > 0 && hit(rc, e.getBoundingClientRect())).map((e) => e.id || e.className);
          return { shown: !card.hidden && rc.width > 0, in: rc.left >= -0.5 && rc.right <= innerWidth + 0.5 && rc.top >= -0.5 && rc.bottom <= innerHeight + 0.5, w: Math.round(rb.width), h: Math.round(rb.height), hit: !!t && (t === btn || btn.contains(t)), others, lock: btn.getAttribute('aria-disabled') };
        });
        check(`${v.label}：時間切れの #lostCard が画面内（${lc.in}）・「もういちど」${lc.w}×${lc.h}px・押せる（${lc.hit}・ロック ${lc.lock}）・#hud と下の行に重ならない（${lc.others.join(',') || 'なし'}）`, lc.shown && lc.in && lc.w >= 44 - 0.5 && lc.h >= 44 - 0.5 && lc.hit && lc.lock === null && lc.others.length === 0, lc, (v.label === 'SE縦・Safari') ? known('AST-LOST-SE') : undefined);
        await ctx.close();
      }
    },
  },
  {
    id: 'KW9', tier: 'full', title: 'ほしくだき 長い名前：SE 縦・横（ホーム画面・Safari）・iPhone 13 で #gameTitle の文字が NAME の全部で、欠けない（scrollWidth ≦ clientWidth・「…」なし）・画面からはみ出さない・a#back・？・♪ と重ならない・12px 以上、2行のときは「ちきゅうを守れ！」と「ほしくだき」の間でだけ折れる（文字の範囲の縦は行の高さに切り詰めて測る。T-13 と同じ）。メニュー（320px）のカードの名前も同じ。初回の #help がスクロールなしで「わかった」まで見える',
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
          // 見出しの文字そのものの範囲（行の箱ではなく）。ただし各行の縦は「行の中心 ± line-height/2」に切り詰める（T-13 と同じ。
          // 字体の文字の箱は OS で違い、Range のままだと上下に 0.5px ほどはみ出して ？・♪ と重なったように見えることがある）。横は Range のまま
          const rg = document.createRange(); rg.selectNodeContents(e);
          const lh = parseFloat(cs.lineHeight);   // 'normal' は NaN → 切り詰めない
          const rs = [...rg.getClientRects()].filter((q) => q.width > 0 || q.height > 0).map((q) => {
            const h = Number.isFinite(lh) ? Math.min(q.height, lh) : q.height, c = (q.top + q.bottom) / 2;
            return [q.left, c - h / 2, q.right, c + h / 2];
          });
          const q0 = rg.getBoundingClientRect();
          const tb = rs.length ? [Math.min(...rs.map((x) => x[0])), Math.min(...rs.map((x) => x[1])), Math.max(...rs.map((x) => x[2])), Math.max(...rs.map((x) => x[3]))] : [q0.left, q0.top, q0.right, q0.bottom];
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
          return { text: box.textContent, shown: !box.hidden, top: r.top, bottom: r.bottom, h: r.height, inView: r.top >= -0.5 && r.bottom <= innerHeight + 0.5, sc, hit: !!t && (t === b || b.contains(t)), items: box.querySelectorAll('li').length };
        });
        check(`${v.label}：初回の #help（${h.items} 項目）がスクロールなしで「わかった」まで見えて押せる（下端 ${Math.round(h.bottom)}/${t.h}・高さ ${Math.round(h.h)}）`, h.shown && h.items >= 3 && h.inView && h.sc === 0 && h.hit && h.h >= 44 - 0.5, h, v.label === 'SE横・Safari' ? known('AST-HELP-SE') : undefined);
        check(`${v.label}：遊び方に「ひかる マス」と ◎ の説明がある（${h.items} 項目）`, /ひかる/.test(h.text || '') && /◎/.test(h.text || ''), (h.text || '').slice(0, 200));
        await ctx.close();
      }
      // メニュー（320px）のカード
      const { ctx, page } = await newPage(browser, custom(320, 568, null, 'SE 幅'), 'KW9 メニュー', { clock: true });
      await seed(page, { 'asteroid.v3': '1', 'asteroid.best': String(L.STAR_MAX) });
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
    id: 'KW10', tier: 'full', flaky: { why: 'CPU 4 倍遅くで重いコマの割合・描く時間を測る', checks: /^CPU 4 倍遅くで 10 秒|^描画 drawMs の中央/ }, solo: true, cdp: 'CDP の CPU 低速化', title: 'ほしくだき 性能（§21.5）：gostar で ほし 30（大きな星・48×48 に近い）・4 台 Lv30 にして、CPU 4 倍遅く（CDP）で 10 秒、34ms を超えるコマが 5% 以下・描画 drawMs の中央 8ms 以内・ロジック stepMs の中央 4ms 以内、粒 ≦ 240・弾 ≦ SHOTS_MAX、燃えるマス 80 以上（ほのおの燃え広がり。v74）でも drawMs の中央 8ms 以内',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await newPage(browser, view('SE', 'p', 'app'), 'KW10');
      await seed(page, { 'asteroid.v3': '1', 'asteroid.help': '1' });
      await page.goto(ASTD); await sleep(500);
      if (!(await page.evaluate(() => !!window.AsteroidGame && !!window.YubiDebug))) throw new Error('AsteroidGame・YubiDebug が無い');
      const big = 30;
      await dbg(page, 'gostar', { star: big });
      await setL(page, 'l.slots = l.slots.map((x) => ({ id: x.id, lv: 30 })); l.kakera = 0;');
      const l0 = await lg(page);
      const cells = L.progressOf(l0).total;
      await sleep(2500);
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const a = await gs(page);
      // 弾は 2〜3 コマしか飛ばないので、1 秒おきの読み取りでは撃つ周期とそろって 0 になることがある。ページの中で毎コマ（rAF）の弾の数の最大を数える
      await page.evaluate(() => { const w = window; w.__kwMaxShots = 0; w.__kwStop = false; const tick = () => { try { const n = w.AsteroidGame.getState().shots; if (n > w.__kwMaxShots) w.__kwMaxShots = n; } catch (e) {} if (!w.__kwStop) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
      let maxP = 0, maxS = 0;
      const drawMs = [], stepMs = [];
      for (let i = 0; i < 10; i++) { await sleep(1000); const s = await gs(page); maxP = Math.max(maxP, s.particles); maxS = Math.max(maxS, s.shots); drawMs.push(s.drawMs); stepMs.push(s.stepMs); }
      maxS = Math.max(maxS, await page.evaluate(() => { window.__kwStop = true; return window.__kwMaxShots; }));
      const b = await gs(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      // 全部描き直す回数（星が変わるときだけのはず。rock.key で同じ星を見分ける）：3 秒の間に 1〜2 回まで
      const f0 = (await gs(page)).rockFullRedraws; await sleep(3000); const f1 = (await gs(page)).rockFullRedraws;
      const frames = b.frames - a.frames, slow = b.slowFrames - a.slowFrames;
      const med = (xs) => { const q = xs.slice().sort((x, y) => x - y); return q[Math.floor(q.length / 2)]; };
      check(`ほし ${big}（大きな星 ${L.starInfo(big).boss}・${l0.rock.w}×${l0.rock.h}・${cells} マス）・4 台 Lv30（${JSON.stringify(l0.slots)}）で遊んでいる（phase ${b.phase}・ほし ${b.star}）`, L.starInfo(big).boss && l0.rock.w >= 40 && ['fly', 'clear', 'lost'].includes(b.phase) && b.slots.length === 4 && l0.slots.every((x) => x.lv === 30), { b, slots: l0.slots });
      check(`CPU 4 倍遅くで 10 秒：${frames} コマのうち 34ms を超えたのは ${slow}（${(slow / Math.max(1, frames) * 100).toFixed(1)}%、5% 以下）`, frames >= 150 && slow / frames <= 0.05, { frames, slow }, known('AST-PERF'));
      check(`描画 drawMs の中央 ${med(drawMs)}ms（1 秒ごと ${drawMs.join('/')}。8ms 以内）・ロジック stepMs の中央 ${med(stepMs)}ms（${stepMs.join('/')}。4ms 以内）`, drawMs.length === 10 && drawMs.every(Number.isFinite) && med(drawMs) > 0 && med(drawMs) <= 8 && stepMs.every((x) => Number.isFinite(x) && x >= 0) && med(stepMs) <= 4, { drawMs, stepMs });
      check(`全部描き直す回数 rockFullRedraws が 3 秒で ${f1 - f0} 回（2 回まで。部分の塗り直しが動いている）`, Number.isFinite(f0) && f1 - f0 <= 2, { f0, f1 });
      check(`粒の最大 ${maxP}（≦ 240）・弾の最大 ${maxS}（≦ ${L.SHOTS_MAX}）`, maxP <= 240 && maxS <= L.SHOTS_MAX && maxS > 0, { maxP, maxS });
      // 燃えるマスが多いとき（v74：ほのおが こおり へ燃え広がる。炎の絵・火の粉）も、CPU 4 倍遅くで描画 drawMs の中央が 8ms 以内
      // 場面を決まった形にする：全マスを こおり（コード 3）・体力を大きく（燃えつきない）にして ほのお だけで燃やす（こおりは何段でも燃え広がり、火のなかま 2〜3 つで 80 に届く。星の混ざり方の運に頼らない）
      let burnsMax = 0;
      await dbg(page, 'gostar', { star: 26 });
      await setL(page, "l.slots = [{ id: 'fire', lv: 22 }]; l.bench = []; l.swap = []; l.rock.mats = l.rock.mats.map((m) => (m ? 3 : 0)); l.rock.hp = l.rock.mats.map((m) => (m ? 1e6 : 0));");
      const burnN = () => page.evaluate(() => window.AsteroidGame.logic().burns.length);
      for (let k = 0; k < 40 && burnsMax < 80; k++) { await sleep(300); burnsMax = Math.max(burnsMax, await burnN()); }
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const fireMs = [], fireN = [];
      for (let i = 0; i < 4; i++) { await sleep(700); const s = await gs(page); fireMs.push(s.drawMs); fireN.push(await burnN()); }
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      check(`描画 drawMs の中央 ${med(fireMs)}ms（燃えるマス ${fireN.join('/')}・最大 ${burnsMax}。8ms 以内）`, burnsMax >= 80 && fireMs.every(Number.isFinite) && med(fireMs) <= 8, { fireMs, fireN, burnsMax });
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
    id: 'KW12', tier: 'full', title: 'ほしくだき キーボード：1〜4 でその行を強くする、U であたらしい ぶき、2択は開くと見出し #choiceTitle にフォーカス・出た直後の矢印を受け付けず 400ms 後に → で B・A で A・Tab で #choiceA へ移って Enter、4 台になっても #unlockBtn は「（ひかえへ）」で残り U で選んだ武器は ひかえ に入る（S は KW23）、Tab で [data-up] へ移り Enter で強くする、? で遊び方・Esc で閉じる、M で音のオン・オフ',
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
        // 開いたときのフォーカスは見出し #choiceTitle（枠が「選び済み」に見えないように U14）。Enter は Tab で #choiceA へ移ってから
        const f0 = await page.evaluate(() => document.activeElement && document.activeElement.id);
        let fA = null;
        if (how === 'Enter') { await page.keyboard.press('Tab'); fA = await page.evaluate(() => document.activeElement && document.activeElement.id); }
        await page.keyboard.press(how);
        await wait(page, 50);
        const s3 = await gs(page);
        picks.push({ how, f0, fA, focusOk: f0 === 'choiceTitle' && (how !== 'Enter' || fA === 'choiceA'), open: u.s.overlay === 'choose', locked: u.s2.overlay === 'choose' && u.s2.slots.length === u.s.slots.length, chosen: s3.overlay === null && s3.slots.length === u.s.slots.length + 1 && s3.slots[s3.slots.length - 1].id === (u.s.offer && u.s.offer[k]), offer: u.s.offer, last: s3.slots[s3.slots.length - 1] });
      }
      check(`U で2択が開き（フォーカスは見出し #choiceTitle）、出た直後の矢印は受け付けず、400ms 後に → は B・A は A・Tab で #choiceA へ移って Enter で A を選ぶ（${picks.map((p) => `${p.how}:${p.last && p.last.id}`).join(' ')}）`, picks.every((p) => p.open && p.locked && p.chosen && p.focusOk), picks);
      const ub = await page.evaluate(() => { const b = document.querySelector('#unlockBtn'); const to = b.querySelector('[data-part="to"]'); return { bench: b.dataset.bench || null, to: !!to && !to.hidden && to.getBoundingClientRect().width > 0 ? to.textContent.trim() : null }; });
      check(`4 台になっても #unlockBtn は見えていて「${ub.to}」（data-bench ${ub.bench}）`, (await lg(page)).slots.length === L.SLOTS_MAX && (await shown(page, '#unlockBtn')) && ub.bench === '1' && ub.to === '（ひかえへ）', ub);
      const ku = await frozen(page, async () => { await page.keyboard.press('u'); return gs(page); });
      await wait(page, 450);
      await page.keyboard.press('a'); await wait(page, 50);
      const kb = await gs(page);
      check(`4 台のあと U → A で選んだ ${ku.offer && ku.offer[0]} は ひかえ に Lv1 で入る（砲台 ${kb.slots.length}・ひかえ ${JSON.stringify(kb.bench)}）`, ku.overlay === 'choose' && kb.overlay === null && kb.slots.length === L.SLOTS_MAX && kb.bench.length === 1 && kb.bench[0].id === (ku.offer && ku.offer[0]) && kb.bench[0].lv === 1, { ku: ku.offer, kb: kb.bench });
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
        // 動きを減らす設定ではカメラが回らない（stats().view.rot が変わらない）。ふつうは回る
        const r0 = (await gs(page)).view.rot;
        await wait(page, 3000);   // カメラは描く時間（rAF）で回る。advance は描く時間を進めない
        const r1 = (await gs(page)).view.rot;
        check(`${reduce ? 'reduce' : 'ふつう'}：3 秒待ったあとのカメラの向き rot ${r0} → ${r1}（${reduce ? '変わらない' : '回る'}）`, reduce ? r0 === r1 : r0 !== r1, { r0, r1 });
        await ctx.close();
      }
    },
  },
  {
    id: 'KW14', tier: 'full', audio: true, title: 'ほしくだき 効果音：始め start・撃つ shot・欠ける break・強くする up・足りない deny・あたらしい ぶき unlock・クリア clear・時間切れ lost・ひかり glow（ひかりが砕ける。KL で確かめ、ここは表にあること）が鳴り、すべて "asteroid" の音の表にあり、音の部品が start する。♪でオフにすると鳴らない',
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
      for (let i = 0; i < 40 && (await gs(page)).logicPhase !== 'lost'; i++) await wait(page, 200);   // lost（残り 0.1 秒＋hold のあと実時間で）
      const ps = await plays(page);
      const names = [...new Set(ps.map((p) => p.n))];
      const need = ['start', 'shot', 'break', 'up', 'unlock', 'deny', 'clear', 'lost'];
      check(`鳴った音（${names.join(',')}）に ${need.join('・')} がある`, need.every((n) => names.includes(n)), names);
      const silentNames = need.filter((n) => !ps.some((p) => p.n === n && p.d > 0));
      check(`鳴らした音はすべて "asteroid" の音の表にあり、どの名前も 1 回以上は音の部品が start した（動かなかった名前：${silentNames.join(',') || 'なし'}）`, ps.every((p) => p.known) && silentNames.length === 0, { silentNames, unknown: ps.filter((p) => !p.known) });
      await page.evaluate(() => window.AsteroidGame.retry());
      await wait(page, 300);
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
      check(`KW15 メニューにカードがあり、名前（${c0 && c0.name}）が AsteroidLogic.NAME（${L.NAME}）と一致、説明「${c0 && c0.desc}」は新しい遊びの言葉（「じき」「ちきゅう」。「ほうだい」「せんとうき」なし。計画書 §5.3）、絵が描かれている`, !!c0 && c0.name === L.NAME && !!c0.desc && /じき/.test(c0.desc) && /ちきゅう/.test(c0.desc) && !/ほうだい|せんとうき/.test(c0.desc) && c0.h >= 44 && c0.painted, c0);
      check(`記録が無いときは「まだ記録なし」（${c0 && c0.best}）`, c0 && c0.best === 'まだ記録なし' && c0.none === true, c0);
      const rows = [];
      for (const n of [1, L.ENDING_STAR]) {
        await seed(page, { 'asteroid.v3': '1', 'asteroid.best': String(n) });
        await page.goto(BASE); await wait(page, 150);
        const c = await card();
        rows.push({ n, best: c && c.best, ok: !!c && !c.none && c.best === `ほし ${n} まで クリア` });
      }
      check(`asteroid.best 1・${L.ENDING_STAR} は「ほし N まで クリア」（ハードの表示は KW27）（${rows.map((r) => r.best).join('・')}）`, rows.every((r) => r.ok), rows);
      const bad = [];
      for (const raw of ['0', 'abc', '', '-1', 'NaN', '{}', '1e400', 'Infinity']) {
        await seed(page, { 'asteroid.v3': '1', 'asteroid.best': raw });
        await page.goto(BASE); await wait(page, 150);
        const c = await card();
        if (!c || c.best !== 'まだ記録なし') bad.push(`${raw}: ${c && c.best}`);
      }
      check('壊れた値・0・範囲外（0・abc・空・-1・NaN・{}・1e400・Infinity）はぜんぶ「まだ記録なし」でメニューが落ちない', bad.length === 0, bad);
      await seed(page, { 'asteroid.help': '1', 'asteroid.v3': '1' });
      await page.goto(BASE); await wait(page, 150);
      await page.click('a.game[href="games/asteroid/"]'); await page.waitForURL('**/games/asteroid/', { timeout: 5000 }).catch(() => {});
      check('メニューのカードを押すとゲームが開く', page.url() === AST, page.url());
      await wait(page, 300);
      const ta = await page.evaluate(() => [...document.querySelectorAll('button, a#back, #field, #fieldCanvas')].filter((e) => !e.closest('[hidden]')).map((e) => ({ n: e.id || e.dataset.up || e.tagName, ta: getComputedStyle(e).touchAction })).filter((x) => !['manipulation', 'pan-y', 'none', 'pan-x pan-y'].includes(x.ta)));
      check('ボタン・a#back・場はダブルタップ拡大しない touch-action（manipulation・pan-y・none）', ta.length === 0, ta);
      const onAttr = await page.evaluate(() => ['#field', '#fieldCanvas'].map((s) => document.querySelector(s)).filter(Boolean).flatMap((e) => [...e.attributes].filter((a) => /^on/i.test(a.name)).map((a) => a.name)));
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
      await page.evaluate(() => { localStorage.setItem('asteroid.help', '1'); localStorage.setItem('asteroid.v3', '1'); });
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
  {
    id: 'KW20', tier: 'full', title: 'ほしくだき 星に合う武器（§18.1 C・U6。2026-11-12 の星の種類）：starInfo(star).goods（てつ・こおり・いわ・まざる（てつ と こおり）、きん・ひかり は なし）に WEAPONS の good が入る武器の行だけに ◎（.wrow[data-fit="1"]）、いわ だけの星（main null）では どの行にも付かない。2択カードの冒頭 #choiceLead は「この ほしは ＋ starInfo の lead」（例「この ほしは てつと こおりが まざってるよ」）／いわ だけなら MATS の from から「つぎの ほしから …」「ほし N から … が でてくるよ」、候補のボタンの data-fit も同じ決まり。gostar の表で星の始めの武器になる',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openK(browser, 'KW20', { debug: true });
      const find = (main) => { for (let n = 2; n <= 60; n++) if (L.starInfo(n).main === main) return n; return 0; };
      const nIron = find('iron'), nIce = find('ice'), nRock = find('rock'), nMix = find('mix'), nGold = find('gold');
      let nNone2 = 0; for (let n = 2; n <= 10 && !nNone2; n++) if (L.starInfo(n).main === null) nNone2 = n;
      if (!nIron || !nIce) throw new Error(`starInfo で てつ・こおり の星が見つからない（${nIron}・${nIce}）`);
      const leadWant = (n) => {
        const main = L.starInfo(n).main;
        if (main) return `この ほしは ${L.starInfo(n).lead}`;
        const nx = L.MATS.filter((m) => (m.id === 'iron' || m.id === 'ice') && m.from > n).sort((a, b) => a.from - b.from)[0];
        return nx ? `${nx.from === n + 1 ? 'つぎの ほしから ' : `ほし ${nx.from} から `}${nx.name}が でてくるよ` : '';
      };
      const rows = [];
      for (const n of [1, nNone2, nIron, nIce, nRock, nMix, nGold].filter(Boolean)) {
        const main = L.starInfo(n).main, goods = L.starInfo(n).goods;
        // 4 枠（WEAPONS の前から 4 つ）：◎ の行
        await setL(page, `l.star = ${n}; delete l.rock; ${ARMS(4, 5)}`);
        const fit = await page.evaluate(() => [...document.querySelectorAll('.wrow[data-fit="1"]')].filter((e) => !e.hidden).map((e) => Number(e.dataset.slot)));
        const fitWant = L.WEAPONS.slice(0, 4).map((w, k) => (w.good && goods.includes(w.good) ? k : -1)).filter((k) => k >= 0);
        // 1 枠にして 2択を開く：#choiceLead と候補の data-fit
        await setL(page, `l.star = ${n}; delete l.rock; l.slots = [{ id: 'shot', lv: 1 }]; l.offer = null; l.kakera = L.slotCostOf(l);`);
        const u = await page.evaluate(() => window.AsteroidGame.unlock());
        await wait(page, 50);
        const c = await page.evaluate(() => { const lead = document.querySelector('#choiceLead'); return { lead: lead.hidden ? '' : lead.textContent.trim(), fits: ['#choiceA', '#choiceB'].map((s) => document.querySelector(s).getAttribute('data-fit')) }; });
        const offer = (await gs(page)).offer || [];
        const fitsWant = offer.map((id) => { const g = L.WEAPONS.find((w) => w.id === id).good; return g && goods.includes(g) ? '1' : '0'; });
        rows.push({ n, main, fit, fitWant, lead: c.lead, leadWant: leadWant(n), fits: c.fits, fitsWant, ok: u.ok && JSON.stringify(fit) === JSON.stringify(fitWant) && c.lead === leadWant(n) && JSON.stringify(c.fits) === JSON.stringify(fitsWant) && (goods.length ? fitWant.length > 0 : fitWant.length === 0) && c.lead !== '' });
        await page.evaluate(() => window.AsteroidGame.choose(0));
      }
      check(`◎ と 2択の案内が星の札どおり（${rows.map((r) => `ほし${r.n}(${r.main || 'いわ だけ'})：◎ ${JSON.stringify(r.fit)}・「${r.lead}」・候補 ${r.fits.join('/')}`).join(' ／ ')}）`, rows.length >= 7 && rows.every((r) => r.ok), rows);
      // gostar：星の始めに見合う武器（表）
      const g = await dbg(page, 'gostar', { star: nIron });
      const gl = await lg(page);
      check(`gostar ${nIron} で ほし ${gl.star} の最初（こわした割合 ${L.progressOf(gl).broken}）・武器 ${JSON.stringify(gl.slots)}（Lv1 より強い）`, g.star === nIron && gl.star === nIron && L.progressOf(gl).broken === 0 && gl.slots.length >= 2 && gl.slots.every((x) => x.lv > 1) && gl.phase === 'fly', { g, slots: gl.slots });
      await ctx.close();
    },
  },
  {
    id: 'KW21', tier: 'full', title: 'ほしくだき さいしょから（§19・AS-05）：遊び方の「わかった」の下に文字ボタン #helpRestart（44px 以上）、押すと確認 #restartCard（見出し・本文の決まった言葉、やめる #restartNo が先で primary・フォーカス、出た直後 400ms は押せない、場は止まる）。やめる・Esc で遊び方へ戻り保存は変わらない。さいしょから はじめる で読み直して ほし 1・武器 1 つから、asteroid.best・asteroid.help・ほかのゲームのキーは残り、asteroid.save は新しい・asteroid.save.bak は消える。押した直後の pagehide・hidden・save() でも古い保存を書き戻さず、開き直しても古い進みが戻らない。消せない（removeItem が何もしない）ときは読み直さず古い状態のまま続け、カードを閉じて #hint「けせなかったよ。もう いちど ためしてね」と console.error、保存も止めたままにしない。SE 縦・横で確認のボタンが画面内・44px 以上',
    async run({ browser, check, errors }) {
      const others = { 'matomete.best': '123', 'seizai.best': '3' };
      // 古い進み：ほし 6・かけら 多め・武器 3 つ。bak も置いておく（消えること）
      const prep = async (page) => {
        await gotoK(page, { ...others, 'asteroid.best': '7', 'asteroid.save.bak': '{old-bak' }, { debug: true });
        await setL(page, `l.star = 6; l.kakera = 123456; ${ARMS(3, 9)}`);
        await page.evaluate(() => window.AsteroidGame.save());
        return stored(page, 'asteroid.save');
      };
      const { ctx, page } = await openK(browser, 'KW21', { v: SMOKE_V(), debug: true });
      const e0 = errors.length;
      const old = await prep(page);
      check(`前提：古い保存が ほし 6（${old && JSON.parse(old).star}）`, !!old && JSON.parse(old).star === 6, old);
      // (a) 遊び方に文字ボタン、押すと確認
      await page.click('#helpBtn'); await wait(page, 60);
      const hb = await page.evaluate(() => {
        const ok = document.querySelector('#helpOk'), b = document.querySelector('#helpRestart');
        if (!b) return null;
        const r = b.getBoundingClientRect(), o = ok.getBoundingClientRect();
        return { text: b.textContent.trim(), h: r.height, w: r.width, below: r.top >= o.bottom - 0.5 || r.left >= o.right - 0.5, order: !!(ok.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING), okPrimary: ok.classList.contains('primary'), primary: b.classList.contains('primary'), inHelp: !!b.closest('#help') };
      });
      check(`遊び方に「さいしょから あそぶ」（${hb && hb.text}・${hb && Math.round(hb.h)}px）が「わかった」（primary のまま）の後ろにあり、目立たない（primary でない）`, !!hb && hb.text === 'さいしょから あそぶ' && hb.h >= 44 - 0.5 && hb.w >= 44 - 0.5 && hb.below && hb.order && hb.okPrimary && !hb.primary && hb.inHelp, hb);
      await pressCard(page, '#helpRestart');
      const c = await page.evaluate(() => {
        const box = document.querySelector('#restartCard'), no = document.querySelector('#restartNo'), yes = document.querySelector('#restartYes');
        return { shown: !!box && !box.hidden, helpHidden: document.querySelector('#help').hidden, title: document.querySelector('#restartTitle')?.textContent.trim(), text: document.querySelector('#restartText')?.textContent.trim(),
          no: no?.textContent.trim(), yes: yes?.textContent.trim(), noFirst: !!(no && yes && (no.compareDocumentPosition(yes) & Node.DOCUMENT_POSITION_FOLLOWING)), noPrimary: !!no?.classList.contains('primary'), yesPrimary: !!yes?.classList.contains('primary'),
          focus: document.activeElement === no, role: box?.getAttribute('role'), label: box?.getAttribute('aria-labelledby'), locked: yes?.getAttribute('aria-disabled') === 'true' };
      });
      const s1 = await gs(page);
      check(`確認カード：見出し「${c.title}」・本文「${c.text}」・「${c.no}」が先で primary・フォーカス、「${c.yes}」、overlay ${s1.overlay}・phase ${s1.phase}、遊び方は隠れる、出た直後はロック`,
        c.shown && c.helpHidden && c.title === 'さいしょから はじめる？' && c.text === 'いまの ほし・かけら・ぶきは ぜんぶ きえるよ。ベストの きろくは のこるよ。' && c.no === 'やめる' && c.yes === 'さいしょから はじめる' && c.noFirst && c.noPrimary && !c.yesPrimary && c.focus && c.role === 'dialog' && c.label === 'restartTitle' && c.locked && s1.overlay === 'restart' && s1.phase === 'paused', { c, s1: { overlay: s1.overlay, phase: s1.phase } });
      // 出た直後（400ms の間）に押しても始め直さない・場は止まる
      await clickAt(page, '#restartYes');
      const t0 = (await lg(page)).t;
      await adv(page, 5); await wait(page, 500);
      const s2 = await gs(page);
      check(`出た直後の「さいしょから はじめる」は効かない（overlay ${s2.overlay}・ほし ${s2.star}）、確認の間は t が進まない（${t0} → ${s2.t}）`, s2.overlay === 'restart' && s2.star === 6 && s2.t === t0 && (await stored(page, 'asteroid.save')) === old, { overlay: s2.overlay, star: s2.star, t0, t: s2.t });
      // (b) やめる → 遊び方に戻る・保存は変わらない。Esc でも同じ
      await pressCard(page, '#restartNo');
      const b1 = { s: await gs(page), save: await stored(page, 'asteroid.save'), bak: await stored(page, 'asteroid.save.bak'), card: await page.evaluate(() => document.querySelector('#restartCard').hidden) };
      await pressCard(page, '#helpRestart');
      await unlocked(page, '#restartNo');
      await page.keyboard.press('Escape'); await wait(page, 60);
      const b2 = { s: await gs(page), save: await stored(page, 'asteroid.save'), bak: await stored(page, 'asteroid.save.bak') };
      check(`やめる・Esc で遊び方へ戻る（overlay ${b1.s.overlay}・${b2.s.overlay}）、ほし ${b2.s.star}・かけら ${b2.s.kakera}・asteroid.save と bak は変わらない`,
        b1.s.overlay === 'help' && b1.card && b2.s.overlay === 'help' && b1.save === old && b2.save === old && b1.bak === '{old-bak' && b2.bak === '{old-bak' && b2.s.star === 6 && b2.s.kakera === 123456 && b2.s.slots.length === 3, { b1: { overlay: b1.s.overlay, same: b1.save === old, bak: b1.bak }, b2: { overlay: b2.s.overlay, same: b2.save === old, bak: b2.bak } });
      // (c) さいしょから はじめる → 読み直して新しい状態
      await pressCard(page, '#helpRestart');
      if (!(await unlocked(page, '#restartYes'))) throw new Error('#restartYes のロックが外れない');
      await Promise.all([page.waitForEvent('load', { timeout: 10000 }), page.click('#restartYes')]);
      await wait(page, 300);
      const n1 = { l: await lg(page), s: await gs(page), save: await stored(page, 'asteroid.save'), bak: await stored(page, 'asteroid.save.bak'), best: await stored(page, 'asteroid.best'), help: await stored(page, 'asteroid.help'),
        others: await page.evaluate((ks) => Object.fromEntries(ks.map((k) => [k, localStorage.getItem(k)])), Object.keys(others)) };
      const ns = n1.save ? JSON.parse(n1.save) : null;
      check(`さいしょから：ほし ${n1.l.star}・武器 ${JSON.stringify(n1.l.slots)}・かけら ${n1.l.kakera}、遊び方は出ない（overlay ${n1.s.overlay}）、best ${n1.best}・help ${n1.help}・ほかのゲームのキーは残る、asteroid.save は新しい（ほし ${ns && ns.star}）・bak ${n1.bak}`,
        n1.l.star === 1 && n1.l.slots.length === 1 && n1.l.slots[0].id === 'shot' && n1.l.slots[0].lv === 1 && n1.l.kakera < 123456 && n1.s.overlay === null && n1.s.phase === 'fly' && n1.best === '7' && n1.help === '1' && JSON.stringify(n1.others) === JSON.stringify(others) && !!ns && ns.star === 1 && ns.slots.length === 1 && n1.bak === null && n1.s.best === 7,
        { star: n1.l.star, slots: n1.l.slots, kakera: n1.l.kakera, overlay: n1.s.overlay, best: n1.best, help: n1.help, bak: n1.bak, save: ns && { star: ns.star, slots: ns.slots }, others: n1.others });
      // (d) 押した直後に pagehide・hidden・save() が来ても古い状態を書き戻さない、開き直しても古い進みが戻らない
      const old2 = await prep(page);
      await page.click('#helpBtn'); await wait(page, 60);
      await pressCard(page, '#helpRestart');
      if (!(await unlocked(page, '#restartYes'))) throw new Error('#restartYes のロックが外れない（2回目）');
      const [, d] = await Promise.all([page.waitForEvent('load', { timeout: 10000 }), page.evaluate(() => {
        document.querySelector('#restartYes').click();
        const after = [];
        const read = (why) => after.push({ why, save: localStorage.getItem('asteroid.save'), bak: localStorage.getItem('asteroid.save.bak') });
        read('押した直後');
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
        read('pagehide');
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        read('hidden');
        const r = window.AsteroidGame.save();
        window.AsteroidGame.advance(30);
        read('save()・advance');
        return { after, r };
      })]);
      check(`押した直後・pagehide・hidden・save()・advance のあとも asteroid.save と bak は空のまま（${d.after.map((x) => `${x.why} ${x.save === null ? '空' : 'あり'}/${x.bak === null ? '空' : 'あり'}`).join('・')}）、save() は false`,
        !!old2 && d.after.length === 4 && d.after.every((x) => x.save === null && x.bak === null) && d.r === false, d);
      await wait(page, 300);
      const d1 = await lg(page);
      await page.goto(BASE + 'manifest.webmanifest');
      await page.goto(AST); await wait(page, 300);
      const d2 = await lg(page);
      const raw2 = await stored(page, 'asteroid.save');
      check(`読み直し後（ほし ${d1.star}）も、離れて開き直したあと（ほし ${d2.star}・武器 ${d2.slots.length}・かけら ${d2.kakera}）も古い進みが戻らない、bak なし`,
        d1.star === 1 && d1.slots.length === 1 && d2.star === 1 && d2.slots.length === 1 && d2.kakera < 123456 && JSON.parse(raw2).star === 1 && (await stored(page, 'asteroid.save.bak')) === null && (await stored(page, 'asteroid.best')) === '7', { d1: { star: d1.star, slots: d1.slots }, d2: { star: d2.star, slots: d2.slots, k: d2.kakera } });
      check('さいしょからの間にページエラーが無い', errors.length === e0, errors.slice(e0));
      // (e) 消せないとき（removeItem が何もしない。§19.2 R6、もくもくこうば WW25 と同じ）：読み直さず、古い状態のまま続け、カードを閉じて必ず知らせる
      const old3 = await prep(page);
      const e1 = errors.length;
      await page.evaluate(() => { window.__kw21 = 1; Storage.prototype.removeItem = function () {}; });
      await page.click('#helpBtn'); await wait(page, 60);
      await pressCard(page, '#helpRestart');
      if (!(await unlocked(page, '#restartYes'))) throw new Error('#restartYes のロックが外れない（消せないとき）');
      await page.click('#restartYes');
      await wait(page, 500);
      const same = await page.evaluate(() => window.__kw21 === 1);
      const e5 = await gs(page);
      const f5 = await page.evaluate(() => new Promise((ok) => { const f0 = window.AsteroidGame.getState().frames; setTimeout(() => ok([f0, window.AsteroidGame.getState().frames]), 400); }));
      const c5 = e5.saveCount, r5 = await page.evaluate(() => window.AsteroidGame.save()), c6 = (await gs(page)).saveCount;
      const hint5 = await txt(page, '#hint');
      const errs5 = errors.slice(e1);
      check(`消せないとき：読み直さない（${same}）・ほし ${e5.star}・武器 ${e5.slots.length} のまま・カードを閉じる（overlay ${e5.overlay}・phase ${e5.phase}）・場が動く（frames ${f5[0]} → ${f5[1]}）・#hint「${hint5}」・保存は止めたままにしない（save() ${r5}・saveCount ${c5} → ${c6}）・bak も残る・console.error あり`,
        !!old3 && same && e5.star === 6 && e5.slots.length === 3 && e5.kakera >= 123456 && e5.overlay === null && e5.phase === 'fly' && f5[1] > f5[0] && hint5 === 'けせなかったよ。もう いちど ためしてね' && r5 === true && c6 === c5 + 1 && (await stored(page, 'asteroid.save.bak')) === '{old-bak' && JSON.parse(await stored(page, 'asteroid.save')).star === 6 && errs5.length >= 1 && errs5.every((e) => /さいしょから/.test(e)),
        { same, star: e5.star, slots: e5.slots.length, overlay: e5.overlay, phase: e5.phase, f5, hint5, r5, c5, c6, errs5 });
      errors.splice(e1);
      await ctx.close();
      // 画面内：SE 縦・横（ホーム画面・Safari）で「さいしょから あそぶ」と確認の 2 つのボタンが見えて押せる・44px 以上・重ならない
      const rows = [];
      for (const v of [view('SE', 'p', 'app'), view('SE', 'p', 'safari'), view('SE', 'l', 'app'), view('SE', 'l', 'safari')]) {
        const o = await openK(browser, `KW21 ${v.label}`, { v, help: false });
        const probe = (sels) => o.page.evaluate((sels) => sels.map((s) => {
          const e = document.querySelector(s), r = e.getBoundingClientRect();
          const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { s, h: Math.round(r.height), w: Math.round(r.width), in: r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5, hit: !!t && (t === e || e.contains(t)), box: [r.left, r.top, r.right, r.bottom] };
        }), sels);
        const lap = (a, b) => a.box[0] < b.box[2] - 0.5 && b.box[0] < a.box[2] - 0.5 && a.box[1] < b.box[3] - 0.5 && b.box[1] < a.box[3] - 0.5;
        const h = await probe(['#helpOk', '#helpRestart']);
        await pressCard(o.page, '#helpRestart');
        const r = await probe(['#restartNo', '#restartYes']);
        const all = [...h, ...r];
        rows.push({ v: v.label, ok: all.every((x) => x.in && x.hit && x.h >= 44 - 0.5 && x.w >= 44 - 0.5) && !lap(h[0], h[1]) && !lap(r[0], r[1]), all: all.map((x) => `${x.s} ${x.w}×${x.h}${x.in ? '' : ' 画面外'}${x.hit ? '' : ' 押せない'}`) });
        await o.ctx.close();
      }
      const lab = (r) => r.v + (r.ok ? ' ○' : ' ×');
      check(`SE 縦・横で「わかった」「さいしょから あそぶ」「やめる」「さいしょから はじめる」が画面内・押せる・44px 以上・重ならない（${rows.map(lab).join('・')}。SE 横・Safari は下の既知）`, rows.filter((r) => r.v !== 'SE横・Safari').every((r) => r.ok), rows);
      check('SE 横・Safari（568×270）でも遊び方の 2 つのボタンと確認のボタンが画面内・押せる', rows.filter((r) => r.v === 'SE横・Safari').every((r) => r.ok), rows, known('AST-HELP-SE'));
    },
  },
  {
    id: 'KW23', tier: 'full', title: 'ほしくだき ひかえと入れ替え（§3.6・§5.3・§21.7。2026-11-12 から すぐ替わる：ユーザー「武器の交換は、麺が始まってから自由に変えれるようにしてください」）：ひかえが空なら #swapBtn でカードが開かずヒント。4 台のあとの「あたらしい ぶき（ひかえへ）」は2択の案内「えらんだ ぶきは ひかえ（いま つかわない ぶき）に はいるよ」で、選んだ武器は ひかえ に Lv1（#hint は 2 行まで・#benchCount・#swapBtn が一度光る（動きを減らす設定では光らない））、持ったことが無い武器には替えられない・ひかえの武器は強くできない、残り 1 つは候補 1 枚（#choiceB なし・見出し「さいごの 1つ！」・注記「これで 6しゅるい ぜんぶ そろうよ」）、6 種類で #unlockBtn が消える。#swapBtn → #swapCard（出た直後 400ms は押せない・場が止まる・a#back で戻れる・枠のボタン・#benchList に swapChoicesOf の全部と覚えている Lv・今の武器は「いま つかってる」・#swapText「えらぶと すぐ かわるよ…」）、ひかえ の武器を押すと星の途中でも その場で替わる（音 swap・ヒント「○○に いれかえたよ」・行の名前と Lv がすぐ変わる・外した武器は その Lv で ひかえ へ・予約の札 [data-next] は無い）、戻すと覚えていた Lv、再読み込みで残る、時間切れの札の間も替えられ「もういちど」でそのまま、クリアの次の星で勝手に替わらない。キーボード（S・1〜4・←→・Enter・Esc）だけでもできる。SE 縦横でカードのボタンが画面内・44px 以上・重ならない',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const wName = (id) => L.WEAPONS.find((w) => w.id === id)?.name;
      const { ctx, page } = await openK(browser, 'KW23', { debug: true, opts: { initScript: SFX_SPY, touch: false } });
      const sounds = async (from) => (await plays(page)).slice(from).map((x) => x.n);
      // 行の名前と Lv（予約の札 [data-next]・data-has-next は 2026-11-12 から無い）
      const rowNext = (k) => page.evaluate((k) => { const r = document.querySelector(`.wrow[data-slot="${k}"]`);
        return { next: document.querySelectorAll('[data-next]').length, has: r.dataset.hasNext || null, name: r.querySelector('[data-part="name"]').textContent.trim(), lv: r.querySelector('[data-part="lv"]').textContent.trim() }; }, k);
      const benchBtns = () => page.evaluate(() => [...document.querySelectorAll('#benchList [data-swap-to]')].map((b) => ({ id: b.dataset.swapTo, text: b.textContent.replace(/\s+/g, ' ').trim(), pressed: b.getAttribute('aria-pressed') })));
      const slotBtns = () => page.evaluate(() => [...document.querySelectorAll('[data-swap-slot]')].filter((b) => !b.hidden).map((b) => b.getAttribute('aria-pressed')));
      // (1) ひかえが空：開かずにヒント
      const e0 = await page.evaluate(() => ({ count: document.querySelector('#benchCount').textContent.trim(), dis: document.querySelector('#swapBtn').getAttribute('aria-disabled') }));
      await clickAt(page, '#swapBtn'); await wait(page, 50);
      const e1 = await gs(page);
      check(`ひかえが空：#benchCount「${e0.count}」・#swapBtn aria-disabled ${e0.dis}、押してもカードは開かず（overlay ${e1.overlay}）ヒント「${e1.hint}」`, e0.count === 'ひかえ なし' && e0.dis === 'true' && e1.overlay === null && !(await shown(page, '#swapCard')) && e1.hint === 'ひかえの ぶきが まだ ないよ', { e0, e1: { overlay: e1.overlay, hint: e1.hint } });
      // (2) 4 台のあと「あたらしい ぶき（ひかえへ）」
      const FOUR = [{ id: 'shot', lv: 5 }, { id: 'spread', lv: 6 }, { id: 'bomb', lv: 7 }, { id: 'bolt', lv: 8 }];
      await setL(page, `l.star = 3; delete l.rock; l.slots = ${JSON.stringify(FOUR)}; l.bench = []; l.swap = []; l.offer = null; l.kakera = L.KAKERA_MAX;`);
      await wait(page, 50);
      const l2 = await lg(page);
      const u0 = await page.evaluate(() => { const b = document.querySelector('#unlockBtn'); const to = b.querySelector('[data-part="to"]'); return { shown: !b.hidden && b.getBoundingClientRect().width > 0, bench: b.dataset.bench || null, to: to && !to.hidden ? to.textContent.trim() : null, cost: b.querySelector('[data-part="cost"]').textContent.trim() }; });
      check(`4 台でも #unlockBtn が見えて「（ひかえへ）」（${u0.to}・data-bench ${u0.bench}）・値段「${u0.cost}」= slotCostOf`, u0.shown && u0.to === '（ひかえへ）' && u0.bench === '1' && u0.cost === L.formatKakera(L.slotCostOf(l2)) && L.slotCostOf(l2) !== null, u0);
      const n0 = (await plays(page)).length;
      const c1 = await frozen(page, async () => { await clickAt(page, '#unlockBtn'); return { s: await gs(page), lead: await txt(page, '#choiceLead') }; });
      const offer = c1.s.offer || [];
      const rest = L.WEAPONS.map((w) => w.id).filter((id) => !FOUR.some((x) => x.id === id));
      check(`2択（overlay ${c1.s.overlay}）の候補 ${JSON.stringify(offer)} は持っていない残りの 2 つ（${rest}）、案内「${c1.lead}」に「えらんだ ぶきは ひかえ（いま つかわない ぶき）に はいるよ」`, c1.s.overlay === 'choose' && offer.length === 2 && offer.every((id) => rest.includes(id)) && offer[0] !== offer[1] && (c1.lead || '').includes('えらんだ ぶきは ひかえ（いま つかわない ぶき）に はいるよ'), c1);
      // ひかえが 0 → 1 になったら #swapBtn を一度だけ光らせる（.flash。動きを減らす設定では光らせない）
      await page.evaluate(() => { window.__swapFlash = 0; new MutationObserver(() => { if (document.querySelector('#swapBtn').classList.contains('flash')) window.__swapFlash++; }).observe(document.querySelector('#swapBtn'), { attributes: true, attributeFilter: ['class'] }); });
      await pressCard(page, '#choiceA');
      const p1 = await gs(page);
      const hint1 = await txt(page, '#hint');
      const flash1 = await page.evaluate(() => window.__swapFlash >= 1), calm1 = await page.evaluate(() => document.body.dataset.calm === '1');
      const h1Lines = await page.evaluate(() => { const h = document.querySelector('#hint'); const lh = parseFloat(getComputedStyle(h).lineHeight) || 16; return Math.round(h.getBoundingClientRect().height / lh); });
      check(`選んだ ${wName(offer[0])} は ひかえ に Lv1（${JSON.stringify(p1.bench)}）、砲台は 4 台のまま（${JSON.stringify(p1.slots)}）、ヒント「${hint1}」（${h1Lines} 行・2 行まで）、#swapBtn が光る（${flash1}${calm1 ? '・動きを減らす設定' : ''}）、#benchCount「${await txt(page, '#benchCount')}」・#swapBtn が押せる、音 unlock`,
        JSON.stringify(p1.bench) === JSON.stringify([{ id: offer[0], lv: 1 }]) && JSON.stringify(p1.slots) === JSON.stringify(FOUR) && hint1 === `${wName(offer[0])}が ひかえ（おやすみ中の ぶき）に はいったよ。「いれかえ」で つかえるよ` && h1Lines <= 2 && (calm1 || flash1) && (await txt(page, '#benchCount')) === 'ひかえ 1' && (await attr(page, '#swapBtn', 'aria-disabled')) === null && (await sounds(n0)).includes('unlock'), { p1, hint1 });
      // 一度持った武器だけ：まだ持っていない武器には替えられない。ひかえの武器は強くできない
      const never = offer[1];
      const rs = await page.evaluate((id) => window.AsteroidGame.swapWeapon(0, id), never);
      const upB = await page.evaluate((k) => window.AsteroidGame.upgrade(k), 4);
      const l3 = await lg(page);
      check(`持ったことが無い ${wName(never)} には替えられない（${JSON.stringify(rs)}・砲台 ${l3.slots.map((x) => x.id)}）、選べるのは今の武器と ひかえ だけ（${JSON.stringify(L.swapChoicesOf(l3, 0))}）、ひかえの武器は強くできない（upgrade(4) ${JSON.stringify(upB)}・ひかえ ${JSON.stringify(l3.bench)}）`,
        rs && rs.ok === false && JSON.stringify(l3.slots) === JSON.stringify(FOUR) && JSON.stringify(L.swapChoicesOf(l3, 0)) === JSON.stringify(['shot', offer[0]]) && upB && upB.ok === false && JSON.stringify(l3.bench) === JSON.stringify([{ id: offer[0], lv: 1 }]), { rs, upB });
      // (3) 残り 1 つ：候補 1 枚
      const c2 = await frozen(page, async () => { await clickAt(page, '#unlockBtn'); return { s: await gs(page), title: await txt(page, '#choiceTitle'), note: await txt(page, '#choiceNote'), b: await shown(page, '#choiceB'), a: await txt(page, '#choiceA [data-part="name"]') }; });
      check(`残り 1 つ（${wName(never)}）は候補 1 枚：offer ${JSON.stringify(c2.s.offer)}・#choiceB ${c2.b ? 'あり' : 'なし'}・見出し「${c2.title}」・注記「${c2.note}」・「${c2.a}」`, JSON.stringify(c2.s.offer) === JSON.stringify([never]) && !c2.b && c2.title === 'さいごの 1つ！' && c2.note === 'これで 6しゅるい ぜんぶ そろうよ' && c2.a === wName(never), c2);
      await pressCard(page, '#choiceA');
      const p2 = await gs(page), l4 = await lg(page);
      const ul = await page.evaluate(() => window.AsteroidGame.unlock());
      check(`6 種類そろう（ひかえ ${JSON.stringify(p2.bench)}）と #unlockBtn が消える（${await shown(page, '#unlockBtn') ? 'ある' : 'なし'}）・slotCostOf ${L.slotCostOf(l4)}・unlock() ${JSON.stringify(ul && { ok: ul.ok, reason: ul.reason })}・「${await txt(page, '#benchCount')}」`,
        p2.bench.length === 2 && p2.bench[1].id === never && !(await shown(page, '#unlockBtn')) && (await shown(page, '#swapBtn')) && L.slotCostOf(l4) === null && ul && ul.ok === false && ul.reason === 'all' && (await txt(page, '#benchCount')) === 'ひかえ 2', { bench: p2.bench, ul });
      // (4) 入れ替えのカード：ひかえ の Lv を覚えている（12 と 3）
      await setL(page, 'l.bench = l.bench.map((x, j) => ({ id: x.id, lv: j === 0 ? 12 : 3 }));');
      const B0 = offer[0], B1 = never;
      const k1 = await frozen(page, async () => {
        const t0 = (await lg(page)).t;
        await clickAt(page, '#swapBtn');
        const s = await gs(page);
        const ph = await page.evaluate(() => document.body.dataset.phase);
        const locked = await page.evaluate(() => [...document.querySelectorAll('#swapCard button')].filter((b) => !b.hidden).every((b) => b.getAttribute('aria-disabled') === 'true'));
        await clickAt(page, `#benchList [data-swap-to="${B0}"]`);   // 出た直後（400ms 以内）
        const s2 = await gs(page);
        await adv(page, 5);
        const t1 = (await lg(page)).t;
        return { t0, t1, s, ph, locked, s2, list: await benchBtns(), slots: await slotBtns(), back: await reachable(page, 'a#back'), title: await txt(page, '#swapTitle'), text: await txt(page, '#swapText') };
      });
      const l5 = await lg(page);
      const want0 = L.swapChoicesOf(l5, 0);
      check(`#swapBtn で #swapCard（overlay ${k1.s.overlay}・body ${k1.ph}・「${k1.title}」・「${k1.text}」）、出た直後は押せない（ロック ${k1.locked}・押しても砲台 ${k1.s2.slots.map((x) => x.id)}）、カードの間は止まる（advance(5) で t ${k1.t0} → ${k1.t1}）`,
        k1.s.overlay === 'swap' && k1.ph === 'paused' && k1.title === 'どの ぶきに かえる？' && k1.text === 'えらぶと すぐ かわるよ。はずした ぶきは その Lv の まま ひかえに もどるよ' && k1.locked && JSON.stringify(k1.s2.slots) === JSON.stringify(FOUR) && k1.t1 === k1.t0, k1);
      check(`#swapCard の上でも a#back が押せる（${k1.back}）`, k1.back, k1.back, known('AST-BACK'));
      const lvOf = (x) => (x.text.match(/Lv(\d+)/) || [])[1];
      check(`枠のボタン ${k1.slots.length} 個（aria-pressed ${k1.slots.join('/')}）、#benchList ${JSON.stringify(k1.list.map((x) => `${x.id}:Lv${lvOf(x)}`))} が swapChoicesOf(0) ${JSON.stringify(want0)}・今の たま は「いま つかってる」Lv5・ひかえは覚えている Lv（12・3）`,
        JSON.stringify(k1.slots) === JSON.stringify(['true', 'false', 'false', 'false']) && JSON.stringify(k1.list.map((x) => x.id)) === JSON.stringify(want0) && want0.length === 3 && /いま つかってる/.test(k1.list[0].text) && lvOf(k1.list[0]) === '5' && lvOf(k1.list[1]) === '12' && lvOf(k1.list[2]) === '3', k1.list);
      const t2a = (await lg(page)).t;
      await wait(page, 1500);
      check(`カードの間は実時間でも止まる（t ${t2a} → ${(await lg(page)).t}）`, (await lg(page)).t === t2a, null);
      if (!(await unlocked(page, '#swapDone'))) throw new Error('#swapCard のロックが外れない');
      // (5) 枠 3 つ目（いま どかん Lv7）を B0 に：その場で替わる（星の途中）
      const n1 = (await plays(page)).length;
      await page.click('[data-swap-slot="2"]'); await wait(page, 30);
      const sl2 = await slotBtns();
      const list2 = await benchBtns();
      await page.click(`#benchList [data-swap-to="${B0}"]`); await wait(page, 50);
      const s3 = await gs(page), r2 = await rowNext(2), hint3 = await txt(page, '#hint'), list2b = await benchBtns();
      check(`枠 3 を選ぶ（${sl2.join('/')}・候補 ${list2.map((x) => x.id)}）→ ${wName(B0)} を押すと すぐ替わる（枠 3 ${JSON.stringify(s3.slots[2])}・ひかえ ${JSON.stringify(s3.bench)}）・音 swap（${(await sounds(n1)).join(',')}）・ヒント「${hint3}」・行「${r2.name} ${r2.lv}」・予約の札 ${r2.next} 個・候補は ${list2b.map((x) => x.id)}（今は ${wName(B0)}）`,
        JSON.stringify(sl2) === JSON.stringify(['false', 'false', 'true', 'false']) && list2[0].id === 'bomb' && JSON.stringify(s3.slots[2]) === JSON.stringify({ id: B0, lv: 12 }) && s3.bench.some((x) => x.id === 'bomb' && x.lv === 7) && (await sounds(n1)).includes('swap') && hint3 === `${wName(B0)}に いれかえたよ` && r2.name === wName(B0) && r2.lv === 'Lv12' && r2.next === 0 && r2.has === null && list2b[0].id === B0 && /いま つかってる/.test(list2b[0].text) && s3.phase !== 'end', { s3: s3.slots, r2, hint3 });
      // 枠 4（いなずま Lv8）：B1 に替えて、いなずま に戻すと覚えていた Lv8、もう一度 B1
      await page.click('[data-swap-slot="3"]'); await wait(page, 30);
      const list3 = await benchBtns();
      await page.click(`#benchList [data-swap-to="${B1}"]`); await wait(page, 30);
      const sw3 = (await gs(page)).slots[3];
      await page.click('#benchList [data-swap-to="bolt"]'); await wait(page, 30);
      const sw4 = (await gs(page)).slots[3];
      await page.click(`#benchList [data-swap-to="${B1}"]`); await wait(page, 30);
      const sw5 = await gs(page);
      check(`枠 4 の候補 ${JSON.stringify(list3.map((x) => x.id))}（今の いなずま・ひかえ の どかん（さっき外した）・${wName(B1)}）、${wName(B1)} に ${JSON.stringify(sw3)} → いなずま に戻すと ${JSON.stringify(sw4)}（Lv8 のまま）→ もう一度 ${JSON.stringify(sw5.slots[3])}`,
        JSON.stringify(list3.map((x) => x.id)) === JSON.stringify(['bolt', 'bomb', B1]) && JSON.stringify(sw3) === JSON.stringify({ id: B1, lv: 3 }) && JSON.stringify(sw4) === JSON.stringify({ id: 'bolt', lv: 8 }) && JSON.stringify(sw5.slots[3]) === JSON.stringify({ id: B1, lv: 3 }), { list3, sw3, sw4 });
      await page.click('#swapDone'); await wait(page, 50);
      check(`「とじる」で閉じる（overlay ${(await gs(page)).overlay}）`, (await gs(page)).overlay === null && !(await shown(page, '#swapCard')), null);
      const SW = [FOUR[0], FOUR[1], { id: B0, lv: 12 }, { id: B1, lv: 3 }];
      await adv(page, 3);
      const mid = await lg(page);
      check(`星の途中のまま（${mid.phase}・ほし ${mid.star}）、替えた武器で飛びつづける（3 秒後の砲台 ${mid.slots.map((x) => x.id)}・swap ${JSON.stringify(mid.swap)}）`, JSON.stringify(mid.slots) === JSON.stringify(SW) && mid.swap.length === 0 && mid.phase === 'fly', mid.slots);
      // (6) 再読み込みで残る
      await page.reload(); await wait(page, 300);
      const re = await lg(page), r4 = await rowNext(2);
      check(`再読み込みで砲台 ${re.slots.map((x) => x.id + x.lv)}・ひかえ ${JSON.stringify(re.bench)} が残り、行「${r4.name} ${r4.lv}」`, JSON.stringify(re.slots) === JSON.stringify(SW) && JSON.stringify(re.bench.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) === JSON.stringify([{ id: 'bolt', lv: 8 }, { id: 'bomb', lv: 7 }]) && re.swap.length === 0 && r4.name === wName(B0) && r4.lv === 'Lv12', { slots: re.slots, bench: re.bench });
      // (7) 時間切れの札の間も替えられる。「もういちど」はそのまま（勝手に替わらない）
      const hasB = (bench, id, lv) => bench.some((x) => x.id === id && x.lv === lv);
      await dbg(page, 'lose'); await adv(page, 0.2);
      const lo = await gs(page);
      await clickAt(page, '#swapBtn'); await wait(page, 450);
      const loCard = (await gs(page)).overlay;
      await page.click('[data-swap-slot="2"]'); await wait(page, 30);
      await page.click('#benchList [data-swap-to="bomb"]'); await wait(page, 50);
      const lo2 = await lg(page);
      await page.click('#swapDone'); await wait(page, 50);
      await page.evaluate(() => window.AsteroidGame.retry());
      const bo = await lg(page);
      check(`時間切れ（${lo.phase}）の札の間も #swapCard が開き（${loCard}）、どかん に戻すと すぐ ${JSON.stringify(lo2.slots[2])}（phase ${lo2.phase}）、「もういちど」（${bo.phase}・tries ${bo.tries}）では勝手に替わらない（${bo.slots.map((x) => x.id + x.lv)}）`,
        lo.phase === 'lost' && loCard === 'swap' && JSON.stringify(lo2.slots[2]) === JSON.stringify({ id: 'bomb', lv: 7 }) && lo2.phase === 'lost' && hasB(lo2.bench, B0, 12) && bo.phase === 'fly' && JSON.stringify(bo.slots) === JSON.stringify(lo2.slots) && bo.swap.length === 0, { lo2: lo2.slots, bo: bo.slots });
      // (8) クリアの次の星でも勝手に替わらない
      const star0 = (await lg(page)).star;
      const n3 = (await plays(page)).length;
      await dbg(page, 'win');
      let cl = null;
      for (let i = 0; i < 60; i++) { await wait(page, 200); cl = await lg(page); if (cl.star === star0 + 1 && cl.phase === 'fly') break; }
      const sn = await sounds(n3);
      check(`クリア（ほし ${star0} → ${cl.star}）の次の星でも武器はそのまま（${cl.slots.map((x) => x.id + x.lv)}）・音に swap が無い（${sn.filter((x) => ['clear', 'swap'].includes(x)).join(',')}）`,
        cl.star === star0 + 1 && JSON.stringify(cl.slots) === JSON.stringify(bo.slots) && cl.swap.length === 0 && sn.includes('clear') && !sn.includes('swap'), { slots: cl.slots, sn });
      // (9) キーボードだけで：S で開く → 2 で枠 2 → → → で ひかえの 1 つ目 → Enter で すぐ替わる → Esc で閉じる
      await page.locator('#kakera').click().catch(() => {});
      await page.keyboard.press('s'); await wait(page, 450);
      const kb0 = await gs(page);
      await page.keyboard.press('2'); await wait(page, 30);
      const kb1 = await gs(page);
      await page.keyboard.press('ArrowRight'); await wait(page, 30);   // 今の武器の行は押せない（disabled）ので、1 回で ひかえの 1 つ目
      const focusId = await page.evaluate(() => document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.swapTo || null : null);
      await page.keyboard.press('Enter'); await wait(page, 50);
      const kb2 = await gs(page);
      await page.keyboard.press('Escape'); await wait(page, 50);
      const kb3 = await gs(page);
      const wantK = L.swapChoicesOf(cl, 1)[1];
      check(`キーボード：S で開く（${kb0.overlay}・枠 ${kb0.swapSel}）、2 で枠 2（${kb1.swapSel}）、→ で ${focusId}（${wantK}）、Enter で すぐ替わる（枠 2 ${JSON.stringify(kb2.slots[1])}）、Esc で閉じる（${kb3.overlay}）`,
        kb0.overlay === 'swap' && kb0.swapSel === 0 && kb1.swapSel === 1 && focusId === wantK && !!wantK && kb2.slots[1].id === wantK && kb3.overlay === null, { kb0: kb0.swapSel, kb1: kb1.swapSel, focusId, kb2: kb2.slots, kb3: kb3.overlay });
      await ctx.close();
      // (10) SE 縦・横（ホーム画面・Safari）：カードのボタンが画面内・押せる・44px 以上・重ならない
      const rows = [];
      for (const v of [view('SE', 'p', 'app'), view('SE', 'p', 'safari'), view('SE', 'l', 'app'), view('SE', 'l', 'safari')]) {
        const o = await openK(browser, `KW23 ${v.label}`, { v });
        await setL(o.page, "l.slots = ['shot', 'spread', 'bomb', 'beam'].map((id) => ({ id, lv: 99 })); l.offer = null; l.bench = [{ id: 'bolt', lv: 99 }, { id: 'fire', lv: 98 }]; l.swap = [];");
        await clickAt(o.page, '#swapBtn'); await wait(o.page, 450);
        const p = await o.page.evaluate(() => {
          const els = [...document.querySelectorAll('#swapCard button, a#back')].filter((e) => !e.hidden && !e.closest('[hidden]') && e.getBoundingClientRect().width > 0);
          const bs = els.map((e) => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { n: e.id || e.dataset.swapSlot || e.dataset.swapTo, box: [r.left, r.top, r.right, r.bottom], w: Math.round(r.width), h: Math.round(r.height), in: r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5, hit: !!t && (t === e || e.contains(t)) }; });
          const lap = [];
          for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const a = bs[i].box, b = bs[j].box; if (a[0] < b[2] - 0.5 && b[0] < a[2] - 0.5 && a[1] < b[3] - 0.5 && b[1] < a[3] - 0.5) lap.push(bs[i].n + '×' + bs[j].n); }
          const main = bs.filter((b) => b.n !== 'back');
          return { bs: bs.map((b) => `${b.n} ${b.w}×${b.h}${b.in ? '' : ' 画面外'}${b.hit ? '' : ' 押せない'}`), ok: main.length >= 7 && main.every((b) => b.in && b.hit && b.w >= 43.5 && b.h >= 43.5), backHit: bs.some((b) => b.n === 'back' && b.hit), lap };
        });
        rows.push({ v: v.label, ok: p.ok && p.lap.length === 0 && (await gs(o.page)).overlay === 'swap', back: p.backHit, p });
        await o.ctx.close();
      }
      check(`SE 縦・横で #swapCard の枠・ひかえ・とじる・a#back が画面内・押せる・44px 以上・重ならない（${rows.map((r) => r.v + (r.ok ? ' ○' : ' ×')).join('・')}）`, rows.every((r) => r.ok), rows);
      check(`SE 縦・横の #swapCard の上でも a#back が押せる（${rows.map((r) => r.v + (r.back ? ' ○' : ' ×')).join('・')}）`, rows.every((r) => r.back), rows, known('AST-BACK'));
    },
  },
  {
    id: 'KW25', tier: 'full', title: 'ほしくだき 古いページから書き戻さない（§21.4・X-20。ほかの 7 本と同じ tests/lib.mjs の x20Run）：bfcache から戻ったとき（pageshow persisted）保存がほかで変わっていたら書かずに 1 回だけ開き直して今の保存から続ける、変わっていなければ開き直さない。裏にいる間に別のタブが asteroid.save を書いたら、hidden・pagehide・save() で書き戻さず、15 秒ごとの保存（advance）でも書かず、「ほぞんが できないよ」のヒントも出ない。storage イベントが届かないまま閉じても書き戻さない。見えている間の保存は今までどおり後勝ち。さいしょから（§19）の直後に戻っても開き直さず、保存できる',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openK(browser, 'KW25', { debug: true });
      const mk = (star, ids) => JSON.stringify({ v: 3, tier: 0, star, kakera: 1000 * star, kfrac: 0, slots: ids.map((id, k) => ({ id, lv: 2 + k })), bench: [], offer: null, swap: [], cleared: false, tries: 1, totals: { cells: 0, stars: 0, kakera: 0, chunks: 0, glows: 0 }, seed: 7, rng: 9, ms: [], bestT: {} });
      // 中身の印：星と武器（かけらは遊んでいる間に増えるので見ない）
      const fp = (raw) => { try { const o = JSON.parse(raw); return `${o.v}|${o.star}|${o.slots.map((x) => x.id + ':' + x.lv).join(',')}`; } catch { return 'x:' + raw; } };
      const newer = [mk(7, ['shot', 'bolt']), mk(8, ['shot', 'beam']), mk(9, ['spread']), mk(10, ['shot', 'spread', 'bomb'])];
      const r = await x20Run(page, ctx, { key: 'asteroid.save', newer, fp, hiddenWrite: (p) => p.evaluate(() => window.AsteroidGame.save()) });
      check(`ほしくだき：${x20Text(r)}`, r.ok, r);
      // 裏にいる間に別のタブが書いたあと：save()・15 秒ごとの保存（advance）でも書かず、「ほぞんが できないよ」を出さない
      const other = mk(11, ['bomb', 'fire']);
      await setHidden(page, true); await wait(page, 50);
      const p2 = await ctx.newPage();
      await p2.goto(BASE + 'manifest.webmanifest');
      await p2.evaluate((raw) => localStorage.setItem('asteroid.save', raw), other);
      await p2.close();
      await page.waitForTimeout(200);
      const c = await page.evaluate(() => { const G = window.AsteroidGame; const r = G.save(); G.advance(20); const a = G.getState(); return { r, stale: a.stale }; });
      await wait(page, 600);   // 「ほぞんが できないよ」は later(…, 0) で出るので、pagehide（clearLater）の前に待って読む
      const hint = await txt(page, '#hint');
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      const raw = await stored(page, 'asteroid.save');
      check(`裏で別のタブが書いたあと：save() ${c.r}・stale ${c.stale}・advance と pagehide でも書き戻さない（${raw === other}）、ヒント「${hint}」に「ほぞんが できないよ」が無い`, c.r === false && c.stale === true && raw === other && !/ほぞんが できない/.test(hint || ''), { c, hint });
      let nav = page.waitForEvent('load', { timeout: 5000 }).then(() => true, () => false);
      await setHidden(page, false);
      const re = await nav; await wait(page, 300);
      const l1 = await lg(page);
      check(`表に戻ると開き直して（${re}）別のタブの保存から続ける（ほし ${l1.star}・武器 ${l1.slots.map((x) => x.id)}）`, re && l1.star === 11 && JSON.stringify(l1.slots.map((x) => x.id)) === JSON.stringify(['bomb', 'fire']) && (await gs(page)).stale === false, l1.slots);
      // 起きているページ（sleep していない）で、見えている間に書かれ storage イベントが届く前に裏へ回る：hidden の保存の前に比べ直して書き戻さない（staleOnHide）。
      // x20Run の (d2) は、その前の pagehide で sleep 済みのページで行うので、ほしくだきでは hidden の保存が起きない（sleep は 1 回だけ）。ここで起きているページで確かめる
      const d3raw = mk(13, ['beam', 'fire']);
      const aw = await gs(page);
      const d3 = await page.evaluate((raw) => {
        const c0 = window.AsteroidGame.getState().saveCount;
        localStorage.setItem('asteroid.save', raw);
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        const s = window.AsteroidGame.getState();
        return { kept: localStorage.getItem('asteroid.save') === raw, stale: s.stale, sleeping: s.sleeping, saved: s.saveCount - c0 };
      }, d3raw);
      nav = page.waitForEvent('load', { timeout: 5000 }).then(() => true, () => false);
      await setHidden(page, false);
      const re3 = await nav; await wait(page, 300);
      const l3 = await lg(page);
      check(`起きているページ（sleeping ${aw.sleeping}）で見えている間に書かれ、そのまま裏へ回る：hidden の保存で書き戻さない（${d3.kept}・stale ${d3.stale}・保存 ${d3.saved} 回・sleeping ${d3.sleeping}）、表に戻ると開き直して（${re3}）続ける（ほし ${l3.star}）`,
        aw.sleeping === false && d3.kept && d3.stale === true && d3.sleeping === true && d3.saved === 0 && re3 && l3.star === 13, { aw: aw.sleeping, d3, re3, star: l3.star });
      // 見えている間は後勝ち：同じページから書き換えても（storage イベントは来ない）、見えている間の save() は今までどおり書く
      await page.evaluate((raw) => localStorage.setItem('asteroid.save', raw), mk(12, ['shot']));
      const v = await page.evaluate(() => ({ r: window.AsteroidGame.save(), s: window.AsteroidGame.getState() }));
      const raw2 = await stored(page, 'asteroid.save');
      check(`見えている間の save() は後勝ちで書く（${v.r}・保存の ほし ${JSON.parse(raw2).star}・stale ${v.s.stale}）`, v.r === true && JSON.parse(raw2).star === 13 && v.s.stale === false, { r: v.r, star: JSON.parse(raw2).star });
      // さいしょから（§19）の直後：自分で消して書き直した保存を「ほかで変わった」と見ない
      await page.click('#helpBtn'); await wait(page, 60);
      await pressCard(page, '#helpRestart');
      if (!(await unlocked(page, '#restartYes'))) throw new Error('#restartYes のロックが外れない');
      await Promise.all([page.waitForEvent('load', { timeout: 10000 }), page.click('#restartYes')]);
      await wait(page, 300);
      const nav2 = page.waitForEvent('load', { timeout: 3000 }).then(() => true, () => false);
      await page.evaluate(() => { window.__kw25 = 1; window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
      const re2 = await nav2;
      const e = await page.evaluate(() => ({ same: window.__kw25 === 1, r: window.AsteroidGame.save(), s: window.AsteroidGame.getState() }));
      check(`さいしょからの直後：pageshow で開き直さない（${!re2 && e.same}）・stale ${e.s.stale}・save() ${e.r}・ほし ${e.s.star}`, !re2 && e.same && e.s.stale === false && e.r === true && e.s.star === 1 && JSON.parse(await stored(page, 'asteroid.save')).star === 1, { re2, e: { same: e.same, r: e.r, stale: e.s.stale, star: e.s.star } });
      await ctx.close();
    },
  },
  {
    id: 'KW26', tier: 'full', title: 'ほしくだき 絵の約束（render.js の stats）：いなずまの稲光は 0.35 秒で枝が出る（stats().bolt）。てつ の星では てつ へ BOLT_CELLS × BOLT_IRON.ironMul マス広がり、絵は 0.55 秒（stats().bolt.iron に てつ の枝の数。2026-11-12）。しんか の 2 行目（stats().evolve）は武器ごとの言葉（たま Lv20・30「たまが ふえた」、Lv40 から「つよさが 2ばいに なった」）。いなずまの説明「つながった マスへ えだわかれ。てつは とおくまで とどく」',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const { ctx, page } = await openK(browser, 'KW26', { v: SMOKE_V() });
      // いわ だけにした星（いなずま Lv41＝40 マス。てつ が無いので今までどおりの絵）
      await setL(page, "l.star = 12; delete l.rock; l.slots = [{ id: 'bolt', lv: 41 }]; l.bench = []; l.swap = []; l.offer = null;");
      await setL(page, "const R = l.rock; R.mats = R.mats.map((m) => (m ? 1 : 0)); R.hp = R.mats.map((m) => (m ? 1e12 : 0));");
      let fx = null;
      // 前の星（てつ のある星）の いなずま の絵が stats に残っていることがあるので、てつ の枝が 0 の新しい絵を待つ（2026-11-12）
      for (let k = 0; k < 60; k++) { await wait(page, 100); const f = (await gs(page)).boltFx; if (f) fx = f; if (f && f.iron === 0) break; }
      check(`いなずまの絵（いわ だけ）：0.35 秒（${fx && fx.dur}）、枝 ${fx && fx.segs}（10 以上・BOLT_CELLS − 1 まで）、てつ の枝 ${fx && fx.iron}`, !!fx && fx.dur === 0.35 && fx.segs >= 10 && fx.segs <= L.shapeOf('bolt', 41) - 1 && fx.iron === 0, fx);
      // てつ だけの星（2026-11-12 ユーザー「いなずまの効果がちょっとわかりづらいです。もう少し鉄に対して拡散してもいいと思います」）：
      // いなずま Lv41（BOLT_CELLS 40）は てつ へ 40 × BOLT_IRON.ironMul マスまで広がり、絵は 0.55 秒・てつ の枝の数（stats().bolt.iron）が出る
      await setL(page, "const R = l.rock; R.mats = R.mats.map((m) => (m ? 2 : 0)); R.hp = R.mats.map((m) => (m ? 1e12 : 0));");
      let fi = null;
      for (let k = 0; k < 40; k++) { await wait(page, 100); const f = (await gs(page)).boltFx; if (f && f.iron > 0) { fi = f; break; } }
      const wantI = Math.round(L.shapeOf('bolt', 41) * L.BOLT_IRON.ironMul) - 1;
      check(`てつ の星の いなずまの絵：0.55 秒（${fi && fi.dur}）、てつ の枝 ${fi && fi.iron}（${wantI}＝${L.shapeOf('bolt', 41)} × ${L.BOLT_IRON.ironMul} − 1 本。いわ の星の ${fx && fx.segs} 本より多い）`, !!fi && fi.dur === 0.55 && fi.iron === wantI && fi.segs === wantI && fi.segs > (fx ? fx.segs : 0), fi);
      const evo = async (lv) => {
        await setL(page, `l.slots = [{ id: 'shot', lv: ${lv - 1} }]; l.kakera = 9e15; l.offer = null;`);
        await page.evaluate(() => window.AsteroidGame.upgrade(0));
        let line = null;
        for (let k = 0; k < 10 && !line; k++) { await wait(page, 50); line = (await gs(page)).evolveLine; }
        await wait(page, 2000);
        return line;
      };
      const e20 = await evo(20), e30 = await evo(30), e40 = await evo(40), e99 = await evo(99);
      check(`しんか の 2 行目：Lv20「${e20}」・Lv30「${e30}」・Lv40「${e40}」・Lv99「${e99}」`, e20 === 'たまが ふえた' && e30 === 'たまが ふえた' && e40 === 'つよさが 2ばいに なった' && e99 === 'つよさが 2ばいに なった', [e20, e30, e40, e99]);
      // Lv100 から（v74。LEVEL_MAX 255）：100・150・200・250 は「LvN！ どんどん つよく なる」、255 は「いちばん つよく なった！」（2 倍ではない）
      const e150 = await evo(150), e255 = await evo(255);
      check(`しんか の 2 行目：Lv150「${e150}」・Lv255「${e255}」`, e150 === 'Lv150！ どんどん つよく なる' && e255 === 'いちばん つよく なった！', [e150, e255]);
      const bolt = L.WEAPONS.find((w) => w.id === 'bolt');
      const html = fs.readFileSync(path.join(root, 'games/asteroid/index.html'), 'utf8');
      check(`いなずまの説明「${bolt.desc}」（index.html の初期の文も同じ）`, bolt.desc === 'つながった マスへ えだわかれ。てつは とおくまで とどく' && html.includes('<span class="cdesc" data-part="desc">' + bolt.desc + '</span>'), bolt.desc);
      await ctx.close();
    },
  },
  {
    id: 'KW27', tier: 'full', title: 'ほしくだき ハードモード（計画書 §1.7・約束 §23.3）：上の「ほし N」は段 0 で「ほし N」・段 1 で「ハード ほし N」・段 2 以上で「ハード2 ほし N」（getState に tier・num＝通しの番号 numIn）。ふつうの最後の星（ENDING_STAR）をクリアすると #endCard「ちきゅうを まもりきった！」・案内「つぎは ひかりが すくない「ハード」だよ」・ボタン「ハードを はじめる」（エンディング直後の getState は star 1・tier 1・phase end・asteroid.best は ENDING_STAR）、押すとハードの星 1 から（「ハード ほし 1」・保存は tier 1）。ハードの最後の星（HARD_STARS）をクリアすると「ハードクリア！」・「つぎは もう1だん むずかしい「ハード2」だよ」・「つぎの だんへ」（段 2 は「ハード2クリア！」・案内は「ハード3」）、best は通しの数。ハードの星のクリアの帯は「ハード ほし N クリア！」。保存を開き直しても段が残る。メニューのベストは「ほし N まで クリア」「ハード ほし N まで」「ハード2 ほし N まで」',
    async run({ browser, check, root }) {
      const L = logicOf(root);
      const E = L.ENDING_STAR, H = L.HARD_STARS;
      const label = (t, n) => (t <= 0 ? '' : t === 1 ? 'ハード ' : `ハード${t} `) + `ほし ${n}`;
      const { ctx, page } = await openK(browser, 'KW27', { v: SMOKE_V(), debug: true });
      // 表示：段ごとの「ほし N」
      const rows = [];
      for (const [t, n] of [[0, 3], [1, 1], [1, H], [2, 5], [3, 1]]) {
        if (t === 0) await dbg(page, 'gostar', { star: n }); else await dbg(page, 'gotier', { t, n });
        const s = await gs(page);
        rows.push({ t, n, s: { tier: s.tier, star: s.star, num: s.num }, text: await txt(page, '#starLabel [data-part="num"]'), want: label(t, n), ok: s.tier === t && s.star === n && s.num === L.numIn(n, t) });
      }
      check(`上の表示（${rows.map((r) => `段${r.t}の星${r.n}→「${r.text}」`).join('・')}）が「ほし N」「ハード ほし N」「ハード2 ほし N」、getState の tier・star・num（通しの番号）も合う`, rows.every((r) => r.ok && r.text === r.want), rows);
      const resetBest = () => page.evaluate(() => localStorage.removeItem('asteroid.best'));   // best は下がらない（最大を残す）ので、確かめる前に消す
      await resetBest();
      // ハードの星のクリアの帯
      await dbg(page, 'gotier', { t: 1, n: 1 });
      const c1 = await frozen(page, async () => { await dbg(page, 'win'); const ok = await advUntil(page, 'clear', { step: 1 / 30, maxSec: 60 }); return { ok, banner: await txt(page, '#clearBanner [data-part="main"]'), shown: await shown(page, '#clearBanner'), best: await stored(page, 'asteroid.best') }; });
      check(`ハードの星のクリアの帯「${c1.banner}」（${label(1, 1)} クリア！）・asteroid.best は通しの数 ${E + 1}（${c1.best}）`, c1.ok && c1.shown && c1.banner === `${label(1, 1)} クリア！` && c1.best === String(E + 1), c1);
      // ふつうの最後の星 → エンディング → ハードの星 1
      await resetBest();
      await dbg(page, 'gostar', { star: E });
      const e1 = await frozen(page, async () => {
        await dbg(page, 'win');
        const ok = await advUntil(page, 'end', { step: 1 / 30, maxSec: 90, key: 'overlay' });
        return { ok, s: await gs(page), title: await txt(page, '#endTitle'), more: await txt(page, '#endMore'), btn: await txt(page, '#endOk'), best: await stored(page, 'asteroid.best'), shown: await shown(page, '#endCard') };
      });
      check(`ふつうの星 ${E} のクリアで #endCard（「${e1.title}」・「${e1.more}」・「${e1.btn}」）、asteroid.best ${e1.best}、直後の getState は star ${e1.s.star}・tier ${e1.s.tier}・phase ${e1.s.logicPhase}`,
        e1.ok && e1.shown && e1.title === 'ちきゅうを まもりきった！' && /^つぎは .*「ハード」だよ$/.test(e1.more) && e1.btn === 'ハードを はじめる' && e1.best === String(E) && e1.s.star === 1 && e1.s.tier === 1 && e1.s.logicPhase === 'end', e1);
      await pressCard(page, '#endOk');
      await wait(page, 200);
      const e2 = await gs(page), e2l = await lg(page);
      const sv = JSON.parse(await stored(page, 'asteroid.save'));
      check(`「ハードを はじめる」で閉じてハードの星 1 から（「${await txt(page, '#starLabel [data-part="num"]')}」・phase ${e2.logicPhase}・overlay ${e2.overlay}）、保存は tier ${sv.tier}・ほし ${sv.star}、ひかりは ふつうより少ない`, e2.overlay === null && e2.logicPhase === 'fly' && e2.tier === 1 && e2.star === 1 && (await txt(page, '#starLabel [data-part="num"]')) === 'ハード ほし 1' && sv.tier === 1 && sv.star === 1 && e2l.rock.left > 0, { e2: { overlay: e2.overlay, phase: e2.logicPhase, tier: e2.tier, star: e2.star }, sv: { tier: sv.tier, star: sv.star } });
      // 開き直しても段が残る
      await page.reload(); await wait(page, 300);
      const r1 = await gs(page);
      check(`開き直しても段が残る（tier ${r1.tier}・ほし ${r1.star}・「${await txt(page, '#starLabel [data-part="num"]')}」）`, r1.tier === 1 && r1.star === 1 && (await txt(page, '#starLabel [data-part="num"]')) === 'ハード ほし 1', r1);
      // ハードの最後の星 → 「ハードクリア！」「つぎの だんへ」→ ハード2 の星 1。さらに ハード2 の最後 → 「ハード2クリア！」
      for (const [t, title, more, btn, next] of [[1, 'ハードクリア！', 'つぎは もう1だん むずかしい「ハード2」だよ', 'つぎの だんへ', 'ハード2 ほし 1'], [2, 'ハード2クリア！', 'つぎは もう1だん むずかしい「ハード3」だよ', 'つぎの だんへ', 'ハード3 ほし 1']]) {
        await resetBest();
        await dbg(page, 'gotier', { t, n: H });
        const g = await frozen(page, async () => {
          await dbg(page, 'win');
          const ok = await advUntil(page, 'end', { step: 1 / 30, maxSec: 90, key: 'overlay' });
          return { ok, s: await gs(page), title: await txt(page, '#endTitle'), more: await txt(page, '#endMore'), btn: await txt(page, '#endOk'), best: await stored(page, 'asteroid.best'), lock: await attr(page, '#endOk', 'aria-disabled') };
        });
        check(`段 ${t} の最後の星 ${H} のクリアで #endCard（「${g.title}」・「${g.more}」・「${g.btn}」）、best ${g.best}（通しの数 ${L.numIn(H, t)}）、直後は star ${g.s.star}・tier ${g.s.tier}、出た直後はボタンが押せない（${g.lock}）`,
          g.ok && g.title === title && g.more === more && g.btn === btn && g.best === String(L.numIn(H, t)) && g.s.star === 1 && g.s.tier === t + 1 && g.s.logicPhase === 'end' && g.lock === 'true', g);
        await pressCard(page, '#endOk');
        await wait(page, 200);
        const n = await gs(page);
        check(`「${btn}」で ${next} から（「${await txt(page, '#starLabel [data-part="num"]')}」・tier ${n.tier}・phase ${n.logicPhase}）`, n.tier === t + 1 && n.star === 1 && n.logicPhase === 'fly' && n.overlay === null && (await txt(page, '#starLabel [data-part="num"]')) === next, n);
      }
      await ctx.close();
      // メニューのベスト表示
      const m = await newPage(browser, custom(320, 568, null, 'SE 幅'), 'KW27 メニュー', { clock: true });
      const cases = [[1, 'ほし 1 まで クリア'], [E, `ほし ${E} まで クリア`], [E + 1, 'ハード ほし 1 まで'], [L.numIn(H, 1), `ハード ほし ${H} まで`], [L.numIn(1, 2), 'ハード2 ほし 1 まで'], [L.numIn(H, 2), `ハード2 ほし ${H} まで`]];
      const out = [];
      for (const [n, want] of cases) {
        await seed(m.page, { 'asteroid.v3': '1', 'asteroid.best': String(n) });
        await m.page.goto(BASE); await wait(m.page, 150);
        const got = await m.page.evaluate(() => { const b = document.querySelector('a.game[href="games/asteroid/"] .best b'); return b ? b.textContent.trim() : null; });
        out.push({ n, want, got, ok: got === want });
      }
      check(`メニューのベスト（通しの数 → 表示）：${out.map((o) => `${o.n}→「${o.got}」`).join('、')}`, out.every((o) => o.ok), out);
      await m.ctx.close();
    },
  },
  {
    id: 'KW28', tier: 'full', flaky: { why: '自機の位置が寄るのを実時間（rAF）で待つ', checks: /^自機の位置/ }, title: 'ほしくだき 自機の画面の位置（ユーザー 2026-11-10「自機の位置、もう少し上が良いね」。計画書 §2・約束 §23.3）：#fieldzone（#hud の下の端から #weapons の上の端まで。横向きは左の列）を「見えている場」とし、stats().view（向き）・anchor と ship から出した自機の画面の位置が、その縦 35〜65%・横 50〜75% に入る（iPhone 縦 390×844・SE 縦 320×568・SE 横 568×320・武器 1 つと 4 つ）',
    async run({ browser, check }) {
      const views = [custom(390, 844, null, 'iPhone 縦 390×844'), custom(320, 568, null, 'SE 縦 320×568'), custom(568, 320, null, 'SE 横 568×320')];
      for (const v of views) {
        const { ctx, page } = await openK(browser, `KW28 ${v.label || ''}`, { v });
        const where = () => page.evaluate(() => {
          const g = window.AsteroidGame.getState(), z = document.getElementById('fieldzone').getBoundingClientRect(), c = document.getElementById('fieldCanvas').getBoundingClientRect();
          const l = window.AsteroidGame.logic(), sh = l.ship, a = g.anchor, vw = g.view;
          if (!a || !vw || !sh) return null;
          const cs = Math.cos(vw.rot), sn = Math.sin(vw.rot), dx = sh.x - vw.x, dy = sh.y - vw.y;
          const sx = a.x + cs * dx - sn * dy, sy = a.y + sn * dx + cs * dy;   // 世界 → 画面（worldTransform と同じ式）
          const top = z.top - c.top, left = z.left - c.left;
          return { fx: (sx - left) / z.width, fy: (sy - top) / z.height, zh: z.height, zw: z.width, sx, sy };
        });
        const out = [];
        for (const n of [1, 4]) {
          const ids = ['shot', 'spread', 'bomb', 'bolt'].slice(0, n);
          await setL(page, `l.kakera = 1e9; l.slots = ${JSON.stringify(ids.map((id) => ({ id, lv: 1 })))};`);
          await adv(page, 0.2);
          const before = await where();
          await wait(page, 1200);   // 場の四角が変わると、自機の位置は少しずつ寄る（1 秒ほどで落ち着く）
          const w = await where();
          out.push({ n, before: before && +before.fy.toFixed(2), fx: w && +w.fx.toFixed(2), fy: w && +w.fy.toFixed(2), zh: w && Math.round(w.zh) });
        }
        const ok = out.every((o) => o.fy !== null && o.fy >= 0.35 && o.fy <= 0.65 && o.fx >= 0.5 && o.fx <= 0.75);
        check(`自機の位置（${v.label || ''}）：見えている場の中で 武器 1 つ→4 つ ${out.map((o) => `${o.n}つ 横 ${o.fx}・縦 ${o.fy}（場の高さ ${o.zh}）`).join('、')}（縦 35〜65%・横 50〜75%）`, ok, out);
        await ctx.close();
      }
    },
  },
  {
    id: 'KW29', tier: 'full', title: 'ほしくだき 迫ってくる地球（ユーザー 2026-11-10「小さい地球がどんどんどんどん大きくなる感じで、背景にちょっと書き込めないかな」。計画書 §2・約束 §23.3）：stats().earth（getState().earth）で、残り 100% の直径は約 16px・残り 50%→20%→5%→0 で大きくなる（終わりに近いほど速く。0 で 見えている場の幅の約 7 割）・中心は見えている場の右下寄り・30 秒を切ると urgent・時間切れの「もういちど」（retry）で すっと（跳ばずに）小さく戻る・地球の絵は毎コマ作り直さない（SE 縦 320×568・iPhone 縦 390×844）',
    async run({ browser, check }) {
      for (const v of [custom(320, 568, null, 'SE 縦 320×568'), custom(390, 844, null, 'iPhone 縦 390×844')]) {
        const { ctx, page } = await openK(browser, `KW29 ${v.label}`, { v, debug: true });
        const earth = () => page.evaluate(() => {
          const g = window.AsteroidGame.getState(), z = document.getElementById('fieldzone').getBoundingClientRect(), c = document.getElementById('fieldCanvas').getBoundingClientRect();
          return { e: g.earth, left: g.left, limit: g.limit, zone: { l: z.left - c.left, t: z.top - c.top, w: z.width, h: z.height } };
        });
        const at = async (frac) => {
          const s0 = await gs(page);
          await dbg(page, 'timeleft', { sec: s0.limit * frac });
          await wait(page, 2500);   // 大きさは寄せる先へ少しずつ寄る（2.5 秒でほぼ着く）
          return earth();
        };
        const first = await earth();
        if (!first.e) throw new Error('getState().earth が無い（render の stats().earth が無い）');
        const r100 = await at(1), r50 = await at(0.5), r20 = await at(0.2), r05 = await at(0.05);
        const d = [r100, r50, r20, r05].map((r) => r.e.d);
        const tg = [r100, r50, r20, r05].map((r) => r.e.target);
        check(`残り 100% の直径（${v.label}）：${d[0]}px（14〜20px）`, d[0] >= 14 && d[0] <= 20, r100.e);
        check(`残りが減ると大きくなる（${v.label}）：100%・50%・20%・5% で ${d.join('→')}px（寄せる先 ${tg.join('→')}）`, d[0] < d[1] && d[1] < d[2] && d[2] < d[3] && tg.every((t, i) => Math.abs(t - d[i]) <= Math.max(2, t * 0.05)), { d, tg });
        const g1 = (d[1] - d[0]) / 0.5, g2 = (d[2] - d[1]) / 0.3, g3 = (d[3] - d[2]) / 0.15;
        check(`終わりに近いほど速く大きくなる（${v.label}）：割合 1 あたり ${Math.round(g1)}・${Math.round(g2)}・${Math.round(g3)}px`, g1 < g2 && g2 < g3, { g1, g2, g3 });
        const z = r05.zone, e5 = r05.e;
        check(`中心は見えている場の右下寄り（${v.label}）：(${e5.x}, ${e5.y})、場 横 ${Math.round(z.l)}〜${Math.round(z.l + z.w)}・縦 ${Math.round(z.t)}〜${Math.round(z.t + z.h)}`, e5.x > z.l + z.w * 0.6 && e5.y > z.t + z.h * 0.6 && r100.e.x > z.l + z.w * 0.6 && r100.e.y > z.t + z.h * 0.6, { e5, z });
        check(`残り 30 秒を切ると urgent（${v.label}）：残り 5%（${Math.round(r05.left)} 秒）で ${e5.urgent}・100% で ${r100.e.urgent}`, e5.urgent === (r05.left <= 30) && r100.e.urgent === false, { e5, left: r05.left });
        // 時間切れ（残り 0）で場の幅の約 7 割
        await loseNow(page);
        await wait(page, 3000);
        const r0 = await earth();
        check(`残り 0 の直径（${v.label}）：${r0.e.d}px（場の幅 ${Math.round(r0.zone.w)} の 0.6〜0.8 倍）`, r0.e.d >= r0.zone.w * 0.6 && r0.e.d <= r0.zone.w * 0.8 && r0.e.urgent === true, r0.e);
        // retry で小さく戻る（跳ばずに）
        const b0 = r0.e.builds;
        await dbg(page, 'retry');
        await wait(page, 100);
        const rq = await earth();
        await wait(page, 3000);
        const rs = await earth();
        check(`retry で小さく戻る（${v.label}）：${r0.e.d} → 0.1 秒後 ${rq.e.d} → 3 秒後 ${rs.e.d}px（寄せる先 ${rs.e.target}）`, rq.e.target <= 20 && rq.e.d > r0.e.d * 0.5 && rs.e.d <= 22 && rq.e.urgent === false, { r0: r0.e, rq: rq.e, rs: rs.e });
        // 地球の絵は毎コマ作り直さない（3.1 秒 ≒ 186 コマで、大きさの段・自転・色が変わったときだけ）
        const nb = rs.e.builds - b0;
        check(`地球の絵を作り直した回数（${v.label}）：retry の前後 3.1 秒で ${nb} 回（40 回以下。毎コマではない）`, nb <= 40, { nb });
        await ctx.close();
      }
    },
  },
];
