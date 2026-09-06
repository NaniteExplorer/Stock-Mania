import type { GoldAnalytics } from "@/app/gold-analytics.usecases";
import { MoneyText } from "@/ui/primitives";

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
    <section className="panel mb-6 p-0" aria-labelledby="gold-tax-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-600 px-5 py-4">
        <div>
          <h2 id="gold-tax-heading" className="text-sm font-semibold text-gray-100">
            For your return
          </h2>
          <p className="mt-1 max-w-xl text-xs text-gray-500">
            Financial years run April to March. Lease credits are Income from Other Sources,
            valued at the buy-back rate on the credit date.
          </p>
        </div>
        <span className="pill">as of {analytics.asOf.toISO()}</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-500">
          No lease credits have been recorded, so there is no lease income to report for any
          financial year.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Lease income by financial year, in grams and rupees, with how each credit date
              was priced
            </caption>
            <thead>
              <tr className="border-b border-gray-600">
                <th scope="col" className="metric-label px-4 py-3 text-left">Financial year</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Grams credited</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">
                  Income from Other Sources
                </th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Priced from</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.financialYear}
                  className="border-b border-gray-600/50 align-top last:border-0"
                >
                  <th scope="row" className="tnum px-4 py-3 text-left font-normal text-gray-200">
                    FY {row.financialYear}
                  </th>
                  <td className="tnum px-4 py-3 text-right text-gray-300">
                    {row.grams.toDecimalString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.pricedFrom === "UNPRICED" ? (
                      <span className="text-xs text-amber-500">Not valued</span>
                    ) : (
                      <MoneyText value={row.value} tone="neutral" />
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {row.pricedFrom === "QUOTE" && (
                      <span className="text-gray-400">Published rate on the credit date</span>
                    )}
                    {row.pricedFrom === "CARRIED" && (
                      <span className="text-gray-400">
                        Last rate published before the credit date — a weekend or holiday credit
                      </span>
                    )}
                    {row.pricedFrom === "UNPRICED" && (
                      <span className="text-amber-500">
                        No rate existed on or before that date, so the rupee figure is missing
                        rather than estimated
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <dl className="grid gap-4 border-t border-gray-600 px-5 py-4 text-xs sm:grid-cols-3">
        <div>
          <dt className="metric-label">TDS withheld on lease credits</dt>
          <dd className="tnum mt-1 text-gray-200">{tdsWithheldGrams}g</dd>
          <p className="mt-1 text-gray-500">
            {noTds
              ? "Your platform withheld nothing, so there is no TDS trail and nothing to claim as a credit. The whole credit is taxable in your hands."
              : "Grams withheld are a tax credit, not a cost — claim them against the income above."}
          </p>
        </div>
        <div>
          <dt className="metric-label">GST paid on purchases</dt>
          <dd className="mt-1 text-gray-200">
            {analytics.gstPaid ? (
              <MoneyText value={analytics.gstPaid} tone="neutral" />
            ) : (
              "Not separable"
            )}
          </dd>
          {!analytics.gstPaid && analytics.gstPaidReason && (
            <p className="mt-1 text-gray-500">{analytics.gstPaidReason}</p>
          )}
        </div>
        <div>
          <dt className="metric-label">Realised capital gains</dt>
          <dd className="mt-1 text-gray-200">Not in this statement</dd>
          <p className="mt-1 text-gray-500">
            A realised long-term / short-term split is not produced by this holding&apos;s
            analytics, and deriving one here would be a guess at which lots a sale consumed.
            The lot ladder above shows which open lots are already long-term.
          </p>
        </div>
      </dl>

      {anyUnpriced && (
        <p className="border-t border-gray-600 px-5 py-3 text-xs text-amber-500">
          At least one financial year has credits with no rate on or before the credit date.
          Refresh prices, or fill the gap in the rate history, before filing from this
          statement.
        </p>
      )}
    </section>
  );
}
