# だいどころで うさぎが ねむる（usagidaidokoronemuru）S 段。python3 usagidaidokoronemuru.py で usagidaidokoronemuru.txt を書き出す
# 色は 4 つ（K ふちどり・W うさぎ・P 耳とほっぺ・C テーブルと なべ）。場所の物は テーブルと なべ の 2 つ
import math
ID='usagidaidokoronemuru'
W,H=37,27
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
poly(tb,[(3,16),(37,16),(34,22),(0,22)],'C')
for y in range(16,22):
    for x in range(W):
        if tb[y][x]=='C' and y in (18,20) and (x*3+y)%7<4: tb[y][x]='K'   # 木目
poly(tb,[(0,22),(34,22),(34,24),(0,24)],'C')
for x in range(34): put(tb,x,23,'K' if x%2==0 else 'C')
poly(tb,[(2,24),(4,24),(4,27),(2,27)],'C'); poly(tb,[(30,24),(32,24),(32,27),(30,27)],'C')
draw(tb)
# ---- なべ（右奥。ふたと つまみ、両がわの とって）
pot=layer()
poly(pot,[(28.6,10.6),(35.4,10.6),(35.4,13.4),(28.6,13.4)],'C')
ell(pot,32,13.4,3.4,1.6,'C')
for y in (11,12,13): put(pot,29,y,'W')                            # 光
draw(pot)
lid=layer(); ell(lid,32,10.0,4.0,1.0,'W'); ell(lid,32,8.8,2.8,1.4,'C'); draw(lid)   # ふた（ふちは しろ）
kn=layer(); ell(kn,32,6.6,1.0,0.9,'W'); draw(kn)                 # つまみ
for (x,y) in [(27,11),(27,12),(36,11),(36,12)]: put(grid,x,y,'K')  # とって（両がわ）
shadow(32,16.4,4,0.9,'C','K')
# ---- うさぎ（天板の上で まるくなって ねむる。頭を 大きく）
shadow(13,21.2,12,1.4,'CK','K',solid=0.3)
rb=layer()
ell(rb,18.2,14.8,6.6,5.0,'W',shade=('P',0.86))                  # からだ
ell(rb,25.0,15.6,1.4,1.4,'W')                                   # しっぽ
ell(rb,21.6,19.4,2.8,1.2,'W')                                   # 後ろ足
draw(rb)
ear=layer()
ell(ear,16.0,7.4,6.8,1.9,'W',ang=-6); ell(ear,16.2,7.4,5.0,0.7,'P',ang=-6)   # 耳（せなかへ ねかせる）
draw(ear)
hd=layer()
ell(hd,8.2,13.6,7.4,6.0,'W')                                    # あたま
ell(hd,5.0,19.8,2.4,1.2,'W'); ell(hd,11.4,20.0,2.4,1.2,'W')      # 前足
draw(hd)
for ex in (3,10):                                               # とじた目
    dots(grid,[(ex,13),(ex+1,14),(ex+2,14),(ex+3,13)],'K')
dots(grid,[(7,15),(8,15),(7,16),(8,16)],'P'); dots(grid,[(6,17),(9,17)],'K')   # はなと 口
dots(grid,[(2,16),(3,16),(13,16),(14,16)],'P')                    # ほっぺ
# ---- Zzz
def z(x,y,n):
    for i in range(n): put(grid,x+i,y,'K'); put(grid,x+i,y+n-1,'K'); put(grid,x+n-1-i,y+i,'K')
z(0,3,4); z(5,0,4)
save('W')
