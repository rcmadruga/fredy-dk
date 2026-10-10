# Ledger: Buying in Denmark

Status per step. Updated after every step, before anything else. The plan is `dk-buying.md`;
§0 is the scope, §8 the steps.

## Phase 1: data

- [x] 1 Ledger created
- [x] 2 Migration 51 `listing-sale-terms`, `saleTerms.js`, storage
- [x] 3 Boligsiden fills `saleTerms`

## Phase 2: the card

- [x] 4 `ListingSaleCard`: price and monthly costs, time on market, building, links
- [x] 5 Earlier-sales table

## Phase 3: financing

- [x] 6 `finance/dk/constants.js`, open figures re-verified
- [x] 7 `finance/dk/financing.js`
- [x] 8 Wired into calculate, financing tab, card, MCP, `doc/financing.md`

## Phase 4: Boliga and the rest

- [x] 9 Boliga research spike, go/no-go: no-go from the sandbox, needs on-host verification (plan section 3)
- [~] 10 Boliga provider: DEFERRED. Step 9 ended without access to boliga.dk (proxy 403), so there is no verified endpoint, fixture or terms reading to build on
- [x] 11 Filters and notification line
- [x] 12 Acceptance

## Open figures

Both resolved in step 6 (2026-10-10); each source sits beside its constant in
`lib/services/finance/dk/constants.js`.

- Skøde tinglysning 1,850 kr + 0.6 %, variable part rounded up to 100 kr: nemadvokat.dk and tax.dk
  (two sources). Resolved.
- Ejendomsværdiskat progression limit 2026: 9,007,000 kr of tax base (2025 was 9,200,000):
  vurderingsportalen.dk and lovguiden.dk. Resolved; the 9.2 M figure in the plan was the 2025 limit.

## Notes
- Step 2: `SaleTerms` carries six fields beyond the §4 typedef, because §6 needs them and the card
  must not re-read the raw case: `previousRealtors` (the "relisted" badge names them), `basementArea`,
  `bathrooms`, `floorPlanUrl` and `nextOpenHouse` (the links in §6.5), and `propertyType` was kept as
  listed. Fields are always present and null when unstated; the whole object is absent (column NULL)
  when the advert states none of it. A sale without a stated type is stored as `other`, never `normal`.
- Step 1 was already satisfied by the plan commit that created this file; ticked here.
- Step 3: `previousRealtors` is the case's `timeOnMarket.total.realtors` minus the realtor holding the
  case now (`realtor.name`). The year built, heating and renovation come from the largest building on
  the address (a garage's year is not the home's). `daysOnMarket.current` falls back to the case-level
  `daysOnMarket` only when `timeOnMarket` is missing. `municipalTaxPct` is `councilTaxPercentage`
  (kommuneskat); the church tax is not stored.
- Step 4: the card is built from `buildSaleFacts` in `ui/src/views/listings/listingFacts.js` (pure,
  tested without a DOM, like `buildRentalFacts`). The asking price is the first cost row only when
  at least one other cost figure exists. A price change of exactly 0 is not shown. An open house in the
  past is dropped; its time is shown in Danish time. "Your" financing figure beside the realtor's
  example (§6.1) waits for step 8. The building section is a `<details>`, closed by default.
- Step 5: the table sits right after the cost rows (§6 order). Change to today is
  (asking price - paid) / paid, from `sale_terms.sales[].amount` and the listing's price; it is `null`
  for every sale with `type !== 'normal'`, which is greyed and named in words (family, auction, other)
  with a note under the table, because a gift or an auction is not a market price. Per m² at the time
  uses the sale's own area and is blank where the register has none. The public valuation is shown
  under the table (or alone, for a home never sold), with a help text saying it is not a market price.
  The table scrolls inside its box on a narrow rail instead of widening the page.
- Step 6: the figures were supplied as verified by the task, not re-fetched (this sandbox cannot
  reach those sites); the comments record source and date. The rest of plan section 5 ships as
  editable defaults labelled "Default" in the file. The loan rates (4.0 % realkredit, 6.0 % bank) and
  the bidrag bands (0.5 / 0.7 / 1.0 %) are rounded placeholders of mine, not quotes from any lender.
- Step 7: `finance/dk/financing.js` simplifies in four stated ways (header of the file): monthly
  annuities for both loans; the bidrag is folded into the rate (a margin on the remaining debt) and
  counted as deductible interest together with the rente; the rentefradrag is computed on year-1
  interest and applied to every month's net figure; kurs only enlarges the nominal debt (it is not a
  market feed). The 35 % rule is held against the NET total monthly cost (loans after rentefradrag
  plus ejerudgift), and the highest price (`maxDanishPrice`) is found by bisection because the tiered
  deduction and the bidrag bands have no closed form. Grundskyld is `null` unless a land value is
  supplied (Boligsiden gives only the promille). The user's own choices live in `financing.dk` of the
  profile (step 8). `municipalTaxPct` is not used: the deduction rates stay the editable 33/25 %
  defaults.
- Step 8: `computeFinanceResult(profile, {currency, saleTerms})` returns the Danish result (`model: 'dk'`,
  figures under `.dk`) for `DKK`; the German result gains no new key. The Danish result is built in
  `finance/dk/result.js`. The editable defaults are stored under `financing.dk` (only what the user
  changed, like `grunderwerbsteuerPct`), with `financing.market` (`'de'|'dk'`) remembering which tab
  variant to show; cash on hand reuses `financing.equity`. Listing facts (public valuation, ejerudgift,
  grundskyld promille) come from the listing's `sale_terms` and win over anything typed on the page.
  The listing route resolves the currency with `getCurrencyForProvider`; the card and sale card share one
  request (`useListingFinance`, new hook), so `ListingFinanceCard` now takes `finance` as a prop.
  `/finance?market=dk` opens the page on Denmark. MCP `calculate_financing` also takes `bankRate`,
  `downPaymentPct` and `ownerCostMonthly` (and `annualRate` is the realkredit rate for a Danish
  answer); a bare `purchasePrice` is answered the Danish way only when the saved buying tab is on
  Denmark. No charts in the Danish variant (the German charts are Zinsbindung/Restschuld shaped).
  Known limit, left alone on purpose: the affordability filter, the verdict chips on the overview and
  `/api/finance/affordability` still score every buy listing with the German model and thresholds, also
  DKK ones. The Danish verdict appears on the detail page, the calculator and over MCP only.
  `get_listing` over MCP does not yet print `sale_terms` (plan section 7); that is done with step 11.
- Step 11: four filters, URL keys `ejmax`, `energy`, `relisted`, `reduced` (API `saleOwnerCostMax`,
  `saleEnergyMin`, `saleRelistedOnly`, `salePriceReducedOnly`), in `FILTER_URL_STATE` so the overview and
  the map both get them, read with `json_extract(l.sale_terms, ...)` in `buildListingWhere`. Unlike the
  move-in window, a listing that does not state the figure does NOT pass (a ceiling on the ejerudgift
  cannot be met by a silent advert), so the help text says homes without it are left out. The energy
  label compares the first letter of the stored label (`A2020` is an A) between `A` and the chosen
  letter. Relisted means total minus current days on market >= 60, the same figure as the sale card;
  `RELISTED_GAP_DAYS` therefore exists in `lib/services/sale/saleTerms.js` and in the UI's
  `listingFacts.js`, and `test/ui/saleFilters.test.js` fails if they differ. The notification line is
  `saleCosts` on the formatted listing (`Ejerudgift 3.900 kr./month | 26.322 kr./m²`, DKK sales only,
  null otherwise), added next to `commute` in every adapter that renders a commute line, plus both
  email templates. NOT done: Mattermost, whose table has fixed columns; it simply does not show the line.
  `get_listing` over MCP now prints the sale terms (plan section 7).
- Step 12: ran the production build and backend locally (db in the worktree's gitignored `db/`, seeded
  with five Boligsiden fixture cases normalised by the real provider code as a `buy` job, admin
  profile saved with the buying tab on Denmark). Headless Chromium (puppeteer-core, the preinstalled
  build) took the listing detail, the financing page (Denmark tab) and the overview, dark and light, at
  1400 px and 390 px: 12 PNGs in
  `/tmp/claude-0/-home-user-fredy-dk/3d8ccd5d-8216-5cab-8781-4b32ff31d25f/scratchpad/dk-buying-shots/`.
  `document.documentElement.scrollWidth` equalled the viewport width in all 12: no horizontal scroll at
  390 px. Not done: no live Boligsiden run (no network), so "a real Danish buy job end to end" is the
  seeded one. Found and fixed while looking: the German verdict ("Out of reach", from euro thresholds)
  showed on a DKK listing's price tile and overview rows; it is now hidden for DKK listings (the Danish
  card carries the verdict). Seen and left: the shared household block still labels incomes with a euro
  sign, and the page footer disclaimer still says "German purchase costs" in Denmark mode; the sale
  card's earlier-sales table scrolls sideways inside its own box at narrow widths (step 5 design).
- Step 9: written up in plan section 3 ("Step 9 outcome"). No request to boliga.dk was made. `[~]` in
  the ledger means deferred, not done: step 10 stays open until someone with access to the site has
  worked through the four hand-over points listed there.
- Review fix 1 (affordability by currency): the verdict chip on the overview rows and the listing page, the
  affordability filter and `POST /api/finance/affordability` now pick the model by the provider's currency, as
  `computeFinanceResult` does. A DKK purchase is judged by `finance/dk/listingVerdict.js` (the Danish result with the
  listing's own `sale_terms`: ejerudgift, valuation, land tax); a rent and every euro listing keep the German path
  unchanged. The Danish verdict is not a function of price alone, so the filter cannot be a price window: with
  `affordabilityBandFor(band, profile, {dkkProviders})` the band gains a `dk` part, the German purchase windows stop
  applying to those providers, and `listingsStorage` scores the DKK purchase candidates with the same function the
  chip uses and ANDs on the ids that landed in the band. The chip is un-hidden; its tooltip for kroner quotes no euro
  ceiling (`listings.affordabilityTooltipDk.*`). Seen and left: a DKK rental is still held against the rent ceilings
  as numbers (there is no Danish rent model), and the sweep's `cheapestAffordable` mixes currencies if both markets
  are scanned together.
- Review fix 2 (price per m2 "N/A"): the "at a glance" tile read only the stored `price_per_sqm` column, which
  `storeListings` fills when it saves a row. A row that got in another way, like the seeded ones of the step 12
  screenshot run (a plain INSERT without the column), has it NULL, so the tile said N/A with price, size and
  `sale_terms.pricePerM2` all present; the portal's figure was only ever shown in the sale card's cost list. The tile
  now uses `sale_terms.pricePerM2`, else the stored column, else price / size (`pricePerSqmOf` in `listingFacts.js`,
  with the same 5 m2 floor as the server). The market comparison pill still reads the stored column.
