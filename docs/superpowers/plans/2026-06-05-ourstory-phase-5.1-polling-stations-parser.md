# ourstory Phase 5.1 — 투표소 HTML 파서 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NEC VCCP08 페이지(투표구별 행 포함) HTML 을 받아 station/presub/abs/absentee/overseas/misc 로 분류된 row 배열을 반환하는 파서를 `lib/nec-html.ts` 에 추가하고, 4 fixture × 3 케이스 단위 테스트로 검증한다.

**Architecture:** 기존 `parseVccpAggregate`(합계 한 줄) 옆에 `parseVccp08Stations` 추가. 동일한 thead 처리 로직 재사용하되 tbody 전 행을 순회하면서 emd 컨텍스트 추적·메타 라벨 매칭으로 row.kind 결정. 별도 driver 스크립트(`scripts/ingest/parse-polling-stations.ts`) 는 raw HTML 디렉터리 → 처리된 JSON 매핑 담당(Phase 5.2 fetcher 가 만들 raw 를 가정).

**Tech Stack:** cheerio / vitest / node:fs / TypeScript

선행 스펙: `docs/superpowers/specs/2026-06-05-ourstory-phase-5-polling-stations-design.md` (§ 데이터 흐름, § 비목표).
선행 phase: Phase 5.0 완료(스키마 적용).

---

## 파일 구조

| 파일 | 동작 | 책임 |
|------|------|------|
| `scripts/ingest/lib/nec-html.ts` | Modify (append types + function) | 새 함수 `parseVccp08Stations` + `ParsedStationRow`·`StationsParseResult` 타입. 기존 `parseVccpAggregate` 와 thead 파싱 로직 일부 공유. |
| `tests/fixtures/nec-vccp08-2024-jinju-general.html` | Create (NEC fetch) | 2024 총선 진주시 지역구 |
| `tests/fixtures/nec-vccp08-2022-jinju-localprop.html` | Create (NEC fetch) | 2022 지선 진주시 광역비례 |
| `tests/fixtures/nec-vccp08-2020-jinju-generalprop.html` | Create (NEC fetch) | 2020 총선 진주시 비례 |
| `tests/unit/polling-stations-parser.test.ts` | Create | 4 fixture × 3 케이스 = 12 테스트 |
| `scripts/ingest/parse-polling-stations.ts` | Create | CLI 드라이버: raw HTML 디렉터리 → JSON 출력 (Phase 5.2 에서 호출됨, 본 phase 는 스캐폴딩만) |

기존 `tests/fixtures/nec-vccp08-2025-jinju.html` 재사용 (2025 대선 fixture, 이미 존재).

---

## Task 1: NEC fixture 3개 추가 수집

NEC 통계시스템에서 진주시(townCode=4803, cityCode=4800) 한 곳만 받아 fixture 로 둔다. 파일 크기는 각 약 100~200KB 예상.

**Files:**
- Create: `tests/fixtures/nec-vccp08-2024-jinju-general.html`
- Create: `tests/fixtures/nec-vccp08-2022-jinju-localprop.html`
- Create: `tests/fixtures/nec-vccp08-2020-jinju-generalprop.html`

- [ ] **Step 1: 2024 총선 지역구 fixture 수집**

```bash
curl -sS -X POST "http://info.nec.go.kr/electioninfo/electionInfo_report.xhtml" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "User-Agent: Mozilla/5.0" \
  --data-urlencode "electionId=0000000000" \
  --data-urlencode "requestURI=/electioninfo/0000000000/vc/vccp08.jsp" \
  --data-urlencode "topMenuId=VC" \
  --data-urlencode "secondMenuId=VCCP08" \
  --data-urlencode "menuId=VCCP08" \
  --data-urlencode "statementId=VCCP08_#1" \
  --data-urlencode "electionType=2" \
  --data-urlencode "electionName=20240410" \
  --data-urlencode "electionCode=2" \
  --data-urlencode "cityCode=4800" \
  --data-urlencode "townCode=4803" \
  --data-urlencode "searchMode=1" \
  -o ~/coding/ourstory/tests/fixtures/nec-vccp08-2024-jinju-general.html \
  -w "HTTP %{http_code} size=%{size_download}\n"
```

Expected: `HTTP 200 size=~100000` 이상 (수치 큰 차이 시 파라미터 확인).

- [ ] **Step 2: 2024 fixture 가 "합계"/"투표구명" 포함하는지 검증**

```bash
grep -oE "합계|투표구명|검색된 결과" ~/coding/ourstory/tests/fixtures/nec-vccp08-2024-jinju-general.html | sort -u
```

Expected:
```
투표구명
합계
```

"검색된 결과가 없습니다" 나오면 파라미터 잘못된 것 → Step 1 의 electionCode·electionName 확인.

- [ ] **Step 3: 2022 지선 광역비례 fixture 수집**

```bash
curl -sS -X POST "http://info.nec.go.kr/electioninfo/electionInfo_report.xhtml" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "User-Agent: Mozilla/5.0" \
  --data-urlencode "electionId=0000000000" \
  --data-urlencode "requestURI=/electioninfo/0000000000/vc/vccp08.jsp" \
  --data-urlencode "topMenuId=VC" \
  --data-urlencode "secondMenuId=VCCP08" \
  --data-urlencode "menuId=VCCP08" \
  --data-urlencode "statementId=VCCP08_#1" \
  --data-urlencode "electionType=4" \
  --data-urlencode "electionName=20220601" \
  --data-urlencode "electionCode=8" \
  --data-urlencode "cityCode=4800" \
  --data-urlencode "townCode=4803" \
  --data-urlencode "searchMode=1" \
  -o ~/coding/ourstory/tests/fixtures/nec-vccp08-2022-jinju-localprop.html \
  -w "HTTP %{http_code} size=%{size_download}\n"
```

- [ ] **Step 4: 2022 fixture 검증**

```bash
grep -oE "합계|투표구명|검색된 결과" ~/coding/ourstory/tests/fixtures/nec-vccp08-2022-jinju-localprop.html | sort -u
```

Expected: `투표구명`, `합계` 모두 출력.

- [ ] **Step 5: 2020 총선 비례 fixture 수집**

```bash
curl -sS -X POST "http://info.nec.go.kr/electioninfo/electionInfo_report.xhtml" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "User-Agent: Mozilla/5.0" \
  --data-urlencode "electionId=0000000000" \
  --data-urlencode "requestURI=/electioninfo/0000000000/vc/vccp08.jsp" \
  --data-urlencode "topMenuId=VC" \
  --data-urlencode "secondMenuId=VCCP08" \
  --data-urlencode "menuId=VCCP08" \
  --data-urlencode "statementId=VCCP08_#1" \
  --data-urlencode "electionType=2" \
  --data-urlencode "electionName=20200415" \
  --data-urlencode "electionCode=7" \
  --data-urlencode "cityCode=4800" \
  --data-urlencode "townCode=4803" \
  --data-urlencode "searchMode=1" \
  -o ~/coding/ourstory/tests/fixtures/nec-vccp08-2020-jinju-generalprop.html \
  -w "HTTP %{http_code} size=%{size_download}\n"
```

- [ ] **Step 6: 2020 fixture 검증**

```bash
grep -oE "합계|투표구명|검색된 결과" ~/coding/ourstory/tests/fixtures/nec-vccp08-2020-jinju-generalprop.html | sort -u
```

Expected: `투표구명`, `합계` 모두 출력.

- [ ] **Step 7: fixture 4개 디렉터리 확인**

```bash
ls -la ~/coding/ourstory/tests/fixtures/nec-vccp08-*.html
```

Expected: 4 파일 (2020/2022/2024/2025).

---

## Task 2: 파서 타입 정의 + 함수 시그니처 (스텁)

테스트가 import 할 타입과 함수 빈 스텁을 먼저 추가. 실제 로직은 Task 4 에서.

**Files:**
- Modify: `scripts/ingest/lib/nec-html.ts` (append at end)

- [ ] **Step 1: 타입과 빈 함수 추가**

`scripts/ingest/lib/nec-html.ts` 파일 끝에 다음을 append.

```ts
// ─── 투표소(투표구) 행 파서 ────────────────────────────────────────────────

/**
 * NEC VCCP08 페이지의 tbody 한 행에 대응. 분류된 종류와 분모·정당별 득표.
 *
 * - kind=station    : 일반 투표구 (예: "문산읍제1투")
 * - kind=presub     : 관내사전투표 (해당 emd 의 사전투표 합)
 * - kind=abs        : 관외사전투표 (top-level, emd 귀속 안 함)
 * - kind=absentee   : 거소·선상투표 (top-level)
 * - kind=overseas   : 재외투표 (top-level)
 * - kind=misc       : 잘못 투입·구분된 투표지 등 기타
 *
 * emdName 은 station/presub 행에 한해 채워짐. 나머지(top-level 메타) 는 null.
 */
export interface ParsedStationRow {
  emdName: string | null;
  name: string;
  kind: "station" | "presub" | "abs" | "absentee" | "overseas" | "misc";
  totalVoters: number;
  totalVotes: number;
  validVotes: number;
  invalidVotes: number;
  parties: ParsedParty[];
}

export type StationsParseResult =
  | { kind: "ok"; rows: ParsedStationRow[]; partyNames: string[] }
  | { kind: "no-data" };

/**
 * VCCP08 HTML 의 모든 tbody 행을 station/메타 단위로 분해.
 * "합계" 와 emd "소계" 는 결과에서 제외 (vote_totals 에 이미 있음).
 */
export function parseVccp08Stations(html: string): StationsParseResult {
  // 임시 스텁. Task 4 에서 구현.
  void html;
  return { kind: "no-data" };
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -E "nec-html\.ts" | head -5
```

Expected: 출력 없음.

---

## Task 3: 12개 단위 테스트 작성 (failing 상태)

각 fixture 3 케이스 = 12 테스트. 모두 처음엔 FAIL.

**Files:**
- Create: `tests/unit/polling-stations-parser.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseVccp08Stations } from "../../scripts/ingest/lib/nec-html";

const FX = path.join(__dirname, "..", "fixtures");

async function load(name: string) {
  return readFile(path.join(FX, name), "utf-8");
}

describe("parseVccp08Stations — 2025 진주 대선", () => {
  it("ok 응답 + 5명 후보 + 최소 30 row (진주시 평균 동·메타 합)", async () => {
    const html = await load("nec-vccp08-2025-jinju.html");
    const r = parseVccp08Stations(html);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.partyNames.length).toBe(5);
    expect(r.rows.length).toBeGreaterThan(30);
  });

  it("문산읍제1투 station 행이 정확히 한 번 존재 + 분모 일치", async () => {
    const html = await load("nec-vccp08-2025-jinju.html");
    const r = parseVccp08Stations(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    const m1 = r.rows.filter(
      (x) => x.kind === "station" && x.name === "문산읍제1투",
    );
    expect(m1).toHaveLength(1);
    expect(m1[0].emdName).toBe("문산읍");
    expect(m1[0].totalVoters).toBe(2315);
    expect(m1[0].totalVotes).toBe(1465);
  });

  it("top-level 메타 (거소·선상·관외사전·재외) 각 1행씩 + 분모 일치", async () => {
    const html = await load("nec-vccp08-2025-jinju.html");
    const r = parseVccp08Stations(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    const abs = r.rows.find((x) => x.kind === "abs");
    const absentee = r.rows.find((x) => x.kind === "absentee");
    const overseas = r.rows.find((x) => x.kind === "overseas");
    expect(abs?.emdName).toBeNull();
    expect(abs?.totalVoters).toBe(19240);
    expect(absentee?.totalVoters).toBe(629);
    expect(overseas?.totalVoters).toBe(1286);
  });
});

describe("parseVccp08Stations — 2024 진주 총선 지역구", () => {
  it("ok 응답 + 후보자명 N개 (partyNames.length > 0)", async () => {
    const html = await load("nec-vccp08-2024-jinju-general.html");
    const r = parseVccp08Stations(html);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.partyNames.length).toBeGreaterThan(0);
  });

  it("station 행 다수 + 관내사전(presub) 행이 emd 별로 존재", async () => {
    const html = await load("nec-vccp08-2024-jinju-general.html");
    const r = parseVccp08Stations(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    const stations = r.rows.filter((x) => x.kind === "station");
    const presubs = r.rows.filter((x) => x.kind === "presub");
    expect(stations.length).toBeGreaterThan(10);
    expect(presubs.length).toBeGreaterThan(5);
    // station 의 emdName 은 비어있지 않아야 함
    expect(stations.every((s) => !!s.emdName)).toBe(true);
  });

  it("정당 득표 셀 수 = partyNames 수, 모두 numeric", async () => {
    const html = await load("nec-vccp08-2024-jinju-general.html");
    const r = parseVccp08Stations(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    for (const row of r.rows) {
      expect(row.parties.length).toBe(r.partyNames.length);
      expect(row.parties.every((p) => Number.isFinite(p.votes))).toBe(true);
    }
  });
});

describe("parseVccp08Stations — 2022 진주 광역비례", () => {
  it("ok 응답 + 정당명 다수 (광역비례 = 정당 단위)", async () => {
    const html = await load("nec-vccp08-2022-jinju-localprop.html");
    const r = parseVccp08Stations(html);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.partyNames.length).toBeGreaterThan(2);
  });

  it("emd 컨텍스트 추적: station 행의 emdName 이 직전 소계 행의 emd 와 일치", async () => {
    const html = await load("nec-vccp08-2022-jinju-localprop.html");
    const r = parseVccp08Stations(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    const stations = r.rows.filter((x) => x.kind === "station");
    expect(stations.length).toBeGreaterThan(0);
    // 적어도 두 개 이상의 다른 emdName 이 있어야 함 (여러 동에 걸쳐 station 분포)
    const emds = new Set(stations.map((s) => s.emdName));
    expect(emds.size).toBeGreaterThan(1);
  });

  it("invalidVotes(무효) 컬럼이 모두 정수", async () => {
    const html = await load("nec-vccp08-2022-jinju-localprop.html");
    const r = parseVccp08Stations(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    for (const row of r.rows) {
      expect(Number.isInteger(row.invalidVotes)).toBe(true);
      expect(row.invalidVotes).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("parseVccp08Stations — 2020 진주 총선 비례", () => {
  it("ok 응답 + 정당명 다수", async () => {
    const html = await load("nec-vccp08-2020-jinju-generalprop.html");
    const r = parseVccp08Stations(html);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.partyNames.length).toBeGreaterThan(5); // 21대 총선 비례 = 정당 다수
  });

  it("rows 의 totalVoters 합 ≥ validVotes 합 (분모 sanity)", async () => {
    const html = await load("nec-vccp08-2020-jinju-generalprop.html");
    const r = parseVccp08Stations(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    const sumVoters = r.rows.reduce((a, b) => a + b.totalVoters, 0);
    const sumValid = r.rows.reduce((a, b) => a + b.validVotes, 0);
    expect(sumVoters).toBeGreaterThanOrEqual(sumValid);
  });

  it("어떤 row 도 unknown/undefined kind 가 아님", async () => {
    const html = await load("nec-vccp08-2020-jinju-generalprop.html");
    const r = parseVccp08Stations(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    const KINDS = new Set(["station", "presub", "abs", "absentee", "overseas", "misc"]);
    for (const row of r.rows) {
      expect(KINDS.has(row.kind)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: 테스트 실행 → 12개 FAIL 확인 (baseline)**

```bash
cd ~/coding/ourstory && pnpm test polling-stations-parser 2>&1 | tail -30
```

Expected: 12 tests FAIL (스텁이 항상 `{ kind: "no-data" }` 반환). 첫 번째 expect (`expect(r.kind).toBe("ok")`) 에서 모두 실패.

---

## Task 4: parseVccp08Stations 구현

**Files:**
- Modify: `scripts/ingest/lib/nec-html.ts` (replace 스텁 with 실제 구현)

- [ ] **Step 1: 메타 라벨 매핑 + 헤더 파싱 헬퍼 추가**

`scripts/ingest/lib/nec-html.ts` 안의 `META_HEADERS` 상수 바로 아래에 다음을 추가.

```ts
// row 분류용 — emdCell 또는 labelCell 텍스트 → kind
const META_LABELS = new Map<string, ParsedStationRow["kind"]>([
  ["관내사전투표", "presub"],
  ["관외사전투표", "abs"],
  ["거소·선상투표", "absentee"],
  ["거소ㆍ선상투표", "absentee"],
  ["재외투표", "overseas"],
  ["재외국민투표", "overseas"],
  ["잘못 투입·구분된 투표지", "misc"],
  ["잘못 투입ㆍ구분된 투표지", "misc"],
]);

function extractPartyNames($: cheerio.CheerioAPI): string[] {
  const partyNames: string[] = [];
  $("table#table01 thead th").each((_, th) => {
    const t = $(th).text().trim();
    if (!t || META_HEADERS.has(t)) return;
    partyNames.push(t);
  });
  return partyNames;
}
```

참고: 기존 `parseVccpAggregate` 의 thead 파싱 로직과 동일. DRY 를 위해 별도 함수로 추출하되 기존 함수는 그대로 둠 (분리 작업은 본 phase 의 비목표).

- [ ] **Step 2: 스텁 함수 본문 교체**

`parseVccp08Stations` 함수 본문(`void html; return { kind: "no-data" };`)을 다음으로 교체.

```ts
  const $ = cheerio.load(html);

  // 빈 응답 감지 — 첫 행이 "검색된 결과가 없습니다" 또는 첫 행 없음
  const firstBodyRow = $("table#table01 tbody tr").first();
  if (!firstBodyRow.length) return { kind: "no-data" };
  const firstCellText = firstBodyRow.find("td").first().text().trim();
  if (firstCellText.includes("검색된 결과가 없습니다")) {
    return { kind: "no-data" };
  }

  const partyNames = extractPartyNames($);
  if (partyNames.length === 0) return { kind: "no-data" };

  const rows: ParsedStationRow[] = [];
  let currentEmd: string | null = null;
  const expectedCellCount = 4 + partyNames.length + 3;
  const num = (s: string) => Number(s.replace(/,/g, "")) || 0;

  $("table#table01 tbody tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((_, td) => $(td).text().trim())
      .get();
    if (cells.length < expectedCellCount) return;

    const c0 = cells[0]; // emdName / top-level 메타 / "합계"
    const c1 = cells[1]; // "소계" / 메타 / station name / 빈문자

    // "합계" 행은 vote_totals 와 중복이므로 제외
    if (c0 === "합계") return;

    // emd 블록의 시작 — c0 가 emd 이름, c1 이 "소계"
    if (c0 && c1 === "소계") {
      currentEmd = c0;
      return; // 소계 자체는 저장 안 함
    }

    // row 분류
    let kind: ParsedStationRow["kind"] | undefined;
    let emdName: string | null;
    let displayName: string;

    const topMeta = META_LABELS.get(c0);
    const perEmdMeta = META_LABELS.get(c1);

    if (topMeta) {
      kind = topMeta;
      emdName = null;
      displayName = c0;
    } else if (perEmdMeta) {
      kind = perEmdMeta;
      emdName = currentEmd;
      displayName = c1;
    } else if (c1) {
      kind = "station";
      emdName = currentEmd;
      displayName = c1;
    } else {
      // c0·c1 모두 빈 또는 미분류 — skip
      return;
    }

    const tailStart = 4 + partyNames.length;
    rows.push({
      emdName,
      name: displayName,
      kind,
      totalVoters: num(cells[2]),
      totalVotes: num(cells[3]),
      validVotes: num(cells[tailStart]),
      invalidVotes: num(cells[tailStart + 1]),
      parties: partyNames.map((name, i) => ({
        name,
        votes: num(cells[4 + i]),
      })),
    });
  });

  return { kind: "ok", rows, partyNames };
```

- [ ] **Step 3: 테스트 실행 → PASS 확인**

```bash
cd ~/coding/ourstory && pnpm test polling-stations-parser 2>&1 | tail -30
```

Expected: 12 tests PASS.

- [ ] **Step 4: 만약 일부 FAIL 시 디버깅 가이드**

대표 실패 시나리오와 진단:

| 실패 양상 | 원인 후보 |
|-----------|----------|
| `totalVoters` 가 0 | 셀 인덱스 잘못 (예상: cells[2]). 헤더 컬럼 수와 partyNames 수 일치 여부 확인. |
| station 의 emdName 이 null | currentEmd 갱신 누락. "소계" 행이 c1 이 아니라 c0 에 들어오는지 확인. |
| 12개 중 절반 PASS, 나머지 다른 fixture FAIL | fixture 별 구조 차이 — `console.log(cells)` 로 한 행 dump 후 비교 |
| `kind` 값이 누락된 row 발견 | META_LABELS 의 키와 NEC HTML 의 라벨 표기가 다를 가능성 (예: "·" vs "ㆍ") → fixture 에서 grep 으로 실제 라벨 확인 |

- [ ] **Step 5: 기존 테스트 영향 없음 확인**

```bash
cd ~/coding/ourstory && pnpm test 2>&1 | tail -15
```

Expected: 모든 기존 테스트도 그대로 PASS (parseVccpAggregate 미수정).

---

## Task 5: driver 스크립트 `parse-polling-stations.ts`

Phase 5.2 fetcher 가 생성할 raw HTML 디렉터리를 받아 처리된 JSON 으로 변환하는 CLI 도구. 현 phase 는 스캐폴딩만 — 실제 raw 디렉터리는 5.2 에서 생김.

**Files:**
- Create: `scripts/ingest/parse-polling-stations.ts`

- [ ] **Step 1: 스크립트 작성**

```ts
// raw HTML 디렉터리(`data/raw/polling-stations/{electionId}-{cityCode}-{townCode}.html`)
// → 처리된 JSON (`data/processed/polling-stations/{electionId}.json`)
//
// 실행: pnpm tsx scripts/ingest/parse-polling-stations.ts <electionId>
//
// Phase 5.2 fetcher 가 raw 파일을 생성한 뒤 본 스크립트를 호출.

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseVccp08Stations,
  type ParsedStationRow,
} from "./lib/nec-html";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(HERE, "..", "..", "data", "raw", "polling-stations");
const OUT_DIR = path.join(HERE, "..", "..", "data", "processed", "polling-stations");

interface ParsedFile {
  cityCode: string;
  townCode: string;
  partyNames: string[];
  rows: ParsedStationRow[];
}

interface ElectionBundle {
  electionId: string;
  files: ParsedFile[];
  // 합산 통계 — 디버깅·검증용
  totalRows: number;
  stationCount: number;
  noDataFiles: number;
}

function parseFilename(name: string, electionId: string): {
  cityCode: string;
  townCode: string;
} | null {
  // 패턴: {electionId}-{cityCode}-{townCode}.html
  const prefix = `${electionId}-`;
  if (!name.startsWith(prefix) || !name.endsWith(".html")) return null;
  const middle = name.slice(prefix.length, -".html".length);
  const parts = middle.split("-");
  if (parts.length !== 2) return null;
  return { cityCode: parts[0], townCode: parts[1] };
}

async function main() {
  const electionId = process.argv[2];
  if (!electionId) {
    console.error("usage: tsx parse-polling-stations.ts <electionId>");
    process.exit(2);
  }

  if (!existsSync(RAW_DIR)) {
    console.error(`raw dir 없음: ${RAW_DIR}`);
    console.error("Phase 5.2 fetcher 를 먼저 실행해야 함.");
    process.exit(1);
  }

  const all = await readdir(RAW_DIR);
  const targets = all
    .map((n) => ({ name: n, meta: parseFilename(n, electionId) }))
    .filter((x) => x.meta !== null) as { name: string; meta: { cityCode: string; townCode: string } }[];

  if (targets.length === 0) {
    console.error(`매칭 raw 파일 없음 (electionId=${electionId})`);
    process.exit(1);
  }

  const bundle: ElectionBundle = {
    electionId,
    files: [],
    totalRows: 0,
    stationCount: 0,
    noDataFiles: 0,
  };

  for (const t of targets) {
    const html = await readFile(path.join(RAW_DIR, t.name), "utf-8");
    const r = parseVccp08Stations(html);
    if (r.kind === "no-data") {
      bundle.noDataFiles += 1;
      continue;
    }
    bundle.files.push({
      cityCode: t.meta.cityCode,
      townCode: t.meta.townCode,
      partyNames: r.partyNames,
      rows: r.rows,
    });
    bundle.totalRows += r.rows.length;
    bundle.stationCount += r.rows.filter((x) => x.kind === "station").length;
  }

  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${electionId}.json`);
  await writeFile(outPath, JSON.stringify(bundle, null, 2));

  console.log(`✓ ${outPath}`);
  console.log(
    `  files=${bundle.files.length} (no-data=${bundle.noDataFiles}) ` +
    `rows=${bundle.totalRows} stations=${bundle.stationCount}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: 컴파일 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -E "parse-polling-stations" | head -5
```

Expected: 출력 없음.

- [ ] **Step 3: 도움말 호출 sanity (인자 없으면 usage)**

```bash
cd ~/coding/ourstory && pnpm tsx scripts/ingest/parse-polling-stations.ts 2>&1 | head -3
```

Expected: `usage: tsx parse-polling-stations.ts <electionId>` 출력, exit code 2.

- [ ] **Step 4: 실제 raw 없는 경우 안내 메시지**

```bash
cd ~/coding/ourstory && pnpm tsx scripts/ingest/parse-polling-stations.ts 2025-presidential 2>&1 | head -3
```

Expected: `raw dir 없음: ...` 또는 `매칭 raw 파일 없음` 메시지, exit code 1.

**참고:** 본 단계는 Phase 5.2 fetcher 가 raw 를 생성한 뒤에야 실제로 의미있는 동작을 함. 본 phase 의 검증은 "스크립트가 빈 raw 환경에서도 정상 종료(usage/error)" 까지.

---

## Task 6: 전체 테스트 + 커밋

**Files:**
- 스테이지: Task 1·2·3·4·5 의 모든 변경

- [ ] **Step 1: 전체 테스트 PASS 확인**

```bash
cd ~/coding/ourstory && pnpm test 2>&1 | tail -10
```

Expected: 모든 테스트 PASS (기존 + 신규 12개).

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -vE "tests/unit/process\.test\.ts" | head -10
```

Expected: 추가 에러 없음 (`process.test.ts` 의 기존 무관한 에러는 무시).

- [ ] **Step 3: 변경사항 확인**

```bash
git -C ~/coding/ourstory status
git -C ~/coding/ourstory diff --stat
```

Expected 변경 목록:
- `scripts/ingest/lib/nec-html.ts` (수정 — 함수·타입 추가)
- `tests/fixtures/nec-vccp08-2020-jinju-generalprop.html` (신규)
- `tests/fixtures/nec-vccp08-2022-jinju-localprop.html` (신규)
- `tests/fixtures/nec-vccp08-2024-jinju-general.html` (신규)
- `tests/unit/polling-stations-parser.test.ts` (신규)
- `scripts/ingest/parse-polling-stations.ts` (신규)

- [ ] **Step 4: 커밋**

```bash
git -C ~/coding/ourstory add scripts/ingest/lib/nec-html.ts tests/fixtures/ tests/unit/polling-stations-parser.test.ts scripts/ingest/parse-polling-stations.ts
git -C ~/coding/ourstory commit -m "$(cat <<'EOF'
ourstory Phase 5.1 — 투표소 HTML 파서 + 12 단위 테스트

parseVccp08Stations: VCCP08 tbody 전 행 순회, emd 컨텍스트 추적,
META_LABELS 매칭으로 station/presub/abs/absentee/overseas/misc 분류.
parse-polling-stations.ts: raw 디렉터리 → JSON 드라이버 (Phase 5.2 가 호출).
fixture 4종 (2020/2022/2024/2025 진주), 각 3 케이스 PASS.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: 푸시는 사용자 확정 후**

```bash
git -C ~/coding/ourstory push origin main
```

---

## 검증 체크리스트 (Phase 5.1 완료 조건)

- [ ] `pnpm test polling-stations-parser` → 12 PASS
- [ ] `pnpm test` → 전체 테스트 PASS (기존 + 신규)
- [ ] `pnpm tsx scripts/ingest/parse-polling-stations.ts` → usage 출력 후 정상 exit
- [ ] 4 fixture 파일이 `tests/fixtures/` 에 존재 (2020/2022/2024/2025)
- [ ] 커밋 메시지가 위 형식대로

다섯 항목 통과 시 Phase 5.1 완료. 다음 Phase 5.2 (fetcher) 플랜 작성으로 넘어감.
