/**
 * Pure model for /settings/allocation (financial-health-scoring.md § 3.6 follow-up).
 *
 * A sleeve is one instrument (sleeve id = instrument id, the board's mapping). The rows
 * are today's holdings plus any stored sleeve no longer held, so a stored target is
 * never hidden. Shares are decimal percent text; the running total is exact (scaled to
 * six places, as `Percentage` is), never a float sum. Validation of the whole is the
 * domain's (`targetAllocation`, `rebalancingBand`); this only prepares and reports.
 */
export interface SleeveRow {
  readonly id: string;
  readonly name: string;
  /** Stored share as percent text, or "" when this sleeve has no target. */
  readonly share: string;
  readonly held: boolean;
}

export interface StoredShare { readonly id: string; readonly share: string }
export interface Holding { readonly id: string; readonly name: string }
export interface ShareEntry { readonly id: string; readonly share: string }

export function buildSleeveRows(holdings: readonly Holding[], stored: readonly StoredShare[]): SleeveRow[] {
  const byId = new Map(stored.map((s) => [s.id, s.share]));
  const rows: SleeveRow[] = holdings.map((h) => ({ id: h.id, name: h.name, share: byId.get(h.id) ?? "", held: true }));
  const heldIds = new Set(holdings.map((h) => h.id));
  for (const s of stored) {
    if (!heldIds.has(s.id)) rows.push({ id: s.id, name: `Not held (${s.id})`, share: s.share, held: false });
  }
  return rows;
}

const SHARE = /^\d{1,3}(\.\d{1,6})?$/;
const SCALE = 1_000_000n;

/** Percent text to six-place scaled units, or null when it is not a plain decimal. */
export function scaledShare(text: string): bigint | null {
  const trimmed = text.trim();
  if (!SHARE.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole!) * SCALE + BigInt(fraction.padEnd(6, "0"));
}

/** Scaled units back to the shortest percent text. */
export function formatScaled(scaled: bigint): string {
  const whole = scaled / SCALE;
  const fraction = (scaled % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

export type ShareTotal =
  | { readonly kind: "invalid"; readonly ids: readonly string[] }
  | { readonly kind: "total"; readonly scaled: bigint; readonly text: string; readonly complete: boolean };

/** The exact running total of the entered shares; blank means "no target". */
export function totalOf(entries: readonly ShareEntry[]): ShareTotal {
  const invalid: string[] = [];
  let sum = 0n;
  for (const e of entries) {
    if (e.share.trim() === "") continue;
    const scaled = scaledShare(e.share);
    if (scaled === null) invalid.push(e.id);
    else sum += scaled;
  }
  if (invalid.length > 0) return { kind: "invalid", ids: invalid };
  return { kind: "total", scaled: sum, text: formatScaled(sum), complete: sum === 100n * SCALE };
}

/** The sleeves to submit: blank and zero shares are dropped (the domain refuses zero). */
export function sleevesToSubmit(entries: readonly ShareEntry[]): { id: string; share: string }[] {
  return entries
    .filter((e) => e.share.trim() !== "" && scaledShare(e.share) !== 0n)
    .map((e) => ({ id: e.id.trim(), share: e.share.trim() }));
}

/** Form field name for one sleeve's share. */
export const shareField = (id: string) => `share:${id}`;

/** Reads `share:<id>` fields back out of submitted form entries. */
export function sharesFromForm(entries: Iterable<[string, unknown]>): ShareEntry[] {
  const out: ShareEntry[] = [];
  for (const [key, value] of entries) {
    if (key.startsWith("share:") && typeof value === "string") out.push({ id: key.slice("share:".length), share: value });
  }
  return out;
}
