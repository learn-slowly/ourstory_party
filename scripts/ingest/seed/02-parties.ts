import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sql, db } from "../../../src/lib/db-admin";
import { parties, partyAliases } from "../../../db/schema";

interface SeedParty {
  id: string;
  name: string;
  family: string;
  color: string;
  satelliteOf?: string;
  activeFrom?: string;
  activeUntil?: string;
  aliases: string[];
}

async function main() {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const SEED_PATH = path.join(HERE, "..", "..", "..", "data", "seed", "parties.json");

  const raw = await readFile(SEED_PATH, "utf-8");
  const seed: SeedParty[] = JSON.parse(raw);

  // satelliteOf 가 본당을 참조하므로 본당 먼저 → 위성 나중 순서로 정렬
  const ordered = [...seed].sort((a, b) => {
    if (!a.satelliteOf && b.satelliteOf) return -1;
    if (a.satelliteOf && !b.satelliteOf) return 1;
    return 0;
  });

  for (const p of ordered) {
    await db.insert(parties).values({
      id: p.id,
      name: p.name,
      family: p.family,
      color: p.color,
      satelliteOf: p.satelliteOf,
      activeFrom: p.activeFrom,
      activeUntil: p.activeUntil,
    }).onConflictDoUpdate({
      target: parties.id,
      set: {
        name: p.name, family: p.family, color: p.color,
        satelliteOf: p.satelliteOf, activeFrom: p.activeFrom, activeUntil: p.activeUntil,
      },
    });

    for (const alias of p.aliases) {
      await db.insert(partyAliases).values({
        alias, partyId: p.id, validFrom: p.activeFrom ?? "1900-01-01",
      }).onConflictDoNothing();
    }
  }

  const partyCount = (await db.select().from(parties)).length;
  const aliasCount = (await db.select().from(partyAliases)).length;
  console.log(`✓ parties=${partyCount}, party_aliases=${aliasCount}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
