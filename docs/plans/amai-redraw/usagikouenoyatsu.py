# こうえんで うさぎが おやつを たべる（usagikouenoyatsu・段 L）
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
lawn = ell(32.5, 40.5, 28, 4.6)
fill(lawn, 'G')
fill({(x, y) for x, y in lawn if (x * 7 + y * 3) % 11 == 0}, 'K')
front = {(x, y + 1) for x, y in lawn if (x, y + 1) not in lawn}
fill(front, 'C')
fill({(x, y + 1) for x, y in lawn | front if (x, y + 1) not in lawn | front}, 'K')
fill(edge(lawn) & {(x, y) for x, y in lawn if x < 3 or x > 60}, 'K')
for x in range(2, 62, 3):                                              # 奥のふちの草
    ys = [y for (xx, y) in lawn if xx == x]
    if ys: put(x, min(ys) - 1, 'G'); put(x, min(ys) - 2, 'K')
# ---- 木（右奥）
trunk = poly([(51, 14), (55, 14), (55.5, 34), (58, 37.5), (48, 37.5), (50.5, 34)])
shape(trunk, 'C')
fill({(x, y) for x, y in trunk - edge(trunk) if x == 54 or (x == 52 and y % 6 == 0)}, 'K')
leaves = ell(53, 9, 9, 7) | ell(46, 13, 4.5, 4) | ell(60, 13.5, 4.5, 4)
shape(leaves, 'G')
fill({(x, y) for x, y in leaves - edge(leaves) if (x * 5 + y * 3) % 9 == 0 and y > 8}, 'K')
fill({(x, y) for x, y in leaves - edge(leaves) if (x, y + 2) not in leaves and (x + y) % 2 == 0}, 'K')
fill({(x, y) for x, y in ell(58, 38, 7, 1.3) if get(x, y) == 'G' and (x + y) % 2 == 0}, 'K')
# ---- うさぎ（すわって にんじんを かじる。少し左むき）
fill({(x, y) for x, y in ell(29, 44, 13, 1.5) if get(x, y) == 'G'}, 'K')   # かげ
body = ell(29, 34, 10.5, 9.5)
shape(body, 'W', sh='S')
tailb = ell(39.5, 39, 2.6, 2.4)
shape(tailb, 'W')
thigh = ell(34, 38, 5, 4.5)
shape(thigh, 'W', sh='S')
for cx in (22, 34):                                                    # 足
    f = ell(cx, 43.2, 4.6, 1.8)
    shape(f, 'W'); fill({(cx - 3, 43), (cx - 1, 43)}, 'S')
# 耳（片方はぴんと、片方は少したおれる）
earB = ell(30.5, 6, 2.8, 7.5, ang=18)
shape(earB, 'W', sh='S'); fill(ell(30.5, 6.5, 1.1, 5.3, ang=18), 'P')
earF = ell(22.5, 5.5, 3, 8, ang=-8)
shape(earF, 'W', sh='S'); fill(ell(22.5, 6, 1.3, 5.8, ang=-8), 'P')
head = ell(25, 19, 10, 8.5)
shape(head, 'W', sh='S')
for ex, ey in ((19, 17), (28, 17)):                                    # 目
    fill(ell(ex, ey, 1.3, 1.8), 'K'); put(ex, ey - 1, 'W')
fill({(23, 20), (24, 20), (25, 20), (24, 21)}, 'P')                    # 鼻
fill({(24, 22), (23, 23), (25, 23)}, 'K')                              # 口
fill(ell(16.5, 21, 2, 1.1) | ell(31, 21, 2, 1.1), 'P')                 # ほっぺ
# ---- にんじん（両手で持って 先を かじる）
leaf = ell(4.5, 24.5, 1.8, 4.2, ang=70) | ell(4.5, 30.5, 1.8, 4.2, ang=110) | ell(3.5, 27.5, 1.6, 4, ang=90)
shape(leaf, 'G')
fill(line(9, 27.5, 4, 27.5) | line(9, 27, 6, 25), 'K')
car = poly([(25, 22.5), (10.5, 33), (8, 23.5)])
fill(car, 'O')
fill({(x, y) for x, y in car if (x + y) % 4 == 0 and (x - y) % 3 == 0}, 'C')
fill(edge(car), 'K')
for cx, cy in ((20.5, 28.5), (17, 22.5)):                              # 前足（にんじんをはさむ）
    p = ell(cx, cy, 2.2, 2.0)
    shape(p, 'W'); put(int(cx), int(cy) + 1, 'S')
finish('usagikouenoyatsu', holec='G')
