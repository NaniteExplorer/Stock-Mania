import type { ReactNode } from "react";
import type { FigureValue } from "../../../src/core/format";
import { Page, Masthead, MastFigure, KpiStrip, Kpi, Section, Panel } from "../../../components/ui/page-shell";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../../components/ui/table";
import { TextCell } from "../../../components/ui/data-cell";
import { UnknownFigure } from "../../../components/ui/data-cell";
import { Banner } from "../../../components/ui/banner";
import { Skeleton } from "../../../components/ui/skeleton";
import shell from "../../../components/ui/page-shell.module.css";
import styles from "./insurance.module.css";
import type { InsuranceView, PresenceCell } from "./insurance-view";

/** A figure or a reasoned em-dash, never a raw zero. */
function Value({ value }: { value: FigureValue | string }) {
  return typeof value === "string" ? <>{value}</> : <UnknownFigure value={value} />;
}

/**
 * Presence is a word, not a figure, so the library `Kpi` (FigureValue only) cannot
 * carry "Covered" / "None held". Same markup and classes as `Kpi`; no new styling.
 * Neutral ink for every state: none of the three may read as a verdict.
 */
function PresenceKpi({ cell }: { cell: PresenceCell }) {
  if (cell.state === "unknown") return <Kpi label={cell.label} value={cell.value} detail={cell.detail} />;
  return <div className={shell.kpi} data-presence={cell.state}>
    <dt className={shell.kpiLabel}>{cell.label}</dt>
    <dd className={shell.kpiValue}>{cell.state === "covered" ? "Covered" : "None held"}</dd>
    <dd className={shell.kpiDetail}>{cell.detail}</dd>
  </div>;
}

/** A count in the masthead side slot; `MastFigure` accepts only formatted figures. */
function CountFigure({ label, count }: { label: string; count: number }) {
  return <div className={shell.mastFigure}><span className={shell.kpiLabel}>{label}</span><span className={shell.mastFigureValue}>{count}</span></div>;
}

export function InsuranceScreen({ view, addForm }: { view: InsuranceView; addForm: ReactNode }) {
  return <Page>
    <Masthead title="Insurance" hero={view.outgo} side={<>
      <MastFigure label={view.nextRenewal.label} value={view.nextRenewal.value} />
      <CountFigure label="Policies in force" count={view.inForceCount} />
    </>} />

    <KpiStrip>{view.presence.map((cell) => <PresenceKpi key={cell.kind} cell={cell} />)}</KpiStrip>

    {view.isEmpty ? <Banner title="No policies yet. Add one, or record that you hold none.">
      <p><a href="#add-policy">Add a policy</a></p>
      <p>Recording that you hold none is not available yet; until then each kind stays unknown, never &ldquo;not covered&rdquo;.</p>
    </Banner> : <>
      <Section heading="Policies" />
      <Panel title="Policies" description="In force first, then ended. Sum insured is recorded, never scored." flush>
        <Table aria-label="Insurance policies">
          <TableHeader><TableRow>
            <TableHead>Kind</TableHead><TableHead>Insurer</TableHead><TableHead>Covers</TableHead>
            <TableHead>Sum insured</TableHead><TableHead>Premium</TableHead><TableHead>Next due</TableHead><TableHead>Cancel by</TableHead>
          </TableRow></TableHeader>
          <TableBody>{view.policies.map((row) => (
            <TableRow key={row.id} className={row.ended ? styles.ended : undefined} data-ended={row.ended || undefined}>
              <TextCell>{row.kind}</TextCell>
              <TextCell>{row.insurer}</TextCell>
              <TextCell>{row.insured}</TextCell>
              <TableCell className={styles.figure}><Value value={row.sumInsured} /></TableCell>
              <TextCell secondary={row.cadence}><span className={styles.figure}><Value value={row.premium} /></span></TextCell>
              <TextCell>{row.nextDue}</TextCell>
              <TableCell><Value value={row.cancelBy} /></TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </Panel>

      <Panel title="Renewals — the next 60 days" description="Soonest first. A price change is shown as a fact, old and new.">
        {view.renewals.length === 0 ? <p className={styles.muted}>Nothing renews in the next 60 days.</p> :
          <ul className={styles.list}>{view.renewals.map((renewal) => (
            <li key={renewal.policyId} className={styles.listItem}>
              <span>{renewal.label}</span>
              <span>{renewal.dueOn}</span>
              <span className={styles.figure}>{renewal.previous !== null && <><Value value={renewal.previous} /> &rarr; </>}<Value value={renewal.premium} /></span>
              <span className={styles.muted}>Cancel by <Value value={renewal.cancelBy} /></span>
            </li>
          ))}</ul>}
      </Panel>

      <details>
        <summary>Cover erosion — information</summary>
        <p className={styles.muted}>Not shown yet: no medical-inflation rate with a cited source has been set, and this screen does not invent one.</p>
      </details>
    </>}

    <Panel title="Add a policy" description="Blank sum insured, premium or notice period stays unknown — never zero.">
      <div id="add-policy">{addForm}</div>
    </Panel>
  </Page>;
}

/** Loading — skeleton strip and three skeleton rows (DESIGN §9d). */
export function InsuranceLoading() {
  return <Page><div role="status" aria-busy="true" aria-label="Loading insurance">
    <Skeleton className={shell.hero} />
    <Skeleton /><Skeleton /><Skeleton />
    {[0, 1, 2].map((index) => <Skeleton key={index} className={styles.skeletonRow} />)}
  </div></Page>;
}

/** Error — names the read that failed and offers Retry. */
export function InsuranceReadError({ failed, retry }: { failed: string; retry: ReactNode }) {
  return <Page>
    <Masthead title="Insurance" />
    <Banner tone="error" title={`${failed} could not be read`}><p>Nothing was changed.</p>{retry}</Banner>
  </Page>;
}
