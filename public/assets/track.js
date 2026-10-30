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
  //    - 회사 사람 빼기: gslift.kr/?gs_staff=1 을 한 번 열면 그 브라우저는 기록 안 함 (?gs_staff=0 으로 해제)
  //      관리자 화면 '이 기기는 통계에서 빼기' 버튼도 같은 표시를 남김
  var VISIT_GAP = 30 * 60 * 1000, vid = '';
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
  try {
    var sq = new URLSearchParams(location.search).get('gs_staff');
    if (sq === '1') { var saved = lsSet('gs_staff', '1'); document.addEventListener('DOMContentLoaded', function () { note(saved ? '이 기기(브라우저)는 이제 방문 통계에서 빠집니다.' : '이 브라우저는 설정을 저장할 수 없어 빼지 못했습니다. (비공개 창인지 확인)'); }); }
    if (sq === '0') { lsSet('gs_staff', null); document.addEventListener('DOMContentLoaded', function () { note('이 기기(브라우저)를 다시 방문 통계에 넣습니다.'); }); }
    var staff = lsGet('gs_staff') === '1' || sq === '1';
    if (!staff && !navigator.webdriver) {
      var now = Date.now(), first = 0, prev = null;
      try { prev = JSON.parse(lsGet('gs_v') || 'null'); } catch (e) {}
      if (prev && prev.id && now - prev.t < VISIT_GAP) vid = prev.id;
      else { vid = (Math.random().toString(36).slice(2) + now.toString(36)).slice(0, 20); first = 1; }
      if (!lsSet('gs_v', JSON.stringify({ id: vid, t: now }))) { vid = ''; } // 저장이 안 되는 브라우저는 방문 1건 기록 없이 합계만
      var hitData = JSON.stringify({ p: location.pathname + location.search, r: document.referrer, v: vid, f: first });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/hit', new Blob([hitData], { type: 'text/plain' }));
      else fetch('/api/hit', { method: 'POST', body: hitData, keepalive: true });
    }
  } catch (e) {}

  // 1) 어디서 들어왔는지 세션에 기억 (main.js가 주소의 ?… 를 지우기 전에 실행됨)
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
    // 문의를 이 방문 기록에 연결하기 위한 방문번호
    vid: function () { return vid; },
    // 견적문의 접수가 성공했을 때 한 번 호출 → 광고 '전환'으로 집계
    lead: function () {
      try { if (NAVER_WA && window.wcs && window.wcs.trans) window.wcs.trans({ type: 'lead' }); } catch (e) {}
      try { if (KAKAO_PIXEL && window.kakaoPixel) window.kakaoPixel(KAKAO_PIXEL).participation(); } catch (e) {}
    },
  };
})();
