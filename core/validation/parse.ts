/**
 * Small helper around zod for Server Actions. Validates untrusted input coming
 * from the client and returns either the parsed (and narrowed) value or a single
 * user-facing error message — never throws.
 */
import type { ZodType } from "zod";

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export function parseInput<T>(schema: ZodType<T>, input: unknown): ParseResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const first = result.error.issues[0];
  return {
    success: false,
    error: first?.message ?? "Invalid input.",
  };
}
