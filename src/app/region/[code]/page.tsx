import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { elections } from "../../../../db/schema";
import { getRegionContext } from "@/lib/queries";
import { RegionView } from "@/components/region/RegionView";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RegionPage({ params, searchParams }: PageProps) {
  const { code } = await params;
  const sp = await searchParams;

  // spec § 오류 처리: code 가 10자리 숫자가 아니면 404
  if (!/^\d{10}$/.test(code)) notFound();

  // region 컨텍스트 + 선거 목록 병렬 조회
  const [ctx, allElections] = await Promise.all([
    getRegionContext(code),
    db.select().from(elections)
      .where(eq(elections.isByelection, false))
      .orderBy(desc(elections.displayOrder)),
  ]);

  if (!ctx) notFound();
  if (allElections.length === 0) notFound();

  // election query 파싱 — 없거나 미존재 ID 면 가장 최근(displayOrder 최상)으로 fallback
  const electionParam = typeof sp.election === "string" ? sp.election : Array.isArray(sp.election) ? sp.election[0] : undefined;
  const matched = electionParam ? allElections.find((e) => e.id === electionParam) : undefined;
  const election = matched ?? allElections[0];

  return (
    <RegionView
      ctx={ctx}
      election={election}
      electionOptions={allElections.map((e) => ({ id: e.id, name: e.name }))}
    />
  );
}
