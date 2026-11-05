/** Task 5.6 acceptance: a full NPS corpus is never treated as spendable. */
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Ratio } from "@/core/units";
import { AssumptionSet } from "@/domain/projection/assumptions";
import { npsAtExit } from "@/domain/projection/nps";
import { check, done, section, throws } from "./harness";

const initial = AssumptionSet.initial();
const verifiedOn = CalendarDate.parse("2026-10-30");
const verified = initial
  .with("npsAnnuityShareNonGovt", Ratio(0.2), initial.get("npsAnnuityShareNonGovt").source!, verifiedOn)
  .with("npsAnnuityShareGovt", Ratio(0.4), initial.get("npsAnnuityShareGovt").source!, verifiedOn);
const corpus = Money.fromRupees("5000000");

section("the annuity share is never spendable");
const nonGovt = npsAtExit(corpus, "NON_GOVERNMENT", verified);
check("non-government: 20% annuitised", nonGovt.annuitised.toDecimalString(), "1000000.00");
check("80% spendable", nonGovt.spendable.toDecimalString(), "4000000.00");
const govt = npsAtExit(corpus, "GOVERNMENT", verified);
check("government: 40% annuitised", govt.annuitised.toDecimalString(), "2000000.00");
check("spendable is always less than the corpus", govt.spendable.isLessThan(corpus), true);

section("rounding never overstates what may be spent");
const odd = npsAtExit(Money.fromMinor(1n), "NON_GOVERNMENT", verified);
check("one paisa: the annuity rounds up to it", odd.annuitised.toDecimalString(), "0.01");
check("and nothing is spendable", odd.spendable.toDecimalString(), "0.00");
const awkward = npsAtExit(Money.fromMinor(123457n), "GOVERNMENT", verified);
check("parts always sum to the corpus", awkward.annuitised.plus(awkward.spendable).toDecimalString(), "1234.57");

section("unverified or unknown shares refuse");
throws("the shipped share is unverified", () => npsAtExit(corpus, "NON_GOVERNMENT", initial), "not been verified");
throws("an owner edit without a verification date refuses too", () => npsAtExit(corpus, "GOVERNMENT", verified.with("npsAnnuityShareGovt", Ratio(0.4))), "not been verified");
throws("a cleared share refuses", () => npsAtExit(corpus, "GOVERNMENT", verified.with("npsAnnuityShareGovt", null)), "not set");
throws("a negative corpus refuses", () => npsAtExit(Money.fromRupees("-1"), "GOVERNMENT", verified), "cannot be negative");
check("the result is frozen", Object.isFrozen(nonGovt), true);

section("QA repair 2026-11-04: the stated share is honoured exactly");
const precise = verified.with("npsAnnuityShareNonGovt", Ratio(0.2000004), initial.get("npsAnnuityShareNonGovt").source!, verifiedOn);
const billion = npsAtExit(Money.fromRupees("1000000000"), "NON_GOVERNMENT", precise);
check("a seven-decimal share annuitises its full stated amount", billion.annuitised.toDecimalString(), "200000400.00");
check("spendable is not overstated by the quantised 400.00", billion.spendable.toDecimalString(), "799999600.00");
const tinyShare = verified.with("npsAnnuityShareNonGovt", Ratio(1e-7), initial.get("npsAnnuityShareNonGovt").source!, verifiedOn);
check("an exponent-form share is exact", npsAtExit(Money.fromRupees("10000000000"), "NON_GOVERNMENT", tinyShare).annuitised.toDecimalString(), "1000.00");
check("and rounds up to the paisa", npsAtExit(Money.fromMinor(1n), "NON_GOVERNMENT", tinyShare).annuitised.toDecimalString(), "0.01");

done();
