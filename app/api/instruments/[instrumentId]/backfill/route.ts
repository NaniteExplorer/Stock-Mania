/**
 * Backfill one instrument's daily bars, once, then deltas.
 *
 * `POST /api/instruments/<id>/backfill`
 *
 * **Why this is a route and not a server action.** It is called from two places
 * that are not a form submission: the cron sweep, which has a bearer token and no
 * session, and a retry the owner triggers after a provider outage. A route handler
 * takes both.
 *
 * Route-handler conventions checked against
 * `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and
 * `.../03-file-conventions/route.md` for this Next (16.2): `params` is a
 * **Promise** and must be awaited, `RouteContext<'/path'>` types it from the route
 * literal, and route handlers are **not cached by default** — only `GET` can opt
 * in, and `POST` never is. So there is nothing to un-cache here, and no
 * `force-dynamic` is needed or added.
 *
 * Three properties the plan asks for, and where each one lives:
 *
 *  - **Explicit `period1`/`period2`, never a "max" range (C4).** `IngestInstrumentBars`
 *    builds a `DateRange` from stored coverage and the adapter turns it into two
 *    epoch seconds. There is no code path from here that could ask for `range=max`,
 *    which silently degrades to monthly data.
 *  - **Idempotent and resumable (C14).** The first call fetches the full history —
 *    ~850 KB — and every call after it resumes from the last stored bar, so a
 *    retry costs a handful of rows rather than twenty years. Re-running this on a
 *    complete instrument is a no-op that says so.
 *  - **Authorised.** Either the cron bearer or the signed-in owner, and the
 *    instrument is looked up **under that owner's id**, so a valid session cannot
 *    reach another user's instrument by guessing a UUID.
 */

import { config } from "@/core/config";
import { UserId } from "@/core/kernel";
import { InstrumentId } from "@/domain/instruments";
import {
  acceptQuoteKeyProbe,
  candidateQuoteKeys,
  type QuoteKeyCandidateListing,
} from "@/domain/instrument-catalog";
import type { MarketCode } from "@/market-data/ports";
import { currentUserId, services } from "@/infra/container";
import { getCurrentSession } from "@/infra/auth/session";

export const runtime = "nodejs";
/** A full history is ~850 KB across twenty years of daily bars. 60s is generous. */
export const maxDuration = 60;

export async function POST(
  request: Request,
  context: RouteContext<"/api/instruments/[instrumentId]/backfill">,
): Promise<Response> {
  const { instrumentId } = await context.params;

  const authorised = await authorise(request);
  if (!authorised.ok) {
    return Response.json({ ok: false, error: authorised.error }, { status: authorised.status });
  }

  const app = services();
  const instrument = await app.repositories.instruments.findById(
    authorised.userId,
    InstrumentId.from(instrumentId),
  );
  if (!instrument) {
    // 404 rather than 403 for an instrument belonging to someone else: the lookup
    // is scoped to the caller, so "not yours" and "not there" are the same answer
    // and saying which would confirm the id exists.
    return Response.json({ ok: false, error: "No such instrument." }, { status: 404 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";
  const restate = url.searchParams.get("restate") === "true";

  const key = instrument.quoteKey();
  const listing: QuoteKeyCandidateListing = {
    listingId: instrumentId,
    exchange: instrument.props.exchange ?? (instrument.currency.code === "INR" ? "NSE" : "NASDAQ"),
    // `candidateQuoteKeys` accepts a bare exchange symbol. `key.ref` may already
    // be canonical (`KALYANKJIL.NS`) and must never be suffixed a second time.
    symbol: instrument.symbol,
    currency: instrument.currency.code,
    instrumentType: "EQUITY",
  };
  const market: MarketCode = instrument.currency.code === "INR" ? "IN" : "US";
  const purchases = (await app.repositories.lots.tradesFor(authorised.userId, instrument.id))
    .filter((trade) => trade.side === "BUY");
  const purchasedOn = purchases.reduce(
    (earliest, trade) => earliest === null || trade.tradedOn.isBefore(earliest) ? trade.tradedOn : earliest,
    null as (typeof purchases)[number]["tradedOn"] | null,
  );

  /*
   * Resolve the quote key by probing, not by uppercasing the symbol.
   *
   * The candidate order encodes C9 (`.NS` then `.BO` for India) and the probe is
   * what makes acceptance structural: a key is used only when it returned bars in
   * the right currency for the right kind of instrument. An instrument whose key
   * does not resolve gets a 422 naming every candidate that was tried — which is
   * a diagnosable refusal rather than a chart that is silently empty forever.
   */
  const candidates = [...new Set([
    ...(key.ref ? [key.ref] : []),
    ...candidateQuoteKeys(listing),
  ])];
  const refusals: string[] = [];
  let quoteKey: string | null = null;

  for (const candidate of candidates) {
    const probe = await app.marketData.reconcileQuoteKeys.probeOne(candidate);
    if (!probe) {
      refusals.push(`${candidate} did not resolve`);
      continue;
    }
    const verdict = acceptQuoteKeyProbe(probe, { currency: instrument.currency.code });
    if (verdict.accepted) {
      quoteKey = verdict.probe.quoteKey;
      break;
    }
    refusals.push(verdict.reason);
  }

  if (!quoteKey) {
    return Response.json(
      {
        ok: false,
        error: `No quote key resolved for ${instrument.symbol}.`,
        tried: candidates,
        refusals,
      },
      { status: 422 },
    );
  }

  const result = await app.pricing.ingestBars.execute({
    instrument: {
      instrumentId,
      symbol: instrument.symbol,
      assetClass: key.assetClass,
      currency: instrument.currency,
      identifierType: "TICKER",
    },
    quoteKey,
    market,
    from: purchasedOn ?? undefined,
    force,
    restate,
  });

  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error.message, code: result.error.code },
      { status: 502 },
    );
  }

  return Response.json({
    ok: true,
    instrumentId,
    quoteKey,
    from: purchasedOn?.toISO() ?? null,
    range: result.value.range
      ? { from: result.value.range.start.toISO(), to: result.value.range.end.toISO() }
      : null,
    appended: result.value.appended,
    superseded: result.value.superseded,
    source: result.value.sourceId,
    adjusted: result.value.adjusted,
    skipped: result.value.skippedReason,
    // Warnings, never actions (C2): a provider-observed split or an unexplained
    // move is reported and the ledger is left exactly as the owner wrote it.
    alarms: result.value.alarms.map((alarm) => ({
      kind: alarm.kind,
      onDate: alarm.onDate.toISO(),
      message: alarm.message,
    })),
  });
}

type Authorisation =
  | { ok: true; userId: UserId }
  | { ok: false; status: number; error: string };

/**
 * The cron bearer, or the signed-in owner.
 *
 * The bearer path needs a `userId` in the query because the token is not a user;
 * the session path ignores any such parameter, so a signed-in visitor cannot
 * borrow someone else's id by adding it to the URL.
 */
async function authorise(request: Request): Promise<Authorisation> {
  const secret = config.marketData().cronSecret;
  const header = request.headers.get("authorization");
  if (secret && header === `Bearer ${secret}`) {
    const forUser = new URL(request.url).searchParams.get("userId");
    if (!forUser) {
      return { ok: false, status: 400, error: "A bearer call must name the userId." };
    }
    return { ok: true, userId: UserId.from(forUser) };
  }

  const session = await getCurrentSession();
  if (!session?.user?.id) return { ok: false, status: 401, error: "Unauthorized" };
  return { ok: true, userId: await currentUserId() };
}
