# もりで うさぎが おえかきを する（usagimorioekaki・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり・かげ）で描いて、文字の地図 usagimorioekaki.txt を書き出す（1 マス＝1 粒）。
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
# 場所の物は 背の高い木 と きのこ の 2 つ。おえかきは 地面に ひろげた 紙（にじと にんじんの絵）と クレヨン。
# ---- 空（木の すきま）----
fill(rect(0, 13, 63, 27) - rect(57, 13, 63, 14), 'S')
fill(ell(52, 15, 4.5, 1.4) | ell(55, 14, 3, 1.7), 'W')
# ---- 地面（くさ・おちば）----
ground = {(x, y) for (x, y) in ALL if y >= 28 + 1.0 * math.sin(x / 6.0 + 1)}
fill(ground, 'G')
for (x, y) in ground:
    if (x * 7 + y * 3) % 17 == 0: put(x, y, 'Y')
    elif (x * 3 + y * 5) % 23 == 0: put(x, y, 'O')
fill({(x, y) for (x, y) in ground if (x, y - 1) not in ground}, 'K')
# ---- 背の高い木（左おく）----
shadow(7, 34, 8, 1.2, 'GYO', 'K', 1.0)
trunk = poly([(3, 5), (10, 5), (11, 31), (13, 34), (0, 34), (2, 31)])
shape(trunk, 'C', sh='K', sw=1)
for y in range(9, 31, 5): fill(line(4, y, 6, y + 1), 'K')
fill(rect(9, 7, 9, 30) & trunk, 'O')
can = ell(7, 5, 11, 7) | ell(17, 9, 5, 3.5)
fill(can, 'G')
fill({(x, y) for (x, y) in can if (x + 2, y + 2) not in can}, 'K')
fill({(x, y) for (x, y) in can if (x * 3 + y * 7) % 11 == 0 and (x - 2, y - 2) in can}, 'Y')
fill(edge(can), 'K')
# きのこ（右おく）
st = rect(56, 26, 58, 31); fill(st, 'W'); fill(rect(58, 26, 58, 31), 'S'); fill(edge(st), 'K')
cap = {(x, y) for (x, y) in ell(57.5, 26.5, 5, 4) if y <= 26}
fill(cap, 'R'); fill({(54, 25), (55, 25), (58, 23), (59, 23), (57, 25), (60, 25)}, 'W'); fill(edge(cap), 'K')
# ---- 地面に ひろげた 紙（右手前。ななめ）----
shadow(50, 47, 13, 1.0, 'GYO', 'K', 1.0)
paper = poly([(36, 34), (60, 34), (64, 47), (38, 47)])
fill(paper, 'W'); fill({(x, y) for (x, y) in paper if (x, y + 1) not in paper}, 'S')
for (x, y) in paper:                                              # にじ（紙の中）
    r = math.hypot((x + .5 - 52), (y + .5 - 45) * 1.5)
    for k, c in enumerate('RYGB'):
        if 8.5 - k * 1.5 < r <= 10 - k * 1.5 and y <= 44: put(x, y, c)
car = poly([(43, 38), (46, 37), (47, 38), (42, 45)]); fill(car, 'O')   # 絵の にんじん
fill({(45, 36), (46, 35), (47, 36), (44, 36)}, 'G')
fill(edge(paper), 'K')
for (cx, cy, c) in ((30, 44, 'B'), (34, 45, 'Y'), (58, 31, 'P')):  # クレヨン
    cr = rect(cx, cy, cx + 3, cy + 1); fill(cr, c); fill({(cx + 3, cy), (cx + 3, cy + 1)}, 'K')
# ---- うさぎ（おなかを つけて ねそべり、クレヨンで かく）----
shadow(24, 46, 15, 1.3, 'GYO', 'K', 1.0)
WS = lambda m: (lambda x, y: 'S' if ((x - 1, y) not in m or (x, y + 2) not in m) else 'W')
earB = ell(29, 13, 2.8, 8, -22); earF = ell(36, 12, 3, 8.3, 6)
for e, cx, cy, a in ((earB, 29, 13, -22), (earF, 36, 12, 6)):
    fill(e, WS(e)); fill(ell(cx, cy + .3, 1.3, 6, a), 'P'); fill(edge(e), 'K')
foot = ell(10, 42, 5, 2.4, 10); fill(foot, 'W'); fill(edge(foot), 'K'); fill({(7, 42), (8, 42), (8, 41)}, 'P')
body = ell(23, 37.5, 13, 7) | ell(33, 34, 7, 5.5)   # むね（頭と 3 マス以上 重ねて 首を 太く）
fill(body, WS(body)); fill(edge(body), 'K')
tail = ell(10, 34, 2.8, 2.6); fill(tail, 'W'); fill(edge(tail), 'K')
head = ell(36, 26, 9, 7.5)
fill(head, WS(head)); fill(edge(head), 'K')
eye(39, 25)
fill(ell(36, 29, 1.8, 0.9), 'P')                                  # ほっぺ
fill({(44, 26), (44, 27), (43, 26)}, 'P')                         # はな
fill({(42, 29), (42, 30), (41, 30), (43, 30)}, 'K')                         # にっこり
# 前足と クレヨン（紙の上）
pB = ell(33, 41, 2.6, 2.2); fill(pB, 'W'); fill(edge(pB), 'K')
pF = ell(41, 38.5, 2.8, 2.4); fill(pF, 'W'); fill(edge(pF), 'K')
cr = line(42, 38, 48, 32, 2.4); fill(cr, 'R'); fill(edge(cr), 'K'); fill({(41, 39), (42, 39), (41, 40)}, 'R')
fill(line(44, 41, 48, 39), 'R')                                   # かいて いる せん
finish('usagimorioekaki', 'G')
