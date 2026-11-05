import type { GoldBenchmarkComparison } from "@/app/gold-benchmark.usecases";
import { Panel } from "../../../../components/ui/page-shell";
import { Banner } from "../../../../components/ui/banner";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";
import { FigureCell, FigureText } from "../../../../components/ui/data-cell";
import { XirrValue } from "./gold-xirr";

/**
 * The same rupees, on the same dates, into each alternative — post-tax.
 *
 * Two strings carry the honesty of this table and are therefore **not**
 * optional:
 *
 *   - `basis` renders under the table, verbatim. The replay excludes sales and
 *     lease credits from every row, ACTUAL included, so each line answers the
 *     same question — which means the ACTUAL row's XIRR is a *different figure*
 *     from the page's headline XIRR. Without `basis` the table misleads.
 *   - every `unavailable` entry renders with its `because` text, prominently.
 *     SGB appears there: no keyless feed exists, and an absent row with no
 *     reason reads as an opinion about SGB rather than a gap in the data.
 */
export default function GoldBenchmarkTable({
  comparison,
}: {
  comparison: GoldBenchmarkComparison;
}) {
  const { rows, unavailable, basis, assumptions } = comparison;

  return (
    <Panel
      title="Was digital gold the right vehicle?"
      description="Your own dated outflows replayed into each alternative, taxed at the holding period each dated purchase implies."
      actions={<span className="text-xs text-(--fg-muted)">as of {comparison.asOf.toISO()}</span>}
    >
      {unavailable.length > 0 && (
        <Banner tone="warning" title="Not compared, and why">
          <ul className="space-y-2">
            {unavailable.map((entry) => (
              <li key={entry.key} className="text-xs">
                <span className="font-medium">{entry.label}</span> — {entry.because}
              </li>
            ))}
          </ul>
        </Banner>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-(--fg-muted)">
          Nothing to replay: no dated purchase outflows are recorded for this holding yet.
        </p>
      ) : (
        <Table>
          <TableCaption className="sr-only">
            Post-tax terminal wealth and post-tax money-weighted return of the same dated
            outflows in each vehicle, against this holding
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Vehicle</TableHead>
              <TableHead className="text-right">Invested</TableHead>
              <TableHead className="text-right">Terminal value</TableHead>
              <TableHead className="text-right">Tax due</TableHead>
              <TableHead className="text-right">Post-tax value</TableHead>
              <TableHead className="text-right">Post-tax XIRR</TableHead>
              <TableHead className="text-right">vs this holding</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key} data-baseline={row.key === "ACTUAL" || undefined}>
                <TableHead scope="row" className="font-normal">
                  <span className={row.key === "ACTUAL" ? "font-semibold text-(--fg)" : "font-medium text-(--fg)"}>
                    {row.label}
                  </span>
                  <span className="mt-1 block text-xs text-(--fg-muted)">{row.entryCostNote}</span>
                </TableHead>
                <FigureCell value={row.invested} />
                {row.terminalValue ? (
                  <FigureCell value={row.terminalValue} />
                ) : (
                  <TableCell className="text-right text-xs text-(--fg-muted)">Not priced</TableCell>
                )}
                <TableCell className="text-right">
                  {row.taxDue ? (
                    <span className="tnum text-(--warn)">−{row.taxDue.toDecimalString()}</span>
                  ) : (
                    <span className="text-xs text-(--fg-muted)">—</span>
                  )}
                  {row.tax && (
                    <span className="mt-1 block text-xs text-(--fg-muted)">{row.tax.note}</span>
                  )}
                </TableCell>
                {row.postTaxTerminalValue ? (
                  <FigureCell value={row.postTaxTerminalValue} />
                ) : (
                  <TableCell className="text-right text-xs text-(--fg-muted)">Not priced</TableCell>
                )}
                <TableCell className="text-right">
                  <XirrValue value={row.postTaxXirr} size="sm" />
                </TableCell>
                <TableCell className="text-right">
                  {row.key === "ACTUAL" ? (
                    <span className="text-xs text-(--fg-muted)">baseline</span>
                  ) : row.versusHolding ? (
                    <FigureText value={row.versusHolding} tone="change" />
                  ) : (
                    <span className="text-xs text-(--fg-muted)">Not comparable</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div>
        <h3 className="text-sm font-semibold text-(--fg)">What this table is, exactly</h3>
        <p className="mt-2 whitespace-pre-line text-xs text-(--fg-secondary)">{basis}</p>
        <p className="mt-3 text-xs text-(--fg-muted)">
          Physical-gold assumptions: {assumptions.metalGstPercent.toFixed(2)}% GST on metal,{" "}
          {assumptions.makingChargePercent.toFixed(2)}% making charge taxed at{" "}
          {assumptions.makingGstPercent.toFixed(2)}%, {assumptions.coinPremiumPercent.toFixed(2)}%
          coin premium, resale discounted{" "}
          {assumptions.resalePurityDiscountPercent.toFixed(2)}% on jewellery and{" "}
          {assumptions.coinResaleDiscountPercent.toFixed(2)}% on coins. Fund entry costs:{" "}
          {assumptions.etfEntryCostPercent.toFixed(2)}% ETF,{" "}
          {assumptions.equityEntryCostPercent.toFixed(2)}% index. FD at{" "}
          {assumptions.fdAnnualRatePercent.toFixed(2)}% p.a. Slab income taxed at{" "}
          {assumptions.slabRatePercent.toFixed(2)}%, which is your assumption and not a
          regime lookup.
        </p>
      </div>
    </Panel>
  );
}
