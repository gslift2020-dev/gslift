#!/usr/bin/env python3
"""CSS/JS 파일 내용이 바뀌면 주소 끝 ?v= 번호를 갱신해 브라우저가 새 파일을 받게 함."""
import hashlib, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent / 'public'
def ver(*names):
    h = hashlib.sha1()
    for n in names: h.update((root / n).read_bytes())
    return h.hexdigest()[:8]
for page in ['index.html', 'case.html', 'cases.html', 'privacy.html', '404.html', 'admin/index.html']:
    p = root / page
    if not p.exists(): continue
    s = p.read_text()
    def sub(m):
        f = m.group(2).lstrip('/')
        return m.group(1) + m.group(2) + '?v=' + ver(f)
    s = re.sub(r'((?:href|src)=")(/?(?:assets|admin)/[\w./-]+\.(?:css|js))(?:\?v=[\w]+)?(?=")', sub, s)
    p.write_text(s)
print('versions updated')
