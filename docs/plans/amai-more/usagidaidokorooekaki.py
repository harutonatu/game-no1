# だいどころで うさぎが おえかきを する（usagidaidokorooekaki・段 XXL・64x48）
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

# だいどころで うさぎが おえかきを する：テーブルの 紙に クレヨンで にんじんを かく うさぎ（絵の半分）。場所の物は まど と テーブル の 2 つ。
FY = 37
for y in range(FY, H):
    for x in range(W):
        u = (x - 30) * 10 / (y - FY + 10)
        put(x, y, 'B' if (math.floor(u / 4) + (y - FY) // 3) % 2 == 0 else 'W')
fill({(x, FY) for x in range(W)}, 'K')
# まど（右上。そとは 空と くも）
win = rect(40, 0, 63, 15)
fill(win, 'S'); fill(ell(46, 5, 3.5, 1.5) | ell(49, 4, 2.6, 1.6), 'W'); fill(ell(58, 10, 3.5, 1.3), 'W')
fill(rect(51, 0, 52, 15) | rect(40, 7, 63, 8), 'C'); fill(edge(win), 'K')
fill(rect(38, 16, 63, 17), 'W'); fill({(x, 17) for x in range(38, 64)} | {(38, 16)}, 'K')
# かべの タイル（テーブルの うしろ。白に みずいろの目地）
for y in range(19, FY):
    for x in range(26, W):
        put(x, y, 'S' if (y % 4 == 0 or (x + (y // 4) * 2) % 6 == 0) else 'W')
fill({(26, y) for y in range(19, FY)} | {(x, 19) for x in range(26, W)}, 'K')
# テーブル（右。ななめ）
ttop = poly([(38, 21), (64, 21), (64, 30), (33, 30)])
fill(ttop, lambda x, y: 'Y' if y < 24 else 'O')
front = rect(33, 30, 63, 32); fill(front, 'C')
fill(edge(ttop | front), 'K')
for lx in (35, 60):
    fill(rect(lx, 33, lx + 1, 46), 'C'); fill(rect(lx + 1, 33, lx + 1, 46), 'K')
fill(ell(49, 46, 14, 1.0) - rect(35, 33, 36, 47) - rect(60, 33, 61, 47), 'K')
# 紙と 絵（にんじん）
paper = poly([(41, 22), (59, 22), (58, 29), (38, 29)])
fill(paper, 'W'); fill({(x, y) for x, y in paper if (x, y + 1) not in paper}, 'S'); fill(edge(paper), 'K')
fill(poly([(42, 28), (52, 23), (54, 26)]), 'O'); fill({(53, 23), (54, 22), (55, 22), (54, 24), (55, 24), (56, 23), (55, 23)}, 'G')
fill({(46, 26), (49, 25), (51, 24)}, 'R')
# クレヨン
for x, y, c in ((59, 28, 'Y'), (59, 26, 'G'), (44, 31, 'B')):
    fill({(x, y), (x + 1, y), (x + 2, y), (x + 3, y)}, c); put(x + 3, y, 'K')
# うさぎの かげ
fill(ell(20, 46, 12, 1.3), 'K')
# うさぎ（立って 右を むく。白い体・ピンクの耳）
def wsh(m):
    fill({(x, y) for x, y in m if (x + 2, y) not in m or (x, y + 2) not in m} - edge(m), 'S')
earB = ell(22, 7, 2.8, 7.5, 18); earF = ell(15, 8, 3.2, 8, -10)
foot = ell(19, 44, 8, 2.4)
thigh = ell(15, 37, 6, 6)
body = ell(19, 32, 9, 10)
tail = ell(9, 36, 2.6, 2.6)
armB = poly([(24, 24), (34, 24), (34, 27), (25, 28)])
armF = poly([(22, 28), (35, 27), (36, 30), (24, 32)])
head = ell(21, 18, 9, 7.5)
shape(earB, 'W'); fill(ell(22, 7.5, 1.2, 5.5, 18), 'P'); fill(edge(earB), 'K')
shape(armB, 'W'); wsh(armB); fill(edge(armB), 'K')
shape(tail, 'W'); shape(foot, 'W'); wsh(foot); fill(edge(foot), 'K')
for x in (21, 23, 25): put(x, 44, 'P')
shape(body, 'W'); wsh(body); fill(edge(body), 'K')
shape(thigh, 'W'); wsh(thigh); fill(edge(thigh), 'K')
shape(head, 'W'); wsh(head); fill(edge(head), 'K')
shape(earF, 'W'); fill(ell(15, 8.5, 1.4, 6, -10), 'P'); fill(edge(earF), 'K')
fill(ell(25, 17, 1.4, 2), 'K'); put(25, 16, 'W')                                  # 目（紙を見る）
fill({(29, 19), (28, 19), (29, 20)}, 'P')                                         # 鼻
fill({(27, 21), (28, 22), (29, 21)}, 'K')                                          # 口
fill(rect(20, 20, 22, 21), 'P')                                                    # ほっぺ
shape(armF, 'W'); wsh(armF); fill(edge(armF), 'K')
paw = ell(36, 28.5, 2, 1.8); shape(paw, 'W')
fill(line(37, 27, 41, 25, 1), 'R'); put(42, 25, 'K'); put(42, 24, 'K')            # にぎった クレヨン

finish('usagidaidokorooekaki')
