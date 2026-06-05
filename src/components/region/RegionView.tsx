import type {
  RegionDistribution,
  ChildrenTable,
  PresubElDayResult,
  SeriesPoint,
  RegionContext,
} from "@/lib/region-types";
import { Breadcrumb } from "./Breadcrumb";
import { ElectionPicker } from "./ElectionPicker";
import { RegionPartyDist } from "./RegionPartyDist";
import { RegionChildrenTable } from "./RegionChildrenTable";
import { PresubVsElDay } from "./PresubVsElDay";
import { RegionMiniSeries } from "./RegionMiniSeries";

interface ElectionLike {
  id: string;
  name: string;
}

interface Props {
  ctx: RegionContext;
  election: ElectionLike;
  electionOptions: ElectionLike[];
  dist: RegionDistribution;
  table: ChildrenTable | null;
  presub: PresubElDayResult | null;
  series: SeriesPoint[];
}

export function RegionView({ ctx, election, electionOptions, dist, table, presub, series }: Props) {
  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <header>
        <Breadcrumb ancestors={ctx.ancestors} current={ctx.region} electionQuery={election.id} />
        <div className="flex flex-wrap items-baseline gap-3 mt-1">
          <h1 className="text-xl font-bold">
            {ctx.region.name}
            <span className="text-zinc-400 mx-2">·</span>
            <span className="text-zinc-700 dark:text-zinc-300">{election.name}</span>
          </h1>
          <ElectionPicker selectedId={election.id} options={electionOptions} regionCode={ctx.region.code} />
        </div>
      </header>

      <RegionPartyDist dist={dist} />

      {table && <RegionChildrenTable table={table} electionId={election.id} />}

      {presub && ctx.level !== "emd" && <PresubVsElDay presub={presub} />}

      <RegionMiniSeries series={series} regionName={ctx.region.name} />
    </div>
  );
}
