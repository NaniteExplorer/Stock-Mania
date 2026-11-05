import type { GoldAnalytics } from "@/app/gold-analytics.usecases";
import { Panel } from "../../../../components/ui/page-shell";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";
import { FigureCell, FigureText } from "../../../../components/ui/data-cell";

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
    <Panel
      title="Lots, and when each turns long-term"
      description={
        threshold === null
          ? `No shipped tax regime gives ${category} a long-term holding period on ${analytics.asOf.toISO()}, so no lot below can be counted down to one.`
          : `Long-term after more than ${threshold} days held, for ${category}, on ${analytics.asOf.toISO()}. Day ${threshold} is still short-term — the rule is strictly greater, so eligibility starts the day after.`
      }
      actions={<span className="text-xs text-(--fg-muted)">{rows.length} open lot{rows.length === 1 ? "" : "s"}</span>}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-(--fg-muted)">
          No open lots. A purchase or a lease credit creates one.
        </p>
      ) : (
        <Table>
            <TableCaption className="sr-only">
              Open lots with acquisition date, grams remaining, cost per gram, unrealised
              gain against cash paid, origin, holding period and long-term eligibility date
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Acquired</TableHead>
                <TableHead className="text-right">{unit}</TableHead>
                <TableHead className="text-right">Cost / {unit.toLowerCase()}</TableHead>
                <TableHead className="text-right">Invested</TableHead>
                <TableHead className="text-right">Unrealised</TableHead>
                <TableHead>Origin</TableHead>
                <TableHead className="text-right">Days held</TableHead>
                <TableHead>Long-term</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.lotId} className="border-b border-(--border)/50 align-top last:border-0">
                  <TableHead scope="row" className="tnum font-normal text-(--fg-secondary)">
                    {row.acquiredOn.toISO()}
                  </TableHead>
                  <TableCell className="tnum text-right text-(--fg)">
                    {row.grams.toDecimalString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.costPerGram ? (
                      <FigureText value={row.costPerGram.toMoney()} />
                    ) : (
                      <span className="text-xs text-(--fg-muted)">No cash paid</span>
                    )}
                  </TableCell>
                  <FigureCell value={row.investedCost} />
                  <TableCell className="text-right">
                    {row.unrealised ? (
                      <FigureText value={row.unrealised} tone="change" />
                    ) : (
                      <span className="text-xs text-(--fg-muted)">Unpriced</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.origin === "LEASE_CREDIT" ? (
                      <span className="text-(--warn)">Lease credit</span>
                    ) : (
                      <span className="text-(--fg-secondary)">Purchase</span>
                    )}
                  </TableCell>
                  <TableCell className="tnum text-right text-(--fg-secondary)">{row.holdingDays}</TableCell>
                  <TableCell className="text-xs">
                    {row.isLongTerm ? (
                      <span className="text-(--gain)">
                        Eligible{row.longTermOn ? ` since ${row.longTermOn.toISO()}` : ""}
                      </span>
                    ) : row.longTermOn ? (
                      <span className="text-(--fg-secondary)">
                        {row.longTermOn.toISO()}
                        {row.daysToLongTerm === null ? "" : ` · ${row.daysToLongTerm}d to go`}
                      </span>
                    ) : (
                      <span className="text-(--fg-muted)">
                        No long-term treatment for {category}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
      )}

      <p className="mt-3 text-xs text-(--fg-muted)">
        Unrealised is measured against cash actually paid, so a lease-credited lot is worth
        pure profit and reports no cost per {unit.toLowerCase()} — `null`, not zero, because a
        credit had no price. These rows therefore sum to the profit above, not to the
        book-basis figure.
      </p>
    </Panel>
  );
}
