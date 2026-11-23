# 시험 스크립트 보관 (2026-11-23, 홈페이지담당 대화에서 옮김)

main에는 넣지 않은 보관용 가지입니다. 실제 사이트 비밀번호·열쇠는 없습니다(시험 서버용 가짜 값만: `testpass123`, `test-secret-123`).

- 시험 서버: `npx wrangler dev --local --port 8787 --persist-to <상태폴더> --env-file <dev.vars>`
  - dev.vars 예: `ADMIN_PASSWORD=testpass123` (+ 업무앱 시험은 `erp/dev_erp.vars`)
  - 실제 사례로 시험하려면 실제 D1 사본을 상태 폴더에 넣어야 함(사본은 저장소에 올리지 않음)
- `ct/run.py` 견적 문의 40가지 · `ct/ad.py` 관리자 46가지(새 상태 폴더 필요)
- `erp/mock.mjs` 업무앱 흉내 받는 곳(8799, 열쇠 test-secret-123) · `erp/t.py` 보내기 11 · `erp/st.py` 상태 받기 18
- `rv/revisit.py` 재방문 28 · `seo/t.py` 상세 페이지 서버 그리기
- `sim/t.py` 사례 화면 39(비슷한 사례·아래 줄) · `sim/list.py` 목록 27 · `sim/bar.py` 넘겨 보기 막대
- 파일 안의 경로(`/tmp/claude-0/...scratchpad`)는 옛 작업 공간 경로 — 새로 쓸 때 바꿔야 함
