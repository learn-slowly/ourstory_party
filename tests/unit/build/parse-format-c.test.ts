// tests/unit/build/parse-format-c.test.ts
import { describe, it, expect } from "vitest";
import { parseFormatC } from "../../../scripts/build/lib/parse-format-c";

describe("parseFormatC — 2022 종로 재보궐", () => {
  const fixture = "tests/fixtures/nec-xlsx/format-c-2022-jongno.xlsx";

  it("region 추출", () => {
    const r = parseFormatC(fixture);
    const data = r.rows.find((x) => x.kind === "el_day");
    expect(data?.sidoName).toBe("서울특별시");
    expect(data?.sigunguName).toBe("종로구");
  });
  it("후보자 추출 — 최재형·배복주 등", () => {
    const r = parseFormatC(fixture);
    expect(r.partyNames.some((n) => n.startsWith("국민의힘"))).toBe(true);
    expect(r.partyNames.some((n) => n.startsWith("정의당"))).toBe(true);
  });
  it("kind 분포 — el_day + presub + abs 등", () => {
    const r = parseFormatC(fixture);
    const kinds = new Set(r.rows.map((x) => x.kind));
    expect(kinds.has("el_day")).toBe(true);
  });
  it("parties 길이 == partyNames.length", () => {
    const r = parseFormatC(fixture);
    const stations = r.rows.filter((x) => x.kind === "el_day");
    for (const s of stations) expect(s.parties.length).toBe(r.partyNames.length);
  });
});
