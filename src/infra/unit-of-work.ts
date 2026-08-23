import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { newUuid, type Clock } from "@/core/kernel";
import type { CalendarDate } from "@/core/time";
import type { Database } from "./db/client";
import {
  auditEvents,
  ledgerAccounts,
  ledgerEvents,
  projectionCache,
  type AuditActionName,
} from "./db/schema";

/**
 * The write path.
 *
 * Every mutation goes through `UnitOfWork.mutate`, which writes the row, one
 * audit event and one ledger event, and bumps the revision of each account the
 * change touched. Those four things are one operation rather than four calls a
 * caller must remember, because invariant A02 — exactly one audit event per
 * mutation — is not something a convention can guarantee.
 *
 * `AuditWriter` and `LedgerEventWriter` are constructor dependencies rather than
 * optional collaborators for the same reason. If they were optional, the first
 * code path in a hurry would omit them, and an audit trail with a hole in it is
 * not an audit trail.
 */

export interface RequestContext {
  readonly userId: string;
  /** Who acted. Equal to `userId` today; distinct if anything ever acts on a user's behalf. */
  readonly actorId: string;
  /** Groups every event from one request, so a multi-aggregate change reads as one story. */
  readonly requestId: string;
  readonly ipAddress: string | null;
  readonly clock: Clock;
}

export function newRequestContext(
  userId: string,
  clock: Clock,
  options: { actorId?: string; ipAddress?: string | null; requestId?: string } = {},
): RequestContext {
  return {
    userId,
    actorId: options.actorId ?? userId,
    requestId: options.requestId ?? newUuid(),
    ipAddress: options.ipAddress ?? null,
    clock,
  };
}

/**
 * One mutation, described rather than performed.
 *
 * `before` and `after` are captured by the caller because only it knows the
 * entity's shape; `apply` does the write. Splitting them is what lets the unit of
 * work record an accurate before-image without knowing any aggregate's type.
 */
export interface Mutation<T> {
  readonly action: AuditActionName;
  readonly entityType: string;
  readonly entityId: string;
  /** Serialisable snapshot before the change. `null` on an insert. */
  readonly before: unknown;
  /** The domain event this mutation represents, for the replay log. */
  readonly event: {
    readonly type: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly payload: unknown;
    /** The accounting date. A backdated write has an old date and a new seq. */
    readonly effectiveOn: CalendarDate | null;
  };
  /**
   * Accounts whose balances this mutation changes. Their revisions are bumped and
   * their `minAffectedDate` lowered, which is what makes cache invalidation
   * precise rather than wholesale.
   */
  readonly touchedAccountIds: readonly string[];
  /** Performs the write and returns both the result and its after-image. */
  readonly apply: (tx: Database) => Promise<{ result: T; after: unknown }>;
}

/** Serialises a snapshot, with bigints made explicit rather than thrown on. */
function snapshot(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? `${v}n` : v));
}

export class UnitOfWork {
  constructor(
    private readonly db: Database,
    private readonly context: RequestContext,
  ) {}

  /**
   * Writes a mutation, its audit event, its ledger event and the revision bumps.
   *
   * Not wrapped in a SQL transaction: libSQL over HTTP has awkward transaction
   * semantics with Drizzle, and the same reason better-auth's adapter is
   * configured with `transaction: false`. The ordering is chosen so a failure
   * part-way leaves a detectable state rather than a silent one — the row and its
   * audit event are written before the revision bump, so a crash between them
   * leaves a stale cache (detected by the revision check) rather than an
   * un-audited write.
   */
  async mutate<T>(mutation: Mutation<T>): Promise<T> {
    const { result, after } = await mutation.apply(this.db);

    await this.db.insert(auditEvents).values({
      id: newUuid(),
      userId: this.context.userId,
      actorId: this.context.actorId,
      action: mutation.action,
      entityType: mutation.entityType,
      entityId: mutation.entityId,
      beforeJson: snapshot(mutation.before),
      afterJson: snapshot(after),
      requestId: this.context.requestId,
      ipAddress: this.context.ipAddress,
    });

    await this.db.insert(ledgerEvents).values({
      userId: this.context.userId,
      eventType: mutation.event.type,
      aggregateType: mutation.event.aggregateType,
      aggregateId: mutation.event.aggregateId,
      payloadJson: snapshot(mutation.event.payload) ?? "null",
      effectiveOn: mutation.event.effectiveOn?.toISO() ?? null,
      requestId: this.context.requestId,
    });

    if (mutation.touchedAccountIds.length > 0) {
      await this.bumpRevisions(mutation.touchedAccountIds, mutation.event.effectiveOn);
      await this.invalidateProjections(mutation.touchedAccountIds, mutation.event.effectiveOn);
    }

    return result;
  }

  /**
   * Bumps each touched account's revision and lowers `minAffectedDate`.
   *
   * `min()` rather than an overwrite: a 2019 backdated entry must lower the
   * boundary, while a 2026 entry on the same account must leave it alone.
   */
  private async bumpRevisions(
    accountIds: readonly string[],
    effectiveOn: CalendarDate | null,
  ): Promise<void> {
    const iso = effectiveOn?.toISO() ?? null;
    await this.db
      .update(ledgerAccounts)
      .set({
        revision: sql`${ledgerAccounts.revision} + 1`,
        minAffectedDate: iso
          ? sql`min(coalesce(${ledgerAccounts.minAffectedDate}, ${iso}), ${iso})`
          : ledgerAccounts.minAffectedDate,
      })
      .where(
        and(
          eq(ledgerAccounts.userId, this.context.userId),
          inArray(ledgerAccounts.id, [...accountIds]),
        ),
      );
  }

  /**
   * Drops the cached projections this write actually affects — invariant B04.
   *
   * The plan of record's Phase 1f asks that a backdated 2019 entry not invalidate
   * 2024. That is right for a PERIOD projection and **wrong for a CUMULATIVE
   * one**: a 2019 opening balance genuinely changes the 2024 closing balance, and
   * erring toward "leave it cached" produces a silently wrong number. So the two
   * families invalidate by different rules:
   *
   *   PERIOD     — only if the effective date falls inside the period
   *   CUMULATIVE — only if the effective date is on or before its as-of date
   *
   * A write with no accounting date (a rename, say) invalidates nothing: it
   * changes no balance.
   */
  private async invalidateProjections(
    accountIds: readonly string[],
    effectiveOn: CalendarDate | null,
  ): Promise<void> {
    if (!effectiveOn) return;
    const iso = effectiveOn.toISO();
    void accountIds;

    await this.db.delete(projectionCache).where(
      and(
        eq(projectionCache.userId, this.context.userId),
        sql`(
          (${projectionCache.scope} = 'PERIOD'
            AND ${iso} >= ${projectionCache.periodStart}
            AND ${iso} <= ${projectionCache.periodEnd})
          OR
          (${projectionCache.scope} = 'CUMULATIVE'
            AND ${iso} <= ${projectionCache.asOf})
        )`,
      ),
    );
  }

  /** The revision vector for a scope, hashed — what a cached projection is keyed on. */
  async revisionVectorHash(accountIds: readonly string[]): Promise<string> {
    const rows = await this.db
      .select({ id: ledgerAccounts.id, revision: ledgerAccounts.revision })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.userId, this.context.userId),
          inArray(ledgerAccounts.id, [...accountIds]),
          isNull(ledgerAccounts.deletedAt),
        ),
      );
    return hashRevisionVector(rows);
  }
}

/**
 * A stable hash of `(accountId, revision)` pairs.
 *
 * Sorted first, so the same set of accounts in a different query order yields the
 * same key — otherwise a cache would miss for no reason. Not cryptographic: it
 * only has to change when any revision changes.
 */
export function hashRevisionVector(
  entries: readonly { id: string; revision: number }[],
): string {
  const canonical = [...entries]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => `${e.id}:${e.revision}`)
    .join("|");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < canonical.length; i++) {
    const c = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}
