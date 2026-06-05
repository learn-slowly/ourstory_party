# ourstory Phase 5.3-rev — emd 분해 적재 (리프레임) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 5.3 실행 중 발견된 사실 — NEC 역대 archive(VCCP04)는 emd-level 분해 (선거일·관내사전 + 시·군·구 메타)가 최저 단위, 개별 투표소 데이터 미제공 — 에 따라 본래 "투표소 적재"를 "emd voting breakdown 적재"로 리프레임. 자연키에 emd_code 추가, `kind` enum 정리(`"station"` 보존 + `"el_day"` 추가), 파서·ingest·검증 게이트 일관 수정.

**Architecture:** drizzle 마이그레이션 1건(UNIQUE 재정의) + 파서 1군데 수정(`"선거일투표"` → `kind="el_day"`) + ingest 스크립트의 게이트 SQL 갱신. 기존 DB 의 부분 적재 데이터(20 sigungu 만 들어간 2024-general-prop) 는 TRUNCATE 후 재적재.

**Tech Stack:** drizzle-kit / postgres.js / vitest

선행 spec(갱신본): `docs/superpowers/specs/2026-06-05-ourstory-phase-5-polling-stations-design.md` (§ 스키마 § 키 정책 § 검증 게이트)
선행 plan: `docs/superpowers/plans/2026-06-05-ourstory-phase-5.3-polling-stations-ingest.md` (실행 중 부분 적재 + 의미 결함 발견)

---

## 파일 구조

| 파일 | 동작 | 책임 |
|------|------|------|
| `db/schema.ts` | Modify | `pollingStations.kind` enum 확장 (`"el_day"` 추가) + UNIQUE 인덱스 컬럼에 `emdCode` 포함 |
| `db/migrations/0003_*.sql` | Create (auto via drizzle-kit) | UNIQUE 재정의 DDL |
| `scripts/ingest/lib/nec-html.ts` | Modify | `parseVccp08Stations` 의 row 분류 — `"선거일투표"` 라벨 → `kind="el_day"` (현재 `"station"`). 신규 META_LABELS 매핑 1건 추가 |
| `tests/unit/polling-stations-parser.test.ts` | Modify | 기존 `kind` 단언 4건 갱신 (`"station"` → `"el_day"`) |
| `scripts/ingest/ingest-polling-stations.ts` | Modify | 검증 게이트 SQL — station 수 → emd 수, cross-check 단위 sigungu 합 (모든 kind 포함) |
| `scripts/ingest/parse-polling-stations.ts` | Modify | 통계 출력의 `stationCount` → `emdBreakdownCount` 의미 변경 |
| `docs/superpowers/specs/...-design.md` | 이미 갱신 완료 | (Phase 5.3-rev 실행 전 spec 먼저 갱신했음, 본 plan 의 Task 아님) |

---

## Task 1: 스키마 마이그레이션 — UNIQUE 재정의 + kind enum 확장

**Files:**
- Modify: `db/schema.ts`
- Create: `db/migrations/0003_*.sql` (auto)

- [ ] **Step 1: schema.ts 수정**

`db/schema.ts` 의 `pollingStations` 블록을 다음으로 교체.

```ts
export const pollingStations = pgTable(
  "polling_stations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    electionId: text("election_id").notNull().references(() => elections.id),
    sigunguCode: text("sigungu_code").notNull().references(() => regions.code),
    emdCode: text("emd_code").references(() => regions.code),
    name: text("name").notNull(),
    kind: text("kind", {
      // emd-level (역대 archive 의 최저 단위):
      //   "el_day"   — emd 단위 선거일 본투표 합 ("선거일투표")
      //   "presub"   — emd 단위 관내사전투표 합
      // 시·군·구 단위 메타 (특정 emd 귀속 불가):
      //   "abs"      — 관외사전투표
      //   "absentee" — 거소·선상투표
      //   "overseas" — 재외투표
      //   "misc"     — 잘못 투입·구분된 투표지 등
      // 라이브 선거 전용 (NEC live 모듈 VCCP08 운영 기간에만):
      //   "station"  — 개별 투표소 ("제1투표소" 류). 역대 archive 에는 미존재
      enum: ["el_day", "presub", "abs", "absentee", "overseas", "misc", "station"],
    }).notNull(),
    necTownCode: text("nec_town_code"),
  },
  (t) => ({
    uq: uniqueIndex("ps_uq").on(t.electionId, t.sigunguCode, t.emdCode, t.name),
    emdIdx: index("ps_emd_idx").on(t.electionId, t.emdCode),
  }),
);
```

- [ ] **Step 2: 기존 데이터 정리 (UNIQUE 재정의 전 필수)**

```bash
cat > /tmp/truncate_ps.sql <<'SQL'
TRUNCATE polling_station_votes, polling_station_totals, polling_stations RESTART IDENTITY CASCADE;
SQL
cd ~/coding/ourstory && pnpm exec dotenv -e .env.local -- psql "$DATABASE_URL" -f /tmp/truncate_ps.sql 2>&1 | head -5
```

psql 미설치 환경이면 다음 ad-hoc 사용:

```bash
cat > /tmp/truncate_ps.ts <<'TS'
import { sql } from "/Users/ahbaik/coding/ourstory/src/lib/db-admin";
async function main() {
  await sql`TRUNCATE polling_station_votes, polling_station_totals, polling_stations RESTART IDENTITY CASCADE`;
  console.log("✓ truncated");
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
TS
cd ~/coding/ourstory && pnpm exec dotenv -e .env.local -- tsx /tmp/truncate_ps.ts 2>&1 | tail -3
```

Expected: `✓ truncated`.

- [ ] **Step 3: 마이그레이션 생성**

```bash
cd ~/coding/ourstory && pnpm db:generate
```

Expected: `0003_<adjective>_<noun>.sql` 생성. 생성 SQL 안에 `DROP INDEX IF EXISTS "ps_uq"` + `CREATE UNIQUE INDEX "ps_uq" ON "polling_stations" ("election_id","sigungu_code","emd_code","name")` 류 포함.

- [ ] **Step 4: 생성 SQL 확인**

```bash
cat ~/coding/ourstory/db/migrations/0003_*.sql
```

UNIQUE 재정의가 있어야 함. kind enum 은 (TS-only 라) DB DDL 변경 없음.

- [ ] **Step 5: 마이그레이션 적용**

```bash
cd ~/coding/ourstory && pnpm db:migrate
cd ~/coding/ourstory && pnpm verify:schema
```

Expected: `✓ 11개 테이블 모두 존재`. 마이그레이션 적용 메시지.

---

## Task 2: 파서 수정 — "선거일투표" → kind="el_day"

**Files:**
- Modify: `scripts/ingest/lib/nec-html.ts`

- [ ] **Step 1: META_LABELS 에 "선거일투표" 매핑 추가**

`META_LABELS` Map 정의 안에 다음 항목 추가 (`["재외국민투표", "overseas"]` 다음 줄 권장).

```ts
  // emd 단위 선거일 본투표 — VCCP04 archive 가 (관내사전 + 선거일) 분리해서 제공
  ["선거일투표", "el_day"],
```

- [ ] **Step 2: `parseVccp08Stations` 분류 로직 확인**

기존 로직:
```ts
} else if (perEmdMeta) {
  kind = perEmdMeta;
  emdName = currentEmd;
  displayName = c1;
} else if (c1) {
  kind = "station";
  ...
}
```

`"선거일투표"` 가 `META_LABELS` 에 추가되면 `perEmdMeta` 분기에서 `kind = "el_day"` 자동 분류. **별도 수정 불필요.** Step 1 만으로 충분.

- [ ] **Step 3: `parseVccp08Stations` 타입 enum 갱신**

`ParsedStationRow.kind` 의 enum 에 `"el_day"` 추가.

```ts
export interface ParsedStationRow {
  emdName: string | null;
  name: string;
  kind: "el_day" | "station" | "presub" | "abs" | "absentee" | "overseas" | "misc";
  totalVoters: number;
  totalVotes: number;
  validVotes: number;
  invalidVotes: number;
  parties: ParsedParty[];
}
```

(같은 enum 이 `ParsedDistrictRow.kind` 에도 사용되므로 자동 확장됨 — `ParsedStationRow["kind"]` 참조.)

- [ ] **Step 4: 컴파일 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -vE "tests/unit/process\.test\.ts" | head -10
```

Expected: 추가 에러 없음.

---

## Task 3: 단위 테스트 갱신

**Files:**
- Modify: `tests/unit/polling-stations-parser.test.ts`

- [ ] **Step 1: `"station"` 단언을 `"el_day"` 로 교체**

기존 fixture (2025·2024·2022·2020) 의 4 describe 안에서 "station" kind 를 단언하는 테스트들이 있음. 이들은 모두 "선거일투표" 행을 본 것이라 `"el_day"` 로 갱신 필요.

vitest 가 어떤 단언이 깨지는지 알려주므로, 먼저 실행해서 실패 목록 확인.

```bash
cd ~/coding/ourstory && pnpm test polling-stations-parser 2>&1 | tail -30
```

각 실패 케이스마다:
- `r.rows.filter((x) => x.kind === "station")` → `r.rows.filter((x) => x.kind === "el_day")`
- 기대값 `name === "문산읍제1투"` 류 (실제 investigation 결과 VCCP04 데이터는 이런 행 없음) 가 있다면 `name === "선거일투표"` 로 교체

**중요**: Phase 5.1 의 2025 진주 대선 테스트 T2 가 `"문산읍제1투"` station 을 단언함. 2025 진주 fixture 가 VCCP08(라이브) 인지 VCCP04(역대) 인지에 따라 다름 — 만약 VCCP08 라면 실제 station 행이 있고 그대로 PASS, VCCP04 면 emd 분해라 단언 수정 필요. 실패 시 fixture 내용 grep 으로 확인.

- [ ] **Step 2: 테스트 PASS 확인**

```bash
cd ~/coding/ourstory && pnpm test 2>&1 | tail -10
```

Expected: 전체 PASS. 신규 enum 값 `"el_day"` 가 매핑 검증과 함께 동작.

---

## Task 4: ingest 검증 게이트 갱신

**Files:**
- Modify: `scripts/ingest/ingest-polling-stations.ts`

- [ ] **Step 1: 게이트 1 (station 수 → emd 수)**

기존 코드 (station 수 sanity):
```ts
const stationCountRows = await sql<{ n: number }[]>`
  SELECT count(*)::int AS n
  FROM polling_stations
  WHERE election_id = ${electionId} AND kind = 'station'
`;
const stationCount = stationCountRows[0]?.n ?? 0;
const inRange = stationCount >= 12600 && stationCount <= 15400; // 14k ±10%
console.log(`  [${inRange ? "PASS" : "WARN"}] station 수: ${stationCount} (목표 14,000 ±10%)`);
```

다음으로 교체:
```ts
// emd 분해 sanity — 전국 emd 약 3,500 ±10%
const emdCountRows = await sql<{ n: number }[]>`
  SELECT count(DISTINCT emd_code)::int AS n
  FROM polling_stations
  WHERE election_id = ${electionId} AND kind = 'el_day'
`;
const emdCount = emdCountRows[0]?.n ?? 0;
const inRange = emdCount >= 3150 && emdCount <= 3850; // 3,500 ±10%
console.log(`  [${inRange ? "PASS" : "WARN"}] emd 분해 수: ${emdCount} (목표 3,500 ±10%, el_day 행 기준)`);
```

- [ ] **Step 2: 게이트 3 (cross-check) 단위 명확화**

기존 cross-check 는 sigungu 단위. 그대로 두되 주석으로 의미 명확화:

```ts
  // 3) cross-check vs vote_totals (sigungu 단위 합) — el_day + presub + 외부 메타 전부 포함
```

추가 변경 없음 — 기존 SQL 이 (sigungu × party) 단위 polling_station_votes 합을 사용하므로 모든 kind 포함됨.

- [ ] **Step 3: 컴파일 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -E "ingest-polling-stations" | head -3
```

Expected: 출력 없음.

---

## Task 5: parse-polling-stations.ts 통계 출력 정정

**Files:**
- Modify: `scripts/ingest/parse-polling-stations.ts`

- [ ] **Step 1: `stationCount` 의미 변경**

기존:
```ts
bundle.stationCount += r.rows.filter((x) => x.kind === "station").length;
```

다음으로 교체:
```ts
// el_day(emd 선거일) 행 수 — 적재된 emd 수 추정 지표
bundle.emdBreakdownCount += r.rows.filter((x) => x.kind === "el_day").length;
```

`ElectionBundle` interface 의 `stationCount: number` 도 `emdBreakdownCount: number` 로 rename.

콘솔 출력의 `stations=${bundle.stationCount}` → `emd=${bundle.emdBreakdownCount}`.

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -E "parse-polling-stations" | head -3
```

Expected: 출력 없음.

---

## Task 6: 2024-general-prop 재적재 + 게이트 검증

**Files:**
- 없음 (실제 DB 변경)

- [ ] **Step 1: parse 재실행 (캐시된 raw 그대로 재파싱)**

```bash
cd ~/coding/ourstory && pnpm ingest:parse-polling-stations 2024-general-prop 2>&1 | tail -3
```

Expected: `✓ data/processed/polling-stations/2024-general-prop.json`. `emd=3000±` 류 출력 (전국 emd 수 근처).

- [ ] **Step 2: ingest 실행**

```bash
cd ~/coding/ourstory && pnpm ingest:polling-stations 2024-general-prop 2>&1 | tail -20
```

Expected 출력:
```
▶ 2024-general-prop files=217
... 진행 ...
✓ 적재 완료
  stations: ~17000 (el_day ~3000 + presub ~3000 + 시·군·구 메타 ~1000 = 약 20k 행)
  votes:    ~600,000
  totals:   ~17,000

매핑률
  vote rows: ~570000/~600000 (95%+)
  region miss: 0 rows

── 검증 게이트 ──
  [PASS] emd 분해 수: 3000± (목표 3,500 ±10%)
  [PASS] 매핑률: 95%+
  [PASS] cross-check: ~5000 pass / 0 fail (±0.5% 기준)
```

- [ ] **Step 3: 게이트 통과 여부에 따라**

3 게이트 모두 PASS → Task 7 진행.
- emd 분해 수 < 3,150 → 일부 시·도 fetch 누락 또는 emd 시드 부족. 진단: `select count(*) from regions where level='emd'` 결과와 비교
- 매핑률 < 95% → top 5 매핑 실패 정당명 보강 후 재실행
- cross-check fail → 특정 (sigungu, party) 샘플 직조회로 diff 원인 파악

---

## Task 7: 커밋

**Files:**
- 스테이지: 위 Task 1·2·3·4·5 의 변경

- [ ] **Step 1: 변경 확인**

```bash
git -C ~/coding/ourstory status
git -C ~/coding/ourstory diff --stat
```

Expected:
- `db/schema.ts`
- `db/migrations/0003_*.sql` (신규)
- `db/migrations/meta/_journal.json`, `0003_snapshot.json`
- `scripts/ingest/lib/nec-html.ts`
- `scripts/ingest/ingest-polling-stations.ts`
- `scripts/ingest/parse-polling-stations.ts`
- `tests/unit/polling-stations-parser.test.ts`
- `docs/superpowers/specs/...-design.md` (이미 갱신됨, 같이 커밋)

- [ ] **Step 2: 커밋**

```bash
git -C ~/coding/ourstory add db/ scripts/ingest/lib/nec-html.ts scripts/ingest/ingest-polling-stations.ts scripts/ingest/parse-polling-stations.ts tests/unit/polling-stations-parser.test.ts docs/superpowers/specs/2026-06-05-ourstory-phase-5-polling-stations-design.md
git -C ~/coding/ourstory commit -m "$(cat <<'EOF'
ourstory Phase 5.3-rev — emd 분해 적재 (NEC 역대 데이터 실제 단위 반영)

발견: NEC 역대 archive (VCCP04) 는 emd-level 분해 (관내사전 + 선거일 +
시·군·구 메타) 만 제공. 개별 투표소 데이터 미존재. 라이브 모듈
(VCCP08) 만 투표구별 row 제공하고, 역대로 이관 시 사라짐.

리프레임:
- kind enum 에 "el_day" 추가 ("선거일투표" 행). "station" 은 미래
  라이브 선거 (NEC 공개 시점) 용으로 보존.
- 자연키 UNIQUE 에 emd_code 추가 — 같은 sigungu 안 모든 emd 가 같은
  name ("선거일투표" / "관내사전투표") 으로 등장하기 때문.
- 검증 게이트: "station 수 ≈ 14k" → "emd 분해 수 ≈ 3,500 ±10%".
- spec § 키 정책·§ 검증 게이트 갱신.

2024-general-prop 재적재로 emd 분해 ~3,500 통과 확인.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 검증 체크리스트 (Phase 5.3-rev 완료 조건)

- [ ] `pnpm verify:schema` → 11개 테이블, 새 UNIQUE 적용
- [ ] `pnpm test` → 전체 PASS (기존 + 갱신된 kind 단언)
- [ ] `pnpm ingest:polling-stations 2024-general-prop` → 게이트 3종 PASS
- [ ] DB 의 `polling_stations` 행이 ~17,000 (3,500 emd × 평균 ~5 kind) 근처
- [ ] 커밋 메시지가 위 형식대로

다섯 항목 통과 시 Phase 5.3-rev 완료. Phase 5.4 (전체 12 electionId 파일럿) 플랜은 동일 패턴이므로 직접 진행 가능.
