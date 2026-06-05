import Link from "next/link";
import type { regions as regionsTable } from "../../../db/schema";

type RegionRow = typeof regionsTable.$inferSelect;

interface Props {
  ancestors: RegionRow[];
  current: RegionRow;
  electionQuery?: string; // ?election=... 유지
}

export function Breadcrumb({ ancestors, current, electionQuery }: Props) {
  const q = electionQuery ? `?election=${encodeURIComponent(electionQuery)}` : "";
  return (
    <nav className="text-sm text-zinc-500 mb-1" aria-label="region breadcrumb">
      {ancestors.map((a) => (
        <span key={a.code}>
          <Link href={`/region/${a.code}${q}`} className="hover:text-zinc-900 dark:hover:text-zinc-100">
            {a.name}
          </Link>
          <span className="mx-1">▸</span>
        </span>
      ))}
      <span className="text-zinc-900 dark:text-zinc-100 font-semibold">{current.name}</span>
    </nav>
  );
}
