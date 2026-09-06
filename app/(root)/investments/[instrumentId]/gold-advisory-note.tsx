/**
 * SEBI's advisory of 8 November 2025, rendered persistently beside the holding.
 *
 * It sits with the performance figures on purpose. A return of 14% p.a. and
 * "there is no statutory investor protection behind this" are the same
 * decision, and separating them — a footer, a tooltip, a settings page — is how
 * a screen ends up flattering an unregulated product.
 */
export default function GoldAdvisoryNote({ isLeased }: { isLeased: boolean }) {
  return (
    <aside
      className="mb-6 rounded-lg border border-amber-600/40 bg-amber-500/5 px-4 py-3"
      aria-label="Regulatory advisory"
    >
      <p className="text-xs font-semibold text-amber-500">
        Digital gold is unregulated — SEBI advisory, 8 November 2025
      </p>
      <p className="mt-1 text-xs text-gray-400">
        Digital gold (also sold as e-gold or digital gold receipts) is neither a security nor
        a commodity derivative, so it falls outside SEBI&apos;s regulatory framework. No
        statutory investor protection applies: no exchange settlement guarantee, no investor
        protection fund, and no SEBI grievance redressal. What you hold is a contractual claim
        on the platform.
        {isLeased && (
          <>
            {" "}
            Leasing adds a second, separate risk — your grams are lent to third-party
            jewellers as an unsecured credit exposure, and the interest is only as good as
            their ability to repay.
          </>
        )}
      </p>
    </aside>
  );
}
