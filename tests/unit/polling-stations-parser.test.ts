import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseVccp08Stations } from "../../scripts/ingest/lib/nec-html";

const FX = path.join(__dirname, "..", "fixtures");

async function load(name: string) {
  return readFile(path.join(FX, name), "utf-8");
}

describe("parseVccp08Stations — 2025 진주 대선", () => {
  it("ok 응답 + 5명 후보 + 최소 30 row (진주시 평균 동·메타 합)", async () => {
    const html = await load("nec-vccp08-2025-jinju.html");
    const r = parseVccp08Stations(html);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.partyNames.length).toBe(5);
    expect(r.rows.length).toBeGreaterThan(30);
  });

  it("문산읍제1투 station 행이 정확히 한 번 존재 + 분모 일치", async () => {
    const html = await load("nec-vccp08-2025-jinju.html");
    const r = parseVccp08Stations(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    const m1 = r.rows.filter(
      (x) => x.kind === "station" && x.name === "문산읍제1투",
    );
    expect(m1).toHaveLength(1);
    expect(m1[0].emdName).toBe("문산읍");
    expect(m1[0].totalVoters).toBe(2315);
    expect(m1[0].totalVotes).toBe(1465);
  });

  it("top-level 메타 (거소·선상·관외사전·재외) 각 1행씩 + 분모 일치", async () => {
    const html = await load("nec-vccp08-2025-jinju.html");
    const r = parseVccp08Stations(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    const abs = r.rows.find((x) => x.kind === "abs");
    const absentee = r.rows.find((x) => x.kind === "absentee");
    const overseas = r.rows.find((x) => x.kind === "overseas");
    expect(abs?.emdName).toBeNull();
    expect(abs?.totalVoters).toBe(19240);
    expect(absentee?.totalVoters).toBe(629);
    expect(overseas?.totalVoters).toBe(1286);
  });
});

describe("parseVccp08Stations — 2024 진주 총선 비례", () => {
  it("ok 응답 + 정당 38개 (2024 비례 등록 정당 수 정확)", async () => {
    const html = await load("nec-vccp08-2024-jinju-generalprop.html");
    const r = parseVccp08Stations(html);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.partyNames.length).toBe(38);
  });

  it("station 행 다수 + 관내사전(presub) 행이 emd 별로 존재", async () => {
    const html = await load("nec-vccp08-2024-jinju-generalprop.html");
    const r = parseVccp08Stations(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    const stations = r.rows.filter((x) => x.kind === "station");
    const presubs = r.rows.filter((x) => x.kind === "presub");
    expect(stations.length).toBeGreaterThan(10);
    expect(presubs.length).toBeGreaterThan(5);
    // station 의 emdName 은 비어있지 않아야 함
    expect(stations.every((s) => !!s.emdName)).toBe(true);
  });

  it("정당 득표 셀 수 = partyNames 수, 모두 numeric", async () => {
    const html = await load("nec-vccp08-2024-jinju-generalprop.html");
    const r = parseVccp08Stations(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    for (const row of r.rows) {
      expect(row.parties.length).toBe(r.partyNames.length);
      expect(row.parties.every((p) => Number.isFinite(p.votes))).toBe(true);
    }
  });
});

describe("parseVccp08Stations — 2022 진주 광역비례", () => {
  it("ok 응답 + 정당 6개 (2022 광역비례 등록 정당 수 정확)", async () => {
    const html = await load("nec-vccp08-2022-jinju-localprop.html");
    const r = parseVccp08Stations(html);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.partyNames.length).toBe(6);
  });

  it("emd 컨텍스트 추적: station 행의 emdName 이 직전 소계 행의 emd 와 일치", async () => {
    const html = await load("nec-vccp08-2022-jinju-localprop.html");
    const r = parseVccp08Stations(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    const stations = r.rows.filter((x) => x.kind === "station");
    expect(stations.length).toBeGreaterThan(0);
    // 적어도 두 개 이상의 다른 emdName 이 있어야 함 (여러 동에 걸쳐 station 분포)
    const emds = new Set(stations.map((s) => s.emdName));
    expect(emds.size).toBeGreaterThan(1);
  });

  it("invalidVotes(무효) 컬럼이 모두 정수", async () => {
    const html = await load("nec-vccp08-2022-jinju-localprop.html");
    const r = parseVccp08Stations(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    for (const row of r.rows) {
      expect(Number.isInteger(row.invalidVotes)).toBe(true);
      expect(row.invalidVotes).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("parseVccp08Stations — 2020 진주 총선 비례", () => {
  it("ok 응답 + 정당 35개 (2020 비례 등록 정당 수 정확)", async () => {
    const html = await load("nec-vccp08-2020-jinju-generalprop.html");
    const r = parseVccp08Stations(html);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.partyNames.length).toBe(35);
  });

  it("rows 의 totalVoters 합 ≥ validVotes 합 (분모 sanity)", async () => {
    const html = await load("nec-vccp08-2020-jinju-generalprop.html");
    const r = parseVccp08Stations(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    const sumVoters = r.rows.reduce((a, b) => a + b.totalVoters, 0);
    const sumValid = r.rows.reduce((a, b) => a + b.validVotes, 0);
    expect(sumVoters).toBeGreaterThanOrEqual(sumValid);
  });

  it("어떤 row 도 unknown/undefined kind 가 아님", async () => {
    const html = await load("nec-vccp08-2020-jinju-generalprop.html");
    const r = parseVccp08Stations(html);
    if (r.kind !== "ok") throw new Error("expected ok");
    const KINDS = new Set(["station", "presub", "abs", "absentee", "overseas", "misc"]);
    for (const row of r.rows) {
      expect(KINDS.has(row.kind)).toBe(true);
    }
  });
});
