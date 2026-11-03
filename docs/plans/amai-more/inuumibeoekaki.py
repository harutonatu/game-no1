# うみべで いぬが おえかきを する（inuumibeoekaki・段 XXL・64x48）
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

# うみべで いぬが おえかきを する：すなはまに ねそべって 紙に クレヨンで おさかなを かく いぬ（絵の半分）。場所の物は 海 と すなのおしろ の 2 つ。
HZ = 12
def shore(x): return 19 + x * 0.04 + 1.0 * math.sin(x / 4 + 2)
for y in range(HZ, H):
    for x in range(W):
        if (x - 32) ** 2 / 35 ** 2 + (y - 12) ** 2 / 36.5 ** 2 > 1 and y > 30: continue
        s = shore(x)
        if y < HZ + 2: c = 'B'
        elif y < s - 1: c = 'W' if ((y - HZ) % 3 == 0 and (x * 3 + y) % 13 < 3) else 'S'
        elif y < s + 0.6: c = 'W'
        elif y < s + 2: c = 'O' if (x // 2 + y) % 3 == 0 else 'Y'
        else: c = 'O' if (x * 13 + y * 7) % 27 == 0 else 'Y'
        put(x, y, c)
# すなのおしろ（右奥）
cas = rect(52, 12, 61, 20) | rect(50, 16, 63, 22)
for x in (52, 55, 58, 61): cas |= {(x, 11)}
for x in (50, 53, 60, 63): cas |= {(x, 15)}
fill(cas, lambda x, y: 'O' if (x >= 59 or y >= 21) else 'Y'); fill(rect(56, 18, 57, 22), 'C'); fill(edge(cas), 'K')
fill(ell(8, 4, 3, 3), lambda x, y: 'Y' if x + y < 12 else 'O')                                # たいよう
fill(line(56, 5, 56, 11), 'K'); fill({(57, 5), (58, 5), (57, 6), (58, 6), (59, 6), (57, 7), (58, 7)}, 'R')
# 紙（すなの上。ななめ）と おさかなの 絵
paper = poly([(42, 34), (61, 32), (64, 43), (44, 46)])
fill(ell(54, 46, 10, 1.0) - paper, 'O')
fill(paper, 'W'); fill({(x, y) for x, y in paper if (x, y + 1) not in paper or (x + 1, y) not in paper}, 'S'); fill(edge(paper), 'K')
fish = ell(55, 38.5, 4, 2.2); fill(fish, 'B'); fill(poly([(58, 38.5), (62, 36), (62, 41)]), 'B'); put(53, 38, 'K')
fill({(51, 41), (52, 40), (53, 41), (60, 34), (61, 35)}, 'S')                                  # あわ
fill({(47, 35), (48, 35), (47, 36)}, 'R')
# いぬの かげ
fill(ell(24, 45, 20, 1.5), lambda x, y: 'O' if g[y][x] in 'YO' else None)
# いぬ（ねそべって 右を むく。しろい体・ちゃいろの ぶちと たれ耳・あかい首輪）
def wsh(m):
    fill({(x, y) for x, y in m if (x, y + 2) not in m} - edge(m), 'S')
tail = line(5, 35, 2, 30, 1) | line(2, 30, 4, 26, 1)
body = ell(19, 37, 15, 7)
hind = ell(8, 42, 5, 2.4)
pawB = ell(32, 43, 4.5, 2.2)
head = ell(35, 25, 9, 8)
snout = ell(43, 29, 5.5, 3.6)
earB = ell(40, 19, 2.5, 4, 30)
earF = ell(30, 28, 3.6, 7.5, 12)
shape(tail, 'W'); fill({(4, 26), (5, 26), (4, 27)}, 'C'); fill(edge(tail), 'K')
fill(line(0, 24, 1, 26) | line(7, 23, 6, 25), 'K')                                           # しっぽを ふる線
shape(hind, 'W'); fill(edge(hind), 'K')
shape(body, 'W'); wsh(body)
fill(ell(14, 33, 6, 3.5) & body, 'C'); fill(ell(26, 39, 3, 2) & body, 'C'); fill(edge(body), 'K')
shape(pawB, 'W'); wsh(pawB); fill(edge(pawB), 'K'); fill({(33, 44), (35, 44)}, 'K')
shape(earB, 'C')
shape(head | snout, 'W'); fill({(x, y) for x, y in head if (x, y + 2) not in head and (x, y + 2) not in snout} - edge(head | snout), 'S')
fill(edge(head | snout), 'K')
fill(ell(39, 21.5, 3, 3), 'C')
fill(ell(39, 22.5, 1.3, 1.8), 'K'); put(39, 21, 'W')
fill(ell(32, 22, 1.2, 1.7), 'K'); put(32, 21, 'W')
fill(rect(47, 26, 49, 27) | {(48, 28)}, 'K'); put(47, 26, 'W')
fill(line(43, 31, 48, 31), 'K'); fill({(45, 32), (46, 32), (45, 33)}, 'P')                      # 口と した
fill(rect(34, 27, 36, 27), 'P')
col = ell(33, 32.5, 6.5, 1.8); fill(col, 'R'); fill(edge(col), 'K')                          # くびわ
tag = ell(35, 35, 1.5, 1.5); fill(tag, 'Y'); fill(edge(tag), 'K')
shape(earF, 'C'); fill({(x, y) for x, y in earF if (x - 1, y) not in earF} - edge(earF), 'O')
# 前足（紙の上）と クレヨン
pawF = ell(44, 40, 4, 2.2); shape(pawF, 'W'); wsh(pawF); fill(edge(pawF), 'K'); fill({(46, 41), (44, 41)}, 'K')
arm = poly([(33, 36), (42, 38), (42, 42), (33, 41)]); shape(arm, 'W'); wsh(arm); fill(edge(arm) - pawF, 'K'); shape(pawF, 'W'); fill(edge(pawF), 'K')
fill(line(47, 40, 50, 37, 1), 'R'); put(51, 37, 'K'); put(51, 36, 'K')

finish('inuumibeoekaki')
