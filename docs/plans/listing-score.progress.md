# Ledger: Listing score and radar chart

Status per step. Updated after every step, before anything else. The plan is `listing-score.md`;
§0 is the scope, §7 the steps.

## Phase A: engine on existing data

- [x] 1 Ledger created
- [x] 2 `score.js`: formula, groups, weights, missing, rent re-weighting
- [x] 3 Money: value, affordable, budget
- [x] 4 Schools: nearby, special, area
- [x] 5 Work: commute, jobs
- [x] 6 Home: size, bathrooms, internet, newBuild; heuristics upkeep, parking
- [x] 7 Area (grocery, park) and Deal (vsValuation, vsLastSale, priceDrop, onMarket, relisted)
- [x] 8 Migration `score_config`, storage, validation
- [x] 9 `context.js`, `score` on listings from the API

## Phase B: UI and MCP

- [x] 10 `ListingScoreCard`: radar and breakdown
- [x] 11 Score chip on listing cards
- [x] 12 Job form "Score" card
- [ ] 13 MCP

## Phase C: new sources

- [ ] 14 Valuation trend: spike, client, metric
- [ ] 15 Income and safety (DST): spike, clients, metrics
- [ ] 16 `listing_area_facts`, Overpass sweeper: green, quiet
- [ ] 17 Commute options

## Close

- [ ] 18 Docs and acceptance

## Notes

- Shape: hexagon for purchases (Money, Schools, Work, Home, Area, Deal), pentagon for rentals (no Deal).
- Deal reads `sale_terms`, so it needs `feat/dk-buying` merged first.
- Migration numbers to be settled against `feat/dk-buying` (which takes 51).
- `work.jobs` depends on the jobs layer, which fails on the deployed instance (#11).
- `money.affordable` for a Danish purchase uses the Danish model from `dk-buying` step 8; until that
  merges, it falls back to the existing verdict.
- The dev sandbox cannot reach api.statbank.dk or boliga.dk; spikes 14 and 15 verify on the host or
  from documentation.
- Migration number: 52 for `score_config`. The runner (`migrate.js`) tracks applied migrations by file
  name, not by sequence, so the gap at 51 (`feat/dk-buying`) is harmless on this branch.
- Phase C metrics (`money.trend`, `work.options`, `area.green`, `area.quiet`, `area.social`,
  `area.safety`) are registered as descriptors whose `raw` returns null until their step lands, so they
  score missing (50) and show as unknown.
- `sale_terms` is read defensively (`listing.sale_terms`, parsed or JSON text); absent means missing.
  The branch is not merged here.
- Phase A and B are done in this order; Phase C and step 18 are deliberately not part of this run.
- Step 8: `scoreConfig` is left alone on an update that does not mention it (`undefined`) and cleared by
  `null`, unlike `commuteFilter`, which an omitted value clears. The score card is edited separately, and
  an older client or the MCP job draft must not reset a job's weights. Three existing tests hand-build a
  `jobs` table (`jobStorageHydration`, `jobRouterTourGuard`, `jobChannelAuthorization`); each got a
  `score_config TEXT` column, because `jobStorage` now selects it.
- Step 9: `attachScores` is fail-soft (a score that cannot be built returns `score: null`, never a failed page)
  and reaches the storage modules through namespaces at call time, so route tests that partially mock one
  are not broken at import time. The national layers (schools, supermarkets, job posts) are raced against
  a 1.5 s deadline and count as unavailable (metrics unknown) while a cold fetch finishes in the
  background. Overview rows carry a compact score (total and group scores); the detail page carries every
  metric.
- Step 10: a group with no data is drawn as a hollow diamond marker and tooltip text "no data" instead of a dashed
  point: chart.js has no per-point dash for the radar marker. Off groups get a cross marker at the centre.
  The card sits in the detail rail after the finance card. The radar registers its own chart.js pieces via
  `registerScoreChart()` in chartTheme.js; colours come from the CHART_COLORS getters (a `FAINT` getter was added).
- Step 12: the Score card is its own card after the "Refine" fold (not inside it), since it filters nothing. The form keeps
  a client copy of the metric catalogue (`ui/src/services/score/metricCatalog.js`) because the browser cannot import
  `lib/`; `test/ui/scoreMetricCatalog.test.js` fails if it drifts from the server descriptors. Group weights use Semi
  sliders in steps of 0.5 up to 3 (the API allows up to 100 for scripted use). The commute picker offers named
  addresses only, not place types.
