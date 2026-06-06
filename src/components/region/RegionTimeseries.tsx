"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HeaderControls } from "../HeaderControls";
import { TimeseriesPanel } from "../TimeseriesPanel";
import { buildHomeChart } from "@/lib/static-series";
import { encodeState, type HomeState } from "@/lib/url-state";
import type { ElectionMeta, PartyMeta, TimeseriesPoint } from "@/types/static";

interface PartyOpt {
  id: string;
  name: string;
  family: string;
  color: string;
  satelliteOf?: string | null;
}

interface Props {
  regionCode: string;
  regionName: string;
  timeseries: Record<string, TimeseriesPoint[]>;
  initialState: HomeState;
  filterOptions: {
    types: string[];
    parties: PartyOpt[];
    yearOptions: string[];
  };
  elections: ElectionMeta[];
  parties: PartyMeta[];
}

// region 페이지의 시계열 섹션. 홈과 동일한 buildHomeChart + HeaderControls + TimeseriesPanel 재사용.
// 차이: 지역은 URL path 로 고정 (hideRegionPicker), region 페이지의 다른 쿼리(?election=) 보존.
export function RegionTimeseries({
  regionCode,
  regionName,
  timeseries,
  initialState,
  filterOptions,
  elections,
  parties,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // optimistic state — 토글 즉시 local 반영. URL 갱신은 background.
  const [optimisticState, setOptimisticState] = useState<HomeState>(initialState);
  useEffect(() => setOptimisticState(initialState), [initialState]);

  // 단일 source — 이 region 의 timeseries 만.
  const sources = useMemo(() => [{ timeseries }], [timeseries]);

  const { data, lines } = useMemo(
    () => buildHomeChart({ state: optimisticState, elections, parties, sources }),
    [optimisticState, elections, parties, sources],
  );

  function handleChange(next: HomeState) {
    setOptimisticState(next);
    const qs = encodeState(next);
    // 기존 ?election= 보존
    const election = searchParams.get("election");
    const params = new URLSearchParams(qs);
    if (election) params.set("election", election);
    const url =
      [...params.keys()].length > 0
        ? `/region/${regionCode}?${params.toString()}`
        : `/region/${regionCode}`;
    startTransition(() => router.push(url));
  }

  return (
    <section
      aria-labelledby="sec-series"
      className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-3"
    >
      <h2 id="sec-series" className="text-sm font-semibold">
        시계열 — {regionName}
      </h2>
      <HeaderControls
        state={optimisticState}
        onChange={handleChange}
        pending={pending}
        regions={[]}
        emdOptions={[]}
        stationOptions={[]}
        types={filterOptions.types}
        parties={filterOptions.parties}
        yearOptions={filterOptions.yearOptions}
        hideRegionPicker
      />
      <TimeseriesPanel
        data={data}
        lines={lines}
        csvFilename={`timeseries-${regionName}.csv`}
      />
    </section>
  );
}
