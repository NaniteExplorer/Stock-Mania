import { CalendarDate } from "@/core/time";
import { currentUserId, ensureSeeded, services } from "@/infra/container";

/**
 * The account list as a CSV.
 *
 * Amounts are written with `toDecimalString()` — the exact decimal, unformatted
 * and unlocalised. A spreadsheet reading `₹1,23,456.78` gets a string it cannot
 * add up, and the Indian digit grouping makes that failure especially quiet.
 *
 * Not cached: it is per-user data behind a session, and a stale export of
 * someone's balances is worse than a slow one.
 */
export async function GET(): Promise<Response> {
  const userId = await currentUserId();
  await ensureSeeded(userId);

  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const { banking, repositories } = services();

  const result = await banking.listCashPositions.execute({
    userId,
    asOf: today,
    includeClosed: true,
  });
  if (!result.ok) {
    return new Response(result.error.message, { status: 400 });
  }

  const GROUP_CODES = new Set(["Assets:Bank", "Assets:Cash", "Assets:Wallets"]);
  const positions = result.value.positions.filter(
    (position) => !GROUP_CODES.has(position.asset.account.code.toString()),
  );

  const header = [
    "Code",
    "Name",
    "Kind",
    "Institution",
    "Last four",
    "Currency",
    "Status",
    "Postings",
    `Balance as at ${today.toISO()}`,
  ];

  const lines = [header.map(csvCell).join(",")];
  for (const position of positions) {
    const account = position.asset.account;
    const postingCount = await repositories.accounts.countPostings(userId, account.id);
    lines.push(
      [
        account.code.toString(),
        position.asset.displayName,
        position.asset.kind,
        account.institution ?? "",
        account.accountNumberSuffix ?? "",
        position.asset.currency.code,
        account.isClosed ? "Closed" : "Open",
        String(postingCount),
        position.balance.toDecimalString(),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      // The BOM is what makes Excel read the file as UTF-8 rather than as the
      // system codepage, which is the difference between "Café" and "CafÃ©".
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="accounts-${today.toISO()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Quotes a cell.
 *
 * The leading apostrophe on a cell starting with `=`, `+`, `-` or `@` is CSV
 * injection defence: without it, a bank narration beginning `=` is executed as a
 * formula when the export is opened in Excel.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}
