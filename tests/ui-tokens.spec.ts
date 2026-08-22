import { readFileSync } from "node:fs";
import { check, checkDeep, section, done } from "./harness";

/**
 * Guards the design system's invariants.
 *
 * These are the properties that no typecheck, lint or build can see: the chart
 * palette being the validated one, the series order being fixed, and no raw hex
 * having crept back into the token file's utility layer.
 *
 * The colour separation itself was validated with the OKLab/CVD validator when
 * the palette was chosen; this pins the *result*, so a later "tidy up the
 * colours" commit cannot silently undo it.
 */

const tokens = readFileSync("src/ui/tokens.css", "utf8");
const charts = readFileSync("src/ui/charts.tsx", "utf8");

/**
 * Comments stripped: the assertions below are about CSS rules, not prose. The
 * file legitimately *names* the arbitrary values it replaced, and matching those
 * mentions would make the test fail on its own documentation.
 */
const tokenRules = tokens.replace(/\/\*[\s\S]*?\*\//g, " ");

section("the validated chart palette is the one in the file");

// Adjacent-pair separation on the #0e0f16 card surface: worst ΔE 9.4 (protan),
// 18.1 (normal vision). The pair that failed before was #6ea8ff next to #a78bff
// at ΔE 1.9 deutan — and they were adjacent, so a two-series chart was unreadable.
const EXPECTED_PALETTE = ["#8b7cff", "#25a37b", "#c08529", "#5b93e0", "#d15f92"];

const declared = [...tokens.matchAll(/--chart-([1-5]):\s*(#[0-9a-f]{6})/gi)].map((m) => [
  Number(m[1]),
  m[2].toLowerCase(),
] as const);

checkDeep(
  "chart-1..5 are the validated hues, in order",
  declared.sort((a, b) => a[0] - b[0]).map(([, hex]) => hex),
  EXPECTED_PALETTE,
);

const RETIRED = ["#6ea8ff", "#a78bff"];
for (const hex of RETIRED) {
  check(
    `retired hue ${hex} is not a chart token`,
    /--chart-[1-5]:\s*#6ea8ff|--chart-[1-5]:\s*#a78bff/i.test(tokens),
    false,
  );
}

section("series order is fixed, and the palette is not cycled silently");

check(
  "CHART_SERIES lists five slots in order",
  [...charts.matchAll(/var\(--chart-([1-5])\)/g)].map((m) => m[1]).slice(0, 5).join(""),
  "12345",
);
check(
  "scatter forms are capped at the all-pairs-safe count",
  /SCATTER_SAFE_SERIES\s*=\s*3/.test(charts),
  true,
);
check("foldSeries exists so a 6th series folds to Other", charts.includes("export function foldSeries"), true);

section("no dual axis is even expressible");

// Two y-scales is the most common charting mistake; the defence is not offering it.
check("charts.tsx never mentions yAxisId", charts.includes("yAxisId"), false);

section("marks follow the house spec");

check("lines are 2px", charts.includes("strokeWidth={2}"), true);
check("bars are capped, not slot-filling", charts.includes("maxBarSize={24}"), true);
check("bars have a 4px rounded data-end", charts.includes("radius={stacked ? 0 : [4, 4, 0, 0]}"), true);
check("grid is horizontal only", charts.includes("vertical={false}"), true);
check("area fill is a 10% wash", charts.includes("fillOpacity={0.1}"), true);
check("reduced motion is honoured", charts.includes("prefers-reduced-motion"), true);

section("the token layer holds the only raw hex");

// Hex is legitimate in a token *definition*; it is not legitimate in a utility
// rule, where it would be a colour no theme change can reach.
const utilityLayer = tokenRules.slice(tokenRules.indexOf("@layer utilities"));
const strayHex = [...utilityLayer.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0]);
checkDeep("no raw hex inside @layer utilities", strayHex, []);

section("type scale replaced the arbitrary values");

for (const arbitrary of [
  "text-[11px]",
  "text-[10px]",
  "text-[1.75rem]",
  "text-[2.6rem]",
  "tracking-[.14em]",
  "tracking-[.18em]",
  "tracking-[0.22em]",
]) {
  check(`${arbitrary} is gone from the rules`, tokenRules.includes(arbitrary), false);
}
check("one content width, not two", tokenRules.includes("max-w-[1540px]"), false);

done();
