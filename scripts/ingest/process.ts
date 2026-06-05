import { eq } from "drizzle-orm";
import { XmntckItemSchema } from "./lib/types";
import { db } from "../../src/lib/db-admin";
import { regions, voteTotals, regionTotals, candidates } from "../../db/schema";
import { resolveParty } from "./lib/party-resolver";

// ──────────────────────────────────────────────────────────
// 순수 변환 헬퍼 (DB 의존 없음 — 단위 테스트 대상)
// ──────────────────────────────────────────────────────────

/** null 안전 덧셈: 둘 다 null 이면 null, 하나라도 숫자면 합산 */
function addNullable(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

/** wiwName === "합계" 인 집계 행이면 true */
export function isAggregateRow(row: { wiwName?: string }): boolean {
  return row.wiwName === "합계";
}

export interface CandidateCell {
  jd: string;
  hbj: string | undefined;
  dugsu: number;
}

/**
 * wide row 의 jd01~jd50 / hbj01~hbj50 / dugsu01~dugsu50 을
 * 후보자 단위 셀 배열로 펼친다.
 * jd가 빈 문자열이면 그 이후는 무시한다.
 */
export function expandCells(row: Record<string, unknown>): CandidateCell[] {
  const cells: CandidateCell[] = [];
  for (let i = 1; i <= 50; i++) {
    const pad = String(i).padStart(2, "0");
    const jdRaw = row[`jd${pad}`];
    if (jdRaw == null || jdRaw === "") break;
    const jd = typeof jdRaw === "string" ? jdRaw : String(jdRaw);
    const hbjRaw = row[`hbj${pad}`];
    const hbj =
      typeof hbjRaw === "string" && hbjRaw !== "" ? hbjRaw : undefined;
    const dugsuRaw = row[`dugsu${pad}`];
    const dugsu =
      dugsuRaw == null || dugsuRaw === "" ? 0 : Number(dugsuRaw);
    cells.push({ jd, hbj, dugsu });
  }
  return cells;
}

// ──────────────────────────────────────────────────────────
// extractVoteTotals
// ──────────────────────────────────────────────────────────

export interface VoteTotalRow {
  sdName: string;
  wiwName: string;
  jdName: string;
  votes: number;
}

/**
 * raw wide 행 배열 → (sdName, wiwName, jdName) 단위로 득표 합산한 행 목록.
 * 같은 키가 여러 raw 행에 걸쳐 있으면 합산한다.
 */
export function extractVoteTotals(rawItems: unknown[]): VoteTotalRow[] {
  const parsed = rawItems.map(
    (r) => XmntckItemSchema.parse(r) as Record<string, unknown>,
  );
  const map = new Map<string, VoteTotalRow>();
  for (const r of parsed) {
    const sd = (r.sdName as string) ?? "";
    const wi = (r.wiwName as string) ?? "";
    if (!sd || !wi) continue;
    for (const cell of expandCells(r)) {
      const key = `${sd}|${wi}|${cell.jd}`;
      const cur = map.get(key);
      if (cur) cur.votes += cell.dugsu;
      else
        map.set(key, {
          sdName: sd,
          wiwName: wi,
          jdName: cell.jd,
          votes: cell.dugsu,
        });
    }
  }
  return [...map.values()];
}

// ──────────────────────────────────────────────────────────
// extractRegionTotals
// ──────────────────────────────────────────────────────────

export interface RegionTotalRow {
  sdName: string;
  wiwName: string;
  totalVoters: number | null;
  totalVotes: number | null;
  validVotes: number | null;
  invalidVotes: number | null;
}

/**
 * wide row 한 행 = 한 지역의 분모 (sunsu/tusu/yutusu/mutusu).
 * 입력 rows 수와 동일한 수의 RegionTotalRow 를 반환한다.
 */
export function extractRegionTotals(rawItems: unknown[]): RegionTotalRow[] {
  const parsed = rawItems.map(
    (r) => XmntckItemSchema.parse(r) as Record<string, unknown>,
  );
  function toNum(v: unknown): number | null {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return parsed
    .filter((r) => r.sdName && r.wiwName)
    .map((r) => ({
      sdName: r.sdName as string,
      wiwName: r.wiwName as string,
      totalVoters: toNum(r.sunsu),
      totalVotes: toNum(r.tusu),
      validVotes: toNum(r.yutusu),
      invalidVotes: toNum(r.mutusu),
    }));
}

// ──────────────────────────────────────────────────────────
// extractCandidates
// ──────────────────────────────────────────────────────────

export interface CandidateRow {
  constituency: string;
  name: string;
  partyNameRaw: string;
  votes: number;
}

/**
 * 집계 행(wiwName=합계)을 제외한 후보자 단위 행 목록 반환.
 * 같은 (constituency, name, jd) 조합이 중복되면 합산한다.
 */
export function extractCandidates(rawItems: unknown[]): CandidateRow[] {
  const parsed = rawItems.map(
    (r) => XmntckItemSchema.parse(r) as Record<string, unknown>,
  );
  const map = new Map<string, CandidateRow>();
  for (const r of parsed) {
    const wi = (r.wiwName as string) ?? "";
    if (wi === "합계") continue;
    const constituency =
      (r.sggName as string) ?? (r.sdName as string) ?? "";
    if (!constituency) continue;
    for (const cell of expandCells(r)) {
      if (!cell.hbj) continue;
      const key = `${constituency}|${cell.hbj}|${cell.jd}`;
      const cur = map.get(key);
      if (cur) cur.votes += cell.dugsu;
      else
        map.set(key, {
          constituency,
          name: cell.hbj,
          partyNameRaw: cell.jd,
          votes: cell.dugsu,
        });
    }
  }
  return [...map.values()];
}

// ──────────────────────────────────────────────────────────
// processElection — DB upsert
// ──────────────────────────────────────────────────────────

export interface ProcessReport {
  voteTotalsUpserted: number;
  regionTotalsUpserted: number;
  candidatesInserted: number;
  unresolvedRawNames: { rawName: string; votes: number }[];
  voteToUpsert: {
    electionId: string;
    regionCode: string;
    partyId: string;
    votes: number;
  }[];
  regToUpsert: {
    electionId: string;
    regionCode: string;
    totalVoters: number | null;
    totalVotes: number | null;
    validVotes: number | null;
    invalidVotes: number | null;
  }[];
  candToInsert: {
    electionId: string;
    constituency: string;
    name: string;
    partyId: string | null;
    partyNameRaw: string;
    votes: number;
    isWinner: boolean;
  }[];
}

/**
 * 한 election 의 raw 응답(VoteXmntckInfoInqireService2 wide rows)을
 * 정형화·매핑 후 DB upsert.
 *
 * vote_totals + region_totals + candidates 모두 도출.
 * candidates 는 election 단위 replace (DELETE → INSERT).
 *
 * @param opts.dryRun true 면 DB 쓰기 생략, 변환 결과만 반환
 */
export async function processElection(
  electionId: string,
  electionDate: string,
  votesRaw: unknown[],
  opts: { dryRun?: boolean } = {},
): Promise<ProcessReport> {
  // ── 1) region name → code lookup 테이블 구축 ──────────────
  const allRegions = await db.select().from(regions);
  // 시·도 이름 정규화: NEC 원본에서 특별자치도·특별자치시 전환 이전 이름이 사용될 수 있음
  // 예) "강원도" → "강원특별자치도", "전라북도" → "전북특별자치도"
  const SIDO_NAME_ALIASES: Record<string, string> = {
    "강원도": "강원특별자치도",
    "전라북도": "전북특별자치도",
    "제주도": "제주특별자치도",
  };
  const sidoByName = new Map(
    allRegions
      .filter((r) => r.level === "sido")
      .map((r) => [r.name, r]),
  );
  // 구 이름 → 현재 이름으로 alias 등록
  for (const [oldName, newName] of Object.entries(SIDO_NAME_ALIASES)) {
    if (!sidoByName.has(oldName) && sidoByName.has(newName)) {
      sidoByName.set(oldName, sidoByName.get(newName)!);
    }
  }
  const sigunguByKey = new Map(
    allRegions
      .filter((r) => r.level === "sigungu")
      .map((r) => {
        const parent = allRegions.find((p) => p.code === r.parentCode);
        return [`${parent?.name ?? ""}|${r.name}`, r];
      }),
  );
  // 역사적 행정구역 변동 대응 (06-historical-regions.ts 로 DB에 추가된 코드들)
  // sigunguByKey 는 DB 데이터로 자동 구성되므로 별도 처리 불필요.
  // 단, DB에 역사적 코드가 없을 경우를 위한 fallback 매핑 (seed 미실행 환경)
  const HISTORICAL_SIGUNGU_FALLBACK: Record<string, string> = {
    // 군위군: 2023.7 대구 편입 전 경상북도 소속. DB에 4780000000 없으면 2772000000 사용
    "경상북도|군위군": "4780000000",
  };
  for (const [key, code] of Object.entries(HISTORICAL_SIGUNGU_FALLBACK)) {
    if (!sigunguByKey.has(key)) {
      const region = allRegions.find((r) => r.code === code)
        ?? allRegions.find((r) => r.code === "2772000000"); // 최후 fallback
      if (region) sigunguByKey.set(key, region);
    }
  }

  function regionCodeOf(
    sdName: string,
    wiwName: string,
  ): string | null {
    // 합계 행 → sido 코드
    if (wiwName === "합계") return sidoByName.get(sdName)?.code ?? null;
    // 정확 매칭
    const exact = sigunguByKey.get(`${sdName}|${wiwName}`);
    if (exact) return exact.code;
    // 세종처럼 시·도 = 단일 sigungu 자치시. ourstory regions 가 sigungu parent 를 null 로
    // 저장하는 케이스 — sdName == wiwName 일 때 "|sdName" 키로 한 번 더 시도.
    if (sdName === wiwName) {
      const parentNull = sigunguByKey.get(`|${wiwName}`);
      if (parentNull) return parentNull.code;
    }
    // 부분 매칭: wiwName="창원시의창구" / "부천시원미구" → sigungu.name 끝 포함
    const sidoCode = sidoByName.get(sdName)?.code;
    if (sidoCode) {
      for (const r of allRegions) {
        if (r.level !== "sigungu") continue;
        if (r.parentCode !== sidoCode) continue;
        if (r.name && wiwName.endsWith(r.name)) return r.code;
      }
    }
    // 갑·을 선거구 분할 처리: "화성시갑" / "화성시을" → 갑/을 제거 후 재매칭
    const stripped = wiwName.replace(/[갑을병정]$/, "");
    if (stripped !== wiwName) {
      const strippedExact = sigunguByKey.get(`${sdName}|${stripped}`);
      if (strippedExact) return strippedExact.code;
      if (sidoCode) {
        for (const r of allRegions) {
          if (r.level !== "sigungu") continue;
          if (r.parentCode !== sidoCode) continue;
          if (r.name && stripped.endsWith(r.name)) return r.code;
        }
      }
    }
    return null;
  }

  // ── 2) vote_totals 변환 ────────────────────────────────────
  // 갑·을 선거구 분할처럼 여러 wiwName → 같은 regionCode 로 매핑될 수 있으므로 합산 맵 사용
  const voteRows = extractVoteTotals(votesRaw);
  const unresolved = new Map<string, number>();
  const voteMap = new Map<string, { electionId: string; regionCode: string; partyId: string; votes: number }>();

  for (const v of voteRows) {
    const code = regionCodeOf(v.sdName, v.wiwName);
    if (!code) continue;
    const partyId = await resolveParty(electionId, electionDate, v.jdName);
    if (!partyId) {
      unresolved.set(v.jdName, (unresolved.get(v.jdName) ?? 0) + v.votes);
      continue;
    }
    const key = `${code}|${partyId}`;
    const cur = voteMap.get(key);
    if (cur) {
      cur.votes += v.votes;
    } else {
      voteMap.set(key, { electionId, regionCode: code, partyId, votes: v.votes });
    }
  }
  const voteToUpsert: ProcessReport["voteToUpsert"] = [...voteMap.values()];

  // ── 3) region_totals ──────────────────────────────────────
  const regRows = extractRegionTotals(votesRaw);
  // 갑·을 분할 등 여러 wiwName → 같은 regionCode 로 매핑될 경우 분모를 합산
  const regMap = new Map<string, ProcessReport["regToUpsert"][number]>();

  for (const r of regRows) {
    const code = regionCodeOf(r.sdName, r.wiwName);
    if (!code) continue;
    const cur = regMap.get(code);
    if (cur) {
      cur.totalVoters = addNullable(cur.totalVoters, r.totalVoters);
      cur.totalVotes = addNullable(cur.totalVotes, r.totalVotes);
      cur.validVotes = addNullable(cur.validVotes, r.validVotes);
      cur.invalidVotes = addNullable(cur.invalidVotes, r.invalidVotes);
    } else {
      regMap.set(code, {
        electionId,
        regionCode: code,
        totalVoters: r.totalVoters,
        totalVotes: r.totalVotes,
        validVotes: r.validVotes,
        invalidVotes: r.invalidVotes,
      });
    }
  }
  const regToUpsert: ProcessReport["regToUpsert"] = [...regMap.values()];

  // ── 4) candidates ─────────────────────────────────────────
  const candRows = extractCandidates(votesRaw);
  const candToInsert: ProcessReport["candToInsert"] = [];

  for (const c of candRows) {
    const partyId = await resolveParty(
      electionId,
      electionDate,
      c.partyNameRaw,
    );
    candToInsert.push({
      electionId,
      constituency: c.constituency,
      name: c.name,
      partyId,
      partyNameRaw: c.partyNameRaw,
      votes: c.votes,
      isWinner: false,
    });
  }

  if (opts.dryRun) {
    return {
      voteTotalsUpserted: voteToUpsert.length,
      regionTotalsUpserted: regToUpsert.length,
      candidatesInserted: candToInsert.length,
      unresolvedRawNames: [...unresolved].map(([rawName, votes]) => ({
        rawName,
        votes,
      })),
      voteToUpsert,
      regToUpsert,
      candToInsert,
    };
  }

  // ── 5) DB upsert ──────────────────────────────────────────
  for (const row of voteToUpsert) {
    await db
      .insert(voteTotals)
      .values(row)
      .onConflictDoUpdate({
        target: [voteTotals.electionId, voteTotals.regionCode, voteTotals.partyId],
        set: { votes: row.votes },
      });
  }

  for (const row of regToUpsert) {
    await db
      .insert(regionTotals)
      .values(row)
      .onConflictDoUpdate({
        target: [regionTotals.electionId, regionTotals.regionCode],
        set: {
          totalVoters: row.totalVoters,
          totalVotes: row.totalVotes,
          validVotes: row.validVotes,
          invalidVotes: row.invalidVotes,
        },
      });
  }

  await db
    .delete(candidates)
    .where(eq(candidates.electionId, electionId));

  if (candToInsert.length) {
    await db.insert(candidates).values(candToInsert);
  }

  return {
    voteTotalsUpserted: voteToUpsert.length,
    regionTotalsUpserted: regToUpsert.length,
    candidatesInserted: candToInsert.length,
    unresolvedRawNames: [...unresolved].map(([rawName, votes]) => ({
      rawName,
      votes,
    })),
    voteToUpsert,
    regToUpsert,
    candToInsert,
  };
}
