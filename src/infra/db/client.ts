import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { config } from "@/core/config";
import * as schema from "./schema";

/**
 * The libSQL connection, created once per process.
 *
 * Next.js hot-reload re-evaluates modules on every edit, which would otherwise
 * leak a new client per save until the dev server runs out of handles — so the
 * instance is parked on `globalThis` in development. In production the module is
 * evaluated once and the cache is inert.
 *
 * There is no connection pool to size and no `connectToDatabase()` to await:
 * libSQL talks HTTP to Turso, or opens a local file. That is the whole reason
 * this replaced a Mongo connection manager with retry and DNS-override logic.
 */
declare global {
  // eslint-disable-next-line no-var
  var __libsqlClient: Client | undefined;
}

function createLibsqlClient(): Client {
  const { url, authToken } = config.db();
  return createClient({ url, ...(authToken ? { authToken } : {}) });
}

const client: Client =
  globalThis.__libsqlClient ?? (globalThis.__libsqlClient = createLibsqlClient());

export type Database = LibSQLDatabase<typeof schema>;

/**
 * The Drizzle handle. Only `infrastructure/` layers may import this — domain and
 * application code depends on repository ports instead (see ARCHITECTURE.md §3).
 */
export const db: Database = drizzle(client, { schema });

export { schema };
