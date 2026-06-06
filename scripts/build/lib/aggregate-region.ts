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

  for (const r of rows) {
    if (r.kind !== "el_day") continue; // station 단위만 집계 (top-level 메타·소계 제외)
    addTo(sido, r.sidoName, r);
    addTo(sigungu, `${r.sidoName}|${r.sigunguName}`, r);
    if (r.emdName) addTo(emd, `${r.sidoName}|${r.sigunguName}|${r.emdName}`, r);
  }
  return { sido, sigungu, emd };
}
