import * as React from "react";
import type { Money } from "../../src/core/money";
import type { Percentage } from "../../src/core/numeric";
import { compact, percentage, rupee, signed, unknown, type Figure, type Unknown } from "../../src/core/format";
import { TableCell } from "./table";
import styles from "./data-display.module.css";

type CellProps = React.ComponentProps<"td">;
const classes = (...values: (string | undefined)[]) => values.filter(Boolean).join(" ");

export function TextCell({ children, secondary, className, ...props }: CellProps & { secondary?: React.ReactNode }) {
  return <TableCell className={classes(styles.text, className)} {...props}><span>{children}</span>{secondary != null && <span className={styles.secondary}>{secondary}</span>}</TableCell>;
}

/**
 * Gain/loss tone. `"change"` colours by sign AND writes an explicit +/− so the
 * meaning never rests on colour alone; zero stays neutral and unsigned.
 * `"none"` (default) is a plain figure — a balance or a price is not a change.
 */
export type FigureTone = "none" | "change";
export type FigureSpec =
  | { kind?: "money"; value: Money; format?: "full" | "compact" | "signed"; decimals?: number; tone?: FigureTone }
  | { kind: "percentage"; value: Percentage; format?: never; decimals?: number; tone?: FigureTone }
  | { kind: "figure"; value: Figure; format?: never; decimals?: never; tone?: never };

type Direction = "gain" | "loss" | "flat";

function formatFigure(spec: FigureSpec): { text: Figure; direction: Direction | undefined } {
  if (spec.kind === "figure") return { text: spec.value, direction: undefined };
  const decimals = spec.decimals ?? 2;
  const change = spec.tone === "change";
  if (spec.kind === "percentage") {
    const text = percentage(spec.value, decimals);
    const flat = !/[1-9]/.test(text);
    const direction: Direction = flat ? "flat" : spec.value.scaled < 0n ? "loss" : "gain";
    return { text: change && direction === "gain" ? (`+${text}` as Figure) : text, direction: change ? direction : undefined };
  }
  const value = spec.value;
  const compactShape = spec.format === "compact";
  const text = change || spec.format === "signed"
    ? (compactShape ? signedCompact(value, decimals) : signed(value, { fractionDigits: decimals }))
    : compactShape ? compact(value, decimals) : rupee(value, decimals);
  const flat = !/[1-9]/.test(text);
  return { text, direction: change ? (flat ? "flat" : value.minor < 0n ? "loss" : "gain") : undefined };
}

function signedCompact(value: Money, decimals: number): Figure {
  const body = compact(value, decimals);
  return value.minor > 0n && /[1-9]/.test(body) ? (`+${body}` as Figure) : body;
}

/** Keep each column's precision constant to align decimal points without floating conversion. */
export function FigureCell({ className, ...props }: Omit<CellProps, "children"> & FigureSpec) {
  const { value, kind, format, decimals, tone, ...cell } = props as Omit<CellProps, "children"> & FigureSpec & { format?: never; decimals?: number; tone?: FigureTone };
  const { text, direction } = formatFigure({ value, kind, format, decimals, tone } as FigureSpec);
  return <TableCell {...cell} data-tone={direction} className={classes(styles.figure, className)}>{text}</TableCell>;
}

/** The inline (non-table) figure: same formatting and tone rules as FigureCell. */
export function FigureText({ className, ...props }: Omit<React.ComponentProps<"span">, "children"> & FigureSpec) {
  const { value, kind, format, decimals, tone, ...span } = props as Omit<React.ComponentProps<"span">, "children"> & FigureSpec & { format?: never; decimals?: number; tone?: FigureTone };
  const { text, direction } = formatFigure({ value, kind, format, decimals, tone } as FigureSpec);
  return <span {...span} data-tone={direction} className={classes(styles.figureText, className)}>{text}</span>;
}

/** Shared inline unavailable figure; generated description ids are stable across hydration. */
export function UnknownFigure({ value, reasonId, className, ...props }: Omit<React.ComponentProps<"span">, "children"> & { value: Unknown; reasonId?: string }) {
  const generatedId = React.useId();
  const descriptionId = reasonId ?? generatedId;
  if (!value.reason.trim() || !descriptionId.trim()) throw new Error("UnknownFigure requires a specific reason and unique reasonId");
  return <span {...props} className={classes(styles.unknownGroup, className)}><span className={styles.unknown} tabIndex={0} aria-label="Unavailable" aria-describedby={descriptionId}>—</span><span id={descriptionId} className={styles.reason}>{value.reason}</span></span>;
}

/** reasonId is caller-owned and must be unique in the document; no client boundary is needed. */
export function UnknownCell({ reason, reasonId, className, ...props }: Omit<CellProps, "children"> & { reason: string; reasonId: string }) {
  if (!reason.trim() || !reasonId.trim()) throw new Error("UnknownCell requires a specific reason and unique reasonId");
  return <TableCell {...props} className={classes(styles.figure, className)}><UnknownFigure value={unknown(reason)} reasonId={reasonId} /></TableCell>;
}

export function BadgeCell({ children, tone = "outline", className, ...props }: CellProps & { tone?: "outline" | "gain" | "loss" | "warning" }) {
  return <TableCell {...props} className={className}><span className={styles.badge} data-tone={tone}>{children}</span></TableCell>;
}
/** Compose library controls inside this cell; the cell itself is never an interactive substitute. */
export function ActionCell({ className, ...props }: CellProps) {
  return <TableCell className={classes(styles.action, className)} {...props} />;
}
