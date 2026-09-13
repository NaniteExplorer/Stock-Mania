import { readFile } from "node:fs/promises";

const resultPath = "D:/WorkStation/Artifacts/stock-mania-live-data-20260907/data/provider-spike-result.json";
const result = JSON.parse(await readFile(resultPath, "utf8"));
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

check(result.scope.includes("No production code"), "scope must state no production code");
check(result.zerodhaUnauthenticatedQuote.status !== "UNEXPECTED_AVAILABLE", "unauthenticated Zerodha quote unexpectedly returned available data");
check(result.zerodhaUnauthenticatedQuote.dataState === "UNAVAILABLE", "unauthenticated Zerodha quote must be unavailable");
check(result.zerodhaAuthenticatedFixture.dataState === "LIVE", "authenticated Zerodha fixture must model live state");
check(result.equityDiscovery.status === "AVAILABLE_PUBLIC_MASTER", "public instrument discovery must resolve sample equity");
check(result.equityDiscovery.matches.some((candidate) => candidate.tradingSymbol === "INFY" && candidate.isin), "INFY candidate must carry trading symbol and ISIN");
check(result.mutualFundAmfi.status === "AVAILABLE_OFFICIAL_NAV", "AMFI must return an official NAV match");
check(["NAV_DAILY", "STALE"].includes(result.mutualFundAmfi.dataState), "AMFI NAV must be daily or stale, never live");
check(result.mutualFundMfapi.status === "AVAILABLE_CONVENIENCE_NAV", "MFAPI search/latest must return a convenience NAV");
check(["NAV_DAILY", "STALE"].includes(result.mutualFundMfapi.dataState), "MFAPI NAV must be daily or stale, never live");
check(result.stateFixtures.some((entry) => entry.state === "LIVE"), "state fixtures must include LIVE");
check(result.stateFixtures.some((entry) => entry.state === "EOD"), "state fixtures must include EOD");
check(result.stateFixtures.some((entry) => entry.state === "NAV_DAILY" || entry.state === "STALE"), "state fixtures must include NAV_DAILY or STALE");
check(result.stateFixtures.some((entry) => entry.state === "UNAVAILABLE"), "state fixtures must include UNAVAILABLE");

if (failures.length > 0) {
  console.error(JSON.stringify({ status: "FAIL", failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  status: "PASS",
  assertions: 14,
  generatedAt: result.generatedAt,
  output: resultPath,
}, null, 2));
