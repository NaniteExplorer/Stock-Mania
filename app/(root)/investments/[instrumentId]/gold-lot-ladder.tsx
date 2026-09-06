import type { GoldAnalytics } from "@/app/gold-analytics.usecases";
import { MoneyText } from "@/ui/primitives";

/**
 * Every open lot, oldest first, with the day it turns long-term and how far off
 * that is.
 *
 * The threshold is the regime's, not a literal: a category with no long-term
 * treatment reports `longTermOn: null` and this table says so rather than
 * counting down to a day that never arrives.
 */
export default function GoldLotLadder({
  analytics,
  unit,
}: {
  analytics: GoldAnalytics;
  unit: string;
}) {
  const rows = analytics.lotLadder;
  const threshold = analytics.taxThresholdDays;
  const category = analytics.taxCategory.replace(/_/g, " ").toLowerCase();

  return (
    <section className="panel mb-6 p-0" aria-labelledby="gold-ladder-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-600 px-5 py-4">
        <div>
          <h2 id="gold-ladder-heading" className="text-sm font-semibold text-gray-100">
            Lots, and when each turns long-term
          </h2>
          <p className="mt-1 max-w-xl text-xs text-gray-500">
            {threshold === null
              ? `No shipped tax regime gives ${category} a long-term holding period on ${analytics.asOf.toISO()}, so no lot below can be counted down to one.`
              : `Long-term after more than ${threshold} days held, for ${category}, on ${analytics.asOf.toISO()}. Day ${threshold} is still short-term — the rule is strictly greater, so eligibility starts the day after.`}
          </p>
        </div>
        <span className="pill">{rows.length} open lot{rows.length === 1 ? "" : "s"}</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-500">
          No open lots. A purchase or a lease credit creates one.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Open lots with acquisition date, grams remaining, cost per gram, unrealised
              gain against cash paid, origin, holding period and long-term eligibility date
            </caption>
            <thead>
              <tr className="border-b border-gray-600">
                <th scope="col" className="metric-label px-4 py-3 text-left">Acquired</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">{unit}</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Cost / {unit.toLowerCase()}</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Invested</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Unrealised</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Origin</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Days held</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Long-term</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.lotId} className="border-b border-gray-600/50 align-top last:border-0">
                  <th scope="row" className="tnum px-4 py-3 text-left font-normal text-gray-400">
                    {row.acquiredOn.toISO()}
                  </th>
                  <td className="tnum px-4 py-3 text-right text-gray-200">
                    {row.grams.toDecimalString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.costPerGram ? (
                      <MoneyText value={row.costPerGram.toMoney()} tone="neutral" />
                    ) : (
                      <span className="text-xs text-gray-500">No cash paid</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <MoneyText value={row.investedCost} tone="neutral" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.unrealised ? (
                      <MoneyText value={row.unrealised} />
                    ) : (
                      <span className="text-xs text-gray-500">Unpriced</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {row.origin === "LEASE_CREDIT" ? (
                      <span className="text-amber-500">Lease credit</span>
                    ) : (
                      <span className="text-gray-400">Purchase</span>
                    )}
                  </td>
                  <td className="tnum px-4 py-3 text-right text-gray-400">{row.holdingDays}</td>
                  <td className="px-4 py-3 text-xs">
                    {row.isLongTerm ? (
                      <span className="text-green-500">
                        Eligible{row.longTermOn ? ` since ${row.longTermOn.toISO()}` : ""}
                      </span>
                    ) : row.longTermOn ? (
                      <span className="text-gray-400">
                        {row.longTermOn.toISO()}
                        {row.daysToLongTerm === null ? "" : ` · ${row.daysToLongTerm}d to go`}
                      </span>
                    ) : (
                      <span className="text-gray-500">
                        No long-term treatment for {category}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="border-t border-gray-600 px-5 py-3 text-xs text-gray-500">
        Unrealised is measured against cash actually paid, so a lease-credited lot is worth
        pure profit and reports no cost per {unit.toLowerCase()} — `null`, not zero, because a
        credit had no price. These rows therefore sum to the profit above, not to the
        book-basis figure.
      </p>
    </section>
  );
}
