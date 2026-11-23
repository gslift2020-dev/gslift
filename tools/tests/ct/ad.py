import json, urllib.request, urllib.parse as U
from playwright.sync_api import sync_playwright
BASE='http://localhost:8787'; INIT="Object.defineProperty(navigator,'webdriver',{get:()=>false})"
res=[]
def check(n,ok,info=''): res.append(ok); print(('PASS ' if ok else 'FAIL ')+n+('  — '+str(info) if info else ''))
r=urllib.request.urlopen(urllib.request.Request(BASE+'/api/admin/login',data=b'{"password":"testpass123"}',headers={'content-type':'application/json','x-gs-admin':'1','cf-connecting-ip':'9.9.9.9'}))
CK=r.headers['set-cookie'].split(';')[0]
def api(p): return json.loads(urllib.request.urlopen(urllib.request.Request(BASE+p,headers={'cookie':CK})).read())
E=U.quote
cases=[
 ('네이버 광고','/?utm_source=naver&utm_medium=cpc&n_media=27758&n_query='+E('화물용리프트')+'&n_rank=2&n_ad_group=grp-a001-01-000000012345&n_ad=nad-a001&n_keyword_id=nkw-1&n_keyword='+E('화물용 리프트')+'&n_campaign_type=1',
   {'src':'네이버 광고','kw':'화물용리프트','adkw':'화물용 리프트'}, {'src':'naver','kw':'화물용리프트'}),
 ('카카오 광고 k_query','/?utm_source=kakao&k_query='+E('테이블 리프트 가격')+'&k_keyword='+E('테이블리프트가격')+'&k_keyword_type=EXACT',
   {'src':'카카오 광고','kw':'테이블 리프트 가격','adkw':'테이블리프트가격'}, {'src':'kakao','kw':'테이블 리프트 가격'}),
 ('카카오 utm_term만','/?utm_source=kakao&utm_term='+E('화물승강기'),
   {'src':'카카오 광고','kw':'화물승강기','adkw':''}, {'src':'kakao','kw':'화물승강기'}),
 ('utm_source 없이 k_ 만','/?k_query='+E('리프트견적')+'&k_keyword='+E('리프트견적'),
   {'src':'카카오 광고','kw':'리프트견적'}, {'src':'kakao','kw':'리프트견적'}),
 ('두 번 인코딩','/?utm_source=naver&n_media=27758&n_query='+E(E('산업용리프트')),
   {'src':'네이버 광고','kw':'산업용리프트'}, {'src':'naver','kw':'산업용리프트'}),
 ('깨진 값 %ZZ','/?utm_source=naver&n_query=%ZZ%ED%99',
   {'src':'네이버 광고','kw':''}, {'src':'naver'}),
 ('+ 를 띄어쓰기로','/?utm_source=naver&n_media=1&n_query=%ED%99%94%EB%AC%BC+%EB%A6%AC%ED%94%84%ED%8A%B8',
   {'kw':'화물 리프트'}, {'src':'naver','kw':'화물 리프트'}),
 ('EUC-KR(다른 인코딩) 값','/?utm_source=naver&n_media=1&n_query=%C8%AD%B9%B0',
   {'src':'네이버 광고','kw':''}, {'src':'naver'}),
 ('<script> 검색어','/?utm_source=naver&n_media=1&n_query='+E('<script>alert(1)</script>'),
   {'src':'네이버 광고','kw':'<script>alert(1)</script>'}, {'src':'naver','kw':'script alert(1) /script'}),
 ('카카오 랜딩 설치사례 목록','/cases.html?cat=tl&utm_source=kakao&k_query='+E('이동식 테이블리프트')+'&k_keyword='+E('이동식테이블리프트'),
   {'src':'카카오 광고','kw':'이동식 테이블리프트'}, None),
 ('견적 바로가기 ?to=contact','/?to=contact&utm_source=naver&n_media=27758&n_query='+E('화물리프트 견적')+'&n_keyword='+E('리프트견적'),
   {'src':'네이버 광고','kw':'화물리프트 견적','adkw':'리프트견적'}, {'src':'naver','kw':'화물리프트 견적'}),
 ('광고 아님(직접)','/', {'src':'직접 입력·즐겨찾기','kw':'','adkw':''}, {'src':'direct','kw':None}),
]
with sync_playwright() as pw:
    b=pw.chromium.launch()
    w=b.new_page(); w.goto(BASE+'/?gs_staff=1', timeout=60000); w.wait_for_timeout(3000); w.goto(BASE+'/cases.html', timeout=60000); w.wait_for_timeout(2000); w.close()  # 시험 서버 데우기(직원 표시라 방문 기록 비교에서 빠짐)
    for i,(name,url,vexp,iexp) in enumerate(cases):
        c=b.new_context(extra_http_headers={'cf-connecting-ip':'10.9.0.%d'%(i+1)}); c.add_init_script(INIT); p=c.new_page()
        errs=[]; p.on('pageerror',lambda e:errs.append(str(e)))
        p.goto(BASE+url); p.wait_for_timeout(2500)
        landed=p.evaluate("location.pathname+location.search")
        if url.startswith('/cases'):
            n=p.locator('.cl-card').count(); check(name+' · 목록 정상', not errs, (landed, 'cards', n, errs))
        else:
            if 'to=contact' in url:
                top=p.evaluate("Math.round(document.getElementById('contact').getBoundingClientRect().top)")
                check(name+' · 견적 구역으로 이동', 0<=top<=120, ('top', top))
            else:
                p.locator('a[href="#contact"]').first.click(); p.wait_for_timeout(2500)
                top=p.evaluate("Math.round(document.getElementById('contact').getBoundingClientRect().top)")
                check(name+' · 견적 버튼 동작', 0<=top<=120, ('top', top))
            check(name+' · 주소 정리·화면 오류 없음', landed=='/' and not errs, (landed, errs))
            f=p.locator('#form'); f.locator('[name=name]').fill('시험%d'%i); f.locator('[name=phone]').fill('0101234567%d'%i); f.locator('[name=agree]').check()
            p.locator('#formBtn').click(); p.wait_for_timeout(2500)
            okmsg='문의가 접수되었습니다' in p.inner_text('#formMsg')
            it=api('/api/admin/inquiries')['items'][0]; sp=dict(it['spec'])
            src_line=sp.get('유입 경로','')
            want=(iexp.get('src') or src_line.split(' · ')[0])+(' · 검색어: '+iexp['kw'] if iexp.get('kw') else '')
            check(name+' · 문의 접수·유입 경로', okmsg and src_line==want, (src_line, want))
        c.close()
    b.close()
vs={}
for v in api('/api/admin/visits?range=today')['items']:
    vs.setdefault(v['landing']['path'],[]).append(v)
allv=[v for v in api('/api/admin/visits?range=today')['items'] if v.get('cls')!='staff']
print('방문 기록 수', len(allv))
for i,(name,url,vexp,iexp) in enumerate(reversed(cases)):
    pass
# match visits by order (oldest first)
allv=list(reversed(allv))
for (name,url,vexp,iexp),v in zip(cases, allv):
    ok=all(v.get(k,'')==val for k,val in vexp.items())
    check(name+' · 방문 기록', ok, {k:v.get(k) for k in ['src','kw','adkw','ad']})
print('합계', sum(res), '/', len(res))
