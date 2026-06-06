// tests/unit/static-data.test.ts
import { describe, it, expect } from "vitest";
import { getIndex, getRegionFile } from "../../src/lib/static-data";

describe("static-data", () => {
  it("index 로드 — elections > 0, parties > 0", async () => {
    const idx = await getIndex();
    expect(idx.elections.length).toBeGreaterThan(0);
    expect(idx.parties.length).toBeGreaterThan(0);
    expect(idx.regions.sido.length).toBe(17);
  });
  it("region — 서울특별시 (sido)", async () => {
    const f = await getRegionFile("1100000000");
    expect(f.code).toBe("1100000000");
    expect(f.level).toBe("sido");
    expect(f.name).toBe("서울특별시");
  });
  it("region — 종로구 (sigungu)", async () => {
    const f = await getRegionFile("1111000000");
    expect(f.code).toBe("1111000000");
    expect(f.level).toBe("sigungu");
    expect(f.parent?.name).toBe("서울특별시");
  });
});
