"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { buildRegionUrl } from "./election-picker-url";

interface ElectionOption {
  id: string;
  name: string;
}

interface Props {
  selectedId: string;
  options: ElectionOption[];
  regionCode: string;
}

export function ElectionPicker({ selectedId, options, regionCode }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-zinc-500">선거</span>
      <select
        value={selectedId}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(() => {
            router.push(buildRegionUrl(regionCode, next));
          });
        }}
        className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      {pending && <span className="text-zinc-400 text-xs">…</span>}
    </label>
  );
}
