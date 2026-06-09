"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ElectionPicker } from "./ElectionPicker";
import { RegionPartyDist } from "./RegionPartyDist";
import { RegionChildrenTable } from "./RegionChildrenTable";
import { PresubVsElDay } from "./PresubVsElDay";
import {
  buildRegionDistribution,
  buildChildrenTable,
  buildPresubVsElDay,
} from "@/lib/static-region";
import type {
  RegionFile,
  ElectionDetailFile,
  StaticIndex,
} from "@/types/static";
import type {
  RegionDistribution,
  ChildrenTable,
  PresubElDayResult,
} from "@/lib/region-types";

interface ElectionLike { id: string; name: string }

interface Props {
  regionCode: string;
  regionLevel: "sido" | "sigungu" | "emd";
  regionFile: RegionFile;
  index: StaticIndex;
  electionOptions: ElectionLike[];
  initialDist: RegionDistribution;
  initialTable: ChildrenTable | null;
  initialPresub: PresubElDayResult | null;
  initialElectionId: string;
}

// page.tsx 가 force-static 이라 ?election= 변경해도 server props 가 항상 첫 election.
// client side 로 selectedElectionId 를 track + dist/table/presub 재계산.
// emd 페이지가 아니면 election-{id}.json 을 client fetch.
export function RegionElectionSection({
  regionCode, regionLevel, regionFile, index, electionOptions,
  initialDist, initialTable, initialPresub, initialElectionId,
}: Props) {
  const searchParams = useSearchParams();
  const urlElectionId = searchParams.get("election");
  const validIds = useMemo(() => new Set(electionOptions.map((e) => e.id)), [electionOptions]);
  const currentElectionId = urlElectionId && validIds.has(urlElectionId) ? urlElectionId : initialElectionId;

  const [dist, setDist] = useState<RegionDistribution>(initialDist);
  const [table, setTable] = useState<ChildrenTable | null>(initialTable);
  const [presub, setPresub] = useState<PresubElDayResult | null>(initialPresub);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 첫 렌더링(currentElectionId === initialElectionId) 은 server props 그대로 사용 — skip
    if (currentElectionId === initialElectionId) return;

    // dist 는 regionFile.elections summary 로 바로 재계산 (fetch 불필요)
    const newDist = buildRegionDistribution(
      regionFile, currentElectionId, index.parties, index.elections,
    );
    setDist(newDist);

    // table/presub 는 emd 페이지에서는 표시 안 함 — fetch skip
    if (regionLevel === "emd") {
      setTable(null);
      setPresub(null);
      return;
    }

    // detail.json client fetch — Vercel CDN 정적 자산
    let cancelled = false;
    setLoading(true);
    fetch(`/data/static/region/${regionCode}/election-${currentElectionId}.json`, {
      cache: "force-cache",
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ElectionDetailFile>;
      })
      .then((detail) => {
        if (cancelled) return;
        setTable(buildChildrenTable(detail, index.parties, index, regionCode));
        setPresub(buildPresubVsElDay(detail, index, regionCode));
      })
      .catch(() => {
        if (cancelled) return;
        setTable({ children: [], partyColumns: [] });
        setPresub({ hasData: false, rows: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentElectionId]);

  const currentElectionName = useMemo(
    () => electionOptions.find((e) => e.id === currentElectionId)?.name ?? "",
    [electionOptions, currentElectionId],
  );

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold">
          {regionFile.name}
          <span className="text-zinc-400 mx-2">·</span>
          <span className="text-zinc-700 dark:text-zinc-300">{currentElectionName}</span>
        </h1>
        <ElectionPicker selectedId={currentElectionId} options={electionOptions} regionCode={regionCode} />
        {loading && <span className="text-xs text-zinc-400">불러오는 중…</span>}
      </div>

      <RegionPartyDist dist={dist} />

      {table && <RegionChildrenTable table={table} electionId={currentElectionId} />}

      {presub && regionLevel !== "emd" && <PresubVsElDay presub={presub} />}
    </>
  );
}
