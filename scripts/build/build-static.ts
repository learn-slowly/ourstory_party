// scripts/build/build-static.ts
// 통합 정적 빌드 CLI — parsed/*.json + seed → public/data/static/{index,region/*,station/*}.json
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildIndex } from "./lib/build-index";
import { buildRegionFiles } from "./lib/build-region";
import { buildElectionDetail } from "./lib/build-election-detail";
import { buildStations } from "./lib/build-station";
import { ParsedElection } from "./lib/types";

const OUT = "public/data/static";

async function loadParsed(): Promise<Map<string, ParsedElection>> {
  const m = new Map<string, ParsedElection>();
  if (!existsSync("data/parsed")) return m;
  for (const f of await readdir("data/parsed")) {
    if (!f.endsWith(".json")) continue;
    const parsed: ParsedElection = JSON.parse(
      await readFile(path.join("data/parsed", f), "utf-8"),
    );
    m.set(parsed.electionId, parsed);
  }
  return m;
}

async function loadRegionCodeMap(): Promise<Map<string, string>> {
  // data/seed/regions.json: { sido: [{code,name}], sigunguByRegion: {sidoCode: [{code,name}]}, emdByRegion: {sigunguCode: [{code,name}]} }
  const regions = JSON.parse(await readFile("data/seed/regions.json", "utf-8"));
  const m = new Map<string, string>();
  // 시·도
  for (const s of regions.sido) m.set(s.name, s.code);
  // 시·군·구
  for (const [sidoCode, list] of Object.entries<{ code: string; name: string }[]>(
    regions.sigunguByRegion,
  )) {
    const sidoName = regions.sido.find(
      (x: { code: string; name: string }) => x.code === sidoCode,
    )?.name;
    if (!sidoName) continue;
    for (const sg of list) m.set(`${sidoName}|${sg.name}`, sg.code);
  }
  // emd
  for (const [sigCode, list] of Object.entries<{ code: string; name: string }[]>(
    regions.emdByRegion ?? {},
  )) {
    // sigunguCode → sigunguName + sidoName 역참조
    const sidoCode = Array.from(
      Object.entries<{ code: string; name: string }[]>(regions.sigunguByRegion),
    ).find(([, sgs]) =>
      sgs.some((s: { code: string; name: string }) => s.code === sigCode),
    )?.[0];
    const sidoName = regions.sido.find(
      (x: { code: string; name: string }) => x.code === sidoCode,
    )?.name;
    const sigName = sidoCode
      ? regions.sigunguByRegion[sidoCode].find(
          (s: { code: string; name: string }) => s.code === sigCode,
        )?.name
      : null;
    if (!sidoName || !sigName) continue;
    for (const e of list) m.set(`${sidoName}|${sigName}|${e.name}`, e.code);
  }
  return m;
}

// emdCode 별로 station name 목록을 group.
// emdToParent: emdCode → { sigunguName, emdName }
// stationKeys: 디렉터리에서 읽은 모든 station file basename (확장자 제외)
export function buildStationListByEmd(
  emdToParent: Record<string, { sigunguName: string; emdName: string }>,
  stationKeys: string[],
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [emdCode, { sigunguName, emdName }] of Object.entries(emdToParent)) {
    const prefix = `${sigunguName}-${emdName}-`;
    const names = stationKeys
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
    if (names.length > 0) {
      names.sort((a, b) => a.localeCompare(b, "ko"));
      result[emdCode] = names;
    }
  }
  return result;
}

function filterRowsForRegion(
  r: { sidoName: string; sigunguName: string; emdName: string | null },
  region: { name: string; level: "sido" | "sigungu" | "emd"; parent?: { name: string } },
): boolean {
  if (region.level === "sido") return r.sidoName === region.name;
  if (region.level === "sigungu")
    return r.sidoName === region.parent?.name && r.sigunguName === region.name;
  if (region.level === "emd")
    return r.sigunguName === region.parent?.name && r.emdName === region.name;
  return false;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(path.join(OUT, "region"), { recursive: true });
  await mkdir(path.join(OUT, "station"), { recursive: true });

  // regions.json 로드 (emdToParent 구성용)
  const seedRegions = JSON.parse(await readFile("data/seed/regions.json", "utf-8"));

  // index.json
  const idx = buildIndex();
  await writeFile(path.join(OUT, "index.json"), JSON.stringify(idx));
  console.log(`✓ index.json — elections=${idx.elections.length}, parties=${idx.parties.length}`);

  // parsed
  const parsed = await loadParsed();
  console.log(`  parsed elections: ${parsed.size}`);
  if (parsed.size === 0) {
    console.warn(`  ⚠ data/parsed/ 비어 있음. pnpm build:parse 먼저 실행 권장`);
  }

  const codeMap = await loadRegionCodeMap();
  console.log(`  region code map: ${codeMap.size}`);

  // region 파일
  const regions = await buildRegionFiles({
    elections: idx.elections.map((e) => ({ id: e.id, date: e.date })),
    parsedByElection: parsed,
    regionCodeMap: codeMap,
  });
  for (const [code, f] of regions) {
    await writeFile(path.join(OUT, "region", `${code}.json`), JSON.stringify(f));
  }
  console.log(`✓ region/*.json — ${regions.size} files`);

  // election detail (region 별)
  let detailCount = 0;
  for (const [code, regionFile] of regions) {
    const dir = path.join(OUT, "region", code);
    await mkdir(dir, { recursive: true });
    for (const e of regionFile.elections) {
      const p = parsed.get(e.electionId);
      if (!p) continue;
      const detail = buildElectionDetail(code, (r) => filterRowsForRegion(r, regionFile), p);
      await writeFile(path.join(dir, `election-${e.electionId}.json`), JSON.stringify(detail));
      detailCount++;
    }
  }
  console.log(`✓ election-*.json — ${detailCount} files`);

  // station 시계열
  const stations = buildStations(parsed);
  for (const [key, f] of stations) {
    const safeKey = key.replace(/[\/\\]/g, "_");
    await writeFile(path.join(OUT, "station", `${safeKey}.json`), JSON.stringify(f));
  }
  console.log(`✓ station/*.json — ${stations.size} files`);

  // stationListByEmd: emdCode → station 이름 목록
  // emdToParent 구성 — emdByRegion 각 sigungu 의 children + sigunguByRegion 에서 sigunguName 역참조
  const emdToParent: Record<string, { sigunguName: string; emdName: string }> = {};
  for (const [sigCode, emds] of Object.entries<{ code: string; name: string }[]>(
    seedRegions.emdByRegion ?? {},
  )) {
    // sigunguCode → sigunguName 역참조
    let sigName: string | undefined;
    for (const [, sgs] of Object.entries<{ code: string; name: string }[]>(
      seedRegions.sigunguByRegion,
    )) {
      const match = sgs.find((s) => s.code === sigCode);
      if (match) {
        sigName = match.name;
        break;
      }
    }
    if (!sigName) continue;
    for (const e of emds) {
      emdToParent[e.code] = { sigunguName: sigName, emdName: e.name };
    }
  }
  // station 디렉터리 readdir → stationKeys (확장자 제외)
  const stationDir = path.join(OUT, "station");
  const stationFiles = await readdir(stationDir);
  const stationKeys = stationFiles
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5)); // ".json" 제거
  const stationListByEmd = buildStationListByEmd(emdToParent, stationKeys);

  // index.json 에 stationListByEmd 추가해 재기록
  const idxWithStation = { ...idx, regions: { ...idx.regions, stationListByEmd } };
  await writeFile(path.join(OUT, "index.json"), JSON.stringify(idxWithStation));
  console.log(`✓ stationListByEmd — emd keys: ${Object.keys(stationListByEmd).length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
