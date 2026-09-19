import { readFileSync } from "node:fs";
import { checkTrue, done, section } from "./harness";

const route = readFileSync("app/api/instruments/[instrumentId]/backfill/route.ts", "utf8");

section("holding history is bounded by owner ledger evidence");
checkTrue(
  "trade lookup uses the authorized owner and requested instrument",
  route.includes("tradesFor(authorised.userId, instrument.id)"),
);
checkTrue("only acquisitions establish inception", route.includes('trade.side === "BUY"'));
checkTrue("the earliest purchase is selected", route.includes("trade.tradedOn.isBefore(earliest)"));
checkTrue("purchase date is passed to bar ingestion", route.includes("from: purchasedOn ?? undefined"));
checkTrue("the response reports the applied floor", route.includes("from: purchasedOn?.toISO() ?? null"));

section("canonical quote keys are not suffixed twice");
checkTrue("candidate generation receives the bare instrument symbol", route.includes("symbol: instrument.symbol"));
checkTrue("the persisted canonical key is tried first", route.includes("...(key.ref ? [key.ref] : [])"));
checkTrue("fallback candidates are deduplicated", route.includes("const candidates = [...new Set(["));
checkTrue("a canonical key is not used as the bare listing symbol", !route.includes("symbol: key.ref ?? instrument.symbol"));

done();
