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

    // emd → sigungu / sido roll-up. parsed 가 emd 단위만 제공해서 시·군·도 페이지가 비어 보이는 문제 해소.
    const sigunguAgg = new Map<string, Map<string, { votes: number; totalVotes: number }>>();
    const sidoAgg = new Map<string, Map<string, { votes: number; totalVotes: number }>>();
    for (const [emdCode, partyMap] of byRegion) {
      const emdRegion = regions.get(emdCode);
      const sigunguCode = emdRegion?.parent?.code;
      if (!sigunguCode) continue;
      const sigunguRegion = regions.get(sigunguCode);
      const sidoCode = sigunguRegion?.parent?.code;
      for (const [partyId, { votes, totalVotes }] of partyMap) {
        if (!sigunguAgg.has(sigunguCode)) sigunguAgg.set(sigunguCode, new Map());
        const sm = sigunguAgg.get(sigunguCode)!;
        const sEx = sm.get(partyId) ?? { votes: 0, totalVotes: 0 };
        sm.set(partyId, { votes: sEx.votes + votes, totalVotes: sEx.totalVotes + totalVotes });
        if (sidoCode) {
          if (!sidoAgg.has(sidoCode)) sidoAgg.set(sidoCode, new Map());
          const dm = sidoAgg.get(sidoCode)!;
          const dEx = dm.get(partyId) ?? { votes: 0, totalVotes: 0 };
          dm.set(partyId, { votes: dEx.votes + votes, totalVotes: dEx.totalVotes + totalVotes });
        }
      }
    }

    // region file 의 timeseries 에 누적 — emd + sigungu + sido 모두
    const commit = (
      regionCode: string,
      partyMap: Map<string, { votes: number; totalVotes: number }>,
    ) => {
      const regionFile = regions.get(regionCode);
      if (!regionFile) return;
      for (const [partyId, { votes, totalVotes }] of partyMap) {
        if (!regionFile.timeseries[partyId]) regionFile.timeseries[partyId] = [];
        const alreadyExists = regionFile.timeseries[partyId].some(
          (p) => p.electionId === electionId,
        );
        if (!alreadyExists) {
          regionFile.timeseries[partyId].push({
            electionId,
            votes,
            totalVotes,
            share: totalVotes > 0 ? +((votes / totalVotes) * 100).toFixed(2) : 0,
          });
        }
      }
    };
    for (const [code, pm] of byRegion) commit(code, pm);
    for (const [code, pm] of sigunguAgg) commit(code, pm);
    for (const [code, pm] of sidoAgg) commit(code, pm);
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

    // 2002 대선 패턴: emdName 없는 total/absentee 행에서 sidoName 이 비어있는 경우.
    // (a) election 내에서 동일 sigunguName 으로 sidoName 이 채워진 행이 있으면 그걸 우선 사용 — 동명 sigungu 안전
    // (b) seed 의 sigunguName → sidoName 매핑 사용. 동명(중구·동구 등) 은 ambiguous 마킹 후 skip.
    const sigunguNameToSido = new Map<string, string>();
    const ambiguousSigungu = new Set<string>();
    for (const [sidoCode, sgList] of Object.entries<{ code: string; name: string }[]>(
      seedRegions.sigunguByRegion,
    )) {
      const sidoName = (seedRegions.sido as { code: string; name: string }[])
        .find((s) => s.code === sidoCode)?.name;
      if (!sidoName) continue;
      for (const sg of sgList) {
        if (sigunguNameToSido.has(sg.name)) {
          ambiguousSigungu.add(sg.name);
        } else {
          sigunguNameToSido.set(sg.name, sidoName);
        }
      }
    }
    let filledSidoFromSigungu = 0;
    let skippedAmbiguous = 0;
    for (const [, p] of parsed) {
      const electionSigungu = new Map<string, string>();
      for (const row of p.rows) {
        if (row.sidoName && row.sigunguName && !electionSigungu.has(row.sigunguName)) {
          electionSigungu.set(row.sigunguName, row.sidoName);
        }
      }
      for (const row of p.rows) {
        if (!row.sidoName && row.sigunguName) {
          const local = electionSigungu.get(row.sigunguName);
          if (local) {
            row.sidoName = local;
            filledSidoFromSigungu++;
            continue;
          }
          if (!ambiguousSigungu.has(row.sigunguName)) {
            const sd = sigunguNameToSido.get(row.sigunguName);
            if (sd) {
              row.sidoName = sd;
              filledSidoFromSigungu++;
            }
          } else {
            skippedAmbiguous++;
          }
        }
      }
    }
    console.log(
      `[build-static] sigunguName→sidoName 보충: ${filledSidoFromSigungu} 행 (모호 ${skippedAmbiguous} 행 skip)`,
    );

    // 선거구형 sigunguName (예: 창원시을, 마산갑) → emdName 기반 행정 sigungu 자동 치환
    // 2000·2004·2008 총선 raw 가 sigungu 자리에 국회의원 선거구명을 담은 경우 처리.
    const validSigungu = new Set<string>();
    // (sidoName, emdName) → 그 시·도 내 해당 emdName 을 가진 sigungu 후보 목록.
    // 같은 시·도 안 동명 emd 가 있을 때 첫 매칭 대신 orig 선거구명 prefix 와 일치하는 sigungu 우선 사용.
    const emdSigunguBySido = new Map<string, Set<string>>();
    for (const [sidoCode, list] of Object.entries<{ code: string; name: string }[]>(
      seedRegions.sigunguByRegion,
    )) {
      const sName = (seedRegions.sido as { code: string; name: string }[])
        .find((s) => s.code === sidoCode)?.name;
      if (!sName) continue;
      for (const sg of list) validSigungu.add(`${sName}|${sg.name}`);
    }
    for (const [sigCode, emds] of Object.entries<{ code: string; name: string }[]>(
      seedRegions.emdByRegion ?? {},
    )) {
      const sidoCode = Array.from(
        Object.entries<{ code: string; name: string }[]>(seedRegions.sigunguByRegion),
      ).find(([, sgs]) =>
        sgs.some((s: { code: string; name: string }) => s.code === sigCode),
      )?.[0];
      const sidoName = (seedRegions.sido as { code: string; name: string }[])
        .find((s) => s.code === sidoCode)?.name;
      const sigunguName = sidoCode
        ? seedRegions.sigunguByRegion[sidoCode]?.find(
            (s: { code: string; name: string }) => s.code === sigCode,
          )?.name
        : undefined;
      if (!sidoName || !sigunguName) continue;
      for (const emd of emds) {
        const k = `${sidoName}|${emd.name}`;
        if (!emdSigunguBySido.has(k)) emdSigunguBySido.set(k, new Set());
        emdSigunguBySido.get(k)!.add(sigunguName);
      }
    }
    // override: data/meta/emd-mapping-overrides.json 에 명시된 (sido, origSigungu, emd) → sigungu 매핑.
    // 자동 추론으로 해소 안 되는 case (예: orig="창원시갑"·emd="대산면" → 의창구 vs 함안군 의령군함안군합천군 row).
    interface Override { sido: string; origSigungu: string; emd: string; sigungu: string }
    const OVERRIDE_PATH = path.resolve("data/meta/emd-mapping-overrides.json");
    let overrides: Override[] = [];
    if (existsSync(OVERRIDE_PATH)) {
      overrides = JSON.parse(await readFile(OVERRIDE_PATH, "utf-8"));
    }
    const overrideMap = new Map<string, string>();
    for (const o of overrides) overrideMap.set(`${o.sido}|${o.origSigungu}|${o.emd}`, o.sigungu);

    let reroutedCount = 0;
    let reroutedByPrefix = 0;
    let reroutedBySubstring = 0;
    let reroutedByOverride = 0;
    const reroutedSamples = new Map<string, number>();
    for (const [, p] of parsed) {
      for (const row of p.rows) {
        if (!row.sidoName || !row.sigunguName || !row.emdName) continue;
        if (validSigungu.has(`${row.sidoName}|${row.sigunguName}`)) continue;

        let chosen: string | undefined;
        // 0차: override 최우선
        const overKey = `${row.sidoName}|${row.sigunguName}|${row.emdName}`;
        const overrideSg = overrideMap.get(overKey);
        if (overrideSg) {
          chosen = overrideSg;
          reroutedByOverride++;
        }

        const candidates = emdSigunguBySido.get(`${row.sidoName}|${row.emdName}`);
        if (!chosen && candidates && candidates.size > 1) {
          // 1차: prefix 매칭 (orig 가 sigungu 이름으로 시작 — 가장 강한 신호)
          for (const sg of candidates) {
            if (row.sigunguName.startsWith(sg)) {
              chosen = sg;
              reroutedByPrefix++;
              break;
            }
          }
          // 2차: substring 매칭 (orig 가 다중 시·군 묶음일 때 — "의령군함안군합천군".includes("함안군")).
          // 단일 substring 매칭만 채택 (다중 매칭은 fallback 으로).
          if (!chosen) {
            const subs = [...candidates].filter((sg) => row.sigunguName.includes(sg));
            if (subs.length === 1) {
              chosen = subs[0];
              reroutedBySubstring++;
            }
          }
          // 3차: 첫 매칭(emdNameToParent) fallback
          if (!chosen) {
            const parent = emdNameToParent.get(row.emdName);
            if (parent && parent.sidoName === row.sidoName) chosen = parent.sigunguName;
          }
        } else if (!chosen && candidates && candidates.size === 1) {
          chosen = candidates.values().next().value as string;
        } else if (!chosen) {
          // 후보 없음 — 기존 emdNameToParent fallback (cross-sido 인 경우 sido mismatch 로 skip)
          const parent = emdNameToParent.get(row.emdName);
          if (parent && parent.sidoName === row.sidoName) chosen = parent.sigunguName;
        }
        if (chosen) {
          const sampleKey = `${row.sidoName}|${row.sigunguName}→${chosen}`;
          reroutedSamples.set(sampleKey, (reroutedSamples.get(sampleKey) ?? 0) + 1);
          row.sigunguName = chosen;
          reroutedCount++;
        }
      }
    }
    console.log(`  - override: ${reroutedByOverride} 행, prefix: ${reroutedByPrefix}, substring: ${reroutedBySubstring}`);
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
