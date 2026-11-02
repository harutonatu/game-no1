# だいどころで いぬが ねむる（inudaidokoronemuru・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり・かげ）で描いて、文字の地図 <id>.txt を書き出す（1 マス＝1 粒）。
import math, os
W, H = 64, 48
g = [['.'] * W for _ in range(H)]
def put(x, y, c):
    if 0 <= x < W and 0 <= y < H: g[y][x] = c
def ell(cx, cy, rx, ry, ang=0):
    a = math.radians(ang); s = set()
    for y in range(H):
        for x in range(W):
            dx, dy = x - cx, y - cy
            u = dx * math.cos(a) + dy * math.sin(a); v = -dx * math.sin(a) + dy * math.cos(a)
            if (u / rx) ** 2 + (v / ry) ** 2 <= 1: s.add((x, y))
    return s
def rect(x0, y0, x1, y1):
    return {(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)}
def poly(pts):
    s = set(); n = len(pts)
    for y in range(H):
        for x in range(W):
            px, py = x + .5, y + .5; ins = False
            for i in range(n):
                ax, ay = pts[i]; bx, by = pts[(i + 1) % n]
                if (ay > py) != (by > py) and px < ax + (py - ay) * (bx - ax) / (by - ay): ins = not ins
            if ins: s.add((x, y))
    return s
def line(x0, y0, x1, y1, w=0):
    s = set(); n = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(n + 1):
        x = round(x0 + (x1 - x0) * i / n); y = round(y0 + (y1 - y0) * i / n)
        for k in range(w + 1): s.add((x + k, y))
    return s
def fill(m, c):
    for x, y in m:
        cc = c(x, y) if callable(c) else c
        if cc: put(x, y, cc)
def edge(m):
    return {(x, y) for x, y in m if any((x + dx, y + dy) not in m for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
def shape(m, c, o='K', sh=None, hi=None, d=2):
    """塗って、かげ（右下）・明るい所（左上）を付けて、ふちどり。光は左上から。"""
    fill(m, c)
    if sh: fill({(x, y) for x, y in m if (x + d, y) not in m or (x, y + d) not in m}, sh)
    if hi: fill({(x, y) for x, y in m if ((x - d, y) not in m or (x, y - d) not in m) and (x + d, y) in m and (x, y + d) in m}, hi)
    if o: fill(edge(m), o)
def z(x, y, n, c='K'):
    for i in range(n): put(x + i, y, c); put(x + i, y + n - 1, c); put(x + n - 1 - i, y + i, c)
def finish(name, hole='W'):
    out = set(); st = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
    st = [p for p in st if g[p[1]][p[0]] == '.']; out = set(st)
    while st:
        x, y = st.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if 0 <= q[0] < W and 0 <= q[1] < H and q not in out and g[q[1]][q[0]] == '.': out.add(q); st.append(q)
    for y in range(H):
        for x in range(W):
            if g[y][x] == '.' and (x, y) not in out: g[y][x] = hole   # 閉じた空きは埋める
    rows = [''.join(r) for r in g]
    while rows and set(rows[0]) == {'.'}: rows.pop(0)
    while rows and set(rows[-1]) == {'.'}: rows.pop()
    while all(r[0] == '.' for r in rows): rows = [r[1:] for r in rows]
    while all(r[-1] == '.' for r in rows): rows = [r[:-1] for r in rows]
    here = os.path.dirname(os.path.abspath(__file__))
    open(os.path.join(here, name + '.txt'), 'w').write('\n'.join(rows) + '\n')
    cnt = {}
    for r in rows:
        for c in r:
            if c != '.': cnt[c] = cnt.get(c, 0) + 1
    print(sum(cnt.values()), cnt)

# だいどころで いぬが ねむる：夜の だいどころで、クッションに ねそべって ねむる いぬ（絵の半分）。場所の物は まど と クッション の 2 つ。
# 床（板。奥へ すぼまる目地）y 31..47
FY = 31
for y in range(FY, H):
    for x in range(W):
        u = (x - 34) * 12 / (y - FY + 12)
        c = 'C' if abs(u - round(u / 6) * 6) < 0.5 else ('Y' if (y - FY) % 5 == 4 else 'O')
        put(x, y, c)
# こしいた（かべの下の 木の板）y 24..30
for y in range(24, FY):
    for x in range(W):
        put(x, y, 'K' if y == 24 or y == FY - 1 else ('O' if x % 8 == 0 else 'C'))
# まど（夜。三日月と ほし。左右に カーテン）
win = rect(26, 0, 55, 15)
fill(win, 'B')
moon = ell(48, 5, 3.6, 3.6) - ell(50, 4, 3, 3)
fill(moon, 'Y')
for x, y in ((31, 3), (37, 2), (35, 11), (45, 12), (53, 11), (30, 9)):
    fill({(x, y), (x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)}, 'Y'); put(x, y, 'W')
fill(rect(40, 0, 41, 15), 'C'); fill(rect(26, 7, 55, 8), 'C')
fill(edge(win), 'K')
fill(rect(25, 16, 56, 17), 'W'); fill({(x, 17) for x in range(25, 57)} | {(25, 16), (56, 16)}, 'K')   # まど台
for cx0, d in ((24, 1), (57, -1)):                                             # カーテン（たばねた）
    cur = poly([(cx0 - 3 * d, 0), (cx0 + 4 * d, 0), (cx0 + 2 * d, 8), (cx0 + 4 * d, 15), (cx0 - 3 * d, 15), (cx0 - 1 * d, 8)])
    fill(cur, lambda x, y: 'P' if (x + y // 3) % 3 else 'R'); fill(edge(cur), 'K')
    fill(rect(min(cx0, cx0 + 2 * d), 8, max(cx0, cx0 + 2 * d), 8), 'R')
# クッション（いぬの ベッド。ななめ上から見た まるい形）
fill(ell(32, 46, 27, 1.6), 'K')
cush = ell(32, 40, 28, 6.8)
fill(cush, lambda x, y: 'R' if (x, y + 2) not in cush else ('P' if (x - y) % 6 else 'W'))
fill(edge(cush), 'K')
# いぬ（はらばいで 左を向き、前足に あごを のせて ねむる）
def wsh(m):
    fill({(x, y) for x, y in m if (x, y + 2) not in m or (x + 2, y) not in m} - edge(m), 'S')
tail = ell(57, 27, 2.8, 6, 40); shape(tail, 'W'); fill(ell(59, 24, 1.6, 2, 40) & tail, 'C'); fill(edge(tail), 'K')
body = ell(39, 31, 17, 9)
shape(body, 'W'); wsh(body)
fill(ell(42, 26.5, 7.5, 3.4), 'C'); fill(ell(41, 25.5, 4.5, 1.3), 'O'); fill(edge(body), 'K')     # せなかの もよう
hind = ell(48, 36, 7, 4); shape(hind, 'W'); wsh(hind); fill(edge(hind), 'K')
fill({(42, 39), (44, 39)}, 'K')
head = ell(18, 27, 10, 8.5)
snout = ell(9, 31, 6, 3.8)
shape(head | snout, 'W'); fill({(x, y) for x, y in head | snout if (x, y + 2) not in head | snout} - edge(head | snout), 'S')
fill(edge(head | snout), 'K')
fill(ell(20, 24, 3.4, 3), 'C')                                                   # 目の もよう
for ex, ey in ((12, 24), (18, 24)):                                             # とじた目
    for dx, dy in ((0, 0), (1, 1), (2, 1), (3, 0)): put(ex + dx, ey + dy, 'K')
fill(rect(3, 28, 5, 29) | {(4, 30)}, 'K'); put(3, 28, 'W')                      # 鼻
fill(line(5, 33, 11, 33), 'K'); fill(rect(13, 29, 15, 30), 'R')                # 口・ほっぺ
ear = ell(25, 28, 4, 7.5, -20); shape(ear, 'C', sh='K')
fill(ell(27, 35, 6, 1), 'R'); fill(edge(ell(27, 35, 6, 1)), 'K')            # くびわ
pawA = ell(9, 37, 6, 2.4); pawB = ell(19, 38, 6, 2.4)                  # 前足（あごの下）
for pw, px, py in ((pawA, 5, 38), (pawB, 15, 39)):
    shape(pw, 'W'); fill({(px, py), (px + 2, py)}, 'K')
# Zzz
z(4, 13, 4); z(9, 6, 5); z(14, 0, 6)

finish('inudaidokoronemuru')
