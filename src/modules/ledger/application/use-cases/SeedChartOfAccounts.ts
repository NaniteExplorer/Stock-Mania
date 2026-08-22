import { Ok, type Result, type UseCase, type UserId, type AppError } from "@/core/kernel";
import { Account } from "../../domain/entities/Account";
import type { AccountId } from "../../domain/ids";
import type { AccountRepository } from "../../domain/ports/AccountRepository";
import { resolveDefaultChart } from "../../domain/ChartOfAccounts";

export interface SeedChartOfAccountsInput {
  userId: UserId;
}

export interface SeedChartOfAccountsOutput {
  created: number;
  /** Already present, so left alone. */
  skipped: number;
}

/**
 * Gives a new user a working chart of accounts.
 *
 * **Idempotent**: it only creates codes that are missing, so running it again
 * after a partial failure — or after a later release adds categories — tops up
 * rather than duplicating. That matters because it runs on first sign-in, where a
 * retry is likely and a duplicate-code crash would lock the user out of an empty
 * app.
 *
 * Parents are created before children in one pass, which the seed list's
 * declaration order guarantees.
 */
export class SeedChartOfAccounts
  implements UseCase<SeedChartOfAccountsInput, SeedChartOfAccountsOutput>
{
  constructor(private readonly accounts: AccountRepository) {}

  async execute(input: SeedChartOfAccountsInput): Promise<Result<SeedChartOfAccountsOutput, AppError>> {
    const existing = await this.accounts.list(input.userId, { includeClosed: true });
    const idByCode = new Map<string, AccountId>(
      existing.map((account) => [account.code.toString(), account.id]),
    );

    const toCreate: Account[] = [];
    for (const seed of resolveDefaultChart()) {
      const code = seed.code.toString();
      if (idByCode.has(code)) continue;

      const parentCode = seed.code.parent?.toString();
      const account = Account.open({
        userId: input.userId,
        code: seed.code,
        name: seed.name,
        type: seed.type,
        subtype: seed.subtype,
        // Resolved from this same map, which the loop fills as it goes — hence
        // the requirement that parents are declared first.
        parentId: parentCode ? idByCode.get(parentCode) ?? null : null,
        isSystem: seed.isSystem,
        sortOrder: seed.sortOrder,
      });

      idByCode.set(code, account.id);
      toCreate.push(account);
    }

    if (toCreate.length > 0) {
      await this.accounts.saveMany(toCreate);
    }

    return Ok({ created: toCreate.length, skipped: existing.length });
  }
}
