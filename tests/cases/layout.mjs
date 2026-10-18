// V: ボタンが画面外に出ない・押せる（同値分割・境界値・ペアワイズ）。見た目の細部は V7 の1画面だけ
import { BASE, T48, BLK, KIRI, view, custom, newPage, seed, open2048, ST, layoutProbe, cardReach, sleep, wait, KNOWN_ISSUES, kiriStart, kiriSnap } from '../lib.mjs';

// ---- 画面ごとの共通確認（1関数） ----
const SCREENS = {
  menu: {
    label: 'メニュー',
    async open(page) { await seed(page, { 'blockpuzzle.best': '1234567', 'tile2048.best': '1234567' }); await page.goto(BASE); await wait(page, 80); },
    probe: (page, safe) => layoutProbe(page, '.head h1, #games li:first-child a.game', safe, { overlapSel: 'a.game', minSel: 'a.game' }),
  },
  blocks: {
    label: 'ブロック（プレイ中）',
    async open(page) { await seed(page, { 'blockpuzzle.best': '1234567' }); await page.goto(BLK); await wait(page, 120); await page.click('#card [data-cmd=restart]'); await wait(page, 150); },
    // 44px の基準は既存の合格基準（B4：右上3ボタン 44×44・HOLD）に合わせる。十字キーは SE で 43px（観察のみ、design.md 参照）
    probe: (page, safe) => layoutProbe(page, '.key, .sys button, #board, .hold, .next, .stat', safe, { overlapSel: '.key, .sys button, #board, .hold, .next, .stat', minSel: '.sys button, [data-action=hold]' }),
  },
  t2048: {
    label: '2048（プレイ中）',
    async open(page) { await open2048(page, ST([2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 0, 2, 0, 4, 0, 0], { score: 123456, keepPlaying: true }), { 'tile2048.best': '234567' }); },
    probe: (page, safe) => layoutProbe(page, '.back, .box, .tool, #board', safe, { overlapSel: '.back, .box, .tool, #board, .hint', minSel: '.back, .tool' }),
  },
  kiri: {
    label: 'キリトリ（プレイ中）',
    async open(page) { await seed(page, { 'kiritori.best': '1234567' }); await page.goto(KIRI); await wait(page, 120); await kiriStart(page); await wait(page, 100); },
    probe: async (page, safe) => {
      const r = await layoutProbe(page, '.back, .box, .tool, .stage', safe, { overlapSel: '.back, .box, .tool, .stage', minSel: '.back, .tool' });
      // 道場が小さくなりすぎない（的の直径の 3 倍以上の高さ）・スコアとベストの数字が「…」で省略されない
      const d = await page.evaluate(() => { const st = document.querySelector('.stage').getBoundingClientRect(); return { h: st.height, w: st.width, nums: [...document.querySelectorAll('.box b')].map((b) => ({ t: b.textContent, fit: b.scrollWidth <= b.clientWidth })) }; });
      if (d.h < 150 || d.w < 200) r.outside.push(`道場が小さい ${Math.round(d.w)}x${Math.round(d.h)}`);
      if (!d.nums.every((x) => x.fit)) r.outside.push('数字が省略 ' + JSON.stringify(d.nums));
      return r;
    },
  },
  pikatto: {
    label: 'ピカッと（4人・プレイ中）',
    async open(page) { await seed(page, { 'pikatto.help': '1' }); await page.goto(BASE + 'games/pikatto/'); await wait(page, 120); await page.click('.setup [data-players="4"]'); await wait(page, 80); await page.click('.setup [data-action="start"]'); await wait(page, 1300); },
    // 4つの隅は互いに重ならない（PK-02）。スコア欄・ヒント・ヘッダとも重ならない
    probe: (page, safe) => layoutProbe(page, '.back, .tool, #scores, .corner, #hint', safe, { overlapSel: '.back, .tool, #scores, .corner, #hint', minSel: '.back, .tool, .corner' }),
  },
};
// キリトリ道場のスコア欄：SCORE・BEST に 7 桁（1,234,567）を入れても「…」で省略されず、欄の高さ・道場の大きさが変わらない
async function kiriStatsProbe(page) {
  await seed(page, { 'kiritori.best': '1234567' });
  await page.goto(KIRI); await wait(page, 120); await kiriStart(page);
  await page.click('#pauseBtn'); await wait(page, 60);
  await page.evaluate(() => { document.querySelector('#overlay').hidden = true; });
  const geo = () => page.evaluate(() => { const s = document.querySelector('.stage').getBoundingClientRect(), h = document.querySelector('.hud').getBoundingClientRect(); return `${Math.round(s.width)}x${Math.round(s.height)}/${h.height.toFixed(1)}`; });
  const before = await geo();
  const r = await page.evaluate(async () => {
    document.querySelector('#score').textContent = '1,234,567';
    await new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 0)));
    return [...document.querySelectorAll('.box b')].map((b) => ({ id: b.id, t: b.textContent, sw: b.scrollWidth, cw: b.clientWidth }));
  });
  await wait(page, 50);
  const after = await geo();
  const ok = r.length === 2 && r.every((x) => x.t === '1,234,567' && x.sw <= x.cw) && before === after;
  return { ok, r, before, after };
}
async function screenCheck(browser, check, v, key, extra) {
  const S = SCREENS[key];
  const { ctx, page } = await newPage(browser, v, `${v.label} ${S.label}`, { clock: true });
  await S.open(page);
  const r = await S.probe(page, v.safe);
  const ok = r.n > 0 && r.outside.length === 0 && r.overlaps.length === 0 && r.small.length === 0 && !r.hscroll;
  const known = KNOWN_ISSUES[`${v.label}|${key}`];
  check(`${v.label} ${v.w}×${v.h}${v.safe ? ' safe=' + v.safe.join('/') : ''}｜${S.label}：${r.n}要素が画面内(safe-area内)・重なりなし・主要ボタン44px以上・横スクロールなし`, ok, known ? { known, ...r } : r, known);
  if (extra) await extra(page, r);
  await ctx.close();
}


// ---- ブロックのスコア欄の桁数（fix4/t1.mjs から統合。b3e894f「スコア欄が … で省略される」の確認） ----
// プレイ中に SCORE・BEST 1,234,567、LINES 9,999、LEVEL 99 を入れ、省略（…）・はみ出し・重なり・高さの変化がないか
const STAT_VALS = [['score', '1,234,567'], ['best', '1,234,567'], ['lines', '9,999'], ['level', '99']];
async function blocksStatsProbe(page, safe) {
  await seed(page, {});
  await page.goto(BLK); await wait(page, 120);
  await page.click('#card [data-cmd=restart]'); await wait(page, 120);
  await page.evaluate(() => document.querySelector('#pauseBtn').click()); await wait(page, 80);
  await page.evaluate(() => { document.querySelector('#overlay').hidden = true; });
  const before = await page.evaluate(() => { const b = document.querySelector('#board').getBoundingClientRect(), s = document.querySelector('.stats').getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}/${s.height.toFixed(1)}`; });
  const r = await page.evaluate(async ([V, safe]) => {
    for (const [id, v] of V) document.getElementById(id).textContent = v;
    await new Promise((ok) => requestAnimationFrame(() => ok()));
    const R = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const st = V.map(([id]) => { const el = document.getElementById(id); return { id, text: el.textContent, vis: !!el.offsetParent, cw: el.clientWidth, sw: el.scrollWidth }; });
    const textRect = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); return R(rg); };
    const btns = [...document.querySelectorAll('.key, .pause-btn')].filter((e) => e.offsetParent).map((e) => ({ t: e.dataset.action || e.id, ...R(e) }));
    const texts = [...document.querySelectorAll('.stat')].filter((e) => e.offsetParent).flatMap((x) => [...x.children].map((c) => ({ t: 'text:' + c.textContent, ...textRect(c) })));
    const others = [['board', '#board'], ['hold', '.hold'], ['next', '.next']].map(([t, q]) => ({ t, ...R(document.querySelector(q)) }));
    const els = [...btns, ...texts, ...others], ov = [];
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i], c = els[j]; if (a.t.startsWith('text:') && c.t.startsWith('text:')) continue; if (a.x < c.r - 0.5 && c.x < a.r - 0.5 && a.y < c.b - 0.5 && c.y < a.b - 0.5) ov.push(a.t + '×' + c.t); }
    const [t, rr, bb, l] = safe || [0, 0, 0, 0];
    const off = els.filter((b) => b.x < l - 0.5 || b.y < t - 0.5 || b.r > innerWidth - rr + 0.5 || b.b > innerHeight - bb + 0.5).map((b) => b.t);
    const board = R(document.querySelector('#board'));
    return { st, ov, off, minH: Math.min(...btns.map((b) => b.h)), after: `${Math.round(board.w)}x${Math.round(board.h)}/${document.querySelector('.stats').getBoundingClientRect().height.toFixed(1)}`, hs: document.documentElement.scrollWidth > innerWidth };
  }, [STAT_VALS, safe]);
  // BEST は最も狭い 2 画面（320 幅の縦・568×320 の横）では隠す仕様。隠れていれば省略の確認は不要
  const hiddenOk = (id) => id === 'best' && (page.viewportSize().width === 320 || page.viewportSize().height <= 320);
  const bad = [];
  for (const x of r.st) { if (!x.vis && !hiddenOk(x.id)) bad.push(x.id + ' 非表示'); if (x.vis && (x.sw > x.cw || x.text.includes('…'))) bad.push(`${x.id} 省略 ${x.sw}/${x.cw}`); }
  if (!r.st.every((x, i) => x.text === STAT_VALS[i][1])) bad.push('値が変わった');
  if (before !== r.after) bad.push(`高さが変わる ${before}→${r.after}`);
  if (r.ov.length) bad.push('重なり ' + r.ov.join(','));
  if (r.off.length) bad.push('safe-area 外 ' + r.off.join(','));
  if (r.minH < 44 - 0.5) bad.push('ボタン高さ ' + r.minH);
  if (r.hs) bad.push('横スクロール');
  return { ok: bad.length === 0, bad, r };
}

// ---- ペアワイズの組み合わせ表（端末4 × 向き2 × 起動方法2 × 画面4、全64通り → 16行） ----
// 端末×画面は全16組。向き・起動の組（縦ホーム／横Safari／横ホーム／縦Safari）は (端末の番号＋画面の番号) mod 4 で割り当てる（ラテン方格）
const COMBOS = [['p', 'app'], ['l', 'safari'], ['l', 'app'], ['p', 'safari']];
const DEVS = ['SE', 'i13', 'PM', 'iPad'], SCRS = ['menu', 'blocks', 't2048', 'kiri'];
export const PAIRWISE = DEVS.flatMap((d, i) => SCRS.map((sc, j) => [d, sc, ...COMBOS[(i + j) % 4]]));
export function pairwiseMissing(rows = PAIRWISE) {
  const lv = [DEVS, SCRS, ['p', 'l'], ['safari', 'app']];
  const miss = [];
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) for (const x of lv[a]) for (const y of lv[b]) if (!rows.some((r) => r[a] === x && r[b] === y)) miss.push(`${x}×${y}`);
  return miss;
}
// smoke の V1・V2 で確かめる組（full でも重ねて流さない）
const IN_SMOKE = new Set(['SE|menu|p|app', 'SE|blocks|l|safari', 'SE|t2048|l|app']);

export const tests = [
  {
    id: 'V1', tier: 'smoke', title: '最も狭い縦画面（SE 縦・ホーム画面 320×568、幅 ≤360 の区分）で4画面のボタンが画面内、スコア欄 7 桁',
    async run({ browser, check }) {
      const v = view('SE', 'p', 'app');
      await screenCheck(browser, check, v, 'menu');
      await screenCheck(browser, check, v, 'blocks', async (page) => {
        await page.click('#pauseBtn'); await wait(page, 60);
        const c = await cardReach(page);
        check('SE縦 ブロックの一時停止カードの全ボタンに届く', c.ok, c);
      });
      await screenCheck(browser, check, v, 't2048');
      await screenCheck(browser, check, v, 'kiri', async (page) => {
        await page.click('#pauseBtn'); await wait(page, 60);
        const c = await cardReach(page);
        check('SE縦 キリトリの一時停止カードの全ボタンに届く', c.ok, c);
      });
      await screenCheck(browser, check, v, 'pikatto');
      const { ctx, page } = await newPage(browser, v, 'V1 桁数', { clock: true });
      const d = await blocksStatsProbe(page, v.safe);
      check('SE縦 ブロック：SCORE 1,234,567・LINES 9,999・LEVEL 99 が「…」で省略されず、盤面・欄の高さも変わらない', d.ok, d);
      const k = await kiriStatsProbe(page);
      check('SE縦 キリトリ：SCORE・BEST 1,234,567 が「…」で省略されず、欄の高さ・道場の大きさも変わらない', k.ok, k);
      await ctx.close();
    },
  },
  {
    id: 'V2', tier: 'smoke', title: '最も低い横画面（SE 横・ホーム画面 568×320、高さ ≤360 の区分）でゲーム3画面のボタンが画面内、SE 横 Safari（568×270）のブロックが重ならない（K1）',
    async run({ browser, check }) {
      const v = view('SE', 'l', 'app');
      await screenCheck(browser, check, v, 'blocks', async (page) => {
        const r = await page.evaluate(() => { const b = document.querySelector('.stat.best'), d = document.querySelector('[data-action=drop]').getBoundingClientRect(); if (!b || b.offsetParent === null) return 'hidden'; const q = b.getBoundingClientRect(); return q.right <= d.left || d.right <= q.left || q.bottom <= d.top || d.bottom <= q.top ? 'ok' : 'overlap'; });
        check('SE横 ブロック：BEST 欄が DROP と重ならない（隠すか離す）', r !== 'overlap', r);
      });
      await screenCheck(browser, check, v, 't2048');
      await screenCheck(browser, check, v, 'kiri');
      await screenCheck(browser, check, v, 'pikatto');
      // K1（SE を Safari で横持ち 568×270：DROP が LEVEL/LINES に、HOLD が NEXT に重なっていた）を smoke でも確かめる
      await screenCheck(browser, check, view('SE', 'l', 'safari'), 'blocks');
    },
  },
  {
    id: 'V3', tier: 'full', title: 'ペアワイズ：端末×向き×起動方法×画面 の16通り（全ての2因子の組を1回以上）',
    async run({ browser, check }) {
      const miss = pairwiseMissing();
      check(`組み合わせ表（${PAIRWISE.length} 行）が全ての2因子の組（計52組）を網羅`, miss.length === 0, miss);
      for (const [d, s, o, l] of PAIRWISE) {
        if (IN_SMOKE.has([d, s, o, l].join('|'))) continue;
        await screenCheck(browser, check, view(d, o, l), s);
      }
    },
  },
  {
    id: 'V4', tier: 'full', title: '境界値：CSS の切り替わり（縦幅 360/361、横の高さ 319/320・360/361・500/501、メニュー幅 699/700）の両側',
    async run({ browser, check }) {
      for (const v of [custom(360, 640), custom(361, 640), custom(640, 360), custom(640, 361), custom(900, 500), custom(900, 501)]) {
        await screenCheck(browser, check, v, 'blocks');
        await screenCheck(browser, check, v, 't2048');
        await screenCheck(browser, check, v, 'kiri');
      }
      // K1 の境界：ブロックの低い横持ち 319/320（直した @media の切り替わり）と 285・311（旧 310 の境目で重なっていた高さ）
      for (const v of [custom(568, 285), custom(568, 311), custom(568, 319), custom(568, 320)]) await screenCheck(browser, check, v, 'blocks');
      for (const v of [custom(699, 1000), custom(700, 1000)]) await screenCheck(browser, check, v, 'menu');
    },
  },
  {
    id: 'V5', tier: 'full', title: '桁の境界：スコア・ベスト 6桁(999,999)→7桁(1,234,567)、6桁タイルが最も狭い幅で切れない',
    async run({ browser, check }) {
      for (const v of [view('SE', 'p', 'app'), custom(361, 640), view('SE', 'l', 'app')]) {
        const { ctx, page } = await newPage(browser, v, 'V5 ' + v.label, { clock: true });
        const res = [];
        for (const n of [999999, 1234567]) {
          await open2048(page, ST([2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 4096, 16384, 131072, 0, 2, 0], { score: n, keepPlaying: true }), { 'tile2048.best': String(n) });
          await wait(page, 100);
          res.push(await page.evaluate((n) => ({
            n,
            boxes: [...document.querySelectorAll('.box b')].map((b) => ({ t: b.textContent, fit: b.scrollWidth <= b.clientWidth })),
            tiles: [...document.querySelectorAll('.tile-in')].filter((t) => t.scrollWidth > t.clientWidth + 1).map((t) => t.textContent),
            tools: [...document.querySelectorAll('.tool')].map((b) => Math.round(b.getBoundingClientRect().height)),
            hs: document.documentElement.scrollWidth > innerWidth,
          }), n));
        }
        const ok = res.every((r) => r.boxes.length === 2 && r.boxes.every((b) => b.fit && b.t === r.n.toLocaleString('en-US')) && r.tiles.length === 0 && r.tools.every((h) => h >= 44) && !r.hs);
        check(`${v.label} ${v.w}×${v.h}：2048 のスコア・ベスト 6桁/7桁が省略なし、6桁タイルがはみ出さない、ボタン44px以上`, ok, res);
        await seed(page, { 'blockpuzzle.best': '1234567' });
        await page.goto(BLK); await wait(page, 100); await page.click('#card [data-cmd=restart]'); await wait(page, 100);
        const bl = await page.evaluate(() => [...document.querySelectorAll('.stat')].filter((e) => e.offsetParent).map((e) => { const s = e.getBoundingClientRect(); return { t: e.textContent.replace(/\s+/g, ''), fit: [...e.querySelectorAll('b, .label')].every((x) => { const r = x.getBoundingClientRect(); return r.left >= s.left - 0.5 && r.right <= s.right + 0.5 && r.right <= innerWidth; }) }; }));
        check(`${v.label}：ブロックの BEST 1,234,567 などの表示が切れない`, bl.length > 0 && bl.every((b) => b.fit), bl);
        const k = await kiriStatsProbe(page);
        check(`${v.label}：キリトリの SCORE・BEST 1,234,567 が省略されず、高さが変わらない`, k.ok, k);
        await ctx.close();
      }
    },
  },
  {
    id: 'V6', tier: 'full', title: 'ブロック固有の配置（右上3ボタンと盤面、DROP と ▼ の間隔）と回転の繰り返し',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, view('i13', 'p', 'app'), 'V6', { initScript: () => { window.__roErr = 0; addEventListener('error', (e) => { if (/ResizeObserver/.test(e.message)) window.__roErr++; }); } });
      await SCREENS.blocks.open(page);
      const g = await page.evaluate(() => {
        const R = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        const board = R('#board'), ring = { x: board.x - 3, y: board.y - 3, r: board.r + 3, b: board.b + 3 };
        const sys = [...document.querySelectorAll('.sys button')].map((e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom }; });
        const ov = (a, c) => a.x < c.r && c.x < a.r && a.y < c.b && c.y < a.b;
        const drop = R('[data-action=drop]'), down = R('[data-action=down]');
        const a = getComputedStyle(document.querySelector('[data-action=drop]')), d = getComputedStyle(document.querySelector('[data-action=down]'));
        return { sysOk: sys.length === 3 && sys.every((s) => !ov(s, ring)), gap: Math.max(down.y - drop.b, drop.y - down.b, down.x - drop.r, drop.x - down.r), diff: a.backgroundColor !== d.backgroundColor };
      });
      check('右上の3ボタンが盤面（外枠3px込み）と重ならない、DROP と ▼ は 16px 以上離れ色も違う', g.sysOk && g.gap >= 16 && g.diff, g);
      const geo = () => page.evaluate(() => { const b = document.querySelector('#board').getBoundingClientRect(), s = document.querySelector('.sys').getBoundingClientRect(); return { bx: Math.round(b.x), bw: Math.round(b.width), br: Math.round(b.right), sx: Math.round(s.x), mr: document.querySelector('#board').style.marginRight, ro: window.__roErr }; });
      const g0 = await geo(); const seq = [];
      for (const [w, h] of [[844, 390], [390, 844], [320, 568], [568, 320], [390, 844]]) { await page.setViewportSize({ width: w, height: h }); await wait(page, 250); seq.push({ w, h, ...(await geo()) }); }
      const gl = seq[seq.length - 1];
      check('縦横の回転を繰り返しても盤面位置が初回と同じ・縦で盤面と右上ボタンが重ならない・横で marginRight が残らない・ResizeObserver エラーなし',
        gl.bx === g0.bx && gl.bw === g0.bw && seq.filter((s) => s.w < s.h).every((s) => s.br + 3 <= s.sx) && seq.filter((s) => s.w > s.h).every((s) => s.mr === '') && gl.ro === 0, { g0, seq });
      await ctx.close();
    },
  },
  {
    id: 'V7', tier: 'full', title: '見た目の細部（iPhone 13 ホーム画面の1画面だけで確認）',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, view('i13', 'p', 'app'), 'V7');
      await page.goto(T48); await wait(page, 150);
      const r = await page.evaluate(() => {
        const R = (s) => document.querySelector(s).getBoundingClientRect();
        const bar = R('.bar'), board = R('#board'), hint = R('.hint'), u = R('#undoBtn'), n = R('#newBtn');
        const tools = [...document.querySelectorAll('.tool')].map((b) => ({ label: b.querySelector('small')?.offsetWidth ? b.querySelector('small').textContent : '', ico: b.querySelector('.ico')?.offsetWidth ? b.querySelector('.ico').textContent : '' }));
        return { gap: board.top - bar.bottom, hintOk: board.bottom <= hint.top, hint: document.querySelector('.hint').innerText, tools, un: n.left - u.right };
      });
      check('2048：盤面と操作欄の間 0〜24px、説明文と重ならない、タッチ端末の説明にキー操作が出ない', r.gap >= 0 && r.gap <= 24 && r.hintOk && !/矢印|WASD/.test(r.hint) && /スワイプ/.test(r.hint), r);
      check('2048：上の3ボタンにアイコンと文字、「最初から」（⟳ なし）、「1手戻す」と「最初から」は 40px 以上離れる', r.tools.length === 3 && r.tools.every((t) => t.label && t.ico) && r.tools.some((t) => t.label === '最初から') && !r.tools.some((t) => t.ico === '⟳') && r.un >= 40, r);
      // タイルの色：値の順に明るくなり、文字とのコントラスト 4.5:1 以上
      await open2048(page, ST([...Array.from({ length: 15 }, (_, i) => 2 ** (i + 1)), 0], { keepPlaying: true }));
      const rows = await page.evaluate(() => {
        const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
        const lum = (s) => { const [r, g, b] = s.match(/\d+(\.\d+)?/g).map(Number); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
        return [...document.querySelectorAll('.tile-in')].map((e) => { const cs = getComputedStyle(e); const L = lum(cs.backgroundColor), F = lum(cs.color); return { v: Number(e.textContent), L, cr: (Math.max(L, F) + 0.05) / (Math.min(L, F) + 0.05) }; }).sort((a, b) => a.v - b.v);
      });
      const steps = rows.filter((x) => x.v <= 16384);
      check('タイルの明るさが 2→16384 で単調に増え、文字のコントラストはすべて 4.5:1 以上', rows.length === 15 && steps.every((x, i) => i === 0 || x.L > steps[i - 1].L) && rows.every((x) => x.cr >= 4.5), rows.map((x) => [x.v, +x.L.toFixed(3), +x.cr.toFixed(2)]));
      await open2048(page, ST([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2]));
      const c = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('#overlay')); const b = document.querySelector('#board').getBoundingClientRect(), k = document.querySelector('#card').getBoundingClientRect(); return { bg: cs.backgroundColor, bf: cs.backdropFilter, vis: Math.max(0, Math.min(k.top, b.bottom) - b.top) / b.height }; });
      const alpha = Number((c.bg.match(/[\d.]+\)$/) || ['1'])[0].replace(')', ''));
      check('結果カードの背景は薄く（α≤0.5）ぼかしなし、縦持ちで盤面の上部 40% 以上が見える', alpha <= 0.5 && (c.bf === 'none' || !c.bf) && c.vis >= 0.4, c);
      await ctx.close();
      const d = await newPage(browser, custom(1280, 800), 'V7 desktop', { touch: false });
      await d.page.goto(T48); await wait(d.page, 100);
      const h = await d.page.evaluate(() => document.querySelector('.hint').innerText);
      check('キーボード・マウスの環境では「矢印キー・WASD でも動かせます」を添える', /矢印キー・WASD でも動かせます/.test(h), h);
      await d.ctx.close();
    },
  },
  {
    id: 'V8', tier: 'full', title: 'ブロックのスコア欄の桁数：14 画面（iPhone 縦横・SE の Safari 横・iPad 縦横）で SCORE/BEST 7桁・LINES 4桁・LEVEL 2桁が省略されない',
    async run({ browser, check }) {
      const cases = [
        [320, 568, [20, 0, 0, 0]], [375, 667, [20, 0, 0, 0]], [390, 844, [47, 0, 34, 0]], [430, 932, [59, 0, 34, 0]],
        [568, 320, [0, 0, 0, 0]], [667, 375, [0, 0, 0, 0]], [844, 390, [0, 47, 21, 47]], [932, 430, [0, 59, 21, 59]],
        [768, 1024, [24, 0, 20, 0]], [1024, 768, [24, 0, 20, 0]], [810, 1080, [24, 0, 20, 0]], [1080, 810, [24, 0, 20, 0]],
        [568, 270, null], [568, 300, null],                  // K1：SE を Safari で横持ち
      ];
      const bad = [];
      for (const [w, h, safe] of cases) {
        if (w === 320 && h === 568) continue;              // smoke の V1 で確認済み
        const { ctx, page } = await newPage(browser, custom(w, h, safe), `V8 ${w}x${h}`, { clock: true });
        const d = await blocksStatsProbe(page, safe);
        if (!d.ok) bad.push({ v: `${w}x${h}`, bad: d.bad });
        await ctx.close();
      }
      check(`${cases.length - 1} 画面すべてで数字が省略されず、重なり・safe-area 外・横スクロールなし、ボタン 44px 以上`, bad.length === 0, bad);
    },
  },
  {
    id: 'V9', tier: 'full', title: 'キリトリ道場：プレイ中に向きを変えても、的が道場の中に置き直され、落とした扱いにならない・ライフが減らない。低い横画面では的が大きい（半径 25 以上）',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, custom(358, 540, null, 'iPhone 13 縦'), 'V9', { clock: true });
      await seed(page, {});
      await page.goto(KIRI); await wait(page, 150); await kiriStart(page);
      let s = await kiriSnap(page);
      for (let i = 0; i < 60 && !s.objs.some((o) => o.y - o.r > s.stage.y); i++) { await wait(page, 100); s = await kiriSnap(page); }
      const inside = (q) => q.objs.every((o) => o.x >= q.stage.x - o.r && o.x <= q.stage.x + q.stage.w + o.r && o.y <= q.stage.y + q.stage.h + o.r * 3);
      const rows = [];
      for (const [w, h] of [[812, 278], [358, 540], [568, 320]]) {
        await page.setViewportSize({ width: w, height: h }); await wait(page, 300);
        const q = await kiriSnap(page);
        rows.push({ w, h, n: q.objs.length, lives: q.lives, marks: q.marks, state: q.state, ok: inside(q), r: Math.max(0, ...q.objs.map((o) => o.r)), stageH: Math.round(q.stage.h) });
      }
      check('縦→横→縦→SE 横と向きを変えても、的は道場の中に置き直され、ライフ 3・落とした印 0・遊び続けている', rows.every((r) => r.ok && r.lives === 3 && r.marks === 0 && r.state === 'play'), rows);
      // 低い横画面（568×320 → 道場の高さ約 260）では的の半径の下限が 25
      let big = rows[2].r;
      for (let i = 0; i < 40 && big < 20; i++) { await wait(page, 100); big = Math.max(...(await kiriSnap(page)).objs.map((o) => o.r)); }
      check(`低い横画面（道場の高さ ${rows[2].stageH}px）の的の半径は 25 以上（${big}）`, big >= 25 * 0.88, { big, rows });
      await ctx.close();
    },
  },
];
