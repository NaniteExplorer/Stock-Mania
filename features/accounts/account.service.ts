import { accountRepository } from "./account.repository";
import type { Account, CreateAccountInput, UpdateAccountInput } from "./account.types";

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
  async total(userId: string): Promise<number> {
    const accounts = await accountRepository.listByUser(userId);
    return accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  },
};
