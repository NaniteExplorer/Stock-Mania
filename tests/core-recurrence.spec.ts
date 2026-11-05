import { Currency, Money } from "@/core/money";
import { PriceSteps, Recurrence, type Cadence } from "@/core/recurrence";
import { CalendarDate, DateRange } from "@/core/time";
import { Days, Ordinal } from "@/core/units";
import { check, checkDeep, done, section, throws } from "./harness";

const on = (iso: string) => CalendarDate.parse(iso);
const rupees = (value: string) => Money.fromRupees(value);
const every = (cadence: Cadence, anchor: string, endsOn: string | null = null, notice: number | null = null) =>
  new Recurrence({ cadence, anchor: on(anchor), endsOn: endsOn === null ? null : on(endsOn), cancelNotice: notice === null ? null : Days(notice) });
const isoList = (dates: readonly (CalendarDate | null)[]) => dates.map((date) => date?.toISO() ?? "null");

section("occurrences are counted from the anchor, never chained");
const monthEnd = every("MONTHLY", "2026-01-31");
checkDeep(
  "31 Jan keeps returning to the month's end instead of drifting to the 28th",
  isoList([0, 1, 2, 3].map((n) => monthEnd.occurrence(Ordinal(n)))),
  ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"],
);
check("a leap February takes the 29th", every("MONTHLY", "2028-01-31").occurrence(Ordinal(1))?.toISO(), "2028-02-29");
checkDeep(
  "an annual renewal on 29 Feb falls on the 28th, and returns to the 29th in the next leap year",
  isoList([1, 4].map((n) => every("ANNUAL", "2024-02-29").occurrence(Ordinal(n)))),
  ["2025-02-28", "2028-02-29"],
);
checkDeep(
  "quarterly and half-yearly step three and six months",
  [every("QUARTERLY", "2026-04-15").occurrence(Ordinal(2))?.toISO(), every("HALF_YEARLY", "2026-04-15").occurrence(Ordinal(1))?.toISO()],
  ["2026-10-15", "2026-10-15"],
);
checkDeep("times per year", [every("MONTHLY", "2026-01-01").perYear, every("QUARTERLY", "2026-01-01").perYear, every("HALF_YEARLY", "2026-01-01").perYear, every("ANNUAL", "2026-01-01").perYear], [12, 4, 2, 1]);

section("the next occurrence");
check("before the anchor, the anchor itself", monthEnd.nextOnOrAfter(on("2025-12-01"))?.toISO(), "2026-01-31");
check("on an occurrence, that occurrence", monthEnd.nextOnOrAfter(on("2026-02-28"))?.toISO(), "2026-02-28");
check("the day after a clamped occurrence, the next month's end", monthEnd.nextOnOrAfter(on("2026-03-01"))?.toISO(), "2026-03-31");
check("an annual policy renewing next year", every("ANNUAL", "2025-11-10").nextOnOrAfter(on("2026-10-28"))?.toISO(), "2026-11-10");

section("an end date stops it");
const course = every("MONTHLY", "2026-01-05", "2026-03-31");
check("the last occurrence inside the end date", course.occurrence(Ordinal(2))?.toISO(), "2026-03-05");
check("nothing after the end", course.occurrence(Ordinal(3)), null);
check("no next occurrence once ended", course.nextOnOrAfter(on("2026-03-06")), null);
throws("it cannot end before it starts", () => every("MONTHLY", "2026-05-01", "2026-04-30"), "cannot end");

section("occurrences inside a range");
checkDeep(
  "a monthly subscription across a quarter",
  isoList(monthEnd.occurrencesIn(DateRange.of(on("2026-02-01"), on("2026-04-30")))),
  ["2026-02-28", "2026-03-31", "2026-04-30"],
);
checkDeep("an empty range yields nothing", isoList(every("ANNUAL", "2026-06-01").occurrencesIn(DateRange.of(on("2026-07-01"), on("2027-05-31")))), []);
checkDeep("a range past the end stops at the end", isoList(course.occurrencesIn(DateRange.of(on("2026-03-01"), on("2026-12-31")))), ["2026-03-05"]);

section("the cancel-by date");
check("thirty days' notice before a renewal", every("ANNUAL", "2025-11-10", null, 30).cancelBy(on("2026-11-10"))?.toISO(), "2026-10-11");
check("an unknown notice period is null, not the renewal day", every("ANNUAL", "2025-11-10").cancelBy(on("2026-11-10")), null);
check("zero days' notice is a real answer: the renewal day", every("ANNUAL", "2025-11-10", null, 0).cancelBy(on("2026-11-10"))?.toISO(), "2026-11-10");

section("equality");
check("the same schedule is equal", every("MONTHLY", "2026-01-31").equals(every("MONTHLY", "2026-01-31")), true);
check("a different notice is not", every("ANNUAL", "2026-01-31", null, 30).equals(every("ANNUAL", "2026-01-31", null, 15)), false);

section("price steps — a renewal can change the price");
const ott = new PriceSteps([
  { from: on("2026-03-01"), amount: rupees("199") },
  { from: on("2025-03-01"), amount: rupees("149") },
  { from: on("2027-03-01"), amount: null },
]);
check("steps are ordered, so the earlier price applies first", ott.on(on("2025-06-01"))?.toDecimalString(), "149.00");
check("a step takes effect on its own date", ott.on(on("2026-03-01"))?.toDecimalString(), "199.00");
check("before the first step there is no price", ott.on(on("2025-02-28")), null);
check("an unknown future price is null, never zero", ott.on(on("2027-06-01")), null);
check("the changes still to come", ott.changesAfter(on("2026-10-28")).length, 1);
throws("two prices cannot start the same day", () => new PriceSteps([{ from: on("2026-01-01"), amount: rupees("1") }, { from: on("2026-01-01"), amount: rupees("2") }]), "cannot both start");
const ownedStep: { from: CalendarDate; amount: Money | null } = { from: on("2026-01-01"), amount: rupees("100") };
const guarded = new PriceSteps([ownedStep]);
ownedStep.amount = rupees("999");
check("QA regression: mutating the caller's step afterwards does not rewrite the history", guarded.on(on("2026-06-01"))?.toDecimalString(), "100.00");
throws("a negative price is refused", () => new PriceSteps([{ from: on("2026-01-01"), amount: rupees("-1") }]), "cannot be negative");
check("a zero price is real (a free tier)", new PriceSteps([{ from: on("2026-01-01"), amount: rupees("0") }]).on(on("2026-02-01"))?.toDecimalString(), "0.00");
throws("a history needs a step", () => new PriceSteps([]), "at least one");
throws(
  "a price history cannot change currency",
  () => new PriceSteps([{ from: on("2026-01-01"), amount: rupees("1") }, { from: on("2026-02-01"), amount: Money.fromMinor(100, Currency.of("USD")) }]),
  "currency",
);

section("complete price history survives persistence");
const exactHistory = new PriceSteps([
  { from: on("2028-01-01"), amount: null },
  { from: on("2026-01-01"), amount: Money.fromMinor(9007199254740993n, Currency.of("INR")) },
  { from: on("2027-01-01"), amount: rupees("0") },
]);
const entries = exactHistory.entries();
checkDeep("all steps include the first, zero and unknown future", entries.map((step) => [step.from.toISO(), step.amount?.minor.toString() ?? null]), [
  ["2026-01-01", "9007199254740993"], ["2027-01-01", "0"], ["2028-01-01", null],
]);
check("history array is frozen", Object.isFrozen(entries), true);
check("step records are frozen", entries.every(Object.isFrozen), true);
check("cannot append an unvalidated step", Reflect.set(entries, entries.length, entries[0]), false);
check("cannot replace a validated amount", Reflect.set(entries[0]!, "amount", rupees("1")), false);
const restoredHistory = new PriceSteps(entries);
for (const date of ["2025-12-31", "2026-01-01", "2027-01-01", "2028-01-01"]) {
  check(`reconstructed history agrees on ${date}`, restoredHistory.on(on(date))?.minor.toString() ?? null, exactHistory.on(on(date))?.minor.toString() ?? null);
}

done();
