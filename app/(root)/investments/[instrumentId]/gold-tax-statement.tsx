import type { GoldAnalytics } from "@/app/gold-analytics.usecases";
import { FigureText } from "@/components/ui/data-cell";
import { Panel } from "../../../../components/ui/page-shell";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";

/**
 * What a return filing needs from this holding, by financial year.
 *
 * Lease credits are Income from Other Sources, valued at the buy-back rate on
 * the day they landed — not today's rate and not the benchmark. Each row
 * carries how its credit date was priced, because a `CARRIED` weekend price and
 * an `UNPRICED` gap are different facts and only one of them is safe to file.
 *
 * Realised capital gains are deliberately absent: no term-split realised figure
 * is on the analytics contract, and inventing one from the lot ladder would be
 * arithmetic this component has no business doing.
 */
export default function GoldTaxStatement({
  analytics,
  tdsWithheldGrams,
}: {
  analytics: GoldAnalytics;
  tdsWithheldGrams: string;
}) {
  const rows = analytics.leaseIncomeByFinancialYear;
  const anyUnpriced = rows.some((row) => row.pricedFrom === "UNPRICED");
  const noTds = analytics.tdsGrams.isZero;

  return (
    <Panel
      title="For your return"
      description="Financial years run April to March. Lease credits are Income from Other Sources, valued at the buy-back rate on the credit date."
      actions={<span className="text-xs text-(--fg-muted)">as of {analytics.asOf.toISO()}</span>}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-(--fg-muted)">
          No lease credits have been recorded, so there is no lease income to report for any
          financial year.
        </p>
      ) : (
        <Table>
            <TableCaption className="sr-only">
              Lease income by financial year, in grams and rupees, with how each credit date
              was priced
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Financial year</TableHead>
                <TableHead className="text-right">Grams credited</TableHead>
                <TableHead className="text-right">
                  Income from Other Sources
                </TableHead>
                <TableHead>Priced from</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.financialYear}
                  className="border-b border-(--border)/50 align-top last:border-0"
                >
                  <TableHead scope="row" className="tnum font-normal text-(--fg)">
                    FY {row.financialYear}
                  </TableHead>
                  <TableCell className="tnum text-right text-(--fg-secondary)">
                    {row.grams.toDecimalString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.pricedFrom === "UNPRICED" ? (
                      <span className="text-xs text-(--warn)">Not valued</span>
                    ) : (
                      <FigureText value={row.value} />
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.pricedFrom === "QUOTE" && (
                      <span className="text-(--fg-secondary)">Published rate on the credit date</span>
                    )}
                    {row.pricedFrom === "CARRIED" && (
                      <span className="text-(--fg-secondary)">
                        Last rate published before the credit date — a weekend or holiday credit
                      </span>
                    )}
                    {row.pricedFrom === "UNPRICED" && (
                      <span className="text-(--warn)">
                        No rate existed on or before that date, so the rupee figure is missing
                        rather than estimated
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
      )}

      <dl className="mt-4 grid gap-4 text-xs sm:grid-cols-3">
        <div>
          <dt className="font-medium text-(--fg-muted)">TDS withheld on lease credits</dt>
          <dd className="tnum mt-1 text-(--fg)">{tdsWithheldGrams}g</dd>
          <p className="mt-1 text-(--fg-muted)">
            {noTds
              ? "Your platform withheld nothing, so there is no TDS trail and nothing to claim as a credit. The whole credit is taxable in your hands."
              : "Grams withheld are a tax credit, not a cost — claim them against the income above."}
          </p>
        </div>
        <div>
          <dt className="font-medium text-(--fg-muted)">GST paid on purchases</dt>
          <dd className="mt-1 text-(--fg)">
            {analytics.gstPaid ? (
              <FigureText value={analytics.gstPaid} />
            ) : (
              "Not separable"
            )}
          </dd>
          {!analytics.gstPaid && analytics.gstPaidReason && (
            <p className="mt-1 text-(--fg-muted)">{analytics.gstPaidReason}</p>
          )}
        </div>
        <div>
          <dt className="font-medium text-(--fg-muted)">Realised capital gains</dt>
          <dd className="mt-1 text-(--fg)">Not in this statement</dd>
          <p className="mt-1 text-(--fg-muted)">
            A realised long-term / short-term split is not produced by this holding&apos;s
            analytics, and deriving one here would be a guess at which lots a sale consumed.
            The lot ladder above shows which open lots are already long-term.
          </p>
        </div>
      </dl>

      {anyUnpriced && (
        <p className="mt-3 text-xs text-(--warn)">
          At least one financial year has credits with no rate on or before the credit date.
          Refresh prices, or fill the gap in the rate history, before filing from this
          statement.
        </p>
      )}
    </Panel>
  );
}
