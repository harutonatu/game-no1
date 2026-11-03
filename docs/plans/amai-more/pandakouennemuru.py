# こうえんで ぱんだが ねむる（pandakouennemuru・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり・かげ）で描いて、文字の地図 pandakouennemuru.txt を書き出す（1 マス＝1 粒）。
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
# 場所の物は ベンチ と まるい木 の 2 つ。ねむるは とじた目・はなちょうちん・Z。
# ぱんだ＝しろい体・くろい耳・目のまわり・うで・あし（しろい所は K のふちで区切る）。頬は ピンク。
# ---- 空 ----
fill(rect(0, 16, 63, 29) - rect(0, 16, 8, 17), 'S')
fill(ell(40, 26, 4, 1.3) | ell(43, 25, 2.6, 1.5), 'W')
# ---- しばふ（花の つぶ）----
ground = {(x, y) for (x, y) in ALL if y >= 30 + 0.8 * math.sin(x / 7.0)}
fill(ground, 'G')
for (x, y) in ground:
    if (x * 7 + y * 3) % 17 == 0: put(x, y, 'Y')
    elif (x * 3 + y * 5) % 23 == 0: put(x, y, 'P')
    elif (x * 5 + y * 13) % 31 == 0: put(x, y, 'W')
fill({(x, y) for (x, y) in ground if (x, y - 1) not in ground}, 'K')
# ---- まるい木（右）----
shadow(55, 38, 9, 1.2, 'GYPW', 'K', 1.0)
trunk = poly([(53, 18), (57, 18), (58, 35), (60, 38), (50, 38), (52, 35)])
shape(trunk, 'C', sh='K', sw=1); fill(rect(56, 20, 56, 34) & trunk, 'O')
can = ell(55, 12, 9, 9.5) | ell(48, 16, 4.5, 4) | ell(62, 16, 4, 4)
fill(can, 'G')
fill({(x, y) for (x, y) in can if (x + 2, y + 2) not in can}, 'K')
fill({(x, y) for (x, y) in can if (x * 3 + y * 7) % 11 == 0 and (x - 2, y - 2) in can}, 'Y')
for (ax, ay) in ((52, 9), (58, 13), (54, 17), (60, 7)):           # 木の みの あか
    fill({(ax, ay), (ax + 1, ay), (ax, ay + 1), (ax + 1, ay + 1)}, 'R')
fill(edge(can), 'K')
# ---- ベンチ（ななめ。背もたれ・すわる板・脚）----
for y0 in (18, 23):                                               # 背もたれの 板
    bk = poly([(3, y0), (45, y0 - 2), (45, y0 + 2), (3, y0 + 4)]); fill(bk, 'C')
    fill({(x, y) for (x, y) in bk if (x, y - 1) not in bk}, 'O'); fill(edge(bk), 'K')
seat = poly([(1, 34), (47, 32), (48, 36), (2, 38)])
fill(seat, 'C'); fill({(x, y) for (x, y) in seat if (x, y - 1) not in seat}, 'O'); fill(edge(seat), 'K')
for (lx, ly) in ((4, 38), (44, 36)):                              # 脚（あおい 鉄）
    lg = rect(lx, ly, lx + 2, 46); fill(lg, 'B'); fill(edge(lg), 'K')
# ---- ぱんだ（ベンチに すわり、頭を かたむけて ねむる）----
WS = lambda m: (lambda x, y: 'S' if ((x - 1, y) not in m or (x, y + 2) not in m) else 'W')
body = ell(24, 30, 11, 9.5)
fill(body, WS(body)); fill(edge(body), 'K')
fill({(x, y) for (x, y) in body if y <= 23}, 'K')                 # かたの くろい帯
for (lx, a) in ((17, 10), (31, -10)):                             # あし（前へ たらす）
    lg = ell(lx, 41, 4, 5.5, a); fill(lg, 'K'); fill(ell(lx, 43.5, 2.2, 1.6), 'C')
armL = ell(13.5, 31, 3.2, 6.5, 15); armR = ell(34.5, 31, 3.2, 6.5, -15)    # よこに おろした うで
fill(armL | armR, 'K')
earB = ell(13, 6, 4, 4); earF = ell(30, 3.5, 4, 4)
fill(earB | earF, 'K'); put(13, 5, 'C'); put(30, 3, 'C')
head = ell(22, 13, 11, 8.6, -12)
fill(head, WS(head)); fill(edge(head), 'K')
for (ex, ey, a) in ((17, 13, 10), (26, 11, -35)):
    fill(ell(ex + .5, ey + .8, 3.4, 2.7, a), 'K')                 # 目のまわり（たれ目）
    fill({(ex - 2, ey), (ex - 1, ey + 1), (ex, ey + 1), (ex + 1, ey + 1), (ex + 2, ey)}, 'W')   # とじた目
fill(ell(13.5, 17, 1.8, 1) | ell(29.5, 15, 1.8, 1), 'P')         # ほっぺ
fill(ell(23, 16.5, 1.7, 1.1), 'K')                                # はな
fill({(22, 19), (23, 20), (24, 19)}, 'K')                         # くち
bub = ell(29, 20, 3.4, 3.2); fill(bub, 'S'); fill({(28, 18), (29, 18), (28, 19)}, 'W'); fill(edge(bub), 'B'); fill({(25, 18), (26, 18)}, 'B')   # はなちょうちん
# Z（ねむって いる）
zz(37, 10, 4); zz(40, 2, 6); zz(35, 15, 3)
finish('pandakouennemuru', 'G')
