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
 * Audited writes share one path for snapshots, events, revisions and projections.
 * `mutateAtomic` additionally makes every database effect one SQL transaction.
 * The legacy `mutate` remains nontransactional until its callers migrate.
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

/** The real executor supplied by Drizzle's transaction callback (not a Database cast). */
export type TransactionExecutor = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Atomic callers must perform all database writes through this supplied executor. */
export type AtomicMutation<T> = Omit<Mutation<T>, "apply"> & {
  /**
   * Performs the write. A writer that must read its before-image inside the transaction
   * (so a concurrent request cannot make it stale) returns `before`/`action` here; they
   * replace the outer values in the audit record.
   */
  readonly apply: (tx: TransactionExecutor) => Promise<{ result: T; after: unknown; before?: unknown; action?: AuditActionName }>;
};

type WriteExecutor = Database | TransactionExecutor;

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

  /** Legacy compatibility path: errors can leave partial writes; no atomicity guarantee. */
  async mutate<T>(mutation: Mutation<T>): Promise<T> {
    const { result, after } = await mutation.apply(this.db);
    await this.recordMutation(this.db, mutation, after);
    return result;
  }

  /** Commit the aggregate, audit/event records, revisions and cache effects together. */
  async mutateAtomic<T>(mutation: AtomicMutation<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const out = await mutation.apply(tx);
      const recorded = {
        ...mutation,
        ...("before" in out ? { before: out.before } : {}),
        ...(out.action ? { action: out.action } : {}),
      };
      await this.recordMutation(tx, recorded, out.after);
      return out.result;
    });
  }

  private async recordMutation<T>(
    executor: WriteExecutor,
    mutation: Omit<Mutation<T>, "apply">,
    after: unknown,
  ): Promise<void> {
    await executor.insert(auditEvents).values({
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

    await executor.insert(ledgerEvents).values({
      userId: this.context.userId,
      eventType: mutation.event.type,
      aggregateType: mutation.event.aggregateType,
      aggregateId: mutation.event.aggregateId,
      payloadJson: snapshot(mutation.event.payload) ?? "null",
      effectiveOn: mutation.event.effectiveOn?.toISO() ?? null,
      requestId: this.context.requestId,
    });

    if (mutation.touchedAccountIds.length > 0) {
      await this.bumpRevisions(executor, mutation.touchedAccountIds, mutation.event.effectiveOn);
      await this.invalidateProjections(executor, mutation.touchedAccountIds, mutation.event.effectiveOn);
    }

  }

  /**
   * Bumps each touched account's revision and lowers `minAffectedDate`.
   *
   * `min()` rather than an overwrite: a 2019 backdated entry must lower the
   * boundary, while a 2026 entry on the same account must leave it alone.
   */
  private async bumpRevisions(
    executor: WriteExecutor,
    accountIds: readonly string[],
    effectiveOn: CalendarDate | null,
  ): Promise<void> {
    const iso = effectiveOn?.toISO() ?? null;
    await executor
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
    executor: WriteExecutor,
    accountIds: readonly string[],
    effectiveOn: CalendarDate | null,
  ): Promise<void> {
    if (!effectiveOn) return;
    const iso = effectiveOn.toISO();
    void accountIds;

    await executor.delete(projectionCache).where(
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
