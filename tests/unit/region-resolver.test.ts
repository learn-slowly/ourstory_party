// region-resolver 통합 테스트 (라이브 DB 필요)
import { describe, it, expect } from "vitest";
import { createRegionResolver } from "../../scripts/ingest/lib/region-resolver";

describe("region-resolver (DB 필요)", () => {
  it("NEC cityCode=4800 → 경상남도 sido regions.code", async () => {
    const r = await createRegionResolver();
    const code = r.sidoCode("4800");
    expect(code).toBe("4800000000");
  });

  it("NEC cityCode=4800 + townCode=4803 → 진주시 sigungu regions.code", async () => {
    const r = await createRegionResolver();
    const code = await r.sigunguCode("4800", "4803");
    expect(code).toBe("4817000000");
  });

  it("진주시 sigungu (4817000000) + emdName=문산읍 → emd regions.code", async () => {
    const r = await createRegionResolver();
    const sgg = await r.sigunguCode("4800", "4803");
    expect(sgg).toBe("4817000000");
    const emd = r.emdCode(sgg!, "문산읍");
    expect(emd).toMatch(/^4817\d{6}$/); // 진주시 prefix 4817 + 6자리
  });
});
