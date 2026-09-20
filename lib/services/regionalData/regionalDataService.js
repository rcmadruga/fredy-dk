/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { cached } from './diskCache.js';
import { fetchKommuner } from './kommuneClient.js';
import { fetchKommuneTaxRates } from './taxClient.js';
import { fetchSchoolStats, hasApiKey as hasSchoolApiKey } from './schoolClient.js';
import {
  DAWA_ATTRIBUTION,
  STATBANK_ATTRIBUTION,
  UDDANNELSESSTATISTIK_ATTRIBUTION,
  STIL_REGISTER_ATTRIBUTION,
  KOMMUNE_CACHE_TTL_MS,
  TAX_CACHE_TTL_MS,
  SCHOOL_CACHE_TTL_MS,
  FAILURE_CACHE_TTL_MS,
} from './constants.js';

/**
 * Denmark-only backend data for the map's two optional overlays: a kommune-level tax choropleth
 * (kommuneskat + grundskyld) and school markers (inclusion, special-class share and grade average).
 *
 * Both are read-mostly national datasets that change a handful of times a year, which is why the
 * heavy lifting - fetching DAWA's kommune polygons, simplifying them, asking Statbank for this
 * year's rates - happens here and is cached (`diskCache.js`), rather than in the API route or on
 * every client that opens the map.
 *
 * The school layer additionally needs a STIL API key the operator has to register for themselves -
 * see `schoolClient.js`'s doc comment for the exact URL and steps, and `UDDANNELSESSTATISTIK_API_KEY_ENV`
 * for the environment variable it reads. Without one, `getSchoolLayer()` reports `available: false`
 * and an empty feature list rather than failing, which is what lets `yarn test`/`yarn test:offline`
 * and a fresh install all pass with no key set at all.
 *
 */

const KOMMUNE_CACHE_KEY = 'kommuner';
// The `V2` is not decoration. The first version cached a `Map`, which `JSON.stringify` writes as `{}`,
// so any deployment that ran it holds a `kommuneTaxRates.json` with no rates in it, valid for weeks.
// A new key makes that file unreachable instead of trusting it.
const TAX_CACHE_KEY = 'kommuneTaxRatesV2';
// Versioned like the tax key: the school shape changed (inclusion, special-class share, position from
// the institution register), and an old entry must not be served in the new one's place.
const SCHOOL_CACHE_KEY = 'schoolStatsV2';

/**
 * @returns {Promise<import('./kommuneClient.js').Kommune[]>} Empty array when DAWA could not be
 *   reached - a choropleth with no polygons rather than a broken map.
 */
async function getKommuner() {
  const kommuner = await cached(
    KOMMUNE_CACHE_KEY,
    (v) => (v ? KOMMUNE_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS),
    fetchKommuner,
  );
  return kommuner ?? [];
}

/**
 * The tax rates by kommune code, through the cache.
 *
 * Cached as a plain object rather than the `Map` the client returns: the cache mirrors to disk as
 * JSON, and a `Map` serialises to `{}` - the rates silently gone, and the next process start reading
 * back something that has no `.has`.
 *
 * @param {string[]} codes
 * @returns {Promise<Map<string, import('./taxClient.js').KommuneTaxRates>>} Empty when unavailable.
 */
async function loadTaxRates(codes) {
  const byCode = await cached(
    TAX_CACHE_KEY,
    (v) => (v ? TAX_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS),
    async () => {
      const rates = await fetchKommuneTaxRates(codes);
      return rates == null ? null : Object.fromEntries(rates);
    },
  );
  return new Map(Object.entries(byCode ?? {}));
}

/**
 * The tax choropleth as a ready-to-render GeoJSON `FeatureCollection`: one feature per kommune,
 * carrying its own polygon plus `kommuneskatPct`/`grundskyldPromille` in `properties` for MapLibre's
 * paint expressions to read directly.
 *
 * @returns {Promise<{type: 'FeatureCollection', features: Array<Object>, attribution: string[]}>}
 */
export async function getTaxChoropleth() {
  const kommuner = await getKommuner();
  const rates = kommuner.length === 0 ? new Map() : await loadTaxRates(kommuner.map((k) => k.code));

  return {
    type: 'FeatureCollection',
    // Only kommuner Statbank actually answered for - a polygon with no rate would either break the
    // paint expression or have to be special-cased in it, and every one of the 98 is expected to
    // have both rates.
    features: kommuner
      .filter((kommune) => rates.has(kommune.code))
      .map((kommune) => ({
        type: 'Feature',
        id: kommune.code,
        geometry: kommune.geometry,
        properties: {
          code: kommune.code,
          name: kommune.name,
          ...rates.get(kommune.code),
        },
      })),
    attribution: [DAWA_ATTRIBUTION, STATBANK_ATTRIBUTION],
  };
}

/**
 * @returns {Promise<{available: boolean, schools: Array<import('./schoolClient.js').SchoolStat>, attribution: string[]}>}
 *   `available` is false whenever no API key is configured, which the frontend uses to disable the
 *   toggle rather than offer one that always comes back empty.
 */
export async function getSchoolLayer() {
  if (!hasSchoolApiKey()) {
    return { available: false, schools: [], attribution: [] };
  }

  const schools = await cached(
    SCHOOL_CACHE_KEY,
    (v) => (v ? SCHOOL_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS),
    fetchSchoolStats,
  );

  return {
    available: true,
    // The client only returns schools it could place, but the cache is on disk: keep the map from
    // ever being handed one without a position.
    schools: (schools ?? []).filter((school) => school.lat != null && school.lng != null),
    attribution: [UDDANNELSESSTATISTIK_ATTRIBUTION, STIL_REGISTER_ATTRIBUTION],
  };
}
