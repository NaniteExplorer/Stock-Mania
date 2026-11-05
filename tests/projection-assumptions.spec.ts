/** Task 5.0 acceptance: every default carries its basis; vendor inputs flagged; unknowns stay unknown. */
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Count, Ratio, Years } from "@/core/units";
import { AssumptionSet } from "@/domain/projection/assumptions";
import { check, checkDeep, done, section, throws } from "./harness";

const on = CalendarDate.parse;
const initial = AssumptionSet.initial();

section("no invented empirical default");
checkDeep(
  "inflation, ages, contribution and equity share start unknown",
  (["currentAge", "retirementAge", "horizonAge", "inflation", "monthlyContribution", "equityShare"] as const).map((k) => initial.get(k).value),
  [null, null, null, null, null, null],
);
check("every filled default carries a source", initial.all().every((a) => a.value === null || a.source !== null), true);
check("3.0% withdrawal rate, cited to Saraogi 2022", initial.get("withdrawalRate").source?.kind === "CITED" && initial.get("withdrawalRate").value === 0.03, true);
check("block length 4 years, within 3–5", initial.get("blockYears").value, 4);

section("the refusal gate's input");
const blockers = initial.blockers({ holdsNps: false });
check("six unknowns block, each named", blockers.length, 6);
check("named by label", blockers.includes("Inflation is not set."), true);
check("NPS shares are not required without NPS", blockers.some((b) => b.startsWith("NPS")), false);
const withNps = initial.blockers({ holdsNps: true });
check("with NPS, both regulatory shares block until verified", withNps.filter((b) => b.includes("not been verified")).length, 2);
const verified = initial
  .with("npsAnnuityShareNonGovt", Ratio(0.2), initial.get("npsAnnuityShareNonGovt").source!, on("2026-10-30"))
  .with("npsAnnuityShareGovt", Ratio(0.4), initial.get("npsAnnuityShareGovt").source!, on("2026-10-30"));
check("a recorded verification clears them", verified.blockers({ holdsNps: true }).some((b) => b.includes("verified")), false);
check("an edit without a date is not a verification", verified.with("npsAnnuityShareGovt", Ratio(0.4)).get("npsAnnuityShareGovt").verifiedOn, null);
const complete = initial
  .with("currentAge", Years(35))
  .with("retirementAge", Years(55))
  .with("horizonAge", Years(90))
  .with("inflation", Ratio(0.06))
  .with("monthlyContribution", Money.fromRupees("50000"))
  .with("equityShare", Ratio(0.7));
checkDeep("a complete set without NPS has no blockers", complete.blockers({ holdsNps: false }), []);

section("edits are new sets and are validated");
check("with() leaves the original untouched", initial.get("inflation").value, null);
check("an owner edit is sourced OWNER", complete.get("inflation").source?.kind, "OWNER");
check("setting back to null drops the source too", complete.with("inflation", null).get("inflation").source, null);
throws("block length outside 3–5", () => initial.with("blockYears", Count(2)), "between 3 and 5");
throws("zero withdrawal rate", () => initial.with("withdrawalRate", Ratio(0)), "above 0");
throws("equity share above 100%", () => initial.with("equityShare", Ratio(1.2)), "between 0 and 1");
throws("negative contribution", () => initial.with("monthlyContribution", Money.fromRupees("-1")), "cannot be negative");
throws("retirement before today's age", () => complete.with("retirementAge", Years(30)), "below the current age");
throws("horizon not past retirement", () => complete.with("horizonAge", Years(55)), "past the retirement age");

section("vendor values are flagged");
const vendor = complete.with("inflation", Ratio(0.055), { kind: "VENDOR", vendor: "Example Research", asOf: on("2026-10-01") });
checkDeep("the vendor key is listed", vendor.vendorFlagged(), ["inflation"]);
throws("an unnamed vendor is refused", () => complete.with("inflation", Ratio(0.05), { kind: "VENDOR", vendor: " ", asOf: on("2026-10-01") }), "name the vendor");

section("frozen all the way down");
check("the set is frozen", Object.isFrozen(initial), true);
check("every assumption is frozen", initial.all().every(Object.isFrozen), true);
check("every source and citation is frozen", initial.all().every((a) => a.source === null || (Object.isFrozen(a.source) && (a.source.kind !== "CITED" || Object.isFrozen(a.source.citation)))), true);
check("Reflect.set cannot rewrite the withdrawal rate", Reflect.set(initial.get("withdrawalRate"), "value", 0.04), false);
const callerSource = { kind: "OWNER" as const };
const copied = initial.with("inflation", Ratio(0.06), callerSource);
check("the stored source is a frozen copy, not the caller's object", copied.get("inflation").source !== callerSource && Object.isFrozen(copied.get("inflation").source), true);

done();
