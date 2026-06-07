"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HeaderControls } from "./HeaderControls";
import { StatsCards } from "./StatsCards";
import { TimeseriesPanel } from "./TimeseriesPanel";
import { buildHomeChart } from "../lib/static-series";
import { encodeState, type HomeState } from "../lib/url-state";
import type { ElectionMeta, PartyMeta, TimeseriesPoint } from "../types/static";

interface RegionOpt { code: string; level: string; name: string; parentCode?: string | null; }
interface PartyOpt { id: string; name: string; family: string; color: string; satelliteOf?: string | null; }
interface EmdOpt { code: string; name: string; }
interface StationOpt { sigunguCode: string; emdCode: string; name: string; }
interface ChartSource { timeseries: Record<string, TimeseriesPoint[]> }

interface Props {
  state: HomeState;
  filterOptions: { regions: RegionOpt[]; types: string[]; parties: PartyOpt[]; yearOptions: string[] };
  emdOptions: EmdOpt[];
  stationOptions: StationOpt[];
  // raw chart inputs — buildHomeChart 는 client 에서 useMemo 로 재계산.
  // 정당/유형/기간/위성/진보합산 토글은 즉시 반영, region 변경 시만 server roundtrip (다른 region.json fetch).
  sources: ChartSource[];
  elections: ElectionMeta[];
  parties: PartyMeta[];
}

export function HomeView({ state, filterOptions, emdOptions, stationOptions, sources, elections, parties }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Optimistic state — 토글 즉시 local 반영. URL 갱신 (server roundtrip) 은 background.
  // server 가 새 state 로 region.json 을 다시 보내면 useEffect 로 sync.
  const [optimisticState, setOptimisticState] = useState<HomeState>(state);
  useEffect(() => setOptimisticState(state), [state]);

  function handleChange(next: HomeState) {
    setOptimisticState(next);
    const qs = encodeState(next);
    startTransition(() => router.push(qs ? `/?${qs}` : "/"));
  }

  // client-side chart 재계산. 정당/types/기간/위성/진보합산 토글 시 즉시 반영.
  // region 만 바꾸면 sources 가 prop 으로 새로 들어올 때까지 (server roundtrip) 기존 sources 로 그림 — UX 상 자연스러움.
  const { data, lines } = useMemo(
    () => buildHomeChart({ state: optimisticState, elections, parties, sources }),
    [optimisticState, elections, parties, sources],
  );

  const regionName = useMemo(() => {
    const code = optimisticState.region;
    if (!code || code === "all") return "전국";
    return (
      emdOptions.find((e) => e.code === code)?.name ??
      filterOptions.regions.find((r) => r.code === code)?.name ??
      "전국"
    );
  }, [optimisticState.region, filterOptions.regions, emdOptions]);

  return (
    <div className="space-y-4">
      <HeaderControls
        state={optimisticState}
        onChange={handleChange}
        pending={pending}
        regions={filterOptions.regions}
        emdOptions={emdOptions}
        stationOptions={stationOptions}
        types={filterOptions.types}
        parties={filterOptions.parties}
        yearOptions={filterOptions.yearOptions}
      />
      <TimeseriesPanel data={data} lines={lines} regionName={regionName} />
      <StatsCards data={data} lines={lines} />
    </div>
  );
}
