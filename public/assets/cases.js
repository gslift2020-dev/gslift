/* 설치사례 전체 목록 페이지 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var CATS = window.GS_CATS || {};
  var PAGE = 24;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {
    var hitData = JSON.stringify({ p: location.pathname + location.search, r: document.referrer });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/hit', new Blob([hitData], { type: 'text/plain' }));
  } catch (e) {}

  /* 메뉴·맨 위로 */
  var nav = $('#nav'), menuBtn = $('#menuBtn');
  menuBtn.addEventListener('click', function () { var o = nav.classList.toggle('open'); menuBtn.setAttribute('aria-expanded', o); });
  var toTop = $('#toTop');
  window.addEventListener('scroll', function () { toTop.classList.toggle('show', window.scrollY > 600); }, { passive: true });
  toTop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); });

  var params = new URLSearchParams(location.search);
  var st = { cat: CATS[params.get('cat')] ? params.get('cat') : 'all', q: (params.get('q') || '').slice(0, 40), offset: 0, total: 0, loading: false, done: false, req: 0 };
  var counts = {}, samples = [], hideSamples = true;
  var grid = $('#clGrid'), moreBtn = $('#clMore'), loadingEl = $('#clLoading'), empty = $('#clEmpty');
  $('#clQ').value = st.q;

  function card(c) {
    var a = document.createElement('a'); a.className = 'cl-card'; a.href = c.href;
    var ph = document.createElement('div'); ph.className = 'ph';
    var im = document.createElement('img'); im.src = c.cover; im.alt = c.title; im.loading = 'lazy'; im.width = 900; im.height = 1200;
    ph.appendChild(im);
    if (c.count > 1) { var n = document.createElement('span'); n.className = 'cnt'; n.textContent = '사진 ' + c.count; ph.appendChild(n); }
    var b = document.createElement('b'); b.textContent = c.title;
    var sm = document.createElement('small'); sm.textContent = [c.site || CATS[c.cat], c.date].filter(Boolean).join(' · ');
    a.appendChild(ph); a.appendChild(b); a.appendChild(sm);
    return a;
  }
  function matchSample(s) {
    if (st.cat !== 'all' && s.cat !== st.cat) return false;
    return !st.q || s.title.indexOf(st.q) >= 0;
  }
  function syncUrl() {
    var p = [];
    if (st.cat !== 'all') p.push('cat=' + st.cat);
    if (st.q) p.push('q=' + encodeURIComponent(st.q));
    history.replaceState(null, '', location.pathname + (p.length ? '?' + p.join('&') : ''));
  }
  function drawTabs() {
    $$('#clTabs button').forEach(function (t) {
      var on = t.dataset.cat === st.cat;
      t.classList.toggle('on', on); t.setAttribute('aria-selected', on);
      $('i', t).textContent = counts[t.dataset.cat] != null ? counts[t.dataset.cat] : '';
    });
    $('#clTotal').textContent = counts.all ? '지금까지 ' + counts.all + '건의 사례를 올렸습니다.' : '';
  }

  function load(reset) {
    if (reset) { st.offset = 0; st.done = false; grid.innerHTML = ''; empty.hidden = true; }
    if (st.loading || st.done) return;
    st.loading = true; loadingEl.hidden = false; moreBtn.hidden = true;
    var my = ++st.req;
    var url = '/api/cases?limit=' + PAGE + '&offset=' + st.offset + (st.cat !== 'all' ? '&cat=' + st.cat : '') + (st.q ? '&q=' + encodeURIComponent(st.q) : '');
    fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (d) {
      if (my !== st.req) return; // 더 최근 요청이 있으면 무시
      st.loading = false; loadingEl.hidden = true;
      if (!d || !d.ok) { empty.textContent = '목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'; empty.hidden = false; return; }
      var sc = d.counts || {};
      counts = { all: 0 };
      Object.keys(CATS).forEach(function (c) {
        counts[c] = (sc[c] || 0) + samples.filter(function (s) { return s.cat === c; }).length;
        counts.all += counts[c];
      });
      drawTabs();
      d.items.forEach(function (c) { grid.appendChild(card({ href: '/case.html?id=' + c.id, cover: c.cover, title: c.title, site: c.site, cat: c.cat, date: c.date, count: c.count })); });
      st.offset += d.items.length; st.total = d.total;
      if (st.offset >= d.total || !d.items.length) {
        st.done = true;
        samples.filter(matchSample).forEach(function (s) { grid.appendChild(card({ href: '/case.html?s=' + s.id, cover: s.img, title: s.title, cat: s.cat, count: 1 })); });
      }
      moreBtn.hidden = st.done;
      if (!grid.children.length) {
        empty.textContent = st.q ? '"' + st.q + '"에 맞는 사례가 없습니다. 다른 말로 찾아보세요.' : '이 분류의 설치사례를 준비 중입니다. 문의 주시면 사례 사진을 보내드립니다.';
        empty.hidden = false;
      }
    });
  }

  $$('#clTabs button').forEach(function (t) {
    t.addEventListener('click', function () { if (st.cat === t.dataset.cat) return; st.cat = t.dataset.cat; syncUrl(); drawTabs(); load(true); });
  });
  var qt;
  $('#clQ').addEventListener('input', function () {
    var v = this.value.trim().slice(0, 40);
    clearTimeout(qt); qt = setTimeout(function () { if (v === st.q) return; st.q = v; syncUrl(); load(true); }, 300);
  });
  moreBtn.addEventListener('click', function () { load(false); });
  // 아래로 내려가면 자동으로 더 불러오기
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { if (es[0].isIntersecting && grid.children.length) load(false); }, { rootMargin: '400px' }).observe($('.cl-more'));
  }

  fetch('/api/site').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (d) {
    hideSamples = !!(d && d.hideSamples);
    samples = hideSamples ? [] : (window.GS_SAMPLE || []);
    drawTabs(); load(true);
  });
})();
