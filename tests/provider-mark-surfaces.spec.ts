/**
 * D.4: institution marks on the accounts, investments and assets surfaces
 * (DESIGN.md §9).
 *
 * The rule is "reuse what exists". Every surface that names an account, a holding's
 * platform or an institution gets `InstitutionMark` from `src/ui/provider-picker.tsx`,
 * which requests `/api/logo/<id>`. When that request returns 404, `ProviderMark` draws
 * the branded badge. This spec checks four things:
 *
 *   1. A rendered surface requests the logo through `/api/logo/<id>`, and nothing else.
 *   2. The 404 path ends in the branded badge, built from the provider's own colours and
 *      `shortName`, never a grey square. Without a browser `onError` cannot fire, so the
 *      spec renders the identical branch (a provider with no domain) and asserts the
 *      `onError` wiring by source.
 *   3. A holding is marked by its platform, never by its instrument name (§9, rule 5).
 *   4. No new logo mechanism exists in the touched folders.
 *
 * Fixture names and figures are made up.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { Currency } from "@/core/money";
import type { InvestmentWorkspacePosition } from "@/app/investing.usecases";
import { findFinancialProvider } from "@/ui/providers";
import { InstitutionMark, ProviderMark } from "@/ui/provider-picker";
import HoldingsTable from "../app/(root)/investments/holdings/holdings-table";
import { GET as logoRoute } from "../app/api/logo/[id]/route";
import { check, checkTrue, done, section } from "./harness";

const amount = (value: string) => ({ amount: value, currency: Currency.reporting.code });

const position = (
  overrides: Partial<InvestmentWorkspacePosition> & Pick<InvestmentWorkspacePosition, "instrumentId" | "symbol" | "name">,
): InvestmentWorkspacePosition => ({
  platformName: null,
  kind: "LISTED_EQUITY",
  assetFamily: "EQUITY",
  quantity: "3",
  nativeCurrency: "INR",
  costBasis: amount("900.00"),
  marketValue: amount("960.00"),
  realisedGain: amount("0.00"),
  pricedOn: "2026-10-30",
  marketValueStatus: "AVAILABLE",
  isStale: false,
  unavailableReason: null,
  ...overrides,
});

/** Every `/api/logo/<id>` the markup requests. */
const logoIds = (html: string) => [...html.matchAll(/src="\/api\/logo\/([^"]+)"/g)].map((m) => m[1]);

section("InstitutionMark resolves through the one logo route");

{
  const html = render(h(InstitutionMark, { institution: "Zerodha" }));
  check("a known platform requests /api/logo/<id>", logoIds(html).join(","), "zerodha");
  checkTrue("the mark is decorative, its name is beside it", html.includes('aria-hidden="true"') && html.includes('alt=""'));
  check("size comes from the control scale (--h-xs 24)", /width:24px;height:24px/.test(html), true);
}
check("an unresolved name renders nothing, not a placeholder", render(h(InstitutionMark, { institution: "Kestrel Co-operative Bank" })), "");
check("no institution renders nothing", render(h(InstitutionMark, { institution: null })), "");

section("the 404 path ends in the branded badge, never a generic square");

{
  // PPF has no domain and no curated logo, so it takes the same branch as `failed`.
  const ppf = findFinancialProvider("ppf");
  checkTrue("fixture provider exists", ppf !== undefined);
  if (ppf) {
    const html = render(h(ProviderMark, { provider: ppf }));
    checkTrue("no <img> is drawn when there is no logo", !html.includes("<img"));
    checkTrue("badge carries the provider's short name", html.includes(">PPF<"));
    checkTrue(
      "badge is painted in the provider's own two brand colours",
      html.includes(ppf.colors[0]) && html.includes(ppf.colors[1]),
    );
    checkTrue("badge is not a grey square", !/bg-gray|#9ca3af|grey/i.test(html));
  }
  const source = readFileSync("src/ui/provider-picker.tsx", "utf8");
  checkTrue("an <img> error (the 404) flips ProviderMark to the badge", source.includes("onError={() => setFailed(true)}"));
  checkTrue("the failed state shares the badge branch", source.includes("if (failed || (!provider.logo && !provider.domain))"));
}

{
  const response = await logoRoute(
    new Request("http://localhost/api/logo/not-a-provider") as never,
    { params: Promise.resolve({ id: "not-a-provider" }) },
  );
  check("the logo route answers 404 rather than guessing", response.status, 404);
}

section("holdings: the platform carries the mark, the instrument never does");

{
  const html = render(
    h(HoldingsTable, {
      positions: [
        position({ instrumentId: "ins_a", symbol: "KSTR", name: "Kestrel Industries", platformName: "Zerodha" }),
        // An instrument whose name contains a bank's short name. It must not borrow that bank's mark.
        position({ instrumentId: "ins_b", symbol: "HDFCBF", name: "HDFC Corporate Bond Fund", platformName: "Groww", kind: "MUTUAL_FUND", assetFamily: "FUNDS" }),
        position({ instrumentId: "ins_c", symbol: "OWL", name: "Owl Metals", platformName: null }),
      ],
      query: "",
      status: "",
      kind: "",
    }),
  );
  check("one mark per assigned platform, in row order", logoIds(html).join(","), "zerodha,groww");
  checkTrue("the instrument name never resolves to a bank mark", !logoIds(html).includes("hdfc"));
  checkTrue("platform name still rendered beside its mark", html.includes("Zerodha") && html.includes("Groww"));
  checkTrue("an unassigned platform keeps its em dash", html.includes("—"));
}

{
  // Rendered by source: the profile imports `@/ui/primitives`, whose `@/lib/utils`
  // sits outside the runner's `@` → `src/` alias.
  const profile = readFileSync("app/(root)/investments/[instrumentId]/non-digital-holding-profile.tsx", "utf8");
  checkTrue(
    "holding profile marks its platform fact",
    profile.includes('<Fact label="Platform" value={props.platform ?? "Unassigned"} institution={props.platform} />'),
  );
  checkTrue("the fact draws the mark beside its value", profile.includes("<InstitutionMark institution={institution} />"));
  checkTrue("an unassigned holding still says so, with no mark", profile.includes("{institution ? ("));
}

section("server surfaces wire the mark beside the name");

const read = (path: string) => readFileSync(path, "utf8");
const accountsPage = read("app/(root)/accounts/page.tsx");
checkTrue("accounts: pending-import rows carry the account's institution", accountsPage.includes("institution: position.asset.account.institution"));
checkTrue("accounts: pending-import rows render its mark", accountsPage.includes("<InstitutionMark institution={pending.institution} />"));
checkTrue("accounts table keeps its mark", read("app/(root)/accounts/accounts-table.tsx").includes("<InstitutionMark institution={row.institution} />"));
checkTrue("account detail keeps its mark", read("app/(root)/accounts/[accountId]/page.tsx").includes("<InstitutionMark institution={account.institution} />"));

const historyPage = read("app/(root)/investments/history/page.tsx");
checkTrue("realised gains: the platform breakdown asks for marks", /rows=\{view\.platforms\}\s+total=\{view\.total\}\s+marks/.test(historyPage));
checkTrue("realised gains: the category breakdown does not", !/rows=\{view\.groups\}\s+total=\{view\.total\}\s+marks/.test(historyPage));
checkTrue("realised gains: marks render from the bucket label", historyPage.includes("{marks && <InstitutionMark institution={row.label} />}"));

checkTrue(
  "digital-gold lease rows mark their platform",
  read("app/(root)/investments/[instrumentId]/page.tsx").includes("<InstitutionMark institution={row.lease.props.platform} />"),
);

section("no new logo mechanism");

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
const touched = ["app/(root)/accounts", "app/(root)/investments", "app/(root)/assets"].flatMap(files);
const offenders = touched.filter((path) => {
  const source = read(path);
  return source.includes("/api/logo") || /<img\b/.test(source) || /favicon|clearbit/i.test(source);
});
check("no surface builds its own logo URL or <img>", offenders.join(", "), "");
const markImports = touched.filter((path) => /\bInstitutionMark\b|\bProviderMark\b/.test(read(path)));
checkTrue(
  "every mark comes from src/ui/provider-picker",
  markImports.every((path) => read(path).includes('from "@/ui/provider-picker"')),
);

done();
