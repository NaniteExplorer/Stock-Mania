import type { InstrumentKind } from "@/domain/instruments";

/**
 * The identity of a digital-metal holding, derived rather than typed.
 *
 * A vault holding has no ticker and no ISIN. What distinguishes one from
 * another is the metal, its purity, and the platform sitting on the grams —
 * SafeGold 24K and Tanishq 24K are two holdings with two cost bases, which is
 * exactly the distinction `AddInstrument` keys idempotency on. Deriving the
 * symbol here rather than asking for it keeps that key out of the user's hands:
 * a typo in a free-text symbol field is a second, silently separate holding.
 *
 * The symbol submitted is the **bare** purity slug. `AddInstrument` qualifies it
 * per platform on its own (`GOLD999` -> `GOLD999.SAFEGOLD`) and pins `quoteRef`
 * to the bare form so the metal still prices; pre-qualifying it here would hand
 * the price feed a key no source has heard of.
 *
 * That contract only became true with this feature. `AddInstrument` used to look
 * the bare symbol up and nothing else, so every buy after the first on a second
 * platform minted `GOLD999.TANISHQ.2`, `.3`, … — one holding per purchase, and a
 * sale that could not find its own grams. `tests/metal-platform-holdings.spec.ts`
 * is what now holds it in place.
 */
export interface MetalPurity {
  /** Also the quote key. Whitelisted server-side; never invented client-side. */
  readonly slug: MetalQuoteRef;
  readonly label: string;
}

export type MetalQuoteRef = "GOLD999" | "GOLD995" | "SILVER999" | "PLATINUM999";

export type MetalKind = Extract<
  InstrumentKind,
  "DIGITAL_GOLD" | "DIGITAL_SILVER" | "DIGITAL_PLATINUM"
>;

export interface MetalLane {
  readonly kind: MetalKind;
  readonly label: string;
  readonly noun: string;
  readonly purities: readonly MetalPurity[];
}

export const METAL_LANES: readonly MetalLane[] = [
  {
    kind: "DIGITAL_GOLD",
    label: "Gold",
    noun: "gold",
    purities: [
      { slug: "GOLD999", label: "24K · 999 fine" },
      { slug: "GOLD995", label: "24K · 995 fine" },
    ],
  },
  {
    kind: "DIGITAL_SILVER",
    label: "Silver",
    noun: "silver",
    purities: [{ slug: "SILVER999", label: "999 fine" }],
  },
  {
    kind: "DIGITAL_PLATINUM",
    label: "Platinum",
    noun: "platinum",
    purities: [{ slug: "PLATINUM999", label: "999 fine" }],
  },
];

export function metalLane(kind: MetalKind): MetalLane {
  const lane = METAL_LANES.find((candidate) => candidate.kind === kind);
  if (!lane) throw new Error(`Unknown metal kind ${kind}`);
  return lane;
}

/** Whether a purity belongs to the metal it was submitted with. */
export function isPurityOf(kind: MetalKind, slug: string): slug is MetalQuoteRef {
  return METAL_LANES.some(
    (lane) => lane.kind === kind && lane.purities.some((purity) => purity.slug === slug),
  );
}

export function metalDisplayName(kind: MetalKind, platformName: string): string {
  const lane = metalLane(kind);
  const platform = platformName.trim();
  return platform ? `Digital ${lane.noun} - ${platform}` : `Digital ${lane.noun}`;
}

/**
 * What a metal entry costs, from the amount rather than the rate.
 *
 * A bullion app does not sell a rate. It takes a round rupee amount, subtracts
 * GST, and credits whatever grams that buys — which is why a receipt reads
 * "₹5,000, 0.3481g" and the implied rate is 13932.777 per gram. That rate
 * cannot be stored: a trade price is `Money`, two decimals, so the form that
 * asked for it refused every real receipt it was shown.
 *
 * So the amount is the input and the rate is derived, the same way the holding
 * page's opening-position form already does it. Charges come **out of** a
 * purchase total and are **added back into** a sale total, so that in both
 * directions the number the user types is the number that moved:
 *
 *   BUY   cash out = (total − charges) + charges = total
 *   SELL  cash in  = (total + charges) − charges = total
 *
 * Integer paise throughout, because this is the figure shown next to a receipt.
 */
export interface MetalPricing {
  /** Paise. What the metal itself cost or fetched, charges excluded. */
  readonly considerationMinor: bigint;
  /** Paise per gram, rounded half-up — what is stored as the trade price. */
  readonly ratePerGramMinor: bigint;
  /** Paise, signed: negative when cash leaves. */
  readonly signedMinor: bigint;
}

export function metalPricing(input: {
  side: "BUY" | "SELL";
  grams: string;
  total: string;
  charges: readonly string[];
}): { ok: true; value: MetalPricing } | { ok: false; message: string } {
  const grams_ = input.grams.replace(/[\s,]/g, "").replace(/g$/i, "");
  const total_ = input.total.replace(/[\s,₹]/g, "");
  if (!/^\d+(\.\d{1,8})?$/.test(grams_)) {
    return { ok: false, message: "Enter the grams credited, as the receipt shows them." };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(total_)) {
    return {
      ok: false,
      message:
        "Enter the rupee total from the receipt — rupees and paise, at most two decimal " +
        "places. This is the amount that changed hands, not the rate per gram.",
    };
  }

  const grams = scaled(grams_, 8);
  const total = scaled(total_, 2);
  if (grams <= 0n) return { ok: false, message: "Grams must be positive." };
  if (total <= 0n) return { ok: false, message: "The amount must be positive." };

  const charges = input.charges.reduce(
    (sum, value) => sum + (value && /^\d+(\.\d{1,2})?$/.test(value) ? scaled(value, 2) : 0n),
    0n,
  );
  const consideration = input.side === "BUY" ? total - charges : total + charges;
  if (consideration <= 0n) {
    return {
      ok: false,
      message:
        "The charges cannot be the whole amount — that would leave nothing paid for the metal itself.",
    };
  }

  return {
    ok: true,
    value: {
      considerationMinor: consideration,
      ratePerGramMinor: divideHalfUp(consideration * 100_000_000n, grams),
      signedMinor: input.side === "BUY" ? -total : total,
    },
  };
}

/** Paise (or eight-decimal units) as an integer, so nothing is a float. */
function scaled(value: string, decimals: number): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.slice(0, decimals).padEnd(decimals, "0"));
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return (numerator % denominator) * 2n >= denominator ? quotient + 1n : quotient;
}

export function formatMinor(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}
