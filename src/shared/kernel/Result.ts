import { AppError } from "@/shared/errors/AppError";

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
