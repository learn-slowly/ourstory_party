// src/types/static.ts
// 정적 chunk JSON 의 타입 정의 — Phase 2 정적 마이그레이션 산출물.

export interface StaticIndex {
  version: string;
  elections: ElectionMeta[];
  parties: PartyMeta[];
  regions: {
    sido: RegionMeta[];
    sigunguByRegion: Record<string, RegionMeta[]>;
    emdByRegion?: Record<string, RegionMeta[]>;
  };
}

export interface ElectionMeta {
  id: string;
  name: string;
  date: string;
  type: string;
  isByelection: boolean;
  hasStationLevel: boolean;
  displayOrder: number;
}

export interface PartyMeta {
  id: string;
  name: string;
  color: string;
  family: string;
  satelliteOf?: string | null;
}

export interface RegionMeta {
  code: string;
  name: string;
}

export interface TimeseriesPoint {
  electionId: string;
  votes: number;
  totalVotes: number;
  share: number;
}

export interface RegionElectionSummary {
  electionId: string;
  totalVoters: number;
  totalVotes: number;
  validVotes: number;
  invalidVotes: number;
  byParty: { partyId: string; votes: number; share: number }[];
  byKind: Record<
    string,
    {
      totalVoters: number;
      totalVotes: number;
      validVotes: number;
      byParty: { partyId: string; votes: number }[];
    }
  >;
}

export interface RegionFile {
  code: string;
  name: string;
  level: "sido" | "sigungu" | "emd";
  parent?: { code: string; name: string };
  children: (RegionMeta & { level: string })[];
  timeseries: Record<string, TimeseriesPoint[]>;
  elections: RegionElectionSummary[];
}

export interface ElectionDetailFile {
  regionCode: string;
  electionId: string;
  candidates: { rawName: string; partyId: string | null; votes: number }[];
  rowsByEmd: {
    emdName: string;
    emdCode: string | null;
    kindRows: {
      kind: string;
      name: string;
      voters: number;
      votes: number;
      valid: number;
      invalid: number;
      byParty: { partyId: string | null; votes: number }[];
    }[];
  }[];
}

export interface StationFile {
  stationKey: string;
  name: string;
  emdName: string;
  sigunguName: string;
  sidoName: string;
  timeseries: Record<string, TimeseriesPoint[]>;
}
