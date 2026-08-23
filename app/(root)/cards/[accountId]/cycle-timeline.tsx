/**
 * The current cycle, as a line from its first day to its due date.
 *
 * Dates arrive as ISO strings, already formatted by the server — `CalendarDate` is
 * a class and does not cross into a component's props any more than `Money` does.
 * The arithmetic here is day counting for layout only; nothing financial is
 * computed in the UI.
 *
 * The two segments are the point of the picture: spending accumulates up to the
 * statement date, and the stretch after it is interest-free time to pay. A single
 * bar from start to due date would hide exactly the distinction the user needs.
 */
export default function CycleTimeline({
  from,
  through,
  dueOn,
  today,
}: {
  from: string;
  through: string;
  dueOn: string;
  today: string;
}) {
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
  const start = day(from);
  const statement = day(through);
  const due = day(dueOn);
  const now = day(today);

  const span = Math.max(1, due - start);
  const percent = (value: number) => `${Math.max(0, Math.min(100, ((value - start) / span) * 100))}%`;

  const inCycle = now >= start && now <= statement;

  return (
    <div>
      <div className="relative h-3 w-full rounded-full bg-gray-600">
        <div
          className="absolute inset-y-0 left-0 rounded-l-full bg-brand-500/70"
          style={{ width: percent(statement) }}
          aria-hidden
        />
        {now >= start && now <= due && (
          <div
            className="absolute -top-1 h-5 w-0.5 bg-gray-100"
            style={{ left: percent(now) }}
            aria-hidden
          />
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="metric-label">Cycle opened</p>
          <p className="tnum text-gray-300">{from}</p>
        </div>
        <div>
          <p className="metric-label">Statement</p>
          <p className="tnum text-gray-300">{through}</p>
        </div>
        <div className="text-right">
          <p className="metric-label">Payment due</p>
          <p className="tnum text-gray-300">{dueOn}</p>
        </div>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        {inCycle
          ? `Spending now lands on the statement dated ${through}, payable by ${dueOn}.`
          : `This cycle has closed; spending now lands on the next statement.`}
      </p>
    </div>
  );
}
