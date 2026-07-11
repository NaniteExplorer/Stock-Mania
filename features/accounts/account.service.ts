import { createHash } from "node:crypto";
import { connectToDatabase } from "@/core/db/connection";
import { Transaction } from "@/features/transactions/transaction.model";
import { accountRepository } from "./account.repository";
import { LIABILITY_ACCOUNT_TYPES } from "./account.types";
import type { Account, CreateAccountInput, UpdateAccountInput } from "./account.types";

const isLiabilityAccount = (account: Account) => LIABILITY_ACCOUNT_TYPES.includes(account.type);

/**
 * Latest running balance per account, from the transaction ledger. This is the
 * source of truth for accounts that have imported transactions — the stored
 * `balance` scalar is only the opening estimate used when there are no rows.
 */
async function ledgerBalances(userId: string): Promise<Map<string, { balance: number; asOf: Date }>> {
  await connectToDatabase();
  const rows = await Transaction.aggregate<{ _id: unknown; balance: number; asOf: Date }>([
    { $match: { userId, balanceAfter: { $ne: null } } },
    { $sort: { transactionDate: -1, statementOrder: -1, _id: -1 } },
    { $group: { _id: "$accountId", balance: { $first: "$balanceAfter" }, asOf: { $first: "$transactionDate" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { balance: r.balance, asOf: r.asOf }]));
}

/** Merge stored opening balance with the ledger-derived balance (ledger wins). */
function withDerivedBalance(account: Account, derived: Map<string, { balance: number; asOf: Date }>): Account {
  const led = derived.get(account.id);
  if (!led) return account;
  if (account.balanceAsOf && account.balanceAsOf.getTime() >= led.asOf.getTime()) return account;
  return { ...account, balance: led.balance, balanceAsOf: led.asOf };
}

export const accountService = {
  async list(userId: string): Promise<Account[]> {
    const [accounts, derived] = await Promise.all([accountRepository.listByUser(userId), ledgerBalances(userId)]);
    return accounts.map((a) => withDerivedBalance(a, derived));
  },
  create(userId: string, input: CreateAccountInput): Promise<Account> {
    return accountRepository.create(userId, input);
  },
  /**
   * Update account fields. A change to the balance is NOT written to the scalar
   * when the account has a transaction ledger — instead it's recorded as an
   * "Adjustment" transaction that bridges the derived balance to the target, so
   * net worth stays explainable by the ledger.
   */
  async update(id: string, userId: string, input: UpdateAccountInput): Promise<void> {
    const { balance, ...rest } = input;
    if (Object.keys(rest).length) await accountRepository.update(id, userId, rest);
    if (typeof balance === "number") await this.setBalance(id, userId, balance);
  },
  /**
   * Set an account's effective balance. With a ledger present, books an
   * adjustment transaction for the delta; otherwise updates the opening scalar.
   */
  async setBalance(id: string, userId: string, target: number): Promise<void> {
    await connectToDatabase();
    const account = await accountRepository.byId(id, userId);
    if (!account) return;

    const derived = (await ledgerBalances(userId)).get(id);
    if (derived == null) {
      // No ledger yet — the scalar IS the balance (opening estimate).
      await accountRepository.update(id, userId, { balance: target });
      return;
    }
    const delta = target - derived.balance;
    if (Math.abs(delta) < 0.005) return;

    const now = new Date();
    const fingerprint = createHash("sha256")
      .update(["adjustment", id, now.toISOString(), target.toFixed(2)].join("|"))
      .digest("hex");
    await Transaction.create({
      accountId: id,
      userId,
      transactionDate: now,
      description: "Balance adjustment",
      reference: null,
      amount: Math.abs(delta),
      direction: delta > 0 ? "CREDIT" : "DEBIT",
      balanceAfter: target,
      currency: account.currency,
      category: "ADJUSTMENT",
      categorySource: "MANUAL",
      source: "MANUAL",
      sourceFile: null,
      fingerprint,
    });
  },
  /** Delete an account and cascade-delete its imported transactions. */
  async remove(id: string, userId: string): Promise<void> {
    await connectToDatabase();
    await Transaction.deleteMany({ userId, accountId: id });
    await accountRepository.remove(id, userId);
  },
  /** Asset-side balance only — excludes credit cards (which are liabilities). */
  async total(userId: string): Promise<number> {
    const accounts = await this.list(userId);
    return accounts
      .filter((a) => !isLiabilityAccount(a))
      .reduce((sum, a) => sum + (a.balance || 0), 0);
  },
  /** Outstanding owed across credit-card accounts (a liability). */
  async creditCardDebt(userId: string): Promise<number> {
    const accounts = await this.list(userId);
    return accounts
      .filter(isLiabilityAccount)
      .reduce((sum, a) => sum + Math.max(0, a.balance || 0), 0);
  },
};
