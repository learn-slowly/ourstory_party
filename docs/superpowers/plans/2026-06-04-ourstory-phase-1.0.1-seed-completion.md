# ourstory Phase 1.0.1 (시드 보강) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1.0 시드의 잔여 결함 2건을 완결한다 — elections 8개의 `necElectionId` placeholder 값 보정과 누락된 시·도(세종특별자치시) 1행 추가. Phase 1.1 인제스천 진입 선결 조건.

**Architecture:** 기존 시드 JSON 갱신 + Drizzle `onConflictDoUpdate` 시드 재실행. 마이그레이션 없음(스키마 불변). data.go.kr API 빠른 호출 1~2건으로 `necElectionId` 형식(`00YYYYMMDD`) 검증.

**Tech Stack:** TypeScript, Drizzle ORM, postgres-js, tsx, dotenv.

---

## 배경

Phase 1.1 Task 5 의 실 API 점검 중 발견:

- ourstory `data/seed/elections.json` 의 `necElectionId` 가 다음과 같이 분포:
  - 2025-presidential / 2026-local-* (총 8건): `0020250603` / `0020260603` 등 정상 10자리(`00<YYYYMMDD>`)
  - **2018-local-* / 2019-byelection / 2020-general / 2022-presidential / 2022-local-* (총 22건)**: 모두 `"0000000000"` placeholder — data.go.kr 호출 불가
- regions 테이블 시·도가 16개 (서울/부산/대구/인천/광주/대전/울산/경기/충북/충남/전남/경북/경남/제주/강원/전북) — **세종특별자치시 누락**. 기존 `01-regions.ts` 가 행안부 법정동코드 파싱 시 세종(`3600000000`)이 sido=sigungu 단일 단위라 트리 분류에서 빠짐.

Phase 1.1 Pilot 16 elections 중 8건(2022 지선 6 + 2024 총선 2)이 placeholder 보정 필요. 시·도 17개 풀세트도 R1 검증(election × 17 시·도)에서 필요.

---

## File Structure

```
ourstory/
├── data/
│   └── seed/
│       └── elections.json                                  # MODIFY: 22행 necElectionId 보정
├── scripts/
│   └── ingest/
│       └── seed/
│           └── 05-sejong-region.ts                         # CREATE: 세종 1행 추가
```

기존 `01-regions.ts` 는 손대지 않는다 — 재시드하면 emd 5067건 등 large insert가 다시 흘러 비효율. 누락 1건만 처리하는 보강 스크립트로 충분.

---

## Task 1: elections placeholder 22개 보정

**Files:**
- Modify: `data/seed/elections.json`

22건의 `"necElectionId": "0000000000"` 을 실제 sgId 값으로 교체. 형식은 검증된 `00<YYYYMMDD>` (10자리). 같은 선거일은 모두 동일 sgId 값을 가진다.

### 보정 매핑

| 선거 그룹 | date | necElectionId |
|---|---|---|
| 2018-local-* (7개) | 2018-06-13 | `0020180613` |
| 2019-byelection-* (2개: 창원성산·통영고성) | 2019-04-03 | `0020190403` |
| 2020-general (2개) | 2020-04-15 | `0020200415` |
| 2022-presidential (1개) | 2022-03-09 | `0020220309` |
| 2022-local-* (7개 — Pilot 6 + 교육감 1) | 2022-06-01 | `0020220601` |
| 2024-general-* (2개) | 2024-04-10 | `0020240410` |
| 2025-byelection (1개: 양산시의원) | 2025-04-02 | `0020250402` |

총 22건 보정.

- [ ] **Step 1: data/seed/elections.json 편집**

대상 행을 식별하고 `"necElectionId": "0000000000"` → 위 매핑 표 값으로 교체. 22건 모두.

이미 정상인 행(2025-presidential `0020250603`, 2026-local-* `0020260603`)은 그대로 둔다.

- [ ] **Step 2: 시드 재실행**

```sh
cd /Users/ahbaik/coding/ourstory
pnpm ingest:seed:elections
```

Expected: `시드 완료: elections 30건` (또는 비슷한 메시지). `onConflictDoUpdate` 라 변경된 행만 갱신.

- [ ] **Step 3: DB에서 placeholder 잔존 확인**

```sh
cat > check.mts <<'EOF'
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const ph = await sql`SELECT id FROM elections WHERE nec_election_id = '0000000000'`;
console.log('placeholder 잔존:', ph.length);
const all = await sql`SELECT id, nec_election_id FROM elections ORDER BY display_order`;
console.log(all);
await sql.end();
EOF
pnpm dotenv -e .env.local -- tsx check.mts && rm check.mts
```

Expected: `placeholder 잔존: 0`. 30개 행 모두 `00YYYYMMDD` 형식.

- [ ] **Step 4: 빠른 API 검증 (대상 4개 선거일에서 1회씩)**

Pilot 4 선거일의 sgId 가 실제로 API 응답을 주는지 1회씩 검증:

```sh
cat > verify.mts <<'EOF'
const PILOT = [
  { id: '2022-local-governor',  sgId: '0020220601', sgTypecode: '3' },
  { id: '2024-general',          sgId: '0020240410', sgTypecode: '2' },
  { id: '2025-presidential',     sgId: '0020250603', sgTypecode: '1' },
  { id: '2026-local-governor',   sgId: '0020260603', sgTypecode: '3' },
];

const key = process.env.DATA_GO_KR_API_KEY!;
for (const e of PILOT) {
  const url = `https://apis.data.go.kr/9760000/VoteXmntckInfoInqireService2/getXmntckSttusInfoInqire?serviceKey=${key}&type=json&resultType=json&pageNo=1&numOfRows=1&sgId=${e.sgId}&sgTypecode=${e.sgTypecode}`;
  const r = await fetch(url);
  const j = await r.json();
  const code = j?.response?.header?.resultCode ?? 'NO_HEADER';
  const total = j?.response?.body?.totalCount ?? 0;
  console.log(`${e.id} (sgId=${e.sgId}, type=${e.sgTypecode}) → ${code}, totalCount=${total}`);
}
EOF
pnpm dotenv -e .env.local -- tsx verify.mts && rm verify.mts
```

Expected: 4건 모두 `INFO-000` 또는 `INFO-00`, totalCount > 0. (2026 지선은 D+1 시점이라 totalCount 작을 수 있음 — INFO-300 또는 부분 수치 OK.)

위반 시: 해당 선거의 sgId 형식이 다를 가능성. 보고에 명시.

- [ ] **Step 5: 커밋**

```sh
git add data/seed/elections.json
git commit -m "elections placeholder 22건 necElectionId 보정 (sgId=00YYYYMMDD)"
```

---

## Task 2: 세종특별자치시 추가

**Files:**
- Create: `scripts/ingest/seed/05-sejong-region.ts`
- Modify: `package.json` (스크립트 등록)

세종특별자치시는 행안부 법정동코드 `3600000000` 으로 sido level, parent_code=null. 단일 행이라 `regions` 테이블에 직접 insert.

- [ ] **Step 1: 시드 스크립트 작성**

`scripts/ingest/seed/05-sejong-region.ts`:

```ts
import { sql, db } from "../../../src/lib/db-admin";
import { regions } from "../../../db/schema";

async function main() {
  await db
    .insert(regions)
    .values({
      code: "3600000000",
      level: "sido",
      name: "세종특별자치시",
      parentCode: null,
      displayOrder: null,
    })
    .onConflictDoUpdate({
      target: regions.code,
      set: { level: "sido", name: "세종특별자치시", parentCode: null },
    });

  console.log("✓ 세종특별자치시(3600000000) 추가/갱신 완료");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: package.json 스크립트 등록**

`scripts` 섹션에 추가:

```json
"ingest:seed:sejong": "dotenv -e .env.local -- tsx scripts/ingest/seed/05-sejong-region.ts",
```

기존 `ingest:seed` 체이닝에는 넣지 않는다 — 1회성 보강이라 별도 호출.

- [ ] **Step 3: 실행**

```sh
pnpm ingest:seed:sejong
```

Expected: `✓ 세종특별자치시(3600000000) 추가/갱신 완료`

- [ ] **Step 4: 시·도 수 확인**

```sh
cat > check.mts <<'EOF'
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const cnt = await sql`SELECT COUNT(*)::int AS n FROM regions WHERE level='sido'`;
console.log('시·도 수:', cnt[0].n);
const sejong = await sql`SELECT code, name, parent_code FROM regions WHERE code='3600000000'`;
console.log('세종:', sejong);
await sql.end();
EOF
pnpm dotenv -e .env.local -- tsx check.mts && rm check.mts
```

Expected: `시·도 수: 17`, 세종 1행.

- [ ] **Step 5: 커밋**

```sh
git add scripts/ingest/seed/05-sejong-region.ts package.json
git commit -m "regions 시·도 보강 — 세종특별자치시 (3600000000)"
```

---

## 완료 기준 (Phase 1.0.1 Done)

- [ ] `elections` 30행 모두 `nec_election_id` 가 `00YYYYMMDD` 형식 (placeholder 0건)
- [ ] Pilot 4 선거일(2022-06-01 / 2024-04-10 / 2025-06-03 / 2026-06-03)이 data.go.kr API 에서 정상 응답
- [ ] `regions` 시·도 행 17개 (세종 포함)
- [ ] 빌드·테스트 회귀 없음 — `pnpm test` 전체 PASS, `pnpm build` PASS
- [ ] 라이브 (`https://jp-ourstory.vercel.app`) 회귀 없음 — UI 미변경

완료 시 Phase 1.1 Task 5 부터 재개 (fetch-results.ts 는 commit `d596b0e` 로 이미 작성됨, 실 API 점검만 재실행).

---

## Phase 1.1 후속 보정 (별도 plan patch — Phase 1.0.1 이후 적용)

Phase 1.1 plan 의 Task 3·7 에 다음 두 가지를 patch 한다 (별도 task 로 추가하지 말고 기존 task 안에서 처리):

### Patch 1 — types.ts XmntckItemSchema wide format

data.go.kr `VoteXmntckInfoInqireService2` 응답은 한 행에 후보자/정당이 wide 컬럼으로 펼쳐진다:
- 메타: `sgId, sgTypecode, sdName, sggName, wiwName`
- 정당 ×N: `jd01, jd02, ..., jd50`
- 후보자 ×N: `hbj01, hbj02, ..., hbj50`
- 득표수 ×N: `dugsu01, dugsu02, ..., dugsu50`

기존 plan 의 단일 컬럼 `jdName/hbojaName/vtTcnt` 가정은 잘못. types.ts 의 XmntckItemSchema 를 다음과 같이 교체:

```ts
export const XmntckItemSchema = z.object({
  sgId: z.string(),
  sgTypecode: z.string(),
  sdName: z.string(),
  sggName: z.string().optional(),
  wiwName: z.string().optional(),
}).catchall(z.unknown());
export type XmntckItem = z.infer<typeof XmntckItemSchema>;
```

### Patch 2 — process.ts wide → long expand + region 매칭 정규화

`extractVoteTotals` / `extractCandidates` 를 다음 헬퍼 위에 다시 짠다:

```ts
interface CandidateCell {
  jd: string | undefined;       // 정당명 (예: "더불어민주당")
  hbj: string | undefined;      // 후보자명
  dugsu: number | undefined;    // 득표수
}

function expandCells(row: Record<string, unknown>): CandidateCell[] {
  const cells: CandidateCell[] = [];
  for (let i = 1; i <= 50; i++) {
    const pad = String(i).padStart(2, "0");
    const jd = row[`jd${pad}`];
    if (jd == null || jd === "") continue;
    cells.push({
      jd: typeof jd === "string" ? jd : String(jd),
      hbj: typeof row[`hbj${pad}`] === "string" ? row[`hbj${pad}`] as string : undefined,
      dugsu: Number(row[`dugsu${pad}`] ?? 0),
    });
  }
  return cells;
}
```

그리고 region 매칭에서 `wiwName` 정규화:

```ts
// data.go.kr 의 wiwName 은 "창원시의창구"처럼 시·군명+일반구명을 붙여 쓴 형식이 많다.
// regions 테이블엔 일반구가 "의창구" 같은 단축형으로 들어있어 직접 비교가 어렵다.
// → 시·군 prefix 제거 시도 후 매칭.
function regionCodeOf(sdName: string, wiwName: string): string | null {
  if (wiwName === "합계") return sidoByName.get(sdName)?.code ?? null;

  // (1) 정확 매칭
  const exact = sigunguByKey.get(`${sdName}|${wiwName}`);
  if (exact) return exact.code;

  // (2) wiwName 끝 토큰만 매칭 (예: "창원시의창구" → "의창구")
  //     해당 시·도 안의 sigungu 중 name 으로 매칭
  for (const r of allRegions) {
    if (r.level !== "sigungu") continue;
    const parent = allRegions.find((p) => p.code === r.parentCode);
    if (parent?.name !== sdName) continue;
    if (wiwName.endsWith(r.name)) return r.code;
  }
  return null;
}
```

이 두 patch 는 Phase 1.1 plan Task 3(types.ts) 와 Task 7(process.ts) 의 코드 블록을 위 내용으로 교체하는 형태로 적용. Phase 1.0.1 가 끝난 뒤 plan 파일에 직접 반영(다음 controller 가 처리).
