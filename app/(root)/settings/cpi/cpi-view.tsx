import type { ReactNode } from "react";
import Link from "next/link";
import { Page, Masthead, Section, Panel } from "../../../../components/ui/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";
import { TextCell } from "../../../../components/ui/data-cell";
import { Banner } from "../../../../components/ui/banner";
import type { CpiRow } from "./cpi-model";
import styles from "./cpi.module.css";

/** Server-rendered body of /settings/cpi. Every state is explicit (DESIGN §5). */
export type CpiState =
  | { readonly kind: "ready"; readonly rows: readonly CpiRow[] }
  | { readonly kind: "empty" };

const INTRO = "Type each month's CPI Urban index as MoSPI publishes it. Nothing is fetched and no inflation rate is assumed; a month you have not entered is never interpolated.";

export function CpiView({ state, form, remove, editing }: {
  state: CpiState;
  form: ReactNode;
  /** Renders the remove control for a row (a client form in the app, a stub in tests). */
  remove: (row: CpiRow) => ReactNode;
  editing: string | null;
}) {
  return <Page>
    <Masthead title="CPI Urban" />
    <p className={styles.note}>{INTRO} Months before Jan 2026 are on the 2012 base; from Jan 2026 on the 2024 base.</p>
    {state.kind === "empty"
      ? <Banner title="No CPI recorded yet"><p>Real values on the net-worth chart stay unknown until you record CPI for the months it covers.</p></Banner>
      : <>
        <Section heading="Recorded months" />
        <Panel title="CPI Urban series" description="Newest first. Removing a month keeps an audit record." flush>
          <Table aria-label="Recorded CPI months">
            <TableHeader><TableRow>
              <TableHead>Month</TableHead><TableHead>Base</TableHead><TableHead style={{ textAlign: "right" }}>Index</TableHead><TableHead>Source</TableHead><TableHead>Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {state.rows.map((row) => <TableRow key={row.month} aria-current={editing === row.month ? "true" : undefined}>
                <TextCell>{row.monthLabel}</TextCell>
                <TextCell>{row.base}</TextCell>
                <TextCell style={{ textAlign: "right", fontFamily: "var(--fig-face)", fontVariantNumeric: "var(--fig-vn)" }}>{row.index}</TextCell>
                <TextCell>{row.source}</TextCell>
                <TableCell><div className={styles.verbs}>
                  <Link href={`/settings/cpi?edit=${row.month}#cpi-entry`} aria-label={`Edit CPI for ${row.monthLabel}`}>Edit</Link>
                  {remove(row)}
                </div></TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </Panel>
      </>}
    <Section heading={editing ? `Edit ${editing}` : "Record a month"} />
    {editing ? <p className={styles.note}><Link href="/settings/cpi">Cancel editing</Link></p> : null}
    {form}
  </Page>;
}
