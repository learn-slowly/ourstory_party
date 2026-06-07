# CHANGELOG

## [Phase 6~9] - 2026-06-07 — AdvancedTable + picker 활성화 + 데이터 풀커버리지

### Phase 6.1 — AdvancedTable 도입 (시계열 모드 + .xlsx)
- 신규 컴포넌트: `AdvancedTable` (TanStack Table v8 headless) + `TableToolbar`
- 정렬·정당 가시성 토글·검색·sticky 첫 열·정의당 컬럼 조건부 그라데이션
- 서식 포함 `.xlsx` 다운로드 (`exceljs` lazy import) — 정당색 헤더·고정 행/열·numFmt
- `HomeTable.tsx` 삭제. `TimeseriesPanel` 이 차트/표 토글
- 단위 테스트 24개 추가, 누적 101 → 115 PASS

### Phase 6.2~6.4 — emd · station picker 활성화
- `index.json` 에 `stationListByEmd` 추가 (build:static)
- HomeView 가 emd/station 옵션을 client useMemo 로 도출 + station/{key}.json fetch
- `force-static` 의 force-dynamic 시도 → outputFileTracingExcludes 와 충돌 → client-fetch 로 우회
- 창원시 일반구(성산·의창·마산합포·마산회원·진해) 이름 정규화 (`SIGUNGU_PREFIX_STRIP`)
- parsed row 의 sigunguName/sidoName 빈 18,811 행 emdName 기반 자동 보충
- seed 의 모든 region 에 placeholder region.json 보장 (data 없는 emd 도 404 방지)

### Phase 7.1 — 2022 8회 지선 emd 데이터
- `parse-jiseon-2022.ts` — NEC 게시판 zip (CP949) 의 9 xlsx 파싱
- `region-name-to-code.ts` — (시·도/시·군·구/읍·면·동 이름) → 10자리 코드 lookup
- 2022 지선 7개 sub-election emd 단위 timeseries 합산

### Phase 8 — NEC archive zip 전체 처리 (1992~2018)
- 16~19대 총선 zip → 2004(권영길!)·2008 (+ 2000 단일 XLS 16대 fix)
- 14~18대 대선 zip → 1992·1997·2002·2007 (메타 seed 보강)
- 3~7회 지선 zip → 2002·2006·2010·2014·2018 (+ 2014 광역단체장 15/17 시도 포맷 fix, 2002 BIFF5 CP949 fix)
- 27 정당 alias 추가 (민자당·국민회의·국민승리21·새한국당·국민당 등)
- aggregate-region.ts — el_day 없는 구 데이터 fallback (total/subtotal 행 사용)

### Phase 9 — 선거구 → 행정구역 자동 추론
- 2000·2004·2008 총선 raw 의 sigunguName 자리에 "창원시을" 같은 선거구명 → emdName 기반 행정 sigungu 자동 치환
- 검증: 상남동(성산구) 민주노동당 시계열 — 2004 총선 지역구 45.07% (권영길 첫 당선), 2008 총선 46.16% (재당선), 2025 대선 1.72% (사용자 묘사 "2%대" 일치)

### 알려진 잔존 한계
- 동명 emd 590개의 cross-region 오염 가능 (예: 강남구 신사동 vs 마포구 신사동) — 첫 매칭 우선
- 2014 광역단체장 충북·세종 (zip 에 파일 없음)
- 2019/2025 보궐, 2026 지선 — zip 외 별도 수집 필요
- parse-general-16-19.ts 의 TS 에러 3개 (런타임 무관, cleanup 후속)

## [정적 마이그레이션] - 2026-06-06

### 변경
- **데이터 소스 전환**: Supabase Postgres → NEC 다운로드 xlsx
- **호스팅**: Vercel + Supabase → Vercel 단독 (DB 없음)
- **빌드 흐름**: build:parse (xlsx → JSON) → build:static (region/station chunks) → next build

### 추가
- xlsx parser 6 형식 (A·B·C·D·E·F) — 2012~2025 대선·총선·재보궐·지선
- 정적 chunk 시스템 (`public/data/static/{index,region,station}/**.json`)
- 정당 alias 영구화 — 보수 양당 전신 (자유한국당·새누리당·한나라당·바른정당) people_power 통합
- 4-level region picker (시·도→시·군·구→읍·면·동→투표소) 정적 변환
- station-level 시계열 lazy fetch

### 제거
- 라이브 개표 페이지 (`/live`)
- Phase 4 자동화 (`.github/workflows/poll-live.yml`)
- Supabase·drizzle·postgres 의존성
- ingest 스크립트 (parser/build 로 대체)

### 알려진 제약
- 2007 대선·2008 총선·2014·2018 지선 등 일부 election xlsx 미수신 → archive HTML 폴백 적용 가능
- 2002 대선 station-level 데이터 없음 (NEC archive 한계)

## 이전 변경 (Supabase 시대)
- v1.5.0 등 — git 히스토리 참조
