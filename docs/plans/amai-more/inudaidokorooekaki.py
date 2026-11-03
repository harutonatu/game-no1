# だいどころで いぬが おえかきを する（inudaidokorooekaki・段 XXL・64x48）
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
def tri_h(m, c):   # 左上の光（明るい色を左上のふちの内側に）
    fill({(x, y) for x, y in m if ((x - 1, y) not in m or (x, y - 1) not in m)} , c)
def wobble_ell(cx, cy, rx, ry, seed=0):   # もこもこの葉（楕円を いくつか重ねる）
    s = set()
    for i in range(7):
        a = i * 0.9 + seed
        s |= ell(cx + math.cos(a) * rx * 0.55, cy + math.sin(a) * ry * 0.5, rx * 0.55, ry * 0.55)
    return s | ell(cx, cy, rx * 0.8, ry * 0.8)

# だいどころで いぬが おえかきを する：床に ひろげた 紙に クレヨンで おえかきする いぬ（絵の半分）。場所の物は まど と 戸だな の 2 つ。
# いぬ＝しろい体・ちゃいろの ぶち と たれ耳・あかい首輪（amai-redraw/inudaidokorooyatsu の いぬ と そろえる）
# 床（青い タイル。奥へ すぼまる 目地）y 30..47
FY = 30
for y in range(FY, H):
    for x in range(W):
        u = (x - 32) * 10 / (y - FY + 10)
        put(x, y, 'B' if (math.floor(u / 5) + (y - FY + 1) // 4) % 2 == 0 else 'S')
fill({(x, FY) for x in range(W)}, 'K')
# まど（左上。外は 空 と おか）
win = rect(0, 0, 20, 15)
fill(win, 'S')
fill(ell(5, 4, 3.5, 1.6) | ell(8, 3, 2.6, 1.8), 'W')
fill(ell(10, 16, 13, 4) & win, 'G')
fill(rect(10, 0, 10, 15) | rect(0, 7, 20, 7), 'C')
fill(edge(win), 'K')
sill = rect(0, 16, 22, 17); fill(sill, 'W'); fill({(x, 17) for x in range(23)} | {(22, 16)}, 'K')
# 戸だな（右おく。上に なべ）
cab = rect(44, 13, 63, 30)
fill(cab, 'C'); fill({(x, y) for x, y in cab if x in (44, 45)} , 'O')
fill(line(53, 14, 53, 29), 'K'); fill({(51, 21), (51, 22), (55, 21), (55, 22)}, 'Y')
top = rect(43, 11, 63, 12); fill(top, 'W'); fill(edge(top), 'K')
fill(edge(cab), 'K')
pot = rect(52, 5, 60, 10); fill(pot, 'R'); fill({(x, y) for x, y in pot if x == 53}, 'P'); fill(edge(pot), 'K')
fill(rect(50, 6, 51, 6) | rect(61, 6, 62, 6), 'K'); fill(rect(55, 3, 57, 4), 'K')
# 紙（床の上・左手前。ななめに ひろげる）
fill(ell(17, 47, 16, 1), 'K')
paper = poly([(4, 33), (31, 31), (33, 46), (1, 47)])
fill(paper, 'W'); fill({(x, y) for x, y in paper if (x, y + 2) not in paper or (x + 2, y) not in paper}, 'Y')
fill(edge(paper), 'K')
# 紙の絵：おひさま・家・花
fill(ell(8, 36.5, 2.4, 2.2), 'O'); fill({(5, 35), (11, 35), (8, 33), (5, 38), (11, 38)}, 'O')
house = rect(14, 38, 21, 43); fill(house, 'R'); fill(rect(17, 40, 18, 43), 'C')
roof = poly([(12.5, 38.5), (17.5, 33.5), (22.5, 38.5)]); fill(roof, 'B')
fill(ell(27, 38, 1.6, 1.5), 'P'); put(27, 38, 'Y'); fill(line(27, 40, 27, 43), 'G'); fill({(26, 42), (28, 41)}, 'G')
for (x, y), c in (((4, 45), 'G'), ((8, 45), 'R')):                                              # クレヨン
    fill(line(x, y, x + 3, y), c); put(x + 4, y, 'K')
# いぬ（すわって 左むき。紙を みおろす）
fill(ell(42, 46, 14, 1.3), 'K')
WS = lambda m: {(x, y) for x, y in m if (x - 2, y) not in m or (x, y + 2) not in m}
tail = ell(57, 34, 2.4, 5, 35); shape(tail, 'C'); fill({(x, y) for x, y in tail if (x + 1, y) not in tail} - edge(tail), 'O')
hind = ell(49, 40, 7, 5.5)
shape(hind, 'W'); fill({(x, y) for x, y in hind if (x, y + 2) not in hind} - edge(hind), 'S')
body = ell(43, 33, 11, 11)
shape(body, 'W'); fill(WS(body) - edge(body), 'S')
fill(ell(50, 27, 5, 4) & (body - edge(body)), 'C')                                              # せなかの ぶち
legB = poly([(41, 33), (37, 33), (36, 45), (40, 45)])
shape(legB, 'W'); fill({(x, y) for x, y in legB if (x - 1, y) not in legB} - edge(legB), 'S')
fill({(37, 44)}, 'K')
col = ell(42, 24.5, 9, 1.6); fill(col, 'R'); fill(edge(col), 'K')                                # 首輪
fill(ell(40, 27, 1.5, 1.5), 'Y'); fill(edge(ell(40, 27, 1.5, 1.5)), 'K')
earB = ell(35, 12, 3, 6, 20); shape(earB, 'C')
head = ell(41, 15, 10, 9)
snout = ell(32, 20, 5.5, 3.6, 25)
shape(head | snout, 'W'); fill({(x, y) for x, y in head if (x, y + 2) not in head and (x, y + 2) not in snout} - edge(head | snout), 'S')
fill(edge(head | snout), 'K')
fill(ell(37, 12, 3, 3), 'C')                                                                     # 目の もよう
fill({(36, 13), (37, 14), (38, 14), (39, 13)}, 'K')                                             # 目（下を みる）
fill({(44, 13), (45, 14), (46, 14), (47, 13)}, 'K')
fill(rect(27, 21, 29, 22) | {(28, 23)}, 'K'); put(27, 21, 'W')                                   # 鼻
fill(line(30, 24, 35, 22), 'K'); fill({(33, 24), (34, 24)}, 'P')                                 # 口 と した
fill(rect(42, 19, 44, 19), 'P')                                                                  # ほっぺ
earF = ell(48, 16, 3.6, 7.5, -15); shape(earF, 'C'); fill({(x, y) for x, y in earF if (x + 1, y) not in earF} - edge(earF), 'O')
# 手前の うで と クレヨン（紙に 線を かく）
arm = poly([(40, 29), (35, 30), (30, 34), (27, 37), (31, 40), (36, 35), (41, 34)])
shape(arm, 'W')
paw = ell(28, 38, 3, 2.6); shape(paw, 'W'); fill({(26, 40), (28, 40)}, 'K')
cr = line(26, 32, 21, 39, 2)
fill(cr, 'R'); fill({(x, y) for x, y in cr if (x - 1, y) not in cr}, 'P'); fill(edge(cr), 'K'); fill({(20, 40), (21, 40)}, 'K')   # あかい クレヨン
fill(paw - edge(paw), 'W'); fill(edge(paw), 'K')
fill(line(13, 45, 19, 42) | line(19, 42, 20, 41), 'R')                                            # かいた 線
fill(line(31, 7, 30, 9) | line(28, 4, 27, 6), 'K')                                                # たのしい 線

finish('inudaidokorooekaki', globals().get('HOLE', 'W'))
