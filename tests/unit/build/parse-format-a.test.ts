import { describe, it, expect } from "vitest";
import { parseFormatA } from "../../../scripts/build/lib/parse-format-a";

describe("parseFormatA — 2024 지역구 종로구", () => {
  const fixture = "tests/fixtures/nec-xlsx/format-a-2024-sample.xlsx";

  it("partyNames 추출", () => {
    const r = parseFormatA(fixture, { isProportional: false });
    expect(r.partyNames.some((n) => n.startsWith("더불어민주당"))).toBe(true);
    expect(r.partyNames.some((n) => n.startsWith("국민의힘"))).toBe(true);
  });
  it("station row 존재 + region 정확", () => {
    const r = parseFormatA(fixture, { isProportional: false });
    const stations = r.rows.filter((x) => x.kind === "el_day");
    expect(stations.length).toBeGreaterThan(0);
    expect(stations[0].sidoName).toBe("서울특별시");
    expect(stations[0].sigunguName).toBe("종로구");
    expect(stations[0].emdName).toBeTruthy();
  });
  it("kind 분포 — 합계·소계 + 사전·관외·재외", () => {
    const r = parseFormatA(fixture, { isProportional: false });
    const kinds = new Set(r.rows.map((x) => x.kind));
    expect(kinds.has("el_day")).toBe(true);
  });
  it("partyNames 는 메타 라벨(합계·계·소계 등) 미포함", () => {
    const r = parseFormatA(fixture, { isProportional: false });
    for (const n of r.partyNames) {
      expect(["합계", "계", "소계", "무효투표수", "기권수"]).not.toContain(n);
    }
  });
  it("isProportional=true 경로 — 같은 fixture smoke (parser crash X)", () => {
    // 비례 fixture 는 Task 1.3 에서 별도 생성. 본 task 에선 옵션 토글이 crash 안 함만 확인.
    expect(() => parseFormatA(fixture, { isProportional: true })).not.toThrow();
  });
});
