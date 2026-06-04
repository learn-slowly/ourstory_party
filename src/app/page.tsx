import { sql } from "@/lib/db";

export default async function Home() {
  const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM parties`;
  const partyCount = rows[0]?.n ?? 0;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">ourstory</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        진보계열 정당 역대 선거 분석 (시·도·시·군·구·읍·면·동).
      </p>
      <div className="rounded border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900">
        시드된 정당 수: <strong>{partyCount}</strong>. Phase 1.1 데이터 인제스천 이후 본격 화면.
      </div>
    </div>
  );
}
