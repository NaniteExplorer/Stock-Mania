import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/infra/db/client";

/** User ids with at least one open, non-deleted instrument to refresh. */
export async function listMarketSyncUserIds(): Promise<readonly string[]> {
  const rows = await db
    .selectDistinct({ userId: schema.instruments.userId })
    .from(schema.instruments)
    .where(and(eq(schema.instruments.isClosed, false), isNull(schema.instruments.deletedAt)));
  return rows.map((row) => row.userId);
}
