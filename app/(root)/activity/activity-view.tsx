import type { ReactNode } from "react";
import { Masthead, Page, Panel } from "../../../components/ui/page-shell";
import { Banner } from "../../../components/ui/banner";
import type { ActivityView } from "./activity-model";
import { ActivityGrid } from "./activity-grid";
import styles from "./activity.module.css";

export const EMPTY_TEXT = "Nothing has changed yet. Edits, removals and imports appear here, and can be undone for 30 days.";

/**
 * Rows grouped by request under day headings, newest first (DESIGN §9e), as one
 * keyboard grid (§6.1). `actions` renders each row's verbs on the server; the grid
 * places them and reaches them by key.
 */
export function ActivityScreen({ view, actions }: { view: ActivityView; actions: (requestId: string) => ReactNode }) {
  const verbs = Object.fromEntries(view.days.flatMap((day) => day.rows.map((row) => [row.requestId, actions(row.requestId)])));
  return <Page>
    <Masthead title="Activity" />
    <p className={styles.note}>{view.windowNote}</p>
    {view.redoNotice && <Banner tone="warning" title="Redo is no longer available"><p>{view.redoNotice}</p></Banner>}
    <ActivityGrid days={view.days} total={view.total} redoNotice={view.redoNotice} verbs={verbs} />
  </Page>;
}

export function ActivityEmpty() {
  return <Page>
    <Masthead title="Activity" />
    <Panel title="No activity"><p className={styles.note}>{EMPTY_TEXT}</p></Panel>
  </Page>;
}
