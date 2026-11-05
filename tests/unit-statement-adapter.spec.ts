import { Ordinal } from "@/core/units";
import { parseDelimitedText, parseStatementRows, toBankingStatement } from "@/infra/statements";
import { check, checkTrue, done, throws } from "./harness";

const parsed = parseStatementRows(parseDelimitedText("Date,Description,Debit,Credit,Balance\n01/01/2026,Opening payment,10.25,,-10.25\n02/01/2026,Refund,,2.10,-8.15"));
const before = JSON.stringify(parsed);
const input = toBankingStatement(parsed);
check("every parsed movement enters the port", input.rows.length, parsed.rows.length);
checkTrue("fixture exercises an overdrawn balance", parsed.rows[0].balanceAfter!.isNegative);
for (let index = 0; index < parsed.rows.length; index += 1) {
  const source = parsed.rows[index];
  const row = input.rows[index];
  check("source row position is not renumbered", row.rowIndex, Ordinal(source.rowIndex));
  check("duplicate occurrence is not renumbered", row.occurrence, Ordinal(source.occurrence));
  checkTrue("exact Money object is preserved", row.amount === source.amount && row.balanceAfter === source.balanceAfter);
  check("reference and raw source survive", row.raw, source.raw);
}
const problem = { rowIndex: 9, reason: "Missing date", raw: "invalid source line" };
const withProblem = toBankingStatement({ ...parsed, problems: [problem] });
check("unreadable source positions survive", withProblem.problems[0].rowIndex, Ordinal(9));
check("unreadable source reason survives", withProblem.problems[0].reason, problem.reason);
check("adapter does not mutate parser output", JSON.stringify(parsed), before);
throws("invalid source position cannot cross the port", () => toBankingStatement({ ...parsed, rows: [{ ...parsed.rows[0], rowIndex: -1 }] }), "ordinal");
throws("fractional duplicate occurrence cannot cross the port", () => toBankingStatement({ ...parsed, rows: [{ ...parsed.rows[0], occurrence: 0.5 }] }), "ordinal");
done();
