# もりで いぬが ねむる（inumorinemuru・段 XXL・64x48）
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

# もりで いぬが ねむる：落ち葉の上で ふせて ねむる いぬ（絵の半分）。場所の物は 高い木 と きのこ の 2 つ。
# いぬ＝しろい体・ちゃいろの ぶち と たれ耳・あかい首輪（amai-redraw/inudaidokorooyatsu の いぬ と そろえる）
# 地面（落ち葉の じゅうたん）y 34..47
FY = 34
for y in range(FY, H):
    for x in range(W):
        k = (x * 37 + y * 91 + x * y * 13) % 17
        put(x, y, 'O' if k in (0, 4, 9, 14) else ('Y' if k in (2, 12) else ('R' if k == 6 else 'G')))
fill({(x, FY) for x in range(W)}, 'K')
# 奥の しげみ
bush = {(x, y) for x in range(14, W) for y in range(24, FY) if y >= 26 - 3 * math.sin(x / 4.0) ** 2}
fill(bush, 'G'); fill({(x, y) for x, y in bush if (x * 3 + y * 7) % 9 == 0}, 'Y')
fill({(x, y) for x, y in bush if (x, y - 1) not in bush}, 'K')
# 高い木（左。上は 絵の外へ）
trunk = poly([(1, 0), (10, 0), (10, 34), (14, 40), (0, 40), (0, 34)])
shape(trunk, 'C')
fill({(x, y) for x, y in trunk if (x - 1, y) not in trunk and x > 0} - edge(trunk), 'O')
fill({(x, y) for x, y in trunk if (x + 2, y) not in trunk} - edge(trunk), 'K')
fill(line(5, 6, 5, 10) | line(7, 15, 7, 20) | line(4, 24, 4, 28), 'K')
fill(edge(trunk) - {(x, 0) for x in range(W)}, 'K')
crown = ell(8, 1, 14, 8) | ell(27, 0, 10, 6.5) | ell(41, 0, 8, 4.5) | ell(18, 6, 7, 4.5)
fill(crown, 'G'); fill({(x, y) for x, y in crown if (x * 5 + y * 3) % 11 == 0}, 'Y')
fill({(x, y) for x, y in crown if (x, y + 2) not in crown} - edge(crown), 'C')
fill(edge(crown) - {(x, 0) for x in range(W)}, 'K')
# きのこ（右の手前）
def kinoko(cx, cy, r):
    st = rect(cx - r // 2, cy, cx + r // 2, cy + r)
    shape(st, 'W'); fill({(x, y) for x, y in st if (x + 1, y) not in st} - edge(st), 'S')
    cap = ell(cx, cy, r * 1.4, r * 0.9) - rect(0, cy + 1, W, H)
    fill(cap, 'R'); fill({(x, y) for x, y in cap if (x - 2, y) not in cap or (x, y - 2) not in cap}, 'P')
    for dx, dy in ((-r // 2, -r // 3), (r // 2, -r // 2)):
        put(cx + dx, cy + dy, 'W'); put(cx + dx + 1, cy + dy, 'W')
    fill(edge(cap), 'K'); fill(edge(st) - {(x, cy) for x in range(W)}, 'K')
# いぬ（ふせて ねむる。左むき）
fill(ell(35, 45, 25, 1.5), 'K')
WS = lambda m: {(x, y) for x, y in m if (x, y + 2) not in m or (x + 3, y) not in m}
tail = ell(57, 24, 2.6, 6, 35); shape(tail, 'C'); fill({(x, y) for x, y in tail if (x - 1, y) not in tail} - edge(tail), 'O')
body = ell(39, 33, 19, 10)
shape(body, 'W'); fill(WS(body) - edge(body), 'S')
spot = (ell(44, 27, 7, 4.5) | ell(51, 34, 3.5, 3.5)) & (body - edge(body))
fill(spot, 'C')
hind = ell(50, 41, 8, 4); shape(hind, 'W'); fill({(x, y) for x, y in hind if (x, y + 1) not in hind} - edge(hind), 'S')
fill({(43, 42), (45, 43)}, 'K')
pawA = ell(12, 41, 7, 2.6); pawB = ell(16, 43.5, 7, 2.4)
for p in (pawA, pawB):
    shape(p, 'W'); fill({(x, y) for x, y in p if (x, y + 1) not in p} - edge(p), 'S')
fill({(6, 41), (8, 41), (10, 44), (12, 44)}, 'K')                                              # 指
col = ell(31, 32, 2.3, 8.5, 8) & (body - edge(body)); fill(col, 'R'); fill({(x, y) for x, y in col if (x + 1, y) not in col}, 'K')  # 首輪
fill(ell(31, 38, 1.4, 1.4), 'Y'); fill(edge(ell(31, 38, 1.4, 1.4)), 'K')                         # すず
head = ell(19, 30, 11, 9)
snout = ell(9, 35, 6.5, 4)
shape(head | snout, 'W'); fill({(x, y) for x, y in head | snout if (x, y + 2) not in head | snout} - edge(head | snout), 'S')
fill(ell(15, 26, 3.6, 3), 'C')                                                                 # 目の もよう
fill({(12, 28), (13, 29), (14, 29), (15, 29), (16, 29), (17, 28)}, 'K')                       # とじた目
fill(rect(3, 33, 5, 34) | {(4, 35)}, 'K'); put(4, 33, 'W')                                     # 鼻
fill(line(6, 38, 12, 38), 'K')                                                                 # 口
fill(rect(13, 33, 16, 33), 'P')                                                                # ほっぺ
ear = ell(25, 32, 4, 8.5, -15)                                                                 # たれ耳
shape(ear, 'C'); fill({(x, y) for x, y in ear if (x - 1, y) not in ear} - edge(ear), 'O')
# Zzz
z(36, 17, 4); z(42, 12, 5); z(50, 6, 6)
# きのこ（右の手前。いぬの 足より 前）
fill(ell(58, 46, 7, 1.1), 'K')
kinoko(57, 41, 4); kinoko(62, 44, 3)

finish('inumorinemuru')
