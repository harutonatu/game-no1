# もりで くまが ねむる（kumamorinemuru・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり・かげ）で描いて、文字の地図 kumamorinemuru.txt を書き出す（1 マス＝1 粒）。
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
# 場所の物は 背の高い木 と おちばの やま の 2 つ。ねむるは とじた目 と Z。
# ---- 空（木の すきま）----
fill(rect(0, 12, 63, 29) - rect(0, 12, 6, 13), 'S')
fill(ell(10, 15, 4.5, 1.4) | ell(13, 14, 3, 1.7), 'W')
# ---- 地面（くさ）----
ground = {(x, y) for (x, y) in ALL if y >= 30 + 1.0 * math.sin(x / 6.0)}
fill(ground, 'G')
for (x, y) in ground:
    if (x * 7 + y * 3) % 19 == 0: put(x, y, 'Y')
fill({(x, y) for (x, y) in ground if (x, y - 1) not in ground}, 'K')
# ---- 背の高い木（右）----
shadow(55, 37, 9, 1.2, 'GY', 'K', 1.0)
trunk = poly([(51, 5), (58, 5), (59, 34), (62, 37), (48, 37), (50, 34)])
shape(trunk, 'C', sh='K', sw=1)
for y in range(9, 34, 5): fill(line(52, y, 54, y + 1), 'K')
fill(rect(57, 7, 57, 33) & trunk, 'O')
hole = ell(55, 18, 1.8, 2.4); fill(hole, 'K')                     # みきの あな
can = ell(55, 6, 11, 7) | ell(44, 10, 5, 3.5)
fill(can, 'G')
fill({(x, y) for (x, y) in can if (x + 2, y + 2) not in can}, 'K')
fill({(x, y) for (x, y) in can if (x * 3 + y * 7) % 11 == 0 and (x - 2, y - 2) in can}, 'Y')
fill(edge(can), 'K')
# ---- おちばの やま（くまの ふとん）----
pile = ell(29, 42, 27, 5.5)
fill(pile, lambda x, y: 'ROYO'[(x * 3 + y * 5) % 4] if (x + 2 * y) % 3 else 'C')
fill(edge(pile), 'K')
for (lx, ly, c) in ((40, 25, 'O'), (44, 28, 'R'), (34, 22, 'Y')):   # まう おちば
    fill({(lx, ly), (lx + 1, ly), (lx, ly + 1)}, c)
# ---- くま（よこに なって ねむる。頭は 左）----
foot = ell(48, 37.5, 4, 3.4)
body = ell(33, 34, 15, 8.5)
shape(body, 'C', sh='K')
fill({(x, y) for (x, y) in body if (x, y - 1) not in body or (x, y - 2) not in body} - edge(body), 'O')   # せなかの 光
belly = ell(32, 37, 9, 4.5); fill(belly, 'O'); fill({(x, y) for (x, y) in belly if (x, y - 1) not in belly}, 'Y')
fill(edge(body), 'K')
shape(foot, 'C'); fill(ell(48.5, 37.5, 2, 1.8), 'O'); fill(edge(ell(48.5, 37.5, 2, 1.8)), 'C')
armF = ell(24, 39.5, 7, 3); shape(armF, 'C'); fill({(19, 39), (20, 38)}, 'O')   # まくらの うで
earB = ell(9, 22, 3.8, 3.8); earF = ell(21, 21, 3.8, 3.8)
for e, (cx, cy) in ((earB, (9, 22)), (earF, (21, 21))):
    shape(e, 'C'); fill(ell(cx, cy + .3, 2, 2), 'P')
head = ell(15, 30, 10, 8.5)
shape(head, 'C', sh='K')
fill({(x, y) for (x, y) in head if (x, y - 1) not in head and (x, y) not in edge(head) and x >= 15}, 'O')
mz = ell(13, 33.5, 5, 3.4); fill(mz, 'W'); fill({(x, y) for (x, y) in mz if (x, y + 1) not in mz}, 'S'); fill(edge(mz), 'K')
fill(rect(11, 31, 14, 31) | rect(12, 32, 13, 32), 'K')            # はな
fill({(12, 33), (12, 34), (11, 35), (13, 35), (14, 35)}, 'K')               # くち
eye(9, 28, closed=True); eye(18, 28, closed=True)
fill(ell(22, 32, 1.8, 1), 'P'); fill(ell(6, 32, 1.4, 1), 'P')    # ほっぺ
# Z（ねむって いる）
zz(24, 13, 4); zz(29, 7, 5); zz(35, 1, 6)
finish('kumamorinemuru', 'G')
