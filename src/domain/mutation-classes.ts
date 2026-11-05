/**
 * The mutation-class registry (task 2.0) — which verbs each table admits.
 *
 * `ARCHITECTURE.md` §10: full CRUD verbs sit over an append-only ledger without
 * weakening it, because the verbs are a *presentation* over three storage
 * disciplines, and **every table belongs to exactly one class**:
 *
 * - **A — ledger**, append-only: post / reverse / tombstone / restore. An edit is
 *   a reversal plus a new posting, never an UPDATE (RULES §2.2).
 * - **B — reference**, mutable in place: create / update / tombstone / restore.
 * - **C — system**, derived or ingested: no user verbs at all.
 *
 * The registry is a `Record` over `TableName`, so a name without an entry does not
 * compile; `tests/mutation-classes.spec.ts` compares `TableName` with the actual
 * Drizzle schema, so a new table nobody classified fails the suite. The domain
 * cannot import the schema (layout rule), which is why the list lives here.
 */

export type MutationClass = "A" | "B" | "C";
export type Verb = "post" | "reverse" | "create" | "update" | "tombstone" | "restore";

export const VERBS_BY_CLASS: Readonly<Record<MutationClass, readonly Verb[]>> = Object.freeze({
  A: Object.freeze(["post", "reverse", "tombstone", "restore"] as const),
  B: Object.freeze(["create", "update", "tombstone", "restore"] as const),
  C: Object.freeze([] as const),
});

export const TABLE_NAMES = Object.freeze([
  "account", "asset_acquisitions", "audit_events", "budgets", "category_rules", "charge_rates", "commitment_price_steps",
  "corporate_actions", "cost_inflation_index", "counterparties", "cover_absence_declarations", "cpi_series",
  "card_minimum_dues", "credit_card_terms", "deposit_contributions", "deposit_terms", "documents", "fx_rates", "gold_leases",
  "import_batches", "import_rows", "income_price_steps", "income_receipts", "income_streams", "institutions",
  "instrument_catalog", "instrument_catalog_fetches", "instrument_catalog_links", "instrument_catalog_listings",
  "instrument_incomes", "instrument_provider_mappings", "instruments", "insurance_policies",
  "insurance_price_steps", "ledger_accounts", "ledger_events", "loan_prepayments", "loan_terms", "lot_matches",
  "lots", "market_holidays", "net_worth_snapshots", "nps_holdings", "owner_profiles", "postings", "price_bars",
  "price_divergences", "price_quotes", "projection_assumptions", "projection_cache", "provider_fetch_log", "rebalancing_bands", "recurring_commitments",
  "physical_assets", "physical_asset_valuations", "scheme_rates", "session", "target_allocations", "tax_rules", "tax_settings", "tier_history", "trades", "transactions", "txn_type_legality",
  "user", "verification",
] as const);

export type TableName = (typeof TABLE_NAMES)[number];

export interface Classification {
  readonly class: MutationClass;
  /** Why, when ARCHITECTURE §10 does not name the table itself. */
  readonly reason?: string;
}

/** Every classification is frozen: a shared object mutated once would reclassify every table using it. */
const classed = (mutationClass: MutationClass, reason?: string): Classification =>
  Object.freeze(reason === undefined ? { class: mutationClass } : { class: mutationClass, reason });
const A = classed("A");
const B = classed("B");
const C = classed("C");
const AUTH = classed("C", "Better-Auth table: no finance verbs.");
const CATALOG = classed("C", "Ingested instrument catalogue, refreshed by the system.");

export const MUTATION_CLASSES: Readonly<Record<TableName, Classification>> = Object.freeze({
  // A — ledger (ARCHITECTURE §10)
  transactions: A, postings: A, trades: A, lots: A, lot_matches: A, corporate_actions: A,
  import_batches: A, import_rows: A, deposit_contributions: A, instrument_incomes: A,

  // B — reference (ARCHITECTURE §10)
  category_rules: B, budgets: B, instruments: B, deposit_terms: B, loan_terms: B, credit_card_terms: B,
  tax_settings: B, institutions: B, counterparties: B, documents: B,
  ledger_accounts: classed("B", "Account headers are reference data; their postings are A (the straddling rule)."),
  // B — the four manual domains (§10, "and the four new domains")
  insurance_policies: B, insurance_price_steps: B, cover_absence_declarations: B,
  income_streams: B, income_price_steps: B, income_receipts: classed("B", "A link to a posting the owner states; the posting itself is A."),
  recurring_commitments: B, commitment_price_steps: B,
  physical_assets: B, physical_asset_valuations: B,
  // B — not named in §10, classified here
  nps_holdings: classed("B", "Owner-entered units; value comes from the NAV, never stored."),
  gold_leases: classed("B", "Lease terms header; any postings it generates are A."),
  owner_profiles: classed("B", "Owner facts such as date of birth; no postings."),
  projection_assumptions: classed("B", "Owner-stated projection inputs; replaced rows are tombstoned, never posted."),
  loan_prepayments: classed("B", "An effective-dated borrower decision that changes the schedule and posts nothing itself."),
  cpi_series: classed("B", "Owner-entered CPI Urban reference figures; corrected in place, tombstoned, never posted."),
  target_allocations: classed("B", "Owner-stated target allocation; replaced as a whole, removed sleeves tombstoned, never posted."),
  rebalancing_bands: classed("B", "Owner-stated rebalancing band; one live row per user, replaced in place, tombstoned, never posted."),
  card_minimum_dues: classed("B", "Owner-typed minimum due from a card statement; corrected in place, tombstoned, never posted."),
  asset_acquisitions: classed("B", "Owner-stated link from an acquisition posting to a physical asset (1.8); a side table so L12 holds. The posting itself is A."),

  // C — system (ARCHITECTURE §10)
  price_quotes: C, fx_rates: C, price_bars: C, audit_events: C, ledger_events: C, tax_rules: C,
  cost_inflation_index: C, net_worth_snapshots: C, projection_cache: C,
  // C — not named in §10, classified here
  charge_rates: classed("C", "Statutory charge rates, seeded."),
  scheme_rates: classed("C", "Published scheme rates, seeded."),
  market_holidays: classed("C", "Exchange calendar, ingested."),
  price_divergences: classed("C", "Derived from price comparisons."),
  provider_fetch_log: classed("C", "Operational fetch log."),
  tier_history: classed("C", "Tier shown per day, recorded by the system from the computed score for demotion hysteresis (3.4); no owner verbs."),
  instrument_provider_mappings: classed("C", "Maintained by the provider re-validation sweep."),
  txn_type_legality: classed("C", "Seeded legality rules (L06/L07)."),
  instrument_catalog: CATALOG, instrument_catalog_fetches: CATALOG, instrument_catalog_links: CATALOG,
  instrument_catalog_listings: CATALOG,
  // C — authentication
  user: AUTH, session: AUTH, account: AUTH, verification: AUTH,
});

/** Whether `verb` is legal on `table`. Disabled verbs are shown with a reason (DESIGN §6.1), never hidden. */
export function allows(table: TableName, verb: Verb): boolean {
  return VERBS_BY_CLASS[MUTATION_CLASSES[table].class].includes(verb);
}
