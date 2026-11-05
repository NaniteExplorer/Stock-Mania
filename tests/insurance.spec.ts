import { readFileSync } from "node:fs";
import { Currency, Money } from "@/core/money";
import { PriceSteps, Recurrence } from "@/core/recurrence";
import { CalendarDate } from "@/core/time";
import { Days, Ratio, Years } from "@/core/units";
import { annualPremiumOutgo, coverErosion, InsurancePolicy, presenceOf, renewalsBetween, type InsurancePolicyFields } from "@/domain/insurance";
import { check, checkDeep, done, section, throws } from "./harness";

const on = (iso: string) => CalendarDate.parse(iso);
const rupees = (value: string) => Money.fromRupees(value);
const INR = Currency.of("INR");
const fields = (overrides: Partial<InsurancePolicyFields> = {}): InsurancePolicyFields => ({
  id: "health",
  kind: "HEALTH",
  insurer: "Example General",
  insured: "Self + spouse",
  sumInsured: rupees("500000"),
  currency: INR,
  premiumSchedule: new Recurrence({ cadence: "ANNUAL", anchor: on("2025-11-10"), endsOn: null, cancelNotice: Days(15) }),
  premium: new PriceSteps([{ from: on("2025-11-10"), amount: rupees("18500") }, { from: on("2026-11-10"), amount: rupees("21200") }]),
  endsOn: null,
  ...overrides,
});
const health = new InsurancePolicy(fields());
const term = new InsurancePolicy(
  fields({
    id: "term",
    kind: "TERM_LIFE",
    sumInsured: rupees("10000000"),
    premiumSchedule: new Recurrence({ cadence: "MONTHLY", anchor: on("2024-03-05"), endsOn: on("2054-03-04"), cancelNotice: null }),
    premium: new PriceSteps([{ from: on("2024-03-05"), amount: rupees("1450") }]),
    endsOn: on("2054-03-04"),
  }),
);
const today = on("2026-10-28");

section("presence has three states, and an empty list is not absence");
check("a policy in force: covered", presenceOf("HEALTH", [health], [], today).state, "covered");
check("no policy and no declaration: unknown, never absent", presenceOf("HEALTH", [], [], today).state, "unknown");
check("the owner said they have none: declared absent", presenceOf("HEALTH", [], [{ kind: "HEALTH", declaredOn: on("2026-06-01") }], today).state, "declared-absent");
check("a policy bought after the declaration overrules it", presenceOf("HEALTH", [health], [{ kind: "HEALTH", declaredOn: on("2025-01-01") }], today).state, "covered");
check("a declaration dated after asOf is not yet made", presenceOf("HEALTH", [], [{ kind: "HEALTH", declaredOn: on("2026-12-01") }], today).state, "unknown");
check("a term policy says nothing about health", presenceOf("HEALTH", [term], [], today).state, "unknown");
const lapsed = new InsurancePolicy(fields({ id: "old", endsOn: on("2026-03-31") }));
check("a policy that ended is not cover", presenceOf("HEALTH", [lapsed], [], today).state, "unknown");

section("presence only — no rupee threshold decides cover");
const tiny = new InsurancePolicy(fields({ id: "tiny", sumInsured: rupees("1") }));
check("a one-rupee sum insured is still cover; adequacy is not judged", presenceOf("HEALTH", [tiny], [], today).state, "covered");
const unentered = new InsurancePolicy(fields({ id: "blank", sumInsured: null }));
check("and so is a policy whose sum insured was never entered", presenceOf("HEALTH", [unentered], [], today).state, "covered");
const source = readFileSync("src/domain/insurance.ts", "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
check("the module's code holds no rupee constant", /Money\.from(Rupees|Minor)\(/.test(source), false);

section("premium outgo — annualised, and unknown stays unknown");
check("an annual premium is itself", health.annualPremium(today)?.toDecimalString(), "18500.00");
check("a monthly premium times twelve", term.annualPremium(today)?.toDecimalString(), "17400.00");
check("total outgo across policies in force", annualPremiumOutgo([health, term, lapsed], today, INR)?.toDecimalString(), "35900.00");
check("after the renewal price rise", annualPremiumOutgo([health, term], on("2026-11-10"), INR)?.toDecimalString(), "38600.00");
const unpriced = new InsurancePolicy(fields({ id: "unpriced", premium: new PriceSteps([{ from: on("2025-11-10"), amount: null }]) }));
check("one unknown premium makes the total unknown, not partial", annualPremiumOutgo([health, unpriced], today, INR), null);

section("renewal dates");
const next = health.nextRenewal(today);
checkDeep(
  "the next health renewal, its new price, and the last day to cancel",
  [next?.dueOn.toISO(), next?.premium?.toDecimalString(), next?.cancelBy?.toISO()],
  ["2026-11-10", "21200.00", "2026-10-26"],
);
check("unknown notice means no cancel-by date, not the renewal day", term.nextRenewal(today)?.cancelBy, null);
check("an ended policy has no renewal", lapsed.nextRenewal(today), null);
checkDeep(
  "renewals in the next thirty days, soonest first",
  renewalsBetween([health, term, lapsed], today, on("2026-11-27")).map((r) => `${r.policyId} ${r.dueOn.toISO()}`),
  ["term 2026-11-05", "health 2026-11-10"],
);

section("cover erosion is information, and must cite its source");
const eroded = coverErosion(rupees("500000"), Years(5), Ratio(0.12), "Named consultancy medical-trend survey, 2026");
check("five lakh after five years at 12% (exact: 283713.4279, to the paisa)", eroded.realValue.toDecimalString(), "283713.43");
check("the source travels with the figure", eroded.source.length > 0, true);
throws("no source, no figure", () => coverErosion(rupees("500000"), Years(5), Ratio(0.12), " "), "cite its source");

section("invariants");
throws("an insurer is required", () => new InsurancePolicy(fields({ insurer: "" })), "insurer");
throws("a zero sum insured is not a sum insured", () => new InsurancePolicy(fields({ sumInsured: rupees("0") })), "more than zero");
throws("a policy cannot end before it starts", () => new InsurancePolicy(fields({ endsOn: on("2025-01-01") })), "end before");

section("QA regression (Claude, 2026-10-30): one currency per policy");
throws("an INR premium on a USD policy is refused", () => new InsurancePolicy(fields({ currency: Currency.USD, sumInsured: null })), "every premium must be in that currency too");
throws("a sum insured in another currency is refused", () => new InsurancePolicy(fields({ sumInsured: Money.fromMinor(100n, Currency.USD) })), "sum insured must be in that currency too");

done();
