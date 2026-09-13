/**
 * The alias table: extra names an instrument is known by, keyed by ISIN.
 *
 * Keyed by **ISIN and not by ticker**, deliberately. A ticker changes (and
 * `TATAMOTORS.NS` did, and 404s now, C6); an ISIN does not. An alias table keyed by
 * ticker loses everything it learned the day the ticker moves — which is the day
 * the aliases are most needed.
 *
 * Where aliases come from: Moneycontrol autosuggest and Groww search, harvested
 * **offline** into this table (C11). Neither is ever a keystroke dependency; what
 * runs under the user's cursor is this in-memory map and the ranker beside it.
 * "Infy" finding INFOSYS is an alias that was harvested once, not a network call
 * made per character.
 *
 * Pure data and pure functions: no HTTP, no clock, nothing to inject.
 */

export interface AliasEntry {
  /** The ISIN this alias belongs to. The identity, and the reason for the shape. */
  readonly isin: string;
  /** The alias itself, as harvested. Normalised on the way in. */
  readonly alias: string;
  /** Where it came from, so a bad harvest can be dropped wholesale. */
  readonly source: "MONEYCONTROL" | "GROWW" | "MANUAL" | "CATALOGUE";
}

/**
 * Normalisation, applied to every alias and every query.
 *
 * `.`-to-`-` is C11's rule and it is here rather than in the ranker so that the
 * table and the query agree by construction: `BRK.B` and `BRK-B` must land on the
 * same key or the alias never matches.
 */
export function normaliseAlias(text: string): string {
  return text
    .trim()
    .toUpperCase()
    .replace(/\./g, "-")
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9\- ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class AliasTable {
  private readonly byAlias = new Map<string, Set<string>>();
  private readonly byIsin = new Map<string, Set<string>>();

  constructor(entries: readonly AliasEntry[] = []) {
    for (const entry of entries) this.add(entry);
  }

  add(entry: AliasEntry): void {
    const alias = normaliseAlias(entry.alias);
    const isin = entry.isin.trim().toUpperCase();
    if (!alias || !isin) return;

    const isins = this.byAlias.get(alias) ?? new Set<string>();
    isins.add(isin);
    this.byAlias.set(alias, isins);

    const aliases = this.byIsin.get(isin) ?? new Set<string>();
    aliases.add(alias);
    this.byIsin.set(isin, aliases);
  }

  /**
   * The ISINs an alias points at.
   *
   * A set, not one value: "TATA MOTORS" legitimately points at two ISINs after a
   * demerger, and collapsing that to one would pick the wrong one half the time.
   */
  isinsFor(alias: string): readonly string[] {
    return [...(this.byAlias.get(normaliseAlias(alias)) ?? [])];
  }

  aliasesOf(isin: string): readonly string[] {
    return [...(this.byIsin.get(isin.trim().toUpperCase()) ?? [])];
  }

  get size(): number {
    return this.byAlias.size;
  }

  /** Every entry, for persisting a harvest. */
  entries(): readonly { isin: string; alias: string }[] {
    const all: { isin: string; alias: string }[] = [];
    for (const [isin, aliases] of this.byIsin) {
      for (const alias of aliases) all.push({ isin, alias });
    }
    return all;
  }
}
