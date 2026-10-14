// 공통 도구

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function clean(v, max) {
  return String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 한국시간 'YYYY-MM-DD HH:MM:SS'
export function kst(offsetMs = 0) {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetMs).toISOString().replace('T', ' ').slice(0, 19);
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    company TEXT, name TEXT NOT NULL, phone TEXT NOT NULL,
    product TEXT, message TEXT,
    ip TEXT, user_agent TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    email_sent INTEGER NOT NULL DEFAULT 0,
    email_error TEXT
  )`,
  // 설치사례 글 (사진은 case_photos)
  `CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    title TEXT NOT NULL,
    sub TEXT,
    photo_key TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS case_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    photo_key TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  )`,
  // 메인 화면 슬라이드
  `CREATE TABLE IF NOT EXISTS slides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_key TEXT NOT NULL,
    tag TEXT, title TEXT,
    sort INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    ip TEXT NOT NULL,
    at TEXT NOT NULL
  )`,
  // 공지사항
  `CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL, updated_at TEXT,
    title TEXT NOT NULL, body TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    visible INTEGER NOT NULL DEFAULT 1
  )`,
  // 방문 통계 (개인 식별 정보 없이 날짜별 숫자만)
  `CREATE TABLE IF NOT EXISTS visit_uniq (day TEXT NOT NULL, h TEXT NOT NULL, mobile INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, h))`,
  `CREATE TABLE IF NOT EXISTS visit_pages (day TEXT NOT NULL, path TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, path))`,
  `CREATE TABLE IF NOT EXISTS visit_refs (day TEXT NOT NULL, src TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, src))`,
];

// 예전 표에 새 칸 추가 (이미 있으면 무시)
const MIGRATIONS = [
  'ALTER TABLE cases ADD COLUMN site TEXT',
  'ALTER TABLE cases ADD COLUMN body TEXT',
  'ALTER TABLE cases ADD COLUMN updated_at TEXT',
  'ALTER TABLE cases ADD COLUMN category TEXT',
  'ALTER TABLE inquiries ADD COLUMN spec TEXT',
  'ALTER TABLE inquiries ADD COLUMN photos TEXT',
  'ALTER TABLE inquiries ADD COLUMN memo TEXT',
  'ALTER TABLE cases ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE cases ADD COLUMN taken_at TEXT',
];

// 설치사례 분류 (제품소개 4종과 같음)
export const CATS = { fl: '화물용 리프트(F/L)', tl: '테이블 리프트(T/L)', st: '수동·자동 스태커', tr: '운반기계' };
export function inferCat(title) {
  const t = String(title || '');
  if (/테이블|T\/L/i.test(t)) return 'tl';
  if (/스태커/.test(t)) return 'st';
  if (/운반|대차/.test(t)) return 'tr';
  return 'fl';
}

let schemaReady = false;
export async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  for (const m of MIGRATIONS) {
    try { await env.DB.prepare(m).run(); } catch (e) { /* duplicate column */ }
  }
  // 예전 방식(사진 1장)으로 올린 글의 사진을 case_photos로 옮김
  await env.DB.prepare(
    'INSERT INTO case_photos (case_id, photo_key, sort) SELECT c.id, c.photo_key, 0 FROM cases c WHERE c.photo_key != \'\' AND NOT EXISTS (SELECT 1 FROM case_photos p WHERE p.case_id = c.id)'
  ).run();
  // 분류가 비어 있는 예전 글은 제목으로 분류를 채움 (목록을 분류별로 바로 꺼낼 수 있게)
  const { results } = await env.DB.prepare("SELECT id, title FROM cases WHERE category IS NULL OR category = ''").all();
  if (results.length) await env.DB.batch(results.map((r) => env.DB.prepare('UPDATE cases SET category = ? WHERE id = ?').bind(inferCat(r.title), r.id)));
  schemaReady = true;
}
