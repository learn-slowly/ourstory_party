export interface HomeState {
  region: string;
  types: string[] | "all";
  parties: string[];
  satellite: "split" | "merged";
  mergeProgressive: boolean;
}

export const DEFAULT_STATE: HomeState = {
  region: "all",
  types: "all",
  parties: ["justice", "labor", "green", "progressive"],
  satellite: "split",
  mergeProgressive: false,
};

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
  return parts.join("&");
}
