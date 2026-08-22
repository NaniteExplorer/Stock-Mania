/**
 * The kernel: the handful of base types every other file builds on.
 *
 * Consolidated from eight files under `src/shared/{kernel,errors}/`. Ordering
 * inside the file follows the dependency direction — errors, then value objects
 * and identity, then entities, then Result and the use-case contract, then the
 * clock — so nothing forward-references.
 */

/* ─── Errors ─────────────────────────────────────────────── */

/**
 * Error hierarchy.
 *
 * The distinction that matters: `DomainError` and its siblings are *expected*
 * outcomes the UI renders (a duplicate row, an unbalanced entry, a closed
 * account). Anything else escaping as a raw `Error` is a bug, and should crash
 * loudly rather than be caught and shown as a friendly message.
 *
 * Every error carries a stable machine-readable `code` so the UI can branch on
 * it without string-matching messages.
 */
export abstract class AppError extends Error {
  abstract readonly code: string;

  /** Safe to show the user verbatim. */
  readonly userMessage: string;

  constructor(message: string, options?: { cause?: unknown; userMessage?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.userMessage = options?.userMessage ?? message;
  }

  toJSON(): { code: string; message: string } {
    return { code: this.code, message: this.userMessage };
  }
}

/** A domain invariant was violated — the requested change is not legal. */
export class DomainError extends AppError {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

/** The caller supplied malformed input. Carries per-field messages for forms. */
export class ValidationError extends AppError {
  readonly code = "VALIDATION_FAILED";

  constructor(
    message: string,
    readonly fieldErrors: Readonly<Record<string, string[]>> = {},
  ) {
    super(message);
  }
}

/** A record the caller referenced does not exist (or is not theirs to see). */
export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND";

  constructor(entity: string, id?: string) {
    super(id ? `${entity} ${id} was not found` : `${entity} was not found`);
  }
}

/** No valid session, or the session's user does not own the target record. */
export class UnauthorizedError extends AppError {
  readonly code = "UNAUTHORIZED";

  constructor(message = "You need to sign in to do that") {
    super(message);
  }
}

/** A free external source (price feed, NAV file) failed or returned garbage. */
export class ExternalServiceError extends AppError {
  readonly code = "EXTERNAL_SERVICE_FAILED";

  constructor(
    readonly service: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`${service}: ${message}`, {
      ...options,
      userMessage: `${service} is unavailable right now — showing the last known value.`,
    });
  }
}

/* ─── ValueObject ─────────────────────────────────────────────── */

/**
 * Base class for value objects.
 *
 * A value object has no identity — it *is* its components. Two of them are equal
 * when their components are equal, and they are immutable, so once constructed a
 * value object is always valid. Validation therefore belongs in the constructor
 * (or a static factory), never in the caller.
 */
export abstract class ValueObject {
  /**
   * The values that define this object's identity, in a stable order.
   * Implementations return primitives or nested value objects.
   */
  protected abstract components(): readonly unknown[];

  equals(other: this | null | undefined): boolean {
    if (other === null || other === undefined) return false;
    if (other === this) return true;
    if (other.constructor !== this.constructor) return false;

    const mine = this.components();
    const theirs = other.components();
    if (mine.length !== theirs.length) return false;

    return mine.every((component, index) => {
      const counterpart = theirs[index];
      if (component instanceof ValueObject) {
        return component.equals(counterpart as typeof component);
      }
      return component === counterpart;
    });
  }
}

/* ─── Identity ─────────────────────────────────────────────── */

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

/* ─── UserId ─────────────────────────────────────────────── */

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

/* ─── Entity and AggregateRoot ─────────────────────────────────────────────── */

/**
 * Base class for entities: objects with a lifecycle and a stable identity.
 *
 * Two entities are the same entity when their ids match, regardless of whether
 * their other fields currently agree — that is what distinguishes an entity from
 * a {@link ValueObject}.
 */
export abstract class Entity<TId extends UniqueId> {
  protected constructor(readonly id: TId) {}

  equals(other: Entity<TId> | null | undefined): boolean {
    if (other === null || other === undefined) return false;
    if (other === this) return true;
    if (other.constructor !== this.constructor) return false;
    return this.id.equals(other.id);
  }
}

/**
 * An aggregate root is the single entry point to a cluster of objects that must
 * stay consistent together — a `JournalEntry` and its `Posting`s, for instance.
 *
 * Two rules follow from that, and they are why the ledger cannot drift:
 *   1. Outside code may only hold a reference to the root, never to a child.
 *   2. The root enforces the invariants of the whole cluster in its constructor,
 *      so an invalid aggregate cannot be brought into existence.
 *
 * Repositories load and save whole aggregates, never fragments of one.
 */
export abstract class AggregateRoot<TId extends UniqueId> extends Entity<TId> {}

/* ─── Result ─────────────────────────────────────────────── */

/**
 * An operation's outcome as a value rather than a thrown exception.
 *
 * Used for failures the caller is *expected* to handle — a duplicate import row,
 * an unbalanced journal entry, a closed account. Programmer errors still throw,
 * because there is no sensible way for a caller to handle them.
 *
 * Narrowing works off the literal `ok` field:
 *
 * @example
 * const result = await useCase.execute(dto);
 * if (!result.ok) return { error: result.error.userMessage };
 * return { id: result.value.id };   // `value` is available here
 */
export type Result<T, E extends AppError = AppError> = Success<T> | Failure<E>;

export class Success<T> {
  readonly ok = true as const;

  constructor(readonly value: T) {}

  map<U>(fn: (value: T) => U): Result<U, never> {
    return new Success(fn(this.value));
  }

  /** Chain another fallible step. */
  andThen<U, F extends AppError>(fn: (value: T) => Result<U, F>): Result<U, F> {
    return fn(this.value);
  }

  unwrapOr(_fallback: T): T {
    return this.value;
  }

  /** Escape hatch for call sites that treat failure as a bug. */
  unwrap(): T {
    return this.value;
  }
}

export class Failure<E extends AppError> {
  readonly ok = false as const;

  constructor(readonly error: E) {}

  map<U>(_fn: (value: never) => U): Result<U, E> {
    return this as unknown as Result<U, E>;
  }

  andThen<U, F extends AppError>(_fn: (value: never) => Result<U, F>): Result<U, E | F> {
    return this as unknown as Result<U, E | F>;
  }

  unwrapOr<T>(fallback: T): T {
    return fallback;
  }

  unwrap(): never {
    throw this.error;
  }
}

export function Ok<T>(value: T): Success<T>;
export function Ok(): Success<void>;
export function Ok<T>(value?: T): Success<T | void> {
  return new Success(value as T);
}

export function Err<E extends AppError>(error: E): Failure<E> {
  return new Failure(error);
}

/**
 * Collapses many results into one: all successes, or the first failure.
 * Useful for validating a batch (an import file) before committing any of it.
 */
export function collect<T, E extends AppError>(
  results: readonly Result<T, E>[],
): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return new Success(values);
}

/* ─── UseCase ─────────────────────────────────────────────── */

/**
 * One application operation, as an object.
 *
 * A class per use case rather than a grab-bag service object (v1's
 * `export const accountService = { ... }`) buys three things: its dependencies are
 * explicit constructor arguments instead of module-level imports, it can be
 * instantiated with fakes in a test with no module mocking, and the unit of work
 * has a name a reader can find. `execute` is the only public method.
 *
 * Commands return `Result` so expected failures — a duplicate, a closed account —
 * travel as values the UI can render. Unexpected failures still throw.
 */
export interface UseCase<TInput, TOutput, TError extends AppError = AppError> {
  execute(input: TInput): Promise<Result<TOutput, TError>>;
}

/**
 * A read-only operation.
 *
 * Queries return their value directly. A report has no expected failure mode to
 * model — an empty ledger is an empty result, not an error — so wrapping every
 * read in a `Result` the caller must unwrap would be ceremony with no payoff.
 */
export interface Query<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
}

/* ─── Clock ─────────────────────────────────────────────── */

/**
 * Time as an injected dependency.
 *
 * Financial-year boundaries, holding-period cutoffs (short- vs long-term capital
 * gains) and the terminal cash flow in an XIRR calculation all depend on "now".
 * A bare `new Date()` buried in a domain service makes every one of those
 * untestable, and makes a report's output depend on when it was run.
 */
export interface Clock {
  now(): Date;
  /** Today in the app's reporting timezone, as `YYYY-MM-DD`. */
  today(): string;
}

/** The timezone all reporting boundaries are computed in. */
export const REPORTING_TIME_ZONE = "Asia/Kolkata";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  today(): string {
    return SystemClock.toReportingDate(this.now());
  }

  /**
   * Formats an instant as a calendar date in {@link REPORTING_TIME_ZONE}.
   *
   * Using the timezone explicitly matters: a purchase made at 02:00 IST is
   * 20:30 the previous day in UTC, and booking it to the wrong date can move a
   * trade across a financial-year boundary.
   */
  static toReportingDate(instant: Date): string {
    // en-CA renders as YYYY-MM-DD, which is the format we store.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: REPORTING_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  }
}

/** Test double: a clock frozen at a chosen instant. */
export class FixedClock implements Clock {
  constructor(private instant: Date) {}

  now(): Date {
    return new Date(this.instant);
  }

  today(): string {
    return SystemClock.toReportingDate(this.instant);
  }

  advanceTo(instant: Date): void {
    this.instant = instant;
  }
}
