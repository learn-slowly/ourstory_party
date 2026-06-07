// 정당색 헤더, 정의당 셀 그라데이션, 미출마 셀 표시 — AdvancedTable·exportXlsx 공용.
import type { CSSProperties } from "react";

export function justiceCellBg(value: number | null): string {
  if (value == null || value <= 0) return "transparent";
  // 0~50% 를 0.1~0.9 알파로 매핑. clamp.
  const alpha = Math.min(0.9, 0.1 + (value / 50) * 0.8);
  return `rgba(255, 204, 0, ${alpha})`;
}

export function partyHeaderStyle(color: string | undefined): CSSProperties {
  return color ? { borderTopColor: color, borderTopWidth: 3 } : {};
}

export function formatCell(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}
