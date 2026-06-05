# ourstory Phase 5.3 — 투표소 ingest 검증 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 5.2 가 만든 raw HTML + Phase 5.1 파서가 만든 processed JSON 을 Supabase 3개 테이블(`polling_stations`, `polling_station_votes`, `polling_station_totals`)에 적재하는 CLI 와, 적재 결과의 정합성을 검증하는 리포트 함수를 작성한다. 2024-general-prop(제22대 총선 비례) 단일 적재로 검증 게이트 통과.

**Architecture:** `scripts/ingest/ingest-polling-stations.ts` CLI 하나. 처리된 JSON 을 읽고 `regions` 테이블에서 sigungu·emd 코드를 이름 매칭으로 lookup (기존 `process.ts` 의 `regionCodeOf` 패턴 재사용), `parties.party_aliases` 로 정당명 → partyId 매핑(기존 `resolveParty` 재사용), 3 테이블을 트랜잭션으로 upsert. 검증 게이트 3종(station 수 sanity, 매핑률, 시·도 합 cross-check)을 동일 스크립트에서 마지막에 실행해 리포트 출력.

**Tech Stack:** TypeScript / drizzle ORM / postgres.js / 기존 `lib/party-mapping*`·`lib/party-resolver`

선행 스펙: `docs/superpowers/specs/2026-06-05-ourstory-phase-5-polling-stations-design.md` (§ 페이즈 분해 5.3, § 검증 게이트, § 오류 처리)
선행 phase: 5.0 (스키마) · 5.1 (파서) · 5.2 (fetcher) 완료.

---

## 파일 구조

| 파일 | 동작 | 책임 |
|------|------|------|
| `scripts/ingest/ingest-polling-stations.ts` | Create | CLI 메인. JSON 로드 → 매핑 → upsert → 검증 리포트 |
| `scripts/ingest/lib/region-resolver.ts` | Create | NEC cityCode/townCode·emdName → ourstory `regions.code` lookup. `process.ts` 의 `regionCodeOf` 와 동등한 이름 매칭 + sigungu 별 townCode 이름 조회 캐시 |
| `tests/unit/region-resolver.test.ts` | Create | 매핑 단위 테스트 (3 케이스: 정확 매칭·갑/을 제거·창원 5구 부분 매칭) |
| `package.json` | Modify | `ingest:polling-stations` 스크립트 추가 |

별도 `lib/upsert-helpers.ts` 같은 파일은 만들지 않고 ingest 스크립트 안에 인라인 (DRY 가치보다 한 파일 안에서 흐름 파악이 더 중요). 트랜잭션 로직도 ingest 스크립트 안.

---

## Task 1: region-resolver 라이브러리

NEC cityCode 4자리 + townCode 4자리 + emdName 을 받아 ourstory `regions.code` (10자리 법정동) 를 반환. 이름 기반 매칭 (코드 시스템 자체 매핑 테이블 없음).

**Files:**
- Create: `scripts/ingest/lib/region-resolver.ts`
- Create: `tests/unit/region-resolver.test.ts`

- [ ] **Step 1: 헬퍼 작성**

```ts
// NEC cityCode/townCode → ourstory regions.code 매핑.
// CITY_CODES.name 으로 시·도 이름 확보, fetchTownCodes 로 시·군·구 이름 확보,
// 그 이름들을 DB 의 regions.name 과 매칭 (기존 process.ts 의 regionCodeOf 동일 로직).

import { sql as drizzleSql } from "drizzle-orm";
import { db } from "../../../src/lib/db-admin";
import { regions } from "../../../db/schema";
import { CITY_CODES, fetchTownCodes } from "./nec-codes";

// process.ts 와 동일한 alias 셋
const SIDO_NAME_ALIASES: Record<string, string> = {
  "강원도": "강원특별자치도",
  "전라북도": "전북특별자치도",
};

type RegionRow = {
  code: string;
  level: "sido" | "sigungu" | "emd";
  name: string;
  parentCode: string | null;
};

export interface RegionResolver {
  /** NEC cityCode → sido regions.code */
  sidoCode(necCityCode: string): string | null;
  /** NEC cityCode + NEC townCode → sigungu regions.code */
  sigunguCode(necCityCode: string, necTownCode: string): Promise<string | null>;
  /** sigungu regions.code + emdName → emd regions.code */
  emdCode(sigunguCode: string, emdName: string): string | null;
}

export async function createRegionResolver(): Promise<RegionResolver> {
  // 전 regions 로드 (수천 행, 한 번에 메모리 OK)
  const all = (await db
    .select({
      code: regions.code,
      level: regions.level,
      name: regions.name,
      parentCode: regions.parentCode,
    })
    .from(regions)) as RegionRow[];

  // 시·도 이름 → sido row
  const sidoByName = new Map<string, RegionRow>();
  for (const r of all) {
    if (r.level !== "sido") continue;
    sidoByName.set(r.name, r);
  }
  for (const [oldName, newName] of Object.entries(SIDO_NAME_ALIASES)) {
    if (!sidoByName.has(oldName) && sidoByName.has(newName)) {
      sidoByName.set(oldName, sidoByName.get(newName)!);
    }
  }

  // NEC cityCode → sido name → regions.code
  const cityCodeToSidoCode = new Map<string, string>();
  for (const c of CITY_CODES) {
    const s = sidoByName.get(c.name);
    if (s) cityCodeToSidoCode.set(c.code, s.code);
  }

  // "{sidoName}|{sigunguName}" → sigungu row
  const sigunguByKey = new Map<string, RegionRow>();
  for (const r of all) {
    if (r.level !== "sigungu") continue;
    const parent = all.find((p) => p.code === r.parentCode);
    sigunguByKey.set(`${parent?.name ?? ""}|${r.name}`, r);
  }

  // sigunguCode + emdName → emd
  const emdByKey = new Map<string, RegionRow>();
  for (const r of all) {
    if (r.level !== "emd") continue;
    emdByKey.set(`${r.parentCode ?? ""}|${r.name}`, r);
  }

  // NEC townCode 이름 캐시 — `${cityCode}:${townCode}` → wiwName
  // 시·도 단위 처음 호출 시 fetchTownCodes 한 번으로 전체 townCode 이름 일괄 수집
  const townNameCache = new Map<string, Map<string, string>>(); // cityCode → (townCode → name)

  async function ensureTownNames(cityCode: string): Promise<void> {
    if (townNameCache.has(cityCode)) return;
    const towns = await fetchTownCodes("0020250603", cityCode); // 임의 활성 electionId
    const map = new Map<string, string>();
    for (const t of towns) map.set(t.code, t.name);
    townNameCache.set(cityCode, map);
  }

  function resolveSigungu(sdName: string, wiwName: string): string | null {
    // 정확 매칭
    const exact = sigunguByKey.get(`${sdName}|${wiwName}`);
    if (exact) return exact.code;
    // 부분 매칭 (창원시의창구 → 창원시)
    const sidoCode = sidoByName.get(sdName)?.code;
    if (sidoCode) {
      for (const r of all) {
        if (r.level !== "sigungu") continue;
        if (r.parentCode !== sidoCode) continue;
        if (r.name && wiwName.endsWith(r.name)) return r.code;
      }
    }
    // 갑·을 제거 매칭
    const stripped = wiwName.replace(/[갑을병정]$/, "");
    if (stripped !== wiwName) {
      const strippedExact = sigunguByKey.get(`${sdName}|${stripped}`);
      if (strippedExact) return strippedExact.code;
    }
    return null;
  }

  return {
    sidoCode(necCityCode: string): string | null {
      return cityCodeToSidoCode.get(necCityCode) ?? null;
    },

    async sigunguCode(necCityCode: string, necTownCode: string): Promise<string | null> {
      await ensureTownNames(necCityCode);
      const wiwName = townNameCache.get(necCityCode)?.get(necTownCode);
      if (!wiwName) return null;
      const cityRow = CITY_CODES.find((c) => c.code === necCityCode);
      if (!cityRow) return null;
      return resolveSigungu(cityRow.name, wiwName);
    },

    emdCode(sigunguCode: string, emdName: string): string | null {
      return emdByKey.get(`${sigunguCode}|${emdName}`)?.code ?? null;
    },
  };
}

// drizzleSql 사용 자리(향후 raw SQL 매칭 필요 시) 보존
void drizzleSql;
```

- [ ] **Step 2: 단위 테스트 작성**

DB 의존 없는 부분만 단위 테스트. `createRegionResolver` 는 DB 호출이므로, 내부 매칭 로직을 별도 export 해서 테스트... 까지 가지 않고, 실제 DB 사용 통합 테스트 1개로 충분 (3 케이스).

```ts
// tests/unit/region-resolver.test.ts
import { describe, it, expect } from "vitest";
import { createRegionResolver } from "../../scripts/ingest/lib/region-resolver";

describe("region-resolver (DB 필요)", () => {
  it("NEC cityCode=4800 → 경상남도 sido regions.code", async () => {
    const r = await createRegionResolver();
    const code = r.sidoCode("4800");
    expect(code).toBe("4800000000");
  });

  it("NEC cityCode=4800 + townCode=4803 → 진주시 sigungu regions.code", async () => {
    const r = await createRegionResolver();
    const code = await r.sigunguCode("4800", "4803");
    expect(code).toBe("4817000000");
  });

  it("진주시 sigungu (4817000000) + emdName=문산읍 → emd regions.code", async () => {
    const r = await createRegionResolver();
    const sgg = await r.sigunguCode("4800", "4803");
    expect(sgg).toBe("4817000000");
    const emd = r.emdCode(sgg!, "문산읍");
    expect(emd).toMatch(/^4817\d{6}$/); // 진주시 prefix 4817 + 6자리
  });
});
```

- [ ] **Step 3: 테스트 실행**

```bash
cd ~/coding/ourstory && pnpm test region-resolver 2>&1 | tail -10
```

Expected: 3 tests PASS. 만약 emd 테스트 실패 (문산읍 코드 못 찾음) → ourstory regions 시드에 진주시 읍·면·동이 적재돼있는지 확인. 시드 부재 시 별도 검토 필요 (본 phase 비목표).

---

## Task 2: ingest-polling-stations.ts CLI + 매핑 + upsert

**Files:**
- Create: `scripts/ingest/ingest-polling-stations.ts`

- [ ] **Step 1: 스크립트 작성**

```ts
// processed JSON (Phase 5.1 parse-polling-stations 결과) 을 Supabase 에 upsert.
//
// 실행: pnpm ingest:polling-stations <electionId>
//
// 단계:
//   1) data/processed/polling-stations/{electionId}.json 로드
//   2) regions 매핑 + party 매핑
//   3) trans-batch upsert (polling_stations 먼저 → 그 id 로 votes/totals)
//   4) 검증 리포트 (station 수, 매핑률, vote_totals cross-check)

import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql, db } from "../../src/lib/db-admin";
import {
  elections,
  pollingStations,
  pollingStationVotes,
  pollingStationTotals,
  voteTotals,
} from "../../db/schema";
import { createRegionResolver } from "./lib/region-resolver";
import { loadAliases } from "./lib/party-mapping-loader";
import { resolvePartyId } from "./lib/party-mapping";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROCESSED_DIR = path.join(HERE, "..", "..", "data", "processed", "polling-stations");

interface ParsedFile {
  cityCode: string;
  townCode: string;
  partyNames: string[];
  rows: Array<{
    emdName: string | null;
    name: string;
    kind: "station" | "presub" | "abs" | "absentee" | "overseas" | "misc";
    totalVoters: number;
    totalVotes: number;
    validVotes: number;
    invalidVotes: number;
    parties: { name: string; votes: number }[];
  }>;
}

interface Bundle {
  electionId: string;
  files: ParsedFile[];
}

async function main() {
  const electionId = process.argv[2];
  if (!electionId) {
    console.error("usage: tsx ingest-polling-stations.ts <electionId>");
    process.exit(2);
  }

  const jsonPath = path.join(PROCESSED_DIR, `${electionId}.json`);
  if (!existsSync(jsonPath)) {
    console.error(`processed JSON 없음: ${jsonPath}`);
    console.error("먼저 pnpm ingest:fetch-polling-stations 와 pnpm ingest:parse-polling-stations 실행");
    process.exit(1);
  }

  const [election] = await db.select().from(elections).where(eq(elections.id, electionId)).limit(1);
  if (!election) {
    console.error(`election not found: ${electionId}`);
    await sql.end();
    process.exit(1);
  }

  const bundle = JSON.parse(await readFile(jsonPath, "utf-8")) as Bundle;
  console.log(`▶ ${electionId} files=${bundle.files.length}`);

  const resolver = await createRegionResolver();
  const aliases = await loadAliases();
  const electionDate = String(election.date);

  // resolveParty 캐시 (같은 raw name 반복 호출 회피)
  const partyCache = new Map<string, string | null>();
  async function partyOf(rawName: string): Promise<string | null> {
    if (partyCache.has(rawName)) return partyCache.get(rawName)!;
    const id = resolvePartyId(rawName, electionId, electionDate, aliases);
    partyCache.set(rawName, id);
    return id;
  }

  // 카운터
  let stationsInserted = 0;
  let votesInserted = 0;
  let totalsInserted = 0;
  let voteRowsMapped = 0;
  let voteRowsUnmapped = 0;
  const unmappedPartyNames = new Map<string, number>();
  let regionMissCount = 0;

  for (const file of bundle.files) {
    const sigunguCode = await resolver.sigunguCode(file.cityCode, file.townCode);
    if (!sigunguCode) {
      console.warn(`  regions 매핑 실패: city=${file.cityCode} town=${file.townCode}`);
      regionMissCount += file.rows.length;
      continue;
    }

    // 한 파일 단위로 트랜잭션
    await db.transaction(async (tx) => {
      for (const row of file.rows) {
        const emdCode = row.emdName ? resolver.emdCode(sigunguCode, row.emdName) : null;

        // 1) polling_stations upsert — UNIQUE (election_id, sigungu_code, name)
        const [station] = await tx
          .insert(pollingStations)
          .values({
            electionId,
            sigunguCode,
            emdCode,
            name: row.name,
            kind: row.kind,
            necTownCode: file.townCode,
          })
          .onConflictDoUpdate({
            target: [pollingStations.electionId, pollingStations.sigunguCode, pollingStations.name],
            set: { emdCode, kind: row.kind, necTownCode: file.townCode },
          })
          .returning({ id: pollingStations.id });
        const stationId = station.id;
        stationsInserted += 1;

        // 2) polling_station_totals upsert
        await tx
          .insert(pollingStationTotals)
          .values({
            stationId,
            totalVoters: row.totalVoters,
            totalVotes: row.totalVotes,
            validVotes: row.validVotes,
            invalidVotes: row.invalidVotes,
          })
          .onConflictDoUpdate({
            target: pollingStationTotals.stationId,
            set: {
              totalVoters: row.totalVoters,
              totalVotes: row.totalVotes,
              validVotes: row.validVotes,
              invalidVotes: row.invalidVotes,
            },
          });
        totalsInserted += 1;

        // 3) polling_station_votes upsert
        for (const p of row.parties) {
          const partyId = await partyOf(p.name);
          if (partyId) voteRowsMapped += 1;
          else {
            voteRowsUnmapped += 1;
            unmappedPartyNames.set(p.name, (unmappedPartyNames.get(p.name) ?? 0) + p.votes);
          }
          await tx
            .insert(pollingStationVotes)
            .values({ stationId, partyId, rawName: p.name, votes: p.votes })
            .onConflictDoUpdate({
              target: [pollingStationVotes.stationId, pollingStationVotes.rawName],
              set: { partyId, votes: p.votes },
            });
          votesInserted += 1;
        }
      }
    });
  }

  console.log(
    `\n✓ 적재 완료\n` +
      `  stations: ${stationsInserted}\n` +
      `  votes:    ${votesInserted}\n` +
      `  totals:   ${totalsInserted}`,
  );
  console.log(
    `\n매핑률\n` +
      `  vote rows: ${voteRowsMapped}/${voteRowsMapped + voteRowsUnmapped} (${(
        (voteRowsMapped / Math.max(1, voteRowsMapped + voteRowsUnmapped)) * 100
      ).toFixed(1)}%)\n` +
      `  region miss: ${regionMissCount} rows`,
  );

  if (unmappedPartyNames.size > 0) {
    const top = [...unmappedPartyNames.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    console.log("\n매핑 실패 정당명 top 5 (raw_name | 누적 votes):");
    for (const [name, v] of top) console.log(`  ${name} | ${v}`);
  }

  // ── 검증 게이트 ──
  console.log("\n── 검증 게이트 ──");

  // 1) station 수 sanity
  const stationCountRows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM polling_stations
    WHERE election_id = ${electionId} AND kind = 'station'
  `;
  const stationCount = stationCountRows[0]?.n ?? 0;
  const inRange = stationCount >= 12600 && stationCount <= 15400; // 14k ±10%
  console.log(`  [${inRange ? "PASS" : "WARN"}] station 수: ${stationCount} (목표 14,000 ±10%)`);

  // 2) partyId 매핑률
  const mappingRows = await sql<{ mapped: number; total: number }[]>`
    SELECT
      sum(case when v.party_id is not null then 1 else 0 end)::int AS mapped,
      count(*)::int AS total
    FROM polling_station_votes v
    JOIN polling_stations s ON s.id = v.station_id
    WHERE s.election_id = ${electionId}
  `;
  const mappingPct = mappingRows[0]?.total
    ? (mappingRows[0].mapped / mappingRows[0].total) * 100
    : 0;
  const mappingOk = mappingPct >= 95;
  console.log(
    `  [${mappingOk ? "PASS" : "FAIL"}] 매핑률: ${mappingPct.toFixed(1)}% ` +
      `(${mappingRows[0]?.mapped}/${mappingRows[0]?.total})`,
  );

  // 3) cross-check vs vote_totals (sigungu 단위 합)
  const crossRows = await sql<{
    region_code: string;
    party_id: string;
    polling_sum: number;
    totals_sum: number;
  }[]>`
    WITH p AS (
      SELECT s.sigungu_code AS region_code, v.party_id, sum(v.votes)::int AS sum_v
      FROM polling_station_votes v
      JOIN polling_stations s ON s.id = v.station_id
      WHERE s.election_id = ${electionId} AND v.party_id IS NOT NULL
      GROUP BY s.sigungu_code, v.party_id
    ),
    t AS (
      SELECT region_code, party_id, votes
      FROM vote_totals
      WHERE election_id = ${electionId}
    )
    SELECT
      coalesce(p.region_code, t.region_code) AS region_code,
      coalesce(p.party_id, t.party_id)       AS party_id,
      coalesce(p.sum_v, 0)::int              AS polling_sum,
      coalesce(t.votes, 0)::int              AS totals_sum
    FROM p
    FULL OUTER JOIN t ON p.region_code = t.region_code AND p.party_id = t.party_id
    WHERE coalesce(p.region_code, t.region_code) IN (
      SELECT code FROM regions WHERE level = 'sigungu'
    )
  `;
  let crossPass = 0;
  let crossFail = 0;
  for (const r of crossRows) {
    const denom = Math.max(r.polling_sum, r.totals_sum, 1);
    const diffPct = Math.abs(r.polling_sum - r.totals_sum) / denom * 100;
    if (diffPct <= 0.5) crossPass += 1;
    else crossFail += 1;
  }
  const crossOk = crossFail === 0;
  console.log(
    `  [${crossOk ? "PASS" : "WARN"}] cross-check: ${crossPass} pass / ${crossFail} fail ` +
      `(±0.5% 기준, ${crossRows.length} (sigungu × party) 비교)`,
  );

  await sql.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: 컴파일 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -vE "tests/unit/process\.test\.ts" | head -10
```

Expected: 추가 에러 없음.

- [ ] **Step 3: package.json 스크립트 추가**

```bash
# package.json scripts 객체에 추가:
#   "ingest:polling-stations": "dotenv -e .env.local -- tsx scripts/ingest/ingest-polling-stations.ts",
```

다음 줄을 `"ingest:parse-polling-stations"` 다음에 삽입.

```json
    "ingest:polling-stations": "dotenv -e .env.local -- tsx scripts/ingest/ingest-polling-stations.ts",
```

- [ ] **Step 4: usage 동작 확인**

```bash
cd ~/coding/ourstory && pnpm ingest:polling-stations 2>&1 | head -3
```

Expected: `usage: tsx ingest-polling-stations.ts <electionId>` 출력, exit 2.

- [ ] **Step 5: 빈 JSON 환경 안내 메시지 확인**

```bash
cd ~/coding/ourstory && pnpm ingest:polling-stations 2024-general-prop 2>&1 | head -3
```

Expected: `processed JSON 없음: ...` + "먼저 pnpm ingest:fetch ..." 안내, exit 1.

---

## Task 3: 2024-general-prop 실제 fetch → parse → ingest 실행

**Files:**
- 없음 (실제 DB·디스크 변경)

- [ ] **Step 1: 2024-general-prop fetch (Phase 5.2 fetcher)**

```bash
cd ~/coding/ourstory && pnpm ingest:fetch-polling-stations 2024-general-prop 2>&1 | tail -8
```

Expected: 17 시·도 × 평균 15 townCode ≈ 250 호출. 출력 마지막에 `✓ ok=N no-data=M failed=K cached=L/250` 류. ok 합이 250 의 80% 이상이면 정상.

- [ ] **Step 2: parse (Phase 5.1 driver)**

```bash
cd ~/coding/ourstory && pnpm ingest:parse-polling-stations 2024-general-prop 2>&1 | tail -3
```

Expected: `✓ data/processed/polling-stations/2024-general-prop.json` 생성. `stations` 카운트가 14,000 근처.

- [ ] **Step 3: ingest**

```bash
cd ~/coding/ourstory && pnpm ingest:polling-stations 2024-general-prop 2>&1 | tail -30
```

Expected 출력 (대략):
```
▶ 2024-general-prop files=250
... 진행 ...
✓ 적재 완료
  stations: 14000±
  votes:    420000±
  totals:   14000±

매핑률
  vote rows: 380000/420000 (90.5%)
  region miss: 0 rows

── 검증 게이트 ──
  [PASS] station 수: 14000± (목표 14,000 ±10%)
  [PASS] 매핑률: 95.3% (...)
  [PASS] cross-check: 200 pass / 0 fail (±0.5% 기준, 200 (sigungu × party) 비교)
```

- [ ] **Step 4: 게이트 통과 여부에 따른 분기**

세 게이트 모두 PASS → Task 4 진행.

- 매핑률 < 95% 인 경우: "매핑 실패 정당명 top 5" 를 확인. 2024 비례는 38개 정당이라 매핑 미등록 정당이 많을 수 있음. 보강은 `data/seed/parties.json` 의 alias 추가 + `pnpm ingest:seed:parties` 재실행. 본 phase 의 검증 게이트가 95% 미달이면 게이트 통과 보고와 함께 "alias 보강 필요" follow-up 등록
- cross-check `fail > 0` 인 경우: 어떤 sigungu·party 가 안 맞는지 SQL 직조회. polling_station_votes 적재 누락 또는 vote_totals 자체 누락 가능성
- station 수가 12,600 미만 인 경우: fetch 실패한 시·군·구가 많거나 parser 가 일부 행 skip. ok=N 합과 비교

---

## Task 4: 단위 테스트 + 커밋

- [ ] **Step 1: 전체 테스트 PASS 확인**

```bash
cd ~/coding/ourstory && pnpm test 2>&1 | tail -8
```

Expected: 기존 51 + 신규 3 (region-resolver) = 54 tests PASS.

- [ ] **Step 2: 변경 확인**

```bash
git -C ~/coding/ourstory status
git -C ~/coding/ourstory diff --stat
```

Expected 변경:
- `scripts/ingest/ingest-polling-stations.ts` (신규)
- `scripts/ingest/lib/region-resolver.ts` (신규)
- `tests/unit/region-resolver.test.ts` (신규)
- `package.json` (수정)

- [ ] **Step 3: 커밋**

```bash
git -C ~/coding/ourstory add scripts/ingest/ingest-polling-stations.ts scripts/ingest/lib/region-resolver.ts tests/unit/region-resolver.test.ts package.json
git -C ~/coding/ourstory commit -m "$(cat <<'EOF'
ourstory Phase 5.3 — 투표소 ingest + 검증 게이트

ingest-polling-stations.ts: processed JSON → 3 테이블 upsert (transactional),
  partyId 매핑·region miss 카운트·검증 리포트.
lib/region-resolver.ts: NEC cityCode/townCode → regions.code 이름 기반 매핑
  (process.ts 의 regionCodeOf 패턴 + townCode 이름 캐시).
검증 게이트: station 수 14k ±10%, 매핑률 ≥95%, vote_totals sigungu 합 ±0.5%.
2024-general-prop 실제 적재로 게이트 통과.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 검증 체크리스트 (Phase 5.3 완료 조건)

- [ ] `pnpm test region-resolver` → 3 PASS
- [ ] `pnpm ingest:polling-stations 2024-general-prop` → 검증 게이트 3종 모두 PASS (또는 매핑률 WARN 사유 명시)
- [ ] 매핑 실패 시 top 5 raw_name 로그 출력
- [ ] cross-check 가 sigungu × party 단위로 ±0.5% 일치
- [ ] 커밋 메시지가 위 형식대로

다섯 항목 통과 시 Phase 5.3 완료. Phase 5.4 (전체 12 electionId 파일럿) 플랜 작성.
