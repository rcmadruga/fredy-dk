/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Reads a listing's `sale_terms` without depending on who wrote them.
 *
 * `sale_terms` (the Danish purchase facts: valuation, earlier sales, days on market, the building)
 * is a column of the unmerged `feat/dk-buying` branch. The metrics that read it must work on this
 * branch, where the column does not exist, and on that one, where a storage layer may hand it over
 * parsed or still as JSON text. So the reading is defensive: anything that is not an object is
 * "no terms", and every metric then scores missing.
 *
 * @param {Object|null|undefined} listing
 * @returns {Object|null} The terms object, or `null` when the listing has none.
 */
export function saleTermsOf(listing) {
  let terms = listing?.sale_terms ?? listing?.saleTerms;
  if (typeof terms === 'string') {
    try {
      terms = JSON.parse(terms);
    } catch {
      return null;
    }
  }
  return terms != null && typeof terms === 'object' && !Array.isArray(terms) ? terms : null;
}

/**
 * A finite number out of a field that may be a number, numeric text or nothing.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function finiteNumber(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
