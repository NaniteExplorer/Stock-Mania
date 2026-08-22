import { UserId } from "@/shared/kernel/UserId";
import { Currency } from "@/shared/money/Currency";
import type { ledgerAccounts } from "@/db/schema";
import { Account, type AccountSubtype } from "../../domain/entities/Account";
import { AccountId } from "../../domain/ids";
import { AccountCode } from "../../domain/value-objects/AccountCode";
import { AccountType } from "../../domain/value-objects/AccountType";

type AccountRow = typeof ledgerAccounts.$inferSelect;
type AccountInsert = typeof ledgerAccounts.$inferInsert;

/**
 * Translates between the `ledger_accounts` row and the `Account` entity.
 *
 * Mappers exist so the domain never has to accommodate the storage shape. That
 * boundary is what keeps `Account` free of nullable primitives and lets the
 * database use whatever representation SQLite is good at — and it is where a
 * future move to Postgres would be absorbed.
 */
export const AccountMapper = {
  toDomain(row: AccountRow): Account {
    return Account.rehydrate({
      id: AccountId.from(row.id),
      userId: UserId.from(row.userId),
      code: AccountCode.parse(row.code),
      name: row.name,
      type: AccountType.of(row.type),
      subtype: (row.subtype as AccountSubtype | null) ?? null,
      parentId: row.parentId ? AccountId.from(row.parentId) : null,
      currency: Currency.of(row.currency),
      institution: row.institution,
      accountNumberSuffix: row.accountNumberSuffix,
      isClosed: row.isClosed,
      isSystem: row.isSystem,
      sortOrder: row.sortOrder,
    });
  },

  toRow(account: Account): AccountInsert {
    return {
      id: account.id.value,
      userId: account.userId.value,
      code: account.code.toString(),
      name: account.name,
      type: account.type.name,
      subtype: account.subtype,
      parentId: account.parentId?.value ?? null,
      currency: account.currency.code,
      institution: account.institution,
      accountNumberSuffix: account.accountNumberSuffix,
      isClosed: account.isClosed,
      isSystem: account.isSystem,
      sortOrder: account.sortOrder,
      updatedAt: new Date(),
    };
  },
};
