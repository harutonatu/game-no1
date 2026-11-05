# 見本の前後の画像を 2 列に並べる：python3 grid.py <出力 .png> <画像>…
import sys
from PIL import Image
ims=[Image.open(p) for p in sys.argv[2:]]; w=max(i.width for i in ims); h=max(i.height for i in ims); g=24
cols=2; rows=(len(ims)+1)//2
out=Image.new("RGB",(cols*w+(cols+1)*g, rows*h+(rows+1)*g),"#888888")
for k,im in enumerate(ims):
    out.paste(im,(g+(k%cols)*(w+g), g+(k//cols)*(h+g)))
out.save(sys.argv[1])
