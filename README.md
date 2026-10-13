# 거산리프트 홈페이지

화물용 리프트(F/L)·테이블리프트 전문 기업 거산리프트의 홈페이지입니다.

- `public/` 사이트 파일 (이 폴더가 그대로 배포됨)
- `public/index.html` 메인 페이지
- `public/privacy.html` 개인정보처리방침
- `public/assets/style.css`, `public/assets/main.js` 디자인·동작
- `public/assets/img/` 웹용으로 압축한 사진(WebP)과 로고

Cloudflare에 연결되어 있어 `main` 브랜치에 올라간 내용이 자동으로 사이트에 반영됩니다.
- `wrangler.jsonc` Cloudflare 배포 설정
- `src/` 서버 코드 (문의 접수 `contact.js`, 관리자 기능 `admin.js`)
- `public/admin/` 관리자 화면 (주소 끝에 /admin)

### Cloudflare에 넣어야 하는 비밀값 (Settings → Variables and secrets, Type: Secret)
- `RESEND_API_KEY` 문의 알림 메일 발송용
- `ADMIN_PASSWORD` 관리자 화면 비밀번호
