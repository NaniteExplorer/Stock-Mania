import { DomainError, UserId, ValueObject } from "@/core/kernel";
import { Money, ROUNDING } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { CalendarDate, FinancialYear } from "@/core/time";

/**
 * The tax engine.
 *
 * Two properties make this trustworthy, and both are structural rather than
 * documented:
 *
 *  1. **`gain` and `taxable` are separate fields.** They diverge whenever
 *     grandfathering or indexation fires, and a single "amount" cannot express
 *     "you made ₹8,00,000 and are taxed on ₹3,75,000 of it".
 *  2. **Every `TaxLine` names the rule that produced it and the inputs it used.**
 *     A tax report is only defensible if "why this number" is answerable without
 *     re-running the engine.
 *
 * The structural change from v1: a **pipeline**, not first-match-wins. v1's
 * `ruleFor()` returned the first matching rule, which cannot express "grandfather
 * the basis, then classify long-term, then consume the exemption, then add
 * surcharge and cess" — four rules on one event. That is why its
 * `CapitalGainsRule` fused classification, rate and exemption into one class, and
 * why it could not report `gain ≠ taxable`.
 */

/* ═══ Vocabulary ═════════════════════════════════════════════════════════ */

export type TaxCategory =
  | "LISTED_EQUITY"
  | "EQUITY_MUTUAL_FUND"
  | "DEBT"
  | "DEBT_LEGACY"
  | "UNLISTED_EQUITY"
  | "GOLD"
  | "VDA"
  | "EXEMPT_SCHEME"
  /**
   * Futures and options.
   *
   * Not a capital gain at all: F&O is **non-speculative business income** under
   * §43(5)(d), taxed at the slab rate with no holding-period benefit, and its
   * losses may be set off only against business income — never against a capital
   * gain. Treating it as a capital gain is the single most common F&O filing
   * error, and it goes both ways: it understates tax on a profitable year and
   * overstates the relief available in a losing one.
   */
  | "FNO_BUSINESS";

export type GainTerm = "SHORT_TERM" | "LONG_TERM" | "EXEMPT" | "SLAB";

export type TaxBucket =
  | "STCG_EQUITY"
  | "LTCG_EQUITY"
  | "STCG_OTHER"
  | "LTCG_OTHER"
  | "SLAB"
  | "FLAT_VDA"
  /** F&O and other non-speculative business income. Segregated from every capital bucket. */
  | "BUSINESS_NON_SPECULATIVE"
  | "EXEMPT";

export type TaxableEventKind =
  | "CAPITAL_GAIN"
  | "DIVIDEND"
  | "INTEREST"
  | "SLAB_INCOME"
  /** A closed derivative position. Its own kind so no capital-gain rule claims it. */
  | "BUSINESS_INCOME"
  | "OTHER";

/**
 * What the tax engine sees.
 *
 * Produced by a `Transaction`'s `taxableEvents()` hook, so the engine never
 * learns what a corporate action is — it only sees the disposals one produced.
 *
 * `deductibleCharges` and not `totalCharges`, deliberately: STT is not deductible
 * against capital gains, and offering the total here would make deducting it the
 * path of least resistance.
 */
export interface TaxableEvent {
  readonly id: string;
  readonly kind: TaxableEventKind;
  readonly onDate: CalendarDate;
  readonly taxCategory: TaxCategory;
  readonly instrumentId: string | null;
  readonly acquiredOn: CalendarDate | null;
  readonly holdingDays: number | null;
  readonly proceeds: Money | null;
  readonly costBasis: Money | null;
  /** Economic gain, before any relief. Never modified by a rule. */
  readonly gain: Money;
  /** Only the deductible portion — see `ChargeBreakdown.deductible`. */
  readonly deductibleCharges: Money;
  /** Fair market value on the grandfathering date, when one is needed. */
  readonly fmvOnGrandfatherDate: Money | null;
  readonly sourceTransactionId: string;
  readonly sourceLotId: string | null;
}

/** User circumstances the rules need but cannot derive. */
export interface TaxSettings {
  readonly slabRate: Percentage;
  /** Total income, for the surcharge band. */
  readonly totalIncome: Money;
  readonly residentStatus: "RESIDENT" | "NON_RESIDENT";
}

/**
 * One line of a tax computation, with its provenance.
 *
 * `inputs` is a flat string map on purpose: it is rendered as "why this number"
 * without the UI having to know any rule's shape, and it survives being stored as
 * JSON and read back years later.
 */
export interface TaxLine {
  readonly eventId: string;
  /** Stable rule identifier, e.g. `IN.LTCG_EXEMPTION_125K`. */
  readonly rule: string;
  /** Which regime computed it, so a stored line is reproducible. */
  readonly ruleVersion: string;
  readonly label: string;
  readonly bucket: TaxBucket;
  readonly term: GainTerm;
  /** Economic gain. Written once, by classification, and never by a relief. */
  readonly gain: Money;
  /** After step-up, indexation, set-off and exemption. */
  readonly taxableAmount: Money;
  readonly rate: Percentage;
  readonly tax: Money;
  readonly inputs: Readonly<Record<string, string>>;
  readonly derivedFrom: readonly string[];
}

export interface CarryForward {
  readonly bucket: TaxBucket;
  readonly financialYear: string;
  readonly amount: Money;
  readonly expiresInFinancialYear: string;
}

export interface TaxAssessment {
  readonly financialYear: string;
  readonly regime: string;
  readonly lines: readonly TaxLine[];
  readonly totals: Readonly<Record<string, { gain: Money; taxable: Money; tax: Money }>>;
  readonly surcharge: Money;
  readonly cess: Money;
  readonly totalTax: Money;
  readonly exemptionUsed: Money;
  readonly lossesCarriedForward: readonly CarryForward[];
  readonly warnings: readonly string[];
}

/* ═══ Ledgers — the finite resources rules compete for ═══════════════════ */

/**
 * The LTCG exemption, tracked by consumption.
 *
 * v1 back-derived "how much exemption was used" as `amount − taxableAmount`,
 * which is wrong the moment indexation also moves `taxableAmount`. Tracking the
 * consumption directly is the only way the figure stays right when two reliefs
 * apply to one event.
 */
export class ExemptionLedger {
  private consumed = new Map<string, bigint>();

  constructor(private readonly limits: ReadonlyMap<TaxBucket, Money>) {}

  remaining(bucket: TaxBucket, currency: Money): Money {
    const limit = this.limits.get(bucket);
    if (!limit) return Money.zero(currency.currency);
    const used = this.consumed.get(bucket) ?? 0n;
    const left = limit.minor - used;
    return Money.fromMinor(left > 0n ? left : 0n, limit.currency);
  }

  /** Consumes up to `amount` and returns what was actually taken. */
  consume(bucket: TaxBucket, amount: Money): Money {
    const available = this.remaining(bucket, amount);
    const taken = amount.isLessThanOrEqual(available) ? amount : available;
    this.consumed.set(bucket, (this.consumed.get(bucket) ?? 0n) + taken.minor);
    return taken;
  }

  get totalConsumed(): bigint {
    let sum = 0n;
    for (const used of this.consumed.values()) sum += used;
    return sum;
  }
}

/**
 * Brought-forward losses and the statutory set-off ordering.
 *
 * The ordering is not arbitrary and is the part v1 never implemented: a
 * short-term loss may be set off against a long-term gain, but a long-term loss
 * may only be set off against a long-term gain. Getting that backwards
 * understates tax.
 */
export class LossLedger {
  private available: { bucket: TaxBucket; fy: string; amount: bigint; expires: string }[] = [];

  add(bucket: TaxBucket, financialYear: string, amount: Money): void {
    const fy = FinancialYear.parse(financialYear);
    this.available.push({
      bucket,
      fy: financialYear,
      amount: amount.abs().minor,
      // Eight assessment years, per the Income-tax Act.
      expires: FinancialYear.startingIn(fy.startYear + 8).label,
    });
  }

  /** Drops anything past its eight-year life, returning what lapsed. */
  expire(currentFy: string): { bucket: TaxBucket; fy: string; amount: bigint }[] {
    const current = FinancialYear.parse(currentFy).startYear;
    const lapsed = this.available.filter(
      (l) => FinancialYear.parse(l.expires).startYear <= current,
    );
    this.available = this.available.filter(
      (l) => FinancialYear.parse(l.expires).startYear > current,
    );
    return lapsed.map((l) => ({ bucket: l.bucket, fy: l.fy, amount: l.amount }));
  }

  /**
   * Which losses may offset a gain in `bucket`, oldest first.
   *
   * A short-term loss offsets either term; a long-term loss offsets long-term
   * only. VDA losses offset nothing at all — that is the point of a flat rate
   * with no set-off.
   */
  private eligible(bucket: TaxBucket): typeof this.available {
    if (bucket === "FLAT_VDA") return [];
    /*
     * Business income and capital gains do not meet.
     *
     * An F&O loss set off against an equity gain is the error this branch
     * exists to make impossible, and it is a two-way wall: a capital loss
     * cannot reduce business income either. Both directions are §72's, not a
     * preference.
     */
    const business = bucket === "BUSINESS_NON_SPECULATIVE";
    if (business) return this.available.filter((l) => l.bucket === "BUSINESS_NON_SPECULATIVE");
    const longTerm = bucket === "LTCG_EQUITY" || bucket === "LTCG_OTHER";
    return this.available
      .filter((l) => l.bucket !== "FLAT_VDA" && l.bucket !== "BUSINESS_NON_SPECULATIVE")
      .filter((l) => {
        const lossIsLongTerm = l.bucket === "LTCG_EQUITY" || l.bucket === "LTCG_OTHER";
        return lossIsLongTerm ? longTerm : true;
      })
      .sort((a, b) => FinancialYear.parse(a.fy).startYear - FinancialYear.parse(b.fy).startYear);
  }

  /** Applies losses to a gain and reports which years were drawn on. */
  offset(bucket: TaxBucket, gain: Money): { remaining: Money; used: { fy: string; amount: Money }[] } {
    let left = gain.minor;
    const used: { fy: string; amount: Money }[] = [];
    for (const loss of this.eligible(bucket)) {
      if (left <= 0n) break;
      const take = loss.amount < left ? loss.amount : left;
      if (take <= 0n) continue;
      loss.amount -= take;
      left -= take;
      used.push({ fy: loss.fy, amount: Money.fromMinor(take, gain.currency) });
    }
    this.available = this.available.filter((l) => l.amount > 0n);
    return { remaining: Money.fromMinor(left, gain.currency), used };
  }

  outstanding(currency: Money): CarryForward[] {
    return this.available.map((l) => ({
      bucket: l.bucket,
      financialYear: l.fy,
      amount: Money.fromMinor(l.amount, currency.currency),
      expiresInFinancialYear: l.expires,
    }));
  }
}

/* ═══ The accumulator a rule chain mutates ══════════════════════════════ */

/**
 * Per-event working state.
 *
 * `gain` is set once, by classification, from the raw cost. Every relief writes
 * only `taxableAmount`. That single discipline is what makes `gain ≠ taxable`
 * expressible at all.
 */
export interface EventAccumulator {
  gain: Money;
  adjustedBasis: Money | null;
  taxable: Money;
  term: GainTerm;
  bucket: TaxBucket;
  rate: Percentage;
  exempt: boolean;
  /** Accumulated provenance inputs, merged into every line the chain emits. */
  inputs: Record<string, string>;
  lines: TaxLine[];
}

export interface AssessmentContext {
  readonly regime: TaxRegime;
  readonly settings: TaxSettings;
  readonly exemption: ExemptionLedger;
  readonly losses: LossLedger;
  readonly financialYear: FinancialYear;
  readonly accumulator: EventAccumulator;
  readonly warnings: string[];
}

/* ═══ Rules ══════════════════════════════════════════════════════════════ */

export abstract class TaxRule {
  abstract readonly name: string;
  /** Ascending. Gaps of 100, so a new rule slots in without renumbering. */
  abstract readonly priority: number;
  abstract appliesTo(event: TaxableEvent, ctx: AssessmentContext): boolean;
  abstract compute(event: TaxableEvent, ctx: AssessmentContext): void;

  /** Emits a line carrying this rule's identity and the accumulated inputs. */
  protected emit(
    event: TaxableEvent,
    ctx: AssessmentContext,
    line: {
      label: string;
      tax?: Money;
      rate?: Percentage;
      inputs?: Record<string, string>;
      bucket?: TaxBucket;
      term?: GainTerm;
    },
  ): void {
    const acc = ctx.accumulator;
    acc.lines.push({
      eventId: event.id,
      rule: this.name,
      ruleVersion: ctx.regime.name,
      label: line.label,
      bucket: line.bucket ?? acc.bucket,
      term: line.term ?? acc.term,
      gain: acc.gain,
      taxableAmount: acc.taxable,
      rate: line.rate ?? acc.rate,
      tax: line.tax ?? Money.zero(acc.gain.currency),
      inputs: { ...acc.inputs, ...(line.inputs ?? {}) },
      derivedFrom: acc.lines.map((l) => l.rule),
    });
  }
}

/** Priority 100. PPF, EPF, SGB at maturity — exempt outright, not merely low-rated. */
export class ExemptRule extends TaxRule {
  readonly name = "IN.EXEMPT_SCHEME";
  readonly priority = 100;

  appliesTo(event: TaxableEvent): boolean {
    return event.taxCategory === "EXEMPT_SCHEME";
  }

  compute(event: TaxableEvent, ctx: AssessmentContext): void {
    const acc = ctx.accumulator;
    acc.exempt = true;
    acc.term = "EXEMPT";
    acc.bucket = "EXEMPT";
    acc.taxable = Money.zero(acc.gain.currency);
    acc.rate = Percentage.of("0");
    this.emit(event, ctx, {
      label: "Exempt scheme",
      inputs: { reason: "PPF/EPF/SGB-at-maturity are exempt under the Act" },
    });
  }
}

/**
 * Priority 200. The 2018 grandfathering step-up.
 *
 * `adjustedBasis = max(cost, min(fmv on 2018-01-31, proceeds))`. The inner `min`
 * is the limb people forget: the step-up is capped at the sale price, so a
 * grandfathered holding sold at a loss does not manufacture one.
 */
export class GrandfatheringRule extends TaxRule {
  readonly name = "IN.GRANDFATHERING_2018";
  readonly priority = 200;

  appliesTo(event: TaxableEvent, ctx: AssessmentContext): boolean {
    const grandfatherDate = ctx.regime.grandfatherDateFor(event.taxCategory);
    return (
      !ctx.accumulator.exempt &&
      grandfatherDate !== null &&
      event.acquiredOn !== null &&
      event.acquiredOn.isBefore(grandfatherDate) &&
      event.fmvOnGrandfatherDate !== null &&
      event.costBasis !== null &&
      event.proceeds !== null
    );
  }

  compute(event: TaxableEvent, ctx: AssessmentContext): void {
    const acc = ctx.accumulator;
    const cost = event.costBasis!;
    const fmv = event.fmvOnGrandfatherDate!;
    const proceeds = event.proceeds!;

    const cappedFmv = fmv.isLessThanOrEqual(proceeds) ? fmv : proceeds;
    const stepped = cost.isGreaterThanOrEqual(cappedFmv) ? cost : cappedFmv;

    acc.adjustedBasis = stepped;
    acc.taxable = proceeds.minus(stepped);
    acc.inputs.fmvOnGrandfatherDate = fmv.toDecimalString();
    acc.inputs.adjustedBasis = stepped.toDecimalString();
    acc.inputs.grandfatherDate = ctx.regime.grandfatherDateFor(event.taxCategory)!.toISO();

    this.emit(event, ctx, {
      label: "Cost stepped up to 31 Jan 2018 fair value",
      inputs: {
        cappedAtProceeds: fmv.isGreaterThan(proceeds) ? "yes" : "no",
      },
    });
  }
}

/**
 * Priority 300. Indexation, for the categories that still allow it.
 *
 * `indexedCost = cost × CII(sale FY) / CII(purchase FY)`, computed with
 * `timesRatio` so the ratio never passes through a float.
 */
export class IndexationRule extends TaxRule {
  readonly name = "IN.INDEXATION_CII";
  readonly priority = 300;

  appliesTo(event: TaxableEvent, ctx: AssessmentContext): boolean {
    if (ctx.accumulator.exempt) return false;
    if (!ctx.regime.indexationAllowedFor(event.taxCategory)) return false;
    if (!event.acquiredOn || !event.costBasis || !event.proceeds) return false;
    const longTermDays = ctx.regime.longTermDaysFor(event.taxCategory);
    return longTermDays !== null && (event.holdingDays ?? 0) > longTermDays;
  }

  compute(event: TaxableEvent, ctx: AssessmentContext): void {
    const acc = ctx.accumulator;
    const buyFy = FinancialYear.containing(event.acquiredOn!);
    const sellFy = FinancialYear.containing(event.onDate);
    const buyCii = ctx.regime.cii(buyFy);
    const sellCii = ctx.regime.cii(sellFy);

    if (buyCii === null || sellCii === null) {
      ctx.warnings.push(
        `No Cost Inflation Index for ${buyCii === null ? buyFy.label : sellFy.label}; indexation skipped for event ${event.id}.`,
      );
      return;
    }

    const cost = acc.adjustedBasis ?? event.costBasis!;
    const indexed = cost.timesRatio(BigInt(sellCii), BigInt(buyCii), ROUNDING.tax);
    acc.adjustedBasis = indexed;
    acc.taxable = event.proceeds!.minus(indexed);
    acc.inputs.ciiBuy = String(buyCii);
    acc.inputs.ciiSell = String(sellCii);
    acc.inputs.indexedCost = indexed.toDecimalString();

    this.emit(event, ctx, {
      label: `Cost indexed from ${buyFy.label} to ${sellFy.label}`,
    });
  }
}

/** Priority 400. Classification and the headline rate. */
export class CapitalGainClassificationRule extends TaxRule {
  readonly name = "IN.CLASSIFY_TERM";
  readonly priority = 400;

  appliesTo(event: TaxableEvent, ctx: AssessmentContext): boolean {
    // F&O never reaches here: a contract has no holding period to classify.
    return (
      !ctx.accumulator.exempt &&
      event.kind === "CAPITAL_GAIN" &&
      event.taxCategory !== "FNO_BUSINESS"
    );
  }

  compute(event: TaxableEvent, ctx: AssessmentContext): void {
    const acc = ctx.accumulator;
    const category = event.taxCategory;
    const longTermDays = ctx.regime.longTermDaysFor(category);
    const isEquity = category === "LISTED_EQUITY" || category === "EQUITY_MUTUAL_FUND";

    // A flat-rated category has no term at all — a VDA gain is 30% however long
    // it was held, which is why this is checked before the day count.
    if (ctx.regime.isFlatRated(category)) {
      acc.term = "SLAB";
      acc.bucket = "FLAT_VDA";
      acc.rate = ctx.regime.flatRateFor(category) ?? Percentage.of("0");
      acc.inputs.flatRated = "yes";
      this.emit(event, ctx, { label: "Flat-rated category (no holding-period benefit)" });
      return;
    }

    const isLongTerm = longTermDays !== null && (event.holdingDays ?? 0) > longTermDays;
    acc.term = isLongTerm ? "LONG_TERM" : "SHORT_TERM";
    acc.bucket = isLongTerm
      ? isEquity
        ? "LTCG_EQUITY"
        : "LTCG_OTHER"
      : isEquity
        ? "STCG_EQUITY"
        : "STCG_OTHER";

    const rate = isLongTerm
      ? ctx.regime.ltcgRateFor(category)
      : ctx.regime.stcgRateFor(category);

    // A null rate means "at slab", which is a different claim from a zero rate.
    if (rate === null) {
      acc.term = "SLAB";
      acc.rate = ctx.settings.slabRate;
      acc.inputs.atSlab = "yes";
    } else {
      acc.rate = rate;
    }

    acc.inputs.holdingDays = String(event.holdingDays ?? 0);
    acc.inputs.longTermThresholdDays = longTermDays === null ? "n/a" : String(longTermDays);

    this.emit(event, ctx, {
      label: isLongTerm ? "Long-term capital gain" : "Short-term capital gain",
    });
  }
}

/** Priority 500. Dividends and interest are slab income. */
export class SlabIncomeRule extends TaxRule {
  readonly name = "IN.SLAB_INCOME";
  readonly priority = 500;

  appliesTo(event: TaxableEvent, ctx: AssessmentContext): boolean {
    return (
      !ctx.accumulator.exempt &&
      (event.kind === "DIVIDEND" || event.kind === "INTEREST" || event.kind === "SLAB_INCOME")
    );
  }

  compute(event: TaxableEvent, ctx: AssessmentContext): void {
    const acc = ctx.accumulator;
    acc.term = "SLAB";
    acc.bucket = "SLAB";
    acc.rate = ctx.settings.slabRate;
    acc.inputs.slabPercent = ctx.settings.slabRate.toFixed(2);
    this.emit(event, ctx, {
      label: event.kind === "DIVIDEND" ? "Dividend income" : "Interest income",
    });
  }
}

/**
 * Priority 450. F&O is business income, not a capital gain.
 *
 * It sits between classification (400) and set-off (600) deliberately: it must
 * run after nothing — no grandfathering or indexation can apply to a contract
 * that never had a holding period — and before the loss ledger, which needs the
 * bucket to know that this loss may not touch a capital gain.
 *
 * The rate is the user's slab rate, so a screen that has no tax settings gets a
 * number computed at whatever slab it was told, with `slabPercent` in the
 * provenance saying which. There is no default marginal rate here, because
 * inventing one would be inventing the user's income.
 */
export class BusinessIncomeRule extends TaxRule {
  readonly name = "IN.FNO_BUSINESS_INCOME";
  readonly priority = 450;

  appliesTo(event: TaxableEvent, ctx: AssessmentContext): boolean {
    return (
      !ctx.accumulator.exempt &&
      (event.kind === "BUSINESS_INCOME" || event.taxCategory === "FNO_BUSINESS")
    );
  }

  compute(event: TaxableEvent, ctx: AssessmentContext): void {
    const acc = ctx.accumulator;
    acc.term = "SLAB";
    acc.bucket = "BUSINESS_NON_SPECULATIVE";
    acc.rate = ctx.settings.slabRate;
    acc.inputs.slabPercent = ctx.settings.slabRate.toFixed(2);
    acc.inputs.head = "Business income (non-speculative), §43(5)(d)";
    acc.inputs.holdingPeriodRelevant = "no";
    this.emit(event, ctx, {
      label: "Futures and options — non-speculative business income",
    });
  }
}

/**
 * Priority 600. Loss set-off, in statutory order.
 *
 * A negative gain becomes a carry-forward; a positive one draws on the ledger.
 */
export class LossOffsetRule extends TaxRule {
  readonly name = "IN.LOSS_SET_OFF";
  readonly priority = 600;

  appliesTo(event: TaxableEvent, ctx: AssessmentContext): boolean {
    return (
      !ctx.accumulator.exempt &&
      (event.kind === "CAPITAL_GAIN" || event.kind === "BUSINESS_INCOME")
    );
  }

  compute(event: TaxableEvent, ctx: AssessmentContext): void {
    const acc = ctx.accumulator;

    if (acc.taxable.isNegative) {
      // A VDA loss is not carried forward at all — that is what "no set-off"
      // means, and it is the one place a loss simply vanishes.
      if (acc.bucket === "FLAT_VDA") {
        acc.taxable = Money.zero(acc.gain.currency);
        this.emit(event, ctx, {
          label: "VDA loss — not available for set-off or carry-forward",
          inputs: { lossAbsorbed: "none" },
        });
        return;
      }
      ctx.losses.add(acc.bucket, ctx.financialYear.label, acc.taxable);
      const carried = acc.taxable.abs();
      acc.taxable = Money.zero(acc.gain.currency);
      this.emit(event, ctx, {
        label: "Loss carried forward",
        inputs: { lossCarried: carried.toDecimalString() },
      });
      return;
    }

    const { remaining, used } = ctx.losses.offset(acc.bucket, acc.taxable);
    if (used.length === 0) return;
    acc.taxable = remaining;
    for (const entry of used) {
      this.emit(event, ctx, {
        label: `Set off against ${entry.fy} loss`,
        inputs: { lossUsed: entry.amount.toDecimalString(), lossYear: entry.fy },
      });
    }
  }
}

/**
 * Priority 650. The ₹1.25 lakh long-term equity exemption.
 *
 * Consumption-tracked and shared across every disposal in the year, which is why
 * the engine's event ordering is deterministic — two disposals competing for one
 * exemption must resolve the same way on every run.
 */
export class LtcgExemptionRule extends TaxRule {
  readonly name = "IN.LTCG_EXEMPTION";
  readonly priority = 650;

  appliesTo(event: TaxableEvent, ctx: AssessmentContext): boolean {
    return (
      !ctx.accumulator.exempt &&
      ctx.accumulator.bucket === "LTCG_EQUITY" &&
      ctx.accumulator.taxable.isPositive
    );
  }

  compute(event: TaxableEvent, ctx: AssessmentContext): void {
    const acc = ctx.accumulator;
    const before = ctx.exemption.remaining("LTCG_EQUITY", acc.taxable);
    if (before.isZero) return;

    const consumed = ctx.exemption.consume("LTCG_EQUITY", acc.taxable);
    acc.taxable = acc.taxable.minus(consumed);
    acc.inputs.exemptionBefore = before.toDecimalString();
    acc.inputs.exemptionConsumed = consumed.toDecimalString();
    acc.inputs.exemptionRemainingAfter = ctx.exemption
      .remaining("LTCG_EQUITY", acc.taxable)
      .toDecimalString();

    this.emit(event, ctx, { label: "Long-term equity exemption applied" });
  }
}

/** Priority 900. The rate finally meets the taxable amount. */
export class ApplyRateRule extends TaxRule {
  readonly name = "IN.APPLY_RATE";
  readonly priority = 900;

  appliesTo(_event: TaxableEvent, ctx: AssessmentContext): boolean {
    return !ctx.accumulator.exempt;
  }

  compute(event: TaxableEvent, ctx: AssessmentContext): void {
    const acc = ctx.accumulator;
    const tax = acc.taxable.isPositive
      ? acc.rate.applyTo(acc.taxable, ROUNDING.tax)
      : Money.zero(acc.gain.currency);
    acc.inputs.rate = acc.rate.toFixed(2);
    this.emit(event, ctx, { label: "Tax at the applicable rate", tax });
  }
}

/* ═══ Regimes ════════════════════════════════════════════════════════════ */

export interface CategoryRule {
  readonly longTermDays: number | null;
  readonly ltcgRate: Percentage | null;
  readonly stcgRate: Percentage | null;
  readonly indexationAllowed: boolean;
  readonly grandfatherDate: CalendarDate | null;
  readonly exemptionLimit: Money | null;
  readonly flatRate: Percentage | null;
}

export class NoRegimeError extends DomainError {
  constructor(date: CalendarDate) {
    super(
      "NO_TAX_REGIME",
      `No tax regime is in force on ${date.toISO()}. A gap or an overlap in the ` +
        "regime table is a bug, not a default to fall back on.",
    );
  }
}

/**
 * A tax regime, frozen once shipped.
 *
 * The rates live as constants in the subclass so that re-running last year's
 * report after a budget produces the identical number. `tax_rules` mirrors them
 * for SQL reporting, and `seeds.spec.ts` asserts the mirror matches — two sources
 * of truth that can disagree eventually do.
 */
export abstract class TaxRegime {
  abstract readonly name: string;
  abstract readonly effectiveFrom: CalendarDate;
  abstract readonly effectiveTo: CalendarDate | null;
  protected abstract readonly categories: ReadonlyMap<TaxCategory, CategoryRule>;
  /** Surcharge bands, as (threshold, rate) ascending. */
  protected abstract readonly surchargeBands: readonly { above: Money; rate: Percentage }[];
  abstract cii(financialYear: FinancialYear): number | null;

  covers(date: CalendarDate): boolean {
    return (
      date.isOnOrAfter(this.effectiveFrom) &&
      (this.effectiveTo === null || date.isOnOrBefore(this.effectiveTo))
    );
  }

  private ruleFor(category: TaxCategory): CategoryRule | null {
    return this.categories.get(category) ?? null;
  }

  longTermDaysFor(category: TaxCategory): number | null {
    return this.ruleFor(category)?.longTermDays ?? null;
  }

  ltcgRateFor(category: TaxCategory): Percentage | null {
    return this.ruleFor(category)?.ltcgRate ?? null;
  }

  stcgRateFor(category: TaxCategory): Percentage | null {
    return this.ruleFor(category)?.stcgRate ?? null;
  }

  indexationAllowedFor(category: TaxCategory): boolean {
    return this.ruleFor(category)?.indexationAllowed ?? false;
  }

  grandfatherDateFor(category: TaxCategory): CalendarDate | null {
    return this.ruleFor(category)?.grandfatherDate ?? null;
  }

  exemptionLimitFor(category: TaxCategory): Money | null {
    return this.ruleFor(category)?.exemptionLimit ?? null;
  }

  isFlatRated(category: TaxCategory): boolean {
    return this.ruleFor(category)?.flatRate !== null && this.ruleFor(category)?.flatRate !== undefined;
  }

  flatRateFor(category: TaxCategory): Percentage | null {
    return this.ruleFor(category)?.flatRate ?? null;
  }

  /** The exemption limits, as the ledger wants them. */
  exemptionLimits(): ReadonlyMap<TaxBucket, Money> {
    const limits = new Map<TaxBucket, Money>();
    const equity = this.exemptionLimitFor("LISTED_EQUITY");
    if (equity) limits.set("LTCG_EQUITY", equity);
    return limits;
  }

  /** Surcharge on the tax, banded on total income; capped at 15% for capital gains. */
  surchargeOn(tax: Money, totalIncome: Money): { amount: Money; rate: Percentage } {
    let applicable = Percentage.of("0");
    for (const band of this.surchargeBands) {
      if (totalIncome.isGreaterThan(band.above)) applicable = band.rate;
    }
    return { amount: applicable.applyTo(tax, ROUNDING.tax), rate: applicable };
  }

  /** Health and education cess, on tax plus surcharge. */
  cessOn(taxPlusSurcharge: Money): { amount: Money; rate: Percentage } {
    const rate = Percentage.of("4");
    return { amount: rate.applyTo(taxPlusSurcharge, ROUNDING.tax), rate };
  }

  /** Ascending priority. The chain, not a first match. */
  rules(): readonly TaxRule[] {
    return [
      new ExemptRule(),
      new GrandfatheringRule(),
      new IndexationRule(),
      new CapitalGainClassificationRule(),
      new BusinessIncomeRule(),
      new SlabIncomeRule(),
      new LossOffsetRule(),
      new LtcgExemptionRule(),
      new ApplyRateRule(),
    ].sort((a, b) => a.priority - b.priority);
  }
}

const PERCENT = (value: string) => Percentage.of(value);
const RUPEES = (value: string) => Money.fromRupees(value);

/** CBDT-notified Cost Inflation Index, base 2001-02 = 100. */
const CII: Readonly<Record<string, number>> = {
  "2001-02": 100, "2002-03": 105, "2003-04": 109, "2004-05": 113, "2005-06": 117,
  "2006-07": 122, "2007-08": 129, "2008-09": 137, "2009-10": 148, "2010-11": 167,
  "2011-12": 184, "2012-13": 200, "2013-14": 220, "2014-15": 240, "2015-16": 254,
  "2016-17": 264, "2017-18": 272, "2018-19": 280, "2019-20": 289, "2020-21": 301,
  "2021-22": 317, "2022-23": 331, "2023-24": 348, "2024-25": 363, "2025-26": 376,
};

const SURCHARGE_BANDS = [
  { above: RUPEES("5000000"), rate: PERCENT("10") },
  { above: RUPEES("10000000"), rate: PERCENT("15") },
] as const;

/**
 * Disposals up to 22 July 2024.
 *
 * `30-CALCULATIONS.md` §6's table and Phase 1c's item quote different equity
 * rates. They are not in conflict — they are two vintages, and this is the older
 * one. Keeping both is the whole point of versioned regimes.
 */
export class IndiaFY2024 extends TaxRegime {
  readonly name = "IN-FY2024";
  readonly effectiveFrom = CalendarDate.parse("2018-04-01");
  readonly effectiveTo = CalendarDate.parse("2024-07-22");

  protected readonly surchargeBands = SURCHARGE_BANDS;

  protected readonly categories: ReadonlyMap<TaxCategory, CategoryRule> = new Map([
    ["LISTED_EQUITY", {
      longTermDays: 365,
      ltcgRate: PERCENT("10"),
      stcgRate: PERCENT("15"),
      indexationAllowed: false,
      grandfatherDate: CalendarDate.parse("2018-02-01"),
      exemptionLimit: RUPEES("100000"),
      flatRate: null,
    }],
    ["EQUITY_MUTUAL_FUND", {
      longTermDays: 365,
      ltcgRate: PERCENT("10"),
      stcgRate: PERCENT("15"),
      indexationAllowed: false,
      grandfatherDate: CalendarDate.parse("2018-02-01"),
      exemptionLimit: RUPEES("100000"),
      flatRate: null,
    }],
    ["DEBT_LEGACY", {
      longTermDays: 1095,
      ltcgRate: PERCENT("20"),
      stcgRate: null,
      indexationAllowed: true,
      grandfatherDate: null,
      exemptionLimit: null,
      flatRate: null,
    }],
    ["UNLISTED_EQUITY", {
      longTermDays: 730,
      ltcgRate: PERCENT("20"),
      stcgRate: null,
      indexationAllowed: true,
      grandfatherDate: null,
      exemptionLimit: null,
      flatRate: null,
    }],
    ["VDA", {
      longTermDays: null,
      ltcgRate: PERCENT("30"),
      stcgRate: PERCENT("30"),
      indexationAllowed: false,
      grandfatherDate: null,
      exemptionLimit: null,
      flatRate: PERCENT("30"),
    }],
    /*
     * F&O: at slab, with no long-term line and nothing to index.
     *
     * Every field is null or false on purpose. A `longTermDays` here would
     * invent a holding-period benefit the statute does not give, and a
     * `flatRate` would make it a VDA — which is the other thing F&O is not.
     */
    ["FNO_BUSINESS", {
      longTermDays: null,
      ltcgRate: null,
      stcgRate: null,
      indexationAllowed: false,
      grandfatherDate: null,
      exemptionLimit: null,
      flatRate: null,
    }],
    ["EXEMPT_SCHEME", {
      longTermDays: null,
      ltcgRate: PERCENT("0"),
      stcgRate: PERCENT("0"),
      indexationAllowed: false,
      grandfatherDate: null,
      exemptionLimit: null,
      flatRate: null,
    }],
  ]);

  cii(financialYear: FinancialYear): number | null {
    return CII[financialYear.label] ?? null;
  }
}

/** Disposals from 23 July 2024. */
export class IndiaFY2025 extends TaxRegime {
  readonly name = "IN-FY2025";
  readonly effectiveFrom = CalendarDate.parse("2024-07-23");
  readonly effectiveTo = null;

  protected readonly surchargeBands = SURCHARGE_BANDS;

  protected readonly categories: ReadonlyMap<TaxCategory, CategoryRule> = new Map([
    ["LISTED_EQUITY", {
      longTermDays: 365,
      ltcgRate: PERCENT("12.5"),
      stcgRate: PERCENT("20"),
      indexationAllowed: false,
      grandfatherDate: CalendarDate.parse("2018-02-01"),
      exemptionLimit: RUPEES("125000"),
      flatRate: null,
    }],
    ["EQUITY_MUTUAL_FUND", {
      longTermDays: 365,
      ltcgRate: PERCENT("12.5"),
      stcgRate: PERCENT("20"),
      indexationAllowed: false,
      grandfatherDate: CalendarDate.parse("2018-02-01"),
      exemptionLimit: RUPEES("125000"),
      flatRate: null,
    }],
    // Acquired on or after 2023-04-01: slab always, no long-term rate and no
    // indexation. A null stcgRate means slab, which is not a zero rate.
    ["DEBT", {
      longTermDays: null,
      ltcgRate: null,
      stcgRate: null,
      indexationAllowed: false,
      grandfatherDate: null,
      exemptionLimit: null,
      flatRate: null,
    }],
    ["DEBT_LEGACY", {
      longTermDays: 1095,
      ltcgRate: PERCENT("20"),
      stcgRate: null,
      indexationAllowed: true,
      grandfatherDate: null,
      exemptionLimit: null,
      flatRate: null,
    }],
    ["GOLD", {
      longTermDays: 730,
      ltcgRate: PERCENT("12.5"),
      stcgRate: null,
      indexationAllowed: false,
      grandfatherDate: null,
      exemptionLimit: null,
      flatRate: null,
    }],
    ["UNLISTED_EQUITY", {
      longTermDays: 730,
      ltcgRate: PERCENT("12.5"),
      stcgRate: null,
      indexationAllowed: false,
      grandfatherDate: null,
      exemptionLimit: null,
      flatRate: null,
    }],
    ["VDA", {
      longTermDays: null,
      ltcgRate: PERCENT("30"),
      stcgRate: PERCENT("30"),
      indexationAllowed: false,
      grandfatherDate: null,
      exemptionLimit: null,
      flatRate: PERCENT("30"),
    }],
    /*
     * F&O: at slab, with no long-term line and nothing to index.
     *
     * Every field is null or false on purpose. A `longTermDays` here would
     * invent a holding-period benefit the statute does not give, and a
     * `flatRate` would make it a VDA — which is the other thing F&O is not.
     */
    ["FNO_BUSINESS", {
      longTermDays: null,
      ltcgRate: null,
      stcgRate: null,
      indexationAllowed: false,
      grandfatherDate: null,
      exemptionLimit: null,
      flatRate: null,
    }],
    ["EXEMPT_SCHEME", {
      longTermDays: null,
      ltcgRate: PERCENT("0"),
      stcgRate: PERCENT("0"),
      indexationAllowed: false,
      grandfatherDate: null,
      exemptionLimit: null,
      flatRate: null,
    }],
  ]);

  cii(financialYear: FinancialYear): number | null {
    return CII[financialYear.label] ?? null;
  }
}

/**
 * Picks the regime in force, newest first.
 *
 * Throws on a gap rather than defaulting: a disposal we cannot price under any
 * shipped law is a bug in the regime table, and guessing produces a number
 * nobody can defend.
 */
export class RegimeRegistry {
  constructor(private readonly regimes: readonly TaxRegime[] = [new IndiaFY2025(), new IndiaFY2024()]) {}

  forDate(date: CalendarDate): TaxRegime {
    const found = [...this.regimes]
      .sort((a, b) => (a.effectiveFrom.isBefore(b.effectiveFrom) ? 1 : -1))
      .find((r) => r.covers(date));
    if (!found) throw new NoRegimeError(date);
    return found;
  }
}

/* ═══ Stored settings ═════════════════════════════════════════════════ */

/**
 * A year's tax settings, as stored.
 *
 * `TaxSettings` is what a rule chain needs; this is what a *year* holds — the
 * same three circumstances plus the regime key and the year they apply to. They
 * are separate types on purpose: an assessment is run with one set of
 * circumstances, and which year's row supplied them is the repository's business.
 */
export interface StoredTaxSettings {
  readonly financialYear: string;
  readonly regimeKey: string;
  readonly marginalSlabRate: Percentage;
  readonly ltcgExemption: Money;
  readonly usesNewRegime: boolean;
  readonly totalIncome: Money;
  readonly residentStatus: "RESIDENT" | "NON_RESIDENT";
}

export interface TaxSettingsRepository {
  /** The row for a year, or `null` — never a default: a guessed slab rate is a wrong tax figure. */
  findFor(userId: UserId, financialYear: FinancialYear): Promise<StoredTaxSettings | null>;
  save(userId: UserId, settings: StoredTaxSettings): Promise<void>;
}

/* ═══ The engine ═════════════════════════════════════════════════════════ */

export class TaxEngine {
  constructor(private readonly registry: RegimeRegistry = new RegimeRegistry()) {}

  /**
   * Assesses a financial year.
   *
   * Events are sorted before running, and the ordering is part of the contract:
   * the exemption and the loss ledger are finite resources shared across
   * disposals, so two events competing for one exemption must resolve the same
   * way on every run or the report is not reproducible.
   */
  assess(
    financialYear: FinancialYear,
    events: readonly TaxableEvent[],
    settings: TaxSettings,
    options: { broughtForwardLosses?: readonly CarryForward[] } = {},
  ): TaxAssessment {
    const currency = events[0]?.gain ?? Money.zero();
    const ordered = [...events].sort((a, b) => {
      const byDate = a.onDate.compareTo(b.onDate);
      if (byDate !== 0) return byDate;
      const byInstrument = (a.instrumentId ?? "").localeCompare(b.instrumentId ?? "");
      if (byInstrument !== 0) return byInstrument;
      return (a.sourceLotId ?? a.id).localeCompare(b.sourceLotId ?? b.id);
    });

    const regime = this.registry.forDate(
      ordered[0]?.onDate ?? financialYear.range.end,
    );
    const exemption = new ExemptionLedger(regime.exemptionLimits());
    const losses = new LossLedger();
    const warnings: string[] = [];

    for (const carried of options.broughtForwardLosses ?? []) {
      losses.add(carried.bucket, carried.financialYear, carried.amount);
    }
    for (const lapsed of losses.expire(financialYear.label)) {
      warnings.push(
        `A ${lapsed.bucket} loss of ${Money.fromMinor(lapsed.amount, currency.currency).toDecimalString()} ` +
          `from ${lapsed.fy} lapsed after eight assessment years.`,
      );
    }

    const lines: TaxLine[] = [];

    for (const event of ordered) {
      // Each event gets its own regime, so one assessment can span a budget change.
      const eventRegime = this.registry.forDate(event.onDate);
      const accumulator: EventAccumulator = {
        gain: event.gain,
        adjustedBasis: null,
        taxable: event.gain,
        term: "SHORT_TERM",
        bucket: "STCG_OTHER",
        rate: Percentage.of("0"),
        exempt: false,
        inputs: {
          proceeds: event.proceeds?.toDecimalString() ?? "n/a",
          cost: event.costBasis?.toDecimalString() ?? "n/a",
          gain: event.gain.toDecimalString(),
          deductibleCharges: event.deductibleCharges.toDecimalString(),
        },
        lines: [],
      };
      const ctx: AssessmentContext = {
        regime: eventRegime,
        settings,
        exemption,
        losses,
        financialYear,
        accumulator,
        warnings,
      };

      for (const rule of eventRegime.rules()) {
        if (rule.appliesTo(event, ctx)) rule.compute(event, ctx);
        if (accumulator.exempt && rule.priority > 100) break;
      }
      lines.push(...accumulator.lines);
    }

    // Totals by bucket, from the rate-application lines only — every other line
    // is an adjustment, and summing them all would double-count.
    const totals: Record<string, { gain: Money; taxable: Money; tax: Money }> = {};
    let taxBeforeSurcharge = Money.zero(currency.currency);
    for (const line of lines.filter((l) => l.rule === "IN.APPLY_RATE")) {
      const bucket = (totals[line.bucket] ??= {
        gain: Money.zero(currency.currency),
        taxable: Money.zero(currency.currency),
        tax: Money.zero(currency.currency),
      });
      totals[line.bucket] = {
        gain: bucket.gain.plus(line.gain),
        taxable: bucket.taxable.plus(line.taxableAmount),
        tax: bucket.tax.plus(line.tax),
      };
      taxBeforeSurcharge = taxBeforeSurcharge.plus(line.tax);
    }

    const surcharge = regime.surchargeOn(taxBeforeSurcharge, settings.totalIncome);
    const cess = regime.cessOn(taxBeforeSurcharge.plus(surcharge.amount));

    return {
      financialYear: financialYear.label,
      regime: regime.name,
      lines,
      totals,
      surcharge: surcharge.amount,
      cess: cess.amount,
      totalTax: taxBeforeSurcharge.plus(surcharge.amount).plus(cess.amount),
      exemptionUsed: Money.fromMinor(exemption.totalConsumed, currency.currency),
      lossesCarriedForward: losses.outstanding(currency),
      warnings,
    };
  }
}
