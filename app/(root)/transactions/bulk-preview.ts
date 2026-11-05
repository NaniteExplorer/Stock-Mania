import { Money } from "@/core/money";
import { signed } from "@/core/format";

/**
 * The register's row projection and the remove-all preview (DESIGN §7 item 2, §7.1).
 *
 * Shared by the page (rows, preview, preflight) and testable without a database: it
 * reads transactions through the small structural shape below, which the domain
 * `Transaction` already satisfies.
 */
export interface PreviewPosting {
  readonly accountId: { readonly value: string };
  readonly amount: Money;
  readonly isDebit: boolean;
  readonly isReconciled: boolean;
}

export interface PreviewTransaction {
  readonly id: { readonly value: string };
  readonly txnDate: { toISO(): string };
  readonly description: string;
  postings(): readonly PreviewPosting[];
}

/** What the projection needs to know about an account. */
export interface PreviewAccount {
  readonly name: string;
  readonly isBalanceSheet: boolean;
  readonly isIncomeStatement: boolean;
  readonly isAsset: boolean;
}

export type Direction = "IN" | "OUT" | "NEUTRAL";

export interface ProjectedRow {
  readonly id: string;
  readonly date: string;
  readonly description: string;
  /** The balance-sheet leg's account, which the row lives under. */
  readonly accountId: string;
  readonly account: string;
  readonly category: string;
  readonly money: Money;
  readonly direction: Direction;
  /** Any posting reconciled against a statement (L10): the row cannot be removed. */
  readonly reconciled: boolean;
  /** Every balance-sheet account whose balance this row moves. */
  readonly balanceAccounts: readonly string[];
}

/**
 * Each transaction's *balance-sheet* leg gives the account and the direction, and its
 * *income-statement* leg gives the category. Read that way, a transfer between two
 * accounts has no category and says so, rather than taking whichever account came first.
 */
export function projectTransaction(
  txn: PreviewTransaction,
  account: (id: string) => PreviewAccount | undefined,
): ProjectedRow {
  const postings = txn.postings();
  const balanceLeg = postings.find((posting) => account(posting.accountId.value)?.isBalanceSheet ?? false);
  const flowLeg = postings.find((posting) => account(posting.accountId.value)?.isIncomeStatement ?? false);
  const anchor = balanceLeg ?? postings[0];
  const anchorAccount = account(anchor.accountId.value);
  const direction: Direction =
    !balanceLeg || !flowLeg
      ? "NEUTRAL"
      : balanceLeg.isDebit === (anchorAccount?.isAsset ?? false)
        ? "IN"
        : "OUT";
  const balanceAccounts = [
    ...new Set(
      postings
        .filter((posting) => account(posting.accountId.value)?.isBalanceSheet)
        .map((posting) => account(posting.accountId.value)!.name),
    ),
  ];
  return {
    id: txn.id.value,
    date: txn.txnDate.toISO(),
    description: txn.description,
    accountId: anchor.accountId.value,
    account: anchorAccount?.name ?? "—",
    category: flowLeg ? (account(flowLeg.accountId.value)?.name ?? "—") : "Transfer",
    money: anchor.amount,
    direction,
    reconciled: postings.some((posting) => posting.isReconciled),
    balanceAccounts,
  };
}

/** A row that blocks a removal, named and linked to where it lives (§7.1). */
export interface BlockedRow {
  readonly id: string;
  readonly label: string;
  readonly href: string;
}

export interface RemovalPreview {
  /** One signed figure per currency, joined; "—" for an empty scope. */
  readonly net: string;
  readonly range: string;
  /** Balance-sheet accounts whose balance the removal changes, sorted. */
  readonly accounts: readonly string[];
  /** Reconciled rows in scope: when any exist, there is no confirmation to give (D1). */
  readonly protectedRows: readonly BlockedRow[];
}

export const rowLabel = (row: Pick<ProjectedRow, "date" | "description">) => `${row.date} · ${row.description}`;
export const rowHref = (row: Pick<ProjectedRow, "accountId">) => `/accounts/${row.accountId}`;

/**
 * Net is kept **per currency**. It used to start from an INR zero and add every row,
 * so a scope holding a USD account threw a currency mismatch (QA FAIL, 2026-11-03);
 * adding across currencies would need a rate, which a preview has no business choosing.
 */
export function netByCurrency(rows: readonly Pick<ProjectedRow, "money" | "direction">[]): Money[] {
  const totals = new Map<string, Money>();
  for (const row of rows) {
    const code = row.money.currency.code;
    const total = totals.get(code) ?? Money.zero(row.money.currency);
    if (row.direction === "IN") totals.set(code, total.plus(row.money));
    else if (row.direction === "OUT") totals.set(code, total.minus(row.money));
    else totals.set(code, total);
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, money]) => money);
}

export function buildRemovalPreview(rows: readonly ProjectedRow[]): RemovalPreview {
  if (rows.length === 0) return { net: "—", range: "—", accounts: [], protectedRows: [] };
  const dates = rows.map((row) => row.date).sort();
  const accounts = [...new Set(rows.flatMap((row) => row.balanceAccounts))].sort((a, b) => a.localeCompare(b));
  return {
    net: netByCurrency(rows).map((money) => signed(money)).join(" · "),
    range: `${dates[0]} – ${dates[dates.length - 1]}`,
    accounts,
    protectedRows: rows
      .filter((row) => row.reconciled)
      .map((row) => ({ id: row.id, label: rowLabel(row), href: rowHref(row) })),
  };
}
