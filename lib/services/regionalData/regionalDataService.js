/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { cached } from './diskCache.js';
import { fetchKommuner } from './kommuneClient.js';
import { fetchKommuneTaxRates } from './taxClient.js';
import { fetchSchoolStats, hasApiKey as hasSchoolApiKey } from './schoolClient.js';
import { fetchGroceryStores } from './groceryClient.js';
import { chainOf } from './groceryChains.js';
import { fetchJobPostings } from './jobsClient.js';
import { buildJobsLayer } from './jobsLayer.js';
import {
  DAGI_ATTRIBUTION,
  STATBANK_ATTRIBUTION,
  UDDANNELSESSTATISTIK_ATTRIBUTION,
  STIL_REGISTER_ATTRIBUTION,
  KOMMUNE_CACHE_TTL_MS,
  TAX_CACHE_TTL_MS,
  SCHOOL_CACHE_TTL_MS,
  GROCERY_CACHE_TTL_MS,
  JOBS_CACHE_TTL_MS,
  JOBINDEX_ATTRIBUTION,
  OSM_ATTRIBUTION,
  FAILURE_CACHE_TTL_MS,
} from './constants.js';

/**
 * Denmark-only backend data for the map's two optional overlays: a kommune-level tax choropleth
 * (kommuneskat + grundskyld) and school markers (inclusion, special-class share and grade average).
 *
 * Both are read-mostly national datasets that change a handful of times a year, which is why the
 * heavy lifting - reading the bundled kommune polygons, asking Statbank for this
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

// Versioned because the source changed: the polygons used to come from DAWA (shut down October 2026)
// and are now bundled, and an entry written by the old code must not outlive it.
const KOMMUNE_CACHE_KEY = 'kommunerV2';
// The `V2` is not decoration. The first version cached a `Map`, which `JSON.stringify` writes as `{}`,
// so any deployment that ran it holds a `kommuneTaxRates.json` with no rates in it, valid for weeks.
// A new key makes that file unreachable instead of trusting it.
const TAX_CACHE_KEY = 'kommuneTaxRatesV2';
// Versioned like the tax key: the school shape has changed twice (inclusion and position from the
// institution register, then the type category the map filters by), and an old entry must not be
// served in the new one's place.
const SCHOOL_CACHE_KEY = 'schoolStatsV3';
// The chain is deliberately not trusted from the cache: it is worked out again from the stored name
// and brand every time the list is served (see `getGroceryLayer`). A change to the chain table -
// Salling becoming Foetex and Bilka, say - then needs no refetch of the whole country, and cannot
// leave a stale id on the map for the two weeks the list is kept.
const GROCERY_CACHE_KEY = 'groceryStoresV1';
// What is cached is the adverts as fetched (title, employer, place, link). Which of them count, and
// where they are, is worked out again on every read - see `jobsLayer.js`.
const JOBS_CACHE_KEY = 'jobAdvertsV1';

/**
 * @returns {Promise<import('./kommuneClient.js').Kommune[]>} Empty array when the bundled
 *   boundaries could not be read - a choropleth with no polygons rather than a broken map.
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
    attribution: [DAGI_ATTRIBUTION, STATBANK_ATTRIBUTION],
  };
}

/**
 * @returns {Promise<{available: boolean, failed?: boolean, schools: Array<import('./schoolClient.js').SchoolStat>, attribution: string[]}>}
 *   `available` is false whenever no API key is configured, which the frontend uses to disable the
 *   toggle rather than offer one that always comes back empty. `failed` is true when a key is
 *   configured but the data could not be fetched right now.
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
    // A key is set but the data could not be had (the register or the statistics were unreachable):
    // said outright, so the map can tell that apart from "no key" and from "no schools".
    failed: schools == null,
    // The client only returns schools it could place, but the cache is on disk: keep the map from
    // ever being handed one without a position.
    schools: (schools ?? []).filter((school) => school.lat != null && school.lng != null),
    attribution: [UDDANNELSESSTATISTIK_ATTRIBUTION, STIL_REGISTER_ATTRIBUTION],
  };
}

/**
 * Every supermarket in Denmark, for the map's grocery layer.
 *
 * Needs no key, so it is always `available`. `failed` is true when Overpass could not be reached or
 * would not answer right now, said outright so the map can tell that apart from "no stores".
 *
 * @returns {Promise<{available: true, failed: boolean, stores: Array<import('./groceryClient.js').GroceryStore>, attribution: string[]}>}
 */
export async function getGroceryLayer() {
  const stores = await cached(
    GROCERY_CACHE_KEY,
    (v) => (v ? GROCERY_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS),
    fetchGroceryStores,
  );

  return {
    available: true,
    failed: stores == null,
    // Classified here, not when fetched: see the note on the cache key.
    stores: (stores ?? []).map((store) => ({ ...store, chain: chainOf(store) })),
    attribution: [OSM_ATTRIBUTION],
  };
}

/**
 * Where the jobs for an ernæringsassistent are, for the map's jobs layer: a count per kommune for the
 * choropleth and a dot per advert for the postings layer.
 *
 * Needs no key, so it is always `available`. `failed` is true when Jobindex could not be read right
 * now, said outright so the map can tell that apart from "no jobs". The adverts are fetched at most
 * every two weeks and kept as fetched; which count and where they are is worked out here, per read.
 *
 * @returns {Promise<{available: true, failed: boolean, fetchedAt: number|null, total: number, postings: Array<import('./jobsLayer.js').JobPosting>, choropleth: {type: 'FeatureCollection', features: Array<Object>}, attribution: string[]}>}
 */
export async function getJobsLayer() {
  const stored = await cached(
    JOBS_CACHE_KEY,
    (v) => (v ? JOBS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS),
    async () => {
      const ads = await fetchJobPostings();
      return ads == null ? null : { fetchedAt: Date.now(), ads };
    },
  );

  const kommuner = await getKommuner();
  const layer = buildJobsLayer(stored?.ads ?? [], kommuner);

  return {
    available: true,
    failed: stored == null,
    fetchedAt: stored?.fetchedAt ?? null,
    ...layer,
    attribution: [JOBINDEX_ATTRIBUTION, DAGI_ATTRIBUTION],
  };
}
