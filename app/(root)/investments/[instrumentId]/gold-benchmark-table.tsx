import type { GoldBenchmarkComparison } from "@/app/gold-benchmark.usecases";
import { MoneyText } from "@/ui/primitives";
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
    <section className="panel mb-6 p-0" aria-labelledby="gold-benchmark-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-600 px-5 py-4">
        <div>
          <h2 id="gold-benchmark-heading" className="text-sm font-semibold text-gray-100">
            Was digital gold the right vehicle?
          </h2>
          <p className="mt-1 max-w-xl text-xs text-gray-500">
            Your own dated outflows replayed into each alternative, taxed at the holding
            period each dated purchase implies.
          </p>
        </div>
        <span className="pill">as of {comparison.asOf.toISO()}</span>
      </div>

      {unavailable.length > 0 && (
        <div className="border-b border-gray-600 px-5 py-4">
          <h3 className="metric-label">Not compared, and why</h3>
          <ul className="mt-2 space-y-2">
            {unavailable.map((entry) => (
              <li
                key={entry.key}
                className="rounded-lg border border-amber-600/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-500"
              >
                <span className="font-medium">{entry.label}</span> — {entry.because}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-500">
          Nothing to replay: no dated purchase outflows are recorded for this holding yet.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Post-tax terminal wealth and post-tax money-weighted return of the same dated
              outflows in each vehicle, against this holding
            </caption>
            <thead>
              <tr className="border-b border-gray-600">
                <th scope="col" className="metric-label px-4 py-3 text-left">Vehicle</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Invested</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Terminal value</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Tax due</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Post-tax value</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Post-tax XIRR</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">vs this holding</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={
                    row.key === "ACTUAL"
                      ? "border-b border-gray-600/50 bg-gray-700/30 align-top last:border-0"
                      : "border-b border-gray-600/50 align-top last:border-0"
                  }
                >
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <span
                      className={
                        row.key === "ACTUAL"
                          ? "font-semibold text-gray-100"
                          : "font-medium text-gray-200"
                      }
                    >
                      {row.label}
                    </span>
                    <span className="mt-1 block text-xs text-gray-500">{row.entryCostNote}</span>
                  </th>
                  <td className="px-4 py-3 text-right">
                    <MoneyText value={row.invested} tone="neutral" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.terminalValue ? (
                      <MoneyText value={row.terminalValue} tone="neutral" />
                    ) : (
                      <span className="text-xs text-gray-500">Not priced</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.taxDue ? (
                      <span className="tnum text-amber-500">−{row.taxDue.toDecimalString()}</span>
                    ) : (
                      <span className="text-xs text-gray-500">—</span>
                    )}
                    {row.tax && (
                      <span className="mt-1 block text-xs text-gray-500">{row.tax.note}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.postTaxTerminalValue ? (
                      <MoneyText value={row.postTaxTerminalValue} tone="neutral" />
                    ) : (
                      <span className="text-xs text-gray-500">Not priced</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <XirrValue value={row.postTaxXirr} size="sm" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.key === "ACTUAL" ? (
                      <span className="text-xs text-gray-500">baseline</span>
                    ) : row.versusHolding ? (
                      <MoneyText value={row.versusHolding} />
                    ) : (
                      <span className="text-xs text-gray-500">Not comparable</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-gray-600 px-5 py-4">
        <h3 className="metric-label">What this table is, exactly</h3>
        <p className="mt-2 whitespace-pre-line text-xs text-gray-400">{basis}</p>
        <p className="mt-3 text-xs text-gray-500">
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
    </section>
  );
}
