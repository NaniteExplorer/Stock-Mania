import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { asc, eq } from "drizzle-orm";
import * as schema from "@/infra/db/schema";
import { instrumentCatalogLinks, instrumentCatalogListings, instrumentProviderMappings, instruments, ledgerAccounts, users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { Clock, UserId } from "@/core/kernel";
import { CatalogSnapshot, InstrumentMasterProvider } from "@/domain/instrument-catalog";
import { RefreshInstrumentCatalog, SearchInstrumentCatalog, LinkPortfolioInstrumentCatalog } from "@/app/instrument-catalog.usecases";
import { DrizzleInstrumentCatalogRepository } from "@/infra/repositories";
import { check, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/instrument-catalog.db";

class MutableClock implements Clock {
  constructor(private instant: Date) {}
  now() { return new Date(this.instant); }
  today() { return this.instant.toISOString().slice(0, 10); }
  advance(hours: number) { this.instant = new Date(this.instant.getTime() + hours * 60 * 60 * 1_000); }
}

class QueueProvider implements InstrumentMasterProvider {
  calls = 0;
  constructor(readonly source: string, private readonly results: (() => ReturnType<InstrumentMasterProvider["fetch"]>)[]) {}
  async fetch() {
    const next = this.results[Math.min(this.calls, this.results.length - 1)];
    this.calls += 1;
    return next();
  }
}

function snapshot(at: Date, token: string): CatalogSnapshot {
  return {
    source: "UPSTOX_PUBLIC",
    fetchedAt: at,
    checksum: token.padEnd(64, "0"),
    instruments: [{
      verifiedIsin: "INE467B01029",
      name: "TATA CONSULTANCY SERV LT",
      instrumentType: "EQUITY",
      listing: {
        exchange: "NSE", segment: "NSE_EQ", symbol: "TCS", name: "TATA CONSULTANCY SERV LT",
        instrumentType: "EQUITY", currency: "INR",
      },
      providerMappings: [{
        provider: "UPSTOX", providerInstrumentId: `NSE_EQ|${token}`,
        providerToken: token, tradingSymbol: "TCS", effectiveFrom: at.toISOString().slice(0, 10),
      }],
    }],
    mappings: [],
  };
}

async function main() {
  for (const suffix of ["", "-shm", "-wal"]) {
    try { rmSync(DB_FILE + suffix); } catch { /* absent */ }
  }
  const client = createClient({ url: "file:" + DB_FILE });
  const db = drizzle(client, { schema }) as unknown as Database;
  const dir = "./src/infra/db/migrations";
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${dir}/${file}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.execute(statement.trim());
    }
  }

  const clock = new MutableClock(new Date("2026-09-06T04:00:00.000Z"));
  const provider = new QueueProvider("UPSTOX_PUBLIC", [
    async () => ({ ok: true as const, snapshot: snapshot(clock.now(), "11536") }),
    async () => ({ ok: false as const, error: "UPSTOX_PUBLIC is unavailable." }),
    async () => ({ ok: true as const, snapshot: snapshot(clock.now(), "21536") }),
  ]);
  const repo = new DrizzleInstrumentCatalogRepository(db);
  const refresh = new RefreshInstrumentCatalog(repo, provider, null, clock);
  const search = new SearchInstrumentCatalog(repo, clock);

  section("daily refresh and cached search");
  const first = await refresh.execute();
  check("first public refresh succeeds", first.status, "REFRESHED");
  check("one provider request was made", provider.calls, 1);
  const sameDay = await refresh.execute();
  check("a second same-day request uses current cache", sameDay.status, "CURRENT");
  check("the public provider is not called twice in a day", provider.calls, 1);

  const exact = await search.execute({ query: "TCS" });
  check("unique exact symbol preselects", exact.matchState, "EXACT");
  checkTrue("internal identity is distinct from provider token", exact.selected?.catalogInstrumentId !== "11536");
  check("token is exposed only under provider mappings", exact.selected?.providerMappings[0].providerToken, "11536");
  const truncated = await search.execute({ query: "TATA CONSULTANCY SERVICES LTD" });
  check("truncated provider name remains a candidate", truncated.candidates.length, 1);
  check("truncated provider name needs confirmation", truncated.matchState, "CONFIRM");

  section("outage fallback and mapping history");
  clock.advance(25);
  const outage = await refresh.execute();
  check("provider outage uses persisted cache", outage.status, "CACHE_FALLBACK");
  checkTrue("cache remains available", outage.cacheAvailable);
  check("search still works during outage", (await search.execute({ query: "TCS" })).matchState, "EXACT");
  const deferred = await refresh.execute();
  check("a failed attempt is also suppressed for one day", deferred.status, "CACHE_FALLBACK");
  check("outage retry does not hammer the provider", provider.calls, 2);

  clock.advance(25);
  const recovered = await refresh.execute();
  check("a later refresh recovers", recovered.status, "REFRESHED");
  const mappings = await db.select().from(instrumentProviderMappings)
    .where(eq(instrumentProviderMappings.provider, "UPSTOX"))
    .orderBy(asc(instrumentProviderMappings.effectiveFrom));
  check("token change creates effective-dated mapping history", mappings.length, 2);
  check("old provider token is retained", mappings[0].providerToken, "11536");
  checkTrue("old mapping is closed", mappings[0].effectiveThrough !== null);
  check("new provider token is active", mappings[1].providerToken, "21536");
  check("active mapping has no end", mappings[1].effectiveThrough, null);

  section("canonical identity link");
  const userId = UserId.from("catalog-user");
  await db.insert(users).values({
    id: userId.value, name: "Catalog", email: "catalog@example.com", emailVerified: true,
    createdAt: clock.now(), updatedAt: clock.now(),
  });
  await db.insert(ledgerAccounts).values({
    id: "catalog-account", userId: userId.value, code: "Assets:Catalog", name: "Catalog",
    type: "ASSET", subtype: "BROKERAGE", currency: "INR",
  });
  await db.insert(instruments).values({
    id: "portfolio-tcs", userId: userId.value, symbol: "TCS", name: "TCS",
    kind: "EQUITY", taxAssetClass: "LISTED_EQUITY", assetAccountId: "catalog-account",
  });
  const current = await search.execute({ query: "TCS" });
  const linked = await new LinkPortfolioInstrumentCatalog(repo, clock).execute({
    userId,
    portfolioInstrumentId: "portfolio-tcs",
    catalogInstrumentId: current.selected!.catalogInstrumentId,
    listingId: current.selected!.listing.id,
  });
  checkTrue("selected canonical identity persists", linked.linked);
  check("one durable holding link exists", (await db.select().from(instrumentCatalogLinks)).length, 1);

  section("soft-delete boundary");
  await db.update(instrumentCatalogListings)
    .set({ deletedAt: clock.now() })
    .where(eq(instrumentCatalogListings.id, current.selected!.listing.id));
  const afterTombstone = await search.execute({ query: "TCS" });
  check("a tombstoned catalogue listing is absent from search", afterTombstone.matchState, "MANUAL");

  client.close();
  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
