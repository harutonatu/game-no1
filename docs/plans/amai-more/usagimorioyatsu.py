# もりで うさぎが おやつを たべる（usagimorioyatsu・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり・かげ）で描いて、文字の地図 usagimorioyatsu.txt を書き出す（1 マス＝1 粒）。
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

def eye(x, y, closed=False, big=1.0):
    """目。closed＝ねむっている目（下にまるい線）。"""
    if closed:
        fill({(x - 1, y), (x, y + 1), (x + 1, y + 1), (x + 2, y)}, 'K')
    else:
        fill(ell(x + .5, y + .5, 1.3 * big, 1.9 * big), 'K'); put(x, y - 1, 'W')

def tri(a, b, c):
    return poly([a, b, c])
# 場所の物は 背の高い木 と 切りかぶ の 2 つ。おやつは いちご（両手で もって かじる。切りかぶの上に かご）。
# ---- 空（木の すきま。上は あける）----
fill(rect(0, 15, 63, 29) - rect(54, 15, 63, 16), 'S')
fill(ell(52, 19, 4.5, 1.5) | ell(55, 18, 3, 1.8), 'W')
# ---- 地面（くさ。奥へ うすく。おちば）----
ground = {(x, y) for (x, y) in ALL if y >= 30 + 1.2 * math.sin(x / 7.0 + 1)}
fill(ground, 'G')
for (x, y) in ground:
    if (x * 7 + y * 3) % 17 == 0: put(x, y, 'Y')
    elif (x * 3 + y * 5) % 23 == 0: put(x, y, 'O')
    elif (x * 5 + y * 13) % 29 == 0: put(x, y, 'R')
fill({(x, y) for (x, y) in ground if (x, y - 1) not in ground}, 'K')
# ---- 背の高い木（左。みき C・は G）----
shadow(9, 41, 9, 1.4, 'GYOR', 'K', 1.0)
trunk = poly([(5, 8), (12, 8), (13, 38), (15, 41), (2, 41), (4, 38)])
shape(trunk, 'C', sh='K', sw=1)
for y in range(12, 38, 5): fill(line(7, y, 9, y + 1), 'K')       # みきの すじ
fill(rect(10, 10, 10, 36) & trunk, 'O')                           # みきの 光
can = ell(11, 8.5, 11, 8) | ell(19, 13, 6, 4) | ell(4, 14, 5, 4)
fill(can, 'G')
fill({(x, y) for (x, y) in can if (x + 2, y + 2) not in can}, 'K')   # 葉の かげの すじ
fill({(x, y) for (x, y) in can if (x * 3 + y * 7) % 11 == 0 and (x - 2, y - 2) in can}, 'Y')
fill(edge(can), 'K')
# きのこ（木の ねもと）
for (mx, my) in ((16, 39), (20, 41)):
    st = rect(mx, my, mx + 1, my + 2); fill(st, 'W'); fill(edge(st) - {(mx, my), (mx + 1, my)}, 'K')
    cap = {(x, y) for (x, y) in ell(mx + 1, my, 3, 2.4) if y < my}
    fill(cap, 'R'); put(mx, my - 2, 'W'); put(mx + 2, my - 1, 'W'); fill(edge(cap), 'K')
# ---- 切りかぶ（右。上に いちごの かご）----
shadow(55, 45, 9, 1.3, 'GYOR', 'K', 1.0)
stump = rect(48, 32, 62, 43) | ell(55, 43, 7.5, 1.6)
shape(stump, 'C', sh='K', sw=1)
fill({(x, y) for (x, y) in stump if x in (51, 56, 60) and y > 33}, 'K')
top = ell(55, 32, 7.5, 2.4); fill(top, 'Y')
fill(edge(ell(55, 32, 4.5, 1.4)) | {(55, 32)}, 'O'); fill(edge(top), 'K')
bas = poly([(49, 25), (61, 25), (59, 31), (51, 31)])
fill(bas, lambda x, y: 'O' if (x + y) % 2 == 0 else 'C'); fill(edge(bas), 'K')
fill(line(50, 25, 52, 19) | line(52, 19, 58, 19) | line(58, 19, 60, 25), 'C')   # かごの とって
for (bx, by) in ((52, 24), (55, 23), (58, 24), (53.5, 22), (56.5, 21.5)):
    b = ell(bx, by, 1.7, 1.6); fill(b, 'R'); fill(edge(b), 'K')
fill({(55, 21), (54, 21), (56, 20), (52, 22)}, 'G')
# ---- うさぎ（すわって 右を むき、いちごを かじる）----
shadow(32, 46, 13, 1.5, 'GYOR', 'K', 1.0)
WS = lambda m: (lambda x, y: 'S' if ((x - 1, y) not in m or (x, y + 2) not in m) else 'W')
earB = ell(28, 9, 2.8, 8, -14); earF = ell(35, 8, 3, 8.3, 10)
for e, cx, cy, a in ((earB, 28, 9, -14), (earF, 35, 8, 10)):
    fill(e, WS(e)); fill(ell(cx, cy + .3, 1.3, 6, a), 'P'); fill(edge(e), 'K')
body = ell(30, 36, 10, 9)
fill(body, WS(body)); fill(edge(body), 'K')
tail = ell(20, 40, 2.6, 2.4); fill(tail, 'W'); fill(edge(tail), 'K')
foot = ell(35, 44.3, 6, 2)
fill(foot, 'W'); fill(edge(foot), 'K'); fill({(38, 44), (39, 44), (40, 44)}, 'P')
head = ell(33, 22.5, 9.5, 8)
fill(head, WS(head)); fill(edge(head), 'K')
eye(37, 20)
fill(ell(34, 25.5, 1.8, 0.9), 'P')                                # ほっぺ
fill({(42, 22), (42, 23), (41, 22)}, 'P')                         # はな
fill({(40, 25), (41, 25), (41, 26)}, 'K')                         # かじる口
# 両手で もつ いちご（口もと）
sb = poly([(41, 24), (50, 24), (49, 29), (46, 33), (44, 33), (41, 29)])
fill(sb, 'R'); fill({(x, y) for (x, y) in sb if (x - 1, y + 1) not in sb}, 'C')
fill({(42, 26), (45, 27), (43, 29), (47, 26), (48, 28), (45, 30)}, 'Y'); fill(edge(sb), 'K')
fill({(43, 23), (44, 23), (45, 23), (46, 23), (47, 23), (48, 23), (45, 22), (46, 21)}, 'G')   # へた
fill({(42, 26), (41, 26)}, 'W')                                   # かじった あと
for (cx, cy) in ((40.5, 30), (49.5, 29)):                          # 手
    p = ell(cx, cy, 2.4, 2.2); fill(p, 'W'); fill(edge(p), 'K')
finish('usagimorioyatsu', 'G')
