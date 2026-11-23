from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops
SP='/tmp/claude-0/-home-claude/4fc16c7d-9cdb-565e-95a5-a802f1b4a34a/scratchpad/seo/'
res=[]
def check(n,ok,info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n+('  — '+str(info) if info else ''))
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for mob in [False,True]:
        k='m' if mob else 'pc'
        shots={}
        for port,ver in [(8791,'old'),(8787,'new')]:
            c=b.new_context(viewport={'width':390,'height':844} if mob else {'width':1280,'height':900}, is_mobile=mob, extra_http_headers={'cf-connecting-ip':'10.88.0.%d'%(1 if mob else 2)})
            c.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>false})")
            p=c.new_page(); errs=[]; reqs=[]
            p.on('pageerror',lambda e:errs.append(str(e))); p.on('request',lambda r: '/api/' in r.url and reqs.append(r.url.split('8787')[-1].split('8791')[-1]))
            p.goto('http://localhost:%d/case.html?id=474'%port); p.wait_for_timeout(3000)
            p.evaluate("document.querySelectorAll('.gal-main img,.gal-thumbs img,.cd-more-grid img').forEach(i=>i.loading='eager')"); p.wait_for_timeout(1500)
            p.screenshot(path=SP+k+'_'+ver+'.png', full_page=True); shots[ver]=SP+k+'_'+ver+'.png'
            info=p.evaluate("({h1:(document.querySelector('.cd-info h1')||{}).textContent, cnt:(document.querySelector('.gal-count')||{}).textContent, thumbs:document.querySelectorAll('.gal-thumbs button').length, more:document.querySelectorAll('#moreGrid a').length, title:document.title, crumb:document.querySelector('#crumbCat').textContent})")
            if ver=='new':
                p.click('.gal-nav.next'); p.wait_for_timeout(300); n2=p.inner_text('.gal-count')
                check(k+' 새: 다음 사진 버튼 동작', n2.startswith('2 /'), n2)
                check(k+' 새: /api/cases/474 다시 안 부름, /api/site 안 부름', not any('/api/cases/474' in r for r in reqs) and not any('/api/site' in r for r in reqs), reqs)
                check(k+' 새: 화면 오류 없음', not errs, errs)
                check(k+' 새: 내용·같은 제품 다른 사례 표시', info['h1'] and info['more']>0, info)
                newinfo=info
            else: oldinfo=info; oldreqs=reqs
            c.close()
        check(k+' 예전과 같은 내용(제목·사진 수·다른 사례)', oldinfo==newinfo, (oldinfo,newinfo))
        a=Image.open(shots['old']).convert('RGB'); bimg=Image.open(shots['new']).convert('RGB')
        same=a.size==bimg.size and ImageChops.difference(a,bimg).getbbox() is None
        check(k+' 화면 사진이 예전과 똑같음', same, (a.size,bimg.size, None if a.size!=bimg.size else ImageChops.difference(a,bimg).getbbox()))
        print(k,'예전 API 요청:',oldreqs)
    # 자바스크립트 없이(검색 로봇처럼) 보이는 내용
    c=b.new_context(java_script_enabled=False); p=c.new_page(); p.goto('http://localhost:8787/case.html?id=474')
    txt=p.inner_text('main'); check('JS 없이도 제목·설명·사진 보임', '화물용 리프트' in txt and '불러오는 중' not in txt and p.locator('main img').count()>=2, txt[:120])
    p.screenshot(path=SP+'nojs.png', full_page=False)
    r=p.goto('http://localhost:8787/case.html?id=999999'); p2=None
    check('없는 사례: 404', r.status==404)
    c.close()
    c=b.new_context(); p=c.new_page(); errs=[]; p.on('pageerror',lambda e:errs.append(str(e))); p.goto('http://localhost:8787/case.html?id=999999'); p.wait_for_timeout(2000)
    check('없는 사례: 화면은 안내 문구', '찾는 설치사례가 없거나' in p.inner_text('#cdBody') and not errs, errs)
    c.close(); b.close()
print('결과 %d/%d'%(sum(res),len(res)))
