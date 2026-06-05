// src/lib/static-data.ts
// 정적 JSON chunk 접근자 — queries.ts (SQL) 의 thin 대체본.
// public/data/static/ 산출물을 fs 로 직접 읽음 (Next.js 빌드 타임).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { StaticIndex, RegionFile, ElectionDetailFile, StationFile } from "@/types/static";

const ROOT = path.resolve("public/data/static");

let indexCache: StaticIndex | null = null;
export async function getIndex(): Promise<StaticIndex> {
  if (indexCache) return indexCache;
  indexCache = JSON.parse(await readFile(path.join(ROOT, "index.json"), "utf-8")) as StaticIndex;
  return indexCache;
}

export async function getRegionFile(code: string): Promise<RegionFile> {
  return JSON.parse(await readFile(path.join(ROOT, "region", `${code}.json`), "utf-8")) as RegionFile;
}

export async function getElectionDetail(regionCode: string, electionId: string): Promise<ElectionDetailFile> {
  return JSON.parse(await readFile(path.join(ROOT, "region", regionCode, `election-${electionId}.json`), "utf-8")) as ElectionDetailFile;
}

export async function getStationFile(stationKey: string): Promise<StationFile> {
  const safe = stationKey.replace(/[\/\\]/g, "_");
  return JSON.parse(await readFile(path.join(ROOT, "station", `${safe}.json`), "utf-8")) as StationFile;
}

// 전체 region 코드 목록 — generateStaticParams 용
export async function listAllRegionCodes(): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(path.join(ROOT, "region"));
  return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
}
