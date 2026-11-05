import Link from "next/link";
import { Banner } from "../../../../components/ui/banner";
import { Button } from "../../../../components/ui/button";
import type { GapNotice } from "./gap-notice";

/**
 * Persistent, not dismissible, and rendered above the balance it qualifies
 * (DESIGN.md §9a). It disappears when the data arrives, never on a click.
 */
export function GapNoticeView({ notice }: { notice: GapNotice }) {
  if (notice.kind === "new-account") {
    return <p className="mb-3 text-xs text-(--fg-secondary)">{notice.title}</p>;
  }
  return (
    <Banner tone="warning" title={notice.title} className="mb-3" data-direction={notice.direction}>
      <table className="my-2 text-sm">
        <caption className="sr-only">How the difference is worked out</caption>
        <tbody>
          {notice.rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" className={`pr-6 text-left ${row.total ? "font-semibold" : "font-normal"}`}>
                {row.label}
              </th>
              <td className={`tabular-nums text-right ${row.total ? "font-semibold" : ""}`}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>{notice.meaning}</p>
      <Button asChild variant="outline" size="sm" className="mt-2">
        <Link href="/imports">{notice.action}</Link>
      </Button>
    </Banner>
  );
}
