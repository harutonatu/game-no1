# だいどころで いぬが おやつを たべる（inudaidokorooyatsu・段 XL・64x48）
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

# だいどころで いぬが おやつを たべる：ドーナツを くわえた いぬ（絵の半分）。場所の物は まど と テーブル の 2 つ。
# 床（タイル。奥へ すぼまる目地）y 38..47
FY = 38
for y in range(FY, H):
    for x in range(W):
        u = (x - 32) * 10 / (y - FY + 10)
        c = 'O' if (math.floor(u / 4) + (y - FY) // 3) % 2 == 0 else 'Y'
        put(x, y, c)
fill({(x, FY) for x in range(W)}, 'K')
# まど（左上。外は空と くも）
win = rect(0, 0, 21, 17)
fill(win, 'S')
fill(ell(5, 5, 3.5, 1.6) | ell(8, 4, 2.6, 1.8), 'W')
fill(ell(17, 12, 4, 1.4), 'W')
fill(rect(10, 0, 11, 17) | rect(0, 8, 21, 9), 'C')
fill(edge(win), 'K')
fill(rect(0, 18, 23, 19), 'W'); fill({(x, 19) for x in range(24)} | {(23, 18)}, 'K')   # まど台
# テーブル（右・ななめ）
# （奥の脚は 絵の外）
ttop = poly([(47, 26), (64, 26), (64, 30), (44, 30)])
fill(ttop, lambda x, y: 'O' if y < 28 else 'C')
front = rect(44, 30, 63, 32); fill(front, 'C'); fill({(x, 31) for x in range(46, 63, 4)}, 'O')
fill(edge(ttop | front), 'K')
for lx in (46,):
    fill(rect(lx, 33, lx + 1, 46), 'C'); fill(rect(lx + 1, 33, lx + 1, 46), 'K')
fill(ell(54, 46, 10, 1.2) - rect(46, 33, 47, 47), 'O')
# おさらと ドーナツ（テーブルの上）
plate = ell(55, 26.5, 8.5, 2.2)
fill(plate, 'W'); fill({(x, y) for x, y in plate if y >= 27}, 'S'); fill(edge(plate), 'K')
def donut(cx, cy, rx, ry):
    m = ell(cx, cy, rx, ry); hole = ell(cx, cy - 0.5, rx * 0.3, ry * 0.36)
    m -= hole
    fill(m, lambda x, y: 'P' if y < cy + 0.5 else 'O')
    for i, (x, y) in enumerate(sorted(m)):
        if g[y][x] == 'P' and (x * 5 + y * 3) % 7 == 0: put(x, y, 'W' if i % 2 else 'R')
    fill(edge(m), 'K')
donut(51, 22.5, 5, 3.2); donut(59, 22.5, 5, 3.2); donut(55, 17, 5, 3.2)
# いぬのかげ
fill(ell(24, 46, 15, 1.4), 'K')
# いぬ（すわって 右を むく。しろい体・ちゃいろの耳）
WS = lambda m: (lambda x, y: 'S' if (x + 2, y) not in m or (x, y + 2) not in m else 'W')
tail = ell(7, 33, 2.4, 5, -35)
hind = ell(15, 40, 7, 5.5)
body = ell(21, 33, 11, 11)
legA = poly([(23, 33), (28, 33), (29, 45), (24, 45)]); legB = poly([(29, 32), (33, 32), (34, 45), (30, 45)])
head = ell(22, 16, 10, 9)
snout = ell(31, 20, 5.5, 3.6)
earB = ell(29, 13, 3, 6, -20)
earF = ell(15, 17, 3.6, 7.5, 15)
shape(tail, 'C')
shape(hind, 'W'); fill(WS(hind), 'S') if False else None
fill({(x, y) for x, y in hind if (x, y + 2) not in hind}, 'S'); fill(edge(hind), 'K')
shape(body, 'W'); fill({(x, y) for x, y in body if ((x + 2, y) not in body or (x, y + 2) not in body)} - edge(body), 'S')
fill(ell(14, 27, 5, 4) & body, 'C'); fill(edge(body), 'K')                       # せなかの もよう
for m in (legA, legB):
    shape(m, 'W'); fill({(x, y) for x, y in m if (x + 1, y) not in m} - edge(m), 'S')
fill({(25, 44), (27, 44), (31, 44), (33, 44)}, 'K')                              # 指
fill(ell(22, 25.5, 9, 1.6), 'R'); fill(edge(ell(22, 25.5, 9, 1.6)), 'K')          # くびわ
fill(ell(24, 28, 1.5, 1.5), 'Y'); fill(edge(ell(24, 28, 1.5, 1.5)), 'K')
shape(earB, 'C')
shape(head | snout, 'W'); fill({(x, y) for x, y in head if (x, y + 2) not in head and (x, y + 2) not in snout} - edge(head | snout), 'S')
fill(edge(head | snout), 'K')
fill(ell(26, 12, 3, 3), 'C')                                                     # 目の もよう
fill(ell(26, 13, 1.3, 1.8), 'K'); put(26, 12, 'W')                               # 目
fill(ell(18, 13, 1.2, 1.7), 'K'); put(18, 12, 'W')
fill(rect(35, 17, 37, 18) | {(36, 19)}, 'K'); put(35, 17, 'W')                   # 鼻
fill(line(30, 22, 36, 22), 'K')                                                  # 口
shape(earF, 'C'); fill({(x, y) for x, y in earF if (x - 1, y) not in earF} - edge(earF), 'O')
fill(rect(19, 19, 21, 19), 'P')                                                  # ほっぺ
# くわえた ドーナツ
dm = ell(37.5, 22.5, 3.8, 3); dh = ell(37.5, 22.5, 1.2, 0.9)
fill(dm - dh, lambda x, y: 'P' if y < 23 else 'O'); fill({(37, 21), (40, 22), (36, 23)}, 'W'); put(39, 20, 'R')
fill(edge(dm - dh), 'K')
fill(line(33, 21, 35, 21), 'K'); fill({(32, 23), (33, 23), (34, 23)}, 'P')       # 口元と したの先
# かおりの線（ドーナツから）
fill(line(51, 8, 50, 10) | line(50, 10, 51, 12) | line(57, 7, 56, 9) | line(56, 9, 57, 11), 'O')

finish('inudaidokorooyatsu')
