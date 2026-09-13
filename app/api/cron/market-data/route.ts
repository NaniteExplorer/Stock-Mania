/**
 * The scheduled market-data sweep.
 *
 * `GET /api/cron/market-data`, bearer-gated. Three jobs, in a deliberate order:
 *
 *  1. **Quotes and FX**, as before — the numbers a holding is valued at today.
 *  2. **Daily bars**, delta only: the first fetch for an instrument is a full
 *     history (~850 KB, C14) and every sweep after it asks for the days since the
 *     last stored bar, because payload is the cost here and request count is not.
 *  3. **The catalogue quote-key sweep** (C10, C6): resolve a first key, re-confirm
 *     an existing one, and mark a dead one `quoteStale` without deleting a row.
 *     Budgeted per run rather than walking all ~30 000 listings.
 *
 * Route-handler conventions read from
 * `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` for
 * this Next (16.2). Route handlers are **not cached by default**; a `GET` opts in
 * only with an explicit `dynamic = 'force-static'`, which this must never do — it
 * reads request headers for the bearer token and writes to the database, and a
 * cached sweep would report a stale run as a fresh one. Nothing is added to
 * un-cache it, because there is nothing to undo.
 */

import { revalidatePath } from "next/cache";
import { config } from "@/core/config";
import { UserId } from "@/core/kernel";
import { Currency } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import type { IdentifierType, InstrumentRef, QuoteType } from "@/domain/pricing";
import { services } from "@/infra/container";
import { listMarketSyncUserIds } from "@/infra/market-sync-users";

export const runtime = "nodejs";
export const maxDuration = 60;

const IDENTIFIERS: Readonly<Record<string, IdentifierType>> = {
  TICKER: "TICKER",
  ISIN: "ISIN",
  AMFI_CODE: "SCHEME_CODE",
  SLUG: "METAL",
};

export async function GET(request: Request): Promise<Response> {
  const secret = config.marketData().cronSecret;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const userIds = await listMarketSyncUserIds();
  const report: { userId: string; persisted: number; barsAppended: number; warnings: string[] }[] = [];

  for (const rawUserId of userIds) {
    const userId = UserId.from(rawUserId);
    const app = services();
    const instruments = await app.repositories.instruments.list(userId, { includeClosed: false });
    const groups = new Map<QuoteType, InstrumentRef[]>();

    for (const instrument of instruments) {
      const key = instrument.quoteKey();
      const ref: InstrumentRef = {
        instrumentId: instrument.id.value,
        symbol: key.ref ?? instrument.symbol,
        assetClass: key.assetClass,
        currency: instrument.currency,
        identifierType: IDENTIFIERS[key.identifierType] ?? "TICKER",
      };
      const quoteType = key.quoteType as QuoteType;
      groups.set(quoteType, [...(groups.get(quoteType) ?? []), ref]);
    }

    let persisted = 0;
    const warnings: string[] = [];
    for (const [quoteType, refs] of groups) {
      const result = await app.pricing.refresh.execute({ instruments: refs, quoteType });
      if (result.ok) {
        persisted += result.value.persisted;
        warnings.push(...result.value.warnings);
      } else {
        warnings.push(result.error.message);
      }
    }

    const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
    const currencies = [...new Set(instruments
      .map((instrument) => instrument.currency.code)
      .filter((currency) => currency !== Currency.reporting.code))];
    for (const currency of currencies) {
      const fx = await app.pricing.fx.refresh(
        currency,
        [Currency.reporting.code],
        DateRange.of(today.plusDays(-7), today),
      );
      warnings.push(...fx.errors);
    }
    /*
     * Daily bars, delta only.
     *
     * `IngestInstrumentBars` resumes from `price_bars` coverage, so the first
     * sweep after an instrument is added pays the full ~850 KB once and every
     * sweep after it fetches a handful of rows. An instrument whose key does not
     * resolve is reported and skipped — it must not stop the other holdings, and
     * the bars run must not fail the quote run that already succeeded.
     */
    let barsAppended = 0;
    for (const instrument of instruments) {
      const key = instrument.quoteKey();
      const quoteKey = resolvedQuoteKey(instrument.symbol, key.ref, instrument.currency.code);
      if (!quoteKey) continue;

      const outcome = await app.pricing.ingestBars.execute({
        instrument: {
          instrumentId: instrument.id.value,
          symbol: instrument.symbol,
          assetClass: key.assetClass,
          currency: instrument.currency,
          identifierType: "TICKER",
        },
        quoteKey,
        market: instrument.currency.code === "INR" ? "IN" : "US",
      });

      if (outcome.ok) {
        barsAppended += outcome.value.appended;
        // C2: an alarm is a warning the owner reads, never something acted on.
        warnings.push(...outcome.value.alarms.map((alarm) => alarm.message));
      } else {
        warnings.push(outcome.error.message);
      }
    }

    report.push({ userId: rawUserId, persisted, barsAppended, warnings });
  }

  /*
   * The catalogue gate, once per sweep rather than once per user: the catalogue is
   * shared, and probing the same listing for every user would spend the budget on
   * the same answer.
   */
  const gate = await services().marketData.reconcileQuoteKeys.reconcile(
    Number(new URL(request.url).searchParams.get("quoteKeyBudget") ?? 200),
  );

  revalidatePath("/investments");
  revalidatePath("/dashboard");
  return Response.json({
    ok: true,
    users: report.length,
    persisted: report.reduce((sum, item) => sum + item.persisted, 0),
    barsAppended: report.reduce((sum, item) => sum + item.barsAppended, 0),
    warnings: report.flatMap((item) => item.warnings).length,
    quoteKeys: {
      probed: gate.probed,
      resolved: gate.resolved,
      markedStale: gate.markedStale,
      stillUnresolved: gate.stillUnresolved,
    },
    report,
  });
}

/**
 * The history key for an instrument whose catalogue row has not been linked yet.
 *
 * A deliberately conservative stand-in, not a general resolver: C9's canonical
 * `.NS` for an INR holding and the bare ticker for a USD one. The **real** key is
 * the one the catalogue's reconciler validated and stored, and the per-instrument
 * backfill route probes before it uses anything; a sweep that guessed more
 * ambitiously would write a series for the wrong company.
 *
 * A symbol that already carries a suffix is left exactly as it is.
 */
function resolvedQuoteKey(symbol: string, ref: string | null, currency: string): string | null {
  const base = (ref ?? symbol).trim().toUpperCase();
  if (!base) return null;
  if (/\.(NS|BO)$/.test(base)) return base;
  if (currency === "INR") return `${base}.NS`;
  if (currency === "USD") return base.replace(/\./g, "-");
  return null;
}
