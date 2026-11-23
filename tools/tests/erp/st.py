import json, time, hmac, hashlib, urllib.request, urllib.error
B='http://localhost:8787'; SECRET=b'test-secret-123'; res=[]
def check(n,ok,info=''): ok=bool(ok); res.append(ok); print(('PASS ' if ok else 'FAIL ')+n+('  — '+str(info)[:200] if info else ''))
def post(body, t=None, key=SECRET, raw=None):
    raw = raw if raw is not None else json.dumps(body, ensure_ascii=False)
    t = str(int(time.time())) if t is None else str(t)
    sig = hmac.new(key, (t+'.'+raw).encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(B+'/api/erp/inquiry-status', data=raw.encode(), method='POST', headers={'content-type':'application/json','x-gs-time':t,'x-gs-sign':sig})
    try: r=urllib.request.urlopen(req); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
r=urllib.request.urlopen(urllib.request.Request(B+'/api/admin/login',data=b'{"password":"testpass123"}',headers={'content-type':'application/json','x-gs-admin':'1','cf-connecting-ip':'9.9.9.1'}))
CK=r.headers['set-cookie'].split(';')[0]
def inq(i):
    d=json.loads(urllib.request.urlopen(urllib.request.Request(B+'/api/admin/inquiries',headers={'cookie':CK})).read())
    return [x for x in d['items'] if x['id']==i][0]
check('옛 처리중(#2) → 처리완료로 옮겨짐', inq(2)['status']=='done', inq(2)['status'])
B1={'v':1,'kind':'status','inquiry_no':3,'status':'보류','changed_at':'2026-11-13T06:10:00+00:00'}
s,d=post(B1); x=inq(3); check('서명 맞음 → 보류로 바뀜, ok', s==200 and d.get('ok') and x['status']=='hold' and x['status_by']=='erp' and x['erp_status_at']=='2026-11-13T06:10:00.000Z', (s,d,x['status'],x.get('status_by'),x.get('erp_status_at')))
s,d=post(B1); check('같은 것 다시 → ok, 그대로', s==200 and d.get('ok') and inq(3)['status']=='hold', (s,d))
s,d=post({**B1,'status':'처리완료','changed_at':'2026-11-13T06:20:00+00:00'}); check('더 새 상태 → 처리완료', s==200 and inq(3)['status']=='done', (s,d))
s,d=post({**B1,'status':'신규','changed_at':'2026-11-13T06:15:00+00:00'}); check('늦게 온 옛 상태 → ok지만 안 바뀜', s==200 and d.get('ok') and inq(3)['status']=='done', (s,d))
s,d=post({**B1,'status':'휴지통','changed_at':'2026-11-13T07:00:00+00:00'}); check('휴지통', s==200 and inq(3)['status']=='trash')
s,d=post({**B1,'status':'신규','changed_at':'2026-11-13T07:05:00+00:00'}); check('되살리기 → 신규', s==200 and inq(3)['status']=='new')
s,d=post(B1, key=b'wrong'); check('서명 틀림 → 401', s==401, (s,d))
s,d=post(B1, t=int(time.time())-360); check('시각 6분 차이 → 401', s==401, (s,d))
s,d=post(B1, t=int(time.time())+360); check('시각 6분 앞 → 401', s==401, (s,d))
s,d=post({**B1,'v':2}); check('v 다름 → 400', s==400, (s,d))
s,d=post({**B1,'kind':'x'}); check('kind 다름 → 400', s==400, (s,d))
s,d=post({**B1,'status':'처리중'}); check('없는 상태 → 400', s==400, (s,d))
s,d=post(None, raw='{bad'); check('JSON 아님 → 400', s==400, (s,d))
s,d=post({**B1,'inquiry_no':99999}); check('없는 문의 번호 → 422', s==422 and '문의 번호 없음' in d.get('error',''), (s,d))
req=urllib.request.Request(B+'/api/erp/inquiry-status')
try: urllib.request.urlopen(req); code=200
except urllib.error.HTTPError as e: code=e.code
check('GET → 405', code==405)
# 관리자가 손으로 바꾼 뒤 같은 업무앱 바뀜이 다시 와도 덮지 않음
B2={**B1,'status':'보류','changed_at':'2026-11-13T08:00:00+00:00'}; post(B2)
urllib.request.urlopen(urllib.request.Request(B+'/api/admin/inquiries/3',data=json.dumps({'status':'done'}).encode(),method='POST',headers={'cookie':CK,'x-gs-admin':'1','content-type':'application/json'}))
s,d=post(B2); x=inq(3); check('관리자가 손으로 바꾼 뒤 같은 바뀜 재전송 → 덮지 않음', x['status']=='done' and x['status_by'] is None, (d,x['status'],x['status_by']))
s,d=post({**B2,'status':'휴지통','changed_at':'2026-11-13T09:00:00+00:00'}); check('업무앱이 나중에 다른 상태 → 덮음', inq(3)['status']=='trash')
print('결과 %d/%d'%(sum(res),len(res)))
