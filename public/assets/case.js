/* 설치사례 상세 페이지 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var CATS = window.GS_CATS || {};
  var params = new URLSearchParams(location.search);
  var id = params.get('id'), sid = params.get('s');
  var TEL = window.GS_TEL || '031-986-5345';
  try {
    var hitData = JSON.stringify({ p: location.pathname + location.search, r: document.referrer });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/hit', new Blob([hitData], { type: 'text/plain' }));
  } catch (e) {}
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ARROW_L = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  var ARROW_R = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  /* 메뉴·맨 위로 */
  var nav = $('#nav'), menuBtn = $('#menuBtn');
  menuBtn.addEventListener('click', function () { var o = nav.classList.toggle('open'); menuBtn.setAttribute('aria-expanded', o); });
  var toTop = $('#toTop');
  window.addEventListener('scroll', function () { toTop.classList.toggle('show', window.scrollY > 600); }, { passive: true });
  toTop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); });

  /* 제목 "화물용 리프트(F/L) · 2톤 · 2STOP · 양방향" 을 항목별로 */
  function specOf(title) {
    var rows = [];
    String(title).split('·').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (p) {
      var label = '사양';
      if (/리프트|스태커|운반/.test(p)) label = '제품';
      else if (/톤|kg/i.test(p)) label = '적재하중';
      else if (/STOP|층/i.test(p)) label = '정지층';
      else if (/방향/.test(p)) label = '출입방향';
      else if (/실내|외부|실외/.test(p)) label = '설치위치';
      else if (/유압|체인|와이어|전동/.test(p)) label = '구동 방식';
      else if (/도어|셔터|문/.test(p)) label = '출입문';
      rows.push({ label: label, value: p });
    });
    return rows;
  }

  function render(c) {
    document.title = c.title + ' | 거산리프트 설치사례';
    $('#crumbCat').textContent = CATS[c.cat] || '설치사례';
    $('#crumbList').href = '/cases.html?cat=' + c.cat;
    var box = $('#cdBody'); box.innerHTML = '';

    /* 사진 */
    var gal = el('div', 'gal'), main = el('div', 'gal-main'), img = el('img');
    img.alt = c.title; main.appendChild(img);
    var thumbs = el('div', 'gal-thumbs'), idx = 0, count = el('span', 'gal-count');
    function show(n) {
      idx = (n + c.photos.length) % c.photos.length;
      img.src = c.photos[idx]; img.alt = c.title + (c.photos.length > 1 ? ' (' + (idx + 1) + '/' + c.photos.length + ')' : '');
      count.textContent = (idx + 1) + ' / ' + c.photos.length;
      Array.prototype.forEach.call(thumbs.children, function (t, k) { t.classList.toggle('on', k === idx); });
    }
    if (c.photos.length > 1) {
      var pv = el('button', 'gal-nav prev'); pv.type = 'button'; pv.innerHTML = ARROW_L; pv.setAttribute('aria-label', '이전 사진');
      var nx = el('button', 'gal-nav next'); nx.type = 'button'; nx.innerHTML = ARROW_R; nx.setAttribute('aria-label', '다음 사진');
      pv.addEventListener('click', function () { show(idx - 1); });
      nx.addEventListener('click', function () { show(idx + 1); });
      main.appendChild(pv); main.appendChild(nx); main.appendChild(count);
      c.photos.forEach(function (src, k) {
        var b = el('button'); b.type = 'button'; b.setAttribute('aria-label', (k + 1) + '번째 사진');
        var t = el('img'); t.src = src; t.alt = ''; t.loading = 'lazy'; b.appendChild(t);
        b.addEventListener('click', function () { show(k); });
        thumbs.appendChild(b);
      });
      // 손가락으로 밀어서 넘기기
      var sx = null;
      main.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
      main.addEventListener('touchend', function (e) { if (sx == null) return; var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) show(idx + (dx < 0 ? 1 : -1)); sx = null; });
      document.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') show(idx - 1); if (e.key === 'ArrowRight') show(idx + 1); });
    }
    gal.appendChild(main); if (c.photos.length > 1) gal.appendChild(thumbs);
    show(0);

    /* 설명 */
    var info = el('div', 'cd-info');
    info.appendChild(el('span', 'cd-cat', CATS[c.cat] || '설치사례'));
    info.appendChild(el('h1', null, c.title));
    var meta = el('div', 'cd-site');
    if (c.site) meta.appendChild(el('span', null, '현장: ' + c.site));
    if (c.date) meta.appendChild(el('span', null, '설치: ' + c.date));
    meta.appendChild(el('span', null, '사진 ' + c.photos.length + '장'));
    info.appendChild(meta);
    var spec = specOf(c.title);
    if (spec.length > 1) {
      var sg = el('div', 'spec');
      spec.forEach(function (r) { var d = el('div'); d.appendChild(el('small', null, r.label)); d.appendChild(el('b', null, r.value)); sg.appendChild(d); });
      info.appendChild(sg);
    }
    if (c.body) info.appendChild(el('p', 'cd-text', c.body));
    // 꼬리표: 누르면 같은 조건의 다른 사례 목록으로
    if (c.tagList && c.tagList.length) {
      var tg = el('div', 'cd-tags');
      tg.appendChild(el('span', 'cd-tags-t', '이런 조건의 사례 더 보기'));
      c.tagList.forEach(function (t) {
        var a = el('a', null, '#' + t.n); a.href = '/cases.html?cat=' + c.cat + '&tag=' + t.k;
        tg.appendChild(a);
      });
      info.appendChild(tg);
    }

    var cta = el('div', 'cd-cta');
    cta.appendChild(el('strong', null, '이 사례와 비슷한 리프트가 필요하신가요?'));
    cta.appendChild(el('p', null, '현장 사진과 필요한 하중·층수를 알려주시면 현장에 맞춰 견적을 드립니다.'));
    var btns = el('div', 'btns');
    var q = el('a', 'btn btn-white', '견적 문의하기'); q.href = '/?to=contact&product=' + c.cat;
    var tel = el('a', 'btn btn-ghost', TEL + ' 전화'); tel.href = 'tel:' + TEL.replace(/[^0-9+]/g, '');
    btns.appendChild(q); btns.appendChild(tel); cta.appendChild(btns);
    info.appendChild(cta);

    var share = el('button', 'cd-share', '링크 공유하기'); share.type = 'button';
    share.addEventListener('click', function () {
      if (navigator.share) { navigator.share({ title: c.title, url: location.href }).catch(function () {}); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(function () { share.textContent = '링크를 복사했습니다'; });
    });
    info.appendChild(share);

    box.appendChild(gal); box.appendChild(info);
  }

  function renderMore(list, cur) {
    var same = list.filter(function (x) { return x.cat === cur.cat && x.key !== cur.key; }).slice(0, 4);
    if (!same.length) return;
    $('#moreTitle').textContent = (CATS[cur.cat] || '같은 제품') + ' 다른 사례';
    $('#moreAll').href = '/cases.html?cat=' + cur.cat;
    var g = $('#moreGrid');
    same.forEach(function (x) {
      var a = el('a'); a.href = x.href;
      var im = el('img'); im.src = x.cover; im.alt = x.title; im.loading = 'lazy';
      a.appendChild(im); a.appendChild(el('b', null, x.title)); a.appendChild(el('small', null, x.site || CATS[x.cat] || ''));
      g.appendChild(a);
    });
    $('#cdMore').hidden = false;
  }

  function sampleToCase(s) { return { key: 's' + s.id, cat: s.cat, title: s.title, site: s.site || '', body: s.body || '', date: '', photos: s.photos || [s.img], cover: s.img, href: '/case.html?s=' + s.id }; }
  function notFound() {
    $('#cdBody').innerHTML = '<p class="case-empty">찾는 설치사례가 없거나 내려간 사례입니다. <a href="/cases.html">설치사례 목록으로</a></p>';
  }

  var siteP = fetch('/api/site').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  var oneP = id ? fetch('/api/cases/' + encodeURIComponent(id)).then(function (r) { return r.json(); }).catch(function () { return null; }) : Promise.resolve(null);

  Promise.all([oneP, siteP]).then(function (r) {
    var cur = null;
    if (id && r[0] && r[0].ok) { var it = r[0].item; cur = { key: 'd' + it.id, cat: it.cat, title: it.title, site: it.site, body: it.body, date: it.date, photos: it.photos, tagList: it.tagList || [] }; }
    if (sid) { var s = (window.GS_SAMPLE || []).filter(function (x) { return x.id === sid; })[0]; if (s) cur = sampleToCase(s); }
    if (!cur || !cur.photos.length) return notFound();
    render(cur);
    // 같은 분류 다른 사례 (최신 8개 중에서)
    fetch('/api/cases?cat=' + cur.cat + '&limit=8').then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (l) {
      var mine = (l && l.ok ? l.items : []).map(function (c) { return { key: 'd' + c.id, cat: c.cat, title: c.title, site: c.site, cover: c.cover, href: '/case.html?id=' + c.id }; });
      var samples = (r[1] && r[1].hideSamples) ? [] : (window.GS_SAMPLE || []).map(sampleToCase);
      renderMore(mine.concat(samples), cur);
    });
  });
})();
