# うみべで うさぎが ボールで あそぶ（usagiumibebooru・段 XXL・64x48）
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

# うみべで うさぎが ボールで あそぶ：ぴょんと はねて ビーチボールを 上へ はじく うさぎ（絵の半分）。場所の物は 海 と パラソル の 2 つ。
HZ = 17
def shore(x): return 25 + x * 0.05 + 1.0 * math.sin(x / 4 + 2)
for y in range(HZ, H):
    for x in range(W):
        if (x - 32) ** 2 / 34 ** 2 + (y - 18) ** 2 / 30.5 ** 2 > 1 and y > 34: continue   # 下のすみを丸く
        s = shore(x)
        if y < HZ + 2: c = 'B'
        elif y < s - 1: c = 'W' if ((y - HZ) % 3 == 0 and (x * 3 + y) % 13 < 3) else 'S'
        elif y < s + 0.6: c = 'W'
        elif y < s + 2: c = 'O' if (x // 2 + y) % 3 == 0 else 'Y'
        else: c = 'O' if (x * 13 + y * 7) % 27 == 0 else 'Y'
        put(x, y, c)
# パラソル（左奥）と その かげ
fill(ell(8, 43, 9, 2.2), lambda x, y: 'O' if g[y][x] in 'YO' else None)
fill(line(7, 6, 7, 40, 1), 'C'); fill(line(8, 6, 8, 40), 'K')
cx, cy = 7, 6
dome = {(x, y) for (x, y) in ell(cx, cy, 11, 6) if y <= cy + 1 + (1 if (x // 4) % 2 else 0)}
def stripe(x, y):
    k = math.floor((x - cx) / (y - cy + 10) * 4.2 + 0.5) % 2
    return 'G' if k == 0 else 'W'
fill(dome, stripe); fill(edge(dome), 'K'); fill({(6, 0), (7, 0)}, 'K')
# うさぎの かげ（はねているので 体から はなれて 小さい）
fill(ell(29, 45, 9, 1.4), lambda x, y: 'O' if g[y][x] in 'YO' else None)
fill(ell(29, 45, 5, 0.8), 'K')
# うさぎ（右を向いて はねる。白い体・ピンクの耳）
def wsh(m):
    fill({(x, y) for x, y in m if (x + 2, y) not in m or (x, y + 2) not in m} - edge(m), 'S')
earB = ell(30, 6, 2.8, 7.5, 25); earF = ell(24, 7, 3.2, 8, -8)
foot = ell(19, 39, 7, 2.6, 25)
thigh = ell(21, 33, 6, 6)
body = ell(27, 30, 9, 9.5, -30)
tail = ell(17, 28, 2.6, 2.6)
armB = poly([(30, 24), (37, 17), (40, 19), (33, 27)])
armF = poly([(31, 27), (40, 21), (42, 24), (34, 31)])
head = ell(29, 17, 8.5, 7)
shape(earB, 'W'); fill(ell(30, 6.5, 1.2, 5.5, 25), 'P'); fill(edge(earB), 'K')
shape(armB, 'W'); wsh(armB); fill(edge(armB), 'K')
shape(tail, 'W'); shape(foot, 'W'); wsh(foot); fill(edge(foot), 'K')
shape(body, 'W'); wsh(body); fill(edge(body), 'K')
shape(thigh, 'W'); wsh(thigh); fill(edge(thigh), 'K')
shape(armF, 'W'); wsh(armF); fill(edge(armF), 'K')
for p in (ell(39.5, 18, 2.2, 2.2), ell(41.5, 22.5, 2.2, 2.2)): shape(p, 'W')
shape(head, 'W'); wsh(head); fill(edge(head), 'K')
shape(earF, 'W'); fill(ell(24, 7.5, 1.4, 6, -8), 'P'); fill(edge(earF), 'K')
fill(ell(32, 15, 1.4, 2), 'K'); put(32, 14, 'W')                                # 目（ボールを見る）
fill({(37, 18), (36, 18), (37, 19)}, 'P')                                       # 鼻
fill({(35, 20), (36, 21), (37, 20)}, 'K')                                        # 口
fill(rect(29, 19, 31, 20), 'P')                                                  # ほっぺ
fill(line(13, 27, 14, 26) | line(12, 31, 14, 31), 'K')   # はねた線
# ビーチボール（右上。4 色の しま）
cx, cy, r = 50, 12, 9.5
ball = ell(cx, cy, r, r)
def seg(x, y):
    a = math.atan2(y - cy, x - cx) + 0.5
    return 'RYBW'[int((a + math.pi) / (math.pi / 2)) % 4]
fill(ball, seg); fill(ell(cx, cy, 2.2, 2.2), 'W')
fill({(x, y) for x, y in ball if (x + 2, y + 2) not in ball}, lambda x, y: {'R': 'C', 'W': 'S', 'B': 'B', 'Y': 'O'}[g[y][x]])
fill({(45, 7), (46, 6), (45, 8), (47, 6)}, 'W')
fill(edge(ball), 'K')
fill(line(43, 25, 41, 27) | line(48, 25, 48, 27) | line(55, 24, 57, 26), 'K')

finish('usagiumibebooru')
