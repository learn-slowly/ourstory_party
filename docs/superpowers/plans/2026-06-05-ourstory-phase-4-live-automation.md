# ourstory Phase 4 (라이브 + 자동화) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 선거일 당일·D+1~D+3 시점에 data.go.kr 데이터를 5분 cron 으로 자동 폴링·적재하고 `/live` 페이지에서 전국·시·도·시·군 진행률·득표율을 실시간 표시한다. spec § 6/7 Phase 4. 2026-06-03 지선 데이터 공개 시 자동 동작, 이후 모든 재보궐·전국선거에 재사용.

**Architecture:** GitHub Actions cron(`*/5 * * * *`) → `poll-live.ts` → Pilot 패턴 그대로 `runOneElection` 16 elections 재실행(--refresh) → Supabase 적재. `/live` 페이지는 RSC 가 region_totals.progress_pct·vote_totals.votes 를 30s 캐시로 표시. 진행률 < 100% 이면 "잠정 결과" 배지. data.go.kr 최종 확정 후 cron 자동 중단.

**Tech Stack:** GitHub Actions, Next.js 15 RSC, Supabase, 기존 ingest CLI 그대로.

---

## File Structure

```
ourstory/
├── .github/
│   └── workflows/
│       └── poll-live.yml                       # 신규 — cron 워크플로우
├── scripts/
│   └── ingest/
│       └── poll-live.ts                        # 신규 — Pilot 일부만 재호출 (수정 가능 set)
├── src/
│   └── app/
│       └── live/
│           └── page.tsx                        # 신규 — /live RSC
└── src/components/
    └── LiveBoard.tsx                           # 신규 — 시·도 그리드
```

---

## Task 1: poll-live.ts (선택 elections 강제 재호출)

**Files:**
- Create: `scripts/ingest/poll-live.ts`

`ingest-pilot.ts` 와 동일 구조이되 다음 차이:
- `LIVE_IDS` 환경변수 `LIVE_ELECTION_IDS` (콤마 구분) 또는 기본값 (`2026-local-governor,2026-local-mayor,...` 7개)
- 항상 `--refresh` 적용 (raw 캐시 무시)
- 모든 elections 가 성공하면 `LIVE_DONE` 파일 생성 → 다음 cron 호출 시 skip

- [ ] **Step 1: 구현**

```ts
import { sql } from "../../src/lib/db-admin";
import { runOneElection } from "./ingest-election";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DONE_FLAG = path.join(HERE, "..", "..", "data", "raw", "LIVE_DONE");

const DEFAULT_IDS = [
  "2026-local-governor", "2026-local-mayor",
  "2026-local-council", "2026-local-council-prop",
  "2026-local-council-basic", "2026-local-council-basic-prop",
  "2026-local-superintendent",
];

async function main() {
  if (existsSync(DONE_FLAG)) {
    console.log("LIVE_DONE flag — skip");
    process.exit(0);
  }
  const idsEnv = process.env.LIVE_ELECTION_IDS;
  const ids = idsEnv ? idsEnv.split(",").map((s) => s.trim()) : DEFAULT_IDS;
  const failed: string[] = [];
  let totalProgress = 0;
  let count = 0;

  for (const id of ids) {
    console.log(`\n━━━ ${id} ━━━`);
    try {
      const ok = await runOneElection({ electionId: id, refresh: true, dryRun: false, diff: false });
      if (!ok) failed.push(id);
      else count++;
    } catch (err) {
      console.error(`  실패: ${(err as Error).message}`);
      failed.push(id);
    }
  }

  // 모든 성공 + progress 100% 면 DONE 플래그
  if (failed.length === 0) {
    const [{ avg }] = await sql<{ avg: number }[]>`
      SELECT AVG(progress_pct)::float AS avg FROM region_totals
      WHERE election_id = ANY(${ids}) AND progress_pct IS NOT NULL`;
    totalProgress = Number(avg ?? 0);
    if (totalProgress >= 99.5) {
      writeFileSync(DONE_FLAG, new Date().toISOString());
      console.log(`✓ 모든 elections 진행률 ${totalProgress.toFixed(2)}% — LIVE_DONE 생성`);
    }
  }

  await sql.end();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: package.json**

```json
"ingest:poll-live": "dotenv -e .env.local -- tsx scripts/ingest/poll-live.ts",
```

- [ ] **Step 3: 커밋**

```sh
git add scripts/ingest/poll-live.ts package.json
git commit -m "poll-live — 라이브 cron 스크립트 (LIVE_DONE 플래그로 자동 종료)"
```

---

## Task 2: GitHub Actions cron 워크플로우

**Files:**
- Create: `.github/workflows/poll-live.yml`

- [ ] **Step 1: 워크플로우 작성**

```yaml
name: poll-live

on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:
    inputs:
      election_ids:
        description: "콤마 구분 elections.id (기본은 poll-live.ts DEFAULT_IDS)"
        required: false

jobs:
  poll:
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm ingest:poll-live
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          DATA_GO_KR_API_KEY: ${{ secrets.DATA_GO_KR_API_KEY }}
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          LIVE_ELECTION_IDS: ${{ inputs.election_ids }}
```

- [ ] **Step 2: GitHub repo Secrets 등록 (수동)**

사용자 안내:
1. GitHub `learn-slowly/ourstory_party` → Settings → Secrets and variables → Actions → New repository secret
2. 다음 5개 추가:
   - `DATABASE_URL`
   - `DATA_GO_KR_API_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. 값은 `.env.local` 그대로

- [ ] **Step 3: 커밋·푸시 후 첫 cron 동작 점검**

```sh
git add .github/workflows/poll-live.yml
git commit -m "GitHub Actions cron — 5분마다 poll-live 자동 실행"
git push
# 푸시 후 GitHub Actions 탭에서 다음 cron 실행 또는 workflow_dispatch 로 즉시 트리거
```

확인:
- Actions 탭 → poll-live 워크플로우 → 실행 로그
- 성공 시 마지막 `성공: N/N` 출력
- Supabase 에 vote_totals 갱신 확인

---

## Task 3: /live 페이지 — 전국·시·도 그리드

**Files:**
- Create: `src/app/live/page.tsx`
- Create: `src/components/LiveBoard.tsx`

- [ ] **Step 1: queries.ts 에 라이브 함수 추가**

`src/lib/queries.ts` 에:

```ts
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
  // sido 별 1위 정당
  const cellTop = new Map<string, { partyId: string; votes: number }>();
  for (const v of votes) {
    if (!allRegions.find((r) => r.code === v.regionCode)) continue;
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

  // 전국
  let progNum = 0, progDen = 0;
  for (const c of cells) if (c.progressPct != null) { progNum += c.progressPct; progDen += 1; }
  const nationalProgress = progDen > 0 ? progNum / progDen : null;

  // 전국 1위
  const partyTotals = new Map<string, number>();
  for (const v of votes) partyTotals.set(v.partyId, (partyTotals.get(v.partyId) ?? 0) + v.votes);
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
```

- [ ] **Step 2: LiveBoard 컴포넌트**

`src/components/LiveBoard.tsx`:

```tsx
import type { LiveSidoCell } from "../lib/queries";

interface Props {
  electionName: string;
  date: string;
  national: { progressPct: number | null; topParty: { name: string; color: string; pct: number } | null };
  cells: LiveSidoCell[];
}

export function LiveBoard({ electionName, date, national, cells }: Props) {
  const isProvisional = national.progressPct != null && national.progressPct < 99.5;
  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-bold">{electionName}</h1>
        <span className="text-sm text-zinc-500">{date}</span>
        {isProvisional && <span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-900">잠정 결과</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card title="전국 진행률" value={national.progressPct == null ? "—" : `${national.progressPct}%`} sub="평균" />
        <Card title="전국 1위" value={national.topParty?.name ?? "—"} sub={national.topParty ? `${national.topParty.pct}%` : "—"} color={national.topParty?.color} />
        <Card title="시·도 그리드" value={`${cells.length}개`} sub="시·도별 진행률·1위" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {cells.map((c) => (
          <div key={c.sidoCode} className="rounded border border-zinc-200 dark:border-zinc-700 p-3 bg-white dark:bg-zinc-900">
            <div className="text-xs text-zinc-500">{c.sidoName}</div>
            <div className="text-xs mt-1">{c.progressPct == null ? "—" : `${c.progressPct}%`}</div>
            {c.topParty && (
              <div className="mt-1 text-sm font-bold" style={{ color: c.topParty.color }}>
                {c.topParty.name} {c.topParty.pct}%
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Card({ title, value, sub, color }: { title: string; value: string; sub: string; color?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-3 bg-white dark:bg-zinc-900">
      <div className="text-xs text-zinc-500">{title}</div>
      <div className="text-2xl font-bold mt-1" style={{ color }}>{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{sub}</div>
    </div>
  );
}
```

- [ ] **Step 3: /live page.tsx**

`src/app/live/page.tsx`:

```tsx
import { LiveBoard } from "../../components/LiveBoard";
import { getLiveSnapshot } from "../../lib/queries";

export const revalidate = 30;  // 30 초 캐시

const DEFAULT_LIVE_ID = "2026-local-governor";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Live({ searchParams }: PageProps) {
  const sp = await searchParams;
  const electionId = (Array.isArray(sp.election) ? sp.election[0] : sp.election) ?? DEFAULT_LIVE_ID;
  const snap = await getLiveSnapshot(electionId);
  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      <LiveBoard {...snap} />
    </main>
  );
}
```

- [ ] **Step 4: 커밋**

```sh
git add src/lib/queries.ts src/components/LiveBoard.tsx src/app/live/page.tsx
git commit -m "/live — 시·도 그리드, 전국 진행률·1위 카드, 30s 캐시"
```

---

## Task 4: 검증

- [ ] **Step 1: 로컬 빌드·테스트**

```sh
pnpm build
pnpm test
```

- [ ] **Step 2: 라이브 점검 (2026 데이터 공개 후)**

```sh
curl -s "https://jp-ourstory.vercel.app/live" | grep -oE "(잠정 결과|전국 진행률|제9회 지방선거)" | head -5
```

Expected: 데이터 공개 시점에 전국 진행률 표시, 100% 도달 후 "잠정 결과" 배지 사라짐.

- [ ] **Step 3: cron 동작 확인**

GitHub Actions 탭에서 `poll-live` 워크플로우가 5분마다 실행되는지. LIVE_DONE 플래그가 100% 도달 후 생성되는지.

---

## 완료 기준 (Phase 4 Done)

- [ ] `poll-live.ts` + GitHub Actions cron 동작
- [ ] `/live` 페이지가 시·도 17개 그리드 + 전국 카드 표시
- [ ] 30s 캐시 (Next.js revalidate)
- [ ] 진행률 < 100% 면 "잠정 결과" 배지
- [ ] 100% 도달 시 LIVE_DONE 플래그 생성 → cron skip
- [ ] GitHub Secrets 5개 등록 완료

Phase 4 Done 시 ourstory MVP 출시 — Phase 1.2 홈 + Phase 1.3+ 지역 상세는 Phase 2 데이터 풍부해진 후 별도.
