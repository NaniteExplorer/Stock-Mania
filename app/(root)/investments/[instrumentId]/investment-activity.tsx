import Link from "next/link";
import type { InvestmentEvent } from "@/domain/investment-activity";
import { Panel } from "../../../../components/ui/page-shell";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";
import { FigureCell, FigureText } from "../../../../components/ui/data-cell";

/**
 * The full record behind one holding: what was entered, what it cost, and what
 * the ledger wrote.
 *
 * The tables above this one are summaries — they answer "how big is the position"
 * and deliberately show one `Charges` figure. This answers the other question, the
 * one a contract note answers: which charge, how much, against which account. It
 * renders the same way for every kind of investment because its data comes from
 * the holding's own account rather than from the trade book, so a dividend, a
 * lease payout and a purchase are all just events with different legs.
 */
export default function InvestmentActivity({
  events,
  unit,
}: {
  events: readonly InvestmentEvent[];
  /** What one unit is called here — `g` for metal, blank for units. */
  unit?: string;
}) {
  if (events.length === 0) {
    return (
      <Panel title="Transaction details">
        <p className="text-sm text-(--fg-muted)">
          Nothing has been posted against this holding yet. Once a purchase, a sale or an
          income event is recorded, every leg of it is listed here.
        </p>
      </Panel>
    );
  }

  // Newest first: the question asked of this panel is almost always about the
  // most recent entry, and the summary tables above already read oldest-first.
  const ordered = [...events].reverse();

  return (
    <Panel
      title="Transaction details"
      description="Every event recorded against this holding, with its charges itemised and both sides of the journal entry it wrote."
      actions={<span className="text-xs text-(--fg-muted)">{ordered.length} events</span>}
    >
      <ul className="divide-y divide-(--border)/50">
        {ordered.map((event) => (
          <li key={event.transactionId} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="tnum text-xs text-(--fg-secondary)">{event.on.toISO()}</span>
                <EventKind event={event} />
                <span className="text-sm text-(--fg)">{event.description}</span>
              </div>
              <div className="text-right">
                <FigureText value={event.netToHolding} tone="change" />
                <p className="text-[11px] text-(--fg-muted)">
                  {event.kind === "INCOME" ? "Income earned" : "Movement on this holding"}
                </p>
              </div>
            </div>

            {event.quantity && event.pricePerUnit && (
              <p className="mt-2 text-xs text-(--fg-secondary)">
                <span className="tnum text-(--fg)">
                  {event.quantity.toDecimalString()}
                  {unit ?? ""}
                </span>{" "}
                at <FigureText value={event.pricePerUnit} /> each
                {event.consideration && (
                  <>
                    {" "}
                    = <FigureText value={event.consideration} /> before charges
                  </>
                )}
              </p>
            )}

            {event.charges.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {event.charges.map((charge) => (
                  <span
                    key={charge.label}
                    className="rounded-full border border-(--border) px-2 py-0.5 text-[11px] text-(--fg-secondary)"
                  >
                    {charge.label} <FigureText value={charge.amount} />
                  </span>
                ))}
                <span className="text-[11px] text-(--fg-muted)">
                  total <FigureText value={event.chargeTotal} />
                </span>
              </div>
            )}

            {/*
             * The charge line is omitted rather than shown as zero for a trade
             * that carried none. A row of eight zeroes reads as a broker that
             * charges nothing, which is a claim this screen has no business
             * making about a holding whose charges were simply never recorded.
             */}
            {event.kind === "TRADE" && event.charges.length === 0 && (
              <p className="mt-2 text-[11px] text-(--fg-muted)">
                No charges were recorded against this trade.
              </p>
            )}

            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-brand-400 hover:underline">
                Journal entry — {event.postings.length} postings
              </summary>
              <div className="mt-2">
                <Table density="compact">
                  <TableCaption className="sr-only">
                    Journal postings for {event.description}
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        Account
                      </TableHead>
                      <TableHead>
                        Side
                      </TableHead>
                      <TableHead className="text-right">
                        Amount
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {event.postings.map((posting, index) => (
                      <TableRow
                        key={`${event.transactionId}-${index}`}
                        className="border-b border-(--border)/40 last:border-0"
                      >
                        <TableCell>
                          <span className="text-(--fg)">{posting.accountName}</span>
                          <span className="ml-2 text-[11px] text-(--fg-muted)">
                            {posting.accountCode}
                          </span>
                          {posting.memo && (
                            <p className="text-[11px] text-(--fg-muted)">{posting.memo}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-(--fg-secondary)">
                          {posting.direction === "DEBIT" ? "Debit" : "Credit"}
                        </TableCell>
                        <FigureCell value={posting.amount} />
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>

            <p className="mt-2 text-[11px] text-(--fg-muted)">
              {sourceLabel(event.origin.source)}
              {event.origin.reference && <> · ref {event.origin.reference}</>}
              {event.origin.importBatchId && (
                <>
                  {" · "}
                  <Link
                    href={`/imports/${event.origin.importBatchId}`}
                    className="text-brand-400 hover:underline"
                  >
                    the import it came from
                  </Link>
                </>
              )}
              <> · entry {event.transactionId.slice(0, 8)}</>
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function EventKind({ event }: { event: InvestmentEvent }) {
  if (event.kind === "TRADE") {
    return (
      <span
        className={
          event.side === "BUY"
            ? "rounded-full border border-(--gain)/50 px-2 py-0.5 text-[11px] text-(--gain)"
            : "rounded-full border border-(--warn)/50 px-2 py-0.5 text-[11px] text-(--warn)"
        }
      >
        {event.side === "BUY" ? "Bought" : "Sold"}
      </span>
    );
  }
  return (
    <span className="rounded-full border border-(--border) px-2 py-0.5 text-[11px] text-(--fg-secondary)">
      {event.kind === "INCOME" ? "Income" : "Adjustment"}
    </span>
  );
}

/** `MANUAL` is how it is stored; "entered by hand" is what it means. */
function sourceLabel(source: string): string {
  switch (source) {
    case "MANUAL":
      return "Entered by hand";
    case "IMPORT":
      return "From an import";
    case "SYSTEM":
      return "Written by the app";
    default:
      return source;
  }
}
