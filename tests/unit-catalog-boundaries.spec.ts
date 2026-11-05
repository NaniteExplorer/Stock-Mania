import { FixedClock } from "@/core/kernel";
import { Count, Millis } from "@/core/units";
import {
  CATALOG_REFRESH_INTERVAL_MS, QUOTE_KEY_REVALIDATION_INTERVAL_MS,
  acceptQuoteKeyProbe, isRefreshDue, isQuoteKeyRevalidationDue,
  type CatalogFetchReceipt, type CatalogIngestReport, type InstrumentCatalogRepository,
  type QuoteKeyProbeResult, type QuoteKeyReconciliationReport,
} from "@/domain/instrument-catalog";
import type { LiveDataCenterOutput } from "@/domain/live-data";
import { check, done } from "./harness";

const fetchedAt = new Date("2026-01-01T00:00:00.000Z");
const receipt: CatalogFetchReceipt = { source: "fixture", fetchedAt, checksum: "same", rowCount: Count(0) };
check("catalogue refresh remains one exact day", CATALOG_REFRESH_INTERVAL_MS, Millis(86_400_000));
check("catalogue remains fresh just before the daily edge", isRefreshDue(receipt, new FixedClock(new Date(fetchedAt.getTime() + CATALOG_REFRESH_INTERVAL_MS - 1))), false);
check("catalogue refresh includes the daily edge", isRefreshDue(receipt, new FixedClock(new Date(fetchedAt.getTime() + CATALOG_REFRESH_INTERVAL_MS))), true);
check("quote confirmation retains thirty exact days", QUOTE_KEY_REVALIDATION_INTERVAL_MS, Millis(2_592_000_000));
const state = { listingId: "listing", quoteKey: "EXAMPLE.NS", quoteProvider: "fixture", quoteValidatedAt: fetchedAt, quoteStale: false, firstTradeDate: null };
check("quote confirmation remains fresh just before the edge", isQuoteKeyRevalidationDue(state, new FixedClock(new Date(fetchedAt.getTime() + QUOTE_KEY_REVALIDATION_INTERVAL_MS - 1))), false);
check("quote confirmation includes its exact edge", isQuoteKeyRevalidationDue(state, new FixedClock(new Date(fetchedAt.getTime() + QUOTE_KEY_REVALIDATION_INTERVAL_MS))), true);
const probe: QuoteKeyProbeResult = { quoteKey: "EXAMPLE.NS", bars: Count(0), currency: "INR", instrumentType: "EQUITY", firstTradeDate: null, sourceId: "fixture" };
check("zero measured bars still refuse resolution", acceptQuoteKeyProbe(probe, { currency: "INR" }).accepted, false);
check("one measured bar still permits a matching source", acceptQuoteKeyProbe({ ...probe, bars: Count(1) }, { currency: "INR" }).accepted, true);
check("count units do not bypass currency validation", acceptQuoteKeyProbe({ ...probe, bars: Count(1), currency: "USD" }, { currency: "INR" }).accepted, false);

if (false) {
  const receiptCount: CatalogFetchReceipt["rowCount"] = Count(2);
  const ingestCount: CatalogIngestReport["mappings"] = Count(3);
  const reconciledCount: QuoteKeyReconciliationReport["resolved"] = Count(1);
  const coverage: LiveDataCenterOutput["coverage"]["other"] = Count(0);
  const searchLimit: Parameters<InstrumentCatalogRepository["search"]>[1] = Count(25);
  const refresh: Millis = CATALOG_REFRESH_INTERVAL_MS;
  // @ts-expect-error A row count cannot be an unmeasured number.
  const rawCount: CatalogFetchReceipt["rowCount"] = 2;
  // @ts-expect-error Search limits count rows, not milliseconds.
  const wrongLimit: Parameters<InstrumentCatalogRepository["search"]>[1] = Millis(25);
  // @ts-expect-error Coverage counts instruments, not arbitrary numbers.
  const rawCoverage: LiveDataCenterOutput["coverage"]["other"] = 0;
  void [receiptCount, ingestCount, reconciledCount, coverage, searchLimit, refresh, rawCount, wrongLimit, rawCoverage];
}
done();
