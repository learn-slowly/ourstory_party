# ourstory Phase 5 — 투표소(투표구) 단위 개표결과 적재

작성일: 2026-06-05
대상 repo: `learn-slowly/ourstory_party`
선행: Phase 1.0~4 (인프라·시계열·라이브 자동화 완료)

## 동기

ourstory가 현재 보유한 가장 세밀한 데이터는 `regions.level = 'emd'` (읍·면·동) 단위 vote_totals·region_totals. 분석 사용자가 한 발 더 들어가 **투표소(NEC 용어로 "투표구") 단위 득표**를 보고 싶다는 요구가 들어옴. 한 동 안에서도 정의당 득표가 투표소별로 어떻게 흩어지는지, 같은 투표소가 선거 간 어떻게 변했는지 추적하려는 목적.

NEC 통계시스템 VCCP08 페이지는 `electionId` + `electionName`(선거일) + `electionCode` + `cityCode` + `townCode` 조합으로 투표구별 행이 포함된 HTML을 반환한다. jp-in-gn 프로젝트가 이미 동일 엔드포인트로 emd 단위까지 파싱하는 코드를 운영 중이라 패턴 재사용 가능.

## 비고: 2026 9회 지선 제외

오늘(2026-06-05) 기준 NEC에 9회 지선(electionId `0020260603`) 구조·정당 명단까지는 등록되어 있으나 수치 미공개. 본 Phase에서는 9회 지선을 명시적으로 제외하고, 추후 데이터 공개 후 동일 fetcher로 재실행한다.

## 범위 (Pilot)

선거(electionId) 12개 / 17 시·도. ourstory `elections` 테이블이 이미 race 별로 분리되어 있어 각 electionId 가 1 race 에 대응. necCode 는 `elections.necCode` 컬럼에서 그대로 가져옴.

| election year | electionId 목록 | 개수 |
|---------------|-----------------|------|
| 2020 총선 | `2020-general`(necCode=2), `2020-general-prop`(7) | 2 |
| 2022 지선 | `2022-local-governor`(3), `2022-local-mayor`(4), `2022-local-council`(5), `2022-local-council-prop`(8), `2022-local-council-basic`(6), `2022-local-council-basic-prop`(9), `2022-local-superintendent`(11) | 7 |
| 2024 총선 | `2024-general`(2), `2024-general-prop`(7) | 2 |
| 2025 대선 | `2025-presidential`(1) | 1 |

총 12 electionId. NEC 호출은 `electionId=0000000000` + `electionName=YYYYMMDD` 역대 패턴 우선. 2025 대선은 `0020250603` 로 먼저 시도해 응답 있으면 사용, 없으면 역대 패턴 fallback.

HTTP 호출량 추정: 약 3,000회 (12 electionId × 평균 250 townCode — 대선·광역단체장 등 시·도 단위 race는 17회로 절감). 동시성 5~6, 재시도 3, 요청당 6s 타임아웃 — 5~10분 내 완료 예상.

## 비목표 (이 Phase에서 안 함)

- UI 드릴다운 페이지 (`/region/[code]` 안에서 emd → 투표소 표) → Phase 6
- 시계열 강제 매핑 override 테이블 (renumber 수동 보정) → 필요 발생 시 별도 phase
- 사전투표소 개별(`VCAP02` 페이지) — 본 Phase는 "관내사전"·"관외사전" 메타 행 단위만 포착
- polygon·좌표 — 분석/표 중심, 지도 시각화는 별도
- 2026/6/3 9회 지선 — NEC 미공개 해소 후 재실행
- 2002~2019 옛 선거 — 본 PoC 검증 통과 후 확장

## 데이터 흐름

```
NEC VCCP08 (POST electionInfo_report.xhtml)
  electionId  / electionName / electionCode
  cityCode    / townCode      / searchMode=1
        ↓ HTML (30~200 행, 투표구별)

fetch-polling-stations.ts
  → data/raw/polling-stations/{electionId}-{cityCode}-{townCode}.html
        ↓
parse-polling-stations.ts (cheerio)
  → 행 분류
      "소계"          → emd 합계 (저장 skip — 이미 vote_totals 에 있음)
      "투표구명" 값    → kind=station
      "관내사전투표"   → kind=presub
      "관외사전투표"   → kind=abs
      "거소·선상투표"  → kind=absentee
      "재외투표"       → kind=overseas
      "잘못 투입…"     → kind=misc
  → 정당명 canonicalize (party-mapping resolvePartyId)
  → data/processed/polling-stations/{electionId}.json
        ↓
ingest-polling-stations.ts
  → polling_stations upsert (UNIQUE election_id + sigungu_code + name)
  → polling_station_totals upsert
  → polling_station_votes upsert (PK station_id + raw_name)
        ↓
Supabase Postgres
```

## 스키마

`db/schema.ts` 에 3개 테이블 추가. 기존 `regions`(sido/sigungu/emd) 그대로.

```ts
export const pollingStations = pgTable(
  "polling_stations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    electionId: text("election_id").notNull().references(() => elections.id),
    sigunguCode: text("sigungu_code").notNull().references(() => regions.code),
    emdCode: text("emd_code").references(() => regions.code), // null 허용 (메타 행: 거소·관외·재외)
    name: text("name").notNull(),                              // "제1투표소" / "관내사전투표" 등
    kind: text("kind", {
      enum: ["station", "presub", "abs", "absentee", "overseas", "misc"],
    }).notNull(),
    necTownCode: text("nec_town_code"),                        // NEC 시·군·구 코드 (디버깅용)
  },
  (t) => ({
    uq: uniqueIndex("ps_uq").on(t.electionId, t.sigunguCode, t.name),
    emdIdx: index("ps_emd_idx").on(t.electionId, t.emdCode),
  }),
);

export const pollingStationVotes = pgTable(
  "polling_station_votes",
  {
    stationId: bigint("station_id", { mode: "number" })
      .notNull()
      .references(() => pollingStations.id, { onDelete: "cascade" }),
    partyId: text("party_id").references(() => parties.id), // null 허용 (raw_name fallback)
    rawName: text("raw_name").notNull(),                     // 매핑 실패 대비 원문 보관
    votes: integer("votes").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.stationId, t.rawName] }) }),
);

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

**키 정책 메모**
- 자연키 = `(election_id, sigungu_code, name)`. ourstory `elections` 가 이미 race 별로 분리되어 있어 race 정보는 `electionId` 에 내포 — 별도 race 컬럼 불필요.
- 시계열 비교: 다른 선거의 station을 `(sigungu_code, name)` 으로 JOIN — best-effort. 매칭 안 되면 NULL/gap. renumber 명시 보정은 본 Phase에 없음.
- `raw_name` 을 PK 에 포함 = 같은 station 안에서 정당명 중복(서로 다른 매핑 alias) 충돌 방지. partyId 는 별도 인덱스로 보강.

## NEC 엔드포인트 매핑

```
POST http://info.nec.go.kr/electioninfo/electionInfo_report.xhtml
Content-Type: application/x-www-form-urlencoded

electionId      = "0000000000" (역대) | "0020250603" (최근)
requestURI      = "/electioninfo/{electionId}/vc/vccp08.jsp"
topMenuId       = "VC"
secondMenuId    = "VCCP08"
menuId          = "VCCP08"
statementId     = "VCCP08_#1"
electionType    = "1" (대통령) | "2" (국회) | "4" (지방)
electionName    = YYYYMMDD (선거일, 역대 모드에서 필수)
electionCode    = 1·3·4·5·6·7·8·9·11 (race)
cityCode        = NEC 4자리 시·도 코드
townCode        = NEC 4자리 시·군·구 코드
searchMode      = "1"
```

townCode 목록은 `selectbox_townCodeJson.json?electionId={electionId}&cityCode={cityCode}` 로 동적 조회. cityCode 17개는 정적 상수.

**호출 단위 (necCode 별)**:
- necCode 1 (대통령), 3 (광역단체장), 11 (교육감): 시·도 단위 — townCode 안 보냄 (또는 -1)
- 그 외 (2·4·5·6·7·8·9): 시·군·구 단위 — 모든 townCode 순회

`electionCode` 는 `elections.necCode` 컬럼에서 그대로 사용.

## 페이즈 분해

각 phase 가 별도 PR. 단위 테스트로 게이트.

| Phase | 산출물 | 의존 | 검증 |
|-------|--------|------|------|
| **5.0 스키마** | drizzle 마이그레이션 + RLS 정책 + verify-schema 통과 | — | `pnpm verify:schema` 가 11개 테이블 확인 (기존 8 + 신규 3) |
| **5.1 파서** | `parse-polling-stations.ts` + `lib/nec-html.ts` 확장 + 단위 테스트 | 5.0 | 실제 HTML fixture 4종(2025대선·2024총선지역구·2022지선광역비례·2020총선비례) 각 3 케이스 PASS |
| **5.2 fetcher** | `fetch-polling-stations.ts` (동시성 5, 재시도 3, 6s 타임아웃, raw 캐시) | 5.1 | 2025 대선 단일 race 호출 → raw 디렉터리에 17 시·도 파일 생성 |
| **5.3 ingest 검증** | `ingest-polling-stations.ts` + `2025-presidential` 단일 적재 | 5.2 | station 수 ≈ 14k ±10%; 매핑률 ≥95%; vote_totals 시·도 합 cross-check ±0.5% |
| **5.4 전체 파일럿** | 12 electionId 전부 적재 + 리포트 | 5.3 | Phase 5.3 검증 게이트 12 electionId 전부 통과 |

각 phase 의 `writing-plans` 산출물은 본 spec 승인 후 별도 작성.

## 검증 게이트 (Phase 5.4)

다음 전부 PASS 시 PoC 성공:

1. **Station 수 sanity** — electionId 별 `count(*) WHERE kind='station'` 가 알려진 한국 투표소 수(약 14,000) ±10% 이내
2. **정당 매핑률** — `polling_station_votes` 의 `partyId IS NOT NULL` 비율 ≥95%
3. **합산 cross-check** — electionId 별 `polling_station_votes` 정당별 합 = 기존 `vote_totals` 같은 electionId · 시·도 정당별 합 ±0.5%
4. **단위 테스트** — 신규 12개 이상 PASS (파서 4 fixture × 3 케이스)
5. **레퍼런스 스팟체크** — 임의 5 투표소를 NEC 웹 페이지 직접 확인과 일치

## 오류 처리

- **NEC HTTP 오류 (5xx, abort)**: 지수 백오프 재시도 3회 (1s → 2s → 4s). 최종 실패 시 결과에 `failedTowns: string[]` 누적, electionId 종료 시 0개 아니면 exit 1
- **빈응답 ("검색된 결과가 없습니다")**: 정상 종료. 0건 적재, 로그에 "no-data" 표시 (해당 시·도에 race 미실시 등 정상 사유)
- **정당명 매핑 실패**: `party_id = NULL` + `raw_name` 보관. electionId 마지막에 매핑률 리포트
- **station 명 중복 (같은 sigungu 안)**: NEC 응답 이상. 첫 row warn 로그 + 두 번째 row 부터 skip

## CI / 운영

- 본 fetcher 는 cron 아님. 수동 실행 (`pnpm tsx scripts/ingest/fetch-polling-stations.ts <electionId>`)
- raw HTML 은 `data/raw/polling-stations/` 캐시. `--refresh` 플래그로 강제 재요청
- Vercel 빌드/배포 영향 없음 (스크립트만)

## 다음 Phase 후보 (참고)

- Phase 6: UI 드릴다운 (`/region/[code]` 또는 `/election/[id]/region/[code]` 안에 emd → station 표)
- Phase 7: 2014~2019 옛 선거 확장
- Phase 8: 시계열 station 매핑 override 테이블 + jp-in-gn 패턴의 EmdTable 이식
- 옛 시기 partyId 매핑률 보강 (현재 평균 64% → 95%)은 본 Phase 와 독립적 잡일로 진행 가능
