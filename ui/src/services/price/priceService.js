/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Used when no locale is passed. Components have one from `useLocale()`; the map popup builds plain
 * markup outside React and gets it handed down from the view.
 * @type {string}
 */
const DEFAULT_LOCALE = 'de-DE';

/**
 * `Intl.NumberFormat` is expensive to construct and a listings grid formats one price per card, so
 * formatters are built once per locale and precision and then reused.
 * @type {Map<string, Intl.NumberFormat>}
 */
const formatterCache = new Map();

/**
 * What a price is in when nothing says otherwise. Providers declare `currency` in their metadata
 * only when it is not this - the Danish ones list in kroner.
 */
export const DEFAULT_CURRENCY = 'EUR';

/**
 * @param {unknown} currency
 * @returns {string} Upper-case ISO 4217 code, euros for anything that is not one.
 */
function codeOf(currency) {
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(code) ? code : DEFAULT_CURRENCY;
}

/**
 * @param {string} locale BCP 47 locale.
 * @param {number} fractionDigits Exact number of decimals to print.
 * @param {string} currency ISO 4217 code.
 * @returns {Intl.NumberFormat}
 */
function priceFormatter(locale, fractionDigits, currency) {
  const key = `${locale}:${fractionDigits}:${currency}`;
  let formatter = formatterCache.get(key);
  if (formatter == null) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/**
 * A price the way the reader's language writes one, grouping and currency symbol included:
 * `776.515 €` in German, `€776,515` in English.
 *
 * Cents appear only when the price actually has them. Asking prices come in whole euros and a
 * permanent `,00` behind six figures is noise, while a price that does carry cents still prints
 * both digits rather than the single one a plain `maximumFractionDigits` would leave.
 *
 * A value that is not a number is handed back as it came, with a bare symbol appended: it is
 * usually a provider writing "auf Anfrage" into the price field, and mangling that into `NaN €`
 * helps nobody.
 *
 * @param {number|string} price
 * @param {string} [locale='de-DE'] BCP 47 locale, from `useLocale()` inside components.
 * @param {number|null} [fractionDigits=null] Forces an exact number of decimals instead of the rule
 *   above. Asking prices are read one at a time and are better off without a permanent `,00`, but a
 *   price per square metre is read down a column against its neighbours, and `13 €` beside
 *   `21,76 €` reads as a different kind of number rather than a rounder one.
 * @param {string} [currency='EUR'] ISO 4217 code, from the listing's provider (see `useCurrencyOf`).
 * @returns {string}
 */
export const formatPrice = (price, locale = DEFAULT_LOCALE, fractionDigits = null, currency = DEFAULT_CURRENCY) => {
  const code = codeOf(currency);
  const parsedPrice = Number(price);
  if (!Number.isFinite(parsedPrice)) {
    return `${price} ${code === DEFAULT_CURRENCY ? '€' : code}`;
  }

  const digits = fractionDigits ?? (Number.isInteger(parsedPrice) ? 0 : 2);
  return priceFormatter(locale || DEFAULT_LOCALE, digits, code).format(parsedPrice);
};

/**
 * {@link formatPrice} in euros, for the places that are euros by construction: the market
 * benchmark and the finance tools, whose reference data is German.
 *
 * @param {number|string} price
 * @param {string} [locale='de-DE']
 * @param {number|null} [fractionDigits=null]
 * @returns {string}
 */
export const formatEuroPrice = (price, locale = DEFAULT_LOCALE, fractionDigits = null) =>
  formatPrice(price, locale, fractionDigits, DEFAULT_CURRENCY);
