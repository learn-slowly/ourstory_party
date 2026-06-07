"use client";

import { useMemo, useState } from "react";
import type { SortingState } from "@tanstack/react-table";
import { HomeChart } from "./HomeChart";
import { AdvancedTable } from "./table/AdvancedTable";
import { TableToolbar } from "./table/TableToolbar";
import { buildTableModel } from "@/lib/table/buildTableModel";
import type { ChartRow, ChartLine } from "../lib/series";

interface Props {
  data: ChartRow[];
  lines: ChartLine[];
  regionName?: string; // 시트명·파일명에 사용
}

// 차트/표 토글 + AdvancedTable + 다운로드 버튼. 홈·region 페이지 둘 다 사용.
export function TimeseriesPanel({ data, lines, regionName = "전국" }: Props) {
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");
  const [sort, setSort] = useState<SortingState>([]);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  const model = useMemo(
    () => buildTableModel("timeseries", { rows: data, lines, regionName }),
    [data, lines, regionName]
  );

  const safeName = regionName.replace(/[/\\?%*:|"<>]/g, "_");
  const csvFilename = `시계열_${safeName}.csv`;
  const xlsxFilename = `시계열_${safeName}.xlsx`;

  return (
    <>
      <div className="flex items-center gap-1 flex-wrap">
        <div className="inline-flex rounded border border-zinc-300 dark:border-zinc-700 overflow-hidden">
          <button
            type="button"
            onClick={() => setViewMode("chart")}
            className={`px-3 py-1 text-sm ${
              viewMode === "chart"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-white text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
            }`}
            aria-pressed={viewMode === "chart"}
          >
            차트
          </button>
          <button
            type="button"
            onClick={() => setViewMode("table")}
            className={`px-3 py-1 text-sm border-l border-zinc-300 dark:border-zinc-700 ${
              viewMode === "table"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-white text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
            }`}
            aria-pressed={viewMode === "table"}
          >
            표
          </button>
        </div>
      </div>

      {viewMode === "chart" ? (
        <HomeChart data={data} lines={lines} />
      ) : (
        <>
          <TableToolbar
            model={model}
            search={search}
            visibility={visibility}
            onSearchChange={setSearch}
            onVisibilityChange={setVisibility}
            csvFilename={csvFilename}
            xlsxFilename={xlsxFilename}
          />
          <AdvancedTable
            model={model}
            sort={sort}
            visibility={visibility}
            globalFilter={search}
            onSortChange={setSort}
            onVisibilityChange={setVisibility}
          />
        </>
      )}
    </>
  );
}
