/**
 * One-time backfill of the monthly net-worth spreadsheet into snapshot history.
 *
 * The sheet has one row per month with columns for each asset/liability bucket
 * (Cash, Indian/US Stocks, Crypto, ETFs, REITS, Digital Gold, bank balances,
 * Mutual Funds, PPF, RD/FD, NPS, EPFO, loans, credit-card) plus authoritative
 * Net Worth / Total Worth totals. We map columns to snapshot breakdown buckets,
 * preferring the sheet's own Net Worth column when present.
 */
import { normalize, num, splitDelimited, readGrid } from "@/features/imports/csv";
import { periodKeyOf, periodEnd } from "./period";
import type { SnapshotBreakdown, SnapshotCsvRow } from "./tracking.types";

// Column aliases → which breakdown bucket the column contributes to.
const ASSET_COLUMNS = {
  accounts: ["cash", "sbi bank", "jio payments bank", "axis bank", "ppf", "rd/fd", "rd fd", "nps", "epfo", "bank"],
  investments: ["indian stocks", "us stocks", "crypto currency", "cryptocurrency", "etfs", "reits", "digital gold", "mutual funds"],
} as const;

const LIABILITY_COLUMNS = {
  creditCard: ["credit card loans", "credit card"],
  loans: ["loans"],
} as const;

// Derived / summary columns that must never be summed into a bucket even if they
// share a substring with an alias (e.g. "...Crypto Losses/Profit" contains "crypto").
const EXCLUDE_SUBSTRINGS = [
  "profit", "loss", "liquid", "term", "total", "worth", "insurance", "debts",
];

const MONTH_ALIASES = ["month", "date"];

const EMPTY_BREAKDOWN: SnapshotBreakdown = {
  accounts: 0,
  investments: 0,
  brokerage: 0,
  esops: 0,
  assets: 0,
  liabilities: 0,
  creditCard: 0,
};

/** Match a header to the FIRST alias that is a substring — order-independent. */
function columnMatches(header: string, aliases: readonly string[]): boolean {
  return aliases.some((alias) => header === alias || header.includes(alias));
}

/**
 * Parse M/D/YYYY or ISO-ish month cells to a UTC-noon Date; null when
 * unparseable. We rebuild from the parsed date's LOCAL components at UTC noon so
 * periodKeyOf (which reads UTC month) can never slip to an adjacent month for
 * first-of-month dates on machines in a positive/negative timezone.
 */
function parseMonth(cell: string): Date | null {
  const value = cell.trim();
  if (!value) return null;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return null;
  const d = new Date(ts);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12));
}

/** Turn a raw grid into snapshot rows. Throws if no Month column is found. */
export function gridToSnapshotRows(grid: string[][]): SnapshotCsvRow[] {
  const headerIndex = grid.findIndex((row) =>
    row.map(normalize).some((cell) => MONTH_ALIASES.some((alias) => cell === alias || cell.includes(alias))),
  );
  if (headerIndex < 0) throw new Error("Could not find a 'Month' column in the sheet.");

  const headers = grid[headerIndex].map(normalize);
  const monthCol = headers.findIndex((h) => MONTH_ALIASES.some((a) => h === a || h.includes(a)));

  const rows: SnapshotCsvRow[] = [];
  for (const raw of grid.slice(headerIndex + 1)) {
    const capturedAtRaw = parseMonth(raw[monthCol] ?? "");
    if (!capturedAtRaw) continue;

    const breakdown: SnapshotBreakdown = { ...EMPTY_BREAKDOWN };
    for (let i = 0; i < headers.length; i += 1) {
      const header = headers[i];
      if (!header || i === monthCol) continue;
      // Skip derived/summary columns (Net Worth, Total Worth, profit/loss, etc.)
      // so only real asset/liability line items are summed.
      if (EXCLUDE_SUBSTRINGS.some((s) => header.includes(s))) continue;
      const value = num(raw[i]);
      if (value === 0) continue;
      if (columnMatches(header, ASSET_COLUMNS.accounts)) breakdown.accounts += value;
      else if (columnMatches(header, ASSET_COLUMNS.investments)) breakdown.investments += value;
      else if (columnMatches(header, LIABILITY_COLUMNS.creditCard)) breakdown.creditCard += value;
      else if (columnMatches(header, LIABILITY_COLUMNS.loans)) breakdown.liabilities += value;
    }

    const totalAssets = breakdown.accounts + breakdown.investments + breakdown.brokerage + breakdown.esops + breakdown.assets;
    const totalLiabilities = breakdown.liabilities + breakdown.creditCard;
    // Net worth = all assets − all liabilities (the app's definition, which
    // matches the sheet's "Total Worth" column). The sheet's narrower "Net Worth"
    // column (which excludes long-term holdings) is a personal view we don't model.
    const netWorth = totalAssets - totalLiabilities;

    const periodKey = periodKeyOf(capturedAtRaw);
    rows.push({
      periodKey,
      // Normalize to end-of-month so intra-month ordering is deterministic.
      capturedAt: periodEnd(periodKey),
      breakdown,
      totalAssets,
      totalLiabilities,
      netWorth,
    });
  }

  if (!rows.length) throw new Error("No dated rows found in the sheet.");
  return rows;
}

/** Parse an uploaded backfill file (CSV/TSV/XLSX) into snapshot rows. */
export async function parseSnapshotFile(file: File): Promise<SnapshotCsvRow[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const grid = extension === "pdf"
    ? (() => { throw new Error("PDF backfill is not supported — export the sheet as CSV or XLSX."); })()
    : ["csv", "tsv", "txt"].includes(extension || "")
      ? splitDelimited(await file.text())
      : await readGrid(file);
  return gridToSnapshotRows(grid);
}
