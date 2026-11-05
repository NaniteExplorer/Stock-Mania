/**
 * D.4 follow-up: the `ProviderMark` hydration race, and institution marks on the debt,
 * deposit, platform and import surfaces (DESIGN.md §9).
 *
 *   1. The race. `onError` is attached at hydration, so a 404 that lands before then is
 *      lost and the browser keeps its broken-image box. After mount, `ProviderMark`
 *      checks the element itself. The rule (`imageHasFailed`) is tested as a pure
 *      function. The effect that applies it needs a DOM, and this runner has no DOM
 *      library (no jsdom or happy-dom), so its wiring is asserted by source. What is
 *      NOT tested: that the effect runs after a real hydration, and how a real browser
 *      reports `complete` for a lazy image it has not fetched yet.
 *   2. Each listed surface puts `InstitutionMark` beside the stored institution or
 *      platform name, never beside an instrument (§9 rule 5) and never inside an
 *      `<option>`. These are server pages that read the database, so they are checked
 *      by source.
 *   3. Insurance is deliberately unmarked. The registry has no insurers, and the
 *      resolver's loose match would draw a bank's mark for its insurance affiliate.
 *   4. No new logo mechanism exists in the touched folders.
 *
 * Fixture names are made up.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { findFinancialProvider } from "@/ui/providers";
import { imageHasFailed, InstitutionMark, ProviderMark } from "@/ui/provider-picker";
import { check, checkTrue, done, section } from "./harness";

const read = (path: string) => readFileSync(path, "utf8");

section("the hydration race: a 404 that beat hydration still ends in the badge");

check("a finished request with no pixels has failed (the lost 404)", imageHasFailed({ complete: true, naturalWidth: 0 }), true);
check("a finished request with pixels is a logo", imageHasFailed({ complete: true, naturalWidth: 128 }), false);
check(
  "a request in flight, or a lazy image not yet fetched (both incomplete), is left to onError",
  imageHasFailed({ complete: false, naturalWidth: 0 }),
  false,
);

{
  const source = read("src/ui/provider-picker.tsx");
  checkTrue("the <img> carries a ref", source.includes("ref={image}"));
  checkTrue(
    "after mount, an already-failed image switches to the badge",
    source.includes("if (image.current && imageHasFailed(image.current)) setFailed(true);"),
  );
  checkTrue("the check re-runs when the provider changes", source.includes("}, [provider.id]);"));
  checkTrue("the onError path is kept for failures after hydration", source.includes("onError={() => setFailed(true)}"));
  checkTrue("the failed state still shares the badge branch", source.includes("if (failed || (!provider.logo && !provider.domain))"));
}

{
  // On the server the effect does not run, so the markup is unchanged: still the one logo route.
  const zerodha = findFinancialProvider("Zerodha");
  checkTrue("fixture provider exists", zerodha !== undefined);
  if (zerodha) {
    const html = render(h(ProviderMark, { provider: zerodha }));
    checkTrue("server markup still requests /api/logo/<id>", html.includes('src="/api/logo/zerodha"'));
    checkTrue("server markup is still decorative", html.includes('alt=""') && html.includes('aria-hidden="true"'));
  }
}

section("cards");

const cards = read("app/(root)/cards/page.tsx");
checkTrue("card list: the issuer's mark sits beside the issuer name", cards.includes("<InstitutionMark institution={summary.card.account.institution} />"));
checkTrue("card list: no institution, no subtitle and no mark", cards.includes(") : undefined"));
const card = read("app/(root)/cards/[accountId]/page.tsx");
checkTrue("card detail: mark beside the issuer", card.includes("<InstitutionMark institution={detail.card.account.institution} />"));
checkTrue("card detail: the issuer is named once, beside its mark", !card.includes("${detail.card.account.institution} ·"));

section("loans");

const loans = read("app/(root)/loans/page.tsx");
checkTrue("loan list: the lender's mark leads the loan cell", loans.includes("<InstitutionMark institution={summary.loan.account.institution} />"));
const loan = read("app/(root)/loans/[accountId]/page.tsx");
checkTrue("loan detail: mark beside the lender", loan.includes("<InstitutionMark institution={loan.account.institution} />"));
checkTrue("loan detail: pay-from options carry their institution", loan.includes("institution: account.institution"));

const forms = read("app/(root)/loans/[accountId]/loan-payment-forms.tsx");
checkTrue("payment forms: both selects use the marked select", (forms.match(/<PayFromSelect /g) ?? []).length === 2);
checkTrue("payment forms: the mark resolves through the shared resolver", forms.includes("findFinancialProvider(accounts.find((account) => account.id === chosen)?.institution)"));
checkTrue("payment forms: the mark comes from ProviderMark", forms.includes("<ProviderMark provider={provider} size={20} />"));
{
  const options = [...forms.matchAll(/<option\s[^>]*>[\s\S]*?<\/option>/g)].map((match) => match[0]);
  checkTrue("payment forms: options exist", options.length > 0);
  checkTrue("payment forms: no mark inside an <option>", options.every((option) => !/Mark|<img|<span/.test(option)));
}
checkTrue("payment forms: the mark clears when the form resets", forms.includes('form.addEventListener("reset", cleared)'));

section("deposits, platforms, imports");

const deposits = read("app/(root)/deposits/page.tsx");
checkTrue("deposits: mark beside the deposit's stored institution", deposits.includes("<InstitutionMark institution={position.deposit.account.institution} />"));

const platforms = read("app/(root)/platforms/page.tsx");
checkTrue("platforms: the in-use table marks the platform", platforms.includes("<InstitutionMark institution={row.key === UNASSIGNED ? null : row.name} />"));
check("platforms: the idle and archived lists mark the platform too", (platforms.match(/<InstitutionMark institution=\{row\.name\} \/>/g) ?? []).length, 2);
check("'Unassigned' is a bucket and resolves to no provider", findFinancialProvider("Unassigned"), undefined);

const imports = read("app/(root)/imports/page.tsx");
checkTrue("imports: the account column marks the account's institution", imports.includes("<InstitutionMark institution={account.institution} />"));
checkTrue("imports: the file name is never resolved to a mark", !imports.includes("institution={batch.fileName}"));

section("rule 5: a mark is resolved only from a stored institution or platform name");

{
  const pages = [cards, card, loans, loan, deposits, platforms, imports];
  const fed = pages.flatMap((source) => [...source.matchAll(/<InstitutionMark institution=\{([^}]+)\}/g)].map((match) => match[1]));
  const allowed = /(\.institution|row\.name|UNASSIGNED \? null : row\.name)$/;
  check("every mark is fed an institution or a platform name", fed.filter((expr) => !allowed.test(expr)).join(" | "), "");
  checkTrue("no mark is fed an instrument or a display name", !fed.some((expr) => /instrument|displayName|symbol/.test(expr)));
}

{
  // The instrument near-miss the rule exists for, reproduced with made-up product names.
  check("an instrument containing a bank's short name resolves to that bank", findFinancialProvider("HDFC Kestrel Bond Fund")?.kind, "BANK");
}

section("insurance stays unmarked until the registry knows insurers");

{
  // An insurer's name contains its group bank's short name, and the resolver's fallback
  // matches on that, so a mark here would be the bank's: a near-miss identity claim.
  check("an HDFC-group insurer resolves to the bank", findFinancialProvider("HDFC Kestrel General Insurance")?.kind, "BANK");
  check("an ICICI-group insurer resolves to the bank", findFinancialProvider("ICICI Kestrel Life")?.kind, "BANK");
  check("an SBI-group insurer resolves to the bank", findFinancialProvider("SBI Kestrel Insurance")?.kind, "BANK");
  checkTrue("the registry carries no insurer kind", !/"INSURER"|"INSURANCE"/.test(read("src/ui/providers.ts")));
  const screen = read("app/(root)/insurance/insurance-screen.tsx");
  checkTrue("so the insurance screen draws no institution mark", !/InstitutionMark|ProviderMark/.test(screen));
}

{
  check("an unresolved insurer name would render nothing anyway", render(h(InstitutionMark, { institution: "Kestrel Mutual Assurance" })), "");
}

section("Batch 5: the pay-from and import-account forms mark the chosen institution");

for (const [path, testId] of [
  ["app/(root)/cards/[accountId]/pay-card-form.tsx", "pay-from-institution"],
  ["app/(root)/imports/upload-form.tsx", "import-account-institution"],
] as const) {
  const source = read(path);
  checkTrue(`${path} imports InstitutionMark from provider-picker`, source.includes('import { InstitutionMark } from "@/ui/provider-picker";'));
  checkTrue(`${path} marks the stored institution beside the select`, source.includes(`data-testid="${testId}"`) && /<InstitutionMark institution=\{\w+\.institution\}/.test(source));
  checkTrue(`${path} never puts a mark inside an <option>`, !/<option[^>]*>[^<]*<InstitutionMark/.test(source));
}
checkTrue("the card page passes the institution", read("app/(root)/cards/[accountId]/page.tsx").includes("institution: account.institution"));
checkTrue("the import page passes the institution", read("app/(root)/imports/page.tsx").includes("institution: account.institution"));

section("no new logo mechanism");

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
const touched = [
  "app/(root)/cards",
  "app/(root)/loans",
  "app/(root)/deposits",
  "app/(root)/platforms",
  "app/(root)/imports",
  "app/(root)/insurance",
  "app/(root)/liabilities",
].flatMap(files);
const offenders = touched.filter((path) => {
  const source = read(path);
  return source.includes("/api/logo") || /<img\b/.test(source) || /favicon|clearbit/i.test(source);
});
check("no surface builds its own logo URL or <img>", offenders.join(", "), "");
const markUsers = touched.filter((path) => /\bInstitutionMark\b|\bProviderMark\b/.test(read(path)));
check("the marked files are the expected ones", markUsers.length, 10);
checkTrue("every mark comes from src/ui/provider-picker", markUsers.every((path) => read(path).includes('from "@/ui/provider-picker"')));

done();
