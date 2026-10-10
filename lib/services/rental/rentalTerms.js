/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The terms of a rental that a Danish portal states next to the rent, in one shape.
 *
 * Danish adverts quote the monthly rent (`husleje`) and then, separately, what else a tenant pays:
 * running costs on account (`a conto` heating, water, electricity), a deposit (`depositum`), prepaid
 * rent (`forudbetalt leje`), whether the lease is limited (`tidsbegrænset`), and from when the home
 * is free (`overtagelse`). Every portal names these differently, so a provider reads its own fields
 * and hands the raw figures to {@link buildRentalTerms}, which is the one place that decides what a
 * usable value is. A new portal is then a mapping, not a second set of rules.
 *
 * Nothing is invented: a figure the advert does not state stays absent, because "no deposit stated"
 * and "a deposit of zero" are different things for someone budgeting the day they move in.
 */

/**
 * @typedef {Object} RentalTerms What is stored for a listing, as JSON in `listings.rental_terms`.
 * @property {number} [deposit] The deposit, in the portal's currency. `0` means the advert says none.
 * @property {number} [prepaidRent] The rent prepaid at move-in.
 * @property {number} [moveInTotal] The total move-in price (`indflytningspris`) when the advert states
 *   it itself: first month's rent, deposit and prepaid rent, and whatever else the landlord adds.
 * @property {number} [leasePeriodMonths] `0` for an open-ended lease, a positive number of months for a
 *   limited one. Absent when the advert does not say.
 * @property {string} [availableFrom] `YYYY-MM-DD`, from when the home can be taken over.
 * @property {boolean} [socialHousing] A non-profit housing association's home, usually allocated by a waiting list.
 */

/**
 * @typedef {Object} RentalTermsInput What a provider read off an advert. Every field is optional and
 *   anything that is not usable is dropped rather than rejected.
 * @property {number|string|null} [rent] The monthly rent the advert quotes, which the extra costs are checked against.
 * @property {number|string|null} [extraCosts] Monthly costs charged on top of the rent (a conto heating and the like).
 * @property {number|string|null} [deposit]
 * @property {number|string|null} [prepaidRent]
 * @property {number|string|null} [moveInTotal] The total the advert states for moving in, if it does.
 * @property {number|string|null} [leasePeriodMonths] `0` for open-ended.
 * @property {string|null} [availableFrom] An ISO date, `YYYY-MM-DD`, with or without a time.
 * @property {boolean|null} [socialHousing]
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** A figure as a finite, non-negative number, or `undefined`. */
function amount(value) {
  if (value == null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * @param {string|null|undefined} value
 * @returns {string|undefined} The date part, `YYYY-MM-DD`, if it is a real calendar date.
 */
function isoDate(value) {
  const m = typeof value === 'string' ? value.match(ISO_DATE) : null;
  if (!m) return undefined;
  const [, y, mo, d] = m.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  const real = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
  return real ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/**
 * A calendar date as `YYYY-MM-DD`, for what arrives from outside (a request's filter).
 *
 * @param {unknown} value
 * @returns {string|null} The date part if it is a real date, else `null`.
 */
export function normalizeIsoDate(value) {
  // Strict, unlike what a provider's own page may say: this is input from outside, so a date with
  // anything trailing it that is not a time is refused rather than trimmed.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.+\-Zz]*)?$/.test(value)) return null;
  return isoDate(value) ?? null;
}

/**
 * Turns what a portal states into the fields a listing carries.
 *
 * `charges` and `chargesIncluded` are returned apart from `rental` because they have their own
 * columns and feed the affordability verdict (`finance/affordability.js`), which has to know whether
 * a rent already contains the running costs. Extra costs stated *beside* the rent mean the rent is
 * without them (`chargesIncluded: false`). When no extra costs are stated nothing is claimed either
 * way: the advert may mean "all included" or "you pay the utility companies yourself".
 *
 * @param {RentalTermsInput} input
 * @returns {{chargesIncluded?: boolean, charges?: number, rental?: RentalTerms}}
 */
export function buildRentalTerms(input = {}) {
  const result = {};

  const rent = amount(input.rent);
  const extra = amount(input.extraCosts);
  // Larger than the rent is not a running cost, it is a different figure under the same name.
  if (extra != null && extra > 0 && (rent == null || extra < rent)) {
    result.charges = extra;
    result.chargesIncluded = false;
  }

  /** @type {RentalTerms} */
  const rental = {};
  const deposit = amount(input.deposit);
  if (deposit != null) rental.deposit = deposit;
  const prepaidRent = amount(input.prepaidRent);
  if (prepaidRent != null) rental.prepaidRent = prepaidRent;

  // A stated total below one month's rent is not a move-in price (it is a deposit, a fee, a typo), and
  // one above a year's rent is a different figure under the same name.
  const moveInTotal = amount(input.moveInTotal);
  if (moveInTotal != null && (rent == null || (moveInTotal >= rent && moveInTotal <= 12 * rent))) {
    rental.moveInTotal = moveInTotal;
  }

  const months = amount(input.leasePeriodMonths);
  if (months != null && Number.isInteger(months)) rental.leasePeriodMonths = months;

  const availableFrom = isoDate(input.availableFrom);
  if (availableFrom) rental.availableFrom = availableFrom;
  if (input.socialHousing === true) rental.socialHousing = true;

  if (Object.keys(rental).length > 0) result.rental = rental;
  return result;
}

/**
 * Reads the stored JSON back, defensively: a hand-edited or older row must not break a listing.
 *
 * @param {string|object|null|undefined} stored
 * @returns {RentalTerms|null}
 */
export function parseRentalTerms(stored) {
  if (stored == null) return null;
  let value = stored;
  if (typeof stored === 'string') {
    try {
      value = JSON.parse(stored);
    } catch {
      return null;
    }
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return (
    buildRentalTerms({
      deposit: value.deposit,
      prepaidRent: value.prepaidRent,
      moveInTotal: value.moveInTotal,
      leasePeriodMonths: value.leasePeriodMonths,
      availableFrom: value.availableFrom,
      socialHousing: value.socialHousing,
    }).rental ?? null
  );
}

/**
 * The words with which a Danish (or English) advert introduces the total it asks for at move-in.
 * Not bare `indflytning`: `indflytningsdato` is a date and `ved indflytning` usually starts a list of
 * parts, which is a different sentence.
 */
const MOVE_IN_TOTAL_KEYWORD =
  /(?:samlet(?:e)?\s+|total(?:e)?\s+)?(?:indflytningspris(?:en)?|indflytningsomkostninger(?:ne)?|indflytningsudgifter(?:ne)?|indflytningsbeløb(?:et)?|move-?in\s+(?:price|cost|costs|total))|(?:i\s*alt|ialt|total)\s+ved\s+indflytning/g;

/** A sum of money, with or without a currency marker. */
const MONEY =
  /(?:(?:kr|dkk)\.?\s*)?(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d{3,6}(?:[.,]\d{1,2})?)(?:\s*(?:kr\.?|dkk|,-|\.-|;-))?/i;

/** Words that, between the keyword and the sum, mean a list of the parts follows rather than their total. */
const A_PART = /depositum|forudbetalt|husleje|leje\b|aconto|a conto|måned|deposit|prepaid|rent\b/;

/**
 * A number the way a Danish or an English advert writes it: `24.050`, `24 050,00`, `24,050`, `24050`.
 *
 * @param {string} raw
 * @returns {number|undefined}
 */
function parseAmount(raw) {
  const text = raw.replace(/\s/g, '');
  // Thousands groups of exactly three digits, with `.` or `,` between: the separator is not a decimal.
  const grouped = text.match(/^(\d{1,3}(?:[.,]\d{3})+)(?:[.,](\d{1,2}))?$/);
  if (grouped) return Number(`${grouped[1].replace(/[.,]/g, '')}${grouped[2] ? `.${grouped[2]}` : ''}`);
  const plain = text.match(/^(\d+)(?:[.,](\d{1,2}))?$/);
  return plain ? Number(`${plain[1]}${plain[2] ? `.${plain[2]}` : ''}`) : undefined;
}

/**
 * The total move-in price an advert's text states, if it does (`Indflytningspris: 24.050 kr.`).
 *
 * Many Danish adverts give it, and it is the figure a tenant budgets by, so it is read rather than
 * recomputed. Deliberately conservative: it must follow a move-in-total phrase, must be a thousand or
 * more, and is dropped if the words in between name a part (deposit, prepaid rent) - those lines list
 * components, they are not the total. Parenthetical remarks are ignored. The caller still checks the
 * figure against the rent (see {@link buildRentalTerms}).
 *
 * @param {string|null|undefined} text An advert's description.
 * @returns {number|undefined}
 */
export function parseMoveInTotal(text) {
  if (typeof text !== 'string' || text === '') return undefined;
  const flat = text
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ');

  for (const keyword of flat.matchAll(MOVE_IN_TOTAL_KEYWORD)) {
    const after = flat.slice(keyword.index + keyword[0].length, keyword.index + keyword[0].length + 60);
    const found = after.match(MONEY);
    if (!found) continue;
    const gap = after.slice(0, found.index);
    // Words between the phrase and the sum: "er", "udgør", ":", "på" are fine; a component is not, and
    // neither is the end of a sentence (the sum then belongs to the next one).
    if (A_PART.test(gap) || /[.!?]/.test(gap.replace(/kr\.?|dkk/g, ''))) continue;
    // Straight after one of these phrases, a number of a thousand or more is a sum whether or not it
    // says "kr"; below that it is a count or a date and never a move-in price.
    const value = parseAmount(found[1]);
    if (value != null && value >= 1000) return value;
  }
  return undefined;
}
