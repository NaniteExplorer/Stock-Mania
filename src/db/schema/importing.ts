import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { ledgerAccounts } from "./ledger";
import { createdAt, timestamp } from "./columns";

/**
 * One import run.
 *
 * Recorded so an import is undoable: every entry it created carries this batch's
 * id, so "undo that import" is a delete by `importBatchId` rather than the user
 * hunting down 200 rows by hand. It also makes the skip counts explainable —
 * "142 rows, 138 imported, 4 already present" beats a silent partial success.
 */
export const importBatches = sqliteTable(
  "import_batches",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["BANK_STATEMENT", "TRADE_BOOK", "HOLDINGS"] }).notNull(),
    /** The account the rows were booked against, for a statement import. */
    accountId: text("account_id").references(() => ledgerAccounts.id, { onDelete: "set null" }),
    fileName: text("file_name").notNull(),
    /** Hash of the file's bytes — flags re-uploading the identical file. */
    fileHash: text("file_hash").notNull(),
    rowsRead: integer("rows_read").notNull().default(0),
    rowsImported: integer("rows_imported").notNull().default(0),
    /** Skipped as already-present duplicates. */
    rowsDuplicate: integer("rows_duplicate").notNull().default(0),
    rowsFailed: integer("rows_failed").notNull().default(0),
    /** Per-row failure messages, as JSON, so the user can fix and retry. */
    problemsJson: text("problems_json"),
    status: text("status", { enum: ["COMPLETED", "PARTIAL", "FAILED", "UNDONE"] }).notNull(),
    completedAt: timestamp("completed_at"),
    createdAt: createdAt(),
  },
  (table) => [index("import_batches_user_idx").on(table.userId, table.createdAt)],
);
