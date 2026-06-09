import type {
  RegionDistribution,
  ChildrenTable,
  PresubElDayResult,
  RegionContext,
} from "@/lib/region-types";
import type { ElectionMeta, PartyMeta, TimeseriesPoint, RegionFile, StaticIndex } from "@/types/static";
import type { HomeState } from "@/lib/url-state";
import { Breadcrumb } from "./Breadcrumb";
import { RegionElectionSection } from "./RegionElectionSection";
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
  regionFile: RegionFile;
  index: StaticIndex;
  timeseries: Record<string, TimeseriesPoint[]>;
  initialState: HomeState;
  filterOptions: { types: string[]; parties: PartyOpt[]; yearOptions: string[] };
  elections: ElectionMeta[];
  parties: PartyMeta[];
}

export function RegionView({
  ctx, election, electionOptions, dist, table, presub,
  regionCode, regionName, regionFile, index,
  timeseries, initialState, filterOptions, elections, parties,
}: Props) {
  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <header className="space-y-1">
        <Breadcrumb ancestors={ctx.ancestors} current={ctx.region} electionQuery={election.id} />
      </header>

      <RegionElectionSection
        regionCode={ctx.region.code}
        regionLevel={ctx.level}
        regionFile={regionFile}
        index={index}
        electionOptions={electionOptions}
        initialDist={dist}
        initialTable={table}
        initialPresub={presub}
        initialElectionId={election.id}
      />

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
