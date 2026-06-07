"use client";

import { useState } from "react";
import type { TableModel } from "./AdvancedTable.types";
import { downloadCsv } from "@/lib/table/exportCsv";
import { downloadXlsx } from "@/lib/table/exportXlsx";

interface Props {
  model: TableModel;
  search: string;
  visibility: Record<string, boolean>;
  onSearchChange: (next: string) => void;
  onVisibilityChange: (next: Record<string, boolean>) => void;
  csvFilename: string;
  xlsxFilename: string;
}

export function TableToolbar({
  model,
  search,
  visibility,
  onSearchChange,
  onVisibilityChange,
  csvFilename,
  xlsxFilename,
}: Props) {
  const [xlsxError, setXlsxError] = useState<string | null>(null);
  const [xlsxLoading, setXlsxLoading] = useState(false);

  const handleXlsx = async () => {
    setXlsxError(null);
    setXlsxLoading(true);
    try {
      await downloadXlsx(model, xlsxFilename);
    } catch (err) {
      console.error("xlsx export 실패", err);
      setXlsxError("엑셀 라이브러리 로드 실패 — CSV 로 받아보세요");
    } finally {
      setXlsxLoading(false);
    }
  };

  const partyCols = model.columns.filter((c) => c.id !== "rowLabel");

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="행 검색"
        className="px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 w-40"
        aria-label="표 행 검색"
      />

      <details className="relative">
        <summary className="cursor-pointer px-3 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
          정당 ({partyCols.filter((c) => visibility[c.id] !== false).length}/{partyCols.length})
        </summary>
        <div className="absolute z-20 mt-1 p-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded shadow max-h-64 overflow-auto whitespace-nowrap">
          {partyCols.map((c) => (
            <label key={c.id} className="flex items-center gap-1 text-sm py-0.5">
              <input
                type="checkbox"
                checked={visibility[c.id] !== false}
                onChange={(e) => onVisibilityChange({ ...visibility, [c.id]: e.target.checked })}
              />
              <span
                className="inline-block w-2 h-2 rounded-sm"
                style={{ backgroundColor: c.color }}
                aria-hidden
              />
              {c.header}
            </label>
          ))}
        </div>
      </details>

      <button
        type="button"
        onClick={() => downloadCsv(model, csvFilename)}
        disabled={model.rows.length === 0}
        className="px-3 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-50"
      >
        CSV 저장
      </button>

      <button
        type="button"
        onClick={handleXlsx}
        disabled={model.rows.length === 0 || xlsxLoading}
        className="px-3 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-50"
      >
        {xlsxLoading ? "준비 중…" : "엑셀(.xlsx) 저장"}
      </button>

      {xlsxError && (
        <span role="alert" className="text-sm text-red-600 dark:text-red-400">
          {xlsxError}
        </span>
      )}
    </div>
  );
}
