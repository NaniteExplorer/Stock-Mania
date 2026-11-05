import { and, desc, eq, gte } from "drizzle-orm";
import type { UserId } from "@/core/kernel";
import type { ActivityEvent, ActivityLog } from "@/app/activity.usecases";
import type { Database } from "@/infra/db/client";
import { auditEvents } from "@/infra/db/schema";

/**
 * Drizzle adapter for the {@link ActivityLog} read port (task 2.7.b).
 *
 * Read-only and owner-scoped: every query filters on `audit_events.user_id`, so a
 * foreign event can never reach the Activity screen. Newest first, as the port
 * promises; grouping by `request_id` stays in `ListActivity`.
 */
export class DrizzleActivityLog implements ActivityLog {
  constructor(private readonly db: Database) {}

  async eventsSince(userId: UserId, since: Date): Promise<readonly ActivityEvent[]> {
    const rows = await this.db
      .select({
        requestId: auditEvents.requestId,
        actorId: auditEvents.actorId,
        action: auditEvents.action,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        at: auditEvents.at,
      })
      .from(auditEvents)
      .where(and(eq(auditEvents.userId, userId.value), gte(auditEvents.at, since)))
      .orderBy(desc(auditEvents.at));
    return rows.map((row) => ({
      ...row,
      at: row.at instanceof Date ? row.at : new Date(row.at as unknown as string),
    }));
  }
}
