/**
 * AI fallback categorizer: classifies the transactions the deterministic rules
 * engine left as `null`. Runs out-of-band (Inngest) so imports stay fast.
 * Manual overrides are never touched (see transactionService.applyAiCategory).
 */
import { z } from "zod";
import { geminiClient } from "@/core/ai/gemini";
import { logger } from "@/core/logger";
import { transactionService } from "./transaction.service";
import { TRANSACTION_CATEGORIES } from "./transaction.categories";

const assignmentsSchema = z.object({
  assignments: z.array(
    z.object({ id: z.string(), category: z.enum(TRANSACTION_CATEGORIES as [string, ...string[]]) }),
  ),
});

function buildPrompt(rows: { id: string; description: string; direction: string; amount: number }[]): string {
  return [
    "Classify each bank/credit-card transaction into exactly one category.",
    `Allowed categories: ${TRANSACTION_CATEGORIES.join(", ")}.`,
    "Guidance: DEBIT card/UPI purchases map to the matching spend category; salary/interest/dividend/refund = INCOME;",
    "moving money between own accounts or to family = SELF_TRANSFER; generic person-to-person/account transfers = TRANSFER;",
    "SIP/mutual-fund/stock/NPS/PPF = INVESTMENT; bank fees/charges = FEES_CHARGES; if unsure use MISCELLANEOUS.",
    'Return ONLY JSON: { "assignments": [ { "id": string, "category": string } ] }.',
    "",
    "TRANSACTIONS:",
    JSON.stringify(rows),
  ].join("\n");
}

export async function aiCategorizeAccount(
  userId: string,
  accountId: string,
): Promise<{ categorized: number }> {
  if (!geminiClient.isConfigured()) {
    logger.warn("AI categorization skipped — GEMINI_API_KEY not set.");
    return { categorized: 0 };
  }

  let categorized = 0;
  // Provider APIs commonly cap enrichment requests at 100 rows. Drain bounded
  // batches instead of processing only the first page forever. The no-progress
  // guard prevents malformed/partial model output from creating an endless loop.
  for (let batch = 0; batch < 50; batch += 1) {
    const rows = await transactionService.listUncategorized(userId, accountId, 100);
    if (!rows.length) break;

    const raw = await geminiClient.generateJson<unknown>(buildPrompt(rows));
    const parsed = assignmentsSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error("AI categorization output failed validation", parsed.error);
      break;
    }

    const valid = new Set(rows.map((r) => r.id));
    const assignments = parsed.data.assignments.filter(({ id }) => valid.has(id));
    if (!assignments.length) break;
    for (const { id, category } of assignments) {
      await transactionService.applyAiCategory(id, userId, category);
    }
    categorized += assignments.length;
    if (assignments.length < rows.length) break;
  }
  return { categorized };
}
