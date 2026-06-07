# ourstory Phase 6.1 — AdvancedTable 도입 (시계열 모드 + .xlsx) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈·`/region/[code]` 양쪽에서 표 모드가 정렬·정당 가시성 토글·검색·sticky·조건부 색상·서식 포함 `.xlsx` 다운로드 까지 지원하는 `AdvancedTable` 로 교체된다. 모드는 시계열 한 종류만 (지역 모드는 Phase 6.2 에서).

**Architecture:** `HomeTable` 을 삭제하고 `AdvancedTable` 로 교체. `TimeseriesPanel` 이 두 패널(HomeChart / AdvancedTable) 사이를 토글. AdvancedTable 은 TanStack Table v8 의 `useReactTable` 을 headless 로 사용해 sorting·columnVisibility·globalFilter 상태를 관리. 출력은 순수함수 `buildTableModel(timeseries 모드)` 와 표시·내보내기 공용. 다운로드는 `exportCsv` 동기 + `exportXlsx` lazy import.

**Tech Stack:** Next.js 16 · React 19 · Tailwind · `@tanstack/react-table` v8 · `exceljs` (lazy) · vitest · Playwright (MCP plugin)

선행 spec: `docs/superpowers/specs/2026-06-07-advanced-excel-table-design.md`
선행 작업: `feat: 시계열 표(엑셀형) 보기 + CSV 다운로드` (a541f7f), `2026-06-07-region-timeseries-design.md` 통합 완료
후속: Phase 6.2 — 모드 토글 + 지역 모드 (행=region children, 선거 picker)

---

## 파일 구조

| 파일 | 동작 | 책임 |
|------|------|------|
| `package.json` | Modify | `@tanstack/react-table` · `exceljs` 추가 |
| `src/components/table/AdvancedTable.types.ts` | Create | `SortState`·`ColumnDef`·`RowData`·`TableModel` 보조 타입 |
| `src/lib/table/buildTableModel.ts` | Create | 순수함수. timeseries 모드 분기. `ChartRow[]+ChartLine[]` → `TableModel` |
| `src/lib/table/buildTableModel.test.ts` | Create | 7 케이스 (rows·cols·미출마·정의당 우선·역순 정렬 등) |
| `src/lib/table/cellFormatting.ts` | Create | 정의당 그라데이션 함수·정당색 헤더 클래스 |
| `src/lib/table/cellFormatting.test.ts` | Create | 4 케이스 (0~100 강도, 정의당 색조, 미출마 처리 등) |
| `src/lib/table/exportCsv.ts` | Create | `TableModel` → CSV (UTF-8 BOM). 기존 `downloadCsv` 로직 이관 |
| `src/lib/table/exportCsv.test.ts` | Create | 3 케이스 (BOM, 따옴표 escape, 미출마 빈 셀) |
| `src/lib/table/exportXlsx.ts` | Create | `TableModel` → Workbook. `exceljs` lazy import. 정당색·고정·numFmt |
| `src/lib/table/exportXlsx.test.ts` | Create | 4 케이스 (시트명·헤더 fill·freeze·numFmt) |
| `src/components/table/TableToolbar.tsx` | Create | 검색 입력 · 정당 가시성 dropdown · CSV/XLSX 버튼 · xlsx 실패 inline 메시지 |
| `src/components/table/AdvancedTable.tsx` | Create | `useReactTable` + thead/tbody 렌더 + sticky 첫 열 + 셀 포맷 |
| `src/components/TimeseriesPanel.tsx` | Modify | `HomeTable` 교체 → `AdvancedTable` + `TableToolbar` |
| `src/components/HomeTable.tsx` | Delete | AdvancedTable 로 대체 |

`AdvancedTable` 은 TanStack hook 의 셀 정렬·필터·가시성 상태만 빌리고, 마크업은 우리 디자인 그대로. `buildTableModel` 은 ChartRow/ChartLine 을 받아 `TableModel` 로 변환하는 어댑터 — 차후 Phase 6.2 의 지역 모드는 같은 함수에 분기 추가.

---

## Task 1: 의존성 추가

**Files:**
- Modify: `package.json`

- [ ] **Step 1: dependency 추가**

```bash
cd /Users/ahbaik/coding/ourstory
pnpm add @tanstack/react-table exceljs
```

- [ ] **Step 2: 설치 확인**

```bash
node -e "console.log(require('@tanstack/react-table/package.json').version, require('exceljs/package.json').version)"
```

Expected: TanStack `8.x`, exceljs `4.x` 출력

- [ ] **Step 3: lint·typecheck PASS 확인**

```bash
pnpm lint
pnpm exec tsc --noEmit
```

Expected: 두 명령 모두 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add package.json pnpm-lock.yaml
git commit -m "deps: @tanstack/react-table v8 · exceljs 추가 (AdvancedTable 기반)"
```

---

## Task 2: 보조 타입 정의

**Files:**
- Create: `src/components/table/AdvancedTable.types.ts`

- [ ] **Step 1: 디렉터리 생성 + 타입 파일 작성**

```bash
mkdir -p /Users/ahbaik/coding/ourstory/src/components/table
mkdir -p /Users/ahbaik/coding/ourstory/src/lib/table
```

`src/components/table/AdvancedTable.types.ts`:

```ts
// AdvancedTable 공용 타입. spec § "보조 타입 정의" 참조.

export type Mode = "timeseries" | "region";

// SortState 는 Phase 6.2 의 URL 쿼리(?sort=정의:desc) ↔ state 변환용.
// Plan 1 에서는 AdvancedTable 내부에서 TanStack 의 SortingState 를 직접 쓰므로
// 정의만 해두고 사용은 Phase 6.2 에서.
export type SortState = { colId: string; dir: "asc" | "desc" };

export interface ColumnDef {
  id: string;               // partyId 또는 "rowLabel"
  header: string;           // 표시명
  color?: string;           // 정당색 (parties.json)
  isJusticeParty?: boolean;
  align?: "left" | "right";
}

export interface RowData {
  id: string;               // electionId(시계열) 또는 regionCode(지역, Phase 6.2)
  label: string;            // 행 라벨
  href?: string;            // drilldown 링크 (지역 모드 — Phase 6.2)
  cells: Record<string, number | null>; // colId → 득표율 (null = 미출마)
}

export interface TableModel {
  columns: ColumnDef[];
  rows: RowData[];
  meta: {
    mode: Mode;
    regionName: string;
    electionLabel?: string;
  };
}
```

- [ ] **Step 2: typecheck**

```bash
cd /Users/ahbaik/coding/ourstory && pnpm exec tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/table/AdvancedTable.types.ts
git commit -m "table: AdvancedTable 보조 타입 정의 (SortState·ColumnDef·RowData·TableModel)"
```

---

## Task 3: buildTableModel — timeseries 모드 (TDD)

**Files:**
- Create: `src/lib/table/buildTableModel.ts`
- Create: `src/lib/table/buildTableModel.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/table/buildTableModel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildTableModel } from "./buildTableModel";
import type { ChartRow, ChartLine } from "../series";

const lines: ChartLine[] = [
  { partyId: "민주", name: "민주당", color: "#004EA2" },
  { partyId: "국힘", name: "국민의힘", color: "#E61E2B" },
  { partyId: "justice", name: "정의당", color: "#FFCC00" },
];

const rows: ChartRow[] = [
  { electionId: "2014-local", electionLabel: "2014 제6회 지방(비례)", 민주: 35.1, 국힘: 40.4, justice: 8.2 },
  { electionId: "2016-general", electionLabel: "2016 제20대 총선", 민주: 37.2, 국힘: 38.5, justice: 7.4 },
];

describe("buildTableModel — timeseries 모드", () => {
  it("rows 는 ChartRow 순서대로 (시간순 유지)", () => {
    const m = buildTableModel("timeseries", { rows, lines, regionName: "진주시" });
    expect(m.rows.map((r) => r.id)).toEqual(["2014-local", "2016-general"]);
  });

  it("첫 컬럼은 rowLabel, 정의당이 그 다음 (강제 우선 + 정의당색)", () => {
    const m = buildTableModel("timeseries", { rows, lines, regionName: "진주시" });
    expect(m.columns[0]).toEqual({ id: "rowLabel", header: "선거", align: "left" });
    expect(m.columns[1].id).toBe("justice");
    expect(m.columns[1].isJusticeParty).toBe(true);
    expect(m.columns[1].color).toBe("#FFCC00");
  });

  it("정의당 외 정당은 lines 입력 순서 유지", () => {
    const m = buildTableModel("timeseries", { rows, lines, regionName: "진주시" });
    expect(m.columns.slice(2).map((c) => c.id)).toEqual(["민주", "국힘"]);
  });

  it("cells 는 ChartRow 의 값 그대로 — 숫자는 숫자, 그 외는 null", () => {
    const r = buildTableModel("timeseries", { rows, lines, regionName: "진주시" }).rows[0];
    expect(r.cells["justice"]).toBe(8.2);
    expect(r.cells["민주"]).toBe(35.1);
    expect(r.cells["국힘"]).toBe(40.4);
  });

  it("미출마 셀 (ChartRow 에 키 없음) → null", () => {
    const partial: ChartRow[] = [{ electionId: "x", electionLabel: "X" } as ChartRow];
    const m = buildTableModel("timeseries", { rows: partial, lines, regionName: "진주시" });
    expect(m.rows[0].cells["justice"]).toBeNull();
    expect(m.rows[0].cells["민주"]).toBeNull();
  });

  it("ChartRow 에 string 값 (예: '미출마') 들어와도 null 로 정규화", () => {
    const dirty: ChartRow[] = [
      { electionId: "y", electionLabel: "Y", justice: "미출마" as unknown as number, 민주: 10 },
    ];
    const m = buildTableModel("timeseries", { rows: dirty, lines, regionName: "진주시" });
    expect(m.rows[0].cells["justice"]).toBeNull();
    expect(m.rows[0].cells["민주"]).toBe(10);
  });

  it("meta 에 mode·regionName 반영", () => {
    const m = buildTableModel("timeseries", { rows, lines, regionName: "진주시" });
    expect(m.meta.mode).toBe("timeseries");
    expect(m.meta.regionName).toBe("진주시");
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd /Users/ahbaik/coding/ourstory && pnpm test buildTableModel
```

Expected: FAIL — "Cannot find module './buildTableModel'"

- [ ] **Step 3: 최소 구현**

`src/lib/table/buildTableModel.ts`:

```ts
import type { ChartRow, ChartLine } from "../series";
import type { Mode, TableModel, ColumnDef, RowData } from "@/components/table/AdvancedTable.types";

interface TimeseriesCtx {
  rows: ChartRow[];
  lines: ChartLine[];
  regionName: string;
}

// timeseries 모드 — ChartRow/ChartLine 을 TableModel 로 어댑트.
// Phase 6.2 에서 region 모드 분기 추가 예정.
export function buildTableModel(mode: Mode, ctx: TimeseriesCtx): TableModel {
  if (mode !== "timeseries") {
    throw new Error(`mode ${mode} 는 Phase 6.2 에서 지원`);
  }

  const { rows, lines, regionName } = ctx;

  // 컬럼: rowLabel + 정의당 강제 우선 + 나머지 lines 순서
  const justiceLine = lines.find((l) => l.partyId === "justice");
  const otherLines = lines.filter((l) => l.partyId !== "justice");

  const columns: ColumnDef[] = [
    { id: "rowLabel", header: "선거", align: "left" },
    ...(justiceLine
      ? [{
          id: "justice",
          header: justiceLine.name,
          color: justiceLine.color,
          isJusticeParty: true,
          align: "right" as const,
        }]
      : []),
    ...otherLines.map((l) => ({
      id: l.partyId,
      header: l.name,
      color: l.color,
      align: "right" as const,
    })),
  ];

  // rows: ChartRow → RowData. 미출마/잘못된 값 = null
  const rowData: RowData[] = rows.map((r) => {
    const cells: Record<string, number | null> = {};
    for (const l of lines) {
      const v = r[l.partyId];
      cells[l.partyId] = typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    return { id: r.electionId, label: r.electionLabel, cells };
  });

  return {
    columns,
    rows: rowData,
    meta: { mode, regionName },
  };
}
```

- [ ] **Step 4: 테스트 실행 — PASS 확인**

```bash
pnpm test buildTableModel
```

Expected: 7 테스트 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/table/buildTableModel.ts src/lib/table/buildTableModel.test.ts
git commit -m "table: buildTableModel timeseries 모드 (ChartRow/Line → TableModel, 정의당 우선)"
```

---

## Task 4: cellFormatting 헬퍼 (TDD)

**Files:**
- Create: `src/lib/table/cellFormatting.ts`
- Create: `src/lib/table/cellFormatting.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/table/cellFormatting.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { justiceCellBg, partyHeaderStyle, formatCell } from "./cellFormatting";

describe("justiceCellBg — 정의당 % → 노란색 알파", () => {
  it("0 또는 null → transparent", () => {
    expect(justiceCellBg(0)).toBe("transparent");
    expect(justiceCellBg(null)).toBe("transparent");
  });
  it("10% → 중간 농도, 50%+ → 진한 농도", () => {
    expect(justiceCellBg(10)).toMatch(/^rgba\(255, 204, 0, 0\.[12]\d*\)$/);
    expect(justiceCellBg(50)).toMatch(/^rgba\(255, 204, 0, 0\.[6789]\d*\)$/);
  });
});

describe("partyHeaderStyle — 정당색 strip", () => {
  it("정당색 → borderTopColor·borderTopWidth 3", () => {
    expect(partyHeaderStyle("#004EA2")).toEqual({ borderTopColor: "#004EA2", borderTopWidth: 3 });
  });
  it("undefined 색 → 빈 객체", () => {
    expect(partyHeaderStyle(undefined)).toEqual({});
  });
});

describe("formatCell — 셀 표시 텍스트", () => {
  it("숫자 → 소수 1자리 + %", () => expect(formatCell(5.347)).toBe("5.3%"));
  it("0 → 0.0%", () => expect(formatCell(0)).toBe("0.0%"));
  it("null → '—'", () => expect(formatCell(null)).toBe("—"));
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
pnpm test cellFormatting
```

Expected: FAIL — module not found

- [ ] **Step 3: 구현**

`src/lib/table/cellFormatting.ts`:

```ts
// 정당색 헤더, 정의당 셀 그라데이션, 미출마 셀 표시 — AdvancedTable·exportXlsx 공용.

export function justiceCellBg(value: number | null): string {
  if (value == null || value <= 0) return "transparent";
  // 0~50% 를 0.1~0.9 알파로 매핑. clamp.
  const alpha = Math.min(0.9, 0.1 + (value / 50) * 0.8);
  return `rgba(255, 204, 0, ${alpha})`;
}

export function partyHeaderStyle(color: string | undefined): React.CSSProperties {
  return color ? { borderTopColor: color, borderTopWidth: 3 } : {};
}

export function formatCell(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}
```

- [ ] **Step 4: 테스트 실행 — PASS**

```bash
pnpm test cellFormatting
```

Expected: 7 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/table/cellFormatting.ts src/lib/table/cellFormatting.test.ts
git commit -m "table: cellFormatting — 정의당 그라데이션·정당색 헤더·미출마(—) 표시"
```

---

## Task 5: exportCsv — HomeTable 의 downloadCsv 이관 (TDD)

**Files:**
- Create: `src/lib/table/exportCsv.ts`
- Create: `src/lib/table/exportCsv.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/table/exportCsv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCsvString } from "./exportCsv";
import type { TableModel } from "@/components/table/AdvancedTable.types";

const model: TableModel = {
  columns: [
    { id: "rowLabel", header: "선거", align: "left" },
    { id: "justice", header: "정의당", color: "#FFCC00", isJusticeParty: true, align: "right" },
    { id: "민주", header: "민주당", color: "#004EA2", align: "right" },
  ],
  rows: [
    { id: "2014", label: "2014 제6회 지방", cells: { justice: 8.2, 민주: 35.1 } },
    { id: "2020", label: 'A "특수" 케이스', cells: { justice: null, 민주: 10 } },
  ],
  meta: { mode: "timeseries", regionName: "진주시" },
};

describe("buildCsvString", () => {
  it("UTF-8 BOM 으로 시작", () => {
    const s = buildCsvString(model);
    expect(s.charCodeAt(0)).toBe(0xfeff);
  });

  it("헤더 첫 줄 = 컬럼 header 들", () => {
    const s = buildCsvString(model);
    const firstLine = s.split("\n")[0].slice(1); // BOM 제거
    expect(firstLine).toBe('"선거","정의당","민주당"');
  });

  it("따옴표 escape 처리 ('A \"특수\" 케이스' → 'A \"\"특수\"\" 케이스')", () => {
    const s = buildCsvString(model);
    expect(s).toContain('"A ""특수"" 케이스"');
  });

  it("미출마 셀 (null) → 빈 문자열", () => {
    const s = buildCsvString(model);
    const secondRow = s.split("\n")[2]; // BOM 줄, 헤더, 첫 데이터 ... 두 번째 데이터
    expect(secondRow).toBe('"A ""특수"" 케이스","","10.0"');
  });
});
```

- [ ] **Step 2: 실행 — 실패 확인**

```bash
pnpm test exportCsv
```

Expected: FAIL

- [ ] **Step 3: 구현**

`src/lib/table/exportCsv.ts`:

```ts
import type { TableModel } from "@/components/table/AdvancedTable.types";

// TableModel → CSV 문자열 (BOM 포함). 호출자가 Blob → a.download 처리.
// HomeTable.tsx 의 downloadCsv 로직을 모델 기반으로 이관.
export function buildCsvString(model: TableModel): string {
  const head = model.columns.map((c) => c.header);
  const body = model.rows.map((r) => [
    r.label,
    ...model.columns
      .filter((c) => c.id !== "rowLabel")
      .map((c) => {
        const v = r.cells[c.id];
        return typeof v === "number" ? v.toFixed(1) : "";
      }),
  ]);

  const csv = [head, ...body]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  return "﻿" + csv;
}

// 브라우저 다운로드 트리거. 테스트 대상 외 — buildCsvString 만 단위 테스트.
export function downloadCsv(model: TableModel, filename: string): void {
  const csv = buildCsvString(model);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: 테스트 PASS 확인**

```bash
pnpm test exportCsv
```

Expected: 4 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/table/exportCsv.ts src/lib/table/exportCsv.test.ts
git commit -m "table: exportCsv — TableModel → CSV (UTF-8 BOM, downloadCsv 로직 이관)"
```

---

## Task 6: exportXlsx — exceljs lazy + 서식 (TDD)

**Files:**
- Create: `src/lib/table/exportXlsx.ts`
- Create: `src/lib/table/exportXlsx.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/table/exportXlsx.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildWorkbook } from "./exportXlsx";
import type { TableModel } from "@/components/table/AdvancedTable.types";

const model: TableModel = {
  columns: [
    { id: "rowLabel", header: "선거", align: "left" },
    { id: "justice", header: "정의당", color: "#FFCC00", isJusticeParty: true, align: "right" },
    { id: "민주", header: "민주당", color: "#004EA2", align: "right" },
  ],
  rows: [
    { id: "2014", label: "2014 제6회 지방", cells: { justice: 8.2, 민주: 35.1 } },
    { id: "2020", label: "2020 제21대 총선", cells: { justice: null, 민주: 39.8 } },
  ],
  meta: { mode: "timeseries", regionName: "진주시" },
};

describe("buildWorkbook (lazy exceljs)", () => {
  it("워크북에 한 시트 생성 — 시트명 = '시계열_{regionName}'", async () => {
    const wb = await buildWorkbook(model);
    const names = wb.worksheets.map((ws) => ws.name);
    expect(names).toEqual(["시계열_진주시"]);
  });

  it("헤더 fill color 가 정당색 (정의당 = FFCC00, 민주 = 004EA2)", async () => {
    const wb = await buildWorkbook(model);
    const ws = wb.worksheets[0];
    const r1 = ws.getRow(1);
    // 첫 셀(선거) 는 fill 없음. 정의당(2번째), 민주(3번째) 는 fill 있음.
    expect((r1.getCell(2).fill as { fgColor?: { argb?: string } })?.fgColor?.argb).toBe("FFFFCC00");
    expect((r1.getCell(3).fill as { fgColor?: { argb?: string } })?.fgColor?.argb).toBe("FF004EA2");
  });

  it("freeze: ySplit=1, xSplit=1 (헤더·첫 열 고정)", async () => {
    const wb = await buildWorkbook(model);
    const view = wb.worksheets[0].views?.[0];
    expect(view).toMatchObject({ state: "frozen", xSplit: 1, ySplit: 1 });
  });

  it("숫자 셀 numFmt = '0.0', 미출마 셀은 빈 값", async () => {
    const wb = await buildWorkbook(model);
    const ws = wb.worksheets[0];
    const dataRow2 = ws.getRow(3); // header(1) + 2014(2) + 2020(3)
    expect(dataRow2.getCell(2).value).toBeNull(); // 정의당 미출마
    expect(dataRow2.getCell(3).value).toBe(39.8);
    expect(dataRow2.getCell(3).numFmt).toBe("0.0");
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm test exportXlsx
```

Expected: FAIL

- [ ] **Step 3: 구현**

`src/lib/table/exportXlsx.ts`:

```ts
import type { TableModel } from "@/components/table/AdvancedTable.types";

// 색 hex (예: #FFCC00) → exceljs argb (예: FFFFCC00).  #-제거 + 알파 FF prepend.
function toArgb(hex: string): string {
  const clean = hex.replace(/^#/, "").toUpperCase();
  return `FF${clean}`;
}

// 빌드만 — 다운로드 트리거는 downloadXlsx. 테스트는 buildWorkbook 만 검증.
export async function buildWorkbook(model: TableModel) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const sheetName = `${model.meta.mode === "timeseries" ? "시계열" : "지역"}_${model.meta.regionName}`;
  const ws = wb.addWorksheet(sheetName.slice(0, 31)); // Excel 시트명 31자 제한

  // 헤더
  const headerRow = ws.addRow(model.columns.map((c) => c.header));
  model.columns.forEach((c, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.font = { bold: true };
    if (c.color) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: toArgb(c.color) },
      };
      cell.font = { ...cell.font, color: { argb: "FFFFFFFF" } };
    }
  });

  // 데이터 행
  for (const r of model.rows) {
    const values: (string | number | null)[] = [r.label];
    for (const c of model.columns) {
      if (c.id === "rowLabel") continue;
      const v = r.cells[c.id];
      values.push(typeof v === "number" ? v : null);
    }
    const row = ws.addRow(values);
    model.columns.forEach((c, idx) => {
      if (c.id === "rowLabel") return;
      const cell = row.getCell(idx + 1);
      const v = r.cells[c.id];
      if (typeof v === "number") cell.numFmt = "0.0";
      if (c.isJusticeParty && typeof v === "number" && v > 0) {
        // 정의당 셀: 노란색 알파. exceljs 는 RGBA 직접 안 됨 — 강도별 hex 사용.
        const alpha = Math.min(0.9, 0.1 + (v / 50) * 0.8);
        // 흰색 ↔ #FFCC00 사이 보간. 알파 0~1 → 흰색 비율 (1-alpha).
        const r2 = Math.round(255 * (1 - alpha) + 255 * alpha);
        const g2 = Math.round(255 * (1 - alpha) + 204 * alpha);
        const b2 = Math.round(255 * (1 - alpha) + 0 * alpha);
        const hex = `${r2.toString(16).padStart(2, "0")}${g2.toString(16).padStart(2, "0")}${b2.toString(16).padStart(2, "0")}`.toUpperCase();
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: `FF${hex}` },
        };
      }
    });
  }

  // 열 너비
  ws.columns = model.columns.map((c) => ({
    width: c.id === "rowLabel" ? 28 : 12,
  }));

  // freeze: 첫 행·첫 열 고정
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];

  return wb;
}

// 브라우저 다운로드 트리거.
export async function downloadXlsx(model: TableModel, filename: string): Promise<void> {
  const wb = await buildWorkbook(model);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: 테스트 PASS 확인**

```bash
pnpm test exportXlsx
```

Expected: 4 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/table/exportXlsx.ts src/lib/table/exportXlsx.test.ts
git commit -m "table: exportXlsx — exceljs lazy import, 정당색 헤더·정의당 그라데이션·freeze·numFmt"
```

---

## Task 7: TableToolbar 컴포넌트

**Files:**
- Create: `src/components/table/TableToolbar.tsx`

- [ ] **Step 1: 작성**

`src/components/table/TableToolbar.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { TableModel } from "./AdvancedTable.types";
import { downloadCsv } from "@/lib/table/exportCsv";
import { downloadXlsx } from "@/lib/table/exportXlsx";

interface Props {
  model: TableModel;
  search: string;
  visibility: Record<string, boolean>;
  onSearchChange: (next: string) => void;
  onVisibilityChange: (next: Record<string, boolean>) => void;
  csvFilename: string;
  xlsxFilename: string;
}

export function TableToolbar({
  model,
  search,
  visibility,
  onSearchChange,
  onVisibilityChange,
  csvFilename,
  xlsxFilename,
}: Props) {
  const [xlsxError, setXlsxError] = useState<string | null>(null);
  const [xlsxLoading, setXlsxLoading] = useState(false);

  const handleXlsx = async () => {
    setXlsxError(null);
    setXlsxLoading(true);
    try {
      await downloadXlsx(model, xlsxFilename);
    } catch (err) {
      console.error("xlsx export 실패", err);
      setXlsxError("엑셀 라이브러리 로드 실패 — CSV 로 받아보세요");
    } finally {
      setXlsxLoading(false);
    }
  };

  const partyCols = model.columns.filter((c) => c.id !== "rowLabel");

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="행 검색"
        className="px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 w-40"
        aria-label="표 행 검색"
      />

      <details className="relative">
        <summary className="cursor-pointer px-3 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
          정당 ({partyCols.filter((c) => visibility[c.id] !== false).length}/{partyCols.length})
        </summary>
        <div className="absolute z-20 mt-1 p-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded shadow max-h-64 overflow-auto whitespace-nowrap">
          {partyCols.map((c) => (
            <label key={c.id} className="flex items-center gap-1 text-sm py-0.5">
              <input
                type="checkbox"
                checked={visibility[c.id] !== false}
                onChange={(e) => onVisibilityChange({ ...visibility, [c.id]: e.target.checked })}
              />
              <span
                className="inline-block w-2 h-2 rounded-sm"
                style={{ backgroundColor: c.color }}
                aria-hidden
              />
              {c.header}
            </label>
          ))}
        </div>
      </details>

      <button
        type="button"
        onClick={() => downloadCsv(model, csvFilename)}
        disabled={model.rows.length === 0}
        className="px-3 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-50"
      >
        CSV 저장
      </button>

      <button
        type="button"
        onClick={handleXlsx}
        disabled={model.rows.length === 0 || xlsxLoading}
        className="px-3 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-50"
      >
        {xlsxLoading ? "준비 중…" : "엑셀(.xlsx) 저장"}
      </button>

      {xlsxError && (
        <span role="alert" className="text-sm text-red-600 dark:text-red-400">
          {xlsxError}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
cd /Users/ahbaik/coding/ourstory && pnpm exec tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/table/TableToolbar.tsx
git commit -m "table: TableToolbar — 검색·정당 가시성·CSV·XLSX(에러 inline)"
```

---

## Task 8: AdvancedTable 컴포넌트 (TDD)

**Files:**
- Create: `src/components/table/AdvancedTable.tsx`

이 컴포넌트는 useReactTable 의 상태 관리를 빌려와 thead/tbody 렌더. 단위 테스트는 RTL 미도입이라 Playwright smoke (Task 10) 으로 검증.

- [ ] **Step 1: 작성**

`src/components/table/AdvancedTable.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import type { TableModel, RowData } from "./AdvancedTable.types";
import { formatCell, justiceCellBg, partyHeaderStyle } from "@/lib/table/cellFormatting";

interface Props {
  model: TableModel;
  sort: SortingState;
  visibility: Record<string, boolean>;
  globalFilter: string;
  onSortChange: (next: SortingState) => void;
  onVisibilityChange: (next: Record<string, boolean>) => void;
}

const columnHelper = createColumnHelper<RowData>();

export function AdvancedTable({
  model,
  sort,
  visibility,
  globalFilter,
  onSortChange,
  onVisibilityChange,
}: Props) {
  const columns = useMemo(
    () =>
      model.columns.map((c) => {
        if (c.id === "rowLabel") {
          return columnHelper.accessor((row) => row.label, {
            id: c.id,
            header: c.header,
            cell: (info) => info.getValue<string>(),
            sortingFn: "alphanumeric",
          });
        }
        return columnHelper.accessor((row) => row.cells[c.id] ?? null, {
          id: c.id,
          header: c.header,
          cell: (info) => formatCell(info.getValue<number | null>()),
          sortingFn: (a, b, colId) => {
            const av = a.original.cells[colId];
            const bv = b.original.cells[colId];
            // null 은 항상 뒤 (정렬 방향 무관)
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            return av - bv;
          },
        });
      }),
    [model.columns]
  );

  const table = useReactTable({
    data: model.rows,
    columns,
    state: {
      sorting: sort,
      columnVisibility: visibility,
      globalFilter,
    },
    onSortingChange: (updater) =>
      onSortChange(typeof updater === "function" ? updater(sort) : updater),
    onColumnVisibilityChange: (updater) =>
      onVisibilityChange(typeof updater === "function" ? updater(visibility) : updater),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _, filterValue: string) => {
      if (!filterValue) return true;
      return row.original.label.toLowerCase().includes(filterValue.toLowerCase());
    },
  });

  const rows = table.getRowModel().rows;
  if (rows.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-sm text-zinc-500">
        선택된 필터에 해당하는 데이터가 없습니다.
      </div>
    );
  }

  return (
    <div className="overflow-auto border border-zinc-200 dark:border-zinc-700 rounded">
      <table className="min-w-full text-sm border-collapse">
        <thead className="bg-zinc-50 dark:bg-zinc-800 sticky top-0 z-20">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const colDef = model.columns.find((c) => c.id === h.column.id);
                const isFirstCol = h.column.id === "rowLabel";
                const sorted = h.column.getIsSorted();
                return (
                  <th
                    key={h.id}
                    onClick={h.column.getToggleSortingHandler()}
                    style={partyHeaderStyle(colDef?.color)}
                    className={
                      "border border-zinc-200 dark:border-zinc-700 px-2 py-1 whitespace-nowrap cursor-pointer select-none " +
                      (isFirstCol
                        ? "text-left sticky left-0 bg-zinc-50 dark:bg-zinc-800 z-30 "
                        : "text-right ")
                    }
                  >
                    {!isFirstCol && colDef?.color && (
                      <span
                        className="inline-block w-2 h-2 rounded-sm mr-1 align-middle"
                        style={{ backgroundColor: colDef.color }}
                        aria-hidden
                      />
                    )}
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {sorted === "asc" ? " ▲" : sorted === "desc" ? " ▼" : ""}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
              {row.getVisibleCells().map((cell) => {
                const colDef = model.columns.find((c) => c.id === cell.column.id);
                const isFirstCol = cell.column.id === "rowLabel";
                const value = row.original.cells[cell.column.id] ?? null;
                const bg = colDef?.isJusticeParty ? justiceCellBg(value) : undefined;
                return (
                  <td
                    key={cell.id}
                    style={{
                      ...(bg ? { backgroundColor: bg } : {}),
                      ...(colDef?.isJusticeParty ? { fontWeight: 600 } : {}),
                    }}
                    className={
                      "border border-zinc-200 dark:border-zinc-700 px-2 py-1 tabular-nums whitespace-nowrap " +
                      (isFirstCol
                        ? "text-left sticky left-0 bg-white dark:bg-zinc-950 z-10 "
                        : "text-right ")
                    }
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/table/AdvancedTable.tsx
git commit -m "table: AdvancedTable — useReactTable + sticky 첫 열·헤더 + 정의당 그라데이션·정렬 화살표"
```

---

## Task 9: TimeseriesPanel 교체

기존 `HomeTable` 호출을 `AdvancedTable` + `TableToolbar` 로 교체. 차트 모드는 그대로.

**Files:**
- Modify: `src/components/TimeseriesPanel.tsx`

- [ ] **Step 1: 전면 재작성**

`src/components/TimeseriesPanel.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { SortingState } from "@tanstack/react-table";
import { HomeChart } from "./HomeChart";
import { AdvancedTable } from "./table/AdvancedTable";
import { TableToolbar } from "./table/TableToolbar";
import { buildTableModel } from "@/lib/table/buildTableModel";
import type { ChartRow, ChartLine } from "../lib/series";

interface Props {
  data: ChartRow[];
  lines: ChartLine[];
  regionName?: string; // 시트명·파일명에 사용
}

// 차트/표 토글 + AdvancedTable + 다운로드 버튼. 홈·region 페이지 둘 다 사용.
export function TimeseriesPanel({ data, lines, regionName = "전국" }: Props) {
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");
  const [sort, setSort] = useState<SortingState>([]);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  const model = useMemo(
    () => buildTableModel("timeseries", { rows: data, lines, regionName }),
    [data, lines, regionName]
  );

  const safeName = regionName.replace(/[/\\?%*:|"<>]/g, "_");
  const csvFilename = `시계열_${safeName}.csv`;
  const xlsxFilename = `시계열_${safeName}.xlsx`;

  return (
    <>
      <div className="flex items-center gap-1 flex-wrap">
        <div className="inline-flex rounded border border-zinc-300 dark:border-zinc-700 overflow-hidden">
          <button
            type="button"
            onClick={() => setViewMode("chart")}
            className={`px-3 py-1 text-sm ${
              viewMode === "chart"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-white text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
            }`}
            aria-pressed={viewMode === "chart"}
          >
            차트
          </button>
          <button
            type="button"
            onClick={() => setViewMode("table")}
            className={`px-3 py-1 text-sm border-l border-zinc-300 dark:border-zinc-700 ${
              viewMode === "table"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-white text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
            }`}
            aria-pressed={viewMode === "table"}
          >
            표
          </button>
        </div>
      </div>

      {viewMode === "chart" ? (
        <HomeChart data={data} lines={lines} />
      ) : (
        <>
          <TableToolbar
            model={model}
            search={search}
            visibility={visibility}
            onSearchChange={setSearch}
            onVisibilityChange={setVisibility}
            csvFilename={csvFilename}
            xlsxFilename={xlsxFilename}
          />
          <AdvancedTable
            model={model}
            sort={sort}
            visibility={visibility}
            globalFilter={search}
            onSortChange={setSort}
            onVisibilityChange={setVisibility}
          />
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: 호출처가 prop `csvFilename` 을 보내고 있었는지 확인**

```bash
cd /Users/ahbaik/coding/ourstory && grep -rn "TimeseriesPanel" src/ | grep -v "\.tsx:[0-9]*:export"
```

Expected: HomeView·RegionTimeseries 가 csvFilename 을 넘기는 경우 → 다음 Step 에서 `regionName` 으로 인자명 교체

- [ ] **Step 3: 호출처 prop 교체 — HomeView**

`src/components/HomeView.tsx` 의 65줄 부근(`<TimeseriesPanel data={data} lines={lines} />`) 변경:

```diff
+  const regionName = useMemo(() => {
+    const code = optimisticState.region;
+    if (!code || code === "all") return "전국";
+    return (
+      emdOptions.find((e) => e.code === code)?.name ??
+      filterOptions.regions.find((r) => r.code === code)?.name ??
+      "전국"
+    );
+  }, [optimisticState.region, filterOptions.regions, emdOptions]);
+
-  <TimeseriesPanel data={data} lines={lines} />
+  <TimeseriesPanel data={data} lines={lines} regionName={regionName} />
```

`station:` 형식 region 은 매칭 미실패 시 "전국" 으로 fallback — 파일명만 약간 어색해질 뿐 동작에는 영향 없음. 정확한 station 이름 도출은 후속 작업.

- [ ] **Step 4: 호출처 prop 교체 — RegionTimeseries**

`src/components/region/RegionTimeseries.tsx` 의 94~98줄 변경:

```diff
   <TimeseriesPanel
     data={data}
     lines={lines}
-    csvFilename={`timeseries-${regionName}.csv`}
+    regionName={regionName}
   />
```

`regionName` 은 RegionTimeseries 가 이미 prop 으로 받고 있어 추가 작업 없음.

- [ ] **Step 5: lint + typecheck + 단위 테스트 PASS 확인**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```

Expected: 모두 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/components/TimeseriesPanel.tsx src/components/HomeView.tsx src/components/region/RegionTimeseries.tsx
git commit -m "table: TimeseriesPanel 이 AdvancedTable + TableToolbar 렌더 (HomeTable 호출 제거)"
```

---

## Task 10: HomeTable 삭제

**Files:**
- Delete: `src/components/HomeTable.tsx`

- [ ] **Step 1: 남은 참조 검색**

```bash
cd /Users/ahbaik/coding/ourstory && grep -rn "HomeTable\|downloadCsv" src/ | grep -v "exportCsv\|exportXlsx"
```

Expected: 결과 없음 (TimeseriesPanel 에서 이미 제거됨)

- [ ] **Step 2: 파일 삭제**

```bash
rm /Users/ahbaik/coding/ourstory/src/components/HomeTable.tsx
```

- [ ] **Step 3: 빌드 검증**

```bash
pnpm exec tsc --noEmit && pnpm test
```

Expected: 모두 PASS

- [ ] **Step 4: 커밋**

```bash
git add -u src/components/HomeTable.tsx
git commit -m "table: HomeTable 삭제 — AdvancedTable 로 완전 이관"
```

---

## Task 11: Playwright smoke (MCP plugin 사용)

`plugin_playwright_playwright__*` MCP 도구로 dev 서버에서 직접 시나리오 검증. 실패 시 시나리오 별 스크린샷 저장.

- [ ] **Step 1: dev 서버 띄우기**

```bash
cd /Users/ahbaik/coding/ourstory && pnpm dev &
```

`http://localhost:3000` 응답 200 확인.

- [ ] **Step 2: 시나리오 1 — 홈에서 표 모드 진입 + 헤더 정렬**

1. `browser_navigate` → `http://localhost:3000/?region=4800000000`
2. `browser_click` → `button[aria-pressed=false]` 중 "표" 라벨
3. AdvancedTable 표시 확인 (`browser_snapshot`)
4. "정의당" 열 헤더 클릭 → ▼ 표시 + 정의당 % 큰 행이 위로
5. 다시 클릭 → ▲ 표시 + 정의당 % 작은 행이 위로
6. 첫 열 sticky 가 가로 스크롤 시 남아있는지 확인

- [ ] **Step 3: 시나리오 2 — 정당 가시성 토글**

1. "정당" dropdown 열기
2. "민주당" 체크박스 해제 → 컬럼 사라짐 확인
3. 다시 체크 → 컬럼 복귀

- [ ] **Step 4: 시나리오 3 — 검색**

1. 검색 입력에 "2020" 타이핑
2. 행이 "2020" 들어간 것만 남는지 확인
3. 검색 비우면 모든 행 복귀

- [ ] **Step 5: 시나리오 4 — CSV 다운로드**

1. CSV 저장 클릭 → download 이벤트
2. 파일명 = `시계열_진주시.csv` 또는 그 region 이름 패턴
3. 파일 첫 줄에 BOM + 헤더 ("선거","정의당", ...) 포함

- [ ] **Step 6: 시나리오 5 — XLSX 다운로드**

1. "엑셀(.xlsx) 저장" 클릭 → "준비 중…" 표시 → 파일 다운로드
2. 파일명 = `시계열_<region>.xlsx`
3. 받은 파일을 Excel/Numbers/Google Sheets 중 하나로 열어 시트명·정당색 헤더·미출마 빈 셀 확인 (수동)

- [ ] **Step 7: 시나리오 6 — region 페이지 동작**

1. `browser_navigate` → `http://localhost:3000/region/4817000000?election=2024-general`
2. RegionTimeseries 안에서 "표" 모드 클릭 → AdvancedTable 동일 동작
3. CSV/XLSX 파일명에 region 이름(예: 진주시) 반영

- [ ] **Step 8: dev 서버 종료 + 결과 정리**

```bash
pkill -f "next dev"
```

스크린샷 6장(시나리오별) 을 `.playwright-mcp/` 에 저장.

- [ ] **Step 9: 커밋 (스크린샷 + 검증 노트)**

```bash
git add docs/superpowers/plans/2026-06-07-ourstory-phase-6.1-advanced-table-mvp.md
git commit -m "verify: AdvancedTable 6 시나리오 Playwright smoke PASS"
```

---

## Task 12: 수동 QA + 푸시

- [ ] **Step 1: 받은 .xlsx 를 Excel·Numbers·Google Sheets 에서 열기**

체크:
- 시트명 = `시계열_<region>` (한글 정상)
- 헤더 정당색 fill + 흰 글자
- 정의당 컬럼 노란색 그라데이션 (값 클수록 진함)
- 미출마 셀은 빈 셀 (0 아님)
- 첫 행·첫 열 freeze 동작
- 셀 numFmt `0.0` (5.3 등 표시)

- [ ] **Step 2: 모바일(375px) 가로 스크롤 확인**

`browser_resize` 375px → 첫 열 sticky 유지 + 정당 컬럼 가로 스크롤로 접근.

- [ ] **Step 3: 회귀 — 차트 모드·위성정당·기간 필터**

- 차트 모드 클릭 → 기존 HomeChart 동작 그대로
- 위성정당 합산 토글 → 차트·표 양쪽 일관
- 기간(from/to) 필터 → 차트·표 같은 결과

- [ ] **Step 4: main push**

```bash
cd /Users/ahbaik/coding/ourstory && git push
```

Vercel 자동 배포 → `https://jp-ourstory.vercel.app` 에서 새 표 동작 확인.

- [ ] **Step 5: PR 또는 commit 노트 추가**

`docs/changelog/` 또는 다음 phase plan 의 "선행" 으로 본 plan 완료 표시.

---

## 통과 기준

- 새 파일 라인 커버리지 80%+ (`buildTableModel`·`cellFormatting`·`exportCsv`·`exportXlsx` 단위 테스트)
- Playwright smoke 6 시나리오 PASS
- 받은 `.xlsx` 가 Excel·Numbers·Google Sheets 모두에서 시트명·정당색·고정 행/열·numFmt 동일하게 보임
- 차트 모드 회귀 없음 — 기존 HomeChart 그대로 작동
- 모바일 375px 가로 스크롤·sticky 첫 열 유지

## 후속 (Phase 6.2)

- 모드 토글 (시계열 ↔ 지역)
- 지역 모드 = 행=region children, 열=정당
- `childrenSnapshot` fetch — `region/{code}/page.tsx` 에 추가 query
- HeaderControls 가 모드에 따라 picker 활성/비활성
- URL `mode`·`sort`·`parties` 동기
- 셀 클릭 → drilldown 링크 (지역 모드)
- 비교 ↑/↓ 인디케이터 (직전 동종 선거 대비)
- Playwright smoke: 모드 토글 + 지역 모드 시나리오 추가
