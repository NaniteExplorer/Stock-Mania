/**
 * The whole database schema, re-exported for the Drizzle client and for
 * `drizzle-kit` migration generation.
 *
 * Tables are grouped by the module that owns them. A module's `infrastructure/`
 * layer reads and writes only its own tables; cross-module data is fetched
 * through the owning module's `application/` layer (ARCHITECTURE.md §3, rule 5).
 */
export * from "./auth";
export * from "./ledger";
export * from "./investments";
export * from "./budgeting";
export * from "./tax";
export * from "./importing";
export * from "./analytics";
