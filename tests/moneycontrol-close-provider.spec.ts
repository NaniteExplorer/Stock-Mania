import { Currency } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import { MoneycontrolCloseProvider } from "@/infra/providers";
import { FixtureHttpClient, VirtualRuntime } from "./doubles";
import { check, checkTrue, done, section } from "./harness";

section("validated Indian close fallback");

const suggestions = JSON.stringify([{
  sc_id: "KJI01",
  pdt_dis_nm: "Kalyan Jewellers India <span>INE303R01014, KALYANKJIL, 543278</span>",
}]);
const close = JSON.stringify({
  code: "200",
  data: {
    NSEID: "KALYANKJIL",
    BSEID: "543278",
    pricecurrent: "581.85",
    priceprevclose: "581.45",
    market_state: "CLOSED",
    lastupd: "2026-09-18 15:59:55",
    PREVDATE: "2026-09-17",
  },
});
const http = new FixtureHttpClient([
  { match: "autosuggestion_solr.php", body: suggestions },
  { match: "pricefeed/nse/equitycash/KJI01", body: close },
]);
const runtime = new VirtualRuntime(http, { startMillis: Date.parse("2026-09-19T05:00:00Z") });
const provider = new MoneycontrolCloseProvider(runtime);
const result = await provider.fetchQuotes({
  instruments: [{
    instrumentId: "instrument-kalyan",
    symbol: "KALYANKJIL.NS",
    assetClass: "EQUITY",
    currency: Currency.INR,
    identifierType: "TICKER",
    exchange: "NSE",
  }],
  range: DateRange.of(CalendarDate.parse("2026-09-14"), CalendarDate.parse("2026-09-19")),
  quoteType: "CLOSE",
});

checkTrue("the validated symbol resolves", result.ok);
if (result.ok) {
  check("one close is returned", result.value.length, 1);
  check("closed-market value is used", result.value[0].price.toDecimalString(), "581.85");
  check("the source trading date is retained", result.value[0].asOf.toISO(), "2026-09-18");
  check("provider attribution is retained", result.value[0].providerId, "moneycontrol-close");
}
check("symbol resolution and quote each make one request", http.requests.length, 2);

done();
