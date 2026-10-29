/* 광고 전환 추적 (네이버·카카오) + 광고 유입 경로 기억
   - 키가 비어 있으면 광고 추적 코드는 아무것도 하지 않음 (유입 경로 기억만 동작)
   - 키는 홈페이지 소스에 원래 공개되는 값이라 저장소에 넣어도 됨
   - 데이터베이스(D1)를 전혀 읽지 않음
   - 키를 넣기 전에 네이버가 메일로 보내는 '설치 가이드'의 문법과 아래 코드가 같은지 확인할 것 */
(function () {
  var NAVER_WA = '';    // 네이버 전환추적 공통키 (s_로 시작) — gslift.kr로 새로 발급받은 값
  var KAKAO_PIXEL = ''; // 카카오 픽셀 ID (숫자)
  var DOMAIN = 'gslift.kr';

  // 1) 어디서 들어왔는지 세션에 기억 (main.js가 주소의 ?… 를 지우기 전에 실행됨)
  try {
    if (!sessionStorage.getItem('gs_src')) {
      var q = new URLSearchParams(location.search);
      var src = q.get('utm_source') || (q.get('n_media') ? 'naver' : '');
      if (!src && document.referrer) {
        var h = new URL(document.referrer).hostname.replace(/^www\./, '');
        if (h !== location.hostname) src = h;
      }
      if (src) sessionStorage.setItem('gs_src', src.slice(0, 40));
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
    // 견적문의 접수가 성공했을 때 한 번 호출 → 광고 '전환'으로 집계
    lead: function () {
      try { if (NAVER_WA && window.wcs && window.wcs.trans) window.wcs.trans({ type: 'lead' }); } catch (e) {}
      try { if (KAKAO_PIXEL && window.kakaoPixel) window.kakaoPixel(KAKAO_PIXEL).participation(); } catch (e) {}
    },
  };
})();
