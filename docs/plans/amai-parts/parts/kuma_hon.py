# 動物 × ふるまい：くまが ほんを よむ（すわって、ひざの上の ひらいた本を 両手で持ち、下を見る。
# 足のうら O が 見える）。draw(cx, by, flip) … cx＝体のまん中、by＝足の下。返り値：(頭, 胴体)。
from lib import *
import kuma, hon

SHADOW = (3, 15, 1.6)


def head_read(hx, hy, look=1, rx=10, ry=8.2):
    """kuma.head と同じ頭。下を見る目を 2 マス上に描く（口もとの ふちと まざって めがねに見えないように）。"""
    h = ell(hx, hy, rx, ry)
    kuma.blob(h)
    fill(edge(h), 'K')
    mz = ell(hx + 1.5 * look, hy + 3.5, 4.6, 3.2)
    fill(mz, 'W'); fill(cells(mz, lambda x, y: (x, y + 1) not in mz), 'S'); fill(edge(mz), 'K')
    ex1, ex2, ey = kuma.eyes_at(hx, hy, look)
    kuma.eye(ex1 - 1, ey - 2, 'down'); kuma.eye(ex2 + 1, ey - 2, 'down')
    nx, ny = hx + 2 * look, hy + 2
    fill(rect(nx, ny, nx + 1, ny + 1), 'K')
    fill({(nx - 2, ny + 2), (nx - 1, ny + 3), (nx, ny + 2), (nx + 1, ny + 2), (nx + 2, ny + 3), (nx + 3, ny + 2)}, 'K')
    fill({(ex1 - 3, hy + 2), (ex1 - 2, hy + 2), (ex2 + 3, hy + 2), (ex2 + 4, hy + 2)}, 'P')
    return h


def draw(cx, by, flip=False):
    begin()
    hx, hy = cx + 1, by - 29
    kuma.tail(cx - 10, by - 4)
    body = kuma.body(cx, by - 13, 10.5, 11.5)
    # おなかの 本より上の所は 体の色に（本の上に おなかが のぞいて パンに見えないように）
    fill({(x, y) for (x, y) in body if by - 21 <= y < by - 16 and at(x, y) in ('O', 'Y')}, 'C')
    kuma.ears(hx, hy)
    head = head_read(hx, hy)
    # 足（前へ だして すわる。足のうら O）
    kuma.foot(cx - 7, by - 2.6, 5, 2.9); kuma.foot(cx + 11, by - 2.4, 5.2, 3)
    # 奥の手（本の左のはしへ）
    kuma.limb(cx - 7, by - 18, cx - 5, by - 12)
    hon.draw(cx + 4, by - 12, w=8, h=5, cover='R', tilt=1)
    # 手前の手（本の右のはしを持つ）
    kuma.limb(cx + 7, by - 19, cx + 14, by - 12, 4.8)
    end(flip, cx)
    return head, body
