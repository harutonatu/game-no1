# こうえんで うさぎが おえかきを する（usagikouenoekaki・段 XXL・64x48）
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

# こうえんで うさぎが おえかきを する：イーゼルの紙に 虹を かく うさぎ（絵の半分）。場所の物は 木 と イーゼル の 2 つ。
# 地面（しばふ。奥へ すぼまる すじ と 小さな花）y 37..47
FY = 37
for y in range(FY, H):
    for x in range(W):
        u = (x - 32) * 10 / (y - FY + 10)
        put(x, y, 'Y' if (math.floor(u / 5) + (y - FY) // 4) % 2 == 0 and (x + y) % 3 == 0 else 'G')
fill({(x, FY) for x in range(W)}, 'K')
for fx, fy in ((3, 42), (12, 45), (60, 44), (33, 46), (50, 40)):
    fill({(fx - 1, fy), (fx + 1, fy), (fx, fy - 1), (fx, fy + 1)}, 'W'); put(fx, fy, 'Y')
# 木（右おく。まるい葉）
trunk = poly([(56, 14), (61, 14), (61, 38), (63, 41), (54, 41), (56, 38)])
shape(trunk, 'C'); fill({(x, y) for x, y in trunk if (x - 1, y) not in trunk} - edge(trunk), 'O')
fill(line(58, 20, 58, 23) | line(59, 29, 59, 32), 'K')
crown = ell(58, 8, 6.5, 6.5) | ell(53, 12, 4.5, 4) | ell(62, 14, 4, 4) | ell(57, 14, 5, 3)
fill(crown, 'G')
fill({(x, y) for x, y in crown if (x - 2, y - 2) not in crown and (x - 1, y - 1) in crown}, 'Y')
fill({(x, y) for x, y in crown if (x * 5 + y * 3) % 11 == 0}, 'Y')
fill(edge(crown), 'K')
fill(ell(58, 41, 6, 1.2), 'K')
# イーゼル（左。ななめに 立つ 3 本足）
fill(line(16, 2, 17, 44, 1), 'C'); fill(line(18, 2, 19, 44), 'K')                              # うしろの足
legs = line(14, 4, 5, 45, 1) | line(20, 4, 29, 45, 1)
fill(legs, 'C'); fill({(x + 2, y) for x, y in legs} - legs, 'K')
fill(rect(15, 1, 19, 3), 'C'); fill(edge(rect(15, 1, 19, 3)), 'K')
paper = poly([(3, 6), (29, 4), (29, 30), (3, 31)])
fill(paper, 'W'); fill({(x, y) for x, y in paper if (x, y + 2) not in paper or (x + 2, y) not in paper}, 'S')
fill(edge(paper), 'K')
# 紙の絵：虹 と おひさま と 花
for r, c in ((10, 'R'), (8.5, 'O'), (7, 'Y'), (5.5, 'G'), (4, 'B')):
    arc = ell(16, 23, r, r * 0.95) - ell(16, 23, r - 1.5, (r - 1.5) * 0.95) - rect(0, 23, W, H)
    fill(arc & paper, c)
fill(ell(24, 9, 2.2, 2.2), 'O'); fill(ell(24, 9, 1.3, 1.3), 'Y')
fill(ell(8, 26.5, 1.6, 1.6), 'P'); put(8, 26, 'Y'); fill(line(8, 28, 8, 29), 'G')
fill(ell(12, 26.5, 1.6, 1.6), 'R'); put(12, 26, 'Y'); fill(line(12, 28, 12, 29), 'G')
tray = rect(2, 32, 30, 33)
fill(tray, 'C'); fill({(x, 32) for x in range(3, 30)}, 'O'); fill(edge(tray), 'K')
for i, c in enumerate('RYBG'):                                                                 # トレーの クレヨン
    fill(rect(6 + i * 4, 31, 8 + i * 4, 31), c)
fill(ell(17, 46, 13, 1.2), 'K')
# うさぎ（立って 左むき。しろい体・ピンクの耳の中）
fill(ell(44, 46, 11, 1.4), 'K')
WS = lambda m: {(x, y) for x, y in m if (x + 2, y) not in m or (x, y + 2) not in m}
earB = ell(48, 6, 2.8, 7.5, 12); earF = ell(41, 6, 3, 8, -10)
for e, ex in ((earB, 48), (earF, 41)):
    shape(e, 'W'); fill(WS(e) - edge(e), 'S')
    fill(ell(ex - (0.5 if ex == 48 else 0), 6.5, 1.2, 5.5, 12 if ex == 48 else -10), 'P')
body = ell(45, 33, 9, 10)
shape(body, 'W'); fill(WS(body) - edge(body), 'S')
fill(ell(43, 34, 4.5, 6) & (body - edge(body)), 'W')                                                          # おなか
tail = ell(54.5, 37, 2.6, 2.6); shape(tail, 'W')
for fx in (40, 49):
    f = ell(fx, 43.5, 4.5, 2.4); shape(f, 'W'); fill({(x, y) for x, y in f if (x, y + 1) not in f} - edge(f), 'S')
fill({(37, 43), (38, 43), (46, 43), (47, 43)}, 'K')                                           # 指
head = ell(44, 19, 10, 8.5)
shape(head, 'W'); fill(WS(head) - edge(head), 'S')
fill(ell(38, 17, 1.5, 2.2), 'K'); put(38, 16, 'W')                                             # 目
fill(ell(46, 17, 1.6, 2.3), 'K'); put(46, 16, 'W')
fill({(34, 20), (35, 20), (35, 21)}, 'P')                                                      # 鼻
fill({(36, 22), (37, 23), (38, 23), (39, 22)}, 'K')                                           # 口
fill(rect(40, 21, 42, 21) | rect(49, 20, 51, 21), 'P')                                         # ほっぺ
# うで と 筆（紙へ のばす）
arm = poly([(40, 27), (35, 24), (31, 22), (30, 25), (34, 28), (38, 31)])
shape(arm, 'W'); fill({(x, y) for x, y in arm if (x, y + 1) not in arm} - edge(arm), 'S')
paw = ell(31, 23.5, 2.4, 2.2); shape(paw, 'W')
brush = line(32, 21, 25, 15)
fill(brush, 'C'); fill(line(26, 16, 27, 17), 'Y'); fill({(24, 14), (25, 14), (24, 15)}, 'R')   # 筆先に 赤
fill(edge(body) - head - arm, 'K')

finish('usagikouenoekaki')
