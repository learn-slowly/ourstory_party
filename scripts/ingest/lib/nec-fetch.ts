import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const NEC_BASE = "http://info.nec.go.kr/electioninfo/electionInfo_report.xhtml";
const TIMEOUT_MS = 6000;
const MAX_RETRY = 3;

export interface FetchParams {
  electionId: string;        // "0020250603" 또는 "0000000000"
  electionName?: string;     // YYYYMMDD (역대 모드)
  electionType: string;      // "1" | "2" | "4"
  electionCode: string;      // necCode
  cityCode: string;
  townCode?: string;         // 시·도 단위 race 는 생략
  endpoint: "VCCP08" | "VCCP04";
}

export interface FetchResult {
  status: "ok" | "no-data" | "failed";
  html?: string;
  cached: boolean;
  cachePath: string;
  error?: string;
}

/**
 * 파라미터로부터 캐시 파일명 생성. {electionId}-{cityCode}-{townCode}.html.
 * townCode 없으면 "all" 로.
 */
export function cacheFilename(p: FetchParams): string {
  const town = p.townCode ?? "all";
  return `${p.electionId}-${p.cityCode}-${town}.html`;
}

/**
 * 단일 NEC POST. 캐시 hit 시 디스크 reuse. 빈 응답(검색된 결과가 없습니다)도 캐시 저장(no-data 분류).
 *
 * @param cacheDir 절대 경로 (예: data/raw/polling-stations)
 */
export async function fetchOne(
  p: FetchParams,
  cacheDir: string,
  opts: { refresh?: boolean } = {},
): Promise<FetchResult> {
  const cachePath = path.join(cacheDir, cacheFilename(p));

  if (!opts.refresh && existsSync(cachePath)) {
    const html = await readFile(cachePath, "utf-8");
    return {
      status: html.includes("검색된 결과가 없습니다") ? "no-data" : "ok",
      html,
      cached: true,
      cachePath,
    };
  }

  const requestUri = `/electioninfo/${p.electionId}/vc/${p.endpoint.toLowerCase()}.jsp`;
  const statementId = p.endpoint === "VCCP04" ? "VCCP04_#2_0" : "VCCP08_#1";
  const body = new URLSearchParams({
    electionId: p.electionId,
    requestURI: requestUri,
    topMenuId: "VC",
    secondMenuId: p.endpoint,
    menuId: p.endpoint,
    statementId,
    electionType: p.electionType,
    electionCode: p.electionCode,
    cityCode: p.cityCode,
    searchMode: "1",
  });
  if (p.electionName) body.set("electionName", p.electionName);
  if (p.townCode) body.set("townCode", p.townCode);

  let lastErr: string | undefined;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(NEC_BASE, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0",
        },
        body,
        signal: ctrl.signal,
      });
      if (!r.ok) {
        clearTimeout(t);
        lastErr = `HTTP ${r.status}`;
        // 5xx 만 재시도, 4xx 는 즉시 실패
        if (r.status < 500) break;
        await new Promise((res) => setTimeout(res, 1000 * 2 ** (attempt - 1)));
        continue;
      }
      // r.text() 도 abort signal 적용해야 청크 지연·body hang 방지
      const html = await r.text();
      clearTimeout(t);
      if (!existsSync(cacheDir)) await mkdir(cacheDir, { recursive: true });
      await writeFile(cachePath, html);
      return {
        status: html.includes("검색된 결과가 없습니다") ? "no-data" : "ok",
        html,
        cached: false,
        cachePath,
      };
    } catch (e) {
      clearTimeout(t);
      lastErr = (e as Error).message;
      await new Promise((res) => setTimeout(res, 1000 * 2 ** (attempt - 1)));
    }
  }
  return { status: "failed", cached: false, cachePath, error: lastErr };
}
