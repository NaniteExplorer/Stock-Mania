/**
 * Banking policy: categorisation, duplicate matching, reconciliation, budgets.
 *
 * Three properties are asserted here rather than merely hoped for:
 *
 *   - **Categorisation is a pure function of its inputs.** The same row, the same
 *     rules, the same answer — including when the rules arrive in a different
 *     order, which is what a database is free to do between two runs. Tested by
 *     shuffling the rule array over generated permutations.
 *   - **Re-importing an overlapping statement adds nothing.** The three-pass
 *     matcher claims every row that already exists, and no ledger transaction is
 *     claimed twice.
 *   - **The four budget formulas are Actual's, exactly.** Worked by hand from
 *     `30-CALCULATIONS.md` §7 and compared, including the case the formulas exist
 *     for: an overspend in a non-carryover category is charged to the next month
 *     rather than to the category.
 */

import { UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import {
  BUILT_IN_KEYWORDS,
  BudgetLedger,
  Categoriser,
  DuplicateMatcher,
  builtInAccountCodes,
  fingerprintOf,
  normalizeNarration,
  reconcile,
  type BudgetEnvelope,
  type CategoriserContext,
  type KeywordRule,
  type MatchTarget,
  type MatchableRow,
} from "@/domain/banking";
import { DEFAULT_CHART } from "@/domain/accounts";
import {
  assertProperty,
  check,
  checkDeep,
  checkTrue,
  done,
  genArray,
  genInt,
  genOneOf,
  section,
} from "./harness";

const INR = Currency.INR;
const rupees = (value: string) => Money.fromRupees(value);
const on = (value: string) => CalendarDate.parse(value);
/**
 * Stable, readable account ids. `AccountId` insists on a uuid, so a label is
 * mapped to one deterministically — the same label is the same id within a run,
 * which is what the matcher's tie-breaks and the budget fold rely on.
 */
const uuids = new Map<string, string>();
const id = (label: string): AccountId => {
  const existing = uuids.get(label);
  if (existing) return AccountId.from(existing);
  const minted = `00000000-0000-4000-8000-${String(uuids.size + 1).padStart(12, "0")}`;
  uuids.set(label, minted);
  return AccountId.from(minted);
};

/* ═══ Narration normalisation ═════════════════════════════════════════ */

section("narration normalisation");

check(
  "reference numbers are stripped",
  normalizeNarration("UPI/DR/402938471/ZEPTO/HDFC/utr 4029384710"),
  "upi dr 402938471 zepto hdfc",
);
check(
  "two spellings of the same merchant normalise together",
  normalizeNarration("UPI-ZEPTO-INDIA") === normalizeNarration("upi zepto india"),
  true,
);
check("case and punctuation collapse", normalizeNarration("  INT.PD:01-01-2026  "), "int pd 01 01 2026");

/* ═══ Categorisation ══════════════════════════════════════════════════ */

section("categorisation");

const GROCERIES = id("acct-groceries");
const EATING_OUT = id("acct-eating-out");
const SALARY = id("acct-salary");
const FALLBACK_EXPENSE = id("acct-uncat-expense");
const FALLBACK_INCOME = id("acct-uncat-income");

const chartIds = new Map<string, AccountId>([
  ["Expenses:Food:Groceries", GROCERIES],
  ["Expenses:Food:Eating Out", EATING_OUT],
  ["Income:Salary", SALARY],
]);

const baseContext: CategoriserContext = {
  rules: [],
  selfPayees: ["debasish rana", "9876543210"],
  accountIdByCode: chartIds,
  fallbackExpenseId: FALLBACK_EXPENSE,
  fallbackIncomeId: FALLBACK_INCOME,
};

const categoriser = new Categoriser();
const debit = (description: string, reference: string | null = null) =>
  ({ description, reference, direction: "DEBIT" }) as const;
const credit = (description: string, reference: string | null = null) =>
  ({ description, reference, direction: "CREDIT" }) as const;

const zepto = categoriser.categorise(debit("UPI-ZEPTO MARKETPLACE-402938471"), baseContext);
check("a built-in keyword categorises", zepto.accountId, GROCERIES);
check("and says so", zepto.source, "BUILT_IN");
check("a grocery debit is spending", zepto.intent, "SPEND");

const swiggy = categoriser.categorise(debit("MMT/IMPS/SWIGGY LIMITED/ORDER"), baseContext);
check("groceries beat eating out only when the keyword is a grocery one", swiggy.accountId, EATING_OUT);

const salary = categoriser.categorise(credit("SALARY CREDIT APR ANANDA LTD"), baseContext);
check("an income keyword on a credit", salary.accountId, SALARY);
check("a credit is a receipt", salary.intent, "RECEIPT");

// The same word on the wrong side must not fire: "salary" appears in "COOK
// SALARY", which is a debit and is not income.
const cookSalary = categoriser.categorise(debit("UPI/COOK SALARY JUNE"), baseContext);
checkTrue("an income keyword does not fire on a debit", cookSalary.accountId !== SALARY);

const selfTransfer = categoriser.categorise(
  debit("IMPS/DEBASISH RANA/SELF ACCOUNT ICICI"),
  baseContext,
);
check("a self payee is a transfer, not spending", selfTransfer.intent, "TRANSFER");
check("with no category", selfTransfer.accountId, null);
check("and the reason names the payee", selfTransfer.source, "SELF_PAYEE");

const cardBill = categoriser.categorise(debit("CREDIT CARD PAYMENT SBI CARD AUTOPAY"), baseContext);
check("settling a card is a transfer", cardBill.intent, "TRANSFER");

const sip = categoriser.categorise(debit("ACH/D/GROWW INVEST TECH/SIP"), baseContext);
check("money into an investment platform is not spending", sip.intent, "INVESTMENT");

const mystery = categoriser.categorise(debit("POS 4021XXXX9911 UNKNOWN MERCHANT"), baseContext);
check("an unmatched debit falls back", mystery.accountId, FALLBACK_EXPENSE);
check("and is labelled as such", mystery.source, "FALLBACK");
check("an unmatched credit falls back to income", categoriser.categorise(credit("NEFT CR MYSTERY"), baseContext).accountId, FALLBACK_INCOME);

/* A user rule outranks everything, including the self-payee list. */
const userRules: readonly KeywordRule[] = [
  {
    id: "rule-1",
    pattern: "zepto",
    matchType: "CONTAINS",
    accountId: EATING_OUT,
    appliesTo: "ANY",
    priority: 0,
    isEnabled: true,
  },
  {
    id: "rule-2",
    pattern: "debasish rana",
    matchType: "CONTAINS",
    accountId: GROCERIES,
    appliesTo: "DEBIT",
    priority: 0,
    isEnabled: true,
  },
  {
    id: "rule-3",
    pattern: "zepto marketplace",
    matchType: "CONTAINS",
    accountId: SALARY,
    appliesTo: "ANY",
    // Same priority as rule-1 but a longer pattern, so it wins.
    priority: 0,
    isEnabled: true,
  },
  {
    id: "rule-4",
    pattern: "disabled rule zepto",
    matchType: "CONTAINS",
    accountId: FALLBACK_EXPENSE,
    appliesTo: "ANY",
    priority: 99,
    isEnabled: false,
  },
];

const withRules: CategoriserContext = { ...baseContext, rules: userRules };

check(
  "the longer pattern wins at equal priority",
  categoriser.categorise(debit("UPI-ZEPTO MARKETPLACE-402938471"), withRules).ruleId,
  "rule-3",
);
check(
  "a user rule outranks the self-payee list",
  categoriser.categorise(debit("IMPS/DEBASISH RANA/SELF"), withRules).accountId,
  GROCERIES,
);
// rule-4 has the highest priority and matches this narration; it is disabled, so
// the next-best rule (plain "zepto") answers instead.
check(
  "a disabled rule never fires",
  categoriser.categorise(debit("DISABLED RULE ZEPTO PAYMENT"), withRules).ruleId,
  "rule-1",
);

const scoped: readonly KeywordRule[] = [
  {
    id: "rule-credit-only",
    pattern: "interest",
    matchType: "CONTAINS",
    accountId: SALARY,
    appliesTo: "CREDIT",
    priority: 5,
    isEnabled: true,
  },
];
check(
  "a CREDIT-scoped rule ignores a debit",
  categoriser.categorise(debit("INTEREST CHARGED ON OD"), { ...baseContext, rules: scoped }).ruleId,
  null,
);
check(
  "and fires on the credit",
  categoriser.categorise(credit("INTEREST PAID BY BANK"), { ...baseContext, rules: scoped }).ruleId,
  "rule-credit-only",
);

section("regex and pattern validation");

const regexRule: KeywordRule = {
  id: "rule-regex",
  pattern: "^UPI/DR/\\d+/ZEPTO",
  matchType: "REGEX",
  accountId: GROCERIES,
  appliesTo: "ANY",
  priority: 10,
  isEnabled: true,
};
check(
  "a regex matches the raw narration, punctuation included",
  categoriser.categorise(debit("UPI/DR/402938471/ZEPTO/HDFC"), { ...baseContext, rules: [regexRule] }).ruleId,
  "rule-regex",
);

const brokenRegex: KeywordRule = { ...regexRule, id: "rule-broken", pattern: "([unclosed" };
check(
  "an invalid regex is skipped, not thrown — one bad rule must not fail 300 rows",
  categoriser.categorise(debit("([unclosed"), { ...baseContext, rules: [brokenRegex] }).ruleId,
  null,
);
check("and it is rejected at entry instead", Categoriser.validatePattern("([unclosed", "REGEX") !== null, true);
check("a pattern that normalises to nothing is rejected", Categoriser.validatePattern("///", "CONTAINS") !== null, true);
check("a sane pattern validates", Categoriser.validatePattern("zepto", "CONTAINS"), null);

section("categorisation is deterministic under rule order");

// The property that makes a re-import safe. A database is free to return these
// rows in any order; the answer must not depend on which order that was.
assertProperty(
  "the same row and rules give the same category however the rules are ordered",
  (rng) => {
    const shuffled = [...userRules];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  },
  (shuffled) => {
    const result = categoriser.categorise(debit("UPI-ZEPTO MARKETPLACE-402938471"), {
      ...baseContext,
      rules: shuffled,
    });
    return result.ruleId === "rule-3";
  },
  500,
);

const NARRATIONS = [
  "UPI-ZEPTO MARKETPLACE-402938471",
  "IMPS/DEBASISH RANA/SELF ACCOUNT",
  "SALARY CREDIT APR",
  "TPCODL ELECTRICITY BILL",
  "POS UNKNOWN MERCHANT",
  "ACH/D/GROWW INVEST TECH/SIP",
];

assertProperty(
  "categorising the same input twice gives an identical answer",
  (rng) => ({
    description: genOneOf(NARRATIONS)(rng),
    direction: genOneOf(["DEBIT", "CREDIT"] as const)(rng),
  }),
  (sample) => {
    const input = { description: sample.description, reference: null, direction: sample.direction };
    const first = categoriser.categorise(input, withRules);
    const second = categoriser.categorise(input, withRules);
    return (
      first.accountId?.value === second.accountId?.value &&
      first.intent === second.intent &&
      first.ruleId === second.ruleId
    );
  },
  1000,
);

section("built-in keywords point at real accounts");

const chartCodes = new Set(DEFAULT_CHART.map((seed) => seed.code));
const orphans = BUILT_IN_KEYWORDS.map((group) => group.code).filter((code) => !chartCodes.has(code));
checkDeep("every built-in group names a seeded account code", orphans, []);
check("and every code parses", builtInAccountCodes().length, BUILT_IN_KEYWORDS.length);
check(
  "seeding produces one editable rule per keyword",
  Categoriser.seedRules(chartIds).length,
  BUILT_IN_KEYWORDS.filter((group) => chartIds.has(group.code)).reduce(
    (total, group) => total + group.keywords.length,
    0,
  ),
);

/* ═══ Duplicate matching ══════════════════════════════════════════════ */

section("three-pass duplicate matcher");

const matcher = new DuplicateMatcher();

const existing: readonly MatchTarget[] = [
  { transactionId: "txn-a", date: on("2026-04-03"), amount: rupees("1234.56"), direction: "DEBIT", externalId: null },
  { transactionId: "txn-b", date: on("2026-04-03"), amount: rupees("1234.56"), direction: "DEBIT", externalId: null },
  { transactionId: "txn-c", date: on("2026-04-07"), amount: rupees("18500.00"), direction: "DEBIT", externalId: "FT7" },
  { transactionId: "txn-d", date: on("2026-04-28"), amount: rupees("318.40"), direction: "CREDIT", externalId: null },
];

const reimport: readonly MatchableRow[] = [
  { key: "row-1", date: on("2026-04-03"), amount: rupees("1234.56"), direction: "DEBIT", externalId: null },
  { key: "row-2", date: on("2026-04-03"), amount: rupees("1234.56"), direction: "DEBIT", externalId: null },
  { key: "row-3", date: on("2026-04-07"), amount: rupees("18500.00"), direction: "DEBIT", externalId: "FT7" },
  { key: "row-4", date: on("2026-04-28"), amount: rupees("318.40"), direction: "CREDIT", externalId: null },
];

const reimported = matcher.match(reimport, existing);
check("every row of a re-imported statement is matched", reimported.filter((o) => o.matchedTransactionId).length, 4);
check("the id-carrying row matched on pass 2", reimported[2].pass, 2);
check("the fuzzy rows matched on pass 3", reimported[0].pass, 3);
check(
  "no transaction is claimed twice",
  new Set(reimported.map((o) => o.matchedTransactionId)).size,
  4,
);

// One existing transaction, two identical incoming rows: exactly one is a
// duplicate and the other is a genuinely new second payment.
const twoRowsOneTarget = matcher.match(
  [reimport[0], reimport[1]],
  [existing[0]],
);
check("the shared matched set stops a double claim", twoRowsOneTarget.filter((o) => o.matchedTransactionId).length, 1);
check("and the second row is new", twoRowsOneTarget[1].matchedTransactionId, null);

section("sweeps are complete, not per row");

// row-early would fuzzy-claim txn-x, but row-exact matches it by id. Because
// pass 2 sweeps every row before pass 3 runs, the id wins — a per-row loop would
// have let the first row take it.
const contested: readonly MatchTarget[] = [
  { transactionId: "txn-x", date: on("2026-05-10"), amount: rupees("500.00"), direction: "DEBIT", externalId: "FX1" },
];
const contestedRows: readonly MatchableRow[] = [
  { key: "row-early", date: on("2026-05-09"), amount: rupees("500.00"), direction: "DEBIT", externalId: null },
  { key: "row-exact", date: on("2026-05-12"), amount: rupees("500.00"), direction: "DEBIT", externalId: "FX1" },
];
const contestedOutcome = matcher.match(contestedRows, contested);
check("the exact id claims it", contestedOutcome[1].matchedTransactionId, "txn-x");
check("on pass 2", contestedOutcome[1].pass, 2);
check("and the nearer-dated row is left unmatched", contestedOutcome[0].matchedTransactionId, null);

section("pass 1 — a rule pins a row");

const pinned = matcher.match(
  [{ ...reimport[0], ruleMatchedTransactionId: "txn-b" }],
  existing,
);
check("the pinned transaction is used", pinned[0].matchedTransactionId, "txn-b");
check("on pass 1, ahead of the fuzzy candidate txn-a", pinned[0].pass, 1);

section("the date window");

const far: readonly MatchTarget[] = [
  { transactionId: "txn-7", date: on("2026-06-08"), amount: rupees("999.00"), direction: "DEBIT", externalId: null },
];
check(
  "seven days away still matches",
  matcher.match([{ key: "r", date: on("2026-06-01"), amount: rupees("999.00"), direction: "DEBIT", externalId: null }], far)[0]
    .matchedTransactionId,
  "txn-7",
);
check(
  "eight days away does not",
  matcher.match([{ key: "r", date: on("2026-05-31"), amount: rupees("999.00"), direction: "DEBIT", externalId: null }], far)[0]
    .matchedTransactionId,
  null,
);
check(
  "the opposite direction never matches",
  matcher.match([{ key: "r", date: on("2026-06-08"), amount: rupees("999.00"), direction: "CREDIT", externalId: null }], far)[0]
    .matchedTransactionId,
  null,
);
check(
  "a different amount never matches",
  matcher.match([{ key: "r", date: on("2026-06-08"), amount: rupees("999.01"), direction: "DEBIT", externalId: null }], far)[0]
    .matchedTransactionId,
  null,
);

section("nearest date wins, ties broken by id");

const twoCandidates: readonly MatchTarget[] = [
  { transactionId: "txn-far", date: on("2026-07-05"), amount: rupees("250.00"), direction: "DEBIT", externalId: null },
  { transactionId: "txn-near", date: on("2026-07-02"), amount: rupees("250.00"), direction: "DEBIT", externalId: null },
];
check(
  "the nearer transaction is chosen",
  matcher.match([{ key: "r", date: on("2026-07-01"), amount: rupees("250.00"), direction: "DEBIT", externalId: null }], twoCandidates)[0]
    .matchedTransactionId,
  "txn-near",
);

const equidistant: readonly MatchTarget[] = [
  { transactionId: "txn-b2", date: on("2026-07-03"), amount: rupees("250.00"), direction: "DEBIT", externalId: null },
  { transactionId: "txn-a2", date: on("2026-07-01"), amount: rupees("250.00"), direction: "DEBIT", externalId: null },
];
check(
  "an equidistant tie resolves by id, so the answer is reproducible",
  matcher.match([{ key: "r", date: on("2026-07-02"), amount: rupees("250.00"), direction: "DEBIT", externalId: null }], equidistant)[0]
    .matchedTransactionId,
  "txn-a2",
);

section("strictIdChecking");

const idBearing: readonly MatchTarget[] = [
  { transactionId: "txn-id1", date: on("2026-08-04"), amount: rupees("777.00"), direction: "DEBIT", externalId: "BANK-1" },
];
const otherId: readonly MatchableRow[] = [
  { key: "r", date: on("2026-08-04"), amount: rupees("777.00"), direction: "DEBIT", externalId: "BANK-2" },
];
check(
  "two different bank references are two different movements",
  matcher.match(otherId, idBearing)[0].matchedTransactionId,
  null,
);
check(
  "with strict checking off, the fuzzy pass ignores the ids",
  new DuplicateMatcher({ strictIdChecking: false }).match(otherId, idBearing)[0].matchedTransactionId,
  "txn-id1",
);
check(
  "a row with no id still fuzzy-matches an id-bearing transaction",
  matcher.match([{ key: "r", date: on("2026-08-04"), amount: rupees("777.00"), direction: "DEBIT", externalId: null }], idBearing)[0]
    .matchedTransactionId,
  "txn-id1",
);

section("matcher invariants over generated data");

const genRow = (index: number) =>
  (rng: () => number): MatchableRow => ({
    key: `row-${index}`,
    date: on("2026-09-01").plusDays(genInt(0, 20)(rng)),
    amount: Money.fromMinor(BigInt(genInt(1, 40)(rng)) * 10000n, INR),
    direction: genOneOf(["DEBIT", "CREDIT"] as const)(rng),
    externalId: rng() < 0.4 ? `X${genInt(1, 6)(rng)}` : null,
  });

assertProperty(
  "no ledger transaction is ever claimed by two rows",
  (rng) => {
    const rows = Array.from({ length: genInt(1, 8)(rng) }, (_unused, index) => genRow(index)(rng));
    const targets = genArray(
      (r) => ({
        transactionId: `txn-${genInt(1, 8)(r)}`,
        date: on("2026-09-01").plusDays(genInt(0, 20)(r)),
        amount: Money.fromMinor(BigInt(genInt(1, 40)(r)) * 10000n, INR),
        direction: genOneOf(["DEBIT", "CREDIT"] as const)(r),
        externalId: r() < 0.4 ? `X${genInt(1, 6)(r)}` : null,
      }),
      0,
      8,
    )(rng);
    // Distinct ids only: two rows sharing one id is not a state the ledger allows.
    const seen = new Set<string>();
    return {
      rows,
      targets: targets.filter((t) => !seen.has(t.transactionId) && seen.add(t.transactionId)),
    };
  },
  ({ rows, targets }) => {
    const outcomes = matcher.match(rows, targets);
    const claimed = outcomes.map((o) => o.matchedTransactionId).filter((v): v is string => v !== null);
    return new Set(claimed).size === claimed.length && outcomes.length === rows.length;
  },
  2000,
);

assertProperty(
  "matching is idempotent: running it twice gives the same answer",
  (rng) => Array.from({ length: genInt(1, 6)(rng) }, (_unused, index) => genRow(index)(rng)),
  (rows) => {
    const first = matcher.match(rows, existing);
    const second = matcher.match(rows, existing);
    return first.every((outcome, index) => outcome.matchedTransactionId === second[index].matchedTransactionId);
  },
  1000,
);

section("fingerprints");

const fingerprintInput = {
  accountId: id("acct-hdfc"),
  date: on("2026-04-03"),
  amount: rupees("1234.56"),
  direction: "DEBIT" as const,
  description: "UPI-ZEPTO MARKETPLACE-UTR409218374",
  occurrence: 0,
};
check(
  "the same row fingerprints identically however the reference varies",
  fingerprintOf(fingerprintInput),
  fingerprintOf({ ...fingerprintInput, description: "UPI-ZEPTO MARKETPLACE-UTR409218999" }),
);
checkTrue(
  "but the second occurrence of an identical row does not",
  fingerprintOf(fingerprintInput) !== fingerprintOf({ ...fingerprintInput, occurrence: 1 }),
);
checkTrue(
  "and a different amount does not",
  fingerprintOf(fingerprintInput) !== fingerprintOf({ ...fingerprintInput, amount: rupees("1234.57") }),
);

/* ═══ Reconciliation ══════════════════════════════════════════════════ */

section("reconciliation");

const agreed = reconcile({
  statementClosing: rupees("109800.03"),
  ledgerClosing: rupees("109800.03"),
  asOf: on("2026-04-30"),
  unmatchedStatementRows: 0,
  unexplainedTransactions: 0,
});
check("agreeing balances reconcile", agreed.isReconciled, true);
check("with nothing to report", agreed.findings.length, 0);

const short = reconcile({
  statementClosing: rupees("109800.03"),
  ledgerClosing: rupees("108565.47"),
  asOf: on("2026-04-30"),
  unmatchedStatementRows: 1,
  unexplainedTransactions: 0,
});
check("a difference is exact", short.difference, rupees("1234.56"));
check("and it does not reconcile", short.isReconciled, false);
check("the missing row is named too", short.findings.length, 2);

const overRecorded = reconcile({
  statementClosing: rupees("100000.00"),
  ledgerClosing: rupees("101000.00"),
  asOf: on("2026-04-30"),
  unmatchedStatementRows: 0,
  unexplainedTransactions: 1,
});
check("a ledger ahead of the statement is a negative difference", overRecorded.difference, rupees("-1000.00"));

/* ═══ Budgets ═════════════════════════════════════════════════════════ */

section("envelope budgets — Actual's four formulas");

const FOOD = id("acct-food");
const TRAVEL = id("acct-travel");
const budgets = new BudgetLedger();

const envelope = (
  accountId: AccountId,
  month: string,
  budgeted: string,
  spent: string,
  carryover: boolean,
): BudgetEnvelope => ({
  accountId,
  month,
  budgeted: rupees(budgeted),
  spent: rupees(spent),
  carryover,
});

// Food carries over and underspends; Travel does not carry over and overspends.
const plan = budgets.plan([
  {
    month: "2026-04",
    availableFunds: rupees("100000.00"),
    envelopes: [
      envelope(FOOD, "2026-04", "10000.00", "-8000.00", true),
      envelope(TRAVEL, "2026-04", "5000.00", "-7000.00", false),
    ],
  },
  {
    month: "2026-05",
    availableFunds: rupees("100000.00"),
    envelopes: [
      envelope(FOOD, "2026-05", "10000.00", "-9000.00", true),
      envelope(TRAVEL, "2026-05", "5000.00", "-1000.00", false),
    ],
  },
]);

const april = plan[0];
check("April food leftover = 10000 − 8000", april.envelopes[0].leftover, rupees("2000.00"));
check("April travel leftover is negative", april.envelopes[1].leftover, rupees("-2000.00"));
check("U02: leftover_pos truncates at zero", april.envelopes[1].leftoverPositive, rupees("0.00"));
check("April has no previous month to charge", april.lastMonthOverspent, rupees("0.00"));
check("total budgeted", april.totalBudgeted, rupees("15000.00"));
check("to_budget = 100000 + 0 + 15000 − 0", april.toBudget, rupees("115000.00"));

const may = plan[1];
check("food carried its 2000 forward", may.envelopes[0].carriedIn, rupees("2000.00"));
check("so May food leftover = 10000 − 9000 + 2000", may.envelopes[0].leftover, rupees("3000.00"));
check("travel did not carry its overspend", may.envelopes[1].carriedIn, rupees("0.00"));
check("so May travel starts clean", may.envelopes[1].leftover, rupees("4000.00"));
check(
  "and April's travel overspend is charged to May instead",
  may.lastMonthOverspent,
  rupees("-2000.00"),
);
check("to_budget = 100000 − 2000 + 15000", may.toBudget, rupees("113000.00"));

section("carryover changes the answer");

const withCarryover = budgets.plan([
  {
    month: "2026-04",
    availableFunds: rupees("50000.00"),
    envelopes: [envelope(TRAVEL, "2026-04", "5000.00", "-7000.00", true)],
  },
  {
    month: "2026-05",
    availableFunds: rupees("50000.00"),
    envelopes: [envelope(TRAVEL, "2026-05", "5000.00", "0.00", true)],
  },
]);
check("a carried overspend follows the category", withCarryover[1].envelopes[0].carriedIn, rupees("-2000.00"));
check("so the envelope starts in the hole", withCarryover[1].envelopes[0].leftover, rupees("3000.00"));
check("and the month is not charged for it", withCarryover[1].lastMonthOverspent, rupees("0.00"));

section("buffering and U01");

const buffered = budgets.plan([
  {
    month: "2026-06",
    availableFunds: rupees("40000.00"),
    buffered: rupees("15000.00"),
    envelopes: [envelope(FOOD, "2026-06", "45000.00", "0.00", false)],
  },
]);
check("buffered funds leave the month", buffered[0].toBudget, rupees("70000.00"));
check("U01 warns when budgeted exceeds available", buffered[0].warnings.length, 1);

section("utilisation");

check("half spent", BudgetLedger.utilisationBasisPoints(rupees("-5000"), rupees("10000")), 5000n);
check(
  "9999 of 10000 is not 100%",
  BudgetLedger.utilisationBasisPoints(rupees("-9999"), rupees("10000")),
  9999n,
);
check("a zero budget has no utilisation", BudgetLedger.utilisationBasisPoints(rupees("-1"), rupees("0")), null);

section("budget invariants over generated months");

assertProperty(
  "leftover_pos is always max(0, leftover), and a carried-in amount is never invented",
  (rng) => {
    const months = genInt(1, 6)(rng);
    return Array.from({ length: months }, (_unused, index) => ({
      month: `2026-${String(index + 1).padStart(2, "0")}`,
      availableFunds: Money.fromMinor(BigInt(genInt(0, 200)(rng)) * 100000n, INR),
      envelopes: [
        envelope(
          FOOD,
          `2026-${String(index + 1).padStart(2, "0")}`,
          String(genInt(0, 50000)(rng)),
          String(-genInt(0, 80000)(rng)),
          rng() < 0.5,
        ),
      ],
    }));
  },
  (months) => {
    const result = budgets.plan(months);
    return result.every((month, index) => {
      const state = month.envelopes[0];
      const positiveOk = state.leftover.isNegative
        ? state.leftoverPositive.isZero
        : state.leftoverPositive.equals(state.leftover);
      const firstMonthOk = index > 0 || state.carriedIn.isZero;
      const identity = state.budgeted.plus(state.spent).plus(state.carriedIn).equals(state.leftover);
      return positiveOk && firstMonthOk && identity;
    });
  },
  2000,
);

// UserId is imported for parity with the other specs' setup; assert it stays a
// value object so a string never reaches a query by accident.
check("UserId is nominal", UserId.from("u1").value, "u1");

done();
