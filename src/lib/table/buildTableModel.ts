import type { ChartRow, ChartLine } from "../series";
import type { Mode, TableModel, ColumnDef, RowData } from "@/components/table/AdvancedTable.types";

interface TimeseriesCtx {
  rows: ChartRow[];
  lines: ChartLine[];
  regionName: string;
}

// timeseries 모드 — ChartRow/ChartLine 을 TableModel 로 어댑트.
// Phase 6.2 에서 region 모드 분기 추가 예정.
export function buildTableModel(mode: Mode, ctx: TimeseriesCtx): TableModel {
  if (mode !== "timeseries") {
    throw new Error(`mode ${mode} 는 Phase 6.2 에서 지원`);
  }

  const { rows, lines, regionName } = ctx;

  // 컬럼: rowLabel + 정의당 강제 우선 + 나머지 lines 순서
  const justiceLine = lines.find((l) => l.partyId === "justice");
  const otherLines = lines.filter((l) => l.partyId !== "justice");

  const columns: ColumnDef[] = [
    { id: "rowLabel", header: "선거", align: "left" },
    ...(justiceLine
      ? [{
          id: "justice",
          header: justiceLine.name,
          color: justiceLine.color,
          isJusticeParty: true,
          align: "right" as const,
        }]
      : []),
    ...otherLines.map((l) => ({
      id: l.partyId,
      header: l.name,
      color: l.color,
      align: "right" as const,
    })),
  ];

  // rows: ChartRow → RowData. 미출마/잘못된 값 = null
  const rowData: RowData[] = rows.map((r) => {
    const cells: Record<string, number | null> = {};
    for (const l of lines) {
      const v = r[l.partyId];
      cells[l.partyId] = typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    return { id: r.electionId, label: r.electionLabel, cells };
  });

  return {
    columns,
    rows: rowData,
    meta: { mode, regionName },
  };
}
