// scripts/build/lib/xlsx-format-detect.ts
import * as XLSX from "xlsx";

export type FormatKind = "A" | "B" | "C" | "D";

/**
 * NEC 다운로드 xlsx 의 형식 자동 감지.
 *  - C: row[0] 한 줄에 시도/구시군 header + 후보자명 합침 (2022 대선·재보궐)
 *  - A: row[3] 에 시도명 + (선거구명 또는 투표타입) — 2024 지역구·비례 통합
 *  - D: row[3] 에 시도명 + 구시군명 (선거구·투표타입 없음) — 2012 .xls 통합
 *  - B: row[3] 첫 컬럼 = "읍면동명" — 시·도×시·군·구 분리 파일 (2020·2016)
 */
export function detectFormat(filePath: string): FormatKind {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });

  const row0 = (grid[0] ?? []).map((c) => (c ?? "").toString().trim());
  const row3 = (grid[3] ?? []).map((c) => (c ?? "").toString().trim());

  // C: row[0] 첫 셀이 시도 + 둘째가 구시군
  if ((row0[0] === "시도" || row0[0] === "시도명") &&
      (row0[1] === "구시군" || row0[1] === "구시군명")) {
    return "C";
  }
  // A: row[3] 시도명 + (선거구명 or 투표타입) 컬럼
  if (row3.includes("시도명") && (row3.includes("선거구명") || row3.includes("투표타입"))) {
    return "A";
  }
  // D: row[3] 시도명 + 구시군명 (선거구 없음)
  if (row3.includes("시도명") && row3.includes("구시군명")) {
    return "D";
  }
  // B: row[3] 첫 컬럼 = 읍면동명 (시·도 정보는 시트 메타에)
  if (row3[0] === "읍면동명") return "B";

  throw new Error(`형식 감지 실패 — row[3]: ${row3.slice(0, 8).join("|")}`);
}
