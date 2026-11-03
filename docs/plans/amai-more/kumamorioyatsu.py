# もりで くまが おやつを たべる（kumamorioyatsu・段 XXL・64x48）
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

# もりで くまが おやつを たべる：カップケーキを もつ くま（絵の半分）。場所の物は 高い木 と きのこ の 2 つ。
# 地面（落ち葉と草。奥へ すぼまる すじ）y 38..47
FY = 37
for y in range(FY, H):
    for x in range(W):
        k = (x * 7 + y * 13) % 17
        put(x, y, 'O' if k in (0, 5) else ('Y' if k == 9 else ('R' if k == 12 and y > 41 else 'G')))
fill({(x, FY) for x in range(W)}, 'K')
# 高い木（左。みき C・葉 G）
trunk = poly([(1, 12), (7, 12), (8, 38), (11, 44), (0, 44), (1, 38)])
shape(trunk, 'C')
fill({(x, y) for x, y in trunk if (x - 2, y) not in trunk} - edge(trunk), 'O')                 # 左の光
fill({(x, y) for x, y in trunk if (x + 2, y) not in trunk} - edge(trunk), 'K')                 # 右のかげ
fill(line(4, 16, 4, 20) | line(6, 25, 6, 29) | line(3, 32, 3, 35), 'K')                        # 木の すじ
leaf = ell(5, 3, 9, 6) | ell(12, 9, 5.5, 4.5) | ell(1, 11, 5, 4.5) | ell(7, 12, 5, 3.5)
fill(leaf, 'G')
fill({(x, y) for x, y in leaf if (x - 3, y - 3) not in leaf and (x - 1, y - 1) in leaf}, 'Y')                             # 葉の光（左上）
fill({(x, y) for x, y in leaf if (x + 2, y + 1) not in leaf and (x, y + 2) not in leaf}, 'C')
fill({(x, y) for x, y in leaf if (x * 5 + y * 3) % 13 == 0 and (x, y) not in edge(leaf)}, 'Y')
fill(edge(leaf), 'K')
fill(ell(7, 45, 8, 1.3), 'K')                                                                  # 木のかげ
# きのこ（右の手前。赤いかさに白い点）
def kinoko(cx, cy, r):
    st = rect(cx - r // 2, cy, cx + r // 2, cy + r)
    shape(st, 'W'); fill({(x, y) for x, y in st if (x + 1, y) not in st} - edge(st), 'S')
    cap = ell(cx, cy + 0.5, r * 1.5, r * 1.6) - rect(0, cy + 1, W, H)
    fill(cap, 'R'); fill({(x, y) for x, y in cap if (x - 2, y) not in cap or (x, y - 2) not in cap}, 'P')
    for dx, dy in ((-r // 2, -r // 3), (r // 2, -r // 2), (0, -r * 2 // 3 + 1)):
        put(cx + dx, cy + dy, 'W'); put(cx + dx + 1, cy + dy, 'W')
    fill(edge(cap), 'K'); fill(edge(st) - {(x, cy) for x in range(W)}, 'K')
fill(ell(17, 46, 8, 1.2) | ell(59, 46, 4, 1), 'K')
kinoko(16, 39, 5); kinoko(59, 42, 3)
# くま（すわって 少し右むき。茶色の体・おなかは オレンジ）
fill(ell(35, 46, 15, 1.3), 'K')                                                                # 地面のかげ
body = ell(34, 34, 13, 11)
shape(body, 'C', sh='K')
fill({(x, y) for x, y in body if (x - 2, y) not in body or (x, y - 2) not in body} - edge(body), 'O')
belly = ell(36, 36, 7, 7)
fill(belly, 'O'); fill({(x, y) for x, y in belly if (x - 1, y - 1) not in belly}, 'Y')
armL = poly([(23, 30), (18, 36), (20, 39), (26, 34)])                                          # 奥のうで
shape(armL, 'C')
for cx in (26, 44):                                                                            # 足のうら
    f = ell(cx, 43, 5, 3); shape(f, 'C'); fil = ell(cx, 43.3, 2.6, 1.6); fill(fil, 'P'); fill(edge(fil), 'C')
earL = ell(24, 5, 4.5, 4.5); earR = ell(45, 5, 4.5, 4.5)
shape(earL, 'C'); fill(ell(24, 5.5, 2.4, 2.4), 'P')
shape(earR, 'C'); fill(ell(45, 5.5, 2.4, 2.4), 'P')
head = ell(34, 15, 13, 10.5)
shape(head, 'C', sh='K')
fill({(x, y) for x, y in head if ((x - 2, y) not in head or (x, y - 2) not in head)} - edge(head), 'O')
mz = ell(38, 19.5, 5.6, 4.2)                                                                   # 口まわり
fill(mz, 'W'); fill({(x, y) for x, y in mz if (x, y + 1) not in mz}, 'S'); fill(edge(mz), 'K')
fill(rect(36, 17, 40, 18) | rect(37, 19, 39, 19), 'K'); put(37, 17, 'W')                        # 鼻
mouth = rect(37, 21, 39, 22)
fill(mouth, 'R'); fill({(36, 21), (40, 21), (36, 22), (40, 22), (37, 23), (38, 23), (39, 23)}, 'K'); put(38, 22, 'P')
for ex, ey, rx in ((28, 13, 1.6), (42, 12, 1.8)):                                              # 目
    e = ell(ex, ey, rx, 2.2); fill(e, 'K'); put(ex, ey - 1, 'W')
fill(ell(28, 18, 2.2, 1.2), 'P')                                                               # ほっぺ
# うで と カップケーキ（口の前へ。ひと口 かじった）
arm = poly([(40, 36), (43, 31), (46, 28), (50, 30), (46, 34), (43, 39)])
shape(arm, 'C'); fill({(x, y) for x, y in arm if (x - 1, y - 1) not in arm} - edge(arm), 'O')
cup = poly([(43, 21), (56, 21), (54, 29), (45, 29)])
fill(cup, lambda x, y: 'S' if (x // 2) % 2 == 0 else 'W'); fill(edge(cup), 'K')
cream = (ell(49.5, 18.5, 7, 3.4) | ell(49.5, 15, 5, 2.6) | ell(49.5, 12.5, 2.6, 1.8)) - ell(42.5, 16.5, 2.2, 2.2)
fill(cream, 'P'); fill({(x, y) for x, y in cream if (x - 1, y - 1) not in cream}, 'W')
fill(line(45, 19, 54, 18), 'K'); fill(line(47, 15, 53, 15), 'K')                               # うずまきの すじ
fill({(46, 17), (51, 20), (54, 17), (49, 13), (47, 21)}, 'Y')                                  # つぶ
fill(edge(cream), 'K')
fill(ell(50, 8.5, 1.8, 1.6), 'R'); fill(edge(ell(50, 8.5, 1.8, 1.6)), 'K'); put(49, 8, 'W')     # さくらんぼ
fill(line(51, 7, 53, 5), 'C')
paw = ell(49, 29, 3, 2.6); shape(paw, 'C'); fill({(48, 28), (49, 28)}, 'O')
# 木もれ日（空の きらきら）
for x, y in ((31, 1), (60, 2), (20, 26), (57, 34)):
    fill({(x, y - 1), (x - 1, y), (x, y), (x + 1, y), (x, y + 1)}, 'Y')

finish('kumamorioyatsu', globals().get('HOLE', 'W'))
