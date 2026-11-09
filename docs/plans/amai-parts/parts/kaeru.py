# 動物：かえる（G。かげ D・せなかの はん D・おなか W〔かげ Y〕・頭の上の大きな目〔白目 W・黒目 K〕・大きな口）。右むきで描く。
# 有名なキャラクターに似せないように：目は まぶた（G）が上に かぶさった半分の目・せなかと頭に こい はん・ほっぺは なし。
from lib import *

EYE = ((-5.5, -6), (5, -6.5))   # 目のこぶの まん中（頭のまん中からの ずれ）


def blob(m, dark=False, spots=False):
    """みどりの体：ぬって、左下に こいみどりの かげ、ふちどり K。spots で こい はん。"""
    shape(m, 'G', sh='D', sw=2 if dark else 1)
    if spots:
        inner = m - edge(m)
        fill(cells(inner, lambda x, y: hsh(x, y, 31) < 70 and (x - 1, y) in inner and (x, y - 1) in inner), 'D')
    return m


def head(hx, hy, rx=10.5, ry=6.2):
    """平たい大きな頭 と 頭の上の 目のこぶ 2 つ（ひと続き）。返り値は頭のマス。"""
    m = ell(hx, hy, rx, ry) | ell(EYE[0][0] + hx, EYE[0][1] + hy, 3.7, 3.6) | ell(EYE[1][0] + hx, EYE[1][1] + hy, 3.7, 3.6)
    blob(m)
    # 頭の上の はん
    fill({(hx - 7, hy), (hx - 8, hy + 1), (hx - 7, hy + 1)}, 'D')
    return m


def face(hx, hy, eyes='open', mouth='smile'):
    """目（こぶの中。白目 W・黒目 K・まぶた G）と大きな口。eyes：open・happy（にっこり）・closed（ねむる）・down（下を見る）。
    mouth：smile（大きな にっこり）・open（うたう。中は R、した P）・grin（にっこり あけた口）・small（ねむる）。"""
    for ex, ey in ((hx + EYE[0][0], hy + EYE[0][1]), (hx + EYE[1][0], hy + EYE[1][1])):
        x0, y0 = int(ex - 2), int(ey - 1)
        if eyes in ('open', 'down'):
            eye = rect(x0, y0, x0 + 3, y0 + 2) | rect(x0 + 1, y0 + 3, x0 + 2, y0 + 3)
            fill(eye, 'W')
            py = y0 + 1 if eyes == 'open' else y0 + 2
            fill(rect(x0 + 2, py, x0 + 3, py + 1), 'K')
            if eyes == 'open': put(x0 + 3, py, 'W')
            fill({(x0, y0 - 1), (x0 + 1, y0 - 1), (x0 + 2, y0 - 1), (x0 + 3, y0 - 1)}, 'D')   # まぶた の線
        elif eyes == 'happy':
            fill({(x0, y0 + 2), (x0 + 1, y0 + 1), (x0 + 2, y0 + 1), (x0 + 3, y0 + 2)}, 'K')
        else:   # closed（まぶたを とじた 太い へ の字）
            fill({(x0 - 1, y0), (x0, y0 + 1), (x0 + 1, y0 + 2), (x0 + 2, y0 + 2), (x0 + 3, y0 + 1), (x0 + 4, y0)}, 'K')
    # 鼻の あな
    put(hx + 7, hy - 1, 'K'); put(hx + 9, hy - 1, 'K')
    if mouth == 'open':
        mo = poly([(hx - 2, hy + 1.5), (hx + 10.5, hy + .5), (hx + 8, hy + 5.5), (hx + 2, hy + 5.5)])
        fill(mo, 'R'); fill(edge(mo), 'K')
        inn = mo - edge(mo); fill(cells(inn, lambda x, y: (x, y + 1) not in inn and x < hx + 7), 'P')
    elif mouth == 'grin':   # にっこり あけた口（中 R・した P）
        mo = poly([(hx - 1, hy + 1.5), (hx + 9.5, hy + .5), (hx + 7, hy + 4.5), (hx + 2, hy + 4.5)])
        fill(mo, 'R'); fill(edge(mo), 'K')
        inn = mo - edge(mo); fill(cells(inn, lambda x, y: (x, y + 1) not in inn and hx + 1 < x < hx + 7), 'P')
    elif mouth == 'small':
        fill(arc(hx + 3.5, hy - .5, 5, 3, 30, 150, 2), 'K')
    else:
        fill(arc(hx + 2.5, hy - 2, 8, 4.5, 20, 160, 2), 'K')


def belly(cx, cy, rx, ry, m):
    """明るい おなか（W・かげ Y）。m の中だけ。"""
    b = ell(cx, cy, rx, ry) & (m - edge(m))
    fill(b, 'W'); fill(cells(b, lambda x, y: (x - 1, y) not in b or (x, y + 1) not in b), 'Y')
    return b


def limb(x0, y0, x1, y1, w=3.6, dark=False):
    """手や足の太い線（ふち K）。"""
    m = line(x0, y0, x1, y1, w)
    blob(m, dark=dark)
    return m


def hand(x, y, s=1, dark=False):
    """手（まるい手のひら と 指の先の まる 3 つ）。s＝-1 で指を左へ。"""
    m = ell(x, y, 2.2, 2.2) | ell(x + s * 2.2, y - 1.6, 1.2, 1.2) | ell(x + s * 2.6, y + .4, 1.2, 1.2) | ell(x + s * 1.8, y + 2.2, 1.2, 1.2)
    blob(m, dark=dark)
    return m


def thigh(cx, cy, rx=5, ry=4, ang=-20, dark=False):
    """すわった うしろ足の もも（体の横の だ円）。"""
    m = ell(cx, cy, rx, ry, ang)
    blob(m, dark=dark, spots=not dark)
    return m


def foot(cx, by, s=1, dark=False, l=5):
    """水かきの足（平たい だ円 と 指 3 本）。by は足の下。s＝1 で つま先を右へ。"""
    m = ell(cx, by - 1.3, l, 1.6) | ell(cx + s * l * .9, by - 1, 1.4, 1.4) | ell(cx + s * l * .45, by - .8, 1.3, 1.3)
    blob(m, dark=dark)
    return m


def song_notes(xys):
    """音符（向きで動かさない。end() のあとに呼ぶ）。下の色と ちがう色を えらぶ。"""
    pal = ('R', 'V', 'Y', 'B', 'W')
    for i, (x, y) in enumerate(xys):
        under = {at(x + 1, y + 6), at(x + 2, y + 3), at(x + 3, y)}
        c = next(c for c in pal[i:] + pal[:i] if c not in under)
        note(x, y, c)


# ---- 大きな顔（ねむる 絵の ため。2026-11-09 に足した。上の head・face は そのまま）----
EYE_BIG = ((-7, -8), (6.5, -8.5))   # 大きな頭の 目のこぶの まん中（頭のまん中からの ずれ）


def head_big(hx, hy, rx=13.5, ry=8.5, er=5.3):
    """大きな頭（head の 1.3 倍くらい）と 目のこぶ 2 つ。返り値は頭のマス。"""
    m = ell(hx, hy, rx, ry) | ell(EYE_BIG[0][0] + hx, EYE_BIG[0][1] + hy, er, er) | ell(EYE_BIG[1][0] + hx, EYE_BIG[1][1] + hy, er, er)
    blob(m)
    fill({(hx - 10, hy), (hx - 11, hy + 1), (hx - 10, hy + 1), (hx - 9, hy - 2)}, 'D')   # 頭の はん
    return m


def face_sleep(hx, hy):
    """ねむる顔（大きな頭に）：とじた目 ∪（K）・小さな にっこり口・鼻の あな。"""
    for ex, ey in ((hx + EYE_BIG[0][0], hy + EYE_BIG[0][1]), (hx + EYE_BIG[1][0], hy + EYE_BIG[1][1])):
        x, y = int(ex), int(ey)
        # とじた目 ∪（はばの 広い ゆるい 弧。こぶの ふちと くっつかないように 内がわに）
        fill({(x - 3, y - 1), (x - 2, y), (x - 1, y + 1), (x, y + 1), (x + 1, y + 1), (x + 2, y), (x + 3, y - 1),
              (x - 2, y + 1), (x + 2, y + 1), (x - 1, y + 2), (x, y + 2), (x + 1, y + 2)}, 'K')   # 下は 2 マスの 太さ
    put(hx + 9, hy - 1, 'K'); put(hx + 11, hy - 1, 'K')
    fill(arc(hx + 2, hy + 1, 6, 3, 25, 155, 2), 'K')
