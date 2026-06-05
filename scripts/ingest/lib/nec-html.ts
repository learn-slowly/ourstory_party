import * as cheerio from "cheerio";

export interface ParsedParty {
  name: string;
  votes: number;
}

export type ParseResult =
  | {
      kind: "ok";
      parties: ParsedParty[];
      totalVoters: number;
      totalVotes: number;
      validVotes: number;
      invalidVotes: number;
    }
  | { kind: "no-data" };

const META_HEADERS = new Set([
  "읍면동명", "투표구명", "구분", "선거인수", "투표수",
  "정당별 득표수", "후보자별 득표수",
  "계", "무효", "무효투표수", "기권자수",
]);

/**
 * info.nec.go.kr VCCP08(최근 선거) 또는 VCCP04(역대) 페이지의 "합계" 행을 파싱.
 *
 * 컬럼 구조: 읍면동명 | 투표구명 | 선거인수 | 투표수 |
 *           [정당/후보별 득표 N개] | 계(유효) | 무효투표수 | 기권자수
 *
 * 헤더가 두 행(rowspan/colspan)으로 나뉘는 경우,
 * 두 번째 행에 실제 후보자명이 있고 "계" 컬럼도 같이 있음.
 */
export function parseVccpAggregate(html: string): ParseResult {
  const $ = cheerio.load(html);

  // 빈 응답 감지
  const firstBodyRow = $("table#table01 tbody tr").first();
  if (!firstBodyRow.length) return { kind: "no-data" };

  const firstCellText = firstBodyRow.find("td").first().text().trim();
  if (firstCellText.includes("검색된 결과가 없습니다")) {
    return { kind: "no-data" };
  }
  if (firstCellText !== "합계") return { kind: "no-data" };

  // 정당/후보자명 수집 — 헤더 전체 th에서 메타 컬럼 제외
  // NEC 실제 페이지는 thead에 tr이 2개: 첫 번째에 rowspan 컬럼, 두 번째에 후보자명+계
  // 메타 헤더 셋으로 필터링하면 후보자명만 남음
  const partyNames: string[] = [];
  $("table#table01 thead th").each((_, th) => {
    // cheerio는 br을 공백 없이 연결하므로 "더불어민주당이재명" 형태가 됨
    const t = $(th).text().trim();
    if (!t || META_HEADERS.has(t)) return;
    partyNames.push(t);
  });

  if (partyNames.length === 0) return { kind: "no-data" };

  // 합계 행 셀값
  const cells = firstBodyRow
    .find("td")
    .map((_, td) => $(td).text().trim().replace(/,/g, ""))
    .get();

  // 셀 구조: [읍면동명(0), 투표구명(1), 선거인수(2), 투표수(3), ...정당 N개, 계, 무효, 기권]
  if (cells.length < 4 + partyNames.length + 3) return { kind: "no-data" };

  const totalVoters = Number(cells[2]) || 0;
  const totalVotes = Number(cells[3]) || 0;
  const partyCells = cells.slice(4, 4 + partyNames.length);
  const tailStart = 4 + partyNames.length;
  const validVotes = Number(cells[tailStart]) || 0;
  const invalidVotes = Number(cells[tailStart + 1]) || 0;

  return {
    kind: "ok",
    parties: partyNames.map((name, i) => ({ name, votes: Number(partyCells[i]) || 0 })),
    totalVoters,
    totalVotes,
    validVotes,
    invalidVotes,
  };
}

// ─── 투표소(투표구) 행 파서 ────────────────────────────────────────────────

// row 분류용 — c0 또는 c1 텍스트 → kind
// VCCP08: top-level 은 c0 에, emd 하위 메타는 c1 에 들어옴
// VCCP04: top-level 은 c0(c1=''), emd 하위 메타는 c1(c0=emdName)
const META_LABELS = new Map<string, ParsedStationRow["kind"]>([
  // 관내사전투표 — VCCP08 emd 하위(c1), VCCP04 emd 하위(c1)
  ["관내사전투표", "presub"],
  // 관외사전투표 — VCCP08/VCCP04 top-level(c0)
  ["관외사전투표", "abs"],
  // 거소·선상투표 변형들 — VCCP08 top-level(c0)
  ["거소·선상투표", "absentee"],
  ["거소ㆍ선상투표", "absentee"],
  // 거소투표 — VCCP04 top-level(c0, 역대 선거 일부)
  ["거소투표", "absentee"],
  // 재외투표 — VCCP08 top-level(c0)
  ["재외투표", "overseas"],
  ["재외국민투표", "overseas"],
  // 국외부재자투표 — VCCP04 일부
  ["국외부재자투표", "overseas"],
  // 잘못 투입·구분된 투표지
  ["잘못 투입·구분된 투표지", "misc"],
  ["잘못 투입ㆍ구분된 투표지", "misc"],
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// cheerio v1 의 `cheerio.CheerioAPI` 타입은 내부 제네릭이 복잡해 컴파일 에러가 잦음 → 헬퍼 한 곳에서만 any 허용.
// 이 함수의 로직은 위 parseVccpAggregate 인라인 thead 파싱과 동일 — META_HEADERS 갱신 시 두 곳 모두 갱신 필요.
function extractPartyNames($: any): string[] {
  const partyNames: string[] = [];
  $("table#table01 thead th").each((_: number, th: unknown) => {
    const t = $(th).text().trim();
    if (!t || META_HEADERS.has(t)) return;
    partyNames.push(t);
  });
  return partyNames;
}

/**
 * NEC VCCP08(최근 선거) / VCCP04(역대 선거) 페이지의 tbody 한 행에 대응.
 * 분류된 종류와 분모·정당별 득표.
 *
 * - kind=station    : 일반 투표구 (예: "문산읍제1투")
 * - kind=presub     : 관내사전투표 (해당 emd 의 사전투표 합)
 * - kind=abs        : 관외사전투표 (top-level, emd 귀속 안 함)
 * - kind=absentee   : 거소·선상투표 (top-level)
 * - kind=overseas   : 재외투표 (top-level)
 * - kind=misc       : 잘못 투입·구분된 투표지 등 기타
 *
 * emdName 은 station/presub 행에 한해 채워짐. 나머지(top-level 메타) 는 null.
 */
export interface ParsedStationRow {
  emdName: string | null;
  name: string;
  kind: "station" | "presub" | "abs" | "absentee" | "overseas" | "misc";
  totalVoters: number;
  totalVotes: number;
  validVotes: number;
  invalidVotes: number;
  parties: ParsedParty[];
}

export type StationsParseResult =
  | { kind: "ok"; rows: ParsedStationRow[]; partyNames: string[] }
  | { kind: "no-data" };

/**
 * VCCP08(최근) / VCCP04(역대) HTML 의 모든 tbody 행을 station/메타 단위로 분해.
 * "합계" 와 emd "소계"/"계" 는 결과에서 제외 (vote_totals 에 이미 있음).
 *
 * VCCP08 구조 (2025 대선 등):
 *   합계행: c0=합계, c1=''
 *   top-level 메타: c0=거소·선상투표 등, c1=''
 *   emd 소계: c0=문산읍, c1=소계  → currentEmd 갱신 후 skip
 *   emd 하위: c0='', c1=관내사전투표|투표소명
 *
 * VCCP04 구조 (2022 지선 등):
 *   합계행: c0=합계, c1=''
 *   top-level 메타: c0=거소투표|관외사전투표 등, c1=''
 *   emd 소계: c0=문산읍, c1=계  → currentEmd 갱신 후 skip
 *   emd 하위: c0=emdName, c1=관내사전투표|선거일투표
 */
export function parseVccp08Stations(html: string): StationsParseResult {
  const $ = cheerio.load(html);

  // 빈 응답 감지 — tbody 없거나 "검색된 결과가 없습니다"
  const firstBodyRow = $("table#table01 tbody tr").first();
  if (!firstBodyRow.length) return { kind: "no-data" };
  const firstCellText = firstBodyRow.find("td").first().text().trim();
  if (firstCellText.includes("검색된 결과가 없습니다")) {
    return { kind: "no-data" };
  }

  const partyNames = extractPartyNames($);
  if (partyNames.length === 0) return { kind: "no-data" };

  const rows: ParsedStationRow[] = [];
  let currentEmd: string | null = null;

  // 예상 최소 셀 수: c0 + c1 + 선거인수 + 투표수 + [정당 N] + 계 + 무효 + 기권
  // VCCP04 일부 지역구 파일은 선거구명 열이 추가되어 컬럼 수가 다를 수 있으므로
  // tail(계·무효·기권) 은 뒤에서부터 찾음
  const minCols = 2 + 2 + partyNames.length + 3;

  const num = (s: string) => Number(s.replace(/,/g, "")) || 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("table#table01 tbody tr").each((_: number, tr: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cells = $(tr).find("td").map((_i: number, td: any) => $(td).text().trim()).get() as string[];

    if (cells.length < minCols) return;

    // VCCP04 중 선거구명 열이 추가된 경우: 첫 셀이 선거구명이고 두 번째가 읍면동명,
    // 세 번째가 구분("합계"/"계" 등)이 되어 컬럼 오프셋이 +1.
    // 단순 휴리스틱: cells[0]이 메타레이블도, emd 이름도 아닌 "시·군구 명"이면 offset 적용.
    // 여기서는 일반 구조(offset=0)와 선거구명 포함 구조(offset=1)를 탐지.
    let offset = 0;
    // 선거구명 열 감지: cells[1] 이 emd 이름 혹은 메타레이블이고 cells[0] 이 별개 텍스트
    // 간단히: cells[1]이 비어있지 않고 cells[2]가 숫자이면 일반 구조,
    //         cells[1]이 비어있지 않고 cells[2]가 숫자가 아니면 선거구명 포함 구조
    if (cells[1] && isNaN(Number(cells[2].replace(/,/g, ""))) && cells[2]) {
      offset = 1;
    }

    const c0 = cells[offset];       // 읍면동명 / top-level 메타 / "합계"
    const c1 = cells[offset + 1];   // "소계"/"계" / 구분 / 투표소명 / 빈 문자
    const votersIdx = offset + 2;
    const votesIdx = offset + 3;
    const partyStartIdx = offset + 4;

    if (cells.length < partyStartIdx + partyNames.length + 3) return;

    // "합계" 행은 vote_totals 와 중복이므로 제외
    if (c0 === "합계") return;

    // emd 블록 시작 감지 — c0 가 emd 이름, c1 이 "소계"(VCCP08) 또는 "계"(VCCP04)
    if (c0 && (c1 === "소계" || c1 === "계")) {
      currentEmd = c0;
      return; // 소계/계 자체는 저장 안 함
    }

    // row 분류
    let kind: ParsedStationRow["kind"] | undefined;
    let emdName: string | null;
    let displayName: string;

    const topMeta = META_LABELS.get(c0);        // VCCP08/VCCP04 top-level 메타
    const emdMeta = c1 ? META_LABELS.get(c1) : undefined;  // emd 하위 메타(c1)

    if (topMeta && !c1) {
      // top-level 메타 행: c0 에 레이블, c1 이 비어있음
      kind = topMeta;
      emdName = null;
      displayName = c0;
    } else if (c0 && emdMeta) {
      // VCCP04 스타일: c0=emdName, c1=관내사전투표 등
      kind = emdMeta;
      emdName = c0;
      displayName = c1;
      currentEmd = c0; // VCCP04 는 emd 이름이 반복됨
    } else if (!c0 && c1 && emdMeta) {
      // VCCP08 스타일: c0='', c1=관내사전투표 (emd 하위 presub)
      kind = emdMeta;
      emdName = currentEmd;
      displayName = c1;
    } else if (!c0 && c1 && !emdMeta) {
      // VCCP08 스타일 station: c0='', c1=투표소명
      kind = "station";
      emdName = currentEmd;
      displayName = c1;
    } else if (c0 && c1 && !topMeta && !emdMeta) {
      // VCCP04 스타일 station: c0=emdName, c1=선거일투표 등 (메타 아닌 투표 행)
      kind = "station";
      emdName = c0;
      displayName = c1;
      currentEmd = c0; // VCCP04 는 emd 이름이 반복됨
    } else {
      // 분류 불가 — skip
      return;
    }

    const tailStart = partyStartIdx + partyNames.length;
    rows.push({
      emdName,
      name: displayName,
      kind,
      totalVoters: num(cells[votersIdx]),
      totalVotes: num(cells[votesIdx]),
      validVotes: num(cells[tailStart]),
      invalidVotes: num(cells[tailStart + 1]),
      parties: partyNames.map((name, i) => ({
        name,
        votes: num(cells[partyStartIdx + i]),
      })),
    });
  });

  if (rows.length === 0) return { kind: "no-data" };
  return { kind: "ok", rows, partyNames };
}
