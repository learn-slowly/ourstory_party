"use client";

import { useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import type { TableModel, RowData } from "./AdvancedTable.types";
import { formatCell, justiceCellBg, partyHeaderStyle } from "@/lib/table/cellFormatting";

interface Props {
  model: TableModel;
  sort: SortingState;
  visibility: Record<string, boolean>;
  globalFilter: string;
  onSortChange: (next: SortingState) => void;
  onVisibilityChange: (next: Record<string, boolean>) => void;
}

const columnHelper = createColumnHelper<RowData>();

export function AdvancedTable({
  model,
  sort,
  visibility,
  globalFilter,
  onSortChange,
  onVisibilityChange,
}: Props) {
  const columns = useMemo(
    () =>
      model.columns.map((c) => {
        if (c.id === "rowLabel") {
          return columnHelper.accessor((row) => row.label, {
            id: c.id,
            header: c.header,
            cell: (info) => info.getValue<string>(),
            sortingFn: "alphanumeric",
          });
        }
        return columnHelper.accessor((row) => row.cells[c.id] ?? null, {
          id: c.id,
          header: c.header,
          cell: (info) => formatCell(info.getValue<number | null>()),
          sortingFn: (a, b, colId) => {
            const av = a.original.cells[colId];
            const bv = b.original.cells[colId];
            // null 은 항상 뒤 (정렬 방향 무관)
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            return av - bv;
          },
        });
      }),
    [model.columns]
  );

  const table = useReactTable({
    data: model.rows,
    columns,
    state: {
      sorting: sort,
      columnVisibility: visibility,
      globalFilter,
    },
    onSortingChange: (updater) =>
      onSortChange(typeof updater === "function" ? updater(sort) : updater),
    onColumnVisibilityChange: (updater) =>
      onVisibilityChange(typeof updater === "function" ? updater(visibility) : updater),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _, filterValue: string) => {
      if (!filterValue) return true;
      return row.original.label.toLowerCase().includes(filterValue.toLowerCase());
    },
  });

  const rows = table.getRowModel().rows;
  if (rows.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-sm text-zinc-500">
        선택된 필터에 해당하는 데이터가 없습니다.
      </div>
    );
  }

  return (
    <div className="overflow-auto border border-zinc-200 dark:border-zinc-700 rounded">
      <table className="min-w-full text-sm border-collapse">
        <thead className="bg-zinc-50 dark:bg-zinc-800 sticky top-0 z-20">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const colDef = model.columns.find((c) => c.id === h.column.id);
                const isFirstCol = h.column.id === "rowLabel";
                const sorted = h.column.getIsSorted();
                return (
                  <th
                    key={h.id}
                    onClick={h.column.getToggleSortingHandler()}
                    style={partyHeaderStyle(colDef?.color)}
                    className={
                      "border border-zinc-200 dark:border-zinc-700 px-2 py-1 whitespace-nowrap cursor-pointer select-none " +
                      (isFirstCol
                        ? "text-left sticky left-0 bg-zinc-50 dark:bg-zinc-800 z-30 "
                        : "text-right ")
                    }
                  >
                    {!isFirstCol && colDef?.color && (
                      <span
                        className="inline-block w-2 h-2 rounded-sm mr-1 align-middle"
                        style={{ backgroundColor: colDef.color }}
                        aria-hidden
                      />
                    )}
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {sorted === "asc" ? " ▲" : sorted === "desc" ? " ▼" : ""}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
              {row.getVisibleCells().map((cell) => {
                const colDef = model.columns.find((c) => c.id === cell.column.id);
                const isFirstCol = cell.column.id === "rowLabel";
                const value = row.original.cells[cell.column.id] ?? null;
                const bg = colDef?.isJusticeParty ? justiceCellBg(value) : undefined;
                return (
                  <td
                    key={cell.id}
                    style={{
                      ...(bg ? { backgroundColor: bg } : {}),
                      ...(colDef?.isJusticeParty ? { fontWeight: 600 } : {}),
                    }}
                    className={
                      "border border-zinc-200 dark:border-zinc-700 px-2 py-1 tabular-nums whitespace-nowrap " +
                      (isFirstCol
                        ? "text-left sticky left-0 bg-white dark:bg-zinc-950 z-10 "
                        : "text-right ")
                    }
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
