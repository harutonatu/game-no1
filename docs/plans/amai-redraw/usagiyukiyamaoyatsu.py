# ゆきやまで うさぎが おやつを たべる（usagiyukiyamaoyatsu・段 XXL・64x48）
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

# ゆきやまで うさぎが おやつを たべる：マフラーを まいて 三色だんごを たべる うさぎ（絵の半分）。場所の物は 雪の山 と もみの木 の 2 つ。
# 雪の山（奥。あおい山はだに 白い雪の帽子。光は左上から）
peaks = [(14, 9, 17), (46, 2, 24)]
mt = set()
for px, py, hw in peaks:
    mt |= poly([(px - hw * 1.6, 27), (px, py), (px + hw * 1.6, 27)])
mt = {(x, y) for x, y in mt if 0 <= x < W and y < 27}
def mcol(x, y):
    best = min(peaks, key=lambda p: abs(x - p[0]) + (y - p[1]) * 0.2)
    px, py, hw = best
    snowline = py + 5 + 1.5 * math.sin(x * 1.3)
    if y < snowline: return 'S' if x > px + 1 else 'W'
    return 'B' if x > px else ('S' if (x + y) % 5 == 0 else 'B')
fill(mt, mcol)
fill({(x, y) for x, y in mt if (x, y - 1) not in mt}, 'K')
# 雪の野原（手前。ゆるい丘）
for y in range(20, H):
    for x in range(W):
        top = 25 + 2.2 * math.sin(x / 7 + 1)
        if y < top: continue
        if (x - 32) ** 2 / 33 ** 2 + (y - 16) ** 2 / 32.5 ** 2 > 1 and y > 34: continue
        c = 'W' if y < top + 3 else ('W' if (x * 7 + y * 3) % 11 == 0 or ((x + y // 2) % 9 < 3 and y % 4 == 1) else 'S')
        put(x, y, c)
fill({(x, round(25 + 2.2 * math.sin(x / 7 + 1))) for x in range(W)}, 'S')
# もみの木（右）
fill(ell(56, 41, 7, 1.4), 'B')
fill(rect(55, 36, 57, 41), 'C'); fill(rect(57, 36, 57, 41), 'K')
for i, (ty, hw) in enumerate(((13, 4), (20, 6), (27, 8))):
    tri = poly([(56 - hw, ty + 9), (56, ty), (56 + hw + 1, ty + 9)])
    fill(tri, lambda x, y: 'K' if x > 56 + (y - ty) * 0.5 else 'G')
    fill({(x, y) for x, y in tri if (x, y - 1) not in tri or (y == ty + 8 and x % 2 == 0)}, 'W')
    fill(edge(tri) - {(x, y) for x, y in tri if (x, y - 1) not in tri}, 'K')
fill({(56, 11), (55, 12), (57, 12), (56, 12), (56, 10)}, 'Y')                   # 木の上の ほし
# ゆき（空に ちらす）と たいよう
for x, y in ((3, 2), (8, 6), (22, 3), (30, 8), (35, 1), (62, 5), (60, 9), (4, 13), (27, 13)):
    put(x, y, 'W')
fill(ell(61, 1, 3, 3), lambda x, y: 'Y' if x + y < 62 else 'O')
# うさぎの かげ
fill(ell(24, 44, 14, 1.8), 'B')
# うさぎ（すわって 右を少し向く。白い体・マフラー・だんごを持つ）
def wsh(m):
    fill({(x, y) for x, y in m if (x + 2, y) not in m or (x, y + 2) not in m} - edge(m), 'S')
earB = ell(29, 7, 3.2, 8.5, 18); earF = ell(19, 7, 3.4, 8.5, -12)
body = ell(23, 35, 12, 9.5)
foot = ell(29, 43, 6, 2.2)
head = ell(24, 21, 10, 8)
shape(earB, 'W'); fill(ell(29, 7.5, 1.4, 6.5, 18), 'P'); fill(edge(earB), 'K')
shape(body, 'W'); wsh(body); fill(edge(body), 'K')
shape(foot, 'W'); wsh(foot); fill(edge(foot), 'K'); fill({(31, 43), (33, 43)}, 'K')
shape(head, 'W'); wsh(head); fill(edge(head), 'K')
shape(earF, 'W'); fill(ell(19, 7.5, 1.6, 6.5, -12), 'P'); fill(edge(earF), 'K')
# マフラー（あかに オレンジの しま。たれた はし）
sc = ell(24, 29, 10, 2.2)
fill(sc, lambda x, y: 'O' if x % 4 == 0 else 'R'); fill(edge(sc), 'K')
tailm = poly([(15, 29), (19, 30), (17, 38), (13, 37)])
fill(tailm, lambda x, y: 'O' if y % 3 == 0 else 'R'); fill(edge(tailm), 'K')
# かお
fill(ell(20, 20, 1.4, 2), 'K'); put(20, 19, 'W')
fill(ell(29, 20, 1.4, 2), 'K'); put(29, 19, 'W')
fill({(25, 23), (26, 23), (25, 24)}, 'P')                                       # 鼻
fill({(24, 25), (25, 26), (26, 25), (27, 26)}, 'K')                              # もぐもぐの口
fill(rect(17, 23, 19, 24) | rect(31, 23, 32, 24), 'P')                          # ほっぺ
# だんご（くしに さした 三色。右手で もつ）
fill(line(43, 34, 34, 18), 'C'); fill(line(44, 34, 35, 18), 'C')
for (dx, dy, c) in ((36, 21, 'P'), (38.5, 25.5, 'W'), (41, 30, 'G')):
    d = ell(dx, dy, 3.2, 2.8)
    fill(d, c); fill({(x, y) for x, y in d if (x - 1, y - 1) not in d}, 'W' if c != 'W' else 'S')
    fill(edge(d), 'K')
paw = ell(43, 34, 3.2, 3); shape(paw, 'W'); wsh(paw); fill(edge(paw), 'K')
paw2 = ell(14, 37, 3, 2.6); shape(paw2, 'W'); fill(edge(paw2), 'K')
# ゆげ（おいしい）
fill(line(38, 15, 39, 13) | line(39, 13, 38, 11) | line(41, 16, 42, 14), 'S')

finish('usagiyukiyamaoyatsu')
