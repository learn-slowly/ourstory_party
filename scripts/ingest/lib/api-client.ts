import { z } from "zod";
import { ApiError, ApiResponseSchema } from "./types";

const BASE = "https://apis.data.go.kr/9760000";
const DEFAULT_PAGE_SIZE = 1000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

export interface FetchResult {
  items: unknown[];
  totalCount: number;
  pageNo: number;
  numOfRows: number;
}

export async function fetchSelangwiApi(
  service: string,
  endpoint: string,
  params: Record<string, string | number>,
  opts: { pageNo?: number; numOfRows?: number } = {},
): Promise<FetchResult> {
  const key = process.env.DATA_GO_KR_API_KEY;
  if (!key) throw new Error("DATA_GO_KR_API_KEY 미설정");

  const url = new URL(`${BASE}/${service}/${endpoint}`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("type", "json");
  url.searchParams.set("resultType", "json");
  url.searchParams.set("pageNo", String(opts.pageNo ?? 1));
  url.searchParams.set("numOfRows", String(opts.numOfRows ?? DEFAULT_PAGE_SIZE));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url.toString());
      if (!res.ok) {
        const body = await res.text();
        throw new ApiError(String(res.status), `HTTP ${res.status}: ${body.slice(0, 200)}`, url.toString());
      }
      const json = await res.json();
      const parsed = ApiResponseSchema.parse(json);
      const code = parsed.response.header.resultCode;
      if (code !== "INFO-000" && code !== "INFO-00") {
        throw new ApiError(code, `${code}: ${parsed.response.header.resultMsg}`, url.toString());
      }
      const body = parsed.response.body ?? {};
      const itemsRaw = (body.items as { item?: unknown })?.item ?? body.items ?? [];
      const items = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];
      return {
        items,
        totalCount: body.totalCount ?? items.length,
        pageNo: body.pageNo ?? 1,
        numOfRows: body.numOfRows ?? items.length,
      };
    } catch (err) {
      lastError = err as Error;
      if (err instanceof ApiError && !/^\d+$/.test(err.code)) throw err;
      if (err instanceof z.ZodError) throw err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError ?? new Error("Unknown error");
}

export async function fetchAllPages(
  service: string,
  endpoint: string,
  params: Record<string, string | number>,
): Promise<unknown[]> {
  const all: unknown[] = [];
  let pageNo = 1;
  while (true) {
    let result: FetchResult;
    try {
      result = await fetchSelangwiApi(service, endpoint, params, { pageNo });
    } catch (err) {
      if (err instanceof ApiError && err.code === "INFO-300") return all;
      throw err;
    }
    all.push(...result.items);
    if (result.items.length === 0) break;
    if (all.length >= result.totalCount) break;
    pageNo += 1;
    if (pageNo > 100) throw new Error("페이지 한도 초과 (100)");
  }
  return all;
}
