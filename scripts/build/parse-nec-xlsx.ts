// scripts/build/parse-nec-xlsx.ts
// NEC 다운로드 raw xlsx → data/parsed/{electionId}.json 통합 변환 CLI.
import { writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { detectFormat } from "./lib/xlsx-format-detect";
import { parseFormatA } from "./lib/parse-format-a";
import { parseFormatB } from "./lib/parse-format-b";
import { parseFormatC } from "./lib/parse-format-c";
import { parseFormatD } from "./lib/parse-format-d";
import { parseFormatF } from "./lib/parse-format-f";
import { ParsedElection, ParsedStationRow } from "./lib/types";

interface ElectionMap {
  electionId: string;
  electionDate: string;
  rawDir: string;
  isProportional?: boolean;
}

const MAP: ElectionMap[] = [
  { electionId: "2012-presidential",      electionDate: "2012-12-19", rawDir: "data/raw/nec-downloads/presidential-2012" },
  { electionId: "2017-presidential",      electionDate: "2017-05-09", rawDir: "data/raw/nec-downloads/presidential-2017" },
  { electionId: "2022-presidential",      electionDate: "2022-03-09", rawDir: "data/raw/nec-downloads/presidential-all" },
  { electionId: "2025-presidential",      electionDate: "2025-06-03", rawDir: "data/raw/nec-downloads/presidential-2025" },
  { electionId: "2024-general",           electionDate: "2024-04-10", rawDir: "data/raw/nec-downloads/22-general" }, // 01_지역구 만 사용 — 추후 filter
  { electionId: "2024-general-prop",      electionDate: "2024-04-10", rawDir: "data/raw/nec-downloads/22-general", isProportional: true },
  { electionId: "2020-general",           electionDate: "2020-04-15", rawDir: "data/raw/nec-downloads/general-2020/지역구" },
  { electionId: "2020-general-prop",      electionDate: "2020-04-15", rawDir: "data/raw/nec-downloads/general-2020/비례대표", isProportional: true },
  { electionId: "2016-general",           electionDate: "2016-04-13", rawDir: "data/raw/nec-downloads/general-2016/지역구" },
  { electionId: "2016-general-prop",      electionDate: "2016-04-13", rawDir: "data/raw/nec-downloads/general-2016/비례대표", isProportional: true },
  { electionId: "2012-general",           electionDate: "2012-04-11", rawDir: "data/raw/nec-downloads/general-district-2012" },
  { electionId: "2012-general-prop",      electionDate: "2012-04-11", rawDir: "data/raw/nec-downloads/general-prop-2012", isProportional: true },
  { electionId: "2022-byelection",        electionDate: "2022-06-01", rawDir: "data/raw/nec-downloads/byelection-2022" },
];

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await listFiles(p)));
    else if (/\.(xlsx|xls)$/i.test(ent.name) && !ent.name.startsWith(".") && !ent.name.startsWith("~")) out.push(p);
  }
  return out;
}

async function parseElection(m: ElectionMap): Promise<ParsedElection> {
  const files = await listFiles(m.rawDir);
  const allRows: ParsedStationRow[] = [];
  const partySet = new Set<string>();
  for (const f of files) {
    // 22-general 디렉터리 안 = 지역구·비례·재보궐 혼재 — filename 으로 한 번 더 필터
    if (m.electionId === "2024-general" && !f.includes("지역구")) continue;
    if (m.electionId === "2024-general-prop" && !f.includes("비례대표")) continue;
    let parsed: ParsedElection;
    const fmt = detectFormat(f);
    if (fmt === "A") parsed = parseFormatA(f, { isProportional: !!m.isProportional });
    else if (fmt === "B") parsed = parseFormatB(f, { isProportional: !!m.isProportional });
    else if (fmt === "C") parsed = parseFormatC(f);
    else if (fmt === "D") parsed = parseFormatD(f);
    else if (fmt === "F") parsed = parseFormatF(f);
    else throw new Error(`unknown format ${fmt}`);
    allRows.push(...parsed.rows);
    parsed.partyNames.forEach((n) => partySet.add(n));
  }
  return { electionId: m.electionId, electionDate: m.electionDate, rows: allRows, partyNames: [...partySet] };
}

async function main() {
  const filter = process.argv[2];
  const targets = filter ? MAP.filter((m) => m.electionId === filter) : MAP;
  if (!existsSync("data/parsed")) await mkdir("data/parsed", { recursive: true });
  for (const m of targets) {
    console.log(`▶ ${m.electionId} (${m.rawDir})`);
    if (!existsSync(m.rawDir)) { console.warn(`  rawDir 없음 — skip`); continue; }
    const parsed = await parseElection(m);
    const out = path.join("data/parsed", `${m.electionId}.json`);
    await writeFile(out, JSON.stringify(parsed));  // 한 줄 — 파일 크기 ↓
    console.log(`  ✓ ${out}  rows=${parsed.rows.length}  parties=${parsed.partyNames.length}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
