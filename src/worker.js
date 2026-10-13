// 거산리프트 홈페이지 서버 코드
// - /api/contact        견적·상담 문의 접수 (DB 저장 → 메일 알림)
// - /api/cases          홈페이지에 보여줄 설치사례 목록
// - /api/admin/...      관리자 기능 (로그인 필요)
// - /photos/...         관리자가 올린 설치사례 사진
// - 그 외 주소는 public/ 폴더의 정적 파일을 그대로 보여줌
import { json } from './util.js';
import { handleContact } from './contact.js';
import { handleAdmin, publicCases, publicSite, servePhoto } from './admin.js';

const OOPS = '일시적인 오류가 발생했습니다. 전화(031-986-5345)로 연락 부탁드립니다.';

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/api/contact') return await handleContact(request, env, ctx);
      if (path === '/api/cases') return await publicCases(env);
      if (path === '/api/site') return await publicSite(env);
      if (path.startsWith('/api/admin/')) return await handleAdmin(request, env, path);
      if (path.startsWith('/photos/')) return await servePhoto(request, env, path);
      if (path.startsWith('/api/')) return json({ ok: false, error: 'Not found' }, 404);
    } catch (e) {
      console.error('server error', path, e);
      return json({ ok: false, error: OOPS }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};
