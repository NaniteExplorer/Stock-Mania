/** Task 6.4: every source degrades gracefully; none is load-bearing. No network: fakes only. */
import { UserId } from "@/core/kernel";
import { CalendarDate } from "@/core/time";
import { Count, Days } from "@/core/units";
import { sourceFailureAlert } from "@/domain/alerts";
import { gateBySourceHealth, summarizeSourceHealth, summarizeSources, type FetchObservation } from "@/domain/source-health";
import { ViewSourceHealth, type FetchLogReader } from "@/app/source-health.usecases";
import { classifyFetchError, rowToObservations } from "@/infra/market-data/source-health";
import { check, checkTrue, done, section } from "./harness";

const d = CalendarDate.parse;
const asOf = d("2026-10-30");
const ok = (sourceId: string, on: string): FetchObservation => ({ sourceId, observedOn: d(on), outcome: "SUCCESS", failures: Count(1), errorKind: null });
const fail = (sourceId: string, on: string, n = 1, errorKind: string | null = "TIMEOUT"): FetchObservation =>
  ({ sourceId, observedOn: d(on), outcome: "FAILURE", failures: Count(n), errorKind });
const spec = (id: string, maxAge = 4) => ({ id, name: id.toUpperCase(), maxAge: Days(maxAge) });

section("status");
const healthy = summarizeSourceHealth(spec("amfi"), [ok("amfi", "2026-10-29")], asOf);
check("fresh success is HEALTHY", healthy.status, "HEALTHY");
check("age in days", healthy.ageDays, 1);
const failing = summarizeSourceHealth(spec("yahoo"), [ok("yahoo", "2026-10-28"), fail("yahoo", "2026-10-29", 3), fail("yahoo", "2026-10-30", 2, "UPSTREAM")], asOf);
check("fresh success then failures is FAILING", failing.status, "FAILING");
check("consecutive failures since success", failing.consecutiveFailures, 5);
check("last error kind", failing.lastErrorKind, "UPSTREAM");
const stale = summarizeSourceHealth(spec("nse", 4), [ok("nse", "2026-10-20"), fail("nse", "2026-10-29")], asOf);
check("success older than this source's max age is STALE", stale.status, "STALE");
check("per-source max age honoured", summarizeSourceHealth(spec("nse", 30), [ok("nse", "2026-10-20")], asOf).status, "HEALTHY");

section("never succeeded");
const never = summarizeSourceHealth(spec("bse"), [fail("bse", "2026-10-29", 4)], asOf);
check("only failures is NEVER_SUCCEEDED", never.status, "NEVER_SUCCEEDED");
check("age is null, not zero", never.ageDays, null);
check("last success is null", never.lastSuccessOn, null);
check("empty log is NEVER_SUCCEEDED", summarizeSourceHealth(spec("x"), [], asOf).status, "NEVER_SUCCEEDED");
checkTrue("alert says it never returned data",
  sourceFailureAlert({ id: never.id, name: never.name, lastSuccessOn: never.lastSuccessOn }, never.maxAge, asOf)?.text.includes("never returned data") ?? false);

section("as-of ignores future rows");
const rows = [ok("fx", "2026-10-01"), fail("fx", "2026-10-02"), ok("fx", "2026-10-25"), fail("fx", "2026-10-26", 9)];
const past = summarizeSourceHealth(spec("fx"), rows, d("2026-10-03"));
check("last success as of then", past.lastSuccessOn?.toISO(), "2026-10-01");
check("only failures on/before as-of counted", past.consecutiveFailures, 1);
check("historical status", past.status, "FAILING");
check("before any row: never succeeded", summarizeSourceHealth(spec("fx"), rows, d("2026-09-30")).status, "NEVER_SUCCEEDED");
let refused = "";
try { sourceFailureAlert(past, past.maxAge, d("2026-10-03")); } catch (e) { refused = (e as Error).message; }
check("result is accepted by sourceFailureAlert as of the same date", refused, "");
check("infra mapping drops rows after as-of",
  rowToObservations({ providerId: "p", lastAttemptAt: new Date("2026-11-02T06:00:00Z"), lastSuccessAt: new Date("2026-10-28T06:00:00Z"), lastError: "TIMEOUT", consecutiveFailures: 3 }, asOf).length, 1);

section("isolation and stale values");
const all = summarizeSources([spec("a"), spec("b")], [ok("a", "2026-10-30"), fail("b", "2026-10-30", 7)], asOf);
check("failing b does not alter a", all[0].status, "HEALTHY");
check("a has no failures from b", all[0].consecutiveFailures, 0);
check("b never succeeded", all[1].status, "NEVER_SUCCEEDED");
check("stale value marked stale, value kept", gateBySourceHealth(stale, "123.45").state, "STALE");
const unknown = gateBySourceHealth(never, null);
check("never-succeeded value is unknown", unknown.state, "UNKNOWN");
check("unknown value is null, not zero", unknown.value, null);
checkTrue("snapshot is frozen", Object.isFrozen(healthy) && Object.isFrozen(all));
check("error classification", classifyFetchError("yahoo did not respond: TIMEOUT"), "TIMEOUT");
check("unknown error text is unclassified", classifyFetchError("boom"), "UNCLASSIFIED");

section("use case never throws");
const owner = UserId.from("owner-1");
const reader: FetchLogReader = {
  async observationsFor(id) {
    if (id === "broken") throw new Error("database is locked");
    if (id === "rejecting") return Promise.reject("not an Error");
    return id === "good" ? [ok("good", "2026-10-30")] : [fail(id, "2026-10-30")];
  },
};
const view = new ViewSourceHealth(reader);
let threw = false;
const out = await view.execute({ userId: owner, asOf, sources: [spec("good"), spec("broken"), spec("rejecting"), spec("dead")] }).catch(() => { threw = true; return null; });
check("throwing reader does not throw to caller", threw, false);
check("all four sources reported", out?.sources.length, 4);
check("good source unaffected", out?.sources[0].state === "READ" ? out.sources[0].health.status : "?", "HEALTHY");
check("throwing source is UNREADABLE", out?.sources[1].state, "UNREADABLE");
check("rejecting non-Error source is UNREADABLE", out?.sources[2].state, "UNREADABLE");
check("failing source reported never-succeeded", out?.sources[3].state === "READ" ? out.sources[3].health.status : "?", "NEVER_SUCCEEDED");
check("unreadable sources give no guessed alert input", out?.alertInputs.map((i) => i.id).join(","), "good,dead");

section("untrusted reader failures stay isolated and private");
const secretSentinel = "synthetic-private-reader-detail";
const hostile = Object.defineProperty({}, "message", { get() { throw new Error("message getter must not run"); } });
const hostileString = { toString() { throw new Error("string conversion must not run"); } };
const privateView = new ViewSourceHealth({ observationsFor(id) {
  if (id === "private") throw new Error(secretSentinel);
  if (id === "getter") return Promise.reject(hostile);
  if (id === "stringifier") return Promise.reject(hostileString);
  return Promise.resolve([ok(id, "2026-10-30")]);
} });
const privateOut = await privateView.execute({ userId: owner, asOf, sources: [spec("private"), spec("getter"), spec("stringifier"), spec("good")] });
check("all hostile sources are isolated", privateOut.sources.map((entry) => entry.state).join(","), "UNREADABLE,UNREADABLE,UNREADABLE,READ");
check("reader details never enter returned output", JSON.stringify(privateOut).includes(secretSentinel), false);
check("unaffected source still contributes its alert input", privateOut.alertInputs.map((entry) => entry.id).join(","), "good");
checkTrue("failure still names its configured source", privateOut.sources[0].state === "UNREADABLE" && privateOut.sources[0].reason.includes(spec("private").name));

done();
