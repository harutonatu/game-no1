# だいどころで くまが たべる（kumadaidokorooyatsu・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり）で描いて、文字の地図 kumadaidokorooyatsu.txt を書き出す。
import os
W, H = 64, 48
g = [['.'] * W for _ in range(H)]

def put(x, y, c):
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = c

def ell(cx, cy, rx, ry):
    return {(x, y) for y in range(H) for x in range(W)
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0}

def rect(x0, y0, x1, y1):
    return {(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)}

def poly(pts):
    s = set()
    n = len(pts)
    for y in range(H):
        for x in range(W):
            px, py = x + .5, y + .5
            ins = False
            for i in range(n):
                ax, ay = pts[i]; bx, by = pts[(i + 1) % n]
                if (ay > py) != (by > py) and px < ax + (py - ay) * (bx - ax) / (by - ay):
                    ins = not ins
            if ins:
                s.add((x, y))
    return s

def line(x0, y0, x1, y1):
    s = set(); n = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(n + 1):
        s.add((round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n)))
    return s

def fill(m, c):
    for x, y in m: put(x, y, c)

def edge(m):
    return {(x, y) for x, y in m if any((x + dx, y + dy) not in m
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}

def shape(m, c, o='K', sh=None, hi=None):
    """塗って、かげ（左下）・明るい所（右上）を付けて、ふちどり。"""
    fill(m, c)
    if sh:
        fill({(x, y) for x, y in m if (x - 2, y) not in m or (x, y + 2) not in m}, sh)
    if hi:
        fill({(x, y) for x, y in m if ((x + 2, y) not in m or (x, y - 2) not in m)
              and (x - 2, y) in m and (x, y + 2) in m}, hi)
    if o:
        fill(edge(m), o)

# ---- 床（板の間・奥へすぼまる目地）y 39..47 ----
floor = rect(0, 39, 63, 47)
fill(floor, 'Y')
for y in (41, 44):
    fill({(x, y) for x in range(W)}, 'O')
for vx in (-60, -28, 4, 36, 68, 100, 132):
    fill(line(32 + (vx - 32) // 3, 39, vx, 47), 'O')
fill({(x, 39) for x in range(W)}, 'K')

# ---- まど（右上・外は空とおか）----
win = rect(39, 0, 63, 21)
fill(win, 'S')
fill(ell(56, 4, 3, 3), 'Y')                                           # おひさま
fill(ell(44, 5, 3.5, 1.6) | ell(47, 4, 3, 2), 'W')                    # くも
fill(ell(50, 24, 16, 7) & win, 'G')                                         # おか
fill({(x, y) for x, y in ell(50, 24, 16, 7) & win if (x * 3 + y * 5) % 11 == 0}, 'Y')   # 花
fill(ell(60, 13, 3, 3.5) | ell(42, 15, 2.5, 3), 'G')                  # 木
fill(rect(60, 16, 60, 18) | rect(42, 17, 42, 18), 'C')
fill(edge(ell(60, 13, 3, 3.5)) | edge(ell(42, 15, 2.5, 3)), 'K')
fill(rect(51, 0, 52, 21) | rect(39, 10, 63, 10), 'B')                 # まどわく
fill(edge(win), 'K')
fill(rect(38, 22, 63, 23), 'W'); fill({(x, 23) for x in range(38, 64)}, 'K')   # まど台
fill(edge(rect(38, 22, 63, 23)) - {(x, 22) for x in range(39, 63)}, 'K')

# ---- テーブル（右・ななめ・テーブルかけ）----
fill(rect(61, 33, 62, 46), 'C'); fill(rect(62, 33, 62, 46), 'K')     # 奥の脚
ttop = poly([(34, 27), (60, 27), (64, 33), (37, 33)])
fill(ttop, 'W')
for x, y in ttop:
    u = (x - 34 - (y - 27) * 3 / 6) // 3
    v = (y - 27) // 2
    if (u + v) % 2 == 0:
        put(x, y, 'R')
skirt = rect(37, 34, 63, 37)
fill(skirt, 'R'); fill({(x, y) for x, y in skirt if (x // 3) % 2 == 0}, 'W')
fill({(x, 37) for x in range(37, 64) if x % 3 == 1}, 'P')
side = poly([(34, 27), (37, 33), (37, 38), (34, 32)])
fill(side, 'P')
fill(edge(ttop | skirt | side), 'K'); fill(line(37, 33, 63, 33), 'K')
for lx in (39, 58):
    fill(rect(lx, 38, lx + 1, 46), 'C'); fill(rect(lx + 1, 38, lx + 1, 46), 'K')
fill(ell(50, 46, 13, 1.2), 'O')                                       # 床のかげ

# ---- くま（少し右むき・絵の半分）----
fill(ell(20, 46, 15, 1.3), 'O')                                       # 床のかげ
body = ell(20, 35, 14, 11.5)
shape(body, 'C', sh='K')
fill({(x, y) for x, y in body if (x + 1, y) not in body or (x + 2, y) not in body} - edge(body), 'O')
belly = ell(23, 37, 7, 7.5)
fill(belly, 'O'); fill({(x, y) for x, y in belly if (x - 1, y - 1) not in belly}, 'Y')
footL = ell(10, 44, 4.5, 3); footR = ell(29, 44, 4.5, 3)
for f, cx in ((footL, 10), (footR, 29)):
    shape(f, 'C'); fill(ell(cx, 44, 2.3, 1.5), 'O'); fill(edge(ell(cx, 44, 2.3, 1.5)), 'C')
earL = ell(10, 6, 4.5, 4.5); earR = ell(32, 5, 4.5, 4.5)
shape(earL, 'C'); fill(ell(10, 6.5, 2.4, 2.4), 'P')
shape(earR, 'C'); fill(ell(32, 5.5, 2.4, 2.4), 'P')
head = ell(21, 15, 13, 11)
shape(head, 'C', sh='K')
fill({(x, y) for x, y in head if (x + 2, y) not in head and (x, y) not in edge(head) and 7 <= y <= 18} | {(x, y) for x, y in head if (x, y - 2) not in head and (x, y) not in edge(head) and 20 <= x <= 28}, 'O')   # 右上の光
mz = ell(25, 20.5, 5.6, 4.2)                                           # 口まわり（丸いマズル）
fill(mz, 'W'); fill({(x, y) for x, y in mz if (x, y + 1) not in mz or (x - 1, y + 1) not in mz}, 'O')
fill(edge(mz), 'K')
nose = rect(24, 18, 28, 19) | rect(25, 20, 27, 20)
fill(nose, 'K'); put(25, 18, 'W')
fill({(26, 21)}, 'K')                                       # 鼻の下
mouth = rect(25, 22, 27, 23)                                       # あけた口
fill(mouth, 'R'); fill({(24, 22), (28, 22), (24, 23), (28, 23), (25, 24), (26, 24), (27, 24)}, 'K'); fill({(26, 23)}, 'P')
for ex, ey, rx in ((15, 13, 1.6), (29, 12, 1.8)):                     # 目（奥は少し小さい）
    e = ell(ex, ey, rx, 2.2)
    fill(e, 'K'); put(ex, ey - 1, 'W')
fill(ell(15, 19, 2.2, 1.2), 'P')             # ほっぺ

# ---- ホットケーキ（テーブルの上・大きく）----
plate = ell(49, 31, 10, 2.4)
fill(plate, 'W'); fill({(x, y) for x, y in plate if y >= 32}, 'S'); fill(edge(plate), 'K')
pk = ell(49, 21.5, 8, 2.3) | rect(41, 22, 57, 29) | ell(49, 29, 8, 2)
fill(pk, 'O')
for y in (24, 26, 28):
    fill({(x, y) for x in range(W)} & pk, 'Y')
fill({(x, y) for x, y in pk if x >= 55 and y >= 22}, 'C')
topc = ell(49, 21.5, 8, 2.3)
fill(topc, 'Y'); fill({(x, y) for x, y in topc if x >= 53 and y >= 21}, 'O')
fill(edge(pk | topc), 'K')
fill({(42, 22), (42, 23), (42, 24), (43, 22), (56, 22), (56, 23), (56, 24), (56, 25), (55, 22), (48, 23), (48, 24)}, 'C')  # シロップ
butter = rect(47, 18, 51, 20)
fill(butter, 'Y'); fill(rect(47, 18, 51, 18), 'W'); fill(rect(51, 19, 51, 20), 'O'); fill(edge(butter) - {(x, 20) for x in range(48, 51)}, 'K')
fill(ell(54, 20, 1.6, 1.4), 'R'); fill(edge(ell(54, 20, 1.6, 1.4)), 'K'); fill({(54, 18), (55, 18), (53, 18)}, 'G')   # いちご
fill(ell(44, 20, 1.6, 1.4), 'R'); fill(edge(ell(44, 20, 1.6, 1.4)), 'K'); fill({(44, 18), (43, 18), (45, 18)}, 'G')
fill(rect(41, 25, 42, 29), 'Y'); fill({(41, 26), (41, 28)}, 'O')      # 切り口

# ---- うで・フォーク（ひと切れを口へ）----
arm = poly([(29, 34), (33, 29), (37, 25), (40, 27), (36, 32), (32, 37)])
shape(arm, 'C')
fill({(x, y) for x, y in arm if (x + 1, y - 1) not in arm} - edge(arm), 'O')
paw = ell(38, 25.5, 2.8, 2.5)
shape(paw, 'C'); fill({(38, 24), (39, 25)}, 'O')
fill(line(37, 24, 33, 22) | line(38, 24, 34, 22), 'S'); fill(line(38, 23, 34, 21), 'K')   # フォークの柄
bite = ell(32, 23, 2, 1.6)                                      # 口へ運ぶひと切れ
fill(bite, 'O'); fill({(x, y) for x, y in bite if (x, y - 1) not in bite}, 'Y'); fill(edge(bite), 'K')
armL = poly([(8, 30), (4, 36), (6, 39), (11, 34)])                    # 奥のうで
shape(armL, 'C')
# ---- 閉じた空きをなくす・数える ----
def closed():
    out = set(); st = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
    st = [p for p in st if g[p[1]][p[0]] == '.']
    out = set(st)
    while st:
        x, y = st.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if 0 <= q[0] < W and 0 <= q[1] < H and q not in out and g[q[1]][q[0]] == '.':
                out.add(q); st.append(q)
    return [(x, y) for y in range(H) for x in range(W) if g[y][x] == '.' and (x, y) not in out]

for x, y in closed():
    g[y][x] = 'W'   # 閉じた空きは壁の光で埋める

here = os.path.dirname(os.path.abspath(__file__))
open(os.path.join(here, 'kumadaidokorooyatsu.txt'), 'w').write('\n'.join(''.join(r) for r in g) + '\n')
print(sum(c != '.' for r in g for c in r))
