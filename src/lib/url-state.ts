export interface HomeState {
  region: string;
  types: string[] | "all";
  parties: string[];
  satellite: "split" | "merged";
  mergeProgressive: boolean;
  // 기간 필터 — YYYY 4자리. null/undefined 면 미적용 (전체).
  from?: string | null;
  to?: string | null;
}

export const DEFAULT_STATE: HomeState = {
  region: "all",
  types: "all",
  parties: ["justice", "labor", "green", "progressive"],
  satellite: "split",
  mergeProgressive: false,
  from: null,
  to: null,
};

// YYYY 4자리 검증 — 1948~2026 범위 (UI 옵션 한계 + URL 오염 방지).
function normalizeYear(v: string | undefined | null): string | null {
  if (v == null || v === "") return null;
  if (!/^\d{4}$/.test(v)) return null;
  const n = Number(v);
  if (n < 1948 || n > 2026) return null;
  return v;
}

export function parseSearchParams(sp: Record<string, string | undefined>): HomeState {
  if (sp.s) {
    try {
      const json = Buffer.from(sp.s, "base64url").toString("utf-8");
      const obj = JSON.parse(json);
      return { ...DEFAULT_STATE, ...obj };
    } catch {
      // 잘못된 압축 무시
    }
  }
  return {
    region: sp.region ?? DEFAULT_STATE.region,
    types: sp.types == null ? DEFAULT_STATE.types : sp.types.split(","),
    parties: sp.parties == null ? DEFAULT_STATE.parties : sp.parties.split(","),
    satellite: (sp.satellite as HomeState["satellite"]) ?? DEFAULT_STATE.satellite,
    mergeProgressive: sp.merge_prog === "1",
    from: normalizeYear(sp.from),
    to: normalizeYear(sp.to),
  };
}

export function encodeState(s: HomeState): string {
  const parts: string[] = [];
  if (s.region !== DEFAULT_STATE.region) parts.push(`region=${s.region}`);
  if (s.types !== DEFAULT_STATE.types && Array.isArray(s.types) && s.types.length > 0) {
    parts.push(`types=${s.types.join(",")}`);
  }
  if (JSON.stringify(s.parties) !== JSON.stringify(DEFAULT_STATE.parties)) {
    parts.push(`parties=${s.parties.join(",")}`);
  }
  if (s.satellite !== DEFAULT_STATE.satellite) parts.push(`satellite=${s.satellite}`);
  if (s.mergeProgressive) parts.push(`merge_prog=1`);
  if (s.from) parts.push(`from=${s.from}`);
  if (s.to) parts.push(`to=${s.to}`);
  return parts.join("&");
}
