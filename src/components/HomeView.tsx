"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { HeaderControls } from "./HeaderControls";
import { StatsCards } from "./StatsCards";
import { TimeseriesPanel } from "./TimeseriesPanel";
import { buildHomeChart } from "../lib/static-series";
import { encodeState, parseSearchParams, type HomeState } from "../lib/url-state";
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
  regionIndex?: import("../types/static").StaticIndex["regions"];
}

export function HomeView({ state, filterOptions, emdOptions: emdOptionsFromServer, stationOptions: stationOptionsFromServer, sources, elections, parties, regionIndex }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Optimistic state — 토글 즉시 local 반영. URL 갱신 (server roundtrip) 은 background.
  // server 가 새 state 로 region.json 을 다시 보내면 useEffect 로 sync.
  // force-static 일 때 server 가 보내는 state 는 항상 default("all"). useEffect 로
  // server state 를 reset 하면 picker UI 가 매번 "전국" 으로 되돌아가는 버그.
  // client 의 router.push 만으로 URL 동기 충분 → 외부 state prop 변화에 따른 sync 제거.
  const [optimisticState, setOptimisticState] = useState<HomeState>(state);

  // 공유 URL 직접 진입 (예: ?region=4812312700) 시 picker 상태 복원 — mount 1회만.
  // page.tsx 가 force-static 이라 server props 는 항상 default. client mount 시 실제 URL 파싱해서 동기화.
  const searchParams = useSearchParams();
  useEffect(() => {
    const flat: Record<string, string | undefined> = {};
    searchParams.forEach((v, k) => { flat[k] = v; });
    const parsed = parseSearchParams(flat);
    setOptimisticState(parsed);
    // mount 1회만 — 이후 사용자 picker 조작은 router.push 로 URL 갱신, optimisticState 는 controlled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChange(next: HomeState) {
    setOptimisticState(next);
    const qs = encodeState(next);
    startTransition(() => router.push(qs ? `/?${qs}` : "/"));
  }

  const emdOptions = useMemo(() => {
    if (!regionIndex?.emdByRegion) return emdOptionsFromServer;
    const code = optimisticState.region;
    let sigunguCode: string | null = null;
    if (code.startsWith("station:")) sigunguCode = code.split(":")[1] ?? null;
    else if (/^\d{10}$/.test(code) && code.endsWith("00000") && !code.endsWith("00000000")) {
      sigunguCode = code;
    } else if (/^\d{10}$/.test(code) && code.endsWith("00") && !code.endsWith("00000")) {
      sigunguCode = code.slice(0, 5) + "00000";
    } else if (code.startsWith("9")) {
      sigunguCode = code.slice(1, 6) + "00000";
    }
    if (!sigunguCode) return [];
    const list = regionIndex.emdByRegion[sigunguCode] ?? [];
    return list.map((r) => ({ code: r.code, name: r.name }));
  }, [regionIndex, optimisticState.region, emdOptionsFromServer]);

  const stationOptions = useMemo(() => {
    if (!regionIndex?.stationListByEmd) return stationOptionsFromServer;
    const code = optimisticState.region;
    let emdCode: string | null = null;
    if (code.startsWith("station:")) emdCode = code.split(":")[2] ?? null;
    else if (/^\d{10}$/.test(code) && code.endsWith("00") && !code.endsWith("00000")) emdCode = code;
    else if (code.startsWith("9")) emdCode = code;
    if (!emdCode) return [];
    const names = regionIndex.stationListByEmd[emdCode] ?? [];
    const sigunguCode = code.startsWith("station:")
      ? code.split(":")[1]
      : emdCode.startsWith("9")
        ? emdCode.slice(1, 6) + "00000"
        : emdCode.slice(0, 5) + "00000";
    return names.map((n) => ({ sigunguCode, emdCode: emdCode!, name: n }));
  }, [regionIndex, optimisticState.region, stationOptionsFromServer]);

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
    let cancelled = false;
    let url: string;
    if (code.startsWith("station:")) {
      const [, sigunguCode, emdCode, ...rest] = code.split(":");
      const stationName = rest.join(":");
      const sigungus = regionIndex
        ? Object.values(regionIndex.sigunguByRegion).flat()
        : [];
      const sigunguMeta = sigungus.find((s) => s.code === sigunguCode);
      const emds = regionIndex?.emdByRegion?.[sigunguCode] ?? [];
      const emdMeta = emds.find((e) => e.code === emdCode);
      if (!sigunguMeta || !emdMeta || !stationName) {
        setClientSources([]);
        return;
      }
      const safeName = `${sigunguMeta.name}-${emdMeta.name}-${stationName}`.replace(/[\/\\]/g, "_");
      url = `/data/static/station/${encodeURIComponent(safeName)}.json`;
    } else {
      url = `/data/static/region/${code}.json`;
    }
    fetch(url)
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
  }, [optimisticState.region, sources, regionIndex]);

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
      {/* region 페이지 (10자리 법정동 코드) 로 가는 진입 링크 — sido/sigungu/emd 만, station 제외 */}
      {optimisticState.region !== "all" && /^\d{10}$/.test(optimisticState.region) && (
        <div className="text-sm">
          <Link
            href={`/region/${optimisticState.region}`}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <span>{regionName} 상세 분석</span>
            <span className="text-zinc-500">— 후보자별 득표·관내사전 vs 선거일 비교</span>
            <span aria-hidden>→</span>
          </Link>
        </div>
      )}
      <TimeseriesPanel data={data} lines={lines} regionName={regionName} />
      <StatsCards data={data} lines={lines} />
    </div>
  );
}
