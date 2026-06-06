// scripts/build/lib/build-region.ts
import { ParsedElection } from "./types";
import { aggregateByRegion, RegionAggregate } from "./aggregate-region";
import { RegionFile, RegionElectionSummary, TimeseriesPoint } from "../../../src/types/static";

interface BuildInput {
  elections: { id: string; date: string }[];
  parsedByElection: Map<string, ParsedElection>;
  regionCodeMap: Map<string, string>;  // "시도" | "시도|시군구" | "시도|시군구|emd" → 코드
}

export async function buildRegionFiles(input: BuildInput): Promise<Map<string, RegionFile>> {
  const acc = new Map<string, RegionFile>();
  const ensure = (
    code: string,
    name: string,
    level: "sido" | "sigungu" | "emd",
    parent?: { code: string; name: string },
  ) => {
    if (!acc.has(code)) {
      acc.set(code, { code, name, level, parent, children: [], timeseries: {}, elections: [] });
    }
    return acc.get(code)!;
  };

  for (const e of input.elections) {
    const parsed = input.parsedByElection.get(e.id);
    if (!parsed) continue;
    const agg = aggregateByRegion(parsed.rows, e.date, e.id);

    // sido
    for (const [sidoName, a] of agg.sido) {
      const code = input.regionCodeMap.get(sidoName);
      if (!code) continue;
      const f = ensure(code, sidoName, "sido");
      const summary = toSummary(e.id, a);
      f.elections.push(summary);
      addTimeseries(f.timeseries, summary);
    }
    // sigungu
    for (const [key, a] of agg.sigungu) {
      const [sidoName, sigName] = key.split("|");
      const code = input.regionCodeMap.get(key);
      if (!code) continue;
      const parentCode = input.regionCodeMap.get(sidoName);
      const f = ensure(code, sigName, "sigungu", parentCode ? { code: parentCode, name: sidoName } : undefined);
      const summary = toSummary(e.id, a);
      f.elections.push(summary);
      addTimeseries(f.timeseries, summary);
    }
    // emd
    for (const [key, a] of agg.emd) {
      const [sidoName, sigName, emdName] = key.split("|");
      const code = input.regionCodeMap.get(key);
      if (!code) continue;
      const parentKey = `${sidoName}|${sigName}`;
      const parentCode = input.regionCodeMap.get(parentKey);
      const f = ensure(code, emdName, "emd", parentCode ? { code: parentCode, name: sigName } : undefined);
      const summary = toSummary(e.id, a);
      f.elections.push(summary);
      addTimeseries(f.timeseries, summary);
    }
  }
  return acc;
}

function toSummary(electionId: string, a: RegionAggregate): RegionElectionSummary {
  return {
    electionId,
    totalVoters: a.totalVoters,
    totalVotes: a.totalVotes,
    validVotes: a.validVotes,
    invalidVotes: a.invalidVotes,
    byParty: a.byParty
      .filter((p) => p.partyId)
      .map((p) => ({
        partyId: p.partyId!,
        votes: p.votes,
        share: a.validVotes ? +(p.votes / a.validVotes * 100).toFixed(2) : 0,
      })),
    byKind: {},  // 추후 buildElectionDetail 에서 채움
  };
}

function addTimeseries(ts: Record<string, TimeseriesPoint[]>, s: RegionElectionSummary) {
  for (const p of s.byParty) {
    if (!ts[p.partyId]) ts[p.partyId] = [];
    ts[p.partyId].push({ electionId: s.electionId, votes: p.votes, totalVotes: s.validVotes, share: p.share });
  }
}
