# ゆきやまで くまが おやつを たべる（kumayukiyamaoyatsu・段 L）
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
canvas(64, 46)
# ---- やま（右奥。雪をかぶった山）
mt = poly([(48.5, 38), (55, 12), (58, 16), (60, 14), (64, 22), (64, 38)])
fill(mt, 'S')
fill({(x, y) for x, y in mt if x >= 58 and y > 16 and (x - y) % 4 == 0}, 'W')   # 雪のすじ
cap = poly([(51.5, 22), (55, 12), (58, 16), (60, 14), (64, 21), (61, 20), (58, 23), (55, 19.5), (53.5, 23)])
fill(cap, 'W')
fill(edge(mt) - {(x, y) for x, y in mt if y > 35}, 'K')
# ---- 雪の地面（ななめ上から見た雪原）
snow = ell(31, 40.8, 27, 3.6)
fill(snow, 'W')
fill({(x, y) for x, y in snow if (x * 5 + y * 7) % 13 == 0}, 'S')
fill({(x, y) for x, y in snow if (x, y + 1) not in snow or (x, y + 2) not in snow}, 'S')
fill(edge(snow) & {(x, y) for x, y in snow if y >= 40 or x < 5 or x > 58}, 'K')
# ---- もみの木（左奥）
tree = set()
for (top, half, y1) in ((10, 3.5, 17), (14, 5.5, 23), (19, 7.5, 31)):
    tree |= poly([(7, top), (7 + half, y1), (7 - half, y1)])
trunk = rect(5, 31, 8, 37)
shape(trunk, 'C')
shape(tree, 'G')
for (y1, half) in ((16, 2.5), (22, 4.5), (30, 6.5)):
    fill({(x, y1) for x in range(int(7 - half), int(7 + half) + 1) if x % 2 == 0} & tree, 'W')  # 葉に積もった雪
fill({(x, y) for x, y in tree - edge(tree) if x > 8 and (x + y) % 2 == 0}, 'K')
fill({(x, y) for x, y in ell(10, 37, 5, 1.1) if get(x, y) in 'WS'}, 'S')
# ---- くま（すわって だんごを たべる。少し右むき）
fill({(x, y) for x, y in ell(28, 43.5, 14, 1.4) if get(x, y) in 'WS'}, 'S')
body = ell(27, 33, 11, 9.5)
shape(body, 'C', hi='O', d=1)
belly = ell(28.5, 35, 6, 6)
fill(belly, 'O'); fill({(x, y) for x, y in belly if (x + 1, y + 1) not in belly}, 'C')
for cx, cy in ((19, 42), (33, 42.5)):
    f = ell(cx, cy, 4.5, 2.8)
    shape(f, 'C'); fill(ell(cx, cy, 2.2, 1.3), 'P')
armL = poly([(18, 28), (14.5, 33), (16, 37), (21, 32)])                  # 奥のうで
shape(armL, 'C')
# マフラー
scarf = ell(27, 24.5, 10, 2.8) | poly([(21, 25), (25, 25), (24.5, 34), (20.5, 33)])
fill(scarf, 'P')
fill({(x, y) for x, y in scarf if x % 3 == 0}, 'W')
fill(edge(scarf), 'K')
earL = ell(17, 6, 4, 4); earR = ell(35, 5.5, 4, 4)
shape(earL, 'C'); fill(ell(17, 6.5, 2, 2), 'P')
shape(earR, 'C'); fill(ell(35, 6, 2, 2), 'P')
head = ell(26, 14.5, 11, 9)
shape(head, 'C', hi='O', d=1)
mz = ell(30, 18.5, 5, 3.8)
fill(mz, 'W'); fill({(x, y) for x, y in mz if (x, y + 1) not in mz}, 'S'); fill(edge(mz), 'K')
fill(rect(29, 15, 32, 16) | rect(30, 17, 31, 17), 'K'); put(29, 15, 'W')   # 鼻
fill(rect(31, 19, 33, 20), 'P'); fill({(30, 19), (30, 20), (34, 19), (34, 20), (31, 21), (32, 21), (33, 21)}, 'K')  # あけた口
for ex, ey, rx in ((21, 12, 1.5), (32, 11, 1.7)):
    fill(ell(ex, ey, rx, 2.1), 'K'); put(ex, ey - 1, 'W')
fill(ell(21, 17.5, 2, 1.1), 'P')
# ---- だんご（顔の右で くしを持つ。上の玉をかじる）
fill(line(41, 29, 41, 7), 'C')                                         # くし
for c, cy in (('G', 23.5), ('W', 17.8), ('P', 12.1)):
    b = ell(41, cy, 3.3, 2.9)
    shape(b, c)
    put(40, int(cy) - 1, 'W' if c != 'W' else 'S')
fill({(38, 12), (38, 13), (39, 12)}, '.')                                         # かじったあと
# ---- 手前のうで（だんごを持つ）
arm = poly([(31, 31), (35, 27), (38, 26), (40, 29), (36, 33), (33, 36)])
shape(arm, 'C')
fill({(x, y) for x, y in arm - edge(arm) if (x - 1, y - 1) not in arm - edge(arm)}, 'O')
paw = ell(40, 28, 2.8, 2.5)
shape(paw, 'C'); fill({(39, 27), (40, 27)}, 'O')
finish('kumayukiyamaoyatsu', holec='W')
