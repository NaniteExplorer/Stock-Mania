/**
 * Source health read (task 6.4): every configured market-data source, summarised as of a
 * date, plus the inputs `sourceFailureAlert` needs.
 *
 * Graceful by construction: each source's log is read on its own, and a read that throws
 * marks **that** source `UNREADABLE` — the others are summarised unchanged and the caller
 * never sees an exception. An unreadable source contributes no alert input, because
 * "never returned data" would be a guess (alerts.ts: unknown input, no alert).
 */

import type { UserId } from "@/core/kernel";
import type { CalendarDate } from "@/core/time";
import {
  summarizeSourceHealth,
  toSourceAlertInput,
  type FetchObservation,
  type SourceAlertInput,
  type SourceHealth,
  type SourceHealthSpec,
} from "@/domain/source-health";

/** Reads one source's fetch observations on or before `asOf`. May throw; the use case contains it. */
export interface FetchLogReader {
  observationsFor(sourceId: string, asOf: CalendarDate): Promise<readonly FetchObservation[]>;
}

export type SourceHealthEntry =
  | { readonly state: "READ"; readonly health: SourceHealth }
  | { readonly state: "UNREADABLE"; readonly id: string; readonly name: string; readonly reason: string };

export interface SourceHealthOutput {
  readonly asOf: CalendarDate;
  readonly sources: readonly SourceHealthEntry[];
  /** Feed each to `sourceFailureAlert(input, spec.maxAge, asOf)`. */
  readonly alertInputs: readonly SourceAlertInput[];
}

export class ViewSourceHealth {
  constructor(private readonly reader: FetchLogReader) {}

  /**
   * `userId` scopes the call to the signed-in owner; the fetch log itself is operational
   * and shared (mutation class C), so it carries no per-user rows to filter.
   */
  async execute(input: {
    readonly userId: UserId;
    readonly asOf: CalendarDate;
    readonly sources: readonly SourceHealthSpec[];
  }): Promise<SourceHealthOutput> {
    const entries = await Promise.all(input.sources.map((spec) => this.one(spec, input.asOf)));
    const alertInputs = entries.flatMap((entry) => (entry.state === "READ" ? [toSourceAlertInput(entry.health)] : []));
    return Object.freeze({ asOf: input.asOf, sources: Object.freeze(entries), alertInputs: Object.freeze(alertInputs) });
  }

  private async one(spec: SourceHealthSpec, asOf: CalendarDate): Promise<SourceHealthEntry> {
    try {
      const observations = await this.reader.observationsFor(spec.id, asOf);
      return Object.freeze({ state: "READ" as const, health: summarizeSourceHealth(spec, observations, asOf) });
    } catch {
      return Object.freeze({
        state: "UNREADABLE" as const,
        id: spec.id,
        name: spec.name,
        reason: `The fetch log for ${spec.name} could not be read; its health is unknown.`,
      });
    }
  }
}
