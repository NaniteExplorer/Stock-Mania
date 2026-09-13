"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Currency, Money } from "@/core/money";
import { Quantity } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { groupOfKind } from "@/domain/asset-groups";
import { InstitutionId } from "@/domain/institutions";
import type { CatalogSearchCandidateOutput, CatalogSearchOutput } from "@/domain/instrument-catalog";
import { InstrumentId, type InstrumentKind } from "@/domain/instruments";
import { catalogPortfolioIdentity } from "./entry-identity";

export interface InvestmentEntryActionState {
  ok: boolean;
  message: string;
  instrumentId?: string;
  cashPreview?: string;
  fieldErrors?: Record<string, string[]>;
}

export type InvestmentSearchResult = CatalogSearchOutput;
export type InvestmentSearchCandidate = CatalogSearchCandidateOutput;

const MONEY = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter rupees and paise.");
const OPTIONAL_MONEY = z.string().trim().regex(/^(\d+(\.\d{1,2})?)?$/, "Enter rupees and paise.");
const QUANTITY = z.string().trim().regex(/^\d+(\.\d{1,8})?$/, "Enter up to eight decimals.");

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
  identityMode: z.enum(["CATALOG", "MANUAL"]),
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
  side: z.enum(["BUY", "SELL"]),
  tradedOn: z.string().trim().min(1, "Trade date is required."),
  quantity: QUANTITY,
  unitPrice: MONEY,
  settlementAccountId: z.string().uuid("Choose the cash account."),
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
  const preview = cashPreview({ ...values, currency: identity.currency });
  if (!preview.ok) return { ok: false, message: preview.message };

  const { currentUserId, ensureSeeded, services } = await import("@/infra/container");
  const userId = await currentUserId();
  await ensureSeeded(userId);
  const serviceBag = services();

  const platform = await resolvePlatform(userId, values, identity.kind);
  if (!platform.ok) return platform.state;

  const currency = Currency.of(identity.currency);
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
  const quantity = Quantity.fromString(values.quantity);
  const pricePerUnit = Money.fromRupees(values.unitPrice, currency);
  const tradedOn = CalendarDate.parse(values.tradedOn);

  const result = values.side === "BUY"
    ? await serviceBag.investing.recordBuy.execute({
        userId,
        instrumentId: added.value.instrumentId,
        fromAccountId: AccountId.from(values.settlementAccountId),
        quantity,
        pricePerUnit,
        tradedOn,
        charges: totalCharges.isPositive ? totalCharges : undefined,
      })
    : await serviceBag.investing.recordSell.execute({
        userId,
        instrumentId: added.value.instrumentId,
        toAccountId: AccountId.from(values.settlementAccountId),
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

function cashPreview(input: Pick<
  EntryInput,
  "side" | "quantity" | "unitPrice" | "brokerage" | "exchangeFees" | "statutoryCharges" | "taxWithheld" | "currency"
>): { ok: true; value: { signed: Money; display: string } } | { ok: false; message: string } {
  try {
    const currency = Currency.of(input.currency);
    const quantity = Quantity.fromString(input.quantity);
    const unitPrice = Money.fromRupees(input.unitPrice, currency);
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

function money(value: string | undefined, currency: Currency): Money {
  return value ? Money.fromRupees(value, currency) : Money.zero(currency);
}
