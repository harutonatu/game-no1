# うみべで いぬが おやつを たべる（inuumibeoyatsu）M 段。python3 inuumibeoyatsu.py で inuumibeoyatsu.txt を書き出す
# 色は 5 つ（K ふちどり・Y すな・S うみ／パラソル・C いぬ（明るい所と口のまわりは Y）・W 波／パラソル／ほね）。場所の物は 海と パラソル の 2 つ
import math
ID='inuumibeoyatsu'
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
# ---- 海と すなはま（下のすみを丸く切る。奥ほど細い波）
HZ=9
R0=9
for y in range(HZ,H):
    for x in range(W):
        if x<R0 and y>H-1-R0 and (R0-x)**2+(y-(H-1-R0))**2>R0*R0: continue
        if x>W-1-R0 and y>H-1-R0 and (x-(W-1-R0))**2+(y-(H-1-R0))**2>R0*R0: continue
        s=14.5+0.8*math.sin(x/3.2)
        if y<s-0.5: c='W' if (y==HZ+2 and (x//3)%3==0) or (y==HZ+4 and (x//4)%3==1) else 'S'
        elif y<s+0.7: c='W'
        else: c='C' if (x*7+y*13)%23==0 else 'Y'
        put(grid,x,y,c)
for x in range(W):
    if grid[H-1][x]!='.' or grid[H-2][x]!='.': pass
# 前のふち
edge=layer()
for y in range(H):
    for x in range(W):
        if grid[y][x]=='.':
            for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
                X,Y=x+dx,y+dy
                if 0<=X<W and 0<=Y<H and grid[Y][X]!='.' and Y>=HZ+6: edge[y][x]='K';break
stamp(edge)
# ---- パラソル（右奥。柱は いぬの 奥）
shadow(35,26.5,5,1.4,'YC','C',solid=0.4)
pl=layer(); line(pl,33,7,36,26,'C',0.4); draw(pl)
cx,cy=32,7
dome=layer()
ell(dome,cx,cy+1,8,6,'S',ang=-8)
for y in range(H):
    for x in range(W):
        if dome[y][x]:
            if y>cy+0.4-0.15*(x-cx)+(1 if (x//3)%2 else 0): dome[y][x]=None
            else:
                a=math.atan2(x+0.5-cx,cy+7-y-0.5); k=int((a+3.2)/0.22)%2
                dome[y][x]='W' if k else 'S'
draw(dome)
dots(grid,[(31,0),(31,1)],'K')
# ---- いぬ（すなに すわって、ほねを くわえる）
shadow(19,29.4,11,1.5,'YC','K',solid=0.3)
dog=layer()
line(dog,25,27,29.5,22,'C',0.9); line(dog,29.5,22,30,19.5,'C',0.7)   # しっぽ（ふる）
ell(dog,18,23.6,7.4,6.0,'C',light=('Y',-0.75))                  # からだ
ell(dog,24.4,26.4,3.4,3.4,'C')                                  # 後ろ足のもも
ell(dog,17.4,22.6,3.4,4.4,'Y')                                  # むね
line(dog,14.6,25,14.6,28.4,'C',1.0); line(dog,20.4,25,20.4,28.4,'C',1.0)   # 前足
ell(dog,14.6,29.2,1.8,1.0,'Y'); ell(dog,20.4,29.2,1.8,1.0,'Y')
ell(dog,26.4,29.4,2.4,1.0,'Y')
draw(dog)
dots(grid,[(15,25),(15,26),(21,25),(21,26)],'K')                 # 前足の わかれめ
dots(grid,[(14,25),(14,26),(14,27),(20,25),(20,26),(20,27)],'C')
hd=layer()
ell(hd,17.8,11.8,7.0,5.8,'C',light=('Y',-0.72))                # あたま
ell(hd,17.8,15.4,3.8,2.4,'Y')                                   # 口のまわり
draw(hd)
for (ex,ang) in [(10.6,14),(25.0,-14)]:                          # たれた耳
    er=layer(); ell(er,ex,12.6,2.4,5.0,'C',ang=ang); draw(er)
dots(grid,[(14,10),(15,10),(14,11),(15,11)],'K'); put(grid,14,10,'W')   # 目
dots(grid,[(20,10),(21,10),(20,11),(21,11)],'K'); put(grid,20,10,'W')
dots(grid,[(17,13),(18,13),(17,14),(18,14)],'K')                 # はな
# ほね（口に よこに くわえる。頭の外へ はみ出す）
bn=layer()
line(bn,11,17,25,17,'W',0.6)
for (x,y) in [(10,15.8),(10,18.2),(25.8,15.8),(25.8,18.2)]: ell(bn,x,y,1.4,1.3,'W')
draw(bn)
save('Y')
