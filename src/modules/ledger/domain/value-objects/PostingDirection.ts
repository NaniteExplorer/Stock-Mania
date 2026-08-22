/**
 * Which side of the entry a posting sits on.
 *
 * A posting's amount is always positive and its side carries the meaning. The
 * alternative — a signed amount — makes "-500 on Groceries" ambiguous between a
 * refund and a correction, and lets a typo flip a debit into a credit without
 * failing any check.
 */
export type PostingDirection = "DEBIT" | "CREDIT";

export function oppositeOf(direction: PostingDirection): PostingDirection {
  return direction === "DEBIT" ? "CREDIT" : "DEBIT";
}
