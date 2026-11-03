# もりで うさぎが ボールで あそぶ（usagimoribooru・段 XXL・64x48）
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

# もりで うさぎが ボールで あそぶ：はねて ボールを 上へ はじく うさぎ（絵の半分）。場所の物は 背の高い木 と きのこ の 2 つ。
FY = 33
# 空（木の葉の すきまから 見える）
for y in range(0, FY):
    for x in range(W):
        pass
# 地面（草。奥へ うすく。落ち葉）
for y in range(FY, H):
    for x in range(W):
        c = 'G'
        if (x * 7 + y * 11) % 23 == 0: c = 'Y'
        if (x * 5 + y * 13) % 31 == 0: c = 'O'
        if (x * 3 + y * 17) % 41 == 0: c = 'R'
        put(x, y, c)
fill({(x, FY) for x in range(W)} - rect(0, FY, 13, FY), 'K')
for x in range(0, W, 3): put(x, FY + 1 + (x // 3) % 2, 'K') if (x // 3) % 4 == 1 else None
# 奥の しげみ（地面の線の上。奥行き）
bush = set()
for x in range(14, W):
    hgt = 3 + 2 * math.sin(x / 3.1) + 1.5 * math.sin(x / 1.7 + 1)
    for y in range(int(FY - hgt), FY): bush.add((x, y))
fill(bush, lambda x, y: 'Y' if (x * 5 + y * 3) % 13 == 0 else 'G'); fill(edge(bush) - {(x, FY - 1) for x in range(W)}, 'K')
# 背の高い木（左手前。みき C・葉 G）
trunk = poly([(3, 47), (14, 47), (11, 40), (10, 12), (5, 12), (5, 40)])
shape(trunk, 'C', sh='K', d=2)
fill({(x, y) for x, y in trunk if (x, y) not in edge(trunk) and (x - 1, y) not in trunk}, 'O')
for y in range(16, 44, 5): fill(line(7, y, 8, y + 1), 'K')
fill(ell(8, 46, 9, 1.4) - trunk, 'K')
can = ell(9, 8, 13, 9) | ell(1, 14, 7, 5) | ell(17, 13, 7, 5)
fill(can, 'G')
fill({(x, y) for x, y in can if (x, y + 2) not in can or (x + 2, y) not in can}, 'C')
fill({(x, y) for x, y in can if (x * 3 + y * 5) % 11 == 0 and (x, y - 2) in can}, 'Y')
fill(edge(can), 'K')
# きのこ（右下）
st = rect(55, 38, 58, 43); shape(st, 'W', sh='S', d=1)
cap = {(x, y) for x, y in ell(56.5, 38, 6, 4.5) if y <= 38}
shape(cap, 'R', sh=None)
fill({(54, 36), (55, 36), (58, 35), (59, 35), (57, 37), (61, 37), (52, 37)}, 'W')
fill(edge(cap), 'K'); fill(ell(57, 44, 5, 0.9) - st, 'K')
# うさぎの かげ
fill(ell(29, 45, 7, 1.0), 'K')
# うさぎ（右を向いて はねる）
OX, OY = 4, 0
def M(s): return {(x + OX, y + OY) for x, y in s}
def wsh(m):
    fill({(x, y) for x, y in m if (x + 2, y) not in m or (x, y + 2) not in m} - edge(m), 'S')
earB = M(ell(30, 6, 2.8, 7.5, 25)); earF = M(ell(24, 7, 3.2, 8, -8))
foot = M(ell(20, 40, 7, 2.6, 15))
thigh = M(ell(21, 34, 6, 6))
body = M(ell(27, 30, 9, 9.5, -30))
tail = M(ell(17, 28, 2.6, 2.6))
armB = M(poly([(30, 24), (37, 17), (40, 19), (33, 27)]))
armF = M(poly([(31, 27), (40, 21), (42, 24), (34, 31)]))
head = M(ell(29, 17, 8.5, 7))
shape(earB, 'W'); fill(M(ell(30, 6.5, 1.2, 5.5, 25)), 'P'); fill(edge(earB), 'K')
shape(armB, 'W'); wsh(armB); fill(edge(armB), 'K')
shape(tail, 'W'); shape(foot, 'W'); wsh(foot); fill(edge(foot), 'K')
shape(body, 'W'); wsh(body); fill(edge(body), 'K')
shape(thigh, 'W'); wsh(thigh); fill(edge(thigh), 'K')
shape(armF, 'W'); wsh(armF); fill(edge(armF), 'K')
for p in (M(ell(39.5, 18, 2.2, 2.2)), M(ell(41.5, 22.5, 2.2, 2.2))): shape(p, 'W')
shape(head, 'W'); wsh(head); fill(edge(head), 'K')
shape(earF, 'W'); fill(M(ell(24, 7.5, 1.4, 6, -8)), 'P'); fill(edge(earF), 'K')
fill(M(ell(32, 15, 1.4, 2)), 'K'); put(32 + OX, 14, 'W')
fill(M({(37, 18), (36, 18), (37, 19)}), 'P')
fill(M({(35, 20), (36, 21), (37, 20)}), 'K')
fill(M(rect(29, 19, 31, 20)), 'P')
# ボール（右上。あか・きいろ・あお・しろ）
bx, by, br = 53, 13, 6
ball = ell(bx, by, br, br)
def bcol(x, y):
    a = math.atan2(y - by, x - bx); k = int((a + math.pi) / (math.pi / 3)) % 4
    return 'RYBW'[k]
fill(ball, bcol); fill(ell(bx, by, 1.5, 1.5), 'W'); fill({(bx - 3, by - 3), (bx - 2, by - 4)}, 'W')
fill(edge(ball), 'K')
# うごきの線
fill(line(44, 16, 46, 18) | line(47, 21, 49, 22) | line(60, 21, 61, 23), 'K')

finish('usagimoribooru')
