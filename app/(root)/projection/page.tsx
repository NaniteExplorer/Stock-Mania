import type { Metadata } from "next";
import type { Money } from "@/core/money";
import type { Assumption } from "@/domain/projection/assumptions";
import { services } from "@/infra/container";
import { Banner } from "@/components/ui/banner";
import { FORM_FIELDS, percentText } from "./assumptions-form";
import AssumptionsForm, { type AssumptionFieldView } from "./assumptions-form-view";
import { buildProjectionView } from "./projection-model";
import { ProjectionScreen } from "./projection-view";

export const metadata: Metadata = { title: "Projection" };

const UNITS: Record<string, string> = { years: "years", percent: "%", rupees: "₹ a month", count: "years" };

function fieldText(a: Assumption, kind: string): string {
  if (a.value === null) return "";
  if (kind === "percent") return percentText(a.value as number);
  if (kind === "rupees") return (a.value as Money).toDecimalString();
  return String(a.value);
}

function sourceNote(a: Assumption): string {
  const s = a.source;
  if (s === null) return "";
  const who = s.kind === "OWNER" ? "You" : s.kind === "CITED" ? `Cited: ${s.citation.title}` : s.kind === "VENDOR" ? `Vendor: ${s.vendor}` : s.method;
  if (!a.regulatory) return who;
  return a.verifiedOn ? `${who} · verified ${a.verifiedOn.toString()}` : `${who} · not verified`;
}

/**
 * Corpus against age as a fan of replayed scenarios (DESIGN §8.2).
 *
 * The assumption set is loaded from storage for the signed-in owner. The gate
 * measurements, the returns series and the target are still not persisted
 * (follow-up), so the model keeps refusing and names each cause; it never draws
 * a fan with a default substituted.
 */
export default async function Page() {
  const { userId, load } = await services().projection();
  const loaded = await load.execute({ userId });
  if (!loaded.ok) throw loaded.error;
  const { assumptions, saved, dropped } = loaded.value;

  const view = buildProjectionView({
    assumptions,
    assumptionsSaved: saved,
    gate: null,
    hasInvestments: true,
    startWealth: null,
    returns: [],
    target: null,
    assumptionsChanged: false,
  });
  const fields: AssumptionFieldView[] = FORM_FIELDS.map((f) => {
    const a = assumptions.get(f.key);
    return { key: f.key, label: a.label, unit: UNITS[f.kind], text: fieldText(a, f.kind), sourceNote: sourceNote(a) };
  });
  const nps = assumptions.get("npsAnnuityShareNonGovt").verifiedOn ?? assumptions.get("npsAnnuityShareGovt").verifiedOn;

  return (
    <ProjectionScreen view={view}>
      {dropped.length > 0 && (
        <Banner tone="warning" role="alert" title="These stored values no longer fit and are treated as unknown:">
          <ul className="list-disc pl-5">{dropped.map((d) => <li key={d}>{d}</li>)}</ul>
        </Banner>
      )}
      <AssumptionsForm fields={fields} currentAge={assumptions.get("currentAge").value} npsVerifiedOn={nps?.toString() ?? ""} />
    </ProjectionScreen>
  );
}
