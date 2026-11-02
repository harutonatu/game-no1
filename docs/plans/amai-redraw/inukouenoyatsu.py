# こうえんで いぬが おやつを たべる（inukouenoyatsu・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり）で描いて、文字の地図 inukouenoyatsu.txt を書き出す。
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
# ---- 空（上のはしは あけて、くも）----
sky = rect(0, 10, 63, 28)
fill(sky, 'S')
fill(ell(8, 14, 4.5, 1.6) | ell(11, 13, 3, 2), 'W')
# ---- しばふ ----
lawn = {(x, y) for (x, y) in ALL if y >= 27 + 1.2 * math.sin(x / 8.0)}
fill(lawn, 'G')
for (x, y) in lawn:
    if (x * 7 + y * 3) % 13 == 0: put(x, y, 'Y')
    elif (x + y) % 2 == 0 and y < 30: put(x, y, 'K' if (x * 3 + y) % 4 == 0 else 'G')
fill({(x, y) for (x, y) in lawn if (x, y - 1) not in lawn}, 'K')
# ---- 木（右奥）----
trunk = poly([(53, 16), (57, 16), (57.5, 31), (59.5, 34), (50.5, 34), (52.5, 31)])
fill(trunk, 'C'); fill({(x, y) for (x, y) in trunk if x >= 56}, 'O'); fill(edge(trunk), 'K')
lv = ell(55, 10, 8, 6) | ell(49, 15, 5, 4) | ell(61, 15, 5, 4.5) | ell(55, 17, 5, 3)
fill(lv, 'G')
for (x, y) in lv:
    if (x + y) % 2 == 0 and ((x - 2, y) not in lv or (x, y + 2) not in lv): put(x, y, 'K')
    elif (x * 3 + y) % 7 == 0 and (x + 2, y) in lv: put(x, y, 'Y')
fill(edge(lv), 'K')
# ---- ピクニックのしきもの（赤と白のチェック・ななめ）----
sheet = poly([(5, 33), (54, 31), (64, 48), (-2, 48)])
fill(sheet, 'W')
for (x, y) in sheet:
    t = (y - 31) / 17.0
    u = int((x - 30) / (1 + t * 0.6) + 64) // 4; v = int((y - 31) / (1 + t * 0.3)) // 3
    if u % 2 == 0 and v % 2 == 0: put(x, y, 'R')
    elif u % 2 == 0 or v % 2 == 0: put(x, y, 'P')
fill(edge(sheet) - {(x, 47) for x in range(W)}, 'K')
# ---- いぬ（すわって、ほねのクッキーを かじる）----
shadow(30, 45.5, 13, 1.5, 'WRP', 'K', 0.3)
WS = lambda m: (lambda x, y: 'S' if ((x - 2, y) not in m or (x, y + 2) not in m) else 'W')
body = ell(30, 36, 11, 9.5)
fill(body, WS(body))
fill(ell(37, 33, 4, 5), 'C')                                     # せなかのぶち
fill(edge(body), 'K')
for (cx) in (23, 37):                                           # 後ろ足
    f = ell(cx, 44.5, 4.5, 2); fill(f, 'W'); fill(edge(f), 'K')
    fill({(cx - 1, 45), (cx + 1, 45)}, 'K')
tailm = line(41, 40, 47, 34, 3); fill(tailm, 'C'); fill(edge(tailm), 'K'); fill({(47, 33), (48, 33), (48, 32)}, 'W')
head = ell(30, 18.5, 10, 8.5)
fill(head, WS(head))
fill(ell(25, 15.5, 4, 4), 'C')                                  # 目のまわりのぶち
fill(edge(head), 'K')
for (cx, cy, a) in ((19, 20, 18), (41, 20, -18)):               # たれ耳
    e = ell(cx, cy, 3.6, 7.5, a)
    fill(e, 'C'); fill({(x, y) for (x, y) in e if (x, y + 2) not in e}, 'O'); fill(edge(e), 'K')
for ex in (25.5, 34.5):                                         # 目
    fill(ell(ex, 16.5, 1.5, 2), 'K'); put(int(ex), 15, 'W')
mz = ell(30, 22, 5, 3.5)
fill(mz, 'W'); fill({(x, y) for (x, y) in mz if (x, y + 1) not in mz}, 'S'); fill(edge(mz), 'K')
fill(rect(28, 19, 32, 20) | rect(29, 21, 31, 21), 'K'); put(29, 19, 'W')   # 鼻
fill(ell(22, 21.5, 1.6, 1), 'P'); fill(ell(38, 21.5, 1.6, 1), 'P')
# ---- ほねのクッキー（口にくわえる）----
bone = rect(21, 24, 39, 27) | ell(20, 23.5, 2.6, 2.4) | ell(20, 27.5, 2.6, 2.4) | ell(40, 23.5, 2.6, 2.4) | ell(40, 27.5, 2.6, 2.4)
fill(bone, 'Y')
fill({(x, y) for (x, y) in bone if (x, y + 1) not in bone or (x - 1, y + 1) not in bone}, 'O')
for (x, y) in ((24, 25), (28, 26), (33, 25), (36, 26), (31, 24)): put(x, y, 'O')
fill(edge(bone), 'K')
fill({(28, 24), (29, 24), (30, 24), (31, 24), (32, 24)}, 'K'); fill({(29, 23), (30, 23), (31, 23)}, 'P')   # くわえた口・べろ
for (cx, cy) in ((23, 30.5), (37, 30.5)):                       # 前足
    p = ell(cx, cy, 3, 2.6); fill(p, 'W'); fill(edge(p), 'K')
for (x, y) in ((16, 31), (44, 30), (45, 32)): put(x, y, 'O')     # かけら
finish('inukouenoyatsu', 'G')
