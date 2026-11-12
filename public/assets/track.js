/* 광고 전환 추적 (네이버·카카오) + 광고 유입 경로 기억
   - 키가 비어 있으면 광고 추적 코드는 아무것도 하지 않음 (유입 경로 기억만 동작)
   - 키는 홈페이지 소스에 원래 공개되는 값이라 저장소에 넣어도 됨
   - 데이터베이스(D1)를 전혀 읽지 않음
   - 키를 넣기 전에 네이버가 메일로 보내는 '설치 가이드'의 문법과 아래 코드가 같은지 확인할 것 */
(function () {
  var NAVER_WA = '';    // 네이버 전환추적 공통키 (s_로 시작) — gslift.kr로 새로 발급받은 값
  var KAKAO_PIXEL = ''; // 카카오 픽셀 ID (숫자)
  var DOMAIN = 'gslift.kr';

  // 0) 방문 통계 신호 (모든 페이지에서 이 파일 하나가 보냄 — main.js가 주소의 ?… 를 지우기 전에 실행됨)
  //    - 방문번호: 무작위 값, 30분 동안 아무 페이지도 안 보면 새 번호 (사람을 알아볼 수 없음)
  //    - 직원 표시: gslift.kr/?gs_staff=1 을 한 번 열거나 이 브라우저로 관리자에 로그인하면 남음 (?gs_staff=0 으로 해제)
  //      직원 기기도 신호는 보내되 '직원'으로 표시 → 서버가 합계에서 빼고 관리자 화면에서 기본 숨김. 행동 신호는 안 보냄
  //    - 페이지 안 행동: 머문 시간(방문 전체) · 처음 들어온 페이지의 스크롤 깊이 · 누른 것(설치사례·전화·견적)
  //      다음 페이지 신호에 실어 보내고, 사이트를 떠날 때는 방문당 1번만 따로 보냄 (DB 쓰기가 방문당 최대 1번만 늘게)
  var VISIT_GAP = 30 * 60 * 1000, vid = '', gsU = null;
  // 서버로 보낼 재방문 정보 (첫 방문이면 주소는 그 신호에 이미 있으므로 빼고 보냄)
  function uInfo() {
    if (!gsU) return null;
    var o = { n: gsU.n, id: gsU.id };
    if (gsU.f.pre) o.pre = 1;
    if (gsU.n > 1) { o.t = gsU.f.t; o.p = gsU.f.p; o.r = gsU.f.r; }
    return o;
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function note(t) {
    try {
      var d = document.createElement('div');
      d.textContent = t;
      d.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:9999;background:#062656;color:#fff;padding:12px 18px;border-radius:12px;font:600 15px/1.4 sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:90vw;text-align:center';
      (document.body || document.documentElement).appendChild(d);
      setTimeout(function () { d.remove(); }, 5000);
    } catch (e) {}
  }
  function send(o) {
    var data = JSON.stringify(o);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/hit', new Blob([data], { type: 'text/plain' }))) return;
      fetch('/api/hit', { method: 'POST', body: data, keepalive: true });
    } catch (e) {}
  }
  try {
    var sq = new URLSearchParams(location.search).get('gs_staff');
    if (sq === '1') { var saved = lsSet('gs_staff', '1'); document.addEventListener('DOMContentLoaded', function () { note(saved ? '이 기기(브라우저)는 이제 방문 통계에서 빠집니다.' : '이 브라우저는 설정을 저장할 수 없어 빼지 못했습니다. (비공개 창인지 확인)'); }); }
    if (sq === '0') { lsSet('gs_staff', null); document.addEventListener('DOMContentLoaded', function () { note('이 기기(브라우저)를 다시 방문 통계에 넣습니다.'); }); }
    var staff = lsGet('gs_staff') === '1' || sq === '1';
    if (!navigator.webdriver) {
      var now = Date.now(), first = 0, prev = null, hadV = lsGet('gs_v') != null;
      try { prev = JSON.parse(lsGet('gs_v') || 'null'); } catch (e) {}
      if (prev && prev.id && now - prev.t < VISIT_GAP) vid = prev.id;
      else { vid = (Math.random().toString(36).slice(2) + now.toString(36)).slice(0, 20); first = 1; prev = null; }
      // 행동 누적값 (방문 단위): d 머문 시간(초) · s 처음 페이지 스크롤 · a 누른 것 · e 떠날 때 신호를 보냈는지
      var B = first ? { d: 0, s: 0, a: 0, e: 0 } : { d: +(prev.d || 0), s: +(prev.s || 0), a: +(prev.a || 0), e: +(prev.e || 0) };
      var save = function () { if (vid) lsSet('gs_v', JSON.stringify({ id: vid, t: Date.now(), d: B.d, s: B.s, a: B.a, e: B.e })); };
      if (!lsSet('gs_v', JSON.stringify({ id: vid, t: now, d: B.d, s: B.s, a: B.a, e: B.e }))) vid = ''; // 저장이 안 되는 브라우저는 방문 1건 기록 없이 합계만
      // 재방문 구분 (2026-11-12): 같은 브라우저로 다시 오면 몇 번째 방문인지 + 처음 들어온 주소를 기억 (gs_u, 마지막 방문 뒤 365일)
      //   - f: 첫 방문 시각(t)·처음 들어온 주소(p)·직전 페이지 주소(r) — 경로 이름(네이버 광고 등)은 서버가 지금과 같은 규칙으로 정함
      //   - n: 몇 번째 방문(새 방문번호가 생길 때 1씩) · id: 무작위 손님 번호(이름·연락처와 무관) · pre: 이 기능 전에도 온 적 있음
      //   - 직원 기기·저장이 막힌 브라우저는 만들지도 보내지도 않음. DB 읽기·쓰기 추가 없음(첫 페이지 신호에 실음)
      if (vid && !staff) {
        try { gsU = JSON.parse(lsGet('gs_u') || 'null'); } catch (e) { gsU = null; }
        if (!gsU || typeof gsU !== 'object' || !gsU.f || !gsU.id || now - (+gsU.l || 0) > 365 * 864e5) gsU = null;
        if (first) {
          if (!gsU) {
            gsU = { n: 0, id: (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 16),
              f: { t: now, p: (location.pathname + location.search).slice(0, 400), r: String(document.referrer || '').slice(0, 300) } };
            if (hadV) gsU.f.pre = 1;
          }
          gsU.n = (+gsU.n || 0) + 1; gsU.l = now;
          if (!lsSet('gs_u', JSON.stringify(gsU))) gsU = null;
        }
      }
      var hit = { p: location.pathname + location.search, r: document.referrer, v: vid, f: first };
      if (first && gsU) hit.u = uInfo();
      if (staff) hit.s = 1;
      else if (!first && vid) hit.b = { d: B.d, s: B.s, a: B.a }; // 지난 페이지까지의 행동을 이 신호에 실음 (쓰기 추가 없음)
      send(hit);

      if (vid && !staff) {
        // 머문 시간: 화면을 보고 있는 동안만 셈
        var shownAt = document.visibilityState === 'visible' ? Date.now() : 0;
        var flushTime = function () { if (shownAt) { B.d = Math.min(B.d + Math.round((Date.now() - shownAt) / 1000), 3600); shownAt = 0; } };
        // 스크롤 깊이: 이 방문의 처음 페이지에서만 (25·50·75·100%)
        if (first) {
          var depth = function () {
            var h = document.documentElement.scrollHeight - window.innerHeight;
            var pct = h <= 0 ? 100 : Math.min(100, (window.scrollY / h) * 100);
            var st = pct >= 99 ? 100 : pct >= 75 ? 75 : pct >= 50 ? 50 : pct >= 25 ? 25 : 0;
            if (st > B.s) B.s = st;
          };
          window.addEventListener('scroll', depth, { passive: true });
          window.addEventListener('load', depth);
        }
        // 누른 것: 1 설치사례 열어 봄 · 2 전화번호 · 4 견적 문의 버튼 · 8 견적 양식에 입력 시작 · 16 설치사례 구역 봄 · 32 견적 구역 봄
        var leaving = false; // 우리 사이트 안의 다른 페이지로 가는 중 → 떠날 때 신호 대신 다음 페이지 신호에 실음
        document.addEventListener('click', function (e) {
          var t = e.target && e.target.closest ? e.target : null; if (!t) return;
          var a = t.closest('a'), href = a ? a.getAttribute('href') || '' : '';
          if (/^tel:/i.test(href)) B.a |= 2;
          if (/case\.html/.test(href) || t.closest('#track .case:not(.case-more), .cl-card, #lbMore, .cd-more-grid a')) B.a |= 1;
          if (/#contact|to=contact/.test(href)) B.a |= 4;
          if (a && !a.target && a.host === location.host && !/^(tel|mailto):/i.test(href) && href.charAt(0) !== '#') leaving = true;
          save();
        }, true);
        // 구역을 봤는지: 16 설치사례 구역 · 32 견적 문의 구역 — 첫 화면에서 그 구역이 화면 절반 이상을 1초 넘게 차지하면 (2026-11-11, 개편 전후 비교용)
        // 기존 acts 칸에 더하기만 함 → 쓰기·읽기 추가 없음 (다음 페이지 신호나 떠날 때 신호에 같이 실림)
        if ('IntersectionObserver' in window && (location.pathname === '/' || location.pathname === '/index.html')) {
          var seen = function (id, bit) {
            var el = document.getElementById(id); if (!el) return;
            var tm = 0;
            var ob = new IntersectionObserver(function (es) {
              es.forEach(function (en) {
                var vh = window.innerHeight || 1, big = en.isIntersecting && (en.intersectionRect.height / vh >= 0.5 || en.intersectionRatio >= 0.6);
                if (big && !tm) tm = setTimeout(function () { B.a |= bit; save(); ob.disconnect(); }, 1000);
                if (!big && tm) { clearTimeout(tm); tm = 0; }
              });
            }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] });
            ob.observe(el);
          };
          var go = function () { seen('cases', 16); seen('contact', 32); };
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
        }
        var form = function (e) { if (e.target && e.target.closest && e.target.closest('#form')) { if (!(B.a & 8)) { B.a |= 8; save(); } } };
        document.addEventListener('input', form, true);
        document.addEventListener('change', form, true);
        // 화면이 가려질 때(다른 앱·탭, 창 닫기, 전화 걸기): 행동을 저장하고, 사이트를 떠나는 것이면 방문당 1번만 보냄
        var hidden = function () {
          flushTime(); save();
          if (leaving || B.e) return;
          B.e = 1; save();
          send({ v: vid, e: 1, b: { d: B.d, s: B.s, a: B.a } });
        };
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden') hidden();
          else { shownAt = Date.now(); leaving = false; }
        });
        window.addEventListener('pagehide', function () { flushTime(); save(); if (!leaving && !B.e) hidden(); });
        window.addEventListener('pageshow', function (e) { if (e.persisted) { shownAt = Date.now(); leaving = false; } });
      }
    }
  } catch (e) {}

  // 1) 어디서 들어왔는지 세션에 기억 (main.js가 주소의 ?… 를 지우기 전에 실행됨)
  //    광고 추적 값이 붙은 주소로 들어오면 그 광고가 이김(같은 창에서 광고를 다시 눌러 들어온 경우)
  //    광고 검색어(gs_kw): 손님이 실제로 친 말 — 네이버 n_query · 카카오 k_query 또는 utm_term. 없으면 등록 키워드(n_keyword·k_keyword)
  function adv(q, k) {
    var v = q.get(k) || '';
    for (var i = 0; i < 2 && /%[0-9A-Fa-f]{2}/.test(v); i++) { try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { break; } }
    if (v.indexOf('\uFFFD') >= 0) return ''; // UTF-8이 아닌 값(깨진 글자)은 버림
    return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
  }
  try {
    // 새 방문(30분 넘게 쉬었다 다시 옴)이면 지난 방문의 경로·검색어를 지우고 이번 방문 것으로 다시 정함
    //   (같은 탭을 며칠 열어 두었다가 다시 들어와 문의해도 '이번 방문 경로'가 맞게 — 첫 방문 경로는 gs_u에 따로 있음, 2026-11-12)
    if (first === 1) { sessionStorage.removeItem('gs_src'); sessionStorage.removeItem('gs_kw'); }
  } catch (e) {}
  try {
    var aq = new URLSearchParams(location.search);
    var adSrc = aq.get('utm_source') || (aq.get('n_media') || aq.get('n_query') || aq.get('n_keyword') ? 'naver' : '') || (aq.get('k_query') || aq.get('k_keyword') ? 'kakao' : '');
    if (adSrc) {
      sessionStorage.setItem('gs_src', adSrc.slice(0, 40));
      var akw = adv(aq, 'n_query') || adv(aq, 'k_query') || adv(aq, 'utm_term');
      var areg = adv(aq, 'n_keyword') || adv(aq, 'k_keyword');
      sessionStorage.setItem('gs_kw', akw || (areg ? '키워드: ' + areg : ''));
    }
  } catch (e) {}
  try {
    if (!sessionStorage.getItem('gs_src')) {
      var q = new URLSearchParams(location.search);
      var src = q.get('utm_source') || (q.get('n_media') ? 'naver' : '');
      if (!src && document.referrer) {
        var h = new URL(document.referrer).hostname.replace(/^www\./, '');
        if (h !== location.hostname.replace(/^www\./, '')) src = h;
      }
      if (!src && /KAKAOTALK/i.test(navigator.userAgent)) src = 'kakaotalk';
      if (!src && /NAVER\(inapp/i.test(navigator.userAgent)) src = 'naver-app';
      sessionStorage.setItem('gs_src', (src || 'direct').slice(0, 40));
    }
  } catch (e) {}

  function load(url, cb) {
    var s = document.createElement('script');
    s.src = url; s.async = true; s.onload = cb;
    document.head.appendChild(s);
  }

  // 2) 네이버 공통 스크립트 (모든 페이지)
  if (NAVER_WA) {
    window.wcs_add = window.wcs_add || {};
    window.wcs_add.wa = NAVER_WA;
    window._nasa = window._nasa || {};
    load('https://wcs.naver.net/wcslog.js', function () {
      try { if (window.wcs) { window.wcs.inflow(DOMAIN); window.wcs_do(); } } catch (e) {}
    });
  }

  // 3) 카카오 픽셀 (모든 페이지)
  if (KAKAO_PIXEL) {
    load('https://t1.daumcdn.net/kas/static/kp.js', function () {
      try { if (window.kakaoPixel) window.kakaoPixel(KAKAO_PIXEL).pageView(); } catch (e) {}
    });
  }

  window.GSTrack = {
    // 문의와 함께 보낼 유입 경로 (예: naver, kakao, search.naver.com)
    src: function () {
      try { return sessionStorage.getItem('gs_src') || ''; } catch (e) { return ''; }
    },
    // 문의와 함께 보낼 광고 검색어 (광고로 들어온 경우만, 예: 화물용리프트)
    kw: function () {
      try { return sessionStorage.getItem('gs_kw') || ''; } catch (e) { return ''; }
    },
    // 문의를 이 방문 기록에 연결하기 위한 방문번호
    vid: function () { return vid; },
    // 재방문 정보 (몇 번째 방문·첫 방문 주소) — 견적 문의에 같이 보냄. 없으면 ''
    u: function () { try { var o = uInfo(); return o ? JSON.stringify(o) : ''; } catch (e) { return ''; } },
    // 견적문의 접수가 성공했을 때 한 번 호출 → 광고 '전환'으로 집계
    lead: function () {
      try { if (NAVER_WA && window.wcs && window.wcs.trans) window.wcs.trans({ type: 'lead' }); } catch (e) {}
      try { if (KAKAO_PIXEL && window.kakaoPixel) window.kakaoPixel(KAKAO_PIXEL).participation(); } catch (e) {}
    },
  };
})();
