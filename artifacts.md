# Artifacts

Mockups and design studies published during the v2 redesign. All are private
Claude artifacts; open while signed in as the owner.
Updated: 2026-10-21

## Stock-Mania — redesign v2

| Artifact | Link | Covers |
|---|---|---|
| Control Bench | https://claude.ai/artifact/G7p2WaM2VsKP5X7y1fxJwF | Component library and the corrected token set — the source of truth for every artifact below |
| Institutional Shell | https://claude.ai/artifact/M73JMRQLrTDzvBc6QhnruP | App frame, navigation, page chrome |
| Banking Console | https://claude.ai/artifact/5NNyzMvd2vEqQ5tyNK2bok | Accounts, statements, savings analytics |
| Statement Intake | https://claude.ai/artifact/Eamd8tRPuzwpAZL4Lp9JZD | PDF/CSV import, parse review, balance reconciliation |
| Investments | https://claude.ai/artifact/SmtWkzWxD2ZZubG6P7PDLr | Holdings, trades, lots, performance |
| Assets, Debt & Platforms | https://claude.ai/artifact/55dP8AxSEaht8HDxNqQWvq | Physical assets, loans, cards, broker platforms |
| Public Surfaces | https://claude.ai/artifact/5DCknnwiSkNPPz1qg8p1YL | Marketing/auth/unauthenticated pages |
| Mutation Model | https://claude.ai/artifact/7QPCpfeFEE2DRh3pQpENdJ | Edit / undo / redo / remove one / remove all — the CRUD model over an append-only ledger |
| Elevation Pass | https://claude.ai/artifact/52M35wom7TZS284Quai8RM | Before/after answer to the "too basic" verdict — the composition layer (type scale, spacing rhythm, mono figures, border ranks) on Dashboard, Holdings and Register |
| Income & Standing | https://claude.ai/artifact/9PLGPtgzz7JZbJhRuc6LUr | Income streams, savings-rate decomposition, recurring vs discretionary outgo, committed outgo, seasonality, and the financial-health pillars with India/World percentile bands |
| Analytics Depth | https://claude.ai/artifact/76Ft9Qama2js5s3zv9fMWU | The comparison layer on the investment surfaces — Dashboard, 18-column Holdings, and the single-holding detail page (non-financial, bank and mutual-fund variants). Every figure placed beside a reference value; counts measured by the page itself |

## Earlier Stock-Mania studies

| Artifact | Link | Covers |
|---|---|---|
| Free Market Data Verdict | https://claude.ai/artifact/AEE24Ucieq8m4bjck4t8n3 | Keyless price-source survey and verdict |
| Digital Gold Analytics | https://claude.ai/artifact/RmfHhk6nzK43G4gdpUuFDo | Digital gold holdings and lease analytics |
| Neutral Chrome, Colored Data | https://claude.ai/artifact/8ANBe56mNrdgx8PGMKMJXq | Colour-use principle for financial surfaces |

## Known gaps

- No artifact has been inspected visually — no agent in this session had a
  browser or screenshot tool. Narrow widths, chart label crowding and
  dark-theme rendering are unverified by eye.
- Banking Console predates the corrected token set (no `--border-control`;
  `--border-strong` still fails 3:1) and is visibly one step apart from
  Statement Intake until refitted.
- The debt-aggregates navigation placement is inconsistent between artifacts
  and is still unreconciled.
