/**
 * The nightly reproducibility check — the Verification table's last unticked row.
 *
 * The claim it defends is the one the whole design rests on: **every reported
 * number is derived from the journal, so recomputing it produces the same
 * answer.** A system where that is true can be trusted after a crash, a bad
 * import or a backdated correction; one where it is merely believed cannot.
 *
 * What it actually does, and why it is not what the plan first described.
 *
 * The plan asked for a replay of `ledger_events` diffed against
 * `projection_cache`. Both tables exist, and **nothing on the write path fills
 * either of them**: `UnitOfWork` is the only writer of `ledger_events`, and no
 * repository routes through it yet. A job that replayed an empty log against an
 * empty cache would print a row of green ticks that assert nothing at all —
 * precisely the falsely-ticked box this project's plan exists to prevent.
 *
 * So the check is written against what *is* the source of truth, and it reports
 * the gap rather than hiding it:
 *
 *   1. **Every entry balances.** Debits less credits, per transaction and
 *      currency, summed in SQL rather than by the domain — so a row written by
 *      any path at all, including a migration or a hand-edit, is checked.
 *   2. **Two independent recomputations agree.** Balances summed directly in SQL
 *      are diffed against the same balances read through `BalanceQuery`, which is
 *      what every screen uses. A disagreement means the query layer and the
 *      journal have parted company, which is the failure a stored balance would
 *      have hidden forever.
 *   3. **Cached projections match a fresh computation** — for as many as exist.
 *   4. **The event log's coverage is reported honestly.** An empty log is stated
 *      as a gap with its reason, not passed over.
 *
 * A difference is never repaired here. This job reports; a repair is a decision.
 */

import { AppError, Ok, Result, UseCase, UserId } from "@/core/kernel";
import { CalendarDate } from "@/core/time";
import { BalanceQuery } from "@/domain/transactions";

/* ═══ The port ════════════════════════════════════════════════════════ */

export interface UnbalancedEntry {
  readonly transactionId: string;
  readonly currency: string;
  /** Debits less credits, in minor units. Non-zero is the defect. */
  readonly differenceMinor: bigint;
}

export interface JournalSum {
  readonly accountId: string;
  readonly code: string;
  readonly currency: string;
  /** Signed by the account's normal balance, as a balance-sheet reader expects. */
  readonly balanceMinor: bigint;
}

export interface CachedProjection {
  readonly projection: string;
  readonly scope: string;
  readonly asOf: string | null;
  readonly payloadJson: string;
}

/**
 * Raw journal arithmetic, done in SQL.
 *
 * Deliberately *not* the domain's own path: the point of the diff is that two
 * independent computations agree, and a port that called `BalanceCalculator`
 * would be comparing a number with itself.
 */
export interface JournalReplaySource {
  users(): Promise<readonly UserId[]>;
  unbalancedEntries(userId: UserId): Promise<readonly UnbalancedEntry[]>;
  accountBalancesFromPostings(userId: UserId, asOf: CalendarDate): Promise<readonly JournalSum[]>;
  cachedProjections(userId: UserId): Promise<readonly CachedProjection[]>;
  counts(userId: UserId): Promise<{ transactions: number; postings: number; ledgerEvents: number }>;
}

/* ═══ The report ══════════════════════════════════════════════════════ */

export type FindingSeverity = "DIFFERENCE" | "GAP";

export interface Finding {
  readonly severity: FindingSeverity;
  readonly check: string;
  readonly detail: string;
}

export interface UserReproducibility {
  readonly userId: string;
  readonly accountsChecked: number;
  readonly transactionsChecked: number;
  readonly findings: readonly Finding[];
}

export interface ReproducibilityReport {
  readonly asOf: CalendarDate;
  readonly users: readonly UserReproducibility[];
  /** Differences only. A gap is reported but does not fail the job. */
  readonly differences: number;
  readonly gaps: number;
  readonly holds: boolean;
}

export interface VerifyReproducibilityInput {
  asOf: CalendarDate;
  /** Restrict to one user; every user otherwise. */
  userId?: UserId;
}

export class VerifyReproducibility
  implements UseCase<VerifyReproducibilityInput, ReproducibilityReport>
{
  constructor(
    private readonly source: JournalReplaySource,
    private readonly balances: BalanceQuery,
  ) {}

  async execute(
    input: VerifyReproducibilityInput,
  ): Promise<Result<ReproducibilityReport, AppError>> {
    const users = input.userId ? [input.userId] : await this.source.users();
    const perUser: UserReproducibility[] = [];

    for (const userId of users) {
      const findings: Finding[] = [];
      const counts = await this.source.counts(userId);

      /* 1. L01 — every entry balances, checked in SQL. */
      for (const entry of await this.source.unbalancedEntries(userId)) {
        findings.push({
          severity: "DIFFERENCE",
          check: "L01 double-entry",
          detail:
            `Transaction ${entry.transactionId} is out by ` +
            `${entry.differenceMinor} minor units of ${entry.currency}. An unbalanced entry ` +
            `makes every total that includes it wrong by the same amount.`,
        });
      }

      /* 2. The differential: SQL sums against the query layer. */
      const fromPostings = await this.source.accountBalancesFromPostings(userId, input.asOf);
      const fromQuery = await this.balances.balanceSheet(userId, input.asOf, {
        includeClosed: true,
        includeEmpty: true,
      });
      const queryByAccount = new Map(fromQuery.map((row) => [row.accountId.value, row]));

      for (const sum of fromPostings) {
        const row = queryByAccount.get(sum.accountId);
        if (!row) {
          findings.push({
            severity: "DIFFERENCE",
            check: "balance recomputation",
            detail:
              `${sum.code} has postings summing to ${sum.balanceMinor} minor units but does not ` +
              `appear in the balance sheet at all. A balance that exists in the journal and not ` +
              `in the reports is money nobody sees.`,
          });
          continue;
        }
        if (row.balance.minor !== sum.balanceMinor) {
          findings.push({
            severity: "DIFFERENCE",
            check: "balance recomputation",
            detail:
              `${sum.code}: the journal sums to ${sum.balanceMinor} and the balance sheet reports ` +
              `${row.balance.minor} (a difference of ${row.balance.minor - sum.balanceMinor} minor ` +
              `units). Two computations over one journal disagree, so at most one of them is right.`,
          });
        }
      }

      /* 3. Cached projections, recomputed. */
      const cached = await this.source.cachedProjections(userId);
      for (const projection of cached) {
        if (projection.projection !== "net_worth" || !projection.asOf) continue;
        const totals = await this.balances.totals(userId, CalendarDate.parse(projection.asOf));
        const stored = readNetWorthMinor(projection.payloadJson);
        if (stored === null) {
          findings.push({
            severity: "GAP",
            check: "projection cache",
            detail:
              `A cached ${projection.projection} for ${projection.asOf} has no readable net-worth ` +
              `figure, so it cannot be diffed. An undiffable cache entry is a cache entry nobody ` +
              `is checking.`,
          });
          continue;
        }
        if (stored !== totals.netWorth.minor) {
          findings.push({
            severity: "DIFFERENCE",
            check: "projection cache",
            detail:
              `The cached net worth for ${projection.asOf} is ${stored} and a fresh computation ` +
              `gives ${totals.netWorth.minor}. The cache is stale and its invalidation rule missed ` +
              `this write.`,
          });
        }
      }

      /* 4. Coverage, reported rather than assumed. */
      if (counts.transactions > 0 && counts.ledgerEvents === 0) {
        findings.push({
          severity: "GAP",
          check: "event-log coverage",
          detail:
            `${counts.transactions} transaction(s) and no ledger events. Nothing on the write path ` +
            `routes through UnitOfWork yet, so replay-from-events cannot be verified — this job ` +
            `checks the journal directly instead, and this line records what is still missing.`,
        });
      }
      if (cached.length === 0) {
        findings.push({
          severity: "GAP",
          check: "projection cache",
          detail:
            "No cached projections exist, so nothing was diffed against a fresh computation. " +
            "Reported rather than passed: an empty check is not a green one.",
        });
      }

      perUser.push({
        userId: userId.value,
        accountsChecked: fromPostings.length,
        transactionsChecked: counts.transactions,
        findings,
      });
    }

    const differences = perUser
      .flatMap((user) => user.findings)
      .filter((finding) => finding.severity === "DIFFERENCE").length;
    const gaps = perUser
      .flatMap((user) => user.findings)
      .filter((finding) => finding.severity === "GAP").length;

    return Ok({
      asOf: input.asOf,
      users: perUser,
      differences,
      gaps,
      holds: differences === 0,
    });
  }
}

/**
 * Pulls a net-worth figure out of a cached payload without trusting its shape.
 *
 * A cache written by an older version of the code is a real possibility, and a
 * throw here would fail the job for a reason that is not a discrepancy.
 */
function readNetWorthMinor(payloadJson: string): bigint | null {
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    const raw = parsed.netWorthMinor ?? parsed.netWorth;
    if (typeof raw === "number" && Number.isInteger(raw)) return BigInt(raw);
    if (typeof raw === "string" && /^-?\d+n?$/.test(raw)) return BigInt(raw.replace(/n$/, ""));
    if (typeof raw === "bigint") return raw;
    return null;
  } catch {
    return null;
  }
}

/** Formats a report for a terminal, so the script has nothing to decide. */
export function formatReproducibility(report: ReproducibilityReport): string {
  const lines: string[] = [
    `Reproducibility as of ${report.asOf.toISO()} — ${report.users.length} user(s)`,
    "",
  ];
  for (const user of report.users) {
    lines.push(
      `${user.userId}: ${user.accountsChecked} account(s), ${user.transactionsChecked} transaction(s)`,
    );
    if (user.findings.length === 0) {
      lines.push("  no differences, no gaps");
    }
    for (const finding of user.findings) {
      lines.push(`  [${finding.severity}] ${finding.check}: ${finding.detail}`);
    }
    lines.push("");
  }
  lines.push(
    report.holds
      ? `PASS — every recomputation agreed. ${report.gaps} gap(s) reported above.`
      : `FAIL — ${report.differences} difference(s). ${report.gaps} gap(s) reported above.`,
  );
  return lines.join("\n");
}
