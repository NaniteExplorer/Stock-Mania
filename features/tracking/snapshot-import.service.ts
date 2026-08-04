import { normalize, num, splitDelimited, readGrid } from "@/features/imports/csv";
import { periodKeyOf, periodEnd } from "./period";
import { calculateMonthlyWealth, EMPTY_MONTHLY_WEALTH, toSnapshotBreakdown } from "./monthly-wealth";
import type { MonthlyWealthValues, SnapshotCsvRow } from "./tracking.types";

const FIELD_ALIASES: Record<keyof MonthlyWealthValues, readonly string[]> = {
  cash: ["cash"], indianStocks: ["indian stocks"], usStocks: ["us stocks"],
  cryptoCurrency: ["crypto currency", "cryptocurrency"], etfs: ["etfs", "etf"],
  reits: ["reits", "reit"], digitalGold: ["digital gold"],
  creditCardLoans: ["credit card loans", "credit card debt"], loans: ["loans", "loan"],
  sbiBank: ["sbi bank"], jioPaymentsBank: ["jio payments bank"], axisBank: ["axis bank"],
  mutualFunds: ["mutual funds", "mutual fund"], ppf: ["ppf"], rdFd: ["rd/fd", "rd fd"],
  nps: ["nps"], epfo: ["epfo", "epf"],
  equityCryptoPnl: ["equity and crypto losses/profit", "equity and crypto profit/loss"],
  lifeInsurance: ["life insurance"], healthInsurance: ["health insurance"],
};

function parseDate(cell: string): Date | null {
  const match = cell.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]), 12));
  const timestamp = Date.parse(cell.trim());
  if (Number.isNaN(timestamp)) return null;
  const date = new Date(timestamp);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
}

export function gridToSnapshotRows(grid: string[][]): SnapshotCsvRow[] {
  const headerIndex = grid.findIndex((row) => row.map(normalize).includes("month"));
  if (headerIndex < 0) throw new Error("Could not find a 'Month' column in the sheet.");
  const headers = grid[headerIndex].map(normalize);
  const monthColumn = headers.indexOf("month");
  const rows: SnapshotCsvRow[] = [];

  for (const raw of grid.slice(headerIndex + 1)) {
    const capturedAt = parseDate(raw[monthColumn] ?? "");
    if (!capturedAt) continue;
    const values = { ...EMPTY_MONTHLY_WEALTH };
    for (const [field, aliases] of Object.entries(FIELD_ALIASES) as Array<[keyof MonthlyWealthValues, readonly string[]]>) {
      const column = headers.findIndex((header) => aliases.includes(header));
      if (column >= 0) values[field] = num(raw[column]);
    }
    const metrics = calculateMonthlyWealth(values);
    const periodKey = periodKeyOf(capturedAt);
    rows.push({
      periodKey,
      capturedAt: periodEnd(periodKey),
      values,
      metrics,
      breakdown: toSnapshotBreakdown(values),
      totalAssets: metrics.inHand + metrics.midTerm + metrics.longTerm,
      totalLiabilities: Math.abs(metrics.totalDebts),
      netWorth: metrics.totalWorth,
    });
  }
  if (!rows.length) throw new Error("No dated rows found in the sheet.");
  return rows;
}

export async function parseSnapshotFile(file: File): Promise<SnapshotCsvRow[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") throw new Error("Export the sheet as CSV or XLSX before importing it.");
  const grid = ["csv", "tsv", "txt"].includes(extension || "")
    ? splitDelimited(await file.text())
    : await readGrid(file);
  return gridToSnapshotRows(grid);
}
