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

  it("셀에 콤마가 있어도 CSV 열 경계가 깨지지 않음 — 따옴표 안에 안전 포함", () => {
    const m: TableModel = {
      ...model,
      rows: [{ id: "z", label: "A, B 와 C", cells: { justice: 1, 민주: 2 } }],
    };
    const s = buildCsvString(m);
    // 데이터 행 한 줄. 따옴표 안에 콤마.
    expect(s).toContain('"A, B 와 C","1.0","2.0"');
  });

  it("셀에 개행이 있어도 따옴표로 안전하게 둘러쌈", () => {
    const m: TableModel = {
      ...model,
      rows: [{ id: "w", label: "두\n줄 라벨", cells: { justice: 3, 민주: 4 } }],
    };
    const s = buildCsvString(m);
    expect(s).toContain('"두\n줄 라벨","3.0","4.0"');
  });
});
