import { eq } from "drizzle-orm";
import { db } from "../../src/lib/db-admin";
import { regions, voteTotals, regionTotals } from "../../db/schema";

export interface SumDelta {
  electionId: string;
  sidoCode: string;
  partyId: string;
  sidoVotes: number;
  sigunguSum: number;
  deltaPct: number;
}

export interface SumCheckResult { violations: SumDelta[]; }

export interface DenomWarning {
  electionId: string;
  regionCode: string;
  issue: "sum_mismatch" | "progress_out_of_range";
  detail: string;
}

export interface DenomCheckResult { warnings: DenomWarning[]; }

export interface StructureCheckResult {
  missingRegions: { electionId: string; regionCode: string }[];
}

export interface ValidationReport {
  electionId: string;
  r1Structure: StructureCheckResult;
  r2Sum: SumCheckResult;
  r3UnresolvedRawNames: { rawName: string; votes: number }[];
  r4Denominator: DenomCheckResult;
  fatal: boolean;
}

const TOLERANCE_PCT = 0.5;

export function checkSumConsistency(
  rows: { electionId: string; regionCode: string; partyId: string; votes: number }[],
  allRegions: { code: string; level: string; parentCode: string | null }[],
): SumCheckResult {
  const sidoSet = new Set(allRegions.filter((r) => r.level === "sido").map((r) => r.code));
  // sido별 직접 자녀(sigungu) 집합 — 자녀가 없는 sido(세종 등 특별자치시)는 R2 제외
  const sidoHasChildren = new Set(
    allRegions
      .filter((r) => r.level === "sigungu" && r.parentCode && sidoSet.has(r.parentCode))
      .map((r) => r.parentCode as string),
  );
  const byKey = new Map<string, { sido?: number; childSum: number; electionId: string; sidoCode: string; partyId: string }>();

  for (const row of rows) {
    if (sidoSet.has(row.regionCode)) {
      // 자녀가 없는 sido는 R2 집계에서 제외
      if (!sidoHasChildren.has(row.regionCode)) continue;
      const key = `${row.electionId}|${row.partyId}|${row.regionCode}`;
      const cur = byKey.get(key) ?? { childSum: 0, electionId: row.electionId, sidoCode: row.regionCode, partyId: row.partyId };
      cur.sido = row.votes;
      byKey.set(key, cur);
    } else {
      const parent = allRegions.find((r) => r.code === row.regionCode)?.parentCode;
      if (!parent) continue;
      const key = `${row.electionId}|${row.partyId}|${parent}`;
      const cur = byKey.get(key) ?? { childSum: 0, electionId: row.electionId, sidoCode: parent, partyId: row.partyId };
      cur.childSum += row.votes;
      byKey.set(key, cur);
    }
  }

  const violations: SumDelta[] = [];
  for (const v of byKey.values()) {
    if (v.sido == null) continue;
    if (v.sido === 0 && v.childSum === 0) continue;
    const denom = Math.max(Math.abs(v.sido), 1);
    const deltaPct = Math.abs(v.sido - v.childSum) / denom * 100;
    if (deltaPct > TOLERANCE_PCT) {
      violations.push({
        electionId: v.electionId,
        sidoCode: v.sidoCode,
        partyId: v.partyId,
        sidoVotes: v.sido,
        sigunguSum: v.childSum,
        deltaPct,
      });
    }
  }
  return { violations };
}

export function checkDenominatorConsistency(
  rows: {
    electionId: string;
    regionCode: string;
    totalVoters: number | null;
    totalVotes: number | null;
    validVotes: number | null;
    invalidVotes: number | null;
  }[],
): DenomCheckResult {
  const warnings: DenomWarning[] = [];

  for (const r of rows) {
    if (r.totalVotes != null && r.validVotes != null && r.invalidVotes != null) {
      if (r.validVotes + r.invalidVotes !== r.totalVotes) {
        warnings.push({
          electionId: r.electionId,
          regionCode: r.regionCode,
          issue: "sum_mismatch",
          detail: `valid(${r.validVotes}) + invalid(${r.invalidVotes}) != total(${r.totalVotes})`,
        });
      }
    }
    if (r.totalVoters != null && r.totalVoters > 0 && r.totalVotes != null) {
      const pct = r.totalVotes / r.totalVoters * 100;
      if (pct < 0 || pct > 100) {
        warnings.push({
          electionId: r.electionId,
          regionCode: r.regionCode,
          issue: "progress_out_of_range",
          detail: `${pct.toFixed(2)}%`,
        });
      }
    }
  }
  return { warnings };
}

export interface InMemoryData {
  votes: { electionId: string; regionCode: string; partyId: string; votes: number }[];
  regs: {
    electionId: string; regionCode: string;
    totalVoters: number | null; totalVotes: number | null;
    validVotes: number | null; invalidVotes: number | null;
  }[];
}

export async function validateElection(
  electionId: string,
  unresolvedRawNames: { rawName: string; votes: number }[],
  inMemory?: InMemoryData,
): Promise<ValidationReport> {
  const allRegions = await db.select().from(regions);
  const sidoCodes = allRegions.filter((r) => r.level === "sido").map((r) => r.code);

  // dry-run 시에는 in-memory 데이터로 검증, 실제 실행 시에는 DB에서 읽음
  const votes = inMemory
    ? inMemory.votes
    : (await db.select().from(voteTotals).where(eq(voteTotals.electionId, electionId))).map((v) => ({
        electionId: v.electionId, regionCode: v.regionCode, partyId: v.partyId, votes: v.votes,
      }));
  const regs = inMemory
    ? inMemory.regs
    : (await db.select().from(regionTotals).where(eq(regionTotals.electionId, electionId))).map((r) => ({
        electionId: r.electionId, regionCode: r.regionCode,
        totalVoters: r.totalVoters, totalVotes: r.totalVotes,
        validVotes: r.validVotes, invalidVotes: r.invalidVotes,
      }));

  const presentSido = new Set(
    votes.filter((v) => sidoCodes.includes(v.regionCode)).map((v) => v.regionCode),
  );

  // 기초단체장(mayor)·기초의원(council-basic*) 선거에서는
  // 세종특별자치시(5000000000)와 제주특별자치도(5000000000 아님, 별도 코드) 누락이 정상.
  // 세종: 특별자치시로 기초자치단체 없음, 제주: 단층제 특별자치도로 기초자치단체 없음.
  const BASIC_EXEMPT_REGION_NAMES = new Set(["세종특별자치시", "제주특별자치도"]);
  const isBasicElection = /mayor|council-basic/.test(electionId);
  const exemptCodes = isBasicElection
    ? new Set(
        allRegions
          .filter((r) => r.level === "sido" && BASIC_EXEMPT_REGION_NAMES.has(r.name))
          .map((r) => r.code),
      )
    : new Set<string>();

  const missingRegions = sidoCodes
    .filter((c) => !presentSido.has(c) && !exemptCodes.has(c))
    .map((c) => ({ electionId, regionCode: c }));

  const r2 = checkSumConsistency(
    votes.map((v) => ({
      electionId: v.electionId,
      regionCode: v.regionCode,
      partyId: v.partyId,
      votes: v.votes,
    })),
    allRegions.map((r) => ({ code: r.code, level: r.level, parentCode: r.parentCode })),
  );

  const r4 = checkDenominatorConsistency(
    regs.map((r) => ({
      electionId: r.electionId,
      regionCode: r.regionCode,
      totalVoters: r.totalVoters,
      totalVotes: r.totalVotes,
      validVotes: r.validVotes,
      invalidVotes: r.invalidVotes,
    })),
  );

  const fatal = missingRegions.length > 0 || r2.violations.length > 0;

  return {
    electionId,
    r1Structure: { missingRegions },
    r2Sum: r2,
    r3UnresolvedRawNames: unresolvedRawNames,
    r4Denominator: r4,
    fatal,
  };
}

export function formatReport(rep: ValidationReport): string {
  const lines: string[] = [];
  lines.push(`=== Ingest Report: ${rep.electionId} ===`);
  lines.push(
    `R1 구조:        ${rep.r1Structure.missingRegions.length === 0 ? "PASS" : `FAIL — 누락 시·도 ${rep.r1Structure.missingRegions.length}개`}`,
  );
  if (rep.r2Sum.violations.length === 0) {
    lines.push(`R2 합계:        PASS`);
  } else {
    const maxDelta = Math.max(...rep.r2Sum.violations.map((v) => v.deltaPct));
    lines.push(`R2 합계:        FAIL — 위반 ${rep.r2Sum.violations.length}건 (max delta ${maxDelta.toFixed(2)}%)`);
  }
  if (rep.r3UnresolvedRawNames.length === 0) {
    lines.push(`R3 alias:       PASS`);
  } else {
    lines.push(`R3 alias:       WARN — 미매칭 raw 정당명 ${rep.r3UnresolvedRawNames.length}건:`);
    for (const u of rep.r3UnresolvedRawNames.slice(0, 10)) {
      lines.push(`                  "${u.rawName}" (votes 합계 ${u.votes.toLocaleString()})`);
    }
  }
  if (rep.r4Denominator.warnings.length === 0) {
    lines.push(`R4 분모:        PASS`);
  } else {
    lines.push(`R4 분모:        WARN — ${rep.r4Denominator.warnings.length}건`);
    for (const w of rep.r4Denominator.warnings.slice(0, 5)) {
      lines.push(`                  ${w.regionCode} ${w.issue}: ${w.detail}`);
    }
  }
  return lines.join("\n");
}
