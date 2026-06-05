# ourstory Phase 1.3 — `/region/[code]` 지역 상세 페이지

작성일: 2026-06-05
대상 repo: `learn-slowly/ourstory_party`
선행: Phase 5 (투표소·emd 분해 적재) 8/12 electionId 완료

## 동기

ourstory 가 적재한 polling_station(emd 단위) 데이터 — 특히 관내사전투표 vs 선거일투표 분해 — 는 `vote_totals` 에 없는 새 정보임에도 현재 UI 에서 노출할 곳이 없다. 홈은 시·도 단위 정당별 시계열, `/live` 는 라이브 선거 시·도 그리드만 보여준다. 한 선거 시점에 한 지역(시·도·시·군·구·읍·면·동) 안에서 정당별로 어떻게 흩어졌는지, 그리고 사전·선거일 분포가 어떻게 다른지를 볼 수 있는 페이지가 없다. 이 페이지가 정의당 경남도당 등 내부 전략 회의 대상의 "이 동의 정의당 표는 사전이 많아 / 선거일이 많아" 류 질문에 답한다.

## 범위

URL: `/region/[code]?election=<electionId>`
- `code` — `regions.code` 10자리 (법정동 또는 행정동 synthetic `9XXXXXXXXX`)
- `election` — `elections.id`, 미지정 시 default = 가장 최근 적재된 election

지원 region level 3종 (sido / sigungu / emd) — 동일 URL 패턴 + 자동 감지 + 레벨별 레이아웃 차등.

## 비목표

- 시·도 SVG 지도 — 별도 phase
- 정당명 검색·필터 UI
- emd level 의 개별 polling station(투표소) 표 — 라이브 선거 데이터 미가용
- 다중 선거 동시 비교 (e.g., 2020·2024 나란히)
- 라이브 갱신 (cron 자동 reload)

## 페이지 구조

### Header (모든 레벨 공통)
```
[← 상위] 진주시 ▸ 2024 총선 — 비례대표  [선거 picker ▼]
```
- breadcrumb: sido → sigungu → emd. 클릭 시 상위 page 이동
- 선거 picker: dropdown, 변경 시 `code` 유지 + `election` query 갱신 (push state)
- 위성정당 합산 토글: 기존 Header 전역 토글 그대로. 비례 race 일 때만 활성

### 4 섹션 (콘텐츠는 레벨별 차등)

| 섹션 | sido (예: 4800000000) | sigungu (예: 4817000000) — 메인 케이스 | emd (예: 4817025000 / 9XXX) |
|------|------|------|------|
| **A 정당별 분포** | 시·도 전체 정당별 막대(상위 ~7개) + 정의당 stats card | 시·군 전체 정당별 막대 + 정의당 card + 직전 동일 race 대비 변화 | emd 전체 정당별 막대 + 정의당 card. (비례) 또는 후보자별 (지역구) |
| **B 하위 표** | sigungu 18 행 × 정당 컬럼. 클릭 → sigungu 페이지 | emd 행 × 정당 컬럼. 정의당 컬럼 컬러 그라데이션. 클릭 → emd 페이지 | **숨김** (emd 는 leaf) |
| **C 사전/선거일** | sigungu별 사전투표율 막대 — adapted election 만 | emd × (관내사전 vote share vs 선거일 vote share) — 정의당 라인만 강조, adapted election 만 | 관내사전 vs 선거일 두 막대 묶음 (정당별) |
| **D 정의당 시계열** | 이 시·도 정의당 역대 비례 득표율 (lite homechart) | 이 시·군 정의당 역대 비례 득표율 | 이 emd 정의당 역대 득표율 (가용 election 만) |

### Layout grid
`max-w-5xl mx-auto px-4 py-6` (기존 home page.tsx 와 동일). 섹션 A → B → C → D 세로 순서. 모바일에서 B 표는 horizontal scroll, C 는 height 제한 후 스크롤.

## 데이터 fallback

| 케이스 | 동작 |
|--------|------|
| 지역구 race (necCode=2/6) | A 의 "정당별" 을 "후보자별" 로 — partyId 매핑 색상 그대로, `raw_name` 으로 후보 이름 표시. C 도 후보자별 |
| NEC archive 미공개 election (2022 mayor/council 등) | polling_stations 없음 → C 섹션에 "이 선거는 시·군·구 단위 NEC archive 만 존재" 안내, B 표는 vote_totals 기반 sigungu 단위만 |
| D 시계열 데이터 부족 (emd 일부) | "데이터 없음" 메시지, 빈 차트 안 그림 |
| 정의당 없는 선거 (교육감 등) | focus party = 1위 후보로 fallback (보조) |

## 데이터 흐름

```
URL searchParams ────────► page.tsx (RSC)
                             │
                             ▼ Promise.all
                          queries.ts
                             │
                ┌────────────┼────────────┬─────────────┐
                ▼            ▼            ▼             ▼
       getRegionContext  getRegionDist  getChildrenTable  getRegionTimeseries
       (level 감지)     (섹션 A)        (섹션 B)         (섹션 D)
                                          │
                                          ▼  if polling 있음
                                   getPresubVsElDay (섹션 C)
                             │
                             ▼
                       RegionView.tsx
                       ├ RegionPartyDist (A)
                       ├ RegionChildrenTable (B)
                       ├ PresubVsElDay (C, conditional)
                       └ RegionMiniSeries (D)
```

## 오류·예외 처리

- `code` 가 `regions` 에 없음 → `notFound()` (Next.js 404)
- `code` 길이 ≠ 10 또는 숫자 외 문자 → `notFound()`
- `election` query 가 `elections` 에 없음 → 가장 최근 적재된 election 으로 silently fallback + URL 정정 (replace state)
- `RegionRow` 타입 — drizzle 스키마 `typeof regions.$inferSelect` 재사용

## 새 query 함수 (`src/lib/queries.ts` 에 추가)

```ts
// region.code 로 level 자동 감지 + 부모 chain 조회
export async function getRegionContext(code: string): Promise<{
  region: RegionRow;
  ancestors: RegionRow[];  // [sido, sigungu?]
  children: RegionRow[];   // direct children
  level: "sido" | "sigungu" | "emd";
}>;

// 한 (election, region) 의 정당별 분포 + 카드용 stat
export async function getRegionDistribution(
  electionId: string,
  regionCode: string,
): Promise<{
  rows: { partyId: string; partyName: string; color: string; votes: number; share: number; prevShare: number | null }[];
  totalVotes: number;
  raceKind: "party" | "candidate"; // 지역구는 candidate
}>;

// 하위 지역 표 — region 직접 children 의 정당별 득표 (sigungu 또는 emd)
export async function getRegionChildrenTable(
  electionId: string,
  regionCode: string,
): Promise<{
  children: { code: string; name: string; byParty: Record<string, number>; total: number }[];
  partyColumns: { partyId: string; partyName: string; color: string }[];
}>;

// 사전/선거일 분해 — polling_station_votes 기반 (adapted election 만)
export async function getPresubVsElDay(
  electionId: string,
  regionCode: string,
  scope: "children" | "self",
): Promise<{
  hasData: boolean;
  rows: { regionCode: string; regionName: string; partyId: string; presub: number; elDay: number }[];
}>;

// 이 지역의 정의당(또는 focusPartyId) 역대 시계열 — vote_totals 기반
export async function getRegionTimeseries(
  regionCode: string,
  focusPartyId: string,
): Promise<SeriesPoint[]>;
```

## 새 컴포넌트

```
src/components/region/
  RegionView.tsx          — 컨테이너 (breadcrumb + 4 섹션 조합)
  RegionPartyDist.tsx     — 섹션 A (막대 + 정의당 카드, StatsCards 재활용)
  RegionChildrenTable.tsx — 섹션 B (정렬 가능 표, 정의당 컬럼 그라데이션)
  PresubVsElDay.tsx       — 섹션 C (이중 막대 또는 비교 라인)
  RegionMiniSeries.tsx    — 섹션 D (HomeChart 의 lite — single line)
  ElectionPicker.tsx      — 헤더용 (URL query push state)
```

## 재사용

- `parseSearchParams` 패턴 (HomeView 와 동일)
- `StatsCards` — 정의당 카드 (직전·고점·저점) 재활용
- `HomeChart` — Recharts 패턴 그대로 (RegionMiniSeries 는 props 더 적은 lite 버전)
- 위성정당 합산 토글 — 기존 Header 의 localStorage 상태 그대로 (HeaderControls 동일 useTransition)
- 정당 색상 — `parties.color` 컬럼 그대로
- 정의당 강조 — line `strokeWidth=3`, 막대 outline 강조

## 성능

- RSC: 페이지 export `dynamic = "force-dynamic"` + Supabase 직접 query
- 5 query `Promise.all` 병렬
- 큰 지역(서울 sido) children 표는 페이지네이션 없이 한 페이지 (sigungu 25개·emd 25~30개 OK)
- `revalidate = 0`(force-dynamic) 이므로 매 요청 fresh — 라이브 선거 진행 중에도 즉시 반영 (적재만 되면)

## 검증

- 단위 테스트: 새 query 함수 5개 × 1~2 케이스 (sido/sigungu/emd) + fallback (polling 없는 election)
- 스냅샷 4 케이스: RegionView 렌더
  1. sigungu 비례 (`/region/4817000000?election=2024-general-prop`)
  2. sigungu 지역구 (`/region/4817000000?election=2024-general`)
  3. emd 비례 (`/region/4817025000?election=2024-general-prop`)
  4. polling 없는 sigungu (`/region/4817000000?election=2022-local-mayor`)
- 수동 smoke: `pnpm dev` → Playwright screenshot 4 URL → Recharts 렌더·표 잘림 없음·정의당 강조 시각 확인

## 페이즈 분해 후보 (writing-plans 에서 결정)

| 단계 | 산출물 |
|------|--------|
| 1.3.0 query | queries.ts 의 5 함수 + 단위 테스트 |
| 1.3.1 base layout | page.tsx + RegionView + breadcrumb + ElectionPicker (섹션 A 만, B/C/D placeholder) |
| 1.3.2 section A | RegionPartyDist + 정의당 card |
| 1.3.3 section B | RegionChildrenTable + drill-down 링크 |
| 1.3.4 section C | PresubVsElDay (adapted election 만) |
| 1.3.5 section D | RegionMiniSeries |
| 1.3.6 fallback | 지역구 race 후보자 모드 + polling 없음 메시지 |

## 다음 phase 후보 (참고)

- Phase 1.4 `/election/[id]` 선거 단면 — 본 spec 의 region 변수를 election 변수로 변경한 거울 구조
- Phase 1.5 emd-level polling station 표 (라이브 선거 데이터 수집 후)
- Phase 1.6 PNG 공유·OG 메타 — region 페이지 캡처용
- 시·도 SVG 지도 (별도 phase, 행정구역 polygon 데이터 별도)
