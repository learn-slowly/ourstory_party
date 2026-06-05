# ourstory Phase 5.2 — 투표소 fetcher + 지역구 파서 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NEC 통계시스템에서 12 electionId × 17 시·도(필요 시 평균 15 시·군·구 추가)분 raw HTML 을 동시성 5 / 재시도 3 / 6s 타임아웃으로 안전하게 받아 `data/raw/polling-stations/` 에 캐시한다. 더불어 Phase 5.1 에서 보류된 2024 총선 지역구(necCode=2) VCCP04 의 선거구·후보자 구조를 처리하는 별도 파서 함수도 본 phase 에서 추가한다.

**Architecture:** 두 축. (1) 파서: 비례·대선용 기존 `parseVccp08Stations` 에 손대지 않고 `parseVccp04District` 신규 추가 (선거구 단위 후보자명 변경 대응). (2) fetcher: `lib/nec-codes.ts` 에 17 시·도 정적 상수 + townCode 동적 조회, `lib/nec-fetch.ts` 에 단일 fetch 헬퍼(재시도·타임아웃·캐시), `scripts/ingest/fetch-polling-stations.ts` CLI 에 race 종류 분기 + 동시성 풀.

**Tech Stack:** TypeScript / cheerio / postgres.js (electionId·necCode 조회) / Node fetch + AbortController / vitest

선행 스펙: `docs/superpowers/specs/2026-06-05-ourstory-phase-5-polling-stations-design.md`
선행 phase: 5.0 (스키마) · 5.1 (비례·대선 파서) 완료.

---

## 파일 구조

| 파일 | 동작 | 책임 |
|------|------|------|
| `tests/fixtures/nec-vccp04-2024-jinju-district.html` | Create (curl) | 2024 진주시 지역구 fixture |
| `scripts/ingest/lib/nec-html.ts` | Modify (append) | `parseVccp04District` 신규 함수 + `DistrictParseResult` 타입 |
| `tests/unit/polling-stations-district-parser.test.ts` | Create | 3 단위 테스트 |
| `scripts/ingest/lib/nec-codes.ts` | Create | 17 시·도 cityCode 상수 + `fetchTownCodes(electionId, cityCode)` 헬퍼 |
| `scripts/ingest/lib/nec-fetch.ts` | Create | 단일 POST(재시도 3·6s·캐시) + 응답 분류 (ok / no-data / failed) |
| `tests/unit/nec-fetch.test.ts` | Create | 캐시·파일명 생성 단위 테스트 (네트워크 의존 없는 헬퍼만) |
| `scripts/ingest/fetch-polling-stations.ts` | Create | 메인 CLI — electionId 받아 race 분기 + 동시성 풀 + 진행률 로그 |
| `package.json` | Modify | `ingest:fetch-polling-stations` 스크립트 추가 |

신규 import 추가 패키지 없음 — 모두 기존 의존성(`cheerio`, `postgres`, `node:fetch`, `tsx`) 사용.

---

## Task 1: 2024 진주 지역구 fixture 수집 + 구조 메모

**Files:**
- Create: `tests/fixtures/nec-vccp04-2024-jinju-district.html`

- [ ] **Step 1: fixture 수집**

```bash
curl -sS -X POST "http://info.nec.go.kr/electioninfo/electionInfo_report.xhtml" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "User-Agent: Mozilla/5.0" \
  --data-urlencode "electionId=0000000000" \
  --data-urlencode "requestURI=/electioninfo/0000000000/vc/vccp04.jsp" \
  --data-urlencode "topMenuId=VC" \
  --data-urlencode "secondMenuId=VCCP04" \
  --data-urlencode "menuId=VCCP04" \
  --data-urlencode "statementId=VCCP04_#2_0" \
  --data-urlencode "electionType=2" \
  --data-urlencode "electionName=20240410" \
  --data-urlencode "electionCode=2" \
  --data-urlencode "cityCode=4800" \
  --data-urlencode "townCode=4803" \
  --data-urlencode "searchMode=1" \
  -o ~/coding/ourstory/tests/fixtures/nec-vccp04-2024-jinju-district.html \
  -w "HTTP %{http_code} size=%{size_download}\n"
```

Expected: `HTTP 200 size=~120000`.

- [ ] **Step 2: 구조 확인**

```bash
python3 - <<'PY'
import re
h = open("/Users/ahbaik/coding/ourstory/tests/fixtures/nec-vccp04-2024-jinju-district.html").read()
m = re.search(r'<table[^>]+id="table01".*?</table>', h, re.DOTALL)
tbody = re.search(r'<tbody.*?</tbody>', m.group(0), re.DOTALL).group(0)
rows = re.findall(r'<tr.*?</tr>', tbody, re.DOTALL)
print(f"total tbody rows: {len(rows)}")
for i, r in enumerate(rows[:8]):
    cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', r, re.DOTALL)
    cells = [re.sub(r'<[^>]+>', '', c).strip()[:20] for c in cells]
    print(f"row {i} ({len(cells)} cells): {' | '.join(cells)}")
PY
```

Expected: 첫 행은 후보자명만 있는 헤더 (c0,c1,c2 빈 칸 + c5,c6 에 "더불어민주당갈상돈" 류). 두 번째 행부터 데이터(`진주시갑 | 합계 | ...`). cells 수는 약 11 (선거구명+읍면동명+구분+선거인수+투표수+후보 N+계+무효+기권).

---

## Task 2: 파서 타입 + 스텁 추가

**Files:**
- Modify: `scripts/ingest/lib/nec-html.ts` (append at end)

- [ ] **Step 1: 타입과 빈 함수 추가**

`scripts/ingest/lib/nec-html.ts` 파일 끝에 다음 append.

```ts
// ─── 지역구(VCCP04 + 후보자명 in tbody) 행 파서 ─────────────────────────────

/**
 * 한 선거구(예: "진주시갑") 내부의 한 행 (투표소/메타).
 * 같은 시·군·구 안에 여러 선거구가 있을 수 있어, district 필드로 그룹화.
 */
export interface ParsedDistrictRow {
  district: string;             // "진주시갑"
  emdName: string | null;
  name: string;                 // "문산읍제1투" / "관내사전투표" / "거소투표" 등
  kind: ParsedStationRow["kind"];
  totalVoters: number;
  totalVotes: number;
  validVotes: number;
  invalidVotes: number;
  candidates: ParsedParty[];    // 이 district 의 후보 명단으로 매핑된 득표
}

export type DistrictParseResult =
  | { kind: "ok"; rows: ParsedDistrictRow[] }
  | { kind: "no-data" };

/**
 * 지역구(VCCP04 + electionCode=2|4|5|6) HTML 파서.
 *
 * 후보자명은 tbody 첫 행에 (각 선거구마다 다르게) 나타남.
 * 한 시·군·구 응답 안에 여러 선거구가 순차로 나오며, 각 선거구는
 *   [후보자명 헤더 행] → [합계 행] → [거소·관외·국외 등 메타] → [emd 행들]
 * 패턴을 반복함.
 */
export function parseVccp04District(html: string): DistrictParseResult {
  // 임시 스텁. Task 4 에서 구현.
  void html;
  return { kind: "no-data" };
}
```

- [ ] **Step 2: 컴파일 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -E "nec-html\.ts" | head -5
```

Expected: 출력 없음.

---

## Task 3: 지역구 단위 테스트 3개 (failing)

**Files:**
- Create: `tests/unit/polling-stations-district-parser.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseVccp04District } from "../../scripts/ingest/lib/nec-html";

const FX = path.join(__dirname, "..", "fixtures");

describe("parseVccp04District — 2024 진주 지역구", () => {
  it("ok 응답 + 두 개 이상의 선거구 (진주시갑·진주시을 등)", async () => {
    const html = await readFile(
      path.join(FX, "nec-vccp04-2024-jinju-district.html"),
      "utf-8",
    );
    const r = parseVccp04District(html);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    const districts = new Set(r.rows.map((x) => x.district));
    expect(districts.size).toBeGreaterThanOrEqual(2);
  });

  it("각 선거구의 후보자 명단이 서로 다름 (선거구별 후보 다름)", async () => {
    const html = await readFile(
      path.join(FX, "nec-vccp04-2024-jinju-district.html"),
      "utf-8",
    );
    const r = parseVccp04District(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    const byDistrict = new Map<string, Set<string>>();
    for (const row of r.rows) {
      if (!byDistrict.has(row.district)) byDistrict.set(row.district, new Set());
      const set = byDistrict.get(row.district)!;
      for (const c of row.candidates) set.add(c.name);
    }
    const candidateSets = [...byDistrict.values()];
    expect(candidateSets.length).toBeGreaterThanOrEqual(2);
    // 두 선거구의 후보 명단이 동일하지 않아야 함
    const first = [...candidateSets[0]].sort().join(",");
    const second = [...candidateSets[1]].sort().join(",");
    expect(first).not.toBe(second);
  });

  it("선거구 station 행이 다수 + emdName·district 모두 채워짐", async () => {
    const html = await readFile(
      path.join(FX, "nec-vccp04-2024-jinju-district.html"),
      "utf-8",
    );
    const r = parseVccp04District(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    const stations = r.rows.filter((x) => x.kind === "station");
    expect(stations.length).toBeGreaterThan(10);
    expect(stations.every((s) => !!s.district && !!s.emdName)).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 3개 FAIL**

```bash
cd ~/coding/ourstory && pnpm test district-parser 2>&1 | tail -10
```

Expected: 3 tests FAIL (스텁 반환).

---

## Task 4: `parseVccp04District` 구현

**Files:**
- Modify: `scripts/ingest/lib/nec-html.ts` (replace 스텁)

- [ ] **Step 1: 스텁 함수 본문 교체**

`parseVccp04District` 본문(`void html; return { kind: "no-data" };`)을 다음으로 교체.

```ts
  const $ = cheerio.load(html);

  const firstBodyRow = $("table#table01 tbody tr").first();
  if (!firstBodyRow.length) return { kind: "no-data" };
  const firstCellText = firstBodyRow.find("td").first().text().trim();
  if (firstCellText.includes("검색된 결과가 없습니다")) {
    return { kind: "no-data" };
  }

  const num = (s: string) => Number(s.replace(/,/g, "")) || 0;
  const rows: ParsedDistrictRow[] = [];
  let currentDistrict: string | null = null;
  let currentEmd: string | null = null;
  let currentCandidates: string[] = [];
  // 컬럼 인덱스: 0:선거구명 1:읍면동명 2:구분 3:선거인수 4:투표수 5..(5+N-1):후보자 (5+N):계 (5+N+1):무효 (5+N+2):기권
  // 후보자 컬럼의 수 N 은 max colspan 으로 고정(NEC 가 빈 셀 패딩). 첫 후보자 행에서 자동 감지.

  $("table#table01 tbody tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((_, td) => $(td).text().trim())
      .get();
    if (cells.length < 8) return; // 최소 컬럼 수 미만 → skip

    const c0 = cells[0]; // 선거구명 (전환 시에만)
    const c1 = cells[1]; // 읍면동명
    const c2 = cells[2]; // 구분
    const totalVotersCell = cells[3];
    const totalVotesCell = cells[4];

    // 후보자 헤더 행 — 분모 셀이 모두 비고, 중간 셀에 후보자명
    const isCandHeader =
      c0 === "" && c1 === "" && c2 === "" && totalVotersCell === "" && totalVotesCell === "";
    if (isCandHeader) {
      // 후보자명 추출 — cells[5] 부터, "계" 라벨 직전까지
      const newCands: string[] = [];
      for (let i = 5; i < cells.length; i++) {
        const v = cells[i];
        if (v === "계") break;
        if (v) newCands.push(v);
      }
      if (newCands.length > 0) currentCandidates = newCands;
      currentEmd = null;
      return;
    }

    // 선거구 전환 — 합계 행 (c0=district, c1=합계)
    if (c0 && c1 === "합계") {
      currentDistrict = c0;
      currentEmd = null;
      return; // 합계는 vote_totals 와 중복이므로 저장 안 함
    }

    if (!currentDistrict || currentCandidates.length === 0) {
      // 후보자·선거구 컨텍스트 미정 — skip
      return;
    }

    // emd 블록 진입 — c1 가 emd 이름, c2 가 "계"
    if (c1 && c2 === "계" && !META_LABELS.has(c1)) {
      currentEmd = c1;
      return; // emd 소계도 저장 안 함
    }

    // row 분류
    let kind: ParsedStationRow["kind"];
    let emdName: string | null;
    let displayName: string;

    const topMeta = META_LABELS.get(c1); // 거소투표 / 관외사전 / 국외부재자 등 (선거구 단위 메타)
    const perEmdMeta = META_LABELS.get(c2); // 관내사전 (emd 안)

    if (topMeta && !currentEmd) {
      kind = topMeta;
      emdName = null;
      displayName = c1;
    } else if (perEmdMeta) {
      kind = perEmdMeta;
      emdName = currentEmd;
      displayName = c2;
    } else if (c2) {
      kind = "station";
      emdName = currentEmd;
      displayName = c2;
    } else {
      return;
    }

    // 후보자별 득표 — cells[5 .. 5 + N]
    const candEnd = 5 + currentCandidates.length;
    if (cells.length < candEnd + 3) return;
    const validVotes = num(cells[candEnd]);     // "계" 컬럼
    const invalidVotes = num(cells[candEnd + 1]);
    // cells[candEnd + 2] = 기권자수 (보관 안 함)

    rows.push({
      district: currentDistrict,
      emdName,
      name: displayName,
      kind,
      totalVoters: num(totalVotersCell),
      totalVotes: num(totalVotesCell),
      validVotes,
      invalidVotes,
      candidates: currentCandidates.map((name, i) => ({
        name,
        votes: num(cells[5 + i]),
      })),
    });
  });

  return rows.length > 0 ? { kind: "ok", rows } : { kind: "no-data" };
```

- [ ] **Step 2: 테스트 실행 → 3개 PASS**

```bash
cd ~/coding/ourstory && pnpm test district-parser 2>&1 | tail -10
```

Expected: 3 tests PASS.

- [ ] **Step 3: 회귀 확인 — 기존 12 케이스도 PASS**

```bash
cd ~/coding/ourstory && pnpm test 2>&1 | tail -10
```

Expected: 전체 PASS (기존 + 신규 3).

- [ ] **Step 4: 실패 시 디버깅 가이드**

| 실패 | 원인 후보 |
|------|----------|
| `districts.size < 2` | 진주 fixture 가 1개 선거구만 포함 (실제로 가능) → fixture 를 다른 시·군·구(여러 선거구 있는 곳)로 교체 또는 테스트 완화 |
| `candidates` 가 빈 배열 | 후보자 헤더 행 감지 실패. `console.log(cells)` 로 첫 5개 행 확인 |
| 일부 row 누락 | currentDistrict/currentEmd 갱신 조건 점검 |

---

## Task 5: 17 시·도 cityCode 상수 + townCode 동적 조회

**Files:**
- Create: `scripts/ingest/lib/nec-codes.ts`

- [ ] **Step 1: 파일 작성**

```ts
// NEC 통계시스템 cityCode/townCode 상수 + 동적 조회.
// cityCode: 17 시·도 고정. townCode: 선거 종류·시기 따라 다르므로 동적 조회.

const SELECTBOX_TOWN_URL =
  "http://info.nec.go.kr/bizcommon/selectbox/selectbox_townCodeJson.json";

export interface CityCode {
  code: string; // NEC 4자리
  name: string;
}

// NEC 17 시·도 코드 (info.nec.go.kr 메인 페이지의 cityCode dropdown 기준)
export const CITY_CODES: CityCode[] = [
  { code: "1100", name: "서울특별시" },
  { code: "2600", name: "부산광역시" },
  { code: "2700", name: "대구광역시" },
  { code: "2800", name: "인천광역시" },
  { code: "2900", name: "광주광역시" },
  { code: "3000", name: "대전광역시" },
  { code: "3100", name: "울산광역시" },
  { code: "3600", name: "세종특별자치시" },
  { code: "4100", name: "경기도" },
  { code: "4200", name: "강원특별자치도" },
  { code: "4300", name: "충청북도" },
  { code: "4400", name: "충청남도" },
  { code: "4500", name: "전북특별자치도" },
  { code: "4600", name: "전라남도" },
  { code: "4700", name: "경상북도" },
  { code: "4800", name: "경상남도" },
  { code: "5000", name: "제주특별자치도" },
];

export interface TownCode {
  code: string;
  name: string;
}

/**
 * 한 시·도의 시·군·구 코드 목록 조회. NEC 의 동적 endpoint.
 * 응답 형태: { jsonResult: { body: [{ CODE: "4821", NAME: "창원시의창구" }, ...] } }
 */
export async function fetchTownCodes(
  electionId: string,
  cityCode: string,
): Promise<TownCode[]> {
  const url = `${SELECTBOX_TOWN_URL}?electionId=${electionId}&cityCode=${cityCode}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`townCode HTTP ${res.status}`);
  const json = (await res.json()) as {
    jsonResult?: { body?: Array<{ CODE: string; NAME: string }> };
  };
  const body = json.jsonResult?.body ?? [];
  return body.map((row) => ({ code: row.CODE, name: row.NAME }));
}
```

- [ ] **Step 2: 컴파일 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -E "nec-codes" | head -5
```

Expected: 출력 없음.

- [ ] **Step 3: 빠른 smoke — 경남 townCode 조회**

```bash
cd ~/coding/ourstory && pnpm tsx -e '
import { fetchTownCodes } from "./scripts/ingest/lib/nec-codes";
const towns = await fetchTownCodes("0020250603", "4800");
console.log(`towns: ${towns.length}`);
console.log(towns.slice(0, 3));
'
```

Expected: `towns: 22` 정도, 첫 3개 출력 (`{ code: "4821", name: "창원시의창구" }` 등).

---

## Task 6: 단일 fetch 헬퍼 (재시도·타임아웃·캐시)

**Files:**
- Create: `scripts/ingest/lib/nec-fetch.ts`
- Create: `tests/unit/nec-fetch.test.ts`

- [ ] **Step 1: 헬퍼 작성**

```ts
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const NEC_BASE = "http://info.nec.go.kr/electioninfo/electionInfo_report.xhtml";
const TIMEOUT_MS = 6000;
const MAX_RETRY = 3;

export interface FetchParams {
  electionId: string;        // "0020250603" 또는 "0000000000"
  electionName?: string;     // YYYYMMDD (역대 모드)
  electionType: string;      // "1" | "2" | "4"
  electionCode: string;      // necCode
  cityCode: string;
  townCode?: string;         // 시·도 단위 race 는 생략
  endpoint: "VCCP08" | "VCCP04";
}

export interface FetchResult {
  status: "ok" | "no-data" | "failed";
  html?: string;
  cached: boolean;
  cachePath: string;
  error?: string;
}

/**
 * 파라미터로부터 캐시 파일명 생성. {electionId}-{cityCode}-{townCode}.html.
 * townCode 없으면 "all" 로.
 */
export function cacheFilename(p: FetchParams): string {
  const town = p.townCode ?? "all";
  return `${p.electionId}-${p.cityCode}-${town}.html`;
}

/**
 * 단일 NEC POST. 캐시 hit 시 디스크 reuse. 빈 응답(검색된 결과가 없습니다)도 캐시 저장(no-data 분류).
 *
 * @param cacheDir 절대 경로 (예: data/raw/polling-stations)
 */
export async function fetchOne(
  p: FetchParams,
  cacheDir: string,
  opts: { refresh?: boolean } = {},
): Promise<FetchResult> {
  const cachePath = path.join(cacheDir, cacheFilename(p));

  if (!opts.refresh && existsSync(cachePath)) {
    const html = await readFile(cachePath, "utf-8");
    return {
      status: html.includes("검색된 결과가 없습니다") ? "no-data" : "ok",
      html,
      cached: true,
      cachePath,
    };
  }

  const requestUri = `/electioninfo/${p.electionId}/vc/${p.endpoint.toLowerCase()}.jsp`;
  const statementId = p.endpoint === "VCCP04" ? "VCCP04_#2_0" : "VCCP08_#1";
  const body = new URLSearchParams({
    electionId: p.electionId,
    requestURI: requestUri,
    topMenuId: "VC",
    secondMenuId: p.endpoint,
    menuId: p.endpoint,
    statementId,
    electionType: p.electionType,
    electionCode: p.electionCode,
    cityCode: p.cityCode,
    searchMode: "1",
  });
  if (p.electionName) body.set("electionName", p.electionName);
  if (p.townCode) body.set("townCode", p.townCode);

  let lastErr: string | undefined;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(NEC_BASE, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0",
        },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!r.ok) {
        lastErr = `HTTP ${r.status}`;
        // 5xx 만 재시도, 4xx 는 즉시 실패
        if (r.status < 500) break;
        await new Promise((res) => setTimeout(res, 1000 * 2 ** (attempt - 1)));
        continue;
      }
      const html = await r.text();
      if (!existsSync(cacheDir)) await mkdir(cacheDir, { recursive: true });
      await writeFile(cachePath, html);
      return {
        status: html.includes("검색된 결과가 없습니다") ? "no-data" : "ok",
        html,
        cached: false,
        cachePath,
      };
    } catch (e) {
      clearTimeout(t);
      lastErr = (e as Error).message;
      await new Promise((res) => setTimeout(res, 1000 * 2 ** (attempt - 1)));
    }
  }
  return { status: "failed", cached: false, cachePath, error: lastErr };
}
```

- [ ] **Step 2: 단위 테스트 — 캐시 파일명 생성**

```ts
// tests/unit/nec-fetch.test.ts
import { describe, it, expect } from "vitest";
import { cacheFilename } from "../../scripts/ingest/lib/nec-fetch";

describe("cacheFilename", () => {
  it("townCode 있으면 {election}-{city}-{town}.html", () => {
    expect(cacheFilename({
      electionId: "0000000000",
      electionType: "4",
      electionCode: "8",
      cityCode: "4800",
      townCode: "4803",
      endpoint: "VCCP08",
    })).toBe("0000000000-4800-4803.html");
  });

  it("townCode 없으면 {election}-{city}-all.html", () => {
    expect(cacheFilename({
      electionId: "0020250603",
      electionType: "1",
      electionCode: "1",
      cityCode: "4800",
      endpoint: "VCCP08",
    })).toBe("0020250603-4800-all.html");
  });
});
```

- [ ] **Step 3: 테스트 실행**

```bash
cd ~/coding/ourstory && pnpm test nec-fetch 2>&1 | tail -8
```

Expected: 2 tests PASS.

---

## Task 7: 메인 fetcher CLI

**Files:**
- Create: `scripts/ingest/fetch-polling-stations.ts`
- Modify: `package.json` (스크립트 1줄 추가)

- [ ] **Step 1: 메인 CLI 작성**

```ts
// raw HTML 수집: 한 electionId 의 모든 (cityCode, townCode) 조합을
// 동시성 5 로 받아 data/raw/polling-stations/ 에 캐시.
//
// 실행: pnpm ingest:fetch-polling-stations <electionId> [--refresh]
//
// race 종류 분기:
//   necCode 1 (대통령), 3 (광역단체장), 11 (교육감) → 시·도 단위만 (townCode 생략)
//   그 외 → 시·도 × townCode 조합

import { eq } from "drizzle-orm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql, db } from "../../src/lib/db-admin";
import { elections } from "../../db/schema";
import { CITY_CODES, fetchTownCodes } from "./lib/nec-codes";
import { fetchOne, type FetchParams } from "./lib/nec-fetch";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, "..", "..", "data", "raw", "polling-stations");
const CONCURRENCY = 5;

// race 종류 → (시·도 단위 only / 시·군·구까지 / VCCP08 vs VCCP04)
function planRace(necCode: string): {
  sigunguLevel: boolean;
  endpoint: "VCCP08" | "VCCP04";
  electionType: string;
} {
  const sigunguOnly = new Set(["1", "3", "11"]);
  const sigunguLevel = !sigunguOnly.has(necCode);
  // necCode → electionType
  const typeMap: Record<string, string> = {
    "1": "1", // 대통령
    "2": "2", // 국회 지역구
    "3": "4", "4": "4", "5": "4", "6": "4", "8": "4", "9": "4", "11": "4", // 지방
    "7": "2", // 국회 비례
  };
  const electionType = typeMap[necCode] ?? "4";
  // 지역구(2)·기초의원지역구(6) 는 VCCP04 권장 (후보자명 행 포함). 그 외 VCCP08.
  const endpoint: "VCCP08" | "VCCP04" =
    (necCode === "2" || necCode === "6") ? "VCCP04" : "VCCP08";
  return { sigunguLevel, endpoint, electionType };
}

// 동시성 풀 — N개 까지만 동시에 await
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const electionId = process.argv[2];
  const refresh = process.argv.includes("--refresh");
  if (!electionId) {
    console.error("usage: tsx fetch-polling-stations.ts <electionId> [--refresh]");
    process.exit(2);
  }

  const [election] = await db.select().from(elections).where(eq(elections.id, electionId)).limit(1);
  if (!election) {
    console.error(`election not found: ${electionId}`);
    await sql.end();
    process.exit(1);
  }
  if (!election.necElectionId || !election.necCode || !election.date) {
    console.error(`necElectionId·necCode·date 미설정: ${electionId}`);
    await sql.end();
    process.exit(1);
  }

  const dateYmd = String(election.date).replace(/-/g, "");
  const plan = planRace(election.necCode);
  const isLive = election.necElectionId !== "0000000000";

  console.log(
    `▶ ${electionId} necCode=${election.necCode} ` +
      `endpoint=${plan.endpoint} sigungu=${plan.sigunguLevel} live=${isLive} refresh=${refresh}`,
  );

  // (cityCode, townCode?) 조합 생성
  const targets: FetchParams[] = [];
  for (const city of CITY_CODES) {
    if (!plan.sigunguLevel) {
      targets.push({
        electionId: isLive ? election.necElectionId : "0000000000",
        electionName: dateYmd,
        electionType: plan.electionType,
        electionCode: election.necCode,
        cityCode: city.code,
        endpoint: plan.endpoint,
      });
      continue;
    }
    // townCode 목록 조회
    let towns;
    try {
      towns = await fetchTownCodes(
        isLive ? election.necElectionId : "0020250603", // 역대도 임의 electionId 면 됨
        city.code,
      );
    } catch (e) {
      console.warn(`  townCode 조회 실패 ${city.name}: ${(e as Error).message}`);
      continue;
    }
    for (const t of towns) {
      targets.push({
        electionId: isLive ? election.necElectionId : "0000000000",
        electionName: dateYmd,
        electionType: plan.electionType,
        electionCode: election.necCode,
        cityCode: city.code,
        townCode: t.code,
        endpoint: plan.endpoint,
      });
    }
  }

  console.log(`  대상: ${targets.length} 호출`);

  let ok = 0, noData = 0, failed = 0, cached = 0;
  await pool(targets, CONCURRENCY, async (p) => {
    const r = await fetchOne(p, CACHE_DIR, { refresh });
    if (r.cached) cached++;
    if (r.status === "ok") ok++;
    else if (r.status === "no-data") noData++;
    else failed++;
  });

  console.log(
    `✓ ok=${ok} no-data=${noData} failed=${failed} cached=${cached}/${targets.length}`,
  );
  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: package.json 스크립트 추가**

`package.json` 의 `scripts` 객체 안에 다음 한 줄 추가 (기존 `ingest:poll-live` 줄 다음 권장).

```json
    "ingest:fetch-polling-stations": "dotenv -e .env.local -- tsx scripts/ingest/fetch-polling-stations.ts",
```

- [ ] **Step 3: 컴파일 + usage 확인**

```bash
cd ~/coding/ourstory && pnpm tsc --noEmit 2>&1 | grep -E "fetch-polling-stations" | head -5
cd ~/coding/ourstory && pnpm ingest:fetch-polling-stations 2>&1 | head -3
```

Expected: 컴파일 에러 없음. usage 출력 + exit code 2.

---

## Task 8: 2025 대선 smoke 실행 + 검증

**Files:**
- 없음 (실제 raw 디렉터리 생성)

- [ ] **Step 1: 2025 대선 fetch**

```bash
cd ~/coding/ourstory && pnpm ingest:fetch-polling-stations 2025-presidential 2>&1 | tail -15
```

Expected (대략):
```
▶ 2025-presidential necCode=1 endpoint=VCCP08 sigungu=false live=true refresh=false
  대상: 17 호출
✓ ok=17 no-data=0 failed=0 cached=0/17
```

(대선은 시·도 단위 only 라 17 파일. live=true 면 `0020250603` 직접 호출. live=false 면 역대 패턴.)

- [ ] **Step 2: raw 디렉터리 검증**

```bash
ls ~/coding/ourstory/data/raw/polling-stations/ | wc -l
ls ~/coding/ourstory/data/raw/polling-stations/ | head -5
```

Expected: `17` (정확히 17 파일). 파일명 `0020250603-{cityCode}-all.html` 패턴.

- [ ] **Step 3: 한 파일 안에 합리적 내용 있는지 확인**

```bash
grep -oE "합계|투표구명|검색된 결과" ~/coding/ourstory/data/raw/polling-stations/0020250603-4800-all.html | sort -u
```

Expected: `투표구명`, `합계` 출력. (live electionId 가 역대로 이관되어 빈 응답이면 historical 패턴으로 fallback 수동 시도)

- [ ] **Step 4: 캐시 동작 — 두 번째 실행은 모두 cached**

```bash
cd ~/coding/ourstory && pnpm ingest:fetch-polling-stations 2025-presidential 2>&1 | tail -3
```

Expected: `cached=17/17`, 실행 시간 짧음.

- [ ] **Step 5: parse-polling-stations 연동 확인**

```bash
cd ~/coding/ourstory && pnpm tsx scripts/ingest/parse-polling-stations.ts 2025-presidential 2>&1 | tail -3
```

Expected: `data/processed/polling-stations/2025-presidential.json` 생성, station 수 출력 (전국 14,000 ±10%).

- [ ] **Step 6: 만약 live electionId 빈 응답**

2025 대선이 역대로 이관됐다면 `0020250603` 응답이 비어있을 수 있음. 진단:

```bash
grep -c "검색된 결과가 없습니다" ~/coding/ourstory/data/raw/polling-stations/*.html
```

만약 17 파일 전부 미공개이면 `2025-presidential` 의 `necElectionId` 를 `0000000000` 으로 임시 수정 후 재실행. seed 영구 수정은 별도 검토.

---

## Task 9: 전체 테스트 + 커밋

- [ ] **Step 1: 전체 테스트 통과**

```bash
cd ~/coding/ourstory && pnpm test 2>&1 | tail -8
```

Expected: 기존 12 + 신규 3 + 신규 2 = 17 신규 케이스 모두 PASS.

- [ ] **Step 2: 변경 확인**

```bash
git -C ~/coding/ourstory status
git -C ~/coding/ourstory diff --stat
```

Expected 변경:
- `scripts/ingest/lib/nec-html.ts` (수정)
- `scripts/ingest/lib/nec-codes.ts` (신규)
- `scripts/ingest/lib/nec-fetch.ts` (신규)
- `scripts/ingest/fetch-polling-stations.ts` (신규)
- `tests/fixtures/nec-vccp04-2024-jinju-district.html` (신규)
- `tests/unit/polling-stations-district-parser.test.ts` (신규)
- `tests/unit/nec-fetch.test.ts` (신규)
- `package.json` (수정)

(`data/raw/polling-stations/` 는 `.gitignore` 에 추가 검토 — 본 phase 에서 추가 권장)

- [ ] **Step 3: .gitignore 에 raw 디렉터리 추가**

`.gitignore` 끝에 다음 한 줄 추가.

```
data/raw/polling-stations/
data/processed/polling-stations/
```

- [ ] **Step 4: 커밋**

```bash
git -C ~/coding/ourstory add scripts/ingest/lib/nec-html.ts scripts/ingest/lib/nec-codes.ts scripts/ingest/lib/nec-fetch.ts scripts/ingest/fetch-polling-stations.ts tests/fixtures/nec-vccp04-2024-jinju-district.html tests/unit/polling-stations-district-parser.test.ts tests/unit/nec-fetch.test.ts package.json .gitignore
git -C ~/coding/ourstory commit -m "$(cat <<'EOF'
ourstory Phase 5.2 — 투표소 fetcher + 지역구 파서 확장

parseVccp04District: 선거구별 후보자(tbody 안의 후보자 헤더 행) 처리.
lib/nec-codes.ts: 17 시·도 상수 + townCode 동적 조회.
lib/nec-fetch.ts: 단일 POST (재시도 3, 6s 타임아웃, 파일 캐시).
fetch-polling-stations.ts: race 종류 분기 + 동시성 5 풀.
검증: 2025 대선 17 시·도 raw 캐시 성공, parse → JSON 변환 정상.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(controller 가 review 후 커밋하는 패턴이면 본 Step 4 는 컨트롤러 담당.)

---

## 검증 체크리스트 (Phase 5.2 완료 조건)

- [ ] `pnpm test` → 17 신규 테스트 + 기존 모두 PASS
- [ ] `pnpm ingest:fetch-polling-stations 2025-presidential` → 17 파일 생성 (live 또는 historical fallback)
- [ ] 두 번째 실행은 cached=17/17 (즉시 종료)
- [ ] `pnpm tsx scripts/ingest/parse-polling-stations.ts 2025-presidential` → JSON 생성 + station 수 ≈ 14k ±10%
- [ ] `.gitignore` 에 raw/processed 디렉터리 추가됨

전부 통과 시 Phase 5.2 완료. 다음 Phase 5.3 (ingest 검증) 플랜 작성.
