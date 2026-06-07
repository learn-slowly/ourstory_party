# ourstory Phase 7.1 — 2022 8회 지선 읍·면·동 데이터 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NEC 게시판 zip(`제8회_전국동시지방선거_읍면동별_개표결과-게시판게시.zip`) 의 9 xlsx 를 파싱해 2022 8회 지방선거의 읍·면·동 단위 정당별 득표 데이터를 region.json 의 timeseries 에 합산한다. 사용자가 "창원 성산 상남동의 2022 지선 정의당 추이" 같은 마이크로 분석을 할 수 있게.

**Architecture:** 신규 파서 `scripts/build/parsers/parse-jiseon-2022.ts` 가 zip 풀어 9 xlsx 행별 파싱 → `data/parsed/2022-local/{electionId}.json` 중간 산출물. `build-static.ts` 가 중간 산출물을 region.json 의 timeseries 에 합산.

**Tech Stack:** Node 24 · tsx · `xlsx` (SheetJS, 이미 dep) · `adm-zip` (신규) · `iconv-lite` (이미 dep) · vitest

선행 spec: `docs/superpowers/specs/2026-06-07-phase-7.1-jiseon-2022-emd-design.md`
입력: `/Users/ahbaik/Downloads/제8회_전국동시지방선거_읍면동별_개표결과-게시판게시.zip`
병렬 진행 가능: Phase 6.2 (picker 활성화, `src/components/`)

---

## 파일 구조

| 파일 | 동작 | 책임 |
|------|------|------|
| `package.json` | Modify | `adm-zip` 추가 |
| `scripts/build/region-name-to-code.ts` | Create | StaticIndex 의 regions 에서 (이름 → 코드) lookup 빌더 |
| `scripts/build/region-name-to-code.test.ts` | Create | lookup 단위 테스트 (중복 이름 처리 포함) |
| `scripts/build/parsers/parse-jiseon-2022.ts` | Create | zip 풀기 + xlsx 9개 행별 파싱 |
| `scripts/build/parsers/parse-jiseon-2022.test.ts` | Create | 단위 테스트 (5+ 케이스) |
| `scripts/build/parsers/jiseon-2022-fixtures/sample.xlsx` | Create | 단위 테스트용 작은 xlsx |
| `scripts/build/parsers/jiseon-2022-types.ts` | Create | parser 입출력 타입 |
| `scripts/build/build-parse.ts` (또는 기존 entry) | Modify | parse-jiseon-2022 호출 추가 |
| `scripts/build/build-static.ts` | Modify | `data/parsed/2022-local/*.json` 을 region.json 의 timeseries 에 합산 |
| `data/meta/parties.json` | Modify (필요 시) | 새 alias 추가 |

---

## Task 1: adm-zip 추가

**Files:**
- Modify: `package.json`

- [ ] **Step 1: dep 추가**

```bash
cd /Users/ahbaik/coding/ourstory && pnpm add adm-zip && pnpm add -D @types/adm-zip
```

- [ ] **Step 2: 설치 확인**

```bash
node -e "console.log(require('adm-zip/package.json').version)"
```

Expected: `0.5.x`

- [ ] **Step 3: 커밋**

```bash
git add package.json pnpm-lock.yaml
git commit -m "deps: adm-zip 추가 (Phase 7.1 NEC 지선 zip 파싱용)"
```

---

## Task 2: region-name-to-code lookup (TDD)

**Files:**
- Create: `scripts/build/region-name-to-code.ts`
- Create: `scripts/build/region-name-to-code.test.ts`

NEC xlsx 의 (시·도, 시·군·구, 읍·면·동) 이름을 region code 로 매핑. 동명 emd 처리(부모 경로 기반).

- [ ] **Step 1: 실패 테스트 작성**

`scripts/build/region-name-to-code.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildRegionNameLookup, lookupRegion } from "./region-name-to-code";

const fakeIndex = {
  regions: {
    sido: [
      { code: "4800000000", name: "경상남도" },
      { code: "1100000000", name: "서울특별시" },
    ],
    sigunguByRegion: {
      "4800000000": [
        { code: "4812000000", name: "창원시" },
        { code: "4817000000", name: "진주시" },
      ],
      "1100000000": [
        { code: "1117000000", name: "용산구" },
      ],
    },
    emdByRegion: {
      "4812000000": [
        { code: "4812011000", name: "상남동" },
        { code: "4812060000", name: "중앙동" },
      ],
      "4817000000": [
        { code: "4817056000", name: "문산읍" },
        { code: "4817099000", name: "중앙동" }, // 진주에도 중앙동
      ],
    },
  },
};

describe("buildRegionNameLookup", () => {
  it("시·도 이름으로 코드", () => {
    const l = buildRegionNameLookup(fakeIndex as never);
    expect(lookupRegion(l, { sido: "경상남도" })).toBe("4800000000");
  });

  it("시·군·구는 시·도 경로 필요", () => {
    const l = buildRegionNameLookup(fakeIndex as never);
    expect(lookupRegion(l, { sido: "경상남도", sigungu: "창원시" })).toBe("4812000000");
  });

  it("읍·면·동은 시·군·구 경로로 disambiguate", () => {
    const l = buildRegionNameLookup(fakeIndex as never);
    expect(lookupRegion(l, { sido: "경상남도", sigungu: "창원시", emd: "중앙동" })).toBe("4812060000");
    expect(lookupRegion(l, { sido: "경상남도", sigungu: "진주시", emd: "중앙동" })).toBe("4817099000");
  });

  it("미존재 → null", () => {
    const l = buildRegionNameLookup(fakeIndex as never);
    expect(lookupRegion(l, { sido: "전라남도" })).toBeNull();
  });

  it("공백 정규화 (trim)", () => {
    const l = buildRegionNameLookup(fakeIndex as never);
    expect(lookupRegion(l, { sido: " 경상남도 ", sigungu: " 창원시 " })).toBe("4812000000");
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
cd /Users/ahbaik/coding/ourstory && pnpm test region-name-to-code
```

Expected: FAIL — module not found

- [ ] **Step 3: 구현**

`scripts/build/region-name-to-code.ts`:

```ts
import type { StaticIndex } from "../../src/types/static";

export interface RegionNameLookup {
  sido: Record<string, string>;                              // name → code
  sigunguByParent: Record<string, Record<string, string>>;   // sidoCode → name → code
  emdByParent: Record<string, Record<string, string>>;       // sigunguCode → name → code
}

const norm = (s: string) => s.trim();

export function buildRegionNameLookup(index: StaticIndex): RegionNameLookup {
  const sido: Record<string, string> = {};
  for (const r of index.regions.sido) sido[norm(r.name)] = r.code;

  const sigunguByParent: Record<string, Record<string, string>> = {};
  for (const [sidoCode, list] of Object.entries(index.regions.sigunguByRegion)) {
    const m: Record<string, string> = {};
    for (const r of list) m[norm(r.name)] = r.code;
    sigunguByParent[sidoCode] = m;
  }

  const emdByParent: Record<string, Record<string, string>> = {};
  for (const [sigunguCode, list] of Object.entries(index.regions.emdByRegion ?? {})) {
    const m: Record<string, string> = {};
    for (const r of list) m[norm(r.name)] = r.code;
    emdByParent[sigunguCode] = m;
  }

  return { sido, sigunguByParent, emdByParent };
}

export function lookupRegion(
  l: RegionNameLookup,
  path: { sido?: string; sigungu?: string; emd?: string },
): string | null {
  const sidoName = path.sido ? norm(path.sido) : "";
  if (!sidoName) return null;
  const sidoCode = l.sido[sidoName];
  if (!sidoCode) return null;
  if (!path.sigungu) return sidoCode;

  const sigunguName = norm(path.sigungu);
  const sigunguCode = l.sigunguByParent[sidoCode]?.[sigunguName];
  if (!sigunguCode) return null;
  if (!path.emd) return sigunguCode;

  const emdName = norm(path.emd);
  const emdCode = l.emdByParent[sigunguCode]?.[emdName];
  return emdCode ?? null;
}
```

- [ ] **Step 4: 테스트 PASS**

```bash
pnpm test region-name-to-code
```

Expected: 5/5 PASS

- [ ] **Step 5: 커밋**

```bash
git add scripts/build/region-name-to-code.ts scripts/build/region-name-to-code.test.ts
git commit -m "build: region-name-to-code — (시·도/시·군·구/읍·면·동 이름) → 10자리 코드 lookup"
```

---

## Task 3: parse-jiseon-2022 — zip 풀기 + 형식 파악

먼저 실제 zip 의 한 xlsx 열어보고 컬럼 구조 확인. 이 task 는 탐색 + types 정의 + 한 xlsx 만 처리.

**Files:**
- Create: `scripts/build/parsers/jiseon-2022-types.ts`
- Create: `scripts/build/parsers/parse-jiseon-2022.ts` (1차 — zip 풀기 + 한 xlsx 행 추출만)

- [ ] **Step 1: zip 풀기 + 한 xlsx 의 sheet structure 확인**

임시 스크립트로 한 번만 실행:

```bash
cd /Users/ahbaik/coding/ourstory && cat > /tmp/inspect-jiseon-2022.mjs <<'EOF'
import AdmZip from "adm-zip";
import * as XLSX from "xlsx";
import iconv from "iconv-lite";

const ZIP = "/Users/ahbaik/Downloads/제8회_전국동시지방선거_읍면동별_개표결과-게시판게시.zip";
const zip = new AdmZip(ZIP);
const entries = zip.getEntries();
console.log("=== files in zip:");
for (const e of entries) {
  const name = iconv.decode(Buffer.from(e.rawEntryName), "cp949");
  console.log(" ", name, "(", e.header.size, "bytes )");
}
// 첫 xlsx 열기
const first = entries[0];
const wb = XLSX.read(first.getData(), { type: "buffer" });
console.log("=== first xlsx sheets:", wb.SheetNames);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
console.log("=== first 5 rows:");
for (const r of rows.slice(0, 5)) console.log(r);
EOF
cd /Users/ahbaik/coding/ourstory && pnpm exec tsx /tmp/inspect-jiseon-2022.mjs 2>&1 | head -40
```

Expected: 9개 xlsx 파일명(한글) + 첫 xlsx 의 첫 5 행 출력. 행 구조에서 헤더/시·도/시·군·구/읍·면·동/정당 컬럼 위치 파악.

- [ ] **Step 2: 결과 기반으로 types 정의**

Step 1 출력 본 다음 (예시 — 실제는 다를 수 있음):

`scripts/build/parsers/jiseon-2022-types.ts`:

```ts
export interface JiseonRow {
  sido: string;
  sigungu: string;
  emd: string;
  partyName: string;  // 원본 정당명 (정규화 전)
  votes: number;
  totalVotes: number;
}

export interface JiseonOutput {
  electionId: string;        // 예: "2022-local-governor"
  electionName: string;      // 예: "제8회 지방선거 — 시·도지사"
  date: string;              // "2022-06-01"
  type: string;              // "governor" 등
  rows: JiseonRow[];
}
```

- [ ] **Step 3: zip → xlsx 9개 → rows 추출 1차 구현**

`scripts/build/parsers/parse-jiseon-2022.ts`:

```ts
import AdmZip from "adm-zip";
import * as XLSX from "xlsx";
import iconv from "iconv-lite";
import type { JiseonRow, JiseonOutput } from "./jiseon-2022-types";

// xlsx 파일명 → election 메타 매핑 (Step 1 의 결과 기반으로 정확한 키 채움)
const FILE_TO_ELECTION: Record<string, { id: string; name: string; type: string }> = {
  // 예시 (실제 파일명에 맞춰 수정 필요):
  "광역단체장-읍면동별.xlsx": { id: "2022-local-governor", name: "제8회 지방선거 — 시·도지사", type: "governor" },
  "기초단체장-읍면동별.xlsx": { id: "2022-local-mayor", name: "제8회 지방선거 — 시장·군수·구청장", type: "mayor" },
  "광역의원_지역구-읍면동별.xlsx": { id: "2022-local-council", name: "제8회 지방선거 — 시·도의원 지역구", type: "local_council" },
  "광역의원_비례-읍면동별.xlsx": { id: "2022-local-council-prop", name: "제8회 지방선거 — 시·도의원 비례", type: "local_council_prop" },
  "기초의원_지역구-읍면동별.xlsx": { id: "2022-local-council-basic", name: "제8회 지방선거 — 구·시·군의원 지역구", type: "local_council_basic" },
  "기초의원_비례-읍면동별.xlsx": { id: "2022-local-council-basic-prop", name: "제8회 지방선거 — 구·시·군의원 비례", type: "local_council_basic_prop" },
  "교육감-읍면동별.xlsx": { id: "2022-local-superintendent", name: "제8회 지방선거 — 교육감", type: "superintendent" },
};

const DATE = "2022-06-01";

export async function parseJiseon2022(zipPath: string): Promise<JiseonOutput[]> {
  const zip = new (AdmZip as never as typeof import("adm-zip"))(zipPath);
  const entries = zip.getEntries();
  const outputs: JiseonOutput[] = [];

  for (const entry of entries) {
    const filename = iconv.decode(Buffer.from(entry.rawEntryName), "cp949");
    const meta = FILE_TO_ELECTION[filename];
    if (!meta) {
      console.warn(`[parse-jiseon-2022] 미매핑 파일 skip: ${filename}`);
      continue;
    }
    const wb = XLSX.read(entry.getData(), { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = parseSheetRows(sheet);
    outputs.push({
      electionId: meta.id,
      electionName: meta.name,
      date: DATE,
      type: meta.type,
      rows,
    });
  }

  return outputs;
}

// sheet → JiseonRow[]. Step 1 결과 기반 컬럼 인덱스 채움.
// 일반적으로:
//   col 0: 시·도
//   col 1: 시·군·구
//   col 2: 읍·면·동
//   col 3..n-2: 정당 컬럼들 (헤더 row 에 정당명)
//   col n-1: 합계 또는 무효 (skip)
function parseSheetRows(sheet: XLSX.WorkSheet): JiseonRow[] {
  const json: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
  });
  if (json.length < 3) return [];

  // 헤더 row 위치 추정 — Step 1 출력으로 확정
  const headerRow = json[2] as (string | null)[]; // 예시 — 실제 위치는 inspect 결과로
  const partyCols: Array<{ idx: number; name: string }> = [];
  for (let i = 3; i < headerRow.length; i++) {
    const cell = headerRow[i];
    if (typeof cell === "string" && cell.trim() && cell !== "계" && cell !== "합계") {
      partyCols.push({ idx: i, name: cell.trim() });
    }
  }

  const result: JiseonRow[] = [];
  for (let r = 3; r < json.length; r++) {
    const row = json[r];
    const sido = String(row[0] ?? "").trim();
    const sigungu = String(row[1] ?? "").trim();
    const emd = String(row[2] ?? "").trim();
    // 합계/header row skip
    if (!emd || emd === "합계" || emd === "소계" || emd === "전체") continue;
    if (!sido || !sigungu) continue;

    // 총 유효표 = 정당 합계
    let totalVotes = 0;
    for (const pc of partyCols) {
      const v = Number(row[pc.idx] ?? 0);
      if (Number.isFinite(v)) totalVotes += v;
    }
    if (totalVotes === 0) continue;

    for (const pc of partyCols) {
      const v = Number(row[pc.idx] ?? 0);
      if (!Number.isFinite(v) || v <= 0) continue;
      result.push({ sido, sigungu, emd, partyName: pc.name, votes: v, totalVotes });
    }
  }

  return result;
}
```

- [ ] **Step 4: 1차 실행 — 행 수 확인**

```bash
cd /Users/ahbaik/coding/ourstory && cat > /tmp/run-parser.mjs <<'EOF'
import { parseJiseon2022 } from "./scripts/build/parsers/parse-jiseon-2022.ts";
const out = await parseJiseon2022("/Users/ahbaik/Downloads/제8회_전국동시지방선거_읍면동별_개표결과-게시판게시.zip");
for (const o of out) console.log(o.electionId, ":", o.rows.length, "rows");
EOF
pnpm exec tsx /tmp/run-parser.mjs 2>&1 | head -20
```

Expected: 7~9개 election 각각 수천 행. 0 행 이면 파서 형식 확인 필요.

- [ ] **Step 5: 1차 커밋**

```bash
git add scripts/build/parsers/parse-jiseon-2022.ts scripts/build/parsers/jiseon-2022-types.ts
git commit -m "build(parser): parse-jiseon-2022 1차 — zip 풀기 + 행 추출 (정당 정규화 전)"
```

---

## Task 4: parse-jiseon-2022 단위 테스트 (TDD)

**Files:**
- Create: `scripts/build/parsers/parse-jiseon-2022.test.ts`
- Create: `scripts/build/parsers/fixtures/sample-jiseon-2022.xlsx` (작은 sample)

- [ ] **Step 1: fixture xlsx 만들기**

Task 3 의 실제 1 xlsx 결과에서 첫 10 행 정도 추출해 sample.xlsx 작성. 또는 xlsx 라이브러리로 프로그래매틱 생성:

```bash
cd /Users/ahbaik/coding/ourstory && cat > /tmp/make-fixture.mjs <<'EOF'
import * as XLSX from "xlsx";
import fs from "node:fs";

const data = [
  ["제8회 전국동시지방선거 광역단체장 선거 읍·면·동별 개표 결과", null, null, null, null, null],
  [null, null, null, null, null, null],
  ["시·도", "시·군·구", "읍·면·동", "더불어민주당", "국민의힘", "정의당"],
  ["경상남도", "창원시", "상남동", 1234, 5678, 234],
  ["경상남도", "창원시", "사파동", 1100, 5200, 180],
  ["경상남도", "창원시", "합계", 30000, 70000, 5000],
  ["경상남도", "진주시", "중앙동", 800, 4000, 150],
];
const ws = XLSX.utils.aoa_to_sheet(data);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
fs.mkdirSync("scripts/build/parsers/fixtures", { recursive: true });
XLSX.writeFile(wb, "scripts/build/parsers/fixtures/sample-jiseon-2022.xlsx");
console.log("fixture 생성 완료");
EOF
pnpm exec tsx /tmp/make-fixture.mjs
```

- [ ] **Step 2: 실패 테스트**

`scripts/build/parsers/parse-jiseon-2022.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSheetRowsForTest } from "./parse-jiseon-2022";  // export 추가 필요
import * as XLSX from "xlsx";

const wb = XLSX.readFile("scripts/build/parsers/fixtures/sample-jiseon-2022.xlsx");
const sheet = wb.Sheets[wb.SheetNames[0]];

describe("parse-jiseon-2022 — parseSheetRows", () => {
  const rows = parseSheetRowsForTest(sheet);

  it("정상 emd 행 추출", () => {
    expect(rows.find((r) => r.emd === "상남동" && r.partyName === "더불어민주당")?.votes).toBe(1234);
  });

  it("정당 컬럼 3개 → 3 행씩 emd 마다", () => {
    const sangnam = rows.filter((r) => r.emd === "상남동");
    expect(sangnam.length).toBe(3);
    expect(sangnam.map((r) => r.partyName).sort()).toEqual(["국민의힘", "더불어민주당", "정의당"]);
  });

  it("'합계' row 는 skip", () => {
    expect(rows.find((r) => r.emd === "합계")).toBeUndefined();
  });

  it("totalVotes 가 행 정당 합", () => {
    const r = rows.find((r) => r.emd === "상남동" && r.partyName === "더불어민주당");
    expect(r?.totalVotes).toBe(1234 + 5678 + 234);
  });

  it("진주시 중앙동도 정상 (시·도/시·군 지정)", () => {
    expect(rows.find((r) => r.sigungu === "진주시" && r.emd === "중앙동" && r.partyName === "정의당")?.votes).toBe(150);
  });
});
```

- [ ] **Step 3: parseSheetRows 를 export 로 노출**

`parse-jiseon-2022.ts` 의 `parseSheetRows` 를 외부 테스트용으로 export:

```ts
// 기존 내부 함수 옆에:
export const parseSheetRowsForTest = parseSheetRows;
```

- [ ] **Step 4: 테스트 PASS**

```bash
cd /Users/ahbaik/coding/ourstory && pnpm test parse-jiseon-2022
```

Expected: 5/5 PASS. 만약 파서 형식이 fixture 와 안 맞으면 parseSheetRows 의 헤더 row 위치 등 보정.

- [ ] **Step 5: 커밋**

```bash
git add scripts/build/parsers/parse-jiseon-2022.test.ts scripts/build/parsers/fixtures/ scripts/build/parsers/parse-jiseon-2022.ts
git commit -m "test(parser): parse-jiseon-2022 단위 테스트 5 케이스 + fixture xlsx"
```

---

## Task 5: 정당명 정규화 + 중간 산출물 출력

**Files:**
- Modify: `scripts/build/parsers/parse-jiseon-2022.ts`
- Read-only: `data/meta/parties.json`

- [ ] **Step 1: parties.json 로드 + alias 매칭 함수 추가**

`parse-jiseon-2022.ts` 안:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";

interface PartyMeta {
  id: string;
  name: string;
  color: string;
  family: string;
  aliases?: string[];
}

function loadPartyAliases(): Map<string, string> {
  const f = readFileSync(path.resolve("data/meta/parties.json"), "utf-8");
  const parties: PartyMeta[] = JSON.parse(f);
  const map = new Map<string, string>();
  for (const p of parties) {
    map.set(p.name.replace(/\s/g, ""), p.id);
    for (const a of p.aliases ?? []) map.set(a.replace(/\s/g, ""), p.id);
  }
  return map;
}

export function normalizePartyName(rawName: string, aliasMap: Map<string, string>): string {
  const key = rawName.replace(/\s/g, "");
  return aliasMap.get(key) ?? "other";
}
```

- [ ] **Step 2: 중간 산출물 출력 추가**

main entry 추가:

```ts
import { writeFileSync, mkdirSync } from "node:fs";

export async function buildJiseon2022Output(zipPath: string, outDir: string): Promise<void> {
  const aliasMap = loadPartyAliases();
  const parsed = await parseJiseon2022(zipPath);

  mkdirSync(outDir, { recursive: true });
  const otherCounts: Record<string, number> = {};

  for (const out of parsed) {
    const normalized = out.rows.map((r) => {
      const partyId = normalizePartyName(r.partyName, aliasMap);
      if (partyId === "other") otherCounts[r.partyName] = (otherCounts[r.partyName] ?? 0) + 1;
      return { ...r, partyId };
    });
    writeFileSync(
      path.join(outDir, `${out.electionId}.json`),
      JSON.stringify({ ...out, rows: normalized }, null, 0),
      "utf-8",
    );
  }

  if (Object.keys(otherCounts).length > 0) {
    console.warn("[parse-jiseon-2022] 미매핑 정당 카운트:", otherCounts);
  }
}
```

- [ ] **Step 3: 실행해서 산출물 확인**

```bash
cd /Users/ahbaik/coding/ourstory && cat > /tmp/run-jiseon.mjs <<'EOF'
import { buildJiseon2022Output } from "./scripts/build/parsers/parse-jiseon-2022.ts";
await buildJiseon2022Output(
  "/Users/ahbaik/Downloads/제8회_전국동시지방선거_읍면동별_개표결과-게시판게시.zip",
  "data/parsed/2022-local",
);
console.log("done");
EOF
pnpm exec tsx /tmp/run-jiseon.mjs 2>&1 | head -30
ls data/parsed/2022-local/
```

Expected: 7~9개 json. 미매핑 정당 console 에 표시 (있으면 parties.json 의 aliases 보강 검토).

- [ ] **Step 4: 미매핑 정당이 있으면 parties.json 보강**

console 출력 보고 빠진 정당 alias 추가. 예:
```jsonc
// data/meta/parties.json 안:
{ "id": "justice", "name": "정의당", "aliases": ["정의당", "정의"] }
```

- [ ] **Step 5: 재실행 + 0 미매핑 확인**

위 Step 3 재실행. otherCounts 가 0 또는 무시 가능 수준이면 OK.

- [ ] **Step 6: 커밋**

```bash
git add scripts/build/parsers/parse-jiseon-2022.ts data/parsed/2022-local/ data/meta/parties.json
git commit -m "build(parser): parse-jiseon-2022 — 정당 정규화 + data/parsed/2022-local 산출"
```

---

## Task 6: build-static 통합 — region.json timeseries 에 합산

**Files:**
- Modify: `scripts/build/build-static.ts`

- [ ] **Step 1: build-static.ts 의 region.json 생성 단계 확인**

```bash
cd /Users/ahbaik/coding/ourstory && grep -n "timeseries\|writeFile" scripts/build/build-static.ts | head -20
```

region 파일 쓰기 직전에 끼워 넣을 위치 파악.

- [ ] **Step 2: 통합 코드 추가**

build-static.ts 의 region.json 쓰기 직전(또는 timeseries 만드는 단계) 에 추가:

```ts
import { lookupRegion, buildRegionNameLookup } from "./region-name-to-code";

// 2022 지선 emd 단위 데이터 합산
const PARSED_DIR = path.resolve("data/parsed/2022-local");
let jiseon2022Files: string[] = [];
try {
  jiseon2022Files = (await readdir(PARSED_DIR)).filter((f) => f.endsWith(".json"));
} catch {
  console.warn("[build-static] data/parsed/2022-local 없음 — Phase 7.1 파서 먼저 실행 필요");
}

if (jiseon2022Files.length > 0) {
  const nameLookup = buildRegionNameLookup({ regions: { sido, sigunguByRegion, emdByRegion } } as never);
  const unmappedCount: Record<string, number> = {};

  for (const f of jiseon2022Files) {
    const out = JSON.parse(await readFile(path.join(PARSED_DIR, f), "utf-8"));
    const { electionId, rows } = out as { electionId: string; rows: Array<{ sido: string; sigungu: string; emd: string; partyId: string; votes: number; totalVotes: number }> };

    // region code 별로 group
    const byRegion: Record<string, Array<typeof rows[number]>> = {};
    for (const row of rows) {
      const code = lookupRegion(nameLookup, { sido: row.sido, sigungu: row.sigungu, emd: row.emd });
      if (!code) {
        const key = `${row.sido}/${row.sigungu}/${row.emd}`;
        unmappedCount[key] = (unmappedCount[key] ?? 0) + 1;
        continue;
      }
      (byRegion[code] ??= []).push(row);
    }

    // 각 region 의 timeseries 에 추가
    for (const [regionCode, regionRows] of Object.entries(byRegion)) {
      // 정당별 합산
      const partyAgg: Record<string, { votes: number; totalVotes: number }> = {};
      for (const r of regionRows) {
        const a = (partyAgg[r.partyId] ??= { votes: 0, totalVotes: 0 });
        a.votes += r.votes;
        a.totalVotes = r.totalVotes; // 행마다 같으므로
      }
      const tsEntries = Object.entries(partyAgg).map(([partyId, { votes, totalVotes }]) => ({
        partyId,
        electionId,
        votes,
        totalVotes,
        share: totalVotes > 0 ? votes / totalVotes : 0,
      }));

      // regionsTimeseries 에 누적 (기존 데이터 구조에 맞춰)
      // 실제 구조는 build-static.ts 의 기존 코드 확인 후 정확히 작성
      for (const e of tsEntries) {
        regionsTimeseries[regionCode] ??= {};
        regionsTimeseries[regionCode][e.partyId] ??= [];
        regionsTimeseries[regionCode][e.partyId].push({
          electionId: e.electionId,
          votes: e.votes,
          totalVotes: e.totalVotes,
          share: e.share,
        });
      }
    }
  }

  const totalUnmapped = Object.values(unmappedCount).reduce((s, n) => s + n, 0);
  if (totalUnmapped > 0) {
    console.warn(`[build-static] 2022 지선 region 매핑 실패 ${totalUnmapped} 행. Top:`, Object.entries(unmappedCount).sort((a, b) => b[1] - a[1]).slice(0, 5));
  }
}
```

(`regionsTimeseries` 변수명은 build-static.ts 의 실제 패턴 따른다 — Step 1 결과로 확정.)

- [ ] **Step 3: build 실행**

```bash
cd /Users/ahbaik/coding/ourstory && pnpm build:static 2>&1 | tail -20
```

Expected: 에러 없이 완료. console 에 "2022 지선 region 매핑 실패" 가 적거나 0.

- [ ] **Step 4: 검증 — 창원시 상남동 region.json**

```bash
node -e "const d=JSON.parse(require('fs').readFileSync('public/data/static/region/4812011000.json','utf-8')); console.log('keys:', Object.keys(d.timeseries)); console.log('justice 2022:', d.timeseries.justice?.filter(p => p.electionId.startsWith('2022-local')))"
```

(`4812011000` 은 상남동 코드 — 실제 코드는 index.json 에서 확인)

Expected: 2022 지선 election 들의 entry 가 보임.

- [ ] **Step 5: 커밋**

```bash
git add scripts/build/build-static.ts public/data/static/
git commit -m "build: 2022 지선 emd 데이터를 region.json 의 timeseries 에 합산"
```

---

## Task 7: 검증 + push

- [ ] **Step 1: 단위 테스트 + tsc 전부**

```bash
cd /Users/ahbaik/coding/ourstory && pnpm test && pnpm exec tsc --noEmit
```

Expected: 모두 PASS, 에러 없음.

- [ ] **Step 2: 빌드 전체 (next build 도)**

```bash
cd /Users/ahbaik/coding/ourstory && pnpm build 2>&1 | tail -20
```

Expected: 성공 — index.json 에 stationListByEmd, region.json 에 2022 지선 entry 모두 포함.

- [ ] **Step 3: 수동 검증 (dev 서버)**

```bash
pnpm dev &
```

- 경상남도 → 창원시 → 상남동 cascade
- 2022 8회 지선 — 시·도지사 시계열 점 표시 + 정의당 컬럼 값 확인

- [ ] **Step 4: push (사용자 확인 후)**

```bash
git push
```

---

## 통과 기준

- 단위 테스트 (기존 + 신규 10+) PASS
- 빌드 시 region 매핑 실패 0.1% 이내
- 미매핑 정당 0 또는 무시 가능 수준
- `public/data/static/region/<상남동코드>.json` 의 timeseries 에 2022 지선 entry 7개
- Vercel 배포 후 jp-ourstory.vercel.app 에서 "경남 → 창원시 → 상남동 → 2022 지선" 정의당 시계열 점 표시

## 다음 phase

- 7.2: 2018 7회 지선 (같은 패턴 재사용, xlsx 형식만 다를 수 있음)
- 7.3: 2014 6회 지선 (3~6회 zip 안)
- 7.4: 옛 대선·총선 zip