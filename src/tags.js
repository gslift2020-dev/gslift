// 설치사례 꼬리표 (홈페이지 '상황별로 찾기')
// - 꼬리표 목록은 이 파일 한 곳에서만 정함 → 홈페이지·관리자 화면·가져오기가 모두 이것을 씀
// - DB에는 cases.tags 칸에 ",in,mesh,swing," 처럼 저장 (앞뒤 쉼표로 LIKE '%,mesh,%' 검색)
// - tags 가 NULL 이면 '아직 안 붙임' → 제목·현장·설명 글로 자동으로 붙임 (inferTags)
//   빈 값(",")은 '일부러 하나도 안 붙임'이라 자동으로 다시 채우지 않음
// - 꼬리표를 새로 만들거나 이름을 바꾸면: 아래 목록 + 운영노트 '설치사례 꼬리표 규칙'을 같이 고친다
//   (키는 한 번 정하면 바꾸지 않음 — 이미 저장된 글이 그 키를 쓰고 있음)

export const TAG_GROUPS = [
  { id: 'loc', name: '설치 위치', tags: [
    { k: 'in', n: '실내 설치' },
    { k: 'ext', n: '외부 설치' },
    { k: 'roof', n: '옥상 연결' },
    { k: 'overseas', n: '해외 현장' },
  ] },
  { id: 'shaft', name: '승강로', tags: [
    { k: 'mesh', n: '철망(메쉬) 승강로' },
    { k: 'panel', n: '외장 패널 마감' },
    { k: 'steel', n: '철골 승강로' },
  ] },
  { id: 'door', name: '출입문', tags: [
    { k: 'shutter', n: '셔터' },
    { k: 'swing', n: '양개 도어' },
    { k: 'auto', n: '자동 도어' },
    { k: 'glass', n: '투시창 도어' },
  ] },
  { id: 'floor', name: '층 구성', tags: [
    { k: 'mezz', n: '2개 층·복층·메자닌' },
    { k: 'multi', n: '3개 층 이상·고층' },
  ] },
  { id: 'place', name: '현장 종류', tags: [
    { k: 'factory', n: '공장' },
    { k: 'logis', n: '물류센터·창고' },
    { k: 'food', n: '식품 공장·식당' },
    { k: 'shop', n: '매장·상가·호텔' },
  ] },
  { id: 'extra', name: '추가 사항', tags: [
    { k: 'ramp', n: '진입판·경사판' },
    { k: 'canopy', n: '캐노피(비가림)' },
    { k: 'rail', n: '안전 난간' },
    { k: 'twin', n: '2대 이상 설치' },
    { k: 'small', n: '소형·좁은 공간' },
    { k: 'large', n: '대형' },
    { k: 'pit', n: '바닥 매립형' },
    { k: 'low', n: '저상형' },
  ] },
  { id: 'work', name: '작업 종류', tags: [
    { k: 'repair', n: '보수·교체·안전장치' },
  ] },
];

export const TAGS = {};
for (const g of TAG_GROUPS) for (const t of g.tags) TAGS[t.k] = t.n;

// 받은 값(배열 또는 "a,b" 글자)에서 아는 꼬리표만 남김, 목록 순서대로
export function normTags(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(',');
  const set = new Set(arr.map((x) => String(x).trim()).filter((x) => TAGS[x]));
  return Object.keys(TAGS).filter((k) => set.has(k));
}
export function packTags(list) {
  const t = normTags(list);
  return t.length ? ',' + t.join(',') + ',' : ',';
}
export const unpackTags = (s) => normTags(String(s || ''));

// 글로 꼬리표 추측 (예전 글·꼬리표 없이 들어온 가져오기용). 사람이 고른 꼬리표가 언제나 우선.
const RULES = [
  ['ext', /외부|외벽|바깥/],
  ['roof', /옥상/],
  ['overseas', /해외|과테말라|베트남|중국|인도네시아|필리핀/],
  ['mesh', /철망|메쉬|메시/],
  ['panel', /외장 ?패널|외장재/],
  ['steel', /철골/],
  ['shutter', /셔터/],
  ['swing', /양개|스윙|양쪽으로 여는/],
  ['auto', /자동 ?도어/],
  ['glass', /투시창/],
  ['factory', /공장|공정|생산 ?라인|작업동/],
  ['logis', /물류|창고|(?<!블)랙/],
  ['food', /식품|식자재|구내식당|식당/],
  ['shop', /매장|상가|호텔|골프장|업무 ?시설|구내식당/],
  ['ramp', /진입판|경사판/],
  ['canopy', /캐노피/],
  ['rail', /난간/],
  ['twin', /[2-9]대|두 대|세 대|여러 대/],
  ['small', /소형|작게|작은 크기|좁은 공간/],
  ['large', /대형|넓은 카/],
  ['pit', /매립/],
  ['low', /저상/],
  ['repair', /안전장치|교체|보강/],
];
export function inferTags(text, cat) {
  const t = String(text || '');
  const out = RULES.filter(([, re]) => re.test(t)).map(([k]) => k);
  // 층: 3개 층 이상이 먼저, 아니면 2개 층
  if (/[3-9] ?층|[3-9]개 ?층|[3-9]STOP|다층|고층|여러 층|층마다|각 층|층별|옥상/i.test(t)) out.push('multi');
  else if (/복층|메자닌|중이층|위층|2층|2STOP|상부 작업장|바닥층/i.test(t)) out.push('mezz');
  // 실내: 글에 '실내·안'이 있거나, 화물용 리프트인데 외부라는 말이 없을 때
  if (/실내|안에 설치|공장 안|창고 안|건물 안에/.test(t) || (cat === 'fl' && !out.includes('ext') && !out.includes('repair'))) out.push('in');
  return normTags(out);
}
