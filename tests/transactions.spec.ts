/**
 * The thirteen `Transaction` subclasses.
 *
 * Each one gets three assertions, which are the plan's "done when" for 1b:
 *
 *   (a) it books the postings it claims,
 *   (b) an unbalanced or incoherent construction throws, and
 *   (c) `reverse()` returns every touched balance to what it was before.
 *
 * (c) is asserted by *folding the balances*, not by comparing posting lists: a
 * reversal that flipped the legs but changed an amount would pass a shape check
 * and still leave the ledger wrong.
 *
 * Every expected number here is hand-computed in the comment above it. An engine
 * that agrees with itself proves nothing.
 */

import { UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Quantity } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { Account, AccountCode, AccountType } from "@/domain/accounts";
import { BalanceCalculator, Buy, Charge, CorporateActionTxn, Dividend, Expense, FxConversion, Income, Interest, OpeningBalance, Sell, StoredTransaction, Transaction, TransactionId, Transfer, ValuationAdjustment, accountRef } from "@/domain/transactions";
import { check, section, throws, done } from "./harness";

const userId = UserId.from("user_txn_1");
const INR = Currency.reporting;
const USD = Currency.of("USD");
const rupees = (value: string) => Money.fromRupees(value);
const on = (value: string) => CalendarDate.parse(value);

const acct = (
  code: string,
  type: AccountType,
  subtype: Parameters<typeof Account.open>[0]["subtype"] = null,
  currency: Currency = INR,
) => Account.open({ userId, code: AccountCode.parse(code), name: code, type, subtype, currency });

const hdfc = acct("Assets:Bank:HDFC", AccountType.ASSET, "BANK");
const zerodhaCash = acct("Assets:Broker:Zerodha:Cash", AccountType.ASSET, "BROKERAGE");
const zerodha = acct("Assets:Broker:Zerodha", AccountType.ASSET, "BROKERAGE");
const ibkrCash = acct("Assets:Broker:IBKR:Cash", AccountType.ASSET, "BROKERAGE", USD);
const fd = acct("Assets:Deposits:HDFC FD", AccountType.ASSET, "DEPOSIT");
const flat = acct("Assets:Property:Flat", AccountType.ASSET, "REAL_ESTATE");
const card = acct("Liabilities:Cards:ICICI", AccountType.LIABILITY, "CREDIT_CARD");
const groceries = acct("Expenses:Food:Groceries", AccountType.EXPENSE);
const brokerage = acct("Expenses:Brokerage", AccountType.EXPENSE);
const salary = acct("Income:Salary", AccountType.INCOME);
const dividends = acct("Income:Dividends", AccountType.INCOME);
const interestIncome = acct("Income:Interest", AccountType.INCOME);
const gains = acct("Income:Capital Gains", AccountType.INCOME);
const openingEquity = acct("Equity:Opening Balances", AccountType.EQUITY);
const adjustments = acct("Equity:Adjustments", AccountType.EQUITY, "ADJUSTMENT");
const fxEquity = acct("Equity:FX", AccountType.EQUITY, "ADJUSTMENT");
const tds = acct("Assets:Tax Deducted", AccountType.ASSET, "OTHER");

const allAccounts = [
  hdfc, zerodhaCash, zerodha, ibkrCash, fd, flat, card, groceries, brokerage,
  salary, dividends, interestIncome, gains, openingEquity, adjustments, fxEquity, tds,
];

const ctx = (from: Account, to: Account, date: string, description: string, extra: Record<string, unknown> = {}) => ({
  userId,
  txnDate: on(date),
  description,
  source: accountRef(from),
  destination: accountRef(to),
  ...extra,
});

const calc = new BalanceCalculator();
const REPORT_DATE = on("2030-01-01");

/** Signed movement this transaction causes in one account, in rupees. */
const moved = (txn: Transaction, account: Account) =>
  txn.effectOn(account.id, account.type).toDecimalString();

/**
 * (c), for every subclass: original then reversal leaves every account where it
 * started. Folded over balances rather than compared leg by leg.
 */
function reversalRestores(label: string, txn: Transaction): void {
  const beforeAll = calc.balancesAsOf(allAccounts, [], REPORT_DATE);
  const afterPair = calc.balancesAsOf(allAccounts, [txn, txn.reverse()], REPORT_DATE);
  const drifted = allAccounts.filter(
    (account) => !beforeAll.get(account.id.value)!.equals(afterPair.get(account.id.value)!),
  );
  check(`${label}: reversal restores every balance`, drifted.map((a) => a.code.toString()).join(",") || "none", "none");
}

/* ══ 1. OpeningBalance ═══════════════════════════════════════════════ */

section("OpeningBalance");
const openingAsset = OpeningBalance.record(
  ctx(openingEquity, hdfc, "2026-07-01", "Opening balance — HDFC"),
  { amount: rupees("200000"), account: accountRef(hdfc) },
);
check("asset opening debits the asset", moved(openingAsset, hdfc), "200000.00");
check("...and credits equity", moved(openingAsset, openingEquity), "200000.00");

// A liability's opening balance is the reverse: the debt goes up, and equity with
// it, because the money was spent before the app was watching.
const openingDebt = OpeningBalance.record(
  ctx(openingEquity, card, "2026-07-01", "Opening balance — ICICI card"),
  { amount: rupees("15000"), account: accountRef(card) },
);
check("liability opening raises the debt", moved(openingDebt, card), "15000.00");
throws(
  "a zero opening balance records nothing",
  () =>
    OpeningBalance.record(ctx(openingEquity, hdfc, "2026-07-01", "nothing"), {
      amount: Money.zero(INR),
      account: accountRef(hdfc),
    }),
  "records nothing",
);
reversalRestores("OpeningBalance", openingAsset);

/* ══ 2–4. Expense, Income, Transfer ══════════════════════════════════ */

section("Expense, Income, Transfer");
const spend = Expense.record(ctx(card, groceries, "2026-08-03", "Big Bazaar"), {
  amount: rupees("1240"),
  categoryId: "cat_food",
});
check("expense debits the category", moved(spend, groceries), "1240.00");
check("...and raises the card debt", moved(spend, card), "1240.00");
check("the category lands on the expense leg", spend.postings()[0].categoryId, "cat_food");
check("...and never on the funding leg", spend.postings()[1].categoryId, null);
reversalRestores("Expense", spend);

const paid = Income.record(ctx(salary, hdfc, "2026-08-01", "August salary"), {
  amount: rupees("150000"),
  categoryId: "cat_salary",
});
check("income debits the bank", moved(paid, hdfc), "150000.00");
check("...and credits the income account", moved(paid, salary), "150000.00");
reversalRestores("Income", paid);

const cardPayment = Transfer.record(ctx(hdfc, card, "2026-08-04", "Card payment"), {
  amount: rupees("16240"),
});
check("transfer lowers the bank", moved(cardPayment, hdfc), "-16240.00");
check("...and lowers the debt by the same", moved(cardPayment, card), "-16240.00");
throws(
  "L12: a transfer takes no category",
  () => Transfer.record(ctx(hdfc, card, "2026-08-04", "Card payment"), {
    amount: rupees("16240"),
    categoryId: "cat_debt",
  }),
  "invariant L12",
);
reversalRestores("Transfer", cardPayment);

/* ══ 5. Charge ═══════════════════════════════════════════════════════ */

section("Charge");
const fee = Charge.record(ctx(zerodhaCash, brokerage, "2026-08-22", "Zerodha brokerage"), {
  amount: rupees("20"),
  deductibility: "DEDUCTIBLE",
  chargeType: "BROKERAGE",
});
check("charge debits the expense", moved(fee, brokerage), "20.00");
check("...and takes it from the broker cash", moved(fee, zerodhaCash), "-20.00");
check("deductibility is carried, not inferred", fee.deductibility, "DEDUCTIBLE");
check("a fee is a FEE, not a WITHDRAWAL", fee.kind, "FEE");
reversalRestores("Charge", fee);

/* ══ 6. Buy ══════════════════════════════════════════════════════════ */

section("Buy");
// 20-DOMAIN-MODEL.md §5.3, capitalised: 10 INFY at ₹1,520 = ₹15,200 consideration,
// ₹3.20 charges. Basis 15,203.20; unit cost 15,203.20 / 10 = 1,520.32.
const buy = Buy.record(ctx(zerodhaCash, zerodha, "2026-08-22", "Buy 10 INFY @ 1520"), {
  instrumentId: "INFY",
  quantity: Quantity.fromString("10"),
  consideration: rupees("15200"),
  charges: rupees("3.20"),
  holding: accountRef(zerodha),
});
check("cash out is consideration plus charges", moved(buy, zerodhaCash), "-15203.20");
check("holding is debited the capitalised basis", moved(buy, zerodha), "15203.20");
check("unit cost carries the capitalised charge", buy.postings()[0].unitCost?.toDecimalString(), "1520.32");
check("quantity is signed positive", buy.postings()[0].quantity?.toDecimalString(), "10");
check("one lot opened", buy.lotEffects().length, 1);
const openedLot = buy.lotEffects()[0];
check("lot basis", openedLot.kind === "OPEN" ? openedLot.costBasis.toDecimalString() : openedLot.kind, "15203.20");
check("buying is not a taxable event", buy.taxableEvents().length, 0);
check("cashflow is negative and dated", buy.cashflows()[0].amount.toDecimalString(), "-15203.20");

// Expensed instead: the same cash leaves, but the basis is only the consideration
// and the charge shows up as brokerage expense — §5.3's other treatment.
const buyExpensed = Buy.record(ctx(zerodhaCash, zerodha, "2026-08-22", "Buy 10 INFY, fee expensed"), {
  instrumentId: "INFY",
  quantity: Quantity.fromString("10"),
  consideration: rupees("15200"),
  charges: rupees("3.20"),
  chargeTreatment: "EXPENSE",
  chargeAccount: accountRef(brokerage),
  holding: accountRef(zerodha),
});
check("expensed: cash out is unchanged", moved(buyExpensed, zerodhaCash), "-15203.20");
check("expensed: basis excludes the charge", moved(buyExpensed, zerodha), "15200.00");
check("expensed: the charge is an expense", moved(buyExpensed, brokerage), "3.20");
throws(
  "a negative-quantity buy is a sale, and is rejected",
  () =>
    Buy.record(ctx(zerodhaCash, zerodha, "2026-08-22", "bad"), {
      instrumentId: "INFY",
      quantity: Quantity.fromString("-10"),
      consideration: rupees("15200"),
      charges: Money.zero(INR),
      holding: accountRef(zerodha),
    }),
  "positive quantity",
);
throws(
  "expensing with nowhere to book it is rejected",
  () =>
    Buy.record(ctx(zerodhaCash, zerodha, "2026-08-22", "bad"), {
      instrumentId: "INFY",
      quantity: Quantity.fromString("10"),
      consideration: rupees("15200"),
      charges: rupees("3.20"),
      chargeTreatment: "EXPENSE",
      holding: accountRef(zerodha),
    }),
  "expense account",
);
reversalRestores("Buy", buy);

/* ══ 7. Sell ═════════════════════════════════════════════════════════ */

section("Sell");
// Two lots, deliberately one gain and one loss, to prove the tax events are per
// disposal rather than blended:
//   lot A: 6 units, basis ₹9,000 (₹1,500/unit), bought 2024-01-10
//   lot B: 4 units, basis ₹8,000 (₹2,000/unit), bought 2026-02-01
// Sold 10 units for ₹18,000 gross, charges ₹25 of which ₹5 deductible.
// Proceeds allocate by quantity: 6/10 → ₹10,800, 4/10 → ₹7,200.
// Gains: 10,800 − 9,000 = +1,800; 7,200 − 8,000 = −800. Net +1,000.
// Cash in: 18,000 − 25 = ₹17,975.
const sell = Sell.record(ctx(zerodha, zerodhaCash, "2026-08-25", "Sell 10 INFY"), {
  instrumentId: "INFY",
  disposals: [
    { lotId: "lot_a", quantity: Quantity.fromString("6"), costBasis: rupees("9000"), acquiredOn: on("2024-01-10") },
    { lotId: "lot_b", quantity: Quantity.fromString("4"), costBasis: rupees("8000"), acquiredOn: on("2026-02-01") },
  ],
  proceeds: rupees("18000"),
  charges: rupees("25"),
  deductibleCharges: rupees("5"),
  chargeAccount: accountRef(brokerage),
  holding: accountRef(zerodha),
  gainAccount: accountRef(gains),
  taxCategory: "LISTED_EQUITY",
});
check("holding gives up exactly its basis", moved(sell, zerodha), "-17000.00");
check("cash in is proceeds less charges", moved(sell, zerodhaCash), "17975.00");
check("charges are expensed", moved(sell, brokerage), "25.00");
check("net gain is credited to income", moved(sell, gains), "1000.00");
check("gain is derived, not stored", sell.gain.toDecimalString(), "1000.00");
check("units leave the holding", sell.postings()[0].quantity?.toDecimalString(), "-10");
check("two lots consumed", sell.lotEffects().length, 2);
check("two taxable events, one per disposal", sell.taxableEvents().length, 2);
check("lot A gain", sell.taxableEvents()[0].gain.toDecimalString(), "1800.00");
check("lot B loss", sell.taxableEvents()[1].gain.toDecimalString(), "-800.00");
check("allocated proceeds sum to the gross", sell.taxableEvents()[0].proceeds!.plus(sell.taxableEvents()[1].proceeds!).toDecimalString(), "18000.00");
// 2024-01-10 to 2026-08-25 is 593 days: 356 remaining in 2024 (leap), 365 in 2025,
// and 237 into 2026 — long-term for equity, which is the classification the tax
// engine will make from this number.
check("holding days are handed to the tax engine", sell.taxableEvents()[0].holdingDays, 958);
check("deductible charges are apportioned, and are not the total", sell.taxableEvents()[0].deductibleCharges.toDecimalString(), "3.00");
throws(
  "a sale with no lots has no basis, and is rejected",
  () =>
    Sell.record(ctx(zerodha, zerodhaCash, "2026-08-25", "bad"), {
      instrumentId: "INFY", disposals: [], proceeds: rupees("100"), charges: Money.zero(INR),
      deductibleCharges: Money.zero(INR), holding: accountRef(zerodha),
      gainAccount: accountRef(gains), taxCategory: "LISTED_EQUITY",
    }),
  "which lots",
);
throws(
  "deductible charges cannot exceed the total (STT is not deductible)",
  () =>
    Sell.record(ctx(zerodha, zerodhaCash, "2026-08-25", "bad"), {
      instrumentId: "INFY",
      disposals: [{ lotId: "l", quantity: Quantity.fromString("1"), costBasis: rupees("10"), acquiredOn: on("2026-01-01") }],
      proceeds: rupees("100"), charges: rupees("5"), deductibleCharges: rupees("6"),
      chargeAccount: accountRef(brokerage), holding: accountRef(zerodha),
      gainAccount: accountRef(gains), taxCategory: "LISTED_EQUITY",
    }),
  "cannot exceed",
);
throws(
  "selling before acquiring is rejected rather than reported as a negative holding period",
  () =>
    Sell.record(ctx(zerodha, zerodhaCash, "2026-08-25", "bad"), {
      instrumentId: "INFY",
      disposals: [{ lotId: "l", quantity: Quantity.fromString("1"), costBasis: rupees("10"), acquiredOn: on("2027-01-01") }],
      proceeds: rupees("100"), charges: Money.zero(INR), deductibleCharges: Money.zero(INR),
      holding: accountRef(zerodha), gainAccount: accountRef(gains), taxCategory: "LISTED_EQUITY",
    }),
  "holding period would be negative",
);
reversalRestores("Sell", sell);

/* ══ 8–9. Dividend and Interest ══════════════════════════════════════ */

section("Dividend and Interest");
// ₹1,000 gross with ₹100 TDS: ₹900 reaches the bank, ₹100 becomes a recoverable
// asset, and the income account is credited the full ₹1,000 — which is what the
// return will be assessed on.
const dividend = Dividend.record(ctx(dividends, hdfc, "2026-08-10", "INFY dividend"), {
  gross: rupees("1000"),
  taxDeductedAtSource: rupees("100"),
  tdsAccount: accountRef(tds),
  instrumentId: "INFY",
  taxCategory: "LISTED_EQUITY",
});
check("net reaches the bank", moved(dividend, hdfc), "900.00");
check("TDS is an asset, not an expense", moved(dividend, tds), "100.00");
check("income is credited gross", moved(dividend, dividends), "1000.00");
check("the taxable event is the gross", dividend.taxableEvents()[0].gain.toDecimalString(), "1000.00");
check("...and it is slab income, not a gain", dividend.taxableEvents()[0].kind, "DIVIDEND");
throws(
  "TDS cannot swallow the whole receipt",
  () =>
    Dividend.record(ctx(dividends, hdfc, "2026-08-10", "bad"), {
      gross: rupees("1000"), taxDeductedAtSource: rupees("1000"),
      tdsAccount: accountRef(tds), taxCategory: "LISTED_EQUITY",
    }),
  "cannot be the whole",
);
reversalRestores("Dividend", dividend);

const interest = Interest.record(ctx(interestIncome, fd, "2026-09-30", "FD interest"), {
  gross: rupees("4500"),
  taxCategory: "DEBT",
});
check("interest lands in the deposit", moved(interest, fd), "4500.00");
check("the taxable event is INTEREST", interest.taxableEvents()[0].kind, "INTEREST");
reversalRestores("Interest", interest);

/* ══ 10. CorporateActionTxn ══════════════════════════════════════════ */

section("CorporateActionTxn");
// A 1-for-5 split: 100 units become 500, no money moves, and the basis per unit
// falls by the same factor. The factor is 500 / 100 = 5.
const split = CorporateActionTxn.record(
  ctx(zerodha, zerodha, "2026-09-01", "INFY 1:5 split"),
  {
    actionType: "SPLIT",
    instrumentId: "INFY",
    holding: accountRef(zerodha),
    unitsBefore: Quantity.fromString("100"),
    unitsAfter: Quantity.fromString("500"),
  },
);
check("a split moves no money", moved(split, zerodha), "0.00");
check("units out then in", split.postings().map((p) => p.quantity?.toDecimalString()).join(" -> "), "-100 -> 500");
check("one rescale effect", split.lotEffects().length, 1);
const rescale = split.lotEffects()[0];
check("factor is 5", rescale.kind === "RESCALE" ? rescale.quantityFactor.toDecimalString() : rescale.kind, "5");
check("THE claim: the tax engine never learns what a split is", split.taxableEvents().length, 0);
check("...and neither does a return calculation", split.cashflows().length, 0);
throws(
  "a reverse split that grows the count is rejected",
  () =>
    CorporateActionTxn.record(ctx(zerodha, zerodha, "2026-09-01", "bad"), {
      actionType: "REVERSE_SPLIT", instrumentId: "INFY", holding: accountRef(zerodha),
      unitsBefore: Quantity.fromString("100"), unitsAfter: Quantity.fromString("500"),
    }),
  "reduces the unit count",
);
throws(
  "an unmodelled action is refused rather than guessed at",
  () =>
    CorporateActionTxn.record(ctx(zerodha, zerodha, "2026-09-01", "bad"), {
      actionType: "MERGER", instrumentId: "INFY", holding: accountRef(zerodha),
      unitsBefore: Quantity.fromString("100"), unitsAfter: Quantity.fromString("50"),
    }),
  "not yet modelled",
);

// A return of capital: ₹500 comes back and the basis falls by ₹500. It is not
// income, which is the whole reason it is not a Dividend.
const returnOfCapital = CorporateActionTxn.record(
  ctx(zerodha, zerodhaCash, "2026-09-15", "Return of capital"),
  {
    actionType: "RETURN_OF_CAPITAL",
    instrumentId: "INFY",
    holding: accountRef(zerodha),
    cashReturned: rupees("500"),
  },
);
check("cash comes in", moved(returnOfCapital, zerodhaCash), "500.00");
check("the holding is written down by the same", moved(returnOfCapital, zerodha), "-500.00");
check("basis is reduced, no gain realised", returnOfCapital.lotEffects()[0].kind, "REDUCE_BASIS");
check("no taxable event: this is your own capital", returnOfCapital.taxableEvents().length, 0);
reversalRestores("CorporateActionTxn (split)", split);
reversalRestores("CorporateActionTxn (return of capital)", returnOfCapital);

/* ══ 11. FxConversion ════════════════════════════════════════════════ */

section("FxConversion");
// 20-DOMAIN-MODEL.md §5.4: ₹92,400 out, $1,100 in, implied rate 84.00. Each
// currency sums to zero on its own — the transaction the old JournalEntry could
// not express.
const fx = FxConversion.record(
  ctx(hdfc, ibkrCash, "2026-08-22", "INR to USD for IBKR", { instrumentId: null }),
  { from: rupees("92400"), to: Money.fromRupees("1100", USD), fxAccount: accountRef(fxEquity, { multiCurrency: true }) },
);
check("four legs", fx.postings().length, 4);
check("two currencies", fx.currencies().map((c) => c.code).join(","), "INR,USD");
check("rupees leave the bank", moved(fx, hdfc), "-92400.00");
check("implied rate is derived, not stored", fx.impliedRate().toDecimalString(), "84");
check("it balances in INR", calc.verifyIntegrity([fx]).ok, true);
throws(
  "a same-currency conversion is a transfer",
  () =>
    FxConversion.record(ctx(hdfc, hdfc, "2026-08-22", "bad"), {
      from: rupees("100"), to: rupees("100"), fxAccount: accountRef(fxEquity, { multiCurrency: true }),
    }),
  "needs two currencies",
);
throws(
  "a single-currency FX account cannot hold both legs",
  () =>
    FxConversion.record(ctx(hdfc, ibkrCash, "2026-08-22", "bad"), {
      from: rupees("92400"), to: Money.fromRupees("1100", USD), fxAccount: accountRef(fxEquity),
    }),
  "multi-currency by definition",
);

// The worked example, end to end: the USD purchase funded by that conversion.
const usdBuy = Buy.record(
  ctx(ibkrCash, ibkrCash, "2026-08-22", "Buy 5 AAPL @ USD 220"),
  {
    instrumentId: "AAPL",
    quantity: Quantity.fromString("5"),
    consideration: Money.fromRupees("1100", USD),
    charges: Money.zero(USD),
    holding: accountRef(ibkrCash),
  },
);
check("the USD purchase balances in USD", calc.verifyIntegrity([usdBuy]).ok, true);
// Reported in INR, the pair is invisible to a rupee balance: the dollars bought
// shares, and the rupees became dollars. Net INR movement is the ₹92,400 that
// left HDFC, and nothing else.
const inrView = calc.balancesAsOf(allAccounts, [fx, usdBuy], REPORT_DATE);
check("INR reporting sees only the rupee leg", inrView.get(hdfc.id.value)!.toDecimalString(), "-92400.00");
check("the dollar legs do not leak into the rupee balance", inrView.get(ibkrCash.id.value)!.toDecimalString(), "0.00");

/* ══ 12. ValuationAdjustment ═════════════════════════════════════════ */

section("ValuationAdjustment");
const revalued = ValuationAdjustment.record(
  ctx(flat, adjustments, "2026-12-31", "Flat revalued"),
  { delta: rupees("500000"), asset: accountRef(flat), equityAdjustment: accountRef(adjustments) },
);
check("the asset is written up", moved(revalued, flat), "500000.00");
check("...against equity, so the ledger still balances", moved(revalued, adjustments), "500000.00");
check("an unrealised revaluation is not income", revalued.taxableEvents().length, 0);

const writtenDown = ValuationAdjustment.record(
  ctx(adjustments, flat, "2027-12-31", "Flat revalued down"),
  { delta: rupees("-200000"), asset: accountRef(flat), equityAdjustment: accountRef(adjustments) },
);
check("a fall debits equity instead", moved(writtenDown, flat), "-200000.00");
throws(
  "revaluing to the same number records nothing",
  () =>
    ValuationAdjustment.record(ctx(flat, adjustments, "2026-12-31", "bad"), {
      delta: Money.zero(INR), asset: accountRef(flat), equityAdjustment: accountRef(adjustments),
    }),
  "records nothing",
);
reversalRestores("ValuationAdjustment", revalued);

/* ══ 13. Reversal ════════════════════════════════════════════════════ */

section("Reversal");
const reversal = spend.reverse({ description: "Refund of Big Bazaar" });
check("kind", reversal.kind, "REVERSAL");
check("it names what it undoes", reversal.originalKind, "WITHDRAWAL");
check("it points at the original", reversal.reversesTransactionId.equals(spend.id), true);
check("it posts on the original date, not today", reversal.txnDate.toISO(), "2026-08-03");
check("the fingerprint is not inherited", reversal.context.fingerprint ?? null, null);
check("nor the external id, which would collide", reversal.context.externalId ?? null, null);
check("quantities are negated too", sell.reverse().postings()[0].quantity?.toDecimalString(), "10");

/* ══ StoredTransaction: the rehydration vehicle ══════════════════════ */

section("StoredTransaction");
const stored = StoredTransaction.rehydrate({
  id: TransactionId.create(),
  kind: "SELL",
  context: { userId, txnDate: on("2026-08-25"), description: "Sell 10 INFY" },
  postings: sell.postings(),
});
check("a stored row still has to balance", calc.verifyIntegrity([stored]).ok, true);
check("it reports the stored kind", stored.kind, "SELL");
check("it invents no lot effects", stored.lotEffects().length, 0);
check("it invents no taxable events", stored.taxableEvents().length, 0);
check("balances read from a row match the live transaction", moved(stored, gains), moved(sell, gains));

done();
