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
