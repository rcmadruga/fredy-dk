/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Lejebolig, a Danish rental portal - and, unlike Boligsiden (see boligsiden.js), one that actually
 * lists rentals rather than sales.
 *
 * www.lejebolig.dk serves its search results as plain server-rendered HTML with no bot wall at all:
 * a bare `fetch()` gets the same markup a browser would, no Cloudflare/DataDome challenge, no API
 * subdomain to reach for instead. Its `robots.txt` leaves `/lejeboliger` open to `User-agent: *` and
 * sets `Content-Signal: search=yes, ai-input=yes` - both read as permission for exactly this kind of
 * personal search aggregation.
 *
 * The search URL is whatever the site itself browses to, e.g. `https://www.lejebolig.dk/lejeboliger`
 * for the whole country or `https://www.lejebolig.dk/lejeboliger/koebenhavn` scoped to a city - the
 * site has one of these path segments per city/town it covers, listed as buttons on the search page.
 *
 * Every other filter on the page (rent ceiling, minimum size, room count, property type, ...) is
 * submitted as a POST to the same path and only takes effect for the session that submitted it - the
 * page never reflects a filter back into its own URL or honours one passed as a query parameter (both
 * verified empirically: `?Rent=8000` on a URL returns the same result count as the URL without it).
 * There is nothing to forward here, so `priceRangeParams` stays unset - the job's own spec filter
 * (`minRooms`/`minSize`/`maxPrice`, applied after `normalize()` regardless of provider) is what price
 * and room filtering for this provider runs through instead.
 *
 * The list defaults to newest-first ("Nyeste øverst" is the page's own default sort, `SortOrder=
 * Updated`) and, like the sort/filter selects, that default cannot be overridden through the URL -
 * but it also cannot be overridden *away* by a plain unauthenticated request, since there is no
 * session for a different choice to persist in. `sortByDateParam` stays unset for the same reason
 * `priceRangeParams` does: there is no query parameter that changes anything.
 */

import * as cheerio from 'cheerio';
import { buildHash, isOneOf } from '../utils.js';
import { extractNumber } from '../utils/extract-number.js';
import logger from '../services/logger.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.lejebolig.dk/';

/** One result card. The login-teaser shown to logged-out visitors is a `lease-item` too, but marked
 * `dummy` and `aria-hidden` - it advertises no real listing and has to be excluded explicitly rather
 * than just failing to parse, since it carries a title, a price and a city like a real card would. */
const CARD = '.lease-item';
const DUMMY_CARD = '.lease-item.dummy';

/** The numeric listing id, read out of its detail link (`/lejebolig/1889904/rakkehus-...`). */
const ID_FROM_HREF = /\/lejebolig\/(\d+)\//;

/**
 * Turn a search page into one raw entry per result card.
 *
 * @param {string} html the search page source
 * @param {string} url the search url, which is what relative links are resolved against
 * @returns {Object[]}
 */
export function parseListings(html, url) {
  const $ = cheerio.load(html);
  const listings = [];

  $(CARD)
    .not(DUMMY_CARD)
    .each((_, element) => {
      const card = $(element);
      const link = card.find('a.lease-info').first();
      const href = link.attr('href');
      const id = ID_FROM_HREF.exec(href ?? '')?.[1] ?? null;
      if (id == null) return;

      // The three spec chips are unlabelled icons in a fixed order - area, rooms, rental period -
      // rather than three fields that could be told apart by class name or content.
      const specs = card
        .find('.lease-spec span')
        .map((__, span) => $(span).text().trim())
        .get();

      listings.push({
        id,
        title: card.find('.lease-description h2').text().trim(),
        link: new URL(href, url).toString(),
        price: card.find('.rent').text().trim(),
        // The address the list itself shows - "Lejlighed i København S" - is dwelling type plus
        // area, not a street address. Lejebolig only publishes the street once a listing is opened,
        // and reaching that would mean one extra request per card; the area is what the geocoder and
        // the user both need to place the listing, so it stands in for the full address here.
        address: card.find('.lease-sub-header').text().trim() || null,
        size: specs[0] ?? null,
        rooms: specs[1] ?? null,
        image: card.find('.lease-image').attr('data-lazy-bg') ?? null,
      });
    });

  return listings;
}

/**
 * @param {string} url the job's search URL
 * @returns {Promise<Object[]>}
 */
async function getListings(url) {
  const response = await fetch(url);
  if (!response.ok) {
    logger.error(`Error fetching listings from Lejebolig: ${response.status} ${response.statusText}`);
    return [];
  }

  return parseListings(await response.text(), url);
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  return {
    // The price goes into the hash like everywhere else, so a reduction reaches the user as a new
    // listing instead of passing unnoticed.
    id: buildHash(o.id, o.price),
    title: o.title || o.address,
    link: o.link,
    // "4.440,-" / "19.495,-" - the dot groups thousands and the trailing "-" (no øre) is simply
    // where parseFloat stops reading, exactly like the German-formatted text extractNumber was
    // built for.
    price: extractNumber(o.price),
    size: extractNumber(o.size),
    rooms: extractNumber(o.rooms),
    address: o.address,
    description: null,
    image: o.image,
  };
}

/**
 * @param {ParsedListing} o
 * @param {string[]} appliedBlackList
 * @returns {boolean}
 */
function applyBlacklist(o, appliedBlackList) {
  return (
    o.title != null &&
    !isOneOf(o.title, appliedBlackList) &&
    !isOneOf(o.address, appliedBlackList) &&
    !isOneOf(o.description, appliedBlackList)
  );
}

/** @type {ProviderConfig} */
const config = {
  url: null,
  requiredFieldNames: ['id', 'title', 'link', 'price', 'size', 'rooms', 'address'],
  crawlContainer: null,
  crawlFields: {},
  // Neither exists as a URL parameter - see the file header.
  sortByDateParam: null,
  priceRangeParams: null,
  getListings,
  normalize,
};

export const metaInformation = {
  countries: ['dk'],
  name: 'Lejebolig',
  baseUrl: BASE_URL,
  id: 'lejebolig',
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
