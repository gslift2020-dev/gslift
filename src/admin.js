// 관리자 기능: 로그인, 문의, 설치사례(여러 사진·글), 메인 슬라이드, 설정
import { json, clean, kst, ensureSchema, CATS, inferCat } from './util.js';
import { specRows } from './contact.js';
import { cleanCompany, cleanFaq, dropSiteCache, DEFAULT_COMPANY, DEFAULT_FAQ } from './site.js';
import { statsAdmin } from './stats.js';

export { CATS, inferCat };

const COOKIE = 'gs_admin';
const SESSION_SECONDS = 12 * 3600;
const MAX_FAILS = 5; // 15분 안에 5번 틀리면 잠금
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_PHOTOS_PER_CASE = 20;
const MAX_SLIDES = 10;

const STATUSES = ['new', 'progress', 'done'];

export const DEFAULT_CHIPS = [
  { name: '적재하중', items: ['1톤', '2톤', '3톤', '4톤', '5톤', '6톤', '7톤'] },
  { name: '정지층', items: ['1STOP', '2STOP', '3STOP', '4STOP', '5STOP', '6STOP', '7STOP', '8STOP'] },
  { name: '출입방향', items: ['일방향', '양방향'] },
  { name: '설치위치', items: ['실내', '외부'] },
];

const enc = new TextEncoder();

/* ---------- 로그인 ---------- */

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
// 비밀번호 비교 (내용에 따라 걸리는 시간이 달라지지 않게 해시끼리 비교)
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

async function login(request, env) {
  if (!env.ADMIN_PASSWORD) return json({ ok: false, error: '관리자 비밀번호(ADMIN_PASSWORD)가 아직 설정되지 않았습니다.' }, 503);
  const ip = request.headers.get('cf-connecting-ip') || '';
  const fails = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ?').bind(ip, kst(-FAIL_WINDOW_MS)).first();
  if (fails && fails.n >= MAX_FAILS) return json({ ok: false, error: '로그인 실패가 많아 15분간 잠겼습니다. 잠시 후 다시 시도해 주세요.' }, 429);

  let body = {};
  try { body = await request.json(); } catch {}
  if (!(await samePassword(String(body.password || ''), env.ADMIN_PASSWORD))) {
    await env.DB.prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)').bind(ip, kst()).run();
    const left = MAX_FAILS - 1 - (fails ? fails.n : 0);
    return json({ ok: false, error: left > 0 ? `비밀번호가 틀렸습니다. (남은 시도 ${left}회)` : '로그인 실패가 많아 15분간 잠겼습니다.' }, 401);
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ? OR at < ?').bind(ip, kst(-24 * 3600 * 1000)).run();
  return json({ ok: true }, 200, {
    'set-cookie': `${COOKIE}=${await makeToken(env)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`,
  });
}
function logout() {
  return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
}

/* ---------- 사진 저장 ---------- */

// 사진 파일 종류를 내용으로 확인 (WebP 우선, WebP를 못 만드는 브라우저는 JPG)
function photoType(bytes) {
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP')
    return { ext: 'webp', mime: 'image/webp' };
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  return null;
}

// 업로드된 사진 하나를 검사해서 R2에 저장하고 키를 돌려줌
async function storePhoto(env, file, folder) {
  if (!file || typeof file === 'string') throw new UserError('사진 파일이 비어 있습니다.');
  if (file.size > MAX_PHOTO_BYTES) throw new UserError('사진 용량이 너무 큽니다.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = photoType(bytes);
  if (!type) throw new UserError('변환된 사진 형식이 올바르지 않습니다.');
  const key = `${folder}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${type.ext}`;
  await env.PHOTOS.put(key, bytes, {
    httpMetadata: { contentType: type.mime, cacheControl: 'public, max-age=31536000, immutable' },
  });
  return key;
}

class UserError extends Error {}

function photoUrl(key) {
  return '/photos/' + key;
}

// order: ["p:12", "n:0", ...]  p=이미 있는 사진 id, n=이번에 새로 올린 사진 순번
function parseOrder(raw, max) {
  let order;
  try { order = JSON.parse(raw || '[]'); } catch { throw new UserError('사진 순서 정보가 잘못되었습니다.'); }
  if (!Array.isArray(order) || order.length > max || !order.every((t) => /^[pn]:\d+$/.test(t)))
    throw new UserError('사진 순서 정보가 잘못되었습니다.');
  return order;
}

/* ---------- 문의 ---------- */

// 개인정보 보유 기간(3년)이 지난 문의는 첨부 사진과 함께 자동 삭제
const KEEP_INQUIRY_MS = 3 * 365 * 24 * 3600 * 1000;
async function purgeOldInquiries(env) {
  const cutoff = kst(-KEEP_INQUIRY_MS);
  const { results } = await env.DB.prepare('SELECT id, photos FROM inquiries WHERE created_at < ? LIMIT 200').bind(cutoff).all();
  if (!results.length) return;
  for (const r of results) {
    let keys = [];
    try { keys = JSON.parse(r.photos || '[]') || []; } catch {}
    if (env.PHOTOS) for (const k of keys) await env.PHOTOS.delete(k);
  }
  await env.DB.batch(results.map((r) => env.DB.prepare('DELETE FROM inquiries WHERE id = ?').bind(r.id)));
}

async function listInquiries(env) {
  await purgeOldInquiries(env);
  const { results } = await env.DB.prepare(
    'SELECT id, created_at, company, name, phone, product, message, spec, photos, memo, status, email_sent, email_error FROM inquiries ORDER BY id DESC LIMIT 1000'
  ).all();
  const parse = (s, d) => { try { return JSON.parse(s || '') || d; } catch { return d; } };
  return json({
    ok: true,
    items: results.map((r) => ({
      ...r,
      spec: specRows(parse(r.spec, {})),
      photos: parse(r.photos, []).map((k) => '/api/admin/inq-photo/' + encodeURIComponent(k)),
    })),
  });
}
async function setInquiryStatus(request, env, id) {
  let body = {};
  try { body = await request.json(); } catch {}
  if ('status' in body) {
    if (!STATUSES.includes(body.status)) return json({ ok: false, error: '잘못된 상태값입니다.' }, 400);
    await env.DB.prepare('UPDATE inquiries SET status = ? WHERE id = ?').bind(body.status, id).run();
  }
  if ('memo' in body) await env.DB.prepare('UPDATE inquiries SET memo = ? WHERE id = ?').bind(clean(body.memo, 3000), id).run();
  return json({ ok: true });
}

async function deleteInquiry(env, id) {
  const r = await env.DB.prepare('SELECT photos FROM inquiries WHERE id = ?').bind(id).first();
  if (!r) return json({ ok: false, error: '없는 문의입니다.' }, 404);
  let keys = [];
  try { keys = JSON.parse(r.photos || '[]') || []; } catch {}
  if (env.PHOTOS) for (const k of keys) await env.PHOTOS.delete(k);
  await env.DB.prepare('DELETE FROM inquiries WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

// 문의 사진은 로그인한 관리자만 볼 수 있음
async function inquiryPhoto(env, key) {
  if (!env.PHOTOS || !/^inquiries\/[\w-]+\.(jpg|webp|png)$/.test(key)) return new Response('Not found', { status: 404 });
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('cache-control', 'private, max-age=3600');
  return new Response(obj.body, { headers });
}

/* ---------- 설치사례 ---------- */

async function casePhotos(env, ids) {
  if (!ids.length) return {};
  const { results } = await env.DB.prepare(
    `SELECT id, case_id, photo_key FROM case_photos WHERE case_id IN (${ids.map(() => '?').join(',')}) ORDER BY case_id, sort, id`
  ).bind(...ids).all();
  const map = {};
  for (const r of results) (map[r.case_id] = map[r.case_id] || []).push({ id: r.id, img: photoUrl(r.photo_key) });
  return map;
}

// 정렬: 고정한 글 → 설치(촬영) 날짜 최신순 → 올린 순서
const CASE_ORDER = "ORDER BY pinned DESC, COALESCE(taken_at, substr(created_at, 1, 10)) DESC, id DESC";

// 분류·검색 조건 (관리자/홈페이지 공용)
function caseWhere(url, onlyVisible) {
  const where = [], args = [];
  if (onlyVisible) where.push('visible = 1');
  const cat = url.searchParams.get('cat');
  if (CATS[cat]) { where.push('category = ?'); args.push(cat); }
  const q = clean(url.searchParams.get('q'), 40);
  if (q) {
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    // 내부 메모는 관리자 검색에서만 찾음 (홈페이지에는 절대 노출 안 함)
    if (onlyVisible) { where.push('(title LIKE ? OR site LIKE ? OR body LIKE ?)'); args.push(like, like, like); }
    else { where.push("(title LIKE ? OR site LIKE ? OR body LIKE ? OR IFNULL(note, '') LIKE ?)"); args.push(like, like, like, like); }
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}
function pageArgs(url, def, max) {
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || def, 1), max);
  const offset = Math.max(parseInt(url.searchParams.get('offset'), 10) || 0, 0);
  return { limit, offset };
}
async function catCounts(env, onlyVisible) {
  const { results } = await env.DB.prepare(`SELECT category, COUNT(*) AS n FROM cases ${onlyVisible ? 'WHERE visible = 1' : ''} GROUP BY category`).all();
  const counts = { all: 0, fl: 0, tl: 0, st: 0, tr: 0 };
  for (const r of results) { const c = CATS[r.category] ? r.category : 'fl'; counts[c] += r.n; counts.all += r.n; }
  return counts;
}

async function listCasesAdmin(request, env) {
  const url = new URL(request.url);
  const w = caseWhere(url, false), { limit, offset } = pageArgs(url, 60, 200);
  const [{ results }, total, counts] = await Promise.all([
    env.DB.prepare(`SELECT id, created_at, updated_at, taken_at, title, sub, site, body, note, category, visible, pinned FROM cases ${w.sql} ${CASE_ORDER} LIMIT ? OFFSET ?`).bind(...w.args, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM cases ${w.sql}`).bind(...w.args).first(),
    catCounts(env, false),
  ]);
  const photos = await casePhotos(env, results.map((r) => r.id));
  return json({
    ok: true, total: total.n, counts,
    items: results.map((r) => ({ ...r, pinned: r.pinned ? 1 : 0, cat: CATS[r.category] ? r.category : inferCat(r.title), site: r.site ?? r.sub ?? '', photos: photos[r.id] || [] })),
  });
}

function caseFields(form) {
  const title = clean(form.get('title'), 120);
  if (!title) throw new UserError('제목을 입력하거나 사양 버튼을 골라주세요.');
  const c = String(form.get('category') || '');
  // 설치 날짜: 2023-05 또는 2023-05-17 (비우면 올린 날짜)
  const d = clean(form.get('date'), 10);
  let date = null;
  if (d) {
    const m = /^(20\d\d|19\d\d)-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.exec(d);
    if (!m) throw new UserError('날짜는 2023-05 또는 2023-05-17 처럼 적어주세요.');
    date = `${m[1]}-${m[2]}-${m[3] || '01'}`;
  }
  return { title, cat: CATS[c] ? c : inferCat(title), site: clean(form.get('site'), 80), body: clean(form.get('body'), 5000), note: clean(form.get('note'), 300), date, hidden: form.get('visible') === '0' };
}

// 새 글 또는 수정: 사진 순서(order)대로 저장
async function saveCase(request, env, id) {
  if (!env.PHOTOS) return json({ ok: false, error: '사진 저장소(R2)가 아직 연결되지 않았습니다.' }, 503);
  let form;
  try { form = await request.formData(); } catch { return json({ ok: false, error: '잘못된 요청입니다.' }, 400); }
  try {
    const f = caseFields(form);
    const order = parseOrder(form.get('order'), MAX_PHOTOS_PER_CASE);
    if (!order.length) throw new UserError('사진을 1장 이상 올려주세요.');
    const files = form.getAll('photos');

    let existing = [];
    if (id) {
      const row = await env.DB.prepare('SELECT id FROM cases WHERE id = ?').bind(id).first();
      if (!row) return json({ ok: false, error: '없는 글입니다.' }, 404);
      existing = (await env.DB.prepare('SELECT id, photo_key FROM case_photos WHERE case_id = ?').bind(id).all()).results;
    }
    const existingById = Object.fromEntries(existing.map((p) => [p.id, p]));

    // 새 사진 먼저 저장
    const newKeys = {};
    for (const t of order) {
      if (t[0] === 'n') {
        const i = Number(t.slice(2));
        if (!files[i]) throw new UserError('사진 파일이 빠졌습니다. 다시 시도해 주세요.');
        newKeys[i] = await storePhoto(env, files[i], 'cases');
      } else if (!existingById[Number(t.slice(2))]) {
        throw new UserError('이미 삭제된 사진이 포함되어 있습니다. 새로고침 후 다시 시도해 주세요.');
      }
    }
    const keys = order.map((t) => (t[0] === 'n' ? newKeys[Number(t.slice(2))] : existingById[Number(t.slice(2))].photo_key));

    if (!id) {
      const r = await env.DB.prepare('INSERT INTO cases (created_at, title, sub, site, body, note, category, photo_key, taken_at, visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(kst(), f.title, '', f.site, f.body, f.note, f.cat, keys[0], f.date, f.hidden ? 0 : 1).run();
      id = r.meta.last_row_id;
    } else {
      await env.DB.prepare('UPDATE cases SET title = ?, site = ?, body = ?, note = ?, category = ?, photo_key = ?, taken_at = ?, updated_at = ? WHERE id = ?')
        .bind(f.title, f.site, f.body, f.note, f.cat, keys[0], f.date, kst(), id).run();
    }
    const stmts = [env.DB.prepare('DELETE FROM case_photos WHERE case_id = ?').bind(id)];
    keys.forEach((k, i) => stmts.push(env.DB.prepare('INSERT INTO case_photos (case_id, photo_key, sort) VALUES (?, ?, ?)').bind(id, k, i)));
    await env.DB.batch(stmts);

    // 빠진 예전 사진은 저장소에서도 삭제
    const keep = new Set(keys);
    for (const p of existing) if (!keep.has(p.photo_key)) await env.PHOTOS.delete(p.photo_key);
    return json({ ok: true, id });
  } catch (e) {
    if (e instanceof UserError) return json({ ok: false, error: e.message }, 400);
    throw e;
  }
}

// 내부 메모 한꺼번에 넣기: 한 줄에 "글번호 = 메모" 또는 "가져오기묶음#순서 = 메모"
async function saveCaseNotes(request, env) {
  let body = {};
  try { body = await request.json(); } catch {}
  const lines = String(body.text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 500);
  let done = 0;
  const miss = [];
  for (const line of lines) {
    const m = /^([\w-]{3,60}#\d{1,3}|\d{1,7})\s*=\s*(.+)$/.exec(line);
    if (!m) { miss.push(line.slice(0, 40)); continue; }
    let id = null;
    if (m[1].includes('#')) {
      const [b, i] = m[1].split('#');
      const got = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(`import:${b}:${Number(i)}`).first();
      try { const v = JSON.parse(got ? got.value : '{}'); if (v.state === 'done') id = v.id; } catch {}
    } else id = Number(m[1]);
    const r = id ? await env.DB.prepare('UPDATE cases SET note = ? WHERE id = ?').bind(clean(m[2], 300), id).run() : null;
    if (r && r.meta && r.meta.changes) done++; else miss.push(line.slice(0, 40));
  }
  return json({ ok: true, done, miss });
}

async function setCaseVisible(request, env, id) {
  let body = {};
  try { body = await request.json(); } catch {}
  await env.DB.prepare('UPDATE cases SET visible = ? WHERE id = ?').bind(body.visible ? 1 : 0, id).run();
  return json({ ok: true });
}

// 맨 앞에 고정 (나중에 고정한 글이 더 앞)
async function setCasePinned(request, env, id) {
  let body = {};
  try { body = await request.json(); } catch {}
  await env.DB.prepare('UPDATE cases SET pinned = ? WHERE id = ?').bind(body.pinned ? Math.floor(Date.now() / 1000) : 0, id).run();
  return json({ ok: true });
}

async function deleteCase(env, id) {
  const { results } = await env.DB.prepare('SELECT photo_key FROM case_photos WHERE case_id = ?').bind(id).all();
  if (env.PHOTOS) for (const p of results) await env.PHOTOS.delete(p.photo_key);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM case_photos WHERE case_id = ?').bind(id),
    env.DB.prepare('DELETE FROM cases WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

/* ---------- 메인 슬라이드 ---------- */

async function getSlides(env) {
  const { results } = await env.DB.prepare('SELECT id, photo_key, tag, title FROM slides ORDER BY sort, id').all();
  return results.map((r) => ({ id: r.id, img: photoUrl(r.photo_key), tag: r.tag || '', title: r.title || '' }));
}

// 슬라이드 전체를 한 번에 저장: order + 각 장의 tag/title
async function saveSlides(request, env) {
  if (!env.PHOTOS) return json({ ok: false, error: '사진 저장소(R2)가 아직 연결되지 않았습니다.' }, 503);
  let form;
  try { form = await request.formData(); } catch { return json({ ok: false, error: '잘못된 요청입니다.' }, 400); }
  try {
    const order = parseOrder(form.get('order'), MAX_SLIDES);
    const tags = form.getAll('tag'), titles = form.getAll('title'), files = form.getAll('photos');
    const existing = (await env.DB.prepare('SELECT id, photo_key FROM slides').all()).results;
    const byId = Object.fromEntries(existing.map((s) => [s.id, s]));
    const rows = [];
    for (let i = 0; i < order.length; i++) {
      const t = order[i];
      let key;
      if (t[0] === 'n') key = await storePhoto(env, files[Number(t.slice(2))], 'slides');
      else if (byId[Number(t.slice(2))]) key = byId[Number(t.slice(2))].photo_key;
      else throw new UserError('이미 삭제된 사진이 포함되어 있습니다. 새로고침 후 다시 시도해 주세요.');
      rows.push({ key, tag: clean(tags[i], 30), title: clean(titles[i], 60) });
    }
    const stmts = [env.DB.prepare('DELETE FROM slides')];
    rows.forEach((r, i) => stmts.push(env.DB.prepare('INSERT INTO slides (photo_key, tag, title, sort) VALUES (?, ?, ?, ?)').bind(r.key, r.tag, r.title, i)));
    await env.DB.batch(stmts);
    const keep = new Set(rows.map((r) => r.key));
    for (const s of existing) if (!keep.has(s.photo_key)) await env.PHOTOS.delete(s.photo_key);
    return json({ ok: true, slides: await getSlides(env) });
  } catch (e) {
    if (e instanceof UserError) return json({ ok: false, error: e.message }, 400);
    throw e;
  }
}

/* ---------- 설정 (사양 버튼 묶음, 유튜브 영상) ---------- */

async function getSetting(env, key, fallback) {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return fallback; }
}
async function putSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, JSON.stringify(value)).run();
}

function cleanChips(v) {
  if (!Array.isArray(v)) throw new UserError('버튼 정보가 잘못되었습니다.');
  return v.slice(0, 12).map((g) => ({
    name: clean(g && g.name, 20) || '묶음',
    items: (Array.isArray(g && g.items) ? g.items : []).map((x) => clean(x, 30)).filter(Boolean).slice(0, 30),
  }));
}

// 유튜브 주소/아이디에서 영상 아이디(11자) 추출
export function youtubeId(s) {
  s = String(s || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function cleanVideos(v) {
  if (!Array.isArray(v)) throw new UserError('영상 정보가 잘못되었습니다.');
  const out = [];
  for (const x of v.slice(0, 12)) {
    const id = youtubeId(x && x.url != null ? x.url : x && x.id);
    if (!id) throw new UserError('유튜브 주소를 확인해 주세요: ' + clean(x && (x.url || x.id), 60));
    out.push({ id, title: clean(x.title, 60) });
  }
  return out;
}

async function getSettingsAdmin(env) {
  return json({
    ok: true,
    chips: await getSetting(env, 'chips', DEFAULT_CHIPS),
    videos: await getSetting(env, 'videos', []),
    hideSamples: !!(await getSetting(env, 'hideSamples', false)),
    slides: await getSlides(env),
    company: { ...DEFAULT_COMPANY, ...(await getSetting(env, 'company', {})) },
    faq: await getSetting(env, 'faq', DEFAULT_FAQ),
  });
}

async function saveSettings(request, env) {
  let body = {};
  try { body = await request.json(); } catch {}
  try {
    if ('chips' in body) await putSetting(env, 'chips', cleanChips(body.chips));
    if ('videos' in body) await putSetting(env, 'videos', cleanVideos(body.videos));
    if ('hideSamples' in body) await putSetting(env, 'hideSamples', !!body.hideSamples);
    if ('company' in body) await putSetting(env, 'company', cleanCompany(body.company));
    if ('faq' in body) {
      const faq = cleanFaq(body.faq);
      if (!faq) throw new UserError('자주 묻는 질문 정보가 잘못되었습니다.');
      await putSetting(env, 'faq', faq);
    }
    dropSiteCache();
    return getSettingsAdmin(env);
  } catch (e) {
    if (e instanceof UserError) return json({ ok: false, error: e.message }, 400);
    throw e;
  }
}

/* ---------- 공지사항 ---------- */

async function listNotices(env) {
  const { results } = await env.DB.prepare('SELECT id, created_at, updated_at, title, body, pinned, visible FROM notices ORDER BY pinned DESC, id DESC LIMIT 200').all();
  return json({ ok: true, items: results });
}
async function saveNotice(request, env, id) {
  let b = {};
  try { b = await request.json(); } catch {}
  const title = clean(b.title, 100), body = clean(b.body, 5000);
  if (!title) return json({ ok: false, error: '제목을 입력해 주세요.' }, 400);
  const pinned = b.pinned ? 1 : 0, visible = b.visible === false ? 0 : 1;
  if (id) {
    const r = await env.DB.prepare('UPDATE notices SET title = ?, body = ?, pinned = ?, visible = ?, updated_at = ? WHERE id = ?').bind(title, body, pinned, visible, kst(), id).run();
    if (r.meta && r.meta.changes === 0) return json({ ok: false, error: '없는 공지입니다.' }, 404);
  } else {
    await env.DB.prepare('INSERT INTO notices (created_at, title, body, pinned, visible) VALUES (?, ?, ?, ?, ?)').bind(kst(), title, body, pinned, visible).run();
  }
  dropSiteCache();
  return listNotices(env);
}
async function deleteNotice(env, id) {
  await env.DB.prepare('DELETE FROM notices WHERE id = ?').bind(id).run();
  dropSiteCache();
  return listNotices(env);
}

/* ---------- 홈페이지용 공개 정보 ---------- */

const PUB_COLS = 'id, created_at, taken_at, title, sub, site, body, category';

// 홈페이지 설치사례
//  - /api/cases?home=1            : 분류마다 최신 12개(사진 전부) + 분류별 개수 → 첫 화면 가로 목록
//  - /api/cases?cat=fl&offset=0   : 목록 페이지용 (대표 사진 1장 + 사진 수), 24개씩
export async function publicCases(request, env) {
  if (!env.DB) return json({ ok: true, items: [], total: 0, counts: { all: 0, fl: 0, tl: 0, st: 0, tr: 0 } });
  await ensureSchema(env);
  const url = new URL(request.url);
  const hdr = { 'cache-control': 'no-cache' };
  if (url.searchParams.get('home')) {
    const per = Math.min(Math.max(parseInt(url.searchParams.get('per'), 10) || 12, 1), 30);
    const { results } = await env.DB.prepare(
      `SELECT ${PUB_COLS} FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY category ${CASE_ORDER}) AS rn FROM cases WHERE visible = 1) WHERE rn <= ? ${CASE_ORDER}`
    ).bind(per).all();
    const photos = await casePhotos(env, results.map((r) => r.id));
    const items = results.map((r) => publicRow(r, photos[r.id])).filter((r) => r.photos.length);
    return json({ ok: true, items, counts: await catCounts(env, true) }, 200, hdr);
  }
  const w = caseWhere(url, true), { limit, offset } = pageArgs(url, 24, 60);
  const [{ results }, total] = await Promise.all([
    env.DB.prepare(`SELECT ${PUB_COLS} FROM cases ${w.sql} ${CASE_ORDER} LIMIT ? OFFSET ?`).bind(...w.args, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM cases ${w.sql}`).bind(...w.args).first(),
  ]);
  const photos = await casePhotos(env, results.map((r) => r.id));
  const items = results.map((r) => {
    const row = publicRow(r, photos[r.id]);
    return { id: row.id, title: row.title, site: row.site, cat: row.cat, date: row.date, cover: row.photos[0] || '', count: row.photos.length };
  }).filter((r) => r.cover);
  return json({ ok: true, items, total: total.n, counts: await catCounts(env, true) }, 200, hdr);
}

function publicRow(r, photos) {
  return {
    id: r.id, title: r.title, site: r.site ?? r.sub ?? '', body: r.body || '',
    cat: CATS[r.category] ? r.category : inferCat(r.title),
    date: String(r.taken_at || r.created_at || '').slice(0, 7).replace('-', '.'),
    photos: (photos || []).map((p) => p.img),
  };
}

// 상세 페이지 미리보기(카카오톡·검색)용: 제목, 대표 사진
export async function caseMeta(env, id) {
  const r = await env.DB.prepare(`SELECT ${PUB_COLS} FROM cases WHERE id = ? AND visible = 1`).bind(id).first();
  if (!r) return null;
  const photos = await casePhotos(env, [r.id]);
  return publicRow(r, photos[r.id]);
}

// 사이트맵용: 보이는 글 번호와 날짜
export async function caseIdsForSitemap(env) {
  const { results } = await env.DB.prepare('SELECT id, COALESCE(updated_at, created_at) AS d FROM cases WHERE visible = 1 ORDER BY id DESC LIMIT 5000').all();
  return results;
}

// 상세 페이지용 한 건
export async function publicCase(env, id) {
  if (!env.DB) return json({ ok: false, error: '없는 사례입니다.' }, 404);
  await ensureSchema(env);
  const r = await env.DB.prepare(`SELECT ${PUB_COLS} FROM cases WHERE id = ? AND visible = 1`).bind(id).first();
  if (!r) return json({ ok: false, error: '없는 사례입니다.' }, 404);
  const photos = await casePhotos(env, [r.id]);
  return json({ ok: true, item: publicRow(r, photos[r.id]) }, 200, { 'cache-control': 'no-cache' });
}

export async function publicSite(env) {
  if (!env.DB) return json({ ok: true, slides: [], videos: [] });
  await ensureSchema(env);
  const slides = (await getSlides(env)).map(({ img, tag, title }) => ({ img, tag, title }));
  return json({ ok: true, slides, videos: await getSetting(env, 'videos', []), hideSamples: !!(await getSetting(env, 'hideSamples', false)) }, 200, { 'cache-control': 'no-cache' });
}

// /photos/... 사진 제공
export async function servePhoto(request, env, path) {
  const key = decodeURIComponent(path.slice('/photos/'.length));
  if (!env.PHOTOS || !/^(cases|slides)\/[\w-]+\.(webp|jpg)$/.test(key)) return new Response('Not found', { status: 404 });
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  return new Response(obj.body, { headers });
}

/* ---------- 관리자 주소 연결 ---------- */

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
  if (m && method === 'DELETE') return deleteInquiry(env, Number(m[1]));
  if (path.startsWith('/api/admin/inq-photo/') && method === 'GET') return inquiryPhoto(env, decodeURIComponent(path.slice('/api/admin/inq-photo/'.length)));

  if (path === '/api/admin/cases' && method === 'GET') return listCasesAdmin(request, env);
  if (path === '/api/admin/cases' && method === 'POST') return saveCase(request, env, null);
  if (path === '/api/admin/case-notes' && method === 'POST') return saveCaseNotes(request, env);
  m = /^\/api\/admin\/cases\/(\d+)(\/visible|\/pin)?$/.exec(path);
  if (m && m[2] === '/visible' && method === 'POST') return setCaseVisible(request, env, Number(m[1]));
  if (m && m[2] === '/pin' && method === 'POST') return setCasePinned(request, env, Number(m[1]));
  if (m && !m[2] && method === 'POST') return saveCase(request, env, Number(m[1]));
  if (m && !m[2] && method === 'DELETE') return deleteCase(env, Number(m[1]));

  if (path === '/api/admin/settings' && method === 'GET') return getSettingsAdmin(env);
  if (path === '/api/admin/settings' && method === 'POST') return saveSettings(request, env);
  if (path === '/api/admin/slides' && method === 'POST') return saveSlides(request, env);

  if (path === '/api/admin/notices' && method === 'GET') return listNotices(env);
  if (path === '/api/admin/notices' && method === 'POST') return saveNotice(request, env, null);
  m = /^\/api\/admin\/notices\/(\d+)$/.exec(path);
  if (m && method === 'POST') return saveNotice(request, env, Number(m[1]));
  if (m && method === 'DELETE') return deleteNotice(env, Number(m[1]));

  if (path === '/api/admin/stats' && method === 'GET') return statsAdmin(env);
  return json({ ok: false, error: 'Not found' }, 404);
}
