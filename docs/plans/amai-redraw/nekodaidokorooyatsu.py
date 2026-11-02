# だいどころで ねこが おやつを たべる（nekodaidokorooyatsu）M 段。python3 nekodaidokorooyatsu.py で nekodaidokorooyatsu.txt を書き出す
# 色は 5 つ（K ふちどり・O ねこ・C テーブルの脚とスポンジ・W クリームと皿・R いちごと テーブルかけ）。場所の物は テーブル 1 つ
import math
ID='nekodaidokorooyatsu'
W,H=40,32
# ---- 道具（見本 nekokouenbooru.py と同じ描き方：部品を層で描き、ふちどりして重ねる）
grid=[['.']*W for _ in range(H)]
def layer(): return [[None]*W for _ in range(H)]
def put(L,x,y,c):
    if 0<=x<W and 0<=y<H: L[y][x]=c
def ell(L,cx,cy,rx,ry,col,ang=0.0,shade=None,light=None,dith=False):
    # shade/light: (色, しきい)。光は左上から。dith=True ならかげを市松に
    a=math.radians(ang)
    for y in range(H):
        for x in range(W):
            dx,dy=x+0.5-cx,y+0.5-cy
            u=(dx*math.cos(a)+dy*math.sin(a))/rx; v=(-dx*math.sin(a)+dy*math.cos(a))/ry
            if u*u+v*v<=1:
                c=col; d=0.45*u+0.9*v
                if shade and d>shade[1] and (not dith or (x+y)%2==0): c=shade[0]
                if light and d<light[1] and u*u+v*v<0.8: c=light[0]
                L[y][x]=c
def poly(L,pts,col):
    ys=[p[1] for p in pts]
    for y in range(max(0,int(min(ys))),min(H,int(max(ys))+1)):
        for x in range(W):
            px,py=x+0.5,y+0.5;ins=False
            for i in range(len(pts)):
                (x1,y1),(x2,y2)=pts[i],pts[i-1]
                if (y1>py)!=(y2>py) and px<x1+(py-y1)*(x2-x1)/(y2-y1): ins=not ins
            if ins: L[y][x]=col
def line(L,x1,y1,x2,y2,col,w=0.0):
    n=int(max(abs(x2-x1),abs(y2-y1))*2)+1
    for i in range(n+1):
        t=i/n;x,y=x1+(x2-x1)*t,y1+(y2-y1)*t;r=int(math.ceil(w))
        for oy in range(-r,r+1):
            for ox in range(-r,r+1):
                if ox*ox+oy*oy<=w*w+0.01: put(L,int(round(x+ox)),int(round(y+oy)),col)
def dots(L,pts,col):
    for (x,y) in pts: put(L,x,y,col)
def outline(L,col='K'):
    out=[r[:] for r in L]
    for y in range(H):
        for x in range(W):
            if L[y][x] is None:
                for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
                    X,Y=x+dx,y+dy
                    if 0<=X<W and 0<=Y<H and L[Y][X] is not None: out[y][x]=col;break
    return out
def stamp(L):
    for y in range(H):
        for x in range(W):
            if L[y][x] is not None: grid[y][x]=L[y][x]
def draw(L,ol=True): stamp(outline(L) if ol else L)
def shadow(cx,cy,rx,ry,on,col='K',solid=0.5):
    for y in range(H):
        for x in range(W):
            q=((x+0.5-cx)/rx)**2+((y+0.5-cy)/ry)**2
            if q<=1 and grid[y][x] in on and ((x+y)%2==0 or q<solid): grid[y][x]=col
def save(fillcol):
    # 閉じた空きを fillcol でうめ、はしの空き行・列を切って書き出す
    out=[[False]*W for _ in range(H)]
    st=[(x,y) for x in range(W) for y in (0,H-1)]+[(x,y) for y in range(H) for x in (0,W-1)]
    st=[(x,y) for x,y in st if grid[y][x]=='.']
    for x,y in st: out[y][x]=True
    while st:
        x,y=st.pop()
        for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
            X,Y=x+dx,y+dy
            if 0<=X<W and 0<=Y<H and not out[Y][X] and grid[Y][X]=='.': out[Y][X]=True;st.append((X,Y))
    n=0
    for y in range(H):
        for x in range(W):
            if grid[y][x]=='.' and not out[y][x]: grid[y][x]=fillcol;n+=1
    rows=[''.join(r) for r in grid]
    while rows and set(rows[0])=={'.'}: rows.pop(0)
    while rows and set(rows[-1])=={'.'}: rows.pop()
    while all(r[0]=='.' for r in rows): rows=[r[1:] for r in rows]
    while all(r[-1]=='.' for r in rows): rows=[r[:-1] for r in rows]
    open(ID+'.txt','w').write('\n'.join(rows)+'\n')
    print('holes filled',n)
# ---- ねこ（テーブルの むこうから 身を のりだす）
cat=layer()
line(cat,5.5,21,1.6,17,'O',1.0); line(cat,1.6,17,1.6,12,'O',1.0); line(cat,1.6,12,3,10,'O',0.7)   # しっぽ
dots(cat,[(1,15),(2,15),(1,13),(2,13)],'C')
ell(cat,13,19.6,8.0,5.4,'O',shade=('C',0.7))                    # からだ
ell(cat,14.4,18.6,4.0,3.4,'W')                                  # むね
ell(cat,14.6,10.2,7.4,6.0,'O',shade=('C',0.8))                  # あたま
poly(cat,[(7.6,7.6),(7.6,1.2),(12.2,5.0)],'O')
poly(cat,[(17.4,4.8),(22.2,1.2),(22.0,7.6)],'O')
poly(cat,[(8.8,5.4),(8.8,3.2),(10.6,4.8)],'R'); poly(cat,[(19.0,4.6),(21.0,3.2),(21.0,5.6)],'R')
for x0 in (13,15,17): line(cat,x0,4.4,x0,6,'C')                 # おでこのしま
ell(cat,16.4,13.4,3.4,2.0,'W')                                  # 口のまわり
for (ex,ey) in [(12,9),(18,9)]:                                 # 目（ケーキを見る。右へ）
    dots(cat,[(ex,ey),(ex+1,ey),(ex,ey+1),(ex+1,ey+1)],'K'); put(cat,ex+1,ey,'W')
dots(cat,[(16,12),(17,12),(16,13)],'K'); dots(cat,[(15,14),(17,14)],'K')
dots(cat,[(16,15),(17,15),(16,16)],'R')                          # した（ぺろり）
draw(cat)
for (a,b) in [((22,12),(24,11)),((7,12),(5,11)),((7,14),(5,15))]:   # ひげ
    ll=layer(); line(ll,a[0],a[1],b[0],b[1],'K'); stamp(ll)
# ---- テーブル（ななめ上から。赤と白の テーブルかけ）
tb=layer()
poly(tb,[(3,21),(37,21),(40,26),(0,26)],'W')
for y in range(H):
    for x in range(W):
        if tb[y][x]=='W':
            u=int((x-20+(y-21)*0.4*((x-20)/20))//3); v=(y-21)//2
            if (u+v)%2==0: tb[y][x]='R'
poly(tb,[(0,26),(40,26),(40,28),(0,28)],'R')
for x in range(W):
    if (x//3)%2==0: put(tb,x,28,'R')
    put(tb,x,27,'W' if (x//3)%2 else 'R')
for (x0,x1) in [(3,5),(35,37)]: poly(tb,[(x0,29),(x1,29),(x1,32),(x0,32)],'C')
draw(tb)
# ---- 前足（テーブルの ふちに かける）
pw=layer(); ell(pw,9.4,21.6,2.2,1.4,'W'); ell(pw,18.8,21.8,2.2,1.4,'W'); draw(pw)
# ---- ケーキ（皿の上の いちごの ショートケーキ）
shadow(29,24.4,7,1.0,'RW','K',solid=0.4)
pl=layer(); ell(pl,29,23.4,7.2,1.8,'W'); draw(pl)
ck=layer()
poly(ck,[(23,14),(35,12),(35,22),(23,23)],'W')                   # 横（スポンジと クリーム）
for y in range(H):
    for x in range(W):
        if ck[y][x]=='W':
            t=y-(14-(x-23)*2/12)
            if 2.5<=t<4.5 or 6.5<=t<8.5: ck[y][x]='C'
poly(ck,[(23,14),(29,10.6),(37,10),(35,12)],'W')                 # 上の面
poly(ck,[(35,12),(37,10),(37.6,20.6),(35,22)],'W')               # 切り口の奥
for y in range(H):
    for x in range(W):
        if ck[y][x]=='W' and x>=35 and x<38 and y>12 and (y%3==0): ck[y][x]='C'
draw(ck)
st=layer(); ell(st,30,8.6,2.4,2.4,'R'); poly(st,[(28.6,6.6),(30,5.0),(31.4,6.6)],'R'); draw(st)
dots(grid,[(29,8),(31,9)],'W')                                   # いちごの つぶ
save('O')
