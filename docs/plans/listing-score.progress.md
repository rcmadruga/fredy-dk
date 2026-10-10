# Ledger: Listing score and radar chart

Status per step. Updated after every step, before anything else. The plan is `listing-score.md`;
§0 is the scope, §7 the steps.

## Phase A: engine on existing data

- [ ] 1 Ledger created
- [ ] 2 `score.js`: formula, groups, weights, missing, rent re-weighting
- [ ] 3 Money: value, affordable, budget
- [ ] 4 Schools: nearby, special, area
- [ ] 5 Work: commute, jobs
- [ ] 6 Home: size, bathrooms, grocery, park, internet, newBuild
- [ ] 7 Heuristics: upkeep, parking
- [ ] 8 Migration `score_config`, storage, validation
- [ ] 9 `context.js`, `score` on listings from the API

## Phase B: UI and MCP

- [ ] 10 `ListingScoreCard`: radar and breakdown
- [ ] 11 Score chip on listing cards
- [ ] 12 Job form "Score" card
- [ ] 13 MCP

## Phase C: new sources

- [ ] 14 Valuation trend: spike, client, metric
- [ ] 15 Income and safety (DST): spike, clients, metrics
- [ ] 16 `listing_area_facts`, Overpass sweeper: green, quiet
- [ ] 17 Commute options

## Close

- [ ] 18 Docs and acceptance

## Notes

- Migration numbers to be settled against `feat/dk-buying` (which takes 51).
- `work.jobs` depends on the jobs layer, which fails on the deployed instance (#11).
- `money.affordable` for a Danish purchase uses the Danish model from `dk-buying` step 8; until that
  merges, it falls back to the existing verdict.
- The dev sandbox cannot reach api.statbank.dk or boliga.dk; spikes 14 and 15 verify on the host or
  from documentation.
