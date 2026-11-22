"""Wytnij pas obrazu: kadr.py wej.png wyj.png x0 y0 x1 y1 [skala]"""
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
x0, y0, x1, y1 = map(int, sys.argv[3:7])
scale = float(sys.argv[7]) if len(sys.argv) > 7 else 1.0
im = Image.open(src).crop((x0, y0, x1, y1))
if scale != 1.0:
    im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
im.save(dst)
print(im.size)
