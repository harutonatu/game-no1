# こうえんで ねこが おやつを たべる（nekokouenoyatsu・段 XL・64x48 以下）。部品で描いて文字の地図 nekokouenoyatsu.txt を書き出す。python3 nekokouenoyatsu.py
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
HOLE = "K"
# こうえんで ねこが おやつ（おだんご）を たべる。場所の物：木・ベンチ
# しばふ
lawn = ell(32, 39.5, 31.5, 7.3)
fill(lawn, 'G'); fill({(x, y) for x, y in lawn if (x * 7 + y * 3) % 11 == 0}, 'Y')
front = {(x, y + 1) for x, y in lawn if (x, y + 1) not in lawn}
fill(front, 'C'); fill(edge(lawn | front), 'K')
for x in range(2, 62, 3):
    put(x, min(y for xx, y in lawn if xx == x) - 1, 'G')
# 木（左奥。花が さいている）
trunk = poly([(5, 12), (8.5, 12), (9, 36), (11, 39.5), (3, 39.5), (4.5, 36)])
shape(trunk, 'C', hi='O', d=1)
leaves = ell(7, 6.5, 7, 6) | ell(2.5, 11, 3.6, 3.2) | ell(12.5, 10.5, 4.2, 3.6)
shape(leaves, 'G', sh='K', hi='Y')
fill({(x, y) for x, y in leaves if g[y][x] == 'K' and (x + y) % 2 and (x, y) not in edge(leaves)}, 'G')
for x, y in ((4, 4), (9, 3), (11, 8), (3, 10), (7, 9), (14, 11)):
    fill({(x, y), (x + 1, y), (x, y + 1)}, 'P')
# ベンチ（ななめから。背もたれ・座面・脚）
for (x1, y1, x2, y2) in ((13, 31, 13, 40), (49, 29, 49, 38), (17, 33, 17, 41), (53, 31, 53, 40)):
    fill(line(x1, y1, x2, y2, 0.5), 'K')
back = poly([(12, 17), (54, 13), (54, 27), (12, 30.5)])
fill(back, 'C')
for k in range(3):
    fill({(x, y) for x, y in back if abs((y + 0.5) - (17 + k * 3.2 - (x - 12) * 0.095)) < 0.6}, 'O')
fill(edge(back), 'K')
fill(line(14, 25, 14, 30, 0.5) | line(52, 21, 52, 28, 0.5), 'K')
seat = poly([(10, 30), (52, 26.5), (56, 28.5), (14, 32.5)])
fill(seat, 'O'); fill(edge(seat), 'K')
seatf = poly([(14, 32.5), (56, 28.5), (56, 30.5), (14, 34.5)])
fill(seatf, 'C'); fill(edge(seatf), 'K')
fill({(x, y) for x, y in ell(35, 41.5, 20, 1.6) & lawn if (x + y) % 2 == 0}, 'K')
# ねこ（ベンチに すわって おだんごを 食べる）
tail = line(21, 30, 17, 34, 1.1) | line(17, 34, 17, 39, 1.0)
shape(tail, 'O', sh='C', d=1)
fill({(17, 36), (17, 38)}, 'C')
body = ell(28, 23.5, 9.5, 8)
shape(body, 'O', sh='C', hi='Y')
chest = ell(30.5, 23, 4.5, 6.5); fill(chest, 'W')
for k in range(3):
    fill(line(20, 20 + 3 * k, 22, 21 + 3 * k), 'C')
for cx in (25, 34):                                         # 足（座面の上）
    f = ell(cx, 30.5, 3, 2); shape(f, 'W'); fill({(cx - 1, 31), (cx + 1, 31)}, 'K')
earL = poly([(19, 9), (20.5, 0), (25.5, 5.5)]); earR = poly([(31, 5), (37, 0), (37.5, 9.5)])
shape(earL, 'O'); shape(earR, 'O')
fill(poly([(21, 6.5), (21.3, 3), (24, 5.5)]), 'R'); fill(poly([(33, 5.2), (36, 3), (36, 7)]), 'R')
head = ell(28.5, 11, 10, 7.8)
shape(head, 'O', sh='C', hi='Y')
for x0 in (26, 28, 30):
    fill(line(x0, 3.5, x0, 5.5), 'C')
mz = ell(31, 15, 5.5, 3); fill(mz, 'W')
for ex in (24, 33):                                         # 目（おだんごを見る）
    fill(rect(ex, 9, ex + 1, 11), 'K'); put(ex + 1, 9, 'W')
fill({(30, 13), (31, 13), (32, 13), (31, 14)}, 'R')
mouth = ell(32.5, 16.5, 2.2, 1.4); fill(mouth, 'R'); fill(edge(mouth), 'K'); fill({(31, 14), (31, 15)}, 'K')
fill(ell(21.5, 14, 1.8, 1), 'R')
for a, b in (((38, 13), (42, 12)), ((38, 15), (42, 16)), ((22, 15), (18, 14)), ((22, 17), (18, 18))):
    fill(line(*a, *b), 'K')
# おだんご（くし。ピンク・しろ・みどり）と もつ うで
fill(line(47, 8, 47, 26, 0.4), 'C'); fill({(48, y) for y in range(20, 27)} | {(46, y) for y in range(20, 27)} | {(47, 27)}, 'K')
for cy, c in ((3.5, 'P'), (9.3, 'W'), (15.1, 'G')):
    d = ell(47.5, cy, 3.8, 3)
    fill(d, c); fill({(46, int(cy) - 1), (45, int(cy))}, 'W' if c != 'W' else 'Y'); fill(edge(d), 'K')
arm = poly([(33, 22), (38, 19), (44, 19), (45, 23), (38, 25), (35, 26)])
shape(arm, 'O', sh='C', d=1)
paw = ell(46.5, 21, 2.6, 2.4); shape(paw, 'W')
# 花びら
for x, y in ((55, 6), (59, 12), (52, 2), (61, 3)):
    fill({(x, y), (x + 1, y), (x, y + 1)}, 'P')
finish('nekokouenoyatsu')
