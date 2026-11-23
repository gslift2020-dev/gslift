# 시험 스크립트 보관 (2026-11-23, 홈페이지담당 대화에서 옮김)

main에는 넣지 않은 보관용 가지입니다. 실제 사이트 비밀번호·열쇠는 없습니다(시험 서버용 가짜 값만: `testpass123`, `test-secret-123`).

- 시험 서버: `npx wrangler dev --local --port 8787 --persist-to <상태폴더> --env-file <dev.vars>`
  - dev.vars 예: `ADMIN_PASSWORD=testpass123` (+ 업무앱 시험은 `erp/dev_erp.vars`)
  - 실제 사례로 시험하려면 실제 D1 사본을 상태 폴더에 넣어야 함(사본은 저장소에 올리지 않음)
- `ct/run.py` 견적 문의 42가지(11-23 출입방향 글·직관통형 S·S2 추가) — 시험 사진 폴더 `CT_DIR`(끝에 /)에 big.jpg(4.5MB 넘는 큰 사진)·a.jpg·b.jpg·p3~p7.jpg·small.png·fake.heic(아무 글)·note.txt 를 만들어 둔다(PIL로 1분). 같은 상태 폴더로 몇 분 안에 다시 돌리면 K2가 도배 막기(「짧은 시간에 문의가 너무 많습니다」)에 걸림 → 새 상태 폴더로 · `ct/ad.py` 관리자 46가지(새 상태 폴더 필요)
- `erp/mock.mjs` 업무앱 흉내 받는 곳(8799, 열쇠 test-secret-123) · `erp/t.py` 보내기 11 · `erp/st.py` 상태 받기 18
- `rv/revisit.py` 재방문 28 · `seo/t.py` 상세 페이지 서버 그리기
- `sim/t.py` 사례 화면 39(비슷한 사례·아래 줄) · `sim/list.py` 목록 27 · `sim/bar.py` 넘겨 보기 막대
- 파일 안의 경로(`/tmp/claude-0/...scratchpad`)는 옛 작업 공간 경로 — 새로 쓸 때 바꿔야 함
