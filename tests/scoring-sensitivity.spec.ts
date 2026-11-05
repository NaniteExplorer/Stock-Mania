import { Ratio } from "@/core/units";
import type { Measurement } from "@/domain/scoring/composite";
import { sensitivity } from "@/domain/scoring/sensitivity";
import { check, done, section } from "./harness";

const measured = (value: number): Measurement => ({ state: "measured", value: Ratio(value) });
const profile = (runway: number, retirement: number) =>
  new Map<string, Measurement>([
    ["runway-months", measured(runway)],
    ["savings-rate", measured(1)],
    ["debt-service-ratio", measured(0.1)],
    ["foir-ceiling", measured(0.3)],
    ["income-stability", measured(1)],
    ["health-cover-present", measured(1)],
    ["term-cover-present", measured(1)],
    ["independence-multiple", measured(retirement)],
  ]);
const fixed = (n: number | undefined) => (n === undefined ? null : n.toFixed(4));

section("coverage");
check("everything measured: full coverage", sensitivity(profile(6, 33)).coverage, 1);
const partial = profile(6, 33);
partial.delete("independence-multiple");
check("7 of 8 measured", fixed(sensitivity(partial).coverage), (7 / 8).toFixed(4));
check("a refused composite has no range", sensitivity(partial).range, null);
const absent = profile(6, 33);
absent.set("term-cover-present", { state: "declared-absent" });
check("declared absence counts as measured", sensitivity(absent).coverage, 1);

section("the range comes from the stated alternatives");
const atTarget = sensitivity(profile(6, 33)).range;
check("at every benchmark already: no spread", `${fixed(atTarget?.low)}-${fixed(atTarget?.high)}`, "1.0000-1.0000");
const thin = sensitivity(profile(4, 30)).range;
// Runway 4 scores 4/6 at the 6-month benchmark but 1 at 3 months; retirement 30 scores 30/33 or 1 at 25×.
check("a 4-month runway and 30× spread the score", thin !== null && thin.low < thin.high, true);
check("the high end is the 3-month runway alternative, with retirement unchanged", fixed(thin?.high), (((1 + 5) / 6) ** 0 * Math.exp((Math.log(1) * 5 + Math.log(30 / 33)) / 6)).toFixed(4));

done();
