import Link from "next/link";
import type { InvestmentEvent } from "@/domain/investment-activity";
import { MoneyText, Pill } from "@/ui/primitives";

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
      <section className="panel mb-6 p-5" aria-labelledby="investment-activity-heading">
        <h2 id="investment-activity-heading" className="text-sm font-semibold text-gray-100">
          Transaction details
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          Nothing has been posted against this holding yet. Once a purchase, a sale or an
          income event is recorded, every leg of it is listed here.
        </p>
      </section>
    );
  }

  // Newest first: the question asked of this panel is almost always about the
  // most recent entry, and the summary tables above already read oldest-first.
  const ordered = [...events].reverse();

  return (
    <section className="panel mb-6 p-0" aria-labelledby="investment-activity-heading">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-600 px-5 py-4">
        <div>
          <h2 id="investment-activity-heading" className="text-sm font-semibold text-gray-100">
            Transaction details
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Every event recorded against this holding, with its charges itemised and both
            sides of the journal entry it wrote.
          </p>
        </div>
        <Pill tone="neutral">{ordered.length} events</Pill>
      </div>

      <ul className="divide-y divide-gray-600/50">
        {ordered.map((event) => (
          <li key={event.transactionId} className="px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="tnum text-xs text-gray-400">{event.on.toISO()}</span>
                <EventKind event={event} />
                <span className="text-sm text-gray-100">{event.description}</span>
              </div>
              <div className="text-right">
                <MoneyText value={event.netToHolding} tone="auto" />
                <p className="text-[11px] text-gray-500">
                  {event.kind === "INCOME" ? "Income earned" : "Movement on this holding"}
                </p>
              </div>
            </div>

            {event.quantity && event.pricePerUnit && (
              <p className="mt-2 text-xs text-gray-400">
                <span className="tnum text-gray-200">
                  {event.quantity.toDecimalString()}
                  {unit ?? ""}
                </span>{" "}
                at <MoneyText value={event.pricePerUnit} tone="neutral" /> each
                {event.consideration && (
                  <>
                    {" "}
                    = <MoneyText value={event.consideration} tone="neutral" /> before charges
                  </>
                )}
              </p>
            )}

            {event.charges.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {event.charges.map((charge) => (
                  <span
                    key={charge.label}
                    className="rounded-full border border-gray-600 px-2 py-0.5 text-[11px] text-gray-300"
                  >
                    {charge.label} <MoneyText value={charge.amount} tone="neutral" />
                  </span>
                ))}
                <span className="text-[11px] text-gray-500">
                  total <MoneyText value={event.chargeTotal} tone="neutral" />
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
              <p className="mt-2 text-[11px] text-gray-500">
                No charges were recorded against this trade.
              </p>
            )}

            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-brand-400 hover:underline">
                Journal entry — {event.postings.length} postings
              </summary>
              <div className="table-scroll mt-2">
                <table className="w-full text-xs">
                  <caption className="sr-only">
                    Journal postings for {event.description}
                  </caption>
                  <thead>
                    <tr className="border-b border-gray-600">
                      <th scope="col" className="metric-label px-3 py-2 text-left">
                        Account
                      </th>
                      <th scope="col" className="metric-label px-3 py-2 text-left">
                        Side
                      </th>
                      <th scope="col" className="metric-label px-3 py-2 text-right">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {event.postings.map((posting, index) => (
                      <tr
                        key={`${event.transactionId}-${index}`}
                        className="border-b border-gray-600/40 last:border-0"
                      >
                        <td className="px-3 py-2">
                          <span className="text-gray-200">{posting.accountName}</span>
                          <span className="ml-2 text-[11px] text-gray-500">
                            {posting.accountCode}
                          </span>
                          {posting.memo && (
                            <p className="text-[11px] text-gray-500">{posting.memo}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-400">
                          {posting.direction === "DEBIT" ? "Debit" : "Credit"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <MoneyText value={posting.amount} tone="neutral" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <p className="mt-2 text-[11px] text-gray-500">
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
    </section>
  );
}

function EventKind({ event }: { event: InvestmentEvent }) {
  if (event.kind === "TRADE") {
    return (
      <span
        className={
          event.side === "BUY"
            ? "rounded-full border border-green-600/50 px-2 py-0.5 text-[11px] text-green-500"
            : "rounded-full border border-amber-600/50 px-2 py-0.5 text-[11px] text-amber-500"
        }
      >
        {event.side === "BUY" ? "Bought" : "Sold"}
      </span>
    );
  }
  return (
    <span className="rounded-full border border-gray-600 px-2 py-0.5 text-[11px] text-gray-300">
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
