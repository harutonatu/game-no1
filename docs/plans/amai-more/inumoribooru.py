# もりで いぬが ボールで あそぶ（inumoribooru・段 XXL・64x48）
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

# もりで いぬが ボールで あそぶ：とんでくる ボールへ とびつく いぬ（絵の半分）。場所の物は 高い木 と きのこ の 2 つ。
# いぬ＝しろい体・ちゃいろの ぶち と たれ耳・あかい首輪（amai-redraw/inudaidokorooyatsu の いぬ と そろえる）
# 地面（落ち葉と草）y 37..47
FY = 37
for y in range(FY, H):
    for x in range(W):
        k = (x * 37 + y * 91 + x * y * 13) % 17
        put(x, y, 'O' if k in (0, 4, 9) else ('Y' if k in (2, 12) else ('R' if k == 6 else 'G')))
fill({(x, FY) for x in range(W)}, 'K')
# 奥の しげみ
bush = {(x, y) for x in range(W) for y in range(27, FY) if y >= 31 - 3 * math.sin(x / 4.5 + 1) ** 2}
fill(bush, 'G'); fill({(x, y) for x, y in bush if (x * 3 + y * 7) % 9 == 0}, 'Y')
fill({(x, y) for x, y in bush if (x, y - 1) not in bush}, 'K')
# 高い木（右。上は 絵の外へ）
trunk = poly([(52, 0), (61, 0), (61, 36), (64, 42), (48, 42), (52, 36)])
shape(trunk, 'C')
fill({(x, y) for x, y in trunk if (x - 1, y) not in trunk} - edge(trunk), 'O')
fill({(x, y) for x, y in trunk if (x + 2, y) not in trunk} - edge(trunk), 'K')
fill(line(55, 8, 55, 12) | line(57, 18, 57, 23) | line(54, 28, 54, 32), 'K')
fill(edge(trunk) - {(x, 0) for x in range(W)}, 'K')
crown = ell(56, 0, 11, 6) | ell(44, 0, 6, 3.5) | ell(64, 7, 4, 4)
fill(crown, 'G'); fill({(x, y) for x, y in crown if (x * 5 + y * 3) % 11 == 0}, 'Y')
fill({(x, y) for x, y in crown if (x, y + 2) not in crown} - edge(crown), 'C')
fill(edge(crown) - {(x, 0) for x in range(W)}, 'K')
fill(ell(56, 43, 9, 1.2), 'K')
# きのこ（左の手前）
def kinoko(cx, cy, r):
    st = rect(cx - r // 2, cy, cx + r // 2, cy + r)
    shape(st, 'W'); fill({(x, y) for x, y in st if (x + 1, y) not in st} - edge(st), 'S')
    cap = ell(cx, cy + 0.5, r * 1.5, r * 1.6) - rect(0, cy + 1, W, H)
    fill(cap, 'R'); fill({(x, y) for x, y in cap if (x - 2, y) not in cap or (x, y - 2) not in cap}, 'P')
    for dx, dy in ((-r // 2, -r // 3), (r // 2, -r // 2)):
        put(cx + dx, cy + dy, 'W'); put(cx + dx + 1, cy + dy, 'W')
    fill(edge(cap), 'K'); fill(edge(st) - {(x, cy) for x in range(W)}, 'K')
fill(ell(7, 46, 7, 1.1), 'K')
kinoko(6, 40, 4); kinoko(13, 43, 3)
# いぬ（うしろ足で 立ちあがり 左上の ボールへ）
fill(ell(36, 45, 12, 1.4), 'K')
WS = lambda m: {(x, y) for x, y in m if (x, y + 2) not in m or (x + 2, y) not in m}
tail = ell(50, 20, 2.4, 6, 30); shape(tail, 'C'); fill({(x, y) for x, y in tail if (x - 1, y) not in tail} - edge(tail), 'O')
hindB = poly([(42, 30), (47, 33), (46, 43), (42, 43)]); shape(hindB, 'W'); fill({(x, y) for x, y in hindB if (x + 1, y) not in hindB} - edge(hindB), 'S')
body = ell(36, 27, 13, 8, -25)
shape(body, 'W'); fill(WS(body) - edge(body), 'S')
fill(ell(41, 24, 5, 3.5, -25) & (body - edge(body)), 'C')                                        # せなかの ぶち
hind = poly([(36, 30), (42, 29), (41, 38), (39, 44), (32, 44), (35, 38)])
shape(hind, 'W'); fill({(x, y) for x, y in hind if (x + 2, y) not in hind} - edge(hind), 'S')
fill({(34, 43), (36, 43)}, 'K')
for pts in ([(26, 26), (30, 28), (23, 33), (19, 34), (18, 31)], [(28, 30), (32, 32), (26, 38), (22, 38), (22, 35)]):
    lg = poly(pts); shape(lg, 'W'); fill({(x, y) for x, y in lg if (x, y + 1) not in lg} - edge(lg), 'S')
fill({(19, 33), (23, 37)}, 'K')                                                                 # 指
neck = poly([(17, 18), (28, 15), (34, 25), (25, 31)])
shape(neck, 'W'); fill({(x, y) for x, y in neck if (x, y + 2) not in neck} - edge(neck), 'S')
col = (line(20, 27, 31, 19, 1) | line(20, 28, 31, 20, 1)) & neck
fill(col, 'R'); fill(({(x, y + 1) for x, y in col} | {(x, y - 1) for x, y in col}) & neck - col, 'K'); fill(edge(neck), 'K')
fill(ell(25, 25, 1.4, 1.4), 'Y'); fill(edge(ell(25, 25, 1.4, 1.4)), 'K')                         # すず
head = ell(20, 15, 9.5, 8.5)
snout = ell(11, 16, 5.5, 3.6, -15)
shape(head | snout, 'W'); fill({(x, y) for x, y in head | snout if (x, y + 2) not in head | snout} - edge(head | snout), 'S')
fill(edge(head | snout), 'K')
fill(ell(17, 11, 3.2, 3), 'C')                                                                  # 目の もよう
fill(ell(17, 12, 1.3, 1.8), 'K'); put(17, 11, 'W')                                              # 目（ボールを みる）
fill(ell(24, 11, 1.2, 1.7), 'K'); put(24, 10, 'W')
fill(rect(5, 13, 7, 14) | {(6, 15)}, 'K'); put(5, 13, 'W')                                      # 鼻
mouth = poly([(7, 18), (14, 18), (12, 22), (9, 21)]); fill(mouth, 'K')                           # あけた口
fill({(10, 20), (11, 20), (11, 21), (12, 20)}, 'P')                                             # した
fill(rect(20, 18, 22, 18), 'P')                                                                 # ほっぺ
ear = ell(26, 15, 3.5, 7, 15); shape(ear, 'C'); fill({(x, y) for x, y in ear if (x - 1, y) not in ear} - edge(ear), 'O')
# ボール（左上。赤と白の しま）
ball = ell(8, 5, 4.5, 4.5)
fill(ball, lambda x, y: 'R' if (x + y) % 6 < 3 else 'W'); fill({(6, 3), (7, 3), (6, 4)}, 'W')
fill(edge(ball), 'K')
fill(line(14, 1, 16, 0) | line(15, 4, 18, 4) | line(14, 7, 16, 8), 'K')                          # うごきの 線
fill({(31, 9), (33, 7), (35, 9), (33, 11), (33, 9)}, 'Y')                                       # きらきら

finish('inumoribooru', globals().get('HOLE', 'W'))
