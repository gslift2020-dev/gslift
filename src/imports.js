// Claude가 대신 정리한 설치사례를 홈페이지에 올리기
// - public/imports/manifest.json 에 적힌 묶음(batch)을 한 번만 가져옴
// - 사진은 저장소(R2)로 옮기고, 글은 DB에 넣음 → 관리자 화면에서 평소처럼 수정·삭제 가능
// - 누가 홈페이지를 처음 열 때 뒤에서 자동 실행 (방문자는 기다리지 않음)
import { kst, ensureSchema, CATS } from './util.js';

let checkedAt = 0;

export async function runImports(request, env) {
  if (!env.DB || !env.PHOTOS || !env.ASSETS) return;
  if (Date.now() - checkedAt < 10000) return; // 10초에 한 번만 확인
  checkedAt = Date.now();
  const started = Date.now();
  const origin = new URL(request.url).origin;
  const r = await env.ASSETS.fetch(new Request(origin + '/imports/manifest.json'));
  if (!r.ok) return;
  let manifest;
  try { manifest = await r.json(); } catch { return; }
  await ensureSchema(env);
  // 8초 안에서 여러 건을 차례로 올림 (Cloudflare 무료 요금제의 뒤처리 시간 제한 안에 끝나도록)
  for (const batch of manifest.batches || []) {
    if (!/^[\w-]{3,60}$/.test(batch.id || '')) continue;
    const cases = batch.cases || [];
    // 이미 올린 글에서 일부 사진 빼기: 제목으로 글을 찾고, 정해진 순서(0부터)의 사진을 삭제
    if (batch.trim) {
      const key = `import:${batch.id}:trim`;
      const lock = await env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(key, JSON.stringify({ at: kst() })).run();
      if (lock.meta && lock.meta.changes) {
        for (const t of batch.trim) {
          const row = await env.DB.prepare('SELECT id FROM cases WHERE title = ? ORDER BY id DESC LIMIT 1').bind(t.title).first();
          if (!row) continue;
          if (t.body != null) await env.DB.prepare('UPDATE cases SET body = ? WHERE id = ?').bind(String(t.body).slice(0, 5000), row.id).run();
          if (!Array.isArray(t.drop) || !t.drop.length) continue;
          const { results } = await env.DB.prepare('SELECT id, photo_key, sort FROM case_photos WHERE case_id = ? ORDER BY sort, id').bind(row.id).all();
          if (t.expect && results.length !== t.expect) continue; // 사진 수가 예상과 다르면 건드리지 않음
          const gone = results.filter((p, i) => t.drop.includes(i) && i > 0); // 대표 사진(0번)은 지우지 않음
          for (const p of gone) await env.PHOTOS.delete(p.photo_key);
          if (gone.length) await env.DB.batch(gone.map((p) => env.DB.prepare('DELETE FROM case_photos WHERE id = ?').bind(p.id)));
        }
      }
      continue;
    }
    // 설치사례 전체 삭제 (한 번만): 사진까지 지우고 기본 예시도 숨김
    if (batch.removeAll) {
      const key = `import:${batch.id}:reset`;
      const lock = await env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(key, JSON.stringify({ at: kst() })).run();
      if (lock.meta && lock.meta.changes) {
        const { results } = await env.DB.prepare('SELECT photo_key FROM case_photos').all();
        const keys = results.map((r) => r.photo_key);
        for (let i = 0; i < keys.length; i += 500) await env.PHOTOS.delete(keys.slice(i, i + 500));
        await env.DB.batch([
          env.DB.prepare('DELETE FROM case_photos'),
          env.DB.prepare('DELETE FROM cases'),
          env.DB.prepare("INSERT INTO settings (key, value) VALUES ('hideSamples', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'"),
        ]);
        checkedAt = 0; // 새 글 올리기는 다음 방문 때
        return;
      }
    }
    // 예전에 중간에 끊겨 올라간 글 정리 (번호와 제목이 둘 다 맞을 때만)
    for (const rm of batch.remove || []) {
      const key = `import:${batch.id}:rm${rm.id}`;
      const lock = await env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(key, JSON.stringify({ at: kst() })).run();
      if (!lock.meta || !lock.meta.changes) continue;
      const row = await env.DB.prepare('SELECT id FROM cases WHERE id = ? AND title = ?').bind(rm.id, rm.title).first();
      if (!row) continue;
      const { results } = await env.DB.prepare('SELECT photo_key FROM case_photos WHERE case_id = ?').bind(rm.id).all();
      for (const p of results) await env.PHOTOS.delete(p.photo_key);
      await env.DB.batch([env.DB.prepare('DELETE FROM case_photos WHERE case_id = ?').bind(rm.id), env.DB.prepare('DELETE FROM cases WHERE id = ?').bind(rm.id)]);
    }
    for (let i = 0; i < cases.length; i++) {
      const key = `import:${batch.id}:${i}`;
      const got = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
      if (got) {
        let v = {};
        try { v = JSON.parse(got.value); } catch {}
        if (v.state === 'done' || v.state === 'failed') continue;
        // 2분 안의 "진행 중"은 다른 처리가 맡은 것 → 건너뛰고 다음 건으로
        if (v.state === 'running' && Date.now() - (v.t || 0) < 120000) continue;
        // 세 번 넘게 끊긴 건은 포기하고 다음 건으로 (관리자 화면에서 직접 올릴 수 있음)
        const tries = (v.tries || 0) + 1;
        if (tries > 3) { await env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(JSON.stringify({ state: 'failed', at: kst() }), key).run(); continue; }
        const took = await env.DB.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?').bind(JSON.stringify({ state: 'running', t: Date.now(), tries }), key, got.value).run();
        if (!took.meta || !took.meta.changes) continue;
      } else {
        const lock = await env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(key, JSON.stringify({ state: 'running', t: Date.now() })).run();
        if (!lock.meta || !lock.meta.changes) continue;
      }
      try {
        const id = await importCase(env, origin, cases[i]);
        await env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(JSON.stringify({ state: 'done', id, at: kst() }), key).run();
      } catch (e) {
        console.error('import failed', key, e);
        await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
      }
      checkedAt = 0; // 남은 건은 다음 방문 때 바로 이어서
      if (Date.now() - started > 8000) return; // 시간이 남으면 한 건 더

    }
  }
}

async function importCase(env, origin, c) {
  // 이전 시도가 글은 넣고 끊긴 경우 → 같은 글이 이미 있으면 그 번호를 그대로 씀 (중복 방지)
  const date0 = /^\d{4}-\d{2}$/.test(c.date || '') ? c.date + '-01' : null;
  const dup = await env.DB.prepare('SELECT id FROM cases WHERE title = ? AND site = ? AND body = ? AND IFNULL(taken_at, \'\') = ? ORDER BY id LIMIT 1')
    .bind(String(c.title).slice(0, 120), String(c.site || '').slice(0, 80), String(c.body || '').slice(0, 5000), date0 || '').first();
  if (dup) return dup.id;
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
  const row = await env.DB.prepare('INSERT INTO cases (created_at, title, sub, site, body, note, category, photo_key, taken_at, visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(kst(), String(c.title).slice(0, 120), '', String(c.site || '').slice(0, 80), String(c.body || '').slice(0, 5000), c.note ? String(c.note).slice(0, 300) : null, cat, keys[0], date, c.visible === false ? 0 : 1).run();
  const id = row.meta.last_row_id;
  await env.DB.batch(keys.map((k, i) => env.DB.prepare('INSERT INTO case_photos (case_id, photo_key, sort) VALUES (?, ?, ?)').bind(id, k, i)));
  return id;
}
