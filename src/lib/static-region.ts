// src/lib/static-region.ts
// 정적 RegionFile/ElectionDetailFile/StaticIndex → /region/[code] 페이지 컴포넌트가 요구하는
// 기존 SQL 기반 prop 모양으로 변환하는 어댑터.
// 컴포넌트(RegionPartyDist/RegionChildrenTable/PresubVsElDay/RegionView/Breadcrumb)는
// 시각 동작을 그대로 보존하기 위해 손대지 않고, 데이터 레이어만 정적 산출물로 교체한다.
import type {
  RegionFile,
  ElectionDetailFile,
  StaticIndex,
  ElectionMeta,
  PartyMeta,
  RegionMeta,
} from "@/types/static";
import type {
  RegionContext,
  RegionDistribution,
  ChildrenTable,
  PresubElDayResult,
  RegionRow,
} from "@/lib/region-types";

function toRegionRow(
  code: string,
  name: string,
  level: "sido" | "sigungu" | "emd",
  parentCode: string | null,
): RegionRow {
  return {
    code,
    name,
    level,
    parentCode,
    displayOrder: null,
  } as RegionRow;
}

/**
 * StaticIndex + RegionFile 로부터 RegionContext 재구성.
 * - level 은 RegionFile.level
 * - ancestors 는 sido(→sigungu) 로 직접 lookup
 * - children 은 index.regions 의 sigunguByRegion/emdByRegion 에서 가져옴 (RegionFile.children 은 빌더가 채우지 않음)
 */
export function buildRegionContext(
  region: RegionFile,
  index: StaticIndex,
): RegionContext {
  const ancestors: RegionRow[] = [];
  if (region.parent) {
    // sigungu → ancestors = [sido]
    // emd → ancestors = [sido, sigungu] — sido 정보는 index 에서 lookup
    if (region.level === "sigungu") {
      ancestors.push(toRegionRow(region.parent.code, region.parent.name, "sido", null));
    } else if (region.level === "emd") {
      const sigCode = region.parent.code;
      const sigName = region.parent.name;
      // sido 는 sigunguByRegion 의 어느 sido 키에 sigCode 가 들어 있는지 검색
      let sidoCode: string | null = null;
      let sidoName = "";
      for (const [sCode, list] of Object.entries(index.regions.sigunguByRegion)) {
        if (list.some((r) => r.code === sigCode)) {
          sidoCode = sCode;
          const sido = index.regions.sido.find((s) => s.code === sCode);
          sidoName = sido?.name ?? "";
          break;
        }
      }
      if (sidoCode) {
        ancestors.push(toRegionRow(sidoCode, sidoName, "sido", null));
      }
      ancestors.push(toRegionRow(sigCode, sigName, "sigungu", sidoCode));
    }
  }

  // children — index 에서 lookup
  let childrenMeta: RegionMeta[] = [];
  if (region.level === "sido") {
    childrenMeta = index.regions.sigunguByRegion[region.code] ?? [];
  } else if (region.level === "sigungu") {
    childrenMeta = index.regions.emdByRegion?.[region.code] ?? [];
  }
  const childLevel: "sigungu" | "emd" = region.level === "sido" ? "sigungu" : "emd";
  const children: RegionRow[] = childrenMeta.map((r) =>
    toRegionRow(r.code, r.name, childLevel, region.code),
  );

  return {
    region: toRegionRow(region.code, region.name, region.level, region.parent?.code ?? null),
    ancestors,
    children,
    level: region.level,
  };
}

/**
 * 대상 election 1개 + RegionFile.elections (해당 election summary) → RegionDistribution.
 * 빌더는 같은 (partyId) 가 여러 행으로 split 될 수 있어 (예: candidate race) partyId 별 합산.
 * raceKind 는 ElectionMeta.type 으로 판별 — queries.ts 와 동일하게 type 이 'presidential' 또는 'governor'
 * (해당 necCode 2/6) 이면 candidate, 그 외는 party.
 * partyId 가 candidates[] 에 raw 후보별로 풀려 있는 경우(대선·단체장)도 partyId 별로 합쳐서 표기.
 */
export function buildRegionDistribution(
  region: RegionFile,
  electionId: string,
  parties: PartyMeta[],
  elections: ElectionMeta[],
): RegionDistribution {
  const election = elections.find((e) => e.id === electionId);
  // queries.ts 의 raceKind 판정: necCode "2"(대선) / "6"(단체장) → candidate. type 으로 대응.
  const candidateTypes = new Set(["presidential", "governor", "mayor"]);
  const raceKind: "party" | "candidate" =
    election && candidateTypes.has(election.type) ? "candidate" : "party";

  const summary = region.elections.find((e) => e.electionId === electionId);
  if (!summary || summary.validVotes === 0) {
    return { rows: [], totalVotes: 0, raceKind };
  }

  // partyId 별 votes 합산 (byParty 가 후보별 split 일 수도 있어 안전하게 합침)
  const sumByParty = new Map<string, number>();
  for (const row of summary.byParty) {
    sumByParty.set(row.partyId, (sumByParty.get(row.partyId) ?? 0) + row.votes);
  }
  const totalVotes = summary.validVotes;
  const pById = new Map(parties.map((p) => [p.id, p]));

  const rows = [...sumByParty.entries()]
    .map(([partyId, votes]) => {
      const p = pById.get(partyId);
      return {
        partyId,
        partyName: p?.name ?? partyId,
        color: p?.color ?? "#9CA3AF",
        votes,
        share: totalVotes > 0 ? votes / totalVotes : 0,
        prevShare: null,
      };
    })
    .sort((a, b) => b.votes - a.votes);

  return { rows, totalVotes, raceKind };
}

/**
 * ElectionDetailFile.rowsByEmd → ChildrenTable.
 * 각 rowsByEmd entry 는 emd 단위. kindRows 합산하여 emd 별 byParty/total 산출.
 * emdCode 가 null 일 수 있어 (sigungu 잔여) — 그 경우 row 건너뜀.
 * 상위 7 정당 + justice 컬럼 노출.
 */
export function buildChildrenTable(
  detail: ElectionDetailFile,
  parties: PartyMeta[],
  index: StaticIndex,
  parentSigunguCode: string,
): ChildrenTable {
  // emdCode → name 사전 (index 의 emdByRegion 우선, 없으면 detail.emdName 사용)
  const emdMetaList = index.regions.emdByRegion?.[parentSigunguCode] ?? [];
  const emdNameByCode = new Map(emdMetaList.map((r) => [r.code, r.name]));

  type Row = { code: string; name: string; byParty: Record<string, number>; total: number };
  const rowsByCode = new Map<string, Row>();
  const partySum = new Map<string, number>();

  for (const er of detail.rowsByEmd) {
    if (!er.emdCode) continue; // sigungu 자체 잔여 행
    const name = emdNameByCode.get(er.emdCode) ?? er.emdName ?? er.emdCode;
    const row: Row = rowsByCode.get(er.emdCode) ?? {
      code: er.emdCode,
      name,
      byParty: {},
      total: 0,
    };
    for (const kr of er.kindRows) {
      for (const bp of kr.byParty) {
        if (!bp.partyId) continue;
        row.byParty[bp.partyId] = (row.byParty[bp.partyId] ?? 0) + bp.votes;
        partySum.set(bp.partyId, (partySum.get(bp.partyId) ?? 0) + bp.votes);
        row.total += bp.votes;
      }
    }
    rowsByCode.set(er.emdCode, row);
  }

  // 상위 7 정당 + justice
  const ranked = [...partySum.entries()].sort((a, b) => b[1] - a[1]).map(([pid]) => pid);
  const topPartyIds = new Set(ranked.slice(0, 7));
  topPartyIds.add("justice");
  const pById = new Map(parties.map((p) => [p.id, p]));
  const partyColumns = [...topPartyIds]
    .filter((pid) => pById.has(pid))
    .map((pid) => {
      const p = pById.get(pid)!;
      return { partyId: pid, partyName: p.name, color: p.color };
    });

  // 정의당 기본 0 보장
  for (const row of rowsByCode.values()) {
    if (!("justice" in row.byParty)) {
      row.byParty["justice"] = 0;
    }
  }

  const children = [...rowsByCode.values()].sort((a, b) => b.total - a.total);
  return { children, partyColumns };
}

/**
 * ElectionDetailFile.rowsByEmd → PresubElDayResult.
 * 'presub' kind 와 'el_day' kind 행이 함께 존재해야 hasData=true.
 * scope='children' 만 호출됨 (sigungu 페이지에서). emd 페이지는 page.tsx 에서 호출 자체를 skip.
 */
export function buildPresubVsElDay(
  detail: ElectionDetailFile,
  index: StaticIndex,
  parentSigunguCode: string,
): PresubElDayResult {
  // emdCode → name lookup
  const emdMetaList = index.regions.emdByRegion?.[parentSigunguCode] ?? [];
  const emdNameByCode = new Map(emdMetaList.map((r) => [r.code, r.name]));

  // emdCode × partyId → { presub, elDay }
  type Acc = { presub: number; elDay: number };
  const acc = new Map<string, { regionCode: string; regionName: string; partyId: string } & Acc>();
  let anyKindData = false;

  for (const er of detail.rowsByEmd) {
    if (!er.emdCode) continue;
    const regionName = emdNameByCode.get(er.emdCode) ?? er.emdName ?? er.emdCode;
    for (const kr of er.kindRows) {
      const isPresub = kr.kind === "presub";
      const isElDay = kr.kind === "el_day";
      if (!isPresub && !isElDay) continue;
      anyKindData = true;
      for (const bp of kr.byParty) {
        if (!bp.partyId) continue;
        const key = `${er.emdCode}|${bp.partyId}`;
        const cur = acc.get(key) ?? {
          regionCode: er.emdCode,
          regionName,
          partyId: bp.partyId,
          presub: 0,
          elDay: 0,
        };
        if (isPresub) cur.presub += bp.votes;
        if (isElDay) cur.elDay += bp.votes;
        acc.set(key, cur);
      }
    }
  }

  if (!anyKindData || acc.size === 0) {
    return { hasData: false, rows: [] };
  }
  return { hasData: true, rows: [...acc.values()] };
}


/**
 * RegionFile.elections 안에 존재하는 electionId 중 index.elections 기준 displayOrder desc 정렬.
 * 재보궐 제외. /region/[code] 페이지의 election picker 옵션 + 기본 election 결정에 사용.
 */
export function pickRegionElections(
  region: RegionFile,
  index: StaticIndex,
): ElectionMeta[] {
  const available = new Set(region.elections.map((e) => e.electionId));
  return [...index.elections]
    .filter((e) => !e.isByelection && available.has(e.id))
    .sort((a, b) => b.displayOrder - a.displayOrder);
}
