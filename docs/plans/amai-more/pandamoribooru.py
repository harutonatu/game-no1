# もりで ぱんだが ボールで あそぶ（pandamoribooru・段 XXL・64x48）
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

# ぱんだ（しろい体・くろい耳・目のまわり・うで・あし。白い所は K のふちで区切る。頬はピンク）
def wsh(m):
    fill({(x, y) for x, y in m if (x + 2, y) not in m or (x, y + 2) not in m} - edge(m), 'S')
def blk(m):
    fill(m, 'K'); e = edge(m); mx = sum(x for x, y in m) / len(m); my = sum(y for x, y in m) / len(m)
    fill({(x, y) for x, y in m if (x, y) not in e and x < mx and y < my and (x - 1, y - 1) in e}, 'B')   # くろい所の 光（左上に ほそく）
def wpart(m):
    fill(m, 'W'); wsh(m); fill(edge(m), 'K')
def pface(cx, cy, sleep=False, look=0):
    # 目のまわり（ななめの たまご形）・目・鼻・口・ほっぺ
    pl = ell(cx - 4.5, cy + 0.5, 2.4, 3.4, 25); pr = ell(cx + 4.5, cy + 0.5, 2.4, 3.4, -25)
    fill(pl | pr, 'K')
    if sleep:
        fill({(cx - 6, cy + 1), (cx - 5, cy + 1), (cx - 4, cy + 1), (cx + 4, cy + 1), (cx + 5, cy + 1), (cx + 6, cy + 1)}, 'W')
    else:
        for ex in (cx - 4 + look, cx + 5 + look):
            put(ex, cy, 'W'); put(ex, cy - 1, 'W')
    fill(rect(cx - 1, cy + 3, cx + 1, cy + 3) | {(cx, cy + 4)}, 'K')
    fill({(cx, cy + 5), (cx - 1, cy + 6), (cx + 1, cy + 6), (cx - 2, cy + 6), (cx + 2, cy + 6)}, 'K')
    fill(rect(cx - 8, cy + 4, cx - 6, cy + 5) | rect(cx + 6, cy + 4, cx + 8, cy + 5), 'P')
# もりで ぱんだが ボールで あそぶ：頭の上に ボールを のせて、両手を ひろげて バランスを とる ぱんだ（絵の半分）。場所の物は 背の高い木 と 切りかぶ の 2 つ。
FY = 31
for y in range(FY, H):
    for x in range(W):
        c = 'G'
        h = (x * 73856093 ^ y * 19349663) % 97                     # 草の中の 花と 落ち葉（ばらばらに）
        if h < 4: c = 'Y'
        elif h < 7: c = 'O'
        elif h < 9: c = 'R'
        put(x, y, c)
fill({(x, FY) for x in range(W)}, 'K')
# 背の高い木（右）
trunk = poly([(48, 46), (62, 46), (59, 40), (58, 10), (52, 10), (51, 40)])
shape(trunk, 'C', sh='K', d=2)
fill({(x, y) for x, y in trunk if (x, y) not in edge(trunk) and (x - 1, y) not in trunk}, 'O')
for y in range(14, 42, 5): fill(line(54, y, 55, y + 1), 'K')
fill(ell(55, 46, 10, 1.3) - trunk, 'K')
can = ell(55, 6, 10, 7) | ell(46, 11, 5, 4) | ell(63, 12, 5, 5)
fill(can, 'G'); fill({(x, y) for x, y in can if (x, y + 2) not in can or (x + 2, y) not in can}, 'C')
fill({(x, y) for x, y in can if (x * 3 + y * 5) % 11 == 0 and (x, y - 2) in can}, 'Y'); fill(edge(can), 'K')
# 切りかぶ（左）
st = rect(0, 36, 8, 44); shape(st, 'C', sh=None)
fill({(x, y) for x, y in st if x >= 6 and (x, y) not in edge(st)}, 'K') if False else None
top = ell(4, 36, 5, 2); fill(top, 'O'); fill(ell(4, 36, 2.5, 1), 'Y'); fill(edge(top), 'K'); fill(edge(st) - top, 'K')
for x in (3, 6): fill(line(x, 39, x, 43), 'K')
fill(ell(5, 45, 6, 1.0) - st, 'K')
# ぱんだの かげ
fill(ell(24, 46, 14, 1.3), 'K')
# ぱんだ（すわって 頭に ボール。両手を ひろげる）
legL = ell(15, 42, 5.5, 4, -15); legR = ell(33, 42, 5.5, 4, 15)
body = ell(24, 35, 10.5, 9.5)
head = ell(24, 19.5, 10.5, 8.5)
earL = ell(15, 12, 3.6, 3.4); earR = ell(33, 12, 3.6, 3.4)
armL = poly([(17, 28), (8, 22), (5, 26), (15, 33)])
armR = poly([(31, 28), (40, 22), (43, 26), (33, 33)])
fill(earL | earR, 'K'); fill({(14, 11), (13, 11), (33, 11), (32, 11)}, 'B')
wpart(body)
blk(legL); blk(legR)
fill(ell(12.5, 43, 2, 1.4) | ell(35.5, 43, 2, 1.4), 'P')
blk(armL); blk(armR)
fill(ell(6, 23, 2, 1.6) | ell(42, 23, 2, 1.6), 'P')
wpart(head)
pface(24, 19, look=0)
fill({(23, 24), (24, 25), (25, 24)}, 'P')
# ボール（頭の上。あか・きいろ・あお・しろ）
bx, by, br = 24, 6, 5.5
ball = ell(bx, by, br, br)
def bcol(x, y):
    a = math.atan2(y - by, x - bx); return 'RYBW'[int((a + math.pi) / (math.pi / 3)) % 4]
fill(ball, bcol); fill(ell(bx, by, 1.5, 1.5), 'W'); fill({(bx - 3, by - 3), (bx - 2, by - 4)}, 'W'); fill(edge(ball), 'K')
# ゆらゆらの線
fill(line(15, 4, 16, 6) | line(14, 8, 15, 9) | line(33, 4, 32, 6) | line(34, 8, 33, 9), 'K')

finish('pandamoribooru')
