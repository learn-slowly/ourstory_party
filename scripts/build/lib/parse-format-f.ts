// scripts/build/lib/parse-format-f.ts
// 형식 F — row[0] header / row[1] 후보자명 / row[2+] data (2017 19대 대선 등).
// 시·도/시·군·구 carry-forward 필요 (전국·합계·관외사전 등 row 에 sido 빈 셀).
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
};

const PARTY_NAME_BLOCKLIST = new Set([
  "계",
  "합계",
  "소계",
  "무효투표수",
  "기권수",
  "기권자수",
  "선거인수",
  "투표수",
  "후보자별 득표수",
  "정당별 득표수",
]);

export function parseFormatF(filePath: string): ParsedElection {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid: string[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    raw: false,
  });

  // row[0] header — 시도명·구시군명·읍면동명·투표구명·선거인수·투표수·후보자별 득표수(colspan)·무효투표수·기권수
  const header = (grid[0] ?? []).map((c) =>
    (c ?? "").toString().trim().replace(/\s+/g, ""),
  );
  const idxSido = header.findIndex((c) => c === "시도" || c === "시도명");
  const idxSigungu = header.findIndex(
    (c) => c === "구시군" || c === "구시군명",
  );
  const idxEmd = header.findIndex((c) => c === "읍면동명");
  const idxStation = header.findIndex((c) => c === "투표구명");
  const idxVoters = header.indexOf("선거인수");
  const idxVotes = header.indexOf("투표수");
  const idxInvalid = header.findIndex(
    (c) => c === "무효투표수" || c === "무효" || c === "무효투표수합계",
  );
  if (idxSido < 0 || idxVoters < 0 || idxVotes < 0 || idxInvalid < 0) {
    throw new Error(
      `형식 F header 미인식 — row[0]: ${header.slice(0, 24).join("|")}`,
    );
  }

  // row[1] candidate names — column idxVotes+1 ~ idxInvalid-1
  // 끝에 "계" 컬럼이 있을 수 있어 blocklist 로 거른다.
  const partyStartCol = idxVotes + 1;
  const partyEndCol = idxInvalid; // exclusive
  const partyNames: string[] = [];
  const partyCols: number[] = [];
  for (let c = partyStartCol; c < partyEndCol; c++) {
    const cell = ((grid[1] ?? [])[c] ?? "").toString().trim();
    if (cell && !PARTY_NAME_BLOCKLIST.has(cell)) {
      partyNames.push(cell);
      partyCols.push(c);
    }
  }

  const rows: ParsedStationRow[] = [];
  let currentSido = "";
  let currentSigungu = "";
  let currentEmd: string | null = null;

  for (let r = 2; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (row.every((c) => !((c ?? "").toString().trim()))) continue;

    const sidoCell = (row[idxSido] ?? "").toString().trim();
    const sigCell = (row[idxSigungu] ?? "").toString().trim();
    if (sidoCell) currentSido = sidoCell;
    if (sigCell) currentSigungu = sigCell;

    const emdCell = (row[idxEmd] ?? "").toString().trim();
    const stationCell = (row[idxStation] ?? "").toString().trim();

    let kind: RowKind | undefined;
    let emdName: string | null = currentEmd;
    let displayName: string | null = stationCell || null;

    if (META_KINDS[emdCell] && !stationCell) {
      kind = META_KINDS[emdCell];
      displayName = emdCell;
      emdName = null;
    } else if (emdCell && stationCell === "소계") {
      kind = "subtotal";
      emdName = emdCell;
      currentEmd = emdCell;
    } else if (META_KINDS[stationCell]) {
      kind = META_KINDS[stationCell];
      if (emdCell) {
        emdName = emdCell;
        currentEmd = emdCell;
      }
    } else if (stationCell) {
      kind = "el_day";
      if (emdCell) {
        emdName = emdCell;
        currentEmd = emdCell;
      }
    } else if (sigCell && !emdCell) {
      // 시·군·구 합계 (예: 서울특별시 합계) — sigCell="합계"
      const tag = META_KINDS[sigCell];
      if (tag) {
        kind = tag;
        displayName = sigCell;
        emdName = null;
      } else continue;
    } else continue;

    const num = (c: unknown) =>
      Number(((c ?? "").toString()).replace(/,/g, "")) || 0;
    const parties = partyNames.map((n, i) => ({
      rawName: n,
      votes: num(row[partyCols[i]]),
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
