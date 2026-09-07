import { readFileSync } from "node:fs";
import { Currency } from "@/core/money";
import type { InvestmentWorkspacePosition } from "@/app/investing.usecases";
import HoldingsTable, { filterHoldings } from "../app/(root)/investments/holdings/holdings-table";
import { check, checkDeep, checkTrue, done, section } from "./harness";

const rootPage = readFileSync("app/(root)/investments/page.tsx", "utf8");
const nav = readFileSync("app/(root)/investments/investment-nav.tsx", "utf8");
const holdingsPage = readFileSync("app/(root)/investments/holdings/page.tsx", "utf8");
const performancePage = readFileSync("app/(root)/investments/performance/page.tsx", "utf8");
const performanceChart = readFileSync("app/(root)/investments/performance/performance-chart.tsx", "utf8");
const activityPage = readFileSync("app/(root)/investments/activity/page.tsx", "utf8");

const amount = (value: string) => ({
  amount: value,
  currency: Currency.reporting.code,
});

const positions: readonly InvestmentWorkspacePosition[] = [
  {
    instrumentId: "ins_infy",
    symbol: "INFY",
    name: "Infosys Ltd",
    kind: "LISTED_EQUITY",
    quantity: "10",
    nativeCurrency: "INR",
    costBasis: amount("12000.00"),
    marketValue: amount("15000.00"),
    realisedGain: amount("125.00"),
    pricedOn: "2026-09-06",
    marketValueStatus: "AVAILABLE",
    isStale: false,
    unavailableReason: null,
  },
  {
    instrumentId: "ins_tcs",
    symbol: "TCS",
    name: "Tata Consultancy Services",
    kind: "LISTED_EQUITY",
    quantity: "4",
    nativeCurrency: "INR",
    costBasis: amount("16000.00"),
    marketValue: amount("17000.00"),
    realisedGain: amount("0.00"),
    pricedOn: "2026-08-20",
    marketValueStatus: "AVAILABLE",
    isStale: true,
    unavailableReason: null,
  },
  {
    instrumentId: "ins_gold",
    symbol: "GOLD999",
    name: "Vaulted gold",
    kind: "DIGITAL_GOLD",
    quantity: "2.5",
    nativeCurrency: "INR",
    costBasis: amount("18000.00"),
    marketValue: null,
    realisedGain: null,
    pricedOn: null,
    marketValueStatus: "NATIVE_PRICE_UNAVAILABLE",
    isStale: false,
    unavailableReason: "No quote in price book",
  },
  {
    instrumentId: "ins_us",
    symbol: "VOO",
    name: "Vanguard S&P 500 ETF",
    kind: "ETF",
    quantity: "3",
    nativeCurrency: "USD",
    costBasis: null,
    marketValue: null,
    realisedGain: null,
    pricedOn: "2026-09-05",
    marketValueStatus: "REPORTING_CURRENCY_CONVERSION_UNAVAILABLE",
    isStale: false,
    unavailableReason: "A USD market value is available, but conversion to INR is unavailable.",
  },
];

section("overview source stays narrow and truthful");

check("root consumes the workspace read model", rootPage.includes("investing.workspace.execute"), true);
check("root defines one bounded metric list", rootPage.includes("const metricCards"), true);
check("root metric list has three entries", [...rootPage.matchAll(/\"(marketValue|unrealisedPnl|realisedPnl)\"/g)].length, 3);
check("root has one allocation chart component", (rootPage.match(/<AllocationDashboard/g) ?? []).length, 1);
for (const forbidden of ["AddInstrumentForm", "OpenLeaseForm", "LeaseRowActions", "InstrumentAdmin", "RecordBuy", "RecordSell"]) {
  check(`${forbidden} is absent from overview`, rootPage.includes(forbidden), false);
}
for (const href of ["/investments/holdings", "/investments/performance", "/investments/activity", "/investments/new"]) {
  check(`overview routes to ${href}`, rootPage.includes(href), true);
}

section("workspace navigation is URL-addressable");

for (const href of ["/investments", "/investments/holdings", "/investments/performance", "/investments/activity", "/investments/new"]) {
  check(`nav includes ${href}`, nav.includes(href), true);
}
check("nav marks the active route", nav.includes("aria-current"), true);

section("holdings filter and render states");

checkDeep(
  "search narrows by symbol",
  filterHoldings(positions, { query: "inf", status: "", kind: "" }).map((row) => row.symbol),
  ["INFY"],
);
checkDeep(
  "kind filter keeps gold separate",
  filterHoldings(positions, { query: "", status: "", kind: "DIGITAL_GOLD" }).map((row) => row.symbol),
  ["GOLD999"],
);
checkDeep(
  "stale filter is explicit",
  filterHoldings(positions, { query: "", status: "stale", kind: "" }).map((row) => row.symbol),
  ["TCS"],
);
checkDeep(
  "unpriced filter is explicit",
  filterHoldings(positions, { query: "", status: "unpriced", kind: "" }).map((row) => row.symbol),
  ["GOLD999"],
);
checkDeep(
  "FX-unavailable filter is distinct from native unpriced",
  filterHoldings(positions, { query: "", status: "fx-unavailable", kind: "" }).map((row) => row.symbol),
  ["VOO"],
);

const holdingsTree = HoldingsTable({ positions, query: "", status: "", kind: "" });
const holdingsText = renderedText(holdingsTree).replace(/\s+/g, " ");
check("holdings table links durable holding record", holdingsText.includes("/investments/ins_infy"), true);
check("holdings table renders stale state", holdingsText.includes("Stale"), true);
check("holdings table renders native unpriced state", holdingsText.includes("Native price unavailable"), true);
check("holdings table renders FX conversion state", holdingsText.includes("FX conversion unavailable"), true);
check("FX state retains native currency context", holdingsText.includes("Native USD price observed"), true);
check("FX state retains observation date", holdingsText.includes("2026-09-05"), true);
check("holdings page withholds incomplete totals", holdingsPage.includes("Complete totals are unavailable"), true);
check("holdings route parser accepts FX-unavailable status", holdingsPage.includes('value === "fx-unavailable"'), true);

section("performance does not invent unavailable analytics");

for (const metric of ["investedAmount", "marketValue", "unrealisedPnl", "realisedPnl", "income", "totalInvestmentGain", "absoluteReturn", "xirr", "twr"]) {
  check(`performance page renders ${metric}`, performancePage.includes(metric), true);
}
check("income unavailable reason remains visible", performancePage.includes("metric.message"), true);
check("chart omits unavailable metrics instead of zeroing them", performanceChart.includes("status === \"AVAILABLE\""), true);
check("chart subtitle names unavailable income and total gain", performanceChart.includes("rather than charted as zero"), true);

section("activity stays compact and links durable records");

check("activity links realised history", activityPage.includes("/investments/history"), true);
check("activity links holding detail records", activityPage.includes("/investments/${position.instrumentId}"), true);
checkTrue("activity avoids order or trading lab language", !/Trading Lab|order placement|live execution/i.test(activityPage));

done();

function renderedText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(renderedText).join(" ");
  if (typeof node === "object" && "props" in node) {
    const element = node as {
      type?: unknown;
      props: { children?: unknown; href?: unknown };
    };
    if (typeof element.type === "function" && element.type.name === "PriceState") {
      return renderedText(element.type(element.props));
    }
    const props = element.props;
    return [typeof props.href === "string" ? props.href : "", renderedText(props.children)]
      .filter(Boolean)
      .join(" ");
  }
  return "";
}
