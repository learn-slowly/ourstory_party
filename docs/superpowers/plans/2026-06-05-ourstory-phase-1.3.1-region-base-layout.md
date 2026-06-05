# ourstory Phase 1.3.1 — /region/[code] base layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/region/[code]` 라우트의 RSC 페이지 + 컨테이너 컴포넌트 + breadcrumb + ElectionPicker (선거 dropdown) 를 만들고 4 섹션 placeholder 를 둔다. 후속 phase (1.3.2~1.3.5) 에서 각 섹션을 본 구현으로 채운다.

**Architecture:** RSC 페이지가 URL searchParams 를 파싱해 Phase 1.3.0 의 `getRegionContext` + `elections` 목록 조회 → `RegionView` 컨테이너 컴포넌트(서버 컴포넌트, 순수 props 렌더) → 그 안에 breadcrumb + 헤더 + 4 섹션 슬롯. 선거 변경 dropdown 만 client component (`"use client"`, Next router push).

**Tech Stack:** Next.js 16 (RSC + force-dynamic) / React 19 / Tailwind / drizzle-orm / Playwright

선행 spec: `docs/superpowers/specs/2026-06-05-ourstory-phase-1.3-region-detail-design.md` (§ 페이지 구조, § 오류·예외 처리)
선행 phase: 1.3.0 (region query 함수 5개) 완료.

---

## 파일 구조

| 파일 | 동작 | 책임 |
|------|------|------|
| `src/app/region/[code]/page.tsx` | Create | RSC entry point. params + searchParams 파싱, query 호출, RegionView 렌더 |
| `src/components/region/RegionView.tsx` | Create | 서버 컴포넌트. breadcrumb · header · 4 section placeholder 렌더 |
| `src/components/region/Breadcrumb.tsx` | Create | sido → sigungu → emd 링크 체인 |
| `src/components/region/ElectionPicker.tsx` | Create | client component. dropdown → URL ?election= push |
| `tests/unit/election-picker.test.ts` | Create | ElectionPicker 의 URL 생성 헬퍼 단위 테스트 (3 케이스) |

`RegionView` 는 props 만 받아 렌더 — DB·router 의존 없는 순수 함수형. 테스트는 component snapshot 보다 page-level Playwright smoke 가 효율적이라 RegionView·page.tsx 자체는 unit test 없음.

---

## Task 1: page.tsx — RSC entry + 404 처리

**Files:**
- Create: `src/app/region/[code]/page.tsx`

- [ ] **Step 1: 디렉터리 생성 + 페이지 작성**

```bash
mkdir -p ~/coding/ourstory/src/app/region/\[code\]
```

`src/app/region/[code]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { elections } from "../../../../db/schema";
import { getRegionContext } from "@/lib/queries";
import { RegionView } from "@/components/region/RegionView";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RegionPage({ params, searchParams }: PageProps) {
  const { code } = await params;
  const sp = await searchParams;

  // spec § 오류 처리: code 가 10자리 숫자가 아니면 404
  if (!/^\d{10}$/.test(code)) notFound();

  // region 컨텍스트 + 선거 목록 병렬 조회
  const [ctx, allElections] = await Promise.all([
    getRegionContext(code),
    db.select().from(elections)
      .where(eq(elections.isByelection, false))
      .orderBy(desc(elections.displayOrder)),
  ]);

  if (!ctx) notFound();
  if (allElections.length === 0) notFound();

  // election query 파싱 — 없거나 미존재 ID 면 가장 최근(displayOrder 최상) 으로 fallback
  const electionParam = typeof sp.election === "string" ? sp.election : Array.isArray(sp.election) ? sp.election[0] : undefined;
  const election =
    (electionParam && allElections.find((e) => e.id === electionParam)) ?? allElections[0];

  return (
    <RegionView
      ctx={ctx}
      election={election}
      electionOptions={allElections.map((e) => ({ id: e.id, name: e.name }))}
    />
  );
}
```

- [ ] **Step 2: 컴파일 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -E "app/region" | head -5
```

Expected: 출력 없음. RegionView 가 아직 없어서 import 에러 가능 → Task 2 끝나면 해소됨.

---

## Task 2: RegionView 컨테이너 + Breadcrumb

**Files:**
- Create: `src/components/region/RegionView.tsx`
- Create: `src/components/region/Breadcrumb.tsx`

- [ ] **Step 1: Breadcrumb 컴포넌트 작성**

`src/components/region/Breadcrumb.tsx`:

```tsx
import Link from "next/link";
import type { regions as regionsTable } from "../../../db/schema";

type RegionRow = typeof regionsTable.$inferSelect;

interface Props {
  ancestors: RegionRow[];
  current: RegionRow;
  electionQuery?: string; // ?election=... 유지
}

export function Breadcrumb({ ancestors, current, electionQuery }: Props) {
  const q = electionQuery ? `?election=${encodeURIComponent(electionQuery)}` : "";
  return (
    <nav className="text-sm text-zinc-500 mb-1" aria-label="region breadcrumb">
      {ancestors.map((a, i) => (
        <span key={a.code}>
          <Link href={`/region/${a.code}${q}`} className="hover:text-zinc-900 dark:hover:text-zinc-100">
            {a.name}
          </Link>
          <span className="mx-1">▸</span>
        </span>
      ))}
      <span className="text-zinc-900 dark:text-zinc-100 font-semibold">{current.name}</span>
    </nav>
  );
}
```

- [ ] **Step 2: RegionView 컨테이너 작성**

`src/components/region/RegionView.tsx`:

```tsx
import type { regions as regionsTable } from "../../../db/schema";
import { Breadcrumb } from "./Breadcrumb";
import { ElectionPicker } from "./ElectionPicker";

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
}

export function RegionView({ ctx, election, electionOptions }: Props) {
  return (
    <div className="space-y-6">
      <header>
        <Breadcrumb ancestors={ctx.ancestors} current={ctx.region} electionQuery={election.id} />
        <div className="flex flex-wrap items-baseline gap-3 mt-1">
          <h1 className="text-xl font-bold">
            {ctx.region.name}
            <span className="text-zinc-400 mx-2">·</span>
            <span className="text-zinc-700 dark:text-zinc-300">{election.name}</span>
          </h1>
          <ElectionPicker
            selectedId={election.id}
            options={electionOptions}
            regionCode={ctx.region.code}
          />
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          level: {ctx.level} · 하위 {ctx.children.length}건
        </p>
      </header>

      {/* 섹션 A — Phase 1.3.2 에서 구현 */}
      <section aria-labelledby="sec-dist" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 id="sec-dist" className="text-sm font-semibold mb-2">정당별 분포</h2>
        <p className="text-sm text-zinc-500">Phase 1.3.2 에서 구현 (정당별 막대 + 정의당 카드).</p>
      </section>

      {/* 섹션 B — Phase 1.3.3 */}
      <section aria-labelledby="sec-children" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 id="sec-children" className="text-sm font-semibold mb-2">하위 지역 표</h2>
        <p className="text-sm text-zinc-500">
          Phase 1.3.3 에서 구현 (children {ctx.children.length}건 × 정당 컬럼).
        </p>
      </section>

      {/* 섹션 C — Phase 1.3.4 */}
      {ctx.level !== "emd" && (
        <section aria-labelledby="sec-presub" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
          <h2 id="sec-presub" className="text-sm font-semibold mb-2">관내사전 vs 선거일</h2>
          <p className="text-sm text-zinc-500">Phase 1.3.4 에서 구현.</p>
        </section>
      )}

      {/* 섹션 D — Phase 1.3.5 */}
      <section aria-labelledby="sec-series" className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 id="sec-series" className="text-sm font-semibold mb-2">정의당 시계열</h2>
        <p className="text-sm text-zinc-500">Phase 1.3.5 에서 구현 (이 지역의 정의당 역대 추이).</p>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: 컴파일 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -E "components/region" | head -5
```

Expected: ElectionPicker 만 미존재 에러 → Task 3 에서 해소.

---

## Task 3: ElectionPicker — client dropdown + URL 헬퍼 + 단위 테스트

**Files:**
- Create: `src/components/region/ElectionPicker.tsx`
- Create: `src/components/region/election-picker-url.ts` (순수 URL 헬퍼)
- Create: `tests/unit/election-picker.test.ts`

- [ ] **Step 1: URL 헬퍼 + 단위 테스트 먼저 (TDD)**

`src/components/region/election-picker-url.ts`:

```ts
// ElectionPicker 의 URL 생성 로직. 순수 함수로 분리해 client 컴포넌트 없이 단위 테스트.
export function buildRegionUrl(regionCode: string, electionId: string): string {
  return `/region/${encodeURIComponent(regionCode)}?election=${encodeURIComponent(electionId)}`;
}
```

`tests/unit/election-picker.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildRegionUrl } from "../../src/components/region/election-picker-url";

describe("buildRegionUrl", () => {
  it("일반 케이스 — code + electionId", () => {
    expect(buildRegionUrl("4817000000", "2024-general-prop")).toBe(
      "/region/4817000000?election=2024-general-prop",
    );
  });

  it("electionId 에 특수문자 — encodeURIComponent", () => {
    expect(buildRegionUrl("4817000000", "2026-04-02-byelection")).toBe(
      "/region/4817000000?election=2026-04-02-byelection",
    );
  });

  it("synthetic 행정동 code — 9 prefix", () => {
    expect(buildRegionUrl("9171000001", "2024-general-prop")).toBe(
      "/region/9171000001?election=2024-general-prop",
    );
  });
});
```

- [ ] **Step 2: 테스트 실행 → 3 FAIL**

```bash
cd ~/coding/ourstory && pnpm test election-picker 2>&1 | tail -10
```

Expected: 3 FAIL (import 에러 또는 함수 미정의).

- [ ] **Step 3: URL 헬퍼는 Step 1 의 코드 그대로 — 추가 작업 없음. 테스트 재실행**

```bash
cd ~/coding/ourstory && pnpm test election-picker 2>&1 | tail -5
```

Expected: 3 PASS.

- [ ] **Step 4: ElectionPicker client 컴포넌트 작성**

`src/components/region/ElectionPicker.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
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
            router.push(buildRegionUrl(regionCode, next));
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

- [ ] **Step 5: 전체 컴파일 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -vE "tests/unit/process\.test\.ts" | head -10
```

Expected: 추가 에러 없음.

- [ ] **Step 6: 전체 테스트 확인**

```bash
cd ~/coding/ourstory && pnpm test 2>&1 | tail -5
```

Expected: 66 (기존) + 3 (신규 election-picker) = 69 PASS.

---

## Task 4: Playwright smoke — 4 URL 렌더 검증

**Files:**
- 없음 (실제 dev server + Playwright)

- [ ] **Step 1: dev server 시작 (background)**

```bash
cd ~/coding/ourstory && pnpm dev > /tmp/ourstory-dev.log 2>&1 &
```

- [ ] **Step 2: server ready 확인**

```bash
until grep -q "Ready in\|Local:" /tmp/ourstory-dev.log 2>/dev/null; do sleep 0.5; done
echo "ready"
```

- [ ] **Step 3: 4 URL navigate + screenshot (Playwright MCP 사용)**

각 URL 에 대해 navigate + take_screenshot:

1. `http://localhost:3000/region/4800000000?election=2024-general-prop` — sido (경상남도)
2. `http://localhost:3000/region/4817000000?election=2024-general-prop` — sigungu (진주시)
3. `http://localhost:3000/region/4817000000?election=2022-presidential` — sigungu, 다른 선거
4. `http://localhost:3000/region/0000000001` — 미존재 code → 404 페이지

각 screenshot 에서 다음 확인:
- breadcrumb 가 표시됨 (404 제외)
- region 이름 + 선거 이름 헤더에 보임
- 4 section placeholder 모두 렌더 (sido/sigungu) 또는 3개 (emd)
- ElectionPicker dropdown 보임 (404 제외)

- [ ] **Step 4: 404 케이스 확인**

URL 4 (미존재 code) 가 Next.js 의 default 404 페이지 표시 — `not-found` 텍스트 또는 한국어 메시지 (custom not-found.tsx 없음, 기본 사용).

- [ ] **Step 5: ElectionPicker 동작 확인**

URL 2 (sigungu) 에서 ElectionPicker dropdown 클릭 → 다른 선거 선택 → URL 가 `?election=<새 ID>` 로 갱신되고 페이지 reload 됨. 헤더의 선거 이름이 바뀜.

- [ ] **Step 6: dev server 종료**

```bash
pkill -f "next dev" 2>/dev/null
echo "dev stopped"
```

---

## Task 5: 커밋

**Files:**
- 스테이지: Task 1~3 변경

- [ ] **Step 1: 변경 확인**

```bash
git -C ~/coding/ourstory status
git -C ~/coding/ourstory diff --stat
```

Expected:
- `src/app/region/[code]/page.tsx` (신규)
- `src/components/region/RegionView.tsx` (신규)
- `src/components/region/Breadcrumb.tsx` (신규)
- `src/components/region/ElectionPicker.tsx` (신규)
- `src/components/region/election-picker-url.ts` (신규)
- `tests/unit/election-picker.test.ts` (신규)

- [ ] **Step 2: 전체 테스트 PASS 확인**

```bash
cd ~/coding/ourstory && pnpm test 2>&1 | tail -5
```

Expected: 69/69 PASS.

- [ ] **Step 3: 커밋**

```bash
git -C ~/coding/ourstory add src/app/region src/components/region tests/unit/election-picker.test.ts
git -C ~/coding/ourstory commit -m "$(cat <<'EOF'
ourstory Phase 1.3.1 — /region/[code] base layout

RSC 페이지 + RegionView 컨테이너 + Breadcrumb + ElectionPicker.
섹션 A/B/C/D 는 placeholder (1.3.2~1.3.5 에서 본 구현).

  /region/[code]                — RSC entry, code 검증 + notFound
  RegionView                    — 서버 컴포넌트, 4 section 슬롯
  Breadcrumb                    — sido → sigungu → emd 링크 체인
  ElectionPicker (client)       — dropdown → URL ?election= push
  election-picker-url           — 순수 URL 빌더 헬퍼 + 3 단위 테스트

emd level 에서는 섹션 C (사전 vs 선거일) 자체 emd 1개라 부적합 → 숨김.
default election = 가장 최근 displayOrder 비-재보궐. 미존재 ID 입력 시 fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(controller 가 review 후 커밋 패턴이면 본 Step 3 는 컨트롤러 담당.)

---

## 검증 체크리스트 (Phase 1.3.1 완료 조건)

- [ ] `pnpm test election-picker` → 3 PASS
- [ ] `pnpm test` → 전체 69 PASS
- [ ] `pnpm tsc --noEmit` → 새 파일 관련 에러 없음
- [ ] Playwright smoke — 3 정상 URL 렌더 + 404 동작 + ElectionPicker dropdown 동작
- [ ] 커밋 메시지가 위 형식대로

다섯 항목 통과 시 Phase 1.3.1 완료. 다음 Phase 1.3.2 (섹션 A 본 구현 — RegionPartyDist + 정의당 카드) 플랜 작성.
