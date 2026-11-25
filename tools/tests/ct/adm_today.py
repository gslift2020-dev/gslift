# 관리자 「한눈에 보기」 맨 위 「오늘 방문자」 칸을 누르면 방문 기록 탭으로 (2026-11-25)
# 쓰는 법: 로컬 wrangler dev(8787, ADMIN_PASSWORD=testpass123) 띄운 뒤 python3 -I adm_today.py
from playwright.sync_api import sync_playwright
R=[]
def check(n,ok,info=''): R.append(ok); print(('PASS ' if ok else 'FAIL ')+n,'—',info)
def onvisits(p): return p.locator('#tab-visits').is_visible() and p.locator('#tab-dash').is_hidden() and p.get_attribute('.menu button[data-tab=visits]','aria-selected')=='true'
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for w,h,m in [(390,844,True),(360,780,True),(1280,900,False)]:
        c=b.new_context(viewport={'width':w,'height':h},is_mobile=m,has_touch=m); p=c.new_page(); errs=[]
        p.on('pageerror',lambda e:errs.append(str(e)))
        p.goto('http://localhost:8787/admin/'); p.wait_for_timeout(800)
        p.locator('input[type=password]').click(); p.keyboard.type('testpass123'); p.keyboard.press('Enter'); p.wait_for_timeout(2500)
        check(f'{w} 처음은 한눈에 보기', p.locator('#tab-dash').is_visible())
        box=p.locator('#dTodayBox')
        check(f'{w} 오늘 방문자 칸 손가락 모양', box.evaluate('e=>getComputedStyle(e).cursor')=='pointer')
        (box.tap() if m else box.click()); p.wait_for_timeout(1200)
        check(f'{w} 누르면 방문 기록', onvisits(p))
        p.locator('.menu button[data-tab=dash]').click(); p.wait_for_timeout(1200)
        box.focus(); p.keyboard.press('Enter'); p.wait_for_timeout(1200)
        check(f'{w} Enter로도 방문 기록', onvisits(p))
        p.locator('.menu button[data-tab=dash]').click(); p.wait_for_timeout(800)
        p.locator('#dNewBox').click(); p.wait_for_timeout(800)
        check(f'{w} 신규 문의 칸은 그대로 문의로', p.locator('#tab-inq').is_visible())
        ov=p.evaluate('document.documentElement.scrollWidth-window.innerWidth')
        check(f'{w} 옆 넘침 0 · 화면 오류 0', ov<=0 and not errs, (ov,errs[:2]))
        c.close()
print(f'합계: {len(R)}개 중 {sum(R)}개 통과')
