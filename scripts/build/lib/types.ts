// scripts/build/lib/types.ts
export type RowKind = "total" | "subtotal" | "el_day" | "presub" | "abs" | "absentee" | "overseas" | "misc";

export interface ParsedPartyVote {
  rawName: string;   // "더불어민주당\n곽상언" 또는 "정의당"
  votes: number;
}

export interface ParsedStationRow {
  sidoName: string;
  sigunguName: string;
  emdName: string | null;
  stationName: string | null;    // "청운효자동제1투" — kind=el_day 만
  kind: RowKind;
  totalVoters: number;
  totalVotes: number;
  validVotes: number;
  invalidVotes: number;
  parties: ParsedPartyVote[];
}

export interface ParsedElection {
  electionId: string;            // "2024-general"
  electionDate: string;          // "2024-04-10"
  rows: ParsedStationRow[];
  partyNames: string[];          // 발견된 모든 raw 정당/후보자명 (validate 용)
}
