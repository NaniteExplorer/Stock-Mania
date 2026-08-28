# Provider logos

A place for **official** institution logos — a file from the bank's own press kit
or brand guidelines. It is empty on purpose.

## Why it is empty

It used to hold five hand-traced SVGs (Axis, HDFC, SBI, PNB, Jio Payments). A
curated asset outranks every remote source, so those approximations *displaced*
the real thing: Axis and HDFC both publish a usable favicon, and the app drew its
own two-triangle sketch over the top of it. SBI's was a 143-byte circle.

A logo is an identity claim. A near-miss is worse than no logo, because the
branded badge we fall back to is visibly ours and never pretends to be the bank's
mark. So the traces are gone rather than improved.

## How resolution works

`ProviderMark` requests one URL — `/api/logo/<id>` — resolved server-side and
cached for 7 days:

1. **Local asset** — `provider.logo` in `src/ui/providers.ts`, if set. Only ever
   an official file. Drop one here and point `logo` at it.
2. **Favicon** — Google (128px, rejected below 1500 bytes so a 16px stub does not
   pass as a logo) then DuckDuckGo.
3. **404** — the client draws the gradient badge: the provider's short name on its
   own brand colours.

Clearbit used to sit above the favicons. Its keyless logo API has been withdrawn
and the host refuses the connection, so it was costing every lookup a connect
timeout and returning nothing.

## Adding a real one

Drop `<id>.svg` here, then set `logo: "/assets/providers/<id>.svg"` on that
provider. Use the institution's published asset — if you find yourself drawing it,
the badge is the better answer.
