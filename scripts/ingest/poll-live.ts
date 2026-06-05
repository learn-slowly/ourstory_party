import { sql } from "../../src/lib/db-admin";
import { runOneElection } from "./ingest-election";

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
  const idsEnv = process.env.LIVE_ELECTION_IDS;
  const ids = idsEnv
    ? idsEnv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_IDS;
  const failed: string[] = [];
  const noData: string[] = [];

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
      const msg = (err as Error).message;
      // INFO-03 = data.go.kr 미공개 상태. 데이터 공개 전엔 정상 사유.
      if (msg.includes("INFO-03")) {
        console.log(`  미공개 (INFO-03)`);
        noData.push(id);
      } else {
        console.error(`  실패: ${msg}`);
        failed.push(id);
      }
    }
  }

  // 전체가 미공개 = data.go.kr 공개 전. 정상 종료.
  if (failed.length === 0 && noData.length === ids.length) {
    console.log(`\n전부 미공개 — data.go.kr 공개 전 (${noData.length}개)`);
    await sql.end();
    process.exit(0);
  }

  if (failed.length === 0 && noData.length === 0) {
    console.log(`\n✓ 모든 elections 적재 완료 (${ids.length}개)`);
  } else if (failed.length > 0) {
    console.log(`\n실패: ${failed.join(", ")}`);
    if (noData.length > 0) console.log(`미공개: ${noData.join(", ")}`);
  } else {
    console.log(`\n일부 미공개 (${noData.length}개): ${noData.join(", ")}`);
  }

  await sql.end();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
