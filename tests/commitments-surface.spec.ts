import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { Currency, Money } from "@/core/money";
import { PriceSteps, Recurrence, type Cadence } from "@/core/recurrence";
import { CalendarDate } from "@/core/time";
import { Days } from "@/core/units";
import { Commitment } from "@/domain/commitments";
import { buildCommitmentsModel } from "../app/(root)/commitments/model";
import { CommitmentsView } from "../app/(root)/commitments/commitments-view";
import AddCommitmentForm from "../app/(root)/commitments/add-commitment-form";
import { check, checkTrue, done, section } from "./harness";

const d = CalendarDate.parse;
const inr = (v: string) => Money.fromRupees(v, Currency.INR);
const today = d("2026-10-30");
let n = 0;
function make(o: { name: string; cadence?: Cadence; anchor: string; steps: [string, string | null][]; notice?: number | null; auto?: boolean; endsOn?: string | null }) {
  return new Commitment({
    id: `c${++n}`, name: o.name, kind: "STREAMING", currency: Currency.INR,
    schedule: new Recurrence({ cadence: o.cadence ?? "MONTHLY", anchor: d(o.anchor), endsOn: null, cancelNotice: o.notice == null ? null : Days(o.notice) }),
    price: new PriceSteps(o.steps.map(([from, amount]) => ({ from: d(from), amount: amount === null ? null : inr(amount) }))),
    autoRenews: o.auto ?? true, endsOn: o.endsOn ? d(o.endsOn) : null,
  });
}
const text = (html: string) => html.replace(/<[^>]*>/g, "");

section("totals: exact per year, derived per month, auto-renewing part");
const netflix = make({ name: "Netflix", anchor: "2026-01-03", steps: [["2026-01-03", "649"], ["2026-11-03", "699"]], notice: 5 });
const news = make({ name: "News annual", cadence: "ANNUAL", anchor: "2026-03-09", steps: [["2026-03-09", "1499"]], auto: false });
const gym = make({ name: "Gym", anchor: "2026-01-14", steps: [["2026-01-14", "1000"]], endsOn: "2026-11-14", notice: 30 });
const old = make({ name: "Old app", anchor: "2025-01-01", steps: [["2025-01-01", "99"]], endsOn: "2026-05-31" });
const m = buildCommitmentsModel([netflix, news, gym, old], today);
check("per year = 649×12 + 1499 + 1000×12 (cancelled gym counted until it ends)", m.perYear, "₹21,287.00");
check("per month derived from per year", m.perMonth, "₹1,773.92");
check("auto-renewing per month excludes the news plan", m.autoRenewingPerMonth, "₹1,649.00");
check("ended commitment is in the Ended group", m.rows.ended.map((r) => r.name).join(), "Old app");
check("cancelled gym is Ending", m.rows.ending.map((r) => r.name).join(), "Gym");

section("renewing soon");
check("soonest first, within 30 days", m.renewing.map((r) => r.name).join(), "Netflix,Gym");
const nf = m.renewing[0]!;
checkTrue("price rise shown old → new", nf.priceChange?.from === "₹649.00" && nf.priceChange?.to === "₹699.00");
checkTrue("cancel-by passed reads amber copy", nf.cancelBy.kind === "passed" && nf.cancelBy.text === "Cancel-by passed — renews 3 Nov");
const gymRow = m.renewing[1]!;
checkTrue("gym's cancel-by already passed too (30 days before 14 Nov)", gymRow.cancelBy.kind === "passed");
const noNotice = buildCommitmentsModel([make({ name: "Music", anchor: "2026-01-07", steps: [["2026-01-07", "149"]] })], today);
checkTrue("unknown notice is not the due date", noNotice.renewing[0]!.cancelBy.kind === "unknown");

section("unknown price is an em-dash with reason, never zero");
const unk = buildCommitmentsModel([netflix, make({ name: "Broadband", anchor: "2026-01-11", steps: [["2026-01-11", null]] })], today);
checkTrue("hero unknown", typeof unk.perMonth !== "string" && unk.perMonth.reason === "1 price not entered");
checkTrue("per year unknown, not partial", typeof unk.perYear !== "string");
const bb = unk.rows.active.find((r) => r.name === "Broadband")!;
checkTrue("row price unknown", typeof bb.price !== "string");

section("rendered view");
const form = h("div", null, "FORM");
const html = render(h(CommitmentsView, { state: { kind: "ready", model: m }, form }));
checkTrue("one h1 Commitments", (html.match(/<h1/g) ?? []).length === 1 && html.includes("Commitments"));
checkTrue("side figures labelled", html.includes("Per year") && html.includes("Auto-renewing per month"));
checkTrue("Price rises chip and arrow", text(html).includes("₹649.00 → ₹699.00") && html.includes("Price rises"));
checkTrue("ending row says counted until it ends", html.includes("Counted until it ends") && html.includes("Ends 14 Nov"));
checkTrue("ended group collapsed", html.includes("<details") && !html.includes("<details open"));
checkTrue("columns in order", ["Name", "Kind", "Cadence", "Price", "Per month", "Next charge", "Auto-renews", "Ends"].every((c) => html.includes(`>${c}</th>`)));
checkTrue("P2 verbs disabled with visible reason", html.includes("Mark cancelled") && html.includes("disabled") && html.includes("not available yet"));
const unkHtml = render(h(CommitmentsView, { state: { kind: "ready", model: unk }, form }));
checkTrue("unknown hero shows reason, no ₹0", unkHtml.includes("1 price not entered") && !text(unkHtml).includes("₹0.00"));
const emptyHtml = render(h(CommitmentsView, { state: { kind: "empty" }, form }));
checkTrue("empty copy", emptyHtml.includes("No commitments yet. Add subscriptions, plans and fees that renew."));
const noticeHtml = render(h(CommitmentsView, { state: { kind: "ready", model: noNotice }, form }));
checkTrue("notice not known rendered", noticeHtml.includes("Notice period not known"));

section("form and other states");
const formHtml = render(h(AddCommitmentForm, { action: async () => ({ ok: true, message: "x" }) }));
checkTrue("form fields post by name", ["name", "kind", "cadence", "startsOn", "price", "cancelNoticeDays", "endsOn", "autoRenews"].every((f) => formHtml.includes(`name="${f}"`)));
const loading = readFileSync("app/(root)/commitments/loading.tsx", "utf8");
checkTrue("loading: skeleton hero + 3 rows", (loading.match(/skelRow/g) ?? []).length === 3 && loading.includes("skelHero"));
const error = readFileSync("app/(root)/commitments/error.tsx", "utf8");
checkTrue("error names the read and retries", error.includes("could not be read") && error.includes("retry()"));
const actions = readFileSync("app/(root)/commitments/actions.ts", "utf8");
checkTrue("owner from session, amount never a float", actions.includes("manualFinance()") && !actions.includes("coerce.number") && !actions.includes("parseFloat"));

section("actual action date validation and authenticated ownership");
// Bundle the actual action while replacing only request/Next boundaries. This
// catches throws outside validation handling, unlike inspecting action text.
const { build } = createRequire(import.meta.url)("esbuild") as typeof import("esbuild");
await build({
  stdin: {
    resolveDir: process.cwd(), loader: "ts", contents: `
      import assert from "node:assert/strict";
      import { createCommitmentAction } from "./app/(root)/commitments/actions";
      const state = globalThis.__commitmentQa = { auth: 0, writes: [], paths: [] };
      const form = (fields) => { const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.set(key, value); return data; };
      const fields = { name: "TV", kind: "STREAMING", cadence: "MONTHLY", startsOn: "2026-01-01", endsOn: "", price: "", cancelNoticeDays: "", autoRenews: "on", userId: "attacker", id: "attacker" };
      for (const key of ["startsOn", "endsOn"]) {
        const before = state.auth;
        const result = await createCommitmentAction(null, form({ ...fields, [key]: "2026-02-30" }));
        assert.equal(result.ok, false);
        assert.ok(result.fieldErrors?.[key]?.length);
        assert.equal(state.auth, before + 1);
        assert.equal(state.writes.length, 0);
        assert.equal(state.paths.length, 0);
      }
      const saved = await createCommitmentAction(null, form(fields));
      assert.equal(saved.ok, true);
      assert.equal(state.writes.length, 1);
      assert.equal(state.writes[0].userId.value, "session-owner");
      assert.equal("id" in state.writes[0].fields, false);
      assert.equal(state.writes[0].fields.price.entries()[0].amount, null);
      assert.deepEqual(state.paths, ["/commitments"]);
      console.log("actual commitment action: 16 assertions PASS");
    `,
  },
  bundle: true, platform: "node", format: "esm", outfile: "tmp/commitments-action-regression.mjs",
  alias: { "@": "./src" },
  plugins: [{ name: "action-boundaries", setup(builder) {
    builder.onResolve({ filter: /^@\/infra\/container$/ }, () => ({ path: "container", namespace: "qa" }));
    builder.onResolve({ filter: /^next\/cache$/ }, () => ({ path: "cache", namespace: "qa" }));
    builder.onLoad({ filter: /.*/, namespace: "qa" }, ({ path }) => ({ contents: path === "cache"
      ? "export const revalidatePath = path => globalThis.__commitmentQa.paths.push(path);"
      : `export const services = () => ({ manualFinance: async () => {
          const state = globalThis.__commitmentQa; state.auth++;
          return { userId: { value: "session-owner" }, createCommitment: { execute: async input => {
            state.writes.push(input); return { ok: true, value: { id: "server-id" } };
          } } };
        } });` }));
  } }],
});
const actionOutput = execFileSync(process.execPath, ["tmp/commitments-action-regression.mjs"], { encoding: "utf8" });
checkTrue("actual action refuses impossible dates without writes and binds authenticated owner", actionOutput.includes("16 assertions PASS"));

done();
