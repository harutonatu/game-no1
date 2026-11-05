# 場所ごとの前後の一覧：python3 sheet.py <出力 .png> <面:id:前 .txt:後 .txt>…（2 列）
import sys
from PIL import Image, ImageDraw
cols={"R":"#E23B3B","O":"#F28C28","Y":"#F2D13A","G":"#3E9E4F","S":"#78C6EE","B":"#2E5BC9","P":"#F29BC2","C":"#8B5A33","W":"#F5F2EA","K":"#2B2B33","D":"#1F5E35","V":"#8A5CC8",".":"#DDDDDD"}
def load(p): return [s.rstrip() for s in open(p,encoding="utf-8") if s.strip()]
s=5; cw=64*s*2+8; ch=48*s+16; g=10; NC=2
items=[a.split(":") for a in sys.argv[2:]]
rows=(len(items)+NC-1)//NC
im=Image.new("RGB",(NC*cw+(NC+1)*g, rows*ch+(rows+1)*g),"#777777"); d=ImageDraw.Draw(im)
for k,(face,id_,a,b) in enumerate(items):
    ox=g+(k%NC)*(cw+g); oy=g+(k//NC)*(ch+g)
    d.text((ox,oy),f"{face} {id_}",fill="white")
    for j,p in enumerate((a,b)):
        m=load(p); bx=ox+j*(64*s+8); by=oy+14
        for y,r in enumerate(m):
            for x,c in enumerate(r): d.rectangle([bx+x*s,by+y*s,bx+x*s+s-1,by+y*s+s-1],fill=cols[c])
im.save(sys.argv[1])
