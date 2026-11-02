# だいどころで いぬが ボールで あそぶ（inudaidokorobooru・段 XL・64x48 以下）。部品で描いて文字の地図 inudaidokorobooru.txt を書き出す。python3 inudaidokorobooru.py
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
HOLE = 'W'
# だいどころで いぬが ボールで あそぶ（あそぼうの ポーズ）。場所の物：まど・テーブル
# 床（板の間・奥へすぼまる目地）
floor = rect(0, 30, 63, 47)
fill(floor, 'Y')
for y in (33, 38, 43):
    fill({(x, y) for x in range(W)}, 'O')
for vx in (-60, -28, 4, 36, 68, 100, 132):
    fill(line(32 + (vx - 32) / 3, 30, vx, 47) & floor, 'O')
fill({(x, 30) for x in range(W)}, 'K')
# まど（左上・外は空と雲）
win = rect(3, 0, 23, 13)
fill(win, 'S')
fill(ell(8, 4, 3, 1.4) | ell(10, 3.5, 2.5, 1.8), 'W')
fill(ell(18, 9, 2.6, 1.3) | ell(20, 8.5, 2.2, 1.6), 'W')
fill(rect(13, 0, 13, 13) | rect(3, 6, 23, 6), 'B')
fill(edge(win), 'K')
sill = rect(1, 14, 25, 15); fill(sill, 'W'); fill({(x, 15) for x in range(1, 26)}, 'S'); fill(edge(sill), 'K')
# テーブル（右奥・ななめ）
fill(rect(60, 22, 61, 34), 'C'); fill(rect(61, 22, 61, 34), 'K')
top = poly([(42, 16), (63, 16), (64, 20), (45, 20)])
shape(top, 'C', hi='O', d=1)
apron = rect(45, 21, 63, 23); shape(apron, 'C'); fill(line(46, 22, 62, 22), 'O')
for lx in (46, 58):
    fill(rect(lx, 24, lx + 1, 37), 'C'); fill(rect(lx + 1, 24, lx + 1, 37), 'K'); fill({(lx - 1, y) for y in range(24, 38)} | {(lx, 38), (lx + 1, 38)}, 'K')
cup = rect(51, 11, 55, 15); shape(cup, 'R', hi='W', d=1); fill({(56, 12), (57, 13), (56, 14)}, 'K')
fill(ell(53, 38.5, 9, 0.9), 'O')
# かげ
fill(ell(25, 44.5, 19, 1.5), 'O')
# いぬ（左むき。前は ふせて、おしりを上げて しっぽを ふる）
tail = line(42, 19, 45, 12, 1.5) | line(45, 12, 44, 8, 1.1)
shape(tail, 'W', sh='S', d=1)
for a, b in (((48, 8), (50, 6)), ((48, 12), (50, 11)), ((40, 8), (40, 6))):
    fill(line(*a, *b), 'K')
legB = line(41, 25, 43, 40, 1.8); shape(legB, 'S')                    # 奥の後ろ足
fill(ell(44, 41, 2.6, 1.6), 'S'); fill(edge(ell(44, 41, 2.6, 1.6)), 'K')
body = ell(31, 26, 13.5, 7.5, -26)
shape(body, 'W', sh='S')
spot = ell(34, 22.5, 5, 3, -26) & body
fill(spot - edge(body), 'C'); fill({(x, y) for x, y in spot - edge(body) if (x - 1, y - 1) not in spot}, 'O')
legF = line(37, 28, 38, 43, 2.0); shape(legF, 'W', sh='S', d=1)       # 手前の後ろ足
f = ell(37, 44, 3.2, 2); shape(f, 'W'); fill({(36, 45), (38, 45)}, 'K')
# まえあし（床に ぺたり）
for y0, c in ((39, 'S'), (41.5, 'W')):
    a = line(24, y0 - 3, 13, y0, 1.8)
    shape(a, c, sh='S' if c == 'W' else None, d=1)
    p = ell(12, y0 + 0.3, 2.8, 2); shape(p, c); fill({(11, int(y0) + 1), (13, int(y0) + 1)}, 'K')
head = ell(19, 29.5, 7.5, 6.5)
snout = ell(12, 32.5, 4.8, 3.2)
shape(head | snout, 'W', sh='S')
collar = line(25, 27, 26, 35, 0.9) & (body | head)
fill(collar, 'R'); fill({(25, 36), (26, 36), (25, 37), (26, 37)}, 'Y'); fill(edge({(25, 36), (26, 36), (25, 37), (26, 37)} | {(25, 38), (26, 38)}) - {(25, 36), (26, 36)}, 'K'); fill({(25, 37), (26, 37)}, 'Y')
nose = ell(8, 31, 1.8, 1.5); fill(nose, 'K'); put(8, 30, 'W')
fill({(9, 34), (10, 34), (11, 34), (12, 34), (13, 34), (14, 33)}, 'K')     # 口
fill({(10, 35), (11, 35), (12, 35), (11, 36)}, 'R'); fill({(9, 35), (10, 36), (11, 37), (12, 36), (13, 35)}, 'K')
fill(rect(15, 26, 16, 28), 'K'); put(15, 26, 'W')                           # 目
fill({(13, 24), (14, 23), (15, 23), (16, 23)}, 'K')                         # まゆ（わくわく）
ear = poly([(21, 23), (26, 23), (26.5, 31), (24, 34), (21.5, 30)])
shape(ear, 'C'); fill({(23, 25), (23, 26), (22, 27)}, 'O')
fill(ell(18, 33.5, 1.6, 0.9), 'S')
# ボール（左手前。あかと しろ）
ball = ell(5, 41.5, 4.8, 4.8)
shape(ball, 'R', hi='W', d=1)
fill({(x, y) for x, y in ball if 41 <= y <= 42 and (x, y) not in edge(ball)}, 'W')
fill(edge(ball), 'K')
fill(ell(6, 46.5, 4, 0.9), 'O')
for a, b in (((1, 34), (2, 33)), ((5, 33), (5, 32)), ((9, 34), (10, 33))):   # はねる線
    fill(line(*a, *b), 'K')
# テーブルの下（奥のかべ）は かげの色で うめる
fill({(x, y) for x, y in rect(48, 24, 57, 29) if g[y][x] == '.'}, 'O')
fill({(x, y) for x, y in rect(48, 24, 57, 29) if (x + y) % 3 == 0}, 'C')
finish('inudaidokorobooru')
