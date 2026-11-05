import { assertProperty, check, checkDeep, done, genInt, section } from "./harness";
import { composite, scoreIndicator, type Measurement } from "@/domain/scoring/composite";
import { INDICATORS } from "@/domain/scoring/indicators";
import { Ratio } from "@/core/units";

const byId = (id: string) => INDICATORS.find((i) => i.id === id)!;
// A raw fixture number is branded once here, as the fraction or multiple it stands for.
const measured = (value: number): Measurement => ({ state: "measured", value: Ratio(value) });
const healthy = (): Map<string, Measurement> =>
  new Map<string, Measurement>([
    ["runway-months", measured(6)],
    ["savings-rate", measured(1)],
    ["debt-service-ratio", measured(0.1)],
    ["foir-ceiling", measured(0.3)],
    ["income-stability", measured(1)],
    ["health-cover-present", measured(1)],
    ["term-cover-present", measured(1)],
    ["independence-multiple", measured(33)],
  ]);
const scoreOf = (c: ReturnType<typeof composite>) => (c.state === "scored" ? Number(c.score.toFixed(4)) : null);

section("normalisation is distance to target, capped at 1");
check("3 months against 6 is half", scoreIndicator(byId("runway-months"), measured(3)).state === "scored" && (scoreIndicator(byId("runway-months"), measured(3)) as { score: number }).score, 0.5);
check("12 months is capped at 1", (scoreIndicator(byId("runway-months"), measured(12)) as { score: number }).score, 1);
check("debt service under its 20% ceiling is full marks", (scoreIndicator(byId("debt-service-ratio"), measured(0.1)) as { score: number }).score, 1);
check("40% against a 20% ceiling is half", (scoreIndicator(byId("debt-service-ratio"), measured(0.4)) as { score: number }).score, 0.5);

section("three states, never collapsed");
check("declared absent is a measurement, and scores zero", (scoreIndicator(byId("health-cover-present"), { state: "declared-absent" }) as { score: number }).score, 0);
check("unknown does not score at all", scoreIndicator(byId("health-cover-present"), { state: "unknown", reason: "not entered" }).state, "unknown");

section("the composite refuses, and names what is missing");
const noRetirement = healthy();
noRetirement.delete("independence-multiple");
const refused = composite(noRetirement);
check("one missing indicator refuses the whole composite", refused.state, "refused");
checkDeep("and names the pillar", refused.state === "refused" ? refused.missingPillars : null, ["RETIREMENT"]);
check("the reason counts what is computable", refused.state === "refused" ? refused.reason : null, "5 of 6 pillars computable. Missing: RETIREMENT.");
check("the five known pillars are still reported in full", refused.pillars.filter((p) => p.state === "scored").length, 5);
check("everything measured at target scores 1", scoreOf(composite(healthy())), 1);

section("geometric across pillars: a zero cannot be compensated");
const noCover = healthy();
noCover.set("health-cover-present", { state: "declared-absent" });
noCover.set("term-cover-present", { state: "declared-absent" });
check("no cover at all, everything else perfect: composite 0", scoreOf(composite(noCover)), 0);
const halfCover = healthy();
halfCover.set("term-cover-present", { state: "declared-absent" });
check("half of Protect: 0.5^(1/6)", scoreOf(composite(halfCover)), Number((0.5 ** (1 / 6)).toFixed(4)));
assertProperty(
  "for any other pillars, a zero pillar keeps the composite at zero",
  genInt(1, 600),
  (months) => {
    const m = healthy();
    m.set("runway-months", measured(months / 10));
    m.set("health-cover-present", { state: "declared-absent" });
    m.set("term-cover-present", { state: "declared-absent" });
    return scoreOf(composite(m)) === 0;
  },
);
assertProperty(
  "the composite never exceeds its weakest pillar's share by arithmetic compensation",
  genInt(1, 59),
  (months) => {
    const m = healthy();
    m.set("runway-months", measured(months / 10));
    const c = composite(m);
    const runway = c.pillars.find((p) => p.pillar === "RUNWAY")!;
    // Arithmetic would give (5 + runway) / 6; geometric is strictly below it whenever runway < 1.
    return c.state === "scored" && runway.state === "scored" && c.score < (5 + runway.score) / 6;
  },
);

done();
