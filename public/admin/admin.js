/* 거산리프트 관리자 화면 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var CASE_W = 1200, CASE_H = 1600;   // 설치사례 사진 (세로 3:4)
  var HERO_W = 1200, HERO_H = 1500;   // 메인 슬라이드 (세로 4:5)
  var WM_RATIO = 0.30, WM_ALPHA = 0.38;
  var STATUS = { 'new': '신규', progress: '처리중', done: '완료' };
  var CATS = { fl: '화물용 리프트(F/L)', tl: '테이블 리프트(T/L)', st: '수동·자동 스태커', tr: '운반기계' };
  function inferCat(t) { t = String(t || ''); if (/테이블|T\/L/i.test(t)) return 'tl'; if (/스태커/.test(t)) return 'st'; if (/운반|대차/.test(t)) return 'tr'; return 'fl'; }

  /* ================= 공통 ================= */
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'x-gs-admin': '1' };
    if (opts.json) { headers['content-type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
    return fetch(path, { method: opts.method || 'GET', headers: headers, body: opts.body, credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: '서버 응답 오류 (' + r.status + ')' }; }); })
      .then(function (d) { if (d && d.login) showLogin(); return d; });
  }
  function say(el, text, kind) { el.textContent = text || ''; el.className = 'msg ' + (kind || ''); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function move(arr, from, to) { var x = arr.splice(from, 1)[0]; arr.splice(to, 0, x); }

  /* ================= 로그인·탭 ================= */
  var loaded = {};
  function showLogin() {
    $('#appView').hidden = true; $('#logoutBtn').hidden = true; $('#loginView').hidden = false;
    $('#loginForm').password.focus();
  }
  function showApp() {
    $('#loginView').hidden = true; $('#appView').hidden = false; $('#logoutBtn').hidden = false;
    loadInquiries(); loadSettings(); loadDash();
  }
  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, btn = $('button', f), msg = $('#loginMsg');
    btn.disabled = true; say(msg, '');
    api('/api/admin/login', { method: 'POST', json: { password: f.password.value } }).then(function (d) {
      btn.disabled = false;
      if (d.ok) { f.reset(); showApp(); } else say(msg, d.error || '로그인 실패', 'err');
    }).catch(function () { btn.disabled = false; say(msg, '연결 오류', 'err'); });
  });
  $('#logoutBtn').addEventListener('click', function () { api('/api/admin/logout', { method: 'POST' }).then(showLogin); });
  $$('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { openTab(b.dataset.tab); });
  });
  function openTab(tab) {
    $$('.tabs button').forEach(function (x) { var on = x.dataset.tab === tab; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
    ['dash', 'inq', 'cases', 'bulk', 'notice', 'hero', 'yt', 'faq', 'co'].forEach(function (t) { $('#tab-' + t).hidden = tab !== t; });
    if (tab === 'cases' && !loaded.cases) { loaded.cases = 1; loadCases(true); }
    if (tab === 'notice' && !loaded.notice) { loaded.notice = 1; loadNotices(); }
    if (tab === 'dash') loadDash();
  }

  /* ================= 문의 ================= */
  var inquiries = [], filter = 'all';
  function loadInquiries() {
    $('#inqList').innerHTML = '<p class="empty">불러오는 중…</p>';
    api('/api/admin/inquiries').then(function (d) {
      if (!d.ok) { $('#inqList').innerHTML = '<p class="empty">' + esc(d.error) + '</p>'; return; }
      inquiries = d.items; renderInquiries();
      $('#dNew').textContent = inquiries.filter(function (x) { return x.status === 'new'; }).length;
    });
  }
  var inqQuery = '';
  function renderInquiries() {
    var now = new Date(Date.now() + 9 * 3600 * 1000), month = now.toISOString().slice(0, 7);
    var d30 = new Date(Date.now() + 9 * 3600 * 1000 - 30 * 864e5).toISOString().replace('T', ' ').slice(0, 19);
    var n = inquiries.filter(function (x) { return x.status === 'new'; }).length;
    $('#newCount').hidden = !n; $('#newCount').textContent = n;
    $('#kNew').textContent = n;
    $('#kMonth').textContent = inquiries.filter(function (x) { return (x.created_at || '').slice(0, 7) === month; }).length;
    $('#k30').textContent = inquiries.filter(function (x) { return (x.created_at || '') > d30; }).length;
    $('#kAll').textContent = inquiries.length;
    var q = inqQuery.trim().toLowerCase();
    var rows = inquiries.filter(function (x) {
      if (filter !== 'all' && x.status !== filter) return false;
      if (!q) return true;
      return [x.company, x.name, x.phone, x.message, x.memo, x.product, (x.spec || []).map(function (r) { return r[1]; }).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    if (!rows.length) { $('#inqList').innerHTML = '<p class="empty">해당하는 문의가 없습니다.</p>'; return; }
    $('#inqList').innerHTML = rows.map(function (x) {
      var opts = Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (k === x.status ? ' selected' : '') + '>' + STATUS[k] + '</option>'; }).join('');
      var spec = (x.spec || []).map(function (r) { return '<div><small>' + esc(r[0]) + '</small><b>' + esc(r[1]) + '</b></div>'; }).join('');
      var photos = (x.photos || []).map(function (u, i) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener" aria-label="현장 사진 ' + (i + 1) + ' 크게 보기"><img src="' + esc(u) + '" alt="" loading="lazy"></a>'; }).join('');
      return '<article class="inq ' + esc(x.status) + '">' +
        '<div><div class="who">#' + x.id + ' ' + esc(x.company || '(회사명 없음)') + ' · ' + esc(x.name) + '</div>' +
        '<div class="meta">' + esc(x.created_at) + ' · ' + esc(x.product || '-') + (x.photos && x.photos.length ? ' · 사진 ' + x.photos.length + '장' : '') + '</div></div>' +
        '<span class="st st-' + esc(x.status) + '">' + STATUS[x.status] + '</span>' +
        (spec ? '<div class="ispec">' + spec + '</div>' : '') +
        '<div class="body">' + esc(x.message) + '</div>' +
        (photos ? '<div class="iphotos">' + photos + '</div>' : '') +
        '<label class="memo">내부 메모 <small>(고객에게 보이지 않음 · 입력 후 다른 곳을 누르면 저장)</small><textarea rows="2" data-memo="' + x.id + '" placeholder="예) 10/15 현장 방문 예정, 견적 1,800만원 제출">' + esc(x.memo || '') + '</textarea></label>' +
        '<div class="acts"><a class="tel" href="tel:' + esc(x.phone) + '">' + esc(x.phone) + ' 전화</a>' +
        '<label style="flex-direction:row;align-items:center;gap:6px;font-weight:500">상태 <select data-id="' + x.id + '" aria-label="처리 상태">' + opts + '</select></label>' +
        (x.email_sent ? '' : '<span class="warn">알림 메일 미발송' + (x.email_error ? ': ' + esc(x.email_error) : '') + '</span>') +
        '<button type="button" class="link del" data-del="' + x.id + '">삭제</button>' +
        '</div></article>';
    }).join('');
  }
  $('#inqSearch').addEventListener('input', function () { inqQuery = this.value; renderInquiries(); });
  $('#inqList').addEventListener('focusout', function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.memo) return;
    var id = +t.dataset.memo, it = inquiries.filter(function (x) { return x.id === id; })[0];
    if (!it || (it.memo || '') === t.value) return;
    api('/api/admin/inquiries/' + id, { method: 'POST', json: { memo: t.value } }).then(function (d) {
      if (!d.ok) return alert(d.error || '메모 저장 실패');
      it.memo = t.value; t.classList.add('saved'); setTimeout(function () { t.classList.remove('saved'); }, 1200);
    });
  });
  // 처리 상태 바꾸기 (신규 → 처리중 → 완료)
  $('#inqList').addEventListener('change', function (e) {
    var sel = e.target; if (!sel.dataset || !sel.dataset.id || sel.tagName !== 'SELECT') return;
    var id = +sel.dataset.id, it = inquiries.filter(function (x) { return x.id === id; })[0], prev = it && it.status;
    sel.disabled = true;
    api('/api/admin/inquiries/' + id, { method: 'POST', json: { status: sel.value } }).then(function (d) {
      sel.disabled = false;
      if (!d.ok) { sel.value = prev; return alert(d.error || '상태를 바꾸지 못했습니다.'); }
      if (it) it.status = sel.value;
      renderInquiries();
      $('#dNew').textContent = inquiries.filter(function (x) { return x.status === 'new'; }).length;
    }, function () { sel.disabled = false; sel.value = prev; alert('연결 오류로 상태를 바꾸지 못했습니다.'); });
  });
  $('#inqList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]'); if (!b) return;
    if (!confirm('#' + b.dataset.del + ' 문의를 삭제할까요? 첨부 사진도 함께 지워지며 되돌릴 수 없습니다.')) return;
    api('/api/admin/inquiries/' + b.dataset.del, { method: 'DELETE' }).then(function (d) {
      if (!d.ok) return alert(d.error || '삭제 실패');
      inquiries = inquiries.filter(function (x) { return x.id !== +b.dataset.del; }); renderInquiries();
    });
  });
  // 엑셀에서 한글이 깨지지 않도록 BOM 붙인 CSV
  $('#csvBtn').addEventListener('click', function () {
    var cols = ['번호', '접수시각', '상태', '회사명', '담당자', '연락처', '관심제품', '사양', '문의내용', '사진수', '내부메모'];
    var cell = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [cols.join(',')].concat(inquiries.map(function (x) {
      return [x.id, x.created_at, STATUS[x.status], x.company, x.name, x.phone, x.product,
        (x.spec || []).map(function (r) { return r[0] + ': ' + r[1]; }).join(' / '), x.message, (x.photos || []).length, x.memo].map(cell).join(',');
    }));
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = '거산리프트_문의목록_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  });
  $$('#filters button').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.dataset.f;
      $$('#filters button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderInquiries();
    });
  });
  $('#reloadInq').addEventListener('click', loadInquiries);

  /* ================= 사진 처리 (브라우저 안에서) ================= */
  var watermark = null;
  var wmReady = new Promise(function (ok) {
    var im = new Image(); im.onload = function () { watermark = im; ok(); }; im.onerror = function () { ok(); };
    im.src = '/assets/img/emblem-white.webp';
  });
  function decode(file) {
    var viaImg = function () {
      return new Promise(function (ok, no) {
        var url = URL.createObjectURL(file), im = new Image();
        im.onload = function () { ok(im); }; im.onerror = function () { URL.revokeObjectURL(url); no(new Error('decode')); };
        im.src = url;
      });
    };
    if (window.createImageBitmap) return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(viaImg);
    return viaImg();
  }
  // 새 사진 하나: 원본 + 자르기 위치 + 워터마크 위치
  function newItem(bitmap, wmOn) { return { kind: 'new', bitmap: bitmap, fx: 0.5, fy: 0.5, wm: { on: wmOn, x: 0.5, y: 0.5 } }; }

  function cropBox(item, W, H) {
    var sw = item.bitmap.width, sh = item.bitmap.height, t = W / H, cw, ch;
    if (sw / sh > t) { ch = sh; cw = sh * t; } else { cw = sw; ch = sw / t; }
    return { cw: cw, ch: ch, cx: (sw - cw) * item.fx, cy: (sh - ch) * item.fy, sw: sw, sh: sh };
  }
  function wmBox(item, W, H) {
    if (!watermark) return null;
    var ww = W * WM_RATIO, wh = ww * watermark.naturalHeight / watermark.naturalWidth;
    var x = Math.min(Math.max(item.wm.x * W - ww / 2, 0), W - ww), y = Math.min(Math.max(item.wm.y * H - wh / 2, 0), H - wh);
    return { x: x, y: y, w: ww, h: wh };
  }
  function render(canvas, item, W, H, guide) {
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d'), c = cropBox(item, W, H);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(item.bitmap, c.cx, c.cy, c.cw, c.ch, 0, 0, W, H);
    var b = item.wm.on && wmBox(item, W, H);
    if (b) {
      ctx.globalAlpha = WM_ALPHA; ctx.drawImage(watermark, b.x, b.y, b.w, b.h); ctx.globalAlpha = 1;
      if (guide) { ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2; ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8); ctx.setLineDash([]); }
    }
  }
  function toBlob(item, W, H) {
    var c = document.createElement('canvas');
    render(c, item, W, H, false);
    return new Promise(function (ok) {
      c.toBlob(function (b) {
        if (b && b.type === 'image/webp') return ok(b);
        c.toBlob(ok, 'image/jpeg', 0.85); // WebP를 못 만드는 브라우저(일부 아이폰)는 JPG로
      }, 'image/webp', 0.82);
    });
  }

  // 끌어다 놓기 칸
  function dropzone(zone, onFiles) {
    var input = $('input', zone);
    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', function () { if (input.files.length) onFiles(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.remove('over'); }); });
    zone.addEventListener('drop', function (e) { if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); });
  }
  function loadFiles(files, wmOn, msg) {
    var list = Array.prototype.filter.call(files, function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name); });
    say(msg, list.length + '장 읽는 중…');
    return wmReady.then(function () {
      return Promise.all(list.map(function (f) { return decode(f).then(function (b) { return newItem(b, wmOn); }, function () { return null; }); }));
    }).then(function (items) {
      var bad = items.filter(function (x) { return !x; }).length;
      say(msg, bad ? bad + '장은 읽을 수 없는 형식이라 뺐습니다. (아이폰 사진은 JPG로 저장 후 다시 시도)' : '', bad ? 'err' : '');
      return items.filter(Boolean);
    });
  }

  // 미리보기 편집기: 사진 끌기 = 자르기 위치, 로고 끌기 = 워터마크 위치
  function adjuster(box, W, H, onChange) {
    var canvas = $('canvas', box), PW = canvas.width, PH = canvas.height, item = null, drag = null;
    function draw() { if (item) render(canvas, item, PW, PH, true); syncButtons(); }
    function syncButtons() {
      if (!item) return;
      $$('.seg', box).forEach(function (seg) {
        var v = item.wm[seg.dataset.wm];
        $$('button', seg).forEach(function (b) { b.classList.toggle('on', Math.abs(+b.dataset.v - v) < 0.01); });
      });
      var chk = $('input[data-wm=on]', box); if (chk) chk.checked = item.wm.on;
    }
    function pos(e) { var r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * PW, y: (e.clientY - r.top) / r.height * PH }; }
    canvas.addEventListener('pointerdown', function (e) {
      if (!item) return;
      var p = pos(e), b = item.wm.on && wmBox(item, PW, PH);
      drag = (b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) ? { mode: 'wm', ox: p.x - (b.x + b.w / 2), oy: p.y - (b.y + b.h / 2) } : { mode: 'pan', x: p.x, y: p.y };
      canvas.setPointerCapture(e.pointerId); canvas.classList.add('grabbing');
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag || !item) return;
      var p = pos(e);
      if (drag.mode === 'wm') {
        item.wm.x = Math.min(Math.max((p.x - drag.ox) / PW, 0), 1);
        item.wm.y = Math.min(Math.max((p.y - drag.oy) / PH, 0), 1);
      } else {
        var c = cropBox(item, PW, PH), scale = c.cw / PW;
        var slackX = c.sw - c.cw, slackY = c.sh - c.ch;
        if (slackX > 1) item.fx = Math.min(Math.max(item.fx - (p.x - drag.x) * scale / slackX, 0), 1);
        if (slackY > 1) item.fy = Math.min(Math.max(item.fy - (p.y - drag.y) * scale / slackY, 0), 1);
        drag.x = p.x; drag.y = p.y;
      }
      draw();
    });
    function end() { if (drag) { drag = null; canvas.classList.remove('grabbing'); onChange(); } }
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    $$('.seg button', box).forEach(function (b) {
      b.addEventListener('click', function () { if (!item) return; item.wm[b.parentNode.dataset.wm] = +b.dataset.v; if (!item.wm.on) item.wm.on = true; draw(); onChange(); });
    });
    var chk = $('input[data-wm=on]', box);
    if (chk) chk.addEventListener('change', function () { if (item) { item.wm.on = chk.checked; draw(); onChange(); } });
    return {
      show: function (it) { item = it && it.kind === 'new' ? it : null; box.hidden = !item; draw(); },
      current: function () { return item; },
      redraw: draw
    };
  }

  /* ================= 설정 (사양 버튼, 유튜브, 슬라이드) ================= */
  var chips = [], videos = [];
  function loadSettings() {
    return api('/api/admin/settings').then(function (d) {
      if (!d.ok) return;
      chips = d.chips; videos = d.videos; $('#hideSamples').checked = !!d.hideSamples;
      renderChips(); heroLoad(d.slides); ytRender();
      faqItems = d.faq || []; faqRender(); coFill(d.company || {});
    });
  }

  /* ================= 설치사례 편집 ================= */
  var cases = [], editing = null; // editing: { id, items: [...], sel: index, chipSel: {group: value} }
  var caseAdj = adjuster($('#caseAdjust'), CASE_W, CASE_H, function () { renderThumbs(true); });
  $$('#caseAdjust [data-act=applyAll]').forEach(function (b) {
    b.addEventListener('click', function () {
      var cur = caseAdj.current(); if (!cur) return;
      editing.items.forEach(function (it) { if (it.kind === 'new') it.wm = { on: cur.wm.on, x: cur.wm.x, y: cur.wm.y }; });
      renderThumbs(true); say($('#caseMsg'), '모든 새 사진에 같은 워터마크 위치를 적용했습니다.', 'ok');
    });
  });

  function openEditor(post) {
    editing = { id: post ? post.id : null, items: [], sel: -1, chipSel: {}, cat: post ? post.cat : (CATS[caseFilter] ? caseFilter : '') };
    var f = $('#caseForm');
    f.hidden = false; f.reset(); say($('#caseMsg'), '');
    $('#caseFormTitle').textContent = post ? '설치사례 수정' : '새 설치사례';
    $('#caseSave').textContent = post ? '수정 내용 저장' : '홈페이지에 올리기';
    if (post) {
      editing.items = post.photos.map(function (p) { return { kind: 'old', id: p.id, img: p.img }; });
      f.title.value = post.title; f.site.value = post.site || ''; f.body.value = post.body || ''; f.note.value = post.note || '';
      f.date.value = post.taken_at ? post.taken_at.slice(0, 7) : '';
      // 제목에 들어있는 사양을 버튼에 표시
      var parts = post.title.split('·').map(function (s) { return s.trim(); });
      chips.forEach(function (g) { g.items.forEach(function (v) { if (parts.indexOf(v) >= 0) editing.chipSel[g.name] = v; }); });
    }
    if (!post && editing.cat) setTitleCat(editing.cat);
    renderChips(); renderThumbs(); caseAdj.show(null); renderCat();
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeEditor() { $('#caseForm').hidden = true; editing = null; }
  $('#newCaseBtn').addEventListener('click', function () { openEditor(null); });
  $('#caseCancel').addEventListener('click', closeEditor);

  dropzone($('#caseDrop'), function (files) {
    loadFiles(files, true, $('#caseMsg')).then(function (items) {
      if (!items.length) return;
      var room = 20 - editing.items.length;
      if (items.length > room) say($('#caseMsg'), '한 글에는 사진을 20장까지 올릴 수 있습니다.', 'err');
      items = items.slice(0, Math.max(room, 0));
      var first = editing.items.length;
      editing.items = editing.items.concat(items);
      if (items.length) { editing.sel = first; caseAdj.show(editing.items[first]); }
      renderThumbs();
    });
  });

  var dragFrom = -1;
  function renderThumbs(onlyRedraw) {
    var box = $('#caseThumbs');
    if (onlyRedraw) {
      $$('.thumb', box).forEach(function (t, i) { var it = editing.items[i]; var c = $('canvas', t); if (c && it.kind === 'new') render(c, it, 150, 200, false); });
      return;
    }
    box.innerHTML = '';
    editing.items.forEach(function (it, i) {
      var t = el('div', 'thumb' + (i === editing.sel ? ' sel' : ''));
      t.draggable = true; t.tabIndex = 0; t.setAttribute('aria-label', (i + 1) + '번째 사진' + (i === 0 ? ' (대표)' : ''));
      if (it.kind === 'new') { var c = document.createElement('canvas'); render(c, it, 150, 200, false); t.appendChild(c); }
      else { var im = document.createElement('img'); im.src = it.img; im.alt = ''; t.appendChild(im); t.appendChild(el('span', 'old', '올린 사진')); }
      t.appendChild(el('span', 'no' + (i === 0 ? ' cover' : ''), i === 0 ? '대표' : String(i + 1)));
      var x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', (i + 1) + '번째 사진 빼기'); t.appendChild(x);
      var mv = el('div', 'mv', '<button type="button" data-d="-1" aria-label="앞으로">◀</button><button type="button" data-d="1" aria-label="뒤로">▶</button>');
      t.appendChild(mv);
      x.addEventListener('click', function (e) {
        e.stopPropagation(); editing.items.splice(i, 1);
        if (editing.sel === i) { editing.sel = -1; caseAdj.show(null); } else if (editing.sel > i) editing.sel--;
        renderThumbs();
      });
      $$('button', mv).forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation(); var to = i + +b.dataset.d; if (to < 0 || to >= editing.items.length) return;
          move(editing.items, i, to); if (editing.sel === i) editing.sel = to; else if (editing.sel === to) editing.sel = i; renderThumbs();
        });
      });
      t.addEventListener('click', function () {
        editing.sel = i; caseAdj.show(it); renderThumbs();
        if (it.kind === 'old') say($('#caseMsg'), '이미 올린 사진은 위치를 바꿀 수 없습니다. 빼고 새로 올려주세요.', '');
      });
      t.addEventListener('dragstart', function () { dragFrom = i; t.classList.add('dragging'); });
      t.addEventListener('dragend', function () { t.classList.remove('dragging'); $$('.drop-before', box).forEach(function (x) { x.classList.remove('drop-before'); }); });
      t.addEventListener('dragover', function (e) { e.preventDefault(); t.classList.add('drop-before'); });
      t.addEventListener('dragleave', function () { t.classList.remove('drop-before'); });
      t.addEventListener('drop', function (e) {
        e.preventDefault(); if (dragFrom < 0 || dragFrom === i) return;
        var selItem = editing.items[editing.sel];
        move(editing.items, dragFrom, i); editing.sel = editing.items.indexOf(selItem); dragFrom = -1; renderThumbs();
      });
      box.appendChild(t);
    });
  }

  /* ---- 사양 버튼 (카드집) ---- */
  var chipEditing = false;
  function renderChips() {
    var box = $('#chipBox'), sel = editing ? editing.chipSel : {};
    box.classList.toggle('editing', chipEditing);
    box.innerHTML = '';
    chips.forEach(function (g, gi) {
      var row = el('div', 'cgroup');
      row.appendChild(el('span', 'gname', esc(g.name)));
      g.items.forEach(function (v, vi) {
        var b = el('button', 'chip' + (sel[g.name] === v ? ' on' : ''), esc(v) + '<span class="del" aria-hidden="true">×</span>');
        b.type = 'button'; b.setAttribute('aria-pressed', sel[g.name] === v);
        b.addEventListener('click', function () {
          if (chipEditing) { g.items.splice(vi, 1); renderChips(); return; }
          if (!editing) return;
          if (sel[g.name] === v) delete sel[g.name]; else sel[g.name] = v;
          if (sel[g.name] === v && isProduct(v)) { delete sel[g.name]; editing.cat = inferCat(v); renderCat(); }
          buildTitle(); renderChips();
        });
        row.appendChild(b);
      });
      var add = el('input', 'add'); add.type = 'text'; add.placeholder = '+ 추가 (Enter)'; add.setAttribute('aria-label', g.name + ' 버튼 추가');
      add.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return; e.preventDefault();
        var v = add.value.trim(); if (v && g.items.indexOf(v) < 0) { g.items.push(v); renderChips(); $$('.cgroup .add', box)[gi].focus(); }
      });
      row.appendChild(add);
      var gd = el('button', 'link gdel', '묶음 삭제'); gd.type = 'button';
      gd.addEventListener('click', function () { if (confirm('"' + g.name + '" 묶음을 삭제할까요?')) { chips.splice(gi, 1); renderChips(); } });
      row.appendChild(gd);
      box.appendChild(row);
    });
    var ng = el('div', 'newgroup', '<input type="text" placeholder="새 묶음 이름 (예: 문 형태)" aria-label="새 묶음 이름"><button type="button" class="link">묶음 추가</button>');
    $('button', ng).addEventListener('click', function () {
      var v = $('input', ng).value.trim(); if (v) { chips.push({ name: v, items: [] }); renderChips(); }
    });
    box.appendChild(ng);
  }
  function renderCat() {
    $$('#catSeg button').forEach(function (b) { var on = editing && b.dataset.cat === editing.cat; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  }
  $$('#catSeg button').forEach(function (b) { b.addEventListener('click', function () { if (editing) { editing.cat = b.dataset.cat; renderCat(); setTitleCat(b.dataset.cat); } }); });
  // 제품 이름(분류)은 제목 맨 앞: "화물용 리프트(F/L) · 2톤 · 3STOP"
  function isProduct(v) { return /리프트|스태커|운반기계|F\/L|T\/L/i.test(v); }
  function splitTitle(t) { return String(t || '').split('·').map(function (x) { return x.trim(); }).filter(Boolean); }
  function setTitleCat(cat) {
    var f = $('#caseForm'), parts = splitTitle(f.title.value);
    if (parts.length && isProduct(parts[0])) parts.shift();
    f.title.value = [CATS[cat]].concat(parts).join(' · ');
  }
  function buildTitle() {
    var sel = editing.chipSel, parts = editing.cat ? [CATS[editing.cat]] : [];
    chips.forEach(function (g) { if (sel[g.name] && !isProduct(sel[g.name])) parts.push(sel[g.name]); });
    $('#caseForm').title.value = parts.join(' · ');
  }
  $('#chipEditBtn').addEventListener('click', function () {
    if (!chipEditing) { chipEditing = true; this.textContent = '편집 완료 (저장)'; renderChips(); return; }
    var btn = this;
    api('/api/admin/settings', { method: 'POST', json: { chips: chips } }).then(function (d) {
      if (!d.ok) return say($('#caseMsg'), d.error || '버튼 저장 실패', 'err');
      chips = d.chips; chipEditing = false; btn.textContent = '버튼 편집'; renderChips();
      say($('#caseMsg'), '사양 버튼을 저장했습니다.', 'ok');
    });
  });

  /* ---- 저장 ---- */
  $('#caseForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, msg = $('#caseMsg'), btn = $('#caseSave');
    if (!editing.items.length) return say(msg, '사진을 1장 이상 올려주세요.', 'err');
    if (!f.title.value.trim()) { f.title.focus(); return say(msg, '제목을 입력하거나 사양 버튼을 골라주세요.', 'err'); }
    if (!editing.cat) { $('#catSeg').scrollIntoView({ block: 'center' }); return say(msg, '분류(화물용·테이블·스태커·운반기계)를 골라주세요.', 'err'); }
    btn.disabled = true;
    var fd = new FormData(), order = [], news = editing.items.filter(function (x) { return x.kind === 'new'; }), done = 0;
    fd.append('title', f.title.value.trim()); fd.append('category', editing.cat); fd.append('site', f.site.value.trim()); fd.append('body', f.body.value.trim()); fd.append('note', f.note.value.trim());
    if (f.date.value && !/^\d{4}-\d{2}$/.test(f.date.value.trim())) { btn.disabled = false; f.date.focus(); return say(msg, '설치 날짜는 2024-05 처럼 적어주세요.', 'err'); }
    fd.append('date', f.date.value.trim());
    var chain = Promise.resolve();
    editing.items.forEach(function (it) {
      if (it.kind === 'old') { order.push('p:' + it.id); return; }
      var n = news.indexOf(it); order.push('n:' + n);
      chain = chain.then(function () {
        say(msg, '사진 변환 중… (' + (++done) + '/' + news.length + ')');
        return toBlob(it, CASE_W, CASE_H).then(function (b) { fd.append('photos', b, 'p' + n + (b.type === 'image/webp' ? '.webp' : '.jpg')); });
      });
    });
    chain.then(function () {
      fd.append('order', JSON.stringify(order));
      say(msg, '올리는 중…');
      return api('/api/admin/cases' + (editing.id ? '/' + editing.id : ''), { method: 'POST', body: fd });
    }).then(function (d) {
      btn.disabled = false;
      if (!d.ok) return say(msg, d.error || '저장 실패', 'err');
      closeEditor(); loadCases(true);
      say($('#caseMsg'), '');
      flash('저장했습니다. 홈페이지 설치사례에서 확인할 수 있습니다.');
    }).catch(function () { btn.disabled = false; say(msg, '연결 오류로 저장하지 못했습니다.', 'err'); });
  });
  function flash(text) {
    var m = el('p', 'msg ok', esc(text)); m.style.margin = '12px 0 0';
    $('#caseList').before(m); setTimeout(function () { m.remove(); }, 5000);
  }

  /* ---- 글 목록 ---- */
  var caseTotal = 0, caseQ = '', caseReq = 0;
  function loadCases(reset) {
    var off = reset ? 0 : cases.length, my = ++caseReq;
    var url = '/api/admin/cases?limit=60&offset=' + off + (CATS[caseFilter] ? '&cat=' + caseFilter : '') + (caseQ ? '&q=' + encodeURIComponent(caseQ) : '');
    api(url).then(function (d) {
      if (my !== caseReq) return;
      if (!d.ok) { $('#caseList').innerHTML = '<p class="empty">' + esc(d.error) + '</p>'; return; }
      cases = reset ? d.items : cases.concat(d.items); caseTotal = d.total;
      $$('#caseFilters button').forEach(function (b) { $('i', b).textContent = d.counts[b.dataset.f] || 0; });
      renderCaseList();
    });
  }
  var caseFilter = 'all';
  $$('#caseFilters button').forEach(function (b) {
    b.addEventListener('click', function () { caseFilter = b.dataset.f; $$('#caseFilters button').forEach(function (x) { x.classList.toggle('on', x === b); }); loadCases(true); });
  });
  var caseQt;
  $('#caseSearch').addEventListener('input', function () { var v = this.value.trim(); clearTimeout(caseQt); caseQt = setTimeout(function () { caseQ = v; loadCases(true); }, 300); });
  $('#caseMore').addEventListener('click', function () { loadCases(false); });
  // 내부 메모 한꺼번에 넣기
  $('#notesGo').addEventListener('click', function () {
    var t = $('#notesText').value.trim(), msg = $('#notesMsg'), btn = this;
    if (!t) return say(msg, '목록을 붙여넣어 주세요.', 'err');
    btn.disabled = true; say(msg, '넣는 중…');
    api('/api/admin/case-notes', { method: 'POST', json: { text: t } }).then(function (d) {
      btn.disabled = false;
      if (!d.ok) return say(msg, d.error || '실패했습니다.', 'err');
      say(msg, d.done + '건 넣었습니다.' + (d.miss.length ? ' 못 찾은 줄 ' + d.miss.length + '개: ' + d.miss.slice(0, 3).join(' / ') : ''), d.miss.length ? 'err' : 'ok');
      if (!d.miss.length) $('#notesText').value = '';
      loadCases(true);
    });
  });
  $('#hideSamples').addEventListener('change', function () {
    var cb = this;
    api('/api/admin/settings', { method: 'POST', json: { hideSamples: cb.checked } }).then(function (d) {
      if (!d.ok) { cb.checked = !cb.checked; return alert(d.error || '저장 실패'); }
      flash(cb.checked ? '기본 예시 사례를 홈페이지에서 숨겼습니다.' : '기본 예시 사례를 다시 보이게 했습니다.');
    });
  });
  function renderCaseList() {
    {
      var list = cases;
      $('#caseMore').hidden = cases.length >= caseTotal;
      if (!list.length) { $('#caseList').innerHTML = '<p class="empty">' + (caseQ ? '찾는 글이 없습니다.' : caseFilter === 'all' ? '아직 올린 글이 없습니다. "새 글 쓰기"를 눌러 시작하세요.' : '이 분류에 올린 글이 없습니다.') + '</p>'; return; }
      $('#caseList').innerHTML = list.map(function (c) {
        var cover = c.photos[0] ? c.photos[0].img : '';
        return '<article class="post' + (c.visible ? '' : ' hidden') + (c.pinned ? ' pinned' : '') + '"><div class="ph"><img src="' + esc(cover) + '" alt="" loading="lazy"><span class="cnt">사진 ' + c.photos.length + '장</span>' + (c.pinned ? '<span class="pin">📌 맨 앞 고정</span>' : '') + '</div>' +
          '<span class="pcat">' + esc(CATS[c.cat] || '') + '</span><div class="t">' + esc(c.title) + (c.visible ? '' : ' (숨김)') + '</div><div class="s">' + esc([c.site, c.taken_at ? '설치 ' + c.taken_at.slice(0, 7) : '등록 ' + (c.created_at || '').slice(0, 10)].filter(Boolean).join(' · ')) + '</div>' + (c.note ? '<div class="s note">🔒 ' + esc(c.note) + '</div>' : '') +
          '<div class="a"><button type="button" class="link" data-act="edit" data-id="' + c.id + '">수정</button>' +
          '<button type="button" class="link" data-act="pin" data-id="' + c.id + '" data-v="' + c.pinned + '">' + (c.pinned ? '고정 풀기' : '맨 앞 고정') + '</button>' +
          '<a class="link" href="/case.html?id=' + c.id + '" target="_blank" rel="noopener">보기</a>' +
          '<button type="button" class="link" data-act="toggle" data-id="' + c.id + '" data-v="' + c.visible + '">' + (c.visible ? '숨기기' : '보이기') + '</button>' +
          '<button type="button" class="link del" data-act="del" data-id="' + c.id + '">삭제</button></div></article>';
      }).join('');
    }
  }
  $('#caseList').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var id = +b.dataset.id, post = cases.filter(function (c) { return c.id === id; })[0];
    if (b.dataset.act === 'edit') openEditor(post);
    else if (b.dataset.act === 'toggle') api('/api/admin/cases/' + id + '/visible', { method: 'POST', json: { visible: b.dataset.v !== '1' } }).then(function () { loadCases(true); });
    else if (b.dataset.act === 'pin') api('/api/admin/cases/' + id + '/pin', { method: 'POST', json: { pinned: b.dataset.v !== '1' } }).then(function () { loadCases(true); });
    else if (b.dataset.act === 'del' && confirm('이 글과 사진을 완전히 삭제할까요? 되돌릴 수 없습니다.')) api('/api/admin/cases/' + id, { method: 'DELETE' }).then(function () { loadCases(true); });
  });

  /* ================= 메인 화면 사진 ================= */
  var hero = { items: [], sel: -1 };
  var heroAdj = adjuster($('#heroAdjust'), HERO_W, HERO_H, function () { heroThumbs(); });
  function heroLoad(slides) {
    hero.items = slides.map(function (s) { return { kind: 'old', id: s.id, img: s.img, tag: s.tag, title: s.title }; });
    hero.sel = -1; heroAdj.show(null); heroRender();
  }
  function heroThumbs() {
    $$('#heroList .srow').forEach(function (r, i) { var it = hero.items[i], c = $('canvas', r); if (c && it.kind === 'new') render(c, it, 120, 150, false); });
  }
  function heroRender() {
    var box = $('#heroList'); box.innerHTML = '';
    if (!hero.items.length) { box.innerHTML = '<p class="hint">지금은 기본 사진 5장이 나오고 있습니다. 사진을 추가하면 이 목록으로 바뀝니다.</p>'; return; }
    hero.items.forEach(function (it, i) {
      var r = el('div', 'srow' + (i === hero.sel ? ' sel' : ''));
      var th = el('div', 'sthumb');
      if (it.kind === 'new') { var c = document.createElement('canvas'); render(c, it, 120, 150, false); th.appendChild(c); }
      else th.innerHTML = '<img src="' + esc(it.img) + '" alt="">';
      th.addEventListener('click', function () { hero.sel = i; heroAdj.show(it); heroRender(); });
      var f = el('div', 'sf', '<input type="text" maxlength="30" placeholder="꼬리표 (예: 화물용 리프트)" aria-label="' + (i + 1) + '번 꼬리표"><input type="text" maxlength="60" placeholder="설명 (예: 물류창고 · 메자닌 연결)" aria-label="' + (i + 1) + '번 설명">');
      var ins = $$('input', f); ins[0].value = it.tag || ''; ins[1].value = it.title || '';
      ins[0].addEventListener('input', function () { it.tag = ins[0].value; });
      ins[1].addEventListener('input', function () { it.title = ins[1].value; });
      var a = el('div', 'sa', '<button type="button" data-d="-1" aria-label="위로">▲</button><button type="button" data-d="1" aria-label="아래로">▼</button><button type="button" class="x" aria-label="빼기">×</button>');
      $$('button[data-d]', a).forEach(function (b) {
        b.addEventListener('click', function () { var to = i + +b.dataset.d; if (to < 0 || to >= hero.items.length) return; move(hero.items, i, to); hero.sel = -1; heroAdj.show(null); heroRender(); });
      });
      $('.x', a).addEventListener('click', function () { hero.items.splice(i, 1); hero.sel = -1; heroAdj.show(null); heroRender(); });
      r.appendChild(th); r.appendChild(f); r.appendChild(a); box.appendChild(r);
    });
  }
  dropzone($('#heroDrop'), function (files) {
    loadFiles(files, false, $('#heroMsg')).then(function (items) {
      items = items.slice(0, Math.max(10 - hero.items.length, 0));
      if (!items.length) return say($('#heroMsg'), '메인 사진은 10장까지 넣을 수 있습니다.', 'err');
      var first = hero.items.length;
      hero.items = hero.items.concat(items); hero.sel = first; heroAdj.show(hero.items[first]); heroRender();
    });
  });
  $('#heroSave').addEventListener('click', function () {
    var btn = this, msg = $('#heroMsg'), fd = new FormData(), order = [], news = hero.items.filter(function (x) { return x.kind === 'new'; });
    if (!hero.items.length && !confirm('메인 사진을 모두 빼면 기본 사진 5장이 다시 나옵니다. 저장할까요?')) return;
    btn.disabled = true;
    var chain = Promise.resolve();
    hero.items.forEach(function (it) {
      fd.append('tag', (it.tag || '').trim()); fd.append('title', (it.title || '').trim());
      if (it.kind === 'old') { order.push('p:' + it.id); return; }
      var n = news.indexOf(it); order.push('n:' + n);
      chain = chain.then(function () {
        say(msg, '사진 변환 중… (' + (n + 1) + '/' + news.length + ')');
        return toBlob(it, HERO_W, HERO_H).then(function (b) { fd.append('photos', b, 's' + n); });
      });
    });
    chain.then(function () {
      fd.append('order', JSON.stringify(order)); say(msg, '저장 중…');
      return api('/api/admin/slides', { method: 'POST', body: fd });
    }).then(function (d) {
      btn.disabled = false;
      if (!d.ok) return say(msg, d.error || '저장 실패', 'err');
      heroLoad(d.slides); say(msg, '저장했습니다. 홈페이지 첫 화면에 바로 반영됩니다.', 'ok');
    }).catch(function () { btn.disabled = false; say(msg, '연결 오류로 저장하지 못했습니다.', 'err'); });
  });

  /* ================= 유튜브 ================= */
  function ytId(s) {
    s = String(s || '').trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    var m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
    return m ? m[1] : null;
  }
  function ytRender() {
    var box = $('#ytList'); box.innerHTML = '';
    if (!videos.length) box.innerHTML = '<p class="hint">등록된 영상이 없어서 지금은 채널의 최신 영상 목록이 나옵니다.</p>';
    videos.forEach(function (v, i) {
      var r = el('div', 'yrow');
      var im = el('img'); im.alt = ''; im.src = v.id ? 'https://i.ytimg.com/vi/' + v.id + '/mqdefault.jpg' : '';
      var f = el('div', 'yf', '<input type="url" placeholder="유튜브 주소 붙여넣기" aria-label="' + (i + 1) + '번 영상 주소"><input type="text" maxlength="60" placeholder="제목 (선택)" aria-label="' + (i + 1) + '번 영상 제목">');
      var ins = $$('input', f);
      ins[0].value = v.url || (v.id ? 'https://youtu.be/' + v.id : ''); ins[1].value = v.title || '';
      ins[0].addEventListener('input', function () { v.url = ins[0].value; var id = ytId(v.url); v.id = id || ''; im.src = id ? 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' : ''; });
      ins[1].addEventListener('input', function () { v.title = ins[1].value; });
      var a = el('div', 'sa', '<button type="button" data-d="-1" aria-label="위로">▲</button><button type="button" data-d="1" aria-label="아래로">▼</button><button type="button" class="x" aria-label="빼기">×</button>');
      $$('button[data-d]', a).forEach(function (b) { b.addEventListener('click', function () { var to = i + +b.dataset.d; if (to < 0 || to >= videos.length) return; move(videos, i, to); ytRender(); }); });
      $('.x', a).addEventListener('click', function () { videos.splice(i, 1); ytRender(); });
      r.appendChild(im); r.appendChild(f); r.appendChild(a); box.appendChild(r);
    });
  }
  $('#ytAdd').addEventListener('click', function () {
    if (videos.length >= 12) return say($('#ytMsg'), '영상은 12개까지 넣을 수 있습니다.', 'err');
    videos.push({ id: '', url: '', title: '' }); ytRender(); $$('#ytList input[type=url]').pop().focus();
  });
  $('#ytSave').addEventListener('click', function () {
    var list = videos.filter(function (v) { return (v.url || v.id); }).map(function (v) { return { url: v.url || v.id, title: v.title || '' }; });
    api('/api/admin/settings', { method: 'POST', json: { videos: list } }).then(function (d) {
      if (!d.ok) return say($('#ytMsg'), d.error || '저장 실패', 'err');
      videos = d.videos; ytRender(); say($('#ytMsg'), '저장했습니다. 홈페이지 동영상 칸에 반영됩니다.', 'ok');
    });
  });

  /* ================= 한눈에 보기 (방문 통계) ================= */
  var dashAt = 0;
  function loadDash() {
    if (Date.now() - dashAt < 20000) return; dashAt = Date.now();
    api('/api/admin/stats').then(function (d) {
      if (!d.ok) { $('#vChart').innerHTML = '<p class="empty">' + esc(d.error || '통계를 불러오지 못했습니다.') + '</p>'; return; }
      $('#dToday').textContent = d.today; $('#dTodayPv').textContent = '페이지 ' + d.todayPv + '회 열람';
      $('#dYest').textContent = d.yesterday; $('#dWeek').textContent = d.week; $('#dMonth').textContent = d.month;
      $('#dMobile').textContent = d.mobileShare == null ? '' : '휴대폰 ' + d.mobileShare + '% · PC ' + (100 - d.mobileShare) + '%';
      drawChart(d.days); drawSources(d.sources); drawPages(d.pages);
    });
  }
  function md(day) { return (+day.slice(5, 7)) + '/' + (+day.slice(8, 10)); }
  function niceMax(v) { if (v <= 4) return 4; var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  function drawChart(days) {
    var box = $('#vChart'), tip = $('#vTip'), max = niceMax(Math.max.apply(null, days.map(function (d) { return d.uv; })));
    var grid = [max, max / 2, 0].map(function (v) { return '<div class="gl" style="bottom:' + (v / max * 100) + '%"><span>' + v + '</span></div>'; }).join('');
    var bars = days.map(function (d, i) {
      var h = d.uv / max * 100, last = i === days.length - 1;
      return '<div class="vb" data-i="' + i + '" tabindex="0" aria-label="' + md(d.day) + ' 방문자 ' + d.uv + '명">' +
        (last && d.uv ? '<em>' + d.uv + '</em>' : '') +
        '<i style="height:' + h + '%"></i>' + (d.inq ? '<b class="inq" title="문의 ' + d.inq + '건"></b>' : '') +
        '<span class="x">' + (i % 5 === 4 || last ? md(d.day) : '') + '</span></div>';
    }).join('');
    box.innerHTML = '<div class="plot">' + grid + '<div class="bars">' + bars + '</div></div><p class="legend"><span class="sw"></span>방문자 <span class="dot"></span>문의가 들어온 날</p>';
    function show(e) {
      var b = e.target.closest('.vb'); if (!b) { tip.hidden = true; return; }
      var d = days[+b.dataset.i], r = b.getBoundingClientRect(), pr = box.parentNode.getBoundingClientRect();
      tip.innerHTML = '<b>' + d.day.replace(/-/g, '.') + '</b><span>방문자 ' + d.uv + '명</span><span>페이지 열람 ' + d.pv + '회</span>' + (d.inq ? '<span>문의 ' + d.inq + '건</span>' : '');
      tip.hidden = false;
      var x = r.left - pr.left + r.width / 2;
      tip.style.left = Math.min(Math.max(x, 70), pr.width - 70) + 'px';
      tip.style.top = (r.top - pr.top - 8) + 'px';
    }
    box.onmousemove = show; box.onfocusin = show;
    box.onmouseleave = function () { tip.hidden = true; }; box.onfocusout = function () { tip.hidden = true; };
    $('#vTable').innerHTML = '<table class="tbl"><thead><tr><th>날짜</th><th>방문자</th><th>페이지 열람</th><th>문의</th></tr></thead><tbody>' +
      days.slice().reverse().map(function (d) { return '<tr><td>' + d.day + '</td><td>' + d.uv + '</td><td>' + d.pv + '</td><td>' + d.inq + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  $('#dashTableBtn').addEventListener('click', function () {
    var t = $('#vTable'); t.hidden = !t.hidden; this.textContent = t.hidden ? '표로 보기' : '표 닫기'; this.setAttribute('aria-expanded', !t.hidden);
  });
  function drawSources(list) {
    if (!list.length) { $('#dSources').innerHTML = '<p class="empty">아직 기록이 없습니다.</p>'; return; }
    var tot = list.reduce(function (a, x) { return a + x.n; }, 0), max = list[0].n;
    $('#dSources').innerHTML = list.map(function (x) {
      return '<div class="hb"><span class="l">' + esc(x.src) + '</span><span class="tr"><i style="width:' + (x.n / max * 100) + '%"></i></span><span class="v">' + x.n + '<small> · ' + Math.round(x.n / tot * 100) + '%</small></span></div>';
    }).join('');
  }
  function drawPages(list) {
    if (!list.length) { $('#dPages').innerHTML = '<li class="empty">아직 기록이 없습니다.</li>'; return; }
    $('#dPages').innerHTML = list.map(function (x) {
      return '<li><a href="' + esc(x.path) + '" target="_blank" rel="noopener">' + esc(x.label) + '</a><span>' + x.n + '회</span></li>';
    }).join('');
  }
  function dNewGo() { openTab('inq'); filter = 'new'; $$('#filters button').forEach(function (x) { x.classList.toggle('on', x.dataset.f === 'new'); }); renderInquiries(); }
  $('#dNewBox').addEventListener('click', dNewGo);
  $('#dNewBox').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dNewGo(); } });

  /* ================= 공지사항 ================= */
  var notices = [], ntEdit = null;
  function loadNotices() {
    api('/api/admin/notices').then(function (d) { if (d.ok) { notices = d.items; ntRender(); } else $('#ntList').innerHTML = '<p class="empty">' + esc(d.error) + '</p>'; });
  }
  function ntRender() {
    if (!notices.length) { $('#ntList').innerHTML = '<p class="empty">아직 공지가 없습니다. 공지가 없으면 홈페이지에 공지사항 칸이 보이지 않습니다.</p>'; return; }
    $('#ntList').innerHTML = notices.map(function (n) {
      return '<article class="nt' + (n.visible ? '' : ' off') + '"><div class="nt-h">' + (n.pinned ? '<span class="pin">중요</span>' : '') + '<b>' + esc(n.title) + '</b>' + (n.visible ? '' : ' <small>(숨김)</small>') +
        '<time>' + esc(String(n.created_at).slice(0, 10)) + '</time></div>' + (n.body ? '<p>' + esc(n.body) + '</p>' : '') +
        '<div class="a"><button type="button" class="link" data-nt="edit" data-id="' + n.id + '">수정</button><button type="button" class="link del" data-nt="del" data-id="' + n.id + '">삭제</button></div></article>';
    }).join('');
  }
  function ntReset() { ntEdit = null; var f = $('#ntForm'); f.reset(); f.visible.checked = true; $('#ntFormTitle').textContent = '새 공지 쓰기'; $('#ntSave').textContent = '공지 올리기'; $('#ntCancel').hidden = true; }
  $('#ntList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-nt]'); if (!b) return;
    var n = notices.filter(function (x) { return x.id === +b.dataset.id; })[0]; if (!n) return;
    if (b.dataset.nt === 'edit') {
      ntEdit = n.id; var f = $('#ntForm');
      f.title.value = n.title; f.body.value = n.body || ''; f.pinned.checked = !!n.pinned; f.visible.checked = !!n.visible;
      $('#ntFormTitle').textContent = '공지 수정'; $('#ntSave').textContent = '수정 내용 저장'; $('#ntCancel').hidden = false;
      f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (confirm('"' + n.title + '" 공지를 삭제할까요?')) {
      api('/api/admin/notices/' + n.id, { method: 'DELETE' }).then(function (d) { if (d.ok) { notices = d.items; ntRender(); if (ntEdit === n.id) ntReset(); } });
    }
  });
  $('#ntCancel').addEventListener('click', ntReset);
  $('#ntForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, msg = $('#ntMsg');
    if (!f.title.value.trim()) { f.title.focus(); return say(msg, '제목을 입력해 주세요.', 'err'); }
    api('/api/admin/notices' + (ntEdit ? '/' + ntEdit : ''), { method: 'POST', json: { title: f.title.value, body: f.body.value, pinned: f.pinned.checked, visible: f.visible.checked } }).then(function (d) {
      if (!d.ok) return say(msg, d.error || '저장 실패', 'err');
      notices = d.items; ntRender(); ntReset(); say(msg, '저장했습니다. 홈페이지에는 30초 안에 반영됩니다.', 'ok');
    });
  });

  /* ================= 자주 묻는 질문 ================= */
  var faqItems = [];
  function faqRender() {
    var box = $('#faqList'); box.innerHTML = '';
    faqItems.forEach(function (x, i) {
      var r = el('div', 'frow', '<span class="no">' + (i + 1) + '</span><div class="ff"><input type="text" maxlength="200" placeholder="질문" aria-label="' + (i + 1) + '번 질문"><textarea rows="3" maxlength="2000" placeholder="답변" aria-label="' + (i + 1) + '번 답변"></textarea></div>' +
        '<div class="sa"><button type="button" data-d="-1" aria-label="위로">▲</button><button type="button" data-d="1" aria-label="아래로">▼</button><button type="button" class="x" aria-label="삭제">×</button></div>');
      var q = $('input', r), a = $('textarea', r); q.value = x.q; a.value = x.a;
      q.addEventListener('input', function () { x.q = q.value; }); a.addEventListener('input', function () { x.a = a.value; });
      $$('button[data-d]', r).forEach(function (b) { b.addEventListener('click', function () { var to = i + +b.dataset.d; if (to < 0 || to >= faqItems.length) return; move(faqItems, i, to); faqRender(); }); });
      $('.x', r).addEventListener('click', function () { if (!x.q && !x.a || confirm('이 질문을 지울까요?')) { faqItems.splice(i, 1); faqRender(); } });
      box.appendChild(r);
    });
  }
  $('#faqAdd').addEventListener('click', function () { faqItems.push({ q: '', a: '' }); faqRender(); $$('#faqList input').pop().focus(); });
  $('#faqSave').addEventListener('click', function () {
    var bad = faqItems.filter(function (x) { return !!x.q.trim() !== !!x.a.trim(); }).length;
    if (bad) return say($('#faqMsg'), '질문과 답변을 둘 다 적거나, 빈 줄은 ×로 지워주세요.', 'err');
    api('/api/admin/settings', { method: 'POST', json: { faq: faqItems } }).then(function (d) {
      if (!d.ok) return say($('#faqMsg'), d.error || '저장 실패', 'err');
      faqItems = d.faq; faqRender(); say($('#faqMsg'), '저장했습니다. 홈페이지에는 30초 안에 반영됩니다.', 'ok');
    });
  });

  /* ================= 회사 정보 ================= */
  function coFill(co) { var f = $('#coForm'); Object.keys(co).forEach(function (k) { if (f.elements[k]) f.elements[k].value = co[k] || ''; }); }
  $('#coForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, co = {};
    $$('input, textarea', f).forEach(function (i) { if (i.name) co[i.name] = i.value; });
    api('/api/admin/settings', { method: 'POST', json: { company: co } }).then(function (d) {
      if (!d.ok) return say($('#coMsg'), d.error || '저장 실패', 'err');
      coFill(d.company); say($('#coMsg'), '저장했습니다. 홈페이지에는 30초 안에 반영됩니다.', 'ok');
    });
  });

  /* ================= 사진 대량 올리기 ================= */
  // 사진 속 촬영 날짜(EXIF) 읽기 → 없으면 파일 이름(20230517_143012) → 폴더(2023/05) → 파일 수정 날짜
  function exifTime(file) {
    if (!/jpe?g$/i.test(file.name) && file.type !== 'image/jpeg') return Promise.resolve(null);
    return file.slice(0, 256 * 1024).arrayBuffer().then(function (buf) {
      var v = new DataView(buf), len = v.byteLength;
      if (len < 4 || v.getUint16(0) !== 0xFFD8) return null;
      var p = 2;
      while (p + 4 < len) {
        var mk = v.getUint16(p), sz = v.getUint16(p + 2);
        if (mk === 0xFFE1 && v.getUint32(p + 4) === 0x45786966) { // "Exif"
          var t = p + 10, le = v.getUint16(t) === 0x4949;
          var u16 = function (o) { return v.getUint16(t + o, le); }, u32 = function (o) { return v.getUint32(t + o, le); };
          var str = function (o, n) { var s = ''; for (var k = 0; k < n && t + o + k < len; k++) { var c = v.getUint8(t + o + k); if (!c) break; s += String.fromCharCode(c); } return s; };
          var readIfd = function (off) {
            var out = {}; if (t + off + 2 > len) return out;
            var n = u16(off);
            for (var k = 0; k < n; k++) {
              var e = off + 2 + k * 12; if (t + e + 12 > len) break;
              var tag = u16(e);
              if (tag === 0x8769) out.exif = u32(e + 8);
              if (tag === 0x9003 || tag === 0x0132) out[tag] = str(u32(e + 8), 19);
            }
            return out;
          };
          var i0 = readIfd(u32(4)), d = i0[0x0132];
          if (i0.exif) { var ie = readIfd(i0.exif); if (ie[0x9003]) d = ie[0x9003]; }
          var m = d && /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(d);
          return m && +m[1] > 1990 ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
        }
        if ((mk & 0xFF00) !== 0xFF00 || mk === 0xFFDA) break;
        p += 2 + sz;
      }
      return null;
    }).catch(function () { return null; });
  }
  function guessTime(f) {
    var m = /(20\d\d)[-_.]?(0[1-9]|1[0-2])[-_.]?([0-3]\d)[ _-]?([0-2]\d)[-_.:]?([0-5]\d)[-_.:]?([0-5]\d)/.exec(f.name);
    if (m) return { t: new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(), how: 'name' };
    var path = f.webkitRelativePath || '';
    var y = /(?:^|\/)(20\d\d)(?:년)?[\/_ .-]?(0?[1-9]|1[0-2])(?:월)?(?:\/|$)/.exec(path) || /(?:^|\/)(20\d\d)(?:년)?\/(?:[^\/]*?)(0?[1-9]|1[0-2])월?(?:\/|$)/.exec(path);
    var lm = f.lastModified || Date.now();
    if (y) {
      var d = new Date(lm);
      if (d.getFullYear() === +y[1] && d.getMonth() + 1 === +y[2]) return { t: lm, how: 'file' };
      return { t: new Date(+y[1], +y[2] - 1, 15, 12).getTime(), how: 'folder' };
    }
    return { t: lm, how: 'file' };
  }
  function sig(f) { return f.name + '|' + f.size + '|' + f.lastModified; }
  function doneSet() { try { return JSON.parse(localStorage.getItem('gs_bulk_done') || '[]'); } catch (e) { return []; } }
  function markDone(key) { try { var a = doneSet(); a.push(key); localStorage.setItem('gs_bulk_done', JSON.stringify(a.slice(-5000))); } catch (e) {} }
  var bulk = { groups: [], busy: false };
  // 대표 사진을 바꿔도 같은 현장으로 알아보도록 순서와 무관하게 만듦
  function gKey(g) { var ph = g.photos.filter(function (p) { return !p.off; }).map(function (p) { return sig(p.file); }).sort(); return ph.length ? ph[0] + '#' + ph.length : ''; }
  function ymd(t) { var d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  function bulkRead(files, auto) {
    if (bulk.busy) return;
    var list = Array.prototype.filter.call(files, function (f) { return /\.(jpe?g|png|webp)$/i.test(f.name) || /^image\/(jpeg|png|webp)$/.test(f.type); });
    var heic = Array.prototype.filter.call(files, function (f) { return /\.hei[cf]$/i.test(f.name); }).length;
    var msg = $('#bulkMsg');
    if (!list.length) return say(msg, heic ? '아이폰 HEIC 사진은 읽을 수 없습니다. JPG로 바꿔서 올려주세요.' : '사진 파일(JPG·PNG·WEBP)을 찾지 못했습니다.', 'err');
    say(msg, list.length + '장의 촬영 날짜를 읽는 중…');
    var out = [], i = 0;
    (function next() {
      var chunk = list.slice(i, i + 40); i += 40;
      if (!chunk.length) return grouped();
      Promise.all(chunk.map(function (f) {
        return exifTime(f).then(function (t) { var g = t ? { t: t, how: 'exif' } : guessTime(f); out.push({ file: f, t: g.t, how: g.how, off: false }); });
      })).then(function () { say(msg, Math.min(i, list.length) + ' / ' + list.length + '장 읽음…'); setTimeout(next, 0); });
    })();
    function grouped() {
      out.sort(function (a, b) { return a.t - b.t || a.file.name.localeCompare(b.file.name); });
      // 폴더 구조: "9월/풀무원 나또공장/사진.jpg" → 폴더 "9월/풀무원 나또공장"
      var dirOf = function (p) { var r = p.file.webkitRelativePath || ''; var i = r.lastIndexOf('/'); return i > 0 ? r.slice(0, i) : ''; };
      var dirs = {}; out.forEach(function (p) { dirs[dirOf(p)] = 1; });
      var dirList = Object.keys(dirs);
      // 처음 폴더를 골랐을 때 안에 하위 폴더가 있으면 자동으로 "폴더별" 묶기
      if (auto && dirList.length > 1) $('#bulkGap').value = 'folder';
      var mode = $('#bulkGap').value, groups = [];
      var byTime = function (list) {
        var gap = +mode || 4, cur = null, res = [];
        list.forEach(function (p) {
          var newG = !cur || cur.photos.length >= 20 || (gap === 12 ? ymd(p.t) !== ymd(cur.last) : p.t - cur.last > gap * 3600e3);
          if (newG) { cur = { photos: [], cat: '', site: '', spec: '', last: p.t }; res.push(cur); }
          cur.photos.push(p); cur.last = p.t;
        });
        return res;
      };
      if (mode === 'folder' && dirList.length > 1) {
        var depth = function (d) { return d ? d.split('/').length : 0; };
        var minDepth = Math.min.apply(null, dirList.map(depth));
        var buckets = {};
        out.forEach(function (p) { var d = dirOf(p); (buckets[d] = buckets[d] || []).push(p); });
        // 먼저 찍은 폴더부터
        Object.keys(buckets).sort(function (a, b) { return buckets[a][0].t - buckets[b][0].t; }).forEach(function (d) {
          var list = buckets[d];
          if (depth(d) === minDepth) { groups = groups.concat(byTime(list)); return; } // 하위 폴더 없이 바로 들어있는 사진
          var name = d.split('/').pop().replace(/[_]+/g, ' ').trim();
          for (var i = 0; i < list.length; i += 20) {
            var chunk = list.slice(i, i + 20);
            groups.push({ photos: chunk, cat: '', site: '', note: d + (list.length > 20 ? ' (' + (i / 20 + 1) + ')' : ''), spec: '', folder: d, last: chunk[chunk.length - 1].t });
          }
        });
      } else {
        groups = byTime(out);
      }
      var done = doneSet();
      groups.forEach(function (g) { g.done = done.indexOf(gKey(g)) >= 0; });
      bulk.groups = groups;
      var undated = out.filter(function (p) { return p.how === 'file'; }).length;
      var byFolder = groups.filter(function (g) { return g.folder; }).length;
      say(msg, out.length + '장을 ' + groups.length + '개 현장으로 묶었습니다.' + (byFolder ? ' 하위 폴더 ' + byFolder + '개는 폴더 이름을 현장명으로 넣었습니다.' : '') + (undated ? ' (' + undated + '장은 사진 속 촬영 날짜가 없어 파일 날짜로 정렬했습니다)' : '') + (heic ? ' HEIC ' + heic + '장은 제외했습니다.' : ''), 'ok');
      bulkRender();
    }
  }
  function bulkSummary() {
    var live = bulk.groups.filter(function (g) { return !g.done && g.photos.some(function (p) { return !p.off; }); });
    var n = live.reduce(function (a, g) { return a + g.photos.filter(function (p) { return !p.off; }).length; }, 0);
    var miss = live.filter(function (g) { return !g.cat; }).length;
    $('#bulkSum').textContent = '올릴 현장 ' + live.length + '개 · 사진 ' + n + '장' + (miss ? ' · 분류 안 고른 현장 ' + miss + '개' : '');
    $('#bulkTools').hidden = !bulk.groups.length;
  }
  var thumbIO = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { var im = e.target; if (!im.src) im.src = URL.createObjectURL(im._file); thumbIO.unobserve(im); } });
  }, { rootMargin: '300px' }) : null;
  function bulkRender() {
    var box = $('#bulkGroups'); box.innerHTML = '';
    bulk.groups.forEach(function (g, gi) {
      var live = g.photos.filter(function (p) { return !p.off; });
      var d0 = g.photos[0] ? new Date(g.photos[0].t) : null;
      var c = el('div', 'bg' + (g.done ? ' done' : '') + (!g.cat && !g.done ? ' need' : ''));
      c.innerHTML = '<div class="bg-h"><b>현장 ' + (gi + 1) + '</b>' + (g.folder ? '<span class="fd" title="' + esc(g.folder) + '">📁 ' + esc(g.folder.split('/').pop()) + '</span>' : '') + '<span class="d">' + (d0 ? d0.getFullYear() + '.' + (d0.getMonth() + 1) + '.' + d0.getDate() : '') + ' · 사진 ' + live.length + '장</span>' +
        (g.done ? '<span class="ok">✓ 올림</span>' : '') +
        '<span class="seg cat">' + Object.keys(CATS).map(function (k) { return '<button type="button" data-cat="' + k + '"' + (g.cat === k ? ' class="on"' : '') + '>' + CATS[k].replace(/\(.*\)/, '') + '</button>'; }).join('') + '</span>' +
        '<span class="acts">' + (gi ? '<button type="button" class="link" data-g="merge">위 현장과 합치기</button>' : '') + '<button type="button" class="link del" data-g="drop">이 현장 빼기</button></span></div>' +
        '<div class="bg-f"><input type="text" maxlength="80" placeholder="현장 표기 (홈페이지에 보임 · 예: 경기 김포 · 물류센터)" data-f="site"><input type="text" maxlength="300" placeholder="🔒 내부 메모 (업체명·폴더명)" data-f="note"><input type="text" maxlength="80" placeholder="사양 (예: 2톤 · 3STOP · 양방향)" data-f="spec"><input type="month" data-f="date" aria-label="설치 날짜"></div>' +
        '<div class="bg-p"></div>';
      $('[data-f=site]', c).value = g.site; $('[data-f=note]', c).value = g.note || ''; $('[data-f=spec]', c).value = g.spec;
      g.date = g.date || (d0 ? ymd(g.photos[0].t).slice(0, 7) : '');
      $('[data-f=date]', c).value = g.date;
      $$('.bg-f input', c).forEach(function (i) { i.addEventListener('input', function () { g[i.dataset.f] = i.value; }); });
      $$('.seg.cat button', c).forEach(function (b) { b.addEventListener('click', function () { g.cat = b.dataset.cat; $$('.seg.cat button', c).forEach(function (x) { x.classList.toggle('on', x === b); }); c.classList.remove('need'); bulkSummary(); }); });
      var pBox = $('.bg-p', c);
      g.photos.forEach(function (p, pi) {
        var t = el('div', 'bp' + (p.off ? ' off' : ''));
        var im = document.createElement('img'); im.alt = p.file.name; im._file = p.file; im.title = p.file.name + ' · ' + new Date(p.t).toLocaleString('ko-KR');
        if (thumbIO) thumbIO.observe(im); else im.src = URL.createObjectURL(p.file);
        t.appendChild(im);
        var tg = el('button', 'tg', p.off ? '되살리기' : '빼기'); tg.type = 'button';
        tg.addEventListener('click', function () { p.off = !p.off; bulkRender(); });
        t.appendChild(tg);
        if (pi === 0) t.appendChild(el('span', 'cv', '대표 사진'));
        else { var cv = el('button', 'mkcv', '★ 대표로'); cv.type = 'button'; cv.title = '이 사진을 대표 사진(첫 번째)으로'; cv.addEventListener('click', function () { g.photos.splice(pi, 1); g.photos.unshift(p); p.off = false; bulkRender(); }); t.appendChild(cv); }
        if (pi) { var sp = el('button', 'sp', '✂ 여기서 나누기'); sp.type = 'button'; sp.addEventListener('click', function () { var rest = g.photos.splice(pi); bulk.groups.splice(gi + 1, 0, { photos: rest, cat: g.cat, site: '', spec: '', open: false }); bulkRender(); }); t.appendChild(sp); }
        pBox.appendChild(t);
      });
      $$('[data-g]', c).forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.dataset.g === 'drop') { if (confirm('현장 ' + (gi + 1) + '(사진 ' + g.photos.length + '장)을 이번에 올리지 않을까요?')) { bulk.groups.splice(gi, 1); bulkRender(); } return; }
          var up = bulk.groups[gi - 1];
          if (up.photos.length + g.photos.length > 20) return alert('한 글에는 사진을 20장까지 넣을 수 있습니다. 필요 없는 사진을 먼저 빼주세요.');
          up.photos = up.photos.concat(g.photos); up.cat = up.cat || g.cat; bulk.groups.splice(gi, 1); bulkRender();
        });
      });
      box.appendChild(c);
    });
    bulkSummary();
  }
  $('#bulkDir').addEventListener('change', function () { bulkRead(this.files, true); this.value = ''; });
  $('#bulkFiles').addEventListener('change', function () { bulkRead(this.files, false); this.value = ''; });
  $('#bulkGap').addEventListener('change', function () {
    if (!bulk.groups.length || bulk.busy) return;
    var all = []; bulk.groups.forEach(function (g) { all = all.concat(g.photos); });
    var files = all.map(function (p) { return p.file; }); bulkRead(files);
  });
  $$('#bulkAllCat button').forEach(function (b) {
    b.addEventListener('click', function () { bulk.groups.forEach(function (g) { if (!g.done) g.cat = b.dataset.cat; }); bulkRender(); });
  });
  $('#bulkGo').addEventListener('click', function () {
    if (bulk.busy) return;
    var todo = bulk.groups.filter(function (g) { return !g.done && g.photos.some(function (p) { return !p.off; }); });
    if (!todo.length) return say($('#bulkMsg'), '올릴 현장이 없습니다.', 'err');
    var miss = todo.filter(function (g) { return !g.cat; });
    if (miss.length) { var i = bulk.groups.indexOf(miss[0]); $$('#bulkGroups .bg')[i].scrollIntoView({ behavior: 'smooth', block: 'center' }); return say($('#bulkMsg'), '분류를 고르지 않은 현장이 ' + miss.length + '개 있습니다. (위의 "모든 묶음 분류 한 번에"로 한꺼번에 고를 수도 있습니다)', 'err'); }
    var bad = todo.filter(function (g) { return g.date && !/^\d{4}-\d{2}$/.test(g.date); });
    if (bad.length) return say($('#bulkMsg'), '설치 날짜는 2023-05 처럼 적어주세요.', 'err');
    if (!confirm(todo.length + '개 현장을 올립니다. 끝날 때까지 이 창을 닫지 마세요.')) return;
    bulk.busy = true; $('#bulkGo').disabled = true;
    var hidden = $('#bulkHidden').checked, k = 0, msg = $('#bulkMsg');
    window.onbeforeunload = function () { return '올리는 중입니다.'; };
    function finish(text, kind) {
      bulk.busy = false; $('#bulkGo').disabled = false; window.onbeforeunload = null;
      say(msg, text, kind); bulkRender(); loaded.cases = 0;
    }
    var nextGroup = function () {
      if (k >= todo.length) return finish(todo.length + '개 현장을 모두 올렸습니다. "설치사례" 탭에서 확인하세요.' + (hidden ? ' 숨김 상태이므로 확인 후 "보이기"를 눌러주세요.' : ''), 'ok');
      var g = todo[k], ph = g.photos.filter(function (p) { return !p.off; }), fd = new FormData(), order = [], j = 0;
      var key = gKey(g);
      (function nextPhoto() {
        if (j >= ph.length) {
          fd.append('title', [CATS[g.cat]].concat(splitTitle(g.spec)).join(' · '));
          fd.append('category', g.cat); fd.append('site', (g.site || '').trim()); fd.append('note', (g.note || '').trim()); fd.append('body', '');
          fd.append('date', g.date || ''); fd.append('order', JSON.stringify(order));
          if (hidden) fd.append('visible', '0');
          say(msg, '현장 ' + (k + 1) + ' / ' + todo.length + ' 올리는 중…');
          return api('/api/admin/cases', { method: 'POST', body: fd }).then(function (d) {
            if (!d.ok) return finish('현장 ' + (bulk.groups.indexOf(g) + 1) + '에서 멈췄습니다: ' + (d.error || '저장 실패') + ' (다시 "모두 올리기"를 누르면 이어서 올립니다)', 'err');
            g.done = true; markDone(key); k++;
            var card = $$('#bulkGroups .bg')[bulk.groups.indexOf(g)]; if (card) { card.classList.add('done'); }
            nextGroup();
          }, function () { finish('연결이 끊겼습니다. 다시 "모두 올리기"를 누르면 이어서 올립니다.', 'err'); });
        }
        say(msg, '현장 ' + (k + 1) + ' / ' + todo.length + ' · 사진 변환 ' + (j + 1) + ' / ' + ph.length);
        var p = ph[j];
        decode(p.file).then(function (bm) {
          var it = newItem(bm, true);
          return toBlob(it, CASE_W, CASE_H).then(function (b) {
            if (bm.close) bm.close();
            fd.append('photos', b, 'p' + j + (b.type === 'image/webp' ? '.webp' : '.jpg')); order.push('n:' + order.length);
          });
        }, function () { /* 읽을 수 없는 사진은 건너뜀 */ }).then(function () { j++; setTimeout(nextPhoto, 0); });
      })();
    };
    wmReady.then(nextGroup);
  });

  /* ================= 시작 ================= */
  api('/api/admin/me').then(function (d) { if (d.ok) showApp(); else showLogin(); }).catch(showLogin);
})();
