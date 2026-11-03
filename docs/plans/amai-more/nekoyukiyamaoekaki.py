# ゆきやまで ねこが おえかきを する（nekoyukiyamaoekaki・段 XXL・64x48）
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

# ゆきやまで ねこが おえかきを する：イーゼルの 紙に 筆で にじを かく ねこ（絵の半分）。場所の物は 雪の山 1 つ（雪は地面）。
FY = 30
# 雪の山（奥。みずいろの山はだ・右がわは あおい かげ・白い雪のぼうし）
mt = poly([(14, FY + 1), (28, 10), (32, 13), (43, 1), (58, 15), (64, 11), (64, FY + 1)])
pk = [(28, 10), (43, 1), (64, 11)]
def mcol(x, y):
    for px, py in pk:
        if y < py + 6 - abs(x - px) * 0.15 and abs(x - px) < 7 and y < py + 5 + (x % 3): return 'W'
    for px, py in pk:
        if x > px and (x - px) < (y - py) * 0.9 and y < FY - 2: return 'B'
    return 'S'
fill(mt, mcol); fill(edge(mt), 'K')
# 雪の地面（奥へ うすい S のすじ）
for y in range(FY, H):
    for x in range(W):
        put(x, y, 'S' if ((y - FY) % 5 == 3 and (x + y * 3) % 13 < 3) else 'W')
fill({(x, FY) for x in range(W)} - rect(40, FY, 52, FY), 'K')
for x, y in ((3, 2), (8, 0), (45, 4), (49, 1), (36, 10), (42, 13)): fill({(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)} if False else {(x, y)}, 'S'); put(x, y + 1, 'S'); put(x + 1, y, 'S')
# かげ
fill(ell(20, 45, 15, 1.3), 'S'); fill(ell(52, 46, 9, 1.0), 'S')
# イーゼル（右。ななめに 立つ）
fill(line(44, 22, 41, 46, 1), 'C'); fill(line(58, 22, 61, 46, 1), 'C'); fill(line(51, 34, 52, 45), 'C')
fill(line(42, 46, 42, 46) | line(62, 46, 62, 46), 'K')
canvas = poly([(41, 15), (60, 14), (61, 36), (41, 37)])
fill(canvas, 'W')
# にじ（紙の中）
for r, c in ((9, 'R'), (8, 'O'), (7, 'Y'), (6, 'G'), (5, 'B')):
    fill({(x, y) for x, y in ell(51, 32, r, r) if y <= 31 and (x, y) in canvas and ((x - 51) ** 2 + (y - 32) ** 2) > (r - 1.1) ** 2}, c)
fill(ell(45, 34, 2.5, 1.2) & canvas, 'S'); fill(ell(57, 34, 2.5, 1.2) & canvas, 'S')
fill(ell(56, 18, 1.6, 1.6), 'Y')
fill(edge(canvas), 'K'); fill(rect(40, 37, 62, 38), 'C'); fill({(x, 38) for x in range(40, 63)} | {(40, 37), (62, 37)}, 'K')
# ねこ（すわって 右を むく。オレンジに ちゃいろの しま。口と おなかは 白）
def lit(m, base, sh, hi):
    fill(m, base)
    fill({(x, y) for x, y in m if (x + 2, y) not in m or (x, y + 2) not in m}, sh)
    fill({(x, y) for x, y in m if ((x - 2, y) not in m or (x, y - 2) not in m) and (x + 2, y) in m and (x, y + 2) in m}, hi)
    fill(edge(m), 'K')
tail = line(10, 42, 4, 38, 2) | line(4, 38, 3, 31, 2) | line(3, 31, 6, 27, 1)
fill(tail, 'O'); fill({(x, y) for x, y in tail if y in (30, 34, 38)}, 'C'); fill(edge(tail), 'K')
hind = ell(13, 39, 7, 6)
body = ell(19, 33, 10, 11)
head = ell(20, 15, 10, 8.5)
earL = poly([(11, 12), (12, 2), (18, 8)]); earR = poly([(22, 8), (28, 2), (29, 12)])
lit(hind, 'O', 'C', 'Y')
lit(body, 'O', 'C', 'Y')
belly = ell(22, 36, 5, 7); fill(belly & body, 'W'); fill({(x, y) for x, y in belly & body if (x + 2, y) not in body or (x, y + 2) not in belly}, 'S'); fill(edge(body), 'K')
for k in range(3): fill(line(10 + k * 3, 24 + k, 12 + k * 3, 29 + k), 'C')
fill(ell(10, 45, 3.5, 1.4) | ell(19, 45, 3.5, 1.4) | ell(26, 45, 3.5, 1.4), 'W')
for f in (ell(10, 45, 3.5, 1.4), ell(19, 45, 3.5, 1.4), ell(26, 45, 3.5, 1.4)):
    fill(edge(f), 'K')
for x in (9, 11, 18, 20, 25, 27): put(x, 45, 'K')
lit(earL, 'O', 'C', 'Y'); lit(earR, 'O', 'C', 'Y')
fill(poly([(13, 10), (13.5, 5), (16, 8)]) | poly([(24, 8), (26.5, 5), (27, 10)]), 'P')
lit(head, 'O', 'C', 'Y')
fill(line(17, 7, 17, 10) | line(20, 7, 20, 10) | line(23, 7, 23, 10), 'C')
muz = ell(22, 19.5, 5, 3); fill(muz, 'W'); fill({(x, 21) for x, y in muz if y == 21}, 'S')
fill(ell(17, 15, 1.3, 1.8), 'K'); put(17, 14, 'W'); fill(ell(25, 15, 1.3, 1.8), 'K'); put(25, 14, 'W')
fill({(21, 18), (22, 18), (23, 18), (22, 19)}, 'P')
fill({(22, 20), (21, 21), (23, 21), (20, 21), (24, 21)}, 'K')
fill(rect(12, 17, 14, 18) | rect(28, 17, 29, 18), 'P')
fill(line(5, 18, 11, 19) | line(5, 22, 11, 21) | line(30, 19, 36, 18) | line(30, 21, 36, 22), 'K')   # ひげ
# 前足と 筆（紙へ のばす）
arm = poly([(22, 29), (35, 25), (37, 29), (24, 34)])
lit(arm, 'O', 'C', 'Y')
paw = ell(37, 27, 2.6, 2.4); fill(paw, 'W'); fill(edge(paw), 'K')
fill(line(36, 30, 44, 22), 'C'); fill(line(37, 30, 45, 22), 'K')
fill(ell(45, 21, 1.6, 1.6), 'R'); put(46, 20, 'K'); put(44, 22, 'K')
# にじの 絵の具が はねた点（雪の上）
for x, y, c in ((34, 41, 'R'), (36, 43, 'Y'), (38, 40, 'B'), (31, 44, 'G')): put(x, y, c); put(x + 1, y, c)

finish('nekoyukiyamaoekaki')
