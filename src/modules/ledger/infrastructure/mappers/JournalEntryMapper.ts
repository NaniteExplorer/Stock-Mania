import { UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import type { journalEntries, postings } from "@/infra/db/schema";
import {
  JournalEntry,
  type EntryKind,
  type EntrySource,
} from "../../domain/entities/JournalEntry";
import { Posting } from "../../domain/entities/Posting";
import { AccountId, JournalEntryId, PostingId } from "../../domain/ids";
import type { PostingDirection } from "../../domain/value-objects/PostingDirection";

type EntryRow = typeof journalEntries.$inferSelect;
type EntryInsert = typeof journalEntries.$inferInsert;
type PostingRow = typeof postings.$inferSelect;
type PostingInsert = typeof postings.$inferInsert;

/**
 * Translates between the `journal_entries` + `postings` rows and the
 * `JournalEntry` aggregate.
 *
 * Always both tables together. Rehydrating an entry without its postings would
 * produce an object that fails its own constructor, so there is no method here
 * that maps one without the other.
 */
export const JournalEntryMapper = {
  toDomain(entry: EntryRow, postingRows: readonly PostingRow[]): JournalEntry {
    return JournalEntry.rehydrate({
      id: JournalEntryId.from(entry.id),
      userId: UserId.from(entry.userId),
      postedOn: CalendarDate.parse(entry.postedOn),
      narration: entry.narration,
      kind: entry.kind as EntryKind,
      source: entry.source as EntrySource,
      postings: postingRows.map((row) =>
        Posting.rehydrate({
          id: PostingId.from(row.id),
          accountId: AccountId.from(row.accountId),
          direction: row.direction as PostingDirection,
          amount: Money.fromMinor(row.amountMinor, Currency.of(row.currency)),
          seq: row.seq,
          memo: row.memo,
        }),
      ),
      reference: entry.reference,
      importBatchId: entry.importBatchId,
      reversesEntryId: entry.reversesEntryId ? JournalEntryId.from(entry.reversesEntryId) : null,
      fingerprint: entry.fingerprint,
    });
  },

  /** Groups flat join rows into one aggregate per entry, preserving order. */
  toDomainMany(entryRows: readonly EntryRow[], postingRows: readonly PostingRow[]): JournalEntry[] {
    const byEntry = new Map<string, PostingRow[]>();
    for (const posting of postingRows) {
      const bucket = byEntry.get(posting.entryId);
      if (bucket) bucket.push(posting);
      else byEntry.set(posting.entryId, [posting]);
    }
    return entryRows.map((entry) => JournalEntryMapper.toDomain(entry, byEntry.get(entry.id) ?? []));
  },

  toEntryRow(entry: JournalEntry): EntryInsert {
    return {
      id: entry.id.value,
      userId: entry.userId.value,
      postedOn: entry.postedOn.toISO(),
      narration: entry.narration,
      kind: entry.kind,
      source: entry.source,
      reference: entry.reference,
      importBatchId: entry.importBatchId,
      reversesEntryId: entry.reversesEntryId?.value ?? null,
      fingerprint: entry.fingerprint,
    };
  },

  toPostingRows(entry: JournalEntry): PostingInsert[] {
    return entry.postings.map((posting) => ({
      id: posting.id.value,
      entryId: entry.id.value,
      accountId: posting.accountId.value,
      direction: posting.direction,
      // `Money` already holds the exact integer this column wants.
      amountMinor: posting.amount.toMinorNumber(),
      currency: posting.amount.currency.code,
      seq: posting.seq,
      memo: posting.memo,
    }));
  },
};
