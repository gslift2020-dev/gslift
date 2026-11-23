// 업무앱 받는 창구 흉내: 서명 확인 · 문의 번호 중복 막기 · 받은 내용 저장
import http from 'node:http'; import crypto from 'node:crypto'; import fs from 'node:fs';
const SECRET = 'test-secret-123'; const seen = new Map(); let next = 100; let mode = 'ok';
http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
    const send = (st, o) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/mode') { mode = body; return send(200, { ok: true }); }
    if (req.url === '/log') return send(200, { items: [...seen.values()] });
    if (mode === 'down') return send(503, { ok: false, error: '점검 중' });
    if (mode === 'slow') return setTimeout(() => send(200, { ok: true, id: 1 }), 15000);
    const t = req.headers['x-gs-time'], sig = req.headers['x-gs-sign'];
    const want = crypto.createHmac('sha256', SECRET).update(t + '.' + body).digest('hex');
    if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return send(401, { ok: false, error: '시각 확인 실패' });
    if (!sig || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return send(401, { ok: false, error: '서명이 맞지 않습니다' });
    const p = JSON.parse(body);
    if (seen.has(p.inquiry_no)) return send(200, { ok: true, id: seen.get(p.inquiry_no).id, dup: true });
    const id = next++; seen.set(p.inquiry_no, { id, payload: p }); fs.writeFileSync(new URL('./last.json', import.meta.url), JSON.stringify(p, null, 2));
    send(200, { ok: true, id });
  });
}).listen(8799, () => console.log('mock on 8799'));
