# だいどころで ぱんだが おやつを たべる（pandadaidokorooyatsu・段 XXL・64x48）
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

# だいどころで ぱんだが おやつを たべる：テーブルの プリンを スプーンで たべる ぱんだ（絵の半分）。場所の物は まど と テーブル の 2 つ。
# ぱんだ＝しろい体・くろい耳・目のまわり・うで・あし（しろい所は K の ふちで区切る。頬は ピンク）
# 床（板の間。奥へ すぼまる 目地）y 39..47
FY = 39
fill(rect(0, FY, W - 1, H - 1), 'Y')
for y in (42, 45):
    fill({(x, y) for x in range(W)}, 'O')
for vx in (-60, -28, 4, 36, 68, 100, 132):
    fill(line(32 + (vx - 32) // 3, FY, vx, 47), 'O')
fill({(x, FY) for x in range(W)}, 'K')
# まど（右上。外は 空 と 木）
win = rect(40, 0, 63, 9)
fill(win, 'S')
fill(ell(45, 4, 3.5, 1.6) | ell(48, 3, 3, 2), 'W')
fill(ell(59, 3.5, 2.5, 2.5), 'Y')
fill(ell(55, 9.5, 9, 3) & win, 'G'); fill(ell(44, 9, 5, 2.2) & win, 'G')
fill(rect(51, 0, 52, 9) | rect(40, 5, 63, 5), 'B')
fill(edge(win), 'K')
sill = rect(39, 10, 63, 11); fill(sill, 'W'); fill({(x, 11) for x in range(39, 64)} | {(39, 10)}, 'K')
# テーブル（右・ななめ。木の 天板）
ttop = poly([(33, 29), (60, 29), (64, 34), (34, 34)])
fill(ttop, lambda x, y: 'O' if y < 31 else 'Y'); fill({(x, y) for x, y in ttop if (x - y * 0.6) % 7 < 1}, 'C')
front = rect(34, 35, 63, 37); fill(front, 'C'); fill({(x, 36) for x in range(36, 63, 5)}, 'O')
fill(edge(ttop | front), 'K')
for lx in (36, 59):
    fill(rect(lx, 38, lx + 1, 46), 'C'); fill(rect(lx + 1, 38, lx + 1, 46), 'K')
fill(ell(51, 46, 12, 1.2), 'O')
# おさら と プリン（大きく。カラメル・クリーム・さくらんぼ）
plate = ell(52, 32, 9.5, 2.2); fill(plate, 'W'); fill({(x, y) for x, y in plate if y >= 33}, 'S'); fill(edge(plate), 'K')
pud = poly([(46, 21), (58, 21), (60, 31), (44, 31)])
fill(pud, 'Y'); fill({(x, y) for x, y in pud if (x + 2, y) not in pud} , 'O'); fill({(x, y) for x, y in pud if (x - 2, y) not in pud}, 'W')
cara = poly([(46, 21), (58, 21), (58.5, 24), (55, 25), (52, 23.5), (49, 25), (45.5, 24)]) & pud
fill(cara, 'C'); fill({(47, 21), (48, 21), (49, 21)}, 'O')
fill(edge(pud), 'K')
cream = ell(52, 19.5, 4, 2.2); fill(cream, 'W'); fill({(x, y) for x, y in cream if (x, y + 1) not in cream}, 'S'); fill(edge(cream), 'K')
ch = ell(52, 15.5, 2.2, 2); fill(ch, 'R'); put(51, 15, 'W'); fill(edge(ch), 'K'); fill(line(53, 13, 55, 11), 'C')
fill(rect(44, 29, 46, 31) - pud, 'Y')
# ぱんだ（いすに すわって 右むき。テーブルへ スプーン）
fill(ell(20, 46, 16, 1.3), 'K')
WS = lambda m: {(x, y) for x, y in m if (x + 2, y) not in m or (x, y + 2) not in m}
body = ell(20, 34, 13, 10.5)
shape(body, 'W'); fill(WS(body) - edge(body), 'S')
legL = ell(12, 42, 6, 4, 15); legR = ell(28, 42, 6, 4, -15)
for lg, cx in ((legL, 12), (legR, 28)):
    fill(lg, 'K'); fill(ell(cx, 42.5, 2.6, 2), 'P'); fill({(cx - 2, 39), (cx, 38), (cx + 2, 39)} & lg, 'P')
armB = ell(8, 32, 3.5, 6.5, 30); fill(armB, 'K'); fill({(6, 28), (5, 29)}, 'S')                 # 奥のうで
earL = ell(9, 5, 4.6, 4.3); earR = ell(30, 4, 4.6, 4.3)
fill(earL | earR, 'K'); fill({(8, 3), (9, 2), (29, 2), (30, 3)}, 'S')
head = ell(20, 15, 12.5, 10)
shape(head, 'W'); fill(WS(head) - edge(head), 'S')
for ex, ey, a in ((14, 14, 30), (27, 13, -30)):                                                # 目のまわり（なみだ形）
    p = ell(ex, ey, 2.9, 4, a); fill(p, 'K')
    fill(ell(ex + (0.6 if ex > 20 else -0.4), ey - 0.6, 1.1, 1.3), 'W'); put(ex + (1 if ex > 20 else 0), ey, 'K')
mz = ell(22, 19.5, 4.6, 3.2); fill(mz, 'W'); fill({(x, y) for x, y in mz if (x, y + 1) not in mz}, 'S')
fill(rect(21, 17, 23, 17) | {(22, 18)}, 'K')                                                   # 鼻
mouth = ell(23, 21, 2, 1.4); fill(mouth, 'R'); fill(edge(mouth), 'K'); put(23, 21, 'P')         # あけた口
fill(rect(9, 18, 11, 19) | rect(30, 18, 32, 19), 'P')                                          # ほっぺ
# 手前のうで と スプーン（プリンを ひと口）
arm = poly([(26, 31), (31, 27), (36, 24), (40, 27), (34, 32), (29, 35)])
fill(arm, 'K'); fill({(x, y) for x, y in arm if (x, y - 1) not in arm and (x - 1, y) in arm}, 'S')
fill(line(39, 25, 30, 22), 'S'); fill(line(39, 26, 31, 23), 'K')                               # スプーンの 柄
bowl = ell(28.5, 21.5, 2.4, 1.6); fill(bowl, 'S'); fill(ell(28.5, 21, 1.6, 0.9), 'Y'); fill(edge(bowl), 'K')
paw = ell(38.5, 26, 2.8, 2.5); fill(paw, 'K'); fill({(38, 25), (39, 25)}, 'S')
HOLE = 'Y'

finish('pandadaidokorooyatsu', globals().get('HOLE', 'W'))
