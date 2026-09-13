/**
 * The chain: failover across a registry chain, plus the two refusals.
 *
 * Failover is the easy half — try each adapter in order, skip one whose circuit is
 * open, report which one answered so the caller can pin it.
 *
 * The hard half is knowing when **not** to fail over. Two mixtures are silently
 * wrong rather than loudly wrong, and both have been measured:
 *
 *  - **Adjusted spliced onto unadjusted.** Yahoo restates history into post-split
 *    terms; the NSE/BSE bhavcopy archives print what actually traded. A series that
 *    is Yahoo before 2019 and bhavcopy after it has a step change at the join that
 *    no chart and no return calculation can detect — 40x for NVDA, 4x for AAPL.
 *    {@link spliceSeries} refuses, and the caller re-fetches the whole range from
 *    one source instead.
 *  - **FX rate kinds mixed inside one history.** An ECB fixing, an indicative live
 *    rate and a market rate differ by ~0.18%; a portfolio valued with one kind
 *    early and another later shows a return that is an artefact of the switch.
 *    {@link assertUniformFxKind} refuses.
 *
 * Both refusals are `Err`, never a throw and never a silent repair: the caller is
 * told exactly which two sources disagreed and what it must do instead.
 */

import { Err, Ok } from "@/core/kernel";
import { ProviderError } from "@/domain/pricing";
import {
  MarketDataRegistry,
  NO_VENDOR_PINS,
  type VendorPins,
} from "@/market-data/engine/registry";
import type {
  DailyBar,
  FxRate,
  FxRateRequest,
  HistoricalSeries,
  HistoryRequest,
  LiveQuote,
  LiveQuoteRequest,
  MarketCode,
  MarketDataPort,
  MarketDataResult,
  SymbolCandidate,
  SymbolSearchQuery,
} from "@/market-data/ports";

/* ═══ Outcome ═════════════════════════════════════════════════════════ */

export interface ChainAttempt {
  readonly sourceId: string;
  readonly error: ProviderError;
}

export interface ChainOutcome<T> {
  readonly value: T;
  /** The adapter that answered. Persist it as the instrument's vendor pin. */
  readonly resolvedBy: string;
  /** Everyone who failed first, in order, for the health surface. */
  readonly attempts: readonly ChainAttempt[];
}

export type ChainResult<T> = MarketDataResult<ChainOutcome<T>>;

const CHAIN_ID = "market-data-chain";

function exhausted(what: string, attempts: readonly ChainAttempt[]): ProviderError {
  if (attempts.length === 0) {
    return new ProviderError(
      "UNSUPPORTED",
      CHAIN_ID,
      `No adapter is configured for ${what}.`,
      false,
    );
  }
  const detail = attempts.map((a) => `${a.sourceId}: ${a.error.message}`).join("; ");
  // Retryable if anyone's failure was: a chain that failed only on timeouts is
  // worth another go, a chain that failed on UNKNOWN_SYMBOL everywhere is not.
  const retryable = attempts.some((a) => a.error.retryable);
  return new ProviderError(
    "UPSTREAM",
    CHAIN_ID,
    `Every source failed for ${what} — ${detail}`,
    retryable,
  );
}

/**
 * Try each adapter in order until one succeeds.
 *
 * A source whose breaker is open is skipped **without** being called: that is the
 * entire value of the breaker to a chain — the fallback answers in milliseconds
 * instead of after the dead primary's third ten-second timeout.
 */
export async function runChain<P extends MarketDataPort, T>(
  what: string,
  chain: readonly P[],
  call: (adapter: P) => Promise<MarketDataResult<T>>,
): Promise<ChainResult<T>> {
  const attempts: ChainAttempt[] = [];

  for (const adapter of chain) {
    const health = adapter.health();
    if (health.state === "UNAVAILABLE") {
      attempts.push({
        sourceId: adapter.info.id,
        error: ProviderError.circuitOpen(
          adapter.info.id,
          health.circuitOpenUntil ?? new Date(0),
        ),
      });
      continue;
    }

    const result = await call(adapter);
    if (result.ok) {
      return Ok({ value: result.value, resolvedBy: adapter.info.id, attempts });
    }
    attempts.push({ sourceId: adapter.info.id, error: result.error });
  }

  return Err(exhausted(what, attempts));
}

/* ═══ The refusals ════════════════════════════════════════════════════ */

/**
 * Merge several parts of one instrument's history into a single series.
 *
 * Refuses a mixed `adjusted` flag, a mixed currency and a mixed quote key. Where
 * two parts cover the same day, **the earlier part in the list wins**: the list is
 * in chain order, so the primary's print beats the fallback's for a day both have.
 */
export function spliceSeries(
  parts: readonly HistoricalSeries[],
): MarketDataResult<HistoricalSeries> {
  if (parts.length === 0) {
    return Err(new ProviderError("UNSUPPORTED", CHAIN_ID, "Nothing to splice.", false));
  }
  const [first, ...rest] = parts;

  for (const part of rest) {
    if (part.adjusted !== first.adjusted) {
      return Err(
        new ProviderError(
          "MALFORMED_RESPONSE",
          CHAIN_ID,
          `Refusing to splice ${first.sourceId} (adjusted=${first.adjusted}) with ` +
            `${part.sourceId} (adjusted=${part.adjusted}) for ${first.quoteKey}: a split-restated ` +
            `series and a traded-price series are different numbers. Re-fetch the whole range ` +
            `from one source.`,
          false,
        ),
      );
    }
    if (part.currency.code !== first.currency.code) {
      return Err(
        new ProviderError(
          "MALFORMED_RESPONSE",
          CHAIN_ID,
          `Refusing to splice ${first.currency.code} bars from ${first.sourceId} with ` +
            `${part.currency.code} bars from ${part.sourceId} for ${first.quoteKey}.`,
          false,
        ),
      );
    }
    if (part.quoteKey !== first.quoteKey) {
      return Err(
        new ProviderError(
          "MALFORMED_RESPONSE",
          CHAIN_ID,
          `Refusing to splice ${first.quoteKey} with ${part.quoteKey}.`,
          false,
        ),
      );
    }
  }

  const byDate = new Map<string, DailyBar>();
  for (const part of parts) {
    for (const bar of part.bars) {
      const key = bar.asOf.toISO();
      if (!byDate.has(key)) byDate.set(key, bar);
    }
  }
  const bars = [...byDate.values()].sort((a, b) => a.asOf.compareTo(b.asOf));

  return Ok({
    quoteKey: first.quoteKey,
    currency: first.currency,
    adjusted: first.adjusted,
    asOf: bars.length > 0 ? bars[bars.length - 1].asOf : first.asOf,
    bars,
    sourceId: [...new Set(parts.map((p) => p.sourceId))].join("+"),
  });
}

/**
 * Every rate used to value one portfolio history must be the same kind of number.
 *
 * Checked on the whole set rather than pairwise on insertion, because the mixture
 * only becomes visible once the set exists.
 */
export function assertUniformFxKind(rates: readonly FxRate[]): MarketDataResult<readonly FxRate[]> {
  const kinds = [...new Set(rates.map((rate) => rate.kind))];
  if (kinds.length > 1) {
    const where = rates
      .filter((rate, index) => rates.findIndex((r) => r.kind === rate.kind) === index)
      .map((rate) => `${rate.kind} from ${rate.sourceId}`)
      .join(" and ");
    return Err(
      new ProviderError(
        "MALFORMED_RESPONSE",
        CHAIN_ID,
        `Refusing to value one history with mixed FX rate types (${where}): they differ by ` +
          `about 0.18%, which would show up as a return the portfolio never earned.`,
        false,
      ),
    );
  }
  return Ok(rates);
}

/* ═══ The facade callers hold ═════════════════════════════════════════ */

/**
 * What the container exposes and the use cases consume.
 *
 * Nothing above this line knows a vendor's name. `resolvedBy` comes back on every
 * call so the catalogue can record the pin, which is what makes the *second*
 * request for an instrument go straight to the source that worked.
 */
export class MarketDataChain {
  constructor(
    private readonly registry: MarketDataRegistry,
    private readonly pins: VendorPins = NO_VENDOR_PINS,
  ) {}

  /** The pin store, so a caller that resolved something can record it. */
  get vendorPins(): VendorPins {
    return this.pins;
  }

  async search(query: SymbolSearchQuery): Promise<ChainResult<readonly SymbolCandidate[]>> {
    const market = query.market ?? "GLOBAL";
    return runChain(`search "${query.text}" in ${market}`, this.registry.searchChain(market), (a) =>
      a.search(query),
    );
  }

  async quote(
    market: MarketCode,
    request: LiveQuoteRequest,
  ): Promise<ChainResult<readonly LiveQuote[]>> {
    const pinKey = request.subjects.length === 1 ? request.subjects[0].quoteKey : undefined;
    const what = `quotes for ${request.subjects.map((s) => s.quoteKey).join(", ")}`;
    return runChain(what, this.registry.quoteChain(market, pinKey), (a) => a.quote(request));
  }

  /**
   * One instrument's daily history, from one source.
   *
   * Deliberately not stitched across sources: see {@link spliceSeries}. A caller
   * that genuinely has two same-`adjusted` parts (an archive backfill plus today's
   * delta) calls `spliceSeries` itself and gets the refusal if it was wrong.
   */
  async history(request: HistoryRequest): Promise<ChainResult<HistoricalSeries>> {
    const chain = this.registry.historyChain(request.market, request.quoteKey);
    const outcome = await runChain(
      `history for ${request.quoteKey} ${request.range.toString()}`,
      chain,
      (a) => a.history(request),
    );
    if (!outcome.ok) return outcome;

    // An adapter that could not honour `adjusted` is not a failure to be hidden:
    // the caller asked for restated prices and got traded prices, and only the
    // caller knows whether that is acceptable for what it is about to compute.
    const series = outcome.value.value;
    if (series.adjusted !== request.adjusted) {
      return Err(
        new ProviderError(
          "UNSUPPORTED",
          CHAIN_ID,
          `${series.sourceId} served ${request.quoteKey} with adjusted=${series.adjusted}, but ` +
            `adjusted=${request.adjusted} was asked for. Ask the other chain member, or accept ` +
            `the other kind explicitly.`,
          false,
        ),
      );
    }
    return outcome;
  }

  async fx(request: FxRateRequest): Promise<ChainResult<FxRate>> {
    const what = `${request.base.code}/${request.quote.code} on ${request.on.toISO()}`;
    return runChain(what, this.registry.fxChain(), (a) => a.rate(request));
  }

  /**
   * A whole series of FX rates for one portfolio history — one source, or refuse.
   *
   * Failover happens **per series, not per date**: falling back to a second source
   * for one missing day is precisely the mixture {@link assertUniformFxKind}
   * exists to prevent, so the chain is chosen once and every date must come from it.
   */
  async fxSeries(requests: readonly FxRateRequest[]): Promise<ChainResult<readonly FxRate[]>> {
    const what = `${requests.length} FX rate(s)`;
    const outcome = await runChain(what, this.registry.fxChain(), async (adapter) => {
      const rates: FxRate[] = [];
      for (const request of requests) {
        const one = await adapter.rate(request);
        if (!one.ok) return one;
        rates.push(one.value);
      }
      return Ok(rates as readonly FxRate[]);
    });
    if (!outcome.ok) return outcome;

    const uniform = assertUniformFxKind(outcome.value.value);
    if (!uniform.ok) return Err(uniform.error);
    return outcome;
  }

  /** The configured chains, for the runbook and for a health page. */
  describe(): readonly string[] {
    return this.registry.describe();
  }
}
