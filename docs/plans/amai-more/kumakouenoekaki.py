# こうえんで くまが おえかきを する（kumakouenoekaki・段 XXL・64x48）
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

# こうえんで くまが おえかきを する：しばふに 紙を ひろげて クレヨンで 花を かく くま（絵の半分）。場所の物は 木 と 花だん の 2 つ。
FY = 24
for y in range(FY, H):
    for x in range(W):
        c = 'G'
        if (x * 7 + y * 11) % 19 == 0: c = 'Y'
        put(x, y, c)
fill({(x, FY) for x in range(W)}, 'K')
# 木（右奥）
trunk = poly([(50, FY + 4), (58, FY + 4), (56, FY), (55, 8), (53, 8), (52, FY)])
shape(trunk, 'C', sh='K', d=2)
fill(ell(54, FY + 4, 6, 1.2) - trunk, 'K')
can = ell(54, 7, 10, 7) | ell(46, 11, 5, 4) | ell(62, 11, 5, 4)
fill(can, 'G'); fill({(x, y) for x, y in can if (x, y + 2) not in can or (x + 2, y) not in can}, 'C')
fill({(x, y) for x, y in can if (x * 3 + y * 5) % 11 == 0 and (x, y - 2) in can}, 'Y'); fill(edge(can), 'K')
# 花だん（左奥。小さな花）
bed = ell(5, FY - 1, 6, 3)
fill(bed, 'G'); fill(edge(bed), 'K')
for x, y, c in ((2, 21, 'R'), (6, 20, 'Y'), (9, 22, 'P'), (4, 23, 'P')):
    fill({(x, y), (x + 1, y), (x, y - 1), (x + 1, y - 1)}, c)
# 紙（しばふの上。ななめに 置いた）
paper = poly([(32, 33), (57, 30), (63, 44), (35, 47)])
fill(ell(49, 46, 15, 1.3) - paper, 'K')
fill(paper, 'W'); fill({(x, y) for x, y in paper if (x, y + 1) not in paper or (x + 1, y) not in paper}, 'S'); fill(edge(paper), 'K')
# 紙の絵：たいよう・花（くきと葉）・あおい空の線
fill(ell(53, 34, 2.2, 1.8), 'Y'); fill({(56, 33), (50, 33), (53, 31)}, 'O')
fill(line(44, 37, 44, 44), 'G'); fill({(45, 41), (46, 40), (43, 42), (42, 41)}, 'G')
fill(ell(44, 36, 2.6, 2), 'R'); put(44, 36, 'Y')
fill(line(36, 36, 41, 35) | line(48, 39, 52, 38), 'B')
# クレヨン（紙の まわりに ころがる）
for x, y, c in ((33, 41, 'B'), (58, 46, 'Y'), (61, 41, 'R')):
    fill({(x, y), (x + 1, y), (x + 2, y), (x + 3, y)}, c); put(x + 3, y, 'K')
# くまの かげ
fill(ell(18, 46, 14, 1.3), 'K')
# くま（すわって 紙へ 手を のばす。ちゃいろの体・オレンジの おなか・白い口のまわり）
def lit(m, base, sh, hi):
    fill(m, base)
    fill({(x, y) for x, y in m if (x + 2, y) not in m or (x, y + 2) not in m}, sh)
    fill({(x, y) for x, y in m if ((x - 2, y) not in m or (x, y - 2) not in m) and (x + 2, y) in m and (x, y + 2) in m}, hi)
    fill(edge(m), 'K')
earL = ell(9, 5, 3.8, 3.8); earR = ell(27, 5, 3.8, 3.8)
head = ell(18, 14, 10.5, 9)
body = ell(18, 33, 11, 11)
armL = ell(7, 33, 3.5, 6, 15)
armR = poly([(25, 26), (36, 36), (33, 39), (22, 31)])
footL = ell(10, 43, 5, 3.4); footR = ell(26, 43, 5, 3.4)
for e in (earL, earR): lit(e, 'C', None, None)
fill(ell(9, 5.5, 1.8, 1.8) | ell(27, 5.5, 1.8, 1.8), 'P')
lit(armL, 'C', None, 'O')
lit(body, 'C', None, 'O')
belly = ell(19, 35, 6.5, 7); fill(belly, 'O'); fill({(x, y) for x, y in belly if (x - 1, y) not in belly or (x, y - 1) not in belly}, 'Y')
for f in (footL, footR):
    lit(f, 'C', None, None)
fill(ell(10, 43.5, 2.2, 1.5) | ell(26, 43.5, 2.2, 1.5), 'O')
lit(head, 'C', None, 'O')
muz = ell(20, 18.5, 4.5, 3.2); fill(muz, 'W'); fill(edge(muz), 'K')
fill(rect(19, 16, 21, 16) | {(20, 17)}, 'K')
fill({(20, 18), (19, 19), (21, 19)}, 'K')
fill(ell(14, 13, 1.3, 1.8), 'K'); put(14, 12, 'W'); fill(ell(25, 13, 1.3, 1.8), 'K'); put(25, 12, 'W')
fill(rect(10, 17, 12, 18) | rect(27, 17, 29, 18), 'P')
lit(armR, 'C', None, 'O')
paw = ell(35, 37, 2.6, 2.4); lit(paw, 'C', None, None); fill(edge(paw), 'K')
fill(line(37, 38, 39, 36, 1), 'R'); put(40, 35, 'K'); put(41, 35, 'K')

finish('kumakouenoekaki')
