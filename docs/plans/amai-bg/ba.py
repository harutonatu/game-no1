# 前と後を横に並べた画像：python3 ba.py <前 .txt> <後 .txt> <出力 .png>
import sys
from PIL import Image, ImageDraw
cols={"R":"#E23B3B","O":"#F28C28","Y":"#F2D13A","G":"#3E9E4F","S":"#78C6EE","B":"#2E5BC9","P":"#F29BC2","C":"#8B5A33","W":"#F5F2EA","K":"#2B2B33",".":"#DDDDDD"}
def load(p): return [s.rstrip() for s in open(p,encoding="utf-8") if s.strip()]
a,b=load(sys.argv[1]),load(sys.argv[2]); s=10; W,H=len(a[0]),len(a); gap=20
im=Image.new("RGB",(W*s*2+gap,H*s),"white"); d=ImageDraw.Draw(im)
for ox,m in ((0,a),(W*s+gap,b)):
    for y,r in enumerate(m):
        for x,c in enumerate(r): d.rectangle([ox+x*s,y*s,ox+x*s+s-1,y*s+s-1],fill=cols[c])
im.save(sys.argv[3])
