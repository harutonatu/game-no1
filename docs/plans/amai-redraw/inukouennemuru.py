# こうえんで いぬが ねむる（inukouennemuru・段 M）
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
canvas(46, 33)
# ---- しばふ（ななめ上から見た島。上の面＝草、前の面＝土）
lawn = ell(22, 26.5, 21.5, 4.6)
fill(lawn, 'G')
fill({(x, y) for x, y in lawn if (x * 7 + y * 3) % 9 == 0}, 'K')
front = {(x, y + d) for x, y in lawn if (x, y + 1) not in lawn for d in (1, 2) if abs(x - 22) < 18 or d == 1}
fill(front, 'C')
fill(edge(lawn | front) & {(x, y) for x, y in lawn | front if y > 26}, 'K')
fill({(x, y + 1) for x, y in lawn | front if (x, y + 1) not in lawn | front}, 'K')
# ---- 木（右奥）
trunk = poly([(33, 8), (36.5, 8), (37, 24), (39, 26.8), (31, 26.8), (32.5, 24)])
shape(trunk, 'C')
fill({(x, y) for x, y in trunk - edge(trunk) if x == 35 and y % 3 == 0}, 'K')
leaves = ell(35, 5.5, 7.5, 5.5) | ell(29.5, 8, 4, 3.2) | ell(41, 8.5, 3.5, 3.2)
shape(leaves, 'G')
fill({(x, y) for x, y in leaves - edge(leaves) if (x * 5 + y * 3) % 7 == 0 and y < 7}, 'W')
fill({(x, y) for x, y in leaves - edge(leaves) if (x, y + 2) not in leaves and (x + y) % 2 == 0}, 'K')
# ---- いぬ（白い体・ちゃいろの ぶちと たれ耳・あかい首輪。ふせて ねむる。左むき）
fill({(x, y) for x, y in ell(22, 28, 15, 1.4) if get(x, y) == 'G' and (x + y) % 3 != 0}, 'K')   # かげ
tail = ell(38.5, 18, 2.6, 5, ang=30)
shape(tail, 'W'); fill(ell(39.8, 15.2, 1.4, 1.8, ang=30) - edge(tail), 'C')
body = ell(24.5, 21, 12.5, 6.8)
shape(body, 'W')
for sp in (ell(28, 17.5, 3.8, 2.6), ell(34, 21, 2.2, 2)):              # せなかの ぶち
    fill(sp - edge(body), 'C')
hind = ell(31, 23.5, 5, 4)                                            # 後ろ足のもも
shape(hind, 'W')
fill(ell(28, 27.3, 4, 1.2), 'W'); fill(edge(ell(28, 27.3, 4, 1.2)), 'K')   # 後ろ足
paws = ell(10, 26.5, 6, 1.6)                                          # 前足（あごの下）
shape(paws, 'W'); fill({(7, 27), (10, 27), (13, 27)}, 'K')
head = ell(12.5, 17, 7, 6)
shape(head, 'W')
fill(ell(9.5, 14.5, 2.3, 2) - edge(head), 'C')                         # 目のまわりの ぶち
snout = ell(5.5, 20.3, 4.5, 3)
shape(snout, 'W')
fill(rect(1, 18, 3, 19), 'K')                                        # 鼻
fill({(4, 22), (5, 22), (6, 22), (7, 21)}, 'K')                       # 口
collar = line(21, 17, 22, 24.5, 0.6) - head                        # 首輪
fill(collar, 'R'); fill(ring(collar) - head, 'K')
ear = poly([(13, 11.5), (18, 12.5), (20, 20), (17.8, 22.8), (15.3, 19.5)])   # たれた耳
shape(ear, 'C')
fill(line(8, 16, 11, 16), 'K'); put(7, 15, 'K'); put(12, 15, 'K')     # とじた目
# ---- Zz（あたまの上）
z(2, 0, 4); z(9, 3, 3); z(15, 6, 2)
finish('inukouennemuru')
