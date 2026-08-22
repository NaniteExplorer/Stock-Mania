import { ValueObject } from "./ValueObject";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Cryptographically random v4 UUID. Available in Node and the browser. */
export function newUuid(): string {
  return crypto.randomUUID();
}

/**
 * Base class for entity identifiers.
 *
 * Subclasses add a `private` marker field, which makes them *nominally* typed —
 * passing an `AccountId` where a `TradeId` is expected is a compile error, even
 * though both wrap a string. That is the whole point of not using bare strings
 * for ids.
 *
 * @example
 * export class AccountId extends UniqueId {
 *   private readonly __accountId = true;
 *   static create(): AccountId { return new AccountId(newUuid()); }
 *   static from(value: string): AccountId { return new AccountId(value); }
 * }
 */
export abstract class UniqueId extends ValueObject {
  protected constructor(readonly value: string) {
    super();
    if (!UUID_PATTERN.test(value)) {
      throw new TypeError(
        `${new.target.name} must be a UUID, received: ${JSON.stringify(value)}`,
      );
    }
  }

  protected components(): readonly unknown[] {
    return [this.value];
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
