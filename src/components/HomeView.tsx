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
  // force-static 일 때 server 가 보내는 state 는 항상 default("all"). useEffect 로
  // server state 를 reset 하면 picker UI 가 매번 "전국" 으로 되돌아가는 버그.
  // client 의 router.push 만으로 URL 동기 충분 → 외부 state prop 변화에 따른 sync 제거.
  const [optimisticState, setOptimisticState] = useState<HomeState>(state);

  function handleChange(next: HomeState) {
    setOptimisticState(next);
    const qs = encodeState(next);
    startTransition(() => router.push(qs ? `/?${qs}` : "/"));
  }

  // page.tsx 가 force-static 이라 server 는 default(state.region="all") sources 만 prerender.
  // region 변경 시 client 에서 직접 /data/static/region/{code}.json 을 fetch 해 clientSources 로 교체.
  // (station: 형식은 별도 매핑이 필요해 이번 fix 범위 밖.)
  const [clientSources, setClientSources] = useState<ChartSource[]>(sources);
  useEffect(() => setClientSources(sources), [sources]);

  useEffect(() => {
    const code = optimisticState.region;
    if (!code || code === "all") {
      setClientSources(sources);
      return;
    }
    if (code.startsWith("station:")) {
      return; // station 단위 미지원 (별도 후속)
    }
    let cancelled = false;
    fetch(`/data/static/region/${code}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`region.json ${r.status}`))))
      .then((f: { timeseries: Record<string, TimeseriesPoint[]> }) => {
        if (!cancelled) setClientSources([{ timeseries: f.timeseries }]);
      })
      .catch(() => {
        if (!cancelled) setClientSources([]);
      });
    return () => {
      cancelled = true;
    };
  }, [optimisticState.region, sources]);

  // client-side chart 재계산. 정당/types/기간/위성/진보합산 토글 시 즉시 반영.
  const { data, lines } = useMemo(
    () => buildHomeChart({ state: optimisticState, elections, parties, sources: clientSources }),
    [optimisticState, elections, parties, clientSources],
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
