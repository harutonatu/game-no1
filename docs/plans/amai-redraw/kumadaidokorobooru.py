# だいどころで くまが ボールで あそぶ（kumadaidokorobooru・段 XL・64x48 以下）。部品で描いて文字の地図 kumadaidokorobooru.txt を書き出す。python3 kumadaidokorobooru.py
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
HOLE = 'C'
# だいどころで くまが ボールで あそぶ（なげて、りょう手で うける）。場所の物：まど・コンロと なべ
# 床（板の間・奥へすぼまる目地）
floor = rect(0, 37, 63, 47)
fill(floor, 'Y')
for y in (40, 44):
    fill({(x, y) for x in range(W)}, 'O')
for vx in (-60, -28, 4, 36, 68, 100, 132):
    fill(line(32 + (vx - 32) / 3, 37, vx, 47) & floor, 'O')
fill({(x, 37) for x in range(W)}, 'K')
# まど（左上）
win = rect(0, 2, 7, 18)
fill(win, 'S')
fill(ell(3, 6, 2.2, 1.2) | ell(4.5, 5.5, 1.8, 1.5), 'W')
fill(rect(0, 10, 7, 10), 'B')
fill(edge(win), 'K')
sill = rect(0, 19, 8, 20); fill(sill, 'W'); fill({(x, 20) for x in range(0, 9)}, 'S'); fill(edge(sill), 'K')
# コンロ台となべ（右奥）
cnt = rect(49, 22, 63, 38)
fill(cnt, 'W'); fill({(x, y) for x, y in cnt if x >= 61}, 'S')
fill(rect(49, 22, 63, 24), 'S'); fill(line(49, 25, 63, 25), 'K')
door = rect(51, 28, 60, 36); fill(edge(door), 'K'); fill(rect(54, 30, 57, 30), 'K')

fill(edge(cnt), 'K')
fill({(50, 26), (51, 26), (52, 26), (60, 26), (61, 26), (62, 26)}, 'R')                    # つまみ
pot = rect(52, 14, 62, 21)
shape(pot, 'B', hi='S', d=1)
lid = ell(57, 14, 6, 1.6); fill(lid, 'S'); fill(edge(lid), 'K'); fill(rect(56, 11, 57, 12), 'K')
fill({(50, 16), (51, 16), (63, 16)}, 'K')
for x0 in (54, 59):                                                    # ゆげ
    for y in range(4, 10):
        put(x0 + (1 if (y // 2) % 2 else 0), y, 'S' if y > 6 else 'W')
fill(ell(28, 45.5, 17, 1.4), 'O')
# くま（すわって 上のボールへ りょう手を のばす）
for cx, sgn in ((18, 1), (38, -1)):
    arm = line(cx - 1 * sgn, 29, cx - 8 * sgn, 11, 2.3)
    shape(arm, 'C', sh='K' if sgn > 0 else None, hi='O', d=1)
    paw = ell(cx - 9 * sgn, 9, 3.4, 3.2)
    shape(paw, 'C', hi='O', d=1); fill(ell(cx - 9 * sgn, 9.3, 1.8, 1.5), 'O')
body = ell(28, 35.5, 12.5, 9.5)
shape(body, 'C', sh='K', hi='O')
belly = ell(28, 37, 7, 6.5)
fill(belly, 'O'); fill({(x, y) for x, y in belly if (x - 1, y - 1) not in belly}, 'Y')
for cx in (18, 38):
    f = ell(cx, 43.5, 5, 3.4)
    shape(f, 'C'); fill(ell(cx, 43.7, 2.8, 1.9), 'O'); fill({(cx - 2, 40), (cx, 40), (cx + 2, 40)}, 'O')
earL = ell(19.5, 12.5, 3.8, 3.8); earR = ell(36.5, 12.5, 3.8, 3.8)
shape(earL, 'C'); fill(ell(19.5, 13, 1.9, 1.9), 'O')
shape(earR, 'C'); fill(ell(36.5, 13, 1.9, 1.9), 'O')
head = ell(28, 20.5, 11.5, 9.5)
shape(head, 'C', sh='K', hi='O')
mz = ell(28, 25, 5.5, 3.8)
fill(mz, 'W'); fill({(x, y) for x, y in mz if (x, y + 1) not in mz}, 'O'); fill(edge(mz), 'K')
nose = ell(28, 22.5, 3, 1.3); fill(nose, 'K')
mouth = ell(28, 26, 2.2, 1.6)                                           # あけて わらう口
fill(mouth, 'R'); fill(edge(mouth), 'K'); fill({(28, 24)}, 'K')
for ex in (22, 32):                                                     # 目（上を見る）
    fill(rect(ex, 16, ex + 1, 18), 'K'); put(ex, 16, 'W')
fill(ell(20, 23, 1.8, 1), 'R'); fill(ell(36, 23, 1.8, 1), 'R')
# ボール（上。あか・きいろ・しろの しま）
ball = ell(28, 5.5, 5, 5)
def bcol(x, y):
    k = int((x + .5 - 28) / 2.6 + 10) % 3
    return 'RYW'[k]
for x, y in ball: put(x, y, bcol(x, y))
fill({(x, y) for x, y in ball if (x - 28) + (y - 5) > 4}, 'O')
fill(edge(ball), 'K')
for a, b in (((21, 3), (22, 5)), ((35, 3), (34, 5)), ((24, 0), (24, 0))):   # 動きの線
    fill(line(*a, *b), 'K')
finish('kumadaidokorobooru')
