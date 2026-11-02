# うみべで ねこが ボールで あそぶ（nekoumibebooru・段 XL・64x48）
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

# うみべで ねこが ボールで あそぶ：うしろ足で 立って ビーチボールに とびつく ねこ（絵の半分）。場所の物は 海 と すなはま の 2 つ。
HZ = 15
def shore(x): return 26 + x * 0.06 + 1.0 * math.sin(x / 3.5)
for y in range(HZ, H):
    for x in range(W):
        if (x - 32) ** 2 / 34 ** 2 + (y - 20) ** 2 / 28.5 ** 2 > 1 and y > 36: continue   # 下のすみを丸く
        s = shore(x)
        if y < HZ + 2: c = 'B'
        elif y < s - 1: c = 'W' if ((y - HZ) % 4 == 1 and (x + y * 3) % 9 < 3) else ('B' if (y - HZ) % 4 == 3 and (x + y) % 11 < 2 else 'S')
        elif y < s + 0.6: c = 'W'
        elif y < s + 2: c = 'O' if (x // 2 + y) % 3 == 0 else 'Y'
        else: c = 'O' if (x * 13 + y * 7) % 29 == 0 else 'Y'
        put(x, y, c)
# ねこと ボールの かげ（砂の上）
fill(ell(27, 44, 11, 1.6), lambda x, y: 'O' if g[y][x] in 'YO' else None)
fill(ell(49, 43, 6, 1.2), lambda x, y: 'O' if g[y][x] in 'YO' else None)
# 足あと
for x, y in ((6, 35), (10, 38), (5, 41), (12, 44)): fill({(x, y), (x + 1, y)}, 'O')
# しっぽ（左へ大きく まがる）
tl = line(19, 38, 10, 33, 2) | line(10, 33, 8, 25, 2) | line(8, 25, 11, 19, 2)
shape(tl, 'O'); fill({(9, 30), (10, 30), (8, 26), (9, 26), (10, 22), (11, 22)}, 'C')
# ねこ（うしろ足で立ち、前足を右上の ボールへ のばす）
legL = ell(21, 41, 4.5, 4); legR = ell(32, 42, 4.5, 3.6)
body = ell(27, 31, 8, 11.5, 22)
armB = poly([(30, 21), (40, 10), (44, 13), (34, 25)])
armF = poly([(28, 25), (41, 17), (44, 21), (31, 30)])
head = ell(29, 14, 8.5, 7)
earL = poly([(21, 11), (22, 1), (28, 8)]); earR = poly([(31, 7), (38, 0), (37, 11)])
def tabby(m):
    def f(x, y):
        if (x + 2, y) not in m or (x, y + 2) not in m: return 'C' if (x + y) % 3 else 'O'
        return 'C' if (x - y * 0.6) % 6 < 1.2 else 'O'
    return f
shape(legL, 'O'); fill(ell(22, 43, 2.4, 1.5), 'W'); fill(edge(legL), 'K')
shape(armB, 'O'); fill({(x, y) for x, y in armB if (x + y) % 5 == 0} - edge(armB), 'C')
shape(body, 'O'); fill(tabby(body) and {(x, y) for x, y in body}, tabby(body)); fill(ell(31, 32, 3.5, 7, 22), 'W'); fill(edge(body), 'K')
shape(legR, 'O'); fill(ell(33, 43, 2.4, 1.5), 'W'); fill(edge(legR), 'K')
shape(armF, 'O'); fill({(x, y) for x, y in armF if (x + 2 * y) % 6 == 0} - edge(armF), 'C')
for p in (ell(42, 11, 2.6, 2.6), ell(43, 19, 2.6, 2.6)):
    shape(p, 'W')
shape(earL, 'O'); fill(poly([(23, 9), (23, 4), (26, 8)]), 'W')
shape(earR, 'O'); fill(poly([(33, 7), (36, 3), (36, 9)]), 'W')
shape(head, 'O'); fill({(x, y) for x, y in head if (x - y * 0.2) % 5 < 1 and y < 12} - edge(head), 'C'); fill(edge(head), 'K')
fill(ell(32, 18, 4.5, 2.6) & head, 'W'); fill(edge(head), 'K')                    # 口まわり
for ex, ey in ((26, 13), (33, 12)):                                            # 目（ボールを見る）
    fill(ell(ex, ey, 1.3, 1.8), 'K'); put(ex + 1, ey - 1, 'W')
fill({(32, 16), (33, 16), (32, 17)}, 'R')                                      # 鼻
fill({(31, 18), (32, 19), (33, 18)}, 'K')
fill(line(37, 17, 41, 16) | line(37, 19, 41, 20) | line(23, 17, 19, 16) | line(23, 19, 19, 20), 'K')   # ひげ
# ビーチボール（右上。4 色の しま）
cx, cy, r = 51, 12, 8.5
ball = ell(cx, cy, r, r)
def seg(x, y):
    a = math.atan2(y - cy, x - cx) + 0.4
    return 'RWBY'[int((a + math.pi) / (math.pi / 2)) % 4]
fill(ball, seg)
fill(ell(cx, cy, 2, 2), 'W')
fill({(x, y) for x, y in ball if (x + 2, y + 2) not in ball and g[y][x] != 'K'}, lambda x, y: {'R': 'C', 'W': 'S', 'B': 'B', 'Y': 'O'}[g[y][x]])
fill({(46, 7), (47, 6), (46, 8)}, 'W')
fill(edge(ball), 'K')
fill(line(58, 22, 60, 24) | line(61, 18, 63, 19) | line(55, 24, 56, 26), 'K')   # はねた線

finish('nekoumibebooru')
