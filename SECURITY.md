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

## Content-Security-Policy (verify, then enable)

A CSP is not enabled by default because it must allowlist the TradingView embed
origins. After confirming the widgets still load, add this to the
`securityHeaders` array in `next.config.ts`:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://s3.tradingview.com https://*.tradingview.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  frame-src https://*.tradingview.com https://www.tradingview.com;
  connect-src 'self' https://*.tradingview.com https://finnhub.io https://*.googleapis.com;
  font-src 'self' data:;
```

## Dependencies

`npm audit --audit-level=high` runs in CI. Keep dependencies patched.
