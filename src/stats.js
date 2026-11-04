// 방문자 통계 (직접 집계)
// - 페이지를 열면 홈페이지 track.js 가 /api/hit 로 신호를 보냄 { p: 주소, r: 이전 페이지, v: 방문번호, f: 방문의 첫 페이지면 1 }
// - 날짜별 합계 (400일 보관): 같은 날 같은 기기는 방문자 1명 (IP는 저장하지 않고, 날짜가 섞인 암호화 값만 → 다음 날이면 연결 불가)
// - 방문 1건 기록 (visits, 90일 보관): 시각·경로·검색어·광고 이름표·첫 페이지·본 페이지·기기·시도·문의 번호
//   방문번호는 브라우저가 만든 무작위 값(30분 동안 아무 페이지도 안 보면 새 번호) → 사람을 알아볼 수 없음
// - 직원(관리자 로그인 중·로그인한 적 있는 기기·?gs_staff=1·회사 인터넷)과 로봇 의심(데이터센터 접속망·자동 프로그램)은
//   방문 1건 기록에는 남기되(관리자 화면에서 기본 숨김) 날짜별 합계에는 넣지 않음. 전화·견적 문의를 하면 사람으로 봄
// - 페이지 안 행동(머문 시간·처음 페이지 스크롤·누른 것): 다음 페이지 신호에 실어 오고, 떠날 때 방문당 1번만 따로 옴
// - DB 사용 (방문 1번): 첫 페이지 = 읽기 약 2 · 쓰기 약 6 / 다음 페이지 = 읽기 약 3 · 쓰기 약 3 / 떠날 때 = 읽기 1 · 쓰기 1
//   (설정 기억이 5분 지났을 때만 +2줄 읽기)
import { json, kst, ensureSchema, clean } from './util.js';

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
  if (q.get('n_media') || q.get('n_query') || q.get('n_keyword')) return 'naver';
  if (q.get('k_query') || q.get('k_keyword')) return 'kakao';
  const r = refUrl(ref);
  const h = r ? r.hostname.replace(/^www\./, '') : '';
  if (h && h !== host.replace(/^www\./, '')) return h;
  if (/KAKAOTALK/i.test(ua)) return 'kakaotalk';
  if (/NAVER\(inapp/i.test(ua)) return 'naver-app';
  return 'direct';
}

// 광고 추적 값 꺼내기: 주소의 %EC%97… (UTF-8)은 URLSearchParams가 이미 풀어 줌.
// 광고 쪽에서 두 번 인코딩해 보내는 경우(%25EC…)도 있어 % 모양이 남아 있으면 한 번 더 푼다(최대 2번, 깨진 값은 그대로).
export function adVal(q, k, max = 50) {
  let v = String(q.get(k) || '');
  for (let i = 0; i < 2 && /%[0-9A-Fa-f]{2}/.test(v); i++) {
    try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch { break; }
  }
  if (v.includes('\uFFFD')) return ''; // UTF-8이 아닌 값(깨진 글자)은 버림
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
// 실제 검색어(손님이 친 말): 네이버 n_query · 카카오 k_query 또는 utm_term
export function adQuery(p) {
  const q = qs(p);
  return adVal(q, 'n_query') || adVal(q, 'k_query') || adVal(q, 'utm_term');
}
// 등록 키워드(우리가 광고에 넣은 말): 네이버 n_keyword · 카카오 k_keyword
export function adKeyword(p) {
  const q = qs(p);
  return adVal(q, 'n_keyword') || adVal(q, 'k_keyword');
}

// 검색어: 광고 실제 검색어 → 없으면 이전 페이지 주소에 담겨 온 검색어 (구글은 주지 않음)
const KW_PARAM = { '네이버 검색': ['query', 'oquery'], '다음 검색': ['q'], '빙 검색': ['q'], '구글 검색': ['q'], '야후 검색': ['p'], '줌 검색': ['query'] };
function keywordOf(p, ref, label) {
  const ad = adQuery(p);
  if (ad) return ad;
  const r = refUrl(ref);
  if (!r) return '';
  // 네이버 광고는 이전 페이지가 search.naver.com 이 아닐 때도 있음(광고 클릭 중간 주소) → 검색 사이트 판단은 주소로
  const keys = KW_PARAM[hostLabel(r.hostname)] || [];
  for (const k of keys) { const v = r.searchParams.get(k); if (v) return v.trim().slice(0, 50); }
  return '';
}

// 광고·홍보 이름표 전부 (utm_* + 네이버 광고 추적 n_* + 카카오 광고 추적 k_*)
// 실제 검색어(n_query·k_query·utm_term)는 kw 칸, 등록 키워드(n_keyword·k_keyword)는 adkw 칸에 따로 넣고 여기서는 뺌(같은 말 두 번 안 보이게)
const AD_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'n_media', 'n_ad_group', 'n_campaign_type', 'n_rank', 'n_ad', 'k_keyword_type'];
function adTags(p) {
  const q = qs(p), out = [];
  for (const k of AD_KEYS) { const v = adVal(q, k, 60); if (v) out.push(k + '=' + v); }
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

/* ---------- 브라우저 요약 · 로봇 판정 ----------
   브라우저 원문(User-Agent)은 저장하지 않고 "Chrome 130 · Android" 같은 요약만 저장 */
export function uaSummary(ua) {
  ua = String(ua || '');
  const auto = /HeadlessChrome|PhantomJS|Puppeteer|Playwright|Selenium|python|curl|wget|Go-http|okhttp|axios|node-fetch|java\//i.exec(ua);
  if (auto) return '자동 프로그램 (' + auto[0] + ')';
  const named = /(Googlebot|bingbot|Yeti|Daumoa|AdsBot[-\w]*|Google-InspectionTool|Applebot|YandexBot|Baiduspider|Bytespider|GPTBot|ClaudeBot|PetalBot|AhrefsBot|SemrushBot|MJ12bot|DotBot|facebookexternalhit|kakaotalk-scrap|[\w-]*(?:bot|spider|crawler))/i.exec(ua);
  if (named) return '로봇 (' + named[1].slice(0, 30) + ')';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '기타';
  const v = (re) => { const m = re.exec(ua); return m ? m[1] : ''; };
  let br;
  if (/KAKAOTALK/i.test(ua)) br = '카카오톡 앱';
  else if (/NAVER\(inapp/i.test(ua)) br = '네이버 앱';
  else if (/Whale\//.test(ua)) br = '웨일 ' + v(/Whale\/(\d+)/);
  else if (/SamsungBrowser\//.test(ua)) br = '삼성 인터넷 ' + v(/SamsungBrowser\/(\d+)/);
  else if (/Edg\//.test(ua)) br = 'Edge ' + v(/Edg\/(\d+)/);
  else if (/Firefox\//.test(ua)) br = 'Firefox ' + v(/Firefox\/(\d+)/);
  else if (/CriOS\//.test(ua)) br = 'Chrome ' + v(/CriOS\/(\d+)/);
  else if (/Chrome\//.test(ua)) br = 'Chrome ' + v(/Chrome\/(\d+)/);
  else if (/Safari\//.test(ua)) br = 'Safari';
  else br = '알 수 없음';
  return (br + ' · ' + os).slice(0, 40);
}

// 데이터센터(서버 회사) 접속망 — 사람이 집·회사·휴대폰에서 들어올 때는 보통 통신사(KT·SK브로드밴드·LG유플러스 등)로 보임
const DATACENTER = /google|amazon|aws|microsoft|azure|tencent|alibaba|aliyun|huawei|baidu|bytedance|digitalocean|ovh|hetzner|linode|oracle|vultr|choopa|contabo|leaseweb|m247|scaleway|datacamp|hostinger|kamatera|ionos|godaddy|zenlayer|ucloud|kingsoft|hostwinds|colocrossing|psychz|quadranet|servers\.com|g-core|gcore|constant company|hostroyale|selectel|timeweb|cloudflare|akamai|fastly|naver cloud|nhn cloud|kt cloud|gabia|cafe24|meta platforms|facebook|apple inc/i;
// 아이폰 'iCloud 비공개 릴레이'를 쓰는 사람은 Cloudflare·Akamai·Fastly(애플 협력사) 접속망으로 보임 → 사파리면 사람으로 봄
const RELAY = /cloudflare|akamai|fastly|apple inc/i;

// 기록 때의 판정 (합계에 넣을지 결정). 관리자 화면에서는 문의·전화·관리자 표시까지 더해 다시 판정함
export function botCheck(uaRaw, uaSum, net, userNets) {
  if (/^자동 프로그램|^로봇/.test(uaSum)) return uaSum;
  const ch = /Chrome\/(\d+)/.exec(uaRaw);
  if (ch && +ch[1] < 100 && !/SamsungBrowser|Whale|KAKAOTALK|NAVER/i.test(uaRaw)) return '아주 오래된 크롬 (' + ch[1] + ')';
  if (net && userNets.some((n) => net.toLowerCase() === n.toLowerCase())) return '로봇으로 등록한 접속망';
  if (net && DATACENTER.test(net)) {
    if (RELAY.test(net) && /Safari/.test(uaSum)) return '';
    return '데이터센터 접속망';
  }
  return '';
}

/* ---------- 설정 기억: 회사 인터넷 주소 · 로봇으로 등록한 접속망 ----------
   관리자 화면에서 등록 → 방문 때마다 DB를 읽지 않도록 5분 동안 기억 (서버 1대당 5분에 2줄 읽기) */
let exCache = { at: 0, ips: [], nets: [] };
export function dropExcludeCache() { exCache = { at: 0, ips: [], nets: [] }; }
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
async function readLists(env) {
  const out = { statsExclude: [], statsBotNets: [] };
  try {
    const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('statsExclude', 'statsBotNets')").all();
    for (const r of results) { try { const v = JSON.parse(r.value); if (Array.isArray(v)) out[r.key] = v; } catch {} }
  } catch {}
  return out;
}
export async function excludeList(env) { return (await readLists(env)).statsExclude; }
async function lists(env) {
  if (Date.now() - exCache.at > 300000) {
    const l = await readLists(env);
    exCache = { at: Date.now(), ips: l.statsExclude.map((x) => x.ip), nets: l.statsBotNets.map((x) => x.net) };
  }
  return exCache;
}

// 페이지 안 행동 (track.js가 다음 페이지 신호에 싣거나, 떠날 때 한 번 보냄)
function behavior(b) {
  const x = b && typeof b === 'object' ? b : {};
  const d = Math.min(Math.max(parseInt(x.d, 10) || 0, 0), 3600);
  const s = [0, 25, 50, 75, 100].includes(+x.s) ? +x.s : 0;
  const a = (parseInt(x.a, 10) || 0) & 15;
  return { d, s, a };
}

// 날짜별 합계에 넣기 (사람 방문만)
function sumStmts(env, day, h, mobile, path, label, firstOfDay) {
  const st = [env.DB.prepare('INSERT INTO visit_pages (day, path, n) VALUES (?, ?, 1) ON CONFLICT(day, path) DO UPDATE SET n = n + 1').bind(day, sumPath(path))];
  if (firstOfDay) st.push(env.DB.prepare('INSERT INTO visit_refs (day, src, n) VALUES (?, ?, 1) ON CONFLICT(day, src) DO UPDATE SET n = n + 1').bind(day, label));
  return st;
}

// 로봇 의심으로 합계에서 빠졌던 방문이 전화·견적 문의를 하면 → 사람으로 보고 그때 합계에 넣음
async function promote(env, request, vid) {
  const row = await env.DB.prepare("UPDATE visits SET counted = 1 WHERE vid = ? AND counted = 0 AND who = '' RETURNING day, src, landing, mobile").bind(vid).first();
  if (!row) return;
  const ip = request.headers.get('cf-connecting-ip') || '', ua = request.headers.get('user-agent') || '';
  const h = await hashHex(row.day + '|' + ip + '|' + ua + '|' + (env.ADMIN_PASSWORD || 'gslift'));
  const first = await env.DB.prepare('INSERT OR IGNORE INTO visit_uniq (day, h, mobile) VALUES (?, ?, ?)').bind(row.day, h, row.mobile).run();
  await env.DB.batch(sumStmts(env, row.day, h, row.mobile, row.landing || '/', row.src, first.meta && first.meta.changes));
}

export async function recordHit(request, env) {
  const ok = new Response(null, { status: 204 });
  if (request.method !== 'POST' || !env.DB) return ok;
  const ua = request.headers.get('user-agent') || '';
  if (!ua) return ok;
  let b = {};
  try { b = JSON.parse((await request.text()).slice(0, 3000)); } catch { return ok; }
  const vid = /^[a-z0-9]{8,32}$/.test(String(b.v || '')) ? String(b.v) : '';
  await ensureSchema(env);
  const bh = behavior(b.b);

  // 떠날 때 신호: 행동만 더함 (방문당 최대 1번 — track.js가 지킴)
  if (b.e) {
    if (!vid) return ok;
    await env.DB.prepare('UPDATE visits SET dwell = MAX(dwell, ?), scroll = MAX(scroll, ?), acts = acts | ? WHERE vid = ?').bind(bh.d, bh.s, bh.a, vid).run();
    if (bh.a & 2) await promote(env, request, vid);
    return ok;
  }

  const ip = request.headers.get('cf-connecting-ip') || '';
  const L = await lists(env);
  const cf = request.cf || {};
  const net = String(cf.asOrganization || '').slice(0, 60);
  const uaSum = uaSummary(ua);
  // 직원: 관리자 로그인 중 > 회사 인터넷 > 기기 표시(관리자 로그인한 적 있는 기기, ?gs_staff=1)
  const who = /(?:^|;\s*)gs_admin=/.test(request.headers.get('cookie') || '') ? 'admin'
    : ip && L.ips.includes(ipKey(ip)) ? 'office' : b.s ? 'staff' : '';
  const why = who ? '' : botCheck(ua, uaSum, net, L.nets);
  const human = !who && !why;

  const url = new URL(request.url);
  const now = kst(), day = now.slice(0, 10);
  const mobile = /Mobi|Android|iPhone|iPad/i.test(ua) ? 1 : 0;
  const path = cleanPath(String(b.p || '/'));
  const label = srcLabel(rawSource(b.p, b.r, ua, url.hostname));

  const stmts = [];
  // 날짜별 합계는 사람 방문만 (직원·로봇 의심은 빼고 방문 1건 기록에만 남김)
  if (human) {
    const h = await hashHex(day + '|' + ip + '|' + ua + '|' + (env.ADMIN_PASSWORD || 'gslift'));
    const first = await env.DB.prepare('INSERT OR IGNORE INTO visit_uniq (day, h, mobile) VALUES (?, ?, ?)').bind(day, h, mobile).run();
    stmts.push(...sumStmts(env, day, h, mobile, path, label, first.meta && first.meta.changes));
  }
  // 방문 1건 기록: 첫 페이지면 새 줄, 아니면 그 방문에 더함 (본 페이지 20개까지 + 지난 페이지까지의 행동)
  if (vid && b.f) {
    const r = refUrl(b.r);
    const refHost = r && r.hostname.replace(/^www\./, '') !== url.hostname.replace(/^www\./, '') ? r.hostname.replace(/^www\./, '').slice(0, 80) : '';
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO visits (vid, day, at, last_at, src, kw, adkw, ad, ref, landing, pages, plist, mobile, region, net, ua, who, bot, why, counted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(vid, day, now, now, label, keywordOf(b.p, b.r, label), adKeyword(b.p) || null, adTags(b.p), refHost, path, path, mobile, regionOf(cf), net, uaSum, who, why ? 1 : 0, why || null, human ? 1 : 0));
  } else if (vid) {
    stmts.push(env.DB.prepare('UPDATE visits SET pages = pages + 1, last_at = ?, plist = CASE WHEN pages < 20 THEN plist || char(10) || ? ELSE plist END, dwell = MAX(dwell, ?), scroll = MAX(scroll, ?), acts = acts | ? WHERE vid = ?')
      .bind(now, path, bh.d, bh.s, bh.a, vid));
  }
  if (stmts.length) await env.DB.batch(stmts);
  if (vid && !b.f && (bh.a & 2)) await promote(env, request, vid);
  return ok;
}

// 견적문의가 들어오면 그 방문에 문의 번호를 붙이고, 로봇 의심이었으면 사람으로 보고 합계에 넣음 (contact.js)
export async function linkInquiry(env, vid, inquiryId, request) {
  if (!/^[a-z0-9]{8,32}$/.test(String(vid || '')) || !inquiryId) return;
  await env.DB.prepare('UPDATE visits SET inquiry_id = ? WHERE vid = ? AND inquiry_id IS NULL').bind(inquiryId, vid).run();
  if (request) await promote(env, request, vid);
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

// 오래된 기록 정리: 날짜별 합계는 400일, 방문 1건 기록은 90일 지나면 삭제 (합계는 남음)
// 관리자 화면을 열 때만, 서버 1대당 6시간에 한 번 → 방문자 쪽 부담 없음
let cleanedAt = 0;
async function cleanup(env, dayAgo) {
  if (Date.now() - cleanedAt < 6 * 3600 * 1000) return;
  cleanedAt = Date.now();
  const old = dayAgo(400);
  await env.DB.batch([
    ...['visit_uniq', 'visit_pages', 'visit_refs'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE day < ?`).bind(old)),
    env.DB.prepare('DELETE FROM visits WHERE day < ?').bind(dayAgo(VISIT_DAYS)),
  ]);
}

export async function statsAdmin(env) {
  const today = kst().slice(0, 10);
  const dayAgo = (n) => kst(-n * 864e5).slice(0, 10);
  const from = dayAgo(29);
  await cleanup(env, dayAgo);

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

// 관리자 화면의 최종 판정: 직원 → 사람(문의·전화·관리자가 사람 표시) → 로봇 의심 → 확인 필요 → 사람
export function classify(r, nets) {
  if (r.who) return { cls: 'staff', why: { admin: '관리자 로그인 중', office: '회사 인터넷', staff: '직원 기기 표시' }[r.who] || '직원' };
  if (r.inquiry_id) return { cls: 'human', why: r.bot ? '견적 문의함 (원래 로봇 의심)' : '' };
  if (r.acts & 2) return { cls: 'human', why: r.bot ? '전화번호 누름 (원래 로봇 의심)' : '' };
  if (r.mark === 1) return { cls: 'human', why: '관리자가 사람으로 표시' };
  if (r.mark === 2) return { cls: 'bot', why: '관리자가 로봇으로 표시' };
  if (r.bot) return { cls: 'bot', why: r.why || '로봇 의심' };
  if (r.net && nets.some((n) => n.toLowerCase() === String(r.net).toLowerCase())) return { cls: 'bot', why: '로봇으로 등록한 접속망' };
  if (r.net == null && r.ua == null) return { cls: 'human', why: '' }; // 2026-11-03 전 기록 (판정 정보 없음)
  if (/^해외/.test(r.region || '') && /직접 입력/.test(r.src || '') && r.pages <= 1 && r.dwell < 3 && !r.acts) return { cls: 'check', why: '해외 · 직접 입력 · 1쪽 · 행동 없음' };
  return { cls: 'human', why: '' };
}

// 관리자 '최근 방문' 목록: range = today | yesterday | 7d. 고른 기간의 줄만 읽음 (최대 500줄)
export async function visitsAdmin(request, env) {
  await ensureSchema(env);
  const range = new URL(request.url).searchParams.get('range');
  const dayAgo = (n) => kst(-n * 864e5).slice(0, 10);
  const [a, b] = range === 'yesterday' ? [dayAgo(1), dayAgo(1)] : range === '7d' ? [dayAgo(6), dayAgo(0)] : [dayAgo(0), dayAgo(0)];
  const [{ results }, L] = await Promise.all([
    env.DB.prepare(
      'SELECT id, at, src, kw, adkw, ad, ref, landing, pages, plist, mobile, region, inquiry_id, net, ua, who, bot, why, mark, dwell, scroll, acts FROM visits WHERE day >= ? AND day <= ? ORDER BY at DESC LIMIT 500'
    ).bind(a, b).all(),
    readLists(env),
  ]);
  const nets = L.statsBotNets.map((x) => x.net);
  const label = await pageLabeler(env, results.flatMap((r) => String(r.plist || r.landing || '').split('\n')));
  const items = results.map((r) => {
    const plist = String(r.plist || r.landing || '').split('\n').filter(Boolean);
    const c = classify(r, nets);
    return {
      id: r.id, at: r.at, src: ALIAS[r.src] || r.src,
      kw: r.kw || (r.src === '구글 검색' ? '(구글: 검색어 비공개)' : ''),
      adkw: r.adkw || '', ad: r.ad || '', ref: r.ref || '',
      landing: { path: r.landing, label: label(r.landing || '/') },
      pages: r.pages, plist: plist.map((p) => ({ path: p, label: label(p) })),
      mobile: r.mobile, region: r.region || '', inquiry: r.inquiry_id || null,
      net: r.net == null ? null : r.net, ua: r.ua || '', cls: c.cls, why: c.why, mark: r.mark || 0,
      dwell: r.dwell || 0, scroll: r.scroll || 0, acts: r.acts || 0,
      netListed: !!(r.net && nets.some((n) => n.toLowerCase() === r.net.toLowerCase())),
    };
  });
  return json({ ok: true, from: a, to: b, items, more: results.length >= 500 });
}

// 관리자: 한 방문을 사람/로봇으로 고침 (화면 표시만 바뀜 — 이미 지난 날짜별 합계는 그대로)
export async function visitMarkAdmin(request, env, id) {
  let body = {};
  try { body = await request.json(); } catch {}
  const mark = [0, 1, 2].includes(+body.mark) ? +body.mark : 0;
  await env.DB.prepare('UPDATE visits SET mark = ? WHERE id = ?').bind(mark, id).run();
  return json({ ok: true });
}

// 관리자: 회사 인터넷 주소 · 로봇으로 처리할 접속망 목록 보기·추가·삭제
export async function statsExcludeAdmin(request, env) {
  await ensureSchema(env);
  const me = ipKey(request.headers.get('cf-connecting-ip') || '');
  const L = await readLists(env);
  let list = L.statsExclude, nets = L.statsBotNets;
  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    const save = async (key, v) => env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, JSON.stringify(v)).run();
    if (body.add === 'me' || body.remove) {
      if (body.add === 'me' && me && !list.some((x) => x.ip === me)) list.push({ ip: me, name: clean(body.name, 30) || '회사', at: kst().slice(0, 16) });
      if (body.remove) list = list.filter((x) => x.ip !== String(body.remove));
      list = list.slice(0, 20);
      await save('statsExclude', list);
    }
    if (body.addNet || body.removeNet) {
      const n = clean(body.addNet, 60);
      if (n && !nets.some((x) => x.net.toLowerCase() === n.toLowerCase())) nets.push({ net: n, at: kst().slice(0, 16) });
      if (body.removeNet) nets = nets.filter((x) => x.net !== String(body.removeNet));
      nets = nets.slice(0, 100);
      await save('statsBotNets', nets);
    }
    dropExcludeCache();
  }
  return json({ ok: true, list, me, meListed: list.some((x) => x.ip === me), nets });
}
