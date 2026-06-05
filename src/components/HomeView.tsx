"use client";

import { HeaderControls } from "./HeaderControls";
import { HomeChart } from "./HomeChart";
import { StatsCards } from "./StatsCards";
import type { HomeState } from "../lib/url-state";
import type { ChartRow, ChartLine } from "../lib/series";

interface RegionOpt { code: string; level: string; name: string; parentCode?: string | null; }
interface PartyOpt { id: string; name: string; family: string; color: string; satelliteOf?: string | null; }
interface EmdOpt { code: string; name: string; }
interface StationOpt { sigunguCode: string; emdCode: string; name: string; }

interface Props {
  state: HomeState;
  filterOptions: { regions: RegionOpt[]; types: string[]; parties: PartyOpt[] };
  emdOptions: EmdOpt[];
  stationOptions: StationOpt[];
  data: ChartRow[];
  lines: ChartLine[];
}

export function HomeView({ state, filterOptions, emdOptions, stationOptions, data, lines }: Props) {
  return (
    <div className="space-y-4">
      <HeaderControls
        state={state}
        regions={filterOptions.regions}
        emdOptions={emdOptions}
        stationOptions={stationOptions}
        types={filterOptions.types}
        parties={filterOptions.parties}
      />
      <HomeChart data={data} lines={lines} />
      <StatsCards data={data} lines={lines} />
    </div>
  );
}
