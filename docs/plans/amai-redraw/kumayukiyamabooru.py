# ゆきやまで くまが ボールで あそぶ（kumayukiyamabooru・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり）で描いて、文字の地図 kumayukiyamabooru.txt を書き出す。
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
# ---- 空（上のはしは あけて、雪のつぶ）----
sky = rect(0, 10, 63, 30)
fill(sky, 'S')
for (x, y) in sky:
    if (x * 5 + y * 3) % 17 == 0 and y < 26: put(x, y, 'W')
# ---- 山（奥。雪のぼうし・右の面はかげ）----
for (px, py, wl, wr) in ((14, 9, 18, 16), (52, 12, 16, 20)):
    m = poly([(px - wl, 31), (px, py), (px + wr, 31)])
    fill(m, 'W')
    fill({(x, y) for (x, y) in m if x > px + (y - py) * 0.25}, 'S')
    low = {(x, y) for (x, y) in m if y > py + 8 + (2 if (x // 2) % 2 else 0)}
    fill({(x, y) for (x, y) in low if x > px + (y - py) * 0.25}, 'B')
    fill({(x, y) for (x, y) in low if x <= px + (y - py) * 0.25 and (x + y) % 3 == 0}, 'S')
    fill(edge(m) - {(x, y) for (x, y) in m if y >= 30}, 'K')
# ---- 雪の地面（手前ほど ひろい。なだらかな丘とかげ）----
ground = {(x, y) for (x, y) in ALL if y >= 30 + 2.5 * math.sin(x / 9.0)}
fill(ground, 'W')
for (x, y) in ground:
    if (y - 30 - 2.5 * math.sin(x / 9.0)) < 1.2: put(x, y, 'K')
for (cx, cy, rx) in ((10, 41, 7), (56, 38, 6), (58, 45, 5)):
    fill({(x, y) for (x, y) in ell(cx, cy, rx, 1.0) if (x + y) % 2 == 0}, 'S')
# ---- もみの木（左。雪をかぶる）----
fill(rect(7, 31, 8, 36), 'C'); fill(rect(8, 31, 8, 36), 'K')
for (ty, hw, hh) in ((14, 4, 6), (18, 6, 7), (23, 8, 8)):
    t = poly([(7.5 - hw, ty + hh), (7.5, ty), (7.5 + hw + 1, ty + hh)])
    fill(t, 'G')
    fill({(x, y) for (x, y) in t if x < 7 and (x + y) % 2 == 0}, 'K')
    fill({(x, y) for (x, y) in t if y <= ty + 1 or (y == ty + hh - 1 and x % 3 != 0)}, 'W')
    fill(edge(t) - {(x, y) for (x, y) in t if y <= ty + 1}, 'K')
shadow(10, 36.5, 6, 1.2, 'WS', 'S', 1.0)
# ---- くま（立って、ボールを両手で上へ）----
shadow(34, 46, 14, 1.5, 'WS', 'S', 1.0)
footL = ell(27, 44, 5, 2.8); footR = ell(41, 44, 5, 2.8)
body = ell(34, 35, 12, 10.5)
armL = line(25, 30, 20, 12, 6); armR = line(43, 30, 47, 12, 6)
for a in (armL, armR):
    shape(a, 'C', hi='O', hw=1)
pawL = ell(20, 11, 3.5, 3.2); pawR = ell(47.5, 11, 3.5, 3.2)
for p in (pawL, pawR):
    shape(p, 'C'); fill(ell(sum(x for x, y in p) / len(p) + .5, 10.5, 1.8, 1.4), 'O')
shape(body, 'C', hi='O')
belly = ell(35, 37, 7, 7)
fill(belly, 'O'); fill({(x, y) for (x, y) in belly if (x - 1, y - 1) not in belly}, 'Y')
for (f, cx) in ((footL, 27), (footR, 41)):
    shape(f, 'C'); fill(ell(cx + .5, 44.5, 2.4, 1.4), 'O')
earL = ell(25, 13, 3.8, 3.8); earR = ell(43, 13, 3.8, 3.8)
for e, cx in ((earL, 25), (earR, 43)):
    shape(e, 'C'); fill(ell(cx, 13.3, 1.9, 1.9), 'P')
head = ell(34, 21, 10.5, 8.8)
shape(head, 'C', hi='O')
mz = ell(34.5, 25, 4.6, 3.4)
fill(mz, 'W'); fill({(x, y) for (x, y) in mz if (x, y + 1) not in mz}, 'S'); fill(edge(mz), 'K')
fill(rect(33, 22, 36, 22) | rect(34, 23, 35, 23), 'K')            # 鼻
mo = rect(33, 25, 36, 26)                                       # あけた口（よろこぶ）
fill(mo, 'K'); fill(rect(34, 26, 35, 26), 'R')
for ex in (29, 39):                                             # 目（上を見る。にっこり）
    for (dx, dy) in ((0, 1), (1, 0), (2, 0), (3, 1)): put(ex + dx - 1, 18 + dy, 'K')
fill(ell(27, 23, 1.8, 1.0) | ell(42, 23, 1.8, 1.0), 'P')       # ほっぺ
# ---- ボール（頭の上・しま）----
ball = ell(34, 5, 5, 5)
fill(ball, 'R')
for (x, y) in ball:
    if abs(y + .5 - (5.5 + 0.06 * (x + .5 - 34) ** 2)) < 0.9: put(x, y, 'W')
fill({(x, y) for (x, y) in ball if (x + 1, y + 1) not in ball and (x + 2, y) not in ball}, 'C')
fill({(31, 2), (32, 2), (31, 3)}, 'W')
fill(edge(ball), 'K')
for (a, b, c, d) in ((26, 3, 23, 3), (42, 3, 45, 3), (27, 7, 24, 8), (41, 7, 44, 8)):   # うごきの線
    fill(line(a, b, c, d), 'K')
finish('kumayukiyamabooru', 'S')
