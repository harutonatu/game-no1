# うみべで いぬが ボールで あそぶ（inuumibebooru・段 L）
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
# ---- うみと すなはま（ななめ上から。奥＝うみ、手前＝すな）
ground = {(x, y) for x, y in ell(32, 30.5, 31, 12.3) if y >= 27}
sea = {(x, y) for x, y in ground if y < 32}
sand = ground - sea
fill(sea, 'S')
fill({(x, y) for x, y in sea if y == 27}, 'B')
fill({(x, y) for x, y in sea if y in (29, 31) and (x // 3 + y) % 4 == 0}, 'B')
fill({(x, y) for x, y in sea if y == 31 or (y == 30 and x % 5 in (0, 1))}, 'W')   # 波うちぎわ
fill(sand, 'Y')
fill({(x, y) for x, y in sand if (x * 7 + y * 5) % 13 == 0}, 'C')
fill(edge(ground) & {(x, y) for x, y in ground if y > 27}, 'K')
fill({(x, y) for x, y in ground if y == 27}, 'K')
# ---- パラソル（左奥）
fill({(x, y) for x, y in ell(13, 41.5, 7, 1.2) if get(x, y) in 'YC' and (x + y) % 2 == 0}, 'C')
pole = line(9.5, 41, 11.5, 9)
fill(pole, 'K')
can = poly([(-1, 13.5), (3, 7), (11, 3.5), (19, 5), (25, 10), (24, 11.5), (19, 10.5), (13, 12), (7, 11), (1, 14.5)])
fill(can, 'W')
for x, y in can:
    a = math.atan2(y - 16, x - 11)
    if int((a + 4) * 4.5) % 2 == 0: put(x, y, 'R')
fill(edge(can), 'K')
fill(line(11, 2, 11, 3), 'K')
# ---- ボール（右上）
ball = ell(54, 7, 5, 5)
fill(ball, 'W')
for x, y in ball:
    a = math.atan2(y - 7, x - 54)
    if int((a + 4) * 0.955) % 2 == 0: put(x, y, 'R')
fill({(52, 4), (51, 5), (52, 5)}, 'W')
fill(edge(ball), 'K')
for a, b in (((60, 13), (62, 15)), ((48, 1), (47, 0)), ((61, 2), (63, 1))):
    fill(line(a[0], a[1], b[0], b[1]), 'K')                              # 動きの線
# ---- いぬ（白い体・ちゃいろの ぶちと たれ耳・あかい首輪。ボールを おって かける。右むき）
fill({(x, y) for x, y in ell(29, 39, 13, 1.3) if get(x, y) in 'YC'}, 'K')   # かげ
tail = ell(16.5, 18, 1.8, 4, ang=-50)
shape(tail, 'W', sh='S', d=1); fill(ell(14.5, 16.3, 1.1, 1.5, ang=-50) - edge(tail), 'C')
def leg(a, b, far):
    m = line(a[0], a[1], b[0], b[1], 1.5)
    shape(m, 'W', sh='S' if far else None, d=2 if far else 1)
    f = ell(b[0] + 0.5, b[1], 2.2, 1.5)
    shape(f, 'W')
leg((20, 26), (13, 35), True)                                          # 奥の後ろ足
leg((36, 26), (41, 35), True)                                          # 奥の前足
body = ell(28, 23, 11.5, 6)
shape(body, 'W', sh='S', d=1)
fill(ell(25, 20, 4.5, 2.6) - edge(body), 'C')                          # せなかの ぶち
fill(ell(32, 24, 2, 1.6) - edge(body), 'C')
leg((22, 27), (21, 37), False)                                          # 手前の後ろ足
leg((34, 27), (32, 37), False)                                          # 手前の前足
head = ell(41, 13.5, 6.5, 6)
shape(head, 'W', sh='S', d=1)
fill(ell(42.5, 10.8, 2.4, 2.2) - edge(head), 'C')                       # 目のまわりの ぶち
snout = ell(47, 15.5, 4.3, 3)
shape(snout, 'W')
fill(rect(50, 13, 51, 14) | {(50, 15)}, 'K'); put(50, 13, 'W')         # 鼻
mouth = poly([(44, 17), (49.5, 17), (48, 20), (45, 19.5)])             # あけた口と した
fill(mouth, 'R'); fill(edge(mouth), 'K'); put(46, 19, 'R')
fill(ell(42.5, 11, 1.2, 1.6), 'K'); put(42, 10, 'W')                   # 目（ボールを 見る）
collar = line(35, 15, 36.5, 21, 0.8) - head                            # 首輪
fill(collar, 'R'); fill(ring(collar) - head, 'K')
ear = poly([(35, 8), (39.5, 8), (38, 18), (34, 16.5)])                  # たれ耳
shape(ear, 'C')
# 足のあいだの 閉じた空き：うみの高さは うみの色、下は すなの色
def inner():
    out = set(); st = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
    st = [p for p in st if g[p[1]][p[0]] == '.']; out = set(st)
    while st:
        x, y = st.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if 0 <= q[0] < W and 0 <= q[1] < H and q not in out and g[q[1]][q[0]] == '.':
                out.add(q); st.append(q)
    return [(x, y) for y in range(H) for x in range(W) if g[y][x] == '.' and (x, y) not in out]
for x, y in inner():
    g[y][x] = 'S' if y < 32 else 'Y'
finish('inuumibebooru', holec='Y')
