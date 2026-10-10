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
- [ ] 7 `finance/dk/financing.js`
- [ ] 8 Wired into calculate, financing tab, card, MCP, `doc/financing.md`

## Phase 4: Boliga and the rest

- [ ] 9 Boliga research spike, go/no-go
- [ ] 10 Boliga provider (only if 9 says go)
- [ ] 11 Filters and notification line
- [ ] 12 Acceptance

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
