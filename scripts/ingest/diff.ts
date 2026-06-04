import { eq } from "drizzle-orm";
import { db } from "../../src/lib/db-admin";
import { voteTotals, regionTotals, candidates } from "../../db/schema";

export interface DiffReport {
  voteTotals: { existing: number; incoming: number; changed: number };
  regionTotals: { existing: number; incoming: number; changed: number };
  candidates: { existing: number; incoming: number };
  samples: string[];
}

export async function diffElection(
  electionId: string,
  incomingVotes: { regionCode: string; partyId: string; votes: number }[],
  incomingRegs: { regionCode: string; totalVoters: number | null; totalVotes: number | null }[],
  incomingCandsCount: number,
): Promise<DiffReport> {
  const existVotes = await db.select().from(voteTotals).where(eq(voteTotals.electionId, electionId));
  const existRegs = await db.select().from(regionTotals).where(eq(regionTotals.electionId, electionId));
  const existCands = await db.select().from(candidates).where(eq(candidates.electionId, electionId));

  const existVotesMap = new Map(existVotes.map((v) => [`${v.regionCode}|${v.partyId}`, v.votes]));
  let voteChanged = 0;
  const samples: string[] = [];
  for (const v of incomingVotes) {
    const old = existVotesMap.get(`${v.regionCode}|${v.partyId}`);
    if (old !== v.votes) {
      voteChanged++;
      if (samples.length < 5) samples.push(`vote_totals ${v.regionCode}/${v.partyId}: ${old ?? "신규"} → ${v.votes}`);
    }
  }

  const existRegsMap = new Map(existRegs.map((r) => [r.regionCode, r]));
  let regChanged = 0;
  for (const r of incomingRegs) {
    const old = existRegsMap.get(r.regionCode);
    if (!old || old.totalVotes !== r.totalVotes || old.totalVoters !== r.totalVoters) {
      regChanged++;
      if (samples.length < 5) samples.push(`region_totals ${r.regionCode}: ${old?.totalVotes ?? "신규"} → ${r.totalVotes}`);
    }
  }

  return {
    voteTotals: { existing: existVotes.length, incoming: incomingVotes.length, changed: voteChanged },
    regionTotals: { existing: existRegs.length, incoming: incomingRegs.length, changed: regChanged },
    candidates: { existing: existCands.length, incoming: incomingCandsCount },
    samples,
  };
}

export function formatDiff(d: DiffReport): string {
  return [
    `diff:   vote_totals 변경 ${d.voteTotals.changed} (기존 ${d.voteTotals.existing} → 신 ${d.voteTotals.incoming})`,
    `        region_totals 변경 ${d.regionTotals.changed} (기존 ${d.regionTotals.existing} → 신 ${d.regionTotals.incoming})`,
    `        candidates 기존 ${d.candidates.existing} → 신 ${d.candidates.incoming} (election 단위 replace)`,
    ...d.samples.map((s) => `        sample: ${s}`),
  ].join("\n");
}
