import json, time, sys, os, urllib.request, http.cookiejar
from playwright.sync_api import sync_playwright
BASE='http://localhost:8787'; CT=os.environ.get('CT_DIR','/home/claude/ttdata/ct/')  # 시험 사진 폴더 (README)
INIT="Object.defineProperty(navigator,'webdriver',{get:()=>false})"
results=[]; errs=[]
def check(name, ok, info=''):
    results.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ')+name+('  — '+str(info) if info else ''))
# 관리자 쿠키로 접수된 문의 읽기
r=urllib.request.urlopen(urllib.request.Request(BASE+'/api/admin/login',data=b'{"password":"testpass123"}',headers={'content-type':'application/json','x-gs-admin':'1','cf-connecting-ip':'9.9.9.9'}))
CK=r.headers['set-cookie'].split(';')[0]
def inquiries():
    return json.loads(urllib.request.urlopen(urllib.request.Request(BASE+'/api/admin/inquiries',headers={'cookie':CK})).read())['items']
def count(): return len(inquiries())
ipn=[60]
def ctx(b, mobile=False):
    ipn[0]+=1
    c=b.new_context(viewport={'width':390,'height':844} if mobile else {'width':1280,'height':900}, is_mobile=mobile, extra_http_headers={'cf-connecting-ip':'10.0.0.%d'%ipn[0]})
    c.add_init_script(INIT); p=c.new_page(); p.on('pageerror',lambda e:errs.append(str(e)))
    posts=[]; p.on('request', lambda r: posts.append(r) if r.url.endswith('/api/contact') else None)
    p.goto(BASE+'/'); p.wait_for_timeout(1200); p.locator('#contact').scroll_into_view_if_needed(); p.wait_for_timeout(700)
    return c,p,posts
def fill_min(p, name='홍길동', phone='01012345678'):
    f=p.locator('#form'); f.locator('[name=name]').fill(name); f.locator('[name=phone]').fill(phone); f.locator('[name=agree]').check()
def submit(p, wait=2500):
    p.locator('#formBtn').click(); p.wait_for_timeout(wait); return p.inner_text('#formMsg')
OKMSG='문의가 접수되었습니다'
with sync_playwright() as pw:
    b=pw.chromium.launch()
    # A~E: 막아야 하는 입력 (서버로 안 나가야 함)
    c,p,posts=ctx(b)
    m=submit(p,800); check('A 빈칸 제출 → 담당자명 안내, 전송 없음', '담당자명' in m and not posts, m)
    p.locator('[name=name]').fill('홍길동'); m=submit(p,800); check('B 연락처 없음 → 연락처 안내', '연락처' in m and not posts, m)
    p.locator('[name=phone]').fill('010123'); m=submit(p,800); check('C 짧은 연락처 → 연락처 안내', '연락처' in m and not posts, m)
    p.locator('[name=phone]').fill('01012345678'); p.locator('[name=email]').fill('abc@'); m=submit(p,800); check('D 잘못된 이메일 → 이메일 안내', '이메일' in m and not posts, m)
    p.locator('[name=email]').fill(''); m=submit(p,800); check('E 동의 안 함 → 동의 안내', '동의' in m and not posts, m)
    c.close()
    # F 최소 입력 정상 접수
    n0=count(); c,p,posts=ctx(b); fill_min(p); m=submit(p)
    it=inquiries()[0]; check('F 이름·연락처·동의만 → 접수', OKMSG in m and count()==n0+1 and it['phone']=='010-1234-5678', (m[:20], it['phone']))
    c.close()
    # G 모든 칸 + 사진 3장(14MB 큰 사진 포함) + 실내 + Z + 특수문자
    n0=count(); c,p,posts=ctx(b); f=p.locator('#form')
    f.locator('[name=company]').fill('(주)<b>테스트</b> & "따옴표"'); fill_min(p,'김철수','0319865345')
    f.locator('[name=email]').fill('kim@test.co.kr'); p.select_option('select[name=product]','테이블 리프트 (T/L)')
    f.locator('[name=loc]').fill('경기 김포시 양촌읍'); p.locator('.dir-opt:has(input[value="Z방향 (층마다 반대쪽)"])').click()
    p.select_option('select[name=load]','2톤'); p.select_option('select[name=stops]','3개 층'); f.locator('[name=travel]').fill('9.5')
    p.select_option('select[name=place]','건물 실내'); p.select_option('select[name=hole]','공사 중'); p.select_option('select[name=pit]','이미 파 놓음')
    f.locator('[name=cargo]').fill('팔레트'); f.locator('[name=w]').fill('2000'); f.locator('[name=d]').fill('2500'); f.locator('[name=h]').fill('2200')
    f.locator('[name=message]').fill('<script>alert(1)</script>\n두 번째 줄\n' + '가'*3200)
    p.set_input_files('input[name=photosPick]', [CT+'big.jpg', CT+'small.png', CT+'a.jpg']); p.wait_for_timeout(4000)
    check('G 사진 3장 미리보기', p.locator('#upList .up-item').count()==3, p.locator('#upList .up-item').count())
    m=submit(p,6000); it=inquiries()[0]; sp=dict(it['spec'])
    check('G 전체 입력 접수', OKMSG in m and count()==n0+1, m[:30])
    check('G 사진 3장 저장', len(it['photos'])==3, len(it['photos']))
    check('G 사양 저장값', sp.get('출입방향')=='Z방향 (층마다 반대쪽)' and sp.get('운행 높이(행정거리)')=='9.5 m' and sp.get('윗층 바닥 구멍(천공)')=='공사 중' and sp.get('바닥 피트')=='이미 파 놓음' and sp.get('전체 정지 층수')=='3개 층' and sp.get('이메일')=='kim@test.co.kr' and sp.get('카 내부 크기(W×D×H)')=='2000 × 2500 × 2200 mm', sp)
    check('G 회사명 특수문자 그대로', it['company']=='(주)<b>테스트</b> & "따옴표"', it['company'])
    check('G 긴 내용 3000자로 자름', len(it['message'])==3000, len(it['message']))
    check('G 연락처 031 형식', it['phone']=='031-986-5345', it['phone'])
    check('G 알림 메일 실패해도 접수는 저장(시험 서버엔 메일 키 없음)', it['email_sent']==0 and 'RESEND' in (it['email_error'] or ''), it['email_error'])
    # K 접수 후 양식 초기화
    check('K 접수 후 양식 비움(이름·사진·방향·준비상태)', p.input_value('[name=name]')=='' and p.locator('#upList .up-item').count()==0 and p.locator('.dir-opt.on input[value=""]').count()==1 and p.locator('#indoorSet').is_hidden())
    # K2 같은 화면에서 이어서 한 번 더 문의
    fill_min(p,'김철수2','01099998888'); m=submit(p); check('K2 같은 화면에서 두 번째 문의도 접수', OKMSG in m and count()==n0+2, m[:20])
    c.close()
    # H 사진 7장 → 5장만
    n0=count(); c,p,posts=ctx(b); fill_min(p)
    p.set_input_files('input[name=photosPick]', [CT+'p%d.jpg'%i for i in range(3,8)]+[CT+'a.jpg',CT+'b.jpg']); p.wait_for_timeout(2500)
    check('H 7장 고르면 5장만 + 안내', p.locator('#upList .up-item').count()==5 and '5장까지' in p.inner_text('#formMsg'), p.inner_text('#formMsg'))
    p.locator('#upList .up-item button').first.click(); p.wait_for_timeout(200)
    check('H 사진 빼기 버튼', p.locator('#upList .up-item').count()==4)
    m=submit(p,4000); it=inquiries()[0]; check('H 4장 접수', OKMSG in m and len(it['photos'])==4, len(it['photos']))
    c.close()
    # I 읽을 수 없는 사진·문서
    c,p,posts=ctx(b); fill_min(p)
    p.set_input_files('input[name=photosPick]', [CT+'fake.heic', CT+'note.txt', CT+'a.jpg']); p.wait_for_timeout(2000)
    check('I heic 깨진 파일 안내·txt 무시·jpg만 남음', p.locator('#upList .up-item').count()==1 and '읽을 수 없는' in p.inner_text('#formMsg'), p.inner_text('#formMsg')[:40])
    n0=count(); m=submit(p,3000); check('I 그래도 접수됨', OKMSG in m and count()==n0+1)
    c.close()
    # J 버튼 빠르게 두 번
    n0=count(); c,p,posts=ctx(b); fill_min(p)
    p.locator('#formBtn').dblclick(); p.wait_for_timeout(3000)
    check('J 두 번 눌러도 1건만', count()==n0+1 and len(posts)==1, (count()-n0, len(posts)))
    c.close()
    # L 실내→외부 바꾸기
    n0=count(); c,p,posts=ctx(b); fill_min(p)
    p.select_option('select[name=place]','건물 실내'); p.select_option('select[name=hole]','이미 뚫려 있음'); p.select_option('select[name=pit]','아직 없음 (파야 함)')
    p.select_option('select[name=place]','건물 외부')
    check('L 외부로 바꾸면 천공 숨김·피트 유지', p.locator('#holeQ').is_hidden() and p.locator('select[name=pit]').is_visible() and p.input_value('select[name=pit]')=='아직 없음 (파야 함)')
    m=submit(p); sp=dict(inquiries()[0]['spec'])
    check('L 저장: 천공 없음·피트 있음·외부', '윗층 바닥 구멍(천공)' not in sp and sp.get('바닥 피트')=='아직 없음 (파야 함)' and sp.get('실내·외부')=='건물 외부', sp)
    p.select_option('select[name=place]','건물 외부'); p.select_option('select[name=pit]','이미 파 놓음'); p.select_option('select[name=place]','')
    check('L2 모름으로 바꾸면 피트도 비움', p.locator('#indoorSet').is_hidden() and p.input_value('select[name=pit]')=='')
    c.close()
    # M 전화번호 형식
    for raw, want in [('021234567','02-123-4567'),('0212345678','02-1234-5678'),('15881234','1588-1234'),('050512345678','0505-1234-5678'),('0101234567','010-123-4567')]:
        c,p,posts=ctx(b); fill_min(p, phone=raw); shown=p.input_value('[name=phone]'); m=submit(p)
        check('M 연락처 %s → %s'%(raw,want), shown==want and OKMSG in m and inquiries()[0]['phone']==want, (shown, m[:15]))
        c.close()
    # N 휴대폰 화면 전체 흐름
    n0=count(); c,p,posts=ctx(b, mobile=True); fill_min(p)
    check('N 휴대폰: 사양은 접혀 있고 정지 층수만 보임', p.locator('#specMore select[name=load]').is_hidden() and p.locator('select[name=stops]').is_visible() and p.locator('#specToggle').is_visible())
    dt=p.inner_text('.dir-set'); vals=p.eval_on_selector_all('.dir-set input[name=dir]','els=>els.map(e=>e.value)')
    check('S 출입방향 글·값(11-23 직관통형)', '한 층이라도' in dt and '층에 따라' in dt and '1층 앞, 2층 뒤' in dt and '직관통형' in dt and '90도로 꺾여' in dt and '직각' not in dt and vals==['일방향 (모든 층 같은 쪽)','양방향 (앞뒤 관통)','Z방향 (층마다 반대쪽)','직관통형 (ㄱ자)',''] and p.locator('.dir-opt:has(input[value="직관통형 (ㄱ자)"]) svg rect').count()==1, vals)
    c.close(); n0=count(); c,p,posts=ctx(b); fill_min(p); p.locator('.dir-opt:has(input[value="직관통형 (ㄱ자)"])').click(); m=submit(p)
    it=inquiries()[0]; check('S2 직관통형 골라 접수 → 값 그대로', OKMSG in m and count()==n0+1 and dict(it['spec']).get('출입방향')=='직관통형 (ㄱ자)', dict(it['spec']).get('출입방향'))
    c.close(); n0=count(); c,p,posts=ctx(b, mobile=True); fill_min(p)
    check('N 휴대폰: 안내 상자 없음·사진 칸 안내는 있음', p.locator('.photo-one').count()==0 and '사진이 없어도' in p.inner_text('#upDrop'))  # 11-16 bb2e1fa 글 바뀜
    p.select_option('select[name=stops]','2개 층')
    p.locator('#specToggle').click(); p.wait_for_timeout(200)
    check('N 휴대폰: 펼치면 사양 칸 보임', p.locator('#specMore select[name=load]').is_visible() and p.get_attribute('#specToggle','aria-expanded')=='true')
    p.locator('.dir-opt:has(input[value="양방향 (앞뒤 관통)"])').click(); p.select_option('select[name=place]','건물 외부'); p.select_option('select[name=pit]','피트 없이 설치하고 싶음')
    p.set_input_files('input[name=photosPick]', [CT+'a.jpg']); p.wait_for_timeout(1500)
    m=submit(p,3000); sp=dict(inquiries()[0]['spec'])
    check('N 휴대폰 화면 접수', OKMSG in m and count()==n0+1 and sp.get('출입방향')=='양방향 (앞뒤 관통)' and sp.get('바닥 피트')=='피트 없이 설치하고 싶음' and sp.get('전체 정지 층수')=='2개 층', sp)
    c.close()
    # P 인터넷 끊김
    c,p,posts=ctx(b); fill_min(p); p.route('**/api/contact', lambda r: r.abort())
    m=submit(p,1500); check('P 끊기면 안내 + 버튼 다시 켜짐 + 입력 유지', '인터넷 연결' in m and p.locator('#formBtn').is_enabled() and p.input_value('[name=name]')=='홍길동', m[:30])
    p.unroute('**/api/contact'); n0=count(); m=submit(p); check('P 다시 누르면 접수', OKMSG in m and count()==n0+1)
    c.close()
    # Q 서버 오류(500)
    c,p,posts=ctx(b); fill_min(p); p.route('**/api/contact', lambda r: r.fulfill(status=500, body='oops'))
    m=submit(p,1500); check('Q 서버 오류 → 전화 안내 + 버튼 다시 켜짐', '전화' in m and p.locator('#formBtn').is_enabled(), m[:40])
    c.close()
    # R 숨은 스팸칸
    c,p,posts=ctx(b); fill_min(p, name='로봇')
    check('R 숨은 칸이 사람 눈에 안 보임', p.evaluate("(()=>{const r=document.querySelector('[name=gs_hp]').getBoundingClientRect();return r.right<0||r.width<=1})()"))
    p.evaluate("document.querySelector('[name=gs_hp]').value='http://spam'"); n0=count(); m=submit(p)
    check('R 숨은 칸 채운 로봇 → 저장 안 됨(화면엔 접수로 보임)', count()==n0 and OKMSG in m)
    c.close()
    c,p,posts=ctx(b); fill_min(p, name='사람'); n0=count(); m=submit(p)
    check('R 사람이 보낸 건 정상 저장', count()==n0+1 and inquiries()[0]['name']=='사람')
    c.close()
    b.close()
print('page errors:', errs)
print('합계: %d개 중 %d개 통과'%(len(results), sum(r[1] for r in results)))
