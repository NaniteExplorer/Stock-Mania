import { Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { Table } from "./table";
import { figureParts, type FigureValue, type Unknown } from "../../src/core/format";
import { UnknownFigure } from "./data-cell";
import { Banner } from "./banner";
import { Skeleton } from "./skeleton";
import { InfoButton } from "./info-button";
import styles from "./page-shell.module.css";

export function Page({ children }: { children: ReactNode }) {
  return <div className={styles.page}>{children}</div>;
}

function Figure({ value }: { value: FigureValue }) {
  if (typeof value !== "string") return <UnknownFigure value={value} />;
  const parts = figureParts(value);
  return <>{parts.sign}{parts.currency && <span className={styles.currency}>{parts.currency}</span>}{parts.amount}{parts.unit && <span className={styles.unit}>{parts.unit}</span>}</>;
}

/** `subtitle` is one line of context under the title (scope, period, phase). */
export function Masthead({ title, subtitle, hero, side }: { title: string; subtitle?: ReactNode; hero?: FigureValue; side?: ReactNode }) {
  return <header className={styles.masthead}>
    <div className={styles.mastMain}><span className={styles.tick} aria-hidden="true" /><h1 className={styles.heading}>{title}</h1>{subtitle != null && <p className={styles.subtitle}>{subtitle}</p>}{hero !== undefined && <div className={styles.hero}><Figure value={hero} /></div>}</div>
    {side != null && <div className={styles.mastSide}>{side}</div>}
  </header>;
}

export function KpiStrip({ children }: { children: ReactNode }) {
  return <dl className={styles.kpis}>{children}</dl>;
}

export function MastFigure({ label, value }: { label: string; value: FigureValue }) {
  return <div className={styles.mastFigure}><span className={styles.kpiLabel}>{label}</span><span className={styles.mastFigureValue}><Figure value={value} /></span></div>;
}

/** `info` is the KPI's explanation: a focusable button and popover (D.6), never a `title=`. */
export function Kpi({ label, value, detail, info }: { label: string; value: FigureValue; detail?: ReactNode; info?: string }) {
  return <div className={styles.kpi}><dt className={styles.kpiLabel}>{label}{info && <InfoButton label={label} explanation={info} />}</dt><dd className={styles.kpiValue}><Figure value={value} /></dd>{detail != null && <dd className={styles.kpiDetail}>{detail}</dd>}</div>;
}

export function Section({ heading, actions }: { heading: string; actions?: ReactNode }) {
  return <div className={styles.section}><h2 className={styles.heading}>{heading}</h2><span className={styles.rule} aria-hidden="true" />{actions}</div>;
}

/** `href` makes the title a link (the heading stays an h2; the link is inside it). */
type PanelProps = { title: string; href?: string; description?: string; actions?: ReactNode } & (
  | { flush: true; children: ReactElement<React.ComponentProps<typeof Table>, React.JSXElementConstructor<React.ComponentProps<typeof Table>>> }
  | { flush?: false; children: ReactNode }
);

export function Panel({ title, href, description, actions, children, flush = false }: PanelProps) {
  if (flush && (!isValidElement(children) || children.type !== Table)) {
    throw new Error("A flush Panel requires a library Table as its body");
  }
  return <section className={styles.panel}>
    <header className={styles.panelHeader}><div><h2>{href ? <Link href={href} className={styles.titleLink}>{title}</Link> : title}</h2>{description && <p>{description}</p>}</div>{actions && <div className={styles.actions}>{actions}</div>}</header>
    <div className={flush ? styles.tableBody : styles.panelBody}>{children}</div>
  </section>;
}

export function Columns({ children }: { children: readonly [ReactNode, ReactNode] }) {
  return <div className={styles.columns}>{children}</div>;
}

export type ChartPanelState =
  | { kind: "ready"; children: ReactNode }
  | { kind: "loading" }
  | { kind: "empty"; reason: string; action: ReactNode }
  | { kind: "error"; reason: string; recovery: ReactNode }
  | { kind: "unknown"; value: Unknown }
  | { kind: "refused"; reason: string }
  | { kind: "stale"; reason: string; children: ReactNode };

/** Check statically visible content without invoking an arbitrary child component. */
function hasRecoveryContent(value: ReactNode): boolean {
  if (value == null || typeof value === "boolean") return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasRecoveryContent);
  if (isValidElement<{ children?: ReactNode }>(value) && value.type === Fragment) {
    return hasRecoveryContent(value.props.children);
  }
  // Recovery accepts explicit elements/text/arrays. Do not consume arbitrary
  // iterables here: a one-shot iterator could be empty when React later renders it.
  return isValidElement(value) || typeof value === "number" || typeof value === "bigint";
}

/** State is explicit, so a missing figure is never drawn as an empty or zero chart. */
export function ChartPanel({ title, href, description, actions, summary, state }: {
  title: string; href?: string; description?: string; actions?: ReactNode; summary: string; state: ChartPanelState;
}) {
  if (!summary.trim()) throw new Error("ChartPanel requires a specific chart summary");
  if ("reason" in state && !state.reason.trim()) throw new Error("ChartPanel state requires a specific reason");
  if (state.kind === "empty" && !hasRecoveryContent(state.action)) throw new Error("An empty ChartPanel requires an action to add observations");
  if (state.kind === "error" && !hasRecoveryContent(state.recovery)) throw new Error("A failed ChartPanel requires a recovery action");
  let content: ReactNode;
  switch (state.kind) {
    case "ready": content = state.children; break;
    case "loading": content = <div role="status"><span>Loading chart…</span><Skeleton /><Skeleton /><Skeleton /></div>; break;
    case "empty": content = <Banner title="No observations yet"><p>{state.reason}</p>{state.action}</Banner>; break;
    case "error": content = <Banner tone="error" title="Chart could not be loaded"><p>{state.reason}</p>{state.recovery}</Banner>; break;
    case "unknown": content = <UnknownFigure value={state.value} />; break;
    case "refused": content = <Banner title="Chart calculation refused"><p>{state.reason}</p></Banner>; break;
    case "stale": content = <><Banner tone="warning" title="Chart is out of date"><p>{state.reason}</p></Banner>{state.children}</>; break;
  }
  return <Panel title={title} href={href} description={description} actions={actions}><figure data-state={state.kind} aria-busy={state.kind === "loading" || undefined}><figcaption className={styles.summary}>{summary}</figcaption>{content}</figure></Panel>;
}
