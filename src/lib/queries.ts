import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { elections, parties, regions, regionTotals, voteTotals } from "../../db/schema";
import type { HomeState } from "./url-state";

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

const PROGRESSIVE_FAMILIES = ["justice", "labor", "green", "progressive", "historical_progressive"];

export async function getTimeseries(state: HomeState): Promise<SeriesPoint[]> {
  // 1) 대상 elections
  const baseElections = await db
    .select()
    .from(elections)
    .where(eq(elections.isByelection, false))
    .orderBy(elections.displayOrder);
  const filteredElections =
    state.types === "all"
      ? baseElections
      : baseElections.filter((e) => (state.types as string[]).includes(e.type));

  if (filteredElections.length === 0) return [];

  // 2) 정당 메타 + 위성 매핑
  const allParties = await db.select().from(parties);
  const partiesById = new Map(allParties.map((p) => [p.id, p]));

  function effectivePartyId(pid: string): string {
    if (state.satellite !== "merged") return pid;
    const p = partiesById.get(pid);
    return p?.satelliteOf ?? pid;
  }

  // 3) 대상 region 셋
  const allRegions = await db.select().from(regions);
  const sidoCodes = allRegions.filter((r) => r.level === "sido").map((r) => r.code);
  const targetRegions: string[] = state.region === "all" ? sidoCodes : [state.region];

  // 4) vote_totals + region_totals 조회
  const electionIds = filteredElections.map((e) => e.id);
  const votes = await db
    .select()
    .from(voteTotals)
    .where(
      and(
        inArray(voteTotals.electionId, electionIds),
        inArray(voteTotals.regionCode, targetRegions),
      ),
    );
  const regs = await db
    .select()
    .from(regionTotals)
    .where(
      and(
        inArray(regionTotals.electionId, electionIds),
        inArray(regionTotals.regionCode, targetRegions),
      ),
    );

  // 5) election × party 합산
  type Acc = { votes: number };
  const map = new Map<string, Acc>();
  for (const v of votes) {
    const effId = effectivePartyId(v.partyId);
    const key = `${v.electionId}|${effId}`;
    const cur = map.get(key) ?? { votes: 0 };
    cur.votes += v.votes;
    map.set(key, cur);
  }

  // 6) totalVotes (election × region 단위 region_totals 합)
  const totalByElection = new Map<string, number>();
  for (const r of regs) {
    if (r.totalVotes == null) continue;
    totalByElection.set(r.electionId, (totalByElection.get(r.electionId) ?? 0) + r.totalVotes);
  }

  // 7) SeriesPoint 생성
  const series: SeriesPoint[] = [];
  const electionMetaById = new Map(filteredElections.map((e) => [e.id, e]));
  const wantedPartyIds = new Set(state.parties.map((pid) => effectivePartyId(pid)));

  for (const [key, acc] of map.entries()) {
    const [electionId, partyId] = key.split("|");
    if (!wantedPartyIds.has(partyId)) continue;
    const meta = electionMetaById.get(electionId);
    const party = partiesById.get(partyId);
    if (!meta || !party) continue;
    const total = totalByElection.get(electionId) ?? null;
    const pct =
      total != null && total > 0 ? Math.round((acc.votes / total) * 1000) / 10 : null;
    series.push({
      election: {
        id: meta.id,
        date: String(meta.date),
        type: meta.type,
        name: meta.name,
        displayOrder: meta.displayOrder,
        isByelection: meta.isByelection,
      },
      partyId,
      partyName: party.name,
      partyColor: party.color,
      partyFamily: party.family,
      votes: acc.votes,
      totalVotes: total,
      pct,
    });
  }

  // 8) mergeProgressive 라인
  if (state.mergeProgressive) {
    const progByElection = new Map<string, number>();
    for (const v of votes) {
      const p = partiesById.get(v.partyId);
      if (!p) continue;
      if (!PROGRESSIVE_FAMILIES.includes(p.family)) continue;
      progByElection.set(v.electionId, (progByElection.get(v.electionId) ?? 0) + v.votes);
    }
    for (const [eid, voteSum] of progByElection.entries()) {
      const meta = electionMetaById.get(eid);
      if (!meta) continue;
      const total = totalByElection.get(eid) ?? null;
      const pct =
        total != null && total > 0 ? Math.round((voteSum / total) * 1000) / 10 : null;
      series.push({
        election: {
          id: meta.id,
          date: String(meta.date),
          type: meta.type,
          name: meta.name,
          displayOrder: meta.displayOrder,
          isByelection: meta.isByelection,
        },
        partyId: "progressive_merged",
        partyName: "진보 합산",
        partyColor: "#9B26B6",
        partyFamily: "merged",
        votes: voteSum,
        totalVotes: total,
        pct,
      });
    }
  }

  return series;
}

export async function getFilterOptions() {
  const allRegions = await db.select().from(regions).orderBy(regions.code);
  const allElectionTypes = await db
    .selectDistinct({ type: elections.type })
    .from(elections)
    .where(eq(elections.isByelection, false));
  const allParties = await db.select().from(parties).orderBy(parties.id);
  return {
    regions: allRegions.filter((r) => r.level !== "emd"),
    types: allElectionTypes.map((r) => r.type),
    parties: allParties,
  };
}
