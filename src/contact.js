// 견적·상담 문의 접수: DB 저장(사진은 R2) → 메일 알림(사진 첨부)
import { json, clean, esc, kst, ensureSchema } from './util.js';

const LIMITS = { company: 100, name: 50, phone: 30, product: 50, message: 3000 };
const PER_IP_PER_HOUR = 5;
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

// 고객이 아는 만큼만 적는 리프트 사양 (모두 선택)
export const SPEC_FIELDS = [
  ['loc', '설치 현장 위치', 100],
  ['dir', '출입방향', 30],
  ['load', '적재하중', 30],
  ['stops', '정지 층수', 30],
  ['place', '실내·외부', 30],
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

async function sendMail(env, row, spec, photos) {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY 미설정' };
  const lines = [
    ['접수 시각', row.created_at + ' (한국시간)'],
    ['회사명', row.company || '-'],
    ['담당자', row.name],
    ['연락처', row.phone],
    ['관심 제품', row.product || '-'],
  ];
  if (spec.src) lines.push(['유입 경로', spec.src]);
  const sr = specRows(spec);
  const table = (rows) => `<table style="border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;color:#4A5A78;white-space:nowrap">${k}</td><td style="padding:6px 0"><b>${esc(v)}</b></td></tr>`)
    .join('')}</table>`;
  const html = `<div style="font-family:sans-serif;font-size:15px;color:#0F1E3A">
<h2 style="color:#063678;margin:0 0 12px">홈페이지 견적·상담 문의 #${row.id}</h2>
${table(lines)}
${sr.length ? `<h3 style="color:#063678;margin:18px 0 6px;font-size:16px">고객이 적은 리프트 사양</h3>${table(sr)}` : ''}
<div style="margin-top:16px;padding:14px;background:#F2F5FB;border-radius:8px;white-space:pre-wrap">${esc(row.message || '(내용 없음)')}</div>
${photos.length ? `<p style="color:#4A5A78">현장 사진 ${photos.length}장이 첨부되어 있습니다.</p>` : ''}
<p style="margin-top:16px"><a href="tel:${esc(row.phone)}" style="background:#063678;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${esc(row.phone)} 전화하기</a></p>
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
  if (body.website) return json({ ok: true });

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

  // 광고 유입 경로 (홈페이지가 자동으로 붙여 보냄: naver, kakao, search.naver.com 등)
  const src = clean(body.src, 40).replace(/[^\w.\-]/g, '');
  if (src) spec.src = src;

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

  // 저장이 끝난 뒤 메일 발송. 메일이 실패해도 문의는 이미 저장되어 있음.
  ctx.waitUntil(
    sendMail(env, row, spec, photos).then((r) =>
      env.DB.prepare('UPDATE inquiries SET email_sent = ?, email_error = ? WHERE id = ?')
        .bind(r.ok ? 1 : 0, r.ok ? null : r.error, row.id)
        .run()
    )
  );

  return json({ ok: true, id: row.id });
}
