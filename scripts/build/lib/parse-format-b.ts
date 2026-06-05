// scripts/build/lib/parse-format-b.ts
// 형식 B — 2020 · 2016 NEC 다운로드 xlsx
// 한 파일 = 한 시·군·구 (또는 선거구).
// row[0] = "개표상황(투표구별)" (제목)
// row[1] = blank
// row[2] = "[국회의원선거][전라남도][영암군무안군신안군][영암군]" 등 메타 (괄호 3~4개)
// row[3] = 컬럼 header (읍면동명·투표구명·선거인수·투표수·후보자별 득표수·…·계·무효투표수·기권수)
// row[4] = 후보자/정당명 (col idxVotes+1 ~)
// row[5+] = 데이터. 한 시·군·구만 등장 → emd 단위로 carry-forward.
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
  "국외부재자투표(공관)": "overseas",
};

const PARTY_NAME_BLOCKLIST = new Set([
  "계",
  "합계",
  "소계",
  "무효투표수",
  "기권수",
  "선거인수",
  "투표수",
]);

interface OptsB {
  isProportional: boolean;
}

function extractRegionFromMeta(metaText: string): {
  sido: string;
  sigungu: string;
} {
  // 예: "[국회의원선거][전라남도][영암군무안군신안군][영암군]"
  //     또는 "[비례대표국회의원선거][전라남도][영광군]"
  // 첫 그룹 = 선거 종류, 시·도 = 두 번째, 시·군·구 = 마지막 그룹.
  const matches = [...metaText.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
  const sido = matches[1] ?? "";
  const sigungu = (matches[3] ?? matches[2] ?? "").trim();
  return { sido, sigungu };
}

export function parseFormatB(filePath: string, opts: OptsB): ParsedElection {
  void opts; // 현재는 옵션 사용 안 함 (header 패턴이 비례·지역구 동일)
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid: string[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    raw: false,
  });

  const metaText = (grid[2]?.[0] ?? "").toString();
  const { sido, sigungu } = extractRegionFromMeta(metaText);

  const header = (grid[3] ?? []).map((c) => (c ?? "").toString().trim());
  const idxVoters = header.indexOf("선거인수");
  const idxVotes = header.indexOf("투표수");
  const idxInvalid = header.findIndex((c) =>
    c.replace(/\n/g, "").includes("무효"),
  );
  if (idxVoters < 0 || idxVotes < 0 || idxInvalid < 0) {
    throw new Error(
      `형식 B header 미인식 — row[3]: ${header.slice(0, 12).join("|")}`,
    );
  }

  const partyStartCol = idxVotes + 1;
  const partyEndCol = idxInvalid; // exclusive — 마지막 직전이 "계" 컬럼
  const partyNames = (grid[4] ?? [])
    .slice(partyStartCol, partyEndCol)
    .map((c) => (c ?? "").toString().trim())
    .filter((c) => c && !PARTY_NAME_BLOCKLIST.has(c));

  const rows: ParsedStationRow[] = [];
  let currentEmd: string | null = null;

  for (let r = 5; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (row.every((c) => !(c ?? "").toString().trim())) continue;

    const emdCell = (row[0] ?? "").toString().trim();
    const stationCell = (row[1] ?? "").toString().trim();

    let kind: RowKind | undefined;
    let emdName: string | null = currentEmd;
    let displayName: string | null = stationCell || null;

    if (META_KINDS[emdCell] && !stationCell) {
      // top-level 메타 (합계 · 거소·선상 · 관외사전 · 국외부재자 …)
      kind = META_KINDS[emdCell];
      displayName = emdCell;
      emdName = null;
    } else if (emdCell && stationCell === "소계") {
      kind = "subtotal";
      emdName = emdCell;
      currentEmd = emdCell;
    } else if (META_KINDS[stationCell]) {
      // 읍면동 내 메타 (관내사전 등)
      kind = META_KINDS[stationCell];
      if (emdCell) {
        emdName = emdCell;
        currentEmd = emdCell;
      }
    } else if (stationCell) {
      // 실제 투표소 row
      kind = "el_day";
      if (emdCell) {
        emdName = emdCell;
        currentEmd = emdCell;
      }
    } else {
      continue;
    }

    const num = (c: unknown) =>
      Number(((c ?? "").toString()).replace(/,/g, "")) || 0;
    const parties = partyNames.map((n, i) => ({
      rawName: n,
      votes: num(row[partyStartCol + i]),
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
