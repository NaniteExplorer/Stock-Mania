import { readFileSync } from "node:fs";
import { checkTrue, done, section } from "./harness";

const page = readFileSync("app/(root)/investments/tracker/page.tsx", "utf8");
const nav = readFileSync("app/(root)/investments/investment-nav.tsx", "utf8");

section("read-only tracker contract");
checkTrue("awaits URL search params", page.includes("await searchParams"));
checkTrue("derives current user server-side", page.includes("await currentUserId()"));
checkTrue("calls server-owned tracker", page.includes("investing.tracker.execute"));
checkTrue("has no refresh action", !page.includes("RefreshPricesButton") && !page.includes("refreshPortfolioPrices"));
checkTrue("supports freshness filter", page.includes('name="state"'));
checkTrue("supports family filter", page.includes('name="family"'));

section("truthful market-data evidence");
for (const phrase of ["Last value", "Movement", "Freshness", "Observation", "Ingested", "Source", "Data quality", "calendar date", "not a guaranteed exchange timestamp", "currently entitled source"]) checkTrue(`includes ${phrase}`, page.includes(phrase));
for (const state of ["LIVE", "CURRENT", "DELAYED", "EOD", "NAV_DAILY", "STALE", "MANUAL", "UNAVAILABLE"]) checkTrue(`represents ${state}`, page.includes(state));
checkTrue("table has an accessible caption", page.includes("<caption"));
checkTrue("nav exposes tracker", nav.includes('href: "/investments/tracker"'));
done();
