/**
 * The one shape every mutating server action in the app returns.
 *
 * Actions used to be typed `Promise<void>` and simply `return`ed when their zod
 * parse failed — which meant a rejected edit was indistinguishable from a saved
 * one: the page revalidated, the form snapped back to the stored values, and the
 * user was told nothing. Every action now reports, and {@link ActionForm} turns
 * that report into a toast.
 */
export interface ActionState {
  ok: boolean;
  message: string;
  /** Per-field messages, keyed by input `name`, for inline display. */
  fieldErrors?: Record<string, string[]>;
}

export function ok(message: string): ActionState {
  return { ok: true, message };
}

export function fail(
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionState {
  return { ok: false, message, fieldErrors };
}
