import { Panel } from "../../../components/ui/page-shell";
import { place, type OwnerFigure, type Placement, type PppFactor } from "@/domain/scoring/percentile";
import type { ReferenceDistribution } from "@/domain/scoring/percentile-references";
import styles from "./standing.module.css";

export interface PlacementRow {
  readonly id: string;
  readonly scale: string;
  readonly source: string;
  readonly url: string;
  readonly dated: string;
  readonly unit: string;
  readonly placement: Placement;
  readonly limits: readonly string[];
}

/**
 * Percentile placement rows (TASKS 3.8), pure. Without an owner figure every
 * scale refuses with that reason; nothing is placed by default.
 */
export function placementRows(references: readonly ReferenceDistribution[], owner: OwnerFigure | null, ppp: PppFactor | null, ownerReason: string): PlacementRow[] {
  return references.map((r) => ({
    id: r.id,
    scale: `${r.scale === "INDIA" ? "India" : "World"} ${r.measure}`,
    source: r.source,
    url: r.url,
    dated: `${r.referenceYear} values, published ${r.published}`,
    unit: `per ${r.unit}, ${r.basis === "INR_NOMINAL" ? "nominal rupees" : r.basis === "USD_NOMINAL" ? "nominal US dollars" : "PPP international dollars"}`,
    placement: owner === null || owner.measure !== r.measure
      ? (r.thresholds === null
        ? { state: "refused", distributionId: r.id, reason: r.pendingReason ?? "No thresholds." }
        : { state: "refused", distributionId: r.id, reason: ownerReason })
      : place(owner, r, ppp),
    limits: r.limits,
  }));
}

/**
 * Placement is part of the guess-first gate: `revealed` is true only inside
 * GuessFirst. Outside it, a placed band is withheld; refusals reveal nothing.
 */
export function PlacementPanel({ rows, revealed }: { rows: readonly PlacementRow[]; revealed: boolean }) {
  return <Panel title="Placement" description="A band against a published distribution, never a single percentile. Every scale states its unit and date.">
    <ul className={styles.list}>
      {rows.map((row) => <li key={row.id}>
        {row.scale}: {row.placement.state === "placed"
          ? (revealed ? row.placement.label : "Shown after your guess.")
          : row.placement.reason}
        <br /><span className={styles.note}><a href={row.url}>{row.source}</a>; {row.dated}; {row.unit}.</span>
        {row.placement.state === "placed" && revealed && row.placement.notes.map((note) => <span key={note} className={styles.note}><br />{note}</span>)}
        {row.limits.map((limit) => <span key={limit} className={styles.note}><br />Limit: {limit}</span>)}
      </li>)}
    </ul>
  </Panel>;
}
