/**
 * D.2 follow-up: the live sidebar matches DESIGN.md §9c, and `/liabilities` is retired
 * with a permanent redirect to `/loans`.
 *
 *   1. "Debt" holds exactly Cards and Loans. Payoff is a tab of `/loans`, not an item.
 *   2. Deposits and Assets sit under "Savings & assets". Platforms sits under Investments.
 *   3. The regroup dropped nothing except the retired `/liabilities`.
 *   4. Every href is a real route, and none is listed twice.
 *   5. `/liabilities` answers with a permanent redirect to `/loans`, in `next.config.ts`
 *      and, as a fallback, in the route itself.
 */

import { existsSync, readFileSync } from "node:fs";
import { NAV_GROUPS, NAV_ITEMS } from "@/ui/nav";
import nextConfig from "../next.config";
import LiabilitiesPage from "../app/(root)/liabilities/page";
import { Currency, Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { blendedLoanRate, debtHeaderFigures } from "@/ui/debt-header";
import { check, checkDeep, checkTrue, done, section } from "./harness";

const group = (label: string) => NAV_GROUPS.find((candidate) => candidate.label === label);
const hrefs = (label: string) => group(label)?.items.map((item) => item.href) ?? [];

section("§9c placement");

checkDeep("Debt holds exactly Cards and Loans, in that order", hrefs("Debt"), ["/cards", "/loans"]);
checkDeep("Savings & assets holds Deposits and Assets", hrefs("Savings & assets"), ["/deposits", "/assets"]);
checkTrue("Platforms sits under Investments", hrefs("Investments").includes("/platforms"));
checkTrue("Payoff is a tab of /loans, not a sidebar item", !NAV_ITEMS.some((item) => item.href.startsWith("/loans/")));
check(
  "Cards and Loans appear in no other group",
  NAV_GROUPS.filter((g) => g.label !== "Debt").flatMap((g) => g.items).filter((item) => item.href === "/cards" || item.href === "/loans").length,
  0,
);
checkTrue("Deposits and Assets are not under Debt", !hrefs("Debt").some((href) => href === "/deposits" || href === "/assets"));

section("nothing dropped by the regroup");

// The nav before this change, less the one retired route.
const BEFORE = [
  "/dashboard", "/history", "/activity",
  "/accounts", "/transactions", "/budgets", "/imports", "/investments", "/platforms",
  "/investments/history", "/assets", "/deposits", "/income", "/insurance", "/commitments",
  "/projection", "/standing", "/signals", "/cards", "/loans",
  "/settings",
];
// Added after the regroup, each with its reason: /settings/cpi is the owner CPI Urban entry screen.
const ADDED = ["/settings/cpi", "/settings/allocation"]; // allocation: owner request 2026-11-05 (target + band entry)
const now = NAV_ITEMS.map((item) => item.href);
check("every earlier destination is still in the nav", BEFORE.filter((href) => !now.includes(href)).join(", "), "");
check("no destination is new or unexplained", now.filter((href) => !BEFORE.includes(href) && !ADDED.includes(href)).join(", "), "");
checkTrue("/liabilities is retired from the nav", !now.includes("/liabilities"));
check("no href is listed twice", now.length, new Set(now).size);

section("every href is a real route");

const routeFile = (href: string) => `app/(root)${href}/page.tsx`;
check("each href has an app/(root)/<href>/page.tsx", now.filter((href) => !existsSync(routeFile(href))).join(", "), "");

section("/liabilities permanently redirects to /loans");

{
  const rules = (await nextConfig.redirects?.()) ?? [];
  const rule = rules.find((candidate) => candidate.source === "/liabilities");
  check("next.config.ts redirects /liabilities to /loans", rule?.destination, "/loans");
  // The local Next docs (next-config-js/redirects.md): `permanent: true` is the 308
  // permanent form, and `statusCode` cannot be combined with it.
  check("the redirect is permanent (308)", rule && "permanent" in rule ? rule.permanent : undefined, true);
  checkTrue("no custom statusCode overrides it", !(rule && "statusCode" in rule));
}

{
  // Rendering the page throws Next's redirect signal; its digest names type, target and status.
  let digest: string | undefined;
  try {
    LiabilitiesPage();
  } catch (error) {
    digest = (error as { digest?: string }).digest;
  }
  check("the route itself falls back to a 308 to /loans", digest, "NEXT_REDIRECT;replace;/loans;308;");
  const page = readFileSync("app/(root)/liabilities/page.tsx", "utf8");
  checkTrue("the empty placeholder screen is gone", !page.includes("<PageHeader") && !page.includes("No liabilities yet"));
}

section("§9c Debt group header: Total outstanding (Batch 5)");

{
  const inr = (minor: bigint) => Money.fromMinor(minor, Currency.of("INR"));
  check(
    "cards + loans are summed exactly, paise kept",
    debtHeaderFigures([inr(1234567n)], [inr(25000001n), inr(99n)])?.totalOutstanding,
    "₹2,62,346.67",
  );
  check("an unavailable card total hides the figure (never ₹0)", debtHeaderFigures(null, [inr(100n)]), null);
  check("an unavailable loan total hides the figure", debtHeaderFigures([inr(100n)], null), null);
  check("no cards and no loans shows nothing", debtHeaderFigures([], []), null);
  check("mixed currencies are not summed", debtHeaderFigures([inr(100n)], [Money.fromMinor(100n, Currency.of("USD"))]), null);

  const sidebar = readFileSync("components/Sidebar.tsx", "utf8");
  checkTrue("the Sidebar renders the figure only under the Debt label", sidebar.includes('group.label === "Debt" && debt &&'));
  checkTrue("the header is text, not a link", /data-testid="debt-group-figures"/.test(sidebar) && !/<Link[^>]*debt-group-figures/.test(sidebar));
  const layout = readFileSync("app/(root)/layout.tsx", "utf8");
  checkTrue("the layout computes it from the card and loan usecases", layout.includes("services().cards.list.execute") && layout.includes("services().lending.listLoans.execute"));
  checkTrue("the layout passes it to the Sidebar", layout.includes("<Sidebar debt={debt} />"));
}

section("§9c Debt group header: Blended rate and Monthly outgo (D.2)");

{
  const inr = (minor: bigint) => Money.fromMinor(minor, Currency.of("INR"));
  // Made-up loans: ₹6,00,000 at 9.5% (EMI ₹12,000) and ₹1,00,000 at 14% (EMI ₹4,500.50).
  const home = { outstanding: inr(60000000n), annualRate: Percentage.of("9.5"), instalment: inr(1200000n) };
  const personal = { outstanding: inr(10000000n), annualRate: Percentage.of("14"), instalment: inr(450050n) };
  const closed = { outstanding: inr(0n), annualRate: Percentage.of("30"), instalment: inr(999900n) };

  // (6,00,000×9.5 + 1,00,000×14) / 7,00,000 = 10.142857142…% → 10.142857 at six places.
  check("blended rate is balance-weighted, exact to six places", blendedLoanRate([home, personal])?.toFixed(6), "10.142857");
  check("a loan with no balance carries no weight", blendedLoanRate([home, personal, closed])?.toFixed(6), "10.142857");
  check("no loan with a balance means no rate (never 0%)", blendedLoanRate([closed]), null);
  check("mixed-currency loans are not averaged", blendedLoanRate([home, { ...personal, outstanding: Money.fromMinor(100n, Currency.of("USD")) }]), null);
  // HALF_UP once: weights 1 and 2 at 0.000001% and 0.000002% → 0.0000016…% → 0.000002%.
  check("rounds once, half up", blendedLoanRate([
    { ...home, outstanding: inr(1n), annualRate: Percentage.fromScaled(1n) },
    { ...home, outstanding: inr(2n), annualRate: Percentage.fromScaled(2n) },
  ])?.scaled, 2n);

  const full = debtHeaderFigures([inr(5000000n)], [home.outstanding, personal.outstanding], [home, personal]);
  check("header shows the blended rate to two places", full?.blendedRate, "10.14%");
  check("monthly outgo sums stored instalments exactly", full?.monthlyOutgo, "₹16,500.50");
  checkTrue("a card with a balance marks the outgo loans only", full?.outgoLoansOnly === true);
  check("cards never enter the rate", debtHeaderFigures([inr(99999999n)], [home.outstanding], [home])?.blendedRate, "9.50%");
  checkTrue("no card balance means the outgo is not marked loans only",
    debtHeaderFigures([inr(0n)], [home.outstanding], [home])?.outgoLoansOnly === false);
  const cardsOnly = debtHeaderFigures([inr(100n)], [], []);
  check("cards only: no rate", cardsOnly?.blendedRate, null);
  check("cards only: no outgo (minimums are not stored)", cardsOnly?.monthlyOutgo, null);
  check("closed loans add nothing to outgo", debtHeaderFigures([], [inr(0n)], [closed])?.monthlyOutgo, null);
  check("loan rows unavailable: total still shown, rate hidden",
    debtHeaderFigures([inr(100n)], [inr(100n)], null)?.blendedRate, null);

  const sidebar = readFileSync("components/Sidebar.tsx", "utf8");
  checkTrue("Sidebar labels the rate loans only", sidebar.includes("Blended rate") && sidebar.includes("· loans only"));
  checkTrue("Sidebar hides unknown figures rather than drawing ₹0", sidebar.includes("debt.blendedRate !== null") && sidebar.includes("debt.monthlyOutgo !== null"));
  const layout = readFileSync("app/(root)/layout.tsx", "utf8");
  checkTrue("the layout passes stored loan rates and instalments", layout.includes("summary.loan.terms.annualRate.percent") && layout.includes("summary.instalment"));
}

done();
