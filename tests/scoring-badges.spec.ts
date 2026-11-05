import { readFileSync } from "node:fs";
import { Money } from "@/core/money";
import { Months } from "@/core/units";
import { BADGES, badgesHeld, NEVER_REWARDED, type StateSnapshot } from "@/domain/scoring/badges";
import { check, checkDeep, done, section } from "./harness";

const none: StateSnapshot = { runway: Months(2), healthCover: "unknown", termCover: "unknown", loansClosed: [], revolvingCardDebt: null };
const ids = (s: StateSnapshot) => badgesHeld(s).map((b) => b.id);

section("badges mark states reached");
checkDeep("nothing reached, nothing held", ids(none), []);
checkDeep(
  "six months runway, cover in force, a loan closed, cards paid",
  ids({ runway: Months(6.2), healthCover: "covered", termCover: "covered", loansClosed: [{ id: "car", name: "Car loan" }], revolvingCardDebt: Money.fromRupees("0") }),
  ["runway-six", "health-covered", "loan-closed", "no-revolving-card"],
);
check("5.9 months is not six", ids({ ...none, runway: Months(5.9) }).length, 0);
check("unknown card debt earns nothing — unknown is not zero", ids({ ...none, revolvingCardDebt: null }).includes("no-revolving-card"), false);
check("a badge no longer met just stops being listed", ids({ ...none, runway: Months(3) }).includes("runway-six"), false);

section("nothing rewards activity, by construction");
const snapshotType = readFileSync("src/domain/scoring/badges.ts", "utf8").match(/interface StateSnapshot \{[\s\S]*?\n\}/)![0];
check("the snapshot has no count of transactions, trades, logins or streaks", /count|transactions|trades|logins|streak/i.test(snapshotType.replace(/\/\*\*[\s\S]*?\*\//g, "")), false);
check("no badge mentions trading, gains or beating an index", BADGES.some((b) => /trade|gain|beat|nifty|streak|rank/i.test(`${b.title} ${b.meaning}`)), false);
check("the refusal list is part of the contract", NEVER_REWARDED.length, 5);
check("the health badge says it marks presence, not adequacy", BADGES.find((b) => b.id === "health-covered")!.meaning.includes("not whether the amount is enough"), true);

done();
