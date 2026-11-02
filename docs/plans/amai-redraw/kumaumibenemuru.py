# うみべで くまが ねむる（kumaumibenemuru・段 XL・64x48）
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

# うみべで くまが ねむる：あおむけで ねむる くま（絵の半分）。場所の物は 海 と パラソル の 2 つ。
HZ = 16
def shore(x): return 24.5 - x * 0.05 + 0.8 * math.sin(x / 4)
R0 = 14
for y in range(HZ, H):
    for x in range(W):
        if (x < R0 and y > H - 1 - R0 and (R0 - x) ** 2 + (y - (H - 1 - R0)) ** 2 > R0 * R0) or \
           (x > W - 1 - R0 and y > H - 1 - R0 and (x - (W - 1 - R0)) ** 2 + (y - (H - 1 - R0)) ** 2 > R0 * R0): continue
        s = shore(x)
        if y < HZ + 2: c = 'B'
        elif y < s - 1: c = 'W' if (y in (HZ + 3, HZ + 6) and (x // 4 + y) % 4 == 0) else 'S'
        elif y < s + 0.5: c = 'W'
        elif y < s + 2: c = 'O' if (x // 2 + y) % 3 == 0 else 'Y'
        else: c = 'O' if (x * 13 + y * 7) % 31 == 0 else 'Y'
        put(x, y, c)
# パラソル（左奥。柱は くまの頭の奥）
fill(ell(13, 44, 11, 2), lambda x, y: 'O' if g[y][x] in 'YO' else None)
fill(line(15, 7, 12, 27, 1), 'K')
cx, cy = 15, 6
dome = {(x, y) for (x, y) in ell(cx, cy, 14, 6.5, 5) if y <= cy + 1 + 0.08 * (x - cx) + (1 if (x // 4) % 2 else 0)}
def stripe(x, y):
    k = math.floor((x - cx) / (y - cy + 10) * 4.2 + 0.5) % 2
    return 'R' if k == 0 else 'W'
fill(dome, stripe); fill(edge(dome), 'K')
fill(rect(14, 0, 14, 0), 'K')
# タオル（あおと しろの しま。ななめに しく）
tw = poly([(4, 31), (58, 27), (63, 41), (2, 45)])
fill(tw, lambda x, y: 'B' if (x // 3) % 2 == 0 else 'W'); fill(edge(tw), 'K')
# くまのかげ
fill(ell(36, 43, 20, 1.6) & tw, 'K')
# くま（あおむけ。頭が左、足が右で上を向く）
footR = ell(55, 26, 3.6, 5, 15); footL = ell(49, 25, 3.6, 5, 5)
body = ell(37, 34, 16, 8.5)
belly = ell(37, 31, 10, 5)
head = ell(15, 31, 10, 9.5)
earL = ell(8, 22, 4, 4); earR = ell(22, 21.5, 4, 4)
armA = ell(33, 27, 6, 2.6, -15); armB = ell(43, 27.5, 5.5, 2.6, 20)
shape(footL, 'C', sh='K'); fill(ell(49, 22.5, 2.2, 2), 'O')
shape(body, 'C', sh='K')
fill(belly, 'O'); fill({(x, y) for x, y in belly if (x - 1, y - 1) not in belly or (x, y - 2) not in belly}, 'Y')
shape(footR, 'C', sh='K'); fill(ell(55.5, 23.5, 2.2, 2), 'O'); fill(edge(ell(55.5, 23.5, 2.2, 2)), 'C')
shape(armA, 'C'); shape(armB, 'C')
fill(line(30, 26, 35, 25) | line(41, 26, 45, 27), 'O')
shape(earL, 'C'); fill(ell(8, 22.5, 2, 2), 'O')
shape(earR, 'C'); fill(ell(22, 22, 2, 2), 'O')
shape(head, 'C', sh='K', hi='O')
mz = ell(16, 35, 5.5, 3.6)
fill(mz, 'W'); fill({(x, y) for x, y in mz if (x, y + 1) not in mz}, 'O'); fill(edge(mz), 'K')
fill(rect(14, 32, 18, 33) | rect(15, 34, 17, 34), 'K'); put(15, 32, 'W')        # 鼻
fill({(16, 35), (15, 36), (14, 36), (17, 36), (18, 36)}, 'K')                       # 口
for ex in (9, 20):                                                              # とじた目
    for dx, dy in ((0, 0), (1, 1), (2, 1), (3, 0)): put(ex + dx, 29 + dy, 'K')
fill({(7, 33), (8, 33), (22, 33), (23, 33)}, 'O')                                # ほっぺ
# Zzz（頭の上）と たいよう
z(27, 10, 5); z(34, 4, 6); z(43, 0, 5)
fill(ell(57, 5, 3.6, 3.6), lambda x, y: 'Y' if x + y < 61 else 'O')

finish('kumaumibenemuru')
