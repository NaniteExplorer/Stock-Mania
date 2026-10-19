import type { InstrumentKind } from "@/domain/instruments";

export interface EstimatedChargeLine {
  readonly key: "brokerage" | "exchange" | "stt" | "sebi" | "stamp" | "gst";
  readonly label: string;
  readonly minor: bigint;
}

export interface InvestmentChargeEstimate {
  readonly supported: boolean;
  readonly note: string;
  readonly lines: readonly EstimatedChargeLine[];
  readonly brokerageMinor: bigint;
  readonly exchangeFeesMinor: bigint;
  readonly statutoryMinor: bigint;
  readonly totalMinor: bigint;
  readonly grossCashMinor: bigint;
}

const FUND_KINDS = new Set<InstrumentKind>(["INDEX_FUND", "MUTUAL_FUND", "LIQUID_FUND", "DEBT_FUND", "ELSS_FUND"]);

/**
 * A deliberately narrow browser preview of the verified rows already seeded in
 * `charge_rates`. Contract-note figures remain the persisted authority.
 */
export function estimateInvestmentCharges(input: {
  kind: InstrumentKind;
  side: "BUY" | "SELL";
  segment: "EQ_DELIVERY" | "EQ_INTRADAY";
  exchange: string;
  platformName: string;
  tradedOn: string;
  quantity: string;
  unitPrice: string;
}): InvestmentChargeEstimate | null {
  const quantity = decimal(input.quantity, 8);
  const price = decimal(input.unitPrice, 2);
  if (quantity === null || price === null || quantity <= 0n || price <= 0n) return null;
  const turnover = halfUp(quantity * price, 100_000_000n);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.tradedOn)) {
    return unsupported(turnover, "Choose a valid trade date before estimating charges.", input.side);
  }

  if (FUND_KINDS.has(input.kind)) {
    if (input.side === "SELL") return unsupported(turnover, "NAV is already net of TER. Enter scheme-specific exit load, STT and platform costs from the statement.", input.side);
    if (input.tradedOn < "2020-07-01") return unsupported(turnover, "No verified built-in mutual-fund purchase schedule is available for this trade date; use statement actuals.", input.side);
    const stamp = wholeRupee(rate(turnover, 5n, 100_000n)); // 0.005%
    return result(turnover, input.side, [line("stamp", "Subscription stamp duty (0.005%)", stamp)], true,
      "NAV is already net of TER; TER is not charged again. Exit load and platform fees stay manual.");
  }

  if (input.kind !== "LISTED_EQUITY" && input.kind !== "ETF") {
    return unsupported(turnover, "No verified automatic charge schedule for this investment type; use statement actuals.", input.side);
  }
  if (input.tradedOn < "2025-04-01") {
    return unsupported(turnover, "No verified built-in equity schedule is available for this trade date; use contract-note actuals.", input.side);
  }
  if (input.exchange.toUpperCase() !== "NSE") {
    return unsupported(turnover, "BSE transaction charges vary by scrip group; use contract-note actuals.", input.side);
  }
  const broker = normaliseBroker(input.platformName);
  if (broker === null) {
    return unsupported(turnover, "Generic/manual platform: enter itemised contract-note actuals.", input.side);
  }

  const delivery = input.segment === "EQ_DELIVERY";
  const brokerage = broker === "zerodha"
    ? (delivery ? 0n : min(rate(turnover, 3n, 10_000n), 2_000n))
    : min(rate(turnover, 1n, 1_000n), 2_000n);
  const stt = delivery
    ? wholeRupee(rate(turnover, 1n, 1_000n))
    : input.side === "SELL" ? wholeRupee(rate(turnover, 25n, 100_000n)) : 0n;
  const exchange = rate(turnover, 297n, 10_000_000n);
  const sebi = rate(turnover, 1n, 1_000_000n);
  const stamp = input.side === "BUY"
    ? wholeRupee(rate(turnover, delivery ? 15n : 3n, 100_000n))
    : 0n;
  const dp = input.side === "SELL" && delivery ? (broker === "zerodha" ? 1_534n : 1_850n) : 0n;
  const gst = rate(brokerage + exchange + sebi + dp, 18n, 100n);
  const lines = [
    line("brokerage", "Brokerage", brokerage),
    line("exchange", "NSE transaction charge", exchange),
    line("sebi", "SEBI turnover fee", sebi),
    line("stt", "STT", stt),
    line("stamp", "Stamp duty", stamp),
    ...(dp > 0n ? [line("exchange", "DP charge (one scrip-day estimate)", dp)] : []),
    line("gst", "GST on service charges", gst),
  ].filter((item) => item.minor > 0n);
  return result(turnover, input.side, lines, true,
    `${broker === "zerodha" ? "Zerodha" : "Groww"} ${delivery ? "delivery" : "intraday"} estimate from effective 2025-04-01 rules; replace with contract-note actuals.`);
}

function result(turnover: bigint, side: "BUY" | "SELL", lines: readonly EstimatedChargeLine[], supported: boolean, note: string): InvestmentChargeEstimate {
  const sum = (keys: readonly EstimatedChargeLine["key"][]) => lines.filter((item) => keys.includes(item.key)).reduce((total, item) => total + item.minor, 0n);
  const total = lines.reduce((amount, item) => amount + item.minor, 0n);
  return { supported, note, lines, brokerageMinor: sum(["brokerage"]), exchangeFeesMinor: sum(["exchange", "sebi"]), statutoryMinor: sum(["stt", "stamp", "gst"]), totalMinor: total, grossCashMinor: side === "BUY" ? turnover + total : turnover - total };
}

function unsupported(turnover: bigint, note: string, side: "BUY" | "SELL"): InvestmentChargeEstimate {
  return result(turnover, side, [], false, note);
}
function line(key: EstimatedChargeLine["key"], label: string, minor: bigint): EstimatedChargeLine { return { key, label, minor }; }
function normaliseBroker(value: string): "zerodha" | "groww" | null { const name = value.trim().toLowerCase(); return name.includes("zerodha") ? "zerodha" : name.includes("groww") ? "groww" : null; }
function rate(amount: bigint, numerator: bigint, denominator: bigint): bigint { return halfUp(amount * numerator, denominator); }
function wholeRupee(amount: bigint): bigint { return halfUp(amount, 100n) * 100n; }
function min(a: bigint, b: bigint): bigint { return a < b ? a : b; }
function halfUp(numerator: bigint, denominator: bigint): bigint { const q = numerator / denominator; return numerator % denominator * 2n >= denominator ? q + 1n : q; }
function decimal(value: string, places: number): bigint | null { if (!new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(value)) return null; const [whole, fraction = ""] = value.split("."); return BigInt(whole + fraction.padEnd(places, "0")); }
export function formatChargeMinor(value: bigint): string { return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`; }
