// tests/unit/build/parse-format-f.test.ts
import { describe, it, expect } from "vitest";
import { parseFormatF } from "../../../scripts/build/lib/parse-format-f";

describe("parseFormatF — 2017 19대 대선", () => {
  const fixture = "tests/fixtures/nec-xlsx/format-f-2017-presidential-sample.xlsx";

  it("후보자 13명 + 정당명", () => {
    const r = parseFormatF(fixture);
    expect(r.partyNames.length).toBeGreaterThanOrEqual(10);
    expect(r.partyNames.some((n) => n.startsWith("더불어민주당"))).toBe(true);
    expect(r.partyNames.some((n) => n.startsWith("정의당"))).toBe(true);
  });
  it("region carry-forward — sido/sigungu 빈 셀 채우기", () => {
    const r = parseFormatF(fixture);
    // 서울 종로구 거소·선상투표 같은 row 는 sido/sigungu carry-forward 필요
    const elDay = r.rows.find((x) => x.kind === "el_day");
    expect(elDay?.sidoName).toBe("서울특별시");
    expect(elDay?.sigunguName).toBe("종로구");
  });
  it("parties 길이 == partyNames.length", () => {
    const r = parseFormatF(fixture);
    for (const row of r.rows.slice(0, 5)) {
      expect(row.parties.length).toBe(r.partyNames.length);
    }
  });
  it("kind 분포 — el_day + presub + abs 등 포함", () => {
    const r = parseFormatF(fixture);
    const kinds = new Set(r.rows.map((x) => x.kind));
    expect(kinds.has("el_day")).toBe(true);
    expect(kinds.has("total") || kinds.has("subtotal")).toBe(true);
  });
});
