/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Boligsiden, the Danish portal that aggregates listings from most Danish estate agents (EDC,
 * Nybolig, home, danbolig, ...) into one search.
 *
 * www.boligsiden.dk itself sits behind a Cloudflare challenge that a plain request never clears, but
 * its own frontend calls a separate JSON API - api.boligsiden.dk - that answers a bare request with
 * no challenge at all. This provider talks to that API directly, the same way flatfox.js does for
 * the Swiss site whose bot wall is on the HTML but not the API behind it.
 *
 * That API's own robots.txt disallows every path for every agent. Nothing here works around that in
 * a technical sense - it is a deliberate choice for a self-hosted, personal-use search that polls
 * once per job interval, not a scraper hitting the site at volume or redistributing what it reads.
 *
 * There is no page on the site to copy a search URL from, since www.boligsiden.dk cannot be reached
 * plainly - so the job's "search URL" is a direct api.boligsiden.dk query, built by hand:
 *
 *   https://api.boligsiden.dk/search/cases?addressTypes=villa,condo&zipCodes=5000&priceMax=3000000
 *
 * For-sale listings only. Boligsiden's own frontend has no rental ("leje") search at all -
 * verified both empirically (every transaction-type parameter guessed against this endpoint is
 * silently ignored; every returned price is purchase-price-sized) and against `boligvagten`, an
 * independent open-source Danish housing watcher, whose own Boligsiden module is scoped the same
 * way and sources DK rentals from entirely different sites instead. A rental search needs a
 * different provider against one of those.
 *
 * Query parameters (all optional, combine freely):
 *   addressTypes - comma-separated, one or more of: villa, terraced house, condo, holiday house,
 *                  allotment, cooperative, farm, full year plot, holiday plot, villa apartment,
 *                  cattle farm, pig farm, plant farm, forest, hobby farm, special, houseboat,
 *                  garage, parking, business, double house, multiple family house, room
 *   zipCodes     - comma-separated Danish postal codes, e.g. 5000,5230 for Odense
 *   municipalities - comma-separated municipality names, e.g. koebenhavn,frederiksberg - repeat or
 *                  combine with zipCodes freely; there is no single param for a whole region like
 *                  Sjælland, so covering one means listing every municipality in it
 *   priceMin / priceMax - purchase price bounds, in DKK
 */

import { buildHash, isOneOf } from '../utils.js';
import logger from '../services/logger.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.boligsiden.dk/';
const SEARCH_ENDPOINT = 'https://api.boligsiden.dk/search/cases';

/**
 * How many cases to ask for. A search scoped to a city or a handful of postcodes rarely exceeds
 * this, and like flatfox's MAX_PINS, a job only cares about the newest handful anyway - dedup
 * against already-known listings happens by hash, not by walking every page of a huge result set.
 */
const PAGE_SIZE = 300;

/**
 * @param {string} url the job's search URL
 * @returns {Promise<Object[]>}
 */
async function getListings(url) {
  let params;
  try {
    params = new URLSearchParams(new URL(url).search);
  } catch {
    logger.error(`Could not read the Boligsiden search URL: ${url}`);
    return [];
  }

  params.set('per_page', String(PAGE_SIZE));
  params.set('page', '1');

  const response = await fetch(`${SEARCH_ENDPOINT}?${params}`);
  if (!response.ok) {
    logger.error(`Error fetching listings from Boligsiden: ${response.status} ${response.statusText}`);
    return [];
  }

  const body = await response.json();
  return Array.isArray(body?.cases) ? body.cases : [];
}

/**
 * Read one of the API's numbers.
 *
 * Not `extractNumber`: that parser is built for German-formatted text scraped off a page. The API
 * answers with plain JSON numbers already, so all that is needed is a guard against null/NaN.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The street address, as Danish addresses are written: road, house number, postcode and city.
 *
 * @param {any} address
 * @returns {string|null}
 */
function buildAddress(address) {
  if (address == null) {
    return null;
  }
  const street = [address.roadName, address.houseNumber].filter(Boolean).join(' ');
  const town = [address.zipCode, address.cityName].filter(Boolean).join(' ');
  const full = [street, town].filter((part) => part != null && String(part).trim().length > 0).join(', ');
  return full.length > 0 ? full : null;
}

/**
 * The largest image the API offers for a case, since `imageSources` is sorted smallest first.
 *
 * @param {any} o
 * @returns {string|null}
 */
function largestImage(o) {
  const sources = o.defaultImage?.imageSources;
  if (!Array.isArray(sources) || sources.length === 0) {
    return null;
  }
  return sources[sources.length - 1]?.url ?? null;
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  return {
    // The price goes into the hash like everywhere else, so a reduction reaches the user as a new
    // listing instead of passing unnoticed.
    id: buildHash(o.caseID, o.priceCash),
    title: o.descriptionTitle || buildAddress(o.address) || '',
    // caseUrl points at the listing agent's own page (EDC, Nybolig, ...) and every case carries one;
    // the Boligsiden slug is only a fallback in case that ever changes.
    link: o.caseUrl || (o.slug ? `${BASE_URL}${o.slug}` : null),
    price: toNumber(o.priceCash),
    size: toNumber(o.housingArea),
    rooms: toNumber(o.numberOfRooms),
    address: buildAddress(o.address),
    description: o.descriptionBody ?? null,
    image: largestImage(o),
  };
}

/**
 * @param {ParsedListing} o
 * @param {string[]} appliedBlackList
 * @returns {boolean}
 */
function applyBlacklist(o, appliedBlackList) {
  const titleNotBlacklisted = !isOneOf(o.title, appliedBlackList);
  const descNotBlacklisted = !isOneOf(o.description, appliedBlackList);
  return o.title != null && titleNotBlacklisted && descNotBlacklisted;
}

/** @type {ProviderConfig} */
const config = {
  url: null,
  requiredFieldNames: ['id', 'title', 'link', 'price', 'size', 'rooms', 'address'],
  crawlContainer: null,
  crawlFields: {},
  // Newest-first, verified empirically: `timeOnMarket.current.days` comes back ascending with this
  // pair set, versus no consistent order without it. Matters once a search exceeds PAGE_SIZE - the
  // freshest listings are the ones worth keeping in that case, not whichever happened to sort first.
  sortByDateParam: 'sortBy=daysListed&sortAscending=true',
  priceRangeParams: { min: 'priceMin', max: 'priceMax' },
  getListings,
  normalize,
};

export const metaInformation = {
  countries: ['dk'],
  name: 'Boligsiden',
  // baseUrl stays the human site, for the job form's "open in new tab" link - a search URL is
  // never actually copied from there (see the file header), so it is not where a pasted URL is
  // expected to come from. That is api.boligsiden.dk, declared separately via hosts - which
  // replaces baseUrl's host for validation rather than adding to it, since a URL copied from
  // www.boligsiden.dk would parse but carry none of the query shape getListings expects.
  baseUrl: BASE_URL,
  hosts: ['api.boligsiden.dk'],
  id: 'boligsiden',
};

/**
 * Build a run-scoped provider configuration.
 *
 * @param {{url: string, enabled?: boolean}} sourceConfig
 * @param {string[]} [blacklist]
 * @returns {ProviderConfig}
 */
export const createConfig = (sourceConfig, blacklist = []) => ({
  ...config,
  enabled: sourceConfig.enabled,
  url: sourceConfig.url,
  filter: (listing) => applyBlacklist(listing, blacklist ?? []),
});

export { config };
