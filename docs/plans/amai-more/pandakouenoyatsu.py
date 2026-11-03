# こうえんで ぱんだが おやつを たべる（pandakouenoyatsu・段 XXL・64x48）
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
def tri_h(m, c):   # 左上の光（明るい色を左上のふちの内側に）
    fill({(x, y) for x, y in m if ((x - 1, y) not in m or (x, y - 1) not in m)} , c)
def wobble_ell(cx, cy, rx, ry, seed=0):   # もこもこの葉（楕円を いくつか重ねる）
    s = set()
    for i in range(7):
        a = i * 0.9 + seed
        s |= ell(cx + math.cos(a) * rx * 0.55, cy + math.sin(a) * ry * 0.5, rx * 0.55, ry * 0.55)
    return s | ell(cx, cy, rx * 0.8, ry * 0.8)

# こうえんで ぱんだが おやつを たべる：ベンチに すわって 三色だんごを たべる ぱんだ（絵の半分）。場所の物は 木 と ベンチ の 2 つ。
# ぱんだ＝しろい体・くろい耳・目のまわり・うで・あし（しろい所は K の ふちで区切る。頬は ピンク）
# 地面（しばふ と 小さな花）y 38..47
FY = 38
for y in range(FY, H):
    for x in range(W):
        u = (x - 32) * 10 / (y - FY + 10)
        put(x, y, 'Y' if (math.floor(u / 5) + (y - FY) // 4) % 2 == 0 and (x + y) % 3 == 0 else 'G')
fill({(x, FY) for x in range(W)}, 'K')
for fx, fy in ((4, 44), (20, 46), (58, 45), (49, 41)):
    fill({(fx - 1, fy), (fx + 1, fy), (fx, fy - 1), (fx, fy + 1)}, 'R'); put(fx, fy, 'Y')
# 木（左。まるい葉）
trunk = poly([(4, 16), (9, 16), (9, 37), (12, 41), (1, 41), (4, 37)])
shape(trunk, 'C'); fill({(x, y) for x, y in trunk if (x - 1, y) not in trunk} - edge(trunk), 'O')
fill(line(6, 22, 6, 25) | line(7, 30, 7, 33), 'K')
crown = ell(7, 8, 8, 7) | ell(1, 14, 4.5, 4) | ell(13, 14, 4.5, 3.8)
fill(crown, 'G')
fill({(x, y) for x, y in crown if (x - 2, y - 2) not in crown and (x - 1, y - 1) in crown}, 'Y')
fill({(x, y) for x, y in crown if (x * 5 + y * 3) % 11 == 0}, 'Y')
fill(edge(crown), 'K')
fill(ell(7, 41, 6, 1.2), 'K')
# ベンチ（右おく・ななめ。板は 3 まい）
for lx, ly in ((22, 44), (59, 41)):                                                             # 前の脚
    fill(rect(lx, 33, lx + 1, ly), 'C'); fill(rect(lx + 1, 33, lx + 1, ly), 'K')
for lx, ly in ((27, 40), (62, 37)):                                                             # 背もたれの 柱
    fill(rect(lx, 18, lx + 1, ly), 'C'); fill(rect(lx + 1, 18, lx + 1, ly), 'K')
back = poly([(25, 19), (64, 15), (64, 26), (25, 28)])
fill(back, lambda x, y: 'K' if (y - 19 + (x - 25) * 0.1) % 4.5 < 0.9 else ('O' if (y - 19 + (x - 25) * 0.1) % 4.5 < 2 else 'C'))
fill(edge(back), 'K')
seat = poly([(19, 31), (25, 28), (64, 26), (64, 31), (60, 33)]) | poly([(19, 31), (60, 33), (60, 35), (19, 33)])
fill(seat, lambda x, y: 'O' if y <= 30 - (x - 19) * 0.08 else 'C'); fill(edge(seat), 'K')
fill(ell(42, 45, 22, 1.4), 'K')
# ぱんだ（ベンチに すわって 少し右むき）
WS = lambda m: {(x, y) for x, y in m if (x + 2, y) not in m or (x, y + 2) not in m}
body = ell(39, 31, 12, 10)
shape(body, 'W'); fill(WS(body) - edge(body), 'S')
legL = ell(31, 40, 5.5, 4.5, 20); legR = ell(47, 40, 5.5, 4.5, -20)
for lg, cx in ((legL, 31), (legR, 47)):
    fill(lg, 'K'); fp = ell(cx, 41, 2.6, 2); fill(fp, 'P'); fill({(cx - 2, 38), (cx, 37), (cx + 2, 38)} & lg, 'P')
armB = ell(28, 31, 3.5, 6, 25); fill(armB, 'K')                                                  # 奥のうで（ひざの上）
earL = ell(29, 5, 4.5, 4.2); earR = ell(49, 5, 4.5, 4.2)
fill(earL | earR, 'K'); fill({(28, 4), (29, 3), (48, 3), (49, 4)}, 'S')                         # 耳の つや
head = ell(39, 14, 12, 9.5)
shape(head, 'W'); fill(WS(head) - edge(head), 'S')
for ex, ey, a in ((33, 13, 30), (45, 13, -30)):                                                # 目のまわり（なみだ形）
    p = ell(ex, ey, 2.8, 3.8, a); fill(p, 'K'); fill(ell(ex + (0.5 if ex > 39 else -0.5), ey - 0.5, 1, 1.2), 'W')
    put(ex + (1 if ex > 39 else 0), ey - 1 + 1, 'K')
mz = ell(40, 18.5, 4.5, 3); fill(mz, 'W'); fill(edge(mz) - ell(40, 17.5, 4.5, 3), 'S')
fill(rect(39, 16, 41, 16) | {(40, 17)}, 'K')                                                    # 鼻
mouth = ell(40, 20, 2, 1.4); fill(mouth, 'R'); fill(edge(mouth), 'K'); put(40, 20, 'P')        # あけた口
fill(rect(29, 17, 31, 18) | rect(48, 17, 50, 18), 'P')                                          # ほっぺ
# 手前のうで と 三色だんご（顔の よこに もちあげて）
arm = poly([(46, 31), (50, 27), (54, 24), (58, 27), (53, 32), (49, 35)])
fill(arm, 'K'); fill({(x, y) for x, y in arm if (x, y - 1) not in arm and (x - 1, y) in arm}, 'S')
fill(line(56, 28, 56, 1), 'C'); fill(line(57, 4, 57, 26), 'O')
for (cx, cy), c in (((56.5, 6), 'P'), ((56.5, 12.5), 'W'), ((56.5, 19), 'G')):
    d = ell(cx, cy, 3.4, 3.2); fill(d, c); fill({(int(cx) - 1, int(cy) - 1), (int(cx) - 2, int(cy))}, 'W' if c != 'W' else 'S')
    fill({(int(cx) + 1, int(cy) + 2), (int(cx) + 2, int(cy) + 1)}, {'P': 'R', 'W': 'S', 'G': 'C'}[c]); fill(edge(d), 'K')
paw = ell(55.5, 25.5, 3, 2.6); fill(paw, 'K'); fill({(55, 24), (56, 24)}, 'S')
fill(line(47, 8, 49, 6) | line(48, 10, 51, 9), 'K')                                             # うれしい 線

finish('pandakouenoyatsu')
