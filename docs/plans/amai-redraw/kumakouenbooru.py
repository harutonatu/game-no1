# こうえんで くまが ボールで あそぶ（kumakouenbooru・段 XL・64x48）
# 部品（楕円・多角形・線・ふちどり・かげ）で描いて、文字の地図 <id>.txt を書き出す（1 マス＝1 粒）。
import math, os
W, H = 64, 48
g = [['.'] * W for _ in range(H)]
def put(x, y, c):
    if 0 <= x < W and 0 <= y < H: g[y][x] = c
def ell(cx, cy, rx, ry, ang=0):
    a = math.radians(ang); s = set()
    for y in range(H):
        for x in range(W):
            dx, dy = x - cx, y - cy
            u = dx * math.cos(a) + dy * math.sin(a); v = -dx * math.sin(a) + dy * math.cos(a)
            if (u / rx) ** 2 + (v / ry) ** 2 <= 1: s.add((x, y))
    return s
def rect(x0, y0, x1, y1):
    return {(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)}
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
def line(x0, y0, x1, y1, w=0):
    s = set(); n = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(n + 1):
        x = round(x0 + (x1 - x0) * i / n); y = round(y0 + (y1 - y0) * i / n)
        for k in range(w + 1): s.add((x + k, y))
    return s
def fill(m, c):
    for x, y in m:
        cc = c(x, y) if callable(c) else c
        if cc: put(x, y, cc)
def edge(m):
    return {(x, y) for x, y in m if any((x + dx, y + dy) not in m for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
def shape(m, c, o='K', sh=None, hi=None, d=2):
    """塗って、かげ（右下）・明るい所（左上）を付けて、ふちどり。光は左上から。"""
    fill(m, c)
    if sh: fill({(x, y) for x, y in m if (x + d, y) not in m or (x, y + d) not in m}, sh)
    if hi: fill({(x, y) for x, y in m if ((x - d, y) not in m or (x, y - d) not in m) and (x + d, y) in m and (x, y + d) in m}, hi)
    if o: fill(edge(m), o)
def z(x, y, n, c='K'):
    for i in range(n): put(x + i, y, c); put(x + i, y + n - 1, c); put(x + n - 1 - i, y + i, c)
def finish(name, hole='W'):
    out = set(); st = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
    st = [p for p in st if g[p[1]][p[0]] == '.']; out = set(st)
    while st:
        x, y = st.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if 0 <= q[0] < W and 0 <= q[1] < H and q not in out and g[q[1]][q[0]] == '.': out.add(q); st.append(q)
    for y in range(H):
        for x in range(W):
            if g[y][x] == '.' and (x, y) not in out: g[y][x] = hole   # 閉じた空きは埋める
    rows = [''.join(r) for r in g]
    while rows and set(rows[0]) == {'.'}: rows.pop(0)
    while rows and set(rows[-1]) == {'.'}: rows.pop()
    while all(r[0] == '.' for r in rows): rows = [r[1:] for r in rows]
    while all(r[-1] == '.' for r in rows): rows = [r[:-1] for r in rows]
    here = os.path.dirname(os.path.abspath(__file__))
    open(os.path.join(here, name + '.txt'), 'w').write('\n'.join(rows) + '\n')
    cnt = {}
    for r in rows:
        for c in r:
            if c != '.': cnt[c] = cnt.get(c, 0) + 1
    print(sum(cnt.values()), cnt)

# こうえんで くまが ボールで あそぶ：立って ボールを 高く なげる くま（絵の半分）。場所の物は 木 と ベンチ の 2 つ。
# しばふ（奥は細い線、手前ほど草の粒）
GY = 32
for y in range(GY, H):
    for x in range(W):
        if y == GY: c = 'K' if (x // 6) % 2 == 0 and x % 3 == 0 else 'G'
        else: c = 'Y' if (x * 7 + y * 11) % 29 == 0 else ('K' if (x * 5 + y * 3) % 23 == 0 and y > 36 else 'G')
        put(x, y, c)
for x, y in ((5, 40), (13, 44), (57, 44), (49, 39), (2, 46), (60, 38)):         # 花
    fill({(x, y), (x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)}, 'W'); put(x, y, 'Y')
# ベンチ（右奥・ななめ）
seat = poly([(51, 28), (64, 27), (64, 30), (52, 32)])
back = poly([(51, 21), (64, 20), (64, 23), (51, 24)])
fill(back, lambda x, y: 'O' if y > 21.5 + (64 - x) * 0.08 else 'C'); fill(edge(back), 'K')
fill(rect(61, 23, 62, 27), 'K')
fill(seat, lambda x, y: 'O' if y < 29.5 - (x - 51) * 0.08 else 'C'); fill(edge(seat), 'K')
fill(rect(52, 32, 53, 35) | rect(62, 30, 63, 34), 'K')
# 木（左。幹と葉）
fill(ell(10, 45, 9, 1.6), 'K')
trunk = poly([(7, 18), (12, 18), (13, 44), (5, 44)])
shape(trunk, 'C', sh='K'); fill({(8, y) for y in range(20, 42, 4)} | {(10, y) for y in range(22, 42, 5)}, 'O')
leaf = ell(8, 8, 9.5, 8) | ell(3, 14, 5, 4) | ell(14, 15, 4.5, 3.5)
fill(leaf, lambda x, y: 'Y' if (x * 3 + y * 5) % 13 == 0 and x + y < 22 else ('K' if (x + 1, y + 1) not in leaf or ((x * 7 + y * 3) % 17 == 0 and x + y > 20) else 'G'))
fill(edge(leaf), 'K')
# くまのかげ
fill(ell(34, 45, 13, 1.8), 'K')
# くま（すこし右むき・左うでを上げて ボールを なげた所）
legL = ell(28, 42, 4.5, 4); legR = ell(40, 42, 4.5, 4)
body = ell(34, 33, 11, 10)
armL = ell(23, 34, 3, 6.5, 25)
armR = poly([(38, 27), (45, 13), (51, 15), (45, 31)])
head = ell(32, 17, 10, 8.5)
earL = ell(24, 9, 3.6, 3.6); earR = ell(39, 8, 3.6, 3.6)
for f, cx in ((legL, 28), (legR, 40)):
    shape(f, 'C', sh='K'); fill(ell(cx, 43, 2, 1.4), 'O')
shape(body, 'C', sh='K')
belly = ell(35, 35, 6, 6.5); fill(belly, 'O'); fill({(x, y) for x, y in belly if (x - 1, y - 1) not in belly}, 'Y')
shape(armL, 'C', sh='K')
shape(armR, 'C', sh='K'); fill(line(41, 26, 46, 15), 'O')
paw = ell(49, 12.5, 2.8, 2.6); shape(paw, 'C'); fill(ell(49, 12.5, 1.3, 1.2), 'O')
shape(earL, 'C'); fill(ell(24, 9.5, 1.8, 1.8), 'O')
shape(earR, 'C'); fill(ell(39, 8.5, 1.8, 1.8), 'O')
shape(head, 'C', sh='K')
fill({(x, y) for x, y in head if (x - 2, y) not in head and (x, y) not in edge(head) and 12 <= y <= 20}, 'O')
mz = ell(35, 21, 5, 3.4)
fill(mz, 'W'); fill({(x, y) for x, y in mz if (x, y + 1) not in mz}, 'O'); fill(edge(mz), 'K')
fill(rect(34, 18, 37, 19) | rect(35, 20, 36, 20), 'K'); put(34, 18, 'W')       # 鼻
fill(rect(34, 22, 36, 23), 'R'); fill({(33, 22), (37, 22), (34, 24), (35, 24), (36, 24)}, 'K')   # わらった口
for ex, ey in ((28, 15), (39, 14)):                                             # 目（上を見る）
    fill(ell(ex, ey, 1.4, 2), 'K'); put(ex, ey - 1, 'W')
fill(rect(25, 20, 27, 20), 'R')                                                   # ほっぺ
# ボール（右上の空。あかと しろ）と 動きの線
ball = ell(55, 7, 6, 6)
fill(ball, lambda x, y: 'W' if abs((y - 7) + (x - 55) * 0.3) < 1.6 else 'R')
fill({(52, 3), (53, 3), (52, 4)}, 'W')
fill(edge(ball), 'K')
fill(line(44, 7, 47, 5) | line(46, 2, 49, 1) | line(52, 15, 50, 17), 'K')

finish('kumakouenbooru')
