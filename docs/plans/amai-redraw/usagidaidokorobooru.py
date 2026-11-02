# だいどころで うさぎが ボールで あそぶ（usagidaidokorobooru・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり）で描いて、文字の地図 usagidaidokorobooru.txt を書き出す。
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
# ---- かべ（下の方だけ きいろ。上は あける）----
wall = rect(0, 14, 63, 34)
fill(wall, 'Y')
for (x, y) in wall:
    if y in (29, 30) or (y > 30 and x % 6 == 0): put(x, y, 'O')
# ---- まど（右上）----
win = rect(42, 2, 62, 18)
fill(win, 'S')
fill(ell(47, 6, 3, 1.4) | ell(50, 5, 2.5, 1.8), 'W')
fill(ell(56, 21, 12, 5) & win, 'G')
fill(rect(52, 2, 52, 18) | rect(42, 10, 62, 10), 'W')
fill(edge(win), 'K')
fill(rect(41, 19, 63, 20), 'W'); fill({(x, 20) for x in range(41, 64)}, 'S'); fill(edge(rect(41, 19, 63, 20)) - {(x, 19) for x in range(42, 63)}, 'K')
# ---- ゆか（青と白のタイル・奥へすぼまる）----
floor = rect(0, 35, 63, 47)
for (x, y) in floor:
    t = (y - 35) / 12.0
    u = int((x - 34) / (0.7 + t * 0.6) + 80) // 4; v = (y - 36) // 3
    put(x, y, 'B' if (u + v) % 2 == 0 else 'W')
fill({(x, 35) for x in range(W)}, 'K')
# ---- コンロ台となべ（左）----
cab = rect(0, 22, 15, 42)
fill(cab, 'C')
fill(rect(1, 28, 6, 40) | rect(9, 28, 14, 40), 'O')
fill(edge(rect(1, 28, 6, 40)) | edge(rect(9, 28, 14, 40)), 'C')
fill({(5, 34), (10, 34)}, 'K'); fill({(5, 33), (10, 33)}, 'Y')
fill(rect(0, 22, 16, 24), 'W'); fill(rect(0, 24, 16, 24), 'S')
fill(edge(cab | rect(0, 22, 16, 24)), 'K')
pot = rect(2, 14, 13, 21)
fill(pot, 'R'); fill({(x, y) for (x, y) in pot if x >= 11}, 'C'); fill({(x, y) for (x, y) in pot if x <= 3}, 'P')
lid = ell(7.5, 14, 6.5, 1.6); fill(lid, 'W'); fill({(x, y) for (x, y) in lid if y >= 14}, 'S')
fill(edge(pot | lid), 'K'); fill({(7, 11), (8, 11), (7, 12), (8, 12)}, 'K')
fill(rect(0, 17, 1, 18) | rect(14, 17, 15, 18), 'K')
for (sx, sy) in ((4, 9), (8, 7), (11, 9)):                       # ゆげ
    fill({(sx, sy), (sx + 1, sy - 1), (sx, sy - 2), (sx + 1, sy - 3)}, 'W')
fill(edge(rect(0, 7, 15, 9)) & set(), 'K')
# ---- うさぎ（ボールへ ぴょんと とぶ）----
shadow(33, 44, 11, 1.4, 'BW', 'K', 0.3)
WS = lambda m: (lambda x, y: 'S' if ((x - 2, y + 1) not in m or (x, y + 2) not in m) else 'W')
earB = ell(28, 14, 2.6, 8, -55); earF = ell(31, 12.5, 2.8, 8.2, -40)
for e, cx, cy, a in ((earB, 28, 14, -55), (earF, 31, 12.5, -40)):
    fill(e, WS(e)); fill(ell(cx, cy, 1.2, 6, a), 'P'); fill(edge(e), 'K')
legB = ell(18, 36, 7, 2.4, 25)
fill(legB, WS(legB)); fill(edge(legB), 'K')
body = ell(28, 30, 11, 7, -18)
fill(body, WS(body)); fill(edge(body), 'K')
tail = ell(17, 30, 2.6, 2.4); fill(tail, 'W'); fill(edge(tail), 'K')
head = ell(38, 21.5, 7.5, 6.5)
fill(head, WS(head)); fill(edge(head), 'K')
fill(ell(40.5, 20, 1.5, 2), 'K'); put(40, 19, 'W')               # 目（ボールを見る）
fill({(45, 22), (45, 23), (44, 22)}, 'P')                        # 鼻
fill({(43, 25), (44, 25), (42, 24)}, 'K')                        # 口（にっこり）
fill(ell(38, 24.5, 1.6, 0.9), 'P')
for (cx, cy) in ((45, 30), (42, 32.5)):                          # 前足（のばす）
    p = ell(cx, cy, 3, 1.8, -20); fill(p, 'W'); fill(edge(p), 'K')
for (a, b, c, d) in ((20, 22, 23, 23), (17, 25, 20, 26)):   # とぶ線
    fill(line(a, b, c, d), 'K')
# ---- ボール（はずむ）----
shadow(54, 44, 5, 1, 'BW', 'K', 0.3)
ball = ell(54, 28, 5, 5)
fill(ball, 'R')
for (x, y) in ball:
    if abs(y + .5 - (28.5 + 0.08 * (x + .5 - 54) ** 2)) < 1.0: put(x, y, 'Y')
fill({(x, y) for (x, y) in ball if (x + 1, y + 1) not in ball and (x + 2, y) not in ball}, 'C')
fill({(51, 25), (52, 25), (51, 26)}, 'W')
fill(edge(ball), 'K')
fill(line(57, 36, 58, 39) | line(51, 36, 50, 39), 'K')           # はずむ線
finish('usagidaidokorobooru', 'Y')
