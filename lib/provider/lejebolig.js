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

/** Boilerplate `#lease-body .lease-text` mixes in around the actual description: a digital-viewing
 * notice, the energy mark, the amenity flags. None of it has its own wrapper - it is loose text
 * alongside these - so the description is read by removing all of it from a clone and taking what
 * is left, rather than by picking one child element. */
const DESCRIPTION_EXCLUDE = '#digitalshowcase, .margin-bottom-30, #lease-flags, #lease-economics, #lease-time';

/**
 * The description a listing's own page carries, which the search card never does.
 *
 * @param {cheerio.CheerioAPI} $
 * @returns {string|null}
 */
function parseDescription($) {
  const container = $('#lease-body .lease-text').first().clone();
  container.find(DESCRIPTION_EXCLUDE).remove();
  const text = container
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return text.length > 0 ? text : null;
}

/**
 * The one structured source on a listing's page: a `RealEstateListing` ld+json block carrying a
 * proper street/postcode/city address and the date it was posted, neither of which the search card
 * carries either (see the file header on why the address stops at the area there).
 *
 * @param {cheerio.CheerioAPI} $
 * @returns {{address: string|null, publishedAt: number|null}}
 */
function parseStructuredData($) {
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    let data;
    try {
      data = JSON.parse($(script).contents().text());
    } catch {
      continue;
    }
    if (data?.['@type'] !== 'RealEstateListing') continue;

    const addr = data.itemOffered?.address;
    const address =
      addr?.streetAddress && addr?.addressLocality
        ? `${addr.streetAddress}, ${addr.postalCode ? `${addr.postalCode} ` : ''}${addr.addressLocality}`
        : null;
    const publishedAt = data.datePosted ? new Date(data.datePosted).getTime() : null;
    return { address, publishedAt: Number.isFinite(publishedAt) ? publishedAt : null };
  }
  return { address: null, publishedAt: null };
}

/**
 * Read a listing's own page for the description and full address the search card never carries
 * (see the file header). The on-demand exception `detailRefetchService.js` describes: one person
 * asking about one listing is not the bulk traffic that kept this off the search pass.
 *
 * No browser needed, unlike most providers `fetchDetails` is written for - same as `getListings`,
 * this is a plain server-rendered page with no bot wall (see the file header) - so the second
 * argument `detailRefetchService.js` hands every provider is simply not in this signature.
 *
 * @param {ParsedListing} listing
 * @returns {Promise<ParsedListing>}
 */
async function fetchDetails(listing) {
  if (listing?.link == null) return listing;

  try {
    const response = await fetch(listing.link);
    if (!response.ok) {
      logger.warn(`Lejebolig: detail page for ${listing.id} answered ${response.status}.`);
      return listing;
    }
    const $ = cheerio.load(await response.text());

    const description = parseDescription($);
    if (description != null) listing.description = description;

    const { address, publishedAt } = parseStructuredData($);
    if (address != null) listing.address = address;
    if (publishedAt != null) listing.publishedAt = publishedAt;
  } catch (error) {
    logger.warn(`Lejebolig: could not read detail page for ${listing.id}.`, error?.message || error);
  }

  return listing;
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
  fetchDetails,
};

export const metaInformation = {
  countries: ['dk'],
  currency: 'DKK',
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
