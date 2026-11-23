from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b=pw.chromium.launch(); c=b.new_context(extra_http_headers={'cf-connecting-ip':'8.8.8.2'}); p=c.new_page()
    p.goto('http://localhost:8787/admin/'); p.wait_for_timeout(800)
    p.fill('input[type=password]','testpass123'); p.keyboard.press('Enter'); p.wait_for_timeout(2500)
    p.goto('http://localhost:8787/admin/#inq-20'); p.wait_for_timeout(1500)
    print(p.locator('#inq-20').inner_html()[:1500])
    for i in p.locator('article[id^=inq-]').all():
        t=i.inner_text()
        if 'kim@test.co.kr' in t: print('\nG case id', i.get_attribute('id'), '| Z:', 'Z방향' in t, '| 천공 공사중:', '공사 중' in t, '| photos:', i.locator('img').count())
    b.close()
