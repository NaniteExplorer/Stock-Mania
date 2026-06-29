# Security Policy — stockMania

## Reporting a vulnerability

Email **security@stockmania.app** (or the maintainer) with details and steps to
reproduce. Please do not open public issues for security reports.

## Secret management

- **Never commit `.env`.** It is gitignored (`.env*`), and `.env.example`
  (committed) documents the required variables with placeholder values.
- **Rotate any credential that has ever sat in a developer's working tree** —
  MongoDB URI/password, `BETTER_AUTH_SECRET`, the Gmail app password, the Gemini
  key, and the Finnhub key. Treat them as potentially exposed and re-issue them.
- **CI secret scanning** runs [gitleaks](https://github.com/gitleaks/gitleaks)
  on every push/PR (`.github/workflows/ci.yml`, config in `.gitleaks.toml`) to
  block secrets from entering history.
- **Secrets-manager integration point:** all server secrets are read in exactly
  one module — [`core/config/env.ts`](core/config/env.ts). To adopt Vault /
  Doppler / AWS Secrets Manager, fetch values there instead of `process.env`;
  nothing else in the app reads secrets directly.

### Optional local pre-commit hook

```bash
gitleaks protect --staged --config .gitleaks.toml
```

## Application protections (implemented)

- **Server-only API keys** — the Finnhub key is read server-side only
  (`FINNHUB_API_KEY`); the data layer (`features/*`) runs on the server so the
  key is never shipped to the browser. The legacy `NEXT_PUBLIC_` variant triggers
  a warning.
- **Auth rate limiting** — sign-in / sign-up are throttled per IP (+ email) via
  [`core/ratelimit`](core/ratelimit/index.ts) to slow brute force / credential
  stuffing. (Per-instance today; back it with Redis for multi-instance.)
- **Security headers** — `next.config.ts` sets `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and HSTS.
- **Startup validation** — `instrumentation.ts` validates critical config at
  boot so misconfiguration is visible immediately.
- **Auth gate** — `proxy.ts` performs an optimistic signed-out redirect; real
  authorization is enforced per page/route via `getCurrentSession()` and inside
  every mutating Server Action.

## Content-Security-Policy (enabled)

A CSP **is enabled** in `next.config.ts` (`contentSecurityPolicy`). It allowlists
the TradingView embed origins (plus Finnhub / Google APIs used by the client) and
adds `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` and
`frame-ancestors 'none'`. `'unsafe-inline'` is still required for scripts/styles
because Next.js and the TradingView widgets inject inline content without a nonce.
**Verify the TradingView charts after any change** — a too-strict policy will show
CSP violations in the browser console. To eliminate `'unsafe-inline'`, migrate to a
nonce-based policy (see `node_modules/next/dist/docs/.../content-security-policy.md`).

## Other application protections

- **Email verification required** — sign-up no longer auto-signs-in; users must
  click a verification link (`emailVerification` in `lib/better-auth/auth.ts`).
- **Strong passwords** — `validatePasswordStrength` in `lib/actions/auth.actions.ts`
  requires upper, lower, digit and symbol.
- **Explicit session/cookie config** — 7-day session, `HttpOnly` + `SameSite=Lax`,
  `Secure` in production, plus `trustedOrigins`.
- **Input validation** — every data Server Action validates its payload with zod
  (`features/*/**.schema.ts`) before touching the database.
- **Public endpoints throttled** — `/api/prices/[symbol]` and `/api/health` are
  rate-limited per IP (`core/http/rate-limit-request.ts`).
- **No internal-error leakage** — `/api/health` logs failures server-side and
  returns only a status.

## Dependencies

`npm audit --audit-level=high` runs in CI. Keep dependencies patched. As of the
last sweep, `next` (16.2.9) and `nodemailer` (9.x) are on patched lines. The
remaining advisories (`kiteconnect`, `exceljs`, and their transitive
`mocha`/`serialize-javascript`/`uuid` chain) are **intentionally not "fixed"** —
npm's only available fix is a **major downgrade** (`kiteconnect 5→4`,
`exceljs 4→3`) that would regress the Zerodha integration and Excel export. The
`serialize-javascript` advisory is reachable only through `kiteconnect`'s bundled
test framework (`mocha`), not at runtime. Revisit when upstream ships a
non-downgrade fix.
