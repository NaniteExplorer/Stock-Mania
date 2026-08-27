/**
 * Banking policy: what a statement row *means*.
 *
 * Four decisions live here, and all four are pure functions of their inputs —
 * no clock, no database, no network. That is deliberate and it is the property
 * the plan asks to be tested: "the same statement re-imported next month
 * categorises identically" is only provable if nothing about *when* it runs can
 * change the answer.
 *
 *   1. {@link normalizeNarration} — bank narrations are identifiers, not prose.
 *   2. {@link Categoriser} — keyword rules, never AI. Explicitly.
 *   3. {@link DuplicateMatcher} — Actual's three-pass reconciler, ported.
 *   4. {@link BudgetLedger} — Actual's four envelope formulas, exactly.
 *
 * Parsing lives in `infra/statements.ts` (file formats); orchestration and
 * persistence live in `app/banking.usecases.ts`. This file is the middle: the
 * part with the opinions, kept testable without a database.
 */

import { UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { AccountCode, AccountId } from "@/domain/accounts";

/* ═══ Narration normalisation ═════════════════════════════════════════ */

/**
 * Reduces a bank narration to comparable tokens.
 *
 * Ported from v1 unchanged, because it is right: `UPI/DR/402938471/ZEPTO/HDFC` and
 * `UPI-ZEPTO-INDIA-402938999` are the same merchant, and the reference numbers are
 * exactly what makes them look different. Stripping the reference *before*
 * matching is what makes a keyword rule portable across banks — and it is why the
 * matcher and the categoriser must both use this function rather than each
 * normalising its own way.
 */
export function normalizeNarration(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\b(?:utr|rrn|ref(?:erence)?|txn|transaction)\s*(?:no|id)?\s*[:#-]?\s*[a-z0-9-]{6,}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a normalised needle occurs in a normalised haystack.
 *
 * Short needles are matched as whole tokens and longer ones as substrings. That
 * asymmetry is load-bearing: `"rd"` (recurring deposit) as a substring matches
 * "hardware", while `"electr"` as a whole token matches nothing — banks spell it
 * `electricity`, `electrcty` and `ELECTR` in the same file.
 */
export function narrationHas(haystack: string, ...needles: readonly string[]): boolean {
  return needles.some((needle) => {
    const normalised = normalizeNarration(needle);
    if (normalised === "") return false;
    return normalised.length <= 4
      ? ` ${haystack} `.includes(` ${normalised} `)
      : haystack.includes(normalised);
  });
}

/* ═══ Categorisation ══════════════════════════════════════════════════ */

export type MatchType = "CONTAINS" | "STARTS_WITH" | "EXACT" | "REGEX";
export type RuleScope = "ANY" | "DEBIT" | "CREDIT";
export type RowDirection = "DEBIT" | "CREDIT";

/**
 * What the categoriser decided *about the shape of the movement*, separate from
 * which account it lands in.
 *
 * `TRANSFER` is the one that matters: money moving to the user's own account, or a
 * credit-card bill being paid, is not spending, and counting it as spending is the
 * single most common way a personal-finance app reports a wrong monthly total.
 */
export type MovementIntent = "SPEND" | "RECEIPT" | "TRANSFER" | "INVESTMENT";

export type CategorySource = "USER_RULE" | "SELF_PAYEE" | "STRUCTURAL" | "BUILT_IN" | "FALLBACK";

/** A user-maintained rule, as stored in `category_rules`. */
export interface KeywordRule {
  readonly id: string;
  readonly pattern: string;
  readonly matchType: MatchType;
  /** The INCOME or EXPENSE account a match posts to. */
  readonly accountId: AccountId;
  readonly appliesTo: RuleScope;
  readonly priority: number;
  readonly isEnabled: boolean;
}

export interface CategorisationInput {
  readonly description: string;
  readonly reference: string | null;
  readonly direction: RowDirection;
}

export interface Categorisation {
  readonly intent: MovementIntent;
  readonly source: CategorySource;
  /** Null when the intent is `TRANSFER` (the other side is an account, not a category). */
  readonly accountId: AccountId | null;
  /** Which rule fired, so a wrong category is traceable to the rule that caused it. */
  readonly ruleId: string | null;
  /** Human-readable reason, shown on the import review screen. */
  readonly because: string;
}

/**
 * Built-in keyword defaults, keyed by account **code** rather than by an id.
 *
 * Codes, because these are shipped constants and ids are per user. Resolution is
 * best-effort: a user who renamed or closed `Expenses:Food:Groceries` simply loses
 * the built-in grocery rule rather than having the import fail, and their own
 * rules are unaffected.
 *
 * Carried over from v1's `KEYWORD_MAP`, including the short Indian-UPI purpose
 * tokens (`vegeta`, `guguni`, `cwdr`) that look like noise and are not: they are
 * what the narration actually contains.
 */
export const BUILT_IN_KEYWORDS: readonly { code: string; scope: RuleScope; keywords: readonly string[] }[] = [
  {
    code: "Expenses:Food:Groceries",
    scope: "DEBIT",
    keywords: ["bigbasket", "blinkit", "zepto", "grofers", "dmart", "reliance fresh", "supermarket", "kirana", "grocery", "grocer", "vegeta", "vegetable", "tomato", "onion", "potato", "ginger", "adrak", "coriand", "corian", "cabbag", "capcic", "banana", "guava", "fruit", "atta", "sugar", "dhaniy", "moong", "paneer", "butter", "milk", "eggs", "meat", "prawn", "fish"],
  },
  {
    code: "Expenses:Food:Eating Out",
    scope: "DEBIT",
    keywords: ["swiggy", "zomato", "dominos", "mcdonald", "starbucks", "kfc", "restaurant", "cafe", "eatery", "bakery", "sweets", "mishti", "dosa", "idli", "biryan", "biriyani", "snack", "snacks", "chai", "coffee", "mocha", "gupch", "chaat", "cake", "pastri", "pastry", "juice", "chicken", "mutton", "lunch", "dinner", "breakf", "pizza", "burger", "waffle", "browni", "khaja", "bhoga", "kurkur", "peanut", "thumbs", "pepsi", "soda", "drink", "mineral", "dahi", "guguni", "food"],
  },
  {
    code: "Expenses:Transport:Fuel",
    scope: "DEBIT",
    keywords: ["indian oil", "hpcl", "bharat petroleum", "fuel", "petrol", "diesel", "service station"],
  },
  {
    code: "Expenses:Transport:Cabs",
    scope: "DEBIT",
    keywords: ["uber", "ola", "rapido", "cab", "taxi", "auto"],
  },
  {
    code: "Expenses:Transport:Public",
    scope: "DEBIT",
    keywords: ["irctc", "metro", "railway", "railways", "train", "e ticket", "osrtc", "bus fa", "bus ti"],
  },
  {
    code: "Expenses:Transport:Vehicle",
    scope: "DEBIT",
    keywords: ["fastag", "toll", "parkin", "scooty", "activa", "bike r", "bike p", "bike t", "bike w", "car fa", "car re"],
  },
  {
    code: "Expenses:Utilities:Electricity",
    scope: "DEBIT",
    keywords: ["electricity", "electr", "tpcodl", "bescom"],
  },
  {
    code: "Expenses:Utilities:Gas",
    scope: "DEBIT",
    keywords: ["gas cylinder", "hp gas", "indane", "bharatgas", "bharat gas", "lpg", "gas bill"],
  },
  { code: "Expenses:Utilities:Water", scope: "DEBIT", keywords: ["water bill"] },
  {
    code: "Expenses:Utilities:Internet",
    scope: "DEBIT",
    keywords: ["broadband", "act fibernet", "wifi", "internet bill", "bsnl"],
  },
  {
    code: "Expenses:Utilities:Mobile",
    scope: "DEBIT",
    keywords: ["jio recharge", "airtel", "vodafone", "recharge", "postpaid", "prepaid", "mobile recharge", "mobile bill", "phone bill", "dth", "tata play", "tataplay", "d2h", "sun direct"],
  },
  {
    code: "Expenses:Housing:Rent",
    scope: "DEBIT",
    keywords: ["rent", "nobroker", "landlord", "lease", "pg rent"],
  },
  {
    code: "Expenses:Housing:Maintenance",
    scope: "DEBIT",
    keywords: ["society maint", "maintenance society", "municipal", "property tax", "bbps", "bharat billpay", "billpay"],
  },
  {
    code: "Expenses:Household Help",
    scope: "DEBIT",
    keywords: ["maid", "housemaid", "house help", "domestic help", "cook salary", "dhobi", "laundry", "iron cloth", "urban company", "urbanclap"],
  },
  {
    code: "Expenses:Shopping",
    scope: "DEBIT",
    keywords: ["amazon", "flipkart", "myntra", "ajio", "nykaa", "nyka", "meesho", "tatacliq", "zudio", "mall", "cashify", "cosmetic", "slipper", "umbrella", "blanke", "print", "xerox", "statio", "notebo", "fashnear", "cred store"],
  },
  {
    code: "Expenses:Shopping:Electronics",
    scope: "DEBIT",
    keywords: ["camera", "speake", "oppo", "mobile phone"],
  },
  {
    code: "Expenses:Shopping:Home",
    scope: "DEBIT",
    keywords: ["furniture", "mattress", "utensil", "bartan", "bucket", "detergent", "surf excel", "harpic", "lizol", "phenyl", "broom", "cleaning", "pest control", "plumber", "electrician", "carpenter", "home need", "homeneed", "household"],
  },
  {
    code: "Expenses:Entertainment:Subscriptions",
    scope: "DEBIT",
    keywords: ["netflix", "spotify", "hotstar", "prime video", "youtube premium", "disney"],
  },
  {
    code: "Expenses:Entertainment",
    scope: "DEBIT",
    keywords: ["bookmyshow", "pvr", "inox", "movie", "resort", "retreat"],
  },
  {
    code: "Expenses:Health:Medical",
    scope: "DEBIT",
    keywords: ["pharmacy", "apollo", "1mg", "pharmeasy", "hospital", "clinic", "diagnostic", "medical", "practo", "medicine", "tablet"],
  },
  { code: "Expenses:Health:Fitness", scope: "DEBIT", keywords: ["gym", "fitness", "cult fit", "cultfit"] },
  {
    code: "Expenses:Education",
    scope: "DEBIT",
    keywords: ["udemy", "coursera", "unacademy", "byju", "school fee", "college", "tuition", "course", "kiit"],
  },
  { code: "Expenses:Personal", scope: "DEBIT", keywords: ["salon", "soap", "shampoo", "tooth"] },
  { code: "Expenses:Insurance", scope: "DEBIT", keywords: ["insurance", "policy premium", "lic ", "premium paid"] },
  {
    code: "Expenses:Fees:Bank",
    scope: "DEBIT",
    keywords: ["annual maintenance", "convenience fee", "mandate", "penalty", "charge", "amc"],
  },
  { code: "Expenses:Fees:Interest", scope: "DEBIT", keywords: ["interest debit", "finance charge"] },
  { code: "Expenses:Taxes:Income Tax", scope: "DEBIT", keywords: ["income tax", "tds", "advance tax"] },
  { code: "Income:Salary", scope: "CREDIT", keywords: ["salary", "sal cr", "payroll"] },
  {
    code: "Income:Investing:Interest",
    scope: "CREDIT",
    keywords: ["interest credit", "int pd", "int.pd", "interest earned"],
  },
  { code: "Income:Investing:Dividends", scope: "CREDIT", keywords: ["dividend", "div payout"] },
  { code: "Income:Refunds", scope: "CREDIT", keywords: ["cashback", "refund", "reversal", "food claim", "claim"] },
];

/**
 * Structural markers: narrations that describe the *kind* of movement rather than
 * a merchant, and therefore decide the intent before any keyword is consulted.
 */
const INVESTMENT_MARKERS = [
  "groww", "indstocks", "ind stocks", "indmoney", "ind money", "zerodha", "upstox", "kite",
  "coindcx", "coin dcx", "safegold", "safe gold", "iccl", "icicl", "nextbillion", "finzoom",
  "nsdl", "cdsl", "mutual fund", "sip", "elss", "nps", "ppf", "ippf", "axisppf", "epf",
  "smallcase", "paytm money", "kuvera", "etmoney", "et money", "mbb rd", "recurring dep",
];

const CARD_PAYMENT_MARKERS = [
  "creditcard payment", "credit card payment", "cred club", "dreamplug", "sbi card",
  "bill desk", "billdesk", "cc payment", "card bill",
];

const TRANSFER_MARKERS = [
  "fund transfer", "fund trf", "a c transfer", "account transfer", "inter account",
  "own account", "trfr to", "trf to r",
];

const SELF_MARKERS = ["self transfer", "self loa", "monthly self", "toward self", "self t"];

export interface CategoriserContext {
  /** The user's rules, in any order — the categoriser sorts them itself. */
  readonly rules: readonly KeywordRule[];
  /** Account numbers, UPI handles or names belonging to the user or their family. */
  readonly selfPayees: readonly string[];
  /** `code → id` for the user's chart, used to resolve the built-in defaults. */
  readonly accountIdByCode: ReadonlyMap<string, AccountId>;
  /** Where an unmatched debit and credit go — `Expenses:Uncategorized` and friends. */
  readonly fallbackExpenseId: AccountId | null;
  readonly fallbackIncomeId: AccountId | null;
  /**
   * Where a card payment and a platform investment go when the narration does not
   * name the account.
   *
   * Their absence was the whole of a real dead end. The categoriser would
   * correctly read 41 rows as credit-card bill payments and 46 as money into an
   * investment platform, then return every one with `accountId: null` — 96 rows to
   * place by hand in an app whose chart already ships exactly one obvious
   * destination for each. Spending and income have had a fallback since Phase 2;
   * these two not having one was an asymmetry rather than a policy.
   *
   * Deliberately only these two. A card payment means the card, and money into a
   * platform means the investments account — both are the account, not a guess at
   * it. A *self transfer* is different: `SmartReviewImport` can often read the real
   * destination out of the narration ("NEFT to SBI Savings"), and a default here
   * would pre-empt that with something worse. So those stay null on purpose.
   */
  readonly fallbackCardId: AccountId | null;
  readonly fallbackInvestmentId: AccountId | null;
}

/**
 * Assigns a category to a statement row, by keyword.
 *
 * **No AI, ever, on this path.** Not a cost decision: an import must produce the
 * same answer in December that it produced in August, or a re-import silently
 * rewrites last month's budget report. A model that is updated between the two
 * runs cannot promise that, and a per-row API call also ships the user's spending
 * to a third party. Every rule here is a string the user can read, edit and
 * predict.
 */
export class Categoriser {
  categorise(input: CategorisationInput, context: CategoriserContext): Categorisation {
    const haystack = normalizeNarration(`${input.description} ${input.reference ?? ""}`);

    // 1. The user's own rules win outright, including over self-payee detection:
    // if they wrote a rule for a narration, they have already told us what it is.
    const userMatch = this.matchUserRules(haystack, input, context);
    if (userMatch) return userMatch;

    // 2. The user's own money moving between their own accounts.
    const self = this.matchSelf(haystack, context);
    if (self) return self;

    // 3. Structural intent: investing, card settlement, an explicit transfer.
    const structural = this.matchStructural(haystack, input, context);
    if (structural) return structural;

    // 4. Shipped defaults.
    const builtIn = this.matchBuiltIn(haystack, input, context);
    if (builtIn) return builtIn;

    // 5. Uncategorised, which is a real answer and not a failure: it is what the
    // review screen filters on, and what tells the user which rule to write next.
    return {
      intent: input.direction === "DEBIT" ? "SPEND" : "RECEIPT",
      source: "FALLBACK",
      accountId: input.direction === "DEBIT" ? context.fallbackExpenseId : context.fallbackIncomeId,
      ruleId: null,
      because: "No rule matched this narration.",
    };
  }

  /**
   * The rule ordering, in one place because determinism depends on it.
   *
   * Priority first (the user's explicit ordering), then longer patterns before
   * shorter ones so `"hdfc credit card"` beats `"hdfc"`, then rule id as the final
   * tie-break. Without that last clause two equal-priority, equal-length rules
   * would resolve by array order — which is whatever the database returned that
   * day, and the one thing a re-import must not depend on.
   */
  private ordered(rules: readonly KeywordRule[]): readonly KeywordRule[] {
    return [...rules]
      .filter((rule) => rule.isEnabled)
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          b.pattern.length - a.pattern.length ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
  }

  private matchUserRules(
    haystack: string,
    input: CategorisationInput,
    context: CategoriserContext,
  ): Categorisation | null {
    for (const rule of this.ordered(context.rules)) {
      if (rule.appliesTo !== "ANY" && rule.appliesTo !== input.direction) continue;
      if (!Categoriser.patternMatches(rule, haystack, input)) continue;
      return {
        intent: input.direction === "DEBIT" ? "SPEND" : "RECEIPT",
        source: "USER_RULE",
        accountId: rule.accountId,
        ruleId: rule.id,
        because: `Your rule "${rule.pattern}" (${rule.matchType.toLowerCase()}) matched.`,
      };
    }
    return null;
  }

  /**
   * `REGEX` is matched against the **raw** description, everything else against the
   * normalised narration.
   *
   * A user writing a regex is targeting the literal narration they can see on the
   * statement, punctuation included; silently feeding it the normalised form would
   * make `UPI/DR/` unmatchable and the rule look broken. An invalid regex is
   * treated as no match rather than thrown — one bad rule must not fail an import
   * of 300 rows.
   */
  private static patternMatches(
    rule: KeywordRule,
    haystack: string,
    input: CategorisationInput,
  ): boolean {
    if (rule.matchType === "REGEX") {
      try {
        return new RegExp(rule.pattern, "i").test(input.description);
      } catch {
        return false;
      }
    }
    const needle = normalizeNarration(rule.pattern);
    if (needle === "") return false;
    switch (rule.matchType) {
      case "EXACT":
        return haystack === needle;
      case "STARTS_WITH":
        return haystack.startsWith(needle);
      case "CONTAINS":
        return narrationHas(haystack, rule.pattern);
    }
  }

  private matchSelf(haystack: string, context: CategoriserContext): Categorisation | null {
    const payees = context.selfPayees
      .map((payee) => normalizeNarration(payee))
      .filter((payee) => payee.length >= 3);

    const hit = payees.find((payee) => haystack.includes(payee));
    if (hit) {
      return {
        intent: "TRANSFER",
        source: "SELF_PAYEE",
        accountId: null,
        ruleId: null,
        because: `"${hit}" is on your own-payee list, so this is your money moving, not spending.`,
      };
    }
    if (narrationHas(haystack, ...SELF_MARKERS)) {
      return {
        intent: "TRANSFER",
        source: "SELF_PAYEE",
        accountId: null,
        ruleId: null,
        because: "The narration describes a self transfer.",
      };
    }
    return null;
  }

  private matchStructural(
    haystack: string,
    input: CategorisationInput,
    context: CategoriserContext,
  ): Categorisation | null {
    if (input.direction === "DEBIT" && narrationHas(haystack, ...INVESTMENT_MARKERS)) {
      return {
        intent: "INVESTMENT",
        source: "STRUCTURAL",
        accountId: context.fallbackInvestmentId,
        ruleId: null,
        because: context.fallbackInvestmentId
          ? "Money moving into an investment platform is not spending — held under Assets:Investments until you say which holding it bought."
          : "Money moving into an investment platform is not spending.",
      };
    }
    if (narrationHas(haystack, ...CARD_PAYMENT_MARKERS)) {
      return {
        intent: "TRANSFER",
        source: "STRUCTURAL",
        accountId: context.fallbackCardId,
        ruleId: null,
        because: context.fallbackCardId
          ? "Settling a card bill is a transfer — the spending was already on the card, so this pays the card down rather than counting twice."
          : "Settling a card bill is a transfer — the spending was already recorded on the card.",
      };
    }
    if (narrationHas(haystack, ...TRANSFER_MARKERS)) {
      return {
        intent: "TRANSFER",
        source: "STRUCTURAL",
        accountId: null,
        ruleId: null,
        because: "The narration describes an account-to-account movement.",
      };
    }
    return null;
  }

  private matchBuiltIn(
    haystack: string,
    input: CategorisationInput,
    context: CategoriserContext,
  ): Categorisation | null {
    for (const group of BUILT_IN_KEYWORDS) {
      if (group.scope !== "ANY" && group.scope !== input.direction) continue;
      const accountId = context.accountIdByCode.get(group.code);
      // The user renamed or closed this category; their chart is the authority.
      if (!accountId) continue;
      if (!narrationHas(haystack, ...group.keywords)) continue;
      return {
        intent: input.direction === "DEBIT" ? "SPEND" : "RECEIPT",
        source: "BUILT_IN",
        accountId,
        ruleId: null,
        because: `A built-in keyword for ${group.code} matched.`,
      };
    }
    return null;
  }

  /**
   * The built-in defaults as editable rules, for seeding a new user.
   *
   * Offered rather than applied: a rule row the user can see and change is
   * strictly better than shipped behaviour they cannot, and it is the only way
   * "why was this categorised as groceries?" has an answer they can act on.
   */
  static seedRules(accountIdByCode: ReadonlyMap<string, AccountId>): readonly Omit<KeywordRule, "id">[] {
    return BUILT_IN_KEYWORDS.flatMap((group) => {
      const accountId = accountIdByCode.get(group.code);
      if (!accountId) return [];
      return group.keywords.map((keyword) => ({
        pattern: keyword,
        matchType: "CONTAINS" as MatchType,
        accountId,
        appliesTo: group.scope,
        // Below any rule the user writes by hand, which defaults to 0.
        priority: -100,
        isEnabled: true,
      }));
    });
  }

  /** Validates a code before it is stored, so a broken regex is rejected at entry. */
  static validatePattern(pattern: string, matchType: MatchType): string | null {
    if (pattern.trim() === "") return "A rule needs a pattern.";
    if (matchType !== "REGEX") {
      return normalizeNarration(pattern) === ""
        ? "That pattern normalises to nothing, so it would match every row."
        : null;
    }
    try {
      new RegExp(pattern, "i");
      return null;
    } catch (error) {
      return `Not a valid regular expression: ${(error as Error).message}`;
    }
  }
}

/** Sanity-checks the shipped table against the shipped chart at test time. */
export function builtInCodes(): readonly string[] {
  return BUILT_IN_KEYWORDS.map((group) => group.code);
}

/** Parses the codes, so a typo in the table is a test failure and not a dead rule. */
export function builtInAccountCodes(): readonly AccountCode[] {
  return builtInCodes().map((code) => AccountCode.parse(code));
}

/* ═══ Statement input (port shape) ════════════════════════════════════ */

/**
 * One movement as a statement reports it, from the account holder's side.
 *
 * Declared here rather than imported from `infra/statements.ts` because a use
 * case may not know about infra — `tests/layout.spec.ts` enforces that arrow, and
 * it is the right arrow: the *shape* of a bank movement is domain vocabulary,
 * while which delimiter a bank exported it with is not. `ParsedStatement`
 * satisfies this structurally, so nothing needs adapting at the boundary.
 */
export interface StatementMovement {
  readonly rowIndex: number;
  readonly date: CalendarDate;
  readonly description: string;
  readonly reference: string | null;
  readonly amount: Money;
  readonly direction: RowDirection;
  readonly balanceAfter: Money | null;
  readonly occurrence: number;
  readonly raw: string;
}

export interface StatementInput {
  readonly rows: readonly StatementMovement[];
  readonly problems: readonly { readonly rowIndex: number; readonly reason: string; readonly raw: string }[];
}

/* ═══ Duplicate matching ══════════════════════════════════════════════ */

/** An incoming row, reduced to what matching needs. */
export interface MatchableRow {
  /** Stable identity of the row within the import — its `import_rows` id. */
  readonly key: string;
  readonly date: CalendarDate;
  readonly amount: Money;
  readonly direction: RowDirection;
  /** The bank's own id for the movement, when the format carries one (OFX `FITID`). */
  readonly externalId: string | null;
  /**
   * A transaction a user rule pinned this row to. Pass 1 acts on it, which is what
   * makes a rule outrank both the id and the fuzzy passes.
   */
  readonly ruleMatchedTransactionId?: string | null;
}

/** An existing ledger transaction the row might duplicate. */
export interface MatchTarget {
  readonly transactionId: string;
  readonly date: CalendarDate;
  readonly amount: Money;
  readonly direction: RowDirection;
  readonly externalId: string | null;
}

export interface MatchOutcome {
  readonly key: string;
  readonly matchedTransactionId: string | null;
  /** Which sweep claimed it: 1 rules, 2 external id, 3 fuzzy. */
  readonly pass: 1 | 2 | 3 | null;
  readonly because: string;
}

export interface MatcherOptions {
  /** How far either side of the row's date a fuzzy match may reach. */
  readonly windowDays?: number;
  /**
   * When the bank supplies ids, an id mismatch is decisive.
   *
   * With `strictIdChecking` on, a row carrying an external id will not fuzzy-match
   * a transaction that carries a *different* one: same amount, same day, two
   * different bank references means two different movements, and merging them
   * loses one. Off, the fuzzy pass ignores ids entirely — which is what a CSV with
   * no ids needs.
   */
  readonly strictIdChecking?: boolean;
}

/**
 * Actual Budget's three-pass reconciler, ported.
 *
 * The shape is the part worth copying exactly, and it is not obvious:
 *
 *   - **Three complete sweeps, not three tries per row.** Every row gets its pass-2
 *     chance before any row gets its pass-3 chance. Per-row would let the first row
 *     in the file fuzzy-claim a transaction that a later row matches exactly by id.
 *   - **One shared `matched` set across all three passes.** A ledger transaction can
 *     absorb at most one incoming row, which is what stops two identical ₹40 rows
 *     from both matching the single ₹40 transaction already recorded.
 *   - **Fuzzy candidates ordered by date distance, then by id.** Nearest date wins;
 *     the id tie-break makes the choice reproducible when two candidates sit the
 *     same number of days away, and reproducibility is the whole point of running
 *     an import twice.
 */
export class DuplicateMatcher {
  private readonly windowDays: number;
  private readonly strictIdChecking: boolean;

  constructor(options: MatcherOptions = {}) {
    this.windowDays = options.windowDays ?? 7;
    this.strictIdChecking = options.strictIdChecking ?? true;
  }

  match(rows: readonly MatchableRow[], targets: readonly MatchTarget[]): readonly MatchOutcome[] {
    const claimed = new Set<string>();
    const outcomes = new Map<string, MatchOutcome>();
    const byId = new Map<string, MatchTarget>();
    for (const target of targets) {
      if (target.externalId) byId.set(target.externalId, target);
    }
    const targetsById = new Map(targets.map((target) => [target.transactionId, target]));

    /* Pass 1 — a rule already said which transaction this is. */
    for (const row of rows) {
      const pinned = row.ruleMatchedTransactionId;
      if (!pinned) continue;
      if (claimed.has(pinned) || !targetsById.has(pinned)) continue;
      claimed.add(pinned);
      outcomes.set(row.key, {
        key: row.key,
        matchedTransactionId: pinned,
        pass: 1,
        because: "A rule pinned this row to an existing transaction.",
      });
    }

    /* Pass 2 — the bank's own id, which is exact when present. */
    for (const row of rows) {
      if (outcomes.has(row.key) || !row.externalId) continue;
      const target = byId.get(row.externalId);
      if (!target || claimed.has(target.transactionId)) continue;
      claimed.add(target.transactionId);
      outcomes.set(row.key, {
        key: row.key,
        matchedTransactionId: target.transactionId,
        pass: 2,
        because: `Same bank reference (${row.externalId}) as an existing transaction.`,
      });
    }

    /* Pass 3 — same amount and direction, within the date window. */
    for (const row of rows) {
      if (outcomes.has(row.key)) continue;
      const candidate = this.nearestCandidate(row, targets, claimed);
      if (!candidate) continue;
      claimed.add(candidate.transactionId);
      const distance = Math.abs(row.date.daysUntil(candidate.date));
      outcomes.set(row.key, {
        key: row.key,
        matchedTransactionId: candidate.transactionId,
        pass: 3,
        because:
          distance === 0
            ? `Same amount and date as an existing transaction.`
            : `Same amount, ${distance} day${distance === 1 ? "" : "s"} from an existing transaction.`,
      });
    }

    return rows.map(
      (row) =>
        outcomes.get(row.key) ?? {
          key: row.key,
          matchedTransactionId: null,
          pass: null,
          because: "No existing transaction looks like this row.",
        },
    );
  }

  private nearestCandidate(
    row: MatchableRow,
    targets: readonly MatchTarget[],
    claimed: ReadonlySet<string>,
  ): MatchTarget | null {
    const eligible = targets.filter((target) => {
      if (claimed.has(target.transactionId)) return false;
      if (target.direction !== row.direction) return false;
      if (target.amount.currency.code !== row.amount.currency.code) return false;
      if (!target.amount.equals(row.amount)) return false;
      if (Math.abs(row.date.daysUntil(target.date)) > this.windowDays) return false;
      // `strictIdChecking`: two different bank references are two different
      // movements, however alike they look.
      if (this.strictIdChecking && row.externalId && target.externalId) {
        return row.externalId === target.externalId;
      }
      return true;
    });

    if (eligible.length === 0) return null;
    return [...eligible].sort((a, b) => {
      const byDistance =
        Math.abs(row.date.daysUntil(a.date)) - Math.abs(row.date.daysUntil(b.date));
      if (byDistance !== 0) return byDistance;
      return a.transactionId < b.transactionId ? -1 : a.transactionId > b.transactionId ? 1 : 0;
    })[0];
  }
}

/**
 * The fingerprint stored on an imported transaction.
 *
 * Deliberately *not* the matcher's job: the matcher answers "is this the same
 * movement as one I already have?", which is fuzzy, while the fingerprint answers
 * "is this the same *row of the same file*?", which must be exact — it is what the
 * unique index enforces. `occurrence` is in the key because two identical rows in
 * one statement are two real transactions.
 */
export function fingerprintOf(input: {
  accountId: AccountId;
  date: CalendarDate;
  amount: Money;
  direction: RowDirection;
  description: string;
  occurrence: number;
}): string {
  return [
    input.accountId.value,
    input.date.toISO(),
    input.amount.minor.toString(),
    input.amount.currency.code,
    input.direction,
    normalizeNarration(input.description),
    String(input.occurrence),
  ].join("|");
}

/* ═══ Reconciliation ══════════════════════════════════════════════════ */

export interface ReconciliationInput {
  /** The closing balance the statement prints, signed as the account's own balance. */
  readonly statementClosing: Money;
  /** The ledger's balance for the same account on the same date. */
  readonly ledgerClosing: Money;
  readonly asOf: CalendarDate;
  /** Rows in the statement that the matcher could not tie to a transaction. */
  readonly unmatchedStatementRows: number;
  /** Transactions in the window that no statement row explains. */
  readonly unexplainedTransactions: number;
}

export interface ReconciliationReport {
  readonly asOf: CalendarDate;
  readonly statementClosing: Money;
  readonly ledgerClosing: Money;
  /** `statement − ledger`: positive means the ledger is missing money coming in. */
  readonly difference: Money;
  readonly isReconciled: boolean;
  readonly findings: readonly string[];
}

/**
 * Reconciliation as a **comparison**, not a mutation.
 *
 * The obvious design — flip the matched postings to `RECONCILED` — was rejected,
 * and the reason is structural rather than aesthetic. Invariant L10 (reconciled
 * postings are immutable) is currently enforced *by the absence of any
 * posting-level write path*; adding one so the reconcile screen can stamp a
 * status would reintroduce exactly the hole L10 exists to close, in return for a
 * flag. What the user actually needs from reconciliation is the difference and its
 * explanation, and both are derivable.
 *
 * So this reports, and the user acts: a cash difference becomes an adjustment
 * transaction (see `CashInHand.reconcileTo`), a missing row becomes an import.
 */
export function reconcile(input: ReconciliationInput): ReconciliationReport {
  const difference = input.statementClosing.minus(input.ledgerClosing);
  const findings: string[] = [];

  if (!difference.isZero) {
    findings.push(
      difference.isPositive
        ? `The statement is ${difference.toString()} higher than the ledger — money came in that is not recorded.`
        : `The ledger is ${difference.negated().toString()} higher than the statement — something is recorded twice, or an outflow is missing.`,
    );
  }
  if (input.unmatchedStatementRows > 0) {
    findings.push(
      `${input.unmatchedStatementRows} statement row(s) have no transaction in the ledger.`,
    );
  }
  if (input.unexplainedTransactions > 0) {
    findings.push(
      `${input.unexplainedTransactions} recorded transaction(s) do not appear on the statement.`,
    );
  }

  return {
    asOf: input.asOf,
    statementClosing: input.statementClosing,
    ledgerClosing: input.ledgerClosing,
    difference,
    // Reconciled means the balances agree. Unmatched rows on either side with a
    // zero difference are worth showing, but they cancel out — most often a
    // transfer recorded on the far side — and calling that "not reconciled" would
    // train the user to ignore the flag.
    isReconciled: difference.isZero,
    findings,
  };
}

/* ═══ Budgets ═════════════════════════════════════════════════════════ */

/** One category's budget for one month. */
export interface BudgetEnvelope {
  readonly accountId: AccountId;
  /** `YYYY-MM`. */
  readonly month: string;
  /** What was set aside. */
  readonly budgeted: Money;
  /**
   * What was spent, **negative** — the sign convention of `30-CALCULATIONS.md` §7,
   * kept rather than flipped so the four formulas read exactly as documented.
   */
  readonly spent: Money;
  /**
   * Whether a leftover (or an overspend) rolls into next month.
   *
   * This is the flag that makes envelope budgeting expressible: with it off, an
   * overspend is absorbed by next month's income and the category starts clean;
   * with it on, the category carries its own debt, which is the whole point of
   * envelopes.
   */
  readonly carryover: boolean;
}

export interface EnvelopeState {
  readonly accountId: AccountId;
  readonly month: string;
  readonly budgeted: Money;
  readonly spent: Money;
  /** `budgeted + spent + carried-in`. Negative means overspent. */
  readonly leftover: Money;
  /** `max(0, leftover)` — invariant U02. */
  readonly leftoverPositive: Money;
  /** What came in from the previous month, after that month's carryover rule. */
  readonly carriedIn: Money;
}

export interface MonthBudget {
  readonly month: string;
  readonly envelopes: readonly EnvelopeState[];
  /** `Σ` of the previous month's non-carryover overspends, as a negative amount. */
  readonly lastMonthOverspent: Money;
  readonly totalBudgeted: Money;
  /** `available + lastMonthOverspent + totalBudgeted − buffered`. */
  readonly toBudget: Money;
  /** U01: in envelope mode, `Σ budgeted` must not exceed available funds. */
  readonly warnings: readonly string[];
}

/**
 * Actual's envelope arithmetic, month by month.
 *
 * Written as a fold over months rather than a formula per cell because every term
 * depends on the previous month: `leftover[c,m]` needs `leftover[c,m−1]`, and the
 * carryover flag decides whether a *negative* leftover propagates or is truncated
 * to zero and charged to the month instead. Recomputing a single month in
 * isolation is therefore impossible, and pretending otherwise is how a budget app
 * ends up with a total that depends on which screen you opened first.
 */
export class BudgetLedger {
  /**
   * @param months Envelopes grouped by month, in chronological order.
   */
  plan(
    months: readonly {
      month: string;
      envelopes: readonly BudgetEnvelope[];
      /** Income available to allocate this month. */
      availableFunds: Money;
      /** Held back deliberately, e.g. next month's rent. */
      buffered?: Money;
    }[],
  ): readonly MonthBudget[] {
    const previous = new Map<string, { leftover: Money; carryover: boolean }>();
    const out: MonthBudget[] = [];

    for (const month of months) {
      const envelopes: EnvelopeState[] = [];
      const currency = month.availableFunds.currency;
      let totalBudgeted = Money.zero(currency);
      let lastMonthOverspent = Money.zero(currency);

      // The previous month's overspends are charged to this month for every
      // category that does NOT carry over — including categories with no envelope
      // this month, which is why this loops over `previous` rather than over the
      // current month's envelopes.
      for (const state of previous.values()) {
        if (!state.carryover && state.leftover.isNegative) {
          lastMonthOverspent = lastMonthOverspent.plus(state.leftover);
        }
      }

      for (const envelope of month.envelopes) {
        const before = previous.get(envelope.accountId.value);
        const carriedIn = before
          ? before.carryover
            ? before.leftover
            : maxZero(before.leftover)
          : Money.zero(currency);

        const leftover = envelope.budgeted.plus(envelope.spent).plus(carriedIn);
        totalBudgeted = totalBudgeted.plus(envelope.budgeted);

        envelopes.push({
          accountId: envelope.accountId,
          month: envelope.month,
          budgeted: envelope.budgeted,
          spent: envelope.spent,
          leftover,
          leftoverPositive: maxZero(leftover),
          carriedIn,
        });
      }

      const buffered = month.buffered ?? Money.zero(currency);
      const toBudget = month.availableFunds
        .plus(lastMonthOverspent)
        .plus(totalBudgeted)
        .minus(buffered);

      const warnings: string[] = [];
      if (totalBudgeted.isGreaterThan(month.availableFunds)) {
        warnings.push(
          `Budgeted ${totalBudgeted.toString()} against ${month.availableFunds.toString()} available (U01).`,
        );
      }

      out.push({
        month: month.month,
        envelopes,
        lastMonthOverspent,
        totalBudgeted,
        toBudget,
        warnings,
      });

      // Carry this month's state forward, keeping categories that vanished this
      // month so an unspent overspend is not quietly forgiven.
      const next = new Map(previous);
      for (const state of envelopes) {
        const envelope = month.envelopes.find((candidate) =>
          candidate.accountId.equals(state.accountId),
        );
        next.set(state.accountId.value, {
          leftover: state.leftover,
          carryover: envelope?.carryover ?? false,
        });
      }
      previous.clear();
      for (const [key, value] of next) previous.set(key, value);
    }

    return out;
  }

  /**
   * How far through a budget one category is, for the warning bar.
   *
   * Returned in basis points rather than as a rounded percentage: `Percentage`
   * exists for this, and an integer percent would make ₹9,999 of a ₹10,000 budget
   * read as "100%" and hide the fact that it has not been breached.
   */
  static utilisationBasisPoints(spent: Money, budgeted: Money): bigint | null {
    if (budgeted.isZero) return null;
    return (spent.abs().minor * 10_000n) / budgeted.abs().minor;
  }
}

function maxZero(amount: Money): Money {
  return amount.isNegative ? Money.zero(amount.currency) : amount;
}

/* ═══ Ports ═══════════════════════════════════════════════════════════ */

/**
 * The staged-import state machine — invariant I01.
 *
 * `DRAFT → PARSED → MATCHED → CONFIRMED | REJECTED`, and **only `CONFIRMED` rows
 * may reach the ledger**. The states are worth having as data rather than as a
 * boolean because the review screen is built from them: "12 look like duplicates,
 * 3 could not be read, 198 are ready" is the screen, and it is a `GROUP BY`.
 */
export type ImportRowStatus = "DRAFT" | "PARSED" | "MATCHED" | "CONFIRMED" | "REJECTED";

export type ImportBatchStatus = "COMPLETED" | "PARTIAL" | "FAILED" | "UNDONE";

/** What a staged row holds, once parsed. Serialisable: it round-trips as JSON. */
export interface StagedRow {
  readonly id: string;
  readonly batchId: string;
  readonly rowIndex: number;
  readonly status: ImportRowStatus;
  readonly date: CalendarDate;
  readonly description: string;
  readonly reference: string | null;
  readonly amount: Money;
  readonly direction: RowDirection;
  readonly balanceAfter: Money | null;
  readonly occurrence: number;
  /** The source line, verbatim, so a re-parse never needs the original file. */
  readonly raw: string;
  /** The category the categoriser proposed, which the user may override. */
  readonly proposedAccountId: AccountId | null;
  readonly intent: MovementIntent;
  readonly because: string;
  /** Set once the matcher claims this row duplicates an existing transaction. */
  readonly matchedTransactionId: string | null;
  readonly matchPass: number | null;
  readonly rejectedReason: string | null;
}

export interface ImportBatchRecord {
  readonly id: string;
  readonly kind: "BANK_STATEMENT" | "TRADE_BOOK" | "HOLDINGS";
  readonly accountId: AccountId | null;
  readonly fileName: string;
  readonly fileHash: string;
  readonly rowsRead: number;
  readonly rowsImported: number;
  readonly rowsDuplicate: number;
  readonly rowsFailed: number;
  readonly status: ImportBatchStatus;
}

/**
 * Persistence for staged imports.
 *
 * `findBatchByFileHash` is invariant I02 (re-importing the same bytes is a no-op)
 * and belongs here rather than in a use case: the hash is the only thing that can
 * answer it, and asking the question anywhere else means one caller will forget.
 */
export interface ImportRepository {
  findBatchByFileHash(userId: UserId, fileHash: string): Promise<ImportBatchRecord | null>;

  /** Writes the batch and its rows together — a half-staged import is not a state. */
  createBatch(
    userId: UserId,
    batch: ImportBatchRecord,
    rows: readonly StagedRow[],
  ): Promise<void>;

  findBatch(userId: UserId, batchId: string): Promise<ImportBatchRecord | null>;

  /** Recent batches, newest first — the import screen's history. */
  listBatches(userId: UserId, limit?: number): Promise<readonly ImportBatchRecord[]>;

  listRows(
    userId: UserId,
    batchId: string,
    options?: { statuses?: readonly ImportRowStatus[] },
  ): Promise<readonly StagedRow[]>;

  /**
   * Rows staged but not yet in the ledger, grouped by the account they would land
   * in.
   *
   * One query rather than a batch-by-batch walk, because the screens that need it
   * are the dashboard and the account list — a per-batch loop there is a query per
   * import for the life of the account.
   *
   * The reason this exists at all: a half-posted import leaves a balance that is
   * arithmetically correct and materially wrong, and nothing said so. A statement
   * whose outflows are still in the review queue reads as a healthier account than
   * the bank thinks you have.
   */
  pendingRowCounts(
    userId: UserId,
  ): Promise<readonly { accountId: string; rows: number; batches: number }[]>;

  setRowStatus(
    userId: UserId,
    rowId: string,
    patch: {
      status: ImportRowStatus;
      proposedAccountId?: AccountId | null;
      matchedTransactionId?: string | null;
      matchPass?: number | null;
      rejectedReason?: string | null;
    },
  ): Promise<void>;

  /** Records the outcome counts once a batch has been posted or undone. */
  setBatchOutcome(
    userId: UserId,
    batchId: string,
    outcome: {
      status: ImportBatchStatus;
      rowsImported?: number;
      rowsDuplicate?: number;
      rowsFailed?: number;
      completedAt?: Date;
    },
  ): Promise<void>;

  /** Hides an import batch and its staged rows after it has been undone. */
  softDeleteBatch(userId: UserId, batchId: string, at: Date): Promise<void>;
}

export interface CategoryRuleRepository {
  list(userId: UserId): Promise<readonly KeywordRule[]>;
  saveMany(userId: UserId, rules: readonly Omit<KeywordRule, "id">[]): Promise<number>;
  /** Surfaces dead rules for cleanup, and proves which rule categorised a row. */
  bumpMatchCounts(userId: UserId, ruleIds: readonly string[]): Promise<void>;
}

/** The user's own accounts and family, for self-transfer detection. */
export interface SelfPayeeQuery {
  list(userId: UserId): Promise<readonly string[]>;
}

export interface StoredBudget {
  readonly id: string;
  readonly accountId: AccountId;
  /** `YYYY-MM`, or null for the recurring default. */
  readonly month: string | null;
  readonly limit: Money;
  readonly warnAtPercent: number;
  readonly carryover: boolean;
}

export interface BudgetRepository {
  /**
   * Every budget row that could apply to these months: the month-specific rows
   * and the recurring defaults, in one round trip. Resolution — a specific month
   * overriding its default — is {@link resolveBudgets}, which is policy and does
   * not belong in SQL.
   */
  listFor(userId: UserId, months: readonly string[]): Promise<readonly StoredBudget[]>;

  upsert(userId: UserId, budget: Omit<StoredBudget, "id">): Promise<string>;

  remove(userId: UserId, budgetId: string, at: Date): Promise<void>;
}

/**
 * Which budget applies to a category in a month: the month's own row if there is
 * one, otherwise the recurring default.
 *
 * Kept out of the repository deliberately. "A specific month overrides the
 * default" is a rule someone will want to see and change, and expressed as a
 * `COALESCE` in a query it would be invisible — and duplicated in the second
 * query that needed it.
 */
export function resolveBudgets(
  budgets: readonly StoredBudget[],
  month: string,
): readonly StoredBudget[] {
  const specific = new Map<string, StoredBudget>();
  const recurring = new Map<string, StoredBudget>();
  for (const budget of budgets) {
    if (budget.month === month) specific.set(budget.accountId.value, budget);
    else if (budget.month === null) recurring.set(budget.accountId.value, budget);
  }
  const out = [...specific.values()];
  for (const [accountId, budget] of recurring) {
    if (!specific.has(accountId)) out.push({ ...budget, month });
  }
  return out.sort((a, b) => (a.accountId.value < b.accountId.value ? -1 : 1));
}
