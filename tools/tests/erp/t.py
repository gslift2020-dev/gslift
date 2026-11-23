import json, time, urllib.request, subprocess, sys
from playwright.sync_api import sync_playwright
B='http://localhost:8787'; M='http://localhost:8799'; STATE=sys.argv[1]
res=[]
def check(n,ok,info=''): ok=bool(ok); res.append(ok); print(('PASS ' if ok else 'FAIL ')+n+('  — '+str(info)[:300] if info else ''))
r=urllib.request.urlopen(urllib.request.Request(B+'/api/admin/login',data=b'{"password":"testpass123"}',headers={'content-type':'application/json','x-gs-admin':'1','cf-connecting-ip':'9.9.9.9'}))
CK=r.headers['set-cookie'].split(';')[0]
def api(p, method='GET'):
    return json.loads(urllib.request.urlopen(urllib.request.Request(B+p,method=method,data=(b'' if method=='POST' else None),headers={'cookie':CK,'x-gs-admin':'1'})).read())
def mode(m): urllib.request.urlopen(urllib.request.Request(M+'/mode',data=m.encode(),method='POST'))
def mocklog(): return json.loads(urllib.request.urlopen(M+'/log').read())['items']
INIT="Object.defineProperty(navigator,'webdriver',{get:()=>false})"
def submit(b, i, ip, extra=None):
    c=b.new_context(extra_http_headers={'cf-connecting-ip':ip}); c.add_init_script(INIT); p=c.new_page()
    p.goto(B+'/?utm_source=naver&n_query=%ED%99%94%EB%AC%BC%EB%A6%AC%ED%94%84%ED%8A%B8'); p.wait_for_timeout(1500)
    p.locator('a[href="#contact"]').first.click(); p.wait_for_timeout(1500)
    f=p.locator('#form'); f.locator('[name=company]').fill('시험상사%d'%i); f.locator('[name=name]').fill('홍길동'); f.locator('[name=phone]').fill('0109569377%d'%i)
    if extra: extra(p)
    f.locator('[name=agree]').check(); p.locator('#formBtn').click(); p.wait_for_timeout(2500)
    msg=p.inner_text('#formMsg'); ok='문의가 접수되었습니다' in msg
    if not ok: print('   formMsg:', msg)
    c.close(); return ok
def last(): return api('/api/admin/inquiries')['items'][0]
with sync_playwright() as pw:
    b=pw.chromium.launch()
    w=b.new_page(); w.goto(B+'/?gs_staff=1',timeout=90000); w.wait_for_timeout(2000); w.close()
    # 1) 정상: 사양 많이 채워 보내기
    def fill(p):
        p.locator('[name=email]').fill('test@naver.com'); p.locator('[name=loc]').fill('인천 연수구 송도동 3-10'); p.locator('[name=message]').fill('빠른 연락주세요')
        if p.locator('#specToggle').is_visible(): p.click('#specToggle')
        p.locator('[name=load]').select_option(index=2) if p.locator('select[name=load]').count() else None
    mode('ok'); ok=submit(b,1,'10.12.0.1',fill); time.sleep(2); it=last(); lg=mocklog()
    check('1 문의 접수', ok)
    check('1 업무앱 등록됨(erp_sent=1, 번호)', it.get('erp_sent')==1 and it.get('erp_id')=='100' and it.get('erp_at'), {k:it.get(k) for k in ['erp_sent','erp_id','erp_error','erp_at']})
    p0=lg[-1]['payload'] if lg else {}
    check('1 보낸 내용: 번호·이름·연락처·이메일·주소·내용', p0.get('inquiry_no')==it['id'] and p0.get('name')=='홍길동' and p0.get('phone')=='010-0000-0000' and p0.get('email')=='test@naver.com' and p0.get('loc')=='인천 연수구 송도동 3-10' and p0.get('message')=='빠른 연락주세요' and p0.get('company')=='시험상사1', p0)
    check('1 보낸 내용: 유입 경로·검색어·방문 이력·관리자 링크·형식', p0.get('src')=='naver' and p0.get('src_label')=='네이버 광고' and p0.get('kw')=='화물리프트' and p0.get('visit',{}).get('vn')==1 and p0.get('admin_url','').endswith('#inq-%d'%it['id']) and p0.get('v')==1 and p0.get('received_at','').endswith('+09:00') and isinstance(p0.get('spec_rows'),list), {k:p0.get(k) for k in ['src','src_label','kw','visit','admin_url','received_at','spec','spec_rows']})
    # 2) 업무앱 점검 중 → 실패 기록, 문의는 정상
    mode('down'); ok=submit(b,2,'10.12.0.2'); time.sleep(2); it=last()
    check('2 업무앱 실패해도 문의 접수', ok)
    check('2 실패 기록(erp_sent=0, 이유)', it.get('erp_sent')==0 and '503' in (it.get('erp_error') or ''), it.get('erp_error'))
    # 3) 다시 보내기
    mode('ok'); d=api('/api/admin/inquiries/%d/erp'%it['id'],'POST')
    check('3 다시 보내기 → 등록', d.get('ok') and d.get('erp_sent')==1 and d.get('erp_id')=='101' and not d.get('dup'), d)
    d=api('/api/admin/inquiries/%d/erp'%it['id'],'POST')
    check('3 한 번 더 → 업무앱이 중복으로 알려 줌, 같은 번호', d.get('ok') and d.get('dup') and d.get('erp_id')=='101' and len([x for x in mocklog() if x['payload']['inquiry_no']==it['id']])==1, d)
    # 4) 응답 없음(10초)
    mode('slow'); t0=time.time(); d=api('/api/admin/inquiries/%d/erp'%(it['id']-1),'POST'); dt=time.time()-t0
    check('4 응답 없음 → 10초에 끊고 실패 기록', (not d.get('ok')) and '응답 없음' in (d.get('error') or '') and dt<14, (dt,d))
    mode('ok')
    # 5) 관리자 화면 표시·버튼
    c=b.new_context(extra_http_headers={'cookie':CK}); p=c.new_page(); errs=[]; p.on('pageerror',lambda e:errs.append(str(e)))
    p.goto(B+'/admin/'); p.wait_for_timeout(1500); p.click('[data-tab=inq]'); p.wait_for_timeout(1200)
    txt=p.inner_text('#inqList')
    check('5 관리자: 등록 표시(#번호)·실패 표시와 보내기 버튼', '업무앱 견적 대기 등록 #101' in txt and '업무앱 견적 대기 등록 #100' in txt and '업무앱 보내기 실패' in txt and p.locator('[data-erp]').count()>=1, txt[:400])
    p.locator('[data-erp]').first.click(); p.wait_for_timeout(1500)
    check('5 관리자: 버튼으로 보내기 → 등록 표시로 바뀜', p.locator('[data-erp]').count()==0 and not errs, errs)
    c.close()
    b.close()
# 6) 서명이 틀리면 업무앱이 거절 → 실패 기록 (열쇠가 다른 서버로 시험)
print('결과 %d/%d'%(sum(res),len(res)))
