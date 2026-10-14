// 관리자가 바꿀 수 있는 홈페이지 정보: 회사 정보, 자주 묻는 질문, 공지사항
import { clean } from './util.js';

export const DEFAULT_COMPANY = {
  name: '거산리프트',
  ceo: '이재현',
  bizNo: '699-18-01916',
  tel: '031-986-5345',
  fax: '0505-300-6253',
  email: 'gslift2020@naver.com',
  addr: '경기도 김포시 양촌읍 삼도로48번길 37-30',
  addrOld: '경기도 김포시 양촌읍 학운리 1807-3',
  yTel: '010-3871-2559',
  yFax: '051-319-2645',
  yAddr: '부산광역시 사상구 괘법동 578번지',
  greeting: [
    '열정, 성실, 책임감이라는 경영이념 하에 일류제품 생산을 통한 고객만족 실현을 추구하며, 각종 산업 현장의 다양한 요구에 부응하는 최적의 제품을 설계, 제작함으로써 매년 꾸준한 성장을 지속하고 있습니다.',
    '거산 임직원 모두는 그동안의 성과에 만족하지 않고 늘 열정적인 도전정신과 창의적인 사고로 물류 시스템 구축 전문기업으로서의 면모를 부단히 강화해 나갈 것입니다.',
    '앞으로도 최고의 제품을 생산할 것임을 약속드리며 항상 최선을 다하는 기업이 되고자 노력하겠습니다.',
  ].join('\n\n'),
  naverVerify: '',
  googleVerify: '',
};

// 글자 수 제한 (관리자 입력 검사용)
const COMPANY_MAX = { name: 30, ceo: 20, bizNo: 20, tel: 20, fax: 20, email: 60, addr: 100, addrOld: 100, yTel: 20, yFax: 20, yAddr: 100, greeting: 2000, naverVerify: 100, googleVerify: 100 };

export function cleanCompany(v) {
  const out = {};
  for (const k of Object.keys(DEFAULT_COMPANY)) {
    out[k] = clean(v && v[k], COMPANY_MAX[k]);
    if (!out[k] && !/Verify$/.test(k)) out[k] = DEFAULT_COMPANY[k];
  }
  // 인증 코드는 content="..." 안의 값만 받아도 되고 meta 태그 통째로 붙여넣어도 됨
  for (const k of ['naverVerify', 'googleVerify']) {
    const m = out[k].match(/content=["']([^"']+)["']/);
    if (m) out[k] = m[1];
    out[k] = out[k].replace(/[^\w.-]/g, '').slice(0, 100);
  }
  return out;
}

export const DEFAULT_FAQ = [
  { q: '견적은 어떻게 받을 수 있나요?', a: '홈페이지 문의하기에 연락처와 원하시는 사양을 남기시거나 본사(031-986-5345)로 전화 주시면 담당자가 연락드립니다. 설치할 자리 사진을 함께 보내주시면 더 빠르고 정확하게 안내해 드릴 수 있고, 정확한 금액은 현장 실측 후 확정됩니다.' },
  { q: '리프트 가격은 무엇에 따라 달라지나요?', a: '적재하중(톤수), 운행 높이와 정지 층수, 카(운반구) 크기, 출입 방향, 실내·외부 설치 여부, 마감과 문 종류(셔터·스윙도어·자동도어)에 따라 달라집니다. 같은 1톤 리프트라도 현장 조건에 따라 구성이 달라지므로 현장을 확인한 뒤 견적을 드립니다.' },
  { q: '제작과 설치는 얼마나 걸리나요?', a: '사양과 현장 여건에 따라 다릅니다. 김포 공장에서 제작을 마친 뒤 현장에 들어가 설치하며, 계약 시 제작·설치 일정을 구체적으로 안내해 드립니다.' },
  { q: '설치 후 안전검사는 어떻게 하나요?', a: '설치를 마치면 대한산업안전협회의 안전검사를 받고 시운전을 거친 뒤 인도합니다. 방호울, 출입문 인터록, 권과·과부하·낙하 방지장치 등 검사 항목은 설계 단계부터 맞춰 제작합니다.' },
  { q: '기존 호이스트나 오래된 리프트를 교체할 수 있나요?', a: '네. 기존 호이스트나 노후 리프트를 철거하고 새 리프트로 교체하는 공사도 함께 진행합니다.' },
  { q: '건물 밖이나 좁은 공간에도 설치할 수 있나요?', a: '네. 엘리베이터 자리가 없는 건물은 외벽에 붙여 설치하고 판넬로 마감할 수 있습니다. 좁은 실내는 부재를 나눠 들여와 현장에서 조립·용접합니다.' },
  { q: 'A/S는 어디서 받나요?', a: '수도권은 김포 본사, 영남권은 부산 영남사업본부에서 대응합니다. 고장이나 점검이 필요하면 가까운 곳으로 연락 주세요.' },
];

export function cleanFaq(v) {
  if (!Array.isArray(v)) return null;
  return v.slice(0, 30).map((x) => ({ q: clean(x && x.q, 200), a: clean(x && x.a, 2000) })).filter((x) => x.q && x.a);
}

// 설정을 잠깐(30초) 기억해서 페이지를 열 때마다 DB를 읽지 않게 함
let cache = { at: 0, data: null };
export function dropSiteCache() { cache = { at: 0, data: null }; }

export async function siteData(env) {
  if (cache.data && Date.now() - cache.at < 30000) return cache.data;
  const get = async (key) => {
    const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
    if (!r) return null;
    try { return JSON.parse(r.value); } catch { return null; }
  };
  const [company, faq, notices] = await Promise.all([
    get('company'),
    get('faq'),
    env.DB.prepare('SELECT id, created_at, title, body, pinned FROM notices WHERE visible = 1 ORDER BY pinned DESC, id DESC LIMIT 10').all(),
  ]);
  const data = {
    company: { ...DEFAULT_COMPANY, ...(company || {}) },
    faq: Array.isArray(faq) ? faq : null, // null = 기본 질문 그대로
    notices: notices.results || [],
  };
  cache = { at: Date.now(), data };
  return data;
}
