"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Currency, Money } from "@/core/money";
import { Quantity } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { AccountCode, AccountId, SystemAccountCodes, type Account } from "@/domain/accounts";
import { Lot } from "@/domain/lots";
import { accountRef, OpeningPosition } from "@/domain/transactions";
import { groupOfKind } from "@/domain/asset-groups";
import { InstitutionId } from "@/domain/institutions";
import type { CatalogSearchCandidateOutput, CatalogSearchOutput } from "@/domain/instrument-catalog";
import { InstrumentId, type InstrumentKind } from "@/domain/instruments";
import { catalogPortfolioIdentity } from "./entry-identity";
import { isPurityOf, metalDisplayName, metalPricing, type MetalKind } from "./new/metal-identity";

export interface InvestmentEntryActionState {
  ok: boolean;
  message: string;
  instrumentId?: string;
  cashPreview?: string;
  fieldErrors?: Record<string, string[]>;
}

export type InvestmentSearchResult = CatalogSearchOutput;
export type InvestmentSearchCandidate = CatalogSearchCandidateOutput;

/**
 * What a pasted figure is allowed to look like before it has to be a number.
 *
 * A receipt is copied, not retyped: "1,23,456.78", "₹ 5,000", "0.3481 g" all
 * arrive with punctuation that means nothing to the value. Rejecting those made
 * the form look broken for input that was never ambiguous, so the noise is
 * stripped first and only the digits are judged. Nothing here changes a value:
 * a decimal point is still a decimal point, and a figure with too many places
 * is still refused, because rounding someone's money silently is worse than
 * asking.
 */
const tidy = (value: unknown): unknown =>
  typeof value === "string" ? value.replace(/[\s,₹]/g, "").replace(/g$/i, "") : value;

const OPTIONAL_MONEY = z.preprocess(
  tidy,
  z
    .string()
    .regex(/^(\d+(\.\d{1,2})?)?$/, "Amounts are rupees and paise — at most two decimal places."),
);
const QUANTITY = z.preprocess(
  tidy,
  z.string().regex(/^\d+(\.\d{1,8})?$/, "Enter the quantity — up to eight decimal places."),
);

const KIND_VALUES = [
  "LISTED_EQUITY",
  "ETF",
  "INDEX_FUND",
  "MUTUAL_FUND",
  "LIQUID_FUND",
  "DEBT_FUND",
  "ELSS_FUND",
  "BOND",
  "GOVT_SECURITY",
  "SOVEREIGN_GOLD_BOND",
  "DIGITAL_GOLD",
  "DIGITAL_SILVER",
  "DIGITAL_PLATINUM",
  "REIT",
  "CRYPTO",
] as const satisfies readonly InstrumentKind[];

const entrySchema = z.object({
  identityMode: z.enum(["CATALOG", "MANUAL", "METAL"]),
  selectionConfirmed: z.literal("yes", { error: "Confirm the instrument identity first." }),
  catalogQuery: z.string().trim().max(160).optional().or(z.literal("")),
  catalogInstrumentId: z.string().trim().optional().or(z.literal("")),
  listingId: z.string().trim().optional().or(z.literal("")),
  symbol: z.string().trim().min(1, "Symbol is required.").max(40),
  name: z.string().trim().min(1, "Name is required.").max(160),
  kind: z.enum(KIND_VALUES),
  isin: z.string().trim().length(12).optional().or(z.literal("")),
  exchange: z.string().trim().max(16).optional().or(z.literal("")),
  currency: z.enum(["INR", "USD"]),
  /* Metal lane only. Whitelisted below against the metal it arrived with. */
  quoteRef: z.string().trim().max(16).optional().or(z.literal("")),
  side: z.enum(["BUY", "SELL"]),
  tradedOn: z.string().trim().min(1, "Trade date is required."),
  quantity: QUANTITY,
  unitPrice: OPTIONAL_MONEY.optional().or(z.literal("")),
  /* Metals lane only: the receipt total, from which the rate is derived. */
  totalAmount: OPTIONAL_MONEY.optional().or(z.literal("")),
  settlementAccountId: z.string().uuid("Choose the cash account.").optional().or(z.literal("")),
  institutionId: z.string().trim().optional().or(z.literal("")),
  newPlatformName: z.string().trim().max(120).optional().or(z.literal("")),
  brokerage: OPTIONAL_MONEY.optional().or(z.literal("")),
  exchangeFees: OPTIONAL_MONEY.optional().or(z.literal("")),
  statutoryCharges: OPTIONAL_MONEY.optional().or(z.literal("")),
  taxWithheld: OPTIONAL_MONEY.optional().or(z.literal("")),
  deductibleCharges: OPTIONAL_MONEY.optional().or(z.literal("")),
  method: z.enum(["FIFO", "LIFO", "HIFO", "AVERAGE_COST", "SPECIFIC_ID"]).optional(),
});

type EntryInput = z.infer<typeof entrySchema>;

const NEW_PLATFORM = "__new__";
const SUGGESTED_PLATFORM = "__suggested__:";

/**
 * At most one catalogue refresh runs per process, and no keystroke ever waits
 * for a second one.
 *
 * The refresh walks five public masters — the Upstox NSE and BSE dumps, AMFI,
 * SEC — and a source with no successful fetch on record is retried on every
 * call. Awaiting that under the cursor is what made a search sit on
 * "Searching..." until a provider's socket timed out, and it did so once per
 * debounce.
 */
let catalogRefresh: Promise<unknown> | null = null;

function refreshCatalogOnce(
  serviceBag: Awaited<ReturnType<typeof import("@/infra/container").services>>,
): Promise<unknown> {
  catalogRefresh ??= serviceBag.instrumentCatalog.refresh
    .execute()
    /* A refresh that fails leaves the cache in place; search is unaffected. */
    .catch(() => undefined)
    .finally(() => {
      catalogRefresh = null;
    });
  return catalogRefresh;
}

/**
 * The as-you-type search behind `/investments/new`.
 *
 * A server function is reachable by a direct POST, not only through the
 * combobox, so the sign-in check is here rather than left to the page that
 * renders it — `currentUserId` throws when there is no session.
 *
 * The catalogue is read first and refreshed second (C10: an ingest is never a
 * keystroke dependency). Only a genuinely empty cache blocks, because there is
 * nothing else to show; a merely stale one is refreshed in `after`, once the
 * response has gone out.
 */
export async function searchInstrumentCatalogAction(query: string): Promise<InvestmentSearchResult> {
  const { currentUserId, services } = await import("@/infra/container");
  await currentUserId();
  const serviceBag = services();

  const first = await serviceBag.instrumentCatalog.search.execute({ query, limit: 12 });
  if (first.cache.status === "EMPTY") {
    await refreshCatalogOnce(serviceBag);
    return serviceBag.instrumentCatalog.search.execute({ query, limit: 12 });
  }

  const { after } = await import("next/server");
  if (first.cache.stale) after(() => refreshCatalogOnce(serviceBag));

  /*
   * Probe the rows this search just showed, after the response.
   *
   * The offline sweep is budgeted at 200 listings a run against a catalogue of
   * ~17 000, so a row nobody has swept yet reads "Not priceable" for months
   * even though a price source would accept it today. Twelve probes, scheduled
   * once the answer has already been sent, is not the sweep moving under the
   * cursor — and `listingsForQuoteKeyProbe` keeps the due-ness filter, so the
   * next keystroke over the same rows costs one query and no requests.
   */
  const unchecked = first.candidates
    .filter((candidate) => !candidate.quoteChecked)
    .map((candidate) => candidate.listing.id);
  if (unchecked.length > 0) {
    after(() => serviceBag.marketData.reconcileQuoteKeys.reconcileListings(unchecked).catch(() => undefined));
  }
  return first;
}

export async function recordInvestmentEntryAction(
  _previous: InvestmentEntryActionState | null,
  formData: FormData,
): Promise<InvestmentEntryActionState> {
  const parsed = entrySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the investment entry.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  const values = parsed.data;
  let identity;
  try {
    identity = await resolveIdentity(values);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  const currency = Currency.of(identity.currency);
  const pricing = resolvePricing(values, currency);
  if (!pricing.ok) return pricing.state;
  const preview = cashPreview(values, pricing.quantity, pricing.pricePerUnit, currency);
  if (!preview.ok) return { ok: false, message: preview.message };

  const { currentUserId, ensureSeeded, services } = await import("@/infra/container");
  const userId = await currentUserId();
  await ensureSeeded(userId);
  const serviceBag = services();

  const platform = await resolvePlatform(userId, values, identity.kind);
  if (!platform.ok) return platform.state;

  const settlement = await resolveSettlement(userId, values, identity.kind);
  if (!settlement.ok) return settlement.state;

  const added = await serviceBag.investing.addInstrument.execute({
    userId,
    symbol: identity.symbol,
    name: identity.name,
    kind: identity.kind,
    isin: identity.isin || null,
    exchange: identity.exchange || null,
    quoteRef: identity.quoteRef,
    currency,
    institutionId: platform.institutionId,
  });
  if (!added.ok) return { ok: false, message: added.error.message };

  if (identity.catalogInstrumentId && identity.listingId) {
    await serviceBag.instrumentCatalog.link.execute({
      userId,
      portfolioInstrumentId: added.value.instrumentId.value,
      catalogInstrumentId: identity.catalogInstrumentId,
      listingId: identity.listingId,
    });
  }

  const totalCharges = money(values.brokerage, currency)
    .plus(money(values.exchangeFees, currency))
    .plus(money(values.statutoryCharges, currency))
    .plus(money(values.taxWithheld, currency));
  const { quantity, pricePerUnit } = pricing;
  const tradedOn = CalendarDate.parse(values.tradedOn);

  /*
   * Metal bought with no funding account is an **opening position**, not a buy.
   *
   * A purchase moves cash out of an account into a holding, and the ledger's
   * legality matrix enforces that literally: `BUY` from `EQUITY_OPENING` is not
   * a row in it (L06), so booking one that way was refused outright. It should
   * be. "Cash left my bank" and "these grams entered the books from outside
   * them" are different events, and only the second one is true here.
   *
   * So this takes the path the holding page's own metal form already uses: an
   * OPENING_BALANCE journal from Equity: Opening Balances into the holding
   * account, with the lot opened by hand at the same cost and charges a buy
   * would have given it. The position, the cost basis and the lot are identical;
   * what differs is the honest claim about where the money came from.
   */
  if (settlement.opening) {
    const total = Money.fromRupees(values.totalAmount ?? "0", currency);
    const holding = await serviceBag.repositories.accounts.findById(userId, added.value.accountId);
    if (!holding) return { ok: false, message: "The holding account is unavailable." };

    const position = OpeningPosition.record(
      {
        userId,
        txnDate: tradedOn,
        description: `Opening position: ${values.quantity}g held on ${identity.name}`,
        source: accountRef(settlement.openingAccount),
        destination: accountRef(holding),
      },
      {
        instrumentId: added.value.instrumentId.value,
        quantity,
        amount: total,
        holding: accountRef(holding),
      },
    );
    await serviceBag.repositories.journal.save(position);
    await serviceBag.repositories.lots.recordTrade(userId, {
      id: position.id.value,
      instrumentId: added.value.instrumentId,
      side: "BUY",
      tradedOn,
      quantity,
      pricePerUnit,
      charges: totalCharges,
      transactionId: position.id.value,
      settlementAccountId: settlement.openingAccount.id.value,
    });
    await serviceBag.repositories.lots.saveLots(userId, [
      Lot.open({
        instrumentId: added.value.instrumentId,
        acquiredOn: tradedOn,
        originalQuantity: quantity,
        cost: total.minus(totalCharges),
        buyCharges: totalCharges,
        openedByTransactionId: position.id.value,
      }),
    ]);

    revalidatePath("/investments");
    revalidatePath(`/investments/${added.value.instrumentId.value}`);
    revalidatePath("/accounts");
    revalidatePath("/transactions");
    revalidatePath("/dashboard");

    return {
      ok: true,
      instrumentId: added.value.instrumentId.value,
      cashPreview: preview.value.display,
      message:
        `Recorded ${values.quantity}g of ${identity.name} at ${pricePerUnit.toString()} per gram. ` +
        `No account was debited — it is an opening position, so record the payment separately ` +
        `if the money left an account you track.`,
    };
  }

  const result = values.side === "BUY"
    ? await serviceBag.investing.recordBuy.execute({
        userId,
        instrumentId: added.value.instrumentId,
        fromAccountId: settlement.accountId,
        quantity,
        pricePerUnit,
        tradedOn,
        charges: totalCharges.isPositive ? totalCharges : undefined,
      })
    : await serviceBag.investing.recordSell.execute({
        userId,
        instrumentId: added.value.instrumentId,
        toAccountId: settlement.accountId,
        quantity,
        pricePerUnit,
        tradedOn,
        charges: totalCharges.isPositive ? totalCharges : undefined,
        deductibleCharges: values.deductibleCharges
          ? Money.fromRupees(values.deductibleCharges, currency)
          : undefined,
        method: values.method,
      });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath("/investments");
  revalidatePath(`/investments/${added.value.instrumentId.value}`);
  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");

  return {
    ok: true,
    instrumentId: added.value.instrumentId.value,
    cashPreview: preview.value.display,
    message:
      `${values.side === "BUY" ? "Bought" : "Sold"} ${values.quantity} ${identity.symbol}. ` +
      `Cash impact: ${preview.value.display}.` +
      (identity.livePriced
        ? ""
        : " Recorded on the manual tier: it is not live-priced, so its value is whatever you record."),
  };
}

async function resolveIdentity(input: EntryInput): Promise<{
  symbol: string;
  name: string;
  kind: InstrumentKind;
  isin: string | null;
  exchange: string | null;
  currency: "INR" | "USD";
  quoteRef: string | null;
  livePriced: boolean;
  catalogInstrumentId: string | null;
  listingId: string | null;
}> {
  if (input.identityMode === "MANUAL") {
    /*
     * The manual tier, and no quote key at all.
     *
     * The old code wrote `symbol.toUpperCase()` here, which is a key nobody
     * validated against anything: "MYFLAT" went to the price ladder as a ticker
     * and came back unpriced forever. A manual holding is priced by what the
     * owner records, so it says so — `null` — and the entry confirmation tells
     * him, rather than leaving him to discover it from an empty chart.
     */
    /*
     * A digital metal is never manual. It has a real quote key — its purity
     * slug — so letting it through here would store `quoteRef: null` and leave
     * the grams permanently unpriced: exactly the failure the manual tier is
     * honest about, applied to an asset that did not need it. The lane picker
     * already steers metals elsewhere; this is the same refusal for a POST that
     * skipped it.
     */
    if (
      input.kind === "DIGITAL_GOLD" ||
      input.kind === "DIGITAL_SILVER" ||
      input.kind === "DIGITAL_PLATINUM"
    ) {
      throw new Error("Record digital metals in the metals lane — they are live-priced by purity.");
    }

    return {
      symbol: input.symbol.toUpperCase(),
      name: input.name,
      kind: input.kind,
      isin: input.isin || null,
      exchange: input.exchange || null,
      currency: input.currency,
      quoteRef: null,
      livePriced: false,
      catalogInstrumentId: null,
      listingId: null,
    };
  }

  if (input.identityMode === "METAL") {
    /*
     * The digital-metal tier: derived identity, and the one place a quote key
     * arrives from the client.
     *
     * It is whitelisted against the metal it was submitted with rather than
     * trusted, because `quoteRef` is what the price ladder asks a source for —
     * an unchecked string here is the same failure the manual tier exists to
     * avoid, only with a live-priced badge on it. Purity is part of the
     * identity, not a note: 999 and 995 fine are different grams at different
     * prices.
     *
     * The symbol is the bare slug. `AddInstrument` qualifies it per platform,
     * which is what makes the same metal at two vaults two holdings.
     */
    const kind = input.kind as MetalKind;
    if (kind !== "DIGITAL_GOLD" && kind !== "DIGITAL_SILVER" && kind !== "DIGITAL_PLATINUM") {
      throw new Error("Choose gold, silver or platinum.");
    }
    const purity = (input.quoteRef ?? "").toUpperCase();
    if (!isPurityOf(kind, purity)) {
      throw new Error("Choose a purity that belongs to the metal.");
    }
    if (input.currency !== "INR") {
      throw new Error("Digital metals are recorded in INR.");
    }
    return {
      symbol: purity,
      name: input.name.trim() || metalDisplayName(kind, ""),
      kind,
      isin: null,
      exchange: null,
      currency: "INR",
      quoteRef: purity,
      livePriced: true,
      catalogInstrumentId: null,
      listingId: null,
    };
  }

  if (!input.catalogQuery || !input.catalogInstrumentId || !input.listingId) {
    throw new Error("Choose and confirm a catalogue result before recording.");
  }
  const { services } = await import("@/infra/container");
  const searched = await services().instrumentCatalog.search.execute({ query: input.catalogQuery, limit: 50 });
  const candidates = [searched.selected, ...searched.candidates].filter(
    (candidate): candidate is CatalogSearchCandidateOutput => candidate !== null,
  );
  const selected = candidates.find(
    (candidate) =>
      candidate.catalogInstrumentId === input.catalogInstrumentId &&
      candidate.listing.id === input.listingId,
  );
  if (!selected) {
    throw new Error("The selected catalogue identity no longer matches the local cache. Search again.");
  }
  return catalogPortfolioIdentity(selected);
}

/**
 * Which account the cash leg posts against.
 *
 * Digital metal is bought outside the tracked accounts more often than not —
 * a UPI tap in a bullion app, from money that was never a row here — so the
 * metals lane does not ask for a funding account at all. The leg still has to
 * exist, because a holding that appears with nothing on the other side is a
 * ledger that no longer balances and a net worth that quietly grows by every
 * purchase. It posts to **Equity: Opening Balances** instead, which is the same
 * counter-account the holding page's opening-position form already uses and
 * means exactly what happened: these grams entered the books from outside them.
 *
 * The consequence, stated plainly because it is a real one: a metal purchase no
 * longer reduces any cash balance. If the rupees did leave a tracked account,
 * that outflow has to be recorded as its own transaction, or the same money is
 * counted twice — once as cash, once as gold.
 *
 * Every other lane still requires the account. A share bought through a broker
 * was paid for from somewhere the user is tracking, and guessing otherwise
 * would hide a real cash movement.
 */
async function resolveSettlement(
  userId: Awaited<ReturnType<typeof import("@/infra/container").currentUserId>>,
  data: Pick<EntryInput, "settlementAccountId" | "side">,
  kind: InstrumentKind,
): Promise<
  | { ok: true; opening: false; accountId: AccountId }
  | { ok: true; opening: true; openingAccount: Account }
  | { ok: false; state: InvestmentEntryActionState }
> {
  const chosen = data.settlementAccountId ?? "";
  if (chosen !== "") return { ok: true, opening: false, accountId: AccountId.from(chosen) };

  /*
   * A sale is the asymmetric case: proceeds have to land somewhere real. There
   * is no inverse of an opening position — "these grams left the books into
   * nowhere" is not a thing that happens — so the account stays required when
   * metal is sold, even though buying it does not ask.
   */
  if (data.side === "SELL") {
    return {
      ok: false,
      state: {
        ok: false,
        message: "Check the investment entry.",
        fieldErrors: { settlementAccountId: ["Choose the account the sale proceeds land in."] },
      },
    };
  }

  if (groupOfKind(kind) !== "DIGITAL_METALS") {
    return {
      ok: false,
      state: {
        ok: false,
        message: "Check the investment entry.",
        fieldErrors: { settlementAccountId: ["Choose the cash account."] },
      },
    };
  }

  const { services } = await import("@/infra/container");
  const opening = await services().repositories.accounts.findByCode(
    userId,
    AccountCode.parse(SystemAccountCodes.openingBalances),
  );
  if (!opening) {
    return {
      ok: false,
      state: { ok: false, message: "Opening-balances account is unavailable." },
    };
  }
  return { ok: true, opening: true, openingAccount: opening };
}

async function resolvePlatform(
  userId: Awaited<ReturnType<typeof import("@/infra/container").currentUserId>>,
  data: Pick<EntryInput, "institutionId" | "newPlatformName">,
  kind: InstrumentKind,
): Promise<
  { ok: true; institutionId: InstitutionId | null } | { ok: false; state: InvestmentEntryActionState }
> {
  const chosen = data.institutionId ?? "";
  if (chosen === "") return { ok: true, institutionId: null };
  if (chosen !== NEW_PLATFORM && !chosen.startsWith(SUGGESTED_PLATFORM)) {
    return { ok: true, institutionId: InstitutionId.from(chosen) };
  }

  const name = chosen.startsWith(SUGGESTED_PLATFORM)
    ? chosen.slice(SUGGESTED_PLATFORM.length)
    : (data.newPlatformName ?? "").trim();
  if (name === "") {
    return {
      ok: false,
      state: {
        ok: false,
        message: "Check the investment entry.",
        fieldErrors: { newPlatformName: ["Name the platform, or choose one from the list."] },
      },
    };
  }

  const { services } = await import("@/infra/container");
  const registered = await services().platforms.register.execute({
    userId,
    name,
    kind: groupOfKind(kind) === "DIGITAL_METALS" ? "BULLION" : "BROKER",
  });
  if (!registered.ok) return { ok: false, state: { ok: false, message: registered.error.message } };
  return { ok: true, institutionId: registered.value.institutionId };
}

/**
 * The signed cash movement, computed from the same quantity and price the trade
 * will actually be booked with — never re-parsed from the raw fields, so the
 * number shown to the user and the number posted to the ledger cannot drift.
 */
function cashPreview(
  input: Pick<EntryInput, "side" | "brokerage" | "exchangeFees" | "statutoryCharges" | "taxWithheld">,
  quantity: Quantity,
  unitPrice: Money,
  currency: Currency,
): { ok: true; value: { signed: Money; display: string } } | { ok: false; message: string } {
  try {
    if (!quantity.isPositive || !unitPrice.isPositive) {
      return { ok: false, message: "Quantity and execution price must be positive." };
    }
    const costs = money(input.brokerage, currency)
      .plus(money(input.exchangeFees, currency))
      .plus(money(input.statutoryCharges, currency))
      .plus(money(input.taxWithheld, currency));
    const consideration = quantity.valueAt(unitPrice, "HALF_UP");
    const signed = input.side === "BUY"
      ? consideration.plus(costs).negated()
      : consideration.minus(costs);
    return { ok: true, value: { signed, display: signed.toString() } };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

/**
 * The quantity and unit price a trade is booked at.
 *
 * Every lane but the metals one takes the price straight from the contract
 * note. The metals lane cannot: a bullion receipt states a rupee total and the
 * grams it bought, and the rate between them routinely runs to three or more
 * decimals — 0.3481g for ₹5,000 is ₹13,932.777 per gram — while a trade price
 * is `Money`, which is paise. Asking for the rate therefore rejected real
 * receipts outright. So the amount is what is asked for and the rate is derived
 * from it, with the charges moved to the side that makes the cash impact equal
 * the number on the receipt. See `metalPricing` for the arithmetic.
 */
function resolvePricing(
  input: EntryInput,
  currency: Currency,
): { ok: true; quantity: Quantity; pricePerUnit: Money } | { ok: false; state: InvestmentEntryActionState } {
  const invalid = (field: string, message: string): { ok: false; state: InvestmentEntryActionState } => ({
    ok: false,
    state: { ok: false, message: "Check the investment entry.", fieldErrors: { [field]: [message] } },
  });

  const quantity = Quantity.fromString(input.quantity);
  if (!quantity.isPositive) return invalid("quantity", "Enter a positive quantity.");

  if (input.identityMode !== "METAL") {
    if (!input.unitPrice) return invalid("unitPrice", "Enter the execution price.");
    return { ok: true, quantity, pricePerUnit: Money.fromRupees(input.unitPrice, currency) };
  }

  if (!input.totalAmount) {
    return invalid("totalAmount", "Enter the total rupee amount shown on the receipt.");
  }
  const priced = metalPricing({
    side: input.side,
    grams: input.quantity,
    total: input.totalAmount,
    charges: [
      input.brokerage ?? "",
      input.exchangeFees ?? "",
      input.statutoryCharges ?? "",
      input.taxWithheld ?? "",
    ],
  });
  if (!priced.ok) return invalid("totalAmount", priced.message);

  return {
    ok: true,
    quantity,
    pricePerUnit: Money.fromMinor(Number(priced.value.ratePerGramMinor), currency),
  };
}

function money(value: string | undefined, currency: Currency): Money {
  return value ? Money.fromRupees(value, currency) : Money.zero(currency);
}
