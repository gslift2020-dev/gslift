// 관리자 기능: 로그인, 문의 목록, 설치사례 사진 관리
import { json, clean, kst, ensureSchema } from './util.js';

const COOKIE = 'gs_admin';
const SESSION_SECONDS = 12 * 3600;
const MAX_FAILS = 5; // 15분 안에 5번 틀리면 잠금
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const STATUSES = ['new', 'progress', 'done'];

const enc = new TextEncoder();

async function hmacKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('gslift-admin-v1|' + env.ADMIN_PASSWORD));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function makeToken(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode('admin|' + exp));
  return exp + '.' + b64url(sig);
}

async function validToken(env, token) {
  const m = /^(\d+)\.([A-Za-z0-9_-]+)$/.exec(token || '');
  if (!m || Number(m[1]) < Date.now() / 1000) return false;
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(env), b64urlDecode(m[2]), enc.encode('admin|' + m[1]));
  } catch {
    return false;
  }
}

function readCookie(request, name) {
  const c = request.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : '';
}

// 비밀번호 비교 (길이·내용에 따라 걸리는 시간이 달라지지 않게 해시끼리 비교)
async function samePassword(a, b) {
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function isAdmin(request, env) {
  return !!env.ADMIN_PASSWORD && (await validToken(env, readCookie(request, COOKIE)));
}

// 사진 파일 종류를 내용으로 확인 (WebP 우선, WebP를 못 만드는 브라우저는 JPG)
function photoType(bytes) {
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP')
    return { ext: 'webp', mime: 'image/webp' };
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  return null;
}

async function login(request, env) {
  if (!env.ADMIN_PASSWORD) return json({ ok: false, error: '관리자 비밀번호(ADMIN_PASSWORD)가 아직 설정되지 않았습니다.' }, 503);
  const ip = request.headers.get('cf-connecting-ip') || '';
  const since = kst(-FAIL_WINDOW_MS);
  const fails = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ?').bind(ip, since).first();
  if (fails && fails.n >= MAX_FAILS) return json({ ok: false, error: '로그인 실패가 많아 15분간 잠겼습니다. 잠시 후 다시 시도해 주세요.' }, 429);

  let body = {};
  try { body = await request.json(); } catch {}
  if (!(await samePassword(String(body.password || ''), env.ADMIN_PASSWORD))) {
    await env.DB.prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)').bind(ip, kst()).run();
    const left = MAX_FAILS - 1 - (fails ? fails.n : 0);
    return json({ ok: false, error: left > 0 ? `비밀번호가 틀렸습니다. (남은 시도 ${left}회)` : '로그인 실패가 많아 15분간 잠겼습니다.' }, 401);
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ? OR at < ?').bind(ip, kst(-24 * 3600 * 1000)).run();
  const token = await makeToken(env);
  return json({ ok: true }, 200, {
    'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`,
  });
}

function logout() {
  return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
}

async function listInquiries(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, created_at, company, name, phone, product, message, status, email_sent, email_error FROM inquiries ORDER BY id DESC LIMIT 300'
  ).all();
  return json({ ok: true, items: results });
}

async function setInquiryStatus(request, env, id) {
  let body = {};
  try { body = await request.json(); } catch {}
  if (!STATUSES.includes(body.status)) return json({ ok: false, error: '잘못된 상태값입니다.' }, 400);
  await env.DB.prepare('UPDATE inquiries SET status = ? WHERE id = ?').bind(body.status, id).run();
  return json({ ok: true });
}

async function listCasesAdmin(env) {
  const { results } = await env.DB.prepare('SELECT id, created_at, title, sub, photo_key, visible FROM cases ORDER BY id DESC').all();
  return json({ ok: true, items: results.map((r) => ({ ...r, img: '/photos/' + r.photo_key })) });
}

async function addCase(request, env) {
  if (!env.PHOTOS) return json({ ok: false, error: '사진 저장소(R2)가 아직 연결되지 않았습니다.' }, 503);
  let form;
  try { form = await request.formData(); } catch { return json({ ok: false, error: '잘못된 요청입니다.' }, 400); }
  const title = clean(form.get('title'), 60);
  const sub = clean(form.get('sub'), 80);
  const file = form.get('photo');
  if (!title) return json({ ok: false, field: 'title', error: '현장명을 입력해 주세요.' }, 400);
  if (!file || typeof file === 'string') return json({ ok: false, field: 'photo', error: '사진을 선택해 주세요.' }, 400);
  if (file.size > MAX_PHOTO_BYTES) return json({ ok: false, error: '사진 용량이 너무 큽니다.' }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = photoType(bytes);
  if (!type) return json({ ok: false, error: '변환된 사진 형식이 올바르지 않습니다.' }, 400);

  const key = `cases/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${type.ext}`;
  await env.PHOTOS.put(key, bytes, {
    httpMetadata: { contentType: type.mime, cacheControl: 'public, max-age=31536000, immutable' },
  });
  const r = await env.DB.prepare('INSERT INTO cases (created_at, title, sub, photo_key) VALUES (?, ?, ?, ?)')
    .bind(kst(), title, sub, key).run();
  return json({ ok: true, id: r.meta.last_row_id, img: '/photos/' + key });
}

async function updateCase(request, env, id) {
  let body = {};
  try { body = await request.json(); } catch {}
  const row = await env.DB.prepare('SELECT id FROM cases WHERE id = ?').bind(id).first();
  if (!row) return json({ ok: false, error: '없는 항목입니다.' }, 404);
  if ('visible' in body) await env.DB.prepare('UPDATE cases SET visible = ? WHERE id = ?').bind(body.visible ? 1 : 0, id).run();
  if ('title' in body || 'sub' in body) {
    const title = clean(body.title, 60);
    if (!title) return json({ ok: false, error: '현장명을 입력해 주세요.' }, 400);
    await env.DB.prepare('UPDATE cases SET title = ?, sub = ? WHERE id = ?').bind(title, clean(body.sub, 80), id).run();
  }
  return json({ ok: true });
}

async function deleteCase(env, id) {
  const row = await env.DB.prepare('SELECT photo_key FROM cases WHERE id = ?').bind(id).first();
  if (!row) return json({ ok: false, error: '없는 항목입니다.' }, 404);
  if (env.PHOTOS) await env.PHOTOS.delete(row.photo_key);
  await env.DB.prepare('DELETE FROM cases WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

// 홈페이지용 공개 목록
export async function publicCases(env) {
  if (!env.DB) return json({ ok: true, items: [] });
  await ensureSchema(env);
  const { results } = await env.DB.prepare('SELECT id, title, sub, photo_key FROM cases WHERE visible = 1 ORDER BY id DESC LIMIT 60').all();
  return json(
    { ok: true, items: results.map((r) => ({ id: r.id, title: r.title, sub: r.sub || '', img: '/photos/' + r.photo_key })) },
    200,
    { 'cache-control': 'public, max-age=60' }
  );
}

// /photos/... 사진 제공
export async function servePhoto(request, env, path) {
  const key = decodeURIComponent(path.slice('/photos/'.length));
  if (!env.PHOTOS || !/^cases\/[\w-]+\.(webp|jpg)$/.test(key)) return new Response('Not found', { status: 404 });
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  return new Response(obj.body, { headers });
}

export async function handleAdmin(request, env, path) {
  if (!env.DB) return json({ ok: false, error: '서버 설정이 아직 완료되지 않았습니다.' }, 503);
  await ensureSchema(env);
  const method = request.method;

  // 다른 사이트에서 몰래 보내는 요청 차단: 관리자 화면만 붙이는 표시가 있어야 함
  if (method !== 'GET' && request.headers.get('x-gs-admin') !== '1') return json({ ok: false, error: '허용되지 않은 요청입니다.' }, 403);

  if (path === '/api/admin/login' && method === 'POST') return login(request, env);
  if (path === '/api/admin/logout' && method === 'POST') return logout();

  if (!(await isAdmin(request, env))) return json({ ok: false, error: '로그인이 필요합니다.', login: true }, 401);

  if (path === '/api/admin/me') return json({ ok: true });
  if (path === '/api/admin/inquiries' && method === 'GET') return listInquiries(env);
  let m = /^\/api\/admin\/inquiries\/(\d+)$/.exec(path);
  if (m && method === 'POST') return setInquiryStatus(request, env, Number(m[1]));
  if (path === '/api/admin/cases' && method === 'GET') return listCasesAdmin(env);
  if (path === '/api/admin/cases' && method === 'POST') return addCase(request, env);
  m = /^\/api\/admin\/cases\/(\d+)$/.exec(path);
  if (m && method === 'POST') return updateCase(request, env, Number(m[1]));
  if (m && method === 'DELETE') return deleteCase(env, Number(m[1]));
  return json({ ok: false, error: 'Not found' }, 404);
}
