import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/infra/db/client";
import { ledgerAccounts, postings } from "@/infra/db/schema";
import { type UserId } from "@/core/kernel";
import type { Account } from "../../domain/entities/Account";
import type { AccountId } from "../../domain/ids";
import type { AccountRepository } from "../../domain/ports/AccountRepository";
import type { AccountCode } from "../../domain/value-objects/AccountCode";
import type { AccountType } from "../../domain/value-objects/AccountType";
import { AccountMapper } from "../mappers/AccountMapper";

/**
 * libSQL implementation of {@link AccountRepository}.
 *
 * The only layer in the ledger that knows SQL exists. Every query filters on
 * `userId` in the same `and(...)` as its other conditions — never as an
 * afterthought — so there is no code path that can return another user's rows.
 */
export class DrizzleAccountRepository implements AccountRepository {
  constructor(private readonly db: Database) {}

  async save(account: Account): Promise<void> {
    const row = AccountMapper.toRow(account);
    await this.db
      .insert(ledgerAccounts)
      .values(row)
      .onConflictDoUpdate({ target: ledgerAccounts.id, set: row });
  }

  async saveMany(accounts: readonly Account[]): Promise<void> {
    if (accounts.length === 0) return;
    const rows = accounts.map((account) => AccountMapper.toRow(account));
    // One statement, one transaction: seeding the chart either lands whole or not
    // at all, so a failure cannot leave a half-built tree with dangling parents.
    await this.db.insert(ledgerAccounts).values(rows).onConflictDoNothing();
  }

  async findById(userId: UserId, id: AccountId): Promise<Account | null> {
    const [row] = await this.db
      .select()
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.userId, userId.value), eq(ledgerAccounts.id, id.value)))
      .limit(1);
    return row ? AccountMapper.toDomain(row) : null;
  }

  async findByCode(userId: UserId, code: AccountCode): Promise<Account | null> {
    const [row] = await this.db
      .select()
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.userId, userId.value), eq(ledgerAccounts.code, code.toString())))
      .limit(1);
    return row ? AccountMapper.toDomain(row) : null;
  }

  async findManyByCodes(userId: UserId, codes: readonly AccountCode[]): Promise<Account[]> {
    if (codes.length === 0) return [];
    const rows = await this.db
      .select()
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.userId, userId.value),
          inArray(
            ledgerAccounts.code,
            codes.map((code) => code.toString()),
          ),
        ),
      );
    return rows.map(AccountMapper.toDomain);
  }

  async list(userId: UserId, options?: { includeClosed?: boolean }): Promise<Account[]> {
    const rows = await this.db
      .select()
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.userId, userId.value),
          options?.includeClosed ? undefined : eq(ledgerAccounts.isClosed, false),
        ),
      )
      .orderBy(asc(ledgerAccounts.sortOrder), asc(ledgerAccounts.code));
    return rows.map(AccountMapper.toDomain);
  }

  async listByType(
    userId: UserId,
    type: AccountType,
    options?: { includeClosed?: boolean },
  ): Promise<Account[]> {
    const rows = await this.db
      .select()
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.userId, userId.value),
          eq(ledgerAccounts.type, type.name),
          options?.includeClosed ? undefined : eq(ledgerAccounts.isClosed, false),
        ),
      )
      .orderBy(asc(ledgerAccounts.sortOrder), asc(ledgerAccounts.code));
    return rows.map(AccountMapper.toDomain);
  }

  /**
   * Every account beneath `id`, at any depth.
   *
   * Uses a recursive CTE rather than N round trips per level: the tree is walked
   * once inside the database, which matters because this runs on every re-parent
   * to check for a cycle.
   */
  async descendantsOf(userId: UserId, id: AccountId): Promise<Account[]> {
    const rows = await this.db.all<typeof ledgerAccounts.$inferSelect>(sql`
      WITH RECURSIVE subtree(id) AS (
        SELECT id FROM ${ledgerAccounts}
          WHERE parent_id = ${id.value} AND user_id = ${userId.value}
        UNION
        SELECT a.id FROM ${ledgerAccounts} a
          JOIN subtree s ON a.parent_id = s.id
          WHERE a.user_id = ${userId.value}
      )
      SELECT a.* FROM ${ledgerAccounts} a JOIN subtree s ON a.id = s.id
    `);
    return rows.map(AccountMapper.toDomain);
  }

  async countPostings(userId: UserId, id: AccountId): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .where(and(eq(postings.accountId, id.value), eq(ledgerAccounts.userId, userId.value)));
    return row?.total ?? 0;
  }

  async delete(userId: UserId, id: AccountId): Promise<void> {
    await this.db
      .delete(ledgerAccounts)
      .where(and(eq(ledgerAccounts.userId, userId.value), eq(ledgerAccounts.id, id.value)));
  }
}
