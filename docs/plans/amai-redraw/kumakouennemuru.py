# こうえんで くまが ねむる（kumakouennemuru・段 L）
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
lawn = ell(32, 41.3, 27.5, 4.2)
fill(lawn, 'G')
fill({(x, y) for x, y in lawn if (x * 7 + y * 3) % 11 == 0}, 'Y')
front = {(x, y + 1) for x, y in lawn if (x, y + 1) not in lawn}
fill(front, 'C')
fill({(x, y + 1) for x, y in lawn | front if (x, y + 1) not in lawn | front}, 'K')
fill(edge(lawn) & {(x, y) for x, y in lawn if x < 5 or x > 58}, 'K')
for x in range(4, 61, 3):                                              # 奥のふちの草
    ys = [y for (xx, y) in lawn if xx == x]
    if ys: put(x, min(ys) - 1, 'G'); put(x, min(ys) - 2, 'K')
# ---- 木（左。くまが もたれる）
trunk = poly([(12, 10), (19, 10), (19.5, 34), (23, 39), (7, 39), (11.5, 34)])
shape(trunk, 'C')
for bx in (13, 16):
    fill({(bx + (y // 5) % 2, y) for y in range(12, 37) if y % 5 != 0} & trunk, 'K')   # 木の皮
leaves = ell(15, 6, 11, 5.5) | ell(6, 9, 4.2, 3.2) | ell(24.5, 9, 4.2, 3.2)
shape(leaves, 'G')
fill({(x, y) for x, y in leaves - edge(leaves) if (x * 5 + y * 3) % 9 == 0 and y < 7}, 'Y')
fill({(x, y) for x, y in leaves - edge(leaves) if (x, y + 2) not in leaves and (x + y) % 2 == 0}, 'K')
# ---- くま（木に もたれて すわって ねむる）
fill({(x, y) for x, y in ell(31, 42, 15, 1.5) if get(x, y) in 'GY'}, 'K')   # かげ
body = ell(29, 32, 11, 9)
shape(body, 'C', hi='O', d=1)
belly = ell(29.5, 33.5, 6.5, 5.5)
fill(belly, 'O'); fill({(x, y) for x, y in belly if (x - 1, y - 1) not in belly}, 'Y')
for cx, cy in ((21.5, 40.5), (39, 40.5)):                              # 足（前へ のばす）
    f = ell(cx, cy, 4.8, 3.2)
    shape(f, 'C'); fill(ell(cx, cy, 2.4, 1.6), 'P')
for cx, ang in ((22.5, 25), (36.5, -25)):                                # うで（おなかの上）
    a = ell(cx, 32.5, 2.3, 4.5, ang=ang)
    shape(a, 'C')
earL = ell(18.5, 8.5, 4.3, 4.3); earR = ell(38, 9.5, 4.3, 4.3)
shape(earL, 'C'); fill(ell(18.5, 8.8, 2.2, 2.2), 'P')
shape(earR, 'C'); fill(ell(38, 9.8, 2.2, 2.2), 'P')
head = ell(28.5, 17.5, 11.5, 9, ang=8)                                 # あたまを 少し かたむける
shape(head, 'C', hi='O', d=1)
mz = ell(29.5, 22.3, 5.8, 4, ang=8)
fill(mz, 'W'); fill(edge(mz), 'K')
fill(rect(28, 20, 31, 20) | {(29, 21), (30, 21)}, 'K')                      # 鼻
fill({(29, 22), (30, 22), (28, 24), (29, 23), (30, 23), (31, 24)}, 'K')                              # 口
for ex, ey in ((22, 16), (34.5, 16.5)):                                    # とじた目（下に ふくらむ弧）
    ex, ey = int(ex), int(ey)
    fill({(ex - 2, ey), (ex - 1, ey + 1), (ex, ey + 1), (ex + 1, ey + 1), (ex + 2, ey)}, 'K')
fill(ell(20.5, 20, 2, 1.2) | ell(37.5, 21.5, 2, 1.2), 'P')               # ほっぺ
# ---- Zz（右上）
z(46, 12, 5); z(53, 6, 4); z(59, 2, 3)
finish('kumakouennemuru', holec='C')
