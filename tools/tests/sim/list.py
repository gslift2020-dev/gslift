from playwright.sync_api import sync_playwright
SP='/tmp/claude-0/-home-claude/4fc16c7d-9cdb-565e-95a5-a802f1b4a34a/scratchpad/sim/'
res=[]
def check(n,ok,info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n+('  — '+str(info) if info else ''))
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for mob in [True,False]:
        k='휴대폰' if mob else 'PC'
        c=b.new_context(viewport={'width':390,'height':844} if mob else {'width':1280,'height':900},is_mobile=mob,has_touch=mob)
        p=c.new_page(); errs=[]; api=[]
        p.on('pageerror',lambda e:errs.append(str(e)))
        p.on('request',lambda r: '/api/cases' in r.url and api.append(r.url.split('8787')[-1]))
        p.goto('http://localhost:8787/cases.html?cat=tl'); p.wait_for_timeout(1500)
        info=p.evaluate("""({n:document.querySelectorAll('#clGrid .cl-card').length, first:document.querySelector('#clGrid .cl-card b').textContent,
           on:document.querySelector('#clTabs .on').dataset.cat, cnt:[...document.querySelectorAll('#clTabs [data-cat] i')].map(i=>i.textContent).join(','),
           tags:!document.getElementById('clTags').hidden, info:document.getElementById('clPageInfo').textContent, pg:document.querySelectorAll('#clPager .pg').length,
           deco:getComputedStyle(document.querySelector('#clTabs a')).textDecorationLine, h1:document.querySelector('h1').textContent})""")
        print(k,info)
        check(k+': 처음 열 때 목록 API 안 부름', len(api)==0, api)
        check(k+': 테이블 리프트 20건 · 탭 표시 · 개수', info['n']==20 and info['on']=='tl' and info['cnt'].count(',')==3 and '' not in info['cnt'].split(','), info['cnt'])
        check(k+': 꼬리표 찾기·쪽 정보 그려짐', info['tags'] and '56건' in info['info'] and info['pg']>3, info['info'])
        check(k+': 탭 밑줄 없음', info['deco']=='none', info['deco'])
        p.screenshot(path=SP+'list_%s.png'%('m' if mob else 'pc'))
        # 탭 누르기 → 페이지 안에서 바뀜
        p.click('#clTabs [data-cat="fl"]'); p.wait_for_timeout(1500)
        r=p.evaluate("[location.search, document.querySelector('#clTabs .on').dataset.cat, document.querySelectorAll('#clGrid .cl-card').length]")
        check(k+': 화물용 탭 누르면 주소·목록 바뀜(새로 고침 없이)', r[0]=='?cat=fl' and r[1]=='fl' and r[2]==20 and len(api)==1, (r,api))
        # 쪽 번호 2
        p.click('#clPager a.pg[data-page="2"]'); p.wait_for_timeout(1500)
        check(k+': 2쪽', p.evaluate("location.search")=='?cat=fl&page=2', p.evaluate("location.search"))
        p.go_back(); p.wait_for_timeout(1200)
        check(k+': 뒤로가기 → 1쪽', p.evaluate("location.search")=='?cat=fl')
        # 꼬리표 하나 고르기
        p.evaluate("document.getElementById('clTags').classList.add('open')")
        p.click('#clTagGroups .tg[data-k="ext"]'); p.wait_for_timeout(1500)
        check(k+': 꼬리표 고르기', 'tag=ext' in p.evaluate("location.search"), p.evaluate("location.search"))
        # 검색
        p.fill('#clQ','식품'); p.wait_for_timeout(1500)
        check(k+': 검색', 'q=' in p.evaluate("location.search") and p.evaluate("document.querySelectorAll('#clGrid .cl-card').length")>=0)
        # 페이지 2를 바로 열기 (미리 담은 자료 = 2쪽)
        api.clear(); p.goto('http://localhost:8787/cases.html?cat=fl&page=2'); p.wait_for_timeout(1500)
        check(k+': 2쪽 바로 열기도 API 안 부름 · 20건', len(api)==0 and p.evaluate("document.querySelectorAll('#clGrid .cl-card').length")==20, api)
        # 없는 쪽 → 마지막 쪽으로
        api.clear(); p.goto('http://localhost:8787/cases.html?cat=st&page=9'); p.wait_for_timeout(1500)
        check(k+': 없는 쪽 → 마지막 쪽', p.evaluate("location.search")=='?cat=st' and p.evaluate("document.querySelectorAll('#clGrid .cl-card').length")==4, (p.evaluate("location.search"),api))
        # 새 탭 클릭(ctrl)은 기본 동작 유지 — 링크 주소 확인
        check(k+': 탭 링크 주소', p.evaluate("[...document.querySelectorAll('#clTabs a')].map(a=>a.getAttribute('href')).join(' ')")=='/cases.html /cases.html?cat=fl /cases.html?cat=tl /cases.html?cat=st')
        # JS 꺼진 것처럼: 서버 HTML만으로 카드·링크
        check(k+': 화면 오류 없음', not errs, errs)
        c.close()
    # 자바스크립트 없이(검색 로봇이 HTML만 볼 때)
    c=b.new_context(java_script_enabled=False); p=c.new_page(); p.goto('http://localhost:8787/cases.html?cat=fl')
    r=p.evaluate if False else None
    n=p.locator('#clGrid .cl-card').count(); h=p.locator('h1').inner_text(); links=p.locator('#clGrid a[href^="/case.html?id="]').count()
    check('자바스크립트 없이도 카드 20개·상세 링크·큰 제목', n==20 and links==20 and '화물용' in h, (n,links,h))
    b.close()
print('결과 %d/%d'%(sum(res),len(res)))
