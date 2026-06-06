// scripts/build/lib/build-election-detail.ts
import { ParsedElection } from "./types";
import { resolveParty } from "./party-resolver";
import { ElectionDetailFile } from "../../../src/types/static";

type RegionFilter = (r: { sidoName: string; sigunguName: string; emdName: string | null }) => boolean;

export function buildElectionDetail(
  regionCode: string,
  regionFilter: RegionFilter,
  parsed: ParsedElection,
): ElectionDetailFile {
  // candidates 합 — el_day kind 만 (집계 일관성)
  const candidatesMap = new Map<string, number>();
  for (const r of parsed.rows) {
    if (!regionFilter(r) || r.kind !== "el_day") continue;
    for (const p of r.parties) {
      candidatesMap.set(p.rawName, (candidatesMap.get(p.rawName) ?? 0) + p.votes);
    }
  }
  const candidates = parsed.partyNames.map((n) => ({
    rawName: n,
    partyId: resolveParty(n, parsed.electionDate, parsed.electionId),
    votes: candidatesMap.get(n) ?? 0,
  }));

  // rowsByEmd — 모든 kind row 보존 (el_day · presub · abs · absentee · overseas)
  const KEEP_KINDS = new Set(["el_day", "presub", "abs", "absentee", "overseas"]);
  const byEmdMap = new Map<string, ElectionDetailFile["rowsByEmd"][number]>();
  for (const r of parsed.rows) {
    if (!regionFilter(r) || !KEEP_KINDS.has(r.kind)) continue;
    const emdKey = r.emdName ?? "__top__";
    if (!byEmdMap.has(emdKey)) {
      byEmdMap.set(emdKey, { emdName: r.emdName ?? "", emdCode: null, kindRows: [] });
    }
    byEmdMap.get(emdKey)!.kindRows.push({
      kind: r.kind,
      name: r.stationName ?? r.kind,
      voters: r.totalVoters,
      votes: r.totalVotes,
      valid: r.validVotes,
      invalid: r.invalidVotes,
      byParty: r.parties.map((p) => ({
        partyId: resolveParty(p.rawName, parsed.electionDate, parsed.electionId),
        votes: p.votes,
      })),
    });
  }

  return { regionCode, electionId: parsed.electionId, candidates, rowsByEmd: [...byEmdMap.values()] };
}
