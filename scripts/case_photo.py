"""설치사례 사진 변환: 원본 사진 → 1200x1600 webp + 가운데 워터마크 (홈페이지와 같은 모양).
사용: python3 scripts/case_photo.py 원본.jpg public/imports/폴더/이름-01.webp [원본2 결과2 ...]
- 사진의 촬영 날짜·위치(GPS) 정보는 결과 파일에 남지 않는다.
"""
import os, sys
from PIL import Image, ImageOps
try:
    import pillow_heif; pillow_heif.register_heif_opener()
except Exception:
    pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMB = Image.open(os.path.join(ROOT, 'public/assets/img/emblem-white.webp')).convert('RGBA')

def conv(src, dst, alpha=0.42):
    im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
    im = ImageOps.fit(im, (1200, 1600), Image.LANCZOS, centering=(0.5, 0.5))
    w = 326; e = EMB.resize((w, round(EMB.height * w / EMB.width)), Image.LANCZOS)
    e.putalpha(e.getchannel('A').point(lambda v: int(v * alpha)))
    base = im.convert('RGBA'); base.alpha_composite(e, ((1200 - e.width) // 2, (1600 - e.height) // 2))
    os.makedirs(os.path.dirname(dst) or '.', exist_ok=True)
    base.convert('RGB').save(dst, 'WEBP', quality=80, method=6)

if __name__ == '__main__':
    a = sys.argv[1:]
    if not a or len(a) % 2: sys.exit('사용: case_photo.py 원본 결과 [원본 결과 ...]')
    for s, d in zip(a[0::2], a[1::2]): conv(s, d); print('ok', d)
