# だいどころで ぱんだが おえかきを する（pandadaidokorooekaki・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり・かげ）で描いて、文字の地図 pandadaidokorooekaki.txt を書き出す（1 マス＝1 粒）。
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
# 場所の物は まど と テーブル の 2 つ。おえかきは テーブルの 紙（にじと 花の絵）と あかい クレヨン。
# ぱんだ＝しろい体・くろい耳・目のまわり・うで・あし（しろい所は K のふちで区切る）。頬は ピンク。
# ---- 床（タイル。奥へ すぼまる目地）y 38..47 ----
FY = 38
for y in range(FY, H):
    for x in range(W):
        u = (x - 32) * 10 / (y - FY + 10)
        put(x, y, 'O' if (math.floor(u / 4) + (y - FY) // 3) % 2 == 0 else 'Y')
fill({(x, FY) for x in range(W)}, 'K')
# ---- かべの 下の いた（はば木）----
fill(rect(0, 35, 63, 37), 'C'); fill({(x, 35) for x in range(W)}, 'K')
# ---- まど（右上。外は 空と くも）----
win = rect(39, 0, 63, 17)
fill(win, 'S')
fill(ell(45, 5, 3.5, 1.5) | ell(48, 4, 2.6, 1.8), 'W'); fill(ell(58, 12, 4, 1.4), 'W')
fill(rect(51, 0, 52, 17) | rect(39, 8, 63, 9), 'C')
fill(edge(win), 'K')
fill(rect(37, 18, 63, 19), 'W'); fill({(x, 19) for x in range(37, 64)} | {(37, 18)}, 'K')   # まど台
# ---- テーブル（右・ななめ）----
ttop = poly([(38, 26), (64, 26), (64, 31), (34, 31)])
fill(ttop, lambda x, y: 'O' if y < 29 else 'C')
front = rect(34, 31, 63, 33); fill(front, 'C'); fill({(x, 32) for x in range(36, 63, 4)}, 'O')
fill(edge(ttop | front), 'K')
for lx in (36, 60):
    fill(rect(lx, 34, lx + 1, 46), 'C'); fill(rect(lx + 1, 34, lx + 1, 46), 'K')
fill(ell(50, 46.5, 13, 1.2) - rect(36, 34, 37, 47) - rect(60, 34, 61, 47), 'C')   # 床の かげ
# 紙（テーブルの上・ななめ）
paper = poly([(42, 20), (60, 20), (63, 29), (40, 29)])
fill(paper, 'W'); fill({(x, y) for (x, y) in paper if (x, y + 1) not in paper}, 'S')
for (x, y) in paper:
    r = math.hypot(x + .5 - 50, (y + .5 - 28) * 1.3)
    for k, c in enumerate('RYGB'):
        if 6.6 - k * 1.3 < r <= 7.9 - k * 1.3: put(x, y, c)
fill(line(58, 24, 58, 28), 'G'); fill({(57, 26), (59, 27)}, 'G')   # 絵の 花
fill({(57, 23), (59, 23), (58, 22), (58, 24), (57, 22), (59, 22), (57, 24), (59, 24)}, 'P'); put(58, 23, 'Y')
fill(edge(paper), 'K')
for (cx, c) in ((44, 'B'), (54, 'G')):                             # テーブルの クレヨン
    cr = rect(cx, 30, cx + 3, 30); fill(cr, c); put(cx + 3, 30, 'K')
# ---- ぱんだ（いすに すわって 右を むき、クレヨンで かく）----
shadow(20, 46.5, 15, 1.3, 'OY', 'C', 1.0)
WS = lambda m: (lambda x, y: 'S' if ((x - 1, y) not in m or (x, y + 2) not in m) else 'W')
legB = ell(12, 42, 5, 4, 20); fill(legB, 'K')
body = ell(21, 34, 11, 10.5)
fill(body, WS(body)); fill(edge(body), 'K')
legF = ell(28, 43, 6.5, 3.4); fill(legF, 'K'); fill(ell(31, 43, 2.4, 1.6), 'C')
armB = line(13, 30, 10, 37, 4); fill(armB, 'K')
fill(rect(12, 25, 30, 27) & body, 'K')                            # かたの くろい帯
earB = ell(15, 7, 4, 4); earF = ell(31, 6, 4, 4)
fill(earB | earF, 'K'); fill({(31, 5), (32, 5), (15, 6)}, 'C')
head = ell(23.5, 15, 11, 9)
fill(head, WS(head)); fill(edge(head), 'K')
fill(ell(19, 15, 2.6, 3.4, 30), 'K'); fill(ell(29, 14, 2.6, 3.4, -30), 'K')   # 目のまわり
put(19, 14, 'W'); put(29, 13, 'W'); put(20, 15, 'W'); put(30, 14, 'W')
fill(ell(15, 19, 1.9, 1.1) | ell(31.5, 18.5, 1.6, 1), 'P')       # ほっぺ
fill(ell(24.5, 18.5, 1.8, 1.2), 'K')                              # はな
fill({(23, 21), (24, 22), (25, 22), (26, 21)}, 'K')               # くち
# 前の うで と クレヨン（紙へ）
armF = line(28, 29, 40, 26, 4.2); fill(armF, 'K')
paw = ell(41, 25.5, 2.6, 2.4); fill(paw, 'K'); put(41, 24, 'C')
cr = line(42, 25, 47, 20, 2.4); fill(cr, 'R'); fill(edge(cr) - paper, 'K'); fill({(48, 19), (47, 19)}, 'R')
finish('pandadaidokorooekaki', 'W')
