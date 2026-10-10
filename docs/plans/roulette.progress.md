# Ledger: Roulette

Status per step. Updated after every step, before anything else. The plan is `roulette.md`;
§0 is the scope, §7 the steps.

## Phase A: rating

- [ ] 1 Ledger created
- [ ] 2 `listing_feedback`, storage with snapshots
- [ ] 3 `nextCard.js` (in-filter), router
- [ ] 4 Roulette page
- [ ] 5 Disagreements list

## Phase B: learning

- [ ] 6 `score_preferences`, `agent_proposals`
- [ ] 7 Rules learner
- [ ] 8 Regression learner
- [ ] 9 Per-person overlays in scoring; household score
- [ ] 10 Suggestions inbox, accept and dismiss

## Phase C: exploration

- [ ] 11 Explore margin in the spec filter; no notification; hidden by default
- [ ] 12 Exploration cards; exploration learner
- [ ] 13 Job form setting

## Phase D: local LLM (optional)

- [ ] 14 Settings, Ollama client, health check
- [ ] 15 Notes into reasons and tags
- [ ] 16 Job drafts

## Close

- [ ] 17 MCP, docs, acceptance

## Notes

- Needs `feat/listing-score` merged: the score config is the model, and the card reuses `ListingScoreCard`.
- Migration numbers to be settled at merge against `feat/dk-buying` (51) and `feat/listing-score` (52).
