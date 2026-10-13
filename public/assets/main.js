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

  /* 메인 슬라이드 (관리자가 올린 사진이 있으면 그걸로 교체) */
  var slider = $('#slider'), slideImgs = [], slideBars = [], slideIdx = 0, slideTimer;
  function slideShow(n) {
    if (!slideImgs.length) return;
    slideIdx = (n + slideImgs.length) % slideImgs.length;
    slideImgs.forEach(function (im, k) { im.classList.toggle('on', k === slideIdx); });
    slideBars.forEach(function (b, k) { b.classList.toggle('on', k === slideIdx); });
    var s = GS.slides && GS.slides[slideIdx];
    if (s) { $('#slTag').textContent = s.tag; $('#slTag').hidden = !s.tag; $('#slTitle').textContent = s.title; }
  }
  function slideStart() { clearInterval(slideTimer); if (!reduce && slideImgs.length > 1) slideTimer = setInterval(function () { slideShow(slideIdx + 1); }, 5000); }
  function slideBind() {
    slideImgs = $$('.slides img', slider); slideBars = $$('.bars button', slider);
    slideBars.forEach(function (b, k) { b.addEventListener('click', function () { slideShow(k); slideStart(); }); });
    slideShow(0); slideStart();
  }
  function slideReplace(list) {
    var box = $('.slides', slider), bars = $('.bars', slider);
    $$('img', box).forEach(function (im) { im.remove(); });
    bars.innerHTML = '';
    list.forEach(function (sl, k) {
      var im = document.createElement('img');
      im.src = sl.img; im.alt = (sl.tag ? sl.tag + ' · ' : '') + sl.title; im.width = 1200; im.height = 1500;
      if (k) im.loading = 'lazy';
      box.insertBefore(im, $('.shade', box));
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', (k + 1) + '번째 사진 보기');
      b.appendChild(document.createElement('span')); bars.appendChild(b);
    });
    bars.hidden = list.length < 2; $('.ctrl', slider).hidden = list.length < 2;
    GS.slides = list.map(function (x) { return { tag: x.tag, title: x.title }; });
    slideBind();
  }
  if (slider) {
    $('.prev', slider).addEventListener('click', function () { slideShow(slideIdx - 1); slideStart(); });
    $('.next', slider).addEventListener('click', function () { slideShow(slideIdx + 1); slideStart(); });
    slideBind();
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

  /* 설치사례 크게 보기: 글마다 사진 여러 장 + 내용 */
  var lb = $('#lightbox'), lastFocus;
  var posts = (GS.cases || []).map(function (c) { return { title: c.title, site: c.sub, body: '', photos: [c.img] }; });
  var cur = { p: 0, ph: 0 };
  function lbShow(p, ph) {
    p = (p + posts.length) % posts.length;
    var post = posts[p]; ph = Math.max(0, Math.min(ph, post.photos.length - 1));
    cur = { p: p, ph: ph };
    $('#lbImg').src = post.photos[ph]; $('#lbImg').alt = post.title + (post.photos.length > 1 ? ' (' + (ph + 1) + '/' + post.photos.length + ')' : '');
    $('#lbTitle').textContent = post.title;
    $('#lbSub').textContent = (post.site ? post.site + ' · ' : '') + (p + 1) + ' / ' + posts.length;
    var th = $('#lbThumbs'); th.innerHTML = '';
    if (post.photos.length > 1) post.photos.forEach(function (src, k) {
      var b = document.createElement('button'); b.type = 'button'; b.className = k === ph ? 'on' : '';
      b.setAttribute('aria-label', (k + 1) + '번째 사진');
      var im = document.createElement('img'); im.src = src; im.alt = ''; b.appendChild(im);
      b.addEventListener('click', function () { lbShow(cur.p, k); });
      th.appendChild(b);
    });
    var body = $('#lbBody'); body.textContent = post.body || ''; body.hidden = !post.body;
  }
  function lbStep(d) {
    var post = posts[cur.p], ph = cur.ph + d;
    if (ph >= 0 && ph < post.photos.length) return lbShow(cur.p, ph);
    var np = (cur.p + d + posts.length) % posts.length;
    lbShow(np, d > 0 ? 0 : posts[np].photos.length - 1);
  }
  function lbOpen(n) { lastFocus = document.activeElement; lbShow(n, 0); lb.classList.add('open'); document.body.style.overflow = 'hidden'; $('.close', lb).focus(); }
  function lbClose() { lb.classList.remove('open'); document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); }
  if (lb) {
    if (track) track.addEventListener('click', function (e) { var b = e.target.closest('.case'); if (b) lbOpen(+b.dataset.i); });
    $$('[data-close]', lb).forEach(function (b) { b.addEventListener('click', lbClose); });
    $('#lbPrev').addEventListener('click', function () { lbStep(-1); });
    $('#lbNext').addEventListener('click', function () { lbStep(1); });
    lb.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') lbClose();
      if (e.key === 'ArrowLeft') lbStep(-1);
      if (e.key === 'ArrowRight') lbStep(1);
    });
  }

  /* 관리자 페이지에서 올린 설치사례를 맨 앞에 추가 */
  if (track && window.fetch) {
    fetch('/api/cases').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.ok || !d.items.length) return;
      var expand = $('.case .exp', track), frag = document.createDocumentFragment();
      d.items.forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'case'; b.setAttribute('aria-label', c.title + ' 크게 보기');
        var z = document.createElement('div'); z.className = 'zoom';
        var im = document.createElement('img'); im.src = c.photos[0]; im.alt = c.title; im.loading = 'lazy'; im.width = 900; im.height = 1200;
        z.appendChild(im);
        if (c.photos.length > 1) { var n = document.createElement('span'); n.className = 'cnt'; n.textContent = '사진 ' + c.photos.length + '장'; z.appendChild(n); }
        if (expand) z.appendChild(expand.cloneNode(true));
        var t = document.createElement('b'); t.textContent = c.title;
        var s = document.createElement('small'); s.textContent = c.site;
        b.appendChild(z); b.appendChild(t); b.appendChild(s);
        frag.appendChild(b);
      });
      track.insertBefore(frag, track.firstChild);
      posts = d.items.map(function (c) { return { title: c.title, site: c.site, body: c.body, photos: c.photos }; }).concat(posts);
      $$('.case', track).forEach(function (b, i) { b.dataset.i = i; });
    }).catch(function () {});
  }

  /* 유튜브: 누를 때만 불러오기. 관리자가 정한 영상이 있으면 그 영상들, 없으면 채널 최신 영상 */
  var yt = $('#yt');
  function ytPlay(src) {
    var f = document.createElement('iframe');
    f.src = src; f.title = '거산리프트 유튜브 영상';
    f.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    yt.innerHTML = ''; yt.appendChild(f);
  }
  function ytPoster(v) {
    yt.innerHTML = '';
    var b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', (v.title || '유튜브 영상') + ' 재생');
    var im = document.createElement('img'); im.className = 'poster'; im.alt = ''; im.src = 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg';
    b.appendChild(im);
    b.insertAdjacentHTML('beforeend', '<svg width="72" height="72" viewBox="0 0 64 64" aria-hidden="true" style="position:relative"><circle cx="32" cy="32" r="31" fill="rgba(6,38,86,.6)" stroke="#fff" stroke-width="2"/><path d="M26 21 L45 32 L26 43 Z" fill="#fff"/></svg>');
    var l = document.createElement('span'); l.className = 'lbl'; l.textContent = v.title || '영상 재생'; b.appendChild(l);
    b.addEventListener('click', function () { ytPlay('https://www.youtube-nocookie.com/embed/' + v.id + '?autoplay=1&rel=0'); });
    yt.appendChild(b);
  }
  function ytList(videos) {
    ytPoster(videos[0]);
    var more = $('#ytMore'); more.innerHTML = ''; more.hidden = videos.length < 2;
    if (videos.length < 2) return;
    videos.forEach(function (v, k) {
      var b = document.createElement('button'); b.type = 'button'; if (!k) b.className = 'on';
      var im = document.createElement('img'); im.src = 'https://i.ytimg.com/vi/' + v.id + '/mqdefault.jpg'; im.alt = ''; im.loading = 'lazy';
      var t = document.createElement('span'); t.textContent = v.title || (k + 1) + '번째 영상';
      b.appendChild(im); b.appendChild(t);
      b.addEventListener('click', function () {
        $$('button', more).forEach(function (x) { x.classList.toggle('on', x === b); });
        ytPlay('https://www.youtube-nocookie.com/embed/' + v.id + '?autoplay=1&rel=0');
      });
      more.appendChild(b);
    });
  }
  if (yt && GS.uploads) {
    $('button', yt).addEventListener('click', function () {
      ytPlay('https://www.youtube-nocookie.com/embed/videoseries?list=' + GS.uploads + '&autoplay=1');
    });
  }

  /* 관리자 설정 불러오기: 메인 사진, 유튜브 영상 */
  if (window.fetch) {
    fetch('/api/site').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.ok) return;
      if (slider && d.slides && d.slides.length) slideReplace(d.slides);
      if (yt && d.videos && d.videos.length) ytList(d.videos);
    }).catch(function () {});
  }

  /* 문의 폼: 서버로 전송 → 저장 + 메일 알림 */
  var form = $('#form');
  if (form) {
    var btn = $('#formBtn'), msg = $('#formMsg');
    function say(text, kind) { msg.textContent = text; msg.className = 'form-msg full ' + (kind || ''); }
    function mark(name) {
      $$('.invalid', form).forEach(function (el) { el.classList.remove('invalid'); });
      var el = name && form.elements[name];
      if (el) { el.classList.add('invalid'); el.focus(); }
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form.elements;
      if (!f.name.value.trim()) { mark('name'); return say('담당자명을 입력해 주세요.', 'err'); }
      if (!/^[0-9+\-() ]{8,20}$/.test(f.phone.value.trim())) { mark('phone'); return say('연락처를 정확히 입력해 주세요. 예) 010-1234-5678', 'err'); }
      if (!f.agree.checked) { mark('agree'); return say('개인정보 수집·이용에 동의해 주세요.', 'err'); }
      mark(null);
      btn.disabled = true; btn.textContent = '보내는 중…'; say('');
      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: f.company.value, name: f.name.value, phone: f.phone.value,
          product: f.product.value, message: f.message.value,
          agree: f.agree.checked, website: f.website.value
        })
      })
        .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
        .then(function (d) {
          if (d.ok) {
            form.reset();
            say('문의가 접수되었습니다. 담당자가 확인 후 연락드리겠습니다. 급하신 경우 031-986-5345로 전화 주세요.', 'ok');
          } else {
            if (d.field) mark(d.field);
            say(d.error || '전송에 실패했습니다. 전화(031-986-5345)로 연락 부탁드립니다.', 'err');
          }
        })
        .catch(function () { say('인터넷 연결을 확인해 주세요. 계속 안 되면 전화(031-986-5345)로 연락 부탁드립니다.', 'err'); })
        .then(function () { btn.disabled = false; btn.textContent = '문의 보내기'; });
    });
  }
})();
