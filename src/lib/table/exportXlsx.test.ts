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
