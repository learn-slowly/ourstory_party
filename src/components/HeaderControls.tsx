"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { HomeState } from "../lib/url-state";
import { encodeState } from "../lib/url-state";

interface RegionOpt { code: string; level: string; name: string; }
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

  return (
    <div className={`flex flex-wrap gap-3 items-center text-sm ${pending ? "opacity-60" : ""}`}>
      <label className="flex items-center gap-2">
        <span className="text-zinc-600 dark:text-zinc-400">지역</span>
        <select
          value={state.region}
          onChange={(e) => push({ ...state, region: e.target.value })}
          className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
        >
          <option value="all">전국</option>
          {sidos.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
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
