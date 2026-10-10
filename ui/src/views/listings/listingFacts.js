/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { formatPrice, DEFAULT_CURRENCY } from '../../services/price/priceService.js';
import { formatDecimal } from '../../services/number/numberService.js';
import { formatDeviation, formatPricePerSqm, readMarketBenchmark } from '../../services/listings/marketBenchmark.js';
import { rentIncludesCharges, verdictExplanation } from '../../services/finance/rentBasis.js';
import * as timeService from '../../services/time/timeService.js';

/**
 * The two readings of a listing, kept apart.
 *
 * The detail page used to run one `Descriptions` list over everything it knew, which gave the
 * living space and the name of the search job that found the flat the same row height, the same
 * icon and the same weight. They are not the same kind of fact: one is a property of the flat and
 * belongs next to the price, the other is a property of Fredy's own bookkeeping and belongs in a
 * footnote. Splitting them here rather than in the component is what makes both testable without a
 * DOM - these functions return descriptors, never elements.
 */

/**
 * A single label/value pair as a section renders it.
 *
 * `value` is `null` when the listing does not carry the field; the caller decides whether that
 * means "N/A" or "leave the row out", which differs per section.
 *
 * @typedef {Object} ListingFact
 * @property {string} id - Stable key, also the React key.
 * @property {string} label - Already translated.
 * @property {string|null} value - Already formatted, or null when unknown.
 * @property {string} [helpText] - The sentence behind the help icon.
 * @property {string} [href] - Makes the value a link.
 * @property {boolean} [chip] - Render the value as a chip rather than as text.
 */

/**
 * Everything the reader needs from the context to format a fact.
 *
 * `describeBenchmark` is injected rather than imported because the only implementation lives in a
 * component module that pulls in React and a stylesheet, and this file has to stay importable from
 * a plain Node test.
 *
 * @typedef {Object} FactContext
 * @property {(key: string, params?: Object) => string} t
 * @property {string} locale
 * @property {Object} [financeThresholds] - As `useFinanceProfile` returns them.
 * @property {(benchmark: Object, t: Function, locale: string) => string} [describeBenchmark]
 * @property {(value: number, locale: string) => string} [formatEuro] - For the affordability limit.
 * @property {string} [currency] - ISO 4217 code of the listing's provider, from `useCurrencyOf()`.
 *   Defaults to EUR when absent, which keeps every caller that has no listing-specific currency
 *   (tests, anything not yet wired to a provider) working exactly as before this field existed.
 */

/**
 * What the flat itself is: price, what a square metre costs, how big it is, how many rooms.
 *
 * The price is lifted out of the list instead of being its first row, because it is the one figure
 * every other one on the page is read against.
 *
 * @param {Object|null} listing - A row as the listings API returns it.
 * @param {FactContext} ctx
 * @returns {{price: {text: string, reference: string|null, helpText: string}, benchmark: Object|null, tiles: ListingFact[], affordability: {verdict: string, label: string, helpText: string}|null}}
 */
export function buildObjectFacts(listing, ctx) {
  const { t, locale } = ctx;
  const row = listing ?? {};
  const na = t('common.na');
  const benchmark = readMarketBenchmark(row);
  const isRental = row.dealType === 'rent';
  const currency = ctx.currency ?? DEFAULT_CURRENCY;
  const perSqm = pricePerSqmOf(row, benchmark);

  const price = {
    text: row.price != null ? formatPrice(row.price, locale, null, currency) : na,
    // Split so the page can set the digits large and leave the currency symbol at reading size.
    // A 40px euro sign is louder than the sum it belongs to, and every listing has the same one.
    ...splitPrice(row.price, locale, na, currency),
    // Names what the number is, which the number alone cannot: the same "1.200 EUR" is a monthly
    // rent on one listing and a purchase price on the next, and a rent is quoted with the charges
    // on some portals and without them on the rest.
    reference: row.price != null ? t(priceReferenceKey(row, isRental)) : null,
    helpText: t('listing.detail.fieldPriceHelp'),
  };

  const tiles = [
    {
      id: 'size',
      label: t('listing.detail.fieldSize'),
      value: row.size ? `${formatDecimal(row.size, locale)} m²` : null,
      helpText: t('listing.detail.fieldSizeHelp'),
    },
    {
      id: 'rooms',
      label: t('listing.detail.fieldRooms'),
      value: row.rooms ? formatDecimal(row.rooms, locale) : null,
      helpText: t('listing.detail.fieldRoomsHelp'),
    },
    {
      id: 'pricePerSqm',
      label: t('listing.detail.fieldPricePerSqm'),
      // Without the unit: the tile's own label already says "per m²", and repeating it there is
      // what pushed the figure past the width of a third of the rail.
      value: perSqm != null ? formatPricePerSqm(perSqm, locale, currency, false) : null,
      // Two different explanations. With a benchmark the interesting part is the comparison and
      // where it came from; without one it is why no comparison is shown, which is a question the
      // page would otherwise leave the reader to guess at.
      helpText:
        benchmark != null && benchmark.verdict != null && ctx.describeBenchmark != null
          ? ctx.describeBenchmark(benchmark, t, locale)
          : t('listing.detail.fieldPricePerSqmHelp'),
    },
  ];

  return { price, benchmark, tiles, affordability: buildAffordability(row, ctx) };
}

/**
 * Smallest living space, in m², a price is divided by. Portals write "1" into the size field for a plot
 * or a parking space, and a quotient of that is not a price per square metre. Frontend copy of
 * `MIN_SIZE_SQM` in lib/services/listings/marketBenchmark.js.
 */
const MIN_SIZE_SQM = 5;

/**
 * The price per square metre the "at a glance" box shows.
 *
 * Three sources, in order of how directly they state the figure: the sale terms, where the portal
 * quotes it itself (Boligsiden's `perAreaPrice`); the column the server derives and stores when it
 * saves a listing; and finally the price divided by the size. The last one matters because the stored
 * column is only written along with the row and is empty for any row that got in another way, which
 * used to leave the tile on "N/A" for a home whose price and size were both on the page. The market
 * comparison keeps reading the stored column: it needs the area's median beside it.
 *
 * @param {Object} row A listing as the API returns it.
 * @param {{pricePerSqm: number}|null} benchmark From `readMarketBenchmark`.
 * @returns {number|null}
 */
export function pricePerSqmOf(row, benchmark) {
  const stated = Number(row?.sale_terms?.pricePerM2);
  if (row?.sale_terms?.pricePerM2 != null && Number.isFinite(stated) && stated > 0) {
    return stated;
  }
  if (benchmark != null) {
    return benchmark.pricePerSqm;
  }
  const price = Number(row?.price);
  const size = Number(row?.size);
  if (row?.price == null || row?.size == null || !(price > 0) || !(size >= MIN_SIZE_SQM)) {
    return null;
  }
  return Math.round((price / size) * 100) / 100;
}

/**
 * What kind of figure the listed price is.
 *
 * @param {Object} row
 * @param {boolean} isRental
 * @returns {string} A translation key.
 */
function priceReferenceKey(row, isRental) {
  if (!isRental) return 'listing.detail.purchasePrice';
  return rentIncludesCharges(row) ? 'listing.detail.rentPerMonthInclCharges' : 'listing.detail.rentPerMonth';
}

/**
 * A price in two pieces: the digits, and the currency symbol beside them.
 *
 * Taken from `Intl.NumberFormat.formatToParts` rather than by slicing the formatted string,
 * because where the symbol goes and what separates it from the digits is the locale's business -
 * German puts it after with a space, English puts it in front with none.
 *
 * @param {number|null|undefined} value
 * @param {string} locale
 * @param {string} fallback - Shown when there is no price at all.
 * @param {string} [currency='EUR'] ISO 4217 code of the listing's provider.
 * @returns {{amount: string, currency: string|null}}
 */
function splitPrice(value, locale, fallback, currency = DEFAULT_CURRENCY) {
  if (value == null) return { amount: fallback, currency: null };

  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).formatToParts(value);

    return {
      amount: parts
        .filter((part) => part.type !== 'currency' && part.type !== 'literal')
        .map((part) => part.value)
        .join(''),
      currency: parts.find((part) => part.type === 'currency')?.value ?? null,
    };
  } catch {
    // An unknown locale is not worth an empty price; the joined form is still readable.
    return { amount: formatPrice(value, locale, null, currency), currency: null };
  }
}

/**
 * The verdict the server already decided, phrased for the chip next to the price.
 *
 * Returns null rather than an empty chip when the profile has no matching half, because a missing
 * verdict is the absence of an opinion and not a neutral one.
 *
 * The ceiling quoted is the one the server measured the verdict against, which for a rent quoted
 * with the charges in it is the warm one.
 *
 * @param {Object} row
 * @param {FactContext} ctx
 * @returns {{verdict: string, label: string, helpText: string}|null}
 */
function buildAffordability(row, ctx) {
  const verdict = row.affordabilityVerdict ?? null;
  if (!verdict) return null;

  const { t, locale } = ctx;
  const { key, limit } = verdictExplanation(
    verdict,
    { dealType: row.dealType, chargesIncluded: rentIncludesCharges(row), currency: ctx.currency },
    ctx.financeThresholds,
  );

  return {
    verdict,
    label: t(`finance.verdict.${verdict}`),
    helpText: t(key, { price: limit != null && ctx.formatEuro != null ? ctx.formatEuro(limit, locale) : '' }),
  };
}

/**
 * The figures on the rent card: what leaves the account each month, and how that rent comes about.
 *
 * A rent quoted cold reads as it always has - the listed cold rent, and Nebenkosten estimated on top
 * of it from the household's percentage. A rent quoted with the charges in it is the warm rent as
 * listed, and its Nebenkosten are whatever the advert states; where it states nothing the card says
 * so, rather than printing a cold rent it would have to invent.
 *
 * @param {import('../../types/finance.js').RentAffordability} scored As the listing finance route returns it.
 * @param {{headroom: number}} budget
 * @param {{t: (key: string, params?: Object) => string, locale: string, formatEuro: (value: number, locale: string) => string}} ctx
 * @returns {{facts: Array<{id: string, label: string, value: string, emphasis: boolean, note?: string}>, footnote: string}}
 */
export function buildRentFacts(scored, budget, ctx) {
  const { t, locale, formatEuro } = ctx;
  const included = scored.chargesIncluded === true;

  const facts = [
    {
      id: 'warm',
      label: t(included ? 'listing.detail.rentWarmListed' : 'listing.detail.rentWarm'),
      value: formatEuro(scored.warmRent, locale),
      emphasis: true,
    },
  ];
  if (!included || scored.coldRent != null) {
    facts.push({
      id: 'cold',
      label: t(included ? 'listing.detail.rentColdNet' : 'listing.detail.rentCold'),
      value: formatEuro(scored.coldRent, locale),
      emphasis: false,
    });
  }
  facts.push(
    {
      id: 'nebenkosten',
      label: t('listing.detail.rentNebenkosten'),
      value: formatEuro(scored.nebenkosten, locale),
      emphasis: false,
      note: t(
        !included
          ? 'listing.detail.rentNebenkostenNote'
          : scored.nebenkosten == null
            ? 'listing.detail.rentNebenkostenIncluded'
            : 'listing.detail.rentNebenkostenStated',
      ),
    },
    {
      id: 'share',
      label: t('listing.detail.rentShare'),
      value: `${((scored.rateShareOfNetIncome ?? 0) * 100).toFixed(1)} %`,
      emphasis: false,
    },
    {
      id: 'remaining',
      label: t('listing.detail.rentRemaining'),
      value: formatEuro(scored.remainingAfterRent, locale),
      emphasis: false,
    },
    {
      id: 'ceiling',
      label: t('listing.detail.rentCeiling'),
      value: formatEuro(budget.headroom, locale),
      emphasis: false,
    },
  );

  return {
    facts,
    footnote: included
      ? t('listing.detail.rentFootnoteInclCharges')
      : t('listing.detail.rentFootnote', { pct: String(Math.round(scored.nebenkostenPct ?? 0)) }),
  };
}

/**
 * Where this row came from: which portal, which of the user's searches found it, and when.
 *
 * None of it describes the flat, which is why it sits in its own quiet list instead of among the
 * figures. Fields no portal filled in are dropped rather than shown as another "N/A" - a column of
 * them reads as a fault in Fredy rather than as a silent portal.
 *
 * @param {Object|null} listing
 * @param {FactContext} ctx
 * @returns {ListingFact[]}
 */
export function buildOriginFacts(listing, ctx) {
  const { t, locale } = ctx;
  const row = listing ?? {};
  const facts = [];

  if (row.provider) {
    facts.push({
      id: 'provider',
      label: t('listing.detail.fieldPortal'),
      value: providerName(row.provider),
      href: row.link || undefined,
      helpText: t('listing.detail.fieldProviderHelp'),
    });
  }

  if (row.job_name) {
    facts.push({
      id: 'job',
      label: t('listing.detail.fieldJob'),
      value: row.job_name,
      chip: true,
      helpText: t('listing.detail.fieldJobHelp'),
    });
  }

  if (row.created_at) {
    facts.push({
      id: 'created',
      label: t('listing.detail.fieldAdded'),
      value: timeService.format(row.created_at, true, locale),
      helpText: t('listing.detail.fieldAddedHelp'),
    });
  }

  // The date the portal itself states, when it states one at all, which is what tells this row
  // apart from "Added" above it.
  if (row.published_at) {
    facts.push({
      id: 'published',
      label: t('listing.detail.fieldPublished'),
      value: timeService.format(row.published_at, true, locale),
      helpText: t('listing.detail.fieldPublishedHelp'),
    });
  }

  // Only the detail page states these, and only for a part of the listings. They live here rather
  // than among the three tiles because a tile row that is sometimes four wide and sometimes three
  // is worse than a list that is sometimes a line longer.
  if (row.build_year) {
    facts.push({
      id: 'buildYear',
      label: t('listing.detail.fieldBuildYear'),
      value: String(row.build_year),
      helpText: t('listing.detail.fieldBuildYearHelp'),
    });
  }

  if (row.energy_class) {
    facts.push({
      id: 'energyClass',
      label: t('listing.detail.fieldEnergyClass'),
      value: String(row.energy_class),
      helpText: t('listing.detail.fieldEnergyClassHelp'),
    });
  }

  return facts;
}

/**
 * The portal's name as a person writes it, from the lowercase id the scraper stores.
 *
 * @param {string} provider
 * @returns {string}
 */
export function providerName(provider) {
  if (!provider) return '';
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** Danish law (lejeloven, private rentals): deposit at most 3 months' rent, prepaid rent at most 3, together at most 6. */
const DEPOSIT_CAP_MONTHS = 3;
const PREPAID_CAP_MONTHS = 3;
const COMBINED_CAP_MONTHS = 6;

/** A date nearer than this is "soon" rather than "later". */
const SOON_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {string} iso `YYYY-MM-DD` @returns {number|null} Midnight UTC of that day, in ms. */
function dayOf(iso) {
  const m = typeof iso === 'string' ? iso.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/**
 * When the home can be taken over, said both as a date and in relation to today.
 *
 * An advert that says "as soon as possible" has no date to show, only the state: it is free now.
 *
 * @param {{availableFrom?: string, availableImmediately?: boolean}} terms The stored rental terms.
 * @param {FactContext & {now?: Date}} ctx
 * @returns {{date: string|null, relative: string, state: 'now'|'soon'|'later'}|null}
 */
function buildAvailability(terms, ctx) {
  const { t, locale } = ctx;
  const target = dayOf(terms.availableFrom);
  if (target == null) {
    return terms.availableImmediately === true
      ? { date: null, relative: t('listing.detail.rentalAvailableNow'), state: 'now' }
      : null;
  }
  const now = ctx.now ?? new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((target - today) / DAY_MS);

  const date = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(target));
  if (days <= 0) return { date, relative: t('listing.detail.rentalAvailableNow'), state: 'now' };
  if (days < SOON_DAYS) {
    return { date, relative: t('listing.detail.rentalAvailableInDays', { days }), state: 'soon' };
  }
  return {
    date,
    relative: t('listing.detail.rentalAvailableInMonths', { months: Math.round(days / 30.4) }),
    state: 'later',
  };
}

/**
 * What a rental costs beyond the rent and when it can be moved into: the Danish rental terms a
 * listing carries (`rental_terms`, see `lib/services/rental/rentalTerms.js`), as descriptors.
 *
 * The date comes first and on its own: for someone moving at a fixed time, "free from when" decides
 * whether the rest is worth reading. The cash needed on the day is the figure the advert states
 * (`indflytningspris`) when it states one, and that figure is trusted as it is: it is the one a
 * tenant budgets by and may include fees we cannot see, so it is never second-guessed. Only when the
 * advert gives none is it worked out here, the way Danish portals and tenant advice define it - the
 * first month's rent (with any running costs on account), plus the deposit, plus the prepaid rent -
 * and then it is marked as our own calculation and as a floor.
 *
 * The legal ceilings apply to the rent itself, not to running costs, so they are only checked when
 * the listed rent is known to be without them.
 *
 * @param {Object|null} listing - A row as the listings API returns it.
 * @param {FactContext & {now?: Date}} ctx
 * @returns {{availability: Object|null, rows: ListingFact[], moveIn: {text: string, stated: boolean, helpText: string}|null, warnings: string[], socialHousing: boolean, priority: string|null}|null}
 *   `null` for a sale, and for a rental that states nothing of this.
 */
export function buildRentalFacts(listing, ctx) {
  const row = listing ?? {};
  if (row.dealType !== 'rent') return null;

  const { t, locale } = ctx;
  const currency = ctx.currency ?? DEFAULT_CURRENCY;
  const money = (value) => formatPrice(value, locale, null, currency);
  const terms = row.rental_terms ?? {};
  const rent = Number.isFinite(row.price) ? row.price : null;
  const charges = Number.isFinite(row.charges) && row.charges > 0 ? row.charges : null;
  const chargesOnTop = charges != null && row.charges_included === 0;

  const availability = buildAvailability(terms, ctx);
  const rows = [];

  if (chargesOnTop) {
    rows.push({
      id: 'extraCosts',
      label: t('listing.detail.rentalExtraCosts'),
      value: money(charges),
      helpText: t('listing.detail.rentalExtraCostsHelp'),
    });
    if (rent != null) {
      rows.push({
        id: 'totalMonthly',
        label: t('listing.detail.rentalTotalMonthly'),
        value: money(rent + charges),
        helpText: t('listing.detail.rentalTotalMonthlyHelp'),
      });
    }
  }
  if (terms.deposit != null) {
    rows.push({ id: 'deposit', label: t('listing.detail.rentalDeposit'), value: money(terms.deposit) });
  }
  if (terms.prepaidRent != null) {
    rows.push({ id: 'prepaidRent', label: t('listing.detail.rentalPrepaid'), value: money(terms.prepaidRent) });
  }
  if (terms.leasePeriodMonths != null) {
    rows.push({
      id: 'lease',
      label: t('listing.detail.rentalLease'),
      value:
        terms.leasePeriodMonths === 0
          ? t('listing.detail.rentalLeaseOpen')
          : t('listing.detail.rentalLeaseMonths', { months: terms.leasePeriodMonths }),
      helpText: t('listing.detail.rentalLeaseHelp'),
    });
  }

  // The first month's rent, with the running costs on account where they are charged on top.
  const firstMonth = rent != null ? rent + (chargesOnTop ? charges : 0) : null;
  const estimate =
    firstMonth != null && (terms.deposit != null || terms.prepaidRent != null)
      ? firstMonth + (terms.deposit ?? 0) + (terms.prepaidRent ?? 0)
      : null;
  let moveIn = null;
  if (terms.moveInTotal != null) {
    moveIn = { stated: true, text: money(terms.moveInTotal), helpText: t('listing.detail.rentalMoveInStatedHelp') };
  } else if (estimate != null) {
    moveIn = { stated: false, text: money(estimate), helpText: t('listing.detail.rentalMoveInHelp') };
  }

  // Only against a rent known to be without running costs: the law's base is the rent alone.
  const warnings = [];
  if (rent != null && rent > 0 && row.charges_included !== 1) {
    const deposit = terms.deposit ?? 0;
    const prepaid = terms.prepaidRent ?? 0;
    if (deposit > DEPOSIT_CAP_MONTHS * rent) warnings.push(t('listing.detail.rentalDepositOverCap'));
    if (prepaid > PREPAID_CAP_MONTHS * rent) warnings.push(t('listing.detail.rentalPrepaidOverCap'));
    if (deposit + prepaid > COMBINED_CAP_MONTHS * rent) warnings.push(t('listing.detail.rentalCombinedOverCap'));
  }

  const socialHousing = terms.socialHousing === true;
  const priority = typeof terms.priority === 'string' && terms.priority !== '' ? terms.priority : null;
  if (availability == null && rows.length === 0 && moveIn == null && !socialHousing && priority == null) return null;
  return { availability, rows, moveIn, warnings, socialHousing, priority };
}

/** A home offered this many days longer in total than with its current realtor has been relisted. */
export const RELISTED_GAP_DAYS = 60;

/** The provider's property types that have a translated name; any other is shown as the portal wrote it. */
const PROPERTY_TYPE_KEYS = {
  villa: 'listing.detail.saleTypeVilla',
  'terraced house': 'listing.detail.saleTypeTerracedHouse',
  condo: 'listing.detail.saleTypeCondo',
  'double house': 'listing.detail.saleTypeDoubleHouse',
  'villa apartment': 'listing.detail.saleTypeVillaApartment',
};

/** The names of the kinds of sale the register distinguishes; anything else is `other`. */
const SALE_TYPE_KEYS = {
  normal: 'listing.detail.saleSaleTypeNormal',
  family: 'listing.detail.saleSaleTypeFamily',
  auction: 'listing.detail.saleSaleTypeAuction',
  other: 'listing.detail.saleSaleTypeOther',
};

/**
 * One earlier sale of the address, as the sales table shows it.
 *
 * @typedef {Object} EarlierSale
 * @property {string} date The day, in the reader's locale.
 * @property {string} amount What was paid.
 * @property {string|null} perM2 What was paid per square metre, when the register has the area.
 * @property {{percent: number, text: string, diffText: string}|null} change Today's asking price against
 *   what was paid. `null` for a sale that was not a free one: a family transfer or an auction says
 *   nothing about what the market would pay, so it is never compared.
 * @property {boolean} free `true` for `type: normal`, the only kind that is a market price.
 * @property {string} typeLabel The kind of sale, in words.
 */

/**
 * @typedef {Object} SaleHistory
 * @property {EarlierSale[]} sales Newest first.
 * @property {boolean} hasNonFree Whether any sale in the list was not a free one, which is what the note
 *   under the table is for.
 * @property {{text: string, helpText: string}|null} valuation The latest public valuation.
 */

/**
 * The change from what was paid then to the price asked now.
 *
 * @param {number} then
 * @param {number|null|undefined} now The asking price.
 * @param {string} locale
 * @param {(value: number) => string} money
 * @returns {{percent: number, text: string, diffText: string}|null}
 */
function changeToToday(then, now, locale, money) {
  if (!Number.isFinite(now) || !(then > 0)) return null;
  const percent = ((now - then) / then) * 100;
  const diff = now - then;
  return { percent, text: formatDeviation(percent, locale), diffText: `${diff > 0 ? '+' : ''}${money(diff)}` };
}

/**
 * The rows of the Danish financing card: the monthly cost after rentefradrag first, then the cash it
 * takes, what is still owed after a while, and when the household is debt-free.
 *
 * The monthly cost says so when it is the loans alone (no ejerudgift known), and a tax estimate says
 * what it leaves out, because a figure that looks complete and is not is worse than a missing one.
 *
 * @param {Object} result The Danish result, `model: 'dk'` (see `lib/services/finance/dk/result.js`).
 * @param {{t: (key: string, params?: Object) => string, locale: string}} ctx
 * @returns {{facts: Array<{id: string, label: string, value: string, emphasis: boolean, note?: string}>, footnote: string}}
 */
export function buildDanishFinanceFacts(result, ctx) {
  const { t, locale } = ctx;
  const dk = result.dk;
  const money = (value) => (value == null ? '-' : formatPrice(Math.round(value), locale, null, 'DKK'));
  const debtFree = (result.debtFreeAges ?? [])
    .filter((person) => person.ageWhenDebtFree != null)
    .map((person) => `${person.label} ${person.ageWhenDebtFree}`)
    .join(' · ');

  const ownerCost = dk.running.ownerCostMonthly;
  const ownerNote =
    dk.running.source === 'estimate'
      ? t(
          dk.running.grundskyldMonthly == null
            ? 'listing.detail.dkOwnerCostEstimateNoLand'
            : 'listing.detail.dkOwnerCostEstimate',
        )
      : dk.running.source === 'advert'
        ? t('listing.detail.dkOwnerCostAdvert')
        : undefined;

  const facts = [
    {
      id: 'monthly',
      label: t('listing.detail.dkMonthly'),
      value: money(dk.totalMonthly.net),
      emphasis: true,
      note: dk.totalMonthly.ownerCostKnown ? undefined : t('listing.detail.dkMonthlyLoansOnly'),
    },
    {
      id: 'loans',
      label: t('listing.detail.dkLoans'),
      value: money(dk.payment.net),
      emphasis: false,
      note: t('listing.detail.dkLoansGross', { gross: money(dk.payment.gross) }),
    },
    {
      id: 'ownerCost',
      label: t('listing.detail.dkOwnerCost'),
      value: ownerCost == null ? t('listing.detail.dkOwnerCostUnknown') : money(ownerCost),
      emphasis: false,
      note: ownerNote,
    },
    {
      id: 'cash',
      label: t('listing.detail.dkCash'),
      value: money(dk.cashNeeded),
      emphasis: false,
      note:
        dk.cashShortfall != null && dk.cashShortfall > 0
          ? t('listing.detail.dkCashShortfall', { amount: money(dk.cashShortfall) })
          : undefined,
    },
    {
      id: 'debt',
      label: t('listing.detail.dkDebtAfter', { years: String(dk.debt.atYears) }),
      value: money(dk.debt.atYearsBalance),
      emphasis: false,
    },
    { id: 'debtFree', label: t('finance.kpi.debtFreeAge'), value: debtFree || '-', emphasis: false },
  ];

  return {
    facts,
    footnote: t('listing.detail.dkFootnote', {
      realkredit: formatDecimal(dk.params.realkredit.rate, locale),
      bank: formatDecimal(dk.params.bank.rate, locale),
    }),
  };
}

/**
 * What a for-sale advert states beside the price - the owner's monthly costs, how long the home has
 * been on the market, the building, a floor plan and the next open house - as descriptors for the sale
 * card. The listing's `sale_terms` (see `lib/services/sale/saleTerms.js`) are the source.
 *
 * A field the advert did not state is left out, never shown as zero or "N/A": a card full of dashes
 * reads as a fault in Fredy rather than a silent portal. A section with nothing in it is empty or `null`.
 *
 * @param {Object|null} listing - A row as the listings API returns it.
 * @param {FactContext & {now?: Date, yourFinance?: Object|null}} ctx `yourFinance` is the Danish
 *   financing result for this listing (`model: 'dk'`), when the household has a profile.
 * @returns {{costs: ListingFact[], sales: SaleHistory|null, market: {current: string|null, total: string|null, relisted: boolean, gapDays: number|null, previousRealtors: string[]}|null, building: ListingFact[], floorPlanUrl: string|null, openHouse: {text: string, signUpUrl: string|null}|null}|null}
 *   `null` for a rental, and for a purchase that states none of it.
 */
export function buildSaleFacts(listing, ctx) {
  const row = listing ?? {};
  const terms = row.sale_terms;
  if (row.dealType !== 'buy' || terms == null || typeof terms !== 'object') return null;

  const { t, locale } = ctx;
  const currency = ctx.currency ?? DEFAULT_CURRENCY;
  const money = (value) => formatPrice(value, locale, null, currency);
  const area = (value) => `${formatDecimal(value, locale)} m²`;
  const has = (value) => value != null;

  const costs = [];
  if (has(terms.ownerCostMonthly)) {
    costs.push({
      id: 'ownerCost',
      label: t('listing.detail.saleOwnerCost'),
      value: money(terms.ownerCostMonthly),
      helpText: t('listing.detail.saleOwnerCostHelp'),
    });
  }
  if (has(terms.pricePerM2)) {
    costs.push({
      id: 'pricePerM2',
      label: t('listing.detail.salePricePerM2'),
      value: formatPricePerSqm(terms.pricePerM2, locale, currency),
    });
  }
  if (has(terms.downPayment)) {
    costs.push({
      id: 'downPayment',
      label: t('listing.detail.saleDownPayment'),
      value: money(terms.downPayment),
      helpText: t('listing.detail.saleRealtorExampleHelp'),
    });
  }
  if (has(terms.grossPaymentMonthly)) {
    costs.push({
      id: 'grossPayment',
      label: t('listing.detail.saleGrossPayment'),
      value: money(terms.grossPaymentMonthly),
      helpText: t('listing.detail.saleRealtorExampleHelp'),
    });
  }
  if (has(terms.netPaymentMonthly)) {
    costs.push({
      id: 'netPayment',
      label: t('listing.detail.saleNetPayment'),
      value: money(terms.netPaymentMonthly),
      helpText: t('listing.detail.saleRealtorExampleHelp'),
    });
  }
  // Beside the realtor's example, the same two figures from the household's own finance profile:
  // its rates, its tax, its other debts. Only for a home priced in kroner, and only once a profile exists.
  const yours = ctx.yourFinance?.model === 'dk' ? ctx.yourFinance.dk : null;
  if (yours != null && yours.payment.gross > 0) {
    costs.push(
      {
        id: 'yourGross',
        label: t('listing.detail.saleYourGross'),
        value: money(Math.round(yours.payment.gross)),
        helpText: t('listing.detail.saleYourHelp'),
      },
      {
        id: 'yourNet',
        label: t('listing.detail.saleYourNet'),
        value: money(Math.round(yours.payment.net)),
        helpText: t('listing.detail.saleYourHelp'),
      },
    );
  }
  // Zero is "never reduced", which is the usual case and not worth a line.
  if (has(terms.priceChangePct) && terms.priceChangePct !== 0) {
    costs.push({
      id: 'priceChange',
      label: t('listing.detail.salePriceChange'),
      value: formatDeviation(terms.priceChangePct, locale),
      helpText: t('listing.detail.salePriceChangeHelp'),
    });
  }
  // The asking price leads, but only when there is something to put beside it.
  if (costs.length > 0 && has(row.price)) {
    costs.unshift({ id: 'price', label: t('listing.detail.salePrice'), value: money(row.price) });
  }

  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const saleList = Array.isArray(terms.sales) ? terms.sales : [];
  const sales =
    saleList.length === 0 && !has(terms.publicValuation)
      ? null
      : {
          sales: saleList.map((earlier) => {
            const free = earlier.type === 'normal';
            return {
              date: dateFormat.format(new Date(`${earlier.date}T00:00:00Z`)),
              amount: money(earlier.amount),
              perM2: has(earlier.area) ? formatPricePerSqm(earlier.amount / earlier.area, locale, currency) : null,
              change: free ? changeToToday(earlier.amount, row.price, locale, money) : null,
              free,
              typeLabel: t(SALE_TYPE_KEYS[earlier.type] ?? SALE_TYPE_KEYS.other),
            };
          }),
          hasNonFree: saleList.some((earlier) => earlier.type !== 'normal'),
          valuation: has(terms.publicValuation)
            ? { text: money(terms.publicValuation), helpText: t('listing.detail.saleValuationHelp') }
            : null,
        };

  const current = terms.daysOnMarket?.current ?? null;
  const total = terms.daysOnMarket?.total ?? null;
  const gapDays = current != null && total != null ? total - current : null;
  const days = (n) => t('listing.detail.saleDays', { days: formatDecimal(n, locale) });
  const market =
    current == null && total == null
      ? null
      : {
          current: current != null ? days(current) : null,
          total: total != null ? days(total) : null,
          relisted: gapDays != null && gapDays >= RELISTED_GAP_DAYS,
          gapDays,
          previousRealtors: Array.isArray(terms.previousRealtors) ? terms.previousRealtors : [],
        };

  const building = [];
  if (has(terms.propertyType)) {
    const key = PROPERTY_TYPE_KEYS[terms.propertyType];
    building.push({
      id: 'propertyType',
      label: t('listing.detail.saleType'),
      value: key ? t(key) : terms.propertyType,
    });
  }
  if (has(terms.yearBuilt)) {
    building.push({ id: 'yearBuilt', label: t('listing.detail.saleYearBuilt'), value: String(terms.yearBuilt) });
  }
  if (has(terms.yearRenovated)) {
    building.push({
      id: 'yearRenovated',
      label: t('listing.detail.saleYearRenovated'),
      value: String(terms.yearRenovated),
    });
  }
  if (has(terms.energyLabel)) {
    building.push({ id: 'energyLabel', label: t('listing.detail.saleEnergyLabel'), value: terms.energyLabel });
  }
  if (has(terms.heating)) {
    building.push({ id: 'heating', label: t('listing.detail.saleHeating'), value: terms.heating });
  }
  if (has(terms.lotArea)) {
    building.push({ id: 'lotArea', label: t('listing.detail.saleLotArea'), value: area(terms.lotArea) });
  }
  if (has(terms.basementArea)) {
    building.push({ id: 'basementArea', label: t('listing.detail.saleBasementArea'), value: area(terms.basementArea) });
  }
  if (has(terms.bathrooms)) {
    building.push({ id: 'bathrooms', label: t('listing.detail.saleBathrooms'), value: String(terms.bathrooms) });
  }
  if (has(terms.landTaxPerMille)) {
    building.push({
      id: 'landTax',
      label: t('listing.detail.saleLandTax'),
      value: `${formatDecimal(terms.landTaxPerMille, locale)} ‰`,
      helpText: t('listing.detail.saleLandTaxHelp'),
    });
  }

  const floorPlanUrl = terms.floorPlanUrl ?? null;

  // An open house that has already happened is not worth a link.
  let openHouse = null;
  const when = terms.nextOpenHouse?.date != null ? new Date(terms.nextOpenHouse.date) : null;
  if (when != null && !Number.isNaN(when.getTime()) && when.getTime() >= (ctx.now ?? new Date()).getTime()) {
    openHouse = {
      text: new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Copenhagen',
      }).format(when),
      signUpUrl: terms.nextOpenHouse.signUpUrl ?? null,
    };
  }

  if (
    costs.length === 0 &&
    sales == null &&
    market == null &&
    building.length === 0 &&
    floorPlanUrl == null &&
    openHouse == null
  ) {
    return null;
  }
  return { costs, sales, market, building, floorPlanUrl, openHouse };
}
