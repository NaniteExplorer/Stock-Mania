/**
 * Bank statements whose columns can be recovered from the page geometry.
 *
 * `pdf-statements.ts` reconstructs a row from the *text* of a PDF, because for
 * many statements that is all there is. This module is the better path when it
 * is available: pdf.js reports an x/y for every run of glyphs, so the columns a
 * bank drew are still on the page as coordinates, and can simply be read.
 *
 * It exists because the text path cannot do this file at all. Axis prints debit
 * and credit as separate columns and fills exactly one of them, so the extracted
 * text of a debit and of a credit are the same shape:
 *
 *     4000.00 4000.00 1070     a credit  (balance 0 -> 4000)
 *       45.00 9955.00 1070     a debit   (balance 10000 -> 9955)
 *
 * Nothing in that text says which column the amount came from. The running
 * balance implies it, but inferring a direction is a guess, and a wrong guess
 * posts real money the wrong way. The coordinate is not a guess: the amount is a
 * debit because it was printed in the debit column.
 *
 * The output is a `RawRow[]` in exactly the shape a CSV parse produces, so
 * everything downstream - dates, amounts, roles, duplicates, categorisation - is
 * the code that already exists and is already tested. In particular this module
 * never decides what a column *means* when the page does not say: it recovers
 * the grid and hands the naming problem to `parseStatementRows`, which already
 * infers roles from content and scores the result against the running balance.
 */
import { type ColumnKey, type RawRow, headerRole } from "./statements";

/** The money columns this reader can place. */
const MONEY_ROLES = ["debit", "credit", "amount", "balance"] as const;
type MoneyRole = (typeof MONEY_ROLES)[number];

/**
 * How far from a column heading a number may sit and still belong to it.
 *
 * Amounts are right-aligned and the heading is not, so a column's numbers end
 * consistently to the *right* of its label - by 19pt for this file's debit
 * column and 27pt for its balance. The window has to absorb that offset while
 * staying well inside the ~65pt gap to the next column.
 */
const COLUMN_WINDOW = 60;

/** Two glyph runs are on the same visual line if their baselines are this close. */
const LINE_TOLERANCE = 2;

/** Right edges within this distance are the same column, when clustering. */
const CLUSTER_TOLERANCE = 6;

/** A cluster of right edges is a column only once this many amounts share it. */
const MIN_CLUSTER = 5;

/**
 * How many orphan prose lines may precede a record when there is no heading row
 * to mark where the letterhead ends.
 *
 * With a heading the boundary is exact and no cap is needed. Without one, the
 * account number and the branch address would otherwise accumulate and land in
 * the first transaction's narration.
 */
const MAX_ORPHAN_LINES = 3;

/**
 * A money token.
 *
 * The decimal point and its two digits are required, and that is what keeps
 * reference numbers and branch codes out of the amount columns - `1070` and a
 * twelve-digit UPI id both fail it.
 *
 * The whole-rupee part is optional, because this bank omits it below one rupee:
 * a one-paisa credit is printed `.01`, not `0.01`. Requiring the leading digits
 * silently dropped that amount, and the running balance was then one paisa short
 * for the rest of the statement.
 */
const MONEY = /^-?(?:\d{1,3}(?:,\d{3})*|\d+)?\.\d{2}$/;

/** `20-05-2025`, `20/05/2025` - a statement's own date column. */
const DATE = /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/;

/** The marker a single-amount-column statement uses to give a row its sign. */
const DR_CR = /^(dr|cr)\.?$/i;

/**
 * The located table.
 *
 * `edges` holds the right edge of each money column that was found. Which ones
 * are present decides the layout: a debit/credit pair, or one amount column
 * (usually with a Dr/Cr marker beside it). `balance` is optional throughout -
 * a statement that prints no running balance is still importable, it is simply
 * one that nothing downstream can check, and it is marked UNVERIFIED for it.
 *
 * `proseLeft` is derived from the date heading rather than hard-coded: the date
 * values sit under their own heading and the narration starts to the right of
 * it, so the heading's right edge separates the two on any layout that has one.
 */
interface Table {
  readonly edges: Readonly<Partial<Record<MoneyRole, number>>>;
  readonly type: number | null;
  readonly proseLeft: number;
  /** Left bound of the figures; prose ends here. */
  readonly amountsLeft: number;
  /** Were the columns named by a heading row, or inferred from the numbers? */
  readonly headed: boolean;
}

interface Item {
  readonly str: string;
  readonly x: number;
  readonly width: number;
  readonly y: number;
}

const rightEdge = (item: Item): number => item.x + item.width;

const isMoneyRole = (role: ColumnKey | null): role is MoneyRole =>
  role !== null && (MONEY_ROLES as readonly string[]).includes(role);

/**
 * Assemble a table from whatever edges were located, or `null` if they do not
 * describe a statement.
 *
 * The acceptance rule is about *direction*, which is the one thing this module
 * exists to get right: either the page separates debits from credits into two
 * columns, or it has a single amount column whose sign comes from somewhere else
 * (a leading minus, a Dr/Cr marker, or the balance movement). Anything less is
 * not a table this reader can claim.
 */
function assemble(
  edges: Partial<Record<MoneyRole, number>>,
  type: number | null,
  dateEdge: number | undefined,
  headed: boolean,
): Table | null {
  const paired = edges.debit !== undefined && edges.credit !== undefined;
  if (!paired && edges.amount === undefined) return null;

  // Debit left of credit. A pair in the other order is not the table this
  // reader thinks it is, and it should decline rather than transpose money.
  if (paired && !(edges.debit! < edges.credit!)) return null;

  const placed = MONEY_ROLES.map((role) => edges[role]).filter(
    (edge): edge is number => edge !== undefined,
  );
  /*
   * The running balance is the rightmost figure on every statement ever
   * printed - that is what a running balance is. Anything claiming to be one
   * with a money column to its right is a mis-read heading, and the classic
   * mis-read is the words "CLOSING BALANCE" printed as a label in the narration
   * column of the last page.
   */
  if (edges.balance !== undefined && Math.max(...placed) !== edges.balance) return null;

  const amountsLeft = Math.min(...placed);
  const proseLeft = dateEdge ?? 0;
  if (proseLeft >= amountsLeft) return null;

  return { edges, type, proseLeft, amountsLeft, headed };
}

/** The table named by this line's headings, if it names one. */
function tableFromHeadings(line: readonly Item[]): Table | null {
  const edges: Partial<Record<MoneyRole, number>> = {};
  let type: number | null = null;
  let dateEdge: number | undefined;

  for (const item of line) {
    const role = headerRole(item.str);
    if (isMoneyRole(role)) edges[role] ??= rightEdge(item);
    else if (role === "date") dateEdge ??= rightEdge(item);
    else if (role === "type") type ??= rightEdge(item);
  }
  return assemble(edges, type, dateEdge, true);
}

/**
 * The table, located from its own heading row.
 *
 * Two things make this bank-agnostic rather than Axis-specific. The headings are
 * matched through `headerRole`, so "Withdrawal Amt." and "Deposit Amt." are
 * recognised exactly as "Debit" and "Credit" are - the spellings live in one
 * table shared with the CSV reader. And the edges are read from the heading
 * rather than by clustering the numbers, because clustering cannot tell a debit
 * column from a credit one in a period that happens to contain no credits: it
 * would find two clusters and have to guess which was missing.
 *
 * All of it must appear on *one line*. Requiring merely that it appear on the
 * same page was a real hazard: a page-wide scan would happily pair a heading
 * from the top of the page with a stray label at the bottom.
 */
function findColumns(page: readonly Item[]): Table | null {
  for (const line of toLines(page)) {
    const table = tableFromHeadings(line);
    if (table) return table;
  }
  return null;
}

/**
 * The grid recovered from the numbers themselves, for a page whose headings no
 * alias knows - or which prints none at all.
 *
 * Money is right-aligned, so the right edges of a column's amounts stack within
 * a point or two of each other while the narration beside them does not. That
 * makes the columns findable without reading a word. What this deliberately does
 * *not* do is decide which column is which: the clusters are handed over in page
 * order under neutral names, and `parseStatementRows` assigns the roles by
 * content and scores the assignment against the running balance. Guessing here
 * would be a second, weaker copy of a judgement that is already made properly
 * one layer up.
 */
function findColumnsByContent(pages: readonly (readonly Item[])[]): number[] {
  const edges: number[] = [];
  for (const page of pages) {
    for (const line of toLines(page)) {
      for (const item of line) {
        if (MONEY.test(item.str.trim())) edges.push(rightEdge(item));
      }
    }
  }
  if (edges.length === 0) return [];

  edges.sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const edge of edges) {
    const last = clusters.at(-1);
    if (last && edge - last[last.length - 1]! <= CLUSTER_TOLERANCE) last.push(edge);
    else clusters.push([edge]);
  }

  return clusters
    .filter((cluster) => cluster.length >= MIN_CLUSTER)
    .map((cluster) => Math.max(...cluster));
}

/** Where the date column ends, judged from the dates rather than a heading. */
function dateEdgeByContent(pages: readonly (readonly Item[])[]): number | undefined {
  let edge: number | undefined;
  let seen = 0;
  for (const page of pages) {
    for (const line of toLines(page)) {
      for (const item of line) {
        if (!DATE.test(item.str.trim())) continue;
        seen += 1;
        edge = edge === undefined ? rightEdge(item) : Math.max(edge, rightEdge(item));
      }
    }
  }
  return seen >= MIN_CLUSTER ? edge : undefined;
}

/** The column a number was printed in, or `null` if it sits in none of them. */
function columnOf(edge: number, columns: Table): MoneyRole | null {
  let best: MoneyRole | null = null;
  let distance = Infinity;
  for (const role of MONEY_ROLES) {
    const at = columns.edges[role];
    if (at === undefined) continue;
    const gap = Math.abs(edge - at);
    if (gap < distance) {
      distance = gap;
      best = role;
    }
  }
  return distance <= COLUMN_WINDOW ? best : null;
}

/** Glyph runs grouped into visual lines, top of the page first. */
function toLines(page: readonly Item[]): Item[][] {
  const sorted = [...page].filter((item) => item.str.trim() !== "").sort((a, b) => b.y - a.y);
  const lines: Item[][] = [];
  for (const item of sorted) {
    const last = lines.at(-1);
    if (last && Math.abs((last[0]?.y ?? 0) - item.y) <= LINE_TOLERANCE) last.push(item);
    else lines.push([item]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

/** Does this line carry the table's column headings? */
const isHeaderLine = (line: readonly Item[]): boolean => tableFromHeadings(line) !== null;

interface Recovered {
  date: string;
  text: string;
  readonly cells: Partial<Record<MoneyRole, string>>;
  readonly type: string;
}

/** Which side of its amounts a wrapped narration is printed on. */
type Wrap = "above" | "below";

/**
 * Walk the pages and recover one record per printed row.
 *
 * A record is closed by a line carrying both a date and a figure; every other
 * line with prose on it is an orphan belonging to a neighbouring record. Which
 * neighbour depends on how the bank aligns its rows, and banks differ: Axis
 * bottom-aligns, so the narration wraps onto the lines *above* the amounts,
 * while a top-aligned layout wraps below. Rather than assume, this is run both
 * ways and the reading with fewer empty descriptions is kept.
 */
function recover(
  pages: readonly (readonly Item[])[],
  columns: Table,
  wrap: Wrap,
): Recovered[] {
  const records: Recovered[] = [];
  let pending: string[] = [];

  for (const page of pages) {
    for (const line of toLines(page)) {
      /*
       * Everything above the heading row is the letterhead - the account number,
       * the address, the customer id. Dropping it at the heading rather than
       * pattern-matching it away is what keeps it out of the first record's
       * narration, which is the one place it would otherwise land.
       */
      if (columns.headed && isHeaderLine(line)) {
        pending = [];
        continue;
      }

      /*
       * The opening-balance line sits between the heading and the first
       * transaction and belongs to neither. Left in `pending` it becomes the
       * first record's narration, which then reads as a transaction the bank
       * never printed.
       */
      if (/opening balance/i.test(line.map((item) => item.str).join(" "))) {
        pending = [];
        continue;
      }

      const date = line.find((item) => item.x <= columns.proseLeft && DATE.test(item.str.trim()));
      const cells: Partial<Record<MoneyRole, string>> = {};
      let marker = "";
      for (const item of line) {
        const token = item.str.trim();
        if (MONEY.test(token)) {
          const column = columnOf(rightEdge(item), columns);
          if (column) cells[column] ??= token;
        } else if (
          DR_CR.test(token) &&
          columns.type !== null &&
          Math.abs(rightEdge(item) - columns.type) <= COLUMN_WINDOW
        ) {
          marker ||= token.replace(".", "").toUpperCase();
        }
      }

      const prose = line
        .filter(
          (item) =>
            item !== date &&
            item.x > columns.proseLeft &&
            item.x < columns.amountsLeft &&
            !MONEY.test(item.str.trim()),
        )
        .map((item) => item.str.trim())
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      /*
       * A record needs a date and at least one figure. A totals line has figures
       * but no date; a wrapped narration has neither. Requiring a *balance*
       * specifically would drop every row of a statement that prints none.
       */
      const complete = date !== undefined && Object.keys(cells).length > 0;
      if (complete) {
        const own = wrap === "above" ? [...pending, prose] : [prose];
        records.push({
          date: date.str.trim(),
          text: own.join(" ").replace(/\s+/g, " ").trim(),
          cells,
          type: marker,
        });
        pending = [];
      } else if (prose !== "") {
        if (wrap === "below") {
          const last = records.at(-1);
          if (last) {
            last.text = `${last.text} ${prose}`.replace(/\s+/g, " ").trim();
            continue;
          }
        }
        pending.push(prose);
        // Without a heading there is nothing to mark where the letterhead ends,
        // so only the lines immediately above a record are treated as its own.
        if (!columns.headed && pending.length > MAX_ORPHAN_LINES) pending.shift();
      }
    }
  }

  return records;
}

/** Records read whichever way round produces fewer descriptionless rows. */
function recoverBestWrap(pages: readonly (readonly Item[])[], columns: Table): Recovered[] {
  const above = recover(pages, columns, "above");
  const below = recover(pages, columns, "below");
  const blank = (records: readonly Recovered[]): number =>
    records.filter((record) => record.text === "").length;
  // Ties go to "above": both readings then describe every row, and neither is
  // more right than the other, so the incumbent behaviour stands.
  return blank(below) < blank(above) ? below : above;
}

/**
 * The opening balance printed above the first row, as the page printed it.
 *
 * Returned as the token rather than a number so the decimal reaches `Money`
 * untouched: this figure seeds a chain that is compared in exact paise, and
 * routing it through a float first would undo the point of comparing exactly.
 *
 * `null` when the statement prints none, which is not an error - the chain is
 * then seeded from the first row instead, so the check starts from the second
 * row rather than reporting a break that is only a missing starting point.
 */
function openingBalance(
  pages: readonly (readonly Item[])[],
  columns: Table,
): string | null {
  if (columns.edges.balance === undefined) return null;
  for (const page of pages) {
    for (const line of toLines(page)) {
      const text = line.map((item) => item.str.trim()).join(" ");
      if (!/opening balance/i.test(text)) continue;
      for (const item of line) {
        const token = item.str.trim();
        // A zero opening is written `.00`, which `MONEY` reads as 0 like any
        // other sub-rupee amount, so it needs no special case here.
        if (MONEY.test(token) && columnOf(rightEdge(item), columns) === "balance") {
          return token;
        }
      }
    }
  }
  return null;
}

/**
 * The header row to print above the recovered records.
 *
 * Named columns get the spelling `HEADER_ALIASES` knows, so the alias reader
 * downstream recognises them; a grid recovered from the numbers gets neutral
 * names it deliberately will not recognise, which is what sends that file to
 * content inference instead of to a mapping nobody established.
 */
function headerFor(columns: Table, moneyColumns: readonly MoneyRole[]): RawRow {
  if (!columns.headed) {
    return ["Date", "Description", "Reference", ...moneyColumns.map((_, index) => `Figure ${index + 1}`)];
  }
  const named: Record<MoneyRole, string> = {
    debit: "Debit",
    credit: "Credit",
    amount: "Amount",
    balance: "Balance",
  };
  return [
    "Date",
    "Description",
    "Reference",
    ...(columns.type === null ? [] : ["Type"]),
    ...moneyColumns.map((role) => named[role]),
  ];
}

/** What the geometry reader recovered, and the seed for checking it. */
export interface ColumnStatement {
  readonly rows: RawRow[];
  /**
   * The balance printed above the first transaction, exactly as the page printed
   * it, or `null` if it printed none.
   *
   * It is the only evidence that can test the *first* movement - without it the
   * chain starts at row 1 and that row goes unchecked. Handed over as the token
   * rather than a `Money` so it goes through `readAmount` like every other figure
   * in the file: this bank writes a zero opening as `.00`, and a second, private
   * conversion here would be a second place to get that wrong. It already was.
   */
  readonly opening: string | null;
  /**
   * Every visual line on every page, in reading order.
   *
   * Handed over because this reader has already grouped the glyph runs into
   * lines and `statement-header.ts` needs exactly that to find the account
   * number, the period and the control totals. The alternative is a second pass
   * over the whole document through pdf.js purely to re-derive text this module
   * is holding, on every statement whose geometry was read successfully.
   */
  readonly text: string[];
}

/**
 * Read a statement from its page geometry, or return `null` to let the
 * text-based reader try instead.
 *
 * `null` means "this is not a table I can positively identify" - the normal
 * reply for every statement this reader does not handle, and the caller should
 * fall back.
 *
 * It no longer judges its own output. This module used to carry a private
 * `reconcile()` that walked the records in floating point and threw: a second
 * implementation of `checkBalanceContinuity`, less exact than the one that
 * already existed, and reachable only from here. The verdict now belongs to the
 * parse, so this returns the evidence and lets the shared check do the arithmetic
 * in bigint paise.
 */
export async function readColumnStatement(
  bytes: Uint8Array,
  password?: string,
): Promise<ColumnStatement | null> {
  const { extractTextItems, getDocumentProxy } = await import("unpdf");
  const document = await getDocumentProxy(bytes, password ? { password } : undefined);
  const { items } = await extractTextItems(document);
  const pages = items as unknown as Item[][];

  const columns = pages.map(findColumns).find((found) => found !== null) ?? inferGrid(pages);
  if (!columns) return null;

  const records = recoverBestWrap(pages, columns);
  if (records.length === 0) return null;

  const moneyColumns = MONEY_ROLES.filter((role) => columns.edges[role] !== undefined);

  return {
    rows: [
      headerFor(columns, moneyColumns),
      ...records.map((record): RawRow => [
        record.date,
        record.text,
        "",
        ...(columns.headed && columns.type !== null ? [record.type] : []),
        ...moneyColumns.map((role) => record.cells[role] ?? ""),
      ]),
    ],
    opening: openingBalance(pages, columns),
    text: pages.flatMap((page) =>
      toLines(page).map((line) =>
        line
          .map((item) => item.str.trim())
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      ),
    ),
  };
}

/**
 * A table built from the clustered right edges of the amounts, for a statement
 * whose headings could not be read.
 *
 * The clusters are numbered left to right and stored under the neutral money
 * roles in that order, purely so the rest of this module can address them; the
 * names carry no claim about what the columns mean, and `headerFor` prints them
 * as `Figure 1`, `Figure 2` so that nothing downstream mistakes them for one.
 */
function inferGrid(pages: readonly (readonly Item[])[]): Table | null {
  const clusters = findColumnsByContent(pages);
  if (clusters.length === 0) return null;

  const dateEdge = dateEdgeByContent(pages);
  if (dateEdge === undefined) return null;

  const usable = clusters.filter((edge) => edge > dateEdge).slice(0, MONEY_ROLES.length);
  if (usable.length === 0) return null;

  const edges: Partial<Record<MoneyRole, number>> = {};
  usable.forEach((edge, index) => {
    edges[MONEY_ROLES[index]!] = edge;
  });

  return {
    edges,
    type: null,
    proseLeft: dateEdge,
    amountsLeft: Math.min(...usable),
    headed: false,
  };
}

/** Internals, exposed for the spec - not part of the module's contract. */
export const __test__ = {
  findColumns,
  findColumnsByContent,
  inferGrid,
  columnOf,
  toLines,
  recover,
  recoverBestWrap,
  openingBalance,
  headerFor,
};
