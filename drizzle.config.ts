import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next, so it does not get .env.local loaded for it.
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Use "file:./data/finance.db" locally, ' +
      "or your libsql:// URL from Turso.",
  );
}

export default defineConfig({
  dialect: "turso",
  schema: "./src/infra/db/schema.ts",
  out: "./src/infra/db/migrations",
  dbCredentials: {
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  },
  // Surfaces destructive changes before they run instead of after.
  strict: true,
  verbose: true,
});
