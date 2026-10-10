# Listing score and radar chart

A 0–100 score per listing, built from five axes the user scores against their own targets, weighted
per job, and drawn as a radar ("spiderweb") chart on the listing detail page.

The progress ledger is `listing-score.progress.md`. Update it after every step, before anything else.

---

## 0 Scope

Decided with the user (2026-10-10):

| Question | Answer |
|---|---|
| Axes | Value for money, Commute, Schools, Space, Monthly cost |
| Scaling | The user's own targets: an ideal and a worst case per axis, linear in between |
| Weights | Per job, equal by default |
| Missing data | The axis scores a neutral 50 and is drawn as "unknown" |
| Commute | One address, the user's workplace (a saved travel-time address) |
| Surfaces | Radar on the listing detail page, a score chip on listing cards, MCP |

Out of scope: sorting and filtering by score, score in notifications, connectivity and
neighbourhood axes (supermarkets, jobs, tax). The axis list is open for later additions, so build it
as a registry, not five hardcoded branches.

## 1 The axes

Every axis turns a raw value into 0–100 with the job's targets:

```
score = clamp(0, 100, 100 × (worst − value) / (worst − ideal))
```

That one formula covers "lower is better" (ideal < worst) and "higher is better" (ideal > worst).
A value past the ideal scores 100, a value past the worst scores 0.

| Axis | Raw value | Direction | Source | Default targets |
|---|---|---|---|---|
| **Value for money** | Price per m² (purchase price or rent) | lower | `price / size` on the listing | ideal / worst = 25th / 90th percentile of the job's active listings, until the user sets them |
| **Commute** | Minutes to the commute address | lower | `listing_travel_times` for that address label (exact over estimated when both exist) | 20 / 60 |
| **Schools** | Average grade of the nearest schools | higher | the Danish school layer (`getSchoolLayer`), the schools within 2 km of the listing, or the 3 nearest if none | 7 / 4 (Danish 7-point scale) |
| **Space** | m², with rooms as a bonus (see §1.1) | higher | listing `size`, `rooms` | the job's `spec_filter` min size as worst, +40 % as ideal |
| **Monthly cost** | Rent, or ejerudgift plus the user's Danish financing net payment once `dk-buying` step 8 lands, otherwise the price | lower | the listing, the rental terms, the sale terms, the finance profile | the finance profile's ceiling as worst, 75 % of it as ideal |

### 1.1 Notes per axis

- **Value for money** and **Monthly cost** must not double-count the price. Value for money is
  normalised by m² and compared with the market; monthly cost is absolute and compared with the
  budget. That is the reason both stay.
- **Commute** reuses what the job already knows: `commute_filter.limits` (migration 35) is keyed
  by address label. The score names one label (`commute.label`), defaulting to the only label in
  `limits` if there is exactly one, else asks.
- **Schools** is Danish-only today. Outside Denmark it is always missing (50, drawn as unknown). The
  layer needs `UDDANNELSESSTATISTIK_API_KEY`; without it, also missing. School positions come from
  STIL's register; the nearest-school lookup is in memory (a few thousand points), computed on read.
- **Space**: `size` drives the axis. Rooms add up to 10 points when they meet the job's min rooms,
  so a 70 m² three-room flat beats a 70 m² two-room flat without rooms becoming an axis of their own.
- **Monthly cost** for a rental with `chargesIncluded: false` adds the Nebenkosten surcharge exactly
  as the finance verdict does (`lib/services/finance/affordability.js`); reuse that, don't recompute.

## 2 Storage

**Targets and weights**: a new nullable JSON column `score_config` on `jobs`, in the style of
`commute_filter`. Its own column, not a key in `spec_filter`, for the same reason migration 35 gives:
the score is computed on read, the spec filter runs early in the pipeline.

```json
{
  "weights":  { "value": 1, "commute": 1, "schools": 1, "space": 1, "monthly": 1 },
  "targets":  { "commute": { "ideal": 20, "worst": 60 }, "schools": { "ideal": 7, "worst": 4 } },
  "commute":  { "label": "Work" }
}
```

Everything optional; NULL means every default. A weight of 0 switches an axis off and removes its
spoke.

Migration number: `dk-buying` takes 51 for `sale_terms`. Use the next free number at the time of
the step and re-check before merging, since both branches are open at once.

**The score itself is not stored.** It depends on the targets, the weights, the job's other listings
(value-for-money defaults) and the finance profile, all of which change; a stored score would be
stale the moment any of them moved. Compute it on read in one pass per listing query. If profiling
shows it matters, cache per `(job, listing, config hash)` in memory, not on disk.

## 3 The service

`lib/services/score/`:

- `axes.js`: the registry. Each axis is `{ id, labelKey, direction, raw(listing, ctx), defaults(ctx) }`.
  `raw` returns a number or `null` (missing).
- `score.js`: pure. `scoreListing(listing, config, ctx) → { total, axes: [{ id, raw, score, missing, weight }] }`.
  Missing axes score 50 and carry `missing: true`. The total is the weighted mean.
- `context.js`: the only part that reads the database or the caches. It builds `ctx` for a batch of
  listings: the job's config, the percentiles for value-for-money defaults, the travel times, the
  school index, the finance profile. One query per kind, never one per listing.

Hook into the listing read paths the overview, the detail page and MCP already use, adding
`score` to each listing object.

## 4 UI

- **Radar chart** on the listing detail page (`ListingScoreCard.jsx`): chart.js `radar` through
  `react-chartjs-2`, both already dependencies. Five spokes in registry order. A missing axis is drawn
  at 50 with a dashed point and "unknown" in the tooltip. The total sits beside the chart; each spoke's
  tooltip shows the raw value with its unit and the target band ("32 min, ideal 20, worst 60").
- Canvas cannot read CSS custom properties: take colours through `chartTheme.js` getters, as the
  existing charts do, and rely on the theme key on `<Layout>` for repaints (AGENTS.md, "Things CSS
  cannot switch").
- **Score chip** on listing cards: the total as a number, coloured by band (≥ 70 good, 40–69 fair,
  < 40 poor) using existing tokens. Hover lists the five axis scores.
- **Job form**: a "Score" card with a weight slider and ideal/worst inputs per axis, empty fields
  showing the default as placeholder. Commute address picker from the saved travel-time addresses.
- i18n in all locales.

## 5 MCP

`get_listing` and `list_listings` include `score.total` and the per-axis scores in
`mcpNormalizer.js`, as a short Markdown table on `get_listing` and one number per row on
`list_listings`.

## 6 Steps

Each step is one commit and one tick in the ledger, with tests (AGENTS.md: tested and JSDoc'd).
`yarn lint`, `yarn format:check`, `yarn test:offline` after each.

1. Ledger created.
2. `score/score.js` and the target formula, pure, with exhaustive unit tests (both directions,
   clamping, missing axes, zero weights, all-missing).
3. `score/axes.js`: value for money, space, monthly cost (the axes with no external data). Tests.
4. Commute axis from `listing_travel_times`. Tests with fixtures for exact, estimated, missing.
5. Schools axis: the nearest-school index over the school layer, Danish-only. Tests with a small
   school fixture.
6. Migration `score_config` on `jobs`; job storage read and write; API validation.
7. `score/context.js` and the read-path hook; `score` on listings from the API.
8. `ListingScoreCard` with the radar chart, both themes.
9. Score chip on listing cards.
10. Job form "Score" card.
11. MCP.
12. `doc/listing-score.md`, then acceptance: both themes, phone width, a Danish and a German job.

## 7 Risks

- **Relative defaults move.** Value-for-money defaults are percentiles of the job's own listings, so
  a listing's score shifts as the job finds more. Show "based on N listings" in the tooltip until the
  user pins targets.
- **Read cost.** Scoring a page of the overview needs travel times, schools and the finance profile
  for every row. Batch per page; measure before caching.
- **Schools coverage.** Kommune-level school data is coarse and Danish-only. The axis must say what
  it measured ("3 schools within 2 km, average grade 6.8").
- **Two open plans touch migrations.** `dk-buying` and this one each add one; renumber on merge.
