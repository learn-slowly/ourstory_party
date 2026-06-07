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
import { buildRegionNameLookup, lookupRegion } from "./region-name-to-code";
import type { StaticIndex } from "../../src/types/static";
import type { JiseonNormalizedOutput } from "./parsers/jiseon-2022-types";

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
    for (const sg of list) {
      m.set(`${sidoName}|${sg.name}`, sg.code);
      // 창원 일반구 호환: parsed 가 "창원시성산구" 형식 → seed 의 "성산구" 코드로
      const expanded = Object.entries(SIGUNGU_PREFIX_STRIP).find(([, v]) => v === sg.name)?.[0];
      if (expanded) m.set(`${sidoName}|${expanded}`, sg.code);
    }
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
    for (const e of list) {
      m.set(`${sidoName}|${sigName}|${e.name}`, e.code);
      // 창원 일반구 호환: emd lookup 도 "창원시성산구|토월동" 변종 추가
      const expanded = Object.entries(SIGUNGU_PREFIX_STRIP).find(([, v]) => v === sigName)?.[0];
      if (expanded) m.set(`${sidoName}|${expanded}|${e.name}`, e.code);
    }
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

// ── 2022 지선 emd 통합 ──────────────────────────────────────────────────────────

// NEC xlsx 의 시군구명 정규화:
// "창원시의창구" → "의창구" (창원시 5개 자치구는 prefix "창원시" 제거)
// 기타는 원본 그대로.
const SIGUNGU_PREFIX_STRIP: Record<string, string> = {
  "창원시의창구": "의창구",
  "창원시성산구": "성산구",
  "창원시마산합포구": "마산합포구",
  "창원시마산회원구": "마산회원구",
  "창원시진해구": "진해구",
};

function normSigungu(raw: string): string {
  return SIGUNGU_PREFIX_STRIP[raw] ?? raw;
}

async function mergeJiseon2022Emd(
  regions: Map<string, import("../../src/types/static").RegionFile>,
  indexForLookup: StaticIndex,
): Promise<void> {
  const PARSED_DIR = path.resolve("data/parsed/2022-local");
  let jiseonFiles: string[] = [];
  try {
    jiseonFiles = (await readdir(PARSED_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    console.warn("[build-static] data/parsed/2022-local 없음 — Phase 7.1 파서 먼저 실행 필요");
    return;
  }

  if (jiseonFiles.length === 0) {
    console.warn("[build-static] data/parsed/2022-local/*.json 없음");
    return;
  }

  const nameLookup = buildRegionNameLookup(indexForLookup);
  const unmappedCount: Record<string, number> = {};

  for (const f of jiseonFiles) {
    const out: JiseonNormalizedOutput = JSON.parse(
      await readFile(path.join(PARSED_DIR, f), "utf-8"),
    );
    const { electionId, rows } = out;

    // emd region code 별로 정당 votes 집계
    const byRegion = new Map<
      string,
      Map<string, { votes: number; totalVotes: number }>
    >();

    for (const row of rows) {
      const code = lookupRegion(nameLookup, {
        sido: row.sido,
        sigungu: normSigungu(row.sigungu),
        emd: row.emd,
      });
      if (!code) {
        const key = `${row.sido}/${row.sigungu}/${row.emd}`;
        unmappedCount[key] = (unmappedCount[key] ?? 0) + 1;
        continue;
      }

      if (!byRegion.has(code)) byRegion.set(code, new Map());
      const partyMap = byRegion.get(code)!;
      const existing = partyMap.get(row.partyId) ?? { votes: 0, totalVotes: 0 };
      partyMap.set(row.partyId, {
        votes: existing.votes + row.votes,
        totalVotes: row.totalVotes, // 행마다 같은 값 (소계 행의 합계)
      });
    }

    // region file 의 timeseries 에 누적
    for (const [regionCode, partyMap] of byRegion) {
      const regionFile = regions.get(regionCode);
      if (!regionFile) continue; // 아직 없는 emd 코드 (regions에 없음)

      for (const [partyId, { votes, totalVotes }] of partyMap) {
        if (!regionFile.timeseries[partyId]) regionFile.timeseries[partyId] = [];
        // 이미 같은 electionId entry 있으면 skip (중복 방지)
        const alreadyExists = regionFile.timeseries[partyId].some(
          (p) => p.electionId === electionId,
        );
        if (!alreadyExists) {
          regionFile.timeseries[partyId].push({
            electionId,
            votes,
            totalVotes,
            share: totalVotes > 0 ? +(votes / totalVotes * 100).toFixed(2) : 0,
          });
        }
      }
    }
  }

  const totalUnmapped = Object.values(unmappedCount).reduce((s, n) => s + n, 0);
  if (totalUnmapped > 0) {
    const top5 = Object.entries(unmappedCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    console.warn(
      `[build-static] 2022 지선 emd region 매핑 실패 ${totalUnmapped} 행. Top:`,
      top5,
    );
  } else {
    console.log(`[build-static] 2022 지선 emd 매핑 실패 0 행 ✓`);
  }
  console.log(`✓ 2022 지선 emd timeseries 합산 — ${jiseonFiles.length}개 선거`);
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

  // ── Fix 1: station-level 행의 빈 sigunguName/sidoName 보충 ──────────────────
  // emdName → { sigunguName, sidoName } 매핑을 seed에서 구축.
  // 동명 emd(예: 상남동 = 성산구 + 마산합포구)는 첫 매칭 사용 (cross-region 오염 가능, 경고 출력).
  {
    const emdNameToParent = new Map<string, { sidoName: string; sigunguName: string }>();
    const ambiguousEmd = new Set<string>();
    for (const [sigCode, emds] of Object.entries<{ code: string; name: string }[]>(
      seedRegions.emdByRegion ?? {},
    )) {
      // sigunguCode → sidoCode + sidoName + sigunguName 역참조
      const sidoCode = Array.from(
        Object.entries<{ code: string; name: string }[]>(seedRegions.sigunguByRegion),
      ).find(([, sgs]) =>
        sgs.some((s: { code: string; name: string }) => s.code === sigCode),
      )?.[0];
      const sidoName = seedRegions.sido.find(
        (x: { code: string; name: string }) => x.code === sidoCode,
      )?.name;
      const sigunguName = sidoCode
        ? seedRegions.sigunguByRegion[sidoCode]?.find(
            (s: { code: string; name: string }) => s.code === sigCode,
          )?.name
        : undefined;
      if (!sidoName || !sigunguName) continue;
      for (const emd of emds) {
        if (emdNameToParent.has(emd.name)) {
          ambiguousEmd.add(emd.name);
          continue; // 첫 매칭 우선
        }
        emdNameToParent.set(emd.name, { sidoName, sigunguName });
      }
    }
    if (ambiguousEmd.size > 0) {
      console.warn(
        `[build-static] 동명 emd ${ambiguousEmd.size} 개 — 첫 매칭 sigungu 로 station 통합 (cross-region 오염 가능):`,
        [...ambiguousEmd].slice(0, 5),
      );
    }
    // parsed rows 인플레이스 보충: sigunguName/sidoName 이 비어 있는 행 채우기
    let filledCount = 0;
    for (const [, p] of parsed) {
      for (const row of p.rows) {
        if (row.emdName && (!row.sigunguName || !row.sidoName)) {
          const parent = emdNameToParent.get(row.emdName);
          if (parent) {
            if (!row.sigunguName) row.sigunguName = parent.sigunguName;
            if (!row.sidoName) row.sidoName = parent.sidoName;
            filledCount++;
          }
        }
      }
    }
    console.log(`[build-static] sigungu/sido 빈 행 보충: ${filledCount}`);

    // 선거구형 sigunguName (예: 창원시을, 마산갑) → emdName 기반 행정 sigungu 자동 치환
    // 2000·2004·2008 총선 raw 가 sigungu 자리에 국회의원 선거구명을 담은 경우 처리.
    const validSigungu = new Set<string>();
    for (const [sidoCode, list] of Object.entries<{ code: string; name: string }[]>(
      seedRegions.sigunguByRegion,
    )) {
      const sName = (seedRegions.sido as { code: string; name: string }[])
        .find((s) => s.code === sidoCode)?.name;
      if (!sName) continue;
      for (const sg of list) validSigungu.add(`${sName}|${sg.name}`);
    }
    let reroutedCount = 0;
    const reroutedSamples = new Map<string, number>();
    for (const [, p] of parsed) {
      for (const row of p.rows) {
        if (!row.sidoName || !row.sigunguName || !row.emdName) continue;
        if (validSigungu.has(`${row.sidoName}|${row.sigunguName}`)) continue;
        const parent = emdNameToParent.get(row.emdName);
        if (parent && parent.sidoName === row.sidoName) {
          const sampleKey = `${row.sidoName}|${row.sigunguName}→${parent.sigunguName}`;
          reroutedSamples.set(sampleKey, (reroutedSamples.get(sampleKey) ?? 0) + 1);
          row.sigunguName = parent.sigunguName;
          reroutedCount++;
        }
      }
    }
    console.log(`[build-static] 선거구형 sigungu → 행정구역 자동 치환: ${reroutedCount} 행`);
    if (reroutedSamples.size > 0) {
      console.log(
        `  샘플:`,
        [...reroutedSamples.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([k, v]) => `${k}(${v})`),
      );
    }
  }

  // region 파일
  const regions = await buildRegionFiles({
    elections: idx.elections.map((e) => ({ id: e.id, date: e.date })),
    parsedByElection: parsed,
    regionCodeMap: codeMap,
  });

  // 2022 지선 emd 단위 timeseries 합산 (Phase 7.1)
  await mergeJiseon2022Emd(regions, idx as StaticIndex);

  // ── Fix 2: 파싱 데이터가 없는 seed region 에도 placeholder region.json 보장 ──
  // 404 방지: picker 에서 선택할 수 있는 모든 seed emd/sigungu/sido 를 커버.
  {
    // sido placeholder
    for (const sido of seedRegions.sido as { code: string; name: string }[]) {
      if (!regions.has(sido.code)) {
        regions.set(sido.code, {
          code: sido.code,
          name: sido.name,
          level: "sido",
          children: [],
          timeseries: {},
          elections: [],
        });
      }
    }
    // sigungu placeholder
    for (const [sidoCode, sgList] of Object.entries<{ code: string; name: string }[]>(
      seedRegions.sigunguByRegion,
    )) {
      const sidoMeta = (seedRegions.sido as { code: string; name: string }[]).find(
        (s) => s.code === sidoCode,
      );
      if (!sidoMeta) continue;
      for (const sg of sgList) {
        if (!regions.has(sg.code)) {
          regions.set(sg.code, {
            code: sg.code,
            name: sg.name,
            level: "sigungu",
            parent: { code: sidoMeta.code, name: sidoMeta.name },
            children: [],
            timeseries: {},
            elections: [],
          });
        }
      }
    }
    // emd placeholder
    let emdPlaceholderCount = 0;
    for (const [sigCode, emds] of Object.entries<{ code: string; name: string }[]>(
      seedRegions.emdByRegion ?? {},
    )) {
      // sigunguCode → sigunguName + sidoCode 역참조
      const sidoCode = Array.from(
        Object.entries<{ code: string; name: string }[]>(seedRegions.sigunguByRegion),
      ).find(([, sgs]) =>
        sgs.some((s: { code: string; name: string }) => s.code === sigCode),
      )?.[0];
      const sigunguName = sidoCode
        ? seedRegions.sigunguByRegion[sidoCode]?.find(
            (s: { code: string; name: string }) => s.code === sigCode,
          )?.name
        : undefined;
      for (const emd of emds) {
        if (!regions.has(emd.code)) {
          regions.set(emd.code, {
            code: emd.code,
            name: emd.name,
            level: "emd",
            parent: sigunguName ? { code: sigCode, name: sigunguName } : undefined,
            children: [],
            timeseries: {},
            elections: [],
          });
          emdPlaceholderCount++;
        }
      }
    }
    console.log(`[build-static] seed placeholder 추가 — emd: ${emdPlaceholderCount}`);
  }

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
