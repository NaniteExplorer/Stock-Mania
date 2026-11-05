import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { readFileSync } from "node:fs";
import { Currency, Money } from "@/core/money";
import { PriceSteps, Recurrence, type Cadence } from "@/core/recurrence";
import { CalendarDate } from "@/core/time";
import { Days } from "@/core/units";
import { InsurancePolicy, type CoverKind } from "@/domain/insurance";
import { buildInsuranceView } from "../app/(root)/insurance/insurance-view";
import { InsuranceLoading, InsuranceReadError, InsuranceScreen } from "../app/(root)/insurance/insurance-screen";
import { parsePolicyForm } from "../app/(root)/insurance/policy-form";
import { check, checkTrue, done, section } from "./harness";

const d = CalendarDate.parse;
const today = d("2026-10-30");
let n = 0;
function policy(o: { kind?: CoverKind; insurer?: string; start?: string; cadence?: Cadence; notice?: number | null; steps?: { from: string; amount: string | null }[]; sum?: string | null; ends?: string | null; currency?: Currency }) {
  const currency = o.currency ?? Currency.INR;
  const start = d(o.start ?? "2025-12-10");
  return new InsurancePolicy({
    id: `p${++n}`, kind: o.kind ?? "HEALTH", insurer: o.insurer ?? "Acme Health", insured: "Self + spouse",
    sumInsured: o.sum === null ? null : Money.fromRupees(o.sum ?? "500000", currency), currency,
    premiumSchedule: new Recurrence({ cadence: o.cadence ?? "ANNUAL", anchor: start, endsOn: null, cancelNotice: o.notice === null || o.notice === undefined ? null : Days(o.notice) }),
    premium: new PriceSteps((o.steps ?? [{ from: start.toISO(), amount: "12000" }]).map((s) => ({ from: d(s.from), amount: s.amount === null ? null : Money.fromRupees(s.amount, currency) }))),
    endsOn: o.ends ? d(o.ends) : null,
  });
}
const text = (html: string) => html.replace(/<[^>]*>/g, " ");
const shot = (view: ReturnType<typeof buildInsuranceView>) => render(h(InsuranceScreen, { view, addForm: h("form", null, "form") }));

section("empty: unknown presence, never 'not covered' or zero");
const empty = buildInsuranceView([], [], today);
const emptyHtml = shot(empty);
checkTrue("empty copy", emptyHtml.includes("No policies yet. Add one, or record that you hold none."));
checkTrue("three unknown presence KPIs", (emptyHtml.match(/Not entered — add a policy or say you have none/g) ?? []).length === 3);
checkTrue("no ₹0, no 'None', no '0 policies'", !emptyHtml.includes("₹0") && !emptyHtml.includes("None held") && !emptyHtml.includes("0 policies"));
checkTrue("hero is an em-dash with reason", typeof empty.outgo !== "string" && emptyHtml.includes("No policy in force has been entered"));
checkTrue("add-policy path present", emptyHtml.includes('href="#add-policy"'));

section("covered, declared-absent, unknown look different and none is a verdict");
const health = policy({ notice: 15, steps: [{ from: "2025-12-10", amount: "12000" }, { from: "2026-12-10", amount: "13500" }] });
const term = policy({ kind: "TERM_LIFE", insurer: "Long Life", sum: null, start: "2024-03-01", cadence: "MONTHLY", steps: [{ from: "2024-03-01", amount: "1000" }] });
const lapsed = policy({ kind: "MOTOR", insurer: "Road Co", start: "2025-01-01", ends: "2026-03-31" });
const view = buildInsuranceView([lapsed, term, health], [{ kind: "PERSONAL_ACCIDENT", declaredOn: d("2026-06-12") }], today);
const html = shot(view);
check("presence states", view.presence.map((p) => p.state).join(","), "covered,covered,declared-absent");
checkTrue("Covered word and insurer detail", html.includes("Covered") && html.includes("Acme Health · Self + spouse"));
checkTrue("None held with declared date", html.includes("None held") && html.includes("You said so on 12 Jun 2026"));
checkTrue("no sum insured in the strip", !text(html.split("</dl>")[0]!).includes("5,00,000"));
checkTrue("no adequacy language", !/under-insured|shortfall|adequate|not enough/i.test(html));

section("outgo, masthead and table");
check("annual outgo = 12000 + 12×1000", view.outgo, "₹24,000.00");
check("in-force count", view.inForceCount, 2);
checkTrue("next renewal is the monthly term premium", view.nextRenewal.label === "Next renewal · 1 Nov 2026" && view.nextRenewal.value === "₹1,000.00");
check("in force first, ended last", view.policies.map((p) => p.kind).join(","), "Term life,Health,Motor");
checkTrue("ended row muted and dated", view.policies[2]!.ended && view.policies[2]!.nextDue === "Ended 31 Mar 2026" && html.includes("data-ended"));
checkTrue("unknown sum insured reads Not entered", html.includes("Not entered"));
checkTrue("unknown notice is an em-dash, not the due date", html.includes("Notice period not known"));
check("known notice gives cancel-by", view.policies[1]!.cancelBy, "25 Nov 2026");

section("renewals next 60 days with neutral old -> new");
const healthRenewal = view.renewals.find((r) => r.label.startsWith("Health"));
checkTrue("health renewal listed with old and new", healthRenewal?.previous === "₹12,000.00" && healthRenewal?.premium === "₹13,500.00");
checkTrue("soonest first", view.renewals[0]!.dueOn === "1 Nov 2026");
checkTrue("no loss/warning tone on price rise", !html.includes('data-tone="loss"') && !html.includes('data-tone="warning"'));
checkTrue("erosion collapsed, no invented rate", html.includes("<details") && !html.includes("12%"));

section("unknown premium or foreign currency never makes a partial total");
check("unknown premium", (buildInsuranceView([policy({ steps: [{ from: "2025-12-10", amount: null }] }), policy({})], [], today).outgo as { reason: string }).reason, "1 premium not entered");
checkTrue("foreign policy not converted", /not in INR/.test((buildInsuranceView([policy({ currency: Currency.USD })], [], today).outgo as { reason: string }).reason));

section("states");
const loading = render(h(InsuranceLoading));
checkTrue("loading is skeletons with busy status", loading.includes('aria-busy="true"') && loading.includes('role="status"') && (loading.match(/aria-hidden="true"/g) ?? []).length >= 6);
const failed = render(h(InsuranceReadError, { failed: "Your policies", retry: h("a", { href: "/insurance" }, "Retry") }));
checkTrue("error names the failed read and retries", failed.includes("Your policies could not be read") && failed.includes(">Retry<"));

section("form parsing: strings to Money, blanks are unknown");
const form = (entries: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(entries)) f.append(k, v); return f; };
const base = { kind: "HEALTH", insurer: "Acme", insured: "Self", currency: "INR", cadence: "ANNUAL", startsOn: "2026-04-01" };
const parsed = parsePolicyForm(form({ ...base, premium: "12500.50", sumInsured: "", cancelNoticeDays: "" }));
checkTrue("valid parse", parsed.ok);
if (parsed.ok) {
  checkTrue("exact premium", parsed.fields.premium.on(d("2026-04-01"))?.minor === 1250050n);
  checkTrue("blank sum insured is null", parsed.fields.sumInsured === null);
  checkTrue("blank notice is null", parsed.fields.premiumSchedule.cancelNotice === null);
}
const zeroNotice = parsePolicyForm(form({ ...base, cancelNoticeDays: "0" }));
checkTrue("0 notice is real zero", zeroNotice.ok && zeroNotice.fields.premiumSchedule.cancelNotice === 0);
const blankPremium = parsePolicyForm(form(base));
checkTrue("blank premium is unknown", blankPremium.ok && blankPremium.fields.premium.on(d("2026-04-01")) === null);
for (const [label, extra, field] of [["excess decimals", { premium: "1.005" }, "premium"], ["exponent", { premium: "1e5" }, "premium"], ["negative", { premium: "-5" }, "premium"], ["zero sum insured", { sumInsured: "0" }, "sumInsured"], ["bad kind", { kind: "LIFE" }, "kind"], ["bad date", { startsOn: "2026-02-30" }, "startsOn"], ["blank insurer", { insurer: " " }, "insurer"]] as const) {
  const result = parsePolicyForm(form({ ...base, ...extra }));
  checkTrue(`refuses ${label}`, !result.ok && (result.fieldErrors[field]?.length ?? 0) > 0);
}
const dup = form(base); dup.append("insurer", "Other");
checkTrue("refuses duplicated field", !parsePolicyForm(dup).ok);
checkTrue("end before start refused as a value", !parsePolicyForm(form({ ...base, endsOn: "2026-01-01" })).ok);

section("route source contracts");
const page = readFileSync("app/(root)/insurance/page.tsx", "utf8");
const actions = readFileSync("app/(root)/insurance/actions.ts", "utf8");
checkTrue("page reads both repositories and names failures", page.includes("repositories.insurance.list") && page.includes("repositories.insurance.declarations") && page.includes("InsuranceReadError"));
checkTrue("action is server-only and session-scoped", actions.startsWith('"use server"') && actions.includes("manualFinance()") && actions.includes("finance.userId"));
checkTrue("action never reads an owner from the form", !/form\.get\(["'](userId|ownerId|id)["']\)/.test(actions));
checkTrue("no float parsing anywhere", ![page, actions, readFileSync("app/(root)/insurance/policy-form.ts", "utf8")].some((s) => /parseFloat|Number\(amount|z\.coerce\.number/.test(s)));
checkTrue("revalidates after success", actions.lastIndexOf("revalidatePath(") > actions.indexOf("if (!result.ok)"));

done();
