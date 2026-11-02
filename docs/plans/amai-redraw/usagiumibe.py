# うみべで うさぎが ねむる（XL・64x48）。部品で描いて文字の地図 usagiumibe.txt を書き出す。
import math
W,H=64,48
g=[['.']*W for _ in range(H)]
def put(x,y,c):
    if 0<=x<W and 0<=y<H: g[y][x]=c
def mask_ell(cx,cy,rx,ry,ang=0):
    a=math.radians(ang);s=set()
    for y in range(H):
        for x in range(W):
            dx,dy=x-cx,y-cy
            u=dx*math.cos(a)+dy*math.sin(a);v=-dx*math.sin(a)+dy*math.cos(a)
            if (u/rx)**2+(v/ry)**2<=1: s.add((x,y))
    return s
def mask_poly(pts):
    s=set()
    for y in range(H):
        for x in range(W):
            px,py=x+.5,y+.5;ins=False;j=len(pts)-1
            for i in range(len(pts)):
                xi,yi=pts[i];xj,yj=pts[j]
                if (yi>py)!=(yj>py) and px<(xj-xi)*(py-yi)/(yj-yi)+xi: ins=not ins
                j=i
            if ins: s.add((x,y))
    return s
def line(x0,y0,x1,y1,c,w=0):
    n=max(abs(x1-x0),abs(y1-y0),1)
    for i in range(n+1):
        x=round(x0+(x1-x0)*i/n);y=round(y0+(y1-y0)*i/n)
        for k in range(w+1): put(x+k,y,c)
def fill(m,f):
    for (x,y) in m:
        c=f(x,y)
        if c: put(x,y,c)
def outline(m,c='K'):
    for (x,y) in m:
        if any((x+dx,y+dy) not in m for dx,dy in((1,0),(-1,0),(0,1),(0,-1))): put(x,y,c)
# 2 回目：うさぎを絵の半分の大きさに。場所の物は パラソルと海 の 2 つ（砂浜は地面、タオルはうさぎの下に敷くだけ）
# --- 海と砂浜（下のすみを丸く切る） ---
HZ=17
def shore(x): return 22.5+x*0.04+1.0*math.sin(x/4.5)
R0=16
ground=set((x,y) for y in range(HZ,H) for x in range(W)
           if not ((x<R0 and y>H-1-R0 and (R0-x)**2+(y-(H-1-R0))**2>R0*R0) or (x>W-1-R0 and y>H-1-R0 and (x-(W-1-R0))**2+(y-(H-1-R0))**2>R0*R0)))
for (x,y) in ground:
    s=shore(x)
    if y<HZ+2: c='B'
    elif y<s-1: c='B' if (y==HZ+3 and (x//5)%3==0) else 'S'
    elif y<s+0.5: c='W'
    elif y<s+2: c='O' if (x//3+y)%2==0 else 'Y'
    else: c='O' if (x*13+y*7)%37==0 else 'Y'
    put(x,y,c)
# --- パラソルのかげ（砂に落ちる） ---
fill(mask_ell(50,40,14,4),lambda x,y:'O' if g[y][x] in 'YO' else None)
# --- タオル（うさぎの下に敷く。しま） ---
tw=mask_poly([(6,33),(54,30),(60,44),(4,47)])
fill(tw,lambda x,y:'R' if (x//3)%3==0 else 'P')
outline(tw)
# --- パラソル（柱はうさぎの奥） ---
cx,cy=49,8
line(50,9,53,32,'K',1)
dome=set((x,y) for (x,y) in mask_ell(cx,cy,14,7,-6) if y<=cy+1-0.1*(x-cx)+(1 if (x//4)%2 else 0))
def stripe(x,y):
    a=math.atan2(x-cx,cy+3-y); k=int((a+3.2)/0.3)%2
    if k==0: return 'R'
    return 'P' if x>cx+4 else 'W'
fill(dome,stripe); outline(dome)
put(cx-1,0,'K');put(cx-1,1,'K');put(cx-1,2,'K')
# --- うさぎ（絵の半分。頭を前足にのせて ねむる） ---
WS=lambda cx,cy,rx,ry:(lambda x,y:'S' if ((x-cx)/rx)*0.5+((y-cy)/ry)>0.62 else 'W')
ear2=mask_ell(36,18,9.5,3.2,-28); ear1=mask_ell(28,16,10,3.4,-62)
body=mask_ell(42,35,14,7.5); tail=mask_ell(56.5,31,2.6,2.6)
foot=mask_ell(53,41.5,5,1.8)
head=mask_ell(22,30,11,8.5)
pawL=mask_ell(15,39.5,4,2.2); pawR=mask_ell(27,40,4,2.2)
fill(ear2,WS(36,18,9.5,3.2)); outline(ear2)
fill(mask_ell(36.5,17.7,6.5,1.1,-28),lambda x,y:'P')
fill(ear1,WS(28,16,10,3.4)); outline(ear1)
fill(mask_ell(28.3,15.5,6.8,1.2,-62),lambda x,y:'P')
fill(body,WS(42,35,14,7.5)); outline(body)
fill(tail,lambda x,y:'W'); outline(tail)
fill(foot,lambda x,y:'W'); outline(foot)
for x in (51,53,55): put(x,42,'P')
fill(head,WS(22,30,11,8.5)); outline(head)
for p in (pawL,pawR):
    fill(p,lambda x,y:'W'); outline(p)
for (x,y) in((14,40),(16,40),(26,41),(28,41)): put(x,y,'K')     # 指
# 顔：とじた目（下へ ふくらむ線）・ピンクの鼻・口・ほっぺ
for ex in (14,26):
    for (dx,dy) in((0,0),(1,1),(2,1),(3,1),(4,0)): put(ex+dx,29+dy,'K')
for (x,y) in((20,31),(21,31),(22,31),(21,32)): put(x,y,'P')
for (x,y) in((21,33),(20,34),(19,34),(22,34),(23,34)): put(x,y,'K')
for (x,y) in((12,32),(13,32),(14,32),(12,33),(13,33),(28,32),(29,32),(30,32),(29,33),(30,33)): put(x,y,'P')
for (x,y) in((16,24),(17,24),(15,25)): put(x,y,'S')                # 頭の丸み
# --- Zzz と たいよう（小さく） ---
def z(x,y,n,c='K'):
    for i in range(n): put(x+i,y,c); put(x+i,y+n-1,c); put(x+n-1-i,y+i,c)
z(11,11,5);z(3,5,5);z(11,0,6)  # 斜めの線が見える大きさ
fill(mask_ell(29,3,2.6,2.6),lambda x,y:'Y' if x+y<33 else 'O')
# 文字の地図を書き出す（むだな空き行・列を切る）
rows=[''.join(r) for r in g]
while rows and set(rows[0])=={'.'}: rows.pop(0)
while rows and set(rows[-1])=={'.'}: rows.pop()
open('usagiumibe.txt','w').write('\n'.join(rows)+'\n')
