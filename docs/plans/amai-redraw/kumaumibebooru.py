# うみべで くまが ボールで あそぶ（kumaumibebooru）M 段。python3 kumaumibebooru.py で kumaumibebooru.txt を書き出す
# 色は 5 つ（K ふちどり・C くま・O くまの口とおなか／ボール・S うみ／ボール・Y すな／ボール）。場所の物は 海 1 つ（すなはまは地面）
import math
ID='kumaumibebooru'
W,H=43,32
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
# ---- 海と すなはま（下のすみを丸く切る）
HZ=11
R0=11
for y in range(HZ,H):
    for x in range(W):
        if x<R0 and y>H-1-R0 and (R0-x)**2+(y-(H-1-R0))**2>R0*R0: continue
        if x>W-1-R0 and y>H-1-R0 and (x-(W-1-R0))**2+(y-(H-1-R0))**2>R0*R0: continue
        s=16.0+0.8*math.sin(x/3.0)
        if y<s-0.5: c='K' if (y==HZ+2 and (x//3)%4==0) else 'S'
        else: c='O' if (x*7+y*13)%17==0 or y<s+0.7 else 'Y'
        put(grid,x,y,c)
edge=layer()
for y in range(H):
    for x in range(W):
        if grid[y][x]=='.':
            for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
                X,Y=x+dx,y+dy
                if 0<=X<W and 0<=Y<H and grid[Y][X]!='.' and Y>=HZ+6: edge[y][x]='K';break
stamp(edge)
# ---- ボール（右上で はねる。O・Y・S のしま）
shadow(34,28.6,5,1.2,'YO','O',solid=0.5)
cx,cy=35.5,7.5
bl=layer()
ell(bl,cx,cy,5.2,5.2,'Y')
for y in range(H):
    for x in range(W):
        if bl[y][x]:
            a=math.atan2(y+0.5-cy,x+0.5-cx)+0.5; k=int((a+3.2)/1.05)%3
            bl[y][x]='OYS'[k]
            if (x+0.5-cx)**2+(y+0.5-cy)**2<2.0: bl[y][x]='Y'
dots(bl,[(33,5),(33,6),(34,5)],'Y')                              # 光
draw(bl)
for (a,b) in [((40,12),(42,13)),((29,3),(30,2)),((28,6),(29,5))]:   # 動きの線
    ll=layer(); line(ll,a[0],a[1],b[0],b[1],'K'); stamp(ll)
# ---- くま（すなに すわって、ボールへ 手を のばす）
shadow(16,29.6,11,1.4,'YO','K',solid=0.3)
bear=layer()
ell(bear,16,22.4,8.0,6.6,'C',shade=('K',0.8),dith=True)                 # からだ
ell(bear,15,23.6,4.4,4.4,'O')                                   # おなか
ell(bear,9.6,28.4,3.2,2.2,'C'); ell(bear,21.4,28.4,3.2,2.2,'C')  # 足
ell(bear,9.2,28.6,1.6,1.2,'O'); ell(bear,21.8,28.6,1.6,1.2,'O')
ell(bear,8.6,22.6,2.0,3.4,'C',ang=20)                            # 下げた手
draw(bear)
arm=layer(); line(arm,21,19,27,12.4,'C',1.4); ell(arm,27.6,11.6,2.0,2.0,'C'); draw(arm)
hd=layer()
for ex in (9.6,22.4): ell(hd,ex,5.6,2.6,2.6,'C')                 # 耳
ell(hd,16,11,7.2,6.0,'C')                     # あたま
ell(hd,17,14.0,3.2,2.2,'O')                                     # 口のまわり
draw(hd)
dots(grid,[(9,5),(10,5),(22,5),(23,5)],'O')
dots(grid,[(13,9),(14,9),(13,10),(14,10)],'K'); put(grid,13,9,'O')   # 目（ボールを 見上げる）
dots(grid,[(19,9),(20,9),(19,10),(20,10)],'K'); put(grid,19,9,'O')
dots(grid,[(16,13),(17,13),(18,13),(17,14)],'K')                 # はな
dots(grid,[(16,15),(18,15)],'K')                                 # 口
save('O')
