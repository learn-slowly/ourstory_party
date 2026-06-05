// tests/unit/build/build-index.test.ts
import { describe, it, expect } from "vitest";
import { buildIndex } from "../../../scripts/build/lib/build-index";

describe("buildIndex", () => {
  const idx = buildIndex();

  it("필수 election 포함 (대선·총선 등)", () => {
    expect(idx.elections.find((e) => e.id === "2024-general")).toBeDefined();
    expect(idx.elections.find((e) => e.id === "2025-presidential")).toBeDefined();
  });

  it("정당 메타 — justice/democratic/people_power 포함", () => {
    expect(idx.parties.find((p) => p.id === "justice")).toBeDefined();
    expect(idx.parties.find((p) => p.id === "democratic")).toBeDefined();
    expect(idx.parties.find((p) => p.id === "people_power")).toBeDefined();
  });

  it("regions — 시·도 17개", () => {
    expect(idx.regions.sido.length).toBe(17);
  });

  it("hasStationLevel — 대선/총선 true, 지선(governor 등) false", () => {
    const pres = idx.elections.find((e) => e.id === "2025-presidential");
    expect(pres?.hasStationLevel).toBe(true);

    const general = idx.elections.find((e) => e.id === "2024-general");
    expect(general?.hasStationLevel).toBe(true);

    const governor = idx.elections.find((e) => e.type === "governor");
    if (governor) expect(governor.hasStationLevel).toBe(false);

    const mayor = idx.elections.find((e) => e.type === "mayor");
    if (mayor) expect(mayor.hasStationLevel).toBe(false);
  });
});
