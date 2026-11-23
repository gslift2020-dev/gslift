from playwright.sync_api import sync_playwright
SP='/tmp/claude-0/-home-claude/4fc16c7d-9cdb-565e-95a5-a802f1b4a34a/scratchpad/sim/'
res=[]
def check(n,ok,info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n+('  — '+str(info) if info else ''))
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for mob in [True,False]:
        k='m' if mob else 'pc'
        c=b.new_context(viewport={'width':390,'height':844} if mob else {'width':1280,'height':900}, is_mobile=mob, has_touch=mob, extra_http_headers={'cf-connecting-ip':'10.77.0.%d'%(1 if mob else 2)})
        p=c.new_page(); errs=[]; reqs=[]
        p.on('pageerror',lambda e:errs.append(str(e))); p.on('request',lambda r: '/api/' in r.url and reqs.append(r.url.split('8787')[-1]))
        for cid in [411,473,5]:
            reqs.clear()
            p.goto('http://localhost:8787/case.html?id=%d'%cid); p.wait_for_timeout(2500)
            p.evaluate("document.querySelectorAll('.cd-more-grid img').forEach(i=>i.loading='eager')"); p.wait_for_timeout(800)
            info=p.evaluate("""({title:document.querySelector('#moreTitle').textContent, sub:(document.querySelector('#moreSub')||{}).textContent, n:document.querySelectorAll('#moreGrid a').length,
              cards:[...document.querySelectorAll('#moreGrid a')].map(a=>a.querySelector('b').textContent.slice(0,30)+' | '+((a.querySelector('.cd-more-tags')||{}).textContent||'')),
              go:document.querySelector('#mbarGo').getAttribute('href'), cols:getComputedStyle(document.querySelector('#moreGrid')).gridTemplateColumns,
              bar:[...document.querySelectorAll('.mbar a')].map(a=>[a.textContent.trim(),Math.round(a.getBoundingClientRect().width), getComputedStyle(a).display]),
              barShown:getComputedStyle(document.querySelector('.mbar')).display})""")
            print(k,cid,info['title'],'/',info['sub']); [print('   ',x) for x in info['cards']]
            check(k+' %d: 비슷한 사례 4개'%cid, info['n']==4)
            check(k+' %d: 자기 자신 안 나옴'%cid, all(('id=%d"'%cid) not in h for h in p.eval_on_selector_all('#moreGrid a','els=>els.map(e=>e.outerHTML)')))
            check(k+' %d: 견적 문의 버튼에 제품 미리 고름'%cid, info['go'].startswith('/?to=contact&product='), info['go'])
            check(k+' %d: API 요청 1번(+사진 없음)'%cid, len([r for r in reqs if '/api/cases' in r])==1 and not any('/api/site' in r for r in reqs), reqs)
            if mob:
                check(k+' %d: 아래 줄 5칸 고르게'%cid, len(info['bar'])==5 and min(w for _,w,_ in info['bar'])>60, info['bar'])
                check(k+' %d: 비슷한 사례 2줄 배치'%cid, len(info['cols'].split())==2, info['cols'])
            else:
                check(k+' %d: PC는 아래 줄 숨김'%cid, info['barShown']=='none')
            p.screenshot(path=SP+'%s_%d.png'%(k,cid), full_page=True)
        p.goto('http://localhost:8787/cases.html'); p.wait_for_timeout(2000)
        bar=p.evaluate("[...document.querySelectorAll('.mbar a')].map(a=>[a.textContent.trim(),a.className,Math.round(a.getBoundingClientRect().width)])")
        if mob: check(k+' 목록: 아래 줄 5칸 · 설치사례 표시', len(bar)==5 and 'cur' in bar[2][1], bar)
        p.screenshot(path=SP+'%s_list.png'%k)
        check(k+' 화면 오류 없음', not errs, errs)
        if mob:
            # 아래 줄 '제품' → 첫 화면 제품 구역
            p.goto('http://localhost:8787/case.html?id=473'); p.wait_for_timeout(1500)
            p.click('.mbar a[data-sec="products"]'); p.wait_for_timeout(3500)
            top=p.evaluate("Math.round(document.getElementById('products').getBoundingClientRect().top)")
            check('제품 버튼 → 첫 화면 제품 구역', abs(top)<120 and p.url.endswith('8787/'), (p.url,top))
            p.goto('http://localhost:8787/case.html?id=473'); p.wait_for_timeout(1500)
            p.click('#mbarGo'); p.wait_for_timeout(3500)
            v=p.evaluate("[Math.round(document.getElementById('contact').getBoundingClientRect().top), document.querySelector('#form select[name=product]').value]")
            check('견적 문의 버튼 → 문의 구역 + 화물용 미리 고름', abs(v[0])<120 and '화물' in v[1], v)
            p.goto('http://localhost:8787/'); p.wait_for_timeout(1500)
            hb=p.evaluate("[...document.querySelectorAll('.mbar a')].map(a=>a.textContent.trim()+':'+a.getAttribute('href'))")
            check('첫 화면 아래 줄 그대로', hb==['전화 문의:tel:031-986-5345','제품:#products','설치사례:#cases','자주 묻는 질문:#faq','견적 문의:#contact'] or len(hb)==5, hb)
            p.screenshot(path=SP+'m_home.png')
        c.close()
    b.close()
print('결과 %d/%d'%(sum(res),len(res)))
