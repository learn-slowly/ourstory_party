import type { TableModel } from "@/components/table/AdvancedTable.types";

// 색 hex (예: #FFCC00) → exceljs argb (예: FFFFCC00).  #-제거 + 알파 FF prepend.
function toArgb(hex: string): string {
  const clean = hex.replace(/^#/, "").toUpperCase();
  return `FF${clean}`;
}

// 빌드만 — 다운로드 트리거는 downloadXlsx. 테스트는 buildWorkbook 만 검증.
export async function buildWorkbook(model: TableModel) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const sheetName = `${model.meta.mode === "timeseries" ? "시계열" : "지역"}_${model.meta.regionName}`;
  const ws = wb.addWorksheet(sheetName.slice(0, 31)); // Excel 시트명 31자 제한

  // 헤더
  const headerRow = ws.addRow(model.columns.map((c) => c.header));
  model.columns.forEach((c, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.font = { bold: true };
    if (c.color) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: toArgb(c.color) },
      };
      cell.font = { ...cell.font, color: { argb: "FFFFFFFF" } };
    }
  });

  // 데이터 행
  for (const r of model.rows) {
    const values: (string | number | null)[] = [r.label];
    for (const c of model.columns) {
      if (c.id === "rowLabel") continue;
      const v = r.cells[c.id];
      values.push(typeof v === "number" ? v : null);
    }
    const row = ws.addRow(values);
    model.columns.forEach((c, idx) => {
      if (c.id === "rowLabel") return;
      const cell = row.getCell(idx + 1);
      const v = r.cells[c.id];
      if (typeof v === "number") cell.numFmt = "0.0";
      if (c.isJusticeParty && typeof v === "number" && v > 0) {
        // 정의당 셀: 노란색 알파. exceljs 는 RGBA 직접 안 됨 — 강도별 hex 사용.
        const alpha = Math.min(0.9, 0.1 + (v / 50) * 0.8);
        // 흰색 ↔ #FFCC00 사이 보간. 알파 0~1 → 흰색 비율 (1-alpha).
        const r2 = Math.round(255 * (1 - alpha) + 255 * alpha);
        const g2 = Math.round(255 * (1 - alpha) + 204 * alpha);
        const b2 = Math.round(255 * (1 - alpha) + 0 * alpha);
        const hex = `${r2.toString(16).padStart(2, "0")}${g2.toString(16).padStart(2, "0")}${b2.toString(16).padStart(2, "0")}`.toUpperCase();
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: `FF${hex}` },
        };
      }
    });
  }

  // 열 너비
  ws.columns = model.columns.map((c) => ({
    width: c.id === "rowLabel" ? 28 : 12,
  }));

  // freeze: 첫 행·첫 열 고정
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];

  return wb;
}

// 브라우저 다운로드 트리거.
export async function downloadXlsx(model: TableModel, filename: string): Promise<void> {
  const wb = await buildWorkbook(model);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
