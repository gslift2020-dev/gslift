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
  `CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    title TEXT NOT NULL,
    sub TEXT,
    photo_key TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    ip TEXT NOT NULL,
    at TEXT NOT NULL
  )`,
];

let schemaReady = false;
export async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  schemaReady = true;
}
