import postgres from "postgres";

const expected = [
  "candidates", "election_party_overrides", "elections", "parties",
  "party_aliases", "region_totals", "regions", "vote_totals",
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);

  try {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${expected})
      ORDER BY table_name;
    `;

    const found = rows.map((r) => r.table_name);
    const missing = expected.filter((t) => !found.includes(t));

    if (missing.length > 0) {
      console.error("누락 테이블:", missing);
      process.exit(1);
    }

    console.log(`✓ 8개 테이블 모두 존재: ${found.join(", ")}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
