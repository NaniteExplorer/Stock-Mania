import { Money } from "@/core/money";
import { DomainError } from "@/core/kernel";

/**
 * The ledger's invariant violations.
 *
 * `UnbalancedEntryError` is thrown from `JournalEntry`'s constructor rather than
 * returned as a `Result`, because an unbalanced entry is not a user-facing
 * outcome to render — it means the code that built the postings is wrong. Use
 * cases validate their inputs *before* constructing, so users see a
 * `ValidationError` instead.
 */
export class UnbalancedEntryError extends DomainError {
  constructor(debits: Money, credits: Money) {
    const difference = debits.minus(credits);
    super(
      "LEDGER_ENTRY_UNBALANCED",
      `Journal entry does not balance: debits ${debits.toDecimalString()} vs credits ` +
        `${credits.toDecimalString()} (off by ${difference.toDecimalString()}).`,
    );
  }
}

export class InsufficientPostingsError extends DomainError {
  constructor(count: number) {
    super(
      "LEDGER_ENTRY_TOO_FEW_POSTINGS",
      `A journal entry needs at least two postings, got ${count}. ` +
        `Money always moves from somewhere to somewhere.`,
    );
  }
}

export class MixedCurrencyEntryError extends DomainError {
  constructor(currencies: readonly string[]) {
    super(
      "LEDGER_ENTRY_MIXED_CURRENCY",
      `All postings in an entry must share one currency, found: ${currencies.join(", ")}. ` +
        `Record a cross-currency movement as two entries joined by a conversion account.`,
      );
  }
}

export class AccountClosedError extends DomainError {
  constructor(accountName: string) {
    super("LEDGER_ACCOUNT_CLOSED", `${accountName} is closed, so it cannot be posted to.`);
  }
}

export class SystemAccountError extends DomainError {
  constructor(accountName: string, action: string) {
    super(
      "LEDGER_SYSTEM_ACCOUNT",
      `${accountName} is maintained by the app and cannot be ${action}.`,
    );
  }
}

export class AccountHasPostingsError extends DomainError {
  constructor(accountName: string, postingCount: number) {
    super(
      "LEDGER_ACCOUNT_HAS_POSTINGS",
      `${accountName} has ${postingCount} transaction(s) and cannot be deleted. ` +
        `Close it instead — that keeps its history and hides it from pickers.`,
    );
  }
}

export class AccountCycleError extends DomainError {
  constructor(accountName: string) {
    super(
      "LEDGER_ACCOUNT_CYCLE",
      `${accountName} cannot be moved under one of its own descendants.`,
    );
  }
}

export class EntryAlreadyReversedError extends DomainError {
  constructor() {
    super(
      "LEDGER_ENTRY_ALREADY_REVERSED",
      "That transaction has already been reversed.",
    );
  }
}
