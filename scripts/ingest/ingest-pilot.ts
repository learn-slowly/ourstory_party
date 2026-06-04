import { sql } from "../../src/lib/db-admin";
import { runOneElection } from "./ingest-election";

const PILOT_IDS = [
  "2022-local-governor", "2022-local-mayor",
  "2022-local-council", "2022-local-council-prop",
  "2022-local-council-basic", "2022-local-council-basic-prop",
  "2024-general", "2024-general-prop",
  "2025-presidential",
  "2026-local-governor", "2026-local-mayor",
  "2026-local-council", "2026-local-council-prop",
  "2026-local-council-basic", "2026-local-council-basic-prop",
  "2026-local-superintendent",
];

async function main() {
  const flags = process.argv.slice(2);
  const refresh = flags.includes("--refresh");
  const dryRun = flags.includes("--dry-run");

  const failed: string[] = [];
  for (const id of PILOT_IDS) {
    console.log(`\n━━━ ${id} ━━━`);
    try {
      const ok = await runOneElection({ electionId: id, refresh, dryRun, diff: false });
      if (!ok) failed.push(id);
    } catch (err) {
      console.error(`  실패: ${(err as Error).message}`);
      failed.push(id);
    }
  }

  console.log(`\n=== Pilot 종료 ===`);
  console.log(`성공: ${PILOT_IDS.length - failed.length}/${PILOT_IDS.length}`);
  if (failed.length) console.log(`실패: ${failed.join(", ")}`);

  await sql.end();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
