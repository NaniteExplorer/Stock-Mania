import { ValueObject } from "./ValueObject";

/**
 * The signed-in user's identifier.
 *
 * Separate from {@link UniqueId} — and deliberately *not* UUID-validated —
 * because better-auth mints its own opaque id format. Every query in the app is
 * scoped by one of these, so it is a distinct type rather than a bare string: an
 * accidental `userId`/`accountId` swap becomes a compile error instead of a
 * cross-tenant data leak.
 */
export class UserId extends ValueObject {
  private readonly __userId = true;

  private constructor(readonly value: string) {
    super();
  }

  static from(value: string): UserId {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new TypeError("UserId must not be empty");
    }
    return new UserId(trimmed);
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
