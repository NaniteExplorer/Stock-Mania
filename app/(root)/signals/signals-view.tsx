import Link from "next/link";
import { Masthead, MastFigure, Page, Panel, Section } from "../../../components/ui/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { UnknownFigure } from "../../../components/ui/data-cell";
import { Banner } from "../../../components/ui/banner";
import type { Unknown } from "@/core/format";
import { STATUS_LABELS, type AllocationView, type DrawdownView, type MacroRow, type RuleView, type SignalsView, type TaxView } from "./signals-model";
import styles from "./signals.module.css";

/** A string, or the focusable em-dash with its reason. Never a zero. */
function Value({ value, reasonId }: { value: string | Unknown; reasonId: string }) {
  return typeof value === "string" ? <>{value}</> : <UnknownFigure value={value} reasonId={reasonId} />;
}

function Rule({ rule }: { rule: RuleView }) {
  return <li id={rule.id} className={styles.rule} data-status={rule.status}>
    <div className={styles.ruleHead}>
      <h3 className={styles.ruleTitle}>{rule.title}</h3>
      <span className={styles.status}>{STATUS_LABELS[rule.status]}</span>
    </div>
    {rule.lines.map((line) => <p key={line} className={styles.line}>{line}</p>)}
  </li>;
}

function Allocation({ view }: { view: AllocationView }) {
  const description = "Each sleeve's share against its target and band. Source: your holdings, valued through the price ladder.";
  switch (view.state) {
    case "empty":
      return <Panel title="Allocation against bands" description={description}><p className={styles.empty}>{view.text}</p></Panel>;
    case "unknown":
      return <Panel title="Allocation against bands" description={description}>
        <UnknownFigure value={view.value} reasonId="allocation-unknown" />
        <p className={styles.line}><Link href="/settings/allocation">Set your target allocation and rebalancing band</Link></p>
      </Panel>;
    case "refused":
      return <Panel title="Allocation against bands" description={description}><Banner title="Not computed">{view.reason}</Banner></Panel>;
    case "standing":
    case "stale":
      return <Panel title="Allocation against bands" description={description}>
        {view.staleNote && <Banner tone="warning" title="Stale prices">{view.staleNote}</Banner>}
        <p className={styles.line}>{view.summary}</p>
        {view.route && <p className={styles.line}>{view.route}</p>}
        <Table density="compact">
          <TableHeader><TableRow><TableHead>Sleeve</TableHead><TableHead>Actual</TableHead><TableHead>Target</TableHead><TableHead>Deviation</TableHead><TableHead>Band</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {view.rows.map((row) => <TableRow key={row.id} data-breached={row.breached || undefined}>
              <TableCell>{row.name}</TableCell>
              <TableCell className={styles.figure}>{row.actual}</TableCell>
              <TableCell className={styles.figure}>{row.target}</TableCell>
              <TableCell className={styles.figure}>{row.deviation}</TableCell>
              <TableCell className={styles.figure}>{row.band}</TableCell>
              <TableCell>{row.status}</TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
      </Panel>;
  }
}

function Tax({ view }: { view: TaxView }) {
  return <Panel title="Tax position" description={view.detail}>
    {view.state === "known"
      ? <p className={styles.headline}>{view.headline}</p>
      : <UnknownFigure value={view.value} reasonId="tax-unknown" />}
  </Panel>;
}

function Drawdown({ view }: { view: DrawdownView }) {
  const description = "Per index you hold against: the current fall from its peak, placed against past days with what followed shown beside it.";
  switch (view.state) {
    case "empty":
      return <Panel title="Drawdown from peak" description={description}><p className={styles.empty}>{view.text}</p></Panel>;
    case "unknown":
      return <Panel title="Drawdown from peak" description={description}><UnknownFigure value={view.value} reasonId="drawdown-unknown" /></Panel>;
    case "refused":
      return <Panel title="Drawdown from peak" description={description}>
        <p className={styles.headline}>{view.index}: {view.headline}</p>
        <Banner title="What followed is not shown">{view.reason}</Banner>
      </Panel>;
    case "shown":
    case "stale":
      return <Panel title="Drawdown from peak" description={description}>
        {view.state === "stale" && <Banner tone="warning" title="Stale index data">Last good value kept and dated below.</Banner>}
        <p className={styles.headline}>{view.index}: {view.headline}</p>
        {/* One component: the percentile sentence and the strip of what followed. */}
        <figure className={styles.placement}>
          <figcaption className={styles.line}>{view.placement}</figcaption>
          <div className={styles.strip} role="img" aria-label={view.strip.label}>
            <span className={styles.track} style={{ left: `${view.strip.min}%`, width: `${view.strip.max - view.strip.min}%` }} />
            <span className={styles.middle} style={{ left: `${view.strip.q1}%`, width: `${view.strip.q3 - view.strip.q1}%` }} />
            <span className={styles.zero} style={{ left: `${view.strip.zero}%` }} />
          </div>
        </figure>
        <p className={styles.note}>{view.sourceLine}</p>
      </Panel>;
  }
}

function Macro({ rows, missing }: { rows: readonly MacroRow[]; missing: readonly string[] }) {
  return <Panel title="Macro levels" description="Levels with their percentile against their own history and that history's range. Keyless sources only.">
    <Table density="compact">
      <TableHeader><TableRow><TableHead>Series</TableHead><TableHead>Level</TableHead><TableHead>As of</TableHead><TableHead>Percentile, own history</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => <TableRow key={row.id} data-stale={row.stale || undefined}>
          <TableCell>{row.series}</TableCell>
          <TableCell className={styles.figure}><Value value={row.level} reasonId={`macro-${row.id}-level`} /></TableCell>
          <TableCell><Value value={row.asOf} reasonId={`macro-${row.id}-asof`} /></TableCell>
          <TableCell><Value value={row.placement} reasonId={`macro-${row.id}-placement`} /></TableCell>
          <TableCell>{row.source}</TableCell>
        </TableRow>)}
      </TableBody>
    </Table>
    <p className={styles.note}>Deliberately absent, not approximated:</p>
    <ul className={styles.list}>{missing.map((item) => <li key={item}>{item}</li>)}</ul>
  </Panel>;
}

export function SignalsScreen({ view }: { view: SignalsView }) {
  return <Page>
    <Masthead title="Signals" side={<MastFigure label="Failing sources" value={view.failingSources} />} />
    <p className={styles.lede}>
      Facts about your own position as of {view.asOf}. This page is shown only when you open it; nothing on it is pushed.{" "}
      <a href="#rule-SOURCE_FAILURE">Data-source alert</a>
      {view.unreadableSources && <> · {view.unreadableSources}</>}
    </p>
    {view.empty && <Banner title="No holdings recorded yet">The drawdown and allocation panels describe your holdings; add one under Investments. The other panels still show.</Banner>}
    {view.holdingsNote && <Banner tone="warning" title="Holdings unknown"><UnknownFigure value={view.holdingsNote} reasonId="holdings-unknown" /></Banner>}

    <Section heading="Your own state" />
    <Panel title="Alerts" description={`Each rule states a fact or says why it was not evaluated. As of ${view.asOf}.`}>
      <ul className={styles.rules}>{view.rules.map((rule) => <Rule key={rule.id} rule={rule} />)}</ul>
    </Panel>
    <Allocation view={view.allocation} />
    <Tax view={view.tax} />

    <Section heading="Market context" />
    <Drawdown view={view.drawdown} />
    <Macro rows={view.macro} missing={view.missing} />
    <Panel title="FII/DII flows" description="Daily net figures for the last 30 sessions, with the month's cumulative figure. Flows, not sentiment.">
      <UnknownFigure value={view.flows} reasonId="flows-unknown" />
    </Panel>
  </Page>;
}
