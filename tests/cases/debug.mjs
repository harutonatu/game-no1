// DG: デバッグ表示（common/debug.js、?debug=1）。
// ふだん（無効）は何もしないこと・有効にするとエラーが数えられて見えること・命令（info・layout・state など）の形・
// オーバーレイがゲームのボタンをふさがないこと・オフラインでも読めること、を確かめる。
// わざと起こすエラーには印 DGTEST を付け、X1（コンソールエラー 0）の集計から外す（このテストのページだけ）。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, GAME_URLS, custom, newPage, seed, sleep, wait, swInfo } from '../lib.mjs';

const PAGES = ['', ...GAME_URLS];                       // メニューと全ゲーム（GAMES から読む）
const MARK = 'DGTEST';
const V = () => custom(320, 568, null, 'SE 縦');

// わざと起こしたエラー（印 DGTEST 付き）だけは X1 の集計に入れない
function allowMarked(page, errors, label) {
  page.removeAllListeners('console'); page.removeAllListeners('pageerror');
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes(MARK)) errors.push(`${label}: [console] ${m.text()}`); });
  page.on('pageerror', (e) => { if (!String(e.message).includes(MARK)) errors.push(`${label}: [pageerror] ${e.message}`); });
}
// オーバーレイのボタン（Shadow DOM の中）
const bugBox = (page) => page.evaluate(() => {
  const h = document.getElementById('yubi-debug');
  const b = h && h.shadowRoot && h.shadowRoot.querySelector('.bug');
  if (!b || b.hidden) return null;
  const r = b.getBoundingClientRect();
  return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, text: b.textContent, label: b.getAttribute('aria-label') };
});
const panelText = (page) => page.evaluate(() => { const p = document.getElementById('yubi-debug')?.shadowRoot?.querySelector('.panel'); return p && !p.hidden ? p.textContent : null; });
const shadowClick = (page, key) => page.evaluate((k) => document.getElementById('yubi-debug').shadowRoot.querySelector(`[data-debug="${k}"]`).click(), key);

export const tests = [
  {
    id: 'DG1', tier: 'smoke', node: true, title: 'デバッグ表示：静的検査（全ページが <head> で common/debug.js を本体より前に読む・事前キャッシュにある・文字列を eval しない）',
    run({ check, root }) {
      const bad = [];
      for (const u of PAGES) {
        const f = path.join(root, u, 'index.html');
        const h = fs.readFileSync(f, 'utf8');
        const pre = u ? '../../' : '';
        const at = h.indexOf(`<script src="${pre}common/debug.js"></script>`);
        const head = h.indexOf('</head>');
        const firstOther = h.search(/<script(?![^>]*common\/debug\.js)[\s>]/);
        if (!(at > 0 && at < head && (firstOther < 0 || at < firstOther))) bad.push({ u: u || 'メニュー', at, head, firstOther });
      }
      check(`メニューと全 ${GAME_URLS.length} ゲームが <head> の中で、ほかのスクリプトより前に common/debug.js を読む（早いエラーも拾う）`, bad.length === 0, bad);
      const { files } = swInfo(root);
      check('common/debug.js が事前キャッシュ（sw.js の APP_FILES）にある（オフラインでも読める）', files.includes('./common/debug.js'), files);
      const src = fs.readFileSync(path.join(root, 'common/debug.js'), 'utf8').replace(/\/\/.*$/gm, '');
      check('debug.js に eval・new Function・文字列の setTimeout がない（命令は登録済みの関数だけを呼ぶ）', !/\beval\s*\(|new\s+Function\s*\(|setTimeout\(\s*["'`]/.test(src));
    },
  },
  {
    id: 'DG2', tier: 'smoke', title: 'デバッグ表示：無効のとき（?debug なし）は全ページで DOM に何も足さず、console も置き換えない',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'DG2', { clock: true });
      const got = [];
      for (const u of PAGES) {
        const loaded = [];
        const on = (r) => { if (r.url().endsWith('/common/debug.js')) loaded.push(r.status()); };
        page.on('response', on);
        await page.goto(BASE + u); await wait(page, 300);
        page.off('response', on);
        got.push(await page.evaluate(() => ({
          host: !!document.getElementById('yubi-debug'),
          api: typeof window.YubiDebug,
          kids: [...document.documentElement.children].map((e) => e.tagName).join(','),
          shadow: [...document.querySelectorAll('*')].filter((e) => e.shadowRoot).length,
          native: ['error', 'warn', 'log', 'info'].every((m) => /\[native code\]/.test(Function.prototype.toString.call(console[m]))),
          ss: sessionStorage.getItem('yubi.debug'),
        })).then((r) => ({ u: u || 'メニュー', loaded: loaded.join(), ...r })));
      }
      check('全ページで common/debug.js は読み込まれている（200）', got.every((g) => g.loaded === '200'), got);
      check('無効のとき：オーバーレイの要素・Shadow DOM がなく、<html> の子は HEAD と BODY だけ、window.YubiDebug もない', got.every((g) => !g.host && g.api === 'undefined' && g.kids === 'HEAD,BODY' && g.shadow === 0), got);
      check('無効のとき：console.error・warn・log・info はブラウザの元のまま（置き換えていない）、sessionStorage にも書かない', got.every((g) => g.native && g.ss === null), got);
      await ctx.close();
    },
  },
  {
    id: 'DG3', tier: 'smoke', title: 'デバッグ表示：?debug=1 でボタンが出て、わざと起こしたエラーが件数とパネルに出る・メニュー→ゲームでも有効のまま・?debug=0 と「デバッグを終わる」で消える',
    async run({ browser, check, errors }) {
      const { ctx, page } = await newPage(browser, V(), 'DG3');
      allowMarked(page, errors, 'DG3');
      await seed(page, {});
      await page.goto(BASE + '?debug=1'); await sleep(300);
      let b = await bugBox(page);
      check('?debug=1：メニューに「🐞 0」のボタン（44×44 以上）が出る', b && b.text === '🐞 0' && b.w >= 44 && b.h >= 44, b);
      await page.evaluate((m) => {
        setTimeout(() => { throw new Error(m + ' わざとの例外'); }, 0);
        Promise.reject(new Error(m + ' わざとの Promise の失敗'));
        console.error(m + ' わざとの console.error');
        console.warn(m + ' 注意');
        console.log(m + ' ふつうのログ', { a: 1 });
      }, MARK);
      await sleep(300);
      b = await bugBox(page);
      check('例外・Promise の失敗・console.error の 3 件が数えられる（warn・log は数えない）', b && b.text === '🐞 3' && /3 件/.test(b.label), b);
      const native = await page.evaluate(() => /\[native code\]/.test(Function.prototype.toString.call(console.log)));
      check('有効のとき console.log は記録用に包まれている（元の動作は保つ）', !native);
      await page.evaluate(() => document.getElementById('yubi-debug').shadowRoot.querySelector('.bug').click());
      const t = await panelText(page);
      check('ボタンを押すとパネルが開き、3 種のエラーと warn・log の文が見える', t && ['わざとの例外', 'わざとの Promise の失敗', 'わざとの console.error', '注意', 'ふつうのログ {"a":1}'].every((s) => t.includes(s)) && /エラー 3 件/.test(t), t && t.slice(0, 600));
      await page.waitForFunction(() => /"userAgent"/.test(document.getElementById('yubi-debug').shadowRoot.querySelector('.info').textContent), null, { timeout: 5000 }).catch(() => {});
      const info = await page.evaluate(() => document.getElementById('yubi-debug').shadowRoot.querySelector('.info').textContent);
      check('パネルに環境（info：userAgent・safeArea・版）が出る', /"userAgent"/.test(info) && /"safeArea"/.test(info) && /"version": "v\d+"/.test(info), info.slice(0, 300));
      const rep = await page.evaluate(() => window.YubiDebug.run('report'));
      check('「コピー」で渡す文字（report）に、ページ・版・エラー件数・ログ・環境が入っている', rep.ok && /ゆびあそび デバッグ報告/.test(rep.result) && /エラー: 3 件/.test(rep.result) && rep.result.includes('わざとの例外') && /"userAgent"/.test(rep.result), rep.ok ? rep.result.slice(0, 300) : rep);
      await shadowClick(page, 'close');
      b = await bugBox(page);
      check('「閉じる」でパネルが閉じ、ボタンに戻る', b && (await panelText(page)) === null, b);
      // メニュー → ゲーム（URL に ?debug を付けない移動）でも有効のまま。ゲームでは件数は 0 から
      await page.locator('a.game').nth(0).click(); await page.waitForURL(BASE + GAME_URLS[0]); await sleep(300);
      b = await bugBox(page);
      check(`メニューのカードからゲーム（${GAME_URLS[0]}）へ移っても有効のまま（sessionStorage で覚える）`, b && b.text === '🐞 0' && (await page.evaluate(() => typeof window.YubiDebug)) === 'object', b);
      // ?debug=0 で解除
      await page.goto(BASE + GAME_URLS[1] + '?debug=0'); await sleep(200);
      const off = await page.evaluate(() => ({ host: !!document.getElementById('yubi-debug'), api: typeof window.YubiDebug, ss: sessionStorage.getItem('yubi.debug') }));
      await page.goto(BASE); await sleep(200);
      const off2 = await page.evaluate(() => !!document.getElementById('yubi-debug'));
      check('?debug=0 で消え、そのあとメニューへ戻っても出ない', !off.host && off.api === 'undefined' && off.ss === null && !off2, { off, off2 });
      // 「デバッグを終わる」：console が元に戻り、表示も窓口も消え、URL から debug=1 が外れる
      await page.goto(BASE + GAME_URLS[2] + '?debug=1'); await sleep(300);
      await page.evaluate(() => document.getElementById('yubi-debug').shadowRoot.querySelector('.bug').click());
      await shadowClick(page, 'stop'); await sleep(100);
      const st = await page.evaluate(() => ({ host: !!document.getElementById('yubi-debug'), api: typeof window.YubiDebug, ss: sessionStorage.getItem('yubi.debug'), native: ['error', 'warn', 'log', 'info'].every((m) => /\[native code\]/.test(Function.prototype.toString.call(console[m]))), search: location.search }));
      check('「デバッグを終わる」で表示・window.YubiDebug が消え、console が元に戻り、URL から debug=1 が外れる', !st.host && st.api === 'undefined' && st.ss === null && st.native && st.search === '', st);
      await ctx.close();
    },
  },
  {
    id: 'DG4', tier: 'smoke', title: 'デバッグ表示：命令（help・info・layout・state・storage・tap・logs）が決まった形を返し、ない命令・悪い引数は安全にエラーを返す',
    async run({ browser, check }) {
      const { ctx, page } = await newPage(browser, V(), 'DG4');
      await seed(page, { 'irobin.help': '1' });
      await page.goto(BASE + 'games/irobin/?debug=1'); await sleep(400);
      const r = await page.evaluate(async () => {
        const D = window.YubiDebug, run = (n, a) => D.run(n, a);
        return {
          help: await run('help'),
          info: await run('info'),
          layout: await run('layout', { selector: 'a#back, #helpBtn' }),
          layoutStr: await run('layout', '#helpBtn'),
          state: await run('state'),
          unknown: await run('nosuch'),
          proto: await run('__proto__'),
          badSel: await run('layout', { selector: '###' }),
          badTap: await run('tap', {}),
          set: await run('storage', { op: 'set', key: 'dg.test', value: { n: 1 } }),
          get: await run('storage', { op: 'get', key: 'dg.test' }),
          rm: await run('storage', { op: 'remove', key: 'dg.test' }),
          logs: await run('logs'),
        };
      });
      const names = (r.help.result || []).map((c) => c.name);
      check('help：命令の一覧に info・layout・state・tap・storage・logs・report がある', r.help.ok && ['info', 'layout', 'state', 'tap', 'storage', 'logs', 'report'].every((n) => names.includes(n)), names);
      const i = r.info.result || {};
      check('info：UA・画面と visualViewport・devicePixelRatio・safeArea・ホーム画面アプリか・Service Worker・版・localStorage のキー一覧', r.info.ok && typeof i.userAgent === 'string' && i.window.innerWidth === 320 && i.visualViewport && i.visualViewport.w > 0 && i.devicePixelRatio === 2 && ['top', 'right', 'bottom', 'left'].every((k) => typeof i.safeArea[k] === 'number') && typeof i.standalone === 'boolean' && i.serviceWorker && typeof i.serviceWorker.supported === 'boolean' && /^v\d+$/.test(i.appVersion && i.appVersion.version) && Array.isArray(i.localStorage) && i.localStorage.some((k) => k.key === 'irobin.help'), i);
      const L = r.layout.result || {};
      const it = (L.items || []).find((x) => /helpBtn/.test(x.el));
      check('layout：セレクタの要素の位置・大きさ・文字の大きさ・画面外・重なり・44px 未満を返す', r.layout.ok && L.count === 2 && it && it.w >= 44 && it.h >= 44 && it.under44 === false && it.offscreen === false && Array.isArray(it.overlaps) && typeof it.fontSize === 'number' && L.viewport.w === 320, L);
      check('layout：引数はセレクタの文字列でもよい', r.layoutStr.ok && r.layoutStr.result.count === 1, r.layoutStr);
      const g = (r.state.result && r.state.result.games) || [];
      check('state：いろびんの窓口 window.IrobinGame の getState() を読む（phase・level がある）', r.state.ok && g.length === 1 && g[0].name === 'IrobinGame' && g[0].via === 'getState' && typeof g[0].state.phase === 'string' && typeof g[0].state.level === 'number', g);
      check('ない命令（nosuch・__proto__）は ok:false とエラー文・命令の一覧を返す（例外にしない）', !r.unknown.ok && /ない/.test(r.unknown.error) && Array.isArray(r.unknown.commands) && !r.proto.ok, { u: r.unknown, p: r.proto });
      check('悪い引数（正しくないセレクタ・座標なしの tap）も ok:false で返す', !r.badSel.ok && /セレクタ/.test(r.badSel.error) && !r.badTap.ok, { s: r.badSel, t: r.badTap });
      check('storage：set・get・remove が往復できる', r.set.ok && r.get.ok && r.get.result.value === '{"n":1}' && r.rm.ok, { set: r.set, get: r.get });
      check('logs：エラー件数とログの配列を返す（命令の結果は JSON にできる形）', r.logs.ok && typeof r.logs.result.errors === 'number' && Array.isArray(r.logs.result.entries) && JSON.stringify(r) !== undefined);
      // tap：要素の中心へ合成のポインタイベントを送る（人の操作扱いではない＝trusted:false）
      const tp = await page.evaluate(async () => {
        const seen = [];
        const b = document.createElement('button'); b.textContent = 'DG'; b.style.cssText = 'position:fixed;left:100px;top:300px;width:80px;height:50px;z-index:5';
        ['pointerdown', 'pointerup', 'click'].forEach((t) => b.addEventListener(t, (e) => seen.push(t + ':' + e.isTrusted)));
        document.body.appendChild(b);
        const r1 = await window.YubiDebug.run('tap', { x: 140, y: 325 });
        const r2 = await window.YubiDebug.run('tap', { selector: 'button', index: [...document.querySelectorAll('button')].indexOf(b) });
        b.remove();
        return { r1, r2, seen };
      });
      check('tap：座標・要素のどちらでも pointerdown→pointerup→click が届く（isTrusted は false と明示）', tp.r1.ok && tp.r2.ok && tp.r1.result.trusted === false && tp.seen.join() === 'pointerdown:false,pointerup:false,click:false,pointerdown:false,pointerup:false,click:false', tp);
      await ctx.close();
    },
  },
  {
    id: 'DG5', tier: 'full', title: 'デバッグ表示：オーバーレイのボタンが全ページ（最初の画面・遊び方・プレイ中）でゲームの押せる要素に重ならない・画面内・44px（SE 縦横）、パネルの文字 12px 以上・ボタン 44px・ダブルタップ拡大を抑止',
    async run({ browser, check }) {
      const START = '#card [data-cmd=restart], .setup [data-action=start], [data-cmd=restart]:not(#restartBtn), #startBtn, [data-action=start]';
      const click = async (page, sel) => { const ok = await page.evaluate((q) => { const e = [...document.querySelectorAll(q)].find((x) => x.checkVisibility()); if (e) e.click(); return !!e; }, sel); await wait(page, 1200); return ok; };
      const probe = (page) => page.evaluate(() => {
        const h = document.getElementById('yubi-debug');
        const b = h.shadowRoot.querySelector('.bug').getBoundingClientRect();
        const hit = [...document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [data-cmd], [data-action]')]
          .filter((e) => e.checkVisibility() && getComputedStyle(e).pointerEvents !== 'none')
          .map((e) => ({ e, r: e.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && b.left < r.right && r.left < b.right && b.top < r.bottom && r.top < b.bottom)
          .map(({ e, r }) => `${e.id || e.className || e.tagName}[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}]`);
        const inside = b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight;
        return { at: [Math.round(b.left), Math.round(b.top)], size: [b.width, b.height], hit, inside, big: b.width >= 44 && b.height >= 44 };
      });
      for (const v of [custom(320, 568, null, 'SE 縦'), custom(568, 320, null, 'SE 横')]) {
        const bad = [], seen = [];
        for (const u of PAGES) {
          const { ctx, page } = await newPage(browser, v, `DG5 ${v.label} ${u}`, { clock: true });
          await seed(page, {});
          await page.goto(BASE + u + '?debug=1'); await wait(page, 1200);
          const st = [['最初の画面', await probe(page)]];
          if (await click(page, START)) { await click(page, START); st.push(['プレイ中', await probe(page)]); }
          for (const [k, p] of st) { seen.push(`${u || 'メニュー'} ${k}@${p.at}`); if (p.hit.length || !p.inside || !p.big) bad.push({ page: u || 'メニュー', k, ...p }); }
          await ctx.close();
        }
        check(`${v.label}：メニューと全 ${GAME_URLS.length} ゲームで、閉じた状態のボタンは 44×44 以上・画面内・押せる要素と重ならない（${seen.length} 画面）`, bad.length === 0 && seen.length >= PAGES.length, bad.length ? bad : seen);
      }
      // パネルを開いた状態（いろびん・SE 縦）：文字 12px 以上・ボタン 44px 以上・画面内・ダブルタップ拡大の抑止（touch-action）
      const { ctx, page } = await newPage(browser, V(), 'DG5 panel', { clock: true });
      await seed(page, {});
      await page.goto(BASE + 'games/irobin/?debug=1'); await wait(page, 600);
      await page.evaluate(() => console.log('DG5 ログ'));
      await page.evaluate(() => document.getElementById('yubi-debug').shadowRoot.querySelector('.bug').click()); await wait(page, 300);
      const p = await page.evaluate(() => {
        const R = document.getElementById('yubi-debug').shadowRoot;
        const small = [];
        const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3 && c.nodeValue.trim()) { const fs = parseFloat(getComputedStyle(c.parentElement).fontSize); if (fs < 12) small.push(`${c.parentElement.className} ${fs}`); } else if (c.nodeType === 1) walk(c); } };
        walk(R.querySelector('.panel'));
        const btns = [...R.querySelectorAll('.panel button')].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent, w: r.width, h: r.height, in: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, ta: getComputedStyle(b).touchAction }; });
        const bug = getComputedStyle(R.querySelector('.bug')).touchAction;
        const body = getComputedStyle(R.querySelector('.body')).touchAction;
        const pr = R.querySelector('.panel').getBoundingClientRect();
        return { small, btns, bug, body, panel: [pr.left, pr.top, pr.right, pr.bottom], vw: innerWidth, vh: innerHeight };
      });
      check('パネルの文字はすべて 12px 以上', p.small.length === 0, p.small);
      check('パネルのボタン（コピー・閉じる・デバッグを終わる）は 44px 以上で画面内', p.btns.length === 3 && p.btns.every((b) => b.w >= 44 && b.h >= 44 && b.in), p.btns);
      check('ダブルタップ拡大の抑止：ボタンは touch-action: manipulation、ログ欄は pan-x pan-y（拡大なし）', p.bug === 'manipulation' && p.btns.every((b) => b.ta === 'manipulation') && p.body === 'pan-x pan-y', p);
      check('パネルは画面の中（左右上下 8px 以上あける）', p.panel[0] >= 8 && p.panel[1] >= 8 && p.panel[2] <= p.vw - 8 && p.panel[3] <= p.vh - 8, p.panel);
      await ctx.close();
    },
  },
  {
    id: 'DG6', tier: 'full', title: 'デバッグ表示：オフラインでも common/debug.js がキャッシュから読まれ、?debug=1 のボタンが出る',
    async run({ browser, check, srv, root }) {
      const { ctx, page } = await newPage(browser, custom(390, 844, null, 'iPhone 13'), 'DG6', { sw: true });
      await page.goto(BASE);
      const ok = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]));
      if (!ok) throw new Error('Service Worker が 8 秒以内に有効にならない');
      if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }); }
      // Service Worker が直前のページの読み込み（キャッシュとの比較）を終えてからオフラインにする。
      // 途中で接続を切ると、Linux 版 WebKit は「internal error」で Service Worker ごと止まることがある（S1・S8 と同じ待ち方）
      await page.waitForLoadState('networkidle').catch(() => {}); await sleep(300);
      await srv.ctl('offline=1');
      const resp = [];
      page.on('response', (r) => { if (r.url().endsWith('/common/debug.js')) resp.push({ status: r.status(), sw: r.fromServiceWorker() }); });
      const res = [];
      for (const u of ['', 'games/irobin/']) {
        await page.goto(BASE + u + '?debug=1', { timeout: 10000 }); await sleep(400);
        res.push({ u: u || 'メニュー', api: await page.evaluate(() => typeof window.YubiDebug), bug: await bugBox(page) });
      }
      const sw = await page.evaluate(() => window.YubiDebug.run('info')).then((r) => r.result && r.result.serviceWorker);
      await srv.ctl('offline=0');
      check('オフライン：メニューといろびんで debug.js が Service Worker（キャッシュ）から 200 で読まれ、ボタンが出る', resp.length === 2 && resp.every((r) => r.sw && r.status === 200) && res.every((r) => r.api === 'object' && r.bug), { resp, res });
      check('info の Service Worker 欄：制御中・キャッシュの版が sw.js の CACHE_VERSION と同じ', sw && sw.controlled === true && sw.cacheVersion === swInfo(root).ver, sw);
      await ctx.close();
    },
  },
];
