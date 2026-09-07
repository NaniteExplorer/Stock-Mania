import { Clock, UserId } from "@/core/kernel";
import {
  CatalogIngestReport,
  CatalogSearchOutput,
  CatalogInstrumentId,
  InstrumentCatalogRepository,
  InstrumentMasterProvider,
  isCatalogAttemptDue,
  isRefreshDue,
  normalizeCatalogText,
  toCatalogSearchCandidate,
} from "@/domain/instrument-catalog";

const PUBLIC_SOURCE = "UPSTOX_PUBLIC";

export class SearchInstrumentCatalog {
  constructor(
    private readonly catalog: InstrumentCatalogRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: { query: string; limit?: number }): Promise<CatalogSearchOutput> {
    const query = normalizeCatalogText(input.query);
    const latest = await this.catalog.latestSuccessfulFetch(PUBLIC_SOURCE);
    const cache = {
      status: (latest ? "READY" : "EMPTY") as "READY" | "EMPTY",
      source: latest?.source ?? null,
      fetchedAt: latest?.fetchedAt.toISOString() ?? null,
      checksum: latest?.checksum ?? null,
      stale: latest === null || isRefreshDue(latest, this.clock),
    };

    if (query.length === 0) {
      return {
        query,
        matchState: "MANUAL",
        selected: null,
        candidates: [],
        manualEntryAllowed: true,
        cache,
      };
    }

    const rows = await this.catalog.search(query, Math.min(Math.max(input.limit ?? 20, 1), 50));
    const candidates = rows.candidates.map(toCatalogSearchCandidate);
    const selected = rows.exactIdentifierMatches.length === 1
      ? toCatalogSearchCandidate(rows.exactIdentifierMatches[0])
      : null;

    return {
      query,
      matchState: selected ? "EXACT" : candidates.length > 0 ? "CONFIRM" : "MANUAL",
      selected,
      candidates,
      manualEntryAllowed: true,
      cache,
    };
  }
}

export interface RefreshInstrumentCatalogOutput {
  readonly status: "REFRESHED" | "CURRENT" | "CACHE_FALLBACK" | "EMPTY_MANUAL_ONLY";
  readonly cacheAvailable: boolean;
  readonly sources: readonly {
    readonly source: string;
    readonly outcome: "REFRESHED" | "CURRENT" | "FAILED";
    readonly fetchedAt: string | null;
    readonly checksum: string | null;
    readonly report: CatalogIngestReport | null;
    readonly error: string | null;
  }[];
}

/** Refreshes a public master at most once per rolling day and keeps the last cache on failure. */
export class RefreshInstrumentCatalog {
  constructor(
    private readonly catalog: InstrumentCatalogRepository,
    private readonly publicMaster: InstrumentMasterProvider,
    private readonly optionalMappings: InstrumentMasterProvider | null,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<RefreshInstrumentCatalogOutput> {
    const sources: RefreshInstrumentCatalogOutput["sources"][number][] = [];
    let refreshed = false;
    let failed = false;

    for (const provider of [this.publicMaster, this.optionalMappings].filter(
      (candidate): candidate is InstrumentMasterProvider => candidate !== null,
    )) {
      const latest = await this.catalog.latestSuccessfulFetch(provider.source);
      const latestAttempt = await this.catalog.latestFetchAttempt(provider.source);
      if (!isCatalogAttemptDue(latestAttempt, this.clock)) {
        const previousFailed = latestAttempt?.outcome === "FAILED";
        failed ||= previousFailed;
        sources.push({
          source: provider.source,
          outcome: previousFailed ? "FAILED" : "CURRENT",
          fetchedAt: latest?.fetchedAt.toISOString() ?? null,
          checksum: latest?.checksum ?? null,
          report: null,
          error: previousFailed ? `${provider.source} is unavailable; retry is deferred for one day.` : null,
        });
        continue;
      }

      let fetched;
      try {
        fetched = await provider.fetch();
      } catch {
        fetched = { ok: false as const, error: `${provider.source} is unavailable.` };
      }
      if (!fetched.ok) {
        failed = true;
        await this.catalog.recordFetchFailure(provider.source, this.clock.now());
        sources.push({
          source: provider.source,
          outcome: "FAILED",
          fetchedAt: latest?.fetchedAt.toISOString() ?? null,
          checksum: latest?.checksum ?? null,
          report: null,
          // Providers own this text and must keep credentials/URLs out of it.
          error: fetched.error,
        });
        continue;
      }

      const report = await this.catalog.ingest(fetched.snapshot);
      refreshed = true;
      sources.push({
        source: provider.source,
        outcome: "REFRESHED",
        fetchedAt: fetched.snapshot.fetchedAt.toISOString(),
        checksum: fetched.snapshot.checksum,
        report,
        error: null,
      });
    }

    const cacheAvailable = (await this.catalog.count()) > 0;
    return {
      status: failed
        ? cacheAvailable ? "CACHE_FALLBACK" : "EMPTY_MANUAL_ONLY"
        : refreshed ? "REFRESHED" : "CURRENT",
      cacheAvailable,
      sources,
    };
  }
}

/** Persists which canonical catalogue row a user-owned instrument was created from. */
export class LinkPortfolioInstrumentCatalog {
  constructor(
    private readonly catalog: InstrumentCatalogRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    userId: UserId;
    portfolioInstrumentId: string;
    catalogInstrumentId: string;
    listingId: string;
  }): Promise<{ linked: boolean }> {
    const linked = await this.catalog.linkPortfolioInstrument({
      userId: input.userId,
      portfolioInstrumentId: input.portfolioInstrumentId,
      catalogInstrumentId: CatalogInstrumentId.from(input.catalogInstrumentId),
      listingId: input.listingId,
      linkedAt: this.clock.now(),
    });
    return { linked };
  }
}

export { PUBLIC_SOURCE as PUBLIC_INSTRUMENT_CATALOG_SOURCE };
