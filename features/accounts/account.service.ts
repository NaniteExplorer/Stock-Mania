import { accountRepository } from "./account.repository";
import { LIABILITY_ACCOUNT_TYPES } from "./account.types";
import type { Account, CreateAccountInput, UpdateAccountInput } from "./account.types";

const isLiabilityAccount = (account: Account) => LIABILITY_ACCOUNT_TYPES.includes(account.type);

export const accountService = {
  list(userId: string): Promise<Account[]> {
    return accountRepository.listByUser(userId);
  },
  create(userId: string, input: CreateAccountInput): Promise<Account> {
    return accountRepository.create(userId, input);
  },
  update(id: string, userId: string, input: UpdateAccountInput): Promise<void> {
    return accountRepository.update(id, userId, input);
  },
  remove(id: string, userId: string): Promise<void> {
    return accountRepository.remove(id, userId);
  },
  /** Asset-side balance only — excludes credit cards (which are liabilities). */
  async total(userId: string): Promise<number> {
    const accounts = await accountRepository.listByUser(userId);
    return accounts
      .filter((a) => !isLiabilityAccount(a))
      .reduce((sum, a) => sum + (a.balance || 0), 0);
  },
  /** Outstanding owed across credit-card accounts (a liability). */
  async creditCardDebt(userId: string): Promise<number> {
    const accounts = await accountRepository.listByUser(userId);
    return accounts
      .filter(isLiabilityAccount)
      .reduce((sum, a) => sum + Math.max(0, a.balance || 0), 0);
  },
};
