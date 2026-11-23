import json, urllib.request
from playwright.sync_api import sync_playwright
B='http://localhost:8787'
r=urllib.request.urlopen(urllib.request.Request(B+'/api/admin/login',data=b'{"password":"testpass123"}',headers={'content-type':'application/json','x-gs-admin':'1','cf-connecting-ip':'9.9.9.2'}))
CK=r.headers['set-cookie'].split(';')[0]
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for mob in [False, True]:
        c=b.new_context(viewport={'width':390,'height':844} if mob else {'width':1280,'height':900}, device_scale_factor=2 if mob else 1, extra_http_headers={'cookie':CK})
        p=c.new_page(); errs=[]; p.on('pageerror',lambda e:errs.append(str(e)))
        p.goto(B+'/admin/'); p.wait_for_timeout(1500); p.click('[data-tab=inq]'); p.wait_for_timeout(1000)
        n_all=p.locator('#inqList article').count()
        p.click('#filters [data-f=trash]'); p.wait_for_timeout(300); n_tr=p.locator('#inqList article').count(); t=p.inner_text('#inqList')[:200]
        p.click('#filters [data-f=all]'); p.wait_for_timeout(300)
        opts=p.locator('#inqList article select').first.locator('option').all_inner_texts()
        p.screenshot(path='adm_%s.png'%('m' if mob else 'pc'), full_page=False)
        print('mob' if mob else 'pc', '전체(휴지통 뺌)',n_all,'휴지통',n_tr, '선택지',opts, '오류',errs, t.replace('\n',' | ')[:150])
        c.close()
    b.close()
