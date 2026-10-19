import type { Money } from "@/core/money";
import type { Quantity } from "@/core/numeric";
import type { CalendarDate } from "@/core/time";
import type { UserId } from "@/core/kernel";
import type { InstrumentId } from "./instruments";

/**
 * What was actually recorded against one holding, in full.
 *
 * A read model, and deliberately a separate one. `TradeRecord` answers "what does
 * the position need to know", and it sums the eight charge columns back into a
 * single `Money` to do it; this answers "show me the contract note", which needs
 * exactly the split that sum destroys. Widening `TradeRecord` instead would put a
 * screen's concern in the type every writer has to satisfy.
 *
 * It is keyed on the instrument's own asset account rather than on trades, which
 * is what makes it work for every kind of investment: a dividend, a gold lease
 * payout, a TDS deduction and a deposit's interest credit never write a trade row,
 * but they all post to the holding's account and so they all appear here.
 */

/** One statutory or broker charge, named as the contract note names it. */
export interface InvestmentChargeLine {
  readonly label: string;
  readonly amount: Money;
}

/** One leg of the journal entry an event wrote. */
export interface InvestmentPostingLine {
  readonly accountCode: string;
  readonly accountName: string;
  readonly direction: "DEBIT" | "CREDIT";
  readonly amount: Money;
  readonly memo: string | null;
}

/**
 * Where an event came from.
 *
 * `importBatchId` is kept beside `source` rather than derived from it: "IMPORT"
 * says how it arrived, and only the batch id says which file, which is the half
 * that lets a wrong figure be traced back to the statement that carried it.
 */
export interface InvestmentEventSource {
  readonly source: string;
  readonly reference: string | null;
  readonly importBatchId: string | null;
}

/**
 * One thing that happened to a holding.
 *
 * `TRADE` carries the broker-level detail; `INCOME` is money the holding earned
 * without changing size — a dividend, interest, a lease payout; `OTHER` is
 * anything else that touched the account, such as a corporate action or a
 * correction, and is listed rather than hidden because an unexplained movement is
 * the one a reader most needs to see.
 */
export interface InvestmentEvent {
  readonly kind: "TRADE" | "INCOME" | "OTHER";
  readonly transactionId: string;
  readonly tradeId: string | null;
  readonly on: CalendarDate;
  readonly description: string;
  readonly side: "BUY" | "SELL" | null;
  readonly quantity: Quantity | null;
  readonly pricePerUnit: Money | null;
  /** Quantity × price, before charges. `null` when the event moved no units. */
  readonly consideration: Money | null;
  /** Only the charges that were actually levied; a zero column is not a charge. */
  readonly charges: readonly InvestmentChargeLine[];
  readonly chargeTotal: Money;
  /** What the holding's own account moved by, signed as the ledger recorded it. */
  readonly netToHolding: Money;
  readonly postings: readonly InvestmentPostingLine[];
  readonly origin: InvestmentEventSource;
}

export interface InvestmentActivityQuery {
  /** Every recorded event for one holding, oldest first. */
  forInstrument(userId: UserId, instrumentId: InstrumentId): Promise<readonly InvestmentEvent[]>;
}
