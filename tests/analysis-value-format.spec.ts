import { formatAnalysisValue } from "@/ui/format-analysis-value";
import { check, done } from "./harness";

check("return fractions display as percentages", formatAnalysisValue(0.224499, "RATIO"), "22.45%");
check("bandwidth fractions share the same explicit scale", formatAnalysisValue(0.1, "RATIO"), "10.00%");
check("index points never acquire a percent sign", formatAnalysisValue(100, "INDEX_POINTS"), "100");
check("scaled technical prices display in major price units", formatAnalysisValue(100.495 * 1e8, "PRICE_LEVEL"), "100.5");
check("legacy percent-point metrics are not multiplied again", formatAnalysisValue(12.5, "PERCENTAGE"), "12.5%");
check("a known zero fraction remains a figure", formatAnalysisValue(0, "RATIO"), "0.00%");
check("large finite ratios avoid scientific notation", formatAnalysisValue(1e19, "RATIO").replaceAll(",", ""), "1000000000000000000000.00%");
check("larger finite ratios retain their full decimal scale", formatAnalysisValue(1e20, "RATIO").replaceAll(",", ""), "10000000000000000000000.00%");
for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
  check("unavailable values are never zero", formatAnalysisValue(value, "RATIO"), "—");
}
done();
