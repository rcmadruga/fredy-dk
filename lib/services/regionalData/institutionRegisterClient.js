/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { STIL_INSTITUTION_REGISTER_URL } from './constants.js';
import logger from '../logger.js';

/**
 * @typedef {Object} RegisteredInstitution
 * @property {number} lat
 * @property {number} lng
 * @property {string|null} type - Register category, e.g. "Folkeskoler" or "Specialskoler for børn".
 * @property {string|null} address - "Street 1, 1234 Town", as far as the register has one.
 * @property {string|null} website - A full `https://` URL, or null.
 * @property {boolean} active - False for a closed or closing institution.
 */

/** Denmark including Bornholm, with a margin. A coordinate outside it is a typo in the register. */
const DK_BOUNDS = { minLat: 54.4, maxLat: 57.9, minLng: 7.8, maxLng: 15.3 };

/**
 * The register writes websites without a scheme ("www.uuf.kk.dk"); the map links to them.
 *
 * @param {unknown} value
 * @returns {string|null} An http(s) URL, or null for anything that is not a plausible host.
 */
export function normalizeWebsite(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw.length === 0) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.') ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, any>} row
 * @returns {string|null}
 */
function addressOf(row) {
  const street = typeof row.address === 'string' ? row.address.trim() : '';
  const town = [row.postalCode, row.postalDistrict]
    .filter((part) => part != null && String(part).trim().length > 0)
    .join(' ');
  const full = [street, town].filter((part) => part.length > 0).join(', ');
  return full.length > 0 ? full : null;
}

/**
 * Every institution in the register that has a usable position, keyed by institution number.
 *
 * The whole register is one ~10 MB response (about 9,800 institutions, closed ones included), so the
 * caller keeps only the join it needs rather than caching this.
 *
 * @returns {Promise<Map<string, RegisteredInstitution>|null>} `null` - never a throw - when the
 *   register cannot be reached or is not in the shape this expects.
 */
export async function fetchInstitutionRegister() {
  try {
    const response = await fetch(STIL_INSTITUTION_REGISTER_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'fredy-dk (self-hosted; school map layer)' },
    });
    if (!response.ok) {
      logger.error(`Institution register request failed with status ${response.status}`);
      return null;
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) {
      logger.error('Institution register answered with something other than a list');
      return null;
    }

    const register = new Map();
    for (const row of rows) {
      const lat = Number(row?.latitude);
      const lng = Number(row?.longitude);
      const inDenmark =
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= DK_BOUNDS.minLat &&
        lat <= DK_BOUNDS.maxLat &&
        lng >= DK_BOUNDS.minLng &&
        lng <= DK_BOUNDS.maxLng;
      if (row?.institutionNumber == null || !inDenmark) continue;

      register.set(String(row.institutionNumber), {
        lat,
        lng,
        type: row.institutionType ?? null,
        address: addressOf(row),
        website: normalizeWebsite(row.website),
        // "Nedlagt ..." (closed) and "Under afvikling" (winding down) are the two inactive states.
        active: !/nedlagt|under afvikling/i.test(String(row.activeCodeName ?? '')),
      });
    }
    return register;
  } catch (error) {
    logger.error('Error fetching the institution register from STIL', error);
    return null;
  }
}
