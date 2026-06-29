/**
 * Server-only PDF text extraction for bank/credit-card statements.
 *
 * pdfjs gives us positioned text items; we group them into visual lines by
 * Y-coordinate and order by X so the downstream AI sees the statement roughly
 * as a human would read it. Supports password-protected PDFs.
 *
 * This module must never be imported into a Client Component — it is pulled in
 * only from the "use server" statement action.
 */
import { logger } from "@/core/logger";

const MAX_PAGES = 40;
const Y_TOLERANCE = 3; // points; items within this Y delta belong to one line

export class PdfPasswordError extends Error {
  constructor() {
    super("This PDF is password protected. Enter the password and try again.");
    this.name = "PdfPasswordError";
  }
}

interface TextItem {
  str: string;
  transform: number[]; // [a,b,c,d,e,f] — e = x, f = y
}

/**
 * Extract the statement text as newline-separated visual lines.
 * @throws PdfPasswordError when the document needs a password we don't have.
 */
export async function extractPdfText(
  data: Uint8Array,
  password?: string,
): Promise<string> {
  // Dynamic import keeps pdfjs out of the client bundle and off the build's
  // critical path; the legacy build runs in Node without a worker.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  let doc;
  try {
    doc = await pdfjs.getDocument({
      data,
      password: password || undefined,
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "PasswordException") throw new PdfPasswordError();
    logger.error("PDF open failed", err);
    throw new Error("This file could not be read as a PDF.");
  }

  const pageCount = Math.min(doc.numPages, MAX_PAGES);
  const lines: string[] = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items as TextItem[];

    // Bucket items into lines by rounded Y, then sort each line left-to-right.
    const byLine = new Map<number, TextItem[]>();
    for (const item of items) {
      if (!item.str.trim()) continue;
      const y = Math.round(item.transform[5] / Y_TOLERANCE);
      const bucket = byLine.get(y) ?? [];
      bucket.push(item);
      byLine.set(y, bucket);
    }

    // Higher Y = higher on the page, so sort descending.
    const sortedYs = [...byLine.keys()].sort((a, b) => b - a);
    for (const y of sortedYs) {
      const lineItems = byLine.get(y)!.sort((a, b) => a.transform[4] - b.transform[4]);
      const line = lineItems.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
      if (line) lines.push(line);
    }
  }

  await doc.cleanup();
  const text = lines.join("\n");
  if (!text.trim()) throw new Error("No readable text was found in this PDF.");
  return text;
}
