// tests/unit/nec-fetch.test.ts
import { describe, it, expect } from "vitest";
import { cacheFilename } from "../../scripts/ingest/lib/nec-fetch";

describe("cacheFilename", () => {
  it("townCode 있으면 {election}-{city}-{town}.html", () => {
    expect(cacheFilename({
      electionId: "0000000000",
      electionType: "4",
      electionCode: "8",
      cityCode: "4800",
      townCode: "4803",
      endpoint: "VCCP08",
    })).toBe("0000000000-4800-4803.html");
  });

  it("townCode 없으면 {election}-{city}-all.html", () => {
    expect(cacheFilename({
      electionId: "0020250603",
      electionType: "1",
      electionCode: "1",
      cityCode: "4800",
      endpoint: "VCCP08",
    })).toBe("0020250603-4800-all.html");
  });
});
