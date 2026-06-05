import { describe, it, expect } from "vitest";
import {
  getRegionContext,
  getRegionDistribution,
  getRegionChildrenTable,
  getPresubVsElDay,
  getRegionTimeseries,
} from "../../src/lib/queries";

describe("getRegionContext", () => {
  it("sido (4800000000 경상남도) — level=sido, ancestors=[], children=시·군·구들", async () => {
    const r = await getRegionContext("4800000000");
    expect(r).not.toBeNull();
    expect(r!.level).toBe("sido");
    expect(r!.region.name).toBe("경상남도");
    expect(r!.ancestors).toEqual([]);
    expect(r!.children.length).toBeGreaterThan(15); // 경남 시·군 18개 + sub-구 포함
    expect(r!.children.every((c) => c.parentCode === "4800000000" || c.parentCode?.startsWith("48"))).toBe(true);
  });

  it("sigungu (4817000000 진주시) — level=sigungu, ancestors=[경남], children=emd들", async () => {
    const r = await getRegionContext("4817000000");
    expect(r).not.toBeNull();
    expect(r!.level).toBe("sigungu");
    expect(r!.region.name).toBe("진주시");
    expect(r!.ancestors.length).toBe(1);
    expect(r!.ancestors[0].name).toBe("경상남도");
    expect(r!.children.length).toBeGreaterThan(10); // 진주시 emd 다수
    expect(r!.children.every((c) => c.level === "emd")).toBe(true);
  });

  it("미존재 code → null 반환 (caller 가 notFound 처리)", async () => {
    const r = await getRegionContext("0000000001");
    expect(r).toBeNull();
  });
});

describe("getRegionDistribution", () => {
  it("2024-general-prop × 경상남도 — raceKind=party + 정당 다수 + 정의당 포함", async () => {
    const r = await getRegionDistribution("2024-general-prop", "4800000000");
    expect(r.raceKind).toBe("party");
    expect(r.rows.length).toBeGreaterThan(3);
    expect(r.totalVotes).toBeGreaterThan(0);
    const justice = r.rows.find((x) => x.partyId === "justice");
    expect(justice).toBeDefined();
    expect(justice!.share).toBeGreaterThanOrEqual(0);
    expect(justice!.share).toBeLessThan(1);
  });

  it("2024-general × 종로구 (1111000000) — raceKind=candidate (necCode=2)", async () => {
    const r = await getRegionDistribution("2024-general", "1111000000");
    // 2024-general necCode=2 이면 candidate, 데이터 없으면 빈 결과도 허용
    expect(r.raceKind).toBe("candidate");
  });

  it("미존재 election → 빈 결과 (rows=[], totalVotes=0)", async () => {
    const r = await getRegionDistribution("not-an-election", "4800000000");
    expect(r.rows).toEqual([]);
    expect(r.totalVotes).toBe(0);
  });
});

describe("getRegionChildrenTable", () => {
  it("2024-general-prop × 경상남도 — children 다수 + 정당 컬럼 다수", async () => {
    const r = await getRegionChildrenTable("2024-general-prop", "4800000000");
    expect(r.children.length).toBeGreaterThan(15);
    expect(r.partyColumns.length).toBeGreaterThan(3);
    // 정의당이 partyColumns 에 항상 포함
    expect(r.partyColumns.some((p) => p.partyId === "justice")).toBe(true);
    // 첫 child 의 byParty 가 partyColumns 와 매칭
    const firstChild = r.children[0];
    expect(typeof firstChild.byParty["justice"]).toBe("number");
    expect(firstChild.total).toBeGreaterThan(0);
  });

  it("2024-general-prop × 진주시 (4817000000) — emd children", async () => {
    const r = await getRegionChildrenTable("2024-general-prop", "4817000000");
    expect(r.children.length).toBeGreaterThan(5);
    // total 내림차순 정렬 검증
    for (let i = 1; i < r.children.length; i++) {
      expect(r.children[i - 1].total).toBeGreaterThanOrEqual(r.children[i].total);
    }
  });
});

describe("getPresubVsElDay", () => {
  it("2024-general-prop × 진주시 children scope — adapted election OK", async () => {
    const r = await getPresubVsElDay("2024-general-prop", "4817000000", "children");
    expect(r.hasData).toBe(true);
    expect(r.rows.length).toBeGreaterThan(5);
    // 정의당 row 있어야 함
    expect(r.rows.some((x) => x.partyId === "justice")).toBe(true);
    // presub + elDay 합이 양수
    const justice = r.rows.find((x) => x.partyId === "justice")!;
    expect(justice.presub + justice.elDay).toBeGreaterThan(0);
  });

  it("polling 없는 election (2022-local-mayor) → hasData=false", async () => {
    const r = await getPresubVsElDay("2022-local-mayor", "4817000000", "children");
    expect(r.hasData).toBe(false);
    expect(r.rows).toEqual([]);
  });
});

describe("getRegionTimeseries", () => {
  it("경상남도 (4800000000) × justice — election 다수, 시계열 정렬", async () => {
    const r = await getRegionTimeseries("4800000000", "justice");
    expect(r.length).toBeGreaterThan(3);
    // election.displayOrder 순서로 정렬
    for (let i = 1; i < r.length; i++) {
      const aOrder = r[i - 1].election.displayOrder ?? 0;
      const bOrder = r[i].election.displayOrder ?? 0;
      expect(bOrder).toBeGreaterThanOrEqual(aOrder);
    }
    // 모든 row 의 partyId = justice
    expect(r.every((x) => x.partyId === "justice")).toBe(true);
  });

  it("미존재 region 또는 정당 → 빈 배열", async () => {
    const r = await getRegionTimeseries("0000000001", "justice");
    expect(r).toEqual([]);
  });
});
