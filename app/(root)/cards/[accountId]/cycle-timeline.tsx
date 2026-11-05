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
      {/* SVG geometry attributes position the bars, so no inline style is needed (F.7). */}
      <svg className="h-5 w-full overflow-visible" aria-hidden>
        <rect x="0" y="4" width="100%" height="12" rx="6" className="fill-(--border)" />
        <rect x="0" y="4" width={percent(statement)} height="12" rx="6" className="fill-(--accent)/70" />
        {now >= start && now <= due && (
          <rect x={percent(now)} y="0" width="2" height="20" className="fill-(--fg)" />
        )}
      </svg>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-xs text-(--fg-muted)">Cycle opened</p>
          <p className="tabular-nums text-(--fg-secondary)">{from}</p>
        </div>
        <div>
          <p className="text-xs text-(--fg-muted)">Statement</p>
          <p className="tabular-nums text-(--fg-secondary)">{through}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-(--fg-muted)">Payment due</p>
          <p className="tabular-nums text-(--fg-secondary)">{dueOn}</p>
        </div>
      </div>

      <p className="mt-2 text-xs text-(--fg-muted)">
        {inCycle
          ? `Spending now lands on the statement dated ${through}, payable by ${dueOn}.`
          : `This cycle has closed; spending now lands on the next statement.`}
      </p>
    </div>
  );
}
