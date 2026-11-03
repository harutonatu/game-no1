# うみべで ぱんだが ボールで あそぶ（pandaumibebooru・段 XXL・64x48）
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
# うみべで ぱんだが ボールで あそぶ：ビーチボールを 上へ ぽんと はじく ぱんだ（絵の半分）。場所の物は 海 と パラソル の 2 つ。
HZ = 13
def shore(x): return 22 + x * 0.04 + 1.0 * math.sin(x / 4 + 1)
for y in range(HZ, H):
    for x in range(W):
        if (x - 32) ** 2 / 35 ** 2 + (y - 14) ** 2 / 34.5 ** 2 > 1 and y > 34: continue
        s = shore(x)
        if y < HZ + 2: c = 'B'
        elif y < s - 1: c = 'W' if ((y - HZ) % 3 == 0 and (x * 3 + y) % 13 < 3) else 'S'
        elif y < s + 0.6: c = 'W'
        elif y < s + 2: c = 'O' if (x // 2 + y) % 3 == 0 else 'Y'
        else: c = 'O' if (x * 13 + y * 7) % 27 == 0 else 'Y'
        put(x, y, c)
# パラソル（右奥）と その かげ
fill(ell(56, 41, 8, 2), lambda x, y: 'O' if g[y][x] in 'YO' else None)
fill(line(57, 6, 57, 40, 1), 'C'); fill(line(58, 6, 58, 40), 'K')
cx, cy = 57, 6
dome = {(x, y) for (x, y) in ell(cx, cy, 10, 6) if y <= cy + 1 + (1 if (x // 4) % 2 else 0)}
fill(dome, lambda x, y: 'R' if math.floor((x - cx) / (y - cy + 10) * 4.2 + 0.5) % 2 == 0 else 'W'); fill(edge(dome), 'K'); fill({(56, 0), (57, 0)}, 'K')
# ぱんだの かげ
fill(ell(24, 45, 13, 1.4), lambda x, y: 'O' if g[y][x] in 'YO' else None)
# ぱんだ（立って 右上へ ボールを はじく）
legL = ell(16, 41, 5, 4.5, 10); legR = ell(30, 41, 5, 4.5, -10)
body = ell(23, 31, 10.5, 10)
armL = poly([(14, 25), (7, 31), (9, 35), (17, 29)])
armR = poly([(28, 24), (35, 13), (39, 15), (32, 28)])
head = ell(22, 14, 10.5, 8.5)
earL = ell(13.5, 6.5, 3.6, 3.4); earR = ell(30.5, 6.5, 3.6, 3.4)
fill(earL | earR, 'K'); fill({(13, 6), (12, 6), (30, 6), (29, 6)}, 'B')
blk(legL); blk(legR)
fill(ell(14.5, 43, 2, 1.4) | ell(31.5, 43, 2, 1.4), 'P')
wpart(body)
blk(armL); blk(armR)
fill(ell(8.5, 33.5, 2, 1.6) | ell(37.5, 13.5, 2, 1.6), 'P')
wpart(head)
pface(22, 13, look=1)
# ボール（右上。あか・きいろ・あお・しろ）
bx, by, br = 39, 6, 5
ball = ell(bx, by, br, br)
def bcol(x, y):
    a = math.atan2(y - by, x - bx); return 'RYBW'[int((a + math.pi) / (math.pi / 3)) % 4]
fill(ball, bcol); fill(ell(bx, by, 1.5, 1.5), 'W'); fill({(bx - 3, by - 3), (bx - 2, by - 4)}, 'W'); fill(edge(ball), 'K')
fill(line(32, 1, 33, 2) | line(31, 5, 32, 5) | line(44, 11, 45, 12), 'K')

finish('pandaumibebooru')
