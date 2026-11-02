# だいどころで うさぎが ねむる（usagidaidokoronemuru）S 段。python3 usagidaidokoronemuru.py で usagidaidokoronemuru.txt を書き出す
# 色は 4 つ（K ふちどり・W うさぎ・P 耳とほっぺ・C テーブルと なべ）。場所の物は テーブルと なべ の 2 つ
import math
ID='usagidaidokoronemuru'
W,H=32,26
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
# ---- テーブル（ななめ上から。天板・前の板・脚）
tb=layer()
poly(tb,[(3,15),(32,15),(29,21),(0,21)],'C')
for y in range(15,21):
    for x in range(W):
        if tb[y][x]=='C' and y in (17,19) and (x*3+y)%7<4: tb[y][x]='K'   # 木目
poly(tb,[(0,21),(28,21),(28,23),(0,23)],'C')
for x in range(28): put(tb,x,22,'K' if x%2==0 else 'C')
poly(tb,[(2,23),(4,23),(4,26),(2,26)],'C'); poly(tb,[(24,23),(26,23),(26,26),(24,26)],'C')
draw(tb)
# ---- なべ（右奥。ちゃいろの なべに しろい光）
pot=layer()
ell(pot,26,12.8,4.4,3.0,'C')
poly(pot,[(21.6,8.6),(30.4,8.6),(30.4,12.8),(21.6,12.8)],'C')
ell(pot,26,8.6,4.4,1.4,'K')
ell(pot,26,8.4,3.8,0.9,'C')
for y in (10,11,12): put(pot,23,y,'W')                            # 光
dots(pot,[(20,10),(20,11),(21,10),(31,10),(31,11),(30,10)],'K')       # とって
draw(pot)
kn=layer(); ell(kn,26,6.6,1.4,1.0,'C'); draw(kn)
shadow(27.5,15.6,5,1.0,'C','K')
# ---- うさぎ（天板の上で まるくなって ねむる）
shadow(12,20.2,11,1.4,'CK','K',solid=0.3)
rb=layer()
ell(rb,13.5,14.0,7.4,5.0,'W',shade=('P',0.86))                  # からだ
ell(rb,20.6,15.2,1.6,1.6,'W')                                   # しっぽ
ell(rb,17.6,18.4,2.8,1.2,'W')                                   # 後ろ足
draw(rb)
ear=layer()
ell(ear,13.6,8.6,6.6,1.9,'W',ang=-12); ell(ear,13.6,8.6,4.8,0.7,'P',ang=-12)   # 耳（せなかへ ねかせる）
draw(ear)
hd=layer()
ell(hd,7.0,14.4,6.0,4.8,'W')                                    # あたま
ell(hd,4.6,18.6,2.2,1.2,'W'); ell(hd,9.6,18.8,2.2,1.2,'W')       # 前足
draw(hd)
for ex in (2,8):                                                # とじた目
    dots(grid,[(ex,14),(ex+1,15),(ex+2,14)],'K')
dots(grid,[(5,16),(6,16),(6,17)],'P'); dots(grid,[(5,18),(7,18)],'K')
dots(grid,[(2,17),(3,17),(10,17),(11,17)],'P')                          # ほっぺ
# ---- Zzz
def z(x,y,n):
    for i in range(n): put(grid,x+i,y,'K'); put(grid,x+i,y+n-1,'K'); put(grid,x+n-1-i,y+i,'K')
z(1,5,4); z(5,0,5)
save('W')
