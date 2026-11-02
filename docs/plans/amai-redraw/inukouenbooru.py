# こうえんで いぬが ボールで あそぶ（inukouenbooru・段 L・64x48 以下）。部品で描いて文字の地図 inukouenbooru.txt を書き出す。python3 inukouenbooru.py
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
HOLE = 'W'   # 閉じた空き（むねの下）は しろで うめる
# こうえんで いぬが ボールで あそぶ。場所の物：しばふ・木。右むきに描いて、最後に左右を返す（木が右奥になる）
lawn = ell(32, 42.5, 30, 3.6)
fill(lawn, 'G'); fill({(x, y) for x, y in lawn if (x * 7 + y * 3) % 11 == 0}, 'Y')
front = {(x, y + 1) for x, y in lawn if (x, y + 1) not in lawn}
fill(front, 'C'); fill(edge(lawn | front), 'K')
for x in range(5, 60, 3):
    put(x, min(y for xx, y in lawn if xx == x) - 1, 'G')
# 木（左奥）
trunk = poly([(5.5, 12), (10, 12), (10.5, 37), (12.5, 40.5), (3.5, 40.5), (5.5, 37)])
shape(trunk, 'C', d=1); fill({(7, y) for y in range(14, 38) if y % 5}, 'Y'); fill({(9, y) for y in range(15, 38, 4)}, 'K')
leaves = ell(8, 7, 7, 6) | ell(3.5, 11, 3.5, 3.2) | ell(13, 10.5, 4.2, 3.6)
shape(leaves, 'G', sh='K', hi='Y')
fill({(x, y) for x, y in leaves if g[y][x] == 'K' and (x + y) % 2 and (x, y) not in edge(leaves)}, 'G')
fill({(5, 5), (6, 4), (10, 8), (3, 10), (13, 9), (14, 8)}, 'Y')
# かげ（いぬは とんでいるので 下に小さく）
fill({(x, y) for x, y in ell(28, 43.5, 11, 1.2) if (x + y) % 2 == 0}, 'K')
fill({(x, y) for x, y in ell(52, 43.5, 4, 1)}, 'K')
# いぬ（ボールへ とびつく）
tail = line(16, 27, 12, 20, 1.0) | line(12, 20, 13, 17, 0.6)
shape(tail, 'W', sh='S', d=1)
legB1 = line(20, 32, 13, 37, 1.8); legB2 = line(39, 30, 45, 33, 1.7)       # 奥の足
shape(legB1, 'S'); shape(legB2, 'S')
body = ell(29, 28.5, 12.5, 6.5, -12)
shape(body, 'W', sh='S')
spot = ell(25, 26, 4.5, 3.2, -12) & body
fill(spot - edge(body), 'C')
legF1 = line(23, 32, 16, 38, 1.9); legF2 = line(36, 30, 45, 28.5, 1.8)       # 手前の足
shape(legF1, 'W', sh='S', d=1); shape(legF2, 'W', sh='S', d=1)
fill(ell(15, 38.5, 2.8, 1.8), 'W'); fill(edge(ell(15, 38.5, 2.8, 1.8)), 'K')
fill(ell(46.5, 28.5, 2.4, 2), 'W'); fill(edge(ell(46.5, 28.5, 2.4, 2)), 'K')
head = ell(39.5, 18.5, 7, 6.5)
snout = ell(46, 21, 4.5, 3)
shape(head | snout, 'W', sh='S')
collar = line(35, 22, 37, 27, 0.9) & (body | head)
fill(collar, 'R'); fill({(37, 28), (38, 28), (37, 29), (38, 29)}, 'Y'); fill({(36, 30), (37, 30), (38, 30), (39, 29), (39, 28)}, 'K')
nose = ell(50, 19.5, 1.6, 1.4)
fill(nose, 'K'); put(50, 19, 'W')
fill({(45, 22), (46, 22), (47, 22), (48, 22), (49, 22), (50, 21)}, 'K')     # 口（あけて わらう）
fill({(46, 23), (47, 23), (48, 23), (47, 24)}, 'R')
fill({(45, 23), (46, 24), (47, 25), (48, 24), (49, 23)}, 'K')
fill(rect(41, 15, 42, 17), 'K'); put(41, 15, 'W')                              # 目
ear = poly([(34, 13), (39, 12), (37, 20), (34, 22), (32.5, 19)])
shape(ear, 'C', hi='O' if False else None)
fill({(35, 15), (35, 16), (36, 14)}, 'Y')
fill(ell(40, 21.5, 1.6, 0.9), 'R' if False else 'S')
# ボール（あかと しろ。口の まえ・上）
ball = ell(55.5, 12.5, 4.6, 4.6)
shape(ball, 'R', hi='W', d=1)
fill({(x, y) for x, y in ball if 12 <= y <= 13}, 'W')
fill(edge(ball), 'K')
for a, b in (((60, 4), (62, 2)), ((62, 9), (63, 8)), ((49, 7), (50, 5))):    # 動きの線
    fill(line(*a, *b), 'K')
for a, b in (((6, 26), (9, 26)), ((5, 30), (9, 30))):
    fill(line(*a, *b), 'K')
# 左右を返す
for r in g: r.reverse()
finish('inukouenbooru')
