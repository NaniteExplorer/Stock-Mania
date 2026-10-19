import { estimateInvestmentCharges } from "../app/(root)/investments/new/investment-charge-estimate";
import { readFileSync } from "node:fs";
import { check, checkTrue, done, section } from "./harness";

section("investment entry charge estimate");

const zerodha = estimateInvestmentCharges({
  kind: "LISTED_EQUITY",
  side: "BUY",
  segment: "EQ_DELIVERY",
  exchange: "NSE",
  platformName: "Zerodha",
  tradedOn: "2026-09-19",
  quantity: "10",
  unitPrice: "1000.00",
});
checkTrue("Zerodha NSE delivery is supported", zerodha?.supported === true);
check("delivery brokerage is zero", zerodha?.brokerageMinor.toString(), "0");
check("STT and stamp use whole-rupee rounding", zerodha?.lines.filter((line) => line.key === "stt" || line.key === "stamp").every((line) => line.minor % 100n === 0n), true);
check("gross buy debit includes itemised costs", zerodha?.grossCashMinor.toString(), (1_000_000n + (zerodha?.totalMinor ?? 0n)).toString());

const groww = estimateInvestmentCharges({
  kind: "LISTED_EQUITY",
  side: "BUY",
  segment: "EQ_DELIVERY",
  exchange: "NSE",
  platformName: "Groww",
  tradedOn: "2026-09-19",
  quantity: "10",
  unitPrice: "1000.00",
});
checkTrue("Groww applies capped percentage brokerage", (groww?.brokerageMinor ?? 0n) > 0n);

const generic = estimateInvestmentCharges({
  kind: "LISTED_EQUITY",
  side: "BUY",
  segment: "EQ_DELIVERY",
  exchange: "NSE",
  platformName: "Another broker",
  tradedOn: "2026-09-19",
  quantity: "10",
  unitPrice: "1000.00",
});
check("unsupported brokers remain manual", generic?.supported, false);
check("unsupported brokers invent no charges", generic?.totalMinor.toString(), "0");

const fund = estimateInvestmentCharges({
  kind: "MUTUAL_FUND",
  side: "BUY",
  segment: "EQ_DELIVERY",
  exchange: "",
  platformName: "Groww",
  tradedOn: "2026-09-19",
  quantity: "1000",
  unitPrice: "50.00",
});
checkTrue("fund purchase has subscription stamp", (fund?.lines.find((line) => line.key === "stamp")?.minor ?? 0n) > 0n);
checkTrue("fund guidance does not charge TER again", fund?.note.includes("already net of TER") === true);

const fundSale = estimateInvestmentCharges({
  kind: "MUTUAL_FUND",
  side: "SELL",
  segment: "EQ_DELIVERY",
  exchange: "",
  platformName: "Groww",
  tradedOn: "2026-09-19",
  quantity: "100",
  unitPrice: "50.00",
});
check("scheme-specific sale costs remain manual", fundSale?.supported, false);

const historicalEquity = estimateInvestmentCharges({
  kind: "LISTED_EQUITY",
  side: "BUY",
  segment: "EQ_DELIVERY",
  exchange: "NSE",
  platformName: "Zerodha",
  tradedOn: "2025-03-31",
  quantity: "10",
  unitPrice: "1000.00",
});
check("pre-effective equity trades stay manual", historicalEquity?.supported, false);
check("pre-effective equity trades apply no newer charges", historicalEquity?.totalMinor.toString(), "0");
checkTrue("historical fallback names the missing dated schedule", historicalEquity?.note.includes("trade date") === true);

section("discoverable safe lifecycle controls");
const depositPage = readFileSync("app/(root)/deposits/page.tsx", "utf8");
const instrumentAdmin = readFileSync("app/(root)/investments/[instrumentId]/instrument-admin.tsx", "utf8");
const tradeActions = readFileSync("app/(root)/investments/[instrumentId]/trade-row-actions.tsx", "utf8");
checkTrue("deposit rows link to the existing close/correct workflow", depositPage.includes("Close or correct") && depositPage.includes("/accounts/"));
checkTrue("never-traded holdings expose removal", instrumentAdmin.includes("Remove holding"));
checkTrue("trade rows expose an undo choice", tradeActions.includes("Undo the trade"));

done();
