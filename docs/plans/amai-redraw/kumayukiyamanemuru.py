# ゆきやまで くまが ねむる（kumayukiyamanemuru・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり）で描いて、文字の地図 kumayukiyamanemuru.txt を書き出す。
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
# 雪の山の ほらあなで、くまが 冬眠している夜の場面。
# ---- 夜空（月と雪のつぶ）----
sky = rect(0, 8, 63, 30)
fill(sky, 'B')
import random
rnd = random.Random(7)
for (x, y) in sorted(sky):
    if rnd.random() < 0.06: put(x, y, 'W')
moon = ell(48, 13, 4.5, 4.5) - ell(50.5, 11.5, 4, 4)
fill(moon, 'Y')
# ---- もみの木（右・雪をかぶる）----
fill(rect(59, 34, 60, 40), 'C')
for (ty, hw, hh) in ((14, 3, 6), (19, 5, 7), (25, 7, 9)):
    t = poly([(59.5 - hw - 1, ty + hh), (59.5, ty), (60.5 + hw, ty + hh)])
    fill(t, 'G')
    fill({(x, y) for (x, y) in t if x < 59 and (x + y) % 2 == 0}, 'K')
    fill({(x, y) for (x, y) in t if y <= ty + 1 or (y == ty + hh - 1 and x % 3 != 1)}, 'W')
    fill(edge(t) - {(x, y) for (x, y) in t if y <= ty + 1}, 'K')
# ---- 雪の山（大きな こんもり）とほらあな ----
hill = ell(29, 53, 34, 37)
shape(hill, 'W')
fill({(x, y) for (x, y) in hill if x > 34 + (y - 16) * 0.3 and ((x + y) % 2 == 0 or x > 52)} - edge(hill), 'S')
cave = {(x, y) for (x, y) in ell(30, 45, 18, 14.5) if y <= 45}
fill(cave, 'K')
fill({(x, y) for (x, y) in cave if (x + y) % 2 == 0 and ((x - 1, y) not in cave or (x + 1, y) not in cave or (x, y - 1) not in cave)}, 'B')
fill({(x, y) for (x, y) in ell(30, 45, 19.5, 16) - ell(30, 45, 18, 14.5) if y <= 44} & hill, 'S')
for ix in (17, 22, 28, 34, 40, 45):                            # つらら
    L = 3 if ix % 2 else 2
    top = min(y for (x, y) in cave if x == ix)
    fill({(ix, top + k) for k in range(L)}, 'W'); put(ix, top + L, 'S')
# ---- 落ち葉のふとん ----
bed = ell(30, 45, 16, 2.4)
fill(bed, 'O')
for (x, y) in bed:
    if (x * 3 + y) % 5 == 0: put(x, y, 'R')
    elif (x + y * 2) % 4 == 0: put(x, y, 'Y')
fill({(x, y) for (x, y) in bed if (x, y + 1) not in bed}, 'C')
# ---- くま（まるくなって ねむる）----
body = ell(34, 39.5, 11.5, 5.5)
fill(body, 'C')
fill({(x, y) for (x, y) in body if (x, y - 1) not in body or (x, y - 2) not in body}, 'O')
fill({(x, y) for (x, y) in body if (x, y + 1) not in body or (x + 1, y) not in body}, 'K')
leg = ell(42, 43, 4.2, 2)
shape(leg, 'C'); fill(ell(45, 43, 1.3, 1.2), 'O')
fill(line(37, 35, 39, 38) | line(33, 35, 35, 38), 'K')          # 毛のすじ
earB = ell(16, 32.5, 2.6, 2.4); shape(earB, 'C'); fill(ell(16, 32.8, 1.1, 1.0), 'P')
earF = ell(24, 32.5, 2.6, 2.4); shape(earF, 'C'); fill(ell(24, 32.8, 1.1, 1.0), 'P')
head = ell(20, 39, 7, 5.6)
fill(head, 'C')
fill({(x, y) for (x, y) in head if (x, y - 1) not in head or (x + 1, y - 1) not in head}, 'O')
fill(edge(head), 'K')
mz = ell(15.5, 41, 3, 2.1)
fill(mz, 'O'); fill(edge(mz), 'K'); fill(rect(13, 40, 14, 40), 'K')
for (dx, dy) in ((0, 0), (1, 1), (2, 1), (3, 0)): put(19 + dx, 38 + dy, 'K')   # とじた目
fill(ell(21.5, 41, 1.5, 0.9), 'P')
paw = ell(21, 44, 3.8, 1.7)
shape(paw, 'C'); fill({(19, 44), (21, 44), (23, 44)}, 'O')
# ---- Zzz（ほらあなの上の夜空）----
zz(21, 24, 4, 'K'); zz(26, 18, 5, 'K'); zz(33, 9, 6, 'Y')
# ---- 手前の雪 ----
snow = {(x, y) for (x, y) in ALL if y >= 46 - 1.2 * math.sin(x / 5.0)}
fill(snow, 'W'); fill({(x, y) for (x, y) in snow if (x, y - 1) not in snow}, 'S')
finish('kumayukiyamanemuru', 'B')
