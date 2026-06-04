import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllPages } from "./lib/api-client";
import type { ElectionFetchSpec } from "./fetch-results";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_BASE = path.join(HERE, "..", "..", "data", "raw");

/**
 * 한 election 의 시·군 단위 선거인수/투표수/유효표/무효표 raw 응답을 받아 캐시한다.
 *
 * @returns raw items 배열 (ElcntItem 형식, 시·군 행 — sdName/wiwName 으로 식별)
 */
export async function fetchVoters(
  spec: ElectionFetchSpec,
  opts: { force?: boolean } = {},
): Promise<unknown[]> {
  const dir = path.join(RAW_BASE, spec.electionId);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "elcnt.json");

  if (!opts.force && existsSync(file)) {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw);
  }

  console.log(`  fetch ${spec.electionId} voters ...`);
  const items = await fetchAllPages(
    "ElcntInfoInqireService",
    "getGsigElcntInfoInqire",
    { sgId: spec.sgId },
  );

  await writeFile(file, JSON.stringify(items, null, 2), "utf-8");
  console.log(`  saved ${items.length} rows → ${path.relative(process.cwd(), file)}`);
  return items;
}
