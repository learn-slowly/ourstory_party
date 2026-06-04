import { sql, db } from "../../../src/lib/db-admin";
import { regions } from "../../../db/schema";

async function main() {
  await db
    .insert(regions)
    .values({
      code: "3600000000",
      level: "sido",
      name: "세종특별자치시",
      parentCode: null,
      displayOrder: null,
    })
    .onConflictDoUpdate({
      target: regions.code,
      set: { level: "sido", name: "세종특별자치시", parentCode: null },
    });

  console.log("✓ 세종특별자치시(3600000000) 추가/갱신 완료");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
