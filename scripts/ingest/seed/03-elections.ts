import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sql, db } from "../../../src/lib/db-admin";
import { elections } from "../../../db/schema";

interface SeedElection {
  id: string;
  date: string;
  type: string;
  name: string;
  necElectionId?: string;
  necCode?: string;
  isByelection?: boolean;
  displayOrder?: number;
}

async function main() {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const SEED_PATH = path.join(HERE, "..", "..", "..", "data", "seed", "elections.json");

  const seed: SeedElection[] = JSON.parse(await readFile(SEED_PATH, "utf-8"));

  for (const e of seed) {
    await db.insert(elections).values({
      id: e.id, date: e.date, type: e.type, name: e.name,
      necElectionId: e.necElectionId, necCode: e.necCode,
      isByelection: e.isByelection ?? false, displayOrder: e.displayOrder,
    }).onConflictDoUpdate({
      target: elections.id,
      set: {
        date: e.date, type: e.type, name: e.name,
        necElectionId: e.necElectionId, necCode: e.necCode,
        isByelection: e.isByelection ?? false, displayOrder: e.displayOrder,
      },
    });
  }

  const count = (await db.select().from(elections)).length;
  console.log(`✓ elections=${count}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
