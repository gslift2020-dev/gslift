// 거산리프트 홈페이지 서버 코드
// - /api/contact        견적·상담 문의 접수 (DB 저장 → 메일 알림)
// - /api/cases          홈페이지에 보여줄 설치사례 목록
// - /api/hit            방문 통계 신호
// - /api/admin/...      관리자 기능 (로그인 필요)
// - /photos/...         관리자가 올린 설치사례 사진
// - /, /case.html, /cases.html  관리자 설정(회사 정보·공지·질문)을 넣어서 보여줌
// - robots.txt, sitemap.xml     검색 등록용
// - 그 외 주소는 public/ 폴더의 정적 파일을 그대로 보여줌
import { json } from './util.js';
import { handleContact } from './contact.js';
import { handleAdmin, publicCases, publicCase, publicSite, servePhoto } from './admin.js';
import { recordHit } from './stats.js';
import { isPage, servePage } from './pages.js';
import { runImports } from './imports.js';

const OTHER_HOSTS = ['gslift.co.kr', 'www.gslift.co.kr'];
// 예전 홈페이지 주소를 새 주소로 (설치사례 게시판 → 설치사례 목록, 나머지 → 첫 화면)
function oldPath(path) {
  if (/^\/bbs\/sub3/i.test(path)) return '/cases.html';
  if (/^\/(default|bbs)(\/|$)/i.test(path)) return '/';
  return path;
}

const OOPS = '일시적인 오류가 발생했습니다. 전화(031-986-5345)로 연락 부탁드립니다.';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    // 예전 주소 정리: gslift.co.kr·www → gslift.kr, 예전 홈페이지 주소(/default/…, /bbs/…) → 새 페이지
    if (OTHER_HOSTS.includes(url.hostname)) return Response.redirect('https://gslift.kr' + oldPath(path) + url.search, 301);
    if (/^\/(default|bbs)(\/|$)/i.test(path)) return Response.redirect(url.origin + oldPath(path), 301);
    // Claude가 정리해 둔 설치사례가 있으면 뒤에서 가져오기 (방문자는 기다리지 않음)
    if (request.method === 'GET' && (path === '/' || path === '/api/cases' || path === '/api/admin/cases') && ctx && ctx.waitUntil) {
      ctx.waitUntil(runImports(request, env).catch((e) => console.error('import', e)));
    }
    try {
      if (path === '/api/contact') return await handleContact(request, env, ctx);
      if (path === '/api/cases') return await publicCases(request, env);
      const cm = /^\/api\/cases\/(\d+)$/.exec(path);
      if (cm) return await publicCase(env, Number(cm[1]));
      if (path === '/api/site') return await publicSite(env);
      if (path === '/api/hit') return await recordHit(request, env);
      if (path.startsWith('/api/admin/')) return await handleAdmin(request, env, path);
      if (path.startsWith('/photos/')) return await servePhoto(request, env, path);
      if (path.startsWith('/api/')) return json({ ok: false, error: 'Not found' }, 404);
      if ((request.method === 'GET' || request.method === 'HEAD') && isPage(path)) return await servePage(request, env);
    } catch (e) {
      console.error('server error', path, e);
      if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
      return json({ ok: false, error: OOPS }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};
