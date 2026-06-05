# ourstory 정적 JSON 마이그레이션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supabase Postgres 의존 ourstory 를 NEC 다운로드 xlsx 기반의 정적 JSON 사이트로 마이그레이션 (Vercel 만으로 호스팅).

**Architecture:** xlsx (raw) → parser (형식 5종) → 중간 JSON → build-static (region 합산·시계열 precompute) → 정적 chunk (`/public/data/static/`). 페이지는 SSG, RSC 쿼리는 정적 import 함수로 교체. 라이브 페이지·GitHub Actions·Phase 4 폐기.

**Tech Stack:** Next.js 16 RSC (SSG) · TypeScript · Vitest · `xlsx` npm 패키지 (xlsx/xls 통합) · cheerio (archive HTML 폴백) · Vercel static.

**Spec:** docs/superpowers/specs/2026-06-06-ourstory-static-migration-design.md

---

## File Structure

### 신규 (생성)

```
scripts/build/
  ├ parse-nec-xlsx.ts          # 통합 CLI: <electionId> <rawDir> → parsed/{electionId}.json
  ├ lib/
  │  ├ xlsx-format-detect.ts   # 파일·시트 → 형식 (A·B·C·D·E) 자동 판정
  │  ├ parse-format-a.ts       # A형 (2024 지역구·비례, 2025 대선)
  │  ├ parse-format-b.ts       # B형 (2020·2016·2012 분리 파일)
  │  ├ parse-format-c.ts       # C형 (2022 대선·재보궐 row[0] 헤더)
  │  ├ parse-format-d.ts       # D형 (2012 .xls)
  │  ├ parse-format-e.ts       # E형 (NEC archive HTML 폴백 — 2007·2008)
  │  ├ party-resolver.ts       # rawName → partyId (parties.json + overrides)
  │  └ types.ts                # ParsedStationRow, ParsedElection, etc.
  ├ build-static.ts            # 통합 CLI: parsed/*.json → public/data/static/**
  └ lib/
     ├ aggregate-region.ts     # sigungu = Σ emd, sido = Σ sigungu
     ├ build-timeseries.ts     # region × party × election → timeseries
     ├ build-index.ts          # public/data/static/index.json
     ├ build-region.ts         # public/data/static/region/{code}.json + election-{id}.json
     └ build-station.ts        # public/data/static/station/{key}.json

public/data/static/            # 빌드 산출물 (gitignored — Vercel build 시 생성)
  ├ index.json
  ├ region/{code}.json
  ├ region/{code}/election-{id}.json
  └ station/{sigungu}-{emd}-{stationKey}.json

src/lib/static-data.ts         # RSC 페이지가 사용하는 정적 데이터 접근자
                               # (queries.ts 의 SQL 함수 교체본)
src/types/static.ts            # 정적 JSON 의 타입 (StaticIndex, RegionFile, …)
data/parsed/                   # 중간 JSON (gitignored, build 입력)
```

### 수정

```
src/app/page.tsx                       # SSG + static-data
src/app/region/[code]/page.tsx         # generateStaticParams + static-data
src/components/HeaderControls.tsx      # index.json 소비
src/components/region/*.tsx            # static 형식 props
.gitignore                             # data/parsed/, public/data/static/ 무시
package.json                           # scripts: build:parse / build:static / 라이브 스크립트 제거
.github/workflows/                     # poll-live.yml 삭제
```

### 삭제

```
src/app/live/                          # 라이브 페이지
src/components/LiveBoard.tsx
scripts/ingest/poll-live.ts
scripts/ingest/ingest-*.ts             # DB ingest (parser → build 로 대체)
scripts/ingest/fetch-polling-stations.ts  # archive HTML fetch (E형 폴백 외엔 사용 안 함)
.github/workflows/poll-live.yml
src/lib/db.ts
src/lib/db-admin.ts
drizzle.config.ts
db/schema.ts → docs/legacy/db-schema.ts (참고용 이동)
```

---

## Phase 1: xlsx Parser

### Task 1.1: 공통 타입 + party-resolver

**Files:**
- Create: `scripts/build/lib/types.ts`
- Create: `scripts/build/lib/party-resolver.ts`
- Test: `tests/unit/build/party-resolver.test.ts`

- [ ] **Step 1: types.ts 작성**

```typescript
// scripts/build/lib/types.ts
export type RowKind = "total" | "subtotal" | "el_day" | "presub" | "abs" | "absentee" | "overseas" | "misc";

export interface ParsedPartyVote {
  rawName: string;   // "더불어민주당\n곽상언" 또는 "정의당"
  votes: number;
}

export interface ParsedStationRow {
  sidoName: string;
  sigunguName: string;
  emdName: string | null;
  stationName: string | null;    // "청운효자동제1투" — kind=el_day/station 만
  kind: RowKind;
  totalVoters: number;
  totalVotes: number;
  validVotes: number;
  invalidVotes: number;
  parties: ParsedPartyVote[];
}

export interface ParsedElection {
  electionId: string;            // "2024-general"
  electionDate: string;          // "2024-04-10"
  rows: ParsedStationRow[];
  partyNames: string[];          // 발견된 모든 raw 정당/후보자명 (validate 용)
}
```

- [ ] **Step 2: party-resolver 테스트 작성**

```typescript
// tests/unit/build/party-resolver.test.ts
import { describe, it, expect } from "vitest";
import { resolveParty } from "../../../scripts/build/lib/party-resolver";

describe("resolveParty", () => {
  it("정당명+후보자 prefix 매칭", () => {
    expect(resolveParty("더불어민주당\n곽상언", "2024-04-10")).toBe("democratic");
    expect(resolveParty("자유한국당\n홍준표", "2017-05-09")).toBe("people_power");
  });
  it("정당명 단독 (비례)", () => {
    expect(resolveParty("녹색정의당", "2024-04-10")).toBe("justice");
  });
  it("election_party_overrides 우선", () => {
    // 2025 대선: 민주노동당 → justice
    expect(resolveParty("민주노동당\n권영국", "2025-06-03")).toBe("justice");
  });
  it("미매핑 후보 → null", () => {
    expect(resolveParty("듣도보도못한당\n홍길동", "2024-04-10")).toBe(null);
  });
});
```

- [ ] **Step 3: 테스트 실행 (실패 확인)**

Run: `pnpm vitest tests/unit/build/party-resolver.test.ts`
Expected: FAIL "Cannot find module"

- [ ] **Step 4: party-resolver 구현**

```typescript
// scripts/build/lib/party-resolver.ts
import { readFileSync } from "node:fs";
import path from "node:path";

interface PartySeed {
  id: string;
  aliases: string[];
  activeFrom?: string;
  activeUntil?: string;
}
interface Override {
  electionId: string;
  rawName: string;
  partyId: string;
}

const PARTIES: PartySeed[] = JSON.parse(
  readFileSync(path.resolve("data/seed/parties.json"), "utf-8"),
);
const OVERRIDES: Override[] = JSON.parse(
  readFileSync(path.resolve("data/seed/election-party-overrides.json"), "utf-8"),
);

// alias 길이 내림차순 — prefix match 시 가장 긴 것 우선
const ALIASES: { alias: string; partyId: string }[] = PARTIES.flatMap((p) =>
  p.aliases.map((a) => ({ alias: a, partyId: p.id })),
).sort((a, b) => b.alias.length - a.alias.length);

export function resolveParty(rawName: string, electionDate: string, electionId?: string): string | null {
  // 1) override 우선
  if (electionId) {
    for (const o of OVERRIDES) {
      if (o.electionId === electionId && rawName.startsWith(o.rawName)) return o.partyId;
    }
  }
  // 2) prefix match (≥3자 alias)
  for (const a of ALIASES) {
    if (a.alias.length >= 3 && rawName.startsWith(a.alias)) return a.partyId;
  }
  // 3) exact match (단일 정당명 — 비례)
  for (const a of ALIASES) {
    if (rawName.trim() === a.alias) return a.partyId;
  }
  return null;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest tests/unit/build/party-resolver.test.ts`
Expected: PASS 4/4

- [ ] **Step 6: Commit**

```bash
git add scripts/build/lib/types.ts scripts/build/lib/party-resolver.ts tests/unit/build/party-resolver.test.ts
git commit -m "build: 정당 매핑·공통 타입 (party-resolver)"
```

---

### Task 1.2: 형식 A parser (2024 지역구·비례, 2025 대선)

**Files:**
- Create: `scripts/build/lib/parse-format-a.ts`
- Test: `tests/unit/build/parse-format-a.test.ts`
- Fixture: `tests/fixtures/nec-xlsx/format-a-2024-sample.xlsx` (실제 22-general 의 작은 시·도 1개 추출본)

**형식 A 특징:**
- row[0]·row[1]·row[2] — 메타 (제목, 빈, 카테고리)
- row[3] header: `시도명·선거구명·구시군명·읍면동명·투표타입·선거인수·투표수·후보자별 득표수·계·무효투표수·기권수`
  - (비례는 `선거구명` 없음: `시도명·구시군명·읍면동명·투표구명·선거인수·투표수·후보자별 득표수·무효투표수·기권수`)
- row[4] = 후보자/정당명 ("더불어민주당\n곽상언" 또는 "더불어민주연합")
- row[5+] = 데이터

- [ ] **Step 1: fixture 작성 — 22-general 의 종로구 1 시·군 추출**

```bash
mkdir -p tests/fixtures/nec-xlsx
# 22-general 의 종로구 row 만 추출 — Python 으로 작은 xlsx 생성
python3 - <<'PY'
import openpyxl
src = openpyxl.load_workbook("data/raw/nec-downloads/22-general/01_1. 개표단위별 개표결과(지역구) -전국.xlsx", read_only=True, data_only=True)
ws_src = src.active
dst = openpyxl.Workbook()
ws_dst = dst.active
ws_dst.title = "제22대 국회의원선거(지역구)"
for i, row in enumerate(ws_src.iter_rows(values_only=True), 1):
    if i <= 5:
        ws_dst.append(list(row))
    elif row[0] == "서울특별시" and (row[1] == "종로구" or row[2] == "종로구"):
        ws_dst.append(list(row))
    elif i > 5 and not row[0]:  # 종로구 sub-row (시·도 컬럼 빈)
        # 직전 시·도가 종로구였는지 확인 위해 단순화 — 시·도/구시군 None 이고 직전이 종로구이면 포함
        ws_dst.append(list(row))
    if i > 100: break
dst.save("tests/fixtures/nec-xlsx/format-a-2024-sample.xlsx")
PY
```

- [ ] **Step 2: 테스트 작성**

```typescript
// tests/unit/build/parse-format-a.test.ts
import { describe, it, expect } from "vitest";
import { parseFormatA } from "../../../scripts/build/lib/parse-format-a";

describe("parseFormatA — 2024 지역구 종로구", () => {
  const fixture = "tests/fixtures/nec-xlsx/format-a-2024-sample.xlsx";

  it("partyNames 추출", () => {
    const r = parseFormatA(fixture, { isProportional: false });
    expect(r.partyNames).toContain("더불어민주당\n곽상언");
    expect(r.partyNames).toContain("국민의힘\n최재형");
  });
  it("row 종류 분포", () => {
    const r = parseFormatA(fixture, { isProportional: false });
    const kinds = new Set(r.rows.map((x) => x.kind));
    expect(kinds.has("subtotal")).toBe(true);  // 종로구 합계 row
    expect(kinds.has("el_day")).toBe(true);    // station 단위 row
  });
  it("region 정보 정확", () => {
    const r = parseFormatA(fixture, { isProportional: false });
    const station = r.rows.find((x) => x.kind === "el_day");
    expect(station?.sidoName).toBe("서울특별시");
    expect(station?.sigunguName).toBe("종로구");
    expect(station?.emdName).toBeTruthy();
  });
});
```

- [ ] **Step 3: 테스트 실행 (실패 확인)**

Run: `pnpm vitest tests/unit/build/parse-format-a.test.ts`
Expected: FAIL "Cannot find module"

- [ ] **Step 4: parse-format-a 구현**

```typescript
// scripts/build/lib/parse-format-a.ts
import * as XLSX from "xlsx";
import { ParsedElection, ParsedStationRow, RowKind } from "./types";

const META_KINDS: Record<string, RowKind> = {
  "합계": "total", "소계": "subtotal", "계": "subtotal",
  "거소·선상투표": "absentee", "거소투표": "absentee",
  "관외사전투표": "abs", "관내사전투표": "presub",
  "재외투표": "overseas", "재외국민투표": "overseas", "국외부재자투표": "overseas",
  "잘못 투입·구분된 투표지": "misc", "잘못 투입ㆍ구분된 투표지": "misc",
};

interface OptsA { isProportional: boolean; }

export function parseFormatA(filePath: string, opts: OptsA): ParsedElection {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });

  // row[3] header
  const header = grid[3].map((c) => c.trim());
  const idxVoters = header.indexOf("선거인수");
  const idxVotes = header.indexOf("투표수");
  const idxInvalid = header.findIndex((c) => c.includes("무효"));
  const idxAbstain = header.findIndex((c) => c.includes("기권"));
  if (idxVoters < 0 || idxVotes < 0) throw new Error("형식 A header 미인식");

  // 후보자/정당명 — row[4] 의 idxVotes+1 ~ idxInvalid-1 슬라이스
  const partyStartCol = idxVotes + 1;
  const partyEndCol = idxInvalid;  // exclusive
  const partyNames = grid[4]
    .slice(partyStartCol, partyEndCol)
    .map((c) => c.trim())
    .filter((c) => c && c !== "계");

  // region 컬럼 (시·도·선거구·구시군·읍면동·투표타입 — 지역구) 또는 (시·도·구시군·읍면동·투표구 — 비례)
  const cols = opts.isProportional
    ? { sido: 0, sigungu: 1, emd: 2, station: 3 }
    : { sido: 0, district: 1, sigungu: 2, emd: 3, station: 4 };

  const rows: ParsedStationRow[] = [];
  let currentSido = "", currentSigungu = "", currentEmd: string | null = null;

  for (let r = 5; r < grid.length; r++) {
    const row = grid[r];
    if (row.every((c) => !c.trim())) continue;

    if (row[cols.sido]?.trim()) currentSido = row[cols.sido].trim();
    if (row[cols.sigungu]?.trim()) currentSigungu = row[cols.sigungu].trim();
    const emdCell = row[cols.emd]?.trim();
    const stationCell = row[cols.station]?.trim();

    // kind 결정
    let kind: RowKind | undefined;
    let displayName: string | null = stationCell || null;
    let emdName: string | null = currentEmd;

    if (META_KINDS[emdCell]) { kind = META_KINDS[emdCell]; displayName = emdCell; emdName = null; }
    else if (META_KINDS[stationCell]) { kind = META_KINDS[stationCell]; if (emdCell) { emdName = emdCell; currentEmd = emdCell; } }
    else if (emdCell && stationCell === "소계") { kind = "subtotal"; emdName = emdCell; currentEmd = emdCell; }
    else if (stationCell) { kind = "el_day"; if (emdCell) { emdName = emdCell; currentEmd = emdCell; } }
    else continue;

    const num = (c: string) => Number((c ?? "").toString().replace(/,/g, "")) || 0;
    const parties = partyNames.map((n, i) => ({ rawName: n, votes: num(row[partyStartCol + i]) }));
    rows.push({
      sidoName: currentSido, sigunguName: currentSigungu, emdName,
      stationName: kind === "el_day" ? displayName : null,
      kind,
      totalVoters: num(row[idxVoters]),
      totalVotes: num(row[idxVotes]),
      validVotes: num(row[idxInvalid - 1]),  // 마지막 후보 다음 "계" 컬럼
      invalidVotes: num(row[idxInvalid]),
      parties,
    });
  }
  return { electionId: "", electionDate: "", rows, partyNames };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest tests/unit/build/parse-format-a.test.ts`
Expected: PASS 3/3

- [ ] **Step 6: Commit**

```bash
git add scripts/build/lib/parse-format-a.ts tests/unit/build/parse-format-a.test.ts tests/fixtures/nec-xlsx/format-a-2024-sample.xlsx
git commit -m "build: 형식 A xlsx parser (2024·2025)"
```

---

### Task 1.3: 형식 B parser (2020·2016·2012 시·도×시·군·구 분리)

**Files:**
- Create: `scripts/build/lib/parse-format-b.ts`
- Test: `tests/unit/build/parse-format-b.test.ts`
- Fixture: `tests/fixtures/nec-xlsx/format-b-2020-yeongam.xlsx` (실제 영암군 파일 복사)

**형식 B 특징:**
- 한 파일 = 한 시·군·구 (또는 선거구)
- 시·도·시·군·구 정보는 시트의 `[국회의원선거][전라남도][영암군무안군신안군][영암군]` 메타 텍스트 또는 파일명에서 추출
- row[3] header: `읍면동명·투표구명·선거인수·투표수·후보자별 득표수·무효투표수·기권수`
- row[4] = 후보자/정당명
- row[5+] = 데이터

- [ ] **Step 1: fixture 준비**

```bash
cp 'data/raw/nec-downloads/general-2020/지역구/14전남/개표상황(투표구별)_영암군무안군신안군_영암군.xlsx' \
   tests/fixtures/nec-xlsx/format-b-2020-yeongam.xlsx
```

- [ ] **Step 2: 테스트 작성**

```typescript
// tests/unit/build/parse-format-b.test.ts
import { describe, it, expect } from "vitest";
import { parseFormatB } from "../../../scripts/build/lib/parse-format-b";

describe("parseFormatB — 2020 영암군", () => {
  const fixture = "tests/fixtures/nec-xlsx/format-b-2020-yeongam.xlsx";

  it("시트 메타에서 시·도·시·군·구 추출", () => {
    const r = parseFormatB(fixture, { isProportional: false });
    expect(r.rows[0].sidoName).toBe("전라남도");
    expect(r.rows[0].sigunguName).toBe("영암군");
  });
  it("후보자 매핑", () => {
    const r = parseFormatB(fixture, { isProportional: false });
    expect(r.partyNames).toContain("더불어민주당\n서삼석");
  });
  it("station row 확인", () => {
    const r = parseFormatB(fixture, { isProportional: false });
    const stations = r.rows.filter((x) => x.kind === "el_day");
    expect(stations.length).toBeGreaterThan(0);
    expect(stations[0].emdName).toBeTruthy();
  });
});
```

- [ ] **Step 3: 테스트 실행 (실패)**

Run: `pnpm vitest tests/unit/build/parse-format-b.test.ts`
Expected: FAIL "Cannot find module"

- [ ] **Step 4: parse-format-b 구현**

```typescript
// scripts/build/lib/parse-format-b.ts
import * as XLSX from "xlsx";
import { ParsedElection, ParsedStationRow, RowKind } from "./types";

const META_KINDS: Record<string, RowKind> = {
  "합계": "total", "소계": "subtotal", "계": "subtotal",
  "거소·선상투표": "absentee", "거소투표": "absentee",
  "관외사전투표": "abs", "관내사전투표": "presub",
  "재외투표": "overseas", "국외부재자투표": "overseas",
};

interface OptsB { isProportional: boolean; }

export function parseFormatB(filePath: string, opts: OptsB): ParsedElection {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });

  // 시·도·시·군·구 — row[2] 의 [...] 패턴
  const metaText = grid[2][0] ?? "";
  const metaMatch = metaText.match(/\[([^\]]+)\]\[([^\]]+)\](?:\[([^\]]+)\])?(?:\[([^\]]+)\])?/);
  const sido = metaMatch?.[2] ?? "";
  // 마지막 그룹 = sigungu (선거구 있을 땐 한 단계 더)
  const sigungu = (metaMatch?.[4] || metaMatch?.[3] || "").trim();

  // header row[3]
  const header = grid[3].map((c) => c.trim());
  const idxVoters = header.indexOf("선거인수");
  const idxVotes = header.indexOf("투표수");
  const idxInvalid = header.findIndex((c) => c.includes("무효"));
  if (idxVoters < 0) throw new Error("형식 B header 미인식");

  const partyStartCol = idxVotes + 1;
  const partyEndCol = idxInvalid;
  const partyNames = grid[4]
    .slice(partyStartCol, partyEndCol)
    .map((c) => c.trim())
    .filter((c) => c && c !== "계" && c !== "\n");

  const rows: ParsedStationRow[] = [];
  let currentEmd: string | null = null;

  for (let r = 5; r < grid.length; r++) {
    const row = grid[r];
    if (row.every((c) => !c?.trim())) continue;
    const emdCell = row[0]?.trim();
    const stationCell = row[1]?.trim();

    let kind: RowKind | undefined;
    let emdName: string | null = currentEmd;
    let displayName: string | null = stationCell || null;

    if (META_KINDS[emdCell]) { kind = META_KINDS[emdCell]; displayName = emdCell; emdName = null; }
    else if (emdCell && stationCell === "소계") { kind = "subtotal"; emdName = emdCell; currentEmd = emdCell; }
    else if (META_KINDS[stationCell]) { kind = META_KINDS[stationCell]; if (emdCell) { emdName = emdCell; currentEmd = emdCell; } }
    else if (stationCell) { kind = "el_day"; if (emdCell) { emdName = emdCell; currentEmd = emdCell; } }
    else continue;

    const num = (c: string) => Number((c ?? "").toString().replace(/,/g, "")) || 0;
    const parties = partyNames.map((n, i) => ({ rawName: n, votes: num(row[partyStartCol + i]) }));
    rows.push({
      sidoName: sido, sigunguName: sigungu, emdName,
      stationName: kind === "el_day" ? displayName : null,
      kind,
      totalVoters: num(row[idxVoters]),
      totalVotes: num(row[idxVotes]),
      validVotes: num(row[idxInvalid - 1]),
      invalidVotes: num(row[idxInvalid]),
      parties,
    });
  }
  return { electionId: "", electionDate: "", rows, partyNames };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest tests/unit/build/parse-format-b.test.ts`
Expected: PASS 3/3

- [ ] **Step 6: Commit**

```bash
git add scripts/build/lib/parse-format-b.ts tests/unit/build/parse-format-b.test.ts tests/fixtures/nec-xlsx/format-b-2020-yeongam.xlsx
git commit -m "build: 형식 B xlsx parser (2020·2016 시·도×시·군·구 분리)"
```

---

### Task 1.4: 형식 C parser (2022 대선·재보궐 row[0] 헤더)

**Files:**
- Create: `scripts/build/lib/parse-format-c.ts`
- Test: `tests/unit/build/parse-format-c.test.ts`
- Fixture: `tests/fixtures/nec-xlsx/format-c-2022-jongno.xlsx`

**형식 C 특징:**
- row[0] = header + 후보자명 합쳐서 한 줄
- (시도·구시군·읍면동·투표구·선거인수·투표수·후보자명들·계·무효투표수·기권수)
- row[1+] = 데이터

- [ ] **Step 1: fixture 준비**

```bash
cp 'data/raw/nec-downloads/byelection-2022/개표단위별 개표결과_국회의원선거_서울시종로구.xlsx' \
   tests/fixtures/nec-xlsx/format-c-2022-jongno.xlsx
```

- [ ] **Step 2: 테스트 작성**

```typescript
// tests/unit/build/parse-format-c.test.ts
import { describe, it, expect } from "vitest";
import { parseFormatC } from "../../../scripts/build/lib/parse-format-c";

describe("parseFormatC — 2022 종로 재보궐", () => {
  const fixture = "tests/fixtures/nec-xlsx/format-c-2022-jongno.xlsx";

  it("region 추출", () => {
    const r = parseFormatC(fixture);
    expect(r.rows[0].sidoName).toBe("서울특별시");
    expect(r.rows[0].sigunguName).toBe("종로구");
  });
  it("후보자 추출", () => {
    const r = parseFormatC(fixture);
    expect(r.partyNames).toContain("국민의힘\n최재형");
    expect(r.partyNames).toContain("정의당\n배복주");
  });
  it("station row 존재", () => {
    const r = parseFormatC(fixture);
    expect(r.rows.filter((x) => x.kind === "el_day").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm vitest tests/unit/build/parse-format-c.test.ts`
Expected: FAIL "Cannot find module"

- [ ] **Step 4: parse-format-c 구현**

```typescript
// scripts/build/lib/parse-format-c.ts
import * as XLSX from "xlsx";
import { ParsedElection, ParsedStationRow, RowKind } from "./types";

const META_KINDS: Record<string, RowKind> = {
  "합계": "total", "소계": "subtotal", "계": "subtotal",
  "거소·선상투표": "absentee", "거소투표": "absentee",
  "관외사전투표": "abs", "관내사전투표": "presub",
  "재외투표": "overseas", "국외부재자투표": "overseas",
};

const META_REGION_HEADERS = new Set(["시도", "시도명", "구시군", "구시군명", "읍면동명", "투표구명", "선거인수", "투표수"]);
const META_TAIL_HEADERS = new Set(["계", "무효", "무효투표수", "무효\n투표수", "기권수", "기권자수"]);

export function parseFormatC(filePath: string): ParsedElection {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });

  // header = row[0]
  const header = grid[0].map((c) => c.trim());
  const idxSido = header.findIndex((c) => c === "시도" || c === "시도명");
  const idxSigungu = header.findIndex((c) => c === "구시군" || c === "구시군명");
  const idxEmd = header.findIndex((c) => c === "읍면동명");
  const idxStation = header.findIndex((c) => c === "투표구명");
  const idxVoters = header.indexOf("선거인수");
  const idxVotes = header.indexOf("투표수");
  const idxInvalid = header.findIndex((c) => c.replace("\n", "") === "무효투표수" || c === "무효");
  if (idxVoters < 0 || idxVotes < 0) throw new Error("형식 C header 미인식");

  // 후보자 = idxVotes+1 ~ idxInvalid-1 (단 "계" 컬럼 제외)
  const partyNames: string[] = [];
  const partyCols: number[] = [];
  for (let c = idxVotes + 1; c < idxInvalid; c++) {
    if (header[c] && header[c] !== "계" && !META_REGION_HEADERS.has(header[c]) && !META_TAIL_HEADERS.has(header[c])) {
      partyNames.push(header[c]);
      partyCols.push(c);
    }
  }

  const rows: ParsedStationRow[] = [];
  let currentEmd: string | null = null;

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (row.every((c) => !c?.trim())) continue;

    const sido = row[idxSido]?.trim();
    const sigungu = row[idxSigungu]?.trim();
    const emdCell = row[idxEmd]?.trim();
    const stationCell = row[idxStation]?.trim();
    if (!sido) continue;

    let kind: RowKind | undefined;
    let emdName: string | null = currentEmd;
    let displayName: string | null = stationCell || null;

    if (META_KINDS[emdCell]) { kind = META_KINDS[emdCell]; displayName = emdCell; emdName = null; }
    else if (emdCell && stationCell === "소계") { kind = "subtotal"; emdName = emdCell; currentEmd = emdCell; }
    else if (META_KINDS[stationCell]) { kind = META_KINDS[stationCell]; if (emdCell) { emdName = emdCell; currentEmd = emdCell; } }
    else if (stationCell) { kind = "el_day"; if (emdCell) { emdName = emdCell; currentEmd = emdCell; } }
    else continue;

    const num = (c: string) => Number((c ?? "").toString().replace(/,/g, "")) || 0;
    const parties = partyNames.map((n, i) => ({ rawName: n, votes: num(row[partyCols[i]]) }));
    rows.push({
      sidoName: sido, sigunguName: sigungu, emdName,
      stationName: kind === "el_day" ? displayName : null,
      kind,
      totalVoters: num(row[idxVoters]),
      totalVotes: num(row[idxVotes]),
      validVotes: num(row[idxInvalid - 1]),
      invalidVotes: num(row[idxInvalid]),
      parties,
    });
  }
  return { electionId: "", electionDate: "", rows, partyNames };
}
```

- [ ] **Step 5: 통과 확인 + Commit**

```bash
pnpm vitest tests/unit/build/parse-format-c.test.ts
git add scripts/build/lib/parse-format-c.ts tests/unit/build/parse-format-c.test.ts tests/fixtures/nec-xlsx/format-c-2022-jongno.xlsx
git commit -m "build: 형식 C xlsx parser (2022 대선·재보궐)"
```

---

### Task 1.5: 형식 D parser (2012 대선 .xls)

**Files:**
- Create: `scripts/build/lib/parse-format-d.ts`
- Test: `tests/unit/build/parse-format-d.test.ts`
- Fixture: `tests/fixtures/nec-xlsx/format-d-2012-presidential.xls`

**형식 D 특징:**
- `.xls` 바이너리 — `xlsx` 패키지가 동일하게 처리
- 구조는 형식 A 와 비슷 (row[3] header, row[4] 후보자) 단 시·도 컬럼이 첫 컬럼

- [ ] **Step 1: fixture 준비**

```bash
cp data/raw/nec-downloads/presidential-2012/source.xls tests/fixtures/nec-xlsx/format-d-2012-presidential.xls
```

- [ ] **Step 2: 테스트 작성**

```typescript
// tests/unit/build/parse-format-d.test.ts
import { describe, it, expect } from "vitest";
import { parseFormatD } from "../../../scripts/build/lib/parse-format-d";

describe("parseFormatD — 2012 18대 대선", () => {
  const fixture = "tests/fixtures/nec-xlsx/format-d-2012-presidential.xls";
  it("후보자 8명 확인 (박근혜·문재인 등)", () => {
    const r = parseFormatD(fixture);
    expect(r.partyNames).toContain("새누리당\n박근혜");
    expect(r.partyNames).toContain("민주통합당\n문재인");
  });
  it("station row 존재", () => {
    const r = parseFormatD(fixture);
    expect(r.rows.filter((x) => x.kind === "el_day").length).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 3: parse-format-d 구현 (형식 A 와 거의 동일, isProportional=false 고정 + 컬럼 매핑 자동 감지)**

```typescript
// scripts/build/lib/parse-format-d.ts
import * as XLSX from "xlsx";
import { ParsedElection, ParsedStationRow, RowKind } from "./types";

const META_KINDS: Record<string, RowKind> = {
  "합계": "total", "소계": "subtotal", "계": "subtotal",
  "거소·선상투표": "absentee", "거소투표": "absentee",
  "관외사전투표": "abs", "관내사전투표": "presub",
  "재외투표": "overseas", "국외부재자투표": "overseas",
};

export function parseFormatD(filePath: string): ParsedElection {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });

  const header = grid[3].map((c) => c.trim());
  const idxSido = header.indexOf("시도명");
  const idxSigungu = header.indexOf("구시군명");
  const idxEmd = header.indexOf("읍면동명");
  const idxStation = header.indexOf("투표구명");
  const idxVoters = header.indexOf("선거인수");
  const idxVotes = header.indexOf("투표수");
  const idxInvalid = header.findIndex((c) => c.includes("무효"));
  if (idxVoters < 0) throw new Error("형식 D header 미인식");

  const partyStartCol = idxVotes + 1;
  const partyEndCol = idxInvalid;
  const partyNames = grid[4]
    .slice(partyStartCol, partyEndCol)
    .map((c) => c.trim())
    .filter((c) => c && c !== "계");

  const rows: ParsedStationRow[] = [];
  let currentSido = "", currentSigungu = "", currentEmd: string | null = null;
  for (let r = 5; r < grid.length; r++) {
    const row = grid[r];
    if (row.every((c) => !c?.trim())) continue;
    if (row[idxSido]?.trim()) currentSido = row[idxSido].trim();
    if (row[idxSigungu]?.trim()) currentSigungu = row[idxSigungu].trim();
    const emdCell = row[idxEmd]?.trim();
    const stationCell = row[idxStation]?.trim();

    let kind: RowKind | undefined;
    let emdName: string | null = currentEmd;
    let displayName: string | null = stationCell || null;

    if (META_KINDS[emdCell]) { kind = META_KINDS[emdCell]; displayName = emdCell; emdName = null; }
    else if (emdCell && stationCell === "소계") { kind = "subtotal"; emdName = emdCell; currentEmd = emdCell; }
    else if (META_KINDS[stationCell]) { kind = META_KINDS[stationCell]; if (emdCell) { emdName = emdCell; currentEmd = emdCell; } }
    else if (stationCell) { kind = "el_day"; if (emdCell) { emdName = emdCell; currentEmd = emdCell; } }
    else continue;

    const num = (c: string) => Number((c ?? "").toString().replace(/,/g, "")) || 0;
    const parties = partyNames.map((n, i) => ({ rawName: n, votes: num(row[partyStartCol + i]) }));
    rows.push({
      sidoName: currentSido, sigunguName: currentSigungu, emdName,
      stationName: kind === "el_day" ? displayName : null,
      kind,
      totalVoters: num(row[idxVoters]),
      totalVotes: num(row[idxVotes]),
      validVotes: num(row[idxInvalid - 1]),
      invalidVotes: num(row[idxInvalid]),
      parties,
    });
  }
  return { electionId: "", electionDate: "", rows, partyNames };
}
```

- [ ] **Step 4: 통과 확인 + Commit**

```bash
pnpm vitest tests/unit/build/parse-format-d.test.ts
git add scripts/build/lib/parse-format-d.ts tests/unit/build/parse-format-d.test.ts tests/fixtures/nec-xlsx/format-d-2012-presidential.xls
git commit -m "build: 형식 D xlsx parser (2012 18대 대선 .xls)"
```

---

### Task 1.6: 형식 E parser (archive HTML 폴백)

**Files:**
- Create: `scripts/build/lib/parse-format-e.ts`
- Test: `tests/unit/build/parse-format-e.test.ts`

**기존 `scripts/ingest/lib/nec-html.ts` 의 `parseVccp08Stations` 결과를 `ParsedStationRow[]` shape 로 변환하는 어댑터.**

- [ ] **Step 1: 어댑터 테스트 (기존 fixture 활용)**

```typescript
// tests/unit/build/parse-format-e.test.ts
import { describe, it, expect } from "vitest";
import { parseFormatE } from "../../../scripts/build/lib/parse-format-e";

describe("parseFormatE — archive HTML 폴백", () => {
  it("기존 2017 진주 archive 응답 변환", async () => {
    const r = await parseFormatE("data/raw/polling-stations/2017-presidential/0000000000-4800-4803.html", {
      sidoName: "경상남도", sigunguName: "진주시",
    });
    expect(r.partyNames).toContain("더불어민주당\n문재인");
    expect(r.rows.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: parse-format-e 구현 (어댑터)**

```typescript
// scripts/build/lib/parse-format-e.ts
import { readFile } from "node:fs/promises";
import { parseVccp08Stations } from "../../ingest/lib/nec-html";
import { ParsedElection, ParsedStationRow, RowKind } from "./types";

const KIND_MAP: Record<string, RowKind> = {
  station: "el_day", el_day: "el_day", presub: "presub", abs: "abs",
  absentee: "absentee", overseas: "overseas", misc: "misc",
};

interface OptsE { sidoName: string; sigunguName: string; }

export async function parseFormatE(htmlPath: string, opts: OptsE): Promise<ParsedElection> {
  const html = await readFile(htmlPath, "utf-8");
  const result = parseVccp08Stations(html);
  if (result.kind === "no-data") return { electionId: "", electionDate: "", rows: [], partyNames: [] };

  const rows: ParsedStationRow[] = result.rows.map((r) => ({
    sidoName: opts.sidoName,
    sigunguName: opts.sigunguName,
    emdName: r.emdName,
    stationName: r.kind === "station" ? r.name : null,
    kind: KIND_MAP[r.kind] ?? "misc",
    totalVoters: r.totalVoters,
    totalVotes: r.totalVotes,
    validVotes: r.validVotes,
    invalidVotes: r.invalidVotes,
    parties: r.parties.map((p) => ({ rawName: p.name, votes: p.votes })),
  }));
  return { electionId: "", electionDate: "", rows, partyNames: result.partyNames };
}
```

- [ ] **Step 3: 통과 확인 + Commit**

```bash
pnpm vitest tests/unit/build/parse-format-e.test.ts
git add scripts/build/lib/parse-format-e.ts tests/unit/build/parse-format-e.test.ts
git commit -m "build: 형식 E parser (archive HTML 폴백 — 2007·2008)"
```

---

### Task 1.7: 형식 자동 감지 + 통합 CLI

**Files:**
- Create: `scripts/build/lib/xlsx-format-detect.ts`
- Create: `scripts/build/parse-nec-xlsx.ts`
- Modify: `package.json` — `"build:parse": "tsx scripts/build/parse-nec-xlsx.ts"`
- Test: `tests/unit/build/format-detect.test.ts`

- [ ] **Step 1: 감지 테스트**

```typescript
// tests/unit/build/format-detect.test.ts
import { describe, it, expect } from "vitest";
import { detectFormat } from "../../../scripts/build/lib/xlsx-format-detect";

describe("detectFormat", () => {
  it("형식 A — 2024 지역구", () => {
    expect(detectFormat("tests/fixtures/nec-xlsx/format-a-2024-sample.xlsx")).toBe("A");
  });
  it("형식 B — 2020 영암", () => {
    expect(detectFormat("tests/fixtures/nec-xlsx/format-b-2020-yeongam.xlsx")).toBe("B");
  });
  it("형식 C — 2022 종로", () => {
    expect(detectFormat("tests/fixtures/nec-xlsx/format-c-2022-jongno.xlsx")).toBe("C");
  });
  it("형식 D — 2012 대선", () => {
    expect(detectFormat("tests/fixtures/nec-xlsx/format-d-2012-presidential.xls")).toBe("D");
  });
});
```

- [ ] **Step 2: detectFormat 구현**

```typescript
// scripts/build/lib/xlsx-format-detect.ts
import * as XLSX from "xlsx";

export type FormatKind = "A" | "B" | "C" | "D";

export function detectFormat(filePath: string): FormatKind {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });

  const row0 = (grid[0] ?? []).map((c) => c.trim());
  const row3 = (grid[3] ?? []).map((c) => c.trim());

  // C: row[0] 에 시·도/구·시·군 header
  if (row0.includes("시도") || row0.includes("시도명")) {
    if (row0.includes("구시군") || row0.includes("구시군명")) return "C";
  }
  // A: row[3] 에 "선거구명" 또는 "투표타입" 포함 → 통합 (전국) 파일
  if (row3.includes("시도명") && (row3.includes("선거구명") || row3.includes("투표타입"))) return "A";
  // D: row[3] 에 시·도·구시군 header (2012 .xls 통합)
  if (row3.includes("시도명") && row3.includes("구시군명")) return "D";
  // B: row[3] 가 "읍면동명" 으로 시작 (시·도 정보 없음, 시트 메타 이용)
  if (row3[0] === "읍면동명") return "B";
  throw new Error(`형식 감지 실패 — row[3]: ${row3.slice(0, 8).join("|")}`);
}
```

- [ ] **Step 3: 통합 CLI 구현**

```typescript
// scripts/build/parse-nec-xlsx.ts
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { detectFormat } from "./lib/xlsx-format-detect";
import { parseFormatA } from "./lib/parse-format-a";
import { parseFormatB } from "./lib/parse-format-b";
import { parseFormatC } from "./lib/parse-format-c";
import { parseFormatD } from "./lib/parse-format-d";
import { ParsedElection, ParsedStationRow } from "./lib/types";

interface ElectionMap {
  electionId: string;
  electionDate: string;
  rawDir: string;        // data/raw/nec-downloads/...
  isProportional?: boolean;
}

// 매핑 표 — spec 의 "데이터 소스" 표를 코드화
const MAP: ElectionMap[] = [
  { electionId: "2012-presidential",      electionDate: "2012-12-19", rawDir: "data/raw/nec-downloads/presidential-2012" },
  { electionId: "2017-presidential",      electionDate: "2017-05-09", rawDir: "data/raw/nec-downloads/presidential-2017" },
  { electionId: "2022-presidential",      electionDate: "2022-03-09", rawDir: "data/raw/nec-downloads/presidential-all" },
  { electionId: "2025-presidential",      electionDate: "2025-06-03", rawDir: "data/raw/nec-downloads/presidential-2025" },
  { electionId: "2024-general",           electionDate: "2024-04-10", rawDir: "data/raw/nec-downloads/22-general/01" },
  { electionId: "2024-general-prop",      electionDate: "2024-04-10", rawDir: "data/raw/nec-downloads/22-general/02", isProportional: true },
  { electionId: "2020-general",           electionDate: "2020-04-15", rawDir: "data/raw/nec-downloads/general-2020/지역구" },
  { electionId: "2020-general-prop",      electionDate: "2020-04-15", rawDir: "data/raw/nec-downloads/general-2020/비례대표", isProportional: true },
  { electionId: "2016-general",           electionDate: "2016-04-13", rawDir: "data/raw/nec-downloads/general-2016/지역구" },
  { electionId: "2016-general-prop",      electionDate: "2016-04-13", rawDir: "data/raw/nec-downloads/general-2016/비례대표", isProportional: true },
  { electionId: "2012-general",           electionDate: "2012-04-11", rawDir: "data/raw/nec-downloads/general-district-2012" },
  { electionId: "2012-general-prop",      electionDate: "2012-04-11", rawDir: "data/raw/nec-downloads/general-prop-2012", isProportional: true },
  { electionId: "2022-byelection",        electionDate: "2022-06-01", rawDir: "data/raw/nec-downloads/byelection-2022" },
];

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await listFiles(p)));
    else if (/\.(xlsx|xls)$/i.test(ent.name) && !ent.name.startsWith(".")) out.push(p);
  }
  return out;
}

async function parseElection(m: ElectionMap): Promise<ParsedElection> {
  const files = await listFiles(m.rawDir);
  const allRows: ParsedStationRow[] = [];
  const partySet = new Set<string>();
  for (const f of files) {
    const fmt = detectFormat(f);
    let parsed: ParsedElection;
    if (fmt === "A") parsed = parseFormatA(f, { isProportional: !!m.isProportional });
    else if (fmt === "B") parsed = parseFormatB(f, { isProportional: !!m.isProportional });
    else if (fmt === "C") parsed = parseFormatC(f);
    else if (fmt === "D") parsed = parseFormatD(f);
    else throw new Error(`unknown format ${fmt}`);
    allRows.push(...parsed.rows);
    parsed.partyNames.forEach((n) => partySet.add(n));
  }
  return { electionId: m.electionId, electionDate: m.electionDate, rows: allRows, partyNames: [...partySet] };
}

async function main() {
  const filter = process.argv[2];
  const targets = filter ? MAP.filter((m) => m.electionId === filter) : MAP;
  if (!existsSync("data/parsed")) await mkdir("data/parsed", { recursive: true });
  for (const m of targets) {
    console.log(`▶ ${m.electionId} (${m.rawDir})`);
    if (!existsSync(m.rawDir)) { console.warn(`  rawDir 없음 — skip`); continue; }
    const parsed = await parseElection(m);
    const out = path.join("data/parsed", `${m.electionId}.json`);
    await writeFile(out, JSON.stringify(parsed, null, 2));
    console.log(`  ✓ ${out}  rows=${parsed.rows.length}  parties=${parsed.partyNames.length}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: 통과 확인 + 일부 election 실행**

```bash
pnpm vitest tests/unit/build/format-detect.test.ts
pnpm tsx scripts/build/parse-nec-xlsx.ts 2024-general
# 출력 예: ✓ data/parsed/2024-general.json  rows=12345  parties=520
```

- [ ] **Step 5: package.json 수정**

```bash
# package.json scripts 에 추가
"build:parse": "tsx scripts/build/parse-nec-xlsx.ts",
"build:parse-all": "tsx scripts/build/parse-nec-xlsx.ts"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/build/lib/xlsx-format-detect.ts scripts/build/parse-nec-xlsx.ts tests/unit/build/format-detect.test.ts package.json
git commit -m "build: 형식 자동 감지 + parse CLI"
```

---

## Phase 2: build-static

### Task 2.1: 정적 chunk 타입 + index.json builder

**Files:**
- Create: `src/types/static.ts`
- Create: `scripts/build/lib/build-index.ts`
- Test: `tests/unit/build/build-index.test.ts`

- [ ] **Step 1: 정적 타입 정의**

```typescript
// src/types/static.ts
export interface StaticIndex {
  version: string;
  elections: ElectionMeta[];
  parties: PartyMeta[];
  regions: {
    sido: RegionMeta[];
    sigunguByRegion: Record<string, RegionMeta[]>;
  };
}
export interface ElectionMeta {
  id: string; name: string; date: string;
  type: string; isByelection: boolean;
  hasStationLevel: boolean; displayOrder: number;
}
export interface PartyMeta {
  id: string; name: string; color: string; family: string;
}
export interface RegionMeta { code: string; name: string; }

export interface RegionFile {
  code: string; name: string; level: "sido" | "sigungu" | "emd";
  parent?: { code: string; name: string };
  children: (RegionMeta & { level: string })[];
  timeseries: Record<string, TimeseriesPoint[]>;  // partyId → []
  elections: RegionElectionSummary[];
}
export interface TimeseriesPoint {
  electionId: string;
  votes: number;
  totalVotes: number;
  share: number;
}
export interface RegionElectionSummary {
  electionId: string;
  totalVoters: number; totalVotes: number; validVotes: number; invalidVotes: number;
  byParty: { partyId: string; votes: number; share: number }[];
  byKind: Record<string, { totalVoters: number; totalVotes: number; validVotes: number; byParty: { partyId: string; votes: number }[] }>;
}

export interface ElectionDetailFile {
  regionCode: string; electionId: string;
  candidates: { rawName: string; partyId: string | null; votes: number }[];
  rowsByEmd: {
    emdName: string; emdCode: string | null;
    kindRows: {
      kind: string; name: string;
      voters: number; votes: number; valid: number; invalid: number;
      byParty: { partyId: string | null; votes: number }[];
    }[];
  }[];
}

export interface StationFile {
  stationKey: string; name: string;
  emdName: string; sigunguName: string; sidoName: string;
  timeseries: Record<string, TimeseriesPoint[]>;
}
```

- [ ] **Step 2: build-index 테스트**

```typescript
// tests/unit/build/build-index.test.ts
import { describe, it, expect } from "vitest";
import { buildIndex } from "../../../scripts/build/lib/build-index";

describe("buildIndex", () => {
  it("필수 election·party·region 포함", () => {
    const idx = buildIndex();
    expect(idx.elections.length).toBeGreaterThan(20);
    expect(idx.parties.find((p) => p.id === "justice")).toBeDefined();
    expect(idx.regions.sido.length).toBe(17);
  });
});
```

- [ ] **Step 3: buildIndex 구현**

```typescript
// scripts/build/lib/build-index.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { StaticIndex } from "../../../src/types/static";

export function buildIndex(): StaticIndex {
  const elections = JSON.parse(readFileSync("data/seed/elections.json", "utf-8"));
  const parties = JSON.parse(readFileSync("data/seed/parties.json", "utf-8"));
  const regions = JSON.parse(readFileSync("data/seed/regions.json", "utf-8"));  // 가정 — 없으면 별도 생성

  return {
    version: new Date().toISOString().slice(0, 10),
    elections: elections.map((e: any) => ({
      id: e.id, name: e.name, date: e.date, type: e.type,
      isByelection: e.isByelection ?? false,
      hasStationLevel: ["presidential", "general", "byelection"].includes(e.type),
      displayOrder: e.displayOrder ?? 0,
    })),
    parties: parties.map((p: any) => ({ id: p.id, name: p.name, color: p.color, family: p.family })),
    regions: { sido: regions.sido, sigunguByRegion: regions.sigunguByRegion },
  };
}
```

- [ ] **Step 4: 통과 확인 + Commit**

```bash
pnpm vitest tests/unit/build/build-index.test.ts
git add src/types/static.ts scripts/build/lib/build-index.ts tests/unit/build/build-index.test.ts
git commit -m "build: 정적 타입 + index.json builder"
```

---

### Task 2.2: region 집계 (sigungu = Σ emd, sido = Σ sigungu)

**Files:**
- Create: `scripts/build/lib/aggregate-region.ts`
- Test: `tests/unit/build/aggregate-region.test.ts`

- [ ] **Step 1: 집계 테스트**

```typescript
// tests/unit/build/aggregate-region.test.ts
import { describe, it, expect } from "vitest";
import { aggregateByRegion } from "../../../scripts/build/lib/aggregate-region";
import { ParsedStationRow } from "../../../scripts/build/lib/types";

const sample: ParsedStationRow[] = [
  // 종로구 청운효자동 station 2개
  { sidoName: "서울특별시", sigunguName: "종로구", emdName: "청운효자동", stationName: "청운효자동제1투", kind: "el_day",
    totalVoters: 1000, totalVotes: 800, validVotes: 790, invalidVotes: 10,
    parties: [{ rawName: "더불어민주당\n곽상언", votes: 400 }, { rawName: "국민의힘\n최재형", votes: 390 }] },
  { sidoName: "서울특별시", sigunguName: "종로구", emdName: "청운효자동", stationName: "청운효자동제2투", kind: "el_day",
    totalVoters: 500, totalVotes: 400, validVotes: 395, invalidVotes: 5,
    parties: [{ rawName: "더불어민주당\n곽상언", votes: 200 }, { rawName: "국민의힘\n최재형", votes: 195 }] },
];

describe("aggregateByRegion", () => {
  it("emd 합 = station 합", () => {
    const out = aggregateByRegion(sample, "2024-04-10", "2024-general");
    const emd = out.emd.get("서울특별시|종로구|청운효자동")!;
    expect(emd.totalVoters).toBe(1500);
    expect(emd.byParty.find((p) => p.rawName === "더불어민주당\n곽상언")?.votes).toBe(600);
  });
  it("sigungu = emd 합", () => {
    const out = aggregateByRegion(sample, "2024-04-10", "2024-general");
    const sg = out.sigungu.get("서울특별시|종로구")!;
    expect(sg.totalVoters).toBe(1500);
  });
});
```

- [ ] **Step 2: aggregateByRegion 구현**

```typescript
// scripts/build/lib/aggregate-region.ts
import { ParsedStationRow } from "./types";
import { resolveParty } from "./party-resolver";

export interface RegionAggregate {
  totalVoters: number; totalVotes: number; validVotes: number; invalidVotes: number;
  byParty: { rawName: string; partyId: string | null; votes: number }[];
}

export interface AggregateResult {
  sido: Map<string, RegionAggregate>;       // key=sido
  sigungu: Map<string, RegionAggregate>;    // key=sido|sigungu
  emd: Map<string, RegionAggregate>;        // key=sido|sigungu|emd
}

export function aggregateByRegion(rows: ParsedStationRow[], electionDate: string, electionId: string): AggregateResult {
  const sido = new Map<string, RegionAggregate>();
  const sigungu = new Map<string, RegionAggregate>();
  const emd = new Map<string, RegionAggregate>();
  // partyId cache
  const partyOf = new Map<string, string | null>();
  const pid = (rawName: string): string | null => {
    if (!partyOf.has(rawName)) partyOf.set(rawName, resolveParty(rawName, electionDate, electionId));
    return partyOf.get(rawName)!;
  };

  const addTo = (m: Map<string, RegionAggregate>, key: string, r: ParsedStationRow) => {
    if (!m.has(key)) m.set(key, { totalVoters: 0, totalVotes: 0, validVotes: 0, invalidVotes: 0, byParty: [] });
    const a = m.get(key)!;
    a.totalVoters += r.totalVoters; a.totalVotes += r.totalVotes;
    a.validVotes += r.validVotes; a.invalidVotes += r.invalidVotes;
    for (const p of r.parties) {
      let entry = a.byParty.find((x) => x.rawName === p.rawName);
      if (!entry) { entry = { rawName: p.rawName, partyId: pid(p.rawName), votes: 0 }; a.byParty.push(entry); }
      entry.votes += p.votes;
    }
  };

  for (const r of rows) {
    if (r.kind !== "el_day") continue;  // station 단위만 집계 (top-level meta·소계 제외 — 별도 처리)
    addTo(sido, r.sidoName, r);
    addTo(sigungu, `${r.sidoName}|${r.sigunguName}`, r);
    if (r.emdName) addTo(emd, `${r.sidoName}|${r.sigunguName}|${r.emdName}`, r);
  }
  return { sido, sigungu, emd };
}
```

- [ ] **Step 3: 통과 확인 + Commit**

```bash
pnpm vitest tests/unit/build/aggregate-region.test.ts
git add scripts/build/lib/aggregate-region.ts tests/unit/build/aggregate-region.test.ts
git commit -m "build: region 집계 (sido·sigungu·emd)"
```

---

### Task 2.3: 시계열 + region 파일 builder

**Files:**
- Create: `scripts/build/lib/build-timeseries.ts`
- Create: `scripts/build/lib/build-region.ts`
- Test: `tests/unit/build/build-region.test.ts`

- [ ] **Step 1: 시계열 + region 파일 테스트**

```typescript
// tests/unit/build/build-region.test.ts
import { describe, it, expect } from "vitest";
import { buildRegionFiles } from "../../../scripts/build/lib/build-region";

describe("buildRegionFiles", () => {
  // 작은 가짜 데이터 — 종로구 + 강남구 2 선거
  // (실제 테스트는 parsed/{election}.json 의 작은 subset fixture 사용)
  it("region 파일 + timeseries 형식", async () => {
    // 가짜 입력
    const out = await buildRegionFiles({
      elections: [{ id: "2024-general", date: "2024-04-10" }],
      parsedByElection: new Map([["2024-general", {
        electionId: "2024-general", electionDate: "2024-04-10", partyNames: ["더불어민주당\n곽상언"],
        rows: [{
          sidoName: "서울특별시", sigunguName: "종로구", emdName: "청운효자동", stationName: "청운효자동제1투", kind: "el_day",
          totalVoters: 1000, totalVotes: 800, validVotes: 790, invalidVotes: 10,
          parties: [{ rawName: "더불어민주당\n곽상언", votes: 400 }],
        }],
      }]]),
      regionCodeMap: new Map([
        ["서울특별시", "1100000000"], ["서울특별시|종로구", "1111000000"],
        ["서울특별시|종로구|청운효자동", "1111051500"],
      ]),
    });
    const jongno = out.get("1111000000")!;
    expect(jongno.level).toBe("sigungu");
    expect(jongno.timeseries["democratic"]).toBeDefined();
    expect(jongno.elections[0].byParty.find((p) => p.partyId === "democratic")?.votes).toBe(400);
  });
});
```

- [ ] **Step 2: buildRegionFiles 구현**

```typescript
// scripts/build/lib/build-region.ts
import { ParsedElection } from "./types";
import { aggregateByRegion } from "./aggregate-region";
import { RegionFile } from "../../../src/types/static";

interface BuildInput {
  elections: { id: string; date: string }[];
  parsedByElection: Map<string, ParsedElection>;
  regionCodeMap: Map<string, string>;  // "시도" | "시도|시군구" | "시도|시군구|emd" → 코드
}

export async function buildRegionFiles(input: BuildInput): Promise<Map<string, RegionFile>> {
  // accumulator: code → RegionFile (parts 채워 가는 중간 상태)
  const acc = new Map<string, RegionFile>();
  const ensure = (code: string, name: string, level: "sido" | "sigungu" | "emd", parent?: { code: string; name: string }) => {
    if (!acc.has(code)) acc.set(code, {
      code, name, level, parent, children: [],
      timeseries: {}, elections: [],
    });
    return acc.get(code)!;
  };

  for (const e of input.elections) {
    const parsed = input.parsedByElection.get(e.id);
    if (!parsed) continue;
    const agg = aggregateByRegion(parsed.rows, e.date, e.id);

    // sido
    for (const [sido, a] of agg.sido) {
      const code = input.regionCodeMap.get(sido); if (!code) continue;
      const f = ensure(code, sido, "sido");
      const summary = toSummary(e.id, a);
      f.elections.push(summary);
      addTimeseries(f.timeseries, summary);
    }
    // sigungu
    for (const [key, a] of agg.sigungu) {
      const [sidoName, sigName] = key.split("|");
      const code = input.regionCodeMap.get(key); if (!code) continue;
      const parentCode = input.regionCodeMap.get(sidoName);
      const f = ensure(code, sigName, "sigungu", parentCode ? { code: parentCode, name: sidoName } : undefined);
      const summary = toSummary(e.id, a);
      f.elections.push(summary);
      addTimeseries(f.timeseries, summary);
    }
    // emd
    for (const [key, a] of agg.emd) {
      const [sidoName, sigName, emdName] = key.split("|");
      const code = input.regionCodeMap.get(key); if (!code) continue;
      const parentCode = input.regionCodeMap.get(`${sidoName}|${sigName}`);
      const f = ensure(code, emdName, "emd", parentCode ? { code: parentCode, name: sigName } : undefined);
      const summary = toSummary(e.id, a);
      f.elections.push(summary);
      addTimeseries(f.timeseries, summary);
    }
  }
  return acc;
}

function toSummary(electionId: string, a: ReturnType<typeof aggregateByRegion>["sido"] extends Map<string, infer V> ? V : never) {
  return {
    electionId,
    totalVoters: a.totalVoters, totalVotes: a.totalVotes,
    validVotes: a.validVotes, invalidVotes: a.invalidVotes,
    byParty: a.byParty
      .filter((p) => p.partyId)
      .map((p) => ({ partyId: p.partyId!, votes: p.votes, share: a.validVotes ? +(p.votes / a.validVotes * 100).toFixed(2) : 0 })),
    byKind: {},  // 단순화 — Task 2.4 에서 채움
  };
}

function addTimeseries(ts: Record<string, any[]>, s: { electionId: string; validVotes: number; byParty: { partyId: string; votes: number; share: number }[] }) {
  for (const p of s.byParty) {
    if (!ts[p.partyId]) ts[p.partyId] = [];
    ts[p.partyId].push({ electionId: s.electionId, votes: p.votes, totalVotes: s.validVotes, share: p.share });
  }
}
```

- [ ] **Step 3: 통과 확인 + Commit**

```bash
pnpm vitest tests/unit/build/build-region.test.ts
git add scripts/build/lib/build-region.ts tests/unit/build/build-region.test.ts
git commit -m "build: region 파일 + 시계열 builder"
```

---

### Task 2.4: election detail + station 파일 builder

**Files:**
- Create: `scripts/build/lib/build-election-detail.ts`
- Create: `scripts/build/lib/build-station.ts`
- Test: `tests/unit/build/build-election-detail.test.ts`

- [ ] **Step 1: election detail 테스트 + 구현 (요점만)**

```typescript
// scripts/build/lib/build-election-detail.ts
import { ParsedElection } from "./types";
import { resolveParty } from "./party-resolver";
import { ElectionDetailFile } from "../../../src/types/static";

export function buildElectionDetail(
  regionCode: string,
  regionFilter: (r: { sidoName: string; sigunguName: string; emdName: string | null }) => boolean,
  parsed: ParsedElection,
): ElectionDetailFile {
  const candidates = parsed.partyNames.map((n) => ({
    rawName: n,
    partyId: resolveParty(n, parsed.electionDate, parsed.electionId),
    votes: parsed.rows.filter((r) => regionFilter(r) && r.kind === "el_day")
      .reduce((s, r) => s + (r.parties.find((p) => p.rawName === n)?.votes ?? 0), 0),
  }));

  const byEmdMap = new Map<string, ElectionDetailFile["rowsByEmd"][number]>();
  for (const r of parsed.rows) {
    if (!regionFilter(r)) continue;
    if (r.kind !== "el_day" && r.kind !== "presub" && r.kind !== "abs" && r.kind !== "absentee" && r.kind !== "overseas") continue;
    const emdKey = r.emdName ?? "__top__";
    if (!byEmdMap.has(emdKey)) byEmdMap.set(emdKey, { emdName: r.emdName ?? "", emdCode: null, kindRows: [] });
    byEmdMap.get(emdKey)!.kindRows.push({
      kind: r.kind, name: r.stationName ?? r.kind,
      voters: r.totalVoters, votes: r.totalVotes, valid: r.validVotes, invalid: r.invalidVotes,
      byParty: r.parties.map((p) => ({ partyId: resolveParty(p.rawName, parsed.electionDate, parsed.electionId), votes: p.votes })),
    });
  }

  return { regionCode, electionId: parsed.electionId, candidates, rowsByEmd: [...byEmdMap.values()] };
}
```

- [ ] **Step 2: station 시계열 builder**

```typescript
// scripts/build/lib/build-station.ts
import { ParsedElection } from "./types";
import { resolveParty } from "./party-resolver";
import { StationFile } from "../../../src/types/static";

export function buildStations(parsedAll: Map<string, ParsedElection>): Map<string, StationFile> {
  const stations = new Map<string, StationFile>();
  for (const [, parsed] of parsedAll) {
    for (const r of parsed.rows) {
      if (r.kind !== "el_day" || !r.stationName) continue;
      const key = `${r.sigunguName}-${r.emdName ?? "x"}-${r.stationName}`;
      if (!stations.has(key)) stations.set(key, {
        stationKey: key, name: r.stationName,
        emdName: r.emdName ?? "", sigunguName: r.sigunguName, sidoName: r.sidoName,
        timeseries: {},
      });
      const f = stations.get(key)!;
      for (const p of r.parties) {
        const pid = resolveParty(p.rawName, parsed.electionDate, parsed.electionId);
        if (!pid) continue;
        if (!f.timeseries[pid]) f.timeseries[pid] = [];
        f.timeseries[pid].push({
          electionId: parsed.electionId,
          votes: p.votes, totalVotes: r.validVotes,
          share: r.validVotes ? +(p.votes / r.validVotes * 100).toFixed(2) : 0,
        });
      }
    }
  }
  return stations;
}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/build/lib/build-election-detail.ts scripts/build/lib/build-station.ts tests/unit/build/build-election-detail.test.ts
git commit -m "build: election detail + station 시계열 builder"
```

---

### Task 2.5: 통합 build-static CLI

**Files:**
- Create: `scripts/build/build-static.ts`
- Modify: `package.json` — `"build:static": "tsx scripts/build/build-static.ts"`

- [ ] **Step 1: 통합 CLI 구현**

```typescript
// scripts/build/build-static.ts
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildIndex } from "./lib/build-index";
import { buildRegionFiles } from "./lib/build-region";
import { buildElectionDetail } from "./lib/build-election-detail";
import { buildStations } from "./lib/build-station";
import { ParsedElection } from "./lib/types";

const OUT = "public/data/static";

async function loadParsed(): Promise<Map<string, ParsedElection>> {
  const m = new Map<string, ParsedElection>();
  if (!existsSync("data/parsed")) return m;
  for (const f of await readdir("data/parsed")) {
    if (!f.endsWith(".json")) continue;
    const parsed: ParsedElection = JSON.parse(await readFile(path.join("data/parsed", f), "utf-8"));
    m.set(parsed.electionId, parsed);
  }
  return m;
}

async function loadRegionCodeMap(): Promise<Map<string, string>> {
  // data/seed/regions.json 의 name → code 매핑을 평탄화
  const regions = JSON.parse(await readFile("data/seed/regions.json", "utf-8"));
  const m = new Map<string, string>();
  for (const s of regions.sido) m.set(s.name, s.code);
  for (const [sidoCode, list] of Object.entries<any>(regions.sigunguByRegion)) {
    const sidoName = regions.sido.find((x: any) => x.code === sidoCode)?.name;
    for (const sg of list as any[]) {
      m.set(`${sidoName}|${sg.name}`, sg.code);
    }
  }
  // emd 매핑 (별도 파일 또는 regions.json 의 emdByRegion 사용)
  return m;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(path.join(OUT, "region"), { recursive: true });
  await mkdir(path.join(OUT, "station"), { recursive: true });

  // index.json
  const idx = buildIndex();
  await writeFile(path.join(OUT, "index.json"), JSON.stringify(idx));
  console.log(`✓ index.json — elections=${idx.elections.length}`);

  // parsed 로딩
  const parsed = await loadParsed();
  const codeMap = await loadRegionCodeMap();

  // region 파일
  const regions = await buildRegionFiles({
    elections: idx.elections.map((e) => ({ id: e.id, date: e.date })),
    parsedByElection: parsed,
    regionCodeMap: codeMap,
  });
  for (const [code, f] of regions) {
    await writeFile(path.join(OUT, "region", `${code}.json`), JSON.stringify(f));
  }
  console.log(`✓ region/*.json — ${regions.size} files`);

  // election detail (각 region 별)
  for (const [code, regionFile] of regions) {
    const dir = path.join(OUT, "region", code);
    await mkdir(dir, { recursive: true });
    for (const e of regionFile.elections) {
      const p = parsed.get(e.electionId);
      if (!p) continue;
      const detail = buildElectionDetail(code, (r) => filterRowsForRegion(r, regionFile, codeMap), p);
      await writeFile(path.join(dir, `election-${e.electionId}.json`), JSON.stringify(detail));
    }
  }

  // station 시계열
  const stations = buildStations(parsed);
  for (const [key, f] of stations) {
    const safeKey = key.replace(/[\/\\]/g, "_");
    await writeFile(path.join(OUT, "station", `${safeKey}.json`), JSON.stringify(f));
  }
  console.log(`✓ station/*.json — ${stations.size} files`);
}

function filterRowsForRegion(
  r: { sidoName: string; sigunguName: string; emdName: string | null },
  region: { name: string; level: "sido" | "sigungu" | "emd"; parent?: { name: string } },
  _codeMap: Map<string, string>,
): boolean {
  if (region.level === "sido") return r.sidoName === region.name;
  if (region.level === "sigungu") return r.sidoName === region.parent?.name && r.sigunguName === region.name;
  if (region.level === "emd") return r.sigunguName === region.parent?.name && r.emdName === region.name;
  return false;
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: package.json scripts 추가**

```bash
# package.json
"build:static": "tsx scripts/build/build-static.ts",
"build:all": "pnpm build:parse && pnpm build:static"
```

- [ ] **Step 3: 실행 + 산출물 확인**

```bash
pnpm build:parse 2024-general
pnpm build:static
ls public/data/static/region | wc -l   # 수백 파일
ls public/data/static/station | wc -l  # 수천 ~ 만 파일
```

- [ ] **Step 4: .gitignore 갱신**

```bash
# .gitignore 추가
data/parsed/
public/data/static/
```

- [ ] **Step 5: Commit**

```bash
git add scripts/build/build-static.ts package.json .gitignore
git commit -m "build: 통합 build-static CLI"
```

---

## Phase 3: RSC → 정적 import 전환

### Task 3.1: static-data 접근자 (queries.ts 대체)

**Files:**
- Create: `src/lib/static-data.ts`
- Test: `tests/unit/static-data.test.ts`

- [ ] **Step 1: 접근자 구현**

```typescript
// src/lib/static-data.ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { StaticIndex, RegionFile, ElectionDetailFile, StationFile } from "../types/static";

const ROOT = path.resolve("public/data/static");

let indexCache: StaticIndex | null = null;
export async function getIndex(): Promise<StaticIndex> {
  if (indexCache) return indexCache;
  indexCache = JSON.parse(await readFile(path.join(ROOT, "index.json"), "utf-8"));
  return indexCache!;
}

export async function getRegionFile(code: string): Promise<RegionFile> {
  return JSON.parse(await readFile(path.join(ROOT, "region", `${code}.json`), "utf-8"));
}

export async function getElectionDetail(regionCode: string, electionId: string): Promise<ElectionDetailFile> {
  return JSON.parse(await readFile(path.join(ROOT, "region", regionCode, `election-${electionId}.json`), "utf-8"));
}

export async function getStationFile(stationKey: string): Promise<StationFile> {
  const safe = stationKey.replace(/[\/\\]/g, "_");
  return JSON.parse(await readFile(path.join(ROOT, "station", `${safe}.json`), "utf-8"));
}
```

- [ ] **Step 2: 단위 테스트**

```typescript
// tests/unit/static-data.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { getIndex, getRegionFile } from "../../src/lib/static-data";

describe("static-data", () => {
  it("index 로드", async () => {
    const idx = await getIndex();
    expect(idx.elections.length).toBeGreaterThan(0);
  });
  it("region 종로구 로드", async () => {
    const f = await getRegionFile("1111000000");
    expect(f.level).toBe("sigungu");
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/static-data.ts tests/unit/static-data.test.ts
git commit -m "feat: 정적 데이터 접근자 (static-data)"
```

---

### Task 3.2: 홈 페이지 정적 변환

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/HeaderControls.tsx`

- [ ] **Step 1: page.tsx 정적 변환**

```typescript
// src/app/page.tsx
import { getIndex, getRegionFile } from "@/lib/static-data";
import HeaderControls from "@/components/HeaderControls";
import TimeseriesChart from "@/components/TimeseriesChart";  // 기존 가정

export const dynamic = "force-static";

export default async function Home({ searchParams }: { searchParams: Promise<{ region?: string }> }) {
  const sp = await searchParams;
  const idx = await getIndex();
  const regionCode = sp.region ?? "all";   // "all" = 전국
  const regionFile = regionCode === "all" ? null : await getRegionFile(regionCode);

  return (
    <main>
      <HeaderControls index={idx} currentRegion={regionCode} />
      <TimeseriesChart
        elections={idx.elections}
        timeseries={regionFile?.timeseries ?? {}}
        parties={idx.parties}
      />
    </main>
  );
}
```

- [ ] **Step 2: HeaderControls 정적 변환 (props from index)**

```typescript
// src/components/HeaderControls.tsx 의 핵심 변경
import { StaticIndex } from "@/types/static";

interface Props { index: StaticIndex; currentRegion: string; }
export default function HeaderControls({ index, currentRegion }: Props) {
  // index.regions.sido / sigunguByRegion 으로 cascading select 렌더
  // ... (기존 로직, props 만 변경)
}
```

- [ ] **Step 3: 빌드 + 동작 확인**

```bash
pnpm build:all
pnpm build
pnpm start
# http://localhost:3000 접속 → 홈 차트 렌더 확인 (region 선택 → URL 갱신)
```

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/components/HeaderControls.tsx
git commit -m "feat: 홈 정적 import 전환"
```

---

### Task 3.3: region detail 페이지 정적 변환

**Files:**
- Modify: `src/app/region/[code]/page.tsx`

- [ ] **Step 1: generateStaticParams + 정적 fetch**

```typescript
// src/app/region/[code]/page.tsx
import { readdir } from "node:fs/promises";
import { getRegionFile, getElectionDetail, getIndex } from "@/lib/static-data";
import RegionPartyDist from "@/components/region/RegionPartyDist";
import RegionChildrenTable from "@/components/region/RegionChildrenTable";
import PresubVsElDay from "@/components/region/PresubVsElDay";
import RegionMiniSeries from "@/components/region/RegionMiniSeries";

export const dynamic = "force-static";

export async function generateStaticParams() {
  const files = await readdir("public/data/static/region");
  return files.filter((f) => f.endsWith(".json")).map((f) => ({ code: f.replace(/\.json$/, "") }));
}

export default async function RegionPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const idx = await getIndex();
  const region = await getRegionFile(code);

  return (
    <main>
      <h1>{region.name}</h1>
      <RegionPartyDist region={region} parties={idx.parties} />
      <RegionChildrenTable region={region} />
      <RegionMiniSeries region={region} parties={idx.parties} elections={idx.elections} />
      {/* PresubVsElDay 는 election detail 필요 — 최근 선거 1건만 inline */}
      <PresubVsElDayWrapper region={region} idx={idx} />
    </main>
  );
}

async function PresubVsElDayWrapper({ region, idx }: any) {
  const latestEl = idx.elections.find((e: any) => e.id === region.elections[0]?.electionId);
  if (!latestEl) return null;
  const detail = await getElectionDetail(region.code, latestEl.id);
  return <PresubVsElDay region={region} detail={detail} />;
}
```

- [ ] **Step 2: 빌드 + region 페이지 확인**

```bash
pnpm build
# Static page generation: region/[code] — N pages
pnpm start
# http://localhost:3000/region/1111000000 (종로구) 접속
```

- [ ] **Step 3: Commit**

```bash
git add src/app/region/[code]/page.tsx
git commit -m "feat: region detail 정적 변환"
```

---

### Task 3.4: 라이브 페이지·Phase 4 제거

**Files:**
- Delete: `src/app/live/page.tsx`
- Delete: `src/components/LiveBoard.tsx`
- Delete: `scripts/ingest/poll-live.ts`
- Delete: `.github/workflows/poll-live.yml`
- Modify: `src/lib/queries.ts` (라이브 함수만 제거)

- [ ] **Step 1: 라이브 자산 삭제**

```bash
git rm -r src/app/live src/components/LiveBoard.tsx scripts/ingest/poll-live.ts .github/workflows/poll-live.yml
```

- [ ] **Step 2: queries.ts 의 getLiveSnapshot·getLiveElectionOptions 함수 제거**

```bash
# src/lib/queries.ts 에서 두 함수 삭제 (다른 함수는 추후 Task 4 에서 정리)
```

- [ ] **Step 3: 빌드 확인 — 라이브 import 없는지**

```bash
pnpm build  # error 없으면 OK
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: 라이브 페이지·Phase 4 자동화 제거"
```

---

### Task 3.5: 정적 빌드 파이프라인 — Vercel 배포 검증

**Files:**
- Modify: `vercel.json` (또는 `package.json` build script)

- [ ] **Step 1: Vercel build script 갱신**

```json
// package.json
{
  "scripts": {
    "build": "pnpm build:all && next build"
  }
}
```

- [ ] **Step 2: 로컬 production build 검증**

```bash
pnpm build
pnpm start
# 핵심 페이지 동작 확인: /, /region/{code}
```

- [ ] **Step 3: data/parsed/ + public/data/static/ Vercel 환경 빌드 확인**

`build:parse` 가 build 시점 `data/raw/nec-downloads/` 가 필요. 두 옵션:

**옵션 A (권장):** `data/parsed/*.json` 만 git commit, `build:static` 만 Vercel build 시 실행.
- `.gitignore` 에서 `data/parsed/` 줄 제거.
- `package.json` build script: `"build": "pnpm build:static && next build"`.

**옵션 B:** `public/data/static/` 도 모두 git commit (Vercel build 단순화).

- [ ] **Step 4: 옵션 A 적용 + .gitignore 갱신**

```bash
# .gitignore — data/parsed/ 줄 제거, public/data/static/ 만 유지
git add data/parsed/*.json
git commit -m "build: parsed JSON 커밋 (Vercel build 단순화)"
```

- [ ] **Step 5: Vercel 배포 + 라이브 사이트 동작 확인**

```bash
git push
# Vercel dashboard 에서 build log 확인 — build:static 성공 + next build 성공
# 배포 URL 에서 핵심 페이지 동작 확인
```

- [ ] **Step 6: Commit**

```bash
git add vercel.json package.json
git commit -m "build: Vercel 빌드 파이프라인 (build:static 통합)"
```

---

## Phase 4: Supabase 정리

### Task 4.1: DB dump 백업

- [ ] **Step 1: 전체 DB dump → 로컬 보존**

```bash
# Supabase SQL editor 또는 pg_dump
pg_dump "$DATABASE_URL" > backups/supabase-final-2026-06-06.sql
# 또는 Supabase dashboard 에서 .sql backup 다운로드
mkdir -p backups
mv ~/Downloads/supabase-backup-*.sql backups/supabase-final-2026-06-06.sql
```

- [ ] **Step 2: backup 파일 git ignore (개인 backup, 공개 X)**

```bash
echo "backups/" >> .gitignore
git add .gitignore
git commit -m "chore: backups/ 디렉터리 무시"
```

---

### Task 4.2: DB 의존 코드 제거

**Files:**
- Delete: `src/lib/db.ts`, `src/lib/db-admin.ts`, `drizzle.config.ts`
- Move: `db/schema.ts` → `docs/legacy/db-schema.ts.txt` (참고용)
- Delete: `scripts/ingest/ingest-*.ts`, `scripts/ingest/fetch-*.ts` (archive HTML 폴백용 형식 E 만 보존)
- Delete: `scripts/ingest/seed/*.ts` (DB seed)
- Modify: `package.json` — drizzle·postgres 의존성 제거, scripts 정리

- [ ] **Step 1: db 의존 코드 삭제**

```bash
mkdir -p docs/legacy
git mv db/schema.ts docs/legacy/db-schema.ts.txt
git rm -r src/lib/db.ts src/lib/db-admin.ts drizzle.config.ts db/
# 라이브·ingest 잔여 제거 (형식 E 폴백용 nec-html.ts 만 scripts/build/lib/ 로 이동)
git mv scripts/ingest/lib/nec-html.ts scripts/build/lib/nec-html.ts
git rm -r scripts/ingest/
```

- [ ] **Step 2: queries.ts 잔여 함수 — static-data 호출로 교체 또는 제거**

```bash
# src/lib/queries.ts 를 src/lib/static-data.ts 로 alias 또는 import 정리
git rm src/lib/queries.ts  # 모든 호출 static-data 직접 import 로 교체된 상태 확인
```

- [ ] **Step 3: package.json 의존성 정리**

```bash
pnpm remove drizzle-orm drizzle-kit postgres
# scripts 정리
```

`package.json` 의 scripts:
```json
{
  "scripts": {
    "build:parse": "tsx scripts/build/parse-nec-xlsx.ts",
    "build:static": "tsx scripts/build/build-static.ts",
    "build:all": "pnpm build:parse && pnpm build:static",
    "build": "pnpm build:static && next build",
    "test": "vitest run",
    "lint": "next lint",
    "start": "next start"
  }
}
```

- [ ] **Step 4: TypeScript 빌드 확인**

```bash
pnpm tsc --noEmit
# error 없으면 OK
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: Supabase·drizzle 의존성 제거 — 정적 사이트 완성"
```

---

### Task 4.3: Vercel 안정 확인 후 Supabase 인스턴스 삭제

- [ ] **Step 1: 1주일 모니터링 (Vercel analytics·error log)**

수동 단계. Vercel dashboard 에서:
- Error rate < 0.1%
- Build success rate 100%
- 핵심 페이지 (/, /region/{code}) 응답 정상

- [ ] **Step 2: Supabase 인스턴스 삭제**

수동 단계. Supabase dashboard → Project settings → Delete project.

- [ ] **Step 3: DATABASE_URL 환경변수 제거**

수동 단계. Vercel dashboard → Settings → Environment Variables → DATABASE_URL 삭제.

- [ ] **Step 4: 완료 Commit (CHANGELOG·README 갱신)**

```bash
# README.md 갱신 — 정적 사이트, Supabase 제거, build:all 흐름 명시
git add README.md CHANGELOG.md
git commit -m "docs: 정적 마이그레이션 완료 — Supabase 제거"
```

---

## Self-Review (writer 검증)

**1. Spec 커버리지:**
- 데이터 source (xlsx 5 형식) → Task 1.2~1.6 ✓
- chunk schema → Task 2.1 (types) + 2.3·2.4 (builder) ✓
- 페이지별 fetch 패턴 → Task 3.2·3.3 ✓
- Migration 4 phase → Phase 1~4 모두 ✓
- Removal scope → Task 3.4 (라이브) + 4.2 (DB) ✓
- Testing 전략 → 각 Task TDD step + build:all 검증 step ✓

**2. Placeholder 스캔:** 모든 Task 의 코드 step 에 실제 코드 포함. 수동 step (DB dump·Supabase 삭제) 은 명시. 검사 통과.

**3. Type consistency:** `ParsedStationRow` (모든 parser), `RegionFile`/`ElectionDetailFile`/`StationFile` (Task 2.1 정의 → Task 2.3·2.4·3.x 사용), `StaticIndex` 동일. 일치.

**알려진 제약:**
- `data/seed/regions.json` 파일 존재 가정 — 없으면 별도 task 추가 필요 (Phase 0 setup).
- emd 코드 매핑 = `regions.json` 의 `emdByRegion` 필드 가정. 현 seed 에 없으면 별도 dump 필요.
- 2007 대선·2008 총선 fetch (archive HTML) 의 ingestion 자동화는 본 plan scope 외 (수동 fetch + parse format E).
