import { eq } from "drizzle-orm";
import { sql, db } from "../../src/lib/db-admin";
import { elections } from "../../db/schema";
import { fetchResults } from "./fetch-results";
import { processElection } from "./process";
import { validateElection, formatReport, type InMemoryData } from "./validate";
import { diffElection, formatDiff } from "./diff";

interface CliOpts {
  electionId: string;
  refresh: boolean;
  dryRun: boolean;
  diff: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  const electionId = argv.find((a) => !a.startsWith("--"));
  if (!electionId) {
    console.error("usage: tsx ingest-election.ts <electionId> [--refresh] [--dry-run] [--diff]");
    process.exit(2);
  }
  return {
    electionId,
    refresh: argv.includes("--refresh"),
    dryRun: argv.includes("--dry-run"),
    diff: argv.includes("--diff"),
  };
}

export async function runOneElection(opts: CliOpts): Promise<boolean> {
  const [election] = await db.select().from(elections).where(eq(elections.id, opts.electionId)).limit(1);
  if (!election) {
    console.error(`election not found: ${opts.electionId}`);
    return false;
  }
  if (!election.necElectionId || !election.necCode) {
    console.error(`necElectionId 또는 necCode 미설정: ${opts.electionId}`);
    return false;
  }

  const spec = { electionId: opts.electionId, sgId: election.necElectionId, sgTypecode: election.necCode };

  // 1) fetch (VoteXmntck raw 하나 — 분모도 같은 응답에 포함)
  const votesRaw = await fetchResults(spec, { force: opts.refresh });

  // 2) diff (upsert 전, dry-run 이 아닐 때만)
  if (opts.diff && !opts.dryRun) {
    const preview = await processElection(opts.electionId, election.date, votesRaw, { dryRun: true });
    const d = await diffElection(
      opts.electionId,
      preview.voteToUpsert.map((v) => ({ regionCode: v.regionCode, partyId: v.partyId, votes: v.votes })),
      preview.regToUpsert.map((r) => ({ regionCode: r.regionCode, totalVoters: r.totalVoters, totalVotes: r.totalVotes })),
      preview.candToInsert.length,
    );
    console.log(formatDiff(d));
  }

  // 3) process
  const report = await processElection(opts.electionId, election.date, votesRaw, { dryRun: opts.dryRun });
  console.log(`upsert: vote_totals ${report.voteTotalsUpserted} / region_totals ${report.regionTotalsUpserted} / candidates ${report.candidatesInserted}${opts.dryRun ? " (dry-run)" : ""}`);

  // 4) validate
  // dry-run 시에는 DB 쓰기가 없으므로 in-memory 변환 결과로 R1/R2 검증
  const inMemory: InMemoryData | undefined = opts.dryRun
    ? { votes: report.voteToUpsert, regs: report.regToUpsert }
    : undefined;
  const val = await validateElection(opts.electionId, report.unresolvedRawNames, inMemory);
  console.log(formatReport(val));

  return !val.fatal;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const ok = await runOneElection(opts);
  await sql.end();
  process.exit(ok ? 0 : 1);
}

// 직접 실행 시에만 main() 호출 (import 시에는 실행하지 않음)
const isMain = process.argv[1]?.includes("ingest-election");
if (isMain) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
