/**
 * The fetch-attempt writer for the source health monitor (task 6.4 follow-up).
 *
 * Every market-data source is asked questions through a port — `search`, `quote`,
 * `history`, `rate`, `load`, `map`, `actions` on the engine adapters, `fetchQuotes` /
 * `fetchRates` on the price ladder. {@link FetchAttemptWriter.wrap} decorates a port so
 * each of those calls is timed and recorded as one attempt (source id, time, outcome,
 * latency, error class) without touching a single adapter.
 *
 * The rule this file exists to keep: **recording never makes a fetch fail and never
 * makes it wait.** `record()` is called once, after the answer is in hand, and is never
 * awaited; anything it throws or rejects with is swallowed and counted in
 * {@link FetchAttemptWriter.failures}. The caller gets the adapter's own result.
 *
 * Durable storage needs a table this module does not own (see the plan section
 * "Fetch-attempt writer"), so the shipped recorder is {@link InMemoryFetchAttemptLog}: a
 * bounded ring per source, process-wide, which also serves as the monitor's reader.
 */

import { Err, SystemClock } from "@/core/kernel";
import { CalendarDate } from "@/core/time";
import { Count, Millis } from "@/core/units";
import type { FetchLogReader } from "@/app/source-health.usecases";
import type { FetchObservation } from "@/domain/source-health";
import { ProviderError, type HealthStatus } from "@/domain/pricing";
import type { MarketDataEngine } from "@/infra/market-data";
import { MarketDataChain } from "@/market-data/engine/chain";
import { DEFAULT_MARKET_DATA_CHAINS, MarketDataRegistry, type MarketDataChainConfig } from "@/market-data/engine/registry";
import type { AnyMarketDataPort } from "@/market-data/ports";

/* ═══ The record and the port ═════════════════════════════════════════ */

export type FetchAttemptOutcome = "SUCCESS" | "FAILURE";

/** Error class of a call that threw instead of returning `Err`: an adapter defect, not a vendor answer. */
export const THREW = "THREW";

/** One question asked of one source. Retries inside an adapter's `run()` are part of the one attempt. */
export interface FetchAttempt {
  readonly sourceId: string;
  /** The port method asked, e.g. `quote` or `fetchQuotes`. */
  readonly operation: string;
  /** When the call started, from the injected clock. */
  readonly at: Date;
  readonly outcome: FetchAttemptOutcome;
  /** Wall time of the call, measured on a monotonic timer. Never negative. */
  readonly latency: Millis;
  /** `ProviderError.kind`, or {@link THREW}; null on success. Never the raw message. */
  readonly errorKind: string | null;
}

/**
 * Where attempts go. May be synchronous or return a promise; the writer never awaits it,
 * so a durable implementation must buffer and flush off the request path.
 */
export interface FetchAttemptRecorder {
  record(attempt: FetchAttempt): void | Promise<void>;
}

/* ═══ The decorator ═══════════════════════════════════════════════════ */

/** Port methods that ask a source a question. Everything else passes through untouched. */
const RECORDED_METHODS: ReadonlySet<PropertyKey> = new Set([
  "search",
  "quote",
  "history",
  "rate",
  "load",
  "map",
  "actions",
  "fetchQuotes",
  "fetchRates",
]);

type AnyResult = { readonly ok: boolean; readonly error?: unknown };

/** The id a port is known by: `info.id` on the engine ports, `id` on the price ladder. */
function sourceIdOf(target: object): string {
  const withInfo = target as { info?: { id?: unknown }; id?: unknown };
  if (typeof withInfo.info?.id === "string") return withInfo.info.id;
  if (typeof withInfo.id === "string") return withInfo.id;
  return "unknown-source";
}

const monotonicNow = (): number => globalThis.performance?.now() ?? Date.now();

export class FetchAttemptWriter {
  private failed = 0;

  constructor(
    private readonly recorder: FetchAttemptRecorder,
    /** Timestamp of an attempt; inject the app clock so as-of evaluation agrees with it. */
    private readonly clock: () => Date = () => new Date(),
    /** Latency timer, monotonic by default. */
    private readonly timer: () => number = monotonicNow,
  ) {}

  /** Recorder or clock failures swallowed so far. Each one is an attempt that went unrecorded. */
  get failures(): Count {
    return Count(this.failed);
  }

  /**
   * The same port, with every question it is asked recorded.
   *
   * A Proxy rather than a hand-written wrapper per port shape: the registry holds seven
   * port types and the ladder two more, and a wrapper that forgot `rateKind` or
   * `probeQuoteKey` would break a caller silently. Non-recorded members are bound to the
   * real adapter so its own `this` is never the proxy.
   */
  wrap<P extends object>(port: P): P {
    const bound = new Map<PropertyKey, unknown>();
    return new Proxy(port, {
      get: (target, prop) => {
        const value: unknown = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        const cached = bound.get(prop);
        if (cached) return cached;
        const fn = value as (...args: unknown[]) => unknown;
        const replacement =
          prop === "health"
            ? () => this.safeHealth(target, fn)
            : RECORDED_METHODS.has(prop)
              ? (...args: unknown[]) => this.observe(target, String(prop), () => fn.apply(target, args))
              : fn.bind(target);
        bound.set(prop, replacement);
        return replacement;
      },
    });
  }

  /**
   * A health probe that throws must not stop the source being tried: `runChain` and
   * `PriceBook.refresh` read it before every call. The call itself is still recorded.
   */
  private safeHealth(target: object, health: (...args: unknown[]) => unknown): HealthStatus {
    try {
      return health.apply(target, []) as HealthStatus;
    } catch {
      return { state: "DEGRADED", consecutiveFailures: Count(0), lastError: `${sourceIdOf(target)} health check failed.`, circuitOpenUntil: null };
    }
  }

  private async observe(target: object, operation: string, call: () => unknown): Promise<unknown> {
    const sourceId = sourceIdOf(target);
    const at = this.safely(this.clock);
    const started = this.safely(this.timer);

    let result: unknown;
    let errorKind: string | null;
    try {
      result = await call();
      const answer = result as AnyResult;
      errorKind = answer?.ok === false ? (answer.error instanceof ProviderError ? answer.error.kind : "UPSTREAM") : null;
    } catch (thrown) {
      // A port promises `Err`, never a throw. One that throws anyway is turned into the
      // `Err` it should have returned, so the chain fails over instead of crashing.
      result = Err(new ProviderError("UPSTREAM", sourceId, `${sourceId} failed unexpectedly during ${operation}.`, true, { cause: thrown }));
      errorKind = THREW;
    }

    const ended = this.safely(this.timer);
    if (at !== null && started !== null && ended !== null) {
      this.write({
        sourceId,
        operation,
        at,
        outcome: errorKind === null ? "SUCCESS" : "FAILURE",
        latency: Millis(Math.max(0, Math.round(ended - started))),
        errorKind,
      });
    }
    return result;
  }

  private write(attempt: FetchAttempt): void {
    try {
      const pending = this.recorder.record(Object.freeze(attempt));
      if (pending && typeof pending.then === "function") pending.then(undefined, () => { this.failed += 1; });
    } catch {
      this.failed += 1;
    }
  }

  /** A clock or timer that throws costs one unrecorded attempt, never the fetch. */
  private safely<T>(read: () => T): T | null {
    try {
      const value = read();
      if (typeof value === "number" && !Number.isFinite(value)) throw new RangeError("non-finite time");
      if (value instanceof Date && Number.isNaN(value.getTime())) throw new RangeError("invalid date");
      return value;
    } catch {
      this.failed += 1;
      return null;
    }
  }
}

/**
 * The engine with every adapter recorded.
 *
 * Rebuilds the registry and chain from the engine's own adapters and pins, so it needs
 * no change to `buildMarketDataEngine`. Pass `config` if the engine was built with a
 * non-default chain table — the registry does not expose its own.
 */
export function withFetchRecording(
  engine: MarketDataEngine,
  writer: FetchAttemptWriter,
  config: MarketDataChainConfig = DEFAULT_MARKET_DATA_CHAINS,
): MarketDataEngine {
  const wrapped = new Map<AnyMarketDataPort, AnyMarketDataPort>();
  for (const adapter of engine.registry.all()) wrapped.set(adapter, writer.wrap(adapter));
  const registry = new MarketDataRegistry([...wrapped.values()], config, engine.pins);
  const yahoo = (wrapped.get(engine.yahoo) as MarketDataEngine["yahoo"] | undefined) ?? engine.yahoo;
  return { registry, chain: new MarketDataChain(registry, engine.pins), pins: engine.pins, yahoo };
}

/* ═══ The in-memory log ═══════════════════════════════════════════════ */

class Ring<T> {
  private readonly items: T[] = [];
  private next = 0;

  constructor(private readonly capacity: number) {}

  push(item: T): T | null {
    if (this.items.length < this.capacity) {
      this.items.push(item);
      return null;
    }
    const evicted = this.items[this.next];
    this.items[this.next] = item;
    this.next = (this.next + 1) % this.capacity;
    return evicted;
  }

  /** Oldest first. */
  toArray(): readonly T[] {
    return [...this.items.slice(this.next), ...this.items.slice(0, this.next)];
  }
}

const dayOf = (instant: Date): CalendarDate => CalendarDate.parse(SystemClock.toReportingDate(instant));

const toObservation = (attempt: FetchAttempt): FetchObservation =>
  Object.freeze({
    sourceId: attempt.sourceId,
    observedOn: dayOf(attempt.at),
    outcome: attempt.outcome,
    failures: Count(1),
    errorKind: attempt.errorKind,
  });

/**
 * A bounded attempt log per source, and the monitor's reader over it.
 *
 * Two honesty rules:
 *  - The latest success is pinned outside the ring, so a run of failures long enough to
 *    evict it still reports FAILING / STALE, never a false NEVER_SUCCEEDED.
 *  - A source with **no** attempt since the log was created makes `observationsFor`
 *    throw, which `ViewSourceHealth` reports as UNREADABLE with no alert. After a restart
 *    the honest answer is "not asked yet", not "never returned data".
 */
export class InMemoryFetchAttemptLog implements FetchAttemptRecorder, FetchLogReader {
  private readonly rings = new Map<string, Ring<FetchAttempt>>();
  private readonly lastSuccess = new Map<string, FetchAttempt>();
  private readonly perSource: number;

  constructor(capacityPerSource: Count = Count(200)) {
    if (capacityPerSource < 1) throw new RangeError("An attempt log must hold at least one attempt per source.");
    this.perSource = capacityPerSource;
  }

  record(attempt: FetchAttempt): void {
    let ring = this.rings.get(attempt.sourceId);
    if (!ring) {
      ring = new Ring<FetchAttempt>(this.perSource);
      this.rings.set(attempt.sourceId, ring);
    }
    ring.push(attempt);
    if (attempt.outcome === "SUCCESS") {
      const previous = this.lastSuccess.get(attempt.sourceId);
      if (!previous || previous.at.getTime() <= attempt.at.getTime()) this.lastSuccess.set(attempt.sourceId, attempt);
    }
  }

  /** Sources that have been asked anything, in first-asked order. */
  sourceIds(): readonly string[] {
    return [...this.rings.keys()];
  }

  /** The retained attempts for one source, oldest first. */
  attemptsFor(sourceId: string): readonly FetchAttempt[] {
    return this.rings.get(sourceId)?.toArray() ?? [];
  }

  async observationsFor(sourceId: string, asOf: CalendarDate): Promise<readonly FetchObservation[]> {
    const ring = this.rings.get(sourceId);
    if (!ring) throw new Error(`No fetch attempt has been recorded for ${sourceId} since this process started.`);
    const retained = ring.toArray();
    const pinned = this.lastSuccess.get(sourceId);
    const all = pinned && !retained.includes(pinned) ? [pinned, ...retained] : retained;
    return Object.freeze(all.map(toObservation).filter((o) => o.observedOn.isOnOrBefore(asOf)));
  }
}

/**
 * The process-wide log. `services()` is cached per request, so a log built inside the
 * container would be empty on every request; this one lives as long as the server process.
 */
export const processFetchAttempts = new InMemoryFetchAttemptLog();
