"use client";

import { HeaderControls } from "./HeaderControls";
import { HomeChart } from "./HomeChart";
import { StatsCards } from "./StatsCards";
import type { HomeState } from "../lib/url-state";
import type { ChartRow, ChartLine } from "../lib/series";

interface RegionOpt { code: string; level: string; name: string; }
interface PartyOpt { id: string; name: string; family: string; color: string; satelliteOf?: string | null; }

interface Props {
  state: HomeState;
  filterOptions: { regions: RegionOpt[]; types: string[]; parties: PartyOpt[] };
  data: ChartRow[];
  lines: ChartLine[];
}

export function HomeView({ state, filterOptions, data, lines }: Props) {
  return (
    <div className="space-y-4">
      <HeaderControls
        state={state}
        regions={filterOptions.regions}
        types={filterOptions.types}
        parties={filterOptions.parties}
      />
      <HomeChart data={data} lines={lines} />
      <StatsCards data={data} lines={lines} />
    </div>
  );
}
