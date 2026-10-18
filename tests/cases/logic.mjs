// L: 計算ロジック・静的検査（ブラウザを使わず Node で直接確かめる＝テストピラミッドの土台）
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// games/2048/index.html の <script> を vm で実行し、window.Tile2048Logic を取り出す。
// 画面の部品に触れた時点で止まる（document は呼ばれたら例外を投げる）。公開 API だけを使うので実装の中身に依存しない。
export function load2048Logic(root) { return loadLogic(root, 'games/2048/index.html', 'Tile2048Logic'); }
// キリトリ道場の判定ロジック（window.KiritoriLogic）も同じ方法で取り出す
export function loadKiriLogic(root) { return loadLogic(root, 'games/kiritori/index.html', 'KiritoriLogic'); }
function loadLogic(root, file, name) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((c) => c.includes(name));
  if (!code) throw new Error(name + ' を含む script が見つからない');
  const STOP = new Error('__stop__');
  const document = new Proxy({}, { get() { throw STOP; } });
  const sandbox = { document, localStorage: { getItem: () => null, setItem() {} }, matchMedia: () => ({ matches: false }), crypto: globalThis.crypto, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  try { vm.runInContext(code, sandbox, { timeout: 2000 }); } catch (e) { if (e !== STOP && e.message !== '__stop__') throw e; }
  if (!sandbox[name]) throw new Error(name + ' が公開されていない');
  return sandbox[name];
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
      const pages = ['index.html', 'games/blocks/index.html', 'games/2048/index.html', 'games/kiritori/index.html', 'games/irocode/index.html'];
      const needed = ['./', './games/blocks/', './games/2048/', './games/kiritori/', './games/irocode/', './manifest.webmanifest'];
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
      const menu = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
      const games = [...menu.matchAll(/url: "([^"]+)", best: "([^"]+)", art: "([^"]+)"/g)].map((m) => m.slice(1));
      const artOk = games.every(([, , a]) => new RegExp(`\\n    ${a}\\(ctx, w, h\\)`).test(menu));
      check('メニューの GAMES：各ゲームの url が事前キャッシュにあり、ベストのキーが重ならず、絵（ART）が用意されている（キリトリ道場を含む 3 本）',
        games.length >= 3 && games.some(([u, b]) => u === 'games/kiritori/' && b === 'kiritori.best') && games.every(([u]) => files.includes('./' + u)) && new Set(games.map((g) => g[1])).size === games.length && artOk, { games, artOk });
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
      for (const f of ['games/2048/index.html', 'games/blocks/index.html', 'games/kiritori/index.html']) {
        const src = fs.readFileSync(path.join(root, f), 'utf8');
        const calls = [...src.matchAll(/showCard\(`([\s\S]*?)`/g)].map((m) => m[1]);
        check(`${f}：showCard のテンプレート ${calls.length} 箇所に \${ がない`, calls.length >= 3 && calls.every((c) => !c.includes('${')));
      }
    },
  },
  {
    id: 'L7', tier: 'smoke', node: true, title: 'キリトリ道場：線分と円の交差（同値分割＋境界値）',
    run({ check, root }) {
      const L = loadKiriLogic(root);
      const c = (ax, ay, bx, by, cx = 0, cy = 0, r = 10) => L.segCircle(ax, ay, bx, by, cx, cy, r);
      const T = [
        ['中心を横切る', c(-50, 0, 50, 0), true],
        ['斜めに横切る', c(-30, -30, 30, 30), true],
        ['かすめる：距離ちょうど r（境界）', c(-50, 10, 50, 10), true],
        ['かすめない：距離 r+0.01', c(-50, 10.01, 50, 10.01), false],
        ['線分の手前で終わる（直線なら交わる）', c(-50, 0, -10.5, 0), false],
        ['端点がちょうど円周（境界）', c(-50, 0, -10, 0), true],
        ['線分の先から始まる', c(11, 0, 60, 0), false],
        ['両端が円の中', c(-3, 1, 4, -2), true],
        ['長さ 0・円の中', c(2, 2, 2, 2), true],
        ['長さ 0・円の外', c(20, 0, 20, 0), false],
        ['遠く離れた平行線', c(-50, 40, 50, 40), false],
        ['縦に横切る（中心からずれた円）', c(100, -50, 100, 50, 105, 0, 6), true],
      ];
      const bad = T.filter(([, got, want]) => got !== want).map(([n, got]) => `${n}: ${got}`);
      check(`線分と円の交差 ${T.length} クラス（横切る・かすめる境界 r と r+0.01・手前で終わる・端点が円周・長さ 0）`, bad.length === 0, bad);
      // 速いスワイプ：1回の移動で円を飛び越えても切れる（端点だけを見る判定ではない）
      check('速いスワイプ（端点がどちらも円の外で、円を飛び越える 400px の線分）でも切れる', c(-200, 3, 200, -3) && c(-200, 200, 200, -200));
    },
  },
  {
    id: 'L8', tier: 'smoke', node: true, title: 'キリトリ道場：得点・コンボ加点・ライフ（境界値）',
    run({ check, root }) {
      const L = loadKiriLogic(root);
      const bonus = [0, 1, 2, 3, 4, 5, 6].map(L.comboBonus);
      check(`コンボ加点：0〜2 個は 0、3 個 +3、4 個 +5、5 個 +7（${bonus}）`, JSON.stringify(bonus) === JSON.stringify([0, 0, 0, 3, 5, 7, 9]), bonus);
      const pts = [1, 2, 3, 4].map(L.swipePoints);
      check(`1回のスワイプの合計点：1→1、2→2、3→6、4→9（${pts}）`, JSON.stringify(pts) === JSON.stringify([1, 2, 6, 9]), pts);
      check('不正な個数（負・小数・文字列）でコンボ加点しない', L.comboBonus(-3) === 0 && L.comboBonus(3.5) === 0 && L.comboBonus('4') === 0 && L.swipePoints(-1) === 0);
      check(`ライフは ${L.LIVES}、1つずつ減り 0 で終わり、0 より下にならない`, L.LIVES === 3 && L.loseLife(3) === 2 && L.loseLife(1) === 0 && L.loseLife(0) === 0 && L.isOver(0) && !L.isOver(1));
      check('落としてライフが減るのは 10 秒から（9.99 秒までは減らない・負や欠損も減らない側）', L.GRACE === 10 && !L.dropCostsLife(0) && !L.dropCostsLife(9.99) && L.dropCostsLife(10) && L.dropCostsLife(600) && !L.dropCostsLife(-1) && !L.dropCostsLife(undefined));
      const okB = ['0', '7', '9007199254740991'].map(L.parseBest), ngB = [null, '', 'abc', '-5', '1.5', 'Infinity', '9007199254740992', '1e400', '<b>'].map(L.parseBest);
      check('ベストの検証：0・7・2^53-1 は有効、空・文字・負・小数・∞・2^53・1e400・HTML 片は 0', JSON.stringify(okB) === JSON.stringify([0, 7, 9007199254740991]) && ngB.every((x) => x === 0), { okB, ngB });
    },
  },
  {
    id: 'L9', tier: 'smoke', node: true, title: 'キリトリ道場：軌道（上〜中央を飛ぶ・左右に出ない）、経過時間基準（60/120Hz で同じ）、難しさはゆるやかに上がる',
    run({ check, root }) {
      const L = loadKiriLogic(root);
      // 経過時間基準：1.5 秒を 60Hz・120Hz・ばらばらの間隔で進めて同じ位置
      const o0 = () => ({ x: 100, y: 600, vx: 40, vy: -900, g: 700, rot: 0, vr: 2 });
      const run = (dts) => dts.reduce((o, dt) => L.step(o, dt), o0());
      const a = run(Array(90).fill(1 / 60)), b = run(Array(180).fill(1 / 120));
      const odd = []; for (let t = 0, i = 0; t < 1.5 - 1e-9; i++) { const d = Math.min([0.007, 0.023, 0.016, 0.011][i % 4], 1.5 - t); odd.push(d); t += d; }
      const c = run(odd);
      const same = (p, q) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6 && Math.abs(p.vy - q.vy) < 1e-6 && Math.abs(p.rot - q.rot) < 1e-6;
      check('1.5 秒を 60Hz・120Hz・不規則な間隔で進めても位置・速さ・回転が同じ（誤差 1e-6 未満）', same(a, b) && same(a, c), { a, b, c });
      // 軌道：いろいろな道場の大きさ・経過時間で 300 回投げ、頂点は上〜中央（上端 12%〜45%）、左右は道場の中、滞空 1.2〜3.5 秒
      let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
      const bad = [];
      for (const [W, H] of [[288, 560], [536, 200], [536, 160], [998, 690], [700, 900]]) {
        const r = Math.round(Math.max(22, Math.min(50, Math.min(W, H) * 0.075)));
        for (const t of [0, 30, 90, 600]) for (let k = 0; k < 15; k++) {
          const o = { ...L.launch(W, H, r, rnd, L.difficulty(t)) };
          let top = o.y, minX = o.x, maxX = o.x, time = 0;
          while (!(o.vy > 0 && o.y - r > H) && time < 10) { L.step(o, 1 / 120); time += 1 / 120; top = Math.min(top, o.y); minX = Math.min(minX, o.x); maxX = Math.max(maxX, o.x); }
          if (!(top >= H * 0.12 - 1 && top <= H * 0.45 + 1 && minX >= W * 0.12 - 1 && maxX <= W * 0.88 + 1 && time >= 1.2 && time <= 3.5)) bad.push({ W, H, t, top: +(top / H).toFixed(3), minX, maxX, time: +time.toFixed(2) });
        }
      }
      check('頂点は道場の上端から 12〜45%（指で隠れにくい上〜中央）、左右は 12〜88% の中、滞空 1.2〜3.5 秒（5 画面 × 4 時点 × 15 回）', bad.length === 0, bad.slice(0, 5));
      // 難しさ：時間とともに単調（間隔・頂点までの時間は減り、数・爆弾の割合は増える）、上限・下限あり、最初の 8 秒は爆弾なし
      const ts = Array.from({ length: 121 }, (_, i) => i * 5), D = ts.map(L.difficulty);
      const mono = D.every((d, i) => i === 0 || (d.interval <= D[i - 1].interval && d.flight <= D[i - 1].flight && d.maxCount >= D[i - 1].maxCount && d.bombRate >= D[i - 1].bombRate));
      const first = L.difficulty(0), late = L.difficulty(100000);
      check('立ち上がり：1 組の最大数は 11.9 秒まで 1 個、12 秒から 2 個、30 秒から 3 個', L.difficulty(11.9).maxCount === 1 && L.difficulty(12).maxCount === 2 && L.difficulty(29.9).maxCount === 2 && L.difficulty(30).maxCount === 3);
      check('難しさは単調にゆるやかに上がり、上限で止まる（間隔 ≥0.8 秒・最大 4 個・爆弾 ≤20%・頂点まで ≥0.85 秒）、7.9 秒までは爆弾なし',
        mono && first.maxCount === 1 && first.bombRate === 0 && L.difficulty(7.9).bombRate === 0 && L.difficulty(8).bombRate > 0 && late.interval >= 0.8 && late.maxCount === 4 && late.bombRate <= 0.2 && late.flight >= 0.85, { first, late });
    },
  },
];
