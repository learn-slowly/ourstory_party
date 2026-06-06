"use client";

import { useState } from "react";
import { HomeChart } from "./HomeChart";
import { HomeTable, downloadCsv } from "./HomeTable";
import type { ChartRow, ChartLine } from "../lib/series";

interface Props {
  data: ChartRow[];
  lines: ChartLine[];
  csvFilename?: string;
}

// 차트/표 토글 + CSV 버튼 + chart 또는 table 렌더.
// viewMode 는 컴포넌트 내부 상태 (URL 비동기화). 홈·region 페이지 둘 다 이 컴포넌트 사용.
export function TimeseriesPanel({ data, lines, csvFilename = "timeseries.csv" }: Props) {
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");

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
        {viewMode === "table" && data.length > 0 && (
          <button
            type="button"
            onClick={() => downloadCsv(data, lines, csvFilename)}
            className="ml-2 px-3 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            CSV 저장
          </button>
        )}
      </div>
      {viewMode === "chart" ? (
        <HomeChart data={data} lines={lines} />
      ) : (
        <HomeTable data={data} lines={lines} />
      )}
    </>
  );
}
