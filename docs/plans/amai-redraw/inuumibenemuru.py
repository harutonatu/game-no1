# うみべで いぬが ねむる（inuumibenemuru・段 XL・64x48）
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

# うみべで いぬが ねむる：うきわの 中で まるくなって ねむる いぬ（絵の半分）。場所の物は 海 と うきわ の 2 つ。
HZ = 16
def shore(x): return 22.5 - x * 0.04 + 0.9 * math.sin(x / 4.2 + 1)
for y in range(HZ, H):
    for x in range(W):
        if (x - 32) ** 2 / 34 ** 2 + (y - 18) ** 2 / 30.5 ** 2 > 1 and y > 34: continue   # 下のすみを丸く
        s = shore(x)
        if y < HZ + 2: c = 'B'
        elif y < s - 1: c = 'W' if ((y - HZ) % 3 == 2 and (x * 2 + y) % 10 < 3) else 'S'
        elif y < s + 0.6: c = 'W'
        elif y < s + 2: c = 'O' if (x // 2 + y) % 3 == 0 else 'Y'
        else: c = 'O' if (x * 11 + y * 5) % 31 == 0 else 'Y'
        put(x, y, c)
# うきわの かげ
fill(ell(33, 45, 26, 2.2), lambda x, y: 'O' if g[y][x] in 'YO' else None)
# うきわ（あかと しろ。ななめ上から見た わ。奥の半分→いぬ→手前の半分の順に描く）
RC = 38
ring = ell(32, RC, 25, 8.5) - ell(32, RC - 1, 15, 4.2)
def rs(x, y):
    a = math.atan2((y - RC) * 2.9, x - 32); k = int((a + math.pi) / (math.pi / 5)) % 2
    c = 'R' if k == 0 else 'W'
    if (x, y + 2) not in ring and y > RC: c = 'C' if c == 'R' else 'S'
    return c
fill(ring, rs); fill(edge(ring), 'K')
# いぬ（うきわの中で まるくなる。顔は こちら向き）
body = ell(37, 33, 17, 9.5)
shape(body, 'W'); fill({(x, y) for x, y in body if (x + 2, y) not in body or (x, y + 2) not in body} - edge(body), 'S')
fill(ell(44, 29, 6.5, 3.6), 'C'); fill(ell(43, 28, 4, 1.4), 'O'); fill(edge(body), 'K')    # せなかの もよう
tail = ell(54, 30, 2.6, 5.5, 35); shape(tail, 'W'); fill(ell(55.5, 27, 1.6, 2, 35) & tail, 'C'); fill(edge(tail), 'K')
head = ell(22, 26, 10, 8.5)
earL = ell(12.5, 28, 3.6, 7.5, 12); earR = ell(31.5, 28, 3.6, 7.5, -12)
shape(earL, 'C', sh='K'); shape(earR, 'C', sh='K')
shape(head, 'W'); fill({(x, y) for x, y in head if (x, y + 2) not in head} - edge(head), 'S'); fill(edge(head), 'K')
fill(ell(26, 23, 3.4, 3), 'C')                                                 # 目の もよう
for ex in (16, 24):                                                            # とじた目
    for dx, dy in ((0, 0), (1, 1), (2, 1), (3, 0)): put(ex + dx, 23 + dy, 'K')
fill(rect(21, 27, 23, 28) | {(22, 29)}, 'K'); put(21, 27, 'W')                # 鼻
fill({(22, 30), (21, 31), (20, 31), (23, 31), (24, 31)}, 'K')                    # 口
fill({(14, 28), (15, 28), (29, 28), (30, 28)}, 'R')                              # ほっぺ
# 手前の うきわ（いぬの 体の下を かくす）
front = {(x, y) for x, y in ring if y >= RC - 1}
fill(front, rs); fill(edge(ring) & front, 'K')
fill(line(12, 40, 16, 42) | line(48, 42, 52, 40), 'W')                         # つや
pawL = ell(17, 35, 4, 2.2); pawR = ell(27, 35, 4, 2.2)                         # 前足を うきわに のせる
for pw, px in ((pawL, 17), (pawR, 27)):
    shape(pw, 'W'); fill({(px - 1, 36), (px + 1, 36)}, 'K')
# Zzz と たいよう、かもめ
z(3, 10, 5); z(9, 3, 6); z(18, 0, 4)
fill(ell(55, 5, 4, 4), lambda x, y: 'Y' if x + y < 59 else 'O')
for x0, y0 in ((38, 6), (45, 11)):
    fill({(x0, y0 + 1), (x0 + 1, y0), (x0 + 2, y0 + 1), (x0 + 3, y0), (x0 + 4, y0 + 1)}, 'K')

finish('inuumibenemuru')
