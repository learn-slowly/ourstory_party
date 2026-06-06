// src/lib/static-series.ts
// 정적 chunk 의 timeseries (정당별 election point 리스트) → Recharts ChartRow/ChartLine 변환.
// queries.ts 의 getTimeseries + series.ts 의 toRechartsData 통합 대체.
import type { ChartRow, ChartLine } from "./series";
import type {
  ElectionMeta,
  PartyMeta,
  RegionFile,
  StationFile,
  TimeseriesPoint,
} from "../types/static";
import type { HomeState } from "./url-state";

const PROGRESSIVE_FAMILIES = [
  "justice",
  "labor",
  "green",
  "progressive",
  "historical_progressive",
];

interface Input {
  state: HomeState;
  elections: ElectionMeta[];
  parties: PartyMeta[];
  // 한 region/station 파일 또는 (state.region === "all" 일 때) 여러 sido 파일.
  // 같은 element 가 election 분모(totalVotes)·정당 votes 를 함께 들고 있어, 동일 region 의 timeseries 면
  // election 별 totalVotes 가 정당과 무관하게 일정 — 그 사실을 이용해 정확히 한 번만 합산함.
  sources: { timeseries: Record<string, TimeseriesPoint[]> }[];
}

/**
 * 정적 timeseries 로부터 차트용 data·lines 빌드.
 *
 * - 재보궐 (isByelection=true) election 은 시계열에서 제외.
 * - HomeState.types 가 'all' 이 아니면 election.type 으로 필터.
 * - state.satellite === 'merged' 일 때 위성정당 → 본당 으로 votes 합산.
 * - state.parties 안의 정당만 라인으로 노출 (위성 합산 시 부모 정당 id 기준).
 * - state.mergeProgressive 일 때 progressive 패밀리 합산 'progressive_merged' 가상 라인 추가.
 * - sources.length > 1 (예: 전국) 일 때 region 별 votes·totalVotes 모두 합산.
 */
export function buildHomeChart(input: Input): { data: ChartRow[]; lines: ChartLine[] } {
  const { state, elections, parties, sources } = input;

  const partyById = new Map(parties.map((p) => [p.id, p]));
  const effectiveOf = (pid: string): string => {
    if (state.satellite !== "merged") return pid;
    return partyById.get(pid)?.satelliteOf ?? pid;
  };

  // 기간 필터 — from..to 범위 (YYYY 4자리). null/undefined 면 미적용.
  // election.date 는 ISO 형식이므로 문자열 비교로 충분 (YYYY-MM-DD vs YYYY-01-01).
  const fromBound = state.from ? `${state.from}-01-01` : null;
  const toBound = state.to ? `${state.to}-12-31` : null;

  // 대상 election — 재보궐 제외 + type 필터 + 기간 필터
  const targetElections = elections.filter((e) => {
    if (e.isByelection) return false;
    if (state.types !== "all" && !(state.types as string[]).includes(e.type)) return false;
    if (fromBound && e.date < fromBound) return false;
    if (toBound && e.date > toBound) return false;
    return true;
  });
  if (targetElections.length === 0) return { data: [], lines: [] };
  const targetSet = new Set(targetElections.map((e) => e.id));

  // 1) (electionId × effectiveParty) → votes 합산
  const votesByKey = new Map<string, number>(); // key: `${electionId}|${effPid}`
  // election 단위 totalVotes — source 별로 한 election 의 첫 등장 timeseries point 의 totalVotes 만 1회 합산.
  const totalByElection = new Map<string, number>();

  for (const src of sources) {
    // 한 source 내에서 election 당 totalVotes 는 정당 무관 일정 — 한 번만 가져옴
    const seenTotal = new Set<string>();
    for (const [pid, points] of Object.entries(src.timeseries)) {
      const effPid = effectiveOf(pid);
      for (const p of points) {
        if (!targetSet.has(p.electionId)) continue;
        const key = `${p.electionId}|${effPid}`;
        votesByKey.set(key, (votesByKey.get(key) ?? 0) + p.votes);
        if (!seenTotal.has(p.electionId)) {
          seenTotal.add(p.electionId);
          totalByElection.set(
            p.electionId,
            (totalByElection.get(p.electionId) ?? 0) + p.totalVotes,
          );
        }
      }
    }
  }

  // 2) ChartRow/ChartLine 조립 — state.parties 만 라인으로 노출
  const wantedPartyIds = new Set(state.parties.map((pid) => effectiveOf(pid)));
  const rowsByElection = new Map<string, ChartRow>();
  const lineByParty = new Map<string, ChartLine>();

  for (const e of targetElections) {
    const year = String(e.date).slice(0, 4);
    rowsByElection.set(e.id, {
      electionId: e.id,
      electionLabel: `${year} ${e.name}`,
      date: e.date,
      displayOrder: e.displayOrder ?? 0,
    });
  }

  for (const [key, voteSum] of votesByKey.entries()) {
    const [electionId, partyId] = key.split("|");
    if (!wantedPartyIds.has(partyId)) continue;
    const row = rowsByElection.get(electionId);
    const total = totalByElection.get(electionId) ?? 0;
    const party = partyById.get(partyId);
    if (!row || !party || total === 0) continue;
    const pct = Math.round((voteSum / total) * 1000) / 10;
    row[partyId] = pct;
    if (!lineByParty.has(partyId)) {
      lineByParty.set(partyId, {
        partyId,
        name: party.name,
        color: party.color,
        family: party.family,
      });
    }
  }

  // 3) progressive 합산 라인
  if (state.mergeProgressive) {
    const progByElection = new Map<string, number>();
    for (const src of sources) {
      for (const [pid, points] of Object.entries(src.timeseries)) {
        const meta = partyById.get(pid);
        if (!meta) continue;
        if (!PROGRESSIVE_FAMILIES.includes(meta.family)) continue;
        for (const p of points) {
          if (!targetSet.has(p.electionId)) continue;
          progByElection.set(p.electionId, (progByElection.get(p.electionId) ?? 0) + p.votes);
        }
      }
    }
    for (const [eid, voteSum] of progByElection.entries()) {
      const row = rowsByElection.get(eid);
      const total = totalByElection.get(eid) ?? 0;
      if (!row || total === 0) continue;
      const pct = Math.round((voteSum / total) * 1000) / 10;
      row["progressive_merged"] = pct;
    }
    if (progByElection.size > 0) {
      lineByParty.set("progressive_merged", {
        partyId: "progressive_merged",
        name: "진보 합산",
        color: "#9B26B6",
        family: "merged",
      });
    }
  }

  // 정렬 — 시간순 + 정의당 우선
  const data = [...rowsByElection.values()].sort((a, b) => a.displayOrder - b.displayOrder);
  const lines = [...lineByParty.values()].sort((a, b) => {
    if (a.partyId === "justice") return -1;
    if (b.partyId === "justice") return 1;
    return 0;
  });
  return { data, lines };
}

/**
 * filterOptions — 정적 index 로부터 HeaderControls 가 받던 옵션 구조.
 * regions 는 HomeView 의 RegionOpt 형식 (level 포함) 으로 변환.
 */
export function buildFilterOptions(input: {
  parties: PartyMeta[];
  elections: ElectionMeta[];
  sido: { code: string; name: string }[];
  sigunguByRegion: Record<string, { code: string; name: string }[]>;
}): {
  regions: { code: string; level: string; name: string; parentCode?: string | null }[];
  types: string[];
  parties: { id: string; name: string; family: string; color: string; satelliteOf?: string | null }[];
  yearOptions: string[];
} {
  const regions: { code: string; level: string; name: string; parentCode?: string | null }[] = [];
  for (const s of input.sido) regions.push({ code: s.code, level: "sido", name: s.name, parentCode: null });
  for (const [sidoCode, list] of Object.entries(input.sigunguByRegion)) {
    for (const sg of list) regions.push({ code: sg.code, level: "sigungu", name: sg.name, parentCode: sidoCode });
  }
  const nonBye = input.elections.filter((e) => !e.isByelection);
  const types = [...new Set(nonBye.map((e) => e.type))];
  // 가용 election year set — 1948~2026 범위 안만, 오름차순.
  const years = new Set<string>();
  for (const e of nonBye) {
    const y = String(e.date).slice(0, 4);
    if (/^\d{4}$/.test(y)) {
      const n = Number(y);
      if (n >= 1948 && n <= 2026) years.add(y);
    }
  }
  const yearOptions = [...years].sort();
  return {
    regions,
    types,
    parties: input.parties.map((p) => ({
      id: p.id,
      name: p.name,
      family: p.family,
      color: p.color,
      satelliteOf: p.satelliteOf ?? null,
    })),
    yearOptions,
  };
}

// Type re-exports for callers convenience
export type { RegionFile, StationFile };
