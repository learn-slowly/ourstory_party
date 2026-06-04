# ourstory — 진보계열 정당 역대 선거 분석 플랫폼 설계

작성일: 2026-06-04
프로젝트명: **ourstory**
참고 서비스: [jinbo3d.vercel.app](https://jinbo3d.vercel.app/) (2026 지선 실시간 진보 모니터)
기반 자산: [jp-in-gn](https://jp-in-gn.vercel.app) (경남 정의당 분석 대시보드)

> 본 문서는 ourstory 신규 프로젝트의 설계 명세다. 현재 jp-in-gn 저장소의 `docs/superpowers/specs/` 아래에 임시 저장되어 있으며, ourstory repo 초기화 시 함께 이전한다.

---

## 1. 배경과 목적

jp-in-gn은 경남 18개 시·군에 한정된 정의당 중심 분석 도구다. 이를 **전국 풀커버리지**로 확장하고, **진보계열 다정당**의 **역대 선거 변천사**를 시계열·지역 두 축으로 함께 볼 수 있는 공개 플랫폼을 신규 구축한다.

핵심 가치는 "선거의 흐름 안에서 진보계열이 어디서 살아남고 어디서 죽었나"를 한 화면에서 스캔하게 하는 것이다. 진보3d가 보여준 "한눈 스캔"의 직관성을 유지하되, jp-in-gn의 시계열·드릴다운·정당 alias 처리 같은 **분석 깊이**를 더한다.

### 주 사용자

- 진보계열 정당 활동가·기획자 (전략 회의·후보 추천 자료)
- 정치 분석가·기자
- 관심 시민 (자기 지역에서 진보가 어떻게 해왔는지)

### 비목표

- 진보계열이 아닌 정당의 분석을 깊게 하지 않는다 (양당은 비교 맥락에서만)
- 회원·즐겨찾기·댓글·알림 같은 커뮤니티 기능 없음
- 모바일 앱·다국어·광고·결제 없음

---

## 2. 스코프

### 정당

- **현역 진보**: 정의당, 노동당, 녹색당, 진보당
- **역사적 진보계열**: 민주노동당, 통합진보당, 민중연합당, 진보신당, 그 외 alias가 필요한 정당
- **비교용 양당**: 더불어민주당, 국민의힘 (직접 분석 대상은 아님)

### 선거 (시간 범위)

- **2000년 16대 총선부터 2026 9회 지선까지**
- 종류: 대선, 총선(지역구·비례 분리), 지방선거(시·도지사·시장군수구청장·시도의원지역구·시도의원비례·구시군의원지역구·구시군의원비례·교육감), 재·보궐
- 총 약 19개 행사 → election_id 기준 약 40~50건

### 지역

- 전국 17개 시·도
- 전국 약 250개 시·군·구
- 전국 약 3,500개 읍·면·동 (Phase 1.5에서 도달)
- 투표구 단위는 Phase 외 (필요 시 별도)

---

## 3. 아키텍처

### 스택

| 영역 | 기술 |
|---|---|
| 프론트엔드 | Next.js 15 (App Router) + TypeScript + Tailwind CSS + Recharts |
| DB | Supabase Postgres (RLS로 공개 읽기, Service Role로 인제스천) |
| ORM | Drizzle (스키마·마이그레이션·타입 생성) |
| 호스팅 | Vercel (앱) + Supabase 무료 티어 (DB) |
| 라이브 잡 | GitHub Actions cron (Phase 4) |
| 인제스천 | 로컬 Node 스크립트 → Supabase Service Role |

### 배포 구조

```
유저 브라우저
   │
   ▼
Vercel (Next.js Server Components)
   │
   ├─ Supabase Postgres (RLS: anon 읽기 전용)
   │
   └─ /api/live (Phase 4 only — info.nec.go.kr 직접 호출 없음, DB 조회만)

인제스천 (로컬·cron)
   info.nec.go.kr + apis.data.go.kr
       ↓
   Node 스크립트 (scripts/ingest/)
       ↓
   Supabase (Service Role)
```

### 도메인·이름

- 프로젝트명: `ourstory`
- repo: `github.com/learn-slowly/ourstory_party` (가정)
- Vercel 도메인: 임시 `ourstory.vercel.app`, 정식은 추후

---

## 4. 데이터 모델

### 테이블

```sql
-- 지역: 시·도 / 시·군·구 / 읍·면·동 통합 트리. 행안부 법정동코드 사용.
regions (
  code           text PRIMARY KEY,
  level          text NOT NULL,         -- 'sido' | 'sigungu' | 'emd'
  name           text NOT NULL,
  parent_code    text REFERENCES regions(code),
  display_order  int
);

-- 선거 메타. election_id는 우리 자체 ID.
elections (
  id              text PRIMARY KEY,
  date            date NOT NULL,
  type            text NOT NULL,         -- 'presidential' | 'general' | 'general_prop' |
                                         -- 'local_gov' | 'governor' | 'mayor' | 'superintendent' |
                                         -- 'local_council' | 'local_council_prop' |
                                         -- 'local_council_basic' | 'local_council_basic_prop' |
                                         -- 'byelection'
  name            text NOT NULL,
  nec_election_id text,                  -- info.nec.go.kr용 (예: '0020260603')
  nec_code        text,                  -- electionCode (예: '8')
  is_byelection   bool NOT NULL DEFAULT false,
  display_order   int
);

-- 정당 (시대 통합 단위)
parties (
  id             text PRIMARY KEY,       -- 'justice', 'labor', 'green', 'progressive',
                                         -- 'unified_progressive', 'people_united' 등
  name           text NOT NULL,          -- '정의당'
  family         text NOT NULL,          -- 'justice' | 'labor' | 'green' | 'progressive' |
                                         -- 'historical_progressive' | 'major' | 'other'
  color          text NOT NULL,          -- '#FFCC00'
  satellite_of   text REFERENCES parties(id),
  active_from    date,
  active_until   date
);

-- 시대별 정당명 alias — 인제스천 시 NEC 원본 표기를 우리 party_id로 매핑
party_aliases (
  alias          text NOT NULL,
  party_id       text NOT NULL REFERENCES parties(id),
  valid_from     date,
  valid_until    date,
  PRIMARY KEY (alias, valid_from)
);

-- 핵심: 지역×선거×정당 득표
vote_totals (
  election_id    text NOT NULL REFERENCES elections(id),
  region_code    text NOT NULL REFERENCES regions(code),
  party_id       text NOT NULL REFERENCES parties(id),
  votes          int NOT NULL,
  rank           int,                    -- 해당 지역 내 순위
  PRIMARY KEY (election_id, region_code, party_id)
);

-- 지역 전체 분모 (정당 N개에 중복 저장 방지)
region_totals (
  election_id    text NOT NULL REFERENCES elections(id),
  region_code    text NOT NULL REFERENCES regions(code),
  total_voters   int,
  total_votes    int,
  valid_votes    int,
  invalid_votes  int,
  progress_pct   numeric(5,2),           -- 개표진행률 (라이브용)
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (election_id, region_code)
);

-- 지역구 단위 후보자 (국회의원·시장·시도지사·구청장·교육감·시도의원·기초의원)
candidates (
  id             bigserial PRIMARY KEY,
  election_id    text NOT NULL REFERENCES elections(id),
  constituency   text NOT NULL,          -- '창원시갑', '진주시-가선거구' 등
  region_code    text REFERENCES regions(code),
  party_id       text REFERENCES parties(id), -- 무소속이면 NULL
  party_name_raw text,                   -- alias 미매핑 시 원본 보존
  name           text NOT NULL,
  votes          int,
  is_winner      bool NOT NULL DEFAULT false
);
```

### 인덱스

```sql
CREATE INDEX ON vote_totals (region_code, election_id);
CREATE INDEX ON vote_totals (party_id, election_id);
CREATE INDEX ON regions (parent_code);
CREATE INDEX ON candidates (election_id, constituency);
```

### 결정 사항

- **미출마 = 행 없음**. UI에서 row 없으면 "미출마" 표시 (jp-in-gn 규칙 그대로).
- **위성정당**: `satellite_of`로 본당 연결 → 클라이언트에서 합산 토글.
- **라이브 데이터**도 같은 `vote_totals` + `region_totals`에 upsert. 별도 테이블 없음.
- **RLS**: anon 키에 `SELECT` 만 허용. 인제스천은 Service Role.

---

## 5. 인제스천 파이프라인

### 디렉터리

```
scripts/
  ingest/
    seed/
      01-regions.ts          # 행안부 법정동코드 → regions
      02-parties.ts          # parties.json + party_aliases 시드
      03-elections.ts        # elections 시드
    historical/
      10-fetch-sigungu.ts    # apis.data.go.kr → data/raw/data-go-kr/
      11-fetch-emd.ts        # info.nec.go.kr POST → data/raw/nec/
      12-fetch-winners.ts    # info.nec.go.kr EPEI01 → data/raw/nec-winners/
      20-parse-and-upsert.ts # cheerio 파싱 + alias 해석 + Supabase upsert
    live/
      poll-2026.ts           # GitHub Actions cron — info.nec.go.kr → Supabase
    validate.ts              # 합계 정합성 체크
  lib/
    db.ts                    # Supabase Service Role 클라이언트
    nec-html.ts              # VCCP04/VCCP08 파서 (jp-in-gn parse-nec-emd.ts 이식)
    party-mapping.ts         # NEC 원본 표기 → party_id 매핑
data/
  raw/                       # 원본 HTML·JSON (gitignore 또는 LFS)
  intermediate/              # 파싱 결과 JSON (검수용)
```

### 소스

| 소스 | 용도 | 특성 |
|---|---|---|
| `apis.data.go.kr` (공공데이터포털) | 시·도·시·군·구 단위 비례·후보 결과 | JSON, 안정. 선거 며칠~몇 주 뒤 등록 |
| `info.nec.go.kr` VCCP04/VCCP08 | 읍·면·동 단위 결과 | HTML, 거의 실시간 |
| `info.nec.go.kr` EPEI01 | 당선인 명부 | 기초의원 다수 당선 정확화 |

### 선거 1건당 처리 흐름

```
1. fetch    : data.go.kr API → data/raw/data-go-kr/{elecId}-{sgTypecode}.json
              info.nec.go.kr POST → data/raw/nec/{elecId}-{regionCode}.html
2. parse    : cheerio로 합계·읍면동 행 추출 → data/intermediate/{elecId}.json
3. map      : 원본 정당명 → party_aliases 조회 → party_id 결정
              미매핑은 콘솔 출력 + 인제스천 실패 (parties.json 보강 필요)
4. validate : (a) 정당 득표 합 ≈ 유효투표 (오차 ±5)
              (b) 시·군 합계 ≈ 광역 합계 (오차 ±10)
              (c) 읍·면·동 합 ≈ 본투표 + 관내사전 (jp-in-gn 규칙)
5. upsert   : region_totals + vote_totals INSERT ... ON CONFLICT UPDATE
              (재실행 안전)
```

### Rate limit

- `info.nec.go.kr`: 요청 사이 500ms 대기 (jp-in-gn 검증값)
- 병렬도 ≤ 5
- User-Agent 명시: `Mozilla/5.0 (ourstory ingester; contact: <이메일>)`
- raw HTML 캐시 → 재파싱 시 NEC 재호출 없음

### 라이브 (Phase 4)

**선택: 백그라운드 폴링 (사용자가 NEC 직접 호출 안 함)**

```
GitHub Actions cron (*/1 * * * *)
   ↓
poll-2026.ts: 22개 townCode 병렬 호출 → upsert
   ↓
Supabase region_totals + vote_totals 갱신
   ↓
유저 페이지: Supabase 직접 조회 (Server Component 5초 캐시)
```

- NEC가 다운돼도 마지막 스냅샷 노출 가능
- 종료 후 며칠 뒤 `apis.data.go.kr` 최종본으로 덮어쓰기 (마무리 검수)

---

## 6. 페이지 구조

### 사이트맵

```
/                       홈 — 전국 시계열 (정당셋 × 선거유형 × 시간)
/region/[code]          지역 상세 — code로 시·도/시·군/읍·면·동 모두
/election/[id]          선거 단면 — 한 선거에서 진보의 전국 분포
/party/[id]             정당 변천사 (Phase 2)
/live                   2026 지선 실시간 (Phase 4)
```

### 홈 (`/`)

- 헤더: 지역 드롭다운 [전국 ▾], 선거유형 [전체 ▾], 정당 체크박스, 위성정당 합산 토글, 합산 진보 라인 토글
- 메인: 시계열 차트 (x=선거 시간순, y=득표율%, 정당별 라인)
- 보조: 통계 카드 (직전 선거 대비 ±%p, 고점·저점), "지역 드릴다운" CTA
- URL 상태: `/?region=48&types=local_prop_gw&parties=justice,labor,green,progressive`
- jp-in-gn 패턴: 긴 상태는 `?s=base64` 압축 옵션

### 지역 상세 (`/region/[code]`)

- code의 level로 페이지 내 분기 (sido / sigungu / emd)
- 헤더: 지역명, 상위 지역 링크, 메타 (선거인·인구)
- 시계열 차트 (홈과 동일 컴포넌트, 지역 고정)
- 직전 선거 카드 — 정당별 득표·득표율·당선/낙선 배지
- 하위 지역 표 (sido→시·군, sigungu→읍·면·동)
- 유사 지역 비교 토글 (Phase 2)

### 선거 단면 (`/election/[id]`)

- 선거명·일자
- 정당별 전국 합계 표 (득표·득표율·1위 시·군 수)
- 시·도 표
- 시·군·구 표 (정렬·필터)
- 지역구 선거인 경우 후보자 표 + 당선자 강조

### 정당 변천사 (`/party/[id]`, Phase 2)

- 정당 메타·색상·창당~해산
- 전국 시계열 (위성 합산 토글)
- 강세·약세 지역 top 20
- 후보자 출마 이력 (선택)

### 라이브 (`/live`, Phase 4)

- 전국 진보 합계 카드 (득표·진행률·1분 전 대비)
- 시·도 그리드 (17개)
- 시·군·구 그리드 (검색·정렬: 진행률·진보 득표율)
- 5초 클라이언트 재조회, 30초 캐시

### 공통

- 헤더: 로고, 검색, 다크/라이트 토글, 위성정당 합산 토글 (전역)
- 푸터: 데이터 출처, 마지막 갱신 시각, GitHub 링크
- 차트 컴포넌트: jp-in-gn Recharts 패턴 이식
- 정당 색상: 정의 `#FFCC00`, 민주 `#152484`, 국힘 `#E61E2B`, 노동 `#D6001C`, 녹색 `#00A85A`, 진보 `#9B26B6`. 확정은 시드 시점.
- 공유: 모든 페이지 PNG 캡처 + URL 공유 (jp-in-gn 패턴 이식)

---

## 7. Phase별 작업 단위 (안 A 상향식)

### Phase 1 — 2018~2026 풀깊이 (6주)

| 단계 | 작업 | 기간 |
|---|---|---|
| 1.0 인프라 | ourstory repo 부트, Supabase 프로젝트, Drizzle 스키마, 시드(regions·parties·elections), 인제스천 라이브러리, UI 셸 | 1주 |
| 1.1 시·군·구 데이터 | data.go.kr API → Phase 1 대상 선거 시·군 결과 upsert + validate | 0.5주 |
| 1.2 홈 | `/` 시계열 차트, 정당·선거유형 필터, 위성정당 토글, URL 상태 | 1주 |
| 1.3 지역 상세 | `/region/[code]` (sido + sigungu), 직전 선거 카드, 하위 지역 표 | 1주 |
| 1.4 선거 단면 + 검색 | `/election/[id]`, 헤더 지역 검색 모달 | 0.5주 |
| 1.5 읍·면·동 풀데이터 | info.nec.go.kr 크롤링·파싱·upsert, `/region/[code]` emd 분기 | 1.5주 |
| 1.6 폴리시 | PNG 캡처·공유, 인덱스·ISR 최적화, 다크모드 마무리, OG 이미지 | 0.5주 |

**Phase 1 출시 시점**: 1.6 완료 시 v1.0 공개.

### Phase 2 — 2014~2017 추가 (2주)

- 2014 6회 지선, 2016 20대 총선, 2017 19대 대선 인제스천
- 정당 alias 보강 (통합진보·진보신당·민중연합·노동·녹색 초기)
- 시계열 차트 도메인 2014부터로 확장
- `/party/[id]` 출시

### Phase 3 — 2000~2013 (3주)

- 대상: 2002 3회 지선·16대 대선, 2004 17대 총선, 2006 4회 지선, 2007 17대 대선, 2008 18대 총선, 2010 5회 지선, 2012 19대 총선·18대 대선
- info.nec.go.kr HTML 포맷이 시대별로 다를 가능성 → 파서 분기 (필요 시 PDF·엑셀 보조)
- 민주노동당 시대 풀반영
- 시계열 2000년부터

### Phase 4 — 2026 라이브 (0.5주)

- GitHub Actions cron + `poll-2026.ts`
- `/live` 페이지
- 잡 종료 후 data.go.kr 최종본으로 덮어쓰기

### 일정 합계

```
Phase 1   6주
Phase 2   2주
Phase 3   3주
Phase 4   0.5주
───────────────
총       11.5주 ≈ 3개월
```

---

## 8. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| **Phase 1.5 읍·면·동 크롤링 부하** — 약 30선거 × 250+ townCode × 500ms = 8시간+ | 백그라운드 잡으로 분할 실행, 며칠 걸어둠. 서비스 트래픽과 무관 |
| **Phase 3 옛 데이터 포맷 깨짐** | 파서를 시대별로 분기. PDF·엑셀 대체 소스 확보 |
| **정당 alias 매핑이 정치 판단** (예: 민중연합당 → 진보당) | 매핑 결정은 사용자 확인 후 커밋. 결정 근거를 `party_aliases.note` 컬럼에 기록 (추후) |
| **info.nec.go.kr 다운** (개표일 트래픽) | 라이브는 백그라운드 폴링 → DB 스냅샷 노출. NEC 다운돼도 마지막 값 유지 |
| **Supabase 무료 티어 한계** (DB 500MB, egress 5GB/월) | Phase 1.5 후 데이터 크기 측정 → 필요 시 Pro로 업그레이드 또는 정적 캐시 전략 |

---

## 9. 의도적 비목표 (YAGNI)

- 회원·인증·즐겨찾기·댓글
- 알림·구독
- 후보자 사진·프로필 페이지
- 본격 지도 (지도는 Phase 5+ 검토)
- 모바일 앱·PWA
- 다국어
- 외부 API 공개
- 광고·결제

---

## 10. 열린 질문 (구현 들어가기 전 확정 필요)

1. **GitHub repo 위치 확정**: `learn-slowly/ourstory_party` 맞나?
2. **Supabase 인스턴스**: 새로 만들지 / 기존 jp-in-gn과 분리할지 (분리 권장)
3. **정당 alias 정치 판단**: 권영국 2025 대선 민노당 → 정의당 합산처럼 명시적 처리가 필요한 케이스 목록을 Phase 1.0 시드 단계에서 사용자와 1회 확정
4. **연락 이메일** (User-Agent에 포함): 사용 가능한 contact 이메일
5. **공식 도메인**: 임시 `ourstory.vercel.app` 외에 별도 도메인 살 계획?

이 다섯 항목은 spec 승인 후 implementation plan 단계에서 사용자에게 확인한다.
