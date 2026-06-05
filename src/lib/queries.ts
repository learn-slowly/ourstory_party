import { and, eq, inArray } from "drizzle-orm";
import { db, sql } from "./db";
import {
  elections,
  parties,
  regions,
  regionTotals,
  voteTotals,
  pollingStations,
  pollingStationVotes,
} from "../../db/schema";
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

  // 3) 대상 region 셋 + 데이터 소스 결정
  //    sido/sigungu → vote_totals + region_totals
  //    emd → polling_station_votes JOIN polling_stations (kind 전부 합산) + polling_station_totals
  //    "station:SIGUNGU:EMD:NAME" → polling_station_votes (해당 station 만)
  const allRegions = await db.select().from(regions);
  const electionIds = filteredElections.map((e) => e.id);

  // 한 region 코드의 level 판정 — pattern match (스키마 enum 과 일치 시킴)
  function regionLevelOf(code: string): "sido" | "sigungu" | "emd" | "station" | "unknown" {
    if (!code) return "unknown";
    if (code.startsWith("station:")) return "station";
    if (code.startsWith("9")) return "emd"; // synthetic admin emd
    if (!/^\d{10}$/.test(code)) return "unknown";
    if (code.endsWith("00000000")) return "sido";
    if (code.endsWith("00000")) return "sigungu";
    if (code.endsWith("00")) return "emd";
    return "unknown";
  }

  const level = state.region === "all" ? "all" : regionLevelOf(state.region);

  type VoteRow = { electionId: string; partyId: string; votes: number };
  type RegTotalRow = { electionId: string; totalVotes: number | null };
  let votes: VoteRow[] = [];
  let regs: RegTotalRow[] = [];

  if (level === "all" || level === "sido" || level === "sigungu") {
    const sidoCodes = allRegions.filter((r) => r.level === "sido").map((r) => r.code);
    const targetRegions: string[] = state.region === "all" ? sidoCodes : [state.region];
    votes = await db
      .select({ electionId: voteTotals.electionId, partyId: voteTotals.partyId, votes: voteTotals.votes })
      .from(voteTotals)
      .where(
        and(
          inArray(voteTotals.electionId, electionIds),
          inArray(voteTotals.regionCode, targetRegions),
        ),
      );
    regs = await db
      .select({ electionId: regionTotals.electionId, totalVotes: regionTotals.totalVotes })
      .from(regionTotals)
      .where(
        and(
          inArray(regionTotals.electionId, electionIds),
          inArray(regionTotals.regionCode, targetRegions),
        ),
      );
  } else if (level === "emd") {
    // polling_station_votes 합산. polling_station_totals 합 = totalVotes.
    const raw = await sql<{ election_id: string; party_id: string | null; votes: number; total_votes: number }[]>`
      SELECT
        s.election_id, v.party_id,
        sum(v.votes)::int AS votes,
        sum(coalesce(t.total_votes, 0))::int AS total_votes
      FROM polling_stations s
      LEFT JOIN polling_station_votes v ON v.station_id = s.id
      LEFT JOIN polling_station_totals t ON t.station_id = s.id
      WHERE s.election_id = ANY(${electionIds}::text[])
        AND s.emd_code = ${state.region}
      GROUP BY s.election_id, v.party_id
    `;
    for (const r of raw) {
      if (r.party_id) votes.push({ electionId: r.election_id, partyId: r.party_id, votes: r.votes });
    }
    // total_votes 는 election 단위 합 — party 가 NULL 인 행도 분모에 포함되므로 별도 query
    const totRaw = await sql<{ election_id: string; total: number }[]>`
      SELECT s.election_id, sum(coalesce(t.total_votes, 0))::int AS total
      FROM polling_stations s
      LEFT JOIN polling_station_totals t ON t.station_id = s.id
      WHERE s.election_id = ANY(${electionIds}::text[])
        AND s.emd_code = ${state.region}
      GROUP BY s.election_id
    `;
    regs = totRaw.map((r) => ({ electionId: r.election_id, totalVotes: r.total }));
  } else if (level === "station") {
    // "station:SIGUNGU:EMD:NAME"
    const [, sigunguCode, emdCode, ...nameParts] = state.region.split(":");
    const name = nameParts.join(":");
    const raw = await sql<{ election_id: string; party_id: string | null; votes: number }[]>`
      SELECT s.election_id, v.party_id, sum(v.votes)::int AS votes
      FROM polling_stations s
      LEFT JOIN polling_station_votes v ON v.station_id = s.id
      WHERE s.election_id = ANY(${electionIds}::text[])
        AND s.sigungu_code = ${sigunguCode}
        AND s.emd_code = ${emdCode}
        AND s.name = ${name}
      GROUP BY s.election_id, v.party_id
    `;
    for (const r of raw) {
      if (r.party_id) votes.push({ electionId: r.election_id, partyId: r.party_id, votes: r.votes });
    }
    const totRaw = await sql<{ election_id: string; total: number }[]>`
      SELECT s.election_id, sum(coalesce(t.total_votes, 0))::int AS total
      FROM polling_stations s
      LEFT JOIN polling_station_totals t ON t.station_id = s.id
      WHERE s.election_id = ANY(${electionIds}::text[])
        AND s.sigungu_code = ${sigunguCode}
        AND s.emd_code = ${emdCode}
        AND s.name = ${name}
      GROUP BY s.election_id
    `;
    regs = totRaw.map((r) => ({ electionId: r.election_id, totalVotes: r.total }));
  }

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

// ─── 홈 picker cascading 조건부 query ─────────────────────────────────────

/**
 * 한 sigungu 의 emd children (legal 법정동 emd + synthetic admin emd 모두).
 * sigungu_code 가 `XXXXX00000` 일 때 emd parent_code 는 정확히 그 sigungu_code.
 */
export async function getEmdsOfSigungu(sigunguCode: string): Promise<{ code: string; name: string }[]> {
  const rows = await db
    .select({ code: regions.code, name: regions.name })
    .from(regions)
    .where(and(eq(regions.level, "emd"), eq(regions.parentCode, sigunguCode)));
  return rows.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/**
 * 한 emd 안에서 적재된 polling_stations 의 distinct station 이름. kind='station' 만.
 * 같은 이름이 여러 election 에 등장 시 한 옵션으로 표시 (cross-election 매칭은 name+sigungu+emd).
 */
export async function getStationsOfEmd(emdCode: string): Promise<{ sigunguCode: string; emdCode: string; name: string }[]> {
  const rows = await sql<{ sigungu_code: string; name: string }[]>`
    SELECT DISTINCT sigungu_code, name
    FROM polling_stations
    WHERE emd_code = ${emdCode} AND kind = 'station'
    ORDER BY name
  `;
  return rows.map((r) => ({ sigunguCode: r.sigungu_code, emdCode, name: r.name }));
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

// ─── /region/[code] 페이지용 query 함수들 ─────────────────────────────────

type RegionRow = typeof regions.$inferSelect;

export interface RegionContext {
  region: RegionRow;
  ancestors: RegionRow[]; // [sido] for sigungu, [sido, sigungu] for emd
  children: RegionRow[];
  level: "sido" | "sigungu" | "emd";
}

/**
 * region.code 로 region·level·ancestors·children 한 번에 조회.
 * code 가 regions 에 없으면 null.
 */
export async function getRegionContext(code: string): Promise<RegionContext | null> {
  const [region] = await db.select().from(regions).where(eq(regions.code, code)).limit(1);
  if (!region) return null;

  // 현재 depth ≤ 2 (sido → sigungu → emd) 가정. 깊어지면 재귀 CTE 검토.
  // 데이터 이상으로 self-referencing 순환 발생 시 visited Set 이 무한 루프 방어.
  const ancestors: RegionRow[] = [];
  const visited = new Set<string>([region.code]);
  let cur: RegionRow = region;
  while (cur.parentCode) {
    if (visited.has(cur.parentCode)) break;
    visited.add(cur.parentCode);
    const [parent] = await db.select().from(regions).where(eq(regions.code, cur.parentCode)).limit(1);
    if (!parent) break;
    ancestors.unshift(parent);
    cur = parent;
  }

  const children = await db.select().from(regions).where(eq(regions.parentCode, code));

  return {
    region,
    ancestors,
    children,
    level: region.level,
  };
}

export interface RegionDistRow {
  partyId: string;
  partyName: string;
  color: string;
  votes: number;
  share: number;        // 0~1
  prevShare: number | null; // 직전 동일 type 선거 비교, 없으면 null
}

export interface RegionDistribution {
  rows: RegionDistRow[];
  totalVotes: number;
  raceKind: "party" | "candidate";
}

export async function getRegionDistribution(
  electionId: string,
  regionCode: string,
): Promise<RegionDistribution> {
  const [election] = await db
    .select()
    .from(elections)
    .where(eq(elections.id, electionId))
    .limit(1);
  if (!election) return { rows: [], totalVotes: 0, raceKind: "party" };

  const raceKind: "party" | "candidate" =
    election.necCode === "2" || election.necCode === "6" ? "candidate" : "party";

  const votes = await db
    .select()
    .from(voteTotals)
    .where(and(eq(voteTotals.electionId, electionId), eq(voteTotals.regionCode, regionCode)));

  if (votes.length === 0) return { rows: [], totalVotes: 0, raceKind };

  const totalVotes = votes.reduce((sum, v) => sum + v.votes, 0);
  const allParties = await db.select().from(parties);
  const pById = new Map(allParties.map((p) => [p.id, p]));

  const rows: RegionDistRow[] = votes
    .map((v) => {
      const p = pById.get(v.partyId);
      return {
        partyId: v.partyId,
        partyName: p?.name ?? v.partyId,
        color: p?.color ?? "#9CA3AF",
        votes: v.votes,
        share: totalVotes > 0 ? v.votes / totalVotes : 0,
        prevShare: null, // 직전 비교는 후속 phase (1.3.2). 본 phase 는 placeholder
      };
    })
    .sort((a, b) => b.votes - a.votes);

  return { rows, totalVotes, raceKind };
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

export async function getRegionChildrenTable(
  electionId: string,
  regionCode: string,
): Promise<ChildrenTable> {
  const childRegions = await db
    .select()
    .from(regions)
    .where(eq(regions.parentCode, regionCode));
  if (childRegions.length === 0) return { children: [], partyColumns: [] };

  const childCodes = childRegions.map((r) => r.code);
  const allVotes = await db
    .select()
    .from(voteTotals)
    .where(
      and(
        eq(voteTotals.electionId, electionId),
        inArray(voteTotals.regionCode, childCodes),
      ),
    );

  // 정당 메타
  const allParties = await db.select().from(parties);
  const pById = new Map(allParties.map((p) => [p.id, p]));

  // 정당별 합산 → 상위 7 + justice 항상 포함
  const partySum = new Map<string, number>();
  for (const v of allVotes) {
    partySum.set(v.partyId, (partySum.get(v.partyId) ?? 0) + v.votes);
  }
  const ranked = [...partySum.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([pid]) => pid);
  const topPartyIds = new Set(ranked.slice(0, 7));
  topPartyIds.add("justice");

  const partyColumns = [...topPartyIds]
    .filter((pid) => pById.has(pid))
    .map((pid) => {
      const p = pById.get(pid)!;
      return { partyId: pid, partyName: p.name, color: p.color };
    });

  // children 행 구성
  const byCode = new Map<string, ChildrenTableRow>();
  for (const r of childRegions) {
    byCode.set(r.code, { code: r.code, name: r.name, byParty: {}, total: 0 });
  }
  for (const v of allVotes) {
    const row = byCode.get(v.regionCode);
    if (!row) continue;
    if (topPartyIds.has(v.partyId)) {
      row.byParty[v.partyId] = (row.byParty[v.partyId] ?? 0) + v.votes;
    }
    row.total += v.votes;
  }

  // justice 기본값 0 보장 (데이터 없어도 byParty["justice"] 는 number 로 존재)
  for (const row of byCode.values()) {
    if (!("justice" in row.byParty)) {
      row.byParty["justice"] = 0;
    }
  }

  const children = [...byCode.values()].sort((a, b) => b.total - a.total);
  return { children, partyColumns };
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

/**
 * scope='self' — regionCode 의 polling_station_votes 정당별 (presub vs el_day) 합
 * scope='children' — regionCode 의 직접 children (emd) 각각의 정당별 분해
 */
export async function getPresubVsElDay(
  electionId: string,
  regionCode: string,
  scope: "self" | "children",
): Promise<PresubElDayResult> {
  // 적재된 polling_stations 행 존재 여부 확인 (election 단위)
  const sample = await db
    .select({ id: pollingStations.id })
    .from(pollingStations)
    .where(eq(pollingStations.electionId, electionId))
    .limit(1);
  if (sample.length === 0) return { hasData: false, rows: [] };

  // regionCode 가 sigungu 면 emd 들 가져오기 (children scope)
  // self scope 면 단일 regionCode 사용
  let targetEmdCodes: string[];
  if (scope === "children") {
    const children = await db.select().from(regions).where(eq(regions.parentCode, regionCode));
    targetEmdCodes = children.map((r) => r.code);
    if (targetEmdCodes.length === 0) return { hasData: false, rows: [] };
  } else {
    targetEmdCodes = [regionCode];
  }

  // join + group: polling_station_votes × polling_stations, where emd_code in targetEmdCodes
  type RawRow = { region_code: string; party_id: string; presub: number; el_day: number };
  const rows = await sql<RawRow[]>`
    SELECT
      s.emd_code AS region_code,
      v.party_id,
      sum(CASE WHEN s.kind = 'presub' THEN v.votes ELSE 0 END)::int AS presub,
      sum(CASE WHEN s.kind = 'el_day' THEN v.votes ELSE 0 END)::int AS el_day
    FROM polling_station_votes v
    JOIN polling_stations s ON s.id = v.station_id
    WHERE s.election_id = ${electionId}
      AND s.emd_code = ANY(${targetEmdCodes}::text[])
      AND v.party_id IS NOT NULL
    GROUP BY s.emd_code, v.party_id
  `;

  if (rows.length === 0) return { hasData: false, rows: [] };

  // region name lookup
  const regionRows = await db.select().from(regions).where(inArray(regions.code, targetEmdCodes));
  const nameByCode = new Map(regionRows.map((r) => [r.code, r.name]));

  return {
    hasData: true,
    rows: rows.map((r) => ({
      regionCode: r.region_code,
      regionName: nameByCode.get(r.region_code) ?? r.region_code,
      partyId: r.party_id,
      presub: r.presub,
      elDay: r.el_day,
    })),
  };
}

/**
 * 한 region 의 한 정당 역대 득표율 추이. 재보궐(isByelection=true) 제외.
 * SeriesPoint 타입 재사용 (홈 HomeChart 와 호환).
 */
export async function getRegionTimeseries(
  regionCode: string,
  focusPartyId: string,
): Promise<SeriesPoint[]> {
  const [region] = await db.select().from(regions).where(eq(regions.code, regionCode)).limit(1);
  if (!region) return [];

  const [party] = await db.select().from(parties).where(eq(parties.id, focusPartyId)).limit(1);
  if (!party) return [];

  // 재보궐 제외 + displayOrder 순
  const targetElections = await db
    .select()
    .from(elections)
    .where(eq(elections.isByelection, false))
    .orderBy(elections.displayOrder);

  if (targetElections.length === 0) return [];

  const electionIds = targetElections.map((e) => e.id);
  const votes = await db
    .select()
    .from(voteTotals)
    .where(
      and(
        inArray(voteTotals.electionId, electionIds),
        eq(voteTotals.regionCode, regionCode),
        eq(voteTotals.partyId, focusPartyId),
      ),
    );
  const regs = await db
    .select()
    .from(regionTotals)
    .where(
      and(
        inArray(regionTotals.electionId, electionIds),
        eq(regionTotals.regionCode, regionCode),
      ),
    );

  const votesByElection = new Map(votes.map((v) => [v.electionId, v.votes]));
  const totalByElection = new Map(regs.map((r) => [r.electionId, r.totalVotes ?? 0]));

  const series: SeriesPoint[] = [];
  for (const e of targetElections) {
    const v = votesByElection.get(e.id);
    if (v === undefined) continue;
    const total = totalByElection.get(e.id) ?? null;
    const pct =
      total != null && total > 0 ? Math.round((v / total) * 1000) / 10 : null;
    series.push({
      election: {
        id: e.id,
        date: String(e.date),
        type: e.type,
        name: e.name,
        displayOrder: e.displayOrder,
        isByelection: e.isByelection,
      },
      partyId: focusPartyId,
      partyName: party.name,
      partyColor: party.color,
      partyFamily: party.family,
      votes: v,
      totalVotes: total,
      pct,
    });
  }

  return series;
}
