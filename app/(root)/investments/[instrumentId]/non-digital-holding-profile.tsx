import { Panel } from "../../../../components/ui/page-shell";
import { InstitutionMark } from "@/ui/provider-picker";

export type NonDigitalHoldingFamily = "EQUITY" | "FUND" | "FIXED_INCOME";

export interface NonDigitalHoldingProfileProps {
  family: NonDigitalHoldingFamily;
  kindLabel: string;
  currency: string;
  exchange: string | null;
  isin: string | null;
  quoteRef: string | null;
  platform: string | null;
  openLots: number;
  tradeCount: number;
  corporateActionCount: number;
  pricedOn: string | null;
  isStale: boolean;
  unpricedReason: string | null;
  lifecycle: readonly { label: string; value: string }[];
  view: "summary" | "performance" | "income-leases";
}

const FAMILY_COPY: Record<
  NonDigitalHoldingFamily,
  { title: string; description: string; valuation: string; lifecycleTitle: string }
> = {
  EQUITY: {
    title: "Listed security profile",
    description: "Position identity, trading venue and corporate-action coverage for this listed holding.",
    valuation: "Exchange close or the latest stored provider observation",
    lifecycleTitle: "Ownership record",
  },
  FUND: {
    title: "Fund holding profile",
    description: "Scheme identity, unit history and NAV coverage for this fund holding.",
    valuation: "Latest stored NAV observation",
    lifecycleTitle: "Scheme record",
  },
  FIXED_INCOME: {
    title: "Fixed-income profile",
    description: "Security identity, recorded terms and maturity context for this debt holding.",
    valuation: "Latest stored security price; not accrued interest or a maturity projection",
    lifecycleTitle: "Security lifecycle",
  },
};

export default function NonDigitalHoldingProfile(props: NonDigitalHoldingProfileProps) {
  const copy = FAMILY_COPY[props.family];
  const status = !props.pricedOn ? "Unavailable" : props.isStale ? "Stale" : "Available";

  if (props.view === "performance") {
    return (
      <Panel
        title="Valuation data quality"
        description="Price status and provenance for the performance figures on this page."
        actions={<span className="text-xs text-(--fg-muted)">{status}</span>}
      >
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Valuation basis" value={copy.valuation} />
          <Fact label="Observation date" value={props.pricedOn ?? "No usable observation"} />
          <Fact label="Price reference" value={props.quoteRef ?? "Instrument symbol fallback"} mono />
          <Fact label="Native currency" value={props.currency} mono />
        </dl>
        {(props.unpricedReason || props.isStale) && (
          <p className="mt-4 rounded-lg border border-(--warn)/40 bg-(--warn)/5 px-3 py-2 text-xs text-(--warn)">
            {props.unpricedReason ?? "The latest stored observation is stale. Performance remains dated to the observation shown above."}
          </p>
        )}
      </Panel>
    );
  }

  if (props.view === "income-leases") {
    return (
      <Panel
        title={copy.lifecycleTitle}
        description="Recorded lifecycle facts only. Unrecorded distributions, coupons or redemptions are not estimated."
        actions={<span className="text-xs text-(--fg-muted)">{props.lifecycle.length ? "Terms recorded" : "Terms incomplete"}</span>}
      >
        {props.lifecycle.length ? (
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {props.lifecycle.map((fact) => <Fact key={fact.label} label={fact.label} value={fact.value} />)}
          </dl>
        ) : (
          <p className="mt-4 rounded-lg border border-(--border) px-3 py-3 text-xs text-(--fg-muted)">
            No asset-specific income or maturity terms are recorded for this instrument. Activity remains available from the ledger and corporate-action history.
          </p>
        )}
      </Panel>
    );
  }

  return (
    <Panel
      title={copy.title}
      description={copy.description}
      actions={<span className="text-xs text-(--fg-muted)">{props.kindLabel}</span>}
    >
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={props.family === "FUND" ? "Scheme code" : "Exchange"} value={props.family === "FUND" ? (props.quoteRef ?? "Not recorded") : (props.exchange ?? "Not recorded")} mono />
        <Fact label="ISIN" value={props.isin ?? "Not recorded"} mono />
        <Fact label="Platform" value={props.platform ?? "Unassigned"} institution={props.platform} />
        <Fact label="Position records" value={`${props.openLots} open lot${props.openLots === 1 ? "" : "s"} / ${props.tradeCount} trade${props.tradeCount === 1 ? "" : "s"}`} />
      </dl>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-(--border) pt-3 text-xs text-(--fg-muted)">
        <span>{props.corporateActionCount} corporate action{props.corporateActionCount === 1 ? "" : "s"} recorded</span>
        <span>Valuation: {props.pricedOn ? `${props.pricedOn}${props.isStale ? " (stale)" : ""}` : "unavailable"}</span>
        <span>Currency: {props.currency}</span>
      </div>
    </Panel>
  );
}

function Fact({
  label,
 value,
  mono = false,
  institution,
}: {
  label: string;
 value: string;
  mono?: boolean;
  /** A stored platform or institution name: its mark sits beside the value (DESIGN.md §9). */
  institution?: string | null;
}) {
  return (
    <div className="rounded-lg border border-(--border) p-4">
      <dt className="text-xs font-medium text-(--fg-muted)">{label}</dt>
      <dd className={`mt-2 break-words text-sm font-medium text-(--fg)${mono ? " tnum" : ""}`}>
        {institution ? (
          <span className="flex items-center gap-2">
            <InstitutionMark institution={institution} />
            {value}
          </span>
        ) : (
         value
        )}
      </dd>
    </div>
  );
}
