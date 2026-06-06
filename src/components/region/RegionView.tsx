import type {
  RegionDistribution,
  ChildrenTable,
  PresubElDayResult,
  RegionContext,
} from "@/lib/region-types";
import type { ElectionMeta, PartyMeta, TimeseriesPoint } from "@/types/static";
import type { HomeState } from "@/lib/url-state";
import { Breadcrumb } from "./Breadcrumb";
import { ElectionPicker } from "./ElectionPicker";
import { RegionPartyDist } from "./RegionPartyDist";
import { RegionChildrenTable } from "./RegionChildrenTable";
import { PresubVsElDay } from "./PresubVsElDay";
import { RegionTimeseries } from "./RegionTimeseries";

interface ElectionLike {
  id: string;
  name: string;
}

interface PartyOpt {
  id: string;
  name: string;
  family: string;
  color: string;
  satelliteOf?: string | null;
}

interface Props {
  ctx: RegionContext;
  election: ElectionLike;
  electionOptions: ElectionLike[];
  dist: RegionDistribution;
  table: ChildrenTable | null;
  presub: PresubElDayResult | null;
  regionCode: string;
  regionName: string;
  timeseries: Record<string, TimeseriesPoint[]>;
  initialState: HomeState;
  filterOptions: { types: string[]; parties: PartyOpt[]; yearOptions: string[] };
  elections: ElectionMeta[];
  parties: PartyMeta[];
}

export function RegionView({
  ctx, election, electionOptions, dist, table, presub,
  regionCode, regionName, timeseries, initialState, filterOptions, elections, parties,
}: Props) {
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

      <RegionTimeseries
        regionCode={regionCode}
        regionName={regionName}
        timeseries={timeseries}
        initialState={initialState}
        filterOptions={filterOptions}
        elections={elections}
        parties={parties}
      />
    </div>
  );
}
