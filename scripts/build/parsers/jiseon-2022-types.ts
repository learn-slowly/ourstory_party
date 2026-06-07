// scripts/build/parsers/jiseon-2022-types.ts
// 2022 8회 지선 읍면동 파서 입출력 타입

export interface JiseonRow {
  sido: string;
  sigungu: string;
  emd: string;
  partyName: string;  // 원본 정당명 (정규화 전)
  votes: number;
  totalVotes: number;
}

export interface JiseonOutput {
  electionId: string;        // 예: "2022-local-governor"
  electionName: string;      // 예: "제8회 지방선거 — 시·도지사"
  date: string;              // "2022-06-01"
  type: string;              // "governor" 등
  rows: JiseonRow[];
}

export interface JiseonNormalizedRow extends JiseonRow {
  partyId: string;
}

export interface JiseonNormalizedOutput extends Omit<JiseonOutput, "rows"> {
  rows: JiseonNormalizedRow[];
}
