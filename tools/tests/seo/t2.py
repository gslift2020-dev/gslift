import json, urllib.request, random
from playwright.sync_api import sync_playwright
ids=[x['id'] for x in json.loads(urllib.request.urlopen('http://localhost:8787/api/cases?limit=60').read())['items']]
ids2=[x['id'] for x in json.loads(urllib.request.urlopen('http://localhost:8787/api/cases?limit=60&page=6').read())['items']]
random.seed(1); pick=random.sample(ids,8)+random.sample(ids2,8) if ids2 else random.sample(ids,16)
bad=0
with sync_playwright() as pw:
    b=pw.chromium.launch(); off=b.new_context(java_script_enabled=False).new_page(); on=b.new_context().new_page()
    for i in pick:
        off.goto('http://localhost:8787/case.html?id=%d'%i); t1=off.inner_text('#cdBody').replace('링크 공유하기','').strip()
        on.goto('http://localhost:8787/case.html?id=%d'%i); on.wait_for_timeout(1200); t2=on.inner_text('#cdBody').replace('링크 공유하기','').strip()
        if t1!=t2: bad+=1; print('DIFF',i,repr(t1[:200]),'\n   ',repr(t2[:200]))
    b.close()
print('검사', len(pick), '건, 다른 것', bad)
