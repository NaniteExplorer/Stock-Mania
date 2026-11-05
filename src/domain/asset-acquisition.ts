/**
 * The expense-to-asset-acquisition link (task 1.8).
 *
 * A major spend that buys something with lasting value — a flat, a car, a
 * laptop — is a posting in the ledger and a physical asset beside it. This module
 * says which postings may be named as an asset's acquisition, and what the link
 * yields: the asset's **acquisition cost provenance**, read from the posting.
 *
 * **L12 shapes it.** A posting carries a category or an instrument, never both
 * (`postings_no_category_on_commodity`), so the asset is never a second column on
 * the posting: the link is a side table, and this module only judges a pair of
 * facts the adapter has read.
 *
 * **The posting is authoritative** (ARCHITECTURE §11, "Linked purchase"). The
 * date and cost are the posting's transaction date and amount, never a stored
 * copy. A physical-asset header that also carries purchase terms must agree with
 * it; {@link purchaseMismatch} is that check, for the 1.4 write path to call.
 *
 * Which legs qualify, and why:
 * - a **DEBIT with a positive amount** — the leg that received the value. A
 *   CREDIT is the bank side of the same purchase;
 * - on an **EXPENSE** account (the spend the owner logged) **or on the asset's
 *   own account** (a purchase the owner capitalised);
 * - **not a commodity leg** — an instrument purchase is a trade, not a physical asset;
 * - in the **asset's currency**;
 * - from a transaction that **happened and still stands**: not a forecast (L11),
 *   not itself a reversal, and not reversed since. A corrected purchase is
 *   relinked to its replacement, never left pointing at the original.
 */

import type { Count } from "@/core/units";
import { DomainError, type UserId } from "@/core/kernel";
import type { Money } from "@/core/money";
import type { CalendarDate } from "@/core/time";
import type { AccountId, AccountTypeName } from "@/domain/accounts";
import type { Purchase } from "@/domain/depreciation";

/** The ledger subtypes a physical, owner-valued asset is kept under (`PurchasedPhysicalAsset`). */
export const ACQUIRABLE_SUBTYPES = Object.freeze(["REAL_ESTATE", "VEHICLE", "OTHER"] as const);
export type AcquirableSubtype = (typeof ACQUIRABLE_SUBTYPES)[number];

/** What the adapter read about the asset's ledger account. */
export interface AcquisitionAssetFacts {
  readonly accountId: AccountId;
  readonly name: string;
  readonly type: AccountTypeName;
  readonly subtype: string | null;
  readonly currencyCode: string;
  readonly isSystem: boolean;
}

/** What the adapter read about the candidate posting, its transaction and its account. */
export interface AcquisitionPostingFacts {
  readonly postingId: string;
  readonly transactionId: string;
  readonly accountId: AccountId;
  readonly accountType: AccountTypeName;
  readonly direction: "DEBIT" | "CREDIT";
  /** The posting's unsigned amount (postings store magnitudes; `direction` carries the sign). */
  readonly amount: Money;
  readonly instrumentId: string | null;
  /** The transaction's accounting date. */
  readonly on: CalendarDate;
  readonly description: string;
  readonly isForecast: boolean;
  /** The transaction is itself a reversal of another. */
  readonly isReversal: boolean;
  /** A live reversal of this transaction exists. */
  readonly isReversed: boolean;
}

/** An asset's acquisition, as the linked posting states it. */
export interface AssetAcquisition {
  /** The link row's id; null before it is stored. */
  readonly linkId: string | null;
  readonly assetAccountId: AccountId;
  readonly postingId: string;
  readonly transactionId: string;
  /** The transaction date of the linked posting. */
  readonly on: CalendarDate;
  /** The linked posting's amount, in the asset's currency. */
  readonly cost: Money;
  /** The transaction's description, so a screen can name the source. */
  readonly description: string;
}

/** A link the rules refuse, with the reason shown to the owner (DESIGN §6.1). */
export class AcquisitionRefusedError extends DomainError {
  constructor(reason: string) {
    super("ASSET_ACQUISITION_REFUSED", reason);
  }
}

/**
 * Judges a candidate link and returns the acquisition it yields, or throws
 * {@link AcquisitionRefusedError} naming the first rule it breaks. Pure: the
 * adapter reads the facts (owner-scoped, tombstones filtered) and calls this both
 * when writing a link and when reading one back, so a link that stops qualifying
 * (its transaction reversed, say) is never shown as a cost.
 */
export function acquisitionOf(
  asset: AcquisitionAssetFacts,
  posting: AcquisitionPostingFacts,
  linkId: string | null = null,
): AssetAcquisition {
  if (asset.type !== "ASSET") throw new AcquisitionRefusedError(`${asset.name} is not an asset account.`);
  if (asset.subtype === null || !(ACQUIRABLE_SUBTYPES as readonly string[]).includes(asset.subtype)) {
    throw new AcquisitionRefusedError(`${asset.name} is not a property, vehicle or other physical asset.`);
  }
  if (asset.isSystem) throw new AcquisitionRefusedError(`${asset.name} is maintained by the app and cannot be linked.`);

  if (posting.direction !== "DEBIT") {
    throw new AcquisitionRefusedError("Only the leg that received the value (a debit) can be the acquisition; this is the paying side.");
  }
  if (!posting.amount.isPositive) throw new AcquisitionRefusedError("The acquisition posting has no amount.");
  if (posting.instrumentId !== null) {
    throw new AcquisitionRefusedError("A posting that moves an instrument is a trade, not the purchase of a physical asset.");
  }
  const onAsset = posting.accountId.equals(asset.accountId);
  if (posting.accountType !== "EXPENSE" && !onAsset) {
    throw new AcquisitionRefusedError(`The acquisition must be an expense, or a debit on ${asset.name} itself.`);
  }
  if (posting.amount.currency.code !== asset.currencyCode) {
    throw new AcquisitionRefusedError(`The posting is in ${posting.amount.currency.code}; ${asset.name} is in ${asset.currencyCode}.`);
  }
  if (posting.isForecast) throw new AcquisitionRefusedError("A forecast has not happened, so it cannot be an acquisition.");
  if (posting.isReversal) throw new AcquisitionRefusedError("A reversal cannot be an acquisition.");
  if (posting.isReversed) {
    throw new AcquisitionRefusedError("This transaction has been reversed; link the corrected transaction instead.");
  }

  return Object.freeze({
    linkId,
    assetAccountId: asset.accountId,
    postingId: posting.postingId,
    transactionId: posting.transactionId,
    on: posting.on,
    cost: posting.amount,
    description: posting.description,
  });
}

/**
 * Why owner-entered purchase terms disagree with the linked acquisition, or null
 * when they agree. The linked posting is authoritative (ARCHITECTURE §11), so a
 * header write whose purchase differs from it is refused with this reason.
 */
export function purchaseMismatch(acquisition: AssetAcquisition, purchase: Purchase): string | null {
  if (purchase.on.toISO() !== acquisition.on.toISO()) {
    return `The purchase date must be ${acquisition.on.toISO()}, the date of the linked transaction.`;
  }
  if (purchase.price.currency.code !== acquisition.cost.currency.code || purchase.price.minor !== acquisition.cost.minor) {
    return "The purchase price must equal the linked posting's amount.";
  }
  return null;
}

/* ═══ Ports ═══════════════════════════════════════════════════════════ */

/** Owner-scoped reads. Tombstoned links, postings, transactions and accounts are never returned. */
export interface AssetAcquisitionRepository {
  /** The asset's acquisition, or null when none is linked or the link no longer qualifies. */
  forAsset(userId: UserId, assetAccountId: AccountId): Promise<AssetAcquisition | null>;
  /** Every live, still-qualifying acquisition. */
  list(userId: UserId): Promise<readonly AssetAcquisition[]>;
  /**
   * Recent postings that could be named as an acquisition: live, non-forecast,
   * unreversed, non-commodity EXPENSE debits, newest first. A shortlist for a
   * picker only; `acquisitionOf` still judges the chosen one against the asset.
   */
  candidates(userId: UserId, limit?: Count): Promise<readonly AcquisitionCandidate[]>;
}

/** A posting offered in the link picker. */
export interface AcquisitionCandidate {
  readonly postingId: string;
  readonly on: CalendarDate;
  readonly amount: Money;
  readonly description: string;
  readonly accountName: string;
}

/** Audited writes (class B): every call is one `mutateAtomic`. */
export interface AssetAcquisitionWriter {
  /**
   * Links `postingId` as the asset's acquisition. A different live link on the
   * asset is tombstoned in the same SQL transaction; linking the same pair again
   * changes nothing. Throws {@link AcquisitionRefusedError} when the rules refuse.
   */
  link(userId: UserId, assetAccountId: AccountId, postingId: string): Promise<AssetAcquisition>;
  /** Tombstones the asset's live link. Throws `NotFoundError` when there is none. */
  unlink(userId: UserId, assetAccountId: AccountId): Promise<void>;
  /** Restores a tombstoned link after re-judging it; refused when the asset or posting is linked again since. */
  restore(userId: UserId, linkId: string): Promise<AssetAcquisition>;
}
