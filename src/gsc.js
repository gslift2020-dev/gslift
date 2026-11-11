// 구글 서치 콘솔 검색어 — 구글이 방문 주소에 검색어를 주지 않아서('검색어 비공개'),
// 서치 콘솔에 모인 '어떤 검색어로 몇 번 보였고 몇 번 눌렸나'를 직접 받아 관리자 화면에 보여 준다.
//
// 연결 방법: 구글 클라우드 '서비스 계정'(연결용 계정)의 열쇠 파일(JSON) 내용을
//   Cloudflare 비밀값 GSC_SA_KEY 에 넣고, 그 계정 이메일을 서치 콘솔 사용자(제한)로 추가한다.
//   열쇠는 저장소에 넣지 않는다(공개 저장소).
// 데이터베이스 사용: 손님 방문과 무관. 관리자 '한눈에 보기'를 열 때 settings 1줄 읽기,
//   12시간마다(또는 '새로 고침') 구글에서 받아 1줄 쓰기.
import { json } from './util.js';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://searchconsole.googleapis.com/webmasters/v3/sites/';
const CACHE_KEY = 'gscCache';
const FRESH_MS = 12 * 3600e3;      // 12시간 지나면 새로 받음
const MANUAL_GAP_MS = 10 * 60e3;   // '새로 고침'은 10분에 한 번까지
const ERROR_GAP_MS = 30 * 60e3;    // 실패하면 30분 동안은 다시 묻지 않음 (새로 고침은 예외)
const DAYS = 28;
const LAG_DAYS = 2;                // 서치 콘솔 자료는 2~3일 늦게 쌓임
const ROWS = 250;

// 구글까지 연결 자체가 안 될 때(일시 장애) 알아보기 쉬운 말로
async function call(url, init) {
  try { return await fetch(url, init); } catch (e) { throw new Error('구글 서버에 연결하지 못했습니다(일시 장애일 수 있음). 잠시 뒤 다시 해 주세요.'); }
}

function siteUrl(env) { return env.GSC_SITE || 'sc-domain:gslift.kr'; }

function readKey(env) {
  const raw = env.GSC_SA_KEY;
  if (!raw) return null;
  let k;
  try { k = JSON.parse(raw); } catch {
    // 붙여 넣다가 열쇠 안의 \n 이 진짜 줄바꿈으로 바뀐 경우도 받아 준다
    try { k = JSON.parse(String(raw).replace(/-----BEGIN[\s\S]*?-----END[^-]*-----\s*/, (m) => m.replace(/\r?\n/g, '\\n'))); } catch { k = null; }
  }
  if (k === null) throw new Error('GSC_SA_KEY 내용이 JSON 형식이 아닙니다. 내려받은 열쇠 파일 내용 전체를 그대로 붙여 넣어 주세요.');
  if (!k || !k.client_email || !k.private_key) throw new Error('GSC_SA_KEY에 client_email 또는 private_key가 없습니다. 서비스 계정 열쇠 파일(JSON)이 맞는지 확인해 주세요.');
  return k;
}

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

function pemToDer(pem) {
  const body = String(pem).replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function signJwt(key, now = Math.floor(Date.now() / 1000)) {
  const head = enc({ alg: 'RS256', typ: 'JWT' });
  const claim = enc({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 });
  const k = await crypto.subtle.importKey('pkcs8', pemToDer(key.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, new TextEncoder().encode(head + '.' + claim)));
  return head + '.' + claim + '.' + b64url(sig);
}

async function accessToken(key) {
  let jwt;
  try { jwt = await signJwt(key); } catch { throw new Error('열쇠(private_key)를 읽지 못했습니다. 열쇠 파일 내용이 잘렸거나 바뀌지 않았는지 확인해 주세요.'); }
  const res = await call(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt,
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) {
    const why = (d.error_description || d.error || res.status) + '';
    throw new Error('구글 로그인(토큰) 실패: ' + why.slice(0, 160) + ' — 열쇠를 지웠거나 서비스 계정을 지웠다면 새 열쇠가 필요합니다.');
  }
  return d.access_token;
}

function explainApiError(status, msg, email) {
  const m = String(msg || '');
  if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(m))
    return '구글 클라우드에서 "Google Search Console API"가 꺼져 있습니다. 켠 뒤 몇 분 지나 다시 해 주세요.';
  if (status === 403 || /permission|sufficient/i.test(m))
    return '서치 콘솔에 연결용 계정(' + email + ')이 사용자로 추가되지 않았습니다. 서치 콘솔 → 설정 → 사용자 및 권한 → 사용자 추가(권한: 제한됨).';
  if (status === 404) return '서치 콘솔 속성을 찾지 못했습니다(' + m.slice(0, 80) + ').';
  return '구글 서치 콘솔 응답 오류 (' + status + '): ' + m.slice(0, 160);
}

async function query(token, env, email, body) {
  const res = await call(API + encodeURIComponent(siteUrl(env)) + '/searchAnalytics/query', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(explainApiError(res.status, d.error && d.error.message, email));
  return d.rows || [];
}

// 한국 날짜 'YYYY-MM-DD' (n일 전)
function kstDay(nDaysAgo, nowMs = Date.now()) {
  return new Date(nowMs + 9 * 3600e3 - nDaysAgo * 86400e3).toISOString().slice(0, 10);
}
const r1 = (x) => Math.round(x * 10) / 10;

export async function fetchGsc(env, key, nowMs = Date.now()) {
  const end = kstDay(LAG_DAYS, nowMs), start = kstDay(LAG_DAYS + DAYS - 1, nowMs);
  const token = await accessToken(key);
  const base = { startDate: start, endDate: end, searchType: 'web' };
  const [qRows, tRows, dRows] = await Promise.all([
    query(token, env, key.client_email, { ...base, dimensions: ['query'], rowLimit: ROWS }),
    query(token, env, key.client_email, { ...base }),
    query(token, env, key.client_email, { ...base, dimensions: ['date'], rowLimit: 40 }),
  ]);
  const t = tRows[0] || { clicks: 0, impressions: 0, position: 0 };
  return {
    at: nowMs, start, end, site: siteUrl(env),
    totals: { clicks: t.clicks || 0, impressions: t.impressions || 0, position: t.impressions ? r1(t.position) : null },
    // q 검색어, c 클릭, i 노출, p 평균 순위
    rows: qRows.map((r) => ({ q: String(r.keys && r.keys[0] || ''), c: r.clicks || 0, i: r.impressions || 0, p: r1(r.position || 0) })),
    days: dRows.map((r) => ({ d: r.keys[0], c: r.clicks || 0, i: r.impressions || 0 })),
  };
}

async function readCache(env) {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(CACHE_KEY).first();
  if (!r) return null;
  try { return JSON.parse(r.value); } catch { return null; }
}
async function writeCache(env, v) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(CACHE_KEY, JSON.stringify(v)).run();
}

// GET /api/admin/gsc  ·  POST /api/admin/gsc (새로 고침)
export async function gscAdmin(request, env) {
  const manual = request.method === 'POST';
  let key;
  try { key = readKey(env); } catch (e) { return json({ ok: true, configured: false, error: e.message }); }
  if (!key) return json({ ok: true, configured: false });

  const now = Date.now();
  const cache = await readCache(env);
  const out = (c, extra) => json({ ok: true, configured: true, email: key.client_email, ...(c || {}), ...(extra || {}) });

  const dataAge = cache && cache.at ? now - cache.at : Infinity;
  const tried = cache && cache.tried ? now - cache.tried : Infinity;
  if (manual) {
    if (dataAge < MANUAL_GAP_MS) return out(cache, { note: '방금 새로 받았습니다. 10분 뒤에 다시 할 수 있습니다.' });
    if (tried < 60e3) return out(cache, { note: '1분 뒤에 다시 눌러 주세요.' });
  } else if (dataAge < FRESH_MS || (cache && cache.err && tried < ERROR_GAP_MS)) {
    return out(cache);
  }

  try {
    const fresh = await fetchGsc(env, key, now);
    await writeCache(env, fresh);
    return out(fresh, { refreshed: true });
  } catch (e) {
    // 예전 자료는 그대로 두고 실패 이유만 적는다
    const keep = { ...(cache || {}), err: String(e.message || e).slice(0, 300), tried: now };
    await writeCache(env, keep);
    return out(keep);
  }
}
