# ourstory — 고급 엑셀형 표 (AdvancedTable) 설계

작성일: 2026-06-07
대상 repo: `learn-slowly/ourstory_party`
선행: `feat: 시계열 표(엑셀형) 보기 + CSV 다운로드` (a541f7f) · `2026-06-07-region-timeseries-design.md` (region 페이지에 시계열 표 통합)

## 동기

현재 표(`HomeTable`)는 행=선거·열=정당·셀=득표율의 단순 정적 그리드다. 정의당 경남도당 내부 회의에서 "정당별로 정렬해서 보고 싶다"·"진주시 안에서 시·군별로 비교해 줘"·"받은 엑셀 그대로 회의 자료에 붙이고 싶다" 같은 요청이 반복된다. 표를 한 단계 끌어올려 — 정렬·필터·검색·셀 강조·고정 행/열 같은 표준 표 인터랙션 + 한 표 안에서 "시계열 단면 ↔ 지역 단면" 모드 토글 + 서식 포함 .xlsx 다운로드까지 — 회의 자리에서 바로 결론을 짚을 수 있는 도구로 만든다.

홈·`/region/[code]` 양쪽에 같은 표 컴포넌트(`AdvancedTable`)가 들어가서, 어느 깊이의 region 을 보더라도 동일한 인터랙션·다운로드 경험을 제공한다.

## 범위

- 신규 `AdvancedTable` (TanStack Table v8 headless) — 정렬·열 가시성·행 필터(검색)·sticky 첫 열/행·셀 조건부 서식·비교 인디케이터·drilldown 링크
- 모드 토글 (시계열 ↔ 지역) — 시계열: 행=역대 선거·열=정당, 지역: 행=region children(1단계 drilldown)·열=정당
- `HomeView`·`RegionTimeseries`가 같은 `AdvancedTable` 사용 — 한 곳 고치면 양쪽 적용
- 다운로드 강화: 기존 CSV 유지 + `exceljs` lazy import 로 서식(.xlsx) 출력. 정당색 헤더·정의당 그라데이션·고정 행/열·소수 1자리 포맷 모두 파일에 반영
- URL 동기: `mode`·`sort`·`parties`·`q` 쿼리 추가. 기존 `region`·`from`·`to`·`merge` 그대로
- 표가 보유하는 region level 범위: 시·도 / 시·군·구 / 읍·면·동까지

## 비목표

- 투표소(station) 단위 표 — 행 1만+. `@tanstack/react-virtual` 가상화 필요, 이번 범위 밖
- 후보자 모드(raceKind=candidate) 표 — 정당 컬럼 모델과 자연스레 안 맞음. RegionTimeseries 가 후보자 race 일 때는 기존 막대 UI 로 fallback
- 셀 편집·계산식·피벗 빌더 — 본 작업은 "읽기 + 정리 + 내보내기" 가 핵심
- AG Grid / Handsontable 류 본격 grid 라이브러리 도입 — 번들·라이선스·디자인 통합 부담
- 차트 모드 변경 — `TimeseriesPanel` 의 차트/표 토글은 그대로, 표 모드만 교체

## 의사결정 요약

| 항목 | 결정 | 이유 |
|---|---|---|
| 표 라이브러리 | `@tanstack/react-table` v8 (headless) | 정렬/필터/가시성 추상화만 빌려오고 마크업·스타일은 우리 통제 → 정의당 #FFCC00·정당색 헤더·조건부 그라데이션 유지 |
| .xlsx 출력 | `exceljs` (dynamic import) | 색·고정 행/열·number format 등 풍부한 서식 지원. 초기 번들 영향 없음 |
| 컴포넌트 배치 | 기존 페이지 안에 강화 (HomeView·RegionTimeseries 공유) | 전용 페이지 분리 비용 > 일관성 이득. URL 한 곳에 통일 |
| 모드 토글 | 시계열 ↔ 지역 (2 모드) | "지역별·시계열로 둘 다 보고 싶다" 요구 직접 반영. 다축 heatmap·피벗 빌더는 과함 |
| 상태 관리 | TanStack Table controlled by HomeView state | URL 동기·CSV·XLSX export 가 같은 상태 재사용. 표 내부에 갇힌 상태 없음 |
| 모드 토글 응답성 | 양쪽 source 한 번에 fetch → client-side 토글 | 이전 fix `bc866cff` 패턴 그대로 — 토글 즉시 반영, 서버 왕복 없음 |
| 정렬·필터 → URL 동기 | 200ms debounce | 빠른 인터랙션과 공유 가능한 URL 양립 |
| 미출마 셀 | `null` → 렌더 `"—"` 회색 | 0 과 구분. 기존 도메인 규칙 유지. 정렬·비교 계산에서도 null 취급 |
| 재보궐(isByelection) | 시계열 모드에서 자동 제외 | jp-in-gn 의 정책과 일관. 지역 모드는 명시 선택 시 표시 |

## 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│ HomeView (홈)  ·  RegionTimeseries (/region/[code])          │
│                                                              │
│  ┌─ 모드 토글 [● 시계열  ○ 지역]                              │
│  ├─ Picker (시계열 모드: 지역 ▾  /  지역 모드: 선거 ▾)        │
│  ├─ 보조 컨트롤: 위성정당 합산 토글 · 기간(연도) 필터          │
│  └─ <AdvancedTable mode rows columns options />              │
│                                                              │
│  (차트 모드 유지 — TimeseriesPanel 의 차트/표 토글 그대로)     │
└──────────────────────────────────────────────────────────────┘
                                                                
┌──────────────────────────────────────────────────────────────┐
│ AdvancedTable                                                │
│  · TanStack useReactTable (sorting · visibility · filter)    │
│  · Header: 정당색 strip + 정렬 화살표 + 가시성 토글 메뉴       │
│  · Body  : 첫 열 sticky · 첫 행 sticky · 조건부 셀 색상        │
│            · 비교 ↑/↓ 인디케이터 (직전 동종 선거 대비)         │
│            · 셀 클릭 → drilldown (지역 모드 → /region/[code]) │
│  · Footer: 행 평균/합계 (옵션 토글)                           │
│  · Toolbar: 검색 입력 · 정당 토글 · CSV · XLSX (lazy)         │
└──────────────────────────────────────────────────────────────┘
        ▲                                ▲
        │                                │
┌───────┴────────────────────┐   ┌───────┴──────────────┐
│ buildTableModel(mode, ctx) │   │ exportXlsx(model)    │
│  순수함수, 양쪽 모드 분기  │   │  lazy import exceljs │
└────────────────────────────┘   └──────────────────────┘
```

## 컴포넌트 단위

```
src/
├─ components/
│  ├─ table/                          ← 신규 폴더
│  │  ├─ AdvancedTable.tsx            🆕 useReactTable + sticky + 조건부 색상
│  │  ├─ AdvancedTable.types.ts       🆕 TableModel·ColumnDef·RowData
│  │  ├─ ModeToggle.tsx               🆕 시계열 ↔ 지역
│  │  ├─ TableToolbar.tsx             🆕 검색·정당 토글·CSV·XLSX·합계
│  │  └─ CellTrend.tsx                🆕 ↑/↓ 비교 인디케이터
│  ├─ HomeView.tsx                    ✏️ ModeToggle·AdvancedTable 통합, URL state 확장
│  ├─ TimeseriesPanel.tsx             ✏️ 표 모드일 때 AdvancedTable
│  ├─ HeaderControls.tsx              ✏️ 모드에 따라 picker 활성/비활성
│  ├─ HomeTable.tsx                   ❌ 삭제 (AdvancedTable 로 대체)
│  └─ region/RegionTimeseries.tsx     ✏️ AdvancedTable wrap (모드 토글 포함)
└─ lib/
   └─ table/                          ← 신규 폴더
      ├─ buildTableModel.ts           🆕 순수함수 (mode,ctx,options) → model
      ├─ buildTableModel.test.ts      🆕 unit
      ├─ exportCsv.ts                 🆕 HomeTable 의 CSV 로직 이관
      ├─ exportXlsx.ts                🆕 lazy import exceljs, 서식 출력
      ├─ exportXlsx.test.ts           🆕 unit (workbook 구조 검증)
      └─ cellFormatting.ts            🆕 정당색·정의당 그라데이션·미출마 등
```

### 새 의존성 (`package.json`)

- `@tanstack/react-table` (~14kb gzip)
- `exceljs` (~80kb gzip, **lazy** — 다운로드 클릭 시에만 로드)

### 새 URL 쿼리 (HomeView · RegionTimeseries 공통)

- `mode=timeseries|region` (기본 `timeseries`)
- `sort=<colId>:asc|desc`
- `parties=...` (가시성, 콤마 구분. 비어 있으면 전체)
- `q=...` (지역 모드 검색)
- 기존 `region`·`from`·`to`·`merge` 그대로 유지 (단, `region` 쿼리는 HomeView 만 — RegionTimeseries 는 path `/region/[code]` 에 region 이 담겨 있어 쿼리 미사용)

## 컴포넌트 인터페이스

### 보조 타입 정의

```ts
type Mode = "timeseries" | "region";

type SortState = { colId: string; dir: "asc" | "desc" };

interface ColumnDef {
  id: string;              // partyId 또는 "rowLabel"
  header: string;          // 표시명 (정당명 또는 "선거"/"지역")
  color?: string;          // 정당색 (parties.json)
  isJusticeParty?: boolean;
  align?: "left" | "right";
}

interface RowData {
  id: string;              // electionId(시계열) 또는 regionCode(지역)
  label: string;           // 행 라벨 (선거명 or 지역명)
  href?: string;           // drilldown 링크
  cells: Record<string, number | null>;  // colId → 득표율 또는 null(미출마)
}

interface ChildrenSnapshot {
  electionId: string;
  parentRegionCode: string;
  children: Array<{
    regionCode: string;
    regionName: string;
    parties: Record<string, number | null>;  // partyId → 득표율
  }>;
}

// TimeseriesSource 는 기존 RegionFile.timeseries 구조 그대로 재사용
// (region-timeseries-design.md 와 같은 타입 — Record<partyId, TimeseriesPoint[]>)
```

### 신규: `AdvancedTable` (`src/components/table/AdvancedTable.tsx`)

```ts
type Mode = "timeseries" | "region";

interface AdvancedTableProps {
  mode: Mode;
  model: TableModel;
  sort: SortState | null;
  visibility: Record<string, boolean>;
  search: string;
  onSortChange: (next: SortState | null) => void;
  onVisibilityChange: (next: Record<string, boolean>) => void;
  onSearchChange: (next: string) => void;
  onCellNavigate?: (rowId: string, colId: string) => void;  // drilldown
  showFooter?: boolean;  // 행 평균/합계
}
```

내부:
- `useReactTable({ data: model.rows, columns: model.columns, state: {...}, on*: ... })`
- 헤더 정렬 화살표·가시성 메뉴, body sticky 클래스, footer 평균/합계
- 셀 렌더는 `cellFormatting.ts` 의 정당색·정의당 그라데이션·미출마 처리 함수 호출
- 셀 클릭은 `onCellNavigate` — HomeView/RegionTimeseries 가 mode 에 따라 라우팅

### 신규: `buildTableModel` (`src/lib/table/buildTableModel.ts`)

```ts
type Mode = "timeseries" | "region";

interface BuildCtx {
  sources: TimeseriesSource[];     // 기존 RegionFile.timeseries
  regionCode: string;
  regionName: string;
  electionId: string;              // 지역 모드 기준 선거
  electionList: ElectionMeta[];
  parties: PartyMeta[];
  childrenSnapshot?: ChildrenSnapshot;  // 지역 모드 전용
}

interface BuildOptions {
  mergeSatellite: boolean;
  dateRange?: { from?: string; to?: string };
}

interface TableModel {
  columns: ColumnDef[];   // 첫 열 = 행 라벨(선거명 or 지역명)
  rows: RowData[];        // cells[colId] = number | null
  meta: { mode: Mode; regionName: string; electionLabel?: string };
}

function buildTableModel(mode: Mode, ctx: BuildCtx, opts: BuildOptions): TableModel;
```

분기:
- `mode === "timeseries"`: rows = 시간순 elections (재보궐 제외), cells = 각 선거×정당의 득표율
- `mode === "region"`: rows = `childrenSnapshot` 의 children. 분기:
  - `regionCode === "all"` → 행 = 17개 시·도
  - sido (10자리 중 뒤 8자리가 0) → 행 = 그 시·도의 시·군·구
  - sigungu → 행 = 그 시·군·구의 읍·면·동
  - emd → 표 비활성, 호출자가 기존 막대 UI 로 fallback (행 단위 = 투표소지만 이번 범위 밖)

  cells = 각 region × 정당의 득표율 (`null` = 미출마)
- 공통: 위성정당 merge, 기간 필터, 미출마 = `null`, 정의당 항상 포함 + 첫 컬럼 위치

### 신규: `exportCsv` / `exportXlsx` (`src/lib/table/`)

```ts
function exportCsv(model: TableModel, filename: string): void;  // UTF-8 BOM, 따옴표 escape
async function exportXlsx(model: TableModel, filename: string): Promise<void>;
// 내부: const { default: ExcelJS } = await import("exceljs");
// Workbook → sheet (mode 별 시트명)
// 헤더 fill = 정당색 (parties.json)
// 정의당 컬럼 fill = #FFCC00 알파 그라데이션
// view.frozen = { ySplit:1, xSplit:1 }
// 셀 numFmt = '0.0' (미출마는 빈 셀)
```

### 수정: `HomeView` (`src/components/HomeView.tsx`)

- `mode` state 추가 + URL 동기
- 두 source 미리 fetch (page.tsx 에서 props 로) → 토글 시 client-only 재렌더
- 표 모드일 때 `TimeseriesPanel` 안에서 `AdvancedTable` 사용 (차트 모드는 기존 `HomeChart` 그대로)
- ModeToggle·TableToolbar 컨트롤 + URL 동기 setter 들

### 수정: `RegionTimeseries` (`src/components/region/RegionTimeseries.tsx`)

- 같은 `AdvancedTable` wrap
- 시계열 모드 = 해당 region 의 역대 표 (현 동작)
- 지역 모드 = 그 region 의 children 표 (`childrenSnapshot` 필요 — `/region/[code]/page.tsx` 가 추가 fetch)
- raceKind=candidate 인 경우 표 미지원 → 기존 막대 UI fallback

### 수정: `HeaderControls`

- mode 에 따라 picker 활성/비활성 (시계열 모드: 지역 picker, 지역 모드: 선거 picker)
- 보조 컨트롤(위성·기간) 은 양 모드 공통

## 데이터 흐름

```
URL  ?mode=region&region=4817&election=2024-general&sort=정의:desc&parties=정의,진보,민주,국힘
 │
 ▼
page.tsx (RSC)
 ├─ 항상 fetch: regionMeta · electionList · region.json (현재 region 의 역대)
 ├─ mode=region 일 때 추가: childrenSnapshot (선택된 선거의 children 정당 분포)
 └─ Props: { mode, sources, regionMeta, electionList, childrenSnapshot? }
 │
 ▼
HomeView (client) ─────────────────────────────────────────────┐
 ├─ useState: mode, partyVisibility, sort, search, ...          │
 ├─ useEffect: URL ↔ state (mount + popstate)                   │
 │                                                              │
 │   ┌─ ModeToggle.onChange ── setMode + startTransition(push) │
 │   ├─ HeaderControls ─────── setRegion/setElection (server roundtrip │
 │   │                          만 region/election 바뀔 때)     │
 │   └─ TableToolbar ───────── setSearch/setVisibility/setSort  │
 │                                                              │
 │  model = useMemo(() => buildTableModel(...), [...deps])      │
 │                                                              │
 ▼                                                              │
AdvancedTable (controlled by TanStack Table) ──────────────────┘
 ├─ sorting, columnVisibility, globalFilter ← HomeView state
 ├─ onChange ── HomeView setter (URL 동기, 200ms debounce)
 ├─ cell renderer: cellFormatting.ts
 └─ row/cell click: 시계열 모드 → /elections/[id], 지역 모드 → /region/[code]

다운로드
 ├─ CSV : exportCsv(model, filename)        — 동기, 즉시
 └─ XLSX: const { default: ExcelJS } = await import('exceljs')
          exportXlsx(model, filename)       — 첫 클릭 시 lib 로드 (~100ms)
```

원칙:
1. **모드 토글은 client-side 만** — 서버 왕복 없음
2. **region/election picker 만 서버 왕복** — `startTransition` 으로 optimistic
3. **TanStack Table 은 controlled** — URL·CSV·XLSX 가 같은 상태 재사용
4. **URL 동기는 200ms debounce** (mode·region·election 은 즉시)
5. **순수함수 `buildTableModel`** — UI 와 export 가 같은 model
6. **export 는 표시된 행만** — 정렬·필터 적용된 결과를 그대로 파일로

## 에러·엣지케이스

| 케이스 | 처리 |
|---|---|
| 미출마 셀 | `null` → `"—"` 회색. 정렬·비교 계산에서도 null 취급 |
| NEC archive 미공개 election (polling 미공개) | 시계열 모드: 그 행 표시 + 셀 `"—"`. 지역 모드: 빈 상태 메시지 |
| 빈 결과 (region 데이터 0건, 검색 0건) | inline 빈 상태 + 액션 ("필터 지우기" · "전체 보기") |
| 위성정당 (2020·2024) | 기존 `merge` 토글 동작 그대로. cellFormatting 에서 색·이름 처리 |
| 재보궐(isByelection) | 시계열 모드에서 자동 제외. 지역 모드는 명시 선택 시 표시 |
| xlsx 동적 import 실패 | TableToolbar 의 XLSX 버튼 옆에 inline 에러 메시지 "엑셀 라이브러리 로드 실패 — CSV 로 받아보세요" 표시 + 콘솔 원인 로그. ourstory 에 toast 라이브러리 없어 inline 으로 통일 |
| URL ↔ state race (popstate / 외부 navigation) | URL 우선, TanStack 내부 상태 덮어쓰기 (useEffect deps 에 URL state 포함) |
| 숫자 포맷 | 소수점 1자리(`5.3%`). 0.0 과 미출마(`"—"`) 시각적으로 구분 |
| 후보자 모드 (raceKind=candidate) | 이번 범위 제외. RegionTimeseries 가 fallback 으로 기존 막대 UI |
| 투표소 단위(행 1만+) | stretch — `@tanstack/react-virtual` 추가 필요, 별도 작업 |
| 모바일 좁은 화면 | 첫 열 sticky 유지 + 가로 스크롤. TableToolbar wrap. 정당 가시성은 dropdown 으로 접힘 |

## 테스트 전략

### Unit (Vitest, `src/lib/table/**`)

- `buildTableModel.test.ts`
  - 시계열 모드 rows·cols·cells
  - 지역 모드 rows·cols·cells (drilldown 1단계)
  - 위성정당 merge 토글
  - 기간(from/to) 필터
  - isByelection 제외 (시계열 모드)
  - 미출마 셀 = `null` (0 과 구분)
  - 정의당 항상 포함 + 컬럼 정렬 최상위
- `cellFormatting.test.ts`
  - 정의당 셀 그라데이션 (#FFCC00 계열)
  - 정당색 헤더 (parties.json alias 통합)
  - 미출마 → `"—"` 회색
- `exportCsv.test.ts`
  - UTF-8 BOM · 따옴표 escape · 파일명 패턴
- `exportXlsx.test.ts`
  - Workbook → 1 sheet (mode 별 시트명)
  - 헤더 셀 fill = 정당색
  - 정의당 컬럼 조건부 fill
  - `view.frozen = { ySplit:1, xSplit:1 }`
  - 셀 number format = `'0.0'`

### Component (Vitest + React Testing Library)

- `AdvancedTable.test.tsx`
  - 정렬 헤더 클릭 → asc/desc 토글 + onChange 호출
  - 정당 가시성 토글 → 컬럼 숨김
  - 검색 입력 → 행 필터
  - 빈 상태 메시지 (검색 0건, 데이터 0건)
  - 셀 클릭 → drilldown href 검증 (지역 모드)
- `TableToolbar.test.tsx`
  - CSV 버튼 → exportCsv 호출 (mock model)
  - XLSX 버튼 → import() 성공/실패 분기, 실패 시 inline 에러 메시지 표시

### Smoke (Playwright)

- 홈 시계열 모드 → 정렬·정당 토글·검색 → URL 동기
- 모드 토글 → 지역 모드 picker(선거) 활성 → 행=시·군·구
- `/region/4817` — 동일 AdvancedTable 동작
- CSV 다운로드 (download 이벤트 + 첫 10줄 내용 확인)
- XLSX 다운로드 (파일 생성 + 시트 1개 + 행/열 수)
- URL 직접 입력으로 상태 복원 (`?mode=region&sort=정의:desc&parties=정의,민주`)

### 회귀 보존

- 차트 모드 동작 (`TimeseriesPanel` 차트/표 토글)
- 위성정당 합산 토글이 차트·표 양쪽 일관
- 기간(from/to) 필터 — 차트와 표 같은 결과

### 수동 QA 체크리스트

- 모드 토글 시 깜빡임 없음
- 큰 행 수(읍·면·동 수백) UI freeze 없음
- 받은 .xlsx 를 Excel·Numbers·Google Sheets 에서 색·정렬·고정 확인
- 모바일(375px) 가로 스크롤 + sticky 첫 열 유지

### 통과 기준

- 새 파일 라인 커버리지 80%+
- Playwright smoke 6 시나리오 PASS
- 받은 .xlsx 가 Excel·구글시트에서 동일하게 보임

## 다음 단계

1. 본 spec 사용자 리뷰
2. 승인 후 `writing-plans` 스킬로 구현 계획 작성 (phase 단위 분해)
3. 구현 → 회귀 테스트 → 배포
