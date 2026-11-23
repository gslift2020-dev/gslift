from playwright.sync_api import sync_playwright
INIT="Object.defineProperty(navigator,'webdriver',{get:()=>false})"
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for url in ['/','/?utm_source=naver&n_media=1&n_query=%ED%99%94']:
        c=b.new_context(); c.add_init_script(INIT); p=c.new_page(); p.goto('http://localhost:8787'+url); p.wait_for_timeout(1500)
        a=p.locator('a[href="#contact"]').first; print(url, 'button:', a.inner_text()[:20])
        a.click(); p.wait_for_timeout(2500)
        print('  contact top', p.evaluate("Math.round(document.getElementById('contact').getBoundingClientRect().top)"), 'form top', p.evaluate("Math.round(document.getElementById('form').getBoundingClientRect().top)"), 'scrollY', p.evaluate('scrollY'))
        c.close()
    b.close()
