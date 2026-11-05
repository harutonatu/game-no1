# だいどころで くまが ねむる（kumadaidokoronemuru・段 L）
# 部品（楕円・多角形・線・ふちどり）で描いて、文字の地図 <id>.txt を書き出す（見本 kumadaidokorooyatsu.py と同じ作り方）
import os, math, sys
g = None
W = H = 0

def canvas(w, h):
    global g, W, H
    W, H = w, h
    g = [['.'] * W for _ in range(H)]

def put(x, y, c):
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = c

def get(x, y):
    return g[y][x] if 0 <= x < W and 0 <= y < H else '.'

def ell(cx, cy, rx, ry, ang=0):
    a = math.radians(ang); ca, sa = math.cos(a), math.sin(a)
    s = set()
    for y in range(H):
        for x in range(W):
            dx, dy = x - cx, y - cy
            u = (dx * ca + dy * sa) / rx; v = (-dx * sa + dy * ca) / ry
            if u * u + v * v <= 1.0:
                s.add((x, y))
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
                if (ay > py) != (by > py) and px < ax + (py - ay) * (bx - ax) / (by - ay):
                    ins = not ins
            if ins: s.add((x, y))
    return s

def line(x0, y0, x1, y1, w=0):
    s = set(); n = int(max(abs(x1 - x0), abs(y1 - y0), 1) * 2)
    r = int(math.ceil(w))
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n; y = y0 + (y1 - y0) * i / n
        for oy in range(-r, r + 1):
            for ox in range(-r, r + 1):
                if ox * ox + oy * oy <= w * w + .01:
                    s.add((int(round(x + ox)), int(round(y + oy))))
    return {(x, y) for x, y in s if 0 <= x < W and 0 <= y < H}

def fill(m, c):
    for x, y in m: put(x, y, c)

def edge(m):
    return {(x, y) for x, y in m if any((x + dx, y + dy) not in m
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}

def ring(m):
    """m のすぐ外がわ 1 マス"""
    return {(x + dx, y + dy) for x, y in m for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            if (x + dx, y + dy) not in m and 0 <= x + dx < W and 0 <= y + dy < H}

def shape(m, c, o='K', sh=None, hi=None, d=2):
    """塗って、かげ（右下）・明るい所（左上）を付けて、ふちどり。"""
    fill(m, c)
    if sh:
        fill({(x, y) for x, y in m if (x + d, y) not in m or (x, y + d) not in m}, sh)
    if hi:
        fill({(x, y) for x, y in m if ((x - d, y) not in m or (x, y - d) not in m)
              and (x + d, y) in m and (x, y + d) in m}, hi)
    if o:
        fill(edge(m), o)

def dither(m, c, k=2):
    fill({(x, y) for x, y in m if (x + y) % k == 0}, c)

def z(x, y, n, c='K'):
    fill(line(x, y, x + n, y) | line(x + n, y, x, y + n) | line(x, y + n, x + n, y + n), c)

def finish(name, holec='K'):
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
            if g[y][x] == '.' and (x, y) not in out:
                g[y][x] = holec; n += 1
    rows = [''.join(r) for r in g]
    while rows and set(rows[0]) == {'.'}: rows.pop(0)
    while rows and set(rows[-1]) == {'.'}: rows.pop()
    while rows and all(r[0] == '.' for r in rows): rows = [r[1:] for r in rows]
    while rows and all(r[-1] == '.' for r in rows): rows = [r[:-1] for r in rows]
    here = os.path.dirname(os.path.abspath(__file__))
    open(os.path.join(here, name + '.txt'), 'w').write('\n'.join(rows) + '\n')
    print(name, 'holes', n, 'size', len(rows[0]), 'x', len(rows), 'sugar', sum(c != '.' for r in rows for c in r))

# ================= 絵 =================
canvas(64, 48)
# ---- 床（板の間・奥へすぼまる目地）
floor = poly([(6, 42), (60, 42), (63, 47), (2, 47)])
fill(floor, 'Y')
for vx in (-40, -8, 24, 56, 88):
    fill(line(32 + (vx - 32) // 3, 42, vx, 47) & floor, 'O')
fill(edge(floor), 'K')
# ---- まど（右上。夜の空と おつきさま）
win = rect(49, 1, 62, 12)
fill(win, 'S')
moon = ell(58.5, 4.5, 2.6, 2.6) - ell(60, 3.5, 2.2, 2.2)
fill(moon, 'Y')
for sx, sy in ((52, 4), (59, 10), (52, 10)):
    fill({(sx, sy), (sx - 1, sy), (sx + 1, sy), (sx, sy - 1), (sx, sy + 1)}, 'W')
fill(rect(55, 1, 55, 12) | rect(49, 7, 62, 7), 'W')                     # まどわく
fill(edge(win), 'K')
# ---- くま（すわって、テーブルに あたまを のせて ねむる）
fill({(x, y) for x, y in ell(16, 46, 12, 1) if get(x, y) in 'YO'}, 'O')
body = ell(18.5, 35, 10, 9) | ell(21, 27, 8, 6)   # かた（頭を 体に 重ねて つなぐ）
shape(body, 'C', hi='O', d=1)
for cx, cy in ((9, 44), (21, 44.5)):
    f = ell(cx, cy, 4.3, 2.6)
    shape(f, 'C'); fill(ell(cx, cy, 2, 1.2), 'P')
# ---- テーブル（右。ななめ・テーブルかけ）
fill(rect(57, 33, 58, 43), 'C'); fill(rect(58, 33, 58, 43), 'K')       # 奥の脚
ttop = poly([(24, 27), (56, 27), (61, 32), (28, 32)])
fill(ttop, 'W')
for x, y in ttop:
    u = (x - 24 - (y - 27) * 4 / 5) // 3
    v = (y - 27) // 2
    if (u + v) % 2 == 0: put(x, y, 'P')
skirt = rect(28, 33, 61, 36)
fill(skirt, 'P'); fill({(x, y) for x, y in skirt if (x // 3) % 2 == 0}, 'W')
side = poly([(24, 27), (28, 32), (28, 37), (24, 32)])
fill(side, 'P')
fill(edge(ttop | skirt | side), 'K'); fill(line(28, 32, 61, 32), 'K')
for lx in (30, 54):
    fill(rect(lx, 37, lx + 1, 44), 'C'); fill(rect(lx + 1, 37, lx + 1, 44), 'K')
# ---- テーブルの上の うでと あたま
arms = ell(38, 28, 8.5, 2.4)
shape(arms, 'C', hi='O', d=1)
fill(line(38, 28, 43, 28), 'K')
paw = ell(46.5, 28, 2.5, 2.1)
shape(paw, 'C'); fill({(46, 27), (47, 27)}, 'O')
earL = ell(24.5, 13, 3.8, 3.8); earR = ell(41.5, 17, 3.8, 3.8)
shape(earL, 'C'); fill(ell(24.5, 13.3, 1.9, 1.9), 'P')
shape(earR, 'C'); fill(ell(41.5, 17.3, 1.9, 1.9), 'P')
head = ell(32, 20.5, 10.5, 8, ang=18)
shape(head, 'C', hi='O', d=1)
mz = ell(33.5, 24.5, 4.3, 3)
fill(mz, 'W'); fill(edge(mz), 'K')
fill(rect(32, 22, 35, 23), 'K'); put(32, 22, 'W')                       # 鼻
fill({(33, 25), (33, 26), (32, 26), (34, 26)}, 'K')                     # 口
for ex, ey in ((26, 18), (40, 20)):                                   # とじた目
    ey = int(ey)
    fill({(ex - 2, ey), (ex - 1, ey + 1), (ex, ey + 1), (ex + 1, ey + 1), (ex + 2, ey + 1)}, 'K')
fill(ell(25.5, 22, 1.8, 1.1), 'P')
# ---- Zz（あたまの左上）
z(5, 3, 5); z(13, 8, 4); z(19, 3, 3)
finish('kumadaidokoronemuru', holec='O')
