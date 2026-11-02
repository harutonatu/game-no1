# こうえんで ねこが ねむる（nekokouennemuru・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり）で描いて、文字の地図 nekokouennemuru.txt を書き出す。
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
# ---- 空（上のはしは あけて、おひさま）----
sky = rect(0, 11, 63, 30)
fill(sky, 'S')
fill(ell(46, 13, 4.5, 1.6) | ell(49, 12, 3, 2), 'W')
sun = ell(59, 10, 4, 4); fill(sun, 'Y'); fill({(x, y) for (x, y) in sun if x + y > 70}, 'O')
# ---- しばふ（奥の線・花）----
lawn = {(x, y) for (x, y) in ALL if y >= 31 - 1.5 * math.sin(x / 10.0 + 1)}
fill(lawn, 'G')
for (x, y) in lawn:
    if (x * 7 + y * 3) % 13 == 0: put(x, y, 'Y')
    elif (x * 5 + y * 9) % 29 == 0: put(x, y, 'R')
    elif (x + y) % 2 == 0 and y < 34: put(x, y, 'K' if (x * 3 + y) % 4 == 0 else 'G')
fill({(x, y) for (x, y) in lawn if (x, y - 1) not in lawn}, 'K')
# ---- 木（左奥）----
trunk = poly([(7, 14), (11, 14), (11.5, 33), (13.5, 36), (4.5, 36), (6.5, 33)])
fill(trunk, 'C'); fill({(x, y) for (x, y) in trunk if x == 10 or x == 11}, 'O'); fill(edge(trunk), 'K')
lv = ell(9, 8, 8, 6) | ell(3, 13, 5, 4) | ell(15, 12, 5.5, 4.5) | ell(9, 15, 5, 3)
fill(lv, 'G')
for (x, y) in lv:
    if (x + y) % 2 == 0 and ((x - 2, y) not in lv or (x, y + 2) not in lv): put(x, y, 'K')
    elif (x * 3 + y) % 7 == 0 and (x + 2, y) in lv: put(x, y, 'Y')
fill(edge(lv), 'K')
shadow(10, 36.5, 7, 1.2, 'GYR', 'K', 0.3)
# ---- ベンチ（ななめ。背もたれと座面）----
shadow(40, 44.5, 20, 1.2, 'GYR', 'K', 0.0)
for (lx, ly0, ly1) in ((20, 34, 43), (58, 32, 41), (25, 30, 38), (55, 29, 36)):
    fill(rect(lx, ly0, lx + 1, ly1), 'K')
back = poly([(18, 18), (62, 15), (62, 25), (18, 28)])
fill(back, 'B')
for (x, y) in back:
    k = (y - (18 - (x - 18) * 3 / 44))
    if int(k) % 4 == 0: put(x, y, 'K')
    elif int(k) % 4 == 1: put(x, y, 'S')
fill(edge(back), 'K')
seat = poly([(15, 32), (61, 29), (64, 33), (18, 36)])
fill(seat, 'S')
for (x, y) in seat:
    if (x + (y - 29) * 2) % 9 == 0: put(x, y, 'B')
side = poly([(15, 32), (18, 36), (18, 38), (15, 34)])
fill(side, 'B')
fill(rect(18, 36, 63, 37), 'B')
fill(edge(seat | side | rect(18, 36, 63, 37)), 'K')
# ---- ねこ（ベンチの上で まるくなって ねむる）----
shadow(40, 33, 15, 1.4, 'SB', 'B', 1.0)
tail = line(50, 31, 44, 34, 3.2) | line(44, 34, 33, 34, 3.2)
body = ell(41, 26.5, 12.5, 6.8)
fill(body, 'O')
for k in range(5):                                             # せなかのしま
    fill(line(36 + k * 4, 20 + abs(k - 2) * .4, 37 + k * 4, 23), 'C')
fill({(x, y) for (x, y) in body if (x, y + 1) not in body or (x, y + 2) not in body}, 'C')
fill({(x, y) for (x, y) in body if (x, y - 1) not in body and 34 < x < 50}, 'Y')
fill(edge(body), 'K')
fill(tail, 'O'); fill({(x, y) for (x, y) in tail if (x, y + 1) not in tail}, 'C')
fill(line(33, 34, 35, 34, 2) & tail, 'C'); fill(edge(tail), 'K')
for (a, b) in ((35, 35), (39, 35)): pass
earB = poly([(22, 22), (24, 16), (28, 21)]); earF = poly([(28, 20), (32, 15), (33, 22)])
for e in (earB, earF):
    fill(e, 'O'); fill(edge(e), 'K')
fill(poly([(24.2, 21), (24.8, 18.2), (26.6, 20.6)]) | poly([(29.8, 20.2), (31.6, 17.5), (31.9, 21)]), 'P')
head = ell(28, 26.5, 7.5, 6)
fill(head, 'O')
fill({(x, y) for (x, y) in head if (x, y - 1) not in head or (x + 1, y - 1) not in head}, 'Y')
fill({(x, y) for (x, y) in head if (x - 1, y) not in head or (x, y + 1) not in head}, 'C')
fill(edge(head), 'K')
fill(line(27, 21, 27, 23) | line(29, 21, 29, 22), 'C')            # おでこのしま
mz = ell(27, 29, 3.6, 2.2); fill(mz, 'W'); fill({(x, y) for (x, y) in mz if (x, y + 1) not in mz}, 'S')
fill({(26, 27), (27, 27), (28, 27), (27, 28)}, 'P')                # 鼻
for (dx, dy) in ((0, 0), (1, 1), (2, 1), (3, 0)):                   # とじた目
    put(22 + dx, 25 + dy, 'K'); put(29 + dx, 25 + dy, 'K')
fill(line(19, 28, 22, 29) | line(32, 29, 35, 28), 'K')            # ひげ
paw = ell(32, 31.5, 3, 1.6); fill(paw, 'W'); fill(edge(paw), 'K')
# ---- Zzz ----
zz(33, 12, 5); zz(40, 5, 7)
finish('nekokouennemuru', 'S')
