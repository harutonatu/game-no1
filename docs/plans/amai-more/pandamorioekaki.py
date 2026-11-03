# もりで ぱんだが おえかきを する（pandamorioekaki・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり・かげ）で描いて、文字の地図 pandamorioekaki.txt を書き出す（1 マス＝1 粒）。
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
# 場所の物は 背の高い木 と 切りかぶ の 2 つ。おえかきは 切りかぶに のせた 紙（花の絵）と あかい クレヨン。
# ぱんだ＝しろい体・くろい耳・目のまわり・うで・あし（しろい所は K のふちで区切る）。頬は ピンク。
# ---- 空（木の すきま）----
fill(rect(0, 17, 63, 29) - rect(0, 17, 4, 17), 'S')
fill(ell(7, 19, 4.5, 1.3) | ell(10, 18, 3, 1.6), 'W')
# ---- 地面（くさ・おちば）----
ground = {(x, y) for (x, y) in ALL if y >= 30 + 1.2 * math.sin(x / 6.0)}
fill(ground, 'G')
for (x, y) in ground:
    if (x * 7 + y * 3) % 17 == 0: put(x, y, 'Y')
    elif (x * 3 + y * 5) % 23 == 0: put(x, y, 'O')
fill({(x, y) for (x, y) in ground if (x, y - 1) not in ground}, 'K')
# ---- 背の高い木（右おく）----
shadow(56, 37, 8, 1.2, 'GYO', 'K', 1.0)
trunk = poly([(52, 6), (58, 6), (59, 34), (61, 37), (49, 37), (51, 34)])
shape(trunk, 'C', sh='K', sw=1)
for y in range(10, 34, 5): fill(line(53, y, 55, y + 1), 'K')
fill(rect(57, 8, 57, 33) & trunk, 'O')
can = ell(54, 7, 10, 7.5) | ell(46, 11, 5, 3.5) | ell(62, 12, 4, 3.5)
fill(can, 'G')
fill({(x, y) for (x, y) in can if (x + 2, y + 2) not in can}, 'K')
fill({(x, y) for (x, y) in can if (x * 3 + y * 7) % 11 == 0 and (x - 2, y - 2) in can}, 'Y')
fill(edge(can), 'K')
# ---- 切りかぶ（手前右。上に 紙）----
shadow(47, 46, 11, 1.3, 'GYO', 'K', 1.0)
stump = rect(38, 36, 56, 44) | ell(47, 44, 9.5, 1.8)
shape(stump, 'C', sh='K', sw=1)
fill({(x, y) for (x, y) in stump if x in (41, 46, 51, 54) and y > 38}, 'K')
top = ell(47, 35.5, 9.5, 3); fill(top, 'Y')
fill(edge(ell(47, 35.5, 6, 1.8)), 'O'); fill(edge(top), 'K')
paper = poly([(36, 23), (56, 23), (60, 35), (40, 35)])           # ななめに おいた 紙
fill(paper, 'W'); fill({(x, y) for (x, y) in paper if (x, y + 1) not in paper}, 'S')
for (fx, fy, pc) in ((47, 27, 'R'), (54, 28, 'P')):              # 絵の 花 2 つ
    fill(line(fx, fy + 2, fx, 33), 'G'); put(fx - 1, fy + 4, 'G'); put(fx + 1, fy + 5, 'G')
    fill({(fx - 1, fy), (fx + 1, fy), (fx, fy - 1), (fx, fy + 1), (fx - 1, fy - 1), (fx + 1, fy + 1), (fx - 1, fy + 1), (fx + 1, fy - 1)}, pc)
    put(fx, fy, 'Y')
fill({(43, 33), (44, 32), (45, 33), (50, 33), (51, 32), (52, 33), (57, 33), (56, 32)}, 'B')   # 絵の くさ（あお）
fill({(41, 25), (42, 25), (41, 26), (42, 26)}, 'O')               # 絵の おひさま
fill(edge(paper), 'K')
for (cx, c) in ((38, 'R'), (43, 'B'), (57, 'Y')):                  # 地面の クレヨン
    cr = rect(cx, 45, cx + 3, 46); fill(cr, c); fill({(cx + 3, 45), (cx + 3, 46)}, 'K')
# ---- ぱんだ（すわって 右を むき、クレヨンで かく）----
shadow(22, 46, 14, 1.6, 'GYO', 'K', 1.0)
WS = lambda m: (lambda x, y: 'S' if ((x - 1, y) not in m or (x, y + 2) not in m) else 'W')
legB = ell(12, 42, 5, 4, 20); shape(legB, 'K')
body = ell(21, 34, 11, 10.5)
fill(body, WS(body)); fill(edge(body), 'K')
legF = ell(28, 42.5, 6.5, 3.6); fill(legF, 'K'); fill(ell(30, 42.5, 2.4, 1.6), 'C')   # あしのうら
armB = line(13, 30, 10, 37, 4); fill(armB, 'K')
fill(rect(12, 25, 30, 27) & body, 'K')                            # かたの くろい帯
earB = ell(15, 7, 4, 4); earF = ell(31, 6, 4, 4)
fill(earB | earF, 'K'); fill({(31, 5), (32, 5), (15, 6)}, 'C')
head = ell(23.5, 15, 11, 9)
fill(head, WS(head)); fill(edge(head), 'K')
fill(ell(19, 15, 2.6, 3.4, 30), 'K'); fill(ell(29, 14, 2.6, 3.4, -30), 'K')   # 目のまわり
put(19, 14, 'W'); put(29, 13, 'W'); put(20, 15, 'W'); put(30, 14, 'W')      # 目の光
fill(ell(15, 19, 1.9, 1.1) | ell(31.5, 18.5, 1.6, 1), 'P')       # ほっぺ
fill(ell(24.5, 18.5, 1.8, 1.2), 'K')            # はな
fill({(23, 21), (24, 22), (25, 22), (26, 21)}, 'K')               # くち
# 前の うで と クレヨン（紙へ）
armF = line(28, 29, 39, 31, 4.2); fill(armF, 'K')
paw = ell(40, 31.5, 2.6, 2.4); fill(paw, 'K'); put(40, 30, 'C')
cr = line(40, 32, 45, 26, 2); fill(cr, 'R'); fill(edge(cr), 'K'); fill({(46, 25), (45, 25)}, 'R')   # クレヨン
fill(line(46, 25, 44, 30) - cr, 'R')                              # かいて いる せん
finish('pandamorioekaki', 'G')
