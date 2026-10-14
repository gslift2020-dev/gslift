// 방문자 통계 (직접 집계)
// - 페이지를 열면 /api/hit 로 신호가 옴
// - 같은 날 같은 기기는 방문자 1명 (IP를 저장하지 않고, 날짜가 섞인 암호화 값만 저장 → 다음 날이면 연결 불가)
// - 관리자 로그인 상태의 방문, 검색 로봇은 세지 않음
import { json, kst, ensureSchema } from './util.js';

const BOT = /bot|spider|crawl|slurp|headless|preview|facebookexternalhit|kakaotalk-scrap|yeti|daumoa|lighthouse|uptime/i;

function sourceOf(ref, host) {
  let h = '';
  try { h = new URL(ref).hostname.replace(/^www\./, ''); } catch { return '직접 방문'; }
  if (!h || h === host.replace(/^www\./, '')) return '직접 방문';
  if (/naver\./.test(h)) return '네이버';
  if (/google\./.test(h)) return '구글';
  if (/daum\.|kakao\./.test(h)) return '다음·카카오';
  if (/bing\./.test(h)) return 'Bing';
  if (/youtube\.|youtu\.be/.test(h)) return '유튜브';
  if (/instagram\.|facebook\.|band\.us|blog\./.test(h)) return 'SNS·블로그';
  return h.slice(0, 60);
}

function cleanPath(p) {
  try {
    const u = new URL(p, 'https://x');
    if (/^\/case(\.html)?$/.test(u.pathname)) {
      const id = u.searchParams.get('id');
      return id && /^\d+$/.test(id) ? '/case.html?id=' + id : '/case.html';
    }
    if (/^\/cases(\.html)?$/.test(u.pathname)) return '/cases.html';
    if (u.pathname === '/' || u.pathname === '/index.html') return '/';
    return u.pathname.slice(0, 80);
  } catch { return '/'; }
}

async function hashHex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d).slice(0, 10), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function recordHit(request, env) {
  const ok = new Response(null, { status: 204 });
  if (request.method !== 'POST' || !env.DB) return ok;
  const ua = request.headers.get('user-agent') || '';
  if (!ua || BOT.test(ua)) return ok;
  if (/(?:^|;\s*)gs_admin=/.test(request.headers.get('cookie') || '')) return ok;
  let b = {};
  try { b = JSON.parse((await request.text()).slice(0, 2000)); } catch { return ok; }
  await ensureSchema(env);
  const url = new URL(request.url);
  const day = kst().slice(0, 10);
  const ip = request.headers.get('cf-connecting-ip') || '';
  const h = await hashHex(day + '|' + ip + '|' + ua + '|' + (env.ADMIN_PASSWORD || 'gslift'));
  const mobile = /Mobi|Android|iPhone|iPad/i.test(ua) ? 1 : 0;
  const path = cleanPath(String(b.p || '/'));
  const first = await env.DB.prepare('INSERT OR IGNORE INTO visit_uniq (day, h, mobile) VALUES (?, ?, ?)').bind(day, h, mobile).run();
  const stmts = [env.DB.prepare('INSERT INTO visit_pages (day, path, n) VALUES (?, ?, 1) ON CONFLICT(day, path) DO UPDATE SET n = n + 1').bind(day, path)];
  // 유입 경로는 그날 첫 방문 때만 셈
  if (first.meta && first.meta.changes) {
    stmts.push(env.DB.prepare('INSERT INTO visit_refs (day, src, n) VALUES (?, ?, 1) ON CONFLICT(day, src) DO UPDATE SET n = n + 1').bind(day, sourceOf(String(b.r || ''), url.hostname)));
  }
  await env.DB.batch(stmts);
  return ok;
}

export async function statsAdmin(env) {
  const today = kst().slice(0, 10);
  const dayAgo = (n) => kst(-n * 864e5).slice(0, 10);
  const from = dayAgo(29);
  // 400일 지난 기록은 정리
  const old = dayAgo(400);
  await env.DB.batch(['visit_uniq', 'visit_pages', 'visit_refs'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE day < ?`).bind(old)));

  const [uv, pv, refs, pages, mob, inq] = await Promise.all([
    env.DB.prepare('SELECT day, COUNT(*) AS n FROM visit_uniq WHERE day >= ? GROUP BY day').bind(from).all(),
    env.DB.prepare('SELECT day, SUM(n) AS n FROM visit_pages WHERE day >= ? GROUP BY day').bind(from).all(),
    env.DB.prepare('SELECT src, SUM(n) AS n FROM visit_refs WHERE day >= ? GROUP BY src ORDER BY n DESC LIMIT 8').bind(from).all(),
    env.DB.prepare('SELECT path, SUM(n) AS n FROM visit_pages WHERE day >= ? GROUP BY path ORDER BY n DESC LIMIT 10').bind(from).all(),
    env.DB.prepare('SELECT SUM(mobile) AS m, COUNT(*) AS n FROM visit_uniq WHERE day >= ?').bind(from).first(),
    env.DB.prepare('SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM inquiries WHERE created_at >= ? GROUP BY day').bind(from).all(),
  ]);
  const map = (rows) => Object.fromEntries(rows.results.map((r) => [r.day, r.n]));
  const U = map(uv), P = map(pv), I = map(inq);
  const days = [];
  for (let i = 29; i >= 0; i--) { const d = dayAgo(i); days.push({ day: d, uv: U[d] || 0, pv: P[d] || 0, inq: I[d] || 0 }); }
  const sum = (n) => days.slice(-n).reduce((a, d) => a + d.uv, 0);

  // 설치사례 상세 주소는 글 제목으로 바꿔서 보여줌
  const ids = pages.results.map((r) => /id=(\d+)/.exec(r.path)).filter(Boolean).map((m) => Number(m[1]));
  const titles = {};
  if (ids.length) {
    const { results } = await env.DB.prepare(`SELECT id, title FROM cases WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
    for (const r of results) titles[r.id] = r.title;
  }
  const label = (p) => {
    if (p === '/') return '홈 (첫 화면)';
    if (p === '/cases.html') return '설치사례 전체 목록';
    if (p === '/privacy.html') return '개인정보처리방침';
    const m = /id=(\d+)/.exec(p);
    if (m) return '사례: ' + (titles[m[1]] || '#' + m[1]);
    if (p === '/case.html') return '설치사례 상세 (예시)';
    return p;
  };
  return json({
    ok: true,
    today: U[today] || 0,
    yesterday: U[dayAgo(1)] || 0,
    todayPv: P[today] || 0,
    week: sum(7),
    month: sum(30),
    mobileShare: mob && mob.n ? Math.round((mob.m / mob.n) * 100) : null,
    days,
    sources: refs.results,
    pages: pages.results.map((r) => ({ path: r.path, label: label(r.path), n: r.n })),
  });
}
