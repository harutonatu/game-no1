# うみべで ねこが ねむる（nekoumibenemuru・段 XL・64x48 以下）。部品で描いて文字の地図 nekoumibenemuru.txt を書き出す。python3 nekoumibenemuru.py
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
HOLE = 'O'
# うみべで ねこが ねむる（うきわの中で まるくなる）。場所の物：うみ・うきわ
HZ = 17
R0 = 13
area = set((x, y) for y in range(HZ, H) for x in range(W)
           if not ((x < R0 and y > H - 1 - R0 and (R0 - x) ** 2 + (y - (H - 1 - R0)) ** 2 > R0 * R0) or
                   (x > W - 1 - R0 and y > H - 1 - R0 and (x - (W - 1 - R0)) ** 2 + (y - (H - 1 - R0)) ** 2 > R0 * R0)))
def shore(x): return 25 + 1.0 * math.sin(x / 5.0)
for (x, y) in area:
    s = shore(x)
    if y < HZ + 2: c = 'B'
    elif y < s - 1: c = 'W' if ((y == HZ + 3 and (x // 4) % 3 == 0) or (y == HZ + 5 and (x // 5) % 3 == 1)) else 'S'
    elif y < s + 0.5: c = 'W'
    else: c = 'O' if (x * 13 + y * 7) % 23 == 0 else 'Y'
    put(x, y, c)
fill(edge(area) - {(x, HZ) for x in range(W)}, 'K')
# うきわの かげ
fill(ell(33, 45, 24, 2.4), 'O')
# うきわ（ななめ上から。赤と白のしま）
CX, CY = 32, 38
outer = ell(CX, CY, 25, 8.5); inner = ell(CX, CY - 1, 15, 4.2)
ring = outer - inner
def ringcol(x, y):
    a = math.atan2((y + .5 - CY) * 2.5, x + .5 - CX)
    return 'R' if int((a + 3.3) / 0.8) % 2 == 0 else 'W'
back = {(x, y) for x, y in ring if y < CY - 1}
front = ring - back
for x, y in back: put(x, y, ringcol(x, y))
fill({(x, y) for x, y in back if (x, y - 1) not in ring and (x, y) not in edge(ring)}, 'W')
fill(inner, 'O')
fill(edge(ring) & back | edge(inner), 'K')
# ねこ（まるくなって ねむる）
body = ell(35, 28, 15, 9.5)
shape(body, 'O', sh='C', hi='Y')
for k in range(4):
    x0 = 32 + k * 5
    fill(line(x0, 19, x0 + 1, 23) & body, 'C')
earL = poly([(12, 22), (13, 11.5), (19, 17)]); earR = poly([(22.5, 16.5), (28.5, 12), (29, 21)])
shape(earL, 'O'); shape(earR, 'O')
fill(poly([(14, 18.5), (14.4, 14.5), (17, 17.5)]), 'R'); fill(poly([(24.5, 17.3), (27.4, 15), (27.5, 19)]), 'R')
head = ell(20.5, 26, 9.5, 8)
shape(head, 'O', sh='C', hi='Y')
for x0 in (18, 20, 22):
    fill(line(x0, 18.5, x0, 21), 'C')
mz = ell(21, 30.5, 5.5, 3); fill(mz, 'W')
for ex in (13, 23):                                           # とじた目
    fill({(ex, 25), (ex + 1, 26), (ex + 2, 26), (ex + 3, 26), (ex + 4, 25)}, 'K')
fill({(20, 28), (21, 28), (22, 28), (21, 29)}, 'R'); fill({(21, 30), (20, 31), (19, 31), (22, 31), (23, 31)}, 'K')
fill(ell(13, 29, 1.8, 1), 'R'); fill(ell(28.5, 29, 1.8, 1), 'R')
# うきわの手前（ねこの下半分を かくす）
for x, y in front: put(x, y, ringcol(x, y))
fill({(x, y) for x, y in front if (x, y - 1) not in ring and (x, y) not in edge(ring)}, 'W')
fill(edge(ring) & front, 'K')
fill({(x, y) for x, y in edge(inner) if y >= CY - 1} - edge(ring), 'K')
# まえあし と しっぽ（うきわに かける）
for cx in (15, 25):
    p = ell(cx, 39, 3.4, 2.3); shape(p, 'W'); fill({(cx - 1, 36), (cx + 1, 36)}, 'K')
tail = line(48, 29, 51, 36, 1.4) | line(51, 36, 47, 41, 1.4) | line(47, 41, 40, 42, 1.2)
shape(tail, 'O', sh='C', d=1)
fill({(40, 42), (41, 42), (39, 42)}, 'W')
# Zzz（右上）
zz(46, 8, 5); zz(53, 3, 6); zz(59, 0, 5)
finish('nekoumibenemuru')
