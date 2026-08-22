import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { journalEntries, ledgerAccounts, postings } from "@/db/schema";
import type { UserId } from "@/shared/kernel/UserId";
import { Currency } from "@/shared/money/Currency";
import { Money } from "@/shared/money/Money";
import { CalendarDate } from "@/shared/time/CalendarDate";
import type { DateRange } from "@/shared/time/DateRange";
import { AccountId } from "../../domain/ids";
import type {
  AccountBalance,
  AccountFlow,
  BalanceQuery,
  MonthlyFlow,
  TypeTotals,
} from "../../domain/ports/BalanceQuery";
import type { AccountTypeName } from "../../domain/value-objects/AccountType";

/**
 * The signed contribution of a posting to its account's own balance, in SQL.
 *
 * This is `AccountType.signedEffect` expressed once as a CASE, and it is the only
 * place the rule is duplicated outside the domain. A debit raises an asset or
 * expense and lowers a liability, equity or income; a credit does the reverse.
 *
 * Keeping it in a single exported fragment means every aggregate below shares the
 * definition — the failure mode to avoid is two reports disagreeing because one
 * of them re-derived the sign.
 */
const SIGNED_AMOUNT = sql<number>`
  CASE
    WHEN ${ledgerAccounts.type} IN ('ASSET', 'EXPENSE')
      THEN CASE WHEN ${postings.direction} = 'DEBIT' THEN ${postings.amountMinor} ELSE -${postings.amountMinor} END
    ELSE
      CASE WHEN ${postings.direction} = 'CREDIT' THEN ${postings.amountMinor} ELSE -${postings.amountMinor} END
  END
`;

/**
 * libSQL implementation of {@link BalanceQuery}.
 *
 * Aggregates run in the database — `SUM` over an indexed join, not every posting
 * pulled into Node and folded. `BalanceCalculator` is the pure reference these
 * queries are checked against.
 */
export class DrizzleBalanceQuery implements BalanceQuery {
  constructor(
    private readonly db: Database,
    private readonly currency: Currency = Currency.reporting,
  ) {}

  private money(minor: number | null): Money {
    return Money.fromMinor(minor ?? 0, this.currency);
  }

  async balanceSheet(
    userId: UserId,
    asOf: CalendarDate,
    options?: { includeClosed?: boolean; includeEmpty?: boolean },
  ): Promise<AccountBalance[]> {
    // LEFT JOIN so an account with no postings still appears at zero — the user
    // needs to see an account they just created.
    const rows = await this.db
      .select({
        accountId: ledgerAccounts.id,
        code: ledgerAccounts.code,
        name: ledgerAccounts.name,
        type: ledgerAccounts.type,
        subtype: ledgerAccounts.subtype,
        institution: ledgerAccounts.institution,
        isClosed: ledgerAccounts.isClosed,
        balance: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
        postingCount: sql<number>`COUNT(${postings.id})`,
      })
      .from(ledgerAccounts)
      .leftJoin(
        postings,
        and(
          eq(postings.accountId, ledgerAccounts.id),
          sql`${postings.entryId} IN (
            SELECT ${journalEntries.id} FROM ${journalEntries}
            WHERE ${journalEntries.userId} = ${userId.value}
              AND ${journalEntries.postedOn} <= ${asOf.toISO()}
          )`,
        ),
      )
      .where(
        and(
          eq(ledgerAccounts.userId, userId.value),
          sql`${ledgerAccounts.type} IN ('ASSET', 'LIABILITY', 'EQUITY')`,
          options?.includeClosed ? undefined : eq(ledgerAccounts.isClosed, false),
        ),
      )
      .groupBy(ledgerAccounts.id)
      .orderBy(ledgerAccounts.sortOrder, ledgerAccounts.code);

    return rows
      .filter((row) => options?.includeEmpty !== false || row.postingCount > 0)
      .map((row) => ({
        accountId: AccountId.from(row.accountId),
        code: row.code,
        name: row.name,
        type: row.type as AccountTypeName,
        subtype: row.subtype,
        institution: row.institution,
        isClosed: row.isClosed,
        balance: this.money(row.balance),
        postingCount: Number(row.postingCount),
      }));
  }

  async balanceOf(userId: UserId, accountId: AccountId, asOf: CalendarDate): Promise<Money> {
    const [row] = await this.db
      .select({ balance: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)` })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .innerJoin(journalEntries, eq(postings.entryId, journalEntries.id))
      .where(
        and(
          eq(journalEntries.userId, userId.value),
          eq(postings.accountId, accountId.value),
          sql`${journalEntries.postedOn} <= ${asOf.toISO()}`,
        ),
      );
    return this.money(row?.balance ?? 0);
  }

  async totals(userId: UserId, asOf: CalendarDate): Promise<TypeTotals> {
    const rows = await this.db
      .select({
        type: ledgerAccounts.type,
        balance: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .innerJoin(journalEntries, eq(postings.entryId, journalEntries.id))
      .where(
        and(eq(journalEntries.userId, userId.value), sql`${journalEntries.postedOn} <= ${asOf.toISO()}`),
      )
      .groupBy(ledgerAccounts.type);

    const byType = new Map(rows.map((row) => [row.type, this.money(row.balance)]));
    const zero = Money.zero(this.currency);
    const assets = byType.get("ASSET") ?? zero;
    const liabilities = byType.get("LIABILITY") ?? zero;

    return {
      asOf,
      assets,
      liabilities,
      equity: byType.get("EQUITY") ?? zero,
      // Income and expense are deliberately excluded: they are flows, and adding
      // them would count every transaction twice.
      netWorth: assets.minus(liabilities),
    };
  }

  async monthlyFlows(userId: UserId, range: DateRange): Promise<MonthlyFlow[]> {
    const rows = await this.db
      .select({
        month: sql<string>`substr(${journalEntries.postedOn}, 1, 7)`,
        type: ledgerAccounts.type,
        total: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .innerJoin(journalEntries, eq(postings.entryId, journalEntries.id))
      .where(
        and(
          eq(journalEntries.userId, userId.value),
          sql`${journalEntries.postedOn} >= ${range.start.toISO()}`,
          sql`${journalEntries.postedOn} <= ${range.end.toISO()}`,
          sql`${ledgerAccounts.type} IN ('INCOME', 'EXPENSE')`,
        ),
      )
      .groupBy(sql`substr(${journalEntries.postedOn}, 1, 7)`, ledgerAccounts.type);

    const zero = Money.zero(this.currency);
    const byMonth = new Map<string, MonthlyFlow>();
    // Seed every month in the range so a gap renders as zero rather than
    // disappearing from the chart and compressing the x-axis.
    for (const month of range.months()) {
      const key = month.start.toMonthKey();
      byMonth.set(key, { month: key, income: zero, expense: zero });
    }
    for (const row of rows) {
      const flow = byMonth.get(row.month) ?? { month: row.month, income: zero, expense: zero };
      if (row.type === "INCOME") flow.income = this.money(row.total);
      else flow.expense = this.money(row.total);
      byMonth.set(row.month, flow);
    }

    return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  }

  async flowsByAccount(
    userId: UserId,
    range: DateRange,
    options?: { type?: "INCOME" | "EXPENSE"; rollUp?: boolean },
  ): Promise<AccountFlow[]> {
    const typeFilter = options?.type
      ? eq(ledgerAccounts.type, options.type)
      : sql`${ledgerAccounts.type} IN ('INCOME', 'EXPENSE')`;

    // Driven from `ledgerAccounts` with a LEFT JOIN, not from `postings`.
    // A rollup target such as `Expenses:Food` usually has no postings of its own —
    // only its children do — so an inner join would omit exactly the rows the
    // rollup needs to accumulate into.
    const rows = await this.db
      .select({
        accountId: ledgerAccounts.id,
        code: ledgerAccounts.code,
        name: ledgerAccounts.name,
        type: ledgerAccounts.type,
        amount: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
        postingCount: sql<number>`COUNT(${postings.id})`,
      })
      .from(ledgerAccounts)
      .leftJoin(
        postings,
        and(
          eq(postings.accountId, ledgerAccounts.id),
          sql`${postings.entryId} IN (
            SELECT ${journalEntries.id} FROM ${journalEntries}
            WHERE ${journalEntries.userId} = ${userId.value}
              AND ${journalEntries.postedOn} >= ${range.start.toISO()}
              AND ${journalEntries.postedOn} <= ${range.end.toISO()}
          )`,
        ),
      )
      .where(and(eq(ledgerAccounts.userId, userId.value), typeFilter))
      .groupBy(ledgerAccounts.id);

    const flows: AccountFlow[] = rows.map((row) => ({
      accountId: AccountId.from(row.accountId),
      code: row.code,
      name: row.name,
      type: row.type as AccountTypeName,
      amount: this.money(row.amount),
      postingCount: Number(row.postingCount),
    }));

    const result = options?.rollUp ? this.rollUp(flows) : flows;

    // Drop accounts with no activity in the period — a category chart should show
    // what was spent, not all 40 available categories at zero.
    return result.filter((flow) => flow.postingCount > 0 || !flow.amount.isZero);
  }

  /**
   * Adds each account's total into all of its ancestors, so `Expenses:Food`
   * reports its whole subtree.
   *
   * Done in JS over an already-aggregated result — a handful of rows — rather than
   * as a recursive CTE, because the code prefix already encodes the tree and this
   * keeps the SQL above readable.
   */
  private rollUp(flows: readonly AccountFlow[]): AccountFlow[] {
    const byCode = new Map(flows.map((flow) => [flow.code, { ...flow }]));

    for (const flow of flows) {
      const segments = flow.code.split(":");
      for (let depth = 1; depth < segments.length; depth += 1) {
        const ancestorCode = segments.slice(0, depth).join(":");
        const ancestor = byCode.get(ancestorCode);
        if (ancestor) {
          ancestor.amount = ancestor.amount.plus(flow.amount);
          ancestor.postingCount += flow.postingCount;
        }
      }
    }

    return [...byCode.values()].sort((a, b) => b.amount.compareTo(a.amount));
  }

  async balanceSeries(
    userId: UserId,
    accountId: AccountId,
    range: DateRange,
  ): Promise<{ date: CalendarDate; balance: Money }[]> {
    // The opening position: everything before the window, as one figure.
    const opening = await this.balanceOf(userId, accountId, range.start.plusDays(-1));

    const rows = await this.db
      .select({
        date: journalEntries.postedOn,
        delta: sql<number>`COALESCE(SUM(${SIGNED_AMOUNT}), 0)`,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .innerJoin(journalEntries, eq(postings.entryId, journalEntries.id))
      .where(
        and(
          eq(journalEntries.userId, userId.value),
          eq(postings.accountId, accountId.value),
          sql`${journalEntries.postedOn} >= ${range.start.toISO()}`,
          sql`${journalEntries.postedOn} <= ${range.end.toISO()}`,
        ),
      )
      .groupBy(journalEntries.postedOn)
      .orderBy(journalEntries.postedOn);

    let running = opening;
    return rows.map((row) => {
      running = running.plus(this.money(row.delta));
      return { date: CalendarDate.parse(row.date), balance: running };
    });
  }
}
