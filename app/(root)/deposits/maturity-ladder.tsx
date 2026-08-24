/**
 * The maturity ladder.
 *
 * A row per deposit, positioned along a shared timeline from today to the furthest
 * maturity. The visual claim is about *sequence and spacing* — which deposit frees
 * money up first, and how far apart the rungs are — which a table of dates gives
 * only if you do the subtraction yourself.
 *
 * Every value arrives pre-formatted: `Money` is a class and cannot cross into a
 * component's props, and a number would be a float. The only arithmetic here is
 * positioning.
 */
export default function MaturityLadder({
  rungs,
  today,
}: {
  rungs: readonly { label: string; maturesOn: string; days: number; value: string }[];
  today: string;
}) {
  const horizon = Math.max(1, ...rungs.map((rung) => rung.days));

  return (
    <div className="space-y-3">
      {rungs.map((rung) => {
        const position = Math.max(2, Math.min(100, (rung.days / horizon) * 100));
        return (
          <div key={`${rung.label}-${rung.maturesOn}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate text-gray-300">{rung.label}</span>
              <span className="tnum shrink-0 text-gray-500">
                {rung.maturesOn} · ₹{rung.value}
              </span>
            </div>
            <div className="relative h-2 w-full rounded-full bg-gray-600">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-brand-500/70"
                style={{ width: `${position}%` }}
                aria-hidden
              />
            </div>
          </div>
        );
      })}
      <div className="flex justify-between text-xs text-gray-500">
        <span className="tnum">{today}</span>
        <span>{horizon} days out</span>
      </div>
    </div>
  );
}
