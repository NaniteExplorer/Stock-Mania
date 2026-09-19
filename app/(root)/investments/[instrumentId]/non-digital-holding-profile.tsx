import { Pill } from "@/ui/primitives";

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
      <section className="panel mb-6 p-5" aria-labelledby="holding-data-quality-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="holding-data-quality-heading" className="text-sm font-semibold text-gray-100">
              Valuation data quality
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-gray-500">
              Price status and provenance for the performance figures on this page.
            </p>
          </div>
          <Pill tone="neutral">{status}</Pill>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Valuation basis" value={copy.valuation} />
          <Fact label="Observation date" value={props.pricedOn ?? "No usable observation"} />
          <Fact label="Price reference" value={props.quoteRef ?? "Instrument symbol fallback"} mono />
          <Fact label="Native currency" value={props.currency} mono />
        </dl>
        {(props.unpricedReason || props.isStale) && (
          <p className="mt-4 rounded-lg border border-amber-600/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
            {props.unpricedReason ?? "The latest stored observation is stale. Performance remains dated to the observation shown above."}
          </p>
        )}
      </section>
    );
  }

  if (props.view === "income-leases") {
    return (
      <section className="panel mb-6 p-5" aria-labelledby="holding-lifecycle-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="holding-lifecycle-heading" className="text-sm font-semibold text-gray-100">
              {copy.lifecycleTitle}
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-gray-500">
              Recorded lifecycle facts only. Unrecorded distributions, coupons or redemptions are not estimated.
            </p>
          </div>
          <Pill tone="neutral">{props.lifecycle.length ? "Terms recorded" : "Terms incomplete"}</Pill>
        </div>
        {props.lifecycle.length ? (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {props.lifecycle.map((fact) => <Fact key={fact.label} label={fact.label} value={fact.value} />)}
          </dl>
        ) : (
          <p className="mt-4 rounded-lg border border-gray-600 px-3 py-3 text-xs text-gray-500">
            No asset-specific income or maturity terms are recorded for this instrument. Activity remains available from the ledger and corporate-action history.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="panel mb-6 p-5" aria-labelledby="holding-profile-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="holding-profile-heading" className="text-sm font-semibold text-gray-100">{copy.title}</h2>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">{copy.description}</p>
        </div>
        <Pill tone="neutral">{props.kindLabel}</Pill>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={props.family === "FUND" ? "Scheme code" : "Exchange"} value={props.family === "FUND" ? (props.quoteRef ?? "Not recorded") : (props.exchange ?? "Not recorded")} mono />
        <Fact label="ISIN" value={props.isin ?? "Not recorded"} mono />
        <Fact label="Platform" value={props.platform ?? "Unassigned"} />
        <Fact label="Position records" value={`${props.openLots} open lot${props.openLots === 1 ? "" : "s"} / ${props.tradeCount} trade${props.tradeCount === 1 ? "" : "s"}`} />
      </dl>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-gray-600 pt-3 text-xs text-gray-500">
        <span>{props.corporateActionCount} corporate action{props.corporateActionCount === 1 ? "" : "s"} recorded</span>
        <span>Valuation: {props.pricedOn ? `${props.pricedOn}${props.isStale ? " (stale)" : ""}` : "unavailable"}</span>
        <span>Currency: {props.currency}</span>
      </div>
    </section>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-600 p-4">
      <dt className="metric-label">{label}</dt>
      <dd className={`mt-2 break-words text-sm font-medium text-gray-200${mono ? " tnum" : ""}`}>{value}</dd>
    </div>
  );
}
