# ourstory Phase 1.1 (Pilot 데이터 인제스천) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pilot 4개 선거일(2022 지선·2024 총선·2025 대선·2026 지선, 합 16 elections)의 시·도/시·군 정당 집계와 후보자 명부를 data.go.kr API 로부터 Supabase 에 적재한다. 재실행 가능하고 4종 검증 통과.

**Architecture:** data.go.kr 3개 service(VoteXmntck/Elcnt/CommonCode) → JSON raw 캐시 → zod 파싱 → party-resolver(override → alias) → Drizzle upsert → 4종 검증·diff 보고. CLI는 `pnpm ingest:pilot` / `pnpm ingest:election <id>` 두 진입점. raw 캐시 + `--refresh`/`--dry-run`/`--diff` 플래그.

**Tech Stack:** TypeScript, Drizzle ORM, postgres-js, zod, Vitest, tsx, dotenv. data.go.kr 공공데이터포털 선관위 API.

---

## File Structure

```
ourstory/
├── data/
│   ├── raw/                                       # gitignored
│   │   └── <electionId>/{vote-xmntck,elcnt}.json
│   └── seed/
│       └── election-party-overrides.json          # 신규
├── db/
│   ├── schema.ts                                  # MODIFY: electionPartyOverrides 추가
│   └── migrations/0002_*.sql                      # 신규 (drizzle-kit 생성)
├── scripts/
│   ├── ingest/
│   │   ├── lib/
│   │   │   ├── types.ts                           # 신규 (zod schemas)
│   │   │   ├── api-client.ts                      # 신규
│   │   │   └── party-resolver.ts                  # 신규
│   │   ├── fetch-results.ts                       # 신규 (VoteXmntckInfoInqireService2 raw)
│   │   ├── fetch-voters.ts                        # 신규 (ElcntInfoInqireService raw)
│   │   ├── process.ts                             # 신규 (raw → vote_totals + region_totals + candidates)
│   │   ├── validate.ts                            # 신규 (R1~R4)
│   │   ├── diff.ts                                # 신규
│   │   ├── ingest-election.ts                     # 신규 (단일 선거 CLI 진입점)
│   │   ├── ingest-pilot.ts                        # 신규 (Pilot 16 elections 일괄)
│   │   └── seed/
│   │       └── 04-election-party-overrides.ts     # 신규
├── tests/
│   ├── fixtures/raw/
│   │   ├── vote-xmntck-presidential.json          # 신규 샘플 (5종)
│   │   ├── vote-xmntck-governor.json
│   │   ├── vote-xmntck-mayor.json
│   │   ├── vote-xmntck-general.json
│   │   └── elcnt-gusigun.json
│   └── unit/
│       ├── api-client.test.ts                     # 신규
│       ├── party-resolver.test.ts                 # 신규
│       ├── process.test.ts                        # 신규
│       └── validate.test.ts                       # 신규
├── package.json                                   # MODIFY: ingest 스크립트 추가
└── .gitignore                                     # MODIFY: data/raw/ 추가
```

---

## Task 1: electionPartyOverrides 스키마 + 마이그레이션

**Files:**
- Modify: `db/schema.ts`
- Create: `db/migrations/0002_election_party_overrides.sql` (drizzle-kit 생성)

- [ ] **Step 1: 스키마 추가**

`db/schema.ts` 파일 끝에 다음 테이블 추가:

```ts
// 선거 단위 정당 매핑 강제 (정치 판단 케이스)
export const electionPartyOverrides = pgTable(
  "election_party_overrides",
  {
    electionId: text("election_id").notNull().references(() => elections.id),
    rawName: text("raw_name").notNull(),
    partyId: text("party_id").notNull().references(() => parties.id),
    note: text("note"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.electionId, t.rawName] }) }),
);
```

- [ ] **Step 2: 마이그레이션 생성**

Run: `pnpm db:generate`
Expected: `db/migrations/0002_*.sql` 파일이 생성되고 `CREATE TABLE "election_party_overrides"` 구문 포함

- [ ] **Step 3: 마이그레이션 적용**

Run: `pnpm db:migrate`
Expected: `[✓] migrations applied` 출력

- [ ] **Step 4: 스키마 검증**

Run: `pnpm verify:schema`
Expected: `✓ 8개 테이블 모두 존재: candidates, election_party_overrides, elections, parties, party_aliases, region_totals, regions, vote_totals`

`scripts/verify-schema.ts` 의 기대 테이블 목록에 `election_party_overrides` 추가 필요:

```ts
const EXPECTED = ["candidates", "election_party_overrides", "elections", "parties", "party_aliases", "region_totals", "regions", "vote_totals"];
```

- [ ] **Step 5: RLS 정책 적용**

`scripts/apply-rls.ts` 에 `election_party_overrides` anon SELECT 정책을 추가하고 실행:

```ts
const tables = ["regions", "parties", "party_aliases", "elections", "election_party_overrides", "vote_totals", "region_totals", "candidates"];
```

Run: `pnpm db:rls`
Expected: 8개 테이블 모두 `ENABLE ROW LEVEL SECURITY` + anon SELECT policy 출력

- [ ] **Step 6: 커밋**

```sh
git add db/schema.ts db/migrations/ scripts/verify-schema.ts scripts/apply-rls.ts
git commit -m "election_party_overrides 테이블 추가 + RLS"
```

---

## Task 2: election-party-overrides 시드 파일 + 시드 스크립트

**Files:**
- Create: `data/seed/election-party-overrides.json`
- Create: `scripts/ingest/seed/04-election-party-overrides.ts`
- Modify: `package.json` (시드 스크립트 추가)

- [ ] **Step 1: 시드 파일 작성**

`data/seed/election-party-overrides.json`:

```json
[
  {
    "electionId": "2025-presidential",
    "rawName": "민주노동당",
    "partyId": "justice",
    "note": "권영국 — 민주노동당 후보로 등록했으나 정의당이 사실상 지지·연대. 정의당 시계열에 합산."
  }
]
```

- [ ] **Step 2: 시드 스크립트 작성**

`scripts/ingest/seed/04-election-party-overrides.ts`:

```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sql, db } from "../../../src/lib/db-admin";
import { electionPartyOverrides } from "../../../db/schema";

interface SeedRow {
  electionId: string;
  rawName: string;
  partyId: string;
  note?: string;
}

async function main() {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const SEED_PATH = path.join(HERE, "..", "..", "..", "data", "seed", "election-party-overrides.json");

  const raw = await readFile(SEED_PATH, "utf-8");
  const rows: SeedRow[] = JSON.parse(raw);

  for (const r of rows) {
    await db
      .insert(electionPartyOverrides)
      .values({ electionId: r.electionId, rawName: r.rawName, partyId: r.partyId, note: r.note })
      .onConflictDoUpdate({
        target: [electionPartyOverrides.electionId, electionPartyOverrides.rawName],
        set: { partyId: r.partyId, note: r.note },
      });
  }

  console.log(`시드 완료: election_party_overrides ${rows.length}건`);
  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: package.json 스크립트 추가**

`"ingest:seed"` 라인 위에 추가, 그리고 `"ingest:seed"` 끝에 체이닝:

```json
"ingest:seed:overrides": "dotenv -e .env.local -- tsx scripts/ingest/seed/04-election-party-overrides.ts",
"ingest:seed": "pnpm ingest:seed:regions && pnpm ingest:seed:parties && pnpm ingest:seed:elections && pnpm ingest:seed:overrides",
```

- [ ] **Step 4: 시드 실행 + 검증**

Run: `pnpm ingest:seed:overrides`
Expected: `시드 완료: election_party_overrides 1건`

DB 확인 (psql 또는 db:studio):
```sql
SELECT * FROM election_party_overrides;
```
Expected: 1 행 (2025-presidential / 민주노동당 / justice / 권영국 note)

- [ ] **Step 5: 커밋**

```sh
git add data/seed/election-party-overrides.json scripts/ingest/seed/04-*.ts package.json
git commit -m "election-party-overrides 시드 (권영국 1건)"
```

---

## Task 3: types.ts + api-client.ts (data.go.kr 클라이언트)

**Files:**
- Create: `scripts/ingest/lib/types.ts`
- Create: `scripts/ingest/lib/api-client.ts`
- Create: `tests/unit/api-client.test.ts`

- [ ] **Step 1: 응답 schema 작성 (zod)**

`scripts/ingest/lib/types.ts`:

```ts
import { z } from "zod";

export class ApiError extends Error {
  constructor(public code: string, message: string, public url?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export const ApiResponseSchema = z.object({
  response: z.object({
    header: z.object({
      resultCode: z.string(),
      resultMsg: z.string(),
    }),
    body: z
      .object({
        items: z.any().optional(),
        numOfRows: z.coerce.number().optional(),
        pageNo: z.coerce.number().optional(),
        totalCount: z.coerce.number().optional(),
      })
      .optional(),
  }),
});

// VoteXmntckInfoInqireService2 / getXmntckSttusInfoInqire 응답 행 (wide format).
// 한 행에 메타 + 후보자/정당이 jd01~jd50 / hbj01~hbj50 / dugsu01~dugsu50 으로 펼쳐진다.
// 컬럼 수는 선거 유형마다 다르므로 catchall 로 동적 허용한다.
export const XmntckItemSchema = z.object({
  sgId: z.string(),
  sgTypecode: z.string(),
  sdName: z.string(),
  sggName: z.string().optional(),
  wiwName: z.string().optional(),
}).catchall(z.unknown());
export type XmntckItem = z.infer<typeof XmntckItemSchema>;

// ElcntInfoInqireService / getGsigElcntInfoInqire 응답 행 (시·군 분모)
// popCnt(인구), selecMan(선거인수), tvoteNum(투표수), validNum(유효표수), invalidNum(무효표수)
export const ElcntItemSchema = z.object({
  sgId: z.string(),
  sdName: z.string(),
  sggName: z.string().optional(),
  wiwName: z.string().optional(),
  popCnt: z.coerce.number().optional(),
  selecMan: z.coerce.number().optional(),
  tvoteNum: z.coerce.number().optional(),
  validNum: z.coerce.number().optional(),
  invalidNum: z.coerce.number().optional(),
  vtRate: z.coerce.number().optional(),
});
export type ElcntItem = z.infer<typeof ElcntItemSchema>;
```

- [ ] **Step 2: api-client 작성**

`scripts/ingest/lib/api-client.ts`:

```ts
import { z } from "zod";
import { ApiError, ApiResponseSchema } from "./types";

const BASE = "https://apis.data.go.kr/9760000";
const DEFAULT_PAGE_SIZE = 1000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

export interface FetchResult {
  items: unknown[];
  totalCount: number;
  pageNo: number;
  numOfRows: number;
}

export async function fetchSelangwiApi(
  service: string,
  endpoint: string,
  params: Record<string, string | number>,
  opts: { pageNo?: number; numOfRows?: number } = {},
): Promise<FetchResult> {
  const key = process.env.DATA_GO_KR_API_KEY;
  if (!key) throw new Error("DATA_GO_KR_API_KEY 미설정");

  const url = new URL(`${BASE}/${service}/${endpoint}`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("type", "json");
  url.searchParams.set("resultType", "json");
  url.searchParams.set("pageNo", String(opts.pageNo ?? 1));
  url.searchParams.set("numOfRows", String(opts.numOfRows ?? DEFAULT_PAGE_SIZE));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url.toString());
      if (!res.ok) {
        const body = await res.text();
        throw new ApiError(String(res.status), `HTTP ${res.status}: ${body.slice(0, 200)}`, url.toString());
      }
      const json = await res.json();
      const parsed = ApiResponseSchema.parse(json);
      const code = parsed.response.header.resultCode;
      if (code !== "INFO-000" && code !== "INFO-00") {
        throw new ApiError(code, `${code}: ${parsed.response.header.resultMsg}`, url.toString());
      }
      const body = parsed.response.body ?? {};
      const itemsRaw = (body.items as { item?: unknown })?.item ?? body.items ?? [];
      const items = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];
      return {
        items,
        totalCount: body.totalCount ?? items.length,
        pageNo: body.pageNo ?? 1,
        numOfRows: body.numOfRows ?? items.length,
      };
    } catch (err) {
      lastError = err as Error;
      if (err instanceof ApiError && !/^\d+$/.test(err.code)) throw err;  // 비즈니스 오류 즉시 throw
      if (err instanceof z.ZodError) throw err;
      if (attempt < MAX_RETRIES) {
        // 지수 백오프: 1s → 2s → 4s
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError ?? new Error("Unknown error");
}

export async function fetchAllPages(
  service: string,
  endpoint: string,
  params: Record<string, string | number>,
): Promise<unknown[]> {
  const all: unknown[] = [];
  let pageNo = 1;
  while (true) {
    let result: FetchResult;
    try {
      result = await fetchSelangwiApi(service, endpoint, params, { pageNo });
    } catch (err) {
      if (err instanceof ApiError && err.code === "INFO-300") return all;  // 데이터 없음 = 빈 결과
      throw err;
    }
    all.push(...result.items);
    if (result.items.length === 0) break;
    if (all.length >= result.totalCount) break;
    pageNo += 1;
    if (pageNo > 100) throw new Error("페이지 한도 초과 (100)");
  }
  return all;
}
```

- [ ] **Step 3: 단위 테스트 작성**

`tests/unit/api-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchSelangwiApi, fetchAllPages } from "../../scripts/ingest/lib/api-client";
import { ApiError } from "../../scripts/ingest/lib/types";

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.DATA_GO_KR_API_KEY = "test-key";
});

describe("fetchSelangwiApi", () => {
  it("정상 응답을 파싱한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      response: {
        header: { resultCode: "INFO-000", resultMsg: "정상" },
        body: { items: { item: [{ sgId: "20250603" }] }, totalCount: 1, pageNo: 1, numOfRows: 1 },
      },
    }), { status: 200 }));
    const r = await fetchSelangwiApi("VoteXmntckInfoInqireService2", "getXmntckSttusInfoInqire", { sgId: "20250603" });
    expect(r.items).toEqual([{ sgId: "20250603" }]);
    expect(r.totalCount).toBe(1);
  });

  it("INFO-300 은 ApiError 로 던진다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      response: { header: { resultCode: "INFO-300", resultMsg: "데이터 없음" } },
    }), { status: 200 }));
    await expect(fetchSelangwiApi("X", "Y", {})).rejects.toThrow(ApiError);
  });

  it("HTTP 5xx 에서 3회 재시도", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("err", { status: 500 }));
    await expect(fetchSelangwiApi("X", "Y", {})).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(3);
  }, 30_000);
});

describe("fetchAllPages", () => {
  it("INFO-300 은 빈 배열 반환", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      response: { header: { resultCode: "INFO-300", resultMsg: "데이터 없음" } },
    }), { status: 200 }));
    const r = await fetchAllPages("X", "Y", {});
    expect(r).toEqual([]);
  });

  it("totalCount 도달 시 종료", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      response: {
        header: { resultCode: "INFO-000", resultMsg: "정상" },
        body: { items: { item: [{ a: 1 }, { a: 2 }] }, totalCount: 2, pageNo: 1, numOfRows: 2 },
      },
    }), { status: 200 }));
    const r = await fetchAllPages("X", "Y", {});
    expect(r).toHaveLength(2);
  });
});
```

- [ ] **Step 4: 테스트 실행**

Run: `pnpm test`
Expected: 8(기존) + 5(신규) = 13 tests PASS

- [ ] **Step 5: 커밋**

```sh
git add scripts/ingest/lib/types.ts scripts/ingest/lib/api-client.ts tests/unit/api-client.test.ts
git commit -m "data.go.kr api-client + zod 응답 schema + 단위 테스트"
```

---

## Task 4: party-resolver.ts (TDD)

**Files:**
- Create: `scripts/ingest/lib/party-resolver.ts`
- Create: `tests/unit/party-resolver.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`tests/unit/party-resolver.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql, db } from "../../src/lib/db-admin";
import { electionPartyOverrides, partyAliases, parties, elections } from "../../db/schema";
import { resolveParty } from "../../scripts/ingest/lib/party-resolver";
import { eq } from "drizzle-orm";

const TEST_ELECTION = "test-1.1-election";
const TEST_OVERRIDE_RAW = "테스트당";
const TEST_ALIAS_RAW = "테스트별칭";

beforeEach(async () => {
  await db.delete(electionPartyOverrides).where(eq(electionPartyOverrides.electionId, TEST_ELECTION));
  await db.delete(partyAliases).where(eq(partyAliases.alias, TEST_ALIAS_RAW));
  await db.delete(elections).where(eq(elections.id, TEST_ELECTION));
  await db.insert(elections).values({ id: TEST_ELECTION, date: "2025-01-01", type: "presidential", name: "테스트" });
});

afterEach(async () => {
  await db.delete(electionPartyOverrides).where(eq(electionPartyOverrides.electionId, TEST_ELECTION));
  await db.delete(partyAliases).where(eq(partyAliases.alias, TEST_ALIAS_RAW));
  await db.delete(elections).where(eq(elections.id, TEST_ELECTION));
});

describe("resolveParty", () => {
  it("override 가 alias 보다 우선", async () => {
    await db.insert(electionPartyOverrides).values({
      electionId: TEST_ELECTION, rawName: TEST_OVERRIDE_RAW, partyId: "justice",
    });
    await db.insert(partyAliases).values({
      alias: TEST_OVERRIDE_RAW, partyId: "democratic", validFrom: "2000-01-01",
    });
    const r = await resolveParty(TEST_ELECTION, "2025-01-01", TEST_OVERRIDE_RAW);
    expect(r).toBe("justice");
  });

  it("alias 시기 매칭 — validFrom/validUntil 내", async () => {
    await db.insert(partyAliases).values({
      alias: TEST_ALIAS_RAW, partyId: "justice",
      validFrom: "2020-01-01", validUntil: "2030-12-31",
    });
    expect(await resolveParty(TEST_ELECTION, "2025-01-01", TEST_ALIAS_RAW)).toBe("justice");
  });

  it("alias 시기 범위 밖이면 null", async () => {
    await db.insert(partyAliases).values({
      alias: TEST_ALIAS_RAW, partyId: "justice",
      validFrom: "2000-01-01", validUntil: "2010-12-31",
    });
    expect(await resolveParty(TEST_ELECTION, "2025-01-01", TEST_ALIAS_RAW)).toBeNull();
  });

  it("매칭 실패 시 null", async () => {
    expect(await resolveParty(TEST_ELECTION, "2025-01-01", "존재하지않는당")).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test tests/unit/party-resolver.test.ts`
Expected: 4 tests FAIL (resolveParty 미정의)

- [ ] **Step 3: party-resolver 구현**

`scripts/ingest/lib/party-resolver.ts`:

```ts
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "../../../src/lib/db-admin";
import { electionPartyOverrides, partyAliases } from "../../../db/schema";

/**
 * 우선순위: election_party_overrides → party_aliases(시기 매칭) → null
 *
 * @param electionId - elections.id (예: "2025-presidential")
 * @param electionDate - YYYY-MM-DD (alias validFrom/validUntil 비교용)
 * @param rawName - data.go.kr 응답의 jdName 등 원문 정당명
 * @returns parties.id 또는 null (매칭 실패 — 호출자가 R3 경고 누적)
 */
export async function resolveParty(
  electionId: string,
  electionDate: string,
  rawName: string,
): Promise<string | null> {
  const override = await db
    .select()
    .from(electionPartyOverrides)
    .where(and(
      eq(electionPartyOverrides.electionId, electionId),
      eq(electionPartyOverrides.rawName, rawName),
    ))
    .limit(1);
  if (override.length) return override[0].partyId;

  const alias = await db
    .select()
    .from(partyAliases)
    .where(and(
      eq(partyAliases.alias, rawName),
      or(isNull(partyAliases.validFrom), lte(partyAliases.validFrom, electionDate)),
      or(isNull(partyAliases.validUntil), gte(partyAliases.validUntil, electionDate)),
    ))
    .limit(1);
  if (alias.length) return alias[0].partyId;

  return null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test tests/unit/party-resolver.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: 커밋**

```sh
git add scripts/ingest/lib/party-resolver.ts tests/unit/party-resolver.test.ts
git commit -m "party-resolver — override → alias → null 우선순위 + 단위 테스트"
```

---

## Task 5: fetch-results.ts (VoteXmntckInfoInqireService2)

**Files:**
- Create: `scripts/ingest/fetch-results.ts`
- Modify: `.gitignore` (data/raw/ 추가)

- [ ] **Step 1: .gitignore 갱신**

`.gitignore` 끝에 추가:

```
# data.go.kr raw 캐시 (재실행 시 재생성)
/data/raw/
```

- [ ] **Step 2: fetch-results 구현**

`scripts/ingest/fetch-results.ts`:

```ts
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllPages } from "./lib/api-client";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_BASE = path.join(HERE, "..", "..", "data", "raw");

export interface ElectionFetchSpec {
  electionId: string;
  sgId: string;        // necElectionId
  sgTypecode: string;  // necCode
}

/**
 * 한 election 의 시·도/시·군 정당·후보자 raw 응답을 받아 캐시한다.
 * 캐시 hit 시 fetch 생략. force=true 면 API 재호출.
 *
 * @returns raw items 배열 (XmntckItem 형식, 시·도/시·군 × 후보자 × 정당 행)
 */
export async function fetchResults(
  spec: ElectionFetchSpec,
  opts: { force?: boolean } = {},
): Promise<unknown[]> {
  const dir = path.join(RAW_BASE, spec.electionId);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "vote-xmntck.json");

  if (!opts.force && existsSync(file)) {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw);
  }

  console.log(`  fetch ${spec.electionId} (sgTypecode=${spec.sgTypecode}) ...`);
  const items = await fetchAllPages(
    "VoteXmntckInfoInqireService2",
    "getXmntckSttusInfoInqire",
    { sgId: spec.sgId, sgTypecode: spec.sgTypecode },
  );

  await writeFile(file, JSON.stringify(items, null, 2), "utf-8");
  console.log(`  saved ${items.length} rows → ${path.relative(process.cwd(), file)}`);
  return items;
}
```

- [ ] **Step 3: 빠른 동작 점검 (수동, 1 election)**

`pnpm tsx -e` 직접 호출로 한 번 검증 — 이건 코드 변경 아니고 실 API 호출:

Run:
```sh
pnpm dotenv -e .env.local -- tsx -e "
import { fetchResults } from './scripts/ingest/fetch-results';
fetchResults({ electionId: '2025-presidential', sgId: '0020250603', sgTypecode: '1' })
  .then(r => console.log('rows:', r.length))
  .catch(e => { console.error(e); process.exit(1); });
"
```
Expected: `saved <N> rows → data/raw/2025-presidential/vote-xmntck.json` (N: 보통 수백~수천)

`data/raw/2025-presidential/vote-xmntck.json` 파일이 생성되어야 함.

- [ ] **Step 4: 커밋**

```sh
git add .gitignore scripts/ingest/fetch-results.ts
git commit -m "fetch-results — VoteXmntckInfoInqireService2 raw 캐시"
```

---

## Task 6: fetch-voters.ts (ElcntInfoInqireService)

**Files:**
- Create: `scripts/ingest/fetch-voters.ts`

- [ ] **Step 1: fetch-voters 구현**

`scripts/ingest/fetch-voters.ts`:

```ts
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllPages } from "./lib/api-client";
import type { ElectionFetchSpec } from "./fetch-results";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_BASE = path.join(HERE, "..", "..", "data", "raw");

/**
 * 한 election 의 시·군 단위 선거인수/투표수/유효표/무효표 raw 응답을 받아 캐시한다.
 *
 * @returns raw items 배열 (ElcntItem 형식, 시·군 행 — sdName/wiwName 으로 식별)
 */
export async function fetchVoters(
  spec: ElectionFetchSpec,
  opts: { force?: boolean } = {},
): Promise<unknown[]> {
  const dir = path.join(RAW_BASE, spec.electionId);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "elcnt.json");

  if (!opts.force && existsSync(file)) {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw);
  }

  console.log(`  fetch ${spec.electionId} voters ...`);
  const items = await fetchAllPages(
    "ElcntInfoInqireService",
    "getGsigElcntInfoInqire",
    { sgId: spec.sgId },
  );

  await writeFile(file, JSON.stringify(items, null, 2), "utf-8");
  console.log(`  saved ${items.length} rows → ${path.relative(process.cwd(), file)}`);
  return items;
}
```

- [ ] **Step 2: 빠른 동작 점검**

Run:
```sh
pnpm dotenv -e .env.local -- tsx -e "
import { fetchVoters } from './scripts/ingest/fetch-voters';
fetchVoters({ electionId: '2025-presidential', sgId: '0020250603', sgTypecode: '1' })
  .then(r => console.log('rows:', r.length))
  .catch(e => { console.error(e); process.exit(1); });
"
```
Expected: `data/raw/2025-presidential/elcnt.json` 생성 + 시·군 분모 행 약 270개

- [ ] **Step 3: 커밋**

```sh
git add scripts/ingest/fetch-voters.ts
git commit -m "fetch-voters — ElcntInfoInqireService raw 캐시"
```

---

## Task 7: process.ts (raw → vote_totals + region_totals + candidates)

**Files:**
- Create: `scripts/ingest/process.ts`
- Create: `tests/fixtures/raw/vote-xmntck-presidential.json` (실 응답에서 일부 발췌)
- Create: `tests/fixtures/raw/elcnt-gusigun.json`
- Create: `tests/unit/process.test.ts`

- [ ] **Step 1: 픽스처 작성 (실 응답에서 발췌)**

Task 5/6 에서 받은 `data/raw/2025-presidential/vote-xmntck.json` 에서 시·도 합계 행 1개 + 시·군 행 2개 × 후보자 3명 = 약 9~12행을 골라 `tests/fixtures/raw/vote-xmntck-presidential.json` 으로 복사. 같은 식으로 `elcnt-gusigun.json` 도 5~10행 발췌.

(실 응답 구조에 의존하므로 Task 5/6 완료 후 진행. 실 응답 행 예시:)

```json
[
  { "sgId": "0020250603", "sgTypecode": "1", "sdName": "서울특별시", "wiwName": "합계",
    "hbojaName": "이○○", "jdName": "더불어민주당", "vtTcnt": 1234567, "vtRate": 50.1 },
  { "sgId": "0020250603", "sgTypecode": "1", "sdName": "서울특별시", "wiwName": "종로구",
    "hbojaName": "이○○", "jdName": "더불어민주당", "vtTcnt": 12345, "vtRate": 51.2 }
]
```

- [ ] **Step 2: process 헬퍼 함수 테스트 작성**

`tests/unit/process.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractVoteTotals, extractRegionTotals, extractCandidates, isAggregateRow } from "../../scripts/ingest/process";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function loadFixture(name: string) {
  return JSON.parse(await readFile(path.join(HERE, "..", "fixtures", "raw", name), "utf-8"));
}

describe("isAggregateRow", () => {
  it("wiwName=합계 면 true (시·도 합계 행)", () => {
    expect(isAggregateRow({ sdName: "서울특별시", wiwName: "합계" })).toBe(true);
  });
  it("wiwName 이 시·군명이면 false", () => {
    expect(isAggregateRow({ sdName: "서울특별시", wiwName: "종로구" })).toBe(false);
  });
});

describe("extractVoteTotals (정당 단위 집계)", () => {
  it("같은 sdName/wiwName/jdName 행들을 합산", async () => {
    const rows = await loadFixture("vote-xmntck-presidential.json");
    const result = extractVoteTotals(rows);
    // 합계 결과: (sdName, wiwName, jdName) 키로 vtTcnt 합산
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    // 각 행 형태
    expect(result[0]).toMatchObject({
      sdName: expect.any(String),
      wiwName: expect.any(String),
      jdName: expect.any(String),
      votes: expect.any(Number),
    });
  });
});

describe("extractRegionTotals (분모)", () => {
  it("ElcntItem 행 형식 그대로 보존", async () => {
    const rows = await loadFixture("elcnt-gusigun.json");
    const result = extractRegionTotals(rows);
    expect(result.length).toBe(rows.length);
    expect(result[0]).toMatchObject({
      sdName: expect.any(String),
      wiwName: expect.any(String),
      totalVoters: expect.any(Number),
      totalVotes: expect.any(Number),
    });
  });
});

describe("extractCandidates (후보자)", () => {
  it("같은 후보자(name+jdName) 행들을 election 전체 합으로 집계", async () => {
    const rows = await loadFixture("vote-xmntck-presidential.json");
    const result = extractCandidates(rows);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toMatchObject({
      constituency: expect.any(String),  // 대선은 "전국" 또는 sgggName
      name: expect.any(String),
      partyNameRaw: expect.any(String),
      votes: expect.any(Number),
    });
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm test tests/unit/process.test.ts`
Expected: 6 tests FAIL (헬퍼 미정의)

- [ ] **Step 4: process 헬퍼 함수 구현**

`scripts/ingest/process.ts` (처음 부분 — 순수 함수만, DB I/O 는 Step 6):

```ts
import { z } from "zod";
import { XmntckItemSchema, ElcntItemSchema, type XmntckItem, type ElcntItem } from "./lib/types";

export function isAggregateRow(row: { wiwName?: string }): boolean {
  return row.wiwName === "합계";
}

export interface VoteTotalRow {
  sdName: string;
  wiwName: string;   // "합계"(시·도) 또는 시·군명
  jdName: string;    // 원문 정당명 (party-resolver 후 partyId 매핑)
  votes: number;
}

/**
 * data.go.kr 응답은 wide format — 한 행에 jd01~jd50/hbj01~hbj50/dugsu01~dugsu50 가 펼쳐져 있다.
 * 한 행을 후보자 단위 셀로 expand.
 */
interface CandidateCell {
  jd: string;                       // 정당명 (예: "더불어민주당")
  hbj: string | undefined;          // 후보자명 (없으면 undefined)
  dugsu: number;                    // 득표수
}

export function expandCells(row: Record<string, unknown>): CandidateCell[] {
  const cells: CandidateCell[] = [];
  for (let i = 1; i <= 50; i++) {
    const pad = String(i).padStart(2, "0");
    const jdRaw = row[`jd${pad}`];
    if (jdRaw == null || jdRaw === "") continue;
    const jd = typeof jdRaw === "string" ? jdRaw : String(jdRaw);
    const hbjRaw = row[`hbj${pad}`];
    const hbj = typeof hbjRaw === "string" && hbjRaw !== "" ? hbjRaw : undefined;
    const dugsuRaw = row[`dugsu${pad}`];
    const dugsu = dugsuRaw == null || dugsuRaw === "" ? 0 : Number(dugsuRaw);
    cells.push({ jd, hbj, dugsu });
  }
  return cells;
}

/**
 * wide row → (sdName, wiwName, jdName) long 행으로 펼치고 합산.
 */
export function extractVoteTotals(rawItems: unknown[]): VoteTotalRow[] {
  const parsed = rawItems.map((r) => XmntckItemSchema.parse(r) as Record<string, unknown>);
  const map = new Map<string, VoteTotalRow>();
  for (const r of parsed) {
    const sd = (r.sdName as string) ?? "";
    const wi = (r.wiwName as string) ?? "";
    if (!sd || !wi) continue;
    for (const cell of expandCells(r)) {
      const key = `${sd}|${wi}|${cell.jd}`;
      const cur = map.get(key);
      if (cur) cur.votes += cell.dugsu;
      else map.set(key, { sdName: sd, wiwName: wi, jdName: cell.jd, votes: cell.dugsu });
    }
  }
  return [...map.values()];
}

export interface RegionTotalRow {
  sdName: string;
  wiwName: string;
  totalVoters: number | null;
  totalVotes: number | null;
  validVotes: number | null;
  invalidVotes: number | null;
}

export function extractRegionTotals(rawItems: unknown[]): RegionTotalRow[] {
  const parsed = rawItems.map((r) => ElcntItemSchema.parse(r));
  return parsed
    .filter((r) => r.sdName && r.wiwName)
    .map((r) => ({
      sdName: r.sdName,
      wiwName: r.wiwName!,
      totalVoters: r.selecMan ?? null,
      totalVotes: r.tvoteNum ?? null,
      validVotes: r.validNum ?? null,
      invalidVotes: r.invalidNum ?? null,
    }));
}

export interface CandidateRow {
  constituency: string;
  name: string;
  partyNameRaw: string;
  votes: number;
}

/**
 * 후보자 단위: (constituency, name, jdName) 키로 행 집계 (election 전체 합).
 * wide row 를 expand 한 뒤 후보자명(hbj) 가 있는 셀만 candidates 로 적재.
 * constituency 는 선거 유형에 따라:
 *  - 대선: sgggName 의 "대한민국" 그대로 사용 (단일 선거구)
 *  - 도지사: sgggName 의 "○○시·도" 사용
 *  - 시장군수: sgggName=시·군 그대로
 *  - 지역구 의원: sgggName=선거구명
 * 합계 행(wiwName="합계")은 중복 합산 방지를 위해 제외.
 */
export function extractCandidates(rawItems: unknown[]): CandidateRow[] {
  const parsed = rawItems.map((r) => XmntckItemSchema.parse(r) as Record<string, unknown>);
  const map = new Map<string, CandidateRow>();
  for (const r of parsed) {
    const wi = (r.wiwName as string) ?? "";
    if (wi === "합계") continue;
    const constituency = (r.sggName as string) ?? (r.sdName as string) ?? "";
    if (!constituency) continue;
    for (const cell of expandCells(r)) {
      if (!cell.hbj) continue;
      const key = `${constituency}|${cell.hbj}|${cell.jd}`;
      const cur = map.get(key);
      if (cur) cur.votes += cell.dugsu;
      else map.set(key, { constituency, name: cell.hbj, partyNameRaw: cell.jd, votes: cell.dugsu });
    }
  }
  return [...map.values()];
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm test tests/unit/process.test.ts`
Expected: 6 tests PASS

- [ ] **Step 6: DB upsert 함수 추가**

`scripts/ingest/process.ts` 끝에 추가:

```ts
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../src/lib/db-admin";
import { regions, voteTotals, regionTotals, candidates } from "../../db/schema";
import { resolveParty } from "./lib/party-resolver";

export interface ProcessReport {
  voteTotalsUpserted: number;
  regionTotalsUpserted: number;
  candidatesInserted: number;
  unresolvedRawNames: { rawName: string; votes: number }[];  // R3 누적
  // diff 옵션에서 사용 — 변환된 정형 행 목록 (DB upsert 대상)
  voteToUpsert: { electionId: string; regionCode: string; partyId: string; votes: number }[];
  regToUpsert: { electionId: string; regionCode: string; totalVoters: number | null; totalVotes: number | null; validVotes: number | null; invalidVotes: number | null }[];
  candToInsert: { electionId: string; constituency: string; name: string; partyId: string | null; partyNameRaw: string; votes: number; isWinner: boolean }[];
}

/**
 * 한 election 의 raw 응답들을 정형화·매핑 후 DB upsert.
 * candidates 는 election 단위 replace (DELETE + INSERT).
 */
export async function processElection(
  electionId: string,
  electionDate: string,
  votesRaw: unknown[],
  votersRaw: unknown[],
  opts: { dryRun?: boolean } = {},
): Promise<ProcessReport> {
  // 1) region name → code lookup (sdName, wiwName)
  const allRegions = await db.select().from(regions);
  const sidoByName = new Map(allRegions.filter((r) => r.level === "sido").map((r) => [r.name, r]));
  const sigunguByKey = new Map(
    allRegions
      .filter((r) => r.level === "sigungu")
      .map((r) => {
        const parent = allRegions.find((p) => p.code === r.parentCode);
        return [`${parent?.name ?? ""}|${r.name}`, r];
      }),
  );

  function regionCodeOf(sdName: string, wiwName: string): string | null {
    if (wiwName === "합계") return sidoByName.get(sdName)?.code ?? null;
    // (1) 정확 매칭
    const exact = sigunguByKey.get(`${sdName}|${wiwName}`);
    if (exact) return exact.code;
    // (2) wiwName 끝 토큰 매칭 — data.go.kr 응답은 "창원시의창구"처럼 시·군명+일반구명을 붙여 쓴 형식이 많음.
    //     해당 시·도 안의 sigungu 중 name 으로 endsWith 매칭.
    const sidoCode = sidoByName.get(sdName)?.code;
    if (sidoCode) {
      for (const r of allRegions) {
        if (r.level !== "sigungu") continue;
        if (r.parentCode !== sidoCode) continue;
        if (wiwName.endsWith(r.name)) return r.code;
      }
    }
    return null;
  }

  // 2) vote_totals 변환
  const voteRows = extractVoteTotals(votesRaw);
  const unresolved = new Map<string, number>();
  const voteToUpsert: { electionId: string; regionCode: string; partyId: string; votes: number }[] = [];

  for (const v of voteRows) {
    const code = regionCodeOf(v.sdName, v.wiwName);
    if (!code) continue;  // 지역 코드 매칭 실패 — R1 검증에서 잡힘
    const partyId = await resolveParty(electionId, electionDate, v.jdName);
    if (!partyId) {
      unresolved.set(v.jdName, (unresolved.get(v.jdName) ?? 0) + v.votes);
      continue;
    }
    voteToUpsert.push({ electionId, regionCode: code, partyId, votes: v.votes });
  }

  // 3) region_totals 변환
  const regRows = extractRegionTotals(votersRaw);
  const regToUpsert: { electionId: string; regionCode: string; totalVoters: number | null; totalVotes: number | null; validVotes: number | null; invalidVotes: number | null }[] = [];
  for (const r of regRows) {
    const code = regionCodeOf(r.sdName, r.wiwName);
    if (!code) continue;
    regToUpsert.push({ electionId, regionCode: code, totalVoters: r.totalVoters, totalVotes: r.totalVotes, validVotes: r.validVotes, invalidVotes: r.invalidVotes });
  }

  // 4) candidates 변환
  const candRows = extractCandidates(votesRaw);
  const candToInsert: { electionId: string; constituency: string; name: string; partyId: string | null; partyNameRaw: string; votes: number; isWinner: boolean }[] = [];
  for (const c of candRows) {
    const partyId = await resolveParty(electionId, electionDate, c.partyNameRaw);
    candToInsert.push({ electionId, constituency: c.constituency, name: c.name, partyId, partyNameRaw: c.partyNameRaw, votes: c.votes, isWinner: false });
  }

  if (opts.dryRun) {
    return {
      voteTotalsUpserted: voteToUpsert.length,
      regionTotalsUpserted: regToUpsert.length,
      candidatesInserted: candToInsert.length,
      unresolvedRawNames: [...unresolved].map(([rawName, votes]) => ({ rawName, votes })),
      voteToUpsert, regToUpsert, candToInsert,
    };
  }

  // 5) DB upsert
  for (const row of voteToUpsert) {
    await db
      .insert(voteTotals)
      .values(row)
      .onConflictDoUpdate({
        target: [voteTotals.electionId, voteTotals.regionCode, voteTotals.partyId],
        set: { votes: row.votes },
      });
  }
  for (const row of regToUpsert) {
    await db
      .insert(regionTotals)
      .values(row)
      .onConflictDoUpdate({
        target: [regionTotals.electionId, regionTotals.regionCode],
        set: { totalVoters: row.totalVoters, totalVotes: row.totalVotes, validVotes: row.validVotes, invalidVotes: row.invalidVotes },
      });
  }
  await db.delete(candidates).where(eq(candidates.electionId, electionId));
  if (candToInsert.length) await db.insert(candidates).values(candToInsert);

  return {
    voteTotalsUpserted: voteToUpsert.length,
    regionTotalsUpserted: regToUpsert.length,
    candidatesInserted: candToInsert.length,
    unresolvedRawNames: [...unresolved].map(([rawName, votes]) => ({ rawName, votes })),
    voteToUpsert, regToUpsert, candToInsert,
  };
}
```

- [ ] **Step 7: 테스트 재실행 (전체)**

Run: `pnpm test`
Expected: 모든 테스트 PASS (기존 + Task 3·4·7 추가분)

- [ ] **Step 8: 커밋**

```sh
git add scripts/ingest/process.ts tests/fixtures/ tests/unit/process.test.ts
git commit -m "process — raw → vote_totals + region_totals + candidates 변환·upsert"
```

---

## Task 8: validate.ts (R1~R4)

**Files:**
- Create: `scripts/ingest/validate.ts`
- Create: `tests/unit/validate.test.ts`

- [ ] **Step 1: 테스트 작성**

`tests/unit/validate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkSumConsistency, checkDenominatorConsistency, type SumDelta } from "../../scripts/ingest/validate";

describe("checkSumConsistency (R2)", () => {
  it("시·군 합 = 시·도 합계 ±0.5% 면 PASS", () => {
    const result = checkSumConsistency([
      { electionId: "e1", regionCode: "11", partyId: "p1", votes: 1000 },  // 시·도 합계
      { electionId: "e1", regionCode: "1101", partyId: "p1", votes: 600 }, // 시·군
      { electionId: "e1", regionCode: "1102", partyId: "p1", votes: 400 },
    ], [
      { code: "11", level: "sido", parentCode: null },
      { code: "1101", level: "sigungu", parentCode: "11" },
      { code: "1102", level: "sigungu", parentCode: "11" },
    ]);
    expect(result.violations).toEqual([]);
  });

  it("델타 > 0.5% 면 위반", () => {
    const result = checkSumConsistency([
      { electionId: "e1", regionCode: "11", partyId: "p1", votes: 1000 },
      { electionId: "e1", regionCode: "1101", partyId: "p1", votes: 800 },  // 합 800, sido 1000 → -20%
    ], [
      { code: "11", level: "sido", parentCode: null },
      { code: "1101", level: "sigungu", parentCode: "11" },
    ]);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].deltaPct).toBeGreaterThan(0.5);
  });
});

describe("checkDenominatorConsistency (R4)", () => {
  it("valid + invalid == total 이고 progress 0~100 이면 통과", () => {
    const result = checkDenominatorConsistency([
      { electionId: "e1", regionCode: "11", totalVoters: 100, totalVotes: 50, validVotes: 45, invalidVotes: 5 },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("valid + invalid != total 이면 경고", () => {
    const result = checkDenominatorConsistency([
      { electionId: "e1", regionCode: "11", totalVoters: 100, totalVotes: 50, validVotes: 45, invalidVotes: 4 },
    ]);
    expect(result.warnings.length).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test tests/unit/validate.test.ts`
Expected: 4 tests FAIL

- [ ] **Step 3: validate 구현**

`scripts/ingest/validate.ts`:

```ts
import { eq, inArray } from "drizzle-orm";
import { db } from "../../src/lib/db-admin";
import { regions, voteTotals, regionTotals, candidates, elections } from "../../db/schema";

export interface SumDelta {
  electionId: string;
  sidoCode: string;
  partyId: string;
  sidoVotes: number;
  sigunguSum: number;
  deltaPct: number;
}

export interface SumCheckResult { violations: SumDelta[]; }

export interface DenomWarning {
  electionId: string;
  regionCode: string;
  issue: "sum_mismatch" | "progress_out_of_range";
  detail: string;
}

export interface DenomCheckResult { warnings: DenomWarning[]; }

export interface StructureCheckResult {
  missingRegions: { electionId: string; regionCode: string }[];
}

export interface ValidationReport {
  electionId: string;
  r1Structure: StructureCheckResult;
  r2Sum: SumCheckResult;
  r3UnresolvedRawNames: { rawName: string; votes: number }[];
  r4Denominator: DenomCheckResult;
  fatal: boolean;  // R1 또는 R2 위반 시 true
}

const TOLERANCE_PCT = 0.5;

/**
 * R2: 같은 election + party 의 시·군 votes 합이 시·도 vote_totals 와 ±0.5% 이내인지.
 */
export function checkSumConsistency(
  rows: { electionId: string; regionCode: string; partyId: string; votes: number }[],
  allRegions: { code: string; level: string; parentCode: string | null }[],
): SumCheckResult {
  const sidoSet = new Set(allRegions.filter((r) => r.level === "sido").map((r) => r.code));
  const childrenBySido = new Map<string, string[]>();
  for (const r of allRegions.filter((r) => r.level === "sigungu" && r.parentCode)) {
    const arr = childrenBySido.get(r.parentCode!) ?? [];
    arr.push(r.code);
    childrenBySido.set(r.parentCode!, arr);
  }

  // (electionId, partyId, sidoCode) → sidoVotes / sigunguSum
  const byKey = new Map<string, { sido?: number; childSum: number; electionId: string; sidoCode: string; partyId: string }>();
  for (const row of rows) {
    if (sidoSet.has(row.regionCode)) {
      // 시·도 행
      const key = `${row.electionId}|${row.partyId}|${row.regionCode}`;
      const cur = byKey.get(key) ?? { childSum: 0, electionId: row.electionId, sidoCode: row.regionCode, partyId: row.partyId };
      cur.sido = row.votes;
      byKey.set(key, cur);
    } else {
      // 시·군 — parent 찾기
      const parent = allRegions.find((r) => r.code === row.regionCode)?.parentCode;
      if (!parent) continue;
      const key = `${row.electionId}|${row.partyId}|${parent}`;
      const cur = byKey.get(key) ?? { childSum: 0, electionId: row.electionId, sidoCode: parent, partyId: row.partyId };
      cur.childSum += row.votes;
      byKey.set(key, cur);
    }
  }

  const violations: SumDelta[] = [];
  for (const v of byKey.values()) {
    if (v.sido == null) continue;
    if (v.sido === 0 && v.childSum === 0) continue;
    const denom = Math.max(Math.abs(v.sido), 1);
    const deltaPct = Math.abs(v.sido - v.childSum) / denom * 100;
    if (deltaPct > TOLERANCE_PCT) {
      violations.push({ electionId: v.electionId, sidoCode: v.sidoCode, partyId: v.partyId, sidoVotes: v.sido, sigunguSum: v.childSum, deltaPct });
    }
  }
  return { violations };
}

/**
 * R4: valid + invalid == total, 그리고 progress_pct ∈ [0, 100].
 */
export function checkDenominatorConsistency(
  rows: { electionId: string; regionCode: string; totalVoters: number | null; totalVotes: number | null; validVotes: number | null; invalidVotes: number | null }[],
): DenomCheckResult {
  const warnings: DenomWarning[] = [];
  for (const r of rows) {
    if (r.totalVotes != null && r.validVotes != null && r.invalidVotes != null) {
      if (r.validVotes + r.invalidVotes !== r.totalVotes) {
        warnings.push({
          electionId: r.electionId, regionCode: r.regionCode, issue: "sum_mismatch",
          detail: `valid(${r.validVotes}) + invalid(${r.invalidVotes}) != total(${r.totalVotes})`,
        });
      }
    }
    if (r.totalVoters != null && r.totalVoters > 0 && r.totalVotes != null) {
      const pct = r.totalVotes / r.totalVoters * 100;
      if (pct < 0 || pct > 100) {
        warnings.push({ electionId: r.electionId, regionCode: r.regionCode, issue: "progress_out_of_range", detail: `${pct.toFixed(2)}%` });
      }
    }
  }
  return { warnings };
}

/**
 * R1: election 별 수행 대상 (sido + sigungu) 셋 대비 실제 vote_totals 가 가진 region 셋.
 * 비례·일부 선거 유형은 적용 대상 region 이 다를 수 있어 "election 별 적재된 region 셋에 sido 17개가 모두 있어야 한다" 로 정의.
 */
export async function validateElection(
  electionId: string,
  unresolvedRawNames: { rawName: string; votes: number }[],
): Promise<ValidationReport> {
  const allRegions = await db.select().from(regions);
  const sidoCodes = allRegions.filter((r) => r.level === "sido").map((r) => r.code);

  const votes = await db.select().from(voteTotals).where(eq(voteTotals.electionId, electionId));
  const regs = await db.select().from(regionTotals).where(eq(regionTotals.electionId, electionId));

  // R1
  const presentSido = new Set(votes.filter((v) => sidoCodes.includes(v.regionCode)).map((v) => v.regionCode));
  const missingRegions = sidoCodes.filter((c) => !presentSido.has(c)).map((c) => ({ electionId, regionCode: c }));

  // R2
  const r2 = checkSumConsistency(votes.map((v) => ({ electionId: v.electionId, regionCode: v.regionCode, partyId: v.partyId, votes: v.votes })),
    allRegions.map((r) => ({ code: r.code, level: r.level, parentCode: r.parentCode })));

  // R4
  const r4 = checkDenominatorConsistency(regs.map((r) => ({
    electionId: r.electionId, regionCode: r.regionCode,
    totalVoters: r.totalVoters, totalVotes: r.totalVotes, validVotes: r.validVotes, invalidVotes: r.invalidVotes,
  })));

  const fatal = missingRegions.length > 0 || r2.violations.length > 0;

  return {
    electionId,
    r1Structure: { missingRegions },
    r2Sum: r2,
    r3UnresolvedRawNames: unresolvedRawNames,
    r4Denominator: r4,
    fatal,
  };
}

export function formatReport(rep: ValidationReport): string {
  const lines: string[] = [];
  lines.push(`=== Ingest Report: ${rep.electionId} ===`);
  lines.push(`R1 구조:        ${rep.r1Structure.missingRegions.length === 0 ? "PASS" : `FAIL — 누락 시·도 ${rep.r1Structure.missingRegions.length}개`}`);
  lines.push(`R2 합계:        ${rep.r2Sum.violations.length === 0 ? "PASS" : `FAIL — 위반 ${rep.r2Sum.violations.length}건 (max delta ${Math.max(...rep.r2Sum.violations.map((v) => v.deltaPct)).toFixed(2)}%)`}`);
  if (rep.r3UnresolvedRawNames.length === 0) {
    lines.push(`R3 alias:       PASS`);
  } else {
    lines.push(`R3 alias:       WARN — 미매칭 raw 정당명 ${rep.r3UnresolvedRawNames.length}건:`);
    for (const u of rep.r3UnresolvedRawNames.slice(0, 10)) {
      lines.push(`                  "${u.rawName}" (votes 합계 ${u.votes.toLocaleString()})`);
    }
  }
  if (rep.r4Denominator.warnings.length === 0) {
    lines.push(`R4 분모:        PASS`);
  } else {
    lines.push(`R4 분모:        WARN — ${rep.r4Denominator.warnings.length}건`);
    for (const w of rep.r4Denominator.warnings.slice(0, 5)) {
      lines.push(`                  ${w.regionCode} ${w.issue}: ${w.detail}`);
    }
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test tests/unit/validate.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: 커밋**

```sh
git add scripts/ingest/validate.ts tests/unit/validate.test.ts
git commit -m "validate — R1~R4 검증 + 보고서 포맷"
```

---

## Task 9: diff.ts (DB 변경분 보고서)

**Files:**
- Create: `scripts/ingest/diff.ts`

- [ ] **Step 1: diff 구현**

`scripts/ingest/diff.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "../../src/lib/db-admin";
import { voteTotals, regionTotals, candidates } from "../../db/schema";

export interface DiffReport {
  voteTotals: { existing: number; incoming: number; changed: number };
  regionTotals: { existing: number; incoming: number; changed: number };
  candidates: { existing: number; incoming: number };
  samples: string[];
}

/**
 * 인제스천 직전, DB 의 기존 행과 곧 upsert 될 행을 비교해 변경 수와 샘플 5건을 보고.
 */
export async function diffElection(
  electionId: string,
  incomingVotes: { regionCode: string; partyId: string; votes: number }[],
  incomingRegs: { regionCode: string; totalVoters: number | null; totalVotes: number | null }[],
  incomingCandsCount: number,
): Promise<DiffReport> {
  const existVotes = await db.select().from(voteTotals).where(eq(voteTotals.electionId, electionId));
  const existRegs = await db.select().from(regionTotals).where(eq(regionTotals.electionId, electionId));
  const existCands = await db.select().from(candidates).where(eq(candidates.electionId, electionId));

  const existVotesMap = new Map(existVotes.map((v) => [`${v.regionCode}|${v.partyId}`, v.votes]));
  let voteChanged = 0;
  const samples: string[] = [];
  for (const v of incomingVotes) {
    const old = existVotesMap.get(`${v.regionCode}|${v.partyId}`);
    if (old !== v.votes) {
      voteChanged++;
      if (samples.length < 5) samples.push(`vote_totals ${v.regionCode}/${v.partyId}: ${old ?? "신규"} → ${v.votes}`);
    }
  }

  const existRegsMap = new Map(existRegs.map((r) => [r.regionCode, r]));
  let regChanged = 0;
  for (const r of incomingRegs) {
    const old = existRegsMap.get(r.regionCode);
    if (!old || old.totalVotes !== r.totalVotes || old.totalVoters !== r.totalVoters) {
      regChanged++;
      if (samples.length < 5) samples.push(`region_totals ${r.regionCode}: ${old?.totalVotes ?? "신규"} → ${r.totalVotes}`);
    }
  }

  return {
    voteTotals: { existing: existVotes.length, incoming: incomingVotes.length, changed: voteChanged },
    regionTotals: { existing: existRegs.length, incoming: incomingRegs.length, changed: regChanged },
    candidates: { existing: existCands.length, incoming: incomingCandsCount },
    samples,
  };
}

export function formatDiff(d: DiffReport): string {
  return [
    `diff:   vote_totals 변경 ${d.voteTotals.changed} / 신규? (기존 ${d.voteTotals.existing} → 신 ${d.voteTotals.incoming})`,
    `        region_totals 변경 ${d.regionTotals.changed} (기존 ${d.regionTotals.existing} → 신 ${d.regionTotals.incoming})`,
    `        candidates 기존 ${d.candidates.existing} → 신 ${d.candidates.incoming} (election 단위 replace)`,
    ...d.samples.map((s) => `        sample: ${s}`),
  ].join("\n");
}
```

- [ ] **Step 2: 빠른 컴파일 확인**

Run: `pnpm tsc --noEmit`
Expected: 타입 오류 없음

- [ ] **Step 3: 커밋**

```sh
git add scripts/ingest/diff.ts
git commit -m "diff — DB 기존 행과 변경분 비교 보고서"
```

---

## Task 10: CLI 진입점 (ingest-election.ts + ingest-pilot.ts)

**Files:**
- Create: `scripts/ingest/ingest-election.ts`
- Create: `scripts/ingest/ingest-pilot.ts`
- Modify: `package.json`

- [ ] **Step 1: ingest-election.ts (단일 선거)**

`scripts/ingest/ingest-election.ts`:

```ts
import { eq } from "drizzle-orm";
import { sql, db } from "../../src/lib/db-admin";
import { elections } from "../../db/schema";
import { fetchResults } from "./fetch-results";
import { fetchVoters } from "./fetch-voters";
import { processElection } from "./process";
import { validateElection, formatReport } from "./validate";
import { diffElection, formatDiff } from "./diff";

interface CliOpts {
  electionId: string;
  refresh: boolean;
  dryRun: boolean;
  diff: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  const electionId = argv.find((a) => !a.startsWith("--"));
  if (!electionId) {
    console.error("usage: tsx ingest-election.ts <electionId> [--refresh] [--dry-run] [--diff]");
    process.exit(2);
  }
  return {
    electionId,
    refresh: argv.includes("--refresh"),
    dryRun: argv.includes("--dry-run"),
    diff: argv.includes("--diff"),
  };
}

export async function runOneElection(opts: CliOpts): Promise<boolean> {
  const [election] = await db.select().from(elections).where(eq(elections.id, opts.electionId)).limit(1);
  if (!election) {
    console.error(`election not found: ${opts.electionId}`);
    return false;
  }
  if (!election.necElectionId || !election.necCode) {
    console.error(`necElectionId 또는 necCode 미설정: ${opts.electionId}`);
    return false;
  }

  const spec = { electionId: opts.electionId, sgId: election.necElectionId, sgTypecode: election.necCode };

  // 1) fetch
  const [votesRaw, votersRaw] = await Promise.all([
    fetchResults(spec, { force: opts.refresh }),
    fetchVoters(spec, { force: opts.refresh }),
  ]);

  // 2) diff (upsert 전, election 단위) — dry-run process 로 변환 결과 얻은 뒤 DB 와 비교
  if (opts.diff && !opts.dryRun) {
    const preview = await processElection(opts.electionId, election.date, votesRaw, votersRaw, { dryRun: true });
    const d = await diffElection(
      opts.electionId,
      preview.voteToUpsert.map((v) => ({ regionCode: v.regionCode, partyId: v.partyId, votes: v.votes })),
      preview.regToUpsert.map((r) => ({ regionCode: r.regionCode, totalVoters: r.totalVoters, totalVotes: r.totalVotes })),
      preview.candToInsert.length,
    );
    console.log(formatDiff(d));
  }

  // 3) process (upsert 또는 dry-run)
  const report = await processElection(opts.electionId, election.date, votesRaw, votersRaw, { dryRun: opts.dryRun });
  console.log(`upsert: vote_totals ${report.voteTotalsUpserted} / region_totals ${report.regionTotalsUpserted} / candidates ${report.candidatesInserted}${opts.dryRun ? " (dry-run)" : ""}`);

  // 4) validate (dry-run 시는 DB 가 비어있을 수 있으므로 R1/R2 결과가 의미 다름 — 그래도 실행)
  const val = await validateElection(opts.electionId, report.unresolvedRawNames);
  console.log(formatReport(val));

  return !val.fatal;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const ok = await runOneElection(opts);
  await sql.end();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: ingest-pilot.ts (Pilot 16 elections 일괄)**

`scripts/ingest/ingest-pilot.ts`:

```ts
import { sql } from "../../src/lib/db-admin";
import { runOneElection } from "./ingest-election";

const PILOT_IDS = [
  // 2022 지선
  "2022-local-governor", "2022-local-mayor",
  "2022-local-council", "2022-local-council-prop",
  "2022-local-council-basic", "2022-local-council-basic-prop",
  // 2024 총선
  "2024-general", "2024-general-prop",
  // 2025 대선
  "2025-presidential",
  // 2026 지선
  "2026-local-governor", "2026-local-mayor",
  "2026-local-council", "2026-local-council-prop",
  "2026-local-council-basic", "2026-local-council-basic-prop",
  "2026-local-superintendent",
];

async function main() {
  const flags = process.argv.slice(2);
  const refresh = flags.includes("--refresh");
  const dryRun = flags.includes("--dry-run");

  const failed: string[] = [];
  for (const id of PILOT_IDS) {
    console.log(`\n━━━ ${id} ━━━`);
    try {
      const ok = await runOneElection({ electionId: id, refresh, dryRun, diff: false });
      if (!ok) failed.push(id);
    } catch (err) {
      console.error(`  실패: ${(err as Error).message}`);
      failed.push(id);
    }
  }

  console.log(`\n=== Pilot 종료 ===`);
  console.log(`성공: ${PILOT_IDS.length - failed.length}/${PILOT_IDS.length}`);
  if (failed.length) console.log(`실패: ${failed.join(", ")}`);

  await sql.end();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: package.json 스크립트 추가**

`"ingest:seed:overrides"` 위에 추가 (또는 가까운 위치):

```json
"ingest:election": "dotenv -e .env.local -- tsx scripts/ingest/ingest-election.ts",
"ingest:pilot": "dotenv -e .env.local -- tsx scripts/ingest/ingest-pilot.ts",
"ingest:validate": "dotenv -e .env.local -- tsx scripts/ingest/ingest-pilot.ts --dry-run",
```

- [ ] **Step 4: 단일 선거 dry-run 점검**

이미 raw 캐시가 있는 2025-presidential 로 dry-run 시도:

Run: `pnpm ingest:election 2025-presidential --dry-run`
Expected: validate 보고서 출력. (DB 가 비어있으면 R1 위반 — 시·도 17개 누락. 그게 정상)

- [ ] **Step 5: 커밋**

```sh
git add scripts/ingest/ingest-election.ts scripts/ingest/ingest-pilot.ts package.json
git commit -m "CLI 진입점 — ingest:election / ingest:pilot + --refresh/--dry-run/--diff"
```

---

## Task 11: 통합 흐름 + 미진한 endpoint 확인

**Files:**
- Possibly modify: `scripts/ingest/fetch-results.ts`, `scripts/ingest/fetch-voters.ts`, `scripts/ingest/process.ts`

이 Task 는 한 선거를 끝까지(fetch → upsert → validate) 실 환경에서 굴려보고, raw 응답 구조에 맞춰 zod schema·process 헬퍼·region 매칭 등을 보정한다. spec 의 검증 셋(R1~R4)에 가까이 가는 과정.

- [ ] **Step 1: 2025-presidential 끝까지 굴리기 (실 upsert)**

Run: `pnpm ingest:election 2025-presidential`
Expected: 보고서 R1 PASS, R2 PASS, R3·R4 경고 또는 PASS.

자주 발생할 문제:
1. **region 매칭 실패** — sdName "강원특별자치도" vs DB "강원도" 같은 불일치 → `data/seed/regions.json` 보강 또는 `process.ts` 의 `regionCodeOf` 에 별칭 매핑 추가
2. **jdName 미매칭** — R3 경고로 출력. `data/seed/parties.json` 의 aliases 보강 후 `pnpm ingest:seed:parties` 재시드
3. **sgType 차이** — 2025 대선은 sgTypecode=1. 다른 유형은 응답 구조 미세 차이 가능 — schema 보완

- [ ] **Step 2: 2024-general 굴리기**

Run: `pnpm ingest:election 2024-general --refresh`
보고서 확인. 문제 발견 시 위 패턴으로 수정·재실행.

- [ ] **Step 3: 2022-local-governor 굴리기**

Run: `pnpm ingest:election 2022-local-governor --refresh`
보고서 확인.

- [ ] **Step 4: 2026-local-governor 굴리기 (부분 데이터 가능성)**

Run: `pnpm ingest:election 2026-local-governor --refresh`
Expected: R4 경고 가능 (progress_pct < 100). R1/R2 PASS 면 OK.

- [ ] **Step 5: 발견된 보정 사항 커밋**

```sh
git add scripts/ingest/process.ts scripts/ingest/lib/types.ts data/seed/  # 보정한 파일만
git commit -m "process/types/seed 보정 — 실 응답 검증 후 region 매칭·alias 보강"
```

---

## Task 12: Pilot 16 elections 일괄 실행 + 완료 기준 검증

**Files:**
- (없음 — 운영 단계)

- [ ] **Step 1: 전체 검증 (dry-run)**

Run: `pnpm ingest:validate`
Expected: 16 elections 모두 R1/R2 PASS, R3·R4 경고는 보고서로만.

- [ ] **Step 2: 실 일괄 인제스천**

Run: `pnpm ingest:pilot`
Expected:
- 16 elections 진행, 마지막에 `성공: 16/16` 또는 `성공: 15/16, 실패: 2026-local-superintendent` 같은 부분 성공 (2026 일부 유형은 데이터 미공개일 수 있음)
- 실패 발생 시 사유 분석 후 보정 → 재실행

- [ ] **Step 3: DB 행 수 확인**

Run:
```sh
pnpm dotenv -e .env.local -- tsx -e "
import { sql } from './src/lib/db-admin';
const [vt] = await sql\`SELECT COUNT(*) FROM vote_totals\`;
const [rt] = await sql\`SELECT COUNT(*) FROM region_totals\`;
const [c] = await sql\`SELECT COUNT(*) FROM candidates\`;
const [cMatched] = await sql\`SELECT COUNT(*) FROM candidates WHERE party_id IS NOT NULL\`;
console.log('vote_totals:', vt.count);
console.log('region_totals:', rt.count);
console.log('candidates:', c.count, 'matched:', cMatched.count);
console.log('candidates partyId 매핑률:', (Number(cMatched.count) / Math.max(Number(c.count), 1) * 100).toFixed(1) + '%');
await sql.end();
"
```
Expected:
- vote_totals ≥ 4,300 (Pilot 16 elections × 평균 270 region × 평균 2 party — 변동 큼, 검증은 R1)
- region_totals 동일 수준
- candidates ≥ 100 (지역구 × 후보자 평균 — 변동)
- candidates partyId 매핑률 ≥ 95%

- [ ] **Step 4: 빌드·테스트 회귀 확인**

Run: `pnpm test`
Expected: 모든 unit/integration 테스트 PASS

Run: `pnpm build`
Expected: `next build` 성공

- [ ] **Step 5: 라이브 회귀 확인 (배포는 없음 — 스키마 추가만)**

자동 배포가 켜져 있다면 main push 후 Vercel 빌드 PASS 확인:

Run: `curl -s https://jp-ourstory.vercel.app/ | grep -oE "시드된 정당 수[^<]*<strong>[0-9]+</strong>"`
Expected: `시드된 정당 수: <strong>18</strong>` — UI 변경 없음

- [ ] **Step 6: Phase 1.1 Done 보고**

체크리스트 (spec § 9):
- [ ] vote_totals 4,300+ 행 (실측치 확인)
- [ ] region_totals 동일 (election × region) 셋
- [ ] candidates partyId 매핑률 ≥ 95%
- [ ] `pnpm ingest:validate` 4종 검증 PASS (R3·R4 경고만)
- [ ] `pnpm test` 전체 PASS
- [ ] election_party_overrides 시드 완료
- [ ] 라이브 UI 변경 없음, 빌드 PASS

전부 충족 시 다음 plan(Phase 1.2 홈 차트) 작성으로 넘어감.

- [ ] **Step 7: 마무리 커밋 + 메모리 갱신**

raw 캐시는 gitignore. 변경 사항이 있으면(보정 커밋 외) — 보통 이 단계엔 변경 없음.

```sh
git status  # 변경 없으면 skip
```

---

## 완료 기준 (Phase 1.1 Done)

- [x] (Task 1) election_party_overrides 테이블 + 마이그레이션 + RLS
- [x] (Task 2) election-party-overrides 시드 (권영국 1건)
- [x] (Task 3) data.go.kr api-client + zod schema + 단위 테스트
- [x] (Task 4) party-resolver (override → alias → null) + 단위 테스트
- [x] (Task 5) fetch-results — VoteXmntckInfoInqireService2 raw 캐시
- [x] (Task 6) fetch-voters — ElcntInfoInqireService raw 캐시
- [x] (Task 7) process — raw → vote_totals/region_totals/candidates + 단위 테스트
- [x] (Task 8) validate R1~R4 + 보고서 + 단위 테스트
- [x] (Task 9) diff — DB 변경분 비교 보고서
- [x] (Task 10) CLI — ingest:election / ingest:pilot / --refresh/--dry-run/--diff
- [x] (Task 11) 핵심 4 선거 끝까지 굴리기 + 보정
- [x] (Task 12) Pilot 16 elections 일괄 + 매핑률 ≥ 95% + 라이브 회귀 없음

이 시점에 다음 plan(`2026-06-04-ourstory-phase-1.2-home-chart.md`) 을 작성한다.
