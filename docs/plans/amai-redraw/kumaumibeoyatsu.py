# うみべで くまが おやつを たべる（kumaumibeoyatsu・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり）で描いて、文字の地図 kumaumibeoyatsu.txt を書き出す。
# ---- 部品（楕円・多角形・線・ふちどり・かげ）。見本 kumadaidokorooyatsu.py をまねた ----
import os, math
W, H = 64, 48
g = [['.'] * W for _ in range(H)]
ALL = {(x, y) for y in range(H) for x in range(W)}

def put(x, y, c):
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = c

def at(x, y):
    return g[y][x] if 0 <= x < W and 0 <= y < H else None

def ell(cx, cy, rx, ry, ang=0):
    a = math.radians(ang); ca, sa = math.cos(a), math.sin(a)
    s = set()
    for (x, y) in ALL:
        dx, dy = x + .5 - cx, y + .5 - cy
        u = dx * ca + dy * sa; v = -dx * sa + dy * ca
        if (u / rx) ** 2 + (v / ry) ** 2 <= 1.0:
            s.add((x, y))
    return s

def rect(x0, y0, x1, y1):
    return {(x, y) for y in range(max(0, y0), min(H - 1, y1) + 1) for x in range(max(0, x0), min(W - 1, x1) + 1)}

def poly(pts):
    s = set(); n = len(pts)
    for (x, y) in ALL:
        px, py = x + .5, y + .5; ins = False
        for i in range(n):
            ax, ay = pts[i]; bx, by = pts[(i + 1) % n]
            if (ay > py) != (by > py) and px < ax + (py - ay) * (bx - ax) / (by - ay):
                ins = not ins
        if ins: s.add((x, y))
    return s

def line(x0, y0, x1, y1, w=0):
    if w <= 0:
        s = set(); n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for i in range(int(round(n)) + 1):
            t = i / max(1, round(n))
            s.add((int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t))))
        return s
    s = set(); L2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 or 1
    for (x, y) in ALL:
        px, py = x + .5, y + .5
        t = max(0, min(1, ((px - x0) * (x1 - x0) + (py - y0) * (y1 - y0)) / L2))
        if math.hypot(px - x0 - t * (x1 - x0), py - y0 - t * (y1 - y0)) <= w / 2:
            s.add((x, y))
    return s

def fill(m, c):
    for x, y in m:
        put(x, y, c(x, y) if callable(c) else c)

def edge(m):
    return {(x, y) for x, y in m if any((x + dx, y + dy) not in m
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}

def shape(m, c, o='K', sh=None, hi=None, sw=2, hw=2):
    """塗って、かげ（左下）・明るい所（右上）を付けて、ふちどり。"""
    fill(m, c)
    if sh:
        fill({(x, y) for x, y in m if (x - sw, y) not in m or (x, y + sw) not in m}, sh)
    if hi:
        fill({(x, y) for x, y in m if ((x + hw, y) not in m or (x, y - hw) not in m)
              and (x - sw, y) in m and (x, y + sw) in m}, hi)
    if o:
        fill(edge(m), o)

def shadow(cx, cy, rx, ry, on, c='K', solid=0.5):
    for (x, y) in ell(cx, cy, rx, ry):
        q = ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2
        if at(x, y) in on and (q < solid or (x + y) % 2 == 0):
            put(x, y, c)

def zz(x, y, n, c='K'):
    for i in range(n):
        put(x + i, y, c); put(x + i, y + n - 1, c); put(x + n - 1 - i, y + i, c)

def finish(name, holec='W'):
    out = set(); st = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
    st = [p for p in st if g[p[1]][p[0]] == '.']; out = set(st)
    while st:
        x, y = st.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if 0 <= q[0] < W and 0 <= q[1] < H and q not in out and g[q[1]][q[0]] == '.':
                out.add(q); st.append(q)
    for y in range(H):
        for x in range(W):
            if g[y][x] == '.' and (x, y) not in out:
                g[y][x] = holec                      # 閉じた空きをうめる
    rows = [''.join(r) for r in g]
    while rows and set(rows[0]) == {'.'}: rows.pop(0)
    while rows and set(rows[-1]) == {'.'}: rows.pop()
    while rows and all(r[0] == '.' for r in rows): rows = [r[1:] for r in rows]
    while rows and all(r[-1] == '.' for r in rows): rows = [r[:-1] for r in rows]
    here = os.path.dirname(os.path.abspath(__file__))
    open(os.path.join(here, name + '.txt'), 'w').write('\n'.join(rows) + '\n')
    cnt = {}
    for r in rows:
        for ch in r:
            if ch != '.': cnt[ch] = cnt.get(ch, 0) + 1
    print(name, sum(cnt.values()), len(cnt), cnt)
# ---- 空（上のはしは あけて）----
sky = rect(0, 9, 63, 16)
fill(sky, 'S')
fill(ell(10, 12, 4.5, 1.6) | ell(13, 11, 3, 2), 'W')
# ---- うみ ----
sea = rect(0, 17, 63, 26)
fill(sea, 'B')
for (x, y) in sea:
    if y >= 22: put(x, y, 'S')
    if (y in (19, 23) and (x + y * 3) % 9 < 3) or (y == 25 and (x // 2) % 3 == 0): put(x, y, 'W')
fill({(x, 17) for x in range(W)}, 'K')
# ---- すなはま ----
sand = {(x, y) for (x, y) in ALL if y >= 27 + 1.0 * math.sin(x / 6.0 + 2)}
fill(sand, 'Y')
for (x, y) in sand:
    if (x * 5 + y * 11) % 13 == 0: put(x, y, 'O')
fill({(x, y) for (x, y) in sand if (x, y - 1) not in sand}, 'W')
# ---- パラソル（右・みどりと白のしま）----
shadow(50, 43, 13, 2.5, 'YOW', 'O', 1.0)
fill(line(52, 8, 50, 44, 1.6), 'C'); fill(line(53, 8, 51, 44), 'K')
pcx, pcy = 50, 12
dome = {(x, y) for (x, y) in ell(pcx, pcy + 2, 15, 9) if y <= pcy + 2 + 0.05 * abs(x - pcx) + (1 if (x // 3) % 2 else 0)}
def stripe(x, y):
    a = math.atan2(x + .5 - pcx, pcy + 4 - y); k = int((a + 3.2) / 0.35) % 2
    return 'G' if k == 0 else 'W'
fill(dome, stripe); fill(edge(dome), 'K')
fill({(50, 3), (51, 3), (50, 4), (51, 4)}, 'K')
# ---- くま（すわって、ソフトクリームを なめる）----
shadow(25, 46, 14, 1.5, 'YOW', 'O', 1.0)
body = ell(25, 37, 12, 9.5)
shape(body, 'C', hi='O')
belly = ell(26, 38.5, 6.5, 6)
fill(belly, 'O'); fill({(x, y) for (x, y) in belly if (x - 1, y - 1) not in belly}, 'Y')
for cx in (16, 34):
    f = ell(cx, 44.5, 5, 2.6); shape(f, 'C'); fill(ell(cx + .5, 44.8, 2.4, 1.3), 'O')
armL = ell(14, 36, 3, 5, 20); shape(armL, 'C')
for (e, cx) in ((ell(16, 13, 3.6, 3.6), 16), (ell(34, 12, 3.6, 3.6), 34)):
    shape(e, 'C'); fill(ell(cx, 13.2 if cx == 16 else 12.2, 1.8, 1.8), 'P')
head = ell(25, 21, 10.5, 8.8)
shape(head, 'C', hi='O')
mz = ell(28, 25, 4.6, 3.4)
fill(mz, 'W'); fill({(x, y) for (x, y) in mz if (x, y + 1) not in mz}, 'S'); fill(edge(mz), 'K')
fill(rect(27, 22, 30, 22) | rect(28, 23, 29, 23), 'K')                # 鼻
fill({(29, 25), (30, 26), (31, 26), (32, 26)}, 'K'); fill({(31, 27), (32, 27), (32, 25)}, 'P')   # べろ（なめる）
for ex in (21, 32):
    fill(ell(ex + .5, 18.5, 1.4, 1.9), 'K'); put(ex, 17, 'W')       # 目
fill(ell(19.5, 23, 1.8, 1), 'P')
# ---- ソフトクリーム（右手で 口の前へ）----
cone = poly([(33, 28), (41, 28), (37, 40)])
fill(cone, 'O')
for (x, y) in cone:
    if (x + y) % 3 == 0 or (x - y) % 3 == 0: put(x, y, 'C')
fill(edge(cone), 'K')
s1 = ell(37, 26, 5, 3); s2 = ell(36.5, 22.5, 4, 2.8); s3 = ell(36, 19.5, 2.6, 2)
for (sc, c) in ((s1, 'P'), (s2, 'W'), (s3, 'W')):
    fill(sc, c)
fill({(x, y) for (x, y) in s1 if x <= 33 or (x, y + 1) not in s1}, 'R')
fill({(x, y) for (x, y) in s2 | s3 if x <= 33 or ((x, y + 1) not in (s2 | s3) and x < 36)}, 'S')
fill(edge(s1 | s2 | s3) - {(x, y) for (x, y) in s1 if y >= 28}, 'K')
fill({(36, 17), (36, 16), (35, 16)}, 'K')                            # とがった先
fill({(40, 28), (40, 29), (40, 30)}, 'P'); put(40, 31, 'K')          # たれた しずく
paw = ell(38, 34, 3, 2.6); shape(paw, 'C'); fill({(37, 33), (38, 33)}, 'O')
arm = line(30, 36, 36, 35, 4); fill(arm - paw, 'C'); fill(edge(arm) - paw - body, 'K')
finish('kumaumibeoyatsu', 'Y')
