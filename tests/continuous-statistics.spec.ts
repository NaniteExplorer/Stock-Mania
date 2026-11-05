import { Count, Days, IndexPoints, Months, PriceLevel, Ratio, Years } from "@/core/units";
import { stdDev, type Continuous } from "@/domain/portfolio";
import { check, done } from "./harness";

const factories: readonly ((value: number) => Continuous)[] = [Ratio, PriceLevel, IndexPoints, Months, Years];
for (const factory of factories) {
  check("sample dispersion retains its continuous unit", stdDev([1, 2, 3, 4].map(factory), factory).toFixed(6), "1.290994");
  check("empty samples retain zero behavior", stdDev([], factory), 0);
  check("singleton samples retain zero behavior", stdDev([factory(5)], factory), 0);
}
let constructed = 0;
const validatedRatio = (value: number) => { constructed += 1; return Ratio(value); };
check("fractional dispersion is constructed", stdDev([Ratio(0), Ratio(1)], validatedRatio).toFixed(6), "0.707107");
check("both mean and dispersion use the supplied constructor", constructed, 2);
if (false) {
  // @ts-expect-error Integer counts cannot carry fractional dispersion.
  stdDev([Count(1), Count(2)], Count);
  // @ts-expect-error Whole-day quantities require an explicit continuous conversion.
  stdDev([Days(1), Days(2)], Days);
  // @ts-expect-error A price constructor cannot relabel return ratios.
  stdDev([Ratio(1), Ratio(2)], PriceLevel);
  // @ts-expect-error Bare numeric inputs do not state a unit.
  stdDev([1, 2], Ratio);
}
done();
