"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Currency, Money } from "@/core/money";
import { Quantity } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import { AccountId, AccountCode, SystemAccountCodes } from "@/domain/accounts";
import { UserId } from "@/core/kernel";
import { groupOfKind } from "@/domain/asset-groups";
import { InstitutionId } from "@/domain/institutions";
import { InstrumentId, type InstrumentKind, type MarketInstrument } from "@/domain/instruments";
import type { IdentifierType, InstrumentRef } from "@/domain/pricing";
import { Split } from "@/domain/corporate";
import { accountRef, OpeningPosition } from "@/domain/transactions";
import { Lot } from "@/domain/lots";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import { NEW as NEW_PLATFORM, SUGGESTED as SUGGESTED_PLATFORM } from "./platform-select";

export interface InvestingActionState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

const AMOUNT = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 1500.00");
/** Units carry eight decimals: a mutual fund holding is rarely a whole number. */
const UNITS = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/, "Enter a quantity like 12.5432");

const addSchema = z.object({
  symbol: z.string().trim().min(1, "Give it a symbol.").max(40),
  name: z.string().trim().min(1, "Give it a name.").max(160),
  kind: z.enum([
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
    "OPTION",
    "FUTURE",
  ]),
  isin: z.string().trim().length(12).optional().or(z.literal("")),
  exchange: z.string().trim().max(16).optional().or(z.literal("")),
  quoteRef: z.string().trim().max(64).optional().or(z.literal("")),
  currency: z.enum(["INR", "USD"]),
  /* ── Where it is held. Either an existing platform, or a name to register. ── */
  institutionId: z.string().trim().optional().or(z.literal("")),
  newPlatformName: z.string().trim().max(120).optional().or(z.literal("")),
  /* ── The leaf's own facts. Only the derivatives need any of these. ── */
  underlying: z.enum(["EQUITY", "DEBT", "GOLD"]).optional(),
  legacyUnits: z.string().optional(),
  underlyingSymbol: z.string().trim().max(40).optional().or(z.literal("")),
  right: z.enum(["CALL", "PUT"]).optional(),
  strike: AMOUNT.optional().or(z.literal("")),
  expiry: z.string().trim().optional().or(z.literal("")),
  contractMonth: z.string().trim().optional().or(z.literal("")),
  lotSize: z.string().trim().optional().or(z.literal("")),
});

/**
 * The metadata for the chosen leaf, or `undefined`.
 *
 * Assembled here rather than in the form, because the form's job is to collect
 * strings and the shape belongs to the domain — which validates it against that
 * leaf's own Zod schema in its constructor and refuses a half-specified
 * derivative outright.
 */
function metadataFor(input: z.infer<typeof addSchema>): unknown {
  switch (input.kind) {
    case "ETF":
      return input.underlying ? { underlying: input.underlying } : undefined;
    case "DEBT_FUND":
      return input.legacyUnits === "on" ? { legacyUnits: true } : undefined;
    case "OPTION":
      return {
        underlyingSymbol: (input.underlyingSymbol || "").toUpperCase(),
        right: input.right ?? "CALL",
        strike: input.strike || "0",
        expiry: input.expiry || "",
        lotSize: Number(input.lotSize || "0"),
      };
    case "FUTURE":
      return {
        underlyingSymbol: (input.underlyingSymbol || "").toUpperCase(),
        expiry: input.expiry || "",
        contractMonth: input.contractMonth || (input.expiry || "").slice(0, 7),
        lotSize: Number(input.lotSize || "0"),
      };
    default:
      return undefined;
  }
}

export async function addInstrumentAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the form.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const platform = await resolvePlatform(userId, parsed.data);
  if (!platform.ok) return platform.state;

  const result = await services().investing.addInstrument.execute({
    userId,
    symbol: parsed.data.symbol.toUpperCase(),
    name: parsed.data.name,
    kind: parsed.data.kind,
    isin: parsed.data.isin || null,
    exchange: parsed.data.exchange || null,
    quoteRef: parsed.data.quoteRef || null,
    currency: Currency.of(parsed.data.currency),
    institutionId: platform.institutionId,
    metadata: metadataFor(parsed.data),
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  if (parsed.data.currency !== Currency.reporting.code) {
    const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
    await services().pricing.fx.refresh(
      parsed.data.currency,
      [Currency.reporting.code],
      DateRange.of(today.plusDays(-7), today),
    );
  }

  revalidatePath("/investments");
  revalidatePath("/platforms");

  /*
   * Says so when the symbol was qualified. The same asset on a second platform
   * cannot keep the same symbol — the column is unique — and a user who typed
   * GOLD999 and finds GOLD999.SAFEGOLD in the table deserves to be told why
   * rather than left to guess that something went wrong.
   */
  const stored = result.value.symbol;
  return {
    ok: true,
    message: result.value.symbolQualified
      ? `${stored} added. The symbol was qualified because ${parsed.data.symbol.toUpperCase()} ` +
        `is already registered on another platform; prices still resolve from the original.`
      : `${stored} added.`,
  };
}

/**
 * Turns what the platform field submitted into an institution id.
 *
 * The "add a platform" case registers on the way past rather than sending the
 * user to a second screen and back — `RegisterInstitution` is idempotent on the
 * normalised name, so doing it here cannot produce a duplicate.
 */
async function resolvePlatform(
  userId: UserId,
  data: { institutionId?: string; newPlatformName?: string; kind: string },
): Promise<
  { ok: true; institutionId: InstitutionId | null } | { ok: false; state: InvestingActionState }
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
        message: "Check the form.",
        fieldErrors: { newPlatformName: ["Name the platform, or choose one from the list."] },
      },
    };
  }

  const registered = await services().platforms.register.execute({
    userId,
    name,
    // A vault holds metal and a broker holds everything else; the user can
    // correct it on /platforms if the guess is wrong.
    kind: groupOfKind(data.kind as InstrumentKind) === "DIGITAL_METALS" ? "BULLION" : "BROKER",
  });
  if (!registered.ok) {
    return { ok: false, state: { ok: false, message: registered.error.message } };
  }
  return { ok: true, institutionId: registered.value.institutionId };
}

const tradeSchema = z.object({
  instrumentId: z.string().uuid(),
  accountId: z.string().uuid(),
  quantity: UNITS,
  pricePerUnit: AMOUNT,
  tradedOn: z.string().trim().min(1),
  charges: AMOUNT.optional().or(z.literal("")),
  deductibleCharges: AMOUNT.optional().or(z.literal("")),
  method: z.enum(["FIFO", "LIFO", "HIFO", "AVERAGE_COST", "SPECIFIC_ID"]).optional(),
});

export async function recordBuyAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = tradeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Check the quantity, price and date." };

  const userId = await currentUserId();
  const instrument = await services().repositories.instruments.findById(
    userId,
    InstrumentId.from(parsed.data.instrumentId),
  );
  if (!instrument) return { ok: false, message: "Instrument not found." };
  const result = await services().investing.recordBuy.execute({
    userId,
    instrumentId: InstrumentId.from(parsed.data.instrumentId),
    fromAccountId: AccountId.from(parsed.data.accountId),
    quantity: Quantity.fromString(parsed.data.quantity),
    pricePerUnit: Money.fromRupees(parsed.data.pricePerUnit, instrument.currency),
    tradedOn: CalendarDate.parse(parsed.data.tradedOn),
    charges: parsed.data.charges ? Money.fromRupees(parsed.data.charges, instrument.currency) : undefined,
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidateInvesting(parsed.data.instrumentId);
  return {
    ok: true,
    message: `Bought. The lot opened at ${result.value.costBasis.toString()}, and ${result.value.cashPaid.toString()} left the account.`,
  };
}

/**
 * `fundingAccountId` is the account the money actually left.
 *
 * `OPENING` is the one legitimate exception: gold you already owned when you
 * started using the app was paid for out of a bank balance the ledger never saw,
 * so there is no cash movement to record and the credit belongs to equity. Every
 * *later* purchase did move money, and booking it to equity instead would inflate
 * net worth by the purchase price — the bank still showing cash it no longer has,
 * and the gold showing up beside it.
 */
const OPENING_FUNDING = "OPENING";

const metalHoldingSchema = z.object({
  instrumentId: z.string().uuid(),
  grams: UNITS,
  invested: AMOUNT,
  recordedOn: z.string().trim().min(1),
  fundingAccountId: z.string().trim().min(1).default(OPENING_FUNDING),
  /** GST and platform fees inside `invested`, kept separate rather than added on. */
  charges: AMOUNT.optional().or(z.literal("")),
});

/** Pulls a fresh rate so the new position is priced the moment it appears. */
async function refreshMetalPrice(instrument: MarketInstrument): Promise<void> {
  const priceKey = instrument.quoteKey();
  await services().pricing.refresh.execute({
    instruments: [
      {
        instrumentId: instrument.id.value,
        symbol: priceKey.ref ?? instrument.symbol,
        assetClass: priceKey.assetClass,
        currency: instrument.currency,
        identifierType: PRICE_IDENTIFIER[priceKey.identifierType] ?? "TICKER",
      },
    ],
    quoteType: priceKey.quoteType as "CLOSE" | "NAV" | "MID" | "LAST",
  });
}

/** Records a digital-metal position without pretending the funding account is new data. */
export async function recordMetalHoldingAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = metalHoldingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Check the grams, values and date." };

  const userId = await currentUserId();
  const { repositories } = services();
  const instrumentId = InstrumentId.from(parsed.data.instrumentId);
  const instrument = await repositories.instruments.findById(userId, instrumentId);
  if (!instrument || instrument.unit !== "GRAM") return { ok: false, message: "Digital-metal holding not found." };

  const opening = await repositories.accounts.findByCode(userId, AccountCode.parse(SystemAccountCodes.openingBalances));
  if (!opening) return { ok: false, message: "Opening-balances account is unavailable." };

  const grams = Quantity.fromString(parsed.data.grams);
  const invested = Money.fromRupees(parsed.data.invested, instrument.currency);
  const recordedOn = CalendarDate.parse(parsed.data.recordedOn);
  if (!grams.isPositive || !invested.isPositive) {
    return { ok: false, message: "Grams and invested amount must be positive." };
  }
  const holding = await repositories.accounts.findById(userId, instrument.assetAccountId);
  if (!holding) return { ok: false, message: "Holding account is unavailable." };

  /*
   * `invested` is the all-in amount the user actually paid, so the charges come
   * *out* of it rather than being added to it: the metal cost the remainder, and
   * the two together are still the same rupees that left the account. Adding them
   * would silently inflate every purchase by its own GST.
   */
  const charges = parsed.data.charges
    ? Money.fromRupees(parsed.data.charges, instrument.currency)
    : Money.zero(instrument.currency);
  if (charges.isGreaterThanOrEqual(invested)) {
    return {
      ok: false,
      message:
        "The GST and fees cannot be the whole amount invested — that would leave nothing paid " +
        "for the metal itself.",
    };
  }

  /*
   * A purchase paid for from a real account is an ordinary buy, and goes through
   * the same use case every other asset does: cash leaves the account, the metal
   * arrives, and net worth is unchanged by the act of buying.
   */
  if (parsed.data.fundingAccountId !== OPENING_FUNDING) {
    const metalCost = invested.minus(charges);
    const result = await services().investing.recordBuy.execute({
      userId,
      instrumentId,
      fromAccountId: AccountId.from(parsed.data.fundingAccountId),
      quantity: grams,
      pricePerUnit: grams.perUnit(metalCost),
      tradedOn: recordedOn,
      charges: charges.isPositive ? charges : undefined,
      narration: `Bought ${parsed.data.grams}g of ${instrument.name}`,
    });
    if (!result.ok) return { ok: false, message: result.error.message };

    await refreshMetalPrice(instrument);
    revalidatePath(`/investments/${instrumentId.value}`);
    revalidatePath("/investments");
    return {
      ok: true,
      message: `Recorded. ${result.value.cashPaid.toString()} left the account and the lot opened at ${result.value.costBasis.toString()}.`,
    };
  }


  const openingPosition = OpeningPosition.record(
    {
      userId,
      txnDate: recordedOn,
      description: `Opening position: ${parsed.data.grams}g held on ${instrument.name}`,
      source: accountRef(opening),
      destination: accountRef(holding),
    },
    { instrumentId: instrumentId.value, quantity: grams, amount: invested, holding: accountRef(holding) },
  );
  await repositories.journal.save(openingPosition);
  // The rate paid for the metal itself, with the GST and fees held on their own
  // line — the same total, but "what did a gram cost me" stays answerable.
  const pricePerGram = grams.perUnit(invested.minus(charges));
  await repositories.lots.recordTrade(userId, {
    id: openingPosition.id.value,
    instrumentId,
    side: "BUY",
    tradedOn: recordedOn,
    quantity: grams,
    pricePerUnit: pricePerGram,
    charges,
    transactionId: openingPosition.id.value,
    settlementAccountId: opening.id.value,
  });
  await repositories.lots.saveLots(userId, [Lot.open({
    instrumentId,
    acquiredOn: recordedOn,
    originalQuantity: grams,
    cost: invested.minus(charges),
    buyCharges: charges,
    openedByTransactionId: openingPosition.id.value,
  })]);

  await refreshMetalPrice(instrument);

  revalidatePath(`/investments/${instrumentId.value}`);
  revalidatePath("/investments");
  return { ok: true, message: "Digital-metal investment recorded." };
}

const metalMutationSchema = metalHoldingSchema.extend({ tradeId: z.string().trim().min(1) });

export async function updateMetalHoldingAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = metalMutationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Check the grams, amount and date." };
  const userId = await currentUserId();
  const removed = await services().investing.voidTrade.execute({
    userId,
    tradeId: parsed.data.tradeId,
    mode: "DELETE",
    reason: "Digital-metal investment corrected",
  });
  if (!removed.ok) return { ok: false, message: removed.error.message };
  const replacement = new FormData();
  replacement.set("instrumentId", parsed.data.instrumentId);
  replacement.set("grams", parsed.data.grams);
  replacement.set("invested", parsed.data.invested);
  replacement.set("recordedOn", parsed.data.recordedOn);
  // Carried, not defaulted: an edit that dropped the funding account would move
  // the purchase back onto equity and re-inflate net worth by its own amount.
  replacement.set("fundingAccountId", parsed.data.fundingAccountId);
  if (parsed.data.charges) replacement.set("charges", parsed.data.charges);
  const result = await recordMetalHoldingAction(null, replacement);
  return result.ok ? { ok: true, message: "Investment updated." } : result;
}

const deleteMetalSchema = z.object({
  instrumentId: z.string().uuid(),
  tradeId: z.string().trim().min(1),
});

export async function deleteMetalHoldingAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = deleteMetalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Investment not found." };
  const userId = await currentUserId();
  const result = await services().investing.voidTrade.execute({
    userId,
    tradeId: parsed.data.tradeId,
    mode: "DELETE",
    reason: "Digital-metal investment deleted",
  });
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidatePath(`/investments/${parsed.data.instrumentId}`);
  revalidatePath("/investments");
  return { ok: true, message: "Investment deleted." };
}

/**
 * Records a sale.
 *
 * `deductibleCharges` is a separate field rather than a fraction of `charges`,
 * because STT is a real cost that is never deductible against a gain — offering
 * one number would make deducting all of it the path of least resistance.
 */
export async function recordSellAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = tradeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Check the quantity, price and date." };

  const userId = await currentUserId();
  const instrument = await services().repositories.instruments.findById(
    userId,
    InstrumentId.from(parsed.data.instrumentId),
  );
  if (!instrument) return { ok: false, message: "Instrument not found." };
  const result = await services().investing.recordSell.execute({
    userId,
    instrumentId: InstrumentId.from(parsed.data.instrumentId),
    toAccountId: AccountId.from(parsed.data.accountId),
    quantity: Quantity.fromString(parsed.data.quantity),
    pricePerUnit: Money.fromRupees(parsed.data.pricePerUnit, instrument.currency),
    tradedOn: CalendarDate.parse(parsed.data.tradedOn),
    charges: parsed.data.charges ? Money.fromRupees(parsed.data.charges, instrument.currency) : undefined,
    deductibleCharges: parsed.data.deductibleCharges
      ? Money.fromRupees(parsed.data.deductibleCharges, instrument.currency)
      : undefined,
    method: parsed.data.method,
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidateInvesting(parsed.data.instrumentId);
  const terms = result.value.disposals
    .map((disposal) => `${disposal.quantity.toDecimalString()} held ${disposal.holdingDays} days`)
    .join("; ");
  return {
    ok: true,
    message: `Sold. Realised ${result.value.realisedGain.toString()} across ${result.value.disposals.length} lot(s) — ${terms}.`,
  };
}

const splitSchema = z.object({
  instrumentId: z.string().uuid(),
  from: UNITS,
  to: UNITS,
  exDate: z.string().trim().min(1),
});

/**
 * Applies a split.
 *
 * Recorded as an action with an ex-date rather than an edit to the lots, so it is
 * visible, auditable and reversible — apply the inverse and the units come back.
 */
export async function applySplitAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const parsed = splitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Give a ratio and an ex-date." };

  const userId = await currentUserId();
  const { investing, repositories } = services();

  const instrumentId = InstrumentId.from(parsed.data.instrumentId);
  const openLots = await repositories.lots.openLots(userId, instrumentId);
  const held = openLots.reduce(
    (total, lot) => total.plus(lot.remaining),
    Quantity.ZERO,
  );

  let action: Split;
  try {
    action = new Split(
      {
        instrumentId,
        exDate: CalendarDate.parse(parsed.data.exDate),
        heldQuantity: held,
        currency: Money.zero().currency,
        source: "Manual entry",
      },
      { from: Quantity.fromString(parsed.data.from), to: Quantity.fromString(parsed.data.to) },
    );
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  const result = await investing.applyCorporateAction(userId).execute({ userId, action });
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidateInvesting(parsed.data.instrumentId);
  return {
    ok: true,
    message: `Applied. The position is now ${result.value.quantityAfter.toDecimalString()} units, at the same cost.`,
  };
}

function revalidateInvesting(instrumentId: string): void {
  revalidatePath(`/investments/${instrumentId}`);
  revalidatePath("/investments");
  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
}

const PRICE_IDENTIFIER: Readonly<Record<string, IdentifierType>> = {
  SYMBOL: "TICKER",
  ISIN: "ISIN",
  SCHEME_CODE: "SCHEME_CODE",
  SLUG: "METAL",
};

/** Refreshes all registered instruments in provider-sized batches. */
export async function refreshPortfolioAction(
  _previous: InvestingActionState | null,
  formData: FormData,
): Promise<InvestingActionState> {
  const userId = await currentUserId();
  const { repositories, pricing } = services();
  const instruments = await repositories.instruments.list(userId, { includeClosed: false });
  if (instruments.length === 0) return { ok: false, message: "Add an instrument first." };

  const refsByQuoteType = new Map<string, InstrumentRef[]>();
  for (const instrument of instruments) {
    const key = instrument.quoteKey();
    const ref: InstrumentRef = {
      instrumentId: instrument.id.value,
      symbol: key.ref ?? instrument.symbol,
      assetClass: key.assetClass,
      currency: instrument.currency,
      identifierType: PRICE_IDENTIFIER[key.identifierType] ?? "TICKER",
    };
    refsByQuoteType.set(key.quoteType, [...(refsByQuoteType.get(key.quoteType) ?? []), ref]);
  }

  let persisted = 0;
  const priceWarnings: string[] = [];
  for (const [quoteType, refs] of refsByQuoteType) {
    const result = await pricing.refresh.execute({
      instruments: refs,
      quoteType: quoteType as "CLOSE" | "NAV" | "MID" | "LAST",
    });
    if (!result.ok) return { ok: false, message: result.error.message };
    persisted += result.value.persisted;
    priceWarnings.push(...result.value.warnings);
  }

  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const foreignCurrencies = [...new Set(
    instruments
      .map((instrument) => instrument.currency.code)
      .filter((currency) => currency !== Currency.reporting.code),
  )];
  const fxErrors: string[] = [];
  for (const currency of foreignCurrencies) {
    const refreshed = await pricing.fx.refresh(
      currency,
      [Currency.reporting.code],
      DateRange.of(today.plusDays(-7), today),
    );
    fxErrors.push(...refreshed.errors);
  }

  revalidatePath("/investments");
  const detailInstrumentId = formData.get("instrumentId");
  if (typeof detailInstrumentId === "string" && detailInstrumentId.length > 0) {
    revalidatePath(`/investments/${detailInstrumentId}`);
  }
  revalidatePath("/dashboard");
  /*
   * The accumulators, not the last loop iteration's result: quotes are fetched
   * one batch per quote type, so reporting only the final batch would have
   * undercounted a portfolio holding both shares and mutual funds.
   */
  const warnings = [...priceWarnings, ...fxErrors];
  return {
    ok: true,
    message: `Saved ${persisted} price point(s)${warnings.length ? ` · ${warnings.length} warning(s)` : ""}.`,
  };
}
