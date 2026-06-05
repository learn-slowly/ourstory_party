// NEC 통계시스템 cityCode/townCode 상수 + 동적 조회.
// cityCode: 17 시·도 고정. townCode: 선거 종류·시기 따라 다르므로 동적 조회.

const SELECTBOX_TOWN_URL =
  "http://info.nec.go.kr/bizcommon/selectbox/selectbox_townCodeJson.json";

export interface CityCode {
  code: string; // NEC 4자리
  name: string;
}

// NEC 17 시·도 코드 (info.nec.go.kr 메인 페이지의 cityCode dropdown 기준)
export const CITY_CODES: CityCode[] = [
  { code: "1100", name: "서울특별시" },
  { code: "2600", name: "부산광역시" },
  { code: "2700", name: "대구광역시" },
  { code: "2800", name: "인천광역시" },
  { code: "2900", name: "광주광역시" },
  { code: "3000", name: "대전광역시" },
  { code: "3100", name: "울산광역시" },
  // 주의: NEC 내부 cityCode 는 행안부 법정동코드 시·도 prefix 와 다름.
  // 특히 세종(5100)·강원특자도(5200)·전북특자도(5300)·제주특자도(4900) 는
  // NEC가 별도 코드 부여 (특별자치도 승격·세종 신설로 인한 재할당).
  // 실제 유효성 검증: NEC selectbox_townCodeJson.json endpoint 응답 비교.
  { code: "5100", name: "세종특별자치시" },
  { code: "4100", name: "경기도" },
  { code: "5200", name: "강원특별자치도" },
  { code: "4300", name: "충청북도" },
  { code: "4400", name: "충청남도" },
  { code: "5300", name: "전북특별자치도" },
  { code: "4600", name: "전라남도" },
  { code: "4700", name: "경상북도" },
  { code: "4800", name: "경상남도" },
  { code: "4900", name: "제주특별자치도" },
];

export interface TownCode {
  code: string;
  name: string;
}

/**
 * 한 시·도의 시·군·구 코드 목록 조회. NEC 의 동적 endpoint.
 * 응답 형태: { jsonResult: { body: [{ CODE: "4821", NAME: "창원시의창구" }, ...] } }
 */
export async function fetchTownCodes(
  electionId: string,
  cityCode: string,
): Promise<TownCode[]> {
  const url = `${SELECTBOX_TOWN_URL}?electionId=${electionId}&cityCode=${cityCode}`;
  // NEC 응답 지연 대비 6s 타임아웃 — 본 호출이 hang 되면 전체 fetcher 가 한 시·도에 멈춤
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`townCode HTTP ${res.status}`);
    const json = (await res.json()) as {
      jsonResult?: { body?: Array<{ CODE: string; NAME: string }> };
    };
    const body = json.jsonResult?.body ?? [];
    return body.map((row) => ({ code: row.CODE, name: row.NAME }));
  } finally {
    clearTimeout(t);
  }
}
