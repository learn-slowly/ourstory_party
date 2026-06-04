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

export interface LiveSidoCell {
  sidoCode: string;
  sidoName: string;
  progressPct: number | null;
  totalVotes: number | null;
  totalVoters: number | null;
  topParty: { name: string; color: string; votes: number; pct: number } | null;
}

export async function getLiveSnapshot(electionId: string): Promise<{
  electionName: string;
  date: string;
  cells: LiveSidoCell[];
  national: { progressPct: number | null; topParty: { name: string; color: string; pct: number } | null };
}> {
  const [election] = await db.select().from(elections).where(eq(elections.id, electionId)).limit(1);
  if (!election) throw new Error(`election not found: ${electionId}`);

  const allRegions = await db.select().from(regions).where(eq(regions.level, "sido"));
  const allParties = await db.select().from(parties);
  const partiesById = new Map(allParties.map((p) => [p.id, p]));

  const regs = await db.select().from(regionTotals).where(eq(regionTotals.electionId, electionId));
  const regsByCode = new Map(regs.map((r) => [r.regionCode, r]));

  const votes = await db.select().from(voteTotals).where(eq(voteTotals.electionId, electionId));
  const sidoCodeSet = new Set(allRegions.map((r) => r.code));
  const cellTop = new Map<string, { partyId: string; votes: number }>();
  for (const v of votes) {
    if (!sidoCodeSet.has(v.regionCode)) continue;
    const cur = cellTop.get(v.regionCode);
    if (!cur || v.votes > cur.votes) cellTop.set(v.regionCode, { partyId: v.partyId, votes: v.votes });
  }

  const cells: LiveSidoCell[] = allRegions.map((r) => {
    const reg = regsByCode.get(r.code);
    const top = cellTop.get(r.code);
    const party = top ? partiesById.get(top.partyId) : undefined;
    const totalVotes = reg?.totalVotes ?? null;
    return {
      sidoCode: r.code,
      sidoName: r.name,
      progressPct: reg?.progressPct == null ? null : Number(reg.progressPct),
      totalVotes,
      totalVoters: reg?.totalVoters ?? null,
      topParty: top && party && totalVotes != null && totalVotes > 0 ? {
        name: party.name, color: party.color,
        votes: top.votes,
        pct: Math.round(top.votes / totalVotes * 1000) / 10,
      } : null,
    };
  });

  // 전국 평균 진행률
  let progNum = 0, progDen = 0;
  for (const c of cells) if (c.progressPct != null) { progNum += c.progressPct; progDen += 1; }
  const nationalProgress = progDen > 0 ? progNum / progDen : null;

  // 전국 1위
  const partyTotals = new Map<string, number>();
  for (const v of votes) if (sidoCodeSet.has(v.regionCode)) partyTotals.set(v.partyId, (partyTotals.get(v.partyId) ?? 0) + v.votes);
  let topNationalPid: string | undefined; let topNationalVotes = 0;
  for (const [pid, vs] of partyTotals) if (vs > topNationalVotes) { topNationalPid = pid; topNationalVotes = vs; }
  const topNational = topNationalPid ? partiesById.get(topNationalPid) : undefined;
  const nationalVotes = cells.reduce((s, c) => s + (c.totalVotes ?? 0), 0);
  const nationalTopPartyPct = topNational && nationalVotes > 0
    ? Math.round(topNationalVotes / nationalVotes * 1000) / 10 : null;

  return {
    electionName: election.name,
    date: String(election.date),
    cells,
    national: {
      progressPct: nationalProgress == null ? null : Math.round(nationalProgress * 10) / 10,
      topParty: topNational && nationalTopPartyPct != null
        ? { name: topNational.name, color: topNational.color, pct: nationalTopPartyPct }
        : null,
    },
  };
}

/**
 * /live 의 election picker 옵션 — 적재된 election (vote_totals 에 한 행이라도 있음) 중 최근 순.
 */
export async function getLiveElectionOptions(limit = 12): Promise<{ id: string; name: string; date: string }[]> {
  const rows = await db
    .selectDistinct({ id: voteTotals.electionId })
    .from(voteTotals);
  const ingestedIds = rows.map((r) => r.id);
  if (ingestedIds.length === 0) return [];
  const metas = await db
    .select({ id: elections.id, name: elections.name, date: elections.date })
    .from(elections)
    .where(inArray(elections.id, ingestedIds))
    .orderBy(elections.date);
  return metas.reverse().slice(0, limit).map((m) => ({ id: m.id, name: m.name, date: String(m.date) }));
}
