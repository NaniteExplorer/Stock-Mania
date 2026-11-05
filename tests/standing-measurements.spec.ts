/**
 * The /standing measurements (`src/app/standing.usecases.ts`), against fake ports
 * and made-up figures. The rule under test: measured only from real records;
 * otherwise unknown with a reason — never a zero, never a guess.
 */
import { UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { PriceSteps, Recurrence } from "@/core/recurrence";
import { CalendarDate, DateRange } from "@/core/time";
import { Count, Days } from "@/core/units";
import { AccountId } from "@/domain/accounts";
import { Commitment } from "@/domain/commitments";
import { InsurancePolicy, type AbsenceDeclaration, type CoverKind } from "@/domain/insurance";
import type { Measurement } from "@/domain/scoring/composite";
import { INDICATORS } from "@/domain/scoring/indicators";
import { scoreCard } from "@/domain/scoring/score-card";
import type { AccountBalance, MonthlyFlow } from "@/domain/transactions";
import { StandingMeasurements, type StandingSources } from "@/app/standing.usecases";
import { buildStandingView } from "../app/(root)/standing/standing-model";
import { check, checkDeep, checkTrue, done, section } from "./harness";

const INR = Currency.of("INR");
const on = (iso: string) => CalendarDate.parse(iso);
const rupees = (value: string | number) => Money.fromRupees(String(value));
const me = UserId.from("u-standing");
const today = on("2026-10-30");

/** `count` consecutive months ending at `last` (YYYY-MM), oldest first, each from `make(index)`. */
function months(last: string, count: number, make: (index: number) => { income: number; expense: number }): Map<string, MonthlyFlow> {
  const out = new Map<string, MonthlyFlow>();
  let cursor = on(`${last}-01`).plusMonths(-(count - 1));
  for (let index = 0; index < count; index += 1) {
    const { income, expense } = make(index);
    out.set(cursor.toMonthKey(), { month: cursor.toMonthKey(), income: rupees(income), expense: rupees(expense) });
    cursor = cursor.plusMonths(1);
  }
  return out;
}

/** A fixed made-up uuid per account name, so the fake service map can key on it. */
const IDS: Record<string, string> = {
  "Home loan": "00000000-0000-4000-8000-000000000001", Card: "00000000-0000-4000-8000-000000000002", EPF: "00000000-0000-4000-8000-000000000003",
  Friend: "00000000-0000-4000-8000-000000000004", "Paid-off card": "00000000-0000-4000-8000-000000000005",
};
const row = (name: string, type: "ASSET" | "LIABILITY", subtype: string, balance: number): AccountBalance => ({
  accountId: AccountId.from(IDS[name]), code: `X:${name}`, name, type, subtype, institution: null, isClosed: false, balance: rupees(balance), postingCount: Count(1),
});

const policy = (id: string, kind: CoverKind, annual: string) => new InsurancePolicy({
  id, kind, insurer: "Example General", insured: "Self", sumInsured: rupees(500000), currency: INR,
  premiumSchedule: new Recurrence({ cadence: "ANNUAL", anchor: on("2025-11-10"), endsOn: null, cancelNotice: Days(15) }),
  premium: new PriceSteps([{ from: on("2025-11-10"), amount: rupees(annual) }]),
  endsOn: null,
});
const ott = new Commitment({
  id: "ott", name: "Streaming", kind: "STREAMING", currency: INR,
  schedule: new Recurrence({ cadence: "MONTHLY", anchor: on("2025-06-03"), endsOn: null, cancelNotice: null }),
  price: new PriceSteps([{ from: on("2025-06-03"), amount: rupees(649) }]),
  autoRenews: true, endsOn: null,
});

interface World {
  flows: Map<string, MonthlyFlow>;
  sheet: AccountBalance[];
  liquid: Money;
  service: Map<string, Money>;
  policies: InsurancePolicy[];
  declarations: AbsenceDeclaration[];
  commitments: Commitment[];
}
let serviceCalls = 0;
function sources(world: World): StandingSources {
  return {
    balances: {
      // Like the real read model: every month in the range, zero where nothing was posted.
      async monthlyFlows(_user: UserId, range: DateRange) {
        return range.months().map((m) => world.flows.get(m.start.toMonthKey()) ?? { month: m.start.toMonthKey(), income: Money.zero(INR), expense: Money.zero(INR) });
      },
      async balanceSheet() { return world.sheet; },
    } as unknown as StandingSources["balances"],
    async liquidAssets() { return world.liquid; },
    async monthlyService(_user, _asOf, owed) {
      serviceCalls += 1;
      return new Map(owed.flatMap((r) => (world.service.has(r.accountId.value) ? [[r.accountId.value, world.service.get(r.accountId.value)!] as const] : [])));
    },
    insurance: { async list() { return world.policies; }, async declarations() { return world.declarations; } },
    commitments: { async list() { return world.commitments; } },
  };
}

/** 48 recorded months to Sep 2026: income 1L a month (±10k before the last year, ±20k in it), outgo 60k then 50k. */
const fullHistory = () => months("2026-09", 48, (i) => ({
  income: i < 36 ? (i % 2 === 0 ? 90000 : 110000) : (i % 2 === 0 ? 80000 : 120000),
  expense: i < 36 ? 60000 : 50000,
}));
const world = (overrides: Partial<World> = {}): World => ({
  flows: fullHistory(),
  sheet: [row("Home loan", "LIABILITY", "LOAN", 2000000), row("Card", "LIABILITY", "CREDIT_CARD", 10000), row("EPF", "ASSET", "RETIREMENT", 3000000)],
  liquid: rupees(600000),
  service: new Map([[IDS["Home loan"], rupees(20000)], [IDS.Card, rupees(500)]]),
  policies: [policy("health", "HEALTH", "18500")],
  declarations: [],
  commitments: [ott],
  ...overrides,
});

async function measure(w: World) {
  const result = await new StandingMeasurements(sources(w)).execute({ userId: me, today });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
const value = (m: Measurement | undefined) => (m?.state === "measured" ? Number(m.value) : m?.state);
const reason = (m: Measurement | undefined) => (m?.state === "unknown" ? m.reason : "");

section("full records: every ledger indicator measured from the figures");
{
  const out = await measure(world());
  const m = out.measurements;
  check("one entry per registry indicator", m.size, INDICATORS.length);
  check("runway = 6,00,000 ÷ 50,000 average outgo", value(m.get("runway-months")), 12);
  check("savings rate improved on every earlier 12-month window: standing 1", value(m.get("savings-rate")), 1);
  check("debt service = (20,000 + 500) ÷ 1,00,000 median income", value(m.get("debt-service-ratio")), 0.205);
  check("FOIR adds commitments 649 and premiums 18,500 ÷ 12", value(m.get("foir-ceiling")), 0.2269067);
  check("income CV doubled against the prior 24 months: standing 0.5", value(m.get("income-stability")), 0.5);
  check("health cover: one policy in force", value(m.get("health-cover-present")), 1);
  check("independence = total net worth (30,00,000 − 20,00,000 − 10,000) ÷ 6,00,000 annual outgo", value(m.get("independence-multiple")), 1.65);
  check("term cover with no policy and no statement is unknown", m.get("term-cover-present")?.state, "unknown");
  checkTrue("…with a reason", reason(m.get("term-cover-present")).includes("term life"));
  checkDeep("ceiling facts from the same measurements", out.facts, { healthCover: "covered", foir: 0.2269067 });
  check("previous tier is not persisted: null", out.previous, null);
  check("oldest input is the last recorded month's end", out.oldestInput?.on.toISO(), "2026-09-30");
  check("…named after an indicator measured on it", out.oldestInput?.name, "Runway");
  const card = scoreCard(m, out.facts, out.previous);
  check("composite refuses on the one unknown pillar", card.composite.state === "refused" ? card.composite.missingPillars.join(",") : "scored", "PROTECT");
}

section("term cover held: the composite is scored");
{
  const out = await measure(world({ policies: [policy("health", "HEALTH", "18500"), policy("term", "TERM_LIFE", "12000")] }));
  check("term cover measured", value(out.measurements.get("term-cover-present")), 1);
  check("FOIR now carries both premiums", value(out.measurements.get("foir-ceiling")), 0.2369067);
  const card = scoreCard(out.measurements, out.facts, out.previous);
  check("scored", card.composite.state, "scored");
  check("coverage 100%", Number(card.coverage), 1);
  checkTrue("tier present", card.tier !== null);
}

section("declared absence: health scores zero honestly; term needs the dependants fact");
{
  const declarations: AbsenceDeclaration[] = [{ kind: "HEALTH", declaredOn: on("2026-01-15") }, { kind: "TERM_LIFE", declaredOn: on("2026-02-01") }];
  const out = await measure(world({ policies: [], declarations }));
  check("health declared absent", out.measurements.get("health-cover-present")?.state, "declared-absent");
  check("ceiling sees the absence", out.facts.healthCover, "declared-absent");
  check("term declared absent is unknown, not zero and not n/a", out.measurements.get("term-cover-present")?.state, "unknown");
  checkTrue("…because dependants are not recorded", reason(out.measurements.get("term-cover-present")).includes("depends on your income"));
  check("oldest input is the declaration's date", out.oldestInput?.on.toISO(), "2026-01-15");
  check("…named", out.oldestInput?.name, "Health cover");
  checkTrue("never not-applicable anywhere", [...out.measurements.values()].every((x) => x.state !== "not-applicable"));
}

section("short history: unknown with the count, never annualised");
{
  const out = await measure(world({ flows: months("2026-09", 8, () => ({ income: 100000, expense: 50000 })) }));
  for (const id of ["runway-months", "savings-rate", "debt-service-ratio", "foir-ceiling", "income-stability", "independence-multiple"]) {
    check(`${id} unknown`, out.measurements.get(id)?.state, "unknown");
  }
  checkTrue("runway names the 8 recorded months", reason(out.measurements.get("runway-months")).includes("8 recorded"));
  checkTrue("independence uses the milestone refusal", reason(out.measurements.get("independence-multiple")).includes("twelve months"));
  check("health still measured", value(out.measurements.get("health-cover-present")), 1);
  check("FOIR fact is null, not zero", out.facts.foir, null);
  check("oldest input comes only from what was measured", out.oldestInput?.on.toISO(), "2026-10-30");
}

section("24 months: savings rate measured, stability needs 36");
{
  const out = await measure(world({ flows: months("2026-09", 24, (i) => ({ income: 100000, expense: i < 12 ? 50000 : 60000 })) }));
  check("savings worse than every earlier window: standing 0", value(out.measurements.get("savings-rate")), 0);
  checkTrue("stability unknown, naming 36", reason(out.measurements.get("income-stability")).includes("Needs 36"));
  const flat = await measure(world({ flows: months("2026-09", 24, () => ({ income: 100000, expense: 50000 })) }));
  check("all windows equal: ties count half", value(flat.measurements.get("savings-rate")), 0.5);
}

section("a month with no postings is a gap, not a zero month");
{
  const flows = fullHistory();
  flows.delete("2026-05");
  const out = await measure(world({ flows }));
  check("runway unknown", out.measurements.get("runway-months")?.state, "unknown");
  checkTrue("names the 4 months recorded since the gap", reason(out.measurements.get("runway-months")).includes("4 recorded up to 2026-09"));
}

section("no records at all");
{
  const out = await measure(world({ flows: new Map() }));
  checkTrue("runway says none are recorded", reason(out.measurements.get("runway-months")).includes("none are recorded"));
  check("independence unknown", out.measurements.get("independence-multiple")?.state, "unknown");
}

section("records that stopped: measured on the last recorded month, and stale");
{
  const flows = months("2026-06", 48, () => ({ income: 100000, expense: 50000 }));
  const out = await measure(world({ flows }));
  check("runway measured", value(out.measurements.get("runway-months")), 12);
  check("as of June's end", out.oldestInput?.on.toISO(), "2026-06-30");
  const view = buildStandingView({ card: scoreCard(out.measurements, out.facts, null), measurements: out.measurements, previous: null, oldestInput: out.oldestInput, today });
  checkTrue("the screen's stale notice names it", view.stale !== null && view.stale.includes("122 days"));
}

section("debts: one without an instalment makes debt service unknown");
{
  const sheet = [...world().sheet, row("Friend", "LIABILITY", "OTHER", 25000)];
  const out = await measure(world({ sheet }));
  check("debt service unknown", out.measurements.get("debt-service-ratio")?.state, "unknown");
  checkTrue("names the debt", reason(out.measurements.get("debt-service-ratio")).includes("Friend is owed"));
  check("FOIR unknown with it", out.measurements.get("foir-ceiling")?.state, "unknown");
  check("FOIR fact null", out.facts.foir, null);
}

section("no liabilities owed: debt service is a measured zero from the ledger");
{
  serviceCalls = 0;
  const sheet = [row("EPF", "ASSET", "RETIREMENT", 3000000), row("Paid-off card", "LIABILITY", "CREDIT_CARD", 0)];
  const out = await measure(world({ sheet, service: new Map() }));
  check("debt service 0", value(out.measurements.get("debt-service-ratio")), 0);
  check("the service port is not asked about nothing", serviceCalls, 0);
}

section("unpriced commitment or premium: FOIR unknown, debt service still measured");
{
  const unpriced = new Commitment({ ...ott, id: "course", name: "Course", price: new PriceSteps([{ from: on("2025-06-03"), amount: null }]) });
  const out = await measure(world({ commitments: [ott, unpriced] }));
  check("FOIR unknown", out.measurements.get("foir-ceiling")?.state, "unknown");
  check("debt service measured", value(out.measurements.get("debt-service-ratio")), 0.205);
}

section("every unknown carries a reason");
{
  const out = await measure(world({ flows: new Map(), policies: [] }));
  checkTrue("no empty reason", [...out.measurements.values()].every((x) => x.state !== "unknown" || x.reason.trim().length > 0));
  checkTrue("no measured zero smuggled in", [...out.measurements.values()].every((x) => x.state !== "measured"));
  check("composite refuses", scoreCard(out.measurements, out.facts, null).composite.state, "refused");
  check("health unknown keeps the conservative ceiling fact", out.facts.healthCover, "declared-absent");
}

section("QA repair 2026-11-03: retirement funding is measured on total net worth (owner decision)");
{
  // Codex's independent fixture: EPF 30L less a 20L home loan, 6L a year of outgo → 10L ÷ 6L.
  const sheet = [row("EPF", "ASSET", "RETIREMENT", 3000000), row("Home loan", "LIABILITY", "LOAN", 2000000)];
  const out = await measure(world({ sheet, service: new Map([[IDS["Home loan"], rupees(20000)]]) }));
  check("EPF 30L − home loan 20L over 6L a year", Number(value(out.measurements.get("independence-multiple"))).toFixed(7), "1.6666667");
  const plain = await measure(world({ sheet: [row("Friend", "ASSET", "SAVINGS", 1200000)], service: new Map() }));
  check("a non-retirement asset counts too: 12L ÷ 6L", value(plain.measurements.get("independence-multiple")), 2);
  const underwater = await measure(world({ sheet: [row("Home loan", "LIABILITY", "LOAN", 1200000)], service: new Map([[IDS["Home loan"], rupees(20000)]]) }));
  check("negative net worth is measured as a negative multiple, not clamped or refused", value(underwater.measurements.get("independence-multiple")), -2);
  const usd: AccountBalance = { ...row("Paid-off card", "ASSET", "SAVINGS", 0), name: "US brokerage", balance: Money.fromRupees("1000", Currency.of("USD")) };
  const foreign = await measure(world({ sheet: [...world().sheet, usd] }));
  check("a foreign-currency balance makes it unknown", foreign.measurements.get("independence-multiple")?.state, "unknown");
  checkTrue("…naming the account and saying nothing is converted", reason(foreign.measurements.get("independence-multiple")).includes("US brokerage") && reason(foreign.measurements.get("independence-multiple")).includes("no conversion"));
  const zeroUsd: AccountBalance = { ...usd, balance: Money.zero(Currency.of("USD")) };
  check("a zero foreign balance changes nothing", value((await measure(world({ sheet: [...world().sheet, zeroUsd] }))).measurements.get("independence-multiple")), 1.65);
}

section("QA repair 2026-11-03: 48 complete months of valid large money are measured exactly");
{
  // Codex's reproduction: each month's income 900719925474099.00, expense 50,000. Made-up.
  const flows = new Map<string, MonthlyFlow>();
  let cursor = on("2026-09-01").plusMonths(-47);
  for (let i = 0; i < 48; i += 1) {
    flows.set(cursor.toMonthKey(), { month: cursor.toMonthKey(), income: Money.fromRupees("900719925474099.00"), expense: rupees(50000) });
    cursor = cursor.plusMonths(1);
  }
  const out = await measure(world({ flows }));
  const m = out.measurements;
  check("savings rate measured: every window equal, ties count half", value(m.get("savings-rate")), 0.5);
  check("income stability measured: zero variation, 1", value(m.get("income-stability")), 1);
  // 20,500.00 ÷ 900719925474099.00 rounded once to the nearest double (checked with Python's
  // fractions.Fraction). A float division of the two amounts gives …712e-11: the defect.
  check("debt service measured exactly", value(m.get("debt-service-ratio")), 2.2759572004815716e-11);
  checkTrue("every ratio is finite", [...m.values()].every((x) => x.state !== "measured" || Number.isFinite(Number(x.value))));
  const big = (index: number) => Money.fromRupees(index % 2 === 0 ? "800000000000000.00" : "1200000000000000.00");
  const varied = new Map<string, MonthlyFlow>();
  cursor = on("2026-09-01").plusMonths(-47);
  for (let i = 0; i < 48; i += 1) {
    // Prior ±10%, last year ±20%: the CV doubles at any scale, so the standing is 0.5 exactly.
    const income = i < 36 ? Money.fromRupees(i % 2 === 0 ? "900000000000000.00" : "1100000000000000.00") : big(i);
    varied.set(cursor.toMonthKey(), { month: cursor.toMonthKey(), income, expense: rupees(50000) });
    cursor = cursor.plusMonths(1);
  }
  check("income CV doubled at a huge scale: still exactly 0.5", value((await measure(world({ flows: varied }))).measurements.get("income-stability")), 0.5);
  const source = (await import("node:fs")).readFileSync("src/app/standing.usecases.ts", "utf8");
  check("no toMinorNumber left in the measurements", /toMinorNumber/.test(source), false);
}

section("QA repair 2026-11-03: foreign cash exclusion is stated, not silent");
{
  const out = await measure(world());
  checkTrue("a limitation names the exclusion", out.limitations.some((text) => text.includes("another currency") && text.includes("not converted")));
  const view = buildStandingView({ card: scoreCard(out.measurements, out.facts, null), measurements: out.measurements, previous: null, oldestInput: out.oldestInput, today, limitations: out.limitations });
  checkDeep("the view carries it to the screen", view.limitations, out.limitations);
  const usdCash = await measure(world({ liquid: Money.fromRupees("1000", Currency.of("USD")) }));
  check("a port returning USD cash against INR outgo: runway unknown, not a crash", usdCash.measurements.get("runway-months")?.state, "unknown");
  checkTrue("…saying no conversion is made", reason(usdCash.measurements.get("runway-months")).includes("no conversion"));
}

done();
