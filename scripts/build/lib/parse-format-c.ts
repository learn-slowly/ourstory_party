// scripts/build/lib/parse-format-c.ts
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
  국외부재자투표: "overseas",
};

const META_HEADER_BLOCKLIST = new Set([
  "계",
  "합계",
  "소계",
  "무효투표수",
  "기권수",
  "기권자수",
  "선거인수",
  "투표수",
  "시도",
  "시도명",
  "구시군",
  "구시군명",
  "읍면동명",
  "투표구명",
  "후보자별 득표수",
  "정당별 득표수",
]);

export function parseFormatC(filePath: string): ParsedElection {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid: string[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    raw: false,
  });

  const header = (grid[0] ?? []).map((c) =>
    (c ?? "").toString().trim().replace("\n", ""),
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
    (c) => c === "무효투표수" || c === "무효" || c === "무효 투표수",
  );
  if (idxVoters < 0 || idxVotes < 0 || idxInvalid < 0) {
    throw new Error(
      `형식 C header 미인식 — row[0]: ${header.slice(0, 20).join("|")}`,
    );
  }

  // 후보자명 = idxVotes+1 ~ idxInvalid-1, META blocklist 제외
  const partyNames: string[] = [];
  const partyCols: number[] = [];
  for (let c = idxVotes + 1; c < idxInvalid; c++) {
    const cell = (grid[0]?.[c] ?? "").toString().trim();
    if (cell && !META_HEADER_BLOCKLIST.has(cell)) {
      partyNames.push(cell);
      partyCols.push(c);
    }
  }

  const rows: ParsedStationRow[] = [];
  let currentEmd: string | null = null;

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (row.every((c) => !((c ?? "").toString().trim()))) continue;

    const sido = (row[idxSido] ?? "").toString().trim();
    const sigungu = (row[idxSigungu] ?? "").toString().trim();
    const emdCell = (row[idxEmd] ?? "").toString().trim();
    const stationCell = (row[idxStation] ?? "").toString().trim();
    if (!sido) continue;

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
    } else continue;

    const num = (c: unknown) =>
      Number(((c ?? "").toString()).replace(/,/g, "")) || 0;
    const parties = partyNames.map((n, i) => ({
      rawName: n,
      votes: num(row[partyCols[i]]),
    }));
    rows.push({
      sidoName: sido,
      sigunguName: sigungu,
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
