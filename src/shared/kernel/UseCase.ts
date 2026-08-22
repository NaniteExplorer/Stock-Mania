import type { AppError } from "@/shared/errors/AppError";
import type { Result } from "./Result";

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
