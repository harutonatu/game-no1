# もりで ねこが ねむる（nekomorinemuru・段 XXL・64x48）
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

# もりで ねこが ねむる：切りかぶの上で まるくなって ねむる ねこ（絵の半分）。場所の物は 高い木 と 切りかぶ の 2 つ。
# 地面（落ち葉と草）y 38..47
FY = 38
for y in range(FY, H):
    for x in range(W):
        k = (x * 7 + y * 11) % 19
        put(x, y, 'O' if k in (0, 7) else ('Y' if k == 13 else ('R' if k == 3 and y > 41 else 'G')))
fill({(x, FY) for x in range(W)}, 'K')
# 奥の しげみ（地面の 向こうの 草の おか）
bush = {(x, y) for x in range(W) for y in range(28, FY) if y >= 31 - 3 * math.sin(x / 5.0) ** 2 - (x % 7 == 0)}
fill(bush, 'G'); fill({(x, y) for x, y in bush if (x * 3 + y * 7) % 9 == 0}, 'Y')
fill({(x, y) for x, y in bush if (x, y - 1) not in bush}, 'K')
# 高い木（右。みき C・葉 G。上は 絵の外へ のびる）
trunk = poly([(49, 8), (58, 8), (58, 36), (62, 42), (45, 42), (49, 36)])
shape(trunk, 'C')
fill({(x, y) for x, y in trunk if (x - 1, y) not in trunk} - edge(trunk), 'O')
fill({(x, y) for x, y in trunk if (x + 2, y) not in trunk} - edge(trunk), 'K')
fill(line(52, 14, 52, 18) | line(54, 23, 54, 28) | line(51, 31, 51, 34), 'K')
hole = ell(54, 20, 1.5, 2); fill(hole, 'K')                                                    # 木の うろ
crown = ell(53, 2, 11, 5) | ell(44, 4, 5, 3.5) | ell(62, 6, 4, 4)
fill(crown, 'G')
fill({(x, y) for x, y in crown if (x - 2, y - 2) not in crown and (x - 1, y - 1) in crown}, 'Y')
fill({(x, y) for x, y in crown if (x * 5 + y * 3) % 11 == 0}, 'Y')
fill(edge(crown) - {(x, 0) for x in range(W)}, 'K')
fill(ell(54, 43, 9, 1.2), 'K')
# 切りかぶ（左・ななめ上から 見た 年輪。ねこは 奥の はしに のる）
fill(ell(29, 45, 19, 1.6), 'K')
side = rect(11, 33, 47, 42) | ell(29, 42, 18, 2.6)
side |= poly([(8, 44), (13, 37), (15, 44)]) | poly([(43, 37), (47, 36), (51, 44), (44, 44)])       # 根っこ
shape(side, 'C')
fill({(x, y) for x, y in side if (x - 2, y) not in side} - edge(side), 'O')
for x0 in (16, 22, 29, 36, 42):                                                                # 木の皮（ゆれる すじ）
    fill({(x0 + (y % 3 == 0), y) for y in range(36, 43)} & side, 'K')
top = ell(29, 33, 18.5, 5)
fill(top, 'Y')
for r in (14, 9.5, 5, 1.5):
    fill(edge(ell(29, 33.5, r, r * 0.27 + 0.6)), 'O')
fill(edge(top), 'K')
# ねこ（まるくなって ねむる。オレンジの しまもよう・しろい むね）
body = ell(30, 23, 14, 7.5)
shape(body, 'O')
fill({(x, y) for x, y in body if (x, y + 2) not in body} - edge(body), 'C')                   # 下の かげ
fill({(x, y) for x, y in body if (x, y - 2) not in body and (x - 2, y) in body} - edge(body), 'Y')  # せなかの 光
for sx in (24, 29, 34, 39):                                                                    # しま
    fill(line(sx, 17, sx + 2, 21) & body, 'C')
tail = ell(34, 29.5, 10, 2.2) | ell(43, 27.5, 2.5, 2.8)
shape(tail, 'O'); fill({(x, y) for x, y in tail if (x, y + 1) not in tail} - edge(tail), 'C')
for tx in (30, 36): fill({(tx, 29), (tx, 30), (tx + 1, 29), (tx + 1, 30)}, 'C')
fill(edge(tail), 'K')
paw = ell(22, 29.5, 4, 2); shape(paw, 'W'); put(21, 30, 'K'); put(23, 30, 'K')
head = ell(17, 22, 8, 6.5)
shape(head, 'O')
fill({(x, y) for x, y in head if (x - 2, y) not in head or (x, y - 2) not in head} - edge(head), 'Y')
earL = poly([(10, 19), (11, 11), (16, 16)]); earR = poly([(17, 15), (22, 10), (24, 18)])
for e in (earL, earR):
    shape(e, 'O'); fill({(x, y) for x, y in e if (x, y - 2) in e and (x - 1, y) in e and (x + 1, y) in e} - edge(e), 'P')
fill(line(18, 16, 20, 15) | line(14, 16, 15, 17), 'C')                                         # 頭の しま
muzzle = ell(15, 25, 4.5, 2.6); fill(muzzle, 'W')
for ex in (11, 18):
    fill({(ex, 22), (ex + 1, 23), (ex + 2, 23), (ex + 3, 22)}, 'K')                            # とじた目
fill({(14, 24), (15, 24), (16, 24), (15, 25)}, 'P')                                            # 鼻
fill({(14, 26), (15, 26), (16, 26)} | {(13, 27), (17, 27)}, 'K')                              # 口
fill({(8, 25), (9, 25), (21, 25), (22, 25)}, 'P')                                              # ほっぺ
fill(edge(head) - body, 'K')
fill(line(5, 26, 10, 25) | line(5, 28, 10, 27), 'K')                                           # ひげ
# Zzz と 木もれ日
z(5, 8, 4); z(10, 3, 5); z(17, 0, 6)
for x, y in ((32, 3), (40, 12), (6, 34)):
    fill({(x, y - 1), (x - 1, y), (x, y), (x + 1, y), (x, y + 1)}, 'Y')
fill(ell(37, 6, 1.6, 1.0) | ell(28, 9, 1.4, 1.0), 'O')                                         # ひらひら 落ち葉

finish('nekomorinemuru')
