import type * as React from "react";
import Link from "next/link";
import { ChartPanel, Masthead, Page } from "../../../components/ui/page-shell";
import { Banner } from "../../../components/ui/banner";
import { PROJECTION_TITLE, type FanGeometry, type ProjectionView } from "./projection-model";
import styles from "./projection.module.css";

/** The fan: 5–95 faded to transparent with no stroke, 10–90, 25–75, median (DESIGN §8.2). */
export function FanChart({ fan, label }: { fan: FanGeometry; label: string }) {
  return <svg className={styles.chart} viewBox={`0 0 ${fan.width} ${fan.height}`} role="img" aria-label={label}>
    <defs>
      <linearGradient id="projection-outer-fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="var(--c1)" stopOpacity="0" />
        <stop offset="0.3" stopColor="var(--c1)" stopOpacity="0.1" />
        <stop offset="0.7" stopColor="var(--c1)" stopOpacity="0.1" />
        <stop offset="1" stopColor="var(--c1)" stopOpacity="0" />
      </linearGradient>
    </defs>
    <path className={styles.outer} d={fan.outer} fill="url(#projection-outer-fade)" />
    <path className={styles.middle} d={fan.middle} />
    <path className={styles.inner} d={fan.inner} />
    <path className={styles.median} d={fan.median} />
    <line className={styles.target} x1={0} x2={fan.width - 128} y1={fan.targetY} y2={fan.targetY} />
    <text className={styles.axis} x={4} y={Math.max(10, fan.targetY - 4)}>{fan.targetLabel}</text>
    {fan.bandLabels.map((l) => <text key={l.text} className={styles.axis} x={fan.width - 124} y={l.y}>{l.text}</text>)}
    {fan.ageTicks.map((t) => <text key={t.x} className={styles.axis} x={t.x} y={fan.height - 8}>{t.label}</text>)}
  </svg>;
}

/** `children` (the dropped-value notice, the assumptions form) sit inside the page shell. */
export function ProjectionScreen({ view, children }: { view: ProjectionView; children?: React.ReactNode }) {
  let panel;
  switch (view.kind) {
    case "refused":
      panel = <ChartPanel title={PROJECTION_TITLE} summary={view.summary} state={{ kind: "refused", reason: view.reasons.join(" ") }} />;
      break;
    case "empty":
      panel = <ChartPanel title={PROJECTION_TITLE} summary={view.summary} state={{ kind: "empty", reason: view.reason, action: <Link href="/investments">Record an investment</Link> }} />;
      break;
    default: {
      const chart = <><p className={styles.headline}>{view.headline}</p><p className={styles.caveat}>{view.caveat}</p><FanChart fan={view.fan} label={view.summary} /></>;
      panel = <ChartPanel title={PROJECTION_TITLE} description={view.description} summary={view.summary}
        state={view.kind === "stale" ? { kind: "stale", reason: view.staleReason!, children: chart } : { kind: "ready", children: chart }} />;
    }
  }
  return <Page>
    <Masthead title="Projection" />
    {view.kind === "refused" && <Banner tone="warning" title="The projection refuses until these are fixed">
      <ul className={styles.reasons}>{view.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
    </Banner>}
    {panel}
    {children}
  </Page>;
}
