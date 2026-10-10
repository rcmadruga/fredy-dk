# Roulette: an agent that learns what we want

Fredy shows one listing at a time. Each of us answers with a verdict and a reason. From those
answers an agent learns what each of us actually wants, and proposes changes to the score, the
filters and the jobs. Nothing changes until we accept it.

The progress ledger is `roulette.progress.md`. Update it after every step, before anything else.

Depends on `listing-score` (the score config is the model this plan tunes) and on `dk-buying`
(sale data for the Deal group).

---

## 0 Scope

Decided with the user (2026-10-10):

| Question | Answer |
|---|---|
| Who rates | Each person separately, one model per person; the household score combines them |
| Autonomy | **Suggest only.** Every change is a proposal with evidence, accepted or rejected by a person |
| LLM | A local LLM on **another machine** on the network (Ollama over HTTP). Optional: everything works without it |
| Surface | An in-app card stack |
| Exploration | Yes. Sometimes show listings just outside the job's filters |
| Reasons | Worth exploring / Not interested (the verdict), Too expensive, Too small, Too far, Bad area, Not fun, Too much work, free-text note |

Out of scope: Telegram buttons; anything applied without a person accepting it; cloud LLMs.

## 1 What the user sees

**The roulette page** (`/roulette`): one card at a time, for the logged-in user.
- Photo, title, price, size, rooms, address, the score radar (hexagon for a purchase, pentagon
  for a rental), the household score, and both people's scores when they differ.
- An "outside your filters" badge on exploration cards, naming the limit it breaks ("12 % over your
  max price").
- Two verdict buttons: **Worth exploring** and **Not interested**.
- Reason chips, any number: **Too expensive · Too small · Too far · Bad area · Not fun · Too much
  work**. Plus an optional one-line note. Reasons are optional, but "Not interested" without one
  teaches very little, and the UI says so once.
- Keyboard: ← not interested, → worth exploring, 1–6 toggle reasons. On a phone, swipe.
- "Worth exploring" also stars the listing (the existing watch list), so the verdict has a use the
  same day.

**Agent suggestions** (`/roulette/suggestions`, with a badge in the nav): one card per proposal.
Each card shows what would change, as a before → after diff, why (the evidence: "4 of your last 6
'Too far' were over 42 min"), and **Accept** or **Dismiss**. Accepting writes through the same
storage functions the job form uses.

**Disagreements**: listings one of us marked "worth exploring" and the other "not interested" get
a list of their own. Those are the ones worth talking about.

### 1.1 Approved layout

The layout was approved by the user on 2026-10-10. The reference is in `roulette-mockup/`:
`mockup.html` (open it with `?view=card` or `?view=sug`, plus `&theme=light`) and three
screenshots. The mockup's colours are copies of `themes.less`; the real build uses the tokens.

## 2 What gets learned

The model is the score config from `listing-score` (group weights, metric weights, ideal/worst
per metric), plus the job's filters. That is a few dozen numbers: small enough to learn from tens
of ratings, and every change can be explained in one sentence.

### 2.1 Per person

The score config stays on the job (`score_config`, set in the job form). The learner writes
**per-person overlays**: `score_preferences (user_id, job_id, config JSON)`, applied on top of the
job's config when scoring for that person. Overlays change only by accepting a proposal.

**Household score** = the mean of the two people's scores. **Disagreement** = the two scores more
than 25 points apart, or opposite verdicts.

### 2.2 Reasons → targeted proposals (rules, no LLM)

Each reason points at one group. The rule looks at the raw metric values of the listings that got
that reason, and proposes moving the target to where the user's actual line seems to be.

| Reason | Group | Proposal, once there is enough evidence |
|---|---|---|
| Too expensive | Money | `budget`/`value` worst ← the 25th percentile of the flagged listings' values; if most flagged listings are inside the job's max price, also propose lowering it |
| Too small | Home | `size` worst ← the 75th percentile of the flagged sizes; if they pass the job's min size, propose raising it |
| Too far | Work | `commute` worst ← the 25th percentile of the flagged commute times |
| Bad area | Area | Raise the Area group weight; if the flagged listings cluster in postcodes, propose excluding them (blacklist, or narrowing the job's area) |
| Too much work | Home | Raise the `upkeep` and `newBuild` weights; `newBuild` worst ← the flagged listings' age |
| Not fun | — | No rule. Kept as a label for the regression (§2.3) and for the LLM (§2.5) |

"Enough evidence": at least 4 flagged listings, at least 3 of which agree on the direction, and a
change of at least 10 % of the current target. Thresholds are constants in one file.

### 2.3 Verdicts → weights (regression)

For each person, a logistic regression with "worth exploring" as 1 and "not interested" as 0. The
features are the group scores at the moment of rating (snapshotted, §3). It is fitted with an L2
prior pulling towards the current weights, so few ratings mean small moves. From 20 ratings on,
whenever a refit moves a group weight by more than 0.2, it proposes the new weights with the
evidence ("you said yes to 9 of 10 listings with Area > 70").

Plain JavaScript; a 6-feature logistic regression needs no library. Refit after each rating; it
takes milliseconds.

### 2.4 Exploration → filter proposals

When a person marks exploration cards "worth exploring", their limit is wider than the filter.
- "Worth exploring" on ≥ 3 over-the-max-price cards: propose raising the max price to cover them.
- "Not interested, too expensive" on ≥ 3 in-filter cards near the max price: propose lowering it.
- The same logic for min size and the commute limit.

### 2.5 The local LLM (optional)

Ollama on another machine, configured by the admin with `llmBaseUrl` and `llmModel` in settings.
Unset means no LLM, and every rule above still works. Two jobs, both producing proposals that go
through the same accept/dismiss inbox:
1. **Reading notes.** Sort a free-text note into the existing reasons, or into a new tag
   (`dark`, `noisy`, `layout`). Tags that recur become a suggestion to add a reason chip. Output is
   JSON validated against a schema; anything that fails validation is dropped.
2. **Drafting jobs.** Given a summary of the "worth exploring" listings (postcodes, price band,
   types) and the current jobs, propose a new job or a change to an existing one as structured
   JSON in the job-draft format the MCP job tools already use (`lib/mcp/jobDraftStore.js`).
   Validated like any job before it can be accepted.

What goes to the LLM: listing title, description, postcode and the user's note. No credentials,
no other users' data. It runs on the user's own network.

## 3 Storage

New migrations; numbers are settled at merge time against the other open plans.

- `listing_feedback`: `id, listing_id (FK, ON DELETE SET NULL), user_id, job_id, verdict ('explore'|'pass'),
  reasons JSON, note TEXT, outside_filter JSON (which limit, by how much, or NULL), snapshot JSON, created_at`.
  `snapshot` holds the group and metric raw values and scores at rating time. The learner reads
  only snapshots, so retention purges and price changes never rewrite history.
- `score_preferences`: `user_id, job_id, config JSON, updated_at`. Primary key `(user_id, job_id)`.
- `agent_proposals`: `id, user_id, job_id, kind ('score_target'|'score_weight'|'filter'|'blacklist'|'new_job'|'reason_chip'),
  diff JSON, evidence JSON, rationale TEXT, source ('rules'|'regression'|'llm'), status
  ('pending'|'accepted'|'dismissed'|'superseded'), created_at, decided_at`. A newer proposal for the
  same target supersedes the pending one.
- `jobs.explore_margin`: nullable JSON, e.g. `{"price": 0.15, "size": 0.15}`. NULL means no
  exploration for that job.
- `listings.outside_filter`: nullable JSON, set on listings kept only because of the margin.

## 4 Where exploration listings come from

The spec filter (price, size, rooms) runs **before** a listing is stored
(`FredyPipelineExecutioner`, `_filterBySpecs`, right after `_findNew`). Listings outside the filter
never reach the database, so there is nothing outside the filters to show. The area filter is
different: it stores first and soft-deletes after, so those rows exist.

The change: with an `explore_margin`, `_filterBySpecs` keeps listings that miss a limit by no more
than the margin, sets `outside_filter`, and lets them be stored. Then:
- `_notify` and `_sendNewListingsToUser` skip them, so they never notify.
- The overview and the map hide them by default ("show exploration listings" toggle).
- The roulette uses them for exploration cards, plus soft-deleted area-filter rows within a
  margin of the drawn area.

Cost: a listing in the margin pays for the detail fetch and the geocode. That is why the margin is
per job, off by default, and capped at 25 %.

## 5 Choosing the next card

For the current user: candidates are active listings in jobs they can see that they have not
rated yet. Then:
- 80 %: the highest household score among in-filter candidates (exploit).
- 20 %: a random exploration candidate, weighted towards the listings closest to the limit
  (explore).
- Never the same listing twice for the same person. Listings rated by the other person and not
  yet by this one rank first, so disagreements surface quickly.

Pure function over the candidates, tested with fixed seeds.

## 6 Code layout

- `lib/services/roulette/`
  - `feedbackStorage.js`, `proposalStorage.js`, `preferencesStorage.js`
  - `nextCard.js`: §5, pure
  - `learner/rules.js` (§2.2), `learner/regression.js` (§2.3), `learner/exploration.js` (§2.4): pure, each returns proposals
  - `learner/index.js`: runs after each rating and dedups against pending proposals
  - `llm/ollamaClient.js`, `llm/notes.js`, `llm/jobDraft.js`: §2.5, all optional
  - `applyProposal.js`: the only module that writes to jobs and configs, through existing storage
- `lib/api/routes/rouletteRouter.js`: next card, rate, list or accept or dismiss proposals,
  disagreements
- UI: `ui/src/views/roulette/` (card stack, suggestions inbox, disagreements). It reuses
  `ListingScoreCard` from `listing-score`.
- MCP: `list_agent_proposals` and `get_listing_feedback`, read-only.

## 7 Steps

One step = one commit = one ledger tick, with tests and JSDoc. `yarn lint`, `yarn format:check`,
`yarn test:offline` after each.

**Phase A: rating**
1. Ledger created.
2. Migration: `listing_feedback`; `feedbackStorage.js` with snapshots.
3. `nextCard.js` (in-filter only for now); router: next card and rate.
4. Roulette page: the card, verdict, reasons, note, keyboard and swipe; "worth exploring" stars the listing.
5. Disagreements list.

**Phase B: learning**
6. Migrations: `score_preferences`, `agent_proposals`; their storage.
7. `learner/rules.js` (§2.2), with tests per reason.
8. `learner/regression.js` (§2.3), with tests for convergence on synthetic raters and for no move under 20 ratings.
9. Per-person overlays applied in the score's `context.js`; household score and disagreement.
10. Suggestions inbox; `applyProposal.js`; accept and dismiss.

**Phase C: exploration**
11. Migration: `jobs.explore_margin`, `listings.outside_filter`; the margin in `_filterBySpecs`;
    no notification for margin listings; hidden by default in the overview and map.
12. Exploration cards in `nextCard.js` (§5), plus the badge; `learner/exploration.js` (§2.4).
13. Job form: an "Exploration margin" setting.

**Phase D: local LLM (optional)**
14. Admin settings `llmBaseUrl`, `llmModel`; `ollamaClient.js` with timeout and schema validation; health check in settings.
15. `llm/notes.js`: notes into reasons and tags; reason-chip proposals.
16. `llm/jobDraft.js`: new-job and job-change proposals through the job-draft format.

**Close**
17. MCP read tools; `doc/roulette.md`; acceptance with two users, a rent job and a buy job, both
    themes, phone width.

## 8 Risks

- **Feedback loop.** Learning only from what the filters let through narrows the search. That is
  what exploration (§4, §5) is for; keep it on by default once Phase C lands.
- **Too few ratings.** Rules need 4 agreeing flags; the regression needs 20 ratings and moves
  slowly under its prior. Proposals say how many ratings they rest on.
- **Proposal fatigue.** Supersede rather than stack; at most one pending proposal per target; a
  dismissed proposal is not re-proposed until its evidence doubles.
- **Two people, one job.** Overlays are per person, but filters and jobs are shared. A filter
  proposal names whose ratings it comes from, and either person can accept it.
- **Margin cost.** Margin listings cost detail fetches and geocodes. Off by default, capped at 25 %.
- **LLM output.** Never trusted. Schema-validated, and always a proposal, never applied directly.
