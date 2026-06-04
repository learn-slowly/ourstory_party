import postgres from "postgres";

const TABLES = [
  "regions", "elections", "parties", "party_aliases",
  "vote_totals", "region_totals", "candidates",
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 미설정");

  const sql = postgres(url, { prepare: false });

  for (const t of TABLES) {
    // RLS 활성화
    await sql.unsafe(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);

    // 기존 동일 정책 제거 후 재생성 (idempotent)
    await sql.unsafe(`DROP POLICY IF EXISTS "public read" ON ${t}`);
    await sql.unsafe(`CREATE POLICY "public read" ON ${t} FOR SELECT USING (true)`);
    console.log(`✓ ${t}: RLS + public read`);
  }

  // anon / authenticated 권한 부여 (Supabase Data API 를 통한 SELECT 허용)
  await sql.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon`);
  await sql.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated`);
  console.log("\n✓ GRANT SELECT → anon, authenticated");

  // 검증
  const policies = await sql<{ tablename: string; policyname: string }[]>`
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' ORDER BY tablename
  `;
  console.log(`\n적용된 정책 ${policies.length} 건:`);
  for (const p of policies) console.log(`  ${p.tablename}: ${p.policyname}`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
