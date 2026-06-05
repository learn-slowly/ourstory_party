import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseVccp04District } from "../../scripts/ingest/lib/nec-html";

const FX = path.join(__dirname, "..", "fixtures");

describe("parseVccp04District — 2024 진주 지역구", () => {
  it("ok 응답 + 두 개 이상의 선거구 (진주시갑·진주시을 등)", async () => {
    const html = await readFile(
      path.join(FX, "nec-vccp04-2024-jinju-district.html"),
      "utf-8",
    );
    const r = parseVccp04District(html);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    const districts = new Set(r.rows.map((x) => x.district));
    expect(districts.size).toBeGreaterThanOrEqual(2);
  });

  it("각 선거구의 후보자 명단이 서로 다름 (선거구별 후보 다름)", async () => {
    const html = await readFile(
      path.join(FX, "nec-vccp04-2024-jinju-district.html"),
      "utf-8",
    );
    const r = parseVccp04District(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    const byDistrict = new Map<string, Set<string>>();
    for (const row of r.rows) {
      if (!byDistrict.has(row.district)) byDistrict.set(row.district, new Set());
      const set = byDistrict.get(row.district)!;
      for (const c of row.candidates) set.add(c.name);
    }
    const candidateSets = [...byDistrict.values()];
    expect(candidateSets.length).toBeGreaterThanOrEqual(2);
    // 두 선거구의 후보 명단이 동일하지 않아야 함
    const first = [...candidateSets[0]].sort().join(",");
    const second = [...candidateSets[1]].sort().join(",");
    expect(first).not.toBe(second);
  });

  it("선거구 station 행이 다수 + emdName·district 모두 채워짐", async () => {
    const html = await readFile(
      path.join(FX, "nec-vccp04-2024-jinju-district.html"),
      "utf-8",
    );
    const r = parseVccp04District(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    const stations = r.rows.filter((x) => x.kind === "station");
    expect(stations.length).toBeGreaterThan(10);
    expect(stations.every((s) => !!s.district && !!s.emdName)).toBe(true);
  });
});
