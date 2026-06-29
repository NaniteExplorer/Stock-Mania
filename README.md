# stockMania

Real-time stock tracking, watchlists, AI-powered market summaries, and deep
company insights — built with **Next.js 16** (App Router), MongoDB, Better-Auth,
Inngest, and Finnhub + TradingView.

## Getting started

```bash
npm install
cp .env.example .env   # then fill in the values
npm run dev            # http://localhost:3000
```

## Scripts

- `npm run dev` — dev server (Turbopack)
- `npm run build` — production build
- `npm start` — serve the production build
- `npm run lint` — ESLint

## Project structure

```
app/         Next.js routes (thin — delegate to features)
proxy.ts     App request gate (Next 16; replaces middleware)
branding/    Brand identity (name, copy) — single source of truth
core/        Cross-cutting infrastructure: config · logger · cache · queue · http · db
features/    Domain modules (actions -> services -> repositories): watchlist · stocks · news · user
lib/         Shared utils, constants, Inngest functions, email, auth
components/   Shared UI + ui/ primitives
```

The dependency rule is `app -> features -> core`.

## Theming

The visual identity (premium navy + gold, light/dark) lives entirely in the
design tokens at the top of [`app/globals.css`](app/globals.css) and the brand
strings in [`branding/brand.ts`](branding/brand.ts). Light/dark is handled by
`next-themes` (toggle in the header).

## Architecture & scaling

See [SCALABILITY.md](./SCALABILITY.md) for the layered architecture and exactly
where Redis, Kafka, Postgres, Nginx/Kong, Kubernetes, and Prometheus plug in.

## Tech

Next.js 16 · React 19 · MongoDB + Mongoose · Better-Auth · Inngest · Tailwind 4 ·
shadcn / Radix · Finnhub · TradingView · Gemini
