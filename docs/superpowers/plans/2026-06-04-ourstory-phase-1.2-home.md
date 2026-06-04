# ourstory Phase 1.2 (홈 시계열 차트) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/` 홈에 전국·시·도 단위 시계열 차트 + 5개 헤더 컨트롤(지역·선거유형·정당·위성정당 토글·진보 합산 토글) + 통계 카드 + URL 상태 동기화를 구현한다. spec § 6 풀범위.

**Architecture:** Next.js 15 RSC 가 URL searchParams 를 받아 DB 에서 시계열 데이터 fetch 후 클라이언트 컴포넌트에 전달. 사용자 필터 변경 → `useRouter.push(새 URL)` → RSC 재실행. Recharts LineChart, jp-in-gn 색상·정당 강조 패턴 이식.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Drizzle ORM(anon), Recharts ^3.8, Tailwind CSS 4.

---

## 데이터 모델 — 시계열 한 datapoint 의미

`series` 한 행 = `(election, partyId, votes, totalVotes, pct)`
- `election`: id·date·type·name·displayOrder
- `partyId`: parties.id
- `votes`: 해당 election + region + party 의 vote_totals.votes (시·도/시·군 합산 — 필터에 따라)
- `totalVotes`: 해당 election + region 의 region_totals.total_votes (분모)
- `pct`: `votes / totalVotes * 100`, 소수점 1자리 (jp-in-gn 규칙)

전국 = `region_code` 가 `시·도 17개의 코드 셋` 인 vote_totals 합. (또는 `대한민국|합계` 행이 있으면 그걸 사용 — 시·도지사 같은 선거는 전국 합계 행이 없으므로 시·도 합 권장.)

특정 시·도 = `region_code = '<sido_code>'` (예: 경상남도 4800000000) 시·도 합계 행.

---

## File Structure

```
ourstory/
├── src/
│   ├── app/
│   │   ├── page.tsx                          # MODIFY: RSC, URL → 데이터 fetch → 클라이언트 컴포넌트 전달
│   │   └── layout.tsx                        # 기존 그대로
│   ├── components/
│   │   ├── HomeView.tsx                      # 신규 (client) — 헤더 + 차트 + 카드 조합
│   │   ├── HeaderControls.tsx                # 신규 (client) — 5개 컨트롤
│   │   ├── HomeChart.tsx                     # 신규 (client) — Recharts LineChart
│   │   ├── StatsCards.tsx                    # 신규 (server or client) — 직전 ±%p, 고점·저점
│   │   ├── PartyCheckbox.tsx                 # 신규 (client) — 정당 체크박스 그리드 컴포넌트
│   │   └── (기존: Header.tsx, Footer.tsx, ThemeToggle.tsx 유지)
│   ├── lib/
│   │   ├── url-state.ts                      # 신규 — URL searchParams 인코딩/디코딩 + base64 압축
│   │   ├── queries.ts                        # 신규 — DB 쿼리 함수 (anon)
│   │   └── series.ts                         # 신규 — 데이터 → 차트용 시계열 변환
└── tests/unit/
    ├── url-state.test.ts                     # 신규 (TDD)
    └── series.test.ts                        # 신규 (TDD)
```

---

## URL 상태 형식 (jp-in-gn 패턴 이식)

```
/?region=48&types=presidential,general_prop,governor&parties=justice,labor,green,progressive&satellite=merged&merge_prog=1
```

- `region`: `all` (기본) | regions.code (예: `48` 경남)
- `types`: 콤마 구분 elections.type 셋 (기본 `all` = 전체)
- `parties`: 콤마 구분 parties.id 셋 (기본 `justice,labor,green,progressive`)
- `satellite`: `split` (기본, 위성정당 별도) | `merged` (본당 합산)
- `merge_prog`: `1` (진보 합산 라인 표시) | (기본 0)

긴 상태 (압축):
- `/?s=<base64url>` — 위 객체를 JSON → base64url 인코딩
- 정확히 jp-in-gn 의 `STORAGE_KEY v2` 와 동일 패턴

---

## Task 1: url-state.ts (TDD)

**Files:**
- Create: `src/lib/url-state.ts`
- Create: `tests/unit/url-state.test.ts`

- [ ] **Step 1: 테스트 작성**

`tests/unit/url-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSearchParams, encodeState, type HomeState } from "../../src/lib/url-state";

const DEFAULT: HomeState = {
  region: "all",
  types: "all",
  parties: ["justice", "labor", "green", "progressive"],
  satellite: "split",
  mergeProgressive: false,
};

describe("parseSearchParams", () => {
  it("빈 params 면 기본값 반환", () => {
    expect(parseSearchParams({})).toEqual(DEFAULT);
  });

  it("region/types/parties/satellite/merge_prog 파싱", () => {
    expect(parseSearchParams({
      region: "48",
      types: "governor,general_prop",
      parties: "justice,labor",
      satellite: "merged",
      merge_prog: "1",
    })).toEqual({
      region: "48",
      types: ["governor", "general_prop"],
      parties: ["justice", "labor"],
      satellite: "merged",
      mergeProgressive: true,
    });
  });

  it("base64url 압축 상태 ?s= 디코딩", () => {
    const json = JSON.stringify({ region: "48", parties: ["justice"], satellite: "merged" });
    const s = Buffer.from(json).toString("base64url");
    const parsed = parseSearchParams({ s });
    expect(parsed.region).toBe("48");
    expect(parsed.parties).toEqual(["justice"]);
    expect(parsed.satellite).toBe("merged");
  });
});

describe("encodeState", () => {
  it("기본값은 빈 query 로", () => {
    expect(encodeState(DEFAULT)).toBe("");
  });

  it("non-default 만 query 에 포함", () => {
    expect(encodeState({ ...DEFAULT, region: "48", mergeProgressive: true }))
      .toBe("region=48&merge_prog=1");
  });
});
```

- [ ] **Step 2: url-state 구현**

`src/lib/url-state.ts`:

```ts
export interface HomeState {
  region: string;                                              // "all" 또는 regions.code
  types: string[] | "all";                                     // ["governor", ...] 또는 "all"
  parties: string[];                                           // ["justice", ...]
  satellite: "split" | "merged";
  mergeProgressive: boolean;
}

export const DEFAULT_STATE: HomeState = {
  region: "all",
  types: "all",
  parties: ["justice", "labor", "green", "progressive"],
  satellite: "split",
  mergeProgressive: false,
};

export function parseSearchParams(sp: Record<string, string | undefined>): HomeState {
  // 압축 상태가 있으면 그것을 우선
  if (sp.s) {
    try {
      const json = Buffer.from(sp.s, "base64url").toString("utf-8");
      const obj = JSON.parse(json);
      return { ...DEFAULT_STATE, ...obj };
    } catch {
      // fallthrough — 잘못된 압축 무시하고 기본값
    }
  }
  return {
    region: sp.region ?? DEFAULT_STATE.region,
    types: sp.types == null ? DEFAULT_STATE.types : sp.types.split(","),
    parties: sp.parties == null ? DEFAULT_STATE.parties : sp.parties.split(","),
    satellite: (sp.satellite as HomeState["satellite"]) ?? DEFAULT_STATE.satellite,
    mergeProgressive: sp.merge_prog === "1",
  };
}

export function encodeState(s: HomeState): string {
  const parts: string[] = [];
  if (s.region !== DEFAULT_STATE.region) parts.push(`region=${s.region}`);
  if (s.types !== DEFAULT_STATE.types && Array.isArray(s.types) && s.types.length > 0) {
    parts.push(`types=${s.types.join(",")}`);
  }
  if (JSON.stringify(s.parties) !== JSON.stringify(DEFAULT_STATE.parties)) {
    parts.push(`parties=${s.parties.join(",")}`);
  }
  if (s.satellite !== DEFAULT_STATE.satellite) parts.push(`satellite=${s.satellite}`);
  if (s.mergeProgressive) parts.push(`merge_prog=1`);
  return parts.join("&");
}
```

- [ ] **Step 3: 테스트 PASS 확인**

Run: `pnpm test tests/unit/url-state.test.ts`
Expected: 5 tests PASS

- [ ] **Step 4: 커밋**

```sh
git add src/lib/url-state.ts tests/unit/url-state.test.ts
git commit -m "url-state — searchParams 인코딩/디코딩 + base64url 압축 + 단위 테스트"
```

---

## Task 2: queries.ts (DB 쿼리 함수)

**Files:**
- Create: `src/lib/queries.ts`

- [ ] **Step 1: queries 구현**

`src/lib/queries.ts`:

```ts
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import { elections, parties, partyAliases, regions, regionTotals, voteTotals } from "../../db/schema";
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
  pct: number | null;          // votes / totalVotes * 100, 1 decimal
}

const PROGRESSIVE_FAMILIES = ["justice", "labor", "green", "progressive", "historical_progressive"];

/**
 * URL 상태 → 시계열 데이터.
 * - region: 'all' 이면 시·도 17개 합. region.code 이면 해당 지역만.
 * - types: 'all' 이면 전체 (isByelection=false), 배열이면 해당 type 만.
 * - parties: 표시할 party.id 목록.
 * - satellite: 'merged' 면 satelliteOf 가진 정당 표를 본당으로 합산.
 * - mergeProgressive: true 면 PROGRESSIVE_FAMILIES 합산을 별도 라인 "progressive_merged" 로 추가.
 */
export async function getTimeseries(state: HomeState): Promise<SeriesPoint[]> {
  // 1) 대상 elections
  const baseElections = await db.select().from(elections).where(eq(elections.isByelection, false)).orderBy(elections.displayOrder);
  const filteredElections = state.types === "all"
    ? baseElections
    : baseElections.filter((e) => (state.types as string[]).includes(e.type));

  if (filteredElections.length === 0) return [];

  // 2) 대상 parties (satellite merged 일 때 위성 → 본당 매핑)
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

  // 4) vote_totals 와 region_totals 조회 — election × region 셋
  const electionIds = filteredElections.map((e) => e.id);
  const votes = await db
    .select()
    .from(voteTotals)
    .where(and(inArray(voteTotals.electionId, electionIds), inArray(voteTotals.regionCode, targetRegions)));
  const regs = await db
    .select()
    .from(regionTotals)
    .where(and(inArray(regionTotals.electionId, electionIds), inArray(regionTotals.regionCode, targetRegions)));

  // 5) election × party 단위로 합산
  type Acc = { votes: number; totalVotes: number | null };
  const map = new Map<string, Acc>();                       // key = electionId|partyId

  for (const v of votes) {
    const effId = effectivePartyId(v.partyId);
    const key = `${v.electionId}|${effId}`;
    const cur = map.get(key) ?? { votes: 0, totalVotes: null };
    cur.votes += v.votes;
    map.set(key, cur);
  }

  // 6) totalVotes 합 (election × region 단위 region_totals 합)
  const totalByElection = new Map<string, number>();
  for (const r of regs) {
    if (r.totalVotes == null) continue;
    totalByElection.set(r.electionId, (totalByElection.get(r.electionId) ?? 0) + r.totalVotes);
  }

  // 7) SeriesPoint 배열 생성 (선택된 parties + mergeProgressive 라인)
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
    const pct = total != null && total > 0 ? Math.round((acc.votes / total) * 1000) / 10 : null;
    series.push({
      election: {
        id: meta.id, date: String(meta.date), type: meta.type, name: meta.name,
        displayOrder: meta.displayOrder, isByelection: meta.isByelection,
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

  // 8) mergeProgressive 라인 추가
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
      const pct = total != null && total > 0 ? Math.round((voteSum / total) * 1000) / 10 : null;
      series.push({
        election: {
          id: meta.id, date: String(meta.date), type: meta.type, name: meta.name,
          displayOrder: meta.displayOrder, isByelection: meta.isByelection,
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

/**
 * UI 필터링용 메타 fetch — 헤더 컨트롤 옵션 채울 때.
 */
export async function getFilterOptions() {
  const allRegions = await db.select().from(regions).orderBy(regions.code);
  const allElectionTypes = await db
    .selectDistinct({ type: elections.type })
    .from(elections)
    .where(eq(elections.isByelection, false));
  const allParties = await db.select().from(parties).orderBy(parties.id);
  return {
    regions: allRegions.filter((r) => r.level !== "emd"),    // 시·도 + 시·군 (emd는 너무 많아 제외)
    types: allElectionTypes.map((r) => r.type),
    parties: allParties,
  };
}
```

- [ ] **Step 2: 컴파일 확인 + 커밋**

```sh
pnpm tsc --noEmit
git add src/lib/queries.ts
git commit -m "queries — 홈 시계열 데이터 fetch (필터·위성 합산·진보 합산)"
```

---

## Task 3: series.ts (Recharts 데이터 변환) + 단위 테스트

**Files:**
- Create: `src/lib/series.ts`
- Create: `tests/unit/series.test.ts`

Recharts LineChart 는 x 축 한 datapoint 행에 모든 라인의 y 값을 가진 wide 형식을 받는다. 즉 SeriesPoint 배열을 election × party wide 매트릭스로 변환.

- [ ] **Step 1: 테스트 작성**

`tests/unit/series.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toRechartsData, type ChartLine } from "../../src/lib/series";
import type { SeriesPoint } from "../../src/lib/queries";

const electionA = { id: "e1", date: "2022-06-01", type: "governor", name: "지선A", displayOrder: 1, isByelection: false };
const electionB = { id: "e2", date: "2024-04-10", type: "general", name: "총선B", displayOrder: 2, isByelection: false };

const SAMPLE: SeriesPoint[] = [
  { election: electionA, partyId: "justice", partyName: "정의당", partyColor: "#FFCC00", partyFamily: "justice", votes: 100, totalVotes: 1000, pct: 10.0 },
  { election: electionA, partyId: "labor", partyName: "노동당", partyColor: "#A50034", partyFamily: "labor", votes: 50, totalVotes: 1000, pct: 5.0 },
  { election: electionB, partyId: "justice", partyName: "정의당", partyColor: "#FFCC00", partyFamily: "justice", votes: 80, totalVotes: 1200, pct: 6.7 },
];

describe("toRechartsData", () => {
  it("election 행 + 정당 컬럼 wide 매트릭스 + lines 메타", () => {
    const { data, lines } = toRechartsData(SAMPLE);
    expect(data).toEqual([
      { electionId: "e1", electionLabel: "지선A", date: "2022-06-01", displayOrder: 1, justice: 10.0, labor: 5.0 },
      { electionId: "e2", electionLabel: "총선B", date: "2024-04-10", displayOrder: 2, justice: 6.7 },
    ]);
    expect(lines).toEqual<ChartLine[]>([
      { partyId: "justice", name: "정의당", color: "#FFCC00", family: "justice" },
      { partyId: "labor", name: "노동당", color: "#A50034", family: "labor" },
    ]);
  });

  it("displayOrder 순으로 정렬", () => {
    const reversed = [
      { ...SAMPLE[2] },
      { ...SAMPLE[0] },
      { ...SAMPLE[1] },
    ];
    const { data } = toRechartsData(reversed);
    expect(data[0].electionId).toBe("e1");
    expect(data[1].electionId).toBe("e2");
  });
});
```

- [ ] **Step 2: 실패 확인 후 series.ts 구현**

`src/lib/series.ts`:

```ts
import type { SeriesPoint } from "./queries";

export interface ChartLine {
  partyId: string;
  name: string;
  color: string;
  family: string;
}

export interface ChartRow {
  electionId: string;
  electionLabel: string;
  date: string;
  displayOrder: number;
  [partyId: string]: number | string;
}

export function toRechartsData(points: SeriesPoint[]): { data: ChartRow[]; lines: ChartLine[] } {
  const rowsByElection = new Map<string, ChartRow>();
  const lineByParty = new Map<string, ChartLine>();

  for (const p of points) {
    const eid = p.election.id;
    let row = rowsByElection.get(eid);
    if (!row) {
      row = {
        electionId: eid,
        electionLabel: p.election.name,
        date: p.election.date,
        displayOrder: p.election.displayOrder ?? 0,
      };
      rowsByElection.set(eid, row);
    }
    if (p.pct != null) row[p.partyId] = p.pct;

    if (!lineByParty.has(p.partyId)) {
      lineByParty.set(p.partyId, {
        partyId: p.partyId, name: p.partyName, color: p.partyColor, family: p.partyFamily,
      });
    }
  }

  const data = [...rowsByElection.values()].sort((a, b) => a.displayOrder - b.displayOrder);
  // lines: 정의당 우선, 그 다음 입력 순서 유지
  const linesArr = [...lineByParty.values()];
  linesArr.sort((a, b) => {
    if (a.partyId === "justice") return -1;
    if (b.partyId === "justice") return 1;
    return 0;
  });
  return { data, lines: linesArr };
}
```

- [ ] **Step 3: 테스트 통과 + 커밋**

```sh
pnpm test tests/unit/series.test.ts
git add src/lib/series.ts tests/unit/series.test.ts
git commit -m "series — SeriesPoint → Recharts wide 데이터 변환 + 정의당 우선 + 단위 테스트"
```

---

## Task 4: HomeChart 컴포넌트

**Files:**
- Create: `src/components/HomeChart.tsx`

- [ ] **Step 1: HomeChart 구현**

`src/components/HomeChart.tsx`:

```tsx
"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { ChartRow, ChartLine } from "../lib/series";

interface Props { data: ChartRow[]; lines: ChartLine[]; }

export function HomeChart({ data, lines }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-[420px] flex items-center justify-center text-sm text-zinc-500">
        선택된 필터에 해당하는 데이터가 없습니다.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={420}>
      <LineChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid stroke="rgba(0,0,0,0.06)" vertical={false} />
        <XAxis
          dataKey="electionLabel"
          tick={{ fontSize: 11 }}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={70}
        />
        <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(value: number, name: string) => [`${value}%`, name]}
          contentStyle={{ fontSize: 12 }}
        />
        {lines.map((l) => (
          <Line
            key={l.partyId}
            type="monotone"
            dataKey={l.partyId}
            name={l.name}
            stroke={l.color}
            strokeWidth={l.partyId === "justice" ? 3 : 2}
            dot={{ r: l.partyId === "justice" ? 4 : 3 }}
            isAnimationActive={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: 커밋**

```sh
git add src/components/HomeChart.tsx
git commit -m "HomeChart — Recharts LineChart 컴포넌트 (정의당 강조)"
```

---

## Task 5: HeaderControls (5개 컨트롤)

**Files:**
- Create: `src/components/HeaderControls.tsx`

- [ ] **Step 1: HeaderControls 구현**

`src/components/HeaderControls.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { HomeState } from "../lib/url-state";
import { DEFAULT_STATE, encodeState } from "../lib/url-state";

interface RegionOpt { code: string; level: string; name: string; }
interface PartyOpt { id: string; name: string; family: string; color: string; satelliteOf?: string | null; }

interface Props {
  state: HomeState;
  regions: RegionOpt[];
  types: string[];
  parties: PartyOpt[];
}

const TYPE_LABEL: Record<string, string> = {
  presidential: "대선",
  general: "총선 지역구",
  general_prop: "총선 비례",
  governor: "지선 광역단체장",
  mayor: "지선 시장군수",
  local_council: "광역의원 지역구",
  local_council_prop: "광역의원 비례",
  local_council_basic: "기초의원 지역구",
  local_council_basic_prop: "기초의원 비례",
  superintendent: "교육감",
};

export function HeaderControls({ state, regions, types, parties }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function push(next: HomeState) {
    const qs = encodeState(next);
    start(() => router.push(qs ? `/?${qs}` : "/"));
  }

  function toggleParty(pid: string) {
    const next = state.parties.includes(pid)
      ? state.parties.filter((x) => x !== pid)
      : [...state.parties, pid];
    push({ ...state, parties: next });
  }

  function toggleType(t: string) {
    const cur = state.types === "all" ? types : state.types;
    const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
    push({ ...state, types: next.length === types.length ? "all" : next });
  }

  // 지역 옵션 — sido 만 우선 (Phase 1.3 에서 sigungu 까지)
  const sidos = regions.filter((r) => r.level === "sido");

  return (
    <div className={`flex flex-wrap gap-3 items-center text-sm ${pending ? "opacity-60" : ""}`}>
      {/* 지역 드롭다운 */}
      <label className="flex items-center gap-2">
        <span className="text-zinc-600 dark:text-zinc-400">지역</span>
        <select
          value={state.region}
          onChange={(e) => push({ ...state, region: e.target.value })}
          className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
        >
          <option value="all">전국</option>
          {sidos.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
        </select>
      </label>

      {/* 선거유형 체크박스 */}
      <div className="flex flex-wrap gap-2">
        <span className="text-zinc-600 dark:text-zinc-400">선거유형</span>
        {types.map((t) => {
          const checked = state.types === "all" || state.types.includes(t);
          return (
            <label key={t} className="flex items-center gap-1">
              <input type="checkbox" checked={checked} onChange={() => toggleType(t)} />
              <span>{TYPE_LABEL[t] ?? t}</span>
            </label>
          );
        })}
      </div>

      {/* 정당 체크박스 */}
      <div className="flex flex-wrap gap-2">
        <span className="text-zinc-600 dark:text-zinc-400">정당</span>
        {parties.filter((p) => p.id !== "independent" && p.id !== "other").map((p) => {
          const checked = state.parties.includes(p.id);
          return (
            <label key={p.id} className="flex items-center gap-1" style={{ color: checked ? p.color : undefined }}>
              <input type="checkbox" checked={checked} onChange={() => toggleParty(p.id)} />
              <span>{p.name}</span>
            </label>
          );
        })}
      </div>

      {/* 위성정당 합산 토글 */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={state.satellite === "merged"}
          onChange={(e) => push({ ...state, satellite: e.target.checked ? "merged" : "split" })}
        />
        <span>위성정당 합산</span>
      </label>

      {/* 진보 합산 토글 */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={state.mergeProgressive}
          onChange={(e) => push({ ...state, mergeProgressive: e.target.checked })}
        />
        <span>진보 합산 라인</span>
      </label>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```sh
git add src/components/HeaderControls.tsx
git commit -m "HeaderControls — 지역·선거유형·정당·위성·진보합산 5개 컨트롤"
```

---

## Task 6: StatsCards 통계 카드

**Files:**
- Create: `src/components/StatsCards.tsx`

- [ ] **Step 1: StatsCards 구현**

직전 선거 대비 ±%p, 고점·저점을 보여주는 정의당 중심 카드 3장.

`src/components/StatsCards.tsx`:

```tsx
import type { ChartRow, ChartLine } from "../lib/series";

interface Props { data: ChartRow[]; lines: ChartLine[]; focusPartyId?: string; }

export function StatsCards({ data, lines, focusPartyId = "justice" }: Props) {
  const line = lines.find((l) => l.partyId === focusPartyId) ?? lines[0];
  if (!line) return null;
  const series = data
    .map((row) => ({ election: row.electionLabel, pct: row[line.partyId] }))
    .filter((p): p is { election: string; pct: number } => typeof p.pct === "number");

  if (series.length === 0) return null;

  const last = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const delta = prev ? Math.round((last.pct - prev.pct) * 10) / 10 : null;
  const high = series.reduce((m, p) => (p.pct > m.pct ? p : m));
  const low = series.reduce((m, p) => (p.pct < m.pct ? p : m));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
      <Card
        title="직전 선거 대비"
        value={delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta}%p`}
        sub={prev ? `${prev.election} → ${last.election}` : `${last.election}`}
        color={line.color}
      />
      <Card
        title={`${line.name} 고점`}
        value={`${high.pct}%`}
        sub={high.election}
        color={line.color}
      />
      <Card
        title={`${line.name} 저점`}
        value={`${low.pct}%`}
        sub={low.election}
        color={line.color}
      />
    </div>
  );
}

function Card({ title, value, sub, color }: { title: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-3 bg-white dark:bg-zinc-900">
      <div className="text-xs text-zinc-500">{title}</div>
      <div className="text-2xl font-bold mt-1" style={{ color }}>{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{sub}</div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```sh
git add src/components/StatsCards.tsx
git commit -m "StatsCards — 직전 대비 ±%p, 고점·저점 (정의당 포커스)"
```

---

## Task 7: HomeView 결합 (client)

**Files:**
- Create: `src/components/HomeView.tsx`

`HomeView` 는 RSC 에서 받은 데이터를 HeaderControls·HomeChart·StatsCards 로 분배.

- [ ] **Step 1: HomeView 구현**

`src/components/HomeView.tsx`:

```tsx
"use client";

import { HeaderControls } from "./HeaderControls";
import { HomeChart } from "./HomeChart";
import { StatsCards } from "./StatsCards";
import type { HomeState } from "../lib/url-state";
import type { ChartRow, ChartLine } from "../lib/series";

interface RegionOpt { code: string; level: string; name: string; }
interface PartyOpt { id: string; name: string; family: string; color: string; satelliteOf?: string | null; }

interface Props {
  state: HomeState;
  filterOptions: { regions: RegionOpt[]; types: string[]; parties: PartyOpt[] };
  data: ChartRow[];
  lines: ChartLine[];
}

export function HomeView({ state, filterOptions, data, lines }: Props) {
  return (
    <div className="space-y-4">
      <HeaderControls state={state} regions={filterOptions.regions} types={filterOptions.types} parties={filterOptions.parties} />
      <HomeChart data={data} lines={lines} />
      <StatsCards data={data} lines={lines} />
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```sh
git add src/components/HomeView.tsx
git commit -m "HomeView — HeaderControls + HomeChart + StatsCards 결합"
```

---

## Task 8: page.tsx — RSC fetch + 전달

**Files:**
- Modify: `src/app/page.tsx`

기존 placeholder 페이지를 다음으로 교체.

- [ ] **Step 1: page.tsx 교체**

`src/app/page.tsx`:

```tsx
import { HomeView } from "../components/HomeView";
import { parseSearchParams } from "../lib/url-state";
import { getTimeseries, getFilterOptions } from "../lib/queries";
import { toRechartsData } from "../lib/series";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Home({ searchParams }: PageProps) {
  const sp = await searchParams;
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) {
    flat[k] = Array.isArray(v) ? v[0] : v;
  }
  const state = parseSearchParams(flat);
  const [series, filterOptions] = await Promise.all([getTimeseries(state), getFilterOptions()]);
  const { data, lines } = toRechartsData(series);

  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold mb-1">진보계열 정당 역대 선거 시계열</h1>
      <p className="text-sm text-zinc-500 mb-4">필터를 바꾸면 URL 이 함께 갱신됩니다 (공유 가능).</p>
      <HomeView state={state} filterOptions={filterOptions} data={data} lines={lines} />
    </main>
  );
}
```

- [ ] **Step 2: 빌드·로컬 점검**

```sh
pnpm build
pnpm dev &
sleep 4
curl -s "http://localhost:3000/" | grep -oE "<title>[^<]*</title>"
curl -s "http://localhost:3000/?parties=justice,labor" | grep -oE "(정의당|노동당)" | head -5
pkill -f "next dev" || true
```

Expected: title 정상, 정의당/노동당 키워드 본문에 포함.

- [ ] **Step 3: 커밋**

```sh
git add src/app/page.tsx
git commit -m "page — RSC, URL searchParams → 시계열 데이터 fetch + HomeView 렌더"
```

---

## Task 9: 라이브 스모크 + 회귀 확인

**Files:** (코드 변경 없음)

- [ ] **Step 1: 푸시 + Vercel 자동 빌드 대기**

```sh
git push
```

자동 배포 시 1~2 분 소요. `vercel ls` 또는 콘솔로 빌드 상태 확인.

- [ ] **Step 2: 라이브 응답 확인**

```sh
curl -sI https://jp-ourstory.vercel.app/ | head -3
curl -s "https://jp-ourstory.vercel.app/?parties=justice,labor" | grep -oE "(정의당|노동당|시계열)" | head -5
```

Expected:
- HTTP 200
- 정의당/노동당/시계열 키워드 본문 포함

- [ ] **Step 3: 다양한 필터 URL 점검**

다음 URL 각각이 200 반환하고 페이지가 깨지지 않는지:

- `/` (기본)
- `/?region=48` (경남)
- `/?parties=justice` (정의당만)
- `/?types=presidential,general_prop` (대선·총선 비례만)
- `/?satellite=merged&merge_prog=1` (위성 합산 + 진보 합산 라인)

각각 curl 응답 OK 면 PASS.

---

## Task 10: 메모리·문서 갱신

- [ ] **Step 1: README 갱신**

`ourstory/README.md` 에 한 줄 추가:

```markdown
- `/` 홈: 진보계열 정당 역대 선거 시계열 차트 + 5개 필터 (지역·선거유형·정당·위성 합산·진보 합산), URL 상태 동기화
```

- [ ] **Step 2: 커밋·푸시**

```sh
git add README.md
git commit -m "Phase 1.2 완료 — 홈 시계열 차트 + 5개 컨트롤 + URL 상태"
git push
```

---

## 완료 기준 (Phase 1.2 Done)

- [ ] `/` 라이브 페이지가 시계열 차트 + 5개 컨트롤 + 통계 카드 3장 표시
- [ ] URL 상태 동기화: 필터 변경 시 URL 갱신, URL 직접 입력 시 동일 상태 복원
- [ ] `pnpm test` 전체 PASS (기존 27 + 신규 url-state·series 약 7개)
- [ ] `pnpm build` PASS, Vercel 자동 배포 PASS
- [ ] 정의당 강조 — 차트에서 strokeWidth 3 + dot r=4, 색상 #FFCC00
- [ ] StatsCards 가 정의당 직전 ±%p, 고점·저점 표시
- [ ] 위성정당 합산 토글 ON 시 국민의미래·미래한국당·더불어민주연합·열린민주당 본당 합산
- [ ] 진보 합산 라인 토글 ON 시 정의·노동·녹색·진보·민주노동(시기 활성) 합산 라인 표시

완료 시 다음 plan (Phase 2 — 2014~2017 데이터 인제스천) 작성.
