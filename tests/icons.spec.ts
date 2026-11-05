import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { Icon, ICON_NAMES, type IconName } from "../components/icons";
import { check, checkDeep, checkTrue, done, section } from "./harness";

const canonical = readFileSync("_design/control-bench/index.html", "utf8");
const literal = /var ICON = \{([\s\S]*?)\r?\n\};/.exec(canonical)?.[1];
if (!literal) throw new Error("Canonical icon inventory not found");
const shapes = new Map(
  [...literal.matchAll(/^([^\r\n:]+):'([^']*)'/gm)].map((entry) => [
    entry[1]!.replaceAll("'", ""), entry[2]!,
  ]),
);

const normalized = (markup: string) => markup.replace(/<([a-z]+)([^>]*?)\s*\/>/g, "<$1$2></$1>");
const render = (name: IconName, size: 14 | 16 | 20 = 16) =>
  renderToStaticMarkup(createElement(Icon, { name, size }));

section("the production inventory is the exact canonical set");
check("canonical source defines 55 shapes", shapes.size, 55);
check("library exports 55 icon names", ICON_NAMES.length, 55);
checkDeep("no missing, renamed or invented icon", [...ICON_NAMES].sort(), [...shapes.keys()].sort());
checkTrue("name inventory cannot be mutated", Object.isFrozen(ICON_NAMES));
for (const name of ICON_NAMES) {
  const markup = render(name);
  const body = markup.slice(markup.indexOf(">") + 1, markup.lastIndexOf("</svg>"));
  check(`${name} geometry matches the source`, body, normalized(shapes.get(name)!));
}

section("one optical contract at 14, 16 and 20 pixels");
for (const name of ICON_NAMES) {
  for (const size of [14, 16, 20] as const) {
    const markup = render(name, size);
    const opening = markup.slice(0, markup.indexOf(">") + 1);
    checkTrue(`${name}/${size} uses its requested square size`, opening.includes(`width="${size}" height="${size}"`));
    checkTrue(`${name}/${size} uses the 16-unit grid`, opening.includes('viewBox="0 0 16 16"'));
    checkTrue(`${name}/${size} preserves 1.3 stroke and round ends`,
      opening.includes('stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"'));
    checkTrue(`${name}/${size} inherits ink with no root fill`, opening.includes('fill="none" stroke="currentColor"'));
    checkTrue(`${name}/${size} is decorative and unfocusable`, opening.includes('aria-hidden="true"') && opening.includes('focusable="false"'));
  }
}

section("accessible meaning is deliberate and React-escaped");
const labeled = renderToStaticMarkup(createElement(Icon, { name: "warn", label: "  Price unavailable  " }));
checkTrue("meaningful icon has image role", labeled.includes('role="img"'));
checkTrue("meaningful icon has trimmed accessible name", labeled.includes('aria-label="Price unavailable"'));
checkTrue("meaningful icon is not hidden", !labeled.includes("aria-hidden="));
checkTrue("meaningful icon never takes a tab stop", labeled.includes('focusable="false"'));
const escaped = renderToStaticMarkup(createElement(Icon, { name: "info", label: '<img src="x" />' }));
checkTrue("label cannot inject markup", escaped.includes("&lt;img") && !escaped.includes("<img"));
const blank = renderToStaticMarkup(createElement(Icon, { name: "check", label: "   " }));
checkTrue("empty accessible label remains decorative", blank.includes('aria-hidden="true"') && !blank.includes('role="img"'));
const styled = renderToStaticMarkup(createElement(Icon, { name: "bank", className: "institution-action", id: "bank" }));
checkTrue("styling hook survives composition", styled.includes('class="institution-action"'));
checkTrue("ordinary SVG attributes survive composition", styled.includes('id="bank"'));

done();
