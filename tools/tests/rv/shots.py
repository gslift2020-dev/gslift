import json, urllib.request
from playwright.sync_api import sync_playwright
B='http://localhost:8787'; SP='/tmp/claude-0/-home-claude/4fc16c7d-9cdb-565e-95a5-a802f1b4a34a/scratchpad/rv/'
r=urllib.request.urlopen(urllib.request.Request(B+'/api/admin/login',data=b'{"password":"testpass123"}',headers={'content-type':'application/json','x-gs-admin':'1','cf-connecting-ip':'9.9.9.9'}))
CK=r.headers['set-cookie'].split(';')[0]
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for mob in [False, True]:
        c=b.new_context(viewport={'width':390,'height':844} if mob else {'width':1280,'height':900}, device_scale_factor=2, is_mobile=mob, extra_http_headers={'cookie':CK})
        p=c.new_page(); errs=[]; p.on('pageerror',lambda e:errs.append(str(e)))
        p.goto(B+'/admin/'); p.wait_for_timeout(3000); k='m' if mob else 'pc'
        p.locator('#dSources').scroll_into_view_if_needed(); p.locator('#dSources').screenshot(path=SP+k+'_sources.png')
        p.uncheck('#vHideBot'); p.wait_for_timeout(300)
        row=p.locator('#vList tr.has-inq:has(.vwho)').first; row.scroll_into_view_if_needed(); row.screenshot(path=SP+k+'_visit_row.png')
        row.locator('.vwho').click(); p.wait_for_timeout(1200); p.screenshot(path=SP+k+'_who.png')
        p.locator('#whoBox [data-close]').first.click()
        p.click('[data-tab=inq]'); p.wait_for_timeout(800)
        card=[x for x in p.locator('#inqList article').all() if '방문 이력' in x.inner_text() and '2번째' in x.inner_text()][0]
        card.scroll_into_view_if_needed(); card.screenshot(path=SP+k+'_inq.png')
        sw=p.evaluate('document.documentElement.scrollWidth'); print(k,'오류',errs,'가로',sw)
        c.close()
    b.close()
