# Listing score and radar chart

A 0–100 score per listing in groups (Money, Schools, Work, Home, Area, and Deal for purchases),
each built from metrics the user scores against their own targets and weights per job. Drawn as a
radar chart on the listing detail page with a drill-down into each group's metrics: a **hexagon for
a purchase** (six groups), a **pentagon for a rental** (five, no Deal). The shape tells at a glance
which kind of search a listing belongs to.

The progress ledger is `listing-score.progress.md`. Update it after every step, before anything else.

---

## 0 Scope

Decided with the user (2026-10-10):

| Question | Answer |
|---|---|
| Structure | Groups as radar spokes; each group is the weighted mean of its metrics; drill-down per group |
| Groups | Money, Schools, Work, Home (the dwelling), Area (where it is), Deal (purchases only) |
| Shape | Buy: hexagon, 6 spokes. Rent: pentagon, 5 spokes (no Deal) |
| Scaling | The user's own targets: an ideal and a worst value per metric, linear in between |
| Weights | Per job: one weight per group, and one per metric inside its group. Equal by default |
| Missing data | A metric with no value scores a neutral 50 and is drawn as "unknown" |
| Commute | To the user's company address (a saved travel-time address) |
| Rent vs buy | Rentals drop the Deal group, skip the other buy-only metrics, and re-weight over the rest |
| New sources | Valuation trend, income/social, safety, green/quiet, commute options: all wanted |
| Heuristics | Upkeep estimate and parking from advert text: wanted, labelled as estimates |
| Surfaces | Radar on the listing detail page, a score chip on listing cards, MCP |

Out of scope: sorting and filtering by score, score in notifications.

## 1 Metrics

Every metric turns a raw value into 0–100 with the job's targets:

```
score = clamp(0, 100, 100 × (worst − value) / (worst − ideal))
```

This covers both directions: ideal < worst means lower is better, ideal > worst means higher is
better. Past the ideal scores 100; past the worst scores 0. Boolean metrics use ideal 1 and worst 0.

Columns: **Src** is where the value comes from. **Status**: ✅ data exists, 🔶 exists but partial,
🆕 new source (needs a spike), 🧮 heuristic. **Buy** means buy-only (skipped for rentals).

### 1.1 Money

| Metric | Raw value | Dir. | Src | Status | Default targets |
|---|---|---|---|---|---|
| `value` | Price per m² | lower | `price / size` | ✅ | 25th / 90th percentile of the job's active listings |
| `affordable` | Monthly cost ÷ the finance profile's ceiling | lower | finance verdict (`affordability.js`); Danish model from `dk-buying` | ✅ | 0.75 / 1.0 |
| `budget` | Price ÷ the job's max price (`spec_filter`) | lower | listing, job | ✅ | 0.8 / 1.0 |
| `trend` | Area price per m², change over 3 years | higher | 🆕 see §2.1 | 🆕 Buy | +15 % / −5 % |

### 1.2 Schools

| Metric | Raw value | Dir. | Src | Status | Default targets |
|---|---|---|---|---|---|
| `nearby` | Average grade of the schools within 2 km (or the 3 nearest) | higher | Danish school layer (`getSchoolLayer`) | ✅ DK | 7 / 4 |
| `special` | Distance to the nearest school with a special-class offer | lower | school layer (special-class share > 0) | ✅ DK | 2 km / 10 km |
| `area` | Kommune's average grade minus the national average | higher | school layer, aggregated | ✅ DK | +0.5 / −0.5 |

Outside Denmark, and without `UDDANNELSESSTATISTIK_API_KEY`, every school metric is missing (50).

### 1.3 Work

| Metric | Raw value | Dir. | Src | Status | Default targets |
|---|---|---|---|---|---|
| `commute` | Minutes to the company address | lower | `listing_travel_times` (exact over estimated) | ✅ | 20 / 60 |
| `jobs` | Open job posts in the listing's kommune | higher | jobs layer (`getJobsLayer`) | 🔶 currently failing, #11; one occupation only | 20 / 0 |
| `options` | Distinct transit lines with a stop within 500 m walk | higher | 🆕 Overpass stops + Transitous, see §2.5 | 🆕 | 6 / 0 |

### 1.4 Home (the dwelling)

| Metric | Raw value | Dir. | Src | Status | Default targets |
|---|---|---|---|---|---|
| `size` | m² | higher | listing | ✅ | job min size +40 % / job min size |
| `bathrooms` | Count | higher | `sale_terms.bathrooms` | 🔶 mostly buy | 2 / 1 |
| `internet` | Best fixed download, Mbit/s | higher | connectivity (`tjekditnet` in DK) | ✅ | 1000 / 50 |
| `newBuild` | Years since built or last renovated | lower | `sale_terms.yearBuilt` / `yearRenovated` | 🔶 Buy | 5 / 60 |
| `upkeep` | Estimated upkeep, kr/m²/year | lower | 🧮 see §2.6 | 🧮 Buy | 100 / 400 |
| `parking` | Parking mentioned in the advert (0/1) | higher | 🧮 see §2.7 | 🧮 | 1 / 0 |

### 1.5 Area (where it is)

| Metric | Raw value | Dir. | Src | Status | Default targets |
|---|---|---|---|---|---|
| `grocery` | Minutes on foot to the nearest supermarket | lower | travel-time place type `supermarket`; DK supermarket layer as fallback | ✅ | 5 / 20 |
| `park` | Minutes on foot to the nearest park | lower | travel-time place type `park` | ✅ | 5 / 20 |
| `green` | Share of green area within 500 m | higher | 🆕 Overpass, see §2.4 | 🆕 | 30 % / 5 % |
| `quiet` | Distance to the nearest motorway, trunk road or railway | higher | 🆕 Overpass, see §2.4 | 🆕 | 500 m / 50 m |
| `social` | Kommune disposable income vs. national median | higher | 🆕 see §2.2 | 🆕 DK | +10 % / −10 % |
| `safety` | Reported crimes per 1,000 inhabitants in the kommune | lower | 🆕 see §2.3 | 🆕 DK | national −25 % / national +25 % |

The user's "neighbourhood" became `green`, `quiet`, `social` and `safety`.

### 1.6 Deal (purchases only)

How good and how safe the purchase is as a transaction. Every metric reads `sale_terms` (from
`dk-buying`), so for now the group is Boligsiden-only. Other providers score it missing, i.e. 50.

| Metric | Raw value | Dir. | Src | Status | Default targets |
|---|---|---|---|---|---|
| `vsValuation` | Asking price ÷ public valuation | lower | `sale_terms.publicValuation` | ✅ | 1.0 / 1.6 |
| `vsLastSale` | Asking price ÷ last free-market sale, inflated by the area trend (§2.1) since that date; plain ratio until the trend source exists | lower | `sale_terms.sales` (`type: normal` only) | ✅ | 1.0 / 1.4 |
| `priceDrop` | Price change since first listed, % | lower | `sale_terms.priceChangePct` | ✅ | −10 % / +0 % |
| `onMarket` | Total days on market | higher | `sale_terms.daysOnMarket.total` | ✅ | 120 / 7 |
| `relisted` | Relisted (total minus current days ≥ 60) | higher | `sale_terms.daysOnMarket` | ✅ | 1 / 0 |

`onMarket`, `priceDrop` and `relisted` reward negotiating room: a home that has sat for months, or
has been relisted or reduced, is one where the buyer has leverage. That is a buyer's view, and the
tooltip says so. The scam flag stays out: `doc/scam-detection.md` is built for rental fraud, and it
remains the separate warning badge it already is.

### 1.7 Notes

- **Money metrics must not double-count the price.** `value` is market-relative per m², `budget` is
  against the job's own price cap, `affordable` is the monthly burden against income. Each answers a
  different question. If that still feels heavy, the user can lower the weights.
- **`commute`** names one travel-time address label in the job's score config. If the job's
  `commute_filter.limits` (migration 35) has exactly one label, that is the default.
- **`affordable` for a rental** with `chargesIncluded: false` adds the Nebenkosten surcharge exactly
  as the finance verdict does. Reuse `affordability.js`; never recompute.
- **Kommune-level metrics** (`schools.area`, `work.jobs`, `area.social`, `area.safety`) give every listing in a kommune the
  same value. Their tooltip must say "kommune average", so nobody reads it as street-level data.

## 2 New sources and heuristics

Each 🆕 source starts with a spike step: is the endpoint reachable from the host, what are its
licence and rate limits, and what is the exact table or query. The result is written into this
section before any client code. The dev sandbox reaches neither api.statbank.dk nor boliga.dk
(proxy 403), so spikes that need a live call run on the host, or are verified from documentation
and marked as such.

All new clients follow `lib/services/regionalData/`: a disk cache with a versioned key, fail-soft
(`null` is never cached as data), attribution string.

### 2.1 Valuation trend (Money, buy)

Candidates, in order:
1. **Finans Danmark, Boligmarkedsstatistikken**: free, quarterly price per m² per kommune and
   postcode, for houses and flats. Has a statistics bank; API to be confirmed in the spike.
2. **Danmarks Statistik, EJS10/EJS20** (quarterly and annual sales per kommune, with price per m²)
   and **EJS50** (price index, 2006 = 100). Kommune and postcode tables sit in DST's paid
   "Betalingsdatabank", not the free Statistikbanken. A free kommune-level series is to be confirmed.

Pick the source that is free at kommune level for both houses and flats. The metric is the 3-year
change in price per m² for the listing's property type in its kommune (postcode if available).

### 2.2 Income / social (Area, DK)

Danmarks Statistik, the income tables per kommune (the INDKP family; exact table id to be
confirmed in the spike). Metric: median disposable income per kommune against the national median.
Free Statistikbanken, `api.statbank.dk`.

### 2.3 Safety (Area, DK)

Danmarks Statistik **STRAF22** (reported crimes by area and type of offence; kommune level,
updated 2026-02-19) divided by kommune population. Use property crime and violence. Exclude
traffic offences, which mostly measure enforcement. Annual; cache for a year.

### 2.4 Green and quiet (Area)

`lib/services/poi/overpassClient.js` already talks to Overpass. Two queries per listing, cached
per rounded coordinate (≈100 m grid) so neighbours share them:
- **green**: area of `leisure=park|garden|nature_reserve`, `landuse=forest|grass|meadow|recreation_ground`
  and `natural=wood` intersecting a 500 m circle, divided by the circle's area. Use the geometry
  helpers already in the tree, `@turf/*`.
- **quiet**: distance to the nearest `highway=motorway|trunk|primary` or `railway=rail`.

Overpass is a shared volunteer service: batch, throttle, and run it in a background sweeper like
connectivity and travel times. Never at read time.

### 2.5 Commute options (Work)

Count distinct transit routes with a stop within 500 m: Overpass `public_transport=platform` /
`highway=bus_stop` plus `route` relations, or Transitous (`transitousClient.js`) stop departures.
The spike picks one. Computed in the same sweeper as §2.4.

### 2.6 Upkeep estimate (Home, buy) 🧮

A transparent heuristic, documented in its module and shown as "estimate":

```
base kr/m²/yr by age band (years since built or renovated):  <10: 80 · 10–30: 150 · 30–60: 250 · >60: 350
+ 100 if the roof is fibre cement (often asbestos, from BBR `roofingMaterial`)
+  50 if the energy label is E, F or G
−  30 if heating is district heating (fjernvarme)
```

Every number is an editable default. Inputs come from `sale_terms` (BBR via Boligsiden). If an
input is missing, that term drops out. With no age at all, the metric is missing.

### 2.7 Parking from advert text (Home) 🧮

Case-insensitive word match over title and description:
- **Danish:** `carport`, `garage`, `p-plads`, `parkeringsplads`, `egen parkering`
- **German:** `Stellplatz`, `Garage`, `Tiefgarage`, `Carport`
- **English:** `parking`

Negations (`ingen parkering`, `kein Stellplatz`) score 0. No match is *missing* (50), not 0:
an advert's silence says nothing. Pure function, tested with real advert snippets.

## 3 Storage

**Config**: a nullable JSON column `score_config` on `jobs`, in the style of `commute_filter`:

```json
{
  "groups":  { "money": 1, "schools": 1, "work": 1, "home": 1, "area": 1, "deal": 1 },
  "metrics": { "home.parking": 0, "work.jobs": 0.5 },
  "targets": { "work.commute": { "ideal": 20, "worst": 60 } },
  "commute": { "label": "Work" }
}
```

Everything is optional, and NULL means all defaults. A weight of 0 switches a metric or a group
off. Migration number: next free at the time (`dk-buying` takes 51); re-check before merging.

**Sweeper results** (green, quiet, transit options) are per-listing facts, not score: a
`listing_area_facts` table keyed by listing, with its own `*_at` clock (migration 31's rule: one
clock per probe).

**Kommune-level data** (trend, income, safety) lives in disk caches like the tax and school layers.

**The score is computed on read, never stored.** Targets, weights, the job's percentiles and the
finance profile all move.

## 4 Service

`lib/services/score/`:
- `metrics/`: one module per group, each exporting metric descriptors
  `{ id, group, labelKey, unit, direction, buyOnly, raw(listing, ctx), defaults(ctx) }`.
- `score.js`: pure. `scoreListing(listing, config, ctx)` returns
  `{ total, groups: [{ id, score, weight, metrics: [{ id, raw, score, missing, weight }] }] }`.
  A group with every metric missing scores 50 and is marked `missing`.
- `context.js`: the only part that touches the database or caches. Builds `ctx` for a batch of
  listings with one query per kind.
- `upkeep.js`, `parkingText.js`: the heuristics, pure.

Hook `score` onto the listing read paths that the overview, the detail page and MCP use.

## 5 UI

- **Radar** (`ListingScoreCard.jsx`): chart.js `radar` through `react-chartjs-2` (both already
  dependencies). Six spokes for a purchase, five for a rental; fixed order Money, Schools, Work,
  Home, Area, Deal, so the same corner always means the same thing. A group switched off by a zero
  weight keeps its spoke, drawn as "off", so the shape never changes within a deal type. Missing groups get a dashed point. The total sits beside it. Below,
  a breakdown with one row per group, expandable to its metrics: raw value with unit, score, and the
  target band ("32 min · ideal 20 · worst 60"). Estimates and kommune averages are labelled.
- Colours come from `chartTheme.js` getters, since canvas can't read CSS custom properties; the theme
  key on `<Layout>` repaints it (AGENTS.md).
- **Chip** on listing cards: the total, banded ≥ 70 / 40–69 / < 40 with existing tokens; hover
  shows the group scores.
- **Job form "Score" card**: group weight sliders. "Advanced" opens per-metric weights and
  ideal/worst inputs, with defaults as placeholders. A commute address picker.
- i18n in all locales.

## 6 MCP

`get_listing`: total, a group table (six rows for a purchase, five for a rental), then each group's metrics. `list_listings`: the total
per row.

## 7 Steps

One step = one commit = one ledger tick, with tests and JSDoc. `yarn lint`, `yarn format:check`,
`yarn test:offline` after each.

**Phase A: engine on existing data**
1. Ledger created.
2. `score.js`: the target formula, groups, weights, missing handling, rent re-weighting. Exhaustive tests.
3. Money metrics: `value`, `affordable`, `budget`.
4. Schools metrics: `nearby`, `special`, `area`.
5. Work metrics: `commute`, `jobs`.
6. Home metrics: `size`, `bathrooms`, `internet`, `newBuild`; heuristics `upkeep.js`,
   `parkingText.js` and their metrics.
7. Area metrics on existing data (`grocery`, `park`) and Deal metrics (`vsValuation`,
   `vsLastSale`, `priceDrop`, `onMarket`, `relisted`).
8. Migration `score_config`; job storage; API validation.
9. `context.js`; `score` on listings from the API.

**Phase B: UI and MCP**
10. `ListingScoreCard`: radar and breakdown.
11. Score chip on listing cards.
12. Job form "Score" card.
13. MCP.

**Phase C: new sources** (each: spike, write-up here, then client and metric)
14. Spike and client: valuation trend (§2.1).
15. Spike and client: income (§2.2) and safety (§2.3), both DST.
16. `listing_area_facts`, and the Overpass sweeper for green and quiet (§2.4).
17. Commute options (§2.5), in the same sweeper.

**Close**
18. `doc/listing-score.md`, then acceptance: both themes, phone width, a Danish buy job, a Danish
    rent job, a German job.

## 8 Risks

- **Too many metrics.** 27 metrics in six groups. Equal weights within a group dilute the ones the
  user cares about. Ship sensible metric defaults, e.g. `parking` and `jobs` at 0.5.
- **Kommune granularity.** Four metrics are kommune-wide. Label them, and keep their default weights
  modest.
- **Volunteer services.** Overpass and Transitous are shared; sweep in the background, cache by grid
  cell, throttle.
- **Heuristics read as facts.** Upkeep and parking are always labelled "estimate". Every heuristic
  constant is editable.
- **Read cost.** Scoring an overview page needs travel times, schools, connectivity, area facts and
  the finance profile for every row. Batch per page; measure before caching.
- **Two open plans add migrations.** Renumber on merge.

## Sources

- [DST: ejendomssalg (property sales statistics)](https://www.dst.dk/ejendomssalg)
- [DST: ejendomssalg product page (Betalingsdatabank)](https://www.dst.dk/da/TilSalg/produkter/erhvervsliv-og-handel/ejendomssalg)
- [DST: anmeldte forbrydelser (reported crime)](https://www.dst.dk/da/Statistik/emner/sociale-forhold/kriminalitet/anmeldte-forbrydelser)
- [DST: reported crime, availability](https://www.dst.dk/da/Statistik/dokumentation/statistikdokumentation/anmeldte-forbrydelser/tilgaengelighed)
