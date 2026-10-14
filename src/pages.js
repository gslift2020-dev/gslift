// 홈페이지 HTML을 보내기 전에 관리자 설정을 끼워 넣음
// - 회사 정보(전화·주소 등), 인사말, 자주 묻는 질문, 공지사항
// - 검색·공유용 정보: 대표 주소(canonical), 카카오톡 미리보기 사진, 회사 정보(구조화 데이터), 검색엔진 인증 코드
// - robots.txt, sitemap.xml
// 설정을 못 읽으면 원래 파일을 그대로 보여줌 (홈페이지가 멈추지 않게)
import { esc, ensureSchema, CATS } from './util.js';
import { siteData } from './site.js';
import { caseMeta, caseIdsForSitemap } from './admin.js';

// 정식 주소: 이 도메인들에서는 검색 허용, 그 외(임시 주소)는 검색 차단
const LIVE_HOSTS = ['gslift.kr', 'www.gslift.kr'];
const MAIN_HOST = 'gslift.kr';

const PAGES = { '/': '/', '/index.html': '/', '/case': '/case.html', '/case.html': '/case.html', '/cases': '/cases.html', '/cases.html': '/cases.html' };

export function isPage(path) { return path in PAGES || path === '/robots.txt' || path === '/sitemap.xml'; }

async function assetText(env, url, file) {
  let r = await env.ASSETS.fetch(new Request(new URL(file, url)));
  // 정적 파일 서버가 /case.html → /case 로 넘기는 경우 따라감
  if (r.status >= 300 && r.status < 400 && r.headers.get('location')) r = await env.ASSETS.fetch(new Request(new URL(r.headers.get('location'), url)));
  if (!r.ok) return null;
  return r.text();
}

const telHref = (t) => 'tel:' + String(t).replace(/[^0-9+]/g, '');

// <span data-co="tel">031-…</span> 의 글자, data-co-href="tel" 이 붙은 링크 주소를 바꿈
function fillCompany(html, co) {
  html = html.replace(/(<[a-z0-9]+\b[^>]*\bdata-co="(\w+)"[^>]*>)([^<]*)(?=<)/gi, (m, open, key, text) => (key in co ? open + esc(co[key]) : m));
  html = html.replace(/<a\b([^>]*)\bdata-co-href="(\w+)"([^>]*)>/gi, (m, a, key, b) => {
    if (!(key in co)) return m;
    const href = key === 'email' ? 'mailto:' + co.email : telHref(co[key]);
    return ('<a' + a + 'data-co-href="' + key + '"' + b + '>').replace(/\bhref="[^"]*"/, 'href="' + esc(href) + '"');
  });
  return html;
}

function block(html, name, inner) {
  const re = new RegExp('<!--' + name + '-->[\\s\\S]*?<!--/' + name + '-->');
  return html.replace(re, '<!--' + name + '-->' + inner + '<!--/' + name + '-->');
}

const paras = (t) => String(t || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');

function faqHtml(list) {
  return list.map((f, i) => '<details class="faq-item"' + (i === 0 ? ' open' : '') + '><summary><span class="q">Q</span>' + esc(f.q) + '</summary><div class="a">' + paras(f.a) + '</div></details>').join('');
}

function noticeHtml(list) {
  return list.map((n) => '<details class="notice-item"><summary>' + (n.pinned ? '<span class="pin">중요</span>' : '') + '<b>' + esc(n.title) + '</b><time>' + esc(String(n.created_at).slice(0, 10).replace(/-/g, '.')) + '</time></summary>' +
    (n.body ? '<div class="nb">' + paras(n.body) + '</div>' : '') + '</details>').join('');
}

function jsonLd(co, origin) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: co.name,
    alternateName: 'GSLIFT',
    description: '화물용 리프트(F/L), 테이블 리프트(T/L), 스태커, 운반기계 설계·제작·설치·A/S',
    url: origin + '/',
    logo: origin + '/assets/img/logo-stack.webp',
    image: origin + '/assets/img/og.jpg',
    telephone: co.tel,
    faxNumber: co.fax,
    email: co.email,
    founder: co.ceo,
    foundingDate: '2002',
    address: { '@type': 'PostalAddress', streetAddress: co.addr.replace(/^경기도\s*김포시\s*/, ''), addressLocality: '김포시', addressRegion: '경기도', addressCountry: 'KR' },
    department: [{ '@type': 'LocalBusiness', name: co.name + ' 영남사업본부', telephone: co.yTel, address: { '@type': 'PostalAddress', streetAddress: co.yAddr, addressCountry: 'KR' } }],
    areaServed: 'KR',
  };
  return '<script type="application/ld+json">' + JSON.stringify(data).replace(/</g, '\\u003c') + '</script>';
}

function setMeta(html, prop, content) {
  const attr = prop.startsWith('og:') ? 'property' : 'name';
  const re = new RegExp('<meta ' + attr + '="' + prop.replace(/[.:]/g, '\\$&') + '" content="[^"]*">');
  const tag = '<meta ' + attr + '="' + prop + '" content="' + esc(content) + '">';
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', tag + '\n</head>');
}

export async function servePage(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // www.gslift.kr → gslift.kr 로 통일
  if (url.hostname === 'www.' + MAIN_HOST) {
    url.hostname = MAIN_HOST;
    return Response.redirect(url.toString(), 301);
  }
  const live = LIVE_HOSTS.includes(url.hostname);
  const origin = url.origin;

  if (path === '/robots.txt') {
    const body = live ? `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n';
    return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  }
  if (path === '/sitemap.xml') {
    let rows = [];
    try { await ensureSchema(env); rows = await caseIdsForSitemap(env); } catch (e) { console.error('sitemap', e); }
    const u = (loc, lastmod, pr) => `<url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<priority>${pr}</priority></url>`;
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      u(origin + '/', '', '1.0') + u(origin + '/cases.html', '', '0.8') +
      Object.keys(CATS).map((c) => u(origin + '/cases.html?cat=' + c, '', '0.7')).join('') +
      rows.map((r) => u(origin + '/case.html?id=' + r.id, String(r.d || '').slice(0, 10), '0.6')).join('') +
      '</urlset>';
    return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  }

  const file = PAGES[path];
  let html = await assetText(env, url, file);
  if (html == null) return env.ASSETS.fetch(request);

  try {
    await ensureSchema(env);
    const site = await siteData(env);
    const co = site.company;
    html = fillCompany(html, co);
    html = block(html, 'GREET', paras(co.greeting));
    if (site.faq) html = block(html, 'FAQ', faqHtml(site.faq));
    if (site.notices.length) {
      html = block(html, 'NOTICE', noticeHtml(site.notices));
      html = html.replace('<section id="notice" class="sec notice" hidden>', '<section id="notice" class="sec notice">');
    }

    let canon = origin + (file === '/' ? '/' : file);
    // 전화번호를 쓰는 스크립트 문구용
    const head = ['<script>window.GS_TEL=' + JSON.stringify(co.tel).replace(/</g, '\\u003c') + '</script>'];
    if (file === '/case.html') {
      const id = url.searchParams.get('id');
      if (id && /^\d+$/.test(id)) {
        const c = await caseMeta(env, Number(id));
        if (c) {
          canon += '?id=' + c.id;
          const title = c.title + ' | ' + co.name + ' 설치사례';
          const desc = [CATS[c.cat], c.site, c.date && c.date + ' 설치', (c.body || '').slice(0, 80)].filter(Boolean).join(' · ');
          html = html.replace(/<title>[^<]*<\/title>/, '<title>' + esc(title) + '</title>');
          html = setMeta(html, 'description', desc);
          html = setMeta(html, 'og:title', title);
          html = setMeta(html, 'og:description', desc);
          if (c.photos[0]) html = setMeta(html, 'og:image', origin + c.photos[0]);
        }
      }
    } else if (file === '/cases.html') {
      const cat = url.searchParams.get('cat');
      if (CATS[cat]) canon += '?cat=' + cat;
    }
    if (file === '/') head.push(jsonLd(co, live ? 'https://' + MAIN_HOST : origin));
    head.push('<link rel="canonical" href="' + esc(live ? canon.replace(origin, 'https://' + MAIN_HOST) : canon) + '">');
    head.push('<meta property="og:url" content="' + esc(canon) + '">');
    if (co.naverVerify) head.push('<meta name="naver-site-verification" content="' + esc(co.naverVerify) + '">');
    if (co.googleVerify) head.push('<meta name="google-site-verification" content="' + esc(co.googleVerify) + '">');
    if (!live) head.push('<meta name="robots" content="noindex">');
    // 미리보기 사진은 전체 주소여야 카카오톡·페이스북이 읽음
    html = html.replace(/(<meta property="og:image" content=")(?!https?:)\/?([^"]*)"/, '$1' + origin + '/$2"');
    html = html.replace('</head>', head.join('\n') + '\n</head>');
  } catch (e) {
    console.error('page fill failed', e);
  }
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  });
}
