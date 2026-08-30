/**
 * The platform a holding lives on.
 *
 * A portfolio spread across Zerodha, Groww, INDmoney, Tanishq and SafeGold is
 * the normal case in India, not the exotic one, and "which platform" is a
 * question the app was previously unable to answer. It had two half-answers: a
 * free-text `platform` string on a gold lease, and the shape of the account tree
 * (`Assets:Investments:Tanishq`), which encodes the platform only as long as
 * nobody renames an account.
 *
 * Neither is a dimension you can group by. "Tanishq", "tanishq" and "Tanishq
 * Digital Gold" are three platforms to a free-text column and one to a person,
 * and a per-platform profit-and-loss built on that is arithmetic on a typo. So
 * the platform becomes a row with an id, and everything that has a platform
 * points at it.
 *
 * What an `Institution` deliberately is **not**:
 *
 *   - **A holding.** It owns nothing and has no balance. Value lives in the
 *     ledger accounts underneath it, and a per-platform total is a rollup of
 *     those, computed on read. There is no second copy of a number here to drift
 *     out of step with the first.
 *   - **A credential store.** No API keys, no account numbers beyond the last
 *     four digits the ledger account already carries. The app fetches prices
 *     from public feeds and never signs in on the user's behalf.
 *   - **A fixed list.** The shipped catalogue in `src/ui/providers.ts` is a
 *     convenience — it supplies a logo and spelling — and `providerId` is
 *     nullable precisely so a platform nobody has heard of is a first-class
 *     entry rather than an "Other" with a note.
 */

import { UserId, ValueObject } from "@/core/kernel";
import { Percentage, UnitPrice } from "@/core/numeric";

/* ═══ Identity ════════════════════════════════════════════════════════ */

export class InstitutionId extends ValueObject {
  private constructor(readonly value: string) {
    super();
  }

  static from(value: string): InstitutionId {
    if (value.trim() === "") throw new TypeError("An institution id cannot be blank.");
    return new InstitutionId(value);
  }

  protected components(): readonly unknown[] {
    return [this.value];
  }

  toString(): string {
    return this.value;
  }
}

/**
 * What sort of organisation it is.
 *
 * Not decoration: it decides which platforms a form offers. Asking for the
 * broker when registering digital gold, or for the bullion vault when
 * registering a share, is the kind of wrong-list that makes a user pick the
 * nearest wrong answer.
 *
 * `BULLION` is separate from `BROKER` because the businesses are separate — a
 * vaulting provider holds metal against your name and does not execute trades —
 * and because gold leasing is offered by the former and never the latter.
 */
export const INSTITUTION_KINDS = [
  "BANK",
  "BROKER",
  "BULLION",
  "WALLET",
  "SCHEME",
  "LENDER",
  "OTHER",
] as const;
export type InstitutionKind = (typeof INSTITUTION_KINDS)[number];

const KIND_LABELS: Readonly<Record<InstitutionKind, string>> = {
  BANK: "Bank",
  BROKER: "Broker",
  BULLION: "Bullion vault",
  WALLET: "Wallet",
  SCHEME: "Scheme",
  LENDER: "Lender",
  OTHER: "Other",
};

export function institutionKindLabel(kind: InstitutionKind): string {
  return KIND_LABELS[kind];
}

/* ═══ The entity ══════════════════════════════════════════════════════ */

export interface InstitutionProps {
  readonly id: InstitutionId;
  readonly userId: UserId;
  readonly name: string;
  /** An id in `src/ui/providers.ts`, for the logo and canonical spelling. */
  readonly providerId?: string | null;
  readonly kind: InstitutionKind;
  readonly country?: string;
  /**
   * How far below the benchmark this platform buys back, as a percentage.
   *
   * The fact that makes digital gold different from a share. A share sells at the
   * price the screen shows; digital gold sells at the vault's own rate, typically
   * 3-6% under the IBJA benchmark the app values it at, and the 3% GST paid on
   * the way in is never coming back. Valuing the holding at the benchmark
   * therefore shows a profit on the morning after a purchase that could not be
   * realised by selling.
   *
   * Zero means **not told**, not "no spread". The app then values at the
   * benchmark and says that is what it is doing, rather than inventing a
   * plausible-looking 4% the user never entered.
   */
  readonly sellSpread?: Percentage;
  readonly notes?: string | null;
  readonly isArchived?: boolean;
}

/**
 * A platform. Immutable — `with()` returns a new one, like every other value
 * object here, so nothing holds a reference that silently changes underneath it.
 */
export class Institution {
  readonly props: Required<
    Pick<
      InstitutionProps,
      "id" | "userId" | "name" | "kind" | "country" | "isArchived" | "sellSpread"
    >
  > &
    Pick<InstitutionProps, "providerId" | "notes">;

  constructor(props: InstitutionProps) {
    const name = props.name.trim();
    if (name.length === 0) {
      throw new TypeError("A platform needs a name.");
    }
    if (name.length > 120) {
      throw new TypeError("A platform name is at most 120 characters.");
    }
    const country = (props.country ?? "IN").trim().toUpperCase();
    if (country.length !== 2) {
      throw new TypeError(`"${country}" is not a two-letter country code.`);
    }

    const sellSpread = props.sellSpread ?? Percentage.ZERO;
    if (sellSpread.isNegative || sellSpread.compareTo(Percentage.of("100")) > 0) {
      throw new TypeError(
        `A sell spread of ${sellSpread.toFixed(2)}% is not a discount between 0 and 100. ` +
          `A negative spread would mean the platform buys back above the benchmark, and a ` +
          `spread of more than 100% would mean it pays you nothing and bills you for the metal.`,
      );
    }

    this.props = {
      id: props.id,
      userId: props.userId,
      name,
      providerId: props.providerId ?? null,
      kind: props.kind,
      country,
      sellSpread,
      notes: props.notes ?? null,
      isArchived: props.isArchived ?? false,
    };
  }

  get id(): InstitutionId {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get kind(): InstitutionKind {
    return this.props.kind;
  }

  get isArchived(): boolean {
    return this.props.isArchived;
  }

  get sellSpread(): Percentage {
    return this.props.sellSpread;
  }

  /** Whether the user has told us what this platform buys back at. */
  get hasSellSpread(): boolean {
    return !this.props.sellSpread.isZero;
  }

  /**
   * The benchmark price discounted to what this platform would actually pay.
   *
   * One rounding, `DOWN`: a realisable value that rounded up would be a figure
   * the user cannot get, which is the entire failure this field exists to fix.
   * With no spread recorded it returns the benchmark unchanged — the app is then
   * showing a benchmark, and every screen that uses this says so.
   */
  realisablePrice(benchmark: UnitPrice): UnitPrice {
    if (!this.hasSellSpread) return benchmark;
    return UnitPrice.fromScaled(
      (benchmark.scaled * (HUNDRED_PERCENT - this.props.sellSpread.scaled)) / HUNDRED_PERCENT,
      benchmark.currency,
    );
  }

  /**
   * The matching key, so "Tanishq", " tanishq " and "TANISHQ" are one platform.
   *
   * Uniqueness is enforced on this rather than on the display name, because the
   * whole reason the entity exists is that a per-platform total must not be
   * split by capitalisation.
   */
  get matchKey(): string {
    return normaliseInstitutionName(this.props.name);
  }

  /**
   * The segment this platform contributes to an account code, e.g. the
   * `Tanishq` of `Assets:Investments:Tanishq:Digital Gold`.
   *
   * Colons are stripped because they are the code's own separator, and a
   * platform called "A:B" would otherwise silently create a level of tree.
   */
  get accountSegment(): string {
    return this.props.name.replace(/:/g, " ").replace(/\s+/g, " ").trim();
  }

  with(changes: Partial<Omit<InstitutionProps, "id" | "userId">>): Institution {
    return new Institution({ ...this.props, ...changes });
  }

  archive(): Institution {
    return this.with({ isArchived: true });
  }

  restore(): Institution {
    return this.with({ isArchived: false });
  }
}

/** 100 × 10^6 — the percent scale, as `Percentage.scaled` carries it. */
const HUNDRED_PERCENT = 100_000_000n;

export function normaliseInstitutionName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/* ═══ Port ════════════════════════════════════════════════════════════ */

export interface InstitutionRepository {
  findById(userId: UserId, id: InstitutionId): Promise<Institution | null>;
  /** By normalised name, so a seed re-run and a hand-typed name are one row. */
  findByName(userId: UserId, name: string): Promise<Institution | null>;
  list(userId: UserId, options?: { includeArchived?: boolean }): Promise<readonly Institution[]>;
  save(institution: Institution): Promise<void>;
  /** Soft, per A03 — the row keeps its tombstone and drops out of every read. */
  softDelete(userId: UserId, id: InstitutionId): Promise<void>;
}
