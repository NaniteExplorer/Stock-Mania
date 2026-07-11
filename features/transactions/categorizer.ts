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

/**
 * Bank narrations are identifiers rather than prose: separators, reference
 * numbers and repeated whitespace vary between institutions. Normalising them
 * before matching is the first (merchant-cleansing) stage used by transaction
 * enrichment pipelines and makes rules portable across statement formats.
 */
export const normalizeNarration = (value: string): string => value
  .normalize("NFKD")
  .toLowerCase()
  .replace(/\b(?:utr|rrn|ref(?:erence)?|txn|transaction)\s*(?:no|id)?\s*[:#-]?\s*[a-z0-9-]{6,}\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const has = (haystack: string, ...needles: string[]) => needles.some((needle) => {
  const normalized = normalizeNarration(needle);
  if (!normalized) return false;
  // Short tokens are matched as complete narration tokens. Longer markers may
  // intentionally be stems ("electr", "parkin") used across bank variants.
  return normalized.length <= 4
    ? (` ${haystack} `).includes(` ${normalized} `)
    : haystack.includes(normalized);
});

// Investment platforms / instruments — a debit here is money moving into savings
// or the markets, not spend. Checked before generic transfer/keyword rules.
const INVESTMENT_MARKERS = [
  "groww", "indstocks", "ind stocks", "indmoney", "ind money", "zerodha", "upstox", "kite",
  "coindcx", "coin dcx", "safegold", "safe gold", "iccl", "icicl", "nextbillion", "finzoom",
  "nsdl", "cdsl", "mutual fund", "sip", "elss", "nps", "ppf", "ippf", "axisppf", "epf",
  "smallcase", "paytm money", "kuvera", "etmoney", "et money", "mbb-rd", "mbb rd", "recurring dep", "-rd/",
];

// Credit-card bill payments / CRED / bill-desk — settling a card is not fresh
// spend (the spend was already on the card), so treat as a transfer.
const CARD_PAYMENT_MARKERS = [
  "creditcard payment", "credit card payment", "cred club", "cred store", "dreamplug",
  "sbi card", "bill desk", "billdesk", "cc payment", "card bill", "credit card(bill",
];

// Merchant / keyword map, evaluated after the structural rules below. Includes
// the short "purpose" tokens Indian UPI narrations carry (e.g. .../vegeta/...).
const KEYWORD_MAP: [TransactionCategory, string[]][] = [
  ["GROCERIES", ["bigbasket", "blinkit", "zepto", "grofers", "dmart", "reliance fresh", "supermarket", "kirana", "grocery", "grocer", "vegeta", "vegetable", "tomato", "onion", "potato", "ginger", "adrak", "coriand", "corian", "cabbag", "capcic", "banana", "guava", "fruit", "atta", "sugar", "dhaniy", "moong", "paneer", "butter", "milk", "eggs", "egg ", "meat", "prawn", "fish"]],
  ["FOOD", ["swiggy", "zomato", "dominos", "mcdonald", "starbucks", "kfc", "restaurant", "cafe", "eatery", "hotel", "bakery", "sweets", "sweet", "mishti", "dosa", "idli", "biryan", "biriyani", "snack", "chai", "tea ", "coffee", "mocha", "cold d", "cold m", "cold c", "colddr", "gupch", "chaat", "chast", "cake", "pastri", "pastry", "juice", "guguni", "chicke", "chicken", "mutton", "lunch", "dinner", "breakf", "break ", "pizza", "burger", "waffle", "browni", "khaja", "bara", "bhoga", "kurkur", "peanut", "thumbs", "pepsi", "soda", "drink", "water", "mineral", "cold m", "dahi", "guguni", "guchu", "snacks", "food"]],
  ["TRANSPORT", ["uber", "ola", "rapido", "irctc", "indian oil", "hpcl", "bharat petroleum", "bpbhubaneswar", "bp ", "fuel", "petrol", "diesel", "metro", "fastag", "toll", "auto", "bus fa", "bus ti", "bike r", "bike p", "bike t", "bike w", "car fa", "car re", "scooty", "activa", "cab", "taxi", "parkin", "railway", "railways", "train", "e ticket", "osrtc", "seat f", "service station"]],
  ["UTILITIES", ["electricity", "electr", "tpcodl", "bescom", "water bill", "gas bill", "broadband", "airtel", "jio recharge", "jio ", "vodafone", "vi ", "act fibernet", "recharge", "dth", "postpaid", "prepaid", "state tax"]],
  ["RENT", ["rent", "nobroker", "landlord", "lease", "floor", "pg rent"]],
  ["SHOPPING", ["amazon", "flipkart", "myntra", "ajio", "nykaa", "nyka", "meesho", "tatacliq", "zudio", "mall", "store", "cashify", "watch", "cosmetic", "cousmetic", "tooth", "slipper", "umbrella", "blanke", "cover", "camera", "speake", "mobile", "oppo", "print", "xerox", "statio", "notebo", "calend", "fashnear", "cred store"]],
  ["ENTERTAINMENT", ["netflix", "spotify", "hotstar", "prime video", "bookmyshow", "pvr", "inox", "youtube premium", "disney", "horror", "movie", "resort", "retreat"]],
  ["HEALTH", ["pharmacy", "apollo", "1mg", "pharmeasy", "hospital", "clinic", "diagnostic", "medical", "practo", "zandu", "vicks", "tablet", "medicine", "drug", "motion", "sabri"]],
  ["EDUCATION", ["udemy", "coursera", "unacademy", "byju", "school fee", "college", "tuition", "course", "kiit"]],
  ["FEES_CHARGES", ["charge", " fee", "gst", "penalty", "interest debit", "annual maintenance", "amc", "convenience fee", "mandate"]],
  ["INCOME", ["salary", "interest credit", "int.pd", "int pd", "dividend", "cashback", "refund", "reversal", "food claim", "claim"]],
];

const rules: CategoryRule[] = [
  // 1. Self / family transfer — highest priority so internal money movement is
  // never mistaken for spend.
  {
    name: "self-transfer",
    match(haystack, _input, ctx) {
      const payees = ctx.selfPayees.map((p) => p.trim().toLowerCase()).filter(Boolean);
      if (payees.some((p) => p.length >= 3 && haystack.includes(p))) return "SELF_TRANSFER";
      // Common "moving my own money" markers in the narration.
      return has(haystack, "/self t", "self transfer", "self loa", "/self ", "monthly self", "toward self")
        ? "SELF_TRANSFER"
        : null;
    },
  },
  // 2. Investments / savings vehicles (before transfer, since some arrive via NEFT/IMPS/UPI).
  {
    name: "investment",
    match(haystack, input) {
      if (input.direction !== "DEBIT") return null;
      return has(haystack, ...INVESTMENT_MARKERS) ? "INVESTMENT" : null;
    },
  },
  // 3. Credit-card bill settlement — a transfer, not new spend.
  {
    name: "card-payment",
    match(haystack) {
      return has(haystack, ...CARD_PAYMENT_MARKERS) ? "TRANSFER" : null;
    },
  },
  // 4. Explicit transfers. NEFT/RTGS/IMPS are payment rails, not transaction
  // intent, so the rail alone must never turn rent, salary or a purchase into a
  // transfer. Require language that actually describes an account movement.
  {
    name: "transfer-mode",
    match(haystack) {
      return has(haystack, "fund transfer", "fund trf", "a/c transfer", "account transfer", "inter account", "own account", "trfr to", "trf to r")
        ? "TRANSFER"
        : null;
    },
  },
  // 5. Cash withdrawal at ATM — real outflow, bucket as miscellaneous.
  {
    name: "atm-cash",
    match(haystack) {
      return has(haystack, "atm-cash", "atm cash", "cash-axis", "cash/", "cwdr") ? "MISCELLANEOUS" : null;
    },
  },
  // 6. Keyword/merchant map (groceries before food so "vegeta" wins over "food").
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
    const haystack = normalizeNarration(`${input.description} ${input.reference ?? ""}`);
    for (const rule of rules) {
      const result = rule.match(haystack, input, ctx);
      if (result) return result;
    }
    return null;
  }
}

export const transactionCategorizer = new TransactionCategorizer();
