// 공통 도구
import { inferTags, packTags } from './tags.js';

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
  // 방문 1건(30분 안에 이어 본 페이지 묶음) = 1줄. IP는 저장하지 않음. 90일 뒤 삭제 (src/stats.js)
  `CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vid TEXT NOT NULL,
    day TEXT NOT NULL, at TEXT NOT NULL, last_at TEXT,
    src TEXT, kw TEXT, ad TEXT, ref TEXT,
    landing TEXT, pages INTEGER NOT NULL DEFAULT 1, plist TEXT,
    mobile INTEGER NOT NULL DEFAULT 0, region TEXT,
    inquiry_id INTEGER
  )`,
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
  'ALTER TABLE cases ADD COLUMN note TEXT', // 내부 메모(원래 폴더·현장명) — 관리자만 봄
  'ALTER TABLE cases ADD COLUMN tags TEXT', // 상황별 꼬리표 ",in,mesh," (src/tags.js)
  // 방문 1건 기록: 로봇·직원 판정과 페이지 안 행동 (2026-11-03, src/stats.js)
  'ALTER TABLE visits ADD COLUMN net TEXT',      // 접속망 이름 (Cloudflare asOrganization, 예: Korea Telecom) — IP 아님
  'ALTER TABLE visits ADD COLUMN ua TEXT',       // 브라우저 요약 (예: Chrome 130 · Android) — 원문 저장 안 함
  "ALTER TABLE visits ADD COLUMN who TEXT NOT NULL DEFAULT ''", // 직원: staff(기기 표시) · office(회사 인터넷) · admin(로그인 중)
  'ALTER TABLE visits ADD COLUMN bot INTEGER NOT NULL DEFAULT 0', // 기록 때 로봇 의심으로 판정
  'ALTER TABLE visits ADD COLUMN why TEXT',      // 로봇 의심 이유
  'ALTER TABLE visits ADD COLUMN mark INTEGER NOT NULL DEFAULT 0', // 관리자가 고친 판정: 1 사람, 2 로봇
  'ALTER TABLE visits ADD COLUMN counted INTEGER NOT NULL DEFAULT 1', // 날짜별 합계에 넣었는지
  'ALTER TABLE visits ADD COLUMN dwell INTEGER NOT NULL DEFAULT 0', // 머문 시간(초, 방문 전체)
  'ALTER TABLE visits ADD COLUMN scroll INTEGER NOT NULL DEFAULT 0', // 처음 들어온 페이지 스크롤 깊이 0·25·50·75·100
  'ALTER TABLE visits ADD COLUMN adkw TEXT',     // 광고 등록 키워드 (네이버 n_keyword · 카카오 k_keyword, 2026-11-04). 실제 검색어는 kw 칸
  'ALTER TABLE visits ADD COLUMN acts INTEGER NOT NULL DEFAULT 0', // 누른 것: 1 설치사례 · 2 전화 · 4 견적 버튼 · 8 견적 양식 입력
  // 재방문 구분 (2026-11-12): 같은 브라우저의 몇 번째 방문인지 + 첫 방문 정보. 첫 페이지의 같은 INSERT에 칸만 더함(읽기·쓰기 추가 없음)
  'ALTER TABLE visits ADD COLUMN vn INTEGER',    // 몇 번째 방문 (1 = 첫 방문, 비어 있으면 기능 전 기록·직원·저장 막힌 브라우저)
  'ALTER TABLE visits ADD COLUMN f_at TEXT',     // 첫 방문 시각 (vn ≥ 2일 때만)
  'ALTER TABLE visits ADD COLUMN f_src TEXT',    // 첫 방문 경로 이름 (예: 네이버 광고)
  'ALTER TABLE visits ADD COLUMN f_kw TEXT',     // 첫 방문 검색어
  'ALTER TABLE visits ADD COLUMN f_adkw TEXT',   // 첫 방문 광고 등록 키워드
  'ALTER TABLE visits ADD COLUMN f_pre INTEGER NOT NULL DEFAULT 0', // 이 기능을 올리기 전에도 온 적 있는 브라우저
  'ALTER TABLE visits ADD COLUMN uid TEXT',      // 무작위 손님 번호 (같은 브라우저 묶음, 이름·연락처와 무관). 색인 없음 — 관리자가 '방문 모두 보기'를 누를 때만 날짜 범위로 찾음
  // 업무앱(거산 생태계) 보내기 결과 (2026-11-13): erp_sent 1 보냄 · 0 실패 · NULL 설정 전/기능 전
  'ALTER TABLE inquiries ADD COLUMN erp_sent INTEGER',
  'ALTER TABLE inquiries ADD COLUMN erp_error TEXT',
  'ALTER TABLE inquiries ADD COLUMN erp_id TEXT',
  'ALTER TABLE inquiries ADD COLUMN erp_at TEXT',
];

// 설치사례 분류 (제품소개 4종과 같음)
// 2026-11-04 운반기계(tr) 분류 삭제 (사장님 지시) — 예전 tr 글은 홈페이지에 보이지 않음
export const CATS = { fl: '화물용 리프트(F/L)', tl: '테이블 리프트(T/L)', st: '수동·자동 스태커' };
export function inferCat(title) {
  const t = String(title || '');
  if (/테이블|T\/L/i.test(t)) return 'tl';
  if (/스태커/.test(t)) return 'st';
  return 'fl';
}

// 검색용 색인 — 없으면 목록·사진을 꺼낼 때마다 표 전체를 훑어 D1 무료 읽기 한도를 금방 씀
const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_case_photos_case ON case_photos (case_id, sort)',
  'CREATE INDEX IF NOT EXISTS idx_cases_visible ON cases (visible, category)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_vid ON visits (vid)',
  'CREATE INDEX IF NOT EXISTS idx_visits_day ON visits (day, at)',
];
// 표 구조를 바꿀 때만 이 값을 올림 → 같으면 서버가 새로 뜰 때마다 점검을 반복하지 않음
const SCHEMA_VERSION = '2026-11-13a';

let schemaReady = false;
export async function ensureSchema(env) {
  if (schemaReady) return;
  try {
    const v = await env.DB.prepare("SELECT value FROM settings WHERE key = 'schemaVersion'").first();
    if (v && v.value === SCHEMA_VERSION) { schemaReady = true; return; }
  } catch (e) { /* 표가 아직 없음 → 아래에서 만듦 */ }
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
  // 꼬리표가 없는 글은 제목·현장·설명으로 꼬리표를 붙임 (표 구조가 바뀔 때 한 번만)
  const untagged = (await env.DB.prepare('SELECT id, title, site, body, category FROM cases WHERE tags IS NULL').all()).results;
  for (let i = 0; i < untagged.length; i += 50) {
    await env.DB.batch(untagged.slice(i, i + 50).map((r) => env.DB.prepare('UPDATE cases SET tags = ? WHERE id = ?')
      .bind(packTags(inferTags([r.title, r.site, r.body].join(' '), r.category || inferCat(r.title))), r.id)));
  }
  for (const q of INDEXES) await env.DB.prepare(q).run();
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('schemaVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(SCHEMA_VERSION).run();
  schemaReady = true;
}
