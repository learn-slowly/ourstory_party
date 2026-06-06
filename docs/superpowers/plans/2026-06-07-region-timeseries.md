# 지역 시계열 표 보강 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/region/[code]` 페이지에 홈과 동일한 풍부한 시계열 차트+표 보기를 추가 (정의당 단일 미니 차트 → 다정당 차트+표 토글 + CSV + 풀 필터).

**Architecture:** `TimeseriesPanel` 컴포넌트를 `HomeView`에서 추출, `HeaderControls`에 `hideRegionPicker` prop 추가, 신규 `RegionTimeseries` client 컴포넌트가 두 공유 컴포넌트를 region 컨텍스트로 호출. 홈과 region이 `buildHomeChart`를 공유. URL 양방향 보존: `?election=` ↔ `?types/parties/satellite/merge_prog/from/to`.

**Tech Stack:** Next.js 16 RSC + TypeScript + Tailwind CSS + Recharts + vitest (node env, 순수 로직 테스트만).

**Spec:** `docs/superpowers/specs/2026-06-07-region-timeseries-design.md` (커밋 `71ebecb`).

---

## 파일 구조

**신규:**
- `src/components/TimeseriesPanel.tsx` — 차트/표 토글 + CSV 버튼 + HomeChart/HomeTable 래퍼
- `src/components/region/RegionTimeseries.tsx` — region 페이지용 풀 컨트롤 시계열 client 컴포넌트
- `tests/unit/election-picker-url-preserve.test.ts` — buildRegionUrl 시계열 쿼리 보존 테스트
- `tests/unit/region-timeseries-state.test.ts` — `normalizeRegionState` 헬퍼 테스트

**수정:**
- `src/components/HomeView.tsx` — 인라인 토글 코드 → `<TimeseriesPanel>`로 교체
- `src/components/HeaderControls.tsx` — `hideRegionPicker` prop 추가
- `src/components/region/ElectionPicker.tsx` — 현재 searchParams 읽어 `buildRegionUrl`에 전달
- `src/components/region/election-picker-url.ts` — `buildRegionUrl(code, electionId, currentSearch?)` 시그니처
- `src/components/region/RegionView.tsx` — `RegionMiniSeries` → `RegionTimeseries` 교체, props 변경
- `src/app/region/[code]/page.tsx` — `buildRegionTimeseries` 호출 삭제, `parseSearchParams`/`buildFilterOptions` 추가, 새 props 전달

**삭제:**
- `src/components/region/RegionMiniSeries.tsx`
- `src/lib/static-region.ts`의 `buildRegionTimeseries` 함수 (다른 곳 미사용)

**신규 헬퍼 (`src/lib/url-state.ts`에 추가):**
- `normalizeRegionState(raw: HomeState): HomeState` — region 페이지에서 state.region을 default로 강제

---

## Task 1: `normalizeRegionState` 헬퍼 추가 (TDD)

순수 함수 먼저. region 페이지에서 사용자가 URL에 `?region=foo`를 넣어도 무시되도록.

**Files:**
- Create: `tests/unit/region-timeseries-state.test.ts`
- Modify: `src/lib/url-state.ts` (export 추가)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/region-timeseries-state.test.ts
import { describe, it, expect } from "vitest";
import { normalizeRegionState, DEFAULT_STATE, type HomeState } from "../../src/lib/url-state";

describe("normalizeRegionState", () => {
  it("state.region 을 DEFAULT_STATE.region 으로 강제", () => {
    const input: HomeState = {
      ...DEFAULT_STATE,
      region: "4817000000",
      parties: ["justice", "labor"],
    };
    const out = normalizeRegionState(input);
    expect(out.region).toBe(DEFAULT_STATE.region);
    expect(out.parties).toEqual(["justice", "labor"]);
  });

  it("다른 필드는 그대로", () => {
    const input: HomeState = {
      ...DEFAULT_STATE,
      region: "anything",
      satellite: "merged",
      mergeProgressive: true,
      from: "2014",
      to: "2024",
      types: ["governor"],
    };
    const out = normalizeRegionState(input);
    expect(out.satellite).toBe("merged");
    expect(out.mergeProgressive).toBe(true);
    expect(out.from).toBe("2014");
    expect(out.to).toBe("2024");
    expect(out.types).toEqual(["governor"]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd ~/coding/ourstory && pnpm test region-timeseries-state -- --run`
Expected: FAIL — `normalizeRegionState is not a function`

- [ ] **Step 3: 구현 — `src/lib/url-state.ts` 끝에 추가**

```ts
// region 페이지 전용 — URL ?region= 쿼리를 무시하고 default 로 강제.
// encodeState 가 default 와 같으면 region 키를 자동 생략하므로, region 페이지 URL 에 region 쿼리가 누출되지 않음.
export function normalizeRegionState(raw: HomeState): HomeState {
  return { ...raw, region: DEFAULT_STATE.region };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd ~/coding/ourstory && pnpm test region-timeseries-state -- --run`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
cd ~/coding/ourstory
git add tests/unit/region-timeseries-state.test.ts src/lib/url-state.ts
git commit -m "feat: normalizeRegionState 헬퍼 — region 페이지에서 ?region= 쿼리 무시

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `buildRegionUrl` 시계열 쿼리 보존 (TDD)

ElectionPicker 가 선거를 바꿔도 사용자가 켜둔 시계열 필터(`?parties=...&satellite=merged`)가 사라지지 않도록.

**Files:**
- Create: `tests/unit/election-picker-url-preserve.test.ts`
- Modify: `src/components/region/election-picker-url.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/election-picker-url-preserve.test.ts
import { describe, it, expect } from "vitest";
import { buildRegionUrl } from "../../src/components/region/election-picker-url";

describe("buildRegionUrl with currentSearch", () => {
  it("currentSearch 미지정 — 기존 시그니처 호환", () => {
    expect(buildRegionUrl("4817000000", "20240410")).toBe(
      "/region/4817000000?election=20240410",
    );
  });

  it("currentSearch 의 시계열 키 보존 — parties/satellite/merge_prog/types/from/to", () => {
    const params = new URLSearchParams("parties=justice,labor&satellite=merged&merge_prog=1");
    const url = buildRegionUrl("4817000000", "20240410", params);
    expect(url).toContain("/region/4817000000?");
    expect(url).toContain("election=20240410");
    expect(url).toContain("parties=justice%2Clabor");
    expect(url).toContain("satellite=merged");
    expect(url).toContain("merge_prog=1");
  });

  it("currentSearch 에 election 이 이미 있으면 새 값으로 덮어쓰기", () => {
    const params = new URLSearchParams("election=20200415&parties=justice");
    const url = buildRegionUrl("4817000000", "20240410", params);
    expect(url).toContain("election=20240410");
    expect(url).not.toContain("election=20200415");
  });

  it("synthetic 행정동 code (9 prefix) — 그대로 인코딩", () => {
    expect(buildRegionUrl("9171000001", "20240410")).toBe(
      "/region/9171000001?election=20240410",
    );
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd ~/coding/ourstory && pnpm test election-picker-url-preserve -- --run`
Expected: FAIL — 3번째 케이스부터 시그니처 불일치 또는 결과 누락

- [ ] **Step 3: 구현 — `src/components/region/election-picker-url.ts` 전체 재작성**

```ts
// ElectionPicker 의 URL 생성 로직. 순수 함수로 분리해 client 컴포넌트 없이 단위 테스트.
// currentSearch 가 주어지면 그 안의 다른 쿼리 키(시계열 필터)를 보존하고 election 만 갱신.
export function buildRegionUrl(
  regionCode: string,
  electionId: string,
  currentSearch?: URLSearchParams | null,
): string {
  const params = new URLSearchParams(currentSearch ? currentSearch.toString() : "");
  params.set("election", electionId);
  return `/region/${encodeURIComponent(regionCode)}?${params.toString()}`;
}
```

- [ ] **Step 4: 테스트 통과 확인 — 기존 election-picker.test.ts 도 함께 통과**

Run: `cd ~/coding/ourstory && pnpm test election-picker -- --run`
Expected: PASS — 기존 3 케이스 + 신규 4 케이스 모두 통과

- [ ] **Step 5: 커밋**

```bash
cd ~/coding/ourstory
git add tests/unit/election-picker-url-preserve.test.ts src/components/region/election-picker-url.ts
git commit -m "feat: buildRegionUrl 시계열 쿼리 보존 — currentSearch 옵셔널 인자 추가

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `ElectionPicker` 가 현재 searchParams 를 buildRegionUrl 에 전달

**Files:**
- Modify: `src/components/region/ElectionPicker.tsx`

- [ ] **Step 1: 컴포넌트 패치**

`src/components/region/ElectionPicker.tsx` 전체 교체:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { buildRegionUrl } from "./election-picker-url";

interface ElectionOption {
  id: string;
  name: string;
}

interface Props {
  selectedId: string;
  options: ElectionOption[];
  regionCode: string;
}

export function ElectionPicker({ selectedId, options, regionCode }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-zinc-500">선거</span>
      <select
        value={selectedId}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(() => {
            router.push(buildRegionUrl(regionCode, next, searchParams));
          });
        }}
        className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      {pending && <span className="text-zinc-400 text-xs">…</span>}
    </label>
  );
}
```

- [ ] **Step 2: 타입 체크**

Run: `cd ~/coding/ourstory && pnpm exec tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
cd ~/coding/ourstory
git add src/components/region/ElectionPicker.tsx
git commit -m "feat: ElectionPicker 가 현재 searchParams 를 buildRegionUrl 에 전달 (필터 보존)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `TimeseriesPanel` 컴포넌트 추출

`HomeView` 의 차트/표 토글 + CSV 버튼 + HomeChart/HomeTable 블록을 별도 컴포넌트로 분리.

**Files:**
- Create: `src/components/TimeseriesPanel.tsx`
- Modify: `src/components/HomeView.tsx`

- [ ] **Step 1: `TimeseriesPanel` 신규 작성**

`src/components/TimeseriesPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { HomeChart } from "./HomeChart";
import { HomeTable, downloadCsv } from "./HomeTable";
import type { ChartRow, ChartLine } from "../lib/series";

interface Props {
  data: ChartRow[];
  lines: ChartLine[];
  csvFilename?: string;
}

// 차트/표 토글 + CSV 버튼 + chart 또는 table 렌더.
// viewMode 는 컴포넌트 내부 상태 (URL 비동기화). 홈·region 페이지 둘 다 이 컴포넌트 사용.
export function TimeseriesPanel({ data, lines, csvFilename = "timeseries.csv" }: Props) {
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");

  return (
    <>
      <div className="flex items-center gap-1 flex-wrap">
        <div className="inline-flex rounded border border-zinc-300 dark:border-zinc-700 overflow-hidden">
          <button
            type="button"
            onClick={() => setViewMode("chart")}
            className={`px-3 py-1 text-sm ${
              viewMode === "chart"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-white text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
            }`}
            aria-pressed={viewMode === "chart"}
          >
            차트
          </button>
          <button
            type="button"
            onClick={() => setViewMode("table")}
            className={`px-3 py-1 text-sm border-l border-zinc-300 dark:border-zinc-700 ${
              viewMode === "table"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-white text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
            }`}
            aria-pressed={viewMode === "table"}
          >
            표
          </button>
        </div>
        {viewMode === "table" && data.length > 0 && (
          <button
            type="button"
            onClick={() => downloadCsv(data, lines, csvFilename)}
            className="ml-2 px-3 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            CSV 저장
          </button>
        )}
      </div>
      {viewMode === "chart" ? (
        <HomeChart data={data} lines={lines} />
      ) : (
        <HomeTable data={data} lines={lines} />
      )}
    </>
  );
}
```

- [ ] **Step 2: `HomeView` 리팩터 — 인라인 블록 → `<TimeseriesPanel>`**

`src/components/HomeView.tsx` 의 다음 블록을 교체:

**삭제 (62번째 줄 부근부터, `<div className="flex items-center gap-1 flex-wrap">` 부터 `<HomeTable data={data} lines={lines} />` 닫는 `)`까지 약 45줄):**

```tsx
      <div className="flex items-center gap-1 flex-wrap">
        <div className="inline-flex rounded border ...">
          ...차트/표 토글 버튼...
        </div>
        {viewMode === "table" && data.length > 0 && (
          <button ...>CSV 저장</button>
        )}
      </div>
      {viewMode === "chart" ? (
        <HomeChart data={data} lines={lines} />
      ) : (
        <HomeTable data={data} lines={lines} />
      )}
```

**대체:**

```tsx
      <TimeseriesPanel data={data} lines={lines} />
```

또한 import 정리:
- `import { HomeChart } from "./HomeChart";` 삭제
- `import { HomeTable, downloadCsv } from "./HomeTable";` 삭제
- `import { TimeseriesPanel } from "./TimeseriesPanel";` 추가
- `const [viewMode, setViewMode] = useState<"chart" | "table">("chart");` 삭제 (이제 패널 내부)
- 더 이상 사용 안 하는 `downloadCsv` import 도 정리

- [ ] **Step 3: 타입 체크 + 테스트**

Run: `cd ~/coding/ourstory && pnpm exec tsc --noEmit && pnpm test -- --run`
Expected: 에러 없음, 모든 테스트 PASS

- [ ] **Step 4: 수동 확인 — 홈 동작 변화 없음**

Run: `cd ~/coding/ourstory && pnpm dev`
브라우저에서 `http://localhost:3000` 열고:
- 차트 보이는지 확인
- "표" 버튼 클릭 → 표 보이는지 확인
- "CSV 저장" 버튼 보이고 클릭 시 다운로드 되는지 확인
- 정당/유형/연도/위성/진보 토글 동작 확인

확인 끝나면 dev 서버 Ctrl+C.

- [ ] **Step 5: 커밋**

```bash
cd ~/coding/ourstory
git add src/components/TimeseriesPanel.tsx src/components/HomeView.tsx
git commit -m "refactor: TimeseriesPanel 추출 — 차트/표 토글 + CSV 버튼 + HomeChart/HomeTable

홈·region 페이지에서 공유 사용 가능. HomeView 동작 변화 없음.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `HeaderControls` 에 `hideRegionPicker` prop 추가

**Files:**
- Modify: `src/components/HeaderControls.tsx`

- [ ] **Step 1: Props 인터페이스 + 조건 렌더 추가**

`src/components/HeaderControls.tsx` 패치 2곳:

**(1) Props 인터페이스 (46~56번째 줄 부근):**

```ts
interface Props {
  state: HomeState;
  onChange: (next: HomeState) => void;
  pending?: boolean;
  regions: RegionOpt[];
  emdOptions: EmdOpt[];
  stationOptions: StationOpt[];
  types: string[];
  parties: PartyOpt[];
  yearOptions: string[];
  hideRegionPicker?: boolean;  // 신규 — region 페이지에서 true
}
```

**(2) 함수 시그니처:**

```ts
export function HeaderControls({
  state, onChange, pending, regions, emdOptions, stationOptions,
  types, parties, yearOptions, hideRegionPicker,
}: Props) {
```

**(3) 지역 select 블록을 `{!hideRegionPicker && (...)}` 로 감싸기:**

122번째 줄 부근의 `<label className="flex items-center gap-2">` 블록 전체 (지역 4단 select):

```tsx
      {!hideRegionPicker && (
        <label className="flex items-center gap-2">
          <span className="text-zinc-600 dark:text-zinc-400">지역</span>
          <select
            value={selSido}
            ...
          >
            ...
          </select>
          ...4개 select 전부...
        </label>
      )}
```

- [ ] **Step 2: 타입 체크**

Run: `cd ~/coding/ourstory && pnpm exec tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 테스트 확인 (기존 테스트 영향 없음)**

Run: `cd ~/coding/ourstory && pnpm test -- --run`
Expected: 기존 테스트 모두 PASS

- [ ] **Step 4: 커밋**

```bash
cd ~/coding/ourstory
git add src/components/HeaderControls.tsx
git commit -m "feat: HeaderControls hideRegionPicker prop — 지역 picker 숨김

region 페이지 시계열 섹션에서 사용 — 지역은 URL path 로 고정.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `RegionTimeseries` 신규 client 컴포넌트

**Files:**
- Create: `src/components/region/RegionTimeseries.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`src/components/region/RegionTimeseries.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HeaderControls } from "../HeaderControls";
import { TimeseriesPanel } from "../TimeseriesPanel";
import { buildHomeChart } from "@/lib/static-series";
import { encodeState, type HomeState } from "@/lib/url-state";
import type { ElectionMeta, PartyMeta, TimeseriesPoint } from "@/types/static";

interface PartyOpt {
  id: string;
  name: string;
  family: string;
  color: string;
  satelliteOf?: string | null;
}

interface Props {
  regionCode: string;
  regionName: string;
  timeseries: Record<string, TimeseriesPoint[]>;
  initialState: HomeState;
  filterOptions: {
    types: string[];
    parties: PartyOpt[];
    yearOptions: string[];
  };
  elections: ElectionMeta[];
  parties: PartyMeta[];
}

// region 페이지의 시계열 섹션. 홈과 동일한 buildHomeChart + HeaderControls + TimeseriesPanel 재사용.
// 차이: 지역은 URL path 로 고정 (hideRegionPicker), region 페이지의 다른 쿼리(?election=) 보존.
export function RegionTimeseries({
  regionCode,
  regionName,
  timeseries,
  initialState,
  filterOptions,
  elections,
  parties,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // optimistic state — 토글 즉시 local 반영. URL 갱신은 background.
  const [optimisticState, setOptimisticState] = useState<HomeState>(initialState);
  useEffect(() => setOptimisticState(initialState), [initialState]);

  // 단일 source — 이 region 의 timeseries 만.
  const sources = useMemo(() => [{ timeseries }], [timeseries]);

  const { data, lines } = useMemo(
    () => buildHomeChart({ state: optimisticState, elections, parties, sources }),
    [optimisticState, elections, parties, sources],
  );

  function handleChange(next: HomeState) {
    setOptimisticState(next);
    const qs = encodeState(next);
    // 기존 ?election= 보존
    const election = searchParams.get("election");
    const params = new URLSearchParams(qs);
    if (election) params.set("election", election);
    const url = params.size > 0
      ? `/region/${regionCode}?${params.toString()}`
      : `/region/${regionCode}`;
    startTransition(() => router.push(url));
  }

  return (
    <section
      aria-labelledby="sec-series"
      className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-3"
    >
      <h2 id="sec-series" className="text-sm font-semibold">
        시계열 — {regionName}
      </h2>
      <HeaderControls
        state={optimisticState}
        onChange={handleChange}
        pending={pending}
        regions={[]}
        emdOptions={[]}
        stationOptions={[]}
        types={filterOptions.types}
        parties={filterOptions.parties}
        yearOptions={filterOptions.yearOptions}
        hideRegionPicker
      />
      <TimeseriesPanel
        data={data}
        lines={lines}
        csvFilename={`timeseries-${regionName}.csv`}
      />
    </section>
  );
}
```

- [ ] **Step 2: 타입 체크**

Run: `cd ~/coding/ourstory && pnpm exec tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋 (RegionView 통합은 다음 task 에서)**

```bash
cd ~/coding/ourstory
git add src/components/region/RegionTimeseries.tsx
git commit -m "feat: RegionTimeseries 컴포넌트 — region 페이지 시계열 (다정당 차트+표+CSV)

HeaderControls(hideRegionPicker) + TimeseriesPanel + buildHomeChart 재사용.
ElectionPicker 의 ?election= 쿼리 보존.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `/region/[code]/page.tsx` + `RegionView` 통합

`buildRegionTimeseries` 호출 제거, `RegionTimeseries` props 페치, `RegionView` 시그니처 변경.

**Files:**
- Modify: `src/app/region/[code]/page.tsx`
- Modify: `src/components/region/RegionView.tsx`

- [ ] **Step 1: `/region/[code]/page.tsx` 패치**

상단 import 정리:

```ts
import { notFound } from "next/navigation";
import {
  getIndex,
  getRegionFile,
  getElectionDetail,
  listAllRegionCodes,
} from "@/lib/static-data";
import {
  buildRegionContext,
  buildRegionDistribution,
  buildChildrenTable,
  buildPresubVsElDay,
  pickRegionElections,
} from "@/lib/static-region";
import { buildFilterOptions } from "@/lib/static-series";
import { parseSearchParams, normalizeRegionState } from "@/lib/url-state";
import { RegionView } from "@/components/region/RegionView";
```

(주의: `buildRegionTimeseries` import 삭제)

함수 시그니처 변경 — searchParams 받기:

```ts
interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RegionPage({ params, searchParams }: PageProps) {
  const { code } = await params;
  const sp = await searchParams;
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) {
    flat[k] = Array.isArray(v) ? v[0] : v;
  }
  const initialState = normalizeRegionState(parseSearchParams(flat));

  if (!/^\d{10}$/.test(code)) notFound();

  const index = await getIndex();
  let regionFile;
  try {
    regionFile = await getRegionFile(code);
  } catch {
    notFound();
  }

  const ctx = buildRegionContext(regionFile, index);

  const electionOptions = pickRegionElections(regionFile, index);
  if (electionOptions.length === 0) notFound();
  const election = electionOptions[0];

  const dist = buildRegionDistribution(regionFile, election.id, index.parties, index.elections);

  let table = null;
  let presub = null;
  if (ctx.level !== "emd") {
    try {
      const detail = await getElectionDetail(code, election.id);
      table = buildChildrenTable(detail, index.parties, index, code);
      presub = buildPresubVsElDay(detail, index, code);
    } catch {
      table = { children: [], partyColumns: [] };
      presub = { hasData: false, rows: [] };
    }
  }

  const filterOptions = buildFilterOptions({
    parties: index.parties,
    elections: index.elections,
    sido: index.regions.sido,
    sigunguByRegion: index.regions.sigunguByRegion,
  });

  return (
    <RegionView
      ctx={ctx}
      election={{ id: election.id, name: election.name }}
      electionOptions={electionOptions.map((e) => ({ id: e.id, name: e.name }))}
      dist={dist}
      table={table}
      presub={presub}
      regionCode={code}
      regionName={regionFile.name}
      timeseries={regionFile.timeseries}
      initialState={initialState}
      filterOptions={filterOptions}
      elections={index.elections}
      parties={index.parties}
    />
  );
}
```

**주의:** `force-static` 페이지가 searchParams 를 await 하면 동작 변화가 있을 수 있음. Next.js 15+에서 `force-static` + `searchParams` 조합은 빌드 타임 SSG 가 안 되고 dynamic 으로 fallback 함. 만약 빌드가 실패하면, `searchParams` 대신 client 컴포넌트(`RegionTimeseries`)에서 `useSearchParams`로 직접 읽도록 변경 (Step 1-alt 참조).

- [ ] **Step 1-alt: (Step 1 빌드 실패 시) RegionTimeseries 가 직접 useSearchParams 로 읽도록**

`src/app/region/[code]/page.tsx` 의 searchParams 부분 제거하고 `initialState` 안 넘김:

```ts
// page.tsx 에서 searchParams / initialState 제거
export default async function RegionPage({ params }: PageProps) {
  // ...기존과 동일, initialState 빼고...
}
```

`src/components/region/RegionTimeseries.tsx` 의 initialState prop 제거하고 client 측에서 parseSearchParams 호출:

```tsx
import { parseSearchParams, normalizeRegionState, DEFAULT_STATE } from "@/lib/url-state";

// Props 에서 initialState 제거
// 함수 안에서:
const sp = useSearchParams();
const flat = Object.fromEntries(sp.entries());
const initialState = useMemo(() => normalizeRegionState(parseSearchParams(flat)), [sp]);
```

**판정**: Step 2(빌드 확인)에서 결정. 정상 빌드되면 Step 1 유지, 실패하면 1-alt 로 전환.

- [ ] **Step 2: `RegionView` 패치**

`src/components/region/RegionView.tsx` 전체 교체:

```tsx
import type {
  RegionDistribution,
  ChildrenTable,
  PresubElDayResult,
  RegionContext,
} from "@/lib/region-types";
import type { ElectionMeta, PartyMeta, TimeseriesPoint } from "@/types/static";
import type { HomeState } from "@/lib/url-state";
import { Breadcrumb } from "./Breadcrumb";
import { ElectionPicker } from "./ElectionPicker";
import { RegionPartyDist } from "./RegionPartyDist";
import { RegionChildrenTable } from "./RegionChildrenTable";
import { PresubVsElDay } from "./PresubVsElDay";
import { RegionTimeseries } from "./RegionTimeseries";

interface ElectionLike {
  id: string;
  name: string;
}

interface PartyOpt {
  id: string;
  name: string;
  family: string;
  color: string;
  satelliteOf?: string | null;
}

interface Props {
  ctx: RegionContext;
  election: ElectionLike;
  electionOptions: ElectionLike[];
  dist: RegionDistribution;
  table: ChildrenTable | null;
  presub: PresubElDayResult | null;
  regionCode: string;
  regionName: string;
  timeseries: Record<string, TimeseriesPoint[]>;
  initialState: HomeState;
  filterOptions: { types: string[]; parties: PartyOpt[]; yearOptions: string[] };
  elections: ElectionMeta[];
  parties: PartyMeta[];
}

export function RegionView({
  ctx, election, electionOptions, dist, table, presub,
  regionCode, regionName, timeseries, initialState, filterOptions, elections, parties,
}: Props) {
  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <header>
        <Breadcrumb ancestors={ctx.ancestors} current={ctx.region} electionQuery={election.id} />
        <div className="flex flex-wrap items-baseline gap-3 mt-1">
          <h1 className="text-xl font-bold">
            {ctx.region.name}
            <span className="text-zinc-400 mx-2">·</span>
            <span className="text-zinc-700 dark:text-zinc-300">{election.name}</span>
          </h1>
          <ElectionPicker selectedId={election.id} options={electionOptions} regionCode={ctx.region.code} />
        </div>
      </header>

      <RegionPartyDist dist={dist} />

      {table && <RegionChildrenTable table={table} electionId={election.id} />}

      {presub && ctx.level !== "emd" && <PresubVsElDay presub={presub} />}

      <RegionTimeseries
        regionCode={regionCode}
        regionName={regionName}
        timeseries={timeseries}
        initialState={initialState}
        filterOptions={filterOptions}
        elections={elections}
        parties={parties}
      />
    </div>
  );
}
```

- [ ] **Step 3: 타입 체크 + 정적 빌드 시도**

Run: `cd ~/coding/ourstory && pnpm exec tsc --noEmit`
Expected: 에러 없음

Run: `cd ~/coding/ourstory && pnpm build:static`
Expected: 에러 없음 (`public/data/static/**` 갱신)

- [ ] **Step 4: 빌드 시도 — searchParams + force-static 호환성 확인**

Run: `cd ~/coding/ourstory && pnpm next build`
Expected: PASS. 만약 "Page with `dynamic = force-static` couldn't be rendered statically because it used `searchParams`" 류 에러 나면 Step 1-alt 적용.

- [ ] **Step 5: 단위 테스트 회귀**

Run: `cd ~/coding/ourstory && pnpm test -- --run`
Expected: 모든 테스트 PASS

- [ ] **Step 6: 커밋**

```bash
cd ~/coding/ourstory
git add src/app/region/[code]/page.tsx src/components/region/RegionView.tsx
git commit -m "feat: /region/[code] 시계열 섹션을 RegionTimeseries 로 교체

- RegionMiniSeries (정의당 단일 미니 차트) → RegionTimeseries (다정당 차트+표+CSV+풀 필터)
- searchParams 받아 시계열 필터 상태 복원
- buildFilterOptions/buildRegionTimeseries 호출 정리

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 미사용 코드 삭제 (`RegionMiniSeries` + `buildRegionTimeseries`)

**Files:**
- Delete: `src/components/region/RegionMiniSeries.tsx`
- Modify: `src/lib/static-region.ts` (buildRegionTimeseries 함수 삭제)

- [ ] **Step 1: 참조 확인 — 다른 곳에서 사용 안 함**

Run: `cd ~/coding/ourstory && grep -rn "RegionMiniSeries\|buildRegionTimeseries" src tests --include="*.ts" --include="*.tsx"`
Expected: `src/lib/static-region.ts` 의 정의 + 주석 외 참조 없음. 있으면 같이 정리.

- [ ] **Step 2: 파일/함수 삭제**

```bash
cd ~/coding/ourstory
rm src/components/region/RegionMiniSeries.tsx
```

`src/lib/static-region.ts` 에서 `buildRegionTimeseries` 함수(`export function buildRegionTimeseries(...)` 블록 전체) 삭제. 상단 주석에서 `RegionMiniSeries` 언급 부분도 정리.

`src/lib/static-region.ts` 가 더 이상 `SeriesPoint`/`QueryElectionMeta` 를 export 안 한다면 unused import 도 정리.

- [ ] **Step 3: 타입 체크 + 테스트**

Run: `cd ~/coding/ourstory && pnpm exec tsc --noEmit && pnpm test -- --run`
Expected: 에러 없음, 모든 테스트 PASS

- [ ] **Step 4: 커밋**

```bash
cd ~/coding/ourstory
git add -A
git commit -m "chore: RegionMiniSeries 컴포넌트 + buildRegionTimeseries 함수 제거

RegionTimeseries 가 다정당 시계열 + 차트/표/CSV 를 모두 커버 — 미니 차트 헬퍼 미사용.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: 수동 회귀 — 홈 + 3 region 레벨 + URL 공유

타입·단위 테스트가 못 잡는 UX 회귀 확인.

- [ ] **Step 1: dev 서버 띄우기**

Run: `cd ~/coding/ourstory && pnpm dev`
브라우저: `http://localhost:3000`

- [ ] **Step 2: 홈 회귀**

- 차트 보이는지
- 차트 → 표 토글 → 표 보이는지 + CSV 버튼 보이는지
- CSV 다운로드 → 파일 열어보면 정당 열 + 선거 행
- 정당 체크/해제 → 차트·표 즉시 반영
- 시·도 → 시·군·구 → 읍·면·동 cascade picker 동작 확인
- 위성정당 합산 토글
- 진보 합산 라인 토글
- 기간 (from~to) 토글

- [ ] **Step 3: region sigungu 페이지 — `/region/4817000000` (진주시)**

- 페이지 로드
- 하단에 "시계열 — 진주시" 섹션
- 정당/선거유형/위성/진보/연도 컨트롤 보임 — 지역 picker 없음 확인
- 차트 → 표 토글
- CSV 다운로드 → 파일명 `timeseries-진주시.csv`
- 정당 토글 → 차트·표·URL 즉시 반영
- 위 ElectionPicker 에서 선거 바꾸기 → 시계열 필터(`?parties=`) 보존되는지 URL 확인

- [ ] **Step 4: region emd 페이지 — `/region/4817031000` (월산동, 코드 확인 필요)**

- 시군 페이지에서 "월산동" 클릭 → emd 페이지 이동
- 시계열 섹션 표시 (정의당 외 정당 데이터 있는지 확인)
- 표 보기 → "—" 칸이 있을 수 있음 (해당 emd 에 데이터 없는 선거)
- CSV 파일명 `timeseries-월산동.csv`
- emd 코드를 모르면 dev 서버에서 진주시 페이지 → "동" 표 클릭으로 진입

- [ ] **Step 5: region sido 페이지 — `/region/4800000000` (경상남도)**

- 시계열 섹션 표시
- 데이터 풍부 (전 정당 + 모든 선거)

- [ ] **Step 6: URL 공유 확인**

- region 페이지에서 필터 조작 → 새 URL 복사
- 다른 탭(시크릿 창) 에서 같은 URL 열기 → 동일 상태 복원 확인

- [ ] **Step 7: dev 서버 종료**

Ctrl+C

- [ ] **Step 8: 최종 빌드 확인**

Run: `cd ~/coding/ourstory && pnpm build`
Expected: 빌드 성공, 정적 페이지 갱신

- [ ] **Step 9: 회귀 결과 기록 — 발견된 회귀 없으면 노트만 남기고 끝**

회귀 발견 시 새 task 만들어 fix → 회귀 재확인.

---

## 자체 검토 체크리스트

- [ ] 스펙의 "동기" → Task 6, 7 이 RegionTimeseries 로 회의용 데이터 노출 충족
- [ ] 스펙의 "컴포넌트 인터페이스" → Task 4 (TimeseriesPanel), 5 (HeaderControls), 6 (RegionTimeseries), 7 (page+RegionView)
- [ ] 스펙의 "URL 상태" → Task 1 (normalizeRegionState), 2 (buildRegionUrl preserve), 3 (ElectionPicker), 6 (RegionTimeseries handleChange)
- [ ] 스펙의 "오류 처리" → buildHomeChart/HomeTable 기존 동작 재사용 — 새 코드 없음, Task 9 에서 수동 확인
- [ ] 스펙의 "테스트" → Task 1, 2 신규 단위 테스트, 나머지는 vitest node env 한계로 manual smoke (Task 9)
- [ ] 스펙의 "마이그레이션 / 호환성" → Task 7 force-static + searchParams 호환성 케이스 처리 (Step 1-alt)
- [ ] 스펙의 "삭제" → Task 8

전체 spec 커버리지 OK.
