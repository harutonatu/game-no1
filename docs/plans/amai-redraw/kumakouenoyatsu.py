# こうえんで くまが おやつを たべる（kumakouenoyatsu・段 L・64x48 以下）。部品で描いて文字の地図 kumakouenoyatsu.txt を書き出す。python3 kumakouenoyatsu.py
import math, os, sys
W, H = 64, 48
g = [['.'] * W for _ in range(H)]
def put(x, y, c):
    if 0 <= x < W and 0 <= y < H: g[y][x] = c
def ell(cx, cy, rx, ry, ang=0):
    a = math.radians(ang); s = set()
    for y in range(H):
        for x in range(W):
            dx, dy = x + .5 - cx, y + .5 - cy
            u = (dx * math.cos(a) + dy * math.sin(a)) / rx
            v = (-dx * math.sin(a) + dy * math.cos(a)) / ry
            if u * u + v * v <= 1: s.add((x, y))
    return s
def rect(x0, y0, x1, y1):
    return {(x, y) for y in range(max(0, y0), min(H - 1, y1) + 1) for x in range(max(0, x0), min(W - 1, x1) + 1)}
def poly(pts):
    s = set(); n = len(pts)
    for y in range(H):
        for x in range(W):
            px, py = x + .5, y + .5; ins = False
            for i in range(n):
                ax, ay = pts[i]; bx, by = pts[(i + 1) % n]
                if (ay > py) != (by > py) and px < ax + (py - ay) * (bx - ax) / (by - ay): ins = not ins
            if ins: s.add((x, y))
    return s
def line(x0, y0, x1, y1, w=0.0):
    s = set(); n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
    r = int(math.ceil(w))
    for i in range(n + 1):
        t = i / n; x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        for oy in range(-r, r + 1):
            for ox in range(-r, r + 1):
                if ox * ox + oy * oy <= w * w + .01:
                    X, Y = int(round(x + ox)), int(round(y + oy))
                    if 0 <= X < W and 0 <= Y < H: s.add((X, Y))
    return s
def fill(m, c):
    for x, y in m: put(x, y, c)
def edge(m):
    return {(x, y) for x, y in m if any((x + dx, y + dy) not in m for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
def shape(m, c, o='K', sh=None, hi=None, d=2):
    """塗る・かげ（右下）・明るい所（左上）・ふちどり"""
    fill(m, c)
    if sh: fill({(x, y) for x, y in m if (x + d, y) not in m or (x, y + d) not in m}, sh)
    if hi: fill({(x, y) for x, y in m if ((x - d, y) not in m or (x, y - d) not in m) and (x + d, y) in m and (x, y + d) in m}, hi)
    if o: fill(edge(m), o)
def dither(m, c, k=2):
    fill({(x, y) for x, y in m if (x + y) % k == 0}, c)
def zz(x, y, n, c='K'):
    for i in range(n): put(x + i, y, c); put(x + i, y + n - 1, c); put(x + n - 1 - i, y + i, c)
def eye(x, y, big=True):
    fill(rect(x, y, x + 1, y + 2) if big else rect(x, y, x + 1, y + 1), 'K'); put(x, y, 'W')
def finish(name, holefill=None):
    holefill = holefill or globals().get('HOLE', 'K')
    out = set(); st = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
    st = [p for p in st if g[p[1]][p[0]] == '.']; out = set(st)
    while st:
        x, y = st.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if 0 <= q[0] < W and 0 <= q[1] < H and q not in out and g[q[1]][q[0]] == '.':
                out.add(q); st.append(q)
    n = 0
    for y in range(H):
        for x in range(W):
            if g[y][x] == '.' and (x, y) not in out: g[y][x] = holefill; n += 1
    rows = [''.join(r) for r in g]
    while rows and set(rows[0]) == {'.'}: rows.pop(0)
    while rows and set(rows[-1]) == {'.'}: rows.pop()
    while all(r[0] == '.' for r in rows): rows = [r[1:] for r in rows]
    while all(r[-1] == '.' for r in rows): rows = [r[:-1] for r in rows]
    here = os.path.dirname(os.path.abspath(sys.argv[0]))
    open(os.path.join(here, name + '.txt'), 'w').write('\n'.join(rows) + '\n')
    print('holes', n, 'sugar', sum(c != '.' for r in rows for c in r))
# ---- 場面 ----
# こうえんで くまが おやつ（ソフトクリーム）を たべる。場所の物：しばふ・木
# しばふ（ななめ上から見た島。上の面＝草、前のふち＝土）
lawn = ell(31, 42.5, 27, 3.3)
fill(lawn, 'G'); fill({(x, y) for x, y in lawn if (x * 7 + y * 3) % 11 == 0}, 'Y')
front = {(x, y + 1) for x, y in lawn if (x, y + 1) not in lawn}
fill(front, 'C'); fill(edge(lawn | front), 'K')
for x in range(4, 58, 3):
    put(x, min(y for xx, y in lawn if xx == x) - 1, 'G')
# 木（左奥）
trunk = poly([(7.5, 12), (9.5, 12), (10.5, 37), (12.5, 40.5), (4.5, 40.5), (6.5, 37)])
shape(trunk, 'C', hi='O', d=1)
fill(ell(12, 41, 6, 1.2) & lawn, 'K')
leaves = ell(9, 7, 6.5, 6) | ell(4.5, 11, 3.6, 3.2) | ell(14, 10.5, 4, 3.6)
shape(leaves, 'G', sh='K', hi='Y')
fill({(x, y) for x, y in leaves if g[y][x] == 'K' and (x + y) % 2 and (x, y) not in edge(leaves)}, 'G')
fill({(6, 5), (7, 4), (10, 9), (3, 11), (14, 10), (15, 9)}, 'Y')
# かげ
fill({(x, y) for x, y in ell(31, 44, 12, 1.2) if (x + y) % 2 == 0}, 'K')
# くま（すわって 右上のソフトクリームをなめる）
earL = ell(23, 5.5, 4.2, 4.2); earR = ell(42, 6, 4.2, 4.2)
shape(earL, 'C'); fill(ell(23, 6, 2.2, 2.2), 'P')
shape(earR, 'C'); fill(ell(42, 6.5, 2.2, 2.2), 'P')
body = ell(31, 31.5, 11.5, 9.5)   # 頭と 3 マス以上 重ねて 首を 太く
shape(body, 'C', sh='K', hi='O')
belly = ell(33, 34, 6.5, 6.5)
fill(belly, 'O'); fill({(x, y) for x, y in belly if (x - 1, y - 1) not in belly}, 'Y')
armB = poly([(19, 27), (16, 33), (19, 36), (23, 30)])          # 奥のうで
shape(armB, 'C', sh='K')
for cx in (21, 41):                                           # 足のうら（手前を向く）
    f = ell(cx, 42, 5, 3.6)
    shape(f, 'C'); fill(ell(cx, 42.2, 2.8, 2.0), 'O'); fill({(cx - 2, 39), (cx, 39), (cx + 2, 39)}, 'O')
head = ell(31.5, 15.5, 11.5, 10)
shape(head, 'C', sh='K', hi='O')
mz = ell(35, 20, 5, 3.6)
fill(mz, 'W'); fill({(x, y) for x, y in mz if (x, y + 1) not in mz}, 'O'); fill(edge(mz), 'K')
nose = ell(35, 18, 2.4, 1.4)
fill(nose, 'K'); put(34, 17, 'W')
fill({(35, 19), (35, 20), (34, 21), (33, 21), (36, 21), (37, 21)}, 'K')   # 口
tongue = ell(40, 20.5, 3.2, 1.3)
fill(tongue, 'P'); fill(edge(tongue) - {(x, y) for x, y in tongue if y <= 19 and x < 39}, 'K'); fill({(40, 20), (41, 20)}, 'P')
eye(27, 12); eye(38, 12)
fill(ell(26, 18, 2.2, 1.2), 'P')
# ソフトクリーム（いちご味。手前のうでで 下を持つ）
arm = poly([(40, 33), (37, 29), (45, 26), (50, 27), (50, 31), (44, 32)])
shape(arm, 'C', sh='K', hi='O', d=1)
cone = poly([(47, 18), (56, 18), (51.5, 31)])
fill(cone, 'O'); fill({(x, y) for x, y in cone if (x + y) % 3 == 0 or (x - y) % 3 == 0}, 'C'); fill(edge(cone), 'K')
cream = ell(51.5, 16.5, 5.6, 2.8) | ell(51.5, 12.5, 4.3, 2.6) | ell(52, 9, 2.8, 2) | rect(52, 6, 52, 7)
shape(cream, 'P', hi='W', d=1)
fill({(50, 13), (49, 17), (50, 16)}, 'W')
fill(edge(cream), 'K')
paw = ell(51, 28, 3.2, 2.8)
shape(paw, 'C', hi='O', d=1); fill({(50, 27), (51, 27)}, 'O')
# ハートの小さなきらきら（おいしい）
fill({(57, 3), (59, 3), (56, 4), (57, 4), (58, 4), (59, 4), (60, 4), (57, 5), (58, 5), (59, 5), (58, 6)}, 'P')
fill({(60, 10), (61, 9), (61, 11), (62, 10), (61, 10)}, 'Y')
finish('kumakouenoyatsu')
