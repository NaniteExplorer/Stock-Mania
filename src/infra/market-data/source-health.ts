/**
 * Reader of `provider_fetch_log` for the source health monitor (task 6.4).
 *
 * The table is a mutable snapshot — one row per (provider, instrument, quote type) — so a
 * row is translated into what it can honestly state: a SUCCESS on `last_success_at`, and,
 * when `consecutive_failures > 0`, one FAILURE on `last_attempt_at` standing for that
 * many failures. Observations dated after `asOf` are dropped here and again in the domain.
 * Limitation: failures that began before `asOf` but were last recorded after it are not
 * visible to a historical evaluation; exact history needs an append-only attempts log.
 */

import { eq } from "drizzle-orm";

import { SystemClock } from "@/core/kernel";
import { CalendarDate } from "@/core/time";
import { Count } from "@/core/units";
import type { FetchLogReader } from "@/app/source-health.usecases";
import type { FetchObservation } from "@/domain/source-health";
import type { Database } from "@/infra/db/client";
import { providerFetchLog } from "@/infra/db/schema";

const ERROR_KINDS = ["UNKNOWN_SYMBOL", "RATE_LIMITED", "TIMEOUT", "CIRCUIT_OPEN", "UPSTREAM", "MALFORMED_RESPONSE", "UNSUPPORTED"];

/** The provider error kind named in a stored message, or `UNCLASSIFIED`. Never the raw text. */
export function classifyFetchError(message: string | null): string | null {
  if (message === null || message.trim() === "") return null;
  const upper = message.toUpperCase();
  return ERROR_KINDS.find((kind) => upper.includes(kind)) ?? "UNCLASSIFIED";
}

export interface FetchLogRow {
  readonly providerId: string;
  readonly lastAttemptAt: Date | null;
  readonly lastSuccessAt: Date | null;
  readonly lastError: string | null;
  readonly consecutiveFailures: number;
}

const dayOf = (instant: Date): CalendarDate => CalendarDate.parse(SystemClock.toReportingDate(instant));

export function rowToObservations(row: FetchLogRow, asOf: CalendarDate): readonly FetchObservation[] {
  const out: FetchObservation[] = [];
  if (row.lastSuccessAt) {
    out.push({ sourceId: row.providerId, observedOn: dayOf(row.lastSuccessAt), outcome: "SUCCESS", failures: Count(1), errorKind: null });
  }
  if (row.lastAttemptAt && row.consecutiveFailures > 0) {
    out.push({
      sourceId: row.providerId,
      observedOn: dayOf(row.lastAttemptAt),
      outcome: "FAILURE",
      failures: Count(row.consecutiveFailures),
      errorKind: classifyFetchError(row.lastError),
    });
  }
  return out.filter((o) => o.observedOn.isOnOrBefore(asOf)).map((o) => Object.freeze(o));
}

export class DrizzleProviderFetchLogReader implements FetchLogReader {
  constructor(private readonly db: Database) {}

  async observationsFor(sourceId: string, asOf: CalendarDate): Promise<readonly FetchObservation[]> {
    const rows = await this.db
      .select({
        providerId: providerFetchLog.providerId,
        lastAttemptAt: providerFetchLog.lastAttemptAt,
        lastSuccessAt: providerFetchLog.lastSuccessAt,
        lastError: providerFetchLog.lastError,
        consecutiveFailures: providerFetchLog.consecutiveFailures,
      })
      .from(providerFetchLog)
      .where(eq(providerFetchLog.providerId, sourceId));
    return Object.freeze(rows.flatMap((row) => rowToObservations(row, asOf)));
  }
}
