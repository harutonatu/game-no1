# だいどころで ねこが ボールで あそぶ（nekodaidokorobooru・段 L）
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
# ---- 床（タイル。奥へすぼまる）
floor = poly([(4, 39), (60, 39), (64, 47), (0, 47)])
fill(floor, 'W')
for x, y in floor:
    u = int((x - 32) / (1 + (y - 39) * 0.06) + 64) // 6
    v = (y - 39) // 3
    if (u + v) % 2 == 0: put(x, y, 'S')
fill(edge(floor), 'K')
# ---- 戸だな（左奥。上に なべ）
cab = poly([(1, 20), (16, 20), (20, 23), (20, 39), (1, 39)])
fill(cab, 'C')
top = poly([(1, 20), (16, 20), (20, 23), (5, 23)])
fill(top, 'W')
fill(rect(5, 24, 5, 39), 'K')                                          # 戸のさかい
fill(rect(6, 24, 20, 39) & {(x, y) for x in range(W) for y in range(H) if x == 13}, 'K')
fill({(11, 30), (11, 31), (15, 30), (15, 31)}, 'Y')                    # とって
fill({(x, y) for x, y in cab if x in (1, 2) and y > 23}, 'K')
fill(edge(cab) | line(5, 23, 20, 23), 'K')
pot = rect(4, 14, 16, 20) | ell(10, 20, 6, 1.2)
fill(pot, 'S'); fill(rect(6, 15, 7, 19), 'W'); fill(rect(14, 15, 15, 20), 'K')
fill(edge(pot), 'K'); fill({(2, 15), (3, 15), (2, 16), (17, 15), (18, 15), (18, 16)}, 'K')   # とって
lid = ell(10, 13.5, 7, 1.8)
fill(lid, 'S'); fill({(x, y) for x, y in lid if y < 13}, 'W'); fill(edge(lid), 'K'); fill(rect(9, 10, 11, 11), 'K')
for sx in (8, 12):                                                     # ゆげ
    fill(line(sx, 8, sx + 1, 6) | line(sx + 1, 6, sx, 4), 'S')
# ---- ボール（ねこの上）
ball = ell(52, 8, 4.8, 4.8)
fill(ball, 'R')
fill({(x, y) for x, y in ball if abs((y - 8) + 0.6 * (x - 52)) < 1.3}, 'W')
fill({(50, 5), (51, 5), (50, 6)}, 'W')
fill(edge(ball), 'K')
for a, b in (((58, 4), (60, 3)), ((58, 9), (61, 9)), ((46, 2), (45, 1))):
    fill(line(a[0], a[1], b[0], b[1]), 'K')
# ---- ねこ（立ち上がって ボールを たたく）
fill({(x, y) for x, y in ell(39, 45, 12, 1.3) if get(x, y) in 'WS'}, 'K')
tail = line(46, 42, 54, 40, 1) | line(54, 40, 57, 35, 1) | line(57, 35, 56, 31, 1)
shape(tail, 'O')
fill({(50, 41), (55, 37), (57, 33)}, 'C')
body = ell(39, 34, 8.5, 9)
shape(body, 'O', sh='C', hi='Y', d=2)
fill(ell(37.5, 35, 4, 6), 'W')                                         # おなか
for k in range(3):                                                     # しま
    fill(line(46, 29 + k * 4, 44, 30 + k * 4), 'C')
for cx in (33, 44):                                                    # 足
    f = ell(cx, 43.5, 3.6, 2)
    shape(f, 'W')
armB = line(32, 29, 28, 24, 1.2)                                       # 奥のうで
shape(armB, 'O', sh='C', d=1)
shape(ell(27.5, 23.5, 1.8, 1.7), 'W')
head = ell(40, 20, 8, 6.8)
shape(head, 'O', sh='C', hi='Y', d=2)
earL = poly([(32.8, 18), (33.5, 9.5), (38.5, 14)])
earR = poly([(43, 13.5), (48, 10), (47.5, 18)])
for e in (earL, earR):
    fill(e, 'O'); fill(edge(e) - head, 'K')
fill(poly([(34.5, 15.5), (34.8, 12), (37, 14.3)]) | poly([(44.5, 14), (46.8, 12.3), (46.5, 16)]), 'R')
for x0 in (39, 41):
    fill(line(x0, 14, x0, 16), 'C')                                    # ひたいの しま
fill(ell(40, 24, 4, 2.2), 'W')                                         # 口まわり
for ex in (36, 44):                                                    # 目（上の ボールを 見る）
    fill(rect(ex, 19, ex + 1, 21), 'K'); put(ex + 1, 19, 'W')
fill({(39, 22), (40, 22), (41, 22)}, 'R'); fill({(40, 23)}, 'K')       # 鼻
fill({(39, 25), (41, 25)}, 'K')
fill(edge(head) - earL - earR, 'K')
for a, b in (((30, 23), (27, 22)), ((30, 25), (27, 26)), ((50, 23), (53, 22)), ((50, 25), (53, 26))):
    fill(line(a[0], a[1], b[0], b[1]), 'K')                            # ひげ
arm = line(46, 28, 50, 16, 1.9)                                        # 手前のうで（ボールを たたく）
shape(arm, 'O', hi='Y', d=2)
paw = ell(50.5, 14, 2.6, 2.3)
shape(paw, 'W')
finish('nekodaidokorobooru', holec='W')
