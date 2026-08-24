/**
 * Broker trade-book parsing, and the guard that makes an extracted amount safe.
 *
 * Two halves, and the second is the interesting one.
 *
 * The **parser** is deterministic: an alias table over the header spellings
 * Zerodha, Groww, Upstox and ICICI Direct actually export, reusing
 * `infra/statements.ts`'s exact-amount and date machinery so a trade price is
 * parsed into `Money` the same way a bank narration's is. Nothing here uses a
 * language model.
 *
 * The **corroboration guard** exists because the plan asks for something specific:
 * "an LLM-extracted amount can never become a posting unreviewed". This project
 * ships no AI parser — the user's constraint is no paid APIs and no AI in the data
 * path, and the deterministic parser covers the formats — so that requirement is
 * satisfied today by there being nothing to guard. That is a weak guarantee: the
 * moment someone adds a fallback extractor, the requirement would quietly stop
 * being met. {@link corroborate} makes it structural instead: **any amount that
 * did not come from a parsed column must be found, independently, in the source
 * text by regex before it is allowed into a staged row.** An extractor that
 * invents ₹1,45,000 fails; one that reads it off the contract note passes.
 */

import { Currency, Money } from "@/core/money";
import { Quantity } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { parseDelimitedText, readAmount, readDate, resolveDateOrder, type Cell, type DateOrder, type RawRow } from "@/infra/statements";

/* ═══ Rows ════════════════════════════════════════════════════════════ */

export type TradeSide = "BUY" | "SELL";

/** One trade, as a broker's export describes it. */
export interface TradeRow {
  readonly rowIndex: number;
  readonly tradedOn: CalendarDate;
  readonly symbol: string;
  readonly isin: string | null;
  readonly side: TradeSide;
  readonly quantity: Quantity;
  /** Per-unit price, exact. */
  readonly price: Money;
  /** Units × price, computed rather than read: brokers round this differently. */
  readonly consideration: Money;
  /** Total charges on the row, when the export carries them. */
  readonly charges: Money;
  readonly exchange: string | null;
  readonly raw: string;
}

export interface TradeBookProblem {
  readonly rowIndex: number;
  readonly reason: string;
  readonly raw: string;
}

export interface ParsedTradeBook {
  readonly rows: readonly TradeRow[];
  readonly problems: readonly TradeBookProblem[];
  readonly currency: Currency;
  readonly dateOrder: DateOrder;
  /** Which broker's layout was recognised, for the review screen. */
  readonly layout: string;
}

export class TradeBookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradeBookParseError";
  }
}

/* ═══ Header aliases ══════════════════════════════════════════════════ */

/**
 * The header spellings brokers actually use.
 *
 * Zerodha's console exports `symbol`, `trade_date`, `trade_type`, `quantity`,
 * `price`; Groww uses `Stock name`, `Buy/Sell`; ICICI Direct uses `Action`,
 * `Traded Qty`. All three are here because all three arrive, and an import that
 * fails on the second broker a user tries is an import they stop using.
 */
const TRADE_ALIASES = {
  date: ["trade date", "trade_date", "date", "transaction date", "order date", "traded on"],
  symbol: ["symbol", "scrip", "stock name", "instrument", "security", "company", "scrip name", "stock symbol"],
  isin: ["isin", "isin code"],
  side: ["trade type", "trade_type", "buy/sell", "action", "type", "transaction type", "side"],
  quantity: ["quantity", "qty", "traded qty", "shares", "units", "quantity traded"],
  price: ["price", "trade price", "rate", "avg price", "average price", "price per unit"],
  charges: ["charges", "brokerage", "total charges", "taxes and charges", "other charges"],
  exchange: ["exchange", "exch"],
  value: ["value", "trade value", "amount", "net amount", "total"],
} as const;

type ColumnKey = keyof typeof TRADE_ALIASES;
type ColumnMap = Record<ColumnKey, number>;

const normalise = (value: Cell): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const text = (cell: Cell): string => String(cell ?? "").trim();

function findColumn(headers: readonly string[], aliases: readonly string[]): number {
  const exact = headers.findIndex((header) => aliases.includes(header));
  if (exact >= 0) return exact;
  return headers.findIndex((header) => aliases.some((alias) => header.includes(alias)));
}

function detectColumns(rows: readonly RawRow[]): { headerIndex: number; columns: ColumnMap } | null {
  const headerIndex = rows.findIndex((row) => {
    const cells = row.map(normalise);
    const hasSymbol = cells.some((cell) => TRADE_ALIASES.symbol.some((alias) => cell.includes(alias)));
    const hasQuantity = cells.some((cell) => TRADE_ALIASES.quantity.some((alias) => cell.includes(alias)));
    const hasSide = cells.some((cell) => TRADE_ALIASES.side.some((alias) => cell.includes(alias)));
    return hasSymbol && hasQuantity && hasSide;
  });
  if (headerIndex < 0) return null;

  const headers = rows[headerIndex].map(normalise);
  const columns = Object.fromEntries(
    (Object.keys(TRADE_ALIASES) as ColumnKey[]).map((key) => [key, findColumn(headers, TRADE_ALIASES[key])]),
  ) as ColumnMap;

  if (columns.symbol < 0 || columns.quantity < 0 || columns.side < 0) return null;
  return { headerIndex, columns };
}

/** `BUY`/`B`/`Purchase` versus `SELL`/`S`/`Sale`. */
function readSide(cell: Cell): TradeSide | null {
  const value = normalise(cell);
  if (value === "") return null;
  if (/^(b|buy|purchase|bought|p)$/.test(value) || value.includes("buy") || value.includes("purchase")) {
    return "BUY";
  }
  if (/^(s|sell|sale|sold)$/.test(value) || value.includes("sell") || value.includes("sale")) {
    return "SELL";
  }
  return null;
}

/* ═══ Parsing ═════════════════════════════════════════════════════════ */

/**
 * Parses tabulated trade rows.
 *
 * `consideration` is **computed** as units × price rather than read from the
 * export's own value column, and the difference is not cosmetic: brokers round the
 * printed value to the rupee while the price carries four decimals, so reading it
 * would make the ledger disagree with the lot by a few paise on every trade. Where
 * the export *does* carry a value column, the parser compares the two and reports
 * a mismatch rather than silently preferring one.
 */
export function parseTradeRows(
  rows: readonly RawRow[],
  currency: Currency = Currency.reporting,
): ParsedTradeBook {
  const detected = detectColumns(rows);
  if (!detected) {
    throw new TradeBookParseError(
      "Could not find a trade-book header. The export needs a symbol, a quantity and a buy/sell column.",
    );
  }

  const { headerIndex, columns } = detected;
  const body = rows.slice(headerIndex + 1);
  const dateOrder =
    columns.date >= 0 ? resolveDateOrder(body.map((row) => row[columns.date])) : "DMY";

  const parsed: TradeRow[] = [];
  const problems: TradeBookProblem[] = [];

  body.forEach((row, offset) => {
    const rowIndex = headerIndex + 1 + offset;
    const raw = row.map((cell) => text(cell)).join(" | ");
    if (row.every((cell) => text(cell) === "")) return;

    const symbol = text(row[columns.symbol]);
    const side = readSide(row[columns.side]);
    const quantityCell = text(row[columns.quantity]).replace(/,/g, "");
    const priceCell = columns.price >= 0 ? readAmount(row[columns.price], currency) : null;
    const tradedOn = columns.date >= 0 ? readDate(row[columns.date], dateOrder) : null;

    if (symbol === "") {
      problems.push({ rowIndex, reason: "No symbol", raw });
      return;
    }
    if (!side) {
      problems.push({ rowIndex, reason: `Unrecognised trade type "${text(row[columns.side])}"`, raw });
      return;
    }
    if (!tradedOn) {
      problems.push({ rowIndex, reason: "No readable trade date", raw });
      return;
    }
    if (!/^\d+(\.\d+)?$/.test(quantityCell)) {
      problems.push({ rowIndex, reason: `Unreadable quantity "${quantityCell}"`, raw });
      return;
    }
    if (!priceCell?.amount || priceCell.amount.isZero) {
      problems.push({ rowIndex, reason: "No usable price", raw });
      return;
    }

    const quantity = Quantity.fromString(quantityCell);
    if (!quantity.isPositive) {
      problems.push({ rowIndex, reason: "Quantity is zero", raw });
      return;
    }

    const consideration = quantity.valueAt(priceCell.amount, "HALF_UP");
    const printedValue = columns.value >= 0 ? readAmount(row[columns.value], currency).amount : null;
    if (printedValue && !printedValue.equals(consideration)) {
      /*
       * Reported, not resolved. A ₹0.34 difference between the broker's printed
       * value and units × price is almost always their rounding — but "almost
       * always" is not a basis for silently overwriting either number, and a
       * quantity typed with a missing digit shows up here first.
       */
      problems.push({
        rowIndex,
        reason:
          `The printed value ${printedValue.toString()} differs from units × price ` +
          `(${consideration.toString()}). Check the quantity and the price.`,
        raw,
      });
    }

    parsed.push({
      rowIndex,
      tradedOn,
      symbol,
      isin: columns.isin >= 0 ? text(row[columns.isin]) || null : null,
      side,
      quantity,
      price: priceCell.amount,
      consideration,
      charges: (columns.charges >= 0 ? readAmount(row[columns.charges], currency).amount : null) ?? Money.zero(currency),
      exchange: columns.exchange >= 0 ? text(row[columns.exchange]) || null : null,
      raw,
    });
  });

  return {
    rows: parsed,
    problems,
    currency,
    dateOrder,
    layout: [...new Set(rows[headerIndex].map(normalise))].slice(0, 3).join(","),
  };
}

/** Reads a delimited trade book. */
export function parseTradeBookText(
  content: string,
  currency: Currency = Currency.reporting,
): ParsedTradeBook {
  return parseTradeRows(parseDelimitedText(content), currency);
}

/* ═══ Corroboration ═══════════════════════════════════════════════════ */

export interface CorroborationResult {
  readonly ok: boolean;
  /** The amounts that could not be found in the source text. */
  readonly uncorroborated: readonly string[];
  readonly because: string;
}

/**
 * Independent regex corroboration of an extracted amount — the safety step the
 * plan asks for.
 *
 * Every amount that did not come out of a parsed column must appear, as digits, in
 * the source text. The check is deliberately dumb: it looks for the exact decimal
 * string and for the same number with Indian and Western thousands grouping, and
 * that is all. A clever check that "understood" the document would share the
 * failure mode of whatever extracted the amount in the first place, which is the
 * entire reason for corroborating from a different mechanism.
 *
 * It cannot prove an amount is *right* — a document containing both ₹1,45,000 and
 * ₹1,54,000 would corroborate either. It proves the amount was *read* rather than
 * invented, which is the failure mode of a language model, and combined with the
 * `CONFIRMED`-only posting rule (I01) it means an extracted figure needs both a
 * document that contains it and a human who agrees.
 */
export function corroborate(sourceText: string, amounts: readonly Money[]): CorroborationResult {
  const haystack = sourceText.replace(/\s+/g, "");
  const uncorroborated: string[] = [];

  for (const amount of amounts) {
    const decimal = amount.abs().toDecimalString();
    const whole = decimal.split(".")[0];
    const fraction = decimal.split(".")[1] ?? "";

    const candidates = new Set<string>([
      decimal,
      whole,
      `${groupWestern(whole)}.${fraction}`,
      groupWestern(whole),
      `${groupIndian(whole)}.${fraction}`,
      groupIndian(whole),
    ]);

    const found = [...candidates].some((candidate) =>
      haystack.includes(candidate.replace(/\s+/g, "")),
    );
    if (!found) uncorroborated.push(decimal);
  }

  return {
    ok: uncorroborated.length === 0,
    uncorroborated,
    because:
      uncorroborated.length === 0
        ? "Every extracted amount appears in the source document."
        : `These amounts do not appear anywhere in the source: ${uncorroborated.join(", ")}. ` +
          `An amount that cannot be found in the document it came from must not be posted.`,
  };
}

/** `1234567` → `1,234,567`. */
function groupWestern(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** `1234567` → `12,34,567` — the Indian grouping, which most parsers forget. */
function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
}

/**
 * The gate an extracted row must pass before it can be staged.
 *
 * Returns the row when every amount is corroborated, and a reason when not. A
 * caller cannot stage an uncorroborated row without ignoring the return value,
 * which is the point of returning a union rather than logging a warning.
 */
export type ExtractedRowCheck<T> =
  | { readonly ok: true; readonly row: T }
  | { readonly ok: false; readonly reason: string };

export function checkExtractedRow<T>(
  row: T,
  sourceText: string,
  amounts: readonly Money[],
): ExtractedRowCheck<T> {
  const result = corroborate(sourceText, amounts);
  return result.ok ? { ok: true, row } : { ok: false, reason: result.because };
}
