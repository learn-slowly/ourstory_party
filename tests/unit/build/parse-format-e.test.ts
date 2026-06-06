import { describe, it, expect } from "vitest";
import { parseFormatE } from "../../../scripts/build/lib/parse-format-e";

describe("parseFormatE — archive HTML 폴백", () => {
  // 2017 대선 진주 archive 응답 (station × 후보자 분해 가능한 캐시)
  const cachePath = "data/raw/polling-stations/2017-presidential/0000000000-4800-4803.html";

  it("기존 2017 진주 응답 → ParsedStationRow 변환", async () => {
    const r = await parseFormatE(cachePath, { sidoName: "경상남도", sigunguName: "진주시" });
    expect(r.partyNames.some(n => n.startsWith("더불어민주당"))).toBe(true);
    expect(r.rows.length).toBeGreaterThan(0);
  });
  it("region 정보 외부에서 주입 (sidoName/sigunguName)", async () => {
    const r = await parseFormatE(cachePath, { sidoName: "경상남도", sigunguName: "진주시" });
    expect(r.rows[0].sidoName).toBe("경상남도");
    expect(r.rows[0].sigunguName).toBe("진주시");
  });
  it("station kind 매핑 — el_day 변환", async () => {
    const r = await parseFormatE(cachePath, { sidoName: "경상남도", sigunguName: "진주시" });
    const stations = r.rows.filter(x => x.kind === "el_day");
    expect(stations.length).toBeGreaterThan(0);
  });
});
