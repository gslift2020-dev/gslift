// 방문자 통계 (직접 집계)
// - 페이지를 열면 홈페이지 track.js 가 /api/hit 로 신호를 보냄 { p: 주소, r: 이전 페이지, v: 방문번호, f: 방문의 첫 페이지면 1 }
// - 날짜별 합계 (400일 보관): 같은 날 같은 기기는 방문자 1명 (IP는 저장하지 않고, 날짜가 섞인 암호화 값만 → 다음 날이면 연결 불가)
// - 방문 1건 기록 (visits, 90일 보관): 시각·경로·검색어·광고 이름표·첫 페이지·본 페이지·기기·시도·문의 번호
//   방문번호는 브라우저가 만든 무작위 값(30분 동안 아무 페이지도 안 보면 새 번호) → 사람을 알아볼 수 없음
// - 빼는 방문: 검색 로봇, 관리자 로그인 상태, '이 기기 빼기'를 한 기기(track.js가 아예 안 보냄), 회사 인터넷 주소로 등록한 곳
// - DB 사용 (방문 1번): 첫 페이지 = 읽기 없음(설정 기억이 5분 지났을 때만 1줄) · 쓰기 3~4줄 / 다음 페이지 = 방문 1줄 찾기 + 쓰기 2~3줄
import { json, kst, ensureSchema, clean } from './util.js';

const BOT = /bot|spider|crawl|slurp|headless|preview|facebookexternalhit|kakaotalk-scrap|yeti|daumoa|lighthouse|uptime|python|curl|wget|java\//i;
export const VISIT_DAYS = 90; // 방문 1건 기록 보관 기간

// 유입 경로: 홍보물·광고 주소의 ?utm_source= 이름표 → 네이버 광고 자동 표시 → 이전 페이지 → 앱 종류 순으로 판단
// (홈페이지 track.js 도 같은 순서로 판단해서 문의에 붙여 보냄)
const UTM = {
  naver: '네이버 광고', kakao: '카카오 광고', daum: '카카오 광고', google: '구글 광고',
  kakaotalk: '카카오톡', 'naver-app': '네이버 앱', qr: 'QR코드', card: '명함', quote: '견적서', catalog: '카탈로그',
  blog: '블로그', youtube: '유튜브', instagram: '인스타그램', band: '밴드', direct: '직접 입력·즐겨찾기',
};
// 예전 이름으로 쌓인 합계 기록 → 지금 이름 (2026-10-30 전 '네이버 검색'에는 네이버 블로그·카페도 섞여 있음)
const ALIAS = { '네이버': '네이버 검색', '구글': '구글 검색', '직접 방문': '직접 입력·즐겨찾기', 'Bing': '빙 검색' };

function hostLabel(h) {
  h = h.replace(/^(www|m)\./, '');
  if (/^blog\.naver\.com$|\.blog\.me$/.test(h)) return '네이버 블로그';
  if (/^cafe\.naver\.com$/.test(h)) return '네이버 카페';
  if (/(^|\.)search\.naver\.com$/.test(h)) return '네이버 검색';
  if (/naver\.(com|net|me)$/.test(h)) return '네이버 (기타)';
  if (/(^|\.)search\.daum\.net$/.test(h)) return '다음 검색';
  if (/(^|\.)cafe\.daum\.net$/.test(h)) return '다음 카페';
  if (/daum\.net$|kakao\.com$/.test(h)) return '다음·카카오 (기타)';
  if (/(^|\.)google\.[a-z.]+$/.test(h)) return '구글 검색';
  if (/(^|\.)bing\.com$/.test(h)) return '빙 검색';
  if (/(^|\.)yahoo\.[a-z.]+$/.test(h)) return '야후 검색';
  if (/(^|\.)zum\.com$/.test(h)) return '줌 검색';
  if (/youtube\.com$|youtu\.be$/.test(h)) return '유튜브';
  if (/instagram\.com$|facebook\.com$|fb\.com$|threads\.net$/.test(h)) return '인스타그램·페이스북';
  if (/band\.us$/.test(h)) return '밴드';
  if (/tistory\.com$|brunch\.co\.kr$/.test(h)) return '블로그 (티스토리 등)';
  return '다른 사이트: ' + h.slice(0, 50);
}

// 원래 값(이름표·사이트 주소) → 화면에 보일 경로 이름. 문의(spec.src)에도 같은 값이 저장됨
export function srcLabel(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return '직접 입력·즐겨찾기';
  if (UTM[s]) return UTM[s];
  if (s.includes('.')) return hostLabel(s);
  return '홍보: ' + s.slice(0, 20);
}

function qs(p) {
  try { return new URL(String(p || '/'), 'https://x').searchParams; } catch { return new URLSearchParams(); }
}
function refUrl(ref) {
  try { const u = new URL(String(ref || '')); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; }
}

export function rawSource(p, ref, ua, host) {
  const q = qs(p);
  const u = q.get('utm_source');
  if (u) return u.slice(0, 40);
  if (q.get('n_media')) return 'naver';
  const r = refUrl(ref);
  const h = r ? r.hostname.replace(/^www\./, '') : '';
  if (h && h !== host.replace(/^www\./, '')) return h;
  if (/KAKAOTALK/i.test(ua)) return 'kakaotalk';
  if (/NAVER\(inapp/i.test(ua)) return 'naver-app';
  return 'direct';
}

// 검색어: 이전 페이지 주소에 담겨 온 경우만 (구글은 주지 않음) + 네이버 광고 자동 추적 값(n_query·n_keyword)
const KW_PARAM = { '네이버 검색': ['query', 'oquery'], '다음 검색': ['q'], '빙 검색': ['q'], '구글 검색': ['q'], '야후 검색': ['p'], '줌 검색': ['query'] };
function keywordOf(p, ref, label) {
  const q = qs(p);
  const ad = q.get('n_query') || q.get('n_keyword') || q.get('utm_term');
  if (ad) return ad.slice(0, 50);
  const r = refUrl(ref);
  if (!r) return '';
  // 네이버 광고는 이전 페이지가 search.naver.com 이 아닐 때도 있음(광고 클릭 중간 주소) → 검색 사이트 판단은 주소로
  const keys = KW_PARAM[hostLabel(r.hostname)] || [];
  for (const k of keys) { const v = r.searchParams.get(k); if (v) return v.trim().slice(0, 50); }
  return '';
}

// 광고·홍보 이름표 전부 (utm_* + 네이버 광고 자동 추적 n_*)
const AD_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'n_media', 'n_query', 'n_keyword', 'n_ad_group', 'n_campaign_type', 'n_rank', 'n_ad'];
function adTags(p) {
  const q = qs(p), out = [];
  for (const k of AD_KEYS) { const v = q.get(k); if (v) out.push(k + '=' + v.slice(0, 60)); }
  return out.join(' · ').slice(0, 300);
}

// 시·도 (Cloudflare가 접속 위치로 추정해 주는 값. 휴대폰 데이터는 서울·경기로 나오는 경우가 많아 대략만)
const KR_CODE = { 11: '서울', 26: '부산', 27: '대구', 28: '인천', 29: '광주', 30: '대전', 31: '울산', 50: '세종', 41: '경기', 42: '강원', 51: '강원', 43: '충북', 44: '충남', 45: '전북', 52: '전북', 46: '전남', 47: '경북', 48: '경남', 49: '제주' };
const KR_NAME = [[/seoul/i, '서울'], [/busan/i, '부산'], [/daegu/i, '대구'], [/incheon/i, '인천'], [/gwangju/i, '광주'], [/daejeon/i, '대전'], [/ulsan/i, '울산'], [/sejong/i, '세종'],
  [/gyeonggi/i, '경기'], [/gangwon/i, '강원'], [/chungcheongbuk|chungbuk|north chungcheong/i, '충북'], [/chungcheongnam|chungnam|south chungcheong/i, '충남'],
  [/jeollabuk|jeonbuk|north jeolla/i, '전북'], [/jeollanam|jeonnam|south jeolla/i, '전남'], [/gyeongsangbuk|gyeongbuk|north gyeongsang/i, '경북'],
  [/gyeongsangnam|gyeongnam|south gyeongsang/i, '경남'], [/jeju/i, '제주']];
export function regionOf(cf) {
  if (!cf) return '';
  if (cf.country && cf.country !== 'KR') return '해외 (' + String(cf.country).slice(0, 2) + ')';
  const code = String(cf.regionCode || '').replace(/^KR-/, '');
  if (KR_CODE[code]) return KR_CODE[code];
  for (const [re, n] of KR_NAME) if (re.test(cf.region || '')) return n;
  return '';
}

function cleanPath(p) {
  try {
    const u = new URL(p, 'https://x');
    if (/^\/case(\.html)?$/.test(u.pathname)) {
      const id = u.searchParams.get('id');
      return id && /^\d+$/.test(id) ? '/case.html?id=' + id : '/case.html';
    }
    if (/^\/cases(\.html)?$/.test(u.pathname)) {
      // 상황별로 찾기 꼬리표·분류는 남김 (어떤 조건으로 찾아봤는지)
      const k = ['cat', 'tag'].filter((x) => u.searchParams.get(x)).map((x) => x + '=' + u.searchParams.get(x).replace(/[^\w,]/g, '').slice(0, 40));
      return '/cases.html' + (k.length ? '?' + k.join('&') : '');
    }
    if (u.pathname === '/' || u.pathname === '/index.html') return '/';
    return u.pathname.slice(0, 80);
  } catch { return '/'; }
}
// 합계표용 (꼬리표 조건까지 나누면 칸이 너무 많아짐)
const sumPath = (path) => path.replace(/^\/cases\.html\?.*$/, '/cases.html');

async function hashHex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d).slice(0, 10), (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- 회사 인터넷 주소 빼기 ----------
   사무실·공장 와이파이처럼 회사가 쓰는 인터넷 주소를 관리자 화면에서 등록 → 그 주소의 방문은 기록하지 않음
   방문 때마다 DB를 읽지 않도록 5분 동안 기억 (서버 1대당 5분에 1줄 읽기) */
let exCache = { at: 0, list: [] };
export function dropExcludeCache() { exCache = { at: 0, list: [] }; }
// IPv6는 앞 4마디(같은 회선)로 비교 — 기기마다 뒷부분이 바뀌기 때문
export function ipKey(ip) {
  ip = String(ip || '').trim().toLowerCase();
  if (!ip.includes(':')) return ip;
  const full = ip.split('::');
  const head = full[0] ? full[0].split(':') : [];
  const tail = full.length > 1 && full[1] ? full[1].split(':') : [];
  const parts = full.length > 1 ? head.concat(Array(8 - head.length - tail.length).fill('0'), tail) : head;
  return parts.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
export async function excludeList(env) {
  try {
    const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'statsExclude'").first();
    const v = r ? JSON.parse(r.value) : null;
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
async function excluded(env, ip) {
  if (!ip) return false;
  if (Date.now() - exCache.at > 300000) exCache = { at: Date.now(), list: (await excludeList(env)).map((x) => x.ip) };
  return exCache.list.includes(ipKey(ip));
}

export async function recordHit(request, env) {
  const ok = new Response(null, { status: 204 });
  if (request.method !== 'POST' || !env.DB) return ok;
  const ua = request.headers.get('user-agent') || '';
  if (!ua || BOT.test(ua)) return ok;
  if (/(?:^|;\s*)gs_admin=/.test(request.headers.get('cookie') || '')) return ok;
  let b = {};
  try { b = JSON.parse((await request.text()).slice(0, 3000)); } catch { return ok; }
  await ensureSchema(env);
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (await excluded(env, ip)) return ok;
  const url = new URL(request.url);
  const now = kst(), day = now.slice(0, 10);
  const h = await hashHex(day + '|' + ip + '|' + ua + '|' + (env.ADMIN_PASSWORD || 'gslift'));
  const mobile = /Mobi|Android|iPhone|iPad/i.test(ua) ? 1 : 0;
  const path = cleanPath(String(b.p || '/'));
  const raw = rawSource(b.p, b.r, ua, url.hostname);
  const label = srcLabel(raw);
  const vid = /^[a-z0-9]{8,32}$/.test(String(b.v || '')) ? String(b.v) : '';

  const first = await env.DB.prepare('INSERT OR IGNORE INTO visit_uniq (day, h, mobile) VALUES (?, ?, ?)').bind(day, h, mobile).run();
  const stmts = [env.DB.prepare('INSERT INTO visit_pages (day, path, n) VALUES (?, ?, 1) ON CONFLICT(day, path) DO UPDATE SET n = n + 1').bind(day, sumPath(path))];
  // 날짜별 경로 합계는 그날 첫 방문 때만 셈
  if (first.meta && first.meta.changes) {
    stmts.push(env.DB.prepare('INSERT INTO visit_refs (day, src, n) VALUES (?, ?, 1) ON CONFLICT(day, src) DO UPDATE SET n = n + 1').bind(day, label));
  }
  // 방문 1건 기록: 첫 페이지면 새 줄, 아니면 그 방문의 본 페이지에 더함 (20개까지 목록)
  if (vid && b.f) {
    const r = refUrl(b.r);
    const refHost = r && r.hostname.replace(/^www\./, '') !== url.hostname.replace(/^www\./, '') ? r.hostname.replace(/^www\./, '').slice(0, 80) : '';
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO visits (vid, day, at, last_at, src, kw, ad, ref, landing, pages, plist, mobile, region) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)')
      .bind(vid, day, now, now, label, keywordOf(b.p, b.r, label), adTags(b.p), refHost, path, path, mobile, regionOf(request.cf)));
  } else if (vid) {
    stmts.push(env.DB.prepare("UPDATE visits SET pages = pages + 1, last_at = ?, plist = CASE WHEN pages < 20 THEN plist || char(10) || ? ELSE plist END WHERE vid = ?").bind(now, path, vid));
  }
  await env.DB.batch(stmts);
  return ok;
}

// 견적문의가 들어오면 그 방문에 문의 번호를 붙임 (contact.js)
export async function linkInquiry(env, vid, inquiryId) {
  if (!/^[a-z0-9]{8,32}$/.test(String(vid || '')) || !inquiryId) return;
  await env.DB.prepare('UPDATE visits SET inquiry_id = ? WHERE vid = ? AND inquiry_id IS NULL').bind(inquiryId, vid).run();
}

// 경로별 방문 수 + 문의 수를 한 줄로 합침 (경로별 효과 비교용)
function mergeSources(visits, inquiries) {
  const m = new Map();
  const row = (k) => m.get(k) || m.set(k, { src: k, n: 0, inq: 0 }).get(k);
  for (const r of visits) row(ALIAS[r.src] || r.src).n += r.n;
  for (const r of inquiries) row(r.src == null ? '경로 기록 전' : srcLabel(r.src)).inq += r.n;
  return [...m.values()].sort((a, b) => b.n - a.n || b.inq - a.inq);
}

// 페이지 주소 → 사람이 읽는 이름 (설치사례 상세는 글 제목)
async function pageLabeler(env, paths) {
  const ids = [...new Set(paths.map((p) => /id=(\d+)/.exec(p)).filter(Boolean).map((m) => Number(m[1])))].slice(0, 300);
  const titles = {};
  if (ids.length) {
    const { results } = await env.DB.prepare(`SELECT id, title FROM cases WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
    for (const r of results) titles[r.id] = r.title;
  }
  return (p) => {
    if (p === '/') return '홈 (첫 화면)';
    if (p === '/cases.html') return '설치사례 전체 목록';
    if (p.startsWith('/cases.html?')) return '설치사례 목록 (' + p.slice(12).replace(/&/g, ' · ') + ')';
    if (p === '/privacy.html') return '개인정보처리방침';
    const m = /id=(\d+)/.exec(p);
    if (m) return '사례: ' + (titles[m[1]] || '#' + m[1]);
    if (p === '/case.html') return '설치사례 상세 (예시)';
    return p;
  };
}

export async function statsAdmin(env) {
  const today = kst().slice(0, 10);
  const dayAgo = (n) => kst(-n * 864e5).slice(0, 10);
  const from = dayAgo(29);
  // 합계는 400일, 방문 1건 기록은 90일 지나면 정리 (관리자 화면 열 때만 → 방문자 쪽 부담 없음)
  const old = dayAgo(400);
  await env.DB.batch([
    ...['visit_uniq', 'visit_pages', 'visit_refs'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE day < ?`).bind(old)),
    env.DB.prepare('DELETE FROM visits WHERE day < ?').bind(dayAgo(VISIT_DAYS)),
  ]);

  const [uv, pv, refs, pages, mob, inq, inqSrc] = await Promise.all([
    env.DB.prepare('SELECT day, COUNT(*) AS n FROM visit_uniq WHERE day >= ? GROUP BY day').bind(from).all(),
    env.DB.prepare('SELECT day, SUM(n) AS n FROM visit_pages WHERE day >= ? GROUP BY day').bind(from).all(),
    env.DB.prepare('SELECT src, SUM(n) AS n FROM visit_refs WHERE day >= ? GROUP BY src ORDER BY n DESC LIMIT 20').bind(from).all(),
    env.DB.prepare('SELECT path, SUM(n) AS n FROM visit_pages WHERE day >= ? GROUP BY path ORDER BY n DESC LIMIT 10').bind(from).all(),
    env.DB.prepare('SELECT SUM(mobile) AS m, COUNT(*) AS n FROM visit_uniq WHERE day >= ?').bind(from).first(),
    env.DB.prepare('SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM inquiries WHERE created_at >= ? GROUP BY day').bind(from).all(),
    env.DB.prepare("SELECT json_extract(spec, '$.src') AS src, COUNT(*) AS n FROM inquiries WHERE created_at >= ? GROUP BY src").bind(from).all(),
  ]);
  const map = (rows) => Object.fromEntries(rows.results.map((r) => [r.day, r.n]));
  const U = map(uv), P = map(pv), I = map(inq);
  const days = [];
  for (let i = 29; i >= 0; i--) { const d = dayAgo(i); days.push({ day: d, uv: U[d] || 0, pv: P[d] || 0, inq: I[d] || 0 }); }
  const sum = (n) => days.slice(-n).reduce((a, d) => a + d.uv, 0);
  const label = await pageLabeler(env, pages.results.map((r) => r.path));
  return json({
    ok: true,
    today: U[today] || 0,
    yesterday: U[dayAgo(1)] || 0,
    todayPv: P[today] || 0,
    week: sum(7),
    month: sum(30),
    mobileShare: mob && mob.n ? Math.round((mob.m / mob.n) * 100) : null,
    days,
    sources: mergeSources(refs.results, inqSrc.results),
    pages: pages.results.map((r) => ({ path: r.path, label: label(r.path), n: r.n })),
  });
}

// 관리자 '최근 방문' 목록: range = today | yesterday | 7d. 고른 기간의 줄만 읽음 (최대 500줄)
export async function visitsAdmin(request, env) {
  await ensureSchema(env);
  const range = new URL(request.url).searchParams.get('range');
  const dayAgo = (n) => kst(-n * 864e5).slice(0, 10);
  const [a, b] = range === 'yesterday' ? [dayAgo(1), dayAgo(1)] : range === '7d' ? [dayAgo(6), dayAgo(0)] : [dayAgo(0), dayAgo(0)];
  const { results } = await env.DB.prepare(
    'SELECT at, src, kw, ad, ref, landing, pages, plist, mobile, region, inquiry_id FROM visits WHERE day >= ? AND day <= ? ORDER BY at DESC LIMIT 500'
  ).bind(a, b).all();
  const label = await pageLabeler(env, results.flatMap((r) => String(r.plist || r.landing || '').split('\n')));
  const items = results.map((r) => {
    const plist = String(r.plist || r.landing || '').split('\n').filter(Boolean);
    return {
      at: r.at, src: ALIAS[r.src] || r.src,
      kw: r.kw || (r.src === '구글 검색' ? '(구글: 검색어 비공개)' : ''),
      ad: r.ad || '', ref: r.ref || '',
      landing: { path: r.landing, label: label(r.landing || '/') },
      pages: r.pages, plist: plist.map((p) => ({ path: p, label: label(p) })),
      mobile: r.mobile, region: r.region || '', inquiry: r.inquiry_id || null,
    };
  });
  return json({ ok: true, from: a, to: b, items, more: results.length >= 500 });
}

// 관리자: 회사 인터넷 주소 목록 보기·추가·삭제. 지금 관리자 화면을 연 곳의 주소도 알려 줌 (화면에서 '이 주소 추가')
export async function statsExcludeAdmin(request, env) {
  await ensureSchema(env);
  const me = ipKey(request.headers.get('cf-connecting-ip') || '');
  let list = await excludeList(env);
  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    if (body.add === 'me' && me && !list.some((x) => x.ip === me)) {
      list.push({ ip: me, name: clean(body.name, 30) || '회사', at: kst().slice(0, 16) });
    }
    if (body.remove) list = list.filter((x) => x.ip !== String(body.remove));
    list = list.slice(0, 20);
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('statsExclude', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(list)).run();
    dropExcludeCache();
  }
  return json({ ok: true, list, me, meListed: list.some((x) => x.ip === me) });
}
