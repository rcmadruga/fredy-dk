/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * What a provider's prices are in when its `metaInformation` does not say. Every provider that
 * predates the Danish ones lists in euros, so leaving the field out keeps them exactly as they were.
 */
export const DEFAULT_CURRENCY = 'EUR';

/** How a currency is written next to a bare number in a notification. Anything else prints its code. */
const SYMBOLS = { EUR: '€', DKK: 'kr.' };

/**
 * Reads a provider's declared currency leniently, the way `countries` is read: a missing or
 * malformed value falls back to euros rather than stopping a contributed provider from loading.
 *
 * @param {unknown} currency ISO 4217 code as declared in `metaInformation`.
 * @returns {string} Upper-case three-letter code.
 */
export function normalizeCurrency(currency) {
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(code) ? code : DEFAULT_CURRENCY;
}

/**
 * @param {string} currency ISO 4217 code.
 * @returns {string} The unit to print after a number: `€`, `kr.`, or the code itself.
 */
export function currencySymbol(currency) {
  const code = normalizeCurrency(currency);
  return SYMBOLS[code] ?? code;
}
