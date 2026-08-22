import { and, asc, count, desc, eq, gte, inArray, like, lte, min, or, sql } from "drizzle-orm";
import type { Database } from "@/infra/db/client";
import { journalEntries, postings } from "@/infra/db/schema";
import { type UserId } from "@/core/kernel";
import { CalendarDate } from "@/core/time";
import type { JournalEntry } from "../../domain/entities/JournalEntry";
import type { JournalEntryId } from "../../domain/ids";
import type {
  JournalPage,
  JournalQuery,
  JournalRepository,
} from "../../domain/ports/JournalRepository";
import { JournalEntryMapper } from "../mappers/JournalEntryMapper";

/** SQLite caps parameters per statement; batch anything unbounded. */
const PARAM_CHUNK = 400;

/**
 * libSQL implementation of {@link JournalRepository}.
 *
 * Entries and their postings are always written inside a single transaction. That
 * is not a nicety: a half-written entry is an unbalanced entry, which is the one
 * state the whole design exists to make impossible. `JournalEntry`'s constructor
 * guards the in-memory shape; this transaction guards the stored one.
 */
export class DrizzleJournalRepository implements JournalRepository {
  constructor(private readonly db: Database) {}

  async save(entry: JournalEntry): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(journalEntries).values(JournalEntryMapper.toEntryRow(entry));
      await tx.insert(postings).values(JournalEntryMapper.toPostingRows(entry));
    });
  }

  async saveMany(entries: readonly JournalEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db.transaction(async (tx) => {
      // Chunked so a large import does not exceed the statement parameter limit,
      // while still being one transaction overall — an import lands whole.
      for (let i = 0; i < entries.length; i += 50) {
        const batch = entries.slice(i, i + 50);
        await tx.insert(journalEntries).values(batch.map(JournalEntryMapper.toEntryRow));
        await tx.insert(postings).values(batch.flatMap(JournalEntryMapper.toPostingRows));
      }
    });
  }

  async findById(userId: UserId, id: JournalEntryId): Promise<JournalEntry | null> {
    const [entry] = await this.db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.userId, userId.value), eq(journalEntries.id, id.value)))
      .limit(1);
    if (!entry) return null;

    const postingRows = await this.db
      .select()
      .from(postings)
      .where(eq(postings.entryId, entry.id))
      .orderBy(asc(postings.seq));

    return JournalEntryMapper.toDomain(entry, postingRows);
  }

  async find(userId: UserId, query: JournalQuery): Promise<JournalPage> {
    const conditions = [eq(journalEntries.userId, userId.value)];

    if (query.range) {
      conditions.push(gte(journalEntries.postedOn, query.range.start.toISO()));
      conditions.push(lte(journalEntries.postedOn, query.range.end.toISO()));
    }
    if (query.importBatchId) {
      conditions.push(eq(journalEntries.importBatchId, query.importBatchId));
    }
    if (query.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      conditions.push(
        or(
          like(sql`lower(${journalEntries.narration})`, term),
          like(sql`lower(coalesce(${journalEntries.reference}, ''))`, term),
        )!,
      );
    }
    if (query.accountIds?.length) {
      // Entries touching any of these accounts. A subquery keeps the result one
      // row per entry — a join would duplicate an entry that has two matching legs.
      conditions.push(
        sql`${journalEntries.id} IN (
          SELECT ${postings.entryId} FROM ${postings}
          WHERE ${inArray(
            postings.accountId,
            query.accountIds.map((id) => id.value),
          )}
        )`,
      );
    }

    const where = and(...conditions);

    const [[totals], entryRows] = await Promise.all([
      this.db.select({ total: count() }).from(journalEntries).where(where),
      this.db
        .select()
        .from(journalEntries)
        .where(where)
        .orderBy(desc(journalEntries.postedOn), desc(journalEntries.createdAt))
        .limit(query.limit ?? 100)
        .offset(query.offset ?? 0),
    ]);

    if (entryRows.length === 0) {
      return { entries: [], totalCount: totals?.total ?? 0 };
    }

    const postingRows = await this.db
      .select()
      .from(postings)
      .where(
        inArray(
          postings.entryId,
          entryRows.map((row) => row.id),
        ),
      )
      .orderBy(asc(postings.seq));

    return {
      entries: JournalEntryMapper.toDomainMany(entryRows, postingRows),
      totalCount: totals?.total ?? 0,
    };
  }

  async existsWithFingerprint(userId: UserId, fingerprint: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(eq(journalEntries.userId, userId.value), eq(journalEntries.fingerprint, fingerprint)),
      )
      .limit(1);
    return row !== undefined;
  }

  async findExistingFingerprints(
    userId: UserId,
    fingerprints: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const found = new Set<string>();
    for (let i = 0; i < fingerprints.length; i += PARAM_CHUNK) {
      const chunk = fingerprints.slice(i, i + PARAM_CHUNK);
      const rows = await this.db
        .select({ fingerprint: journalEntries.fingerprint })
        .from(journalEntries)
        .where(
          and(eq(journalEntries.userId, userId.value), inArray(journalEntries.fingerprint, chunk)),
        );
      for (const row of rows) {
        if (row.fingerprint) found.add(row.fingerprint);
      }
    }
    return found;
  }

  async hasReversal(userId: UserId, id: JournalEntryId): Promise<boolean> {
    const [row] = await this.db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(eq(journalEntries.userId, userId.value), eq(journalEntries.reversesEntryId, id.value)),
      )
      .limit(1);
    return row !== undefined;
  }

  async deleteByImportBatch(userId: UserId, importBatchId: string): Promise<number> {
    // Postings go with the entry via ON DELETE CASCADE.
    const deleted = await this.db
      .delete(journalEntries)
      .where(
        and(
          eq(journalEntries.userId, userId.value),
          eq(journalEntries.importBatchId, importBatchId),
        ),
      )
      .returning({ id: journalEntries.id });
    return deleted.length;
  }

  async delete(userId: UserId, id: JournalEntryId): Promise<void> {
    await this.db
      .delete(journalEntries)
      .where(and(eq(journalEntries.userId, userId.value), eq(journalEntries.id, id.value)));
  }

  async earliestPostedOn(userId: UserId): Promise<CalendarDate | null> {
    const [row] = await this.db
      .select({ earliest: min(journalEntries.postedOn) })
      .from(journalEntries)
      .where(eq(journalEntries.userId, userId.value));
    return row?.earliest ? CalendarDate.parse(row.earliest) : null;
  }
}
