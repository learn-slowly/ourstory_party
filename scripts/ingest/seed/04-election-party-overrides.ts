import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sql, db } from "../../../src/lib/db-admin";
import { electionPartyOverrides } from "../../../db/schema";

interface SeedRow {
  electionId: string;
  rawName: string;
  partyId: string;
  note?: string;
}

async function main() {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const SEED_PATH = path.join(HERE, "..", "..", "..", "data", "seed", "election-party-overrides.json");

  const raw = await readFile(SEED_PATH, "utf-8");
  const rows: SeedRow[] = JSON.parse(raw);

  for (const r of rows) {
    await db
      .insert(electionPartyOverrides)
      .values({ electionId: r.electionId, rawName: r.rawName, partyId: r.partyId, note: r.note })
      .onConflictDoUpdate({
        target: [electionPartyOverrides.electionId, electionPartyOverrides.rawName],
        set: { partyId: r.partyId, note: r.note },
      });
  }

  console.log(`시드 완료: election_party_overrides ${rows.length}건`);
  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
