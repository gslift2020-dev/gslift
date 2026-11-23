from playwright.sync_api import sync_playwright
SP='/tmp/claude-0/-home-claude/4fc16c7d-9cdb-565e-95a5-a802f1b4a34a/scratchpad/sim/'
res=[]
def check(n,ok,info=''): res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n+('  — '+str(info) if info else ''))
with sync_playwright() as pw:
    b=pw.chromium.launch()
    c=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=2); p=c.new_page(); errs=[]
    p.on('pageerror',lambda e:errs.append(str(e)))
    p.goto('http://localhost:8787/'); p.wait_for_timeout(2000); p.add_style_tag(content='html{scroll-behavior:auto!important}')
    n_h=p.evaluate("document.querySelectorAll('.swipe-hint').length"); check('넘기기 막대 4곳', n_h==4, n_h)
    p.evaluate("document.querySelector('.bento + .swipe-hint').scrollIntoView({block:'center',behavior:'instant'})"); p.wait_for_timeout(800)
    hint=p.locator('.bento + .swipe-hint')
    g=p.evaluate("""(()=>{const h=document.querySelector('.bento + .swipe-hint'),t=h.querySelector('.sh-bar').getBoundingClientRect(),i=h.querySelector('.sh-bar i').getBoundingClientRect();return {tl:t.left,tw:t.width,il:i.left,iw:i.width,y:t.top+t.height/2,n:h.querySelector('.sh-n').textContent}})()""")
    print(g)
    # 진한 부분 잡고 천천히 끝까지
    x0=g['il']+g['iw']/2; y=g['y']
    p.mouse.move(x0,y); p.mouse.down()
    pos=[]; diffs=[]
    steps=30; end=g['tl']+g['tw']-g['iw']/2
    for k in range(1,steps+1):
        x=x0+(end-x0)*k/steps; p.mouse.move(x,y); p.wait_for_timeout(40)
        st=p.evaluate("""(()=>{const h=document.querySelector('.bento + .swipe-hint'),i=h.querySelector('.sh-bar i').getBoundingClientRect();return [document.querySelector('.bento').scrollLeft, i.left+i.width/2]})()""")
        pos.append(st[0]); diffs.append(abs(st[1]-x))
    jumps=[pos[i+1]-pos[i] for i in range(len(pos)-1)]
    check('끄는 동안 사진 줄이 한 방향으로 고르게 움직임', all(j>=0 for j in jumps) and max(jumps)<=2.5*(sum(jumps)/len(jumps))+2, (min(jumps),max(jumps),round(sum(jumps)/len(jumps),1)))
    check('막대가 손가락을 따라감(3px 이내)', max(diffs)<3, round(max(diffs),2))
    p.mouse.up(); p.wait_for_timeout(900)
    r=p.evaluate("(()=>{const r=document.querySelector('.bento'),w=r.children[0].offsetWidth+12;return [r.scrollLeft,r.scrollWidth-r.clientWidth,w,document.querySelector('.bento + .swipe-hint .sh-n').textContent]})()")
    check('끝까지 끌고 놓으면 마지막 카드', abs(r[0]-r[1])<3 and r[3].startswith(r[3].split('/')[1].strip()+' '), r)
    # 빈 곳(가운데) 누르기
    p.mouse.move(g['tl']+g['tw']*0.45,y); p.mouse.down(); p.mouse.up(); p.wait_for_timeout(900)
    r=p.evaluate("(()=>{const r=document.querySelector('.bento'),w=r.children[0].offsetWidth+12;return [r.scrollLeft,w,r.scrollLeft%w,document.querySelector('.bento + .swipe-hint .sh-n').textContent]})()")
    check('가운데 빈 곳 누르면 중간 카드 + 카드에 딱 맞춤', ('7 /' in r[3] or '8 /' in r[3] or '9 /' in r[3]) and (r[2]<2 or r[1]-r[2]<2), r)
    # 조금 끌고 놓기(카드 반 이하) → 가까운 카드
    g2=p.evaluate("(()=>{const i=document.querySelector('.bento + .swipe-hint .sh-bar i').getBoundingClientRect();return i.left+i.width/2})()")
    p.mouse.move(g2,y); p.mouse.down(); p.mouse.move(g2+3,y,steps=5); p.wait_for_timeout(300); p.mouse.up(); p.wait_for_timeout(900)
    r2=p.evaluate("(()=>{const r=document.querySelector('.bento'),w=r.children[0].offsetWidth+12;return [r.scrollLeft%w,w,document.querySelector('.bento + .swipe-hint .sh-n').textContent]})()")
    check('조금 끌고 놓으면 같은 카드로 돌아옴', r2[2]==r[3] and (r2[0]<2 or r2[1]-r2[0]<2), (r[3],r2))
    # 사진 줄을 직접 넘기면 막대·번호도 따라감
    p.evaluate("document.querySelector('.bento').scrollTo({left:0,behavior:'auto'})"); p.wait_for_timeout(500)
    p.evaluate("(()=>{const r=document.querySelector('.bento');r.scrollLeft=(r.children[0].offsetWidth+12)*3})()"); p.wait_for_timeout(500)
    r3=p.evaluate("document.querySelector('.bento + .swipe-hint .sh-n').textContent")
    check('사진 줄을 넘기면 번호가 따라감', r3.startswith('4 /'), r3)
    blur=p.evaluate("getComputedStyle(document.querySelector('.bento .opt .tags span')).backdropFilter")
    check('휴대폰 꼬리표 흐림 효과 꺼짐', blur in ('none',''), blur)
    check('화면 오류 없음', not errs, errs)
    p.evaluate("document.querySelector('.bento').scrollIntoView({block:'center',behavior:'instant'})"); p.wait_for_timeout(600)
    p.screenshot(path=SP+'m_bento.png')
    c.close()
    c=b.new_context(viewport={'width':1280,'height':900}); p=c.new_page(); p.goto('http://localhost:8787/'); p.wait_for_timeout(1500)
    check('PC: 막대 안 보임·꼬리표 흐림 그대로', p.evaluate("getComputedStyle(document.querySelector('.swipe-hint')).display")=='none' and p.evaluate("getComputedStyle(document.querySelector('.bento .opt .tags span')).backdropFilter")!='none')
    b.close()
print('결과 %d/%d'%(sum(res),len(res)))
