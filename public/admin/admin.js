/* 거산리프트 관리자 화면 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var OUT_W = 1200, OUT_H = 1600; // 설치사례 사진 크기 (세로 3:4)
  var WM_RATIO = 0.30, WM_ALPHA = 0.38; // 중앙 워터마크 크기·진하기
  var STATUS = { 'new': '신규', progress: '처리중', done: '완료' };

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

  /* ---------- 로그인 ---------- */
  function showLogin() {
    $('#appView').hidden = true; $('#logoutBtn').hidden = true; $('#loginView').hidden = false;
    $('#loginForm').password.focus();
  }
  function showApp() {
    $('#loginView').hidden = true; $('#appView').hidden = false; $('#logoutBtn').hidden = false;
    loadInquiries(); loadCases();
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

  /* ---------- 탭 ---------- */
  $$('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.tabs button').forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
      $('#tab-inq').hidden = b.dataset.tab !== 'inq';
      $('#tab-cases').hidden = b.dataset.tab !== 'cases';
    });
  });

  /* ---------- 문의 ---------- */
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

  /* ---------- 사진 처리 (브라우저 안에서) ---------- */
  var bitmap = null, watermark = null;
  function loadWatermark() {
    if (watermark) return Promise.resolve(watermark);
    return new Promise(function (ok, no) {
      var im = new Image(); im.onload = function () { watermark = im; ok(im); }; im.onerror = no;
      im.src = '/assets/img/emblem-white.webp';
    });
  }
  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return decodeImg(file); });
    }
    return decodeImg(file);
  }
  function decodeImg(file) {
    return new Promise(function (ok, no) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); ok(im); };
      im.onerror = function () { URL.revokeObjectURL(url); no(new Error('decode')); };
      im.src = url;
    });
  }
  // 세로 3:4로 자르고, 크기 맞추고, 가운데 워터마크
  function render(canvas, W, H) {
    var ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;
    var sw = bitmap.width, sh = bitmap.height, target = W / H, f = +$('#focusY').value / 100;
    var cw, ch, cx, cy;
    if (sw / sh > target) { ch = sh; cw = sh * target; cy = 0; cx = (sw - cw) * f; }
    else { cw = sw; ch = sw / target; cx = 0; cy = (sh - ch) * f; }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, cx, cy, cw, ch, 0, 0, W, H);
    if (watermark) {
      var ww = W * WM_RATIO, wh = ww * watermark.naturalHeight / watermark.naturalWidth;
      ctx.globalAlpha = WM_ALPHA;
      ctx.drawImage(watermark, (W - ww) / 2, (H - wh) / 2, ww, wh);
      ctx.globalAlpha = 1;
    }
  }
  function toBlob(canvas) {
    return new Promise(function (ok) {
      canvas.toBlob(function (b) {
        if (b && b.type === 'image/webp') return ok(b);
        canvas.toBlob(ok, 'image/jpeg', 0.85); // WebP를 못 만드는 브라우저(일부 아이폰)는 JPG로
      }, 'image/webp', 0.82);
    });
  }
  function drawPreview() { if (bitmap) render($('#preview'), 600, 800); }

  $('#fileInput').addEventListener('change', function (e) {
    var file = e.target.files[0], msg = $('#caseMsg');
    if (!file) return;
    say(msg, '사진을 읽는 중…');
    Promise.all([decode(file), loadWatermark().catch(function () { return null; })]).then(function (r) {
      bitmap = r[0];
      var landscape = bitmap.width / bitmap.height > 3 / 4;
      $('.slider').firstChild.textContent = landscape ? '사진 위치 조정 (왼쪽 ↔ 오른쪽)' : '사진 위치 조정 (위 ↔ 아래)';
      $('#focusY').value = 50;
      $('#previewBox').hidden = false;
      $('#pickText').textContent = '다른 사진으로 바꾸기';
      drawPreview(); say(msg, '');
    }).catch(function () {
      bitmap = null; $('#previewBox').hidden = true;
      say(msg, '이 사진 형식을 읽을 수 없습니다. 사진 앱에서 JPG로 저장한 뒤 다시 골라주세요.', 'err');
    });
  });
  $('#focusY').addEventListener('input', drawPreview);

  $('#caseForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, msg = $('#caseMsg'), btn = $('#caseBtn');
    if (!bitmap) return say(msg, '사진을 먼저 골라주세요.', 'err');
    if (!f.title.value.trim()) { f.title.focus(); return say(msg, '현장명을 입력해 주세요.', 'err'); }
    btn.disabled = true; say(msg, '사진 변환 중…');
    var out = document.createElement('canvas');
    render(out, OUT_W, OUT_H);
    toBlob(out).then(function (blob) {
      say(msg, '올리는 중… (' + Math.round(blob.size / 1024) + 'KB)');
      var fd = new FormData();
      fd.append('title', f.title.value.trim());
      fd.append('sub', f.sub.value.trim());
      fd.append('photo', blob, blob.type === 'image/webp' ? 'photo.webp' : 'photo.jpg');
      return api('/api/admin/cases', { method: 'POST', body: fd });
    }).then(function (d) {
      btn.disabled = false;
      if (!d.ok) return say(msg, d.error || '올리기 실패', 'err');
      f.reset(); bitmap = null; $('#previewBox').hidden = true; $('#pickText').textContent = '사진 선택 (눌러서 고르기)';
      say(msg, '홈페이지에 올렸습니다. 설치사례 맨 앞에서 확인할 수 있습니다.', 'ok');
      loadCases();
    }).catch(function () { btn.disabled = false; say(msg, '연결 오류로 올리지 못했습니다.', 'err'); });
  });

  /* ---------- 올린 사례 목록 ---------- */
  function loadCases() {
    api('/api/admin/cases').then(function (d) {
      if (!d.ok) { $('#caseList').innerHTML = '<p class="empty">' + esc(d.error) + '</p>'; return; }
      if (!d.items.length) { $('#caseList').innerHTML = '<p class="empty">아직 올린 사진이 없습니다.</p>'; return; }
      $('#caseList').innerHTML = d.items.map(function (c) {
        return '<div class="case' + (c.visible ? '' : ' hidden') + '"><img src="' + esc(c.img) + '" alt="' + esc(c.title) + '" loading="lazy">' +
          '<div class="t">' + esc(c.title) + (c.visible ? '' : ' (숨김)') + '</div><div class="s">' + esc(c.sub) + '</div>' +
          '<div class="a"><button type="button" class="link" data-act="toggle" data-id="' + c.id + '" data-v="' + c.visible + '">' + (c.visible ? '숨기기' : '다시 보이기') + '</button>' +
          '<button type="button" class="link del" data-act="del" data-id="' + c.id + '">삭제</button></div></div>';
      }).join('');
    });
  }
  $('#caseList').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var id = b.dataset.id;
    if (b.dataset.act === 'toggle') {
      api('/api/admin/cases/' + id, { method: 'POST', json: { visible: b.dataset.v !== '1' } }).then(loadCases);
    } else if (b.dataset.act === 'del' && confirm('이 사진을 완전히 삭제할까요? 되돌릴 수 없습니다.')) {
      api('/api/admin/cases/' + id, { method: 'DELETE' }).then(loadCases);
    }
  });

  /* ---------- 시작 ---------- */
  api('/api/admin/me').then(function (d) { if (d.ok) showApp(); else showLogin(); }).catch(showLogin);
})();
