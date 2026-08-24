/**
 * Reports, the personal-finance metrics, the risk gate and the two original
 * physical assets.
 *
 * The centre of it is **B02**: `assets − liabilities = equity + (income −
 * expenses)`. It is checked over generated ledgers as well as worked examples, and
 * the test is precise about what it catches: every balanced transaction preserves
 * the identity by construction, so B02 is a check on the *read path and the stored
 * balances* — a sign error in a `SUM`, a stale cached projection, an account whose
 * type was edited after it had postings. Each of those leaves debits equal to
 * credits and the identity broken.
 *
 * The risk gate is tested for the property that makes it a gate rather than a
 * convention: **anything that is not an explicit allow blocks**, including an
 * unconfigured limit and a check that throws.
 */

import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, Rate, UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import { UserId } from "@/core/kernel";
import { Account, AccountCode, AccountType } from "@/domain/accounts";
import {
  EsopGrant,
  GoldLease,
  PhysicalGold,
  RealEstate,
  Vehicle,
  type AssertedValuation,
} from "@/domain/assets";
import {
  RiskGate,
  noLimits,
  type OrderIntent,
  type RiskContext,
  type RiskLimits,
} from "@/domain/risk";
import {
  allocationByClass,
  balanceSheet,
  cashflowCategoryFor,
  cashflowStatement,
  checkAccountingIdentity,
  checkContinuity,
  incomeStatement,
  personalMetrics,
  type ReportedBalance,
} from "@/domain/reports";
import { assertProperty, check, checkDeep, checkTrue, done, genInt, section, throws } from "./harness";

const rupees = (value: string) => Money.fromRupees(value);
const units = (value: string) => Quantity.fromString(value);
const on = (value: string) => CalendarDate.parse(value);
const userId = UserId.from("user-reports");

let counter = 0;
const row = (
  type: ReportedBalance["type"],
  code: string,
  amount: string,
  subtype: string | null = null,
): ReportedBalance => {
  counter += 1;
  return {
    accountId: `a${counter}`,
    code,
    name: code.split(":").pop() ?? code,
    type,
    subtype,
    balance: rupees(amount),
  };
};

/* ═══ The balance sheet ═══════════════════════════════════════════════ */

section("balance sheet");

const balances: ReportedBalance[] = [
  row("ASSET", "Assets:HDFC", "450000", "BANK"),
  row("ASSET", "Assets:FD", "142174.67", "DEPOSIT"),
  row("ASSET", "Assets:Investments:INFY", "231265", "BROKERAGE"),
  row("ASSET", "Assets:Property:Flat", "9200000", "REAL_ESTATE"),
  row("LIABILITY", "Liabilities:Home Loan", "4992025.51", "MORTGAGE"),
  row("LIABILITY", "Liabilities:Credit Cards:HDFC", "31548.63", "CREDIT_CARD"),
  row("EQUITY", "Equity:Opening Balances", "5000000"),
  row("INCOME", "Income:Salary", "1500000"),
  row("EXPENSE", "Expenses:Housing:Rent", "222000"),
  row("EXPENSE", "Expenses:Food:Groceries", "144869.4"),
];

const sheet = balanceSheet(balances, on("2026-03-31"));
check("assets", sheet.assets.total.toDecimalString(), "10023439.67");
check("liabilities", sheet.liabilities.total.toDecimalString(), "5023574.14");
check("equity", sheet.equity.total.toDecimalString(), "5000000.00");
check("net worth is assets less liabilities", sheet.netWorth.toDecimalString(), "4999865.53");
check("four asset rows", sheet.assets.rows.length, 4);
check("sorted largest first", sheet.assets.rows[0].code, "Assets:Property:Flat");

// Unclosed earnings: the income and expenses that have not been closed into equity.
// 1,500,000 − 366,869.40 = 1,133,130.60 of retained earnings, less the 5,000,000
// of opening equity already on the sheet.
check("unclosed earnings", sheet.unclosedEarnings.toDecimalString(), "-134.47");

section("income statement");

const period = DateRange.of(on("2025-04-01"), on("2026-03-31"));
const statement = incomeStatement(balances, period);
check("income", statement.income.total.toDecimalString(), "1500000.00");
check("expenses", statement.expenses.total.toDecimalString(), "366869.40");
check("net surplus", statement.net.toDecimalString(), "1133130.60");
check("savings rate", statement.savingsRate?.toFixed(2), "75.54");
check(
  "no income means no savings rate rather than a divide by zero",
  incomeStatement([row("EXPENSE", "Expenses:X", "100")], period).savingsRate,
  null,
);

/* ═══ B02 ═════════════════════════════════════════════════════════════ */

section("B02 — the accounting identity");

/*
 * A ledger built from balanced transactions. Opening equity 5,00,000 funds a bank
 * account; salary of 1,00,000 arrives; 30,000 of rent is paid.
 *
 *   assets      = 500000 + 100000 − 30000 = 570000
 *   liabilities = 0
 *   equity      = 500000
 *   income      = 100000
 *   expenses    = 30000
 *   570000 − 0 = 500000 + 100000 − 30000  ✓
 */
const consistent: ReportedBalance[] = [
  row("ASSET", "Assets:HDFC", "570000", "BANK"),
  row("EQUITY", "Equity:Opening Balances", "500000"),
  row("INCOME", "Income:Salary", "100000"),
  row("EXPENSE", "Expenses:Housing:Rent", "30000"),
];
const identity = checkAccountingIdentity(consistent);
check("it holds", identity.holds, true);
check("with a zero difference", identity.difference.toDecimalString(), "0.00");

/*
 * What B02 actually catches, stated precisely.
 *
 * Every balanced transaction preserves the identity by construction — a debit to
 * an asset and a credit to income move both sides by the same amount. So B02 is
 * not a check on *posting*; it is a check on the **read path and the stored
 * balances**. A liability summed with the wrong sign, a projection cache that went
 * stale, an account whose type was edited after it had postings: each leaves the
 * transactions untouched and the identity broken, and each is invisible to
 * "debits equal credits".
 *
 * Here that is a liability reported with a flipped sign — the shape a sign bug in
 * a `SUM` takes.
 */
const signFlipped: ReportedBalance[] = [
  row("ASSET", "Assets:HDFC", "570000", "BANK"),
  row("LIABILITY", "Liabilities:Card", "-15000", "CREDIT_CARD"),
  row("EQUITY", "Equity:Opening Balances", "500000"),
  row("INCOME", "Income:Salary", "100000"),
  row("EXPENSE", "Expenses:Housing:Rent", "30000"),
];
check("a sign error in the read path breaks it", checkAccountingIdentity(signFlipped).holds, false);
check(
  "and the difference is twice the amount, which is what a flipped sign looks like",
  checkAccountingIdentity(signFlipped).difference.toDecimalString(),
  "15000.00",
);

assertProperty(
  "B02 holds for any set of balanced transactions",
  (rng) => {
    /*
     * Generate transactions rather than balances, so the identity is tested against
     * something that *balanced* by construction — which is the only interesting
     * case. Each transaction moves money between two account types.
     */
    const count = genInt(1, 12)(rng);
    const totals = { ASSET: 0, LIABILITY: 0, EQUITY: 0, INCOME: 0, EXPENSE: 0 };
    for (let index = 0; index < count; index += 1) {
      const amount = genInt(1, 100000)(rng);
      const shape = genInt(0, 4)(rng);
      switch (shape) {
        case 0: // opening balance: asset up, equity up
          totals.ASSET += amount;
          totals.EQUITY += amount;
          break;
        case 1: // income: asset up, income up
          totals.ASSET += amount;
          totals.INCOME += amount;
          break;
        case 2: // expense from an asset: asset down, expense up
          totals.ASSET -= amount;
          totals.EXPENSE += amount;
          break;
        case 3: // borrowing: asset up, liability up
          totals.ASSET += amount;
          totals.LIABILITY += amount;
          break;
        case 4: // expense on a card: liability up, expense up
          totals.LIABILITY += amount;
          totals.EXPENSE += amount;
          break;
      }
    }
    return totals;
  },
  (totals) => {
    const generated: ReportedBalance[] = [
      row("ASSET", "Assets:X", String(Math.abs(totals.ASSET)), "BANK"),
      row("LIABILITY", "Liabilities:X", String(Math.abs(totals.LIABILITY))),
      row("EQUITY", "Equity:X", String(Math.abs(totals.EQUITY))),
      row("INCOME", "Income:X", String(Math.abs(totals.INCOME))),
      row("EXPENSE", "Expenses:X", String(Math.abs(totals.EXPENSE))),
    ];
    // Signs restored, since `row` takes a magnitude.
    const signed = generated.map((entry, index) => {
      const value = [totals.ASSET, totals.LIABILITY, totals.EQUITY, totals.INCOME, totals.EXPENSE][index];
      return value < 0 ? { ...entry, balance: entry.balance.negated() } : entry;
    });
    return checkAccountingIdentity(signed).holds;
  },
  2000,
);

section("B03 — net worth continuity");

const series = [
  { on: on("2026-01-31"), assets: rupees("500000"), liabilities: rupees("100000"), netWorth: rupees("400000") },
  { on: on("2026-02-28"), assets: rupees("560000"), liabilities: rupees("95000"), netWorth: rupees("465000") },
  { on: on("2026-03-31"), assets: rupees("600000"), liabilities: rupees("90000"), netWorth: rupees("510000") },
];
check("a consistent series holds", checkContinuity(series).holds, true);

const broken = [
  series[0],
  series[1],
  { ...series[2], netWorth: rupees("999999") },
];
check("a backdated change that was not propagated is caught", checkContinuity(broken).holds, false);
check("and the break is dated", checkContinuity(broken).breaks[0].on.toISO(), "2026-03-31");

/* ═══ Cash flow ═══════════════════════════════════════════════════════ */

section("cash flow");

check("salary is operating", cashflowCategoryFor("INCOME", null), "OPERATING");
check("groceries are operating", cashflowCategoryFor("EXPENSE", null), "OPERATING");
check("a deposit is investing", cashflowCategoryFor("ASSET", "DEPOSIT"), "INVESTING");
check("a holding is investing", cashflowCategoryFor("ASSET", "BROKERAGE"), "INVESTING");
check("a bank account is operating", cashflowCategoryFor("ASSET", "BANK"), "OPERATING");
check("a loan is financing", cashflowCategoryFor("LIABILITY", "LOAN"), "FINANCING");

const cashflow = cashflowStatement({
  period,
  openingCash: rupees("100000"),
  closingCash: rupees("245000"),
  lines: [
    { category: "OPERATING", label: "Salary", amount: rupees("1500000") },
    { category: "OPERATING", label: "Living costs", amount: rupees("-366869.40") },
    { category: "INVESTING", label: "Into deposits and holdings", amount: rupees("-873130.60") },
    { category: "FINANCING", label: "Loan repayments", amount: rupees("-115000") },
  ],
});
check("operating", cashflow.operating.toDecimalString(), "1133130.60");
check("investing", cashflow.investing.toDecimalString(), "-873130.60");
check("financing", cashflow.financing.toDecimalString(), "-115000.00");
check("net change", cashflow.netChange.toDecimalString(), "145000.00");
check("and it reconciles to the closing balance", cashflow.reconciles, true);

const mismatched = cashflowStatement({
  period,
  openingCash: rupees("100000"),
  closingCash: rupees("300000"),
  lines: [{ category: "OPERATING", label: "Salary", amount: rupees("50000") }],
});
check("a mismatch is reported rather than thrown", mismatched.reconciles, false);

/* ═══ Personal metrics ════════════════════════════════════════════════ */

section("personal-finance metrics");

const metrics = personalMetrics({
  netWorth: rupees("4999865.53"),
  liquidNetWorth: rupees("592174.67"),
  periodIncome: rupees("1500000"),
  periodExpenses: rupees("366869.40"),
  essentialMonthlyExpenses: [rupees("48000"), rupees("52000"), rupees("50000")],
  monthlyDebtPayments: rupees("43391.16"),
  monthlyGrossIncome: rupees("125000"),
  cardBalances: rupees("31548.63"),
  cardLimits: rupees("200000"),
});

check("savings rate", metrics.savingsRate?.toFixed(2), "75.54");
check("burn rate is the trailing mean", metrics.burnRate?.toDecimalString(), "50000.00");
check("runway in months", metrics.runwayMonths, 11.84);
check("debt to income", metrics.debtToIncome?.toFixed(2), "34.71");
check("credit utilisation", metrics.creditUtilisation?.toFixed(2), "15.77");

const noSpending = personalMetrics({
  netWorth: rupees("100000"),
  liquidNetWorth: rupees("100000"),
  periodIncome: rupees("0"),
  periodExpenses: rupees("0"),
  essentialMonthlyExpenses: [],
  monthlyDebtPayments: rupees("0"),
  monthlyGrossIncome: rupees("0"),
  cardBalances: rupees("0"),
  cardLimits: rupees("0"),
});
// Every one of these would be a division by zero, and every one says "cannot say"
// rather than reporting infinity or a misleading zero.
check("no income, no savings rate", noSpending.savingsRate, null);
check("no spending, no burn rate", noSpending.burnRate, null);
check("and no runway rather than an infinite one", noSpending.runwayMonths, null);
check("no income, no debt-to-income", noSpending.debtToIncome, null);
check("no limit, no utilisation", noSpending.creditUtilisation, null);

section("allocation by class");

const buckets = allocationByClass(balances);
check("four classes", buckets.length, 4);
check("property is the largest", buckets[0].label, "Property");
check("at 91.8% of assets", buckets[0].weight.toFixed(1), "91.8");
checkTrue(
  "and the weights sum to 100%",
  Math.abs(buckets.reduce((total, bucket) => total + bucket.weight.toApproximateNumber(), 0) - 100) < 0.01,
);
// Liabilities are excluded rather than netted: a mortgage would otherwise report a
// negative allocation to property.
checkTrue("liabilities are not in the allocation", !buckets.some((bucket) => bucket.value.isNegative));

/* ═══ The risk gate ═══════════════════════════════════════════════════ */

section("the risk gate — fail closed");

const sensibleLimits: RiskLimits = {
  maxPositionShare: Percentage.of("20"),
  maxExposureShare: Percentage.of("40"),
  maxOrderValue: rupees("200000"),
  fatFingerTolerance: Percentage.of("10"),
  maxDailyLoss: rupees("25000"),
  maxOrdersPerWindow: 10,
  windowMinutes: 60,
  killSwitchEngaged: false,
  availableMargin: rupees("500000"),
};

const context: RiskContext = {
  portfolioValue: rupees("1000000"),
  positionValue: rupees("50000"),
  exposureValue: rupees("200000"),
  lossToday: rupees("0"),
  ordersInWindow: 2,
  keyAlreadyUsed: false,
  unitsHeld: units("100"),
};

const intent: OrderIntent = {
  idempotencyKey: "order-1",
  requestedOn: on("2026-08-24"),
  instrumentId: "instrument-infy",
  symbol: "INFY",
  side: "BUY",
  orderType: "LIMIT",
  quantity: units("50"),
  limitPrice: rupees("1500"),
  referencePrice: rupees("1490"),
};

const gate = new RiskGate(sensibleLimits);
const decision = gate.evaluate(intent, context);
check("a reasonable order passes", decision.allowed, true);
check("all ten checks ran", decision.results.length, 10);
checkTrue("and every one explains itself", decision.results.every((result) => result.because.length > 10));

section("an unconfigured limit blocks");

/*
 * The fail-closed rule applied to configuration. A user who has not said what they
 * consider a safe order size has not consented to any order size, and a shipped
 * default would be a judgement about someone the author has never met.
 */
const unconfigured = new RiskGate(noLimits()).evaluate(intent, context);
check("nothing is allowed", unconfigured.allowed, false);
checkTrue("the kill switch is on by default", unconfigured.blockedBy.includes("KILL_SWITCH"));
checkTrue("and the missing limits block too", unconfigured.blockedBy.includes("ORDER_SIZE"));
check("a new account cannot trade at all", noLimits().killSwitchEngaged, true);

section("each check, on its own");

const only = (overrides: Partial<RiskLimits>, ctx: Partial<RiskContext> = {}, order: Partial<OrderIntent> = {}) =>
  new RiskGate({ ...sensibleLimits, ...overrides }).evaluate(
    { ...intent, ...order },
    { ...context, ...ctx },
  );

check("the kill switch blocks", only({ killSwitchEngaged: true }).blockedBy.includes("KILL_SWITCH"), true);
check(
  "a reused key blocks — it is a retry, not a second order",
  only({}, { keyAlreadyUsed: true }).blockedBy.includes("IDEMPOTENCY"),
  true,
);
check(
  "a blank key blocks (I05)",
  only({}, {}, { idempotencyKey: "  " }).blockedBy.includes("IDEMPOTENCY"),
  true,
);
check(
  "an order above the size limit blocks",
  only({ maxOrderValue: rupees("50000") }).blockedBy.includes("ORDER_SIZE"),
  true,
);
check(
  "a fat finger blocks",
  only({}, {}, { limitPrice: rupees("15000") }).blockedBy.includes("FAT_FINGER"),
  true,
);
check(
  "a market order has no price to mistype",
  only({}, {}, { orderType: "MARKET", limitPrice: null }).blockedBy.includes("FAT_FINGER"),
  false,
);
check(
  "a position breaching its share blocks",
  only({ maxPositionShare: Percentage.of("5") }).blockedBy.includes("POSITION_LIMIT"),
  true,
);
check(
  "an exposure breaching its share blocks",
  only({ maxExposureShare: Percentage.of("10") }).blockedBy.includes("EXPOSURE_LIMIT"),
  true,
);
check(
  "the daily loss limit stops trading",
  only({}, { lossToday: rupees("30000") }).blockedBy.includes("DAILY_LOSS"),
  true,
);
check(
  "a burst of orders blocks",
  only({}, { ordersInWindow: 10 }).blockedBy.includes("RATE_LIMIT"),
  true,
);
check(
  "insufficient margin blocks",
  only({ availableMargin: rupees("1000") }).blockedBy.includes("MARGIN"),
  true,
);
check(
  "selling more than is held blocks (P04)",
  only({}, { unitsHeld: units("10") }, { side: "SELL" }).blockedBy.includes("SHORT_SELL"),
  true,
);

section("a blocked order cannot become an approved one");

const refused = new RiskGate({ ...sensibleLimits, killSwitchEngaged: true }).approve(intent, context);
check("approve refuses", refused.ok, false);
checkTrue("and hands back the decision", !refused.ok && refused.decision.blockedBy.length > 0);

const approved = gate.approve(intent, context);
checkTrue("a passing order is approved", approved.ok);
checkTrue(
  "and the approval carries the decision that produced it",
  approved.ok && approved.order.decision.allowed,
);

section("there is no broker path to bypass");

/*
 * The other half of the plan's instruction: "an order cannot reach a broker without
 * passing the gate". Today it cannot because there is no broker adapter at all, and
 * that is worth asserting so the absence is deliberate rather than incidental — the
 * day someone adds one, this test tells them the gate is the way in.
 */
import { readFileSync, readdirSync } from "node:fs";

const BROKER_MARKERS = ["placeOrder", "kiteconnect", "smartapi", "broker.order", "/orders"];
const offenders: string[] = [];
for (const directory of ["src/domain", "src/app", "src/infra"]) {
  for (const file of readdirSync(directory)) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(`${directory}/${file}`, "utf8");
    for (const marker of BROKER_MARKERS) {
      if (source.includes(marker)) offenders.push(`${directory}/${file} mentions ${marker}`);
    }
  }
}
checkDeep("no module anywhere talks to a broker", offenders, []);

/* ═══ Physical assets ═════════════════════════════════════════════════ */

section("valuation by assertion");

const propertyAccount = Account.open({
  userId,
  code: AccountCode.parse("Assets:Property:Flat"),
  name: "Flat in Bhubaneswar",
  type: AccountType.ASSET,
  subtype: "REAL_ESTATE",
});

const valuations: AssertedValuation[] = [
  { on: on("2023-06-01"), value: rupees("7500000"), source: "PURCHASE_PRICE" },
  { on: on("2026-03-01"), value: rupees("9200000"), source: "PROFESSIONAL_VALUATION", note: "HDFC valuation" },
];
const flat = new RealEstate(propertyAccount, valuations);

check("the latest valuation wins", flat.valueOn(on("2026-08-24"))?.toDecimalString(), "9200000.00");
check("a date before it sees the older one", flat.valueOn(on("2025-01-01"))?.toDecimalString(), "7500000.00");
check("and a date before any is unknown, not zero", flat.valueOn(on("2020-01-01")), null);
check("the source is carried", flat.valuationOn(on("2026-08-24"))?.valuation.source, "PROFESSIONAL_VALUATION");
check("with its age", flat.valuationOn(on("2026-08-24"))?.ageDays, 176);
checkTrue("a six-month-old professional valuation is not stale", !flat.valuationOn(on("2026-08-24"))!.isStale);
checkTrue(
  "but a two-year-old one is",
  flat.valuationOn(on("2028-03-01"))!.isStale,
);

const selfAssessed = new RealEstate(propertyAccount, [
  { on: on("2026-01-01"), value: rupees("9000000"), source: "SELF_ASSESSED" },
]);
checkTrue(
  "a self-assessed valuation goes stale in three months, not a year",
  selfAssessed.valuationOn(on("2026-06-01"))!.isStale,
);

section("a vehicle depreciates, but only if asked");

const carAccount = Account.open({
  userId,
  code: AccountCode.parse("Assets:Vehicles:Car"),
  name: "Car",
  type: AccountType.ASSET,
  subtype: "VEHICLE",
});
const car = new Vehicle(carAccount, [], { on: on("2024-04-01"), price: rupees("1200000") });
check("no assertion means no value", car.valueOn(on("2026-08-24")), null);
// 15% a year for two whole years: 1,200,000 → 1,020,000 → 867,000.
check("but a depreciated figure is available on request", car.depreciatedValueOn(on("2026-08-24"))?.toDecimalString(), "867000.00");

section("physical gold, adjusted for purity");

const goldAccount = Account.open({
  userId,
  code: AccountCode.parse("Assets:Jewellery:Bangles"),
  name: "Bangles",
  type: AccountType.ASSET,
  subtype: "PRECIOUS_METAL",
});
const bangles = new PhysicalGold(goldAccount, [], units("48.5"), "22K");
// 48.5g at ₹7,200/g is ₹3,49,200 of 24-carat gold; 22-carat is 91.6% of that.
check("22-carat is valued at 91.6% of the rate", bangles.valueFromRate(UnitPrice.of("7200")).toDecimalString(), "319867.20");
check(
  "24-carat is not discounted",
  new PhysicalGold(goldAccount, [], units("48.5"), "24K").valueFromRate(UnitPrice.of("7200")).toDecimalString(),
  "349200.00",
);

/* ═══ ESOPs ═══════════════════════════════════════════════════════════ */

section("an ESOP grant");

const esopAccount = Account.open({
  userId,
  code: AccountCode.parse("Assets:ESOPs:Ananda"),
  name: "Ananda Ltd ESOPs",
  type: AccountType.ASSET,
  subtype: "OTHER",
});

const grant = new EsopGrant(esopAccount, {
  grantedOn: on("2024-04-01"),
  totalOptions: units("4000"),
  strikePrice: rupees("100"),
  fairMarketValue: rupees("450"),
  listed: false,
  vesting: [
    { on: on("2025-04-01"), options: units("1000") },
    { on: on("2026-04-01"), options: units("1000") },
    { on: on("2027-04-01"), options: units("1000") },
    { on: on("2028-04-01"), options: units("1000") },
  ],
});

check("nothing has vested before the first anniversary", grant.vestedOn(on("2025-03-31")).toDecimalString(), "0");
check("a quarter vests on it", grant.vestedOn(on("2025-04-01")).toDecimalString(), "1000");
check("half by the second", grant.vestedOn(on("2026-04-01")).toDecimalString(), "2000");
// The fact that matters for net worth: unvested options are a promise, not an asset.
check("and the rest is unvested", grant.unvestedOn(on("2026-04-01")).toDecimalString(), "2000");
check(
  "so the value counts only what is exercisable",
  grant.intrinsicValueOn(on("2026-04-01"))?.toDecimalString(),
  // 2,000 × (450 − 100)
  "700000.00",
);
check(
  "an underwater grant is worth nothing, not a negative amount",
  new EsopGrant(esopAccount, { ...grant.terms, fairMarketValue: rupees("50") })
    .intrinsicValueOn(on("2026-04-01"))
    ?.toDecimalString(),
  "0.00",
);
check(
  "with no fair market value there is no figure",
  new EsopGrant(esopAccount, { ...grant.terms, fairMarketValue: null }).intrinsicValueOn(on("2026-04-01")),
  null,
);

const partlyExercised = new EsopGrant(esopAccount, { ...grant.terms, exercised: units("500") });
check("exercised options are not counted twice", partlyExercised.exercisableOn(on("2026-04-01")).toDecimalString(), "1500");

section("the ESOP tax trap");

/*
 * The spread at exercise is **salary income**, taxed at slab in the year of
 * exercise, whether or not a share is sold — and for an unlisted company there is
 * no market to sell into to fund the bill. Then the capital gain runs from
 * exercise, on the FMV at exercise as its basis: using the strike would tax the
 * spread twice.
 */
check(
  "the spread at exercise is taxable income",
  grant.exerciseTaxableIncome(units("1000"), rupees("500")).toDecimalString(),
  "400000.00",
);
check(
  "and the shares' basis afterwards is the FMV, not the strike",
  grant.costBasisAfterExercise(units("1000"), rupees("500")).toDecimalString(),
  "500000.00",
);
check("the holding period runs from exercise", grant.gainTermFrom(on("2026-04-01"), on("2027-04-01")).days, 365);
check("and unlisted needs 24 months, not 12", grant.gainTermFrom(on("2026-04-01"), on("2027-04-01")).longTerm, false);
check(
  "two years does it",
  grant.gainTermFrom(on("2026-04-01"), on("2028-04-01")).longTerm,
  true,
);
check(
  "a listed company needs only twelve months",
  new EsopGrant(esopAccount, { ...grant.terms, listed: true })
    .gainTermFrom(on("2026-04-01"), on("2027-04-01"))
    .longTerm,
  true,
);

throws(
  "a vesting schedule cannot promise more than the grant",
  () =>
    new EsopGrant(esopAccount, {
      ...grant.terms,
      totalOptions: units("1000"),
    }),
  "against a total of",
);

/* ═══ Gold lease ══════════════════════════════════════════════════════ */

section("a gold lease");

const leaseAccount = Account.open({
  userId,
  code: AccountCode.parse("Assets:Jewellery:Leased"),
  name: "Leased gold",
  type: AccountType.ASSET,
  subtype: "PRECIOUS_METAL",
});

const lease = new GoldLease(leaseAccount, {
  grams: units("100"),
  leasedOn: on("2026-04-01"),
  returnsOn: on("2027-04-01"),
  annualRate: Rate.annual("3"),
  paidIn: "GRAMS",
  counterparty: "SafeGold",
});

check("a year at 3% earns three grams", lease.rentInGramsTo(on("2027-04-01")).toDecimalString(), "3");
// 183 days of 365 at 3% on 100g. Truncated at the eighth decimal rather than
// rounded, because the division is exact-integer: a gram is not created by rounding.
check("half a year earns about one and a half", lease.rentInGramsTo(on("2026-10-01")).toDecimalString(), "1.50410958");
check("so the holding grows without any money moving", lease.totalGramsOn(on("2027-04-01")).toDecimalString(), "103");
check(
  "valued at a rate, that is",
  lease.valueFromRate(UnitPrice.of("7200"), on("2027-04-01")).toDecimalString(),
  "741600.00",
);
check("rent stops at the return date", lease.rentInGramsTo(on("2028-04-01")).toDecimalString(), "3");

const cashLease = new GoldLease(leaseAccount, { ...lease.terms, paidIn: "MONEY" });
check("a cash lease earns no grams", cashLease.rentInGramsTo(on("2027-04-01")).toDecimalString(), "0");
check(
  "it earns money instead",
  cashLease.rentInMoneyTo(on("2027-04-01"), UnitPrice.of("7200")).toDecimalString(),
  "21600.00",
);

checkTrue(
  "and the counterparty risk is named rather than discounted away",
  lease.riskNote(on("2026-10-01")).includes("SafeGold"),
);
checkTrue("including when it is overdue", lease.riskNote(on("2027-06-01")).includes("due back"));

throws(
  "a lease must return after it starts",
  () => new GoldLease(leaseAccount, { ...lease.terms, returnsOn: on("2026-03-01") }),
  "must return after",
);

done();
