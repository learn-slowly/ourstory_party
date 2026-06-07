// scripts/build/parsers/parse-jiseon-2022.ts
// 2022 8회 지선 읍면동별 개표결과 zip 파서
// 실제 xlsx 구조 기반 (2026-06-07 탐색 결과):
//   row 0: 주요 헤더 (시도명|선거구명, 구시군명, 읍면동명, 구분, 선거인수, 투표수, 후보자별 득표수...)
//   row 1: 서브 헤더 (정당1/정당2... 또는 후보1/후보2...)
//   row 2: 정당명 / 후보명 (형식: "당명\r\n후보명" 또는 정당명만)
//   row 3+: 데이터 행 (구분="소계" → 읍면동 집계, "합계" → 시군구 합계)
//
// 파일별 컬럼 레이아웃:
//   Layout A (emd=2, gubun=3, voteStart=6): 광역비례의원선거.xlsx, 교육감선거.xlsx, 시도지사선거.xlsx
//   Layout B (emd=3, gubun=4, voteStart=7): 구시군의원선거.xlsx, 구시군장선거.xlsx, 시도의원선거.xlsx, 교육의원선거.xlsx, 기초비례의원선거.xlsx
//   Layout C (emd=3, gubun=4, voteStart=7, sigungu=2): 국회의원선거.xlsx (시도=0, 선거구=1, 시군구=2)

import AdmZip from "adm-zip";
import * as XLSX from "xlsx";
import iconv from "iconv-lite";
import type { JiseonRow, JiseonOutput } from "./jiseon-2022-types";

const DATE = "2022-06-01";

// 파일명 → election 메타 (실제 zip 내 파일명 기준)
const FILE_TO_ELECTION: Record<
  string,
  { id: string; name: string; type: string; layout: "A" | "B" | "C" | "SKIP" }
> = {
  "시도지사선거.xlsx": {
    id: "2022-local-governor",
    name: "제8회 지방선거 — 시·도지사",
    type: "governor",
    layout: "A",
  },
  "광역비례의원선거.xlsx": {
    id: "2022-local-council-prop",
    name: "제8회 지방선거 — 시·도의원 비례",
    type: "local_council_prop",
    layout: "A",
  },
  "시도의원선거.xlsx": {
    id: "2022-local-council",
    name: "제8회 지방선거 — 시·도의원 지역구",
    type: "local_council",
    layout: "B",
  },
  "구시군장선거.xlsx": {
    id: "2022-local-mayor",
    name: "제8회 지방선거 — 시장·군수·구청장",
    type: "mayor",
    layout: "B",
  },
  "구시군의원선거.xlsx": {
    id: "2022-local-council-basic",
    name: "제8회 지방선거 — 구·시·군의원 지역구",
    type: "local_council_basic",
    layout: "B",
  },
  "기초비례의원선거.xlsx": {
    id: "2022-local-council-basic-prop",
    name: "제8회 지방선거 — 구·시·군의원 비례",
    type: "local_council_basic_prop",
    layout: "B",
  },
  "교육감선거.xlsx": {
    id: "2022-local-superintendent",
    name: "제8회 지방선거 — 교육감",
    type: "superintendent",
    layout: "SKIP", // 교육감은 정당 데이터 아님 — 개인 후보만
  },
  "교육의원선거.xlsx": {
    id: "2022-local-edu-council",
    name: "제8회 지방선거 — 교육의원",
    type: "edu_council",
    layout: "SKIP", // 교육의원도 정당 없음 (제주만)
  },
  "국회의원선거.xlsx": {
    id: "2022-local-national-assembly",
    name: "제8회 지방선거 — 국회의원",
    type: "national_assembly",
    layout: "SKIP", // 2022 지선엔 국회의원 재보선 일부만 — 전국 데이터 아님
  },
};

// Layout A: sido=0, sigungu=1, emd=2, gubun=3, voteStart=6
// Layout B: sido=0, sigungu=1, (선거구=2), emd=3, gubun=4, voteStart=7
// Layout C: sido=0, (선거구=1), sigungu=2, emd=3, gubun=4, voteStart=7
interface Layout {
  sidoCol: number;
  sigunguCol: number;
  emdCol: number;
  gubunCol: number;
  voteStartCol: number;
}

const LAYOUTS: Record<"A" | "B" | "C", Layout> = {
  A: { sidoCol: 0, sigunguCol: 1, emdCol: 2, gubunCol: 3, voteStartCol: 6 },
  B: { sidoCol: 0, sigunguCol: 1, emdCol: 3, gubunCol: 4, voteStartCol: 7 },
  C: { sidoCol: 0, sigunguCol: 2, emdCol: 3, gubunCol: 4, voteStartCol: 7 },
};

// "당명\r\n후보명" → "당명" 추출
function extractPartyFromCell(raw: string): string {
  const parts = raw.split(/\r?\n/);
  return parts[0].trim();
}

export function parseSheetRows(
  sheet: XLSX.WorkSheet,
  layout: Layout,
): JiseonRow[] {
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
  });
  if (json.length < 4) return [];

  // row 2: 정당명/후보명 헤더
  const nameRow = json[2] as (string | null)[];
  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = layout.voteStartCol; i < nameRow.length; i++) {
    const cell = nameRow[i];
    if (!cell || typeof cell !== "string") continue;
    const partyName = extractPartyFromCell(cell.trim());
    if (!partyName || partyName === "계" || partyName === "합계") continue;
    partyCols.push({ idx: i, name: partyName });
  }

  const result: JiseonRow[] = [];

  for (let r = 3; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;

    const sido = String(row[layout.sidoCol] ?? "").trim();
    const sigungu = String(row[layout.sigunguCol] ?? "").trim();
    const emd = String(row[layout.emdCol] ?? "").trim();
    const gubun = String(row[layout.gubunCol] ?? "").trim();

    // 읍면동 집계 행만: 구분 == "소계"
    if (gubun !== "소계") continue;
    if (!emd || !sido || !sigungu) continue;
    // 합계/소계 이름의 행 skip
    if (emd === "합계" || emd === "소계" || emd === "전체") continue;

    // 총 유효표 = 정당 합계
    let totalVotes = 0;
    for (const pc of partyCols) {
      const rawVal = row[pc.idx];
      const v = typeof rawVal === "number" ? rawVal : Number(String(rawVal ?? "0").replace(/,/g, ""));
      if (Number.isFinite(v) && v > 0) totalVotes += v;
    }
    if (totalVotes === 0) continue;

    for (const pc of partyCols) {
      const rawVal = row[pc.idx];
      const v = typeof rawVal === "number" ? rawVal : Number(String(rawVal ?? "0").replace(/,/g, ""));
      if (!Number.isFinite(v) || v <= 0) continue;
      result.push({ sido, sigungu, emd, partyName: pc.name, votes: v, totalVotes });
    }
  }

  return result;
}

// test 용 export
export const parseSheetRowsForTest = parseSheetRows;

export async function parseJiseon2022(zipPath: string): Promise<JiseonOutput[]> {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const outputs: JiseonOutput[] = [];

  for (const entry of entries) {
    const filename = iconv.decode(Buffer.from(entry.rawEntryName), "cp949");
    const meta = FILE_TO_ELECTION[filename];
    if (!meta) {
      console.warn(`[parse-jiseon-2022] 미매핑 파일 skip: ${filename}`);
      continue;
    }
    if (meta.layout === "SKIP") {
      console.log(`[parse-jiseon-2022] skip (정당 없음): ${filename}`);
      continue;
    }

    const wb = XLSX.read(entry.getData(), { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const layout = LAYOUTS[meta.layout];
    const rows = parseSheetRows(sheet, layout);
    console.log(`[parse-jiseon-2022] ${filename}: ${rows.length} rows`);
    outputs.push({
      electionId: meta.id,
      electionName: meta.name,
      date: DATE,
      type: meta.type,
      rows,
    });
  }

  return outputs;
}
