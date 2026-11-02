# ゆきやまで いぬが おやつを たべる（inuyukiyamaoyatsu・段 XL・64x48 以下）。部品で描いて文字の地図 inuyukiyamaoyatsu.txt を書き出す。python3 inuyukiyamaoyatsu.py
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
HOLE = 'W'
# ゆきやまで いぬが おやつ（やきいも）を たべる。場所の物：やま・もみの木
# やま（右奥。左の面は日なた、右の面は かげ）
mt = poly([(20, 32), (40, 2), (47, 10), (52, 6), (64, 18), (64, 32)])
fill(mt, 'S')
cap = {(x, y) for x, y in mt if y < 9 + (2 if (x // 3) % 2 else 0)}
fill(cap, 'W')
for x0, y0 in ((36, 12), (31, 18), (46, 14), (55, 15), (58, 24), (27, 26)):   # 雪のすじ（ななめ）
    fill(line(x0, y0, x0 - 3, y0 + 5) & mt, 'W')
fill(edge(mt), 'K')
# ゆきの地面（ななめ上から見た丸い原っぱ）
snow = ell(32, 40.5, 32, 7)
fill(snow, 'W'); fill({(x, y) for x, y in snow if y > 43 and (x + y) % 2 == 0}, 'S'); fill({(x, y) for x, y in snow if y > 45}, 'S')
fill(edge(snow | (mt - {(x, y) for x, y in mt if y > 34})), 'K')
fill(edge(snow), 'K')
# もみの木（左奥。雪がつもる）
fill(rect(8, 30, 10, 36), 'C'); fill(edge(rect(8, 30, 10, 36)), 'K')
for (y0, y1, hw) in ((2, 13, 5), (8, 21, 7), (15, 31, 9)):
    t = poly([(9.5, y0), (9.5 + hw, y1), (9.5 - hw, y1)])
    shape(t, 'G', sh='K', d=1)
    fill({(x, y) for x, y in t if y >= y1 - 2 and (x % 3 == 0) and (x, y) not in edge(t)} | {(x, y) for x, y in t if y < y0 + 3 and (x, y) not in edge(t)}, 'W')
fill({(x, y) for x, y in rect(0, 0, 63, 47) if g[y][x] == 'K' and (x + y) % 2 and 3 < x < 16 and 3 < y < 30 and all(g[y + dy][x + dx] in 'GKW' for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}, 'G')
# かげ
fill(ell(31, 44.5, 17, 1.4), 'S')
# いぬ（ゆきの上に ふせて、まえあしの間の やきいもを かじる。少し ななめ前から）
tail = line(13, 36, 9, 31, 1.2) | line(9, 31, 10, 28, 1)
shape(tail, 'W', sh='S', d=1)
body = ell(25, 36, 13, 7)
shape(body, 'W', sh='S')
spot = ell(20, 33, 5, 3.5) & body; fill(spot - edge(body), 'C')
hip = ell(16, 39, 6, 4.5); shape(hip, 'W', sh='S')
fill(ell(14, 43.5, 4.5, 1.6), 'W'); fill(edge(ell(14, 43.5, 4.5, 1.6)), 'K'); fill({(12, 44), (14, 44), (16, 44)}, 'K')
for cx in (31, 46):                                            # まえあし（いもを はさむ）
    lg = line(cx - 2 if cx < 40 else cx + 1, 36, cx, 41, 1.6); shape(lg, 'W', sh='S', d=1)
    p = ell(cx, 42.5, 3, 1.8); shape(p, 'W'); fill({(cx - 1, 43), (cx + 1, 43)}, 'K')
# やきいも（まえあしの間）
imo = ell(38.5, 41.5, 6.5, 2.6)
shape(imo, 'R', sh='C', d=1)
fill({(x, y) for x, y in imo if x <= 34 and (x, y) not in edge(imo)}, 'Y')
fill({(x, y) for x, y in imo if x == 35 and (x, y) not in edge(imo)}, 'O')
fill({(38, 41), (41, 42), (43, 41)}, 'C'); fill({(40, 40), (37, 40), (42, 40)}, 'O')
fill(edge(imo), 'K')
# あたま（ななめ前から。たれた耳が 2 つ）
earL = poly([(29, 19), (33, 18), (31, 30), (28, 32), (26.5, 27)])
earR = poly([(42, 18), (46, 19), (48.5, 27), (47, 32), (44, 30)])
head = ell(37.5, 25.5, 8.5, 7.5)
shape(head, 'W', sh='S')
shape(earL, 'C', hi='O', d=1); shape(earR, 'C', d=1)
mz = ell(37.5, 30, 4.5, 3)
fill(mz, 'W'); fill({(x, y) for x, y in mz if (x, y + 1) not in mz}, 'S')
nose = ell(37.5, 28.3, 2, 1.3); fill(nose, 'K'); put(36, 27, 'W')
fill({(37, 30), (37, 31), (36, 32), (35, 32), (38, 32), (39, 32)}, 'K')      # 口（もぐもぐ）
fill(rect(33, 23, 34, 25), 'K'); put(33, 23, 'W')                             # 目
fill(rect(41, 23, 42, 25), 'K'); put(41, 23, 'W')
fill({(31, 28), (32, 28), (43, 28), (44, 28)}, 'R')                           # ほっぺ
# マフラー（あか・しま）
scarf = (ell(37.5, 33.5, 7.5, 1.8) | poly([(42, 33), (45, 33), (47, 39), (44, 39)])) - head - mz
shape(scarf, 'R', d=1); fill({(x, y) for x, y in scarf if (x + y) % 4 == 0 and (x, y) not in edge(scarf)}, 'W')
# ゆげ（ほかほか）
for x0 in (50, 54):
    for y in range(27, 38):
        put(x0 + (1 if (y // 2) % 2 else 0), y, 'S' if y > 30 else 'W')
# ふる雪
for x, y in ((3, 40), (20, 4), (28, 7), (58, 30), (60, 36), (17, 22), (24, 14)):
    fill({(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)}, 'W')
finish('inuyukiyamaoyatsu')
