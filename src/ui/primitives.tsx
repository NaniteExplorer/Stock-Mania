import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { cn } from "@/lib/utils";
import {
  formatMoney,
  formatMoneyCompact,
  formatMoneySignedCompact,
  formatPercentSigned,
} from "./format";

/**
 * The design-system primitives — all Server Components.
 *
 * `DataTable` lives in `./data-table` because it needs client state; keeping it
 * out of this module is what lets everything here render in the server HTML.
 *
 * These wrap the utility classes in `tokens.css`; they do not re-derive them.
 * The point is that a screen is composed of `Card`, `Stat`, `DataTable` and
 * `MoneyText` rather than of raw Tailwind strings — v1 repeated
 * `rounded-xl border border-gray-600 bg-gray-700/40 px-4 py-3` verbatim in a
 * dozen places, and that is how a design system drifts.
 *
 * Radix and shadcn already supply `components/ui/*`; anything with real
 * interaction behaviour (dialog, popover, dropdown) composes those rather than
 * re-implementing a focus trap.
 */

/* ═══ MoneyText ══════════════════════════════════════════════════════════ */

export type MoneyDisplay = "full" | "compact" | "signedCompact";

/**
 * Renders money, and nothing else can.
 *
 * `value` accepts `Money | null` and **not `number`** — the type-level half of
 * the float prohibition. A raw float has no path to the screen even if one were
 * computed by mistake.
 *
 * `null` renders an em-dash, never ₹0. A zero is a claim about someone's money;
 * an em-dash is an admission that the figure is not known yet. Every missing
 * price, unpriced holding and not-yet-computed total goes through this path.
 */
export function MoneyText({
  value,
  display = "full",
  tone = "auto",
  className,
  emptyLabel = "no data yet",
}: {
  value: Money | null;
  display?: MoneyDisplay;
  tone?: "auto" | "neutral" | "pos" | "neg";
  className?: string;
  emptyLabel?: string;
}) {
  if (value === null) {
    return (
      <span
        className={cn("tnum text-gray-500", className)}
        aria-label={emptyLabel}
      >
        —
      </span>
    );
  }

  const text =
    display === "full"
      ? formatMoney(value)
      : display === "compact"
        ? formatMoneyCompact(value)
        : formatMoneySignedCompact(value);

  const resolved =
    tone === "auto"
      ? value.isNegative
        ? "neg"
        : value.isPositive
          ? "pos"
          : "neutral"
      : tone;

  return (
    <span
      className={cn(
        "tnum",
        resolved === "pos" && "text-green-500",
        resolved === "neg" && "text-red-500",
        className,
      )}
    >
      {text}
    </span>
  );
}

/* ═══ Card ═══════════════════════════════════════════════════════════════ */

export function Card({
  title,
  subtitle,
  kicker,
  action,
  padding = "md",
  interactive = false,
  className,
  children,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  kicker?: string;
  action?: React.ReactNode;
  padding?: "none" | "sm" | "md" | "lg";
  interactive?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const pad = { none: "", sm: "p-4", md: "p-5", lg: "p-6 md:p-8" }[padding];
  const hasHeader = Boolean(title || subtitle || kicker || action);

  return (
    <section
      className={cn("panel", interactive && "panel-hover", pad, className)}
    >
      {hasHeader && (
        <header
          className={cn(
            "flex flex-wrap items-start justify-between gap-3",
            padding === "none" && "px-5 pt-5",
            children ? "mb-4" : undefined,
          )}
        >
          <div className="min-w-0">
            {kicker && <p className="section-kicker mb-1">{kicker}</p>}
            {title && (
              <h2 className="text-base font-semibold text-gray-100">{title}</h2>
            )}
            {subtitle && (
              <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/* ═══ Delta and Pill ═════════════════════════════════════════════════════ */

/**
 * A signed change chip.
 *
 * Deliberately distinct from `Pill`, which is for status and labels. Keeping them
 * separate stops a caller reaching for a neutral pill to show a loss, and the
 * direction is derived from the value here — a red gain is not expressible.
 */
export function Delta({
  value,
  display = "signedCompact",
  className,
}: {
  value: Money | Percentage | null;
  display?: MoneyDisplay;
  className?: string;
}) {
  if (value === null) {
    return <span className={cn("chip chip-muted", className)}>—</span>;
  }

  if (value instanceof Percentage) {
    const negative = formatPercentSigned(value).startsWith("-");
    return (
      <span
        className={cn("chip", negative ? "chip-neg" : "chip-pos", className)}
      >
        {formatPercentSigned(value)}
      </span>
    );
  }

  const tone = value.isZero
    ? "chip-muted"
    : value.isNegative
      ? "chip-neg"
      : "chip-pos";
  return (
    <span className={cn("chip", tone, className)}>
      <MoneyText value={value} display={display} tone="neutral" />
    </span>
  );
}

export function Pill({
  tone = "neutral",
  icon: Icon,
  className,
  children,
}: {
  tone?: "neutral" | "brand";
  icon?: LucideIcon;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("pill", tone === "brand" && "pill-brand", className)}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {children}
    </span>
  );
}

/* ═══ Stat ═══════════════════════════════════════════════════════════════ */

export function Stat({
  label,
  value,
  delta,
  hint,
  icon: Icon,
  size = "md",
  className,
}: {
  label: string;
  value: Money | null | React.ReactNode;
  delta?: Money | Percentage | null;
  hint?: string;
  icon?: LucideIcon;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const valueClass = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-4xl md:text-5xl",
  }[size];
  const isMoney = value instanceof Money || value === null;

  return (
    <div className={cn("stat-tile", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="metric-label">{label}</p>
        {Icon && (
          <span className="icon-chip h-8 w-8">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
      <p className={cn("mt-2 font-semibold text-gray-100", valueClass)}>
        {isMoney ? (
          <MoneyText value={value as Money | null} tone="neutral" />
        ) : (
          value
        )}
      </p>
      {(delta !== undefined || hint) && (
        <div className="mt-1 flex items-center gap-2">
          {delta !== undefined && <Delta value={delta} />}
          {hint && <span className="text-xs text-gray-500">{hint}</span>}
        </div>
      )}
    </div>
  );
}

/* ═══ TableFrame ═════════════════════════════════════════════════════════ */

/** A column's serialisable description — no render function. */
export interface ColumnSpec {
  id: string;
  header: string;
  /** Right-aligns and applies tabular numerals. Every money column wants this. */
  numeric?: boolean;
}

/**
 * The header of a table plus its empty state, as a Server Component.
 *
 * This exists because `DataTable` is a Client Component and a column's `render`
 * function cannot cross the server/client boundary — passing one throws
 * "Functions cannot be passed directly to Client Components". A screen with no
 * rows yet needs only strings, so it needs no client component at all.
 *
 * Once a screen has real rows, it introduces its own `"use client"` table module
 * that owns the render functions and calls `DataTable` directly.
 */
export function TableFrame({
  columns,
  caption,
  children,
}: {
  columns: readonly ColumnSpec[];
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-0">
      <div className="table-scroll border-b border-gray-600">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={cn(
                    "metric-label whitespace-nowrap px-4 py-3",
                    column.numeric ? "text-right" : "text-left",
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>
      {children}
    </section>
  );
}

/* ═══ EmptyState ═════════════════════════════════════════════════════════ */

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <span className="icon-chip mb-4 h-12 w-12">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="mb-2 text-lg font-semibold text-gray-100">{title}</p>
      <p className="max-w-md text-sm text-gray-500">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ═══ PageHeader ═════════════════════════════════════════════════════════ */

export function PageHeader({
  title,
  subtitle,
  badge,
  action,
}: {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle max-w-2xl">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {badge}
        {action}
      </div>
    </div>
  );
}

/* ═══ Field ══════════════════════════════════════════════════════════════ */

/**
 * Wires a label, hint and error to a control via a render prop, so the
 * `htmlFor` / `id` / `aria-describedby` / `aria-invalid` relationships cannot be
 * forgotten. Supersedes `components/forms/{InputField,SelectField}`.
 */
export function Field({
  name,
  label,
  hint,
  error,
  required = false,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
  }) => React.ReactNode;
}) {
  const describedBy = error
    ? `${name}-error`
    : hint
      ? `${name}-hint`
      : undefined;

  return (
    <div className="space-y-2">
      <label htmlFor={name} className="form-label">
        {label}
        {required && (
          <span className="ml-1 text-red-500" aria-hidden>
            *
          </span>
        )}
      </label>
      {children({
        id: name,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy,
      })}
      {error ? (
        <p id={`${name}-error`} className="text-sm text-red-500">
          {error}
        </p>
      ) : hint ? (
        <p id={`${name}-hint`} className="text-xs text-gray-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
