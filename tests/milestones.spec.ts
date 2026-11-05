import { readFileSync } from "node:fs";
import { Money } from "@/core/money";
import { Count } from "@/core/units";
import { MILESTONES, milestoneStanding } from "@/domain/milestones";
import { check, checkDeep, done, section } from "./harness";

const rupees = (value: string) => Money.fromRupees(value);
const year = (spent: string, months = 12) => ({ months: Count(months), trailingTwelveMonths: rupees(spent) });

section("the milestones are expense multiples, and 33× is the marker");
checkDeep("exactly 10×, 20×, 33×", MILESTONES.map((m) => m.multiple), [10, 20, 33]);
check("33× carries its citation", MILESTONES[2]!.basis?.includes("Saraogi 2022"), true);
const source = readFileSync("src/domain/milestones.ts", "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
check("no 25× anywhere in the code", /\b25\b/.test(source), false);
check("and no income in the code", /income/i.test(source), false);

check("33× carries a PRIMARY citation to SSRN 4216077", MILESTONES[2]!.citation?.kind === "PRIMARY" && JSON.stringify(MILESTONES[2]!.citation).includes("4216077"), true);
check("only the marker is cited", MILESTONES.filter((m) => m.citation !== null).length, 1);
check("never 25× in the ladder", MILESTONES.some((m) => m.multiple === 25), false);
check("no income or salary multiple label", MILESTONES.some((m) => /income|salary/i.test(m.label)), false);

section("standing against them");
const standing = milestoneStanding(rupees("9000000"), year("600000"));
check("90L against 6L a year is 15×", standing.state === "measured" ? standing.multiple : null, 15);
checkDeep("10× reached", standing.state === "measured" ? standing.reached.map((m) => m.multiple) : null, [10]);
checkDeep(
  "next is 20×: a 1.2 Cr target, 30L short",
  standing.state === "measured" ? [standing.next?.target.toDecimalString(), standing.next?.shortBy.toDecimalString()] : null,
  ["12000000.00", "3000000.00"],
);
const independent = milestoneStanding(rupees("20000000"), year("600000"));
check("2 Cr against 6L crosses 33×, and nothing is next", independent.state === "measured" ? [independent.reached.length, independent.next].join(",") : null, "3,");
const exactly = milestoneStanding(rupees("19800000"), year("600000"));
check("exactly 33× counts as reached", exactly.state === "measured" ? exactly.reached.length : null, 3);
const negative = milestoneStanding(rupees("-200000"), year("600000"));
check("negative net worth is measured, not refused; nothing reached", negative.state === "measured" ? negative.reached.length : null, 0);

section("refuses rather than annualise a short window");
const short = milestoneStanding(rupees("9000000"), year("300000", 7));
check("seven months of history: refused, naming the gap", short.state === "refused" ? short.reason : null, "Needs twelve months of expenses; 7 recorded so far.");
check("zero expenses: refused", milestoneStanding(rupees("100"), year("0")).state, "refused");

section("QA repair 2026-11-03: large valid money divides exactly, never through a float");
{
  // Made-up figures past 2^53 minor units: toMinorNumber() would throw on both.
  const huge = milestoneStanding(rupees("900719925474099000.00"), year("10808639105689188.00"));
  check("measured, not a crash", huge.state, "measured");
  check("the multiple is the exact quotient, rounded once", huge.state === "measured" ? huge.multiple : null, 900719925474099000 / 10808639105689188);
  check("negative multiple is kept, not clamped", negative.state === "measured" ? negative.multiple : null, -1 / 3);
  check("no toMinorNumber left in the milestone code", /toMinorNumber/.test(source), false);
}

section("QA regressions (Codex, 2026-10-28): thresholds cannot be altered");
check("the milestone list and every entry are frozen", Object.isFrozen(MILESTONES) && MILESTONES.every(Object.isFrozen), true);
const result = milestoneStanding(rupees("9000000"), year("600000"));
check("a measured result and its reached list are frozen", result.state === "measured" && Object.isFrozen(result) && Object.isFrozen(result.reached), true);

done();
