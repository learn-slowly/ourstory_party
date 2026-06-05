# ourstory Phase 1.3.0 — region query 함수 + 단위 테스트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/lib/queries.ts` 에 region 상세 페이지(`/region/[code]`)용 query 함수 5개와 12개 단위 테스트를 추가한다.

**Architecture:** Drizzle ORM 기반 5 함수 — `getRegionContext` (region·ancestors·children + level), `getRegionDistribution` (한 선거 × 한 region 의 정당별 분포), `getRegionChildrenTable` (children × 정당 matrix), `getPresubVsElDay` (관내사전 vs 선거일 분해), `getRegionTimeseries` (한 region 의 한 정당 역대 추이). 기존 `getTimeseries`·`getLiveSnapshot` 의 join 패턴 재사용. 테스트는 라이브 Supabase 사용 (기존 `region-resolver.test.ts` 와 동일 패턴, 적재된 2024·2022 데이터로 검증).

**Tech Stack:** TypeScript / Drizzle ORM 0.45 / postgres.js / vitest

선행 spec: `docs/superpowers/specs/2026-06-05-ourstory-phase-1.3-region-detail-design.md` (§ 새 query 함수, § 오류·예외 처리)
선행 phase: Phase 5.4 완료 (8 election polling_stations 적재).

---

## 파일 구조

| 파일 | 동작 | 책임 |
|------|------|------|
| `src/lib/queries.ts` | Modify (append 5 functions + 4 interfaces + 1 helper) | RSC 가 호출하는 region 페이지용 데이터 fetch |
| `tests/unit/region-queries.test.ts` | Create | 5 함수 × 평균 2~3 케이스 = 12 테스트 |

기존 `queries.ts` 가 400줄 미만이라 한 파일에 같이 두고, 본 phase 에선 분리 없음. 1.3.1 이후 컴포넌트 추가 시 다시 평가.

테스트는 라이브 DB 호출 (단위 테스트 분류이지만 통합 성격). 기존 패턴 `region-resolver.test.ts` 와 동일.

---

## Task 1: `getRegionContext` — level 감지 + ancestors·children

**Files:**
- Modify: `src/lib/queries.ts` (append)
- Modify: `tests/unit/region-queries.test.ts` (create + 첫 describe)

- [ ] **Step 1: 테스트 파일 생성 + 첫 3 테스트 (실패 상태)**

`tests/unit/region-queries.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import {
  getRegionContext,
  getRegionDistribution,
  getRegionChildrenTable,
  getPresubVsElDay,
  getRegionTimeseries,
} from "../../src/lib/queries";

describe("getRegionContext", () => {
  it("sido (4800000000 경상남도) — level=sido, ancestors=[], children=시·군·구들", async () => {
    const r = await getRegionContext("4800000000");
    expect(r.level).toBe("sido");
    expect(r.region.name).toBe("경상남도");
    expect(r.ancestors).toEqual([]);
    expect(r.children.length).toBeGreaterThan(15); // 경남 시·군 18개 + sub-구 포함
    expect(r.children.every((c) => c.parentCode === "4800000000" || c.parentCode?.startsWith("48"))).toBe(true);
  });

  it("sigungu (4817000000 진주시) — level=sigungu, ancestors=[경남], children=emd들", async () => {
    const r = await getRegionContext("4817000000");
    expect(r.level).toBe("sigungu");
    expect(r.region.name).toBe("진주시");
    expect(r.ancestors.length).toBe(1);
    expect(r.ancestors[0].name).toBe("경상남도");
    expect(r.children.length).toBeGreaterThan(10); // 진주시 emd 다수
    expect(r.children.every((c) => c.level === "emd")).toBe(true);
  });

  it("미존재 code → null 반환 (caller 가 notFound 처리)", async () => {
    const r = await getRegionContext("0000000001");
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행 → 첫 3개 FAIL 확인**

```bash
cd ~/coding/ourstory && pnpm test region-queries 2>&1 | tail -10
```

Expected: 3 tests FAIL (함수 정의 안 됨, import 에러).

- [ ] **Step 3: `getRegionContext` 구현**

`src/lib/queries.ts` 파일 끝에 append:

```ts
// ─── /region/[code] 페이지용 query 함수들 ─────────────────────────────────

import type { regions as regionsTable } from "../../db/schema";
type RegionRow = typeof regionsTable.$inferSelect;

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

  const ancestors: RegionRow[] = [];
  let cur: RegionRow = region;
  while (cur.parentCode) {
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
    level: region.level as "sido" | "sigungu" | "emd",
  };
}
```

`import` 줄에서 누락된 것 보강 — 파일 상단의 import block 확인:
- `eq` 이미 import 됨
- `regions` 이미 import 됨

추가 import 필요한 것 없음.

- [ ] **Step 4: 테스트 PASS 확인**

```bash
cd ~/coding/ourstory && pnpm test region-queries 2>&1 | tail -10
```

Expected: 3 tests PASS.

- [ ] **Step 5: 디버깅 가이드 (필요 시)**

| 실패 | 원인 후보 |
|------|----------|
| `r.region.name` undefined | regions 테이블에 4800000000 행 없음. `pnpm ingest:seed:regions` 실행 |
| `ancestors.length` ≠ 기대값 | parent_code 가 null 인 케이스 — 세종(`3611000000`) 처럼 특수 자치시는 0 일 수 있음 |

---

## Task 2: `getRegionDistribution` — 한 선거 × region 의 정당별 분포

**Files:**
- Modify: `src/lib/queries.ts` (append)
- Modify: `tests/unit/region-queries.test.ts` (append)

- [ ] **Step 1: 테스트 3개 추가**

`tests/unit/region-queries.test.ts` 파일 끝에 append:

```ts
describe("getRegionDistribution", () => {
  it("2024-general-prop × 경상남도 — raceKind=party + 정당 다수 + 정의당 포함", async () => {
    const r = await getRegionDistribution("2024-general-prop", "4800000000");
    expect(r.raceKind).toBe("party");
    expect(r.rows.length).toBeGreaterThan(3);
    expect(r.totalVotes).toBeGreaterThan(0);
    const justice = r.rows.find((x) => x.partyId === "justice");
    expect(justice).toBeDefined();
    expect(justice!.share).toBeGreaterThanOrEqual(0);
    expect(justice!.share).toBeLessThan(1);
  });

  it("2024-general × 종로구 (1111000000) — raceKind=candidate (necCode=2)", async () => {
    const r = await getRegionDistribution("2024-general", "1111000000");
    expect(r.raceKind).toBe("candidate");
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it("미존재 election → 빈 결과 (rows=[], totalVotes=0)", async () => {
    const r = await getRegionDistribution("not-an-election", "4800000000");
    expect(r.rows).toEqual([]);
    expect(r.totalVotes).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 3 FAIL 확인**

```bash
cd ~/coding/ourstory && pnpm test region-queries 2>&1 | grep -E "PASS|FAIL|✓|×" | tail -10
```

Expected: getRegionContext 3 PASS, getRegionDistribution 3 FAIL.

- [ ] **Step 3: 구현 추가**

`src/lib/queries.ts` 끝에 append:

```ts
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
        prevShare: null, // 직전 비교는 후속 task 또는 client side. 본 phase 는 placeholder
      };
    })
    .sort((a, b) => b.votes - a.votes);

  return { rows, totalVotes, raceKind };
}
```

**참고**: `prevShare` 는 직전 동일 type 선거 lookup 이 복잡 — 본 phase 는 null 로 두고 향후 1.3.2 (섹션 A 컴포넌트) 에서 별도 query 또는 client-side 계산.

- [ ] **Step 4: 테스트 PASS 확인**

```bash
cd ~/coding/ourstory && pnpm test region-queries 2>&1 | tail -10
```

Expected: 6 tests PASS.

---

## Task 3: `getRegionChildrenTable` — children × 정당 matrix

**Files:**
- Modify: `src/lib/queries.ts` (append)
- Modify: `tests/unit/region-queries.test.ts` (append)

- [ ] **Step 1: 테스트 2개 추가**

```ts
describe("getRegionChildrenTable", () => {
  it("2024-general-prop × 경상남도 — children 다수 + 정당 컬럼 다수", async () => {
    const r = await getRegionChildrenTable("2024-general-prop", "4800000000");
    expect(r.children.length).toBeGreaterThan(15);
    expect(r.partyColumns.length).toBeGreaterThan(3);
    // 정의당이 partyColumns 에 항상 포함
    expect(r.partyColumns.some((p) => p.partyId === "justice")).toBe(true);
    // 첫 child 의 byParty 가 partyColumns 와 매칭
    const firstChild = r.children[0];
    expect(typeof firstChild.byParty["justice"]).toBe("number");
    expect(firstChild.total).toBeGreaterThan(0);
  });

  it("2024-general-prop × 진주시 (4817000000) — emd children", async () => {
    const r = await getRegionChildrenTable("2024-general-prop", "4817000000");
    expect(r.children.length).toBeGreaterThan(5);
    // total 내림차순 정렬 검증
    for (let i = 1; i < r.children.length; i++) {
      expect(r.children[i - 1].total).toBeGreaterThanOrEqual(r.children[i].total);
    }
  });
});
```

- [ ] **Step 2: 테스트 실행 → 2 FAIL 확인**

```bash
cd ~/coding/ourstory && pnpm test region-queries 2>&1 | tail -10
```

Expected: 6 PASS + 2 FAIL.

- [ ] **Step 3: 구현**

```ts
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

  // 정당별 합산 → 상위 N (≤ 8) + justice 항상 포함
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

  const children = [...byCode.values()].sort((a, b) => b.total - a.total);
  return { children, partyColumns };
}
```

- [ ] **Step 4: 테스트 PASS 확인**

```bash
cd ~/coding/ourstory && pnpm test region-queries 2>&1 | tail -10
```

Expected: 8 PASS.

---

## Task 4: `getPresubVsElDay` — 관내사전 vs 선거일 분해

**Files:**
- Modify: `src/lib/queries.ts` (append)
- Modify: `tests/unit/region-queries.test.ts` (append)

- [ ] **Step 1: 테스트 2개 추가**

```ts
describe("getPresubVsElDay", () => {
  it("2024-general-prop × 진주시 children scope — adapted election OK", async () => {
    const r = await getPresubVsElDay("2024-general-prop", "4817000000", "children");
    expect(r.hasData).toBe(true);
    expect(r.rows.length).toBeGreaterThan(5);
    // 정의당 row 있어야 함
    expect(r.rows.some((x) => x.partyId === "justice")).toBe(true);
    // presub + elDay 합이 양수
    const justice = r.rows.find((x) => x.partyId === "justice")!;
    expect(justice.presub + justice.elDay).toBeGreaterThan(0);
  });

  it("polling 없는 election (2022-local-mayor) → hasData=false", async () => {
    const r = await getPresubVsElDay("2022-local-mayor", "4817000000", "children");
    expect(r.hasData).toBe(false);
    expect(r.rows).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 2 FAIL 확인**

```bash
cd ~/coding/ourstory && pnpm test region-queries 2>&1 | tail -10
```

- [ ] **Step 3: 구현**

`src/lib/queries.ts` 상단 import block 의 schema import 에 `pollingStations, pollingStationVotes` 추가 필요 — 기존 import 라인을 확장:

기존:
```ts
import { elections, parties, regions, regionTotals, voteTotals } from "../../db/schema";
```

다음으로 교체:
```ts
import {
  elections, parties, regions, regionTotals, voteTotals,
  pollingStations, pollingStationVotes,
} from "../../db/schema";
```

함수 추가:

```ts
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
  // drizzle 의 group_by 보다 직접 raw sql 사용
  const rows = await sql<
    { region_code: string; party_id: string; presub: number; el_day: number }[]
  >`
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
```

추가 import 필요: `sql` (postgres.js raw query). 파일 상단의 import block:

기존:
```ts
import { db } from "./db";
```

다음으로 교체 (`src/lib/db.ts` 가 `db` 와 `sql` 둘 다 export 함, 확인 완료):
```ts
import { db, sql } from "./db";
```

- [ ] **Step 4: 테스트 PASS 확인**

```bash
cd ~/coding/ourstory && pnpm test region-queries 2>&1 | tail -10
```

Expected: 10 PASS.

---

## Task 5: `getRegionTimeseries` — 한 region 의 한 정당 역대 추이

**Files:**
- Modify: `src/lib/queries.ts` (append)
- Modify: `tests/unit/region-queries.test.ts` (append)

- [ ] **Step 1: 테스트 2개 추가**

```ts
describe("getRegionTimeseries", () => {
  it("경상남도 (4800000000) × justice — election 다수, 시계열 정렬", async () => {
    const r = await getRegionTimeseries("4800000000", "justice");
    expect(r.length).toBeGreaterThan(3);
    // election.displayOrder 순서로 정렬
    for (let i = 1; i < r.length; i++) {
      const aOrder = r[i - 1].election.displayOrder ?? 0;
      const bOrder = r[i].election.displayOrder ?? 0;
      expect(bOrder).toBeGreaterThanOrEqual(aOrder);
    }
    // 모든 row 의 partyId = justice
    expect(r.every((x) => x.partyId === "justice")).toBe(true);
  });

  it("미존재 region 또는 정당 → 빈 배열", async () => {
    const r = await getRegionTimeseries("0000000001", "justice");
    expect(r).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 2 FAIL 확인**

```bash
cd ~/coding/ourstory && pnpm test region-queries 2>&1 | tail -10
```

- [ ] **Step 3: 구현**

```ts
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
      sharePct: total && total > 0 ? (v / total) * 100 : null,
    });
  }

  return series;
}
```

**중요**: 기존 `queries.ts` 의 `SeriesPoint` 정의를 그대로 따라야 함 (홈 chart 와 호환).
필드명이 위 sample 과 다르면(예: `sharePct` vs `share`) 기존 정의를 우선해 코드 수정.
구현 시 첫 단계에서 `grep -A 15 "interface SeriesPoint" src/lib/queries.ts` 로 확인 후 그 shape 그대로 사용.

- [ ] **Step 4: 테스트 PASS 확인**

```bash
cd ~/coding/ourstory && pnpm test region-queries 2>&1 | tail -10
```

Expected: 12 PASS.

- [ ] **Step 5: 전체 회귀 확인**

```bash
cd ~/coding/ourstory && pnpm test 2>&1 | tail -5
```

Expected: 기존 54 + 신규 12 = 66 tests PASS.

---

## Task 6: 커밋

**Files:**
- 스테이지: `src/lib/queries.ts`, `tests/unit/region-queries.test.ts`

- [ ] **Step 1: 변경 확인**

```bash
git -C ~/coding/ourstory status
git -C ~/coding/ourstory diff --stat
```

Expected:
- `src/lib/queries.ts` (modified — 함수 5개 + 타입 8개 정도 append, 60~80줄 import 확장)
- `tests/unit/region-queries.test.ts` (new file)

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -E "queries\.ts|region-queries" | head -5
```

Expected: 출력 없음.

- [ ] **Step 3: 커밋**

```bash
git -C ~/coding/ourstory add src/lib/queries.ts tests/unit/region-queries.test.ts
git -C ~/coding/ourstory commit -m "$(cat <<'EOF'
ourstory Phase 1.3.0 — region query 함수 5개 + 12 단위 테스트

/region/[code] 페이지용 데이터 fetch 기반.

  getRegionContext        region · ancestors · children · level
  getRegionDistribution   한 선거 × region 의 정당별 분포 (raceKind 자동)
  getRegionChildrenTable  children 행 × 정당 컬럼 matrix
  getPresubVsElDay        emd × 정당별 (관내사전 vs 선거일) 합
  getRegionTimeseries     한 region 의 한 정당 역대 추이

테스트는 라이브 DB 사용 (적재된 2024·2022 데이터). 66/66 PASS.
prevShare 직전 동일 type 선거 비교는 Phase 1.3.2 (섹션 A 컴포넌트) 에서.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(controller 가 review 후 커밋하는 패턴이면 본 Step 3 는 컨트롤러 담당.)

---

## 검증 체크리스트 (Phase 1.3.0 완료 조건)

- [ ] `pnpm test region-queries` → 12 신규 PASS
- [ ] `pnpm test` → 전체 PASS (기존 54 + 신규 12 = 66)
- [ ] `pnpm tsc --noEmit` → queries.ts·region-queries 관련 에러 없음
- [ ] queries.ts 의 새 함수 5개 모두 export 됨
- [ ] 커밋 메시지가 위 형식대로

다섯 항목 통과 시 Phase 1.3.0 완료. 다음 Phase 1.3.1 (page.tsx + base layout + ElectionPicker) 플랜 작성.
