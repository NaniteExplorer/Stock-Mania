import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { Currency, Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { coverageGap } from "@/domain/banking";
import { gapNotice, newAccountNotice, noticeDate, signedRupees } from "../app/(root)/accounts/[accountId]/gap-notice";
import { GapNoticeView } from "../app/(root)/accounts/[accountId]/gap-notice-view";
import { check, checkTrue, done, section } from "./harness";

const d = CalendarDate.parse;
const inr = (v: string) => Money.fromRupees(v, Currency.INR);
const text = (html: string) => html.replace(/<[^>]*>/g, "");

section("no gap, no notice");
check("matching opening renders nothing", gapNotice(coverageGap({ coveredTo: d("2023-11-02"), resumesOn: d("2025-12-06"), ledgerBalance: inr("100"), impliedOpening: inr("100") })), null);
check("null gap renders nothing", gapNotice(null), null);

section("understated: the spec's own worked example");
const under = gapNotice(coverageGap({ coveredTo: d("2023-11-02"), resumesOn: d("2025-12-06"), ledgerBalance: inr("178.72"), impliedOpening: inr("90488.03") }));
checkTrue("is a gap", under?.kind === "gap");
if (under?.kind === "gap") {
  check("named period", under.title, "No statements between 2 Nov 2023 and 6 Dec 2025.");
  check("row 1", `${under.rows[0].label} ${under.rows[0].value}`, "Statement opened at ₹90,488.03");
  check("row 2", `${under.rows[1].label} ${under.rows[1].value}`, "Ledger held ₹178.72");
  check("difference", `${under.rows[2].label} ${under.rows[2].value}`, "Difference ₹90,309.31");
  checkTrue("difference is the total row", under.rows[2].total === true);
  check("direction", under.direction, "understated");
  checkTrue("meaning names the amount", under.meaning.includes("understated by ₹90,309.31"));
  check("action", under.action, "Import the missing period");
  const html = render(h(GapNoticeView, { notice: under }));
  checkTrue("renders the period", text(html).includes("No statements between 2 Nov 2023 and 6 Dec 2025."));
  checkTrue("renders three rows", (html.match(/<tr>/g) ?? []).length === 3);
  checkTrue("links to imports", html.includes('href="/imports"'));
  checkTrue("no dismiss control", !/<button/.test(html));
}

section("overstated: sign kept, U+2212, never abs");
const over = gapNotice(coverageGap({ coveredTo: d("2024-01-31"), resumesOn: d("2024-04-01"), ledgerBalance: inr("5000"), impliedOpening: inr("1200.50") }));
if (over?.kind === "gap") {
  check("difference signed", over.rows[2].value, "−₹3,799.50");
  check("direction", over.direction, "overstated");
  checkTrue("meaning says overstated", over.meaning.includes("overstated by ₹3,799.50"));
} else checkTrue("overstated is a gap", false);

section("no earlier postings but a mismatch (overdrawn first statement) keeps the difference");
const first = gapNotice(coverageGap({ coveredTo: null, resumesOn: d("2025-12-06"), ledgerBalance: inr("0"), impliedOpening: inr("-250") }));
if (first?.kind === "gap") {
  checkTrue("names where history starts", first.title.startsWith("Nothing before 6 Dec 2025 is recorded"));
  check("negative opening", first.rows[0].value, "−₹250.00");
  check("difference row present", first.rows.length, 3);
} else checkTrue("overdrawn first statement is a gap", false);

section("new account line");
const fresh = newAccountNotice(d("2025-12-06"));
check("wording", fresh.title, "This is the first statement for this account. Nothing before 6 Dec 2025 is recorded.");
checkTrue("no table", !render(h(GapNoticeView, { notice: fresh })).includes("<table"));

section("formatters");
check("date", noticeDate(d("2023-11-02")), "2 Nov 2023");
check("lakh grouping", signedRupees(inr("100905.39")), "₹1,00,905.39");

done();
