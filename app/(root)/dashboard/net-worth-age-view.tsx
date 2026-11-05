import Link from "next/link";
import { ChartPanel } from "../../../components/ui/page-shell";
import { Banner } from "../../../components/ui/banner";
import { UnknownFigure } from "../../../components/ui/data-cell";
import { unknown } from "@/core/format";
import { EMPTY_REASON, NET_WORTH_AGE_TITLE, type Basis, type ChartGeometry, type NetWorthAgeView } from "./net-worth-age-model";
import styles from "./net-worth-age.module.css";

const DESCRIPTION = "Month-end net worth, summed from the journal. A month with no figure is a gap, never a guess.";

/** The line, milestone rules, CPI break mark and one focus stop per month (DESIGN §8.1). */
export function NetWorthAgeChart({ chart, label }: { chart: ChartGeometry; label: string }) {
  const { plot } = chart;
  const middle = (plot.left + plot.right) / 2;
  return (
    <svg className={styles.chart} viewBox={`0 0 ${chart.width} ${chart.height}`} role="group" aria-label={label}>
      {chart.yTicks.map((t) => (
        <g key={`y${t.y}`} aria-hidden="true">
          <line className={styles.grid} x1={plot.left} x2={plot.right} y1={t.y} y2={t.y} />
          <text className={styles.axis} x={plot.left - 6} y={t.y + 4} textAnchor="end">{t.label}</text>
        </g>
      ))}
      {chart.zeroY !== null && <line className={styles.zero} x1={plot.left} x2={plot.right} y1={chart.zeroY} y2={chart.zeroY} aria-hidden="true" />}
      {chart.milestones.map((m) => (
        <g key={m.label}>
          <line className={m.emphasis === "primary" ? styles.milestone : styles.milestoneQuiet} x1={plot.left} x2={plot.right} y1={m.y} y2={m.y} />
          <text className={styles.milestoneLabel} x={plot.right} y={Math.max(10, m.y - 4)} textAnchor="end">{m.label}</text>
        </g>
      ))}
      {chart.breakMark && (
        <g>
          <line className={styles.breakRule} x1={chart.breakMark.x} x2={chart.breakMark.x} y1={plot.top} y2={plot.bottom} />
          <text className={styles.breakLabel} x={chart.breakMark.x + (chart.breakMark.x > middle ? -4 : 4)} y={plot.bottom - 6} textAnchor={chart.breakMark.x > middle ? "end" : "start"}>
            {chart.breakMark.label}
          </text>
        </g>
      )}
      {chart.segmentLabels.map((s) => <text key={s.text} className={styles.segmentLabel} x={s.x} y={s.y}>{s.text}</text>)}
      {chart.lines.map((d) => <path key={d} className={styles.line} d={d} aria-hidden="true" />)}
      {chart.points.filter((p) => p.isolated && p.y !== null).map((p) => <circle key={`dot${p.month}`} className={styles.dot} cx={p.x} cy={p.y!} r={3} aria-hidden="true" />)}
      {chart.xTicks.map((t) => <text key={`x${t.x}`} className={styles.axis} x={t.x} y={chart.height - 8} textAnchor="middle" aria-hidden="true">{t.label}</text>)}
      {chart.points.map((p) => (
        <g key={p.month} className={styles.stop} tabIndex={0} role="img" aria-label={p.label}>
          <title>{p.label}</title>
          <circle className={styles.hit} cx={p.x} cy={p.y ?? plot.bottom} r={6} />
          {p.y === null
            ? <circle className={styles.gapRing} cx={p.x} cy={plot.bottom} r={4} />
            : <circle className={styles.ring} cx={p.x} cy={p.y} r={4} />}
          <text className={styles.tip} x={p.x > middle ? p.x : Math.max(p.x, plot.left)} y={12} textAnchor={p.x > middle ? "end" : "start"}>{p.label}</text>
        </g>
      ))}
    </svg>
  );
}

/** Real | Nominal, as links so the page stays a server component. Real is disabled, with its reason, when it cannot be computed. */
export function BasisToggle({ basis, realRefusal }: { basis: Basis; realRefusal: string | null }) {
  return (
    <nav className={styles.toggle} aria-label="Value basis">
      {realRefusal !== null ? (
        <span className={styles.toggleItem} aria-disabled="true" title={realRefusal}>Real</span>
      ) : (
        <Link className={styles.toggleItem} href="/dashboard?basis=real" aria-current={basis === "real" ? "true" : undefined}>Real</Link>
      )}
      <Link className={styles.toggleItem} href="/dashboard?basis=nominal" aria-current={basis === "nominal" ? "true" : undefined}>Nominal</Link>
    </nav>
  );
}

export function NetWorthAgeLoading() {
  return <ChartPanel title={NET_WORTH_AGE_TITLE} summary="Loading net worth history." state={{ kind: "loading" }} />;
}

export function NetWorthAgeError({ reason }: { reason: string }) {
  return (
    <ChartPanel
      title={NET_WORTH_AGE_TITLE}
      summary="Net worth history could not be loaded."
      state={{ kind: "error", reason, recovery: <Link href="/dashboard">Try again</Link> }}
    />
  );
}

export function NetWorthAgePanel({ view }: { view: NetWorthAgeView }) {
  if (view.kind === "empty") {
    return (
      <ChartPanel
        title={NET_WORTH_AGE_TITLE}
        description={DESCRIPTION}
        summary={view.summary}
        state={{ kind: "empty", reason: EMPTY_REASON, action: <Link href="/imports">Import a statement</Link> }}
      />
    );
  }

  const body = (
    <div className={styles.body}>
      <p className={styles.headline}>
        {view.headline !== null
          ? <span className={styles.headlineFigure}>{view.headline}</span>
          : <UnknownFigure value={unknown(view.headlineReason ?? "Unknown.")} reasonId="net-worth-age-latest" />}
        {" · "}{view.basisLabel}
      </p>
      {view.realRefusal !== null && (
        <Banner title="Real values are unknown">
          <p>{view.realRefusal}</p>
          <p><Link href="/settings/cpi">Record CPI Urban figures</Link></p>
        </Banner>
      )}
      <NetWorthAgeChart chart={view.chart} label={view.summary} />
      {view.dobPrompt !== null && (
        <p className={styles.note}>
          <Link href="/settings">{view.dobPrompt}</Link> Until then the axis is calendar years.
        </p>
      )}
      {view.milestoneNote !== null && <p className={styles.note}>{view.milestoneNote}</p>}
      {view.citation !== null && <p className={styles.note}>{view.citation}</p>}
      {view.spliceSource !== null && <p className={styles.note}>{view.spliceSource}</p>}
      <details className={styles.details}>
        <summary>Show as a table</summary>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Month</th>
              {view.axis === "age" && <th scope="col">Age</th>}
              <th scope="col">{view.basis === "real" ? "Real" : "Nominal"}</th>
              {view.basis === "real" && <th scope="col">Nominal</th>}
            </tr>
          </thead>
          <tbody>
            {view.table.map((row) => (
              <tr key={row.month}>
                <th scope="row">{row.month}</th>
                {view.axis === "age" && <td className={styles.tableFigure}>{row.age ?? "—"}</td>}
                <td className={styles.tableFigure}>{row.value}</td>
                {view.basis === "real" && <td className={styles.tableFigure}>{row.nominal}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );

  return (
    <ChartPanel
      title={NET_WORTH_AGE_TITLE}
      description={DESCRIPTION}
      actions={<BasisToggle basis={view.basis} realRefusal={view.realRefusal} />}
      summary={view.summary}
      // "unknown" keeps the line (DESIGN §8.1): the em-dash is the headline, not the whole panel.
      state={view.staleReason !== null ? { kind: "stale", reason: view.staleReason, children: body } : { kind: "ready", children: body }}
    />
  );
}
