// 견적·상담 문의 접수: DB 저장 → 메일 알림
import { json, clean, esc, kst, ensureSchema } from './util.js';

const LIMITS = { company: 100, name: 50, phone: 30, product: 50, message: 3000 };
const PER_IP_PER_HOUR = 5;

async function sendMail(env, row) {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY 미설정' };
  const lines = [
    ['접수 시각', row.created_at + ' (한국시간)'],
    ['회사명', row.company || '-'],
    ['담당자', row.name],
    ['연락처', row.phone],
    ['관심 제품', row.product || '-'],
  ];
  const html = `<div style="font-family:sans-serif;font-size:15px;color:#0F1E3A">
<h2 style="color:#063678;margin:0 0 12px">홈페이지 견적·상담 문의 #${row.id}</h2>
<table style="border-collapse:collapse">${lines
    .map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;color:#4A5A78;white-space:nowrap">${k}</td><td style="padding:6px 0"><b>${esc(v)}</b></td></tr>`)
    .join('')}</table>
<div style="margin-top:16px;padding:14px;background:#F2F5FB;border-radius:8px;white-space:pre-wrap">${esc(row.message || '(내용 없음)')}</div>
<p style="margin-top:16px"><a href="tel:${esc(row.phone)}" style="background:#063678;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${esc(row.phone)} 전화하기</a></p>
</div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.MAIL_FROM || '거산리프트 홈페이지 <onboarding@resend.dev>',
        to: [env.NOTIFY_EMAIL || 'gslift2020@naver.com'],
        subject: `[홈페이지 문의] ${row.company || row.name} · ${row.product || '문의'}`,
        html,
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

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: '잘못된 요청입니다.' }, 400);
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
  if (!/^[0-9+\-() ]{8,20}$/.test(row.phone)) return json({ ok: false, field: 'phone', error: '연락처를 정확히 입력해 주세요.' }, 400);
  if (body.agree !== true) return json({ ok: false, field: 'agree', error: '개인정보 수집·이용에 동의해 주세요.' }, 400);

  const ip = request.headers.get('cf-connecting-ip') || '';
  const ua = clean(request.headers.get('user-agent'), 300);

  await ensureSchema(env);

  const since = kst(-3600 * 1000);
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM inquiries WHERE ip = ? AND created_at > ?').bind(ip, since).first();
  if (recent && recent.n >= PER_IP_PER_HOUR) {
    return json({ ok: false, error: '짧은 시간에 문의가 너무 많습니다. 전화(031-986-5345)로 연락 부탁드립니다.' }, 429);
  }

  row.created_at = kst();
  const ins = await env.DB.prepare(
    'INSERT INTO inquiries (created_at, company, name, phone, product, message, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(row.created_at, row.company, row.name, row.phone, row.product, row.message, ip, ua)
    .run();
  row.id = ins.meta.last_row_id;

  // 저장이 끝난 뒤 메일 발송. 메일이 실패해도 문의는 이미 저장되어 있음.
  ctx.waitUntil(
    sendMail(env, row).then((r) =>
      env.DB.prepare('UPDATE inquiries SET email_sent = ?, email_error = ? WHERE id = ?')
        .bind(r.ok ? 1 : 0, r.ok ? null : r.error, row.id)
        .run()
    )
  );

  return json({ ok: true, id: row.id });
}

