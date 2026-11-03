# うみべで ねこが おえかきを する（nekoumibeoekaki・段 XXL・64x48・natsu）
# 部品（楕円・多角形・線・ふちどり・かげ）で描いて、文字の地図 nekoumibeoekaki.txt を書き出す（1 マス＝1 粒）。
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
# 場所の物は うみ と すなはま（地面）。おえかきは イーゼルの にじの絵 と 筆。
# ---- 空（上は あけて、くも・おひさま）----
sky = rect(0, 11, 63, 15) - rect(0, 11, 5, 11)
fill(sky, 'S')
fill(ell(9, 13, 4.5, 1.4) | ell(12, 12, 3, 1.6), 'W')
fill(ell(58, 5, 3.2, 3.2), 'Y'); fill(edge(ell(58, 5, 3.2, 3.2)), 'O')
# ---- うみ（なみの線）----
sea = rect(0, 16, 63, 24)
fill(sea, 'B')
for (x, y) in sea:
    if y >= 21: put(x, y, 'S')
    if (y in (18, 22) and (x + y * 3) % 9 < 3): put(x, y, 'W')
fill({(x, 16) for x in range(W)}, 'K')
# ---- すなはま ----
sand = {(x, y) for (x, y) in ALL if y >= 25 + 0.8 * math.sin(x / 5.0)}
fill(sand, 'Y')
for (x, y) in sand:
    if (x * 5 + y * 11) % 13 == 0: put(x, y, 'O')
fill({(x, y) for (x, y) in sand if (x, y - 1) not in sand}, 'W')
# ---- イーゼル（右。脚は C、紙は しろ）----
shadow(52, 46, 11, 1.3, 'YOW', 'O', 1.0)
fill(line(52, 6, 52, 44, 2), 'C')                                  # 奥の脚
fill(line(45, 12, 41, 46, 2.2) | line(59, 12, 63, 46, 2.2), 'C')
fill(edge(line(45, 12, 41, 46, 2.2)) | edge(line(59, 12, 63, 46, 2.2)), 'K')
paper = rect(40, 8, 63, 31)
fill(paper, 'W')
# にじ（紙の中）
for i, c in enumerate('RYOGB'):
    r0 = 10 - i * 1.4
    fill({(x, y) for (x, y) in paper if r0 - 1.4 < math.hypot(x + .5 - 51.5, (y + .5 - 29) * 1.1) <= r0 and y <= 28}, c)
fill(ell(46, 27, 3, 1.6) | ell(57, 27, 3.2, 1.6), 'S')            # にじの はしの くも
fill(ell(59, 12, 2, 2), 'Y'); fill({(61, 10), (57, 10), (61, 14)}, 'O')   # 絵の おひさま
fill(edge(paper), 'K')
tray = rect(39, 32, 63, 33); fill(tray, 'C'); fill(edge(tray), 'K')
fill({(44, 31), (45, 31), (46, 31)}, 'R'); fill({(48, 31), (49, 31), (50, 31)}, 'B')   # 台の クレヨン
# ---- ねこ（すわって 右を むき、筆で かく）----
shadow(20, 46, 14, 1.6, 'YOW', 'O', 1.0)
tail = line(9, 43, 4, 36, 3.2) | line(4, 36, 5, 29, 3.2) | ell(6, 28, 2, 2)
fill(tail, 'O'); fill({(x, y) for (x, y) in tail if (x + y) % 4 == 0}, 'C'); fill(edge(tail), 'K')
body = ell(19, 35, 10, 10)
shape(body, 'O', sh='C', hi='Y')
for k in range(3):                                                 # せなかの しま
    fill(line(10 + k * 0 , 28 + k * 4, 14, 29 + k * 4), 'C')
belly = ell(23, 37, 5, 7); fill(belly, 'W'); fill({(x, y) for (x, y) in belly if (x - 1, y) not in belly}, 'S')
fill(edge(body), 'K')
for fx in (15, 25):                                                # 足
    f = ell(fx, 44.5, 3.6, 2.2); fill(f, 'W'); fill(edge(f), 'K'); put(fx, 44, 'K')
# 頭
earB = tri((12, 13), (14, 2), (21, 9)); earF = tri((24, 9), (31, 2), (32, 13))
for e in (earB, earF):
    fill(e, 'O'); fill(edge(e), 'K')
fill(tri((15, 10), (15, 5), (19, 9)) | tri((26, 9), (30, 5), (30, 11)), 'P')
head = ell(22, 18, 11, 9)
shape(head, 'O', sh='C', hi='Y')
for k in (-3, 0, 3):                                               # ひたいの しま
    fill(line(22 + k, 10, 22 + k, 12), 'C')
mz = ell(28.5, 22, 5.5, 3.6); fill(mz, 'W'); fill({(x, y) for (x, y) in mz if (x, y + 1) not in mz}, 'S')
fill(edge(head), 'K')
eye(20, 17); eye(29, 16)
fill({(31, 20), (32, 20), (31, 21)}, 'P')                          # はな
fill({(30, 23), (31, 24), (32, 23)}, 'K')                          # くち
fill(ell(17, 22, 2, 1), 'P')                                       # ほっぺ
fill(line(34, 20, 37, 19), 'K')             # ひげ
# うでと 筆（紙へ のばす）
arm = line(26, 32, 36, 28, 3.6)
shape(arm, 'O'); fill({(x, y) for (x, y) in arm if (x, y - 1) not in arm} - edge(arm), 'Y')
paw = ell(37.5, 27.5, 2.6, 2.4); fill(paw, 'W'); fill(edge(paw), 'K')
fill(line(37, 30, 43, 20), 'C'); fill(line(38, 30, 44, 20), 'Y')  # 筆の柄
fill({(44, 19), (45, 19), (45, 18), (44, 18)}, 'K'); fill({(45, 17), (46, 17), (46, 16), (47, 16)}, 'R')   # 筆の先（あか）
# パレット（足もと）
pal = ell(33, 41, 5, 2.2); fill(pal, 'C'); fill({(31, 40), (33, 40), (35, 41), (32, 42)}, 'Y')
fill({(34, 40), (31, 41)}, 'R'); fill({(35, 40), (33, 42)}, 'B'); fill({(30, 41)}, 'G'); fill(edge(pal), 'K')
finish('nekoumibeoekaki', 'Y')
