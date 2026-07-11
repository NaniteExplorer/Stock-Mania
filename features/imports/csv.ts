/**
 * Shared, dependency-free CSV/spreadsheet parsing primitives used by the
 * holdings importer and the net-worth snapshot backfill. Kept pure so both
 * importers detect delimiters and normalize headers identically.
 */

/** Lowercase, collapse separators/whitespace — for header/alias matching. */
export const normalize = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

/** Parse a money-ish cell to a non-negative number (strips currency symbols/commas). */
export const num = (value: unknown): number => {
  const cleaned = String(value ?? "").replace(/[₹$€£,\s]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
};

/** Find the first header column matching any alias (exact or substring). */
export function findColumn(headers: string[], aliases: readonly string[]) {
  return headers.findIndex(
    (header) => aliases.includes(header) || aliases.some((alias) => header.includes(alias)),
  );
}

/** Split delimited text into a row/cell grid, auto-detecting the delimiter. */
export function splitDelimited(text: string): string[][] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  const sample = lines.slice(0, 10).join("\n");
  const delimiter = [",", "\t", ";", "|"].sort(
    (a, b) => sample.split(b).length - sample.split(a).length,
  )[0];
  return lines.map((line) => line.split(delimiter).map((cell) => cell.replace(/^"|"$/g, "").trim()));
}

/** Read a CSV/TSV/TXT or XLSX file into a raw string grid. */
export async function readGrid(file: File): Promise<string[][]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (["csv", "tsv", "txt"].includes(extension || "")) {
    return splitDelimited(await file.text());
  }
  if (["xlsx", "xls"].includes(extension || "")) {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    const rows: string[][] = [];
    sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1).map((cell) => String(cell ?? ""))));
    return rows;
  }
  throw new Error("Supported files: CSV, TSV and XLSX.");
}
