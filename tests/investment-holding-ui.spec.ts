import { readFileSync } from "node:fs";
import HoldingNav, {
  HOLDING_VIEWS,
  normalizeHoldingView,
  type HoldingView,
} from "../app/(root)/investments/[instrumentId]/holding-nav";
import { check, checkDeep, checkTrue, done, section } from "./harness";

const pageSource = readFileSync("app/(root)/investments/[instrumentId]/page.tsx", "utf8");
const navSource = readFileSync("app/(root)/investments/[instrumentId]/holding-nav.tsx", "utf8");

section("view selection");

check("missing view defaults to Summary", normalizeHoldingView(undefined), "summary");
check("invalid view safely falls back to Summary", normalizeHoldingView("bogus"), "summary");
check("array query values use the first durable view", normalizeHoldingView(["performance", "settings"]), "performance");
checkDeep(
  "all required holding branches are declared",
  HOLDING_VIEWS.map((view) => view.label),
  ["Summary", "Performance", "Lots & tax", "Activity", "Income & leases", "Settings"],
);
checkTrue("page awaits searchParams before selecting the branch", pageSource.includes("normalizeHoldingView((await searchParams).view)"));
checkTrue("searchParams are typed as an awaited page prop", pageSource.includes("searchParams: Promise<HoldingViewSearchParams>"));

section("semantic durable navigation");

checkTrue("nav is a semantic navigation landmark", navSource.includes('aria-label="Holding sections"'));
checkTrue("nav marks the active branch", navSource.includes("aria-current"));
checkTrue("nav wraps responsively", navSource.includes("flex flex-wrap"));

const renderedNav = renderedText(HoldingNav({ instrumentId: "ins_gold", activeView: "lots-tax" }));
for (const view of HOLDING_VIEWS) {
  const expected = view.id === "summary"
    ? "/investments/ins_gold"
    : `/investments/ins_gold?view=${view.id}`;
  checkTrue(`${view.label} link is durable`, renderedNav.includes(expected));
}

section("branch source contracts");

checkTrue("summary shows the headline holding metrics", pageSource.includes('activeView === "summary" && <div className="mb-6 grid grid-cols-2'));
checkTrue("summary keeps the gold advisory out of other branches", pageSource.includes('activeView === "summary" && instrument.kind === "DIGITAL_GOLD" && <GoldAdvisoryNote'));

checkTrue("performance owns the gold return panel", pageSource.includes('activeView === "performance" && <GoldReturnsPanel'));
checkTrue("performance owns the gold profit chart", pageSource.includes('activeView === "performance" && <GoldProfitChart'));
checkTrue("performance owns the gold benchmark comparison", pageSource.includes('activeView === "performance" && instrument.kind === "DIGITAL_GOLD"'));
checkTrue("performance has non-digital content", pageSource.includes('!isDigitalMetal && activeView === "performance"'));
checkTrue("non-digital performance renders existing position valuation", pageSource.includes("const holdingMarketValue = isDigitalMetal ? metalValue : (position?.marketValue ?? null)"));
checkTrue("non-digital performance names unavailable holding returns", pageSource.includes("Holding-level XIRR and TWR are unavailable"));

checkTrue("lots and tax owns the non-metal lots table", pageSource.includes('!isDigitalMetal && activeView === "lots-tax" && <section'));
checkTrue("lots and tax owns the method comparison", pageSource.includes('activeView === "lots-tax" && comparison?.ok'));
checkTrue("lots and tax owns the gold lot ladder", pageSource.includes('activeView === "lots-tax" && <GoldLotLadder'));
checkTrue("lots and tax owns the gold tax statement", pageSource.includes('activeView === "lots-tax" && instrument.kind === "DIGITAL_GOLD"'));

checkTrue("activity owns digital-metal transaction history", pageSource.includes('activeView === "activity" && <section className="panel mb-6 p-0"'));
checkTrue("activity owns the metal transaction form", pageSource.includes('activeView === "activity" && <Card title="Add investment transaction"'));
checkTrue("activity owns non-metal trade history", pageSource.includes('!isDigitalMetal && activeView === "activity" && <section'));
checkTrue("activity owns the non-metal trade form", pageSource.includes('!isDigitalMetal && activeView === "activity" && <Card'));
checkTrue("activity owns corporate actions", pageSource.includes('!isDigitalMetal && activeView === "activity" && actions.length > 0'));

checkTrue("settings owns holding administration", pageSource.includes('activeView === "settings" && <Card'));
checkTrue("settings contains the existing admin component", pageSource.includes("<InstrumentAdmin"));

section("non-leasable branches are nonblank");

checkTrue("income branch has a non-gold not-applicable panel", pageSource.includes('activeView === "income-leases" && instrument.kind !== "DIGITAL_GOLD"'));
checkTrue("non-gold income panel states lease features are not applicable", pageSource.includes("Lease features are only defined for digital gold"));
const nonGoldIncomeBranch = sourceBetween(
  pageSource,
  'activeView === "income-leases" && instrument.kind !== "DIGITAL_GOLD"',
  '!isDigitalMetal && activeView === "lots-tax"',
);
checkTrue("non-gold income panel renders no lease controls", !nonGoldIncomeBranch.includes("DigitalGoldLeaseForm") && !nonGoldIncomeBranch.includes("LeaseRowActions"));

section("lease controls stay single-counted");

check("lease form is rendered from one branch only", occurrences(pageSource, "<DigitalGoldLeaseForm"), 1);
check("lease row actions are rendered from one branch only", occurrences(pageSource, "<LeaseRowActions"), 1);
checkTrue("lease controls are limited to the Income & leases gold branch", pageSource.includes('activeView === "income-leases" && instrument.kind === "DIGITAL_GOLD"'));
checkTrue("lease value is not added to market value in the route", !/marketValue\.(plus|add)\([^)]*lease/i.test(pageSource));
checkTrue("lease portfolio value is not recomputed in the route", !pageSource.includes("leasePortfolio?.value"));

done();

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) return "";
  return source.slice(startIndex, endIndex);
}

function renderedText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(renderedText).join(" ");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props: { children?: unknown; href?: unknown } }).props;
    return [typeof props.href === "string" ? props.href : "", renderedText(props.children)]
      .filter(Boolean)
      .join(" ");
  }
  return "";
}
