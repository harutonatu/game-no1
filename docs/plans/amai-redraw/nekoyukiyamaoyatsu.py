# ゆきやまで ねこが おやつを たべる（nekoyukiyamaoyatsu）S 段。python3 nekoyukiyamaoyatsu.py で nekoyukiyamaoyatsu.txt を書き出す
# 色は 4 つ（K ふちどり・W 雪・O ねこ／クッキー・S 山と雪のかげ）。場所の物は 山 1 つ
import math
ID='nekoyukiyamaoyatsu'
W,H=30,29
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
# ---- 山（奥。頂上に雪）
m=layer()
poly(m,[(0,20),(7,3),(11,8),(14,5.5),(21,15),(21,20)],'S')
poly(m,[(4.6,8),(7,3),(9.6,6.6),(8.4,8),(7,6.8),(5.8,8.4)],'W')
poly(m,[(12.6,7.6),(14,5.5),(15.6,8),(14.2,8.8)],'W')
draw(m)
# ---- 雪の地面（ななめ上から。前の面はかげ）
gr=layer()
ell(gr,15,23.5,15,4.2,'W',shade=('S',0.72))
for x in range(W):
    q=1-((x+0.5-15)/15)**2
    if q>0:
        y=int(23.5+4.2*math.sqrt(q))
        put(gr,x,y,'S')
draw(gr)
shadow(19.5,25.5,8,1.4,'W','S')
# ---- ねこ（すわって 胸の前で クッキーを 両手で持つ）
cat=layer()
line(cat,23,24,27,24,'O',0.9); line(cat,27,24,28.5,21,'O',0.8)   # しっぽ
dots(cat,[(26,24),(26,25),(28,22)],'K')                  # しっぽのしま
ell(cat,18,20.5,7.0,5.6,'O')                                    # からだ
ell(cat,17.0,21.2,4.4,4.2,'W')                                  # むね・おなか
ell(cat,22.5,25,2.4,1.2,'W'); ell(cat,12.5,25.2,2.4,1.2,'W')     # 足
ell(cat,17.0,9.6,5.6,5.0,'O')                                   # あたま
poly(cat,[(11.9,7.6),(12.1,1.8),(15.9,5.6)],'O')
poly(cat,[(18.6,5.2),(22.2,1.8),(22.2,7.6)],'O')
poly(cat,[(13,5.8),(13.1,3.6),(14.5,5.2)],'W'); poly(cat,[(19.8,5),(21.3,3.6),(21.3,6)],'W')
dots(cat,[(17,5),(17,6),(15,5),(19,5)],'K')                     # おでこのしま
ell(cat,17.3,12.3,2.8,1.5,'W')                                  # 口のまわり
for (ex,ey) in [(14,9),(19,9)]:                                 # 目（クッキーを見る）
    dots(cat,[(ex,ey),(ex+1,ey),(ex,ey+1),(ex+1,ey+1)],'K'); put(cat,ex,ey,'W')
dots(cat,[(17,11),(16,12),(18,12)],'K')
for y in (19,21): put(cat,24,y,'K')                              # せなかのしま
stamp(outline(cat))
for (a,b) in [((9,10),(7,9)),((9,12),(7,13)),((24,11),(25,10))]:  # ひげ
    ll=layer(); line(ll,a[0],a[1],b[0],b[1],'K'); stamp(ll)
# ---- クッキー（前足で 口の横へ 持ち上げる。かじった所が欠けている）
ck=layer()
ell(ck,26.4,13.0,2.9,2.9,'O')
for (x,y) in [(28,10),(28,11),(27,10)]: ck[y][x]=None   # かじったあと
dots(ck,[(25,12),(27,13),(25,14),(26,15)],'K')
draw(ck)
paw=layer(); line(paw,21,19,23,17,'O',1.0); ell(paw,24.2,16.0,1.7,1.4,'W'); draw(paw)
# ---- 雪のつぶ
for (x,y) in [(25,1),(3,1)]:
    dots(grid,[(x,y),(x-1,y+1),(x+1,y+1),(x,y+2),(x,y+1)],'S')
save('O')
