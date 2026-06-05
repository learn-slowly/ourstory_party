import { sql } from "../../src/lib/db-admin";
import { runOneElection } from "./ingest-election";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DONE_FLAG = path.join(HERE, "..", "..", "data", "raw", "LIVE_DONE");

const DEFAULT_IDS = [
  "2026-local-governor",
  "2026-local-mayor",
  "2026-local-council",
  "2026-local-council-prop",
  "2026-local-council-basic",
  "2026-local-council-basic-prop",
  "2026-local-superintendent",
];

async function main() {
  if (existsSync(DONE_FLAG)) {
    console.log("LIVE_DONE flag — skip");
    process.exit(0);
  }
  const idsEnv = process.env.LIVE_ELECTION_IDS;
  const ids = idsEnv
    ? idsEnv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_IDS;
  const failed: string[] = [];

  for (const id of ids) {
    console.log(`\n━━━ ${id} ━━━`);
    try {
      const ok = await runOneElection({
        electionId: id,
        refresh: true,
        dryRun: false,
        diff: false,
      });
      if (!ok) failed.push(id);
    } catch (err) {
      console.error(`  실패: ${(err as Error).message}`);
      failed.push(id);
    }
  }

  // 모든 성공 + 평균 진행률 99.5% 이상 → DONE 플래그
  if (failed.length === 0) {
    const rows = await sql<{ avg: number | null }[]>`
      SELECT AVG(progress_pct)::float AS avg FROM region_totals
      WHERE election_id = ANY(${ids}::text[]) AND progress_pct IS NOT NULL`;
    const avg = Number(rows[0]?.avg ?? 0);
    if (avg >= 99.5) {
      writeFileSync(DONE_FLAG, new Date().toISOString());
      console.log(
        `✓ 모든 elections 평균 진행률 ${avg.toFixed(2)}% — LIVE_DONE 생성`
      );
    } else {
      console.log(`진행 중 — 평균 진행률 ${avg.toFixed(2)}%`);
    }
  } else {
    console.log(`실패: ${failed.join(", ")}`);
  }

  await sql.end();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
