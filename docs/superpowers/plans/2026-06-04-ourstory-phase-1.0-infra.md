# ourstory Phase 1.0 (Infrastructure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ourstory 프로젝트의 인프라·스키마·시드·인제스천 라이브러리·UI 셸을 완성해 Vercel에 빈 페이지를 배포한다. Phase 1.1(데이터 인제스천) 이상의 기반.

**Architecture:** Next.js 15(App Router) + Supabase Postgres + Drizzle ORM. 새 디렉터리 `~/coding/ourstory` 에서 부트스트랩. jp-in-gn의 parties.json·정당 색상·nec-html 파서를 이식. 인제스천 스크립트는 Service Role로, 클라이언트 SELECT는 anon 키 + RLS.

**Tech Stack:** Next.js 15, TypeScript 5, Tailwind CSS 4, Drizzle ORM, postgres-js, Supabase, Vitest(테스트), cheerio(HTML 파싱), Recharts(이후 Phase에서). pnpm 패키지 매니저.

---

## 사전 확인 (Task 1 들어가기 전 1회)

다음 두 가지를 사용자에게 확인하고 받은 값을 메모해 둔다. 받기 전엔 Task 1을 시작하지 않는다.

1. **GitHub repo 위치**: 기본값 `learn-slowly/ourstory_party` 이면 그대로 사용. 다르면 사용자가 지정.
2. **Supabase 프로젝트**: 기본값은 신규 프로젝트 (이름 `ourstory`). 기존 인스턴스 재사용을 원하면 사용자가 URL·키 제공.

---

## File Structure

```
~/coding/ourstory/
├── README.md
├── CLAUDE.md                          # jp-in-gn 룰 일부 이식 (한국어 응답, 정의당 강조 등)
├── package.json                       # pnpm
├── pnpm-lock.yaml
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── .eslintrc.json
├── .prettierrc
├── .env.local                         # gitignored, Supabase URL/키
├── .env.example
├── vitest.config.ts
│
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # 루트 레이아웃 — 헤더·푸터·다크모드 셸
│   │   ├── page.tsx                   # 홈 — Phase 1.0 에선 placeholder
│   │   └── globals.css                # Tailwind 베이스
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   └── ThemeToggle.tsx
│   ├── lib/
│   │   ├── db.ts                      # Drizzle 클라이언트 (anon)
│   │   ├── db-admin.ts                # Drizzle 클라이언트 (Service Role) — 인제스천 전용
│   │   └── theme.ts                   # 다크모드 훅
│   └── types/
│       └── index.ts
│
├── db/
│   ├── schema.ts                      # Drizzle 스키마 (모든 테이블)
│   └── migrations/                    # drizzle-kit 산출물
│
├── scripts/
│   ├── ingest/
│   │   ├── seed/
│   │   │   ├── 01-regions.ts          # 행안부 법정동코드 → regions
│   │   │   ├── 02-parties.ts          # parties + party_aliases 시드
│   │   │   └── 03-elections.ts        # Phase 1 대상 elections 시드
│   │   └── lib/
│   │       ├── party-mapping.ts       # NEC 원본 표기 → party_id
│   │       └── nec-html.ts            # VCCP04/VCCP08 파서 (jp-in-gn 이식)
│   └── verify-schema.ts               # 스키마 존재 검증
│
├── tests/
│   ├── unit/
│   │   ├── party-mapping.test.ts
│   │   └── nec-html.test.ts
│   └── fixtures/
│       ├── nec-vccp08-2025-jinju.html # 실제 캡처본 (테스트 입력)
│       └── nec-vccp04-2018-gn.html    # 옛 포맷 (테스트 입력)
│
└── data/
    ├── seed/
    │   ├── parties.json               # jp-in-gn 에서 이식 + 확장
    │   └── elections.json
    └── raw/                           # 인제스천 캐시 (gitignored)
```

---

## Task 1: 프로젝트 부트스트랩

**Files:**
- Create: `~/coding/ourstory/` (디렉터리)
- Create: `~/coding/ourstory/package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: jp-in-gn 디렉터리 밖으로 이동**

```bash
cd ~/coding
ls
```

Expected: `jp-in-gn` 가 보임. `ourstory` 는 없음.

- [ ] **Step 2: Next.js 15 + TypeScript 부트스트랩**

```bash
pnpm create next-app@latest ourstory \
  --typescript --tailwind --eslint --app \
  --src-dir --import-alias "@/*" --turbopack \
  --use-pnpm --no-interactive
cd ourstory
```

Expected: `~/coding/ourstory/` 생성, `pnpm dev` 가 가능한 상태.

- [ ] **Step 3: 의존성 추가**

```bash
pnpm add drizzle-orm postgres @supabase/supabase-js cheerio recharts
pnpm add -D drizzle-kit vitest @vitest/ui dotenv-cli tsx @types/node
```

- [ ] **Step 4: CLAUDE.md 작성**

`~/coding/ourstory/CLAUDE.md`:

```markdown
# CLAUDE.md

## 언어
- 코드 주석, 커밋 메시지, 응답 모두 한국어

## 프로젝트
- ourstory: 진보계열 정당 역대 선거 분석 플랫폼 (전국 풀커버리지)
- Next.js 15 + TypeScript + Tailwind + Supabase Postgres + Drizzle
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
```

- [ ] **Step 5: README 한 줄짜리 작성**

`~/coding/ourstory/README.md`:

```markdown
# ourstory

진보계열 정당 역대 선거 분석 플랫폼.

설계 문서: `../jp-in-gn/docs/superpowers/specs/2026-06-04-ourstory-design.md` 참조
(추후 ourstory repo 로 이전).

## 개발

```sh
pnpm install
pnpm dev
```
```

- [ ] **Step 6: .env.example 작성**

`~/coding/ourstory/.env.example`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# 인제스천 (선택)
DATA_GO_KR_API_KEY=
NEC_INGEST_USER_AGENT=Mozilla/5.0 (ourstory ingester; contact: TBD)
```

- [ ] **Step 7: git 초기화 + 첫 커밋**

```bash
git init
git add .
git commit -m "초기 부트스트랩 (Next.js 15 + Tailwind + 의존성)"
```

- [ ] **Step 8: GitHub repo 생성 + 푸시**

```bash
gh repo create learn-slowly/ourstory_party --private --source=. --remote=origin --push
```

Expected: GitHub 에 비공개 repo 생성, `main` 푸시 완료.

---

## Task 2: 개발 도구 설정 (Vitest, Drizzle Kit, Prettier)

**Files:**
- Create: `~/coding/ourstory/vitest.config.ts`
- Create: `~/coding/ourstory/drizzle.config.ts`
- Create: `~/coding/ourstory/.prettierrc`
- Modify: `~/coding/ourstory/package.json:scripts`

- [ ] **Step 1: vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

- [ ] **Step 2: drizzle.config.ts**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
```

- [ ] **Step 3: .prettierrc**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 4: package.json scripts 추가**

`scripts` 에 다음을 병합:

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "dotenv -e .env.local -- vitest run",
    "test:watch": "dotenv -e .env.local -- vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "dotenv -e .env.local -- drizzle-kit migrate",
    "db:studio": "dotenv -e .env.local -- drizzle-kit studio",
    "ingest:seed:regions": "dotenv -e .env.local -- tsx scripts/ingest/seed/01-regions.ts",
    "ingest:seed:parties": "dotenv -e .env.local -- tsx scripts/ingest/seed/02-parties.ts",
    "ingest:seed:elections": "dotenv -e .env.local -- tsx scripts/ingest/seed/03-elections.ts",
    "ingest:seed": "pnpm ingest:seed:regions && pnpm ingest:seed:parties && pnpm ingest:seed:elections",
    "verify:schema": "dotenv -e .env.local -- tsx scripts/verify-schema.ts"
  }
}
```

- [ ] **Step 5: 동작 확인 + 커밋**

```bash
pnpm test --reporter=verbose
```

Expected: "No test files found, exiting with code 1" — 테스트가 없어서 실패 OK (다음 task에서 생김). 실패 메시지를 보고 정상이라 판단하면 다음.

```bash
git add .
git commit -m "개발 도구 설정 (vitest·drizzle·prettier·pnpm 스크립트)"
git push
```

---

## Task 3: Supabase 프로젝트 + 환경변수

**사용자 수동 작업 필요.** 이 task는 사용자가 Supabase 웹 UI에서 작업하고, plan은 단계를 안내한다.

- [ ] **Step 1: Supabase 프로젝트 생성 (수동)**

사용자에게 안내:

1. https://supabase.com/dashboard/new 접속
2. 프로젝트명 `ourstory`, 리전 `Northeast Asia (Seoul)`, 무료 티어
3. DB 비밀번호 강력하게 설정 → **로컬에 안전하게 저장**
4. 생성 완료 대기 (~2분)

- [ ] **Step 2: 환경변수 수집**

Supabase 대시보드 → Settings → API 에서:
- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` 키 → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` 키 → `SUPABASE_SERVICE_ROLE_KEY`

Settings → Database → Connection String → URI 모드에서:
- `DATABASE_URL` (인제스천·migration용)

- [ ] **Step 3: .env.local 작성**

`~/coding/ourstory/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DATABASE_URL=postgresql://postgres:<password>@db.xxxxx.supabase.co:5432/postgres

DATA_GO_KR_API_KEY=
NEC_INGEST_USER_AGENT=Mozilla/5.0 (ourstory ingester; contact: redoutk@gmail.com)
```

- [ ] **Step 4: .gitignore 확인 (Next.js 기본이 이미 처리하지만 명시)**

`.gitignore` 에 `.env.local` 이 있는지 확인. 없으면 추가.

- [ ] **Step 5: 연결 확인 + 커밋 (env.local 은 제외)**

```bash
pnpm tsx -e 'import postgres from "postgres"; const sql = postgres(process.env.DATABASE_URL!); sql`SELECT 1 AS ok`.then(r => { console.log(r); sql.end(); });'
```

(`.env.local` 로드 위해 실제로는 `dotenv-cli` 경유)

```bash
pnpm dotenv -e .env.local -- tsx -e 'import postgres from "postgres"; const sql = postgres(process.env.DATABASE_URL!); sql`SELECT 1 AS ok`.then(r => { console.log(r); sql.end(); });'
```

Expected: `[ { ok: 1 } ]` 출력.

```bash
git add .env.example .gitignore
git commit -m "Supabase 연결 설정 (.env.example)"
git push
```

---

## Task 4: Drizzle 스키마 정의

**Files:**
- Create: `~/coding/ourstory/db/schema.ts`

- [ ] **Step 1: 스키마 파일 생성**

`~/coding/ourstory/db/schema.ts`:

```ts
import {
  pgTable, text, integer, date, boolean, numeric, timestamp, bigserial, primaryKey, index,
} from "drizzle-orm/pg-core";

// 지역: 시·도 / 시·군·구 / 읍·면·동
export const regions = pgTable(
  "regions",
  {
    code: text("code").primaryKey(),
    level: text("level", { enum: ["sido", "sigungu", "emd"] }).notNull(),
    name: text("name").notNull(),
    parentCode: text("parent_code").references((): any => regions.code),
    displayOrder: integer("display_order"),
  },
  (t) => ({
    parentIdx: index("regions_parent_idx").on(t.parentCode),
  }),
);

// 선거
export const elections = pgTable("elections", {
  id: text("id").primaryKey(),
  date: date("date").notNull(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  necElectionId: text("nec_election_id"),
  necCode: text("nec_code"),
  isByelection: boolean("is_byelection").notNull().default(false),
  displayOrder: integer("display_order"),
});

// 정당
export const parties = pgTable("parties", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  family: text("family").notNull(),
  color: text("color").notNull(),
  satelliteOf: text("satellite_of").references((): any => parties.id),
  activeFrom: date("active_from"),
  activeUntil: date("active_until"),
});

// 정당 alias (시대별)
export const partyAliases = pgTable(
  "party_aliases",
  {
    alias: text("alias").notNull(),
    partyId: text("party_id").notNull().references(() => parties.id),
    validFrom: date("valid_from"),
    validUntil: date("valid_until"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.alias, t.validFrom] }) }),
);

// 지역×선거×정당 득표
export const voteTotals = pgTable(
  "vote_totals",
  {
    electionId: text("election_id").notNull().references(() => elections.id),
    regionCode: text("region_code").notNull().references(() => regions.code),
    partyId: text("party_id").notNull().references(() => parties.id),
    votes: integer("votes").notNull(),
    rank: integer("rank"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.electionId, t.regionCode, t.partyId] }),
    regionIdx: index("vt_region_idx").on(t.regionCode, t.electionId),
    partyIdx: index("vt_party_idx").on(t.partyId, t.electionId),
  }),
);

// 지역 분모
export const regionTotals = pgTable(
  "region_totals",
  {
    electionId: text("election_id").notNull().references(() => elections.id),
    regionCode: text("region_code").notNull().references(() => regions.code),
    totalVoters: integer("total_voters"),
    totalVotes: integer("total_votes"),
    validVotes: integer("valid_votes"),
    invalidVotes: integer("invalid_votes"),
    progressPct: numeric("progress_pct", { precision: 5, scale: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.electionId, t.regionCode] }) }),
);

// 지역구 후보자
export const candidates = pgTable(
  "candidates",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    electionId: text("election_id").notNull().references(() => elections.id),
    constituency: text("constituency").notNull(),
    regionCode: text("region_code").references(() => regions.code),
    partyId: text("party_id").references(() => parties.id),
    partyNameRaw: text("party_name_raw"),
    name: text("name").notNull(),
    votes: integer("votes"),
    isWinner: boolean("is_winner").notNull().default(false),
  },
  (t) => ({
    electionConstIdx: index("cand_election_const_idx").on(t.electionId, t.constituency),
  }),
);
```

- [ ] **Step 2: 마이그레이션 생성**

```bash
pnpm db:generate
```

Expected: `db/migrations/0000_*.sql` 생성. 콘솔 출력에 7개 테이블 생성 SQL 확인.

- [ ] **Step 3: 마이그레이션 실행**

```bash
pnpm db:migrate
```

Expected: 오류 없이 종료. Supabase 대시보드 → Table Editor 에서 7개 테이블 확인.

- [ ] **Step 4: 스키마 검증 스크립트**

`~/coding/ourstory/scripts/verify-schema.ts`:

```ts
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

const expected = [
  "regions", "elections", "parties", "party_aliases",
  "vote_totals", "region_totals", "candidates",
];

const rows = await sql<{ table_name: string }[]>`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = ANY(${expected})
  ORDER BY table_name;
`;

const found = rows.map((r) => r.table_name);
const missing = expected.filter((t) => !found.includes(t));

if (missing.length > 0) {
  console.error("누락 테이블:", missing);
  process.exit(1);
}

console.log(`✓ 7개 테이블 모두 존재: ${found.join(", ")}`);
await sql.end();
```

- [ ] **Step 5: 검증 실행 + 커밋**

```bash
pnpm verify:schema
```

Expected: `✓ 7개 테이블 모두 존재: candidates, elections, parties, party_aliases, region_totals, regions, vote_totals`

```bash
git add db/ scripts/verify-schema.ts package.json
git commit -m "DB 스키마 정의 + 첫 마이그레이션 (7개 테이블)"
git push
```

---

## Task 5: 정당 시드 (parties + party_aliases)

**Files:**
- Create: `~/coding/ourstory/data/seed/parties.json`
- Create: `~/coding/ourstory/src/lib/db-admin.ts`
- Create: `~/coding/ourstory/scripts/ingest/seed/02-parties.ts`

- [ ] **Step 1: db-admin.ts 작성 (Service Role 클라이언트)**

`~/coding/ourstory/src/lib/db-admin.ts`:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../db/schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 미설정");

export const sql = postgres(url, { prepare: false });
export const db = drizzle(sql, { schema });
```

- [ ] **Step 2: parties.json 작성 (jp-in-gn 이식 + 확장)**

`~/coding/ourstory/data/seed/parties.json`:

```json
[
  {
    "id": "justice", "name": "정의당", "family": "justice", "color": "#FFCC00",
    "aliases": ["정의당", "녹색정의당"], "activeFrom": "2012-10-22"
  },
  {
    "id": "labor", "name": "노동당", "family": "labor", "color": "#A50034",
    "aliases": ["노동당", "진보신당", "진보신당연대회의"], "activeFrom": "2008-03-16"
  },
  {
    "id": "green", "name": "녹색당", "family": "green", "color": "#1B7339",
    "aliases": ["녹색당"], "activeFrom": "2012-03-04"
  },
  {
    "id": "progressive", "name": "진보당", "family": "progressive", "color": "#D6001C",
    "aliases": ["진보당", "민중당"], "activeFrom": "2020-06-01"
  },
  {
    "id": "minlabour", "name": "민주노동당", "family": "historical_progressive", "color": "#E6004C",
    "aliases": ["민주노동당"], "activeFrom": "2000-01-30", "activeUntil": "2011-12-05"
  },
  {
    "id": "unified_progressive", "name": "통합진보당", "family": "historical_progressive", "color": "#D6001C",
    "aliases": ["통합진보당"], "activeFrom": "2011-12-06", "activeUntil": "2014-12-19"
  },
  {
    "id": "people_united", "name": "민중연합당", "family": "historical_progressive", "color": "#D6001C",
    "aliases": ["민중연합당"], "activeFrom": "2016-02-27", "activeUntil": "2017-10-15"
  },
  {
    "id": "democratic", "name": "더불어민주당", "family": "major", "color": "#152484",
    "aliases": ["더불어민주당", "새정치민주연합", "민주당", "통합민주당", "열린우리당", "민주통합당"],
    "activeFrom": "2014-03-26"
  },
  {
    "id": "democratic_alliance_2024", "name": "더불어민주연합", "family": "major", "color": "#152484",
    "aliases": ["더불어민주연합", "더불어시민당"], "satelliteOf": "democratic",
    "activeFrom": "2024-03-03"
  },
  {
    "id": "open_democratic", "name": "열린민주당", "family": "major", "color": "#3A86C2",
    "aliases": ["열린민주당"], "satelliteOf": "democratic",
    "activeFrom": "2020-03-08", "activeUntil": "2022-01-18"
  },
  {
    "id": "people_power", "name": "국민의힘", "family": "major", "color": "#E61E2B",
    "aliases": ["국민의힘", "미래통합당", "자유한국당", "새누리당", "한나라당"],
    "activeFrom": "2020-09-02"
  },
  {
    "id": "future_korea", "name": "미래한국당", "family": "major", "color": "#D62D3A",
    "aliases": ["미래한국당"], "satelliteOf": "people_power",
    "activeFrom": "2020-02-05", "activeUntil": "2020-05-29"
  },
  {
    "id": "people_future_2024", "name": "국민의미래", "family": "major", "color": "#D62D3A",
    "aliases": ["국민의미래"], "satelliteOf": "people_power", "activeFrom": "2024-02-13"
  },
  {
    "id": "rebuilding_korea_2024", "name": "조국혁신당", "family": "other", "color": "#06275E",
    "aliases": ["조국혁신당"], "activeFrom": "2024-03-03"
  },
  {
    "id": "reform", "name": "개혁신당", "family": "other", "color": "#FF7920",
    "aliases": ["개혁신당"], "activeFrom": "2024-01-20"
  },
  {
    "id": "basic_income", "name": "기본소득당", "family": "other", "color": "#00D2C3",
    "aliases": ["기본소득당"], "activeFrom": "2020-01-19"
  },
  {
    "id": "independent", "name": "무소속", "family": "other", "color": "#9CA3AF",
    "aliases": ["무소속"]
  },
  {
    "id": "other", "name": "기타", "family": "other", "color": "#6B7280",
    "aliases": ["기타"]
  }
]
```

> **메모:** "권영국(2025 대선 민주노동당) → 정의당 합산" 같은 케이스는 alias 가 아니라 candidate_overrides 로 처리. 이 plan 에선 후보자 매핑까지 안 다룸 (Phase 1.1 에서 처리). Phase 1.0 시점엔 위 시드만으로 충분.

- [ ] **Step 3: 시드 스크립트**

`~/coding/ourstory/scripts/ingest/seed/02-parties.ts`:

```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sql, db } from "../../../src/lib/db-admin";
import { parties, partyAliases } from "../../../db/schema";

interface SeedParty {
  id: string;
  name: string;
  family: string;
  color: string;
  satelliteOf?: string;
  activeFrom?: string;
  activeUntil?: string;
  aliases: string[];
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(HERE, "..", "..", "..", "data", "seed", "parties.json");

const raw = await readFile(SEED_PATH, "utf-8");
const seed: SeedParty[] = JSON.parse(raw);

// satelliteOf 가 본당을 참조하므로 본당 먼저 → 위성 나중 순서로 정렬
const ordered = [...seed].sort((a, b) => {
  if (!a.satelliteOf && b.satelliteOf) return -1;
  if (a.satelliteOf && !b.satelliteOf) return 1;
  return 0;
});

for (const p of ordered) {
  await db.insert(parties).values({
    id: p.id,
    name: p.name,
    family: p.family,
    color: p.color,
    satelliteOf: p.satelliteOf,
    activeFrom: p.activeFrom,
    activeUntil: p.activeUntil,
  }).onConflictDoUpdate({
    target: parties.id,
    set: {
      name: p.name, family: p.family, color: p.color,
      satelliteOf: p.satelliteOf, activeFrom: p.activeFrom, activeUntil: p.activeUntil,
    },
  });

  for (const alias of p.aliases) {
    await db.insert(partyAliases).values({
      alias, partyId: p.id, validFrom: p.activeFrom ?? "1900-01-01",
    }).onConflictDoNothing();
  }
}

const partyCount = (await db.select().from(parties)).length;
const aliasCount = (await db.select().from(partyAliases)).length;
console.log(`✓ parties=${partyCount}, party_aliases=${aliasCount}`);
await sql.end();
```

- [ ] **Step 4: 시드 실행**

```bash
pnpm ingest:seed:parties
```

Expected: `✓ parties=18, party_aliases=30+`

- [ ] **Step 5: Supabase 대시보드에서 확인**

Table Editor → `parties` → 18개 행, 색상·family 가 정확한지 시선 검수.

- [ ] **Step 6: 커밋**

```bash
git add data/seed/parties.json src/lib/db-admin.ts scripts/ingest/seed/02-parties.ts
git commit -m "parties + party_aliases 시드 (18개 정당)"
git push
```

---

## Task 6: 선거 시드 (Phase 1 대상 elections)

**Files:**
- Create: `~/coding/ourstory/data/seed/elections.json`
- Create: `~/coding/ourstory/scripts/ingest/seed/03-elections.ts`

- [ ] **Step 1: elections.json 작성**

Phase 1 대상: 2018·2022·2026 지선(7종 각) + 2020·2024 총선(2종 각) + 2022·2025 대선 + 재보궐 2건. 총 ~30개.

`~/coding/ourstory/data/seed/elections.json`:

```json
[
  { "id": "2018-local-governor", "date": "2018-06-13", "type": "governor",
    "name": "제7회 지방선거 — 시·도지사", "necElectionId": "0000000000", "necCode": "3", "displayOrder": 1 },
  { "id": "2018-local-mayor", "date": "2018-06-13", "type": "mayor",
    "name": "제7회 지방선거 — 시장·군수·구청장", "necElectionId": "0000000000", "necCode": "4", "displayOrder": 2 },
  { "id": "2018-local-council", "date": "2018-06-13", "type": "local_council",
    "name": "제7회 지방선거 — 시·도의원 지역구", "necElectionId": "0000000000", "necCode": "5", "displayOrder": 3 },
  { "id": "2018-local-council-prop", "date": "2018-06-13", "type": "local_council_prop",
    "name": "제7회 지방선거 — 시·도의원 비례", "necElectionId": "0000000000", "necCode": "8", "displayOrder": 4 },
  { "id": "2018-local-council-basic", "date": "2018-06-13", "type": "local_council_basic",
    "name": "제7회 지방선거 — 구·시·군의원 지역구", "necElectionId": "0000000000", "necCode": "6", "displayOrder": 5 },
  { "id": "2018-local-council-basic-prop", "date": "2018-06-13", "type": "local_council_basic_prop",
    "name": "제7회 지방선거 — 구·시·군의원 비례", "necElectionId": "0000000000", "necCode": "9", "displayOrder": 6 },
  { "id": "2018-local-superintendent", "date": "2018-06-13", "type": "superintendent",
    "name": "제7회 지방선거 — 교육감", "necElectionId": "0000000000", "necCode": "11", "displayOrder": 7 },

  { "id": "2019-byelection-changwon", "date": "2019-04-03", "type": "byelection",
    "name": "2019 4·3 재·보궐선거 (창원성산 국회의원)", "isByelection": true, "displayOrder": 8 },
  { "id": "2019-byelection-tongyeong", "date": "2019-04-03", "type": "byelection",
    "name": "2019 4·3 재·보궐선거 (통영고성 국회의원)", "isByelection": true, "displayOrder": 9 },

  { "id": "2020-general", "date": "2020-04-15", "type": "general",
    "name": "제21대 국회의원선거 — 지역구", "necElectionId": "0000000000", "necCode": "2", "displayOrder": 10 },
  { "id": "2020-general-prop", "date": "2020-04-15", "type": "general_prop",
    "name": "제21대 국회의원선거 — 비례대표", "necElectionId": "0000000000", "necCode": "7", "displayOrder": 11 },

  { "id": "2022-presidential", "date": "2022-03-09", "type": "presidential",
    "name": "제20대 대통령선거", "necElectionId": "0000000000", "necCode": "1", "displayOrder": 12 },

  { "id": "2022-local-governor", "date": "2022-06-01", "type": "governor",
    "name": "제8회 지방선거 — 시·도지사", "necElectionId": "0000000000", "necCode": "3", "displayOrder": 13 },
  { "id": "2022-local-mayor", "date": "2022-06-01", "type": "mayor",
    "name": "제8회 지방선거 — 시장·군수·구청장", "necElectionId": "0000000000", "necCode": "4", "displayOrder": 14 },
  { "id": "2022-local-council", "date": "2022-06-01", "type": "local_council",
    "name": "제8회 지방선거 — 시·도의원 지역구", "necElectionId": "0000000000", "necCode": "5", "displayOrder": 15 },
  { "id": "2022-local-council-prop", "date": "2022-06-01", "type": "local_council_prop",
    "name": "제8회 지방선거 — 시·도의원 비례", "necElectionId": "0000000000", "necCode": "8", "displayOrder": 16 },
  { "id": "2022-local-council-basic", "date": "2022-06-01", "type": "local_council_basic",
    "name": "제8회 지방선거 — 구·시·군의원 지역구", "necElectionId": "0000000000", "necCode": "6", "displayOrder": 17 },
  { "id": "2022-local-council-basic-prop", "date": "2022-06-01", "type": "local_council_basic_prop",
    "name": "제8회 지방선거 — 구·시·군의원 비례", "necElectionId": "0000000000", "necCode": "9", "displayOrder": 18 },
  { "id": "2022-local-superintendent", "date": "2022-06-01", "type": "superintendent",
    "name": "제8회 지방선거 — 교육감", "necElectionId": "0000000000", "necCode": "11", "displayOrder": 19 },

  { "id": "2024-general", "date": "2024-04-10", "type": "general",
    "name": "제22대 국회의원선거 — 지역구", "necElectionId": "0000000000", "necCode": "2", "displayOrder": 20 },
  { "id": "2024-general-prop", "date": "2024-04-10", "type": "general_prop",
    "name": "제22대 국회의원선거 — 비례대표", "necElectionId": "0000000000", "necCode": "7", "displayOrder": 21 },

  { "id": "2025-presidential", "date": "2025-06-03", "type": "presidential",
    "name": "제21대 대통령선거", "necElectionId": "0020250603", "necCode": "1", "displayOrder": 22 },

  { "id": "2025-byelection-yangsan", "date": "2025-04-02", "type": "byelection",
    "name": "2025 4·2 재·보궐선거 (양산시의원 마선거구)", "isByelection": true, "displayOrder": 23 },

  { "id": "2026-local-governor", "date": "2026-06-03", "type": "governor",
    "name": "제9회 지방선거 — 시·도지사", "necElectionId": "0020260603", "necCode": "3", "displayOrder": 30 },
  { "id": "2026-local-mayor", "date": "2026-06-03", "type": "mayor",
    "name": "제9회 지방선거 — 시장·군수·구청장", "necElectionId": "0020260603", "necCode": "4", "displayOrder": 31 },
  { "id": "2026-local-council", "date": "2026-06-03", "type": "local_council",
    "name": "제9회 지방선거 — 시·도의원 지역구", "necElectionId": "0020260603", "necCode": "5", "displayOrder": 32 },
  { "id": "2026-local-council-prop", "date": "2026-06-03", "type": "local_council_prop",
    "name": "제9회 지방선거 — 시·도의원 비례", "necElectionId": "0020260603", "necCode": "8", "displayOrder": 33 },
  { "id": "2026-local-council-basic", "date": "2026-06-03", "type": "local_council_basic",
    "name": "제9회 지방선거 — 구·시·군의원 지역구", "necElectionId": "0020260603", "necCode": "6", "displayOrder": 34 },
  { "id": "2026-local-council-basic-prop", "date": "2026-06-03", "type": "local_council_basic_prop",
    "name": "제9회 지방선거 — 구·시·군의원 비례", "necElectionId": "0020260603", "necCode": "9", "displayOrder": 35 },
  { "id": "2026-local-superintendent", "date": "2026-06-03", "type": "superintendent",
    "name": "제9회 지방선거 — 교육감", "necElectionId": "0020260603", "necCode": "11", "displayOrder": 36 }
]
```

- [ ] **Step 2: 시드 스크립트**

`~/coding/ourstory/scripts/ingest/seed/03-elections.ts`:

```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sql, db } from "../../../src/lib/db-admin";
import { elections } from "../../../db/schema";

interface SeedElection {
  id: string;
  date: string;
  type: string;
  name: string;
  necElectionId?: string;
  necCode?: string;
  isByelection?: boolean;
  displayOrder?: number;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(HERE, "..", "..", "..", "data", "seed", "elections.json");

const seed: SeedElection[] = JSON.parse(await readFile(SEED_PATH, "utf-8"));

for (const e of seed) {
  await db.insert(elections).values({
    id: e.id, date: e.date, type: e.type, name: e.name,
    necElectionId: e.necElectionId, necCode: e.necCode,
    isByelection: e.isByelection ?? false, displayOrder: e.displayOrder,
  }).onConflictDoUpdate({
    target: elections.id,
    set: {
      date: e.date, type: e.type, name: e.name,
      necElectionId: e.necElectionId, necCode: e.necCode,
      isByelection: e.isByelection ?? false, displayOrder: e.displayOrder,
    },
  });
}

const count = (await db.select().from(elections)).length;
console.log(`✓ elections=${count}`);
await sql.end();
```

- [ ] **Step 3: 실행 + 검증 + 커밋**

```bash
pnpm ingest:seed:elections
```

Expected: `✓ elections=30`

```bash
git add data/seed/elections.json scripts/ingest/seed/03-elections.ts
git commit -m "elections 시드 (Phase 1 대상 30개 선거)"
git push
```

---

## Task 7: regions 시드 (행안부 법정동코드)

**Files:**
- Create: `~/coding/ourstory/scripts/ingest/seed/01-regions.ts`
- Create: `~/coding/ourstory/data/seed/legaldong-source.txt` (다운로드)

행안부에서 무료로 제공하는 법정동코드 파일을 다운로드해 변환·시드.

- [ ] **Step 1: 행안부 법정동코드 파일 다운로드 (수동)**

사용자에게 안내:

1. https://www.code.go.kr/stdcode/regCodeL.do 접속
2. "전체자료" 텍스트 파일 다운로드
3. `~/coding/ourstory/data/seed/legaldong-source.txt` 로 저장 (EUC-KR 인코딩)

파일 형식 (탭 구분):
```
1100000000	서울특별시	존재
1111000000	서울특별시 종로구	존재
1111051500	서울특별시 종로구 청운효자동	존재
...
```

- [ ] **Step 2: 시드 스크립트**

`~/coding/ourstory/scripts/ingest/seed/01-regions.ts`:

```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import iconv from "iconv-lite";
import { sql, db } from "../../../src/lib/db-admin";
import { regions } from "../../../db/schema";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "..", "..", "data", "seed", "legaldong-source.txt");

const buf = await readFile(SRC);
const text = iconv.decode(buf, "euc-kr");
const lines = text.split(/\r?\n/).filter(Boolean);

// 법정동코드 10자리. 시·도=마지막 8자리 0, 시·군·구=마지막 5자리 0, 읍·면·동=나머지
function levelOf(code: string): "sido" | "sigungu" | "emd" {
  if (code.endsWith("00000000")) return "sido";
  if (code.endsWith("00000")) return "sigungu";
  return "emd";
}

function parentOf(code: string): string | null {
  const lv = levelOf(code);
  if (lv === "sido") return null;
  if (lv === "sigungu") return code.slice(0, 2) + "00000000";
  return code.slice(0, 5) + "00000";
}

interface Row { code: string; name: string; status: string; }

const rows: Row[] = lines.map((line) => {
  const [code, name, status] = line.split("\t");
  return { code, name, status };
}).filter((r) => r.code && r.status === "존재");

console.log(`총 ${rows.length} 행 — 시·도/시·군/읍·면·동 분류 후 적재`);

// 시·도 먼저 → 시·군 → 읍·면·동 순서 (외래키 안전)
for (const lv of ["sido", "sigungu", "emd"] as const) {
  const subset = rows.filter((r) => levelOf(r.code) === lv);
  console.log(`  ${lv}: ${subset.length}건`);

  // 시·도/시·군 의 name 은 마지막 토큰만 사용 ("서울특별시 종로구" → "종로구")
  const batch = subset.map((r) => {
    const tokens = r.name.split(/\s+/);
    const displayName = tokens[tokens.length - 1];
    return {
      code: r.code,
      level: lv,
      name: displayName,
      parentCode: parentOf(r.code),
    };
  });

  // 배치 upsert (1000개씩)
  for (let i = 0; i < batch.length; i += 1000) {
    const chunk = batch.slice(i, i + 1000);
    await db.insert(regions).values(chunk).onConflictDoUpdate({
      target: regions.code,
      set: { level: regions.level, name: regions.name, parentCode: regions.parentCode } as any,
    });
  }
}

const counts = await sql<{ level: string; n: number }[]>`
  SELECT level, count(*)::int AS n FROM regions GROUP BY level ORDER BY level
`;
console.log("최종 적재:", counts);
await sql.end();
```

- [ ] **Step 3: iconv-lite 의존성 추가**

```bash
pnpm add iconv-lite
```

- [ ] **Step 4: 실행**

```bash
pnpm ingest:seed:regions
```

Expected: `sido: 17`, `sigungu: 250±`, `emd: 3500±`. 정확한 수치는 행안부 데이터 기준.

- [ ] **Step 5: SQL 로 검증**

```bash
pnpm dotenv -e .env.local -- tsx -e 'import postgres from "postgres"; const sql = postgres(process.env.DATABASE_URL!); sql`SELECT name FROM regions WHERE code = ${"4800000000"}`.then(r => { console.log(r); sql.end(); });'
```

Expected: `[{ name: '경상남도' }]`

- [ ] **Step 6: 커밋 — legaldong-source.txt 는 LFS 또는 gitignore**

`.gitignore` 에 추가:

```
data/seed/legaldong-source.txt
```

```bash
git add scripts/ingest/seed/01-regions.ts package.json .gitignore
git commit -m "regions 시드 (행안부 법정동코드, 시·도+시·군·구+읍·면·동)"
git push
```

---

## Task 8: party-mapping 라이브러리 + 단위 테스트 (TDD)

**Files:**
- Create: `~/coding/ourstory/tests/unit/party-mapping.test.ts`
- Create: `~/coding/ourstory/scripts/ingest/lib/party-mapping.ts`

- [ ] **Step 1: 실패하는 테스트 먼저 (순수 함수로 — DB 의존 X)**

`~/coding/ourstory/tests/unit/party-mapping.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolvePartyId, type AliasRow } from "../../scripts/ingest/lib/party-mapping";

// 픽스처 — Supabase 호출 없이 순수 로직 검증
const ALIASES: AliasRow[] = [
  { alias: "정의당", party_id: "justice", valid_from: "2012-10-22", valid_until: null },
  { alias: "녹색정의당", party_id: "justice", valid_from: "2024-02-12", valid_until: "2024-06-08" },
  { alias: "더불어민주당", party_id: "democratic", valid_from: "2014-03-26", valid_until: null },
  { alias: "더불어민주연합", party_id: "democratic_alliance_2024", valid_from: "2024-03-03", valid_until: null },
  { alias: "국민의미래", party_id: "people_future_2024", valid_from: "2024-02-13", valid_until: null },
  { alias: "새누리당", party_id: "people_power", valid_from: "2012-02-13", valid_until: "2017-02-13" },
  { alias: "국민의힘", party_id: "people_power", valid_from: "2020-09-02", valid_until: null },
  { alias: "민주노동당", party_id: "minlabour", valid_from: "2000-01-30", valid_until: "2011-12-05" },
];

describe("party-mapping", () => {
  it("정확 매칭", () => {
    expect(resolvePartyId("정의당", "2024-04-10", ALIASES)).toBe("justice");
    expect(resolvePartyId("녹색정의당", "2024-04-10", ALIASES)).toBe("justice");
    expect(resolvePartyId("더불어민주당", "2024-04-10", ALIASES)).toBe("democratic");
  });

  it("위성정당 본당 매핑 안 함 (각자 ID 유지)", () => {
    expect(resolvePartyId("더불어민주연합", "2024-04-10", ALIASES)).toBe("democratic_alliance_2024");
    expect(resolvePartyId("국민의미래", "2024-04-10", ALIASES)).toBe("people_future_2024");
  });

  it("시대별 매핑: 옛 이름이 옛 시점에서 동작", () => {
    expect(resolvePartyId("새누리당", "2016-04-13", ALIASES)).toBe("people_power");
    expect(resolvePartyId("민주노동당", "2008-04-09", ALIASES)).toBe("minlabour");
  });

  it("시대별 매핑: 옛 이름이 만료 후엔 매칭 안 됨", () => {
    expect(resolvePartyId("새누리당", "2020-04-15", ALIASES)).toBeNull();
    expect(resolvePartyId("민주노동당", "2012-04-11", ALIASES)).toBeNull();
  });

  it("미매핑은 null", () => {
    expect(resolvePartyId("존재하지않는당", "2024-04-10", ALIASES)).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
pnpm test tests/unit/party-mapping.test.ts
```

Expected: FAIL — `Cannot find module '../../scripts/ingest/lib/party-mapping'`

- [ ] **Step 3: 라이브러리 구현 (순수 함수 + 별도 DB 로더)**

`~/coding/ourstory/scripts/ingest/lib/party-mapping.ts`:

```ts
import { sql } from "../../../src/lib/db-admin";

export interface AliasRow {
  alias: string;
  party_id: string;
  valid_from: string | null;
  valid_until: string | null;
}

/**
 * NEC 원본 정당 표기를 우리 party_id 로 해석. 순수 함수.
 * onDate (YYYY-MM-DD) 시점 기준 valid 한 alias 만 매칭.
 * 매칭 안 되면 null.
 */
export function resolvePartyId(
  rawName: string,
  onDate: string,
  aliases: AliasRow[],
): string | null {
  const candidates = aliases.filter((r) => r.alias === rawName);
  for (const c of candidates) {
    const after = !c.valid_from || c.valid_from <= onDate;
    const before = !c.valid_until || onDate <= c.valid_until;
    if (after && before) return c.party_id;
  }
  return null;
}

/** Supabase 에서 alias 전체 로드. 인제스천 스크립트가 1회 호출 후 resolvePartyId 에 전달. */
export async function loadAliases(): Promise<AliasRow[]> {
  return await sql<AliasRow[]>`
    SELECT alias, party_id, valid_from, valid_until FROM party_aliases
  `;
}
```

- [ ] **Step 4: 테스트 재실행 (PASS 확인)**

```bash
pnpm test tests/unit/party-mapping.test.ts
```

Expected: 5 PASS.

- [ ] **Step 5: 커밋**

```bash
git add tests/unit/party-mapping.test.ts scripts/ingest/lib/party-mapping.ts
git commit -m "party-mapping 라이브러리 + 단위 테스트 (시대별 alias 해석)"
git push
```

---

## Task 9: nec-html 파서 + 단위 테스트 (TDD)

**Files:**
- Create: `~/coding/ourstory/tests/fixtures/nec-vccp08-2025-jinju.html` (실제 캡처본)
- Create: `~/coding/ourstory/tests/unit/nec-html.test.ts`
- Create: `~/coding/ourstory/scripts/ingest/lib/nec-html.ts`

- [ ] **Step 1: 픽스처 HTML 수집**

```bash
mkdir -p tests/fixtures
curl -sS -X POST "http://info.nec.go.kr/electioninfo/electionInfo_report.xhtml" \
  -H "User-Agent: Mozilla/5.0" -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "electionId=0020250603" \
  --data-urlencode "requestURI=/electioninfo/0020250603/vc/vccp08.jsp" \
  --data-urlencode "topMenuId=VC" --data-urlencode "secondMenuId=VCCP08" \
  --data-urlencode "menuId=VCCP08" --data-urlencode "statementId=VCCP08_#1" \
  --data-urlencode "electionCode=1" --data-urlencode "cityCode=4800" \
  --data-urlencode "townCode=4803" --data-urlencode "searchMode=1" \
  -o tests/fixtures/nec-vccp08-2025-jinju.html
ls -la tests/fixtures/
```

Expected: `nec-vccp08-2025-jinju.html` ~45KB.

- [ ] **Step 2: 실패하는 테스트**

`~/coding/ourstory/tests/unit/nec-html.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseVccpAggregate } from "../../scripts/ingest/lib/nec-html";

const FIXTURE = path.join(__dirname, "..", "fixtures", "nec-vccp08-2025-jinju.html");

describe("nec-html parser", () => {
  it("2025 진주시 대선 합계 파싱", async () => {
    const html = await readFile(FIXTURE, "utf-8");
    const result = parseVccpAggregate(html);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.totalVoters).toBe(289796);
    expect(result.totalVotes).toBe(231564);
    expect(result.validVotes).toBe(229518);

    // 5명 후보 (대선이므로 정당+후보명 결합)
    expect(result.parties.length).toBe(5);

    const find = (name: string) => result.parties.find((p) => p.name === name);
    expect(find("더불어민주당이재명")?.votes).toBe(80491);
    expect(find("국민의힘김문수")?.votes).toBe(127358);
    expect(find("개혁신당이준석")?.votes).toBe(19197);
    expect(find("민주노동당권영국")?.votes).toBe(2198);
    expect(find("무소속송진호")?.votes).toBe(274);
  });

  it("빈 응답 ('검색된 결과가 없습니다') 처리", () => {
    const html = `<table id="table01"><tbody><tr><td colspan="7" class="alignC">검색된 결과가 없습니다.</td></tr></tbody></table>`;
    const result = parseVccpAggregate(html);
    expect(result.kind).toBe("no-data");
  });

  it("정당 컬럼 0개면 no-data", () => {
    const html = `<table id="table01">
      <thead><tr><th>읍면동명</th><th>구분</th><th>선거인수</th><th>투표수</th><th>무효</th><th>기권자수</th></tr></thead>
      <tbody><tr><td>합계</td><td></td><td>100</td><td>50</td><td>2</td><td>48</td></tr></tbody>
    </table>`;
    const result = parseVccpAggregate(html);
    expect(result.kind).toBe("no-data");
  });
});
```

- [ ] **Step 3: 테스트 실행 (실패 확인)**

```bash
pnpm test tests/unit/nec-html.test.ts
```

Expected: FAIL — `Cannot find module '../../scripts/ingest/lib/nec-html'`

- [ ] **Step 4: 파서 구현 (jp-in-gn 의 패턴 이식 + 정교화)**

`~/coding/ourstory/scripts/ingest/lib/nec-html.ts`:

```ts
import * as cheerio from "cheerio";

export interface ParsedParty {
  name: string;
  votes: number;
}

export type ParseResult =
  | {
      kind: "ok";
      parties: ParsedParty[];
      totalVoters: number;
      totalVotes: number;
      validVotes: number;
      invalidVotes: number;
    }
  | { kind: "no-data" };

const META_HEADERS = new Set([
  "읍면동명", "투표구명", "구분", "선거인수", "투표수",
  "정당별 득표수", "후보자별 득표수",
  "계", "무효", "무효투표수", "기권자수",
]);

/**
 * info.nec.go.kr VCCP08(최근 선거) 또는 VCCP04(역대) 페이지의 "합계" 행을 파싱.
 *
 * 컬럼 구조: 읍면동명 | (투표구명 or 구분) | 선거인수 | 투표수 |
 *           [정당/후보별 득표 N개] | 계(유효) | 무효 | 기권자수
 */
export function parseVccpAggregate(html: string): ParseResult {
  const $ = cheerio.load(html);

  // 빈 응답 감지
  const firstRow = $("table#table01 tbody tr").first();
  const firstCellText = firstRow.find("td").first().text().trim();
  if (!firstRow.length || firstCellText.includes("검색된 결과가 없습니다")) {
    return { kind: "no-data" };
  }
  if (firstCellText !== "합계") return { kind: "no-data" };

  // 정당명 (헤더 — 메타 컬럼 제외)
  const partyNames: string[] = [];
  $("table#table01 thead th").each((_, th) => {
    const t = $(th).text().trim();
    if (!t || META_HEADERS.has(t)) return;
    partyNames.push(t);
  });

  if (partyNames.length === 0) return { kind: "no-data" };

  // 본문 셀
  const cells = firstRow
    .find("td")
    .map((_, td) => $(td).text().trim().replace(/,/g, ""))
    .get();

  // 셀 구조: [읍면동명, 투표구명, 선거인수, 투표수, ...정당 N개, 계, 무효, 기권]
  if (cells.length < 4 + partyNames.length + 3) return { kind: "no-data" };

  const totalVoters = Number(cells[2]) || 0;
  const totalVotes = Number(cells[3]) || 0;
  const partyCells = cells.slice(4, 4 + partyNames.length);
  const tailStart = 4 + partyNames.length;
  const validVotes = Number(cells[tailStart]) || 0;
  const invalidVotes = Number(cells[tailStart + 1]) || 0;

  return {
    kind: "ok",
    parties: partyNames.map((name, i) => ({ name, votes: Number(partyCells[i]) || 0 })),
    totalVoters,
    totalVotes,
    validVotes,
    invalidVotes,
  };
}
```

- [ ] **Step 5: 테스트 재실행 (PASS 확인)**

```bash
pnpm test tests/unit/nec-html.test.ts
```

Expected: 3 PASS.

- [ ] **Step 6: 커밋**

```bash
git add tests/ scripts/ingest/lib/nec-html.ts
git commit -m "nec-html 파서 + 단위 테스트 (VCCP08 합계 행)"
git push
```

---

## Task 10: 클라이언트용 DB 모듈 (anon)

**Files:**
- Create: `~/coding/ourstory/src/lib/db.ts`

- [ ] **Step 1: anon 클라이언트 모듈**

`~/coding/ourstory/src/lib/db.ts`:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../db/schema";

// Server Components 에서 사용. anon 키 + RLS 로 SELECT 만 허용.
// DATABASE_URL 은 서버에서만 접근 가능 (PUBLIC_ 접두 없음).
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 미설정 (서버 환경에서만 호출)");

export const sql = postgres(url, { prepare: false, max: 5 });
export const db = drizzle(sql, { schema });
```

- [ ] **Step 2: RLS 정책 적용 (Supabase 대시보드 SQL Editor)**

사용자에게 안내: Supabase Dashboard → SQL Editor 에서 다음 실행:

```sql
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE vote_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE region_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON regions FOR SELECT USING (true);
CREATE POLICY "public read" ON elections FOR SELECT USING (true);
CREATE POLICY "public read" ON parties FOR SELECT USING (true);
CREATE POLICY "public read" ON party_aliases FOR SELECT USING (true);
CREATE POLICY "public read" ON vote_totals FOR SELECT USING (true);
CREATE POLICY "public read" ON region_totals FOR SELECT USING (true);
CREATE POLICY "public read" ON candidates FOR SELECT USING (true);
```

> Service Role 키는 RLS bypass. 인제스천 (db-admin.ts) 에는 영향 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/lib/db.ts
git commit -m "anon DB 클라이언트 모듈 + RLS 공개 읽기 정책"
git push
```

---

## Task 11: UI 셸 (헤더·푸터·다크모드)

**Files:**
- Modify: `~/coding/ourstory/src/app/layout.tsx`
- Modify: `~/coding/ourstory/src/app/page.tsx`
- Modify: `~/coding/ourstory/src/app/globals.css`
- Create: `~/coding/ourstory/src/components/Header.tsx`
- Create: `~/coding/ourstory/src/components/Footer.tsx`
- Create: `~/coding/ourstory/src/components/ThemeToggle.tsx`

- [ ] **Step 1: layout.tsx 작성**

`~/coding/ourstory/src/app/layout.tsx` 전체 교체:

```tsx
import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "ourstory — 진보계열 정당 역대 선거 분석",
  description: "전국 시·도, 시·군·구, 읍·면·동 단위로 진보계열 정당의 선거 결과를 시계열로 확인합니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const t = localStorage.getItem('theme');
                if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark');
                }
              } catch {}
            `,
          }}
        />
        <Header />
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
```

- [ ] **Step 2: globals.css 단순화**

`~/coding/ourstory/src/app/globals.css`:

```css
@import "tailwindcss";

@theme {
  --color-justice: #FFCC00;
  --color-labor: #A50034;
  --color-green: #1B7339;
  --color-progressive: #D6001C;
  --color-democratic: #152484;
  --color-people-power: #E61E2B;
}

html { color-scheme: light dark; }
html.dark { color-scheme: dark; }
```

- [ ] **Step 3: Header 컴포넌트**

`~/coding/ourstory/src/components/Header.tsx`:

```tsx
import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          ourstory
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="hover:underline">홈</Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Footer 컴포넌트**

`~/coding/ourstory/src/components/Footer.tsx`:

```tsx
export function Footer() {
  return (
    <footer className="mt-12 border-t border-zinc-200 py-6 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      <div className="mx-auto max-w-7xl px-4">
        데이터 출처: 중앙선거관리위원회 · 공공데이터포털 ·{" "}
        <a
          href="https://github.com/learn-slowly/ourstory_party"
          className="underline"
          target="_blank"
          rel="noopener"
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}
```

- [ ] **Step 5: ThemeToggle 컴포넌트**

`~/coding/ourstory/src/components/ThemeToggle.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
  };

  if (dark === null) return <span aria-hidden className="inline-block w-10" />;

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      aria-label="테마 전환"
    >
      {dark ? "라이트" : "다크"}
    </button>
  );
}
```

- [ ] **Step 6: 홈 placeholder**

`~/coding/ourstory/src/app/page.tsx`:

```tsx
import { sql } from "@/lib/db";

export default async function Home() {
  const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM parties`;
  const partyCount = rows[0]?.n ?? 0;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">ourstory</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        진보계열 정당 역대 선거 분석 (시·도·시·군·구·읍·면·동).
      </p>
      <div className="rounded border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900">
        시드된 정당 수: <strong>{partyCount}</strong>. Phase 1.1 데이터 인제스천 이후 본격 화면.
      </div>
    </div>
  );
}
```

- [ ] **Step 7: 로컬 실행 확인**

```bash
pnpm dev
```

브라우저 `http://localhost:3000` 접속.

Expected:
- 헤더에 "ourstory" 로고 + 다크/라이트 토글
- "시드된 정당 수: 18" 표시
- 다크 토글이 동작
- Footer 에 데이터 출처 + GitHub 링크
- 콘솔 오류 없음

- [ ] **Step 8: 커밋**

```bash
git add src/
git commit -m "UI 셸 (헤더·푸터·다크모드 + 홈 placeholder, 정당 수 표시)"
git push
```

---

## Task 12: Vercel 배포 + 스모크 테스트

**Files:**
- (Vercel 측 설정)

- [ ] **Step 1: Vercel 프로젝트 연결**

사용자 안내:

1. https://vercel.com/new 접속
2. GitHub → `learn-slowly/ourstory_party` import
3. Framework Preset: Next.js (자동)
4. Environment Variables 추가 (production 만):
   - `DATABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (라이브 잡 미사용 시 생략 가능)
   - `NEC_INGEST_USER_AGENT`
5. Deploy

Expected: 빌드 성공, `ourstory-xxx.vercel.app` URL 생성.

- [ ] **Step 2: 배포 스모크 테스트**

```bash
curl -s "https://<배포-URL>" | grep -o "시드된 정당 수: <strong>[0-9]\+</strong>"
```

Expected: `시드된 정당 수: <strong>18</strong>`

- [ ] **Step 3: 도메인 alias 적용 (선택)**

Vercel Project Settings → Domains → `ourstory.vercel.app` alias 설정.

- [ ] **Step 4: 마무리 커밋**

만약 README 에 라이브 URL 추가 등 마무리 변경이 있으면:

```bash
git add README.md
git commit -m "Phase 1.0 출시: 배포 URL README 반영"
git push
```

- [ ] **Step 5: jp-in-gn 의 design spec / plan 을 ourstory 로 이전**

```bash
mkdir -p docs/superpowers/{specs,plans}
cp ../jp-in-gn/docs/superpowers/specs/2026-06-04-ourstory-design.md docs/superpowers/specs/
cp ../jp-in-gn/docs/superpowers/plans/2026-06-04-ourstory-phase-1.0-infra.md docs/superpowers/plans/
git add docs/
git commit -m "설계 문서·Phase 1.0 plan 이전 (jp-in-gn → ourstory)"
git push
```

> jp-in-gn 쪽의 사본은 그대로 두어도 무방하지만, 시간이 지나면 정합성을 위해 jp-in-gn 에서 삭제하는 것을 권장.

---

## 완료 기준 (Phase 1.0 Done)

- [x] Vercel 배포 URL 에서 "시드된 정당 수" 가 18 로 표시
- [x] Supabase DB 에 regions(3700±), parties(18), party_aliases(30±), elections(30±) 행 존재
- [x] `pnpm test` 전부 PASS (party-mapping·nec-html 단위 테스트)
- [x] `pnpm verify:schema` 성공
- [x] 다크/라이트 토글 동작
- [x] GitHub repo `learn-slowly/ourstory_party` main 에 모든 커밋 푸시 완료

이 시점에서 Phase 1.1 (`2026-06-04-ourstory-phase-1.1-sigungu-data.md`) plan 을 새로 작성한다.
