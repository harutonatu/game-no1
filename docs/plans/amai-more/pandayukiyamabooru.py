# ゆきやまで ぱんだが ボールで あそぶ（pandayukiyamabooru・段 XXL・64x48）
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
# ゆきやまで ぱんだが ボールで あそぶ：雪の上に すわり、ボールを だっこする ぱんだ（絵の半分）。場所の物は 雪の山 と もみの木 の 2 つ。
FY = 30
mt = poly([(30, FY + 1), (44, 6), (48, 10), (55, 2), (64, 12), (64, FY + 1)])
pk = [(44, 6), (55, 2)]
def mcol(x, y):
    for px, py in pk:
        if y < py + 5 + (x % 3) and abs(x - px) < 6: return 'W'
    for px, py in pk:
        if x > px and (x - px) < (y - py) * 0.35 and y < FY - 1: return 'B'
    return 'S'
fill(mt, mcol); fill(edge(mt), 'K')
# もみの木（左奥）
fill(rect(6, 24, 7, FY), 'C'); fill({(7, y) for y in range(24, FY + 1)}, 'K')
fir = poly([(6.5, 4), (1, 13), (4, 13), (0, 20), (3, 20), (-1, 26), (14, 26), (10, 20), (13, 20), (9, 13), (12, 13)])
fill(fir, lambda x, y: 'W' if y in (13, 14, 20, 21) else 'G'); fill(edge(fir), 'K')
# 雪の地面
for y in range(FY, H):
    for x in range(W):
        put(x, y, 'S' if ((y - FY) % 5 == 3 and (x + y * 3) % 13 < 3) else 'W')
fill({(x, FY) for x in range(W)} - rect(16, FY, 34, FY), 'K')
# 雪の つぶ
for x, y in ((18, 3), (36, 1), (32, 12), (60, 22), (40, 18), (2, 1)): fill({(x, y), (x + 1, y), (x, y + 1)}, 'S')
# ぱんだの かげ
fill(ell(25, 45, 15, 1.4), 'S')
# ぱんだ（すわって 両手で ボールを だっこ。今にも なげそう）
legL = ell(14, 42, 5.5, 4, -15); legR = ell(36, 42, 5.5, 4, 15)
body = ell(25, 34, 11, 10)
head = ell(25, 17, 10.5, 8.5)
earL = ell(16, 9.5, 3.6, 3.4); earR = ell(34, 9.5, 3.6, 3.4)
armL = poly([(16, 26), (12, 33), (17, 38), (20, 35), (17, 32), (20, 28)])
armR = poly([(34, 26), (38, 33), (33, 38), (30, 35), (33, 32), (30, 28)])
fill(earL | earR, 'K'); fill({(15, 9), (14, 9), (34, 9), (33, 9)}, 'B')
wpart(body)
blk(legL); blk(legR)
fill(ell(11.5, 43, 2, 1.4) | ell(38.5, 43, 2, 1.4), 'P')
wpart(head)
pface(25, 16)
fill({(24, 21), (25, 22), (26, 21)}, 'P')
bx, by, br = 25, 33, 6.5
ball = ell(bx, by, br, br)
fill(ball, lambda x, y: 'R' if (x - bx + (y - by) * 0.4) % 6 < 3 else ('Y' if x < bx else 'W'))
fill({(x, y) for x, y in ball if (x + 2, y) not in ball or (x, y + 2) not in ball}, 'O')
fill({(bx - 3, by - 4), (bx - 4, by - 3), (bx - 3, by - 3)}, 'W'); fill(edge(ball), 'K')
blk(armL); blk(armR)
# うれしい しるし
fill(line(9, 2, 11, 4) | line(39, 4, 41, 2) | line(7, 7, 9, 7) | line(41, 7, 43, 7), 'O')

finish('pandayukiyamabooru')
