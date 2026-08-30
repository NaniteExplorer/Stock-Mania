/**
 * What the portfolio has actually made, and where it made it.
 *
 * Every figure here already existed in `lot_matches` — the realised gain, the
 * holding period, the tax tier and the financial year are all stored at the
 * moment of sale, precisely so a later change to the long-term threshold cannot
 * rewrite last year's tax. What did not exist was any way to read them except
 * one financial year at a time, in one flat list.
 *
 * So this is a grouping, not a calculation. It adds no number the database did
 * not already hold, which is the property that matters: a "profit since
 * inception" that is derived twice will eventually be two different profits, and
 * the one on the dashboard will be the one the user quotes.
 *
 * Three questions it answers that `RealisedGains` cannot:
 *
 *   - **Which category made it.** Realised gain by asset group, so "how has my
 *     gold done" is one number rather than a mental sum over four holdings.
 *   - **Which platform made it.** The same question sideways, and the one Phase
 *     9f asked for: per-broker profit and loss.
 *   - **How it splits for tax.** Short-term against long-term, per year, because
 *     they are taxed at different rates and the split is what goes on a return.
 *
 * Unrealised gains are deliberately absent. They belong to `ValuePortfolio`,
 * which knows about prices and staleness and can say "unknown"; realised gains
 * are settled history and need no price at all. Mixing them here would mean this
 * screen went blank whenever a feed was down.
 */

import { AppError, Ok, Result, UseCase, UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { CalendarDate, FinancialYear } from "@/core/time";
import { AssetGroup, groupOf, groupLabel } from "@/domain/asset-groups";
import { InstitutionRepository } from "@/domain/institutions";
import { InstrumentRepository } from "@/domain/instruments";
import { Disposal, LotRepository } from "@/domain/lots";

/** The earliest date worth scanning. Before any Indian retail portfolio existed. */
const BEGINNING = CalendarDate.parse("1970-01-01");

export interface RealisedHistoryInput {
  userId: UserId;
  /** Bounds the scan. Omitted, everything ever sold. */
  financialYear?: FinancialYear;
  asOf: CalendarDate;
}

/** One row of a breakdown, whatever it is broken down by. */
export interface RealisedBucket {
  readonly key: string;
  readonly label: string;
  readonly disposals: number;
  readonly proceeds: Money;
  readonly costBasis: Money;
  readonly charges: Money;
  readonly shortTerm: Money;
  readonly longTerm: Money;
  readonly total: Money;
}

export interface RealisedHistoryOutput {
  readonly years: readonly RealisedBucket[];
  readonly groups: readonly RealisedBucket[];
  readonly platforms: readonly RealisedBucket[];
  readonly instruments: readonly RealisedBucket[];
  readonly total: RealisedBucket;
  /**
   * Disposals whose instrument could not be found.
   *
   * Named rather than dropped or bundled into an "Other" row. A gain the app
   * cannot attribute is still a gain the user owes tax on, and quietly leaving it
   * out of every breakdown while it sat in the total is how two screens end up
   * disagreeing about the same year.
   */
  readonly unattributed: number;
}

export class RealisedGainsHistory
  implements UseCase<RealisedHistoryInput, RealisedHistoryOutput>
{
  constructor(
    private readonly lots: LotRepository,
    private readonly instruments: InstrumentRepository,
    private readonly institutions: InstitutionRepository,
  ) {}

  async execute(input: RealisedHistoryInput): Promise<Result<RealisedHistoryOutput, AppError>> {
    const from = input.financialYear?.start ?? BEGINNING;
    const to = input.financialYear?.end ?? input.asOf;

    const [disposals, instruments, platforms] = await Promise.all([
      this.lots.disposalsWithin(input.userId, from, to),
      // Closed holdings included: a position you have exited is exactly the one
      // whose realised gain you want to look back at.
      this.instruments.list(input.userId, { includeClosed: true }),
      this.institutions.list(input.userId, { includeArchived: true }),
    ]);

    const byId = new Map(instruments.map((instrument) => [instrument.id.value, instrument]));
    const platformNames = new Map(
      platforms.map((platform) => [platform.id.value, platform.name]),
    );

    const years = new Accumulator();
    const groups = new Accumulator();
    const byPlatform = new Accumulator();
    const byInstrument = new Accumulator();
    const total = new Bucket("all", "Everything");
    let unattributed = 0;

    for (const disposal of disposals) {
      total.add(disposal);
      years.add(
        FinancialYear.containing(disposal.disposedOn).label,
        FinancialYear.containing(disposal.disposedOn).label,
        disposal,
      );

      const instrument = byId.get(disposal.instrumentId.value);
      if (!instrument) {
        unattributed += 1;
        continue;
      }

      const group: AssetGroup = groupOf(instrument);
      groups.add(group, groupLabel(group), disposal);
      byInstrument.add(
        instrument.id.value,
        `${instrument.symbol} — ${instrument.name}`,
        disposal,
      );

      const platformId = instrument.institutionId?.value;
      byPlatform.add(
        platformId ?? UNASSIGNED,
        platformId ? (platformNames.get(platformId) ?? "Unknown platform") : "Unassigned",
        disposal,
      );
    }

    return Ok({
      // Years ascending, everything else by what made the most — a breakdown is
      // read for its top row.
      years: years.rows((a, b) => a.key.localeCompare(b.key)),
      groups: groups.rows(byTotalDescending),
      platforms: byPlatform.rows(byTotalDescending),
      instruments: byInstrument.rows(byTotalDescending),
      total: total.snapshot(),
      unattributed,
    });
  }
}

/** The bucket for disposals of a holding with no platform recorded. */
export const UNASSIGNED = "__unassigned__";

const byTotalDescending = (a: RealisedBucket, b: RealisedBucket) =>
  Number(b.total.minor - a.total.minor);

/**
 * One running total.
 *
 * Short and long term are accumulated from the **stored** holding period rather
 * than recomputed from the dates, because the tier was fixed at the moment of
 * sale — a budget that moves the long-term line must not restate a gain that has
 * already been filed.
 */
class Bucket {
  private count = 0;
  private proceeds = Money.zero();
  private costBasis = Money.zero();
  private charges = Money.zero();
  private shortTerm = Money.zero();
  private longTerm = Money.zero();

  constructor(
    readonly key: string,
    readonly label: string,
  ) {}

  add(disposal: Disposal): void {
    this.count += 1;
    this.proceeds = this.proceeds.plus(disposal.proceeds);
    this.costBasis = this.costBasis.plus(disposal.costBasis);
    this.charges = this.charges.plus(disposal.buyCharges).plus(disposal.sellCharges);
    if (disposal.holdingDays >= 365) {
      this.longTerm = this.longTerm.plus(disposal.gain);
    } else {
      this.shortTerm = this.shortTerm.plus(disposal.gain);
    }
  }

  snapshot(): RealisedBucket {
    return {
      key: this.key,
      label: this.label,
      disposals: this.count,
      proceeds: this.proceeds,
      costBasis: this.costBasis,
      charges: this.charges,
      shortTerm: this.shortTerm,
      longTerm: this.longTerm,
      total: this.shortTerm.plus(this.longTerm),
    };
  }
}

class Accumulator {
  private readonly buckets = new Map<string, Bucket>();

  add(key: string, label: string, disposal: Disposal): void {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new Bucket(key, label);
      this.buckets.set(key, bucket);
    }
    bucket.add(disposal);
  }

  rows(order: (a: RealisedBucket, b: RealisedBucket) => number): readonly RealisedBucket[] {
    return [...this.buckets.values()].map((bucket) => bucket.snapshot()).sort(order);
  }
}

/** Every financial year that has a disposal in it, newest first. */
export function financialYearsWithActivity(
  history: RealisedHistoryOutput,
): readonly FinancialYear[] {
  return history.years
    .map((row) => FinancialYear.parse(row.key))
    .sort((a, b) => b.label.localeCompare(a.label));
}
