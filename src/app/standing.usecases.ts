/**
 * The /standing measurements: one registry indicator at a time, from the
 * owner's own records (DESIGN §9f, task 3.11 wiring).
 *
 * The rule is the scoring module's (`composite.ts`): an indicator is
 * **measured only from real data**. Short history, a gap in the months, a debt
 * with no instalment on record or a cover question nobody has answered leaves it
 * **unknown, with the reason** — never a zero, never an annualised short window,
 * never a guess. `not-applicable` is used only where the registry allows it and
 * the deciding fact is stored; the one candidate, term cover where nobody depends
 * on the income, needs a dependants fact this application does not store yet, so
 * it is never produced here.
 *
 * Ledger months: the measurement window ends at the **latest complete month that
 * has any income or expense posted** (looked for in the last 48 complete months),
 * and every month the indicator needs must have postings. A month with none is a
 * gap in the records, not a month of zero spending. The window's end is the
 * figure's as-of date, so a ledger that stopped in July is measured on July and
 * the screen's stale notice says so.
 *
 * Nothing here persists. The previous tier is read from tier history when the
 * sources carry a reader (`tierHistory`): the latest record strictly before
 * today, else null. Recording is `RecordStandingTier`
 * (`src/app/standing-tier.usecases.ts`), never a side effect of this read
 * (`_architecture/requirements/standing-screen.md` § "Tier history").
 */

import { AppError, Ok, Result, UseCase, UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { compareFractions, exactRatio, moneyRatio } from "@/core/ratio";
import { CalendarDate, DateRange } from "@/core/time";
import { Count, Months, Ratio } from "@/core/units";
import type { AccountRepository } from "@/domain/accounts";
import { CardTermsRepository, CreditCard, liquidPositions, totalLiquid } from "@/domain/assets";
import { committedOutgo, type Commitment, type CommitmentRepository } from "@/domain/commitments";
import { annualPremiumOutgo, presenceOf, type AbsenceDeclaration, type InsurancePolicy, type InsuranceRepository } from "@/domain/insurance";
import type { LoanStore } from "@/domain/loans";
import { milestoneStanding } from "@/domain/milestones";
import { emergencyFundMonths } from "@/domain/reports";
import type { Measurement } from "@/domain/scoring/composite";
import { INDICATORS } from "@/domain/scoring/indicators";
import type { TierHistoryReader } from "@/domain/scoring/tier-history";
import type { CeilingFacts, Tier } from "@/domain/scoring/tiers";
import type { AccountBalance, BalanceQuery, MonthlyFlow } from "@/domain/transactions";

/* ═══ Ports ═══════════════════════════════════════════════════════════ */

/** Everything the measurements read. Narrow on purpose, so a spec can fake it with made-up figures. */
export interface StandingSources {
  readonly balances: Pick<BalanceQuery, "monthlyFlows" | "balanceSheet">;
  /** Spendable cash on `asOf`, in the reporting currency (`totalLiquid`). */
  liquidAssets(userId: UserId, asOf: CalendarDate): Promise<Money>;
  /**
   * The scheduled monthly service of each liability the source can price, keyed
   * by account id: a loan's instalment, a card's minimum due. An account missing
   * from the map has **no known service**, which the use case reports as unknown.
   */
  monthlyService(userId: UserId, asOf: CalendarDate, owed: readonly AccountBalance[]): Promise<ReadonlyMap<string, Money>>;
  readonly insurance: Pick<InsuranceRepository, "list" | "declarations">;
  readonly commitments: Pick<CommitmentRepository, "list">;
  /** Recorded tiers, for demotion hysteresis. Absent means no history: `previous` is null. */
  readonly tierHistory?: TierHistoryReader;
}

/** The production sources, built from the container's repositories (the page wires this). */
export function standingSourcesFrom(repositories: {
  readonly accounts: AccountRepository;
  readonly balances: BalanceQuery;
  readonly cardTerms: CardTermsRepository;
  readonly lending: LoanStore;
  readonly insurance: InsuranceRepository;
  readonly commitments: CommitmentRepository;
  readonly tierHistory?: TierHistoryReader;
}): StandingSources {
  const { accounts, balances, cardTerms, lending } = repositories;
  return {
    balances,
    insurance: repositories.insurance,
    commitments: repositories.commitments,
    ...(repositories.tierHistory ? { tierHistory: repositories.tierHistory } : {}),
    async liquidAssets(userId, asOf) {
      const open = await accounts.list(userId, { includeClosed: false });
      return totalLiquid(await liquidPositions(open, asOf, balances));
    },
    async monthlyService(userId, asOf, owed) {
      const all = await accounts.list(userId, { includeClosed: true });
      const byId = new Map(all.map((account) => [account.id.value, account]));
      const service = new Map<string, Money>();
      for (const loan of await lending.loadLoans(userId, all)) service.set(loan.account.id.value, loan.monthlyDebtService(asOf));
      const cards = owed.filter((row) => row.subtype === "CREDIT_CARD" && !service.has(row.accountId.value));
      const terms = await cardTerms.findManyFor(userId, cards.map((row) => row.accountId));
      for (const row of cards) {
        const account = byId.get(row.accountId.value);
        const known = terms.get(row.accountId.value);
        // The minimum due on what is owed today, by the card's own terms; no terms, no figure.
        if (!account || !known) continue;
        try {
          service.set(row.accountId.value, new CreditCard(account, known).minimumDueOn(row.balance));
        } catch {
          // Terms the card refuses (a limit in another currency) price nothing: the debt stays unknown.
        }
      }
      return service;
    },
  };
}

/* ═══ Use case ════════════════════════════════════════════════════════ */

export interface StandingMeasurementsInput {
  readonly userId: UserId;
  readonly today: CalendarDate;
}

export interface StandingMeasurementsOutput {
  /** One entry per registry indicator, always. */
  readonly measurements: ReadonlyMap<string, Measurement>;
  /**
   * The ceiling facts. `healthCover` is only read when the composite is scored,
   * which needs health cover measured; while it is unknown the conservative
   * "declared-absent" is carried, never "covered".
   */
  readonly facts: CeilingFacts;
  /** The tier shown last time: the latest tier-history record strictly before today, or null when none is recorded. */
  readonly previous: Tier | null;
  /** The oldest as-of date behind a measured (or declared-absent) indicator, or null. */
  readonly oldestInput: { readonly name: string; readonly on: CalendarDate } | null;
  /** Scope limits of these measurements, to be shown with them (`STANDING_LIMITATIONS`). */
  readonly limitations: readonly string[];
}

/** Complete months searched for the latest recorded month. */
export const LOOKBACK_MONTHS = 48;

/**
 * What the measurements knowingly leave out, stated on the screen (QA repair
 * 2026-11-03). Spendable cash comes from `totalLiquid`, which by its contract
 * counts reporting-currency cash only: cash in another currency is excluded,
 * never converted. The exclusion stays until a completeness contract for
 * foreign cash exists; until then it is disclosed, not silent.
 */
export const STANDING_LIMITATIONS: readonly string[] = Object.freeze([
  `Runway counts spendable cash in ${Currency.reporting.code} only. Cash held in another currency is left out, not converted, so runway is understated if you hold any.`,
]);

const NAME = new Map(INDICATORS.map((indicator) => [indicator.id, indicator.name]));

type Dated = { readonly measurement: Measurement; readonly on: CalendarDate | null };
const measured = (value: Extract<Measurement, { state: "measured" }>["value"], on: CalendarDate): Dated => ({ measurement: { state: "measured", value }, on });
const unknown = (reason: string): Dated => ({ measurement: { state: "unknown", reason }, on: null });

export class StandingMeasurements implements UseCase<StandingMeasurementsInput, StandingMeasurementsOutput> {
  constructor(private readonly sources: StandingSources) {}

  async execute({ userId, today }: StandingMeasurementsInput): Promise<Result<StandingMeasurementsOutput, AppError>> {
    const currency = Currency.reporting;
    const lastComplete = today.startOfMonth().plusDays(-1);
    const searched = DateRange.of(lastComplete.plusMonths(-(LOOKBACK_MONTHS - 1)).startOfMonth(), lastComplete);

    const [flows, sheet, liquid, policies, declarations, commitments] = await Promise.all([
      this.sources.balances.monthlyFlows(userId, searched),
      this.sources.balances.balanceSheet(userId, today, { includeClosed: true }),
      this.sources.liquidAssets(userId, today),
      this.sources.insurance.list(userId),
      this.sources.insurance.declarations(userId),
      this.sources.commitments.list(userId),
    ]);
    const owed = sheet.filter((row) => row.type === "LIABILITY" && row.balance.isPositive);
    const service = owed.length === 0 ? new Map<string, Money>() : await this.sources.monthlyService(userId, today, owed);
    // Strictly before today, so reading (or recording) again today never feeds today's tier into its own hysteresis.
    const previous = (await this.sources.tierHistory?.latestBefore(userId, today))?.tier ?? null;

    const history = recordedHistory(flows, currency);
    const debt = debtService(owed, service, currency);
    const obligations = fixedObligations(debt, commitments, policies, today, currency);
    const health = presenceOf("HEALTH", policies, declarations, today);

    const results = new Map<string, Dated>([
      ["runway-months", runway(history, liquid)],
      ["savings-rate", savingsStanding(history)],
      ["debt-service-ratio", ratioToIncome(history, debt, "Debt service")],
      ["foir-ceiling", ratioToIncome(history, obligations, "Fixed obligations")],
      ["income-stability", incomeStability(history)],
      ["health-cover-present", cover("HEALTH", policies, declarations, today)],
      ["term-cover-present", termCover(policies, declarations, today)],
      ["independence-multiple", independence(history, sheet, currency)],
    ]);

    const measurements = new Map(INDICATORS.map((indicator) => [indicator.id, results.get(indicator.id)?.measurement ?? { state: "unknown" as const, reason: "not measured yet" }]));
    const foir = measurements.get("foir-ceiling");
    let oldestInput: StandingMeasurementsOutput["oldestInput"] = null;
    for (const [id, dated] of results) {
      if (dated.on !== null && (oldestInput === null || dated.on.isBefore(oldestInput.on))) oldestInput = { name: NAME.get(id) ?? id, on: dated.on };
    }

    return Ok(Object.freeze({
      measurements,
      facts: Object.freeze({
        healthCover: health.state === "covered" ? "covered" as const : "declared-absent" as const,
        foir: foir?.state === "measured" ? Ratio(foir.value) : null,
      }),
      previous,
      oldestInput,
      limitations: STANDING_LIMITATIONS,
    }));
  }
}

/* ═══ Ledger history ══════════════════════════════════════════════════ */

interface RecordedHistory {
  /** The contiguous run of months with postings, oldest first, ending at the latest recorded month. */
  readonly months: readonly MonthlyFlow[];
  /** The last day of the latest recorded month, or null when no month has postings. */
  readonly endsOn: CalendarDate | null;
  /** Set when the flows are not all in the reporting currency. */
  readonly refused: string | null;
}

const isRecorded = (flow: MonthlyFlow) => !flow.income.isZero || !flow.expense.isZero;

/** The unbroken run of recorded months ending at the latest one. A month with no postings breaks it. */
function recordedHistory(flows: readonly MonthlyFlow[], currency: Currency): RecordedHistory {
  if (flows.some((flow) => flow.income.currency.code !== currency.code || flow.expense.currency.code !== currency.code)) {
    return { months: [], endsOn: null, refused: `Monthly totals are not all in ${currency.code}.` };
  }
  const sorted = [...flows].sort((a, b) => a.month.localeCompare(b.month));
  let end = sorted.length - 1;
  while (end >= 0 && !isRecorded(sorted[end])) end -= 1;
  if (end < 0) return { months: [], endsOn: null, refused: null };
  let start = end;
  while (start > 0 && isRecorded(sorted[start - 1]) && consecutive(sorted[start - 1].month, sorted[start].month)) start -= 1;
  return { months: sorted.slice(start, end + 1), endsOn: CalendarDate.parse(`${sorted[end].month}-01`).endOfMonth(), refused: null };
}

function consecutive(earlier: string, later: string): boolean {
  return CalendarDate.parse(`${earlier}-01`).plusMonths(1).toMonthKey() === later;
}

/** The reason `needed` recorded months are not available, or null when they are. */
function shortOf(history: RecordedHistory, needed: number): string | null {
  if (history.refused !== null) return history.refused;
  if (history.endsOn === null) return `Needs ${needed} months of recorded income and expenses; none are recorded.`;
  if (history.months.length < needed) {
    return `Needs ${needed} consecutive months of recorded income and expenses; ${history.months.length} recorded up to ${history.endsOn.toMonthKey()}.`;
  }
  return null;
}

const lastN = (history: RecordedHistory, n: number) => history.months.slice(history.months.length - n);
const sum = (amounts: readonly Money[], currency: Currency) => Money.total(amounts, currency);
/** `part ÷ whole`, divided exactly in BigInt (`moneyRatio`): no amount ever passes through a float. */
const share = (part: Money, whole: Money): Ratio => moneyRatio(part, whole);

function median(amounts: readonly Money[]): Money {
  const sorted = [...amounts].sort((a, b) => a.compareTo(b));
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : sorted[middle - 1].plus(sorted[middle]).dividedBy(2, "HALF_UP");
}

/* ═══ Indicators ══════════════════════════════════════════════════════ */

/** Liquid assets ÷ average monthly outgo over the trailing 12 months (`emergencyFundMonths`). */
function runway(history: RecordedHistory, liquid: Money): Dated {
  const short = shortOf(history, 12);
  if (short !== null) return unknown(short);
  const year = lastN(history, 12);
  // A port that returns cash in another currency than the history is refused as unknown, never converted or thrown.
  const currency = year[0].expense.currency;
  if (liquid.currency.code !== currency.code) return unknown(`Spendable cash is in ${liquid.currency.code} but outgo is in ${currency.code}; no conversion is made.`);
  const outgo = sum(year.map((month) => month.expense), currency).dividedBy(12, "HALF_UP");
  const months = emergencyFundMonths(liquid, outgo);
  if (months === null) return unknown("No outgo is recorded in the trailing 12 months, so runway has no denominator.");
  return measured(Months(months), history.endsOn!);
}

/**
 * Savings rate, banded against the owner's own last 24 months: the trailing-12
 * rate (1 − outgo ÷ income) at each of the 13 month-ends whose window fits in
 * those 24 months; the standing is the latest's percentile among the 12 earlier
 * ones (ties count half). 1 means better than every earlier window.
 */
function savingsStanding(history: RecordedHistory): Dated {
  const short = shortOf(history, 24);
  if (short !== null) return unknown(short);
  const months = lastN(history, 24);
  const currency = months[0].income.currency;
  // Each rate is kept as the exact fraction (income − outgo) / income, in minor units,
  // and compared by cross-multiplication: no amount is turned into a float.
  const rates: { readonly saved: bigint; readonly income: bigint }[] = [];
  for (let end = 11; end < 24; end += 1) {
    const window = months.slice(end - 11, end + 1);
    const income = sum(window.map((m) => m.income), currency);
    if (!income.isPositive) return unknown(`No income is recorded in the 12 months to ${window[11].month}, so a savings rate cannot be taken.`);
    rates.push({ saved: income.minus(sum(window.map((m) => m.expense), currency)).minor, income: income.minor });
  }
  const latest = rates[rates.length - 1];
  const earlier = rates.slice(0, -1);
  const order = (rate: (typeof rates)[number]) => compareFractions(rate.saved, rate.income, latest.saved, latest.income);
  const below = earlier.filter((rate) => order(rate) < 0).length;
  const equal = earlier.filter((rate) => order(rate) === 0).length;
  return measured(Ratio((below + equal / 2) / earlier.length), history.endsOn!);
}

/**
 * Income stability: the coefficient of variation of monthly income over the
 * trailing 12 months, against that of the **prior 24 months** (the 24 before
 * them), so 36 recorded months are needed. Normalised like an at-most benchmark
 * whose target is the owner's own prior CV: at or below it is 1; above it, prior ÷ current.
 */
function incomeStability(history: RecordedHistory): Dated {
  const short = shortOf(history, 36);
  if (short !== null) return unknown(short);
  const months = lastN(history, 36);
  const current = squaredVariation(months.slice(24).map((m) => m.income.minor));
  const prior = squaredVariation(months.slice(0, 24).map((m) => m.income.minor));
  if (current === null || prior === null) return unknown("Mean monthly income is zero in one of the periods, so its variation is not defined.");
  // current ≤ prior, compared exactly: CVc²·… ≤ CVp²·… by cross-multiplication.
  if (compareFractions(current.top, current.bottom, prior.top, prior.bottom) <= 0) return measured(Ratio(1), history.endsOn!);
  // prior ÷ current = √(CVp² ÷ CVc²): the squared ratio is divided exactly, and only that
  // dimensionless quotient — never an amount — is square-rooted in floating point.
  return measured(Ratio(Math.sqrt(exactRatio(prior.top * current.bottom, prior.bottom * current.top))), history.endsOn!);
}

/**
 * The squared population coefficient of variation of minor-unit amounts, as the
 * exact fraction `(n·Σx² − (Σx)²) / (Σx)²` — so amounts of any size stay in
 * BigInt. Null when the mean is not positive.
 */
function squaredVariation(values: readonly bigint[]): { readonly top: bigint; readonly bottom: bigint } | null {
  const n = BigInt(values.length);
  const total = values.reduce((a, b) => a + b, 0n);
  if (total <= 0n) return null;
  const squares = values.reduce((a, b) => a + b * b, 0n);
  return { top: n * squares - total * total, bottom: total * total };
}

type Amount = { readonly amount: Money } | { readonly unknown: string };

/** Monthly instalments and card minimums for every liability owed today. One unpriced debt makes the total unknown. */
function debtService(owed: readonly AccountBalance[], service: ReadonlyMap<string, Money>, currency: Currency): Amount {
  const missing = owed.filter((row) => !service.has(row.accountId.value));
  if (missing.length > 0) {
    return { unknown: `${missing.map((row) => row.name).join(", ")} ${missing.length === 1 ? "is" : "are"} owed with no instalment or card terms on record.` };
  }
  const amounts = owed.map((row) => service.get(row.accountId.value)!);
  const foreign = owed.filter((_, index) => amounts[index].currency.code !== currency.code);
  if (foreign.length > 0) return { unknown: `${foreign.map((row) => row.name).join(", ")} ${foreign.length === 1 ? "is" : "are"} not in ${currency.code}.` };
  return { amount: sum(amounts, currency) };
}

/**
 * All fixed monthly obligations on record: debt service, recorded commitments,
 * and insurance premiums in force (annual ÷ 12). Rent is not a recorded
 * obligation in this application, so it is not counted (open item in the plan).
 */
function fixedObligations(debt: Amount, commitments: readonly Commitment[], policies: readonly InsurancePolicy[], today: CalendarDate, currency: Currency): Amount {
  if ("unknown" in debt) return debt;
  const foreignCommitments = commitments.filter((c) => c.activeOn(today) && c.currency.code !== currency.code);
  const foreignPolicies = policies.filter((p) => p.inForceOn(today) && p.currency.code !== currency.code);
  if (foreignCommitments.length + foreignPolicies.length > 0) {
    return { unknown: `${[...foreignCommitments.map((c) => c.name), ...foreignPolicies.map((p) => p.insurer)].join(", ")} not in ${currency.code}.` };
  }
  const committed = committedOutgo(commitments, today, currency).perMonth;
  if (committed === null) return { unknown: "A recorded commitment has no known price, so committed outgo is unknown." };
  const premiums = annualPremiumOutgo(policies, today, currency);
  if (premiums === null) return { unknown: "A policy in force has no known premium, so premium outgo is unknown." };
  return { amount: debt.amount.plus(committed).plus(premiums.dividedBy(12, "HALF_UP")) };
}

/** `amount` ÷ median monthly net income over the trailing 12 months. */
function ratioToIncome(history: RecordedHistory, amount: Amount, what: string): Dated {
  if ("unknown" in amount) return unknown(amount.unknown);
  const short = shortOf(history, 12);
  if (short !== null) return unknown(short);
  const income = median(lastN(history, 12).map((month) => month.income));
  if (!income.isPositive) return unknown(`Median monthly income over the trailing 12 months is not positive, so ${what.toLowerCase()} has no denominator.`);
  return measured(Ratio(share(amount.amount, income)), history.endsOn!);
}

/** Presence: covered is a count of policies in force today; a declaration is dated by when it was made. */
function cover(kind: "HEALTH" | "TERM_LIFE", policies: readonly InsurancePolicy[], declarations: readonly AbsenceDeclaration[], today: CalendarDate): Dated {
  const presence = presenceOf(kind, policies, declarations, today);
  const label = kind === "HEALTH" ? "health" : "term life";
  switch (presence.state) {
    case "covered": return measured(Count(presence.policies.length), today);
    case "declared-absent": return { measurement: { state: "declared-absent" }, on: presence.declaredOn };
    case "unknown": return unknown(`No ${label} policy in force and no statement that you hold none is recorded.`);
  }
}

/**
 * Term cover counts only where someone depends on the income. A policy in force
 * is measured presence either way; a declared absence cannot be scored until
 * whether anyone depends on the income is recorded, and that is not stored yet.
 */
function termCover(policies: readonly InsurancePolicy[], declarations: readonly AbsenceDeclaration[], today: CalendarDate): Dated {
  const dated = cover("TERM_LIFE", policies, declarations, today);
  if (dated.measurement.state === "declared-absent") {
    return unknown("You have stated you hold no term life policy, but whether anyone depends on your income is not recorded, so it is not scored.");
  }
  return dated;
}

/**
 * Total net worth ÷ trailing-12-month expenses, via `milestoneStanding` (owner
 * decision 2026-11-03: total net worth, not retirement accounts). Net worth is
 * every asset less every liability on the ledger balance sheet today. An asset
 * or liability with a balance in another currency makes it **unknown, naming
 * the account** — no conversion is made and nothing is silently left out.
 */
function independence(history: RecordedHistory, sheet: readonly AccountBalance[], currency: Currency): Dated {
  if (history.refused !== null) return unknown(history.refused);
  const held = sheet.filter((row) => (row.type === "ASSET" || row.type === "LIABILITY") && !row.balance.isZero);
  const foreign = held.filter((row) => row.balance.currency.code !== currency.code);
  if (foreign.length > 0) {
    return unknown(`Net worth cannot be totalled: ${foreign.map((row) => row.name).join(", ")} ${foreign.length === 1 ? "is" : "are"} not in ${currency.code}, and no conversion is made.`);
  }
  const assets = sum(held.filter((row) => row.type === "ASSET").map((row) => row.balance), currency);
  const liabilities = sum(held.filter((row) => row.type === "LIABILITY").map((row) => row.balance), currency);
  const year = lastN(history, Math.min(12, history.months.length));
  const standing = milestoneStanding(assets.minus(liabilities), {
    months: Count(year.length),
    trailingTwelveMonths: sum(year.map((month) => month.expense), currency),
  });
  if (standing.state === "refused") return unknown(standing.reason);
  return measured(standing.multiple, history.endsOn!);
}
