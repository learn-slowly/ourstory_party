"use client";

import { useMemo } from "react";
import type { HomeState } from "../lib/url-state";

interface RegionOpt { code: string; level: string; name: string; parentCode?: string | null; }
interface EmdOpt { code: string; name: string; }
interface StationOpt { sigunguCode: string; emdCode: string; name: string; }
interface PartyOpt { id: string; name: string; family: string; color: string; satelliteOf?: string | null; }

// state.region 분류 — picker cascading 에 사용.
function sidoOfRegion(rcode: string): string {
  if (rcode === "all" || !rcode) return "all";
  if (rcode.startsWith("station:")) {
    const sigungu = rcode.split(":")[1] ?? "";
    return sigungu ? sigungu.slice(0, 2) + "00000000" : "all";
  }
  if (rcode.startsWith("9")) return rcode.slice(1, 3) + "00000000";
  if (rcode.endsWith("00000000")) return rcode;
  return rcode.slice(0, 2) + "00000000";
}
function sigunguOfRegion(rcode: string): string | null {
  if (rcode === "all" || !rcode) return null;
  if (rcode.startsWith("station:")) return rcode.split(":")[1] ?? null;
  if (rcode.startsWith("9")) return rcode.slice(1, 6) + "00000";
  if (!/^\d{10}$/.test(rcode)) return null;
  if (rcode.endsWith("00000000")) return null;
  if (rcode.endsWith("00000")) return rcode;
  return rcode.slice(0, 5) + "00000"; // legal emd → parent sigungu
}
function emdOfRegion(rcode: string): string | null {
  if (rcode === "all" || !rcode) return null;
  if (rcode.startsWith("station:")) return rcode.split(":")[2] ?? null;
  if (rcode.startsWith("9")) return rcode;
  if (!/^\d{10}$/.test(rcode)) return null;
  if (rcode.endsWith("00000")) return null;
  if (rcode.endsWith("00")) return rcode;
  return null;
}
function stationNameOf(rcode: string): string | null {
  if (!rcode.startsWith("station:")) return null;
  const parts = rcode.split(":");
  return parts.slice(3).join(":") || null;
}

interface Props {
  state: HomeState;
  onChange: (next: HomeState) => void;
  pending?: boolean;
  regions: RegionOpt[];
  emdOptions: EmdOpt[];
  stationOptions: StationOpt[];
  types: string[];
  parties: PartyOpt[];
  yearOptions: string[];
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

// state owner 는 HomeView. 여기서는 controlled component 로 state + onChange 만 받음.
// 정당/유형/기간 토글은 즉시 onChange 호출 → HomeView 가 useMemo 로 chart 재계산 (즉시 반영).
// region 토글도 동일하지만, HomeView 에서 server roundtrip 트리거 (다른 region.json fetch).
export function HeaderControls({ state, onChange, pending, regions, emdOptions, stationOptions, types, parties, yearOptions }: Props) {
  function toggleParty(pid: string) {
    const next = state.parties.includes(pid)
      ? state.parties.filter((x) => x !== pid)
      : [...state.parties, pid];
    onChange({ ...state, parties: next });
  }

  function toggleType(t: string) {
    const cur = state.types === "all" ? types : state.types;
    const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
    onChange({ ...state, types: next.length === types.length ? "all" : next });
  }

  const sidos = regions.filter((r) => r.level === "sido");
  const selSido = useMemo(() => sidoOfRegion(state.region), [state.region]);
  const selSigungu = useMemo(() => sigunguOfRegion(state.region), [state.region]);
  const selEmd = useMemo(() => emdOfRegion(state.region), [state.region]);
  const selStation = useMemo(() => stationNameOf(state.region), [state.region]);

  const sigungus = selSido === "all"
    ? []
    : regions
        .filter((r) => r.level === "sigungu" && r.code.slice(0, 2) === selSido.slice(0, 2))
        .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  function onSidoChange(next: string) {
    onChange({ ...state, region: next });
  }
  function onSigunguChange(next: string) {
    onChange({ ...state, region: next === "all" ? selSido : next });
  }
  function onEmdChange(next: string) {
    // emd "(전체)" 선택 시 sigungu 단위로 복귀
    onChange({ ...state, region: next === "all" ? (selSigungu ?? selSido) : next });
  }
  function onStationChange(next: string) {
    // station "(전체)" 선택 시 emd 단위로 복귀
    if (next === "all") {
      onChange({ ...state, region: selEmd ?? selSigungu ?? selSido });
      return;
    }
    // next 는 station name. emd + sigungu code 와 합성
    const sigungu = selSigungu ?? "";
    const emd = selEmd ?? "";
    onChange({ ...state, region: `station:${sigungu}:${emd}:${next}` });
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
          value={selSigungu ?? "all"}
          onChange={(e) => onSigunguChange(e.target.value)}
          disabled={selSido === "all"}
          className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 disabled:opacity-50"
        >
          <option value="all">(전체)</option>
          {sigungus.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
        </select>
        <select
          value={selEmd ?? "all"}
          onChange={(e) => onEmdChange(e.target.value)}
          disabled={!selSigungu || emdOptions.length === 0}
          className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 disabled:opacity-50"
        >
          <option value="all">(전체)</option>
          {emdOptions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
        </select>
        <select
          value={selStation ?? "all"}
          onChange={(e) => onStationChange(e.target.value)}
          disabled={!selEmd || stationOptions.length === 0}
          className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 disabled:opacity-50"
        >
          <option value="all">(전체)</option>
          {stationOptions.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
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
          onChange={(e) => onChange({ ...state, satellite: e.target.checked ? "merged" : "split" })}
        />
        <span>위성정당 합산</span>
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={state.mergeProgressive}
          onChange={(e) => onChange({ ...state, mergeProgressive: e.target.checked })}
        />
        <span>진보 합산 라인</span>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-zinc-600 dark:text-zinc-400">기간</span>
        <select
          value={state.from ?? ""}
          onChange={(e) => {
            const next = e.target.value === "" ? null : e.target.value;
            // from > to 이면 to 도 같이 풀어줌 (사용자 혼란 방지)
            const nextTo = next && state.to && next > state.to ? null : (state.to ?? null);
            onChange({ ...state, from: next, to: nextTo });
          }}
          className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
        >
          <option value="">전체</option>
          {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <span className="text-zinc-400">~</span>
        <select
          value={state.to ?? ""}
          onChange={(e) => {
            const next = e.target.value === "" ? null : e.target.value;
            const nextFrom = next && state.from && state.from > next ? null : (state.from ?? null);
            onChange({ ...state, to: next, from: nextFrom });
          }}
          className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
        >
          <option value="">전체</option>
          {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
    </div>
  );
}
