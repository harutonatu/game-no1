# うみべで ねこが おやつを たべる（nekoumibeoyatsu・段 L・64x48 以下）。部品で描いて文字の地図 nekoumibeoyatsu.txt を書き出す。python3 nekoumibeoyatsu.py
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
# うみべで ねこが おやつ（かきごおり）を たべる。場所の物：うみ・すなはま
# うみ（奥。なみの白い線）
sea = poly([(5, 30), (9, 25), (59, 25), (63, 30), (63, 32), (5, 32)])
fill(sea, 'S')
for y, ph in ((27, 0), (29, 3), (31, 5)):
    fill({(x, y) for x, y2 in sea if y2 == y and (x + ph) % 7 < 3}, 'W')
# すなはま（手前。ななめ上から見た丸い はま）
sand = ell(34, 36, 29, 9) - rect(0, 0, 63, 31)
fill(sand, 'Y'); fill({(x, y) for x, y in sand if (x * 5 + y * 3) % 13 == 0}, 'O')
fill({(x, y) for x, y in sand if y == 32}, 'W')   # なみうちぎわ
fill(edge(sand | sea), 'K')
# かげ
fill({(x, y) for x, y in ell(28, 43, 13, 1.6)} , 'O'); fill({(x, y) for x, y in ell(51, 43, 7, 1.3)}, 'O')
# ねこ（すわって かきごおりを すくう）
tail = line(16, 41, 9, 39, 1.2) | line(9, 39, 7, 34, 1.1)
shape(tail, 'O', sh='C', d=1)
fill({(9, 38), (8, 36), (12, 40)}, 'C')
body = ell(25.5, 31.5, 10, 11) | ell(35, 22.5, 5, 4)   # 頭と 3 マス以上 重ねて 首を 太く
shape(body, 'O', sh='C', hi='Y')
chest = ell(28, 31, 5, 7)
fill(chest, 'W')
for k in range(3):
    fill(line(17, 27 + 3 * k, 19, 28 + 3 * k), 'C')
for cx in (21, 32):                                    # まえあし（すわり）
    f = ell(cx, 41.5, 3.2, 2.2)
    shape(f, 'W'); fill({(cx - 1, 42), (cx + 1, 42)}, 'K')
earL = poly([(15, 13), (16.5, 2), (23, 9)]); earR = poly([(29, 8), (36, 2), (37, 13)])
shape(earL, 'O'); shape(earR, 'O')
fill(poly([(17, 10), (17.5, 5), (21, 9)]), 'R'); fill(poly([(31, 8.5), (34.5, 5.5), (35, 10)]), 'R')
head = ell(26, 15, 11, 8.5)
shape(head, 'O', sh='C', hi='Y')
for x0 in (24, 26, 28):
    fill(line(x0, 7, x0, 9), 'C')
mz = ell(28, 19, 5.5, 3.2)
fill(mz, 'W')
# 目（にっこり とじた目）・はな・口・べろ
for ex in (19, 30):
    fill({(ex, 15), (ex + 1, 14), (ex + 2, 14), (ex + 3, 15)}, 'K')
fill({(27, 17), (28, 17), (29, 17), (28, 18)}, 'R'); fill({(27, 16), (28, 16), (29, 16)}, 'K')
fill({(28, 19), (27, 20), (26, 20), (29, 20), (30, 20)}, 'K'); fill({(28, 20), (28, 21), (27, 21), (29, 21)}, 'R')
fill(ell(18.5, 18.5, 1.8, 1), 'R')
for a, b in (((35, 17), (40, 16)), ((35, 19), (40, 20)), ((20, 18), (14, 17)), ((20, 20), (14, 21))):
    fill(line(*a, *b), 'K')
# かきごおり（右手前。カップ・こおり・いちごのシロップ）
cup = poly([(42, 33), (59, 33), (57, 44), (44, 44)])
fill(cup, 'S'); fill({(x, y) for x, y in cup if x % 4 == 0}, 'W'); fill(edge(cup), 'K')
fill(line(42, 33, 59, 33), 'K')
ice = ell(50.5, 33, 8.5, 10) - rect(0, 33, 63, 47)
shape(ice, 'W', sh='S', d=1)
syrup = {(x, y) for x, y in ice if y <= 27 or (y <= 30 and x % 3 == 1)} - edge(ice)
fill({(x, y) for x, y in ice if y <= 26 and (x + 1, y) not in ice}, 'S')
fill(syrup, 'R'); fill({(47, 25), (48, 25), (46, 26), (47, 26)}, 'W')
fill(edge(ice), 'K')
# スプーンを持つ うで
arm = poly([(32, 27), (36, 23), (40, 22), (41, 25), (37, 28), (33, 31)])
shape(arm, 'O', sh='C', d=1)
paw = ell(41, 23.5, 2.6, 2.4)
shape(paw, 'W')
fill(line(43, 22, 48, 24), 'Y'); fill(line(43, 21, 48, 23), 'K')
fill(ell(49.5, 24.5, 1.8, 1.2), 'Y'); fill(edge(ell(49.5, 24.5, 1.8, 1.2)), 'K')
fill({(55, 9), (55, 10), (54, 10), (56, 10), (55, 11)}, 'W')
finish('nekoumibeoyatsu')
