// 거산리프트 홈페이지 서버 코드
// - /api/contact : 견적·상담 문의 접수 (DB 저장 → 메일 알림)
// - 그 외 주소는 public/ 폴더의 정적 파일을 그대로 보여줌

const LIMITS = { company: 100, name: 50, phone: 30, product: 50, message: 3000 };
const PER_IP_PER_HOUR = 5;

const SCHEMA = `CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  company TEXT, name TEXT NOT NULL, phone TEXT NOT NULL,
  product TEXT, message TEXT,
  ip TEXT, user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  email_sent INTEGER NOT NULL DEFAULT 0,
  email_error TEXT
)`;

let schemaReady = false;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function clean(v, max) {
  return String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function kstNow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

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

async function handleContact(request, env, ctx) {
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

  if (!schemaReady) {
    await env.DB.prepare(SCHEMA).run();
    schemaReady = true;
  }

  const since = new Date(Date.now() + 9 * 3600 * 1000 - 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM inquiries WHERE ip = ? AND created_at > ?').bind(ip, since).first();
  if (recent && recent.n >= PER_IP_PER_HOUR) {
    return json({ ok: false, error: '짧은 시간에 문의가 너무 많습니다. 전화(031-986-5345)로 연락 부탁드립니다.' }, 429);
  }

  row.created_at = kstNow();
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/contact') {
      try {
        return await handleContact(request, env, ctx);
      } catch (e) {
        console.error('contact error', e);
        return json({ ok: false, error: '일시적인 오류가 발생했습니다. 전화(031-986-5345)로 연락 부탁드립니다.' }, 500);
      }
    }
    if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
