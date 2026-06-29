/**
 * Deterministic, free, privacy-preserving transaction categorizer.
 *
 * Runs an ordered list of rules; the first match wins. Whatever it can't
 * classify is left null for the async AI fallback (Inngest) to handle.
 * Self/family transfers are detected against a user-maintained payee list so
 * "moving my own money" is never counted as spend.
 */
import type { TransactionCategory } from "./transaction.categories";
import type { TransactionDirection } from "./transaction.types";

export interface CategorizerInput {
  description: string;
  reference: string | null;
  direction: TransactionDirection;
}

export interface CategorizerContext {
  /** Account numbers, UPI handles, or names that represent the user/their family. */
  selfPayees: string[];
}

interface CategoryRule {
  readonly name: string;
  match(haystack: string, input: CategorizerInput, ctx: CategorizerContext): TransactionCategory | null;
}

const has = (haystack: string, ...needles: string[]) => needles.some((n) => haystack.includes(n));

// Merchant / keyword map, evaluated after the structural rules below.
const KEYWORD_MAP: [TransactionCategory, string[]][] = [
  ["FOOD", ["swiggy", "zomato", "dominos", "mcdonald", "starbucks", "kfc", "restaurant", "cafe", "eatery", "food"]],
  ["GROCERIES", ["bigbasket", "blinkit", "zepto", "grofers", "dmart", "reliance fresh", "supermarket", "kirana", "grocery"]],
  ["TRANSPORT", ["uber", "ola", "rapido", "irctc", "indian oil", "hpcl", "bharat petroleum", "fuel", "petrol", "metro", "fastag", "toll"]],
  ["UTILITIES", ["electricity", "bescom", "water bill", "gas bill", "broadband", "airtel", "jio", "vodafone", "vi ", "act fibernet", "recharge", "dth"]],
  ["RENT", ["rent", "nobroker", "landlord", "lease"]],
  ["SHOPPING", ["amazon", "flipkart", "myntra", "ajio", "nykaa", "meesho", "tatacliq", "mall", "store"]],
  ["ENTERTAINMENT", ["netflix", "spotify", "hotstar", "prime video", "bookmyshow", "pvr", "inox", "youtube premium", "disney"]],
  ["HEALTH", ["pharmacy", "apollo", "1mg", "pharmeasy", "hospital", "clinic", "diagnostic", "medical", "practo"]],
  ["EDUCATION", ["udemy", "coursera", "unacademy", "byju", "school fee", "college", "tuition", "course"]],
  ["INVESTMENT", ["zerodha", "groww", "indmoney", "ind money", "upstox", "mutual fund", "sip", "nps", "ppf", "fd ", "rd ", "elss"]],
  ["FEES_CHARGES", ["charge", "fee", "gst", "penalty", "interest debit", "annual maintenance", "amc", "convenience fee"]],
  ["INCOME", ["salary", "interest credit", "dividend", "cashback", "refund", "reversal"]],
];

const rules: CategoryRule[] = [
  // 1. Self / family transfer — highest priority so internal money movement is
  // never mistaken for spend.
  {
    name: "self-transfer",
    match(haystack, _input, ctx) {
      const payees = ctx.selfPayees.map((p) => p.trim().toLowerCase()).filter(Boolean);
      return payees.some((p) => p.length >= 3 && haystack.includes(p)) ? "SELF_TRANSFER" : null;
    },
  },
  // 2. Explicit inter-account transfers (NEFT/RTGS/IMPS / "fund transfer").
  {
    name: "transfer-mode",
    match(haystack) {
      return has(haystack, "neft", "rtgs", "imps", "fund transfer", "fund trf", "self transfer", "a/c transfer", "account transfer")
        ? "TRANSFER"
        : null;
    },
  },
  // 3. Keyword/merchant map.
  {
    name: "keyword",
    match(haystack, input) {
      for (const [category, needles] of KEYWORD_MAP) {
        // INCOME keywords only make sense for credits.
        if (category === "INCOME" && input.direction !== "CREDIT") continue;
        if (has(haystack, ...needles)) return category;
      }
      return null;
    },
  },
];

export class TransactionCategorizer {
  categorize(input: CategorizerInput, ctx: CategorizerContext): TransactionCategory | null {
    const haystack = `${input.description} ${input.reference ?? ""}`.toLowerCase();
    for (const rule of rules) {
      const result = rule.match(haystack, input, ctx);
      if (result) return result;
    }
    return null;
  }
}

export const transactionCategorizer = new TransactionCategorizer();
