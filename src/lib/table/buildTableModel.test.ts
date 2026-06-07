import { describe, it, expect } from "vitest";
import { buildTableModel } from "./buildTableModel";
import type { ChartRow, ChartLine } from "../series";

const lines: ChartLine[] = [
  { partyId: "민주", name: "민주당", color: "#004EA2", family: "demo" },
  { partyId: "국힘", name: "국민의힘", color: "#E61E2B", family: "conserv" },
  { partyId: "justice", name: "정의당", color: "#FFCC00", family: "justice" },
];

const rows: ChartRow[] = [
  { electionId: "2014-local", electionLabel: "2014 제6회 지방(비례)", date: "2014-06-04", displayOrder: 1, 민주: 35.1, 국힘: 40.4, justice: 8.2 },
  { electionId: "2016-general", electionLabel: "2016 제20대 총선", date: "2016-04-13", displayOrder: 2, 민주: 37.2, 국힘: 38.5, justice: 7.4 },
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
    const partial: ChartRow[] = [{ electionId: "x", electionLabel: "X", date: "", displayOrder: 0 } as ChartRow];
    const m = buildTableModel("timeseries", { rows: partial, lines, regionName: "진주시" });
    expect(m.rows[0].cells["justice"]).toBeNull();
    expect(m.rows[0].cells["민주"]).toBeNull();
  });

  it("ChartRow 에 string 값 (예: '미출마') 들어와도 null 로 정규화", () => {
    const dirty: ChartRow[] = [
      { electionId: "y", electionLabel: "Y", date: "", displayOrder: 0, justice: "미출마" as unknown as number, 민주: 10 },
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
