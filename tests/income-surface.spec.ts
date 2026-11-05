import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { readFileSync } from "node:fs";
import { Currency, Money } from "@/core/money";
import { PriceSteps, Recurrence } from "@/core/recurrence";
import { CalendarDate } from "@/core/time";
import { Days } from "@/core/units";
import { IncomeStream, type IncomeReceipt } from "@/domain/income";
import { buildIncomeView } from "../app/(root)/income/income-model";
import { parseIncomeForm } from "../app/(root)/income/income-form";
import { IncomeEmpty, IncomeScreen, OccurrenceCell } from "../app/(root)/income/income-view";
import { check, checkTrue, done, section, throws } from "./harness";

// Made-up figures only.
const on = (iso: string) => CalendarDate.parse(iso);
const inr = (v: string) => Money.fromRupees(v);
const salary = new IncomeStream({
  id: "s1", name: "Salary", kind: "SALARY", payer: "Example Pvt Ltd", currency: Currency.INR,
  schedule: new Recurrence({ cadence: "MONTHLY", anchor: on("2026-01-31"), endsOn: null, cancelNotice: null }),
  expected: new PriceSteps([{ from: on("2026-01-01"), amount: inr("100000") }]), grace: Days(5),
});
const retainer = new IncomeStream({
  id: "s2", name: "Retainer", kind: "FREELANCE", payer: null, currency: Currency.INR,
  schedule: new Recurrence({ cadence: "MONTHLY", anchor: on("2026-01-10"), endsOn: null, cancelNotice: null }),
  expected: new PriceSteps([{ from: on("2026-01-01"), amount: null }]), grace: Days(0),
});
const paid = (occurrence: string, amount: string, receivedOn = occurrence): IncomeReceipt => ({ streamId: "s1", occurrence: on(occurrence), postingId: `p-${occurrence}`, receivedOn: on(receivedOn), amount: inr(amount) });
const today = on("2026-10-20");
const receipts = [paid("2026-04-30", "100000"), paid("2026-05-31", "99997"), paid("2026-07-31", "100000", "2026-08-01"), paid("2026-08-31", "100000"), paid("2026-09-30", "100000")];
const strip = (html: string) => html.replace(/<[^>]*>/g, " ");

section("view model: missing is missing, unknown is unknown");
const salaryOnly = buildIncomeView([{ stream: salary, receipts }], today);
check("June has no receipt and is past grace: one missing in FY", salaryOnly.summary.missingFy, 1);
check("31 Oct is not yet due, so nothing in FY to date is pending", salaryOnly.summary.pendingFy, 0);
check("the October cell in the row is pending, not missing", salaryOnly.streams[0]!.cells.at(-1)!.state, "pending");
check("received FY to date is what arrived", salaryOnly.summary.receivedFy, "₹4,99,997");
check("expected FY to date is a full sum when every amount is known", salaryOnly.summary.expectedFy, "₹6,00,000");
check("nothing received this month is a real zero", salaryOnly.summary.receivedThisMonth, "₹0");
const june = salaryOnly.streams[0]!.cells.find((c) => c.key === "2026-06-30")!;
check("June cell is missing", june.state, "missing");
check("missing text names expected amount and lateness", june.text, "Missing — expected ₹1,00,000, 107 days late");
const may = salaryOnly.streams[0]!.cells.find((c) => c.key === "2026-05-31")!;
check("a short receipt shows its neutral difference", may.state === "received" ? may.difference : null, "−₹3");
const july = salaryOnly.streams[0]!.cells.find((c) => c.key === "2026-07-31")!;
check("received date is the posting's date", july.text, "Received ₹1,00,000 on 1 Aug");
check("received cell carries its received date for display", july.state === "received" ? july.receivedOn : null, "1 Aug");
check("trailing 12-month row starts at the anchor", salaryOnly.streams[0]!.cells[0]!.key, "2026-01-31");

const both = buildIncomeView([{ stream: salary, receipts }, { stream: retainer, receipts: [] }], today);
const expectedFy = both.summary.expectedFy;
check("one unknown amount makes expected FY unknown, not partial", typeof expectedFy === "string" ? expectedFy : expectedFy.reason, "7 expected amounts not entered");
const pendingRetainer = buildIncomeView([{ stream: retainer, receipts: [] }], on("2026-10-05")).streams[0]!.cells.at(-1)!;
check("pending with unknown amount says so", pendingRetainer.text, "Due 10 Oct, expected amount not entered");
const usd = new IncomeStream({ ...salary, id: "s3", currency: Currency.USD, expected: new PriceSteps([{ from: on("2026-01-01"), amount: Money.fromRupees("10", Currency.USD) }]) });
const mixed = buildIncomeView([{ stream: salary, receipts }, { stream: usd, receipts: [] }], today).summary.receivedFy;
checkTrue("mixed currencies are never summed", typeof mixed !== "string");
throws("no streams is the empty state, not a zero view", () => buildIncomeView([], today), "empty state");

section("rendered screen");
const html = render(h(IncomeScreen, { view: both, form: h("form", null, "form") }));
check("one h1", (html.match(/<h1\b/g) ?? []).length, 1);
checkTrue("Missing renders as text, amber cell", html.includes('data-state="missing"') && strip(html).includes("Missing"));
checkTrue("no ₹0 inside a missing cell", !/data-state="missing"[^]*?<\/li>/.exec(html)![0].includes("₹0"));
checkTrue("unknown expected is an em-dash with its reason", html.includes("—") && html.includes("7 expected amounts not entered"));
checkTrue("link a payment is disabled with its reason", /<button[^>]*disabled[^>]*>/.test(html) && html.includes("receipt writer"));
checkTrue("cells carry text alternatives", html.includes("Missing — expected ₹1,00,000, 107 days late"));
checkTrue("one panel per stream", html.includes("Salary") && html.includes("Retainer"));
// QA repair 2026-11-03 (D2): the received date must be visible, not only in the screen-reader span.
const julyHtml = render(h(OccurrenceCell, { cell: july, reasonId: "r" }));
const sighted = strip(julyHtml.replace(/<span class="[^"]*\bsr\b[^"]*">[^<]*<\/span>/g, "")).replace(/\s+/g, " ").trim();
checkTrue("sighted received cell shows the received date, distinct from the due date", sighted.includes("Received 1 Aug") && sighted.includes("31 Jul"));
checkTrue("screen-reader text for the received cell is intact", julyHtml.includes("Received ₹1,00,000 on 1 Aug"));
check("screen readers hear the received date once, not twice", (strip(julyHtml.replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, "")).match(/1 Aug/g) ?? []).length, 1);
const empty = render(h(IncomeEmpty, { form: h("form", null) }));
checkTrue("empty state copy", empty.includes("No income streams yet. Add your salary or any regular inflow."));

section("form parsing never invents a zero");
const form = (entries: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(entries)) f.set(k, v); return f; };
const base = { name: "Rent", kind: "RENT", payer: "", currency: "INR", cadence: "MONTHLY", anchor: "2026-02-05", expected: "", grace: "3" };
const blank = parseIncomeForm(form(base));
check("blank expected becomes an unknown step", blank.ok ? blank.fields.expected.entries()[0]!.amount : "fail", null);
const priced = parseIncomeForm(form({ ...base, expected: "25000.50" }));
check("amount parsed exactly", priced.ok ? priced.fields.expected.entries()[0]!.amount!.minor : "fail", 2500050n);
const bad = parseIncomeForm(form({ ...base, expected: "1e5", anchor: "2026-02-30" }));
checkTrue("malformed amount refused with field error", !bad.ok && !!bad.fieldErrors.expected);
const badDate = parseIncomeForm(form({ ...base, anchor: "2026-02-30" }));
checkTrue("impossible date refused", !badDate.ok && !!badDate.fieldErrors.anchor);

section("page and action wiring");
const page = readFileSync("app/(root)/income/page.tsx", "utf8");
const action = readFileSync("app/(root)/income/actions.ts", "utf8");
checkTrue("page reads through the income repository", page.includes("repositories.income.list") && page.includes("repositories.income.receipts"));
checkTrue("action is a server action using manualFinance", action.startsWith('"use server"') && action.includes("manualFinance()") && action.includes("createIncomeStream.execute"));
checkTrue("owner never comes from the form", !/formData\.get\(["']user/i.test(action));
checkTrue("error state retries", readFileSync("app/(root)/income/error.tsx", "utf8").includes("retry()"));

done();
