import type { UserId } from "@/shared/kernel/UserId";
import type { CalendarDate } from "@/shared/time/CalendarDate";
import type { DateRange } from "@/shared/time/DateRange";
import type { JournalEntry } from "../entities/JournalEntry";
import type { AccountId, JournalEntryId } from "../ids";

export interface JournalQuery {
  /** Only entries touching one of these accounts. */
  accountIds?: readonly AccountId[];
  range?: DateRange;
  /** Free-text match against the narration and reference. */
  search?: string;
  importBatchId?: string;
  limit?: number;
  offset?: number;
}

export interface JournalPage {
  entries: readonly JournalEntry[];
  /** Total matching the query, ignoring limit/offset — for pagination. */
  totalCount: number;
}

/**
 * Persistence for journal entries.
 *
 * Whole aggregates only: `save` writes the entry and all its postings in one
 * database transaction, and there is deliberately no way to add, edit or remove a
 * single posting. A partial write would leave an unbalanced entry in the table,
 * which is exactly the state {@link JournalEntry}'s constructor exists to prevent.
 *
 * There is no `update`. Entries are append-only; corrections go through
 * `JournalEntry.reverse()` and are saved as new entries.
 */
export interface JournalRepository {
  /** Writes the entry and its postings atomically. */
  save(entry: JournalEntry): Promise<void>;

  /** Writes many entries in one transaction — an import either lands or doesn't. */
  saveMany(entries: readonly JournalEntry[]): Promise<void>;

  findById(userId: UserId, id: JournalEntryId): Promise<JournalEntry | null>;

  find(userId: UserId, query: JournalQuery): Promise<JournalPage>;

  /**
   * Whether an imported row is already present. Checked before building the
   * entry so a duplicate is a friendly skip rather than a unique-index error.
   */
  existsWithFingerprint(userId: UserId, fingerprint: string): Promise<boolean>;

  /** Which of these fingerprints already exist — one round trip per import. */
  findExistingFingerprints(
    userId: UserId,
    fingerprints: readonly string[],
  ): Promise<ReadonlySet<string>>;

  /** True when this entry has already been reversed, so it is not reversed twice. */
  hasReversal(userId: UserId, id: JournalEntryId): Promise<boolean>;

  /** Undo an import. Returns how many entries were removed. */
  deleteByImportBatch(userId: UserId, importBatchId: string): Promise<number>;

  /**
   * Hard-deletes an entry and its postings.
   *
   * Reserved for entries with no downstream references — an import being undone,
   * or a trade being deleted along with the entry it wrote. User-facing
   * corrections use `reverse()` so history survives.
   */
  delete(userId: UserId, id: JournalEntryId): Promise<void>;

  /** The earliest posted date, used to size the net-worth timeline. */
  earliestPostedOn(userId: UserId): Promise<CalendarDate | null>;
}
