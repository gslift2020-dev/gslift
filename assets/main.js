/* 거산리프트 홈페이지 동작 */
(function () {
  var GS = window.GS || {};
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* 모바일 메뉴 */
  var nav = $('#nav'), menuBtn = $('#menuBtn');
  if (menuBtn) {
    menuBtn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    $$('a', nav).forEach(function (a) {
      a.addEventListener('click', function () { nav.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); });
    });
  }

  /* 메인 슬라이드 */
  var slider = $('#slider');
  if (slider) {
    var imgs = $$('.slides img', slider), bars = $$('.bars button', slider);
    var tag = $('#slTag'), title = $('#slTitle'), i = 0, timer;
    function show(n) {
      i = (n + imgs.length) % imgs.length;
      imgs.forEach(function (im, k) { im.classList.toggle('on', k === i); });
      bars.forEach(function (b, k) { b.classList.toggle('on', k === i); });
      var s = GS.slides && GS.slides[i];
      if (s) { tag.textContent = s.tag; title.textContent = s.title; }
    }
    function start() { clearInterval(timer); if (!reduce) timer = setInterval(function () { show(i + 1); }, 5000); }
    $('.prev', slider).addEventListener('click', function () { show(i - 1); start(); });
    $('.next', slider).addEventListener('click', function () { show(i + 1); start(); });
    bars.forEach(function (b, k) { b.addEventListener('click', function () { show(k); start(); }); });
    start();
  }

  /* 스크롤 등장 효과 + 숫자 카운터 */
  var rvs = $$('.rv');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    rvs.forEach(function (el) { io.observe(el); });
  } else {
    rvs.forEach(function (el) { el.classList.add('in'); });
  }
  var counters = $$('[data-count]');
  function runCount() {
    if (reduce) return;
    var t0 = performance.now();
    counters.forEach(function (c) { c.textContent = '0'; });
    (function step(t) {
      var k = Math.min(1, (t - t0) / 1400), e = 1 - Math.pow(1 - k, 3);
      counters.forEach(function (c) { c.textContent = Math.round(+c.dataset.count * e); });
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  var stats = $('#stats');
  if (stats && 'IntersectionObserver' in window) {
    var so = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { runCount(); so.disconnect(); }
    }, { threshold: 0.4 });
    so.observe(stats);
  }

  /* 안전검사 12개 항목 */
  var items = GS.items || [], dots = $$('.dot'), rows = $$('#stdList button'), k = 0, tour;
  function pick(n) {
    k = n;
    var it = items[n];
    $('#stdNo').textContent = it.no;
    $('#stdT').textContent = it.t;
    $('#stdS').textContent = it.spec;
    $('#stdD').textContent = it.d;
    dots.forEach(function (d, j) { d.classList.toggle('on', j === n); });
    rows.forEach(function (r, j) { r.classList.toggle('on', j === n); r.setAttribute('aria-pressed', j === n ? 'true' : 'false'); });
  }
  if (items.length) {
    dots.concat(rows).forEach(function (b) {
      b.addEventListener('click', function () { clearInterval(tour); pick(+b.dataset.i); });
    });
    var safety = $('#safety');
    if (!reduce && safety && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        clearInterval(tour);
        if (es[0].isIntersecting && !safety.dataset.touched) {
          tour = setInterval(function () { pick((k + 1) % items.length); }, 3500);
        }
      }, { threshold: 0.3 }).observe(safety);
      dots.concat(rows).forEach(function (b) { b.addEventListener('click', function () { safety.dataset.touched = '1'; }); });
    }
  }

  /* 설치사례 가로 스크롤 */
  var track = $('#track');
  function scrollCases(dir) { if (track) track.scrollBy({ left: dir * 276, behavior: reduce ? 'auto' : 'smooth' }); }
  if ($('#casePrev')) $('#casePrev').addEventListener('click', function () { scrollCases(-1); });
  if ($('#caseNext')) $('#caseNext').addEventListener('click', function () { scrollCases(1); });

  /* 설치사례 크게 보기 */
  var lb = $('#lightbox'), cases = GS.cases || [], cur = 0, lastFocus;
  function lbShow(n) {
    cur = (n + cases.length) % cases.length;
    var c = cases[cur];
    $('#lbImg').src = c.img; $('#lbImg').alt = c.alt;
    $('#lbTitle').textContent = c.title;
    $('#lbSub').textContent = c.sub + ' · ' + (cur + 1) + ' / ' + cases.length;
  }
  function lbOpen(n) { lastFocus = document.activeElement; lbShow(n); lb.classList.add('open'); document.body.style.overflow = 'hidden'; $('.close', lb).focus(); }
  function lbClose() { lb.classList.remove('open'); document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); }
  if (lb) {
    $$('.case').forEach(function (b) { b.addEventListener('click', function () { lbOpen(+b.dataset.i); }); });
    $$('[data-close]', lb).forEach(function (b) { b.addEventListener('click', lbClose); });
    $('#lbPrev').addEventListener('click', function () { lbShow(cur - 1); });
    $('#lbNext').addEventListener('click', function () { lbShow(cur + 1); });
    lb.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') lbClose();
      if (e.key === 'ArrowLeft') lbShow(cur - 1);
      if (e.key === 'ArrowRight') lbShow(cur + 1);
    });
  }

  /* 유튜브: 누를 때만 불러오기 (채널 최신 업로드 목록) */
  var yt = $('#yt');
  if (yt && GS.uploads) {
    $('button', yt).addEventListener('click', function () {
      var f = document.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/videoseries?list=' + GS.uploads + '&autoplay=1';
      f.title = '거산리프트 유튜브 영상';
      f.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
      f.allowFullscreen = true;
      yt.innerHTML = '';
      yt.appendChild(f);
    });
  }

  /* 문의 폼: 서버 연결 전 임시 안내 */
  var form = $('#form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      alert('온라인 문의 접수는 준비 중입니다.\n전화 031-986-5345 또는 이메일 gslift2020@naver.com 으로 연락 부탁드립니다.');
    });
  }
})();
