// Claude가 대신 정리한 설치사례를 홈페이지에 올리기
// - public/imports/manifest.json 에 적힌 묶음(batch)을 한 번만 가져옴
// - 사진은 저장소(R2)로 옮기고, 글은 DB에 넣음 → 관리자 화면에서 평소처럼 수정·삭제 가능
// - 누가 홈페이지를 처음 열 때 뒤에서 자동 실행 (방문자는 기다리지 않음)
import { kst, ensureSchema, CATS } from './util.js';

let checkedAt = 0;

export async function runImports(request, env) {
  if (!env.DB || !env.PHOTOS || !env.ASSETS) return;
  if (Date.now() - checkedAt < 60000) return; // 1분에 한 번만 확인
  checkedAt = Date.now();
  const origin = new URL(request.url).origin;
  const r = await env.ASSETS.fetch(new Request(origin + '/imports/manifest.json'));
  if (!r.ok) return;
  let manifest;
  try { manifest = await r.json(); } catch { return; }
  await ensureSchema(env);
  for (const batch of manifest.batches || []) {
    if (!/^[\w-]{3,60}$/.test(batch.id || '')) continue;
    // 자리 잡기: 이미 가져갔거나 다른 요청이 가져가는 중이면 건너뜀
    const lock = await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").bind('import:' + batch.id, JSON.stringify({ at: kst(), state: 'running' })).run();
    if (!lock.meta || !lock.meta.changes) continue;
    try {
      const ids = [];
      for (const c of batch.cases || []) ids.push(await importCase(env, origin, c));
      await env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(JSON.stringify({ at: kst(), state: 'done', ids }), 'import:' + batch.id).run();
    } catch (e) {
      console.error('import failed', batch.id, e);
      // 실패하면 자리를 풀어서 다음에 다시 시도
      await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind('import:' + batch.id).run();
    }
  }
}

async function importCase(env, origin, c) {
  const keys = [];
  for (const p of c.photos || []) {
    const res = await env.ASSETS.fetch(new Request(origin + '/' + String(p).replace(/^\/+/, '')));
    if (!res.ok) throw new Error('photo missing: ' + p);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const key = `cases/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.webp`;
    await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' } });
    keys.push(key);
  }
  if (!keys.length) throw new Error('no photos');
  const cat = CATS[c.category] ? c.category : 'fl';
  const date = /^\d{4}-\d{2}$/.test(c.date || '') ? c.date + '-01' : null;
  const row = await env.DB.prepare('INSERT INTO cases (created_at, title, sub, site, body, category, photo_key, taken_at, visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(kst(), String(c.title).slice(0, 120), '', String(c.site || '').slice(0, 80), String(c.body || '').slice(0, 5000), cat, keys[0], date, c.visible === false ? 0 : 1).run();
  const id = row.meta.last_row_id;
  await env.DB.batch(keys.map((k, i) => env.DB.prepare('INSERT INTO case_photos (case_id, photo_key, sort) VALUES (?, ?, ?)').bind(id, k, i)));
  return id;
}
