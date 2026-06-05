# ourstory Phase 1.3.2~1.3.6 — region 4 섹션 본 구현 + fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1.3.1 의 4 섹션 placeholder 를 실제 데이터 렌더로 교체한다 — 정당별 분포(A) · 하위 표(B) · 사전 vs 선거일 분해(C) · 정의당 시계열 미니(D). 지역구 race 와 polling 미공개 election 의 fallback 도 같은 컴포넌트 안에서 처리.

**Architecture:** page.tsx 가 1.3.0 의 query 4종을 병렬 호출 → 결과를 RegionView 에 props 로 전달 → RegionView 가 4 컴포넌트로 분기 렌더. 각 컴포넌트는 서버 컴포넌트(데이터 props 받아 렌더만), 단 D 의 Recharts 는 client 전환 필요. fallback (지역구 후보자 모드 / hasData=false) 은 컴포넌트 안에서 branch.

**Tech Stack:** Next.js 16 RSC / React 19 / Tailwind / Recharts 3 / vitest / Playwright

선행 spec: `docs/superpowers/specs/2026-06-05-ourstory-phase-1.3-region-detail-design.md`
선행 phase: 1.3.0 (query 5개) · 1.3.1 (base layout + 4 placeholder) 완료.

---

## 파일 구조

| 파일 | 동작 | 책임 |
|------|------|------|
| `src/app/region/[code]/page.tsx` | Modify | 4 query 병렬 호출, RegionView 에 결과 전달 |
| `src/components/region/RegionView.tsx` | Modify | placeholder 4개 → 실제 컴포넌트로 교체, props 전달 |
| `src/components/region/RegionPartyDist.tsx` | Create | 섹션 A — 정당/후보자 막대 + 정의당 카드 |
| `src/components/region/RegionChildrenTable.tsx` | Create | 섹션 B — children 표, 정의당 컬럼 그라데이션, drilldown 링크 |
| `src/components/region/PresubVsElDay.tsx` | Create | 섹션 C — 정의당 사전 vs 선거일 비교 막대 (또는 fallback 메시지) |
| `src/components/region/RegionMiniSeries.tsx` | Create | 섹션 D — Recharts client, 정의당 단일 라인 |
| `src/lib/region-share-color.ts` | Create | 정의당 컬럼 그라데이션 helper + 단위 테스트 |
| `tests/unit/region-share-color.test.ts` | Create | 그라데이션 helper 3 테스트 |

다른 컴포넌트 unit test 는 라이브 DB 의존이 커서 비효율. Playwright smoke 로 4 URL 시각 검증.

---

## Task 1: page.tsx 에 4 query 추가 + RegionView 시그니처 변경

**Files:**
- Modify: `src/app/region/[code]/page.tsx`
- Modify: `src/components/region/RegionView.tsx`

- [ ] **Step 1: page.tsx 업데이트 — 4 query 병렬 호출**

`src/app/region/[code]/page.tsx` 전체를 다음으로 교체.

```tsx
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { elections } from "../../../../db/schema";
import {
  getRegionContext,
  getRegionDistribution,
  getRegionChildrenTable,
  getPresubVsElDay,
  getRegionTimeseries,
} from "@/lib/queries";
import { RegionView } from "@/components/region/RegionView";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RegionPage({ params, searchParams }: PageProps) {
  const { code } = await params;
  const sp = await searchParams;

  if (!/^\d{10}$/.test(code)) notFound();

  const [ctx, allElections] = await Promise.all([
    getRegionContext(code),
    db.select().from(elections)
      .where(eq(elections.isByelection, false))
      .orderBy(desc(elections.displayOrder)),
  ]);
  if (!ctx) notFound();
  if (allElections.length === 0) notFound();

  const electionParam = typeof sp.election === "string" ? sp.election : Array.isArray(sp.election) ? sp.election[0] : undefined;
  const election = (electionParam && allElections.find((e) => e.id === electionParam)) ?? allElections[0];

  // 4 query 병렬 호출 — emd level 은 B 섹션(children table) 표시 안 함
  const presubScope = ctx.level === "emd" ? "self" : "children";
  const [dist, table, presub, series] = await Promise.all([
    getRegionDistribution(election.id, code),
    ctx.level !== "emd" ? getRegionChildrenTable(election.id, code) : Promise.resolve(null),
    ctx.level !== "emd" ? getPresubVsElDay(election.id, code, presubScope) : Promise.resolve(null),
    getRegionTimeseries(code, "justice"),
  ]);

  return (
    <RegionView
      ctx={ctx}
      election={election}
      electionOptions={allElections.map((e) => ({ id: e.id, name: e.name }))}
      dist={dist}
      table={table}
      presub={presub}
      series={series}
    />
  );
}
```

- [ ] **Step 2: RegionView 시그니처 변경 + placeholder 교체**

`src/components/region/RegionView.tsx` 전체를 다음으로 교체.

```tsx
import type { regions as regionsTable } from "../../../db/schema";
import type {
  RegionDistribution,
  ChildrenTable,
  PresubElDayResult,
  SeriesPoint,
} from "@/lib/queries";
import { Breadcrumb } from "./Breadcrumb";
import { ElectionPicker } from "./ElectionPicker";
import { RegionPartyDist } from "./RegionPartyDist";
import { RegionChildrenTable } from "./RegionChildrenTable";
import { PresubVsElDay } from "./PresubVsElDay";
import { RegionMiniSeries } from "./RegionMiniSeries";

type RegionRow = typeof regionsTable.$inferSelect;

interface RegionContext {
  region: RegionRow;
  ancestors: RegionRow[];
  children: RegionRow[];
  level: "sido" | "sigungu" | "emd";
}

interface ElectionLike {
  id: string;
  name: string;
}

interface Props {
  ctx: RegionContext;
  election: ElectionLike;
  electionOptions: ElectionLike[];
  dist: RegionDistribution;
  table: ChildrenTable | null;
  presub: PresubElDayResult | null;
  series: SeriesPoint[];
}

export function RegionView({ ctx, election, electionOptions, dist, table, presub, series }: Props) {
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

      <RegionMiniSeries series={series} regionName={ctx.region.name} />
    </div>
  );
}
```

- [ ] **Step 3: 컴파일 확인 (4 컴포넌트 미존재 에러 예상)**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -E "RegionPartyDist|RegionChildrenTable|PresubVsElDay|RegionMiniSeries" | head -5
```

Expected: 4 컴포넌트 import 미존재 에러. Task 2~5 에서 해소.

---

## Task 2: RegionPartyDist (섹션 A) — 정당/후보자 막대 + 정의당 카드

**Files:**
- Create: `src/components/region/RegionPartyDist.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
import type { RegionDistribution } from "@/lib/queries";

interface Props {
  dist: RegionDistribution;
}

export function RegionPartyDist({ dist }: Props) {
  if (dist.totalVotes === 0) {
    return (
      <section aria-labelledby="sec-dist" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 id="sec-dist" className="text-sm font-semibold mb-2">
          {dist.raceKind === "candidate" ? "후보자별 득표" : "정당별 분포"}
        </h2>
        <p className="text-sm text-zinc-500">이 지역의 적재된 데이터가 없습니다.</p>
      </section>
    );
  }

  // 상위 8개 + justice 가 그 안에 없으면 명시 추가
  const ROW_LIMIT = 8;
  const top = dist.rows.slice(0, ROW_LIMIT);
  const justice = dist.rows.find((r) => r.partyId === "justice");
  const showJusticeCard = justice && justice.votes > 0;
  if (justice && !top.find((r) => r.partyId === "justice")) {
    top.push(justice);
  }
  const maxShare = Math.max(...top.map((r) => r.share));

  return (
    <section aria-labelledby="sec-dist" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 id="sec-dist" className="text-sm font-semibold">
          {dist.raceKind === "candidate" ? "후보자별 득표" : "정당별 분포"}
        </h2>
        <span className="text-xs text-zinc-500">총 {dist.totalVotes.toLocaleString()}표</span>
      </div>

      {/* 정의당 카드 — 비례·대선·광역단체장 race 에 한해, 후보자 race 면 partyId=justice 후보 1명에 해당 */}
      {showJusticeCard && (
        <div
          className="mb-4 rounded border-2 px-4 py-3"
          style={{ borderColor: justice!.color, backgroundColor: `${justice!.color}10` }}
        >
          <div className="text-xs text-zinc-500">{justice!.partyName}</div>
          <div className="text-2xl font-bold" style={{ color: justice!.color }}>
            {(justice!.share * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-zinc-500">{justice!.votes.toLocaleString()}표</div>
        </div>
      )}

      {/* 정당/후보자 막대 리스트 */}
      <ul className="space-y-1.5">
        {top.map((row) => {
          const isJustice = row.partyId === "justice";
          const widthPct = maxShare > 0 ? (row.share / maxShare) * 100 : 0;
          return (
            <li key={row.partyId} className="flex items-center gap-2 text-sm">
              <span
                className={`shrink-0 w-32 truncate ${isJustice ? "font-semibold" : ""}`}
                title={row.partyName}
              >
                {row.partyName}
              </span>
              <div className="flex-1 h-5 bg-zinc-100 dark:bg-zinc-800 rounded relative overflow-hidden">
                <div
                  className="h-full"
                  style={{ width: `${widthPct}%`, backgroundColor: row.color }}
                  aria-label={`${row.partyName} ${(row.share * 100).toFixed(1)}%`}
                />
              </div>
              <span className="shrink-0 w-14 text-right text-xs tabular-nums">
                {(row.share * 100).toFixed(1)}%
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: 컴파일 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -E "RegionPartyDist" | head -3
```

Expected: 출력 없음 (이 컴포넌트는 OK, 남은 3개 import 미존재 에러 잔존).

---

## Task 3: RegionChildrenTable (섹션 B) — children 표 + 정의당 그라데이션 + drilldown

**Files:**
- Create: `src/lib/region-share-color.ts`
- Create: `tests/unit/region-share-color.test.ts`
- Create: `src/components/region/RegionChildrenTable.tsx`

- [ ] **Step 1: 정의당 컬럼 그라데이션 헬퍼 + 테스트 (TDD)**

`src/lib/region-share-color.ts`:

```ts
/**
 * 정의당 share(0~1) → CSS background-color 문자열.
 * 0% 부근 → 매우 옅은 정의당 색, 10% 이상 → 진한 정의당 색.
 * 임계값 10% 이상이면 max 색, 0~10% 사이는 알파 채널 그라데이션.
 */
export function justiceShareColor(share: number): string {
  const clamped = Math.max(0, Math.min(0.1, share));
  const alpha = clamped / 0.1; // 0..1
  // 정의당 색 = #FFCC00. RGB(255, 204, 0). 알파 합성.
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `#FFCC00${a}`;
}
```

`tests/unit/region-share-color.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { justiceShareColor } from "../../src/lib/region-share-color";

describe("justiceShareColor", () => {
  it("share=0 → 투명 (#FFCC0000)", () => {
    expect(justiceShareColor(0)).toBe("#FFCC0000");
  });
  it("share=0.05 → 중간 알파 (대략 7f~80)", () => {
    const c = justiceShareColor(0.05);
    expect(c.startsWith("#FFCC00")).toBe(true);
    const a = parseInt(c.slice(-2), 16);
    expect(a).toBeGreaterThan(100);
    expect(a).toBeLessThan(160);
  });
  it("share≥0.1 → max 알파 (#FFCC00ff)", () => {
    expect(justiceShareColor(0.1)).toBe("#FFCC00ff");
    expect(justiceShareColor(0.5)).toBe("#FFCC00ff");
  });
});
```

- [ ] **Step 2: 테스트 실행**

```bash
cd ~/coding/ourstory && pnpm test region-share-color 2>&1 | tail -5
```

Expected: 3 PASS.

- [ ] **Step 3: RegionChildrenTable 컴포넌트**

`src/components/region/RegionChildrenTable.tsx`:

```tsx
import Link from "next/link";
import type { ChildrenTable } from "@/lib/queries";
import { justiceShareColor } from "@/lib/region-share-color";

interface Props {
  table: ChildrenTable;
  electionId: string;
}

export function RegionChildrenTable({ table, electionId }: Props) {
  if (table.children.length === 0) {
    return (
      <section aria-labelledby="sec-children" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 id="sec-children" className="text-sm font-semibold mb-2">하위 지역</h2>
        <p className="text-sm text-zinc-500">하위 지역이 없습니다.</p>
      </section>
    );
  }
  const q = `?election=${encodeURIComponent(electionId)}`;

  return (
    <section aria-labelledby="sec-children" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
      <h2 id="sec-children" className="text-sm font-semibold mb-2">
        하위 지역 ({table.children.length})
      </h2>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs tabular-nums">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-700">
              <th className="text-left py-1.5 px-2 font-semibold">지역</th>
              {table.partyColumns.map((p) => (
                <th key={p.partyId} className="text-right py-1.5 px-2 font-semibold" style={{ color: p.color }}>
                  {p.partyName}
                </th>
              ))}
              <th className="text-right py-1.5 px-2 font-semibold text-zinc-500">합계</th>
            </tr>
          </thead>
          <tbody>
            {table.children.map((c) => {
              const justiceVotes = c.byParty["justice"] ?? 0;
              const justiceShare = c.total > 0 ? justiceVotes / c.total : 0;
              return (
                <tr key={c.code} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <td className="text-left py-1 px-2">
                    <Link href={`/region/${encodeURIComponent(c.code)}${q}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  {table.partyColumns.map((p) => {
                    const votes = c.byParty[p.partyId] ?? 0;
                    const share = c.total > 0 ? votes / c.total : 0;
                    const bg = p.partyId === "justice" ? justiceShareColor(justiceShare) : undefined;
                    return (
                      <td
                        key={p.partyId}
                        className="text-right py-1 px-2"
                        style={bg ? { backgroundColor: bg } : undefined}
                      >
                        {(share * 100).toFixed(1)}%
                      </td>
                    );
                  })}
                  <td className="text-right py-1 px-2 text-zinc-500">{c.total.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: 컴파일 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -E "RegionChildrenTable" | head -3
```

Expected: 출력 없음.

---

## Task 4: PresubVsElDay (섹션 C) — 정의당 사전 vs 선거일 + fallback

**Files:**
- Create: `src/components/region/PresubVsElDay.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
import type { PresubElDayResult } from "@/lib/queries";

interface Props {
  presub: PresubElDayResult;
}

export function PresubVsElDay({ presub }: Props) {
  if (!presub.hasData) {
    return (
      <section aria-labelledby="sec-presub" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 id="sec-presub" className="text-sm font-semibold mb-2">관내사전 vs 선거일</h2>
        <p className="text-sm text-zinc-500">
          이 선거는 NEC archive 가 emd-level 분해 데이터를 미공개합니다.
        </p>
      </section>
    );
  }

  // 정의당 rows 만 추림 → emd 별 (사전, 선거일) 두 막대
  const justiceRows = presub.rows.filter((r) => r.partyId === "justice");
  if (justiceRows.length === 0) {
    return (
      <section aria-labelledby="sec-presub" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 id="sec-presub" className="text-sm font-semibold mb-2">관내사전 vs 선거일 — 정의당</h2>
        <p className="text-sm text-zinc-500">정의당 데이터가 없습니다.</p>
      </section>
    );
  }

  // emd 별 sub + el_day 합 기준으로 share 계산 (이 emd 안 정의당이 사전과 선거일에서 어느 비율)
  const enriched = justiceRows.map((r) => {
    const total = r.presub + r.elDay;
    return {
      regionCode: r.regionCode,
      regionName: r.regionName,
      presub: r.presub,
      elDay: r.elDay,
      presubPct: total > 0 ? r.presub / total : 0,
      elDayPct: total > 0 ? r.elDay / total : 0,
      total,
    };
  }).filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 20); // 상위 20개 표시

  return (
    <section aria-labelledby="sec-presub" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 id="sec-presub" className="text-sm font-semibold">관내사전 vs 선거일 — 정의당</h2>
        <span className="text-xs text-zinc-500">상위 {enriched.length}개 emd</span>
      </div>
      <ul className="space-y-1 text-xs">
        {enriched.map((r) => (
          <li key={r.regionCode} className="flex items-center gap-2">
            <span className="shrink-0 w-24 truncate" title={r.regionName}>{r.regionName}</span>
            <div className="flex-1 flex h-4 rounded overflow-hidden bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full"
                style={{ width: `${r.presubPct * 100}%`, backgroundColor: "#FFCC00" }}
                title={`사전 ${r.presub.toLocaleString()}표 (${(r.presubPct * 100).toFixed(1)}%)`}
              />
              <div
                className="h-full"
                style={{ width: `${r.elDayPct * 100}%`, backgroundColor: "#B89600" }}
                title={`선거일 ${r.elDay.toLocaleString()}표 (${(r.elDayPct * 100).toFixed(1)}%)`}
              />
            </div>
            <span className="shrink-0 w-20 text-right tabular-nums text-zinc-500">{r.total.toLocaleString()}표</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-zinc-500">
        <span className="inline-block w-3 h-3 align-middle mr-1" style={{ backgroundColor: "#FFCC00" }}></span>관내사전
        <span className="inline-block w-3 h-3 align-middle ml-3 mr-1" style={{ backgroundColor: "#B89600" }}></span>선거일
      </p>
    </section>
  );
}
```

- [ ] **Step 2: 컴파일 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -E "PresubVsElDay" | head -3
```

Expected: 출력 없음.

---

## Task 5: RegionMiniSeries (섹션 D) — Recharts client + 정의당 단일 라인

**Files:**
- Create: `src/components/region/RegionMiniSeries.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { SeriesPoint } from "@/lib/queries";

interface Props {
  series: SeriesPoint[];
  regionName: string;
}

export function RegionMiniSeries({ series, regionName }: Props) {
  if (series.length === 0) {
    return (
      <section aria-labelledby="sec-series" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 id="sec-series" className="text-sm font-semibold mb-2">정의당 시계열 — {regionName}</h2>
        <p className="text-sm text-zinc-500">이 지역의 정의당 역대 적재 데이터가 없습니다.</p>
      </section>
    );
  }

  const data = series.map((p) => ({
    name: p.election.name.replace(/제\s?\d+회\s*/g, "").trim(),
    pct: p.pct,
  }));
  const color = series[0]?.partyColor ?? "#FFCC00";

  return (
    <section aria-labelledby="sec-series" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 id="sec-series" className="text-sm font-semibold">정의당 시계열 — {regionName}</h2>
        <span className="text-xs text-zinc-500">{series.length}개 선거</span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 60 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.06)" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
          <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} />
          <Tooltip
            formatter={(value) => [`${value}%`, "정의당 득표율"]}
            contentStyle={{ fontSize: 11 }}
          />
          <Line
            type="monotone"
            dataKey="pct"
            stroke={color}
            strokeWidth={2.5}
            dot={{ r: 3 }}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
```

- [ ] **Step 2: 컴파일 + 전체 테스트**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -vE "tests/unit/process\.test\.ts" | head -5
cd ~/coding/ourstory && pnpm test 2>&1 | tail -5
```

Expected: 컴파일 에러 없음, 69 + 3 신규(region-share-color) = 72 PASS.

---

## Task 6: Playwright smoke — 4 URL 실데이터 렌더 검증

**Files:**
- 없음 (실제 dev server)

- [ ] **Step 1: dev server 시작 + ready 대기**

```bash
cd ~/coding/ourstory && pnpm dev > /tmp/ourstory-dev.log 2>&1 &
until grep -q "Ready in\|Local:" /tmp/ourstory-dev.log 2>/dev/null; do sleep 0.5; done
echo "ready"
```

- [ ] **Step 2: 4 URL navigate + screenshot (Playwright MCP)**

각 URL 에서:
1. `/region/4800000000?election=2024-general-prop` — sido 비례 (모든 섹션 실데이터)
2. `/region/4817000000?election=2024-general-prop` — sigungu 비례
3. `/region/4817000000?election=2024-general` — sigungu 지역구 (raceKind=candidate)
4. `/region/4817000000?election=2022-local-mayor` — polling 미공개 election (섹션 C fallback 메시지)

각 screenshot 에서:
- 섹션 A 정의당 카드 + 정당/후보자 막대
- 섹션 B 표 정의당 컬럼 그라데이션 (sido/sigungu)
- 섹션 C: 1·2 는 막대 출력, 3 은 정의당 후보 없음 시 fallback, 4 는 "NEC archive 미공개" 메시지
- 섹션 D Recharts 선 차트

- [ ] **Step 3: 시각 검증 후 dev server 종료**

```bash
pkill -f "next dev" 2>/dev/null
echo "dev stopped"
```

---

## Task 7: 커밋

**Files:**
- 스테이지: Task 1~5 변경

- [ ] **Step 1: 변경 확인**

```bash
git -C ~/coding/ourstory status
git -C ~/coding/ourstory diff --stat
```

Expected:
- `src/app/region/[code]/page.tsx` (수정)
- `src/components/region/RegionView.tsx` (수정)
- `src/components/region/RegionPartyDist.tsx` (신규)
- `src/components/region/RegionChildrenTable.tsx` (신규)
- `src/components/region/PresubVsElDay.tsx` (신규)
- `src/components/region/RegionMiniSeries.tsx` (신규)
- `src/lib/region-share-color.ts` (신규)
- `tests/unit/region-share-color.test.ts` (신규)

- [ ] **Step 2: 커밋**

```bash
git -C ~/coding/ourstory add src/app/region src/components/region src/lib/region-share-color.ts tests/unit/region-share-color.test.ts
git -C ~/coding/ourstory commit -m "$(cat <<'EOF'
ourstory Phase 1.3.2~1.3.6 — region 4 섹션 본 구현 + fallback

1.3.1 placeholder 를 실제 데이터 렌더 컴포넌트로 교체.

  RegionPartyDist        섹션 A — 정당/후보자 막대 + 정의당 카드
                                  (raceKind=candidate 시 후보자 모드)
  RegionChildrenTable    섹션 B — children × 정당 표, 정의당 컬럼 그라데이션,
                                  drilldown 링크 (election query 유지)
  PresubVsElDay          섹션 C — emd × (관내사전 vs 선거일) 정의당 비교 막대.
                                  hasData=false 시 "NEC archive 미공개" 메시지
  RegionMiniSeries       섹션 D — Recharts client, 정의당 단일 라인,
                                  X축 회전 90px, height 220
  region-share-color     정의당 share → 알파 그라데이션 헬퍼 (3 테스트)

page.tsx 가 4 query 병렬 호출 후 RegionView 에 props 전달.
emd level 은 섹션 B 숨김 + presubScope=self.
Playwright smoke 4 URL (sido 비례 / sigungu 비례 / 지역구 / polling 없음) 정상.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(controller 가 review 후 커밋 패턴이면 본 Step 2 는 컨트롤러 담당.)

---

## 검증 체크리스트 (Phase 1.3.2~1.3.6 완료 조건)

- [ ] `pnpm test region-share-color` → 3 PASS
- [ ] `pnpm test` → 전체 72 PASS
- [ ] `pnpm tsc --noEmit` → 신규 컴포넌트 관련 에러 없음
- [ ] Playwright smoke 4 URL 시각 검증 완료
  - sido/sigungu 에서 4 섹션 정상
  - 지역구 race 가 raceKind=candidate 로 후보자 표시
  - polling 미공개 election 에서 섹션 C 가 fallback 메시지
- [ ] 커밋 메시지가 위 형식대로

다섯 항목 통과 시 Phase 1.3 전체 시리즈 완료. 다음 후보:
- Phase 1.4 `/election/[id]` 선거 단면 (region 변수가 election 변수로 변경된 거울 구조)
- Phase 1.6 PNG 공유·OG 메타
- vote_totals partyId 매핑률 보강 (현재 평균 64% → 95%)
