/**
 * Persisting the projection's AssumptionSet and the owner's date of birth.
 *
 * The domain set (`src/domain/projection/assumptions.ts`) is consumed as is: a
 * stored set is rebuilt from `AssumptionSet.initial()` through `with()`, so every
 * range and age-ordering check runs again on load. Null is unknown and is stored
 * as null; nothing here invents a value. The current age is never typed — it is
 * derived from the date of birth when one is given, and stays unknown otherwise.
 */
import { Err, Ok, ValidationError, type Clock, type Result, type UseCase, type UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Count, Ratio, Years } from "@/core/units";
import {
  AssumptionSet,
  type AssumptionKey,
  type AssumptionSource,
  type AssumptionValues,
} from "@/domain/projection/assumptions";

/** One stored assumption, in its serialised form. */
export interface StoredAssumption {
  readonly key: AssumptionKey;
  /** The value as JSON, or null for unknown. */
  readonly stated: string | null;
  /** The AssumptionSource as JSON, or null when the value is unknown. */
  readonly source: string | null;
  readonly verifiedOn: string | null;
}

/** Port: the user's stored assumption rows. Every call is scoped to one user. */
export interface ProjectionAssumptionStore {
  load(userId: UserId): Promise<readonly StoredAssumption[]>;
  /** Replaces the live row of each key given; other keys are untouched. */
  save(userId: UserId, rows: readonly StoredAssumption[]): Promise<void>;
}

/** Port: the owner's profile facts. */
export interface OwnerProfileStore {
  bornOn(userId: UserId): Promise<CalendarDate | null>;
  setBornOn(userId: UserId, bornOn: CalendarDate | null): Promise<void>;
}

export const ASSUMPTION_KEYS: readonly AssumptionKey[] = Object.freeze([
  "currentAge",
  "retirementAge",
  "horizonAge",
  "inflation",
  "withdrawalRate",
  "monthlyContribution",
  "equityShare",
  "blockYears",
  "npsAnnuityShareNonGovt",
  "npsAnnuityShareGovt",
]);

const AGE_SOURCE: AssumptionSource = Object.freeze({ kind: "OWN_HISTORY", method: "Whole years since the date of birth you gave in Settings" });

/* ── Codec ─────────────────────────────────────────────────────────────── */

export function encodeValue<K extends AssumptionKey>(key: K, value: AssumptionValues[K] | null): string | null {
  if (value === null) return null;
  if (key === "monthlyContribution") return JSON.stringify((value as Money).toJSON());
  return JSON.stringify(value as number);
}

export function decodeValue<K extends AssumptionKey>(key: K, stated: string | null): AssumptionValues[K] | null {
  if (stated === null) return null;
  const parsed: unknown = JSON.parse(stated);
  switch (key) {
    case "monthlyContribution": {
      const money = parsed as { minor: string; currency: string };
      return Money.fromMinor(BigInt(money.minor), Currency.of(money.currency)) as AssumptionValues[K];
    }
    case "currentAge":
    case "retirementAge":
    case "horizonAge":
      return Years(parsed as number) as AssumptionValues[K];
    case "blockYears":
      return Count(parsed as number) as AssumptionValues[K];
    default:
      return Ratio(parsed as number) as AssumptionValues[K];
  }
}

/** Whole years from `bornOn` to `today`, or null when the date is in the future. */
export function ageOn(bornOn: CalendarDate, today: CalendarDate): number | null {
  if (bornOn.isAfter(today)) return null;
  let age = today.year - bornOn.year;
  if (today.month < bornOn.month || (today.month === bornOn.month && today.day < bornOn.day)) age -= 1;
  return age;
}

/**
 * Rebuilds the set: initial(), then the age derived from the date of birth, then
 * each stored row through with(). A stored row that no longer fits (for example a
 * retirement age the derived current age has passed) is left unknown
 * and reported, so the refusal gate names it instead of a guess filling in.
 */
export function hydrate(
  rows: readonly StoredAssumption[],
  bornOn: CalendarDate | null,
  today: CalendarDate,
): { readonly assumptions: AssumptionSet; readonly dropped: readonly string[] } {
  let set = AssumptionSet.initial();
  const dropped: string[] = [];
  const age = bornOn === null ? null : ageOn(bornOn, today);
  if (age !== null) {
    try { set = set.with("currentAge", Years(age), AGE_SOURCE); }
    catch (error) { dropped.push(`${set.get("currentAge").label}: ${(error as Error).message}`); }
  }

  // Ages in increasing order so a valid stored trio always re-applies cleanly.
  const ordered = [...rows]
    .filter((row) => row.key !== "currentAge")
    .sort((a, b) => ASSUMPTION_KEYS.indexOf(a.key) - ASSUMPTION_KEYS.indexOf(b.key));
  for (const row of ordered) {
    try {
      const value = decodeValue(row.key, row.stated);
      const source = row.source === null ? undefined : (JSON.parse(row.source) as AssumptionSource);
      const verifiedOn = row.verifiedOn === null ? null : CalendarDate.parse(row.verifiedOn);
      set = set.with(row.key, value as never, source, verifiedOn);
    } catch (error) {
      set = set.with(row.key, null);
      dropped.push(`${set.get(row.key).label}: ${(error as Error).message}`);
    }
  }
  return Object.freeze({ assumptions: set, dropped: Object.freeze(dropped) });
}

/* ── Use cases ─────────────────────────────────────────────────────────── */

export interface LoadedAssumptions {
  readonly assumptions: AssumptionSet;
  /** True when the owner has saved at least one assumption. */
  readonly saved: boolean;
  readonly bornOn: CalendarDate | null;
  /** Stored values that no longer fit, by label, with the reason. */
  readonly dropped: readonly string[];
}

export class LoadProjectionAssumptions implements UseCase<{ userId: UserId }, LoadedAssumptions> {
  constructor(
    private readonly store: ProjectionAssumptionStore,
    private readonly profiles: OwnerProfileStore,
    private readonly clock: Clock,
  ) {}

  async execute(input: { userId: UserId }): Promise<Result<LoadedAssumptions>> {
    const [rows, bornOn] = await Promise.all([this.store.load(input.userId), this.profiles.bornOn(input.userId)]);
    const { assumptions, dropped } = hydrate(rows, bornOn, CalendarDate.parse(this.clock.today()));
    return Ok(Object.freeze({ assumptions, saved: rows.length > 0, bornOn, dropped }));
  }
}

/** One edit: a key, its new value (null clears it), and for regulatory keys a verification date. */
export interface AssumptionChange<K extends AssumptionKey = AssumptionKey> {
  readonly key: K;
  readonly value: AssumptionValues[K] | null;
  readonly verifiedOn?: CalendarDate | null;
}

const AGE_KEYS: readonly AssumptionKey[] = ["retirementAge", "horizonAge"];

export class SaveProjectionAssumptions implements UseCase<{ userId: UserId; changes: readonly AssumptionChange[] }, LoadedAssumptions> {
  constructor(
    private readonly store: ProjectionAssumptionStore,
    private readonly profiles: OwnerProfileStore,
    private readonly clock: Clock,
  ) {}

  async execute(input: { userId: UserId; changes: readonly AssumptionChange[] }): Promise<Result<LoadedAssumptions>> {
    if (input.changes.some((c) => c.key === "currentAge")) {
      return Err(new ValidationError("The current age comes from your date of birth in Settings, not from this form."));
    }
    const today = CalendarDate.parse(this.clock.today());
    const [rows, bornOn] = await Promise.all([this.store.load(input.userId), this.profiles.bornOn(input.userId)]);
    let set = hydrate(rows, bornOn, today).assumptions;

    try {
      // Clear the changed ages first, then set them in increasing order, so raising
      // retirement and plan-to ages together is not refused halfway.
      for (const change of input.changes) if (AGE_KEYS.includes(change.key)) set = set.with(change.key, null);
      const ordered = [...input.changes].sort((a, b) => ASSUMPTION_KEYS.indexOf(a.key) - ASSUMPTION_KEYS.indexOf(b.key));
      const stored: StoredAssumption[] = [];
      for (const change of ordered) {
        const current = set.get(change.key);
        const unchanged =
          change.value !== null && current.value !== null && encodeValue(change.key, current.value) === encodeValue(change.key, change.value);
        // Re-stating a cited value keeps its citation; anything else is the owner's.
        const source: AssumptionSource = unchanged && current.source !== null ? current.source : { kind: "OWNER" };
        const verifiedOn = current.regulatory ? (change.verifiedOn ?? null) : null;
        if (verifiedOn !== null && verifiedOn.isAfter(today)) throw new RangeError("A verification date cannot be in the future.");
        set = set.with(change.key, change.value as never, source, verifiedOn);
        const after = set.get(change.key);
        stored.push({
          key: change.key,
          stated: encodeValue(change.key, after.value),
          source: after.source === null ? null : JSON.stringify(after.source),
          verifiedOn: after.verifiedOn === null ? null : after.verifiedOn.toString(),
        });
      }
      await this.store.save(input.userId, stored);
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError) return Err(new ValidationError(error.message));
      throw error;
    }
    const reloaded = hydrate(await this.store.load(input.userId), bornOn, today);
    return Ok(Object.freeze({ assumptions: reloaded.assumptions, saved: true, bornOn, dropped: reloaded.dropped }));
  }
}

export class SetDateOfBirth implements UseCase<{ userId: UserId; bornOn: CalendarDate | null }, { bornOn: CalendarDate | null }> {
  constructor(
    private readonly profiles: OwnerProfileStore,
    private readonly clock: Clock,
  ) {}

  async execute(input: { userId: UserId; bornOn: CalendarDate | null }): Promise<Result<{ bornOn: CalendarDate | null }>> {
    if (input.bornOn !== null) {
      const age = ageOn(input.bornOn, CalendarDate.parse(this.clock.today()));
      if (age === null) return Err(new ValidationError("A date of birth cannot be in the future.", { bornOn: ["Pick a date in the past."] }));
      if (age > 120) return Err(new ValidationError("That date of birth gives an age above 120.", { bornOn: ["Check the year."] }));
    }
    await this.profiles.setBornOn(input.userId, input.bornOn);
    return Ok({ bornOn: input.bornOn });
  }
}
