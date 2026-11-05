import type { TableRow, VerbAvailability } from "../../../components/ui/table-keyboard";

/**
 * The register's side of the DESIGN §6.1 keyboard model (task 2.8.b). Pure, so the
 * routing of every destructive key is tested without a DOM or a server.
 *
 * The register has exactly two mutation paths: the §7.1 filter-scoped removal and its
 * undo. The keys route only to those. A verb this screen has no path for is refused with
 * a reason naming the way that does work; it never pretends.
 */

/** The fields of a register row the keyboard reads. */
export interface RegisterKeyRow {
  readonly id: string;
  readonly date: string;
  readonly description: string;
  /** The account screen the row lives on; `Enter` opens it. */
  readonly href: string | null;
  /** Any posting reconciled against a statement (L10). */
  readonly reconciled: boolean;
}

/** Refusals this screen adds to the model's own (`TABLE_REFUSALS`). */
export const REGISTER_REFUSALS = Object.freeze({
  /** `Del` on less than the whole filtered view: there is no per-row removal here. */
  removeByFilter: "Del removes the cursor row, or a whole filter: filter to the rows, Ctrl+A, then Del. A partial selection is not removed",
  /** `E`: the register has no edit flow; the row's account does. */
  editOnAccount: "Edit from the row's account: Enter opens it",
  /** `Del` while the page-local text filter hides rows the §7.1 scope would still remove. */
  clearPageFilter: "Clear “Filter this page” first: Del removes the whole filter, including rows it hides",
});

/**
 * The L10 posting status carries no statement date, so the refusal cannot say "to 30 Sep";
 * it says what is true. Reads "Reconciled to its statement — unreconcile first".
 */
export const RECONCILED_THROUGH = "its statement";

export function registerTableRows(rows: readonly RegisterKeyRow[]): TableRow[] {
  return rows.map((row) => ({
    id: row.id,
    label: `${row.date} · ${row.description}`,
    mutationClass: "A",
    reconciledThrough: row.reconciled ? RECONCILED_THROUGH : undefined,
    hasDetail: row.href !== null,
  }));
}

export type RemoveRoute =
  | { readonly kind: "dialog" }
  | { readonly kind: "single"; readonly id: string }
  | { readonly kind: "refuse"; readonly reason: string };

/**
 * Where `Del` goes once the model has accepted it (no class C, no reconciled row).
 *
 * Only a selection that covers every visible row, with nothing hidden by the page-local
 * text filter, opens the §7.1 dialog: that dialog removes the *filter scope*, so the
 * selection must already be that scope. The dialog then refuses an unfiltered table
 * (§7 item 6) and protected rows (D1) on its own.
 *
 * Batch 5: with no selection, `Del` on the cursor row opens the same confirm dialog
 * scoped to that one row (`removeTransactionAction`, the bulk path with a one-id scope).
 * The model has already refused a class C or reconciled cursor row.
 */
export function removeRoute(input: {
  readonly ids: readonly string[];
  readonly selectedCount: number;
  readonly visibleCount: number;
  readonly pageFilterActive: boolean;
}): RemoveRoute {
  if (input.selectedCount === 0 && input.ids.length === 1) return { kind: "single", id: input.ids[0] };
  const wholeView = input.selectedCount > 0 && input.ids.length === input.visibleCount;
  if (!wholeView) return { kind: "refuse", reason: REGISTER_REFUSALS.removeByFilter };
  if (input.pageFilterActive) return { kind: "refuse", reason: REGISTER_REFUSALS.clearPageFilter };
  return { kind: "dialog" };
}

/** `Ctrl+Z`: the removal the §7 item 5 banner holds, else nothing (the model's fallback text). */
export function registerUndo(banner: { readonly requestId: string } | null): VerbAvailability {
  return banner ? { available: true } : { available: false, reason: "" };
}

/** `Ctrl+Y`: this screen has no redo action, so there is nothing to redo here. */
export const REGISTER_REDO: VerbAvailability = Object.freeze({ available: false, reason: "" });
