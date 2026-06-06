// src/lib/region-types.ts
// queries.ts·db/schema 가 제거되어 region 페이지 컴포넌트가 의존하던 타입을 한 곳에 모은 공유 정의.
// 정적 마이그레이션 이전 SQL 기반 props 모양을 그대로 유지하기 위함이며,
// static-region.ts 가 이 타입에 맞춰 정적 산출물을 변환한다.

export interface RegionRow {
  code: string;
  name: string;
  level: "sido" | "sigungu" | "emd";
  parentCode: string | null;
  displayOrder: number | null;
}

export interface ElectionMeta {
  id: string;
  date: string;
  type: string;
  name: string;
  displayOrder: number | null;
  isByelection: boolean;
}

export interface SeriesPoint {
  election: ElectionMeta;
  partyId: string;
  partyName: string;
  partyColor: string;
  partyFamily: string;
  votes: number;
  totalVotes: number | null;
  pct: number | null;
}

export interface RegionContext {
  region: RegionRow;
  ancestors: RegionRow[]; // [sido] for sigungu, [sido, sigungu] for emd
  children: RegionRow[];
  level: "sido" | "sigungu" | "emd";
}

export interface RegionDistRow {
  partyId: string;
  partyName: string;
  color: string;
  votes: number;
  share: number; // 0~1
  prevShare: number | null;
}

export interface RegionDistribution {
  rows: RegionDistRow[];
  totalVotes: number;
  raceKind: "party" | "candidate";
}

export interface ChildrenTableRow {
  code: string;
  name: string;
  byParty: Record<string, number>;
  total: number;
}

export interface ChildrenTable {
  children: ChildrenTableRow[];
  partyColumns: { partyId: string; partyName: string; color: string }[];
}

export interface PresubElDayRow {
  regionCode: string;
  regionName: string;
  partyId: string;
  presub: number;
  elDay: number;
}

export interface PresubElDayResult {
  hasData: boolean;
  rows: PresubElDayRow[];
}
