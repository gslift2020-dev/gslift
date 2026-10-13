/* 거산리프트 관리자 화면 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var CASE_W = 1200, CASE_H = 1600;   // 설치사례 사진 (세로 3:4)
  var HERO_W = 1200, HERO_H = 1500;   // 메인 슬라이드 (세로 4:5)
  var WM_RATIO = 0.30, WM_ALPHA = 0.38;
  var STATUS = { 'new': '신규', progress: '처리중', done: '완료' };

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
    loadInquiries(); loadSettings();
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
    b.addEventListener('click', function () {
      $$('.tabs button').forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
      ['inq', 'cases', 'hero', 'yt'].forEach(function (t) { $('#tab-' + t).hidden = b.dataset.tab !== t; });
      if (b.dataset.tab === 'cases' && !loaded.cases) { loaded.cases = 1; loadCases(); }
    });
  });

  /* ================= 문의 ================= */
  var inquiries = [], filter = 'all';
  function loadInquiries() {
    $('#inqList').innerHTML = '<p class="empty">불러오는 중…</p>';
    api('/api/admin/inquiries').then(function (d) {
      if (!d.ok) { $('#inqList').innerHTML = '<p class="empty">' + esc(d.error) + '</p>'; return; }
      inquiries = d.items; renderInquiries();
    });
  }
  function renderInquiries() {
    var n = inquiries.filter(function (x) { return x.status === 'new'; }).length;
    $('#newCount').hidden = !n; $('#newCount').textContent = n;
    var rows = inquiries.filter(function (x) { return filter === 'all' || x.status === filter; });
    if (!rows.length) { $('#inqList').innerHTML = '<p class="empty">해당하는 문의가 없습니다.</p>'; return; }
    $('#inqList').innerHTML = rows.map(function (x) {
      var opts = Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (k === x.status ? ' selected' : '') + '>' + STATUS[k] + '</option>'; }).join('');
      return '<article class="inq ' + esc(x.status) + '">' +
        '<div><div class="who">#' + x.id + ' ' + esc(x.company || '(회사명 없음)') + ' · ' + esc(x.name) + '</div>' +
        '<div class="meta">' + esc(x.created_at) + ' · ' + esc(x.product || '-') + '</div></div>' +
        '<span class="st st-' + esc(x.status) + '">' + STATUS[x.status] + '</span>' +
        '<div class="body">' + esc(x.message) + '</div>' +
        '<div class="acts"><a class="tel" href="tel:' + esc(x.phone) + '">' + esc(x.phone) + ' 전화</a>' +
        '<label style="flex-direction:row;align-items:center;gap:6px;font-weight:500">상태 <select data-id="' + x.id + '" aria-label="처리 상태">' + opts + '</select></label>' +
        (x.email_sent ? '' : '<span class="warn">알림 메일 미발송' + (x.email_error ? ': ' + esc(x.email_error) : '') + '</span>') +
        '</div></article>';
    }).join('');
  }
  $('#inqList').addEventListener('change', function (e) {
    var sel = e.target; if (!sel.dataset.id) return;
    var id = +sel.dataset.id;
    api('/api/admin/inquiries/' + id, { method: 'POST', json: { status: sel.value } }).then(function (d) {
      if (!d.ok) return alert(d.error || '저장 실패');
      inquiries.forEach(function (x) { if (x.id === id) x.status = sel.value; });
      renderInquiries();
    });
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
      chips = d.chips; videos = d.videos;
      renderChips(); heroLoad(d.slides); ytRender();
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
    editing = { id: post ? post.id : null, items: [], sel: -1, chipSel: {} };
    var f = $('#caseForm');
    f.hidden = false; f.reset(); say($('#caseMsg'), '');
    $('#caseFormTitle').textContent = post ? '설치사례 수정' : '새 설치사례';
    $('#caseSave').textContent = post ? '수정 내용 저장' : '홈페이지에 올리기';
    if (post) {
      editing.items = post.photos.map(function (p) { return { kind: 'old', id: p.id, img: p.img }; });
      f.title.value = post.title; f.site.value = post.site || ''; f.body.value = post.body || '';
      // 제목에 들어있는 사양을 버튼에 표시
      var parts = post.title.split('·').map(function (s) { return s.trim(); });
      chips.forEach(function (g) { g.items.forEach(function (v) { if (parts.indexOf(v) >= 0) editing.chipSel[g.name] = v; }); });
    }
    renderChips(); renderThumbs(); caseAdj.show(null);
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
  function buildTitle() {
    var sel = editing.chipSel, parts = [];
    chips.forEach(function (g) { if (sel[g.name]) parts.push(sel[g.name]); });
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
    btn.disabled = true;
    var fd = new FormData(), order = [], news = editing.items.filter(function (x) { return x.kind === 'new'; }), done = 0;
    fd.append('title', f.title.value.trim()); fd.append('site', f.site.value.trim()); fd.append('body', f.body.value.trim());
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
      closeEditor(); loadCases();
      say($('#caseMsg'), '');
      flash('저장했습니다. 홈페이지 설치사례 맨 앞에서 확인할 수 있습니다.');
    }).catch(function () { btn.disabled = false; say(msg, '연결 오류로 저장하지 못했습니다.', 'err'); });
  });
  function flash(text) {
    var m = el('p', 'msg ok', esc(text)); m.style.margin = '12px 0 0';
    $('#caseList').before(m); setTimeout(function () { m.remove(); }, 5000);
  }

  /* ---- 글 목록 ---- */
  function loadCases() {
    api('/api/admin/cases').then(function (d) {
      if (!d.ok) { $('#caseList').innerHTML = '<p class="empty">' + esc(d.error) + '</p>'; return; }
      cases = d.items;
      if (!cases.length) { $('#caseList').innerHTML = '<p class="empty">아직 올린 글이 없습니다. "새 글 쓰기"를 눌러 시작하세요.</p>'; return; }
      $('#caseList').innerHTML = cases.map(function (c) {
        var cover = c.photos[0] ? c.photos[0].img : '';
        return '<article class="post' + (c.visible ? '' : ' hidden') + '"><div class="ph"><img src="' + esc(cover) + '" alt="" loading="lazy"><span class="cnt">사진 ' + c.photos.length + '장</span></div>' +
          '<div class="t">' + esc(c.title) + (c.visible ? '' : ' (숨김)') + '</div><div class="s">' + esc(c.site) + ' · ' + esc((c.updated_at || c.created_at || '').slice(0, 10)) + '</div>' +
          '<div class="a"><button type="button" class="link" data-act="edit" data-id="' + c.id + '">수정</button>' +
          '<button type="button" class="link" data-act="toggle" data-id="' + c.id + '" data-v="' + c.visible + '">' + (c.visible ? '숨기기' : '보이기') + '</button>' +
          '<button type="button" class="link del" data-act="del" data-id="' + c.id + '">삭제</button></div></article>';
      }).join('');
    });
  }
  $('#caseList').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var id = +b.dataset.id, post = cases.filter(function (c) { return c.id === id; })[0];
    if (b.dataset.act === 'edit') openEditor(post);
    else if (b.dataset.act === 'toggle') api('/api/admin/cases/' + id + '/visible', { method: 'POST', json: { visible: b.dataset.v !== '1' } }).then(loadCases);
    else if (b.dataset.act === 'del' && confirm('이 글과 사진을 완전히 삭제할까요? 되돌릴 수 없습니다.')) api('/api/admin/cases/' + id, { method: 'DELETE' }).then(loadCases);
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

  /* ================= 시작 ================= */
  api('/api/admin/me').then(function (d) { if (d.ok) showApp(); else showLogin(); }).catch(showLogin);
})();
