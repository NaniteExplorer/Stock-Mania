import { permanentRedirect } from "next/navigation";

/**
 * Liabilities: retired (DESIGN.md §9c, D.2).
 *
 * Debt lives in the sidebar's "Debt" group (Cards and Loans), so this route must
 * send old bookmarks to `/loans` and never 404. The redirect is done by
 * `redirects()` in `next.config.ts`, which runs before the filesystem routes, so
 * this page does not normally render. It stays as a fallback: if that config entry
 * is ever removed, `permanentRedirect` still answers with the same permanent 308
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/permanentRedirect.md).
 *
 * The placeholder that used to live here held no data. Its KPI row (Outstanding,
 * Cards, Loans, Monthly outgo) and its table columns (liability, type, rate,
 * outstanding) are recorded in `_architecture/requirements/design-debt-d2-d4.md`.
 * They map onto the Debt group header that §9c specifies.
 */
export default function Page(): never {
  permanentRedirect("/loans");
}
