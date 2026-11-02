# ゆきやまで いぬが ねむる（inuyukiyamanemuru）M 段。python3 inuyukiyamanemuru.py で inuyukiyamanemuru.txt を書き出す
# 色は 5 つ（K ふちどり・W 雪・S 山と雪のかげ・C いぬ・R マフラー）。場所の物は 山 1 つ（雪は地面）
import math
ID='inuyukiyamanemuru'
W,H=42,33
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
# ---- 山（右奥。頂上に雪）
m=layer()
poly(m,[(14,22),(27,2),(32,8),(35,5),(42,14),(42,22)],'S')
poly(m,[(23.2,8),(27,2),(30.6,7.0),(29,8.4),(27,7),(25,9)],'W')
poly(m,[(33.4,7.2),(35,5),(37,8),(35.2,8.6)],'W')
for (x,y) in [(30,13),(33,15),(37,14),(22,16)]: dots(m,[(x,y),(x+1,y+1),(x+2,y+2)],'W')   # 雪のすじ
draw(m)
# ---- 雪の地面
gr=layer()
ell(gr,21,26.0,21,6.0,'W',shade=('S',0.78))
for x in range(W):
    q=1-((x+0.5-21)/21)**2
    if q>0: put(gr,x,int(26.0+6.0*math.sqrt(q)),'S')
draw(gr)
shadow(22,27.4,15,1.6,'W','S',solid=0.3)
# ---- いぬ（雪の上で まるくなって ねむる。赤い マフラー）
dog=layer()
ell(dog,23,20.6,10.4,5.8,'C',light=('W',-0.9))                 # からだ
ell(dog,28.6,25.2,6.6,1.6,'C')                                  # まるめた しっぽ
ell(dog,30.6,26.0,2.6,0.8,'W')                                  # しっぽの先
draw(dog)
sc=layer()
ell(sc,16.6,21.0,2.8,5.0,'R',ang=-10)                           # マフラー
line(sc,17,24,21,27.5,'R',1.0)
for y in range(H):
    for x in range(W):
        if sc[y][x]=='R' and (x-y)%5==0: sc[y][x]='W'
draw(sc)
hd=layer()
ell(hd,10.4,19.8,6.6,5.4,'C')                                   # あたま（前足に のせる）
ell(hd,6.0,22.4,3.0,2.0,'W')                                    # 口のまわり
ell(hd,7.0,26.0,3.0,1.2,'C'); ell(hd,13.0,26.2,3.0,1.2,'C')      # 前足
draw(hd)
er=layer(); ell(er,13.8,17.0,2.4,4.2,'C',ang=-50); draw(er)      # たれた耳
for ex in (5,10):                                               # とじた目
    dots(grid,[(ex,18),(ex+1,19),(ex+2,19),(ex+3,18)],'K')
dots(grid,[(3,21),(4,21),(3,22),(4,22)],'K')                     # はな
dots(grid,[(5,23),(6,23),(7,22)],'K')
# ---- Zzz と 雪のつぶ
def z(x,y,n):
    for i in range(n): put(grid,x+i,y,'K'); put(grid,x+i,y+n-1,'K'); put(grid,x+n-1-i,y+i,'K')
z(1,8,4); z(7,2,5)
for (x,y) in [(18,2),(2,3),(40,1)]:
    dots(grid,[(x,y),(x-1,y+1),(x+1,y+1),(x,y+2),(x,y+1)],'S')
save('W')
