import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchSelangwiApi, fetchAllPages } from "../../scripts/ingest/lib/api-client";
import { ApiError } from "../../scripts/ingest/lib/types";

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.DATA_GO_KR_API_KEY = "test-key";
});

describe("fetchSelangwiApi", () => {
  it("정상 응답을 파싱한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      response: {
        header: { resultCode: "INFO-000", resultMsg: "정상" },
        body: { items: { item: [{ sgId: "20250603" }] }, totalCount: 1, pageNo: 1, numOfRows: 1 },
      },
    }), { status: 200 }));
    const r = await fetchSelangwiApi("VoteXmntckInfoInqireService2", "getXmntckSttusInfoInqire", { sgId: "20250603" });
    expect(r.items).toEqual([{ sgId: "20250603" }]);
    expect(r.totalCount).toBe(1);
  });

  it("INFO-300 은 ApiError 로 던진다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      response: { header: { resultCode: "INFO-300", resultMsg: "데이터 없음" } },
    }), { status: 200 }));
    await expect(fetchSelangwiApi("X", "Y", {})).rejects.toThrow(ApiError);
  });

  it("HTTP 5xx 에서 3회 재시도", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("err", { status: 500 }));
    await expect(fetchSelangwiApi("X", "Y", {})).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(3);
  }, 30_000);
});

describe("fetchAllPages", () => {
  it("INFO-300 은 빈 배열 반환", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      response: { header: { resultCode: "INFO-300", resultMsg: "데이터 없음" } },
    }), { status: 200 }));
    const r = await fetchAllPages("X", "Y", {});
    expect(r).toEqual([]);
  });

  it("totalCount 도달 시 종료", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      response: {
        header: { resultCode: "INFO-000", resultMsg: "정상" },
        body: { items: { item: [{ a: 1 }, { a: 2 }] }, totalCount: 2, pageNo: 1, numOfRows: 2 },
      },
    }), { status: 200 }));
    const r = await fetchAllPages("X", "Y", {});
    expect(r).toHaveLength(2);
  });
});
