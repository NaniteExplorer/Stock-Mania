import { newUuid, UniqueId } from "@/shared/kernel/UniqueId";

/**
 * The ledger's identifier types.
 *
 * Each carries a private marker field, which makes them mutually incompatible at
 * compile time — passing a `JournalEntryId` where an `AccountId` belongs will not
 * type-check, even though both wrap a uuid string.
 */

export class AccountId extends UniqueId {
  private readonly __accountId = true;

  static create(): AccountId {
    return new AccountId(newUuid());
  }

  static from(value: string): AccountId {
    return new AccountId(value);
  }
}

export class JournalEntryId extends UniqueId {
  private readonly __journalEntryId = true;

  static create(): JournalEntryId {
    return new JournalEntryId(newUuid());
  }

  static from(value: string): JournalEntryId {
    return new JournalEntryId(value);
  }
}

export class PostingId extends UniqueId {
  private readonly __postingId = true;

  static create(): PostingId {
    return new PostingId(newUuid());
  }

  static from(value: string): PostingId {
    return new PostingId(value);
  }
}
