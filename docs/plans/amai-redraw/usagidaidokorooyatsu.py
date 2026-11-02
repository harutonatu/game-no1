# だいどころで うさぎが おやつを たべる（usagidaidokorooyatsu・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり）で描いて、文字の地図 usagidaidokorooyatsu.txt を書き出す。
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
# ---- かべのタイル（下半分）----
tile = rect(0, 24, 63, 39)
fill(tile, 'Y')
for (x, y) in tile:
    if y % 4 == 0 or (x + (2 if (y // 4) % 2 else 0)) % 5 == 0: put(x, y, 'O')
fill({(x, 24) for x in range(W)}, 'K')
# ---- まど（左上・外は空と木）----
win = rect(2, 2, 24, 20)
fill(win, 'S')
fill(ell(8, 6, 3.5, 1.5) | ell(11, 5, 2.5, 1.8), 'W')
fill(ell(19, 18, 7, 4.5) & win, 'G')
fill({(x, y) for (x, y) in ell(19, 18, 7, 4.5) & win if (x * 2 + y) % 5 == 0}, 'Y')
fill(rect(13, 2, 13, 20) | rect(2, 11, 24, 11), 'C')
fill(edge(win), 'K')
sill = rect(0, 21, 26, 23)
fill(sill, 'W'); fill({(x, 23) for x in range(0, 27)}, 'S'); fill(edge(sill), 'K')
# ---- うさぎ（いすにすわって、ドーナツを両手で）----
earL = ell(30, 9, 3.4, 8.5, -12); earR = ell(43, 7.5, 3.4, 8.5, 18)
for e, cx, cy, a in ((earL, 30, 9, -12), (earR, 43, 7.5, 18)):
    shape(e, 'W', sh='S', sw=1)
    fill(ell(cx, cy + .5, 1.5, 6.5, a), 'P')
body = ell(37, 39, 12, 9)
shape(body, 'W', sh='S')
head = ell(37, 23, 11, 9)
shape(head, 'W', sh='S')
for ex in (31.5, 42.5):                                         # 目（まるく・光）
    fill(ell(ex, 21.5, 1.6, 2.1), 'K'); put(int(ex), 20, 'W')
fill(ell(28.5, 25.5, 2, 1.1) | ell(45.5, 25.5, 2, 1.1), 'P')   # ほっぺ
fill(rect(36, 24, 38, 24) | {(37, 25)}, 'P')                    # 鼻
fill({(37, 26), (36, 27), (38, 27), (35, 27), (39, 27)}, 'K')   # 口
fill(rect(36, 28, 38, 29), 'W'); fill(edge(rect(36, 28, 38, 29)) - {(x, 28) for x in range(36, 39)}, 'K')   # 前歯
# ---- ドーナツ（大きく・ひとくち かじった）----
dn = ell(37, 33.5, 8, 5.2)
hole = ell(37, 33.6, 2.4, 1.4)
bite = ell(43, 28.8, 3, 2.6)
dn = dn - hole - bite
fill(dn, 'C')
fill({(x, y) for (x, y) in dn if y <= 34 or ((x + y) % 4 == 0 and y <= 35)}, 'P')
for (x, y) in ((32, 30), (35, 29), (40, 30), (31, 33), (42, 33), (34, 35), (39, 35), (37, 31)):
    put(x, y, 'Y' if (x + y) % 3 == 0 else 'R')
fill({(x, y) for (x, y) in dn if (x, y + 1) not in dn and y > 35}, 'O')
fill(edge(dn), 'K')
fill(hole, 'W'); fill({(x, y) for (x, y) in hole if (x, y - 1) not in hole}, 'S')
for (cx, cy) in ((28.5, 34), (45.5, 34.5)):                     # 手
    p = ell(cx, cy, 2.8, 2.6)
    shape(p, 'W', sh='S', sw=1)
# ---- テーブル（手前・ななめ上から。青いチェックのかけ布）----
top = poly([(-1, 40), (65, 40), (65, 48), (-1, 48)])
fill(top, 'W')
for (x, y) in top:
    u = int((x - 32) / (1 + (y - 40) * 0.1) + 64) // 5; v = (y - 41) // 3
    if u % 2 == 0 and v % 2 == 0: put(x, y, 'B')
    elif u % 2 == 0 or v % 2 == 0: put(x, y, 'S')
fill({(x, 40) for x in range(W)}, 'K')
# ---- お皿とプリン（右）----
shadow(54, 45.5, 9, 1.3, 'WBS', 'K', 0.3)
plate = ell(54, 43.5, 9, 2.6)
fill(plate, 'W'); fill({(x, y) for (x, y) in plate if y >= 44}, 'S'); fill(edge(plate), 'K')
pud = poly([(49, 33), (59, 33), (61, 43), (47, 43)])
fill(pud, 'Y'); fill({(x, y) for (x, y) in pud if x >= 58}, 'O'); fill({(x, y) for (x, y) in pud if x <= 48}, 'W')
fill({(x, y) for (x, y) in pud if y <= 34}, 'C')
fill({(49, 35), (50, 36), (55, 35), (56, 36), (56, 37), (59, 35)}, 'C')     # たれるカラメル
fill(edge(pud), 'K')
cr = ell(54, 31.5, 3.6, 2)
fill(cr, 'W'); fill(edge(cr) - {(x, y) for (x, y) in cr if y <= 30}, 'S'); fill(edge(cr) - {(x, y) for (x, y) in cr if y >= 32}, 'K')
ch = ell(54.5, 28, 2.6, 2.4)
fill(ch, 'R'); fill(edge(ch), 'K'); put(53, 27, 'W'); fill(line(55, 25, 57, 23), 'G')
# ---- テーブルの上の前足（ドーナツの下）とかげ ----
finish('usagidaidokorooyatsu', 'Y')
