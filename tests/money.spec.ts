import { Money } from "@/shared/money/Money";
import { Quantity } from "@/shared/numeric/Quantity";
import { Percentage } from "@/shared/numeric/Percentage";
import { CalendarDate } from "@/shared/time/CalendarDate";
import { FinancialYear } from "@/shared/time/FinancialYear";

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
};

// The exact bug v1 had: floats do not sum to zero.
console.log("-- float vs Money --");
console.log(`  float:  0.1 + 0.2 = ${0.1 + 0.2}`);
check("Money 0.10 + 0.20", Money.fromRupees("0.10").plus(Money.fromRupees("0.20")).toDecimalString(), "0.30");

console.log("-- construction & rounding --");
check("fromRupees('1240.50') paise", Money.fromRupees("1240.50").minor, 124050n);
check("fromRupees('1240.505') rounds half-up", Money.fromRupees("1240.505").toDecimalString(), "1240.51");
check("fromRupees('-0.004') -> 0.00", Money.fromRupees("-0.004").toDecimalString(), "0.00");
check("fromRupees(1500) number", Money.fromRupees(1500).toDecimalString(), "1500.00");
check("round-trip", Money.fromRupees(Money.fromRupees("99.99").toDecimalString()).minor, 9999n);

console.log("-- the ARCHITECTURE.md worked example --");
const buy = Money.fromRupees("1500.00").times(10).plus(Money.fromRupees("23.60"));
check("10 x 1500 + 23.60 charges", buy.toDecimalString(), "15023.60");

console.log("-- allocate loses no paisa --");
const split = Money.fromRupees("1.00").allocate([1, 1, 1]);
check("split of 1.00 three ways", split.map((m) => m.toDecimalString()).join(" / "), "0.34 / 0.33 / 0.33");
check("split sums back exactly", Money.total(split).toDecimalString(), "1.00");
const weighted = Money.fromRupees("100.00").allocate([70, 20, 10]);
check("weighted split sums back", Money.total(weighted).toDecimalString(), "100.00");

console.log("-- fractional units x price --");
const units = Quantity.fromString("123.45678901");
check("units round-trip", units.toDecimalString(), "123.45678901");
check("123.45678901 units @ 40.50", units.valueAt(Money.fromRupees("40.50")).toDecimalString(), "5000.00");

console.log("-- statutory charge precision (v1 would zero these) --");
const turnover = Money.fromRupees("1500000.00");
check("SEBI fee 0.0001% of 15,00,000", Percentage.of("0.0001").applyTo(turnover).toDecimalString(), "1.50");
check("exchange 0.00297% of 15,00,000", Percentage.of("0.00297").applyTo(turnover).toDecimalString(), "44.55");
check("GST 18% on 44.55", Percentage.of("18").applyTo(Money.fromRupees("44.55")).toDecimalString(), "8.02");

console.log("-- currency safety --");
try {
  Money.fromRupees("1", (await import("@/shared/money/Currency")).Currency.USD).plus(Money.fromRupees("1"));
  check("mixing currencies throws", "no throw", "throw");
} catch {
  check("mixing currencies throws", "throw", "throw");
}
try {
  Money.fromRupees("10").times(1.5);
  check("times(1.5) rejected", "no throw", "throw");
} catch {
  check("times(1.5) rejected", "throw", "throw");
}

console.log("-- financial year boundaries --");
check("FY of 2026-03-31", FinancialYear.containing(CalendarDate.parse("2026-03-31")).label, "2025-26");
check("FY of 2026-04-01", FinancialYear.containing(CalendarDate.parse("2026-04-01")).label, "2026-27");
check("FY 2025-26 range", FinancialYear.parse("2025-26").range.toString(), "2025-04-01..2026-03-31");
check("holding days 2025-01-15 -> 2026-01-14", CalendarDate.parse("2025-01-15").daysUntil(CalendarDate.parse("2026-01-14")), 364);
check("31 Jan + 1 month clamps", CalendarDate.parse("2026-01-31").plusMonths(1).toISO(), "2026-02-28");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
