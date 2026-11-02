# だいどころで くまが たべる（kumadaidokoro・段 XXL・64x48）
# 部品（楕円・多角形・線・ふちどり）で描いて、文字の地図 kumadaidokoro.txt を書き出す。
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

# ---- 床（板の間・遠近の線）y 31..47 ----
rug = ell(35, 41.5, 30, 6)                            # 床のしきもの（だ円＝ななめから見た丸）
fill(rug, 'Y')
fill({(x, y) for x, y in rug if ((x - 35) / 30) ** 2 + ((y - 41.5) / 6) ** 2 > .62}, 'O')
fill({(x, y) for x, y in rug if (x + 2 * y) % 7 == 0 and ((x - 35) / 30) ** 2 + ((y - 41.5) / 6) ** 2 <= .62}, 'O')
fill(edge(rug), 'K')
fill({(x, 31) for x in range(W)}, 'K')               # 壁と床のさかい（はばき）
fill({(x, 30) for x in range(W)}, 'C')
for x0 in (0, 21, 44):                               # 床板の目地（奥へすぼまる）
    pass
# ---- 窓（右上・外は空と木）----
win = rect(40, 1, 61, 19)
fill(win, 'S')
fill(ell(55, 15, 6, 4) | ell(49, 17, 5, 3), 'G')      # 外の木
fill(ell(46, 6, 3, 1.6) | ell(49, 5, 3, 2), 'W')      # くも
fill(edge(win), 'K')
fill(rect(50, 1, 51, 19), 'B'); fill(rect(40, 10, 61, 10), 'B')   # 窓わく（十字）
fill(rect(41, 1, 61, 1), 'B')
fill(edge(win), 'K')
fill(rect(38, 20, 63, 21), 'W'); fill({(x, 21) for x in range(38, 64)}, 'K')  # 窓台
fill(rect(38, 0, 39, 22) & poly([(38, 0), (40, 0), (40, 22), (38, 22)]), 'P')  # カーテン左
fill(poly([(62, 0), (64, 0), (64, 23), (62, 23)]), 'P')
fill(line(38, 0, 38, 22) | line(63, 0, 63, 23), 'R')
fill(ell(57, 18, 2, 2), 'R'); fill({(57, 16), (56, 17)}, 'G')       # 窓台のトマト

# ---- 左のこんろ台となべ ----
cab = poly([(0, 18), (16, 18), (19, 15), (19, 30), (16, 33), (0, 33)])   # 斜めの台
fill(cab, 'B')
top = poly([(0, 15), (19, 15), (16, 18), (0, 18)])
fill(top, 'W')
fill(edge(cab), 'K')
fill(line(16, 18, 16, 33), 'K'); fill(line(0, 18, 16, 18), 'K')
fill(rect(2, 21, 13, 21) | rect(2, 21, 2, 30) | rect(13, 21, 13, 30) | rect(2, 30, 13, 30), 'K')
fill(rect(3, 22, 12, 22), 'S')                                        # とびらの光
fill({(11, 25), (11, 26)}, 'Y')                                       # とって
fill(line(17, 20, 17, 30), 'S')                                       # 側面の明るい所
pot = ell(8, 12, 6, 2.5) | rect(2, 7, 14, 12)
fill(pot, 'R'); fill({(x, y) for x, y in pot if x <= 4}, 'C')
fill({(x, y) for x, y in pot if x >= 11 and 8 <= y <= 12}, 'O')
fill(edge(pot), 'K')
fill(rect(0, 9, 1, 9) | rect(15, 9, 16, 9), 'K')                     # なべの取っ手
lid = ell(8, 6, 7, 1.6)
fill(lid, 'W'); fill(edge(lid), 'K'); fill({(8, 4), (7, 3), (8, 3), (9, 3)}, 'K')
for sx, sy in ((4, 2), (12, 2)):                             # ゆげ
    fill({(sx, sy), (sx + 1, sy - 1), (sx, sy - 2)}, 'W')
fill(rect(0, 14, 18, 14), 'K')                                         # 台の奥のへり

# ---- 床のかげ（テーブルといすの下）----
fill(ell(48, 39.5, 14, 1.3) | ell(20, 41, 7, 1.2), 'C')

# ---- いす（くまのうしろ・みどり）----
back = poly([(6, 17), (11, 16), (12, 34), (7, 35)])
shape(back, 'G', sh=None)
fill(line(10, 18, 10, 32), 'Y')
seat = poly([(9, 33), (27, 33), (29, 36), (11, 37)])
fill(seat, 'G'); fill(edge(seat), 'K')
for lx0, ly0, lx1, ly1 in ((11, 37, 11, 46), (27, 36, 28, 45), (14, 37, 15, 42), (9, 35, 9, 44)):
    fill(line(lx0, ly0, lx1, ly1) | line(lx0 + 1, ly0, lx1 + 1, ly1), 'G')
    fill(line(lx0 + 1, ly0, lx1 + 1, ly1), 'K')

# ---- くま（ななめ右むき・すわっている）----
body = ell(20, 27, 9, 8.5)
shape(body, 'C', sh='K', hi='O')
belly = ell(23, 28, 4.5, 5.5)
fill(belly, 'O'); fill({(x, y) for x, y in belly if (x + 1, y) not in belly or (x, y - 1) not in belly}, 'Y')
leg = ell(25, 35, 5, 2.6)                                           # ひざ（手前の足）
shape(leg, 'C', hi='O')
foot = ell(29, 38, 2.2, 3)
shape(foot, 'C'); fill({(29, 38), (29, 39)}, 'O')
# 頭
earL = ell(13, 6, 3, 3); earR = ell(23, 4, 3, 3)
shape(earL, 'C'); fill(ell(13, 6, 1.4, 1.4), 'P')
shape(earR, 'C'); fill(ell(23, 4, 1.4, 1.4), 'P')
head = ell(19, 13, 9, 8)
shape(head, 'C', sh='K')
fill({(x, y) for x, y in head if (x + 1, y) not in head and (x, y) not in edge(head)} | {(x, y) for x, y in head if (x + 2, y) not in head and (x, y) not in edge(head) and y > 8}, 'O')
fill(ell(14, 13, 2.2, 1.6), 'K'); fill(ell(14, 13, 1.4, 1), 'C')     # 左の目（奥・かげ）
mz = ell(23.5, 16, 4, 2.8)                                             # 口もと（右へ出す）
shape(mz, 'Y', sh='O')
fill({(26, 14), (27, 14), (26, 15), (27, 15), (25, 14)}, 'K'); put(26, 14, 'W')  # 鼻
fill({(22, 18), (23, 18), (24, 19), (25, 18), (26, 17)}, 'K')        # 口
fill({(25, 19), (24, 18)}, 'R')                                      # 口をあける
fill(ell(22, 11, 1.3, 1.6), 'K'); put(22, 10, 'W')                    # 右の目（手前）
fill({(16, 16), (17, 17)}, 'P')                                      # ほっぺ
fill({(20, 7), (21, 7), (22, 8)}, 'O')                               # 頭の光
# よだれかけ（えりもと）
bib = poly([(15, 20), (28, 19), (26, 24), (17, 24)])
fill(bib, 'W'); fill({(x, y) for x, y in bib if (x + y) % 4 == 0}, 'S'); fill(edge(bib), 'K')

# ---- テーブル（ななめ・テーブルかけ）----
ttop = poly([(30, 24), (58, 24), (64, 33), (34, 33)])
fill(ttop, 'W')
for x, y in ttop:                                                    # 赤白のチェック（斜め）
    u = (x - 30 - (y - 24) * 4 / 9) // 3
    v = (y - 24) // 2
    if (u + v) % 2 == 0:
        put(x, y, 'R')
skirt = poly([(34, 33), (63, 33), (63, 37), (34, 37)])                # 手前に垂れる布
fill(skirt, 'R'); fill({(x, y) for x, y in skirt if (x // 3) % 2 == 0}, 'W')
fill({(x, 37) for x in range(34, 64) if x % 3 == 1}, 'P')
side = poly([(30, 24), (34, 33), (34, 37), (30, 28)])                 # 左の側面（かげ）
fill(side, 'P')
fill(edge(ttop | skirt | side), 'K')
fill(line(34, 33, 63, 33), 'K')
for lx in (36, 60):
    fill(rect(lx, 38, lx + 1, 46), 'C'); fill(rect(lx + 1, 38, lx + 1, 46), 'K')
fill(rect(32, 31, 33, 41), 'C'); put(33, 41, 'K'); fill(rect(33, 31, 33, 40), 'K')   # 奥の脚

# ---- テーブルの上：ホットケーキ・ミルク ----
plate = ell(46, 30, 8, 2.2)
fill(plate, 'W'); fill({(x, y) for x, y in plate if y == 31}, 'S'); fill(edge(plate), 'K')
pk = ell(45, 25.5, 6, 1.8) | rect(39, 26, 51, 29) | ell(45, 29, 6, 1.6)   # 3 まいの重なり
fill(pk, 'O')
fill({(x, 27) for x in range(39, 52)} & pk, 'Y'); fill({(x, 29) for x in range(39, 52)} & pk, 'Y')
fill({(x, y) for x, y in pk if x >= 49 and y >= 26}, 'C')                # 右のかげ
topc = ell(45, 25, 6, 1.6)
fill(topc, 'Y'); fill({(x, y) for x, y in topc if x >= 48}, 'O')
fill(edge(pk | topc), 'K')
fill(rect(44, 23, 46, 24), 'Y'); fill(rect(44, 23, 46, 23), 'W'); fill(edge(rect(43, 22, 47, 24)) - {(43, 22), (47, 22), (43, 23), (47, 23), (44,22),(45,22),(46,22)}, 'O')   # バター
fill({(41, 25), (40, 26), (40, 27), (49, 25), (50, 26), (50, 27), (50, 28)}, 'C')             # シロップ
fill(ell(48, 23, 1.2, 1.2), 'R'); put(48, 22, 'G'); put(49, 22, 'G')                          # いちご
fill(rect(39, 27, 40, 29), 'Y'); put(39, 28, 'O')                                            # 切り口
# コップのミルク
cup = rect(55, 23, 59, 29)
fill(cup, 'W'); fill(rect(58, 24, 58, 28), 'S'); fill(edge(cup), 'K'); fill(rect(56, 23, 58, 23), 'S')
# ---- くまの腕とフォーク（口へ運ぶ）----
arm = poly([(25, 24), (29, 21), (33, 18), (36, 20), (31, 25), (27, 28)])
shape(arm, 'C', hi='O')
paw = ell(34, 19, 2.6, 2.2)
shape(paw, 'C'); put(34, 18, 'O'); put(35, 19, 'O')
fill(line(33, 18, 29, 16), 'W'); fill(line(34, 20, 30, 17), 'K')     # フォークの柄
fill({(28, 15), (27, 16), (28, 17)}, 'S')
bite = ell(28, 17, 1.6, 1.2); fill(bite, 'O'); put(28, 16, 'Y')      # 口へ運ぶ一切れ
fill(edge(bite), 'C')
armL = poly([(28, 29), (37, 27), (38, 30), (29, 32)])                # 手前の腕（皿をおさえる）
shape(armL, 'C', hi='O')
fill(ell(38, 29, 2, 1.8), 'C'); fill(edge(ell(38, 29, 2, 1.8)), 'K')

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
open(os.path.join(here, 'kumadaidokoro.txt'), 'w').write('\n'.join(''.join(r) for r in g) + '\n')
print(sum(c != '.' for r in g for c in r))
