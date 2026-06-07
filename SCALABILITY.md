# Scalability Guide — stockMania

This codebase was refactored to be **scale-ready**. Application logic is isolated
behind small interfaces in `core/`, so heavy infrastructure can be introduced
next session by swapping _implementations_ — without rewriting feature code.

This document maps each planned piece of infrastructure to the exact seam it
plugs into.

## Architecture at a glance

```
app/              Next.js routes (thin — delegate to features)
proxy.ts          App request gate (Next 16; was `middleware`)
branding/         Brand identity (name, copy) — single source of truth
core/             Cross-cutting infrastructure — the swappable seams
  config/         Validated, typed server env + client-safe public config
  logger/         Logger interface + ConsoleLogger
  cache/          CacheProvider interface + InMemoryCache
  queue/          EventBus interface + Inngest client/adapter
  http/           fetchJSON — single outbound-call choke point
  db/             Mongo connection + Repository interfaces
features/         Domain modules (actions -> services -> repositories)
  watchlist/      model · repository · service · actions
  stocks/         service · actions
  news/           service
  user/           service
lib/              Shared utils, constants, inngest functions, email, auth
components/        Shared UI + ui/ primitives
```

**Dependency rule:** `app -> features -> core`. Features don't import each
other's internals; cross-cutting concerns live in `core`.

## Where each tool plugs in (next session)

### Redis -> `core/cache/index.ts`
Implement `RedisCache` (ioredis / Upstash) against the existing `CacheProvider`
interface and swap the exported `cache`. Then:
- Wrap per-symbol Finnhub calls in `features/stocks/stocks.service.ts` and
  `features/news/news.service.ts` with `cache.wrap(...)` so one upstream call
  serves every user (instead of hitting the 60 req/min free tier per request).
- Add Better-Auth secondary storage (Redis) so the per-request session lookup in
  layouts and `proxy.ts` stops hitting Mongo on every hit.
- Back a rate limiter in `proxy.ts` / route handlers with Redis.

### Apache Kafka -> `core/queue/event-bus.ts`
Implement `KafkaEventBus` (kafkajs) behind the `EventBus` interface and swap the
`eventBus` export. Publishers don't change — e.g. `lib/actions/auth.actions.ts`
already emits `app/user.created` via `eventBus.publish(...)`. Replace the Inngest
consumers in `lib/inngest/functions.ts` with Kafka consumers / a worker.

### Postgres -> `core/db/*` + `features/*/*.repository.ts`
Implement `PostgresWatchlistRepository` (Prisma / Drizzle) against the
`WatchlistRepository` interface and swap the export in
`features/watchlist/watchlist.repository.ts`. Services and actions stay
untouched. `core/db/repository.ts` holds the generic contract; add new
repositories the same way. (Better-Auth moves to its Postgres adapter.)

### Nginx / Kong -> in front of the app
The Next.js server is largely stateless (heavy chart data is offloaded to
TradingView's CDN, client-side). Put Kong/Nginx in front for TLS, routing, and
gateway-level rate limiting/auth. The `proxy.ts` optimistic redirect stays for
app-level concerns.

### Kubernetes -> deployment
Components: Next.js standalone server, an Inngest/Kafka worker, Mongo/Postgres,
Redis, Kafka. Containerize each. `core/config/env.ts` is the single place runtime
config is read (12-factor friendly). Add a `/api/health` route for liveness /
readiness probes.

### Prometheus / OpenTelemetry -> `core/logger` + `instrumentation.ts`
Replace `ConsoleLogger` with pino and register an OpenTelemetry SDK in
`instrumentation.ts` (Next supports it). Expose metrics via `prom-client`.
`core/http/fetchJSON` is the natural spot to record upstream latency/error
counters.

## Security & reliability hardening (status)

- [x] **Daily news fan-out** — `lib/inngest/functions.ts` now dispatches one
  durable event per user; `sendUserNewsSummary` does the work with `concurrency`
  + `throttle` caps, idempotency, and independent retries. No more single
  long-running step that times out at scale.
- [x] **Server-only Finnhub key** — `core/config/env.ts` prefers `FINNHUB_API_KEY`
  (warns on the legacy `NEXT_PUBLIC_` variant); `.env` migrated.
- [x] **Per-symbol news cache** — `features/news/news.service.ts` caches via the
  `core/cache` seam so one upstream call serves all users (in-memory now).
- [x] **Auth rate limiting** — `core/ratelimit` seam applied to sign-in / sign-up.
- [x] **Security headers** (`next.config.ts`), **startup config validation**
  (`instrumentation.ts`), and **CI secret scanning** (`.github/workflows/ci.yml`
  + gitleaks). See [SECURITY.md](./SECURITY.md).

Still to do (need the infra below):

- [ ] **Distributed limits + cache** — the in-memory rate limiter and cache are
  per-instance; swap to Redis so they hold across instances behind Nginx/Kong.
- [ ] **Observability** — replace `console.*` with structured logging + an error
  tracker (Sentry) and Prometheus/OTel metrics before production.
- [ ] **Rotate exposed secrets** — re-issue any credential that has lived in a
  working-tree `.env` (see SECURITY.md).
