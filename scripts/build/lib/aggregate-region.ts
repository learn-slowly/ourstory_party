// scripts/build/lib/aggregate-region.ts
import { ParsedStationRow } from "./types";
import { resolveParty } from "./party-resolver";

export interface RegionAggregate {
  totalVoters: number;
  totalVotes: number;
  validVotes: number;
  invalidVotes: number;
  byParty: { rawName: string; partyId: string | null; votes: number }[];
}

export interface AggregateResult {
  sido: Map<string, RegionAggregate>;       // key = sido
  sigungu: Map<string, RegionAggregate>;    // key = sido|sigungu
  emd: Map<string, RegionAggregate>;        // key = sido|sigungu|emd
}

export function aggregateByRegion(
  rows: ParsedStationRow[],
  electionDate: string,
  electionId: string,
): AggregateResult {
  const sido = new Map<string, RegionAggregate>();
  const sigungu = new Map<string, RegionAggregate>();
  const emd = new Map<string, RegionAggregate>();

  const partyCache = new Map<string, string | null>();
  const pid = (rawName: string): string | null => {
    if (!partyCache.has(rawName)) partyCache.set(rawName, resolveParty(rawName, electionDate, electionId));
    return partyCache.get(rawName)!;
  };

  const addTo = (m: Map<string, RegionAggregate>, key: string, r: ParsedStationRow) => {
    if (!m.has(key)) m.set(key, { totalVoters: 0, totalVotes: 0, validVotes: 0, invalidVotes: 0, byParty: [] });
    const a = m.get(key)!;
    a.totalVoters += r.totalVoters;
    a.totalVotes += r.totalVotes;
    a.validVotes += r.validVotes;
    a.invalidVotes += r.invalidVotes;
    for (const p of r.parties) {
      let entry = a.byParty.find((x) => x.rawName === p.rawName);
      if (!entry) {
        entry = { rawName: p.rawName, partyId: pid(p.rawName), votes: 0 };
        a.byParty.push(entry);
      }
      entry.votes += p.votes;
    }
  };

  // el_day 행이 있으면 el_day만 사용 (투표소 단위 집계, 중복 방지)
  // el_day 행이 없으면 total(시군구 합계) + subtotal(읍면동 합계) 행 사용 (2002~2010 등 구 데이터)
  const hasElDay = rows.some((r) => r.kind === "el_day");

  if (hasElDay) {
    for (const r of rows) {
      if (r.kind !== "el_day") continue;
      addTo(sido, r.sidoName, r);
      addTo(sigungu, `${r.sidoName}|${r.sigunguName}`, r);
      if (r.emdName) addTo(emd, `${r.sidoName}|${r.sigunguName}|${r.emdName}`, r);
    }
  } else {
    // 구 데이터: total → sigungu 집계, subtotal → emd 집계
    for (const r of rows) {
      if (r.kind === "total") {
        addTo(sido, r.sidoName, r);
        if (r.sigunguName) addTo(sigungu, `${r.sidoName}|${r.sigunguName}`, r);
      } else if (r.kind === "subtotal" && r.emdName) {
        // emd 집계에만 추가 (sigungu는 total에서 이미 처리)
        addTo(emd, `${r.sidoName}|${r.sigunguName}|${r.emdName}`, r);
      }
    }
  }
  return { sido, sigungu, emd };
}
