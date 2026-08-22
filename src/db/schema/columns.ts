import { sql } from "drizzle-orm";
import { integer, text } from "drizzle-orm/sqlite-core";

/**
 * Shared column builders.
 *
 * Money is an `INTEGER` count of minor units (paise) — never a float, and never
 * a decimal string. `Money` already holds exactly this integer, so the value
 * crosses the driver boundary without conversion, which is the property the old
 * float column lacked.
 *
 * Every builder is a function because Drizzle column builders are stateful;
 * reusing one instance across tables corrupts the schema.
 */

/** Count of minor units. Suffix the field name `Minor` to keep call sites honest. */
export const moneyMinor = (name: string) => integer(name);

/** Unit count scaled by 1e8 — see `Quantity`. */
export const quantityScaled = (name: string) => integer(name);

/** Percentage scaled by 1e6 — see `Percentage`. */
export const percentScaled = (name: string) => integer(name);

/** A calendar date as `YYYY-MM-DD`, which sorts correctly as text in SQL. */
export const calendarDate = (name: string) => text(name);

/** An instant, in epoch milliseconds. */
export const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

/** `createdAt` / `updatedAt`, defaulted by the database. */
export const createdAt = () =>
  timestamp("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const updatedAt = () =>
  timestamp("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

/** ISO 4217 code. Stored per row so a foreign holding cannot lose its currency. */
export const currencyCode = () => text("currency", { length: 3 }).notNull().default("INR");
