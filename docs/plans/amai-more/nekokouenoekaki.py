# こうえんで ねこが おえかきを する（nekokouenoekaki・段 XXL・64x48）
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

# こうえんで ねこが おえかきを する：しばふに おいた スケッチブックに クレヨンで さかなを かく ねこ（絵の半分）。場所の物は 木 と スケッチブック の 2 つ。
# 地面（しばふ。奥へ すぼまる すじ と 小さな花）y 33..47
FY = 30
for y in range(FY, H):
    for x in range(W):
        u = (x - 32) * 10 / (y - FY + 10)
        put(x, y, 'Y' if (math.floor(u / 5) + (y - FY) // 4) % 2 == 0 and (x + y) % 3 == 0 else 'G')
fill({(x, FY) for x in range(W)}, 'K')
for fx, fy in ((3, 40), (9, 46), (61, 36), (44, 35)):
    fill({(fx - 1, fy), (fx + 1, fy), (fx, fy - 1), (fx, fy + 1)}, 'P'); put(fx, fy, 'Y')
# 木（右おく。スケッチブックの うしろ）
trunk = poly([(53, 12), (58, 12), (58, 31), (61, 35), (50, 35), (53, 31)])
shape(trunk, 'C'); fill({(x, y) for x, y in trunk if (x - 1, y) not in trunk} - edge(trunk), 'O')
fill(line(55, 17, 55, 20) | line(56, 24, 56, 27), 'K')
crown = ell(55, 7, 9, 7.5) | ell(47, 11, 5, 4.5) | ell(62, 12, 4.5, 4.5)
fill(crown, 'G')
fill({(x, y) for x, y in crown if (x - 2, y - 2) not in crown and (x - 1, y - 1) in crown}, 'Y')
fill({(x, y) for x, y in crown if (x * 5 + y * 3) % 11 == 0}, 'Y')
fill(edge(crown), 'K')
fill(ell(56, 35, 6, 1.1), 'K')
cl = ell(5, 5, 5, 2) | ell(8, 3.5, 3.5, 2.3) | ell(42, 22, 4, 1.6) | ell(45, 21, 3, 2); fill(cl, 'W'); fill({(x, y) for x, y in cl if (x, y + 1) not in cl}, 'S')  # くも
# スケッチブック（右の しばふの上。ななめに おく）
fill(ell(49, 46, 15, 1.2), 'K')
book = poly([(36, 30), (61, 28), (64, 45), (33, 46)])
fill(book, 'W'); fill({(x, y) for x, y in book if (x, y + 2) not in book or (x + 2, y) not in book}, 'S')
fill(edge(book), 'K')
fill({(x, 29) for x in range(38, 61, 3)} & book, 'K')                                             # リング
# 絵：さかな と おひさま と なみ
fish = ell(47, 37.5, 6.5, 3.4); tailf = poly([(53, 37), (58, 33), (58, 42)])
fill(fish | tailf, 'B'); fill({(x, y) for x, y in fish if y < 37}, 'S')
fill({(46, 36), (44, 36), (45, 39), (48, 39)}, 'P')                                            # うろこ
fill(edge(fish | tailf), 'K'); fill({(42, 36)}, 'K'); fill({(41, 36), (41, 37)}, 'W')            # 目
fill(ell(57, 31.5, 1.6, 1.4), 'O')
fill({(x, 43 + (x // 2) % 2) for x in range(37, 61)} & book, 'S')
# ちらばった クレヨン
for (x, y), c in (((30, 44), 'R'), ((33, 46), 'Y'), ((26, 46), 'B')):
    fill(line(x, y, x + 3, y - 1), c); fill({(x + 3, y), (x + 4, y - 1)}, 'K')
# ねこ（すわって 右むき。オレンジの しまもよう・しろい むね）
fill(ell(24, 44, 13, 1.3), 'K')
tail = (ell(11, 33, 6, 8) - ell(12, 33, 3.2, 5.5)) & rect(0, 25, 13, 42)
shape(tail, 'O'); fill({(6, 30), (5, 33), (6, 36), (8, 27)}, 'C')
body = ell(24, 32, 11.5, 12)   # 頭と 3 マス以上 重ねて 首を 太く
shape(body, 'O')
fill({(x, y) for x, y in body if (x - 2, y) not in body or (x, y - 2) not in body} - edge(body), 'Y')
for sx in (15, 18): fill(line(sx, 30, sx + 1, 36) & (body - edge(body)), 'C')
chest = ell(28, 33, 4.5, 7); fill(chest & (body - edge(body)), 'W')
for fx in (19, 30):
    f = ell(fx, 43, 4, 2.2); shape(f, 'W'); fill({(fx - 1, 44), (fx + 1, 44)}, 'K')
earL = poly([(14, 10), (15, 1), (21, 7)]); earR = poly([(28, 6), (35, 0), (36, 10)])
for e in (earL, earR):
    shape(e, 'O'); fill({(x, y) for x, y in e if (x, y - 2) in e and (x - 1, y) in e and (x + 1, y) in e} - edge(e), 'P')
head = ell(25, 14.5, 12.5, 9.5)
shape(head, 'O')
fill({(x, y) for x, y in head if (x - 2, y) not in head or (x, y - 2) not in head} - edge(head), 'Y')
fill(line(23, 7, 23, 10) | line(26, 6, 26, 9) | line(29, 7, 29, 9), 'C')                        # 頭の しま
mz = ell(29, 19.5, 5.5, 3.5); fill(mz, 'W')
fill(ell(21, 14, 1.7, 2.4), 'K'); put(21, 13, 'W')                                              # 目（下の 紙を みる）
fill(ell(31, 14, 1.7, 2.4), 'K'); put(31, 13, 'W')
fill(rect(28, 17, 30, 17) | {(29, 18)}, 'P')                                                    # 鼻
fill({(27, 20), (28, 21), (29, 20), (30, 21), (31, 20)}, 'K')                                   # 口
fill(rect(16, 18, 18, 18) | rect(34, 18, 35, 18), 'P')                                          # ほっぺ
fill(line(35, 19, 40, 18) | line(35, 21, 40, 22), 'K')                                          # ひげ
fill(edge(head), 'K')
# 手前のうで と クレヨン（紙へ）
arm = poly([(29, 28), (34, 31), (38, 35), (36, 38), (31, 34), (27, 31)])
shape(arm, 'O'); fill({(x, y) for x, y in arm if (x, y - 1) not in arm} - edge(arm), 'Y')
paw = ell(37.5, 37, 2.5, 2.2); shape(paw, 'W')
cr = line(39, 37, 42, 40, 1); fill(cr, 'R'); fill({(43, 41), (43, 40)}, 'K'); fill(line(40, 38, 41, 39), 'W')
fill(line(42, 41, 44, 42), 'R')                                                                 # かいた 線

finish('nekokouenoekaki', globals().get('HOLE', 'W'))
