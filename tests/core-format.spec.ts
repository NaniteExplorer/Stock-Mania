import { compact, figureParts, percentage, rupee, signed, unknown, type Figure, type FigureValue } from "@/core/format";
import { Currency, Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { check, checkTrue, done, section, throws } from "./harness";

const money = (value: string) => Money.fromRupees(value);

section("board fixtures and Indian presentation");
check("whole rupees use lakh grouping", rupee(money("142560"), 0), "₹1,42,560");
check("negative money uses U+2212", rupee(money("-4350")), "−₹4,350.00");
check("lakh compact fixture truncates", compact(money("4872999.99")), "₹48.72L");
check("crore compact fixture truncates", compact(money("16199999.99")), "₹1.61Cr");
check("paise stay exact", rupee(money("58423.50")), "₹58,423.50");
check("zero has native precision", rupee(Money.zero()), "₹0.00");
check("subrupee debit remains visible", rupee(money("-0.01")), "−₹0.01");
check("hidden negative paise do not create minus zero", rupee(money("-0.99"), 0), "₹0");

section("compact boundaries never round up into a new unit");
for (const [input, expected] of [
  ["999.99", "₹999.99"], ["1000", "₹1.00K"],
  ["1999.99", "₹1.99K"], ["99999.99", "₹99.99K"],
  ["100000", "₹1.00L"], ["9999999.99", "₹99.99L"],
  ["10000000", "₹1.00Cr"], ["-100000", "−₹1.00L"],
  ["-1999.99", "−₹1.99K"], ["-0.01", "−₹0.01"],
  ["0", "₹0.00"],
]) {
  check(`compact ${input}`, compact(money(input)), expected);
}

section("signed figures distinguish a change from zero");
check("positive full value", signed(money("42.50")), "+₹42.50");
check("negative full value", signed(money("-42.50")), "−₹42.50");
check("zero full value", signed(Money.zero()), "₹0.00");
check("positive compact change", signed(money("184999"), { compact: true }), "+₹1.84L");
check("negative compact change", signed(money("-184999"), { compact: true }), "−₹1.84L");
check("zero compact value", signed(Money.zero(), { compact: true }), "₹0.00");
check("positive rounded-to-zero display has no sign", signed(money("0.99"), { fractionDigits: 0 }), "₹0");
check("negative rounded-to-zero display has no sign", signed(money("-0.99"), { fractionDigits: 0 }), "₹0");

section("large magnitudes and currency identity survive formatting");
check("bigint above safe integer retains every paisa", rupee(money("900719925474099312345.67")), "₹90,07,19,92,54,74,09,93,12,345.67");
check("large compact digits remain exact", compact(money("900719925474099312345.67")), "₹9,00,71,99,25,47,409.93Cr");
const dollars = Money.fromMinor(12345678n, Currency.USD);
check("full USD is not relabelled INR", rupee(dollars), "$1,23,456.78");
check("compact USD retains its symbol", compact(dollars), "$1.23L");
check("signed USD retains its symbol", signed(dollars), "+$1,23,456.78");

section("percentage display uses exact scaled integers");
check("percentage means points rather than fraction", percentage(Percentage.of("12.5")), "12.50%");
check("HALF_UP boundary", percentage(Percentage.of("1.005")), "1.01%");
check("negative HALF_UP boundary", percentage(Percentage.of("-1.005")), "−1.01%");
check("tiny negative rounds to unsigned zero", percentage(Percentage.of("-0.000001")), "0.00%");
check("six-place fee remains visible on request", percentage(Percentage.of("0.00297"), 6), "0.002970%");
check("large percentage retains exact digits", percentage(Percentage.of("9007199254740993.125")), "9,00,71,99,25,47,40,993.13%");
check("zero percentage", percentage(Percentage.ZERO), "0.00%");
check("extra display places pad rather than approximate", percentage(Percentage.of("1.25"), 8), "1.25000000%");
throws("fractional money precision is refused", () => rupee(money("1"), 1.5), "integer from 0 to 20");
throws("negative percentage precision is refused", () => percentage(Percentage.ZERO, -1), "integer from 0 to 20");

section("typed figures preserve strings and unknowns preserve reasons");
const unavailable = unknown("No market quote on the requested date");
check("unknown has an explicit discriminant", unavailable.kind, "unknown");
check("unknown retains the specific reason", unavailable.reason, "No market quote on the requested date");
checkTrue("unknown value is immutable", Object.isFrozen(unavailable));
throws("empty reason is refused", () => unknown(""), "specific reason");
throws("blank reason is refused", () => unknown(" \n\t"), "specific reason");
const known: FigureValue = rupee(money("12.34"));
check("branded figure remains a primitive string", typeof known, "string");
check("branded figure remains usable as text", known.toUpperCase(), "₹12.34");

section("figure parts preserve exact display text across formatter outputs");
for (const currency of Currency.all()) {
  for (const value of ["0", "42.50", "-42.50", "1234.56", "100000", "-100000", "10000000", "900719925474099312345.67"]) {
    const amount = Money.fromRupees(value, currency);
    const outputs = [rupee(amount), compact(amount), signed(amount), signed(amount, { compact: true })];
    for (const [index, output] of outputs.entries()) {
      const parts = figureParts(output);
      check(`${currency.code} ${value} formatter ${index} rejoins exactly`, parts.sign + parts.currency + parts.amount + parts.unit, output);
      check(`${currency.code} ${value} formatter ${index} keeps the currency identity`, parts.currency, currency.symbol);
    }
  }
}
for (const value of ["0", "12.5", "-12.5", "-0.000001", "9007199254740993.125"]) {
  const output = percentage(Percentage.of(value));
  const parts = figureParts(output);
  check(`percentage ${value} rejoins exactly`, parts.sign + parts.currency + parts.amount + parts.unit, output);
  check(`percentage ${value} has no currency`, parts.currency, "");
  check(`percentage ${value} retains its unit`, parts.unit, "%");
}
const negativeParts = figureParts(signed(money("-123456.78")));
check("part sign retains the mathematical minus", negativeParts.sign, "−");
check("part amount retains Indian commas and decimal digits", negativeParts.amount, "1,23,456.78");
check("positive explicit sign is its own part", figureParts(signed(money("42"))).sign, "+");
check("zero has no sign part", figureParts(signed(Money.zero())).sign, "");
for (const [value, expected] of [["1000", "K"], ["100000", "L"], ["10000000", "Cr"]]) {
  check(`compact ${expected} is its own part`, figureParts(compact(money(value))).unit, expected);
}

if (false) {
  const results: Figure[] = [rupee(money("1")), compact(money("1")), percentage(Percentage.ZERO), signed(money("1"))];
  const values: FigureValue[] = [...results, unknown("No price")];
  // @ts-expect-error Arbitrary text is not a formatter-produced figure.
  const rawFigure: Figure = "₹12.34";
  // @ts-expect-error A shell figure cannot be arbitrary page text either.
  const rawValue: FigureValue = "Unavailable";
  // @ts-expect-error Figure parts accept formatter output, never arbitrary page text.
  figureParts("₹12.34");
  void [values, rawFigure, rawValue];
}

done();
