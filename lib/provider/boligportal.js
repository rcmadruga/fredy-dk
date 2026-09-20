/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * BoligPortal, Denmark's largest rental portal and, unlike Boligsiden (sales only), one where most of
 * the rentals are - private landlords included, which is what Lejebolig (see lejebolig.js) lacks.
 *
 * The site sits behind a Cloudflare challenge that a plain request never clears (403), so this needs
 * the shared browser; `boligportalSearch.js` drives it and waits the challenge out. Measured with
 * Fredy's own browser settings, it clears in about ten seconds.
 *
 * The results are not read off the cards. The page is a server-rendered app that hydrates from one
 * JSON blob, `<script id="store">`, and the whole result list is in it as `props.page_props.results`:
 * 18 adverts of ~70 fields each, with the figures as numbers and the coordinates included. The cards'
 * markup is utility-class soup (`group border-border relative flex ...`) that changes with every
 * redesign; the data keys are the application's own. The rest of the blob is left alone, in
 * particular `similar_ads` (adverts from other places, shown under the results) and the
 * promoted-ads calls, which are not the search.
 *
 * The search URL is whatever the site itself browses to. Filters live in both the path and the query:
 *
 *   /lejligheder,rækkehuse,huse/hillerød/5-værelser/?min_size_m2=90&min_rental_period=0&newbuild=1
 *   /lejeboliger/hillerød/alle-værelser/?max_monthly_rent=18424&offset=18
 *
 * so a pasted URL is used as it is. `offset` counts adverts, not pages (18 to a page), and the page
 * names its successor in `next_page_url`, which is what is followed rather than a guess at the
 * arithmetic. `min_monthly_rent`/`max_monthly_rent` are the price range: `max_monthly_rent` is seen in
 * real URLs, `min_monthly_rent` is the page's own filter name for the other end.
 *
 * Prices are the monthly rent as advertised. The utilities and other costs some landlords add on top
 * (`monthly_rent_extra_costs`) are not part of it, the same way the other rental providers here quote
 * the base rent, so a figure compares like with like across them. The deposit and prepaid rent are
 * left out for the same reason.
 *
 * The default order is newest first, and choosing it on the site is what removes the `order` parameter;
 * every other sort adds one (`order=RENT_ASC`, `order=SIZE_M2_DESC`). So there is no value to send for
 * "newest" - `sortByDateParam` stays unset - and the way to get it is to leave `order` out, which
 * {@link newestFirst} does to a pasted URL that has one. The same goes for `offset`: a URL copied from
 * the second page of a search would otherwise skip the first. What was read is still sorted by
 * `advertised_date` here, so the order holds across the pages read (see `MAX_PAGES`) whatever the site
 * does within one.
 */

import * as cheerio from 'cheerio';
import { buildHash, isOneOf, sleep } from '../utils.js';
import { fetchSearchHtml, STORE_SELECTOR } from '../services/boligportal/boligportalSearch.js';
import { publicationDate } from '../utils/publicationDate.js';
import logger from '../services/logger.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.boligportal.dk/';

/**
 * How many result pages one run reads. Each is a full browser navigation through a Cloudflare
 * challenge, so this is a trade: a job that finds more new adverts between two runs than fit on the
 * pages read would miss the oldest of them, while every extra page is more load on a site that is
 * actively looking for automated visitors. Two pages is 36 adverts, which is well over what a search
 * usually turns up between runs.
 */
const MAX_PAGES = 2;

/** Pause between two pages of the same run, so they do not arrive back to back. */
const PAGE_DELAY_MS = 2500;
const PAGE_DELAY_JITTER_MS = 2000;

/**
 * Read the search state out of a BoligPortal page.
 *
 * @param {string|null} html the page source
 * @returns {{ads: Object[], nextUrl: string|null}|null} `null` when the page carried no search state -
 *   a wall, an error page, or a change in how the site delivers its data. An empty result list is not
 *   that: it comes back as `{ads: [], nextUrl: null}`.
 */
export function readSearchPage(html) {
  if (!html) return null;

  const payload = cheerio.load(html)(STORE_SELECTOR).first().text();
  if (!payload) return null;

  try {
    const pageProps = JSON.parse(payload)?.props?.page_props;
    if (pageProps == null || !Array.isArray(pageProps.results)) return null;

    const next =
      typeof pageProps.next_page_url === 'string' && pageProps.next_page_url.length > 0
        ? pageProps.next_page_url
        : null;
    return { ads: pageProps.results, nextUrl: next == null ? null : new URL(next, BASE_URL).href };
  } catch (error) {
    logger.error('Could not parse the BoligPortal page data.', error?.message || error);
    return null;
  }
}

/**
 * The search URL as it has to be asked for: no sort of the user's choosing, and from the first page.
 *
 * A search saved with "cheapest first" would otherwise come back cheapest first, and this provider
 * reads only the first two pages of it - the newest adverts could sit beyond them and never be seen.
 *
 * @param {string} url the job's search URL
 * @returns {string} the same search, with `order` and `offset` removed; the url itself when it does
 *   not parse, which the navigation then reports as the failure it is
 */
export function newestFirst(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('order');
    parsed.searchParams.delete('offset');
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * @param {Object} ad
 * @returns {number} Epoch milliseconds the advert was put up, 0 when the page does not say.
 */
const advertisedAt = (ad) => publicationDate(ad?.advertised_date) ?? publicationDate(ad?.created) ?? 0;

/**
 * @param {string} url the job's search URL
 * @param {any} browser the shared browser of the current job run
 * @returns {Promise<Object[]>} the adverts of the first `MAX_PAGES` pages, newest first
 * @throws When the first page could not be had, so a wall or a change in the page is a failed run
 *   rather than a quiet "no listings".
 */
async function getListings(url, browser) {
  /** @type {Map<string, Object>} */
  const adverts = new Map();
  let pageUrl = newestFirst(url);

  for (let page = 0; page < MAX_PAGES && pageUrl != null; page++) {
    const search = readSearchPage(await fetchSearchHtml(pageUrl, browser));

    if (search == null) {
      if (page === 0) {
        throw new Error('BoligPortal did not return a search page - blocked, or its page data has changed.');
      }
      // A later page failing costs only the older adverts; what was read is still worth having.
      logger.warn(`BoligPortal page ${page + 1} of this search could not be read; using the pages before it.`);
      break;
    }

    for (const ad of search.ads) {
      if (ad?.id != null) adverts.set(String(ad.id), ad);
    }

    pageUrl = search.nextUrl;
    if (pageUrl != null && page + 1 < MAX_PAGES) {
      await sleep(PAGE_DELAY_MS + Math.random() * PAGE_DELAY_JITTER_MS);
    }
  }

  return [...adverts.values()].sort((a, b) => advertisedAt(b) - advertisedAt(a));
}

/**
 * @param {unknown} value
 * @returns {number|null} the figure when it is a finite number, else null
 */
function toNumber(value) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return value != null && value !== '' && Number.isFinite(parsed) ? parsed : null;
}

/**
 * "Bakkegade 23, 3400 Hillerød" - a Danish address as it is written: street and number, then
 * postcode and town. The street can be missing (some landlords hide it), and then the postcode and
 * town are what is left.
 *
 * @param {Object} ad
 * @returns {string|null}
 */
function buildAddress(ad) {
  const street = [ad.street_name, ad.street_number]
    .filter((part) => part != null && String(part).trim() !== '')
    .join(' ');
  const town = [ad.postal_code, ad.city].filter((part) => part != null && String(part).trim() !== '').join(' ');
  const full = [street, town].filter((part) => part.length > 0).join(', ');
  return full.length > 0 ? full : null;
}

/**
 * The first picture that is a photo. A floor plan is often the first image of a flat, and as a card's
 * thumbnail it says nothing about the place.
 *
 * @param {Object} ad
 * @returns {string|null}
 */
function pickImage(ad) {
  const images = Array.isArray(ad.images) ? ad.images : [];
  return (
    (images.find((image) => image?.url && !image.is_floor_plan) ?? images.find((image) => image?.url))?.url ?? null
  );
}

/**
 * @param {Object} ad one entry of `page_props.results`
 * @returns {ParsedListing}
 */
function normalize(ad) {
  const price = toNumber(ad.monthly_rent);
  const address = buildAddress(ad);
  const latitude = toNumber(ad.location?.lat);
  const longitude = toNumber(ad.location?.lng);

  return {
    // The price goes into the hash, so a reduction reaches the user as a new listing instead of
    // passing unnoticed. As text: `buildHash` skips anything without a length, so a number - the
    // price as it arrives - would be dropped and leave the id the advert's own, whatever it costs.
    id: buildHash(String(ad.id), price == null ? null : String(price)),
    title: ad.title || address,
    link: ad.url ? new URL(ad.url, BASE_URL).href : null,
    price,
    size: toNumber(ad.size_m2),
    rooms: toNumber(ad.rooms),
    address,
    description: ad.description || null,
    image: pickImage(ad),
    publishedAt: advertisedAt(ad) || undefined,
    // The page's own coordinates, so a listing is placed without a geocoding request - which
    // matters for the ones whose street is hidden and would not geocode to anything useful.
    ...(latitude != null && longitude != null ? { latitude, longitude } : {}),
  };
}

/**
 * Whether an advert is one a person could still answer. The list should only hold live ones; this is
 * for the odd draft or withdrawn entry, and it only rejects what says outright that it is not live.
 *
 * @param {Object} ad
 * @returns {boolean}
 */
function isLive(ad) {
  return ad?.deleted !== true && (ad?.state == null || /^ACTIVE/i.test(String(ad.state)));
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
  // The results come from the page's JSON rather than its markup, so there is nothing to crawl.
  crawlContainer: null,
  crawlFields: {},
  // Newest first is the site's default and has no parameter of its own - see the file header.
  sortByDateParam: null,
  priceRangeParams: { min: 'min_monthly_rent', max: 'max_monthly_rent' },
  getListings: async (url, browser) => (await getListings(url, browser)).filter(isLive),
  normalize,
};

export const metaInformation = {
  countries: ['dk'],
  currency: 'DKK',
  name: 'BoligPortal',
  baseUrl: BASE_URL,
  id: 'boligportal',
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
