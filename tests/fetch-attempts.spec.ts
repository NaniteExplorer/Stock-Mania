/**
 * Task 6.4 follow-up: the fetch-attempt writer. Recording never fails or delays a fetch;
 * a writer failure is swallowed and counted. No network: fakes only, made-up source ids.
 */
import { Err, Ok, UserId } from "@/core/kernel";
import { Currency } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Count, Days, Millis } from "@/core/units";
import { type HealthStatus, ProviderError } from "@/domain/pricing";
import { summarizeSourceHealth } from "@/domain/source-health";
import { ViewSourceHealth } from "@/app/source-health.usecases";
import type { MarketDataEngine } from "@/infra/market-data";
import {
  FetchAttemptWriter,
  InMemoryFetchAttemptLog,
  THREW,
  withFetchRecording,
  type FetchAttempt,
  type FetchAttemptRecorder,
} from "@/infra/market-data/fetch-attempts";
import { MarketDataChain, runChain } from "@/market-data/engine/chain";
import { InMemoryVendorPins, MarketDataRegistry, type MarketDataChainConfig } from "@/market-data/engine/registry";
import type { LiveQuote, LiveQuotePort, LiveQuoteRequest, MarketDataResult, MarketDataSourceInfo } from "@/market-data/ports";
import { check, checkTrue, done, section } from "./harness";

const INR = Currency.of("INR");
const HEALTHY: HealthStatus = { state: "HEALTHY", consecutiveFailures: Count(0), lastError: null, circuitOpenUntil: null };
const info = (id: string): MarketDataSourceInfo => ({ id, displayName: id, capabilities: ["QUOTE"], markets: ["GLOBAL", "IN", "US"], keyless: true });
const REQUEST: LiveQuoteRequest = { subjects: [{ quoteKey: "FAKE1.NS", currency: INR, market: "IN" }] };

type Behaviour = "ok" | "err" | "throw";

class FakeQuote implements LiveQuotePort {
  readonly info: MarketDataSourceInfo;
  calls = 0;
  #secret = "bound-to-target";

  constructor(id: string, private readonly behaviour: Behaviour, private readonly healthThrows = false) {
    this.info = info(id);
  }

  health(): HealthStatus {
    if (this.healthThrows) throw new Error("health probe exploded");
    return HEALTHY;
  }

  /** Not a port method; proves pass-through keeps the real `this`. */
  secret(): string {
    return this.#secret;
  }

  async quote(request: LiveQuoteRequest): Promise<MarketDataResult<readonly LiveQuote[]>> {
    this.calls += 1;
    if (this.behaviour === "throw") throw new TypeError("parser bug");
    if (this.behaviour === "err") return Err(new ProviderError("TIMEOUT", this.info.id, `${this.info.id} timed out.`, true));
    return Ok(request.subjects.map((s) => ({
      quoteKey: s.quoteKey, priceScaled: 12_345_000_000n, currency: s.currency, asOf: CalendarDate.parse("2026-10-30"),
      observedAt: new Date("2026-10-30T09:00:00Z"), stale: false, sourceId: this.info.id,
    })));
  }
}

/** A fixed clock and a timer that advances 7 ms per read. */
const fixedAt = new Date("2026-10-30T06:00:00Z");
const steppingTimer = () => { let t = 1000; return () => (t += 7); };

const captured = (): FetchAttemptRecorder & { attempts: FetchAttempt[] } => {
  const attempts: FetchAttempt[] = [];
  return { attempts, record: (a) => { attempts.push(a); } };
};

section("records each call");
{
  const sink = captured();
  const writer = new FetchAttemptWriter(sink, () => fixedAt, steppingTimer());
  const raw = new FakeQuote("fake-good", "ok");
  const port = writer.wrap(raw);
  const result = await port.quote(REQUEST);
  check("result returned", result.ok, true);
  check("one attempt recorded", sink.attempts.length, 1);
  const [a] = sink.attempts;
  check("source id", a.sourceId, "fake-good");
  check("operation", a.operation, "quote");
  check("outcome", a.outcome, "SUCCESS");
  check("time from injected clock", a.at.toISOString(), fixedAt.toISOString());
  check("latency from timer", a.latency, 7);
  check("no error kind on success", a.errorKind, null);
  checkTrue("attempt is frozen", Object.isFrozen(a));
  check("info passes through", port.info.id, "fake-good");
  check("health passes through", port.health().state, "HEALTHY");
  check("non-port method keeps real this", (port as FakeQuote).secret(), "bound-to-target");
  check("instanceof preserved", port instanceof FakeQuote, true);
  check("adapter called once", raw.calls, 1);

  const failing = writer.wrap(new FakeQuote("fake-slow", "err"));
  const err = await failing.quote(REQUEST);
  check("Err passed through unchanged", !err.ok && err.error.kind, "TIMEOUT");
  check("failure recorded with error class", sink.attempts[1].outcome + "/" + sink.attempts[1].errorKind, "FAILURE/TIMEOUT");
  checkTrue("raw message never recorded", !JSON.stringify(sink.attempts).includes("timed out"));
}

section("price-ladder shape (id, fetchQuotes)");
{
  const sink = captured();
  const writer = new FetchAttemptWriter(sink, () => fixedAt, steppingTimer());
  const ladder = writer.wrap({ id: "fake-ladder", displayName: "Fake", async fetchQuotes() { return Ok([] as const); }, rateLimit: () => "kept" });
  await ladder.fetchQuotes();
  check("recorded under provider id", sink.attempts[0]?.sourceId, "fake-ladder");
  check("operation name", sink.attempts[0]?.operation, "fetchQuotes");
  check("other members untouched", ladder.rateLimit(), "kept");
}

section("a throwing adapter becomes Err, recorded THREW, and the chain fails over");
{
  const sink = captured();
  const writer = new FetchAttemptWriter(sink, () => fixedAt, steppingTimer());
  const broken = writer.wrap(new FakeQuote("fake-broken", "throw"));
  const backup = writer.wrap(new FakeQuote("fake-backup", "ok"));
  let threw = false;
  const outcome = await runChain("quotes", [broken, backup], (p) => p.quote(REQUEST)).catch(() => { threw = true; return null; });
  check("chain did not throw", threw, false);
  check("backup answered", outcome?.ok ? outcome.value.resolvedBy : "?", "fake-backup");
  check("broken listed as failed attempt", outcome?.ok ? outcome.value.attempts[0].error.kind : "?", "UPSTREAM");
  check("thrown recorded as THREW", sink.attempts[0].errorKind, THREW);
  check("backup recorded as success", sink.attempts[1].outcome, "SUCCESS");

  const shaky = writer.wrap(new FakeQuote("fake-shaky", "ok", true));
  check("throwing health reports DEGRADED", shaky.health().state, "DEGRADED");
  const viaChain = await runChain("quotes", [shaky], (p) => p.quote(REQUEST));
  check("source still tried after a throwing health()", viaChain.ok, true);
}

section("recording never fails or delays a fetch");
{
  const throwing = new FetchAttemptWriter({ record: () => { throw new Error("disk full"); } }, () => fixedAt, steppingTimer());
  const r1 = await throwing.wrap(new FakeQuote("fake-a", "ok")).quote(REQUEST);
  check("throwing recorder: fetch still succeeds", r1.ok, true);
  check("throwing recorder: failure counted", throwing.failures, 1);

  const rejecting = new FetchAttemptWriter({ record: () => Promise.reject(new Error("db locked")) }, () => fixedAt, steppingTimer());
  const r2 = await rejecting.wrap(new FakeQuote("fake-b", "ok")).quote(REQUEST);
  await Promise.resolve();
  await Promise.resolve();
  check("rejecting recorder: fetch still succeeds", r2.ok, true);
  check("rejecting recorder: failure counted", rejecting.failures, 1);

  const hanging = new FetchAttemptWriter({ record: () => new Promise<void>(() => {}) }, () => fixedAt, steppingTimer());
  const raced = await Promise.race([
    hanging.wrap(new FakeQuote("fake-c", "ok")).quote(REQUEST).then(() => "fetched"),
    new Promise((resolve) => setTimeout(() => resolve("blocked"), 50)),
  ]);
  check("never-settling recorder is not awaited", raced, "fetched");

  const sink = captured();
  const badClock = new FetchAttemptWriter(sink, () => { throw new Error("clock gone"); }, steppingTimer());
  const r3 = await badClock.wrap(new FakeQuote("fake-d", "ok")).quote(REQUEST);
  check("throwing clock: fetch still succeeds", r3.ok, true);
  check("throwing clock: nothing recorded", sink.attempts.length, 0);
  check("throwing clock: counted", badClock.failures, 1);

  const nanTimer = new FetchAttemptWriter(sink, () => fixedAt, () => Number.NaN);
  check("non-finite timer: fetch still succeeds", (await nanTimer.wrap(new FakeQuote("fake-e", "ok")).quote(REQUEST)).ok, true);
  check("non-finite timer: nothing recorded", sink.attempts.length, 0);
}

section("in-memory log: bounded, honest, readable by the monitor");
{
  const attempt = (sourceId: string, iso: string, outcome: "SUCCESS" | "FAILURE"): FetchAttempt =>
    ({ sourceId, operation: "quote", at: new Date(iso), outcome, latency: Millis(5), errorKind: outcome === "FAILURE" ? "UPSTREAM" : null });
  const log = new InMemoryFetchAttemptLog(Count(3));
  log.record(attempt("fake-x", "2026-10-28T05:00:00Z", "SUCCESS"));
  for (const day of ["29", "29", "30", "30"]) log.record(attempt("fake-x", `2026-10-${day}T05:00:00Z`, "FAILURE"));
  check("ring is bounded per source", log.attemptsFor("fake-x").length, 3);
  const asOf = CalendarDate.parse("2026-10-30");
  const obs = await log.observationsFor("fake-x", asOf);
  check("pinned success survives eviction", obs.filter((o) => o.outcome === "SUCCESS").length, 1);
  const health = summarizeSourceHealth({ id: "fake-x", name: "X", maxAge: Days(4) }, obs, asOf);
  check("evicted success still reports FAILING, not NEVER_SUCCEEDED", health.status, "FAILING");
  check("failures since success (retained)", health.consecutiveFailures, 3);
  check("as-of drops later attempts", (await log.observationsFor("fake-x", CalendarDate.parse("2026-10-28"))).length, 1);
  checkTrue("observations frozen", Object.isFrozen(obs));

  let missing = "";
  await log.observationsFor("fake-never-asked", asOf).catch((e: Error) => { missing = e.message; });
  checkTrue("unasked source throws (reader contract)", missing.includes("since this process started"));

  log.record(attempt("fake-y", "2026-10-30T05:00:00Z", "SUCCESS"));
  check("other sources unaffected", log.attemptsFor("fake-y").length, 1);
  check("source ids listed", log.sourceIds().join(","), "fake-x,fake-y");
}

section("end to end: writer -> log -> ViewSourceHealth");
{
  const log = new InMemoryFetchAttemptLog();
  const writer = new FetchAttemptWriter(log, () => new Date("2026-10-30T06:00:00Z"), steppingTimer());
  await writer.wrap(new FakeQuote("fake-good", "ok")).quote(REQUEST);
  await writer.wrap(new FakeQuote("fake-bad", "err")).quote(REQUEST);
  const spec = (id: string) => ({ id, name: id, maxAge: Days(4) });
  const out = await new ViewSourceHealth(log).execute({
    userId: UserId.from("owner-1"), asOf: CalendarDate.parse("2026-10-30"),
    sources: [spec("fake-good"), spec("fake-bad"), spec("fake-idle")],
  });
  check("good is HEALTHY", out.sources[0].state === "READ" ? out.sources[0].health.status : "?", "HEALTHY");
  check("bad never succeeded", out.sources[1].state === "READ" ? out.sources[1].health.status : "?", "NEVER_SUCCEEDED");
  check("idle since start is UNREADABLE, not a false alert", out.sources[2].state, "UNREADABLE");
  check("alert inputs exclude the idle source", out.alertInputs.map((i) => i.id).join(","), "fake-good,fake-bad");
}

section("withFetchRecording re-wires the engine");
{
  const config: MarketDataChainConfig = { QUOTE: { IN: ["fake-primary", "fake-second"] } };
  const pins = new InMemoryVendorPins();
  const primary = new FakeQuote("fake-primary", "err");
  const registry = new MarketDataRegistry([primary, new FakeQuote("fake-second", "ok")], config, pins);
  const engine: MarketDataEngine = { registry, chain: new MarketDataChain(registry, pins), pins, yahoo: primary as unknown as MarketDataEngine["yahoo"] };
  const sink = captured();
  const recorded = withFetchRecording(engine, new FetchAttemptWriter(sink, () => fixedAt, steppingTimer()), config);
  const answer = await recorded.chain.quote("IN", REQUEST);
  check("chain still fails over", answer.ok ? answer.value.resolvedBy : "?", "fake-second");
  check("both attempts recorded", sink.attempts.map((a) => `${a.sourceId}:${a.outcome}`).join(","), "fake-primary:FAILURE,fake-second:SUCCESS");
  check("pins shared", recorded.pins, pins);
  checkTrue("yahoo slot is the wrapped adapter", recorded.yahoo !== engine.yahoo && recorded.registry.get("fake-primary") === (recorded.yahoo as unknown));
  await engine.chain.quote("IN", REQUEST);
  check("original engine untouched (not recorded)", sink.attempts.length, 2);
}

done();
