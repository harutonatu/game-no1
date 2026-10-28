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
      const pages = ['index.html', 'games/blocks/index.html', 'games/2048/index.html', 'games/kiritori/index.html', 'games/irocode/index.html', 'games/zenmai/index.html', 'games/irobin/index.html', 'games/matomete/index.html', 'games/michibiki/index.html', 'games/seizai/index.html', 'games/asteroid/index.html'];
      const needed = ['./', './games/blocks/', './games/2048/', './games/kiritori/', './games/irocode/', './games/zenmai/', './games/irobin/', './games/matomete/', './games/michibiki/', './games/seizai/', './games/asteroid/', './manifest.webmanifest'];
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
      // best（数値のキー）・stats（いろコードの JSON）・bestText（ゼンマイの関数。キー名は zenmai.progress）のどれでもよい
      // bestText の関数は、中の最初の getItem("…") か readBest("…")（ミチビキ空港の michibikiBest）を保存キーとして読む
      const games = [...menu.matchAll(/url: "([^"]+)", (?:best|stats): "([^"]+)", art: "([^"]+)"|url: "([^"]+)", bestText: \(\) => (\w+)\(\), art: "([^"]+)"/g)]
        .map((m) => m[1] ? [m[1], m[2], m[3]] : [m[4], (menu.match(new RegExp(`function ${m[5]}\\(\\)[\\s\\S]*?(?:getItem|readBest)\\("([^"]+)"\\)`)) || [])[1] || m[5], m[6]]);
      const gamesTotal = (menu.slice(menu.indexOf('const GAMES = ['), menu.indexOf('];', menu.indexOf('const GAMES = ['))).match(/url: "/g) || []).length;
      const artOk = games.every(([, , a]) => new RegExp(`\\n    ${a}\\(ctx, w, h\\)`).test(menu));
      check(`メニューの GAMES（${games.length} 本）：各ゲームの url が事前キャッシュにあり、ベストのキーが重ならず、絵（ART）が用意されている（キリトリ道場・いろコード・ゼンマイさんぽ・ミチビキ空港（readBest）・もくもくこうばを含む 5 本以上）`,
        games.length >= 5 && games.length === gamesTotal && games.some(([u, b]) => u === 'games/kiritori/' && b === 'kiritori.best') && games.some(([u, b]) => u === 'games/irocode/' && b === 'irocode.stats') && games.some(([u, b]) => u === 'games/zenmai/' && b === 'zenmai.progress') && games.some(([u, b]) => u === 'games/michibiki/' && b === 'michibiki.best') && games.some(([u, b]) => u === 'games/seizai/' && b === 'seizai.best') && games.every(([u]) => files.includes('./' + u)) && new Set(games.map((g) => g[1])).size === games.length && artOk, { games, artOk });
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
  {
    id: 'L10', tier: 'smoke', node: true, title: '版の表示：version.js と sw.js の CACHE_VERSION が一致、日付は YYYY-MM-DD の実在の日、version.js はメニューだけが読み、事前キャッシュに入っている',
    run({ check, root }) {
      const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
      const box = {}; vm.runInNewContext(rd('common/version.js'), { self: box });
      const v = box.YUBI_VERSION || {};
      const sw = rd('sw.js');
      const ver = (sw.match(/CACHE_VERSION\s*=\s*["']([^"']+)["']/) || [])[1];
      check('version.js の version が sw.js の CACHE_VERSION と同じ（上げるときは両方）', !!v.version && v.version === ver, { v: v.version, sw: ver });
      const okFmt = typeof v.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.date);
      const d = okFmt ? new Date(v.date + 'T00:00:00Z') : null;
      check('日付は YYYY-MM-DD で、実在する日', okFmt && !isNaN(d) && d.toISOString().slice(0, 10) === v.date, v.date);
      const files = [...(sw.match(/APP_FILES\s*=\s*\[([\s\S]*?)\]/) || [, ''])[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
      check('version.js が事前キャッシュ（APP_FILES）に入っている（オフラインでも版が出る）', files.includes('./common/version.js'), files);
      const pages = ['index.html', 'games/blocks/index.html', 'games/2048/index.html', 'games/kiritori/index.html', 'games/irocode/index.html', 'games/zenmai/index.html', 'games/irobin/index.html', 'games/matomete/index.html', 'games/michibiki/index.html'];
      const readers = pages.filter((f) => /version\.js|YUBI_VERSION/.test(rd(f)));
      check('version.js を読むのはメニュー（index.html）だけ', readers.join() === 'index.html', readers);
    },
  },
  {
    id: 'L11', tier: 'smoke', node: true, title: '開き直したあとの知らせ（X-24）と 保存の比べ方の注意書き（X-22）：notice.js が事前キャッシュに入り、8 本が読み、reloadIfStale の中（location.reload の前）で 1 回だけ markReload を呼ぶ（さいしょから では呼ばない）。印あり・同じ path のときだけ 1 つ足して印を消し、sessionStorage が例外でも落ちない。8 本の changedElsewhere の前に X-22 の注意書き',
    run({ check, root }) {
      const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
      const sw = rd('sw.js');
      const files = [...(sw.match(/APP_FILES\s*=\s*\[([\s\S]*?)\]/) || [, ''])[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
      check('notice.js が事前キャッシュ（APP_FILES）に入っている（オフラインでも知らせが出る）', files.includes('./common/notice.js'), files);
      const games = [['2048', 'index.html'], ['asteroid', 'main.js'], ['hashi', 'main.js'], ['irocode', 'index.html'], ['irobin', 'main.js'], ['matomete', 'main.js'], ['seizai', 'main.js'], ['zenmai', 'index.html']];
      const noLoad = games.filter(([g]) => !rd(`games/${g}/index.html`).includes('<script src="../../common/notice.js"></script>')).map(([g]) => g);
      check('8 本の index.html が notice.js を読む', noLoad.length === 0, noLoad);
      const badMark = [];
      const badX22 = [];
      for (const [g, f] of games) {
        const src = rd(`games/${g}/${f}`);
        const calls = src.match(/YubiNotice\.markReload\(\)/g) || [];
        const fn = src.indexOf('function reloadIfStale');
        const mk = src.indexOf('YubiNotice.markReload()');
        const rl = src.indexOf('location.reload()', fn);
        if (!(calls.length === 1 && fn >= 0 && mk > fn && rl > mk)) badMark.push(g);
        const i = src.indexOf('const changedElsewhere');
        const prev = i < 0 ? '' : src.slice(0, i).trimEnd().split('\n').pop();
        if (!/\/\/ X-22：/.test(prev)) badX22.push(g);
      }
      check('8 本とも markReload() は reloadIfStale の中で location.reload() の前に 1 回だけ（さいしょから の開き直しには無い）', badMark.length === 0, badMark);
      check('8 本の changedElsewhere の前の行に X-22 の注意書きがある', badX22.length === 0, badX22);
      // notice.js を偽の環境で動かす
      const code = rd('common/notice.js');
      const run = (mark, path0, opts = {}) => {
        const store = new Map(mark === null ? [] : [['yubi.reloadNote', mark]]);
        let added = 0;
        const sessionStorage = opts.throws
          ? { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } }
          : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
        const el = () => ({ style: {}, setAttribute() {}, set textContent(v) {}, parentNode: null });
        const box = { sessionStorage, location: { pathname: path0 }, document: { body: { appendChild() { added++; } }, createElement: el }, setTimeout: () => 0 };
        box.self = box;
        let threw = false;
        try { vm.runInNewContext(code, box); } catch (e) { threw = true; }
        return { threw, added, left: store.has('yubi.reloadNote'), box };
      };
      const r1 = run('/games/x/', '/games/x/');
      check('印あり・同じ path：知らせを 1 つ足して、印を消す', !r1.threw && r1.added === 1 && !r1.left, r1);
      const r2 = run(null, '/games/x/');
      check('印なし：足さない', !r2.threw && r2.added === 0, r2);
      const r3 = run('/games/y/', '/games/x/');
      check('ちがう path の印：足さない', !r3.threw && r3.added === 0, r3);
      const r4 = run('/games/x/', '/games/x/', { throws: true });
      check('sessionStorage が例外を出しても、落ちず・足さない', !r4.threw && r4.added === 0, r4);
      const mk = { sessionStorage: { setItem() { throw new Error('x'); } }, location: { pathname: '/p' }, document: {}, setTimeout: () => 0 }; mk.self = mk;
      vm.runInNewContext(code, mk);
      let mThrew = false; try { mk.YubiNotice.markReload(); } catch (e) { mThrew = true; }
      check('markReload は書けなくても例外を出さない', !mThrew);
    },
  },
  {
    id: 'L12', tier: 'smoke', node: true, title: '共有の見た目（IB-32）：メニューといろびんの head に description・og:*・twitter:card が 1 つずつ、og:url・og:image は公開の絶対 URL、絵（1200×630・300KB 以下）が手元にある、meta は title より前、いろびん・メニューの文の決まり',
    run({ check, root }) {
      const BASE = 'https://harutonatu.github.io/game-no1/';
      const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
      const metas = (html) => {
        const head = html.slice(0, html.indexOf('</head>'));
        return [...head.matchAll(/<meta\s+([^>]*?)\/?>/g)].map((m) => {
          const a = {}; for (const x of m[1].matchAll(/([\w:-]+)="([^"]*)"/g)) a[x[1]] = x[2];
          return { ...a, idx: m.index };
        });
      };
      const pages = [
        { f: 'index.html', url: BASE },
        { f: 'games/irobin/index.html', url: BASE + 'games/irobin/' },
      ];
      const N = (rd('index.html').match(/\{ name:/g) || []).length;
      const val = {};
      for (const pg of pages) {
        const html = rd(pg.f);
        const ms = metas(html);
        const titleAt = html.indexOf('<title>');
        const by = (k, v) => ms.filter((m) => m[k] === v);
        const one = (k, v) => { const r = by(k, v); return r.length === 1 ? r[0].content : null; };
        const V = {
          description: one('name', 'description'), title: one('property', 'og:title'), desc: one('property', 'og:description'),
          url: one('property', 'og:url'), image: one('property', 'og:image'), w: one('property', 'og:image:width'),
          h: one('property', 'og:image:height'), alt: one('property', 'og:image:alt'), card: one('name', 'twitter:card'),
        };
        val[pg.f] = V;
        check(`${pg.f}：description・og:title・og:description・og:url・og:image・幅・高さ・alt・twitter:card が 1 つずつ`, Object.values(V).every((x) => typeof x === 'string' && x.length > 0), V);
        check(`${pg.f}：og:image の幅 1200・高さ 630、twitter:card は summary_large_image`, V.w === '1200' && V.h === '630' && V.card === 'summary_large_image', V);
        check(`${pg.f}：og:url は公開の場所で ? を含まず、og:image は公開の絶対 URL`, V.url === pg.url && !String(V.url).includes('?') && String(V.image).startsWith(BASE) && /icons\/og-[a-z]+\.png$/.test(String(V.image)), V);
        const late = ms.filter((m) => /^og:|^twitter:/.test(m.property || m.name || '') || m.name === 'description').filter((m) => m.idx > titleAt);
        check(`${pg.f}：共有の meta はどれも <title> より前（DG1 を崩さない）`, titleAt > 0 && late.length === 0, late);
        const rel = String(V.image).slice(BASE.length);
        const file = path.join(root, rel);
        let w = 0, h = 0, size = 0, sig = false;
        if (fs.existsSync(file)) {
          const b = fs.readFileSync(file); size = b.length;
          sig = b.slice(1, 4).toString() === 'PNG' && b.slice(12, 16).toString() === 'IHDR';
          w = b.readUInt32BE(16); h = b.readUInt32BE(20);
        }
        check(`${pg.f}：絵 ${rel} が手元にあり、PNG で 1200×630、300KB 以下`, sig && w === 1200 && h === 630 && size <= 300 * 1024, { rel, sig, w, h, size });
      }
      const I = val['games/irobin/index.html'], M = val['index.html'];
      check('いろびん：description と og:description が「広告なし・登録なし。」で始まり「どうぶつ」を含み、og:title は「いろびん｜」で始まる',
        [I.description, I.desc].every((x) => x.startsWith('広告なし・登録なし。') && x.includes('どうぶつ')) && I.title.startsWith('いろびん｜'), I);
      const head = `指で あそぶ ${N}こ の ゲーム。広告なし・登録なし。`;
      check(`メニュー：description と og:description が「${head}」で始まる（N は GAMES の { name: の数）`, N > 0 && M.description.startsWith(head) && M.desc.startsWith(head), { N, M });
    },
  },
  {
    id: 'L13', tier: 'smoke', node: true, title: '共有の見た目の横展開（X-26）：いろびん以外の 12 本の head に description・og:*・twitter:card が 1 つずつ、og:url はそのゲームの公開の場所、og:image はメニューの絵、meta は title より前、文は「広告なし・登録なし。」で始まり og:title は「名前｜ゆびあそび」',
    run({ check, root }) {
      const BASE = 'https://harutonatu.github.io/game-no1/';
      const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
      const games = [...rd('index.html').matchAll(/\{ name: "([^"]+)"[^\n]*?url: "games\/([a-z0-9]+)\/"/g)].map((m) => ({ name: m[1], dir: m[2] })).filter((g) => g.dir !== 'irobin');
      check(`いろびん以外のゲームが 12 本（${games.map((g) => g.dir).join(',')}）`, games.length === 12, games);
      for (const g of games) {
        const f = `games/${g.dir}/index.html`;
        const html = rd(f);
        const head = html.slice(0, html.indexOf('</head>'));
        const ms = [...head.matchAll(/<meta\s+([^>]*?)\/?>/g)].map((m) => { const a = {}; for (const x of m[1].matchAll(/([\w:-]+)="([^"]*)"/g)) a[x[1]] = x[2]; return { ...a, idx: m.index }; });
        const one = (k, v) => { const r = ms.filter((m) => m[k] === v); return r.length === 1 ? r[0].content : null; };
        const V = {
          description: one('name', 'description'), title: one('property', 'og:title'), desc: one('property', 'og:description'),
          url: one('property', 'og:url'), image: one('property', 'og:image'), w: one('property', 'og:image:width'), h: one('property', 'og:image:height'),
          alt: one('property', 'og:image:alt'), card: one('name', 'twitter:card'), type: one('property', 'og:type'), site: one('property', 'og:site_name'),
        };
        check(`${f}：description・og:*・twitter:card が 1 つずつ`, Object.values(V).every((x) => typeof x === 'string' && x.length > 0), V);
        check(`${f}：og:url が ${BASE}games/${g.dir}/、og:image が ${BASE}icons/og-menu.png、1200×630、summary_large_image`,
          V.url === `${BASE}games/${g.dir}/` && V.image === `${BASE}icons/og-menu.png` && V.w === '1200' && V.h === '630' && V.card === 'summary_large_image', V);
        check(`${f}：description と og:description が同じで「広告なし・登録なし。」で始まる、og:title は「${g.name}｜ゆびあそび」、2048 の字を含まない`,
          V.description === V.desc && V.description.startsWith('広告なし・登録なし。') && V.title === `${g.name}｜ゆびあそび` && !/2048/.test(V.description + V.title), V);
        const titleAt = html.indexOf('<title>');
        const late = ms.filter((m) => /^og:|^twitter:/.test(m.property || m.name || '') || m.name === 'description').filter((m) => m.idx > titleAt);
        check(`${f}：共有の meta はどれも <title> より前（DG1 を崩さない）`, titleAt > 0 && late.length === 0, late);
      }
    },
  },
];
