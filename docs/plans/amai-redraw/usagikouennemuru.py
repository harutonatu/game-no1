# こうえんで うさぎが ねむる（usagikouennemuru）M 段。python3 usagikouennemuru.py で usagikouennemuru.txt を書き出す
# 色は 5 つ（K ふちどり・W うさぎ・G しばふと葉・P 耳と花・C 木と土）。場所の物は 木 1 つ（しばふは地面）
import math
ID='usagikouennemuru'
W,H=42,32
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
# ---- しばふ（ななめ上から見た島。前の面は土）
ICX,ICY,IRX,IRY=21,26,20.6,4.4
lawn=layer()
ell(lawn,ICX,ICY,IRX,IRY,'G')
for x in range(W):
    q=1-((x+0.5-ICX)/IRX)**2
    if q>0:
        fy=int(ICY+IRY*math.sqrt(q))
        for y in (fy,fy+1):
            if 0<=y<H and lawn[y][x] is None: lawn[y][x]='C'
    if q>0.05 and x%2==1: put(lawn,x,int(ICY-IRY*math.sqrt(q))-1,'G')   # 草の先
for (x,y) in [(3,26),(6,24),(9,28),(36,24),(38,27),(13,29),(31,29)]:   # 草の線
    put(lawn,x,y,'K')
draw(lawn)
for (x,y) in [(4,27),(37,25),(34,28)]:                           # 小さな花
    dots(grid,[(x,y),(x+1,y),(x,y-1),(x+1,y-1)],'P')
# ---- 木（左奥。うさぎは その こかげで ねむる）
tr=layer()
poly(tr,[(7,8),(10,8),(10.6,24),(12.6,27),(4.4,27),(6.4,24)],'C')
for y in range(9,25): put(tr,7,y,'W') if y%5==0 else None
draw(tr)
lv=layer()
for (cx,cy,r) in [(9,6,6.0),(3.6,9.6,3.8),(14.6,8.6,4.4),(9.4,11.2,3.6)]:
    ell(lv,cx,cy,r,r*0.92,'G',shade=('K',0.55),dith=True)
draw(lv)
# ---- うさぎ（しばふの上で まるくなって ねむる）
shadow(25,28.2,14,1.6,'G','K',solid=0.3)
rb=layer()
ell(rb,27,21.6,10.2,6.2,'W')                                    # からだ
ell(rb,37.0,21.6,2.0,2.0,'W')                                   # しっぽ
ell(rb,32.4,27.0,3.6,1.4,'W')                                   # 後ろ足
draw(rb)
for x in range(18,37):                                          # からだの かげ（下のふち）
    for y in range(H):
        if grid[y][x]=='W' and y+1<H and grid[y+1][x]=='K' and y>=25 and x%2==0: grid[y][x]='K'
ear=layer()
ell(ear,25.4,14.8,8.2,2.2,'W',ang=-8); ell(ear,25.6,14.8,6.0,0.8,'P',ang=-8)   # 奥の耳
draw(ear)
ear=layer()
ell(ear,23.6,17.6,8.2,2.2,'W',ang=6); ell(ear,23.8,17.6,6.0,0.8,'P',ang=6)     # 手前の耳
draw(ear)
hd=layer()
ell(hd,15.6,21.8,6.6,5.2,'W')                                   # あたま
ell(hd,12.0,27.0,2.4,1.2,'W'); ell(hd,18.4,27.2,2.4,1.2,'W')     # 前足
draw(hd)
for ex in (11,17):                                              # とじた目
    dots(grid,[(ex,21),(ex+1,22),(ex+2,22),(ex+3,21)],'K')
dots(grid,[(14,23),(15,23),(14,24)],'P'); dots(grid,[(13,25),(15,25)],'K')
dots(grid,[(10,24),(11,24),(19,24),(20,24)],'P')                 # ほっぺ
# ---- Zzz
def z(x,y,n):
    for i in range(n): put(grid,x+i,y,'K'); put(grid,x+i,y+n-1,'K'); put(grid,x+n-1-i,y+i,'K')
z(22,7,4); z(27,1,5)
save('W')
