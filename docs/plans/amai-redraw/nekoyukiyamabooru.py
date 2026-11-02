# ゆきやまで ねこが ボールで あそぶ（nekoyukiyamabooru）M 段。python3 nekoyukiyamabooru.py で nekoyukiyamabooru.txt を書き出す
# 色は 5 つ（K ふちどり・W 雪・S 山とかげ・O ねこ・R ボール）。場所の物は 山 1 つ（雪は地面）
import math
ID='nekoyukiyamabooru'
W,H=44,32
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
# ---- 山（右奥）
m=layer()
poly(m,[(22,21),(33,5),(36,8),(40,2),(44,7),(44,21)],'S')
poly(m,[(30.6,8.6),(33,5),(35.0,7.6),(33.6,8.4),(32.4,7.6),(31.4,9.0)],'W')
poly(m,[(37.4,5.8),(40,2),(43,6.2),(41.4,5.8),(40,7.2),(38.8,5.8)],'W')
draw(m)
# ---- 雪の地面
gr=layer()
ell(gr,22,26.6,22,4.8,'W',shade=('S',0.78))
for x in range(W):
    q=1-((x+0.5-22)/22)**2
    if q>0: put(gr,x,int(26.6+4.8*math.sqrt(q)),'S')
draw(gr)
shadow(19,28.6,11,1.4,'W','S',solid=0.3)
shadow(36.5,29.0,5,1.0,'W','S',solid=0.5)
# ---- ねこ（ボールに とびつく）
cat=layer()
line(cat,10,19,5,15,'O',1.0); line(cat,5,15,4,10,'O',1.0); line(cat,4,10,6,7,'O',0.7)   # しっぽ
dots(cat,[(4,13),(5,13),(3,11),(4,11)],'K')
line(cat,13,23,9,27,'O',1.2); ell(cat,8.6,27.6,2.2,1.1,'W')        # 後ろ足
ell(cat,17,19.6,8.6,4.8,'O',ang=-14)                            # からだ
ell(cat,18.6,22.0,5.0,1.6,'W',ang=-14)                          # おなか
line(cat,24,21,31,25,'O',1.2); ell(cat,32.2,25.6,1.9,1.4,'W',ang=20)   # 前足（ボールを おさえる）
line(cat,25,18,31,19,'O',1.1); ell(cat,32.0,19.4,1.9,1.4,'W')
for k in range(3):                                              # せなかの しま
    x0=12+k*3.6; line(cat,x0,15.6-k*0.9,x0+1,17.6-k*0.9,'K')
draw(cat)
hd=layer()
ell(hd,26.4,12.8,6.4,5.2,'O')                                   # あたま
poly(hd,[(21.2,11.4),(21.4,5.0),(25.4,9.0)],'O')
poly(hd,[(27.6,8.6),(31.6,5.0),(31.8,11.2)],'O')
poly(hd,[(22.4,9.2),(22.5,7.0),(24.0,8.6)],'R'); poly(hd,[(28.9,8.4),(30.6,7.0),(30.6,9.4)],'R')
ell(hd,26.4,15.6,3.0,1.6,'W')                                   # 口のまわり
draw(hd)
for (ex,ey) in [(22,11),(28,11)]:                               # 目（ボールを見る）
    dots(grid,[(ex,ey),(ex+1,ey),(ex,ey+1),(ex+1,ey+1)],'K'); put(grid,ex+1,ey+1,'W')
dots(grid,[(26,14),(27,14),(26,15)],'K'); dots(grid,[(25,16),(27,16)],'K')
# ---- ボール（ころがる。白い しま）
bl=layer()
ell(bl,37,24.6,4.4,4.4,'R',light=('W',-0.8))
for y in range(H):
    for x in range(W):
        if bl[y][x]=='R':
            dx=x+0.5-37
            if abs((y+0.5)-(24.2-0.3*dx+0.03*dx*dx))<0.8: bl[y][x]='W'
draw(bl)
for (a,b) in [((42,21),(43,20)),((42,25),(44,25)),((9,17),(8,18))]:   # 動きの線
    ll=layer(); line(ll,a[0],a[1],b[0],b[1],'K'); stamp(ll)
for (x,y) in [(12,3),(2,1)]:                                    # 雪のつぶ
    dots(grid,[(x,y),(x-1,y+1),(x+1,y+1),(x,y+2),(x,y+1)],'S')
save('W')
