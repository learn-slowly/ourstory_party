# ourstory Phase 1.1 — Pilot 데이터 인제스천 (시·도/시·군 + 후보자)

**작성일**: 2026-06-04
**상위 spec**: `2026-06-04-ourstory-design.md` § 7 Phase 1.1
**기간**: 0.5주 → 실측 1~1.5주 (검증·candidates·diff 범위 확대 반영)

---

## 1. 목표

data.go.kr 선관위 API 로부터 **Pilot 4개 선거일(elections 16개)** 의 시·도/시·군 정당 집계와 지역구·비례 후보자 명부를 Supabase 에 적재한다. 재실행 가능하고 4종 검증 통과. UI 변경 없음(데이터 계층만).

### Pilot 대상

| 선거일 | 패키지 | elections.id |
|---|---|---|
| 2022-06-01 | 제8회 지방선거 (6 유형) | 2022-local-{governor, mayor, council, council-prop, council-basic, council-basic-prop} |
| 2024-04-10 | 제22대 총선 (2 유형) | 2024-general, 2024-general-prop |
| 2025-06-03 | 제21대 대선 | 2025-presidential |
| 2026-06-03 | 제9회 지방선거 (7 유형) | 2026-local-{governor, mayor, council, council-prop, council-basic, council-basic-prop, superintendent} |

**합계: 16 elections.** 시드된 30개 중 14개(2018 지선·2019/2025 재보궐·2020 총선·2022 대선)는 **Phase 1.1+** 로 미룬다 — 코드 경로가 검증되면 동일 CLI로 확장.

### 비대상

- 읍·면·동 단위 (Phase 1.5: info.nec.go.kr 크롤링)
- UI 노출 (Phase 1.2: `/` 시계열 차트)
- 자동화·cron (Phase 4)
- 14개 미루는 elections

---

## 2. Architecture

단방향 파이프라인:

```
data.go.kr API ──► raw 캐시 ──► 파서 ──► 정당 매핑 ──► Drizzle upsert ──► 검증·diff 보고
   (3개 service)   (JSON)     (zod)     (aliases       (vote_totals,        (4종 룰)
                                       + overrides)    region_totals,
                                                       candidates)
```

### 사용 API (data.go.kr 선관위 4개 중 3개)

- `VoteXmntckInfoInqireService2` — 시·도/시·군 정당 득표 (모든 선거 유형)
- `ElcntInfoInqireService` — 선거인수/투표수/무효표/투표율
- `CommonCodeService` — 정당 코드·선거 코드 (party_aliases 보강용)

후보자 명부는 **VoteXmntckInfoInqireService2** 의 후보자 단위 endpoint 활용 — 별도 service 필요 없음(jp-in-gn 검증).

### 디렉터리 구조

```
ourstory/
├── data/
│   ├── raw/                                  # gitignored, --refresh 로 갱신
│   │   └── <electionId>/
│   │       ├── vote-xmntck.json
│   │       ├── elcnt.json
│   │       └── candidates.json
│   └── seed/
│       └── election-party-overrides.json     # 신규 — 정치 판단 강제 매핑
├── db/
│   ├── schema.ts                              # election_party_overrides 추가
│   └── migrations/
│       └── 0002_election_party_overrides.sql # 신규
├── scripts/
│   └── ingest/
│       ├── lib/
│       │   ├── api-client.ts                  # 신규
│       │   └── party-resolver.ts              # 신규
│       ├── fetch-results.ts                   # 신규 (raw 응답에 후보자명 hbojaName 포함 → candidates 도 여기서)
│       ├── fetch-voters.ts                    # 신규
│       ├── process.ts                         # 신규 (results raw 1개에서 vote_totals + candidates 둘 다 파생)
│       ├── validate.ts                        # 신규
│       ├── diff.ts                            # 신규
│       └── seed/
│           └── election-party-overrides.ts    # 신규
└── tests/
    ├── fixtures/
    │   └── raw/                               # data.go.kr 응답 5종 샘플
    └── unit/
        ├── api-client.test.ts                 # 신규
        ├── party-resolver.test.ts             # 신규
        ├── process.test.ts                    # 신규
        └── validate.test.ts                   # 신규
```

---

## 3. DB 변경

### 신규 테이블 `election_party_overrides`

```ts
// db/schema.ts 에 추가
export const electionPartyOverrides = pgTable(
  "election_party_overrides",
  {
    electionId: text("election_id").notNull().references(() => elections.id),
    rawName: text("raw_name").notNull(),     // data.go.kr 원문 정당명 (예: "민주노동당")
    partyId: text("party_id").notNull().references(() => parties.id),
    note: text("note"),                       // 정치 판단 근거 필수 기록
  },
  (t) => ({ pk: primaryKey({ columns: [t.electionId, t.rawName] }) }),
);
```

### 시드 파일

`data/seed/election-party-overrides.json` — Phase 1.1 알려진 케이스만:

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

추가 케이스(통합진보당 → progressive, 진보신당 → justice 등)는 인제스천 중 R3 경고로 식별되면 사용자 확인 후 PR로 추가.

### RLS

`election_party_overrides`: anon 읽기 허용(다른 시드 테이블과 동일 정책).

---

## 4. 정당 매핑 로직 (party-resolver)

```ts
// scripts/ingest/lib/party-resolver.ts
async function resolveParty(
  electionId: string,
  electionDate: string,   // YYYY-MM-DD
  rawName: string,
): Promise<string | null> {
  // 1. 강제 매핑 (선거 단위)
  const override = await db
    .select()
    .from(electionPartyOverrides)
    .where(and(eq(electionPartyOverrides.electionId, electionId),
               eq(electionPartyOverrides.rawName, rawName)))
    .limit(1);
  if (override.length) return override[0].partyId;

  // 2. alias (시기 적용)
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

  // 3. 미매칭 — null 반환, 호출자가 R3 경고 누적
  return null;
}
```

미매칭 시 동작:
- **vote_totals**: 행 skip (R3 경고 누적)
- **candidates**: `partyId = null`, `partyNameRaw = rawName` 으로 저장 (사후 보정 가능)

---

## 5. CLI

```sh
pnpm ingest:pilot                          # 4개 선거일 16 elections 일괄
pnpm ingest:election <id>                  # 단일 선거
pnpm ingest:election <id> --refresh        # raw 캐시 무시, API 재호출
pnpm ingest:election <id> --dry-run        # DB 미적용, 검증만
pnpm ingest:election <id> --diff           # upsert 전 변경분 보고서
pnpm ingest:seed:overrides                 # election_party_overrides 시드
pnpm ingest:validate                       # 전체 검증만 (--dry-run 묶음)
```

### 환경

- 로컬 실행 (Vercel/cron 미사용)
- Service Role 키 (인제스천 한정)
- `tsx scripts/ingest/<file>.ts` 직접 실행 + `dotenv -e .env.local`

---

## 6. 검증 규칙 (validate.ts)

| 룰 | 내용 | 위반 시 |
|---|---|---|
| **R1. 구조** | (election × region) 셋 — 수행 대상 vs 실 적재 — 누락 0개 | 실패 — 해당 선거 중단 |
| **R2. 합계 정합성** | 동일 election 시·군 vote_totals.votes 합 == 시·도 vote_totals.votes (±0.5%) | 실패 — 해당 선거 중단 |
| **R3. alias 누락** | party_aliases / election_party_overrides 매칭 실패 raw 정당명 0개 | 경고 — 계속, 보고서에 누적 |
| **R4. 분모 정합성** | region_totals: valid_votes + invalid_votes == total_votes, progress_pct ∈ [0, 100] | 경고 — 계속, 보고서 |

### "수행 대상 셋" 정의 (R1)

- 시·도 단위: 17개 시·도 × 해당 election (선거 유형에 따라 일부 시·도 미실시 시 제외)
- 시·군 단위: 254개 시·군·구 × 해당 election (동일)
- 비례 election 은 시·군 단위가 의미 있는 유형(local_council_prop 등)만 시·군 적재

### 보고서 형식

```
=== Ingest Report: 2025-presidential ===
R1 구조:        PASS (sido: 17/17, sigungu: 254/254)
R2 합계:        PASS (max delta: 0.12%)
R3 alias:       WARN — 미매칭 raw 정당명 2건:
                  "○○당" (votes 합계 12,345)
                  "△△당" (votes 합계 1,234)
R4 분모:        WARN — progress_pct < 100 인 region 0건, 합 불일치 1건:
                  서울 종로구: valid+invalid != total (diff 3)

upsert: vote_totals 4,318 / region_totals 271 / candidates 14
diff:   vote_totals 변경 0 / 신규 4,318
```

---

## 7. 재실행 정책

| 시나리오 | 동작 |
|---|---|
| 기본 (캐시 hit) | raw 캐시 사용, API 미호출, parse → upsert |
| `--refresh` | raw 캐시 무시, API 재호출 후 raw 덮어쓰기 |
| `--dry-run` | upsert 스킵, parse → validate 만 |
| `--diff` | upsert 전 기존 DB 행 SELECT → 변경 행 수 + 샘플 5건 stdout |
| 2026 지선 부분 데이터 | `progress_pct < 100` 시 인제스천 진행, 보고서에 `PARTIAL: <electionId> (XX%)` |
| API 5xx | 지수 백오프 재시도 3회 (1s → 2s → 4s) |
| 한 선거 실패 | 다른 선거 진행, 마지막에 실패 목록 출력 |

### Upsert 정책

- 모든 테이블 `ON CONFLICT DO UPDATE` (Drizzle `.onConflictDoUpdate()`)
- 키: vote_totals (election×region×party), region_totals (election×region)
- candidates: 현 schema 가 `id bigserial` PK 라 ON CONFLICT 키가 없음 → **인제스천 직전 해당 electionId 의 candidates 행을 DELETE 후 INSERT** (replace). UNIQUE 인덱스 추가는 다음 마이그레이션에서 검토.

---

## 8. 테스트 전략

| 레벨 | 대상 | 픽스처 |
|---|---|---|
| 단위 | `party-resolver` — 우선순위(override → alias → null), 시기 매칭 | 테스트용 DB rollback |
| 단위 | `process` — raw row → 정형화 (시·도/시·군 구분, "합계" 행 처리, 동명 후보자) | data.go.kr 응답 5종 샘플 (선거 유형별) |
| 단위 | `validate` — R1~R4 위반/통과 케이스 | 합성 데이터 |
| 통합 | `ingest:election 2025-presidential --dry-run` (mock fetch, 실 DB rollback) | 캐시된 raw JSON |

픽스처 위치: `tests/fixtures/raw/<service>/<sample>.json`. data.go.kr 응답은 공공 데이터이므로 익명화 없이 그대로 커밋.

---

## 9. 완료 기준 (Phase 1.1 Done)

- [ ] Pilot 16 elections × 전국 17개 시·도 × 254개 시·군·구 ≈ 4,300+ 행이 `vote_totals` 에 존재 (선거 유형에 따른 실제 행 수는 변동 — R1 검증으로 확정)
- [ ] `region_totals` 동일 (election × region) 셋만큼 행 존재
- [ ] `candidates` 테이블에 Pilot 후보자 행 적재. `partyId IS NOT NULL` 비율 ≥ 95% (분모: Pilot candidates 전체 행)
- [ ] `pnpm ingest:pilot --dry-run` 으로 4종 검증 PASS (R3·R4 경고는 보고서로만)
- [ ] `pnpm test` 전부 PASS (기존 8개 + 신규 단위·통합 분)
- [ ] `data/seed/election-party-overrides.json` 권영국 1건 적재, DB 시드 완료
- [ ] 라이브 (`https://jp-ourstory.vercel.app`) — UI 변경 없음, 빌드만 PASS (스키마 추가 영향 검증)

---

## 10. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| 2026 지선 data.go.kr 데이터 미공개·부분 공개 (D+1 시점) | Pilot 일괄 실행은 가능하되 R4 경고로 보고. 후속 일자에 `--refresh` 재실행. |
| data.go.kr API 호출 한도 | raw 캐시 정책으로 재실행 시 API 미호출. 초기 일괄은 elections × services = 약 48~64 호출 — 한도 내. |
| candidates partyId 매핑률 < 95% | 알려진 위성정당·통합진보·진보신당·민중연합 등 시기별 alias 보강(party_aliases) + R3 보고서로 확인 후 PR. |
| 시·군 단위 행 수 폭증으로 인덱스 성능 | 현 schema 의 `vt_region_idx`, `vt_party_idx` 로 충분. Phase 1.5 읍·면·동 시점 재검토. |
| 권영국 외 정치 판단 케이스 누락 | R3 경고로 식별되면 PR 으로 element-party-overrides.json 갱신 → 재시드. |

---

## 11. 다음 단계

- **다음 plan 파일**: `docs/superpowers/plans/2026-06-04-ourstory-phase-1.1-pilot-data.md` 작성 — 본 spec 의 task-by-task 실행 계획. writing-plans 스킬로 작성 → executing-plans 또는 subagent-driven-development 로 실행.
- **Phase 1.2 (홈 차트)** 시작 가능 — vote_totals 가 적재되어 있으므로 차트 즉시 그릴 수 있음.
- **14개 미루는 elections** 는 Pilot 검증된 CLI 로 별도 PR 처리 (Phase 1.1+).
