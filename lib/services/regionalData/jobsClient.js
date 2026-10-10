/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { selfHostedUserAgent } from '../userAgent.js';
import logger from '../logger.js';

/**
 * Job adverts from Jobindex, for the map's jobs layer.
 *
 * Jobindex is Denmark's largest job board and its search pages are server-rendered: each page embeds
 * the results as JSON (`var Stash = {...}`), with the workplace address, postcode and coordinates of
 * every advert. Its `robots.txt` leaves `/jobsoegning` open and its user terms say nothing about
 * automated access. This is one polite, identified, low-volume reader - a handful of search terms, a
 * few pages each, a pause between requests, twice a month - and it keeps nothing but a title, an
 * employer, a place and a link back. It is not a copy of the site.
 *
 * The embedded JSON is Jobindex's own and can change without notice, so every step fails soft: a
 * page that is not recognised makes the whole fetch `null`, which the caller does not cache as data.
 */

export const JOBINDEX_SEARCH_URL = 'https://www.jobindex.dk/jobsoegning';

/**
 * What is searched for. Adverts for an ernæringsassistent are written under several titles, and a
 * search only finds an advert that mentions its term, so each title family gets its own query. The
 * adverts are told apart again by headline in `jobTitles.js`; these are only the nets.
 */
export const JOB_SEARCH_TERMS = Object.freeze([
  'ernæringsassistent',
  'køkkenassistent',
  'køkkenmedarbejder',
  'kostfaglig',
]);

/** Pages read per term. Jobindex shows 20 per page; the real term has about 7. */
export const MAX_PAGES_PER_TERM = 10;

/** Pause between requests. */
export const PAGE_PAUSE_MS = 2500;

const REQUEST_TIMEOUT_MS = 20_000;

/** Links in the data are only ever Jobindex's own, since they end up behind a click on the map. */
const JOBINDEX_LINK = /^https:\/\/www\.jobindex\.dk\//;

/**
 * @typedef {Object} RawJobAd
 * @property {string} id Jobindex's advert id, e.g. `h1702537`.
 * @property {string} title
 * @property {string} employer
 * @property {string|null} area The place text the advert shows.
 * @property {string|null} url The advert on Jobindex.
 * @property {string|null} firstDate `YYYY-MM-DD`
 * @property {string|null} lastDate Application deadline, `YYYY-MM-DD`.
 * @property {Array<{zip: string|null, city: string|null, lat: number|null, lng: number|null}>} addresses
 */

/**
 * The JSON object that starts at `start`, found by matching braces (string-aware), since the page
 * holds it inside a script with other code after it.
 *
 * @param {string} text
 * @param {number} start Index of the opening `{`.
 * @returns {string|null}
 */
function objectAt(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

const text = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * @param {Object} result One entry of the page's `results`.
 * @returns {RawJobAd|null} `null` for anything without an id and a headline.
 */
export function toRawAd(result) {
  const id = text(result?.tid);
  const title = text(result?.headline);
  if (id == null || title == null) return null;
  const link = text(result.share_url);
  return {
    id,
    title,
    employer: text(result.companytext) ?? text(result.company?.name) ?? '',
    area: text(result.area),
    url: link != null && JOBINDEX_LINK.test(link) ? link : null,
    firstDate: text(result.firstdate),
    lastDate: text(result.lastdate),
    addresses: (Array.isArray(result.addresses) ? result.addresses : []).map((a) => ({
      zip: text(a?.zipcode),
      city: text(a?.city),
      lat: num(a?.coordinates?.latitude),
      lng: num(a?.coordinates?.longitude),
    })),
  };
}

/**
 * Reads one search page.
 *
 * @param {string} html
 * @returns {{totalPages: number, ads: RawJobAd[]}|null} `null` when the page is not a result page we
 *   recognise, so a changed layout is a failure and never "no jobs".
 */
export function parseSearchPage(html) {
  const marker = 'var Stash = ';
  const at = typeof html === 'string' ? html.indexOf(marker) : -1;
  if (at < 0) return null;
  try {
    const json = objectAt(html, at + marker.length);
    if (json == null) return null;
    const response = JSON.parse(json)?.['jobsearch/result_app']?.storeData?.searchResponse;
    if (!Array.isArray(response?.results)) return null;
    const totalPages = Number.isInteger(response.total_pages) ? response.total_pages : 1;
    return { totalPages, ads: response.results.map(toRawAd).filter((ad) => ad != null) };
  } catch {
    return null;
  }
}

/**
 * Every advert Jobindex lists for the search terms, once each.
 *
 * All or nothing: one failed page fails the lot, because a list with a term's pages missing would be
 * cached for weeks as if it were the whole picture. So is an answer with no adverts at all - far more
 * likely a page we no longer understand than a country with no such jobs.
 *
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {readonly string[]} [options.terms]
 * @returns {Promise<RawJobAd[]|null>}
 */
export async function fetchJobPostings({
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  terms = JOB_SEARCH_TERMS,
} = {}) {
  const ads = new Map();
  let first = true;

  const readPage = async (term, page) => {
    if (!first) await sleep(PAGE_PAUSE_MS);
    first = false;
    const url = `${JOBINDEX_SEARCH_URL}?q=${encodeURIComponent(term)}${page > 1 ? `&page=${page}` : ''}`;
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'User-Agent': selfHostedUserAgent, 'Accept-Language': 'da' },
    });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    const parsed = parseSearchPage(await response.text());
    if (parsed == null) throw new Error(`${url} is not a result page this reader recognises`);
    return parsed;
  };

  try {
    for (const term of terms) {
      const firstPage = await readPage(term, 1);
      for (const ad of firstPage.ads) ads.set(ad.id, ad);
      const pages = Math.min(firstPage.totalPages, MAX_PAGES_PER_TERM);
      for (let page = 2; page <= pages; page++) {
        for (const ad of (await readPage(term, page)).ads) ads.set(ad.id, ad);
      }
    }
  } catch (error) {
    logger.warn(`Could not read the job adverts from Jobindex: ${error.message}`);
    return null;
  }

  if (ads.size === 0) {
    logger.warn('Jobindex returned no job adverts at all; treating that as a failure rather than as no jobs.');
    return null;
  }
  return [...ads.values()];
}
