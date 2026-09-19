import { readFileSync } from "node:fs";
import { check, checkTrue, done, section } from "./harness";

const page = readFileSync("app/(root)/investments/[instrumentId]/page.tsx", "utf8");
const chart = readFileSync("app/(root)/investments/[instrumentId]/price-history-chart.tsx", "utf8");
const returnsPanel = readFileSync("app/(root)/investments/[instrumentId]/returns-panel.tsx", "utf8");

section("sparse history is explicit and recoverable");
checkTrue("a single point is not treated as a performance chart", chart.includes("drawn < 2"));
checkTrue("sparse state explains why no trend is drawn", chart.includes("a single point cannot show performance"));
checkTrue("history load uses the authorised route", chart.includes("/api/instruments/${instrumentId}/backfill"));
checkTrue("sparse history starts its preload automatically", chart.includes("void loadHistory()"));
checkTrue("automatic history load runs only once per mount", chart.includes("preloadStarted.current = true"));
checkTrue("history load reports failures", chart.includes('status: "error"'));
checkTrue("history load refreshes server data only after writes", chart.includes("if (appended > 0) router.refresh()"));
checkTrue("stored closes are not called live", !chart.includes("Live last price"));
checkTrue("manual control is retained as a retry", chart.includes("Retry price history"));

section("open-position metrics are decision useful");
checkTrue("summary preserves digital-metal realised behavior", page.includes('isDigitalMetal ? (\n          <Stat label="Realised"'));
checkTrue("non-digital summary uses unrealised P&L", page.includes('label="Unrealised gain / loss"'));
checkTrue("performance exposes absolute return", returnsPanel.includes('label="Absolute return"'));
checkTrue("performance removes realised headline", !returnsPanel.includes('label="Realised gain / loss"'));
check("performance renders one consolidated returns panel", occurrences(page, "<ReturnsPanel"), 1);
check("realised headline remains only in the frozen digital-metal branch", occurrences(page, '<Stat label="Realised"'), 1);

done();

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}
