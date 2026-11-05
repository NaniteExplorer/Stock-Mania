import { Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { Months } from "@/core/units";
import { AgeSchedule, DecliningBalance, MOTOR_IDV_SCHEDULE, StraightLine, type Purchase } from "@/domain/depreciation";
import { check, checkDeep, done, section, throws } from "./harness";

const on = (iso: string) => CalendarDate.parse(iso);
const rupees = (value: string) => Money.fromRupees(value);
const car: Purchase = { on: on("2023-08-24"), price: rupees("1200000") };
const laptop: Purchase = { on: on("2025-01-10"), price: rupees("150000") };

section("declining balance — a share of what is left");
const fifteen = new DecliningBalance(Percentage.of(15), "Owner's assumption");
check("two full years: 12L × 0.85 × 0.85", fifteen.valueOn(car, on("2025-08-24")).value.toDecimalString(), "867000.00");
check("a day short of the second anniversary is still one year", fifteen.valueOn(car, on("2025-08-23")).value.toDecimalString(), "1020000.00");
check("before purchase it is the price", fifteen.valueOn(car, on("2023-01-01")).value.toDecimalString(), "1200000.00");
throws("100% is not a declining balance", () => new DecliningBalance(Percentage.of(100), "x"), "up to, not including");

section("straight line — a share of the price, down to a floor");
const threeYears = new StraightLine(Percentage.of("33.33"), Percentage.of(5), "Owner's assumption: a laptop lasts three years");
check("one year: 1.5L less a third", threeYears.valueOn(laptop, on("2026-01-10")).value.toDecimalString(), "100005.00");
check("never below its 5% floor", threeYears.valueOn(laptop, on("2030-01-10")).value.toDecimalString(), "7500.00");
throws("a zero rate is not a model", () => new StraightLine(Percentage.ZERO, Percentage.ZERO, "x"), "above zero");

section("the motor IDV schedule — banded by age, cited, and not a resale price");
checkDeep(
  "5%, 15%, 20%, 30%, 40%, 50% off as the car ages",
  ["2023-12-01", "2024-06-01", "2025-06-01", "2026-06-01", "2027-06-01", "2028-06-01"].map((d) => MOTOR_IDV_SCHEDULE.valueOn(car, on(d)).value.toDecimalString()),
  ["1140000.00", "1020000.00", "960000.00", "840000.00", "720000.00", "600000.00"],
);
check("the basis names the tariff and says it is not a resale price", /Motor Tariff/.test(MOTOR_IDV_SCHEDULE.basis) && /not a resale price/.test(MOTOR_IDV_SCHEDULE.basis), true);
throws("bands must rise", () => new AgeSchedule("x", [{ underMonths: Months(12), off: Percentage.of(10) }, { underMonths: Months(6), off: Percentage.of(5) }], "x"), "must rise");

section("a modelled value is always labelled");
const labelled = fifteen.valueOn(car, on("2026-10-28"));
checkDeep(
  "it carries the model, its terms and its basis — never a bare figure",
  [labelled.model, labelled.terms, labelled.basis],
  ["Declining balance", "15.00% of the remaining value each full year", "Owner's assumption"],
);

section("age schedules retain an immutable validated snapshot");
const suppliedBand = { underMonths: Months(12), off: Percentage.of(10) };
const suppliedBands = [suppliedBand];
const snapshot = new AgeSchedule("Owner schedule", suppliedBands, "Owner assumption");
const originalTerms = snapshot.terms;
suppliedBand.off = Percentage.of(90);
suppliedBand.underMonths = Months(1);
suppliedBands.push({ underMonths: Months(24), off: Percentage.of(99) });
check("caller mutation cannot change modelled value", snapshot.valueOn(laptop, on("2025-07-10")).value.toDecimalString(), "135000.00");
check("caller mutation cannot change terms", snapshot.terms, originalTerms);
check("the stored band count is a snapshot", snapshot.bands.length, 1);
check("the exposed array is frozen", Object.isFrozen(snapshot.bands), true);
check("the exposed band is frozen", Object.isFrozen(snapshot.bands[0]), true);
for (const discount of [-10, 150]) {
  throws(`discount ${discount} is refused`, () => new AgeSchedule("Invalid", [{ underMonths: Months(12), off: Percentage.of(discount) }], "Owner assumption"), "0% to 100%");
}
for (const [discount, expected] of [[0, "150000.00"], [100, "0.00"]] as const) {
  const boundary = new AgeSchedule("Boundary", [{ underMonths: Months(12), off: Percentage.of(discount) }], "Owner assumption");
  check(`discount ${discount} remains valid`, boundary.valueOn(laptop, on("2025-07-10")).value.toDecimalString(), expected);
}

done();
