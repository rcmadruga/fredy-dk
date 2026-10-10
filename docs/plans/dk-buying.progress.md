# Ledger: Buying in Denmark

Status per step. Updated after every step, before anything else. The plan is `dk-buying.md`;
§0 is the scope, §8 the steps.

## Phase 1: data

- [x] 1 Ledger created
- [x] 2 Migration 51 `listing-sale-terms`, `saleTerms.js`, storage
- [x] 3 Boligsiden fills `saleTerms`

## Phase 2: the card

- [ ] 4 `ListingSaleCard`: price and monthly costs, time on market, building, links
- [ ] 5 Earlier-sales table

## Phase 3: financing

- [ ] 6 `finance/dk/constants.js`, open figures re-verified
- [ ] 7 `finance/dk/financing.js`
- [ ] 8 Wired into calculate, financing tab, card, MCP, `doc/financing.md`

## Phase 4: Boliga and the rest

- [ ] 9 Boliga research spike, go/no-go
- [ ] 10 Boliga provider (only if 9 says go)
- [ ] 11 Filters and notification line
- [ ] 12 Acceptance

## Open figures

- Skøde tinglysning variable rate 0.6 %: one source (tax.dk). Needs a second.
- Ejendomsværdiskat progression limit 2026: 9.2 M kr vs 9,007,000 kr. Needs Skatteforvaltningen.

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
