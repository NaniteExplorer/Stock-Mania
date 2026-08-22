import { Err, Ok, type Result } from "@/shared/kernel/Result";
import type { UseCase } from "@/shared/kernel/UseCase";
import type { UserId } from "@/shared/kernel/UserId";
import type { Clock } from "@/shared/kernel/Clock";
import type { Money } from "@/shared/money/Money";
import { Currency } from "@/shared/money/Currency";
import { CalendarDate } from "@/shared/time/CalendarDate";
import { NotFoundError, ValidationError, type AppError } from "@/shared/errors/AppError";
import { Account, type AccountSubtype } from "../../domain/entities/Account";
import { JournalEntry } from "../../domain/entities/JournalEntry";
import type { AccountId } from "../../domain/ids";
import type { AccountRepository } from "../../domain/ports/AccountRepository";
import type { JournalRepository } from "../../domain/ports/JournalRepository";
import { AccountCode } from "../../domain/value-objects/AccountCode";
import { AccountType, type AccountTypeName } from "../../domain/value-objects/AccountType";
import { SystemAccountCodes } from "../../domain/ChartOfAccounts";

export interface OpenAccountInput {
  userId: UserId;
  name: string;
  type: AccountTypeName;
  subtype?: AccountSubtype | null;
  /** Where it sits in the tree. Defaults to the type's root (`Assets`, …). */
  parentId?: AccountId | null;
  institution?: string | null;
  accountNumberSuffix?: string | null;
  currency?: Currency;
  /**
   * The balance the account already has today. Booked against
   * `Equity:Opening Balances` so the ledger stays balanced from the first day —
   * this is the piece that lets a user start mid-life without inventing history.
   *
   * For a liability, pass the amount owed as a positive number.
   */
  openingBalance?: Money | null;
  openingBalanceOn?: CalendarDate;
}

export interface OpenAccountOutput {
  accountId: AccountId;
  code: string;
}

/**
 * Creates an account, and optionally seeds its current balance.
 *
 * The opening balance is the interesting part. A user starting today has ₹3.4
 * lakh in a bank account and no transaction history to explain it, and a
 * single-sided "just set the balance" would leave debits and credits unequal
 * forever. Posting it against `Equity:Opening Balances` is the standard
 * bookkeeping answer: net worth is right immediately, the ledger still balances,
 * and the equity account makes explicit how much of the position was never
 * recorded as income.
 */
export class OpenAccount implements UseCase<OpenAccountInput, OpenAccountOutput> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly journal: JournalRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: OpenAccountInput): Promise<Result<OpenAccountOutput, AppError>> {
    const name = input.name.trim();
    if (name.length === 0) {
      return Err(new ValidationError("Give the account a name.", { name: ["Required"] }));
    }

    const type = AccountType.of(input.type);
    if (!type.isUserCreatable) {
      return Err(
        new ValidationError(
          `${type.label} accounts are maintained by the app and cannot be created by hand.`,
          { type: ["Not allowed"] },
        ),
      );
    }

    const parent = input.parentId
      ? await this.accounts.findById(input.userId, input.parentId)
      : await this.accounts.findByCode(input.userId, AccountCode.parse(type.label));

    if (input.parentId && !parent) {
      return Err(new NotFoundError("Parent account", input.parentId.value));
    }
    if (parent && parent.type !== type) {
      return Err(
        new ValidationError(
          `A ${type.label.toLowerCase()} account cannot sit under ${parent.displayName}, ` +
            `which is ${parent.type.label.toLowerCase()}.`,
          { parentId: ["Type mismatch"] },
        ),
      );
    }

    // Codes are unique per user; disambiguate rather than rejecting a name the
    // user reasonably wants to reuse ("HDFC" for both a savings and a salary
    // account).
    const baseCode = parent ? parent.code.child(name) : AccountCode.parse(name);
    const code = await this.uniqueCode(input.userId, baseCode);

    const account = Account.open({
      userId: input.userId,
      code,
      name,
      type,
      subtype: input.subtype ?? parent?.subtype ?? null,
      parentId: parent?.id ?? null,
      currency: input.currency ?? Currency.reporting,
      institution: input.institution ?? parent?.institution ?? null,
      accountNumberSuffix: input.accountNumberSuffix ?? null,
    });

    await this.accounts.save(account);

    const opening = input.openingBalance;
    if (opening && !opening.isZero) {
      const equity = await this.accounts.findByCode(
        input.userId,
        AccountCode.parse(SystemAccountCodes.openingBalances),
      );
      if (!equity) {
        return Err(
          new NotFoundError(
            `System account "${SystemAccountCodes.openingBalances}" — seed the chart of accounts first`,
          ),
        );
      }

      // An asset's opening balance debits the asset; a liability's credits it.
      // Using `signedEffect` keeps this from being a hand-written sign decision.
      const increasesWithDebit = type.signedEffect("DEBIT") === 1;
      const entry = JournalEntry.twoLegged({
        userId: input.userId,
        postedOn: input.openingBalanceOn ?? CalendarDate.parse(this.clock.today()),
        narration: `Opening balance — ${account.displayName}`,
        kind: "OPENING",
        debitAccountId: increasesWithDebit ? account.id : equity.id,
        creditAccountId: increasesWithDebit ? equity.id : account.id,
        amount: opening.abs(),
      });
      await this.journal.save(entry);
    }

    return Ok({ accountId: account.id, code: code.toString() });
  }

  /** Appends ` 2`, ` 3`, … until the code is free. */
  private async uniqueCode(userId: UserId, base: AccountCode): Promise<AccountCode> {
    if (!(await this.accounts.findByCode(userId, base))) return base;

    const parent = base.parent;
    for (let suffix = 2; suffix < 50; suffix += 1) {
      const candidate = parent
        ? parent.child(`${base.leaf} ${suffix}`)
        : AccountCode.parse(`${base.leaf} ${suffix}`);
      if (!(await this.accounts.findByCode(userId, candidate))) return candidate;
    }
    throw new Error(`Could not find a free account code based on "${base.toString()}"`);
  }
}
