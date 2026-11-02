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
# --- 海と砂浜（下のすみを丸く切る） ---
def shore(x): return 26+x*0.06+1.3*math.sin(x/4.5)
R0=15
ground=set((x,y) for y in range(19,H) for x in range(W)
           if not ((x<R0 and y>H-1-R0 and (R0-x)**2+(y-(H-1-R0))**2>R0*R0) or (x>W-1-R0 and y>H-1-R0 and (x-(W-1-R0))**2+(y-(H-1-R0))**2>R0*R0)))
for (x,y) in ground:
    s=shore(x)
    if y<21: c='B'
    elif y<s-1: c='B' if (y==22 and (x//5)%3==0) or (y==24 and (x//4+1)%4==0) else 'S'
    elif y<s+0.5: c='W'
    elif y<s+2: c='O' if (x//3+y)%2==0 else 'Y'
    else: c='O' if (x*13+y*7)%37==0 else 'Y'
    put(x,y,c)
for x0,y0 in((3,23),(30,23),(50,22)): line(x0,y0,x0+4,y0,'W')
# --- パラソルのかげ（砂に落ちる。右下へずらす）と柱のかげ ---
fill(mask_ell(45,41,17,4.5),lambda x,y:'O' if g[y][x] in 'YO' else None)
# --- タオル（斜めから見た四角。しまは長い向きに） ---
def tw_y(x): return 33-3*(x-9)/40
tw=mask_poly([(9,33),(49,30),(56,44),(13,47)])
fill(tw,lambda x,y:'R' if (x//3)%3==0 else ('W' if y==tw_y(x)+2 else 'P'))
outline(tw)
# --- パラソルの柱（タオルの奥に立つ） ---
line(46,10,49,31,'K',1)
# --- うさぎ（左を向いて ねそべる。目を とじる） ---
body=mask_ell(36,38,10,4.8)|mask_ell(43,36.5,6,4.6)
head=mask_ell(23,36,6.2,5.2)
paw=mask_ell(19.5,41.5,3.5,1.6)
tail=mask_ell(49.5,34.5,2.2,2.2)
ear1=mask_ell(31,26,8,2.4,-38)
ear2=mask_ell(28,27.5,7,2.2,-58)
def shade(cx,cy,ry):
    return lambda x,y:'S' if y>cy+ry*0.55 else 'W'
fill(ear2,lambda x,y:'S'); outline(ear2)
fill(ear1,lambda x,y:'W'); outline(ear1)
fill(mask_ell(31.3,25.8,5,0.9,-38),lambda x,y:'P')
fill(body,shade(38,37,4.8)); outline(body)
fill(tail,lambda x,y:'W'); outline(tail)
fill(head,shade(23,36,5.2)); outline(head)
fill(paw,lambda x,y:'W'); outline(paw)
for (x,y) in((19,35),(20,36),(21,36),(22,35)): put(x,y,'K')   # とじた目
for (x,y) in((20,38),(21,38),(22,38)): put(x,y,'P')            # ほっぺ
for (x,y) in((17,36),(17,37)): put(x,y,'P')                    # はな
put(18,38,'K')                                                 # くち
for (x,y) in((25,32),(26,32),(24,33)): put(x,y,'W')            # 頭の光
# 後ろ足（体の下から 後ろへ のびる）
foot=mask_ell(47,41.5,4.5,1.6)
fill(foot,lambda x,y:'W'); outline(foot)
for (x,y) in((47,41),(48,41),(49,41)): put(x,y,'P')
# 体の下のかげ（タオルに落ちる）
for x in range(28,48): 
    if g[44][x] in 'PW': put(x,44,'R' if g[44][x]=='P' else 'P')
# --- パラソル（ななめから見た かさ。赤と白のしま・右がかげ） ---
cx,cy=44,13
dome=set((x,y) for (x,y) in mask_ell(cx,cy,21,10,-8) if y<=cy+1.5-0.14*(x-cx)+(1 if (x//4)%2 else 0))
def stripe(x,y):
    a=math.atan2(x-cx,cy+4-y); k=int((a+3.2)/0.26)%2
    if k==0: return 'R'
    return 'P' if x>cx+5 else 'W'
fill(dome,stripe); outline(dome)
for y in range(1,5): put(cx-1,y,'K')
put(cx-2,1,'K');put(cx,1,'K')
# --- Zzz（ねむり。頭から上へ） ---
def z(x,y,n,c='K'):
    for i in range(n): put(x+i,y,c); put(x+i,y+n-1,c); put(x+n-1-i,y+i,c)
z(14,22,4);z(8,13,5);z(15,2,6)
# --- たいよう ---
fill(mask_ell(5,5,3.5,3.5),lambda x,y:'Y' if x+y<10 else 'O')
for a in range(0,360,45):
    r=math.radians(a); put(round(5+5.5*math.cos(r)),round(5+5.5*math.sin(r)),'O')
# 文字の地図を書き出す（むだな空き行・列を切る）
rows=[''.join(r) for r in g]
while rows and set(rows[0])=={'.'}: rows.pop(0)
while rows and set(rows[-1])=={'.'}: rows.pop()
open('usagiumibe.txt','w').write('\n'.join(rows)+'\n')
