import { type UserId } from "@/core/kernel";
import type { Account } from "../entities/Account";
import type { AccountId } from "../ids";
import type { AccountCode } from "../value-objects/AccountCode";
import type { AccountType } from "../value-objects/AccountType";

/**
 * Persistence for accounts, as the domain needs it.
 *
 * Declared here, in `domain/`, and implemented in `infrastructure/` — so the
 * dependency points inward and the domain never learns that SQL exists. This is
 * the interface v1's `Repository<T>` failed to be: it is shaped by what the use
 * cases actually ask for (`findByCode`, `descendantsOf`, `countPostings`) rather
 * than a generic `findMany(filter?: Partial<T>)` that nothing could implement
 * usefully.
 *
 * Every method takes a `UserId`. Scoping is not optional and not defaulted, so a
 * query that forgets it does not compile.
 */
export interface AccountRepository {
  /** Insert or update. The account's `id` decides which. */
  save(account: Account): Promise<void>;

  /** Bulk insert, in one transaction — used to seed the default chart. */
  saveMany(accounts: readonly Account[]): Promise<void>;

  findById(userId: UserId, id: AccountId): Promise<Account | null>;

  /** Lookup by path, for seeds, imports and system-account resolution. */
  findByCode(userId: UserId, code: AccountCode): Promise<Account | null>;

  findManyByCodes(userId: UserId, codes: readonly AccountCode[]): Promise<Account[]>;

  list(userId: UserId, options?: { includeClosed?: boolean }): Promise<Account[]>;

  listByType(
    userId: UserId,
    type: AccountType,
    options?: { includeClosed?: boolean },
  ): Promise<Account[]>;

  /** Every account beneath `id`, at any depth. Needed for the cycle check. */
  descendantsOf(userId: UserId, id: AccountId): Promise<Account[]>;

  /** How many postings reference this account — decides close-vs-delete. */
  countPostings(userId: UserId, id: AccountId): Promise<number>;

  /** Only valid for an account with no postings; enforced by the use case. */
  delete(userId: UserId, id: AccountId): Promise<void>;
}
