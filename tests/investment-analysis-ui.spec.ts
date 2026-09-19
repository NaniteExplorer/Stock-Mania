import { readFileSync } from "node:fs";
import { checkTrue, done, section } from "./harness";

const page = readFileSync("app/(root)/investments/analysis/page.tsx", "utf8");
const chart = readFileSync("app/(root)/investments/analysis/analysis-chart.tsx", "utf8");
const nav = readFileSync("app/(root)/investments/investment-nav.tsx", "utf8");

section("analysis route contract");
checkTrue("awaits URL search params", page.includes("await searchParams"));
checkTrue("derives current user server-side", page.includes("await currentUserId()"));
checkTrue("calls server-owned analysis", page.includes("investing.analysis.execute"));
checkTrue("supports range filter", page.includes('name="range"'));
checkTrue("supports family filter", page.includes('name="family"'));
checkTrue("supports instrument filter", page.includes('name="instrument"'));
checkTrue("does not accept user ID from URL", !page.includes('name="userId"'));

section("professional evidence and accessibility");
for (const phrase of ["Maximum drawdown", "RSI", "Realised volatility", "Technical indicators", "Data provenance", "Data-quality notes", "not constitute investment advice"]) checkTrue(`includes ${phrase}`, page.includes(phrase));
checkTrue("chart uses shared chart primitives", chart.includes("<Chart") && chart.includes("<LineSeries"));
checkTrue("chart provides table view", chart.includes("tableView") && chart.includes("<caption"));
checkTrue("nav exposes analysis", nav.includes('href: "/investments/analysis"'));
done();
