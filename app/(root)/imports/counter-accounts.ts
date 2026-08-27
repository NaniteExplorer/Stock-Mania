import type { AccountSubtype, AccountTypeName } from "@/domain/accounts";

/**
 * The counter-account kinds a transfer row can need, and where each one sits.
 *
 * A statement full of `UPI/.../IndMoney`, `CreditCard Payment XX 6439` and
 * self-transfers to another bank cannot be reviewed at all until those accounts
 * exist — and the review screen was a dead end for exactly that reason: the only
 * cash account the user had was the one being imported, so "the account this
 * money moved to" had no honest answer in the list.
 *
 * This lives in its own module rather than in `actions.ts` because that file is
 * `"use server"`, and such a file may export **async functions only**. Exporting
 * this table from there built and typechecked cleanly and then failed at page-data
 * collection with "can only export async functions, found object".
 */
export const COUNTER_ACCOUNT_KINDS = {
  BANK: { label: "Bank account", type: "ASSET", subtype: "BANK", parent: "Assets:Bank" },
  WALLET: { label: "Wallet", type: "ASSET", subtype: "WALLET", parent: "Assets:Wallets" },
  CASH: { label: "Cash", type: "ASSET", subtype: "CASH", parent: "Assets:Cash" },
  BROKERAGE: {
    label: "Investment account",
    type: "ASSET",
    subtype: "BROKERAGE",
    parent: "Assets:Investments",
  },
  CREDIT_CARD: {
    label: "Credit card",
    type: "LIABILITY",
    subtype: "CREDIT_CARD",
    parent: "Liabilities:Credit Cards",
  },
  LOAN: { label: "Loan", type: "LIABILITY", subtype: "LOAN", parent: "Liabilities:Loans" },
} as const satisfies Record<
  string,
  { label: string; type: AccountTypeName; subtype: AccountSubtype; parent: string }
>;

export type CounterAccountKind = keyof typeof COUNTER_ACCOUNT_KINDS;

/** The picker's options, so the client does not restate this table. */
export const counterAccountKinds: readonly { value: CounterAccountKind; label: string }[] =
  Object.entries(COUNTER_ACCOUNT_KINDS).map(([value, spec]) => ({
    value: value as CounterAccountKind,
    label: spec.label,
  }));

export const counterAccountKindNames = Object.keys(COUNTER_ACCOUNT_KINDS) as [
  CounterAccountKind,
  ...CounterAccountKind[],
];
