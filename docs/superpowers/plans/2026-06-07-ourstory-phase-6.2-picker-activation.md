# ourstory Phase 6.2 — emd · station picker 활성화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 picker 의 읍·면·동(emd)과 투표소(station) 단계를 활성화해 사용자가 사도→시·군·구→읍·면·동→투표소까지 4단 cascading drilldown 으로 시계열을 볼 수 있게 한다.

**Architecture:** `build:static` 이 station 파일명을 emd 단위로 group 한 `stationListByEmd` 를 `index.json` 에 추가. HomeView 가 emd/station 옵션을 `index.regions` 에서 useMemo 로 도출하고, station 선택 시 `/data/static/station/{key}.json` client fetch. force-static · 정적 호스팅 유지.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · vitest · tsx (build scripts) · pnpm

선행 spec: `docs/superpowers/specs/2026-06-07-phase-6.2-picker-activation-design.md`
선행 작업: `2afb53b` (client-fetch sido/sigungu), `318fefb` (useEffect reset 제거)
병렬 진행 가능: Phase 7.1 (지선 데이터 확장, `scripts/build/parsers/`)

---

## 파일 구조

| 파일 | 동작 | 책임 |
|------|------|------|
| `src/types/static.ts` | Modify | `StaticIndex.regions.stationListByEmd?: Record<string, string[]>` 추가 |
| `scripts/build/build-static.ts` | Modify | station 디렉터리 읽어 sigunguName/emdName prefix 로 group → stationListByEmd |
| `scripts/build/build-static.test.ts` | Create | stationListByEmd group 로직 단위 테스트 |
| `src/app/page.tsx` | Modify | HomeView 에 `regionIndex={index.regions}` 추가 전달 |
| `src/components/HomeView.tsx` | Modify | regionIndex prop 받고 emdOptions/stationOptions useMemo 도출 + station fetch 분기 |
| `next.config.ts` | Modify (필요시) | `/data/static/station/**` 정적 호스팅 확인 (이미 포함되어 있을 듯) |

`HeaderControls.tsx` 는 무변경 — 기존 `disabled={!selSigungu || emdOptions.length === 0}` 조건이 새 emdOptions 도출과 그대로 호환.

---

## Task 1: types 확장

**Files:**
- Modify: `src/types/static.ts`

- [ ] **Step 1: 타입 추가**

`src/types/static.ts` 의 `StaticIndex.regions` 안에 한 줄 추가:

```ts
// 기존:
regions: {
  sido: RegionMeta[];
  sigunguByRegion: Record<string, RegionMeta[]>;
  emdByRegion?: Record<string, RegionMeta[]>;
};

// 수정:
regions: {
  sido: RegionMeta[];
  sigunguByRegion: Record<string, RegionMeta[]>;
  emdByRegion?: Record<string, RegionMeta[]>;
  stationListByEmd?: Record<string, string[]>;  // emdCode → station name list
};
```

- [ ] **Step 2: typecheck**

```bash
cd /Users/ahbaik/coding/ourstory && pnpm exec tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/types/static.ts
git commit -m "types: StaticIndex.regions 에 stationListByEmd 옵션 필드 추가"
```

---

## Task 2: build-static — stationListByEmd 생성 (TDD)

**Files:**
- Create: `scripts/build/build-static.test.ts` (또는 기존 테스트 파일 확장)
- Modify: `scripts/build/build-static.ts`

이 task 는 station 파일명을 emd code 로 group 하는 순수 함수를 분리해 TDD 로 짠다. 실제 디렉터리 IO 는 build-static.ts 의 wiring 부분에 두고, 순수 함수만 테스트.

- [ ] **Step 1: 헬퍼 함수 위치 확인**

먼저 build-static.ts 구조 확인:

```bash
cd /Users/ahbaik/coding/ourstory && head -80 scripts/build/build-static.ts
```

Expected: index 생성 부분을 찾는다. `regions: { sido, sigunguByRegion, emdByRegion }` 빌드 위치.

- [ ] **Step 2: 순수 함수 분리**

`scripts/build/build-static.ts` 안에 (또는 같은 디렉터리의 새 파일 `station-grouping.ts` 로) 다음 함수 추가:

```ts
// emdCode 별로 station name 목록을 group.
// emdToParent: emdCode → { sigunguName, emdName }
// stationKeys: 디렉터리에서 읽은 모든 station file basename (확장자 제외)
export function buildStationListByEmd(
  emdToParent: Record<string, { sigunguName: string; emdName: string }>,
  stationKeys: string[],
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [emdCode, { sigunguName, emdName }] of Object.entries(emdToParent)) {
    const prefix = `${sigunguName}-${emdName}-`;
    const names = stationKeys
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
    if (names.length > 0) {
      names.sort((a, b) => a.localeCompare(b, "ko"));
      result[emdCode] = names;
    }
  }
  return result;
}
```

- [ ] **Step 3: 실패 테스트 작성**

`scripts/build/station-grouping.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildStationListByEmd } from "./build-static";
// 또는 station-grouping 으로 옮겼다면 from "./station-grouping"

describe("buildStationListByEmd", () => {
  const emdToParent = {
    "4812011000": { sigunguName: "창원시", emdName: "상남동" },
    "4812011500": { sigunguName: "창원시", emdName: "사파동" },
  };

  it("prefix 매칭 station 만 group 에 들어감", () => {
    const stations = [
      "창원시-상남동-상남제1투",
      "창원시-상남동-상남제2투",
      "창원시-사파동-사파제1투",
      "진주시-문산읍-문산제1투",
    ];
    const r = buildStationListByEmd(emdToParent, stations);
    expect(r["4812011000"]).toEqual(["상남제1투", "상남제2투"]);
    expect(r["4812011500"]).toEqual(["사파제1투"]);
    expect(r["4817056000"]).toBeUndefined();
  });

  it("매칭 station 0개인 emd 는 결과에 안 들어감", () => {
    const r = buildStationListByEmd(emdToParent, ["진주시-문산읍-문산제1투"]);
    expect(Object.keys(r)).toHaveLength(0);
  });

  it("한국어 로케일 정렬", () => {
    const r = buildStationListByEmd(emdToParent, [
      "창원시-상남동-상남제3투",
      "창원시-상남동-상남제1투",
      "창원시-상남동-상남제2투",
    ]);
    expect(r["4812011000"]).toEqual(["상남제1투", "상남제2투", "상남제3투"]);
  });
});
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd /Users/ahbaik/coding/ourstory && pnpm test station-grouping
```

Expected: 3/3 PASS (Step 2 의 함수 구현이 이미 들어가 있으므로)

만약 함수가 별도 파일로 안 옮겨졌다면 export 추가가 필요할 수 있음. import 경로 확인.

- [ ] **Step 5: build-static.ts 의 wiring 부분 수정**

build-static.ts 안 index 생성 부분 (regions 객체 만드는 곳) 에 다음 패턴 추가:

```ts
// 1. emdToParent 구성 — emdByRegion 의 각 sigunguCode 의 children 의 메타로부터
const emdToParent: Record<string, { sigunguName: string; emdName: string }> = {};
for (const [sigunguCode, emds] of Object.entries(emdByRegion ?? {})) {
  const sigunguRegion = await getRegionFileFromDisk(sigunguCode);
  const sigunguName = sigunguRegion?.name ?? "";
  for (const emd of emds) {
    emdToParent[emd.code] = { sigunguName, emdName: emd.name };
  }
}

// 2. station 디렉터리 읽기
const stationDir = path.join(STATIC_ROOT, "station");
const stationFiles = await readdir(stationDir);
const stationKeys = stationFiles
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

// 3. group
const stationListByEmd = buildStationListByEmd(emdToParent, stationKeys);

// 4. regions 객체에 추가
regions: {
  sido,
  sigunguByRegion,
  emdByRegion,
  stationListByEmd,
}
```

정확한 변수명·헬퍼명은 build-static.ts 의 기존 패턴 따른다 (Step 1 의 확인 결과 기준).

- [ ] **Step 6: build 실행**

```bash
cd /Users/ahbaik/coding/ourstory && pnpm build:static 2>&1 | tail -20
```

Expected: 에러 없이 완료. `public/data/static/index.json` 안에 `stationListByEmd` 키 존재.

- [ ] **Step 7: 검증**

```bash
node -e "const d=JSON.parse(require('fs').readFileSync('public/data/static/index.json','utf-8')); const r=d.regions.stationListByEmd; console.log('keys:', Object.keys(r).length, 'sample:', Object.entries(r).slice(0,2).map(([k,v]) => k+': '+v.slice(0,3).join(',')))"
```

Expected: 키 수십~수백, 샘플 station 이름들 출력

- [ ] **Step 8: 커밋**

```bash
git add scripts/build/build-static.ts scripts/build/station-grouping.test.ts public/data/static/index.json
git commit -m "build: stationListByEmd 를 index.json 에 추가 (emdCode → station 이름 목록)"
```

---

## Task 3: page.tsx — HomeView 에 regionIndex prop 전달

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: 변경**

`src/app/page.tsx` 의 마지막 `<HomeView ... />` 호출 부분 (line ~131):

```diff
       <HomeView
         state={state}
         filterOptions={filterOptions}
         emdOptions={emdOptions}
         stationOptions={stationOptions}
         sources={sources}
         elections={index.elections}
         parties={index.parties}
+        regionIndex={index.regions}
       />
```

- [ ] **Step 2: typecheck**

```bash
cd /Users/ahbaik/coding/ourstory && pnpm exec tsc --noEmit
```

Expected: HomeView 의 Props 에 아직 regionIndex 없으니 에러 발생. 다음 Task 에서 해결.

- [ ] **Step 3: 커밋은 Task 4 와 함께**

이 task 단독으로는 빌드가 안 끝나니 커밋은 Task 4 끝에 함께.

---

## Task 4: HomeView — emd/station options client 도출 + station fetch

**Files:**
- Modify: `src/components/HomeView.tsx`

가장 큰 변경. 기존 emdOptions/stationOptions props 는 유지(하위 호환) 하되, regionIndex 가 있으면 그것을 우선 사용. station 선택 시 fetch 분기 추가.

- [ ] **Step 1: 신규 prop 타입 추가**

`src/components/HomeView.tsx` 의 Props interface 에 추가:

```diff
 interface Props {
   state: HomeState;
   filterOptions: { regions: RegionOpt[]; types: string[]; parties: PartyOpt[]; yearOptions: string[] };
   emdOptions: EmdOpt[];
   stationOptions: StationOpt[];
   sources: ChartSource[];
   elections: ElectionMeta[];
   parties: PartyMeta[];
+  regionIndex?: import("../types/static").StaticIndex["regions"];
 }
```

- [ ] **Step 2: 함수 시그니처에 regionIndex 받기**

```diff
-export function HomeView({ state, filterOptions, emdOptions, stationOptions, sources, elections, parties }: Props) {
+export function HomeView({ state, filterOptions, emdOptions: emdOptionsFromServer, stationOptions: stationOptionsFromServer, sources, elections, parties, regionIndex }: Props) {
```

`emdOptions`/`stationOptions` 은 server 가 보낸 default(전국 상태) 이라 무시하지만 호환을 위해 받음. 변수명 충돌 피하기 위해 ...FromServer 접미사.

- [ ] **Step 3: client 도출 useMemo 추가**

`handleChange` 함수 다음 줄 즈음에:

```ts
// regionIndex 가 있으면 emd/station 옵션을 그것에서 도출 (force-static 환경에서 server 가
// default 만 보내므로 client 가 state.region 기반으로 직접 매핑).
const emdOptions = useMemo(() => {
  if (!regionIndex?.emdByRegion) return emdOptionsFromServer;
  // state.region 으로부터 sigunguCode 추출
  const code = optimisticState.region;
  let sigunguCode: string | null = null;
  if (code.startsWith("station:")) sigunguCode = code.split(":")[1] ?? null;
  else if (/^\d{10}$/.test(code) && code.endsWith("00000") && !code.endsWith("00000000")) {
    sigunguCode = code; // sigungu 그 자체
  } else if (/^\d{10}$/.test(code) && code.endsWith("00") && !code.endsWith("00000")) {
    sigunguCode = code.slice(0, 5) + "00000"; // emd → parent sigungu
  } else if (code.startsWith("9")) {
    sigunguCode = code.slice(1, 6) + "00000"; // synthetic emd → parent
  }
  if (!sigunguCode) return [];
  const list = regionIndex.emdByRegion[sigunguCode] ?? [];
  return list.map((r) => ({ code: r.code, name: r.name }));
}, [regionIndex, optimisticState.region, emdOptionsFromServer]);

const stationOptions = useMemo(() => {
  if (!regionIndex?.stationListByEmd) return stationOptionsFromServer;
  const code = optimisticState.region;
  let emdCode: string | null = null;
  if (code.startsWith("station:")) emdCode = code.split(":")[2] ?? null;
  else if (/^\d{10}$/.test(code) && code.endsWith("00") && !code.endsWith("00000")) emdCode = code;
  else if (code.startsWith("9")) emdCode = code;
  if (!emdCode) return [];
  const names = regionIndex.stationListByEmd[emdCode] ?? [];
  // 시·군·구 코드 도출 (station: 형식이 요구) — emd 부모 sigungu
  const sigunguCode = code.startsWith("station:")
    ? code.split(":")[1]
    : emdCode.startsWith("9")
      ? emdCode.slice(1, 6) + "00000"
      : emdCode.slice(0, 5) + "00000";
  return names.map((n) => ({ sigunguCode, emdCode: emdCode!, name: n }));
}, [regionIndex, optimisticState.region, stationOptionsFromServer]);
```

- [ ] **Step 4: station fetch 분기 추가**

기존 region useEffect (Task 의 region.json fetch) 를 station 처리 분기로 확장:

```diff
 useEffect(() => {
   const code = optimisticState.region;
   if (!code || code === "all") {
     setClientSources(sources);
     return;
   }
-  if (code.startsWith("station:")) {
-    return; // station 단위 미지원 (별도 후속)
-  }
   let cancelled = false;
-  fetch(`/data/static/region/${code}.json`)
+  // station: 형식이면 station 파일 fetch, 아니면 region 파일 fetch
+  let url: string;
+  if (code.startsWith("station:")) {
+    const [, sigunguCode, emdCode, ...rest] = code.split(":");
+    const stationName = rest.join(":");
+    void sigunguCode;
+    // station 파일명 키 = `${sigunguName}-${emdName}-${stationName}`
+    // 이름 도출은 regionIndex 의 sigunguByRegion / emdByRegion 에서.
+    const sigungus = regionIndex
+      ? Object.values(regionIndex.sigunguByRegion).flat()
+      : [];
+    const sigunguMeta = sigungus.find((s) => s.code === sigunguCode);
+    const emds = regionIndex?.emdByRegion
+      ? regionIndex.emdByRegion[sigunguCode] ?? []
+      : [];
+    const emdMeta = emds.find((e) => e.code === emdCode);
+    if (!sigunguMeta || !emdMeta || !stationName) {
+      setClientSources([]);
+      return;
+    }
+    const safeName = `${sigunguMeta.name}-${emdMeta.name}-${stationName}`.replace(/[\/\\]/g, "_");
+    url = `/data/static/station/${encodeURIComponent(safeName)}.json`;
+  } else {
+    url = `/data/static/region/${code}.json`;
+  }
+  fetch(url)
     .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`region.json ${r.status}`))))
     .then((f: { timeseries: Record<string, TimeseriesPoint[]> }) => {
       if (!cancelled) setClientSources([{ timeseries: f.timeseries }]);
     })
     .catch(() => {
       if (!cancelled) setClientSources([]);
     });
   return () => {
     cancelled = true;
   };
-}, [optimisticState.region, sources]);
+}, [optimisticState.region, sources, regionIndex]);
```

- [ ] **Step 5: HeaderControls 에 새 emdOptions/stationOptions 전달**

기존 `emdOptions={emdOptionsFromServer}` 가 아닌 새 client-derived 사용:

```diff
 <HeaderControls
   state={optimisticState}
   onChange={handleChange}
   pending={pending}
   regions={filterOptions.regions}
-  emdOptions={emdOptions}
-  stationOptions={stationOptions}
+  emdOptions={emdOptions}      // 위 useMemo 결과
+  stationOptions={stationOptions} // 위 useMemo 결과
   types={filterOptions.types}
   parties={filterOptions.parties}
   yearOptions={filterOptions.yearOptions}
 />
```

변수명이 위에서 client-derived 와 동일하므로 자연스럽게 새 값 사용.

- [ ] **Step 6: typecheck + 단위 테스트**

```bash
cd /Users/ahbaik/coding/ourstory && pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -3
```

Expected: 에러 없음, 모든 단위 테스트 PASS.

- [ ] **Step 7: 커밋**

```bash
git add src/components/HomeView.tsx src/app/page.tsx
git commit -m "fix(home): emd/station picker 활성화 — regionIndex client lookup + station fetch"
```

---

## Task 5: Playwright smoke

`plugin_playwright_playwright__*` MCP 도구로 실제 동작 검증.

- [ ] **Step 1: 빌드 + dev 서버**

```bash
cd /Users/ahbaik/coding/ourstory && pnpm build:static && pnpm dev &
```

- [ ] **Step 2: 시나리오 1 — 4단 cascading 정상**

1. `browser_navigate` → `http://localhost:3000/`
2. 시·도 = "경상남도" 선택 → URL `?region=4800000000`, picker 유지
3. 시·군·구 = "창원시" 선택 → URL `?region=4812000000`
4. 읍·면·동 select 활성 + 옵션 보임 — "상남동" 선택
5. 투표소 select 활성 + 옵션 보임 — "상남제1투" (또는 실제 있는 이름) 선택
6. 시계열에 데이터 점 표시 (적어도 hasStationLevel=true 인 선거에서)

- [ ] **Step 3: 시나리오 2 — emd 가 비어 있는 sigungu**

emdByRegion 에 키 없는 어떤 sigungu (예: 세종특별자치시 = sigungu 없을 수도) 선택 → 읍·면·동 select 비활성 (disabled)

- [ ] **Step 4: 시나리오 3 — 전국 복귀**

시·도 picker 다시 "전국" → URL `/`, 모든 하위 select 비활성, sources 전국 기준 복귀

- [ ] **Step 5: dev 서버 종료**

```bash
pkill -f "next dev"
```

- [ ] **Step 6: push (사용자 확인 후)**

```bash
cd /Users/ahbaik/coding/ourstory && git push
```

---

## 통과 기준

- 단위 테스트 (기존 101 + 신규 3) PASS
- Playwright smoke 3 시나리오 PASS
- `public/data/static/index.json` 크기 +500KB gzip 이내
- Vercel 배포 후 jp-ourstory.vercel.app 에서 4단 picker 정상 동작
- "창원시 → 상남동" 단계까지 시계열 갱신 확인

## 다음 phase

- 7.1 (parallel) — 2022 지선 emd 데이터 확장
- 6.3 (후속) — 공유 URL 파싱 (mount 시 window.location 읽기)
