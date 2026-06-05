import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { elections } from "../../../../db/schema";
import {
  getRegionContext,
  getRegionDistribution,
  getRegionChildrenTable,
  getPresubVsElDay,
  getRegionTimeseries,
} from "@/lib/queries";
import { RegionView } from "@/components/region/RegionView";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RegionPage({ params, searchParams }: PageProps) {
  const { code } = await params;
  const sp = await searchParams;

  if (!/^\d{10}$/.test(code)) notFound();

  const [ctx, allElections] = await Promise.all([
    getRegionContext(code),
    db.select().from(elections)
      .where(eq(elections.isByelection, false))
      .orderBy(desc(elections.displayOrder)),
  ]);
  if (!ctx) notFound();
  if (allElections.length === 0) notFound();

  const electionParam = typeof sp.election === "string" ? sp.election : Array.isArray(sp.election) ? sp.election[0] : undefined;
  const matched = electionParam ? allElections.find((e) => e.id === electionParam) : undefined;
  const election = matched ?? allElections[0];

  // 4 query 병렬 호출 — emd level 은 B 섹션(children table) 표시 안 함
  const presubScope = ctx.level === "emd" ? "self" : "children";
  const [dist, table, presub, series] = await Promise.all([
    getRegionDistribution(election.id, code),
    ctx.level !== "emd" ? getRegionChildrenTable(election.id, code) : Promise.resolve(null),
    ctx.level !== "emd" ? getPresubVsElDay(election.id, code, presubScope) : Promise.resolve(null),
    getRegionTimeseries(code, "justice"),
  ]);

  return (
    <RegionView
      ctx={ctx}
      election={election}
      electionOptions={allElections.map((e) => ({ id: e.id, name: e.name }))}
      dist={dist}
      table={table}
      presub={presub}
      series={series}
    />
  );
}
