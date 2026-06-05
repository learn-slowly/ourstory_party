# ourstory Phase 5.0 — 투표소 스키마 추가 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ourstory Supabase Postgres에 투표소(투표구) 단위 결과를 담을 3개 테이블(`polling_stations`, `polling_station_votes`, `polling_station_totals`)을 추가하고, RLS 정책·verify-schema 검증을 갱신한다.

**Architecture:** Drizzle ORM 으로 `db/schema.ts` 에 3개 테이블 정의 추가 → `drizzle-kit generate` 로 SQL 마이그레이션 생성 → `drizzle-kit migrate` 로 Supabase 에 적용 → 기존 `apply-rls.ts` 패턴에 따라 3개 테이블에 "public read" RLS 정책 추가 → `verify-schema.ts` expected 목록 확장(8→10).

**Tech Stack:** Drizzle ORM 0.45 / drizzle-kit / postgres.js / Supabase Postgres / pnpm / vitest

선행 스펙: `docs/superpowers/specs/2026-06-05-ourstory-phase-5-polling-stations-design.md` (§ 스키마, § CI/운영)

---

## 파일 구조

각 파일 1개 책임. 본 phase 변경 범위.

| 파일 | 동작 | 책임 |
|------|------|------|
| `db/schema.ts` | Modify (append 3 tables) | Drizzle 스키마 정의 — `pollingStations`, `pollingStationVotes`, `pollingStationTotals` |
| `db/migrations/0002_*.sql` | Create (auto-generated) | 3 테이블 + FK + UNIQUE + index DDL |
| `db/migrations/meta/_journal.json` | Modified by drizzle-kit | 마이그레이션 메타 |
| `scripts/apply-rls.ts` | Modify (`TABLES` 상수 확장) | RLS 활성화 + "public read" 정책 적용 대상에 3 테이블 추가 |
| `scripts/verify-schema.ts` | Modify (`expected` 상수 + 메시지) | 8→10 테이블 검증, 콘솔 메시지 갱신 |

새 unit test 파일은 추가하지 않는다. 본 phase 의 검증은 `pnpm verify:schema` (DB 쿼리 통합 검증) + `pnpm db:rls` 실행 후 출력된 정책 카운트로 충분. drizzle 스키마는 TypeScript 컴파일러가 정합성을 잡아준다.

---

## Task 1: verify-schema 를 먼저 실패시켜 baseline 잡기 (TDD)

스키마 작성 전, 검증 스크립트가 "3 테이블 없음" 을 정확히 잡는지 먼저 확인. 검증 스크립트 자체를 "테스트" 로 사용.

**Files:**
- Modify: `scripts/verify-schema.ts`

- [ ] **Step 1: `expected` 배열에 3개 테이블 추가 + 카운트 메시지 8→10 갱신**

`scripts/verify-schema.ts` 를 다음과 같이 수정.

```ts
import postgres from "postgres";

const expected = [
  "candidates", "election_party_overrides", "elections", "parties",
  "party_aliases", "polling_station_totals", "polling_station_votes",
  "polling_stations", "region_totals", "regions", "vote_totals",
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);

  try {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${expected})
      ORDER BY table_name;
    `;

    const found = rows.map((r) => r.table_name);
    const missing = expected.filter((t) => !found.includes(t));

    if (missing.length > 0) {
      console.error("누락 테이블:", missing);
      process.exit(1);
    }

    console.log(`✓ ${expected.length}개 테이블 모두 존재: ${found.join(", ")}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: verify-schema 실행 → FAIL 확인 (baseline)**

```bash
cd ~/coding/ourstory && pnpm verify:schema
```

Expected stderr: `누락 테이블: [ 'polling_station_totals', 'polling_station_votes', 'polling_stations' ]`
Expected exit code: 1

**Why:** 이 단계는 commit 안 함. 검증 스크립트가 신규 테이블을 인지하는지 확인하는 baseline. 다음 Task 들에서 스키마 추가 → 마이그레이션 → 적용 후 다시 실행 시 PASS 가 떠야 정상.

---

## Task 2: db/schema.ts 에 3개 테이블 정의 추가

**Files:**
- Modify: `db/schema.ts`

- [ ] **Step 1: import 확장 — `bigint`, `uniqueIndex` 추가**

기존 import 줄을 다음으로 교체.

```ts
import {
  pgTable, text, integer, date, boolean, numeric, timestamp, bigserial,
  bigint, primaryKey, index, uniqueIndex,
} from "drizzle-orm/pg-core";
```

- [ ] **Step 2: 파일 끝(`electionPartyOverrides` 다음)에 3개 테이블 정의 추가**

```ts
// 투표소(NEC 용어 "투표구") — 한 election 안에서 sigungu 별로 유일한 name
export const pollingStations = pgTable(
  "polling_stations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    electionId: text("election_id").notNull().references(() => elections.id),
    sigunguCode: text("sigungu_code").notNull().references(() => regions.code),
    emdCode: text("emd_code").references(() => regions.code),
    name: text("name").notNull(),
    kind: text("kind", {
      enum: ["station", "presub", "abs", "absentee", "overseas", "misc"],
    }).notNull(),
    necTownCode: text("nec_town_code"),
  },
  (t) => ({
    uq: uniqueIndex("ps_uq").on(t.electionId, t.sigunguCode, t.name),
    emdIdx: index("ps_emd_idx").on(t.electionId, t.emdCode),
  }),
);

// 투표소 단위 정당 득표
export const pollingStationVotes = pgTable(
  "polling_station_votes",
  {
    stationId: bigint("station_id", { mode: "number" })
      .notNull()
      .references(() => pollingStations.id, { onDelete: "cascade" }),
    partyId: text("party_id").references(() => parties.id),
    rawName: text("raw_name").notNull(),
    votes: integer("votes").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.stationId, t.rawName] }),
    partyIdx: index("psv_party_idx").on(t.partyId),
  }),
);

// 투표소 단위 분모
export const pollingStationTotals = pgTable(
  "polling_station_totals",
  {
    stationId: bigint("station_id", { mode: "number" })
      .primaryKey()
      .references(() => pollingStations.id, { onDelete: "cascade" }),
    totalVoters: integer("total_voters"),
    totalVotes: integer("total_votes"),
    validVotes: integer("valid_votes"),
    invalidVotes: integer("invalid_votes"),
  },
);
```

- [ ] **Step 3: TypeScript 컴파일 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -E "schema\.ts" | head -5
```

Expected: 출력 없음 (스키마 파일에 타입 에러 없음). `tests/unit/process.test.ts` 의 기존 무관한 에러는 무시.

---

## Task 3: Drizzle 마이그레이션 생성

**Files:**
- Create: `db/migrations/0002_*.sql` (drizzle-kit 자동 명명)
- Modified by tool: `db/migrations/meta/_journal.json`, `db/migrations/meta/0002_snapshot.json`

- [ ] **Step 1: 마이그레이션 생성**

```bash
cd ~/coding/ourstory && pnpm db:generate
```

Expected stdout: `0002_<adjective>_<noun>.sql ✔` (drizzle-kit 의 무작위 접미사 명명).

- [ ] **Step 2: 생성된 SQL 확인**

```bash
ls ~/coding/ourstory/db/migrations/ | grep ^0002
cat ~/coding/ourstory/db/migrations/0002_*.sql
```

Expected: 다음 요소가 SQL 에 포함되어 있어야 함 — 셋 다 없으면 schema 정의가 잘못된 것이니 Task 2 로 돌아가서 수정.

- `CREATE TABLE "polling_stations"` + bigserial PK + `kind` CHECK 제약 (drizzle enum → CHECK)
- `CREATE TABLE "polling_station_votes"` + composite PK `(station_id, raw_name)`
- `CREATE TABLE "polling_station_totals"` + station_id PK
- 4개 FK (`election_id`, `sigungu_code`, `emd_code`, `party_id`) + 2개 cascade FK (`station_id` × 2)
- `CREATE UNIQUE INDEX "ps_uq"` / `CREATE INDEX "ps_emd_idx"` / `CREATE INDEX "psv_party_idx"`

---

## Task 4: 마이그레이션 적용

**Files:**
- 없음 (DB 변경만)

- [ ] **Step 1: Supabase 에 마이그레이션 적용**

```bash
cd ~/coding/ourstory && pnpm db:migrate
```

Expected stdout: `migration 0002_*.sql applied` 류 (drizzle-kit 메시지).

- [ ] **Step 2: 적용 확인 — verify-schema 재실행**

```bash
cd ~/coding/ourstory && pnpm verify:schema
```

Expected stdout: `✓ 11개 테이블 모두 존재: candidates, election_party_overrides, elections, parties, party_aliases, polling_station_totals, polling_station_votes, polling_stations, region_totals, regions, vote_totals`
Expected exit code: 0

**참고:** 11개인 이유 — Task 1 의 expected 배열에 기존 8개 + 신규 3개 = 11개를 모두 적었기 때문. 본 phase 의 "8→10" 표현은 부정확했고 실제는 8→11. (spec 의 "10개 테이블 확인" 문구도 11로 수정해야 함. Task 7 참조)

---

## Task 5: RLS 정책 적용

**Files:**
- Modify: `scripts/apply-rls.ts`

- [ ] **Step 1: `TABLES` 상수에 3개 테이블 추가**

`scripts/apply-rls.ts` 상단의 TABLES 정의를 다음으로 교체.

```ts
const TABLES = [
  "regions", "parties", "party_aliases", "elections",
  "election_party_overrides", "vote_totals", "region_totals", "candidates",
  "polling_stations", "polling_station_votes", "polling_station_totals",
];
```

- [ ] **Step 2: RLS 스크립트 실행**

```bash
cd ~/coding/ourstory && pnpm db:rls
```

Expected stdout (마지막 줄들):

```
✓ polling_stations: RLS + public read
✓ polling_station_votes: RLS + public read
✓ polling_station_totals: RLS + public read

✓ GRANT SELECT → anon, authenticated

적용된 정책 11 건:
  candidates: public read
  ...
  polling_station_totals: public read
  polling_station_votes: public read
  polling_stations: public read
  ...
```

- [ ] **Step 3: 정책 카운트 확인**

scripts 출력의 "적용된 정책 N 건" 의 N 이 **11** 인지 확인. 다른 숫자면 누락 또는 중복.

---

## Task 6: spec 의 "10개" 문구를 11개로 정정

스펙 작성 시 "10개 테이블 확인" 으로 적었으나 실제 기존 8 + 신규 3 = 11. 정합성 맞춤.

**Files:**
- Modify: `docs/superpowers/specs/2026-06-05-ourstory-phase-5-polling-stations-design.md`

- [ ] **Step 1: 문구 교체**

spec 의 Phase 5.0 줄을 다음으로 교체.

before:
```
| **5.0 스키마** | drizzle 마이그레이션 + RLS 정책 + verify-schema 통과 | — | `pnpm tsx scripts/verify-schema.ts` 가 10개 테이블 확인 |
```

after:
```
| **5.0 스키마** | drizzle 마이그레이션 + RLS 정책 + verify-schema 통과 | — | `pnpm verify:schema` 가 11개 테이블 확인 (기존 8 + 신규 3) |
```

---

## Task 7: 커밋

**Files:**
- 스테이지: 위 Task 1·2·3·5·6 에서 변경된 파일

- [ ] **Step 1: 변경사항 확인**

```bash
git -C ~/coding/ourstory status
git -C ~/coding/ourstory diff --stat
```

Expected 변경 목록:
- `db/schema.ts` (Task 2)
- `db/migrations/0002_*.sql` (Task 3, 새 파일)
- `db/migrations/meta/_journal.json` (Task 3, 수정)
- `db/migrations/meta/0002_snapshot.json` (Task 3, 새 파일)
- `scripts/apply-rls.ts` (Task 5)
- `scripts/verify-schema.ts` (Task 1)
- `docs/superpowers/specs/2026-06-05-ourstory-phase-5-polling-stations-design.md` (Task 6)

- [ ] **Step 2: 커밋**

```bash
git -C ~/coding/ourstory add db/schema.ts db/migrations/ scripts/apply-rls.ts scripts/verify-schema.ts docs/superpowers/specs/2026-06-05-ourstory-phase-5-polling-stations-design.md
git -C ~/coding/ourstory commit -m "$(cat <<'EOF'
ourstory Phase 5.0 — 투표소 스키마 3개 테이블 추가

polling_stations / polling_station_votes / polling_station_totals.
자연키 (election_id, sigungu_code, name), kind 컬럼으로 투표구·사전·재외 구분.
RLS public read + verify-schema 8→11 갱신.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: 푸시 (사용자 명시 시에만)**

```bash
git -C ~/coding/ourstory push origin main
```

푸시 여부는 사용자 확정 후 실행. 본 Phase 5.0 단위로 PR 만들 수도 있고, 5.1~5.4 까지 묶어 한 번에 푸시할 수도 있음 — 결정은 사용자.

---

## 검증 체크리스트 (Phase 5.0 완료 조건)

- [ ] `pnpm verify:schema` → `✓ 11개 테이블 모두 존재` 통과
- [ ] `pnpm db:rls` → "적용된 정책 11 건" 출력
- [ ] `git log -1` 메시지가 위 형식대로 커밋됨
- [ ] spec 내 "10개" 문구가 "11개" 로 수정됨

네 항목 전부 통과 시 Phase 5.0 완료. 다음 Phase 5.1 (파서) 플랜 작성으로 넘어감.
