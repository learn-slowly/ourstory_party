# ourstory

진보계열 정당 전국 풀커버리지 (2000~2025) 역대 선거 분석 플랫폼.

- 라이브: <https://jp-ourstory.vercel.app>
- 설계: `docs/superpowers/specs/2026-06-04-ourstory-design.md`

## 페이지

- `/` 홈: 진보계열 정당 역대 선거 시계열 차트 + 5개 필터(지역·선거유형·정당·위성 합산·진보 합산), URL 상태 동기화

## 개발

```bash
pnpm install
pnpm dev   # http://localhost:3000
```

데이터 빌드:

```bash
# 1. NEC 다운로드 xlsx 를 data/raw/nec-downloads/ 에 저장 (수동)
# 2. parse → 중간 JSON
pnpm build:parse [electionId]   # 인자 생략 시 전체
# 3. 정적 chunk 생성
pnpm build:static
# 또는 한꺼번에
pnpm build:all
```

프로덕션 빌드 (Vercel 자동 실행):

```bash
pnpm build    # build:static + next build
```

## 아키텍처

- Next.js 16 RSC, 모든 페이지 SSG (정적 사이트)
- DB 없음 (Vercel 만으로 호스팅)
- 데이터 = NEC 다운로드 xlsx → parser → 정적 JSON chunks
- 라이브 개표 미지원

## 데이터 흐름

```
data/raw/nec-downloads/  # NEC 다운로드 xlsx (사용자 로컬)
       ↓ scripts/build/parse-nec-xlsx.ts (형식별 parser A/B/C/D/E/F)
data/parsed/{electionId}.json  # 중간 형식 (git commit)
       ↓ scripts/build/build-static.ts
public/data/static/      # 배포 정적 chunk (gitignored)
```

## xlsx 형식 (parser 분기)

| 형식 | 특징 | 적용 |
|---|---|---|
| A | row[3] header + row[4] 후보자 | 2024·2025 통합 |
| B | 시·도×시·군·구 분리, 시트 메타에 region | 2020·2016 |
| C | row[0] 한 줄 header+후보자 | 2022 대선·재보궐 |
| D | 2012 .xls 통합 | 2012 18대 대선 |
| F | row[0] header + row[1] 후보자 | 2017 대선 |
| E | archive HTML 폴백 | 미수신 election |

## 라이센스

내부 분석용. 데이터는 NEC 공개 자료.
