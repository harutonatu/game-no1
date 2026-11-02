# ゆきやまで うさぎが ボールで あそぶ（usagiyukiyamabooru）M 段。python3 usagiyukiyamabooru.py で usagiyukiyamabooru.txt を書き出す
# 色は 5 つ（K ふちどり・W 雪とうさぎ・S 山とかげ・P 耳とほっぺ・R ボール）。場所の物は 山 1 つ（雪は地面）
import math
ID='usagiyukiyamabooru'
W,H=42,34
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
# ---- 山（左奥）
m=layer()
poly(m,[(0,26),(0,12),(8,2),(13,8),(17,4.5),(29,24),(29,26)],'S')
poly(m,[(4.6,6.2),(8,2),(11,5.6),(9.6,7),(8,5.8),(6.4,7.6)],'W')
poly(m,[(15.4,7),(17,4.5),(19,7.8),(17.2,8.6)],'W')
draw(m)
# ---- 雪の地面
gr=layer()
ell(gr,21,29.0,21,4.2,'W',shade=('S',0.78))
for x in range(W):
    q=1-((x+0.5-21)/21)**2
    if q>0: put(gr,x,int(29.0+4.2*math.sqrt(q)),'S')
draw(gr)
shadow(17,29.6,8,1.4,'W','S',solid=0.4)
shadow(33,29.4,4.5,1.0,'W','S',solid=0.5)
# ---- うさぎ（後ろ足で 立って、ボールへ 前足を のばす）
rb=layer()
ell(rb,10.4,24.0,2.2,2.2,'W')                                   # しっぽ
ell(rb,16.6,22.4,6.6,6.0,'W',shade=('S',0.45))                  # からだ
ell(rb,14.6,28.4,3.6,1.3,'W'); ell(rb,20.4,28.6,3.2,1.2,'W')     # 後ろ足
draw(rb)
er=layer()
ell(er,15.6,6.0,1.9,5.2,'W',ang=-14,shade=('S',0.6)); ell(er,15.7,6.4,0.8,3.6,'P',ang=-14)
draw(er)
er=layer()
ell(er,21.6,5.8,1.9,5.2,'W',ang=20,shade=('S',0.6)); ell(er,21.5,6.2,0.8,3.6,'P',ang=20)
draw(er)
hd=layer(); ell(hd,19.0,13.4,5.8,4.8,'W',shade=('S',0.72)); draw(hd)
pw=layer(); line(pw,20,19,25,17.4,'W',1.0); ell(pw,25.6,17.2,1.8,1.5,'W'); draw(pw)
dots(grid,[(16,12),(16,13)],'K')   # 目（ボールを見る）
dots(grid,[(21,12),(21,13)],'K')
dots(grid,[(19,15),(20,15)],'P'); dots(grid,[(18,16),(20,16)],'K')
dots(grid,[(14,15),(15,15),(23,15),(24,15)],'P')                  # ほっぺ
# ---- ボール（はねて うく。白い しま）
bl=layer()
ell(bl,33,17,4.8,4.8,'R',light=('W',-0.8))
for y in range(H):
    for x in range(W):
        if bl[y][x] in ('R','K'):
            dx=x+0.5-33
            if abs((y+0.5)-(16.4-0.25*dx+0.04*dx*dx))<0.8: bl[y][x]='W'
draw(bl)
for (a,b) in [((39,13),(41,12)),((39,20),(41,21)),((39,16),(41,16))]:   # 動きの線
    ll=layer(); line(ll,a[0],a[1],b[0],b[1],'K'); stamp(ll)
for (x,y) in [(36,3),(28,1)]:                                   # 雪のつぶ
    dots(grid,[(x,y),(x-1,y+1),(x+1,y+1),(x,y+2),(x,y+1)],'S')
save('W')
