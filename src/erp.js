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
