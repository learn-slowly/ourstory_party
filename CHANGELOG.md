# CHANGELOG

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
