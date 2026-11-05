/**
 * Source health — per-source summary of fetch outcomes, as of a date (task 6.4).
 *
 * Silent staleness is the product's biggest correctness risk (PRODUCT-REQUIREMENT §7),
 * so every source is summarised from what its fetch log says, and the summary feeds
 * `sourceFailureAlert` unchanged. Pure: no I/O, no clock — the caller passes `asOf`.
 *
 * **Missing is not zero.** A source that never succeeded has a null age and a null last
 * success, never 0 and never an epoch date.
 */

import type { CalendarDate } from "@/core/time";
import { Count, Days } from "@/core/units";

export type SourceHealthStatus = "HEALTHY" | "STALE" | "FAILING" | "NEVER_SUCCEEDED";

/** One thing the fetch log says happened on a day. */
export interface FetchObservation {
  readonly sourceId: string;
  readonly observedOn: CalendarDate;
  readonly outcome: "SUCCESS" | "FAILURE";
  /** Failures this observation stands for: 1 for an append-only log, N for a snapshot row. */
  readonly failures: Count;
  /** Short error classification, e.g. `TIMEOUT`; null on success or when unrecorded. */
  readonly errorKind: string | null;
}

/** What the caller knows about a source: its name and its own allowed age. */
export interface SourceHealthSpec {
  readonly id: string;
  readonly name: string;
  readonly maxAge: Days;
}

export interface SourceHealth {
  readonly id: string;
  readonly name: string;
  readonly asOf: CalendarDate;
  readonly status: SourceHealthStatus;
  readonly lastSuccessOn: CalendarDate | null;
  /** Days from the last success to `asOf`; null when there has never been one. */
  readonly ageDays: Days | null;
  readonly maxAge: Days;
  readonly consecutiveFailures: Count;
  readonly lastErrorKind: string | null;
}

/** The exact input shape of `sourceFailureAlert` in `alerts.ts`. */
export interface SourceAlertInput {
  readonly id: string;
  readonly name: string;
  readonly lastSuccessOn: CalendarDate | null;
}

/**
 * Summarise one source as of `asOf`. Observations of other sources and observations
 * dated after `asOf` are ignored before anything is computed — never mixed in.
 */
export function summarizeSourceHealth(
  spec: SourceHealthSpec,
  observations: readonly FetchObservation[],
  asOf: CalendarDate,
): SourceHealth {
  const mine = observations
    .filter((o) => o.sourceId === spec.id && o.observedOn.isOnOrBefore(asOf))
    .slice()
    .sort((a, b) => a.observedOn.compareTo(b.observedOn));

  let lastSuccessOn: CalendarDate | null = null;
  for (const o of mine) {
    if (o.outcome === "SUCCESS") lastSuccessOn = o.observedOn;
  }

  // Failures strictly after the last success, or all of them if none. A failure on the
  // same day as the success is ambiguous in order; the success is taken as the later.
  let failures = 0;
  let lastErrorKind: string | null = null;
  for (const o of mine) {
    if (o.outcome !== "FAILURE") continue;
    if (lastSuccessOn !== null && !o.observedOn.isAfter(lastSuccessOn)) continue;
    failures += o.failures;
    lastErrorKind = o.errorKind ?? lastErrorKind;
  }

  const ageDays = lastSuccessOn === null ? null : Days(lastSuccessOn.daysUntil(asOf));
  const status: SourceHealthStatus =
    ageDays === null ? "NEVER_SUCCEEDED"
      : ageDays > spec.maxAge ? "STALE"
        : failures > 0 ? "FAILING"
          : "HEALTHY";

  return Object.freeze({
    id: spec.id,
    name: spec.name,
    asOf,
    status,
    lastSuccessOn,
    ageDays,
    maxAge: spec.maxAge,
    consecutiveFailures: Count(failures),
    lastErrorKind,
  });
}

/** Every source, each summarised independently. One source's rows never touch another's. */
export function summarizeSources(
  specs: readonly SourceHealthSpec[],
  observations: readonly FetchObservation[],
  asOf: CalendarDate,
): readonly SourceHealth[] {
  return Object.freeze(specs.map((spec) => summarizeSourceHealth(spec, observations, asOf)));
}

export function toSourceAlertInput(health: SourceHealth): SourceAlertInput {
  return Object.freeze({ id: health.id, name: health.name, lastSuccessOn: health.lastSuccessOn });
}

/**
 * A value that depends on a source, gated by that source's health. A healthy or failing
 * (but still fresh) source passes its value through; a stale one marks it stale; a
 * never-succeeded one yields unknown. Never a zero substituted for a missing value.
 */
export type SourcedValue<T> =
  | { readonly state: "FRESH"; readonly value: T }
  | { readonly state: "STALE"; readonly value: T; readonly lastSuccessOn: CalendarDate }
  | { readonly state: "UNKNOWN"; readonly value: null; readonly reason: string };

export function gateBySourceHealth<T>(health: SourceHealth, value: T | null): SourcedValue<T> {
  if (value === null || health.lastSuccessOn === null) {
    return Object.freeze({ state: "UNKNOWN" as const, value: null, reason: `${health.name} has no usable data as of ${health.asOf.toISO()}.` });
  }
  if (health.status === "STALE") {
    return Object.freeze({ state: "STALE" as const, value, lastSuccessOn: health.lastSuccessOn });
  }
  return Object.freeze({ state: "FRESH" as const, value });
}
