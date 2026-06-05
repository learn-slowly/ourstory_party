// tests/unit/build/parse-format-b.test.ts
import { describe, it, expect } from "vitest";
import { parseFormatB } from "../../../scripts/build/lib/parse-format-b";

describe("parseFormatB — 2020 영암", () => {
  const fixture = "tests/fixtures/nec-xlsx/format-b-2020-yeongam.xlsx";
  it("시트 메타 → 시·도·시·군·구", () => {
    const r = parseFormatB(fixture, { isProportional: false });
    expect(r.rows[0]?.sidoName).toBe("전라남도");
    expect(r.rows[0]?.sigunguName).toBe("영암군");
  });
  it("후보자 매핑", () => {
    const r = parseFormatB(fixture, { isProportional: false });
    expect(r.partyNames.some(n => n.startsWith("더불어민주당"))).toBe(true);
  });
  it("station row 존재 + emd carry-forward", () => {
    const r = parseFormatB(fixture, { isProportional: false });
    const stations = r.rows.filter(x => x.kind === "el_day");
    expect(stations.length).toBeGreaterThan(0);
    expect(stations[0].emdName).toBeTruthy();
  });
  it("kind 분포 — el_day · presub · abs · overseas 등 포함", () => {
    const r = parseFormatB(fixture, { isProportional: false });
    const kinds = new Set(r.rows.map((x) => x.kind));
    expect(kinds.has("el_day")).toBe(true);
    expect(kinds.has("presub")).toBe(true);
  });
  it("각 station 의 parties 배열 길이 == partyNames.length", () => {
    const r = parseFormatB(fixture, { isProportional: false });
    const stations = r.rows.filter((x) => x.kind === "el_day");
    for (const s of stations) expect(s.parties.length).toBe(r.partyNames.length);
  });
});
