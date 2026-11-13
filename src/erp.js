// 홈페이지 견적 문의 → 거산 업무앱(geosan-erp)의 '홈페이지 문의(견적 대기)'로 1건 보내기
// 약속: 프로젝트 지식 「연결 약속」 3번 (2026-11-13, 과장 결정: 견적 대기 목록까지만 자동, 기본 회사 거산리프트)
//
// - 보내는 곳·열쇠는 Cloudflare 비밀값에만: ERP_INQ_URL(업무앱 받는 주소), ERP_INQ_SECRET(서명 열쇠). 저장소(공개)에는 없음
// - 서명: 헤더 x-gs-time(유닉스 초) · x-gs-sign = hex(HMAC-SHA256(열쇠, 시각 + "." + 본문))
// - 같은 문의를 두 번 보내도 업무앱이 문의 번호(inquiry_no)로 막음 → '다시 보내기' 안전
// - 비밀값이 없으면 보내지 않음(설정 전). 실패해도 문의 저장·알림 메일은 그대로
import { specRows, visitLine } from './contact.js';
import { srcLabel } from './stats.js';

export const ERP_PAYLOAD_VERSION = 1;
const SPEC_KEYS = ['dir', 'load', 'stops', 'travel', 'place', 'hole', 'pit', 'cargo', 'w', 'd', 'h'];

// 업무앱으로 보낼 내용 (row: inquiries 한 줄, spec: 파싱한 spec, photoCount: 첨부 사진 수)
export function erpPayload(row, spec, photoCount) {
  const s = {};
  for (const k of SPEC_KEYS) if (spec[k]) s[k] = String(spec[k]);
  return {
    v: ERP_PAYLOAD_VERSION,
    source: 'gslift.kr',
    inquiry_no: row.id,
    received_at: String(row.created_at).replace(' ', 'T') + '+09:00',
    company: row.company || '',
    name: row.name || '',
    phone: row.phone || '',
    email: spec.email || '',
    product: row.product || '',
    loc: spec.loc || '',
    message: row.message || '',
    spec: s,
    spec_rows: specRows(spec),
    src: spec.src || '',
    src_label: spec.src ? srcLabel(spec.src) : '',
    kw: spec.kw || '',
    visit: spec.vn ? { vn: spec.vn, pre: spec.pre ? 1 : 0, first: spec.first || null, line: visitLine(spec) } : null,
    photo_count: photoCount || 0,
    admin_url: 'https://gslift.kr/admin/#inq-' + row.id,
  };
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function erpConfigured(env) {
  // https만 (시험 서버용 http://localhost 는 허용)
  return !!(env.ERP_INQ_URL && env.ERP_INQ_SECRET && /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(env.ERP_INQ_URL));
}

// 결과: { ok, skip?, id?, dup?, error? }
export async function sendToErp(env, payload) {
  if (!erpConfigured(env)) return { ok: false, skip: true };
  const body = JSON.stringify(payload);
  const t = String(Math.floor(Date.now() / 1000));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(env.ERP_INQ_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gs-time': t, 'x-gs-sign': await hmacHex(env.ERP_INQ_SECRET, t + '.' + body) },
      body,
      signal: ctl.signal,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) return { ok: false, error: ('업무앱 응답 ' + res.status + (d.error ? ': ' + d.error : '')).slice(0, 300) };
    return { ok: true, id: d.id != null ? String(d.id).slice(0, 40) : '', dup: !!d.dup };
  } catch (e) {
    return { ok: false, error: (e && e.name === 'AbortError' ? '업무앱 응답 없음(10초)' : '업무앱 연결 실패: ' + String(e && e.message || e)).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

// 보낸 결과를 문의 줄에 남길 값 (erp_sent: 1 보냄 · 0 실패 · NULL 설정 전)
export function erpResultCols(r) {
  if (r.skip) return [null, null, null];
  return r.ok ? [1, null, r.id || null] : [0, r.error || '실패', null];
}

// ---------- 업무앱 → 홈페이지 문의 상태 받기 (연결 약속 3-3, 2026-11-13) ----------
// POST /api/erp/inquiry-status — 업무앱 서버 함수 web-inquiry-push 가 부름
// 서명은 보낼 때와 같은 방식·같은 열쇠(ERP_INQ_SECRET). 본문 { v:1, kind:"status", inquiry_no, status, changed_at }
// 답: {ok:true} · 서명·시각 틀림 401 · 형식 400 · 없는 문의 번호 422(404는 업무앱이 '받는 곳 없음'으로 보므로 쓰지 않음) · 열쇠 없음 503
// DB: 요청 1번에 읽기 1 · 쓰기 0~1 (손님 방문과 무관)
const ERP_STATUS = { '신규': 'new', '처리완료': 'done', '보류': 'hold', '휴지통': 'trash' };

function sameHex(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

export async function erpStatusIn(request, env, ensureSchema) {
  const out = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  if (request.method !== 'POST') return out({ ok: false, error: 'POST만 받습니다' }, 405);
  const secret = String(env.ERP_INQ_SECRET || '');
  if (!secret) return out({ ok: false, error: '열쇠(ERP_INQ_SECRET)가 없습니다' }, 503);
  const raw = (await request.text()).slice(0, 4000);
  const t = request.headers.get('x-gs-time') || '';
  if (!/^\d{9,11}$/.test(t) || Math.abs(Date.now() / 1000 - Number(t)) > 300) return out({ ok: false, error: '시각 확인 실패' }, 401);
  if (!sameHex(request.headers.get('x-gs-sign') || '', await hmacHex(secret, t + '.' + raw))) return out({ ok: false, error: '서명이 맞지 않습니다' }, 401);
  let p;
  try { p = JSON.parse(raw); } catch { return out({ ok: false, error: 'JSON 형식이 아닙니다' }, 400); }
  if (!p || p.v !== 1 || p.kind !== 'status') return out({ ok: false, error: 'v·kind가 맞지 않습니다' }, 400);
  const no = Number(p.inquiry_no);
  if (!Number.isInteger(no) || no < 1) return out({ ok: false, error: 'inquiry_no가 맞지 않습니다' }, 400);
  const st = ERP_STATUS[p.status];
  if (!st) return out({ ok: false, error: 'status는 신규·처리완료·보류·휴지통 중 하나' }, 400);
  const ms = Date.parse(p.changed_at);
  const at = Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
  await ensureSchema(env);
  const row = await env.DB.prepare('SELECT status, erp_status_at FROM inquiries WHERE id = ?').bind(no).first();
  if (!row) return out({ ok: false, error: '문의 번호 없음' }, 422);
  // 늦게 도착한 옛 상태는 무시(이미 더 새 상태가 있음) — 업무앱이 다시 보내도 같은 답
  if (row.erp_status_at && row.erp_status_at > at) return out({ ok: true, ignored: 'older' });
  // 같은 바뀜을 다시 받으면(업무앱 재전송) 그대로 — 그 사이 관리자가 손으로 바꾼 상태를 덮지 않음
  if (row.erp_status_at === at) return out({ ok: true, same: true });
  await env.DB.prepare("UPDATE inquiries SET status = ?, status_by = 'erp', erp_status_at = ? WHERE id = ?").bind(st, at, no).run();
  return out({ ok: true });
}
