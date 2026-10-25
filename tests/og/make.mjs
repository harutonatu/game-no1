// OGP の絵 2 枚を作り直す（icons/og-irobin.png・icons/og-menu.png）。絵を変えたいときだけ流す。関門には入れない。
// 使い方：PORT=8794 node tests/og/make.mjs   （縮めた確認用 300px 幅の絵は SHOTS_DIR か既定の場所に書く）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, launchBrowser, PORT } from '../lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.SHOTS_DIR || '/tmp/claude-0/-home-user-game-no1/05d90edc-3e79-52f4-9c0f-1e4cb2d395a2/scratchpad/v40/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}/game-no1/`;
const MENU_ART = [7, 0, 1, 6, 8, 3]; // GAMES の番号：いろびん・ブロック・2048・ハシ・まとめて・いろコード

const srv = await startServer(ROOT);
const browser = await launchBrowser();
try {
  // 1) メニューの絵（カードの canvas を大きめの解像度で取り出す）
  const mc = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 3 });
  const mp = await mc.newPage();
  await mp.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await mp.goto(BASE, { waitUntil: 'load' });
  await mp.waitForSelector('canvas.art');
  const urls = await mp.evaluate((idx) => {
    const cv = [...document.querySelectorAll('li canvas.art')];
    return idx.map((i) => cv[i].toDataURL('image/png'));
  }, MENU_ART);
  await mc.close();

  // 2) 2 枚を撮る
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const p of ['irobin', 'menu']) {
    const page = await ctx.newPage();
    await page.goto(`${BASE}tests/og/og.html?p=${p}`, { waitUntil: 'load' });
    if (p === 'menu') await page.evaluate((u) => window.__fill(u), urls);
    await page.waitForTimeout(300);
    const out = path.join(ROOT, 'icons', `og-${p}.png`);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
    // 縮めた確認（幅 300px）
    const small = await ctx.newPage();
    const b64 = fs.readFileSync(out).toString('base64');
    await small.setViewportSize({ width: 300, height: 158 });
    await small.setContent(`<body style="margin:0"><img style="width:300px;display:block" src="data:image/png;base64,${b64}">`);
    await small.waitForTimeout(100);
    await small.screenshot({ path: path.join(SHOTS, `og-${p}-300.png`), clip: { x: 0, y: 0, width: 300, height: 158 } });
    console.log(out, fs.statSync(out).size, 'bytes');
  }
} finally {
  await browser.close();
  await srv.close();
}
