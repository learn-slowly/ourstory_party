# ourstory — 지역(읍·면·동) 시계열 표 보강 설계

작성일: 2026-06-07
대상 repo: `learn-slowly/ourstory_party`
선행: Phase 1.2 (홈 시계열) · Phase 1.3 (`/region/[code]`) · `feat: 시계열 표(엑셀형) 보기 + CSV 다운로드` (a541f7f)

## 동기

홈(`/`)은 이미 시·도→시·군·구→읍·면·동→투표소 cascading picker + 차트/표 토글 + CSV 다운로드를 갖고 있다. 그러나 `/region/[code]` 지역 상세 페이지는 정의당 한 정당만 보여주는 미니 차트(`RegionMiniSeries`)에 그친다. 정의당 경남도당 내부 회의에서 "월산동 정의당 시계열 보여줘"·"이 동의 노동당·녹색당까지 같이"·"표로 내려받아 줘" 같은 요청을 받았을 때, 사용자가 홈 picker로 다시 돌아가지 않고 region URL에서 곧장 풍부한 시계열 표를 볼 수 있어야 한다.

이 작업은 새 데이터 생성 없이 기존 정적 chunk(`region/{code}.json`의 `timeseries` 필드)와 `buildHomeChart` 함수를 region 페이지에서 재사용하는 통합 작업이다.

## 범위

- 홈(`/`)에서 차트/표 토글 + CSV 버튼 묶음을 `TimeseriesPanel`로 추출. 동작 변화 없음.
- `HeaderControls`에 `hideRegionPicker?: boolean` prop 추가.
- 신규 `RegionTimeseries` client 컴포넌트 — 풀 컨트롤(정당/유형/연도/위성/진보) + 차트/표 + CSV. 지역 picker만 숨김.
- `/region/[code]` 페이지의 `RegionMiniSeries` → `RegionTimeseries`로 교체.
- URL 양방향 보존: ElectionPicker의 `?election=` ↔ 시계열 필터(`?types=&parties=&satellite=&merge_prog=&from=&to=`).

## 비목표

- 새 데이터 페치·파서 작업 없음 (`region/{code}.json`의 `timeseries`만 사용).
- 정의당 외 정당의 미니 차트 추가 없음 (RegionMiniSeries는 삭제).
- station(투표소) 단위 region 페이지 추가 없음 — station은 홈 picker로만 접근.
- 새 URL 스킴 도입 없음 (홈과 같은 쿼리 키 재사용).

## 컴포넌트 구조

```
[ / 홈 ]                                  [ /region/[code] ]
   │                                          │
   ├─ HomeView (client)                       ├─ RegionView
   │   ├─ HeaderControls                      │   ├─ Breadcrumb + h1 + ElectionPicker
   │   ├─ TimeseriesPanel  ◀── 신규 추출      │   ├─ RegionPartyDist
   │   └─ StatsCards                          │   ├─ RegionChildrenTable
   │                                          │   ├─ PresubVsElDay
   │                                          │   └─ RegionTimeseries  ◀── 신규 (이전 RegionMiniSeries)
   │                                          │       ├─ HeaderControls (hideRegionPicker)
   │                                          │       └─ TimeseriesPanel  ◀── 동일 컴포넌트
   │                                          │
   └─ buildHomeChart ─────────────────────────┴─ buildHomeChart (동일 함수)
```

## 컴포넌트 인터페이스

### 신규: `TimeseriesPanel` (`src/components/TimeseriesPanel.tsx`)

```ts
interface Props {
  data: ChartRow[];
  lines: ChartLine[];
  csvFilename?: string;  // default "timeseries.csv"
}
```

내부:
- `viewMode` 컴포넌트 로컬 상태 (URL 비동기화). 현 HomeView 동작 그대로.
- 렌더: 차트/표 토글 버튼 그룹 + `viewMode === "table"`일 때 CSV 버튼 + `HomeChart` 또는 `HomeTable`.
- `data.length === 0`이면 CSV 버튼 숨김(기존 동작 유지).
- CSV 파일명: 홈은 default(`timeseries.csv`), region은 `timeseries-{regionName}.csv`.

### 수정: `HeaderControls`

```ts
interface Props {
  // 기존 props 모두 유지
  hideRegionPicker?: boolean;  // 신규
}
```

- `hideRegionPicker=true`면 4단 cascading select 블록(`<label>지역 ...`)만 렌더 안 함.
- 그 외 controls(선거유형/정당/위성/진보/기간)는 그대로.
- `emdOptions`/`stationOptions` props도 그대로 받음 — `hideRegionPicker=true`일 때 사용 안 함, 호출자가 빈 배열을 넘겨도 무방.

### 신규: `RegionTimeseries` (`src/components/region/RegionTimeseries.tsx`)

```ts
interface Props {
  regionCode: string;
  regionName: string;
  timeseries: Record<string, TimeseriesPoint[]>;  // RegionFile.timeseries
  initialState: HomeState;                         // state.region은 무시
  filterOptions: {
    types: string[];
    parties: PartyOpt[];
    yearOptions: string[];
  };
  elections: ElectionMeta[];
  parties: PartyMeta[];
}
```

내부:
- `"use client"`
- `optimisticState` useState — initialState로 시드, useEffect로 server-pushed initialState와 sync.
- `useMemo(buildHomeChart, [state, sources, elections, parties])` — 즉시 재계산.
  - `sources = [{ timeseries }]` (단일 source).
- `handleChange(next)`:
  - `setOptimisticState(next)`
  - `encodeState(next)` → `qs`
  - 현재 URL의 `?election=` 보존 → `URLSearchParams`로 병합
  - `startTransition → router.push(/region/{regionCode}?{merged})`
- 렌더: `<HeaderControls hideRegionPicker ... /> + <TimeseriesPanel csvFilename={`timeseries-${regionName}.csv`} ... />`

### 수정: `/region/[code]/page.tsx`

추가:
```ts
import { parseSearchParams, DEFAULT_STATE } from "@/lib/url-state";
import { buildFilterOptions } from "@/lib/static-series";
```

`buildRegionTimeseries` 호출 삭제. 대신:
```ts
const flat: Record<string, string | undefined> = {};
for (const [k, v] of Object.entries(sp)) {
  flat[k] = Array.isArray(v) ? v[0] : v;
}
const raw = parseSearchParams(flat);
const initialState: HomeState = { ...raw, region: DEFAULT_STATE.region };

const filterOptions = buildFilterOptions({
  parties: index.parties,
  elections: index.elections,
  sido: index.regions.sido,
  sigunguByRegion: index.regions.sigunguByRegion,
});
```

`RegionView`에 `initialState`, `filterOptions`, `regionFile.timeseries`, `index.elections`, `index.parties` 추가 전달.

### 수정: `RegionView` (`src/components/region/RegionView.tsx`)

- `series: SeriesPoint[]` prop 제거.
- 새 prop: `timeseries / initialState / filterOptions / elections / parties`.
- 마지막 섹션 `<RegionMiniSeries />` → `<RegionTimeseries />`.

### 수정: `HomeView` (`src/components/HomeView.tsx`)

- 차트/표 토글 + CSV 버튼 + HomeChart/HomeTable 인라인 JSX(현 `flex items-center gap-1` 블록 + `{viewMode === "chart" ? ... : ...}`) → `<TimeseriesPanel data={data} lines={lines} />`로 교체.
- 동작 변화 없음.

### 수정: `ElectionPicker` (`src/components/region/ElectionPicker.tsx`) / `election-picker-url.ts`

ElectionPicker가 선거를 바꾸면 시계열 필터 쿼리(`?parties=...`)가 사라지면 안 됨. `setElectionInUrl` 헬퍼에서 기존 searchParams의 시계열 키들을 보존하도록 패치:

```ts
const params = new URLSearchParams(searchParams.toString());
params.set("election", electionId);
// 기존 키들은 자동 보존됨 — toString()으로 복사했으므로
```

기존 구현이 어떤 방식인지에 따라 한 줄 수정으로 끝날 수도 있고, 명시적 패치가 필요할 수도 있음(구현 단계에서 확인).

### 삭제

- `src/components/region/RegionMiniSeries.tsx`
- `src/lib/static-region.ts`의 `buildRegionTimeseries` 함수
- 관련 단위 테스트 (있다면 — 구현 단계에서 확인)

## 데이터 흐름

```
RegionPage (server, RSC)
  │
  ├─ getIndex() ─ { elections, parties, regions }
  ├─ getRegionFile(code) ─ regionFile (timeseries 포함)
  ├─ buildFilterOptions(...) ─ types/parties/yearOptions
  ├─ parseSearchParams(flat) → raw → state.region = "all"로 정규화
  └─ <RegionView ... + initialState + filterOptions + timeseries + elections + parties />
        │
        └─ <RegionTimeseries> (client)
              │
              ├─ useState(initialState)
              ├─ useMemo(buildHomeChart, [state, [{timeseries}], elections, parties])
              ├─ <HeaderControls hideRegionPicker state onChange={handleChange} />
              └─ <TimeseriesPanel data lines csvFilename />
```

사용자 토글 → `setOptimisticState` 즉시 → `useMemo` 재계산 → 차트/표 즉시 갱신 → `router.push(qs)` 비동기 URL 갱신. 서버 roundtrip 없음.

## URL 상태

홈과 region 페이지가 **동일한 쿼리 키**를 공유:

| 키 | 의미 | 비고 |
|----|------|------|
| `types` | 선거유형 필터 | 콤마 구분, 기본값(전체)일 때 생략 |
| `parties` | 정당 필터 | 콤마 구분 |
| `satellite` | 위성 합산 모드 | `split` / `merged` |
| `merge_prog` | 진보 합산 라인 | `1`이면 켬 |
| `from`, `to` | 연도 범위 | YYYY 4자리 |
| `region` | 지역 코드 | **home 전용. region 페이지는 무시 + 인코딩 시 생략** |
| `election` | 단일 선거 ID | **region 페이지 전용 (ElectionPicker)** |
| `s` | base64url 압축 | 양쪽 다 지원 (기존 동작) |

region URL 예:
```
/region/4817031000?election=20220601&parties=justice,labor,green&satellite=merged&merge_prog=1
```

`state.region` 처리: `parseSearchParams` 직후 `DEFAULT_STATE.region`("all")로 강제 → `encodeState`가 default와 비교해 자동 생략 → URL에서 사라짐.

## 오류 처리

| 상황 | 처리 |
|------|------|
| `regionFile.timeseries`가 비어있음 (옛 emd) | `buildHomeChart`가 `data=[]/lines=[]` 반환 → `HomeTable` "선택된 필터에 해당하는 데이터가 없습니다." (기존) |
| 필터 조합으로 결과 0행 | 위와 동일 |
| 잘못된 `region` 쿼리 | 디코딩 직후 default로 덮어쓰므로 무해 |
| 잘못된 정당 ID (`parties=foo,bar`) | `buildHomeChart`의 `partyById.get`가 undefined → 라인 생성 안 함, 무시 |
| `from > to` 모순 | `HeaderControls`가 입력 시점에 정규화 (기존) |
| `s=...` base64url 깨짐 | `parseSearchParams`가 try/catch로 무시 (기존) |
| ElectionPicker · 시계열 쿼리 충돌 | `handleChange`에서 `election` 보존 / `setElectionInUrl`에서 시계열 키 보존 — 양방향 |
| station 레벨 region 페이지 접근 | `/region/[code]` 는 10자리 코드만 받음 → 기존 `notFound()` 유지 |

## 테스트

### 기존 테스트 영향

- `tests/unit/url-state.test.ts` — 변경 없음
- `tests/unit/series.test.ts` (또는 buildHomeChart 테스트) — 변경 없음, 단일 source도 이미 통과 중
- `buildRegionTimeseries` 함수 삭제 시 관련 테스트 삭제

### 신규 단위 테스트

`tests/unit/header-controls.test.tsx`
- `hideRegionPicker=true` → 지역 select 4개 미렌더
- `hideRegionPicker=true` → 정당/유형/연도/위성/진보 토글은 렌더

`tests/unit/timeseries-panel.test.tsx`
- viewMode 토글 → chart/table 전환 (aria-pressed)
- `data.length === 0` → CSV 버튼 숨김
- `csvFilename` prop이 다운로드 anchor `download` attr에 반영

`tests/unit/region-timeseries-url.test.tsx` (또는 lib 레벨 추출 가능하면 그쪽)
- `handleChange` 호출 시 기존 `?election=` 보존
- `state.region`이 URL에 미인코딩 (default와 같아서 생략)
- ElectionPicker 변경 시 시계열 필터 쿼리 보존

### 스모크 / 수동 회귀

- 홈에서 차트/표 토글 + CSV 다운로드 — 기존 동작 유지
- 홈에서 emd 선택 → 표 보기 → 표시
- `/region/{sido}` (예: `4800000000`) → 시계열 표 + 필터 → 표시
- `/region/{sigungu}` (예: `4817000000`) → 시계열 표 → 표시
- `/region/{emd}` (예: `4817031000`) → 시계열 표 → 표시
- region URL 직접 입력 → 시계열 필터 조작 → URL 동기화 확인
- 공유: 다른 탭에서 같은 URL 열어 동일 상태 복원

## 마이그레이션 / 호환성

- 기존 `/region/[code]` URL은 동작 유지 (새 쿼리 키는 옵셔널, 없으면 default 적용).
- 기존 `?election=` 쿼리는 보존.
- 홈 페이지 동작 100% 동일 (TimeseriesPanel은 순수 추출).

## 작업 추정 (참고)

- Task 1: `TimeseriesPanel` 추출 + HomeView 리팩터 — 30분
- Task 2: `HeaderControls` `hideRegionPicker` prop — 10분
- Task 3: `RegionTimeseries` 컴포넌트 — 40분
- Task 4: `/region/[code]/page.tsx` + `RegionView` 수정 — 20분
- Task 5: ElectionPicker URL 보존 패치 — 15분
- Task 6: 단위 테스트 3개 + 기존 테스트 정리 — 40분
- Task 7: 수동 회귀 (홈 + 3 레벨 region) — 20분

합산: 약 3시간.
