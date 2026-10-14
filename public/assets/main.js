/* 거산리프트 홈페이지 동작 */
(function () {
  var GS = window.GS || {};
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* 첫 화면은 항상 맨 위에서 시작.
     (예전에 #contact 같은 주소로 즐겨찾기해 두면 문의하기로 바로 넘어가던 문제)
     다른 페이지에서 특정 위치로 보낼 때는 ?to=cases&cat=fl 처럼 보냄 */
  var params = new URLSearchParams(location.search);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (location.hash || location.search) history.replaceState(null, '', location.pathname);
  window.scrollTo(0, 0);
  function goTo(id) {
    var el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href').slice(1);
    if (!id || !document.getElementById(id)) return;
    e.preventDefault();
    if (a.dataset.cat) setCaseFilter(a.dataset.cat);
    goTo(id);
  });

  /* 맨 위로 버튼 */
  var toTop = $('#toTop');
  if (toTop) {
    var onScroll = function () { toTop.classList.toggle('show', window.scrollY > 700); };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
    toTop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); });
  }

  /* 관리자 설정(메인 사진·유튜브·예시 숨김)은 한 번만 불러와서 같이 씀 */
  var siteP = window.fetch ? fetch('/api/site').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }) : Promise.resolve(null);

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
    $$('.diagram .ld, .diagram .tg').forEach(function (e) { e.classList.toggle('on', +e.getAttribute('data-i') === n); });
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

  /* 공정 카드: 사진 여러 장을 천천히 넘김 (마우스를 올리면 멈춤) */
  $$('.mslide').forEach(function (box) {
    var ims = $$('img', box), dots = $$('.ms-dots button', box), cap = $('.ms-cap', box), i = 0, timer, hover = false;
    if (ims.length < 2) return;
    function show(n) {
      i = (n + ims.length) % ims.length;
      ims.forEach(function (im, k) { im.classList.toggle('on', k === i); });
      dots.forEach(function (d, k) { d.classList.toggle('on', k === i); });
      if (cap) cap.textContent = ims[i].getAttribute('data-cap');
    }
    dots.forEach(function (d, k) { d.addEventListener('click', function (e) { e.stopPropagation(); show(k); }); });
    box.addEventListener('mouseenter', function () { hover = true; });
    box.addEventListener('mouseleave', function () { hover = false; });
    if (!reduce && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        clearInterval(timer);
        if (es[0].isIntersecting) timer = setInterval(function () { if (!hover) show(i + 1); }, 3200 + Math.random() * 800);
      }, { threshold: 0.3 }).observe(box);
    }
  });

  /* ================= 설치사례: 분류 탭 + 가로 목록 + 크게 보기 ================= */
  var CATS = window.GS_CATS || {};
  var EMPTY_MSG = { all: '아직 등록된 설치사례가 없습니다.', fl: '화물용 리프트 설치사례를 준비 중입니다.', tl: '테이블 리프트 설치사례를 준비 중입니다.', st: '스태커 설치사례를 준비 중입니다. 문의 주시면 사례 사진을 보내드립니다.', tr: '운반기계 제작 사례를 준비 중입니다. 문의 주시면 사례 사진을 보내드립니다.' };
  var EXPAND = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
  var track = $('#track'), allCases = [], caseFilter = 'all', posts = [], casesReady = false;

  function caseCard(c, i) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'case'; b.dataset.i = i;
    b.setAttribute('aria-label', c.title + ' 크게 보기');
    var z = document.createElement('div'); z.className = 'zoom';
    var im = document.createElement('img'); im.src = c.photos[0]; im.alt = c.alt || c.title; im.loading = 'lazy'; im.width = 900; im.height = 1200;
    z.appendChild(im);
    if (c.photos.length > 1) { var n = document.createElement('span'); n.className = 'cnt'; n.textContent = '사진 ' + c.photos.length + '장'; z.appendChild(n); }
    z.insertAdjacentHTML('beforeend', '<span class="exp">' + EXPAND + '</span>');
    var t = document.createElement('b'); t.textContent = c.title;
    var sm = document.createElement('small'); sm.textContent = [CATS[c.cat], c.site].filter(Boolean).join(' · ');
    b.appendChild(z); b.appendChild(t); b.appendChild(sm);
    return b;
  }
  function renderCases() {
    if (!track) return;
    posts = allCases.filter(function (c) { return caseFilter === 'all' || c.cat === caseFilter; });
    track.innerHTML = '';
    if (!posts.length) {
      var p = document.createElement('p'); p.className = 'case-empty'; p.textContent = EMPTY_MSG[caseFilter] || EMPTY_MSG.all;
      track.appendChild(p);
    }
    posts.forEach(function (c, i) { track.appendChild(caseCard(c, i)); });
    track.scrollLeft = 0;
    $$('#caseTabs button').forEach(function (t) {
      var cat = t.dataset.cat, on = cat === caseFilter;
      t.classList.toggle('on', on); t.setAttribute('aria-selected', on);
      var n = cat === 'all' ? allCases.length : allCases.filter(function (c) { return c.cat === cat; }).length;
      $('i', t).textContent = n;
    });
  }
  function setCaseFilter(cat) {
    caseFilter = CATS[cat] ? cat : 'all';
    if (casesReady) renderCases();
  }
  $$('#caseTabs button').forEach(function (t) { t.addEventListener('click', function () { setCaseFilter(t.dataset.cat); }); });
  function scrollCases(dir) { if (track) track.scrollBy({ left: dir * 276, behavior: reduce ? 'auto' : 'smooth' }); }
  if ($('#casePrev')) $('#casePrev').addEventListener('click', function () { scrollCases(-1); });
  if ($('#caseNext')) $('#caseNext').addEventListener('click', function () { scrollCases(1); });

  // 관리자가 올린 사례(맨 앞) + 기본 예시
  if (track) {
    var casesP = window.fetch ? fetch('/api/cases').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }) : Promise.resolve(null);
    Promise.all([casesP, siteP]).then(function (r) {
      var mine = (r[0] && r[0].ok ? r[0].items : []).map(function (c) {
        return { cat: c.cat, title: c.title, site: c.site, body: c.body, photos: c.photos, href: '/case.html?id=' + c.id };
      });
      var hide = r[1] && r[1].hideSamples;
      var samples = hide ? [] : (window.GS_SAMPLE || []).map(function (c) {
        return { cat: c.cat, title: c.title, site: '', body: '', alt: c.alt, photos: [c.img], href: '/case.html?s=' + c.id };
      });
      allCases = mine.concat(samples);
      casesReady = true;
      if (params.get('cat')) caseFilter = CATS[params.get('cat')] ? params.get('cat') : 'all';
      renderCases();
      if (params.get('to') === 'cases') goTo('cases');
    });
  }

  /* 크게 보기 */
  var lb = $('#lightbox'), lastFocus, cur = { p: 0, ph: 0 };
  function lbShow(p, ph) {
    p = (p + posts.length) % posts.length;
    var post = posts[p]; ph = Math.max(0, Math.min(ph, post.photos.length - 1));
    cur = { p: p, ph: ph };
    $('#lbImg').src = post.photos[ph]; $('#lbImg').alt = post.title + (post.photos.length > 1 ? ' (' + (ph + 1) + '/' + post.photos.length + ')' : '');
    $('#lbTitle').textContent = post.title;
    $('#lbSub').textContent = [CATS[post.cat], post.site, (p + 1) + ' / ' + posts.length].filter(Boolean).join(' · ');
    var th = $('#lbThumbs'); th.innerHTML = '';
    if (post.photos.length > 1) post.photos.forEach(function (src, k) {
      var b = document.createElement('button'); b.type = 'button'; b.className = k === ph ? 'on' : '';
      b.setAttribute('aria-label', (k + 1) + '번째 사진');
      var im = document.createElement('img'); im.src = src; im.alt = ''; b.appendChild(im);
      b.addEventListener('click', function () { lbShow(cur.p, k); });
      th.appendChild(b);
    });
    var body = $('#lbBody'); body.textContent = post.body || ''; body.hidden = !post.body;
    $('#lbMore').href = post.href;
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

  /* 다른 페이지에서 ?to=contact&product=fl 로 오면 문의하기로 이동 + 제품 미리 선택 */
  if (params.get('to') && params.get('to') !== 'cases') {
    var want = params.get('to'), prod = CATS[params.get('product')];
    window.addEventListener('load', function () {
      if (want === 'contact' && prod) {
        var sel = $('#form select[name=product]');
        if (sel) $$('option', sel).forEach(function (o) { if (o.textContent.replace(/\s/g, '').indexOf(prod.replace(/\s/g, '').slice(0, 5)) === 0) sel.value = o.value || o.textContent; });
      }
      goTo(want);
    });
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
    siteP.then(function (d) {
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
