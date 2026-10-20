// QW: まとめてポンの画面（games/matomete/）。契約は docs/matomete-contract.md（§4 画面・§4.4 DOM・§4.5 テスト用 API・§4.6 保存・§7 QW）。
//   画面の DOM は契約だけに頼る：a#back・#helpBtn・#soundBtn・#score・#best・#left・#board[data-selected]・canvas#boardCanvas・#tag・
//     #hint・#undoBtn・#restartBtn・#playView[data-phase]・#banner・#overlay・#card・#againBtn・#modeBtn・#menuBtn・[data-cmd]
//   テスト用の公開 API（契約 §4.5）：window.MatometeGame = { state, tapCell, select, remove, undo, restart, newSeed, cellRect, isAnimating, skip }
//   かたまり・まわり（§10）・落下・左詰め・点数は、このファイルの中の別実装（groupsOf・blastOf・simulate・ptsAll）で期待値を作る（ロジックの不具合を画面のテストでも拾う）。
//   無いときに合格にしない（空振りの合格を作らない）：MatometeGame が無ければ例外で不合格にする。
//   smoke：QW1〜QW3・QW16（Node）。full：QW4〜QW15（QW14 は CDP のタッチ操作なので Chromium だけ、QW12 は AudioContext が要る）。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { BASE, view, custom, newPage, seed, wait, frozen, layoutProbe, swInfo, sleep, touch, SFX_SPY, plays } from '../lib.mjs';

const MT = BASE + 'games/matomete/';
const SMOKE_V = () => view('SE', 'p', 'app');
const STD_V = () => view('i13', 'p', 'app');
const CDP = 'CDP のタッチ操作（連続タップ）';
const COLS = 10, ROWS = 20;
// 種 187・ふつうで全部消しになる手順（§10 のルール（5こ以上・まわり +3 点）で「一番大きいかたまりを消し続ける」。16 手・1620 点）。各手は押したマス [x, y]
const CLEAR_SEED = 187;
const CLEAR1 = [[2, 6], [0, 10], [3, 2], [0, 4], [5, 8], [4, 4], [3, 2], [0, 3], [2, 1], [2, 0], [0, 1], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
const CLEAR1_SCORE = 1620;
const BIG = 5, WIDE_AT = 3, EXTRA = 3;   // §10：5こ以上で まわりも消える（1 こ +3 点）。れんぞく 3 回目から r=2

// ---------- 期待値の別実装（契約 §1） ----------
// 盤 grid[x][y]（x=0 が左、y=0 が下）。かたまりは上下左右だけ。1個のマスも返す（並びは x→y の順）
function groupsOf(grid) {
  const seen = new Set(), out = [];
  for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) {
    const v = grid[x][y];
    if (v === null || seen.has(x * 100 + y)) continue;
    const g = [], st = [[x, y]]; seen.add(x * 100 + y);
    while (st.length) {
      const [cx, cy] = st.pop(); g.push([cx, cy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || seen.has(nx * 100 + ny) || grid[nx][ny] !== v) continue;
        seen.add(nx * 100 + ny); st.push([nx, ny]);
      }
    }
    g.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    out.push(g);
  }
  return out;
}
const pts = (n) => (n < 2 ? 0 : (n - 2) * (n - 2));
// §10：まわりのマス（かたまりの外で、どれかのマスから上下左右に数えて r マス以内の色のあるマス。x→y の順）
function around(grid, cells, r) {
  const out = [];
  if (r <= 0) return out;
  const inG = new Set(cells.map(([x, y]) => x * 100 + y));
  for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) {
    if (grid[x][y] === null || inG.has(x * 100 + y)) continue;
    if (cells.some(([a, b]) => Math.abs(a - x) + Math.abs(b - y) <= r)) out.push([x, y]);
  }
  return out;
}
// 消し方 → { extra, r, streak（消したあと） }。streak は消す前の れんぞく
function blastOf(grid, cells, streak = 0) {
  if (cells.length < BIG) return { extra: [], r: 0, streak: 0 };
  const r = streak + 1 >= WIDE_AT ? 2 : 1;
  return { extra: around(grid, cells, r), r, streak: streak + 1 };
}
const ptsAll = (grid, cells, streak = 0) => pts(cells.length) + blastOf(grid, cells, streak).extra.length * EXTRA;
// 消す（まわりも）→ 列の中で落とす → 空の列を左へ詰める
function simulate(grid, cells, streak = 0) {
  const g = grid.map((c) => c.slice());
  for (const [x, y] of [...cells, ...blastOf(grid, cells, streak).extra]) g[x][y] = null;
  const cols = g.map((c) => c.filter((v) => v !== null)).filter((c) => c.length > 0).map((c) => [...c, ...Array(ROWS - c.length).fill(null)]);
  while (cols.length < COLS) cols.push(Array(ROWS).fill(null));
  return cols;
}
// 一番大きいかたまりを消し続けたときの手の列（回の終わりまで）
function greedyMoves(grid) {
  const mv = [];
  for (let g = grid, st = 0; ;) {
    const big = groupsOf(g).filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)[0];
    if (!big) return mv;
    mv.push(big[0]); g = simulate(g, big, st); st = blastOf(g, big, st).streak;
  }
}
const count = (grid) => grid.flat().filter((v) => v !== null).length;
const J = (x) => JSON.stringify(x);

// ---------- 開く ----------
async function openG(browser, label, { v = STD_V(), opts = {}, extra = {}, help = true } = {}) {
  const { ctx, page } = await newPage(browser, v, label, { clock: true, ...opts });
  await gotoG(page, extra, { help });
  return { ctx, page };
}
// 初回だけ出る遊び方は、見たことにして始める（help: false なら出る状態で始める）
async function gotoG(page, extra = {}, { help = true } = {}) {
  await seed(page, { ...(help ? { 'matomete.help': '1' } : {}), ...extra });
  await page.goto(MT); await wait(page, 300);
  const has = await page.evaluate(() => !!window.MatometeGame && typeof window.MatometeGame.state === 'function');
  if (!has) throw new Error('window.MatometeGame.state が無い（games/matomete/main.js が読まれていないか、テスト用 API が未実装）');
}
// 種を決めて始め直す（カードを閉じた直後の押せない時間 300ms も待つ）
async function fresh(page, sd = 1, mode = 'normal') {
  const ok = await page.evaluate(([s, m]) => window.MatometeGame.newSeed(s, m), [sd, mode]);
  if (!ok) throw new Error(`newSeed(${sd}, ${mode}) が始められない`);
  await wait(page, 350);
}

// ---------- 読む ----------
const gs = (p) => p.evaluate(() => window.MatometeGame.state());
const stored = (p, k) => p.evaluate((k) => { try { return localStorage.getItem(k); } catch { return 'ERR'; } }, k);
const phaseAttr = (p) => p.evaluate(() => document.querySelector('#playView')?.dataset.phase);
const hintText = (p) => p.evaluate(() => document.querySelector('#hint')?.textContent.trim() ?? null);
const domNums = (p) => p.evaluate(() => Object.fromEntries(['score', 'best', 'left'].map((id) => { const t = (document.getElementById(id)?.textContent || '').replace(/[^\d]/g, ''); return [id, t === '' ? null : Number(t)]; })));
const tagInfo = (p) => p.evaluate(() => {
  const t = document.querySelector('#tag'), b = document.querySelector('#board');
  if (!t) return null;
  const r = t.getBoundingClientRect();
  return { shown: !t.hidden && r.width > 0, text: t.textContent.replace(/\s+/g, ' ').trim(), inView: r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5, sel: b.dataset.selected ?? null };
});
const overlayInfo = (p) => p.evaluate(() => {
  const ov = document.querySelector('#overlay');
  const shown = !!ov && !ov.hidden && getComputedStyle(ov).display !== 'none';
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden]'); };
  const cmds = shown ? [...ov.querySelectorAll('[data-cmd]')].filter(vis).map((b) => b.dataset.cmd) : [];
  return { shown, cmds, text: shown ? (ov.querySelector('#card')?.textContent || '').replace(/\s+/g, ' ').trim() : '', active: document.activeElement?.dataset?.cmd ?? null, role: ov?.getAttribute('role'), lab: ov?.getAttribute('aria-labelledby') };
});
const reachable = (p, sel) => p.evaluate((s) => {
  const e = document.querySelector(s); if (!e) return false;
  const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false;
  const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!t && (t === e || e.contains(t));
}, sel);
const clickCmd = (p, cmd) => p.evaluate((c) => { const b = document.querySelector(`#overlay:not([hidden]) [data-cmd="${c}"]`); if (!b) return false; b.click(); return true; }, cmd);
// 本物のクリックでマスを押す（cellRect の真ん中）
async function tapReal(p, x, y) {
  const r = await p.evaluate(([x, y]) => window.MatometeGame.cellRect(x, y), [x, y]);
  await p.mouse.click(r.left + r.width / 2, r.top + r.height / 2);
}
// 盤の canvas を読み、各マスの色 id（空は null、どの色にも近くなければ '?'）を grid の形で返す。
// 記号を避けて、マスの左寄り（横 15%・上から 60%）の 1 点を見る
const boardColors = (p) => p.evaluate(([C, R]) => {
  const cv = document.querySelector('#boardCanvas'), g = cv.getContext('2d');
  const cell = window.MatometeGame.state().cell, k = cv.width / (cell * C);
  const pal = window.MatometeLogic.COLORS.map((c) => ({ id: c.id, rgb: [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16)) }));
  const img = g.getImageData(0, 0, cv.width, cv.height).data;
  const out = [];
  for (let x = 0; x < C; x++) {
    const col = [];
    for (let y = 0; y < R; y++) {
      const px = Math.floor((x + 0.15) * cell * k), py = Math.floor((R - 1 - y + 0.6) * cell * k);
      const i = (py * cv.width + px) * 4;
      if (img[i + 3] < 80) { col.push(null); continue; }
      let best = null, bd = 1e9;
      for (const c of pal) { const d = Math.hypot(img[i] - c.rgb[0], img[i + 1] - c.rgb[1], img[i + 2] - c.rgb[2]); if (d < bd) { bd = d; best = c.id; } }
      col.push(bd < 80 ? best : '?');
    }
    out.push(col);
  }
  return out;
}, [COLS, ROWS]);
const diffCells = (a, b) => { const d = []; for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) if (a[x][y] !== b[x][y]) d.push(`${x},${y}:${a[x][y]}≠${b[x][y]}`); return d; };
// 隠れる・戻る（visibilitychange を再現する）
const setHidden = (p, hidden) => p.evaluate((h) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

// ---------- 遊ぶ ----------
// API で手を進める（remove は演出を最後まで終わらせて返す）
const playMoves = (p, moves) => p.evaluate((mv) => mv.map(([x, y]) => window.MatometeGame.remove(x, y)), moves);
// 一番大きいかたまりを消し続けて、回の終わりまで進める（ページの中で。演出は remove が終わらせる）
const playToOver = (p) => p.evaluate(([C, R]) => {
  const G = window.MatometeGame;
  for (let n = 0; n < 400 && !G.state().over; n++) {
    const grid = G.state().grid, seen = new Set();
    let best = null;
    for (let x = 0; x < C; x++) for (let y = 0; y < R; y++) {
      if (grid[x][y] === null || seen.has(x * 100 + y)) continue;
      const st = [[x, y]], v = grid[x][y]; let size = 0; seen.add(x * 100 + y);
      while (st.length) { const [a, b] = st.pop(); size++; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = a + dx, ny = b + dy; if (nx >= 0 && ny >= 0 && nx < C && ny < R && !seen.has(nx * 100 + ny) && grid[nx][ny] === v) { seen.add(nx * 100 + ny); st.push([nx, ny]); } } }
      if (size >= 2 && (!best || size > best.size)) best = { x, y, size };
    }
    if (!best) break;
    if (G.remove(best.x, best.y) !== 'remove') return { error: `remove(${best.x},${best.y}) が消せない` };
  }
  return G.state();
}, [COLS, ROWS]);

// カード：見出しが切れず、全ボタンに届き 44px 以上。noScroll なら、スクロールせずに見える
async function overlayProbe(page, safe, { noScroll = false } = {}) {
  return page.evaluate(([safe, noScroll]) => {
    const [t, r, b, l] = safe || [0, 0, 0, 0];
    const ov = document.querySelector('#overlay'), card = document.querySelector('#card');
    const head = card.querySelector('#cardTitle') || card.querySelector('h1, h2, h3');
    const res = { btns: [], oy: getComputedStyle(ov).overflowY, head: !!head };
    ov.scrollTop = 0;
    if (head) res.headTop = Math.round(head.getBoundingClientRect().top);
    for (const x of card.querySelectorAll('button')) {
      if (x.closest('[hidden]') || !x.getBoundingClientRect().width) continue;
      if (!noScroll) x.scrollIntoView({ block: 'center' });
      const q = x.getBoundingClientRect();
      res.btns.push({ cmd: x.dataset.cmd || x.textContent.trim(), w: Math.round(q.width), h: Math.round(q.height), inside: q.top >= t - 0.5 && q.bottom <= innerHeight - b + 0.5 && q.left >= l - 0.5 && q.right <= innerWidth - r + 0.5 });
    }
    ov.scrollTop = 0;
    res.hscroll = document.documentElement.scrollWidth > innerWidth;
    // スクロールしない画面：文（見出し・段落・項目）が画面の中にあり、下のボタンの帯に隠れていない
    const band = card.querySelector('.btns')?.getBoundingClientRect();
    res.covered = [...card.querySelectorAll('h2, p, li')].filter((e) => e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none').filter((e) => {
      const q = e.getBoundingClientRect();
      return q.top < t - 0.5 || q.bottom > innerHeight - b + 0.5 || (band && q.bottom > band.top + 0.5);
    }).map((e) => e.textContent.trim().slice(0, 16));
    return res;
  }, [safe, noScroll]);
}
const overlayOk = (o) => o.head && o.btns.length > 0 && o.headTop >= 0 && !o.hscroll && o.btns.every((b) => b.inside && b.h >= 43.5 && b.w >= 43.5);

export const tests = [
  // ================= smoke =================
  {
    id: 'QW1', tier: 'smoke', title: 'まとめてポン 2回タップ：1回目で選ぶだけ（札「n こ ＋p てん」・data-selected・ふち）、2回目で消えて落下と左詰めが別実装と一致、別のかたまりで選び直し、盤の外・空で選びをやめる、1個のマスはヒントと揺れ',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'QW1', { v: SMOKE_V() });
      const api = await page.evaluate(() => ({ keys: Object.keys(window.MatometeGame).sort(), frozen: Object.isFrozen(window.MatometeGame), L: typeof window.MatometeLogic?.applyRemove }));
      const need = ['state', 'tapCell', 'select', 'remove', 'undo', 'restart', 'newSeed', 'cellRect', 'isAnimating'];
      check(`window.MatometeGame に ${need.join('・')} があり凍結されている、MatometeLogic が読める`, need.every((k) => api.keys.includes(k)) && api.frozen && api.L === 'function', api);
      await fresh(page, 1);
      const s0 = await gs(page), d0 = await domNums(page);
      const title = await page.evaluate(() => ({ t: document.title, h: document.getElementById('gameTitle')?.textContent.trim(), n: window.MatometeLogic.NAME, b: document.querySelector('#board') && [document.querySelector('#board').dataset.cols, document.querySelector('#board').dataset.rows].join('x') }));
      check(`タイトルと見出しが MatometeLogic.NAME（${title.n}）、#board の data-cols×data-rows が 10x20（${title.b}）`, title.t.includes(title.n) && title.h === title.n && title.b === '10x20', title);
      check(`はじめ：盤 10×20 が全部埋まり（${count(s0.grid)}）、点 0・手 0・phase idle、#score ${d0.score}・#left ${d0.left}`,
        s0.grid.length === COLS && s0.grid.every((c) => c.length === ROWS) && count(s0.grid) === 200 && s0.score === 0 && s0.moves === 0 && s0.phase === 'idle' && d0.score === 0 && d0.left === 200 && (await phaseAttr(page)) === 'idle', { s0: { ...s0, grid: '…' }, d0 });
      const groups = groupsOf(s0.grid);
      const big = groups.filter((g) => g.length >= 3).sort((a, b) => b.length - a.length)[0];
      // 選び直し・1個のマスの確かめは、選んだかたまりから 1 マス以上はなれた所で（となりのマスの近い半分は「2回目」として扱うため）
      const far = (g) => g.every(([x, y]) => big.every(([a, b]) => Math.abs(a - x) + Math.abs(b - y) >= 2));
      const two = groups.find((g) => g.length === 2 && far(g));
      const single = groups.find((g) => g.length === 1 && far(g));
      if (!big || !two || !single) throw new Error('種 1 の盤に 3 個以上・2 個・1 個のかたまりが見つからない');
      // 1回目：選ぶだけ
      const [bx, by] = big[big.length - 1];
      await tapReal(page, bx, by); await wait(page, 60);
      const s1 = await gs(page), t1 = await tagInfo(page);
      const n = big.length, bl = blastOf(s0.grid, big), p = ptsAll(s0.grid, big), ex = bl.extra.length;
      const tagWant = ex ? `まわりも！${n + ex}こ ＋${p}てん` : `${n} こ ＋${p} てん`;
      check(`1回目（${n} 個のかたまり）：選ぶだけで消えない（盤・点・手が同じ）、phase selected・data-phase selected`, s1.phase === 'selected' && (await phaseAttr(page)) === 'selected' && J(s1.grid) === J(s0.grid) && s1.score === 0 && s1.moves === 0, { phase: s1.phase, score: s1.score });
      check(`選んだかたまりが別実装と同じ（${n} 個）・#board[data-selected="${n}"]`, s1.selected === n && J([...s1.selectedCells].sort((a, b) => a[0] - b[0] || a[1] - b[1])) === J(big) && t1.sel === String(n), { sel: s1.selected, dom: t1.sel });
      check(`札が出て「${tagWant}」（${t1.text}）、画面の中`, t1.shown && t1.text === tagWant && t1.inView, t1);
      const tz = await page.evaluate((cells) => {
        const t = document.querySelector('#tag').getBoundingClientRect(), c = window.MatometeGame.state().cell;
        const hit = cells.filter(([x, y]) => { const r = window.MatometeGame.cellRect(x, y); return r.left < t.right - 0.5 && r.left + r.width > t.left + 0.5 && r.top < t.bottom - 0.5 && r.top + r.height > t.top + 0.5; }).length;
        return { w: Math.round(t.width), h: Math.round(t.height), c, cells: +((t.width * t.height) / (c * c)).toFixed(1), hit, bw: Math.round(document.querySelector('#board').getBoundingClientRect().width) };
      }, big);
      check(`札は小さい（${tz.w}×${tz.h}px＝マス ${tz.cells} こ分、${ex ? '「まわりも！」の札は盤の幅の 85% まで' : '5 こ分まで'}・高さはマス 1 こ分まで）、選んだかたまりのマスに重ならない（${tz.hit}）`, (ex ? tz.w <= tz.bw * 0.85 : tz.cells <= 5) && tz.h <= tz.c + 1 && tz.hit === 0, tz);
      check(`ヒントが 2回目を案内する（${await hintText(page)}）、表記は「もういちど」`, /もういちど/.test((await hintText(page)) || '') && !/もう一度/.test((await hintText(page)) || ''), await hintText(page));
      // 別のかたまりで選び直し（2 個 → ＋0 てん）
      await tapReal(page, two[0][0], two[0][1]); await wait(page, 60);
      const s2 = await gs(page), t2 = await tagInfo(page);
      check(`別のかたまり（2 個）を押すと選び直し、札「2 こ ＋0 てん」（${t2.text}）・まだ消えない`, s2.selected === 2 && J(s2.selectedCells.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])) === J(two) && t2.text === '2 こ ＋0 てん' && J(s2.grid) === J(s0.grid), { s2: s2.selectedCells, t2 });
      // 盤の外（盤のまわりの余白）を押すと選びをやめる
      const outside = await page.evaluate(() => {
        const v = document.querySelector('#playView').getBoundingClientRect(), b = document.querySelector('#board').getBoundingClientRect();
        if (b.left - v.left >= 6) return [v.left + (b.left - v.left) / 2, b.top + b.height / 2];
        if (v.right - b.right >= 6) return [b.right + (v.right - b.right) / 2, b.top + b.height / 2];
        if (v.bottom - b.bottom >= 6) return [b.left + b.width / 2, b.bottom + (v.bottom - b.bottom) / 2];
        if (b.top - v.top >= 6) return [b.left + b.width / 2, v.top + (b.top - v.top) / 2];
        return null;
      });
      if (!outside) throw new Error('#playView の中に盤の外の余白が無い（盤の外を押す確認ができない）');
      await page.mouse.click(outside[0], outside[1]); await wait(page, 60);
      const s3 = await gs(page), t3 = await tagInfo(page);
      check('盤の外（盤のまわりの余白）を押すと選びをやめる（selected null・data-selected なし・札が消える）', s3.selected === null && t3.sel === null && !t3.shown && s3.phase === 'idle', { s3: s3.selected, t3 });
      // 1個のマス：ヒントと揺れ
      const [sx, sy] = single[0];
      const before = await boardColors(page);
      await tapReal(page, sx, sy);
      const shot = await page.evaluate(([x, y]) => {
        const cv = document.querySelector('#boardCanvas'), c = window.MatometeGame.state().cell, k = cv.width / (c * 10);
        const g = cv.getContext('2d');
        return Array.from(g.getImageData(Math.floor((x - 0.3) * c * k), Math.floor((19 - y) * c * k), Math.ceil(1.6 * c * k), Math.ceil(c * k)).data).join(',');
      }, [sx, sy]);
      const frames = [];
      for (let i = 0; i < 6; i++) {
        await wait(page, 40);
        frames.push(await page.evaluate(([x, y]) => {
          const cv = document.querySelector('#boardCanvas'), c = window.MatometeGame.state().cell, k = cv.width / (c * 10);
          return Array.from(cv.getContext('2d').getImageData(Math.floor((x - 0.3) * c * k), Math.floor((19 - y) * c * k), Math.ceil(1.6 * c * k), Math.ceil(c * k)).data).join(',');
        }, [sx, sy]));
      }
      await wait(page, 500);
      const s4 = await gs(page), h4 = await hintText(page);
      check(`1個のマスは選べない（selected null・盤も点も同じ）、ヒント「${h4}」`, s4.selected === null && J(s4.grid) === J(s0.grid) && s4.score === 0 && /2こ いじょう/.test(h4 || ''), { s4: s4.selected, h4 });
      check(`1個のマスを押すと揺れる（押した直後の ${frames.length} コマで、そのマスの絵が動く）`, new Set([shot, ...frames]).size > 1, { distinct: new Set([shot, ...frames]).size });
      check('揺れが終わると絵は元どおり（盤の色が state と一致）', diffCells(await boardColors(page), s0.grid).length === 0 && diffCells(before, s0.grid).length === 0, diffCells(await boardColors(page), s0.grid).slice(0, 5));
      // 2回目で消える（本物のクリック）
      await tapReal(page, bx, by); await wait(page, 60);
      check('（消す前）もう一度選ぶと selected', (await gs(page)).selected === n, null);
      const other = big[0];
      await tapReal(page, other[0], other[1]); await wait(page, 30);
      const anim = await page.evaluate(() => ({ a: window.MatometeGame.isAnimating(), ph: document.querySelector('#playView').dataset.phase }));
      await wait(page, 1500);
      const s5 = await gs(page), d5 = await domNums(page);
      const exp = simulate(s0.grid, big);
      check(`かたまりの中の別のマスを押すと消える：演出中（isAnimating ${anim.a}・data-phase ${anim.ph}）→ idle`, anim.a === true && anim.ph === 'anim' && s5.phase === 'idle' && !(await page.evaluate(() => window.MatometeGame.isAnimating())), anim);
      check(`消したあとの盤が別実装（まわり ${ex} こ＋落下＋左詰め）と同じ、点 ${p}・手 1・残り ${200 - n - ex}`, J(s5.grid) === J(exp) && s5.score === p && s5.moves === 1 && s5.remaining === 200 - n - ex && s5.cleared === n + ex, { diff: diffCells(s5.grid, exp).slice(0, 6), score: s5.score });
      check(`#score ${d5.score}・#left ${d5.left} が state と同じ`, d5.score === s5.score && d5.left === s5.remaining, d5);
      check('消したあとの画面（canvas の色）が state.grid と一致', diffCells(await boardColors(page), s5.grid).length === 0, diffCells(await boardColors(page), s5.grid).slice(0, 6));
      // 空のマスを押しても何も起きない
      await tapReal(page, two[0][0], two[0][1]); await wait(page, 30);
      const empty = (() => { for (let x = COLS - 1; x >= 0; x--) for (let y = ROWS - 1; y >= 0; y--) if (s5.grid[x][y] === null) return [x, y]; return null; })();
      if (empty) { await tapReal(page, empty[0], empty[1]); await wait(page, 60); }
      const s6 = await gs(page);
      check(`空のマス（${empty}）を押すと選びをやめ、盤は変わらない`, !!empty && s6.selected === null && J(s6.grid) === J(s5.grid) && s6.moves === 1, { sel: s6.selected });
      await ctx.close();
    },
  },
  {
    id: 'QW2', tier: 'smoke', title: 'まとめてポン データ：手を打つたび matomete.save（v:3・種・手）、再読み込みで同じ局面（れんぞくも）、前の版（v:2・v:1）の途中保存は同じ種の最初から、壊れた matomete.save・matomete.best でも落ちない、保存できない環境でも遊べる、ほかのゲームの保存キーを変えない',
    async run({ browser, check }) {
      const others = { 'blockpuzzle.best': '777', 'tile2048.best': '888', 'hashi.best': '55', 'zenmai.progress': '{"stars":{"z01":3}}', 'pikatto.bestSolo': '321', 'kiritori.best': '99', 'irobin.best': '4' };
      const { ctx, page } = await openG(browser, 'QW2', { v: SMOKE_V(), extra: { 'matomete.best': '120', ...others } });
      const s00 = await gs(page);
      check(`matomete.best 120 がベストに出る（state.best ${s00.best}・#best ${(await domNums(page)).best}）`, s00.best === 120 && (await domNums(page)).best === 120, s00.best);
      await fresh(page, 7);
      const s0 = await gs(page);
      const sv0 = JSON.parse((await stored(page, 'matomete.save')) || 'null');
      check(`回を始めると matomete.save に v:3・seed 7・mode normal・手 0（${J(sv0)}）`, !!sv0 && sv0.v === 3 && sv0.seed === 7 && sv0.mode === 'normal' && Array.isArray(sv0.moves) && sv0.moves.length === 0, sv0);
      const g1 = groupsOf(s0.grid).find((g) => g.length >= 2);
      await playMoves(page, [g1[0]]);
      const g2 = groupsOf((await gs(page)).grid).find((g) => g.length >= 2);
      await playMoves(page, [g2[0]]);
      const s1 = await gs(page);
      const sv = JSON.parse((await stored(page, 'matomete.save')) || 'null');
      check(`2手消すと matomete.save の手が 2 つ（${J(sv && sv.moves)}）`, s1.moves === 2 && sv && sv.moves.length === 2 && J(sv.moves[0]) === J(g1[0]) && J(sv.moves[1]) === J(g2[0]), sv);
      await page.reload(); await wait(page, 300);
      const s2 = await gs(page);
      check('再読み込みで同じ局面（盤・点・手・種・れんぞく）、1手もどすも続きから使える', J(s2.grid) === J(s1.grid) && s2.score === s1.score && s2.moves === 2 && s2.seed === 7 && s2.streak === s1.streak && J(s2.history) === J(s1.history) && !(await page.evaluate(() => document.querySelector('#undoBtn').disabled)), { a: s1.score, b: s2.score, moves: s2.moves });
      // 前の版（v:2・v:1）の途中保存：ルールが違うので手を捨てて、同じ種・同じモードの最初から
      for (const ov of [1, 2]) {
        await seed(page, { ...others, 'matomete.help': '1', 'matomete.save': J({ v: ov, seed: 7, mode: 'easy', moves: sv.moves }) });
        await page.goto(MT); await wait(page, 250);
        const s1v = await gs(page), sv1 = JSON.parse((await stored(page, 'matomete.save')) || 'null');
        check(`v:${ov} の途中保存（2 手）で開くと、同じ種 7・やさしいの最初から（手 ${s1v.moves}・点 ${s1v.score}・盤が全部埋まる）、保存は v:3 で書き直す`, s1v.seed === 7 && s1v.mode === 'easy' && s1v.moves === 0 && s1v.score === 0 && count(s1v.grid) === 200 && sv1 && sv1.v === 3 && sv1.moves.length === 0, { seed: s1v.seed, mode: s1v.mode, moves: s1v.moves, sv1 });
      }
      await seed(page, { ...others, 'matomete.help': '1', 'matomete.save': J({ v: 3, seed: 7, mode: 'normal', moves: sv.moves }) });
      await page.goto(MT); await wait(page, 250);
      // 隠れたとき（アプリの切り替え）にも保存
      await page.evaluate(() => localStorage.removeItem('matomete.save'));
      await setHidden(page, true); await wait(page, 50);
      check('隠れたとき（visibilitychange）にも matomete.save を書く', JSON.parse((await stored(page, 'matomete.save')) || '{"moves":[]}').moves.length === 2, await stored(page, 'matomete.save'));
      await setHidden(page, false);
      // ほかのゲームのキー
      const after = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
      const changed = Object.entries(others).filter(([k, v]) => after[k] !== v).map(([k]) => k);
      const extra = Object.keys(after).filter((k) => !(k in others) && !k.startsWith('matomete.') && k !== 'blockpuzzle.sound');
      check(`ほかのゲームの保存キーは変わらず、新しいキーは matomete.* だけ（変化 ${changed.join(',') || 'なし'}・余分 ${extra.join(',') || 'なし'}）`, changed.length === 0 && extra.length === 0, { changed, extra });
      // 壊れた保存
      const long = J({ v: 3, seed: 1, mode: 'normal', moves: Array.from({ length: 201 }, () => [0, 0]) });
      const BAD_SAVE = ['{not json', '', 'null', '[]', '"x"', '{"v":3,"seed":1,"mode":"normal","moves":[]}', '{"v":2,"seed":1.5,"mode":"normal","moves":[]}', '{"v":2,"seed":"1","mode":"normal","moves":[]}',
        '{"v":2,"seed":1,"mode":"Easy","moves":[]}', '{"v":2,"seed":1,"mode":"normal","moves":"x"}', '{"v":2,"seed":1,"mode":"normal","moves":[[0]]}', '{"v":2,"seed":1,"mode":"normal","moves":[[0,1.5]]}',
        '{"v":2,"seed":1,"mode":"normal","moves":[[99,99]]}', '{"v":2,"seed":1,"mode":"normal","moves":[[-1,0]]}', long, '{"v":2,"seed":99999999999,"mode":"normal","moves":[]}', '{"v":1,"seed":1,"mode":"normal","moves":[[0]]}'];
      const bad = [];
      for (const raw of BAD_SAVE) {
        await seed(page, { 'matomete.help': '1', 'matomete.save': raw });
        await page.goto(MT); await wait(page, 250);
        const ok = await page.evaluate(() => !!window.MatometeGame).catch(() => false);
        if (!ok) { bad.push(`${raw.slice(0, 40)}: ゲームが起動しない`); continue; }
        const s = await gs(page);
        if (!(s.moves === 0 && s.score === 0 && s.phase === 'idle' && count(s.grid) === 200 && s.over === false)) bad.push(`${raw.slice(0, 40)}: moves ${s.moves} score ${s.score} phase ${s.phase}`);
        const g = groupsOf(s.grid).find((x) => x.length >= 2);
        if (!g || (await page.evaluate(([x, y]) => window.MatometeGame.remove(x, y), g[0])) !== 'remove') bad.push(`${raw.slice(0, 40)}: 遊べない`);
      }
      check(`壊れた matomete.save（${BAD_SAVE.length} 通り）でも落ちず、新しい回（盤が全部埋まり手 0）で遊べる`, bad.length === 0, bad);
      await seed(page, { 'matomete.help': '1', 'matomete.save': '{"v":2,"seed":3,"mode":"hard","moves":[]}' });
      await page.goto(MT); await wait(page, 250);
      const sh = await gs(page);
      check(`保存の mode hard で開くと むずかしい（mode ${sh.mode}・色 ${sh.colors}・盤に 5 色）`, sh.mode === 'hard' && sh.colors === 5 && new Set(sh.grid.flat()).size === 5 && sh.seed === 3, { mode: sh.mode, colors: sh.colors });
      const BAD_BEST = ['abc', '-5', '1e400', '{}', '1.5', 'NaN', 'Infinity', '', '9007199254740992'];
      const bad2 = [];
      for (const raw of BAD_BEST) {
        await seed(page, { 'matomete.help': '1', 'matomete.best': raw });
        await page.goto(MT); await wait(page, 250);
        const ok = await page.evaluate(() => !!window.MatometeGame).catch(() => false);
        if (!ok) { bad2.push(`${raw}: 起動しない`); continue; }
        const s = await gs(page), d = await domNums(page);
        if (!(s.best === 0 && d.best === 0 && s.moves === 0)) bad2.push(`${raw}: best ${s.best} #best ${d.best}`);
      }
      check(`壊れた matomete.best（${BAD_BEST.join(' ')}）でも落ちず、ベスト 0`, bad2.length === 0, bad2);
      // 保存できない環境（localStorage が投げる）でも遊べる
      const { ctx: c2, page: p2 } = await newPage(browser, SMOKE_V(), 'QW2 保存不可', { clock: true, initScript: () => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('denied'); } }); } });
      await p2.goto(MT); await wait(p2, 300);
      const noStore = await p2.evaluate(() => {
        if (!window.MatometeGame) return 'API なし';
        const G = window.MatometeGame; const ov = !document.querySelector('#overlay').hidden;
        const close = document.querySelector('#overlay [data-cmd="close"]'); if (close) close.click();
        const s = G.state();
        for (let x = 0; x < 10; x++) for (let y = 0; y < 19; y++) if (s.grid[x][y] !== null && s.grid[x][y] === s.grid[x][y + 1]) return { ov, r: G.remove(x, y), moves: G.state().moves };
        return 'かたまりなし';
      }).catch((e) => String(e));
      check(`localStorage にさわると例外になる環境でも起動して消せる（${J(noStore)}）`, noStore && noStore.r === 'remove' && noStore.moves === 1, noStore);
      await c2.close();
      await ctx.close();
    },
  },
  {
    id: 'QW3', tier: 'smoke', title: 'まとめてポン：遊び方・プレイ中・選んでいる間・さいしょからの確認・終わりのカードのどこからでも a#back でメニューへ戻れる、終わりのカードの「メニューへ」',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'QW3', { v: SMOKE_V(), help: false });
      check('a#back の href は ../../ でメニュー（BASE）を指す', await page.evaluate(() => document.querySelector('a#back')?.href) === BASE, await page.evaluate(() => document.querySelector('a#back')?.getAttribute('href')));
      const r = {};
      const h = await overlayInfo(page);
      check(`初回は遊び方が自動で出る（close がある。${h.cmds.join(',')}）・role=dialog・aria-labelledby`, h.shown && h.cmds.includes('close') && h.role === 'dialog' && !!h.lab, h);
      const rules = await page.evaluate(() => [...document.querySelectorAll('#card ol.rules li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
      check(`遊び方は 3 項目以内で、2回タップ（1かいめは えらぶ・2かいめで ポン）・「5こ いじょう けすと まわりも ポン！ 3かい つづけると もっと ひろく」・「とちゅうで やめても つづきから あそべるよ」がある、「もう一度」の表記は使わない（${rules.join(' / ')}）`,
        rules.length >= 1 && rules.length <= 3 && rules.some((t) => /1かいめは えらぶ/.test(t) && /2かいめで ポン/.test(t)) && rules.some((t) => /5こ いじょう けすと まわりも ポン！ 3かい つづけると もっと ひろく/.test(t)) && rules.some((t) => /とちゅうで やめても つづきから あそべるよ/.test(t)) && !rules.some((t) => /もう一度/.test(t)), rules);
      r.help = await reachable(page, 'a#back');
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      r.helpNav = page.url() === BASE;
      // わかった で閉じると、次からは出ない
      await page.goto(MT); await wait(page, 300);
      await clickCmd(page, 'close'); await wait(page, 100);
      r.helpSaved = (await stored(page, 'matomete.help')) === '1';
      await page.reload(); await wait(page, 300);
      r.helpOnce = !(await overlayInfo(page)).shown;
      // プレイ中・選んでいる間
      r.idle = await reachable(page, 'a#back');
      const g = groupsOf((await gs(page)).grid).find((x) => x.length >= 2);
      await page.evaluate(([x, y]) => window.MatometeGame.select(x, y), g[0]); await wait(page, 50);
      r.selected = (await phaseAttr(page)) === 'selected' && await reachable(page, 'a#back');
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      r.selectedNav = page.url() === BASE;
      // さいしょからの確認カード
      await gotoG(page);
      const g2 = groupsOf((await gs(page)).grid).find((x) => x.length >= 2);
      await playMoves(page, [g2[0]]);
      await page.click('#restartBtn'); await wait(page, 100);
      const cf = await overlayInfo(page);
      r.confirm = cf.shown && cf.cmds.includes('close') && await reachable(page, 'a#back');
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      r.confirmNav = page.url() === BASE;
      // 終わりのカード
      await gotoG(page, { 'matomete.save': null });
      await fresh(page, 1);
      await playToOver(page);
      r.over = (await overlayInfo(page)).cmds.includes('menu') && await reachable(page, 'a#back');
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      r.overNav = page.url() === BASE;
      check('遊び方を「わかった」で閉じると matomete.help が "1"、次に開いたときは出ない', r.helpSaved && r.helpOnce, r);
      check('どの状態でも a#back が見えて押せる（遊び方・プレイ中・選んでいる間・確認・終わりのカード）', r.help && r.idle && r.selected && r.confirm && r.over, r);
      check('遊び方・選んでいる間・確認カード・終わりのカードから a#back で実際にメニューが開く', r.helpNav && r.selectedNav && r.confirmNav && r.overNav, r);
      // カードの「メニューへ」
      await gotoG(page, { 'matomete.save': null });
      await fresh(page, 1);
      await playToOver(page);
      await wait(page, 700);
      await page.click('#overlay #menuBtn'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('終わりのカードの「メニューへ」（#menuBtn）でメニューが開く', page.url() === BASE && await page.locator('a.game').count() >= 2, page.url());
      await ctx.close();
    },
  },
  {
    id: 'QW16', tier: 'smoke', node: true, title: 'まとめてポン 静的：画面のコードが鳴らす音（sfx.play・snd）がすべて "matomete" の音の表にあり、契約 §5 の音がそろう、<head> で debug.js、本文の最後で sfx.js → logic.js → render.js → input.js → main.js の順に読む、APP_FILES に全ファイル',
    run({ check, root }) {
      const src = fs.readFileSync(path.join(root, 'common/sfx.js'), 'utf8');
      const sandbox = { localStorage: { getItem: () => null, setItem() {} }, navigator: {} };
      sandbox.globalThis = sandbox; vm.createContext(sandbox); vm.runInContext(src, sandbox);
      const names = sandbox.YubiSfx.create('matomete').names || [];
      const need = ['select', 'pop', 'fall', 'allclear', 'over', 'deny', 'undo', 'blast', 'streak', 'start', 'best', 'toggle'];
      check(`"matomete" の音の表に ${need.join('・')} がある（${names.join(',')}）`, need.every((n) => names.includes(n)), names);
      const dir = path.join(root, 'games/matomete');
      const code = ['main.js', 'render.js', 'input.js'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
      const calls = [...code.matchAll(/(?:sfx\.play|snd)\(\s*(["'`])([^"'`]+)\1/g)].map((m) => m[2]);
      const missing = calls.filter((n) => !names.includes(n));
      check(`画面のコードの音 ${calls.length} か所 [${[...new Set(calls)].join(', ')}] がすべて音の表にある`, calls.length >= 7 && missing.length === 0, missing);
      check('main.js が YubiSfx.create("matomete") を使う', /YubiSfx\.create\("matomete"\)/.test(code));
      const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      const at = (s) => html.indexOf(`<script src="${s}"></script>`);
      const order = ['../../common/sfx.js', 'logic.js', 'render.js', 'input.js', 'main.js'].map(at);
      const dbg = at('../../common/debug.js'), head = html.indexOf('</head>');
      check(`読み込み順：debug.js が <head> の中（${dbg} < ${head}）、本文で sfx.js → logic.js → render.js → input.js → main.js（${order.join(' < ')}）`, dbg > 0 && dbg < head && order.every((x, i) => x > head && (i === 0 || x > order[i - 1])), { dbg, head, order });
      const info = swInfo(root);
      const files = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
      const want = ['./games/matomete/', ...files.map((f) => `./games/matomete/${f}`)];
      const lack = want.filter((f) => !info.files.includes(f));
      check(`sw.js の APP_FILES に games/matomete/ の ${want.length} 件がすべてある（足りない：${lack.join(' / ') || 'なし'}）`, files.length >= 5 && lack.length === 0, lack);
    },
  },

  // ================= full =================
  {
    id: 'QW4', tier: 'full', title: 'まとめてポン 全部消し：種 187 の手順で盤が空になると、お祝い（#banner に ＋1000・ヒント）→ 終わりのカード「ぜんぶ けし！」1620 点・あたらしい きろく、matomete.best 1620・保存を消す、カードの直後 0.6 秒は押せない',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'QW4', { extra: { 'matomete.best': '300' } });
      await fresh(page, CLEAR_SEED);
      const res = await playMoves(page, CLEAR1.slice(0, -1));
      const s0 = await gs(page);
      check(`${CLEAR1.length - 1} 手まで API で消せる（すべて remove）、まだ終わらない（残り ${s0.remaining}）`, res.every((r) => r === 'remove') && !s0.over && s0.remaining > 0, res.filter((r) => r !== 'remove'));
      // 最後の 1 手は本物のクリック 2 回
      const last = CLEAR1[CLEAR1.length - 1];
      await tapReal(page, last[0], last[1]); await wait(page, 40);
      await tapReal(page, last[0], last[1]);
      // 最後の手：記録はすぐ（演出中に閉じても消えない）、画面のベストの数字はポンの演出が終わってから
      const during = await page.evaluate(() => ({ best: document.querySelector('#best').textContent.trim(), anim: window.MatometeGame.isAnimating() }));
      const recNow = await stored(page, 'matomete.best');
      let banner = false, bannerText = '', hintAll = '', cardAt = -1;
      for (let i = 0; i < 80; i++) {
        await wait(page, 50);
        const b = await page.evaluate(() => { const e = document.querySelector('#banner'); return { on: !!e && !e.hidden && e.getBoundingClientRect().width > 0, t: e ? e.textContent.replace(/\s+/g, '') : '', h: document.querySelector('#hint').textContent, ov: !document.querySelector('#overlay').hidden }; });
        if (b.on) { banner = true; bannerText = b.t; }
        if (/ぜんぶ/.test(b.h)) hintAll = b.h;
        if (b.ov) { cardAt = i; break; }
      }
      check(`全部消しでお祝いが出る（#banner「${bannerText}」に ＋1000）、ヒント「${hintAll}」`, banner && /[＋+]1000/.test(bannerText) && /ぜんぶ/.test(hintAll), { banner, bannerText, hintAll });
      const s1 = await gs(page), ov = await overlayInfo(page);
      check(`終わりのカード：「ぜんぶ けし」・${CLEAR1_SCORE} 点・「あたらしい きろく」（${ov.text}）`, cardAt >= 0 && /ぜんぶ けし/.test(ov.text) && ov.text.includes(String(CLEAR1_SCORE)) && /あたらしい きろく/.test(ov.text) && s1.allClear && s1.over && s1.score === CLEAR1_SCORE, { ov, score: s1.score });
      check(`最後の手の直後（演出中 ${during.anim}）：matomete.best はもう ${recNow}、画面の #best はまだ前の 300（${during.best}）。カードが出たら ${CLEAR1_SCORE}`, during.anim === true && during.best === '300' && recNow === String(CLEAR1_SCORE) && (await domNums(page)).best === CLEAR1_SCORE, { during, recNow });
      check(`カードのボタン（${ov.cmds.join(',')}）に again・mode・menu、#againBtn・#modeBtn・#menuBtn がある`, ['again', 'mode', 'menu'].every((c) => ov.cmds.includes(c)) && await page.evaluate(() => !!(document.querySelector('#againBtn') && document.querySelector('#modeBtn') && document.querySelector('#menuBtn'))), ov.cmds);
      check(`matomete.best が ${CLEAR1_SCORE}（${await stored(page, 'matomete.best')}）、matomete.save は消える（${await stored(page, 'matomete.save')}）、#best も同じ`,
        (await stored(page, 'matomete.best')) === String(CLEAR1_SCORE) && (await stored(page, 'matomete.save')) === null && (await domNums(page)).best === CLEAR1_SCORE, null);
      check('終わったら「1手もどす」は押せない', await page.evaluate(() => document.querySelector('#undoBtn').disabled), null);
      // 0.6 秒のロック：ロック中はどのボタンも同じ見た目、ロック後は 2 番目からの文字も明るい
      const looks = () => page.evaluate(() => [...document.querySelectorAll('#card .btns button')].map((b) => { const cs = getComputedStyle(b); const rgb = cs.color.match(/\d+/g).map(Number); return { id: b.id, bg: cs.backgroundColor, color: cs.color, op: cs.opacity, lum: (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 }; }));
      const lk = await looks();
      check(`ロック中（0.6 秒）の ${lk.length} つのボタンは同じ見た目（背景・文字の色・不透明度）`, lk.length >= 4 && lk.every((b) => b.bg === lk[0].bg && b.color === lk[0].color && b.op === lk[0].op), lk);
      const lock = await page.evaluate(() => document.querySelector('#againBtn').getAttribute('aria-disabled'));
      await page.evaluate(() => document.querySelector('#againBtn').click()); await wait(page, 30);
      const early = await gs(page);
      check(`カードが出た直後の「もういちど」は効かない（aria-disabled ${lock}・まだ終わりのカード）`, early.overlay === 'over' && early.over === true && lock === 'true', { overlay: early.overlay });
      await wait(page, 700);
      const ul = await looks();
      check(`ロックが解けると 2 番目からのボタンの文字も明るい（明るさ ${ul.slice(1).map((b) => b.lum.toFixed(2)).join('・')}、不透明度 1）`, ul.slice(1).every((b) => b.lum >= 0.85 && b.op === '1') && ul[0].bg !== ul[1].bg, ul);
      const lock2 = await page.evaluate(() => document.querySelector('#againBtn')?.getAttribute('aria-disabled') ?? null);
      await page.click('#againBtn'); await wait(page, 100);
      const s2 = await gs(page);
      check(`0.6 秒たつと押せて（aria-disabled ${lock2}）、新しい回（手 0・点 0・盤が埋まる・カードが閉じる）`, lock2 === null && s2.moves === 0 && s2.score === 0 && count(s2.grid) === 200 && s2.overlay === null && s2.phase === 'idle' && s2.best === CLEAR1_SCORE, { overlay: s2.overlay, moves: s2.moves });
      // 全部消しの手順を再読み込みで最後まで当て直しても、ベストだけ記録して新しい回になる（終わった回を再開しない）
      await seed(page, { 'matomete.help': '1', 'matomete.save': J({ v: 3, seed: CLEAR_SEED, mode: 'normal', moves: CLEAR1 }), 'matomete.best': '10' });
      await page.goto(MT); await wait(page, 300);
      const s3 = await gs(page);
      check(`最後の手まで保存された回を開くと、ベストを記録して（${await stored(page, 'matomete.best')}）新しい回から`, (await stored(page, 'matomete.best')) === String(CLEAR1_SCORE) && s3.moves === 0 && !s3.over && count(s3.grid) === 200, { moves: s3.moves });
      await ctx.close();
    },
  },
  {
    id: 'QW5', tier: 'full', title: 'まとめてポン 終わり：消せるかたまりが無くなると「おしまい」のカード（理由・点・のこり・ベスト）、ふつうは matomete.best・むずかしいは matomete.bestHard に記録（高い方だけ）、のこりの記録（least・leastHard）、「むずかしいで あそぶ」で 5 色・「やさしいで あそぶ」もある、「おしい！」の線はモード別',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'QW5', { extra: { 'matomete.best': '5', 'matomete.bestHard': '999999' } });
      await fresh(page, 4);
      const s = await playToOver(page);
      if (s.error) throw new Error(s.error);
      const ov = await overlayInfo(page), d = await domNums(page);
      const stuck = groupsOf(s.grid).every((g) => g.length < 2);
      check(`回の終わり：over・消せるかたまりが無い（別実装）・残り ${s.remaining} が盤のマスの数と同じ、phase over`, s.over && !s.allClear && stuck && s.remaining === count(s.grid) && s.remaining > 0 && (await phaseAttr(page)) === 'over', { over: s.over, remaining: s.remaining });
      check(`カード「おしまい！」の下に理由「もう けせる ところが ないよ」、点 ${s.score}・のこり ${s.remaining} こ・あたらしい きろく、のこり ${s.remaining} こ（10 こより多い）は「おしい」でない（${ov.text}）`, s.remaining > 10 && /おしまい！ もう けせる ところが ないよ/.test(ov.text) && ov.text.includes(String(s.score)) && new RegExp(`のこり ${s.remaining} こ`).test(ov.text) && /あたらしい きろく/.test(ov.text) && !/おしい/.test(ov.text) && !/まえの いちばん/.test(ov.text), ov.text);
      check(`のこりの記録 matomete.least が ${s.remaining}（${await stored(page, 'matomete.least')}）、はじめてなので「まえの」の行は無い`, (await stored(page, 'matomete.least')) === String(s.remaining), null);
      const mb = await page.evaluate(() => ['#modeBtn', '#modeBtn2'].map((q) => { const b = document.querySelector(q); return b ? `${b.dataset.mode}:${b.textContent.trim()}` : null; }));
      check(`ふつうの終わりのカードから むずかしい・やさしい の 2 つを選べる（${mb.join(' / ')}）`, mb[0] === 'hard:むずかしいで あそぶ' && mb[1] === 'easy:やさしいで あそぶ', mb);
      check(`ふつうのベスト matomete.best が ${s.score}（${await stored(page, 'matomete.best')}）・#best ${d.best}、bestHard は 999999 のまま`, (await stored(page, 'matomete.best')) === String(s.score) && d.best === s.score && (await stored(page, 'matomete.bestHard')) === '999999', null);
      const modeLabel = await page.evaluate(() => document.querySelector('#modeBtn')?.textContent.trim());
      await wait(page, 700);
      await page.click('#modeBtn'); await wait(page, 400);
      const h0 = await gs(page);
      const chip = await page.evaluate(() => document.querySelector('#modeChip')?.textContent.trim() ?? document.querySelector('#best')?.parentElement?.textContent.trim());
      check(`「${modeLabel}」で むずかしい（mode ${h0.mode}・色 ${h0.colors}・盤に 5 色）、ベスト表示は bestHard の 999999（${chip}）`, /むずかしい/.test(modeLabel || '') && h0.mode === 'hard' && h0.colors === 5 && new Set(h0.grid.flat()).size === 5 && h0.best === 999999 && (await domNums(page)).best === 999999 && /むずかしい/.test(chip || ''), { mode: h0.mode, colors: h0.colors, best: h0.best, chip });
      const hs = await playToOver(page);
      const ov2 = await overlayInfo(page);
      check(`むずかしいで終わる：ベストを超えないので bestHard は 999999 のまま・matomete.best も変わらない、カードは「あたらしい きろく」でない（${ov2.text}）`,
        hs.over && (await stored(page, 'matomete.bestHard')) === '999999' && (await stored(page, 'matomete.best')) === String(s.score) && !/あたらしい きろく/.test(ov2.text) && /999999/.test(ov2.text), ov2.text);
      await wait(page, 700);
      const back = await page.evaluate(() => document.querySelector('#modeBtn')?.textContent.trim());
      await page.click('#modeBtn'); await wait(page, 400);
      const n0 = await gs(page);
      check(`「${back}」で ふつうに戻る（mode ${n0.mode}・色 ${n0.colors}・ベスト ${n0.best}）、むずかしいの のこりは matomete.leastHard（${await stored(page, 'matomete.leastHard')}）`, /ふつう/.test(back || '') && n0.mode === 'normal' && n0.colors === 4 && n0.best === s.score && (await stored(page, 'matomete.leastHard')) === String(hs.remaining), { mode: n0.mode, best: n0.best });
      // 「おしい！」の線はモード別（やさしい 5・ふつう 10・むずかしい 15 こ以下）。種と手順は「一番大きいかたまりを消し続ける」で決まる
      const line = [];
      for (const [sd, md, left, near] of [[7, 'normal', 10, true], [2, 'easy', 9, false], [2, 'hard', 15, true], [18, 'hard', 32, false]]) {
        await fresh(page, sd, md);
        const e = await playToOver(page);
        const t = (await overlayInfo(page)).text;
        const ok = e.remaining === left && /おしい！ あと すこしで ぜんぶ けしだったね！/.test(t) === near;
        line.push({ sd, md, left: e.remaining, near, ok });
      }
      check(`「おしい！ あと すこしで ぜんぶ けしだったね！」は ふつう 10 こ・むずかしい 15 こ（線ちょうど）で出て、やさしい 9 こ・むずかしい 32 こでは出ない`, line.every((x) => x.ok), line);
      await ctx.close();
    },
  },
  {
    id: 'QW6', tier: 'full', title: 'まとめてポン お助け：1手もどす（最初は disabled、手の数だけ戻すと最初の局面・点 0、保存も戻る、U キー）、さいしょから は確認カード（やめる・おなじ ばん・あたらしい ばん）',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'QW6');
      await fresh(page, 5);
      const s0 = await gs(page);
      check('最初は「1手もどす」が disabled', await page.evaluate(() => document.querySelector('#undoBtn').disabled), null);
      const hist = [s0];
      for (let i = 0; i < 3; i++) {
        const g = groupsOf(hist[hist.length - 1].grid).filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)[0];
        await playMoves(page, [g[0]]);
        hist.push(await gs(page));
      }
      check(`3 手消すと「1手もどす」が押せる（moves ${hist[3].moves}・点 ${hist[3].score}）`, hist[3].moves === 3 && !(await page.evaluate(() => document.querySelector('#undoBtn').disabled)), null);
      await page.click('#undoBtn'); await wait(page, 100);
      const u1 = await gs(page);
      check('1回押すと 2 手目の局面（盤・点・手）に戻る', J(u1.grid) === J(hist[2].grid) && u1.score === hist[2].score && u1.moves === 2 && (await domNums(page)).score === hist[2].score, { score: u1.score });
      await page.keyboard.press('u'); await wait(page, 100);
      const u2 = await gs(page);
      check('U キーでも 1手もどす（1 手目の局面）', J(u2.grid) === J(hist[1].grid) && u2.moves === 1, { moves: u2.moves });
      await page.click('#undoBtn'); await wait(page, 100);
      const u3 = await gs(page);
      check('手の数だけ戻すと最初の局面・点 0・手 0、もう戻せない（disabled）', J(u3.grid) === J(s0.grid) && u3.score === 0 && u3.moves === 0 && (await page.evaluate(() => document.querySelector('#undoBtn').disabled)), { moves: u3.moves });
      check(`戻した後の保存も 0 手（${await stored(page, 'matomete.save')}）`, JSON.parse((await stored(page, 'matomete.save')) || '{"moves":[1]}').moves.length === 0, null);
      // 戻してから別の手：redo は無く、新しい手が保存される
      const g = groupsOf(s0.grid).find((x) => x.length >= 2);
      await playMoves(page, [g[0]]);
      check('戻したあと別の手を打てる（手 1、保存も 1 手）', (await gs(page)).moves === 1 && JSON.parse(await stored(page, 'matomete.save')).moves.length === 1, null);
      // さいしょから
      await page.click('#restartBtn'); await wait(page, 100);
      const cf = await overlayInfo(page), sc = await gs(page);
      check(`「さいしょから」で確認カード（${cf.cmds.join(',')}）、まだ手は消えない`, cf.shown && ['newBoard', 'sameBoard', 'close'].every((c) => cf.cmds.includes(c)) && sc.moves === 1 && sc.overlay === 'confirm', cf);
      const o = await overlayProbe(page, STD_V().safe);
      check('確認カードのボタンが画面内・44px 以上', overlayOk(o), o);
      await clickCmd(page, 'close'); await wait(page, 400);
      check('「やめる」で閉じ、手はそのまま', (await gs(page)).moves === 1 && (await gs(page)).overlay === null, null);
      await page.click('#restartBtn'); await wait(page, 100);
      await clickCmd(page, 'sameBoard'); await wait(page, 400);
      const s4 = await gs(page);
      check('「おなじ ばんを はじめから」で同じ種の最初の局面・手 0', s4.seed === s0.seed && J(s4.grid) === J(s0.grid) && s4.moves === 0 && s4.overlay === null, { seed: s4.seed });
      await playMoves(page, [g[0]]);
      await page.click('#restartBtn'); await wait(page, 100);
      await clickCmd(page, 'newBoard'); await wait(page, 400);
      const s5 = await gs(page);
      check('「あたらしい ばん」で別の盤（種が変わる）・手 0・全部埋まる', s5.seed !== s0.seed && J(s5.grid) !== J(s0.grid) && s5.moves === 0 && count(s5.grid) === 200, { seed: s5.seed });
      await ctx.close();
    },
  },
  {
    id: 'QW7', tier: 'full', title: 'まとめてポン 見た目＝state：canvas のマスの色が state.grid と一致（はじめ・落下・列が空いて左へ詰めたあと）、cellRect がマスの大きさで並ぶ（y=0 が下）、押した座標のマスが選ばれる、寄った列で演出中',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'QW7');
      await fresh(page, CLEAR_SEED);
      const s0 = await gs(page);
      check('はじめ：canvas の 200 マスの色が state.grid と一致', diffCells(await boardColors(page), s0.grid).length === 0, diffCells(await boardColors(page), s0.grid).slice(0, 6));
      const geo = await page.evaluate(() => {
        const G = window.MatometeGame, c = G.state().cell, b = document.querySelector('#board').getBoundingClientRect();
        const a = G.cellRect(0, 0), r = G.cellRect(1, 0), u = G.cellRect(0, 1), z = G.cellRect(9, 19);
        return { c, ok: Math.abs(r.left - a.left - c) < 0.5 && Math.abs(a.top - u.top - c) < 0.5 && a.width === c && a.height === c && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top + c - b.bottom) < 0.5 && Math.abs(z.left + c - b.right) < 0.5 && Math.abs(z.top - b.top) < 0.5 };
      });
      check(`cellRect：マス ${geo.c}px で並び、(0,0) が #board の左下・(9,19) が右上`, geo.ok && geo.c >= 22, geo);
      // 押した座標のマスが選ばれる（ふちの近く：マスの右下の角の内側）
      const g = groupsOf(s0.grid).filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)[0];
      const [gx, gy] = g[0];
      const r = await page.evaluate(([x, y]) => window.MatometeGame.cellRect(x, y), [gx, gy]);
      await page.mouse.click(r.left + r.width - 2, r.top + r.height - 2); await wait(page, 60);
      check(`マスの角の近くを押しても、そのマスのかたまりが選ばれる（${(await gs(page)).selected} 個）`, (await gs(page)).selected === g.length, null);
      await page.keyboard.press('Escape'); await wait(page, 30);
      // 列が空になる手を探しながら進める（それまでは API で）
      let cur = s0.grid, idx = -1, st = 0;
      for (let i = 0; i < CLEAR1.length; i++) {
        const grp = groupsOf(cur).find((x) => x.some(([a, b]) => a === CLEAR1[i][0] && b === CLEAR1[i][1]));
        const next = simulate(cur, grp, st);
        const cols = (gr) => gr.filter((c) => c[0] !== null).length;
        if (cols(next) < cols(cur) && next[cols(next)][0] === null && cols(cur) - 1 > CLEAR1[i][0]) { idx = i; break; }
        st = blastOf(cur, grp, st).streak;
        cur = next;
      }
      if (idx < 0) throw new Error('列が空いて右の列が左へ寄る手が見つからない');
      await playMoves(page, CLEAR1.slice(0, idx));
      const sa = await gs(page);
      check(`${idx} 手まで進めた局面（落下のあと）も canvas の色が state.grid と一致`, J(sa.grid) === J(cur) && diffCells(await boardColors(page), sa.grid).length === 0, diffCells(await boardColors(page), sa.grid).slice(0, 6));
      const [mx, my] = CLEAR1[idx];
      const grp = groupsOf(sa.grid).find((x) => x.some(([a, b]) => a === mx && b === my));
      const exp = simulate(sa.grid, grp, sa.streak);
      await tapReal(page, mx, my); await wait(page, 40);
      await tapReal(page, mx, my); await wait(page, 30);
      const mid = await page.evaluate(() => window.MatometeGame.isAnimating());
      await wait(page, 1500);
      const sb = await gs(page);
      check(`列が空く手（${idx + 1} 手目・${grp.length} 個）：演出中（${mid}）のあと、盤が別実装（落下＋左詰め）と同じ`, mid === true && J(sb.grid) === J(exp), diffCells(sb.grid, exp).slice(0, 6));
      check('左へ寄ったあとの canvas の色が state.grid と一致（空いた右の列は空）', diffCells(await boardColors(page), sb.grid).length === 0, diffCells(await boardColors(page), sb.grid).slice(0, 6));
      await ctx.close();
    },
  },
  {
    id: 'QW8', tier: 'full', title: 'まとめてポン 画面内：SE 縦・SE 縦 Safari・SE 横（568×320・667×375）・13 横・iPad 縦横で、ボタンと盤が画面内・safe-area 内・重なりなし・ボタン 44px 以上・文字 12px 以上、7 桁の点数・ベストが省略されない、横向きでマスが小さいときだけ「たてむき」の案内、カードが切れない',
    async run({ browser, check }) {
      const VS = [view('SE', 'p', 'app'), view('SE', 'p', 'safari'), view('SE', 'l', 'app'), custom(667, 375, [0, 0, 0, 0], 'SE相当 横 667×375'), view('i13', 'l', 'app'), view('iPad', 'p', 'app'), view('iPad', 'l', 'app')];
      const SEL = 'a#back, #helpBtn, #soundBtn, #undoBtn, #restartBtn, .head, .stats, #board, #hint, .tools';
      const BTN = 'a#back, #helpBtn, #soundBtn, #undoBtn, #restartBtn';
      for (const v of VS) {
        const { ctx, page } = await openG(browser, `QW8 ${v.label}`, { v, extra: { 'matomete.best': '9999999' } });
        const s = await gs(page);
        const r = await layoutProbe(page, SEL, v.safe, { overlapSel: '.head, .stats, #board, #hint, .tools', minSel: BTN });
        check(`${v.label} ${v.w}×${v.h}｜マス ${s.cell}px：${r.n} 要素が画面内・重なりなし・ボタン 44px 以上・横スクロールなし`, r.n >= 8 && r.outside.length === 0 && r.overlaps.length === 0 && r.small.length === 0 && !r.hscroll, r);
        if (v.w > v.h && v.h <= 500) {
          const lay = await page.evaluate(() => { const hd = document.querySelector('.head').getBoundingClientRect(), b = document.querySelector('#board').getBoundingClientRect(); return { gap: Math.round(b.left - hd.right), left: Math.round(hd.left), right: Math.round(innerWidth - b.right) }; });
          check(`${v.label}：盤は左の列のすぐ右（すき間 ${lay.gap}px）で、全体が真ん中寄り（左の余白 ${lay.left}px・右の余白 ${lay.right}px）`, lay.gap >= 0 && lay.gap <= 24 && lay.right <= lay.left + 60, lay);
        }
        const t = await page.evaluate(() => {
          document.querySelector('#score').textContent = '1234567'; document.querySelector('#score').dataset.size = 'l';
          const small = [...document.querySelectorAll('.head *, .stats *, #hint, .tools button')].filter((e) => e.offsetParent && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 11.5).map((e) => e.id || e.className || e.tagName);
          const nums = ['score', 'best', 'left'].map((id) => { const e = document.getElementById(id); return { id, t: e.textContent, fit: e.scrollWidth <= e.clientWidth + 0.5 && !e.textContent.includes('…') }; });
          return { small, nums };
        });
        await wait(page, 50);
        const r7 = await layoutProbe(page, SEL, v.safe, { overlapSel: '.head, .stats, #board, #hint, .tools', minSel: BTN });
        check(`${v.label}：7 桁の点数（1234567）とベスト（9999999）が省略されず、重なり・はみ出しなし、文字 12px 以上`, t.nums.every((x) => x.fit) && t.nums[1].t === '9999999' && r7.outside.length === 0 && r7.overlaps.length === 0 && t.small.length === 0, { t, r7 });
        const land = v.w > v.h, hint = await hintText(page);
        const tip = /たてむき/.test(hint || '');
        check(`${v.label}：「たてむき」の案内は 横向きでマスが 22px 未満のときだけ（マス ${s.cell}px・案内 ${tip}）`, tip === (land && s.cell < 22), { cell: s.cell, hint });
        await ctx.close();
      }
      // カード（遊び方・確認・終わり）が SE 縦・SE 横で切れない。遊び方はスクロールなしで「わかった」まで見える
      for (const vv of [view('SE', 'p', 'app'), view('SE', 'p', 'safari'), view('SE', 'l', 'app'), view('SE', 'l', 'safari'), view('iPad', 'p', 'app')]) {
        const h = await openG(browser, `QW8 カード ${vv.label}`, { v: vv, help: false });
        const o1 = await overlayProbe(h.page, vv.safe, { noScroll: true });
        check(`${vv.label} ${vv.w}×${vv.h}：遊び方カードがスクロールなしで全部見え（「わかった」まで）、文が下の帯に隠れない（隠れ：${o1.covered.join(' / ') || 'なし'}）、ボタンが 44px 以上、a#back が押せる`, overlayOk(o1) && o1.covered.length === 0 && await reachable(h.page, 'a#back'), o1);
        await clickCmd(h.page, 'close'); await wait(h.page, 400);
        const g = groupsOf((await gs(h.page)).grid).find((x) => x.length >= 2);
        await playMoves(h.page, [g[0]]);
        await h.page.click('#restartBtn'); await wait(h.page, 100);
        const o2 = await overlayProbe(h.page, vv.safe);
        check(`${vv.label}：さいしょからの確認カードも同じ`, overlayOk(o2), o2);
        await clickCmd(h.page, 'close'); await wait(h.page, 400);
        await fresh(h.page, 1);
        await playToOver(h.page); await wait(h.page, 700);
        const o3 = await overlayProbe(h.page, vv.safe);
        check(`${vv.label}：終わりのカードも同じ`, overlayOk(o3), o3);
        await h.ctx.close();
      }
    },
  },
  {
    id: 'QW9', tier: 'full', title: 'まとめてポン キーボード：矢印でカーソル（↑が上）、Enter で選ぶ・もう一度で消す、Esc で選びをやめる、U で戻る、M で音のオン/オフ、? で遊び方・Esc で閉じる、R で確認、カードが開いている間は盤が反応しない',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'QW9', { opts: { touch: false } });
      await fresh(page, 1);
      const s0 = await gs(page);
      const g = groupsOf(s0.grid).filter((x) => x.length >= 3).sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1])[0];
      const [tx, ty] = g[0];
      await page.keyboard.press('ArrowRight'); await wait(page, 30);
      const c0 = (await gs(page)).cursor;
      for (let i = 0; i < tx; i++) await page.keyboard.press('ArrowRight');
      for (let i = 0; i < ty; i++) await page.keyboard.press('ArrowUp');
      await wait(page, 30);
      const c1 = (await gs(page)).cursor;
      check(`矢印でカーソルが出て（${J(c0)}）、→ ${tx} 回・↑ ${ty} 回で (${tx},${ty})（${J(c1)}）`, c0 && c0.x === 0 && c0.y === 0 && c1 && c1.x === tx && c1.y === ty, { c0, c1 });
      const info = await page.evaluate(() => document.querySelector('#cellInfo')?.textContent || '');
      check(`カーソルのマスを読み上げる（${info}）`, /つながり/.test(info) && info.includes(String(g.length)), info);
      await page.keyboard.press('Enter'); await wait(page, 40);
      check(`Enter で選ぶ（${(await gs(page)).selected} 個）`, (await gs(page)).selected === g.length, null);
      await page.keyboard.press('Escape'); await wait(page, 40);
      check('Esc で選びをやめる', (await gs(page)).selected === null && (await gs(page)).moves === 0, null);
      await page.keyboard.press('Enter'); await wait(page, 40);
      await page.keyboard.press(' '); await wait(page, 1500);
      const s1 = await gs(page);
      check(`Enter → Space で消える（手 1・点 ${ptsAll(s0.grid, g)}）`, s1.moves === 1 && s1.score === ptsAll(s0.grid, g) && J(s1.grid) === J(simulate(s0.grid, g)), { moves: s1.moves, score: s1.score });
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowLeft'); await wait(page, 30);
      const c2 = (await gs(page)).cursor;
      check(`↓・← でカーソルが下・左へ（${J(c2)}）`, c2 && c2.x === Math.max(0, tx - 1) && c2.y === Math.max(0, ty - 1), c2);
      await page.keyboard.press('u'); await wait(page, 60);
      check('U で 1手もどす（手 0）', (await gs(page)).moves === 0, null);
      const snd0 = await stored(page, 'blockpuzzle.sound');
      await page.keyboard.press('m'); await wait(page, 30);
      const snd1 = await stored(page, 'blockpuzzle.sound'), ap = await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'));
      await page.keyboard.press('m'); await wait(page, 30);
      check(`M で音がオフ（blockpuzzle.sound ${snd1}・aria-pressed ${ap}）、もう一度でオン（${await stored(page, 'blockpuzzle.sound')}）`, snd0 !== 'off' && snd1 === 'off' && ap === 'false' && (await stored(page, 'blockpuzzle.sound')) === 'on', { snd0, snd1, ap });
      await playMoves(page, [g[0]]);
      await page.keyboard.press('?'); await wait(page, 60);
      const h = await overlayInfo(page);
      const cBefore = (await gs(page)).cursor;
      // Enter・Space は、カードの中でフォーカスのあるボタンを押す（標準の動き）ので、ここでは盤のキーだけ確かめる
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('u'); await wait(page, 60);
      const sH = await gs(page);
      check(`? で遊び方（${h.shown}・フォーカスは ${h.active}）、開いている間は矢印・U で盤が動かない`, h.shown && h.active === 'close' && sH.overlay === 'help' && J(sH.cursor) === J(cBefore) && sH.selected === null && sH.moves === 1, { h: h.shown, cursor: sH.cursor, cBefore, moves: sH.moves });
      await page.keyboard.press('Escape'); await wait(page, 60);
      check('Esc で遊び方が閉じる', !(await overlayInfo(page)).shown, null);
      await page.keyboard.press('r'); await wait(page, 60);
      const cf = await overlayInfo(page);
      await page.keyboard.press('Escape'); await wait(page, 60);
      check(`R で さいしょからの確認（${cf.cmds.join(',')}）、Esc で閉じて手はそのまま`, cf.shown && cf.cmds.includes('newBoard') && !(await overlayInfo(page)).shown && (await gs(page)).moves === 1, cf);
      await ctx.close();
    },
  },
  {
    id: 'QW10', tier: 'full', title: 'まとめてポン 動きを減らす：reducedMotion: reduce で calm、消す演出が 0.3 秒以内に終わる（通常は演出中）、全部消しのお祝いも短い',
    async run({ browser, check }) {
      for (const calm of [false, true]) {
        const { ctx, page } = await openG(browser, `QW10 ${calm ? 'reduce' : 'normal'}`, { opts: calm ? { reducedMotion: 'reduce' } : {} });
        await fresh(page, 1);
        const s0 = await gs(page);
        const g = groupsOf(s0.grid).filter((x) => x.length >= 3).sort((a, b) => b.length - a.length)[0];
        await tapReal(page, g[0][0], g[0][1]); await wait(page, 40);
        await tapReal(page, g[0][0], g[0][1]);
        await wait(page, calm ? 300 : 60);
        const busy = await page.evaluate(() => window.MatometeGame.isAnimating());
        await wait(page, 1500);
        const s1 = await gs(page);
        if (calm) check(`動きを減らす：calm ${s0.calm}、消す演出が 0.3 秒で終わっている（isAnimating ${busy}）`, s0.calm === true && busy === false && s1.moves === 1 && J(s1.grid) === J(simulate(s0.grid, g)), { calm: s0.calm, busy });
        else check(`通常：calm ${s0.calm}、消した 0.06 秒後はまだ演出中（${busy}）・のちに終わる`, s0.calm === false && busy === true && s1.moves === 1 && s1.phase === 'idle', { calm: s0.calm, busy });
        if (calm) {
          await fresh(page, CLEAR_SEED);
          await playMoves(page, CLEAR1.slice(0, -1));
          const last = CLEAR1[CLEAR1.length - 1];
          await tapReal(page, last[0], last[1]); await wait(page, 40);
          await tapReal(page, last[0], last[1]);
          let at = -1;
          for (let i = 0; i < 60; i++) { await wait(page, 50); if ((await gs(page)).overlay === 'over') { at = (i + 1) * 50; break; } }
          check(`動きを減らす：全部消しから終わりのカードまで 2 秒以内（${at}ms）`, at > 0 && at <= 2000, at);
        }
        await ctx.close();
      }
    },
  },
  {
    id: 'QW11', tier: 'full', audio: true, title: 'まとめてポン 効果音：選ぶ select(n)・消える pop(n＝消した数)・落ちる fall・1個 deny・もどす undo・はじめる start・終わり over・全部消し allclear・ベスト best が起きたときに鳴り、実際に音の部品が動く。♪でオフにすると鳴らない',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'QW11', { opts: { initScript: SFX_SPY } });
      await fresh(page, 1);
      const s0 = await gs(page);
      const groups = groupsOf(s0.grid);
      const g = groups.filter((x) => x.length >= 3).sort((a, b) => b.length - a.length)[0];
      await tapReal(page, g[0][0], g[0][1]); await wait(page, 60);
      await tapReal(page, g[0][0], g[0][1]); await wait(page, 1500);
      const single = groupsOf((await gs(page)).grid).find((x) => x.length === 1);
      await tapReal(page, single[0][0], single[0][1]); await wait(page, 100);
      await page.click('#undoBtn'); await wait(page, 100);
      await page.click('#restartBtn'); await wait(page, 100);
      await clickCmd(page, 'newBoard'); await wait(page, 400);
      const ps1 = await plays(page);
      const first = (n) => ps1.find((p) => p.n === n);
      const sel = first('select'), pop = first('pop');
      check(`選ぶと select（引数 ${sel && sel.a} ＝ ${g.length}）、消すと pop（引数 ${pop && pop.a} ＝ ${g.length}）`, !!sel && sel.a === g.length && !!pop && pop.a === g.length, ps1.map((p) => p.n));
      const bl = first('blast');
      check(`${g.length} こ（5こ以上）を消すと まわりの音 blast（引数 ${bl && bl.a} ＝ r 1）も鳴る`, g.length < BIG || (!!bl && bl.a === 1), ps1.map((p) => p.n));
      const after = simulate(s0.grid, g);
      const fell = s0.grid.some((c, x) => c.some((v, y) => v !== null && after[x] && J(after[x]) !== J(c)));
      check(`落ちるマスがあれば fall（${fell}）、1個のマスで deny、1手もどすで undo、あたらしい ばんで start`, (!fell || !!first('fall')) && !!first('deny') && !!first('undo') && !!first('start'), ps1.map((p) => p.n));
      // 終わり・全部消し・ベスト。API で一気に消すと音の部品の上限（36）を使い切るので、最後の手の前に実時間で 1 秒待つ
      await fresh(page, 1);
      const toOver = greedyMoves((await gs(page)).grid);
      await playMoves(page, toOver.slice(0, -1)); await sleep(1000);
      await playMoves(page, toOver.slice(-1)); await wait(page, 700);
      await page.click('#againBtn'); await wait(page, 300);
      await fresh(page, CLEAR_SEED);
      await playMoves(page, CLEAR1.slice(0, -1)); await sleep(1000);
      await playMoves(page, CLEAR1.slice(-1)); await wait(page, 800);
      const ps2 = await plays(page);
      check(`回の終わりで over、全部消しで allclear、ベスト更新で best（${[...new Set(ps2.map((p) => p.n))].join(',')}）`, ['over', 'allclear', 'best'].every((n) => ps2.some((p) => p.n === n)), null);
      const firsts = [...new Set(ps2.map((p) => p.n))].map((n) => ps2.find((p) => p.n === n));
      check('鳴らした音はすべて "matomete" の音の表にあり、それぞれ最初の 1 回は音の部品が start した', ps2.every((p) => p.known) && firsts.every((p) => p.d > 0), firsts.filter((p) => !p.known || !p.d));
      // ♪でオフ
      await wait(page, 700);
      await page.click('#againBtn'); await wait(page, 400);
      await page.click('#soundBtn'); await wait(page, 50);
      const n0 = (await plays(page)).length;
      const s3 = await gs(page);
      const g3 = groupsOf(s3.grid).filter((x) => x.length >= 2)[0];
      await tapReal(page, g3[0][0], g3[0][1]); await wait(page, 60);
      await tapReal(page, g3[0][0], g3[0][1]); await wait(page, 1500);
      const ps3 = (await plays(page)).slice(n0);
      check(`♪ でオフ（aria-pressed ${await page.evaluate(() => document.querySelector('#soundBtn').getAttribute('aria-pressed'))}）にすると、選ぶ・消すで音の部品が動かない（${ps3.map((p) => `${p.n}:${p.d}`).join(',')}）`, ps3.length > 0 && ps3.every((p) => p.d === 0) && (await stored(page, 'blockpuzzle.sound')) === 'off', ps3);
      await page.click('#soundBtn');
      await ctx.close();
    },
  },
  {
    id: 'QW12', tier: 'full', title: 'まとめてポン オフライン：sw.js の APP_FILES に games/matomete/* がすべて入り、接続を切っても開いて遊べ、部品は Service Worker から読まれ、メニューに戻れる',
    async run({ browser, check, srv, root }) {
      const info = swInfo(root);
      const dir = path.join(root, 'games/matomete');
      const actual = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : [];
      const want = [...new Set(['./games/matomete/', ...['index.html', 'logic.js', 'render.js', 'input.js', 'main.js'].map((f) => `./games/matomete/${f}`), ...actual.map((f) => `./games/matomete/${f}`)])];
      const missing = want.filter((f) => !info.files.includes(f));
      check(`sw.js の APP_FILES に games/matomete/ の ${want.length} 件がすべてある（足りない：${missing.join(' / ') || 'なし'}）`, missing.length === 0 && actual.length >= 5, missing);
      if (missing.length) return;
      srv.reset();
      const { ctx, page } = await newPage(browser, custom(390, 844, null, 'iPhone 13'), 'QW12', { sw: true, allowNetErrors: true });
      await page.goto(BASE);
      const ok = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]));
      if (!ok) throw new Error('Service Worker が 8 秒以内に有効にならない（事前キャッシュの install 失敗の可能性）');
      if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }); }
      await page.evaluate(() => localStorage.setItem('matomete.help', '1'));
      await sleep(200);
      await srv.ctl('offline=1');
      const resp = [];
      page.on('response', (r) => { if (/\/games\/matomete\/|\/common\/sfx\.js/.test(r.url())) resp.push({ f: r.url().split('/').slice(-2).join('/'), status: r.status(), sw: r.fromServiceWorker() }); });
      await page.goto(MT, { timeout: 10000 }); await sleep(500);
      const libs = await page.evaluate(() => ({ L: typeof window.MatometeLogic?.applyRemove, R: typeof window.MatometeRender?.create, I: typeof window.MatometeInput?.attach, Y: typeof window.YubiSfx?.create, G: typeof window.MatometeGame?.state }));
      check('オフラインで開き、MatometeLogic・MatometeRender・MatometeInput・YubiSfx・MatometeGame が使える', Object.values(libs).every((x) => x === 'function'), libs);
      const js = ['logic.js', 'render.js', 'input.js', 'main.js', 'common/sfx.js'].map((f) => ({ f, hit: resp.find((r) => r.f.endsWith(f)) }));
      check('logic.js・render.js・input.js・main.js・sfx.js を Service Worker から 200 で読んだ', js.every((x) => x.hit && x.hit.sw && x.hit.status === 200), { js, resp });
      if (libs.G === 'function') {
        const s = await gs(page);
        const g = groupsOf(s.grid).find((x) => x.length >= 2);
        await playMoves(page, [g[0]]);
        check(`オフラインで遊べる（1 手消せた。moves ${(await gs(page)).moves}）`, (await gs(page)).moves === 1, null);
      }
      await page.click('a#back'); await page.waitForURL(BASE, { timeout: 5000 }).catch(() => {});
      check('オフラインのまま、メニューに戻れる', page.url() === BASE && await page.locator('a.game').count() >= 2, page.url());
      await srv.ctl('offline=0');
      await ctx.close();
    },
  },
  {
    id: 'QW13', tier: 'full', cdp: CDP, title: 'まとめてポン タッチ：盤の素早い2回タップで消える（2回目の touchend を止めて拡大しない）、.tools のダブルタップも拡大しない、遊び方を閉じた直後の押下が盤に届かない',
    async run({ browser, check }) {
      const TE_SPY = () => { window.__te = []; window.addEventListener('touchend', (e) => window.__te.push({ p: e.defaultPrevented })); };
      const { ctx, page } = await newPage(browser, custom(390, 664, null, 'iPhone 13 Safari'), 'QW13', { device: 'iPhone 13', initScript: TE_SPY, clock: true });
      await gotoG(page);
      await fresh(page, 1);
      const g0 = await page.evaluate(() => {
        const el = document.querySelector('#board');
        const d = el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        const gsv = ['gesturestart', 'gesturechange'].map((n) => el.dispatchEvent(new Event(n, { bubbles: true, cancelable: true })));
        return { dbl: !d, gesture: gsv.every((x) => !x), ta: getComputedStyle(document.querySelector('#board')).touchAction + '/' + getComputedStyle(document.body).touchAction };
      });
      check(`#board：dblclick・gesturestart/change を止め、touch-action ${g0.ta}（manipulation か none）`, g0.dbl && g0.gesture && /manipulation|none/.test(g0.ta), g0);
      const t = await touch(ctx, page);
      const s0 = await gs(page);
      const g = groupsOf(s0.grid).filter((x) => x.length >= 3).sort((a, b) => b.length - a.length)[0];
      const r = await page.evaluate(([x, y]) => window.MatometeGame.cellRect(x, y), g[0]);
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      await page.evaluate(() => window.__te.splice(0));
      await frozen(page, async () => { await t.tap(cx, cy); await sleep(100); await t.tap(cx, cy); });
      await sleep(60); await wait(page, 1500);
      const ev = await page.evaluate(() => window.__te.splice(0));
      const s1 = await gs(page), sc = await page.evaluate(() => window.visualViewport.scale);
      check(`素早い2回タップでかたまりが消え（moves ${s1.moves}）、touchend が止められ（${ev.map((e) => e.p).join(',')}）、拡大しない（scale ${sc}）`, s1.moves === 1 && J(s1.grid) === J(simulate(s0.grid, g)) && ev.length === 2 && ev.every((e) => e.p) && sc === 1, { moves: s1.moves, ev, sc });
      // 「1手もどす」のダブルタップ（「さいしょから」だと1回目で確認カードが開き、2回目はカードに当たる）
      await page.evaluate(() => window.__te.splice(0)); await t.doubleTap('#undoBtn'); await wait(page, 300);
      const toolsEv = await page.evaluate(() => window.__te.splice(0));
      check(`.tools（1手もどす）でも2回目の touchend が止められる（${toolsEv.map((e) => e.p).join(',')}）・拡大しない`, toolsEv.length === 2 && toolsEv[1].p === true && (await page.evaluate(() => window.visualViewport.scale)) === 1, toolsEv);
      // 遊び方を閉じた直後の押下は盤に届かない
      await page.click('#helpBtn'); await wait(page, 200);
      const s2 = await gs(page);
      const g2 = groupsOf(s2.grid).find((x) => x.length >= 2);
      const r2 = await page.evaluate(([x, y]) => window.MatometeGame.cellRect(x, y), g2[0]);
      await frozen(page, async () => {
        await clickCmd(page, 'close');
        await t.send('touchStart', [{ x: r2.left + r2.width / 2, y: r2.top + r2.height / 2 }]); await sleep(40); await t.send('touchEnd', []);
        await sleep(40);
      });
      await wait(page, 100);
      const near = await gs(page);
      check(`遊び方を閉じた直後（300ms 以内）の押下はかたまりを選ばない（selected ${near.selected}）`, near.selected === null && near.overlay === null, near.selected);
      await wait(page, 600);
      await t.tap(r2.left + r2.width / 2, r2.top + r2.height / 2); await wait(page, 100);
      check(`しばらくたてば押せる（selected ${(await gs(page)).selected}）`, (await gs(page)).selected === g2.length, null);
      await ctx.close();
    },
  },
  {
    id: 'QW14', tier: 'full', title: 'まとめてポン 色覚・伝わる：5 色の色と記号がすべて違う、選んだマスのふちが見える（動きを減らす設定でも）、いまの点数がベストを超えると目印、むずかしいの表示',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'QW14', { opts: { reducedMotion: 'reduce' }, extra: { 'matomete.best': '3' } });
      const cs = await page.evaluate(() => window.MatometeLogic.COLORS.map((c) => ({ id: c.id, hex: c.hex, mark: c.mark, name: c.name })));
      check(`COLORS 5 色：色・記号・名前がすべて違う（${cs.map((c) => c.mark).join(',')}）`, cs.length === 5 && new Set(cs.map((c) => c.hex.toLowerCase())).size === 5 && new Set(cs.map((c) => c.mark)).size === 5 && new Set(cs.map((c) => c.name)).size === 5, cs);
      await fresh(page, 1);
      const s0 = await gs(page);
      const g = groupsOf(s0.grid).filter((x) => x.length >= 4).sort((a, b) => b.length - a.length)[0];
      const crop = () => page.evaluate(([x, y]) => {
        const cv = document.querySelector('#boardCanvas'), c = window.MatometeGame.state().cell, k = cv.width / (c * 10);
        return Array.from(cv.getContext('2d').getImageData(Math.floor(x * c * k), Math.floor((19 - y) * c * k), Math.ceil(c * k), Math.ceil(c * k)).data);
      }, g[0]);
      const before = await crop();
      await page.evaluate(([x, y]) => window.MatometeGame.select(x, y), g[0]); await wait(page, 100);
      const sel = await crop();
      const diff = before.reduce((n, v, i) => n + (Math.abs(v - sel[i]) > 40 ? 1 : 0), 0);
      check(`動きを減らす設定でも、選んだマスの絵が変わる（ふち。${diff} 個の値が変化）`, (await gs(page)).calm === true && diff > 20, diff);
      // ベストを超えたら目印
      await page.evaluate(([x, y]) => window.MatometeGame.remove(x, y), g[0]); await wait(page, 100);
      const ob = await page.evaluate(() => document.querySelector('#score').dataset.overBest);
      check(`いまの点数（${(await gs(page)).score}）がベスト 3 を超えると #score[data-over-best="1"]（${ob}）`, (await gs(page)).score > 3 && ob === '1', ob);
      await fresh(page, 2, 'hard');
      const chip = await page.evaluate(() => document.querySelector('#modeChip')?.textContent.trim());
      check(`むずかしいでは、ベストの見出しが「ベスト（むずかしい）」（${chip}）`, chip === 'ベスト（むずかしい）', chip);
      await fresh(page, 2, 'normal');
      const chipN = await page.evaluate(() => document.querySelector('#modeChip')?.textContent.trim());
      check(`ふつうでは「ベスト（ふつう）」（${chipN}）`, chipN === 'ベスト（ふつう）', chipN);
      await ctx.close();
    },
  },
  {
    id: 'QW15', tier: 'full', title: 'まとめてポン メニュー：カードの名前が MatometeLogic.NAME と一致・絵がある、matomete.best が 1516 なら「1,516 てん」、壊れた値・0 なら「まだ記録なし」、7 桁でもはみ出さない、押すとゲームが開く',
    async run({ browser, check, root }) {
      const f = path.join(root, 'games/matomete/logic.js');
      if (!fs.existsSync(f)) throw new Error('games/matomete/logic.js が無い');
      const NAME = createRequire(f)(f).NAME;
      const { ctx, page } = await newPage(browser, STD_V(), 'QW15', { clock: true });
      const card = () => page.evaluate(() => {
        const a = document.querySelector('a.game[href="games/matomete/"]');
        if (!a) return null;
        const b = a.querySelector('.best b');
        const q = a.getBoundingClientRect(), cv = a.querySelector('canvas.art');
        let painted = false;
        if (cv && cv.width > 0) { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { painted = true; break; } }
        return { name: a.querySelector('.name')?.textContent.trim(), desc: a.querySelector('.desc')?.textContent.trim(), best: b?.textContent.trim(), none: b?.classList.contains('none'), aria: a.getAttribute('aria-label'), w: q.width, h: q.height, painted };
      });
      await seed(page, {});
      await page.goto(BASE); await wait(page, 200);
      const c0 = await card();
      check(`メニューにまとめてポンのカードがあり、名前（${c0 && c0.name}）が MatometeLogic.NAME（${NAME}）と一致、説明「${c0 && c0.desc}」、絵が描かれている`, !!c0 && c0.name === NAME && /ポン/.test(c0.desc || '') && c0.h >= 44 && c0.painted, c0);
      check(`記録が無いときは「まだ記録なし」（${c0 && c0.best}）`, c0 && c0.best === 'まだ記録なし' && c0.none === true, c0);
      await seed(page, { 'matomete.best': '1516' });
      await page.goto(BASE); await wait(page, 200);
      const c1 = await card();
      check(`matomete.best が 1516 なら「1,516 てん」（${c1 && c1.best}）、aria-label にも出る`, c1 && c1.best === '1,516 てん' && !c1.none && /1,516 てん/.test(c1.aria), c1);
      await seed(page, { 'matomete.bestHard': '5000' });
      await page.goto(BASE); await wait(page, 150);
      check('むずかしいのベスト（matomete.bestHard）だけなら「まだ記録なし」（カードはふつうのベスト）', (await card()).best === 'まだ記録なし', await card());
      const bad = [];
      for (const raw of ['abc', '-1', '1.5', '', '0', 'NaN', 'Infinity', '1e400', '{}', '9007199254740992']) {
        await seed(page, { 'matomete.best': raw });
        await page.goto(BASE); await wait(page, 150);
        const c = await card();
        if (!c || c.best !== 'まだ記録なし') bad.push(`${raw}: ${c && c.best}`);
      }
      check('壊れた値・0（abc・負・小数・空・NaN・Infinity・1e400・{}・2^53）はぜんぶ「まだ記録なし」でメニューが落ちない', bad.length === 0, bad);
      // 1回の点数の上限は 200 個まとめて (200−2)²＋1000 ＝ 40204（5 桁）。5 桁は省略されずに全部見え、7 桁（壊れた値に近いもの）でもカードがはみ出さない
      for (const v of [STD_V(), view('SE', 'p', 'app')]) {
        await page.setViewportSize({ width: v.w, height: v.h });
        for (const [raw, want, mustFit] of [['40204', '40,204 てん', true], ['9999999', '9,999,999 てん', false]]) {
          await seed(page, { 'matomete.best': raw });
          await page.goto(BASE); await wait(page, 150);
          const cm = await page.evaluate(() => { const a = document.querySelector('a.game[href="games/matomete/"]'); const r = a.getBoundingClientRect(), b = a.querySelector('.best b'); return { right: r.right, iw: innerWidth, hs: document.documentElement.scrollWidth > innerWidth, best: b.textContent, fit: b.scrollWidth <= b.clientWidth + 0.5 }; });
          check(`${v.w}×${v.h}：記録 ${cm.best} でカードがはみ出さない${mustFit ? '・省略されない' : ''}`, cm.best === want && cm.right <= cm.iw + 0.5 && !cm.hs && (!mustFit || cm.fit), cm);
        }
      }
      check('メニューのまとめてポンのカードを押すとゲームが開く', await (async () => { await page.click('a.game[href="games/matomete/"]'); await page.waitForURL('**/games/matomete/', { timeout: 5000 }).catch(() => {}); return page.url() === MT; })(), page.url());
      await ctx.close();
    },
  },
  {
    id: 'QW17', tier: 'smoke', title: 'まとめてポン やさしい・記録：やさしい（3色）で始められ、ベストは matomete.bestEasy、最後のモードを matomete.mode に覚えて開き直しても同じモード（壊れた値は ふつう）、いちばん少ない のこり（matomete.leastEasy。壊れた値は無視）と「まえの … → こんかい …」「さいこう きろく！」、のこり 5 こ以下は小さなお祝い',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'QW17', { v: SMOKE_V(), extra: { 'matomete.best': '50', 'matomete.leastEasy': 'abc' } });
      await fresh(page, 1, 'easy');
      const s0 = await gs(page);
      const chip = await page.evaluate(() => document.querySelector('#modeChip')?.textContent.trim());
      check(`やさしい：mode easy・色 3・盤は 3 色だけ（${[...new Set(s0.grid.flat())].join(',')}）、見出し「${chip}」、ベストは 0（ふつうの 50 と別）`, s0.mode === 'easy' && s0.colors === 3 && new Set(s0.grid.flat()).size === 3 && s0.grid.flat().every((v) => v >= 0 && v <= 2) && chip === 'ベスト（やさしい）' && s0.best === 0 && (await domNums(page)).best === 0, { mode: s0.mode, colors: s0.colors, chip });
      check(`回を始めると matomete.mode が easy（${await stored(page, 'matomete.mode')}）、保存の mode も easy`, (await stored(page, 'matomete.mode')) === 'easy' && JSON.parse(await stored(page, 'matomete.save')).mode === 'easy', null);
      // 種 4・やさしいを「一番大きいかたまりを消し続ける」と、のこり 2 こで終わる
      await fresh(page, 4, 'easy');
      const e1 = await playToOver(page);
      const hint1 = await hintText(page), ov1 = await overlayInfo(page);
      check(`のこり ${e1.remaining} こで終わると小さなお祝い（ヒント「${hint1}」）、カードに「おしい！ あと すこしで ぜんぶ けしだったね！」`, e1.remaining === 2 && !e1.allClear && /あと すこし/.test(hint1 || '') && /のこり 2 こ。おしい！ あと すこしで ぜんぶ けしだったね！/.test(ov1.text), { left: e1.remaining, hint1, text: ov1.text });
      check(`ベストは matomete.bestEasy（${await stored(page, 'matomete.bestEasy')}）に、ふつうの matomete.best は 50 のまま`, (await stored(page, 'matomete.bestEasy')) === String(e1.score) && (await stored(page, 'matomete.best')) === '50', null);
      check(`壊れた matomete.leastEasy（abc）は無視：「まえの」の行は出ず、今回の 2 で書き直す（${await stored(page, 'matomete.leastEasy')}）`, !/まえの/.test(ov1.text) && (await stored(page, 'matomete.leastEasy')) === '2', ov1.text);
      const mb = await page.evaluate(() => ['#modeBtn', '#modeBtn2'].map((q) => document.querySelector(q)?.dataset.mode));
      check(`やさしいの終わりのカードから ふつう・むずかしい を選べる（${mb.join(',')}）`, mb[0] === 'normal' && mb[1] === 'hard', mb);
      // 回が終わってから開き直す：保存は無いが、やさしいのまま
      await page.reload(); await wait(page, 300);
      const r1 = await gs(page);
      check(`回が終わってから開き直しても やさしい（mode ${r1.mode}・色 ${r1.colors}・ベスト ${r1.best}）`, r1.mode === 'easy' && r1.colors === 3 && r1.best === e1.score && r1.moves === 0, { mode: r1.mode });
      // 同じ のこり → 「まえの … → こんかい …」だけ。少ない → 「さいこう きろく！」
      await fresh(page, 12, 'easy');
      const e2 = await playToOver(page), ov2 = await overlayInfo(page);
      check(`前と同じ のこり ${e2.remaining} こ：「まえの いちばん すくない のこり 2 こ → こんかい 2 こ」、「さいこう きろく」は出ない（${ov2.text}）`, e2.remaining === 2 && /まえの いちばん すくない のこり 2 こ → こんかい 2 こ/.test(ov2.text) && !/さいこう きろく/.test(ov2.text), ov2.text);
      await fresh(page, 7, 'easy');
      const e3 = await playToOver(page), ov3 = await overlayInfo(page);
      check(`前より少ない のこり ${e3.remaining} こ：「まえの いちばん すくない のこり 2 こ → こんかい 1 こ」「さいこう きろく！」、matomete.leastEasy が 1（${await stored(page, 'matomete.leastEasy')}）`, e3.remaining === 1 && /まえの いちばん すくない のこり 2 こ → こんかい 1 こ/.test(ov3.text) && /さいこう きろく！/.test(ov3.text) && (await stored(page, 'matomete.leastEasy')) === '1', ov3.text);
      check('ふつう・むずかしいの のこりの記録（matomete.least・leastHard）にはさわらない', (await stored(page, 'matomete.least')) === null && (await stored(page, 'matomete.leastHard')) === null, null);
      // 覚えたモード：壊れた値は ふつう、hard は むずかしい
      const bad = [];
      for (const [raw, want] of [['hard', 'hard'], ['normal', 'normal'], ['Easy', 'normal'], ['x', 'normal'], ['__proto__', 'normal'], ['', 'normal'], ['{"m":1}', 'normal']]) {
        await seed(page, { 'matomete.help': '1', 'matomete.save': null, 'matomete.mode': raw });
        await page.goto(MT); await wait(page, 250);
        const st = await gs(page);
        if (st.mode !== want || st.moves !== 0) bad.push(`${raw}: ${st.mode}`);
      }
      check('覚えたモード matomete.mode：hard・normal はそのモード、壊れた値（Easy・x・__proto__・空・JSON）は ふつう', bad.length === 0, bad);
      await ctx.close();
    },
  },
  {
    id: 'QW19', tier: 'full', title: 'まとめてポン §10 画面：5こ以上を選ぶと まわりの予告（光・札「まわりも！」・初めてのヒント）、消すと まわりが内から外へ順に消え（波）、盤が別実装と一致・canvas も一致、演出 0.9 秒以内、れんぞく 2 で「れんぞく 2」、3 回目は札「ひろがる！」・r=2 の予告・大きな「ひろがる！」、4こ以下で表示が消え、1手もどす・再読み込みで れんぞくも戻る、動きを減らす設定では波なしで すぐ消える',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'QW19');
      await fresh(page, 1);
      const anims = [];
      const greedy = (grid) => groupsOf(grid).filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)[0];
      const sortC = (a) => a.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      const lum = (cells) => page.evaluate(([cells, C, R]) => {
        const cv = document.querySelector('#boardCanvas'), g = cv.getContext('2d'), cell = window.MatometeGame.state().cell, k = cv.width / (cell * C);
        let sum = 0;
        for (const [x, y] of cells) { const d = g.getImageData(Math.floor((x + 0.15) * cell * k), Math.floor((R - 1 - y + 0.6) * cell * k), 1, 1).data; sum += (0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]) * (d[3] / 255); }
        return cells.length ? sum / cells.length : 0;
      }, [cells, COLS, ROWS]);
      const alphaAt = (x, y) => page.evaluate(([x, y, C, R]) => {
        const cv = document.querySelector('#boardCanvas'), cell = window.MatometeGame.state().cell, k = cv.width / (cell * C);
        return cv.getContext('2d').getImageData(Math.floor((x + 0.15) * cell * k), Math.floor((R - 1 - y + 0.6) * cell * k), 1, 1).data[3];
      }, [x, y, COLS, ROWS]);
      const streakEl = () => page.evaluate(() => { const e = document.querySelector('#streak'); return e ? { shown: !e.hidden && e.getBoundingClientRect().width > 0, text: e.textContent.trim(), wide: e.dataset.wide ?? null } : null; });
      // 2回の本物のタップで消し、大きな文字（#burst）を見張る
      const tapAndWatch = async (x, y) => {
        await tapReal(page, x, y); await wait(page, 40);
        await tapReal(page, x, y);
        let burst = null;
        for (let i = 0; i < 24; i++) {
          await wait(page, 50);
          const b = await page.evaluate(() => { const e = document.querySelector('#burst'); return e && !e.hidden && e.getBoundingClientRect().width > 0 ? { text: e.textContent.trim(), kind: e.dataset.kind } : null; });
          if (b && !burst) burst = b;
        }
        const s = await gs(page);
        anims.push(s.animMs);
        return { s, burst };
      };
      // ---- 1 回目（れんぞく 0 → 1）：予告と波 ----
      const s0 = await gs(page);
      const g1 = greedy(s0.grid);
      if (g1.length < BIG) throw new Error(`種 1 のいちばん大きいかたまりが ${g1.length} こ（5 こ以上が要る）`);
      const ex1 = around(s0.grid, g1, 1);
      const others = [];
      for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) if (s0.grid[x][y] !== null && !g1.some(([a, b]) => a === x && b === y) && !ex1.some(([a, b]) => a === x && b === y)) others.push([x, y]);
      await tapReal(page, g1[0][0], g1[0][1]); await wait(page, 3000);   // 明滅が止まってから明るさを比べる
      const sel1 = await gs(page), tag1 = await tagInfo(page), blast1 = await page.evaluate(() => document.querySelector('#tag').dataset.blast ?? null), h1 = await hintText(page);
      check(`5こ以上（${g1.length} こ）を選ぶと、まわり ${ex1.length} こ（r=1）を予告（state の extraCells・radius 1）、札「${tag1.text}」・data-blast 1、ヒント「${h1}」`,
        sel1.selected === g1.length && J(sortC(sel1.extraCells)) === J(ex1) && sel1.radius === 1 && blast1 === '1' && tag1.text.startsWith('まわりも！') && tag1.text.includes(`${g1.length + ex1.length}こ`) && tag1.text.includes(`＋${ptsAll(s0.grid, g1)}てん`) && /5こ いじょうだと まわりも けせるよ/.test(h1 || '') && /もういちど/.test(h1 || ''), { sel: sel1.extraCells.length, tag1, blast1, h1 });
      const le = await lum(ex1), lo = await lum(others);
      check(`予告の光：まわりのマスは ほかのマスより明るい（明るさ ${le.toFixed(0)} と ${lo.toFixed(0)}）`, le > lo * 1.5, { le, lo });
      // 波：かたまりのポン（0.11 秒）のあと、中心に近いマスから順に消える
      let gcx = 0, gcy = 0; for (const [x, y] of g1) { gcx += x + 0.5; gcy += y + 0.5; } gcx /= g1.length; gcy /= g1.length;
      const byD = ex1.map(([x, y]) => ({ x, y, d: Math.hypot(x + 0.5 - gcx, y + 0.5 - gcy) })).sort((a, b) => a.d - b.d);
      const nearC = byD[0], farC = byD[byD.length - 1];
      await tapReal(page, g1[0][0], g1[0][1]);
      await wait(page, 175);
      const mid = { busy: await page.evaluate(() => window.MatometeGame.isAnimating()), near: await alphaAt(nearC.x, nearC.y), far: await alphaAt(farC.x, farC.y), animMs: (await gs(page)).animMs };
      await wait(page, 900);
      const s1 = await gs(page);
      anims.push(s1.animMs);
      const exp1 = simulate(s0.grid, g1, 0);
      check(`波：消して 0.175 秒（演出中 ${mid.busy}）は、中心にいちばん近いまわりのマス（${nearC.x},${nearC.y}）がもう消え（不透明度 ${mid.near}）、いちばん遠いマス（${farC.x},${farC.y}）はまだある（${mid.far}）`, mid.busy === true && farC.d - nearC.d > 1 && mid.near < 80 && mid.far > 200, mid);
      check(`消したあと：盤が別実装（かたまり＋まわり 11 こ前後＋落下＋左詰め）と同じ、点 ${ptsAll(s0.grid, g1)}、れんぞく 1、演出 ${s1.animMs}ms（0.9 秒以内）・もう終わっている`, J(s1.grid) === J(exp1) && s1.score === ptsAll(s0.grid, g1) && s1.streak === 1 && s1.animMs > 0 && s1.animMs <= 900 && !(await page.evaluate(() => window.MatometeGame.isAnimating())), { diff: diffCells(s1.grid, exp1).slice(0, 5), score: s1.score, streak: s1.streak, animMs: s1.animMs });
      check('消したあとの canvas の色が state.grid と一致', diffCells(await boardColors(page), s1.grid).length === 0, diffCells(await boardColors(page), s1.grid).slice(0, 5));
      const b1 = await streakEl();
      check(`盤の上に「${b1 && b1.text}」（れんぞく 1）、ヒントで あと何回で ひろがるか（${await hintText(page)}）`, b1 && b1.shown && b1.text === 'れんぞく 1' && /あと 2かい/.test((await hintText(page)) || ''), { b1, h: await hintText(page) });
      // ---- れんぞく 2・3 回目まで、いちばん大きいかたまりを消し続ける（目的の手だけ本物のタップ） ----
      let r2 = null, r3 = null, sel3 = null, tag3 = null, h3 = null, pre3 = null;
      for (let i = 0; i < 80 && !(r2 && r3); i++) {
        const st = await gs(page);
        if (st.over) break;
        const g = greedy(st.grid);
        if (!g) break;
        if (g.length >= BIG && st.streak === 1 && !r2) { pre3 = null; const res = await tapAndWatch(g[0][0], g[0][1]); r2 = { ...res, exp: simulate(st.grid, g, 1), b: await streakEl() }; continue; }
        if (g.length >= BIG && st.streak === 2 && r2 && !r3) {
          await tapReal(page, g[0][0], g[0][1]); await wait(page, 60);
          sel3 = await gs(page); tag3 = await tagInfo(page); h3 = await hintText(page);
          pre3 = { st, g, ex: around(st.grid, g, 2), blast: await page.evaluate(() => document.querySelector('#tag').dataset.blast ?? null) };
          await page.keyboard.press('Escape'); await wait(page, 40);
          const res = await tapAndWatch(g[0][0], g[0][1]);
          r3 = { ...res, exp: simulate(st.grid, g, 2), b: await streakEl() };
          continue;
        }
        if (r2 && !r3 && st.streak === 0) r2 = null;   // とちゅうで切れたら、もう一度 れんぞく 2 から
        await page.evaluate(([x, y]) => window.MatometeGame.remove(x, y), g[0]);
      }
      if (!r2 || !r3) throw new Error('種 1 で れんぞく 2・3 回目まで進めない');
      check(`れんぞく 2 回目：大きな「${r2.burst && r2.burst.text}」が出て、盤の上は「${r2.b && r2.b.text}」、盤は別実装と同じ`, r2.burst && r2.burst.text === 'れんぞく 2' && r2.b.text === 'れんぞく 2' && r2.s.streak === 2 && J(r2.s.grid) === J(r2.exp), { burst: r2.burst, b: r2.b });
      check(`3 回目を選ぶと 予告が広い（r=2・まわり ${pre3.ex.length} こ）、札「${tag3.text}」・data-blast 2、ヒント「${h3}」`, sel3.radius === 2 && J(sortC(sel3.extraCells)) === J(pre3.ex) && pre3.blast === '2' && tag3.text.startsWith('ひろがる！') && tag3.text.includes(`＋${ptsAll(pre3.st.grid, pre3.g, 2)}てん`) && /ひろがって/.test(h3 || ''), { r: sel3.radius, n: sel3.extraCells.length, tag3, h3 });
      check(`3 回目を消すと 大きな「${r3.burst && r3.burst.text}」（data-kind ${r3.burst && r3.burst.kind}）、盤の上は「${r3.b && r3.b.text}」、盤は別実装（r=2）と同じ、点が合う`, r3.burst && r3.burst.text === 'ひろがる！' && r3.burst.kind === 'wide' && r3.b.text === 'ひろがる！ れんぞく 3' && r3.b.wide === '1' && r3.s.streak === 3 && J(r3.s.grid) === J(r3.exp) && r3.s.score === pre3.st.score + ptsAll(pre3.st.grid, pre3.g, 2), { burst: r3.burst, b: r3.b });
      check(`まわりも消える演出はどれも 0.9 秒以内（${anims.join('・')}ms）`, anims.length >= 3 && anims.every((m) => m > 0 && m <= 900), anims);
      // 4こ以下を消すと れんぞく 0・表示が消える。1手もどすと れんぞく 3 に戻る。再読み込みでも同じ
      const s3 = await gs(page);
      const small = groupsOf(s3.grid).filter((x) => x.length >= 2 && x.length < BIG)[0];
      await page.evaluate(([x, y]) => window.MatometeGame.remove(x, y), small[0]); await wait(page, 50);
      const s4 = await gs(page), b4 = await streakEl();
      check(`${small.length} こ（4こ以下）を消すと れんぞく 0、盤の上の表示が消える（${J(b4)}）`, s4.streak === 0 && !b4.shown && J(s4.grid) === J(simulate(s3.grid, small, 3)), { streak: s4.streak, b4 });
      await page.click('#undoBtn'); await wait(page, 100);
      const s5 = await gs(page), b5 = await streakEl();
      check(`1手もどすと れんぞく 3 に戻り、表示「${b5.text}」も戻る`, s5.streak === 3 && b5.shown && b5.text === 'ひろがる！ れんぞく 3' && J(s5.grid) === J(s3.grid), { streak: s5.streak, b5 });
      await page.reload(); await wait(page, 300);
      const s6 = await gs(page), b6 = await streakEl();
      check(`再読み込みしても れんぞく 3（${s6.streak}）・表示「${b6.text}」`, s6.streak === 3 && b6.shown && J(s6.grid) === J(s3.grid), { streak: s6.streak });
      // いちばん長い演出も 0.9 秒以内：種 1〜4 の ふつう・種 1〜2 の やさしいを「一番大きいかたまり」で終わりまで消し、まわりも消えた手の演出の長さの最大を見る
      const longest = await page.evaluate(([C, R, B]) => {
        const G = window.MatometeGame; let max = 0, n = 0;
        for (const [sd, md] of [[1, 'normal'], [2, 'normal'], [3, 'normal'], [4, 'normal'], [1, 'easy'], [2, 'easy']]) {
          G.newSeed(sd, md);
          for (let k = 0; k < 200 && !G.state().over; k++) {
            const grid = G.state().grid, seen = new Set(); let best = null;
            for (let x = 0; x < C; x++) for (let y = 0; y < R; y++) {
              if (grid[x][y] === null || seen.has(x * 100 + y)) continue;
              const st = [[x, y]], v = grid[x][y]; let size = 0; seen.add(x * 100 + y);
              while (st.length) { const [a, b] = st.pop(); size++; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = a + dx, ny = b + dy; if (nx >= 0 && ny >= 0 && nx < C && ny < R && !seen.has(nx * 100 + ny) && grid[nx][ny] === v) { seen.add(nx * 100 + ny); st.push([nx, ny]); } } }
              if (size >= 2 && (!best || size > best.size)) best = { x, y, size };
            }
            if (!best) break;
            G.remove(best.x, best.y);
            if (best.size >= B) { n++; max = Math.max(max, G.state().animMs || 0); }
          }
        }
        return { max, n };
      }, [COLS, ROWS, BIG]);
      check(`まわりも消える手 ${longest.n} 回（種 1〜4 ふつう・種 1〜2 やさしい）の演出の最大 ${longest.max}ms も 0.9 秒以内`, longest.n >= 20 && longest.max > 0 && longest.max <= 900, longest);
      await ctx.close();
      // ---- 動きを減らす設定：波・粒・揺れなし。まわりもかたまりと同時に薄くなって すぐ消える ----
      const C2 = await openG(browser, 'QW19 reduce', { opts: { reducedMotion: 'reduce' } });
      const p2 = C2.page;
      await fresh(p2, 1);
      const c0 = await gs(p2);
      const cg = greedy(c0.grid);
      await tapReal(p2, cg[0][0], cg[0][1]); await wait(p2, 40);
      await tapReal(p2, cg[0][0], cg[0][1]); await wait(p2, 200);
      const c1 = await gs(p2);
      check(`動きを減らす：5こ以上でも 0.2 秒で消え終わる（isAnimating ${c1.busy}・演出 ${c1.animMs}ms）、盤は別実装と同じ`, c1.calm === true && c1.busy === false && c1.animMs <= 200 && J(c1.grid) === J(simulate(c0.grid, cg, 0)) && c1.streak === 1, { busy: c1.busy, animMs: c1.animMs });
      await C2.ctx.close();
    },
  },
  {
    id: 'QW18', tier: 'full', title: 'まとめてポン 2回目のずれ・明滅・横向き：選んだかたまりのマスから半マス以内なら（となりのかたまりの上でも）2回目として消える、それより遠いと選び直し、明滅は数秒で止まり rAF と fx の描き直しも止まる、横向きでマスが小さいと1個のマスを押したときにも「たてむき」を出し直す（出しすぎない）',
    async run({ browser, check }) {
      const { ctx, page } = await openG(browser, 'QW18', { v: SMOKE_V() });
      await fresh(page, 1);
      const s0 = await gs(page);
      const groups = groupsOf(s0.grid);
      const idOf = (x, y) => groups.findIndex((g) => g.some(([a, b]) => a === x && b === y));
      // 選ぶかたまり G と、その右どなりの別のかたまりのマス N
      let G = null, edge = null;
      for (const g of groups.filter((x) => x.length >= 3).sort((a, b) => b.length - a.length)) {
        const e = g.find(([x, y]) => x + 1 < COLS && s0.grid[x + 1][y] !== null && idOf(x + 1, y) !== idOf(x, y) && groups[idOf(x + 1, y)].length >= 2);
        if (e) { G = g; edge = e; break; }
      }
      if (!G) throw new Error('右どなりに 2 個以上の別のかたまりがある 3 個以上のかたまりが見つからない');
      const N = groups[idOf(edge[0] + 1, edge[1])];
      const er = await page.evaluate(([x, y]) => window.MatometeGame.cellRect(x, y), edge);
      const c = er.width;
      const at = (k) => [er.left + er.width + k * c, er.top + er.height / 2];   // 選んだマスの右ふちから k マス右
      await tapReal(page, edge[0], edge[1]); await wait(page, 60);
      await page.mouse.click(...at(0.4)); await wait(page, 1500);
      const s1 = await gs(page);
      check(`選んで（${G.length} 個）から、右どなりのかたまりのマスの上でも 選んだマスから 0.4 マス（${(0.4 * c).toFixed(1)}px）なら 2回目として消える`, s1.moves === 1 && J(s1.grid) === J(simulate(s0.grid, G)), { moves: s1.moves, selected: s1.selected });
      await fresh(page, 1);
      await tapReal(page, edge[0], edge[1]); await wait(page, 60);
      await page.mouse.click(...at(0.75)); await wait(page, 100);
      const s2 = await gs(page);
      check(`0.75 マス離れると選び直し（となりのかたまり ${N.length} 個を選ぶ・消えない）`, s2.moves === 0 && s2.selected === N.length, { moves: s2.moves, selected: s2.selected });
      // 盤の上の段の外側（盤のふちの外）でも、半マス以内なら 2回目
      const top = G.slice().sort((a, b) => b[1] - a[1])[0];
      await fresh(page, 1);
      await tapReal(page, top[0], top[1]); await wait(page, 60);
      const tr = await page.evaluate(([x, y]) => window.MatometeGame.cellRect(x, y), top);
      await page.mouse.click(tr.left + tr.width / 2, tr.top - 0.35 * c); await wait(page, 1500);
      const s3 = await gs(page);
      check(`選んだかたまりのいちばん上のマス（${top}）の 0.35 マス上を押しても 2回目として消える`, s3.moves === 1 && J(s3.grid) === J(simulate(s0.grid, G)), { moves: s3.moves, sel: s3.selected });
      // 明滅は数秒で止まる：rAF のコマが増えない・fx を描き直さない
      await fresh(page, 1); await wait(page, 1500);
      const f0 = await gs(page);
      await tapReal(page, edge[0], edge[1]); await wait(page, 500);
      const f1 = await gs(page);
      await wait(page, 3000);
      const f2 = await gs(page);
      await wait(page, 1500);
      const f3 = await gs(page);
      check(`選んだ直後は明滅で描き続け（0.5 秒で ${f1.frames - f0.frames} コマ）、3.5 秒後には止まる（その後 1.5 秒で ${f3.frames - f2.frames} コマ）。選んでいる間 fx は描き直さない（${f3.fxDraws - f0.fxDraws} 回）`, f1.frames - f0.frames >= 10 && f3.frames - f2.frames === 0 && f3.fxDraws === f0.fxDraws && f3.selected === G.length, { f0: f0.frames, f1: f1.frames, f2: f2.frames, f3: f3.frames, fx: [f0.fxDraws, f3.fxDraws] });
      await page.mouse.click(...at(0.2)); await wait(page, 100);
      await wait(page, 2000);
      const f4 = await gs(page);
      await wait(page, 1000);
      const f5 = await gs(page);
      check(`消したあと粒が消えたら fx の描き直しも止まる（1 秒で ${f5.fxDraws - f4.fxDraws} 回）、rAF も止まる（${f5.frames - f4.frames} コマ）`, f4.moves === 1 && f5.fxDraws === f4.fxDraws && f5.frames === f4.frames, { f4: [f4.frames, f4.fxDraws], f5: [f5.frames, f5.fxDraws] });
      await ctx.close();
      // 横向き（SE 568×320）：はじめに「たてむき」。1個のマスを押すと、20 秒あけて出し直す（すぐ続けては出さない）
      const L2 = await openG(browser, 'QW18 横', { v: view('SE', 'l', 'app') });
      const p2 = L2.page;
      await fresh(p2, 1);
      const g2 = await gs(p2);
      const singles = groupsOf(g2.grid).filter((g) => g.length === 1);
      const h0 = await hintText(p2);
      await wait(p2, 21000);
      await tapReal(p2, singles[0][0][0], singles[0][0][1]); await wait(p2, 400);
      const h1 = await hintText(p2);
      await tapReal(p2, singles[1][0][0], singles[1][0][1]); await wait(p2, 400);
      const h2 = await hintText(p2);
      check(`横向き（マス ${g2.cell}px）：1個のマスを押すと「${h1}」（たてむきを出し直す）、すぐ続けて押すと「${h2}」（出し直さない）`, g2.cell < 22 && /2こ いじょう/.test(h1 || '') && /たてむき/.test(h1 || '') && /2こ いじょう/.test(h2 || '') && !/たてむき/.test(h2 || ''), { h0, h1, h2, cell: g2.cell });
      await L2.ctx.close();
    },
  },
];
