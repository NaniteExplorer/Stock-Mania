import { Currency, Money } from "@/core/money";
import { PriceSteps, Recurrence } from "@/core/recurrence";
import { CalendarDate, DateRange } from "@/core/time";
import { Days } from "@/core/units";
import { IncomeStream, type IncomeReceipt } from "@/domain/income";
import { check, checkDeep, done, section, throws } from "./harness";

const on = (iso: string) => CalendarDate.parse(iso);
const rupees = (value: string) => Money.fromRupees(value);
const salary = new IncomeStream({
  id: "salary",
  name: "Salary",
  kind: "SALARY",
  payer: "Employer Pvt Ltd",
  currency: Currency.of("INR"),
  schedule: new Recurrence({ cadence: "MONTHLY", anchor: on("2026-01-31"), endsOn: null, cancelNotice: null }),
  expected: new PriceSteps([
    { from: on("2026-01-01"), amount: rupees("100000") },
    { from: on("2026-04-01"), amount: rupees("110000") },
  ]),
  grace: Days(5),
});
const paid = (occurrence: string, amount: string, receivedOn = occurrence): IncomeReceipt => ({
  streamId: "salary",
  occurrence: on(occurrence),
  postingId: `p-${occurrence}`,
  receivedOn: on(receivedOn),
  amount: rupees(amount),
});
const quarter = DateRange.of(on("2026-01-01"), on("2026-03-31"));
const states = (list: readonly { state: string; dueOn: CalendarDate }[]) => list.map((o) => `${o.dueOn.toISO()} ${o.state}`);

section("a missed inflow reads as missing, not as zero income");
const febMissed = salary.period(quarter, [paid("2026-01-31", "100000"), paid("2026-03-31", "100000", "2026-04-01")], on("2026-04-02"));
checkDeep(
  "February has no receipt and is past its grace period",
  states(febMissed.occurrences),
  ["2026-01-31 received", "2026-02-28 missing", "2026-03-31 received"],
);
check("one occurrence is missing", febMissed.missing, 1);
check("what arrived is what arrived", febMissed.received.toDecimalString(), "200000.00");
check("and what was expected is still the full quarter", febMissed.expected?.toDecimalString(), "300000.00");
const feb = febMissed.occurrences[1]!;
check("the missing month says how late it is", feb.state === "missing" ? feb.lateBy : null, 28);
check("and carries the amount it should have been", feb.expected?.toDecimalString(), "100000.00");

section("the grace period: late is not yet missing");
const early = salary.occurrencesIn(DateRange.of(on("2026-03-01"), on("2026-03-31")), [], on("2026-04-03"));
check("three days after the due date, inside five days' grace, it is pending", early[0]!.state, "pending");
check("on the last day of grace it is still pending", salary.occurrencesIn(DateRange.of(on("2026-03-01"), on("2026-03-31")), [], on("2026-04-05"))[0]!.state, "pending");
check("the day after, it is missing", salary.occurrencesIn(DateRange.of(on("2026-03-01"), on("2026-03-31")), [], on("2026-04-06"))[0]!.state, "missing");
check("a future occurrence is pending", salary.occurrencesIn(DateRange.of(on("2026-12-01"), on("2026-12-31")), [], on("2026-10-28"))[0]!.state, "pending");

section("a receipt is linked to an occurrence, not matched by amount");
const short = salary.occurrencesIn(DateRange.of(on("2026-01-01"), on("2026-01-31")), [paid("2026-01-31", "99997")], on("2026-02-10"));
check("a salary three rupees short is still that month's salary", short[0]!.state, "received");
const early2 = salary.occurrencesIn(DateRange.of(on("2026-02-01"), on("2026-02-28")), [paid("2026-02-28", "100000", "2026-02-26")], on("2026-02-27"));
check("paid two days early, it is received, not pending", early2[0]!.state, "received");
throws("a receipt for a date the stream is not due on is refused", () => salary.occurrencesIn(quarter, [paid("2026-02-15", "100000")], on("2026-04-01")), "not due on");
throws("two receipts cannot settle one occurrence", () => salary.occurrencesIn(quarter, [paid("2026-01-31", "50000"), { ...paid("2026-01-31", "50000"), postingId: "p-second-half" }], on("2026-04-01")), "Two receipts");
check(
  "another stream's receipts are ignored",
  salary.occurrencesIn(DateRange.of(on("2026-01-01"), on("2026-01-31")), [{ ...paid("2026-01-31", "5"), streamId: "rent" }], on("2026-02-10"))[0]!.state,
  "missing",
);

section("QA regressions (Codex, 2026-10-28)");
const lateArrival = salary.occurrencesIn(DateRange.of(on("2026-01-01"), on("2026-01-31")), [paid("2026-01-31", "100000", "2026-02-10")], on("2026-02-01"));
check("money received on 10 Feb has not arrived as of 1 Feb: pending, not received", lateArrival[0]!.state, "pending");
throws(
  "one posting cannot settle two occurrences",
  () => salary.occurrencesIn(quarter, [paid("2026-01-31", "100000"), { ...paid("2026-02-28", "100000"), postingId: "p-2026-01-31" }], on("2026-04-01")),
  "already settles",
);

throws(
  "a receipt linked to the income-side (negative) posting is refused",
  () => salary.occurrencesIn(quarter, [paid("2026-01-31", "-100000")], on("2026-04-01")),
  "not an inflow",
);

section("expected follows the price steps — a raise changes it");
const q2 = salary.period(DateRange.of(on("2026-04-01"), on("2026-06-30")), [], on("2026-04-01"));
check("after the April raise each month expects 1.1 lakh", q2.expected?.toDecimalString(), "330000.00");
check("nothing received yet is a real zero, and every month is pending, not missing", `${q2.received.toDecimalString()} ${q2.pending} ${q2.missing}`, "0.00 3 0");

section("an unknown expectation makes the total unknown, not partial");
const freelance = new IncomeStream({
  id: "freelance",
  name: "Retainer",
  kind: "FREELANCE",
  payer: null,
  currency: Currency.of("INR"),
  schedule: new Recurrence({ cadence: "MONTHLY", anchor: on("2026-01-10"), endsOn: null, cancelNotice: null }),
  expected: new PriceSteps([{ from: on("2026-01-01"), amount: rupees("20000") }, { from: on("2026-03-01"), amount: null }]),
  grace: Days(0),
});
const mixed = freelance.period(quarter, [], on("2026-04-01"));
check("March's amount is unknown, so the quarter's expected total is null", mixed.expected, null);
check("but the missing count is still exact", mixed.missing, 3);
throws("a stream needs a name", () => new IncomeStream({ ...salaryFields(), name: "  " }), "needs a name");

function salaryFields() {
  return { id: salary.id, name: salary.name, kind: salary.kind, payer: salary.payer, currency: salary.currency, schedule: salary.schedule, expected: salary.expected, grace: salary.grace };
}

section("QA regression (Claude, 2026-10-30): one currency per stream");
throws(
  "INR expected amounts on a USD stream are refused",
  () => new IncomeStream({ ...salary, id: "usd", currency: Currency.USD }),
  "every expected amount must be in that currency too",
);

done();
