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
# だいどころで いぬが ボールで あそぶ（ボールの前で おすわりして しっぽを ふる）。場所の物：まど・テーブル
# 床（板の間・奥へすぼまる目地）
floor = rect(0, 30, 63, 47)
fill(floor, 'Y')
for y in (33, 38, 43):
    fill({(x, y) for x in range(W)}, 'O')
for vx in (-60, -28, 4, 36, 68, 100, 132):
    fill(line(32 + (vx - 32) / 3, 30, vx, 47) & floor, 'O')
fill({(x, 30) for x in range(W)}, 'K')
# まど（左上・外は空と雲）
win = rect(3, 0, 23, 9)
fill(win, 'S')
fill(ell(8, 4, 3, 1.4) | ell(10, 3.5, 2.5, 1.8), 'W')
fill(ell(18, 7, 2.4, 1.1) | ell(20, 6.5, 2, 1.4), 'W')
fill(rect(13, 0, 13, 9) | rect(3, 5, 23, 5), 'B')
fill(edge(win), 'K')
sill = rect(1, 10, 25, 11); fill(sill, 'W'); fill({(x, 11) for x in range(1, 26)}, 'S'); fill(edge(sill), 'K')
# テーブル（右奥・ななめ）
fill(rect(60, 22, 61, 34), 'C'); fill(rect(61, 22, 61, 34), 'K')
top = poly([(47, 16), (63, 16), (64, 20), (50, 20)])
shape(top, 'C', hi='O', d=1)
apron = rect(50, 21, 63, 23); shape(apron, 'C'); fill(line(51, 22, 62, 22), 'O')
for lx in (51, 60):
    fill(rect(lx, 24, lx + 1, 37), 'C'); fill(rect(lx + 1, 24, lx + 1, 37), 'K'); fill({(lx - 1, y) for y in range(24, 38)} | {(lx, 38), (lx + 1, 38)}, 'K')
cup = rect(54, 11, 58, 15); shape(cup, 'R', hi='W', d=1); fill({(59, 12), (60, 13), (59, 14)}, 'K')
fill(ell(56, 38.5, 7, 0.9), 'O')
# かげ
fill(ell(29, 45.5, 13, 1.3), 'O')
# いぬ（左むきに おすわり。白い体・ちゃいろの ぶちと たれ耳・あかい首輪）
tail = line(37, 33, 42, 26, 1.3) | line(42, 26, 43, 22, 1.0)
shape(tail, 'W', sh='S', d=1); fill({(42, 23), (43, 22)}, 'C')
for a, b in (((46, 22), (48, 20)), ((46, 26), (48, 26)), ((40, 19), (41, 17))):    # ふる線
    fill(line(*a, *b), 'K')
fb = line(26, 33, 26, 43, 1.7); shape(fb, 'S')                          # 奥の まえあし
fill(ell(25, 44, 2.4, 1.4), 'S'); fill(edge(ell(25, 44, 2.4, 1.4)), 'K')
fill(ell(40, 44.3, 3, 1.5), 'S'); fill(edge(ell(40, 44.3, 3, 1.5)), 'K')    # 奥の うしろ足
body = ell(30, 33, 8, 10.5, 12)
shape(body, 'W', sh='S')
haunch = ell(34, 38.5, 6.5, 6)
shape(haunch, 'W', sh='S')
spot = ell(33, 32, 4.5, 4) & (body | haunch); fill(spot - edge(body) - edge(haunch), 'C')
hf = ell(31, 44.5, 4.5, 1.7); shape(hf, 'W', sh='S', d=1); fill({(28, 45), (30, 45)}, 'K')   # 手前の うしろ足
ff = line(22, 32, 21, 43, 1.9); shape(ff, 'W', sh='S', d=1)             # 手前の まえあし
fp = ell(20.5, 44, 2.8, 1.6); shape(fp, 'W'); fill({(19, 45), (21, 45)}, 'K')
fill(line(24, 36, 24, 42), 'S')
head = ell(23, 20, 7.8, 7)
snout = ell(16, 23.5, 5, 3)
shape(head | snout, 'W', sh='S')
patch = ell(21.5, 18, 3, 2.6) & head; fill(patch, 'C')
fill(rect(20, 17, 21, 19), 'K'); put(20, 17, 'W')                         # 目（ボールを見る）
nose = ell(11.8, 22.6, 1.8, 1.5); fill(nose, 'K'); put(11, 22, 'W')
fill({(13, 25), (14, 25), (15, 25), (16, 25), (17, 25), (18, 24)}, 'K')     # 口（わらう）
fill({(14, 26), (15, 26), (16, 26), (15, 27)}, 'R'); fill({(13, 26), (14, 27), (15, 28), (16, 27), (17, 26)}, 'K')
ear = poly([(25, 14), (30, 15), (30.5, 24), (28, 27), (25.5, 23)])
shape(ear, 'C'); fill({(27, 16), (27, 17), (26, 18)}, 'O')
collar = ell(25, 27.5, 4.5, 1.4) - snout
fill(collar, 'R'); fill(edge(collar), 'K')
tag = rect(23, 29, 24, 30); fill(tag, 'Y'); fill(edge(rect(22, 29, 25, 31)) - collar, 'K')
# ボール（左手前。あかと しろ）
ball = ell(7, 41, 4.8, 4.8)
shape(ball, 'R', hi='W', d=1)
fill({(x, y) for x, y in ball if 40 <= y <= 41 and (x, y) not in edge(ball)}, 'W')
fill(edge(ball), 'K')
fill(ell(8, 46, 4, 0.9), 'O')
for a, b in (((2, 33), (3, 34)), ((7, 32), (7, 33)), ((12, 33), (11, 34))):   # はねる線
    fill(line(*a, *b), 'K')
# テーブルの下（奥のかべ）は かげの色で うめる
fill({(x, y) for x, y in rect(53, 24, 59, 29) if g[y][x] == '.'}, 'O')
fill({(x, y) for x, y in rect(53, 24, 59, 29) if (x + y) % 3 == 0}, 'C')
finish('inudaidokorobooru')
