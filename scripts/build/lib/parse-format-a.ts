// scripts/build/lib/parse-format-a.ts
// 형식 A — 2024 · 2025 통합 NEC 다운로드 xlsx
// row[0] = "개표단위별 개표결과" (제목)
// row[1] = blank
// row[2] = "[국회의원선거][전체]" 등 카테고리
// row[3] = 컬럼 header (시도명·선거구명·구시군명·읍면동명·투표타입·선거인수·투표수·후보자별 득표수·…·계·무효투표수·기권수)
// row[4] = 첫 선거구의 시·도/시·군·구 + 후보자/정당명 (col 7+)
// row[5+] = 데이터. 새 선거구 시작 시 시·도/시·군·구가 다시 채워짐 (carry-forward).
import * as XLSX from "xlsx";
import { ParsedElection, ParsedStationRow, RowKind } from "./types";

const META_KINDS: Record<string, RowKind> = {
  합계: "total",
  소계: "subtotal",
  계: "subtotal",
  "거소·선상투표": "absentee",
  거소투표: "absentee",
  관외사전투표: "abs",
  관내사전투표: "presub",
  재외투표: "overseas",
  재외국민투표: "overseas",
  국외부재자투표: "overseas",
  "잘못 투입·구분된 투표지": "misc",
  "잘못 투입ㆍ구분된 투표지": "misc",
};

interface OptsA {
  isProportional: boolean;
}

export function parseFormatA(filePath: string, opts: OptsA): ParsedElection {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid: string[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    raw: false,
  });

  const header = (grid[3] ?? []).map((c) => (c ?? "").toString().trim());
  const idxVoters = header.indexOf("선거인수");
  const idxVotes = header.indexOf("투표수");
  const idxInvalid = header.findIndex((c) =>
    c.replace(/\n/g, "").includes("무효"),
  );
  if (idxVoters < 0 || idxVotes < 0 || idxInvalid < 0) {
    throw new Error(
      `형식 A header 미인식 — row[3]: ${header.slice(0, 12).join("|")}`,
    );
  }

  // 후보자/정당명 = row[4] 의 idxVotes+1 ~ idxInvalid-1 (마지막은 "계" 컬럼이므로 제외)
  const partyStartCol = idxVotes + 1;
  const partyEndCol = idxInvalid; // exclusive
  const PARTY_NAME_BLOCKLIST = new Set(["계", "합계", "소계", "무효투표수", "기권수", "선거인수", "투표수"]);
  const partyNamesRaw = (grid[4] ?? []).slice(partyStartCol, partyEndCol);
  const partyNames = partyNamesRaw
    .map((c) => (c ?? "").toString().trim())
    .filter((c) => c && !PARTY_NAME_BLOCKLIST.has(c));

  // region 컬럼 위치 (지역구 vs 비례)
  const cols = opts.isProportional
    ? { sido: 0, sigungu: 1, emd: 2, station: 3 }
    : { sido: 0, district: 1, sigungu: 2, emd: 3, station: 4 };

  const rows: ParsedStationRow[] = [];
  let currentSido = "";
  let currentSigungu = "";
  let currentEmd: string | null = null;

  // 데이터 시작: row[4] 부터 (첫 선거구는 row[4] 에 region + candidate 동시 등장).
  // row[4] 자체는 candidate 명만 있을 뿐 표수 데이터는 없으므로 carry-forward 만 적용 후 skip.
  for (let r = 4; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (row.every((c) => !(c ?? "").toString().trim())) continue;

    const sidoCell = (row[cols.sido] ?? "").toString().trim();
    const sigCell = (row[cols.sigungu] ?? "").toString().trim();
    if (sidoCell) currentSido = sidoCell;
    if (sigCell) currentSigungu = sigCell;

    const emdCell = (row[cols.emd] ?? "").toString().trim();
    const stationCell = (row[cols.station] ?? "").toString().trim();

    let kind: RowKind | undefined;
    let emdName: string | null = currentEmd;
    let displayName: string | null = stationCell || null;

    if (META_KINDS[emdCell] && !stationCell) {
      // top-level 메타 (합계 · 거소·선상 · 관외사전 · 국외부재자 · 잘못투입)
      kind = META_KINDS[emdCell];
      displayName = emdCell;
      emdName = null;
    } else if (META_KINDS[stationCell]) {
      // 읍면동 내 메타 (소계 · 관내사전)
      kind = META_KINDS[stationCell];
      if (emdCell) {
        emdName = emdCell;
        currentEmd = emdCell;
      }
    } else if (emdCell && stationCell === "소계") {
      kind = "subtotal";
      emdName = emdCell;
      currentEmd = emdCell;
    } else if (stationCell) {
      // 실제 투표소 row
      kind = "el_day";
      if (emdCell) {
        emdName = emdCell;
        currentEmd = emdCell;
      }
    } else {
      // 선거구 시작 row (sido/district/sigungu 만 채워진 candidate 헤더) — carry-forward 만 적용하고 skip.
      continue;
    }

    const num = (c: unknown) =>
      Number(((c ?? "").toString()).replace(/,/g, "")) || 0;
    const parties = partyNames.map((n, i) => ({
      rawName: n,
      votes: num(row[partyStartCol + i]),
    }));

    rows.push({
      sidoName: currentSido,
      sigunguName: currentSigungu,
      emdName,
      stationName: kind === "el_day" ? displayName : null,
      kind,
      totalVoters: num(row[idxVoters]),
      totalVotes: num(row[idxVotes]),
      validVotes: num(row[idxInvalid - 1]),
      invalidVotes: num(row[idxInvalid]),
      parties,
    });
  }

  return { electionId: "", electionDate: "", rows, partyNames };
}
