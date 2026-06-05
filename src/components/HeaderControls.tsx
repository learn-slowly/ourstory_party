"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { HomeState } from "../lib/url-state";
import { encodeState } from "../lib/url-state";

interface RegionOpt { code: string; level: string; name: string; parentCode?: string | null; }

// state.region 으로부터 그 region 의 시·도 code 추출.
// "all" → "all", sido code (XX00000000) → 그 자체, sigungu code → 시·도 prefix(2) + 8 zeros.
function sidoOfRegion(rcode: string): string {
  if (rcode === "all") return "all";
  if (rcode.endsWith("00000000")) return rcode;
  return rcode.slice(0, 2) + "00000000";
}
interface PartyOpt { id: string; name: string; family: string; color: string; satelliteOf?: string | null; }

interface Props {
  state: HomeState;
  regions: RegionOpt[];
  types: string[];
  parties: PartyOpt[];
}

const TYPE_LABEL: Record<string, string> = {
  presidential: "대선",
  general: "총선 지역구",
  general_prop: "총선 비례",
  governor: "지선 광역단체장",
  mayor: "지선 시장군수",
  local_council: "광역의원 지역구",
  local_council_prop: "광역의원 비례",
  local_council_basic: "기초의원 지역구",
  local_council_basic_prop: "기초의원 비례",
  superintendent: "교육감",
};

export function HeaderControls({ state, regions, types, parties }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function push(next: HomeState) {
    const qs = encodeState(next);
    start(() => router.push(qs ? `/?${qs}` : "/"));
  }

  function toggleParty(pid: string) {
    const next = state.parties.includes(pid)
      ? state.parties.filter((x) => x !== pid)
      : [...state.parties, pid];
    push({ ...state, parties: next });
  }

  function toggleType(t: string) {
    const cur = state.types === "all" ? types : state.types;
    const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
    push({ ...state, types: next.length === types.length ? "all" : next });
  }

  const sidos = regions.filter((r) => r.level === "sido");
  const selSido = sidoOfRegion(state.region);
  // 선택된 시·도의 시·군·구 — code prefix(2) 일치 (parentCode 가 sido 가 아닌 sub-구 케이스도 포함하려면 prefix 필터가 더 안전)
  const sigungus = selSido === "all"
    ? []
    : regions
        .filter((r) => r.level === "sigungu" && r.code.slice(0, 2) === selSido.slice(0, 2))
        .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  function onSidoChange(next: string) {
    // 시·도 변경 시 시·군 reset to 시·도 전체 (또는 전국)
    push({ ...state, region: next });
  }

  function onSigunguChange(next: string) {
    // "all" → 시·도 전체 (state.region = selSido). 시·군 code 면 그대로.
    push({ ...state, region: next === "all" ? selSido : next });
  }

  return (
    <div className={`flex flex-wrap gap-3 items-center text-sm ${pending ? "opacity-60" : ""}`}>
      <label className="flex items-center gap-2">
        <span className="text-zinc-600 dark:text-zinc-400">지역</span>
        <select
          value={selSido}
          onChange={(e) => onSidoChange(e.target.value)}
          className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
        >
          <option value="all">전국</option>
          {sidos.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
        </select>
        <select
          value={state.region === selSido ? "all" : state.region}
          onChange={(e) => onSigunguChange(e.target.value)}
          disabled={selSido === "all"}
          className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 disabled:opacity-50"
        >
          <option value="all">(전체)</option>
          {sigungus.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
        </select>
      </label>

      <div className="flex flex-wrap gap-2">
        <span className="text-zinc-600 dark:text-zinc-400">선거유형</span>
        {types.map((t) => {
          const checked = state.types === "all" || state.types.includes(t);
          return (
            <label key={t} className="flex items-center gap-1">
              <input type="checkbox" checked={checked} onChange={() => toggleType(t)} />
              <span>{TYPE_LABEL[t] ?? t}</span>
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="text-zinc-600 dark:text-zinc-400">정당</span>
        {parties.filter((p) => p.id !== "independent" && p.id !== "other").map((p) => {
          const checked = state.parties.includes(p.id);
          return (
            <label key={p.id} className="flex items-center gap-1" style={{ color: checked ? p.color : undefined }}>
              <input type="checkbox" checked={checked} onChange={() => toggleParty(p.id)} />
              <span>{p.name}</span>
            </label>
          );
        })}
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={state.satellite === "merged"}
          onChange={(e) => push({ ...state, satellite: e.target.checked ? "merged" : "split" })}
        />
        <span>위성정당 합산</span>
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={state.mergeProgressive}
          onChange={(e) => push({ ...state, mergeProgressive: e.target.checked })}
        />
        <span>진보 합산 라인</span>
      </label>
    </div>
  );
}
