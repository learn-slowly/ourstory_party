# CLAUDE.md

## 언어
- 코드 주석, 커밋 메시지, 응답 모두 한국어
- 금지 어휘: "박는다 / 박힘 / 박혀있다 / 박아둔다 / 박아라 / 박아도". 대안: 적용한다 / 반영한다 / 넣는다 / 적는다 / 쓴다 / 기록한다 / 채운다 / 추가한다 / 남긴다 / 저장한다

## 프로젝트
- ourstory: 진보계열 정당 전국 풀커버리지 (2000~2025) 역대 선거 분석 플랫폼
- 정의당 외 진보 정당 시계열·지역 분포 분석
- Next.js 16 RSC + TypeScript + Tailwind + Recharts
- 배포: Vercel (정적 SSG, DB 없음)
- 데이터: NEC 다운로드 xlsx → parser → 정적 JSON chunks

## 핵심 규칙
- 모든 페이지 SSG (`export const dynamic = "force-static"`)
- 데이터 소스 = `public/data/static/{index,region,station}/**.json` (build 시점 생성, gitignored)
- 라이브 개표 미지원 (정적 사이트 결정 — 2026-06-06)
- 정당 alias 영구화 — 보수 양당 전신 (자유한국당·새누리당·한나라당·바른정당 등) 모두 people_power 통합
- 정의당 강조 색상 #FFCC00
- 정당 색상: 정의 #FFCC00, 노동 #A50034, 녹색 #1B7339, 진보 #D6001C, 민주 #152484, 국힘 #E61E2B
- 득표율 소수점 1자리 통일
- 미출마 = 데이터 행 없음 (UI 에서 "미출마" 표시)
- 위성정당은 satellite_of 로 본당 연결, 클라이언트 합산 토글

## 빌드 흐름
1. **fetch (수동)** — NEC 다운로드 메뉴 zip/xlsx 사용자가 받음 → `data/raw/nec-downloads/{electionId}/...`
2. **parse** — `pnpm build:parse [electionId]` → `data/parsed/{id}.json` (xlsx → ParsedElection)
3. **build** — `pnpm build:static` → `public/data/static/**` (index + region + station chunks)
4. **deploy** — `pnpm build` (build:static + next build) → Vercel static deploy

## 데이터 소스 (확정)
- 대선: 2012/2017/2022/2025 xlsx + 2007 archive HTML (형식 E 폴백)
- 총선 (지역구·비례): 2012·2016·2020·2024 xlsx + 2008 archive HTML 폴백 가능
- 보궐: 2015 상·하반기, 2022 xlsx
- 지선: archive HTML emd-level (4~8회, 2006~2022)

## xlsx 형식 (Parser 분기)
- A: 2024·2025 통합 (row[3] header + row[4] 후보자)
- B: 2020·2016 시·도×시·군·구 분리 (시트 메타에 region)
- C: 2022 대선·재보궐 (row[0] header 한 줄에 후보자 합침)
- D: 2012 .xls 통합
- F: 2017 대선 (row[0] header + row[1] 후보자)
- E: archive HTML 폴백 (parseVccp08Stations 어댑터)

## 정적 chunk 구조
- `index.json`: elections + parties + regions (시·도·시·군·구·읍·면·동 목록)
- `region/{code}.json`: 지역 단위 메타 + 시계열 + election summary
- `region/{code}/election-{id}.json`: 지역×선거 detail (후보자별·emd별·kind별 분해)
- `station/{sigungu-emd-name}.json`: 투표소 단위 시계열 (drill-down 시만 fetch)

## 경남 시·군 (jp-in-gn 호환 — 18개)
창원시, 진주시, 통영시, 사천시, 김해시, 밀양시, 거제시, 양산시, 의령군, 함안군,
창녕군, 고성군, 남해군, 하동군, 산청군, 함양군, 거창군, 합천군

## 현재 상태 (2026-06-06)
- 정적 마이그레이션 완료 (Phase 1~3 + Task 4.2)
- 2,108 region 정적 페이지 + 29,884 station 파일
- 미수신 election (2007 대선·2008 총선·2014 지선 등) 은 archive HTML 폴백 적용 가능
- Supabase 인스턴스 삭제는 1주일 안정 모니터링 후 (Task 4.3 — 수동)
