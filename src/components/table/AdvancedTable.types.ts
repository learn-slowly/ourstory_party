// AdvancedTable 공용 타입. spec § "보조 타입 정의" 참조.

export type Mode = "timeseries" | "region";

// SortState 는 Phase 6.2 의 URL 쿼리(?sort=정의:desc) ↔ state 변환용.
// Plan 1 에서는 AdvancedTable 내부에서 TanStack 의 SortingState 를 직접 쓰므로
// 정의만 해두고 사용은 Phase 6.2 에서.
export type SortState = { colId: string; dir: "asc" | "desc" };

export interface ColumnDef {
  id: string;               // partyId 또는 "rowLabel"
  header: string;           // 표시명
  color?: string;           // 정당색 (parties.json)
  isJusticeParty?: boolean;
  align?: "left" | "right";
}

export interface RowData {
  id: string;               // electionId(시계열) 또는 regionCode(지역, Phase 6.2)
  label: string;            // 행 라벨
  href?: string;            // drilldown 링크 (지역 모드 — Phase 6.2)
  cells: Record<string, number | null>; // colId → 득표율 (null = 미출마)
}

export interface TableModel {
  columns: ColumnDef[];
  rows: RowData[];
  meta: {
    mode: Mode;
    regionName: string;
    electionLabel?: string;
  };
}
