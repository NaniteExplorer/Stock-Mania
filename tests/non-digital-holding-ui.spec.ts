import { readFileSync } from "node:fs";
import { checkTrue, done, section } from "./harness";

const pageSource = readFileSync("app/(root)/investments/[instrumentId]/page.tsx", "utf8");
const profileSource = readFileSync("app/(root)/investments/[instrumentId]/non-digital-holding-profile.tsx", "utf8");

section("asset-specific characterization");

checkTrue("equity summary names listed-security identity", profileSource.includes("Listed security profile"));
checkTrue("equity summary exposes exchange and ISIN", profileSource.includes('label="ISIN"') && profileSource.includes('label={props.family === "FUND" ? "Scheme code" : "Exchange"}'));
checkTrue("fund summary uses scheme and NAV language", profileSource.includes("Scheme code") && profileSource.includes("Latest stored NAV observation"));
checkTrue("fixed income summary uses debt-specific language", profileSource.includes("Fixed-income profile"));
checkTrue("route derives bond and SGB lifecycle from typed terms", pageSource.includes("instrument instanceof Bond") && pageSource.includes("instrument instanceof SovereignGoldBond"));

section("truthful analysis and lifecycle states");

checkTrue("performance identifies stale observations", profileSource.includes('props.isStale ? "Stale"'));
checkTrue("performance exposes quote provenance", profileSource.includes("Valuation basis") && profileSource.includes("Price reference"));
checkTrue("unavailable valuation is explicit", profileSource.includes('!props.pricedOn ? "Unavailable"') && profileSource.includes("props.unpricedReason"));
checkTrue("recorded maturity facts render without projection", pageSource.includes('{ label: "Maturity"') && pageSource.includes("2.50% p.a.; taxable as recorded income"));
checkTrue("component refuses to estimate missing distributions", profileSource.includes("Unrecorded distributions, coupons or redemptions are not estimated"));
checkTrue("UI contains no recommendation language", !/\b(buy|sell|recommend|target price|expected return)\b/i.test(profileSource));

section("digital-metal boundary");

checkTrue("new profile is gated away from all digital metals", pageSource.includes('!isDigitalMetal && activeView === "summary"') && pageSource.includes('!isDigitalMetal && activeView === "performance"') && pageSource.includes('!isDigitalMetal && activeView === "income-leases"'));
checkTrue("specialized gold components remain imported", pageSource.includes("GoldReturnsPanel") && pageSource.includes("GoldProfitChart") && pageSource.includes("GoldTaxStatement"));

done();
