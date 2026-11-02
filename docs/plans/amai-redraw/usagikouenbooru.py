# こうえんで うさぎが ボールで あそぶ（usagikouenbooru・段 L）
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
# ---- しばふ（ななめ上から見た島。前の面＝土）
lawn = ell(32, 41, 30.5, 4.6)
fill(lawn, 'G')
fill({(x, y) for x, y in lawn if (x * 7 + y * 3) % 11 == 0}, 'K')
front = {(x, y + 1) for x, y in lawn if (x, y + 1) not in lawn}
fill(front, 'C')
fill({(x, y + 1) for x, y in lawn | front if (x, y + 1) not in lawn | front}, 'K')
fill(edge(lawn) & {(x, y) for x, y in lawn if x < 3 or x > 60}, 'K')
for x in range(2, 62, 3):                                              # 奥のふちの草
    ys = [y for (xx, y) in lawn if xx == x]
    if ys: put(x, min(ys) - 1, 'G'); put(x, min(ys) - 2, 'K')
# ---- ベンチ（左奥、ななめから）
back = poly([(0, 21), (19, 24.5), (19, 29.5), (0, 26)])                # 背もたれ
seat = poly([(0, 31), (16, 34), (22, 31.5), (5, 28.5)])                # 座面
fill(line(1, 31, 1, 37) | line(15, 34, 15, 39) | line(21, 32, 21, 36), 'K')   # 脚
fill(back, 'C')
fill({(x, y) for x, y in back if abs(y - 23.5 - x * 3.5 / 19) < 0.5}, 'K')   # 板のすきま
fill({(x, y) for x, y in back if abs(y - 21.5 - x * 3.5 / 19) < 0.5 and x % 3 == 0}, 'R')  # 木目
fill(edge(back), 'K')
fill(seat, 'C'); fill({(x, y) for x, y in seat if (x, y - 1) not in seat}, 'R')
fill({(x, y) for x, y in seat if (x, y + 1) not in seat}, 'K')
fill(edge(seat), 'K')
fill(line(4, 26, 4, 30) | line(17, 29, 17, 33), 'K')                  # 柱
# ---- ボール（右手前。ころがる）
fill({(x, y) for x, y in ell(50, 43.5, 7, 1.3) if get(x, y) == 'G'}, 'K')
ball = ell(49, 36.5, 6.8, 6.8)
fill(ball, 'R')
fill({(x, y) for x, y in ball if abs((y - 36.5) - 0.6 * (x - 49)) < 1.5}, 'W')   # ななめの帯
fill({(45, 32), (46, 32), (45, 33)}, 'W')
fill(edge(ball), 'K')
for a, b in (((57, 33), (60, 33)), ((57, 37), (61, 37)), ((56, 41), (59, 41))):
    fill(line(a[0], a[1], b[0], b[1]), 'K')                              # 動きの線
# ---- うさぎ（立って ボールを おす。少し右むき）
fill({(x, y) for x, y in ell(29, 44.5, 10, 1.3) if get(x, y) == 'G'}, 'K')
body = ell(29, 34, 8.5, 9)
shape(body, 'W', sh='S')
tailb = ell(20.5, 37, 2.4, 2.4)
shape(tailb, 'W')
for cx in (25, 33):                                                    # 足
    f = ell(cx, 43.5, 4, 1.8)
    shape(f, 'W'); put(cx + 2, 43, 'S')
armB = line(22, 29, 19, 33, 1.3)                                       # 奥のうで（ばんざい）
shape(armB, 'W', sh='S')
earB = ell(33, 6, 2.8, 7.5, ang=22)
shape(earB, 'W', sh='S'); fill(ell(33, 6.5, 1.1, 5.3, ang=22), 'P')
earF = ell(25, 5.5, 3, 8, ang=-6)
shape(earF, 'W', sh='S'); fill(ell(25, 6, 1.3, 5.8, ang=-6), 'P')
head = ell(29, 19, 9.5, 8)
shape(head, 'W', sh='S')
for ex, ey in ((25, 17), (33, 17)):                                    # 目（にっこり）
    fill(line(ex - 1, ey, ex, ey - 1) | line(ex, ey - 1, ex + 1, ey), 'K')
fill({(28, 20), (29, 20), (30, 20), (29, 21)}, 'P')                    # 鼻
mouth = {(28, 22), (29, 22), (30, 22), (28, 23), (29, 23), (30, 23)}
fill(mouth, 'R'); fill({(27, 22), (31, 22), (28, 24), (29, 24), (30, 24)}, 'K')
fill(ell(22.5, 20.5, 2, 1.1) | ell(35.5, 20.5, 2, 1.1), 'P')           # ほっぺ
arm = line(35, 29, 42, 33, 1.3)                                        # 手前のうで（ボールを おす）
shape(arm, 'W', sh='S')
paw = ell(43, 33.5, 2.2, 2)
shape(paw, 'W'); put(43, 34, 'S')
finish('usagikouenbooru', holec='G')
