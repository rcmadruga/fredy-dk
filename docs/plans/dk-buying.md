# Buying in Denmark

Turn Fredy's buying side, which is German today, into something that works for a Danish purchase:
the sale data Boligsiden already sends, a listing overview in the spirit of Boliga's, and a
Danish financing model in place of the German one.

The progress ledger is `dk-buying.progress.md`. Update it after every step, before anything else.

---

## 0 Scope

Decided with the user (2026-10-10):

| Question | Answer |
|---|---|
| Property types | Houses (villa, rækkehus, dobbelthus) and ejerlejlighed. **Not** andelsbolig, **not** sommerhus |
| Boliga | Both: its overview page is the design reference, and later a provider for what Boligsiden lacks |
| Financing | The full Danish model, replacing the German one for DKK listings |
| What matters most on a listing | Earlier sales, and monthly costs |
| Rates | Editable defaults, like the German Grunderwerbsteuer table |

Out of scope: andelsbolig (different maths, different sources), sommerhus (75 % LTV, different
tax), rental (done in #5/#6/#7), any change to the German model's behaviour.

## 1 What is there today

- `lib/provider/boligsiden.js` is for-sale only and keeps ten fields (`id`, `title`, `link`, `price`,
  `size`, `rooms`, `address`, `description`, `image`). Everything else in the case is dropped.
- `lib/services/finance/` (≈1,760 LOC) is a German model: Annuitätendarlehen, Grunderwerbsteuer per
  Bundesland, Notar, Makler, Zinsbindung, Restschuld. Currency-blind.
- Jobs carry `dealType: 'rent' | 'buy'` (`lib/types/job.js`). The detail page shows a rent card or a
  financing card by deal type.
- #5 established the pattern this plan copies for sale data: a JSON column on `listings`
  (`rental_terms`, migration 50), a pure module that reads and normalises it
  (`lib/services/rental/rentalTerms.js`), and a detail card (`ListingRentalCard.jsx`).
- Providers declare `currency` (`DKK` for the Danish ones); `formatPrice(price, currency)` and the
  UI's `useCurrencyOf` already print kroner.

## 2 The data Boligsiden already sends

From `test/testFixtures/boligsiden_cases.json`. Field → what it is → where it goes.

**Monthly costs** (user priority)

| Field | Meaning |
|---|---|
| `monthlyExpense` | Ejerudgift: the owner's monthly running costs (taxes, insurance, ejerforening for a flat) |
| `realEstate.downPayment` | Udbetaling the realtor quotes (5 %) |
| `realEstate.grossMortgage` / `netMortgage` | Realtor's example monthly payment, before and after interest deduction |
| `perAreaPrice` | Kr/m² |
| `utilitiesConnectionFee.includedInPrice` | Whether tilslutningsafgifter are in the price |

**Earlier sales** (user priority)

| Field | Meaning |
|---|---|
| `address.registrations[]` | `{date, amount, type, area}` per past sale. `type: normal` is a free sale; others (family, auction) must be labelled, never compared as market prices |
| `address.latestValuation` | Latest public valuation (offentlig ejendomsvurdering) |
| `address.casePrice` | Current asking price, for the comparison |

**Market signal**

| Field | Meaning |
|---|---|
| `timeOnMarket.current.days` / `.total.days` | Days with this realtor vs. total. A large gap means the home was relisted (20 vs 406 in the fixture) |
| `timeOnMarket.total.realtors[]` | Which realtors had it before |
| `priceChangePercentage` | Change since first listed |

**Building and plot**

| Field | Meaning |
|---|---|
| `address.buildings[]` | BBR: year built/renovated, heating, roof, walls, bathrooms, toilets, basement |
| `energyLabel`, `lotArea`, `basementArea`, `weightedArea` | |
| `hasBalcony`, `hasElevator`, `hasTerrace`, `numberOfFloors` | |
| `address.municipality.landValueTaxLevelPerThousand` | Grundskyld promille, feeds §5 |
| `address.municipality.councilTaxPercentage`, `churchTaxPercentage` | Feeds the interest-deduction value in §5 |
| `floorPlanImages[]`, `nextOpenHouse` | |

Ignore: the `realtor.*` ratings block (large, not about the home).

## 3 What Boliga adds

Boliga's listing page shows, beyond the above: a price-history graph per listing, sold prices of
comparable homes nearby ("handelspriser"), and its own price estimate.

Unknowns, to settle in step 9 before any code:
- boliga.dk was not reachable from the development sandbox (proxy 403). Its endpoints are unverified.
- Third-party scrapers report that the site builds its search results into the page as JSON and has
  an open search endpoint behind its own front end, and that some paths sit behind bot protection.
  Treat every one of those claims as unverified.
- Terms of use: read them before step 9, as was done for Boligsiden's robots.txt (see its file header).

## 4 Storage

One JSON column, `sale_terms`, on `listings`, migration 51, mirroring `rental_terms`. Not separate
columns: the shape is provider-specific, read only by the detail card, the notification and MCP, and
filtered on by two fields at most (§7), which a JSON extract or two generated columns can serve.

`lib/services/sale/saleTerms.js`, pure, owns the shape:

```js
/**
 * @typedef {Object} SaleTerms
 * @property {number|null} ownerCostMonthly     ejerudgift
 * @property {number|null} downPayment          realtor's udbetaling
 * @property {number|null} grossPaymentMonthly  realtor's example, before deduction
 * @property {number|null} netPaymentMonthly    realtor's example, after deduction
 * @property {number|null} pricePerM2
 * @property {number|null} publicValuation
 * @property {{date: string, amount: number, type: string, area: number|null}[]} sales
 * @property {{current: number|null, total: number|null}} daysOnMarket
 * @property {number|null} priceChangePct
 * @property {string|null} energyLabel
 * @property {number|null} lotArea
 * @property {number|null} yearBuilt
 * @property {number|null} yearRenovated
 * @property {string|null} heating
 * @property {number|null} landTaxPerMille      kommune grundskyld promille
 * @property {number|null} municipalTaxPct      kommuneskat, for the deduction value
 * @property {string|null} propertyType         villa | terraced house | condo | ...
 */
```

Every field nullable. A missing field means "the advert did not say", never zero. Store numbers as
numbers; `buildHash` still gets `String(price)` only.

## 5 The Danish financing model

Replaces the German model for a listing whose provider declares `DKK`, selected in
`lib/services/finance/calculate.js` by currency. The German code is untouched.

New module `lib/services/finance/dk/` with its own `constants.js` (editable defaults) and
`financing.js`.

**Funding stack**, for an owner-occupied home (helårsbolig):

| Layer | Default | Notes |
|---|---|---|
| Udbetaling | 5 % of price | Legal minimum, cash |
| Realkreditlån | up to 80 % of price | Fixed or variable; term 30 years; optional up to 10 years interest-only |
| Banklån (boliglån) | the rest, typically 15 % | Higher rate, shorter term (often 20–30 years) |

Inputs per loan: rate, term, interest-only years, and for realkredit the **bidragssats** (the
lender's ongoing margin). Bidrag is a percentage of the remaining debt and scales with LTV; ship one
editable default per LTV band (0–40 %, 40–60 %, 60–80 %) rather than a lender's table.

Kurs (bond price) is real for fixed-rate realkredit: a loan raised at kurs 97 needs a larger
nominal debt to pay out the same amount. Model it as an optional "kurs" input, defaulting to 100,
not as a market feed.

**One-off costs** (instead of Kaufnebenkosten):

| Item | Default | Source |
|---|---|---|
| Tinglysning skøde (deed) | 1,850 kr + 0.6 % of price | tax.dk, 2026. Second source still owed |
| Tinglysning pant (mortgage deed), realkredit and bank | 1,825 kr + 1.25 % of the loan, each | skat.dk, rate cut from 1.45 % on 1 Jan 2026 |
| Lånesagsgebyr, kurtage | editable, default 0 | Lender-specific |
| Buyer's advisor (køberrådgiver) | editable, default 0 | Optional in Denmark |
| Ejerskifteforsikring (half the premium) | editable, default 0 | Seller usually offers half |

**Running costs** (monthly, alongside loan payments):

- **Ejerudgift** from `sale_terms.ownerCostMonthly` when the advert gives it. It already contains the
  property taxes, so do not add them again.
- When it is missing, estimate the two property taxes:
  - **Ejendomsværdiskat**: 0.51 % of (public valuation × 0.8) up to the progression limit, 1.4 %
    above. The 2026 limit is unresolved: 9.2 M kr (Ældresagen) vs 9,007,000 kr after the 20 %
    reduction (Nordea). Verify against Skatteforvaltningen before shipping.
  - **Grundskyld**: the kommune's promille × (land value × 0.8). Boligsiden gives the promille, not
    the land value, so this needs the valuation's land part. Show "unknown" rather than guess.
  - Note the *skatterabat* transition rules for homes bought before 2024 do not apply to a new
    purchase, which keeps this simpler.
- **Interest deduction (rentefradrag)**: net payment = gross − interest × deduction rate. Default
  ≈ 33 % up to 50,000 kr interest per person per year, ≈ 25 % above (the exact value tracks
  kommuneskat; `municipalTaxPct` is available). Editable.

**Outputs**, matching what the German tab reports where it makes sense:
total cash needed (udbetaling + one-off costs), monthly gross and net payment per loan, ejerudgift,
total monthly cost, debt left after interest-only and at chosen years, highest price inside the
35 % rule, debt-free age.

The 35 % rule and the household block are shared with the German model unchanged.

## 6 Listing detail: the sale card

`ui/src/views/listings/components/ListingSaleCard.jsx`, shown for a `buy` job whose listing has
`sale_terms`. Boliga's overview is the reference for order and density. The user's priorities come first:

1. **Price and monthly costs**: asking price, kr/m², ejerudgift, the realtor's udbetaling and gross/net
   payment, then *your* figure from §5 next to it once the financing tab is filled in.
2. **Earlier sales**: a small table, newest first: date, amount, kr/m² at the time, change to today's
   price. Non-free sales (`type ≠ normal`) labelled and greyed. Public valuation underneath.
3. **Time on market**: current and total days; a "relisted" badge when total exceeds current by a
   threshold (default 60 days), naming the previous realtors.
4. **Building**: year built/renovated, energy label, heating, plot, basement, bathrooms. Collapsed by
   default.
5. Floor plan and next open house as links.

Theme rules from AGENTS.md apply: tokens only, no colour literals outside `themes.less`, both themes.

## 7 Filters, notifications, MCP

- Filters on the overview and the map (shared since #6): ejerudgift max, energy label min,
  "relisted only", "price reduced only".
- Notification: one extra line for DKK sale listings: ejerudgift and kr/m².
- MCP: `get_listing` includes `sale_terms`; `calculate_financing` answers with the Danish model for DKK.

## 8 Steps

Each step is one commit and one tick in the ledger. Tests with every step (AGENTS.md: new features
must be tested and JSDoc'd). Run `yarn lint`, `yarn format:check`, `yarn test:offline` after each.

**Phase 1: data**
1. Ledger created.
2. Migration 51 `listing-sale-terms` and `saleTerms.js` with its JSDoc typedef; storage read/write
   (copy `rental_terms` handling in `listingsStorage.js`). Tests: round-trip, nulls, malformed JSON.
3. Boligsiden `normalize` fills `saleTerms`. Tests against `boligsiden_cases.json`, plus a case with
   every optional field missing.

**Phase 2: the card**
4. `ListingSaleCard` with sections 1, 3, 4, 5 of §6. i18n in all locales.
5. Earlier-sales table (§6.2), including labelling non-free sales. Test the change-to-today maths.

**Phase 3: financing**
6. `finance/dk/constants.js`: every default from §5 with its source and date in a comment. Re-verify
   the open figures (skøde 0.6 %, progression limit) before committing.
7. `finance/dk/financing.js`: funding stack, bidrag, kurs, one-off costs, interest deduction,
   property-tax estimate. Pure functions, unit-tested against hand-worked examples.
8. Wire it: `calculate.js` picks the model by currency; financing tab gets a Danish variant; the card
   shows "your" figures; `calculate_financing` over MCP. `doc/financing.md` gets a Danish section.

**Phase 4: Boliga and the rest**
9. Boliga research spike: endpoints, protection, terms. Written up here before any provider code.
   Decide go/no-go.
10. If go: `lib/provider/boliga.js` for search, plus `fetchDetails` for price history and comparable
    sales; dedup with Boligsiden through the existing fingerprint tier.
11. Filters and notification line (§7).
12. Acceptance: both themes, phone width, a real Danish buy job end to end.

## 9 Risks

- **Rates drift.** Every rate is an editable default with its source and date beside it.
- **Boligsiden shape change.** All fields optional; the card hides empty sections.
- **Boliga access.** Unverified; step 9 may end in "no", and Phase 1–3 do not depend on it.
- **Ejerlejlighed costs.** Ejerudgift for a flat includes the ejerforening fee; when the advert omits
  it, the estimate in §5 undercounts. The card must say "estimate, excludes association fee".

## Sources

- [skat.dk: tinglysningsafgift, new rate from 1 January 2026](https://skat.dk/erhverv/afgifter-paa-varer-og-ydelser-punktafgifter/nyhedsbrev-afgifter/tinglysningsafgift-ny-afgiftssats-pr-1-januar-2026)
- [tax.dk: tinglysningsafgift](https://tax.dk/skat/tinglysningsafgift.htm)
- [Ældresagen: ejendomsværdiskat](https://www.aeldresagen.dk/viden-og-raadgivning/vaerd-at-vide/b/bolig/ejendomsskat/ejendomsvaerdiskat)
- [Nordea: progression limit lowered in 2026](https://www.nordea.com/da/nyhed/millionaerknaekket-saenkes-i-2026-flere-boligejere-skal-betale-den-hoeje-sats)
- [tax.dk: grundskyld rate cap](https://www.tax.dk/jv/ch/C_H_4_1_2_2.htm)
- [Apify: Boliga scraper listings (claims about Boliga's endpoints, unverified)](https://apify.com/studio-amba/boliga-scraper)
