# うみべで うさぎが おやつを たべる（usagiumibeoyatsu・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり）で描いて、文字の地図 usagiumibeoyatsu.txt を書き出す。
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
sky = rect(0, 9, 63, 15) - rect(0, 9, 9, 10) - rect(54, 9, 63, 9)
fill(sky, 'S')
fill(ell(48, 9, 5, 1.8) | ell(52, 8, 3.5, 2.2) | ell(9, 11, 4, 1.5), 'W')
# ---- うみ（なみの線。奥は こい青）----
sea = rect(0, 16, 63, 25)
fill(sea, 'B')
for (x, y) in sea:
    if y >= 21: put(x, y, 'S')
    if (y in (18, 22) and (x + y * 3) % 9 < 3) or (y == 24 and (x // 2) % 3 == 0): put(x, y, 'W')
fill({(x, 16) for x in range(W)}, 'K')
# ---- すなはま（手前ほど ひろい。つぶつぶ）----
sand = {(x, y) for (x, y) in ALL if y >= 26 + 1.0 * math.sin(x / 6.0)}
fill(sand, 'Y')
for (x, y) in sand:
    if (x * 5 + y * 11) % 13 == 0: put(x, y, 'O')
fill({(x, y) for (x, y) in sand if (x, y - 1) not in sand}, 'W')   # なみうちぎわの あわ
# ---- まるごとの すいか（右・砂の上）----
shadow(53, 45, 9, 1.4, 'YOW', 'O', 1.0)
wm = ell(53, 39.5, 8, 6)
fill(wm, 'G')
for (x, y) in wm:
    if abs(x + .5 - 53 - (1 if y % 3 == 0 else 0)) % 5 < 1 and abs(x + .5 - 53) < 7: put(x, y, 'K')
fill(ell(56, 36.5, 1.8, 1), 'W')
fill(edge(wm), 'K')
fill(line(52, 33, 51, 31), 'C'); put(50, 31, 'C')
# ---- うさぎ（すわって、すいかを かじる。右むき）----
shadow(26, 46, 14, 1.6, 'YOW', 'O', 1.0)
WS = lambda m: (lambda x, y: 'S' if ((x - 1, y) not in m or (x, y + 2) not in m) else 'W')
earB = ell(21, 10.5, 2.8, 8, -18); earF = ell(28, 9.5, 2.9, 8.2, 8)
for e, cx, cy, a in ((earB, 21, 10.5, -18), (earF, 28, 9.5, 8)):
    fill(e, WS(e)); fill(ell(cx, cy + .3, 1.3, 6, a), 'P'); fill(edge(e), 'K')
body = ell(22, 36.5, 9.8, 8.8)
fill(body, WS(body)); fill(edge(body), 'K')
tail = ell(12, 40, 2.6, 2.4); fill(tail, 'W'); fill(edge(tail), 'K')
foot = ell(27, 44.5, 6, 2)
fill(foot, 'W'); fill(edge(foot), 'K'); fill({(31, 44), (32, 44), (30, 44)}, 'P')
head = ell(27, 23.5, 9.5, 8)
fill(head, WS(head)); fill(edge(head), 'K')
fill(ell(31.5, 21.5, 1.5, 2.1), 'K'); put(31, 20, 'W'); put(32, 21, 'K')                # 目
fill(ell(29, 26.5, 1.6, 0.9), 'P')                                     # ほっぺ
fill({(35, 23), (35, 24), (34, 23)}, 'P')                          # 鼻
# ---- すいかの ひときれ（口へ）----
ax, ay, R = 34, 27, 17
sl = set()
for (x, y) in ALL:
    dx, dy = x + .5 - ax, y + .5 - ay
    r = math.hypot(dx, dy); a = math.degrees(math.atan2(dy, dx))
    if 2.5 <= r <= R and -38 <= a <= 18:
        sl.add((x, y))
fill(sl, 'R')
for (x, y) in sl:
    r = math.hypot(x + .5 - ax, y + .5 - ay)
    if r > R - 2.2: put(x, y, 'G')
    elif r > R - 3.2: put(x, y, 'W')
for (rr, aa) in ((7, -20), (9, -5), (10, -30), (12, -15), (12, 5), (8, 8), (5, -10)):   # たね
    x = int(ax + rr * math.cos(math.radians(aa))); y = int(ay + rr * math.sin(math.radians(aa)))
    if (x, y) in sl: put(x, y, 'K'); put(x, y + 1, 'K')
fill({(x, y) for (x, y) in sl if (x, y + 1) not in sl and math.hypot(x + .5 - ax, y + .5 - ay) <= R - 3.2}, 'P')
fill(edge(sl), 'K')
for (cx, cy) in ((38, 30.5), (44, 30)):                            # 手
    p = ell(cx, cy, 2.6, 2.3); fill(p, 'W'); fill(edge(p), 'K')
fill({(35, 26), (34, 27), (35, 27)}, 'K')                          # かじる口
finish('usagiumibeoyatsu', 'Y')
