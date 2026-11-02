# ゆきやまで いぬが ボールで あそぶ（inuyukiyamabooru・段 L）
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
# ---- やま（左奥。雪をかぶった山）
mt = poly([(-1, 37), (-1, 22), (4, 13), (7, 16), (11, 9), (23, 37)])
fill(mt, 'S')
fill({(x, y) for x, y in mt if x >= 13 and y > 18 and (x - y) % 4 == 0}, 'W')
cap = poly([(1, 18), (4, 13), (7, 16), (11, 9), (15, 18), (12.5, 16.5), (10, 18.5), (7.5, 17), (4.5, 19.5)])
fill(cap, 'W')
fill(edge(mt) - {(x, y) for x, y in mt if y > 34}, 'K')
# ---- もみの木（山の手前）
tree = set()
for (top, half, y1) in ((14, 3, 20), (18, 4.5, 26), (22, 6, 32)):
    tree |= poly([(8, top), (8 + half, y1), (8 - half, y1)])
trunk = rect(7, 32, 9, 37)
shape(trunk, 'C')
shape(tree, 'G')
for (y1, half) in ((19, 2), (25, 3.5), (31, 5)):
    fill({(x, y1) for x in range(int(8 - half), int(8 + half) + 1) if x % 2 == 0} & tree, 'W')
fill({(x, y) for x, y in tree - edge(tree) if x > 9 and (x + y) % 2 == 0}, 'K')
# ---- 雪の地面
snow = ell(32, 40.5, 30.5, 4.6)
fill(snow, 'W')
fill({(x, y) for x, y in snow if (x * 5 + y * 7) % 13 == 0}, 'S')
fill({(x, y) for x, y in snow if (x, y + 1) not in snow or (x, y + 2) not in snow}, 'S')
fill(edge(snow) & {(x, y) for x, y in snow if y >= 40 or x < 5 or x > 58}, 'K')
# ---- ボール（右手前。はずむ）
fill({(x, y) for x, y in ell(56, 43.5, 5, 1.1) if get(x, y) in 'WS'}, 'S')
ball = ell(56.5, 36, 4.8, 4.8)
fill(ball, 'R')
fill({(x, y) for x, y in ball if abs((y - 36) + 0.7 * (x - 56.5)) < 1.3}, 'W')
fill({(54, 33), (55, 33), (54, 34)}, 'W')
fill(edge(ball), 'K')
for a, b in (((61, 31), (63, 29)), ((62, 35), (63, 35))):
    fill(line(a[0], a[1], b[0], b[1]), 'K')
# ---- いぬ（白い体・ちゃいろの ぶちと たれ耳・あかい首輪。ボールを おいかける。右むき）
fill({(x, y) for x, y in ell(28, 43.3, 14, 1.4) if get(x, y) in 'WS'}, 'S')
tail = ell(17.5, 21, 2, 4.5, ang=-35)
shape(tail, 'W', sh='S', d=1); fill(ell(16, 18.5, 1.2, 1.7, ang=-35) - edge(tail), 'C')
def leg(a, b, far):
    m = line(a[0], a[1], b[0], b[1], 1.5)
    shape(m, 'W', sh='S' if far else None, d=2 if far else 1)
    shape(ell(b[0] + 0.5, b[1] + 0.3, 2.3, 1.6), 'W')
leg((20, 31), (14, 40), True)                                          # 奥の後ろ足
leg((35, 31), (41, 39), True)                                          # 奥の前足
body = ell(28, 27.5, 12, 6.8, ang=-6)
shape(body, 'W', sh='S', d=1)
fill(ell(25, 24, 5, 2.8) - edge(body), 'C')                            # せなかの ぶち
fill(ell(19.5, 29, 2.2, 2.4) - edge(body), 'C')
leg((22, 32), (21, 42), False)                                          # 手前の後ろ足
leg((33, 32), (31, 42), False)                                          # 手前の前足
head = ell(40.5, 18, 7.5, 6.6)
shape(head, 'W', sh='S', d=1)
fill(ell(42.5, 15, 2.6, 2.4) - edge(head), 'C')                         # 目のまわりの ぶち
snout = ell(46.5, 20, 4.5, 3.2)
shape(snout, 'W')
fill(rect(49, 17, 51, 18) | {(50, 19)}, 'K'); put(49, 17, 'W')         # 鼻
mouth = poly([(43.5, 21.5), (49, 21.5), (47.5, 25), (45, 24.5)])
fill(mouth, 'R'); fill(edge(mouth), 'K'); fill({(46, 24), (46, 23)}, 'R')
fill(ell(42.5, 15.5, 1.3, 1.7), 'K'); put(42, 15, 'W')                 # 目
collar = line(34.5, 19, 36, 26, 0.8) - head                            # 首輪
fill(collar, 'R'); fill(ring(collar) - head, 'K')
ear = poly([(34.5, 12.5), (38.5, 12), (37, 22.5), (33.3, 20.5)])       # たれ耳
shape(ear, 'C')
finish('inuyukiyamabooru', holec='S')
