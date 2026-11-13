// 견적·상담 문의 접수: DB 저장(사진은 R2) → 메일 알림(사진 첨부)
import { linkInquiry, visitorInfo, srcLabel, staffOf } from './stats.js';
import { erpPayload, sendToErp, erpResultCols } from './erp.js';
import { json, clean, esc, kst, ensureSchema } from './util.js';

const LIMITS = { company: 100, name: 50, phone: 30, product: 50, message: 3000 };
const PER_IP_PER_HOUR = 5;
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

// 고객이 아는 만큼만 적는 리프트 사양 (모두 선택)
export const SPEC_FIELDS = [
  ['loc', '설치 현장 위치', 100],
  ['dir', '출입방향', 40],
  ['load', '적재하중', 30],
  ['stops', '전체 정지 층수', 30],
  ['travel', '운행 높이(행정거리)', 12],
  ['place', '실내·외부', 30],
  ['hole', '윗층 바닥 구멍(천공)', 40],
  ['pit', '바닥 피트', 40],
  ['cargo', '주로 싣는 물건', 100],
  ['w', '카 가로(W, mm)', 8],
  ['d', '카 깊이(D, mm)', 8],
  ['h', '카 높이(H, mm)', 8],
];

function photoType(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP')
    return { ext: 'webp', mime: 'image/webp' };
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  return null;
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function normPhone(v) {
  const d = String(v || '').replace(/[^0-9]/g, '');
  if (/^02/.test(d) && (d.length === 9 || d.length === 10)) return d.length === 9 ? `02-${d.slice(2, 5)}-${d.slice(5)}` : `02-${d.slice(2, 6)}-${d.slice(6)}`;
  if (/^1[5-9]/.test(d) && d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
  if (/^050/.test(d) && (d.length === 11 || d.length === 12)) return d.length === 11 ? `${d.slice(0, 4)}-${d.slice(4, 7)}-${d.slice(7)}` : `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}`;
  if (/^0/.test(d) && (d.length === 10 || d.length === 11)) return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return String(v || '').trim();
}

export function specRows(spec) {
  const rows = [];
  for (const [k, label] of SPEC_FIELDS) if (spec[k]) rows.push([label, spec[k]]);
  if (spec.w || spec.d || spec.h) {
    // 가로·깊이·높이는 한 줄로
    const size = ['w', 'd', 'h'].map((k) => spec[k] || '?').join(' × ') + ' mm';
    return rows.filter((r) => !/^카 (가로|깊이|높이)/.test(r[0])).concat([['카 내부 크기(W×D×H)', size]]);
  }
  return rows;
}

// 방문 이력 한 줄: "첫 방문 11/4 네이버 광고 '화물리프트' → 이번엔 직접 입력·즐겨찾기로 3번째 방문에 문의"
// '로'/'으로' (받침이 있으면 '으로', ㄹ 받침·받침 없음·한글 아님은 '로')
function ro(w) {
  const c = String(w).trim().slice(-1).charCodeAt(0) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 && c % 28 !== 8 ? '으로' : '로';
}
export function visitLine(spec) {
  if (!spec || !spec.vn) return '';
  const pre = spec.pre ? ' (기록 시작 전에도 온 적 있음)' : '';
  const now = spec.src ? srcLabel(spec.src) : '';
  if (spec.vn === 1) return '첫 방문에 문의' + pre;
  const f = spec.first;
  if (!f) return spec.vn + '번째 방문에 문의' + pre;
  const md = (+f.at.slice(5, 7)) + '/' + (+f.at.slice(8, 10));
  const word = f.kw || (f.adkw ? '키워드: ' + f.adkw : '');
  return '첫 방문 ' + md + ' ' + f.src + (word ? " '" + word + "'" : '') + ' → ' + (now ? '이번엔 ' + now + ro(now) + ' ' : '') + spec.vn + '번째 방문에 문의' + pre;
}

// 알림 메일의 '관리자 화면에서 이 문의 보기' 주소 (로그인 후 그 문의로 바로 이동)
const ADMIN_BASE = 'https://gslift.kr/admin/';

async function sendMail(env, row, spec, photos) {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY 미설정' };
  const adminUrl = ADMIN_BASE + '#inq-' + row.id;
  const lines = [
    ['접수 시각', row.created_at + ' (한국시간)'],
    ['회사명', row.company || '-'],
    ['담당자', row.name],
    ['연락처', row.phone],
  ];
  if (spec.email) lines.push(['이메일', spec.email]);
  lines.push(['관심 제품', row.product || '-']);
  if (spec.src) lines.push(['유입 경로', spec.src + (spec.kw ? ' · 검색어: ' + spec.kw : '')]);
  if (visitLine(spec)) lines.push(['방문 이력', visitLine(spec)]);
  const sr = specRows(spec);
  const table = (rows) => `<table style="border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="padding:7px 14px 7px 0;color:#4A5A78;white-space:nowrap;vertical-align:top;line-height:1.5">${k}</td><td style="padding:7px 0;vertical-align:top;line-height:1.5"><b>${esc(v)}</b></td></tr>`)
    .join('')}</table>`;
  const html = `<div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#0F1E3A">
<h2 style="color:#063678;margin:0 0 12px">홈페이지 견적·상담 문의 #${row.id}</h2>
<p style="margin:0 0 16px;padding:12px 14px;background:#FFF7E6;border:1px solid #F3D58A;border-radius:8px">이 문의는 <b>거산리프트 홈페이지 관리자 화면</b>에서 확인·처리합니다.<br>
<a href="${adminUrl}" style="display:inline-block;margin-top:8px;background:#063678;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:700">관리자 화면에서 이 문의 보기 (#${row.id})</a><br>
<span style="font-size:13px;color:#4A5A78">주소: ${adminUrl} — 비밀번호로 로그인하면 이 문의로 바로 이동합니다.</span></p>
${table(lines)}
${sr.length ? `<h3 style="color:#063678;margin:18px 0 6px;font-size:16px">고객이 적은 리프트 사양</h3>${table(sr)}` : ''}
<div style="margin-top:18px;padding:14px;background:#F2F5FB;border-radius:8px;white-space:pre-wrap;line-height:1.6">${esc(row.message || '(내용 없음)')}</div>
${photos.length ? `<p style="color:#4A5A78;margin:14px 0 0">현장 사진 ${photos.length}장이 첨부되어 있습니다.</p>` : ''}
<p style="margin:22px 0 24px"><a href="tel:${esc(row.phone)}" style="display:inline-block;background:#063678;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;font-weight:700;line-height:1.4">${esc(row.phone)} 전화하기</a></p>
${spec.email ? `<p style="color:#4A5A78;font-size:13px;margin:0 0 10px;line-height:1.6">이 메일에서 '답장'을 누르면 고객 이메일(${esc(spec.email)})로 바로 보내집니다.</p>` : ''}
<p style="color:#4A5A78;font-size:13px;margin:16px 0 0;line-height:1.6">관리자 화면: <a href="${adminUrl}">${adminUrl}</a></p>
</div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.MAIL_FROM || '거산리프트 홈페이지 <onboarding@resend.dev>',
        to: [env.NOTIFY_EMAIL || 'gslift2020@naver.com'],
        subject: `[홈페이지 문의] ${row.company || row.name} · ${row.product || '문의'}${spec.loc ? ' · ' + spec.loc.slice(0, 20) : ''}${photos.length ? ` (사진 ${photos.length})` : ''}`,
        html,
        ...(spec.email ? { reply_to: spec.email } : {}),
        attachments: photos.map((p, i) => ({ filename: `문의${row.id}_현장사진${i + 1}.${p.ext}`, content: toBase64(p.bytes) })),
      }),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 300) };
  }
}

export async function handleContact(request, env, ctx) {
  if (request.method !== 'POST') return json({ ok: false, error: '허용되지 않은 요청입니다.' }, 405);
  if (!env.DB) return json({ ok: false, error: '서버 설정이 아직 완료되지 않았습니다.' }, 503);

  // 사진이 있으면 FormData, 없으면 JSON 둘 다 받음
  let body = {}, files = [];
  try {
    if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
      const form = await request.formData();
      for (const [k, v] of form.entries()) if (typeof v === 'string') body[k] = v;
      body.agree = body.agree === 'true' || body.agree === 'on';
      files = form.getAll('photos').filter((f) => f && typeof f !== 'string' && f.size > 0);
    } else {
      body = await request.json();
    }
  } catch {
    return json({ ok: false, error: '잘못된 요청입니다. 사진 용량이 너무 크면 장수를 줄여 다시 보내주세요.' }, 400);
  }

  // 스팸 방지: 사람에게는 보이지 않는 칸이 채워져 있으면 조용히 무시
  // (칸 이름이 website 였을 때 브라우저 자동완성이 채울 위험이 있어 gs_hp 로 바꿈. 예전 화면이 보내는 website 도 계속 받음)
  if (body.gs_hp || body.website) return json({ ok: true });

  const row = {
    company: clean(body.company, LIMITS.company),
    name: clean(body.name, LIMITS.name),
    phone: clean(body.phone, LIMITS.phone),
    product: clean(body.product, LIMITS.product),
    message: clean(body.message, LIMITS.message),
  };
  if (!row.name) return json({ ok: false, field: 'name', error: '담당자명을 입력해 주세요.' }, 400);
  // 숫자만 뽑아 010-1234-5678 모양으로 정리 (홈페이지가 자동으로 맞춰 보내지만 한 번 더 확인)
  row.phone = normPhone(row.phone);
  if (!/^(0\d{1,3}-\d{3,4}-\d{4}|1[5-9]\d{2}-\d{4})$/.test(row.phone)) return json({ ok: false, field: 'phone', error: '연락처를 정확히 입력해 주세요.' }, 400);
  if (body.agree !== true) return json({ ok: false, field: 'agree', error: '개인정보 수집·이용에 동의해 주세요.' }, 400);

  const spec = {};
  for (const [k, , max] of SPEC_FIELDS) {
    let v = clean(body[k], max);
    if (['w', 'd', 'h'].includes(k)) v = v.replace(/[^0-9]/g, '');
    if (v && v !== '모름') spec[k] = v;
  }

  // 운행 높이: 숫자만 오면 m를 붙임 (예: 4.5 → 4.5 m)
  if (spec.travel) {
    const t = spec.travel.replace(/[^0-9.]/g, '');
    if (t && /^\d{1,3}(\.\d{1,2})?$/.test(t)) spec.travel = t + ' m';
  }
  // 담당자 이메일 (선택) — 모양이 맞을 때만 저장
  const email = clean(body.email, 100);
  if (email) {
    if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)) return json({ ok: false, field: 'email', error: '이메일 주소를 확인해 주세요.' }, 400);
    spec.email = email;
  }

  // 광고 유입 경로 (홈페이지가 자동으로 붙여 보냄: naver, kakao, search.naver.com 등)
  const src = clean(body.src, 40).replace(/[^\w.\-]/g, '');
  if (src) spec.src = src;
  // 광고 검색어 (track.js가 광고 주소의 n_query·k_query·utm_term에서 꺼내 둔 것, 이미 한글로 풀린 글자). 유입 경로 옆에 같이 남김
  const kw = clean(body.kw, 60).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (kw && src) spec.kw = kw;
  // 재방문 정보 (track.js gs_u): 몇 번째 방문에 문의했는지 + 처음 들어온 경로 — DB 읽기·쓰기 추가 없음(spec 안에 저장)
  const vi = visitorInfo(clean(body.u, 2000), request.headers.get('user-agent') || '', new URL(request.url).hostname);
  if (vi) {
    spec.vn = vi.vn;
    if (vi.pre) spec.pre = 1;
    if (vi.uid) spec.uid = vi.uid;
    if (vi.first) spec.first = vi.first;
  }

  if (files.length > MAX_PHOTOS) return json({ ok: false, field: 'photos', error: `사진은 ${MAX_PHOTOS}장까지 보낼 수 있습니다.` }, 400);
  const photos = [];
  for (const f of files) {
    if (f.size > MAX_PHOTO_BYTES) return json({ ok: false, field: 'photos', error: '사진 용량이 너무 큽니다.' }, 413);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const t = photoType(bytes);
    if (!t) return json({ ok: false, field: 'photos', error: '사진 파일만 올릴 수 있습니다 (JPG·PNG).' }, 400);
    photos.push({ bytes, ...t });
  }

  const ip = request.headers.get('cf-connecting-ip') || '';
  const ua = clean(request.headers.get('user-agent'), 300);

  await ensureSchema(env);

  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM inquiries WHERE ip = ? AND created_at > ?').bind(ip, kst(-3600 * 1000)).first();
  if (recent && recent.n >= PER_IP_PER_HOUR) {
    return json({ ok: false, error: '짧은 시간에 문의가 너무 많습니다. 전화(031-986-5345)로 연락 부탁드립니다.' }, 429);
  }

  // 사진은 관리자만 볼 수 있는 inquiries/ 폴더에 보관
  const keys = [];
  if (photos.length && env.PHOTOS) {
    for (const p of photos) {
      const key = `inquiries/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${p.ext}`;
      await env.PHOTOS.put(key, p.bytes, { httpMetadata: { contentType: p.mime } });
      keys.push(key);
    }
  }

  row.created_at = kst();
  const ins = await env.DB.prepare(
    'INSERT INTO inquiries (created_at, company, name, phone, product, message, spec, photos, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(row.created_at, row.company, row.name, row.phone, row.product, row.message, JSON.stringify(spec), JSON.stringify(keys), ip, ua)
    .run();
  row.id = ins.meta.last_row_id;
  // 그 방문 기록(관리자 '최근 방문')에 문의 번호를 붙임 — 실패해도 문의 접수에는 영향 없음
  try { await linkInquiry(env, clean(body.vid, 32), row.id, request); } catch (e) { console.error('link visit', e); }

  // 저장이 끝난 뒤 메일 발송 + 업무앱(견적 대기)으로 보내기를 함께 하고, 결과를 한 번에 남김(쓰기 1번).
  // 둘 다 실패해도 문의는 이미 저장되어 있음. 업무앱은 비밀값(ERP_INQ_URL·ERP_INQ_SECRET)이 있을 때만.
  ctx.waitUntil(
    Promise.all([
      sendMail(env, row, spec, photos),
      sendToErp(env, erpPayload(row, spec, keys.length)).catch((e) => ({ ok: false, error: String(e).slice(0, 300) })),
    ]).then(([m, e]) =>
      env.DB.prepare('UPDATE inquiries SET email_sent = ?, email_error = ?, erp_sent = ?, erp_error = ?, erp_id = ?, erp_at = ? WHERE id = ?')
        .bind(m.ok ? 1 : 0, m.ok ? null : m.error, ...erpResultCols(e), e.skip ? null : kst(), row.id)
        .run()
    )
  );

  // 직원(관리자 로그인 중·회사 인터넷·직원 기기)이 보낸 문의면 홈페이지가 광고 전환을 보내지 않게 알려 줌
  let staff = '';
  try { staff = await staffOf(env, request, body.staff === '1'); } catch (e) { console.error('staff check', e); }
  return json(staff ? { ok: true, id: row.id, staff: 1 } : { ok: true, id: row.id });
}
