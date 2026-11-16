// 홈페이지 HTML을 보내기 전에 관리자 설정을 끼워 넣음
// - 회사 정보(전화·주소 등), 인사말, 자주 묻는 질문, 공지사항
// - 검색·공유용 정보: 대표 주소(canonical), 카카오톡 미리보기 사진, 회사 정보(구조화 데이터), 검색엔진 인증 코드
// - robots.txt, sitemap.xml
// 설정을 못 읽으면 원래 파일을 그대로 보여줌 (홈페이지가 멈추지 않게)
import { esc, ensureSchema, CATS } from './util.js';
import { siteData } from './site.js';
import { caseMeta, caseIdsForSitemap, publicList } from './admin.js';
import { TAGS, normTags } from './tags.js';

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
    description: '화물용 리프트(F/L), 테이블 리프트(T/L), 스태커 설계·제작·설치·A/S',
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
  // 바꿀 글에 $가 있어도 그대로 들어가게 함수로 바꿈
  return re.test(html) ? html.replace(re, () => tag) : html.replace('</head>', () => tag + '\n</head>');
}

// 설치사례 상세 내용 (case.js render()와 같은 모양 — 화면이 그려진 뒤 case.js가 같은 내용으로 다시 그림)
function caseSpec(title) {
  return String(title).split('·').map((x) => x.trim()).filter(Boolean).map((p) => {
    let label = '사양';
    if (/리프트|스태커|운반/.test(p)) label = '제품';
    else if (/톤|kg/i.test(p)) label = '적재하중';
    else if (/STOP|층/i.test(p)) label = '정지층';
    else if (/방향/.test(p)) label = '출입방향';
    else if (/실내|외부|실외/.test(p)) label = '설치위치';
    else if (/유압|체인|와이어|전동/.test(p)) label = '구동 방식';
    else if (/도어|셔터|문/.test(p)) label = '출입문';
    return [label, p];
  });
}
function caseHtml(c, co) {
  const n = c.photos.length;
  const alt = (k) => esc(c.title + (n > 1 ? ' (' + (k + 1) + '/' + n + ')' : ''));
  let h = '<div class="gal"><div class="gal-main">' + (n ? '<img src="' + esc(c.photos[0]) + '" alt="' + alt(0) + '">' : '') +
    (n > 1 ? '<span class="gal-count">1 / ' + n + '</span>' : '') + '</div>';
  if (n > 1) h += '<div class="gal-thumbs">' + c.photos.map((src, k) => '<button type="button"' + (k ? '' : ' class="on"') + ' aria-label="' + (k + 1) + '번째 사진"><img src="' + esc(src) + '" alt="' + alt(k) + '" loading="lazy"></button>').join('') + '</div>';
  h += '</div><div class="cd-info"><span class="cd-cat">' + esc(CATS[c.cat] || '설치사례') + '</span><h1>' + esc(c.title) + '</h1><div class="cd-site">' +
    (c.site ? '<span>현장: ' + esc(c.site) + '</span>' : '') +
    (c.date ? '<span class="cd-when">설치: ' + esc(c.date.replace(/^(\d{4})\.0?(\d{1,2})$/, '$1년 $2월')) + '</span>' : '') +
    '<span>사진 ' + n + '장</span></div>';
  const spec = caseSpec(c.title);
  if (spec.length > 1) h += '<div class="spec">' + spec.map(([l, v]) => '<div><small>' + esc(l) + '</small><b>' + esc(v) + '</b></div>').join('') + '</div>';
  if (c.body) h += '<p class="cd-text">' + esc(c.body) + '</p>';
  const tags = c.tags.filter((k) => TAGS[k]);
  if (tags.length) h += '<div class="cd-tags"><span class="cd-tags-t">이런 조건의 사례 더 보기</span>' + tags.map((k) => '<a href="/cases.html?cat=' + esc(c.cat) + '&amp;tag=' + esc(k) + '">#' + esc(TAGS[k]) + '</a>').join('') + '</div>';
  const tel = co && co.tel ? co.tel : '';
  h += '<div class="cd-cta"><strong>이 사례와 비슷한 리프트가 필요하신가요?</strong><p>현장 사진과 필요한 하중·층수를 알려주시면 현장에 맞춰 견적을 드립니다.</p><div class="btns">' +
    '<a class="btn btn-white" href="/?to=contact&amp;product=' + esc(c.cat) + '">견적 문의하기</a>' +
    (tel ? '<a class="btn btn-ghost" href="tel:' + esc(tel.replace(/[^0-9+]/g, '')) + '">' + esc(tel) + ' 전화</a>' : '') + '</div></div></div>';
  return h;
}

// ---------- 설치사례 목록(cases.html) 서버 그리기 (2026-11-16) ----------
// 구글이 분류별 목록(?cat=fl·tl·st)을 모두 같은 페이지로 보고 다른 주소를 대표로 골라서(서치 콘솔 '중복 페이지 —
// 사용자와 다른 표준') 분류마다 제목·설명·큰 제목·목록 1쪽 카드·쪽 번호를 HTML에 바로 넣는다.
// 같은 자료를 window.GS_LIST로 담아 두면 cases.js가 처음 한 번은 /api/cases를 부르지 않음 → DB 읽기는 늘지 않고 옮겨질 뿐
const LIST_PAGE = 20; // cases.js PAGE와 같게
function listState(url) {
  const p = url.searchParams;
  const cat = CATS[p.get('cat')] ? p.get('cat') : 'all';
  const tags = normTags(p.get('tag')).slice(0, 6);
  const q = String(p.get('q') || '').trim().slice(0, 40);
  const page = Math.max(parseInt(p.get('page'), 10) || 1, 1);
  return { cat, tags, q, page };
}
// cases.js urlOf()와 같은 순서 (cat → tag → q → page)
function listUrl(st, page) {
  const a = [];
  if (st.cat !== 'all') a.push('cat=' + st.cat);
  if (st.tags.length) a.push('tag=' + st.tags.join(','));
  if (st.q) a.push('q=' + encodeURIComponent(st.q));
  if (page > 1) a.push('page=' + page);
  return '/cases.html' + (a.length ? '?' + a.join('&') : '');
}
function listCard(c, k) {
  return '<a class="cl-card" href="/case.html?id=' + c.id + '"><div class="ph"><img src="' + esc(c.cover) + '" alt="' + esc(c.title) + '"' + (k < 4 ? '' : ' loading="lazy"') + ' width="900" height="1200">' +
    (c.count > 1 ? '<span class="cnt">사진 ' + c.count + '</span>' : '') + (c.date ? '<span class="when">' + esc(c.date) + ' 설치</span>' : '') +
    '</div><b>' + esc(c.title) + '</b><small>' + esc(c.site || CATS[c.cat] || '') + '</small></a>';
}
function listPager(st, total) {
  const last = Math.max(Math.ceil(total / LIST_PAGE), 1);
  if (last <= 1) return '';
  const cur = Math.min(st.page, last), out = [];
  const a = (label, p, aria) => '<a class="pg" href="' + esc(listUrl(st, p)) + '" data-page="' + p + '" aria-label="' + aria + '">' + label + '</a>';
  if (cur > 1) out.push(a('이전', cur - 1, '이전 페이지'));
  let gap = false;
  for (let p = 1; p <= last; p++) {
    if (p === 1 || p === last || Math.abs(p - cur) <= 2) {
      gap = false;
      out.push(p === cur ? '<span class="pg cur" aria-current="page">' + p + '</span>' : a(String(p), p, p + '페이지'));
    } else if (!gap) { gap = true; out.push('<span class="pg gap" aria-hidden="true">…</span>'); }
  }
  if (cur < last) out.push(a('다음', cur + 1, '다음 페이지'));
  return out.join('');
}
// 목록 페이지 채우기 → { html, title, desc, canonPath(null이면 검색 제외), cover }
function fillList(html, st, d, coName) {
  const cn = st.cat !== 'all' ? CATS[st.cat] : '';
  const tagN = st.tags.map((k) => TAGS[k]).filter(Boolean);
  const catTotal = st.cat !== 'all' ? d.counts[st.cat] : d.counts.all;
  const last = Math.max(Math.ceil(d.total / LIST_PAGE), 1);
  const pg = st.page > 1 ? ' (' + st.page + '쪽)' : '';
  // 제목·큰 제목
  let name, h1;
  if (tagN.length) { name = (cn ? cn + ' · ' : '') + tagN.join(' · ') + ' 설치사례 ' + d.total + '건'; h1 = (cn ? cn + ' ' : '') + '설치사례 · ' + tagN.join(' · '); }
  else if (cn) { name = cn + ' 설치사례 ' + catTotal + '건'; h1 = cn + ' 설치사례'; }
  else { name = '설치사례 전체 ' + d.counts.all + '건'; h1 = '설치사례'; }
  if (st.q) { name = '"' + st.q + '" 설치사례 검색 ' + d.total + '건'; }
  const title = name + pg + ' | ' + coName;
  // 설명: 분류마다 다르게 — 많이 쓰인 조건(꼬리표) 3개를 개수와 함께
  const top = st.q ? [] : Object.entries(d.tagCounts || {}).filter(([k]) => TAGS[k] && !st.tags.includes(k)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => TAGS[k] + ' ' + n + '건');
  const what = cn || '화물용 리프트(F/L)·테이블 리프트(T/L)·스태커';
  const desc = coName + '가 직접 설계·제작·설치한 ' + what + (tagN.length ? ' 중 ' + tagN.join('·') + ' 조건' : '') + ' 현장 ' + (tagN.length || st.q ? d.total : catTotal) + '건' + pg + '. ' +
    (top.length ? top.join(' · ') + ' 등 ' : '') + '현장 사진과 사양을 조건별로 볼 수 있습니다.';
  html = html.replace(/<title>[^<]*<\/title>/, () => '<title>' + esc(title) + '</title>');
  html = setMeta(html, 'description', desc);
  html = setMeta(html, 'og:title', title);
  html = setMeta(html, 'og:description', desc);
  html = html.replace('<h1>설치사례</h1>', () => '<h1>' + esc(h1) + '</h1>');
  // 현재 위치: 홈 › 설치사례 › 화물용 리프트(F/L)
  if (cn) html = html.replace('<span>설치사례</span></nav>', '<a href="/cases.html">설치사례</a><span aria-hidden="true">›</span><span>' + esc(cn) + '</span></nav>');
  html = html.replace('<span id="clTotal"></span>', '<span id="clTotal">' + (cn ? esc(cn) + ' ' + catTotal + '건 · ' : '') + '지금까지 ' + d.counts.all + '건의 사례를 올렸습니다.</span>');
  // 분류 탭: 지금 분류 표시 + 개수
  html = html.replace(/<a role="tab" data-cat="(\w+)" href="([^"]*)"[^>]*>([^<]*)<i><\/i><\/a>/g, (m, c, href, label) =>
    '<a role="tab" data-cat="' + c + '" href="' + href + '"' + (c === st.cat ? ' class="on" aria-selected="true"' : ' aria-selected="false"') + '>' + label + '<i>' + (d.counts[c] != null ? d.counts[c] : '') + '</i></a>');
  // 목록 1쪽 카드 + 쪽 번호 + 건수
  if (d.items.length) {
    html = html.replace('<div class="cl-grid" id="clGrid" aria-live="polite"></div>', '<div class="cl-grid" id="clGrid" aria-live="polite">' + d.items.map(listCard).join('') + '</div>');
    const from = (Math.min(st.page, last) - 1) * LIST_PAGE + 1;
    html = html.replace('<span id="clPageInfo"></span>', '<span id="clPageInfo">' + (d.total <= LIST_PAGE ? d.total + '건' : d.total + '건 중 ' + from + '–' + Math.min(from + LIST_PAGE - 1, d.total) + '번째') + '</span>');
    const pager = listPager(st, d.total);
    if (pager) html = html.replace('<nav class="cl-pager" id="clPager" aria-label="설치사례 페이지" hidden></nav>', '<nav class="cl-pager" id="clPager" aria-label="설치사례 페이지">' + pager + '</nav>');
  }
  // 대표 주소: 분류·꼬리표 1개·쪽은 각자 자기 주소 / 검색어·꼬리표 여러 개·없는 쪽은 검색 제외(조합이 끝없이 많음)
  const canonPath = st.q || st.tags.length > 1 || (st.page > last) || !d.items.length ? null : listUrl(st, st.page);
  return { html, canonPath, cover: d.items[0] && d.items[0].cover };
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
    // 설치사례 목록·회사 정보 API(읽기 전용)는 검색 로봇이 페이지를 그려 볼 때 쓰도록 열어 둠 (2026-11-12 — 막혀 있어서
    // 구글에는 목록·상세가 '불러오는 중…'으로만 보여 서로 같은 페이지로 묶였음). 관리자·문의·방문 기록 API는 계속 막음
    const body = live ? `User-agent: *\nAllow: /\nAllow: /api/cases\nAllow: /api/site\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n';
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
  let status = 200, noindex = false;

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
      let c = null;
      if (id && /^\d+$/.test(id)) c = await caseMeta(env, Number(id));
      if (!c) {
        // 없는 사례·번호 없는 주소: 검색에 '없는 페이지'로 알림 (화면은 지금처럼 '찾는 설치사례가 없습니다' 안내)
        status = 404;
        noindex = true;
      }
      if (c) {
        canon += '?id=' + c.id;
        // 검색 로봇·느린 휴대폰도 바로 보이게 사진·설명을 HTML에 넣고, 같은 자료를 페이지에 담아 둠
        // → 브라우저가 /api/cases/번호를 다시 부르지 않음(DB 읽기 줄어듦, 2026-11-12)
        html = html.replace(/<p class="case-empty" id="cdLoading">[^<]*<\/p>/, caseHtml(c, co));
        html = html.replace(/(<span id="crumbCat"[^>]*>)[^<]*(<\/span>)/, '$1' + esc(CATS[c.cat] || '설치사례') + '$2');
        html = html.replace('href="/cases.html" id="crumbList"', 'href="/cases.html?cat=' + esc(c.cat) + '" id="crumbList"');
        const data = { ...c, tagList: c.tags.map((k) => ({ k, n: TAGS[k] })) };
        head.push('<script>window.GS_CASE=' + JSON.stringify(data).replace(/</g, '\\u003c') + '</script>');
        const title = c.title + ' | ' + co.name + ' 설치사례';
        const desc = [CATS[c.cat], c.site, c.date && c.date + ' 설치', (c.body || '').slice(0, 80)].filter(Boolean).join(' · ');
        html = html.replace(/<title>[^<]*<\/title>/, '<title>' + esc(title) + '</title>');
        html = setMeta(html, 'description', desc);
        html = setMeta(html, 'og:title', title);
        html = setMeta(html, 'og:description', desc);
        if (c.photos[0]) html = setMeta(html, 'og:image', origin + c.photos[0]);
      }
    } else if (file === '/cases.html') {
      const st = listState(url);
      const cat = st.cat !== 'all' ? st.cat : '';
      if (cat) canon += '?cat=' + cat;
      // HEAD(내용 없이 머리만 묻기)는 DB를 읽지 않음
      if (request.method === 'GET') {
        const api = new URL('/api/cases?facet=1&limit=' + LIST_PAGE + '&offset=' + (st.page - 1) * LIST_PAGE, origin);
        if (cat) api.searchParams.set('cat', cat);
        if (st.tags.length) api.searchParams.set('tag', st.tags.join(','));
        if (st.q) api.searchParams.set('q', st.q);
        const d = await publicList(env, api);
        const r = fillList(html, st, d, co.name || '거산리프트');
        html = r.html;
        if (r.canonPath) canon = origin + r.canonPath; else noindex = true;
        if (r.cover) html = setMeta(html, 'og:image', origin + r.cover);
        // cases.js가 처음 한 번은 이 자료를 씀 (key가 지금 주소와 같을 때만)
        head.push('<script>window.GS_LIST=' + JSON.stringify({ key: listUrl(st, st.page), d }).replace(/</g, '\\u003c') + '</script>');
      }
    }
    if (file === '/') head.push(jsonLd(co, live ? 'https://' + MAIN_HOST : origin));
    // 검색 제외 페이지에는 대표 주소를 넣지 않음(두 신호가 서로 어긋나지 않게)
    if (!noindex) head.push('<link rel="canonical" href="' + esc(live ? canon.replace(origin, 'https://' + MAIN_HOST) : canon) + '">');
    head.push('<meta property="og:url" content="' + esc(canon) + '">');
    if (co.naverVerify) head.push('<meta name="naver-site-verification" content="' + esc(co.naverVerify) + '">');
    if (co.googleVerify) head.push('<meta name="google-site-verification" content="' + esc(co.googleVerify) + '">');
    if (!live || noindex) head.push('<meta name="robots" content="noindex">');
    // 미리보기 사진은 전체 주소여야 카카오톡·페이스북이 읽음
    html = html.replace(/(<meta property="og:image" content=")(?!https?:)\/?([^"]*)"/, '$1' + origin + '/$2"');
    html = html.replace('</head>', head.join('\n') + '\n</head>');
  } catch (e) {
    console.error('page fill failed', e);
  }
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  });
}
