// L: 計算ロジック・静的検査（ブラウザを使わず Node で直接確かめる＝テストピラミッドの土台）
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// games/2048/index.html の <script> を vm で実行し、window.Tile2048Logic を取り出す。
// 画面の部品に触れた時点で止まる（document は呼ばれたら例外を投げる）。公開 API だけを使うので実装の中身に依存しない。
export function load2048Logic(root) {
  const html = fs.readFileSync(path.join(root, 'games/2048/index.html'), 'utf8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((c) => c.includes('Tile2048Logic'));
  if (!code) throw new Error('Tile2048Logic を含む script が見つからない');
  const STOP = new Error('__stop__');
  const document = new Proxy({}, { get() { throw STOP; } });
  const sandbox = { document, localStorage: { getItem: () => null, setItem() {} }, matchMedia: () => ({ matches: false }), crypto: globalThis.crypto, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  try { vm.runInContext(code, sandbox, { timeout: 2000 }); } catch (e) { if (e !== STOP && e.message !== '__stop__') throw e; }
  if (!sandbox.Tile2048Logic) throw new Error('Tile2048Logic が公開されていない');
  return sandbox.Tile2048Logic;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const G = (s) => s.trim().split(/\s+/).map(Number);

export const tests = [
  {
    id: 'L1', tier: 'smoke', node: true, title: '2048 合体ロジック（1行・4方向・1手1回合体・無効手）',
    run({ check, root }) {
      const L = load2048Logic(root);
      const s = (a) => { const x = L.slideLine(a); return { out: [...x.out], gained: x.gained, moved: x.moved }; };
      // 同値クラス：全部同値／一部合体／合体後の同値（連鎖しない）／間に空き／合体なし／寄せるだけ／3連
      const T = [
        [[2, 2, 2, 2], [4, 4, 0, 0], 8, true], [[2, 2, 4, 0], [4, 4, 0, 0], 4, true], [[4, 4, 8, 0], [8, 8, 0, 0], 8, true],
        [[2, 0, 2, 2], [4, 2, 0, 0], 4, true], [[2, 4, 8, 16], [2, 4, 8, 16], 0, false], [[0, 0, 0, 2], [2, 0, 0, 0], 0, true],
        [[8, 8, 8, 0], [16, 8, 0, 0], 16, true], [[0, 0, 0, 0], [0, 0, 0, 0], 0, false],
      ];
      const bad = T.filter(([i, o, g, m]) => !eq(s(i), { out: o, gained: g, moved: m }));
      check('slideLine の8クラスが期待どおり', bad.length === 0, bad.map(([i]) => ({ in: i, got: s(i) })));
      const r = L.computeMove(G('2 2 0 0  0 0 0 0  0 0 0 0  0 0 0 0'), 'right');
      const u = L.computeMove(G('0 0 0 0  2 0 0 0  0 0 0 0  2 0 0 0'), 'up');
      const d = L.computeMove(G('4 0 0 0  4 0 0 0  8 0 0 0  0 0 0 0'), 'down');
      const l = L.computeMove(G('0 0 2 2  0 0 0 0  0 0 0 0  0 0 0 0'), 'left');
      check('右・上・下・左の移動と得点', eq([...r.grid.slice(0, 4)], [0, 0, 0, 4]) && r.gained === 4 && eq([u.grid[0], u.grid[4], u.grid[12]], [4, 0, 0])
        && eq([d.grid[0], d.grid[4], d.grid[8], d.grid[12]], [0, 0, 8, 8]) && eq([...l.grid.slice(0, 4)], [4, 0, 0, 0]), { r: r.grid, u: u.grid, d: d.grid, l: l.grid });
      check('computeMove は元の盤面を書き換えない', (() => { const g = G('2 2 0 0  0 0 0 0  0 0 0 0  0 0 0 0'); L.computeMove(g, 'left'); return g[0] === 2 && g[1] === 2; })());
    },
  },
  {
    id: 'L2', tier: 'smoke', node: true, title: '2048 ゲームオーバー判定・クリア判定（境界）',
    run({ check, root }) {
      const L = load2048Logic(root);
      const over = G('2 4 2 4  4 2 4 2  2 4 2 4  4 2 4 2');
      check('詰み盤面：canMove=false かつ4方向とも動かない', L.canMove(over) === false && ['left', 'right', 'up', 'down'].every((x) => !L.computeMove(over, x).moved));
      check('右下だけ横に同値／空き1つ／最下段だけ縦に同値 → まだ動ける（境界の1マス）',
        L.canMove(G('2 4 2 4  4 2 4 2  2 4 2 4  4 2 4 4')) && L.canMove(G('2 4 2 4  4 2 4 2  2 4 2 4  4 2 4 0')) && L.canMove(G('2 4 2 4  4 2 4 2  2 4 2 4  2 8 16 32')));
      check('hasWon：1024 では false、2048 ちょうどで true、4096 でも true',
        !L.hasWon(G('1024 1024 0 0  0 0 0 0  0 0 0 0  0 0 0 0')) && L.hasWon(L.computeMove(G('1024 1024 0 0  0 0 0 0  0 0 0 0  0 0 0 0'), 'left').grid) && L.hasWon(G('4096 0 0 0  0 0 0 0  0 0 0 0  0 0 0 0')));
      const a = L.reachInfo(G('256 256 2 0  0 0 0 0  0 0 0 0  0 0 0 0')), b = L.reachInfo(G('256 128 2 0  0 0 0 0  0 0 0 0  0 0 0 0'));
      check('reachInfo：最大が2枚なら「あと1回の合体」、1枚なら「次は」', a.top === 256 && a.next === 512 && a.oneMerge && b.next === 512 && !b.oneMerge, { a, b });
    },
  },
  {
    id: 'L3', tier: 'smoke', node: true, title: '出目固定の乱数（同じ種→同じ出目、種が違えば変わる）',
    run({ check, root }) {
      const L = load2048Logic(root);
      const seq = (s, n = 8) => { const r = L.seededRandom(s); return Array.from({ length: n }, () => r()); };
      check('同じ種なら同じ列（決定的）', eq(seq(987654321), seq(987654321)));
      check('値は [0,1) に入る（種の境界 0 と 2^32-1 を含む）', [0, 1, 0xFFFFFFFF, 123].every((s) => seq(s, 200).every((x) => x >= 0 && x < 1)));
      const firsts = new Set([1, 2, 3, 4, 5, 6].map((s) => seq(s, 1)[0].toFixed(6)));
      check('種が違えば列が変わる（6つの種で6通り）', firsts.size === 6, [...firsts]);
      const r = L.seededRandom(42); const s0 = r.seed(); r(); const s1 = r.seed();
      check('1回引くごとに種が進み、32bit の整数に収まる', s0 !== s1 && Number.isInteger(s1) && s1 >= 0 && s1 <= 0xFFFFFFFF, { s0, s1 });
    },
  },
  {
    id: 'L4', tier: 'smoke', node: true, title: '保存データの盤面検証 validGrid（同値分割＋境界値）',
    run({ check, root }) {
      const L = load2048Logic(root);
      const base = (v) => [v, ...Array(15).fill(0)];
      const ok = [0, 2, 4, 2 ** 20];                        // 有効：空き・最小・最大(2^20)
      const ng = [1, 3, -2, 2 ** 21, 3 * 2 ** 32, '2', null, 2.5, Infinity, NaN];   // 無効：1・2のべきでない・負・上限超え(2^21)・型違い
      const okBad = ok.filter((v) => !L.validGrid(base(v)));
      const ngBad = ng.filter((v) => L.validGrid(base(v)));
      check('有効値（0, 2, 4, 2^20）を受け入れる', okBad.length === 0, okBad);
      check('無効値（1, 3, -2, 2^21, 3·2^32, "2", null, 2.5, ∞, NaN）を拒否', ngBad.length === 0, ngBad.map(String));
      check('長さ 15 / 17・配列でないものを拒否', !L.validGrid(Array(15).fill(0)) && !L.validGrid(Array(17).fill(0)) && !L.validGrid('hello') && !L.validGrid({ length: 16 }));
    },
  },
  {
    id: 'L5', tier: 'smoke', node: true, title: 'オフライン用ファイル一覧・manifest・Service Worker の静的検査',
    run({ check, root }) {
      const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
      const ver = (sw.match(/CACHE_VERSION\s*=\s*["']([^"']+)["']/) || [])[1];
      check('sw.js に CACHE_VERSION がある（値は決め打ちしない）', !!ver, ver);
      const files = [...(sw.match(/APP_FILES\s*=\s*\[([\s\S]*?)\]/) || [, ''])[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
      const missing = files.filter((f) => { const p = path.join(root, f); return !(fs.existsSync(p) && (fs.statSync(p).isFile() || fs.existsSync(path.join(p, 'index.html')))); });
      check(`事前キャッシュする ${files.length} ファイルがすべて存在（1つでも欠けると install が失敗しオフライン不可）`, files.length >= 8 && missing.length === 0, missing);
      const pages = ['index.html', 'games/blocks/index.html', 'games/2048/index.html'];
      const needed = ['./', './games/blocks/', './games/2048/', './manifest.webmanifest'];
      check('メニュー・各ゲーム・manifest が事前キャッシュに含まれる', needed.every((n) => files.includes(n)), files);
      const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
      const icons = (m.icons || []).map((i) => i.src);
      check('manifest：name/short_name=ゆびあそび、start_url・scope が相対（サブパス配信で壊れない）、アイコンが存在',
        m.name === 'ゆびあそび' && m.short_name === 'ゆびあそび' && /^\.\/?$/.test(m.start_url) && /^\.\/?$/.test(m.scope) && icons.length >= 2 && icons.every((s) => fs.existsSync(path.join(root, s))), { m });
      const bad = [];
      for (const p of pages) {
        const h = fs.readFileSync(path.join(root, p), 'utf8');
        const pre = p.includes('/') ? '../../' : '';
        if (!h.includes(`rel="manifest" href="${pre}manifest.webmanifest"`)) bad.push(p + ' manifest');
        if (!h.includes(`rel="apple-touch-icon" href="${pre}icons/apple-touch-icon.png"`)) bad.push(p + ' icon');
        if (!/name="apple-mobile-web-app-title" content="ゆびあそび"/.test(h)) bad.push(p + ' title');
        if (!/viewport-fit=cover/.test(h)) bad.push(p + ' viewport-fit');
        if (/href="\//.test(h) || /src="\//.test(h)) bad.push(p + ' 絶対パス参照');
      }
      check('全ページが同じ manifest・アイコン・ホーム画面名を相対パスで参照（/ 始まりの参照なし）', bad.length === 0, bad);
      // ページが読む同じサイト内のファイル（script src・img src・link href）がすべて事前キャッシュにある（ないとオフラインで欠ける）
      const notCached = [];
      for (const p of pages) {
        const h = fs.readFileSync(path.join(root, p), 'utf8');
        const refs = [...h.matchAll(/<(?:script|img)\b[^>]*\bsrc="([^"]+)"|<link\b[^>]*\bhref="([^"]+)"/g)].map((m) => m[1] || m[2]).filter((u) => !/^(https?:|data:|#)/.test(u));
        for (const u of refs) {
          const rel = './' + path.posix.normalize(path.posix.join(path.posix.dirname(p), u));
          if (!files.includes(rel)) notCached.push(`${p} → ${u}`);
        }
      }
      check('各ページが読むサイト内のファイル（効果音 common/sfx.js・アイコン・manifest など）がすべて事前キャッシュに含まれる', notCached.length === 0, notCached);
    },
  },
  {
    id: 'L6', tier: 'full', node: true, title: 'カードの HTML に値を埋め込まない（保存データ経由の XSS 防止）',
    run({ check, root }) {
      for (const f of ['games/2048/index.html', 'games/blocks/index.html']) {
        const src = fs.readFileSync(path.join(root, f), 'utf8');
        const calls = [...src.matchAll(/showCard\(`([\s\S]*?)`/g)].map((m) => m[1]);
        check(`${f}：showCard のテンプレート ${calls.length} 箇所に \${ がない`, calls.length >= 3 && calls.every((c) => !c.includes('${')));
      }
    },
  },
];
