# こうえんで ねこが あそぶ（nekokouen）L 段の見本。python3 nekokouen.py で nekokouen.txt を書き出す
import math
W, H = 64, 48
grid = [['.'] * W for _ in range(H)]

def layer():
    return [[None] * W for _ in range(H)]

def put(L, x, y, c):
    if 0 <= x < W and 0 <= y < H:
        L[y][x] = c

def ell(L, cx, cy, rx, ry, col, ang=0.0, shade=None, light=None, th=0.45):
    # col: 色。shade/light: (色, しきい) かげ（右下）と明るい所（左上）
    a = math.radians(ang)
    for y in range(H):
        for x in range(W):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            u = (dx * math.cos(a) + dy * math.sin(a)) / rx
            v = (-dx * math.sin(a) + dy * math.cos(a)) / ry
            if u * u + v * v <= 1:
                c = col
                d = 0.45 * u + 0.9 * v  # 光は左上から
                if shade and d > shade[1]:
                    c = shade[0]
                if light and d < light[1] and u * u + v * v < 0.8:
                    c = light[0]
                L[y][x] = c

def poly(L, pts, col):
    ys = [p[1] for p in pts]
    for y in range(max(0, int(min(ys))), min(H, int(max(ys)) + 1)):
        for x in range(W):
            px, py = x + 0.5, y + 0.5
            ins = False
            for i in range(len(pts)):
                (x1, y1), (x2, y2) = pts[i], pts[i - 1]
                if (y1 > py) != (y2 > py):
                    if px < x1 + (py - y1) * (x2 - x1) / (y2 - y1):
                        ins = not ins
            if ins:
                L[y][x] = col

def line(L, x1, y1, x2, y2, col, w=0.0):
    n = int(max(abs(x2 - x1), abs(y2 - y1)) * 2) + 1
    for i in range(n + 1):
        t = i / n
        x, y = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
        r = int(math.ceil(w))
        for oy in range(-r, r + 1):
            for ox in range(-r, r + 1):
                if ox * ox + oy * oy <= w * w + 0.01:
                    put(L, int(round(x + ox)), int(round(y + oy)), col)

def outline(L, col='K', diag=False):
    out = [row[:] for row in L]
    for y in range(H):
        for x in range(W):
            if L[y][x] is None:
                nb = [(1, 0), (-1, 0), (0, 1), (0, -1)]
                if diag:
                    nb += [(1, 1), (1, -1), (-1, 1), (-1, -1)]
                for dx, dy in nb:
                    X, Y = x + dx, y + dy
                    if 0 <= X < W and 0 <= Y < H and L[Y][X] is not None:
                        out[y][x] = col
                        break
    return out

def stamp(L):
    for y in range(H):
        for x in range(W):
            if L[y][x] is not None:
                grid[y][x] = L[y][x]

# ---- しばふ（こうえんの一角を、ななめ上から見た島のように切り取る。上の面＝草、前の面＝土）
ICX, ICY, IRX, IRY = 33, 40, 30.5, 5.0
def front_y(x):
    q = 1 - ((x + 0.5 - ICX) / IRX) ** 2
    return ICY + IRY * math.sqrt(q) if q > 0 else None
lawn = layer()
ell(lawn, ICX, ICY, IRX, IRY, 'G')
for y in range(H):
    for x in range(W):
        if lawn[y][x] == 'G' and (x * 7 + y * 3) % 11 == 0:
            lawn[y][x] = 'Y'
for x in range(W):                 # 前の面（土）
    fy = front_y(x)
    if fy is None: continue
    for y in range(int(fy), int(fy) + 1):
        if 0 <= y < H and lawn[y][x] is None:
            lawn[y][x] = 'C'
for x in range(1, W, 2):           # 草の先（奥のふち）のぎざぎざ
    q = 1 - ((x + 0.5 - ICX) / IRX) ** 2
    if q > 0.05:
        put(lawn, x, int(ICY - IRY * math.sqrt(q)) - 1, 'G')
stamp(outline(lawn))

def shadow(cx, cy, rx, ry, solid=0.55):
    for y in range(H):
        for x in range(W):
            q = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2
            if q <= 1 and grid[y][x] in 'GY' and ((x + y) % 2 == 0 or q < solid):
                grid[y][x] = 'K'

# ---- 木（左奥）
trunk = layer()
poly(trunk, [(7, 12), (10, 12), (10.5, 36), (12.5, 39.5), (4.5, 39.5), (6.5, 36)], 'C')
for y in range(12, 38):
    put(trunk, 7, y, 'O')
stamp(outline(trunk))
shadow(13, 40, 8, 1.4, 0.3)
leaves = layer()
for (cx, cy, r) in [(9, 6, 6.2), (4, 10.5, 3.8), (14, 9.5, 4.2), (9, 12, 3.8)]:
    ell(leaves, cx, cy, r, r * 0.95, 'G', shade=('K', 0.55), light=('Y', -0.55))
for y in range(H):
    for x in range(W):
        if leaves[y][x] == 'K' and (x + y) % 2 == 0: leaves[y][x] = 'G'
        if leaves[y][x] == 'Y' and (x * 3 + y) % 4 == 0: leaves[y][x] = 'G'
stamp(outline(leaves))

# ---- ベンチ（右奥、斜めから。板のすきまは右はしへ抜ける）
bench = layer()
for (x1, y1, x2, y2) in [(54, 33, 54, 38), (62, 31, 62, 37)]:
    line(bench, x1, y1, x2, y2, 'K')                 # 脚
line(bench, 54, 23, 54, 31, 'C')                     # 左の柱
poly(bench, [(54, 22), (64, 19.6), (64, 23), (54, 25.4)], 'C')   # 背もたれ（1 まいの板）
for y in range(H):
    for x in range(W):
        if bench[y][x] == 'C' and x > 54 and (x + y) % 6 == 0: bench[y][x] = 'O'   # 木目
poly(bench, [(52, 31), (62, 28.6), (64, 29.2), (54.5, 31.8)], 'O')   # 座面の上（明るい）
poly(bench, [(52, 31), (54.5, 31.8), (64, 29.2), (64, 30.6), (54.5, 33.2), (52, 32.4)], 'C')
stamp(outline(bench))
shadow(58, 38, 6, 1.1, 0.2)

# ---- ボール（右手前）
shadow(52, 44.3, 5.5, 1.2)
ball = layer()
ell(ball, 51.5, 39.5, 4.6, 4.6, 'R', shade=('C', 0.6), light=('W', -0.75))
for y in range(H):
    for x in range(W):
        if ball[y][x] in ('R', 'C'):
            dx = x + 0.5 - 51.5
            if abs((y + 0.5) - (40.1 + 0.07 * dx * dx)) < 0.8:
                ball[y][x] = 'W' if ball[y][x] == 'R' else 'Y'
stamp(outline(ball))

# ---- ねこ（ボールに飛びつく。少し斜めから）
shadow(30, 44.2, 12, 1.4)
cat = layer()
for (a, b) in [((22, 33), (17, 28)), ((17, 28), (16, 22)), ((16, 22), (18, 18)), ((18, 18), (21, 17))]:
    line(cat, a[0], a[1], b[0], b[1], 'O', 1.0)
for (a, b) in [((16, 26), (17, 25)), ((16, 21), (17, 20))]:
    line(cat, a[0], a[1], b[0], b[1], 'C', 0.3)
line(cat, 27, 38, 30, 43, 'C', 1.3)                  # 奥の後ろ足（かげ色）
ell(cat, 31, 32.5, 9.5, 5.0, 'O', ang=-24, shade=('C', 0.6), light=('Y', -0.7))
ell(cat, 33, 35, 5.5, 1.7, 'W', ang=-24)           # おなか
ell(cat, 25, 37, 4.2, 4.0, 'O', shade=('C', 0.5), light=('Y', -0.6))   # 手前のもも
line(cat, 24, 40, 23, 43, 'O', 1.3)
ell(cat, 23, 43.6, 2.6, 1.2, 'W')
ell(cat, 30.3, 43.4, 2.2, 1.1, 'W')
line(cat, 37, 28.5, 44, 32, 'C', 1.1)                # 奥の前足（ボールの上へ）
ell(cat, 46.3, 33.5, 2.0, 1.4, 'W', ang=20)
line(cat, 36, 32, 43, 36, 'O', 1.2)                  # 手前の前足（ボールの横をつつく）
ell(cat, 45.5, 36.8, 2.0, 1.5, 'W', ang=10)
for k in range(4):                                   # せなかのしま
    x0 = 25 + k * 3.5
    line(cat, x0, 29.5 - k * 1.8, x0 + 1, 31.5 - k * 1.8, 'C')
ell(cat, 40.5, 22.8, 5.8, 5.0, 'O', shade=('C', 0.7), light=('Y', -0.6))   # あたま
poly(cat, [(34.6, 20.5), (35.5, 13), (40, 17.8)], 'O')
poly(cat, [(42, 17.2), (47.4, 13), (46.8, 20.4)], 'O')
poly(cat, [(36.4, 18), (36.6, 15.2), (38.6, 17.8)], 'R')
poly(cat, [(43.6, 17.4), (46.3, 15), (45.9, 18.4)], 'R')
for x0 in (39, 41):
    line(cat, x0, 17.8, x0, 19, 'C')
ell(cat, 43.4, 25.3, 3.4, 2.2, 'W')                  # 口のまわり
ell(cat, 38, 25.8, 1.7, 1.3, 'W')
for (ex, ey) in [(38, 21), (43, 21)]:                # 目（ボールを見る）
    for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)]:
        put(cat, ex + dx, ey + dy, 'K')
    put(cat, ex + 1, ey + 1, 'W')
put(cat, 42, 24, 'R'); put(cat, 43, 24, 'R'); put(cat, 42, 25, 'K')
put(cat, 41, 26, 'K'); put(cat, 43, 26, 'K')
stamp(outline(cat))
for (a, b) in [((47, 24), (49, 23)), ((47, 26), (49, 27))]:   # ひげ
    ll = layer(); line(ll, a[0], a[1], b[0], b[1], 'K'); stamp(ll)
for (a, b) in [((55, 31), (57, 29)), ((57, 34), (59, 33)), ((13, 28), (13, 32))]:   # 動きの線
    ll = layer(); line(ll, a[0], a[1], b[0], b[1], 'K'); stamp(ll)

# ---- 閉じた空きを、まわりの色でうめる
def fill_holes():
    out = [[False] * W for _ in range(H)]
    st = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
    st = [(x, y) for x, y in st if grid[y][x] == '.']
    for x, y in st:
        out[y][x] = True
    while st:
        x, y = st.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            X, Y = x + dx, y + dy
            if 0 <= X < W and 0 <= Y < H and not out[Y][X] and grid[Y][X] == '.':
                out[Y][X] = True; st.append((X, Y))
    n = 0
    for y in range(H):
        for x in range(W):
            if grid[y][x] == '.' and not out[y][x]:
                grid[y][x] = 'G' if y >= 30 else 'K'; n += 1
    return n
holes = fill_holes()

lines = [''.join(r) for r in grid]
# はしの空き行・列を切る
while lines and set(lines[0]) == {'.'}: lines.pop(0)
while lines and set(lines[-1]) == {'.'}: lines.pop()
open('nekokouen.txt', 'w').write('\n'.join(lines) + '\n')
print('holes filled', holes)
