import type { ReactNode } from "react";
import { Page, Masthead, MastFigure, Section, Panel } from "../../../components/ui/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { TextCell, UnknownCell } from "../../../components/ui/data-cell";
import { UnknownFigure } from "../../../components/ui/data-cell";
import { Banner } from "../../../components/ui/banner";
import { Button } from "../../../components/ui/button";
import type { FigureValue } from "@/core/format";
import type { CommitmentRow, CommitmentsModel, RenewalRow } from "./model";
import styles from "./commitments.module.css";

/** Server-rendered body of /commitments. Every state is explicit (DESIGN §5). */
export type CommitmentsState =
  | { readonly kind: "ready"; readonly model: CommitmentsModel }
  | { readonly kind: "empty" };

function FigureCellValue({ value, id, className }: { value: FigureValue; id: string; className?: string }) {
  if (typeof value !== "string") return <UnknownCell reason={value.reason} reasonId={id} className={className} />;
  return <TextCell className={className} style={{ textAlign: "right", fontFamily: "var(--fig-face)", fontVariantNumeric: "var(--fig-vn)" }}>{value}</TextCell>;
}

function AutoRenews({ on }: { on: boolean }) {
  return on ? <span className={styles.chip}>Auto-renews</span> : <span className={styles.muted}>No</span>;
}

function RenewingSoon({ rows }: { rows: readonly RenewalRow[] }) {
  if (rows.length === 0) return <p className={styles.muted}>Nothing renews in the next 30 days.</p>;
  return <Panel title="Next 30 days" description="Soonest first. Cancel by is the last day to cancel before the charge." flush>
    <Table aria-label="Renewing in the next 30 days">
      <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Due</TableHead><TableHead style={{ textAlign: "right" }}>Amount</TableHead><TableHead>Cancel by</TableHead><TableHead>Renewal</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => <TableRow key={row.id}>
          <TextCell>{row.name}</TextCell>
          <TextCell>{row.due}</TextCell>
          {row.priceChange
            ? <TextCell style={{ textAlign: "right" }}><span className={styles.change}><span>{row.priceChange.from} → {row.priceChange.to}</span><span className={styles.chip}>Price rises</span></span></TextCell>
            : <FigureCellValue value={row.amount} id={`renew-${row.id}-amount`} />}
          {row.cancelBy.kind === "unknown"
            ? <TableCell><UnknownFigure value={{ kind: "unknown", reason: row.cancelBy.reason }} reasonId={`renew-${row.id}-cancel`} /></TableCell>
            : <TextCell className={row.cancelBy.kind === "passed" ? styles.warn : undefined}>{row.cancelBy.text}</TextCell>}
          <TableCell><AutoRenews on={row.autoRenews} /></TableCell>
        </TableRow>)}
      </TableBody>
    </Table>
  </Panel>;
}

const COLUMNS = ["Name", "Kind", "Cadence", "Price", "Per month", "Next charge", "Auto-renews", "Ends"] as const;

function Head() {
  return <TableHeader><TableRow>{COLUMNS.map((c) => <TableHead key={c} style={c === "Price" || c === "Per month" ? { textAlign: "right" } : undefined}>{c}</TableHead>)}</TableRow></TableHeader>;
}

function Row({ row }: { row: CommitmentRow }) {
  return <TableRow data-group={row.group}>
    <TextCell secondary={row.group === "ending" ? "Counted until it ends" : undefined}>{row.name}</TextCell>
    <TextCell>{row.kind}</TextCell>
    <TextCell>{row.cadence}</TextCell>
    <FigureCellValue value={row.price} id={`row-${row.id}-price`} />
    <FigureCellValue value={row.perMonth} id={`row-${row.id}-month`} />
    <TextCell>{row.nextCharge ?? "None due"}</TextCell>
    <TableCell><AutoRenews on={row.autoRenews} /></TableCell>
    <TextCell>{row.ends ? `Ends ${row.ends}` : "Runs on"}</TextCell>
  </TableRow>;
}

function GroupHead({ label }: { label: string }) {
  return <TableRow><TableCell colSpan={COLUMNS.length} className={styles.groupHead}>{label}</TableCell></TableRow>;
}

/** Editing is P2: verbs are shown disabled with their reason as visible text (§9e, §6). */
function Verbs() {
  return <div className={styles.verbs}>
    <Button variant="outline" size="sm" disabled>Mark cancelled</Button>
    <Button variant="outline" size="sm" disabled>Remove</Button>
    <span className={styles.reason}>Cancelling and removing arrive with editing; not available yet</span>
  </div>;
}

export function CommitmentsView({ state, form }: { state: CommitmentsState; form: ReactNode }) {
  if (state.kind === "empty") {
    return <Page>
      <Masthead title="Commitments" />
      <Banner title="No commitments yet"><p>No commitments yet. Add subscriptions, plans and fees that renew.</p></Banner>
      <Section heading="Add a commitment" />
      {form}
    </Page>;
  }
  const { model } = state;
  return <Page>
    <Masthead title="Commitments" hero={model.perMonth}
      side={<><MastFigure label="Per year" value={model.perYear} /><MastFigure label="Auto-renewing per month" value={model.autoRenewingPerMonth} /></>} />
    <Section heading="Renewing soon" />
    <RenewingSoon rows={model.renewing} />
    <Section heading="All commitments" />
    <Panel title="Active and ending" description="A cancelled commitment stays in the totals until its last day." actions={<Verbs />} flush>
      <Table aria-label="All commitments">
        <Head />
        <TableBody>
          {model.rows.active.length > 0 && <GroupHead label="Active" />}
          {model.rows.active.map((row) => <Row key={row.id} row={row} />)}
          {model.rows.ending.length > 0 && <GroupHead label="Ending" />}
          {model.rows.ending.map((row) => <Row key={row.id} row={row} />)}
        </TableBody>
      </Table>
    </Panel>
    {model.rows.ended.length > 0 && <details className={styles.ended}>
      <summary>Ended ({model.rows.ended.length})</summary>
      <div className={styles.endedBody}>
        <Panel title="Ended" description="No longer counted in any total." flush>
          <Table aria-label="Ended commitments"><Head /><TableBody>{model.rows.ended.map((row) => <Row key={row.id} row={row} />)}</TableBody></Table>
        </Panel>
      </div>
    </details>}
    <Section heading="Add a commitment" />
    {form}
  </Page>;
}
