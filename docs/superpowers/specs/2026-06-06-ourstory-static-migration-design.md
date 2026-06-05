# ourstory 정적 JSON 마이그레이션 설계

## 배경

ourstory 는 현재 Supabase Postgres + Next.js 16 RSC 로 구성. RSC 페이지 매 요청마다 SQL 쿼리. 사용자가 다른 Supabase 프로젝트 2개 활성 (free tier 한도 점유) — 본 프로젝트는 유료 전환 필요. 라이브 개표 페이지는 폐기 결정 (Phase 4 GitHub Actions 자동화 무효화).

## 목표

1. **Supabase 제거** — 호스팅 = Vercel 만 (정적). DB 운영 비용 0.
2. **station-level 데이터 유지** — 사용자 명시: 대선·총선·보궐 투표소까지 시계열 drill-down 가능해야 함.
3. **NEC 다운로드 xlsx 를 raw source 로 사용** — archive HTML endpoint 가 합계만 주는 한계 우회. xlsx 는 station × 정당/후보자 분해 완전 데이터.
4. **라이브 코드 전면 폐기** — Phase 4 (GitHub Actions, /live 페이지, poll-live 등).

## 데이터 소스 (확정)

raw HTML (NEC archive endpoint) 대신 **NEC 다운로드 메뉴 xlsx** 를 표준 소스로:

| 선거 | 파일 | xlsx 형식 |
|---|---|---|
| 대선 2012 | `presidential-2012/source.xls` | D형 (시·도 row 컬럼) |
| 대선 2017 | `presidential-2017/source.xlsx` | C형 (header row[0]) |
| 대선 2022 | `presidential-all/source.xlsx` | C형 |
| 대선 2025 | `presidential-2025/source.xlsx` | A형 |
| 총선 2024 (지역구·비례·재보궐) | `22-general/01~05.xlsx` | A형 |
| 총선 2020 (지역구·비례·재보궐) | `general-2020/*/*.xlsx` (시·도×시·군·구 분리) | B형 (시트 메타에 region) |
| 총선 2016 (지역구·비례·재보궐) | `general-2016/*/*.xlsx` (분리) | B형 |
| 총선 2012 (지역구·비례) | `general-{district,prop}-2012/*/*.xls` (분리) | B형 |
| 재보궐 2015 상·하반기 | `byelection-2015-h{1,2}/*.xls` | B형 |
| 재보궐 2022 | `byelection-2022/*.xlsx` | C형 |
| 지선 (4-8회) | NEC archive VCCP04 응답 (emd-level 만) | 별도 처리 — station-level 없음 |
| 대선 2007 / 총선 2008 | (NEC 다운로드 미수신) — archive HTML 폴백 | E형 |

xlsx 형식별 parser:
- **A형** — row[3] header (시도·구시군·읍면동·투표타입·선거인수·투표수·후보자별 득표수·계·무효·기권), row[4] 후보자명 ("정당명\n후보자명"), row[5+] 데이터
- **B형** — 동일 row[3] 헤더이나 시·도/시·군·구 정보는 시트 메타 (`[국회의원선거][전라남도][영암군]`) 또는 파일명. row[3] = (읍면동·투표구·선거인수·투표수·...). row[4] 정당/후보자명
- **C형** — row[0] 한 줄에 헤더 + 후보자명 합침 (시도·구시군·읍면동·투표구·선거인수·투표수·후보자명들·계·무효·기권). row[1+] 데이터
- **D형** — A형과 유사하나 시·도 컬럼이 row 안에 있고 컬럼 갯수 적음 (2012 .xls)
- **E형 (archive HTML 폴백)** — 미수신 election 만 적용

## 아키텍처

```
data/raw/nec-downloads/     # NEC 다운로드 xlsx (raw source)
       ↓ scripts/build/parse-nec-xlsx.ts (형식별 parser)
data/parsed/{electionId}/{regionId}.json  # 중간 형식 (station 단위 row)
       ↓ scripts/build/build-static.ts (region 합산·시계열 precompute)
data/static/                # 배포용 정적 JSON
   ├ index.json              # election list + 메타
   ├ region/
   │   ├ {regionCode}.json   # region core: 정의, 메타, 시계열, election summary (시·군·구·읍면동 단위)
   │   └ {regionCode}/
   │       └ election-{id}.json  # 해당 region × 해당 election detail (정당별·후보자별 row)
   └ station/
       └ {sigungu}-{emd}-{stationKey}.json  # station 단위 lazy load (drill-down 시만 fetch)
```

빌드 흐름 (이전 ingest pipeline 대체):
1. **fetch (수동)** — NEC 다운로드 메뉴 zip/xlsx 사용자가 받음. 자동 fetch 미지원 (NEC 다운로드 URL 은 인증·세션 필요).
2. **parse** — xlsx → 중간 JSON (raw station rows + 메타).
3. **build** — 중간 JSON → 정적 chunk 생성. region 합산·시계열·prevShare 등 precompute.
4. **deploy** — Vercel static (`/public/data/`).

## Chunk schema

### `data/static/index.json`

```json
{
  "version": "2026-06-06",
  "elections": [
    { "id": "2024-general", "name": "제22대 국회의원선거", "date": "2024-04-10", "type": "general", "isByelection": false, "hasStationLevel": true, "displayOrder": 12 },
    ...
  ],
  "parties": [
    { "id": "justice", "name": "정의당", "color": "#FFCC00", "family": "justice" },
    ...
  ],
  "regions": {
    "sido": [ { "code": "1100000000", "name": "서울특별시" }, ... ],
    "sigunguByRegion": { "1100000000": [ { "code": "1111000000", "name": "종로구" }, ... ] }
  }
}
```

홈/Header 전역 옵션 (정당 필터, region picker 의 시·도/시·군·구 목록) 이 한 fetch 로 해결.

### `data/static/region/{regionCode}.json`

```json
{
  "code": "1111000000", "name": "종로구", "level": "sigungu",
  "parent": { "code": "1100000000", "name": "서울특별시" },
  "children": [ { "code": "1111051500", "name": "청운효자동", "level": "emd" }, ... ],
  "timeseries": {
    "justice":      [ { "electionId": "2024-general-prop", "votes": 1234, "totalVotes": 89000, "share": 1.39 }, ... ],
    "democratic":   [ ... ],
    ...
  },
  "elections": [
    {
      "electionId": "2024-general",
      "totalVoters": 126041, "totalVotes": 88779, "validVotes": 87809, "invalidVotes": 970,
      "byParty": [ { "partyId": "democratic", "votes": 44713, "share": 50.92 }, ... ],
      "byKind": { "el_day": ..., "presub": ..., "abs": ..., "absentee": ..., "overseas": ... }
    },
    ...
  ]
}
```

페이지 `/region/{code}` 가 단일 fetch 로 모든 view 렌더. `level` 별로 children 갯수 다름.

### `data/static/region/{regionCode}/election-{id}.json`

```json
{
  "regionCode": "1111000000", "electionId": "2024-general",
  "candidates": [ { "rawName": "더불어민주당\n곽상언", "partyId": "democratic", "votes": 44713 }, ... ],
  "rowsByEmd": [
    {
      "emdName": "청운효자동", "emdCode": "1111051500",
      "kind_rows": [
        { "kind": "el_day", "name": "청운효자동제1투", "voters": 1234, "votes": 1100, "valid": 1080, "invalid": 20, "byParty": [{"partyId":"democratic","votes":600}, ...] },
        { "kind": "presub", "name": "관내사전투표", "voters": 500, ... },
        ...
      ]
    },
    ...
  ]
}
```

선거 상세 페이지 (지역구별 후보자 표, presub/el_day 분리) 가 이 파일로 렌더.

### `data/static/station/{sigungu}-{emd}-{stationKey}.json`

```json
{
  "stationKey": "1111000000-1111051500-청운효자동제1투",
  "name": "청운효자동제1투",
  "emdName": "청운효자동", "sigunguName": "종로구", "sidoName": "서울특별시",
  "timeseries": {
    "justice":    [ { "electionId": "2024-general-prop", "votes": 18, "totalVotes": 1080, "share": 1.67 }, ... ],
    "democratic": [ ... ],
    ...
  }
}
```

station 단위 시계열 drill-down — 사용자가 station 선택 시 lazy fetch (~수 KB).

## 페이지별 fetch 패턴

| Page | URL state | Fetch 대상 |
|---|---|---|
| 홈 (시계열) | `region={code}&parties={ids}` | `index.json` + `region/{code}.json` (시계열 view) |
| 지역 상세 | `/region/{code}` | `region/{code}.json` |
| 선거 상세 | `/election/{id}` | `region/{rootCode}.json` 메타 + 필요 region 의 `election-{id}.json` |
| 투표소 drill-down | `region=station:{key}` | 위 + `station/{key}.json` |

## Migration 흐름

1. **Phase 1 — 파일 수신 + parser 작성**
   - NEC 다운로드 xlsx 5 형식 (A·B·C·D·E) parser 작성
   - 미수신 (2007 대선·2008 총선) 은 archive HTML 폴백 (parseVccp08Stations 기존 활용)
   - 단위 테스트: 각 형식 fixture × 5
   - 산출물: `data/parsed/{electionId}.json`

2. **Phase 2 — build-static**
   - parsed → 정적 chunk (region 합산·시계열·byKind 계산)
   - `data/static/` 에 index/region/election/station 파일 생성
   - 단위 테스트: 합계 일치·timeseries 정렬 확인

3. **Phase 3 — RSC → 정적 import 전환**
   - `src/lib/queries.ts` 의 SQL 함수들을 정적 JSON import 함수로 교체
   - 페이지 (`page.tsx`, `region/[code]/page.tsx`) generateStaticParams 사용
   - 라이브 페이지 (`live/page.tsx`) + Phase 4 (`.github/workflows/poll-live.yml`) 전면 제거
   - DB 의존 코드 (`db-admin.ts`, drizzle config, schema) 보존 (parser 가 schema 참조 안 함) but 실행 코드는 제거

4. **Phase 4 — 배포 + Supabase 정리**
   - Vercel 배포 + 동작 확인
   - DB dump 백업 후 Supabase 인스턴스 삭제

## Removal scope (정적 마이그레이션 후 제거)

| 항목 | 제거 |
|---|---|
| Supabase Postgres | ✓ |
| `src/lib/db.ts`, `src/lib/db-admin.ts` | ✓ |
| `db/schema.ts` (런타임), `drizzle.config.ts` | ✓ (참고용으로만 git 보존) |
| `src/app/live/page.tsx`, `src/components/LiveBoard.tsx` | ✓ |
| `.github/workflows/poll-live.yml`, `scripts/ingest/poll-live.ts` | ✓ |
| `scripts/ingest/ingest-*.ts` (DB ingest) | ✓ (정적 build script 로 대체) |
| `src/lib/queries.ts` 의 SQL 함수 | 정적 import 로 재구현 |

## 보존

| 항목 | 보존 |
|---|---|
| `data/raw/nec-downloads/` | xlsx 원본 |
| `data/parsed/` (신규) | 중간 JSON |
| `data/static/` (신규) | 배포용 정적 |
| `data/seed/parties.json`, `data/seed/election-party-overrides.json` | parser 매핑용 |
| `src/components/*` (UI) | 컴포넌트 props 만 정적 데이터 형식으로 조정 |

## 테스트 전략

- **xlsx parser 단위 테스트** — 형식별 fixture (작은 region 1개) × 5 (A·B·C·D·E)
- **build-static 검증** — region 합계 = sum of children, election byParty 합 = totalVoters check
- **page snapshot** — 주요 페이지 (홈·region detail·선거 상세) → SSG 결과 비교
- **station lazy fetch** — drill-down 동작 확인 (개별 station 페이지 1건)

## 가정·제약

- 새 election (선거일 후) 추가 = 수동 xlsx 다운로드 → parse → build → commit + redeploy. 라이브 X.
- station-level 시계열 = station 단위 lazy load. emd/sigungu 단위 시계열은 region/{code}.json 안 inline (1 fetch 면 충분).
- 데이터 규모 추정: parsed 100MB · static 200MB (region 합 + station 분리). Vercel free static host 한도 (100GB/월 bandwidth) 충분.
- 지선 (4-8회) 은 emd-level 만 — station 페이지에서 지선 선택 시 "emd 이하 미지원" 표시.
- 2002 대선 station 데이터 없음 — emd 까지만.
- 미수신 (2007 대선·2008 총선) 은 archive HTML 폴백 — 매핑률 알려진 수준 (97%·100%).

## 후속 (out of scope)

- 자동 fetch (NEC 다운로드 URL 직접 호출) — 인증 회피 어려움. 수동.
- 4-8회 지선 station-level — 데이터 자체 없음. 추가 source 발견 시.
- 2007 대선 + 2008 총선 xlsx 추가 수신 시 archive HTML 폴백 → xlsx 로 교체.
