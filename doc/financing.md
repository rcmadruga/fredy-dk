# 💶 Financing Calculator

The **Financing** page works out what a listing would cost you every month, and whether that fits
your household.

Every job declares whether it searches to **rent** or to **buy**, and the page has one tab for each.
Both share the same household block (income for one or two people, living costs, any loan you are
already paying off) and the same rule of thumb: housing costs plus existing debt at or below 35 % of
net income.

## Renting

Portals quote Kaltmiete, households pay warm. Set the Nebenkosten surcharge once, and Fredy reports
the highest cold rent you can take on, what that comes to warm, and what is left over each month.
The renting tab asks for nothing beyond that.

Some portals quote a rent with the running charges already in it instead: a French rent *charges
comprises*, an immowelt Warmmiete. Fredy records which kind each stored rent is, and the verdict
accounts for it. A rent quoted with the charges is measured against your warm-rent ceiling as it
stands, with no surcharge added on top, in the verdict chip, the affordability filter, the rent card
and the `calculate_financing` answer alike; the rent card shows the charges the advert states
instead of an estimate. Rents quoted without the charges, and those whose portal does not say, are
judged exactly as before.

## Buying

The buying tab models the purchase the way a European bank would, as an **Annuitätendarlehen**:

- the **monthly rate**, and how it splits into interest and repayment over the years
- the **Kaufnebenkosten**: Grunderwerbsteuer for your Bundesland, Notar + Grundbuch, and the
  Maklerprovision. On a 400.000 € house in NRW these add roughly 46.000 € that you have to finance
  or pay out of your own pocket
- the **Restschuld** left when the Zinsbindung runs out, which you have to refinance at whatever
  rates exist then
- the **age at which you and your partner become debt-free**
- the **highest purchase price** that keeps you inside the 35 % rule

Loan scenarios can be compared side by side, each with a Sollzins, a Tilgung, a Zinsbindung, a
monthly rate and an optional Sondertilgung. Tilgung and monthly rate describe the same thing from
opposite ends, so editing one rewrites the other and you can enter whichever figure you have. The
term is calculated at a constant Sollzins. Fredy does not guess what a follow-up loan will cost
after the Zinsbindung, it reports the Restschuld instead.

## Buying in Denmark

The buying tab has a **Germany / Denmark** switch. Denmark replaces the Annuitätendarlehen with the
way a Danish home is actually paid for, in kroner. A listing from a provider that prices in kroner
(Boligsiden, Danica Ejendomme) always gets the Danish model on its own detail page, whatever the
switch says; the switch decides what the calculator page shows and what `calculate_financing`
answers for a bare purchase price.

How the purchase is built up:

- **Udbetaling**: your cash payment, 5 % of the price by default (the legal minimum).
- **Realkreditlån**: a mortgage-credit loan for up to 80 % of the price, 30 years by default, with up
  to ten interest-only years. It pays a **bidrag**, the lender's ongoing margin on the remaining debt,
  which grows with the loan-to-value ratio (one editable value for up to 40 %, 60 % and 80 %). The
  **kurs** is the bond price: a fixed-rate loan raised at kurs 97 needs a larger nominal debt to pay
  out the same cash. It defaults to 100 (no discount) and is something you enter, not a market feed.
- **Banklån**: a bank loan for what is left, at a higher rate and a shorter term.
- **One-off costs** (cash on top of the udbetaling): tinglysning of the skøde, 1,850 kr plus 0.6 %
  of the price (or of the latest public valuation if that is higher), the variable part rounded up
  to 100 kr; tinglysning of each mortgage deed, 1,825 kr plus 1.25 % of the loan, once for the
  realkreditlån and once for the bank loan (2026 rates); and your own entries for lender fees, a
  køberrådgiver and your half of the ejerskifteforsikring, all zero until you fill them in.
- **Monthly**: both loans, then the **ejerudgift**. When the advert states one it already contains the
  property taxes and they are not added again. When it does not, Fredy estimates the
  **ejendomsværdiskat** (0.51 % of 80 % of the public valuation, 1.4 % of the part above the progression
  limit, 9,007,000 kr for 2026). **Grundskyld** needs the land value, which Boligsiden does not give,
  so it reads *unknown* until you enter it. A flat's estimate leaves out the ejerforening's fee, and the
  card says so.
- **Rentefradrag**: the monthly figure is quoted after the tax relief on interest and bidrag, about
  33 % on the first 50,000 kr of interest per person and year and about 25 % above (the limit doubles
  for a couple). Both rates are editable, and the relief is worked out on the first year's interest.

The 35 % rule and the household block are the same as for Germany. The monthly cost it is held
against is the loans after rentefradrag plus the ejerudgift (or the loans alone, which the card says,
when no ejerudgift is known). The tab also reports the cash you need, what is still owed after the
interest-only years and after ten years, the highest price inside the rule, and the age at which you
are debt-free.

On a Danish listing's detail page the sale card shows **your** monthly payment (before and after tax
relief) next to the realtor's own example, once you have saved the buying tab.

Everything except the 2026 tax rules is an editable default and not an offer: ask a lender for the
bidrag and the rate that apply to you. The tinglysning fees and the ejendomsværdiskat limit change
with the law, and their sources and dates are in `lib/services/finance/dk/constants.js`.

## Where the result shows up

Each tab saves and deletes on its own. Once one is saved, its verdict appears elsewhere:

- an **affordability filter** on the listings overview, next to the status and provider filters,
  plus a small verdict chip on each listing
- a **rent card or a financing card** on the listing detail page, whichever matches the job that
  found the listing

Which calculation a listing gets follows the deal type of its job, so a 1.200 € rent is never read
as a very cheap house. Nothing appears until the matching tab is filled in.

An LLM can ask the same question over MCP with the `calculate_financing` tool, which returns a
mortgage answer or a rent answer depending on the listing, and the Danish answer for a listing priced
in kroner.

> **This is an estimate, not financial advice.** The Grunderwerbsteuer rates ship as editable
> defaults and Bundesländer change them from time to time, so check the figure for your state and
> get a binding offer from your bank before committing to anything. The same goes for the Danish
> rates, bidrag and tax relief.
