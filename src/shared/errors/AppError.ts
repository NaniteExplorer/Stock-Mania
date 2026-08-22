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
