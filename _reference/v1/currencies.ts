export const SUPPORTED_CURRENCIES = [
  { code: "INR", symbol: "₹", name: "Indian Rupee" }, { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" }, { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "CHF", symbol: "CHF", name: "Swiss Franc" }, { code: "AED", symbol: "د.إ", name: "UAE Dirham" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar" }, { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar" }, { code: "AUD", symbol: "A$", name: "Australian Dollar" },
] as const;

export function formatCurrency(amount: number, currency = "INR", compact = false) {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export async function getCurrencyRates(base: string, symbols: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(symbols.map((code) => code.toUpperCase()).filter((code) => code !== base))];
  if (!unique.length) return { [base]: 1 };
  try {
    const response = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, { next: { revalidate: 3600 } });
    if (!response.ok) throw new Error("Rate provider unavailable");
    const data = await response.json() as { rates?: Record<string, number> };
    const selected = Object.fromEntries(unique.flatMap((code) => Number.isFinite(data.rates?.[code]) ? [[code, data.rates![code]]] : []));
    return { [base]: 1, ...selected };
  } catch { return { [base]: 1 }; }
}
