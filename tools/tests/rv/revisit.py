import json, time, urllib.request, urllib.parse as U, subprocess, sys
from playwright.sync_api import sync_playwright
BASE='http://localhost:8787'; INIT="Object.defineProperty(navigator,'webdriver',{get:()=>false})"
SP=sys.argv[1]; STATE=sys.argv[2]
res=[]
def check(n,ok,info=''): ok=bool(ok); res.append(ok); print(('PASS ' if ok else 'FAIL ')+n+('  — '+str(info) if info else ''))
r=urllib.request.urlopen(urllib.request.Request(BASE+'/api/admin/login',data=b'{"password":"testpass123"}',headers={'content-type':'application/json','x-gs-admin':'1','cf-connecting-ip':'9.9.9.9'}))
CK=r.headers['set-cookie'].split(';')[0]
def api(p): return json.loads(urllib.request.urlopen(urllib.request.Request(BASE+p,headers={'cookie':CK})).read())
def sql(q):
    out=subprocess.run(['/home/claude/wt/node_modules/.bin/wrangler','d1','execute','gslift-db','--local','--persist-to',STATE,'--json','--command',q],capture_output=True,text=True,cwd='/home/claude/gslift')
    try: return json.loads(out.stdout)[0]['results']
    except Exception: print(out.stdout[-500:], out.stderr[-500:]); return []
def hit(body, ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', ip='10.50.0.1'):
    urllib.request.urlopen(urllib.request.Request(BASE+'/api/hit',data=json.dumps(body).encode(),headers={'content-type':'text/plain','user-agent':ua,'cf-connecting-ip':ip}))
E=U.quote
def gsu(p): return p.evaluate("JSON.parse(localStorage.getItem('gs_u')||'null')")
def age_visit(p, ms):
    p.goto(BASE+'/robots.txt')  # 추적 코드가 없는 페이지로 나간 뒤(나갈 때 저장이 끝난 뒤) 시간을 되돌림
    p.evaluate("(ms)=>{var v=JSON.parse(localStorage.getItem('gs_v'));v.t-=ms;localStorage.setItem('gs_v',JSON.stringify(v))}", ms)
def last_visit(): return sql("SELECT vid, src, kw, vn, f_at, f_src, f_kw, f_adkw, f_pre, uid, who FROM visits ORDER BY id DESC LIMIT 1")[0]
def submit(p, i):
    p.locator('a[href="#contact"]').first.click(); p.wait_for_timeout(1800)
    f=p.locator('#form'); f.locator('[name=name]').fill('재방문%d'%i); f.locator('[name=phone]').fill('0101112222%d'%i); f.locator('[name=agree]').check()
    p.locator('#formBtn').click(); p.wait_for_timeout(2500)
    return '문의가 접수되었습니다' in p.inner_text('#formMsg')

with sync_playwright() as pw:
    b=pw.chromium.launch()
    w=b.new_page(); w.goto(BASE+'/?gs_staff=1', timeout=90000); w.wait_for_timeout(3000); w.close()
    # 1) 네이버 광고 첫 방문 → 같은 방문 안 이동
    c=b.new_context(extra_http_headers={'cf-connecting-ip':'10.60.0.1'}); c.add_init_script(INIT); p=c.new_page(); errs=[]; p.on('pageerror',lambda e:errs.append(str(e)))
    p.goto(BASE+'/?utm_source=naver&n_media=27758&n_query='+E('화물리프트')+'&n_keyword='+E('화물 리프트')); p.wait_for_timeout(2000)
    u=gsu(p); check('1 첫 방문 n=1·첫 주소 저장', u and u['n']==1 and 'n_query' in u['f']['p'] and not u['f'].get('pre') and len(u['id'])>=8, u)
    v=last_visit(); check('1 서버: vn=1, 첫 방문 칸은 비움, uid 저장', v['vn']==1 and v['f_src'] is None and v['uid']==u['id'], v)
    p.goto(BASE+'/cases.html'); p.wait_for_timeout(1500)
    check('1 30분 안 이동 → n 그대로', gsu(p)['n']==1)
    # 2) 31분 뒤 즐겨찾기로 재방문
    age_visit(p, 31*60*1000); first_id=u['id']
    p.goto(BASE+'/'); p.wait_for_timeout(2000)
    u2=gsu(p); check('2 31분 뒤 → n=2, 첫 정보·번호 그대로', u2['n']==2 and u2['f']==u['f'] and u2['id']==first_id, u2)
    v=last_visit(); check('2 서버: vn=2 · 첫 경로 네이버 광고 · 검색어 · 키워드', v['vn']==2 and v['src']=='직접 입력·즐겨찾기' and v['f_src']=='네이버 광고' and v['f_kw']=='화물리프트' and v['f_adkw']=='화물 리프트' and v['f_at'] and v['uid']==first_id, v)
    vs=api('/api/admin/visits?range=today')['items']; mine=[x for x in vs if x.get('uid')==first_id]
    check('2 관리자 최근 방문: 2번째 방문 + 첫 방문 정보', any(x['vn']==2 and x['first'] and x['first']['src']=='네이버 광고' for x in mine) and any(x['vn']==1 for x in mine), [(x['vn'],x['first']) for x in mine])
    # 3) 문의
    ok=submit(p, 3); it=api('/api/admin/inquiries')['items'][0]; sp=dict(it['spec'])
    line=sp.get('방문 이력','')
    check('3 문의 접수 + 방문 이력 문장', ok and line.startswith('첫 방문 ') and "네이버 광고 '화물리프트' → 이번엔 직접 입력·즐겨찾기로 2번째 방문에 문의" in line, line)
    check('3 유입 경로·광고 검색어 저장은 그대로', sp.get('유입 경로')=='direct', sp.get('유입 경로'))
    check('3 문의에 손님 번호(방문 모두 보기)', it.get('visitor') and it['visitor']['uid']==first_id, it.get('visitor'))
    wv=api('/api/admin/visitor?uid=%s&from=%s'%(first_id, it['visitor']['from']))
    check('3 이 손님 방문 모두 보기: 2건, 2번째에 문의', wv['ok'] and len(wv['items'])==2 and wv['items'][1]['inquiry']==it['id'] and wv['items'][0]['src']=='네이버 광고', [(x['vn'],x['src'],x['inquiry']) for x in wv['items']])
    st=api('/api/admin/stats'); srcs={x['src']:x for x in st['sources']}
    check('3 경로별: 직접 문의 1 · 네이버 광고 첫 경로 1', srcs.get('직접 입력·즐겨찾기',{}).get('inq')==1 and srcs.get('직접 입력·즐겨찾기',{}).get('finq')==0 and srcs.get('네이버 광고',{}).get('finq')==1, {k:(x['n'],x['inq'],x['finq']) for k,x in srcs.items()})
    check('1~3 화면 오류 없음', not errs, errs)
    # 4) 366일 지난 값 → 새로 시작 (기록 전 방문 있음 표시)
    age_visit(p, 31*60*1000); p.evaluate("()=>{var u=JSON.parse(localStorage.getItem('gs_u'));u.l-=366*864e5;localStorage.setItem('gs_u',JSON.stringify(u))}")
    p.goto(BASE+'/?utm_source=kakao&k_query='+E('테이블리프트')); p.wait_for_timeout(2000)
    u4=gsu(p); check('4 366일 지남 → n=1 새 번호, pre=1', u4['n']==1 and u4['id']!=first_id and u4['f'].get('pre')==1, u4)
    v=last_visit(); check('4 서버: vn=1 · f_pre=1', v['vn']==1 and v['f_pre']==1, v)
    c.close()
    # 5) 이 기능 전부터 오던 손님 (gs_v만 있음)
    c=b.new_context(extra_http_headers={'cf-connecting-ip':'10.60.0.5'}); c.add_init_script(INIT); p=c.new_page()
    p.goto(BASE+'/robots.txt'); p.evaluate("()=>{localStorage.removeItem('gs_u');localStorage.setItem('gs_v',JSON.stringify({id:'oldvisitor123',t:Date.now()-5*864e5,d:0,s:0,a:0,e:1}))}")
    p.goto(BASE+'/'); p.wait_for_timeout(1500)
    u5=gsu(p); check('5 기능 전 손님 → n=1·pre=1', u5['n']==1 and u5['f'].get('pre')==1, u5)
    c.close()
    # 6) 직원 기기
    c=b.new_context(extra_http_headers={'cf-connecting-ip':'10.60.0.6'}); c.add_init_script(INIT); p=c.new_page()
    p.goto(BASE+'/?gs_staff=1'); p.wait_for_timeout(1500); age_visit(p, 31*60*1000); p.goto(BASE+'/'); p.wait_for_timeout(1500)
    v=last_visit(); check('6 직원 기기 → gs_u 없음·서버 vn 없음', gsu(p) is None and v['who']=='staff' and v['vn'] is None and v['uid'] is None, (gsu(p), v))
    c.close()
    # 7) 저장이 막힌 브라우저
    c=b.new_context(extra_http_headers={'cf-connecting-ip':'10.60.0.7'}); c.add_init_script(INIT); c.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}})")
    p=c.new_page(); errs=[]; p.on('pageerror',lambda e:errs.append(str(e)))
    p.goto(BASE+'/'); p.wait_for_timeout(2000); ok=submit(p, 7)
    it=api('/api/admin/inquiries')['items'][0]; sp=dict(it['spec'])
    check('7 저장 막힘 → 홈페이지·문의 정상, 방문 이력 없음, 오류 0', ok and not errs and '방문 이력' not in sp and not it.get('visitor'), (ok, errs, sp))
    c.close()
    # 8) 이상한 값 (신호 직접)
    bad=[('n 글자', {'n':'abc'}), ('미래 날짜', {'n':5,'t':int(time.time()*1000)+86400e3,'p':'/?utm_source=naver','id':'abcdefgh12'}),
         ('500일 전', {'n':5,'t':int(time.time()*1000)-500*864e5,'p':'/','id':'abcdefgh12'}), ('주소가 / 로 시작 안 함', {'n':3,'t':int(time.time()*1000)-864e5,'p':'javascript:alert(1)','id':'abcdefgh12'}),
         ('번호에 이상한 글자', {'n':2,'t':int(time.time()*1000)-864e5,'p':'/','id':'<script>'}), ('아주 긴 주소', {'n':2,'t':int(time.time()*1000)-864e5,'p':'/?q='+'x'*500,'id':'abcdefgh12'}),
         ('<script> 검색어', {'n':2,'t':int(time.time()*1000)-864e5,'p':'/?utm_source=naver&n_query='+E('<script>x</script>'),'id':'abcdefgh13'})]
    for i,(name,u) in enumerate(bad):
        vid='badvisit%02d'%i; hit({'p':'/','r':'','v':vid,'f':1,'u':u}, ip='10.70.0.%d'%i)
        v=sql("SELECT vn, f_at, f_src, f_kw, uid FROM visits WHERE vid='%s'"%vid)
        v=v[0] if v else None
        if name=='n 글자': ok=v and v['vn'] is None
        elif name in ('미래 날짜','500일 전','주소가 / 로 시작 안 함','아주 긴 주소'): ok=v and v['vn'] in (5,3,2) and v['f_at'] is None
        elif name=='번호에 이상한 글자': ok=v and v['vn']==2 and v['uid'] is None and v['f_src']
        else: ok=v and v['f_kw']=='<script>x</script>'
        check('8 이상한 값: '+name, ok, v)
    vs=api('/api/admin/visits?range=today')['items']
    # 관리자 화면에서 글자로만 보이는지
    c=b.new_context(extra_http_headers={'cookie':CK}); p=c.new_page(); errs=[]; p.on('pageerror',lambda e:errs.append(str(e))); dialogs=[]; p.on('dialog',lambda d:(dialogs.append(d.message), d.dismiss()))
    p.goto(BASE+'/admin/'); p.wait_for_timeout(3000)
    p.uncheck('#vHideBot'); p.wait_for_timeout(300)
    txt=p.inner_text('#vList'); check('8 관리자: <script>가 글자로만 보임, 오류·창 없음', "'<script>x</script>'" in txt and not errs and not dialogs, (errs, dialogs))
    # 방문 모두 보기 창
    btn=p.locator('#vList .vwho').first; btn.click(); p.wait_for_timeout(1200)
    shown=p.locator('#whoBox').is_visible(); n=p.locator('#whoBox .wlist li').count()
    check('관리자: 이 손님 방문 모두 보기 창', shown and n>=1, n)
    p.locator('#whoBox [data-close]').first.click(); p.wait_for_timeout(200)
    check('관리자: 창 닫기', not p.locator('#whoBox').is_visible())
    c.close()
    # 9) 문의에 이상한 u
    c=b.new_context(extra_http_headers={'cf-connecting-ip':'10.60.0.9'}); c.add_init_script(INIT); p=c.new_page(); p.goto(BASE+'/'); p.wait_for_timeout(1500)
    p.evaluate("()=>{window.GSTrack.u=function(){return '{bad json'+'x'.repeat(3000)}}")
    ok=submit(p, 9); it=api('/api/admin/inquiries')['items'][0]
    check('9 문의에 깨진 재방문 값 → 문의 정상, 방문 이력 없음', ok and '방문 이력' not in dict(it['spec']), dict(it['spec']))
    c.close()
    b.close()
print('결과: %d/%d 통과'%(sum(res),len(res)))
