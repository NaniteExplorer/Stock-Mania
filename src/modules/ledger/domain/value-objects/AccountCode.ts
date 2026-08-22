import { ValueObject } from "@/core/kernel";

const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 &.'()-]*$/;
const SEPARATOR = ":";
const MAX_DEPTH = 6;

/**
 * A colon-delimited path naming an account: `Assets:Bank:HDFC`.
 *
 * Exists so that seed data, imports and tests can reference an account without
 * knowing its generated uuid, and so a rollup ("everything under
 * `Expenses:Food`") is a prefix match rather than a recursive query. The code is
 * unique per user, which is what makes an import idempotent across runs.
 */
export class AccountCode extends ValueObject {
  private constructor(readonly segments: readonly string[]) {
    super();
  }

  static parse(value: string): AccountCode {
    const segments = value
      .split(SEPARATOR)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    if (segments.length === 0) {
      throw new TypeError("An account code needs at least one segment");
    }
    if (segments.length > MAX_DEPTH) {
      throw new RangeError(
        `Account code is ${segments.length} levels deep; the maximum is ${MAX_DEPTH}: "${value}"`,
      );
    }
    for (const segment of segments) {
      if (!SEGMENT_PATTERN.test(segment)) {
        throw new TypeError(`"${segment}" is not a valid account code segment`);
      }
    }

    return new AccountCode(segments);
  }

  static of(...segments: readonly string[]): AccountCode {
    return AccountCode.parse(segments.join(SEPARATOR));
  }

  /** The last segment — what the account is called on its own. */
  get leaf(): string {
    return this.segments[this.segments.length - 1];
  }

  get depth(): number {
    return this.segments.length;
  }

  /** The code of the parent account, or null at the root. */
  get parent(): AccountCode | null {
    if (this.segments.length === 1) return null;
    return new AccountCode(this.segments.slice(0, -1));
  }

  child(segment: string): AccountCode {
    return AccountCode.parse([...this.segments, segment].join(SEPARATOR));
  }

  /** True when `this` is `other` or sits beneath it — the rollup test. */
  isUnder(other: AccountCode): boolean {
    if (other.segments.length > this.segments.length) return false;
    return other.segments.every(
      (segment, index) => segment.toLowerCase() === this.segments[index].toLowerCase(),
    );
  }

  /** All ancestor codes, root first — the breadcrumb trail. */
  ancestors(): AccountCode[] {
    return this.segments
      .slice(0, -1)
      .map((_, index) => new AccountCode(this.segments.slice(0, index + 1)));
  }

  protected components(): readonly unknown[] {
    return [this.toString().toLowerCase()];
  }

  toString(): string {
    return this.segments.join(SEPARATOR);
  }

  toJSON(): string {
    return this.toString();
  }
}
