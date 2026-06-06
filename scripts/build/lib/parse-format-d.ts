// scripts/build/lib/parse-format-d.ts
// 형식 D — 2012 18대 대선 .xls 전국 단일 파일 (선거구 컬럼 없음)
import * as XLSX from "xlsx";
import { ParsedElection, ParsedStationRow, RowKind } from "./types";

const META_KINDS: Record<string, RowKind> = {
  "합계": "total", "소계": "subtotal", "계": "subtotal",
  "거소·선상투표": "absentee", "거소투표": "absentee",
  "관외사전투표": "abs", "관내사전투표": "presub",
  "재외투표": "overseas", "국외부재자투표": "overseas",
};

const PARTY_NAME_BLOCKLIST = new Set([
  "계", "합계", "소계", "무효투표수", "기권수", "기권자수",
  "선거인수", "투표수", "후보자별 득표수", "정당별 득표수",
]);

export function parseFormatD(filePath: string): ParsedElection {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });

  const header = (grid[3] ?? []).map((c) => (c ?? "").toString().trim().replace(/\s+/g, ""));
  const idxSido = header.indexOf("시도명");
  const idxSigungu = header.indexOf("구시군명");
  const idxEmd = header.indexOf("읍면동명");
  const idxStation = header.indexOf("투표구명");
  const idxVoters = header.indexOf("선거인수");
  const idxVotes = header.indexOf("투표수");
  const idxInvalid = header.findIndex((c) => c.includes("무효"));
  if (idxSido < 0 || idxVoters < 0 || idxVotes < 0 || idxInvalid < 0) {
    throw new Error(`형식 D header 미인식 — row[3]: ${header.slice(0, 12).join("|")}`);
  }

  const partyStartCol = idxVotes + 1;
  const partyEndCol = idxInvalid;
  const partyNames = (grid[4] ?? [])
    .slice(partyStartCol, partyEndCol)
    .map((c) => (c ?? "").toString().trim())
    .filter((c) => c && !PARTY_NAME_BLOCKLIST.has(c));

  const rows: ParsedStationRow[] = [];
  let currentSido = "", currentSigungu = "", currentEmd: string | null = null;

  for (let r = 5; r < grid.length; r++) {
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
      kind = META_KINDS[emdCell]; displayName = emdCell; emdName = null;
    } else if (emdCell && stationCell === "소계") {
      kind = "subtotal"; emdName = emdCell; currentEmd = emdCell;
    } else if (META_KINDS[stationCell]) {
      kind = META_KINDS[stationCell];
      if (emdCell) { emdName = emdCell; currentEmd = emdCell; }
    } else if (stationCell) {
      kind = "el_day";
      if (emdCell) { emdName = emdCell; currentEmd = emdCell; }
    } else continue;

    const num = (c: unknown) => Number(((c ?? "").toString()).replace(/,/g, "")) || 0;
    const parties = partyNames.map((n, i) => ({ rawName: n, votes: num(row[partyStartCol + i]) }));
    rows.push({
      sidoName: currentSido, sigunguName: currentSigungu, emdName,
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
