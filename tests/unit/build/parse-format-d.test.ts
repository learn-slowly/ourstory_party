import { describe, it, expect } from "vitest";
import { parseFormatD } from "../../../scripts/build/lib/parse-format-d";

describe("parseFormatD — 2012 18대 대선", () => {
  const fixture = "tests/fixtures/nec-xlsx/format-d-2012-presidential.xls";

  it("후보자 추출 — 박근혜·문재인 등", () => {
    const r = parseFormatD(fixture);
    expect(r.partyNames.some(n => n.startsWith("새누리당"))).toBe(true);
    expect(r.partyNames.some(n => n.startsWith("민주통합당"))).toBe(true);
  });
  it("station row 다수 (전국 14k 가량)", () => {
    const r = parseFormatD(fixture);
    const stations = r.rows.filter(x => x.kind === "el_day");
    expect(stations.length).toBeGreaterThan(1000);
  });
  it("region carry-forward — 첫 station 의 sido 비어있지 않음", () => {
    const r = parseFormatD(fixture);
    const stations = r.rows.filter(x => x.kind === "el_day");
    expect(stations[0].sidoName).toBeTruthy();
    expect(stations[0].sigunguName).toBeTruthy();
  });
  it("parties 길이 == partyNames.length", () => {
    const r = parseFormatD(fixture);
    const stations = r.rows.filter(x => x.kind === "el_day");
    for (const s of stations.slice(0, 50)) {
      expect(s.parties.length).toBe(r.partyNames.length);
    }
  });
});
