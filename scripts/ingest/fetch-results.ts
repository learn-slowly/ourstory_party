import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllPages } from "./lib/api-client";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_BASE = path.join(HERE, "..", "..", "data", "raw");

export interface ElectionFetchSpec {
  electionId: string;
  sgId: string;        // necElectionId
  sgTypecode: string;  // necCode
}

/**
 * 한 election 의 시·도/시·군 정당·후보자 raw 응답을 받아 캐시한다.
 * 캐시 hit 시 fetch 생략. force=true 면 API 재호출.
 *
 * @returns raw items 배열 (XmntckItem 형식, 시·도/시·군 × 후보자 × 정당 행)
 */
export async function fetchResults(
  spec: ElectionFetchSpec,
  opts: { force?: boolean } = {},
): Promise<unknown[]> {
  const dir = path.join(RAW_BASE, spec.electionId);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "vote-xmntck.json");

  if (!opts.force && existsSync(file)) {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw);
  }

  console.log(`  fetch ${spec.electionId} (sgTypecode=${spec.sgTypecode}) ...`);
  const items = await fetchAllPages(
    "VoteXmntckInfoInqireService2",
    "getXmntckSttusInfoInqire",
    { sgId: spec.sgId, sgTypecode: spec.sgTypecode },
  );

  await writeFile(file, JSON.stringify(items, null, 2), "utf-8");
  console.log(`  saved ${items.length} rows → ${path.relative(process.cwd(), file)}`);
  return items;
}
