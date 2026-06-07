import type { TableModel } from "@/components/table/AdvancedTable.types";

// TableModel → CSV 문자열 (BOM 포함). 호출자가 Blob → a.download 처리.
// HomeTable.tsx 의 downloadCsv 로직을 모델 기반으로 이관.
export function buildCsvString(model: TableModel): string {
  const head = model.columns.map((c) => c.header);
  const body = model.rows.map((r) => [
    r.label,
    ...model.columns
      .filter((c) => c.id !== "rowLabel")
      .map((c) => {
        const v = r.cells[c.id];
        return typeof v === "number" ? v.toFixed(1) : "";
      }),
  ]);

  const csv = [head, ...body]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  return "﻿" + csv;
}

// 브라우저 다운로드 트리거. 테스트 대상 외 — buildCsvString 만 단위 테스트.
export function downloadCsv(model: TableModel, filename: string): void {
  const csv = buildCsvString(model);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
