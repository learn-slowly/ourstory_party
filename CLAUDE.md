# CLAUDE.md

## 언어
- 코드 주석, 커밋 메시지, 응답 모두 한국어

## 프로젝트
- ourstory: 진보계열 정당 역대 선거 분석 플랫폼 (전국 풀커버리지)
- Next.js 16 + TypeScript + Tailwind + Supabase Postgres + Drizzle
- 데이터 소스: apis.data.go.kr, info.nec.go.kr
- 배포: Vercel

## 핵심 규칙
- 정당 색상: 정의 #FFCC00, 노동 #A50034, 녹색 #1B7339, 진보 #D6001C, 민주 #152484, 국힘 #E61E2B
- 정당명 통합: data/seed/parties.json 의 alias 로 시대간 매핑. 하드코딩 금지
- 정의당은 차트에서 항상 #FFCC00, 가장 먼저 눈에 들어오게
- 득표율 소수점 1자리 통일
- 미출마 = DB 행 없음 (UI 에서 "미출마" 표시)
- 위성정당은 satellite_of 로 본당 연결, 클라이언트 합산 토글

## 데이터 구조
- DB: Supabase Postgres (db/schema.ts)
- 시드 원본: data/seed/
- 인제스천 캐시: data/raw/ (gitignored)
- 인제스천 스크립트: scripts/ingest/

## 경남 시·군 (jp-in-gn 호환 — 18개)
창원시, 진주시, 통영시, 사천시, 김해시, 밀양시, 거제시, 양산시, 의령군, 함안군,
창녕군, 고성군, 남해군, 하동군, 산청군, 함양군, 거창군, 합천군
