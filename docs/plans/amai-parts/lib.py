# あまいものあつめ：絵の部品の共通の道具（計画書 docs/plans/amai-parts.md・約束 §2.6）
# 今の台本（amai-redraw/*.py・amai-more2/*.py）の道具（ell・rect・poly・line・shape・finish など）を 1 つにまとめた。
#
#   キャンバス：64×48。reset() で空にする。1 マス＝1 粒。文字は '.' と 12 色（R O Y G S B P C W K D V）。
#   重ね（レイヤー）：begin() 〜 end(flip, ax) の間に描いた物を、あとで左右ぎゃくにして重ねられる（動物の部品で使う）。
#   背景：base_fill(m, c) で「地の色」をおぼえる。deco(x, y, c) は模様（星・草の点など）。主役のふちのすぐ外の模様は
#        end(halo=True) が地の色にもどす（主役が模様にうもれないように。amai-bg/bg.py の決まり 3 と同じ考え）。
#   書き出し：finish(id) が 閉じた空きをうめて <id>.txt・<id>.png（1 マス 10px）・<id>-se.png（SE 縦の実寸に近い 1 マス 4.5px）を書く。
#   確かめ：check(rows, tier) が 約束 §2.6 の決まり 1〜5（大きさ・文字・段の角砂糖と色の数・各色 3 個以上・閉じた空き）と
#        「2×2 に割った地図でない」を確かめる。決まり 8（頭と胴体の重なり・首の太さ）は部品の側で neck_report() を使って確かめる。
import os, math

W, H = 64, 48
COLORS = "ROYGSBPCWKDV"
HEX = {"R": "#E23B3B", "O": "#F28C28", "Y": "#F2D13A", "G": "#3E9E4F", "S": "#78C6EE", "B": "#2E5BC9",
       "P": "#F29BC2", "C": "#8B5A33", "W": "#F5F2EA", "K": "#2B2B33", "D": "#1F5E35", "V": "#8A5CC8", ".": "#DDDDDD"}
# 段ごとの 角砂糖・色の数（amai-redraw/build.js の RANGE と同じ。2026-11-05）
RANGE = {"S": (800, 1000, 4, 5), "M": (1200, 1480, 5, 7), "L": (2280, 3072, 7, 10),
         "XL": (2860, 3072, 9, 11), "XXL": (2400, 3072, 8, 12)}
# SE 縦（320×568）の面の絵の 1 マス：絵に使える幅 約 288px ÷ 64 ＝ 約 4.5px（約束 §3.1・render.js の layout）
SE_CELL = 4.5
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

ALL = {(x, y) for y in range(H) for x in range(W)}
g = None          # 今 描いている格子（重ねの中なら重ねの格子）
_stack = []       # begin() で積んだ 下の格子
base = None       # 地の色（背景の関数が base_fill で決める）
decos = set()     # 模様のマス（主役のふちの外なら地の色にもどしてよい）


def reset():
    global g, base, decos, _stack
    g = [['.'] * W for _ in range(H)]
    base = [[None] * W for _ in range(H)]
    decos = set(); _stack = []


reset()


# ---- 1 マスと図形（マスの集まり＝set of (x, y)）----
def put(x, y, c):
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = c


def at(x, y):
    return g[y][x] if 0 <= x < W and 0 <= y < H else None


def ell(cx, cy, rx, ry, ang=0):
    """だ円（cx, cy は中心。マスの中心 x+.5 で見る）。ang は度。"""
    a = math.radians(ang); ca, sa = math.cos(a), math.sin(a)
    s = set()
    for y in range(max(0, int(cy - max(rx, ry)) - 2), min(H, int(cy + max(rx, ry)) + 3)):
        for x in range(max(0, int(cx - max(rx, ry)) - 2), min(W, int(cx + max(rx, ry)) + 3)):
            dx, dy = x + .5 - cx, y + .5 - cy
            u = dx * ca + dy * sa; v = -dx * sa + dy * ca
            if (u / rx) ** 2 + (v / ry) ** 2 <= 1.0:
                s.add((x, y))
    return s


def rect(x0, y0, x1, y1):
    x0, x1 = int(min(x0, x1)), int(max(x0, x1)); y0, y1 = int(min(y0, y1)), int(max(y0, y1))
    return {(x, y) for y in range(max(0, y0), min(H - 1, y1) + 1) for x in range(max(0, x0), min(W - 1, x1) + 1)}


def poly(pts):
    s = set(); n = len(pts)
    for (x, y) in ALL:
        px, py = x + .5, y + .5; ins = False
        for i in range(n):
            ax, ay = pts[i]; bx, by = pts[(i + 1) % n]
            if (ay > py) != (by > py) and px < ax + (py - ay) * (bx - ax) / (by - ay):
                ins = not ins
        if ins:
            s.add((x, y))
    return s


def line(x0, y0, x1, y1, w=0):
    """w＝0 は 1 マスの線、w>0 は太さ w の線（はしは丸い）。"""
    if w <= 0:
        s = set(); n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for i in range(int(round(n)) + 1):
            t = i / max(1, round(n))
            s.add((int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t))))
        return {p for p in s if p in ALL}
    s = set(); L2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 or 1
    for (x, y) in ALL:
        px, py = x + .5, y + .5
        t = max(0, min(1, ((px - x0) * (x1 - x0) + (py - y0) * (y1 - y0)) / L2))
        if math.hypot(px - x0 - t * (x1 - x0), py - y0 - t * (y1 - y0)) <= w / 2:
            s.add((x, y))
    return s


def arc(cx, cy, rx, ry, a0, a1, step=2):
    """だ円の線の一部（度。0＝右、90＝下）。"""
    s = set()
    for a in range(int(a0), int(a1) + 1, step):
        r = math.radians(a)
        s.add((int(round(cx + rx * math.cos(r) - .5)), int(round(cy + ry * math.sin(r) - .5))))
    return {p for p in s if p in ALL}


def cells(m, f):
    return {(x, y) for (x, y) in m if f(x, y)}


def fill(m, c):
    for x, y in m:
        put(x, y, c)


def edge(m):
    """m のふち（上下左右のどれかが m の外）。"""
    return {(x, y) for x, y in m if any((x + dx, y + dy) not in m
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}


def shape(m, c, o='K', sh=None, hi=None, sw=2, hw=2):
    """塗って、かげ（左下）・明るい所（右上）を付けて、ふちどり o。"""
    fill(m, c)
    if sh:
        fill({(x, y) for x, y in m if (x - sw, y) not in m or (x, y + sw) not in m}, sh)
    if hi:
        fill({(x, y) for x, y in m if ((x + hw, y) not in m or (x, y - hw) not in m)
              and (x - sw, y) in m and (x, y + sw) in m}, hi)
    if o:
        fill(edge(m), o)


def dither(m, c, k=2):
    fill(cells(m, lambda x, y: (x + y) % k == 0), c)


def shadow(cx, cy, rx, ry, on, c='K', solid=0.5):
    """地面に落ちるかげ。on の色の上だけ、まん中はぬり、まわりは市松。"""
    for (x, y) in ell(cx, cy, rx, ry):
        q = ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2
        if at(x, y) in on and (q < solid or (x + y) % 2 == 0):
            put(x, y, c)


# ---- 背景の地の色と模様 ----
def base_fill(m, c):
    """背景の地の色として塗る（end(halo=True) が模様をこの色へもどす）。"""
    for x, y in m:
        if 0 <= x < W and 0 <= y < H:
            g[y][x] = c; base[y][x] = c; decos.discard((x, y))


def deco(x, y, c):
    """模様の 1 マス（星・草の点・道の線など）。"""
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = c; decos.add((x, y))


# ---- 背景の部品で使う道具（2026-11-09 に足した。9 場所で そろえる）----
# 地の色ごとの「模様の色」（地面の草・板の目地・雲のかげ など）。背景の sky= / ground= で地の色を変えたときに使う。
ACCENT = {'G': 'D', 'D': 'G', 'Y': 'O', 'O': 'C', 'C': 'O', 'W': 'S', 'S': 'W', 'B': 'S', 'P': 'V', 'V': 'P',
          'K': 'V', 'R': 'O'}


def accent(c):
    return ACCENT.get(c, 'K')


def hsh(x, y, k=0):
    """マスごとの 決まった ばらつき（0〜999）。乱数の代わり（同じ入力から毎回同じ絵）。"""
    v = (x * 73856093) ^ (y * 19349663) ^ (k * 83492791)
    return (v ^ (v >> 13)) % 1000


def cloud(cx, cy, w=5, c='W', shade=None):
    """雲（3 つのだ円）。shade を わたすと 下のはしに市松の かげ。返り値は雲のマス。"""
    m = ell(cx, cy, w, 1.6) | ell(cx - w * .4, cy - 1, w * .6, 1.5) | ell(cx + w * .4, cy - 1.2, w * .5, 1.4)
    fill(m, c)
    if shade:
        fill(cells(m, lambda x, y: (x, y + 1) not in m and (x + y) % 2 == 0), shade)
    return m


def sun(cx, cy, r=3, c='Y', rim='O'):
    """太陽（まる c・ふち rim・8 本の光）。"""
    m = ell(cx, cy, r, r)
    fill(m, c); fill(edge(m), rim)
    for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0), (.75, .75), (-.75, -.75), (.75, -.75), (-.75, .75)):
        put(int(cx + dx * (r + 1.6)), int(cy + dy * (r + 1.6)), rim)
    return m


# ---- 重ね（レイヤー）。動物の部品を左右ぎゃくにするため ----
def begin():
    global g
    _stack.append(g)
    g = [['.'] * W for _ in range(H)]


def end(flip=False, ax=None, halo=True):
    """begin() から描いた物を下の格子に重ねる。flip なら x＝ax を軸に左右ぎゃく（x → 2*ax-1-x）。
    halo なら、重ねた物のすぐ外（8 方向）の模様を地の色へもどす。返り値は重ねたマスの集まり。"""
    global g
    top = g; g = _stack.pop()
    put_cells = {}
    for y in range(H):
        for x in range(W):
            c = top[y][x]
            if c == '.':
                continue
            nx = (2 * ax - 1 - x) if flip else x
            if 0 <= nx < W:
                put_cells[(nx, y)] = c
    for (x, y), c in put_cells.items():
        g[y][x] = c; decos.discard((x, y))
    if halo:
        for (x, y) in put_cells:
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    q = (x + dx, y + dy)
                    if q in decos and q not in put_cells and base[q[1]][q[0]]:
                        g[q[1]][q[0]] = base[q[1]][q[0]]; decos.discard(q)
    return set(put_cells)


def fx(x, cx, flip):
    """部品の中で、向きに合わせて x を返す（右むきで考えた cx からのずれ）。"""
    return cx - (x - cx) if flip else x


# ---- よく使う小さな物 ----
def note(x, y, c='K'):
    """音符（♪）。x, y は玉の左上。"""
    fill(ell(x + 1, y + 6.5, 1.7, 1.3), c)
    fill(rect(x + 2, y, x + 2, y + 6), c)
    fill({(x + 3, y), (x + 4, y + 1), (x + 4, y + 2)}, c)


def sparkle(x, y, c='Y'):
    fill({(x, y - 1), (x - 1, y), (x, y), (x + 1, y), (x, y + 1)}, c)


def neck_report(head, body):
    """決まり 8 の確かめ：頭と胴体が重なる（となり合う）マスの数と、首の太さ・頭の幅。"""
    touch = {(x, y) for (x, y) in head if (x, y) in body or (x, y + 1) in body}
    hw = max(x for x, _ in head) - min(x for x, _ in head) + 1
    ys = sorted({y for _, y in touch})
    neck = max((len({x for x, yy in touch if yy == y}) for y in ys), default=0)
    return {"重なり": len(head & body), "首の太さ": neck, "頭の幅": hw, "ok": len(head & body) >= 3 and neck * 2 >= hw}


# ---- 書き出し ----
def close_holes(holec='W'):
    """外へ出られない '.' を holec でうめる（決まり 5）。"""
    st = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
    st = [p for p in st if g[p[1]][p[0]] == '.']; out = set(st)
    while st:
        x, y = st.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if 0 <= q[0] < W and 0 <= q[1] < H and q not in out and g[q[1]][q[0]] == '.':
                out.add(q); st.append(q)
    for y in range(H):
        for x in range(W):
            if g[y][x] == '.' and (x, y) not in out:
                g[y][x] = holec


def rows_now():
    rows = [''.join(r) for r in g]
    while rows and set(rows[0]) == {'.'}: rows.pop(0)
    while rows and set(rows[-1]) == {'.'}: rows.pop()
    while rows and all(r[0] == '.' for r in rows): rows = [r[1:] for r in rows]
    while rows and all(r[-1] == '.' for r in rows): rows = [r[:-1] for r in rows]
    return rows


def png(rows, path, cell):
    """文字の地図を PNG に（cell＝1 マスの px。4.5 などの小数は、実機のように 4 と 5 のマスがまざる）。"""
    from PIL import Image
    w, h = len(rows[0]), len(rows)
    im = Image.new("RGB", (w, h))
    px = im.load()
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            v = HEX[c]; px[x, y] = (int(v[1:3], 16), int(v[3:5], 16), int(v[5:7], 16))
    im.resize((int(round(w * cell)), int(round(h * cell))), Image.NEAREST).save(path)


def finish(name, tier="XXL", holec='W', outdir=OUT):
    """閉じた空きをうめ、<name>.txt と PNG 2 つを書き出し、確かめの結果を返す。"""
    close_holes(holec)
    rows = rows_now()
    os.makedirs(outdir, exist_ok=True)
    open(os.path.join(outdir, name + '.txt'), 'w', encoding='utf-8').write('\n'.join(rows) + '\n')
    png(rows, os.path.join(outdir, name + '.png'), 10)
    png(rows, os.path.join(outdir, name + '-se.png'), SE_CELL)
    res = check(rows, tier)
    print(name, '角砂糖', res['sugar'], '色', res['ncolors'], res['counts'], 'OK' if res['ok'] else 'NG ' + ' / '.join(res['ng']))
    return res


def check(rows, tier="XXL"):
    """約束 §2.6 の決まり 1〜5 と「2×2 に割った地図でない」を確かめる。"""
    ng = []
    h = len(rows); w = len(rows[0]) if rows else 0
    if not rows or w > 64 or h > 48: ng.append(f'大きさ {w}x{h}')
    if any(len(r) != w for r in rows): ng.append('行の長さがちがう')
    if rows and (set(rows[0]) == {'.'} or set(rows[-1]) == {'.'} or all(r[0] == '.' for r in rows) or all(r[-1] == '.' for r in rows)):
        ng.append('はしの行・列が空き')
    bad = {c for r in rows for c in r if c != '.' and c not in COLORS}
    if bad: ng.append('使えない文字 ' + ''.join(sorted(bad)))
    cnt = {}
    for r in rows:
        for c in r:
            if c != '.': cnt[c] = cnt.get(c, 0) + 1
    sugar = sum(cnt.values()); nc = len(cnt)
    lo, hi, clo, chi = RANGE[tier]
    if not lo <= sugar <= hi: ng.append(f'角砂糖 {sugar}（{lo}〜{hi}）')
    if not clo <= nc <= chi: ng.append(f'色 {nc}（{clo}〜{chi}）')
    few = [c for c, n in cnt.items() if n < 3]
    if few: ng.append('3 個より少ない色 ' + ''.join(few))
    # 閉じた空き
    outside = set(); st = [(x, y) for y in range(h) for x in range(w) if (x in (0, w - 1) or y in (0, h - 1)) and rows[y][x] == '.']
    outside |= set(st)
    while st:
        x, y = st.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if 0 <= q[0] < w and 0 <= q[1] < h and q not in outside and rows[q[1]][q[0]] == '.':
                outside.add(q); st.append(q)
    holes = sum(1 for y in range(h) for x in range(w) if rows[y][x] == '.' and (x, y) not in outside)
    if holes: ng.append(f'閉じた空き {holes}')
    odd = sum(1 for y in range(h) for x in range(1, w, 2) if rows[y][x] != rows[y][x - 1])
    if odd == 0: ng.append('2×2 に割った地図')
    return {"ok": not ng, "ng": ng, "sugar": sugar, "ncolors": nc, "counts": dict(sorted(cnt.items(), key=lambda kv: -kv[1])),
            "size": (w, h), "dots": sum(r.count('.') for r in rows)}
