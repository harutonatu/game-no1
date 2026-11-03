# もりで いぬが おえかきを する（inumorioekaki・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり・かげ）で描いて、文字の地図 inumorioekaki.txt を書き出す（1 マス＝1 粒）。
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
# 場所の物は 背の高い木 と きのこ の 2 つ。おえかきは イーゼルの 花の絵 と 口に くわえた 筆。
# いぬ＝白い体・ちゃいろの ぶち と たれ耳・あかい くびわ（amai-redraw/inudaidokorooyatsu.png を手本に）。
# ---- 空（木の すきま）----
fill(rect(0, 17, 63, 29) - rect(30, 17, 40, 17), 'S')
fill(ell(14, 20, 4, 1.3) | ell(16, 19, 2.6, 1.5), 'W')
# ---- 地面（くさ・おちば）----
ground = {(x, y) for (x, y) in ALL if y >= 30 + 1.2 * math.sin(x / 6.5 + 2)}
fill(ground, 'G')
for (x, y) in ground:
    if (x * 7 + y * 3) % 17 == 0: put(x, y, 'Y')
    elif (x * 3 + y * 5) % 23 == 0: put(x, y, 'O')
    elif (x * 5 + y * 13) % 29 == 0: put(x, y, 'R')
fill({(x, y) for (x, y) in ground if (x, y - 1) not in ground}, 'K')
# ---- 背の高い木（左おく）----
shadow(6, 36, 8, 1.2, 'GYOR', 'K', 1.0)
trunk = poly([(2, 6), (8, 6), (9, 33), (11, 36), (-1, 36), (1, 33)])
shape(trunk, 'C', sh='K', sw=1)
for y in range(10, 33, 5): fill(line(3, y, 5, y + 1), 'K')
fill(rect(7, 8, 7, 32) & trunk, 'O')
can = ell(5, 6, 10, 7.5) | ell(14, 10, 5, 3.5)
fill(can, 'G')
fill({(x, y) for (x, y) in can if (x + 2, y + 2) not in can}, 'K')
fill({(x, y) for (x, y) in can if (x * 3 + y * 7) % 11 == 0 and (x - 2, y - 2) in can}, 'Y')
fill(edge(can), 'K')
# きのこ（左手前）
st = rect(4, 41, 7, 45); fill(st, 'W'); fill(rect(7, 41, 7, 45), 'S'); fill(edge(st), 'K')
cap = {(x, y) for (x, y) in ell(6, 41, 5.5, 4.2) if y <= 40}
fill(cap, 'R'); fill({(3, 39), (4, 39), (7, 38), (8, 38), (6, 39), (9, 40)}, 'W'); fill(edge(cap), 'K')
# ---- イーゼル（右。紙に 花の絵）----
shadow(53, 46, 10, 1.3, 'GYOR', 'K', 1.0)
fill(line(53, 6, 53, 44, 2), 'C')
fill(line(47, 10, 43, 46, 2.2) | line(59, 10, 63, 46, 2.2), 'C')
fill(edge(line(47, 10, 43, 46, 2.2)) | edge(line(59, 10, 63, 46, 2.2)), 'K')
paper = rect(43, 9, 63, 30)
fill(paper, 'W')
fill({(x, y) for (x, y) in paper if y >= 25}, 'G')                # 絵の くさはら
for (x, y) in paper:
    r = math.hypot(x + .5 - 63, y + .5 - 9)
    if 7 < r <= 8.4: put(x, y, 'R')
    elif 5.6 < r <= 7: put(x, y, 'Y')
    elif 4.2 < r <= 5.6: put(x, y, 'B')
fill(line(52, 17, 52, 26), 'G'); fill({(51, 21), (50, 20), (53, 23), (54, 22)}, 'G')   # 花の くき と 葉
pet = ell(52.5, 15.5, 4, 3.6) - ell(52.5, 15.5, 1.6, 1.5)
fill(pet, 'P'); fill({(x, y) for (x, y) in pet if (x + y) % 4 == 0}, 'R')
fill(ell(52.5, 15.5, 1.6, 1.5), 'Y')
fill(ell(46, 27, 1.5, 1.2), 'Y'); fill(ell(58, 27, 1.5, 1.2), 'P')   # 小さい 花
fill(edge(paper), 'K')
tray = rect(41, 31, 63, 32); fill(tray, 'C'); fill(edge(tray), 'K')
fill({(45, 30), (46, 30), (47, 30)}, 'B'); fill({(57, 30), (58, 30), (59, 30)}, 'Y')
# ---- いぬ（すわって 右を むき、筆を くわえて かく）----
shadow(25, 46, 14, 1.4, 'GYOR', 'K', 1.0)
tail = ell(9, 32, 2.4, 5, -35)
hind = ell(17, 40, 7, 5.5)
body = ell(23, 33, 11, 11)
legA = poly([(25, 33), (30, 33), (31, 45), (26, 45)]); legB = poly([(31, 32), (35, 32), (36, 45), (32, 45)])
head = ell(24, 16, 10, 9)
snout = ell(33, 20, 5.5, 3.6)
earB = ell(31, 13, 3, 6, -20)
earF = ell(17, 17, 3.6, 7.5, 15)
shape(tail, 'C')
fill(hind, 'W'); fill({(x, y) for (x, y) in hind if (x, y + 2) not in hind}, 'S'); fill(edge(hind), 'K')
fill(body, 'W'); fill({(x, y) for (x, y) in body if ((x + 2, y) not in body or (x, y + 2) not in body)}, 'S')
fill(ell(16, 28, 5, 4) & body, 'C'); fill(edge(body), 'K')       # せなかの ぶち
for m in (legA, legB):
    fill(m, 'W'); fill({(x, y) for (x, y) in m if (x + 1, y) not in m}, 'S'); fill(edge(m), 'K')
fill({(27, 44), (29, 44), (33, 44), (35, 44)}, 'K')
fill(ell(24, 25.5, 9, 1.6), 'R'); fill(edge(ell(24, 25.5, 9, 1.6)), 'K')   # くびわ
fill(ell(26, 28, 1.5, 1.5), 'Y'); fill(edge(ell(26, 28, 1.5, 1.5)), 'K')
shape(earB, 'C')
fill(head | snout, 'W'); fill({(x, y) for (x, y) in head if (x, y + 2) not in head and (x, y + 2) not in snout}, 'S')
fill(edge(head | snout), 'K')
fill(ell(28, 12, 3, 3), 'C')                                      # 目の ぶち
eye(27, 12); eye(20, 12)
fill(rect(37, 17, 39, 18) | {(38, 19)}, 'K'); put(37, 17, 'W')    # はな
fill(line(32, 22, 37, 22), 'K')                                   # くち
shape(earF, 'C'); fill({(x, y) for (x, y) in earF if (x - 1, y) not in earF} - edge(earF), 'O')
fill(rect(21, 19, 23, 19), 'P')                                   # ほっぺ
# くわえた 筆（紙へ）
fill(line(33, 23, 43, 18), 'Y'); fill(line(33, 24, 43, 19), 'C')
fill({(44, 17), (44, 18), (45, 17)}, 'K'); fill({(46, 16), (45, 16), (46, 17)}, 'P')
finish('inumorioekaki', 'G')
