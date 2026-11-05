import { Currency, Money } from "@/core/money";
import { PriceSteps, Recurrence, type Cadence } from "@/core/recurrence";
import { CalendarDate, DateRange } from "@/core/time";
import { Days } from "@/core/units";
import { Commitment, committedOutgo, upcomingCharges, type CommitmentFields } from "@/domain/commitments";
import { check, checkDeep, done, section, throws } from "./harness";

const on = (iso: string) => CalendarDate.parse(iso);
const rupees = (value: string) => Money.fromRupees(value);
const INR = Currency.of("INR");
const make = (id: string, cadence: Cadence, anchor: string, price: string, overrides: Partial<CommitmentFields> = {}) =>
  new Commitment({
    id,
    name: id,
    kind: "OTHER",
    currency: INR,
    schedule: new Recurrence({ cadence, anchor: on(anchor), endsOn: null, cancelNotice: null }),
    price: new PriceSteps([{ from: on(anchor), amount: rupees(price) }]),
    autoRenews: true,
    endsOn: null,
    ...overrides,
  });

const ott = make("ott", "MONTHLY", "2025-06-03", "649", {
  price: new PriceSteps([
    { from: on("2025-06-03"), amount: rupees("649") },
    { from: on("2026-11-03"), amount: rupees("699") },
  ]),
  schedule: new Recurrence({ cadence: "MONTHLY", anchor: on("2025-06-03"), endsOn: null, cancelNotice: Days(1) }),
});
const music = make("music", "ANNUAL", "2026-02-14", "1499");
const broadband = make("broadband", "QUARTERLY", "2026-01-10", "2097", { autoRenews: false });
const today = on("2026-10-28");

section("total committed outgo, per month and per year");
const outgo = committedOutgo([ott, music, broadband], today, INR);
check("per year is exact: 649×12 + 1499 + 2097×4", outgo.perYear?.toDecimalString(), "17675.00");
check("per month is derived from the year, not summed from rounded months", outgo.perMonth?.toDecimalString(), "1472.92");
check("an annual plan is not inflated by monthly rounding", committedOutgo([music], today, INR).perYear?.toDecimalString(), "1499.00");
check("what is quietly auto-renewing, per month", outgo.autoRenewingPerMonth?.toDecimalString(), "773.92");
check("active count", outgo.active, 3);

section("a cancelled commitment leaves the total on its end date, not immediately");
const cancelled = make("course", "MONTHLY", "2026-01-15", "3000", { endsOn: on("2026-11-14"), autoRenews: false });
check("cancelled but paid up to 14 Nov: still in the total today", committedOutgo([cancelled], today, INR).perMonth?.toDecimalString(), "3000.00");
check("on its last day, still in", committedOutgo([cancelled], on("2026-11-14"), INR).active, 1);
check("the day after, out", committedOutgo([cancelled], on("2026-11-15"), INR).perMonth?.toDecimalString(), "0.00");
check("and it has no next charge after its end", cancelled.nextCharge(on("2026-11-15")), null);
check("a not-yet-started commitment is not in today's total", committedOutgo([make("later", "MONTHLY", "2027-01-01", "99")], today, INR).active, 0);

section("an unknown price makes the total unknown, never partial");
const unpriced = make("gym", "MONTHLY", "2026-01-01", "0", { price: new PriceSteps([{ from: on("2026-01-01"), amount: null }]) });
const withUnknown = committedOutgo([ott, unpriced], today, INR);
checkDeep("per month, per year: both null", [withUnknown.perMonth, withUnknown.perYear], [null, null]);
check("but the count of commitments is still known", withUnknown.active, 2);

section("price change at renewal");
const next = ott.nextCharge(today);
checkDeep(
  "the November charge rises from 649 to 699, cancel by the day before",
  [next?.dueOn.toISO(), next?.priceChange?.from.toDecimalString(), next?.priceChange?.to.toDecimalString(), next?.cancelBy?.toISO()],
  ["2026-11-03", "649.00", "699.00", "2026-11-02"],
);
check("an unchanged renewal carries no price change", music.nextCharge(today)?.priceChange, null);
check("unknown notice: no cancel-by date", music.nextCharge(today)?.cancelBy, null);

section("charges actually falling in a period");
check("Q4 2026 for the streaming plan, at each charge's own price", ott.chargedIn(DateRange.of(on("2026-10-01"), on("2026-12-31")))?.toDecimalString(), "2047.00");
check("a cancelled course (due on the 15th, ends 14 Nov) charges only 15 Oct in Q4", cancelled.chargedIn(DateRange.of(on("2026-10-01"), on("2026-12-31")))?.toDecimalString(), "3000.00");

section("the renewal calendar");
checkDeep(
  "charges in the next 30 days, soonest first, with the auto-renew flag",
  upcomingCharges([music, ott, broadband], today, on("2026-11-27")).map((c) => `${c.commitmentId} ${c.dueOn.toISO()} ${c.autoRenews}`),
  ["ott 2026-11-03 true"],
);

section("invariants");
throws("a name is required", () => make(" ", "MONTHLY", "2026-01-01", "1"), "needs a name");
throws("it cannot end before it starts", () => make("x", "MONTHLY", "2026-05-01", "1", { endsOn: on("2026-04-01") }), "end before");

section("QA regression (Claude, 2026-10-30): one currency per commitment");
throws("an INR price on a USD commitment is refused", () => make("usd", "MONTHLY", "2026-01-01", "100", { currency: Currency.USD }), "every price must be in that currency too");

done();
