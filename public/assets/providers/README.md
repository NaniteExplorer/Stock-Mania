# Provider logos

Drop high-resolution institution logos here to override the favicon fallback.

## How it works

`ProviderMark` requests one URL — `/api/logo/<id>` — which resolves a logo in
this order (server-side, cached 7 days):

1. **Local asset** — `provider.logo` in `lib/financial-providers.ts` (preferred)
2. **Real logo provider** — logo.dev / Brandfetch, when `LOGO_DEV_TOKEN` or
   `BRANDFETCH_CLIENT_ID` is set (gives proper brand logos, not favicons)
3. **Favicon** — DuckDuckGo's icon service for `provider.domain` (keyless)
4. **Gradient badge** — branded initials (always works, no network)

## For real logos everywhere (recommended)

Set a free token in `.env.local` — get one at https://logo.dev (or
https://brandfetch.com):

```
LOGO_DEV_TOKEN=pk_xxxxxxxx
```

Then `/api/logo/<id>` serves proper brand logos for every provider with a
`domain`. No per-bank work needed.

## To add a real logo

1. Save the logo (SVG preferred; transparent PNG also fine) in this folder, e.g.
   `public/assets/providers/hdfc.svg`.
2. In `lib/financial-providers.ts`, set `logo` on that provider:

   ```ts
   { id: "hdfc", name: "HDFC Bank", /* … */, logo: "/assets/providers/hdfc.svg" }
   ```

That's it — the mark prefers your asset and falls back automatically if it's missing.

> Use logos you have the right to use. Square marks render best in the badge slots.
