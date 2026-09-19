import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'prototype.js'), 'utf8');
const experiment = fs.readFileSync(path.join(root, 'experiment.md'), 'utf8');
const assertions = [];

function check(name, condition) {
  assertions.push({ name, passed: Boolean(condition) });
}

function count(pattern, source = html) {
  return (source.match(pattern) || []).length;
}

check('experiment has predeclared hypothesis', /## Hypothesis[\s\S]+## Success threshold/.test(experiment));
check('experiment defines KEEP threshold', /experiment is a \*\*KEEP\*\* only if/.test(experiment));
check('experiment defines failure outcomes', /REVISE[\s\S]+DISCARD/.test(experiment));
check('document declares HTML language', /<html lang="en">/.test(html));
check('document has viewport metadata', /name="viewport"/.test(html));
check('document has exactly one h1', count(/<h1\b/g) === 1);
check('document has a skip link', /class="skip-link" href="#workspace"/.test(html));
check('main target exists', /<main id="workspace">/.test(html));
check('primary navigation is labelled', /<nav[^>]+aria-label="Primary navigation"/.test(html));
check('category tabs are labelled', /role="tablist" aria-label="Investment categories"/.test(html));
check('four category tabs exist', count(/role="tab"/g) === 4);
check('four category panels exist', count(/role="tabpanel"/g) === 4);
check('overview level exists', /id="overview"/.test(html));
check('category drill-down exists', /id="categories"/.test(html));
check('holding detail exists', /id="holding-detail"/.test(html));
check('data quality explanation exists', /id="quality"/.test(html));
check('equities are specialized', /data-category="Equities"/.test(html) && /Exchange \/ account/.test(html));
check('mutual funds are specialized', /data-category="Mutual Funds"/.test(html) && /Scheme \/ plan/.test(html));
check('gold is specialized', /data-category="Gold"/.test(html));
check('fixed income is specialized', /data-category="Fixed Income"/.test(html) && /Issuer \/ rating/.test(html));
check('digital gold is distinct', /data-asset="Digital Gold"/.test(html));
check('physical gold is distinct', /data-asset="Physical Gold"/.test(html));
check('SGB is distinct', /data-asset="SGB"/.test(html));
check('gold ETF is distinct', /data-asset="Gold ETF"/.test(html));
check('all representative details identify source', count(/data-source=/g) === 7);
check('all representative details identify as-of', count(/data-as-of=/g) === 7);
check('all representative details identify asset', count(/data-asset=/g) === 7);
check('all representative details expose lifecycle field', count(/<dt>Lifecycle field<\/dt>/g) === 7);
for (const state of ['current', 'daily', 'stale', 'manual', 'unavailable']) {
  check(`${state} state is designed`, new RegExp(`data-state="${state}"`).test(html));
}
check('intervention states expose actions', count(/Action:/g) >= 5);
check('incomplete value is priced subtotal', count(/Priced subtotal/gi) >= 2);
check('unavailable holding is excluded', /Excluded from priced subtotal/.test(html));
check('global synthetic fixture label is explicit', /All people, holdings, quantities, dates, prices, returns, and monetary figures[\s\S]+synthetic display fixtures/.test(html));
check('synthetic label disclaims live data', /No production calculations or live data are used/.test(html));
check('tables use captions', count(/<caption>/g) >= 3);
check('table row and column headers use scope', count(/scope="(?:row|col)"/g) >= 10);
check('scrollable tables are keyboard reachable', count(/class="table-wrap" tabindex="0"/g) >= 3);
check('focus-visible styling exists', /:focus-visible/.test(css));
check('desktop layout is explicit', /grid-template-columns: 220px minmax\(0, 1fr\)/.test(css));
check('mobile breakpoint is explicit', /@media \(max-width: 720px\)/.test(css));
check('mobile tables retain overflow', /\.table-wrap \{ overflow-x: auto; overscroll-behavior-inline: contain; \}/.test(css));
check('no duplicate HTML ids', (() => { const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]); return ids.length === new Set(ids).size; })());
check('interaction uses native buttons', count(/<button\b/g) >= 15);
check('tab keyboard behavior is implemented', /ArrowLeft/.test(js) && /ArrowRight/.test(js));
check('prototype has no remote resources', !/(?:https?:)?\/\//.test(html));
check('prototype does not import production modules', !/(?:from\s+['"]|src=)[^'"]*(?:app\/|src\/|\.tsx?|api\/)/i.test(html + js));
check('prototype performs no network requests', !/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(js));
check('assertion count meets predeclared minimum', assertions.length >= 30);

const failed = assertions.filter((item) => !item.passed);
for (const item of assertions) console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}`);
console.log(`\n${assertions.length - failed.length}/${assertions.length} checks passed.`);
if (failed.length) process.exit(1);
