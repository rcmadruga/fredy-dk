# Ledger: Listing score and radar chart

Status per step. Updated after every step, before anything else. The plan is `listing-score.md`;
§0 is the scope, §6 the steps.

## Score engine

- [ ] 1 Ledger created
- [ ] 2 `score.js` and the target formula
- [ ] 3 Axes: value for money, space, monthly cost
- [ ] 4 Commute axis
- [ ] 5 Schools axis

## Storage and API

- [ ] 6 Migration `score_config` on `jobs`, storage, validation
- [ ] 7 `context.js`, `score` on listings from the API

## UI and MCP

- [ ] 8 `ListingScoreCard` radar chart
- [ ] 9 Score chip on listing cards
- [ ] 10 Job form "Score" card
- [ ] 11 MCP
- [ ] 12 Docs and acceptance

## Notes

- Migration number to be settled against `feat/dk-buying` (which takes 51).
- Monthly cost for a purchase uses the price until `dk-buying` step 8 (Danish financing) lands.
