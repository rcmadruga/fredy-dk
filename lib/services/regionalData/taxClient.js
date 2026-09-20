/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { STATBANK_TABLE_URL, STATBANK_TABLEINFO_URL } from './constants.js';
import logger from '../logger.js';

/**
 * @typedef {Object} KommuneTaxRates
 * @property {number} kommuneskatPct - Municipal income tax rate, in percent.
 * @property {number} grundskyldPromille - Land tax rate, in per mille (‰) of the land value.
 */

/**
 * The most recent year PSKAT has data for.
 *
 * Statbank tables grow a new `Tid` value every year rather than exposing a "latest" alias, and a
 * hardcoded year would quietly go stale every January.
 *
 * @returns {Promise<string|null>}
 */
async function fetchLatestYear() {
  const response = await fetch(STATBANK_TABLEINFO_URL);
  if (!response.ok) {
    logger.error(`Statbank tableinfo request failed with status ${response.status}`);
    return null;
  }
  const info = await response.json();
  const years = (info.variables ?? []).find((variable) => variable.id === 'Tid')?.values ?? [];
  if (years.length === 0) return null;
  // Values come back in ascending order, but sorted explicitly rather than trusting that.
  return years
    .map((year) => year.id)
    .sort()
    .at(-1);
}

/**
 * Splits one non-quoted semicolon-delimited line. Statbank's CSV export never quotes a field - place
 * names containing a semicolon do not occur in Danish - so nothing more elaborate is needed.
 *
 * @param {string} line
 * @returns {string[]}
 */
function splitCsvLine(line) {
  return line.split(';');
}

/**
 * Fetches this year's kommuneskat and grundskyldspromille for every kommune code given.
 *
 * @param {string[]} kommuneCodes - Codes as DAWA spells them ("0101"); converted to Statbank's own
 *   spelling ("101") before the request.
 * @returns {Promise<Map<string, KommuneTaxRates>|null>} Keyed by the DAWA-style code, so callers
 *   never have to convert back. `null` on any failure - see {@link ../diskCache.js}.
 */
export async function fetchKommuneTaxRates(kommuneCodes) {
  try {
    const year = await fetchLatestYear();
    if (year == null) return null;

    const statbankCodes = kommuneCodes.map((code) => String(Number(code)));
    const params = new URLSearchParams({
      lang: 'en',
      OMRÅDE: statbankCodes.join(','),
      SKATPCT: 'KOM,GRUND',
      Tid: year,
      valuePresentation: 'Code',
    });

    const response = await fetch(`${STATBANK_TABLE_URL}?${params}`);
    if (!response.ok) {
      logger.error(`Statbank PSKAT request failed with status ${response.status}`);
      return null;
    }

    const csv = await response.text();
    // Statbank's CSV export leads with a UTF-8 BOM, which would otherwise end up glued to the first
    // header name.
    const withoutBom = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
    const lines = withoutBom
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const [, ...rows] = lines; // drop the header row

    // Statbank's own code has no leading zero; DAWA's does. Rebuilt with the padding so a kommune
    // that lost it (0101 -> 101 -> "101") can still be looked up by its DAWA code.
    /** @type {Map<string, Partial<KommuneTaxRates>>} */
    const byCode = new Map();
    for (const row of rows) {
      const [areaCode, metric, , rawValue] = splitCsvLine(row);
      if (areaCode == null || metric == null || rawValue == null) continue;

      const dawaCode = areaCode.padStart(4, '0');
      const value = Number(rawValue);
      if (!Number.isFinite(value)) continue;

      const entry = byCode.get(dawaCode) ?? {};
      if (metric === 'KOM') entry.kommuneskatPct = value;
      if (metric === 'GRUND') entry.grundskyldPromille = value;
      byCode.set(dawaCode, entry);
    }

    /** @type {Map<string, KommuneTaxRates>} */
    const result = new Map();
    for (const [code, rates] of byCode) {
      if (rates.kommuneskatPct != null && rates.grundskyldPromille != null) {
        result.set(code, /** @type {KommuneTaxRates} */ (rates));
      }
    }
    return result;
  } catch (error) {
    logger.error('Error fetching kommune tax rates from Statbank', error);
    return null;
  }
}
