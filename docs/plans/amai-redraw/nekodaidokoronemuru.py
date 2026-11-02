# だいどころで ねこが ねむる（nekodaidokoronemuru・段 XL・64x48 以下）。部品で描いて文字の地図 nekodaidokoronemuru.txt を書き出す。python3 nekodaidokoronemuru.py
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
HOLE = 'B'
# だいどころで ねこが ねむる（夜。おなべの中で まるくなる）。場所の物：まど・なべ
# 床（板の間）
floor = rect(0, 34, 63, 47)
fill(floor, 'Y')
for y in (37, 42):
    fill({(x, y) for x in range(W)}, 'O')
for vx in (-60, -28, 4, 36, 68, 100, 132):
    fill(line(32 + (vx - 32) / 3, 34, vx, 47) & floor, 'O')
fill({(x, 34) for x in range(W)}, 'K')
# まど（右上・夜空と月と星）
win = rect(40, 1, 62, 22)
fill(win, 'B')
moon = ell(55, 7.5, 4, 4) - ell(57, 6, 3.5, 3.5)
fill(moon, 'Y')
for x, y in ((44, 4), (48, 9), (45, 15), (58, 16), (52, 19), (49, 3)):
    put(x, y, 'W')
fill({(x, y) for x, y in win if (x + y) % 2 == 0 and y > 18 and g[y][x] == 'B'}, 'S' if False else 'B')
fill(rect(51, 1, 51, 22) | rect(40, 12, 62, 12), 'C')
fill(edge(win), 'K')
sill = rect(38, 23, 63, 24); fill(sill, 'C'); fill({(x, 23) for x in range(39, 63)}, 'O'); fill(edge(sill), 'K')
# なべの かげ
fill(ell(27, 45.5, 19, 1.4), 'O')
# なべ（おくの ふち）
CX = 27
rim = ell(CX, 27, 18, 3.8)
inner = ell(CX, 27, 15.5, 2.6)
back_rim = {(x, y) for x, y in rim - inner if y <= 27}
fill(back_rim, 'S'); fill(inner, 'K')
fill(edge(rim) & back_rim, 'K')
# ねこ（なべの中で まるくなる）
body = ell(31, 23, 12.5, 6.5)
shape(body, 'O', sh='C', hi='Y')
for k in range(4):
    x0 = 28 + k * 4
    fill(line(x0, 17, x0 + 1, 20) & body, 'C')
earL = poly([(12.5, 17), (13.5, 8), (18.5, 13)]); earR = poly([(22, 12.5), (27.5, 9), (27.5, 17)])
shape(earL, 'O'); shape(earR, 'O')
fill(poly([(14.5, 14.5), (14.8, 11), (17, 13.5)]), 'R'); fill(poly([(23.8, 13.3), (26.4, 11.5), (26.4, 15)]), 'R')
head = ell(20, 19.5, 8.5, 7)
shape(head, 'O', sh='C', hi='Y')
for x0 in (18, 20, 22):
    fill(line(x0, 13, x0, 15), 'C')
mz = ell(20.5, 23.5, 4.8, 2.6); fill(mz, 'W')
for ex in (13, 22):                                           # とじた目
    fill({(ex, 19), (ex + 1, 20), (ex + 2, 20), (ex + 3, 20), (ex + 4, 19)}, 'K')
fill({(19, 22), (20, 22), (21, 22), (20, 23)}, 'R'); fill({(20, 24), (19, 25), (18, 25), (21, 25), (22, 25)}, 'K')
fill(ell(12.5, 23, 1.6, 0.9), 'R'); fill(ell(28, 23, 1.6, 0.9), 'R')
# なべ（手前。ねこの下を かくす）
pot = poly([(9, 27), (45, 27), (44, 39), (41, 43), (13, 43), (10, 39)])
fill(pot, 'B')
fill({(x, y) for x, y in pot if x <= 13 or (x <= 15 and y > 33)}, 'S')
fill({(x, y) for x, y in pot if 16 <= x <= 17 and 30 <= y <= 39}, 'W')
fill({(x, y) for x, y in pot if x >= 41}, 'K' if False else 'B')
front_rim = {(x, y) for x, y in rim - inner if y > 27}
fill(front_rim, 'S'); fill({(x, y) for x, y in front_rim if y == max(yy for xx, yy in rim if xx == x)}, 'W')
fill(edge(pot | front_rim) - back_rim - head - body, 'K')
fill(edge(rim) & front_rim, 'K')
for hx, s in ((7, -1), (47, 1)):                            # とって
    h = rect(min(hx, hx - 2 * s), 29, max(hx, hx - 2 * s), 31)
    shape(h, 'K', o=None)
# まえあし（ふちに かける）と しっぽ（外へ たれる）
for cx in (15, 24):
    p = ell(cx, 29.5, 2.8, 1.9); shape(p, 'W'); fill({(cx - 1, 30), (cx + 1, 30)}, 'K')
tail = line(42, 25, 45, 29, 1.2) | line(45, 29, 46, 36, 1.2)
shape(tail, 'O', sh='C', d=1)
fill({(45, 31), (46, 33), (46, 35)}, 'C')
# Zzz（左上）
zz(5, 12, 5); zz(0, 5, 6); zz(8, 0, 4)
finish('nekodaidokoronemuru')
